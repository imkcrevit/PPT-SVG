// ─────────────────────────────────────────────────────────────────────────────
// DECK SKILL — public contract
// ─────────────────────────────────────────────────────────────────────────────
// The "turn a document/context into a full multi-slide PPTX" capability. It
// composes the svg skill (`@/features/svg`) for its diagram slides via
// `diagram-bridge`. Consumers (the app/api/lab routes and /ppt/[locale] UI)
// import from `@/features/deck` only — the individual modules stay internal.

// -- Domain model -------------------------------------------------------------
export type { Deck, DeckSlide, DeckPalette } from "./types";

// -- Prompt construction ------------------------------------------------------
export { buildDeckMessages, type DeckGenerationInput } from "./prompts";

// -- Validation + compilation (raw model deck → renderable Deck) --------------
export {
  MAX_DECK_SLIDES,
  buildPalette,
  readDeck,
  classifySlide,
  textSlideFrom,
  compileDiagram,
  validateAndCompileDeck,
  type ClassifiedSlide,
  type ClassifiedTextSlide,
  type ClassifiedDiagramSlide,
  type DiagramCompileResult,
  type DeckCompileResult
} from "./pipeline";

// -- deck → svg bridge (LLM-backed diagram generation / repair) ---------------
export { repairAndCompileDiagram, generateDiagramSlide } from "./diagram-bridge";

// -- Rendering ----------------------------------------------------------------
export { deckToPptx } from "./pptx";

// -- Template (selectable built-ins + derived from an uploaded .pptx) ----------
export {
  DECK_STYLE_OPTIONS,
  DECK_TEMPLATES,
  getDeckTemplate,
  isDeckTemplateId,
  validateDeckTemplate,
  type DeckStyleOption,
  type DeckTemplate
} from "./template";
export { extractDeckTemplateFromPptx } from "./template-extract";
