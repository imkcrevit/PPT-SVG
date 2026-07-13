# `features/deck` — the full-PPT (deck) skill

Turns a document / pasted context into an ordered, multi-slide deck and renders
it to a `.pptx`. Text slides (cover / section / bullets) carry copy; diagram
slides carry a compiled `Figure` produced by the **svg skill**, so every diagram
reuses the exact same layout + render path as single-diagram generation.

## Modules

| file                | role                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `types.ts`          | domain model — `Deck`, `DeckSlide`, `DeckPalette`                     |
| `prompts.ts`        | `buildDeckMessages` — the deck-outline system/user messages          |
| `pipeline.ts`       | validate + compile a raw model deck into a renderable `Deck`         |
| `diagram-bridge.ts` | **deck → svg contract** — LLM-backed diagram generate / repair       |
| `pptx.ts`           | `deckToPptx` — multi-slide PPTX (text slides here, diagrams via svg)  |
| `ui/lab-deck.tsx`   | the `/lab` conversational client UI                                  |
| `index.ts`          | the public barrel — consumers import from `@/features/deck` only      |

## Flow

```
context ─▶ buildDeckMessages ─▶ callOpenRouter ─▶ readDeck ─▶ classifySlide (per slide)
                                                               ├─ text    ─▶ textSlideFrom
                                                               └─ diagram ─▶ repairAndCompileDiagram ─┐
                                                                                                      │ (deck → svg)
                                                                          @/features/svg: validate + layoutDiagram
                                                                                                      │
                                             Deck ◀── buildPalette + slides ◀───────────────────────┘
                                              │
                                              ▼
                                          deckToPptx ─▶ .pptx
```

## deck → svg

All composition of the svg skill happens in `diagram-bridge.ts`:

- `repairAndCompileDiagram(...)` — compile a model-authored diagram spec, with
  one svg-skill repair pass before degrading to a section slide.
- `generateDiagramSlide(...)` — generate a fresh diagram slide from context +
  title, end to end through the svg skill (regenerate-one-slide).

See `.claude/skills/ppt-deck` for the standalone, callable skill wrapper.
