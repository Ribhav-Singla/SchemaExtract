"use client";

import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Cpu,
  FileText,
  LockKeyhole,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ThemeToggle from "../components/ThemeToggle";

type UsageResponse = {
  summary: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalPdfBytes: number;
  };
  byDay: Array<{
    _id: string;
    requests: number;
    totalTokens: number;
  }>;
  requests: Array<{
    createdOn: string;
    pdfName: string;
    model?: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
};

type SystemMetrics = {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    usage: number;
  };
  disk: {
    usedBytes: number;
    totalBytes: number;
    usage: number;
    path: string;
  };
  hostname: string;
  platform: string;
  updatedAt: string;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function emptyUsage(): UsageResponse {
  return {
    summary: {
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalPdfBytes: 0,
    },
    byDay: [],
    requests: [],
  };
}

function ProgressBar({
  value,
  color = "bg-accent",
}: {
  value: number;
  color?: string;
}) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export default function DashboardPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [usage, setUsage] = useState<UsageResponse>(emptyUsage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(
    null,
  );
  const [systemError, setSystemError] = useState("");
  const [systemLoading, setSystemLoading] = useState(false);

  const loadUsage = useCallback(
    async (event?: FormEvent, showLoading = true) => {
      event?.preventDefault();
      if (showLoading) setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (from) params.set("from", `${from}T00:00:00`);
      if (to) params.set("to", `${to}T23:59:59.999`);
      if (pdfName.trim()) params.set("pdf_name", pdfName.trim());

      try {
        const response = await fetch(`/api/usage?${params.toString()}`);
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Could not load usage data");
        setUsage(body);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load usage data",
        );
      } finally {
        setLoading(false);
      }
    },
    [from, pdfName, to],
  );

  const loadSystemMetrics = useCallback(async () => {
    setSystemLoading(true);
    setSystemError("");
    try {
      const response = await fetch("/api/dashboard/system");
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not load system metrics");
      setSystemMetrics(body);
    } catch (requestError) {
      setSystemError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load system metrics",
      );
    } finally {
      setSystemLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const systemTimer = window.setTimeout(() => {
      void loadSystemMetrics();
    }, 0);
    const usageTimer = window.setTimeout(() => {
      void loadUsage(undefined, false);
    }, 0);
    return () => {
      window.clearTimeout(systemTimer);
      window.clearTimeout(usageTimer);
    };
  }, [authenticated, loadSystemMetrics, loadUsage]);

  const chartRows = usage.byDay.slice(-14);
  const maxRequests = Math.max(1, ...chartRows.map((day) => day.requests));
  const requestRows = usage.requests;
  const requestChartRows = requestRows.slice(0, 40).reverse();
  const requestChartData = requestChartRows.map((request) => ({
    ...request,
    displayTime: new Date(request.createdOn).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
  const avgTokensPerRequest = usage.summary.totalRequests
    ? usage.summary.totalTokens / usage.summary.totalRequests
    : 0;

  function login(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    if (
      username !== process.env.NEXT_PUBLIC_DASHBOARD_USERNAME ||
      password !== process.env.NEXT_PUBLIC_DASHBOARD_PASSWORD
    ) {
      setLoginError("Invalid username or password");
      return;
    }
    setAuthenticated(true);
    setPassword("");
  }

  function logout() {
    setAuthenticated(false);
    setSystemMetrics(null);
    setUsage(emptyUsage());
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-fg">
        <form
          onSubmit={login}
          className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-[var(--shadow-card)]"
        >
          <div className="mb-8 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <LockKeyhole className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Schema Extract
              </p>
              <h1 className="mt-1 text-2xl font-semibold">Dashboard login</h1>
            </div>
          </div>
          <p className="mb-6 text-sm text-muted">
            Sign in to view extraction usage and request data.
          </p>
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Username
            <input
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="mt-4 grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Password
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal text-fg outline-none focus:border-accent"
            />
          </label>
          {loginError && (
            <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {loginError}
            </p>
          )}
          <button
            type="submit"
            className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="border-b border-border bg-bg/90 px-6 py-4 backdrop-blur sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-accent"
          >
            <span>Schema Extract</span>
            <span className="h-px w-8 bg-accent" />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted transition hover:text-fg sm:flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Extractor
            </Link>
            <ThemeToggle />
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted transition hover:border-border-strong hover:bg-surface-2 hover:text-fg"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              <BarChart3 className="h-4 w-4" /> Usage overview
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Extraction dashboard
            </h1>
            <p className="mt-3 max-w-xl text-muted">
              Track Claude extraction activity, token usage, and document
              volume.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadUsage()}
            className="flex items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold transition hover:border-accent hover:bg-surface-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{" "}
            Refresh
          </button>
        </div>

        <form
          onSubmit={loadUsage}
          className="mt-8 grid gap-4 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end"
        >
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            From
            <span className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent"
              />
            </span>
          </label>
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            To
            <span className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent"
              />
            </span>
          </label>
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            PDF name
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                value={pdfName}
                onChange={(event) => setPdfName(event.target.value)}
                placeholder="Filter by file name"
                className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
              />
            </span>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Apply filters
          </button>
        </form>

        {error && (
          <p className="mt-5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-accent" />
                <h2 className="font-semibold">Server configuration</h2>
              </div>
              <p className="mt-1 text-sm text-muted">
                Live resource usage for the server running Schema Extract.
              </p>
            </div>
            <div className="flex items-center gap-4">
              {systemMetrics && (
                <div className="text-right text-xs text-muted">
                  <p>{systemMetrics.hostname}</p>
                  <p>{systemMetrics.platform}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => void loadSystemMetrics()}
                disabled={systemLoading}
                className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted transition hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${systemLoading ? "animate-spin" : ""}`} />
                Refresh server
              </button>
            </div>
          </div>

          {systemError && (
            <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {systemError}
            </p>
          )}
          {!systemMetrics && !systemError ? (
            <div className="mt-8 flex items-center justify-center text-sm text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Reading server metrics
            </div>
          ) : systemMetrics ? (
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                      CPU usage
                    </p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {systemMetrics.cpu.usage}%
                    </p>
                  </div>
                  <Cpu className="h-5 w-5 text-accent" />
                </div>
                <ProgressBar value={systemMetrics.cpu.usage} />
                <p
                  className="mt-3 truncate text-xs text-muted"
                  title={systemMetrics.cpu.model}
                >
                  {systemMetrics.cpu.cores} cores · {systemMetrics.cpu.model}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Memory
                    </p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {systemMetrics.memory.usage}%
                    </p>
                  </div>
                  <Activity className="h-5 w-5 text-success" />
                </div>
                <ProgressBar
                  value={systemMetrics.memory.usage}
                  color="bg-success"
                />
                <p className="mt-3 text-xs text-muted">
                  {formatBytes(systemMetrics.memory.usedBytes)} /{" "}
                  {formatBytes(systemMetrics.memory.totalBytes)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Disk space
                    </p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {systemMetrics.disk.usage}%
                    </p>
                  </div>
                  <BarChart3 className="h-5 w-5 text-[#8a6bc4]" />
                </div>
                <ProgressBar
                  value={systemMetrics.disk.usage}
                  color="bg-[#8a6bc4]"
                />
                <p className="mt-3 text-xs text-muted">
                  {formatBytes(systemMetrics.disk.usedBytes)} /{" "}
                  {formatBytes(systemMetrics.disk.totalBytes)}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <article className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-[#d97757]" />
              <div>
                <h2 className="font-semibold">Claude</h2>
                <p className="text-xs text-muted">
                  {loading ? "Updating usage data..." : "Anthropic Claude API"}
                </p>
              </div>
            </div>
            <Sparkles className="h-4 w-4 text-accent" />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(usage.summary.totalRequests)}
              </p>
              <p className="text-xs uppercase tracking-wide text-muted">
                Requests
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(usage.summary.totalTokens)}
              </p>
              <p className="text-xs uppercase tracking-wide text-muted">
                Tokens
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(avgTokensPerRequest)}
              </p>
              <p className="text-xs uppercase tracking-wide text-muted">
                Avg. tokens / request
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {formatBytes(usage.summary.totalPdfBytes)}
              </p>
              <p className="text-xs uppercase tracking-wide text-muted">
                PDF volume
              </p>
            </div>
          </div>
          <div className="mt-5 border-t border-border pt-4 text-xs text-muted">
            <span className="font-medium text-fg">
              {formatNumber(usage.summary.totalPromptTokens)}
            </span>{" "}
            prompt /{" "}
            <span className="font-medium text-fg">
              {formatNumber(usage.summary.totalCompletionTokens)}
            </span>{" "}
            completion tokens
          </div>
        </article>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Requests by day</h2>
              <p className="mt-1 text-sm text-muted">
                Showing the most recent 14 active days in the selected range.
              </p>
            </div>
            <Activity className="h-5 w-5 text-accent" />
          </div>
          {loading ? (
            <div className="flex h-56 items-center justify-center text-muted">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading chart
            </div>
          ) : chartRows.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted">
              No usage found for these filters.
            </div>
          ) : (
            <div className="mt-8 flex h-64 items-end gap-2 overflow-x-auto border-b border-border pb-0">
              {chartRows.map((day) => (
                <div
                  key={day._id}
                  className="flex min-w-12 flex-1 flex-col items-center gap-2"
                >
                  <div className="flex h-48 w-full items-end justify-center gap-1">
                    <div
                      title={`${day.requests} requests`}
                      className="min-w-2 flex-1 max-w-5 rounded-t bg-[#d97757] transition-all"
                      style={{
                        height: `${Math.max(day.requests ? 5 : 0, (day.requests / maxRequests) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted">{day._id.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Token usage per request</h2>
              <p className="mt-1 text-sm text-muted">
                Hover any point to inspect that request.
              </p>
            </div>
            <Activity className="h-5 w-5 text-accent" />
          </div>
          {loading ? (
            <div className="flex h-56 items-center justify-center text-muted">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading request
              data
            </div>
          ) : requestChartRows.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted">
              No request data for these filters.
            </div>
          ) : (
            <div className="mt-8 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={requestChartData}
                  margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                >
                  <CartesianGrid
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="displayTime"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={55}
                    tickFormatter={(value: number) => formatNumber(value)}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border-strong)" }}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: "0.75rem",
                      color: "var(--fg)",
                      boxShadow: "var(--shadow-card)",
                    }}
                    labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
                    formatter={(value) => [
                      formatNumber(Number(value ?? 0)),
                      "Total tokens",
                    ]}
                    labelFormatter={(_, payload) => {
                      const request = payload?.[0]?.payload as
                        | (typeof requestChartData)[number]
                        | undefined;
                      return request
                        ? new Date(request.createdOn).toLocaleString()
                        : "";
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalTokens"
                    stroke="var(--accent)"
                    strokeWidth={2.5}
                    dot={{
                      r: 4,
                      fill: "var(--accent)",
                      stroke: "var(--surface)",
                      strokeWidth: 2,
                    }}
                    activeDot={{
                      r: 6,
                      fill: "var(--accent)",
                      stroke: "var(--surface)",
                      strokeWidth: 2,
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <span>{requestRows.length} filtered requests</span>
            <span>Showing up to 40 latest requests</span>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" />
            <h2 className="font-semibold">Daily detail</h2>
          </div>
          <div className="mt-4 divide-y divide-border">
            {usage.byDay
              .slice(-5)
              .reverse()
              .map((day) => (
                <div
                  key={day._id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span className="font-mono text-xs text-muted">
                    {day._id}
                  </span>
                  <span className="tabular-nums">
                    <strong>{formatNumber(day.requests)}</strong> requests{" "}
                    <span className="text-muted">
                      · {formatNumber(day.totalTokens)} tokens
                    </span>
                  </span>
                </div>
              ))}
            {usage.byDay.length === 0 && (
              <p className="py-4 text-sm text-muted">No daily data.</p>
            )}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" />
            <h2 className="font-semibold">Request details</h2>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-3 font-semibold">Time</th>
                  <th className="px-3 py-3 font-semibold">PDF</th>
                  <th className="px-3 py-3 font-semibold">Model</th>
                  <th className="px-3 py-3 text-right font-semibold">Prompt</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Completion
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requestRows.slice(0, 100).map((request, index) => (
                  <tr
                    key={`${request.createdOn}-${index}`}
                    className="transition hover:bg-surface-2"
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted">
                      {new Date(request.createdOn).toLocaleString()}
                    </td>
                    <td
                      className="max-w-48 truncate px-3 py-3"
                      title={request.pdfName}
                    >
                      {request.pdfName}
                    </td>
                    <td className="max-w-40 truncate px-3 py-3 font-mono text-xs text-muted">
                      {request.model ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatNumber(request.promptTokens)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatNumber(request.completionTokens)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {formatNumber(request.totalTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!requestRows.length && (
              <p className="py-8 text-center text-sm text-muted">
                No request data.
              </p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
