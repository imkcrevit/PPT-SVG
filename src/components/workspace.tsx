"use client";

import { Check, CheckCircle2, Database, ExternalLink, Loader2, MessageSquarePlus, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { FigureSvg } from "@/components/figure-svg";
import { appUrl } from "@/lib/app-url";
import { cloneFigure, findElement, findElements, updateElement } from "@/lib/figure-utils";
import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { dictionaries } from "@/lib/i18n";
import { INTERNAL_SKILLS } from "@/lib/skills";
import type { Figure, FigureElement, FitAssessment, Locale, SkillId, UploadedAttachment } from "@/lib/types";

interface WorkspaceProps {
  locale: Locale;
}

interface GenerateApiResponse {
  figure: Figure;
  fit: FitAssessment;
  requestId?: string;
  conversationTurn?: number;
  model?: string;
  artifacts?: {
    svgPath?: string;
    jsonPath?: string;
    logPath?: string;
  };
  error?: string;
  details?: string[];
}

interface AttachmentApiResponse {
  attachment?: UploadedAttachment;
  error?: string;
}

interface OptimizeApiResponse {
  optimizedDescription?: string;
  error?: string;
}

const ACCEPTED_CONTEXT_EXTENSIONS = [".pdf", ".md", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".pptx"];
const MAX_CONVERSATION_TURNS = 5;

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  turn: number;
  status?: "pending" | "done" | "error";
  referencedRender?: boolean;
  requestId?: string;
}

interface RenderHistoryEntry {
  id: string;
  turn: number;
  requestId: string;
  title: string;
  fitScore: number;
  referencedRender: boolean;
  figure: Figure;
  fit: FitAssessment;
}

export function Workspace({ locale }: WorkspaceProps) {
  const t = dictionaries[locale];
  const [skillId, setSkillId] = useState<SkillId>("freeform");
  const [description, setDescription] = useState("");
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [optimizedPromptReady, setOptimizedPromptReady] = useState(false);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryEntry[]>([]);
  const [referenceCurrentRender, setReferenceCurrentRender] = useState(true);
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [figure, setFigure] = useState<Figure | null>(null);
  const [fit, setFit] = useState<FitAssessment | null>(null);
  const [model, setModel] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"preview" | "json">("preview");
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [history, setHistory] = useState<Figure[]>([]);
  const [error, setError] = useState("");
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationIdRef = useRef(crypto.randomUUID());
  const thinkingStatus = generationStatus ? `${generationStatus} ${generationSeconds}s` : "";
  const conversationTurnCount = chatEntries.filter((entry) => entry.role === "user").length;
  const remainingTurns = Math.max(0, MAX_CONVERSATION_TURNS - conversationTurnCount);
  const canReferenceCurrentRender = Boolean(figure);
  const shouldReferenceCurrentRender = referenceCurrentRender && canReferenceCurrentRender;

  const selectedElement = useMemo(
    () => (figure && selectedId ? findElement(figure.elements, selectedId) : undefined),
    [figure, selectedId]
  );
  const selectedElements = useMemo(
    () => (figure ? findElements(figure.elements, selectedIds) : []),
    [figure, selectedIds]
  );
  const jsonPayload = useMemo(() => (figure ? JSON.stringify({ figure, fit }, null, 2) : ""), [figure, fit]);

  useEffect(() => {
    if (generationStartedAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setGenerationSeconds(Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [generationStartedAt]);

  async function handleGenerate() {
    if (!description.trim()) {
      setError(t.emptyPrompt);
      return;
    }

    if (conversationTurnCount >= MAX_CONVERSATION_TURNS) {
      setError(t.turnLimitReached);
      return;
    }

    const userMessage = description.trim();
    const turn = conversationTurnCount + 1;
    const userMessageId = crypto.randomUUID();
    const pendingMessageId = crypto.randomUUID();
    const referencedRender = shouldReferenceCurrentRender;

    setChatEntries((entries) => [
      ...entries,
      {
        id: userMessageId,
        role: "user",
        content: userMessage,
        turn,
        referencedRender
      },
      {
        id: pendingMessageId,
        role: "assistant",
        content: t.chatPending,
        turn,
        status: "pending",
        referencedRender
      }
    ]);
    setDescription("");
    setIsGenerating(true);
    setError("");
    setGenerationStatus(t.generateThinking);
    setGenerationStartedAt(Date.now());
    setGenerationSeconds(0);
    setSelectedId("");
    setSelectedIds([]);

    try {
      const generateUrl = appUrl("/api/generate");
      const response = await fetch(generateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          skillId,
          userDescription: userMessage,
          language: locale,
          conversationId: conversationIdRef.current,
          conversationTurn: turn,
          referenceFigure: referencedRender && figure ? { source: "current-render", figure, fit } : undefined,
          clientLog: {
            messageId: userMessageId,
            sentAt: new Date().toISOString()
          },
          attachments: attachment ? [attachment] : []
        })
      });
      const responseText = await response.text();
      let payload: GenerateApiResponse;

      try {
        payload = JSON.parse(responseText) as GenerateApiResponse;
      } catch {
        throw new Error(`${response.status} ${response.statusText || "Invalid response"} from ${generateUrl}`);
      }

      if (!response.ok) {
        const message = [payload.error, ...(payload.details ?? [])].filter(Boolean).join(" ");
        throw new Error(isJsonSyntaxError(message) ? t.malformedModelJson : message);
      }

      setGenerationStatus(t.generateRendering);
      setFigure(payload.figure);
      setFit(payload.fit);
      setModel(payload.model ?? "");
      setHistory([]);
      setActiveTab("preview");
      setOptimizedPromptReady(false);
      setChatEntries((entries) =>
        entries.map((entry) =>
          entry.id === pendingMessageId
            ? {
                ...entry,
                content: `${t.chatRendered}: ${payload.figure.metadata.title}`,
                status: "done",
                requestId: payload.requestId
              }
            : entry
        )
      );
      setRenderHistory((logs) => [
        {
          id: payload.requestId ?? pendingMessageId,
          turn,
          requestId: payload.requestId ?? "-",
          title: payload.figure.metadata.title,
          fitScore: payload.fit.score,
          referencedRender,
          figure: cloneFigure(payload.figure),
          fit: payload.fit
        },
        ...logs
      ]);
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : t.errorTitle;
      setError(message);
      setChatEntries((entries) =>
        entries.map((entry) =>
          entry.id === pendingMessageId
            ? {
                ...entry,
                content: message,
                status: "error"
              }
            : entry
        )
      );
    } finally {
      setIsGenerating(false);
      setGenerationStatus("");
      setGenerationStartedAt(null);
      setGenerationSeconds(0);
    }
  }

  async function handleOptimizePrompt() {
    if (!description.trim()) {
      setError(t.emptyPrompt);
      return;
    }

    setIsOptimizingPrompt(true);
    setError("");

    try {
      const response = await fetch(appUrl("/api/optimize-prompt"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          userDescription: description.trim(),
          language: locale,
          skillId,
          conversationId: conversationIdRef.current,
          conversationTurn: conversationTurnCount + 1,
          referenceFigure: shouldReferenceCurrentRender && figure ? { source: "current-render", figure, fit } : undefined
        })
      });
      const payload = (await response.json()) as OptimizeApiResponse;

      if (!response.ok || !payload.optimizedDescription) {
        throw new Error(payload.error || t.optimizeFailed);
      }

      setDescription(payload.optimizedDescription);
      setOptimizedPromptReady(true);
    } catch (optimizeError) {
      setError(optimizeError instanceof Error ? optimizeError.message : t.optimizeFailed);
    } finally {
      setIsOptimizingPrompt(false);
    }
  }

  function startNewConversation() {
    conversationIdRef.current = crypto.randomUUID();
    setDescription("");
    setChatEntries([]);
    setRenderHistory([]);
    setFigure(null);
    setFit(null);
    setSelectedId("");
    setSelectedIds([]);
    setJsonDraft("");
    setJsonError("");
    setHistory([]);
    setError("");
    setAttachment(null);
    setActiveTab("preview");
    setOptimizedPromptReady(false);
  }

  async function handleFile(file?: File) {
    setUploadError("");

    if (!file) {
      return;
    }

    if (!ACCEPTED_CONTEXT_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      setUploadError(t.invalidPpt);
      setAttachment(null);
      return;
    }

    setIsUploading(true);
    setAttachment(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversationId", conversationIdRef.current);

      const response = await fetch(appUrl("/api/attachments"), {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as AttachmentApiResponse;

      if (!response.ok || !payload.attachment) {
        throw new Error(payload.error || t.invalidPpt);
      }

      setAttachment(payload.attachment);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : t.invalidPpt);
    } finally {
      setIsUploading(false);
    }
  }

  function pushHistory(current: Figure) {
    setHistory((existing) => [cloneFigure(current), ...existing].slice(0, 3));
  }

  function handleUndo() {
    const [previous, ...rest] = history;
    if (!previous) {
      return;
    }

    setFigure(previous);
    setHistory(rest);
    setSelectedId("");
    setSelectedIds([]);
    setActiveTab("preview");
  }

  function openJsonEditor() {
    if (figure) {
      setJsonDraft(jsonPayload);
    }
    setJsonError("");
    setActiveTab("json");
  }

  function applyJsonDraft() {
    if (!figure) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonDraft);
    } catch (parseError) {
      setJsonError(parseError instanceof Error ? parseError.message : t.jsonInvalid);
      return;
    }

    const validation = validateAndNormalizeFigureResponse(parsed, figure.metadata.skillId, figure.metadata.language);
    if (!validation.ok || !validation.response) {
      setJsonError(validation.errors.slice(0, 6).join("\n") || t.jsonInvalid);
      return;
    }

    const hasEditedFit = Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && "fit" in parsed);
    pushHistory(figure);
    setFigure(validation.response.figure);
    setFit(hasEditedFit ? validation.response.fit : fit);
    setSelectedId("");
    setSelectedIds([]);
    setJsonDraft(JSON.stringify({ figure: validation.response.figure, fit: hasEditedFit ? validation.response.fit : fit }, null, 2));
    setJsonError("");
    setActiveTab("preview");
  }

  function patchSelected(updater: (element: FigureElement) => FigureElement) {
    if (!figure || !selectedIds.length) {
      return;
    }

    pushHistory(figure);
    const updatedElements = selectedIds.reduce(
      (elements, id) => updateElement(elements, id, updater),
      figure.elements
    );
    setFigure({
      ...figure,
      elements: updatedElements
    });
  }

  function handleSelectId(id: string) {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
  }

  function handleSelectIds(ids: string[]) {
    setSelectedIds(ids);
    setSelectedId(ids[0] ?? "");
  }

  function viewHistory(entry: RenderHistoryEntry) {
    if (figure) {
      pushHistory(figure);
    }

    setFigure(cloneFigure(entry.figure));
    setFit(entry.fit);
    setSelectedId("");
    setSelectedIds([]);
    setActiveTab("preview");
  }

  function downloadSvg() {
    const svg = document.getElementById("figure-svg");
    if (!svg) {
      return;
    }

    const serialized = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${serialized}\n`], {
      type: "image/svg+xml;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${figure?.metadata.title || "ppt-svg"}.svg`.replace(/[^\w.-]+/g, "-");
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <nav className="site-nav" aria-label="Graptolite Labs navigation">
        <a href="https://graptolite.ai" className="site-nav-logo">
          Graptolite
        </a>
        <ul className="site-nav-links">
          <li>
            <a href="https://graptolite.ai">Home</a>
          </li>
          <li>
            <a href="https://labs.graptolite.ai/">Labs</a>
          </li>
          <li>
            <a href="https://labs.graptolite.ai/timezones/">Time</a>
          </li>
          <li>
            <a href="https://labs.graptolite.ai/currency/">Currency</a>
          </li>
          <li>
            <a href={`https://labs.graptolite.ai/ppt/${locale}`} className="active" aria-current="page">
              PPT
            </a>
          </li>
        </ul>
      </nav>

      <main className="min-h-screen overflow-x-hidden px-7 pb-4 pt-[92px] text-ink lg:px-14 lg:pb-6 lg:pt-[94px]">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
        <header className="flex flex-col gap-4 border border-line bg-panel/95 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center">
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-accent">
                Graptolite Labs / SVG Workbench
              </div>
              <h1 className="mt-1 truncate text-xl font-semibold tracking-[0.03em] text-ink sm:text-2xl">{t.appName}</h1>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-mid sm:truncate sm:text-sm">
                {t.appSubtitle}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <a
              href="https://github.com/imkcrevit/PPT-SVG"
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center justify-center gap-2 border border-line bg-panel px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition hover:border-accent/40 hover:text-accent2"
              aria-label="Open PPT-SVG on GitHub"
            >
              <ExternalLink size={15} />
              <span>GitHub</span>
            </a>
            <div className="grid grid-cols-2 border border-line bg-bg2 p-1 sm:flex">
              <Link
                href="/en"
                className={`px-3 py-1.5 text-center font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition ${
                  locale === "en" ? "bg-panel text-ink" : "text-mid hover:text-accent2"
                }`}
              >
                {t.languageEnglish}
              </Link>
              <Link
                href="/zh"
                className={`px-3 py-1.5 text-center font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition ${
                  locale === "zh" ? "bg-panel text-ink" : "text-mid hover:text-accent2"
                }`}
              >
                {t.languageChinese}
              </Link>
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[352px_minmax(0,1fr)]">
          <section className="border border-line bg-panel">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">01</span>
              <h2 className="text-sm font-semibold tracking-[0.04em] text-ink">{t.chatTitle}</h2>
              <div className="h-px flex-1 bg-line" />
              <button
                type="button"
                onClick={startNewConversation}
                title={t.newConversation}
                className="flex h-8 w-8 items-center justify-center border border-line bg-panel text-mid transition hover:border-accent/40 hover:text-accent2"
              >
                <MessageSquarePlus size={15} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between border border-line bg-bg2 px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                  {t.conversationCount}: {conversationTurnCount}/{MAX_CONVERSATION_TURNS}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent2">
                  {remainingTurns} {t.turnsLeft}
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{t.skillLabel}</span>
                <select
                  value={skillId}
                  onChange={(event) => setSkillId(event.target.value as SkillId)}
                  className="h-10 w-full border border-line bg-bg px-3 text-sm text-ink transition hover:border-accent/40"
                >
                  {INTERNAL_SKILLS.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name[locale]}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{t.modelLabel}</div>
                <div className="flex min-h-10 items-center justify-between gap-3 border border-line bg-bg2 px-3 text-sm text-mid">
                  <span className="truncate">{model || t.modelFromEnv}</span>
                  {model ? <CheckCircle2 className="shrink-0 text-mint" size={16} /> : null}
                </div>
              </div>

              <div>
                <div className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                  {t.chatHistory}
                </div>
                <div className="max-h-[260px] min-h-[180px] space-y-3 overflow-y-auto border border-line bg-bg px-3 py-3">
                  {chatEntries.length ? (
                    chatEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[92%] border px-3 py-2 text-sm leading-5 ${
                            entry.role === "user"
                              ? "border-accent/30 bg-panel text-ink"
                              : entry.status === "error"
                                ? "border-coral/40 bg-bg2 text-accent2"
                                : "border-line bg-bg2 text-mid"
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                            <span>{entry.role === "user" ? t.chatYou : t.chatAssistant}</span>
                            <span>#{entry.turn}</span>
                            {entry.referencedRender ? <span>{t.referenceBadge}</span> : null}
                          </div>
                          <div className="whitespace-pre-wrap break-words">{entry.content}</div>
                          {entry.requestId ? (
                            <div className="mt-1 font-mono text-[10px] text-faint">{entry.requestId}</div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex h-full min-h-[150px] items-center justify-center text-center font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
                      {t.chatEmpty}
                    </div>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{t.promptLabel}</span>
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setOptimizedPromptReady(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void handleGenerate();
                    }
                  }}
                  placeholder={conversationTurnCount ? t.chatFollowupPlaceholder : t.promptPlaceholder}
                  rows={4}
                  disabled={conversationTurnCount >= MAX_CONVERSATION_TURNS}
                  className="w-full resize-none border border-line bg-bg px-3 py-2.5 text-sm leading-6 text-ink transition placeholder:text-faint hover:border-accent/40 disabled:bg-bg2 disabled:text-faint"
                />
                {optimizedPromptReady ? (
                  <div className="mt-2 border border-accent/30 bg-bg2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-accent2">
                    {t.optimizedPromptReady}
                  </div>
                ) : null}
              </label>

              <label className="flex items-start gap-3 border border-line bg-bg2 px-3 py-2.5 text-sm leading-5 text-mid">
                <input
                  type="checkbox"
                  checked={shouldReferenceCurrentRender}
                  disabled={!canReferenceCurrentRender || conversationTurnCount >= MAX_CONVERSATION_TURNS}
                  onChange={(event) => setReferenceCurrentRender(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block font-semibold text-ink">{t.referenceCurrentRender}</span>
                  <span className="block text-xs leading-5 text-faint">
                    {canReferenceCurrentRender ? t.referenceCurrentRenderHint : t.referenceCurrentRenderDisabled}
                  </span>
                </span>
              </label>

              <div>
                <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{t.pptLabel}</div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleFile(event.dataTransfer.files[0]);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  className="flex min-h-20 w-full items-center justify-center border border-dashed border-line bg-bg2 px-3 py-4 text-sm text-mid transition hover:border-accent/50 hover:bg-bg"
                >
                  <span className="truncate">
                    {isUploading
                      ? t.uploading
                      : attachment
                        ? `${t.pptReady}: ${attachment.originalName}`
                        : t.pptIdle}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_CONTEXT_EXTENSIONS.join(",")}
                  className="hidden"
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />
                {uploadError ? <p className="mt-2 text-sm text-coral">{uploadError}</p> : null}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <button
                  type="button"
                  onClick={handleOptimizePrompt}
                  disabled={isGenerating || isUploading || isOptimizingPrompt || conversationTurnCount >= MAX_CONVERSATION_TURNS}
                  className="flex h-11 items-center justify-center gap-2 border border-line bg-panel px-4 text-sm font-semibold text-ink transition hover:border-accent/40 hover:bg-bg2 disabled:opacity-40"
                >
                  <MessageSquarePlus size={16} />
                  <span className="truncate">{isOptimizingPrompt ? t.optimizingPrompt : t.optimizePrompt}</span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating || isUploading || isOptimizingPrompt || conversationTurnCount >= MAX_CONVERSATION_TURNS}
                  className="group relative flex h-11 items-center justify-center gap-2 overflow-hidden bg-ink px-4 text-sm font-semibold text-white transition disabled:bg-faint"
                >
                  <span className="absolute inset-y-0 left-0 w-0 bg-accent transition-all duration-300 group-hover:w-full" />
                  <Send className="relative" size={16} />
                  <span className="relative">{isGenerating ? t.generating : t.submitPrompt}</span>
                </button>
              </div>

              {thinkingStatus ? (
                <div className="animate-pulse border border-line bg-bg2 px-3 py-2.5 text-sm leading-5 text-mid">
                  {thinkingStatus}
                </div>
              ) : null}

              {error ? (
                <div className="border border-coral/40 bg-bg2 px-3 py-2.5 text-sm text-accent2">
                  <div className="font-semibold">{t.errorTitle}</div>
                  <div className="mt-1 leading-5">{error}</div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex min-h-[520px] flex-col overflow-hidden border border-line bg-panel lg:min-h-[680px]">
            <div className="flex flex-col gap-3 border-b border-line bg-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid grid-cols-2 border border-line bg-bg2 p-1 sm:flex">
                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className={`flex h-8 items-center justify-center px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition ${
                    activeTab === "preview" ? "bg-panel text-ink" : "text-mid hover:text-accent2"
                  }`}
                >
                  {t.preview}
                </button>
                <button
                  type="button"
                  onClick={openJsonEditor}
                  className={`flex h-8 items-center justify-center px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition ${
                    activeTab === "json" ? "bg-panel text-ink" : "text-mid hover:text-accent2"
                  }`}
                >
                  {t.json}
                </button>
              </div>

              <div className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-2 sm:flex">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!history.length}
                  title={t.undo}
                  className="flex h-9 w-9 items-center justify-center border border-line bg-panel text-mid transition hover:border-accent/40 hover:text-accent2 disabled:opacity-40"
                >
                  <Undo2 size={17} />
                </button>
                <button
                  type="button"
                  onClick={downloadSvg}
                  disabled={!figure}
                  className="flex h-9 min-w-0 items-center justify-center border border-line bg-panel px-3 text-sm font-semibold text-ink transition hover:border-accent/40 hover:bg-bg2 disabled:opacity-40"
                >
                  <span className="truncate">{t.downloadSvg}</span>
                </button>
              </div>
            </div>

            <div className="grid flex-1 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-h-[300px] items-center justify-center bg-bg2 p-2 sm:min-h-[430px] sm:p-4 lg:min-h-[560px] lg:p-6">
                {isGenerating ? (
                  <div className="flex min-h-[220px] w-full max-w-[1080px] flex-col items-center justify-center gap-3 border border-line bg-panel/95 text-center">
                    <Loader2 size={30} className="animate-spin text-cobalt" />
                    <div className="animate-pulse text-sm font-semibold text-ink">{thinkingStatus || t.generating}</div>
                  </div>
                ) : figure ? (
                  activeTab === "preview" ? (
                    <div className="aspect-video w-full max-w-[1080px] overflow-hidden border border-line bg-panel">
                      <FigureSvg
                        figure={figure}
                        selectedIds={selectedIds}
                        onSelect={handleSelectId}
                        onSelectIds={handleSelectIds}
                      />
                    </div>
                  ) : (
                    <div className="flex h-full max-h-[420px] w-full max-w-[1080px] flex-col gap-2 sm:max-h-[560px] lg:max-h-[650px]">
                      <textarea
                        value={jsonDraft}
                        onChange={(event) => {
                          setJsonDraft(event.target.value);
                          setJsonError("");
                        }}
                        spellCheck={false}
                        className="min-h-[300px] flex-1 resize-none border border-line bg-panel p-3 font-mono text-xs leading-5 text-ink outline-none transition placeholder:text-faint focus:border-accent/50 sm:min-h-[430px] sm:p-4 lg:min-h-[560px]"
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-h-5 whitespace-pre-wrap text-xs leading-5 text-coral">{jsonError}</div>
                        <button
                          type="button"
                          onClick={applyJsonDraft}
                          className="group relative flex h-9 shrink-0 items-center justify-center gap-2 overflow-hidden bg-ink px-4 text-sm font-semibold text-white transition"
                        >
                          <span className="absolute inset-y-0 left-0 w-0 bg-accent transition-all duration-300 group-hover:w-full" />
                          <Check className="relative" size={16} />
                          <span className="relative">{t.jsonApply}</span>
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex max-w-[260px] flex-col items-center px-3 text-center sm:max-w-sm">
                    <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{t.emptyState}</div>
                  </div>
                )}
              </div>

              <aside className="border-t border-line bg-panel p-4 xl:border-l xl:border-t-0">
                {fit ? (
                  <div className="mb-5 border-b border-line pb-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold tracking-[0.04em] text-ink">{t.fit}</span>
                      <span className="font-mono text-[12px] font-medium text-accent2">{Math.round(fit.score * 100)}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden bg-bg3">
                      <div className="h-full bg-accent2" style={{ width: `${Math.round(fit.score * 100)}%` }} />
                    </div>
                    {fit.note ? <p className="mt-2 text-sm leading-5 text-mid">{fit.note}</p> : null}
                  </div>
                ) : null}

                <ElementPanel
                  element={selectedElement}
                  elements={selectedElements}
                  selectedCount={selectedIds.length}
                  labels={t}
                  onPatch={patchSelected}
                />

                <RenderHistory labels={t} logs={renderHistory} onView={viewHistory} />

                <div className="mt-5 border-t border-line pt-4 font-mono text-[10px] leading-5 text-faint">{t.pptxDisabled}</div>
              </aside>
            </div>
          </section>
        </div>

        <UsageGuide labels={t} />
      </div>
      </main>
    </>
  );
}

function UsageGuide({ labels }: { labels: typeof dictionaries.en }) {
  const pptSteps = [labels.pptStep1, labels.pptStep2, labels.pptStep3, labels.pptStep4, labels.pptStep5];
  const svgReasons = [labels.svgReason1, labels.svgReason2, labels.svgReason3, labels.svgReason4];

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div>
          <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">02 / GUIDE</div>
          <h2 className="mt-1 text-base font-semibold tracking-[0.04em] text-ink">{labels.usageHeading}</h2>
        </div>
        <p className="max-w-xl text-sm leading-5 text-mid">{labels.usageSubtitle}</p>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="border-b border-line p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            {labels.pptWorkflowTitle}
          </h3>
          <ol className="mt-4 space-y-3">
            {pptSteps.map((step, index) => (
              <li key={step} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 text-sm leading-6 text-mid">
                <span className="flex h-7 w-7 items-center justify-center border border-line bg-bg2 font-mono text-[11px] text-accent2">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="p-4 sm:p-5">
          <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            {labels.svgReasonTitle}
          </h3>
          <ul className="mt-4 space-y-3">
            {svgReasons.map((reason) => (
              <li key={reason} className="flex gap-3 text-sm leading-6 text-mid">
                <CheckCircle2 className="mt-1 shrink-0 text-mint" size={16} />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function isJsonSyntaxError(message: string): boolean {
  return (
    /Expected .+ in JSON at position \d+/i.test(message) ||
    /Unexpected .+ in JSON at position \d+/i.test(message) ||
    message.includes("Model returned invalid JSON") ||
    message.includes("Repair response was invalid JSON")
  );
}

function RenderHistory({
  labels,
  logs,
  onView
}: {
  labels: typeof dictionaries.en;
  logs: RenderHistoryEntry[];
  onView: (entry: RenderHistoryEntry) => void;
}) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Database size={15} className="text-accent2" />
        <h2 className="text-sm font-semibold tracking-[0.04em] text-ink">{labels.historyTitle}</h2>
      </div>

      {logs.length ? (
        <div className="space-y-3">
          {logs.map((log) => (
            <button
              key={log.id}
              type="button"
              onClick={() => onView(log)}
              className="block w-full border border-line bg-bg2 p-2 text-left text-xs leading-5 text-mid transition hover:border-accent/40 hover:bg-bg"
            >
              <div className="aspect-video overflow-hidden border border-line bg-panel">
                <FigureSvg figure={log.figure} svgId={`history-${log.id}`} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mt-2 truncate font-semibold text-ink">{log.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                    #{log.turn} / {log.requestId}
                  </div>
                </div>
                <div className="font-mono text-[10px] text-accent2">{Math.round(log.fitScore * 100)}%</div>
              </div>
              <div className="mt-2 font-mono text-[10px] text-faint">
                {log.referencedRender ? labels.historyReferencedRender : labels.historyNewRender}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-5 text-mid">{labels.historyEmpty}</p>
      )}
    </div>
  );
}

function ElementPanel({
  element,
  elements,
  selectedCount,
  labels,
  onPatch
}: {
  element?: FigureElement;
  elements: FigureElement[];
  selectedCount: number;
  labels: typeof dictionaries.en;
  onPatch: (updater: (element: FigureElement) => FigureElement) => void;
}) {
  if (!selectedCount) {
    return (
      <div>
        <h2 className="text-sm font-semibold tracking-[0.04em] text-ink">{labels.selectedElement}</h2>
        <p className="mt-2 text-sm leading-5 text-mid">{labels.noSelection}</p>
      </div>
    );
  }

  const fillElement = elements.find((item) => "fill" in item);
  const strokeElement = elements.find((item) => "stroke" in item);
  const canEditText = selectedCount === 1 && element?.type === "text";

  return (
    <div>
      <h2 className="text-sm font-semibold tracking-[0.04em] text-ink">
        {selectedCount > 1 ? `${labels.selectedElements}: ${selectedCount}` : labels.selectedElement}
      </h2>
      {selectedCount > 1 ? <p className="mt-2 text-sm leading-5 text-mid">{labels.multiSelectHint}</p> : null}
      <div className="mt-3 space-y-4">
        {canEditText ? (
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{labels.text}</span>
            <input
              value={element.text}
              onChange={(event) =>
                onPatch((current) => (current.type === "text" ? { ...current, text: event.target.value } : current))
              }
              className="h-10 w-full border border-line bg-bg px-3 text-sm text-ink transition hover:border-accent/40"
            />
          </label>
        ) : null}

        {fillElement && "fill" in fillElement ? (
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{labels.fill}</span>
            <input
              type="color"
              value={fillElement.fill === "none" ? "#ffffff" : fillElement.fill}
              onChange={(event) =>
                onPatch((current) => ("fill" in current ? { ...current, fill: event.target.value } : current))
              }
              className="h-10 w-full border border-line bg-bg p-1"
            />
          </label>
        ) : null}

        {strokeElement && "stroke" in strokeElement ? (
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{labels.stroke}</span>
            <input
              type="color"
              value={strokeElement.stroke}
              onChange={(event) =>
                onPatch((current) => ("stroke" in current ? { ...current, stroke: event.target.value } : current))
              }
              className="h-10 w-full border border-line bg-bg p-1"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}
