import { NextResponse } from "next/server";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { persistGeneratedArtifacts } from "@/lib/generated-artifacts";
import { parseJsonObject } from "@/lib/json";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildGenerateMessages, buildRepairMessages } from "@/lib/prompts";
import { getInternalSkill, isSkillId } from "@/lib/skills";
import { isLocale } from "@/lib/i18n";
import type { GenerateFigureRequest } from "@/lib/types";

export const runtime = "nodejs";

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
      pptContext: body.pptContext
    };

    console.info(`[generate:${requestId}] started`, {
      skillId: generationRequest.skillId,
      language: generationRequest.language,
      descriptionLength: generationRequest.userDescription.length,
      hasPptContext: Boolean(generationRequest.pptContext)
    });

    const rawOutput = await callOpenRouter(await buildGenerateMessages(generationRequest, skill));
    const parsed = parseJsonObject(rawOutput);
    const validation = validateAndNormalizeFigureResponse(parsed, body.skillId, body.language);

    if (validation.ok && validation.response) {
      const artifacts = await persistGeneratedArtifacts(validation.response.figure, validation.response.fit, requestId);
      console.info(`[generate:${requestId}] completed`, {
        durationMs: Date.now() - startedAt,
        repaired: false,
        svgPath: artifacts.svgPath
      });
      return NextResponse.json({ ...validation.response, model: getConfiguredModelLabel(), artifacts });
    }

    const repairedOutput = await callOpenRouter(await buildRepairMessages(rawOutput, validation.errors));
    const repairedParsed = parseJsonObject(repairedOutput);
    const repairedValidation = validateAndNormalizeFigureResponse(repairedParsed, body.skillId, body.language);

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
    console.info(`[generate:${requestId}] completed`, {
      durationMs: Date.now() - startedAt,
      repaired: true,
      svgPath: artifacts.svgPath
    });
    return NextResponse.json({ ...repairedValidation.response, model: getConfiguredModelLabel(), artifacts });
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
    console.error(`[generate:${requestId}] failed`, { durationMs: Date.now() - startedAt, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
