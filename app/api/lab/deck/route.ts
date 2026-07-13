import { NextResponse } from "next/server";

import {
  buildDeckMessages,
  buildPalette,
  classifySlide,
  deckToPptx,
  MAX_DECK_SLIDES,
  readDeck,
  repairAndCompileDiagram,
  textSlideFrom,
  type Deck,
  type DeckSlide
} from "@/features/deck";
import { callOpenRouter, getConfiguredModelLabel, OpenRouterError, type ChatMessage } from "@/features/svg";
import { MAX_GENERATION_JSON_BODY_BYTES } from "@/lib/file-limits";
import { isLocale } from "@/lib/i18n";
import { parseJsonObject } from "@/lib/json";
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

    const shell = readDeck(parsedDeck, language);
    if (!shell) {
      return NextResponse.json({ error: "The deck generator returned an unexpected shape.", requestId }, { status: 502 });
    }

    const slides: DeckSlide[] = [];
    const warnings: string[] = [];
    for (const raw of shell.slidesRaw) {
      if (slides.length >= MAX_DECK_SLIDES) {
        break;
      }
      const classified = classifySlide(raw);
      if (!classified) {
        continue;
      }
      if (classified.kind !== "diagram") {
        const slide = textSlideFrom(classified);
        if (slide) {
          slides.push(slide);
        }
        continue;
      }

      // Compile via the deck→svg bridge, which runs one repair pass on an
      // invalid diagram before we degrade it to a plain section.
      const { result, repaired } = await repairAndCompileDiagram({
        diagram: classified.diagram,
        title: classified.title,
        skill: classified.skill,
        theme,
        language
      });
      if (repaired) {
        warnings.push(`repaired diagram "${classified.title || "(untitled)"}"`);
      }

      if (result.ok && result.slide) {
        slides.push(result.slide);
      } else if (classified.title) {
        slides.push({ kind: "section", title: classified.title });
        warnings.push(`diagram "${classified.title}" could not be rendered`);
      }
    }

    if (slides.length === 0) {
      return NextResponse.json({ error: "The deck could not be compiled.", requestId }, { status: 502 });
    }
    if (slides[0].kind !== "cover") {
      slides.unshift({ kind: "cover", title: shell.title });
    }

    const deck: Deck = { title: shell.title, language: shell.language, palette: buildPalette(theme), slides };
    const pptx = await deckToPptx(deck);

    return NextResponse.json({
      requestId,
      model: getConfiguredModelLabel(),
      deck,
      warnings: warnings.slice(0, 8),
      pptxBase64: pptx.toString("base64")
    });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      // Log upstream failures too — otherwise a region/proxy/model error is
      // invisible in the server journal and only shows in the browser.
      console.error(`[lab:deck:${requestId}] openrouter ${error.status}:`, error.message);
      return NextResponse.json({ error: error.message, requestId }, { status: error.status });
    }
    console.error(`[lab:deck:${requestId}] failed`, error);
    return NextResponse.json({ error: "Deck generation failed.", requestId }, { status: 500 });
  }
}
