# Internal Skill: Pyramid (Semantic)

Create a layered pyramid, funnel, hierarchy, or value stack as a semantic graph.

## Structure

- Set `type` to `pyramid`.
- Set `direction` to `vertical`.
- Create one top-level node per layer, ordered from top to bottom unless the user explicitly gives bottom-to-top order.
- Use `detail` for supporting text on each layer.
- If a layer contains multiple explicit capabilities/items, create child nodes with `parent` set to that layer.
- Use `edges` only for explicit dependencies or progression.

## Good Uses

hierarchy, maturity model, value stack, capability layers, strategic priorities.

## Requirements

- Output language follows the active environment: `zh` Simplified Chinese, `en` English.
- Preserve every explicit layer and its order.
- Do not output coordinates, sizes, colors, or shapes.
