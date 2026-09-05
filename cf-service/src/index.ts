interface Env {
	AI: Ai;
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
				Extract the requested fields from the document excerpts. Return only one valid JSON object matching the schema. Use null for a field that is not supported by the excerpts. Do not invent information.

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
						json_schema: userSchema
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