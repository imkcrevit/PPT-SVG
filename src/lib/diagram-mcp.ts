import { INTERNAL_SKILLS, isSkillId } from "@/lib/skills";
import type { ChatMessage } from "@/lib/prompts";
import type { GenerateFigureRequest, SkillId } from "@/lib/types";
import type { OpenRouterFunctionTool, OpenRouterToolCall } from "@/lib/openrouter";

export type DiagramMcpRouteSource =
  | "user-description"
  | "user-selection"
  | "current-render"
  | "ai-tool-call"
  | "fallback";

export interface DiagramMcpRoute {
  protocol: "mcp";
  toolName: string;
  skillId: SkillId;
  source: DiagramMcpRouteSource;
}

export type DiagramToolSelector = (
  messages: ChatMessage[],
  tools: OpenRouterFunctionTool[]
) => Promise<OpenRouterToolCall[]>;

const EXPLICIT_SKILL_PATTERNS: Array<[SkillId, RegExp]> = [
  ["pie", /(?:饼图|饼状图|环形图|甜甜圈图?|占比图|份额图|pie\s*chart|donut\s*chart)/iu],
  ["bar", /(?:柱状图?|柱形图?|条形图|直方图|bar\s*chart|column\s*chart|histogram)/iu],
  ["line", /(?:折线图?|曲线图|趋势图|面积图|line\s*chart|area\s*chart|trend\s*chart)/iu],
  ["waterfall", /(?:瀑布图|waterfall\s*chart)/iu],
  ["heatmap", /(?:热力图|热图|heat\s*map)/iu],
  ["radar", /(?:雷达图|蜘蛛图|radar\s*chart|spider\s*chart)/iu],
  ["scatter", /(?:散点图|气泡图|scatter\s*(?:plot|chart)|bubble\s*chart)/iu],
  ["gantt", /(?:甘特图|gantt\s*chart)/iu],
  ["swimlane", /(?:泳道图|swimlane\s*(?:diagram|chart)?)/iu],
  ["kanban", /(?:看板图?|kanban\s*(?:board)?)/iu],
  ["fishbone", /(?:鱼骨图|因果图|石川图|fishbone\s*(?:diagram)?|ishikawa\s*(?:diagram)?)/iu],
  ["mindmap", /(?:思维导图|脑图|mind\s*map)/iu],
  ["venn", /(?:韦恩图|维恩图|venn\s*(?:diagram)?)/iu],
  ["funnel", /(?:漏斗图|funnel\s*(?:chart)?)/iu],
  ["cycle", /(?:循环图|循环流程|cycle\s*(?:diagram)?|cyclical\s*(?:diagram)?)/iu],
  ["hierarchy", /(?:组织架构图?|组织图|层级图|树状图|hierarchy\s*(?:diagram)?|org(?:anization)?\s*chart)/iu],
  ["timeline", /(?:时间线|时间轴|路线图|timeline|roadmap)/iu],
  ["matrix", /(?:矩阵图|四象限图|matrix\s*(?:diagram)?|quadrant\s*(?:chart)?)/iu],
  ["architecture", /(?:架构图|系统架构|architecture\s*(?:diagram)?|system\s*architecture)/iu],
  ["network", /(?:网络关系图|关系网络图|network\s*(?:diagram|graph))/iu],
  ["flow", /(?:流程图|流程示意图|flow\s*chart|flowchart|process\s*(?:diagram|flow))/iu],
  ["pyramid", /(?:金字塔图?|pyramid\s*(?:diagram|chart)?)/iu]
];

export const DIAGRAM_MCP_TOOLS: OpenRouterFunctionTool[] = INTERNAL_SKILLS.map((skill) => ({
  type: "function",
  function: {
    name: diagramMcpToolName(skill.id),
    description: `${skill.description.en} Use this MCP tool when the requested output format is ${skill.name.en}.`,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The user's original diagram request. Preserve it exactly."
        }
      },
      required: ["prompt"],
      additionalProperties: false
    }
  }
}));

export function diagramMcpToolName(skillId: SkillId): string {
  return `render_${skillId}_svg`;
}

export function skillIdFromDiagramMcpTool(toolName: string | undefined): SkillId | undefined {
  const match = /^render_([a-z0-9-]+)_svg$/.exec(toolName ?? "");
  return match && isSkillId(match[1]) ? match[1] : undefined;
}

export function detectExplicitDiagramSkill(text: string): SkillId | undefined {
  let selected: SkillId | undefined;
  let selectedIndex = -1;
  for (const [skillId, pattern] of EXPLICIT_SKILL_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(matcher)) {
      if (match.index >= selectedIndex) {
        selected = skillId;
        selectedIndex = match.index;
      }
    }
  }
  return selected;
}

export async function resolveDiagramMcpRoute(
  request: GenerateFigureRequest,
  selectTool?: DiagramToolSelector
): Promise<DiagramMcpRoute> {
  const explicit = detectExplicitDiagramSkill(request.userDescription);
  if (explicit) return route(explicit, "user-description");

  if (request.skillId !== "freeform") return route(request.skillId, "user-selection");

  const currentSkill = request.referenceFigure?.figure.metadata.skillId;
  if (currentSkill && isSkillId(currentSkill) && currentSkill !== "freeform") {
    return route(currentSkill, "current-render");
  }

  if (selectTool) {
    try {
      const toolCalls = await selectTool(buildRouterMessages(request), DIAGRAM_MCP_TOOLS);
      const selected = skillIdFromDiagramMcpTool(toolCalls[0]?.function?.name);
      if (selected) return route(selected, "ai-tool-call");
    } catch (error) {
      console.warn("[diagram-mcp] AI tool routing failed; using freeform MCP tool", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return route("freeform", "fallback");
}

function route(skillId: SkillId, source: DiagramMcpRouteSource): DiagramMcpRoute {
  return { protocol: "mcp", toolName: diagramMcpToolName(skillId), skillId, source };
}

function buildRouterMessages(request: GenerateFigureRequest): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Select exactly one provided MCP tool for the user's requested SVG format. Call the most specific chart or diagram tool. Do not answer with prose. Do not invent a format that conflicts with the request."
    },
    {
      role: "user",
      content: JSON.stringify({
        user_description: request.userDescription,
        output_language: request.language,
        attachment_names: request.attachments?.map((item) => item.originalName) ?? []
      })
    }
  ];
}
