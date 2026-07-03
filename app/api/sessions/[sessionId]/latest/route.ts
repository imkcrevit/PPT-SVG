import { NextResponse } from "next/server";

import { readLatestGeneratedArtifact } from "@/lib/generated-artifacts";
import { checkSessionReadAbuse, securityJson } from "@/lib/request-security";
import { normalizeSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    const abuseDecision = checkSessionReadAbuse(request);
    if (!abuseDecision.ok) {
      return securityJson(abuseDecision);
    }

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

    // Don't echo internal error details (paths, stack) to the client.
    console.error(`[sessions:latest:${requestId}] lookup failed`, error);
    return NextResponse.json({ error: "Session artifact lookup failed.", requestId }, { status: 500 });
  }
}

