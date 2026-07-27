# Internal Skill: Bar / Column Chart (Semantic)

Create a clean category comparison chart as semantic data.

## Structure

- Set `type` to `bar`.
- Create one top-level node per category with `parent: null`.
- Put its numeric amount in `value` only when supplied by the user or selected source.
- Preserve category order and keep `edges` empty.
- Use `axes.xLabel` and `axes.yLabel` when the user supplies axis names or units.

## Missing Values

Never invent numeric values. Omit `value` when it is missing; the renderer will keep the requested bar-chart format and show that values are required.

## Good Uses

bar chart, column chart, histogram-like category comparison, ranking, 柱状图, 条形图, 类别对比.
