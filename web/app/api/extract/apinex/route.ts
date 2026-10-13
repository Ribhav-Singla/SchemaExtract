import { NextRequest, NextResponse } from "next/server";

import { MAX_SCHEMA_LENGTH } from "../../../../lib/pdf";
import { normalizeExtractionData } from "../../../../lib/normalize-extraction";

export const runtime = "nodejs";

const APINEX_URL = "https://api.apinex.bond/v1/chat/completions";

interface ApinexResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  model?: string;
  usage?: Record<string, unknown>;
  error?: {
    message?: string;
  };
}

function normalizeContent(
  content: string | Array<{ text?: string }> | undefined,
): string {
  if (typeof content === "string") return content;
  return content?.map((part) => part.text ?? "").join("") ?? "";
}

function parseJsonResponse(content: string): unknown {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new Error("Apinex returned a response that was not valid JSON");
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.APINEX_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "APINEX_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const body = await request.json();
    if (!body.user_schema || !Array.isArray(body.user_content)) {
      return NextResponse.json(
        { error: "user_schema and user_content are required" },
        { status: 400 },
      );
    }

    if (JSON.stringify(body.user_schema).length > MAX_SCHEMA_LENGTH) {
      return NextResponse.json(
        {
          error: `user_schema must be ${MAX_SCHEMA_LENGTH.toLocaleString()} characters or fewer`,
        },
        { status: 413 },
      );
    }

    const model = process.env.APINEX_MODEL ?? "claude-sonnet-5.5";
    const prompt = `Extract data from the document excerpts using this schema:
${JSON.stringify(body.user_schema)}

Rules:
- Return only one JSON object matching the schema.
- Keep every field and array shape.
- Use only explicit evidence from the excerpts.
- Never guess or add fields.
- Use null when a value is missing, unsupported, or unclear.
- Dates: ${body.date_format ?? "DD-MM-YYYY"}; strings: ${body.string_case ?? "Preserve"}; numbers: ${body.number_format ?? "Plain"}.
${typeof body.custom_rules === "string" && body.custom_rules.trim()
  ? `- Additional custom rules:\n${body.custom_rules.trim()}`
  : ""}

Document excerpts:
${JSON.stringify(body.user_content)}`;

    const extractionResponse = await fetch(APINEX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const apinexData = (await extractionResponse.json()) as ApinexResponse;
    if (!extractionResponse.ok) {
      const errorMessage = apinexData.error?.message ?? "Apinex extraction failed";
      return NextResponse.json(
        { error: errorMessage },
        { status: extractionResponse.status },
      );
    }

    const content = normalizeContent(apinexData.choices?.[0]?.message?.content);
    const response = parseJsonResponse(content);
    return NextResponse.json(
      normalizeExtractionData({
        response,
        usage: apinexData.usage,
        model: apinexData.model ?? model,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Apinex extraction failed" },
      { status: 500 },
    );
  }
}
