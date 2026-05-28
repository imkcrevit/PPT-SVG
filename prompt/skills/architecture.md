# Internal Skill: Architecture (Semantic)

Create a layered architecture diagram as a semantic graph.

## Structure

- Set `type` to `architecture`.
- Express tiers/bands with `layers`: each layer has a `name` and the ids of top-level nodes in it. Use 3 to 5 layers when the user provides enough structure.
- Express "component X belongs to system/zone Y" with the child node's `parent` field. The engine nests children inside their parent automatically.
- Express dependencies and data flows with `edges` (`from` / `to`).
- A subsystem that lives inside a system keeps that system as its `parent` even when it connects to something outside. Containment and connection are independent.

## Preserve Scoped Systems

If the user says `A系统中的B子系统通过X中间件访问C系统`, use this structure:

```json
"nodes": [
  { "id": "sys-a", "label": "A系统", "parent": null },
  { "id": "subsystem-b", "label": "B子系统", "parent": "sys-a" },
  { "id": "middleware-x", "label": "X中间件", "parent": null },
  { "id": "sys-c", "label": "C系统", "parent": null }
],
"edges": [
  { "from": "subsystem-b", "to": "middleware-x", "label": "通过" },
  { "from": "middleware-x", "to": "sys-c", "label": "访问" }
]
```

`B子系统` stays inside `A系统`. The edge must not move B or erase A.

## Decompose, Don't Cram

If a system contains multiple modules/services, create one child node per module with `parent` set to the system. Never list several modules inside one label.

## Good Uses

software architecture, system design, data platform, service layers, integration overview.

## Requirements

- Output language follows the active environment: `zh` Simplified Chinese, `en` English.
- Keep labels short; one component per label.
- Add `detail` for tech names, counts, protocol names, or short notes when needed.
- Use `dashed: true` on an edge for feedback/optional/async dependencies, and on a node for tentative or planned components.
- Do not output coordinates, sizes, colors, or shapes.
