import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { persistGeneratedArtifacts } from "@/lib/generated-artifacts";
import { resolveDiagramMcpRoute } from "@/lib/diagram-mcp";
import { buildGenerationFallback } from "@/lib/generation-fallback";
import { reviewFigureLayout } from "@/lib/layout-review-agent";
import { parseJsonObject } from "@/lib/json";
import { recordConversation } from "@/lib/mongodb";
import { callOpenRouterWithUsage, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildContextCompressionMessages, buildGenerateMessages, buildRepairMessages } from "@/lib/prompts";
import {
  beginGenerationGuard,
  checkGenerationAbuse,
  enforceGenerationContentLength,
  readLimitedJson,
  sanitizeUploadedAttachments,
  securityJson,
  validateGenerationPayload
} from "@/lib/request-security";
import { MAX_GENERATION_JSON_BODY_BYTES } from "@/lib/file-limits";
import { normalizeSessionId } from "@/lib/session";
import { validateAndNormalizeSemanticResponse } from "@/lib/semantic-figure-pipeline";
import { resolveStyleContext } from "@/lib/theme-extract";
import { resolveThemeIntent } from "@/lib/theme-intent";
import { mergeTheme, normalizeThemeOverride } from "@/lib/theme";
import { createTokenUsageRecorder, normalizeTokenUsage, type TokenUsageSnapshot } from "@/lib/token-usage";
import { getInternalSkill, isSkillId } from "@/lib/skills";
import { isLocale } from "@/lib/i18n";
import type { ChatMessage } from "@/lib/prompts";
import type { Figure, FitAssessment, GenerateFigureRequest, GenerateFigureResponse, Locale, SkillId, UploadedAttachment } from "@/lib/types";

export const runtime = "nodejs";

const MAX_CONVERSATION_TURNS = 5;
const GENERATION_TIME_BUDGET_MS = 120_000;
const RESPONSE_SAFETY_BUFFER_MS = 2_500;
const CONTEXT_COMPRESSION_TIMEOUT_MS = 8_000;
const MCP_ROUTING_TIMEOUT_MS = 8_000;
const GENERATION_TIMEOUT_MS = 82_000;
const REPAIR_TIMEOUT_MS = 16_000;
const GENERATION_MAX_COMPLETION_TOKENS = 8_000;
const REPAIR_MAX_COMPLETION_TOKENS = 10_000;

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };
type ValidatedGeneration = { response: GenerateFigureResponse; repaired: boolean; fallback?: boolean };

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const contentLengthDecision = enforceGenerationContentLength(request);

  if (!contentLengthDecision.ok) {
    return securityJson(contentLengthDecision);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      let tokenRecorder: ReturnType<typeof createTokenUsageRecorder> | undefined;

      try {
        const parsed = await readLimitedJson(request, MAX_GENERATION_JSON_BODY_BYTES);
        if (!parsed.ok) {
          send({ type: "error", error: parsed.decision.error });
          return;
        }
        const body = (parsed.value ?? {}) as Partial<GenerateFigureRequest>;
        const checked = validateRequestBody(body);
        const language = body.language === "zh" ? "zh" : "en";
        const payloadDecision = validateGenerationPayload(body);

        if (!checked.ok) {
          send({ type: "error", error: checked.error });
          return;
        }

        if (!payloadDecision.ok) {
          send({ type: "error", error: payloadDecision.error });
          return;
        }

        const skillId = body.skillId as SkillId;
        const requestLanguage = body.language as Locale;
        const userDescription = body.userDescription?.trim() ?? "";
        const sessionId = normalizeSessionId(body.sessionId ?? body.conversationId);
        const abuseDecision = checkGenerationAbuse(request, sessionId);

        if (!abuseDecision.ok) {
          send({ type: "error", error: abuseDecision.error });
          return;
        }

        const generationGuard = beginGenerationGuard(request, sessionId);
        if (!generationGuard.ok) {
          send({ type: "error", error: generationGuard.error });
          return;
        }

        const generationRequest: GenerateFigureRequest = {
          skillId,
          userDescription,
          language: requestLanguage,
          sessionId,
          conversationId: typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : sessionId,
          conversationTurn: normalizeConversationTurn(body.conversationTurn),
          attachments: normalizeAttachments(body.attachments),
          themeOverride: normalizeThemeOverride(body.themeOverride),
          pptContext: body.pptContext,
          referenceFigure: normalizeReferenceFigure(body.referenceFigure),
          clientLog: normalizeClientLog(body.clientLog)
        };
        tokenRecorder = createTokenUsageRecorder({
          sessionId,
          conversationId: generationRequest.conversationId,
          conversationTurn: generationRequest.conversationTurn,
          requestId
        });

        try {
          send(statusEvent(language, "queued", "Agent received the request.", 0));
          send(statusEvent(language, "routing", "Selecting the matching MCP diagram tool.", 0));
          const routing = await resolveDiagramMcpRoute(generationRequest, async (messages, tools) => {
            const result = await callTrackedOpenRouterResult(tokenRecorder!, "mcp-routing", messages, {
              temperature: 0,
              maxCompletionTokens: 200,
              responseFormat: null,
              timeoutMs: requireTimeoutMs(startedAt, MCP_ROUTING_TIMEOUT_MS),
              tools,
              toolChoice: "required"
            });
            return result.toolCalls;
          });
          generationRequest.skillId = routing.skillId;
          const skill = getInternalSkill(routing.skillId);
          if (!skill) {
            throw new Error(`MCP routed to unknown internal skill: ${routing.skillId}`);
          }
          // First-turn requests without reference material do not need an extra
          // model round-trip for context compression.
          const needsCompression =
            (generationRequest.conversationTurn ?? 1) > 1 ||
            Boolean(generationRequest.referenceFigure) ||
            (generationRequest.attachments?.length ?? 0) > 0;
          let compressedContext = generationRequest.userDescription;

          if (needsCompression) {
            send(statusEvent(language, "compressing", "Compressing context.", 0));
            compressedContext = await compressContext(
              generationRequest,
              safeTimeoutMs(startedAt, CONTEXT_COMPRESSION_TIMEOUT_MS),
              tokenRecorder
            );
          }

          send(statusEvent(language, "generating", "Generating semantic diagram JSON.", 0));
          const rawOutput = await callTrackedOpenRouter(tokenRecorder, "generate", await buildGenerateMessages(generationRequest, skill, compressedContext), {
            timeoutMs: requireTimeoutMs(startedAt, GENERATION_TIMEOUT_MS),
            maxCompletionTokens: GENERATION_MAX_COMPLETION_TOKENS
          });
          const generated = await validateOrRepair(rawOutput, generationRequest, language, send, startedAt, requestId, tokenRecorder);

          // The semantic layout engine is deterministic. The old geometric
          // cleanup and visual regeneration passes were built for model-placed
          // coordinates and can distort the compiled layout.
          const finalResponse = generated.response;

          send(statusEvent(language, "persisting", "Saving session artifacts.", 0));
          const tokenUsage = await tokenRecorder.snapshot();
          const layoutReview = reviewFigureLayout(finalResponse.figure);
          const artifacts = await persistGeneratedArtifacts(finalResponse.figure, finalResponse.fit, requestId, sessionId, layoutReview, {
            userDescription: generationRequest.userDescription,
            conversationTurn: generationRequest.conversationTurn,
            attachmentCount: generationRequest.attachments?.length ?? 0,
            imageAttachmentCount: countImageAttachments(generationRequest.attachments),
            tokenUsage
          });
          await recordCompletedConversation({
            request: generationRequest,
            requestId,
            response: finalResponse,
            compressedContext,
            artifacts,
            tokenUsage,
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
              artifacts,
              routing,
              context: { compressed: compressedContext }
            }
          });
        } finally {
          generationGuard.release();
        }
      } catch (error) {
        const message = error instanceof OpenRouterError ? error.message : error instanceof Error ? error.message : "Unexpected generation error.";
        send({ type: "error", error: message, details: [`requestId: ${requestId}`] });
        const tokenUsage = tokenRecorder ? await tokenRecorder.snapshot() : undefined;
        await recordConversation({
          requestId,
          language: "unknown",
          skillId: "unknown",
          userDescription: "",
          attachments: [],
          tokenUsage,
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

async function validateOrRepair(
  rawOutput: string,
  request: GenerateFigureRequest,
  language: "en" | "zh",
  send: (event: Record<string, unknown>) => void,
  startedAt: number,
  requestId: string,
  tokenRecorder: ReturnType<typeof createTokenUsageRecorder>
): Promise<ValidatedGeneration> {
  const { theme: sessionTheme, detectedBackground } = await resolveStyleContext(request.attachments);
  const intent = await resolveThemeIntent(
    request.userDescription,
    { detectedBackground },
    (msgs) => callTrackedOpenRouter(tokenRecorder, "theme-intent", msgs as ChatMessage[])
  );
  const override = { ...(request.themeOverride ?? {}), ...(intent ?? {}) };
  const requestedTheme = mergeTheme(sessionTheme, Object.keys(override).length ? override : undefined);
  const parsed = tryParseJsonObject(rawOutput);
  const validation = parsed.ok
    ? validateAndNormalizeSemanticResponse(parsed.value, request.skillId, request.language, requestedTheme)
    : {
        ok: false,
        errors: [`Model returned invalid JSON: ${parsed.error}`]
      };

  if (validation.ok && validation.response) {
    return { response: validation.response, repaired: false };
  }

  console.warn(`[generate:${requestId}] generated JSON validation failed`, {
    parseError: parsed.ok ? undefined : parsed.error,
    errors: validation.errors.slice(0, 10),
    rawLength: rawOutput.length
  });
  await writeFailureDebugArtifact(requestId, "generated-validation-failed", request, {
    parseError: parsed.ok ? undefined : parsed.error,
    validationErrors: validation.errors,
    rawOutput
  });

  send(statusEvent(language, "repairing", "Repairing generated JSON.", 0));
  const repairedOutput = await callTrackedOpenRouter(tokenRecorder, "repair", await buildRepairMessages(rawOutput, validation.errors), {
    timeoutMs: requireTimeoutMs(startedAt, REPAIR_TIMEOUT_MS),
    maxCompletionTokens: REPAIR_MAX_COMPLETION_TOKENS
  });
  const repairedParsed = tryParseJsonObject(repairedOutput);

  if (!repairedParsed.ok) {
    console.warn(`[generate:${requestId}] repair returned invalid JSON`, {
      error: repairedParsed.error,
      rawLength: rawOutput.length,
      repairedLength: repairedOutput.length
    });
    await writeFailureDebugArtifact(requestId, "repair-parse-failed", request, {
      initialParseError: parsed.ok ? undefined : parsed.error,
      initialValidationErrors: validation.errors,
      repairParseError: repairedParsed.error,
      rawOutput,
      repairedOutput
    });
    send(statusEvent(language, "repair_fallback", "Repair failed; using a compact fallback figure.", 0));
    return {
      response: buildGenerationFallback(request, requestId, repairedParsed.error),
      repaired: true,
      fallback: true
    };
  }

  const repairedValidation = validateAndNormalizeSemanticResponse(repairedParsed.value, request.skillId, request.language, requestedTheme);
  if (!repairedValidation.ok || !repairedValidation.response) {
    console.warn(`[generate:${requestId}] repair validation failed`, {
      errors: repairedValidation.errors.slice(0, 10),
      repairedLength: repairedOutput.length
    });
    await writeFailureDebugArtifact(requestId, "repair-validation-failed", request, {
      initialParseError: parsed.ok ? undefined : parsed.error,
      initialValidationErrors: validation.errors,
      repairValidationErrors: repairedValidation.errors,
      rawOutput,
      repairedOutput
    });
    send(statusEvent(language, "repair_fallback", "Repair failed; using a compact fallback figure.", 0));
    return {
      response: buildGenerationFallback(request, requestId, repairedValidation.errors.join(" ")),
      repaired: true,
      fallback: true
    };
  }

  return { response: repairedValidation.response, repaired: true };
}

async function writeFailureDebugArtifact(
  requestId: string,
  stage: string,
  request: GenerateFigureRequest,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const directory = path.join("/tmp", "ppt-svg", "failures");
    const filePath = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${requestId}-${stage}.json`);

    await mkdir(directory, { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          requestId,
          stage,
          createdAt: new Date().toISOString(),
          request: {
            sessionId: request.sessionId,
            conversationId: request.conversationId,
            conversationTurn: request.conversationTurn,
            language: request.language,
            skillId: request.skillId,
            userDescription: request.userDescription,
            attachmentCount: request.attachments?.length ?? 0,
            hasReferenceFigure: Boolean(request.referenceFigure)
          },
          payload: truncateDebugPayload(payload)
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    console.warn(`[generate:${requestId}] wrote failure debug artifact`, { stage, filePath });
  } catch (error) {
    console.warn(`[generate:${requestId}] failed to write failure debug artifact`, {
      stage,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function truncateDebugPayload(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 50_000 ? `${value.slice(0, 50_000)}\n...[truncated ${value.length - 50_000} chars]` : value;
  }

  if (Array.isArray(value)) {
    return value.map(truncateDebugPayload);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, truncateDebugPayload(item)])
    );
  }

  return value;
}

function remainingBudgetMs(startedAt: number): number {
  return Math.max(0, GENERATION_TIME_BUDGET_MS - (Date.now() - startedAt) - RESPONSE_SAFETY_BUFFER_MS);
}

function safeTimeoutMs(startedAt: number, maxMs: number): number {
  return Math.max(0, Math.min(maxMs, remainingBudgetMs(startedAt)));
}

function requireTimeoutMs(startedAt: number, maxMs: number): number {
  const timeoutMs = safeTimeoutMs(startedAt, maxMs);

  if (timeoutMs < 1000) {
    throw new Error("Generation exceeded the 120s time budget before the final response could be prepared.");
  }

  return timeoutMs;
}

function statusEvent(language: "en" | "zh", code: string, english: string, pass: number) {
  const zh: Record<string, string> = {
    queued: "Agent 已收到请求。",
    routing: "正在选择匹配的 MCP 图形工具。",
    compressing: "正在压缩上下文。",
    generating: "正在生成语义图 JSON。",
    repairing: "正在修复生成的 JSON。",
    repair_fallback: "JSON 修复失败，正在使用紧凑保底图。",
    persisting: "正在保存 session 产物。"
  };

  return {
    type: "status",
    code,
    pass,
    maxPasses: 0,
    message: language === "zh" ? zh[code] ?? english : english
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

async function compressContext(
  request: GenerateFigureRequest,
  timeoutMs: number,
  tokenRecorder: ReturnType<typeof createTokenUsageRecorder>
): Promise<string> {
  try {
    if (timeoutMs < 1000) {
      return fallbackContext(request);
    }

    const rawOutput = await callTrackedOpenRouter(tokenRecorder, "context-compression", await buildContextCompressionMessages(request), {
      timeoutMs
    });
    const parsed = parseJsonObject(rawOutput) as Record<string, unknown>;
    const compressed = typeof parsed.compressed_context === "string" ? parsed.compressed_context.trim() : "";

    if (compressed) {
      return compressed.slice(0, 6000);
    }
  } catch (error) {
    console.warn("[context-compression] failed", { message: error instanceof Error ? error.message : String(error) });
  }

  return fallbackContext(request);
}

async function callTrackedOpenRouter(
  tokenRecorder: ReturnType<typeof createTokenUsageRecorder>,
  operation: string,
  messages: ChatMessage[],
  options: Parameters<typeof callOpenRouterWithUsage>[1] = {}
): Promise<string> {
  const result = await callTrackedOpenRouterResult(tokenRecorder, operation, messages, options);
  return result.text;
}

async function callTrackedOpenRouterResult(
  tokenRecorder: ReturnType<typeof createTokenUsageRecorder>,
  operation: string,
  messages: ChatMessage[],
  options: Parameters<typeof callOpenRouterWithUsage>[1] = {}
): Promise<Awaited<ReturnType<typeof callOpenRouterWithUsage>>> {
  const result = await callOpenRouterWithUsage(messages, options);
  await tokenRecorder.record({
    operation,
    usage: normalizeTokenUsage(result.usage),
    model: result.model,
    generationId: result.generationId
  });
  return result;
}

function fallbackContext(request: GenerateFigureRequest): string {
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
  return sanitizeUploadedAttachments(value);
}

function countImageAttachments(attachments?: UploadedAttachment[]): number {
  return (
    attachments?.filter((attachment) => {
      const extension = attachment.extension.toLowerCase();
      return (
        (extension === "png" || extension === "jpg" || extension === "jpeg") &&
        (attachment.mimeType === "image/png" || attachment.mimeType === "image/jpeg")
      );
    }).length ?? 0
  );
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
  artifacts,
  tokenUsage,
  durationMs
}: {
  request: GenerateFigureRequest;
  requestId: string;
  response: GenerateFigureResponse;
  compressedContext: string;
  artifacts: unknown;
  tokenUsage?: TokenUsageSnapshot;
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
    artifacts,
    tokenUsage,
    model: getConfiguredModelLabel(),
    status: "completed",
    durationMs
  });
}
