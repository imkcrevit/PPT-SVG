// Extract a DiagramTheme from an uploaded file.
//
// PPTX is the highest-fidelity source: Office files carry an explicit theme
// (ppt/theme/theme1.xml) with a 6-colour accent scheme + font scheme that maps
// 1:1 onto the engine palette — deterministic, no ML. Images fall back to
// dominant-colour extraction via sharp (already a dependency). Both are
// best-effort: any failure returns undefined and the engine uses DEFAULT_THEME.
//
// Reuses jszip + sharp, already in package.json — no new dependencies.

import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";
import { type DiagramTheme, buildAccents, deriveTint, normalizeHex, pickReadableText } from "@/lib/theme";

const SCHEME_NAMES = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;

function colorOf(block: string, name: string): string | null {
  const el = new RegExp(`<a:${name}\\b[^>]*>([\\s\\S]*?)</a:${name}>`).exec(block);
  if (!el) return null;
  const inner = el[1];
  const srgb = /<a:srgbClr\b[^>]*\bval="([0-9a-fA-F]{6})"/.exec(inner);
  if (srgb) return normalizeHex(srgb[1]);
  const sys = /<a:sysClr\b[^>]*\blastClr="([0-9a-fA-F]{6})"/.exec(inner);
  if (sys) return normalizeHex(sys[1]);
  return null;
}

export async function extractThemeFromPptx(bytes: Buffer): Promise<DiagramTheme | undefined> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    // first theme file (themes live under ppt/theme/themeN.xml)
    const themeFile = Object.values(zip.files).find((f) => !f.dir && /ppt\/theme\/theme\d+\.xml$/.test(f.name));
    if (!themeFile) return undefined;
    const xml = await themeFile.async("string");

    const clr = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? "";
    const strokes = SCHEME_NAMES.map((n) => colorOf(clr, n)).filter((c): c is string => !!c);
    if (strokes.length === 0) return undefined;

    const text = colorOf(clr, "dk1") ?? "#1D2433";
    const background = colorOf(clr, "lt1") ?? "#FFFFFF";
    const edge = colorOf(clr, "dk2") ?? "#52607A";

    const fontScheme = /<a:fontScheme\b[\s\S]*?<\/a:fontScheme>/.exec(xml)?.[0] ?? "";
    const major = /<a:majorFont>[\s\S]*?<a:latin\b[^>]*\btypeface="([^"]+)"/.exec(fontScheme)?.[1];

    return {
      accents: buildAccents(strokes),
      text,
      subtext: "#6B7280",
      edge,
      background,
      fontFamily: major && major.trim() && !major.startsWith("+") ? major.trim() : undefined,
      source: "pptx"
    };
  } catch {
    return undefined;
  }
}

export async function extractThemeFromImage(bytes: Buffer): Promise<DiagramTheme | undefined> {
  try {
    const { data, info } = await sharp(bytes)
      .resize(64, 64, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const ch = info.channels; // 3
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`; // 32-level buckets
      const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      cur.count += 1; cur.r += r; cur.g += g; cur.b += b;
      buckets.set(key, cur);
    }
    const ranked = [...buckets.values()]
      .map((b) => ({ count: b.count, hex: toHex(b.r / b.count, b.g / b.count, b.b / b.count) }))
      .sort((a, b) => b.count - a.count);
    if (!ranked.length) return undefined;

    const lum = (hex: string) => {
      const [r, g, bb] = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * bb;
    };
    const sat = (hex: string) => {
      const [r, g, bb] = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16) / 255);
      const mx = Math.max(r, g, bb); const mn = Math.min(r, g, bb);
      return mx === 0 ? 0 : (mx - mn) / mx;
    };

    const background = ranked.find((c) => lum(c.hex) > 0.85)?.hex ?? "#FFFFFF";
    const accents = ranked.filter((c) => sat(c.hex) > 0.25 && lum(c.hex) > 0.12 && lum(c.hex) < 0.9).slice(0, 6).map((c) => c.hex);
    if (accents.length === 0) return undefined;

    return {
      accents: buildAccents(accents),
      text: pickReadableText(background),
      subtext: "#6B7280",
      edge: accents[0] ? deriveStrokeEdge(accents[0]) : "#52607A",
      background: normalizeHex(background) ?? "#FFFFFF",
      source: "image"
    };
  } catch {
    return undefined;
  }
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function deriveStrokeEdge(accent: string): string {
  return deriveTint(accent, 0.35); // darker-ish neutral edge derived from brand
}

export async function extractTheme(extension: string, bytes: Buffer): Promise<DiagramTheme | undefined> {
  const ext = extension.toLowerCase();
  if (ext === "pptx") return extractThemeFromPptx(bytes);
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return extractThemeFromImage(bytes);
  // pdf: rasterize page 1 then reuse extractThemeFromImage (needs a pdf->png step); omitted here.
  return undefined;
}

/** Resolve a theme from a session's uploaded attachments (server-side, reads files). */
export async function resolveThemeFromAttachments(
  attachments?: Array<{ path?: string; extension?: string }> | null
): Promise<DiagramTheme | undefined> {
  if (!attachments?.length) return undefined;
  // most recent first, and prefer pptx (highest fidelity) over images
  const ordered = [...attachments].reverse();
  ordered.sort((a, b) => (b.extension === "pptx" ? 1 : 0) - (a.extension === "pptx" ? 1 : 0));
  for (const a of ordered) {
    if (!a.path || !a.extension) continue;
    try {
      const buf = await readFile(a.path);
      const theme = await extractTheme(a.extension, buf);
      if (theme) return theme;
    } catch {
      /* ignore unreadable attachment */
    }
  }
  return undefined;
}
