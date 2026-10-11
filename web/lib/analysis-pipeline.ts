import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

import { runPipeline, type PipelineResult } from "./main";
import {
  hasPdfSignature,
  MAX_PDF_SIZE,
  MAX_SCHEMA_LENGTH,
  normalizeSchemaText,
} from "./pdf";

export class PipelineRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface AnalysisPipelineResult {
  result: PipelineResult;
  pdfName: string;
  pdfSize: number;
  schema: Record<string, unknown>;
  dateFormat?: string;
  stringCase?: string;
  numberFormat?: string;
}

export async function runAnalysisPipeline(
  request: Request,
): Promise<AnalysisPipelineResult> {
  const formData = await request.formData();
  const pdf = formData.get("pdf");
  const schemaValue = formData.get("schema");

  if (!(pdf instanceof File) || pdf.size === 0) {
    throw new PipelineRequestError("A PDF file is required", 400);
  }
  if (pdf.size > MAX_PDF_SIZE) {
    throw new PipelineRequestError("The PDF must be 7 MB or smaller", 413);
  }
  if (path.extname(pdf.name).toLowerCase() !== ".pdf") {
    throw new PipelineRequestError("The uploaded file must be a PDF", 400);
  }
  if (!(await hasPdfSignature(pdf))) {
    throw new PipelineRequestError("The uploaded file is not a valid PDF", 400);
  }
  if (typeof schemaValue !== "string") {
    throw new PipelineRequestError("A schema JSON object is required", 400);
  }

  const normalizedSchema = normalizeSchemaText(schemaValue);
  if (normalizedSchema.length > MAX_SCHEMA_LENGTH) {
    throw new PipelineRequestError(
      `The schema must be ${MAX_SCHEMA_LENGTH.toLocaleString()} characters or fewer`,
      413,
    );
  }

  let schema: unknown;
  try {
    schema = JSON.parse(normalizedSchema);
  } catch {
    throw new PipelineRequestError("The schema must contain valid JSON", 400);
  }
  if (!isSchemaObject(schema)) {
    throw new PipelineRequestError("The schema must be a JSON object", 400);
  }

  const temporaryDirectory = path.join(
    os.tmpdir(),
    `schema-extract-${randomUUID()}`,
  );

  try {
    const outputDirectory = path.join(temporaryDirectory, "output");
    const pdfPath = path.join(temporaryDirectory, "input.pdf");
    await fs.mkdir(temporaryDirectory, { recursive: true });
    await fs.writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()));

    return {
      result: await runPipeline({ pdf: pdfPath, outputDir: outputDirectory, schema }),
      pdfName: pdf.name,
      pdfSize: pdf.size,
      schema,
      dateFormat: typeof formData.get("date_format") === "string"
        ? String(formData.get("date_format"))
        : undefined,
      stringCase: typeof formData.get("string_case") === "string"
        ? String(formData.get("string_case"))
        : undefined,
      numberFormat: typeof formData.get("number_format") === "string"
        ? String(formData.get("number_format"))
        : undefined,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
