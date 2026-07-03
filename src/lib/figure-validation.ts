import { isLocale } from "@/lib/i18n";
import { isSkillId } from "@/lib/skills";
import { estimateTextBlockHeight, sanitizeDisplayText } from "@/lib/text-layout";
import type {
  ArrowElement,
  ConnectorElement,
  Figure,
  FigureElement,
  FitAssessment,
  GenerateFigureResponse,
  GroupElement,
  LineElement,
  Locale,
  RectElement,
  SkillId,
  TextElement
} from "@/lib/types";

interface ValidationResult {
  ok: boolean;
  response?: GenerateFigureResponse;
  errors: string[];
}

type Path = Array<string | number>;
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_LAYOUT_NORMALIZATION_PASSES = 5;
const LARGE_BACKGROUND_AREA_RATIO = 0.18;
const BACKGROUND_ASSOCIATION_TOLERANCE = 12;
const MIN_BACKGROUND_OVERLAP_RATIO = 0.14;
const MIN_TITLE_CONTENT_GAP = 20;
const MAX_TITLE_CONTENT_GAP = 44;
const TITLE_CONTENT_GAP_RATIO = 0.045;

export function validateAndNormalizeFigureResponse(
  value: unknown,
  expectedSkillId: SkillId,
  expectedLanguage: Locale
): ValidationResult {
  const errors: string[] = [];
  const root = readRecord(value, [], errors);

  if (!root) {
    return { ok: false, errors };
  }

  const figureValue = "figure" in root ? root.figure : root;
  const figureRecord = readRecord(figureValue, ["figure"], errors);

  if (!figureRecord) {
    return { ok: false, errors };
  }

  const canvasRecord = readRecord(figureRecord.canvas, ["figure", "canvas"], errors);
  const metadataRecord = readRecord(figureRecord.metadata, ["figure", "metadata"], errors);
  const elementsArray = readArray(figureRecord.elements, ["figure", "elements"], errors);

  if (!canvasRecord || !metadataRecord || !elementsArray) {
    return { ok: false, errors };
  }

  const canvas = {
    width: readNumber(canvasRecord.width, ["figure", "canvas", "width"], errors, 1280, 320, 2400),
    height: readNumber(canvasRecord.height, ["figure", "canvas", "height"], errors, 720, 240, 1600),
    background: readColor(canvasRecord.background, "#FFFFFF"),
    // Preserve the resolved theme font so SVG preview, SVG download, and PPTX
    // export all render the same typeface. Sanitized to keep it safe inside SVG
    // attributes and PPTX XML.
    fontFamily: readFontFamily(canvasRecord.fontFamily)
  };

  const rawSkillId = readString(metadataRecord.skillId, ["figure", "metadata", "skillId"], errors, expectedSkillId);
  const rawLanguage = readString(metadataRecord.language, ["figure", "metadata", "language"], errors, expectedLanguage);
  const metadata = {
    title: readString(metadataRecord.title, ["figure", "metadata", "title"], errors, "Generated figure").slice(0, 80),
    description: readString(metadataRecord.description, ["figure", "metadata", "description"], errors, "").slice(0, 240),
    skillId: isSkillId(rawSkillId) ? rawSkillId : expectedSkillId,
    language: isLocale(rawLanguage) ? rawLanguage : expectedLanguage
  };

  const seenIds = new Set<string>();
  const elements = elementsArray
    .map((element, index) =>
      normalizeElement(element, ["figure", "elements", index], errors, seenIds, canvas.width, canvas.height)
    )
    .filter((element): element is FigureElement => Boolean(element));

  normalizeFigureLayout(elements, canvas.width, canvas.height);

  if (elements.length === 0) {
    errors.push("figure.elements must contain at least one valid element.");
  }

  const figure: Figure = {
    canvas,
    metadata,
    elements
  };

  const fitRecord = readRecord(root.fit, ["fit"], []);
  const fit: FitAssessment = {
    score: clampNumber(
      typeof fitRecord?.score === "number" ? fitRecord.score : 0.85,
      0,
      1,
      0.85
    ),
    note: typeof fitRecord?.note === "string" ? sanitizeDisplayText(fitRecord.note).slice(0, 180) : ""
  };

  return {
    ok: errors.length === 0,
    response: { figure, fit },
    errors
  };
}

function normalizeFigureLayout(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  let previousSignature = "";

  for (let pass = 0; pass < MAX_LAYOUT_NORMALIZATION_PASSES; pass += 1) {
    constrainElementsToCanvas(elements, canvasWidth, canvasHeight);
    centerTextGroupsInSmallRects(elements, canvasWidth, canvasHeight);

    if (centerLargeBackgroundLayouts(elements, canvasWidth, canvasHeight)) {
      finalizeLayoutConstraints(elements, canvasWidth, canvasHeight);
    } else {
      centerPrimaryContentInCanvas(elements, canvasWidth, canvasHeight);
      finalizeLayoutConstraints(elements, canvasWidth, canvasHeight);
    }

    const nextSignature = layoutSignature(elements);
    if (nextSignature === previousSignature || !hasLayoutOverflow(elements, canvasWidth, canvasHeight)) {
      return;
    }

    previousSignature = nextSignature;
  }
}

function finalizeLayoutConstraints(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  constrainElementsToCanvas(elements, canvasWidth, canvasHeight);
  centerTextGroupsInSmallRects(elements, canvasWidth, canvasHeight);
  constrainElementsToCanvas(elements, canvasWidth, canvasHeight);
}

function centerTextGroupsInSmallRects(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  const canvasArea = canvasWidth * canvasHeight;
  const leaves = flattenLeaves(elements);
  const rects = leaves
    .filter(isRectElement)
    .filter((rect) => rect.width * rect.height <= canvasArea * 0.18)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  const assignments = new Map<RectElement, TextElement[]>();

  for (const text of leaves.filter(isTextElement).filter((text) => !shouldPreserveTextPosition(text))) {
    const rect = findBestContainingRect(text, rects);

    if (!rect) {
      continue;
    }

    assignments.set(rect, [...(assignments.get(rect) ?? []), text]);
  }

  for (const [rect, texts] of assignments) {
    fitTextGroupToRect(texts, rect);
  }
}

function fitTextGroupToRect(texts: TextElement[], rect: RectElement): void {
  const orderedTexts = [...texts].sort((a, b) => a.y - b.y);
  const paddingX = Math.min(32, Math.max(8, rect.width * 0.12));
  const paddingY = Math.min(16, Math.max(6, rect.height * 0.12));
  const maxTextWidth = Math.max(1, rect.width - paddingX * 2);
  const availableHeight = Math.max(1, rect.height - paddingY * 2);
  const gap = orderedTexts.length > 1 ? Math.min(8, Math.max(2, availableHeight * 0.06)) : 0;

  for (const text of orderedTexts) {
    text.width = maxTextWidth;
    text.textAnchor = "middle";
    fitTextFontToBox(text, maxTextWidth, Math.max(1, availableHeight - gap * (orderedTexts.length - 1)));
  }

  while (textGroupHeight(orderedTexts, gap) > availableHeight && orderedTexts.some((text) => (text.fontSize ?? 22) > 8)) {
    for (const text of orderedTexts) {
      text.fontSize = Math.max(8, (text.fontSize ?? 22) - 1);
      text.height = estimateTextHeight(text);
    }
  }

  const availableTextHeight = Math.max(1, availableHeight - gap * Math.max(0, orderedTexts.length - 1));
  if (textGroupHeight(orderedTexts, gap) > availableHeight) {
    const perTextHeight = Math.max(1, availableTextHeight / orderedTexts.length);
    for (const text of orderedTexts) {
      text.height = Math.min(text.height ?? estimateTextHeight(text), perTextHeight);
    }
  }

  const totalHeight = textGroupHeight(orderedTexts, gap);
  let cursorY = rect.y + (rect.height - totalHeight) / 2;

  for (const text of orderedTexts) {
    const height = text.height ?? estimateTextHeight(text);
    const width = text.width ?? maxTextWidth;
    text.x = round(rect.x + (rect.width - width) / 2);
    text.y = round(cursorY);
    cursorY += height + gap;
  }
}

function fitTextFontToBox(text: TextElement, width: number, maxHeight: number): void {
  text.width = width;

  while (estimateTextHeight(text) > maxHeight && (text.fontSize ?? 22) > 8) {
    text.fontSize = Math.max(8, (text.fontSize ?? 22) - 1);
  }

  text.height = Math.min(estimateTextHeight(text), maxHeight);
}

function textGroupHeight(texts: TextElement[], gap: number): number {
  return texts.reduce((total, text) => total + (text.height ?? estimateTextHeight(text)), 0) + gap * Math.max(0, texts.length - 1);
}

function findBestContainingRect(text: TextElement, rects: RectElement[]): RectElement | undefined {
  const textBox = elementBox(text);
  const textCenter = centerOf(textBox);
  const authoredPoint = { x: text.x, y: text.y };

  return rects
    .map((rect) => {
      const rectBox = elementBox(rect);
      const containsText = containsBox(rectBox, textBox, 12);
      const containsCenter = containsPoint(rectBox, textCenter, 12);
      const containsAuthoredPoint = containsPoint(rectBox, authoredPoint, 12);
      const overlap = intersectionArea(rectBox, textBox);

      if (!containsText && !containsCenter && !containsAuthoredPoint && overlap <= 0) {
        return undefined;
      }

      const rectArea = Math.max(1, rectBox.width * rectBox.height);
      const score =
        (containsText ? 4 : 0) +
        (containsCenter ? 3 : 0) +
        (containsAuthoredPoint ? 2 : 0) +
        Math.min(1, overlap / rectArea);
      return { rect, score };
    })
    .filter((candidate): candidate is { rect: RectElement; score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score || a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0]?.rect;
}

function centerLargeBackgroundLayouts(elements: FigureElement[], canvasWidth: number, canvasHeight: number): boolean {
  const canvasArea = canvasWidth * canvasHeight;
  const leaves = flattenLeaves(elements);
  const backgroundRects = leaves
    .filter(isRectElement)
    .filter((rect) => rect.width * rect.height >= canvasArea * LARGE_BACKGROUND_AREA_RATIO && !isFullCanvasRect(rect, canvasWidth, canvasHeight))
    .sort((a, b) => b.width * b.height - a.width * a.height);

  if (!backgroundRects.length) {
    return false;
  }

  const rootBackgrounds = findRootBackgrounds(backgroundRects);
  const rootAssignments = assignElementsToBackgrounds(rootBackgrounds, leaves, canvasWidth, canvasHeight, {
    includeTitles: true
  });
  const rootMovable = uniqueElements([...rootBackgrounds, ...Array.from(rootAssignments.values()).flat()]);
  const rootBackgroundBox = unionBoxes(rootBackgrounds.map(elementBox));
  const rootGroupBox = unionBoxes(rootMovable.map(elementBox));

  if (rootBackgroundBox && rootGroupBox) {
    const move = constrainedDelta(
      canvasWidth / 2 - (rootBackgroundBox.x + rootBackgroundBox.width / 2),
      canvasHeight / 2 - (rootBackgroundBox.y + rootBackgroundBox.height / 2),
      rootGroupBox,
      canvasWidth,
      canvasHeight
    );
    for (const element of rootMovable) {
      moveElement(element, move.dx, move.dy);
    }
  }

  for (const background of backgroundRects) {
    centerAssociatedContentInBackground(background, leaves, canvasWidth, canvasHeight);
  }

  return true;
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

function assignElementsToBackgrounds(
  backgrounds: RectElement[],
  leaves: FigureElement[],
  canvasWidth: number,
  canvasHeight: number,
  options: { includeTitles?: boolean } = {}
): Map<RectElement, FigureElement[]> {
  const assignments = new Map<RectElement, FigureElement[]>();

  for (const background of backgrounds) {
    assignments.set(background, []);
  }

  for (const element of leaves) {
    if (
      backgrounds.includes(element as RectElement) ||
      (isRectElement(element) && isFullCanvasRect(element, canvasWidth, canvasHeight)) ||
      (!options.includeTitles && isTextElement(element) && isLikelyTitleText(element, canvasWidth, canvasHeight))
    ) {
      continue;
    }

    const best = backgrounds
      .map((background) => ({ background, score: backgroundAssociationScore(background, element) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || boxArea(elementBox(a.background)) - boxArea(elementBox(b.background)))[0];

    if (best) {
      assignments.set(best.background, [...(assignments.get(best.background) ?? []), element]);
    }
  }

  return assignments;
}

function centerAssociatedContentInBackground(
  background: RectElement,
  leaves: FigureElement[],
  canvasWidth: number,
  canvasHeight: number
): void {
  const backgroundBox = elementBox(background);
  const titleBoxes = leaves
    .filter((element): element is TextElement => isTextElement(element) && isLikelyTitleText(element, canvasWidth, canvasHeight, backgroundBox))
    .filter((text) => backgroundAssociationScore(background, text) > 0)
    .map(elementBox);
  const content = leaves.filter((element) => {
    if (
      element === background ||
      (isRectElement(element) && isFullCanvasRect(element, canvasWidth, canvasHeight)) ||
      (isTextElement(element) && shouldPreserveTextPosition(element)) ||
      (isTextElement(element) && isLikelyTitleText(element, canvasWidth, canvasHeight, backgroundBox))
    ) {
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
    return;
  }

  const targetBox = contentTargetBox(backgroundBox, titleBoxes);
  const targetCenter = contentTargetCenter(backgroundBox, targetBox, contentBox);
  const move = constrainedDeltaWithinContainer(
    targetCenter.x - (contentBox.x + contentBox.width / 2),
    targetCenter.y - (contentBox.y + contentBox.height / 2),
    contentBox,
    targetBox
  );
  const canvasMove = constrainedDelta(move.dx, move.dy, contentBox, canvasWidth, canvasHeight);

  for (const element of content) {
    moveElement(element, canvasMove.dx, canvasMove.dy);
  }
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
  const y = minY <= maxY ? clampNumber(containerCenter.y, minY, maxY, containerCenter.y) : target.y + target.height / 2;

  return {
    x: containerCenter.x,
    y
  };
}

function titleContentGap(container: Box): number {
  return Math.min(MAX_TITLE_CONTENT_GAP, Math.max(MIN_TITLE_CONTENT_GAP, container.height * TITLE_CONTENT_GAP_RATIO));
}

function centerPrimaryContentInCanvas(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  const leaves = flattenLeaves(elements);
  const canvasBox = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  const titleBoxes = leaves
    .filter((element): element is TextElement => isTextElement(element) && isLikelyTitleText(element, canvasWidth, canvasHeight))
    .map(elementBox);
  const movable = leaves.filter(
    (element) =>
      !(isRectElement(element) && isFullCanvasRect(element, canvasWidth, canvasHeight)) &&
      !(isTextElement(element) && isLikelyTitleText(element, canvasWidth, canvasHeight))
  );
  const contentBox = unionBoxes(movable.map(elementBox));

  if (!contentBox) {
    return;
  }

  const targetBox = contentTargetBox(canvasBox, titleBoxes);
  const targetCenter = contentTargetCenter(canvasBox, targetBox, contentBox);
  const move = constrainedDeltaWithinContainer(
    targetCenter.x - (contentBox.x + contentBox.width / 2),
    targetCenter.y - (contentBox.y + contentBox.height / 2),
    contentBox,
    targetBox
  );

  if (Math.abs(move.dx) < 1 && Math.abs(move.dy) < 1) {
    return;
  }

  for (const element of movable) {
    moveElement(element, move.dx, move.dy);
  }
}

function flattenLeaves(elements: FigureElement[]): FigureElement[] {
  const flattened: FigureElement[] = [];

  for (const element of elements) {
    if (element.type === "group") {
      flattened.push(...flattenLeaves(element.children));
    } else {
      flattened.push(element);
    }
  }

  return flattened;
}

function elementBox(element: FigureElement): Box {
  if (element.type === "rect") {
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }

  if (element.type === "text") {
    return { x: element.x, y: element.y, width: element.width ?? 240, height: element.height ?? estimateTextHeight(element) };
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

  if (element.type === "polygon" || element.type === "connector") {
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

function centerOf(box: Box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
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

  if (element.type === "polygon" || element.type === "connector") {
    const box = elementBox(element);
    return centerOf(box);
  }

  if (element.type === "ellipse") {
    return { x: element.cx, y: element.cy };
  }

  return undefined;
}

function boxArea(box: Box): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
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

function estimateTextHeight(text: TextElement): number {
  const fontSize = text.fontSize ?? 22;
  const width = text.width ?? 240;
  return estimateTextBlockHeight(text.text, width, fontSize);
}

function unionBoxes(boxes: Box[]): Box | undefined {
  if (!boxes.length) {
    return undefined;
  }

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function containsBox(container: Box, child: Box, tolerance = 0): boolean {
  return (
    child.x >= container.x - tolerance &&
    child.y >= container.y - tolerance &&
    child.x + child.width <= container.x + container.width + tolerance &&
    child.y + child.height <= container.y + container.height + tolerance
  );
}

function constrainedDelta(dx: number, dy: number, box: Box, canvasWidth: number, canvasHeight: number) {
  let constrainedX = dx;
  let constrainedY = dy;

  if (box.x + constrainedX < 0) {
    constrainedX = -box.x;
  }

  if (box.x + box.width + constrainedX > canvasWidth) {
    constrainedX = canvasWidth - (box.x + box.width);
  }

  if (box.y + constrainedY < 0) {
    constrainedY = -box.y;
  }

  if (box.y + box.height + constrainedY > canvasHeight) {
    constrainedY = canvasHeight - (box.y + box.height);
  }

  return { dx: constrainedX, dy: constrainedY };
}

function constrainedDeltaWithinContainer(dx: number, dy: number, box: Box, container: Box) {
  let constrainedX = dx;
  let constrainedY = dy;

  if (box.width <= container.width) {
    if (box.x + constrainedX < container.x) {
      constrainedX = container.x - box.x;
    }

    if (box.x + box.width + constrainedX > container.x + container.width) {
      constrainedX = container.x + container.width - (box.x + box.width);
    }
  }

  if (box.height <= container.height) {
    if (box.y + constrainedY < container.y) {
      constrainedY = container.y - box.y;
    }

    if (box.y + box.height + constrainedY > container.y + container.height) {
      constrainedY = container.y + container.height - (box.y + box.height);
    }
  }

  return { dx: constrainedX, dy: constrainedY };
}

function constrainElementsToCanvas(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  for (const element of elements) {
    constrainElementToCanvas(element, canvasWidth, canvasHeight);
  }
}

function constrainElementToCanvas(element: FigureElement, canvasWidth: number, canvasHeight: number): void {
  if (element.type === "group") {
    for (const child of element.children) {
      constrainElementToCanvas(child, canvasWidth, canvasHeight);
    }
    return;
  }

  if (element.type === "rect") {
    element.width = round(Math.min(element.width, canvasWidth));
    element.height = round(Math.min(element.height, canvasHeight));
    element.x = round(clampNumber(element.x, 0, Math.max(0, canvasWidth - element.width), 0));
    element.y = round(clampNumber(element.y, 0, Math.max(0, canvasHeight - element.height), 0));
    return;
  }

  if (element.type === "text") {
    const width = Math.min(element.width ?? 240, canvasWidth);
    const height = Math.min(element.height ?? estimateTextHeight(element), canvasHeight);
    element.width = round(width);
    element.height = round(height);
    element.x = round(clampNumber(element.x, 0, Math.max(0, canvasWidth - width), 0));
    element.y = round(clampNumber(element.y, 0, Math.max(0, canvasHeight - height), 0));
    return;
  }

  if (element.type === "polygon" || element.type === "connector") {
    element.points = element.points.map((point) => ({
      x: round(clampNumber(point.x, 0, canvasWidth, 0)),
      y: round(clampNumber(point.y, 0, canvasHeight, 0))
    }));
    return;
  }

  if (element.type === "ellipse") {
    element.rx = round(Math.min(element.rx, canvasWidth / 2));
    element.ry = round(Math.min(element.ry, canvasHeight / 2));
    element.cx = round(clampNumber(element.cx, element.rx, canvasWidth - element.rx, canvasWidth / 2));
    element.cy = round(clampNumber(element.cy, element.ry, canvasHeight - element.ry, canvasHeight / 2));
    return;
  }

  if (element.type === "line" || element.type === "arrow") {
    element.x1 = round(clampNumber(element.x1, 0, canvasWidth, 0));
    element.y1 = round(clampNumber(element.y1, 0, canvasHeight, 0));
    element.x2 = round(clampNumber(element.x2, 0, canvasWidth, 0));
    element.y2 = round(clampNumber(element.y2, 0, canvasHeight, 0));
  }
}

function hasLayoutOverflow(elements: FigureElement[], canvasWidth: number, canvasHeight: number): boolean {
  return flattenLeaves(elements).some((element) => {
    const box = elementBox(element);
    return box.x < 0 || box.y < 0 || box.x + box.width > canvasWidth || box.y + box.height > canvasHeight;
  });
}

function layoutSignature(elements: FigureElement[]): string {
  return flattenLeaves(elements)
    .map((element) => {
      const box = elementBox(element);
      return `${element.id}:${round(box.x)},${round(box.y)},${round(box.width)},${round(box.height)}`;
    })
    .join("|");
}

function moveElement(element: FigureElement, dx: number, dy: number): void {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return;
  }

  if (element.type === "group") {
    for (const child of element.children) {
      moveElement(child, dx, dy);
    }
    return;
  }

  if (element.type === "rect" || element.type === "text") {
    element.x = round(element.x + dx);
    element.y = round(element.y + dy);
    return;
  }

  if (element.type === "polygon" || element.type === "connector") {
    element.points = element.points.map((point) => ({ x: round(point.x + dx), y: round(point.y + dy) }));
    return;
  }

  if (element.type === "ellipse") {
    element.cx = round(element.cx + dx);
    element.cy = round(element.cy + dy);
    return;
  }

  if (element.type === "line" || element.type === "arrow") {
    element.x1 = round(element.x1 + dx);
    element.y1 = round(element.y1 + dy);
    element.x2 = round(element.x2 + dx);
    element.y2 = round(element.y2 + dy);
  }
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

function isRectElement(element: FigureElement): element is RectElement {
  return element.type === "rect";
}

function isTextElement(element: FigureElement): element is TextElement {
  return element.type === "text";
}

function shouldPreserveTextPosition(text: TextElement): boolean {
  return /^(lane-name-\d+|gantt-name-\d+|matrix-ylabel|scatter-ylabel)$/.test(text.id);
}

function normalizeElement(
  value: unknown,
  path: Path,
  errors: string[],
  seenIds: Set<string>,
  canvasWidth: number,
  canvasHeight: number
): FigureElement | undefined {
  const record = readRecord(value, path, errors);

  if (!record) {
    return undefined;
  }

  const type = readString(record.type, [...path, "type"], errors, "");
  const id = uniqueId(readString(record.id, [...path, "id"], errors, `${type || "element"}-${path.join("-")}`), seenIds);
  const name = typeof record.name === "string" ? sanitizeDisplayText(record.name) || undefined : undefined;
  const opacity = typeof record.opacity === "number" ? clampNumber(record.opacity, 0, 1, 1) : undefined;

  if (type === "group") {
    const children = readArray(record.children, [...path, "children"], errors) ?? [];
    const group: GroupElement = {
      id,
      type,
      name,
      opacity,
      children: children
        .map((child, index) => normalizeElement(child, [...path, "children", index], errors, seenIds, canvasWidth, canvasHeight))
        .filter((child): child is FigureElement => Boolean(child))
    };
    return group;
  }

  if (type === "rect") {
    const rect: RectElement = {
      id,
      type,
      name,
      opacity,
      x: readNumber(record.x, [...path, "x"], errors, 0, 0, canvasWidth),
      y: readNumber(record.y, [...path, "y"], errors, 0, 0, canvasHeight),
      width: readNumber(record.width, [...path, "width"], errors, 120, 1, canvasWidth),
      height: readNumber(record.height, [...path, "height"], errors, 60, 1, canvasHeight),
      rx: typeof record.rx === "number" ? clampNumber(record.rx, 0, 80, 0) : 0,
      fill: readColor(record.fill, "#FFFFFF"),
      stroke: typeof record.stroke === "string" ? readColor(record.stroke, "#1D2433") : undefined,
      strokeWidth: typeof record.strokeWidth === "number" ? clampNumber(record.strokeWidth, 0, 12, 1.5) : 1.5,
      dash: record.dash === true
    };
    return rect;
  }

  if (type === "text") {
    const text: TextElement = {
      id,
      type,
      name,
      opacity,
      x: readNumber(record.x, [...path, "x"], errors, 0, 0, canvasWidth),
      y: readNumber(record.y, [...path, "y"], errors, 0, 0, canvasHeight),
      width: typeof record.width === "number" ? clampNumber(record.width, 1, canvasWidth, 240) : undefined,
      height: typeof record.height === "number" ? clampNumber(record.height, 1, canvasHeight, 80) : undefined,
      text: readString(record.text, [...path, "text"], errors, "Label").slice(0, 220),
      fontSize: typeof record.fontSize === "number" ? clampNumber(record.fontSize, 8, 72, 22) : 22,
      fontWeight: typeof record.fontWeight === "number" ? clampNumber(record.fontWeight, 300, 800, 500) : 500,
      fill: typeof record.fill === "string" ? readColor(record.fill, "#1D2433") : "#1D2433",
      textAnchor: isTextAnchor(record.textAnchor) ? record.textAnchor : "middle"
    };
    return text;
  }

  if (type === "line" || type === "arrow") {
    const base: LineElement | ArrowElement = {
      id,
      type,
      name,
      opacity,
      x1: readNumber(record.x1, [...path, "x1"], errors, 0, 0, canvasWidth),
      y1: readNumber(record.y1, [...path, "y1"], errors, 0, 0, canvasHeight),
      x2: readNumber(record.x2, [...path, "x2"], errors, 120, 0, canvasWidth),
      y2: readNumber(record.y2, [...path, "y2"], errors, 120, 0, canvasHeight),
      stroke: readColor(record.stroke, "#1D2433"),
      strokeWidth: typeof record.strokeWidth === "number" ? clampNumber(record.strokeWidth, 0.5, 12, 2) : 2,
      dash: record.dash === true
    };
    return base;
  }

  if (type === "connector") {
    const pointRecords = readArray(record.points, [...path, "points"], errors) ?? [];
    let points = pointRecords
      .map((point, index) => {
        const pointRecord = readRecord(point, [...path, "points", index], errors);

        if (!pointRecord) {
          return undefined;
        }

        return {
          x: readNumber(pointRecord.x, [...path, "points", index, "x"], errors, index === 0 ? 0 : 120, 0, canvasWidth),
          y: readNumber(pointRecord.y, [...path, "points", index, "y"], errors, index === 0 ? 0 : 120, 0, canvasHeight)
        };
      })
      .filter((point): point is { x: number; y: number } => Boolean(point));

    if (points.length < 2) {
      errors.push(`${formatPath([...path, "points"])} must contain at least two points.`);
      points = [
        { x: 0, y: 0 },
        { x: Math.min(120, canvasWidth), y: Math.min(120, canvasHeight) }
      ];
    }

    const connector: ConnectorElement = {
      id,
      type,
      name,
      opacity,
      points,
      stroke: readColor(record.stroke, "#1D2433"),
      strokeWidth: typeof record.strokeWidth === "number" ? clampNumber(record.strokeWidth, 0.5, 12, 2) : 2,
      dash: record.dash === true,
      endArrow: record.endArrow === true
    };
    return connector;
  }

  errors.push(`${formatPath(path)} has unsupported element type "${type}".`);
  return undefined;
}

function readRecord(value: unknown, path: Path, errors: string[]): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  errors.push(`${formatPath(path)} must be an object.`);
  return undefined;
}

function readArray(value: unknown, path: Path, errors: string[]): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  errors.push(`${formatPath(path)} must be an array.`);
  return undefined;
}

function readString(value: unknown, path: Path, errors: string[], fallback: string): string {
  const sanitized = typeof value === "string" ? sanitizeDisplayText(value) : "";

  if (sanitized) {
    return sanitized;
  }

  errors.push(`${formatPath(path)} must be a non-empty string.`);
  return fallback;
}

function readNumber(
  value: unknown,
  path: Path,
  errors: string[],
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return round(clampNumber(value, min, max, fallback));
  }

  errors.push(`${formatPath(path)} must be a finite number.`);
  return fallback;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) || value === "none")) {
    return value;
  }

  return fallback;
}

function readFontFamily(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const cleaned = value.replace(/["'<>`;{}]/g, "").trim().slice(0, 60);
  return cleaned || undefined;
}

function uniqueId(value: string, seenIds: Set<string>): string {
  const base = slugId(value || "element");
  let candidate = base;
  let suffix = 2;

  while (seenIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  seenIds.add(candidate);
  return candidate;
}

function slugId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "element";
}

function isTextAnchor(value: unknown): value is TextElement["textAnchor"] {
  return value === "start" || value === "middle" || value === "end";
}

function formatPath(path: Path): string {
  return path.length ? path.map(String).join(".") : "root";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
