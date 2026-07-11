import { NextResponse } from "next/server";

import { buildDeckMessages } from "@/lib/deck-prompts";
import { validateAndCompileDeck } from "@/lib/deck-pipeline";
import { deckToPptx } from "@/lib/deck-pptx";
import { MAX_GENERATION_JSON_BODY_BYTES } from "@/lib/file-limits";
import { isLocale } from "@/lib/i18n";
import { parseJsonObject } from "@/lib/json";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError } from "@/lib/openrouter";
import type { ChatMessage } from "@/lib/prompts";
import {
  checkGenerationAbuse,
  enforceGenerationContentLength,
  readLimitedJson,
  sanitizeUploadedAttachments,
  securityJson
} from "@/lib/request-security";
import { normalizeSessionId } from "@/lib/session";
import { mergeTheme, normalizeThemeOverride, resolveTheme } from "@/lib/theme";
import { resolveStyleContext } from "@/lib/theme-extract";
import { resolveThemeIntent } from "@/lib/theme-intent";
import type { Locale } from "@/lib/types";

export const runtime = "nodejs";

const MAX_CONTEXT_CHARS = 24_000;
const DECK_TIMEOUT_MS = 90_000;
const DECK_MAX_TOKENS = 16_000;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const contentLengthDecision = enforceGenerationContentLength(request);
  if (!contentLengthDecision.ok) {
    return securityJson(contentLengthDecision);
  }

  try {
    const parsedBody = await readLimitedJson(request, MAX_GENERATION_JSON_BODY_BYTES);
    if (!parsedBody.ok) {
      return securityJson(parsedBody.decision);
    }
    const body = (parsedBody.value ?? {}) as {
      context?: unknown;
      language?: unknown;
      styleHint?: unknown;
      themeOverride?: unknown;
      attachments?: unknown;
      sessionId?: unknown;
    };

    const rawLanguage = typeof body.language === "string" ? body.language : "";
    const language: Locale = isLocale(rawLanguage) ? rawLanguage : "zh";
    const sessionId = normalizeSessionId(typeof body.sessionId === "string" ? body.sessionId : undefined);
    const styleHint = typeof body.styleHint === "string" ? body.styleHint.slice(0, 400) : "";
    const attachments = sanitizeUploadedAttachments(body.attachments);

    const abuseDecision = checkGenerationAbuse(request, sessionId);
    if (!abuseDecision.ok) {
      return securityJson(abuseDecision);
    }

    // Context = provided text + any extracted attachment text.
    const context = [
      typeof body.context === "string" ? body.context : "",
      ...attachments.map((a) => a.extractedText ?? "")
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, MAX_CONTEXT_CHARS)
      .trim();

    if (!context) {
      return NextResponse.json({ error: "Provide context text or an uploaded document to build a deck from." }, { status: 400 });
    }

    // Style: an uploaded template's theme wins; otherwise resolve a text style
    // hint; otherwise the default theme.
    const { theme: templateTheme } = await resolveStyleContext(attachments);
    let theme = templateTheme ?? resolveTheme();
    if (!templateTheme && styleHint) {
      const intent = await resolveThemeIntent(styleHint, {}, (msgs) =>
        callOpenRouter(msgs as ChatMessage[], { temperature: 0, maxCompletionTokens: 400 })
      );
      const override = { ...(normalizeThemeOverride(body.themeOverride) ?? {}), ...(intent ?? {}) };
      const merged = mergeTheme(theme, Object.keys(override).length ? override : undefined);
      if (merged) {
        theme = merged;
      }
    }

    const messages = await buildDeckMessages({ context, language, styleHint });
    const rawOutput = await callOpenRouter(messages, {
      temperature: 0.3,
      maxCompletionTokens: DECK_MAX_TOKENS,
      responseFormat: "json_object",
      timeoutMs: DECK_TIMEOUT_MS
    });

    let parsedDeck: unknown;
    try {
      parsedDeck = parseJsonObject(rawOutput);
    } catch (error) {
      console.error(`[lab:deck:${requestId}] JSON parse failed`, error);
      return NextResponse.json({ error: "The deck generator returned invalid JSON.", requestId }, { status: 502 });
    }

    const compiled = validateAndCompileDeck(parsedDeck, theme, language);
    if (!compiled.ok || !compiled.deck) {
      return NextResponse.json({ error: "The deck could not be compiled.", details: compiled.errors.slice(0, 5), requestId }, { status: 502 });
    }

    const pptx = await deckToPptx(compiled.deck);

    return NextResponse.json({
      requestId,
      model: getConfiguredModelLabel(),
      deck: compiled.deck,
      warnings: compiled.errors.slice(0, 5),
      pptxBase64: pptx.toString("base64")
    });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(`[lab:deck:${requestId}] failed`, error);
    return NextResponse.json({ error: "Deck generation failed.", requestId }, { status: 500 });
  }
}
