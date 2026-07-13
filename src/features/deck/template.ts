// ─────────────────────────────────────────────────────────────────────────────
// DECK TEMPLATE — "tech blue" design system (JSON-constrained layout)
// ─────────────────────────────────────────────────────────────────────────────
// Text slides (cover / section / bullets) are built here as ordinary Figures —
// the same model diagram slides use — so a single renderer (FigureSvg) and a
// single exporter (figureToPptx) produce byte-for-byte-consistent preview and
// PPTX output, and the layout is literally constrained by JSON (positioned
// rect/text elements on a 1280×720 canvas).
//
// Aesthetic: deep-navy cover/section dividers with a cyan accent and mono
// kickers; light content pages; a page-number footer on every slide. The
// accent/ink/surface colors come from the deck palette (so an uploaded template
// or a "科技风" style hint still flows through); the navy dividers are the
// fixed identity of this template.
//
// Only `rect` and `text` elements are used — both render identically in the SVG
// and PPTX paths, so there is no renderer-specific drift.

import type { Figure, FigureElement } from "@/lib/types";

import type { DeckPalette, DeckSlide } from "./types";

export interface DeckChromeContext {
  index: number; // 0-based position in the deck
  total: number;
  deckTitle: string;
  language?: "zh" | "en";
}

const W = 1280;
const H = 720;
const M = 92; // page margin

interface Tokens {
  navy: string;
  panel: string;
  onDark: string;
  onDarkMuted: string;
  accent: string;
  light: string;
  ink: string;
  inkMuted: string;
  ruleDark: string;
  ruleLight: string;
}

function tokens(p: DeckPalette): Tokens {
  return {
    navy: "#0E1E36",
    panel: "#17294A",
    onDark: "#EAF1FB",
    onDarkMuted: "#93A9C9",
    accent: p.accent || "#33B1FF",
    light: p.background || "#FFFFFF",
    ink: p.text || "#0E1E36",
    inkMuted: p.subtext || "#5B6B80",
    ruleDark: "#283D5E",
    ruleLight: "#E3E9F2"
  };
}

// Small element builders (id-stamped per slide so keys stay unique).
function makeBuilder(index: number) {
  let n = 0;
  const id = (kind: string) => `deck-${index}-${kind}-${n++}`;
  return {
    rect(x: number, y: number, width: number, height: number, fill: string, rx = 0): FigureElement {
      return { id: id("rect"), type: "rect", x, y, width, height, fill, ...(rx ? { rx } : {}) };
    },
    text(
      x: number,
      y: number,
      width: number,
      height: number,
      text: string,
      fontSize: number,
      fontWeight: number,
      fill: string,
      align: "start" | "middle" | "end" = "start"
    ): FigureElement {
      return { id: id("text"), type: "text", x, y, width, height, text, fontSize, fontWeight, fill, textAnchor: align };
    }
  };
}

function footer(b: ReturnType<typeof makeBuilder>, t: Tokens, ctx: DeckChromeContext, onDark: boolean): FigureElement[] {
  const rule = onDark ? t.ruleDark : t.ruleLight;
  const muted = onDark ? t.onDarkMuted : t.inkMuted;
  return [
    b.rect(M, 662, W - 2 * M, 1.5, rule),
    b.text(M, 676, 640, 24, ctx.deckTitle || "", 13, 500, muted, "start"),
    b.text(W - M - 160, 676, 160, 24, `${ctx.index + 1} / ${ctx.total}`, 14, 600, muted, "end")
  ];
}

function coverFigure(slide: Extract<DeckSlide, { kind: "cover" }>, t: Tokens, ctx: DeckChromeContext, font?: string): Figure {
  const b = makeBuilder(ctx.index);
  const kicker = ctx.language === "en" ? "PRESENTATION" : "汇报材料";
  const els: FigureElement[] = [
    b.rect(0, 0, W, H, t.navy),
    b.rect(0, 0, W, 8, t.accent), // top ribbon
    b.rect(M, 154, 26, 7, t.accent), // kicker tick
    b.text(M + 40, 142, 520, 30, kicker, 15, 600, t.accent, "start"),
    b.text(M, 296, 1000, 170, slide.title, 52, 800, t.onDark, "start"),
    b.rect(M + 2, 502, 190, 7, t.accent) // accent underline
  ];
  if (slide.subtitle) {
    els.push(b.text(M, 528, 780, 96, slide.subtitle, 24, 400, t.onDarkMuted, "start"));
  }
  els.push(...footer(b, t, ctx, true));
  return figure(slide.title, els, font);
}

function sectionFigure(slide: Extract<DeckSlide, { kind: "section" }>, t: Tokens, ctx: DeckChromeContext, font?: string): Figure {
  const b = makeBuilder(ctx.index);
  const num = String(ctx.index + 1).padStart(2, "0");
  const els: FigureElement[] = [
    b.rect(0, 0, W, H, t.navy),
    b.rect(0, 0, W, 8, t.accent),
    // Oversized ghost number for tech drama (panel color ≈ background so it reads faint).
    b.text(824, 300, 380, 360, num, 300, 800, t.panel, "end"),
    b.rect(M, 276, 26, 7, t.accent),
    b.text(M + 40, 264, 400, 28, ctx.language === "en" ? "SECTION" : "章节", 15, 600, t.accent, "start"),
    b.text(M, 300, 1000, 150, slide.title, 46, 800, t.onDark, "start"),
    b.rect(M + 2, 470, 160, 7, t.accent)
  ];
  if (slide.subtitle) {
    els.push(b.text(M, 498, 880, 80, slide.subtitle, 22, 400, t.onDarkMuted, "start"));
  }
  els.push(...footer(b, t, ctx, true));
  return figure(slide.title, els, font);
}

function bulletsFigure(slide: Extract<DeckSlide, { kind: "bullets" }>, t: Tokens, ctx: DeckChromeContext, font?: string): Figure {
  const b = makeBuilder(ctx.index);
  const els: FigureElement[] = [
    b.rect(0, 0, W, H, t.light),
    b.rect(0, 0, W, 6, t.accent),
    b.text(M, 74, 1040, 70, slide.title, 32, 800, t.ink, "start"),
    b.rect(M + 2, 150, 104, 6, t.accent)
  ];

  const bullets = slide.bullets.slice(0, 8);
  const top = 200;
  const bottom = 636;
  const rowH = Math.min(76, (bottom - top) / Math.max(bullets.length, 1));
  bullets.forEach((text, i) => {
    const rowTop = top + i * rowH;
    const cy = rowTop + rowH / 2;
    els.push(b.rect(M, cy - 6, 12, 12, t.accent, 3)); // square marker
    els.push(b.text(M + 34, rowTop, W - (M + 34) - M, rowH, text, 20, 500, t.ink, "start"));
  });

  els.push(...footer(b, t, ctx, false));
  return figure(slide.title, els, font);
}

function figure(title: string, elements: FigureElement[], font?: string): Figure {
  return {
    canvas: { width: W, height: H, background: "#FFFFFF", ...(font ? { fontFamily: font } : {}) },
    metadata: { title, description: "", skillId: "freeform", language: "zh" },
    elements
  };
}

/**
 * Build the Figure for a text slide (cover / section / bullets) under the
 * tech-blue template. Never called for diagram slides.
 */
export function textSlideToFigure(slide: DeckSlide, palette: DeckPalette, ctx: DeckChromeContext): Figure {
  const t = tokens(palette);
  const font = palette.fontFamily;
  if (slide.kind === "cover") return coverFigure(slide, t, ctx, font);
  if (slide.kind === "section") return sectionFigure(slide, t, ctx, font);
  if (slide.kind === "bullets") return bulletsFigure(slide, t, ctx, font);
  // Should not happen — return a minimal navy slide as a safe fallback.
  return figure("", [makeBuilder(ctx.index).rect(0, 0, W, H, t.navy)], font);
}

/**
 * Append a consistent page-number footer to a compiled diagram Figure so
 * diagram slides carry the same chrome as text slides, without disturbing the
 * diagram's own layout (footer sits in the bottom margin).
 */
export function withDeckChrome(diagram: Figure, palette: DeckPalette, ctx: DeckChromeContext): Figure {
  const t = tokens(palette);
  const fw = diagram.canvas.width;
  const fh = diagram.canvas.height;
  const b = makeBuilder(ctx.index);
  const chrome: FigureElement[] = [
    b.text(M, fh - 40, 640, 22, ctx.deckTitle || "", 13, 500, t.inkMuted, "start"),
    b.text(fw - M - 160, fh - 40, 160, 22, `${ctx.index + 1} / ${ctx.total}`, 14, 600, t.inkMuted, "end")
  ];
  return { ...diagram, elements: [...diagram.elements, ...chrome] };
}
