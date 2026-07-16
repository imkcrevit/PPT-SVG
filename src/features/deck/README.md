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
| `template.ts`       | **declarative slide design system** — templates as JSON data          |
| `pptx.ts`           | `deckToPptx` — multi-slide PPTX (text slides here, diagrams via svg)  |
| `ui/lab-deck.tsx`   | the public `/ppt/[locale]` conversational client UI                  |
| `index.ts`          | the public barrel — consumers import from `@/features/deck` only      |

## Designing a deck template (`template.ts`)

A template is **data**, not code. It has design tokens plus, per slide kind, a
`master` — an ordered list of positioned blocks on a fixed 1280×720 canvas. An
interpreter turns `(template + slide + context)` into a Figure of plain
`rect`/`text`/`image` elements, so the SVG preview and the PPTX export render it
identically and the layout is literally constrained by JSON.

Seven built-in categories are registered today: dark tech, corporate blue,
academic paper, civic red, natural green, creative studio, and minimal
editorial. Each one supplies its own cover, section, TOC, bullets, image,
image+bullets, and diagram masters plus a matching SVG diagram theme.

To add another look: define a template, change tokens/coordinates, give it a
unique `id`, and append it to `DECK_TEMPLATES`. Then run `npm run test:deck`
(`validateDeckTemplate` checks every block stays on-canvas and every color
reference resolves).

- **Colors** — a block's color is a literal hex or a token key. Keys resolve
  from the template's `tokens.colors` **plus** four palette-derived keys so a
  template inherits the deck's palette (uploaded template / style hint):
  `accent`→palette.accent, `ink`→palette.text, `surface`→palette.background,
  `muted`→palette.subtext.
- **Text content** — a `text` block uses either a literal `text` (a string, or
  `{zh,en}` for language-aware labels) or a `field`: `title` · `subtitle` ·
  `pageNumber` · `deckTitle` · `sectionNo`. Empty content → the block is skipped.
- **Bullets** — one `bullets` block per bullets master lays out the slide's
  bullets between `yTop`/`yBottom` (capped at `maxRows`), each with a marker rect
  and a wrapped text run.
- **Blocks** are `rect` | `text` | `bullets` | `image`; `masters.diagram.blocks` overlay a
  compiled diagram (e.g. the page-number footer) via `withDeckChrome`.

`Deck.templateId` selects a built-in style end to end. `textSlideToFigure` /
`withDeckChrome` accept either that id or a full uploaded template; an uploaded
template takes precedence while the id remains a safe export fallback.

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

See `.claude/skills/ppt` for the repository wrapper and
`plugins/ppt-svg/skills/ppt` for the installable canonical skill.
