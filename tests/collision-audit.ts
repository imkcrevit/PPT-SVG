// Collision regression: compiles realistic semantic diagrams of every supported
// type (sized like real model output, not toy 3-node samples), audits the final
// geometry for overlapping / clipped text and shapes, then re-audits each one as
// a deck slide under every built-in template so the slide chrome (title, rule,
// footer) never collides with the diagram body. Run: npm run test:collisions

import { layoutDiagram } from "@/lib/layout-engine";
import { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";
import type { SemanticDiagram } from "@/lib/semantic-types";
import type { Figure, FigureElement, SkillId } from "@/lib/types";
import { DECK_TEMPLATES, withDeckChrome } from "@/features/deck/template";
import type { DeckPalette } from "@/features/deck/types";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderFigureSvg } from "@/lib/svg";

import { FIXTURES } from "./fixtures";
import { auditFigure, renderedTextBox, type Issue } from "./figure-collisions";

type Node = SemanticDiagram["nodes"][number];
const n = (id: string, label: string, parent: string | null = null, extra: Partial<Node> = {}): Node => ({ id, label, parent, ...extra });
const kids = (parent: string, labels: string[]) => labels.map((label, i) => n(`${parent}-${i}`, label, parent));

const CASES: Array<{ id: string; diagram: Omit<SemanticDiagram, "language"> & { language?: "zh" | "en" } }> = [
  {
    id: "hierarchy-org",
    diagram: {
      type: "hierarchy",
      title: "集团数字化组织架构",
      nodes: [
        n("ceo", "数字化委员会"),
        n("a", "数据中心", "ceo"),
        n("b", "应用研发部", "ceo"),
        n("c", "基础设施部", "ceo"),
        n("d", "安全合规部", "ceo"),
        ...kids("a", ["数据治理组", "数据平台组", "BI 分析组"]),
        ...kids("b", ["前端组", "后端组", "移动端组"]),
        ...kids("c", ["云平台组", "网络运维组"]),
        ...kids("d", ["安全运营组", "审计合规组"])
      ],
      edges: []
    }
  },
  {
    id: "hierarchy-deep",
    diagram: {
      type: "hierarchy",
      title: "产品线拆分",
      nodes: [
        n("r", "企业服务平台"),
        n("a", "协同办公", "r"),
        n("b", "客户管理", "r"),
        ...kids("a", ["即时通讯", "文档协作", "审批流"]),
        ...kids("b", ["线索管理", "商机管理"]),
        ...kids("a-1", ["在线编辑", "版本管理"]),
        ...kids("b-0", ["线索评分", "自动分配"])
      ],
      edges: []
    }
  },
  {
    id: "architecture-nested",
    diagram: {
      type: "architecture",
      title: "智能客服系统架构",
      nodes: [
        n("fe", "接入层"),
        ...kids("fe", ["Web 客服窗口", "企业微信", "App 内嵌"]),
        n("svc", "服务层"),
        n("bot", "对话引擎", "svc"),
        ...kids("bot", ["意图识别", "多轮对话", "知识检索"]),
        n("ops", "运营中心", "svc"),
        ...kids("ops", ["工单系统", "质检分析"]),
        n("data", "数据层"),
        ...kids("data", ["知识库", "会话日志", "用户画像"])
      ],
      edges: [
        { from: "fe-0", to: "bot", label: "请求" },
        { from: "bot-2", to: "data-0", label: "检索" },
        { from: "ops-0", to: "data-1" }
      ],
      layers: [
        { name: "渠道接入", nodeIds: ["fe"] },
        { name: "业务服务", nodeIds: ["svc"] },
        { name: "数据支撑", nodeIds: ["data"] }
      ]
    }
  },
  {
    id: "flow-phases",
    diagram: {
      type: "flow",
      title: "招投标全流程",
      direction: "horizontal",
      nodes: [
        n("p1", "项目研判"),
        ...kids("p1", ["获取招标文件", "资格预审", "投标决策"]),
        n("p2", "标书编制"),
        ...kids("p2", ["技术方案", "商务报价", "资质材料", "内部评审"]),
        n("p3", "开标评标"),
        ...kids("p3", ["递交标书", "答疑澄清", "评标结果"]),
        n("p4", "合同签订"),
        ...kids("p4", ["中标通知", "合同谈判"])
      ],
      edges: [
        { from: "p1", to: "p2" },
        { from: "p2", to: "p3" },
        { from: "p3", to: "p4" }
      ]
    }
  },
  {
    id: "flow-long-labels",
    diagram: {
      type: "flow",
      title: "Customer onboarding workflow",
      language: "en",
      direction: "horizontal",
      nodes: [
        n("a", "Collect signup form", null, { detail: "Email, company size and use case" }),
        n("b", "Verify identity", null, { detail: "KYC checks against the regulatory list" }),
        n("c", "Provision workspace"),
        n("d", "Schedule kickoff call", null, { detail: "Assign a customer success manager" }),
        n("e", "Import historical data"),
        n("f", "Go live", null, { emphasis: "primary" }),
        n("g", "Quarterly business review", null, { dashed: true })
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "d", to: "e" },
        { from: "e", to: "f", label: "sign-off" },
        { from: "f", to: "g", dashed: true },
        { from: "b", to: "a", label: "rejected", dashed: true }
      ]
    }
  },
  {
    id: "mindmap",
    diagram: {
      type: "mindmap",
      title: "企业知识库建设方案",
      nodes: [
        n("root", "企业知识库"),
        n("a", "内容来源", "root"),
        ...kids("a", ["制度流程文档", "项目交付资料", "专家经验沉淀"]),
        n("b", "权限治理", "root"),
        ...kids("b", ["分级分类", "敏感信息脱敏", "访问审计"]),
        n("c", "检索体验", "root"),
        ...kids("c", ["语义搜索", "标签体系"]),
        n("d", "AI 问答", "root"),
        ...kids("d", ["知识问答助手", "引用溯源", "答案反馈"]),
        n("e", "运营机制", "root"),
        ...kids("e", ["内容责任人", "定期更新", "激励机制"]),
        n("f", "效果评估", "root"),
        ...kids("f", ["检索命中率", "问答满意度"])
      ],
      edges: []
    }
  },
  {
    id: "mindmap-wide",
    diagram: {
      type: "mindmap",
      title: "年度市场策略",
      nodes: [
        n("root", "市场策略"),
        ...["品牌", "渠道", "产品", "定价", "内容", "活动", "数据"].flatMap((label, i) => [
          n(`b${i}`, label, "root"),
          ...kids(`b${i}`, [`${label}目标`, `${label}举措`, `${label}指标`, `${label}预算`])
        ])
      ],
      edges: []
    }
  },
  {
    id: "fishbone",
    diagram: {
      type: "fishbone",
      title: "移动端转化率下降原因分析",
      nodes: [
        n("t", "流量质量"),
        ...kids("t", ["投放渠道质量下滑", "新用户占比过高"]),
        n("u", "页面体验"),
        ...kids("u", ["首屏加载慢", "首屏信息不清晰", "表单步骤过多"]),
        n("p", "支付链路"),
        ...kids("p", ["支付失败率升高", "支付方式少"]),
        n("m", "营销策略"),
        ...kids("m", ["优惠规则复杂", "活动频次过高"]),
        n("s", "技术稳定性"),
        ...kids("s", ["接口超时", "版本兼容问题"]),
        n("d", "数据统计"),
        ...kids("d", ["埋点口径变化", "归因窗口调整"]),
        n("head", "移动端转化率下降")
      ],
      edges: []
    }
  },
  {
    id: "matrix",
    diagram: {
      type: "matrix",
      title: "产品功能优先级矩阵",
      axes: { xLabel: "用户价值 →", yLabel: "↑ 实施成本" },
      nodes: [
        n("m", "功能池"),
        n("q1", "快速见效", "m", { detail: "智能搜索、批量导入：价值高、成本低，优先排期" }),
        n("q2", "战略投入", "m", { detail: "实时协作、开放 API：价值高但成本高，分阶段推进" }),
        n("q3", "顺手优化", "m", { detail: "权限模板、移动端适配" }),
        n("q4", "暂缓", "m", { detail: "数据看板、自动摘要：价值待验证" })
      ],
      edges: []
    }
  },
  {
    id: "timeline",
    diagram: {
      type: "timeline",
      title: "平台建设路线图",
      nodes: [
        n("a", "2024 Q1 立项", null, { detail: "完成需求调研与可行性评估" }),
        n("b", "2024 Q2 原型", null, { detail: "核心流程原型验证" }),
        n("c", "2024 Q3 试点", null, { detail: "两个事业部试点上线" }),
        n("d", "2024 Q4 推广", null, { detail: "全集团推广与培训" }),
        n("e", "2025 Q1 运营", null, { detail: "建立持续运营机制" }),
        n("f", "2025 Q2 生态", null, { detail: "开放接口接入合作伙伴", dashed: true })
      ],
      edges: []
    }
  },
  {
    id: "pyramid",
    diagram: {
      type: "pyramid",
      title: "数据价值金字塔",
      nodes: [
        n("a", "智慧决策", null, { detail: "预测与自动化决策" }),
        n("b", "业务洞察", null, { detail: "指标体系与分析报告" }),
        n("c", "数据资产", null, { detail: "主数据、标签与模型" }),
        n("d", "数据采集", null, { detail: "业务系统、日志与外部数据" })
      ],
      edges: []
    }
  },
  {
    id: "cycle",
    diagram: {
      type: "cycle",
      title: "企业 AI 应用持续改进循环",
      nodes: [
        n("a", "业务问题收集", null, { detail: "从一线收集高价值场景" }),
        n("b", "数据准备", null, { detail: "清洗、标注与权限梳理" }),
        n("c", "原型验证", null, { detail: "小样本快速验证效果" }),
        n("d", "上线试点", null, { detail: "选定部门灰度上线" }),
        n("e", "效果评估", null, { detail: "量化效率与质量提升" }),
        n("f", "风险复盘", null, { detail: "识别合规与安全风险" }),
        n("g", "策略迭代", null, { detail: "调整模型与流程" })
      ],
      edges: []
    }
  },
  {
    id: "funnel",
    diagram: {
      type: "funnel",
      title: "销售转化漏斗",
      nodes: [
        n("a", "市场线索", null, { detail: "12,000 条" }),
        n("b", "有效线索", null, { detail: "4,800 条" }),
        n("c", "商机", null, { detail: "1,200 个" }),
        n("d", "报价", null, { detail: "420 个" }),
        n("e", "成交", null, { detail: "160 单" })
      ],
      edges: []
    }
  },
  {
    id: "venn",
    diagram: {
      type: "venn",
      title: "创新机会评估",
      nodes: [
        n("a", "产品可行性", null, { detail: "用户需要、体验可达成" }),
        n("b", "技术可行性", null, { detail: "现有技术栈可实现" }),
        n("c", "商业价值", null, { detail: "可规模化变现" })
      ],
      edges: []
    }
  },
  {
    id: "swimlane",
    diagram: {
      type: "swimlane",
      title: "跨部门退款处理流程",
      lanes: ["用户", "客服", "财务", "系统"],
      nodes: [
        n("a", "提交退款申请", null, { lane: "用户" }),
        n("b", "校验订单状态", null, { lane: "系统" }),
        n("c", "审核退款原因", null, { lane: "客服" }),
        n("d", "要求补充资料", null, { lane: "客服", dashed: true }),
        n("e", "复核退款金额", null, { lane: "财务" }),
        n("f", "执行原路退款", null, { lane: "系统" }),
        n("g", "收到到账通知", null, { lane: "用户" }),
        n("x", "订单已过退款期", null, { lane: "系统", emphasis: "muted" })
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d", label: "资料缺失", dashed: true },
        { from: "c", to: "e", label: "通过" },
        { from: "e", to: "f" },
        { from: "f", to: "g" },
        { from: "b", to: "x", label: "超期" }
      ]
    }
  },
  {
    id: "gantt",
    diagram: {
      type: "gantt",
      title: "AI 报表平台上线计划",
      nodes: [
        n("a", "需求梳理", null, { start: 1, end: 2 }),
        n("b", "数据接入", null, { start: 2, end: 5 }),
        n("c", "权限模型", null, { start: 3, end: 6 }),
        n("d", "报表设计", null, { start: 4, end: 7 }),
        n("e", "联调测试", null, { start: 7, end: 9 }),
        n("f", "灰度上线", null, { start: 9, end: 10 })
      ],
      edges: []
    }
  },
  {
    id: "kanban",
    diagram: {
      type: "kanban",
      title: "迭代看板",
      lanes: ["待办", "进行中", "测试中", "已完成"],
      nodes: [
        n("a", "登录页改版", null, { lane: "待办" }),
        n("b", "消息推送", null, { lane: "待办", detail: "iOS 与 Android 双端" }),
        n("c", "搜索优化", null, { lane: "进行中" }),
        n("d", "报表导出", null, { lane: "测试中" }),
        n("e", "权限重构", null, { lane: "已完成" }),
        n("f", "埋点补齐", null, { lane: "已完成" })
      ],
      edges: []
    }
  },
  {
    id: "network",
    diagram: {
      type: "network",
      title: "微服务依赖关系",
      nodes: ["网关", "用户服务", "订单服务", "库存服务", "支付服务", "消息队列", "通知服务"].map((label, i) => n(`s${i}`, label)),
      edges: [
        { from: "s0", to: "s1", label: "鉴权" },
        { from: "s0", to: "s2", label: "路由" },
        { from: "s2", to: "s3", label: "扣减" },
        { from: "s2", to: "s4", label: "支付" },
        { from: "s4", to: "s5", label: "事件" },
        { from: "s5", to: "s6", label: "订阅" }
      ]
    }
  },
  {
    id: "scatter",
    diagram: {
      type: "scatter",
      title: "项目组合定位",
      axes: { xLabel: "实施难度 →", yLabel: "↑ 业务收益" },
      nodes: [
        n("a", "统一登录", null, { score: { x: 0.2, y: 0.6 } }),
        n("b", "客户画像", null, { score: { x: 0.55, y: 0.8 } }),
        n("c", "自动报价", null, { score: { x: 0.35, y: 0.75 } }),
        n("d", "预测补货", null, { score: { x: 0.7, y: 0.7 } }),
        n("e", "合同智能审阅", null, { score: { x: 0.6, y: 0.55 } }),
        n("f", "客服机器人", null, { score: { x: 0.4, y: 0.5 } }),
        n("g", "数据中台", null, { score: { x: 0.85, y: 0.85 } }),
        n("h", "移动审批", null, { score: { x: 0.15, y: 0.3 } })
      ],
      edges: []
    }
  },
  {
    id: "radar",
    diagram: {
      type: "radar",
      title: "供应商能力评估",
      nodes: ["交付能力", "价格竞争力", "技术实力", "服务响应", "合规资质", "行业案例"].map((label, i) =>
        n(`r${i}`, label, null, { score: { x: 0.4 + (i % 3) * 0.2, y: 0.4 + (i % 3) * 0.2 } })
      ),
      edges: []
    }
  },
  {
    id: "heatmap",
    diagram: {
      type: "heatmap",
      title: "风险热力图",
      nodes: ["数据泄露", "系统宕机", "合规处罚", "供应中断", "人才流失", "舆情风险", "成本超支", "进度延误", "需求变更"].map((label, i) =>
        n(`h${i}`, label, null, { score: { x: (i % 5) / 4, y: (i % 5) / 4 }, detail: i % 2 ? "高影响" : undefined })
      ),
      edges: []
    }
  },
  {
    id: "waterfall",
    diagram: {
      type: "waterfall",
      title: "利润变动分析",
      nodes: [
        n("a", "去年利润", null, { score: { x: 100, y: 100 } }),
        n("b", "收入增长", null, { score: { x: 45, y: 45 } }),
        n("c", "原材料上涨", null, { score: { x: -20, y: -20 } }),
        n("d", "人力成本", null, { score: { x: -15, y: -15 } }),
        n("e", "降本增效", null, { score: { x: 12, y: 12 } }),
        n("f", "汇率影响", null, { score: { x: -6, y: -6 } })
      ],
      edges: []
    }
  },
  {
    id: "pie",
    diagram: {
      type: "pie",
      title: "收入结构",
      nodes: [
        n("a", "软件订阅", null, { value: 46 }),
        n("b", "实施服务", null, { value: 24 }),
        n("c", "硬件销售", null, { value: 15 }),
        n("d", "培训认证", null, { value: 9 }),
        n("e", "其他", null, { value: 6 })
      ],
      edges: []
    }
  },
  {
    id: "bar",
    diagram: {
      type: "bar",
      title: "各区域销售额",
      nodes: ["华东", "华南", "华北", "西南", "华中", "西北", "东北"].map((label, i) => n(`b${i}`, label, null, { value: 120 - i * 13 })),
      edges: []
    }
  },
  {
    id: "line",
    diagram: {
      type: "line",
      title: "月活跃用户趋势",
      nodes: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"].map((label, i) => n(`m${i}`, label, null, { value: 30 + i * 6 + (i % 3) * 4 })),
      edges: []
    }
  }
];

function compile(id: string, raw: Record<string, unknown>, skill: SkillId): Figure | undefined {
  const language = raw.language === "en" ? "en" : "zh";
  const validation = validateAndNormalizeSemanticDiagram({ ...raw, language }, skill, language);
  if (!validation.ok || !validation.diagram) {
    console.log(`FAIL  ${id}: validation ${validation.errors.slice(0, 2).join("; ")}`);
    return undefined;
  }
  return layoutDiagram(validation.diagram);
}

const figures: Array<{ id: string; figure: Figure }> = [];
for (const c of CASES) {
  const figure = compile(c.id, c.diagram as unknown as Record<string, unknown>, c.diagram.type as SkillId);
  if (figure) figures.push({ id: c.id, figure });
}
for (const f of FIXTURES) {
  const figure = compile(f.id, f.response.diagram as unknown as Record<string, unknown>, f.response.diagram.type as SkillId);
  if (figure) figures.push({ id: f.id, figure });
}

let failures = CASES.length + FIXTURES.length - figures.length;
const report = (id: string, issues: Issue[]) => {
  if (!issues.length) {
    console.log(`PASS  ${id}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${id}: ${issues.length} issue(s)`);
  issues.slice(0, 6).forEach((issue) => console.log(`        - ${issue.kind}: ${issue.detail}`));
};

// COLLISION_SVG_DIR=<dir> dumps every audited slide for visual review.
const dumpDir = process.env.COLLISION_SVG_DIR;
if (dumpDir) mkdirSync(dumpDir, { recursive: true });
const dump = (name: string, figure: Figure) => {
  if (dumpDir) writeFileSync(path.join(dumpDir, `${name}.svg`), renderFigureSvg(figure));
};

for (const { id, figure } of figures) {
  dump(id, figure);
  report(id, auditFigure(figure));
}

// Deck slides: the chrome (title, accent rule, footer) must not touch the body.
function bounds(els: FigureElement[]): Array<{ id: string; x: number; y: number; w: number; h: number }> {
  const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  for (const el of els) {
    if (el.type === "group") out.push(...bounds(el.children));
    else if (el.type === "rect" || el.type === "image") out.push({ id: el.id, x: el.x, y: el.y, w: el.width, h: el.height });
    else if (el.type === "text" && el.text.trim()) out.push({ id: el.id, ...renderedTextBox(el).box });
    else if (el.type === "ellipse") out.push({ id: el.id, x: el.cx - el.rx, y: el.cy - el.ry, w: el.rx * 2, h: el.ry * 2 });
    else if (el.type === "connector" || el.type === "polygon") {
      const xs = el.points.map((p) => p.x);
      const ys = el.points.map((p) => p.y);
      out.push({ id: el.id, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    } else if (el.type === "line" || el.type === "arrow") {
      out.push({ id: el.id, x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2), w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) });
    }
  }
  return out;
}

for (const tpl of DECK_TEMPLATES) {
  const palette: DeckPalette = {
    background: tpl.theme?.background ?? "#FFFFFF",
    accent: tpl.theme?.accents[0]?.stroke ?? "#33B1FF",
    text: tpl.theme?.text ?? "#0E1E36",
    subtext: tpl.theme?.subtext ?? "#5B6B80",
    fontFamily: tpl.theme?.fontFamily
  };
  const deckIssues: string[] = [];
  for (const { id, figure } of figures) {
    const chromed = withDeckChrome(figure, palette, { index: 4, total: 12, deckTitle: "数字化转型实施方案汇报", language: "zh" }, tpl);
    dump(`deck-${tpl.id}-${id}`, chromed);
    const bodyIds = new Set(bounds(figure.elements.filter((el) => el.id !== "figure-title-text")).map((b) => b.id));
    const all = bounds(chromed.elements);
    const body = all.filter((b) => bodyIds.has(b.id));
    // Full-bleed chrome (background panels, side bars) is decoration, not content.
    const chrome = all.filter((b) => !bodyIds.has(b.id) && !(b.w >= 1200 && b.h >= 600));
    for (const c of chrome) {
      const hit = body.find((b) => Math.min(b.x + b.w, c.x + c.w) - Math.max(b.x, c.x) > 1 && Math.min(b.y + b.h, c.y + c.h) - Math.max(b.y, c.y) > 1);
      if (hit) {
        deckIssues.push(`${id}: chrome ${c.id} × ${hit.id}`);
        break;
      }
    }
    const issues = auditFigure(chromed);
    if (issues.length) deckIssues.push(`${id}: ${issues[0].kind} ${issues[0].detail}`);
  }
  if (deckIssues.length) {
    failures += 1;
    console.log(`FAIL  deck/${tpl.id}: ${deckIssues.length} slide(s) collide`);
    deckIssues.slice(0, 6).forEach((d) => console.log(`        - ${d}`));
  } else {
    console.log(`PASS  deck/${tpl.id}: ${figures.length} diagram slides clear of chrome`);
  }
}

if (failures) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nNO COLLISIONS");
