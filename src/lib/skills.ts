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
    id: "pangu-white",
    name: { en: "Pangu White", zh: "盘古智白样式" },
    description: {
      en: "Minimal white presentation visuals with strict text hierarchy.",
      zh: "白底克制的演示图形，强化文本层级和排版。"
    },
    promptFile: "skills/pangu-white.md",
    defaultCanvas: DEFAULT_CANVAS
  }
];

export function getInternalSkill(skillId: string): InternalSkill | undefined {
  return INTERNAL_SKILLS.find((skill) => skill.id === skillId);
}

export function isSkillId(value: string): value is SkillId {
  return INTERNAL_SKILLS.some((skill) => skill.id === value);
}
