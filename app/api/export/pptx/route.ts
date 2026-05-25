import { NextResponse } from "next/server";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { figureToPptx } from "@/lib/pptx";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
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
