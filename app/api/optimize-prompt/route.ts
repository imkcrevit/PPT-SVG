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
      content: [
        "You turn a rough, often non-expert diagram request into a clear, well-structured description that a diagram generator can render well. Users come from any field and usually under-specify. Make the request concrete and organized WITHOUT changing what they actually want.",
        "",
        "Expand and structure:",
        "- Infer the diagram's intent and shape (a process/flow, a layered architecture, stages with sub-steps, etc.).",
        "- Name the main stages / components clearly.",
        "- Decompose: when a stage or component obviously contains several parts, list those concrete sub-items as separate items grouped under their stage. Do not leave a vague blob, and do not cram several items into one name.",
        "- Where the domain naturally implies them, note key relationships: the main sequence plus any feedback / retry / optional / external links.",
        "- Fill in only structure that is commonly true for the domain. Do NOT invent specific false facts (product names, vendors, exact numbers, technologies) the user did not state or clearly imply; describe roles generically (e.g. \"a message queue\" rather than naming one).",
        "- Be richer than the input when the input is sparse; do not pad with filler.",
        "",
        "Preserve faithfully (never lose user intent while expanding):",
        "- Keep every explicit item, sequence, relationship, label, constraint, and revision.",
        "- Do not drop the first or last item in chains such as A -> B -> C.",
        "- Preserve scoped entities and qualifiers: A系统中的B子系统 must not become only B子系统.",
        "- Preserve named intermediaries such as X中间件 in relationships like B通过X访问C.",
        "- If the user's purpose is genuinely unclear, keep that uncertainty explicit instead of inventing a wrong purpose.",
        "",
        "Output rules:",
        "- Write the entire optimized_description in the active output language. If output_language is Simplified Chinese, write it in Simplified Chinese; never translate the user's content into English.",
        "- Do not add coordinates, colors, sizes, or visual styling instructions; describe content and structure only.",
        "- Return ONLY JSON: { \"optimized_description\": string }. No markdown, no prose outside the JSON."
      ].join("\n")
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
