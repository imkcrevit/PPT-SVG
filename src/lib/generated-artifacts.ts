import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderFigureSvg } from "@/lib/svg";
import type { Figure, FitAssessment } from "@/lib/types";

export interface GeneratedArtifactPaths {
  directory: string;
  svgPath: string;
  jsonPath: string;
  latestSvgPath: string;
  latestJsonPath: string;
  logPath: string;
}

export async function persistGeneratedArtifacts(
  figure: Figure,
  fit: FitAssessment,
  requestId: string
): Promise<GeneratedArtifactPaths> {
  const date = new Date().toISOString().slice(0, 10);
  const directory = path.join("/tmp", "ppt-svg", date);
  const svgPath = path.join(directory, `${requestId}.svg`);
  const jsonPath = path.join(directory, `${requestId}.json`);
  const latestSvgPath = path.join(directory, "latest.svg");
  const latestJsonPath = path.join(directory, "latest.json");
  const logPath = path.join(directory, "generation-log.jsonl");
  const svg = renderFigureSvg(figure);
  const json = `${JSON.stringify({ requestId, figure, fit }, null, 2)}\n`;

  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(svgPath, `${svg}\n`, "utf8"),
    writeFile(jsonPath, json, "utf8"),
    writeFile(latestSvgPath, `${svg}\n`, "utf8"),
    writeFile(latestJsonPath, json, "utf8"),
    appendFile(
      logPath,
      `${JSON.stringify({
        requestId,
        createdAt: new Date().toISOString(),
        title: figure.metadata.title,
        skillId: figure.metadata.skillId,
        language: figure.metadata.language,
        fitScore: fit.score,
        svgPath,
        jsonPath
      })}\n`,
      "utf8"
    )
  ]);

  return { directory, svgPath, jsonPath, latestSvgPath, latestJsonPath, logPath };
}
