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

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message);
  }
}

export async function callOpenRouter(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured.", 500);
  }

  if (!model) {
    throw new OpenRouterError("OPENROUTER_MODEL is not configured.", 500);
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
      temperature: 0.25,
      max_completion_tokens: 4000,
      response_format: {
        type: "json_object"
      }
    })
  });

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
