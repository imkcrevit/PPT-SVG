"use client";

import { CheckCircle2, FileUp, Loader2, MessageSquarePlus, Palette, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FigureSvg } from "@/components/figure-svg";
import type { Deck, DeckSlide } from "@/features/deck/types";
import { appUrl } from "@/lib/app-url";
import type { UploadedAttachment } from "@/lib/types";

interface DeckResponse {
  requestId?: string;
  model?: string;
  deck?: Deck;
  warnings?: string[];
  error?: string;
  details?: string[];
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "done" | "error";
}

function randomSessionId(): string {
  return `lab-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function uid(): string {
  return crypto.randomUUID();
}

export function LabDeck() {
  const sessionId = useRef(randomSessionId());
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const t = useMemo(() => strings[language], [language]);

  // Conversation state
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [baseContext, setBaseContext] = useState(""); // uploaded/pasted document text
  const [notes, setNotes] = useState<string[]>([]); // accumulated briefs / revision instructions
  const [styleHint, setStyleHint] = useState("");
  const [template, setTemplate] = useState<UploadedAttachment | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const pushEntry = useCallback((entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  const patchEntry = useCallback((id: string, patch: Partial<ChatEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

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
      try {
        const attachment = await uploadAttachment(file);
        if (attachment.extractedText) {
          setBaseContext((prev) => (prev ? `${prev}\n\n${attachment.extractedText}` : attachment.extractedText ?? ""));
        }
        pushEntry({ id: uid(), role: "assistant", content: `${t.importedDoc}：${attachment.originalName}`, status: "done" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    },
    [uploadAttachment, pushEntry, t]
  );

  const onUploadTemplate = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError("");
      try {
        const attachment = await uploadAttachment(file);
        setTemplate(attachment);
        pushEntry({ id: uid(), role: "assistant", content: `${t.appliedTemplate}：${attachment.originalName}`, status: "done" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    },
    [uploadAttachment, pushEntry, t]
  );

  // A single "send" either generates the first deck or revises the current one.
  const send = useCallback(async () => {
    if (busy) return;
    const instruction = draft.trim();
    const revising = Boolean(deck);

    // Compose the effective context: base document + accumulated instructions.
    const nextNotes = instruction ? [...notes, instruction] : notes;
    const contextParts = [baseContext.trim(), nextNotes.length ? `【${t.notesHeading}】\n${nextNotes.join("\n")}` : ""];
    const context = contextParts.filter(Boolean).join("\n\n").trim();

    if (!context) {
      setError(t.emptyPrompt);
      return;
    }

    // Chat bubbles
    const userText = instruction || (revising ? t.regenerateAll : t.generateDefault);
    pushEntry({ id: uid(), role: "user", content: userText });
    const pendingId = uid();
    pushEntry({ id: pendingId, role: "assistant", content: revising ? t.revising : t.generating, status: "pending" });

    setDraft("");
    if (instruction) setNotes(nextNotes);
    setBusy(true);
    setError("");

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
        throw new Error(payload.error || (payload.details ? payload.details.join("; ") : t.genericError));
      }
      setDeck(payload.deck);
      setWarnings(payload.warnings ?? []);
      setModel(payload.model ?? "");
      const summary = `${revising ? t.updatedTo : t.generatedTo} ${payload.deck.slides.length} ${t.slides}：${payload.deck.title}`;
      patchEntry(pendingId, { content: summary, status: "done" });
    } catch (e) {
      const message = e instanceof Error ? e.message : t.genericError;
      setError(message);
      patchEntry(pendingId, { content: message, status: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, draft, deck, notes, baseContext, language, styleHint, template, pushEntry, patchEntry, t]);

  const newConversation = useCallback(() => {
    sessionId.current = randomSessionId();
    setEntries([]);
    setDraft("");
    setBaseContext("");
    setNotes([]);
    setStyleHint("");
    setTemplate(null);
    setDeck(null);
    setWarnings([]);
    setModel("");
    setError("");
  }, []);

  // ── Deck editing (reorder / delete / regenerate / export) ──────────────────
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
        throw new Error(payload.error || t.exportFailed);
      }
      downloadBlob(await response.blob());
    } catch (e) {
      setError(e instanceof Error ? e.message : t.exportFailed);
    } finally {
      setExporting(false);
    }
  }, [deck, downloadBlob, t]);

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
            context: [baseContext, notes.join("\n")].filter(Boolean).join("\n\n"),
            title: slide.title,
            language,
            palette: deck.palette,
            sessionId: sessionId.current
          })
        });
        const payload = (await response.json()) as { slide?: DeckSlide; error?: string };
        if (!response.ok || !payload.slide) {
          throw new Error(payload.error || t.regenFailed);
        }
        setDeck((prev) => {
          if (!prev) return prev;
          const slides = [...prev.slides];
          slides[index] = payload.slide as DeckSlide;
          return { ...prev, slides };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t.regenFailed);
      } finally {
        setRegeneratingIndex(null);
      }
    },
    [deck, baseContext, notes, language, t]
  );

  return (
    <main className="workspace-main text-ink">
      <div className="workspace-shell">
        <header className="flex flex-col gap-4 border border-line bg-panel/95 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-accent">lab · beta</div>
            <h1 className="mt-1 truncate text-xl font-semibold tracking-[0.03em] text-ink sm:text-2xl">{t.title}</h1>
            <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-5 text-mid sm:text-sm">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={appUrl(`/${language}`)} className="flex h-9 items-center border border-line bg-panel px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-mid transition hover:border-accent/40 hover:text-accent2">
              {t.backToWorkspace}
            </a>
            <div className="grid grid-cols-2 border border-line bg-bg2 p-1 sm:flex">
              {(["zh", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLanguage(l)}
                  className={`px-3 py-1.5 text-center font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition ${language === l ? "bg-panel text-ink" : "text-mid hover:text-accent2"}`}
                >
                  {l === "zh" ? "中文" : "EN"}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
          {/* ── Conversation panel ── */}
          <section className="workspace-chat-panel border border-line bg-panel">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">01</span>
              <h2 className="text-sm font-semibold tracking-[0.04em] text-ink">{t.chatTitle}</h2>
              <div className="h-px flex-1 bg-line" />
              <button
                type="button"
                onClick={newConversation}
                title={t.newConversation}
                className="flex h-8 w-8 items-center justify-center border border-line bg-panel text-mid transition hover:border-accent/40 hover:text-accent2"
              >
                <MessageSquarePlus size={15} />
              </button>
            </div>

            <div className="chat-workspace-body">
              <div className="chat-toolbar">
                <div className="chat-model-pill">
                  <span>{model || t.modelFromEnv}</span>
                  {model ? <CheckCircle2 className="shrink-0 text-mint" size={14} /> : null}
                </div>

                <button type="button" onClick={() => fileInputRef.current?.click()} className="chat-toolbar-button">
                  <FileUp size={13} />
                  <span>{baseContext ? t.docReady : t.uploadDoc}</span>
                </button>
                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.pptx,.md,.txt" className="hidden" onChange={(e) => void onUploadDoc(e.target.files?.[0])} />

                <button type="button" onClick={() => templateInputRef.current?.click()} className="chat-toolbar-button">
                  <Palette size={13} />
                  <span>{template ? `✓ ${template.originalName}` : t.uploadTemplate}</span>
                </button>
                <input ref={templateInputRef} type="file" accept=".pptx" className="hidden" onChange={(e) => void onUploadTemplate(e.target.files?.[0])} />

                <label className="chat-toolbar-field">
                  <span>{t.styleLabel}</span>
                  <input type="text" value={styleHint} onChange={(e) => setStyleHint(e.target.value)} placeholder={t.stylePlaceholder} />
                </label>
              </div>

              <div className="workspace-chat-history flex flex-col">
                <div ref={scrollRef} className="workspace-chat-scroll chat-thread">
                  {entries.length ? (
                    entries.map((entry) => (
                      <div key={entry.id} className={`chat-message ${entry.role === "user" ? "is-user" : "is-assistant"} ${entry.status === "error" ? "is-error" : ""}`}>
                        <div className="chat-bubble">
                          <div className="chat-meta">
                            <span>{entry.role === "user" ? t.you : t.assistant}</span>
                            {entry.status === "pending" ? <Loader2 size={12} className="animate-spin" /> : null}
                          </div>
                          <div className="chat-content">{entry.content}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="chat-empty-state">{t.chatEmpty}</div>
                  )}
                </div>
              </div>

              <label className="chat-composer">
                <span className="chat-composer-label">{deck ? t.reviseLabel : t.promptLabel}</span>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={deck ? t.revisePlaceholder : t.promptPlaceholder}
                  rows={3}
                  className="chat-composer-input"
                />
              </label>

              <div className="chat-actions">
                <button type="button" onClick={() => void send()} disabled={busy} className="chat-primary-action">
                  {busy ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  <span>{busy ? (deck ? t.revising : t.generating) : deck ? t.reviseSubmit : t.submit}</span>
                </button>
              </div>

              {error ? (
                <div className="chat-error">
                  <div className="font-semibold">{t.errorTitle}</div>
                  <div className="mt-1 leading-5">{error}</div>
                </div>
              ) : null}
            </div>
          </section>

          {/* ── Preview panel ── */}
          <section className="workspace-preview-panel flex flex-col overflow-hidden border border-line bg-panel">
            <div className="flex flex-col gap-3 border-b border-line bg-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-mid">
                {deck ? `${t.result} · ${deck.slides.length} ${t.slides}` : t.previewIdle}
              </div>
              {deck ? (
                <button
                  type="button"
                  onClick={() => void exportDeck()}
                  disabled={exporting}
                  className="flex h-9 items-center justify-center gap-2 border border-line bg-ink px-3 text-sm font-semibold text-white transition hover:bg-accent disabled:opacity-40"
                >
                  {exporting ? <Loader2 size={16} className="animate-spin" /> : null}
                  <span>{exporting ? t.exporting : t.download}</span>
                </button>
              ) : null}
            </div>

            {warnings.length ? (
              <div className="border-b border-amber-300/40 bg-amber-50/40 px-4 py-2 text-xs text-mid">
                {t.warnings}: {warnings.join(" · ")}
              </div>
            ) : null}

            <div className="flex-1 overflow-auto bg-bg2 p-3 sm:p-4">
              {busy && !deck ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 border border-line bg-panel/95 text-center">
                  <Loader2 size={28} className="animate-spin text-cobalt" />
                  <div className="animate-pulse text-sm font-semibold text-ink">{t.generating}</div>
                </div>
              ) : deck ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
              ) : (
                <div className="flex min-h-[300px] flex-col items-center justify-center px-4 text-center">
                  <div className="max-w-sm font-mono text-[11px] uppercase tracking-[0.12em] text-faint">{t.emptyState}</div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
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
  t: Record<string, string>;
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
          <div className="flex h-full w-full flex-col justify-center gap-2 p-5" style={{ background: slide.kind === "section" ? palette.accent : palette.background }}>
            <div className="text-lg font-bold" style={{ color: slide.kind === "section" ? "#FFFFFF" : palette.text }}>
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
    subtitle: "像聊天一样生成整套 PPT：先给内容或上传文档，再用对话不断调整。文字页 + 复用 SVG 引擎的图表页。",
    backToWorkspace: "返回工作区",
    chatTitle: "对话",
    newConversation: "新建对话",
    modelFromEnv: "环境变量模型",
    uploadDoc: "上传文档",
    docReady: "✓ 已导入文档",
    uploadTemplate: "上传模板",
    styleLabel: "风格",
    stylePlaceholder: "如“蓝色科技风”",
    chatEmpty: "描述你要做的 PPT，或先上传文档，然后发送。",
    promptLabel: "内容 / 要求",
    promptPlaceholder: "例如：把这份立项报告做成 10 页申报风格的 PPT…",
    reviseLabel: "继续调整",
    revisePlaceholder: "例如：第 3 页改成雷达图；封面更酷炫一些；再加一页讲预算…",
    submit: "生成整套 PPT",
    reviseSubmit: "按要求更新",
    generating: "生成中…",
    revising: "更新中…",
    generateDefault: "生成整套 PPT",
    regenerateAll: "根据要求重新生成",
    notesHeading: "制作要求",
    generatedTo: "已生成",
    updatedTo: "已更新为",
    slides: "页",
    importedDoc: "已导入文档",
    appliedTemplate: "已应用模板配色",
    result: "结果",
    previewIdle: "预览",
    emptyState: "生成后在这里预览与编辑每一页",
    download: "下载 PPTX",
    exporting: "导出中…",
    warnings: "提示",
    errorTitle: "出错了",
    genericError: "生成失败。",
    exportFailed: "导出失败。",
    regenFailed: "重新生成失败。",
    you: "你",
    assistant: "助手",
    moveUp: "上移",
    moveDown: "下移",
    regenerate: "重新生成此页",
    deleteSlide: "删除此页"
  },
  en: {
    title: "Full deck generation (lab)",
    subtitle: "Build a full deck like a chat: give content or upload a doc, then refine by conversation. Text slides plus diagram slides that reuse the SVG engine.",
    backToWorkspace: "Back to workspace",
    chatTitle: "Conversation",
    newConversation: "New conversation",
    modelFromEnv: "Model from env",
    uploadDoc: "Upload doc",
    docReady: "✓ Doc imported",
    uploadTemplate: "Template",
    styleLabel: "Style",
    stylePlaceholder: "e.g. 'blue tech'",
    chatEmpty: "Describe the deck you want, or upload a document first, then send.",
    promptLabel: "Content / brief",
    promptPlaceholder: "e.g. Turn this proposal into a 10-slide deck…",
    reviseLabel: "Keep refining",
    revisePlaceholder: "e.g. Make slide 3 a radar chart; jazz up the cover; add a budget slide…",
    submit: "Generate deck",
    reviseSubmit: "Apply changes",
    generating: "Generating…",
    revising: "Updating…",
    generateDefault: "Generate deck",
    regenerateAll: "Regenerate with changes",
    notesHeading: "Requirements",
    generatedTo: "Generated",
    updatedTo: "Updated to",
    slides: "slides",
    importedDoc: "Imported document",
    appliedTemplate: "Applied template colors",
    result: "Result",
    previewIdle: "Preview",
    emptyState: "Preview and edit each slide here after generating",
    download: "Download PPTX",
    exporting: "Exporting…",
    warnings: "Notes",
    errorTitle: "Something went wrong",
    genericError: "Generation failed.",
    exportFailed: "Export failed.",
    regenFailed: "Regeneration failed.",
    you: "You",
    assistant: "Assistant",
    moveUp: "Move up",
    moveDown: "Move down",
    regenerate: "Regenerate this slide",
    deleteSlide: "Delete this slide"
  }
};
