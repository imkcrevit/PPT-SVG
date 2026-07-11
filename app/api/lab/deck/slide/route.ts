import { NextResponse } from "next/server";

import type { DeckSlide } from "@/lib/deck-types";
import { MAX_GENERATION_JSON_BODY_BYTES } from "@/lib/file-limits";
import { isLocale } from "@/lib/i18n";
import { parseJsonObject } from "@/lib/json";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import { buildGenerateMessages } from "@/lib/prompts";
import {
  checkGenerationAbuse,
  enforceGenerationContentLength,
  readLimitedJson,
  securityJson
} from "@/lib/request-security";
import { validateAndNormalizeSemanticResponse } from "@/lib/semantic-figure-pipeline";
import { normalizeSessionId } from "@/lib/session";
import { getInternalSkill, isSkillId } from "@/lib/skills";
import { resolveTheme } from "@/lib/theme";
import type { GenerateFigureRequest, Locale } from "@/lib/types";

export const runtime = "nodejs";

const MAX_CONTEXT_CHARS = 8_000;

// Regenerate a single diagram slide from the deck context + the slide's title.
export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const contentLengthDecision = enforceGenerationContentLength(request);
  if (!contentLengthDecision.ok) {
    return securityJson(contentLengthDecision);
  }

  try {
    const parsed = await readLimitedJson(request, MAX_GENERATION_JSON_BODY_BYTES);
    if (!parsed.ok) {
      return securityJson(parsed.decision);
    }
    const body = (parsed.value ?? {}) as {
      context?: unknown;
      title?: unknown;
      skillId?: unknown;
      language?: unknown;
      palette?: unknown;
      sessionId?: unknown;
    };

    const rawLanguage = typeof body.language === "string" ? body.language : "";
    const language: Locale = isLocale(rawLanguage) ? rawLanguage : "zh";
    const sessionId = normalizeSessionId(typeof body.sessionId === "string" ? body.sessionId : undefined);
    const title = typeof body.title === "string" ? body.title.slice(0, 160) : "";
    const context = (typeof body.context === "string" ? body.context : "").slice(0, MAX_CONTEXT_CHARS).trim();
    const skillId = typeof body.skillId === "string" && isSkillId(body.skillId) ? body.skillId : "freeform";

    if (!title && !context) {
      return NextResponse.json({ error: "Provide a slide title or context." }, { status: 400 });
    }

    const abuseDecision = checkGenerationAbuse(request, sessionId);
    if (!abuseDecision.ok) {
      return securityJson(abuseDecision);
    }

    const skill = getInternalSkill(skillId);
    if (!skill) {
      return NextResponse.json({ error: "Invalid skillId." }, { status: 400 });
    }

    const paletteRecord = body.palette && typeof body.palette === "object" ? (body.palette as Record<string, unknown>) : {};
    const theme = resolveTheme({
      background: typeof paletteRecord.background === "string" ? paletteRecord.background : undefined,
      text: typeof paletteRecord.text === "string" ? paletteRecord.text : undefined,
      subtext: typeof paletteRecord.subtext === "string" ? paletteRecord.subtext : undefined,
      fontFamily: typeof paletteRecord.fontFamily === "string" ? paletteRecord.fontFamily : undefined,
      accents: typeof paletteRecord.accent === "string" ? [{ stroke: paletteRecord.accent, tint: paletteRecord.accent }] : undefined
    });

    const userDescription = [title ? `图表主题：${title}` : "", context ? `背景资料：${context}` : ""].filter(Boolean).join("\n");
    const generationRequest: GenerateFigureRequest = { skillId, userDescription, language };
    const messages = await buildGenerateMessages(generationRequest, skill);
    const rawOutput = await callOpenRouter(messages, { temperature: 0.3, maxCompletionTokens: 8_000, timeoutMs: 60_000 });

    let parsedFigure: unknown;
    try {
      parsedFigure = parseJsonObject(rawOutput);
    } catch {
      return NextResponse.json({ error: "The generator returned invalid JSON.", requestId }, { status: 502 });
    }

    const validation = validateAndNormalizeSemanticResponse(parsedFigure, skillId, language, theme);
    if (!validation.ok || !validation.response) {
      return NextResponse.json({ error: "The regenerated diagram was invalid.", requestId }, { status: 502 });
    }

    const slide: DeckSlide = { kind: "diagram", title: title || validation.response.figure.metadata.title, figure: validation.response.figure };
    return NextResponse.json({ requestId, model: getConfiguredModelLabel(), slide });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(`[lab:deck:slide:${requestId}]`, error);
    return NextResponse.json({ error: "Slide regeneration failed.", requestId }, { status: 500 });
  }
}
