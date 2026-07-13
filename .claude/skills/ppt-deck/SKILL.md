---
name: ppt-deck
description: Generate a full multi-slide PPTX deck from a document or pasted context in the PPT-SVG project — cover/section/bullets text slides plus diagram slides. Use for "make a whole PPT / 整套 PPT", document-to-deck, template/style-driven decks, or work on the /lab feature. Composes the svg-diagram skill for every diagram slide.
---

# ppt-deck

The full-deck capability of PPT-SVG: a document/context becomes an ordered set
of slides and a downloadable `.pptx`. Text slides (cover / section / bullets)
carry copy; **diagram slides are produced by the svg-diagram skill**, so every
figure reuses the exact same layout + render path as single-diagram generation.
The public contract is **`src/features/deck`** — import from `@/features/deck`.

## Flow

```
context ─▶ buildDeckMessages ─▶ callOpenRouter ─▶ readDeck ─▶ classifySlide (per slide)
                                                              ├─ text    ─▶ textSlideFrom
                                                              └─ diagram ─▶ repairAndCompileDiagram ─┐
                                                                                                     │ deck → svg
                                                                          @/features/svg: validate + layoutDiagram
                                                              Deck ─▶ deckToPptx ─▶ .pptx  ◀──────────┘
```

## Where things live

| concern                    | file                                                    |
| -------------------------- | ------------------------------------------------------- |
| public contract            | `src/features/deck/index.ts` (+ `README.md`)            |
| domain model               | `src/features/deck/types.ts` (`Deck`, `DeckSlide`)      |
| deck-outline prompt        | `src/features/deck/prompts.ts`, `prompt/system/generate-deck.md` |
| validate + compile         | `src/features/deck/pipeline.ts`                         |
| **deck → svg bridge**      | `src/features/deck/diagram-bridge.ts`                   |
| multi-slide PPTX render    | `src/features/deck/pptx.ts` (`deckToPptx`)             |
| conversational UI          | `src/features/deck/ui/lab-deck.tsx` → `/lab`            |
| HTTP entry points          | `POST /api/lab/deck`, `/api/lab/deck/slide`, `/api/lab/deck/export` |

## How it composes svg-diagram

All invocation of the svg-diagram skill happens in **`diagram-bridge.ts`**, the
single deck → svg boundary:

- `repairAndCompileDiagram(...)` — compile a model-authored diagram spec; on
  validation failure, run one svg-skill repair pass before degrading the slide
  to a plain section.
- `generateDiagramSlide(...)` — generate a fresh diagram slide from context +
  title, end to end through svg-diagram (used by "regenerate this slide").

Both are layered on `@/features/svg`. The dependency direction is one-way: deck
imports svg, never the reverse.

## Invoke it (in code)

```ts
import { buildDeckMessages, readDeck, classifySlide, repairAndCompileDiagram, deckToPptx } from "@/features/deck";
```

Or over HTTP: `POST /api/lab/deck` with `{ context, language, styleHint?,
attachments? }` → `{ deck, warnings, pptxBase64 }`.

## Notes

- `MAX_DECK_SLIDES` caps a deck; the first slide is forced to a cover.
- An uploaded PPTX template's extracted theme wins over a text style hint; both
  are optional (falls back to the default theme).
- Server-only modules (`deckToPptx`, prompts, bridge) must not reach the client
  bundle — the `/lab` UI type-imports from `@/features/deck/types`.

## Related

Every diagram slide delegates to the **svg-diagram** skill. See
`.claude/skills/svg-diagram`.
