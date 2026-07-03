import { NextResponse } from "next/server";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { MAX_GENERATION_JSON_BODY_BYTES } from "@/lib/file-limits";
import { figureToPptx } from "@/lib/pptx";
import { readLimitedJson, securityJson } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = await readLimitedJson(request, MAX_GENERATION_JSON_BODY_BYTES);
    if (!parsed.ok) {
      return securityJson(parsed.decision);
    }
    const body = parsed.value;
    const validation = validateAndNormalizeFigureResponse(body, "flow", "en");

    if (!validation.ok || !validation.response) {
      return NextResponse.json({ error: "Invalid Figure JSON.", details: validation.errors }, { status: 400 });
    }

    const buffer = await figureToPptx(validation.response.figure);
    const responseBody = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": 'attachment; filename="ppt-svg-export.pptx"'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PPTX export error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
