export function normalizeSessionId(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(trimmed)) {
      return trimmed;
    }
  }

  return crypto.randomUUID();
}

