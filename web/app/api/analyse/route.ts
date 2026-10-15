import { EMBEDDING_MODEL, warmEmbeddingModel } from "../../../lib/src/retriever";
import { NextRequest, NextResponse } from "next/server";

import {
  PipelineRequestError,
  runAnalysisPipeline,
} from "../../../lib/analysis-pipeline";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { result } = await runAnalysisPipeline(request);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof PipelineRequestError ? error.status : 500;
    console.error("Pipeline analysis failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Pipeline analysis failed",
      },
      { status },
    );
  }
}

export async function GET() {
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