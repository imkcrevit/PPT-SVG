# Internal Skill: Pie / Donut Chart (Semantic)

Create a clean composition or share chart as semantic data.

## Structure

- Set `type` to `pie`.
- Create one top-level node per slice with `parent: null`.
- Put the numeric amount or percentage in `value` only when the user or selected source provides it.
- Keep slice labels short and use `detail` only for a brief sourced note.
- Leave `edges` empty.

## Missing Values

Never invent percentages. If the request names categories but provides no numeric values, keep those nodes and omit `value`; the renderer will show a pie-shaped missing-data state instead of silently changing diagram type.

## Good Uses

pie chart, donut chart, composition, market share, usage share, percentage breakdown, 占比图, 饼图, 环形图.
