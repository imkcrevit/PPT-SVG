import { readFile } from "node:fs/promises";
import path from "node:path";

import type { GenerateFigureRequest, GenerateFigureResponse, InternalSkill } from "@/lib/types";

export type ChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

const PROMPT_ROOT = path.resolve(process.cwd(), "prompt");
const UPLOAD_ROOT = path.join("/tmp", "ppt-svg", "uploads");

export async function loadPrompt(relativePath: string): Promise<string> {
  const fullPath = path.resolve(PROMPT_ROOT, relativePath);
  const relative = path.relative(PROMPT_ROOT, fullPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid prompt path: ${relativePath}`);
  }

  return readFile(fullPath, "utf8");
}

function assertSkillPromptPath(promptFile: string): void {
  if (!/^skills\/[a-z0-9-]+\.md$/.test(promptFile)) {
    throw new Error(`Skill prompts must live in PPT-SVG/prompt/skills: ${promptFile}`);
  }
}

export async function buildGenerateMessages(
  request: GenerateFigureRequest,
  skill: InternalSkill,
  compressedContext?: string
): Promise<ChatMessage[]> {
  assertSkillPromptPath(skill.promptFile);

  const [systemPrompt, contractPrompt, qualityPrompt, skillPrompt] = await Promise.all([
    loadPrompt("system/generate-figure.md"),
    loadPrompt("shared/figure-json-contract.md"),
    loadPrompt("shared/svg-quality-rules.md"),
    loadPrompt(skill.promptFile)
  ]);

  const userPayload = {
    selected_skill: skill.id,
    output_language: request.language,
    ui_language_environment: request.language === "zh" ? "Simplified Chinese" : "English",
    language_instruction:
      request.language === "zh"
        ? "The active UI language is Simplified Chinese. Output every visible label, title, note, and metadata value directly in Simplified Chinese unless the user explicitly asks for another language."
        : "The active UI language is English. Output every visible label, title, note, and metadata value directly in English unless the user explicitly asks for another language.",
    canvas: skill.defaultCanvas,
    user_description: request.userDescription,
    image_reference_instruction:
      "If image attachments are present, inspect their visual content directly. Use them as source material for objects, labels, relationships, steps, visual evidence, and user follow-up requests. Do not say an image was not provided when image_reference parts are attached.",
    intent_fidelity_policy: {
      preserve: "Preserve every explicit user-provided item, sequence, relationship, label, constraint, and revision.",
      preserve_scoped_entities:
        "Keep scoped or qualified entities intact. For example, 'A系统中的B子系统' means both A系统 and B子系统 must remain visible, not just B子系统.",
      preserve_intermediaries:
        "Keep explicit access mechanisms and intermediaries such as middleware, gateway, API, queue, protocol, or database names.",
      no_fabrication: "Do not invent unstated goals, metrics, actors, dates, stages, product names, or causal relationships.",
      no_silent_defaults:
        "If purpose is unclear, do not silently choose a business goal. Use only explicit text and lower fit, because the client should ask the user to choose a purpose before generation."
    },
    conversation: {
      session_id: request.sessionId ?? request.conversationId ?? null,
      id: request.conversationId ?? null,
      turn: request.conversationTurn ?? 1,
      max_turns: 5,
      instruction:
        "If reference_current_render is present, treat it as the currently rendered right-side SVG data. Use it as source material for revisions instead of starting over, unless the user explicitly asks for a new diagram."
    },
    compressed_context: compressedContext || null,
    reference_current_render: request.referenceFigure
      ? {
          source: request.referenceFigure.source,
          fit: request.referenceFigure.fit ?? null,
          figure: request.referenceFigure.figure
        }
      : null,
    attachments: attachmentMetadata(request),
    ppt_context: request.pptContext ?? null
  };

  return [
    {
      role: "system",
      content: [systemPrompt, contractPrompt, qualityPrompt, skillPrompt].join("\n\n---\n\n")
    },
    {
      role: "user",
      content: await withImageContent(JSON.stringify(userPayload, null, 2), request)
    }
  ];
}

export async function buildContextCompressionMessages(request: GenerateFigureRequest): Promise<ChatMessage[]> {
  const systemPrompt = await loadPrompt("system/compress-context.md");
  const userPayload = {
    output_language: request.language,
    user_description: request.userDescription,
    image_reference_instruction:
      "If image attachments are present, inspect their visual content directly and summarize concrete objects, text, relationships, and likely production steps needed for later diagram generation.",
    intent_fidelity_policy: {
      preserve: "Keep all explicit user facts and ordered items, including the first and last items in chains.",
      preserve_scoped_entities: "Keep parent-child qualifiers such as 'A系统中的B子系统'; do not compress them to the child alone.",
      preserve_intermediaries: "Keep named intermediaries and access mechanisms such as '通过X中间件访问'.",
      no_fabrication: "Record gaps in missing_context instead of filling them with assumptions."
    },
    conversation_turn: request.conversationTurn ?? 1,
    attachments: attachmentMetadata(request),
    ppt_context: request.pptContext ?? null,
    reference_current_render: request.referenceFigure
      ? {
          source: request.referenceFigure.source,
          title: request.referenceFigure.figure.metadata.title,
          description: request.referenceFigure.figure.metadata.description,
          fit: request.referenceFigure.fit ?? null,
          figure: request.referenceFigure.figure
        }
      : null
  };

  return [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: await withImageContent(JSON.stringify(userPayload, null, 2), request)
    }
  ];
}

function attachmentMetadata(request: GenerateFigureRequest) {
  return (
    request.attachments?.map((attachment) => ({
      original_name: attachment.originalName,
      hash: attachment.hash,
      extension: attachment.extension,
      mime_type: attachment.mimeType,
      size: attachment.size,
      stored_path: attachment.path,
      extracted_text: attachment.extractedText || null,
      visual_reference: isImageAttachment(attachment)
    })) ?? []
  );
}

async function withImageContent(text: string, request: GenerateFigureRequest): Promise<string | ChatContentPart[]> {
  const imageParts = await buildImageContentParts(request);
  if (!imageParts.length) {
    return text;
  }

  return [
    {
      type: "text",
      text
    },
    ...imageParts
  ];
}

async function buildImageContentParts(request: GenerateFigureRequest): Promise<ChatContentPart[]> {
  const images = request.attachments?.filter(isImageAttachment) ?? [];
  const parts: ChatContentPart[] = [];

  for (const attachment of images) {
    const safePath = resolveUploadPath(attachment.path);
    if (!safePath) {
      continue;
    }

    const bytes = await readFile(safePath);
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${attachment.mimeType};base64,${bytes.toString("base64")}`
      }
    });
  }

  return parts;
}

function isImageAttachment(attachment: { extension?: string; mimeType?: string }): boolean {
  const extension = attachment.extension?.toLowerCase();
  return (
    (extension === "png" || extension === "jpg" || extension === "jpeg") &&
    (attachment.mimeType === "image/png" || attachment.mimeType === "image/jpeg")
  );
}

function resolveUploadPath(filePath: string): string | undefined {
  const resolved = path.resolve(filePath);
  const relative = path.relative(UPLOAD_ROOT, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }

  return resolved;
}

export async function buildRepairMessages(rawOutput: string, validationErrors: string[]): Promise<ChatMessage[]> {
  const [repairPrompt, contractPrompt, qualityPrompt] = await Promise.all([
    loadPrompt("system/repair-json.md"),
    loadPrompt("shared/figure-json-contract.md"),
    loadPrompt("shared/svg-quality-rules.md")
  ]);

  return [
    {
      role: "system",
      content: [repairPrompt, contractPrompt, qualityPrompt].join("\n\n---\n\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          invalid_output: rawOutput,
          validation_errors: validationErrors
        },
        null,
        2
      )
    }
  ];
}

export async function buildVisualRevisionMessages(
  request: GenerateFigureRequest,
  skill: InternalSkill,
  currentResponse: GenerateFigureResponse,
  visualReview: {
    ok: boolean;
    score: number;
    summary: string;
    deterministicIssues: string[];
    issues: Array<{
      severity: string;
      message: string;
      evidence?: string;
      elementId?: string;
    }>;
  },
  compressedContext: string,
  attempt: number
): Promise<ChatMessage[]> {
  assertSkillPromptPath(skill.promptFile);

  const [systemPrompt, contractPrompt, qualityPrompt, skillPrompt] = await Promise.all([
    loadPrompt("system/generate-figure.md"),
    loadPrompt("shared/figure-json-contract.md"),
    loadPrompt("shared/svg-quality-rules.md"),
    loadPrompt(skill.promptFile)
  ]);

  return [
    {
      role: "system",
      content: [
        systemPrompt,
        contractPrompt,
        qualityPrompt,
        skillPrompt,
        [
          "You are regenerating a PPT-SVG figure after a visual QA agent found layout defects.",
          "Return a complete replacement JSON object, not a patch.",
          "Preserve the user's original intent, language, skill, scoped entities, ordering, relationships, labels, constraints, intermediaries, and core content. Do not drop parent qualifiers such as A系统 in A系统中的B子系统, and do not fabricate content while fixing layout.",
          "Adjust the semantic structure, decomposition, parent relationships, edge labels, and detail text as needed to fix the QA feedback.",
          "Do not output coordinates, text box sizes, font sizes, spacing, colors, canvas, or shape fields; the deterministic layout engine handles geometry."
        ].join("\n")
      ].join("\n\n---\n\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          selected_skill: skill.id,
          output_language: request.language,
          regeneration_attempt: attempt,
          canvas: skill.defaultCanvas,
          user_description: request.userDescription,
          compressed_context: compressedContext || null,
          conversation: {
            session_id: request.sessionId ?? request.conversationId ?? null,
            id: request.conversationId ?? null,
            turn: request.conversationTurn ?? 1
          },
          current_response: currentResponse,
          visual_review_feedback: {
            ok: visualReview.ok,
            score: visualReview.score,
            summary: visualReview.summary,
            issues: visualReview.issues,
            deterministic_layout_issues: visualReview.deterministicIssues
          },
          regeneration_instruction:
            "Regenerate the full semantic diagram JSON so the visual QA issues are fixed. Keep visible text in the active output language. Do not mention the QA process inside the diagram."
        },
        null,
        2
      )
    }
  ];
}
