import { Braces, Sparkles } from "lucide-react";

const TEXT_LINE_WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2"];

const SCHEMA_FIELDS = [
  { key: "w-10", value: "w-16" },
  { key: "w-8", value: "w-20" },
  { key: "w-12", value: "w-12" },
  { key: "w-9", value: "w-14" },
];

const CONNECTOR_PATH = "M110 70 C 160 40, 190 90, 220 90";

export default function HeroIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden h-56 w-full max-w-sm shrink-0 select-none lg:block"
    >
      <Sparkles
        className="animate-sparkle absolute right-1 top-0 h-5 w-5 text-accent"
        strokeWidth={1.5}
      />

      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 320 220"
        fill="none"
      >
        <path
          d={CONNECTOR_PATH}
          stroke="var(--border-strong)"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          className="animate-dash-flow"
        />
        {/* Traveling pulse: sells the "content flowing from PDF into schema" motion. */}
        <circle r="3.5" fill="var(--accent)">
          <animateMotion dur="2.2s" repeatCount="indefinite" path={CONNECTOR_PATH} />
        </circle>
      </svg>

      {/* Source document: plain paragraph lines. */}
      <div className="absolute left-4 top-6 flex h-40 w-32 rotate-[-6deg] flex-col gap-2.5 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-border">
        {TEXT_LINE_WIDTHS.map((width, index) => (
          <span
            key={width}
            className={`h-2 rounded-full bg-border-strong ${width} ${index === 0 ? "opacity-80" : "opacity-50"}`}
          />
        ))}

        <span className="absolute -bottom-3 -left-3 rounded-lg bg-fg px-2.5 py-1.5 text-[10px] font-bold tracking-wide text-bg shadow-[var(--shadow-card)]">
          PDF
        </span>
      </div>

      {/* Extracted schema: key/value stubs pop in on a loop, as if fields are being filled. */}
      <div className="animate-float-slow absolute right-3 top-16 flex h-36 w-40 rotate-[4deg] flex-col justify-center gap-2.5 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-border">
        {SCHEMA_FIELDS.map((field, index) => (
          <div
            key={field.key}
            className="animate-field-pop flex items-center gap-1.5"
            style={{ animationDelay: `${index * 0.35}s` }}
          >
            <span className={`h-2 shrink-0 rounded-full bg-accent ${field.key}`} />
            <span className={`h-2 rounded-full bg-border-strong ${field.value}`} />
          </div>
        ))}

        <span className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 shadow-[var(--shadow-card)] ring-1 ring-border">
          <Braces className="h-4 w-4 text-accent" strokeWidth={2} />
        </span>
      </div>
    </div>
  );
}
