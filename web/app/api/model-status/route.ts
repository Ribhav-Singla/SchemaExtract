import { NextResponse } from "next/server";

import { EMBEDDING_MODEL, warmEmbeddingModel } from "../../../lib/src/retriever";

export const runtime = "nodejs";

export async function GET() {
  const startedAt = performance.now();

  try {
    await warmEmbeddingModel();
    return NextResponse.json({ ready: true, model: EMBEDDING_MODEL });
  } catch (error) {
    return NextResponse.json(
      {
        ready: false,
        model: EMBEDDING_MODEL,
        error: error instanceof Error ? error.message : "Model warm-up failed",
      },
      { status: 503 },
    );
  }
}