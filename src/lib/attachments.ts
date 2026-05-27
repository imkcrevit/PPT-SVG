import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

import type { UploadedAttachment } from "@/lib/types";

const ALLOWED_EXTENSIONS = new Set(["pdf", "md", "doc", "docx", "png", "jpg", "jpeg", "pptx"]);
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export function isAllowedAttachmentName(fileName: string): boolean {
  return ALLOWED_EXTENSIONS.has(extensionFromName(fileName));
}

export async function persistAttachment(file: File): Promise<UploadedAttachment> {
  const extension = extensionFromName(file.name);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported attachment type.");
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment is too large.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const date = new Date().toISOString().slice(0, 10);
  const directory = path.join("/tmp", "ppt-svg", "uploads", date);
  const storedName = `${hash}.${extension}`;
  const storedPath = path.join(directory, storedName);

  await mkdir(directory, { recursive: true });
  await writeFile(storedPath, bytes);

  return {
    id: randomUUID(),
    originalName: file.name,
    hash,
    extension,
    mimeType: file.type || mimeTypeFromExtension(extension),
    size: file.size,
    path: storedPath,
    extractedText: await extractInlineText(extension, bytes)
  };
}

async function extractInlineText(extension: string, bytes: Buffer): Promise<string | undefined> {
  if (extension === "md") {
    return cleanText(bytes.toString("utf8")).slice(0, 60000);
  }

  if (extension === "docx") {
    return extractZipXmlText(bytes, (fileName) => fileName === "word/document.xml");
  }

  if (extension === "pptx") {
    return extractZipXmlText(bytes, (fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName));
  }

  return undefined;
}

async function extractZipXmlText(bytes: Buffer, includeFile: (fileName: string) => boolean): Promise<string | undefined> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const parts = await Promise.all(
      Object.values(zip.files)
        .filter((file) => !file.dir && includeFile(file.name))
        .map(async (file) => xmlText(await file.async("string")))
    );
    const text = cleanText(parts.join(" "));
    return text ? text.slice(0, 60000) : undefined;
  } catch {
    return undefined;
  }
}

function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extensionFromName(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function mimeTypeFromExtension(extension: string): string {
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "md":
      return "text/markdown";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "application/octet-stream";
  }
}
