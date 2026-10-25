import { NextRequest, NextResponse } from "next/server";

import { getSchemaExtractDatabase } from "../../../lib/mongodb";
import { logExtractionUsage } from "../../../lib/usage-logging";

export const runtime = "nodejs";

function parseDateParam(value: string | null, paramName: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`"${paramName}" must be a valid date`);
  }
  return parsed;
}

type UsageSummary = {
  totalRequests?: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalTokens?: number;
  totalPdfBytes?: number;
};

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const from = parseDateParam(params.get("from"), "from");
    const to = parseDateParam(params.get("to"), "to");
    const pdfName = params.get("pdf_name");
    // Older rows from removed providers stay in the collection; only report Claude.
    const match: Record<string, unknown> = { provider: "claude" };

    if (from || to) {
      const createdOn: Record<string, Date> = {};
      if (from) createdOn.$gte = from;
      if (to) createdOn.$lte = to;
      match.created_on = createdOn;
    }
    if (pdfName) match.pdf_name = pdfName;

    const database = await getSchemaExtractDatabase();
    const [result] = await database.collection("extractions").aggregate([
      { $match: match },
      {
        $facet: {
          summaries: [{
            $group: {
              _id: null,
              totalRequests: { $sum: 1 },
              totalPromptTokens: { $sum: { $ifNull: ["$usage.prompt_tokens", 0] } },
              totalCompletionTokens: { $sum: { $ifNull: ["$usage.completion_tokens", 0] } },
              totalTokens: { $sum: { $ifNull: ["$usage.total_tokens", 0] } },
              totalPdfBytes: { $sum: { $ifNull: ["$pdf_size", 0] } },
            },
          }],
          byDay: [{
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_on" } },
              requests: { $sum: 1 },
              totalTokens: { $sum: { $ifNull: ["$usage.total_tokens", 0] } },
            },
          }, { $sort: { _id: 1 } }],
          requests: [
            { $sort: { created_on: -1 } },
            { $limit: 250 },
            {
              $project: {
                _id: 0,
                id: { $toString: "$_id" },
                hasTrace: { $ne: [{ $ifNull: ["$trace_id", null] }, null] },
                createdOn: "$created_on",
                pdfName: "$pdf_name",
                model: 1,
                promptTokens: { $ifNull: ["$usage.prompt_tokens", 0] },
                completionTokens: { $ifNull: ["$usage.completion_tokens", 0] },
                totalTokens: { $ifNull: ["$usage.total_tokens", 0] },
              },
            },
          ],
        },
      },
    ]).toArray();

    const summary = (result?.summaries?.[0] ?? {}) as UsageSummary;

    return NextResponse.json({
      range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      summary: {
        totalRequests: summary.totalRequests ?? 0,
        totalPromptTokens: summary.totalPromptTokens ?? 0,
        totalCompletionTokens: summary.totalCompletionTokens ?? 0,
        totalTokens: summary.totalTokens ?? 0,
        totalPdfBytes: summary.totalPdfBytes ?? 0,
      },
      byDay: result?.byDay ?? [],
      requests: result?.requests ?? [],
    });
  } catch (error) {
    console.error("Usage aggregation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Usage aggregation failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (
      typeof body.pdf_name !== "string" ||
      !Number.isInteger(body.pdf_size) ||
      typeof body.user_schema !== "object" ||
      !Array.isArray(body.top_k_chunks)
    ) {
      return NextResponse.json({ error: "Invalid usage log payload" }, { status: 400 });
    }

    await logExtractionUsage({
      pdfName: body.pdf_name,
      pdfSize: body.pdf_size,
      userSchema: body.user_schema,
      topKChunks: body.top_k_chunks,
      response: body.response,
      usage: body.usage,
      model: body.model,
      customRules: body.custom_rules,
      traceId: typeof body.trace_id === "string" ? body.trace_id : null,
    });

    return NextResponse.json({ logged: true });
  } catch (error) {
    console.error("Extraction usage logging failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Usage logging failed" },
      { status: 500 },
    );
  }
}
