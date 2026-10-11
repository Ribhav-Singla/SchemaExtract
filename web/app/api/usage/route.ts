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

type ProviderSummary = {
  _id?: string;
  totalRequests?: number;
  totalNeurons?: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalTokens?: number;
  totalPdfBytes?: number;
};

type ProviderDay = {
  _id: { provider: string; day: string };
  requests: number;
  neurons: number;
  totalTokens: number;
};

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
          summaries: [{
            $group: {
              _id: "$provider",
              totalRequests: { $sum: 1 },
              totalNeurons: { $sum: { $ifNull: ["$response.usage.neurons", 0] } },
              totalPromptTokens: { $sum: { $ifNull: ["$usage.prompt_tokens", { $ifNull: ["$response.usage.prompt_tokens", 0] }] } },
              totalCompletionTokens: { $sum: { $ifNull: ["$usage.completion_tokens", { $ifNull: ["$response.usage.completion_tokens", 0] }] } },
              totalTokens: { $sum: { $ifNull: ["$usage.total_tokens", { $ifNull: ["$response.usage.total_tokens", 0] }] } },
              totalPdfBytes: { $sum: { $ifNull: ["$pdf_size", 0] } },
            },
          }],
          byDay: [{
            $group: {
              _id: {
                provider: "$provider",
                day: { $dateToString: { format: "%Y-%m-%d", date: "$created_on" } },
              },
              requests: { $sum: 1 },
              neurons: { $sum: { $ifNull: ["$usage.neurons", { $ifNull: ["$response.usage.neurons", 0] }] } },
              totalTokens: { $sum: { $ifNull: ["$usage.total_tokens", { $ifNull: ["$response.usage.total_tokens", 0] }] } },
            },
          }, { $sort: { "_id.day": 1 } }],
          requests: [
            { $sort: { created_on: -1 } },
            { $limit: 250 },
            {
              $project: {
                _id: 0,
                provider: 1,
                createdOn: "$created_on",
                pdfName: "$pdf_name",
                model: 1,
                promptTokens: {
                  $ifNull: ["$usage.prompt_tokens", { $ifNull: ["$response.usage.prompt_tokens", 0] }],
                },
                completionTokens: {
                  $ifNull: ["$usage.completion_tokens", { $ifNull: ["$response.usage.completion_tokens", 0] }],
                },
                totalTokens: {
                  $ifNull: ["$usage.total_tokens", { $ifNull: ["$response.usage.total_tokens", 0] }],
                },
              },
            },
          ],
        },
      },
    ]).toArray();

    function formatProviderUsage(provider: string) {
      const summary = ((result?.summaries ?? []) as ProviderSummary[])
        .find((item) => item._id === provider) ?? {};
      const totalRequests = summary.totalRequests ?? 0;
      const totalNeurons = summary.totalNeurons ?? 0;
      const byDay = ((result?.byDay ?? []) as ProviderDay[])
        .filter((item) => item._id.provider === provider)
        .map((item) => ({
          _id: item._id.day,
          requests: item.requests,
          neurons: item.neurons,
          totalTokens: item.totalTokens,
        }));

      return {
        summary: {
          totalRequests,
          totalNeurons,
          avgNeuronsPerRequest: totalRequests ? totalNeurons / totalRequests : 0,
          totalPromptTokens: summary.totalPromptTokens ?? 0,
          totalCompletionTokens: summary.totalCompletionTokens ?? 0,
          totalTokens: summary.totalTokens ?? 0,
          totalPdfBytes: summary.totalPdfBytes ?? 0,
        },
        byDay,
      };
    }

    return NextResponse.json({
      range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      providers: {
        puter: formatProviderUsage("puter"),
        worker: formatProviderUsage("worker"),
        apinex: formatProviderUsage("apinex"),
      },
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
