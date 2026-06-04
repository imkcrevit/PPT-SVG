export type ExportExtension = "svg" | "png" | "pptx" | "zip";

export function buildExportFilename(sessionId: string, downloadIndex: number, extension: ExportExtension): string {
  const safeSessionId = sanitizeFilenamePart(sessionId) || "download";
  const safeIndex = Math.max(1, Math.floor(downloadIndex));

  return `${safeSessionId}-${safeIndex}.${extension}`;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}
