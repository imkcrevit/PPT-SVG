// Self-contained layout functions for additional diagram types.
//
// Each function takes a SemanticDiagram and returns a complete geometric Figure,
// the same shape layoutDiagram() returns, consumed unchanged by svg.ts / pptx.ts.
//
// These are intentionally independent of layout-engine.ts so adding them cannot
// regress the existing flow / architecture layouts. Wire them in by adding early
// returns at the top of layoutDiagram() (see INTEGRATION notes in the plan).
//
// They use ONLY the existing render primitives: rect / text / line / arrow / connector / group.
// svg.ts wraps text inside an element's width and vertically centers it within
// the element's height, so we only need to size boxes large enough.

import type { Figure, FigureElement } from "@/lib/types";
import { SKILL_IDS, type SkillId } from "@/lib/types";
import type { SemanticDiagram, SemanticNode } from "@/lib/semantic-types";
import { DEFAULT_THEME, type DiagramTheme } from "@/lib/theme";
import { estimateLineCount, measureSvgText } from "@/lib/text-layout";

const W = 1280;
const H = 720;
const MARGIN = 48;
const TITLE_H = 56;
const TITLE_FONT = 15;
const DETAIL_FONT = 12;
const TITLE_LH = TITLE_FONT * 1.28;
const DETAIL_LH = DETAIL_FONT * 1.32;

let ACCENTS = DEFAULT_THEME.accents;
let TEXT = DEFAULT_THEME.text;
let SUBTEXT = DEFAULT_THEME.subtext;
let EDGE = DEFAULT_THEME.edge;
let FONT = DEFAULT_THEME.fontFamily;

function applyTheme(theme: DiagramTheme): void {
  ACCENTS = theme.accents;
  TEXT = theme.text;
  SUBTEXT = theme.subtext;
  EDGE = theme.edge;
  FONT = theme.fontFamily;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function accent(i: number) {
  return ACCENTS[i % ACCENTS.length];
}

function safeSkillId(type: string): SkillId {
  return (SKILL_IDS as readonly string[]).includes(type) ? (type as SkillId) : "freeform";
}

function topLevel(diagram: SemanticDiagram): SemanticNode[] {
  return diagram.nodes.filter((node) => !node.parent);
}

function childrenOf(diagram: SemanticDiagram, id: string): SemanticNode[] {
  return diagram.nodes.filter((node) => node.parent === id);
}

// Wrapped line count for a label rendered inside a text element of width `w`.
// Delegates to the shared measurement so box height matches the rendered wrap.
function estLines(text: string, w: number, fs: number): number {
  return estimateLineCount(text, w, fs);
}

function titleElement(diagram: SemanticDiagram): FigureElement {
  return {
    id: "figure-title-text",
    type: "text",
    name: "title",
    x: MARGIN,
    y: MARGIN - 8,
    width: W - MARGIN * 2,
    height: TITLE_H,
    text: diagram.title,
    fontSize: 30,
    fontWeight: 700,
    fill: TEXT,
    textAnchor: "middle"
  };
}

function frame(diagram: SemanticDiagram, elements: FigureElement[], canvasBg: string): Figure {
  return {
    canvas: { width: W, height: H, background: canvasBg, fontFamily: FONT },
    metadata: {
      title: diagram.title,
      description: diagram.description ?? diagram.title,
      skillId: safeSkillId(diagram.type),
      language: diagram.language
    },
    elements
  };
}

// A node card matching the engine's leaf style: rect + centered title (+ detail).
function card(
  idBase: string,
  label: string,
  detail: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  acc: { stroke: string; tint: string },
  opts: { dashed?: boolean; fill?: string; titleFont?: number } = {}
): FigureElement {
  const titleFont = opts.titleFont ?? TITLE_FONT;
  const titleLH = titleFont * 1.28;
  const titleLines = estLines(label, w, titleFont);
  const detailLines = detail ? estLines(detail, w, DETAIL_FONT) : 0;
  const titleH = titleLines * titleLH;
  const gap = detailLines ? 4 : 0;
  const detailH = detailLines * DETAIL_LH;
  const contentH = titleH + gap + detailH;
  const top = y + (h - contentH) / 2;

  const children: FigureElement[] = [
    {
      id: `${idBase}-rect`,
      type: "rect",
      name: label,
      x,
      y,
      width: w,
      height: h,
      rx: 12,
      fill: opts.fill ?? "#FFFFFF",
      stroke: acc.stroke,
      strokeWidth: 2,
      dash: opts.dashed === true
    },
    {
      id: `${idBase}-title`,
      type: "text",
      name: `${label} title`,
      x,
      y: top,
      width: w,
      height: titleH,
      text: label,
      fontSize: titleFont,
      fontWeight: 700,
      fill: TEXT,
      textAnchor: "middle"
    }
  ];

  if (detail && detailLines) {
    children.push({
      id: `${idBase}-detail`,
      type: "text",
      name: `${label} detail`,
      x,
      y: top + titleH + gap,
      width: w,
      height: detailH,
      text: detail,
      fontSize: DETAIL_FONT,
      fontWeight: 500,
      fill: SUBTEXT,
      textAnchor: "middle"
    });
  }

  return { id: `${idBase}-group`, type: "group", name: label, children };
}

// ============================================================ TIMELINE
export function layoutTimeline(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const items = topLevel(diagram);
  const elements: FigureElement[] = [titleElement(diagram)];
  if (items.length === 0) return frame(diagram, elements, canvasBg);

  const axisY = 380;
  const left = MARGIN + 40;
  const right = W - MARGIN - 40;
  const span = right - left;
  const n = items.length;
  const slot = span / n;

  // axis line + end arrow
  elements.push({ id: "timeline-axis", type: "line", name: "axis", x1: left, y1: axisY, x2: right - 14, y2: axisY, stroke: EDGE, strokeWidth: 3 });
  elements.push({ id: "timeline-axis-arrow", type: "arrow", name: "axis arrow", x1: right - 14, y1: axisY, x2: right, y2: axisY, stroke: EDGE, strokeWidth: 3 });

  items.forEach((node, i) => {
    const cx = left + slot * (i + 0.5);
    const acc = accent(i);
    const above = i % 2 === 0;

    const cardW = clamp(measureSvgText(node.label, 16) + 28, 120, 220);
    const titleLines = estLines(node.label, cardW, 16);
    const detailLines = node.detail ? estLines(node.detail, cardW, DETAIL_FONT) : 0;
    const cardH = titleLines * (16 * 1.28) + (detailLines ? 4 + detailLines * DETAIL_LH : 0) + 22;

    const tick = 34;
    const cardY = above ? axisY - tick - cardH : axisY + tick;
    const cardX = clamp(cx - cardW / 2, MARGIN, W - MARGIN - cardW);

    // connector tick from axis to card
    elements.push({
      id: `timeline-tick-${i}`,
      type: "line",
      name: `tick ${i}`,
      x1: cx,
      y1: axisY,
      x2: cx,
      y2: above ? cardY + cardH : cardY,
      stroke: acc.stroke,
      strokeWidth: 2
    });
    // dot on the axis
    elements.push({ id: `timeline-dot-${i}`, type: "rect", name: `dot ${i}`, x: cx - 7, y: axisY - 7, width: 14, height: 14, rx: 7, fill: acc.stroke, stroke: acc.stroke, strokeWidth: 1 });
    // card
    elements.push(card(`timeline-${i}`, node.label, node.detail, cardX, cardY, cardW, cardH, acc, { titleFont: 16, fill: acc.tint, dashed: node.dashed === true }));
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ PYRAMID
export function layoutPyramid(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const tiers = topLevel(diagram);
  const elements: FigureElement[] = [titleElement(diagram)];
  if (tiers.length === 0) return frame(diagram, elements, canvasBg);

  const n = tiers.length;
  const top = MARGIN + TITLE_H + 24;
  const bottom = H - MARGIN;
  const availH = bottom - top;
  const gap = 12;
  const tierH = clamp((availH - gap * (n - 1)) / n, 44, 110);
  const totalH = tierH * n + gap * (n - 1);
  const startY = top + (availH - totalH) / 2;

  const topW = 320;
  const botW = 920;

  tiers.forEach((node, i) => {
    const w = n === 1 ? botW : topW + ((botW - topW) * i) / (n - 1);
    const x = W / 2 - w / 2;
    const y = startY + i * (tierH + gap);
    const acc = accent(i);
    elements.push(
      card(`pyramid-${i}`, node.label, node.detail, x, y, w, tierH, acc, {
        fill: acc.tint,
        dashed: node.dashed === true,
        titleFont: clamp(Math.round(tierH * 0.3), 13, 20)
      })
    );
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ MATRIX (2x2 / NxM)
export function layoutMatrix(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const tops = topLevel(diagram);
  // If a single top-level container holds the cells, use its children.
  let cells: SemanticNode[];
  if (tops.length === 1 && childrenOf(diagram, tops[0].id).length >= 2) {
    cells = childrenOf(diagram, tops[0].id);
  } else {
    cells = tops;
  }
  const elements: FigureElement[] = [titleElement(diagram)];
  if (cells.length === 0) return frame(diagram, elements, canvasBg);

  const cols = cells.length <= 4 ? 2 : Math.ceil(Math.sqrt(cells.length));
  const rows = Math.ceil(cells.length / cols);

  const gridW = 760;
  const gridH = 460;
  const originX = W / 2 - gridW / 2;
  const originY = MARGIN + TITLE_H + 40;
  const cellW = gridW / cols;
  const cellH = gridH / rows;

  // axis cross (for 2x2) or grid lines
  elements.push({ id: "matrix-axis-v", type: "line", name: "axis v", x1: originX + gridW / 2, y1: originY - 16, x2: originX + gridW / 2, y2: originY + gridH + 16, stroke: EDGE, strokeWidth: 2 });
  elements.push({ id: "matrix-axis-h", type: "line", name: "axis h", x1: originX - 16, y1: originY + gridH / 2, x2: originX + gridW + 16, y2: originY + gridH / 2, stroke: EDGE, strokeWidth: 2 });

  // optional axis labels from diagram.axes
  const axes = (diagram as { axes?: { xLabel?: string; yLabel?: string } }).axes;
  if (axes?.xLabel) {
    elements.push({ id: "matrix-xlabel", type: "text", name: "x label", x: originX, y: originY + gridH + 22, width: gridW, height: 20, text: axes.xLabel, fontSize: 12, fontWeight: 700, fill: SUBTEXT, textAnchor: "middle" });
  }
  if (axes?.yLabel) {
    elements.push({ id: "matrix-ylabel", type: "text", name: "y label", x: originX - 40, y: originY - 26, width: 200, height: 20, text: axes.yLabel, fontSize: 12, fontWeight: 700, fill: SUBTEXT, textAnchor: "start" });
  }

  cells.forEach((node, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inset = 10;
    const x = originX + c * cellW + inset;
    const y = originY + r * cellH + inset;
    const w = cellW - inset * 2;
    const h = cellH - inset * 2;
    const acc = accent(i);
    elements.push(card(`matrix-${i}`, node.label, node.detail, x, y, w, h, acc, { fill: acc.tint, dashed: node.dashed === true, titleFont: 15 }));
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ HIERARCHY / ORG TREE
interface TreePos {
  node: SemanticNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

export function layoutHierarchy(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const elements: FigureElement[] = [titleElement(diagram)];
  const roots = topLevel(diagram);
  if (roots.length === 0) return frame(diagram, elements, canvasBg);

  const nodeW = 156;
  const nodeH = 54;
  const hGap = 26;
  const vGap = 64;
  const positions: TreePos[] = [];
  const edges: Array<{ from: string; to: string }> = [];

  // recursive tidy placement; returns subtree width
  const place = (node: SemanticNode, depth: number, leftX: number): number => {
    const kids = childrenOf(diagram, node.id);
    const y = depth * (nodeH + vGap);
    let myX: number;
    let width: number;
    if (kids.length === 0) {
      myX = leftX;
      width = nodeW;
    } else {
      let cursor = leftX;
      for (const kid of kids) {
        const cw = place(kid, depth + 1, cursor);
        cursor += cw + hGap;
        edges.push({ from: node.id, to: kid.id });
      }
      const childrenWidth = cursor - hGap - leftX;
      myX = leftX + (childrenWidth - nodeW) / 2;
      width = Math.max(childrenWidth, nodeW);
    }
    positions.push({ node, x: myX, y, w: nodeW, h: nodeH, depth });
    return width;
  };

  let cursorX = 0;
  for (const root of roots) {
    const w = place(root, 0, cursorX);
    cursorX += w + hGap * 2;
  }

  // bounding box -> scale & center into canvas
  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x + p.w));
  const minY = Math.min(...positions.map((p) => p.y));
  const maxY = Math.max(...positions.map((p) => p.y + p.h));
  const treeW = maxX - minX;
  const treeH = maxY - minY;
  const areaTop = MARGIN + TITLE_H + 20;
  const areaH = H - areaTop - MARGIN;
  const areaW = W - MARGIN * 2;
  const scale = Math.min(1, areaW / treeW, areaH / treeH);
  const offX = (W - treeW * scale) / 2 - minX * scale;
  const offY = areaTop + (areaH - treeH * scale) / 2 - minY * scale;
  const tx = (v: number) => offX + v * scale;
  const ty = (v: number) => offY + v * scale;

  const posById = new Map(positions.map((p) => [p.node.id, p]));
  const depthAccent = new Map<string, number>();
  positions.forEach((p) => depthAccent.set(p.node.id, p.depth));

  // connectors (parent bottom -> child top, orthogonal)
  edges.forEach((e, i) => {
    const a = posById.get(e.from)!;
    const b = posById.get(e.to)!;
    const ax = tx(a.x + a.w / 2);
    const ay = ty(a.y + a.h);
    const bx = tx(b.x + b.w / 2);
    const by = ty(b.y);
    const midY = (ay + by) / 2;
    elements.push({
      id: `htree-e${i}`,
      type: "connector",
      name: e.from + "->" + e.to,
      points: [
        { x: ax, y: ay },
        { x: ax, y: midY },
        { x: bx, y: midY },
        { x: bx, y: by }
      ],
      stroke: EDGE,
      strokeWidth: 2
    });
  });

  positions.forEach((p, i) => {
    const acc = accent(p.depth);
    elements.push(card(`htree-${i}`, p.node.label, p.node.detail, tx(p.x), ty(p.y), p.w * scale, p.h * scale, acc, { fill: p.depth === 0 ? acc.tint : "#FFFFFF", dashed: p.node.dashed === true, titleFont: clamp(Math.round(14 * scale + 1), 11, 15) }));
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ CYCLE
export function layoutCycle(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const items = topLevel(diagram);
  const elements: FigureElement[] = [titleElement(diagram)];
  const n = items.length;
  if (n === 0) return frame(diagram, elements, canvasBg);

  const cx = W / 2;
  const cy = MARGIN + TITLE_H + (H - MARGIN - (MARGIN + TITLE_H)) / 2 + 6;
  const R = Math.min(220, (H - MARGIN - TITLE_H - 160) / 2 + 60);
  const nodeW = 150;
  const nodeH = 60;

  const centers = items.map((_, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  // arrows between consecutive (wrap), drawn first so cards sit on top
  for (let i = 0; i < n; i += 1) {
    const a = centers[i];
    const b = centers[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // start/end offset so arrows touch box edges, not centers
    const pad = 78;
    const x1 = a.x + ux * pad;
    const y1 = a.y + uy * pad;
    const x2 = b.x - ux * pad;
    const y2 = b.y - uy * pad;
    elements.push({ id: `cycle-arrow-${i}`, type: "arrow", name: `arrow ${i}`, x1, y1, x2, y2, stroke: EDGE, strokeWidth: 2 });
  }

  items.forEach((node, i) => {
    const c = centers[i];
    const acc = accent(i);
    elements.push(card(`cycle-${i}`, node.label, node.detail, c.x - nodeW / 2, c.y - nodeH / 2, nodeW, nodeH, acc, { fill: acc.tint, dashed: node.dashed === true }));
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ FUNNEL (true trapezoids; needs polygon)
export function layoutFunnel(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const stages = topLevel(diagram);
  const elements: FigureElement[] = [titleElement(diagram)];
  const n = stages.length;
  if (n === 0) return frame(diagram, elements, canvasBg);

  const top = MARGIN + TITLE_H + 24;
  const bottom = H - MARGIN;
  const availH = bottom - top;
  const gap = 8;
  const stageH = clamp((availH - gap * (n - 1)) / n, 46, 110);
  const totalH = stageH * n + gap * (n - 1);
  const startY = top + (availH - totalH) / 2;
  const wMax = 880;
  const wMin = 240;
  const lerp = (t: number) => wMax + (wMin - wMax) * t;

  stages.forEach((node, i) => {
    const wTop = lerp(n === 1 ? 0 : i / n);
    const wBot = lerp(n === 1 ? 1 : (i + 1) / n);
    const y = startY + i * (stageH + gap);
    const acc = accent(i);
    const cx = W / 2;
    elements.push({
      id: `funnel-${i}-poly`,
      type: "polygon",
      name: node.label,
      points: [
        { x: cx - wTop / 2, y },
        { x: cx + wTop / 2, y },
        { x: cx + wBot / 2, y: y + stageH },
        { x: cx - wBot / 2, y: y + stageH }
      ],
      fill: acc.tint,
      stroke: acc.stroke,
      strokeWidth: 2,
      dash: node.dashed === true
    });
    elements.push({
      id: `funnel-${i}-title`,
      type: "text",
      name: `${node.label} title`,
      x: cx - wBot / 2,
      y: y + stageH / 2 - 10,
      width: wBot,
      height: 22,
      text: node.label,
      fontSize: clamp(Math.round(stageH * 0.28), 13, 19),
      fontWeight: 700,
      fill: TEXT,
      textAnchor: "middle"
    });
    if (node.detail) {
      elements.push({
        id: `funnel-${i}-detail`,
        type: "text",
        name: `${node.label} detail`,
        x: cx - wBot / 2,
        y: y + stageH / 2 + 8,
        width: wBot,
        height: 16,
        text: node.detail,
        fontSize: DETAIL_FONT,
        fontWeight: 500,
        fill: SUBTEXT,
        textAnchor: "middle"
      });
    }
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ VENN (2-3 sets; needs ellipse)
export function layoutVenn(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const sets = topLevel(diagram).slice(0, 3);
  const elements: FigureElement[] = [titleElement(diagram)];
  if (sets.length === 0) return frame(diagram, elements, canvasBg);

  const cx = W / 2;
  const cy = MARGIN + TITLE_H + 320;
  const r = 175;

  const layouts =
    sets.length <= 2
      ? [
          { x: cx - r * 0.55, y: cy, lx: cx - r * 1.05, ly: cy },
          { x: cx + r * 0.55, y: cy, lx: cx + r * 1.05, ly: cy }
        ]
      : [
          { x: cx, y: cy - r * 0.6, lx: cx, ly: cy - r * 1.25 },
          { x: cx - r * 0.62, y: cy + r * 0.5, lx: cx - r * 1.15, ly: cy + r * 0.95 },
          { x: cx + r * 0.62, y: cy + r * 0.5, lx: cx + r * 1.15, ly: cy + r * 0.95 }
        ];

  sets.forEach((node, i) => {
    const acc = accent(i);
    const L = layouts[i];
    elements.push({ id: `venn-${i}`, type: "ellipse", name: node.label, cx: L.x, cy: L.y, rx: r, ry: r, fill: acc.stroke, stroke: acc.stroke, strokeWidth: 2, opacity: 0.22 });
  });
  sets.forEach((node, i) => {
    const L = layouts[i];
    elements.push({ id: `venn-${i}-label`, type: "text", name: `${node.label} label`, x: L.lx - 110, y: L.ly - 12, width: 220, height: 24, text: node.label, fontSize: 16, fontWeight: 700, fill: TEXT, textAnchor: "middle" });
    if (node.detail) {
      elements.push({ id: `venn-${i}-detail`, type: "text", name: `${node.label} detail`, x: L.lx - 110, y: L.ly + 12, width: 220, height: 18, text: node.detail, fontSize: DETAIL_FONT, fontWeight: 500, fill: SUBTEXT, textAnchor: "middle" });
    }
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ MINDMAP (balanced left/right)
export function layoutMindmap(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const elements: FigureElement[] = [titleElement(diagram)];
  const roots = topLevel(diagram);
  if (roots.length === 0) return frame(diagram, elements, canvasBg);

  const center = roots[0];
  const branches = childrenOf(diagram, center.id);
  const cx = W / 2;
  const areaTop = MARGIN + TITLE_H + 30;
  const areaBot = H - MARGIN - 30;
  const cy = (areaTop + areaBot) / 2;

  const right = branches.filter((_, i) => i % 2 === 0);
  const left = branches.filter((_, i) => i % 2 === 1);

  const placeSide = (list: SemanticNode[], side: 1 | -1) => {
    const n = list.length;
    list.forEach((br, k) => {
      const idx = branches.indexOf(br);
      const acc = accent(idx);
      const by = n === 1 ? cy : areaTop + 26 + ((areaBot - areaTop - 52) * k) / (n - 1);
      const bw = 160;
      const bx = cx + side * 215 - (side === 1 ? 0 : bw);
      const bcx = bx + bw / 2;
      // center -> branch connector
      elements.push({ id: `mind-l-${idx}`, type: "line", name: "branch", x1: cx + side * 92, y1: cy, x2: side === 1 ? bx : bx + bw, y2: by + 26, stroke: acc.stroke, strokeWidth: 2 });
      // leaves further out, stacked around branch y
      const leaves = childrenOf(diagram, br.id);
      const nl = leaves.length;
      leaves.forEach((leaf, j) => {
        const lw = 138;
        const ly = by + 26 + (nl === 1 ? 0 : (j - (nl - 1) / 2) * 50);
        const lx = side === 1 ? bx + bw + 60 : bx - 60 - lw;
        elements.push({ id: `mind-ll-${idx}-${j}`, type: "line", name: "leaf", x1: side === 1 ? bx + bw : bx, y1: by + 26, x2: side === 1 ? lx : lx + lw, y2: ly, stroke: acc.stroke, strokeWidth: 1.5 });
        elements.push(card(`mind-leaf-${idx}-${j}`, leaf.label, undefined, lx, ly - 19, lw, 38, acc, { titleFont: 12 }));
      });
      elements.push(card(`mind-br-${idx}`, br.label, br.detail, bx, by, bw, 52, acc, { fill: acc.tint }));
    });
  };

  placeSide(right, 1);
  placeSide(left, -1);

  elements.push({ id: "mind-center", type: "ellipse", name: center.label, cx, cy, rx: 92, ry: 54, fill: TEXT, stroke: TEXT, strokeWidth: 2 });
  elements.push({ id: "mind-center-label", type: "text", name: "center label", x: cx - 90, y: cy - 12, width: 180, height: 24, text: center.label, fontSize: 16, fontWeight: 700, fill: "#FFFFFF", textAnchor: "middle" });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ FISHBONE (cause-effect)
export function layoutFishbone(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const elements: FigureElement[] = [titleElement(diagram)];
  const tops = topLevel(diagram);
  if (tops.length === 0) return frame(diagram, elements, canvasBg);

  // last top-level node = effect (head); the rest = cause categories
  const head = tops[tops.length - 1];
  const cats = tops.slice(0, -1).length ? tops.slice(0, -1) : tops;

  const spineY = MARGIN + TITLE_H + (H - MARGIN - TITLE_H - MARGIN) / 2;
  const spineLeft = MARGIN + 30;
  const headX = W - MARGIN - 180;
  // spine
  elements.push({ id: "fish-spine", type: "line", name: "spine", x1: spineLeft, y1: spineY, x2: headX - 6, y2: spineY, stroke: EDGE, strokeWidth: 3 });
  elements.push({ id: "fish-spine-arrow", type: "arrow", name: "spine arrow", x1: headX - 6, y1: spineY, x2: headX, y2: spineY, stroke: EDGE, strokeWidth: 3 });
  // head (effect)
  elements.push(card("fish-head", head.label, head.detail, headX, spineY - 40, 168, 80, accent(7), { fill: accent(7).tint, titleFont: 15 }));

  const usable = headX - spineLeft - 60;
  const per = usable / Math.max(cats.length, 1);
  cats.forEach((cat, i) => {
    const above = i % 2 === 0;
    const baseX = spineLeft + 60 + per * (i + 0.5);
    const boneEndX = baseX - 70;
    const boneEndY = above ? spineY - 150 : spineY + 150;
    const acc = accent(i);
    // diagonal bone
    elements.push({ id: `fish-bone-${i}`, type: "line", name: cat.label, x1: baseX, y1: spineY, x2: boneEndX, y2: boneEndY, stroke: acc.stroke, strokeWidth: 2 });
    // category box at bone end
    elements.push(card(`fish-cat-${i}`, cat.label, undefined, boneEndX - 75, boneEndY - (above ? 46 : 0), 150, 46, acc, { fill: acc.tint, titleFont: 13 }));
    // sub-causes as small labels along the bone
    const subs = childrenOf(diagram, cat.id);
    subs.slice(0, 3).forEach((sub, j) => {
      const t = (j + 1) / (subs.slice(0, 3).length + 1);
      const sx = baseX + (boneEndX - baseX) * t;
      const sy = spineY + (boneEndY - spineY) * t;
      elements.push({ id: `fish-sub-${i}-${j}`, type: "text", name: sub.label, x: sx - 60, y: sy - 8, width: 120, height: 16, text: sub.label, fontSize: 11, fontWeight: 500, fill: SUBTEXT, textAnchor: above ? "start" : "start" });
    });
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ GANTT (needs node.start / node.end)
type GanttNode = { start?: string | number; end?: string | number };
interface GanttRange {
  start: number;
  end: number;
}

function readGanttNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return undefined;
}

function parseGanttRangeText(value: string): GanttRange | undefined {
  const normalized = value.replace(/\s+/g, "");
  const rangePatterns = [
    /第?(\d+(?:\.\d+)?)(?:周|週|天|日|月)?(?:-|–|—|~|至|到)第?(\d+(?:\.\d+)?)(?:周|週|天|日|月)?/i,
    /(?:week|wk|w)(\d+(?:\.\d+)?)(?:-|–|—|~|to)(?:week|wk|w)?(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)(?:-|–|—|~|to)(\d+(?:\.\d+)?)(?:周|週|天|日|月|week|wk|w)/i
  ];

  for (const pattern of rangePatterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const a = Number(match[1]);
    const b = Number(match[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
  }

  const single = normalized.match(/第?(\d+(?:\.\d+)?)(?:周|週|天|日|月)|(?:week|wk|w)(\d+(?:\.\d+)?)/i);
  const singleValue = single ? Number(single[1] ?? single[2]) : NaN;
  if (Number.isFinite(singleValue)) {
    return { start: singleValue, end: singleValue + 1 };
  }

  return undefined;
}

function rangeFromTask(node: SemanticNode, fallbackStart: number): GanttRange {
  const typed = node as unknown as GanttNode;
  const explicitStart = readGanttNumber(typed.start);
  const explicitEnd = readGanttNumber(typed.end);

  if (explicitStart !== undefined && explicitEnd !== undefined && explicitStart !== explicitEnd) {
    return { start: Math.min(explicitStart, explicitEnd), end: Math.max(explicitStart, explicitEnd) };
  }

  if (explicitStart !== undefined) {
    return { start: explicitStart, end: explicitStart + 1 };
  }

  const parsed = parseGanttRangeText([node.label, node.detail].filter(Boolean).join(" "));
  if (parsed) {
    return parsed;
  }

  return { start: fallbackStart, end: fallbackStart + 1 };
}

function baselineRange(diagram: SemanticDiagram): GanttRange | undefined {
  return parseGanttRangeText([diagram.title, diagram.description].filter(Boolean).join(" "));
}

function formatGanttTick(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function ganttTicks(minT: number, maxT: number): number[] {
  const range = Math.max(1, maxT - minT);
  const integerRange = Number.isInteger(minT) && Number.isInteger(maxT);

  if (integerRange && range <= 10) {
    return Array.from({ length: range + 1 }, (_, index) => minT + index);
  }

  const tickCount = 5;
  return Array.from({ length: tickCount + 1 }, (_, index) => minT + (range * index) / tickCount);
}

function durationLabel(range: GanttRange): string {
  return `${formatGanttTick(range.start)}-${formatGanttTick(range.end)}`;
}

function textFits(value: string, width: number, fontSize: number, padding = 14): boolean {
  return measureSvgText(value, fontSize) + padding <= width;
}

export function layoutGantt(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const tasks = topLevel(diagram);
  const elements: FigureElement[] = [titleElement(diagram)];
  if (tasks.length === 0) return frame(diagram, elements, canvasBg);

  const ranges = tasks.map((task, index) => rangeFromTask(task, index));
  const baseline = baselineRange(diagram);
  const minT = baseline ? Math.min(baseline.start, ...ranges.map((range) => range.start)) : Math.min(...ranges.map((range) => range.start));
  const maxT = baseline ? Math.max(baseline.end, ...ranges.map((range) => range.end)) : Math.max(...ranges.map((range) => range.end));
  const range = maxT - minT || 1;

  const labelW = 200;
  const left = MARGIN + labelW;
  const right = W - MARGIN;
  const spanX = right - left;
  const top = MARGIN + TITLE_H + 36;
  const rowH = clamp((H - MARGIN - top) / tasks.length, 30, 58);
  const mapX = (t: number) => left + ((t - minT) / range) * spanX;

  // time gridlines + tick labels
  const ticks = ganttTicks(minT, maxT);
  ticks.forEach((tv, k) => {
    const x = mapX(tv);
    elements.push({ id: `gantt-grid-${k}`, type: "line", name: "grid", x1: x, y1: top - 12, x2: x, y2: top + rowH * tasks.length, stroke: "#E3E7EE", strokeWidth: 1 });
    elements.push({ id: `gantt-tick-${k}`, type: "text", name: "tick", x: x - 30, y: top - 30, width: 60, height: 16, text: formatGanttTick(tv), fontSize: 10, fontWeight: 500, fill: SUBTEXT, textAnchor: "middle" });
  });

  tasks.forEach((t, i) => {
    const y = top + i * rowH;
    const acc = accent(i);
    // task name (left column)
    elements.push({ id: `gantt-name-${i}`, type: "text", name: `${t.label} name`, x: MARGIN, y: y + rowH / 2 - 10, width: labelW - 12, height: 20, text: t.label, fontSize: 13, fontWeight: 700, fill: TEXT, textAnchor: "start" });
    // bar
    const taskRange = ranges[i];
    const bx = mapX(taskRange.start);
    const bw = Math.max(mapX(taskRange.end) - bx, 14);
    const bh = Math.min(rowH - 14, 30);
    elements.push({ id: `gantt-bar-${i}`, type: "rect", name: t.label, x: bx, y: y + (rowH - bh) / 2, width: bw, height: bh, rx: 6, fill: acc.tint, stroke: acc.stroke, strokeWidth: 2, dash: t.dashed === true });
    const barText = durationLabel(taskRange);
    if (bw >= 42 && textFits(barText, bw, 10)) {
      elements.push({ id: `gantt-bar-range-${i}`, type: "text", name: `${t.label} range`, x: bx, y: y + rowH / 2 - 8, width: bw, height: 16, text: barText, fontSize: 10, fontWeight: 600, fill: TEXT, textAnchor: "middle" });
    }
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ SWIMLANE (needs node.lane / diagram.lanes)
type LaneNode = { lane?: string };
type LaneDiagram = { lanes?: string[] };
export function layoutSwimlane(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const nodes = topLevel(diagram);
  const elements: FigureElement[] = [titleElement(diagram)];
  if (nodes.length === 0) return frame(diagram, elements, canvasBg);

  let lanes = (diagram as unknown as LaneDiagram).lanes;
  if (!lanes || lanes.length === 0) {
    lanes = [];
    for (const n of nodes) {
      const l = (n as unknown as LaneNode).lane ?? "流程";
      if (!lanes.includes(l)) lanes.push(l);
    }
  }
  const laneOf = (n: SemanticNode) => Math.max(0, lanes!.indexOf((n as unknown as LaneNode).lane ?? lanes![0]));

  const labelW = 132;
  const left = MARGIN + labelW;
  const right = W - MARGIN;
  const top = MARGIN + TITLE_H + 20;
  const laneH = (H - MARGIN - top) / lanes.length;
  const colW = (right - left) / Math.max(nodes.length, 1);
  const cardW = Math.min(colW - 18, 172);
  const cardH = Math.min(laneH - 24, 60);

  // lane backgrounds + names
  lanes.forEach((lane, r) => {
    const acc = accent(r);
    elements.push({ id: `lane-bg-${r}`, type: "rect", name: lane, x: MARGIN, y: top + r * laneH, width: W - MARGIN * 2, height: laneH - 6, rx: 10, fill: acc.tint, stroke: "none", strokeWidth: 0 });
    elements.push({ id: `lane-name-${r}`, type: "text", name: `${lane} label`, x: MARGIN + 10, y: top + r * laneH + laneH / 2 - 12, width: labelW - 16, height: 24, text: lane, fontSize: 13, fontWeight: 700, fill: acc.stroke, textAnchor: "start" });
  });

  const pos = new Map<string, { cx: number; cy: number }>();
  nodes.forEach((n, i) => {
    const r = laneOf(n);
    const acc = accent(r);
    const cx = left + colW * (i + 0.5);
    const cy = top + r * laneH + laneH / 2;
    pos.set(n.id, { cx, cy });
    elements.push(card(`lane-node-${i}`, n.label, n.detail, cx - cardW / 2, cy - cardH / 2, cardW, cardH, acc, { dashed: n.dashed === true, titleFont: 13 }));
  });

  // edges (or sequential)
  const edges = diagram.edges?.length ? diagram.edges : nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, dashed: false }));
  edges.forEach((e, i) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return;
    const x1 = a.cx + cardW / 2;
    const x2 = b.cx - cardW / 2;
    const midX = (a.cx + b.cx) / 2;
    elements.push({
      id: `lane-e${i}`,
      type: "connector",
      name: "edge",
      points: [
        { x: x1, y: a.cy },
        { x: midX, y: a.cy },
        { x: midX, y: b.cy },
        { x: x2, y: b.cy }
      ],
      stroke: EDGE,
      strokeWidth: 2,
      dash: e.dashed === true,
      endArrow: true
    });
  });

  return frame(diagram, elements, canvasBg);
}

// ============================================================ SCATTER / 2D positioning (needs node.score {x,y})
type ScoreNode = { score?: { x: number; y: number } };
type AxesDiagram = { axes?: { xLabel?: string; yLabel?: string } };
export function layoutScatter(diagram: SemanticDiagram, theme: DiagramTheme = DEFAULT_THEME, canvasBg = theme.background): Figure {
  applyTheme(theme);
  const pts = topLevel(diagram);
  const elements: FigureElement[] = [titleElement(diagram)];
  if (pts.length === 0) return frame(diagram, elements, canvasBg);

  const left = MARGIN + 70;
  const right = W - MARGIN - 30;
  const top = MARGIN + TITLE_H + 30;
  const bottom = H - MARGIN - 46;
  // Robust to whatever numeric scale the model emits (0..1, 0..100, etc.):
  // keep absolute positions when data is already within 0..1, otherwise rescale
  // by the data's own min/max so points never collapse onto one spot.
  const raw = pts.map((n) => (n as unknown as ScoreNode).score ?? { x: 0.5, y: 0.5 });
  const axisMap = (vals: number[]) => {
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    if (mn >= 0 && mx <= 1) return (v: number) => clamp(v, 0, 1);
    if (mx === mn) return () => 0.5;
    return (v: number) => 0.06 + 0.88 * ((clamp(v, mn, mx) - mn) / (mx - mn));
  };
  const nx = axisMap(raw.map((p) => p.x));
  const ny = axisMap(raw.map((p) => p.y));
  const mapX = (v: number) => left + nx(v) * (right - left);
  const mapY = (v: number) => bottom - ny(v) * (bottom - top);

  // plot frame + quadrant guides
  elements.push({ id: "scatter-frame", type: "rect", name: "frame", x: left, y: top, width: right - left, height: bottom - top, rx: 4, fill: "#FFFFFF", stroke: "#C9CFDA", strokeWidth: 1.5 });
  elements.push({ id: "scatter-qv", type: "line", name: "q v", x1: (left + right) / 2, y1: top, x2: (left + right) / 2, y2: bottom, stroke: "#E3E7EE", strokeWidth: 1 });
  elements.push({ id: "scatter-qh", type: "line", name: "q h", x1: left, y1: (top + bottom) / 2, x2: right, y2: (top + bottom) / 2, stroke: "#E3E7EE", strokeWidth: 1 });

  const axes = (diagram as unknown as AxesDiagram).axes;
  if (axes?.xLabel) elements.push({ id: "scatter-xlabel", type: "text", name: "x", x: left, y: bottom + 16, width: right - left, height: 18, text: axes.xLabel, fontSize: 12, fontWeight: 700, fill: SUBTEXT, textAnchor: "middle" });
  if (axes?.yLabel) elements.push({ id: "scatter-ylabel", type: "text", name: "y", x: MARGIN - 6, y: top - 24, width: 220, height: 18, text: axes.yLabel, fontSize: 12, fontWeight: 700, fill: SUBTEXT, textAnchor: "start" });

  pts.forEach((n, i) => {
    const s = (n as unknown as ScoreNode).score ?? { x: 0.5, y: 0.5 };
    const x = mapX(s.x);
    const y = mapY(s.y);
    const acc = accent(i);
    elements.push({ id: `scatter-dot-${i}`, type: "ellipse", name: n.label, cx: x, cy: y, rx: 9, ry: 9, fill: acc.stroke, stroke: acc.stroke, strokeWidth: 1 });
    elements.push({ id: `scatter-label-${i}`, type: "text", name: `${n.label} label`, x: x - 80, y: y - 28, width: 160, height: 18, text: n.label, fontSize: 12, fontWeight: 700, fill: TEXT, textAnchor: "middle" });
  });

  return frame(diagram, elements, canvasBg);
}
