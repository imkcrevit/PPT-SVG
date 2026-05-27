import { NextResponse } from "next/server";

import { persistAttachment } from "@/lib/attachments";
import { recordAttachment } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const conversationId = typeof formData.get("conversationId") === "string" ? String(formData.get("conversationId")) : "";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required." }, { status: 400 });
    }

    const attachment = await persistAttachment(file);
    await recordAttachment({ conversationId, attachment });
    console.info("[attachment] stored", {
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
