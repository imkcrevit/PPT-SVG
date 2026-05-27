# SVG Quality Rules

The JSON will be rendered into SVG. Optimize for high-quality vector output:

- Use semantic vector primitives: rectangles, text, lines, arrows, and groups.
- Do not request raster images, screenshots, photos, or embedded PNG/JPEG content.
- Preserve readable text as text, not as outlined paths.
- Use 2-3 decimal places where useful; avoid unnecessary integer rounding.
- Keep labels short and presentation-ready.
- For Simplified Chinese output, remove "盘古之白" mixed-script spacing: do not insert half-width spaces between Chinese characters and half-width English letters, Arabic numerals, or symbols unless the user explicitly asks for that typography. Prefer compact Chinese UI text such as `AI生成`, `3步流程`, `API接口`, not `AI 生成`, `3 步流程`, or `API 接口`.
- For Simplified Chinese output, do not add spaces between ordinary Chinese characters or around full-width Chinese punctuation.
- Use clear visual hierarchy: title, structure, labels, connectors.
- Avoid decorative clutter. The output should work inside a business presentation.
- Avoid decorative side symbols, edge icons, corner marks, ornamental badges, and standalone symbols that do not carry user-requested information.
- Prefer balanced spacing, aligned edges, and consistent stroke widths.
- For text placed inside or over a background shape, make the text box share the shape's visual center. Set text `x`, `y`, `width`, and `height` so the label is horizontally and vertically centered within the background shape, and prefer `textAnchor: "middle"`.
- Step numbers and main text content should align to the center of their background area on both axes.
- Keep every text box and shape fully within its corresponding background area and within the canvas. Reduce font size or shorten wording before any text touches or crosses a shape boundary.
- For layouts with a large background panel, center the panel on the canvas, then center all cards, labels, connectors, and supporting content within that panel as one group.
- For layouts without a large background panel, center the full non-title visual group on the canvas.
