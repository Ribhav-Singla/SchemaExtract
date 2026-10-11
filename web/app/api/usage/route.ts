import { NextRequest, NextResponse } from "next/server";

import { getSchemaExtractDatabase } from "../../../lib/mongodb";

export const runtime = "nodejs";

function parseDateParam(value: string | null, paramName: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`"${paramName}" must be a valid date`);
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const from = parseDateParam(params.get("from"), "from");
    const to = parseDateParam(params.get("to"), "to");
    const pdfName = params.get("pdf_name");
    const match: Record<string, unknown> = {};

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
          summary: [{
            $group: {
              _id: null,
              totalRequests: { $sum: 1 },
              totalNeurons: { $sum: { $ifNull: ["$response.usage.neurons", 0] } },
              totalPromptTokens: { $sum: { $ifNull: ["$response.usage.prompt_tokens", 0] } },
              totalCompletionTokens: { $sum: { $ifNull: ["$response.usage.completion_tokens", 0] } },
              totalTokens: { $sum: { $ifNull: ["$response.usage.total_tokens", 0] } },
              totalPdfBytes: { $sum: { $ifNull: ["$pdf_size", 0] } },
              puterRequests: { $sum: { $cond: [{ $eq: ["$provider", "puter"] }, 1, 0] } },
              workerRequests: { $sum: { $cond: [{ $eq: ["$provider", "worker"] }, 1, 0] } },
            },
          }],
          byDay: [
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_on" } },
                requests: { $sum: 1 },
                puterRequests: { $sum: { $cond: [{ $eq: ["$provider", "puter"] }, 1, 0] } },
                workerRequests: { $sum: { $cond: [{ $eq: ["$provider", "worker"] }, 1, 0] } },
                neurons: { $sum: { $ifNull: ["$response.usage.neurons", 0] } },
                totalTokens: { $sum: { $ifNull: ["$response.usage.total_tokens", 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]).toArray();

    const summary = result?.summary?.[0] ?? {};
    return NextResponse.json({
      range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      summary: {
        totalRequests: summary.totalRequests ?? 0,
        puterRequests: summary.puterRequests ?? 0,
        workerRequests: summary.workerRequests ?? 0,
        totalNeurons: summary.totalNeurons ?? 0,
        avgNeuronsPerRequest: summary.totalRequests ? summary.totalNeurons / summary.totalRequests : 0,
        totalPromptTokens: summary.totalPromptTokens ?? 0,
        totalCompletionTokens: summary.totalCompletionTokens ?? 0,
        totalTokens: summary.totalTokens ?? 0,
        totalPdfBytes: summary.totalPdfBytes ?? 0,
      },
      byDay: result?.byDay ?? [],
    });
  } catch (error) {
    console.error("Usage aggregation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Usage aggregation failed" },
      { status: 500 },
    );
  }
}
