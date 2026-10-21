import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

import { MAX_SCHEMA_LENGTH } from "../../../lib/pdf";

export const runtime = "nodejs";

function parseJsonResponse(content: string): unknown {
	const withoutFence = content
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");

	try {
		return JSON.parse(withoutFence);
	} catch {
		// Models occasionally emit stray characters (e.g. an extra "}") after the
		// object, so fall back to the first complete top-level JSON value
		const firstValue = extractFirstJsonValue(withoutFence);
		if (firstValue !== undefined) {
			try {
				return JSON.parse(firstValue);
			} catch {
				// fall through to the error below
			}
		}
		throw new Error("Model returned a response that was not valid JSON");
	}
}

function extractFirstJsonValue(text: string): string | undefined {
	const start = text.search(/[{[]/);
	if (start === -1) return undefined;

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];

		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
		} else if (char === '"') {
			inString = true;
		} else if (char === "{" || char === "[") {
			depth++;
		} else if (char === "}" || char === "]") {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}

	return undefined;
}

function buildExtractionPrompt(body: Record<string, unknown>): string {
	return `Extract data from the document excerpts using this schema:
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
}

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

		if (!Array.isArray(body.user_content)) {
			return NextResponse.json(
				{ error: "user_content must be an array" },
				{ status: 400 }
			);
		}

		const apiKey = process.env.NEXT_ANTHROPIC_API_KEY;
		if (!apiKey) {
			return NextResponse.json(
				{ error: "NEXT_ANTHROPIC_API_KEY is not configured" },
				{ status: 500 }
			);
		}

		const model = process.env.NEXT_CLAUDE_MODEL ?? "claude-haiku-5-5";
		const client = new Anthropic({ apiKey });

		try {
			const message = await client.messages.create({
				model,
				max_tokens: 16000,
				// Extraction over pre-filtered chunks needs little reasoning; low effort cuts latency
				output_config: { effort: "low" },
				// Thinking was ~2/3 of output tokens (~10s vs ~3s) with no accuracy gain.
				// Only Haiku accepts "disabled"; Opus 5.5 rejects it and Sonnet 5.5 needs "between_tools".
				...(model.startsWith("claude-haiku")
					? { thinking: { type: "disabled" as const } }
					: {}),
				messages: [{ role: "user", content: buildExtractionPrompt(body) }],
			});

			if (message.stop_reason === "refusal") {
				return NextResponse.json(
					{ error: "Claude declined to process this document" },
					{ status: 422 }
				);
			}

			if (message.stop_reason === "max_tokens") {
				return NextResponse.json(
					{ error: "Claude response was truncated before the JSON was complete" },
					{ status: 502 }
				);
			}

			const content = message.content
				.map((block) => (block.type === "text" ? block.text : ""))
				.join("");
			const { input_tokens, output_tokens } = message.usage;

			return NextResponse.json({
				response: parseJsonResponse(content),
				// Mirror the prompt/completion/total shape the usage dashboard aggregates
				usage: {
					...message.usage,
					prompt_tokens: input_tokens,
					completion_tokens: output_tokens,
					total_tokens: input_tokens + output_tokens,
				},
				model: message.model,
			});
		} catch (error) {
			if (error instanceof Anthropic.APIError) {
				return NextResponse.json(
					{ error: error.message },
					{ status: error.status ?? 502 }
				);
			}
			throw error;
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";

		return NextResponse.json(
			{ error: errorMessage },
			{ status: 500 }
		);
	}
}
