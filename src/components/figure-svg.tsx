"use client";

import { useState } from "react";
import type { MouseEvent, PointerEvent, ReactNode } from "react";

import { limitLinesToHeight, sanitizeXmlText, wrapSvgText } from "@/lib/text-layout";
import type { Figure, FigureElement, TextElement } from "@/lib/types";

interface FigureSvgProps {
  figure: Figure;
  svgId?: string;
  selectedId?: string;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  onSelectIds?: (ids: string[]) => void;
}

interface SelectionBox {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export function FigureSvg({ figure, svgId = "figure-svg", selectedId, selectedIds, onSelect, onSelectIds }: FigureSvgProps) {
  const activeSelectedIds = selectedIds ?? (selectedId ? [selectedId] : []);
  const isInteractive = Boolean(onSelect || onSelectIds);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  function getPoint(event: PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    const target = event.target;
    const isElementTarget = target instanceof Element && Boolean(target.closest("[data-node-id]"));

    if (!onSelectIds || event.button !== 0 || isElementTarget) {
      return;
    }

    const point = getPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectionBox({ startX: point.x, startY: point.y, x: point.x, y: point.y });
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!selectionBox) {
      return;
    }

    const point = getPoint(event);
    setSelectionBox((current) => (current ? { ...current, x: point.x, y: point.y } : null));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!selectionBox || !onSelectIds) {
      return;
    }

    const point = getPoint(event);
    const box = normalizeBox(selectionBox.startX, selectionBox.startY, point.x, point.y);
    const isClick = box.width < 6 && box.height < 6;
    setSelectionBox(null);

    if (isClick) {
      onSelect?.("");
      onSelectIds([]);
      return;
    }

    const nextIds = collectElementIdsInBox(figure.elements, box);
    onSelectIds(event.shiftKey || event.metaKey ? uniqueIds([...activeSelectedIds, ...nextIds]) : nextIds);
  }

  const visibleBox = selectionBox ? normalizeBox(selectionBox.startX, selectionBox.startY, selectionBox.x, selectionBox.y) : null;

  return (
    <svg
      id={svgId}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${figure.canvas.width} ${figure.canvas.height}`}
      role="img"
      aria-labelledby={`${svgId}-title ${svgId}-desc`}
      className="h-full w-full touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <metadata>{sanitizeXmlText(JSON.stringify(figure.metadata))}</metadata>
      <title id={`${svgId}-title`}>{sanitizeXmlText(figure.metadata.title)}</title>
      <desc id={`${svgId}-desc`}>{sanitizeXmlText(figure.metadata.description)}</desc>
      <rect width={figure.canvas.width} height={figure.canvas.height} fill={figure.canvas.background} />
      {figure.elements.map((element) => renderElement(element, activeSelectedIds, isInteractive, onSelect, onSelectIds))}
      {visibleBox ? (
        <rect
          x={visibleBox.x}
          y={visibleBox.y}
          width={visibleBox.width}
          height={visibleBox.height}
          fill="rgba(196,95,60,0.08)"
          stroke="#C45F3C"
          strokeDasharray="8 6"
          strokeWidth={2}
          pointerEvents="none"
        />
      ) : null}
    </svg>
  );
}

function renderElement(
  element: FigureElement,
  selectedIds: string[],
  isInteractive: boolean,
  onSelect?: (id: string) => void,
  onSelectIds?: (ids: string[]) => void
): ReactNode {
  const isSelected = selectedIds.includes(element.id);
  const shared = {
    key: element.id,
    "data-node-id": element.id,
    opacity: element.opacity,
    onClick: isInteractive ? (event: MouseEvent<SVGElement>) => {
      event.stopPropagation();
      if (event.shiftKey || event.metaKey) {
        onSelectIds?.(
          selectedIds.includes(element.id)
            ? selectedIds.filter((id) => id !== element.id)
            : uniqueIds([...selectedIds, element.id])
        );
      } else {
        onSelect?.(element.id);
        onSelectIds?.([element.id]);
      }
    } : undefined,
    className: isInteractive ? "cursor-pointer" : undefined
  };

  if (element.type === "group") {
    return (
      <g {...shared}>
        {element.children.map((child) => renderElement(child, selectedIds, isInteractive, onSelect, onSelectIds))}
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
        stroke={isSelected ? "#737A82" : element.stroke}
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
        stroke={isSelected ? "#737A82" : element.stroke}
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
    onClick?: (event: MouseEvent<SVGElement>) => void;
    className?: string;
  }
) {
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

  return (
    <g {...shared}>
      {isSelected ? (
        <rect
          x={element.x - 6}
          y={element.y - 4}
          width={width + 12}
          height={height + 8}
          fill="none"
          stroke="#737A82"
          strokeDasharray="6 5"
          strokeWidth={2}
          rx={6}
        />
      ) : null}
      <text
        x={anchorX}
        y={firstLineY}
        fill={element.fill ?? "#2F3337"}
        fontSize={fontSize}
        fontWeight={element.fontWeight ?? 500}
        textAnchor={anchor}
        dominantBaseline="middle"
        fontFamily="Inter, Roboto, Noto Sans CJK SC, Arial, sans-serif"
      >
        {lines.map((line, index) => (
          <tspan key={`${element.id}-line-${index}`} x={anchorX} y={firstLineY + index * lineHeight}>
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
    onClick?: (event: MouseEvent<SVGElement>) => void;
    className?: string;
  }
) {
  const color = isSelected ? "#737A82" : element.stroke;
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

function normalizeBox(x1: number, y1: number, x2: number, y2: number) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function collectElementIdsInBox(elements: FigureElement[], box: ReturnType<typeof normalizeBox>): string[] {
  return elements.flatMap((element) => {
    const bounds = getElementBounds(element);
    const ownId = bounds && boxesIntersect(bounds, box) ? [element.id] : [];
    const childIds = element.type === "group" ? collectElementIdsInBox(element.children, box) : [];
    return [...ownId, ...childIds];
  });
}

function getElementBounds(element: FigureElement): ReturnType<typeof normalizeBox> | undefined {
  if (element.type === "group") {
    const childBounds = element.children.map(getElementBounds).filter((bounds): bounds is ReturnType<typeof normalizeBox> => Boolean(bounds));
    if (!childBounds.length) {
      return undefined;
    }

    const x1 = Math.min(...childBounds.map((bounds) => bounds.x));
    const y1 = Math.min(...childBounds.map((bounds) => bounds.y));
    const x2 = Math.max(...childBounds.map((bounds) => bounds.x + bounds.width));
    const y2 = Math.max(...childBounds.map((bounds) => bounds.y + bounds.height));
    return normalizeBox(x1, y1, x2, y2);
  }

  if (element.type === "rect") {
    return normalizeBox(element.x, element.y, element.x + element.width, element.y + element.height);
  }

  if (element.type === "text") {
    return normalizeBox(element.x, element.y, element.x + (element.width ?? 240), element.y + (element.height ?? (element.fontSize ?? 22) * 1.18));
  }

  return normalizeBox(element.x1, element.y1, element.x2, element.y2);
}

function boxesIntersect(a: ReturnType<typeof normalizeBox>, b: ReturnType<typeof normalizeBox>): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}
