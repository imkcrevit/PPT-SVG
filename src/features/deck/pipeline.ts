// Validate + compile a raw LLM deck (JSON) into a renderable Deck. Diagram
// slides are run through the existing semantic validation + layout engine, so a
// deck reuses the exact same figure compilation as single-diagram generation.
//
// The pieces (readDeck / classifySlide / compileDiagram / textSlideFrom) are
// exported so the API route can attempt a per-slide repair on an invalid
// diagram before falling back, while validateAndCompileDeck stays a pure,
// synchronous path for tests and non-LLM callers.

import {
  isSkillId,
  layoutDiagram,
  validateAndNormalizeSemanticDiagram,
  type DiagramTheme,
  type Locale,
  type SkillId
} from "@/features/svg";
import { sanitizeDisplayText } from "@/lib/text-layout";

import type { Deck, DeckPalette, DeckSlide } from "./types";

export const MAX_DECK_SLIDES = 14;
const MAX_BULLETS = 8;

export interface DeckCompileResult {
  ok: boolean;
  deck?: Deck;
  errors: string[];
}

export interface ClassifiedTextSlide {
  kind: "cover" | "section" | "bullets";
  title: string;
  subtitle?: string;
  bullets?: string[];
}

export interface ClassifiedDiagramSlide {
  kind: "diagram";
  title: string;
  skill: SkillId;
  diagram: Record<string, unknown>;
}

export type ClassifiedSlide = ClassifiedTextSlide | ClassifiedDiagramSlide;

export interface DiagramCompileResult {
  ok: boolean;
  slide?: DeckSlide;
  errors: string[];
}

export function buildPalette(theme: DiagramTheme): DeckPalette {
  return {
    background: theme.background,
    accent: theme.accents[0]?.stroke ?? "#2F6FED",
    text: theme.text,
    subtext: theme.subtext,
    fontFamily: theme.fontFamily
  };
}

export function readDeck(value: unknown, expectedLanguage: Locale): { title: string; language: Locale; slidesRaw: unknown[] } | undefined {
  const root = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  if (!root) {
    return undefined;
  }
  const title = typeof root.title === "string" ? sanitizeDisplayText(root.title).slice(0, 120) || "Generated deck" : "Generated deck";
  const language: Locale = root.language === "zh" || root.language === "en" ? root.language : expectedLanguage;
  const slidesRaw = Array.isArray(root.slides) ? root.slides : [];
  return { title, language, slidesRaw };
}

export function classifySlide(raw: unknown): ClassifiedSlide | undefined {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
  if (!r) {
    return undefined;
  }
  const kind = r.kind;
  const title = typeof r.title === "string" ? sanitizeDisplayText(r.title).slice(0, 160) : "";

  if (kind === "cover") {
    return { kind: "cover", title: title || "Untitled", subtitle: optionalText(r.subtitle, 200) };
  }
  if (kind === "section") {
    return { kind: "section", title: title || "Section", subtitle: optionalText(r.subtitle, 200) };
  }
  if (kind === "bullets") {
    const bullets = (Array.isArray(r.bullets) ? r.bullets : [])
      .map((b) => (typeof b === "string" ? sanitizeDisplayText(b).slice(0, 200) : ""))
      .filter(Boolean)
      .slice(0, MAX_BULLETS);
    return { kind: "bullets", title: title || "Points", bullets };
  }
  if (kind === "diagram") {
    const diagram = r.diagram && typeof r.diagram === "object" && !Array.isArray(r.diagram) ? (r.diagram as Record<string, unknown>) : {};
    const skill: SkillId = typeof diagram.type === "string" && isSkillId(diagram.type) ? diagram.type : "flow";
    return { kind: "diagram", title, skill, diagram };
  }
  return undefined;
}

export function textSlideFrom(c: ClassifiedTextSlide): DeckSlide | undefined {
  if (c.kind === "cover") {
    return { kind: "cover", title: c.title, subtitle: c.subtitle };
  }
  if (c.kind === "section") {
    return { kind: "section", title: c.title, subtitle: c.subtitle };
  }
  // bullets
  if (!c.bullets || !c.bullets.length) {
    return c.title ? { kind: "section", title: c.title } : undefined;
  }
  return { kind: "bullets", title: c.title, bullets: c.bullets };
}

export function compileDiagram(
  diagram: Record<string, unknown>,
  title: string,
  skill: SkillId,
  theme: DiagramTheme,
  language: Locale
): DiagramCompileResult {
  // The deck keeps the heading on the slide, so the embedded diagram usually
  // omits title/language. Inject them so validation passes and the figure gets
  // a proper title.
  const merged = {
    ...diagram,
    title: (typeof diagram.title === "string" && diagram.title) || title || "Diagram",
    language
  };
  const validation = validateAndNormalizeSemanticDiagram(merged, skill, language);
  if (validation.ok && validation.diagram) {
    const figure = layoutDiagram(validation.diagram, { theme });
    return { ok: true, slide: { kind: "diagram", title: title || figure.metadata.title, figure }, errors: [] };
  }
  return { ok: false, errors: validation.errors };
}

export function validateAndCompileDeck(value: unknown, theme: DiagramTheme, expectedLanguage: Locale): DeckCompileResult {
  const shell = readDeck(value, expectedLanguage);
  if (!shell) {
    return { ok: false, errors: ["deck must be an object."] };
  }

  const errors: string[] = [];
  const slides: DeckSlide[] = [];
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
    const result = compileDiagram(classified.diagram, classified.title, classified.skill, theme, expectedLanguage);
    if (result.ok && result.slide) {
      slides.push(result.slide);
    } else {
      errors.push(`diagram "${classified.title || "(untitled)"}" invalid: ${result.errors.slice(0, 2).join("; ")}`);
      if (classified.title) {
        slides.push({ kind: "section", title: classified.title });
      }
    }
  }

  if (slides.length === 0) {
    return { ok: false, errors: errors.length ? errors : ["deck has no valid slides."] };
  }
  if (slides[0].kind !== "cover") {
    slides.unshift({ kind: "cover", title: shell.title });
  }

  return {
    ok: true,
    deck: { title: shell.title, language: shell.language, palette: buildPalette(theme), slides },
    errors
  };
}

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? sanitizeDisplayText(value).slice(0, max) || undefined : undefined;
}
