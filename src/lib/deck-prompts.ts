import { loadPrompt, type ChatMessage } from "@/lib/prompts";
import { SKILL_IDS } from "@/lib/types";
import type { Locale } from "@/lib/types";

export interface DeckGenerationInput {
  context: string;
  language: Locale;
  styleHint?: string;
  maxSlides?: number;
}

// Diagram types the deck may embed (same set the single-figure pipeline uses,
// minus the "freeform" meta-skill which only makes sense with a user prompt).
const DECK_DIAGRAM_TYPES = SKILL_IDS.filter((id) => id !== "freeform");

export async function buildDeckMessages(input: DeckGenerationInput): Promise<ChatMessage[]> {
  const [systemPrompt, contractPrompt, qualityPrompt] = await Promise.all([
    loadPrompt("system/generate-deck.md"),
    loadPrompt("shared/figure-json-contract.md"),
    loadPrompt("shared/svg-quality-rules.md")
  ]);

  return [
    {
      role: "system",
      content: [systemPrompt, contractPrompt, qualityPrompt].join("\n\n---\n\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          output_language: input.language === "zh" ? "Simplified Chinese" : "English",
          allowed_diagram_types: DECK_DIAGRAM_TYPES,
          max_slides: input.maxSlides ?? 12,
          style_hint: input.styleHint ?? "",
          context: input.context,
          required_json_shape: {
            title: "string",
            language: input.language,
            slides: "array of cover|section|bullets|diagram slides"
          }
        },
        null,
        2
      )
    }
  ];
}
