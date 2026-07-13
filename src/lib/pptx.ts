import pptxgen from "pptxgenjs";

import type { Figure, FigureElement } from "@/lib/types";
import { wrapSvgText } from "@/lib/text-layout";

export const SLIDE_WIDTH_IN = 13.333;
export const SLIDE_HEIGHT_IN = 7.5;
export const PPTX_DEFAULT_FONT_FACE = "Microsoft YaHei";

// Create a wide (16:9) deck with the common metadata/theme applied. Shared by
// single-figure export and the multi-slide lab deck builder.
export function createDeck(options: { title?: string; subject?: string; fontFamily?: string } = {}): pptxgen {
  const deck = new pptxgen();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "PPT-SVG";
  deck.company = "PPT-SVG";
  deck.title = options.title ?? "PPT-SVG";
  deck.subject = options.subject ?? "";
  const fontFace = options.fontFamily ?? PPTX_DEFAULT_FONT_FACE;
  deck.theme = { headFontFace: fontFace, bodyFontFace: fontFace };
  return deck;
}

// Append one slide rendering a compiled Figure. Reused per diagram slide.
export function addFigureSlide(deck: pptxgen, figure: Figure): void {
  const slide = deck.addSlide();
  slide.background = { color: stripHash(figure.canvas.background) };
  for (const element of figure.elements) {
    addElement(slide, element, figure);
  }
}

export async function writeDeck(deck: pptxgen): Promise<Buffer> {
  const raw = await (deck as unknown as { write: (options: { outputType: "nodebuffer" }) => Promise<Buffer> }).write({
    outputType: "nodebuffer"
  });
  return Buffer.from(raw);
}

export { stripHash as pptxColor };

export async function figureToPptx(figure: Figure): Promise<Buffer> {
  const deck = createDeck({
    title: figure.metadata.title,
    subject: figure.metadata.description,
    fontFamily: figure.canvas.fontFamily
  });
  addFigureSlide(deck, figure);
  return writeDeck(deck);
}

function addElement(slide: pptxgen.Slide, element: FigureElement, figure: Figure): void {
  if (element.type === "group") {
    for (const child of element.children) {
      addElement(slide, child, figure);
    }
    return;
  }

  if (element.type === "rect") {
    slide.addShape("rect" as pptxgen.ShapeType, {
      objectName: element.id,
      x: pxToIn(element.x, figure.canvas.width),
      y: pyToIn(element.y, figure.canvas.height),
      w: pxToIn(element.width, figure.canvas.width),
      h: pyToIn(element.height, figure.canvas.height),
      rectRadius: element.rx ? pxToIn(element.rx, figure.canvas.width) : undefined,
      fill: { color: stripHash(element.fill), transparency: element.fill === "none" ? 100 : 0 },
      line: {
        color: stripHash(element.stroke ?? "#1D2433"),
        transparency: element.stroke ? 0 : 100,
        width: pxStrokeToPt(element.strokeWidth ?? 1.5, figure.canvas.height),
        dashType: element.dash ? ("dash" as const) : ("solid" as const)
      }
    });
    return;
  }

  if (element.type === "text") {
    const width = element.width ?? 240;
    const fontSize = element.fontSize ?? 22;
    // Wrap with the same algorithm the SVG renderer uses, then emit one run per
    // line so PPTX line breaks match the preview instead of relying on
    // pptxgenjs' own (divergent) auto-wrap metrics.
    const lines = wrapSvgText(element.text, width, fontSize);
    const runs: pptxgen.TextProps[] = lines.map((line) => ({
      text: line,
      options: { breakLine: true }
    }));

    // Box height must match the SVG renderer's, or PowerPoint's valign:middle
    // centres the text inside a differently-sized box and it drifts off its
    // shape in the export while looking fine in the preview. svg.ts uses
    // `height ?? lines * fontSize * 1.18`, so mirror that fallback exactly
    // instead of a flat 70px default.
    const boxHeight = element.height ?? lines.length * fontSize * 1.18;

    slide.addText(runs, {
      objectName: element.id,
      x: pxToIn(element.x, figure.canvas.width),
      y: pyToIn(element.y, figure.canvas.height),
      w: pxToIn(width, figure.canvas.width),
      h: pyToIn(boxHeight, figure.canvas.height),
      fontFace: figure.canvas.fontFamily ?? PPTX_DEFAULT_FONT_FACE,
      fontSize: pxFontToPt(fontSize, figure.canvas.height),
      bold: (element.fontWeight ?? 500) >= 600,
      color: stripHash(element.fill ?? "#1D2433"),
      align: pptxTextAlign(element),
      valign: "middle",
      margin: pptxTextMargin(element),
      wrap: false
    });
    return;
  }

  if (element.type === "ellipse") {
    slide.addShape("ellipse" as pptxgen.ShapeType, {
      objectName: element.id,
      x: pxToIn(element.cx - element.rx, figure.canvas.width),
      y: pyToIn(element.cy - element.ry, figure.canvas.height),
      w: pxToIn(element.rx * 2, figure.canvas.width),
      h: pyToIn(element.ry * 2, figure.canvas.height),
      fill: {
        color: stripHash(element.fill ?? "#FFFFFF"),
        transparency: element.fill && element.fill !== "none" ? Math.round((1 - (element.opacity ?? 1)) * 100) : 100
      },
      line: {
        color: stripHash(element.stroke ?? "#1D2433"),
        transparency: element.stroke ? 0 : 100,
        width: pxStrokeToPt(element.strokeWidth ?? 1.5, figure.canvas.height),
        dashType: element.dash ? ("dash" as const) : ("solid" as const)
      }
    });
    return;
  }

  if (element.type === "polygon") {
    const pts = element.points;
    if (pts.length < 2) {
      return;
    }

    const minX = Math.min(...pts.map((point) => point.x));
    const minY = Math.min(...pts.map((point) => point.y));
    const maxX = Math.max(...pts.map((point) => point.x));
    const maxY = Math.max(...pts.map((point) => point.y));
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);
    const hasFill = element.fill !== undefined && element.fill !== "none";

    // A single closed custom-geometry shape preserves the fill and stroke of the
    // polygon (funnel/venn wedges). The previous per-edge line approach dropped
    // the fill and split one shape into disconnected segments.
    const geomPoints: pptxgen.ShapeProps["points"] = pts.map((point, index) => ({
      x: pxToIn(point.x - minX, figure.canvas.width),
      y: pyToIn(point.y - minY, figure.canvas.height),
      ...(index === 0 ? { moveTo: true } : {})
    }));
    geomPoints.push({ close: true });

    slide.addShape("custGeom" as pptxgen.ShapeType, {
      objectName: element.id,
      x: pxToIn(minX, figure.canvas.width),
      y: pyToIn(minY, figure.canvas.height),
      w: pxToIn(boxW, figure.canvas.width),
      h: pyToIn(boxH, figure.canvas.height),
      points: geomPoints,
      fill: { color: hasFill ? stripHash(element.fill as string) : "FFFFFF", transparency: hasFill ? 0 : 100 },
      line: {
        color: stripHash(element.stroke ?? "#1D2433"),
        transparency: element.stroke ? 0 : 100,
        width: pxStrokeToPt(element.strokeWidth ?? 1.5, figure.canvas.height),
        dashType: element.dash ? ("dash" as const) : ("solid" as const)
      }
    });
    return;
  }

  if (element.type === "connector") {
    addConnector(slide, element, figure);
    return;
  }

  addStraightLine(slide, figure, {
    x1: element.x1,
    y1: element.y1,
    x2: element.x2,
    y2: element.y2,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    dash: element.dash,
    endArrow: element.type === "arrow",
    objectName: element.id
  });
}

function addConnector(
  slide: pptxgen.Slide,
  element: Extract<FigureElement, { type: "connector" }>,
  figure: Figure
): void {
  if (element.points.length < 2) {
    return;
  }

  const points = compactConnectorPoints(element.points);

  if (points.length < 2) {
    return;
  }

  const first = points[0];
  const last = points[points.length - 1];

  if (points.length === 2 || isStraightPath(points)) {
    addStraightLine(slide, figure, {
      x1: first.x,
      y1: first.y,
      x2: last.x,
      y2: last.y,
      stroke: element.stroke,
      strokeWidth: element.strokeWidth,
      dash: element.dash,
      endArrow: element.endArrow === true,
      objectName: element.id
    });
    return;
  }

  const connectorName = connectorShapeName(points);
  const x = Math.min(first.x, last.x);
  const y = Math.min(first.y, last.y);
  const w = Math.abs(last.x - first.x);
  const h = Math.abs(last.y - first.y);

  if (w < 0.1 || h < 0.1) {
    addStraightLine(slide, figure, {
      x1: first.x,
      y1: first.y,
      x2: last.x,
      y2: last.y,
      stroke: element.stroke,
      strokeWidth: element.strokeWidth,
      dash: element.dash,
      endArrow: element.endArrow === true,
      objectName: element.id
    });
    return;
  }

  slide.addShape(connectorName as pptxgen.ShapeType, {
    objectName: element.id,
    x: pxToIn(x, figure.canvas.width),
    y: pyToIn(y, figure.canvas.height),
    w: pxToIn(w, figure.canvas.width),
    h: pyToIn(h, figure.canvas.height),
    flipH: last.x < first.x,
    flipV: last.y < first.y,
    line: {
      color: stripHash(element.stroke),
      width: pxStrokeToPt(element.strokeWidth ?? 2, figure.canvas.height),
      endArrowType: element.endArrow === true ? ("triangle" as const) : undefined,
      dashType: element.dash ? ("dash" as const) : ("solid" as const)
    }
  });
}

function pptxTextAlign(element: Extract<FigureElement, { type: "text" }>): "left" | "center" | "right" {
  if (element.textAnchor === "start") {
    return "left";
  }

  if (element.textAnchor === "end") {
    return "right";
  }

  return "center";
}

function pptxTextMargin(element: Extract<FigureElement, { type: "text" }>): number {
  return pptxTextAlign(element) === "center" ? 0 : 0.04;
}

function compactConnectorPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || Math.abs(previous.x - point.x) > 0.1 || Math.abs(previous.y - point.y) > 0.1;
  });
}

function connectorShapeName(points: { x: number; y: number }[]): string {
  const segmentCount = Math.max(2, points.length - 1);
  const connectorCount = Math.min(5, segmentCount);
  return `bentConnector${connectorCount}`;
}

function addStraightLine(
  slide: pptxgen.Slide,
  figure: Figure,
  line: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stroke: string;
    strokeWidth?: number;
    dash?: boolean;
    endArrow?: boolean;
    objectName?: string;
  }
): void {
  slide.addShape("line" as pptxgen.ShapeType, {
    objectName: line.objectName,
    x: pxToIn(line.x1, figure.canvas.width),
    y: pyToIn(line.y1, figure.canvas.height),
    w: pxToIn(line.x2 - line.x1, figure.canvas.width),
    h: pyToIn(line.y2 - line.y1, figure.canvas.height),
    line: {
      color: stripHash(line.stroke),
      width: pxStrokeToPt(line.strokeWidth ?? 2, figure.canvas.height),
      endArrowType: line.endArrow ? ("triangle" as const) : undefined,
      dashType: line.dash ? ("dash" as const) : ("solid" as const)
    }
  });
}

function isStraightPath(points: { x: number; y: number }[]): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;

  return points.every((point) => Math.abs(dx * (point.y - first.y) - dy * (point.x - first.x)) < 0.5);
}

function pxToIn(value: number, canvasWidth: number): number {
  return (value / canvasWidth) * SLIDE_WIDTH_IN;
}

function pyToIn(value: number, canvasHeight: number): number {
  return (value / canvasHeight) * SLIDE_HEIGHT_IN;
}

function pxFontToPt(value: number, canvasHeight: number): number {
  return (value / canvasHeight) * SLIDE_HEIGHT_IN * 72;
}

// SVG stroke widths are pixels on the canvas; PPTX line widths are points.
// Convert through the same canvas-height scale used for fonts so borders match
// the SVG/preview weight instead of rendering noticeably thicker.
function pxStrokeToPt(value: number, canvasHeight: number): number {
  return Math.round(((value / canvasHeight) * SLIDE_HEIGHT_IN * 72) * 100) / 100;
}

function stripHash(color: string): string {
  return color === "none" ? "FFFFFF" : color.replace("#", "");
}
