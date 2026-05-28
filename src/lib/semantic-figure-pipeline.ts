import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { layoutDiagram } from "@/lib/layout-engine";
import { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";
import { sanitizeDisplayText } from "@/lib/text-layout";
import type { FitAssessment, GenerateFigureResponse, Locale, SkillId } from "@/lib/types";

interface ValidationResult {
  ok: boolean;
  response?: GenerateFigureResponse;
  errors: string[];
}

export function validateAndNormalizeSemanticResponse(
  value: unknown,
  expectedSkillId: SkillId,
  expectedLanguage: Locale
): ValidationResult {
  if (isLegacyFigureResponse(value)) {
    return validateAndNormalizeFigureResponse(value, expectedSkillId, expectedLanguage);
  }

  const semanticValidation = validateAndNormalizeSemanticDiagram(value, expectedSkillId, expectedLanguage);

  if (!semanticValidation.diagram) {
    return {
      ok: false,
      errors: semanticValidation.errors
    };
  }

  if (!semanticValidation.ok) {
    return {
      ok: false,
      errors: semanticValidation.errors
    };
  }

  // The deterministic layout engine is the single source of truth. Do not run
  // validateAndNormalizeFigureResponse over its output: that path applies the
  // legacy geometric normalizer for model-placed coordinates and can detach
  // labels from their boxes or stack bands on top of each other.
  const figure = layoutDiagram(semanticValidation.diagram);
  figure.metadata.skillId = expectedSkillId;
  figure.metadata.language = expectedLanguage;

  const fit = readFit(value);

  return {
    ok: true,
    response: { figure, fit },
    errors: semanticValidation.errors
  };
}

function isLegacyFigureResponse(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "figure" in value);
}

function readFit(value: unknown): FitAssessment {
  const root = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const fit = root.fit && typeof root.fit === "object" && !Array.isArray(root.fit) ? (root.fit as Record<string, unknown>) : {};

  return {
    score: typeof fit.score === "number" && Number.isFinite(fit.score) ? clamp(fit.score, 0, 1) : 0.85,
    note: typeof fit.note === "string" ? sanitizeDisplayText(fit.note).slice(0, 180) : ""
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
