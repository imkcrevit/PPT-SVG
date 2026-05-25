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
- Do not include comments, markdown, trailing commas, or prose outside the JSON object.

