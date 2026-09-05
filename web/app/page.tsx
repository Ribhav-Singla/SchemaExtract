"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

const EXAMPLE_SCHEMA = `{
  "research_area": "",
  "application": "",
  "base_algorithm": "",
  "environment": "",
  "models_evaluated": [],
  "perception": [],
  "experimental_conditions": [],
  "main_finding": ""
}
`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z"
      />
    </svg>
  );
}

export default function Home() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [schema, setSchema] = useState(EXAMPLE_SCHEMA);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "top">("all");
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
    if (file && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
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
    setCopied(false);
    setActiveTab("all");

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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  const activeJson = result
    ? activeTab === "all"
      ? { total_chunks: result.total_chunks, chunks: result.chunks }
      : { top_k: result.top_k, threshold: result.threshold, chunks: result.ranked_chunks }
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
    const blob = new Blob([JSON.stringify(activeJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeTab === "all" ? "chunks.json" : "top-chunks.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-[#202522]">
      <header className="border-b border-[#202522]/15 px-6 py-5 sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center bg-[#202522] text-xs font-bold tracking-tight text-[#f4f1ea]">
              SE
            </span>
            <span className="text-sm font-semibold uppercase tracking-[0.2em]">Schema Extract</span>
          </div>
          <span className="hidden text-xs font-medium uppercase tracking-[0.2em] text-[#58615b] sm:block">
            PDF &rarr; Structured JSON
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-12 sm:px-10">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#b45d38]">Schema Extract</p>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-7xl">Turn a research paper into evidence.</h1>
        <p className="mt-5 max-w-xl text-lg text-[#58615b]">
          Upload a PDF, describe the fields you need, and retrieve the most relevant chunks &mdash; ranked by
          semantic, lexical, entity and structural signal.
        </p>

        <form onSubmit={analyse} className="mt-12 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="border-t-2 border-[#202522] pt-5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-[#b45d38]">01</span>
              <label className="text-sm font-semibold uppercase tracking-wider" htmlFor="pdf">
                Research PDF
              </label>
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
              className={`mt-4 flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed px-4 py-8 text-center transition ${
                dragActive
                  ? "border-[#b45d38] bg-[#b45d38]/5"
                  : "border-[#202522]/25 hover:border-[#202522]/50"
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
                <div className="flex w-full max-w-full items-center justify-between gap-3 bg-white px-4 py-3 text-left shadow-sm">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{pdf.name}</p>
                    <p className="text-xs text-[#58615b]">{formatBytes(pdf.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      pickFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="shrink-0 text-lg leading-none text-[#58615b] transition hover:text-[#b42318]"
                    aria-label="Remove file"
                  >
                    &times;
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm font-semibold">Drop a PDF here, or click to browse</span>
                  <span className="text-xs text-[#58615b]">One document at a time &middot; PDF only</span>
                </>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-8 flex w-full items-center justify-center gap-2 bg-[#202522] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#b45d38] disabled:cursor-wait disabled:opacity-50"
            >
              {loading && <Spinner />}
              {loading ? "Analysing..." : "Run analysis"}
            </button>

            {error && (
              <p className="mt-5 border-l-2 border-[#b42318] bg-[#b42318]/5 py-2 pl-3 text-sm text-[#b42318]">
                {error}
              </p>
            )}
          </div>

          <div className="border-t-2 border-[#202522] pt-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-[#b45d38]">02</span>
                <label className="text-sm font-semibold uppercase tracking-wider" htmlFor="schema">
                  Extraction schema
                </label>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${
                    schemaIsValid ? "text-[#3f7a4f]" : "text-[#b42318]"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${schemaIsValid ? "bg-[#3f7a4f]" : "bg-[#b42318]"}`}
                  />
                  {schemaIsValid ? "Valid JSON" : "Invalid JSON"}
                </span>
                <button
                  type="button"
                  onClick={() => setSchema(EXAMPLE_SCHEMA)}
                  className="text-xs font-semibold uppercase tracking-wide text-[#58615b] underline decoration-dotted underline-offset-4 transition hover:text-[#b45d38]"
                >
                  Reset
                </button>
              </div>
            </div>

            <textarea
              id="schema"
              value={schema}
              onChange={(event) => setSchema(event.target.value)}
              spellCheck={false}
              className="mt-4 min-h-72 w-full bg-[#202522] p-5 font-mono text-sm leading-6 text-[#f4f1ea] outline-none focus:ring-2 focus:ring-[#b45d38]"
            />
          </div>
        </form>

        {result !== null && activeJson !== null && (
          <section className="mt-12 border-t-2 border-[#202522] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold">Results</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={copyJson}
                  className="border border-[#202522]/25 px-4 py-2 text-xs font-semibold uppercase tracking-wide transition hover:border-[#202522] hover:bg-[#202522] hover:text-white"
                >
                  {copied ? "Copied" : "Copy JSON"}
                </button>
                <button
                  type="button"
                  onClick={downloadJson}
                  className="border border-[#202522]/25 px-4 py-2 text-xs font-semibold uppercase tracking-wide transition hover:border-[#202522] hover:bg-[#202522] hover:text-white"
                >
                  Download
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-px bg-[#202522]/15">
              <div className="bg-[#f4f1ea] px-5 py-4">
                <p className="text-3xl font-semibold tabular-nums">{String(result.total_chunks)}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#58615b]">Total chunks</p>
              </div>
              <div className="bg-[#f4f1ea] px-5 py-4">
                <p className="text-3xl font-semibold tabular-nums text-[#b45d38]">{String(result.top_k)}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#58615b]">Top matches</p>
              </div>
              <div className="bg-[#f4f1ea] px-5 py-4">
                <p className="text-3xl font-semibold tabular-nums">{String(result.threshold)}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[#58615b]">Threshold</p>
              </div>
            </div>

            <div className="mt-6 flex gap-6 border-b border-[#202522]/15">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`-mb-px border-b-2 pb-3 text-sm font-semibold uppercase tracking-wide transition ${
                  activeTab === "all"
                    ? "border-[#b45d38] text-[#202522]"
                    : "border-transparent text-[#58615b] hover:text-[#202522]"
                }`}
              >
                All chunks
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("top")}
                className={`-mb-px border-b-2 pb-3 text-sm font-semibold uppercase tracking-wide transition ${
                  activeTab === "top"
                    ? "border-[#b45d38] text-[#202522]"
                    : "border-transparent text-[#58615b] hover:text-[#202522]"
                }`}
              >
                Top matches
              </button>
            </div>

            <pre className="mt-4 max-h-[32rem] overflow-auto bg-white p-5 text-xs leading-5 shadow-sm ring-1 ring-[#202522]/10">
              {JSON.stringify(activeJson, null, 2)}
            </pre>
          </section>
        )}
      </section>

      <footer className="border-t border-[#202522]/15 px-6 py-8 sm:px-10">
        <p className="mx-auto max-w-6xl text-xs text-[#58615b]">
          Layered semantic retrieval &mdash; embeddings, TF&ndash;IDF, entity and structural scoring, blended
          into a single relevance rank.
        </p>
      </footer>
    </main>
  );
}
