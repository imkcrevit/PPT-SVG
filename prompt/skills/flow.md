# Internal Skill: Flow (Semantic)

Create a clean process flow as a semantic graph.

## Structure

- Set `type` to `flow`.
- Each main step is a top-level node (`parent: null`).
- Connect consecutive steps with `edges`: step1 -> step2 -> step3.
- Set `direction` to `horizontal` by default, or `vertical` if requested.
- Use `emphasis: "primary"` on start/end nodes when useful.
- Keep long sequences as one ordered chain with one node per step. Do not merge
  steps merely to force a single row; the layout engine automatically wraps
  longer horizontal chains into a multi-row serpentine path.

## Decompose Phases

When a step or phase contains several sub-steps, make the phase a top-level node and create one child node per sub-step, each with `parent` set to the phase.

Never cram a list of sub-steps into one phase label. If the user asks for many steps or gives a dense numbered list, produce that many discrete child nodes grouped under their phases.

## Pattern

```json
"direction": "horizontal",
"nodes": [
  { "id": "start", "label": "开始", "parent": null, "emphasis": "primary" },
  { "id": "phase1", "label": "准备", "parent": null },
  { "id": "p1-a", "label": "需求", "parent": "phase1" },
  { "id": "p1-b", "label": "调研", "parent": "phase1" },
  { "id": "phase2", "label": "设计", "parent": null },
  { "id": "p2-a", "label": "方案", "parent": "phase2" },
  { "id": "end", "label": "交付", "parent": null, "emphasis": "primary" }
],
"edges": [
  { "from": "start", "to": "phase1" },
  { "from": "phase1", "to": "phase2" },
  { "from": "phase2", "to": "end" }
]
```

## Good Uses

process, workflow, project plan, handoff sequence, lifecycle.

## Requirements

- Output language follows the active environment: `zh` Simplified Chinese, `en` English.
- Keep labels short; one step per label.
- Add `detail` for parameters or short notes when needed.
- Use `dashed: true` on an edge for feedback loops, retry/rewrite paths, optional links, or "go back to" links.
- Do not output coordinates, sizes, colors, or shapes.
