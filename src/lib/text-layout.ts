const DEFAULT_MAX_LINES = 4;

export function sanitizeXmlText(value: string): string {
  return Array.from(value)
    .filter((char) => isAllowedXmlChar(char.codePointAt(0) ?? 0))
    .join("");
}

export function sanitizeDisplayText(value: string): string {
  return sanitizeXmlText(value).replace(/\s+/g, " ").trim();
}

export function wrapSvgText(text: string, width: number, fontSize: number, maxLines = DEFAULT_MAX_LINES): string[] {
  const cleanText = sanitizeDisplayText(text);

  if (!cleanText) {
    return [""];
  }

  const maxWidth = Math.max(fontSize * 2.4, width);
  const granular = hasCjkText(cleanText);
  const tokens = granular ? Array.from(cleanText) : cleanText.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  let truncated = false;

  for (const token of tokens) {
    if (!token) {
      continue;
    }

    const candidate = appendToken(current, token, granular);

    if (measureSvgText(candidate, fontSize) <= maxWidth || !current) {
      if (!current && measureSvgText(candidate, fontSize) > maxWidth) {
        const split = splitLongToken(candidate, maxWidth, fontSize);
        lines.push(...split.slice(0, -1));
        current = split.at(-1) ?? "";
      } else {
        current = candidate;
      }
    } else {
      lines.push(current.trim());
      current = token.trimStart();

      if (measureSvgText(current, fontSize) > maxWidth) {
        const split = splitLongToken(current, maxWidth, fontSize);
        lines.push(...split.slice(0, -1));
        current = split.at(-1) ?? "";
      }
    }

    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current.trim());
  } else if (current) {
    truncated = true;
  }

  const visible = lines.slice(0, maxLines).filter(Boolean);
  if (!visible.length) {
    return [cleanText];
  }

  if (truncated || lines.length > maxLines) {
    const lastIndex = visible.length - 1;
    visible[lastIndex] = fitLineWithEllipsis(visible[lastIndex], maxWidth, fontSize);
  }

  return visible;
}

export function limitLinesToHeight(
  lines: string[],
  height: number,
  lineHeight: number,
  options: {
    width?: number;
    fontSize?: number;
    maxLines?: number;
  } = {}
): string[] {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxVisibleLines = Math.max(1, Math.min(maxLines, Math.floor(height / lineHeight)));
  const visibleLines = lines.slice(0, maxVisibleLines);

  if (lines.length > maxVisibleLines) {
    const lastIndex = visibleLines.length - 1;
    visibleLines[lastIndex] =
      options.width && options.fontSize
        ? fitLineWithEllipsis(visibleLines[lastIndex], options.width, options.fontSize)
        : `${visibleLines[lastIndex].replace(/\.{1,}$/g, "")}...`;
  }

  return visibleLines.length ? visibleLines : [""];
}

export function estimateTextBlockHeight(text: string, width: number, fontSize: number): number {
  return round(wrapSvgText(text, width, fontSize).length * fontSize * 1.18);
}

export function measureSvgText(text: string, fontSize: number): number {
  return Array.from(text).reduce((total, char) => total + charWidth(char), 0) * fontSize;
}

function appendToken(current: string, token: string, granular: boolean): string {
  if (granular) {
    return `${current}${token}`;
  }

  return current ? `${current} ${token}` : token;
}

function splitLongToken(token: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const char of Array.from(token)) {
    const candidate = `${current}${char}`;
    if (current && measureSvgText(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [token];
}

function fitLineWithEllipsis(line: string, maxWidth: number, fontSize: number): string {
  const ellipsis = "...";
  let next = line.replace(/\.{1,}$/g, "").trimEnd();

  while (next && measureSvgText(`${next}${ellipsis}`, fontSize) > maxWidth) {
    next = Array.from(next).slice(0, -1).join("").trimEnd();
  }

  return next ? `${next}${ellipsis}` : ellipsis;
}

function hasCjkText(value: string): boolean {
  return Array.from(value).some(isCjkChar);
}

function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;

  if (/\s/.test(char)) {
    return 0.32;
  }

  if (isCjkChar(char) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef)) {
    return 1;
  }

  if (/^[MW@#%&]$/.test(char)) {
    return 0.82;
  }

  if (/^[A-Z]$/.test(char)) {
    return 0.64;
  }

  if (/^[0-9a-z]$/.test(char)) {
    return 0.55;
  }

  if (/^[ilI.,:;!'|]$/.test(char)) {
    return 0.3;
  }

  if (code > 0x7f) {
    return 0.78;
  }

  return 0.5;
}

function isAllowedXmlChar(code: number): boolean {
  if (code === 0x9 || code === 0xa || code === 0xd) {
    return true;
  }

  if ((code >= 0x0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
    return false;
  }

  return (
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
