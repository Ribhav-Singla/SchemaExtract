interface Env {
	AI: Ai;
}

type JsonSchemaNode = Record<string, unknown>;

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

			if (!userSchema) {
				return Response.json(
					{ error: "user_schema is required" },
					{ status: 400 }
				);
			}

			if (!userContent) {
				return Response.json(
					{ error: "user_content is required" },
					{ status: 400 }
				);
			}

			// Hardcoded prompt
			const extractionPrompt = `
				Extract the requested fields from the document excerpts. Return only one valid JSON object matching the schema below, where each value names the expected data type for that field. Use null for a field that is not supported by the excerpts. Do not invent information.

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

					max_tokens: 2048,
					temperature: 0.1
				}
			);

			console.log("AI response:", response);

			return Response.json(response);

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