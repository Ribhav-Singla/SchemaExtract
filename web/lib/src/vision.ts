import Anthropic from "@anthropic-ai/sdk";

const VISION_PROMPT = `Transcribe this PDF page into markdown.
- Preserve all text exactly, in reading order.
- Use markdown headings for headings and markdown tables for tables.
- Do not summarise, translate, or add commentary.
- If the page has no readable text, return an empty response.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
    if (!client) {
        const apiKey = process.env.NEXT_ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error(
                "NEXT_ANTHROPIC_API_KEY is required for vision extraction"
            );
        }
        client = new Anthropic({ apiKey });
    }
    return client;
}

export async function transcribePageImage(
    png: Uint8Array
): Promise<string> {
    const message = await getClient().messages.create({
        model:
            process.env.NEXT_CLAUDE_VISION_MODEL ??
            process.env.NEXT_CLAUDE_MODEL ??
            "claude-haiku-5-5",
        max_tokens: 8192,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: "image/png",
                            data: Buffer.from(png).toString("base64"),
                        },
                    },
                    { type: "text", text: VISION_PROMPT },
                ],
            },
        ],
    });

    return message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
}
