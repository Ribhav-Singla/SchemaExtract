"use client";

import {
  BarChart3,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Target,
  UploadCloud,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useMemo, useRef, useState } from "react";

import HeroIllustration from "./components/HeroIllustration";
import JsonViewer from "./components/JsonViewer";
import SchemaEditor from "./components/SchemaEditor";
import ThemeToggle from "./components/ThemeToggle";

interface ExtractionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface ExtractionChoice {
  finish_reason: string;
  index: number;
  message: {
    content: string;
  };
}

interface ExtractionResponse {
  choices?: ExtractionChoice[];
  usage?: ExtractionUsage;
  response?: Record<string, unknown>;
  model?: string;
  created?: number;
  id?: string;
  [key: string]: unknown;
}

const EXAMPLE_SCHEMA = `{
  "research_area": "string",
  "application": "string",
  "base_algorithm": "string",
  "environment": "string",
  "models_evaluated": ["string"],
  "perception": ["string"],
  "experimental_conditions": ["string"],
  "main_finding": "string"
}
`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateFileName(name: string, maxLength: number = 22): string {
  if (name.length <= maxLength) return name;

  const dotIndex = name.lastIndexOf(".");
  const ext = dotIndex > 0 ? name.slice(dotIndex) : "";
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const keep = Math.max(maxLength - ext.length - 1, 4);

  return `${base.slice(0, keep)}…${ext}`;
}

function StatCard({
  icon,
  value,
  label,
  accent,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  accent?: "accent" | "success" | "muted";
}) {
  const iconBg =
    accent === "accent"
      ? "bg-accent-soft text-accent"
      : accent === "success"
        ? "bg-success-soft text-success"
        : "bg-surface-2 text-muted";

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold tabular-nums text-fg">{value}</p>
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
      </div>
    </div>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-xl bg-surface-2 ${className}`}
    />
  );
}

function ResultsSkeleton() {
  return (
    <div className="animate-fade-in-up mt-12 border-t-2 border-fg pt-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted" strokeWidth={1.75} />
          <h2 className="text-2xl font-semibold">Results</h2>
        </div>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          Analysing document
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <SkeletonBlock className="h-[68px]" />
        <SkeletonBlock className="h-[68px]" />
        <SkeletonBlock className="h-[68px]" />
      </div>

      <SkeletonBlock className="mt-6 h-6 w-64" />
      <SkeletonBlock className="mt-8 h-80 w-full" />
    </div>
  );
}

export default function Home() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [schema, setSchema] = useState(EXAMPLE_SCHEMA);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [extractionResult, setExtractionResult] =
    useState<ExtractionResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "top">("all");
  const [resultTab, setResultTab] = useState<"chunks" | "extraction">("chunks");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const schemaIsValid = useMemo(() => {
    try {
      JSON.parse(schema);
      return true;
    } catch {
      return false;
    }
  }, [schema]);

  function pickFile(file: File | null) {
    if (
      file &&
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Only PDF files are supported.");
      return;
    }
    setError("");
    setPdf(file);
  }

  async function analyse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setExtractionResult(null);
    setCopied(false);
    setActiveTab("all");
    setResultTab("chunks");

    if (!pdf) {
      setError("Choose a PDF first.");
      return;
    }

    if (!schemaIsValid) {
      setError("Schema must be valid JSON.");
      return;
    }

    const formData = new FormData();
    formData.append("pdf", pdf);
    formData.append("schema", schema);
    setLoading(true);

    try {
      const response = await fetch("/api/analyse", {
        method: "POST",
        body: formData,
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Analysis failed");
      }

      setResult(body);

      // Send chunks to extraction API via backend proxy
      const chunksToSend =
        activeTab === "all" ? body.chunks : body.ranked_chunks;
      const extractionPayload = {
        user_schema: JSON.parse(schema),
        user_content: chunksToSend,
      };

      const extractionResponse = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(extractionPayload),
      });

      const extractionData = await extractionResponse.json();

      if (!extractionResponse.ok) {
        throw new Error(extractionData.error ?? "Extraction failed");
      }

      setExtractionResult(extractionData);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Analysis failed",
      );
    } finally {
      setLoading(false);
    }
  }

  const activeJson = result
    ? activeTab === "all"
      ? { total_chunks: result.total_chunks, chunks: result.chunks }
      : {
        top_k: result.top_k,
        threshold: result.threshold,
        chunks: result.ranked_chunks,
      }
    : null;

  async function copyJson() {
    if (!activeJson) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(activeJson, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy to clipboard.");
    }
  }

  function downloadJson() {
    if (!activeJson) return;
    const blob = new Blob([JSON.stringify(activeJson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeTab === "all" ? "chunks.json" : "top-chunks.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-bg pt-[76px] text-fg">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-border bg-bg/90 px-6 py-5 backdrop-blur sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-xs font-bold tracking-tight text-bg">
              SE
            </span>
            <span className="text-sm font-semibold uppercase tracking-[0.2em]">
              Schema Extract
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs font-medium uppercase tracking-[0.2em] text-muted sm:block">
              PDF &rarr; Structured JSON
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-12 sm:px-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="mb-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-accent">
              Schema Extract
              <span className="h-px w-8 bg-accent" />
            </p>
            <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
              Turn any PDF into structured data.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Papers, invoices, contracts, reports &mdash; upload any PDF,
              describe the fields you need, and retrieve the most relevant
              chunks &mdash; ranked by semantic, lexical, entity and
              structural signal.
            </p>
          </div>

          <HeroIllustration />
        </div>

        <form
          onSubmit={analyse}
          className="mt-12 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]"
        >
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-accent">01</span>
                <label
                  className="text-sm font-semibold uppercase tracking-wider"
                  htmlFor="pdf"
                >
                  Source PDF
                </label>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                PDF only
              </span>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                pickFile(event.dataTransfer.files?.[0] ?? null);
              }}
              style={{ height: "10rem", minHeight: "10rem", maxHeight: "10rem" }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${dragActive
                  ? "border-accent bg-accent-soft"
                  : "border-border-strong hover:border-accent/60 hover:bg-surface-2"
                }`}
            >
              <input
                ref={fileInputRef}
                id="pdf"
                type="file"
                accept="application/pdf"
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                className="hidden"
              />

              {pdf ? (
                <div className="flex h-14 w-full max-w-full items-center justify-between gap-3 overflow-hidden rounded-xl bg-surface-2 px-4 shadow-sm ring-1 ring-border">
                  <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
                      <FileText className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p
                        className="truncate whitespace-nowrap text-sm font-semibold"
                        title={pdf.name}
                      >
                        {truncateFileName(pdf.name)}
                      </p>
                      <p className="truncate whitespace-nowrap text-xs text-muted">
                        {formatBytes(pdf.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      pickFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted">
                    <UploadCloud className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <span className="text-sm font-semibold">
                    Drop your PDF here or click to upload
                  </span>
                  <span className="text-xs text-muted">
                    One document at a time &middot; PDF only
                  </span>
                </>
              )}
            </div>

            <div className="mt-8">
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-fg px-6 py-3 text-sm font-semibold text-bg transition hover:bg-accent disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Play className="h-4 w-4" strokeWidth={2} fill="currentColor" />
                )}
                {loading ? "Analysing..." : "Run analysis"}
              </button>
              {loading && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className="animate-progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
                </div>
              )}
            </div>

            {error && (
              <p className="animate-fade-in-up mt-5 rounded-lg border-l-2 border-danger bg-danger-soft py-2 pl-3 text-sm text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-accent">02</span>
                <label
                  className="text-sm font-semibold uppercase tracking-wider"
                  htmlFor="schema"
                >
                  Extraction schema
                </label>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${schemaIsValid ? "text-success" : "text-danger"
                    }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${schemaIsValid ? "bg-success" : "bg-danger"}`}
                  />
                  {schemaIsValid ? "Valid JSON" : "Invalid JSON"}
                </span>
                <button
                  type="button"
                  onClick={() => setSchema(EXAMPLE_SCHEMA)}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted transition hover:text-accent"
                >
                  <RotateCcw className="h-3 w-3" strokeWidth={2} />
                  Reset
                </button>
              </div>
            </div>

            <div className="mt-4">
              <SchemaEditor id="schema" value={schema} onChange={setSchema} />
            </div>
          </div>
        </form>

        {loading && !result && <ResultsSkeleton />}

        {result !== null && activeJson !== null && (
          <section className="animate-fade-in-up mt-12 border-t-2 border-fg pt-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted" strokeWidth={1.75} />
                <h2 className="text-2xl font-semibold">Results</h2>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={copyJson}
                  className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition hover:border-border-strong hover:bg-surface-2"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  {copied ? "Copied" : "Copy JSON"}
                </button>
                <button
                  type="button"
                  onClick={downloadJson}
                  className="flex items-center gap-2 rounded-xl bg-fg px-4 py-2 text-xs font-semibold uppercase tracking-wide text-bg transition hover:bg-accent"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Download
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <StatCard
                icon={<Layers className="h-5 w-5" strokeWidth={1.75} />}
                value={String(result.total_chunks)}
                label="Total chunks"
                accent="success"
              />
              <StatCard
                icon={<Target className="h-5 w-5" strokeWidth={1.75} />}
                value={String(result.top_k)}
                label="Top matches"
                accent="accent"
              />
              <StatCard
                icon={<SlidersHorizontal className="h-5 w-5" strokeWidth={1.75} />}
                value={String(result.threshold)}
                label="Threshold"
                accent="muted"
              />
            </div>

            <div className="mt-6 flex gap-6 border-b border-border">
              <button
                type="button"
                onClick={() => setResultTab("chunks")}
                className={`-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold uppercase tracking-wide transition ${resultTab === "chunks"
                    ? "border-accent text-fg"
                    : "border-transparent text-muted hover:text-fg"
                  }`}
              >
                <BarChart3 className="h-4 w-4" strokeWidth={1.75} />
                Chunks Analysis
              </button>
              <button
                type="button"
                onClick={() => extractionResult && setResultTab("extraction")}
                disabled={!extractionResult}
                className={`-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold uppercase tracking-wide transition ${resultTab === "extraction"
                    ? "border-accent text-fg"
                    : extractionResult
                      ? "border-transparent text-muted hover:text-fg"
                      : "cursor-not-allowed border-transparent text-muted/50"
                  }`}
              >
                <Code2 className="h-4 w-4" strokeWidth={1.75} />
                Schema Extraction
              </button>
            </div>

            {resultTab === "chunks" && (
              <div>
                <div className="mt-6 flex gap-6 border-b border-border">
                  <button
                    type="button"
                    onClick={() => setActiveTab("all")}
                    className={`-mb-px border-b-2 pb-3 text-sm font-semibold uppercase tracking-wide transition ${activeTab === "all"
                        ? "border-accent text-fg"
                        : "border-transparent text-muted hover:text-fg"
                      }`}
                  >
                    All chunks
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("top")}
                    className={`-mb-px border-b-2 pb-3 text-sm font-semibold uppercase tracking-wide transition ${activeTab === "top"
                        ? "border-accent text-fg"
                        : "border-transparent text-muted hover:text-fg"
                      }`}
                  >
                    Top matches
                  </button>
                </div>

                <div className="mt-4">
                  <JsonViewer
                    value={activeJson}
                    summaryLabel={
                      activeTab === "all"
                        ? `total_chunks: ${String(result.total_chunks)},`
                        : `top_k: ${String(result.top_k)}, threshold: ${String(result.threshold)},`
                    }
                  />
                </div>
              </div>
            )}

            {resultTab === "extraction" && extractionResult && (
              <div className="mt-6 grid gap-4">
                {extractionResult.response && (
                  <JsonViewer
                    value={extractionResult.response}
                    summaryLabel="extracted schema"
                  />
                )}
                {extractionResult.usage && (
                  <div className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
                    <h3 className="font-semibold text-fg">API Usage</h3>
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex justify-between border-b border-border pb-2">
                        <span className="text-muted">Prompt tokens</span>
                        <span className="font-mono font-semibold text-fg">
                          {extractionResult.usage.prompt_tokens}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-border pb-2">
                        <span className="text-muted">Completion tokens</span>
                        <span className="font-mono font-semibold text-fg">
                          {extractionResult.usage.completion_tokens}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-fg">Total tokens</span>
                        <span className="font-mono text-accent">
                          {extractionResult.usage.total_tokens}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {extractionResult.choices &&
                  extractionResult.choices[0]?.message?.content && (
                    <JsonViewer value={extractionResult} summaryLabel="full response" />
                  )}
              </div>
            )}
          </section>
        )}
      </section>

      <footer className="border-t border-border px-6 py-8 sm:px-10">
        <p className="mx-auto max-w-6xl text-xs text-muted">
          Layered semantic retrieval &mdash; embeddings, TF&ndash;IDF, entity
          and structural scoring, blended into a single relevance rank.
        </p>
      </footer>
    </main>
  );
}
