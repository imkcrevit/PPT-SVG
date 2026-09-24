import type { Figure, FigureElement } from "@/lib/types";
import type { SemanticDiagram, SemanticNode } from "@/lib/semantic-types";
import { DEFAULT_THEME, resolveTheme, type DiagramTheme } from "@/lib/theme";
import { estimateLineCount, measureSvgText } from "@/lib/text-layout";
import { placeEdgeLabel, routeEdge, type Box, type Pt } from "@/lib/orthogonal-route";
import {
  layoutCycle,
  layoutFishbone,
  layoutFunnel,
  layoutGantt,
  layoutHeatmap,
  layoutHierarchy,
  layoutKanban,
  layoutBar,
  layoutLine,
  layoutMatrix,
  layoutMindmap,
  layoutNetwork,
  layoutPyramid,
  layoutPie,
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
const CANVAS_W = 1280;
const CANVAS_H = 720;
const CANVAS_MARGIN = 48;
// A horizontal flow is normally a chain with few roots. Beyond this many
// parallel roots, wrap them into balanced rows instead of one cramped row.
const FLOW_ROW_MAX = 5;
// A connected flow keeps one row through five compact steps. Six-step flows
// (the common point where a slide starts looking like a thin strip), or shorter
// flows whose measured cards no longer fit the body width, snake into rows.
const FLOW_SINGLE_ROW_MAX = 5;
const FLOW_SINGLE_ROW_MAX_WIDTH = CANVAS_W - CANVAS_MARGIN * 2;
const FLOW_SNAKE_COLS = 4;
// Upscale cap for wrapped flows so they fill the canvas without ballooning text.
const FLOW_FILL_MAX = 2;
const MIN_W = 110;
const MAX_W = 320;
// Top reserve below the title band. Sized so a title at y=74 (matching the deck
// template's content-page title) never overlaps the diagram body.
const TITLE_H = 112;

const TITLE_FONT = 15;
const DETAIL_FONT = 12;
const TITLE_LH = TITLE_FONT * 1.28;
const DETAIL_LH = DETAIL_FONT * 1.32;
const BOX_PAD_Y = 12;
const BOX_PAD_X = 16;


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
// Horizontal gap between two adjacent siblings/roots that share a labelled
// edge, keyed by the unordered id pair. A default 22px gap cannot hold a label
// plate, so the label used to land on top of the neighbouring cards.
let LABEL_GAPS = new Map<string, number>();
// Vertical gap between two rows when a labelled edge crosses between them.
const LABEL_ROW_GAP = 44;
const EDGE_LABEL_FONT = 12;
const EDGE_LABEL_H = 22;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function gapBetween(a: LayoutNode, b: LayoutNode): number {
  return Math.max(GAP, LABEL_GAPS.get(pairKey(a.node.id, b.node.id)) ?? 0);
}

function rowWidthOf(row: LayoutNode[]): number {
  return row.reduce((sum, child, index) => sum + child.box.width + (index > 0 ? gapBetween(row[index - 1], child) : 0), 0);
}

function rowGapBetween(upper: LayoutNode[], lower: LayoutNode[]): number {
  for (const a of upper) {
    for (const b of lower) {
      if (LABEL_GAPS.has(pairKey(a.node.id, b.node.id))) {
        return LABEL_ROW_GAP;
      }
    }
  }
  return GAP;
}

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
    const rowWidth = rowWidthOf(row);
    const rowHeight = Math.max(...row.map((child) => child.box.height));
    innerWidth = Math.max(innerWidth, rowWidth);
    innerHeight += rowHeight + (index > 0 ? rowGapBetween(rows[index - 1], row) : 0);
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

  layoutNode.rows.forEach((row, rowIndex) => {
    const rowWidth = rowWidthOf(row);
    const rowHeight = Math.max(...row.map((child) => child.box.height));
    let cursorX = x + PAD + (innerWidth - rowWidth) / 2;

    row.forEach((child, index) => {
      if (index > 0) cursorX += gapBetween(row[index - 1], child);
      place(child, cursorX, cursorY + (rowHeight - child.box.height) / 2);
      cursorX += child.box.width;
    });

    const next = layoutNode.rows[rowIndex + 1];
    cursorY += rowHeight + (next ? rowGapBetween(row, next) : GAP);
  });
}

interface Band {
  name?: string;
  roots: LayoutNode[];
  align?: "start" | "center" | "end";
}

function rootsWidth(roots: LayoutNode[]): number {
  return rowWidthOf(roots);
}

function widestFlowRow(roots: LayoutNode[], perRow: number): number {
  let widest = 0;

  for (let index = 0; index < roots.length; index += perRow) {
    widest = Math.max(widest, rootsWidth(roots.slice(index, index + perRow)));
  }

  return widest;
}

function chooseFlowRowSize(roots: LayoutNode[]): number {
  // Once wrapping is required, use at least two rows. Four columns is a good
  // upper bound for readable 16:9 slides; measured width can reduce it further
  // for containers or unusually long labels.
  let perRow = Math.min(FLOW_SNAKE_COLS, Math.ceil(roots.length / 2));

  while (perRow > 1 && widestFlowRow(roots, perRow) > FLOW_SINGLE_ROW_MAX_WIDTH) {
    perRow -= 1;
  }

  return Math.max(1, perRow);
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
    const chainNeedsWrap =
      rootsAreChained &&
      (roots.length > FLOW_SINGLE_ROW_MAX || rootsWidth(roots) > FLOW_SINGLE_ROW_MAX_WIDTH);
    if (roots.length > FLOW_ROW_MAX && !rootsAreChained) {
      const cols = chooseCols(roots.length);
      for (let index = 0; index < roots.length; index += cols) {
        bands.push({ roots: roots.slice(index, index + cols) });
      }
    } else if (chainNeedsWrap) {
      // Snake (boustrophedon): every other row is reversed. Later rows align
      // toward their incoming turn, so a partial final row still starts directly
      // below the preceding row end instead of drifting into the center.
      const perRow = chooseFlowRowSize(roots);
      for (let index = 0, row = 0; index < roots.length; index += perRow, row += 1) {
        const slice = roots.slice(index, index + perRow);
        bands.push({
          roots: row % 2 === 1 ? [...slice].reverse() : slice,
          align: row === 0 ? "center" : row % 2 === 1 ? "end" : "start"
        });
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
    (band) => rootsWidth(band.roots)
  );
  const totalW = Math.max(...bandWidths, 1);
  let cursorY = 0;

  bands.forEach((band, index) => {
    const bandHeight = Math.max(...band.roots.map((root) => root.box.height), 1);
    const remainingWidth = totalW - bandWidths[index];
    let cursorX =
      band.align === "start" ? 0 : band.align === "end" ? remainingWidth : remainingWidth / 2;

    band.roots.forEach((root, rootIndex) => {
      if (rootIndex > 0) cursorX += gapBetween(band.roots[rootIndex - 1], root);
      place(root, cursorX, cursorY + (bandHeight - root.box.height) / 2);
      cursorX += root.box.width;
    });

    cursorY += bandHeight + LAYER_GAP;
  });

  return { bands, totalW, totalH: cursorY - LAYER_GAP };
}

interface ContainerStyle {
  fill: string;
  strokeWidth: number;
  rx: number;
  fontSize: number;
  headerFill?: string;
  headerText: string;
}

// Each split level gets its own visual weight so nesting reads at a glance:
//   level 1 group  → white body + solid accent title bar (white title)
//   level 2 group  → tinted body, accent-coloured title
//   level 3+ group → light neutral body, thinner border, smaller title
// Leaf cards stay white, so they always contrast with the group they sit in.
function containerStyle(depth: number, accent: { stroke: string; tint: string }): ContainerStyle {
  if (depth === 0) {
    return { fill: "#FFFFFF", strokeWidth: 2, rx: 12, fontSize: 16, headerFill: accent.stroke, headerText: readableOn(accent.stroke) };
  }
  if (depth === 1) {
    return { fill: accent.tint, strokeWidth: 1.5, rx: 10, fontSize: 14, headerText: TEXT };
  }
  return { fill: "#F7F8FA", strokeWidth: 1.2, rx: 8, fontSize: 13, headerText: SUBTEXT };
}

function readableOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#FFFFFF";
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.45 ? TEXT : "#FFFFFF";
}

function findNode(roots: LayoutNode[], id: string): LayoutNode | undefined {
  for (const root of roots) {
    if (root.node.id === id) return root;
    const found = findNode(root.children, id);
    if (found) return found;
  }
  return undefined;
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
  if (diagram.type === "pie") return layoutPie(diagram, theme, canvasBg);
  if (diagram.type === "bar") return layoutBar(diagram, theme, canvasBg);
  if (diagram.type === "line") return layoutLine(diagram, theme, canvasBg);

  const width = CANVAS_W;
  const height = CANVAS_H;
  const direction = diagram.direction ?? "horizontal";

  LABEL_GAPS = new Map();
  for (const edge of diagram.edges) {
    if (edge.label) {
      const need = measureSvgText(edge.label, EDGE_LABEL_FONT) + 12 + 28;
      const key = pairKey(edge.from, edge.to);
      LABEL_GAPS.set(key, Math.max(LABEL_GAPS.get(key) ?? 0, need));
    }
  }
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
    const style = isContainer ? containerStyle(layoutNode.depth, accent) : undefined;
    const fill = style ? style.fill : emphasis === "primary" ? accent.tint : emphasis === "muted" ? "#F4F5F7" : "#FFFFFF";
    const parts: FigureElement[] = [
      {
        id: `${layoutNode.node.id}-rect`,
        type: "rect",
        name: layoutNode.node.label,
        x: x(box.x),
        y: y(box.y),
        width: scaled(box.width),
        height: scaled(box.height),
        rx: style ? style.rx : 12,
        fill,
        stroke: accent.stroke,
        strokeWidth: style ? style.strokeWidth : 2,
        dash: layoutNode.node.dashed === true
      }
    ];

    if (style?.headerFill) {
      // Solid title bar marks a top-level group, so the first split level reads
      // at a glance. A second, square-cornered rect flattens the bar's bottom.
      const headerH = scaled(HEADER_H);
      parts.push(
        {
          id: `${layoutNode.node.id}-header`,
          type: "rect",
          name: `${layoutNode.node.label} header`,
          x: x(box.x),
          y: y(box.y),
          width: scaled(box.width),
          height: headerH,
          rx: style.rx,
          fill: style.headerFill,
          stroke: "none",
          strokeWidth: 0
        },
        {
          id: `${layoutNode.node.id}-header-base`,
          type: "rect",
          name: `${layoutNode.node.label} header base`,
          x: x(box.x),
          y: y(box.y) + headerH - Math.min(style.rx, Math.floor(headerH / 2)),
          width: scaled(box.width),
          height: Math.min(style.rx, Math.floor(headerH / 2)),
          rx: 0,
          fill: style.headerFill,
          stroke: "none",
          strokeWidth: 0
        }
      );
    }

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
        fontSize: scaledFont(style?.fontSize ?? 16, 11),
        fontWeight: 700,
        fill: style?.headerText ?? TEXT,
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

  // A container's title text is content too: edges must not run through it and
  // labels must not sit on it.
  const headerTextBoxes = new Map<string, Box>();
  for (const { id, box } of allBoxes) {
    const layoutNode = findNode(roots, id);
    if (!layoutNode || layoutNode.children.length === 0) continue;
    const fontSize = containerStyle(layoutNode.depth, accentFor(layoutNode)).fontSize;
    const textW = Math.min(box.width, measureSvgText(layoutNode.node.label, fontSize) + 24);
    headerTextBoxes.set(id, { x: box.x + (box.width - textW) / 2, y: box.y + 4, width: textW, height: HEADER_H - 8 });
  }
  const placedLabels: Box[] = [];

  // Architecture bands (tinted panels) and their captions, in layout units.
  const bandPanels: Box[] = [];
  const bandCaptions: Box[] = [];
  if (diagram.type === "architecture" && diagram.layers?.length) {
    bands.forEach((band) => {
      if (!band.name || band.roots.length === 0) return;
      const top = Math.min(...band.roots.map((root) => root.box.y));
      const bottom = Math.max(...band.roots.map((root) => root.box.y + root.box.height));
      bandPanels.push({ x: -8 / scale, y: top - 8 / scale, width: totalW + 16 / scale, height: bottom - top + 16 / scale });
      const captionW = measureSvgText(band.name, scaledFont(14, 11)) + 8;
      bandCaptions.push({ x: -8 / scale, y: top - 32 / scale, width: captionW / scale, height: 22 / scale });
    });
  }

  const descendantsOf = (id: string): Set<string> => {
    const descendants = new Set<string>();

    for (const [nodeId, nodeAncestors] of ancestors) {
      if (nodeAncestors.has(id)) {
        descendants.add(nodeId);
      }
    }

    return descendants;
  };

  const routed: Array<{ edge: SemanticDiagram["edges"][number]; index: number; points: Pt[] }> = [];
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

    const obstacles = [
      ...allBoxes.filter((candidate) => !exclude.has(candidate.id)).map((candidate) => candidate.box),
      ...[...headerTextBoxes].filter(([id]) => id !== edge.from && id !== edge.to).map(([, box]) => box),
      ...bandCaptions
    ];
    let points = routeEdge(source, target, obstacles);
    // A→B plus B→A on one straight run would draw two arrows on the same line;
    // pull each direction a few pixels to its own side.
    if (points.length === 2 && diagram.edges.some((other) => other.from === edge.to && other.to === edge.from)) {
      const shift = (edge.from < edge.to ? -1 : 1) * 7;
      const horizontal = Math.abs(points[0].y - points[1].y) < 1;
      points = points.map((point) => (horizontal ? { x: point.x, y: point.y + shift } : { x: point.x + shift, y: point.y }));
    }
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
    routed.push({ edge, index, points });
  });

  // Labels go on after every edge is routed, so a plate can also avoid the
  // lines of other edges, and are drawn above all connectors.
  const segmentBoxes = (points: Pt[]): Box[] =>
    points.slice(0, -1).map((a, k) => {
      const b = points[k + 1];
      return { x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, width: Math.abs(b.x - a.x) + 2, height: Math.abs(b.y - a.y) + 2 };
    });
  routed.forEach(({ edge, index, points }) => {
    if (edge.label) {
      const fontSize = scaledFont(EDGE_LABEL_FONT, 9);
      const plateW = Math.max(34, measureSvgText(edge.label, fontSize) + 12);
      // Work in layout units so the plate can be tested against node boxes.
      const plate = { width: plateW / scale, height: EDGE_LABEL_H / scale };
      const blockers: Array<{ box: Box; container: boolean }> = [
        ...allBoxes.map(({ id, box }) => ({ box, container: headerTextBoxes.has(id) })),
        // Whole title bar, not just its text: a plate on a coloured bar reads as a glitch.
        ...[...headerTextBoxes.keys()].map((id) => {
          const box = boxById.get(id)!;
          return { box: { x: box.x, y: box.y, width: box.width, height: HEADER_H }, container: false };
        }),
        ...placedLabels.map((box) => ({ box, container: false })),
        ...bandPanels.map((box) => ({ box, container: true })),
        ...bandCaptions.map((box) => ({ box, container: false })),
        ...routed.filter((other) => other.index !== index).flatMap((other) => segmentBoxes(other.points).map((box) => ({ box, container: false })))
      ];
      const best = placeEdgeLabel(points, plate, blockers);
      placedLabels.push({ x: best.x - plate.width / 2, y: best.y - plate.height / 2, width: plate.width, height: plate.height });
      const labelX = x(best.x) - Math.round(plateW / 2);
      const labelY = y(best.y) - Math.round(EDGE_LABEL_H / 2);
      elements.push({
        id: `edge-${index}-label-bg`,
        type: "rect",
        name: `${edge.from} -> ${edge.to} label bg`,
        x: labelX,
        y: labelY,
        width: Math.round(plateW),
        height: EDGE_LABEL_H,
        rx: 4,
        fill: "#FFFFFF",
        stroke: "none",
        strokeWidth: 0
      });
      elements.push({
        id: `edge-${index}-label`,
        type: "text",
        name: `${edge.from} -> ${edge.to} label`,
        x: labelX,
        y: labelY,
        width: Math.round(plateW),
        height: EDGE_LABEL_H,
        text: edge.label,
        fontSize,
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
