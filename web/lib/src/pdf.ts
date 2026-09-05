
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { PDFParse } from "pdf-parse";

const PDF_WORKER_PATH = path.join(
    process.cwd(),
    "node_modules",
    "pdf-parse",
    "dist",
    "pdf-parse",
    "esm",
    "pdf.worker.mjs"
);

PDFParse.setWorker(pathToFileURL(PDF_WORKER_PATH).href);

export async function pdfToMarkdown(
    pdfPath: string
): Promise<string> {
    console.log("=".repeat(60));
    console.log("LAYER 1: PDF -> MARKDOWN");
    console.log("=".repeat(60));
    console.log(`Input PDF: ${pdfPath}`);

    const pdfData = await fs.readFile(pdfPath);
    const parser = new PDFParse({ data: pdfData });

    let markdown: string;

    try {
        const result = await parser.getText();
        markdown = result.text;
    } finally {
        await parser.destroy();
    }

    console.log(
        `Markdown characters: ${markdown.length.toLocaleString()}`
    );

    return markdown;
}