import os from "node:os";
import path from "node:path";

import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import natural from "natural";

import type { Chunk } from "./types";

// Serverless platforms (e.g. Vercel) ship a read-only deployment bundle, so
// the model cache can't live inside node_modules. /tmp is the only writable
// directory available at runtime, so redirect the cache there everywhere.
env.cacheDir = path.join(os.tmpdir(), "transformers-cache");

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

const embeddingModels = new Map<string, Promise<FeatureExtractionPipeline>>();

function loadEmbeddingModel(
  modelName: string,
): Promise<FeatureExtractionPipeline> {
  const existingModel = embeddingModels.get(modelName);

  if (existingModel) {
    return existingModel;
  }

  console.log(`Loading embedding model: ${modelName}`);

  const modelPromise = pipeline("feature-extraction", modelName)
    .then((model) => model as FeatureExtractionPipeline)
    .catch((error) => {
      embeddingModels.delete(modelName);
      throw error;
    });

  embeddingModels.set(modelName, modelPromise);

  return modelPromise;
}

void loadEmbeddingModel(EMBEDDING_MODEL).catch((error) => {
  console.error(`Failed to load embedding model: ${EMBEDDING_MODEL}`, error);
});

// Embeddings are content-addressed by (model, chunkId, charCount) so that
// re-running retrieval against the same document with a different schema
// (a common flow: user tweaks the schema and re-extracts) reuses vectors
// instead of re-running the model. Capped and FIFO-evicted to bound memory
// on long-lived serverless instances.
const EMBEDDING_CACHE_LIMIT = 4000;
const embeddingCache = new Map<string, number[]>();

function embeddingCacheKey(modelName: string, chunk: Chunk): string {
  return `${modelName}::${String(chunk.chunkId ?? "")}::${Number(
    chunk.charCount ?? 0,
  )}`;
}

function setEmbeddingCache(key: string, vector: number[]): void {
  if (embeddingCache.size >= EMBEDDING_CACHE_LIMIT) {
    const oldestKey = embeddingCache.keys().next().value;

    if (oldestKey !== undefined) {
      embeddingCache.delete(oldestKey);
    }
  }

  embeddingCache.set(key, vector);
}

export const SEMANTIC_WEIGHT = 0.4;
export const LEXICAL_WEIGHT = 0.3;
export const ENTITY_WEIGHT = 0.2;
export const STRUCTURAL_WEIGHT = 0.1;

export interface ScoreWeights {
  semantic: number;
  lexical: number;
  entity: number;
  structural: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  semantic: SEMANTIC_WEIGHT,
  lexical: LEXICAL_WEIGHT,
  entity: ENTITY_WEIGHT,
  structural: STRUCTURAL_WEIGHT,
};

// Bytes of prior-chunk tail context pulled in when detecting entities/section
// cues, so a value split across a chunk boundary (a table header like
// "Total Amount" in one chunk, "$500" at the start of the next) is still
// attributed to the right chunk instead of being missed entirely.
const BOUNDARY_CONTEXT_CHARS = 200;

export type EntityType =
  | "EMAIL"
  | "PHONE"
  | "DATE"
  | "MONEY"
  | "PERCENT"
  | "NUMBER"
  | "ORG"
  | "PERSON"
  | "ID"
  | "URL";

// Entity types that typically identify a document's own header/metadata
// (who/what/when it's from or about) across most document kinds — a byline,
// a vendor block, an invoice/order/case number, a contact address — as
// opposed to types like MONEY/PERCENT/NUMBER that are just as likely to be
// ordinary content values scattered through the body.
const METADATA_ENTITY_TYPES = new Set<EntityType>([
  "PERSON",
  "ORG",
  "EMAIL",
  "PHONE",
  "DATE",
  "ID",
]);

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

// Domain-general vocabulary: covers document metadata (name/org/date/title),
// commerce documents (invoices/receipts/orders), and correspondence/contracts
// (parties, references, contact info) without assuming any one document type.
export const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ["name", "full name", "person name", "contact name"],

  author: [
    "author",
    "authors",
    "written by",
    "prepared by",
    "signed by",
    "submitted by",
  ],

  organization: [
    "organization",
    "organisation",
    "institution",
    "company",
    "university",
    "institute",
    "department",
    "business",
    "firm",
    "corporation",
    "employer",
  ],

  affiliation: [
    "affiliation",
    "institution",
    "university",
    "department",
    "institute",
  ],

  party: [
    "party",
    "vendor",
    "merchant",
    "supplier",
    "seller",
    "buyer",
    "customer",
    "client",
    "payer",
    "payee",
    "store",
  ],

  title: [
    "title",
    "document title",
    "paper title",
    "report title",
    "heading",
    "subject",
  ],

  keyword: ["keyword", "keywords", "key words", "key terms", "index terms"],

  date: [
    "date",
    "day",
    "month",
    "year",
    "published",
    "created",
    "issued",
    "due",
    "expiry",
    "expiration",
    "effective",
  ],

  amount: [
    "amount",
    "total",
    "subtotal",
    "balance",
    "cost",
    "price",
    "value",
    "fee",
    "payment",
    "payable",
    "charge",
  ],

  identifier: [
    "identifier",
    "id",
    "number",
    "reference",
    "reference number",
    "code",
  ],

  item: ["item", "product", "description", "goods", "service", "line item"],

  quantity: ["quantity", "count", "units"],

  status: ["status", "state"],

  address: [
    "address",
    "location",
    "place",
    "residence",
    "street",
    "city",
    "postal code",
    "zip code",
  ],

  email: ["email", "e-mail", "email address"],

  phone: ["phone", "telephone", "mobile", "contact number", "fax", "cell"],

  percentage: ["percentage", "percent", "rate", "ratio"],

  website: ["url", "website", "link", "site"],
};

export const ENTITY_PATTERNS: Record<Exclude<EntityType, "PERSON">, RegExp> = {
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,

  PHONE: /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g,

  DATE: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/gi,

  MONEY:
    /(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|INR|Rs\.?)\b)/gi,

  PERCENT: /\b\d+(?:\.\d+)?\s?%/g,

  NUMBER: /\b\d+(?:\.\d+)?\b/g,

  // Business-entity suffixes (Ltd/Inc/LLC/…) alongside the original
  // academic-institution words, so this fires for a company as readily as
  // a university.
  ORG: /\b(?:University|Institute|College|Department|Corporation|Corp\.?|Company|Ltd\.?|Limited|Inc\.?|LLC|LLP|PLC|GmbH|Co\.|Group|Holdings|Partners|Enterprises|Associates)\b/gi,

  // A loose "reference code" shape: an invoice/order/ticket/case number —
  // a run of letters+digits with an optional separator (INV-2024-0091,
  // PO#12345, ORD_88213), or a bare "#12345" style reference.
  ID: /\b[A-Za-z]{2,6}[-_#/]\w{2,}(?:[-_/]\w+)*\b|#\d{3,}\b/g,

  URL: /\bhttps?:\/\/\S+\b|\bwww\.\S+\b/gi,
};

export interface SchemaField {
  /** Dotted field path, e.g. "order_items.item.price". */
  path: string;
  /**
   * Declared leaf type from the schema (e.g. "string", "number", "double"),
   * lowercased. Undefined for container fields (objects/arrays) and for
   * schemas that still use untyped placeholders like "" or [].
   */
  type?: string;
}

function leafType(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  return normalized === "" ? undefined : normalized;
}

export function flattenSchema(schema: unknown, prefix = ""): SchemaField[] {
  const fields: SchemaField[] = [];

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return fields;
  }

  for (const [key, value] of Object.entries(schema)) {
    const fieldName = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      fields.push(...flattenSchema(value, fieldName));
    } else if (Array.isArray(value)) {
      fields.push({ path: fieldName });

      if (
        value.length > 0 &&
        typeof value[0] === "object" &&
        value[0] !== null &&
        !Array.isArray(value[0])
      ) {
        fields.push(...flattenSchema(value[0], fieldName));
      }
    } else {
      fields.push({ path: fieldName, type: leafType(value) });
    }
  }

  return fields;
}

export function normalizeFieldName(field: string): string {
  const lastPart = field.split(".").pop() ?? field;

  const normalized = lastPart
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

  return normalized.toLowerCase().trim();
}

export function expandField(field: string): string[] {
  const normalized = normalizeFieldName(field);

  const terms = new Set<string>();

  terms.add(normalized);

  for (const word of normalized.split(/\s+/)) {
    const synonyms = FIELD_SYNONYMS[word];

    if (synonyms) {
      for (const synonym of synonyms) {
        terms.add(synonym);
      }
    }
  }

  for (const [key, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    if (normalized.includes(key)) {
      for (const synonym of synonyms) {
        terms.add(synonym);
      }
    }
  }

  return Array.from(terms).sort();
}

// Schema type-name aliases that indicate "some number", used only as a
// fallback when the field's own name gives no more specific signal (a
// MONEY/PERCENT match from the name always wins over this).
const NUMERIC_TYPE_NAMES = new Set([
  "number",
  "num",
  "integer",
  "int",
  "float",
  "double",
  "decimal",
  "long",
]);

// A bare "name" is one of the most overloaded words in any schema — a
// person's name, but just as often a store/item/product/company/file/model
// name. normalizeFieldName only keeps the last dotted path segment (so
// "order_items.item.name" normalizes to just "name", same as a top-level
// "name" field), so disambiguating has to look at both the compound leaf
// text ("store_name" -> "store name") and, for nested paths, the parent
// segment that got stripped away.
const NON_PERSON_NAME_CONTEXTS = [
  "store",
  "item",
  "product",
  "organization",
  "organisation",
  "company",
  "business",
  "vendor",
  "merchant",
  "supplier",
  "file",
  "document",
  "category",
  "brand",
  "project",
  "model",
  "field",
  "column",
  "table",
  "application",
  "algorithm",
  "environment",
];

function hasNonPersonNameContext(field: string, normalized: string): boolean {
  if (
    NON_PERSON_NAME_CONTEXTS.some((word) => normalized.includes(`${word} name`))
  ) {
    return true;
  }

  const segments = field.split(".");

  if (segments.length >= 2) {
    const parent = normalizeFieldName(segments[segments.length - 2]);

    if (NON_PERSON_NAME_CONTEXTS.some((word) => parent.includes(word))) {
      return true;
    }
  }

  return false;
}

export function inferEntityTypes(
  field: string,
  declaredType?: string,
): Set<EntityType> {
  const normalized = normalizeFieldName(field);

  const types = new Set<EntityType>();

  const mentionsPersonWord = ["author", "person", "researcher"].some((word) =>
    normalized.includes(word),
  );

  const mentionsName =
    normalized.includes("name") && !hasNonPersonNameContext(field, normalized);

  if (mentionsPersonWord || mentionsName) {
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
      "vendor",
      "merchant",
      "supplier",
      "employer",
      "business",
      "firm",
      "corporation",
      "store",
    ].some((word) => normalized.includes(word))
  ) {
    types.add("ORG");
  }

  if (
    ["date", "day", "month", "year"].some((word) => normalized.includes(word))
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
    ].some((word) => normalized.includes(word))
  ) {
    types.add("MONEY");
  }

  if (
    ["percentage", "percent", "ratio", "rate"].some((word) =>
      normalized.includes(word),
    )
  ) {
    types.add("PERCENT");
  }

  if (normalized.includes("email")) {
    types.add("EMAIL");
  }

  if (
    ["phone", "mobile", "telephone"].some((word) => normalized.includes(word))
  ) {
    types.add("PHONE");
  }

  // Deliberately excludes a bare "number" — that alone is too generic
  // (it would also fire for "phone number", "page number", …) and dilute
  // the expected-type set for fields that are really a different type.
  if (
    [
      "id",
      "identifier",
      "reference",
      "code",
      "invoice",
      "order",
      "ticket",
      "case",
      "tracking",
      "serial",
      "account",
    ].some((word) => normalized.includes(word))
  ) {
    types.add("ID");
  }

  if (
    ["url", "website", "link", "site"].some((word) => normalized.includes(word))
  ) {
    types.add("URL");
  }

  // The field name gave no specific signal, but the schema itself declares
  // this a numeric field (e.g. "quantity": "number", "tax_rate": "double")
  // — fall back to expecting a plain number, so entity scoring still rewards
  // chunks that contain an actual numeric value for it.
  if (
    types.size === 0 &&
    declaredType &&
    NUMERIC_TYPE_NAMES.has(declaredType)
  ) {
    types.add("NUMBER");
  }

  return types;
}

export function detectEntities(text: string): Record<EntityType, number> {
  const counts = {} as Record<EntityType, number>;

  for (const [entityType, pattern] of Object.entries(ENTITY_PATTERNS)) {
    // Reset regex state because patterns are global.
    pattern.lastIndex = 0;

    const matches = text.match(pattern);

    counts[entityType as EntityType] = matches?.length ?? 0;
  }

  // Simple PERSON detection.
  const personMatches = text.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g);

  counts.PERSON = personMatches?.length ?? 0;

  return counts;
}

// A field's value is sometimes introduced right at a chunk boundary (a table
// header or "Total:" label at the tail of one chunk, the value at the head
// of the next). Pulling in the previous chunk's tail before scanning for
// entities and section cues recovers those without changing what text is
// actually shown to the caller.
export function boundaryContext(
  chunk: Chunk,
  tailChars: number = BOUNDARY_CONTEXT_CHARS,
): string {
  const text = String(chunk.text ?? "");
  const prevTail = String(chunk.prevText ?? "").slice(-tailChars);

  return prevTail ? `${prevTail}\n${text}` : text;
}

export function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) {
    return [];
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);

  if (max === min) {
    return scores.map(() => 0);
  }

  return scores.map((score) => (score - min) / (max - min));
}

function dotProduct(a: number[], b: number[]): number {
  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result += a[i] * b[i];
  }

  return result;
}

export function lexicalScores(chunks: Chunk[], queryTerms: string[]): number[] {
  if (chunks.length === 0 || queryTerms.length === 0) {
    return new Array(chunks.length).fill(0);
  }

  const texts: string[] = chunks.map((chunk) => String(chunk.text));

  const query = queryTerms.join(" ");

  const tfidf = new natural.TfIdf();

  // Only the chunk texts form the corpus. Adding the query itself as a
  // document (as before) inflates the document frequency of the exact terms
  // being scored, which deflates their IDF and understates their relevance.
  for (const text of texts) {
    tfidf.addDocument(text);
  }

  const scores: number[] = new Array(texts.length).fill(0);

  tfidf.tfidfs(query, (documentIndex: number, value: number): void => {
    scores[documentIndex] = value;
  });

  return normalizeScores(scores);
}

// Entity scoring

export function entityScores(
  chunks: Chunk[],
  expectedTypes: Set<EntityType>,
): number[] {
  const scores: number[] = [];

  for (const chunk of chunks) {
    const counts = detectEntities(boundaryContext(chunk));

    let score = 0;

    for (const entityType of expectedTypes) {
      if ((counts[entityType] ?? 0) > 0) {
        score++;
      }
    }

    scores.push(expectedTypes.size > 0 ? score / expectedTypes.size : 0);
  }

  return normalizeScores(scores);
}

const LOW_VALUE_SECTION_KEYWORDS = [
  "reference",
  "bibliography",
  "footnote",
  "disclaimer",
  "appendix",
  "boilerplate",
];

export function structuralScores(
  chunks: Chunk[],
  fields: SchemaField[],
): number[] {
  const fieldWords = Array.from(
    new Set(
      fields
        .flatMap((field) => expandField(field.path))
        .join(" ")
        .split(/\s+/)
        .filter((word) => word.length > 3),
    ),
  );

  // Two independent signals for "this schema is asking about the document's
  // own header/metadata, not its body content" — kept as an OR so neither
  // has to cover every document kind on its own:
  //  1. a fixed vocabulary list, tuned for document/report metadata
  //     (title, authors, keywords, ...);
  //  2. whether any field resolves to a "metadata-shaped" entity type
  //     (PERSON/ORG/EMAIL/PHONE/DATE/ID) via the same inference used for
  //     entity scoring — this is what generalizes the bonus to invoices,
  //     contracts, resumes, etc. without hardcoding their vocabulary too.
  const metadataFields = [
    "title",
    "author",
    "authors",
    "affiliation",
    "keyword",
    "keywords",
    "organization",
    "subject",
  ];

  const fieldText = fields.map((field) => normalizeFieldName(field.path)).join(" ");

  const hasMetadataKeyword = metadataFields.some((field) =>
    fieldText.includes(field),
  );

  const hasMetadataEntitySignal = fields.some((field) =>
    Array.from(inferEntityTypes(field.path, field.type)).some((type) =>
      METADATA_ENTITY_TYPES.has(type),
    ),
  );

  const looksLikeMetadataQuery = hasMetadataKeyword || hasMetadataEntitySignal;

  const scores: number[] = [];

  for (const chunk of chunks) {
    const section = String(chunk.section ?? "").toLowerCase();

    // The last line or two of the previous chunk often carries the heading
    // or label that this chunk's content belongs under (e.g. a table header
    // just before the row data starts in the next chunk).
    const prevTail = String(chunk.prevText ?? "")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-2)
      .join(" ")
      .toLowerCase();

    let score = 0;

    for (const word of fieldWords) {
      if (section.includes(word)) {
        score += 1;
      }

      if (prevTail.includes(word)) {
        score += 0.5;
      }
    }

    const sectionLevel = Number(chunk.sectionLevel ?? 0);
    const sectionId = Number(chunk.sectionId ?? 0);
    const chunkIndex = Number(chunk.chunkIndex ?? 0);

    // Document metadata (title/authors/affiliations/keywords) sits in the
    // opening section of the document: the first section id, at a shallow
    // heading level, near the start of the chunk stream. Using sectionId in
    // addition to chunkIndex catches cases where the opening section spans
    // more chunks than the previous fixed "chunkIndex <= 2" cutoff allowed.
    if (
      looksLikeMetadataQuery &&
      sectionId === 0 &&
      sectionLevel <= 1 &&
      chunkIndex <= 3
    ) {
      score += 2;
    }

    // Sections that are dense with names/dates/numbers but almost never
    // hold the field's actual value, across document kinds — a paper's
    // citation list, a contract's boilerplate/disclaimer, an appendix.
    // Deliberately narrow: something like "terms and conditions" is left
    // out, since for a contract schema that section can be the actual
    // substance being asked for.
    if (LOW_VALUE_SECTION_KEYWORDS.some((word) => section.includes(word))) {
      score -= 2;
    }

    scores.push(score);
  }

  return normalizeScores(scores);
}

// Adapts the blend of scoring signals to what the schema is actually asking
// for. Fields that resolve to well-known entity types (names, orgs, dates,
// emails) are found reliably by pattern + document-position cues, so entity
// and structural signals are trusted more. Fields with no entity signal
// (free-text summaries, descriptions) have nothing for regex matching to
// grab onto, so semantic + lexical similarity carry the weight instead.
export function computeAdaptiveWeights(
  fields: SchemaField[],
  expectedTypes: Set<EntityType>,
): ScoreWeights {
  if (fields.length === 0) {
    return DEFAULT_WEIGHTS;
  }

  const hasMetadataSignal = Array.from(expectedTypes).some((type) =>
    METADATA_ENTITY_TYPES.has(type),
  );

  const entityCoverage = expectedTypes.size / fields.length;

  if (expectedTypes.size === 0) {
    return { semantic: 0.5, lexical: 0.35, entity: 0, structural: 0.15 };
  }

  if (entityCoverage >= 0.5 && hasMetadataSignal) {
    return { semantic: 0.3, lexical: 0.2, entity: 0.3, structural: 0.2 };
  }

  return DEFAULT_WEIGHTS;
}

// Greedy Maximal Marginal Relevance: trades a little relevance for
// diversity so the final top-K isn't dominated by several near-duplicate
// chunks (e.g. paragraphs that all restate the same figure), which would
// otherwise waste retrieval budget that could cover more distinct fields.
export function mmrRerank(
  candidates: RetrievedChunk[],
  embeddingsByChunkId: Map<string, number[]>,
  topK: number,
  lambda: number = 0.7,
): RetrievedChunk[] {
  const pool = [...candidates];
  const selected: RetrievedChunk[] = [];

  while (selected.length < topK && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    pool.forEach((candidate, index) => {
      const relevance = candidate.scores.final;
      const candidateVector = embeddingsByChunkId.get(
        String(candidate.chunkId),
      );

      let maxSimilarity = 0;

      if (candidateVector) {
        for (const sel of selected) {
          const selVector = embeddingsByChunkId.get(String(sel.chunkId));

          if (selVector) {
            maxSimilarity = Math.max(
              maxSimilarity,
              dotProduct(candidateVector, selVector),
            );
          }
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    });

    selected.push(pool[bestIndex]);
    pool.splice(bestIndex, 1);
  }

  return selected;
}

export interface RetrieveOptions {
  topK?: number;
  threshold?: number;
  /** Blend semantic/lexical/entity/structural weights per schema. Default true. */
  adaptiveWeights?: boolean;
  /** Diversify the final top-K via MMR instead of a plain score cutoff. Default true. */
  diversify?: boolean;
  /** Relevance/diversity trade-off for MMR: 1 = pure relevance, 0 = pure diversity. */
  mmrLambda?: number;
}

export class ChunkRetriever {
  private embeddingModelName: string;

  constructor(embeddingModel: string = EMBEDDING_MODEL) {
    this.embeddingModelName = embeddingModel;
  }

  private async loadModel(): Promise<FeatureExtractionPipeline> {
    return loadEmbeddingModel(this.embeddingModelName);
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const model = await this.loadModel();

    const output = await model(texts, {
      pooling: "mean",
      normalize: true,
    });

    const dims = output.dims as number[];
    const hidden = dims[dims.length - 1];
    const data = output.data as Float32Array;

    const vectors: number[][] = [];

    for (let i = 0; i < texts.length; i++) {
      vectors.push(Array.from(data.subarray(i * hidden, (i + 1) * hidden)));
    }

    return vectors;
  }

  private async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);

    return vector;
  }

  private async embedChunks(chunks: Chunk[]): Promise<number[][]> {
    const results: (number[] | undefined)[] = new Array(chunks.length);
    const missIndices: number[] = [];
    const missTexts: string[] = [];

    chunks.forEach((chunk, index) => {
      const key = embeddingCacheKey(this.embeddingModelName, chunk);
      const cached = embeddingCache.get(key);

      if (cached) {
        results[index] = cached;
      } else {
        missIndices.push(index);
        missTexts.push(String(chunk.text ?? ""));
      }
    });

    if (missTexts.length > 0) {
      const vectors = await this.embedBatch(missTexts);

      missIndices.forEach((chunkIndex, missIndex) => {
        const vector = vectors[missIndex];

        results[chunkIndex] = vector;
        setEmbeddingCache(
          embeddingCacheKey(this.embeddingModelName, chunks[chunkIndex]),
          vector,
        );
      });
    }

    return results as number[][];
  }

  async retrieve(
    chunks: Chunk[],
    schema: unknown,
    topK: number = 5,
    threshold: number = 0.5,
    options: RetrieveOptions = {},
  ): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const { adaptiveWeights = true, diversify = true, mmrLambda = 0.7 } =
      options;

    // 1. Flatten schema

    const fields = flattenSchema(schema);

    // 2. Expand schema fields

    const expandedTerms = Array.from(
      new Set(fields.flatMap((field) => expandField(field.path))),
    ).sort();

    const expectedTypes = new Set<EntityType>();

    for (const field of fields) {
      for (const entityType of inferEntityTypes(field.path, field.type)) {
        expectedTypes.add(entityType);
      }
    }

    const query = expandedTerms.join(" ");

    const weights = adaptiveWeights
      ? computeAdaptiveWeights(fields, expectedTypes)
      : DEFAULT_WEIGHTS;

    const [chunkEmbeddings, queryEmbedding] = await Promise.all([
      this.embedChunks(chunks),
      this.embed(query),
    ]);

    const semanticRaw = chunkEmbeddings.map((embedding) =>
      dotProduct(embedding, queryEmbedding),
    );

    const semantic = normalizeScores(semanticRaw);

    const lexical = lexicalScores(chunks, expandedTerms);

    const entity = entityScores(chunks, expectedTypes);

    const structural = structuralScores(chunks, fields);

    const final = chunks.map(
      (_, index) =>
        weights.semantic * semantic[index] +
        weights.lexical * lexical[index] +
        weights.entity * entity[index] +
        weights.structural * structural[index],
    );

    const ranked: RetrievedChunk[] = chunks.map((chunk, index) => ({
      ...chunk,

      scores: {
        semantic: Number(semantic[index].toFixed(4)),

        lexical: Number(lexical[index].toFixed(4)),

        entity: Number(entity[index].toFixed(4)),

        structural: Number(structural[index].toFixed(4)),

        final: Number(final[index].toFixed(4)),
      },

      threshold,

      passesThreshold: final[index] >= threshold,

      rank: 0,
    }));

    ranked.sort((a, b) => b.scores.final - a.scores.final);

    let selected: RetrievedChunk[];

    if (diversify) {
      const embeddingsByChunkId = new Map<string, number[]>();

      chunks.forEach((chunk, index) => {
        embeddingsByChunkId.set(
          String(chunk.chunkId),
          chunkEmbeddings[index],
        );
      });

      // Re-rank within a pool larger than topK so diversification has
      // genuine alternatives to pick from, not just the same top hits.
      const poolSize = Math.min(ranked.length, Math.max(topK * 4, topK + 5));

      selected = mmrRerank(
        ranked.slice(0, poolSize),
        embeddingsByChunkId,
        topK,
        mmrLambda,
      );
    } else {
      selected = ranked.slice(0, topK);
    }

    selected.forEach((chunk, index) => {
      chunk.rank = index + 1;
    });

    return selected;
  }
}
