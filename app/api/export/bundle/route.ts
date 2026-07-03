import JSZip from "jszip";
import { NextResponse } from "next/server";

import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { MAX_GENERATION_JSON_BODY_BYTES } from "@/lib/file-limits";
import { figureToPptx } from "@/lib/pptx";
import { readLimitedJson, securityJson } from "@/lib/request-security";
import { renderFigureSvg } from "@/lib/svg";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = await readLimitedJson(request, MAX_GENERATION_JSON_BODY_BYTES);
    if (!parsed.ok) {
      return securityJson(parsed.decision);
    }
    const body = (parsed.value ?? {}) as Record<string, unknown>;
    const validation = validateAndNormalizeFigureResponse(body, "flow", "en");

    if (!validation.ok || !validation.response) {
      return NextResponse.json({ error: "Invalid Figure JSON.", details: validation.errors }, { status: 400 });
    }

    const { figure, fit } = validation.response;
    const svg = `${renderFigureSvg(figure)}\n`;
    const pptx = await figureToPptx(figure);
    const metadata = {
      exportedAt: new Date().toISOString(),
      sessionId: typeof body?.sessionId === "string" ? body.sessionId : undefined,
      requestId: typeof body?.requestId === "string" ? body.requestId : undefined,
      title: figure.metadata.title,
      description: figure.metadata.description,
      skillId: figure.metadata.skillId,
      language: figure.metadata.language,
      fit
    };

    const zip = new JSZip();
    zip.file("figure.svg", svg);
    zip.file("figure.pptx", pptx);
    zip.file("figure.json", `${JSON.stringify({ figure, fit }, null, 2)}\n`);
    zip.file("metadata.json", `${JSON.stringify(metadata, null, 2)}\n`);

    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    const responseBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="ppt-svg-export.zip"'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected export bundle error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
