import { NextResponse } from "next/server";

import { isLocale } from "@/lib/i18n";
import { parseJsonObject } from "@/lib/json";
import { callOpenRouterWithUsage, OpenRouterError } from "@/lib/openrouter";
import {
  checkOptimizeAbuse,
  enforceGenerationContentLength,
  securityJson,
  validateGenerationPayload
} from "@/lib/request-security";
import { normalizeSessionId } from "@/lib/session";
import { isSkillId } from "@/lib/skills";
import { createTokenUsageRecorder, normalizeTokenUsage } from "@/lib/token-usage";
import type { ChatMessage } from "@/lib/prompts";

export const runtime = "nodejs";

interface OptimizeConversationEntry {
  role: "user" | "assistant";
  turn: number | null;
  content: string;
  referencedRender?: boolean;
}

interface OptimizeRenderHistoryEntry {
  turn: number | null;
  title: string;
  userDescription: string;
  fitScore: number | null;
  referencedRender?: boolean;
}

interface ReferenceRenderSummary {
  title: string;
  description: string;
  language: string;
  skillId: string;
  fit: unknown;
  visibleText: Array<{ id: string; text: string }>;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const contentLengthDecision = enforceGenerationContentLength(request);

  if (!contentLengthDecision.ok) {
    return securityJson(contentLengthDecision);
  }

  try {
    const body = (await request.json()) as {
      userDescription?: string;
      language?: string;
      skillId?: string;
      sessionId?: string;
      conversationId?: string;
      conversationTurn?: number;
      referenceFigure?: unknown;
      conversationHistory?: unknown;
      renderHistory?: unknown;
    };
    const payloadDecision = validateGenerationPayload(body);

    if (!payloadDecision.ok) {
      return securityJson(payloadDecision);
    }

    if (!body.userDescription?.trim()) {
      return NextResponse.json({ error: "userDescription is required." }, { status: 400 });
    }

    if (!body.language || !isLocale(body.language)) {
      return NextResponse.json({ error: "Invalid language." }, { status: 400 });
    }

    if (!body.skillId || !isSkillId(body.skillId)) {
      return NextResponse.json({ error: "Invalid skillId." }, { status: 400 });
    }

    const sessionId = normalizeSessionId(body.sessionId ?? body.conversationId);
    const abuseDecision = checkOptimizeAbuse(request, sessionId);
    if (!abuseDecision.ok) {
      return securityJson(abuseDecision);
    }

    const tokenRecorder = createTokenUsageRecorder({
      sessionId,
      conversationId: typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : sessionId,
      conversationTurn: typeof body.conversationTurn === "number" && Number.isFinite(body.conversationTurn) ? body.conversationTurn : undefined,
      requestId
    });
    const result = await callOpenRouterWithUsage(buildOptimizeMessages(body), {
      maxCompletionTokens: 1200,
      temperature: 0.2
    });
    await tokenRecorder.record({
      operation: "optimize-prompt",
      usage: normalizeTokenUsage(result.usage),
      model: result.model,
      generationId: result.generationId
    });
    await tokenRecorder.snapshot();
    const rawOutput = result.text;
    const parsed = parseJsonObject(rawOutput) as Record<string, unknown>;
    const optimizedDescription =
      typeof parsed.optimized_description === "string" ? parsed.optimized_description.trim() : "";

    if (!optimizedDescription) {
      return NextResponse.json({ error: "The optimizer did not return an optimized description." }, { status: 502 });
    }

    return NextResponse.json({ optimizedDescription });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected prompt optimization error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildOptimizeMessages(body: {
  userDescription?: string;
  language?: string;
  skillId?: string;
  sessionId?: string;
  conversationId?: string;
  conversationTurn?: number;
  referenceFigure?: unknown;
  conversationHistory?: unknown;
  renderHistory?: unknown;
}): ChatMessage[] {
  const outputLanguage = body.language === "zh" ? "Simplified Chinese" : "English";
  const recentConversation = sanitizeConversationHistory(body.conversationHistory);
  const recentRenders = sanitizeRenderHistory(body.renderHistory);
  const referenceRenderSummary = summarizeReferenceRender(body.referenceFigure);

  return [
    {
      role: "system",
      content: [
        "You edit a rough diagram request into a clear, concise final instruction for a diagram generator. The user may be continuing an existing conversation, so optimize the current request in context instead of treating it as a standalone prompt.",
        "",
        "Context priority:",
        "- Use recent_conversation, recent_renders, and reference_current_render_summary as semantic context.",
        "- If the current request is a follow-up edit, preserve the existing diagram's visible content and apply only the requested change unless the user explicitly asks to replace or regenerate it.",
        "- If current render data is present, keep its title, main entities, ordering, and relationships as the baseline.",
        "",
        "Concise optimization policy:",
        "- Make the request concrete enough to render, but do not write a chain of thought, analysis steps, alternatives, or rationale.",
        "- Prefer a short final instruction. Remove filler and repeated wording.",
        "- Preserve every explicit item, sequence, relationship, label, constraint, and revision.",
        "- Fill only small obvious semantic gaps required for rendering. Do NOT invent product names, vendors, exact numbers, technologies, metrics, dates, actors, or causal relationships.",
        "- If the user's purpose is genuinely unclear, keep that uncertainty explicit instead of inventing a wrong purpose.",
        "",
        "Logical diagram policy:",
        "- For flow, architecture, hierarchy, cycle, and other logic diagrams, do not recommend heavy decomposition, many extra nodes, or longer wording unless the user explicitly asks for detail.",
        "- Keep labels short and the diagram simple. Use shallow grouping and brief detail text only when it preserves user-provided meaning.",
        "- Do not expand a simple logic diagram into many sub-steps just because the domain could contain them.",
        "",
        "Preserve faithfully (never lose user intent while expanding):",
        "- Keep every explicit item, sequence, relationship, label, constraint, and revision.",
        "- Do not drop the first or last item in chains such as A -> B -> C.",
        "- Preserve scoped entities and qualifiers: A系统中的B子系统 must not become only B子系统.",
        "- Preserve named intermediaries such as X中间件 in relationships like B通过X访问C.",
        "- If the user's purpose is genuinely unclear, keep that uncertainty explicit instead of inventing a wrong purpose.",
        "",
        "Output rules:",
        "- Write the entire optimized_description in the active output language. If output_language is Simplified Chinese, write it in Simplified Chinese; never translate the user's content into English.",
        "- Do not add coordinates, colors, sizes, or visual styling instructions; describe content and structure only.",
        "- Return only the final optimized request. Do not include headings like 'analysis', 'reasoning', 'thought process', or 'optimization explanation'.",
        "- Return ONLY JSON: { \"optimized_description\": string }. No markdown, no prose outside the JSON."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          output_language: outputLanguage,
          selected_skill: body.skillId,
          conversation_turn: body.conversationTurn ?? 1,
          user_description: body.userDescription,
          has_reference_current_render: Boolean(body.referenceFigure),
          recent_conversation: recentConversation,
          recent_renders: recentRenders,
          reference_current_render_summary: referenceRenderSummary,
          required_json_shape: {
            optimized_description: "string"
          }
        },
        null,
        2
      )
    }
  ];
}

function sanitizeConversationHistory(value: unknown): OptimizeConversationEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-10)
    .map((item) => {
      const record = asRecord(item);
      const role = record?.role === "assistant" ? "assistant" : record?.role === "user" ? "user" : undefined;
      const content = typeof record?.content === "string" ? record.content.trim() : "";

      if (!role || !content) {
        return undefined;
      }

      const entry: OptimizeConversationEntry = {
        role,
        turn: typeof record?.turn === "number" && Number.isFinite(record.turn) ? record.turn : null,
        content: content.slice(0, 1200),
        referencedRender: record?.referencedRender === true
      };
      return entry;
    })
    .filter((item): item is OptimizeConversationEntry => Boolean(item));
}

function sanitizeRenderHistory(value: unknown): OptimizeRenderHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 5)
    .map((item) => {
      const record = asRecord(item);
      const title = typeof record?.title === "string" ? record.title.trim() : "";
      const userDescription = typeof record?.userDescription === "string" ? record.userDescription.trim() : "";

      if (!title && !userDescription) {
        return undefined;
      }

      const entry: OptimizeRenderHistoryEntry = {
        turn: typeof record?.turn === "number" && Number.isFinite(record.turn) ? record.turn : null,
        title: title.slice(0, 240),
        userDescription: userDescription.slice(0, 1200),
        fitScore: typeof record?.fitScore === "number" && Number.isFinite(record.fitScore) ? record.fitScore : null,
        referencedRender: record?.referencedRender === true
      };
      return entry;
    })
    .filter((item): item is OptimizeRenderHistoryEntry => Boolean(item));
}

function summarizeReferenceRender(value: unknown): ReferenceRenderSummary | null {
  const reference = asRecord(value);
  const figure = asRecord(reference?.figure);
  const metadata = asRecord(figure?.metadata);

  if (!figure || !metadata) {
    return null;
  }

  const title = typeof metadata.title === "string" ? metadata.title : "";
  const description = typeof metadata.description === "string" ? metadata.description : "";
  const language = typeof metadata.language === "string" ? metadata.language : "";
  const skillId = typeof metadata.skillId === "string" ? metadata.skillId : "";
  const elements = Array.isArray(figure.elements) ? figure.elements : [];

  return {
    title: title.slice(0, 240),
    description: description.slice(0, 600),
    language,
    skillId,
    fit: reference?.fit ?? null,
    visibleText: collectVisibleText(elements).slice(0, 80)
  };
}

function collectVisibleText(elements: unknown[]): Array<{ id: string; text: string }> {
  const textItems: Array<{ id: string; text: string }> = [];

  for (const item of elements) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    if (record.type === "text" && typeof record.text === "string") {
      textItems.push({
        id: typeof record.id === "string" ? record.id.slice(0, 120) : "",
        text: record.text.trim().slice(0, 240)
      });
    }

    if (record.type === "group" && Array.isArray(record.children)) {
      textItems.push(...collectVisibleText(record.children));
    }

    if (textItems.length >= 80) {
      break;
    }
  }

  return textItems.filter((item) => item.text);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
