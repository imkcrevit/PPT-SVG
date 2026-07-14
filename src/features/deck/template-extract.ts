// Derive a DeckTemplate from an uploaded .pptx: read the slide master + layout
// placeholder geometry (title / body / cover title / subtitle), the master's
// title/body font sizes, and the theme's major font. The result reuses the same
// block structure as the built-in template but with the UPLOAD'S coordinates and
// typography, so a generated deck lands its titles/bodies where the user's
// template puts them — and, per the deck-wide rule, every non-cover title shares
// one coordinate (the template's content-title placeholder).
//
// Colors are intentionally NOT baked in here: the palette (already derived from
// the same pptx theme) resolves the `accent/ink/surface/muted` tokens at render.

import JSZip from "jszip";

import type { DeckTemplate, SlideMaster, TemplateBlock } from "./template";

const CANVAS_W = 1280;
const CANVAS_H = 720;
const MAX_XML_BYTES = 8 * 1024 * 1024; // per-entry read cap for the small XML we parse
const MAX_ZIP_ENTRIES = 2000;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Pull placeholder geometry (by ph type) out of a master/layout XML. A `<p:sp>`
// whose `<p:ph>` carries no `<a:off>/<a:ext>` inherits from the master, so it is
// skipped here and filled from the master by the caller.
function placeholders(xml: string): Record<string, Box> {
  const out: Record<string, Box> = {};
  const spRe = /<p:sp>[\s\S]*?<\/p:sp>/g;
  let m: RegExpExecArray | null;
  while ((m = spRe.exec(xml))) {
    const sp = m[0];
    const phMatch = /<p:ph\b([^>]*?)\/?>/.exec(sp);
    if (!phMatch) continue;
    const type = /type="([^"]+)"/.exec(phMatch[1])?.[1] ?? "body"; // default ph type is body
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(sp);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(sp);
    if (!off || !ext) continue;
    if (!(type in out)) {
      out[type] = { x: +off[1], y: +off[2], w: +ext[1], h: +ext[2] };
    }
  }
  return out;
}

function styleSize(xml: string, style: "titleStyle" | "bodyStyle"): number | undefined {
  const block = new RegExp(`<p:${style}>[\\s\\S]*?</p:${style}>`).exec(xml)?.[0];
  const sz = block && /<a:defRPr\b[^>]*\bsz="(\d+)"/.exec(block)?.[1];
  return sz ? Number(sz) : undefined;
}

// Bounded read of one small XML entry. Unlike the shared whole-archive guard,
// this targets specific tiny files (master/layouts/theme/presentation) and skips
// an entry only when its DECLARED size is known to be huge — so a valid pptx
// whose zip metadata omits sizes still parses, while a bomb entry is skipped.
async function readEntry(zip: JSZip, re: RegExp): Promise<string> {
  const file = Object.values(zip.files).find((f) => !f.dir && re.test(f.name));
  if (!file) return "";
  const declared = (file as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === "number" && declared > MAX_XML_BYTES) return "";
  const text = await file.async("string");
  return text.length > MAX_XML_BYTES ? text.slice(0, MAX_XML_BYTES) : text;
}

export async function extractDeckTemplateFromPptx(bytes: Buffer, id = "uploaded"): Promise<DeckTemplate | undefined> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (Object.keys(zip.files).length > MAX_ZIP_ENTRIES) return undefined;

    const pres = await readEntry(zip, /ppt\/presentation\.xml$/);
    const sz = /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(pres);
    if (!sz) return undefined;
    const cx = Number(sz[1]);
    const cy = Number(sz[2]);
    if (!(cx > 0 && cy > 0)) return undefined;

    const master = await readEntry(zip, /ppt\/slideMasters\/slideMaster1\.xml$/);
    if (!master) return undefined;
    const mph = placeholders(master);

    // Index layouts by their `type` so we can pick cover/section/content geometry.
    const layoutByType: Record<string, string> = {};
    for (const file of Object.values(zip.files)) {
      if (file.dir || !/ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(file.name)) continue;
      const declared = (file as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (typeof declared === "number" && declared > MAX_XML_BYTES) continue;
      const xml = (await file.async("string")).slice(0, MAX_XML_BYTES);
      const type = /<p:sldLayout\b[^>]*\btype="([^"]+)"/.exec(xml)?.[1];
      if (type && !(type in layoutByType)) layoutByType[type] = xml;
    }
    const phFrom = (layoutType: string, phType: string): Box | undefined => {
      const lx = layoutByType[layoutType];
      return (lx ? placeholders(lx)[phType] : undefined) ?? undefined;
    };

    // Content title + body: prefer an "obj" (title+content) layout, fall back to master.
    const titleG = phFrom("obj", "title") ?? phFrom("titleOnly", "title") ?? mph.title;
    const bodyG = phFrom("obj", "body") ?? mph.body;
    if (!titleG) return undefined;

    // Cover + section geometry.
    const coverTitleG = phFrom("title", "ctrTitle") ?? titleG;
    const coverSubG = phFrom("title", "subTitle") ?? bodyG;
    const secTitleG = phFrom("secHead", "title") ?? titleG;
    const secSubG = phFrom("secHead", "body") ?? coverSubG;

    // px converters (letterbox-free: pptx slides and our canvas are both 16:9).
    const X = (emu: number) => Math.round((emu / cx) * CANVAS_W);
    const Y = (emu: number) => Math.round((emu / cy) * CANVAS_H);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const ptToPx = (hundredthsPt: number) => (hundredthsPt / 100) * (96 / 72);

    const titlePx = clamp(Math.round(ptToPx(styleSize(master, "titleStyle") ?? 3200)), 22, 42);
    const bodyPx = clamp(Math.round(ptToPx(styleSize(master, "bodyStyle") ?? 1800)), 14, 24);

    // Theme major font (reuse the same source as the palette).
    const theme = await readEntry(zip, /ppt\/theme\/theme\d+\.xml$/);
    const majorFont = /<a:majorFont>[\s\S]*?<a:latin\b[^>]*\btypeface="([^"]+)"/.exec(theme)?.[1];
    const fontFamily = majorFont && majorFont.trim() && !majorFont.startsWith("+") ? majorFont.trim() : undefined;

    // ── Canonical content title, shared by every non-cover master ─────────────
    const ct = {
      x: clamp(X(titleG.x), 24, CANVAS_W - 200),
      y: clamp(Y(titleG.y), 24, 160),
      w: clamp(X(titleG.w), 300, CANVAS_W - 48),
      size: titlePx
    };
    const ruleY = clamp(ct.y + Math.round(titlePx * 1.4) + 14, ct.y + 24, 200);
    const bodyTop = bodyG ? clamp(Y(bodyG.y), ruleY + 18, 320) : ruleY + 40;
    const bodyBottom = bodyG ? clamp(Y(bodyG.y + bodyG.h), bodyTop + 120, 636) : 636;
    const footY = CANVAS_H - 40;

    const header = (): TemplateBlock[] => [
      { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 6, fill: "accent" },
      { type: "text", x: ct.x, y: ct.y, w: ct.w, h: Math.round(titlePx * 1.9), field: "title", size: ct.size, weight: 800, color: "ink", align: "start" },
      { type: "rect", x: ct.x + 2, y: ruleY, w: 104, h: 6, fill: "accent" }
    ];
    const footer = (): TemplateBlock[] => [
      { type: "text", x: ct.x, y: footY, w: 640, h: 22, field: "deckTitle", size: 13, weight: 500, color: "muted", align: "start" },
      { type: "text", x: CANVAS_W - ct.x - 160, y: footY, w: 160, h: 22, field: "pageNumber", size: 14, weight: 600, color: "muted", align: "end" }
    ];

    const bullets = (x: number, textW: number, numbered = false): TemplateBlock => ({
      type: "bullets",
      x,
      yTop: bodyTop,
      yBottom: bodyBottom,
      maxRows: 8,
      maxRowH: 84,
      marker: numbered ? { dx: 0, w: 0, h: 0, color: "accent" } : { dx: 0, w: 12, h: 12, color: "accent", rx: 3 },
      ...(numbered ? { numbered: { dx: 0, w: 44, size: Math.max(20, bodyPx + 2), weight: 800, color: "accent" } } : {}),
      text: { dx: numbered ? 58 : 34, w: textW, size: bodyPx, weight: numbered ? 600 : 500, color: "ink" }
    });

    // Cover / section: keep the upload's hero placement.
    const cover: SlideMaster = {
      background: "surface",
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 8, fill: "accent" },
        { type: "text", x: clamp(X(coverTitleG.x), 24, CANVAS_W - 300), y: clamp(Y(coverTitleG.y), 60, 460), w: clamp(X(coverTitleG.w), 400, CANVAS_W - 48), h: 170, field: "title", size: clamp(titlePx + 14, 36, 56), weight: 800, color: "ink", align: "start" },
        { type: "text", x: clamp(X(coverSubG?.x ?? coverTitleG.x), 24, CANVAS_W - 300), y: clamp(Y(coverSubG?.y ?? coverTitleG.y + coverTitleG.h), 120, 620), w: clamp(X(coverSubG?.w ?? coverTitleG.w), 400, CANVAS_W - 48), h: 96, field: "subtitle", size: clamp(bodyPx + 4, 16, 28), weight: 400, color: "muted", align: "start" },
        ...footer()
      ]
    };
    const section: SlideMaster = {
      background: "surface",
      blocks: [
        { type: "rect", x: 0, y: 0, w: CANVAS_W, h: 8, fill: "accent" },
        { type: "text", x: clamp(X(secTitleG.x), 24, CANVAS_W - 300), y: clamp(Y(secTitleG.y), 120, 460), w: clamp(X(secTitleG.w), 400, CANVAS_W - 48), h: 150, field: "title", size: clamp(titlePx + 10, 32, 52), weight: 800, color: "ink", align: "start" },
        { type: "text", x: clamp(X(secSubG?.x ?? secTitleG.x), 24, CANVAS_W - 300), y: clamp(Y(secSubG?.y ?? secTitleG.y + secTitleG.h), 200, 620), w: clamp(X(secSubG?.w ?? secTitleG.w), 400, CANVAS_W - 48), h: 72, field: "subtitle", size: clamp(bodyPx + 2, 14, 24), weight: 400, color: "muted", align: "start" },
        ...footer()
      ]
    };

    const contentTextW = ct.w - 34;
    return {
      id,
      name: { zh: "上传模板", en: "Uploaded template" },
      tokens: { colors: {}, fontFamily },
      masters: {
        cover,
        section,
        toc: { background: "surface", blocks: [...header(), bullets(ct.x, ct.w - 58, true), ...footer()] },
        bullets: { background: "surface", blocks: [...header(), bullets(ct.x, contentTextW), ...footer()] },
        image: {
          background: "surface",
          blocks: [
            ...header(),
            { type: "image", x: ct.x, y: bodyTop, w: CANVAS_W - 2 * ct.x, h: Math.max(200, bodyBottom - bodyTop - 30), fit: "contain" },
            { type: "text", x: ct.x, y: bodyBottom - 22, w: CANVAS_W - 2 * ct.x, h: 28, field: "caption", size: 15, weight: 400, color: "muted", align: "middle" },
            ...footer()
          ]
        },
        imageBullets: {
          background: "surface",
          blocks: [
            ...header(),
            { type: "image", x: ct.x, y: bodyTop, w: 560, h: Math.max(200, bodyBottom - bodyTop), fit: "contain" },
            bullets(ct.x + 620, CANVAS_W - (ct.x + 620) - ct.x, false),
            ...footer()
          ]
        },
        diagram: { blocks: [...header(), ...footer()] }
      }
    };
  } catch {
    return undefined;
  }
}
