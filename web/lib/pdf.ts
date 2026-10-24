// Vercel rejects function request bodies over 4.5 MB with a plain-text 413
// before our code runs; 4 MB leaves room for the multipart form overhead.
export const MAX_PDF_SIZE = 4 * 1024 * 1024;
export const MAX_PDF_SIZE_LABEL = `${MAX_PDF_SIZE / (1024 * 1024)} MB`;
export const MAX_SCHEMA_LENGTH = 2_000;

// Browsers normalize bare "\n" line breaks to "\r\n" when serializing a
// <textarea> value into multipart/form-data, inflating the length by one
// character per line versus what the editor itself holds. Both the frontend
// (the live counter/validation) and the backend (the enforced limit) must
// run the schema text through this before measuring its length, or the two
// can disagree about whether a schema is within MAX_SCHEMA_LENGTH.
export function normalizeSchemaText(value: string): string {
	return value.replace(/\r\n/g, "\n");
}

export async function hasPdfSignature(file: Blob): Promise<boolean> {
	const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());

	return String.fromCharCode(...header) === "%PDF-";
}