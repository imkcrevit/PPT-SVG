import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_NAME_CHARS,
  MAX_EXTRACTED_TEXT_CHARS,
  extensionFromFileName,
  isAllowedAttachmentExtension
} from "@/lib/file-limits";
import type { AttachmentImage, UploadedAttachment } from "@/lib/types";
import { extractTheme } from "@/lib/theme-extract";
import { AttachmentValidationError, assertSafeZip } from "@/lib/zip-safety";
import { scheduleArtifactReap } from "@/lib/artifact-cleanup";

export { AttachmentValidationError } from "@/lib/zip-safety";

export function isAllowedAttachmentName(fileName: string): boolean {
  return isAllowedAttachmentExtension(extensionFromFileName(fileName));
}

export async function persistAttachment(file: File): Promise<UploadedAttachment> {
  const originalName = normalizeOriginalName(file.name);
  const extension = extensionFromFileName(originalName);

  if (!isAllowedAttachmentExtension(extension)) {
    throw new AttachmentValidationError("Unsupported attachment type.", 415);
  }

  if (file.size <= 0) {
    throw new AttachmentValidationError("Attachment is empty.");
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError("Attachment is too large.", 413);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  await assertAttachmentContent(extension, bytes);

  const hash = createHash("sha256").update(bytes).digest("hex");
  const date = new Date().toISOString().slice(0, 10);
  const directory = path.join("/tmp", "ppt-svg", "uploads", date);
  const storedName = `${hash}.${extension}`;
  const storedPath = path.join(directory, storedName);

  scheduleArtifactReap();
  await mkdir(directory, { recursive: true });
  await writeFile(storedPath, bytes);

  return {
    id: randomUUID(),
    originalName,
    hash,
    extension,
    mimeType: file.type || mimeTypeFromExtension(extension),
    size: file.size,
    path: storedPath,
    extractedText: await extractInlineText(extension, bytes),
    theme: await extractTheme(extension, bytes),
    images: await extractImages(extension, bytes, originalName)
  };
}

// ── Image extraction ─────────────────────────────────────────────────────────
// Pull embeddable images out of an upload: a standalone png/jpg IS the image;
// a pptx/docx yields its ppt/media|word/media pictures. Everything is downscaled
// to a slide-safe size so the base64 that ends up in a figure stays bounded.
const MAX_IMAGE_DIM = 1200; // px, longest edge after downscale
const MAX_IMAGES_PER_FILE = 24;
const MIN_IMAGE_DIM = 80; // skip bullets/icons/logos smaller than this
const RASTER_MEDIA_RE = /\.(png|jpe?g)$/i;

async function downscaleToDataUri(buf: Buffer, source: string): Promise<AttachmentImage | undefined> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    if ((meta.width ?? 0) < MIN_IMAGE_DIM && (meta.height ?? 0) < MIN_IMAGE_DIM) {
      return undefined; // decorative/icon — not worth embedding
    }
    // Keep PNG only when the alpha channel is actually used; an opaque PNG
    // re-encodes to a far smaller JPEG (base64 travels through the deck payload).
    let needsAlpha = false;
    if (meta.hasAlpha === true) {
      try {
        needsAlpha = !(await sharp(buf).stats()).isOpaque;
      } catch {
        needsAlpha = true;
      }
    }
    const pipeline = sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: MAX_IMAGE_DIM, height: MAX_IMAGE_DIM, fit: "inside", withoutEnlargement: true });
    const { data, info } = needsAlpha
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
    const mimeType = info.format === "png" ? "image/png" : "image/jpeg";
    return {
      id: randomUUID(),
      dataUri: `data:${mimeType};base64,${data.toString("base64")}`,
      width: info.width,
      height: info.height,
      mimeType,
      source
    };
  } catch {
    return undefined;
  }
}

async function extractImages(extension: string, bytes: Buffer, originalName: string): Promise<AttachmentImage[] | undefined> {
  try {
    if (extension === "png" || extension === "jpg" || extension === "jpeg") {
      const img = await downscaleToDataUri(bytes, originalName);
      return img ? [img] : undefined;
    }
    if (extension === "pptx" || extension === "docx") {
      const zip = await JSZip.loadAsync(bytes);
      assertSafeZip(zip);
      const prefix = extension === "pptx" ? /^ppt\/media\// : /^word\/media\//;
      const entries = Object.values(zip.files)
        .filter((file) => !file.dir && prefix.test(file.name) && RASTER_MEDIA_RE.test(file.name))
        .slice(0, MAX_IMAGES_PER_FILE);
      const images: AttachmentImage[] = [];
      for (const entry of entries) {
        const buf = Buffer.from(await entry.async("uint8array"));
        const img = await downscaleToDataUri(buf, `${originalName} · ${entry.name.split("/").pop()}`);
        if (img) images.push(img);
      }
      return images.length ? images : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function extractInlineText(extension: string, bytes: Buffer): Promise<string | undefined> {
  if (extension === "md") {
    return cleanText(bytes.toString("utf8")).slice(0, MAX_EXTRACTED_TEXT_CHARS);
  }

  if (extension === "pdf") {
    return extractPdfText(bytes);
  }

  if (extension === "docx") {
    return extractZipXmlText(bytes, (fileName) => fileName === "word/document.xml");
  }

  if (extension === "pptx") {
    return extractZipXmlText(bytes, (fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName));
  }

  return undefined;
}

// PDF text extraction via unpdf (a Node/serverless-friendly pdf.js build).
// Imported lazily so pdf.js only loads when a PDF is actually uploaded, and
// wrapped so a scanned/encrypted/broken PDF degrades to "no text" instead of
// throwing.
async function extractPdfText(bytes: Buffer): Promise<string | undefined> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    const cleaned = cleanText(merged);
    return cleaned ? cleaned.slice(0, MAX_EXTRACTED_TEXT_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

async function extractZipXmlText(bytes: Buffer, includeFile: (fileName: string) => boolean): Promise<string | undefined> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    assertSafeZip(zip);
    const parts = await Promise.all(
      Object.values(zip.files)
        .filter((file) => !file.dir && includeFile(file.name))
        .map(async (file) => xmlText(await file.async("string")))
    );
    const text = cleanText(parts.join(" "));
    return text ? text.slice(0, MAX_EXTRACTED_TEXT_CHARS) : undefined;
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

function normalizeOriginalName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop()?.trim() ?? "";

  if (!name) {
    throw new AttachmentValidationError("Attachment file name is required.");
  }

  if (name.length > MAX_ATTACHMENT_NAME_CHARS || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new AttachmentValidationError("Attachment file name is invalid.");
  }

  return name;
}

async function assertAttachmentContent(extension: string, bytes: Buffer): Promise<void> {
  if (bytes.length === 0) {
    throw new AttachmentValidationError("Attachment is empty.");
  }

  if (extension === "pdf" && !startsWithAscii(bytes, "%PDF-")) {
    throw new AttachmentValidationError("PDF attachment does not look like a valid PDF.");
  }

  if (extension === "png" && !startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    throw new AttachmentValidationError("PNG attachment does not look like a valid PNG.");
  }

  if ((extension === "jpg" || extension === "jpeg") && !startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    throw new AttachmentValidationError("JPEG attachment does not look like a valid JPEG.");
  }

  if (extension === "doc" && !startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw new AttachmentValidationError("DOC attachment does not look like a valid Word document.");
  }

  if (extension === "md") {
    assertTextBytes(bytes);
  }

  if (extension === "docx" || extension === "pptx") {
    if (!startsWithAscii(bytes, "PK")) {
      throw new AttachmentValidationError("Office attachment does not look like a valid ZIP-based document.");
    }

    const zip = await JSZip.loadAsync(bytes).catch(() => undefined);
    if (!zip) {
      throw new AttachmentValidationError("Office attachment could not be opened.");
    }

    assertSafeZip(zip);
    const entries = Object.keys(zip.files);
    const hasRequiredEntry =
      extension === "docx"
        ? entries.includes("word/document.xml")
        : entries.includes("ppt/presentation.xml") || entries.some((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry));

    if (!hasRequiredEntry) {
      throw new AttachmentValidationError("Office attachment structure is invalid.");
    }
  }
}

function assertTextBytes(bytes: Buffer): void {
  if (bytes.includes(0)) {
    throw new AttachmentValidationError("Markdown attachment contains binary data.");
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AttachmentValidationError("Markdown attachment must be valid UTF-8 text.");
  }
}


function startsWithAscii(bytes: Buffer, value: string): boolean {
  return bytes.subarray(0, value.length).equals(Buffer.from(value, "ascii"));
}

function startsWithBytes(bytes: Buffer, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}
