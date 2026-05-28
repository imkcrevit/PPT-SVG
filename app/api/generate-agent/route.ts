import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { persistGeneratedArtifacts } from "@/lib/generated-artifacts";
import { parseJsonObject } from "@/lib/json";
import { MAX_LAYOUT_AGENT_PASSES, reviewFigureLayout } from "@/lib/layout-review-agent";
import { recordConversation } from "@/lib/mongodb";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildContextCompressionMessages, buildGenerateMessages, buildRepairMessages, buildVisualRevisionMessages } from "@/lib/prompts";
import {
  beginGenerationGuard,
  checkGenerationAbuse,
  enforceGenerationContentLength,
  sanitizeUploadedAttachments,
  securityJson,
  validateGenerationPayload
} from "@/lib/request-security";
import { normalizeSessionId } from "@/lib/session";
import { getInternalSkill, isSkillId } from "@/lib/skills";
import { isLocale } from "@/lib/i18n";
import { reviewFigureLayoutVisually, type VisualLayoutReviewResult } from "@/lib/visual-layout-review-agent";
import type { Figure, FitAssessment, GenerateFigureRequest, GenerateFigureResponse, Locale, SkillId, UploadedAttachment } from "@/lib/types";

export const runtime = "nodejs";

const MAX_CONVERSATION_TURNS = 5;
const GENERATION_TIME_BUDGET_MS = 120_000;
const RESPONSE_SAFETY_BUFFER_MS = 2_500;
const CONTEXT_COMPRESSION_TIMEOUT_MS = 8_000;
const GENERATION_TIMEOUT_MS = 82_000;
const REPAIR_TIMEOUT_MS = 16_000;
const VISUAL_REVIEW_TIMEOUT_MS = 12_000;
const VISUAL_REGENERATION_TIMEOUT_MS = 24_000;
const GENERATION_MAX_COMPLETION_TOKENS = 8_000;
const REPAIR_MAX_COMPLETION_TOKENS = 10_000;
const MIN_VISUAL_REVIEW_REMAINING_MS = 15_000;
const MIN_VISUAL_REGENERATION_REMAINING_MS = 34_000;
const MAX_VISUAL_REGENERATION_PASSES = 1;

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

      try {
        const body = (await request.json()) as Partial<GenerateFigureRequest>;
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
          pptContext: body.pptContext,
          referenceFigure: normalizeReferenceFigure(body.referenceFigure),
          clientLog: normalizeClientLog(body.clientLog)
        };
        const skill = checked.skill;

        try {
          send(statusEvent(language, "queued", "Agent received the request.", 0));
          send(statusEvent(language, "compressing", "Compressing context.", 0));
          const compressedContext = await compressContext(generationRequest, safeTimeoutMs(startedAt, CONTEXT_COMPRESSION_TIMEOUT_MS));

          send(statusEvent(language, "generating", "Generating SVG JSON.", 0));
          const rawOutput = await callOpenRouter(await buildGenerateMessages(generationRequest, skill, compressedContext), {
            timeoutMs: requireTimeoutMs(startedAt, GENERATION_TIMEOUT_MS),
            maxCompletionTokens: GENERATION_MAX_COMPLETION_TOKENS
          });
          const generated = await validateOrRepair(rawOutput, generationRequest, language, send, startedAt, requestId);

          send(statusEvent(language, "reviewing", "Rendering and reviewing layout.", 1));
          const reviewedResponse = runLayoutAgent(generated.response, language, send);
          const visuallyReviewed = await runVisualReviewAndRegenerationAgent({
            response: reviewedResponse,
            request: generationRequest,
            skill,
            compressedContext,
            language,
            send,
            startedAt,
            requestId,
            fastReview: !generated.repaired
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
        } finally {
          generationGuard.release();
        }
      } catch (error) {
        const message = error instanceof OpenRouterError ? error.message : error instanceof Error ? error.message : "Unexpected generation error.";
        send({ type: "error", error: message, details: [`requestId: ${requestId}`] });
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
  send,
  startedAt,
  requestId,
  fastReview
}: {
  response: GenerateFigureResponse;
  request: GenerateFigureRequest;
  skill: NonNullable<ReturnType<typeof getInternalSkill>>;
  compressedContext: string;
  language: "en" | "zh";
  send: (event: Record<string, unknown>) => void;
  startedAt: number;
  requestId: string;
  fastReview: boolean;
}): Promise<{ response: GenerateFigureResponse; visualReview: VisualLayoutReviewResult }> {
  let current = response;
  let visualReview = await runSingleVisualReview(current, language, send, 0, startedAt);

  for (let pass = 1; pass <= MAX_VISUAL_REGENERATION_PASSES; pass += 1) {
    if (visualReview.ok || (visualReview.unavailable && visualReview.deterministicIssues.length === 0)) {
      return { response: current, visualReview };
    }

    if (fastReview && visualReview.deterministicIssues.length === 0) {
      return { response: current, visualReview };
    }

    if (remainingBudgetMs(startedAt) < MIN_VISUAL_REGENERATION_REMAINING_MS) {
      send({
        ...statusEvent(language, "visual_regeneration_skipped", "Skipping visual-feedback regeneration to keep the response under 120 seconds.", pass),
        issues: visualReview.issues.map((issue) => issue.message).slice(0, 6)
      });
      return { response: current, visualReview };
    }

    send({
      ...statusEvent(language, "visual_regenerating", `Regenerating from visual feedback, pass ${pass}.`, pass),
      issues: visualReview.issues.map((issue) => issue.message).slice(0, 6)
    });

    try {
      const rawOutput = await callOpenRouter(
        await buildVisualRevisionMessages(request, skill, current, visualReview, compressedContext, pass),
        {
          timeoutMs: requireTimeoutMs(startedAt, VISUAL_REGENERATION_TIMEOUT_MS),
          maxCompletionTokens: GENERATION_MAX_COMPLETION_TOKENS
        }
      );
      const revised = await validateOrRepair(rawOutput, request, language, send, startedAt, requestId);

      send(statusEvent(language, "reviewing", "Rendering and reviewing layout.", pass));
      current = runLayoutAgent(revised.response, language, send);
      visualReview = await runSingleVisualReview(current, language, send, pass, startedAt);
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
  pass: number,
  startedAt: number
): Promise<VisualLayoutReviewResult> {
  if (remainingBudgetMs(startedAt) < MIN_VISUAL_REVIEW_REMAINING_MS) {
    const skippedReview = buildSkippedVisualReview(response.figure, language);
    send({
      ...statusEvent(language, "visual_skipped", "Skipping multimodal review to keep the response under 120 seconds.", pass),
      issues: skippedReview.issues.map((issue) => issue.message).slice(0, 6)
    });
    return skippedReview;
  }

  if (response.figure.metadata.language === "zh") {
    const visualReview = await reviewFigureLayoutVisually(response.figure);
    send({
      ...statusEvent(
        language,
        visualReview.ok ? "visual_font_skipped" : "visual_flagged",
        visualReview.ok
          ? "Skipped image visual review for Chinese font rendering; deterministic layout review passed."
          : "Deterministic layout review found issues.",
        pass
      ),
      issues: visualReview.issues.map((issue) => issue.message).slice(0, 6)
    });
    return visualReview;
  }

  send(statusEvent(language, "visualizing", "Converting SVG to PNG for multimodal review.", pass));
  const visualReview = await reviewFigureLayoutVisually(response.figure, {
    timeoutMs: requireTimeoutMs(startedAt, VISUAL_REVIEW_TIMEOUT_MS)
  });

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

function buildSkippedVisualReview(figure: Figure, language: "en" | "zh"): VisualLayoutReviewResult {
  const deterministicIssues = reviewFigureLayout(figure).issues;

  return {
    ok: deterministicIssues.length === 0,
    score: deterministicIssues.length ? 0.72 : 0.9,
    summary:
      language === "zh"
        ? "已跳过多模态视觉检查以控制生成时间。"
        : "Multimodal visual review was skipped to keep generation within the time budget.",
    issues: deterministicIssues.slice(0, 8).map((message) => ({
      severity: "warning",
      message
    })),
    model: getConfiguredModelLabel(),
    deterministicIssues,
    unavailable: true
  };
}

async function validateOrRepair(
  rawOutput: string,
  request: GenerateFigureRequest,
  language: "en" | "zh",
  send: (event: Record<string, unknown>) => void,
  startedAt: number,
  requestId: string
): Promise<ValidatedGeneration> {
  const parsed = tryParseJsonObject(rawOutput);
  const validation = parsed.ok
    ? validateAndNormalizeFigureResponse(parsed.value, request.skillId, request.language)
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
  const repairedOutput = await callOpenRouter(await buildRepairMessages(rawOutput, validation.errors), {
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
      response: buildFallbackFigureResponse(request, requestId, repairedParsed.error),
      repaired: true,
      fallback: true
    };
  }

  const repairedValidation = validateAndNormalizeFigureResponse(repairedParsed.value, request.skillId, request.language);
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
      response: buildFallbackFigureResponse(request, requestId, repairedValidation.errors.join(" ")),
      repaired: true,
      fallback: true
    };
  }

  return { response: repairedValidation.response, repaired: true };
}

function buildFallbackFigureResponse(
  request: GenerateFigureRequest,
  requestId: string,
  reason: string
): GenerateFigureResponse {
  const zh = request.language === "zh";
  const title = compactTitle(request.userDescription, zh ? "系统架构图" : "System architecture");
  const labels = zh
    ? {
        title,
        description: `根据“${title}”生成的紧凑保底架构图。`,
        channels: "渠道接入",
        users: "用户端",
        staff: "柜台/运营",
        gateway: "API 网关",
        security: "认证授权",
        services: "业务服务",
        ticket: "售票服务",
        order: "订单服务",
        payment: "支付服务",
        data: "数据基础",
        database: "业务数据库",
        cache: "缓存",
        integration: "外部集成",
        fallbackNote: "模型返回的 JSON 被截断或无法修复，已生成紧凑保底版本。"
      }
    : {
        title,
        description: `Compact fallback architecture generated for "${title}".`,
        channels: "Channels",
        users: "Customer app",
        staff: "Staff console",
        gateway: "API gateway",
        security: "Auth & access",
        services: "Business services",
        ticket: "Ticketing",
        order: "Orders",
        payment: "Payments",
        data: "Data foundation",
        database: "Database",
        cache: "Cache",
        integration: "Integrations",
        fallbackNote: "The model returned truncated or unrecoverable JSON, so a compact fallback version was generated."
      };

  return {
    figure: {
      canvas: {
        width: 1280,
        height: 720,
        background: "#FFFFFF"
      },
      metadata: {
        title: labels.title,
        description: labels.description,
        skillId: request.skillId,
        language: request.language
      },
      elements: [
        {
          id: "main-panel",
          type: "rect",
          name: "Main panel",
          x: 70,
          y: 54,
          width: 1140,
          height: 612,
          rx: 20,
          fill: "#F8FAFC",
          stroke: "#D9E1EA",
          strokeWidth: 2
        },
        {
          id: "title",
          type: "text",
          name: "Title",
          x: 120,
          y: 78,
          width: 1040,
          height: 42,
          text: labels.title,
          fontSize: 30,
          fontWeight: 700,
          fill: "#0F172A",
          textAnchor: "middle"
        },
        textElement("label-channels", labels.channels, 115, 158, 92, 42, "#475569", 16, 700),
        textElement("label-gateway", labels.gateway, 115, 276, 92, 42, "#475569", 16, 700),
        textElement("label-services", labels.services, 115, 404, 92, 42, "#475569", 16, 700),
        textElement("label-data", labels.data, 115, 552, 92, 42, "#475569", 16, 700),
        ...card("users", labels.users, 230, 138, 210, 72, "#E0F2FE", "#38BDF8", "#075985"),
        ...card("staff", labels.staff, 500, 138, 210, 72, "#E0F2FE", "#38BDF8", "#075985"),
        ...card("integration", labels.integration, 770, 138, 210, 72, "#FEE2E2", "#F87171", "#991B1B"),
        ...card("gateway", labels.gateway, 340, 256, 360, 72, "#EEF2FF", "#818CF8", "#3730A3"),
        ...card("security", labels.security, 760, 256, 220, 72, "#FEF3C7", "#F59E0B", "#92400E"),
        ...card("ticket", labels.ticket, 230, 384, 210, 72, "#ECFDF5", "#34D399", "#065F46"),
        ...card("order", labels.order, 500, 384, 210, 72, "#ECFDF5", "#34D399", "#065F46"),
        ...card("payment", labels.payment, 770, 384, 210, 72, "#ECFDF5", "#34D399", "#065F46"),
        ...card("database", labels.database, 300, 532, 230, 72, "#F1F5F9", "#94A3B8", "#334155"),
        ...card("cache", labels.cache, 610, 532, 180, 72, "#F1F5F9", "#94A3B8", "#334155"),
        arrow("arrow-users-gateway", 335, 210, 460, 256),
        arrow("arrow-staff-gateway", 605, 210, 560, 256),
        arrow("arrow-integration-gateway", 770, 174, 700, 284),
        arrow("arrow-gateway-security", 700, 292, 760, 292),
        arrow("arrow-gateway-ticket", 430, 328, 335, 384),
        arrow("arrow-gateway-order", 520, 328, 605, 384),
        arrow("arrow-gateway-payment", 610, 328, 875, 384),
        arrow("arrow-ticket-data", 335, 456, 415, 532),
        arrow("arrow-order-data", 605, 456, 610, 532),
        arrow("arrow-payment-cache", 875, 456, 700, 532)
      ]
    },
    fit: {
      score: 0.68,
      note: `${labels.fallbackNote} requestId=${requestId}; reason=${reason.slice(0, 120)}`
    }
  };
}

function compactTitle(value: string, fallback: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return (trimmed || fallback).slice(0, 42);
}

function card(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  textFill: string
): GenerateFigureResponse["figure"]["elements"] {
  return [
    {
      id: `${id}-card`,
      type: "rect",
      name: `${id} card`,
      x,
      y,
      width,
      height,
      rx: 14,
      fill,
      stroke,
      strokeWidth: 2
    },
    textElement(`${id}-text`, text, x, y, width, height, textFill, 18, 700)
  ];
}

function textElement(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  fontSize: number,
  fontWeight: number
): GenerateFigureResponse["figure"]["elements"][number] {
  return {
    id,
    type: "text",
    name: id,
    x,
    y,
    width,
    height,
    text,
    fontSize,
    fontWeight,
    fill,
    textAnchor: "middle"
  };
}

function arrow(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): GenerateFigureResponse["figure"]["elements"][number] {
  return {
    id,
    type: "arrow",
    name: id,
    x1,
    y1,
    x2,
    y2,
    stroke: "#64748B",
    strokeWidth: 2
  };
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
    compressing: "正在压缩上下文。",
    generating: "正在生成 SVG JSON。",
    repairing: "正在修复生成的 JSON。",
    repair_fallback: "JSON 修复失败，正在使用紧凑保底图。",
    reviewing: "正在渲染并判定布局。",
    adjusting: `正在调整布局，第 ${pass} 次。`,
    review_passed: "布局判定通过。",
    review_stopped: "布局 Agent 已在 5 次调整后中断。",
    visualizing: "正在转成图片并进行多模态检查。",
    visual_skipped: "为控制在 120 秒内返回，已跳过多模态视觉检查。",
    visual_font_skipped: "服务器端中文字体不可用，已跳过图片视觉检查并保留布局检查。",
    visual_passed: "多模态视觉检查通过。",
    visual_flagged: "多模态视觉检查发现问题。",
    visual_regenerating: `正在根据视觉检查意见重新生成，第 ${pass} 次。`,
    visual_regeneration_skipped: "为控制在 120 秒内返回，已跳过视觉反馈重生成。",
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
  if (review.unavailable && review.deterministicIssues.length === 0) {
    return response;
  }

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

async function compressContext(request: GenerateFigureRequest, timeoutMs: number): Promise<string> {
  try {
    if (timeoutMs < 1000) {
      return fallbackContext(request);
    }

    const rawOutput = await callOpenRouter(await buildContextCompressionMessages(request), { timeoutMs });
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
