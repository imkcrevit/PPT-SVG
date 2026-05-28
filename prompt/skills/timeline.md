# Internal Skill: Timeline (Semantic)

Create a clear timeline as a semantic graph.

## Structure

- Set `type` to `timeline`.
- Set `direction` to `horizontal` by default.
- Create one top-level node per milestone, phase, release, date, or event.
- Connect milestones in order with `edges`.
- Put dates/phases in `label` when short; use `detail` for supporting milestone text.

## Good Uses

roadmap, release plan, project phases, historical sequence, implementation schedule.

## Requirements

- Output language follows the active environment: `zh` Simplified Chinese, `en` English.
- Preserve the user's exact milestone order and named dates.
- Use `dashed: true` for tentative future milestones only when the user implies uncertainty.
- Do not output coordinates, sizes, colors, or shapes.
