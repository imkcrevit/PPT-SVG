import { NextResponse } from "next/server";

import { generateDiagramSlide } from "@/features/deck";
import { getConfiguredModelLabel, OpenRouterError, isSkillId } from "@/features/svg";
import { MAX_GENERATION_JSON_BODY_BYTES } from "@/lib/file-limits";
import { isLocale } from "@/lib/i18n";
import {
  checkGenerationAbuse,
  enforceGenerationContentLength,
  readLimitedJson,
  securityJson
} from "@/lib/request-security";
import { normalizeSessionId } from "@/lib/session";
import { resolveTheme } from "@/lib/theme";
import type { Locale, SkillId } from "@/lib/types";

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
    const skillId: SkillId = typeof body.skillId === "string" && isSkillId(body.skillId) ? body.skillId : "freeform";

    if (!title && !context) {
      return NextResponse.json({ error: "Provide a slide title or context." }, { status: 400 });
    }

    const abuseDecision = checkGenerationAbuse(request, sessionId);
    if (!abuseDecision.ok) {
      return securityJson(abuseDecision);
    }

    const paletteRecord = body.palette && typeof body.palette === "object" ? (body.palette as Record<string, unknown>) : {};
    const theme = resolveTheme({
      background: typeof paletteRecord.background === "string" ? paletteRecord.background : undefined,
      text: typeof paletteRecord.text === "string" ? paletteRecord.text : undefined,
      subtext: typeof paletteRecord.subtext === "string" ? paletteRecord.subtext : undefined,
      fontFamily: typeof paletteRecord.fontFamily === "string" ? paletteRecord.fontFamily : undefined,
      accents: typeof paletteRecord.accent === "string" ? [{ stroke: paletteRecord.accent, tint: paletteRecord.accent }] : undefined
    });

    const generated = await generateDiagramSlide({ context, title, skillId, theme, language });
    if (!generated.ok) {
      return NextResponse.json({ error: generated.error, requestId }, { status: 502 });
    }

    return NextResponse.json({ requestId, model: getConfiguredModelLabel(), slide: generated.slide });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      console.error(`[lab:deck:slide:${requestId}] openrouter ${error.status}:`, error.message);
      return NextResponse.json({ error: error.message, requestId }, { status: error.status });
    }
    console.error(`[lab:deck:slide:${requestId}]`, error);
    return NextResponse.json({ error: "Slide regeneration failed.", requestId }, { status: 500 });
  }
}
