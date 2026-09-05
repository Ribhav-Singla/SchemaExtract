export type ServerLogger = {
  stage: (name: string, details?: Record<string, unknown>) => void;
  error: (name: string, details?: Record<string, unknown>) => void;
};

export function createServerLogger(requestId: string): ServerLogger {
  const startedAt = performance.now();

  function write(level: "info" | "error", event: string, details: Record<string, unknown> = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      request_id: requestId,
      elapsed_ms: Math.round(performance.now() - startedAt),
      ...details,
    };

    if (level === "error") console.error(JSON.stringify(entry));
    else console.info(JSON.stringify(entry));
  }

  return {
    stage: (name, details) => write("info", "analysis_stage", { stage: name, ...details }),
    error: (name, details) => write("error", name, details),
  };
}