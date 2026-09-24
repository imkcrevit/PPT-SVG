// Geometry auditor shared by the collision regression tests. It walks a compiled
// Figure and reports what a viewer would perceive as a broken slide:
//
//   text-cut       a label is wrapped past its text box and gets "..." truncated
//   text-overlap   two rendered text blocks overlap each other
//   text-spill     a label's rendered block pokes out of the shape it sits on
//   shape-overlap  two cards/boxes partially overlap (neither contains the other)
//   line-text      a connector/line runs through a label that is not its own
//
// Rendered text blocks are computed with the same wrap/measure the SVG renderer
// uses, so a pass here means the SVG really has no visible collision.

import { limitLinesToHeight, measureSvgText, sanitizeDisplayText, wrapSvgText } from "@/lib/text-layout";
import type { Figure, FigureElement, RectElement, TextElement } from "@/lib/types";

export interface Issue {
  kind: "text-cut" | "text-overlap" | "text-spill" | "shape-overlap" | "line-text";
  detail: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TextInfo {
  el: TextElement;
  box: Box;
  group?: string;
}

interface RectInfo {
  el: RectElement;
  box: Box;
  group?: string;
}

const TOL = 1.5;

function overlapArea(a: Box, b: Box): { w: number; h: number } {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { w, h };
}

function overlaps(a: Box, b: Box, tol = TOL): boolean {
  const o = overlapArea(a, b);
  return o.w > tol && o.h > tol;
}

function contains(outer: Box, inner: Box, tol = TOL): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
}

/** The rectangle the SVG renderer actually paints for a text element. */
export function renderedTextBox(el: TextElement): { box: Box; cut: boolean } {
  const fontSize = el.fontSize ?? 22;
  const width = el.width ?? 240;
  const lineHeight = fontSize * 1.18;
  const wrapped = wrapSvgText(el.text, width, fontSize);
  const height = el.height ?? wrapped.length * lineHeight;
  const lines = limitLinesToHeight(wrapped, height, lineHeight, { width, fontSize });
  const clean = sanitizeDisplayText(el.text);
  const cut = clean.length > 0 && lines.join("").replace(/\s/g, "").length < clean.replace(/\s/g, "").length;
  const textW = Math.max(...lines.map((line) => measureSvgText(line, fontSize)), 0);
  const blockH = lines.length * lineHeight;
  const anchor = el.textAnchor ?? "middle";
  const left = anchor === "start" ? el.x : anchor === "end" ? el.x + width - textW : el.x + (width - textW) / 2;
  // Glyphs sit ~0.1em inside the line box on top and bottom.
  const top = el.y + (height - blockH) / 2 + fontSize * 0.08;
  return { box: { x: left, y: top, w: textW, h: Math.max(0, blockH - fontSize * 0.16) }, cut };
}

function segmentHitsBox(x1: number, y1: number, x2: number, y2: number, b: Box, inset = 2): boolean {
  // Liang–Barsky clip against the box shrunk by `inset`.
  const bx1 = b.x + inset;
  const by1 = b.y + inset;
  const bx2 = b.x + b.w - inset;
  const by2 = b.y + b.h - inset;
  if (bx2 <= bx1 || by2 <= by1) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - bx1, bx2 - x1, y1 - by1, by2 - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t1 - t0 > 1e-6;
}

export function auditFigure(figure: Figure, opts: { ignoreIds?: (id: string) => boolean } = {}): Issue[] {
  const issues: Issue[] = [];
  const texts: TextInfo[] = [];
  const rects: RectInfo[] = [];
  const lines: Array<{ id: string; pts: Array<{ x: number; y: number }> }> = [];

  const walk = (els: FigureElement[], group?: string) => {
    for (const el of els) {
      if (opts.ignoreIds?.(el.id)) continue;
      if (el.type === "group") {
        walk(el.children, el.id);
      } else if (el.type === "text") {
        if (!sanitizeDisplayText(el.text)) continue;
        const { box, cut } = renderedTextBox(el);
        if (cut) issues.push({ kind: "text-cut", detail: `${el.id} "${el.text.slice(0, 24)}"` });
        texts.push({ el, box, group });
      } else if (el.type === "rect") {
        rects.push({ el, box: { x: el.x, y: el.y, w: el.width, h: el.height }, group });
      } else if (el.type === "connector") {
        lines.push({ id: el.id, pts: el.points });
      } else if (el.type === "line" || el.type === "arrow") {
        lines.push({ id: el.id, pts: [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }] });
      }
    }
  };
  walk(figure.elements);

  // Visible shapes only: invisible plates / thin rules are not "boxes".
  const shapes = rects.filter((r) => r.box.w > 8 && r.box.h > 8 && (r.el.stroke && r.el.stroke !== "none" ? true : r.el.fill !== "none"));

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (overlaps(texts[i].box, texts[j].box)) {
        issues.push({ kind: "text-overlap", detail: `${texts[i].el.id} × ${texts[j].el.id}` });
      }
    }
  }

  // A text that sits on a shape (its center is inside it) must stay inside it.
  for (const t of texts) {
    const cx = t.box.x + t.box.w / 2;
    const cy = t.box.y + t.box.h / 2;
    const hosts = shapes.filter((s) => cx > s.box.x && cx < s.box.x + s.box.w && cy > s.box.y && cy < s.box.y + s.box.h);
    // Innermost host = smallest area.
    const host = hosts.sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
    if (host && !contains(host.box, t.box, 2)) {
      issues.push({ kind: "text-spill", detail: `${t.el.id} spills out of ${host.el.id}` });
    }
    // A text must not be partially covered by an unrelated shape.
    for (const s of shapes) {
      if (s === host || hosts.includes(s)) continue;
      // Same-colour decoration fused with the host (e.g. a title bar's base).
      if (host && s.el.fill === host.el.fill && (!s.el.stroke || s.el.stroke === "none")) continue;
      if (overlaps(s.box, t.box, 2) && !contains(s.box, t.box, 2)) {
        issues.push({ kind: "text-spill", detail: `${t.el.id} clipped by ${s.el.id}` });
      }
    }
  }

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i].box;
      const b = shapes[j].box;
      if (overlaps(a, b, 2) && !contains(a, b, 2) && !contains(b, a, 2)) {
        issues.push({ kind: "shape-overlap", detail: `${shapes[i].el.id} × ${shapes[j].el.id}` });
      }
    }
  }

  // Pale chart gridlines sit behind values by design; they are not collisions.
  for (const line of lines.filter((l) => !/-grid-/.test(l.id))) {
    const stem = line.id.replace(/-connector$/, "");
    for (const t of texts) {
      if (t.el.id.startsWith(`${stem}-label`)) continue;
      for (let k = 0; k + 1 < line.pts.length; k++) {
        const a = line.pts[k];
        const b = line.pts[k + 1];
        if (segmentHitsBox(a.x, a.y, b.x, b.y, t.box)) {
          issues.push({ kind: "line-text", detail: `${line.id} crosses ${t.el.id}` });
          break;
        }
      }
    }
  }

  return issues;
}
