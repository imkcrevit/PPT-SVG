import type { Figure, FigureElement } from "@/lib/types";
import type { SemanticDiagram, SemanticNode } from "@/lib/semantic-types";
import { DEFAULT_THEME, resolveTheme, type DiagramTheme } from "@/lib/theme";
import { estimateLineCount, measureSvgText } from "@/lib/text-layout";
import {
  layoutCycle,
  layoutFishbone,
  layoutFunnel,
  layoutGantt,
  layoutHeatmap,
  layoutHierarchy,
  layoutKanban,
  layoutMatrix,
  layoutMindmap,
  layoutNetwork,
  layoutPyramid,
  layoutRadar,
  layoutScatter,
  layoutSwimlane,
  layoutTimeline,
  layoutVenn,
  layoutWaterfall
} from "@/lib/layout-extra";

// Deterministic semantic-to-geometry compiler.
//
// Input : nodes with `parent` + optional detail/dashed and edges with from/to.
// Output: the existing geometric Figure consumed by SVG/PPTX renderers.
//
// This keeps containment as data instead of fragile coordinate math: child boxes
// are placed inside parent boxes, and edges resolve node ids to anchors.

const PAD = 18;
const HEADER_H = 34;
const GAP = 22;
const LAYER_GAP = 60;
// A horizontal flow is normally a chain with few roots. Beyond this many
// parallel roots, wrap them into balanced rows instead of one cramped row.
const FLOW_ROW_MAX = 5;
// A long connected chain snakes (boustrophedon) into rows of this width so it
// fills the canvas vertically. Chains at or below FLOW_SNAKE_MAX keep one row.
const FLOW_SNAKE_MAX = 6;
const FLOW_SNAKE_COLS = 4;
// Upscale cap for wrapped flows so they fill the canvas without ballooning text.
const FLOW_FILL_MAX = 1.5;
const MIN_W = 110;
const MAX_W = 320;
const CANVAS_MARGIN = 48;
// Top reserve below the title band. Sized so a title at y=74 (matching the deck
// template's content-page title) never overlaps the diagram body.
const TITLE_H = 112;

const TITLE_FONT = 15;
const DETAIL_FONT = 12;
const TITLE_LH = TITLE_FONT * 1.28;
const DETAIL_LH = DETAIL_FONT * 1.32;
const BOX_PAD_Y = 12;
const BOX_PAD_X = 16;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Pt {
  x: number;
  y: number;
}

interface LayoutNode {
  node: SemanticNode;
  children: LayoutNode[];
  box: Box;
  rows: LayoutNode[][];
  depth: number;
  rootId: string;
  titleLines: number;
  detailLines: number;
}

let ACCENTS = DEFAULT_THEME.accents;
let TEXT = DEFAULT_THEME.text;
let SUBTEXT = DEFAULT_THEME.subtext;
let EDGE = DEFAULT_THEME.edge;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function measureLeaf(layoutNode: LayoutNode): void {
  const title = layoutNode.node.label ?? "";
  const detail = layoutNode.node.detail ?? "";
  const titleWidth = measureSvgText(title, TITLE_FONT);
  const detailWidth = measureSvgText(detail, DETAIL_FONT);
  const width = clamp(Math.max(titleWidth, detailWidth) * 1.12 + BOX_PAD_X * 2, MIN_W, MAX_W);
  // Count lines with the same width/measurement the renderer uses (the text
  // element receives the full box width), so provisioned height matches the
  // rendered wrap exactly and text neither overflows nor mis-centers.
  const titleLines = estimateLineCount(title, width, TITLE_FONT);
  const detailLines = detail ? estimateLineCount(detail, width, DETAIL_FONT) : 0;
  const contentHeight = titleLines * TITLE_LH + (detailLines ? 4 + detailLines * DETAIL_LH : 0);

  layoutNode.titleLines = titleLines;
  layoutNode.detailLines = detailLines;
  layoutNode.box.width = Math.round(width);
  layoutNode.box.height = Math.round(Math.max(52, contentHeight + BOX_PAD_Y * 2));
}

function chooseCols(count: number): number {
  if (count <= 1) {
    return 1;
  }

  if (count <= 2) {
    return 2;
  }

  if (count <= 6) {
    return 3;
  }

  if (count <= 12) {
    return 4;
  }

  return 5;
}

function buildTree(diagram: SemanticDiagram): LayoutNode[] {
  const byId = new Map<string, LayoutNode>();

  for (const node of diagram.nodes) {
    byId.set(node.id, {
      node,
      children: [],
      box: { x: 0, y: 0, width: 0, height: 0 },
      rows: [],
      depth: 0,
      rootId: node.id,
      titleLines: 1,
      detailLines: 0
    });
  }

  const roots: LayoutNode[] = [];
  for (const layoutNode of byId.values()) {
    const parent = layoutNode.node.parent;

    if (parent && byId.has(parent)) {
      byId.get(parent)?.children.push(layoutNode);
    } else {
      roots.push(layoutNode);
    }
  }

  for (const root of roots) {
    tagTree(root, 0, root.node.id);
  }

  return roots;
}

function tagTree(layoutNode: LayoutNode, depth: number, rootId: string): void {
  layoutNode.depth = depth;
  layoutNode.rootId = rootId;

  for (const child of layoutNode.children) {
    tagTree(child, depth + 1, rootId);
  }
}

function measure(layoutNode: LayoutNode, direction: "horizontal" | "vertical"): void {
  if (layoutNode.children.length === 0) {
    measureLeaf(layoutNode);
    return;
  }

  for (const child of layoutNode.children) {
    measure(child, direction);
  }

  const cols = direction === "vertical" ? 1 : chooseCols(layoutNode.children.length);
  const rows: LayoutNode[][] = [];

  for (let index = 0; index < layoutNode.children.length; index += cols) {
    rows.push(layoutNode.children.slice(index, index + cols));
  }

  layoutNode.rows = rows;

  let innerWidth = 0;
  let innerHeight = 0;

  rows.forEach((row, index) => {
    const rowWidth = row.reduce((sum, child) => sum + child.box.width, 0) + GAP * (row.length - 1);
    const rowHeight = Math.max(...row.map((child) => child.box.height));
    innerWidth = Math.max(innerWidth, rowWidth);
    innerHeight += rowHeight + (index > 0 ? GAP : 0);
  });

  layoutNode.box.width = innerWidth + PAD * 2;
  layoutNode.box.height = innerHeight + PAD * 2 + HEADER_H;
}

function place(layoutNode: LayoutNode, x: number, y: number): void {
  layoutNode.box.x = x;
  layoutNode.box.y = y;

  if (layoutNode.children.length === 0) {
    return;
  }

  const innerWidth = layoutNode.box.width - PAD * 2;
  let cursorY = y + HEADER_H + PAD;

  for (const row of layoutNode.rows) {
    const rowWidth = row.reduce((sum, child) => sum + child.box.width, 0) + GAP * (row.length - 1);
    const rowHeight = Math.max(...row.map((child) => child.box.height));
    let cursorX = x + PAD + (innerWidth - rowWidth) / 2;

    for (const child of row) {
      place(child, cursorX, cursorY + (rowHeight - child.box.height) / 2);
      cursorX += child.box.width + GAP;
    }

    cursorY += rowHeight + GAP;
  }
}

interface Band {
  name?: string;
  roots: LayoutNode[];
}

function arrangeRoots(roots: LayoutNode[], diagram: SemanticDiagram): { bands: Band[]; totalW: number; totalH: number } {
  const rootById = new Map(roots.map((root) => [root.node.id, root]));
  let bands: Band[] = [];

  if (diagram.type === "architecture" && diagram.layers?.length) {
    const used = new Set<string>();

    for (const layer of diagram.layers) {
      const layerRoots = layer.nodeIds.map((id) => rootById.get(id)).filter((root): root is LayoutNode => Boolean(root));
      layerRoots.forEach((root) => used.add(root.node.id));
      bands.push({ name: layer.name, roots: layerRoots });
    }

    const leftover = roots.filter((root) => !used.has(root.node.id));
    if (leftover.length) {
      bands.push({ roots: leftover });
    }
  } else if (diagram.type === "flow" && diagram.direction !== "vertical") {
    // A connected chain (edges linking the roots, e.g. start→…→end) keeps its
    // single left-to-right band. But many *parallel* roots — unconnected nodes,
    // common when a deck slide defaults an unrecognized diagram to "flow" — get
    // wrapped into balanced rows so they stay wide enough and fill the canvas
    // vertically instead of cramming into one mid-height strip.
    const rootIndex = new Map(roots.map((root, index) => [root.node.id, index]));
    const rootEdges = diagram.edges.filter((edge) => rootIndex.has(edge.from) && rootIndex.has(edge.to));
    const rootsAreChained = rootEdges.length > 0;
    if (roots.length > FLOW_ROW_MAX && !rootsAreChained) {
      const cols = chooseCols(roots.length);
      for (let index = 0; index < roots.length; index += cols) {
        bands.push({ roots: roots.slice(index, index + cols) });
      }
    } else if (rootsAreChained && roots.length > FLOW_SNAKE_MAX) {
      // Snake (boustrophedon): rows of ~FLOW_SNAKE_COLS, every other row reversed
      // so the end of one row sits directly above the start of the next and the
      // transition connector is a short vertical.
      const rowCount = Math.ceil(roots.length / FLOW_SNAKE_COLS);
      const perRow = Math.ceil(roots.length / rowCount);
      for (let r = 0; r < rowCount; r++) {
        const slice = roots.slice(r * perRow, (r + 1) * perRow);
        bands.push({ roots: r % 2 === 1 ? slice.reverse() : slice });
      }
    } else {
      bands = [{ roots }];
    }
  } else if (diagram.direction === "vertical") {
    bands = roots.map((root) => ({ roots: [root] }));
  } else {
    const cols = chooseCols(roots.length);

    for (let index = 0; index < roots.length; index += cols) {
      bands.push({ roots: roots.slice(index, index + cols) });
    }
  }

  const bandWidths = bands.map(
    (band) => band.roots.reduce((sum, root) => sum + root.box.width, 0) + GAP * Math.max(0, band.roots.length - 1)
  );
  const totalW = Math.max(...bandWidths, 1);
  let cursorY = 0;

  bands.forEach((band, index) => {
    const bandHeight = Math.max(...band.roots.map((root) => root.box.height), 1);
    let cursorX = (totalW - bandWidths[index]) / 2;

    for (const root of band.roots) {
      place(root, cursorX, cursorY + (bandHeight - root.box.height) / 2);
      cursorX += root.box.width + GAP;
    }

    cursorY += bandHeight + LAYER_GAP;
  });

  return { bands, totalW, totalH: cursorY - LAYER_GAP };
}

function center(box: Box): Pt {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Does an axis-aligned segment cross a rect's strict interior?
function segHitsRectInterior(x1: number, y1: number, x2: number, y2: number, r: Box): boolean {
  const rx1 = r.x;
  const ry1 = r.y;
  const rx2 = r.x + r.width;
  const ry2 = r.y + r.height;
  if (Math.abs(y1 - y2) < 0.01) {
    if (y1 <= ry1 || y1 >= ry2) return false;
    return Math.min(x1, x2) < rx2 && Math.max(x1, x2) > rx1;
  }
  if (x1 <= rx1 || x1 >= rx2) return false;
  return Math.min(y1, y2) < ry2 && Math.max(y1, y2) > ry1;
}

function pathHitsObstacle(points: Pt[], obstacles: Box[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    for (const o of obstacles) {
      if (segHitsRectInterior(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, o)) return true;
    }
  }
  return false;
}

function inflate(b: Box, m: number): Box {
  return { x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m };
}

// Anchor on the side of `box` facing `toward`.
function sideAnchor(box: Box, toward: Pt): Pt {
  const c = center(box);
  if (Math.abs(toward.x - c.x) >= Math.abs(toward.y - c.y)) {
    return { x: toward.x >= c.x ? box.x + box.width : box.x, y: c.y };
  }
  return { x: c.x, y: toward.y >= c.y ? box.y + box.height : box.y };
}

// Orthogonal A* on the Hanan grid (obstacle corners + anchors) that routes
// around node boxes with clearance. Used only when the simple route is blocked.
function routeAround(source: Box, target: Box, obstacles: Box[]): Pt[] | null {
  const CLEAR = 12;
  // source/target block the path (so it can't cut through them) but are not
  // inflated, so an anchor on their border stays valid.
  const blockers = [source, target, ...obstacles.map((o) => inflate(o, CLEAR))];
  const a = sideAnchor(source, center(target));
  const b = sideAnchor(target, center(source));

  const uniq = (vals: number[]) => [...new Set(vals.map((v) => Math.round(v)))].sort((p, q) => p - q);
  const xs = uniq([a.x, b.x, ...blockers.flatMap((o) => [o.x, o.x + o.width])]);
  const ys = uniq([a.y, b.y, ...blockers.flatMap((o) => [o.y, o.y + o.height])]);
  const ix = new Map(xs.map((v, i) => [v, i]));
  const iy = new Map(ys.map((v, i) => [v, i]));
  const si = ix.get(Math.round(a.x));
  const sj = iy.get(Math.round(a.y));
  const gi = ix.get(Math.round(b.x));
  const gj = iy.get(Math.round(b.y));
  if (si === undefined || sj === undefined || gi === undefined || gj === undefined) return null;

  const clear = (x1: number, y1: number, x2: number, y2: number) => !blockers.some((o) => segHitsRectInterior(x1, y1, x2, y2, o));
  const key = (i: number, j: number) => i * ys.length + j;
  const start = key(si, sj);
  const goal = key(gi, gj);
  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  const open: Array<{ n: number; f: number }> = [{ n: start, f: 0 }];
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[gi]) + Math.abs(ys[j] - ys[gj]);
  const TURN = 40;

  while (open.length) {
    open.sort((p, q) => p.f - q.f);
    const { n } = open.shift()!;
    if (n === goal) break;
    const i = Math.floor(n / ys.length);
    const j = n % ys.length;
    const prev = cameFrom.get(n);
    const pdir = prev === undefined ? -1 : Math.floor(prev / ys.length) === i ? 0 : 1; // 0=horiz,1=vert incoming
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      if (!clear(xs[i], ys[j], xs[ni], ys[nj])) continue;
      const dir = di !== 0 ? 0 : 1;
      const step = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (pdir !== -1 && pdir !== dir ? TURN : 0);
      const nk = key(ni, nj);
      const tentative = (gScore.get(n) ?? Infinity) + step;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, n);
        gScore.set(nk, tentative);
        open.push({ n: nk, f: tentative + h(ni, nj) });
      }
    }
  }
  if (!cameFrom.has(goal) && goal !== start) return null;

  const raw: Pt[] = [];
  let cur = goal;
  raw.push({ x: xs[Math.floor(cur / ys.length)], y: ys[cur % ys.length] });
  while (cur !== start) {
    const p = cameFrom.get(cur);
    if (p === undefined) return null;
    cur = p;
    raw.push({ x: xs[Math.floor(cur / ys.length)], y: ys[cur % ys.length] });
  }
  raw.reverse();
  // Drop collinear midpoints.
  const pts: Pt[] = [];
  for (let k = 0; k < raw.length; k++) {
    if (k > 0 && k < raw.length - 1) {
      const a1 = raw[k - 1];
      const b1 = raw[k];
      const c1 = raw[k + 1];
      if ((a1.x === b1.x && b1.x === c1.x) || (a1.y === b1.y && b1.y === c1.y)) continue;
    }
    pts.push(raw[k]);
  }
  return pts.length >= 2 ? pts : null;
}

function routeEdge(source: Box, target: Box, obstacles: Box[]): Pt[] {
  const simple = simpleRoute(source, target, obstacles);
  if (!pathHitsObstacle(simple, obstacles)) return simple;
  const around = routeAround(source, target, obstacles);
  return around && !pathHitsObstacle(around, obstacles) ? around : simple;
}

function simpleRoute(source: Box, target: Box, obstacles: Box[]): Pt[] {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const vertical = Math.abs(targetCenter.y - sourceCenter.y) > Math.abs(targetCenter.x - sourceCenter.x) + 1;

  if (vertical) {
    const down = targetCenter.y > sourceCenter.y;
    const sourceY = down ? source.y + source.height : source.y;
    const targetY = down ? target.y : target.y + target.height;
    const channelY = (sourceY + targetY) / 2;

    if (Math.abs(sourceCenter.x - targetCenter.x) < 2) {
      return [
        { x: sourceCenter.x, y: sourceY },
        { x: targetCenter.x, y: targetY }
      ];
    }

    return [
      { x: sourceCenter.x, y: sourceY },
      { x: sourceCenter.x, y: channelY },
      { x: targetCenter.x, y: channelY },
      { x: targetCenter.x, y: targetY }
    ];
  }

  const right = targetCenter.x > sourceCenter.x;
  const sourceX = right ? source.x + source.width : source.x;
  const targetX = right ? target.x : target.x + target.width;
  const corridor: Box = {
    x: Math.min(sourceX, targetX),
    y: Math.min(source.y, target.y),
    width: Math.abs(targetX - sourceX),
    height: Math.max(source.y + source.height, target.y + target.height) - Math.min(source.y, target.y)
  };
  const blocked = obstacles.some((obstacle) => intersects(corridor, obstacle));

  if (!blocked) {
    if (Math.abs(sourceCenter.y - targetCenter.y) < 2) {
      return [
        { x: sourceX, y: sourceCenter.y },
        { x: targetX, y: targetCenter.y }
      ];
    }

    const centerX = (sourceX + targetX) / 2;
    return [
      { x: sourceX, y: sourceCenter.y },
      { x: centerX, y: sourceCenter.y },
      { x: centerX, y: targetCenter.y },
      { x: targetX, y: targetCenter.y }
    ];
  }

  const laneY = Math.max(source.y + source.height, target.y + target.height) + GAP;
  return [
    { x: sourceCenter.x, y: source.y + source.height },
    { x: sourceCenter.x, y: laneY },
    { x: targetCenter.x, y: laneY },
    { x: targetCenter.x, y: target.y + target.height }
  ];
}

export function layoutDiagram(
  diagram: SemanticDiagram,
  opts: { theme?: DiagramTheme; canvasBg?: string } | string = {}
): Figure {
  const options = typeof opts === "string" ? { canvasBg: opts } : opts;
  const theme = resolveTheme(options.theme);
  ACCENTS = theme.accents;
  TEXT = theme.text;
  SUBTEXT = theme.subtext;
  EDGE = theme.edge;
  const canvasBg = options.canvasBg ?? theme.background;
  if (diagram.type === "timeline") return layoutTimeline(diagram, theme, canvasBg);
  if (diagram.type === "pyramid") return layoutPyramid(diagram, theme, canvasBg);
  if (diagram.type === "matrix") return layoutMatrix(diagram, theme, canvasBg);
  if (diagram.type === "hierarchy") return layoutHierarchy(diagram, theme, canvasBg);
  if (diagram.type === "cycle") return layoutCycle(diagram, theme, canvasBg);
  if (diagram.type === "funnel") return layoutFunnel(diagram, theme, canvasBg);
  if (diagram.type === "venn") return layoutVenn(diagram, theme, canvasBg);
  if (diagram.type === "mindmap") return layoutMindmap(diagram, theme, canvasBg);
  if (diagram.type === "fishbone") return layoutFishbone(diagram, theme, canvasBg);
  if (diagram.type === "gantt") return layoutGantt(diagram, theme, canvasBg);
  if (diagram.type === "swimlane") return layoutSwimlane(diagram, theme, canvasBg);
  if (diagram.type === "scatter") return layoutScatter(diagram, theme, canvasBg);
  if (diagram.type === "kanban") return layoutKanban(diagram, theme, canvasBg);
  if (diagram.type === "network") return layoutNetwork(diagram, theme, canvasBg);
  if (diagram.type === "radar") return layoutRadar(diagram, theme, canvasBg);
  if (diagram.type === "heatmap") return layoutHeatmap(diagram, theme, canvasBg);
  if (diagram.type === "waterfall") return layoutWaterfall(diagram, theme, canvasBg);

  const width = 1280;
  const height = 720;
  const direction = diagram.direction ?? "horizontal";

  const roots = buildTree(diagram);
  roots.forEach((root) => measure(root, direction));
  const { bands, totalW, totalH } = arrangeRoots(roots, diagram);

  const colorGroupByRoot = new Map<string, number>();
  if (diagram.type === "architecture" && diagram.layers?.length) {
    bands.forEach((band, index) => band.roots.forEach((root) => colorGroupByRoot.set(root.node.id, index)));
  } else {
    roots.forEach((root, index) => colorGroupByRoot.set(root.node.id, index));
  }

  const accentFor = (layoutNode: LayoutNode) => ACCENTS[(colorGroupByRoot.get(layoutNode.rootId) ?? 0) % ACCENTS.length];
  const usableW = width - CANVAS_MARGIN * 2;
  const usableH = height - CANVAS_MARGIN * 2 - TITLE_H;
  // A wrapped flow (snake / parallel rows) is narrower than a single row, so it
  // has width slack — let it scale up (capped) to fill the canvas height instead
  // of floating small in a centered band. Every other diagram keeps the ≤1 cap.
  const flowWrapped = diagram.type === "flow" && bands.length > 1;
  const scale = Math.min(flowWrapped ? FLOW_FILL_MAX : 1, usableW / totalW, usableH / totalH);
  const offsetX = (width - totalW * scale) / 2;
  const offsetY = CANVAS_MARGIN + TITLE_H + (usableH - totalH * scale) / 2;
  const x = (value: number) => Math.round(offsetX + value * scale);
  const y = (value: number) => Math.round(offsetY + value * scale);
  const scaled = (value: number) => Math.max(1, Math.round(value * scale));
  const scaledFont = (base: number, min: number) => Math.max(min, Math.round(base * scale));

  const elements: FigureElement[] = [
    {
      id: "figure-title-text",
      type: "text",
      name: "title",
      x: CANVAS_MARGIN,
      y: 74,
      width: width - CANVAS_MARGIN * 2,
      height: 52,
      text: diagram.title,
      fontSize: 32,
      fontWeight: 800,
      fill: TEXT,
      textAnchor: "start"
    }
  ];

  if (diagram.type === "architecture" && diagram.layers?.length) {
    bands.forEach((band, index) => {
      if (!band.name || band.roots.length === 0) {
        return;
      }

      const top = Math.min(...band.roots.map((root) => root.box.y));
      const bottom = Math.max(...band.roots.map((root) => root.box.y + root.box.height));

      elements.push({
        id: `band-${index}`,
        type: "rect",
        name: band.name,
        x: x(0) - 8,
        y: y(top) - 8,
        width: scaled(totalW) + 16,
        height: scaled(bottom - top) + 16,
        rx: 14,
        fill: ACCENTS[index % ACCENTS.length].tint,
        stroke: "none",
        strokeWidth: 0
      });
      elements.push({
        id: `band-label-${index}`,
        type: "text",
        name: `${band.name} label`,
        x: x(0) - 8,
        y: y(top) - 32,
        width: scaled(totalW),
        height: 22,
        text: band.name,
        fontSize: scaledFont(14, 11),
        fontWeight: 700,
        fill: "#5B6577",
        textAnchor: "start"
      });
    });
  }

  const emitNode = (layoutNode: LayoutNode): FigureElement => {
    const box = layoutNode.box;
    const isContainer = layoutNode.children.length > 0;
    const accent = accentFor(layoutNode);
    const emphasis = layoutNode.node.emphasis ?? "normal";
    const fill = isContainer ? "#FFFFFF" : emphasis === "primary" ? accent.tint : emphasis === "muted" ? "#F4F5F7" : "#FFFFFF";
    const parts: FigureElement[] = [
      {
        id: `${layoutNode.node.id}-rect`,
        type: "rect",
        name: layoutNode.node.label,
        x: x(box.x),
        y: y(box.y),
        width: scaled(box.width),
        height: scaled(box.height),
        rx: 12,
        fill,
        stroke: accent.stroke,
        strokeWidth: isContainer ? 1.5 : 2,
        dash: layoutNode.node.dashed === true
      }
    ];

    if (isContainer) {
      parts.push({
        id: `${layoutNode.node.id}-label`,
        type: "text",
        name: `${layoutNode.node.label} label`,
        x: x(box.x),
        y: y(box.y),
        width: scaled(box.width),
        height: scaled(HEADER_H),
        text: layoutNode.node.label,
        fontSize: scaledFont(16, 11),
        fontWeight: 700,
        fill: TEXT,
        textAnchor: "middle"
      });
    } else {
      const titleH = layoutNode.titleLines * TITLE_LH;
      const detailH = layoutNode.detailLines ? layoutNode.detailLines * DETAIL_LH : 0;
      const gap = layoutNode.detailLines ? 4 : 0;
      const contentH = titleH + gap + detailH;
      const top = box.y + (box.height - contentH) / 2;

      parts.push({
        id: `${layoutNode.node.id}-title`,
        type: "text",
        name: `${layoutNode.node.label} title`,
        x: x(box.x),
        y: y(top),
        width: scaled(box.width),
        height: scaled(titleH),
        text: layoutNode.node.label,
        fontSize: scaledFont(TITLE_FONT, 10),
        fontWeight: 700,
        fill: TEXT,
        textAnchor: "middle"
      });

      if (layoutNode.node.detail) {
        parts.push({
          id: `${layoutNode.node.id}-detail`,
          type: "text",
          name: `${layoutNode.node.label} detail`,
          x: x(box.x),
          y: y(top + titleH + gap),
          width: scaled(box.width),
          height: scaled(detailH),
          text: layoutNode.node.detail,
          fontSize: scaledFont(DETAIL_FONT, 9),
          fontWeight: 500,
          fill: SUBTEXT,
          textAnchor: "middle"
        });
      }
    }

    return {
      id: `${layoutNode.node.id}-group`,
      type: "group",
      name: layoutNode.node.label,
      children: [...parts, ...layoutNode.children.map(emitNode)]
    };
  };

  roots.forEach((root) => elements.push(emitNode(root)));

  const boxById = new Map<string, Box>();
  const ancestors = new Map<string, Set<string>>();
  const allBoxes: Array<{ id: string; box: Box }> = [];
  const collect = (layoutNode: LayoutNode, chain: string[]) => {
    boxById.set(layoutNode.node.id, layoutNode.box);
    ancestors.set(layoutNode.node.id, new Set(chain));
    allBoxes.push({ id: layoutNode.node.id, box: layoutNode.box });
    layoutNode.children.forEach((child) => collect(child, [...chain, layoutNode.node.id]));
  };
  roots.forEach((root) => collect(root, []));

  const descendantsOf = (id: string): Set<string> => {
    const descendants = new Set<string>();

    for (const [nodeId, nodeAncestors] of ancestors) {
      if (nodeAncestors.has(id)) {
        descendants.add(nodeId);
      }
    }

    return descendants;
  };

  diagram.edges.forEach((edge, index) => {
    const source = boxById.get(edge.from);
    const target = boxById.get(edge.to);

    if (!source || !target) {
      return;
    }

    const exclude = new Set<string>([edge.from, edge.to]);
    for (const ancestor of ancestors.get(edge.from) ?? []) {
      exclude.add(ancestor);
    }
    for (const ancestor of ancestors.get(edge.to) ?? []) {
      exclude.add(ancestor);
    }
    for (const descendant of descendantsOf(edge.from)) {
      exclude.add(descendant);
    }
    for (const descendant of descendantsOf(edge.to)) {
      exclude.add(descendant);
    }

    const obstacles = allBoxes.filter((candidate) => !exclude.has(candidate.id)).map((candidate) => candidate.box);
    const points = routeEdge(source, target, obstacles);
    const dash = edge.dashed === true;

    elements.push({
      id: `edge-${index}-connector`,
      type: "connector",
      name: `${edge.from} -> ${edge.to}`,
      points: points.map((point) => ({ x: x(point.x), y: y(point.y) })),
      stroke: EDGE,
      strokeWidth: 2,
      dash,
      endArrow: true
    });

    if (edge.label) {
      let best = {
        mx: (points[0].x + points[1].x) / 2,
        my: (points[0].y + points[1].y) / 2,
        len: 0
      };

      for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
        const length = Math.abs(points[pointIndex + 1].x - points[pointIndex].x);

        if (length > best.len) {
          best = {
            mx: (points[pointIndex].x + points[pointIndex + 1].x) / 2,
            my: (points[pointIndex].y + points[pointIndex + 1].y) / 2,
            len: length
          };
        }
      }

      const plateW = Math.max(34, measureSvgText(edge.label, 12) + 12);
      elements.push({
        id: `edge-${index}-label-bg`,
        type: "rect",
        name: `${edge.from} -> ${edge.to} label bg`,
        x: x(best.mx) - Math.round((plateW * scale) / 2),
        y: y(best.my) - 12,
        width: scaled(plateW),
        height: 22,
        rx: 4,
        fill: "#FFFFFF",
        stroke: "none",
        strokeWidth: 0
      });
      elements.push({
        id: `edge-${index}-label`,
        type: "text",
        name: `${edge.from} -> ${edge.to} label`,
        x: x(best.mx) - Math.round((plateW * scale) / 2),
        y: y(best.my) - 12,
        width: scaled(plateW),
        height: 22,
        text: edge.label,
        fontSize: scaledFont(12, 9),
        fontWeight: 500,
        fill: SUBTEXT,
        textAnchor: "middle"
      });
    }
  });

  return {
    canvas: { width, height, background: canvasBg, fontFamily: theme.fontFamily },
    metadata: {
      title: diagram.title,
      description: diagram.description ?? diagram.title,
      skillId: diagram.type,
      language: diagram.language
    },
    elements
  };
}
