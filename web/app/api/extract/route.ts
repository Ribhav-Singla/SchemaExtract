import { NextRequest, NextResponse } from "next/server";

import { MAX_SCHEMA_LENGTH } from "../../../lib/pdf";
import { normalizeExtractionData } from "../../../lib/normalize-extraction";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();

		if (!body.user_schema || !body.user_content) {
			return NextResponse.json(
				{ error: "user_schema and user_content are required" },
				{ status: 400 }
			);
		}

		if (JSON.stringify(body.user_schema).length > MAX_SCHEMA_LENGTH) {
			return NextResponse.json(
				{ error: `user_schema must be ${MAX_SCHEMA_LENGTH.toLocaleString()} characters or fewer` },
				{ status: 413 }
			);
		}

		// Forward the request to the external extraction API
		const extractionResponse = await fetch(
			"https://extraction-ai.ticketfusion.workers.dev",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			}
		);

		const extractionData = normalizeExtractionData(
			await extractionResponse.json()
		);

		if (!extractionResponse.ok) {
			const workerError =
				extractionData && typeof extractionData === "object" && "error" in extractionData
					? String((extractionData as { error: unknown }).error)
					: "Extraction failed";

			return NextResponse.json(
				{ error: workerError },
				{ status: extractionResponse.status }
			);
		}

		return NextResponse.json(extractionData);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";

		return NextResponse.json(
			{ error: errorMessage },
			{ status: 500 }
		);
	}
}
