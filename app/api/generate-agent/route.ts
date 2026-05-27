import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { persistGeneratedArtifacts } from "@/lib/generated-artifacts";
import { parseJsonObject } from "@/lib/json";
import { MAX_LAYOUT_AGENT_PASSES, reviewFigureLayout } from "@/lib/layout-review-agent";
import { recordConversation } from "@/lib/mongodb";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildContextCompressionMessages, buildGenerateMessages, buildRepairMessages, buildVisualRevisionMessages } from "@/lib/prompts";
import { normalizeSessionId } from "@/lib/session";
import { getInternalSkill, isSkillId } from "@/lib/skills";
import { isLocale } from "@/lib/i18n";
import { reviewFigureLayoutVisually, type VisualLayoutReviewResult } from "@/lib/visual-layout-review-agent";
import type { Figure, FitAssessment, GenerateFigureRequest, GenerateFigureResponse, Locale, SkillId, UploadedAttachment } from "@/lib/types";

export const runtime = "nodejs";

const MAX_CONVERSATION_TURNS = 5;
const MAX_VISUAL_REGENERATION_PASSES = 2;

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const body = (await request.json()) as Partial<GenerateFigureRequest>;
        const checked = validateRequestBody(body);
        const language = body.language === "zh" ? "zh" : "en";

        if (!checked.ok) {
          send({ type: "error", error: checked.error });
          return;
        }

        const skillId = body.skillId as SkillId;
        const requestLanguage = body.language as Locale;
        const userDescription = body.userDescription?.trim() ?? "";
        const sessionId = normalizeSessionId(body.sessionId ?? body.conversationId);
        const generationRequest: GenerateFigureRequest = {
          skillId,
          userDescription,
          language: requestLanguage,
          sessionId,
          conversationId: typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : sessionId,
          conversationTurn: normalizeConversationTurn(body.conversationTurn),
          attachments: normalizeAttachments(body.attachments),
          pptContext: body.pptContext,
          referenceFigure: normalizeReferenceFigure(body.referenceFigure),
          clientLog: normalizeClientLog(body.clientLog)
        };
        const skill = checked.skill;

        send(statusEvent(language, "queued", "Agent received the request.", 0));
        send(statusEvent(language, "compressing", "Compressing context.", 0));
        const compressedContext = await compressContext(generationRequest);

        send(statusEvent(language, "generating", "Generating SVG JSON.", 0));
        const rawOutput = await callOpenRouter(await buildGenerateMessages(generationRequest, skill, compressedContext));
        const response = await validateOrRepair(rawOutput, generationRequest, language, send);

        send(statusEvent(language, "reviewing", "Rendering and reviewing layout.", 1));
        const reviewedResponse = runLayoutAgent(response, language, send);
        const visuallyReviewed = await runVisualReviewAndRegenerationAgent({
          response: reviewedResponse,
          request: generationRequest,
          skill,
          compressedContext,
          language,
          send
        });
        const finalResponse = applyVisualReviewToResponse(visuallyReviewed.response, visuallyReviewed.visualReview, language);

        send(statusEvent(language, "persisting", "Saving session artifacts.", MAX_LAYOUT_AGENT_PASSES));
        const artifacts = await persistGeneratedArtifacts(finalResponse.figure, finalResponse.fit, requestId, sessionId, visuallyReviewed.visualReview);
        await recordCompletedConversation({
          request: generationRequest,
          requestId,
          response: finalResponse,
          compressedContext,
          layoutReview: visuallyReviewed.visualReview,
          artifacts,
          durationMs: Date.now() - startedAt
        });

        send({
          type: "final",
          payload: {
            ...finalResponse,
            requestId,
            sessionId,
            conversationTurn: generationRequest.conversationTurn,
            model: getConfiguredModelLabel(),
            layoutReview: visuallyReviewed.visualReview,
            artifacts,
            context: { compressed: compressedContext }
          }
        });
      } catch (error) {
        const message = error instanceof OpenRouterError ? error.message : error instanceof Error ? error.message : "Unexpected generation error.";
        send({ type: "error", error: message });
        await recordConversation({
          requestId,
          language: "unknown",
          skillId: "unknown",
          userDescription: "",
          attachments: [],
          status: "failed",
          error: message,
          durationMs: Date.now() - startedAt
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}

async function runVisualReviewAndRegenerationAgent({
  response,
  request,
  skill,
  compressedContext,
  language,
  send
}: {
  response: GenerateFigureResponse;
  request: GenerateFigureRequest;
  skill: NonNullable<ReturnType<typeof getInternalSkill>>;
  compressedContext: string;
  language: "en" | "zh";
  send: (event: Record<string, unknown>) => void;
}): Promise<{ response: GenerateFigureResponse; visualReview: VisualLayoutReviewResult }> {
  let current = response;
  let visualReview = await runSingleVisualReview(current, language, send, 0);

  for (let pass = 1; pass <= MAX_VISUAL_REGENERATION_PASSES; pass += 1) {
    if (visualReview.ok || (visualReview.unavailable && visualReview.deterministicIssues.length === 0)) {
      return { response: current, visualReview };
    }

    send({
      ...statusEvent(language, "visual_regenerating", `Regenerating from visual feedback, pass ${pass}.`, pass),
      issues: visualReview.issues.map((issue) => issue.message).slice(0, 6)
    });

    try {
      const rawOutput = await callOpenRouter(
        await buildVisualRevisionMessages(request, skill, current, visualReview, compressedContext, pass)
      );
      const revised = await validateOrRepair(rawOutput, request, language, send);

      send(statusEvent(language, "reviewing", "Rendering and reviewing layout.", pass));
      current = runLayoutAgent(revised, language, send);
      visualReview = await runSingleVisualReview(current, language, send, pass);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send({
        ...statusEvent(language, "visual_regeneration_failed", "Visual-feedback regeneration failed; keeping the last render.", pass),
        issues: [message]
      });
      return { response: current, visualReview };
    }
  }

  return { response: current, visualReview };
}

async function runSingleVisualReview(
  response: GenerateFigureResponse,
  language: "en" | "zh",
  send: (event: Record<string, unknown>) => void,
  pass: number
): Promise<VisualLayoutReviewResult> {
  send(statusEvent(language, "visualizing", "Converting SVG to PNG for multimodal review.", pass));
  const visualReview = await reviewFigureLayoutVisually(response.figure);

  send({
    ...statusEvent(
      language,
      visualReview.ok ? "visual_passed" : "visual_flagged",
      visualReview.ok ? "Visual layout review passed." : "Visual layout review found issues.",
      pass
    ),
    issues: visualReview.issues.map((issue) => issue.message).slice(0, 6)
  });

  return visualReview;
}

function runLayoutAgent(
  response: GenerateFigureResponse,
  language: "en" | "zh",
  send: (event: Record<string, unknown>) => void
): GenerateFigureResponse {
  let current = response;

  for (let pass = 1; pass <= MAX_LAYOUT_AGENT_PASSES; pass += 1) {
    const review = reviewFigureLayout(current.figure);
    send({
      ...statusEvent(
        language,
        review.ok ? "review_passed" : "adjusting",
        review.ok ? "Layout review passed." : `Adjusting layout pass ${pass}.`,
        pass
      ),
      issues: review.issues.slice(0, 6)
    });

    if (review.ok) {
      return current;
    }

    const validation = validateAndNormalizeFigureResponse({ figure: current.figure, fit: current.fit }, current.figure.metadata.skillId, current.figure.metadata.language);
    if (!validation.ok || !validation.response) {
      return current;
    }

    current = validation.response;
  }

  send({
    ...statusEvent(language, "review_stopped", "Layout agent stopped after 5 passes.", MAX_LAYOUT_AGENT_PASSES),
    issues: reviewFigureLayout(current.figure).issues.slice(0, 6)
  });
  return current;
}

async function validateOrRepair(
  rawOutput: string,
  request: GenerateFigureRequest,
  language: "en" | "zh",
  send: (event: Record<string, unknown>) => void
): Promise<GenerateFigureResponse> {
  const parsed = tryParseJsonObject(rawOutput);
  const validation = parsed.ok
    ? validateAndNormalizeFigureResponse(parsed.value, request.skillId, request.language)
    : {
        ok: false,
        errors: [`Model returned invalid JSON: ${parsed.error}`]
      };

  if (validation.ok && validation.response) {
    return validation.response;
  }

  send(statusEvent(language, "repairing", "Repairing generated JSON.", 0));
  const repairedOutput = await callOpenRouter(await buildRepairMessages(rawOutput, validation.errors));
  const repairedParsed = tryParseJsonObject(repairedOutput);

  if (!repairedParsed.ok) {
    throw new Error("Model response could not be converted into valid Figure JSON.");
  }

  const repairedValidation = validateAndNormalizeFigureResponse(repairedParsed.value, request.skillId, request.language);
  if (!repairedValidation.ok || !repairedValidation.response) {
    throw new Error(repairedValidation.errors.join(" ") || "Model response could not be converted into valid Figure JSON.");
  }

  return repairedValidation.response;
}

function statusEvent(language: "en" | "zh", code: string, english: string, pass: number) {
  const zh: Record<string, string> = {
    queued: "Agent 已收到请求。",
    compressing: "正在压缩上下文。",
    generating: "正在生成 SVG JSON。",
    repairing: "正在修复生成的 JSON。",
    reviewing: "正在渲染并判定布局。",
    adjusting: `正在调整布局，第 ${pass} 次。`,
    review_passed: "布局判定通过。",
    review_stopped: "布局 Agent 已在 5 次调整后中断。",
    visualizing: "正在转成图片并进行多模态检查。",
    visual_passed: "多模态视觉检查通过。",
    visual_flagged: "多模态视觉检查发现问题。",
    visual_regenerating: `正在根据视觉检查意见重新生成，第 ${pass} 次。`,
    visual_regeneration_failed: "按视觉意见重新生成失败，保留上一版。",
    persisting: "正在保存 session 产物。"
  };

  return {
    type: "status",
    code,
    pass,
    maxPasses: MAX_LAYOUT_AGENT_PASSES,
    message: language === "zh" ? zh[code] ?? english : english
  };
}

function applyVisualReviewToResponse(
  response: GenerateFigureResponse,
  review: VisualLayoutReviewResult,
  language: "en" | "zh"
): GenerateFigureResponse {
  const prefix = language === "zh" ? "视觉检查" : "Visual review";
  const verdict =
    review.unavailable
      ? language === "zh"
        ? "未完成"
        : "unavailable"
      : review.ok
        ? language === "zh"
          ? "通过"
          : "passed"
        : language === "zh"
          ? "需复核"
          : "needs review";
  const visualNote = `${prefix}: ${verdict}. ${review.summary}`.slice(0, 240);
  const existingNote = response.fit.note.trim();
  const reviewScore = review.unavailable
    ? review.deterministicIssues.length
      ? Math.min(response.fit.score, 0.72)
      : response.fit.score
    : Math.min(response.fit.score, review.score);

  return {
    ...response,
    fit: {
      score: reviewScore,
      note: existingNote ? `${existingNote} ${visualNote}`.slice(0, 360) : visualNote
    }
  };
}

type RequestValidation =
  | { ok: true; skill: NonNullable<ReturnType<typeof getInternalSkill>> }
  | { ok: false; error: string };

function validateRequestBody(body: Partial<GenerateFigureRequest>): RequestValidation {
  if (!body.skillId || !isSkillId(body.skillId)) {
    return { ok: false, error: "Invalid skillId." };
  }

  if (!body.language || !isLocale(body.language)) {
    return { ok: false, error: "Invalid language." };
  }

  if (!body.userDescription?.trim()) {
    return { ok: false, error: "userDescription is required." };
  }

  const conversationTurn = normalizeConversationTurn(body.conversationTurn);
  if (conversationTurn > MAX_CONVERSATION_TURNS) {
    return { ok: false, error: `Each conversation supports at most ${MAX_CONVERSATION_TURNS} generation turns.` };
  }

  const skill = getInternalSkill(body.skillId);
  if (!skill) {
    return { ok: false, error: "Unknown internal skill." };
  }

  return { ok: true, skill };
}

function tryParseJsonObject(content: string): ParseResult {
  try {
    return { ok: true, value: parseJsonObject(content) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown JSON parse error."
    };
  }
}

async function compressContext(request: GenerateFigureRequest): Promise<string> {
  try {
    const rawOutput = await callOpenRouter(await buildContextCompressionMessages(request));
    const parsed = parseJsonObject(rawOutput) as Record<string, unknown>;
    const compressed = typeof parsed.compressed_context === "string" ? parsed.compressed_context.trim() : "";

    if (compressed) {
      return compressed.slice(0, 6000);
    }
  } catch (error) {
    console.warn("[context-compression] failed", { message: error instanceof Error ? error.message : String(error) });
  }

  return [
    request.userDescription,
    request.referenceFigure
      ? `Reference current render: ${JSON.stringify({
          title: request.referenceFigure.figure.metadata.title,
          description: request.referenceFigure.figure.metadata.description,
          fit: request.referenceFigure.fit,
          figure: request.referenceFigure.figure
        })}`
      : "",
    ...(request.attachments?.map(
      (attachment) =>
        `Attachment: ${attachment.originalName} (${attachment.extension}, sha256=${attachment.hash}, path=${attachment.path})${attachment.extractedText ? `\n${attachment.extractedText}` : ""}`
    ) ?? [])
  ]
    .join("\n\n")
    .slice(0, 6000);
}

function normalizeConversationTurn(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeAttachments(value: unknown): UploadedAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): UploadedAttachment | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }

      const record = item as Record<string, unknown>;

      if (
        typeof record.id !== "string" ||
        typeof record.originalName !== "string" ||
        typeof record.hash !== "string" ||
        typeof record.extension !== "string" ||
        typeof record.mimeType !== "string" ||
        typeof record.size !== "number" ||
        typeof record.path !== "string"
      ) {
        return undefined;
      }

      return {
        id: record.id,
        originalName: record.originalName,
        hash: record.hash,
        extension: record.extension,
        mimeType: record.mimeType,
        size: record.size,
        path: record.path,
        extractedText: typeof record.extractedText === "string" ? record.extractedText : undefined
      };
    })
    .filter((attachment): attachment is UploadedAttachment => Boolean(attachment));
}

function normalizeReferenceFigure(value: unknown): GenerateFigureRequest["referenceFigure"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.source !== "current-render" || !record.figure || typeof record.figure !== "object") {
    return undefined;
  }

  return {
    source: "current-render",
    figure: record.figure as Figure,
    fit:
      record.fit && typeof record.fit === "object"
        ? (record.fit as FitAssessment)
        : record.fit === null
          ? null
          : undefined
  };
}

function normalizeClientLog(value: unknown): GenerateFigureRequest["clientLog"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return {
    messageId: typeof record.messageId === "string" ? record.messageId : undefined,
    sentAt: typeof record.sentAt === "string" ? record.sentAt : undefined
  };
}

async function recordCompletedConversation({
  request,
  requestId,
  response,
  compressedContext,
  layoutReview,
  artifacts,
  durationMs
}: {
  request: GenerateFigureRequest;
  requestId: string;
  response: GenerateFigureResponse;
  compressedContext: string;
  layoutReview?: VisualLayoutReviewResult;
  artifacts: unknown;
  durationMs: number;
}) {
  await recordConversation({
    sessionId: request.sessionId,
    conversationId: request.conversationId,
    conversationTurn: request.conversationTurn,
    requestId,
    language: request.language,
    skillId: request.skillId,
    userDescription: request.userDescription,
    compressedContext,
    attachments: request.attachments ?? [],
    referenceFigure: request.referenceFigure,
    clientLog: request.clientLog,
    figure: response.figure,
    fit: response.fit,
    layoutReview,
    artifacts,
    model: getConfiguredModelLabel(),
    status: "completed",
    durationMs
  });
}
