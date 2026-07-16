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
import type { DiagramTheme } from "@/lib/theme";

import type { DeckPalette, DeckSlide } from "./types";

// ── Canvas ───────────────────────────────────────────────────────────────────
const CANVAS_W = 1280;
const CANVAS_H = 720;

// ── Template schema (author these) ─────────────────────────────────────────────
export type Align = "start" | "middle" | "end";
export type LangText = string | { zh: string; en: string };
export type TextField = "title" | "subtitle" | "pageNumber" | "deckTitle" | "sectionNo" | "caption";

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
  /** Render a zero-padded ordinal ("01", "02", …) in place of the square marker. */
  numbered?: { dx: number; w: number; size: number; weight: number; color: string };
}

/** Draws the slide's `src` image inside a fixed box. Used by image slides. */
export interface ImageBlock {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  fit?: "contain" | "cover" | "stretch";
}

export type TemplateBlock = RectBlock | TextBlock | BulletsBlock | ImageBlock;

export interface SlideMaster {
  /** Full-canvas background color (hex or token key). */
  background?: string;
  blocks: TemplateBlock[];
}

export interface DeckTemplate {
  id: string;
  name: { zh: string; en: string };
  /** Optional discovery metadata for built-in selectable templates. */
  category?: { zh: string; en: string };
  description?: { zh: string; en: string };
  preview?: { background: string; foreground: string; accents: string[] };
  /** Built-in diagram theme; uploaded templates derive their theme separately. */
  theme?: DiagramTheme;
  tokens: {
    colors: Record<string, string>;
    fontFamily?: string;
  };
  masters: {
    cover: SlideMaster;
    section: SlideMaster;
    /** Table-of-contents page. Falls back to the bullets master when absent. */
    toc?: SlideMaster;
    bullets: SlideMaster;
    /** Full-width image page. Falls back to bullets master when absent. */
    image?: SlideMaster;
    /** Image + bullets split page. */
    imageBullets?: SlideMaster;
    /** Overlay blocks added on top of a compiled diagram (e.g. title + footer). */
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

// ── Built-in template: 暗色科技 / Dark Tech ─────────────────────────────────────
const M = 92; // page margin used by this template's coordinates

const TECH_TEMPLATE: DeckTemplate = {
  id: "tech",
  name: { zh: "暗色科技", en: "Dark Tech" },
  category: { zh: "科技互联网", en: "Technology" },
  description: { zh: "深色封面、冷色高亮，适合AI、软件与数字化方案。", en: "Dark covers and cool accents for AI, software, and digital products." },
  preview: { background: "#0E1E36", foreground: "#EAF1FB", accents: ["#33B1FF", "#7A5AC4", "#2E9E76"] },
  theme: {
    accents: [
      { stroke: "#33B1FF", tint: "#E8F7FF" },
      { stroke: "#7A5AC4", tint: "#F0EAFA" },
      { stroke: "#2E9E76", tint: "#E7F5EF" },
      { stroke: "#2F6FED", tint: "#EAF1FE" }
    ],
    text: "#0E1E36",
    subtext: "#5B6B80",
    edge: "#52607A",
    background: "#FFFFFF",
    fontFamily: "Microsoft YaHei",
    source: "default"
  },
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
    // Table of contents: same title header as content pages, numbered entries.
    toc: {
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
          marker: { dx: 0, w: 0, h: 0, color: "accent" },
          numbered: { dx: 0, w: 44, size: 22, weight: 800, color: "accent" },
          text: { dx: 58, w: CANVAS_W - (M + 58) - M, size: 20, weight: 600, color: "ink" }
        },
        { type: "rect", x: M, y: 662, w: CANVAS_W - 2 * M, h: 1.5, fill: "ruleLight" },
        { type: "text", x: M, y: 676, w: 640, h: 24, field: "deckTitle", size: 13, weight: 500, color: "muted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: 676, w: 160, h: 24, field: "pageNumber", size: 14, weight: 600, color: "muted", align: "end" }
      ]
    },
    // Full-width image page: same title header, image fit-contained below it,
    // optional caption under the image.
    image: {
      background: "surface",
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 6, fill: "accent" },
        { type: "text", x: M, y: 74, w: 1040, h: 70, field: "title", size: 32, weight: 800, color: "ink", align: "start" },
        { type: "rect", x: M + 2, y: 150, w: 104, h: 6, fill: "accent" },
        { type: "image", x: M, y: 178, w: CANVAS_W - 2 * M, h: 420, fit: "contain" },
        { type: "text", x: M, y: 612, w: CANVAS_W - 2 * M, h: 28, field: "caption", size: 15, weight: 400, color: "muted", align: "middle" },
        { type: "text", x: M, y: 676, w: 640, h: 24, field: "deckTitle", size: 13, weight: 500, color: "muted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: 676, w: 160, h: 24, field: "pageNumber", size: 14, weight: 600, color: "muted", align: "end" }
      ]
    },
    // Image + bullets: image on the left, points on the right.
    imageBullets: {
      background: "surface",
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 6, fill: "accent" },
        { type: "text", x: M, y: 74, w: 1040, h: 70, field: "title", size: 32, weight: 800, color: "ink", align: "start" },
        { type: "rect", x: M + 2, y: 150, w: 104, h: 6, fill: "accent" },
        { type: "image", x: M, y: 190, w: 560, h: 400, fit: "contain" },
        {
          type: "bullets",
          x: M + 620,
          yTop: 210,
          yBottom: 600,
          maxRows: 6,
          maxRowH: 84,
          marker: { dx: 0, w: 12, h: 12, color: "accent", rx: 3 },
          text: { dx: 34, w: CANVAS_W - (M + 620 + 34) - M, size: 20, weight: 500, color: "ink" }
        },
        { type: "rect", x: M, y: 662, w: CANVAS_W - 2 * M, h: 1.5, fill: "ruleLight" },
        { type: "text", x: M, y: 676, w: 640, h: 24, field: "deckTitle", size: 13, weight: 500, color: "muted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: 676, w: 160, h: 24, field: "pageNumber", size: 14, weight: 600, color: "muted", align: "end" }
      ]
    },
    // Diagram overlay: the SAME title header + footer as content pages, so every
    // non-cover slide's title sits at exactly (M, 74). The compiled diagram's own
    // title is stripped in withDeckChrome() and redrawn here.
    diagram: {
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 6, fill: "accent" },
        { type: "text", x: M, y: 74, w: 1040, h: 70, field: "title", size: 32, weight: 800, color: "ink", align: "start" },
        { type: "rect", x: M + 2, y: 150, w: 104, h: 6, fill: "accent" },
        { type: "text", x: M, y: CANVAS_H - 40, w: 640, h: 22, field: "deckTitle", size: 13, weight: 500, color: "muted", align: "start" },
        { type: "text", x: CANVAS_W - M - 160, y: CANVAS_H - 40, w: 160, h: 22, field: "pageNumber", size: 14, weight: 600, color: "muted", align: "end" }
      ]
    }
  }
};

type CategoryVariant = "corporate" | "academic" | "formal" | "nature" | "creative" | "minimal";

interface CategoryTemplateSpec {
  id: string;
  name: { zh: string; en: string };
  category: { zh: string; en: string };
  description: { zh: string; en: string };
  eyebrow: { zh: string; en: string };
  variant: CategoryVariant;
  theme: DiagramTheme;
  colors: {
    brand: string;
    brandDark: string;
    brandSoft: string;
    accent2: string;
    onBrand: string;
    onBrandMuted: string;
    panel: string;
    rule: string;
  };
  fontFamily?: string;
}

function createCategoryTemplate(spec: CategoryTemplateSpec): DeckTemplate {
  const m = spec.variant === "creative" ? 106 : spec.variant === "minimal" ? 74 : 88;
  const titleY = spec.variant === "academic" ? 66 : 62;
  const ruleY = 148;
  const bodyTop = 194;
  const bodyBottom = 628;
  const footerY = 676;

  const header = (): TemplateBlock[] => {
    const title: TextBlock = {
      type: "text",
      x: m,
      y: titleY,
      w: CANVAS_W - m * 2,
      h: 70,
      field: "title",
      size: spec.variant === "academic" ? 30 : 32,
      weight: spec.variant === "academic" ? 700 : 800,
      color: "ink",
      align: spec.variant === "academic" ? "middle" : "start"
    };

    switch (spec.variant) {
      case "corporate":
        return [
          { type: "rect", x: 0, y: 0, w: 30, h: CANVAS_H, fill: "brandDark" },
          title,
          { type: "rect", x: m, y: ruleY, w: 132, h: 6, fill: "brand" }
        ];
      case "academic":
        return [
          { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 4, fill: "brand" },
          title,
          { type: "rect", x: 250, y: ruleY, w: 780, h: 2, fill: "brand" }
        ];
      case "formal":
        return [
          { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 16, fill: "brandDark" },
          title,
          { type: "rect", x: m, y: ruleY, w: CANVAS_W - 2 * m, h: 2, fill: "accent2" }
        ];
      case "nature":
        return [
          { type: "rect", x: 58, y: 56, w: 10, h: 86, fill: "brand", rx: 5 },
          title,
          { type: "rect", x: m, y: ruleY, w: 180, h: 5, fill: "brand", rx: 2 }
        ];
      case "creative":
        return [
          { type: "rect", x: 0, y: 0, w: 54, h: CANVAS_H, fill: "brandDark" },
          { type: "rect", x: 54, y: 0, w: 16, h: 166, fill: "accent2" },
          title,
          { type: "rect", x: m, y: ruleY, w: 154, h: 8, fill: "accent2", rx: 4 }
        ];
      case "minimal":
        return [
          title,
          { type: "rect", x: m, y: ruleY, w: CANVAS_W - 2 * m, h: 2, fill: "ink" }
        ];
    }
  };

  const footer = (): TemplateBlock[] => [
    { type: "rect", x: m, y: 662, w: CANVAS_W - 2 * m, h: spec.variant === "formal" ? 2 : 1, fill: spec.variant === "formal" ? "accent2" : "rule" },
    { type: "text", x: m, y: footerY, w: 660, h: 22, field: "deckTitle", size: 12, weight: 500, color: "muted", align: "start" },
    { type: "text", x: CANVAS_W - m - 160, y: footerY, w: 160, h: 22, field: "pageNumber", size: 13, weight: 700, color: "muted", align: "end" }
  ];

  const darkFooter = (): TemplateBlock[] => [
    { type: "rect", x: m, y: 662, w: CANVAS_W - 2 * m, h: 1, fill: "accent2" },
    { type: "text", x: m, y: footerY, w: 660, h: 22, field: "deckTitle", size: 12, weight: 500, color: "onBrandMuted", align: "start" },
    { type: "text", x: CANVAS_W - m - 160, y: footerY, w: 160, h: 22, field: "pageNumber", size: 13, weight: 700, color: "onBrandMuted", align: "end" }
  ];

  const splitCoverFooter = (): TemplateBlock[] => [
    { type: "rect", x: m, y: 662, w: CANVAS_W - 2 * m, h: 1, fill: "rule" },
    { type: "text", x: m, y: footerY, w: 240, h: 22, field: "deckTitle", size: 12, weight: 500, color: "onBrandMuted", align: "start" },
    { type: "text", x: CANVAS_W - m - 160, y: footerY, w: 160, h: 22, field: "pageNumber", size: 13, weight: 700, color: "muted", align: "end" }
  ];

  const panel = (): TemplateBlock[] => {
    if (spec.variant === "academic" || spec.variant === "minimal") return [];
    return [
      {
        type: "rect",
        x: m - 22,
        y: bodyTop - 14,
        w: CANVAS_W - 2 * (m - 22),
        h: bodyBottom - bodyTop + 28,
        fill: "panel",
        rx: spec.variant === "nature" ? 24 : spec.variant === "creative" ? 18 : 8
      }
    ];
  };

  const bullets = (numbered = false, x = m, width = CANVAS_W - 2 * m): BulletsBlock => ({
    type: "bullets",
    x,
    yTop: bodyTop,
    yBottom: bodyBottom,
    maxRows: 8,
    maxRowH: 76,
    marker: numbered
      ? { dx: 0, w: 0, h: 0, color: "brand" }
      : {
          dx: 0,
          w: spec.variant === "academic" ? 8 : 12,
          h: spec.variant === "academic" ? 8 : 12,
          color: spec.variant === "creative" ? "accent2" : "brand",
          rx: spec.variant === "nature" || spec.variant === "creative" ? 6 : 2
        },
    ...(numbered ? { numbered: { dx: 0, w: 48, size: 21, weight: 800, color: "brand" } } : {}),
    text: {
      dx: numbered ? 60 : 34,
      w: width - (numbered ? 60 : 34),
      size: spec.variant === "academic" ? 19 : 20,
      weight: spec.variant === "academic" ? 500 : 600,
      color: "ink"
    }
  });

  const cover: SlideMaster = (() => {
    switch (spec.variant) {
      case "corporate":
        return {
          background: "surface",
          blocks: [
            { type: "rect", x: 0, y: 0, w: 350, h: CANVAS_H, fill: "brandDark" },
            { type: "rect", x: 72, y: 112, w: 92, h: 8, fill: "accent2" },
            { type: "text", x: 72, y: 136, w: 220, h: 34, text: spec.eyebrow, size: 15, weight: 700, color: "onBrand", align: "start" },
            { type: "text", x: 410, y: 230, w: 760, h: 190, field: "title", size: 52, weight: 800, color: "ink", align: "start" },
            { type: "rect", x: 412, y: 446, w: 170, h: 6, fill: "brand" },
            { type: "text", x: 410, y: 476, w: 720, h: 92, field: "subtitle", size: 23, weight: 400, color: "muted", align: "start" },
            ...footer()
          ]
        };
      case "academic":
        return {
          background: "surface",
          blocks: [
            { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 5, fill: "brand" },
            { type: "text", x: 180, y: 112, w: 920, h: 32, text: spec.eyebrow, size: 14, weight: 600, color: "brand", align: "middle" },
            { type: "text", x: 150, y: 230, w: 980, h: 190, field: "title", size: 48, weight: 700, color: "ink", align: "middle" },
            { type: "rect", x: 490, y: 446, w: 300, h: 2, fill: "accent2" },
            { type: "text", x: 220, y: 478, w: 840, h: 80, field: "subtitle", size: 21, weight: 400, color: "muted", align: "middle" },
            ...splitCoverFooter()
          ]
        };
      case "formal":
        return {
          background: "brandDark",
          blocks: [
            { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 16, fill: "accent2" },
            { type: "text", x: 160, y: 126, w: 960, h: 34, text: spec.eyebrow, size: 16, weight: 700, color: "accent2", align: "middle" },
            { type: "text", x: 140, y: 248, w: 1000, h: 180, field: "title", size: 50, weight: 800, color: "onBrand", align: "middle" },
            { type: "rect", x: 500, y: 454, w: 280, h: 3, fill: "accent2" },
            { type: "text", x: 220, y: 486, w: 840, h: 72, field: "subtitle", size: 22, weight: 400, color: "onBrandMuted", align: "middle" },
            { type: "text", x: 88, y: footerY, w: 640, h: 22, field: "deckTitle", size: 12, weight: 500, color: "onBrandMuted", align: "start" },
            { type: "text", x: 1032, y: footerY, w: 160, h: 22, field: "pageNumber", size: 13, weight: 700, color: "onBrandMuted", align: "end" }
          ]
        };
      case "nature":
        return {
          background: "surface",
          blocks: [
            { type: "rect", x: 0, y: 0, w: 382, h: CANVAS_H, fill: "brandDark" },
            { type: "rect", x: 76, y: 112, w: 128, h: 8, fill: "accent2", rx: 4 },
            { type: "text", x: 76, y: 140, w: 250, h: 34, text: spec.eyebrow, size: 15, weight: 700, color: "onBrand", align: "start" },
            { type: "text", x: 450, y: 238, w: 720, h: 190, field: "title", size: 50, weight: 800, color: "ink", align: "start" },
            { type: "text", x: 450, y: 466, w: 680, h: 96, field: "subtitle", size: 22, weight: 400, color: "muted", align: "start" },
            ...splitCoverFooter()
          ]
        };
      case "creative":
        return {
          background: "brandDark",
          blocks: [
            { type: "rect", x: 0, y: 0, w: 52, h: CANVAS_H, fill: "accent2" },
            { type: "rect", x: 940, y: 0, w: 340, h: 128, fill: "brand" },
            { type: "rect", x: 1060, y: 510, w: 220, h: 210, fill: "accent2" },
            { type: "text", x: 104, y: 112, w: 620, h: 34, text: spec.eyebrow, size: 15, weight: 800, color: "accent2", align: "start" },
            { type: "text", x: 104, y: 236, w: 970, h: 200, field: "title", size: 54, weight: 800, color: "onBrand", align: "start" },
            { type: "text", x: 104, y: 474, w: 760, h: 92, field: "subtitle", size: 23, weight: 400, color: "onBrandMuted", align: "start" },
            { type: "text", x: 104, y: footerY, w: 640, h: 22, field: "deckTitle", size: 12, weight: 500, color: "onBrandMuted", align: "start" },
            { type: "text", x: 1032, y: footerY, w: 160, h: 22, field: "pageNumber", size: 13, weight: 700, color: "onBrandMuted", align: "end" }
          ]
        };
      case "minimal":
        return {
          background: "surface",
          blocks: [
            { type: "rect", x: 74, y: 92, w: 42, h: 42, fill: "ink" },
            { type: "text", x: 136, y: 98, w: 500, h: 28, text: spec.eyebrow, size: 13, weight: 700, color: "muted", align: "start" },
            { type: "text", x: 74, y: 224, w: 1080, h: 210, field: "title", size: 56, weight: 800, color: "ink", align: "start" },
            { type: "rect", x: 74, y: 470, w: 1132, h: 3, fill: "ink" },
            { type: "text", x: 74, y: 500, w: 820, h: 82, field: "subtitle", size: 22, weight: 400, color: "muted", align: "start" },
            ...footer()
          ]
        };
    }
  })();

  const section: SlideMaster = (() => {
    if (spec.variant === "academic") {
      return {
        background: "surface",
        blocks: [
          { type: "text", x: 440, y: 118, w: 400, h: 230, field: "sectionNo", size: 190, weight: 700, color: "brandSoft", align: "middle" },
          { type: "text", x: 170, y: 318, w: 940, h: 120, field: "title", size: 46, weight: 700, color: "ink", align: "middle" },
          { type: "rect", x: 510, y: 464, w: 260, h: 2, fill: "brand" },
          { type: "text", x: 240, y: 492, w: 800, h: 70, field: "subtitle", size: 20, weight: 400, color: "muted", align: "middle" },
          ...footer()
        ]
      };
    }
    if (spec.variant === "formal" || spec.variant === "nature") {
      return {
        background: "brandDark",
        blocks: [
          { type: "text", x: 930, y: 152, w: 260, h: 260, field: "sectionNo", size: 210, weight: 800, color: spec.variant === "formal" ? "accent2" : "brand", align: "end" },
          { type: "text", x: 88, y: 286, w: 900, h: 140, field: "title", size: 48, weight: 800, color: "onBrand", align: "start" },
          { type: "rect", x: 88, y: 454, w: 180, h: 5, fill: "accent2", rx: 2 },
          { type: "text", x: 88, y: 486, w: 780, h: 72, field: "subtitle", size: 21, weight: 400, color: "onBrandMuted", align: "start" },
          ...darkFooter()
        ]
      };
    }
    if (spec.variant === "creative") {
      return {
        background: "surface",
        blocks: [
          { type: "rect", x: 0, y: 0, w: 70, h: CANVAS_H, fill: "brandDark" },
          { type: "rect", x: 70, y: 0, w: 22, h: 230, fill: "accent2" },
          { type: "text", x: 910, y: 122, w: 280, h: 250, field: "sectionNo", size: 220, weight: 800, color: "brandSoft", align: "end" },
          { type: "text", x: 126, y: 292, w: 900, h: 140, field: "title", size: 50, weight: 800, color: "ink", align: "start" },
          { type: "rect", x: 126, y: 462, w: 190, h: 8, fill: "accent2", rx: 4 },
          { type: "text", x: 126, y: 496, w: 760, h: 72, field: "subtitle", size: 21, weight: 400, color: "muted", align: "start" },
          ...footer()
        ]
      };
    }
    return {
      background: spec.variant === "corporate" ? "brandDark" : "surface",
      blocks: [
        { type: "text", x: 900, y: 150, w: 300, h: 270, field: "sectionNo", size: 220, weight: 800, color: spec.variant === "corporate" ? "brand" : "brandSoft", align: "end" },
        { type: "text", x: 88, y: 294, w: 900, h: 140, field: "title", size: 50, weight: 800, color: spec.variant === "corporate" ? "onBrand" : "ink", align: "start" },
        { type: "rect", x: 88, y: 462, w: 180, h: spec.variant === "minimal" ? 3 : 6, fill: spec.variant === "minimal" ? "ink" : "accent2" },
        { type: "text", x: 88, y: 494, w: 760, h: 72, field: "subtitle", size: 21, weight: 400, color: spec.variant === "corporate" ? "onBrandMuted" : "muted", align: "start" },
        ...(spec.variant === "corporate" ? darkFooter() : footer())
      ]
    };
  })();

  const imageX = m;
  const imageW = CANVAS_W - 2 * m;
  const splitImageW = 520;
  const splitBulletX = m + 580;
  const splitBulletW = CANVAS_W - splitBulletX - m;

  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    description: spec.description,
    preview: {
      background: spec.variant === "creative" || spec.variant === "formal" ? spec.colors.brandDark : spec.theme.background,
      foreground: spec.variant === "creative" || spec.variant === "formal" ? spec.colors.onBrand : spec.theme.text,
      accents: spec.theme.accents.slice(0, 3).map((accent) => accent.stroke)
    },
    theme: spec.theme,
    tokens: {
      colors: spec.colors,
      fontFamily: spec.fontFamily ?? spec.theme.fontFamily
    },
    masters: {
      cover,
      section,
      toc: { background: "surface", blocks: [...header(), ...panel(), bullets(true), ...footer()] },
      bullets: { background: "surface", blocks: [...header(), ...panel(), bullets(false), ...footer()] },
      image: {
        background: "surface",
        blocks: [
          ...header(),
          ...panel(),
          { type: "image", x: imageX, y: bodyTop, w: imageW, h: 384, fit: "contain" },
          { type: "text", x: imageX, y: 592, w: imageW, h: 30, field: "caption", size: 14, weight: 400, color: "muted", align: "middle" },
          ...footer()
        ]
      },
      imageBullets: {
        background: "surface",
        blocks: [
          ...header(),
          ...panel(),
          { type: "image", x: imageX, y: bodyTop + 10, w: splitImageW, h: 386, fit: "contain" },
          bullets(false, splitBulletX, splitBulletW),
          ...footer()
        ]
      },
      diagram: { blocks: [...header(), ...footer()] }
    }
  };
}

const CATEGORY_TEMPLATES: DeckTemplate[] = [
  createCategoryTemplate({
    id: "corporate",
    name: { zh: "商务蓝白", en: "Corporate Blue" },
    category: { zh: "商务汇报", en: "Business" },
    description: { zh: "稳健蓝白与清晰分栏，适合公司介绍、经营汇报和方案提案。", en: "Structured blue-and-white layouts for company, operations, and proposals." },
    eyebrow: { zh: "商务汇报", en: "BUSINESS REVIEW" },
    variant: "corporate",
    theme: {
      accents: [
        { stroke: "#1E5AA8", tint: "#E7F0FB" },
        { stroke: "#2D7FB8", tint: "#E7F4FA" },
        { stroke: "#3D8B73", tint: "#E8F4F0" },
        { stroke: "#C78431", tint: "#FAF0E2" }
      ],
      text: "#10243E",
      subtext: "#5E6F82",
      edge: "#58708A",
      background: "#F6F8FB",
      fontFamily: "Microsoft YaHei",
      source: "default"
    },
    colors: { brand: "#1E5AA8", brandDark: "#12365D", brandSoft: "#DCE9F7", accent2: "#5DA9E9", onBrand: "#F7FAFF", onBrandMuted: "#B9CCE2", panel: "#FFFFFF", rule: "#D8E0EA" }
  }),
  createCategoryTemplate({
    id: "academic",
    name: { zh: "学术论文", en: "Academic Paper" },
    category: { zh: "教育科研", en: "Academic" },
    description: { zh: "暖白纸张、居中标题与细线秩序，适合论文答辩和研究报告。", en: "Warm paper, centered headings, and fine rules for research and thesis defense." },
    eyebrow: { zh: "研究报告", en: "RESEARCH REPORT" },
    variant: "academic",
    theme: {
      accents: [
        { stroke: "#7A3036", tint: "#F4E8E8" },
        { stroke: "#A07A36", tint: "#F6F0E4" },
        { stroke: "#356C73", tint: "#E7F0F1" },
        { stroke: "#675A86", tint: "#EEEAF4" }
      ],
      text: "#2D2926",
      subtext: "#716A63",
      edge: "#766D65",
      background: "#FBF8F1",
      fontFamily: "Noto Serif CJK SC",
      source: "default"
    },
    colors: { brand: "#7A3036", brandDark: "#502126", brandSoft: "#EADDDD", accent2: "#B38A3A", onBrand: "#FFFDF8", onBrandMuted: "#DDCFCA", panel: "#FFFDF8", rule: "#D9D0C5" },
    fontFamily: "Noto Serif CJK SC"
  }),
  createCategoryTemplate({
    id: "government",
    name: { zh: "政务红金", en: "Civic Red" },
    category: { zh: "政务申报", en: "Government" },
    description: { zh: "庄重红金与对称结构，适合政务汇报、申报材料和正式发布。", en: "Formal red-and-gold symmetry for government, applications, and official reports." },
    eyebrow: { zh: "汇报材料", en: "OFFICIAL REPORT" },
    variant: "formal",
    theme: {
      accents: [
        { stroke: "#B3202A", tint: "#F8E7E8" },
        { stroke: "#D09A32", tint: "#FAF0DD" },
        { stroke: "#8C4A3C", tint: "#F3E9E7" },
        { stroke: "#6B7351", tint: "#EEF0E8" }
      ],
      text: "#3B211E",
      subtext: "#7A625D",
      edge: "#805B55",
      background: "#FFF8F0",
      fontFamily: "Microsoft YaHei",
      source: "default"
    },
    colors: { brand: "#B3202A", brandDark: "#8E1820", brandSoft: "#F2D9D9", accent2: "#D6A84B", onBrand: "#FFF9F0", onBrandMuted: "#E9C9BE", panel: "#FFFFFF", rule: "#E6D6CA" }
  }),
  createCategoryTemplate({
    id: "nature",
    name: { zh: "自然生态", en: "Natural Green" },
    category: { zh: "环保健康", en: "Nature & Health" },
    description: { zh: "柔和绿意、圆角卡片与舒展留白，适合环保、医疗和生活方式主题。", en: "Soft greens, rounded cards, and calm spacing for nature, health, and lifestyle." },
    eyebrow: { zh: "可持续发展", en: "SUSTAINABILITY" },
    variant: "nature",
    theme: {
      accents: [
        { stroke: "#4B7A5A", tint: "#E6EFE8" },
        { stroke: "#2F756E", tint: "#E3F0EE" },
        { stroke: "#C08747", tint: "#F7EDDF" },
        { stroke: "#748A48", tint: "#EEF1E5" }
      ],
      text: "#183B2A",
      subtext: "#607468",
      edge: "#587361",
      background: "#F3F7F1",
      fontFamily: "Microsoft YaHei",
      source: "default"
    },
    colors: { brand: "#4B7A5A", brandDark: "#244D37", brandSoft: "#DCEADF", accent2: "#C58B49", onBrand: "#F7FBF6", onBrandMuted: "#BBD0C1", panel: "#FFFFFF", rule: "#D6E1D7" }
  }),
  createCategoryTemplate({
    id: "creative",
    name: { zh: "创意品牌", en: "Creative Studio" },
    category: { zh: "品牌创意", en: "Creative" },
    description: { zh: "紫色主场、珊瑚撞色与非对称构图，适合品牌、活动和创意提案。", en: "Purple, coral contrast, and asymmetric composition for brands and campaigns." },
    eyebrow: { zh: "创意提案", en: "CREATIVE PROPOSAL" },
    variant: "creative",
    theme: {
      accents: [
        { stroke: "#7656D8", tint: "#EEEAFB" },
        { stroke: "#F06F63", tint: "#FDEAE8" },
        { stroke: "#3187C8", tint: "#E7F2FA" },
        { stroke: "#D29B2D", tint: "#FAF1DE" }
      ],
      text: "#2A2140",
      subtext: "#716880",
      edge: "#665B7D",
      background: "#F8F5FF",
      fontFamily: "Microsoft YaHei",
      source: "default"
    },
    colors: { brand: "#7656D8", brandDark: "#322255", brandSoft: "#E8E0FA", accent2: "#FF7A6B", onBrand: "#FFFFFF", onBrandMuted: "#D8CCEA", panel: "#FFFFFF", rule: "#DED7EB" }
  }),
  createCategoryTemplate({
    id: "minimal",
    name: { zh: "极简咨询", en: "Minimal Editorial" },
    category: { zh: "咨询报告", en: "Consulting" },
    description: { zh: "黑白强排版与单一强调色，适合咨询结论、战略报告和高层简报。", en: "Monochrome typography with one accent for strategy, consulting, and executive briefs." },
    eyebrow: { zh: "执行摘要", en: "EXECUTIVE BRIEF" },
    variant: "minimal",
    theme: {
      accents: [
        { stroke: "#171717", tint: "#EFEFEC" },
        { stroke: "#E4513D", tint: "#FBE9E6" },
        { stroke: "#5C6B73", tint: "#EBEEF0" },
        { stroke: "#8A743A", tint: "#F2EEE4" }
      ],
      text: "#171717",
      subtext: "#666666",
      edge: "#4D4D4D",
      background: "#FFFFFF",
      fontFamily: "Microsoft YaHei",
      source: "default"
    },
    colors: { brand: "#171717", brandDark: "#111111", brandSoft: "#E8E8E5", accent2: "#E4513D", onBrand: "#FFFFFF", onBrandMuted: "#BDBDBD", panel: "#F5F5F2", rule: "#D7D7D2" }
  })
];

export const DECK_TEMPLATES: DeckTemplate[] = [TECH_TEMPLATE, ...CATEGORY_TEMPLATES];

export interface DeckStyleOption {
  id: string;
  name: { zh: string; en: string };
  category: { zh: string; en: string };
  description: { zh: string; en: string };
  preview: { background: string; foreground: string; accents: string[] };
}

export const DECK_STYLE_OPTIONS: DeckStyleOption[] = DECK_TEMPLATES.map((template) => ({
  id: template.id,
  name: template.name,
  category: template.category ?? template.name,
  description: template.description ?? template.name,
  preview: template.preview ?? {
    background: template.theme?.background ?? "#FFFFFF",
    foreground: template.theme?.text ?? "#1D2433",
    accents: template.theme?.accents.slice(0, 3).map((accent) => accent.stroke) ?? ["#2F6FED"]
  }
}));

export function isDeckTemplateId(value: unknown): value is string {
  return typeof value === "string" && DECK_TEMPLATES.some((template) => template.id === value);
}

export function getDeckTemplate(id?: string): DeckTemplate {
  return DECK_TEMPLATES.find((t) => t.id === id) ?? DECK_TEMPLATES[0];
}

/** Accept either a full template object (e.g. derived from an upload) or an id. */
export type TemplateRef = DeckTemplate | string | undefined;
function resolveTemplate(template: TemplateRef): DeckTemplate {
  return template && typeof template !== "string" ? template : getDeckTemplate(template);
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
    case "caption":
      return "caption" in slide ? slide.caption ?? "" : "";
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
      const rows = "bullets" in slide ? slide.bullets : "items" in slide ? slide.items : [];
      const list = rows.slice(0, block.maxRows);
      const rowH = Math.min(block.maxRowH, (block.yBottom - block.yTop) / Math.max(list.length, 1));
      list.forEach((text, i) => {
        const rowTop = block.yTop + i * rowH;
        if (block.numbered) {
          els.push({ id: id("num"), type: "text", x: block.x + block.numbered.dx, y: rowTop, width: block.numbered.w, height: rowH, text: String(i + 1).padStart(2, "0"), fontSize: block.numbered.size, fontWeight: block.numbered.weight, fill: color(block.numbered.color), textAnchor: "start" });
        } else if (block.marker.w > 0 && block.marker.h > 0) {
          const markerY = rowTop + (rowH - block.marker.h) / 2;
          els.push({ id: id("marker"), type: "rect", x: block.x + block.marker.dx, y: markerY, width: block.marker.w, height: block.marker.h, fill: color(block.marker.color), ...(block.marker.rx ? { rx: block.marker.rx } : {}) });
        }
        els.push({ id: id("bullet"), type: "text", x: block.x + block.text.dx, y: rowTop, width: block.text.w, height: rowH, text, fontSize: block.text.size, fontWeight: block.text.weight, fill: color(block.text.color), textAnchor: "start" });
      });
    } else if (block.type === "image") {
      const src = "src" in slide ? slide.src : "";
      if (src) {
        els.push({ id: id("img"), type: "image", x: block.x, y: block.y, width: block.w, height: block.h, src, fit: block.fit ?? "contain" });
      }
    }
  }
  return els;
}

function makeFigure(title: string, elements: FigureElement[], font?: string, language: "zh" | "en" = "zh"): Figure {
  return {
    canvas: { width: CANVAS_W, height: CANVAS_H, background: "#FFFFFF", ...(font ? { fontFamily: font } : {}) },
    metadata: { title, description: "", skillId: "freeform", language },
    elements
  };
}

// ── Public API (stable — pptx.ts and the /[locale]/ppt UI depend on these) ─────

/** Build the Figure for a text slide (cover / section / bullets) under a template. */
export function textSlideToFigure(slide: DeckSlide, palette: DeckPalette, ctx: DeckChromeContext, template?: TemplateRef): Figure {
  const tpl = resolveTemplate(template);
  const font = tpl.tokens.fontFamily ?? palette.fontFamily;
  const master =
    slide.kind === "cover"
      ? tpl.masters.cover
      : slide.kind === "section"
        ? tpl.masters.section
        : slide.kind === "toc"
          ? tpl.masters.toc ?? tpl.masters.bullets
          : slide.kind === "image"
            ? tpl.masters.image ?? tpl.masters.bullets
            : slide.kind === "image-bullets"
              ? tpl.masters.imageBullets ?? tpl.masters.bullets
              : tpl.masters.bullets;
  return makeFigure(slide.title, buildMaster(master, slide, tpl, palette, ctx), font, ctx.language);
}

/** Append the template's diagram chrome (e.g. a page-number footer) to a compiled diagram Figure. */
export function withDeckChrome(diagram: Figure, palette: DeckPalette, ctx: DeckChromeContext, template?: TemplateRef): Figure {
  const tpl = resolveTemplate(template);
  if (!tpl.masters.diagram) return diagram;
  // The diagram lays out its own title at a layout-specific spot; strip it and
  // let the template redraw the title at the SAME (M, 74) as every content page,
  // so no two slides put their title at different coordinates.
  const body = diagram.elements.filter((el) => el.id !== "figure-title-text");
  const placeholder: DeckSlide = { kind: "section", title: diagram.metadata.title };
  const chrome = buildMaster({ blocks: tpl.masters.diagram.blocks }, placeholder, tpl, palette, ctx);
  return { ...diagram, elements: [...body, ...chrome] };
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
        if (block.numbered) checkColor(`${where}/numbered`, block.numbered.color);
        checkBox(where, block.x, block.yTop, block.text.dx + block.text.w, block.yBottom - block.yTop);
        if (block.yBottom <= block.yTop) issues.push(`${where}: yBottom must exceed yTop`);
        if (block.maxRows <= 0) issues.push(`${where}: maxRows must be positive`);
      } else if (block.type === "image") {
        checkBox(where, block.x, block.y, block.w, block.h);
      }
    });
  }
  return issues;
}
