# Figure JSON Contract

Return exactly one JSON object with this shape:

```json
{
  "figure": {
    "canvas": {
      "width": 1280,
      "height": 720,
      "background": "#FFFFFF"
    },
    "metadata": {
      "title": "Short title",
      "description": "One sentence description",
      "skillId": "flow",
      "language": "en"
    },
    "elements": []
  },
  "fit": {
    "score": 0.9,
    "note": "Optional short note"
  }
}
```

Allowed element types:

```json
{
  "id": "unique-id",
  "type": "group",
  "name": "Group name",
  "children": []
}
```

```json
{
  "id": "unique-id",
  "type": "rect",
  "name": "Shape name",
  "x": 100,
  "y": 100,
  "width": 220,
  "height": 90,
  "rx": 14,
  "fill": "#FFFFFF",
  "stroke": "#1D2433",
  "strokeWidth": 2
}
```

```json
{
  "id": "unique-id",
  "type": "text",
  "name": "Text name",
  "x": 120,
  "y": 125,
  "width": 180,
  "height": 48,
  "text": "Label",
  "fontSize": 24,
  "fontWeight": 600,
  "fill": "#1D2433",
  "textAnchor": "middle"
}
```

```json
{
  "id": "unique-id",
  "type": "line",
  "name": "Line name",
  "x1": 100,
  "y1": 100,
  "x2": 300,
  "y2": 100,
  "stroke": "#1D2433",
  "strokeWidth": 2
}
```

```json
{
  "id": "unique-id",
  "type": "arrow",
  "name": "Arrow name",
  "x1": 100,
  "y1": 100,
  "x2": 300,
  "y2": 100,
  "stroke": "#1D2433",
  "strokeWidth": 2
}
```

Rules:
- Use a 1280 x 720 canvas unless the user explicitly asks for a square or 4:3 layout.
- Keep all geometry within the canvas.
- Every element id must be unique, lowercase, and stable.
- Text should be concise enough to fit in its box.
- Keep the response compact: no more than 42 total elements, including nested children. For system architecture diagrams, use summarized nodes and only the most important connectors.
- Text inside a background rectangle/card should use a text box centered within that shape on both axes; use `textAnchor: "middle"` unless a clear exception is needed.
- Numbers, step indexes, and content labels must be horizontally and vertically centered against their own background shapes. If a number and a label share one background, align the combined text group to the visual center of that background.
- Text boxes must remain fully inside their corresponding background shape and the canvas. If text is long, reduce font size, shorten the label, or split it into fewer concise lines instead of letting it overflow.
- The final large background panel, when present, must be centered on the canvas. The complete content group inside that large panel must share the panel's horizontal and vertical center.
- When there is no large background panel, the complete main content group must be centered on the canvas. Titles may stay above the main content, but the non-title content group should remain centered.
- JSON syntax must be valid before you return it: use double quotes for every key and string, separate every array element and object property with commas, close every `{}` and `[]`, escape quotes inside text values, and do not include comments, markdown, trailing commas, or prose outside the JSON object.
