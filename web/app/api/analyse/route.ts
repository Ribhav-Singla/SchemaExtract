import { NextRequest, NextResponse } from "next/server";

import {
  PipelineRequestError,
  runAnalysisPipeline,
} from "./pipeline";

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
