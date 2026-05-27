import type { Figure, FigureElement, TextElement } from "@/lib/types";

export function renderFigureSvg(figure: Figure): string {
  return [
    `<svg id="figure-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${figure.canvas.width} ${figure.canvas.height}" role="img" aria-labelledby="figure-title figure-desc">`,
    `<metadata>${escapeXml(JSON.stringify(figure.metadata))}</metadata>`,
    `<title id="figure-title">${escapeXml(figure.metadata.title)}</title>`,
    `<desc id="figure-desc">${escapeXml(figure.metadata.description)}</desc>`,
    `<rect width="${figure.canvas.width}" height="${figure.canvas.height}" fill="${figure.canvas.background}" />`,
    ...figure.elements.map(renderElement),
    "</svg>"
  ].join("\n");
}

function renderElement(element: FigureElement): string {
  const opacity = element.opacity === undefined ? "" : ` opacity="${element.opacity}"`;

  if (element.type === "group") {
    return `<g data-node-id="${element.id}"${opacity}>\n${element.children.map(renderElement).join("\n")}\n</g>`;
  }

  if (element.type === "rect") {
    return `<rect data-node-id="${element.id}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.rx ?? 0}" fill="${element.fill}"${element.stroke ? ` stroke="${element.stroke}"` : ""} stroke-width="${element.strokeWidth ?? 1.5}"${opacity} />`;
  }

  if (element.type === "text") {
    return renderText(element, opacity);
  }

  if (element.type === "line") {
    return `<line data-node-id="${element.id}" x1="${element.x1}" y1="${element.y1}" x2="${element.x2}" y2="${element.y2}" stroke="${element.stroke}" stroke-width="${element.strokeWidth ?? 2}" stroke-linecap="round"${opacity} />`;
  }

  return renderArrow(element, opacity);
}

function renderText(element: TextElement, opacity: string): string {
  const fontSize = element.fontSize ?? 22;
  const width = element.width ?? 240;
  const lineHeight = fontSize * 1.18;
  const height = element.height ?? wrapSvgText(element.text, width, fontSize).length * lineHeight;
  const lines = limitLinesToHeight(wrapSvgText(element.text, width, fontSize), height, lineHeight);
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

  return `<text data-node-id="${element.id}" x="${round(anchorX)}" y="${round(firstLineY)}" fill="${element.fill ?? "#2F3337"}" font-size="${fontSize}" font-weight="${element.fontWeight ?? 500}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Inter, Roboto, Noto Sans CJK SC, Arial, sans-serif"${opacity}>${tspans}</text>`;
}

function limitLinesToHeight(lines: string[], height: number, lineHeight: number): string[] {
  const maxLines = Math.max(1, Math.min(4, Math.floor(height / lineHeight)));
  const visibleLines = lines.slice(0, maxLines);

  if (lines.length > maxLines) {
    const lastIndex = visibleLines.length - 1;
    visibleLines[lastIndex] = `${visibleLines[lastIndex].replace(/\.*$/, "")}...`;
  }

  return visibleLines.length ? visibleLines : [""];
}

function renderArrow(element: Extract<FigureElement, { type: "arrow" }>, opacity: string): string {
  const strokeWidth = element.strokeWidth ?? 2;
  const points = arrowHeadPoints(element.x1, element.y1, element.x2, element.y2, 15 + strokeWidth * 1.5, 9 + strokeWidth);
  const lineEnd = lineEndBeforeArrow(element.x1, element.y1, element.x2, element.y2, 12 + strokeWidth);

  return [
    `<g data-node-id="${element.id}"${opacity}>`,
    `<line x1="${element.x1}" y1="${element.y1}" x2="${round(lineEnd.x)}" y2="${round(lineEnd.y)}" stroke="${element.stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
    `<polygon points="${points}" fill="${element.stroke}" />`,
    "</g>"
  ].join("\n");
}

function wrapSvgText(text: string, width: number, fontSize: number): string[] {
  const maxChars = Math.max(4, Math.floor(width / (fontSize * 0.58)));
  const hasSpaces = /\s/.test(text);
  const tokens = hasSpaces ? text.split(/\s+/) : Array.from(text);
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const separator = hasSpaces && current ? " " : "";
    const next = `${current}${separator}${token}`;

    if (next.length > maxChars && current) {
      lines.push(current);
      current = token;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  const trimmed = lines.slice(0, 4);
  if (lines.length > 4) {
    trimmed[3] = `${trimmed[3].slice(0, Math.max(1, maxChars - 1))}...`;
  }

  return trimmed.length ? trimmed : [text];
}

function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, length: number, width: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const backX = x2 - length * Math.cos(angle);
  const backY = y2 - length * Math.sin(angle);
  const perp = angle + Math.PI / 2;
  const leftX = backX + width * Math.cos(perp);
  const leftY = backY + width * Math.sin(perp);
  const rightX = backX - width * Math.cos(perp);
  const rightY = backY - width * Math.sin(perp);

  return `${round(x2)},${round(y2)} ${round(leftX)},${round(leftY)} ${round(rightX)},${round(rightY)}`;
}

function lineEndBeforeArrow(x1: number, y1: number, x2: number, y2: number, offset: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return {
    x: x2 - offset * Math.cos(angle),
    y: y2 - offset * Math.sin(angle)
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
