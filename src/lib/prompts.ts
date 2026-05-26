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
  const relative = path.relative(PROMPT_ROOT, fullPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid prompt path: ${relativePath}`);
  }

  return readFile(fullPath, "utf8");
}

function assertSkillPromptPath(promptFile: string): void {
  if (!/^skills\/[a-z0-9-]+\.md$/.test(promptFile)) {
    throw new Error(`Skill prompts must live in PPT-SVG/prompt/skills: ${promptFile}`);
  }
}

export async function buildGenerateMessages(
  request: GenerateFigureRequest,
  skill: InternalSkill
): Promise<ChatMessage[]> {
  assertSkillPromptPath(skill.promptFile);

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
          ui_language_environment: request.language === "zh" ? "Simplified Chinese" : "English",
          language_instruction:
            request.language === "zh"
              ? "The active UI language is Simplified Chinese. Output every visible label, title, note, and metadata value directly in Simplified Chinese unless the user explicitly asks for another language."
              : "The active UI language is English. Output every visible label, title, note, and metadata value directly in English unless the user explicitly asks for another language.",
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
