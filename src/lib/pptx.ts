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
      x: pxToIn(element.x, figure.canvas.width),
      y: pyToIn(element.y, figure.canvas.height),
      w: pxToIn(element.width ?? 240, figure.canvas.width),
      h: pyToIn(element.height ?? 70, figure.canvas.height),
      fontFace: figure.canvas.fontFamily ?? PPTX_DEFAULT_FONT_FACE,
      fontSize: element.fontSize ?? 22,
      bold: (element.fontWeight ?? 500) >= 600,
      color: stripHash(element.fill ?? "#1D2433"),
      align: element.textAnchor === "start" ? "left" : element.textAnchor === "end" ? "right" : "center",
      valign: "middle",
      margin: 0.04,
      breakLine: false,
      fit: "shrink"
    });
    return;
  }

  if (element.type === "ellipse") {
    slide.addShape("ellipse" as pptxgen.ShapeType, {
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

  const lineOptions = {
    x: pxToIn(element.x1, figure.canvas.width),
    y: pyToIn(element.y1, figure.canvas.height),
    w: pxToIn(element.x2 - element.x1, figure.canvas.width),
    h: pyToIn(element.y2 - element.y1, figure.canvas.height),
    line: {
      color: stripHash(element.stroke),
      width: element.strokeWidth ?? 2,
      endArrowType: element.type === "arrow" ? ("triangle" as const) : undefined,
      dashType: element.dash ? ("dash" as const) : ("solid" as const)
    }
  };

  slide.addShape("line" as pptxgen.ShapeType, lineOptions);
}

function pxToIn(value: number, canvasWidth: number): number {
  return (value / canvasWidth) * SLIDE_WIDTH_IN;
}

function pyToIn(value: number, canvasHeight: number): number {
  return (value / canvasHeight) * SLIDE_HEIGHT_IN;
}

function stripHash(color: string): string {
  return color === "none" ? "FFFFFF" : color.replace("#", "");
}
