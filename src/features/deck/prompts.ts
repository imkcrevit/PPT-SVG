import { loadPrompt, type ChatContentPart, type ChatMessage } from "@/features/svg";
import { SKILL_IDS } from "@/lib/types";
import type { Locale } from "@/lib/types";

export interface DeckImageRef {
  ref: string; // e.g. "img1"
  source?: string;
  width: number;
  height: number;
  /** Server-side only. Sent as a multimodal image part, never copied into the JSON payload. */
  dataUri?: string;
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

  const availableImages =
    input.images?.map(({ ref, source, width, height }) => ({ ref, source, width, height })) ?? [];
  const userPayload = JSON.stringify(
    {
      output_language: input.language === "zh" ? "Simplified Chinese" : "English",
      allowed_diagram_types: DECK_DIAGRAM_TYPES,
      max_slides: input.maxSlides ?? 12,
      style_hint: input.styleHint ?? "",
      source_grounding: {
        mode: "uploaded-material-first",
        instruction:
          "Use user directives for scope and presentation, but ground factual slide content, verbatim excerpts, diagrams, and image choices in the supplied context and images. Omit unsupported claims instead of completing them from general knowledge."
      },
      // Images the user supplied. Reference one by its `ref` on an image or
      // image-bullets slide. Only use refs listed here; never invent one.
      available_images: availableImages,
      context: input.context,
      required_json_shape: {
        title: "string",
        language: input.language,
        slides: "array of cover|toc|section|bullets|image|image-bullets|diagram slides"
      }
    },
    null,
    2
  );

  return [
    {
      role: "system",
      content: [systemPrompt, contractPrompt, qualityPrompt].join("\n\n---\n\n")
    },
    {
      role: "user",
      content: withDeckImages(userPayload, input.images ?? [])
    }
  ];
}

function withDeckImages(text: string, images: DeckImageRef[]): string | ChatContentPart[] {
  const visibleImages = images.filter(
    (image): image is DeckImageRef & { dataUri: string } =>
      typeof image.dataUri === "string" && /^data:image\/(?:png|jpeg);base64,/i.test(image.dataUri)
  );

  if (!visibleImages.length) {
    return text;
  }

  return [
    { type: "text", text },
    ...visibleImages.flatMap<ChatContentPart>((image) => [
      {
        type: "text",
        text: `Visual source for available_images ref=${image.ref}${image.source ? `, source=${image.source}` : ""}. Inspect this image directly before deciding whether and where to reuse it.`
      },
      {
        type: "image_url",
        image_url: { url: image.dataUri }
      }
    ])
  ];
}
