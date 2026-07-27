import {
  detectExplicitDiagramSkill,
  DIAGRAM_MCP_TOOLS,
  resolveDiagramMcpRoute
} from "@/lib/diagram-mcp";
import { INTERNAL_SKILLS } from "@/lib/skills";
import type { Figure, GenerateFigureRequest, SkillId } from "@/lib/types";

const emptyFigure = (skillId: SkillId): Figure => ({
  canvas: { width: 1280, height: 720, background: "#FFFFFF" },
  metadata: { title: "Current", description: "Current render", skillId, language: "zh" },
  elements: []
});

const request = (overrides: Partial<GenerateFigureRequest>): GenerateFigureRequest => ({
  skillId: "freeform",
  userDescription: "生成一个图",
  language: "zh",
  ...overrides
});

let allPass = true;
async function check(name: string, run: () => boolean | Promise<boolean>): Promise<void> {
  try {
    const ok = await run();
    allPass = allPass && ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  } catch (error) {
    allPass = false;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await check("explicit pie overrides stale pyramid selection", async () => {
  const result = await resolveDiagramMcpRoute(
    request({ skillId: "pyramid", userDescription: "生成一个圆形填充的饼图" })
  );
  return result.skillId === "pie" && result.toolName === "render_pie_svg" && result.source === "user-description";
});

await check("explicit bar and line aliases", () =>
  detectExplicitDiagramSkill("做一个季度柱状图") === "bar" &&
  detectExplicitDiagramSkill("show a line chart for monthly revenue") === "line"
);

await check("latest explicit format wins in a revision", () =>
  detectExplicitDiagramSkill("不要饼图，改成柱状图") === "bar" &&
  detectExplicitDiagramSkill("柱状图不合适，换成饼状图") === "pie" &&
  detectExplicitDiagramSkill("不要饼图，考虑柱状图，最后还是饼图") === "pie"
);

await check("manual selection routes to its MCP tool", async () => {
  const result = await resolveDiagramMcpRoute(request({ skillId: "bar", userDescription: "比较这些数据" }));
  return result.skillId === "bar" && result.source === "user-selection";
});

await check("generic revision keeps current-render format", async () => {
  const result = await resolveDiagramMcpRoute(
    request({
      userDescription: "把颜色改成红色",
      referenceFigure: { source: "current-render", figure: emptyFigure("line") }
    })
  );
  return result.skillId === "line" && result.source === "current-render";
});

await check("ambiguous prompt uses AI MCP tool call", async () => {
  const result = await resolveDiagramMcpRoute(request({ userDescription: "整理这些想法" }), async () => [
    { type: "function", function: { name: "render_mindmap_svg", arguments: "{}" } }
  ]);
  return result.skillId === "mindmap" && result.source === "ai-tool-call";
});

await check("invalid AI tool call falls back to freeform MCP", async () => {
  const result = await resolveDiagramMcpRoute(request({ userDescription: "整理内容" }), async () => [
    { type: "function", function: { name: "unknown_tool", arguments: "{}" } }
  ]);
  return result.skillId === "freeform" && result.toolName === "render_freeform_svg" && result.source === "fallback";
});

await check("every internal skill has one unique MCP tool", () => {
  const names = DIAGRAM_MCP_TOOLS.map((tool) => tool.function.name);
  return names.length === INTERNAL_SKILLS.length && new Set(names).size === names.length;
});

console.log(allPass ? "\nALL MCP ROUTING ASSERTIONS PASS" : "\nMCP ROUTING ASSERTIONS FAILED");
if (!allPass) process.exitCode = 1;
