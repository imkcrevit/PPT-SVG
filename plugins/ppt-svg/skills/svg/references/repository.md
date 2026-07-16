# PPT-SVG repository map for SVG

Use the repository workflow only when the current checkout contains this project. Import the SVG feature through `@/features/svg`; do not reach into feature internals from other domains.

## Source of truth

| Concern | Location |
| --- | --- |
| Public feature exports | `src/features/svg/index.ts` |
| Diagram registry | `src/lib/types.ts`, `src/lib/skills.ts` |
| Grounding and generation prompts | `prompt/system/generate-figure.md`, `prompt/system/compress-context.md` |
| Per-diagram instructions | `prompt/skills/*.md` |
| Semantic validation | `src/lib/semantic-validation.ts`, `src/lib/semantic-figure-pipeline.ts` |
| Deterministic layout | `src/lib/layout-engine.ts`, `src/lib/layout-extra.ts` |
| SVG rendering | `src/components/figure-svg.tsx` |
| Editable PPTX rendering | `src/lib/pptx.ts` |
| HTTP generation | `POST /api/generate` |
| Multi-format bundle | `POST /api/export/bundle` |
| Public UI | `/svg/[locale]`, `src/components/workspace.tsx` |

The dependency direction is SVG outward: SVG must never import from `@/features/deck`. The deck feature composes SVG through its bridge.

## Checks

Run the smallest relevant checks, then the full gate before delivery:

```bash
npm run typecheck
npm run test:layout
npm run test:snapshots
npm run lint
npm run build
```
