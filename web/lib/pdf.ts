export const MAX_PDF_SIZE = 7 * 1024 * 1024;

export async function hasPdfSignature(file: Blob): Promise<boolean> {
	const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());

	return String.fromCharCode(...header) === "%PDF-";
}