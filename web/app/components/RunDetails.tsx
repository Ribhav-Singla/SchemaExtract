"use client";

import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

import JsonViewer from "./JsonViewer";

type FieldStage =
  | "not_extracted"
  | "missing_in_markdown"
  | "lost_in_chunking"
  | "lost_in_retrieval"
  | "not_in_top_k"
  | "found_in_top_k";

type Scores = {
  semantic: number;
  lexical: number;
  entity: number;
  structural: number;
  final: number;
};

type RunDetailsResponse = {
  id: string;
  extraction: {
    created_on: string;
    pdf_name: string;
    pdf_size: number;
    user_schema: unknown;
    top_k_chunks: Array<{
      chunkId?: string;
      section?: string;
      rank?: number;
      scores?: Scores;
      passesThreshold?: boolean;
      text?: string;
    }>;
    response: unknown;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | null;
    model?: string | null;
    custom_rules?: string;
  };
  trace: {
    cache_hit: boolean;
    timings: {
      pdf_to_markdown_ms: number;
      chunking_ms: number;
      retrieval_ms: number;
    };
    markdown: string;
    markdown_chars: number;
    markdown_truncated: boolean;
    headers: Array<{ headerId: number; heading: string; headingLevel: number }>;
    sections: Array<{
      sectionId: number;
      heading: string;
      headingLevel: number;
      charCount: number;
      preview: string;
    }>;
    chunks: Array<{
      chunkId: string;
      section: string;
      charCount: number;
      text: string;
    }>;
    chunks_truncated: boolean;
    top_k: number;
    threshold: number;
  } | null;
  fieldTrace: Array<{
    path: string;
    value: string | null;
    inMarkdown: boolean;
    inChunks: boolean;
    inTopK: boolean;
    stage: FieldStage;
  }>;
};

const STAGE_LABELS: Record<FieldStage, { label: string; className: string }> = {
  found_in_top_k: {
    label: "Found in top-K",
    className: "border-success/30 bg-success/10 text-success",
  },
  missing_in_markdown: {
    label: "Not in markdown (parsing or model)",
    className: "border-danger/30 bg-danger-soft text-danger",
  },
  lost_in_chunking: {
    label: "Lost in chunking",
    className: "border-danger/30 bg-danger-soft text-danger",
  },
  lost_in_retrieval: {
    label: "Lost in retrieval",
    className: "border-danger/30 bg-danger-soft text-danger",
  },
  not_in_top_k: {
    label: "Not in top-K",
    className: "border-danger/30 bg-danger-soft text-danger",
  },
  not_extracted: {
    label: "Not extracted",
    className: "border-border bg-surface-2 text-muted",
  },
};

function formatMs(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

function Check({ value }: { value: boolean }) {
  return value ? (
    <CheckCircle2 className="mx-auto h-4 w-4 text-success" aria-label="yes" />
  ) : (
    <XCircle className="mx-auto h-4 w-4 text-danger" aria-label="no" />
  );
}

function Stage({
  index,
  title,
  meta,
  children,
}: {
  index: number;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <li className="relative border-l border-border pb-6 pl-6 last:pb-0">
      <span className="absolute -left-3 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-surface text-xs font-semibold text-accent">
        {index}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {meta && <span className="font-mono text-xs text-muted">{meta}</span>}
      </div>
      <div className="mt-3 grid gap-3 text-sm">{children}</div>
    </li>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border bg-surface-2">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted hover:text-fg">
        {label}
      </summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}

function Stats({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-muted">{label}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function RunDetails({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<RunDetailsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // The parent keys this component by requestId, so state starts fresh.
    let cancelled = false;
    fetch(`/api/usage/${requestId}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load request");
        if (!cancelled) setDetails(body);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not load request",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trace = details?.trace ?? null;
  const extraction = details?.extraction;
  const chunkSizes = trace?.chunks.map((chunk) => chunk.charCount) ?? [];
  const extractedFields =
    details?.fieldTrace.filter((row) => row.stage !== "not_extracted") ?? [];
  const foundCount = extractedFields.filter((row) => row.inTopK).length;
  let stageIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close pipeline log"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <aside className="relative h-full w-full max-w-4xl overflow-y-auto border-l border-border bg-bg text-fg shadow-[var(--shadow-card)]">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-bg/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Pipeline log
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold">
              {extraction?.pdf_name ?? "Loading…"}
            </h2>
            {extraction && (
              <p className="font-mono text-xs text-muted">
                {new Date(extraction.created_on).toLocaleString()} · {details?.id}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border p-2 text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-6 sm:px-8">
          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          {!details && !error && (
            <div className="flex items-center justify-center py-20 text-sm text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading pipeline log
            </div>
          )}

          {details && extraction && (
            <>
              {!trace && (
                <p className="mb-6 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
                  This request was logged before stage tracing existed, so only
                  retrieval and extraction output are available.
                </p>
              )}

              <ol className="ml-3">
                <Stage index={++stageIndex} title="Input">
                  <Stats
                    items={[
                      ["PDF size", `${(extraction.pdf_size / 1024).toFixed(1)} KB`],
                      ["Cache hit", trace ? (trace.cache_hit ? "Yes" : "No") : "—"],
                    ]}
                  />
                  <JsonViewer value={extraction.user_schema} summaryLabel="Schema" />
                </Stage>

                {trace && (
                  <>
                    <Stage
                      index={++stageIndex}
                      title="Layer 1 · PDF → Markdown"
                      meta={formatMs(trace.timings.pdf_to_markdown_ms)}
                    >
                      <Stats
                        items={[
                          ["Characters", trace.markdown_chars.toLocaleString()],
                          ["Lines", trace.markdown.split("\n").length.toLocaleString()],
                        ]}
                      />
                      <Collapsible
                        label={`Markdown${trace.markdown_truncated ? " (truncated)" : ""}`}
                      >
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                          {trace.markdown}
                        </pre>
                      </Collapsible>
                    </Stage>

                    <Stage
                      index={++stageIndex}
                      title="Layer 1.5 · Markdown → Chunks"
                      meta={formatMs(trace.timings.chunking_ms)}
                    >
                      <Stats
                        items={[
                          ["Headers", trace.headers.length],
                          ["Sections", trace.sections.length],
                          ["Chunks", trace.chunks.length],
                          [
                            "Chunk size min / avg / max",
                            chunkSizes.length
                              ? `${Math.min(...chunkSizes)} / ${Math.round(
                                chunkSizes.reduce((a, b) => a + b, 0) / chunkSizes.length,
                              )} / ${Math.max(...chunkSizes)}`
                              : "—",
                          ],
                        ]}
                      />
                      <Collapsible label={`Headers (${trace.headers.length})`}>
                        <ul className="max-h-72 overflow-auto text-xs">
                          {trace.headers.map((header) => (
                            <li
                              key={header.headerId}
                              style={{ paddingLeft: `${(header.headingLevel - 1) * 12}px` }}
                              className="py-0.5"
                            >
                              <span className="font-mono text-muted">H{header.headingLevel}</span>{" "}
                              {header.heading}
                            </li>
                          ))}
                        </ul>
                      </Collapsible>
                      <Collapsible label={`Sections (${trace.sections.length})`}>
                        <ul className="max-h-72 divide-y divide-border overflow-auto text-xs">
                          {trace.sections.map((section) => (
                            <li key={section.sectionId} className="py-2">
                              <p className="font-semibold">
                                {section.heading || "(no heading)"}{" "}
                                <span className="font-normal text-muted">
                                  · {section.charCount.toLocaleString()} chars
                                </span>
                              </p>
                              <p className="mt-1 line-clamp-2 text-muted">{section.preview}</p>
                            </li>
                          ))}
                        </ul>
                      </Collapsible>
                      <Collapsible
                        label={`Chunks (${trace.chunks.length})${trace.chunks_truncated ? " · text truncated" : ""}`}
                      >
                        <ul className="max-h-96 divide-y divide-border overflow-auto text-xs">
                          {trace.chunks.map((chunk) => (
                            <li key={chunk.chunkId} className="py-2">
                              <p className="font-mono text-muted">
                                {chunk.chunkId} · {chunk.section} · {chunk.charCount} chars
                              </p>
                              <p className="mt-1 whitespace-pre-wrap break-words">{chunk.text}</p>
                            </li>
                          ))}
                        </ul>
                      </Collapsible>
                    </Stage>
                  </>
                )}

                <Stage
                  index={++stageIndex}
                  title="Layer 2 · Schema-based retrieval"
                  meta={trace ? formatMs(trace.timings.retrieval_ms) : undefined}
                >
                  <Stats
                    items={[
                      ["Top K returned", extraction.top_k_chunks.length],
                      ["Threshold", trace?.threshold ?? "—"],
                      [
                        "Passing threshold",
                        extraction.top_k_chunks.filter((chunk) => chunk.passesThreshold).length,
                      ],
                      ["Of total chunks", trace?.chunks.length ?? "—"],
                    ]}
                  />
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="border-b border-border bg-surface-2 uppercase tracking-wider text-muted">
                        <tr>
                          <th className="px-2 py-2">#</th>
                          <th className="px-2 py-2">Chunk</th>
                          <th className="px-2 py-2 text-right">Semantic</th>
                          <th className="px-2 py-2 text-right">Lexical</th>
                          <th className="px-2 py-2 text-right">Entity</th>
                          <th className="px-2 py-2 text-right">Struct.</th>
                          <th className="px-2 py-2 text-right">Final</th>
                          <th className="px-2 py-2 text-center">Pass</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {extraction.top_k_chunks.map((chunk, index) => (
                          <tr key={`${chunk.chunkId}-${index}`} title={chunk.text}>
                            <td className="px-2 py-1.5 tabular-nums">{chunk.rank ?? index + 1}</td>
                            <td className="max-w-56 truncate px-2 py-1.5">
                              <span className="font-mono">{chunk.chunkId}</span>{" "}
                              <span className="text-muted">{chunk.section}</span>
                            </td>
                            {(["semantic", "lexical", "entity", "structural", "final"] as const).map(
                              (key) => (
                                <td
                                  key={key}
                                  className={`px-2 py-1.5 text-right tabular-nums ${key === "final" ? "font-semibold" : ""}`}
                                >
                                  {chunk.scores?.[key]?.toFixed(3) ?? "—"}
                                </td>
                              ),
                            )}
                            <td className="px-2 py-1.5">
                              <Check value={Boolean(chunk.passesThreshold)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Stage>

                <Stage index={++stageIndex} title="Layer 3 · LLM extraction" meta={extraction.model ?? undefined}>
                  <Stats
                    items={[
                      ["Prompt tokens", extraction.usage?.prompt_tokens ?? 0],
                      ["Completion tokens", extraction.usage?.completion_tokens ?? 0],
                      ["Total tokens", extraction.usage?.total_tokens ?? 0],
                      ["Custom rules", extraction.custom_rules ? "Yes" : "No"],
                    ]}
                  />
                  {extraction.custom_rules && (
                    <Collapsible label="Custom rules">
                      <pre className="whitespace-pre-wrap font-mono text-xs">{extraction.custom_rules}</pre>
                    </Collapsible>
                  )}
                  <JsonViewer value={extraction.response} summaryLabel="Extracted JSON" />
                </Stage>
              </ol>

              <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">Stage evaluation</h3>
                  <span className="text-sm text-muted">
                    <strong className="text-fg">{foundCount}</strong> /{" "}
                    {extractedFields.length} extracted values traced to the top-K chunks
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Each extracted value is searched for in every layer&apos;s output
                  (case and punctuation ignored). The first layer missing it is where
                  it was lost. A value missing everywhere was either reformatted by
                  the rules or not literally in the document.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-b border-border text-xs uppercase tracking-wider text-muted">
                      <tr>
                        <th className="px-2 py-2">Field</th>
                        <th className="px-2 py-2">Value</th>
                        {trace && <th className="px-2 py-2 text-center">Markdown</th>}
                        {trace && <th className="px-2 py-2 text-center">Chunks</th>}
                        <th className="px-2 py-2 text-center">Top-K</th>
                        <th className="px-2 py-2">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {details.fieldTrace.map((row) => (
                        <tr key={row.path}>
                          <td className="px-2 py-2 font-mono text-xs">{row.path}</td>
                          <td className="max-w-56 truncate px-2 py-2" title={row.value ?? ""}>
                            {row.value ?? <span className="text-muted">null</span>}
                          </td>
                          {row.stage === "not_extracted" ? (
                            <td colSpan={trace ? 3 : 1} className="px-2 py-2 text-center text-muted">
                              —
                            </td>
                          ) : (
                            <>
                              {trace && <td className="px-2 py-2"><Check value={row.inMarkdown} /></td>}
                              {trace && <td className="px-2 py-2"><Check value={row.inChunks} /></td>}
                              <td className="px-2 py-2"><Check value={row.inTopK} /></td>
                            </>
                          )}
                          <td className="px-2 py-2">
                            <span
                              className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STAGE_LABELS[row.stage].className}`}
                            >
                              {STAGE_LABELS[row.stage].label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {details.fieldTrace.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted">No extracted fields.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
