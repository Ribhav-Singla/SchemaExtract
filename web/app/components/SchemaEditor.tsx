"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { countLines, highlightJson } from "../lib/json-highlight";

interface SchemaEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}

export default function SchemaEditor({ id, value, onChange }: SchemaEditorProps) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const highlighted = useMemo(() => highlightJson(value), [value]);
  const lineCount = useMemo(() => countLines(value), [value]);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount],
  );

  function syncScroll(target: HTMLTextAreaElement) {
    if (preRef.current) {
      preRef.current.scrollTop = target.scrollTop;
      preRef.current.scrollLeft = target.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = target.scrollTop;
    }
  }

  async function copySchema() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied by the browser; fail silently.
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-editor-bg shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={copySchema}
        aria-label="Copy schema JSON"
        className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-editor-fg/70 backdrop-blur transition hover:bg-white/10 hover:text-editor-fg"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </button>

      <div className="flex h-72">
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="w-12 shrink-0 select-none overflow-hidden py-5 pr-3 text-right font-mono text-sm leading-6 text-editor-line"
        >
          {lineNumbers.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <pre
            ref={preRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre py-5 pr-5 font-mono text-sm leading-6 text-editor-fg thin-scrollbar"
            dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }}
          />
          <textarea
            ref={textareaRef}
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onScroll={(event) => syncScroll(event.currentTarget)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="thin-scrollbar absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent py-5 pr-5 font-mono text-sm leading-6 text-transparent caret-editor-fg outline-none"
          />
        </div>
      </div>
    </div>
  );
}
