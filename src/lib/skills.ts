import type { InternalSkill, SkillId } from "@/lib/types";

const DEFAULT_CANVAS = {
  width: 1280,
  height: 720,
  background: "#FFFFFF"
};

export const INTERNAL_SKILLS: InternalSkill[] = [
  {
    id: "freeform",
    name: { en: "Other / AI choice", zh: "其他 / AI 自由发挥" },
    description: {
      en: "Let AI choose the best visual structure for the request.",
      zh: "由 AI 根据描述自由选择最合适的图形结构。"
    },
    promptFile: "skills/freeform.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "flow",
    name: { en: "Flow", zh: "流程图" },
    description: {
      en: "Process flows, handoffs, lifecycle steps.",
      zh: "流程、交接、生命周期步骤。"
    },
    promptFile: "skills/flow.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "matrix",
    name: { en: "Matrix", zh: "矩阵" },
    description: {
      en: "2x2 analysis, segmentation, prioritization.",
      zh: "2x2 分析、分群、优先级判断。"
    },
    promptFile: "skills/matrix.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "timeline",
    name: { en: "Timeline", zh: "时间线" },
    description: {
      en: "Roadmaps, release plans, milestones.",
      zh: "路线图、发布计划、里程碑。"
    },
    promptFile: "skills/timeline.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "pyramid",
    name: { en: "Pyramid", zh: "金字塔" },
    description: {
      en: "Layered hierarchy, funnels, maturity models.",
      zh: "分层结构、漏斗、成熟度模型。"
    },
    promptFile: "skills/pyramid.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "architecture",
    name: { en: "Architecture", zh: "架构图" },
    description: {
      en: "System layers, services, platform diagrams.",
      zh: "系统分层、服务关系、平台图。"
    },
    promptFile: "skills/architecture.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "hierarchy",
    name: { en: "Hierarchy", zh: "组织/层级图" },
    description: { en: "Org chart / top-down tree.", zh: "组织架构 / 自上而下树。" },
    promptFile: "skills/hierarchy.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "cycle",
    name: { en: "Cycle", zh: "循环图" },
    description: { en: "Cyclical loop (PDCA, lifecycle).", zh: "循环流程(PDCA、生命周期)。" },
    promptFile: "skills/cycle.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "funnel",
    name: { en: "Funnel", zh: "漏斗图" },
    description: { en: "Conversion / stage funnel.", zh: "转化 / 阶段漏斗。" },
    promptFile: "skills/funnel.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "venn",
    name: { en: "Venn", zh: "韦恩图" },
    description: { en: "2-3 overlapping sets.", zh: "2~3 个交叠集合。" },
    promptFile: "skills/venn.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "mindmap",
    name: { en: "Mind map", zh: "思维导图" },
    description: { en: "Central topic with branches.", zh: "中心主题向外发散。" },
    promptFile: "skills/mindmap.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "fishbone",
    name: { en: "Fishbone", zh: "鱼骨图" },
    description: { en: "Cause-effect (Ishikawa).", zh: "因果分析(石川图)。" },
    promptFile: "skills/fishbone.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "gantt",
    name: { en: "Gantt", zh: "甘特图" },
    description: { en: "Schedule with task bars.", zh: "带任务条的排期。" },
    promptFile: "skills/gantt.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "swimlane",
    name: { en: "Swimlane", zh: "泳道图" },
    description: { en: "Cross-functional process lanes.", zh: "跨职能泳道流程。" },
    promptFile: "skills/swimlane.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "scatter",
    name: { en: "Scatter", zh: "散点/定位图" },
    description: { en: "2D positioning by score.", zh: "按评分二维定位。" },
    promptFile: "skills/scatter.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "kanban",
    name: { en: "Kanban", zh: "看板" },
    description: {
      en: "Board of columns (status/stage) with stacked cards.",
      zh: "按状态/阶段分栏的看板，卡片纵向堆叠。"
    },
    promptFile: "skills/kanban.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "network",
    name: { en: "Network", zh: "网络关系图" },
    description: {
      en: "Entities linked by relationships, arranged on a ring.",
      zh: "实体之间的关系连接，环形排布。"
    },
    promptFile: "skills/network.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "radar",
    name: { en: "Radar", zh: "雷达图" },
    description: {
      en: "Multi-dimension comparison on radial axes (score per axis).",
      zh: "多维度雷达对比，每个维度一个评分。"
    },
    promptFile: "skills/radar.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "heatmap",
    name: { en: "Heatmap", zh: "热力图" },
    description: {
      en: "Grid of cells shaded by intensity (score per cell).",
      zh: "网格单元按强度着色，每格一个评分。"
    },
    promptFile: "skills/heatmap.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "waterfall",
    name: { en: "Waterfall", zh: "瀑布图" },
    description: {
      en: "Cumulative increases/decreases across steps.",
      zh: "逐步累计的增减变化。"
    },
    promptFile: "skills/waterfall.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "pie",
    name: { en: "Pie / Donut", zh: "饼图 / 环形图" },
    description: {
      en: "Composition, share, and percentage breakdowns.",
      zh: "构成、占比和百分比分解。"
    },
    promptFile: "skills/pie.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "bar",
    name: { en: "Bar / Column", zh: "柱状图 / 条形图" },
    description: {
      en: "Compare numeric values across categories.",
      zh: "比较不同类别的数值。"
    },
    promptFile: "skills/bar.md",
    defaultCanvas: DEFAULT_CANVAS
  },
  {
    id: "line",
    name: { en: "Line / Trend", zh: "折线图 / 趋势图" },
    description: {
      en: "Show ordered numeric change or a trend over time.",
      zh: "展示有序数值变化或时间趋势。"
    },
    promptFile: "skills/line.md",
    defaultCanvas: DEFAULT_CANVAS
  }
];

export function getInternalSkill(skillId: string): InternalSkill | undefined {
  return INTERNAL_SKILLS.find((skill) => skill.id === skillId);
}

export function isSkillId(value: string): value is SkillId {
  return INTERNAL_SKILLS.some((skill) => skill.id === value);
}
