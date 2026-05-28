export const ALLOWED_ATTACHMENT_EXTENSIONS = ["pdf", "md", "doc", "docx", "png", "jpg", "jpeg", "pptx"] as const;
export const ACCEPTED_CONTEXT_EXTENSIONS = ALLOWED_ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`);
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME_CHARS = 160;
export const MAX_EXTRACTED_TEXT_CHARS = 60_000;
export const MAX_GENERATION_ATTACHMENTS = 3;
export const MAX_GENERATION_ATTACHMENT_BYTES = 24 * 1024 * 1024;
export const MAX_GENERATION_PROMPT_CHARS = 4_000;
export const MAX_GENERATION_JSON_BODY_BYTES = 900_000;
export const MAX_UPLOAD_REQUEST_BYTES = MAX_ATTACHMENT_BYTES + 1_000_000;
export const MAX_REFERENCE_FIGURE_CHARS = 450_000;

export type AttachmentExtension = (typeof ALLOWED_ATTACHMENT_EXTENSIONS)[number];

export function isAllowedAttachmentExtension(value: string): value is AttachmentExtension {
  return ALLOWED_ATTACHMENT_EXTENSIONS.includes(value.toLowerCase() as AttachmentExtension);
}

export function extensionFromFileName(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}
