# Figure JSON Contract (Semantic)

Return exactly one JSON object that describes a **semantic graph**. Do not write coordinates, sizes, colors, shapes, canvas, or absolute positions. A deterministic layout engine converts the graph to SVG and PPTX.

```json
{
  "diagram": {
    "type": "architecture",
    "title": "Short title",
    "description": "One sentence description",
    "language": "zh",
    "direction": "horizontal",
    "nodes": [
      { "id": "sys-a", "label": "A系统", "parent": null },
      { "id": "subsystem-b", "label": "B子系统", "parent": "sys-a" },
      { "id": "middleware-x", "label": "X中间件", "parent": null },
      { "id": "sys-c", "label": "C系统", "parent": null }
    ],
    "edges": [
      { "from": "subsystem-b", "to": "middleware-x", "label": "通过" },
      { "from": "middleware-x", "to": "sys-c", "label": "访问" }
    ],
    "layers": [
      { "name": "业务系统", "nodeIds": ["sys-a"] },
      { "name": "集成层", "nodeIds": ["middleware-x"] },
      { "name": "外部系统", "nodeIds": ["sys-c"] }
    ]
  },
  "fit": { "score": 0.9, "note": "Optional short note" }
}
```

## Relationships

There are two independent relationships. Keep them separate.

1. Containment means "X is inside Y" and is expressed only by a node's `parent`.
   If `B子系统` belongs to `A系统`, node `subsystem-b` has `"parent": "sys-a"`. The engine draws B inside A.
2. Connection means "X links to Y" and is expressed only by `edges`.
   If B accesses C through X, create nodes for B, X, and C, then create edges using their ids.

Adding an edge must never change or erase a node's `parent`.

## Preserve User Intent

- Preserve every explicit entity, ordering, relationship, label, constraint, and revision from the user.
- Preserve scoped entity labels and qualifiers. If the user says `A系统中的B子系统`, show both A and B through parent/child structure. Do not shorten it to only `B子系统`.
- Preserve named intermediaries and mechanisms. If the user says `B子系统通过X中间件访问C系统`, the diagram must include `B子系统`, `X中间件`, `C系统`, and the access relationship.
- Do not invent unstated goals, metrics, dates, actors, stages, product names, causal relationships, or business context.
- If the user's purpose is unclear, use only explicit text and lower `fit.score`; do not silently choose a default purpose.

## Decomposition

A `label` names exactly one item. Do not put multiple comma-separated, slash-separated, numbered, or joined items into one label.

If a phase, system, or module contains multiple discrete sub-items, create one child node per sub-item and set each child's `parent` to the container node.

Wrong:

```json
{ "id": "phase1", "label": "阶段1：01需求 02调研 03对比 04估算", "parent": null }
```

Right:

```json
{ "id": "phase1", "label": "阶段1", "parent": null },
{ "id": "p1-req", "label": "需求", "parent": "phase1" },
{ "id": "p1-survey", "label": "调研", "parent": "phase1" },
{ "id": "p1-compare", "label": "对比", "parent": "phase1" },
{ "id": "p1-estimate", "label": "估算", "parent": "phase1" }
```

## Fields

- `type`: one of `freeform`, `flow`, `matrix`, `timeline`, `pyramid`, `architecture`. Match the selected skill when possible.
- `language`: `zh` for Simplified Chinese, `en` for English.
- `direction`: optional `horizontal` or `vertical`.
- `nodes`: up to 40 nodes. Every node has `id`, `label`, and `parent`.
- `id`: unique, lowercase, stable. It is referenced by `parent`, `from`, and `to`.
- `label`: visible name for one item. Keep it short.
- `detail`: optional supporting text. Use it for tech names, counts, parameters, or brief explanation.
- `parent`: `null` or an existing node id.
- `emphasis`: optional `primary`, `muted`, or `normal`.
- `dashed`: optional `true` on a node for tentative/planned/placeholder items.
- `edges`: connections between existing node ids.
- `edge.label`: optional short relationship word.
- `edge.dashed`: optional `true` for feedback loops, retry/rewrite paths, optional links, or async links.
- `layers`: optional for architecture. Each layer names a band and lists top-level node ids.

## Output Rules

- Output the semantic graph only. No `x`, `y`, `width`, `height`, `canvas`, `elements`, `fill`, `stroke`, or pixel/style values.
- Every `id` must be unique. Every `parent` must be `null` or an existing id. Every edge endpoint must be an existing id. No parent cycles.
- Valid JSON only: quoted keys/strings, commas between items, balanced brackets, no comments, no markdown fences, no trailing commas, and no prose outside the object.
