import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { scheduleArtifactReap } from "@/lib/artifact-cleanup";
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

export interface GeneratedArtifactMetadata {
  userDescription?: string;
  conversationTurn?: number;
  tokenUsage?: unknown;
}

export async function persistGeneratedArtifacts(
  figure: Figure,
  fit: FitAssessment,
  requestId: string,
  sessionId: string,
  layoutReview?: unknown,
  metadata: GeneratedArtifactMetadata = {}
): Promise<GeneratedArtifactPaths> {
  const date = new Date().toISOString().slice(0, 10);
  const sessionDirectory = path.join("/tmp", "ppt-svg", "sessions", sessionId);
  const directory = path.join(sessionDirectory, date);
  const svgPath = path.join(directory, `${requestId}.svg`);
  const jsonPath = path.join(directory, `${requestId}.json`);
  const latestSvgPath = path.join(sessionDirectory, "latest.svg");
  const latestJsonPath = path.join(sessionDirectory, "latest.json");
  const logPath = path.join(sessionDirectory, "generation-log.jsonl");
  const svg = renderFigureSvg(figure);
  const json = `${JSON.stringify({ sessionId, requestId, ...metadata, figure, fit, layoutReview }, null, 2)}\n`;

  scheduleArtifactReap();
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
        layoutReviewOk: readLayoutReviewOk(layoutReview),
        layoutReviewScore: readLayoutReviewScore(layoutReview),
        sessionId,
        userDescription: metadata.userDescription,
        conversationTurn: metadata.conversationTurn,
        tokenUsage: metadata.tokenUsage,
        svgPath,
        jsonPath
      })}\n`,
      "utf8"
    )
  ]);

  return { directory, svgPath, jsonPath, latestSvgPath, latestJsonPath, logPath };
}

export async function readLatestGeneratedArtifact(sessionId: string): Promise<{
  sessionId?: string;
  requestId?: string;
  userDescription?: string;
  conversationTurn?: number;
  figure?: Figure;
  fit?: FitAssessment;
  layoutReview?: unknown;
}> {
  const latestJsonPath = path.join("/tmp", "ppt-svg", "sessions", sessionId, "latest.json");
  const raw = await readFile(latestJsonPath, "utf8");
  return JSON.parse(raw) as {
    sessionId?: string;
    requestId?: string;
    userDescription?: string;
    conversationTurn?: number;
    figure?: Figure;
    fit?: FitAssessment;
    layoutReview?: unknown;
  };
}

function readLayoutReviewOk(layoutReview: unknown): boolean | undefined {
  if (!layoutReview || typeof layoutReview !== "object" || Array.isArray(layoutReview)) {
    return undefined;
  }

  const value = (layoutReview as Record<string, unknown>).ok;
  return typeof value === "boolean" ? value : undefined;
}

function readLayoutReviewScore(layoutReview: unknown): number | undefined {
  if (!layoutReview || typeof layoutReview !== "object" || Array.isArray(layoutReview)) {
    return undefined;
  }

  const value = (layoutReview as Record<string, unknown>).score;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
