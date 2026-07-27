# Internal Skill: Line / Trend Chart (Semantic)

Create a clean ordered trend chart as semantic data.

## Structure

- Set `type` to `line`.
- Create one top-level node per ordered point with `parent: null`.
- Put the numeric measurement in `value` only when supplied by the user or selected source.
- Preserve chronological or user-provided order and keep `edges` empty.
- Use `axes.xLabel` and `axes.yLabel` when the user supplies axis names or units.

## Missing Values

Never invent measurements. Omit `value` when it is missing; the renderer will keep a line-chart frame and clearly request values.

## Good Uses

line chart, trend, time series, area-chart intent, 折线图, 曲线图, 趋势图, 时间序列.
