import type { ChatMessage } from "@/lib/prompts";

interface OpenRouterChoice {
  message?: {
    content?: OpenRouterContent;
  };
}

type OpenRouterContent = string | Array<{ type?: string; text?: string }>;

interface OpenRouterResponse {
  id?: string;
  choices?: OpenRouterChoice[];
  usage?: unknown;
  error?: {
    message?: string;
  };
}

interface OpenRouterCallOptions {
  model?: string;
  temperature?: number;
  maxCompletionTokens?: number;
  responseFormat?: "json_object" | null;
  timeoutMs?: number;
}

interface LlmProviderConfig {
  apiKey?: string;
  apiKeyLabel: string;
  model?: string;
  modelLabel: string;
  baseUrl: string;
  isOpenRouter: boolean;
}

export interface OpenRouterCallResult {
  text: string;
  model: string;
  generationId?: string;
  usage?: unknown;
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
  const result = await callOpenRouterWithUsage(messages, options);
  return result.text;
}

export async function callOpenRouterWithUsage(
  messages: ChatMessage[],
  options: OpenRouterCallOptions = {}
): Promise<OpenRouterCallResult> {
  const provider = resolveLlmProvider(options);

  if (!provider.apiKey) {
    throw new OpenRouterError(`${provider.apiKeyLabel} is not configured.`, 500);
  }

  if (!provider.model) {
    throw new OpenRouterError(`${provider.modelLabel} is not configured.`, 500);
  }

  let response: Response;

  const controller = new AbortController();
  const timeoutId =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined;

  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...(provider.isOpenRouter && process.env.OPENROUTER_SITE_URL ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL } : {}),
        ...(provider.isOpenRouter && process.env.OPENROUTER_APP_NAME ? { "X-Title": process.env.OPENROUTER_APP_NAME } : {})
      },
      body: JSON.stringify({
        model: provider.model,
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
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new OpenRouterError(
      timedOut && options.timeoutMs
        ? `OpenRouter request timed out after ${Math.round(options.timeoutMs / 1000)}s.`
        : `OpenRouter request could not be loaded: ${detail}`,
      timedOut ? 504 : 502
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
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

  return {
    text,
    model: provider.model,
    generationId: typeof payload.id === "string" ? payload.id : undefined,
    usage: payload.usage
  };
}

export function getConfiguredModelLabel(): string {
  return process.env.OPENROUTER_MODEL || process.env.PPT_SVG_LLM_MODEL || process.env.OPENAI_MODEL || "OPENROUTER_MODEL";
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

function resolveLlmProvider(options: OpenRouterCallOptions): LlmProviderConfig {
  const openRouterBaseUrl = normalizeBaseUrl(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1");
  const genericBaseUrl = normalizeBaseUrl(process.env.PPT_SVG_LLM_BASE_URL || "");
  const openAiBaseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");

  if (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_MODEL || process.env.OPENROUTER_BASE_URL) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY || process.env.PPT_SVG_LLM_API_KEY,
      apiKeyLabel: process.env.OPENROUTER_API_KEY ? "OPENROUTER_API_KEY" : "OPENROUTER_API_KEY or PPT_SVG_LLM_API_KEY",
      model: options.model || process.env.OPENROUTER_MODEL || process.env.PPT_SVG_LLM_MODEL,
      modelLabel: options.model ? "model" : "OPENROUTER_MODEL or PPT_SVG_LLM_MODEL",
      baseUrl: openRouterBaseUrl,
      isOpenRouter: openRouterBaseUrl.includes("openrouter.ai")
    };
  }

  if (process.env.PPT_SVG_LLM_API_KEY || process.env.PPT_SVG_LLM_MODEL || process.env.PPT_SVG_LLM_BASE_URL) {
    return {
      apiKey: process.env.PPT_SVG_LLM_API_KEY,
      apiKeyLabel: "PPT_SVG_LLM_API_KEY",
      model: options.model || process.env.PPT_SVG_LLM_MODEL,
      modelLabel: options.model ? "model" : "PPT_SVG_LLM_MODEL",
      baseUrl: genericBaseUrl || openRouterBaseUrl,
      isOpenRouter: (genericBaseUrl || openRouterBaseUrl).includes("openrouter.ai")
    };
  }

  if (process.env.OPENAI_API_KEY || process.env.OPENAI_MODEL || process.env.OPENAI_BASE_URL) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      apiKeyLabel: "OPENAI_API_KEY",
      model: options.model || process.env.OPENAI_MODEL,
      modelLabel: options.model ? "model" : "OPENAI_MODEL",
      baseUrl: openAiBaseUrl,
      isOpenRouter: false
    };
  }

  return {
    apiKey: undefined,
    apiKeyLabel: "OPENROUTER_API_KEY",
    model: options.model || process.env.OPENROUTER_MODEL,
    modelLabel: options.model ? "model" : "OPENROUTER_MODEL",
    baseUrl: openRouterBaseUrl,
    isOpenRouter: true
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
