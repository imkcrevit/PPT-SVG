// Validate + compile a raw LLM deck (JSON) into a renderable Deck. Diagram
// slides are run through the existing semantic validation + layout engine, so a
// deck reuses the exact same figure compilation as single-diagram generation.

import type { Deck, DeckSlide } from "@/lib/deck-types";
import { layoutDiagram } from "@/lib/layout-engine";
import { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";
import { isSkillId } from "@/lib/skills";
import { sanitizeDisplayText } from "@/lib/text-layout";
import type { DiagramTheme } from "@/lib/theme";
import type { Locale, SkillId } from "@/lib/types";

const MAX_SLIDES = 14;
const MAX_BULLETS = 8;

export interface DeckCompileResult {
  ok: boolean;
  deck?: Deck;
  errors: string[];
}

export function validateAndCompileDeck(value: unknown, theme: DiagramTheme, expectedLanguage: Locale): DeckCompileResult {
  const errors: string[] = [];
  const root = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  if (!root) {
    return { ok: false, errors: ["deck must be an object."] };
  }

  const title = typeof root.title === "string" ? sanitizeDisplayText(root.title).slice(0, 120) || "Generated deck" : "Generated deck";
  const language: Locale = root.language === "zh" || root.language === "en" ? root.language : expectedLanguage;
  const rawSlides = Array.isArray(root.slides) ? root.slides : [];

  const slides: DeckSlide[] = [];
  for (const raw of rawSlides) {
    if (slides.length >= MAX_SLIDES) {
      break;
    }
    const slide = compileSlide(raw, theme, language, errors);
    if (slide) {
      slides.push(slide);
    }
  }

  if (slides.length === 0) {
    return { ok: false, errors: errors.length ? errors : ["deck has no valid slides."] };
  }

  if (slides[0].kind !== "cover") {
    slides.unshift({ kind: "cover", title });
  }

  const deck: Deck = {
    title,
    language,
    palette: {
      background: theme.background,
      accent: theme.accents[0]?.stroke ?? "#2F6FED",
      text: theme.text,
      subtext: theme.subtext,
      fontFamily: theme.fontFamily
    },
    slides
  };

  return { ok: true, deck, errors };
}

function compileSlide(raw: unknown, theme: DiagramTheme, language: Locale, errors: string[]): DeckSlide | undefined {
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
    if (!bullets.length) {
      return title ? { kind: "section", title } : undefined;
    }
    return { kind: "bullets", title: title || "Points", bullets };
  }

  if (kind === "diagram") {
    const diagramRecord = r.diagram && typeof r.diagram === "object" ? (r.diagram as Record<string, unknown>) : undefined;
    const skill: SkillId = typeof diagramRecord?.type === "string" && isSkillId(diagramRecord.type) ? diagramRecord.type : "flow";
    // The deck keeps the heading on the slide, so the embedded diagram usually
    // omits title/language. Inject them so validation passes and the figure gets
    // a proper title (rendered at the top of the diagram).
    const merged = {
      ...(diagramRecord ?? {}),
      title: (typeof diagramRecord?.title === "string" && diagramRecord.title) || title || "Diagram",
      language
    };
    const validation = validateAndNormalizeSemanticDiagram(merged, skill, language);
    if (validation.ok && validation.diagram) {
      const figure = layoutDiagram(validation.diagram, { theme });
      return { kind: "diagram", title: title || figure.metadata.title, figure };
    }
    // Keep the deck flowing: degrade an unrenderable diagram to a section header.
    errors.push(`diagram slide "${title || "(untitled)"}" invalid: ${validation.errors.slice(0, 2).join("; ")}`);
    return title ? { kind: "section", title } : undefined;
  }

  return undefined;
}

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? sanitizeDisplayText(value).slice(0, max) || undefined : undefined;
}
