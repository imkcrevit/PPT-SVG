// Shared zip-bomb guard used by both attachment ingestion and theme extraction.
// Kept in its own module (depending on nothing app-level) so attachments.ts and
// theme-extract.ts can both use it without an import cycle.

import type JSZip from "jszip";

const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;

export class AttachmentValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttachmentValidationError";
    this.status = status;
  }
}

export function assertSafeZip(zip: JSZip): void {
  const files = Object.values(zip.files).filter((file) => !file.dir);

  if (files.length > MAX_ZIP_ENTRIES) {
    throw new AttachmentValidationError("Attachment archive contains too many files.");
  }

  let totalUncompressedBytes = 0;
  for (const file of files) {
    const size = zipEntrySize(file);
    // Fail closed: a missing/invalid declared size (a crafted central directory)
    // previously contributed 0 and slipped past the cap, letting a bomb entry
    // expand at decompression time. Reject such archives outright.
    if (size === undefined) {
      throw new AttachmentValidationError("Attachment archive has an entry with an unknown size.", 400);
    }
    totalUncompressedBytes += size;
    if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new AttachmentValidationError("Attachment archive expands to too much data.", 413);
    }
  }
}

function zipEntrySize(file: JSZip.JSZipObject): number | undefined {
  const metadata = file as JSZip.JSZipObject & {
    _data?: {
      uncompressedSize?: number;
    };
  };

  const size = metadata._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : undefined;
}
