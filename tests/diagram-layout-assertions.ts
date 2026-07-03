// Layout-level regression test for all diagram types.
//
// Unlike a "field exists / HTTP 200" check, this drives the REAL pipeline
//   raw model JSON -> validateAndNormalizeSemanticDiagram -> layoutDiagram -> renderFigureSvg
// and asserts the *geometry* is correct. It therefore catches data that gets
// silently dropped in validation (e.g. swimlane `lane`/`lanes`, scatter `score`,
// gantt `start`/`end`, matrix `axes`) — the class of bug that makes swimlanes
// collapse to one lane or scatter points pile up at the centre.
//
// Run:  node --experimental-strip-types tests/diagram-layout-assertions.ts
// Exit code is non-zero if any case fails (CI-friendly).

import { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";
import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { layoutDiagram } from "@/lib/layout-engine";
import { renderFigureSvg } from "@/lib/svg";
import type { Figure, FigureElement } from "@/lib/types";
import type { SkillId } from "@/lib/types";

const W = 1280;
const H = 720;
const TOL = 3;

// ---- helpers ---------------------------------------------------------------
function flatten(els: FigureElement[], out: FigureElement[] = []): FigureElement[] {
  for (const e of els) {
    out.push(e);
    if (e.type === "group") flatten(e.children, out);
  }
  return out;
}

function inCanvasIssues(els: FigureElement[]): string[] {
  const bad: string[] = [];
  const t = (id: string, x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) bad.push(`${id}: non-finite`);
    else if (x < -TOL || y < -TOL || x > W + TOL || y > H + TOL) bad.push(`${id}: out of canvas (${Math.round(x)},${Math.round(y)})`);
  };
  for (const e of flatten(els)) {
    if (e.type === "rect" || e.type === "text") { t(e.id, e.x, e.y); if (e.type === "rect") t(e.id + ".br", e.x + e.width, e.y + e.height); }
    else if (e.type === "line" || e.type === "arrow") { t(e.id + ".1", e.x1, e.y1); t(e.id + ".2", e.x2, e.y2); }
    else if (e.type === "polygon" || e.type === "connector") e.points.forEach((p, i) => t(`${e.id}.p${i}`, p.x, p.y));
    else if (e.type === "ellipse") { t(e.id + ".c", e.cx, e.cy); t(e.id + ".br", e.cx + e.rx, e.cy + e.ry); }
  }
  return bad;
}

const byPrefix = (els: FigureElement[], prefix: string) => flatten(els).filter((e) => e.id.startsWith(prefix));
const distinct = (xs: Array<string | number>) => new Set(xs.map(String)).size;

// ---- cases: raw model-style input + per-type assertions --------------------
interface Case {
  id: string;
  skill: SkillId;
  raw: Record<string, unknown>;
  assert: (fig: Figure, svg: string) => string[];
}

const CASES: Case[] = [
  {
    id: "flow-connectors", skill: "flow",
    raw: { type: "flow", title: "系统访问", language: "zh", direction: "horizontal", nodes: [
      { id: "a", label: "A系统", parent: null }, { id: "b", label: "X中间件", parent: null }, { id: "c", label: "C系统", parent: null }
    ], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] },
    assert: (fig) => {
      const bad: string[] = [];
      const edgeElements = byPrefix(fig.elements, "edge-");
      const connectors = edgeElements.filter((e) => e.type === "connector");
      const splitPieces = edgeElements.filter((e) => /-(seg-\d+|head)$/.test(e.id));
      if (connectors.length !== 2) bad.push(`expected 2 connector edges, got ${connectors.length}`);
      if (splitPieces.length) bad.push(`edges should not be split into line/arrow pieces, got ${splitPieces.map((e) => e.id).join(", ")}`);
      return bad;
    }
  },
  {
    id: "swimlane", skill: "swimlane",
    raw: { type: "swimlane", title: "退款流程", language: "zh", lanes: ["用户", "客服", "财务", "系统"], nodes: [
      { id: "n1", label: "提交退款", lane: "用户", parent: null }, { id: "n2", label: "校验订单", lane: "系统", parent: null },
      { id: "n3", label: "审核原因", lane: "客服", parent: null }, { id: "n4", label: "复核金额", lane: "财务", parent: null },
      { id: "n5", label: "原路退款", lane: "系统", parent: null }, { id: "n6", label: "到账通知", lane: "用户", parent: null }
    ], edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n3", to: "n4" }, { from: "n4", to: "n5" }, { from: "n5", to: "n6" }] },
    assert: (fig) => {
      const bad: string[] = [];
      const bands = byPrefix(fig.elements, "lane-bg-").length;
      if (bands !== 4) bad.push(`expected 4 lane bands, got ${bands} (lane/lanes likely dropped in validation)`);
      const rows = distinct(byPrefix(fig.elements, "lane-node-").filter((e) => e.type === "group").map((g) => (g.type === "group" ? (g.children.find((c) => c.type === "rect") as { y?: number })?.y ?? 0 : 0)));
      if (rows < 3) bad.push(`nodes occupy only ${rows} distinct rows (expected ≥3 lanes used)`);
      const connectors = byPrefix(fig.elements, "lane-e").filter((e) => e.type === "connector").length;
      if (connectors !== 5) bad.push(`expected 5 one-piece swimlane connectors, got ${connectors}`);
      const normalized = validateAndNormalizeFigureResponse({ figure: fig }, "swimlane", "zh");
      const laneName = normalized.response ? flatten(normalized.response.figure.elements).find((e) => e.id === "lane-name-0") : undefined;
      if (!laneName || laneName.type !== "text") {
        bad.push("lane-name-0 missing after figure export normalization");
      } else if (laneName.textAnchor !== "start" || laneName.x > 100) {
        bad.push(`lane-name-0 should stay left aligned after export normalization, got anchor=${laneName.textAnchor} x=${laneName.x}`);
      }
      return bad;
    }
  },
  {
    id: "kanban", skill: "kanban",
    raw: { type: "kanban", title: "迭代看板", language: "zh", lanes: ["待办", "进行中", "已完成"], nodes: [
      { id: "t1", label: "登录改版", detail: "支持第三方登录", lane: "待办", parent: null },
      { id: "t2", label: "支付对接", detail: "接入微信/支付宝", lane: "待办", parent: null },
      { id: "t3", label: "搜索优化", detail: "召回率提升", lane: "进行中", parent: null },
      { id: "t4", label: "埋点上报", lane: "进行中", parent: null },
      { id: "t5", label: "首页重构", detail: "已灰度发布", lane: "已完成", parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const cols = byPrefix(fig.elements, "kanban-col-").length;
      if (cols !== 3) bad.push(`expected 3 kanban columns, got ${cols} (lane/lanes likely dropped)`);
      const cardGroups = byPrefix(fig.elements, "kanban-card-").filter((e) => e.type === "group");
      if (cardGroups.length !== 5) bad.push(`expected 5 kanban cards, got ${cardGroups.length}`);
      const cardX = distinct(cardGroups.map((g) => (g.type === "group" ? Math.round(((g.children.find((c) => c.type === "rect") as { x?: number })?.x ?? 0) / 20) : 0)));
      if (cardX < 3) bad.push(`cards occupy only ${cardX} distinct columns (expected 3)`);
      return bad;
    }
  },
  {
    id: "network", skill: "network",
    raw: { type: "network", title: "系统关系", language: "zh", nodes: [
      { id: "a", label: "订单服务", parent: null, emphasis: "primary" },
      { id: "b", label: "支付服务", parent: null },
      { id: "c", label: "库存服务", parent: null },
      { id: "d", label: "用户服务", parent: null }
    ], edges: [
      { from: "a", to: "b", label: "调用" }, { from: "a", to: "c", label: "扣减" },
      { from: "a", to: "d", label: "校验" }, { from: "b", to: "d" }
    ] },
    assert: (fig) => {
      const bad: string[] = [];
      const cards = byPrefix(fig.elements, "net-node-").filter((e) => e.type === "group").length;
      if (cards !== 4) bad.push(`expected 4 network nodes, got ${cards}`);
      const conns = byPrefix(fig.elements, "net-edge-").filter((e) => e.type === "connector").length;
      if (conns !== 4) bad.push(`expected 4 network edges, got ${conns}`);
      const labels = byPrefix(fig.elements, "net-edge-").filter((e) => e.type === "text").length;
      if (labels !== 3) bad.push(`expected 3 network edge labels, got ${labels}`);
      return bad;
    }
  },
  {
    id: "scatter", skill: "scatter",
    raw: { type: "scatter", title: "项目定位", language: "zh", axes: { xLabel: "成本", yLabel: "价值" }, nodes: [
      { id: "a", label: "A", score: { x: "20", y: "80" }, parent: null }, { id: "b", label: "B", score: { x: "70", y: "60" }, parent: null },
      { id: "c", label: "C", score: { x: "50", y: "30" }, parent: null }, { id: "d", label: "D", score: { x: "85", y: "85" }, parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const dots = byPrefix(fig.elements, "scatter-dot-").filter((e) => e.type === "ellipse") as Array<{ cx: number; cy: number }>;
      if (dots.length !== 4) bad.push(`expected 4 points, got ${dots.length}`);
      const uniq = distinct(dots.map((d) => `${Math.round(d.cx)},${Math.round(d.cy)}`));
      if (uniq !== dots.length) bad.push(`points not distinct (${uniq}/${dots.length}) — score likely dropped, all at centre`);
      if (!byPrefix(fig.elements, "scatter-xlabel").length) bad.push("missing x axis label (axes dropped)");
      return bad;
    }
  },
  {
    id: "gantt", skill: "gantt",
    raw: { type: "gantt", title: "排期", language: "zh", nodes: [
      { id: "a", label: "设计", detail: "第1-2周", parent: null }, { id: "b", label: "开发", detail: "第2-6周", parent: null },
      { id: "c", label: "测试", detail: "第5-8周", parent: null }, { id: "d", label: "上线", detail: "第8-9周", parent: null }
    ], edges: [] },
    assert: (fig, svg) => {
      const bad: string[] = [];
      const realBars = byPrefix(fig.elements, "gantt-bar-").filter((e) => e.type === "rect") as Array<{ x: number; width: number }>;
      if (realBars.length !== 4) bad.push(`expected 4 bars, got ${realBars.length}`);
      if (distinct(realBars.map((b) => Math.round(b.x))) < 3) bad.push("bar start positions not differentiated — start/end likely dropped");
      if (distinct(realBars.map((b) => Math.round(b.width))) < 2) bad.push("bar widths uniform — end likely dropped");
      if (byPrefix(fig.elements, "gantt-bar-detail-").length) bad.push("gantt bar should not render long detail text inside bars");
      if (svg.includes("...")) bad.push("gantt SVG should not contain ellipsis-only or truncated bar text");
      return bad;
    }
  },
  {
    id: "matrix", skill: "matrix",
    raw: { type: "matrix", title: "优先级", language: "zh", axes: { xLabel: "影响", yLabel: "紧急" }, nodes: [
      { id: "m", label: "池", parent: null }, { id: "q1", label: "立即", parent: "m" }, { id: "q2", label: "计划", parent: "m" },
      { id: "q3", label: "快速", parent: "m" }, { id: "q4", label: "暂缓", parent: "m" }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const cells = byPrefix(fig.elements, "matrix-").filter((e) => e.type === "rect" && /matrix-\d+-rect/.test(e.id)).length;
      if (cells !== 4) bad.push(`expected 4 quadrants, got ${cells}`);
      if (!byPrefix(fig.elements, "matrix-xlabel").length) bad.push("missing axis label (axes dropped)");
      return bad;
    }
  },
  {
    id: "timeline", skill: "timeline",
    raw: { type: "timeline", title: "路线", language: "zh", nodes: [
      { id: "a", label: "立项", parent: null }, { id: "b", label: "研发", parent: null }, { id: "c", label: "公测", parent: null }, { id: "d", label: "商用", parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const dots = byPrefix(fig.elements, "timeline-dot-").filter((e) => e.type === "rect") as Array<{ x: number }>;
      if (dots.length !== 4) bad.push(`expected 4 milestones, got ${dots.length}`);
      const xs = dots.map((d) => d.x);
      for (let i = 1; i < xs.length; i += 1) if (xs[i] <= xs[i - 1]) bad.push("milestones not left-to-right increasing");
      return bad;
    }
  },
  {
    id: "pyramid", skill: "pyramid",
    raw: { type: "pyramid", title: "层级", language: "zh", direction: "vertical", nodes: [
      { id: "a", label: "愿景", parent: null }, { id: "b", label: "战略", parent: null }, { id: "c", label: "战术", parent: null }, { id: "d", label: "执行", parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const rects = (byPrefix(fig.elements, "pyramid-").filter((e) => e.type === "rect" && /pyramid-\d+-rect/.test(e.id)) as Array<{ width: number }>);
      if (rects.length !== 4) bad.push(`expected 4 tiers, got ${rects.length}`);
      for (let i = 1; i < rects.length; i += 1) if (rects[i].width <= rects[i - 1].width) bad.push("tier widths not increasing top→bottom");
      return bad;
    }
  },
  {
    id: "hierarchy", skill: "hierarchy",
    raw: { type: "hierarchy", title: "组织", language: "zh", nodes: [
      { id: "ceo", label: "CEO", parent: null }, { id: "cto", label: "CTO", parent: "ceo" }, { id: "cfo", label: "CFO", parent: "ceo" },
      { id: "fe", label: "前端", parent: "cto" }, { id: "be", label: "后端", parent: "cto" }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const rects = byPrefix(fig.elements, "htree-").filter((e) => e.type === "rect" && /htree-\d+-rect/.test(e.id)) as Array<{ y: number }>;
      if (rects.length !== 5) bad.push(`expected 5 nodes, got ${rects.length}`);
      if (distinct(rects.map((r) => Math.round(r.y))) < 3) bad.push("expected ≥3 depth levels (tree not laid out)");
      return bad;
    }
  },
  {
    id: "cycle", skill: "cycle",
    raw: { type: "cycle", title: "PDCA", language: "zh", nodes: [
      { id: "p", label: "计划", parent: null }, { id: "d", label: "执行", parent: null }, { id: "c", label: "检查", parent: null }, { id: "a", label: "处理", parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const nodes = byPrefix(fig.elements, "cycle-").filter((e) => e.type === "rect" && /cycle-\d+-rect/.test(e.id)).length;
      const arrows = byPrefix(fig.elements, "cycle-arrow-").filter((e) => e.type === "arrow").length;
      if (nodes !== 4) bad.push(`expected 4 nodes, got ${nodes}`);
      if (arrows !== 4) bad.push(`expected 4 closed-loop arrows, got ${arrows}`);
      return bad;
    }
  },
  {
    id: "funnel", skill: "funnel",
    raw: { type: "funnel", title: "漏斗", language: "zh", nodes: [
      { id: "a", label: "访客", parent: null }, { id: "b", label: "注册", parent: null }, { id: "c", label: "试用", parent: null }, { id: "d", label: "付费", parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const polys = byPrefix(fig.elements, "funnel-").filter((e) => e.type === "polygon") as Array<{ points: { x: number }[] }>;
      if (polys.length !== 4) bad.push(`expected 4 trapezoids, got ${polys.length}`);
      const topWidths = polys.map((p) => Math.abs(p.points[1].x - p.points[0].x));
      for (let i = 1; i < topWidths.length; i += 1) if (topWidths[i] > topWidths[i - 1] + 1) bad.push("funnel not tapering downward");
      return bad;
    }
  },
  {
    id: "venn", skill: "venn",
    raw: { type: "venn", title: "交集", language: "zh", nodes: [
      { id: "a", label: "技术", parent: null }, { id: "b", label: "产品", parent: null }, { id: "c", label: "商业", parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      const sets = byPrefix(fig.elements, "venn-").filter((e) => e.type === "ellipse").length;
      if (sets !== 3) bad.push(`expected 3 set circles, got ${sets}`);
      return bad;
    }
  },
  {
    id: "mindmap", skill: "mindmap",
    raw: { type: "mindmap", title: "脑图", language: "zh", nodes: [
      { id: "r", label: "产品", parent: null }, { id: "b1", label: "用户", parent: "r" }, { id: "b2", label: "功能", parent: "r" },
      { id: "b3", label: "商业", parent: "r" }, { id: "b1a", label: "画像", parent: "b1" }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      if (!flatten(fig.elements).some((e) => e.id === "mind-center" && e.type === "ellipse")) bad.push("missing center node");
      const branches = byPrefix(fig.elements, "mind-br-").filter((e) => e.type === "rect" && /mind-br-\d+-rect/.test(e.id)).length;
      if (branches !== 3) bad.push(`expected 3 branches, got ${branches}`);
      return bad;
    }
  },
  {
    id: "fishbone", skill: "fishbone",
    raw: { type: "fishbone", title: "根因", language: "zh", nodes: [
      { id: "c1", label: "人员", parent: null }, { id: "c2", label: "流程", parent: null }, { id: "c3", label: "工具", parent: null },
      { id: "c4", label: "需求", parent: null }, { id: "eff", label: "延期", parent: null }
    ], edges: [] },
    assert: (fig) => {
      const bad: string[] = [];
      if (!flatten(fig.elements).some((e) => e.id === "fish-spine" && e.type === "line")) bad.push("missing spine");
      const cats = byPrefix(fig.elements, "fish-cat-").filter((e) => e.type === "rect" && /fish-cat-\d+-rect/.test(e.id)).length;
      if (cats !== 4) bad.push(`expected 4 cause categories, got ${cats}`);
      return bad;
    }
  }
];

// ---- run -------------------------------------------------------------------
let allPass = true;
for (const c of CASES) {
  const failures: string[] = [];
  try {
    const v = validateAndNormalizeSemanticDiagram({ diagram: c.raw }, c.skill, "zh");
    if (!v.ok || !v.diagram) {
      failures.push("validation failed: " + v.errors.slice(0, 3).join("; "));
    } else {
      const fig = layoutDiagram(v.diagram);
      const svg = renderFigureSvg(fig);
      failures.push(...inCanvasIssues(fig.elements));
      failures.push(...c.assert(fig, svg));
      if (svg.length < 100) failures.push("svg too small / failed to render");
    }
  } catch (err) {
    failures.push("threw: " + (err instanceof Error ? err.message : String(err)));
  }
  const ok = failures.length === 0;
  allPass = allPass && ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id}`);
  failures.slice(0, 5).forEach((f) => console.log("        - " + f));
}
console.log(allPass ? "\nALL DIAGRAM LAYOUT ASSERTIONS PASS ✅" : "\nSOME FAILED ❌");
if (!allPass) process.exitCode = 1;
