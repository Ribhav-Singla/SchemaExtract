import { NextRequest } from "next/server";

import { runPreparePipeline } from "../../../lib/analysis-pipeline";

export const runtime = "nodejs";

// Runs the schema-independent work (PDF -> chunks -> chunk embeddings) as soon
// as a file is picked, so the later /api/analyse call only has to rank chunks.
// Progress is streamed as NDJSON so the upload bar can finish the moment
// Layers 1 + 1.5 are done:
//   {"stage":"chunked","total_chunks":N}  -> PDF parsed and chunked
//   {"stage":"ready","total_chunks":N}    -> chunk embeddings cached too
//   {"stage":"failed","error":"..."}
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        const result = await runPreparePipeline(request, (totalChunks) =>
          send({ stage: "chunked", total_chunks: totalChunks }),
        );
        send({ stage: "ready", ...result });
      } catch (error) {
        console.error("PDF preparation failed", error);
        send({
          stage: "failed",
          error: error instanceof Error
            ? error.message
            : "PDF preparation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // no-transform keeps compression from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
