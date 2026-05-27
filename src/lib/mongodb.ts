import { type Collection, MongoClient } from "mongodb";

import type { Figure, FitAssessment, UploadedAttachment } from "@/lib/types";

let clientPromise: Promise<MongoClient> | undefined;

interface AttachmentRecord {
  conversationId?: string;
  attachment: UploadedAttachment;
}

interface ConversationRecord {
  conversationId?: string;
  conversationTurn?: number;
  requestId: string;
  language: string;
  skillId: string;
  userDescription: string;
  compressedContext?: string;
  attachments: UploadedAttachment[];
  referenceFigure?: {
    source: "current-render";
    figure: Figure;
    fit?: FitAssessment | null;
  };
  clientLog?: {
    messageId?: string;
    sentAt?: string;
  };
  figure?: Figure;
  fit?: FitAssessment;
  artifacts?: unknown;
  model?: string;
  status: "completed" | "failed";
  error?: string;
  durationMs: number;
}

export async function recordAttachment(record: AttachmentRecord): Promise<void> {
  await withCollections(async ({ attachments }) => {
    await attachments.insertOne({
      ...record,
      createdAt: new Date()
    });
  });
}

export async function recordConversation(record: ConversationRecord): Promise<void> {
  await withCollections(async ({ conversations }) => {
    await conversations.insertOne({
      ...record,
      createdAt: new Date()
    });
  });
}

async function withCollections(
  callback: (collections: { attachments: Collection; conversations: Collection }) => Promise<void>
): Promise<void> {
  const db = await getDatabase();

  if (!db) {
    return;
  }

  try {
    await callback({
      attachments: db.collection("attachments"),
      conversations: db.collection("conversations")
    });
  } catch (error) {
    console.warn("[mongodb] record failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

async function getDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    return undefined;
  }

  clientPromise ??= new MongoClient(uri).connect();
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB || "ppt_svg");
}
