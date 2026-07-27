// Centralized test: render every supported diagram type, assert all geometry is
// finite and inside the 1280x720 canvas.

import {
  layoutCycle,
  layoutFishbone,
  layoutFunnel,
  layoutGantt,
  layoutHierarchy,
  layoutMatrix,
  layoutMindmap,
  layoutPie,
  layoutBar,
  layoutLine,
  layoutPyramid,
  layoutScatter,
  layoutSwimlane,
  layoutTimeline,
  layoutVenn
} from "@/lib/layout-extra";
import type { SemanticDiagram } from "@/lib/semantic-types";
import { renderFigureSvg } from "@/lib/svg";
import type { Figure, FigureElement } from "@/lib/types";

const W = 1280;
const H = 720;
const TOL = 3;

type Case = { id: string; build: () => Figure };

const sub = (p: string, items: [string, string][]) => items.map(([id, label]) => ({ id, label, parent: p }));

const CASES: Case[] = [
  {
    id: "timeline",
    build: () =>
      layoutTimeline({
        type: "timeline",
        title: "路线图",
        language: "zh",
        nodes: [
          { id: "a", label: "立项", detail: "调研", parent: null },
          { id: "b", label: "研发", parent: null },
          { id: "c", label: "公测", parent: null },
          { id: "d", label: "商用", parent: null },
          { id: "e", label: "拓展", parent: null, dashed: true }
        ],
        edges: []
      })
  },
  {
    id: "pyramid",
    build: () =>
      layoutPyramid({
        type: "pyramid",
        title: "层级",
        language: "zh",
        direction: "vertical",
        nodes: [
          { id: "a", label: "愿景", parent: null },
          { id: "b", label: "战略", parent: null },
          { id: "c", label: "战术", parent: null },
          { id: "d", label: "执行", parent: null }
        ],
        edges: []
      })
  },
  {
    id: "matrix",
    build: () =>
      layoutMatrix({
        type: "matrix",
        title: "矩阵",
        language: "zh",
        axes: { xLabel: "影响->", yLabel: "^紧急" },
        nodes: [{ id: "m", label: "池", parent: null }, ...sub("m", [["q1", "立即"], ["q2", "计划"], ["q3", "快速"], ["q4", "暂缓"]])]
      } as unknown as SemanticDiagram)
  },
  {
    id: "hierarchy",
    build: () =>
      layoutHierarchy({
        type: "hierarchy",
        title: "组织",
        language: "zh",
        nodes: [
          { id: "ceo", label: "CEO", parent: null },
          ...sub("ceo", [["cto", "CTO"], ["cfo", "CFO"]]),
          ...sub("cto", [["fe", "前端"], ["be", "后端"]])
        ]
      } as unknown as SemanticDiagram)
  },
  {
    id: "cycle",
    build: () =>
      layoutCycle({
        type: "cycle",
        title: "PDCA",
        language: "zh",
        nodes: [
          { id: "p", label: "计划", parent: null },
          { id: "d", label: "执行", parent: null },
          { id: "c", label: "检查", parent: null },
          { id: "a", label: "处理", parent: null }
        ]
      } as unknown as SemanticDiagram)
  },
  {
    id: "funnel",
    build: () =>
      layoutFunnel({
        type: "funnel",
        title: "漏斗",
        language: "zh",
        nodes: [
          { id: "a", label: "访客", detail: "100k", parent: null },
          { id: "b", label: "注册", parent: null },
          { id: "c", label: "试用", parent: null },
          { id: "d", label: "付费", parent: null }
        ]
      } as unknown as SemanticDiagram)
  },
  {
    id: "venn",
    build: () =>
      layoutVenn({
        type: "venn",
        title: "交集",
        language: "zh",
        nodes: [
          { id: "a", label: "技术", parent: null },
          { id: "b", label: "产品", parent: null },
          { id: "c", label: "商业", parent: null }
        ]
      } as unknown as SemanticDiagram)
  },
  {
    id: "mindmap",
    build: () =>
      layoutMindmap({
        type: "mindmap",
        title: "脑图",
        language: "zh",
        nodes: [
          { id: "r", label: "产品", parent: null },
          { id: "b1", label: "用户", parent: "r" },
          { id: "b1a", label: "画像", parent: "b1" },
          { id: "b2", label: "功能", parent: "r" },
          { id: "b2a", label: "核心", parent: "b2" },
          { id: "b3", label: "商业", parent: "r" },
          { id: "b4", label: "运营", parent: "r" }
        ]
      } as unknown as SemanticDiagram)
  },
  {
    id: "fishbone",
    build: () =>
      layoutFishbone({
        type: "fishbone",
        title: "根因",
        language: "zh",
        nodes: [
          { id: "c1", label: "人员", parent: null },
          { id: "c1a", label: "经验", parent: "c1" },
          { id: "c2", label: "流程", parent: null },
          { id: "c3", label: "工具", parent: null },
          { id: "c4", label: "需求", parent: null },
          { id: "eff", label: "延期", parent: null }
        ]
      } as unknown as SemanticDiagram)
  },
  {
    id: "gantt",
    build: () =>
      layoutGantt({
        type: "gantt",
        title: "排期",
        language: "zh",
        nodes: [
          { id: "a", label: "设计", detail: "第1-2周", parent: null },
          { id: "b", label: "开发", detail: "第2-6周", parent: null },
          { id: "c", label: "测试", detail: "第5-8周", parent: null },
          { id: "d", label: "上线", detail: "第8-9周", parent: null }
        ]
      } as unknown as SemanticDiagram)
  },
  {
    id: "swimlane",
    build: () =>
      layoutSwimlane({
        type: "swimlane",
        title: "泳道",
        language: "zh",
        lanes: ["用户", "前端", "后端"],
        nodes: [
          { id: "s1", label: "提交", lane: "用户", parent: null },
          { id: "s2", label: "校验", lane: "前端", parent: null },
          { id: "s3", label: "处理", lane: "后端", parent: null },
          { id: "s4", label: "返回", lane: "前端", parent: null }
        ],
        edges: [{ from: "s1", to: "s2" }, { from: "s2", to: "s3" }, { from: "s3", to: "s4" }]
      } as unknown as SemanticDiagram)
  },
  {
    id: "pie",
    build: () => layoutPie({
      type: "pie", title: "占比", language: "zh", nodes: [
        { id: "a", label: "A", value: 50, parent: null },
        { id: "b", label: "B", value: 30, parent: null },
        { id: "c", label: "C", value: 20, parent: null }
      ]
    } as SemanticDiagram)
  },
  {
    id: "bar",
    build: () => layoutBar({
      type: "bar", title: "比较", language: "zh", nodes: [
        { id: "a", label: "A", value: 12, parent: null },
        { id: "b", label: "B", value: 30, parent: null },
        { id: "c", label: "C", value: 20, parent: null }
      ]
    } as SemanticDiagram)
  },
  {
    id: "line",
    build: () => layoutLine({
      type: "line", title: "趋势", language: "zh", nodes: [
        { id: "a", label: "1月", value: 12, parent: null },
        { id: "b", label: "2月", value: 30, parent: null },
        { id: "c", label: "3月", value: 20, parent: null }
      ]
    } as SemanticDiagram)
  },
  {
    id: "scatter",
    build: () =>
      layoutScatter({
        type: "scatter",
        title: "定位",
        language: "zh",
        axes: { xLabel: "成本->", yLabel: "^价值" },
        nodes: [
          { id: "a", label: "A", score: { x: 0.2, y: 0.8 }, parent: null },
          { id: "b", label: "B", score: { x: 0.7, y: 0.6 }, parent: null },
          { id: "c", label: "C", score: { x: 0.5, y: 0.3 }, parent: null }
        ]
      } as unknown as SemanticDiagram)
  }
];

function checkBounds(els: FigureElement[], bad: string[]): void {
  const test = (label: string, x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      bad.push(`${label}: non-finite (${x},${y})`);
    } else if (x < -TOL || y < -TOL || x > W + TOL || y > H + TOL) {
      bad.push(`${label}: out of canvas (${Math.round(x)},${Math.round(y)})`);
    }
  };

  for (const e of els) {
    if (e.type === "group") {
      checkBounds(e.children, bad);
      continue;
    }

    if (e.type === "rect" || e.type === "text") {
      test(e.id, e.x, e.y);
      if (e.type === "rect") test(`${e.id}.br`, e.x + e.width, e.y + e.height);
    } else if (e.type === "line" || e.type === "arrow") {
      test(`${e.id}.1`, e.x1, e.y1);
      test(`${e.id}.2`, e.x2, e.y2);
    } else if (e.type === "polygon" || e.type === "connector") {
      e.points.forEach((p, i) => test(`${e.id}.p${i}`, p.x, p.y));
    } else if (e.type === "ellipse") {
      test(`${e.id}.c`, e.cx, e.cy);
      test(`${e.id}.br`, e.cx + e.rx, e.cy + e.ry);
    }
  }
}

let allPass = true;
for (const c of CASES) {
  const bad: string[] = [];
  let svgLen = 0;

  try {
    const fig = c.build();
    if (fig.canvas.width !== W || fig.canvas.height !== H) bad.push(`canvas ${fig.canvas.width}x${fig.canvas.height}`);
    if (!fig.elements.length) bad.push("no elements");
    checkBounds(fig.elements, bad);
    svgLen = renderFigureSvg(fig).length;
    if (svgLen < 100) bad.push("svg too small");
  } catch (err) {
    bad.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  const ok = bad.length === 0;
  allPass = allPass && ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(10)} (svg ${svgLen}b)`);
  bad.slice(0, 4).forEach((b) => console.log(`        - ${b}`));
}

console.log(allPass ? `\nALL ${CASES.length} TYPES PASS` : "\nSOME FAILED");
if (!allPass) process.exitCode = 1;
