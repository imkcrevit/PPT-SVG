// Diagram theme model. Colours are deterministic in the engine; a theme lets an
// uploaded brand deck / image override the default palette without the model
// ever emitting colours. DEFAULT_THEME equals the current engine constants, so
// passing no theme is a no-op (zero behaviour change).

export interface ThemeAccent {
  stroke: string;
  tint: string;
}

export interface DiagramTheme {
  accents: ThemeAccent[]; // at least 1; engine cycles through by index
  text: string;
  subtext: string;
  edge: string;
  background: string;
  fontFamily?: string;
  source?: "default" | "pptx" | "image";
}

export const DEFAULT_THEME: DiagramTheme = {
  accents: [
    { stroke: "#5B6B86", tint: "#FBF6EC" },
    { stroke: "#6B5BD2", tint: "#EFEBFB" },
    { stroke: "#7A5AC4", tint: "#F0EAFA" },
    { stroke: "#2E9E76", tint: "#E7F5EF" },
    { stroke: "#2F6FED", tint: "#EAF1FE" },
    { stroke: "#E08A1E", tint: "#FDF1DF" },
    { stroke: "#D6457C", tint: "#FCE8F0" },
    { stroke: "#C0453C", tint: "#FBE9E7" }
  ],
  text: "#1D2433",
  subtext: "#6B7280",
  edge: "#52607A",
  background: "#FFFFFF",
  fontFamily: "Microsoft YaHei",
  source: "default"
};

// ---- colour utils ----------------------------------------------------------
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Light fill paired with an accent stroke (mix toward white). */
export function deriveTint(stroke: string, amount = 0.88): string {
  return mix(stroke, "#FFFFFF", amount);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick dark or light text for readability against a background. */
export function pickReadableText(bg: string, dark = "#1D2433", light = "#F8FAFC"): string {
  return luminance(bg) > 0.5 ? dark : light;
}

function saturation(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Build accent pairs from a list of stroke colours (derives tints). */
export function buildAccents(strokes: string[]): ThemeAccent[] {
  const valid = strokes.map(normalizeHex).filter((c): c is string => !!c);
  // keep visually distinct, reasonably saturated colours; fall back if too few
  const distinct: string[] = [];
  for (const c of valid) {
    if (saturation(c) < 0.12) continue; // skip near-greys for accents
    if (!distinct.some((d) => Math.abs(luminance(d) - luminance(c)) < 0.02 && d === c)) distinct.push(c);
  }
  const chosen = (distinct.length ? distinct : valid).slice(0, 8);
  return chosen.length ? chosen.map((s) => ({ stroke: s, tint: deriveTint(s) })) : DEFAULT_THEME.accents;
}

/** Merge a partial theme over the defaults (any missing field falls back). */
export function resolveTheme(partial?: Partial<DiagramTheme> | null): DiagramTheme {
  if (!partial) return DEFAULT_THEME;
  const background = partial.background ? normalizeHex(partial.background) ?? DEFAULT_THEME.background : DEFAULT_THEME.background;
  return {
    accents: partial.accents && partial.accents.length ? partial.accents : DEFAULT_THEME.accents,
    text: partial.text ? normalizeHex(partial.text) ?? DEFAULT_THEME.text : pickReadableText(background),
    subtext: partial.subtext ? normalizeHex(partial.subtext) ?? DEFAULT_THEME.subtext : DEFAULT_THEME.subtext,
    edge: partial.edge ? normalizeHex(partial.edge) ?? DEFAULT_THEME.edge : DEFAULT_THEME.edge,
    background,
    fontFamily: partial.fontFamily ?? DEFAULT_THEME.fontFamily,
    source: partial.source ?? "default"
  };
}

// ---- user override (front-end) --------------------------------------------
export interface ThemeOverride {
  accents?: string[]; // stroke hexes; tints auto-derived
  text?: string;
  edge?: string;
  background?: string;
  fontFamily?: string;
}

/** Merge a user override over a base theme. Returns undefined if nothing to apply. */
export function mergeTheme(base: DiagramTheme | undefined, override?: ThemeOverride | null): DiagramTheme | undefined {
  if (!override || Object.keys(override).length === 0) return base;
  const b = base ?? DEFAULT_THEME;
  return {
    accents: override.accents && override.accents.length ? buildAccents(override.accents) : b.accents,
    text: override.text ? normalizeHex(override.text) ?? b.text : b.text,
    subtext: b.subtext,
    edge: override.edge ? normalizeHex(override.edge) ?? b.edge : b.edge,
    background: override.background ? normalizeHex(override.background) ?? b.background : b.background,
    fontFamily: override.fontFamily && override.fontFamily.trim() ? override.fontFamily.trim().slice(0, 60) : b.fontFamily,
    source: b.source
  };
}

/** Sanitize an override coming from an untrusted request body. */
export function normalizeThemeOverride(raw: unknown): ThemeOverride | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ThemeOverride = {};
  if (Array.isArray(r.accents)) {
    const accents = r.accents.filter((c): c is string => typeof c === "string").map((c) => normalizeHex(c)).filter((c): c is string => !!c).slice(0, 8);
    if (accents.length) out.accents = accents;
  }
  const hexField = (v: unknown) => (typeof v === "string" ? normalizeHex(v) ?? undefined : undefined);
  const text = hexField(r.text); if (text) out.text = text;
  const edge = hexField(r.edge); if (edge) out.edge = edge;
  const background = hexField(r.background); if (background) out.background = background;
  if (typeof r.fontFamily === "string" && r.fontFamily.trim()) {
    out.fontFamily = r.fontFamily.replace(/[<>"'`;{}]/g, "").trim().slice(0, 60);
  }
  return Object.keys(out).length ? out : undefined;
}
