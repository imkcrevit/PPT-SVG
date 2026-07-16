# PPT-SVG repository map for PPT

Use the repository workflow only when the current checkout contains this project. Import deck functionality through `@/features/deck`; diagram work must cross the existing deck-to-SVG bridge.

## Source of truth

| Concern | Location |
| --- | --- |
| Public feature exports | `src/features/deck/index.ts` |
| Deck model | `src/features/deck/types.ts` |
| Source-grounded outline prompt | `prompt/system/generate-deck.md`, `src/features/deck/prompts.ts` |
| Deck parsing and validation | `src/features/deck/pipeline.ts` |
| Deck-to-SVG interop | `src/features/deck/diagram-bridge.ts` |
| Styles and templates | `src/features/deck/template.ts` |
| PPTX export | `src/features/deck/pptx.ts` |
| Full-deck HTTP generation | `POST /api/lab/deck` |
| Slide regeneration and export | `POST /api/lab/deck/slide`, `POST /api/lab/deck/export` |
| UI | `/[locale]/ppt`, `src/features/deck/ui/lab-deck.tsx` |

The dependency direction is one-way: deck may import `@/features/svg`; SVG must not import deck. Keep all diagram generation and repair in `diagram-bridge.ts`.

## Checks

Run the smallest relevant checks, then the full gate before delivery:

```bash
npm run typecheck
npm run test:deck
npm run test:theme
npm run lint
npm run build
```
