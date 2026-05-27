import { NextResponse } from "next/server";

import { persistAttachment } from "@/lib/attachments";
import { recordAttachment } from "@/lib/mongodb";
import { normalizeSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const rawSessionId = formData.get("sessionId");
    const rawConversationId = formData.get("conversationId");
    const sessionId = normalizeSessionId(
      typeof rawSessionId === "string" ? rawSessionId : typeof rawConversationId === "string" ? rawConversationId : undefined
    );
    const conversationId =
      typeof rawConversationId === "string" && rawConversationId.trim() ? rawConversationId.trim() : sessionId;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required." }, { status: 400 });
    }

    const attachment = await persistAttachment(file);
    await recordAttachment({ sessionId, conversationId, attachment });
    console.info("[attachment] stored", {
      sessionId,
      conversationId,
      hash: attachment.hash,
      extension: attachment.extension,
      path: attachment.path,
      size: attachment.size
    });

    return NextResponse.json({ attachment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
