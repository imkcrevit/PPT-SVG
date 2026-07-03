"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode, WheelEvent } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const STEP = 0.25;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

/**
 * Zoom/pan viewport for the diagram preview. Zoom is applied by growing the
 * inner box (width = scale * 100%) inside an overflow-auto scroller, so panning
 * is native scrolling and FigureSvg's getScreenCTM-based hit-testing keeps
 * working at any zoom. Wheel zooms toward the cursor; scrollbars pan.
 */
export function PreviewViewport({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const zoomToward = useCallback(
    (nextScale: number, clientX: number, clientY: number) => {
      const el = scrollRef.current;
      const clamped = clampScale(nextScale);
      setScale((prev) => {
        if (el && clamped !== prev) {
          const rect = el.getBoundingClientRect();
          const offsetX = clientX - rect.left;
          const offsetY = clientY - rect.top;
          const contentX = el.scrollLeft + offsetX;
          const contentY = el.scrollTop + offsetY;
          const ratio = clamped / prev;
          requestAnimationFrame(() => {
            el.scrollLeft = contentX * ratio - offsetX;
            el.scrollTop = contentY * ratio - offsetY;
          });
        }
        return clamped;
      });
    },
    []
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? STEP : -STEP;
      zoomToward(scale + delta, event.clientX, event.clientY);
    },
    [scale, zoomToward]
  );

  const zoomByButton = useCallback(
    (delta: number) => {
      const el = scrollRef.current;
      const rect = el?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : 0;
      const cy = rect ? rect.top + rect.height / 2 : 0;
      zoomToward(scale + delta, cx, cy);
    },
    [scale, zoomToward]
  );

  const reset = useCallback(() => {
    const el = scrollRef.current;
    setScale(1);
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  }, []);

  const btn =
    "flex h-7 w-7 items-center justify-center border border-line bg-panel/90 text-mid transition hover:text-accent disabled:opacity-40";

  return (
    <div className="relative aspect-video w-full max-w-[1080px] overflow-hidden border border-line bg-panel">
      <div ref={scrollRef} className="h-full w-full overflow-auto" onWheel={handleWheel}>
        <div className="aspect-video" style={{ width: `${scale * 100}%`, minWidth: "100%" }}>
          {children}
        </div>
      </div>
      <div className="pointer-events-auto absolute bottom-2 right-2 flex items-center gap-1 select-none">
        <button type="button" className={btn} onClick={() => zoomByButton(-STEP)} disabled={scale <= MIN_SCALE} aria-label="Zoom out" title="缩小">
          <Minus size={14} />
        </button>
        <span className="min-w-[3rem] text-center font-mono text-[11px] text-mid tabular-nums">{Math.round(scale * 100)}%</span>
        <button type="button" className={btn} onClick={() => zoomByButton(STEP)} disabled={scale >= MAX_SCALE} aria-label="Zoom in" title="放大">
          <Plus size={14} />
        </button>
        <button type="button" className={btn} onClick={reset} disabled={scale === MIN_SCALE} aria-label="Reset zoom" title="重置">
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
