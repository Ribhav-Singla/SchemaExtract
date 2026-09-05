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



export async function runPipeline(
    options: PipelineOptions
): Promise<PipelineResult> {
    const {
        pdf,
        outputDir = "output",
        schema,
        topK = 5,
        threshold = 0.5,
    } = options;



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
        path.resolve(outputDir);

    await fs.mkdir(outputPath, {
        recursive: true,
    });

    const fileName =
        path.basename(pdfPath);

    const fileStem =
        path.parse(fileName).name;

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

    let chunks =
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
