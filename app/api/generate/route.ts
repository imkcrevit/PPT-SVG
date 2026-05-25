import { NextResponse } from "next/server";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { parseJsonObject } from "@/lib/json";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildGenerateMessages, buildRepairMessages } from "@/lib/prompts";
import { getInternalSkill, isSkillId } from "@/lib/skills";
import { isLocale } from "@/lib/i18n";
import type { GenerateFigureRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<GenerateFigureRequest>;

    if (!body.skillId || !isSkillId(body.skillId)) {
      return NextResponse.json({ error: "Invalid skillId." }, { status: 400 });
    }

    if (!body.language || !isLocale(body.language)) {
      return NextResponse.json({ error: "Invalid language." }, { status: 400 });
    }

    if (!body.userDescription?.trim()) {
      return NextResponse.json({ error: "userDescription is required." }, { status: 400 });
    }

    const skill = getInternalSkill(body.skillId);
    if (!skill) {
      return NextResponse.json({ error: "Unknown internal skill." }, { status: 400 });
    }

    const generationRequest: GenerateFigureRequest = {
      skillId: body.skillId,
      userDescription: body.userDescription.trim(),
      language: body.language,
      pptContext: body.pptContext
    };

    const rawOutput = await callOpenRouter(await buildGenerateMessages(generationRequest, skill));
    const parsed = parseJsonObject(rawOutput);
    const validation = validateAndNormalizeFigureResponse(parsed, body.skillId, body.language);

    if (validation.ok && validation.response) {
      return NextResponse.json({ ...validation.response, model: getConfiguredModelLabel() });
    }

    const repairedOutput = await callOpenRouter(await buildRepairMessages(rawOutput, validation.errors));
    const repairedParsed = parseJsonObject(repairedOutput);
    const repairedValidation = validateAndNormalizeFigureResponse(repairedParsed, body.skillId, body.language);

    if (!repairedValidation.ok || !repairedValidation.response) {
      return NextResponse.json(
        {
          error: "Model response could not be converted into valid Figure JSON.",
          details: repairedValidation.errors
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ...repairedValidation.response, model: getConfiguredModelLabel() });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected generation error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

