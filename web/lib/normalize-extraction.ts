// The extraction worker (or the underlying model) can return the extracted
// data as a JSON-encoded string — in `response.response`, or nested in
// `response.choices[i].message.content` — instead of a parsed object/array.
// Detect that case and parse it in place so downstream code and the UI
// always work with real JSON rather than an escaped string.
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

export function normalizeExtractionData(data: unknown): unknown {
	if (!data || typeof data !== "object") {
		return data;
	}

	const result = data as Record<string, unknown>;

	if ("response" in result) {
		result.response = parseIfJsonString(result.response);
	}

	if (Array.isArray(result.choices)) {
		for (const choice of result.choices as Array<Record<string, unknown>>) {
			const message = choice?.message as Record<string, unknown> | undefined;
			if (message && "content" in message) {
				message.content = parseIfJsonString(message.content);
			}
		}
	}

	return result;
}
