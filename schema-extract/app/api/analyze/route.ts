import { NextResponse } from "next/server";
import { countChunks, extractText, rankChunks } from "@/lib/pipeline";
import { createServerLogger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const logger = createServerLogger(requestId);
  logger.stage("request_received");
  try {
    const form = await request.formData();
    const pdfFile = form.get("pdf");
    if (!(pdfFile instanceof File) || pdfFile.type !== "application/pdf") {
      logger.error("invalid_pdf_upload");
      return NextResponse.json({ error: "Please upload a PDF file." }, { status: 400 });
    }
    logger.stage("upload_validated", { filename: pdfFile.name, bytes: pdfFile.size });
    let schema: unknown;
    try { schema = JSON.parse(String(form.get("schema") ?? "{}")); } catch {
      logger.error("invalid_schema");
      return NextResponse.json({ error: "The schema must be valid JSON." }, { status: 400 });
    }
    const topK = Math.min(50, Math.max(1, Number(form.get("topK") ?? 5)));
    const threshold = Math.min(1, Math.max(0, Number(form.get("threshold") ?? 0.5)));
    logger.stage("configuration_ready", { top_k: topK, threshold });
    const text = await extractText(Buffer.from(await pdfFile.arrayBuffer()), logger);
    const chunks = await rankChunks(text, schema, topK, threshold, logger);
    const totalChunks = countChunks(text);
    logger.stage("response_ready", { returned_chunks: chunks.length, total_chunks: totalChunks });
    return NextResponse.json({ document: pdfFile.name, top_k: chunks.length, total_chunks: totalChunks, threshold, chunks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze this document.";
    logger.error("analysis_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}