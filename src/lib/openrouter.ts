import type { ChatMessage } from "@/lib/prompts";

interface OpenRouterChoice {
  message?: {
    content?: OpenRouterContent;
  };
}

type OpenRouterContent = string | Array<{ type?: string; text?: string }>;

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: {
    message?: string;
  };
}

interface OpenRouterCallOptions {
  model?: string;
  temperature?: number;
  maxCompletionTokens?: number;
  responseFormat?: "json_object" | null;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message);
  }
}

export async function callOpenRouter(messages: ChatMessage[], options: OpenRouterCallOptions = {}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = options.model || process.env.OPENROUTER_MODEL;

  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured.", 500);
  }

  if (!model) {
    throw new OpenRouterError("OPENROUTER_MODEL is not configured.", 500);
  }

  let response: Response;

  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        ...(process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.25,
        max_completion_tokens: options.maxCompletionTokens ?? 4000,
        ...(options.responseFormat === null
          ? {}
          : {
              response_format: {
                type: options.responseFormat ?? "json_object"
              }
            })
      })
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new OpenRouterError(`OpenRouter request could not be loaded: ${detail}`, 502);
  }

  const payload = (await response.json().catch(() => ({}))) as OpenRouterResponse;

  if (!response.ok) {
    throw new OpenRouterError(
      payload.error?.message ?? `OpenRouter request failed with status ${response.status}.`,
      response.status
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  const text = flattenContent(content);

  if (!text) {
    throw new OpenRouterError("OpenRouter response did not include assistant content.", 502);
  }

  return text;
}

export function getConfiguredModelLabel(): string {
  return process.env.OPENROUTER_MODEL || "OPENROUTER_MODEL";
}

export function getConfiguredVisionModelLabel(): string {
  return process.env.OPENROUTER_VISION_MODEL || getConfiguredModelLabel();
}

function flattenContent(content: OpenRouterContent | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" || !part.type ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return "";
}
