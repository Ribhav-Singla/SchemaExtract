import os from "node:os";
import path from "node:path";

import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import natural from "natural";

import type { Chunk } from "./types";

// Serverless platforms (e.g. Vercel) ship a read-only deployment bundle, so
// the model cache can't live inside node_modules. /tmp is the only writable
// directory available at runtime, so redirect the cache there everywhere.
env.cacheDir = path.join(os.tmpdir(), "transformers-cache");

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

const embeddingModels = new Map<
    string,
    Promise<FeatureExtractionPipeline>
>();

function loadEmbeddingModel(
    modelName: string
): Promise<FeatureExtractionPipeline> {
    const existingModel = embeddingModels.get(modelName);

    if (existingModel) {
        return existingModel;
    }

    console.log(
        `Loading embedding model: ${modelName}`
    );

    const modelPromise = pipeline(
        "feature-extraction",
        modelName
    ).then(
        model => model as FeatureExtractionPipeline
    ).catch(error => {
        embeddingModels.delete(modelName);
        throw error;
    });

    embeddingModels.set(modelName, modelPromise);

    return modelPromise;
}

void loadEmbeddingModel(EMBEDDING_MODEL).catch(
    error => {
        console.error(
            `Failed to load embedding model: ${EMBEDDING_MODEL}`,
            error
        );
    }
);

export const SEMANTIC_WEIGHT = 0.40;
export const LEXICAL_WEIGHT = 0.30;
export const ENTITY_WEIGHT = 0.20;
export const STRUCTURAL_WEIGHT = 0.10;


export type EntityType =
    | "EMAIL"
    | "PHONE"
    | "DATE"
    | "MONEY"
    | "PERCENT"
    | "NUMBER"
    | "ORG"
    | "PERSON";

export interface RetrievalScores {
    semantic: number;
    lexical: number;
    entity: number;
    structural: number;
    final: number;
}

export interface RetrievedChunk extends Chunk {
    scores: RetrievalScores;
    threshold: number;
    passesThreshold: boolean;
    rank: number;
}


export const FIELD_SYNONYMS: Record<string, string[]> = {
    name: ["name", "full name", "person name"],

    author: [
        "author",
        "authors",
        "written by",
    ],

    organization: [
        "organization",
        "organisation",
        "institution",
        "company",
        "university",
        "institute",
        "department",
    ],

    affiliation: [
        "affiliation",
        "institution",
        "university",
        "department",
        "institute",
    ],

    title: [
        "title",
        "document title",
        "paper title",
        "report title",
        "heading",
    ],

    keyword: [
        "keyword",
        "keywords",
        "key words",
        "key terms",
        "index terms",
    ],

    date: [
        "date",
        "day",
        "month",
        "year",
        "published",
        "created",
        "issued",
    ],

    amount: [
        "amount",
        "total",
        "cost",
        "price",
        "value",
        "fee",
        "payment",
        "payable",
    ],

    address: [
        "address",
        "location",
        "place",
        "residence",
    ],

    email: [
        "email",
        "e-mail",
        "email address",
    ],

    phone: [
        "phone",
        "telephone",
        "mobile",
        "contact number",
    ],

    percentage: [
        "percentage",
        "percent",
        "rate",
        "ratio",
    ],
};


export const ENTITY_PATTERNS: Record<
    Exclude<EntityType, "PERSON">,
    RegExp
> = {
    EMAIL:
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,

    PHONE:
        /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g,

    DATE:
        /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/gi,

    MONEY:
        /(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|INR|Rs\.?)\b)/gi,

    PERCENT:
        /\b\d+(?:\.\d+)?\s?%/g,

    NUMBER:
        /\b\d+(?:\.\d+)?\b/g,

    ORG:
        /\b(?:University|Institute|College|Department|Corporation|Corp\.?|Company|Ltd\.?|Limited|Inc\.?)\b/gi,
};


export function flattenSchema(
    schema: unknown,
    prefix = ""
): string[] {
    const fields: string[] = [];

    if (
        typeof schema !== "object" ||
        schema === null ||
        Array.isArray(schema)
    ) {
        return fields;
    }

    for (const [key, value] of Object.entries(schema)) {
        const fieldName = prefix
            ? `${prefix}.${key}`
            : key;

        if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
        ) {
            fields.push(
                ...flattenSchema(value, fieldName)
            );
        } else if (Array.isArray(value)) {
            fields.push(fieldName);

            if (
                value.length > 0 &&
                typeof value[0] === "object" &&
                value[0] !== null &&
                !Array.isArray(value[0])
            ) {
                fields.push(
                    ...flattenSchema(
                        value[0],
                        fieldName
                    )
                );
            }
        } else {
            fields.push(fieldName);
        }
    }

    return fields;
}


export function normalizeFieldName(
    field: string
): string {
    const lastPart =
        field.split(".").pop() ?? field;

    const normalized = lastPart
        .replace(/[_-]+/g, " ")
        .replace(
            /([a-z])([A-Z])/g,
            "$1 $2"
        );

    return normalized
        .toLowerCase()
        .trim();
}


export function expandField(
    field: string
): string[] {
    const normalized =
        normalizeFieldName(field);

    const terms = new Set<string>();

    terms.add(normalized);

    for (const word of normalized.split(/\s+/)) {
        const synonyms =
            FIELD_SYNONYMS[word];

        if (synonyms) {
            for (const synonym of synonyms) {
                terms.add(synonym);
            }
        }
    }

    for (const [key, synonyms] of Object.entries(
        FIELD_SYNONYMS
    )) {
        if (normalized.includes(key)) {
            for (const synonym of synonyms) {
                terms.add(synonym);
            }
        }
    }

    return Array.from(terms).sort();
}


export function inferEntityTypes(
    field: string
): Set<EntityType> {
    const normalized =
        normalizeFieldName(field);

    const types = new Set<EntityType>();

    if (
        ["name", "author", "person", "researcher"]
            .some(word => normalized.includes(word))
    ) {
        types.add("PERSON");
    }

    if (
        [
            "organization",
            "organisation",
            "company",
            "university",
            "institution",
            "institute",
            "department",
            "affiliation",
        ].some(word =>
            normalized.includes(word)
        )
    ) {
        types.add("ORG");
    }

    if (
        ["date", "day", "month", "year"]
            .some(word => normalized.includes(word))
    ) {
        types.add("DATE");
    }

    if (
        [
            "amount",
            "price",
            "cost",
            "fee",
            "payment",
            "total",
            "salary",
            "revenue",
        ].some(word =>
            normalized.includes(word)
        )
    ) {
        types.add("MONEY");
    }

    if (
        ["percentage", "percent", "ratio", "rate"]
            .some(word => normalized.includes(word))
    ) {
        types.add("PERCENT");
    }

    if (normalized.includes("email")) {
        types.add("EMAIL");
    }

    if (
        ["phone", "mobile", "telephone"]
            .some(word =>
                normalized.includes(word)
            )
    ) {
        types.add("PHONE");
    }

    return types;
}


export function detectEntities(
    text: string
): Record<EntityType, number> {
    const counts = {} as Record<
        EntityType,
        number
    >;

    for (const [entityType, pattern] of Object.entries(
        ENTITY_PATTERNS
    )) {
        // Reset regex state because patterns are global.
        pattern.lastIndex = 0;

        const matches =
            text.match(pattern);

        counts[entityType as EntityType] =
            matches?.length ?? 0;
    }

    // Simple PERSON detection.
    const personMatches = text.match(
        /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g
    );

    counts.PERSON =
        personMatches?.length ?? 0;

    return counts;
}


export function normalizeScores(
    scores: number[]
): number[] {
    if (scores.length === 0) {
        return [];
    }

    const min = Math.min(...scores);
    const max = Math.max(...scores);

    if (max === min) {
        return scores.map(() => 0);
    }

    return scores.map(
        score =>
            (score - min) /
            (max - min)
    );
}


function dotProduct(
    a: number[],
    b: number[]
): number {
    let result = 0;

    for (let i = 0; i < a.length; i++) {
        result += a[i] * b[i];
    }

    return result;
}


export function lexicalScores(
    chunks: Chunk[],
    queryTerms: string[]
): number[] {
    if (
        chunks.length === 0 ||
        queryTerms.length === 0
    ) {
        return new Array(chunks.length).fill(0);
    }

    const texts: string[] = chunks.map(
        chunk => String(chunk.text)
    );

    const query = queryTerms.join(" ");

    const documents: string[] = [
        ...texts,
        query,
    ];

    const tfidf =
        new natural.TfIdf();

    for (const document of documents) {
        tfidf.addDocument(document);
    }

    const queryIndex =
        documents.length - 1;

    const scores: number[] = [];

    for (
        let index = 0;
        index < queryIndex;
        index++
    ) {
        let score = 0;

        tfidf.tfidfs(
            query,
            (documentIndex: number, value: number): void => {
                if (
                    documentIndex === index
                ) {
                    score = value;
                }
            }
        );

        scores.push(score);
    }

    return normalizeScores(scores);
}



// Entity scoring


export function entityScores(
    chunks: Chunk[],
    expectedTypes: Set<EntityType>
): number[] {
    const scores: number[] = [];

    for (const chunk of chunks) {
        const counts =
            detectEntities(String(chunk.text));

        let score = 0;

        for (const entityType of expectedTypes) {
            if (
                (counts[entityType] ?? 0) > 0
            ) {
                score++;
            }
        }

        scores.push(
            expectedTypes.size > 0
                ? score / expectedTypes.size
                : 0
        );
    }

    return normalizeScores(scores);
}


export function structuralScores(
    chunks: Chunk[],
    fields: string[]
): number[] {
    const fieldText = fields
        .map(normalizeFieldName)
        .join(" ");

    const metadataFields = [
        "title",
        "author",
        "authors",
        "affiliation",
        "keyword",
        "keywords",
        "organization",
    ];

    const scores: number[] = [];

    for (const chunk of chunks) {
        const section = String(chunk.section ?? "").toLowerCase();

        let score = 0;

        for (const word of fieldText.split(/\s+/)) {
            if (
                word.length > 3 &&
                section.includes(word)
            ) {
                score++;
            }
        }

        if (
            metadataFields.some(
                field =>
                    fieldText.includes(field)
            ) &&
            Number(chunk.chunkIndex ?? 0) <= 2
        ) {
            score += 2;
        }

        if (
            section.includes("reference") ||
            section.includes("bibliography")
        ) {
            score -= 2;
        }

        scores.push(score);
    }

    return normalizeScores(scores);
}


export class ChunkRetriever {
    private embeddingModelName: string;

    constructor(
        embeddingModel: string = EMBEDDING_MODEL
    ) {
        this.embeddingModelName =
            embeddingModel;
    }

    private async loadModel(): Promise<FeatureExtractionPipeline> {
        return loadEmbeddingModel(
            this.embeddingModelName
        );
    }

    private async embed(
        text: string
    ): Promise<number[]> {
        const model =
            await this.loadModel();

        const output = await model(
            text,
            {
                pooling: "mean",
                normalize: true,
            }
        );

        return Array.from(
            output.data as Float32Array
        );
    }

    async retrieve(
        chunks: Chunk[],
        schema: unknown,
        topK: number = 5,
        threshold: number = 0.5
    ): Promise<RetrievedChunk[]> {
        if (chunks.length === 0) {
            return [];
        }


        // 1. Flatten schema


        const fields =
            flattenSchema(schema);


        // 2. Expand schema fields


        const expandedTerms = Array.from(
            new Set(
                fields.flatMap(field =>
                    expandField(field)
                )
            )
        ).sort();


        const expectedTypes =
            new Set<EntityType>();

        for (const field of fields) {
            for (const entityType of inferEntityTypes(field)) {
                expectedTypes.add(entityType);
            }
        }


        const query =
            expandedTerms.join(" ");


        const texts: string[] = chunks.map(
            chunk => String(chunk.text ?? "")
        );

        const allTexts = [
            ...texts,
            query,
        ];

        const embeddings: number[][] = [];

        for (const text of allTexts) {
            embeddings.push(
                await this.embed(text)
            );
        }

        const queryEmbedding =
            embeddings[embeddings.length - 1];


        const semanticRaw =
            embeddings
                .slice(0, -1)
                .map(embedding =>
                    dotProduct(
                        embedding,
                        queryEmbedding
                    )
                );

        const semantic =
            normalizeScores(
                semanticRaw
            );

        const lexical =
            lexicalScores(
                chunks,
                expandedTerms
            );


        const entity =
            entityScores(
                chunks,
                expectedTypes
            );


        const structural =
            structuralScores(
                chunks,
                fields
            );


        const final = chunks.map(
            (_, index) =>
                SEMANTIC_WEIGHT *
                semantic[index] +
                LEXICAL_WEIGHT *
                lexical[index] +
                ENTITY_WEIGHT *
                entity[index] +
                STRUCTURAL_WEIGHT *
                structural[index]
        );


        const ranked: RetrievedChunk[] =
            chunks.map(
                (chunk, index) => ({
                    ...chunk,

                    scores: {
                        semantic:
                            Number(
                                semantic[index].toFixed(
                                    4
                                )
                            ),

                        lexical:
                            Number(
                                lexical[index].toFixed(
                                    4
                                )
                            ),

                        entity:
                            Number(
                                entity[index].toFixed(
                                    4
                                )
                            ),

                        structural:
                            Number(
                                structural[index].toFixed(
                                    4
                                )
                            ),

                        final:
                            Number(
                                final[index].toFixed(
                                    4
                                )
                            ),
                    },

                    threshold,

                    passesThreshold:
                        final[index] >=
                        threshold,

                    rank: 0,
                })
            );


        ranked.sort(
            (a, b) =>
                b.scores.final -
                a.scores.final
        );


        ranked.forEach(
            (chunk, index) => {
                chunk.rank = index + 1;
            }
        );

        return ranked.slice(0, topK);
    }
}