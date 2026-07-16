// ─────────────────────────────────────────────────────────────────────────────
// SVG SKILL — public contract
// ─────────────────────────────────────────────────────────────────────────────
// This barrel is the single, stable surface for the "generate one SVG diagram"
// capability. Everything a *caller* needs to turn a natural-language request
// into a validated, laid-out Figure (and render it to SVG/PPTX) is re-exported
// here. Internals (layout-engine, semantic-validation, text-layout, …) stay
// private; consumers import from `@/features/svg` only.
//
// The deck skill (`@/features/deck`) composes this contract to build diagram
// slides — see `features/deck/diagram-bridge.ts`. Keeping the boundary explicit
// is what lets the two capabilities be lifted into standalone, mutually
// callable skills (see `.claude/skills/svg` and `plugins/ppt-svg/skills/svg`).
//
// Dependency direction is one-way: deck → svg. `@/features/svg` must never
// import from `@/features/deck`.

// -- Prompt construction ------------------------------------------------------
export {
  buildGenerateMessages,
  buildRepairMessages,
  buildVisualRevisionMessages,
  loadPrompt,
  type ChatMessage,
  type ChatContentPart
} from "@/lib/prompts";

// -- LLM transport ------------------------------------------------------------
export {
  callOpenRouter,
  getConfiguredModelLabel,
  OpenRouterError
} from "@/lib/openrouter";

// -- Validation + compilation (raw model output → Figure) ---------------------
export { validateAndNormalizeSemanticResponse } from "@/lib/semantic-figure-pipeline";
export { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";
export { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
export { layoutDiagram } from "@/lib/layout-engine";

// -- Skills registry (diagram types) ------------------------------------------
export { INTERNAL_SKILLS, getInternalSkill, isSkillId } from "@/lib/skills";

// -- Theme --------------------------------------------------------------------
export { resolveTheme, mergeTheme, normalizeThemeOverride, pickReadableText, type DiagramTheme } from "@/lib/theme";

// -- PPTX primitives (render a single Figure into a slide) --------------------
export {
  createDeck,
  addFigureSlide,
  writeDeck,
  figureToPptx,
  pptxColor,
  SLIDE_WIDTH_IN,
  SLIDE_HEIGHT_IN,
  PPTX_DEFAULT_FONT_FACE
} from "@/lib/pptx";

// -- Shared types -------------------------------------------------------------
export type { Figure, FitAssessment, Locale, SkillId, InternalSkill } from "@/lib/types";
