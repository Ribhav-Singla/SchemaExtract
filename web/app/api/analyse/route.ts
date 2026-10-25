import { NextRequest, NextResponse } from "next/server";

import {
  PipelineRequestError,
  runAnalysisPipeline,
} from "../../../lib/analysis-pipeline";
import { savePipelineTrace } from "../../../lib/pipeline-trace";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { result, pdfName, pdfSize, schema } =
      await runAnalysisPipeline(request);

    // Best-effort: a Mongo outage must not fail the analysis itself.
    const traceId = await savePipelineTrace({ pdfName, pdfSize, schema, result })
      .catch((error) => {
        console.error("Saving pipeline trace failed", error);
        return null;
      });

    // The trace (full markdown etc.) stays server-side; the dashboard reads it
    // back by trace_id.
    return NextResponse.json({ ...result, trace: undefined, trace_id: traceId });
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
