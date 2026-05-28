import { NextResponse } from "next/server";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_GENERATION_ATTACHMENT_BYTES,
  MAX_GENERATION_ATTACHMENTS,
  MAX_GENERATION_JSON_BODY_BYTES,
  MAX_GENERATION_PROMPT_CHARS,
  MAX_REFERENCE_FIGURE_CHARS,
  MAX_UPLOAD_REQUEST_BYTES,
  isAllowedAttachmentExtension
} from "@/lib/file-limits";
import type { UploadedAttachment } from "@/lib/types";

interface RateBucket {
  count: number;
  resetAt: number;
}

interface ActiveBucket {
  count: number;
}

export type SecurityDecision =
  | { ok: true }
  | {
      ok: false;
      error: string;
      status: number;
      retryAfterSeconds?: number;
    };

type GenerationGuard =
  | { ok: true; release: () => void }
  | {
      ok: false;
      error: string;
      status: number;
      retryAfterSeconds?: number;
    };

interface GenerationPayloadForSecurity {
  userDescription?: unknown;
  pptContext?: unknown;
  attachments?: unknown;
  referenceFigure?: unknown;
}

const globalSecurityStore = globalThis as typeof globalThis & {
  __pptSvgRateBuckets?: Map<string, RateBucket>;
  __pptSvgActiveBuckets?: Map<string, ActiveBucket>;
};

const rateBuckets = globalSecurityStore.__pptSvgRateBuckets ?? new Map<string, RateBucket>();
const activeBuckets = globalSecurityStore.__pptSvgActiveBuckets ?? new Map<string, ActiveBucket>();
globalSecurityStore.__pptSvgRateBuckets = rateBuckets;
globalSecurityStore.__pptSvgActiveBuckets = activeBuckets;

const RATE_LIMIT_STATUS = 429;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanupAt = 0;

export function securityJson(decision: Exclude<SecurityDecision, { ok: true }>): NextResponse {
  const response = NextResponse.json({ error: decision.error }, { status: decision.status });

  if (decision.retryAfterSeconds) {
    response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  }

  return response;
}

export function enforceContentLength(request: Request, maxBytes: number, label: string): SecurityDecision {
  const contentLength = request.headers.get("content-length");

  if (!contentLength) {
    return { ok: true };
  }

  const bytes = Number(contentLength);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return { ok: false, error: "Invalid content length.", status: 400 };
  }

  if (bytes > maxBytes) {
    return { ok: false, error: `${label} is too large.`, status: 413 };
  }

  return { ok: true };
}

export function enforceUploadContentLength(request: Request): SecurityDecision {
  return enforceContentLength(request, MAX_UPLOAD_REQUEST_BYTES, "Upload request");
}

export function enforceGenerationContentLength(request: Request): SecurityDecision {
  return enforceContentLength(request, MAX_GENERATION_JSON_BODY_BYTES, "Generation request");
}

export function checkUploadAbuse(request: Request, sessionId: string, fileSize: number): SecurityDecision {
  const clientKey = clientRateKey(request);
  return firstBlocked([
    () => hitRateLimit(`upload-count:session:${sessionId}`, 12, 60 * 60 * 1000),
    () => hitRateLimit(`upload-count:${clientKey}`, 60, 60 * 60 * 1000),
    () => hitRateLimit(`upload-bytes:session:${sessionId}`, 48 * 1024 * 1024, 60 * 60 * 1000, fileSize),
    () => hitRateLimit(`upload-bytes:${clientKey}`, 192 * 1024 * 1024, 60 * 60 * 1000, fileSize)
  ]);
}

export function checkGenerationAbuse(request: Request, sessionId: string): SecurityDecision {
  const clientKey = clientRateKey(request);
  return firstBlocked([
    () => hitRateLimit(`generation-minute:session:${sessionId}`, 3, 60 * 1000),
    () => hitRateLimit(`generation-hour:session:${sessionId}`, 15, 60 * 60 * 1000),
    () => hitRateLimit(`generation-minute:${clientKey}`, 8, 60 * 1000),
    () => hitRateLimit(`generation-hour:${clientKey}`, 60, 60 * 60 * 1000)
  ]);
}

export function checkOptimizeAbuse(request: Request, sessionId: string): SecurityDecision {
  const clientKey = clientRateKey(request);
  return firstBlocked([
    () => hitRateLimit(`optimize-minute:session:${sessionId}`, 6, 60 * 1000),
    () => hitRateLimit(`optimize-hour:session:${sessionId}`, 30, 60 * 60 * 1000),
    () => hitRateLimit(`optimize-minute:${clientKey}`, 20, 60 * 1000),
    () => hitRateLimit(`optimize-hour:${clientKey}`, 120, 60 * 60 * 1000)
  ]);
}

export function beginGenerationGuard(request: Request, sessionId: string): GenerationGuard {
  const clientKey = clientRateKey(request);
  const sessionDecision = incrementActive(`active-generation:session:${sessionId}`, 1);

  if (!sessionDecision.ok) {
    return sessionDecision;
  }

  const clientDecision = incrementActive(`active-generation:${clientKey}`, 3);
  if (!clientDecision.ok) {
    decrementActive(`active-generation:session:${sessionId}`);
    return clientDecision;
  }

  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) {
        return;
      }

      released = true;
      decrementActive(`active-generation:${clientKey}`);
      decrementActive(`active-generation:session:${sessionId}`);
    }
  };
}

export function validateGenerationPayload(body: GenerationPayloadForSecurity): SecurityDecision {
  const description = typeof body.userDescription === "string" ? body.userDescription.trim() : "";

  if (description.length > MAX_GENERATION_PROMPT_CHARS) {
    return {
      ok: false,
      error: `userDescription must be ${MAX_GENERATION_PROMPT_CHARS} characters or fewer.`,
      status: 400
    };
  }

  const pptContext = body.pptContext && typeof body.pptContext === "object" ? body.pptContext as Record<string, unknown> : undefined;
  if (typeof pptContext?.extractedText === "string" && pptContext.extractedText.length > MAX_EXTRACTED_TEXT_CHARS) {
    return { ok: false, error: "pptContext extractedText is too large.", status: 400 };
  }

  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (attachments.length > MAX_GENERATION_ATTACHMENTS) {
    return {
      ok: false,
      error: `At most ${MAX_GENERATION_ATTACHMENTS} attachments can be used in one generation request.`,
      status: 400
    };
  }

  let totalAttachmentBytes = 0;
  for (const item of attachments) {
    const attachment = sanitizeUploadedAttachment(item);

    if (!attachment) {
      return { ok: false, error: "Invalid attachment metadata.", status: 400 };
    }

    totalAttachmentBytes += attachment.size;
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "Attachment metadata exceeds the file size limit.", status: 400 };
    }
  }

  if (totalAttachmentBytes > MAX_GENERATION_ATTACHMENT_BYTES) {
    return { ok: false, error: "Total attachment size for this request is too large.", status: 400 };
  }

  if (body.referenceFigure) {
    const referenceSize = JSON.stringify(body.referenceFigure).length;
    if (referenceSize > MAX_REFERENCE_FIGURE_CHARS) {
      return { ok: false, error: "Reference figure payload is too large.", status: 400 };
    }
  }

  return { ok: true };
}

export function sanitizeUploadedAttachments(value: unknown): UploadedAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_GENERATION_ATTACHMENTS)
    .map(sanitizeUploadedAttachment)
    .filter((attachment): attachment is UploadedAttachment => Boolean(attachment));
}

function sanitizeUploadedAttachment(value: unknown): UploadedAttachment | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.originalName !== "string" ||
    typeof record.hash !== "string" ||
    typeof record.extension !== "string" ||
    typeof record.mimeType !== "string" ||
    typeof record.size !== "number" ||
    typeof record.path !== "string"
  ) {
    return undefined;
  }

  const extension = record.extension.toLowerCase();
  if (
    !isAllowedAttachmentExtension(extension) ||
    !/^[a-f0-9]{64}$/i.test(record.hash) ||
    !Number.isFinite(record.size) ||
    record.size <= 0 ||
    record.size > MAX_ATTACHMENT_BYTES ||
    !record.path.startsWith("/tmp/ppt-svg/uploads/")
  ) {
    return undefined;
  }

  const extractedText =
    typeof record.extractedText === "string"
      ? record.extractedText.slice(0, MAX_EXTRACTED_TEXT_CHARS)
      : undefined;

  return {
    id: record.id.slice(0, 128),
    originalName: record.originalName.slice(0, 160),
    hash: record.hash.toLowerCase(),
    extension,
    mimeType: record.mimeType.slice(0, 120),
    size: record.size,
    path: record.path,
    extractedText
  };
}

function firstBlocked(checks: Array<() => SecurityDecision>): SecurityDecision {
  for (const check of checks) {
    const decision = check();

    if (!decision.ok) {
      return decision;
    }
  }

  return { ok: true };
}

function hitRateLimit(key: string, limit: number, windowMs: number, cost = 1): SecurityDecision {
  const now = Date.now();
  cleanupBuckets(now);

  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };

  if (bucket.count + cost > limit) {
    return {
      ok: false,
      error: "Too many requests. Please wait before trying again.",
      status: RATE_LIMIT_STATUS,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  bucket.count += cost;
  rateBuckets.set(key, bucket);
  return { ok: true };
}

function incrementActive(key: string, limit: number): SecurityDecision {
  const bucket = activeBuckets.get(key) ?? { count: 0 };

  if (bucket.count >= limit) {
    return {
      ok: false,
      error: "A generation request is already running. Please wait for it to finish.",
      status: RATE_LIMIT_STATUS,
      retryAfterSeconds: 10
    };
  }

  bucket.count += 1;
  activeBuckets.set(key, bucket);
  return { ok: true };
}

function decrementActive(key: string): void {
  const bucket = activeBuckets.get(key);

  if (!bucket) {
    return;
  }

  bucket.count -= 1;
  if (bucket.count <= 0) {
    activeBuckets.delete(key);
  } else {
    activeBuckets.set(key, bucket);
  }
}

function cleanupBuckets(now: number): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return;
  }

  lastCleanupAt = now;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}

function clientRateKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  const raw = forwardedFor || realIp || cfIp || "unknown";
  return `ip:${raw.replace(/[^a-zA-Z0-9.:_-]/g, "").slice(0, 80) || "unknown"}`;
}
