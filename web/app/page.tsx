"use client";

import {
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  Play,
  RotateCcw,
  ScanSearch,
  Scissors,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import FeedbackWidget from "./components/FeedbackWidget";
import HeroIllustration from "./components/HeroIllustration";
import JsonViewer from "./components/JsonViewer";
import SchemaEditor from "./components/SchemaEditor";
import ThemeToggle from "./components/ThemeToggle";
import { runPuterExtraction } from "./lib/puter";
import { hasPdfSignature, MAX_PDF_SIZE, MAX_SCHEMA_LENGTH, normalizeSchemaText } from "../lib/pdf";

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
  usageDetails?: Record<string, unknown>;
  response?: Record<string, unknown>;
  model?: string;
  created?: number;
  id?: string;
  [key: string]: unknown;
}

// Leaf values in the schema must name a data type, not an arbitrary string —
// this is what the extraction pipeline (see `leafType` in retriever.ts)
// expects to find at each field.
const ALLOWED_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "int",
  "float",
  "double",
  "decimal",
  "long",
  "boolean",
  "bool",
  "date",
  "datetime",
]);

// Walks the parsed schema looking for a leaf value that isn't one of
// ALLOWED_SCHEMA_TYPES. Returns the offending value, or null if every leaf
// is a recognized type name.
function findInvalidSchemaType(node: unknown): string | null {
  if (typeof node === "string") {
    return ALLOWED_SCHEMA_TYPES.has(node.trim().toLowerCase()) ? null : node;
  }

  if (Array.isArray(node)) {
    return node.length > 0 ? findInvalidSchemaType(node[0]) : null;
  }

  if (typeof node === "object" && node !== null) {
    for (const value of Object.values(node)) {
      const invalid = findInvalidSchemaType(value);
      if (invalid !== null) {
        return invalid;
      }
    }
    return null;
  }

  return String(node);
}

const DATE_FORMAT_OPTIONS = [
  "DD-MM-YYYY",
  "MM-DD-YYYY",
  "YYYY-MM-DD",
  "DD-MM",
  "DD Mon YYYY",
  "Mon DD, YYYY",
];

const STRING_CASE_OPTIONS = [
  "Proper Case",
  "camelCase",
  "PascalCase",
  "UPPERCASE",
  "lowercase",
];

const NUMBER_FORMAT_OPTIONS = [
  "Plain",
  "2 decimals",
  "Comma-separated",
  "Compact",
];

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

// --- Unused now that the Results panel only shows final extraction data,
// kept in case per-signal stat cards (chunks/top-k/threshold) come back.
// function StatCard({
//   icon,
//   value,
//   label,
//   accent,
// }: {
//   icon: ReactNode;
//   value: ReactNode;
//   label: string;
//   accent?: "accent" | "success" | "muted";
// }) {
//   const iconBg =
//     accent === "accent"
//       ? "bg-accent-soft text-accent"
//       : accent === "success"
//         ? "bg-success-soft text-success"
//         : "bg-surface-2 text-muted";
//
//   return (
//     <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
//       <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
//         {icon}
//       </span>
//       <div className="min-w-0">
//         <p className="text-2xl font-semibold tabular-nums text-fg">{value}</p>
//         <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
//           {label}
//         </p>
//       </div>
//     </div>
//   );
// }

// --- Replaced by <ExtractionProgress /> below, which shows named pipeline
// stages instead of a generic shimmer skeleton. Kept for easy revert.
// function SkeletonBlock({ className = "" }: { className?: string }) {
//   return (
//     <div
//       className={`animate-shimmer rounded-xl bg-surface-2 ${className}`}
//     />
//   );
// }
//
// function ResultsSkeleton() {
//   return (
//     <div className="animate-fade-in-up mt-12 border-t-2 border-fg pt-5">
//       <div className="flex flex-wrap items-center justify-between gap-4">
//         <div className="flex items-center gap-2">
//           <BarChart3 className="h-5 w-5 text-muted" strokeWidth={1.75} />
//           <h2 className="text-2xl font-semibold">Results</h2>
//         </div>
//         <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
//           <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
//           Analysing document
//         </p>
//       </div>
//
//       <div className="mt-6 grid gap-4 sm:grid-cols-3">
//         <SkeletonBlock className="h-[68px]" />
//         <SkeletonBlock className="h-[68px]" />
//         <SkeletonBlock className="h-[68px]" />
//       </div>
//
//       <SkeletonBlock className="mt-6 h-6 w-64" />
//       <SkeletonBlock className="mt-8 h-80 w-full" />
//     </div>
//   );
// }

// Named pipeline stages shown while `/api/analyse` is in flight. The request
// is a single round trip (chunk -> rank -> extract all happen server-side
// before the response comes back), so there's no real per-stage progress
// event to listen for — this is a timed simulation that advances every
// STAGE_INTERVAL_MS and then holds on the last stage for however long the
// real request still takes, rather than pretending to finish early.
const PIPELINE_STAGES = [
  {
    key: "chunking",
    label: "Chunking document",
    detail: "Splitting the PDF into scoring-ready chunks",
    icon: Scissors,
  },
  {
    key: "analyzing",
    label: "Analyzing structure",
    detail: "Ranking chunks by semantic, lexical, entity & structural signal",
    icon: ScanSearch,
  },
  {
    key: "extracting",
    label: "Extracting fields",
    detail: "Asking the model to fill in your schema",
    icon: Wand2,
  },
] as const;

const STAGE_INTERVAL_MS = 1800;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function ExtractionProgress({ complete }: { complete: boolean }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (complete) {
      return;
    }

    const timer = setInterval(() => {
      setStageIndex((index) => Math.min(index + 1, PIPELINE_STAGES.length - 1));
    }, STAGE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [complete]);

  // Elapsed time freezes the instant `complete` flips true (the effect
  // re-runs, sees complete, and simply doesn't schedule a new tick), so the
  // final "Done in Xs" reading is accurate rather than still counting up.
  useEffect(() => {
    if (complete) {
      return;
    }

    const start = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - start), 250);

    return () => clearInterval(timer);
  }, [complete]);

  return (
    <div className="animate-fade-in-up">
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {complete ? "Pipeline complete" : "Running pipeline"}
          </span>
          <span className="font-mono text-xs text-muted">
            {complete ? "Done in " : ""}
            {formatElapsed(elapsedMs)}
          </span>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-4">
          {PIPELINE_STAGES.map((stage, index) => {
            const isDone = complete || index < stageIndex;
            const isActive = !complete && index === stageIndex;
            const Icon = stage.icon;

            return (
              <div key={stage.key} className="flex flex-1 items-center gap-3">
                <span
                  className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300 ${isDone
                      ? "border-accent bg-accent-soft text-accent"
                      : isActive
                        ? "animate-pulse-ring border-accent bg-accent-soft text-accent"
                        : "border-border bg-surface-2 text-muted"
                    }`}
                >
                  {isActive && (
                    <span className="animate-spin absolute inset-0 rounded-full border-2 border-transparent border-t-accent" />
                  )}
                  {isDone ? (
                    <Check className="animate-pop-in h-5 w-5" strokeWidth={2.75} />
                  ) : (
                    <Icon className="h-4 w-4" strokeWidth={1.9} />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${isDone || isActive ? "text-fg" : "text-muted"
                      }`}
                  >
                    {stage.label}
                    {isActive && (
                      <span className="inline-flex items-center gap-0.5">
                        <span className="animate-dot-bounce h-1 w-1 rounded-full bg-accent" />
                        <span
                          className="animate-dot-bounce h-1 w-1 rounded-full bg-accent"
                          style={{ animationDelay: "0.15s" }}
                        />
                        <span
                          className="animate-dot-bounce h-1 w-1 rounded-full bg-accent"
                          style={{ animationDelay: "0.3s" }}
                        />
                      </span>
                    )}
                  </p>
                  <p className="hidden truncate text-xs text-muted sm:block">
                    {stage.detail}
                  </p>
                </div>

                {index < PIPELINE_STAGES.length - 1 && (
                  <span className="hidden h-1 flex-1 shrink-0 overflow-hidden rounded-full bg-surface-2 sm:block">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
                      style={{ width: isDone ? "100%" : "0%" }}
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {complete && (
        <p className="animate-fade-in-up mt-4 flex items-center gap-2 text-sm font-semibold text-accent">
          <Check className="animate-pop-in h-4 w-4" strokeWidth={2.75} />
          Extracted data
        </p>
      )}
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
  // Bumped on every analyse() call and used as ExtractionProgress's `key` so
  // the pipeline animation remounts (stageIndex/elapsedMs reset to 0)
  // instead of resuming from wherever the previous run left off.
  const [runId, setRunId] = useState(0);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [dateFormat, setDateFormat] = useState(DATE_FORMAT_OPTIONS[0]);
  const [stringCase, setStringCase] = useState(STRING_CASE_OPTIONS[0]);
  const [numberFormat, setNumberFormat] = useState(NUMBER_FORMAT_OPTIONS[0]);
  const [customRules, setCustomRules] = useState("");
  const [customRulesOpen, setCustomRulesOpen] = useState(false);
  const [schemaCardHeight, setSchemaCardHeight] = useState<number | undefined>(undefined);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);

  // Keeps the extraction-schema card the same height as the source-PDF +
  // output-format stack on desktop. Only re-measures while the output-format
  // panel is collapsed, so opening it doesn't stretch the schema card too.
  useEffect(() => {
    const leftEl = leftColumnRef.current;
    if (!leftEl) return;

    const desktop = window.matchMedia("(min-width: 1024px)");

    function measure() {
      if (!desktop.matches) {
        setSchemaCardHeight(undefined);
        return;
      }
      if (formattingOpen) return;
      if (leftEl) setSchemaCardHeight(leftEl.getBoundingClientRect().height);
    }

    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(leftEl);
    desktop.addEventListener("change", measure);

    return () => {
      resizeObserver.disconnect();
      desktop.removeEventListener("change", measure);
    };
  }, [formattingOpen]);

  // Start server-side model warm-up while the user is selecting a PDF and
  // schema. The request is deliberately best-effort; analysis still shares
  // the same singleton promise if warm-up has not finished yet.
  useEffect(() => {
    const startedAt = performance.now();

    void fetch("/api/model-status")
      .then((response) => {
        if (!response.ok) {
          console.warn("[model-warmup] request failed", {
            status: response.status,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
      })
      .catch((error) => {
        console.warn("[model-warmup] request failed", {
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  // --- Only used by the (currently hidden) chunks view below.
  // const [activeTab, setActiveTab] = useState<"all" | "top">("all");
  // const [resultTab, setResultTab] = useState<"chunks" | "extraction">("chunks");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Matches the backend's normalizeSchemaText() so the on-screen count and
  // the enforced limit never disagree about how long the schema is.
  const schemaLength = useMemo(() => normalizeSchemaText(schema).length, [schema]);

  const schemaError = useMemo(() => {
    if (schemaLength > MAX_SCHEMA_LENGTH) {
      return `Schema must be ${MAX_SCHEMA_LENGTH.toLocaleString()} characters or fewer.`;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(schema);
    } catch {
      return "Schema must be valid JSON.";
    }

    const invalidType = findInvalidSchemaType(parsed);
    if (invalidType !== null) {
      return `"${invalidType}" is not a valid data type — use string, number, integer, float, double, boolean, or date.`;
    }

    return null;
  }, [schema, schemaLength]);

  const schemaIsValid = schemaError === null;

  async function pickFile(file: File | null) {
    if (!file) {
      setError("");
      setPdf(null);
      return;
    }

    if (file.size > MAX_PDF_SIZE) {
      setError("The PDF must be 7 MB or smaller.");
      return;
    }

    if (
      (file.type && file.type !== "application/pdf") ||
      !file.name.toLowerCase().endsWith(".pdf") ||
      !(await hasPdfSignature(file))
    ) {
      setError("Only valid PDF files are supported.");
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
    // setActiveTab("all");
    // setResultTab("chunks");

    if (!pdf) {
      setError("Choose a PDF first.");
      return;
    }

    if (pdf.size > MAX_PDF_SIZE) {
      setError("The PDF must be 7 MB or smaller.");
      return;
    }

    if (!schemaIsValid) {
      setError(schemaError ?? "Schema must be valid JSON.");
      return;
    }

    const formData = new FormData();
    formData.append("pdf", pdf);
    formData.append("schema", schema);
    formData.append("date_format", dateFormat);
    formData.append("string_case", stringCase);
    formData.append("number_format", numberFormat);
    formData.append("custom_rules", customRules);
    setRunId((id) => id + 1);
    setLoading(true);

    const extraction_provider =
      process.env.NEXT_PUBLIC_EXTRACTION_PROVIDER ??
      process.env.EXTRACTION_PROVIDER ??
      "puter";
    try {
      const response = await fetch("/api/analyse", {
        method: "POST",
        body: formData,
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Analysis failed");
      }

      if (extraction_provider === "puter") {
        const extracted = await runPuterExtraction({
          schema: JSON.parse(schema),
          chunks: body.ranked_chunks,
          dateFormat,
          stringCase,
          numberFormat,
          customRules,
        });

        setResult(body);
        setExtractionResult({
          response: extracted.response,
          usageDetails: extracted.usageDetails,
          model: process.env.NEXT_PUBLIC_PUTER_MODEL ?? "gpt-5.6-luna",
        });
        void logUsage({
          provider: "puter",
          topKChunks: body.ranked_chunks,
          response: extracted.response,
          usageDetails: extracted.usageDetails,
          model: process.env.NEXT_PUBLIC_PUTER_MODEL ?? "gpt-5.6-luna",
        });
      } else if (extraction_provider === "apinex") {
        const extractionResponse = await fetch("/api/extract/apinex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_schema: JSON.parse(schema),
            user_content: body.ranked_chunks,
            pdf_size: pdf.size,
            date_format: dateFormat,
            string_case: stringCase,
            number_format: numberFormat,
            custom_rules: customRules,
          }),
        });
        const extractionBody = await extractionResponse.json();
        if (!extractionResponse.ok) {
          throw new Error(extractionBody.error ?? "Apinex extraction failed");
        }

        setResult(body);
        setExtractionResult(extractionBody);
        void logUsage({
          provider: "apinex",
          topKChunks: body.ranked_chunks,
          response: extractionBody.response,
          usage: extractionBody.usage,
          model: extractionBody.model,
        });
      } else {
        const extractionResponse = await fetch(
          "/api/extract",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_schema: JSON.parse(schema),
              user_content: body.ranked_chunks,
              pdf_size: pdf.size,
              date_format: dateFormat,
              string_case: stringCase,
              number_format: numberFormat,
              custom_rules: customRules,
            }),
          },
        );
        const extractionBody = await extractionResponse.json();

        if (!extractionResponse.ok) {
          throw new Error(extractionBody.error ?? "Extraction failed");
        }

        setResult(body);
        setExtractionResult(extractionBody);
        void logUsage({
          provider: "worker",
          topKChunks: body.ranked_chunks,
          response: extractionBody.response ?? extractionBody,
          usage: extractionBody.usage,
          model: extractionBody.model,
        });
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Analysis failed",
      );
    } finally {
      setLoading(false);
    }

    async function logUsage({
      provider,
      response,
      topKChunks,
      usage,
      usageDetails,
      model,
    }: {
      provider: "puter" | "worker" | "apinex";
      response: unknown;
      topKChunks: unknown[];
      usage?: unknown;
      usageDetails?: unknown;
      model?: string;
    }) {
      const loggingResponse = await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          pdf_name: pdf?.name,
          pdf_size: pdf?.size,
          user_schema: JSON.parse(schema),
          top_k_chunks: topKChunks,
          response,
          usage,
          usageDetails,
          model,
          custom_rules: customRules,
        }),
      });

      if (!loggingResponse.ok) {
        const body = await loggingResponse.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to log extraction usage");
      }
    }
  }

  // Stays visible once a result lands, instead of being replaced by the
  // results section — the animation settles into its "complete" state and
  // the results appear below it. Only hidden again on error (loading is
  // false but no result came back) or before the first run.
  const showProgress = loading || result !== null;

  // --- Chunk-level view (all chunks / top matches JSON) is intentionally
  // hidden — only the final extraction result is shown to the user. Left
  // commented out, not deleted, so it can be brought back easily.
  //
  // const activeJson = result
  //   ? activeTab === "all"
  //     ? { total_chunks: result.total_chunks, chunks: result.chunks }
  //     : {
  //       top_k: result.top_k,
  //       threshold: result.threshold,
  //       chunks: result.ranked_chunks,
  //     }
  //   : null;
  //
  // async function copyJson() {
  //   if (!activeJson) return;
  //   try {
  //     await navigator.clipboard.writeText(JSON.stringify(activeJson, null, 2));
  //     setCopied(true);
  //     setTimeout(() => setCopied(false), 1800);
  //   } catch {
  //     setError("Couldn't copy to clipboard.");
  //   }
  // }
  //
  // function downloadJson() {
  //   if (!activeJson) return;
  //   const blob = new Blob([JSON.stringify(activeJson, null, 2)], {
  //     type: "application/json",
  //   });
  //   const url = URL.createObjectURL(blob);
  //   const anchor = document.createElement("a");
  //   anchor.href = url;
  //   anchor.download = activeTab === "all" ? "chunks.json" : "top-chunks.json";
  //   anchor.click();
  //   URL.revokeObjectURL(url);
  // }

  async function copyExtraction() {
    if (!extractionResult?.response) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(extractionResult.response, null, 2),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy to clipboard.");
    }
  }

  function downloadExtraction() {
    if (!extractionResult?.response) return;
    const blob = new Blob([JSON.stringify(extractionResult.response, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "extracted-data.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-bg pt-[76px] text-fg">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-border bg-bg/90 px-6 py-4 backdrop-blur sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-accent">
              Schema Extract
              <span className="h-px w-8 bg-accent" />
            </p>
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
            {/* <p className="mb-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-accent">
              Schema Extract
              <span className="h-px w-8 bg-accent" />
            </p> */}
            <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
              Turn any PDF into structured data.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Papers, invoices, contracts, reports &mdash; upload any PDF,
              describe the fields you need, and get clean, structured JSON
              back in seconds.
            </p>
          </div>

          <HeroIllustration />
        </div>

        <form
          onSubmit={analyse}
          className="mt-12 grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]"
        >
          <div ref={leftColumnRef} className="flex flex-col gap-6">
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
            </div>

            {error && (
              <p className="animate-fade-in-up mt-5 rounded-lg border-l-2 border-danger bg-danger-soft py-2 pl-3 text-sm text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">
            <button
              type="button"
              onClick={() => setFormattingOpen((open) => !open)}
              aria-expanded={formattingOpen}
              aria-controls="output-formatting-body"
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-accent">03</span>
                <span className="text-sm font-semibold uppercase tracking-wider">
                  Output format
                </span>
              </span>
              <span className="flex items-center gap-2.5">
                <span className="hidden font-mono text-[11px] text-muted sm:inline">
                  Advanced
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${formattingOpen ? "rotate-180" : ""}`}
                  strokeWidth={1.75}
                />
              </span>
            </button>

            <div
              id="output-formatting-body"
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${formattingOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <div className="overflow-hidden">
                <div className="grid gap-3 border-t border-border px-6 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="date-format" className="text-sm font-medium">
                      Date format
                    </label>
                    <select
                      id="date-format"
                      value={dateFormat}
                      onChange={(event) => setDateFormat(event.target.value)}
                      className="min-w-[11rem] rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-fg outline-none transition focus:border-accent"
                    >
                      {DATE_FORMAT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="string-case" className="text-sm font-medium">
                      String case
                    </label>
                    <select
                      id="string-case"
                      value={stringCase}
                      onChange={(event) => setStringCase(event.target.value)}
                      className="min-w-[11rem] rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-fg outline-none transition focus:border-accent"
                    >
                      {STRING_CASE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="number-format" className="text-sm font-medium">
                      Number format
                    </label>
                    <select
                      id="number-format"
                      value={numberFormat}
                      onChange={(event) => setNumberFormat(event.target.value)}
                      className="min-w-[11rem] rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-fg outline-none transition focus:border-accent"
                    >
                      {NUMBER_FORMAT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            </div>
          </div>

          <div
            className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)] lg:flex lg:flex-col"
            style={schemaCardHeight ? { height: schemaCardHeight } : undefined}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-accent">02</span>
                <label
                  className="text-sm font-semibold uppercase tracking-wider"
                  htmlFor="schema"
                >
                  Extraction schema
                </label>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    schemaLength > MAX_SCHEMA_LENGTH * 0.9
                      ? "text-amber-500"
                      : "text-muted"
                  }`}
                >
                  ({schemaLength.toLocaleString()}/{MAX_SCHEMA_LENGTH.toLocaleString()})
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span
                  title={schemaError ?? undefined}
                  className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${schemaIsValid ? "text-success" : "text-danger"
                    }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${schemaIsValid ? "bg-success" : "bg-danger"}`}
                  />
                  {schemaIsValid ? "Valid schema" : "Invalid schema"}
                </span>
                <div className="group relative flex items-center">
                  <button
                    type="button"
                    aria-label="Show allowed schema value types"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:text-accent"
                  >
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-border bg-surface p-3 opacity-0 shadow-[var(--shadow-card)] transition-opacity duration-150 group-hover:opacity-100">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Allowed value types
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(ALLOWED_SCHEMA_TYPES).map((type) => (
                        <span
                          key={type}
                          className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg"
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
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

            <div className="mt-4 lg:min-h-0 lg:flex-1">
              <SchemaEditor
                id="schema"
                value={schema}
                onChange={setSchema}
                maxLength={MAX_SCHEMA_LENGTH}
              />
            </div>
            
          </div>
          <div className="w-full rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] lg:col-span-2">
            <button
              type="button"
              onClick={() => setCustomRulesOpen((open) => !open)}
              aria-expanded={customRulesOpen}
              aria-controls="custom-rules-body"
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-accent">04</span>
                <span className="text-sm font-semibold uppercase tracking-wider">
                  Custom rules
                </span>
              </div>
              <span className="flex items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  ({customRules.length.toLocaleString()}/2,000)
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCustomRules("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      setCustomRules("");
                    }
                  }}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted transition hover:text-accent"
                >
                  <RotateCcw className="h-3 w-3" strokeWidth={2} />
                  Reset
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted transition-transform duration-200 ${
                    customRulesOpen ? "rotate-180" : ""
                  }`}
                  strokeWidth={1.75}
                />
              </span>
            </button>
            <div
              id="custom-rules-body"
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                customRulesOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <div className="border-t border-border px-6 py-4">
                  <textarea
                    id="custom-rules"
                    value={customRules}
                    onChange={(event) => setCustomRules(event.target.value)}
                    maxLength={2000}
                    rows={5}
                    placeholder="Add extra instructions for the extraction model..."
                    className="w-full resize-y rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm leading-6 text-fg outline-none transition placeholder:text-muted focus:border-accent"
                  />
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* --- Full results view with chunk stats, tabs, and chunk JSON —
            intentionally hidden so only the final extraction shows. Kept
            commented out (not deleted) for easy revert.

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
                        <span className="text-muted">
                          Completion tokens
                        </span>
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
                    <div className="bg-white p-5 shadow-sm ring-1 ring-[#202522]/10">
                      <h3 className="font-semibold text-[#202522]">
                        Full Response
                      </h3>
                      <pre className="mt-3 max-h-[24rem] overflow-auto bg-[#f4f1ea] p-3 text-xs leading-6 text-[#202522] whitespace-pre-wrap break-words">
                        {JSON.stringify(extractionResult, null, 2)}
                      </pre>
                    </div>
                  )}
              </div>
            )}
          </section>
        )}

        --- end commented-out full results view --- */}

        {showProgress && (
          <section className="animate-fade-in-up mt-12 border-t-2 border-fg pt-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted" strokeWidth={1.75} />
                <h2 className="text-2xl font-semibold">Results</h2>
              </div>
              {result !== null && extractionResult?.response && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={copyExtraction}
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
                    onClick={downloadExtraction}
                    className="flex items-center gap-2 rounded-xl bg-fg px-4 py-2 text-xs font-semibold uppercase tracking-wide text-bg transition hover:bg-accent"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Download
                  </button>
                </div>
              )}
            </div>

            {/* Stays visible (settling into its "complete" state) once the
                result lands, instead of being swapped out for the content
                below — the extracted data appears underneath it. */}
            <div className="mt-8">
              <ExtractionProgress key={runId} complete={result !== null} />
            </div>

            {result !== null && (extractionResult?.response ? (
              <>
                <div className="mt-6">
                  <JsonViewer
                    value={extractionResult.response}
                    summaryLabel="extracted data"
                  />
                </div>

                {extractionResult.usage && (
                  <div className="mt-4 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
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
                {extractionResult.usageDetails && (
                  <div className="mt-4 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
                    <h3 className="font-semibold text-fg">Usage details</h3>
                    <div className="mt-3 space-y-2 text-xs">
                      {Object.entries(extractionResult.usageDetails).map(
                        ([key, value]) => (
                          <div
                            key={key}
                            className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0"
                          >
                            <span className="text-muted">{key}</span>
                            <span className="max-w-[70%] break-words text-right font-mono font-semibold text-fg">
                              {typeof value === "object"
                                ? JSON.stringify(value)
                                : String(value)}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-6 text-sm text-muted">
                No extraction data was returned for this document.
              </p>
            ))}
          </section>
        )}
      </section>

      <footer className="border-t border-border px-6 py-8 sm:px-10">
        <p className="mx-auto max-w-6xl text-sm text-muted">
          Built for speed and accuracy &mdash; extract exactly the fields you
          define, from any document, every time.
        </p>
      </footer>

      <FeedbackWidget />
    </main>
  );
}
