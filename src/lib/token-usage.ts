import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  costUsd?: number;
}

export interface TokenUsageEntry {
  id: string;
  sessionId: string;
  conversationId?: string;
  conversationTurn?: number;
  requestId?: string;
  operation: string;
  model?: string;
  generationId?: string;
  usage: TokenUsage;
  createdAt: string;
}

export interface TokenUsageSnapshot {
  current: TokenUsage;
  sessionTotal: TokenUsage;
  history: TokenUsageEntry[];
  logPath: string;
}

interface TokenUsageRecorderContext {
  sessionId: string;
  conversationId?: string;
  conversationTurn?: number;
  requestId?: string;
}

interface TokenUsageRecordInput {
  operation: string;
  usage?: TokenUsage;
  model?: string;
  generationId?: string;
}

const TOKEN_USAGE_LOG_NAME = "token-usage.jsonl";
const MAX_HISTORY_ENTRIES = 50;

export function normalizeTokenUsage(raw: unknown): TokenUsage | undefined {
  const record = asRecord(raw);

  if (!record) {
    return undefined;
  }

  const promptTokens = readNumber(record.prompt_tokens);
  const completionTokens = readNumber(record.completion_tokens);
  const totalTokens = readNumber(record.total_tokens);
  const promptDetails = asRecord(record.prompt_tokens_details);
  const completionDetails = asRecord(record.completion_tokens_details);
  const reasoningTokens = readNumber(completionDetails?.reasoning_tokens);
  const cachedTokens = readNumber(promptDetails?.cached_tokens);
  const costUsd = readNumber(record.cost);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined &&
    cachedTokens === undefined &&
    costUsd === undefined
  ) {
    return undefined;
  }

  const normalizedPrompt = promptTokens ?? 0;
  const normalizedCompletion = completionTokens ?? 0;
  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens: totalTokens ?? normalizedPrompt + normalizedCompletion,
    reasoningTokens: reasoningTokens ?? 0,
    cachedTokens: cachedTokens ?? 0,
    costUsd
  };
}

export function createTokenUsageRecorder(context: TokenUsageRecorderContext) {
  const entries: TokenUsageEntry[] = [];

  return {
    entries,
    async record(input: TokenUsageRecordInput): Promise<void> {
      if (!input.usage) {
        return;
      }

      const entry = await recordTokenUsage({
        ...context,
        operation: input.operation,
        model: input.model,
        generationId: input.generationId,
        usage: input.usage
      });
      entries.push(entry);
    },
    async snapshot(): Promise<TokenUsageSnapshot> {
      return buildTokenUsageSnapshot(context.sessionId, entries);
    }
  };
}

export async function recordTokenUsage(input: Omit<TokenUsageEntry, "id" | "createdAt">): Promise<TokenUsageEntry> {
  const entry: TokenUsageEntry = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  const logPath = tokenUsageLogPath(input.sessionId);

  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function buildTokenUsageSnapshot(
  sessionId: string,
  currentEntries: TokenUsageEntry[],
  historyLimit = MAX_HISTORY_ENTRIES
): Promise<TokenUsageSnapshot> {
  const history = await readTokenUsageHistory(sessionId);

  return {
    current: summarizeTokenUsage(currentEntries),
    sessionTotal: summarizeTokenUsage(history),
    history: history.slice(-historyLimit).reverse(),
    logPath: tokenUsageLogPath(sessionId)
  };
}

export async function readTokenUsageHistory(sessionId: string): Promise<TokenUsageEntry[]> {
  try {
    const raw = await readFile(tokenUsageLogPath(sessionId), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseTokenUsageEntry)
      .filter((entry): entry is TokenUsageEntry => Boolean(entry));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    console.warn("[token-usage] read failed", { message: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

export function summarizeTokenUsage(entries: TokenUsageEntry[]): TokenUsage {
  return entries.reduce((total, entry) => addTokenUsage(total, entry.usage), emptyTokenUsage());
}

export function emptyTokenUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0
  };
}

function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    costUsd:
      a.costUsd === undefined && b.costUsd === undefined
        ? undefined
        : (a.costUsd ?? 0) + (b.costUsd ?? 0)
  };
}

function tokenUsageLogPath(sessionId: string): string {
  return path.join("/tmp", "ppt-svg", "sessions", safePathSegment(sessionId), TOKEN_USAGE_LOG_NAME);
}

function parseTokenUsageEntry(line: string): TokenUsageEntry | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    const record = asRecord(parsed);
    const usage = normalizeEntryUsage(record?.usage);

    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.sessionId !== "string" ||
      typeof record.operation !== "string" ||
      typeof record.createdAt !== "string" ||
      !usage
    ) {
      return undefined;
    }

    return {
      id: record.id,
      sessionId: record.sessionId,
      conversationId: typeof record.conversationId === "string" ? record.conversationId : undefined,
      conversationTurn:
        typeof record.conversationTurn === "number" && Number.isFinite(record.conversationTurn)
          ? record.conversationTurn
          : undefined,
      requestId: typeof record.requestId === "string" ? record.requestId : undefined,
      operation: record.operation,
      model: typeof record.model === "string" ? record.model : undefined,
      generationId: typeof record.generationId === "string" ? record.generationId : undefined,
      usage,
      createdAt: record.createdAt
    };
  } catch {
    return undefined;
  }
}

function normalizeEntryUsage(value: unknown): TokenUsage | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const promptTokens = readNumber(record.promptTokens) ?? 0;
  const completionTokens = readNumber(record.completionTokens) ?? 0;
  const totalTokens = readNumber(record.totalTokens) ?? promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens: readNumber(record.reasoningTokens) ?? 0,
    cachedTokens: readNumber(record.cachedTokens) ?? 0,
    costUsd: readNumber(record.costUsd)
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 160) || "unknown-session";
}
