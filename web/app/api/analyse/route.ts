import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

import { runPipeline } from "../../../lib/main";

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

		return NextResponse.json(result);
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