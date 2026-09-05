import { NextRequest, NextResponse } from "next/server";

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

		const extractionData = await extractionResponse.json();

		if (!extractionResponse.ok) {
			return NextResponse.json(
				{ error: extractionData.error ?? "Extraction failed" },
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
