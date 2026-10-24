import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";

import { checkPage } from "./page-check";
import { transcribePageImage } from "./vision";

const PDF_WORKER_PATH = path.join(
    process.cwd(),
    "node_modules",
    "pdf-parse",
    "dist",
    "pdf-parse",
    "esm",
    "pdf.worker.mjs"
);

const PDF_PARSE_PACKAGE_JSON = path.join(
    process.cwd(),
    "node_modules",
    "pdf-parse",
    "package.json"
);

// ~150 DPI for a US Letter/A4 page: legible for vision, modest image tokens.
const SCREENSHOT_WIDTH = 1275;
const VISION_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    run: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    async function worker() {
        while (next < items.length) {
            const index = next++;
            results[index] = await run(items[index]);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, worker)
    );
    return results;
}

export async function pdfToMarkdown(
    pdfPath: string
): Promise<string> {
    console.log("=".repeat(60));
    console.log("LAYER 1: PDF -> MARKDOWN");
    console.log("=".repeat(60));
    console.log(`Input PDF: ${pdfPath}`);

    // pdf-parse's ESM build renders with pdfjs-dist, which pins its own
    // @napi-rs/canvas; a Path2D from any other copy fails in ctx.fill().
    const pdfjsRequire = createRequire(
        createRequire(PDF_PARSE_PACKAGE_JSON).resolve("pdfjs-dist/package.json")
    );
    const { DOMMatrix, ImageData, Path2D } =
        pdfjsRequire("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
    Object.assign(globalThis, {
        DOMMatrix,
        ImageData,
        Path2D,
    });

    const { PDFParse } = await import("pdf-parse");
    PDFParse.setWorker(pathToFileURL(PDF_WORKER_PATH).href);

    const pdfData = await fs.readFile(pdfPath);
    const parser = new PDFParse({ data: pdfData });

    let markdown: string;

    try {
        const { pages } = await parser.getText();
        const pageTexts = new Map(
            pages.map((page) => [page.num, page.text])
        );

        const visionPages = pages
            .map((page) => ({ num: page.num, check: checkPage(page.text) }))
            .filter(({ check }) => check.source === "vision");

        for (const { num, check } of visionPages) {
            console.log(`Page ${num}: vision (${check.reason})`);
        }
        console.log(
            `Pages: ${pages.length - visionPages.length} text, ${visionPages.length} vision`
        );

        await mapWithConcurrency(
            visionPages,
            VISION_CONCURRENCY,
            async ({ num }) => {
                try {
                    const screenshot = await parser.getScreenshot({
                        partial: [num],
                        desiredWidth: SCREENSHOT_WIDTH,
                        imageBuffer: true,
                        imageDataUrl: false,
                    });
                    const png = screenshot.pages[0]?.data;
                    if (!png) {
                        throw new Error("page render returned no image");
                    }
                    pageTexts.set(num, await transcribePageImage(png));
                } catch (error) {
                    // Keep whatever the text layer gave rather than failing the whole PDF.
                    console.error(`Page ${num}: vision extraction failed`, error);
                }
            }
        );

        markdown = pages
            .map((page) => pageTexts.get(page.num) ?? "")
            .join("\n\n");
    } finally {
        await parser.destroy();
    }

    console.log(
        `Markdown characters: ${markdown.length.toLocaleString()}`
    );

    return markdown;
}
