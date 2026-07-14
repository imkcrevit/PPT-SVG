import type { Figure, FigureElement, TextElement } from "@/lib/types";
import { limitLinesToHeight, sanitizeXmlText, wrapSvgText } from "@/lib/text-layout";

function cssFontStack(fontFamily?: string): string {
  const primary = (fontFamily ?? "Microsoft YaHei").replace(/["<>]/g, "");
  return `'${primary}', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', 'Noto Sans CJK SC', Inter, Arial, sans-serif`;
}

export function renderFigureSvg(figure: Figure): string {
  const fontFamily = cssFontStack(figure.canvas.fontFamily);
  return [
    `<svg id="figure-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${figure.canvas.width} ${figure.canvas.height}" role="img" aria-labelledby="figure-title figure-desc" font-family="${fontFamily}">`,
    `<metadata>${escapeXml(JSON.stringify(figure.metadata))}</metadata>`,
    `<title id="figure-title">${escapeXml(figure.metadata.title)}</title>`,
    `<desc id="figure-desc">${escapeXml(figure.metadata.description)}</desc>`,
    `<rect width="${figure.canvas.width}" height="${figure.canvas.height}" fill="${figure.canvas.background}" />`,
    ...figure.elements.map((element) => renderElement(element, fontFamily)),
    "</svg>"
  ].join("\n");
}

function renderElement(element: FigureElement, fontFamily: string): string {
  const opacity = element.opacity === undefined ? "" : ` opacity="${element.opacity}"`;

  if (element.type === "group") {
    return `<g data-node-id="${element.id}"${opacity}>\n${element.children.map((child) => renderElement(child, fontFamily)).join("\n")}\n</g>`;
  }

  if (element.type === "rect") {
    return `<rect data-node-id="${element.id}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.rx ?? 0}" fill="${element.fill}"${element.stroke ? ` stroke="${element.stroke}"` : ""} stroke-width="${element.strokeWidth ?? 1.5}"${element.dash ? ' stroke-dasharray="7 5"' : ""}${opacity} />`;
  }

  if (element.type === "text") {
    return renderText(element, opacity, fontFamily);
  }

  if (element.type === "line") {
    return `<line data-node-id="${element.id}" x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}" stroke="${element.stroke}" stroke-width="${element.strokeWidth ?? 2}" stroke-linecap="round"${element.dash ? ' stroke-dasharray="7 5"' : ""}${opacity} />`;
  }

  if (element.type === "connector") {
    return renderConnector(element, opacity);
  }

  if (element.type === "polygon") {
    const pts = element.points.map((pt) => `${pt.x},${pt.y}`).join(" ");
    return `<polygon data-node-id="${element.id}" points="${pts}" fill="${element.fill ?? "none"}"${element.stroke ? ` stroke="${element.stroke}"` : ""} stroke-width="${element.strokeWidth ?? 1.5}"${element.dash ? ' stroke-dasharray="7 5"' : ""}${opacity} />`;
  }

  if (element.type === "ellipse") {
    return `<ellipse data-node-id="${element.id}" cx="${element.cx}" cy="${element.cy}" rx="${element.rx}" ry="${element.ry}" fill="${element.fill ?? "none"}"${element.stroke ? ` stroke="${element.stroke}"` : ""} stroke-width="${element.strokeWidth ?? 1.5}"${element.dash ? ' stroke-dasharray="7 5"' : ""}${opacity} />`;
  }

  if (element.type === "image") {
    const par = element.fit === "cover" ? "xMidYMid slice" : element.fit === "stretch" ? "none" : "xMidYMid meet";
    return `<image data-node-id="${element.id}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" preserveAspectRatio="${par}" href="${escapeXml(element.src)}"${opacity} />`;
  }

  return renderArrow(element, opacity);
}

function renderText(element: TextElement, opacity: string, fontFamily: string): string {
  const fontSize = element.fontSize ?? 22;
  const width = element.width ?? 240;
  const lineHeight = fontSize * 1.18;
  const wrappedLines = wrapSvgText(element.text, width, fontSize);
  const height = element.height ?? wrappedLines.length * lineHeight;
  const lines = limitLinesToHeight(wrappedLines, height, lineHeight, { width, fontSize });
  const anchor = element.textAnchor ?? "middle";
  const anchorX = anchor === "start" ? element.x : anchor === "end" ? element.x + width : element.x + width / 2;
  const blockHeight = lines.length * lineHeight;
  const firstLineY = element.y + (height - blockHeight) / 2 + lineHeight / 2;

  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${round(anchorX)}" y="${round(firstLineY + index * lineHeight)}">${escapeXml(line)}</tspan>`
    )
    .join("");

  return `<text data-node-id="${element.id}" x="${round(anchorX)}" y="${round(firstLineY)}" fill="${element.fill ?? "#2F3337"}" font-size="${fontSize}" font-weight="${element.fontWeight ?? 500}" text-anchor="${anchor}" dominant-baseline="middle" font-family="${fontFamily}"${opacity}>${tspans}</text>`;
}

function renderArrow(element: Extract<FigureElement, { type: "arrow" }>, opacity: string): string {
  return renderPolyline({
    id: element.id,
    points: [
      { x: element.x1, y: element.y1 },
      { x: element.x2, y: element.y2 }
    ],
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    dash: element.dash,
    endArrow: true,
    opacity
  });
}

function renderConnector(element: Extract<FigureElement, { type: "connector" }>, opacity: string): string {
  return renderPolyline({
    id: element.id,
    points: element.points,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    dash: element.dash,
    endArrow: element.endArrow === true,
    opacity
  });
}

function renderPolyline(options: {
  id: string;
  points: { x: number; y: number }[];
  stroke: string;
  strokeWidth?: number;
  dash?: boolean;
  endArrow?: boolean;
  opacity: string;
}): string {
  if (options.points.length < 2) {
    return "";
  }

  const strokeWidth = options.strokeWidth ?? 2;
  const markerId = safeMarkerId(options.id);
  const marker = options.endArrow
    ? `<defs><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth" overflow="visible"><path d="M 0 0 L 10 5 L 0 10 z" fill="${options.stroke}" /></marker></defs>`
    : "";
  const markerEnd = options.endArrow ? ` marker-end="url(#${markerId})"` : "";
  const points = options.points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");

  return [
    `<g data-node-id="${options.id}"${options.opacity}>`,
    marker,
    `<polyline points="${points}" fill="none" stroke="${options.stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${options.dash ? ' stroke-dasharray="7 5"' : ""}${markerEnd} />`,
    "</g>"
  ].join("\n");
}

function safeMarkerId(id: string): string {
  return `marker-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function escapeXml(value: string): string {
  return sanitizeXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
