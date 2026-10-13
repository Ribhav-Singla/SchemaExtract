"use client";

import { Braces, Check, FileJson } from "lucide-react";
import { useMemo, useState } from "react";

import { countLines, highlightJson } from "../lib/json-highlight";

interface JsonViewerProps {
  value: unknown;
  summaryLabel: string;
}

export default function JsonViewer({ value, summaryLabel }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const highlighted = useMemo(() => highlightJson(text), [text]);
  const lineNumbers = useMemo(
    () => Array.from({ length: countLines(text) }, (_, index) => index + 1),
    [text],
  );

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied by the browser; fail silently.
    }
  }

  return (
    <div className="json-panel overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="flex min-w-0 items-center gap-2 truncate font-mono text-xs text-muted">
          <Braces className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{summaryLabel}</span>
        </span>
        <button
          type="button"
          onClick={copyText}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted transition hover:border-border-strong hover:text-fg"
        >
          {copied ? (
            <Check className="h-3 w-3" strokeWidth={2} />
          ) : (
            <FileJson className="h-3 w-3" strokeWidth={1.75} />
          )}
          {copied ? "Copied" : "JSON"}
        </button>
      </div>

      <div className="thin-scrollbar max-h-[32rem] overflow-auto">
        <div className="flex min-w-max">
          <div className="sticky left-0 z-10 shrink-0 select-none bg-surface px-3 py-4 text-right font-mono text-xs leading-6 text-muted">
            {lineNumbers.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <pre
            className="flex-1 whitespace-pre px-4 py-4 font-mono text-xs leading-6"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </div>
      </div>
    </div>
  );
}
