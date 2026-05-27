import { NextResponse } from "next/server";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { persistGeneratedArtifacts } from "@/lib/generated-artifacts";
import { parseJsonObject } from "@/lib/json";
import { recordConversation } from "@/lib/mongodb";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildContextCompressionMessages, buildGenerateMessages, buildRepairMessages } from "@/lib/prompts";
import { getInternalSkill, isSkillId } from "@/lib/skills";
import { isLocale } from "@/lib/i18n";
import type { GenerateFigureRequest, GenerateFigureResponse, UploadedAttachment } from "@/lib/types";

export const runtime = "nodejs";

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as Partial<GenerateFigureRequest>;

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

    const generationRequest: GenerateFigureRequest = {
      skillId: body.skillId,
      userDescription: body.userDescription.trim(),
      language: body.language,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
      attachments: normalizeAttachments(body.attachments),
      pptContext: body.pptContext
    };

    console.info(`[generate:${requestId}] started`, {
      skillId: generationRequest.skillId,
      language: generationRequest.language,
      descriptionLength: generationRequest.userDescription.length,
      hasPptContext: Boolean(generationRequest.pptContext),
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
      const artifacts = await persistGeneratedArtifacts(validation.response.figure, validation.response.fit, requestId);
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
      requestId
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
    ...(request.attachments?.map(
      (attachment) =>
        `Attachment: ${attachment.originalName} (${attachment.extension}, sha256=${attachment.hash}, path=${attachment.path})${attachment.extractedText ? `\n${attachment.extractedText}` : ""}`
    ) ?? [])
  ]
    .join("\n\n")
    .slice(0, 6000);
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
    conversationId: request.conversationId,
    requestId,
    language: request.language,
    skillId: request.skillId,
    userDescription: request.userDescription,
    compressedContext,
    attachments: request.attachments ?? [],
    figure: response.figure,
    fit: response.fit,
    artifacts,
    model: getConfiguredModelLabel(),
    status: "completed",
    durationMs
  });
}
