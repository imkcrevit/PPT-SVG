import type { DiagramTheme, ThemeOverride } from "@/lib/theme";
export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const SKILL_IDS = [
  "freeform", "flow", "matrix", "timeline", "pyramid", "architecture",
  "hierarchy", "cycle", "funnel", "venn", "mindmap", "fishbone",
  "gantt", "swimlane", "scatter", "kanban", "network", "radar",
  "heatmap", "waterfall"
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export interface CanvasSpec {
  width: number;
  height: number;
  background: string;
  fontFamily?: string;
}

export interface FigureMetadata {
  title: string;
  description: string;
  skillId: SkillId;
  language: Locale;
}

export interface BaseElement {
  id: string;
  type: string;
  name?: string;
  opacity?: number;
}

export interface GroupElement extends Omit<BaseElement, "type"> {
  type: "group";
  children: FigureElement[];
}

export interface RectElement extends Omit<BaseElement, "type"> {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: boolean;
}

export interface TextElement extends Omit<BaseElement, "type"> {
  type: "text";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  fontSize?: number;
  fontWeight?: number;
  fill?: string;
  textAnchor?: "start" | "middle" | "end";
}

export interface LineElement extends Omit<BaseElement, "type"> {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
  dash?: boolean;
}

export interface ArrowElement extends Omit<BaseElement, "type"> {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
  dash?: boolean;
}

export interface ConnectorElement extends Omit<BaseElement, "type"> {
  type: "connector";
  points: { x: number; y: number }[];
  stroke: string;
  strokeWidth?: number;
  dash?: boolean;
  endArrow?: boolean;
}

export interface PolygonElement extends Omit<BaseElement, "type"> {
  type: "polygon";
  points: { x: number; y: number }[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: boolean;
}

export interface EllipseElement extends Omit<BaseElement, "type"> {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: boolean;
}

export interface ImageElement extends Omit<BaseElement, "type"> {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  /** data: URI (base64 PNG/JPEG). Rendered as SVG <image> and PPTX addImage. */
  src: string;
  /** Fit within the box. "contain" (default) letterboxes; "cover" fills+crops. */
  fit?: "contain" | "cover" | "stretch";
  rx?: number;
}

export type FigureElement =
  | GroupElement
  | RectElement
  | TextElement
  | LineElement
  | ArrowElement
  | ConnectorElement
  | PolygonElement
  | EllipseElement
  | ImageElement;

export interface Figure {
  canvas: CanvasSpec;
  metadata: FigureMetadata;
  elements: FigureElement[];
}

export interface FitAssessment {
  score: number;
  note: string;
}

export interface GenerateFigureResponse {
  figure: Figure;
  fit: FitAssessment;
}

export interface GenerateFigureRequest {
  skillId: SkillId;
  userDescription: string;
  language: Locale;
  sessionId?: string;
  conversationId?: string;
  conversationTurn?: number;
  attachments?: UploadedAttachment[];
  themeOverride?: ThemeOverride;
  pptContext?: {
    fileName?: string;
    extractedText?: string;
  };
  referenceFigure?: {
    source: "current-render";
    figure: Figure;
    fit?: FitAssessment | null;
  };
  clientLog?: {
    messageId?: string;
    sentAt?: string;
  };
}

/** An image the user supplied — a standalone upload or one lifted out of an
 *  uploaded PPTX/DOCX — ready to embed into generated slides. */
export interface AttachmentImage {
  id: string;
  /** data:image/(png|jpeg);base64,… — already downscaled to a slide-safe size. */
  dataUri: string;
  width: number;
  height: number;
  mimeType: string;
  /** Where it came from, for prompt context (e.g. "2026.pptx · slide media"). */
  source?: string;
}

export interface UploadedAttachment {
  id: string;
  originalName: string;
  hash: string;
  extension: string;
  mimeType: string;
  size: number;
  path: string;
  extractedText?: string;
  theme?: DiagramTheme;
  /** Images extracted from this upload (standalone image, or PPTX/DOCX media). */
  images?: AttachmentImage[];
}

export interface InternalSkill {
  id: SkillId;
  name: {
    en: string;
    zh: string;
  };
  description: {
    en: string;
    zh: string;
  };
  promptFile: string;
  defaultCanvas: CanvasSpec;
}
