export interface PuterChunk {
  prevText: string;
  text: string;
}

export interface PuterExtractionOptions {
  schema: unknown;
  chunks: unknown;
  dateFormat?: string;
  stringCase?: string;
  numberFormat?: string;
  customRules?: string;
  model?: string;
}

interface PuterResponse {
  message?: {
    content?: string | Array<{ text?: string }>;
  };
  content?: string;
  text?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usageDetails?: Record<string, unknown>;
}

interface PuterClient {
  ai: {
    chat(
      prompt: string,
      options: {
        model: string;
        normalize: boolean;
        stream: false;
        reasoning_effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
        max_tokens: number;
        outputFormat: {
          type: "json_schema";
          name: string;
          schema: Record<string, unknown>;
          strict: true;
        };
      },
    ): Promise<PuterResponse | string>;
  };
}

declare global {
  interface Window {
    puter?: PuterClient;
  }
}

const DEFAULT_MODEL =
  process.env.NEXT_PUBLIC_PUTER_MODEL ?? "gpt-5.6-luna";

function normalizeChunks(chunks: unknown): PuterChunk[] {
  if (!Array.isArray(chunks)) {
    return [];
  }

  return chunks.map((chunk) => {
    const value =
      typeof chunk === "object" && chunk !== null
        ? (chunk as Record<string, unknown>)
        : {};

    return {
      prevText: typeof value.prevText === "string" ? value.prevText : "",
      text: typeof value.text === "string" ? value.text : "",
    };
  });
}

function toJsonSchema(node: unknown): Record<string, unknown> {
  if (Array.isArray(node)) {
    return {
      type: ["array", "null"],
      items: toJsonSchema(node[0] ?? "string"),
    };
  }

  if (typeof node === "object" && node !== null) {
    const properties: Record<string, Record<string, unknown>> = {};

    for (const [key, value] of Object.entries(node)) {
      properties[key] = toJsonSchema(value);
    }

    return {
      type: ["object", "null"],
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }

  const type =
    typeof node === "string"
      ? ({
          string: "string",
          text: "string",
          number: "number",
          double: "number",
          float: "number",
          decimal: "number",
          integer: "integer",
          int: "integer",
          long: "integer",
          boolean: "boolean",
          bool: "boolean",
        }[node.trim().toLowerCase()] ?? "string")
      : typeof node === "number"
        ? "number"
        : typeof node === "boolean"
          ? "boolean"
          : "string";

  return { type: [type, "null"] };
}

function responseText(response: PuterResponse | string): string {
  if (typeof response === "string") {
    return response;
  }

  if (typeof response.message?.content === "string") {
    return response.message.content;
  }

  if (Array.isArray(response.message?.content)) {
    return response.message.content.map((part) => part.text ?? "").join("");
  }

  return (
    response.content ??
    response.text ??
    response.choices?.[0]?.message?.content ??
    ""
  );
}

function parseResponse(response: PuterResponse | string): Record<string, unknown> {
  const content = responseText(response)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!content) {
    throw new Error("Puter returned an empty extraction response.");
  }

  const parsed: unknown = JSON.parse(content);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("Puter returned an invalid extraction object.");
  }

  return parsed as Record<string, unknown>;
}

async function loadPuter(): Promise<PuterClient> {
  if (!document.querySelector('script[src="https://js.puter.com/v2/"]')) {
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;
    document.head.appendChild(script);
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (window.puter?.ai) {
      return window.puter;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error("Puter.js did not load. Refresh the page and try again.");
}

export async function runPuterExtraction({
  schema,
  chunks,
  dateFormat = "DD-MM-YYYY",
  stringCase = "Preserve",
  numberFormat = "Plain",
  customRules = "",
  model = DEFAULT_MODEL,
}: PuterExtractionOptions): Promise<{
  response: Record<string, unknown>;
  usageDetails?: Record<string, unknown>;
}> {
  const client = await loadPuter();
  const content = normalizeChunks(chunks);

  const prompt = `Extract data from the document excerpts using this schema:
${JSON.stringify(schema)}

Rules:
- Return only one JSON object matching the schema.
- Keep every field and array shape.
- Use only explicit evidence from the excerpts.
- Never guess or add fields.
- Use null when a value is missing, unsupported, or unclear.
- Dates: ${dateFormat}; strings: ${stringCase}; numbers: ${numberFormat}.
${customRules.trim() ? `- Additional custom rules:\n${customRules.trim()}` : ""}

Document excerpts:
${JSON.stringify(content)}`;

  const response = await client.ai.chat(prompt, {
    model,
    normalize: true,
    stream: false,
    reasoning_effort: "low",
    max_tokens: 4096,
    outputFormat: {
      type: "json_schema",
      name: "document_extraction",
      schema: toJsonSchema(schema),
      strict: true,
    },
  });

  // console.log("Puter response:", response);

  return {
    response: parseResponse(response),
    usageDetails:
      typeof response === "object" && response !== null
        ? response.usageDetails
        : undefined,
  };
}