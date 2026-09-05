import { NextResponse } from "next/server";
import { countChunks, extractText, rankChunks } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const pdfFile = form.get("pdf");
    if (!(pdfFile instanceof File) || pdfFile.type !== "application/pdf") return NextResponse.json({ error: "Please upload a PDF file." }, { status: 400 });
    let schema: unknown;
    try { schema = JSON.parse(String(form.get("schema") ?? "{}")); } catch { return NextResponse.json({ error: "The schema must be valid JSON." }, { status: 400 }); }
    const topK = Math.min(50, Math.max(1, Number(form.get("topK") ?? 5)));
    const threshold = Math.min(1, Math.max(0, Number(form.get("threshold") ?? 0.5)));
    const text = await extractText(Buffer.from(await pdfFile.arrayBuffer()));
    const chunks = rankChunks(text, schema, topK, threshold);
    return NextResponse.json({ document: pdfFile.name, top_k: chunks.length, total_chunks: countChunks(text), threshold, chunks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze this document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}