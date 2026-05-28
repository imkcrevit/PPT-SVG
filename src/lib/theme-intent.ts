// Conversational theme-intent parser.
//
// Detects when the user asks (in chat) to change diagram style — background,
// text colour, font, or accent/brand colours — and turns it into a
// ThemeOverride that the generate route merges over the auto-extracted theme.
//
// Two layers (cheap -> smart):
//   1. Deterministic rules (colour/font lexicon + phrase patterns). Zero cost,
//      handles the common Chinese/English phrasings.
//   2. LLM fallback (prompt-based) — only when rules find nothing AND the
//      message clearly mentions style — for fuzzy phrasing. Caller injects the
//      model function, so this module stays testable and dependency-free.

import { normalizeThemeOverride, type ThemeOverride } from "@/lib/theme";

export interface ThemeIntentContext {
  /** Background colour detected (and stripped) from a recently uploaded image. */
  detectedBackground?: string;
}

const COLORS: Record<string, string> = {
  红: "#E53935", 红色: "#E53935", 大红: "#E2231A", 深红: "#B71C1C", red: "#E53935",
  蓝: "#2F6FED", 蓝色: "#2F6FED", 深蓝: "#0A2A5E", 藏蓝: "#0A2A5E", 天蓝: "#03A9F4", navy: "#0A2A5E", blue: "#2F6FED",
  绿: "#2E9E76", 绿色: "#2E9E76", 深绿: "#1B5E20", green: "#2E9E76",
  黄: "#F2A900", 黄色: "#F2A900", yellow: "#F2A900", 金色: "#D4AF37", gold: "#D4AF37",
  橙: "#E08A1E", 橙色: "#E08A1E", orange: "#E08A1E",
  紫: "#7A5AC4", 紫色: "#7A5AC4", purple: "#7A5AC4",
  粉: "#D6457C", 粉色: "#D6457C", 粉红: "#D6457C", pink: "#D6457C",
  青: "#0093B2", 青色: "#0093B2", 青绿: "#0093B2", teal: "#0093B2", cyan: "#0093B2",
  棕: "#8D5524", 棕色: "#8D5524", brown: "#8D5524",
  黑: "#1D2433", 黑色: "#1D2433", black: "#1D2433",
  白: "#FFFFFF", 白色: "#FFFFFF", white: "#FFFFFF",
  灰: "#6B7280", 灰色: "#6B7280", gray: "#6B7280", grey: "#6B7280"
};

const FONTS: Array<[RegExp, string]> = [
  [/微软雅黑|雅黑|microsoft\s*yahei/i, "Microsoft YaHei"],
  [/苹方|pingfang/i, "PingFang SC"],
  [/思源黑体|source\s*han/i, "Source Han Sans"],
  [/黑体|simhei/i, "SimHei"],
  [/宋体|simsun/i, "SimSun"],
  [/楷体|kaiti/i, "KaiTi"],
  [/系统默认|默认字体|sans-?serif/i, "sans-serif"]
];

const HEX = /#([0-9a-fA-F]{6})\b/;

function colorToken(text: string): string | undefined {
  const hex = HEX.exec(text);
  if (hex) return `#${hex[1].toUpperCase()}`;
  // longest name first so "深蓝" beats "蓝"
  const names = Object.keys(COLORS).sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (new RegExp(`(^|[^a-zA-Z])${n}($|[^a-zA-Z])`, "i").test(text)) return COLORS[n];
  }
  return undefined;
}

function colorsIn(text: string): string[] {
  const out: string[] = [];
  const hexes = text.match(/#[0-9a-fA-F]{6}/g);
  if (hexes) out.push(...hexes.map((h) => h.toUpperCase()));
  const names = Object.keys(COLORS).sort((a, b) => b.length - a.length);
  let scan = text;
  for (const n of names) {
    const re = new RegExp(`(^|[^a-zA-Z])${n}($|[^a-zA-Z])`, "ig");
    if (re.test(scan)) { out.push(COLORS[n]); scan = scan.replace(re, " "); }
  }
  return [...new Set(out)];
}

/** Deterministic parse. Returns the fields the user clearly asked to change. */
export function parseThemeIntent(message: string, ctx: ThemeIntentContext = {}): ThemeOverride | undefined {
  const m = message || "";
  const o: ThemeOverride = {};

  // --- background ---
  if (/(用|沿用|保留|应用|加上|加回|要).{0,5}(那个|刚才|上传|图片|原图|截图|之前).{0,4}背景/.test(m) || /背景.{0,4}(用|沿用|保留).{0,4}(那个|刚才|图片|上传)/.test(m)) {
    if (ctx.detectedBackground) o.background = ctx.detectedBackground;
  } else if (/(去掉|取消|不要|移除|清除|去除).{0,4}背景|白底|背景.{0,4}(透明|白色|白)|恢复.{0,4}(白|默认).{0,3}背景/.test(m)) {
    o.background = "#FFFFFF";
  } else {
    const bgm = /(背景色?|底色)[^。,，;；\n]{0,16}/.exec(m);
    if (bgm) { const c = colorToken(bgm[0]); if (c) o.background = c; }
  }

  // --- text colour --- (require explicit "文字/文本 ... 颜色/色" to avoid font clash)
  const txtm = /(文字|文本|字)[^。,，;；\n]{0,3}(颜色|色)[^。,，;；\n]{0,12}/.exec(m);
  if (txtm) { const c = colorToken(txtm[0]); if (c) o.text = c; }

  // --- font ---
  if (/(字体|字型|font)/i.test(m)) {
    for (const [re, name] of FONTS) { if (re.test(m)) { o.fontFamily = name; break; } }
  }

  // --- accents / brand colours ---
  const accm = /(主色调?|主题色|品牌色|强调色|配色)[^。\n]{0,30}/.exec(m);
  if (accm) { const cs = colorsIn(accm[0]); if (cs.length) o.accents = cs.slice(0, 6); }

  return normalizeThemeOverride(o);
}

const STYLE_KEYWORDS = /(背景|底色|配色|主色|主题色|品牌色|颜色|色调|字体|字型|font|colou?r|background|theme)/i;

/** Should we bother asking the model? (gate to avoid needless LLM calls) */
export function mentionsStyle(message: string): boolean {
  return STYLE_KEYWORDS.test(message || "");
}

export const THEME_INTENT_SYSTEM_PROMPT = [
  "You extract diagram-style change requests from a user message.",
  "Return ONLY compact JSON, no prose, no markdown. Shape:",
  '{"accents"?:string[],"text"?:string,"edge"?:string,"background"?:string,"fontFamily"?:string}',
  "Rules:",
  "- Include a field ONLY if the user clearly asks to change it; otherwise omit it. If nothing, return {}.",
  "- Colours must be #RRGGBB hex. Map colour names (中文/English) to a reasonable hex.",
  "- fontFamily: return the font name (e.g. \"Microsoft YaHei\",\"PingFang SC\",\"SimSun\",\"sans-serif\").",
  "- If the user says to use the uploaded image's background and a DETECTED_BACKGROUND is provided, set background to that exact hex.",
  "- If the user says remove/white background, set background to \"#FFFFFF\".",
  "- Never invent changes the user didn't ask for."
].join("\n");

type ModelCall = (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string>;

/** LLM fallback. `call` is injected (e.g. a thin wrapper over callOpenRouter). */
export async function parseThemeIntentLLM(message: string, ctx: ThemeIntentContext, call: ModelCall): Promise<ThemeOverride | undefined> {
  try {
    const user = `${ctx.detectedBackground ? `DETECTED_BACKGROUND=${ctx.detectedBackground}\n` : ""}MESSAGE: ${message}`;
    const raw = await call([{ role: "system", content: THEME_INTENT_SYSTEM_PROMPT }, { role: "user", content: user }]);
    const jsonText = raw.replace(/```json|```/g, "").trim();
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start < 0 || end < 0) return undefined;
    const parsed = JSON.parse(jsonText.slice(start, end + 1));
    return normalizeThemeOverride(parsed);
  } catch {
    return undefined;
  }
}

/** Deterministic first; LLM only if rules found nothing and the message mentions style. */
export async function resolveThemeIntent(
  message: string,
  ctx: ThemeIntentContext = {},
  call?: ModelCall
): Promise<ThemeOverride | undefined> {
  const det = parseThemeIntent(message, ctx);
  if (det) return det;
  if (call && mentionsStyle(message)) return parseThemeIntentLLM(message, ctx, call);
  return undefined;
}
