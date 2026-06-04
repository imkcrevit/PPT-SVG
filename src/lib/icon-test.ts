import type { Figure, FigureElement, Locale } from "@/lib/types";

export type IconTestId = "triangle" | "diamond" | "circle" | "shield" | "stack";

type IconPrimitive =
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
    }
  | {
      type: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
    }
  | {
      type: "polygon";
      points: Array<{ x: number; y: number }>;
    };

interface IconDefinition {
  id: IconTestId;
  label: Record<Locale, string>;
  primitives: IconPrimitive[];
}

export interface IconCoverageResult {
  iconId: IconTestId;
  label: string;
  coverageRatio: number;
  normalizedArea: number;
  renderedArea: number;
  iconBoxSize: number;
}

export const ICON_TEST_OPTIONS: Array<{ id: IconTestId; label: Record<Locale, string> }> = [
  { id: "triangle", label: { en: "Triangle", zh: "三角形" } },
  { id: "diamond", label: { en: "Diamond", zh: "菱形" } },
  { id: "circle", label: { en: "Circle", zh: "圆形" } },
  { id: "shield", label: { en: "Shield", zh: "盾牌" } },
  { id: "stack", label: { en: "Stack", zh: "层叠块" } }
];

const ICON_VIEWBOX_SIZE = 100;
const COVERAGE_SAMPLE_SIZE = 180;
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const ICON_BOX_SIZE = 240;

const ICON_DEFINITIONS: Record<IconTestId, IconDefinition> = {
  triangle: {
    id: "triangle",
    label: { en: "Triangle", zh: "三角形" },
    primitives: [
      {
        type: "polygon",
        points: [
          { x: 50, y: 14 },
          { x: 88, y: 84 },
          { x: 12, y: 84 }
        ]
      }
    ]
  },
  diamond: {
    id: "diamond",
    label: { en: "Diamond", zh: "菱形" },
    primitives: [
      {
        type: "polygon",
        points: [
          { x: 50, y: 8 },
          { x: 92, y: 50 },
          { x: 50, y: 92 },
          { x: 8, y: 50 }
        ]
      }
    ]
  },
  circle: {
    id: "circle",
    label: { en: "Circle", zh: "圆形" },
    primitives: [{ type: "ellipse", cx: 50, cy: 50, rx: 38, ry: 38 }]
  },
  shield: {
    id: "shield",
    label: { en: "Shield", zh: "盾牌" },
    primitives: [
      {
        type: "polygon",
        points: [
          { x: 50, y: 8 },
          { x: 86, y: 24 },
          { x: 78, y: 64 },
          { x: 50, y: 92 },
          { x: 22, y: 64 },
          { x: 14, y: 24 }
        ]
      }
    ]
  },
  stack: {
    id: "stack",
    label: { en: "Stack", zh: "层叠块" },
    primitives: [
      { type: "rect", x: 16, y: 18, width: 68, height: 18, rx: 4 },
      { type: "rect", x: 22, y: 42, width: 56, height: 18, rx: 4 },
      { type: "rect", x: 28, y: 66, width: 44, height: 18, rx: 4 }
    ]
  }
};

export function createIconCoverageTestFigure(iconId: IconTestId, locale: Locale): { figure: Figure; fit: { score: number; note: string }; coverage: IconCoverageResult } {
  const definition = ICON_DEFINITIONS[iconId] ?? ICON_DEFINITIONS.triangle;
  const coverageRatio = estimateCoverageRatio(definition.primitives);
  const normalizedArea = coverageRatio * ICON_VIEWBOX_SIZE * ICON_VIEWBOX_SIZE;
  const renderedArea = coverageRatio * ICON_BOX_SIZE * ICON_BOX_SIZE;
  const label = definition.label[locale];
  const coverage: IconCoverageResult = {
    iconId: definition.id,
    label,
    coverageRatio,
    normalizedArea,
    renderedArea,
    iconBoxSize: ICON_BOX_SIZE
  };

  const zh = locale === "zh";
  const title = zh ? "图标覆盖面积测试" : "Icon Coverage Test";
  const description = zh
    ? `选择“${label}”图标，估算覆盖面积并生成包含该图标的测试图。`
    : `Selected ${label}, estimated its coverage area, and generated a test figure containing the icon.`;
  const percent = `${(coverageRatio * 100).toFixed(1)}%`;
  const iconX = 250;
  const iconY = 210;
  const infoX = 630;
  const infoY = 218;

  const elements: FigureElement[] = [
    { id: "icon-test-bg", type: "rect", x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, fill: "#FFFFFF" },
    {
      id: "icon-test-title",
      type: "text",
      x: 0,
      y: 62,
      width: CANVAS_WIDTH,
      height: 40,
      text: title,
      fontSize: 30,
      fontWeight: 700,
      fill: "#1D2433",
      textAnchor: "middle"
    },
    {
      id: "icon-test-subtitle",
      type: "text",
      x: 0,
      y: 104,
      width: CANVAS_WIDTH,
      height: 28,
      text: description,
      fontSize: 14,
      fontWeight: 500,
      fill: "#6B7280",
      textAnchor: "middle"
    },
    {
      id: "icon-test-icon-frame",
      type: "rect",
      x: iconX - 28,
      y: iconY - 28,
      width: ICON_BOX_SIZE + 56,
      height: ICON_BOX_SIZE + 56,
      rx: 18,
      fill: "#F7F7F4",
      stroke: "#D9D7CF",
      strokeWidth: 1.5
    },
    {
      id: "icon-test-icon-bounds",
      type: "rect",
      x: iconX,
      y: iconY,
      width: ICON_BOX_SIZE,
      height: ICON_BOX_SIZE,
      rx: 10,
      fill: "none",
      stroke: "#A94B2F",
      strokeWidth: 2,
      dash: true
    },
    ...buildIconElements(definition, iconX, iconY, ICON_BOX_SIZE),
    {
      id: "icon-test-info-panel",
      type: "rect",
      x: infoX,
      y: infoY,
      width: 390,
      height: 214,
      rx: 14,
      fill: "#FDFDFB",
      stroke: "#D9D7CF",
      strokeWidth: 1.5
    },
    {
      id: "icon-test-info-title",
      type: "text",
      x: infoX + 28,
      y: infoY + 28,
      width: 334,
      height: 28,
      text: zh ? `已选择：${label}` : `Selected: ${label}`,
      fontSize: 18,
      fontWeight: 700,
      fill: "#1D2433",
      textAnchor: "start"
    },
    {
      id: "icon-test-info-ratio",
      type: "text",
      x: infoX + 28,
      y: infoY + 78,
      width: 334,
      height: 26,
      text: zh ? `覆盖率：${percent}` : `Coverage: ${percent}`,
      fontSize: 15,
      fontWeight: 600,
      fill: "#1D2433",
      textAnchor: "start"
    },
    {
      id: "icon-test-info-normalized",
      type: "text",
      x: infoX + 28,
      y: infoY + 112,
      width: 334,
      height: 24,
      text: zh ? `标准面积：${normalizedArea.toFixed(0)} / 10000` : `Normalized area: ${normalizedArea.toFixed(0)} / 10000`,
      fontSize: 13,
      fontWeight: 500,
      fill: "#5F615C",
      textAnchor: "start"
    },
    {
      id: "icon-test-info-rendered",
      type: "text",
      x: infoX + 28,
      y: infoY + 144,
      width: 334,
      height: 24,
      text: zh ? `渲染面积：约 ${renderedArea.toFixed(0)} px²` : `Rendered area: approx. ${renderedArea.toFixed(0)} px²`,
      fontSize: 13,
      fontWeight: 500,
      fill: "#5F615C",
      textAnchor: "start"
    },
    {
      id: "icon-test-bar-bg",
      type: "rect",
      x: infoX + 28,
      y: infoY + 176,
      width: 334,
      height: 12,
      rx: 6,
      fill: "#EFEEE9"
    },
    {
      id: "icon-test-bar-fill",
      type: "rect",
      x: infoX + 28,
      y: infoY + 176,
      width: Math.max(4, 334 * coverageRatio),
      height: 12,
      rx: 6,
      fill: "#C45F3C"
    }
  ];

  return {
    coverage,
    figure: {
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: "#FFFFFF" },
      metadata: {
        title,
        description,
        skillId: "freeform",
        language: locale
      },
      elements
    },
    fit: {
      score: 1,
      note: zh ? "本地测试图：未调用 AI。" : "Local test figure: AI was not called."
    }
  };
}

function buildIconElements(definition: IconDefinition, x: number, y: number, size: number): FigureElement[] {
  return definition.primitives.map((primitive, index) => {
    const id = `icon-test-${definition.id}-${index}`;
    const fill = "#C45F3C";
    const stroke = "#8E3C27";
    const strokeWidth = 2;

    if (primitive.type === "rect") {
      return {
        id,
        type: "rect",
        x: scale(primitive.x, x, size),
        y: scale(primitive.y, y, size),
        width: (primitive.width / ICON_VIEWBOX_SIZE) * size,
        height: (primitive.height / ICON_VIEWBOX_SIZE) * size,
        rx: primitive.rx ? (primitive.rx / ICON_VIEWBOX_SIZE) * size : undefined,
        fill,
        stroke,
        strokeWidth
      };
    }

    if (primitive.type === "ellipse") {
      return {
        id,
        type: "ellipse",
        cx: scale(primitive.cx, x, size),
        cy: scale(primitive.cy, y, size),
        rx: (primitive.rx / ICON_VIEWBOX_SIZE) * size,
        ry: (primitive.ry / ICON_VIEWBOX_SIZE) * size,
        fill,
        stroke,
        strokeWidth
      };
    }

    return {
      id,
      type: "polygon",
      points: primitive.points.map((point) => ({
        x: scale(point.x, x, size),
        y: scale(point.y, y, size)
      })),
      fill,
      stroke,
      strokeWidth
    };
  });
}

function estimateCoverageRatio(primitives: IconPrimitive[]): number {
  let covered = 0;
  const total = COVERAGE_SAMPLE_SIZE * COVERAGE_SAMPLE_SIZE;
  const cellSize = ICON_VIEWBOX_SIZE / COVERAGE_SAMPLE_SIZE;

  for (let row = 0; row < COVERAGE_SAMPLE_SIZE; row += 1) {
    const y = row * cellSize + cellSize / 2;
    for (let col = 0; col < COVERAGE_SAMPLE_SIZE; col += 1) {
      const x = col * cellSize + cellSize / 2;
      if (primitives.some((primitive) => containsPoint(primitive, x, y))) {
        covered += 1;
      }
    }
  }

  return covered / total;
}

function containsPoint(primitive: IconPrimitive, x: number, y: number): boolean {
  if (primitive.type === "rect") {
    return x >= primitive.x && x <= primitive.x + primitive.width && y >= primitive.y && y <= primitive.y + primitive.height;
  }

  if (primitive.type === "ellipse") {
    const nx = (x - primitive.cx) / primitive.rx;
    const ny = (y - primitive.cy) / primitive.ry;
    return nx * nx + ny * ny <= 1;
  }

  return isPointInPolygon(x, y, primitive.points);
}

function isPointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const pi = points[i];
    const pj = points[j];
    const intersects = pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function scale(value: number, offset: number, size: number): number {
  return offset + (value / ICON_VIEWBOX_SIZE) * size;
}
