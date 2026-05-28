# SVG Quality Rules

The semantic JSON will be rendered into SVG and PPTX by a deterministic layout engine. Optimize the semantic graph for high-quality vector output:

- Do not request raster images, screenshots, photos, or embedded PNG/JPEG content.
- Preserve readable text as text-bearing node labels and details.
- Keep labels short and presentation-ready; put supporting explanation in `detail`.
- For Simplified Chinese output, remove "盘古之白" mixed-script spacing: do not insert half-width spaces between Chinese characters and half-width English letters, Arabic numerals, or symbols unless the user explicitly asks for that typography. Prefer compact Chinese UI text such as `AI生成`, `3步流程`, `API接口`, not `AI 生成`, `3 步流程`, or `API 接口`.
- For Simplified Chinese output, do not add spaces between ordinary Chinese characters or around full-width Chinese punctuation.
- Use clear visual hierarchy through structure: title, top-level nodes, child nodes, layers, and connectors.
- Avoid decorative clutter. The output should work inside a business presentation.
- Avoid decorative side symbols, edge icons, corner marks, ornamental badges, and standalone symbols that do not carry user-requested information.
- Keep every explicit user-provided entity represented as a node or relationship.
- Preserve scoped parent-child relationships with `parent`.
- Preserve explicit access mechanisms and named intermediaries as nodes or edge labels.
- Prefer concise node labels over long multi-idea labels. Split lists into child nodes.
- Do not output coordinates, sizes, colors, or style values; the engine handles balanced spacing, alignment, centering, and text fitting.
