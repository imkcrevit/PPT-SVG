import sharp from "sharp";

import { parseJsonObject } from "@/lib/json";
import { reviewFigureLayout } from "@/lib/layout-review-agent";
import { callOpenRouter, getConfiguredVisionModelLabel } from "@/lib/openrouter";
import { renderFigureSvg } from "@/lib/svg";
import type { ChatMessage } from "@/lib/prompts";
import type { Figure } from "@/lib/types";

export interface VisualLayoutReviewIssue {
  severity: "info" | "warning" | "error";
  message: string;
  evidence?: string;
  elementId?: string;
}

export interface VisualLayoutReviewResult {
  ok: boolean;
  score: number;
  summary: string;
  issues: VisualLayoutReviewIssue[];
  model: string;
  deterministicIssues: string[];
  image?: {
    mimeType: "image/png";
    width: number;
    height: number;
    bytes: number;
  };
  unavailable?: boolean;
}

interface RenderedPng {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export async function reviewFigureLayoutVisually(
  figure: Figure,
  options: {
    timeoutMs?: number;
  } = {}
): Promise<VisualLayoutReviewResult> {
  const deterministicIssues = reviewFigureLayout(figure).issues;

  if (figure.metadata.language === "zh") {
    return buildDeterministicOnlyReview(figure, deterministicIssues);
  }

  let rendered: RenderedPng | undefined;

  try {
    rendered = await renderFigurePngDataUrl(figure);
    const rawOutput = await callOpenRouter(buildVisualReviewMessages(figure, rendered, deterministicIssues), {
      model: process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_MODEL,
      temperature: 0,
      maxCompletionTokens: 900,
      timeoutMs: options.timeoutMs
    });
    const parsed = parseJsonObject(rawOutput);
    return normalizeVisualReview(parsed, deterministicIssues, rendered);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      score: 0,
      summary: `Visual layout review unavailable: ${message}`,
      issues: [
        {
          severity: "warning",
          message: `Visual layout review unavailable: ${message}`
        }
      ],
      model: getConfiguredVisionModelLabel(),
      deterministicIssues,
      image: rendered
        ? {
            mimeType: "image/png",
            width: rendered.width,
            height: rendered.height,
            bytes: rendered.bytes
          }
        : undefined,
      unavailable: true
    };
  }
}

function buildDeterministicOnlyReview(figure: Figure, deterministicIssues: string[]): VisualLayoutReviewResult {
  const ok = deterministicIssues.length === 0;
  const summary = ok
    ? "已跳过中文多模态视觉检查，确定性布局检查通过。"
    : "已跳过中文多模态视觉检查，确定性布局检查发现问题。";

  return {
    ok,
    score: ok ? 0.9 : 0.72,
    summary,
    issues: deterministicIssues.slice(0, 8).map((message) => ({
      severity: "warning",
      message: message.slice(0, 180)
    })),
    model: getConfiguredVisionModelLabel(),
    deterministicIssues,
    unavailable: true
  };
}

async function renderFigurePngDataUrl(figure: Figure): Promise<RenderedPng> {
  const svg = renderFigureSvg(figure);
  const buffer = await sharp(Buffer.from(svg), {
    density: 144
  })
    .resize({
      width: figure.canvas.width,
      height: figure.canvas.height,
      fit: "fill"
    })
    .png()
    .toBuffer();

  return {
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    width: figure.canvas.width,
    height: figure.canvas.height,
    bytes: buffer.byteLength
  };
}

function buildVisualReviewMessages(
  figure: Figure,
  rendered: RenderedPng,
  deterministicIssues: string[]
): ChatMessage[] {
  const outputLanguage = figure.metadata.language === "zh" ? "Simplified Chinese" : "English";

  return [
    {
      role: "system",
      content:
        "You are a strict visual QA agent for generated presentation SVGs. Inspect the provided rendered PNG and decide whether the diagram is visually centered, readable, and free of layout defects. Return only valid JSON."
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              output_language: outputLanguage,
              task: "Judge this rendered PPT-SVG layout from the image before final delivery.",
              canvas: figure.canvas,
              metadata: figure.metadata,
              deterministic_layout_issues: deterministicIssues,
              checks: [
                "The main visual group should be centered on the canvas unless a deliberate title occupies the top.",
                "Large background panels should be centered on the canvas.",
                "Cards, labels, connectors, and nested child groups should be centered inside their own background areas.",
                "Text must not look clipped, crowded, or visually off-center in its card.",
                "Complex nested groups must not be shifted, overlapped, detached from connectors, or unbalanced.",
                "Do not flag deliberate headings or explanatory notes just because they are not centered in a large parent panel."
              ],
              required_json_shape: {
                ok: "boolean",
                score: "number from 0 to 1",
                summary: "short judgment in output_language",
                issues: [
                  {
                    severity: "info | warning | error",
                    message: "short issue in output_language",
                    evidence: "brief visual evidence",
                    elementId: "optional known element id when deterministic data names it"
                  }
                ]
              }
            },
            null,
            2
          )
        },
        {
          type: "image_url",
          image_url: {
            url: rendered.dataUrl
          }
        }
      ]
    }
  ];
}

function normalizeVisualReview(
  value: unknown,
  deterministicIssues: string[],
  rendered: RenderedPng
): VisualLayoutReviewResult {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rawIssues = Array.isArray(record.issues) ? record.issues : [];
  const issues = rawIssues
    .map(normalizeIssue)
    .filter((issue): issue is VisualLayoutReviewIssue => Boolean(issue))
    .slice(0, 8);
  const score = clampNumber(typeof record.score === "number" ? record.score : issues.length ? 0.65 : 0.9, 0, 1, 0.8);
  const ok = typeof record.ok === "boolean" ? record.ok : score >= 0.82 && !issues.some((issue) => issue.severity === "error");
  const summary =
    typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim().slice(0, 240)
      : ok
        ? "Visual layout review passed."
        : "Visual layout review found layout issues.";

  return {
    ok,
    score,
    summary,
    issues,
    model: getConfiguredVisionModelLabel(),
    deterministicIssues,
    image: {
      mimeType: "image/png",
      width: rendered.width,
      height: rendered.height,
      bytes: rendered.bytes
    }
  };
}

function normalizeIssue(value: unknown): VisualLayoutReviewIssue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";

  if (!message) {
    return undefined;
  }

  return {
    severity: normalizeSeverity(record.severity),
    message: message.slice(0, 180),
    evidence: typeof record.evidence === "string" && record.evidence.trim() ? record.evidence.trim().slice(0, 180) : undefined,
    elementId: typeof record.elementId === "string" && record.elementId.trim() ? record.elementId.trim().slice(0, 80) : undefined
  };
}

function normalizeSeverity(value: unknown): VisualLayoutReviewIssue["severity"] {
  return value === "error" || value === "warning" || value === "info" ? value : "warning";
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}
