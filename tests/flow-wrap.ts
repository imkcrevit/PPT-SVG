// Verifier + fixtures for multi-row flow layout. Detects connectors that cut
// THROUGH node boxes (real overlap) vs merely touching a border (endpoints).
// Run: npm run test:flow-wrap

import { layoutDiagram } from "@/lib/layout-engine";
import { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";

type Rect = { x: number; y: number; w: number; h: number; id: string };
type Seg = { x1: number; y1: number; x2: number; y2: number };

function flatten(els: any[], out: any[] = []): any[] {
  for (const e of els) {
    if (e.type === "group") flatten(e.children ?? [], out);
    else out.push(e);
  }
  return out;
}

// Node cards: stroked rects in a plausible node size (excludes canvas bg, thin
// rules, and tiny edge-label backgrounds).
function nodeRects(els: any[]): Rect[] {
  return flatten(els)
    .filter(
      (e) =>
        e.type === "rect" &&
        e.stroke &&
        e.stroke !== "none" &&
        e.width >= 40 &&
        e.width <= 520 &&
        e.height >= 28 &&
        e.height <= 260
    )
    .map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height, id: e.name ?? e.id }));
}

function connectorSegs(els: any[]): Seg[] {
  const segs: Seg[] = [];
  for (const e of flatten(els)) {
    if (e.type !== "connector" && e.type !== "arrow" && e.type !== "line") continue;
    if (e.type === "connector") {
      const p = e.points as { x: number; y: number }[];
      for (let i = 0; i + 1 < p.length; i++) segs.push({ x1: p[i].x, y1: p[i].y, x2: p[i + 1].x, y2: p[i + 1].y });
    } else {
      segs.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
    }
  }
  return segs;
}

// Segment vs axis-aligned rect (rect shrunk by inset so border touches don't
// count). Liang–Barsky clip.
function segHitsRect(s: Seg, r: Rect, inset: number): boolean {
  const xmin = r.x + inset,
    xmax = r.x + r.w - inset,
    ymin = r.y + inset,
    ymax = r.y + r.h - inset;
  if (xmax <= xmin || ymax <= ymin) return false;
  let t0 = 0,
    t1 = 1;
  const dx = s.x2 - s.x1,
    dy = s.y2 - s.y1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (clip(-dx, s.x1 - xmin) && clip(dx, xmax - s.x1) && clip(-dy, s.y1 - ymin) && clip(dy, ymax - s.y1)) {
    return t0 < t1;
  }
  return false;
}

export function overlaps(figure: { elements: any[] }): { count: number; hits: string[] } {
  const rects = nodeRects(figure.elements);
  const segs = connectorSegs(figure.elements);
  let count = 0;
  const hits: string[] = [];
  for (const s of segs) {
    for (const r of rects) {
      if (segHitsRect(s, r, 8)) {
        count++;
        if (hits.length < 10) hits.push(r.id);
      }
    }
  }
  return { count, hits: [...new Set(hits)] };
}

function chainFlow(n: number, backEdges: Array<[number, number]> = []) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `阶段${i + 1}`, detail: i % 2 ? "说明文字" : undefined }));
  const edges = [
    ...Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
    ...backEdges.map(([a, b]) => ({ from: `n${a}`, to: `n${b}`, label: "回环" }))
  ];
  const v = validateAndNormalizeSemanticDiagram({ type: "flow", title: "T", language: "zh", nodes, edges } as any, "flow", "zh");
  return layoutDiagram(v.diagram!, {});
}

// The reported real shape: a tall container node first, then a chain of stages,
// with a feedback edge from the last stage back to an early one.
function containerFlow() {
  const nodes = [
    { id: "hf", label: "高频任务" },
    ...["效果图", "分析图", "方案图", "视频", "海报", "PPT", "招投标"].map((l, i) => ({ id: `c${i}`, label: l, parent: "hf" })),
    { id: "input", label: "任务输入", detail: "标准步骤、输入模板" },
    { id: "ai", label: "AI处理" },
    { id: "review", label: "专业复核", detail: "审核节点" },
    { id: "output", label: "成果输出", detail: "成果示例" },
    { id: "store", label: "案例入库" },
    { id: "pilot", label: "典型项目深度试点" }
  ];
  const edges = [
    { from: "hf", to: "input", label: "进入" }, { from: "input", to: "ai", label: "提交" },
    { from: "ai", to: "review", label: "生成" }, { from: "review", to: "output", label: "确认" },
    { from: "output", to: "store", label: "沉淀" }, { from: "store", to: "pilot" },
    { from: "pilot", to: "input", label: "验证" }
  ];
  const v = validateAndNormalizeSemanticDiagram({ type: "flow", title: "标准化工作流", language: "zh", nodes, edges } as any, "flow", "zh");
  return layoutDiagram(v.diagram!, {});
}

const cases: Array<[string, any]> = [
  ["container+chain+feedback", containerFlow()],
  ["chain-4", chainFlow(4)],
  ["chain-6", chainFlow(6)],
  ["chain-7", chainFlow(7)],
  ["chain-8", chainFlow(8)],
  ["chain-10", chainFlow(10)],
  ["chain-7 +feedback(6->1)", chainFlow(7, [[6, 1]])],
  ["chain-8 +feedback(7->0)", chainFlow(8, [[7, 0]])],
  ["chain-10 +2back", chainFlow(10, [[9, 0], [5, 2]])]
];

let fail = 0;
for (const [name, fig] of cases) {
  const o = overlaps(fig);
  const status = o.count === 0 ? "PASS" : "FAIL";
  if (o.count) fail++;
  console.log(`${status}  ${name.padEnd(26)} overlaps=${o.count}${o.count ? " via " + o.hits.join(",") : ""}`);
}
console.log(fail ? `\n${fail} case(s) with overlap ❌` : "\nNO CONNECTOR-NODE OVERLAPS ✅");
if (fail) process.exit(1);
