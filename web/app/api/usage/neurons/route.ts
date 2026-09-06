import { NextRequest, NextResponse } from "next/server";

import { getSchemaExtractDatabase } from "../../../../lib/mongodb";

export const runtime = "nodejs";

interface DailyNeuronUsage {
	date: string;
	requests: number;
	neurons: number;
}

interface NeuronUsageSummary {
	totalRequests: number;
	totalNeurons: number;
	avgNeuronsPerRequest: number;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalTokens: number;
	totalPdfBytes: number;
}

interface SummaryAggregateRow {
	totalRequests: number;
	totalNeurons: number;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalTokens: number;
	totalPdfBytes: number;
}

interface DailyAggregateRow {
	_id: string;
	requests: number;
	neurons: number;
}

function parseDateParam(value: string | null, paramName: string): Date | undefined {
	if (!value) {
		return undefined;
	}

	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`"${paramName}" must be a valid date`);
	}

	return parsed;
}

// Aggregates neuron usage (Cloudflare Workers AI's billing metric, stored at
// response.usage.neurons on each "extractions" document) across all runs, or
// a date range / single PDF when filtered. Powers a usage dashboard without
// pulling every raw document to the client.
export async function GET(request: NextRequest) {
	try {
		const searchParams = request.nextUrl.searchParams;

		let from: Date | undefined;
		let to: Date | undefined;

		try {
			from = parseDateParam(searchParams.get("from"), "from");
			to = parseDateParam(searchParams.get("to"), "to");
		} catch (error) {
			return NextResponse.json(
				{
					error: error instanceof Error ? error.message : "Invalid date parameter",
				},
				{ status: 400 }
			);
		}

		const pdfName = searchParams.get("pdf_name");

		const match: Record<string, unknown> = {};

		if (from || to) {
			const createdOn: Record<string, Date> = {};

			if (from) createdOn.$gte = from;
			if (to) createdOn.$lte = to;

			match.created_on = createdOn;
		}

		if (pdfName) {
			match.pdf_name = pdfName;
		}

		const database = await getSchemaExtractDatabase();

		const [result] = await database
			.collection("extractions")
			.aggregate([
				{ $match: match },
				{
					$facet: {
						summary: [
							{
								$group: {
									_id: null,
									totalRequests: { $sum: 1 },
									totalNeurons: {
										$sum: { $ifNull: ["$response.usage.neurons", 0] },
									},
									totalPromptTokens: {
										$sum: { $ifNull: ["$response.usage.prompt_tokens", 0] },
									},
									totalCompletionTokens: {
										$sum: { $ifNull: ["$response.usage.completion_tokens", 0] },
									},
									totalTokens: {
										$sum: { $ifNull: ["$response.usage.total_tokens", 0] },
									},
									totalPdfBytes: { $sum: { $ifNull: ["$pdf_size", 0] } },
								},
							},
						],
						byDay: [
							{
								$group: {
									_id: {
										$dateToString: { format: "%Y-%m-%d", date: "$created_on" },
									},
									requests: { $sum: 1 },
									neurons: {
										$sum: { $ifNull: ["$response.usage.neurons", 0] },
									},
								},
							},
							{ $sort: { _id: 1 } },
						],
					},
				},
			])
			.toArray();

		const summaryDoc = result?.summary?.[0] as SummaryAggregateRow | undefined;

		const totalRequests = summaryDoc?.totalRequests ?? 0;
		const totalNeurons = summaryDoc?.totalNeurons ?? 0;

		const summary: NeuronUsageSummary = {
			totalRequests,
			totalNeurons,
			avgNeuronsPerRequest: totalRequests > 0 ? totalNeurons / totalRequests : 0,
			totalPromptTokens: summaryDoc?.totalPromptTokens ?? 0,
			totalCompletionTokens: summaryDoc?.totalCompletionTokens ?? 0,
			totalTokens: summaryDoc?.totalTokens ?? 0,
			totalPdfBytes: summaryDoc?.totalPdfBytes ?? 0,
		};

		const byDay: DailyNeuronUsage[] = ((result?.byDay ?? []) as DailyAggregateRow[]).map(
			(entry) => ({
				date: entry._id,
				requests: entry.requests,
				neurons: entry.neurons,
			})
		);

		return NextResponse.json({
			range: {
				from: from ? from.toISOString() : null,
				to: to ? to.toISOString() : null,
			},
			summary,
			byDay,
		});
	} catch (error) {
		console.error("Neuron usage aggregation failed", error);

		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Neuron usage aggregation failed",
			},
			{ status: 500 }
		);
	}
}
