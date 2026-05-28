export function parseJsonObject(content: string): unknown {
  const trimmed = stripCodeFence(content.trim());

  try {
    return JSON.parse(trimmed);
  } catch {
    const objectSource = extractFirstJsonObject(trimmed);

    if (!objectSource) {
      throw new Error("Model response did not contain a JSON object.");
    }

    return JSON.parse(objectSource);
  }
}

function stripCodeFence(value: string): string {
  if (!value.startsWith("```")) {
    return value;
  }

  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");

  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return undefined;
}
