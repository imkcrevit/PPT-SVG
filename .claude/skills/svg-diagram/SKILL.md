---
name: svg-diagram
description: Generate or edit ONE SVG diagram (flow, matrix, timeline, pyramid, architecture, hierarchy, cycle, funnel, venn, mindmap, fishbone, gantt, swimlane, scatter, kanban, network, radar, heatmap, waterfall) in the PPT-SVG project. Use when a request is a single figure/chart from a text description, when adding/adjusting a diagram type, or when the ppt-deck skill needs a diagram slide.
---

# svg-diagram

The single-diagram capability of PPT-SVG: a natural-language request becomes a
validated semantic JSON diagram, laid out by the deterministic engine into a
`Figure`, and rendered to SVG / PPTX. The public contract is
**`src/features/svg`** — import from `@/features/svg` only, never from its
internals.

## Pipeline

```
request ─▶ buildGenerateMessages ─▶ callOpenRouter ─▶ validateAndNormalizeSemanticResponse
                                                            └▶ layoutDiagram ─▶ Figure ─▶ SVG / PPTX
```

## Where things live

| concern                | file                                                        |
| ---------------------- | ----------------------------------------------------------- |
| public contract        | `src/features/svg/index.ts` (+ `README.md`)                 |
| diagram-type registry  | `src/lib/skills.ts` (`INTERNAL_SKILLS`)                      |
| per-type prompts        | `prompt/skills/<type>.md`                                    |
| semantic validation     | `src/lib/semantic-validation.ts`, `semantic-figure-pipeline.ts` |
| layout engine           | `src/lib/layout-engine.ts`, `src/lib/layout-extra.ts`       |
| text measurement (truth)| `src/lib/text-layout.ts`                                     |
| PPTX render of a Figure | `src/lib/pptx.ts` (`figureToPptx`, `addFigureSlide`)        |
| HTTP entry points       | `POST /api/generate`, `POST /api/generate-agent`            |

## Invoke it (in code)

```ts
import {
  buildGenerateMessages, callOpenRouter, validateAndNormalizeSemanticResponse,
  layoutDiagram, resolveTheme, getInternalSkill
} from "@/features/svg";
```

Or over HTTP: `POST /api/generate` (or `/api/generate-agent` for the
status-streaming, self-reviewing variant) with `{ skillId, userDescription,
language }`.

## Add a new diagram type

1. Add the id to `SKILL_IDS` in `src/lib/types.ts` and the semantic union in
   `src/lib/semantic-types.ts`.
2. Register it in `INTERNAL_SKILLS` (`src/lib/skills.ts`) and write
   `prompt/skills/<id>.md`.
3. Add a layout function + dispatch in `layout-engine.ts` / `layout-extra.ts`.
4. Add assertions in `tests/diagram-layout-assertions.ts`; run `npm run
   test:layout` and `npm run test:snapshots`.

## Rules

- Box sizing MUST use the same measurement as rendering — go through
  `text-layout.ts` (`measureSvgText` / `estimateLineCount`), never re-implement
  width estimates (CJK truncation bugs come from divergence here).
- Keep the dependency direction one-way: this skill never imports from
  `@/features/deck`.

## Related

The **ppt-deck** skill composes this one to produce diagram slides inside a
full multi-slide deck. See `.claude/skills/ppt-deck`.
