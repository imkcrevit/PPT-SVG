// Extract style (palette / font) from an uploaded file.
//
// PPTX is the highest-fidelity source: Office files carry an explicit theme
// (ppt/theme/theme1.xml). Images are analysed for an INTENTIONAL palette; their
// background is always treated as incidental and stripped (the diagram keeps a
// default light canvas) — so a screenshot's dark/solid editor background never
// becomes the diagram background. When a background is stripped or an image is
// rejected, a user-facing `notice` is returned so the UI can explain it and
// invite the user to continue the conversation if they actually want it.
//
// Reuses jszip + sharp, already in package.json — no new dependencies.

import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";
import { assertSafeZip } from "@/lib/zip-safety";
import { type DiagramTheme, buildAccents, deriveTint, normalizeHex, pickReadableText } from "@/lib/theme";

export interface ExtractedStyle {
  theme?: DiagramTheme;
  notice?: string;
  detectedBackground?: string;
}

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
    assertSafeZip(zip);
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

// ---- image analysis --------------------------------------------------------
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function deriveStrokeEdge(accent: string): string {
  return deriveTint(accent, 0.35);
}
function hexLum(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export type ImageStyleReason = "palette" | "solid-bg" | "screenshot" | "too-rich" | "no-colour" | "none";

export interface ImageStyleResult {
  theme?: DiagramTheme;
  detectedBackground?: string;
  reason: ImageStyleReason;
  accentCount: number;
}

// Pure pixel -> style classification (exported for testing). The diagram
// background is ALWAYS left at the default light canvas; any solid image
// background is reported via detectedBackground but never applied.
export function analyzeImageStyle(data: Uint8Array | Buffer, channels: number): ImageStyleResult {
  const ch = channels || 3;
  const total = Math.floor(data.length / ch);
  if (total <= 0) return { reason: "none", accentCount: 0 };

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    cur.count += 1; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(key, cur);
  }

  const lum = (R: number, G: number, B: number) => (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
  const sat = (R: number, G: number, B: number) => {
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  const hue = (R: number, G: number, B: number) => {
    const r = R / 255, g = G / 255, b = B / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    let h = 0;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return h;
  };

  const cells = [...buckets.values()].map((c) => {
    const R = c.r / c.count, G = c.g / c.count, B = c.b / c.count;
    return { cov: c.count / total, R, G, B, L: lum(R, G, B), S: sat(R, G, B), H: hue(R, G, B), hex: toHex(R, G, B) };
  }).sort((a, b) => b.cov - a.cov);

  // dominant single colour = incidental "background" (any colour), if it owns >= 50%
  const dominant = cells[0];
  const detectedBackground = dominant && dominant.cov >= 0.5 ? dominant.hex : undefined;

  let lightCov = 0, darkCov = 0, greyCov = 0, colorCov = 0;
  for (const c of cells) {
    if (c.L > 0.82) lightCov += c.cov;
    else if (c.L < 0.18) darkCov += c.cov;
    else if (c.S < 0.12) greyCov += c.cov;
    if (c.S >= 0.2 && c.L >= 0.15 && c.L <= 0.92) colorCov += c.cov;
  }

  const fail = (reason: ImageStyleReason): ImageStyleResult => ({ reason, detectedBackground, accentCount: 0 });

  if (colorCov < 0.06) return fail("no-colour");
  if (darkCov + greyCov > 0.55 && colorCov < 0.3) return fail("screenshot");

  // distinct hues (~25° bins), excluding the incidental background colour
  const colorCells = cells.filter(
    (c) => c.S >= 0.25 && c.L >= 0.15 && c.L <= 0.92 && c.cov >= 0.02 && c.hex !== detectedBackground
  );
  const binToHex = new Map<number, string>();
  for (const c of colorCells) {
    const bin = Math.round(c.H / 25) % 15;
    if (!binToHex.has(bin)) binToHex.set(bin, c.hex);
  }
  const distinctBins = binToHex.size;
  if (distinctBins > 6) return fail("too-rich");
  if (distinctBins < 2) return fail(detectedBackground ? "solid-bg" : "none");

  const accents = [...binToHex.values()].slice(0, 6);
  const theme: DiagramTheme = {
    accents: buildAccents(accents),
    text: pickReadableText("#FFFFFF"),
    subtext: "#6B7280",
    edge: deriveStrokeEdge(accents[0]),
    background: "#FFFFFF", // image background is always stripped
    source: "image"
  };
  return { theme, detectedBackground, reason: "palette", accentCount: accents.length };
}

export function buildImageNotice(r: ImageStyleResult): string | undefined {
  const bg = r.detectedBackground;
  const colouredBg = bg && hexLum(bg) < 0.9 ? bg : undefined;
  switch (r.reason) {
    case "palette":
      return colouredBg
        ? `已从图片提取 ${r.accentCount} 种主色用于配色;图片背景色(${colouredBg})已被忽略。如需在图中使用该背景,请在对话中告诉我。`
        : `已从图片提取 ${r.accentCount} 种主色用于配色。`;
    case "solid-bg":
    case "screenshot":
      return `检测到图片主要是纯色背景(${colouredBg ?? bg ?? "单色"}),已忽略、未提取配色。如需在图中使用该背景色,请在对话中告诉我。`;
    case "too-rich":
      return "图片色彩过于丰富,未作为样式参照(以免误判)。如需指定配色,请在对话中说明,或手动设置主题。";
    case "no-colour":
      return colouredBg
        ? `检测到图片为纯色背景(${colouredBg}),已忽略。如需在图中使用该背景,请在对话中告诉我。`
        : undefined;
    default:
      return undefined;
  }
}

export async function extractImageStyle(bytes: Buffer): Promise<ExtractedStyle> {
  try {
    const { data, info } = await sharp(bytes).resize(72, 72, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = analyzeImageStyle(data, info.channels);
    return { theme: r.theme, notice: buildImageNotice(r), detectedBackground: r.detectedBackground };
  } catch {
    return {};
  }
}

// ---- public API ------------------------------------------------------------
export async function extractStyle(extension: string, bytes: Buffer): Promise<ExtractedStyle> {
  const ext = extension.toLowerCase();
  if (ext === "pptx") return { theme: await extractThemeFromPptx(bytes) };
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return extractImageStyle(bytes);
  return {};
}

export async function extractTheme(extension: string, bytes: Buffer): Promise<DiagramTheme | undefined> {
  return (await extractStyle(extension, bytes)).theme;
}

/** Resolve a theme from a session's uploaded attachments (server-side, reads files). */
export async function resolveThemeFromAttachments(
  attachments?: Array<{ path?: string; extension?: string }> | null
): Promise<DiagramTheme | undefined> {
  if (!attachments?.length) return undefined;
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

/** Resolve both the theme and the detected (stripped) background from a session's attachments. */
export async function resolveStyleContext(
  attachments?: Array<{ path?: string; extension?: string }> | null
): Promise<{ theme?: DiagramTheme; detectedBackground?: string }> {
  if (!attachments?.length) return {};
  const latestFirst = [...attachments].reverse();
  const themeOrder = [...latestFirst].sort((a, b) => (b.extension === "pptx" ? 1 : 0) - (a.extension === "pptx" ? 1 : 0));
  let theme: DiagramTheme | undefined;
  let detectedBackground: string | undefined;
  for (const a of themeOrder) {
    if (!a.path || !a.extension) continue;
    try {
      const buf = await readFile(a.path);
      const st = await extractStyle(a.extension, buf);
      if (st.theme && !theme) theme = st.theme;
      if (st.detectedBackground && !detectedBackground) detectedBackground = st.detectedBackground;
      if (theme && detectedBackground) break;
    } catch {
      /* ignore */
    }
  }
  return { theme, detectedBackground };
}
