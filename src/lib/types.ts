export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const SKILL_IDS = ["flow", "matrix", "timeline", "pyramid", "architecture"] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export interface CanvasSpec {
  width: number;
  height: number;
  background: string;
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
}

export interface ArrowElement extends Omit<BaseElement, "type"> {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth?: number;
}

export type FigureElement = GroupElement | RectElement | TextElement | LineElement | ArrowElement;

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
  pptContext?: {
    fileName?: string;
    extractedText?: string;
  };
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
