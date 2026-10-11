interface Env {
	AI: Ai;
}

type JsonSchemaNode = Record<string, unknown>;

const MAX_PDF_SIZE = 7 * 1024 * 1024; // 7 MB
const MAX_SCHEMA_LENGTH = 2_000;

// Maps the schema's declared leaf type names (what the caller now puts as
// values, e.g. "invoice_number": "string", "tax_rate": "double") to real
// JSON Schema primitive types. Kept lenient/alias-tolerant since the schema
// is hand-written by whoever is calling this service.
const TYPE_ALIASES: Record<string, string> = {
	string: "string",
	str: "string",
	text: "string",
	number: "number",
	num: "number",
	double: "number",
	float: "number",
	decimal: "number",
	integer: "integer",
	int: "integer",
	long: "integer",
	boolean: "boolean",
	bool: "boolean",
};

// Workers AI sometimes returns the extracted data as a JSON-encoded string
// (in `response.response`, or nested in `response.choices[i].message.content`)
// instead of an already-parsed object, even when response_format: json_schema
// was requested. Parse those fields in place so callers always receive real
// JSON rather than an escaped string.
function parseIfJsonString(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}

	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return value;
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

function normalizeAiResponse(response: any): any {
	if (response && typeof response === "object") {
		if ("response" in response) {
			response.response = parseIfJsonString(response.response);
		}

		if (Array.isArray(response.choices)) {
			for (const choice of response.choices) {
				if (choice?.message && "content" in choice.message) {
					choice.message.content = parseIfJsonString(choice.message.content);
				}
			}
		}
	}

	return response;
}

function resolveLeafType(value: unknown): string {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();

		return TYPE_ALIASES[normalized] ?? "string";
	}

	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";

	// Untyped placeholders (e.g. "" from the older blank-schema format)
	// default to string.
	return "string";
}

// Converts the caller's placeholder-style schema (leaf values are type
// names like "string"/"number"/"double", or the older blank "" / []
// style) into a real JSON Schema object. Previously the raw placeholder
// schema was passed straight through as response_format.json_schema, which
// isn't valid JSON Schema (no "type"/"properties") and so couldn't actually
// constrain the model's output.
function buildJsonSchema(node: unknown): JsonSchemaNode {
	if (Array.isArray(node)) {
		const template = node.length > 0 ? node[0] : "string";

		return {
			type: "array",
			items: buildJsonSchema(template),
		};
	}

	if (node !== null && typeof node === "object") {
		const properties: Record<string, JsonSchemaNode> = {};
		const required: string[] = [];

		for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
			properties[key] = buildJsonSchema(value);
			required.push(key);
		}

		return {
			type: "object",
			properties,
			required,
			additionalProperties: false,
		};
	}

	// Every leaf allows null: the prompt tells the model to use null for a
	// field the excerpts don't support, so the schema has to permit that.
	return { type: [resolveLeafType(node), "null"] };
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {

		if (request.method !== "POST") {
			return Response.json(
				{ error: "Only POST requests are allowed" },
				{ status: 405 }
			);
		}

		try {
			const body: any = await request.json();

			const userSchema = body.user_schema;
			const userContent = body.user_content;
			const pdfSize = body.pdf_size;

			if (!Number.isInteger(pdfSize) || pdfSize < 0) {
				return Response.json(
					{ error: "pdf_size is required and must be a non-negative integer" },
					{ status: 400 }
				);
			}

			if (pdfSize > MAX_PDF_SIZE) {
				return Response.json(
					{ error: "The PDF must be 7 MB or smaller" },
					{ status: 413 }
				);
			}

			if (!userSchema) {
				return Response.json(
					{ error: "user_schema is required" },
					{ status: 400 }
				);
			}

			if (JSON.stringify(userSchema).length > MAX_SCHEMA_LENGTH) {
				return Response.json(
					{ error: `user_schema must be ${MAX_SCHEMA_LENGTH.toLocaleString()} characters or fewer` },
					{ status: 413 }
				);
			}

			if (!userContent) {
				return Response.json(
					{ error: "user_content is required" },
					{ status: 400 }
				);
			}

			const DATE_FORMATS = [
				"DD-MM-YYYY", "MM-DD-YYYY", "YYYY-MM-DD", "DD-MM", "DD Mon YYYY", "Mon DD, YYYY",
			];
			const STRING_CASES = ["Proper Case", "camelCase", "PascalCase", "UPPERCASE", "lowercase"];
			const NUMBER_FORMATS = ["Plain", "2 decimals", "Comma-separated", "Compact"];
			const customRules = typeof body.custom_rules === "string" ? body.custom_rules : "";

			const dateFormat = DATE_FORMATS.includes(body.date_format) ? body.date_format : DATE_FORMATS[0];
			const stringCase = STRING_CASES.includes(body.string_case) ? body.string_case : STRING_CASES[0];
			const numberFormat = NUMBER_FORMATS.includes(body.number_format) ? body.number_format : NUMBER_FORMATS[0];

			const formattingInstructions = `
				Formatting rules (apply on top of the schema's data types):
				- Fields typed "date" or "datetime": format the value as ${dateFormat}.
				- Fields typed "string" (not enum-like codes or identifiers): use ${stringCase}.
				- Fields typed "number", "integer", "float", "double", "decimal", or "long": format as ${numberFormat}.
				- These rules never apply to null values or to fields whose type is not one of the above.
				`
			;

			// Hardcoded prompt
			const extractionPrompt = `
				Extract the requested fields from the document excerpts. Return only one valid JSON object matching the schema below, where each value names the expected data type for that field. Use null for a field that is not supported by the excerpts. Do not invent information.

				${formattingInstructions}

				${customRules ? `Additional custom rules:\n${customRules}` : ""}

				Schema:
				${JSON.stringify(userSchema, null, 2)}

				Document excerpts:
				${JSON.stringify(userContent, null, 2)}
				`
			;

			const response = await env.AI.run(
				"@cf/qwen/qwen3-30b-a3b-fp8",
				{
					messages: [
						{
							role: "system",
							content:
								"You are a document extraction and reasoning assistant. " +
								"Return accurate structured JSON according to the user's schema."
						},
						{
							role: "user",
							content: extractionPrompt
						}
					],

					response_format: {
						type: "json_schema",
						json_schema: buildJsonSchema(userSchema)
					},

					max_tokens: 4096,
					temperature: 0.1
				}
			);

			return Response.json(normalizeAiResponse(response));

		} catch (error) {

			console.error("Inference error:", error);

			return Response.json(
				{
					error: "Inference failed",
					details: String(error)
				},
				{ status: 500 }
			);
		}
	}
};