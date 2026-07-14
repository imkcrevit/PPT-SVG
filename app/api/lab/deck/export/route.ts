import { NextResponse } from "next/server";

import { buildPalette, classifySlide, deckToPptx, textSlideFrom, type Deck, type DeckSlide } from "@/features/deck";
import { validateAndNormalizeFigureResponse } from "@/features/svg";
import { isLocale } from "@/lib/i18n";
import { readLimitedJson, securityJson } from "@/lib/request-security";
import { resolveTheme } from "@/lib/theme";
import type { Locale } from "@/lib/types";

export const runtime = "nodejs";

// Larger than the generation cap: an edited deck carries compiled figures.
// Larger than a text-only deck: image slides carry base64 raster data URIs.
const MAX_DECK_EXPORT_BYTES = 20_000_000;

export async function POST(request: Request) {
  try {
    const parsed = await readLimitedJson(request, MAX_DECK_EXPORT_BYTES);
    if (!parsed.ok) {
      return securityJson(parsed.decision);
    }
    const root = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? (parsed.value as Record<string, unknown>) : undefined;
    const deckRecord = root?.deck && typeof root.deck === "object" ? (root.deck as Record<string, unknown>) : root;
    if (!deckRecord) {
      return NextResponse.json({ error: "Missing deck." }, { status: 400 });
    }

    const rawLanguage = typeof deckRecord.language === "string" ? deckRecord.language : "";
    const language: Locale = isLocale(rawLanguage) ? rawLanguage : "zh";
    const title = typeof deckRecord.title === "string" ? deckRecord.title.slice(0, 120) || "Deck" : "Deck";
    const rawSlides = Array.isArray(deckRecord.slides) ? deckRecord.slides : [];

    const slides: DeckSlide[] = [];
    for (const raw of rawSlides) {
      const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
      if (!record) {
        continue;
      }
      if (record.kind === "diagram") {
        // Re-validate the client-posted figure for security (per-element
        // sanitization), but skip the layout normalizer: these figures are
        // already laid out precisely by layoutDiagram(), and re-normalizing them
        // shifts rects out from under their labels — the exact export-vs-preview
        // mismatch users saw (titles floating above their boxes).
        const validation = validateAndNormalizeFigureResponse({ figure: record.figure }, "flow", language, {
          skipLayoutNormalization: true
        });
        if (validation.ok && validation.response) {
          const title = typeof record.title === "string" ? record.title.slice(0, 160) : validation.response.figure.metadata.title;
          slides.push({ kind: "diagram", title, figure: validation.response.figure });
        }
        continue;
      }
      if (record.kind === "image" || record.kind === "image-bullets") {
        // Image slides carry a resolved data URI (not an imageRef). Accept only a
        // bounded base64 raster data URI — never a remote URL.
        const src = typeof record.src === "string" ? record.src.trim() : "";
        if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(src) || src.length > 3_600_000) {
          continue;
        }
        const title = typeof record.title === "string" ? record.title.slice(0, 160) : "";
        if (record.kind === "image") {
          slides.push({ kind: "image", title, src, caption: typeof record.caption === "string" ? record.caption.slice(0, 200) : undefined });
        } else {
          const bullets = (Array.isArray(record.bullets) ? record.bullets : [])
            .map((b) => (typeof b === "string" ? b.slice(0, 200) : ""))
            .filter(Boolean)
            .slice(0, 6);
          slides.push({ kind: "image-bullets", title, src, bullets });
        }
        continue;
      }
      const classified = classifySlide(record);
      if (classified && classified.kind !== "diagram" && classified.kind !== "image" && classified.kind !== "image-bullets") {
        const slide = textSlideFrom(classified);
        if (slide) {
          slides.push(slide);
        }
      }
    }

    if (!slides.length) {
      return NextResponse.json({ error: "Deck has no valid slides." }, { status: 400 });
    }

    // Palette: reuse posted colors when valid, else defaults via resolveTheme.
    const paletteRecord = deckRecord.palette && typeof deckRecord.palette === "object" ? (deckRecord.palette as Record<string, unknown>) : {};
    const theme = resolveTheme({
      background: typeof paletteRecord.background === "string" ? paletteRecord.background : undefined,
      text: typeof paletteRecord.text === "string" ? paletteRecord.text : undefined,
      subtext: typeof paletteRecord.subtext === "string" ? paletteRecord.subtext : undefined,
      fontFamily: typeof paletteRecord.fontFamily === "string" ? paletteRecord.fontFamily : undefined,
      accents:
        typeof paletteRecord.accent === "string"
          ? [{ stroke: paletteRecord.accent, tint: paletteRecord.accent }]
          : undefined
    });

    const deck: Deck = { title, language, palette: buildPalette(theme), slides };
    const pptx = await deckToPptx(deck);
    const responseBody = pptx.buffer.slice(pptx.byteOffset, pptx.byteOffset + pptx.byteLength) as ArrayBuffer;

    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": 'attachment; filename="deck.pptx"'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deck export failed.";
    console.error("[lab:deck:export]", message);
    return NextResponse.json({ error: "Deck export failed." }, { status: 500 });
  }
}
