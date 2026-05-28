import { NextResponse } from "next/server";

import { AttachmentValidationError, persistAttachment } from "@/lib/attachments";
import { recordAttachment } from "@/lib/mongodb";
import { checkUploadAbuse, enforceUploadContentLength, securityJson } from "@/lib/request-security";
import { normalizeSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const contentLengthDecision = enforceUploadContentLength(request);
    if (!contentLengthDecision.ok) {
      return securityJson(contentLengthDecision);
    }

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

    const uploadDecision = checkUploadAbuse(request, sessionId, file.size);
    if (!uploadDecision.ok) {
      return securityJson(uploadDecision);
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
    const status = error instanceof AttachmentValidationError ? error.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
