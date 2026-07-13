# `features/svg` — the SVG diagram skill

Turns one natural-language request into a validated, laid-out `Figure` and
renders it to SVG / PPTX. This is the **single-diagram** capability that powers
the main workspace, and that the deck skill composes for its diagram slides.

## Public contract

Import from `@/features/svg` only — internals stay private.

```
prompt build   buildGenerateMessages · buildRepairMessages · buildVisualRevisionMessages · loadPrompt
transport      callOpenRouter · getConfiguredModelLabel · OpenRouterError
compile        validateAndNormalizeSemanticResponse · validateAndNormalizeSemanticDiagram
               validateAndNormalizeFigureResponse · layoutDiagram
registry       INTERNAL_SKILLS · getInternalSkill · isSkillId
theme          resolveTheme · mergeTheme · normalizeThemeOverride · pickReadableText · DiagramTheme
render (pptx)  createDeck · addFigureSlide · writeDeck · figureToPptx · pptxColor
types          Figure · FitAssessment · Locale · SkillId · InternalSkill
```

## Pipeline

```
request ──▶ buildGenerateMessages ──▶ callOpenRouter ──▶ validateAndNormalizeSemanticResponse
                                                              │
                                                              ▼
                                                        layoutDiagram ──▶ Figure ──▶ SVG / PPTX
```

## Boundary rule

Dependency direction is one-way: **deck → svg**. Nothing under `features/svg`
may import from `features/deck`.

See `.claude/skills/svg-diagram` for the standalone, callable skill wrapper.
