import { NextResponse } from "next/server";

import { readLatestGeneratedArtifact } from "@/lib/generated-artifacts";
import { normalizeSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId: rawSessionId } = await context.params;
    const sessionId = normalizeSessionId(rawSessionId);

    if (sessionId !== rawSessionId) {
      return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
    }

    const artifact = await readLatestGeneratedArtifact(sessionId);

    return NextResponse.json(artifact);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return NextResponse.json({ error: "No generated artifact found for this sessionId." }, { status: 404 });
    }

    const message = error instanceof Error ? error.message : "Unexpected session artifact lookup error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

