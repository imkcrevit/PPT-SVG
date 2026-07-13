// ─────────────────────────────────────────────────────────────────────────────
// DECK → SVG bridge
// ─────────────────────────────────────────────────────────────────────────────
// The single place where the deck skill invokes the svg skill. Every path that
// turns a diagram spec (or a fresh context + title) into a compiled diagram
// slide funnels through here, layered on top of the `@/features/svg` contract.
//
// Routes stay thin: the LLM round-trips (generate / repair) and their JSON
// parsing + validation live here, not scattered across app/api/lab/*.

import { parseJsonObject } from "@/lib/json";
import type { GenerateFigureRequest, InternalSkill } from "@/lib/types";
import {
  buildGenerateMessages,
  buildRepairMessages,
  callOpenRouter,
  getInternalSkill,
  validateAndNormalizeSemanticResponse,
  type DiagramTheme,
  type Locale,
  type SkillId
} from "@/features/svg";

import { compileDiagram, type DiagramCompileResult } from "./pipeline";
import type { DeckSlide } from "./types";

const GENERATE_MAX_TOKENS = 8_000;
const GENERATE_TIMEOUT_MS = 60_000;
const REPAIR_MAX_TOKENS = 8_000;
const REPAIR_TIMEOUT_MS = 30_000;

/**
 * Compile an already-produced diagram spec into a slide, and — if it fails
 * validation — run one svg-skill repair pass before giving up. Used by the
 * full-deck route when a model-authored diagram slide is invalid.
 */
export async function repairAndCompileDiagram(params: {
  diagram: Record<string, unknown>;
  title: string;
  skill: SkillId;
  theme: DiagramTheme;
  language: Locale;
}): Promise<{ result: DiagramCompileResult; repaired: boolean }> {
  const { diagram, title, skill, theme, language } = params;
  const first = compileDiagram(diagram, title, skill, theme, language);
  if (first.ok) {
    return { result: first, repaired: false };
  }

  try {
    const repairMessages = await buildRepairMessages(JSON.stringify(diagram), first.errors);
    const repairedRaw = await callOpenRouter(repairMessages, {
      temperature: 0,
      maxCompletionTokens: REPAIR_MAX_TOKENS,
      responseFormat: "json_object",
      timeoutMs: REPAIR_TIMEOUT_MS
    });
    const repaired = parseJsonObject(repairedRaw) as Record<string, unknown>;
    const retry = compileDiagram(repaired, title, skill, theme, language);
    if (retry.ok) {
      return { result: retry, repaired: true };
    }
  } catch {
    // fall through — caller degrades the slide to a plain section.
  }

  return { result: first, repaired: false };
}

/**
 * Generate a brand-new diagram slide from context + a title by invoking the svg
 * skill end to end (prompt → LLM → semantic validation → layout). Used by the
 * per-slide regenerate route.
 */
export async function generateDiagramSlide(params: {
  context: string;
  title: string;
  skillId: SkillId;
  theme: DiagramTheme;
  language: Locale;
}): Promise<{ ok: true; slide: DeckSlide } | { ok: false; error: string }> {
  const { context, title, skillId, theme, language } = params;
  const skill: InternalSkill | undefined = getInternalSkill(skillId);
  if (!skill) {
    return { ok: false, error: "Invalid skillId." };
  }

  const userDescription = [title ? `图表主题：${title}` : "", context ? `背景资料：${context}` : ""]
    .filter(Boolean)
    .join("\n");
  const generationRequest: GenerateFigureRequest = { skillId, userDescription, language };
  const messages = await buildGenerateMessages(generationRequest, skill);
  const rawOutput = await callOpenRouter(messages, {
    temperature: 0.3,
    maxCompletionTokens: GENERATE_MAX_TOKENS,
    timeoutMs: GENERATE_TIMEOUT_MS
  });

  let parsedFigure: unknown;
  try {
    parsedFigure = parseJsonObject(rawOutput);
  } catch {
    return { ok: false, error: "The generator returned invalid JSON." };
  }

  const validation = validateAndNormalizeSemanticResponse(parsedFigure, skillId, language, theme);
  if (!validation.ok || !validation.response) {
    return { ok: false, error: "The regenerated diagram was invalid." };
  }

  return {
    ok: true,
    slide: { kind: "diagram", title: title || validation.response.figure.metadata.title, figure: validation.response.figure }
  };
}
