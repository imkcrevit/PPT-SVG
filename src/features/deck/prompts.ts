import { loadPrompt, type ChatMessage } from "@/features/svg";
import { SKILL_IDS } from "@/lib/types";
import type { Locale } from "@/lib/types";

export interface DeckImageRef {
  ref: string; // e.g. "img1"
  source?: string;
  width: number;
  height: number;
}

export interface DeckGenerationInput {
  context: string;
  language: Locale;
  styleHint?: string;
  maxSlides?: number;
  /** Images the user supplied that the model may place via image slides. */
  images?: DeckImageRef[];
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
          // Images the user supplied. Reference one by its `ref` on an image or
          // image-bullets slide. Only use refs listed here; never invent one.
          available_images: input.images ?? [],
          context: input.context,
          required_json_shape: {
            title: "string",
            language: input.language,
            slides: "array of cover|toc|section|bullets|image|image-bullets|diagram slides"
          }
        },
        null,
        2
      )
    }
  ];
}
