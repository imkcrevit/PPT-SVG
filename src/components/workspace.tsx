"use client";

import { CheckCircle2, Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { FigureSvg } from "@/components/figure-svg";
import { appUrl } from "@/lib/app-url";
import { cloneFigure, findElement, updateElement } from "@/lib/figure-utils";
import { dictionaries } from "@/lib/i18n";
import { INTERNAL_SKILLS } from "@/lib/skills";
import type { Figure, FigureElement, FitAssessment, Locale, SkillId, UploadedAttachment } from "@/lib/types";

interface WorkspaceProps {
  locale: Locale;
}

interface GenerateApiResponse {
  figure: Figure;
  fit: FitAssessment;
  model?: string;
  error?: string;
  details?: string[];
}

interface AttachmentApiResponse {
  attachment?: UploadedAttachment;
  error?: string;
}

const ACCEPTED_CONTEXT_EXTENSIONS = [".pdf", ".md", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".pptx"];

export function Workspace({ locale }: WorkspaceProps) {
  const t = dictionaries[locale];
  const [skillId, setSkillId] = useState<SkillId>("freeform");
  const [description, setDescription] = useState("");
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [figure, setFigure] = useState<Figure | null>(null);
  const [fit, setFit] = useState<FitAssessment | null>(null);
  const [model, setModel] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<"preview" | "json">("preview");
  const [history, setHistory] = useState<Figure[]>([]);
  const [error, setError] = useState("");
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationIdRef = useRef(crypto.randomUUID());
  const thinkingStatus = generationStatus ? `${generationStatus} ${generationSeconds}s` : "";

  const selectedElement = useMemo(
    () => (figure && selectedId ? findElement(figure.elements, selectedId) : undefined),
    [figure, selectedId]
  );

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

    setIsGenerating(true);
    setError("");
    setGenerationStatus(t.generateThinking);
    setGenerationStartedAt(Date.now());
    setGenerationSeconds(0);
    setSelectedId("");

    try {
      const generateUrl = appUrl("/api/generate");
      const response = await fetch(generateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          skillId,
          userDescription: description,
          language: locale,
          conversationId: conversationIdRef.current,
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
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : t.errorTitle);
    } finally {
      setIsGenerating(false);
      setGenerationStatus("");
      setGenerationStartedAt(null);
      setGenerationSeconds(0);
    }
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
  }

  function patchSelected(updater: (element: FigureElement) => FigureElement) {
    if (!figure || !selectedId) {
      return;
    }

    pushHistory(figure);
    setFigure({
      ...figure,
      elements: updateElement(figure.elements, selectedId, updater)
    });
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
    <main className="min-h-screen overflow-x-hidden px-2 py-2 text-ink sm:px-5 sm:py-3 lg:px-6">
      <div className="mx-auto flex max-w-[1560px] flex-col gap-3 sm:gap-4">
        <header className="flex flex-col gap-3 rounded-md border border-line bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 items-center">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-normal text-ink sm:text-xl">{t.appName}</h1>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-slate-500 sm:truncate sm:text-sm">
                {t.appSubtitle}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 rounded-md border border-line bg-panel p-1 sm:flex">
            <Link
              href="/en"
              className={`rounded px-3 py-1.5 text-center text-sm font-medium transition ${
                locale === "en" ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"
              }`}
            >
              {t.languageEnglish}
            </Link>
            <Link
              href="/zh"
              className={`rounded px-3 py-1.5 text-center text-sm font-medium transition ${
                locale === "zh" ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"
              }`}
            >
              {t.languageChinese}
            </Link>
          </div>
        </header>

        <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-4">
          <section className="rounded-md border border-line bg-white">
            <div className="border-b border-line px-3 py-3 sm:px-4">
              <h2 className="text-sm font-semibold text-ink">{t.generate}</h2>
            </div>

            <div className="space-y-4 p-3 sm:p-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">{t.skillLabel}</span>
                <select
                  value={skillId}
                  onChange={(event) => setSkillId(event.target.value as SkillId)}
                  className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink transition hover:border-slate-400"
                >
                  {INTERNAL_SKILLS.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name[locale]}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase text-slate-500">{t.modelLabel}</div>
                <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 text-sm text-slate-700">
                  <span className="truncate">{model || t.modelFromEnv}</span>
                  {model ? <CheckCircle2 className="shrink-0 text-mint" size={16} /> : null}
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">{t.promptLabel}</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t.promptPlaceholder}
                  rows={6}
                  className="w-full resize-none rounded-md border border-line bg-white px-3 py-2.5 text-sm leading-6 text-ink transition placeholder:text-slate-400 hover:border-slate-400"
                />
              </label>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase text-slate-500">{t.pptLabel}</div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleFile(event.dataTransfer.files[0]);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  className="flex min-h-20 w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-panel px-3 py-4 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-white"
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

              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || isUploading}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-400"
              >
                {isGenerating ? t.generating : t.generate}
              </button>

              {thinkingStatus ? (
                <div className="animate-pulse rounded-md border border-line bg-panel px-3 py-2.5 text-sm leading-5 text-slate-700">
                  {thinkingStatus}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-md border border-coral/40 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                  <div className="font-semibold">{t.errorTitle}</div>
                  <div className="mt-1 leading-5">{error}</div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex min-h-[520px] flex-col overflow-hidden rounded-md border border-line bg-white lg:min-h-[680px]">
            <div className="flex flex-col gap-3 border-b border-line bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="grid grid-cols-2 rounded-md border border-line bg-panel p-1 sm:flex">
                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className={`flex h-8 items-center justify-center rounded px-3 text-sm font-medium transition ${
                    activeTab === "preview" ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"
                  }`}
                >
                  {t.preview}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("json")}
                  className={`flex h-8 items-center justify-center rounded px-3 text-sm font-medium transition ${
                    activeTab === "json" ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"
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
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-slate-700 transition hover:border-slate-400 hover:bg-panel disabled:opacity-40"
                >
                  <Undo2 size={17} />
                </button>
                <button
                  type="button"
                  onClick={downloadSvg}
                  disabled={!figure}
                  className="flex h-9 min-w-0 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink transition hover:border-slate-400 hover:bg-panel disabled:opacity-40"
                >
                  <span className="truncate">{t.downloadSvg}</span>
                </button>
              </div>
            </div>

            <div className="grid flex-1 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-h-[300px] items-center justify-center bg-panel p-2 sm:min-h-[430px] sm:p-4 lg:min-h-[560px] lg:p-6">
                {isGenerating ? (
                  <div className="flex min-h-[220px] w-full max-w-[1080px] flex-col items-center justify-center gap-3 rounded-md border border-line bg-white/90 text-center">
                    <Loader2 size={30} className="animate-spin text-cobalt" />
                    <div className="animate-pulse text-sm font-semibold text-ink">{thinkingStatus || t.generating}</div>
                  </div>
                ) : figure ? (
                  activeTab === "preview" ? (
                    <div className="aspect-video w-full max-w-[1080px] overflow-hidden rounded-md border border-line bg-white">
                      <FigureSvg figure={figure} selectedId={selectedId} onSelect={setSelectedId} />
                    </div>
                  ) : (
                    <pre className="h-full max-h-[360px] w-full overflow-auto rounded-md border border-line bg-white p-3 text-xs leading-5 text-slate-800 sm:max-h-[520px] sm:p-4 lg:max-h-[620px]">
                      {JSON.stringify({ figure, fit }, null, 2)}
                    </pre>
                  )
                ) : (
                  <div className="flex max-w-[260px] flex-col items-center px-3 text-center sm:max-w-sm">
                    <div className="text-sm font-medium leading-5 text-slate-600">{t.emptyState}</div>
                  </div>
                )}
              </div>

              <aside className="border-t border-line bg-white p-3 sm:p-4 xl:border-l xl:border-t-0">
                {fit ? (
                  <div className="mb-5 border-b border-line pb-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">{t.fit}</span>
                      <span className="font-semibold text-mint">{Math.round(fit.score * 100)}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel">
                      <div className="h-full rounded-full bg-mint" style={{ width: `${Math.round(fit.score * 100)}%` }} />
                    </div>
                    {fit.note ? <p className="mt-2 text-sm leading-5 text-slate-600">{fit.note}</p> : null}
                  </div>
                ) : null}

                <ElementPanel element={selectedElement} labels={t} onPatch={patchSelected} />

                <div className="mt-5 border-t border-line pt-4 text-xs leading-5 text-slate-500">{t.pptxDisabled}</div>
              </aside>
            </div>
          </section>
        </div>
      </div>
    </main>
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

function ElementPanel({
  element,
  labels,
  onPatch
}: {
  element?: FigureElement;
  labels: typeof dictionaries.en;
  onPatch: (updater: (element: FigureElement) => FigureElement) => void;
}) {
  if (!element) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-ink">{labels.selectedElement}</h2>
        <p className="mt-2 text-sm leading-5 text-slate-500">{labels.noSelection}</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-ink">{labels.selectedElement}</h2>
      <div className="mt-3 space-y-4">
        {element.type === "text" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">{labels.text}</span>
            <input
              value={element.text}
              onChange={(event) =>
                onPatch((current) => (current.type === "text" ? { ...current, text: event.target.value } : current))
              }
              className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink transition hover:border-slate-400"
            />
          </label>
        ) : null}

        {"fill" in element ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">{labels.fill}</span>
            <input
              type="color"
              value={element.fill === "none" ? "#ffffff" : element.fill}
              onChange={(event) =>
                onPatch((current) => ("fill" in current ? { ...current, fill: event.target.value } : current))
              }
              className="h-10 w-full rounded-md border border-line bg-white p-1"
            />
          </label>
        ) : null}

        {"stroke" in element ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">{labels.stroke}</span>
            <input
              type="color"
              value={element.stroke}
              onChange={(event) =>
                onPatch((current) => ("stroke" in current ? { ...current, stroke: event.target.value } : current))
              }
              className="h-10 w-full rounded-md border border-line bg-white p-1"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}
