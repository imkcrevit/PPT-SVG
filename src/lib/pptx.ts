import pptxgen from "pptxgenjs";

import type { Figure, FigureElement } from "@/lib/types";

const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const PPTX_DEFAULT_FONT_FACE = "Microsoft YaHei";

export async function figureToPptx(figure: Figure): Promise<Buffer> {
  const deck = new pptxgen();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "PPT-SVG";
  deck.subject = figure.metadata.description;
  deck.title = figure.metadata.title;
  deck.company = "PPT-SVG";
  const fontFace = figure.canvas.fontFamily ?? PPTX_DEFAULT_FONT_FACE;
  deck.theme = {
    headFontFace: fontFace,
    bodyFontFace: fontFace
  };

  const slide = deck.addSlide();
  slide.background = { color: stripHash(figure.canvas.background) };

  for (const element of figure.elements) {
    addElement(slide, element, figure);
  }

  const raw = await (deck as unknown as { write: (options: { outputType: "nodebuffer" }) => Promise<Buffer> }).write({
    outputType: "nodebuffer"
  });

  return Buffer.from(raw);
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
        width: element.strokeWidth ?? 1.5,
        dashType: element.dash ? ("dash" as const) : ("solid" as const)
      }
    });
    return;
  }

  if (element.type === "text") {
    slide.addText(element.text, {
      objectName: element.id,
      x: pxToIn(element.x, figure.canvas.width),
      y: pyToIn(element.y, figure.canvas.height),
      w: pxToIn(element.width ?? 240, figure.canvas.width),
      h: pyToIn(element.height ?? 70, figure.canvas.height),
      fontFace: figure.canvas.fontFamily ?? PPTX_DEFAULT_FONT_FACE,
      fontSize: pxFontToPt(element.fontSize ?? 22, figure.canvas.height),
      bold: (element.fontWeight ?? 500) >= 600,
      color: stripHash(element.fill ?? "#1D2433"),
      align: pptxTextAlign(element),
      valign: "middle",
      margin: pptxTextMargin(element),
      breakLine: false
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
        width: element.strokeWidth ?? 1.5,
        dashType: element.dash ? ("dash" as const) : ("solid" as const)
      }
    });
    return;
  }

  if (element.type === "polygon") {
    const pts = element.points;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      slide.addShape("line" as pptxgen.ShapeType, {
        objectName: element.id,
        x: pxToIn(a.x, figure.canvas.width),
        y: pyToIn(a.y, figure.canvas.height),
        w: pxToIn(b.x - a.x, figure.canvas.width),
        h: pyToIn(b.y - a.y, figure.canvas.height),
        line: {
          color: stripHash(element.stroke ?? "#1D2433"),
          width: element.strokeWidth ?? 1.5,
          dashType: element.dash ? ("dash" as const) : ("solid" as const)
        }
      });
    }
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
      width: element.strokeWidth ?? 2,
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
      width: line.strokeWidth ?? 2,
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

function stripHash(color: string): string {
  return color === "none" ? "FFFFFF" : color.replace("#", "");
}
