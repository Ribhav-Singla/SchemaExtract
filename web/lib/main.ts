import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

import {
    appendPreviousText,
    createChunks,
} from "./src/chunker";

import {
    findHeaders,
    splitIntoSections,
} from "./src/markdown_parser";

import { pdfToMarkdown } from "./src/pdf";

import {
    saveJson,
    saveMarkdown,
} from "./src/storage";

import { ChunkRetriever } from "./src/retriever";
import type { Chunk } from "./src/types";



export interface PipelineOptions {
    pdf: string;
    outputDir?: string;
    schema?: string | Record<string, unknown>;
    topK?: number;
    threshold?: number;
}

export interface PipelineResult {
    total_chunks: number;
    chunks: Chunk[];
    top_k: number;
    threshold: number;
    ranked_chunks: Chunk[];
}



// Layers 1 and 1.5 depend only on the PDF bytes, so their result is cached by
// content hash. /api/prepare fills this when a file is picked, letting the
// later /api/analyse call skip straight to retrieval. Promises are cached so a
// request arriving mid-preparation waits for it instead of redoing the work.
const PREPARED_CHUNKS_LIMIT = 50;
const preparedChunks = new Map<string, Promise<Chunk[]>>();

async function getChunks(
    pdfPath: string,
    outputPath: string,
    fileStem: string
): Promise<Chunk[]> {
    const pdfHash = createHash("sha256")
        .update(await fs.readFile(pdfPath))
        .digest("hex");

    const cached = preparedChunks.get(pdfHash);

    if (cached) {
        console.log(
            "LAYER 1 + 1.5: cache hit (PDF already processed)"
        );

        return structuredClone(await cached);
    }

    if (preparedChunks.size >= PREPARED_CHUNKS_LIMIT) {
        const oldestKey = preparedChunks.keys().next().value;

        if (oldestKey !== undefined) {
            preparedChunks.delete(oldestKey);
        }
    }

    const chunksPromise = extractChunks(
        pdfPath,
        outputPath,
        fileStem
    );

    preparedChunks.set(pdfHash, chunksPromise);

    try {
        return structuredClone(await chunksPromise);
    } catch (error) {
        preparedChunks.delete(pdfHash);
        throw error;
    }
}

async function extractChunks(
    pdfPath: string,
    outputPath: string,
    fileStem: string
): Promise<Chunk[]> {
    const markdown =
        await pdfToMarkdown(pdfPath);

    await saveMarkdown(
        markdown,
        path.join(
            outputPath,
            `${fileStem}.md`
        )
    );

    console.log();

    console.log(
        "=".repeat(60)
    );

    console.log(
        "LAYER 1.5: MARKDOWN -> MEANINGFUL CHUNKS"
    );

    console.log(
        "=".repeat(60)
    );

    const headers =
        findHeaders(markdown);

    await saveJson(
        {
            total_headers:
                headers.length,
            headers,
        },
        path.join(
            outputPath,
            `${fileStem}_headers.json`
        ),
        "Headers"
    );

    console.log(
        `Headers detected: ${headers.length}`
    );

    const sections =
        splitIntoSections(
            markdown,
            headers
        );

    await saveJson(
        {
            total_sections:
                sections.length,
            sections,
        },
        path.join(
            outputPath,
            `${fileStem}_sections.json`
        ),
        "Sections"
    );

    console.log(
        `Sections detected: ${sections.length}`
    );

    let chunks: Chunk[] =
        createChunks(sections);

    await saveJson(
        {
            total_chunks:
                chunks.length,
            chunks,
        },
        path.join(
            outputPath,
            `${fileStem}_chunks.json`
        ),
        "Chunks"
    );

    console.log(
        `Chunks created: ${chunks.length}`
    );


    chunks =
        appendPreviousText(chunks);


    if (chunks.length > 0) {
        const sizes: number[] = chunks.map(
            chunk => Number(chunk.charCount)
        );

        const smallest =
            Math.min(...sizes);

        const largest =
            Math.max(...sizes);

        const average =
            sizes.reduce(
                (sum: number, size: number): number =>
                    sum + size,
                0
            ) / sizes.length;

        console.log(
            `Smallest chunk: ${smallest.toLocaleString()} chars`
        );

        console.log(
            `Largest chunk:  ${largest.toLocaleString()} chars`
        );

        console.log(
            `Average chunk:  ${Math.round(
                average
            ).toLocaleString()} chars`
        );
    }


    await saveJson(
        {
            total_chunks:
                chunks.length,
            chunks,
        },
        path.join(
            outputPath,
            `${fileStem}_final.json`
        ),
        "Final chunks"
    );

    return chunks;
}



async function resolvePipelinePaths(
    pdf: string,
    outputDir: string
) {
    const pdfPath = path.resolve(pdf);

    try {
        await fs.access(pdfPath);
    } catch {
        throw new Error(
            `PDF not found: ${pdfPath}`
        );
    }

    if (
        path.extname(pdfPath).toLowerCase() !==
        ".pdf"
    ) {
        throw new Error(
            "Input file must be a PDF"
        );
    }


    const outputPath =
        path.resolve(/* turbopackIgnore: true */ outputDir);

    await fs.mkdir(outputPath, {
        recursive: true,
    });

    const fileName =
        path.basename(pdfPath);

    const fileStem =
        path.parse(fileName).name;

    return {
        pdfPath,
        outputPath,
        fileStem,
    };
}



export async function preparePipeline(
    options: Pick<PipelineOptions, "pdf" | "outputDir">,
    // Fired once Layers 1 + 1.5 are done, before the chunk embeddings start.
    onChunksReady?: (totalChunks: number) => void
): Promise<{ total_chunks: number }> {
    const {
        pdfPath,
        outputPath,
        fileStem,
    } = await resolvePipelinePaths(
        options.pdf,
        options.outputDir ?? "output"
    );

    const chunks =
        await getChunks(
            pdfPath,
            outputPath,
            fileStem
        );

    onChunksReady?.(chunks.length);

    // Embedding the chunks is the slow part of Layer 2 and needs no schema,
    // so do it now; retrieval later only embeds the schema query.
    await new ChunkRetriever().embedChunks(chunks);

    return {
        total_chunks: chunks.length,
    };
}



export async function runPipeline(
    options: PipelineOptions
): Promise<PipelineResult> {
    const {
        pdf,
        outputDir = "output",
        schema,
        topK = 15,
        threshold = 0.5,
    } = options;



    const {
        pdfPath,
        outputPath,
        fileStem,
    } = await resolvePipelinePaths(pdf, outputDir);

    const chunks =
        await getChunks(
            pdfPath,
            outputPath,
            fileStem
        );


    let rankedChunks: Chunk[] = [];

    if (schema) {
        let schemaObject: unknown;

        if (typeof schema === "string") {
            const schemaPath =
                path.resolve(schema);

            try {
                await fs.access(schemaPath);
            } catch {
                throw new Error(
                    `Schema not found: ${schemaPath}`
                );
            }

            const schemaContent =
                await fs.readFile(
                    schemaPath,
                    "utf-8"
                );

            schemaObject =
                JSON.parse(schemaContent);
        } else {
            schemaObject = schema;
        }

        console.log();

        console.log(
            "=".repeat(60)
        );

        console.log(
            "LAYER 2: SCHEMA-BASED CHUNK RETRIEVAL"
        );

        console.log(
            "=".repeat(60)
        );

        const retriever =
            new ChunkRetriever();

        rankedChunks =
            await retriever.retrieve(
                chunks,
                schemaObject,
                topK,
                threshold
            );

        await saveJson(
            {
                top_k:
                    rankedChunks.length,

                threshold,

                chunks:
                    rankedChunks,
            },

            path.join(
                outputPath,
                `${fileStem}_top_chunks.json`
            ),

            "Ranked chunks"
        );

        console.log(
            `Ranked chunks: ${rankedChunks.length}`
        );
    }


    console.log();

    console.log(
        "=".repeat(60)
    );

    console.log("DONE");

    console.log(
        "=".repeat(60)
    );

    return {
        total_chunks: chunks.length,
        chunks,
        top_k: rankedChunks.length,
        threshold,
        ranked_chunks: rankedChunks,
    };
}
