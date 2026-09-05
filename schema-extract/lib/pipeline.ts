import pdf from "pdf-parse";
import { env, pipeline } from "@huggingface/transformers";
import { createServerLogger, type ServerLogger } from "@/lib/logger";

type Section = {
  section_id: number;
  heading: string;
  heading_level: number;
  content: string;
};
export type Chunk = {
  chunk_id: string;
  chunk_index: number;
  section: string;
  section_level: number;
  section_id: number;
  text: string;
  char_count: number;
  word_count: number;
  prev_text: string;
};

export type RankedChunk = Chunk & {
  rank: number;
  threshold: number;
  passes_threshold: boolean;
  scores: {
    semantic: number;
    lexical: number;
    entity: number;
    structural: number;
    final: number;
  };
};

const synonyms: Record<string, string[]> = {
  name: ["name", "full name", "person name"],
  author: ["author", "authors", "written by"],
  organization: [
    "organization",
    "institution",
    "company",
    "university",
    "institute",
    "department",
  ],
  title: ["title", "document title", "paper title", "report title", "heading"],
  keyword: ["keyword", "keywords", "key terms"],
  date: ["date", "year", "published", "created"],
  amount: ["amount", "total", "cost", "price", "value", "fee", "payment"],
  environment: ["environment", "dataset", "simulation", "setting"],
  algorithm: ["algorithm", "method", "model", "approach"],
};

const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
env.backends.onnx.executionProviders = ["wasm"];
type EmbeddingOutput = { dims: number[]; data: ArrayLike<number> };
type FeatureExtractor = (
  input: string | string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<EmbeddingOutput>;
const startupLogger = createServerLogger("server-startup");

async function loadFeatureExtractor(): Promise<FeatureExtractor> {
  startupLogger.stage("embedding_model_loading_started", {
    model: EMBEDDING_MODEL,
    backend: "wasm",
  });
  const extractor = await (pipeline(
    "feature-extraction",
    EMBEDDING_MODEL,
  ) as unknown as Promise<FeatureExtractor>);
  startupLogger.stage("embedding_model_loaded", {
    model: EMBEDDING_MODEL,
    backend: "wasm",
  });
  return extractor;
}

// Start downloading/loading the model as soon as this server module is evaluated.
const featureExtractor = loadFeatureExtractor();

function clean(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
function flattenSchema(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? flattenSchema(child, path)
      : [path];
  });
}
function queryTerms(schema: unknown) {
  return [
    ...new Set(
      flattenSchema(schema).flatMap((field) => {
        const normalized = field
          .split(".")
          .pop()!
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/[_-]/g, " ")
          .toLowerCase();
        return [
          normalized,
          ...normalized.split(" ").flatMap((word) => synonyms[word] ?? []),
        ];
      }),
    ),
  ];
}
function normalize(values: number[]) {
  if (!values.length) return values;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min
    ? values.map(() => (max ? 1 : 0))
    : values.map((value) => (value - min) / (max - min));
}
function clampSimilarity(values: number[]) {
  return values.map((value) => Math.max(0, Math.min(1, value)));
}
function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let heading = "Document Start";
  let level = 0;
  let lines: string[] = [];
  const save = () => {
    const content = clean(lines.join("\n"));
    if (content)
      sections.push({
        section_id: sections.length,
        heading,
        heading_level: level,
        content,
      });
  };
  for (const line of markdown.split("\n")) {
    const match = line.trim().match(/^(#{1,6})\s+(.+)/);
    if (match) {
      save();
      heading = match[0].trim();
      level = match[1].length;
      lines = [];
    } else lines.push(line);
  }
  save();
  return sections;
}
function splitChunks(sections: Section[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const blocks = section.content
      .split(/\n\s*\n/)
      .map(clean)
      .filter(Boolean);
    let current = "";
    const flush = () => {
      if (!current) return;
      const text = clean(current);
      chunks.push({
        chunk_id: "",
        chunk_index: 0,
        section: section.heading,
        section_level: section.heading_level,
        section_id: section.section_id,
        text,
        char_count: text.length,
        word_count: words(text).length,
        prev_text: "",
      });
      current = "";
    };
    for (const block of blocks) {
      if (block.length > 4500) {
        for (let start = 0; start < block.length; start += 4500) {
          if (current) flush();
          current = block.slice(start, start + 4500);
          flush();
        }
        continue;
      }
      if (current && current.length + block.length + 2 > 3000) flush();
      current = current ? `${current}\n\n${block}` : block;
    }
    flush();
  }
  let previous = "";
  return chunks.map((chunk, index) => {
    chunk.chunk_id = `chunk_${String(index + 1).padStart(4, "0")}`;
    chunk.chunk_index = index;
    chunk.prev_text = previous;
    previous = chunk.text.slice(-400);
    return chunk;
  });
}
function entityScore(text: string, fields: string[]) {
  const expectations = fields.filter((field) =>
    /date|year/.test(field)
      ? /\b\d{4}\b/.test(text)
      : /email/.test(field)
        ? /@/.test(text)
        : /amount|cost|price|total/.test(field)
          ? /[$€£₹]|\b(?:USD|EUR|INR)\b/i.test(text)
          : false,
  );
  return expectations.length / Math.max(fields.length, 1);
}

export async function extractText(buffer: Buffer, logger?: ServerLogger) {
  logger?.stage("pdf_extraction_started", { bytes: buffer.byteLength });
  const result = await pdf(buffer);
  logger?.stage("pdf_extraction_completed", {
    pages: result.numpages,
    characters: result.text.length,
  });
  return result.text;
}

export async function rankChunks(
  markdown: string,
  schema: unknown,
  topK: number,
  threshold: number,
  logger?: ServerLogger,
) {
  logger?.stage("sectioning_started", { characters: markdown.length });
  const sections = splitSections(markdown);
  logger?.stage("sectioning_completed", { sections: sections.length });
  const fields: string[] = flattenSchema(schema);
  const terms: string[] = queryTerms(schema);
  const chunks = splitChunks(sections);
  logger?.stage("chunking_completed", {
    chunks: chunks.length,
    schema_fields: fields.length,
  });
  if (!chunks.length) return [];
  const extractor = await featureExtractor;
  logger?.stage("embedding_model_available", { model: EMBEDDING_MODEL });
  const query = terms.join(" ");
  logger?.stage("embedding_generation_started", {
    model: EMBEDDING_MODEL,
    inputs: chunks.length + 1,
    chunk_embeddings: chunks.length,
    query_embedding: 1,
  });
  const embeddingOutput = await extractor(
    [...chunks.map((chunk) => `${chunk.section}\n${chunk.text}`), query],
    { pooling: "mean", normalize: true },
  );
  const embeddingSize = embeddingOutput.dims[embeddingOutput.dims.length - 1];
  const embeddingData: number[] = Array.from(embeddingOutput.data);
  logger?.stage("embeddings_generated", {
    model: EMBEDDING_MODEL,
    embeddings: chunks.length + 1,
    dimensions: embeddingSize,
    values: embeddingData.length,
    pooling: "mean",
    normalized: true,
  });
  const queryEmbedding = embeddingData.slice(-embeddingSize);
  const semanticRaw = chunks.map((_, index) => {
    const chunkEmbedding = embeddingData.slice(
      index * embeddingSize,
      (index + 1) * embeddingSize,
    );
    return chunkEmbedding.reduce(
      (score, value, dimension) => score + value * queryEmbedding[dimension],
      0,
    );
  });
  const semantic = clampSimilarity(semanticRaw);
  logger?.stage("semantic_scoring_started", {
    method: "all-MiniLM-L6-v2 absolute cosine similarity",
    chunks: chunks.length,
    dimensions: embeddingSize,
    terms: terms.length,
    raw_min: Number(Math.min(...semanticRaw).toFixed(4)),
    raw_max: Number(Math.max(...semanticRaw).toFixed(4)),
  });
  const lexicalRaw = chunks.map((chunk) => {
    const text = words(`${chunk.section} ${chunk.text}`);
    return terms.reduce(
      (score, term) => score + (text.includes(term.toLowerCase()) ? 1 : 0),
      0,
    );
  });
  const lexical = normalize(lexicalRaw);
  const entity = normalize(
    chunks.map((chunk) => entityScore(chunk.text, fields)),
  );
  const structural = normalize(
    chunks.map(
      (chunk) =>
        terms.reduce(
          (score, term) =>
            score +
            (chunk.section.toLowerCase().includes(term.toLowerCase()) ? 1 : 0),
          0,
        ) + (chunk.chunk_index < 3 ? 0.2 : 0),
    ),
  );
  logger?.stage("semantic_scoring_completed", { scored_chunks: chunks.length });
  const ranked = chunks
    .map((chunk, index): RankedChunk => {
      const final =
        0.4 * semantic[index] +
        0.3 * lexical[index] +
        0.2 * entity[index] +
        0.1 * structural[index];
      return {
        ...chunk,
        rank: 0,
        threshold,
        passes_threshold: final >= threshold,
        scores: {
          semantic: Number(semantic[index].toFixed(4)),
          lexical: Number(lexical[index].toFixed(4)),
          entity: Number(entity[index].toFixed(4)),
          structural: Number(structural[index].toFixed(4)),
          final: Number(final.toFixed(4)),
        },
      };
    })
    .sort((a, b) => b.scores.final - a.scores.final)
    .slice(0, topK)
    .map((chunk, index) => ({ ...chunk, rank: index + 1 }));
  logger?.stage("ranking_completed", {
    returned_chunks: ranked.length,
    top_k: topK,
    threshold,
  });
  return ranked;
}

export function countChunks(markdown: string) {
  return splitChunks(splitSections(markdown)).length;
}
