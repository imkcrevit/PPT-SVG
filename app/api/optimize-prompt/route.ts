import { NextResponse } from "next/server";

import { isLocale } from "@/lib/i18n";
import { parseJsonObject } from "@/lib/json";
import { callOpenRouter, OpenRouterError } from "@/lib/openrouter";
import {
  checkOptimizeAbuse,
  enforceGenerationContentLength,
  securityJson,
  validateGenerationPayload
} from "@/lib/request-security";
import { normalizeSessionId } from "@/lib/session";
import { isSkillId } from "@/lib/skills";
import type { ChatMessage } from "@/lib/prompts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentLengthDecision = enforceGenerationContentLength(request);

  if (!contentLengthDecision.ok) {
    return securityJson(contentLengthDecision);
  }

  try {
    const body = (await request.json()) as {
      userDescription?: string;
      language?: string;
      skillId?: string;
      sessionId?: string;
      conversationId?: string;
      conversationTurn?: number;
      referenceFigure?: unknown;
    };
    const payloadDecision = validateGenerationPayload(body);

    if (!payloadDecision.ok) {
      return securityJson(payloadDecision);
    }

    if (!body.userDescription?.trim()) {
      return NextResponse.json({ error: "userDescription is required." }, { status: 400 });
    }

    if (!body.language || !isLocale(body.language)) {
      return NextResponse.json({ error: "Invalid language." }, { status: 400 });
    }

    if (!body.skillId || !isSkillId(body.skillId)) {
      return NextResponse.json({ error: "Invalid skillId." }, { status: 400 });
    }

    const sessionId = normalizeSessionId(body.sessionId ?? body.conversationId);
    const abuseDecision = checkOptimizeAbuse(request, sessionId);
    if (!abuseDecision.ok) {
      return securityJson(abuseDecision);
    }

    const rawOutput = await callOpenRouter(buildOptimizeMessages(body));
    const parsed = parseJsonObject(rawOutput) as Record<string, unknown>;
    const optimizedDescription =
      typeof parsed.optimized_description === "string" ? parsed.optimized_description.trim() : "";

    if (!optimizedDescription) {
      return NextResponse.json({ error: "The optimizer did not return an optimized description." }, { status: 502 });
    }

    return NextResponse.json({ optimizedDescription });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unexpected prompt optimization error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildOptimizeMessages(body: {
  userDescription?: string;
  language?: string;
  skillId?: string;
  sessionId?: string;
  conversationId?: string;
  conversationTurn?: number;
  referenceFigure?: unknown;
}): ChatMessage[] {
  const outputLanguage = body.language === "zh" ? "Simplified Chinese" : "English";

  return [
    {
      role: "system",
      content:
        "You optimize user requests for a PPT SVG diagram generator. Return only JSON with optimized_description. Only improve wording, clarity, grammar, and ambiguity. Preserve the original scope exactly. Do not expand the request, add steps, add examples, add structure, add design details, or invent facts. Keep the optimized text concise and no longer than the user's original request unless grammar requires a few extra words. Preserve every explicit item, sequence, relationship, label, constraint, and revision. Do not drop the first or last item in chains such as A -> B -> C. Preserve scoped entities and qualifiers: A系统中的B子系统 must not become only B子系统. Preserve named intermediaries such as X中间件 in relationships like B通过X访问C. If the user's purpose is unclear, keep that uncertainty explicit instead of choosing a default purpose."
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          output_language: outputLanguage,
          selected_skill: body.skillId,
          conversation_turn: body.conversationTurn ?? 1,
          user_description: body.userDescription,
          has_reference_current_render: Boolean(body.referenceFigure),
          required_json_shape: {
            optimized_description: "string"
          }
        },
        null,
        2
      )
    }
  ];
}
