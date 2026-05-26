import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderFigureSvg } from "@/lib/svg";
import type { Figure, FitAssessment } from "@/lib/types";

export interface GeneratedArtifactPaths {
  directory: string;
  svgPath: string;
  jsonPath: string;
}

export async function persistGeneratedArtifacts(
  figure: Figure,
  fit: FitAssessment,
  requestId: string
): Promise<GeneratedArtifactPaths> {
  const date = new Date().toISOString().slice(0, 10);
  const directory = path.join("/tmp", "ppt-svg", date);
  const svgPath = path.join(directory, "latest.svg");
  const jsonPath = path.join(directory, "latest.json");
  const svg = renderFigureSvg(figure);

  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(svgPath, `${svg}\n`, "utf8"),
    writeFile(jsonPath, `${JSON.stringify({ requestId, figure, fit }, null, 2)}\n`, "utf8")
  ]);

  return { directory, svgPath, jsonPath };
}
