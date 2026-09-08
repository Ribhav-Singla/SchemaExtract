import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

import { runPipeline } from "../../../lib/main";
import { getSchemaExtractDatabase } from "../../../lib/mongodb";
import { hasPdfSignature, MAX_PDF_SIZE, MAX_SCHEMA_LENGTH, normalizeSchemaText } from "../../../lib/pdf";
import { normalizeExtractionData } from "../../../lib/normalize-extraction";

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
		const dateFormat = formData.get("date_format");
		const stringCase = formData.get("string_case");
		const numberFormat = formData.get("number_format");

		if (!(pdf instanceof File) || pdf.size === 0) {
			return NextResponse.json(
				{ error: "A PDF file is required" },
				{ status: 400 }
			);
		}

		if (pdf.size > MAX_PDF_SIZE) {
			return NextResponse.json(
				{ error: "The PDF must be 7 MB or smaller" },
				{ status: 413 }
			);
		}

		if (path.extname(pdf.name).toLowerCase() !== ".pdf") {
			return NextResponse.json(
				{ error: "The uploaded file must be a PDF" },
				{ status: 400 }
			);
		}

		if (!(await hasPdfSignature(pdf))) {
			return NextResponse.json(
				{ error: "The uploaded file is not a valid PDF" },
				{ status: 400 }
			);
		}

		if (typeof schemaValue !== "string") {
			return NextResponse.json(
				{ error: "A schema JSON object is required" },
				{ status: 400 }
			);
		}

		const normalizedSchema = normalizeSchemaText(schemaValue);

		if (normalizedSchema.length > MAX_SCHEMA_LENGTH) {
			return NextResponse.json(
				{ error: `The schema must be ${MAX_SCHEMA_LENGTH.toLocaleString()} characters or fewer` },
				{ status: 413 }
			);
		}

		let schema: unknown;

		try {
			schema = JSON.parse(normalizedSchema);
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
					pdf_size: pdf.size,
					date_format: typeof dateFormat === "string" ? dateFormat : undefined,
					string_case: typeof stringCase === "string" ? stringCase : undefined,
					number_format: typeof numberFormat === "string" ? numberFormat : undefined,
				}),
			}
		);

		const extractionData: unknown = normalizeExtractionData(
			await extractionResponse.json()
		);

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