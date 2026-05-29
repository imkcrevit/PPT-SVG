# Internal Skill: Freeform (Semantic)

Create the clearest presentation visual for the user's request without forcing a fixed diagram type.

## Structure

- Choose the semantic structure that best matches the content: flow, matrix, timeline, hierarchy, architecture, gantt, swimlane, scatter, cycle, funnel, venn, mindmap, fishbone, framework, or summary.
- Set `type` to the closest available type: `freeform`, `flow`, `matrix`, `timeline`, `pyramid`, `architecture`, `hierarchy`, `cycle`, `funnel`, `venn`, `mindmap`, `fishbone`, `gantt`, `swimlane`, or `scatter`.
- If the user explicitly asks for `甘特图`, `Gantt`, a schedule with task bars, or task ranges such as `第1-2周`, choose `type: "gantt"` and provide numeric `start` / `end` for each task.
- Prefer clarity over novelty; make the node hierarchy and edges immediately understandable on a PowerPoint slide.
- Use concise labels. Put supporting explanation in `detail`.
- Use `parent` to express containment and `edges` to express relationships.

## Good Uses

requests that do not fit predefined diagram types, ambiguous visual briefs, custom frameworks, conceptual models, AI-selected layouts.

## Requirements

- Output language follows the active environment: `zh` Simplified Chinese, `en` English.
- Preserve all explicit user entities and relationships.
- Do not add decorative side symbols, edge icons, corner marks, ornamental badges, or standalone symbols.
- Do not output coordinates, sizes, colors, or shapes.
