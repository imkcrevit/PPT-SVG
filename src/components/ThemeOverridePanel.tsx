"use client";

import { useState } from "react";
import type { ThemeOverride } from "@/lib/theme";

// A small, dependency-free panel that lets the user override the auto-extracted
// theme (accents / background / text / font). It emits a `ThemeOverride` object
// (or null = use auto theme) via `onChange`. Include that object as
// `themeOverride` in the body of your POST to /api/generate(-agent).
//
// Usage:
//   const [override, setOverride] = useState<ThemeOverride | null>(null);
//   <ThemeOverridePanel value={override} onChange={setOverride} />
//   // then in the generate fetch: body: JSON.stringify({ ...req, themeOverride: override ?? undefined })

const FONT_OPTIONS = [
  { label: "微软雅黑（默认）", value: "Microsoft YaHei" },
  { label: "苹方 PingFang SC", value: "PingFang SC" },
  { label: "思源黑体 Source Han Sans", value: "Source Han Sans" },
  { label: "黑体 SimHei", value: "SimHei" },
  { label: "宋体 SimSun", value: "SimSun" },
  { label: "系统默认 sans-serif", value: "sans-serif" }
];

const DEFAULT_ACCENTS = ["#2F6FED", "#2E9E76", "#E08A1E", "#D6457C"];

interface Props {
  value?: ThemeOverride | null;
  onChange: (next: ThemeOverride | null) => void;
}

export default function ThemeOverridePanel({ value, onChange }: Props) {
  const [enabled, setEnabled] = useState<boolean>(!!value);
  const [accents, setAccents] = useState<string[]>(value?.accents ?? DEFAULT_ACCENTS);
  const [background, setBackground] = useState<string>(value?.background ?? "#FFFFFF");
  const [text, setText] = useState<string>(value?.text ?? "#1D2433");
  const [fontFamily, setFontFamily] = useState<string>(value?.fontFamily ?? "Microsoft YaHei");

  const emit = (next: { accents?: string[]; background?: string; text?: string; fontFamily?: string }) => {
    const o: ThemeOverride = {
      accents: next.accents ?? accents,
      background: next.background ?? background,
      text: next.text ?? text,
      fontFamily: next.fontFamily ?? fontFamily
    };
    onChange(o);
  };

  const toggle = (on: boolean) => {
    setEnabled(on);
    onChange(on ? { accents, background, text, fontFamily } : null);
  };

  const setAccent = (i: number, hex: string) => {
    const a = accents.slice();
    a[i] = hex;
    setAccents(a);
    emit({ accents: a });
  };

  return (
    <div style={{ border: "1px solid #E3E7EE", borderRadius: 12, padding: 16, fontFamily: "Microsoft YaHei, sans-serif", maxWidth: 360 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#1D2433" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        自定义配色 / 字体（覆盖自动提取）
      </label>

      {enabled && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>主色（可多个，自动生成浅底）</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {accents.map((c, i) => (
                <input key={i} type="color" value={c} onChange={(e) => setAccent(i, e.target.value)} style={{ width: 40, height: 32, border: "none", background: "none" }} aria-label={`主色 ${i + 1}`} />
              ))}
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "#1D2433" }}>
            背景色
            <input type="color" value={background} onChange={(e) => { setBackground(e.target.value); emit({ background: e.target.value }); }} />
          </label>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "#1D2433" }}>
            文字色
            <input type="color" value={text} onChange={(e) => { setText(e.target.value); emit({ text: e.target.value }); }} />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 13, color: "#1D2433" }}>
            字体
            <select value={fontFamily} onChange={(e) => { setFontFamily(e.target.value); emit({ fontFamily: e.target.value }); }} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #E3E7EE" }}>
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>

          <button type="button" onClick={() => toggle(false)} style={{ marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid #E3E7EE", background: "#F8FAFC", color: "#52607A", cursor: "pointer" }}>
            重置为自动主题
          </button>
        </div>
      )}
    </div>
  );
}
