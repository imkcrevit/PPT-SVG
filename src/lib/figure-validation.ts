import { isLocale } from "@/lib/i18n";
import { isSkillId } from "@/lib/skills";
import type {
  ArrowElement,
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
    background: readColor(canvasRecord.background, "#FFFFFF")
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
    note: typeof fitRecord?.note === "string" ? fitRecord.note.slice(0, 180) : ""
  };

  return {
    ok: errors.length === 0,
    response: { figure, fit },
    errors
  };
}

function normalizeFigureLayout(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  centerTextGroupsInSmallRects(elements, canvasWidth, canvasHeight);

  if (centerLargeBackgroundLayouts(elements, canvasWidth, canvasHeight)) {
    centerTextGroupsInSmallRects(elements, canvasWidth, canvasHeight);
    return;
  }

  centerPrimaryContentInCanvas(elements, canvasWidth, canvasHeight);
  centerTextGroupsInSmallRects(elements, canvasWidth, canvasHeight);
}

function centerTextGroupsInSmallRects(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  const canvasArea = canvasWidth * canvasHeight;
  const leaves = flattenLeaves(elements);
  const rects = leaves
    .filter(isRectElement)
    .filter((rect) => rect.width * rect.height <= canvasArea * 0.18)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  const assignments = new Map<RectElement, TextElement[]>();

  for (const text of leaves.filter(isTextElement)) {
    const textBox = elementBox(text);
    const rect = rects.find((candidate) => containsBox(elementBox(candidate), textBox, 12));

    if (!rect) {
      continue;
    }

    assignments.set(rect, [...(assignments.get(rect) ?? []), text]);
  }

  for (const [rect, texts] of assignments) {
    const rectBox = elementBox(rect);
    const maxTextWidth = Math.max(1, rect.width - 32);

    for (const text of texts) {
      text.width = Math.min(text.width ?? maxTextWidth, maxTextWidth);
      text.x = round(rect.x + (rect.width - text.width) / 2);
      text.textAnchor = "middle";
    }

    const textGroupBox = unionBoxes(texts.map(elementBox));
    if (!textGroupBox) {
      continue;
    }

    const dy = rectBox.y + rectBox.height / 2 - (textGroupBox.y + textGroupBox.height / 2);
    for (const text of texts) {
      moveElement(text, 0, dy);
    }
  }
}

function centerLargeBackgroundLayouts(elements: FigureElement[], canvasWidth: number, canvasHeight: number): boolean {
  const canvasArea = canvasWidth * canvasHeight;
  const leaves = flattenLeaves(elements);
  const backgroundRects = leaves
    .filter(isRectElement)
    .filter((rect) => rect.width * rect.height >= canvasArea * 0.18 && !isFullCanvasRect(rect, canvasWidth, canvasHeight))
    .sort((a, b) => b.width * b.height - a.width * a.height);

  if (!backgroundRects.length) {
    return false;
  }

  for (const background of backgroundRects) {
    const backgroundBox = elementBox(background);
    const contained = leaves.filter((element) => element !== background && containsBox(backgroundBox, elementBox(element), 6));

    if (!contained.length) {
      continue;
    }

    const backgroundMoveBox = unionBoxes([backgroundBox, ...contained.map(elementBox)]);
    if (backgroundMoveBox) {
      const centered = constrainedDelta(
        canvasWidth / 2 - (backgroundBox.x + backgroundBox.width / 2),
        canvasHeight / 2 - (backgroundBox.y + backgroundBox.height / 2),
        backgroundMoveBox,
        canvasWidth,
        canvasHeight
      );
      for (const element of [background, ...contained]) {
        moveElement(element, centered.dx, centered.dy);
      }
    }

    const movedBackgroundBox = elementBox(background);
    const contentBox = unionBoxes(contained.map(elementBox));
    if (!contentBox) {
      continue;
    }

    const contentMove = constrainedDelta(
      movedBackgroundBox.x + movedBackgroundBox.width / 2 - (contentBox.x + contentBox.width / 2),
      movedBackgroundBox.y + movedBackgroundBox.height / 2 - (contentBox.y + contentBox.height / 2),
      contentBox,
      canvasWidth,
      canvasHeight
    );
    for (const element of contained) {
      moveElement(element, contentMove.dx, contentMove.dy);
    }
  }

  return true;
}

function centerPrimaryContentInCanvas(elements: FigureElement[], canvasWidth: number, canvasHeight: number): void {
  const leaves = flattenLeaves(elements);
  const movable = leaves.filter(
    (element) =>
      !(isRectElement(element) && isFullCanvasRect(element, canvasWidth, canvasHeight)) &&
      !(isTextElement(element) && isLikelyTitleText(element))
  );
  const contentBox = unionBoxes(movable.map(elementBox));

  if (!contentBox) {
    return;
  }

  const move = constrainedDelta(
    canvasWidth / 2 - (contentBox.x + contentBox.width / 2),
    canvasHeight / 2 - (contentBox.y + contentBox.height / 2),
    contentBox,
    canvasWidth,
    canvasHeight
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
    return { x: element.x, y: element.y, width: element.width ?? 240, height: element.height ?? 80 };
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

  element.x1 = round(element.x1 + dx);
  element.y1 = round(element.y1 + dy);
  element.x2 = round(element.x2 + dx);
  element.y2 = round(element.y2 + dy);
}

function isFullCanvasRect(rect: RectElement, canvasWidth: number, canvasHeight: number): boolean {
  return rect.x <= 1 && rect.y <= 1 && rect.width >= canvasWidth - 2 && rect.height >= canvasHeight - 2;
}

function isLikelyTitleText(text: TextElement): boolean {
  const label = `${text.id} ${text.name ?? ""}`.toLowerCase();
  return text.y <= 140 && (label.includes("title") || label.includes("标题"));
}

function isRectElement(element: FigureElement): element is RectElement {
  return element.type === "rect";
}

function isTextElement(element: FigureElement): element is TextElement {
  return element.type === "text";
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
  const name = typeof record.name === "string" ? record.name : undefined;
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
      strokeWidth: typeof record.strokeWidth === "number" ? clampNumber(record.strokeWidth, 0, 12, 1.5) : 1.5
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
      strokeWidth: typeof record.strokeWidth === "number" ? clampNumber(record.strokeWidth, 0.5, 12, 2) : 2
    };
    return base;
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
  if (typeof value === "string" && value.trim()) {
    return value.trim();
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
