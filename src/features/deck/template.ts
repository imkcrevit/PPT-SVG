// ─────────────────────────────────────────────────────────────────────────────
// DECK TEMPLATES — declarative, JSON-constrained slide design system
// ─────────────────────────────────────────────────────────────────────────────
// A template is DATA: a set of design tokens plus, per slide kind, a "master"
// (an ordered list of positioned blocks) on a fixed 1280×720 canvas. A small
// interpreter turns (template + slide + context) into a Figure built from plain
// rect/text elements, which both the SVG preview and the PPTX exporter render
// identically. This means the layout is literally constrained by JSON and a new
// look is authored by writing a new `DeckTemplate` object — no imperative code.
//
// To design your own template: copy TECH_TEMPLATE, change the tokens and block
// coordinates/styles, give it a unique `id`, and add it to DECK_TEMPLATES.
// `validateDeckTemplate` (see the deck template test) checks every block stays
// on-canvas and every color reference resolves.
//
// Colors in a block are either a literal hex ("#0E1E36") or a token key. Token
// keys resolve from: the template's own `tokens.colors`, PLUS four palette-
// derived keys so a template inherits the deck's palette (uploaded template /
// style hint):
//   accent  → palette.accent      ink    → palette.text
//   surface → palette.background   muted  → palette.subtext
//
// A text block's content comes from either a literal `text` (a string, or
// {zh,en} for language-aware labels) or a `field` bound to the slide/context:
//   title · subtitle · bullets(only in a bullets block) · pageNumber ·
//   deckTitle · sectionNo (the 1-based slide index, zero-padded).
// A text block whose resolved content is empty is skipped (e.g. an absent
// subtitle), so masters never need conditional logic.

import type { Figure, FigureElement } from "@/lib/types";

import type { DeckPalette, DeckSlide } from "./types";

// ── Canvas ───────────────────────────────────────────────────────────────────
const CANVAS_W = 1280;
const CANVAS_H = 720;

// ── Template schema (author these) ─────────────────────────────────────────────
export type Align = "start" | "middle" | "end";
export type LangText = string | { zh: string; en: string };
export type TextField = "title" | "subtitle" | "pageNumber" | "deckTitle" | "sectionNo";

export interface RectBlock {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string; // hex or token key
  rx?: number;
}

export interface TextBlock {
  type: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bind to a slide/context field. Omit when using a literal `text`. */
  field?: TextField;
  /** Literal content (overrides `field`). Use {zh,en} for language-aware labels. */
  text?: LangText;
  size: number;
  weight: number;
  color: string; // hex or token key
  align?: Align;
}

export interface BulletsBlock {
  type: "bullets";
  x: number;
  yTop: number;
  yBottom: number;
  maxRows: number;
  maxRowH: number;
  marker: { dx: number; w: number; h: number; color: string; rx?: number };
  text: { dx: number; w: number; size: number; weight: number; color: string };
}

export type TemplateBlock = RectBlock | TextBlock | BulletsBlock;

export interface SlideMaster {
  /** Full-canvas background color (hex or token key). */
  background?: string;
  blocks: TemplateBlock[];
}

export interface DeckTemplate {
  id: string;
  name: { zh: string; en: string };
  tokens: {
    colors: Record<string, string>;
    fontFamily?: string;
  };
  masters: {
    cover: SlideMaster;
    section: SlideMaster;
    bullets: SlideMaster;
    /** Overlay blocks added on top of a compiled diagram (e.g. a page-number footer). */
    diagram?: SlideMaster;
  };
}

// ── Render context ─────────────────────────────────────────────────────────────
export interface DeckChromeContext {
  index: number; // 0-based position in the deck
  total: number;
  deckTitle: string;
  language?: "zh" | "en";
}

// ── Built-in template: 科技蓝 / Tech Blue ───────────────────────────────────────
const M = 92; // page margin used by this template's coordinates

const TECH_TEMPLATE: DeckTemplate = {
  id: "tech",
  name: { zh: "科技蓝", en: "Tech Blue" },
  tokens: {
    colors: {
      navy: "#0E1E36",
      panel: "#17294A",
      onDark: "#EAF1FB",
      onDarkMuted: "#93A9C9",
      ruleDark: "#283D5E",
      ruleLight: "#E3E9F2"
    }
  },
  masters: {
    cover: {
      background: "navy",
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 8, fill: "accent" },
        { type: "rect", x: M, y: 154, w: 26, h: 7, fill: "accent" },
        { type: "text", x: M + 40, y: 142, w: 520, h: 30, text: { zh: "汇报材料", en: "PRESENTATION" }, size: 15, weight: 600, color: "accent", align: "start" },
        { type: "text", x: M, y: 296, w: 1000, h: 170, field: "title", size: 52, weight: 800, color: "onDark", align: "start" },
        { type: "rect", x: M + 2, y: 502, w: 190, h: 7, fill: "accent" },
        { type: "text", x: M, y: 528, w: 780, h: 96, field: "subtitle", size: 24, weight: 400, color: "onDarkMuted", align: "start" },
        { type: "rect", x: M, y: 662, w: CANVAS_W - 2 * M, h: 1.5, fill: "ruleDark" },
        { type: "text", x: M, y: 676, w: 640, h: 24, field: "deckTitle", size: 13, weight: 500, color: "onDarkMuted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: 676, w: 160, h: 24, field: "pageNumber", size: 14, weight: 600, color: "onDarkMuted", align: "end" }
      ]
    },
    section: {
      background: "navy",
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 8, fill: "accent" },
        // Eyebrow anchored at the top so the slide reads full-height (no empty
        // top band); the big title sits at the vertical center with the ghost
        // number as a centered backdrop and the subtitle just below.
        { type: "rect", x: M, y: 84, w: 26, h: 7, fill: "accent" },
        { type: "text", x: M + 40, y: 72, w: 400, h: 28, text: { zh: "章节", en: "SECTION" }, size: 15, weight: 600, color: "accent", align: "start" },
        { type: "text", x: 812, y: 200, w: 392, h: 340, field: "sectionNo", size: 300, weight: 800, color: "panel", align: "end" },
        { type: "text", x: M, y: 300, w: 1000, h: 150, field: "title", size: 48, weight: 800, color: "onDark", align: "start" },
        { type: "rect", x: M + 2, y: 476, w: 160, h: 7, fill: "accent" },
        { type: "text", x: M, y: 502, w: 880, h: 72, field: "subtitle", size: 22, weight: 400, color: "onDarkMuted", align: "start" },
        { type: "rect", x: M, y: 662, w: CANVAS_W - 2 * M, h: 1.5, fill: "ruleDark" },
        { type: "text", x: M, y: 676, w: 640, h: 24, field: "deckTitle", size: 13, weight: 500, color: "onDarkMuted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: 676, w: 160, h: 24, field: "pageNumber", size: 14, weight: 600, color: "onDarkMuted", align: "end" }
      ]
    },
    bullets: {
      background: "surface",
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 6, fill: "accent" },
        { type: "text", x: M, y: 74, w: 1040, h: 70, field: "title", size: 32, weight: 800, color: "ink", align: "start" },
        { type: "rect", x: M + 2, y: 150, w: 104, h: 6, fill: "accent" },
        {
          type: "bullets",
          x: M,
          yTop: 200,
          yBottom: 636,
          maxRows: 8,
          maxRowH: 76,
          marker: { dx: 0, w: 12, h: 12, color: "accent", rx: 3 },
          text: { dx: 34, w: CANVAS_W - (M + 34) - M, size: 20, weight: 500, color: "ink" }
        },
        { type: "rect", x: M, y: 662, w: CANVAS_W - 2 * M, h: 1.5, fill: "ruleLight" },
        { type: "text", x: M, y: 676, w: 640, h: 24, field: "deckTitle", size: 13, weight: 500, color: "muted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: 676, w: 160, h: 24, field: "pageNumber", size: 14, weight: 600, color: "muted", align: "end" }
      ]
    },
    diagram: {
      blocks: [
        { type: "text", x: M, y: CANVAS_H - 40, w: 640, h: 22, field: "deckTitle", size: 13, weight: 500, color: "muted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: CANVAS_H - 40, w: 160, h: 22, field: "pageNumber", size: 14, weight: 600, color: "muted", align: "end" }
      ]
    }
  }
};

export const DECK_TEMPLATES: DeckTemplate[] = [TECH_TEMPLATE];

export function getDeckTemplate(id?: string): DeckTemplate {
  return DECK_TEMPLATES.find((t) => t.id === id) ?? DECK_TEMPLATES[0];
}

// ── Interpreter ────────────────────────────────────────────────────────────────
function colorResolver(tpl: DeckTemplate, palette: DeckPalette): (key: string) => string {
  const map: Record<string, string> = {
    ...tpl.tokens.colors,
    accent: palette.accent || "#33B1FF",
    ink: palette.text || "#0E1E36",
    surface: palette.background || "#FFFFFF",
    muted: palette.subtext || "#5B6B80"
  };
  return (key: string) => (key.startsWith("#") ? key : map[key] ?? "#000000");
}

function resolveText(block: TextBlock, slide: DeckSlide, ctx: DeckChromeContext): string {
  const lang = ctx.language ?? "zh";
  if (block.text !== undefined) {
    return typeof block.text === "string" ? block.text : block.text[lang];
  }
  switch (block.field) {
    case "title":
      return slide.title ?? "";
    case "subtitle":
      return "subtitle" in slide ? slide.subtitle ?? "" : "";
    case "pageNumber":
      return `${ctx.index + 1} / ${ctx.total}`;
    case "deckTitle":
      return ctx.deckTitle ?? "";
    case "sectionNo":
      return String(ctx.index + 1).padStart(2, "0");
    default:
      return "";
  }
}

function buildMaster(
  master: SlideMaster,
  slide: DeckSlide,
  tpl: DeckTemplate,
  palette: DeckPalette,
  ctx: DeckChromeContext
): FigureElement[] {
  const color = colorResolver(tpl, palette);
  const els: FigureElement[] = [];
  let n = 0;
  const id = (kind: string) => `deck-${ctx.index}-${kind}-${n++}`;

  if (master.background) {
    els.push({ id: id("bg"), type: "rect", x: 0, y: 0, width: CANVAS_W, height: CANVAS_H, fill: color(master.background) });
  }

  for (const block of master.blocks) {
    if (block.type === "rect") {
      els.push({ id: id("rect"), type: "rect", x: block.x, y: block.y, width: block.w, height: block.h, fill: color(block.fill), ...(block.rx ? { rx: block.rx } : {}) });
    } else if (block.type === "text") {
      const content = resolveText(block, slide, ctx);
      if (!content) continue;
      els.push({ id: id("text"), type: "text", x: block.x, y: block.y, width: block.w, height: block.h, text: content, fontSize: block.size, fontWeight: block.weight, fill: color(block.color), textAnchor: block.align ?? "start" });
    } else if (block.type === "bullets") {
      const bullets = "bullets" in slide ? slide.bullets.slice(0, block.maxRows) : [];
      const rowH = Math.min(block.maxRowH, (block.yBottom - block.yTop) / Math.max(bullets.length, 1));
      bullets.forEach((text, i) => {
        const rowTop = block.yTop + i * rowH;
        const markerY = rowTop + (rowH - block.marker.h) / 2;
        els.push({ id: id("marker"), type: "rect", x: block.x + block.marker.dx, y: markerY, width: block.marker.w, height: block.marker.h, fill: color(block.marker.color), ...(block.marker.rx ? { rx: block.marker.rx } : {}) });
        els.push({ id: id("bullet"), type: "text", x: block.x + block.text.dx, y: rowTop, width: block.text.w, height: rowH, text, fontSize: block.text.size, fontWeight: block.text.weight, fill: color(block.text.color), textAnchor: "start" });
      });
    }
  }
  return els;
}

function makeFigure(title: string, elements: FigureElement[], font?: string): Figure {
  return {
    canvas: { width: CANVAS_W, height: CANVAS_H, background: "#FFFFFF", ...(font ? { fontFamily: font } : {}) },
    metadata: { title, description: "", skillId: "freeform", language: "zh" },
    elements
  };
}

// ── Public API (stable — pptx.ts & the /lab UI depend on these) ─────────────────

/** Build the Figure for a text slide (cover / section / bullets) under a template. */
export function textSlideToFigure(slide: DeckSlide, palette: DeckPalette, ctx: DeckChromeContext, templateId?: string): Figure {
  const tpl = getDeckTemplate(templateId);
  const font = tpl.tokens.fontFamily ?? palette.fontFamily;
  const master = slide.kind === "cover" ? tpl.masters.cover : slide.kind === "section" ? tpl.masters.section : tpl.masters.bullets;
  return makeFigure(slide.title, buildMaster(master, slide, tpl, palette, ctx), font);
}

/** Append the template's diagram chrome (e.g. a page-number footer) to a compiled diagram Figure. */
export function withDeckChrome(diagram: Figure, palette: DeckPalette, ctx: DeckChromeContext, templateId?: string): Figure {
  const tpl = getDeckTemplate(templateId);
  if (!tpl.masters.diagram) return diagram;
  // The diagram carries its own title/language; only overlay the chrome blocks.
  const placeholder: DeckSlide = { kind: "section", title: "" };
  const chrome = buildMaster({ blocks: tpl.masters.diagram.blocks }, placeholder, tpl, palette, ctx);
  return { ...diagram, elements: [...diagram.elements, ...chrome] };
}

// ── Validation ─────────────────────────────────────────────────────────────────
/**
 * Check a template's JSON constraints: every block stays on the 1280×720 canvas
 * and every color reference resolves. Returns a list of human-readable problems
 * (empty = valid). Run this whenever you author a new template.
 */
export function validateDeckTemplate(tpl: DeckTemplate): string[] {
  const issues: string[] = [];
  const samplePalette: DeckPalette = { background: "#FFFFFF", accent: "#33B1FF", text: "#0E1E36", subtext: "#5B6B80" };
  const color = colorResolver(tpl, samplePalette);
  const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const knownKeys = new Set(["accent", "ink", "surface", "muted", ...Object.keys(tpl.tokens.colors)]);

  const checkColor = (where: string, key: string) => {
    if (key.startsWith("#")) {
      if (!HEX.test(key)) issues.push(`${where}: invalid hex "${key}"`);
    } else if (!knownKeys.has(key)) {
      issues.push(`${where}: unknown color token "${key}"`);
    }
  };
  const checkBox = (where: string, x: number, y: number, w: number, h: number) => {
    if (x < 0 || y < 0 || x + w > CANVAS_W + 0.5 || y + h > CANVAS_H + 0.5) {
      issues.push(`${where}: off-canvas box x=${x} y=${y} w=${w} h=${h}`);
    }
  };

  for (const [kind, master] of Object.entries(tpl.masters) as Array<[string, SlideMaster | undefined]>) {
    if (!master) continue;
    if (master.background) checkColor(`${tpl.id}/${kind}/background`, master.background);
    master.blocks.forEach((block, i) => {
      const where = `${tpl.id}/${kind}/block[${i}]`;
      if (block.type === "rect") {
        checkColor(where, block.fill);
        checkBox(where, block.x, block.y, block.w, block.h);
      } else if (block.type === "text") {
        checkColor(where, block.color);
        checkBox(where, block.x, block.y, block.w, block.h);
        if (block.field === undefined && block.text === undefined) issues.push(`${where}: text block needs a "field" or "text"`);
        if (block.size <= 0) issues.push(`${where}: non-positive font size`);
      } else if (block.type === "bullets") {
        checkColor(`${where}/marker`, block.marker.color);
        checkColor(`${where}/text`, block.text.color);
        checkBox(where, block.x, block.yTop, block.text.dx + block.text.w, block.yBottom - block.yTop);
        if (block.yBottom <= block.yTop) issues.push(`${where}: yBottom must exceed yTop`);
        if (block.maxRows <= 0) issues.push(`${where}: maxRows must be positive`);
      }
    });
  }
  return issues;
}
