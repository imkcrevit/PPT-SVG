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

