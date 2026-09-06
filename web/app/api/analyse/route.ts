import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

import { runPipeline } from "../../../lib/main";
import { getSchemaExtractDatabase } from "../../../lib/mongodb";

export const runtime = "nodejs";

function isSchemaObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	return true;
}

export async function POST(request: NextRequest) {
	let temporaryDirectory: string | undefined;

	try {
		const formData = await request.formData();
		const pdf = formData.get("pdf");
		const schemaValue = formData.get("schema");

		if (!(pdf instanceof File) || pdf.size === 0) {
			return NextResponse.json(
				{ error: "A PDF file is required" },
				{ status: 400 }
			);
		}

		if (path.extname(pdf.name).toLowerCase() !== ".pdf") {
			return NextResponse.json(
				{ error: "The uploaded file must be a PDF" },
				{ status: 400 }
			);
		}

		if (typeof schemaValue !== "string") {
			return NextResponse.json(
				{ error: "A schema JSON object is required" },
				{ status: 400 }
			);
		}

		let schema: unknown;

		try {
			schema = JSON.parse(schemaValue);
		} catch {
			return NextResponse.json(
				{ error: "The schema must contain valid JSON" },
				{ status: 400 }
			);
		}

		if (!isSchemaObject(schema)) {
			return NextResponse.json(
				{ error: "The schema must be a JSON object" },
				{ status: 400 }
			);
		}

		temporaryDirectory = path.join(os.tmpdir(), `schema-extract-${randomUUID()}`);
		const outputDirectory = path.join(temporaryDirectory, "output");
		const pdfPath = path.join(temporaryDirectory, "input.pdf");

		await fs.mkdir(temporaryDirectory, { recursive: true });
		await fs.writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()));

		const result = await runPipeline({
			pdf: pdfPath,
			outputDir: outputDirectory,
			schema,
		});

		const extractionResponse = await fetch(
			process.env.EXTRACTION_WORKER_URL ??
				"https://extraction-ai.ticketfusion.workers.dev",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					user_schema: schema,
					user_content: result.ranked_chunks,
				}),
			}
		);

		const extractionData: unknown = await extractionResponse.json();

		if (!extractionResponse.ok) {
			const workerError =
				extractionData && typeof extractionData === "object" && "error" in extractionData
					? String(extractionData.error)
					: "Extraction failed";

			throw new Error(workerError);
		}

		const database = await getSchemaExtractDatabase();
		await database.collection("extractions").insertOne({
			created_on: new Date(),
			pdf_name: pdf.name,
			pdf_size: pdf.size,
			user_schema: schema,
			top_k_chunks: result.ranked_chunks,
			response: extractionData,
		});

		return NextResponse.json({
			...result,
			extraction_response: extractionData,
		});
	} catch (error) {
		console.error("Pipeline analysis failed", error);

		return NextResponse.json(
			{
				error: error instanceof Error
					? error.message
					: "Pipeline analysis failed",
			},
			{ status: 500 }
		);
	} finally {
		if (temporaryDirectory) {
			await fs.rm(temporaryDirectory, {
				recursive: true,
				force: true,
			});
		}
	}
}