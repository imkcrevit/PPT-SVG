"use client";

import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  FileDown,
  Loader2,
  MessageSquarePlus,
  PanelRightClose,
  Send,
  SlidersHorizontal,
  Undo2
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { FigureSvg } from "@/components/figure-svg";
import ThemeOverridePanel from "@/components/ThemeOverridePanel";
import { appUrl } from "@/lib/app-url";
import { ACCEPTED_CONTEXT_EXTENSIONS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_NAME_CHARS } from "@/lib/file-limits";
import { cloneFigure, findElement, findElements, updateElement } from "@/lib/figure-utils";
import { validateAndNormalizeFigureResponse } from "@/lib/figure-validation";
import { dictionaries } from "@/lib/i18n";
import { INTERNAL_SKILLS } from "@/lib/skills";
import type { ThemeOverride } from "@/lib/theme";
import type { Figure, FigureElement, FitAssessment, Locale, SkillId, UploadedAttachment } from "@/lib/types";

interface WorkspaceProps {
  locale: Locale;
}

interface GenerateApiResponse {
  figure: Figure;
  fit: FitAssessment;
  layoutReview?: {
    ok?: boolean;
    score?: number;
    summary?: string;
    issues?: Array<{
      severity?: string;
      message?: string;
    }>;
    unavailable?: boolean;
  };
  requestId?: string;
  sessionId?: string;
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

type GenerateAgentEvent =
  | {
      type: "status";
      code?: string;
      message?: string;
      pass?: number;
      maxPasses?: number;
      issues?: string[];
    }
  | {
      type: "final";
      payload: GenerateApiResponse;
    }
  | {
      type: "error";
      error?: string;
      details?: string[];
    };

interface AttachmentApiResponse {
  attachment?: UploadedAttachment;
  error?: string;
}

interface OptimizeApiResponse {
  optimizedDescription?: string;
  error?: string;
}

const HELP_URL = "https://blog.graptolite.ai/help/ppt-svg/";
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
  userDescription: string;
  fitScore: number;
  referencedRender: boolean;
  figure: Figure;
  fit: FitAssessment;
}

interface ClarificationChoice {
  id: string;
  label: string;
  instruction: string;
}

interface ClarificationRequest {
  originalDescription: string;
  choices: ClarificationChoice[];
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
  const [themeOverride, setThemeOverride] = useState<ThemeOverride | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [figure, setFigure] = useState<Figure | null>(null);
  const [currentRenderTurn, setCurrentRenderTurn] = useState(0);
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
  const [isDownloadingPptx, setIsDownloadingPptx] = useState(false);
  const [clarificationRequest, setClarificationRequest] = useState<ClarificationRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(crypto.randomUUID());
  const thinkingStatus = generationStatus ? `${generationStatus} ${generationSeconds}s` : "";
  const conversationTurnCount = chatEntries.filter((entry) => entry.role === "user").length;
  const remainingTurns = Math.max(0, MAX_CONVERSATION_TURNS - conversationTurnCount);
  const canReferenceCurrentRender = Boolean(figure);
  const shouldReferenceCurrentRender = referenceCurrentRender && canReferenceCurrentRender;
  const isEditDeckOpen = Boolean(figure && selectedIds.length);

  const selectedElement = useMemo(
    () => (figure && selectedId ? findElement(figure.elements, selectedId) : undefined),
    [figure, selectedId]
  );
  const selectedElements = useMemo(
    () => (figure ? findElements(figure.elements, selectedIds) : []),
    [figure, selectedIds]
  );
  const sessionInputEntries = useMemo(
    () => chatEntries.filter((entry) => entry.role === "user").slice(-MAX_CONVERSATION_TURNS),
    [chatEntries]
  );
  const jsonPayload = useMemo(() => (figure ? JSON.stringify({ figure, fit }, null, 2) : ""), [figure, fit]);

  useEffect(() => {
    if (generationStartedAt === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setGenerationSeconds(Math.max(0, Math.floor((window.performance.now() - generationStartedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [generationStartedAt]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [chatEntries, generationStatus]);

  async function handleGenerate(startedAtMs: number) {
    const userMessage = description.trim();

    if (!userMessage) {
      setError(t.emptyPrompt);
      return;
    }

    if (conversationTurnCount >= MAX_CONVERSATION_TURNS) {
      setError(t.turnLimitReached);
      return;
    }

    if (shouldAskForIntentClarification(userMessage, skillId, Boolean(attachment), shouldReferenceCurrentRender)) {
      setError("");
      setClarificationRequest({
        originalDescription: userMessage,
        choices: buildClarificationChoices(t)
      });
      return;
    }

    await handleSubmitGeneration(userMessage, startedAtMs);
  }

  async function handleSubmitGeneration(userMessage: string, startedAtMs: number) {
    const turn = conversationTurnCount + 1;
    const userMessageId = crypto.randomUUID();
    const pendingMessageId = crypto.randomUUID();
    const referencedRender = shouldReferenceCurrentRender;

    setClarificationRequest(null);
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
    setGenerationStartedAt(startedAtMs);
    setGenerationSeconds(0);
    setSelectedId("");
    setSelectedIds([]);

    try {
      const generateUrl = appUrl("/api/generate-agent");
      const response = await fetch(generateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          skillId,
          userDescription: userMessage,
          language: locale,
          sessionId: sessionIdRef.current,
          conversationId: sessionIdRef.current,
          conversationTurn: turn,
          referenceFigure: referencedRender && figure ? { source: "current-render", figure, fit } : undefined,
          themeOverride: themeOverride ?? undefined,
          clientLog: {
            messageId: userMessageId,
            sentAt: new Date().toISOString()
          },
          attachments: attachment ? [attachment] : []
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as GenerateApiResponse;
        const message = [payload.error, ...(payload.details ?? [])].filter(Boolean).join(" ");
        throw new Error(isJsonSyntaxError(message) ? t.malformedModelJson : message);
      }

      const payload = await readGenerateAgentStream(response, (event) => {
        if (event.type !== "status" || !event.message) {
          return;
        }

        const shouldShowIssues = event.code === "adjusting" || event.code === "review_stopped";
        const message =
          shouldShowIssues && event.issues?.length
            ? `${event.message} ${event.issues.slice(0, 2).join(" ")}`
            : event.message;
        setGenerationStatus(message);
        setChatEntries((entries) =>
          entries.map((entry) =>
            entry.id === pendingMessageId
              ? {
                  ...entry,
                  content: message
                }
              : entry
          )
        );
      });

      setGenerationStatus(t.generateRendering);
      setFigure(payload.figure);
      setCurrentRenderTurn(turn);
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
                content: [
                  `${t.chatRendered}: ${payload.figure.metadata.title}`,
                  payload.layoutReview?.summary && !payload.layoutReview.unavailable ? payload.layoutReview.summary : ""
                ]
                  .filter(Boolean)
                  .join(" "),
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
          userDescription: userMessage,
          fitScore: payload.fit.score,
          referencedRender,
          figure: cloneFigure(payload.figure),
          fit: payload.fit
        },
        ...logs
      ]);
    } catch (generationError) {
      const rawMessage = generationError instanceof Error ? generationError.message : t.errorTitle;
      const message = isNetworkLoadError(rawMessage) ? t.generateNetworkFailed : rawMessage;
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

  async function handleClarificationChoice(choice: ClarificationChoice, startedAtMs: number) {
    if (!clarificationRequest) {
      return;
    }

    const clarifiedMessage = `${clarificationRequest.originalDescription}\n\n${t.clarificationChoicePrefix}: ${choice.instruction}`;
    setDescription("");
    await handleSubmitGeneration(clarifiedMessage, startedAtMs);
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
          sessionId: sessionIdRef.current,
          conversationId: sessionIdRef.current,
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
      setClarificationRequest(null);
    } catch (optimizeError) {
      setError(optimizeError instanceof Error ? optimizeError.message : t.optimizeFailed);
    } finally {
      setIsOptimizingPrompt(false);
    }
  }

  function startNewConversation() {
    sessionIdRef.current = crypto.randomUUID();
    setDescription("");
    setClarificationRequest(null);
    setChatEntries([]);
    setRenderHistory([]);
    setFigure(null);
    setCurrentRenderTurn(0);
    setFit(null);
    setSelectedId("");
    setSelectedIds([]);
    setJsonDraft("");
    setJsonError("");
    setHistory([]);
    setError("");
    setAttachment(null);
    setThemeOverride(null);
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

    if (file.name.length > MAX_ATTACHMENT_NAME_CHARS) {
      setUploadError(t.fileNameTooLong);
      setAttachment(null);
      return;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadError(t.fileTooLarge.replace("{size}", formatFileSize(MAX_ATTACHMENT_BYTES)));
      setAttachment(null);
      return;
    }

    setIsUploading(true);
    setAttachment(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sessionId", sessionIdRef.current);
      formData.append("conversationId", sessionIdRef.current);

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

  function clearSelection() {
    setSelectedId("");
    setSelectedIds([]);
  }

  function viewHistory(entry: RenderHistoryEntry) {
    if (figure) {
      pushHistory(figure);
    }

    setFigure(cloneFigure(entry.figure));
    setCurrentRenderTurn(entry.turn);
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

  async function downloadPptx() {
    if (!figure || isDownloadingPptx) {
      return;
    }

    setError("");
    setIsDownloadingPptx(true);

    try {
      const response = await fetch(appUrl("/api/export/pptx"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ figure, fit })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string[] };
        const message = [payload.error, ...(payload.details ?? [])].filter(Boolean).join(" ");
        throw new Error(message || t.pptxExportFailed);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `session-${currentRenderTurn || conversationTurnCount || 1}.pptx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : t.pptxExportFailed);
    } finally {
      setIsDownloadingPptx(false);
    }
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

      <main className="workspace-main text-ink">
      <div className="workspace-shell">
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
              href={HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center justify-center gap-2 border border-line bg-panel px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition hover:border-accent/40 hover:text-accent2"
              aria-label={t.openHelp}
            >
              <BookOpen size={15} />
              <span>{t.helpLabel}</span>
            </a>
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

        <div className={`workspace-grid ${isEditDeckOpen ? "is-editing" : ""}`}>
          <section className={`workspace-chat-panel border border-line bg-panel ${isEditDeckOpen ? "is-compact" : ""}`}>
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

            <div className="chat-workspace-body">
              <div className="chat-toolbar">
                <div className="chat-toolbar-count">
                  <span>{t.conversationCount}: {conversationTurnCount}/{MAX_CONVERSATION_TURNS}</span>
                  <strong>{remainingTurns} {t.turnsLeft}</strong>
                </div>

                <label className="chat-toolbar-field">
                  <span>{t.skillLabel}</span>
                  <select value={skillId} onChange={(event) => setSkillId(event.target.value as SkillId)}>
                    {INTERNAL_SKILLS.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name[locale]}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleFile(event.dataTransfer.files[0]);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  className="chat-toolbar-button"
                >
                  <span>
                    {isUploading
                      ? t.uploading
                      : attachment
                        ? `${t.pptReady}: ${attachment.originalName}`
                        : t.pptLabel}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_CONTEXT_EXTENSIONS.join(",")}
                  className="hidden"
                  onChange={(event) => void handleFile(event.target.files?.[0])}
                />

                <label className="chat-toolbar-check">
                  <input
                    type="checkbox"
                    checked={shouldReferenceCurrentRender}
                    disabled={!canReferenceCurrentRender || conversationTurnCount >= MAX_CONVERSATION_TURNS}
                    onChange={(event) => setReferenceCurrentRender(event.target.checked)}
                  />
                  <span>{t.referenceBadge}</span>
                </label>

                <div className="chat-model-pill">
                  <span>{model || t.modelFromEnv}</span>
                  {model ? <CheckCircle2 className="shrink-0 text-mint" size={14} /> : null}
                </div>
              </div>
              {uploadError ? <p className="chat-inline-error">{uploadError}</p> : null}

              <ThemeOverridePanel key={themeOverride ? "theme-custom" : "theme-auto"} value={themeOverride} onChange={setThemeOverride} />

              <div className="workspace-chat-history flex flex-col">
                <div ref={chatScrollRef} className="workspace-chat-scroll chat-thread">
                  {chatEntries.length ? (
                    chatEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`chat-message ${entry.role === "user" ? "is-user" : "is-assistant"} ${
                          entry.status === "error" ? "is-error" : ""
                        }`}
                      >
                        <div className="chat-bubble">
                          <div className="chat-meta">
                            <span>{entry.role === "user" ? t.chatYou : t.chatAssistant}</span>
                            <span>#{entry.turn}</span>
                            {entry.referencedRender ? <span>{t.referenceBadge}</span> : null}
                          </div>
                          <div className="chat-content">{entry.content}</div>
                          {entry.requestId ? (
                            <div className="chat-request-id">{entry.requestId}</div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="chat-empty-state">
                      {t.chatEmpty}
                    </div>
                  )}
                </div>
              </div>

              <label className="chat-composer">
                <span className="chat-composer-label">{t.promptLabel}</span>
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setOptimizedPromptReady(false);
                    setClarificationRequest(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void handleGenerate(event.timeStamp);
                    }
                  }}
                  placeholder={conversationTurnCount ? t.chatFollowupPlaceholder : t.promptPlaceholder}
                  rows={2}
                  disabled={conversationTurnCount >= MAX_CONVERSATION_TURNS}
                  className="chat-composer-input"
                />
                {clarificationRequest ? (
                  <div className="mt-2 border border-line bg-bg2 p-2">
                    <div className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-accent">
                      {t.clarificationTitle}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-mid">{t.clarificationHint}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {clarificationRequest.choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={(event) => void handleClarificationChoice(choice, event.timeStamp)}
                          disabled={isGenerating || isUploading || isOptimizingPrompt}
                          className="border border-line bg-panel px-3 py-2 text-left text-xs font-semibold text-ink transition hover:border-accent/40 hover:bg-bg disabled:opacity-40"
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {optimizedPromptReady ? (
                  <div className="chat-composer-note">
                    {t.optimizedPromptReady}
                  </div>
                ) : null}
              </label>

              <div className="chat-actions">
                <button
                  type="button"
                  onClick={handleOptimizePrompt}
                  disabled={isGenerating || isUploading || isOptimizingPrompt || conversationTurnCount >= MAX_CONVERSATION_TURNS}
                  className="chat-secondary-action"
                >
                  <MessageSquarePlus size={16} />
                  <span className="truncate">{isOptimizingPrompt ? t.optimizingPrompt : t.optimizePrompt}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => void handleGenerate(event.timeStamp)}
                  disabled={isGenerating || isUploading || isOptimizingPrompt || conversationTurnCount >= MAX_CONVERSATION_TURNS}
                  className="chat-primary-action"
                >
                  <Send className="relative" size={16} />
                  <span className="relative">{isGenerating ? t.generating : t.submitPrompt}</span>
                </button>
              </div>

              {thinkingStatus ? (
                <div className="chat-status">
                  {thinkingStatus}
                </div>
              ) : null}

              {error ? (
                <div className="chat-error">
                  <div className="font-semibold">{t.errorTitle}</div>
                  <div className="mt-1 leading-5">{error}</div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="workspace-preview-panel flex flex-col overflow-hidden border border-line bg-panel">
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

              <div className="flex flex-wrap items-center justify-end gap-2">
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
                  title={t.downloadSvgTitle}
                  className="flex h-9 min-w-0 items-center justify-center gap-2 border border-line bg-panel px-3 text-sm font-semibold text-ink transition hover:border-accent/40 hover:bg-bg2 disabled:opacity-40"
                >
                  <Download size={16} />
                  <span className="truncate">{t.downloadSvg}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void downloadPptx()}
                  disabled={!figure || isDownloadingPptx}
                  title={t.downloadPptxTitle}
                  className="flex h-9 min-w-0 items-center justify-center gap-2 border border-line bg-ink px-3 text-sm font-semibold text-white transition hover:bg-accent disabled:opacity-40"
                >
                  {isDownloadingPptx ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                  <span className="truncate">{isDownloadingPptx ? t.downloadingPptx : t.downloadPptx}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-1">
              <div className="workspace-preview-stage flex w-full flex-1 items-center justify-center bg-bg2 p-2 sm:p-4 lg:p-6">
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
            </div>
          </section>

          {figure || renderHistory.length ? (
            <aside className={`workspace-deck-panel border border-line bg-panel ${isEditDeckOpen ? "is-active" : ""}`}>
              <div className="deck-panel-heading">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
                    03 / {t.deckTitle}
                  </div>
                  <h2 className="mt-1 truncate text-sm font-semibold tracking-[0.04em] text-ink">
                    {isEditDeckOpen ? t.elementEdit : t.editDeckHint}
                  </h2>
                </div>
                {isEditDeckOpen ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    title={t.closeEdit}
                    className="deck-icon-button"
                  >
                    <PanelRightClose size={16} />
                  </button>
                ) : null}
              </div>

              <div className="deck-block-stack">
                <DeckBlock
                  key={isEditDeckOpen ? "edit-active" : "edit-idle"}
                  title={t.elementEdit}
                  kicker="Edit"
                  badge={selectedIds.length ? String(selectedIds.length) : undefined}
                  defaultOpen={isEditDeckOpen}
                >
                  <ElementPanel
                    element={selectedElement}
                    elements={selectedElements}
                    selectedCount={selectedIds.length}
                    labels={t}
                    onPatch={patchSelected}
                  />
                </DeckBlock>

                <DeckBlock title={t.fitDeck} kicker="Fit" defaultOpen={!isEditDeckOpen && Boolean(fit)}>
                  <FitDeck fit={fit} labels={t} />
                </DeckBlock>

                <DeckBlock
                  title={t.sessionInputsTitle}
                  kicker="Input"
                  badge={sessionInputEntries.length ? String(sessionInputEntries.length) : undefined}
                  defaultOpen={!isEditDeckOpen && sessionInputEntries.length > 0}
                >
                  <SessionInputs labels={t} entries={sessionInputEntries} />
                </DeckBlock>

                <DeckBlock
                  title={t.historyTitle}
                  kicker="Deck"
                  badge={renderHistory.length ? String(renderHistory.length) : undefined}
                  defaultOpen={!isEditDeckOpen && renderHistory.length > 0}
                >
                  <RenderHistory labels={t} logs={renderHistory} onView={viewHistory} />
                </DeckBlock>

                <DeckBlock title={t.helpLabel} kicker="Help" defaultOpen={false}>
                  <a
                    href={HELP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-10 items-center justify-between gap-2 border border-line bg-panel px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition hover:border-accent/40 hover:bg-bg2 hover:text-accent2"
                    aria-label={t.openHelp}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <BookOpen size={15} />
                      <span className="truncate">{t.helpLabel}</span>
                    </span>
                    <ExternalLink size={13} />
                  </a>
                </DeckBlock>
              </div>
            </aside>
          ) : null}

        </div>
      </div>
      </main>
    </>
  );
}

function isNetworkLoadError(message: string): boolean {
  return /^(load failed|failed to fetch|networkerror when attempting to fetch resource)$/i.test(message.trim());
}

function shouldAskForIntentClarification(
  userDescription: string,
  skillId: SkillId,
  hasAttachment: boolean,
  referencesCurrentRender: boolean
): boolean {
  if (skillId !== "freeform" || hasAttachment || referencesCurrentRender) {
    return false;
  }

  const normalized = userDescription.trim();
  if (!normalized) {
    return false;
  }

  const hasPurposeCue =
    /(-+>|=>|→|流程|步骤|阶段|时间线|矩阵|架构|对比|比较|分类|优先级|路线图|金字塔|漏斗|循环|图|diagram|flow|workflow|process|timeline|matrix|architecture|compare|comparison|roadmap|pyramid|funnel|cycle|vs\.?|[,，、;；:：\n]|\d)/i.test(
      normalized
    );
  if (hasPurposeCue) {
    return false;
  }

  const latinTokens = normalized.match(/[a-zA-Z0-9]+/g) ?? [];
  const cjkChars = normalized.match(/[\u4e00-\u9fff]/g) ?? [];
  return latinTokens.length <= 3 && cjkChars.length <= 8;
}

function buildClarificationChoices(labels: typeof dictionaries.en): ClarificationChoice[] {
  return [
    {
      id: "flow",
      label: labels.clarificationFlow,
      instruction: labels.clarificationFlowInstruction
    },
    {
      id: "timeline",
      label: labels.clarificationTimeline,
      instruction: labels.clarificationTimelineInstruction
    },
    {
      id: "comparison",
      label: labels.clarificationComparison,
      instruction: labels.clarificationComparisonInstruction
    },
    {
      id: "architecture",
      label: labels.clarificationArchitecture,
      instruction: labels.clarificationArchitectureInstruction
    }
  ];
}

function formatFileSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

async function readGenerateAgentStream(
  response: Response,
  onEvent: (event: GenerateAgentEvent) => void
): Promise<GenerateApiResponse> {
  if (!response.body) {
    throw new Error("Generation agent did not return a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: GenerateApiResponse | undefined;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line) as GenerateAgentEvent;
      onEvent(event);

      if (event.type === "error") {
        const message = [event.error, ...(event.details ?? [])].filter(Boolean).join(" ");
        throw new Error(message || "Generation agent failed.");
      }

      if (event.type === "final") {
        finalPayload = event.payload;
      }
    }

    if (done) {
      break;
    }
  }

  if (!finalPayload) {
    throw new Error("Generation agent finished without a final figure.");
  }

  return finalPayload;
}

function isJsonSyntaxError(message: string): boolean {
  return (
    /Expected .+ in JSON at position \d+/i.test(message) ||
    /Unexpected .+ in JSON at position \d+/i.test(message) ||
    message.includes("Model returned invalid JSON") ||
    message.includes("Repair response was invalid JSON")
  );
}

function DeckBlock({
  title,
  kicker,
  badge,
  defaultOpen,
  children
}: {
  title: string;
  kicker: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <section className="deck-block">
      <button type="button" className="deck-block-header" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <SlidersHorizontal size={14} className="deck-block-mark" />
        <span className="deck-block-title">
          <span>{kicker}</span>
          <strong>{title}</strong>
        </span>
        {badge ? <span className="deck-block-badge">{badge}</span> : null}
        <ChevronDown size={15} className={`deck-block-chevron ${open ? "is-open" : ""}`} />
      </button>
      {open ? <div className="deck-block-body">{children}</div> : null}
    </section>
  );
}

function FitDeck({ fit, labels }: { fit: FitAssessment | null; labels: typeof dictionaries.en }) {
  if (!fit) {
    return <p className="text-sm leading-5 text-mid">{labels.emptyState}</p>;
  }

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold tracking-[0.04em] text-ink">{labels.fit}</span>
        <span className="font-mono text-[12px] font-medium text-accent2">{Math.round(fit.score * 100)}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden bg-bg3">
        <div className="h-full bg-accent2" style={{ width: `${Math.round(fit.score * 100)}%` }} />
      </div>
      {fit.note ? <p className="mt-2 text-sm leading-5 text-mid">{fit.note}</p> : null}
    </div>
  );
}

function SessionInputs({ labels, entries }: { labels: typeof dictionaries.en; entries: ChatEntry[] }) {
  if (!entries.length) {
    return <p className="text-sm leading-5 text-mid">{labels.sessionInputsEmpty}</p>;
  }

  return (
    <div className="grid gap-2">
      {entries.map((entry) => (
        <div key={entry.id} className="border border-line bg-panel p-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            {labels.sessionInputTurn} #{entry.turn}
          </div>
          <p className="mt-1 line-clamp-3 text-sm leading-5 text-mid" title={entry.content}>
            {entry.content}
          </p>
        </div>
      ))}
    </div>
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
    <div>
      {logs.length ? (
        <div className="history-deck-list">
          {logs.map((log) => (
            <button
              key={log.id}
              type="button"
              onClick={() => onView(log)}
              className="history-deck-item"
            >
              <div className="aspect-video overflow-hidden border border-line bg-panel">
                <FigureSvg figure={log.figure} svgId={`history-${log.id}`} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mt-2 truncate font-semibold text-ink">{log.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                    <Database size={12} className="mr-1 inline text-accent2" />
                    #{log.turn} / {log.requestId}
                  </div>
                </div>
                <div className="font-mono text-[10px] text-accent2">{Math.round(log.fitScore * 100)}%</div>
              </div>
              <div className="mt-2 border-l-2 border-accent/40 pl-2 text-left">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{labels.historyInputLabel}</div>
                <p className="line-clamp-2 text-xs leading-5 text-mid" title={log.userDescription}>
                  {log.userDescription}
                </p>
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
    return <p className="text-sm leading-5 text-mid">{labels.noSelection}</p>;
  }

  const fillElement = elements.find((item) => "fill" in item);
  const strokeElement = elements.find((item) => "stroke" in item);
  const canEditText = selectedCount === 1 && element?.type === "text";
  const elementName = selectedCount > 1 ? `${labels.selectedElements}: ${selectedCount}` : (element?.name || element?.id || labels.selectedElement);

  return (
    <div>
      <div className="element-edit-meta">
        <span>{elementName}</span>
        {selectedCount === 1 && element ? <strong>{element.type}</strong> : null}
      </div>
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
