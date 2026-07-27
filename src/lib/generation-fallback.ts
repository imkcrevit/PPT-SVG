import { layoutDiagram } from "@/lib/layout-engine";
import type { SemanticDiagram, SemanticNode } from "@/lib/semantic-types";
import type { GenerateFigureRequest, GenerateFigureResponse } from "@/lib/types";

const NUMERIC_CHART_SKILLS = new Set(["pie", "bar", "line"]);

export function buildGenerationFallback(
  request: GenerateFigureRequest,
  requestId: string,
  reason: string
): GenerateFigureResponse {
  const zh = request.language === "zh";
  const note = zh
    ? "模型 JSON 无法修复，已按 MCP 路由类型生成忠实兜底图。"
    : "The model JSON could not be repaired; a source-faithful fallback was compiled for the MCP-routed type.";

  if (
    request.referenceFigure?.figure &&
    request.referenceFigure.figure.metadata.skillId === request.skillId
  ) {
    return {
      figure: request.referenceFigure.figure,
      fit: {
        score: 0.5,
        note: `${note} ${zh ? "保留当前图，未应用失败的修改。" : "The current figure was preserved without the failed revision."} requestId=${requestId}`
      }
    };
  }

  const title = compactTitle(request.userDescription, zh ? "生成图" : "Generated diagram");
  const nodes = NUMERIC_CHART_SKILLS.has(request.skillId)
    ? chartNodes(request.userDescription, request.language)
    : [{ id: "request", label: title, parent: null }];
  const diagram: SemanticDiagram = {
    type: request.skillId,
    title,
    description: note,
    language: request.language,
    direction: "horizontal",
    nodes,
    edges: []
  };

  return {
    figure: layoutDiagram(diagram),
    fit: {
      score: 0.5,
      note: `${note} requestId=${requestId}; reason=${reason.slice(0, 120)}`
    }
  };
}

function chartNodes(description: string, language: "en" | "zh"): SemanticNode[] {
  const afterHeading = description.split(/[:：]/u).at(-1) ?? description;
  const segments = afterHeading
    .split(/[,，、;；\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const nodes: SemanticNode[] = [];

  for (const segment of segments) {
    const match = /^(.{1,48}?)(?:\s+|=|:|：)(-?\d+(?:\.\d+)?)\s*%?$/u.exec(segment);
    if (!match) continue;
    const label = match[1].trim();
    const value = Number(match[2]);
    if (!label || !Number.isFinite(value)) continue;
    nodes.push({ id: `chart-${nodes.length + 1}`, label, value, parent: null });
  }

  if (nodes.length) return nodes;
  return [
    {
      id: "missing-values",
      label: language === "zh" ? "待补充数值" : "Values required",
      parent: null
    }
  ];
}

function compactTitle(value: string, fallback: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return (trimmed || fallback).slice(0, 42);
}
