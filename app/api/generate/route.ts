import { NextResponse } from "next/server";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { persistGeneratedArtifacts } from "@/lib/generated-artifacts";
import { parseJsonObject } from "@/lib/json";
import { recordConversation } from "@/lib/mongodb";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildContextCompressionMessages, buildGenerateMessages, buildRepairMessages } from "@/lib/prompts";
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
import type { Figure, FitAssessment, GenerateFigureRequest, GenerateFigureResponse, UploadedAttachment } from "@/lib/types";

export const runtime = "nodejs";

const MAX_CONVERSATION_TURNS = 5;

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  let releaseGeneration: (() => void) | undefined;
  const contentLengthDecision = enforceGenerationContentLength(request);

  if (!contentLengthDecision.ok) {
    return securityJson(contentLengthDecision);
  }

  try {
    const body = (await request.json()) as Partial<GenerateFigureRequest>;
    const payloadDecision = validateGenerationPayload(body);

    if (!payloadDecision.ok) {
      return securityJson(payloadDecision);
    }

    if (!body.skillId || !isSkillId(body.skillId)) {
      console.warn(`[generate:${requestId}] rejected invalid skillId`, { skillId: body.skillId });
      return NextResponse.json({ error: "Invalid skillId." }, { status: 400 });
    }

    if (!body.language || !isLocale(body.language)) {
      console.warn(`[generate:${requestId}] rejected invalid language`, { language: body.language });
      return NextResponse.json({ error: "Invalid language." }, { status: 400 });
    }

    if (!body.userDescription?.trim()) {
      console.warn(`[generate:${requestId}] rejected empty description`);
      return NextResponse.json({ error: "userDescription is required." }, { status: 400 });
    }

    const skill = getInternalSkill(body.skillId);
    if (!skill) {
      console.warn(`[generate:${requestId}] rejected unknown internal skill`, { skillId: body.skillId });
      return NextResponse.json({ error: "Unknown internal skill." }, { status: 400 });
    }

    const conversationTurn = normalizeConversationTurn(body.conversationTurn);
    if (conversationTurn > MAX_CONVERSATION_TURNS) {
      console.warn(`[generate:${requestId}] rejected over turn limit`, { conversationTurn });
      return NextResponse.json(
        { error: `Each conversation supports at most ${MAX_CONVERSATION_TURNS} generation turns.` },
        { status: 400 }
      );
    }

    const sessionId = normalizeSessionId(body.sessionId ?? body.conversationId);
    const abuseDecision = checkGenerationAbuse(request, sessionId);
    if (!abuseDecision.ok) {
      return securityJson(abuseDecision);
    }

    const generationGuard = beginGenerationGuard(request, sessionId);
    if (!generationGuard.ok) {
      return securityJson(generationGuard);
    }
    releaseGeneration = generationGuard.release;

    const generationRequest: GenerateFigureRequest = {
      skillId: body.skillId,
      userDescription: body.userDescription.trim(),
      language: body.language,
      sessionId,
      conversationId: typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : sessionId,
      conversationTurn,
      attachments: normalizeAttachments(body.attachments),
      pptContext: body.pptContext,
      referenceFigure: normalizeReferenceFigure(body.referenceFigure),
      clientLog: normalizeClientLog(body.clientLog)
    };

    console.info(`[generate:${requestId}] started`, {
      skillId: generationRequest.skillId,
      language: generationRequest.language,
      sessionId: generationRequest.sessionId,
      conversationId: generationRequest.conversationId,
      conversationTurn: generationRequest.conversationTurn,
      descriptionLength: generationRequest.userDescription.length,
      hasPptContext: Boolean(generationRequest.pptContext),
      hasReferenceFigure: Boolean(generationRequest.referenceFigure),
      attachmentCount: generationRequest.attachments?.length ?? 0
    });

    const compressedContext = await compressContext(generationRequest);
    const rawOutput = await callOpenRouter(await buildGenerateMessages(generationRequest, skill, compressedContext));
    const parsed = tryParseJsonObject(rawOutput);
    const validation = parsed.ok
      ? validateAndNormalizeFigureResponse(parsed.value, body.skillId, body.language)
      : {
          ok: false,
          errors: [`Model returned invalid JSON: ${parsed.error}`]
        };

    if (validation.ok && validation.response) {
      const artifacts = await persistGeneratedArtifacts(validation.response.figure, validation.response.fit, requestId, sessionId);
      await recordCompletedConversation({
        request: generationRequest,
        requestId,
        response: validation.response,
        compressedContext,
        artifacts,
        durationMs: Date.now() - startedAt
      });
      console.info(`[generate:${requestId}] completed`, {
        durationMs: Date.now() - startedAt,
        repaired: false,
        svgPath: artifacts.svgPath
      });
      return NextResponse.json({
        ...validation.response,
        requestId,
        sessionId,
        conversationTurn,
        model: getConfiguredModelLabel(),
        artifacts,
        context: { compressed: compressedContext }
      });
    }

    const repairedOutput = await callOpenRouter(await buildRepairMessages(rawOutput, validation.errors));
    const repairedParsed = tryParseJsonObject(repairedOutput);

    if (!repairedParsed.ok) {
      console.warn(`[generate:${requestId}] repair returned invalid JSON`, {
        durationMs: Date.now() - startedAt,
        error: repairedParsed.error
      });
      return NextResponse.json(
        {
          error: "Model response could not be converted into valid Figure JSON.",
          details: ["The model returned malformed JSON and automatic repair did not produce a usable figure."]
        },
        { status: 502 }
      );
    }

    const repairedValidation = validateAndNormalizeFigureResponse(repairedParsed.value, body.skillId, body.language);

    if (!repairedValidation.ok || !repairedValidation.response) {
      console.warn(`[generate:${requestId}] repair failed`, {
        durationMs: Date.now() - startedAt,
        errors: repairedValidation.errors
      });
      return NextResponse.json(
        {
          error: "Model response could not be converted into valid Figure JSON.",
          details: repairedValidation.errors
        },
        { status: 502 }
      );
    }

    const artifacts = await persistGeneratedArtifacts(
      repairedValidation.response.figure,
      repairedValidation.response.fit,
      requestId,
      sessionId
    );
    await recordCompletedConversation({
      request: generationRequest,
      requestId,
      response: repairedValidation.response,
      compressedContext,
      artifacts,
      durationMs: Date.now() - startedAt
    });
    console.info(`[generate:${requestId}] completed`, {
      durationMs: Date.now() - startedAt,
      repaired: true,
      svgPath: artifacts.svgPath
    });
    return NextResponse.json({
      ...repairedValidation.response,
      requestId,
      sessionId,
      conversationTurn,
      model: getConfiguredModelLabel(),
      artifacts,
      context: { compressed: compressedContext }
    });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      console.error(`[generate:${requestId}] OpenRouter error`, {
        durationMs: Date.now() - startedAt,
        status: error.status,
        message: error.message
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected generation error.";
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
      console.error(`[generate:${requestId}] failed`, { durationMs: Date.now() - startedAt, message });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    releaseGeneration?.();
  }
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
  artifacts,
  durationMs
}: {
  request: GenerateFigureRequest;
  requestId: string;
  response: GenerateFigureResponse;
  compressedContext: string;
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
    artifacts,
    model: getConfiguredModelLabel(),
    status: "completed",
    durationMs
  });
}
