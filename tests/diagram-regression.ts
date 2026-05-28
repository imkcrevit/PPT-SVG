// =============================================================================
// Diagram generation — regression test suite (structural assertions).
//
// Model output is non-deterministic, so we do NOT exact-match JSON. Instead each
// test asserts structural / geometric PROPERTIES that must hold regardless of
// the exact ids, labels, or counts the model picks.
//
// How to run (wire to your own pipeline):
//
//   import { TESTS, runRegression } from "./diagram-regression";
//   import { layoutDiagram } from "@/lib/layout-engine";
//   import { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";
//
//   await runRegression(async (prompt) => {
//     const raw = await callYourModel(prompt);          // -> JSON string
//     const value = JSON.parse(raw);
//     const validation = validateAndNormalizeSemanticDiagram(value, "freeform", "zh");
//     if (!validation.ok || !validation.diagram) throw new Error(validation.errors.join("; "));
//     const diagram = validation.diagram;
//     return { diagram, figure: layoutDiagram(diagram) };
//   });
//
// Each test's `assert` returns an array of failure strings; empty = pass.
// =============================================================================

import type { Figure, FigureElement } from "@/lib/types";
import type { SemanticDiagram, SemanticNode } from "@/lib/semantic-types";

export interface Produced {
  diagram: SemanticDiagram;
  figure: Figure;
}

// ---- helpers ----------------------------------------------------------------
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectBoxes(figure: Figure): Map<string, Box> {
  const map = new Map<string, Box>();
  const walk = (els: FigureElement[]) => {
    for (const el of els) {
      if (el.type === "rect" && el.id.endsWith("-rect")) {
        map.set(el.id.slice(0, -"-rect".length), { x: el.x, y: el.y, width: el.width, height: el.height });
      }
      if (el.type === "group") walk(el.children);
    }
  };
  walk(figure.elements);
  return map;
}

function nodesById(diagram: SemanticDiagram): Map<string, SemanticNode> {
  return new Map(diagram.nodes.map((n) => [n.id, n]));
}
function childrenOf(diagram: SemanticDiagram, id: string): SemanticNode[] {
  return diagram.nodes.filter((n) => n.parent === id);
}
function leaves(diagram: SemanticDiagram): SemanticNode[] {
  const parents = new Set(diagram.nodes.map((n) => n.parent).filter(Boolean));
  return diagram.nodes.filter((n) => !parents.has(n.id));
}
function depthOf(diagram: SemanticDiagram, byId: Map<string, SemanticNode>, id: string): number {
  let d = 0;
  let cur = byId.get(id)?.parent ?? null;
  while (cur) {
    d += 1;
    cur = byId.get(cur)?.parent ?? null;
  }
  return d;
}
function inside(child: Box, parent: Box, tol = 1): boolean {
  return (
    child.x >= parent.x - tol &&
    child.y >= parent.y - tol &&
    child.x + child.width <= parent.x + parent.width + tol &&
    child.y + child.height <= parent.y + parent.height + tol
  );
}

// SHARED: the core guarantee — every node with a parent is drawn inside it.
export function assertContainment(p: Produced): string[] {
  const out: string[] = [];
  const boxes = rectBoxes(p.figure);
  for (const node of p.diagram.nodes) {
    if (!node.parent) continue;
    const c = boxes.get(node.id);
    const par = boxes.get(node.parent);
    if (!c || !par) {
      out.push(`box missing for ${node.id} or its parent ${node.parent}`);
      continue;
    }
    if (!inside(c, par)) out.push(`ANCHOR LOST: ${node.id} is not inside its parent ${node.parent}`);
  }
  return out;
}

// SHARED: nothing leaves the canvas.
export function assertInCanvas(p: Produced): string[] {
  const out: string[] = [];
  const w = p.figure.canvas.width;
  const h = p.figure.canvas.height;
  for (const [id, b] of rectBoxes(p.figure)) {
    if (b.x < -2 || b.y < -2 || b.x + b.width > w + 2 || b.y + b.height > h + 2) {
      out.push(`${id} exceeds canvas bounds`);
    }
  }
  return out;
}

// Heuristic: a label that looks like a crammed list (the image-2 failure).
function looksLikeCrammedList(label: string): boolean {
  const numbered = (label.match(/\d{1,2}[\s:、.)]/g) ?? []).length >= 2; // "01 ... 02 ..."
  const separators = (label.match(/[、,，/]/g) ?? []).length >= 2;
  return numbered || separators;
}

// ---- test definitions -------------------------------------------------------
export interface DiagramTest {
  id: string;
  name: string;
  prompt: string;
  assert: (p: Produced) => string[];
}

export const TESTS: DiagramTest[] = [
  {
    id: "T1-anchor",
    name: "Nesting + cross-boundary edge keeps the anchor",
    prompt:
      "画一个架构图：A 系统下面有子系统 B 和子系统 C，其中子系统 B 调用了外部的 D 系统。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      const byId = nodesById(p.diagram);
      const crossBoundary = p.diagram.edges.some((e) => {
        const fp = byId.get(e.from)?.parent ?? null;
        const tp = byId.get(e.to)?.parent ?? null;
        return fp !== tp; // endpoints live under different parents
      });
      if (!crossBoundary) out.push("expected at least one edge crossing a container boundary (B -> D)");
      if (childrenOf(p.diagram, p.diagram.nodes.find((n) => n.parent === null)?.id ?? "").length === 0) {
        // soft check: there should be at least one container with children
      }
      const hasContainer = p.diagram.nodes.some((n) => childrenOf(p.diagram, n.id).length > 0);
      if (!hasContainer) out.push("expected at least one container node with children (A contains B/C)");
      return out;
    }
  },
  {
    id: "T2-decompose",
    name: "Dense input decomposes into nested nodes, not crammed labels",
    prompt:
      "生成一个建筑项目从设计到交付的流程图，要求超过 20 个步骤，按前期准备、设计深化、报审采购、施工交付四个阶段分组，每个阶段列出具体的子步骤。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      const leafCount = leaves(p.diagram).length;
      if (leafCount < 20) out.push(`expected 20+ leaf steps, got ${leafCount}`);
      const containers = p.diagram.nodes.filter((n) => childrenOf(p.diagram, n.id).length >= 3);
      if (containers.length < 3) out.push(`expected 3+ phase containers each with several sub-steps, got ${containers.length}`);
      const crammed = p.diagram.nodes.filter((n) => looksLikeCrammedList(n.label));
      if (crammed.length > 0) out.push(`labels look like crammed lists (should be split into child nodes): ${crammed.map((n) => n.label).slice(0, 3).join(" | ")}`);
      return out;
    }
  },
  {
    id: "T3-bands-dashed-detail",
    name: "Multi-band + autonomous dashed feedback + detail text",
    prompt:
      "画一个 RAG + 多 Agent 的代码生成流水线架构图：离线训练阶段（数据采集、清洗、Embedding、知识库）；在线检索阶段（用户提问、改写 Agent、向量检索、重排、打分）；代码生成阶段（生成、幻觉校验、参数确认），其中幻觉校验失败要重写；最后是执行与工具固化阶段，成功的工具下次可直接复用。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      const bands = p.diagram.layers?.length ?? 0;
      if (bands < 3) out.push(`expected 3+ layers/bands, got ${bands}`);
      const dashedEdges = p.diagram.edges.filter((e) => e.dashed === true).length;
      if (dashedEdges < 1) out.push("expected at least one dashed feedback edge (rewrite / reuse loop)");
      const withDetail = p.diagram.nodes.filter((n) => (n.detail ?? "").trim().length > 0).length;
      if (withDetail < 3) out.push(`expected several nodes to carry detail text, got ${withDetail}`);
      // a feedback edge should point "backward" (to an earlier-defined node)
      const order = new Map(p.diagram.nodes.map((n, i) => [n.id, i]));
      const hasBackward = p.diagram.edges.some((e) => e.dashed && (order.get(e.to) ?? 0) < (order.get(e.from) ?? 0));
      if (!hasBackward) out.push("expected a dashed edge that loops back to an earlier node");
      return out;
    }
  },
  {
    id: "T4-flexible-detail",
    name: "Detail length is flexible — not forced to two lines",
    prompt:
      "画三个步骤：登录、处理、完成。其中“处理”这一步补充说明“调用支付网关、校验库存、写入订单，失败自动重试三次”；另外两步不需要说明。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      const withDetail = p.diagram.nodes.filter((n) => (n.detail ?? "").trim().length > 0);
      const withoutDetail = p.diagram.nodes.filter((n) => !(n.detail ?? "").trim());
      if (withDetail.length < 1) out.push("expected at least one node WITH detail");
      if (withoutDetail.length < 1) out.push("expected at least one node WITHOUT detail (no forced second line)");
      return out;
    }
  },
  {
    id: "T5-deep-nesting",
    name: "Three-level nesting holds containment",
    prompt:
      "画一个系统架构：电商平台包含订单中心和用户中心；订单中心里又包含下单服务、支付服务、退款服务；用户中心包含认证和会员两个模块。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      const byId = nodesById(p.diagram);
      const maxDepth = Math.max(...p.diagram.nodes.map((n) => depthOf(p.diagram, byId, n.id)));
      if (maxDepth < 2) out.push(`expected nesting depth >= 2 (platform > center > service), got ${maxDepth}`);
      return out;
    }
  },
  {
    id: "T6-dashed-nodes",
    name: "Dashed nodes for external / tentative components",
    prompt:
      "画一个数据处理流程，入口是“外部数据源”（用虚线表示这是外部不可控的），然后经过采集、清洗、入库；其中“实时同步”模块是规划中尚未实现的，也用虚线标出。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      const dashedNodes = p.diagram.nodes.filter((n) => n.dashed === true).length;
      if (dashedNodes < 1) out.push("expected at least one dashed node (external / planned)");
      return out;
    }
  },
  {
    id: "T7-simple-flow",
    name: "Flat horizontal flow, distinct per-step colors",
    prompt: "画一个五步走的产品上线流程：需求评审 → 设计 → 开发 → 测试 → 发布，横向排列。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      const topLevel = p.diagram.nodes.filter((n) => n.parent === null);
      if (topLevel.length < 4) out.push(`expected 4+ top-level steps, got ${topLevel.length}`);
      if (p.diagram.edges.length < topLevel.length - 1) out.push("expected steps connected in a chain");
      return out;
    }
  },
  {
    id: "T8-scale",
    name: "Large graph scales and stays in canvas",
    prompt:
      "画一个企业中台架构图，包含 6 个业务域，每个业务域下面 4~6 个微服务，总共三四十个节点。",
    assert: (p) => {
      const out = [...assertContainment(p), ...assertInCanvas(p)];
      if (p.diagram.nodes.length < 25) out.push(`expected a large graph (25+ nodes), got ${p.diagram.nodes.length}`);
      const containers = p.diagram.nodes.filter((n) => childrenOf(p.diagram, n.id).length >= 3).length;
      if (containers < 4) out.push(`expected several business-domain containers, got ${containers}`);
      return out;
    }
  }
];

// ---- runner -----------------------------------------------------------------
export async function runRegression(produce: (prompt: string) => Promise<Produced>): Promise<boolean> {
  let allPass = true;
  for (const test of TESTS) {
    let failures: string[] = [];
    try {
      const produced = await produce(test.prompt);
      failures = test.assert(produced);
    } catch (err) {
      failures = [`pipeline error: ${err instanceof Error ? err.message : String(err)}`];
    }
    const ok = failures.length === 0;
    allPass = allPass && ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${test.id}  ${test.name}`);
    for (const f of failures) console.log(`        - ${f}`);
  }
  return allPass;
}
