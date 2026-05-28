# Internal Skill: Matrix (Semantic)

Create a presentation-ready matrix as a semantic graph.

## Structure

- Set `type` to `matrix`.
- Prefer a 2x2 matrix unless the user asks for another grid.
- Represent the matrix as a top-level container node.
- Create one child node for each quadrant/cell. Use short labels and optional `detail`.
- If row/column headers are explicit and important, represent them as child nodes or put them in the relevant cell `detail`.
- Use `edges` only when the user describes movement, dependency, or progression between cells.

## Good Uses

prioritization, positioning, segmentation, risk/value analysis, effort/impact analysis.

## Requirements

- Output language follows the active environment: `zh` Simplified Chinese, `en` English.
- Preserve every explicit quadrant/cell and ordering from the user.
- Do not output coordinates, sizes, colors, or shapes.
