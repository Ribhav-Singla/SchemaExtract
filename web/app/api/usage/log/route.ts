import { NextRequest, NextResponse } from "next/server";

import { logExtractionUsage } from "../../../../lib/usage-logging";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (
      (body.provider !== "puter" &&
        body.provider !== "worker" &&
        body.provider !== "apinex") ||
      typeof body.pdf_name !== "string" ||
      !Number.isInteger(body.pdf_size) ||
      typeof body.user_schema !== "object" ||
      !Array.isArray(body.top_k_chunks)
    ) {
      return NextResponse.json({ error: "Invalid usage log payload" }, { status: 400 });
    }

    await logExtractionUsage({
      provider: body.provider,
      pdfName: body.pdf_name,
      pdfSize: body.pdf_size,
      userSchema: body.user_schema,
      topKChunks: body.top_k_chunks,
      response: body.response,
      usage: body.usage,
      usageDetails: body.usageDetails,
      model: body.model,
      customRules: body.custom_rules,
    });

    return NextResponse.json({ logged: true });
  } catch (error) {
    console.error("Extraction usage logging failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Usage logging failed" },
      { status: 500 },
    );
  }
}
