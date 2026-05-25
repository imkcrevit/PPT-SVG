"use client";

import type { MouseEvent, ReactNode } from "react";

import type { Figure, FigureElement, TextElement } from "@/lib/types";

interface FigureSvgProps {
  figure: Figure;
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function FigureSvg({ figure, selectedId, onSelect }: FigureSvgProps) {
  return (
    <svg
      id="figure-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${figure.canvas.width} ${figure.canvas.height}`}
      role="img"
      aria-labelledby="figure-title figure-desc"
      className="h-full w-full"
      onClick={() => onSelect?.("")}
    >
      <metadata>{JSON.stringify(figure.metadata)}</metadata>
      <title id="figure-title">{figure.metadata.title}</title>
      <desc id="figure-desc">{figure.metadata.description}</desc>
      <rect width={figure.canvas.width} height={figure.canvas.height} fill={figure.canvas.background} />
      {figure.elements.map((element) => renderElement(element, selectedId, onSelect))}
    </svg>
  );
}

function renderElement(element: FigureElement, selectedId?: string, onSelect?: (id: string) => void): ReactNode {
  const isSelected = selectedId === element.id;
  const shared = {
    key: element.id,
    "data-node-id": element.id,
    opacity: element.opacity,
    onClick: (event: MouseEvent<SVGElement>) => {
      event.stopPropagation();
      onSelect?.(element.id);
    },
    className: "cursor-pointer"
  };

  if (element.type === "group") {
    return (
      <g {...shared}>
        {element.children.map((child) => renderElement(child, selectedId, onSelect))}
      </g>
    );
  }

  if (element.type === "rect") {
    return (
      <rect
        {...shared}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rx={element.rx}
        fill={element.fill}
        stroke={isSelected ? "#315CFF" : element.stroke}
        strokeWidth={isSelected ? Math.max(element.strokeWidth ?? 1.5, 3) : element.strokeWidth}
      />
    );
  }

  if (element.type === "text") {
    return renderText(element, isSelected, shared);
  }

  if (element.type === "line") {
    return (
      <line
        {...shared}
        x1={element.x1}
        y1={element.y1}
        x2={element.x2}
        y2={element.y2}
        stroke={isSelected ? "#315CFF" : element.stroke}
        strokeWidth={isSelected ? Math.max(element.strokeWidth ?? 2, 3) : element.strokeWidth}
        strokeLinecap="round"
      />
    );
  }

  return renderArrow(element, isSelected, shared);
}

function renderText(
  element: TextElement,
  isSelected: boolean,
  shared: {
    key: string;
    "data-node-id": string;
    opacity?: number;
    onClick: (event: MouseEvent<SVGElement>) => void;
    className: string;
  }
) {
  const fontSize = element.fontSize ?? 22;
  const width = element.width ?? 240;
  const lineHeight = fontSize * 1.18;
  const lines = wrapSvgText(element.text, width, fontSize);
  const anchor = element.textAnchor ?? "middle";
  const anchorX = anchor === "start" ? element.x : anchor === "end" ? element.x + width : element.x + width / 2;
  const startY = element.y + fontSize;

  return (
    <g {...shared}>
      {isSelected ? (
        <rect
          x={element.x - 6}
          y={element.y - 4}
          width={width + 12}
          height={(element.height ?? lines.length * lineHeight) + 8}
          fill="none"
          stroke="#315CFF"
          strokeDasharray="6 5"
          strokeWidth={2}
          rx={6}
        />
      ) : null}
      <text
        x={anchorX}
        y={startY}
        fill={element.fill ?? "#1D2433"}
        fontSize={fontSize}
        fontWeight={element.fontWeight ?? 500}
        textAnchor={anchor}
        fontFamily="Inter, Roboto, Noto Sans CJK SC, Arial, sans-serif"
      >
        {lines.map((line, index) => (
          <tspan key={`${element.id}-line-${index}`} x={anchorX} dy={index === 0 ? 0 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function renderArrow(
  element: Extract<FigureElement, { type: "arrow" }>,
  isSelected: boolean,
  shared: {
    key: string;
    "data-node-id": string;
    opacity?: number;
    onClick: (event: MouseEvent<SVGElement>) => void;
    className: string;
  }
) {
  const color = isSelected ? "#315CFF" : element.stroke;
  const strokeWidth = isSelected ? Math.max(element.strokeWidth ?? 2, 3) : element.strokeWidth ?? 2;
  const points = arrowHeadPoints(element.x1, element.y1, element.x2, element.y2, 15 + strokeWidth * 1.5, 9 + strokeWidth);
  const lineEnd = lineEndBeforeArrow(element.x1, element.y1, element.x2, element.y2, 12 + strokeWidth);

  return (
    <g {...shared}>
      <line
        x1={element.x1}
        y1={element.y1}
        x2={lineEnd.x}
        y2={lineEnd.y}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <polygon points={points} fill={color} />
    </g>
  );
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
    trimmed[3] = `${trimmed[3].slice(0, Math.max(1, maxChars - 1))}…`;
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
