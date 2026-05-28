import type { Figure, FigureElement, RectElement, TextElement } from "@/lib/types";

export interface LayoutReviewResult {
  ok: boolean;
  issues: string[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_LAYOUT_AGENT_PASSES = 5;
const LARGE_BACKGROUND_AREA_RATIO = 0.18;
const BACKGROUND_ASSOCIATION_TOLERANCE = 12;
const MIN_BACKGROUND_OVERLAP_RATIO = 0.14;
const CENTER_TOLERANCE = 8;
const MIN_TITLE_CONTENT_GAP = 20;
const MAX_TITLE_CONTENT_GAP = 44;
const TITLE_CONTENT_GAP_RATIO = 0.045;

export function reviewFigureLayout(figure: Figure): LayoutReviewResult {
  const issues: string[] = [];
  const leaves = flattenLeaves(figure.elements);
  const rects = leaves.filter(isRectElement);
  const canvasBox = { x: 0, y: 0, width: figure.canvas.width, height: figure.canvas.height };

  for (const element of leaves) {
    const box = elementBox(element);
    if (!containsBox(canvasBox, box, 0.5)) {
      issues.push(`${element.id} exceeds canvas bounds.`);
    }
  }

  reviewTextGroupsInSmallRects(figure, leaves, rects, issues);
  reviewBackgroundContentRelations(figure, leaves, rects, issues);

  return { ok: issues.length === 0, issues };
}

function reviewTextGroupsInSmallRects(
  figure: Figure,
  leaves: FigureElement[],
  rects: RectElement[],
  issues: string[]
): void {
  const canvasArea = figure.canvas.width * figure.canvas.height;
  const smallRects = rects
    .filter((rect) => rect.width * rect.height <= canvasArea * LARGE_BACKGROUND_AREA_RATIO)
    .filter((rect) => !isFullCanvasRect(rect, figure.canvas.width, figure.canvas.height))
    .sort((a, b) => a.width * a.height - b.width * b.height);
  const assignments = new Map<RectElement, TextElement[]>();

  for (const text of leaves.filter(isTextElement)) {
    const matchedRect = findMatchingRect(text, smallRects);
    if (matchedRect) {
      assignments.set(matchedRect, [...(assignments.get(matchedRect) ?? []), text]);
    }
  }

  for (const [rect, texts] of assignments) {
    const rectBox = elementBox(rect);
    const textGroupBox = unionBoxes(texts.map(elementBox));

    if (!textGroupBox) {
      continue;
    }

    for (const text of texts) {
      const textBox = elementBox(text);
      if (!containsBox(rectBox, textBox, 1.5)) {
        issues.push(`${text.id} exceeds its background shape ${rect.id}.`);
      }
    }

    if (!containsBox(rectBox, textGroupBox, 1.5)) {
      issues.push(`${rect.id} text group exceeds its background shape.`);
    }

    if (centerDistance(textGroupBox, rectBox) > 4) {
      issues.push(`${rect.id} text group is not centered (${formatCenterDelta(textGroupBox, rectBox)}).`);
    }
  }
}

function reviewBackgroundContentRelations(
  figure: Figure,
  leaves: FigureElement[],
  rects: RectElement[],
  issues: string[]
): void {
  const canvasBox = { x: 0, y: 0, width: figure.canvas.width, height: figure.canvas.height };
  const canvasArea = figure.canvas.width * figure.canvas.height;
  const backgrounds = rects
    .filter((rect) => rect.width * rect.height >= canvasArea * LARGE_BACKGROUND_AREA_RATIO)
    .filter((rect) => !isFullCanvasRect(rect, figure.canvas.width, figure.canvas.height))
    .sort((a, b) => b.width * b.height - a.width * a.height);

  if (!backgrounds.length) {
    reviewPrimaryContentInCanvas(figure, leaves, issues);
    return;
  }

  const rootBackgrounds = findRootBackgrounds(backgrounds);
  const rootContent = uniqueElements([
    ...rootBackgrounds,
    ...leaves.filter((element) => {
      if (rootBackgrounds.includes(element as RectElement)) {
        return false;
      }

      return rootBackgrounds.some((background) => backgroundAssociationScore(background, element) > 0);
    })
  ]);
  const rootBackgroundBox = unionBoxes(rootBackgrounds.map(elementBox));
  const rootBox = unionBoxes(rootContent.map(elementBox));

  if (rootBackgroundBox && centerDistance(rootBackgroundBox, canvasBox) > CENTER_TOLERANCE) {
    issues.push(`main background layout group is not centered on the canvas (${formatCenterDelta(rootBackgroundBox, canvasBox)}).`);
  }

  if (rootBackgrounds.length === 1 && rootBox && !containsBox(canvasBox, rootBox, 1.5)) {
    issues.push(`main background layout group exceeds the canvas.`);
  }

  if (rootBackgrounds.length === 1) {
    const rootBackgroundBox = elementBox(rootBackgrounds[0]);
    if (centerDistance(rootBackgroundBox, canvasBox) > CENTER_TOLERANCE) {
      issues.push(`${rootBackgrounds[0].id} large background is not centered on the canvas (${formatCenterDelta(rootBackgroundBox, canvasBox)}).`);
    }
  }

  for (const background of backgrounds) {
    const backgroundBox = elementBox(background);
    const titleBoxes = leaves
      .filter((element): element is TextElement => isTextElement(element) && isLikelyTitleText(element, figure.canvas.width, figure.canvas.height, backgroundBox))
      .filter((text) => backgroundAssociationScore(background, text) > 0)
      .map(elementBox);
    const content = leaves.filter((element) => {
      if (element === background || (isTextElement(element) && isLikelyTitleText(element, figure.canvas.width, figure.canvas.height, backgroundBox))) {
        return false;
      }

      const elementBoxValue = elementBox(element);
      const elementIsParentBackground =
        isRectElement(element) &&
        boxArea(elementBoxValue) > boxArea(backgroundBox) &&
        containsBox(elementBoxValue, backgroundBox, BACKGROUND_ASSOCIATION_TOLERANCE);

      return !elementIsParentBackground && backgroundAssociationScore(background, element) > 0;
    });
    const contentBox = unionBoxes(content.map(elementBox));

    if (!contentBox) {
      continue;
    }

    const targetBox = contentTargetBox(backgroundBox, titleBoxes);
    const targetCenter = contentTargetCenter(backgroundBox, targetBox, contentBox);
    const centeredTarget = boxAroundCenter(contentBox, targetCenter);

    if (centerDistance(contentBox, centeredTarget) > CENTER_TOLERANCE) {
      issues.push(`${background.id} content group is not centered inside its background (${formatCenterDelta(contentBox, centeredTarget)}).`);
    }

    if (contentBox.width <= targetBox.width && contentBox.height <= targetBox.height && !containsBox(targetBox, contentBox, 1.5)) {
      issues.push(`${background.id} content group exceeds its background.`);
    }
  }
}

function reviewPrimaryContentInCanvas(figure: Figure, leaves: FigureElement[], issues: string[]): void {
  const canvasBox = { x: 0, y: 0, width: figure.canvas.width, height: figure.canvas.height };
  const titleBoxes = leaves
    .filter((element): element is TextElement => isTextElement(element) && isLikelyTitleText(element, figure.canvas.width, figure.canvas.height))
    .map(elementBox);
  const content = leaves.filter(
    (element) =>
      !(isRectElement(element) && isFullCanvasRect(element, figure.canvas.width, figure.canvas.height)) &&
      !(isTextElement(element) && isLikelyTitleText(element, figure.canvas.width, figure.canvas.height))
  );
  const contentBox = unionBoxes(content.map(elementBox));

  if (!contentBox) {
    return;
  }

  const targetBox = contentTargetBox(canvasBox, titleBoxes);
  const targetCenter = contentTargetCenter(canvasBox, targetBox, contentBox);
  const centeredTarget = boxAroundCenter(contentBox, targetCenter);

  if (centerDistance(contentBox, centeredTarget) > CENTER_TOLERANCE) {
    issues.push(`main content group is not centered on the canvas (${formatCenterDelta(contentBox, centeredTarget)}).`);
  }
}

function findMatchingRect(text: TextElement, rects: RectElement[]): RectElement | undefined {
  const textBox = elementBox(text);
  const textCenter = centerOf(textBox);

  return rects
    .map((rect) => {
      const rectBox = elementBox(rect);
      const overlap = intersectionArea(rectBox, textBox);
      const containsCenter = containsPoint(rectBox, textCenter, 8);
      const containsAuthoredPoint = containsPoint(rectBox, { x: text.x, y: text.y }, 8);

      if (overlap <= 0 && !containsCenter && !containsAuthoredPoint) {
        return undefined;
      }

      return {
        rect,
        score: (containsCenter ? 3 : 0) + (containsAuthoredPoint ? 2 : 0) + overlap / Math.max(1, rectBox.width * rectBox.height)
      };
    })
    .filter((candidate): candidate is { rect: RectElement; score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score || boxArea(elementBox(a.rect)) - boxArea(elementBox(b.rect)))[0]?.rect;
}

function flattenLeaves(elements: FigureElement[]): FigureElement[] {
  return elements.flatMap((element) => (element.type === "group" ? flattenLeaves(element.children) : [element]));
}

function elementBox(element: FigureElement): Box {
  if (element.type === "rect") {
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }

  if (element.type === "text") {
    return { x: element.x, y: element.y, width: element.width ?? 240, height: element.height ?? (element.fontSize ?? 22) * 1.18 };
  }

  if (element.type === "line" || element.type === "arrow") {
    const x = Math.min(element.x1, element.x2);
    const y = Math.min(element.y1, element.y2);
    return {
      x,
      y,
      width: Math.abs(element.x2 - element.x1),
      height: Math.abs(element.y2 - element.y1)
    };
  }

  if (element.type === "polygon") {
    if (!element.points.length) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const minX = Math.min(...element.points.map((point) => point.x));
    const minY = Math.min(...element.points.map((point) => point.y));
    const maxX = Math.max(...element.points.map((point) => point.x));
    const maxY = Math.max(...element.points.map((point) => point.y));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  if (element.type === "ellipse") {
    return { x: element.cx - element.rx, y: element.cy - element.ry, width: element.rx * 2, height: element.ry * 2 };
  }

  return unionBoxes(element.children.map(elementBox)) ?? { x: 0, y: 0, width: 0, height: 0 };
}

function unionBoxes(boxes: Box[]): Box | undefined {
  if (!boxes.length) {
    return undefined;
  }

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function centerOf(box: Box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function centerDistance(a: Box, b: Box): number {
  const aCenter = centerOf(a);
  const bCenter = centerOf(b);
  return Math.hypot(aCenter.x - bCenter.x, aCenter.y - bCenter.y);
}

function formatCenterDelta(box: Box, target: Box): string {
  const boxCenter = centerOf(box);
  const targetCenter = centerOf(target);
  return `dx=${round(boxCenter.x - targetCenter.x)}, dy=${round(boxCenter.y - targetCenter.y)}`;
}

function boxAroundCenter(template: Box, center: { x: number; y: number }): Box {
  return {
    x: center.x - template.width / 2,
    y: center.y - template.height / 2,
    width: template.width,
    height: template.height
  };
}

function contentTargetBox(container: Box, titleBoxes: Box[]): Box {
  if (!titleBoxes.length) {
    return container;
  }

  const gap = titleContentGap(container);
  const titleBottom = Math.max(...titleBoxes.map((box) => box.y + box.height));
  const y = Math.min(container.y + container.height, Math.max(container.y, titleBottom + gap));

  return {
    x: container.x,
    y,
    width: container.width,
    height: Math.max(1, container.y + container.height - y)
  };
}

function contentTargetCenter(container: Box, target: Box, content: Box) {
  const containerCenter = centerOf(container);
  const minY = target.y + Math.min(content.height, target.height) / 2;
  const maxY = target.y + target.height - Math.min(content.height, target.height) / 2;
  const y = minY <= maxY ? clampNumber(containerCenter.y, minY, maxY) : target.y + target.height / 2;

  return {
    x: containerCenter.x,
    y
  };
}

function titleContentGap(container: Box): number {
  return Math.min(MAX_TITLE_CONTENT_GAP, Math.max(MIN_TITLE_CONTENT_GAP, container.height * TITLE_CONTENT_GAP_RATIO));
}

function findRootBackgrounds(backgrounds: RectElement[]): RectElement[] {
  const roots = backgrounds.filter((background) => {
    const backgroundBox = elementBox(background);
    const backgroundArea = boxArea(backgroundBox);

    return !backgrounds.some((candidate) => {
      if (candidate === background) {
        return false;
      }

      const candidateBox = elementBox(candidate);
      return boxArea(candidateBox) > backgroundArea && containsBox(candidateBox, backgroundBox, BACKGROUND_ASSOCIATION_TOLERANCE);
    });
  });

  return roots.length ? roots : backgrounds.slice(0, 1);
}

function backgroundAssociationScore(background: RectElement, element: FigureElement): number {
  const backgroundBox = elementBox(background);
  const candidateBox = elementBox(element);
  const overlap = intersectionArea(backgroundBox, candidateBox);
  const candidateArea = Math.max(1, boxArea(candidateBox));
  const overlapRatio = overlap / candidateArea;
  const containsCandidate = containsBox(backgroundBox, candidateBox, BACKGROUND_ASSOCIATION_TOLERANCE);
  const containsCenter = containsPoint(backgroundBox, centerOf(candidateBox), BACKGROUND_ASSOCIATION_TOLERANCE);
  const authoredPoint = authoredElementPoint(element);
  const containsAuthoredPoint = authoredPoint
    ? containsPoint(backgroundBox, authoredPoint, BACKGROUND_ASSOCIATION_TOLERANCE)
    : false;

  if (!containsCandidate && !containsCenter && !containsAuthoredPoint && overlapRatio < MIN_BACKGROUND_OVERLAP_RATIO) {
    return 0;
  }

  return (
    (containsCandidate ? 6 : 0) +
    (containsCenter ? 4 : 0) +
    (containsAuthoredPoint ? 2 : 0) +
    Math.min(3, overlapRatio * 3)
  );
}

function authoredElementPoint(element: FigureElement): { x: number; y: number } | undefined {
  if (element.type === "rect" || element.type === "text") {
    return { x: element.x, y: element.y };
  }

  if (element.type === "line" || element.type === "arrow") {
    return {
      x: (element.x1 + element.x2) / 2,
      y: (element.y1 + element.y2) / 2
    };
  }

  return undefined;
}

function boxArea(box: Box): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function uniqueElements<T extends FigureElement>(elements: T[]): T[] {
  return Array.from(new Set(elements));
}

function isFullCanvasRect(rect: RectElement, canvasWidth: number, canvasHeight: number): boolean {
  return rect.x <= 1 && rect.y <= 1 && rect.width >= canvasWidth - 2 && rect.height >= canvasHeight - 2;
}

function isLikelyTitleText(text: TextElement, canvasWidth: number, canvasHeight: number, container?: Box): boolean {
  const label = `${text.id} ${text.name ?? ""}`.toLowerCase();
  const isLocalLabel = /(?:step|card|node|item|label|legend|axis|caption|badge|pill|tag|阶段|步骤|卡片|节点|标签|图例)/i.test(label);
  const hasTitleKeyword =
    /(?:^|[-_\s])(title|heading|headline)(?:$|[-_\s])/.test(label) ||
    /(?:主标题|总标题|页面标题|图表标题|标题)/.test(label);
  const bounds = container ?? { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  const textBox = elementBox(text);
  const textCenter = centerOf(textBox);
  const fontSize = text.fontSize ?? 22;
  const isInTopBand = textCenter.y <= bounds.y + bounds.height * 0.35;
  const isSemanticTitleWidth = textBox.width >= Math.min(canvasWidth * 0.25, bounds.width * 0.25);

  if (hasTitleKeyword && !isLocalLabel) {
    return containsPoint(bounds, textCenter, BACKGROUND_ASSOCIATION_TOLERANCE) && (!container || (isSemanticTitleWidth && isInTopBand));
  }

  const isWide = textBox.width >= Math.min(canvasWidth * 0.35, bounds.width * 0.55);

  return !isLocalLabel && fontSize >= 28 && isWide && isInTopBand && containsPoint(bounds, textCenter, BACKGROUND_ASSOCIATION_TOLERANCE);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function containsBox(container: Box, child: Box, tolerance = 0): boolean {
  return (
    child.x >= container.x - tolerance &&
    child.y >= container.y - tolerance &&
    child.x + child.width <= container.x + container.width + tolerance &&
    child.y + child.height <= container.y + container.height + tolerance
  );
}

function containsPoint(container: Box, point: { x: number; y: number }, tolerance = 0): boolean {
  return (
    point.x >= container.x - tolerance &&
    point.x <= container.x + container.width + tolerance &&
    point.y >= container.y - tolerance &&
    point.y <= container.y + container.height + tolerance
  );
}

function intersectionArea(a: Box, b: Box): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function isRectElement(element: FigureElement): element is RectElement {
  return element.type === "rect";
}

function isTextElement(element: FigureElement): element is TextElement {
  return element.type === "text";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
