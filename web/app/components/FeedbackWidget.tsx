"use client";

import { MessageCircle, Send, X } from "lucide-react";
import { useState } from "react";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  function submitFeedback() {
    if (!message.trim()) {
      return;
    }

    // No feedback backend exists yet — just acknowledge locally.
    setSent(true);
    setMessage("");
    setTimeout(() => setSent(false), 2000);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      <div
        aria-hidden={!open}
        className={`absolute bottom-[calc(100%+0.75rem)] right-0 w-[calc(100vw-2rem)] max-w-sm origin-bottom-right rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-card)] transition-all duration-200 ease-out sm:w-80 ${
          open
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-95 opacity-0"
        }`}
      >
        <span
          aria-hidden="true"
          className="animate-sparkle absolute -right-1.5 -top-1.5 text-accent"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2 L14 9 L21 11 L14 13 L12 20 L10 13 L3 11 L10 9 Z"
              fill="currentColor"
            />
          </svg>
        </span>

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageCircle
              className="h-4 w-4 text-accent"
              strokeWidth={2}
              fill="var(--accent-soft)"
            />
            <h3 className="text-sm font-semibold text-fg">Send Feedback</h3>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close feedback panel"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-muted">
          We&apos;d love to hear your thoughts! Help us improve Schema
          Extract.
        </p>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={sent ? "Thanks for your feedback!" : "Share your feedback..."}
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-border bg-surface-2 p-3 text-sm text-fg placeholder:text-muted outline-none transition focus:border-accent"
        />

        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            onClick={submitFeedback}
            disabled={!message.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-fg px-4 py-2 text-xs font-semibold uppercase tracking-wide text-bg transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
            Send
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close feedback" : "Open feedback"}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-fg text-bg shadow-[var(--shadow-card)] transition hover:bg-accent"
      >
        {open ? (
          <X className="h-5 w-5" strokeWidth={2} />
        ) : (
          <MessageCircle className="h-5 w-5" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
