import { readFile } from "node:fs/promises";
import path from "node:path";

import type { GenerateFigureRequest, InternalSkill } from "@/lib/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const PROMPT_ROOT = path.resolve(process.cwd(), "prompt");

export async function loadPrompt(relativePath: string): Promise<string> {
  const fullPath = path.resolve(PROMPT_ROOT, relativePath);

  if (!fullPath.startsWith(PROMPT_ROOT)) {
    throw new Error(`Invalid prompt path: ${relativePath}`);
  }

  return readFile(fullPath, "utf8");
}

export async function buildGenerateMessages(
  request: GenerateFigureRequest,
  skill: InternalSkill
): Promise<ChatMessage[]> {
  const [systemPrompt, contractPrompt, qualityPrompt, skillPrompt] = await Promise.all([
    loadPrompt("system/generate-figure.md"),
    loadPrompt("shared/figure-json-contract.md"),
    loadPrompt("shared/svg-quality-rules.md"),
    loadPrompt(skill.promptFile)
  ]);

  return [
    {
      role: "system",
      content: [systemPrompt, contractPrompt, qualityPrompt, skillPrompt].join("\n\n---\n\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          selected_skill: skill.id,
          output_language: request.language,
          canvas: skill.defaultCanvas,
          user_description: request.userDescription,
          ppt_context: request.pptContext ?? null
        },
        null,
        2
      )
    }
  ];
}

export async function buildRepairMessages(rawOutput: string, validationErrors: string[]): Promise<ChatMessage[]> {
  const [repairPrompt, contractPrompt, qualityPrompt] = await Promise.all([
    loadPrompt("system/repair-json.md"),
    loadPrompt("shared/figure-json-contract.md"),
    loadPrompt("shared/svg-quality-rules.md")
  ]);

  return [
    {
      role: "system",
      content: [repairPrompt, contractPrompt, qualityPrompt].join("\n\n---\n\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          invalid_output: rawOutput,
          validation_errors: validationErrors
        },
        null,
        2
      )
    }
  ];
}

