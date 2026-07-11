"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { FigureSvg } from "@/components/figure-svg";
import { appUrl } from "@/lib/app-url";
import type { Deck, DeckSlide } from "@/lib/deck-types";
import type { UploadedAttachment } from "@/lib/types";

interface DeckResponse {
  requestId?: string;
  deck?: Deck;
  warnings?: string[];
  pptxBase64?: string;
  error?: string;
  details?: string[];
}

function randomSessionId(): string {
  return `lab-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function LabDeck() {
  const sessionId = useRef(randomSessionId());
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [context, setContext] = useState("");
  const [styleHint, setStyleHint] = useState("");
  const [template, setTemplate] = useState<UploadedAttachment | null>(null);
  const [uploadNote, setUploadNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const uploadAttachment = useCallback(async (file: File): Promise<UploadedAttachment> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sessionId", sessionId.current);
    formData.append("conversationId", sessionId.current);
    const response = await fetch(appUrl("/api/attachments"), { method: "POST", body: formData });
    const payload = (await response.json()) as { attachment?: UploadedAttachment; error?: string };
    if (!response.ok || !payload.attachment) {
      throw new Error(payload.error || "Upload failed.");
    }
    return payload.attachment;
  }, []);

  const onUploadDoc = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError("");
      setUploadNote(language === "zh" ? "正在解析文档…" : "Parsing document…");
      try {
        const attachment = await uploadAttachment(file);
        if (attachment.extractedText) {
          setContext((prev) => (prev ? `${prev}\n\n${attachment.extractedText}` : attachment.extractedText ?? ""));
        }
        setUploadNote(language === "zh" ? `已导入：${attachment.originalName}` : `Imported: ${attachment.originalName}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
        setUploadNote("");
      }
    },
    [language, uploadAttachment]
  );

  const onUploadTemplate = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError("");
      try {
        const attachment = await uploadAttachment(file);
        setTemplate(attachment);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    },
    [uploadAttachment]
  );

  const generate = useCallback(async () => {
    if (!context.trim()) {
      setError(language === "zh" ? "请先粘贴内容或上传文档。" : "Add context or upload a document first.");
      return;
    }
    setBusy(true);
    setError("");
    setDeck(null);
    setWarnings([]);
    try {
      const response = await fetch(appUrl("/api/lab/deck"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context,
          language,
          styleHint,
          attachments: template ? [template] : [],
          sessionId: sessionId.current
        })
      });
      const payload = (await response.json()) as DeckResponse;
      if (!response.ok || !payload.deck) {
        throw new Error(payload.error || (payload.details ? payload.details.join("; ") : "Generation failed."));
      }
      setDeck(payload.deck);
      setWarnings(payload.warnings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }, [context, language, styleHint, template]);

  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const downloadBlob = useCallback(
    (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(deck?.title || "deck").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60)}.pptx`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [deck]
  );

  // Re-export from the current (possibly edited/reordered) deck so downloads
  // always reflect on-screen edits.
  const exportDeck = useCallback(async () => {
    if (!deck) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(appUrl("/api/lab/deck/export"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Export failed.");
      }
      downloadBlob(await response.blob());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }, [deck, downloadBlob]);

  const moveSlide = useCallback((index: number, dir: -1 | 1) => {
    setDeck((prev) => {
      if (!prev) return prev;
      const target = index + dir;
      if (target < 0 || target >= prev.slides.length) return prev;
      const slides = [...prev.slides];
      [slides[index], slides[target]] = [slides[target], slides[index]];
      return { ...prev, slides };
    });
  }, []);

  const deleteSlide = useCallback((index: number) => {
    setDeck((prev) => (prev ? { ...prev, slides: prev.slides.filter((_, i) => i !== index) } : prev));
  }, []);

  const regenerateSlide = useCallback(
    async (index: number) => {
      if (!deck) return;
      const slide = deck.slides[index];
      if (slide.kind !== "diagram") return;
      setRegeneratingIndex(index);
      setError("");
      try {
        const response = await fetch(appUrl("/api/lab/deck/slide"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context,
            title: slide.title,
            language,
            palette: deck.palette,
            sessionId: sessionId.current
          })
        });
        const payload = (await response.json()) as { slide?: DeckSlide; error?: string };
        if (!response.ok || !payload.slide) {
          throw new Error(payload.error || "Regeneration failed.");
        }
        setDeck((prev) => {
          if (!prev) return prev;
          const slides = [...prev.slides];
          slides[index] = payload.slide as DeckSlide;
          return { ...prev, slides };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Regeneration failed.");
      } finally {
        setRegeneratingIndex(null);
      }
    },
    [deck, context, language]
  );

  const t = useMemo(() => strings[language], [language]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">lab · beta</div>
          <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-mid">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={appUrl(`/${language}`)} className="text-sm text-mid underline hover:text-accent">
            {t.backToWorkspace}
          </a>
          <div className="flex overflow-hidden border border-line">
            {(["zh", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                className={`px-3 py-1 text-sm ${language === l ? "bg-ink text-white" : "bg-panel text-mid"}`}
              >
                {l === "zh" ? "中文" : "EN"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-mid">{t.contextLabel}</label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder={t.contextPlaceholder}
            className="min-h-[260px] resize-y border border-line bg-panel p-3 text-sm leading-6 text-ink outline-none focus:border-accent/60"
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-mid">{t.docLabel}</span>
            <label className="cursor-pointer border border-dashed border-line bg-panel px-3 py-2 text-center text-sm text-mid hover:border-accent/60">
              {t.uploadDoc}
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.md,.txt"
                className="hidden"
                onChange={(e) => onUploadDoc(e.target.files?.[0])}
              />
            </label>
            {uploadNote ? <span className="text-xs text-mid">{uploadNote}</span> : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-mid">{t.styleLabel}</span>
            <label className="cursor-pointer border border-dashed border-line bg-panel px-3 py-2 text-center text-sm text-mid hover:border-accent/60">
              {template ? `✓ ${template.originalName}` : t.uploadTemplate}
              <input
                type="file"
                accept=".pptx"
                className="hidden"
                onChange={(e) => onUploadTemplate(e.target.files?.[0])}
              />
            </label>
            <input
              type="text"
              value={styleHint}
              onChange={(e) => setStyleHint(e.target.value)}
              placeholder={t.stylePlaceholder}
              className="border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-accent/60"
            />
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent disabled:opacity-50"
          >
            {busy ? t.generating : t.generate}
          </button>
          {deck ? (
            <button
              type="button"
              onClick={exportDeck}
              disabled={exporting}
              className="border border-line bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-accent/60 disabled:opacity-50"
            >
              {exporting ? t.exporting : t.download}
            </button>
          ) : null}
          {error ? <div className="whitespace-pre-wrap text-sm text-coral">{error}</div> : null}
        </div>
      </section>

      {warnings.length ? (
        <div className="border border-amber-300/40 bg-amber-50/40 p-2 text-xs text-mid">
          {t.warnings}: {warnings.join(" · ")}
        </div>
      ) : null}

      {deck ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-ink">
            {t.result} · {deck.slides.length} {t.slides}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {deck.slides.map((slide, index) => (
              <SlideCard
                key={index}
                slide={slide}
                deck={deck}
                index={index}
                total={deck.slides.length}
                regenerating={regeneratingIndex === index}
                onMove={moveSlide}
                onDelete={deleteSlide}
                onRegenerate={regenerateSlide}
                t={t}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SlideCard({
  slide,
  deck,
  index,
  total,
  regenerating,
  onMove,
  onDelete,
  onRegenerate,
  t
}: {
  slide: DeckSlide;
  deck: Deck;
  index: number;
  total: number;
  regenerating: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  onDelete: (index: number) => void;
  onRegenerate: (index: number) => void;
  t: (typeof strings)["zh"];
}) {
  const { palette } = deck;
  const ctrl = "flex h-6 w-6 items-center justify-center border border-line bg-panel text-mid transition hover:text-accent disabled:opacity-30";
  return (
    <div className="overflow-hidden border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] text-faint">
          #{index + 1} · {slide.kind}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className={ctrl} title={t.moveUp} disabled={index === 0} onClick={() => onMove(index, -1)}>↑</button>
          <button type="button" className={ctrl} title={t.moveDown} disabled={index === total - 1} onClick={() => onMove(index, 1)}>↓</button>
          {slide.kind === "diagram" ? (
            <button type="button" className={ctrl} title={t.regenerate} disabled={regenerating} onClick={() => onRegenerate(index)}>
              {regenerating ? "…" : "⟳"}
            </button>
          ) : null}
          <button type="button" className={ctrl} title={t.deleteSlide} onClick={() => onDelete(index)}>✕</button>
        </div>
      </div>
      <div className="aspect-video w-full overflow-hidden">
        {slide.kind === "diagram" ? (
          <FigureSvg figure={slide.figure} svgId={`lab-slide-${index}`} />
        ) : (
          <div
            className="flex h-full w-full flex-col justify-center gap-2 p-5"
            style={{ background: slide.kind === "section" ? palette.accent : palette.background }}
          >
            <div
              className="text-lg font-bold"
              style={{ color: slide.kind === "section" ? "#FFFFFF" : palette.text }}
            >
              {slide.title}
            </div>
            {slide.kind === "cover" && slide.subtitle ? (
              <div className="text-sm" style={{ color: palette.subtext }}>
                {slide.subtitle}
              </div>
            ) : null}
            {slide.kind === "bullets" ? (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm" style={{ color: palette.text }}>
                {slide.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

const strings: Record<"zh" | "en", Record<string, string>> = {
  zh: {
    title: "整套 PPT 生成（实验）",
    subtitle: "粘贴内容或上传文档，一次生成多页 PPT：文字页 + 复用现有 SVG 引擎的图表页。可上传 PPTX 模板或用文字描述风格。",
    backToWorkspace: "返回工作区",
    contextLabel: "内容 / 上下文",
    contextPlaceholder: "粘贴要做成 PPT 的内容，或上传文档自动导入…",
    docLabel: "文档",
    uploadDoc: "上传文档（pdf/docx/pptx/md/txt）",
    styleLabel: "风格 / 模板",
    uploadTemplate: "上传 PPTX 模板（提取配色/字体）",
    stylePlaceholder: "或用文字描述风格，如“蓝色科技风”",
    generate: "生成整套 PPT",
    generating: "生成中…",
    download: "下载 PPTX",
    exporting: "导出中…",
    result: "结果",
    slides: "页",
    warnings: "提示",
    moveUp: "上移",
    moveDown: "下移",
    regenerate: "重新生成此页",
    deleteSlide: "删除此页"
  },
  en: {
    title: "Full deck generation (lab)",
    subtitle: "Paste content or upload a document to generate a multi-slide deck: text slides plus diagram slides that reuse the existing SVG engine. Upload a PPTX template or describe a style.",
    backToWorkspace: "Back to workspace",
    contextLabel: "Content / context",
    contextPlaceholder: "Paste the content for your deck, or upload a document…",
    docLabel: "Document",
    uploadDoc: "Upload document (pdf/docx/pptx/md/txt)",
    styleLabel: "Style / template",
    uploadTemplate: "Upload PPTX template (colors/fonts)",
    stylePlaceholder: "…or describe a style, e.g. 'blue tech'",
    generate: "Generate deck",
    generating: "Generating…",
    download: "Download PPTX",
    exporting: "Exporting…",
    result: "Result",
    slides: "slides",
    warnings: "Notes",
    moveUp: "Move up",
    moveDown: "Move down",
    regenerate: "Regenerate this slide",
    deleteSlide: "Delete this slide"
  }
};
