import { ObjectId } from "mongodb";

import type { PipelineResult } from "./main";
import { getSchemaExtractDatabase } from "./mongodb";

// Mongo documents are capped at 16 MB; keep the stored text well under that.
const MAX_MARKDOWN_CHARS = 2_000_000;
const MAX_CHUNK_TEXT_CHARS = 4_000_000;
const SECTION_PREVIEW_CHARS = 300;

export interface SavePipelineTraceInput {
  pdfName: string;
  pdfSize: number;
  schema: Record<string, unknown>;
  result: PipelineResult;
}

// Stores Layers 1 -> 2 of an /api/analyse run. The extraction log written later
// by /api/usage points back here through trace_id.
export async function savePipelineTrace({
  pdfName,
  pdfSize,
  schema,
  result,
}: SavePipelineTraceInput): Promise<string> {
  const { trace } = result;
  const totalChunkChars = result.chunks.reduce(
    (sum, chunk) => sum + String(chunk.text ?? "").length,
    0,
  );
  const chunkTextLimit = totalChunkChars > MAX_CHUNK_TEXT_CHARS
    ? Math.floor(MAX_CHUNK_TEXT_CHARS / Math.max(1, result.chunks.length))
    : Infinity;

  const database = await getSchemaExtractDatabase();
  const { insertedId } = await database.collection("pipeline_traces").insertOne({
    created_on: new Date(),
    pdf_name: pdfName,
    pdf_size: pdfSize,
    user_schema: schema,
    cache_hit: trace.cache_hit,
    timings: { ...trace.timings, retrieval_ms: trace.retrieval_ms },
    markdown: trace.markdown.slice(0, MAX_MARKDOWN_CHARS),
    markdown_chars: trace.markdown.length,
    markdown_truncated: trace.markdown.length > MAX_MARKDOWN_CHARS,
    headers: trace.headers,
    sections: trace.sections.map((section) => ({
      sectionId: section.sectionId,
      heading: section.heading,
      headingLevel: section.headingLevel,
      charCount: section.content.length,
      preview: section.content.slice(0, SECTION_PREVIEW_CHARS),
    })),
    chunks: result.chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      section: chunk.section,
      charCount: chunk.charCount,
      text: String(chunk.text ?? "").slice(0, chunkTextLimit),
    })),
    chunks_truncated: Number.isFinite(chunkTextLimit),
    top_k: result.top_k,
    threshold: result.threshold,
    ranked_chunks: result.ranked_chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      section: chunk.section,
      rank: chunk.rank,
      scores: chunk.scores,
      passesThreshold: chunk.passesThreshold,
      text: chunk.text,
    })),
  });

  return insertedId.toHexString();
}

export type FieldStage =
  | "not_extracted"
  | "missing_in_markdown"
  | "lost_in_chunking"
  | "lost_in_retrieval"
  | "not_in_top_k"
  | "found_in_top_k";

export interface FieldTraceRow {
  path: string;
  value: string | null;
  inMarkdown: boolean;
  inChunks: boolean;
  inTopK: boolean;
  stage: FieldStage;
}

// Lowercase alphanumerics only, so "INV-001" matches "inv 001" and
// "1,250.00" matches "1250.00".
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function flattenValues(
  value: unknown,
  prefix: string,
  rows: Array<{ path: string; value: unknown }>,
) {
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push({ path: prefix, value: null });
    value.forEach((item, index) => flattenValues(item, `${prefix}[${index}]`, rows));
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenValues(child, prefix ? `${prefix}.${key}` : key, rows);
    }
  } else {
    rows.push({ path: prefix, value });
  }
}

// Without ground truth, each extracted value is used as the needle: the first
// layer that no longer contains it is where the value went missing (or where
// the model produced a value not literally present in the document).
// Runs logged before traces existed only have the top-K chunks; pass
// markdown/chunkTexts as null and only the retrieval check is made.
export function buildFieldTrace(
  response: unknown,
  markdown: string | null,
  chunkTexts: string[] | null,
  topKTexts: string[],
): FieldTraceRow[] {
  const leaves: Array<{ path: string; value: unknown }> = [];
  flattenValues(response, "", leaves);

  const markdownNorm = markdown === null ? null : normalize(markdown);
  const chunksNorm = chunkTexts?.map(normalize) ?? null;
  const topKNorm = topKTexts.map(normalize);

  return leaves.map(({ path, value }) => {
    const text = value === null || value === undefined || value === ""
      ? null
      : String(value);
    const needle = text === null ? "" : normalize(text);

    if (!needle) {
      return {
        path,
        value: text,
        inMarkdown: false,
        inChunks: false,
        inTopK: false,
        stage: "not_extracted",
      };
    }

    const inTopK = topKNorm.some((chunk) => chunk.includes(needle));
    if (markdownNorm === null || chunksNorm === null) {
      return {
        path,
        value: text,
        inMarkdown: false,
        inChunks: false,
        inTopK,
        stage: inTopK ? "found_in_top_k" : "not_in_top_k",
      };
    }

    const inMarkdown = markdownNorm.includes(needle);
    const inChunks = chunksNorm.some((chunk) => chunk.includes(needle));
    const stage: FieldStage = inTopK
      ? "found_in_top_k"
      : !inMarkdown
        ? "missing_in_markdown"
        : !inChunks
          ? "lost_in_chunking"
          : "lost_in_retrieval";

    return { path, value: text, inMarkdown, inChunks, inTopK, stage };
  });
}

export async function getRunDetails(id: string) {
  if (!ObjectId.isValid(id)) return null;

  const database = await getSchemaExtractDatabase();
  const extraction = await database
    .collection("extractions")
    .findOne({ _id: new ObjectId(id) });
  if (!extraction) return null;

  const trace = typeof extraction.trace_id === "string" &&
      ObjectId.isValid(extraction.trace_id)
    ? await database
      .collection("pipeline_traces")
      .findOne({ _id: new ObjectId(extraction.trace_id) })
    : null;

  const topKChunks = Array.isArray(extraction.top_k_chunks)
    ? extraction.top_k_chunks
    : [];
  const topKTexts = topKChunks.map((chunk: { text?: unknown }) =>
    String(chunk?.text ?? "")
  );
  const chunkTexts = trace
    ? (trace.chunks as Array<{ text: string }>).map((chunk) => chunk.text)
    : null;

  const { _id, ...extractionFields } = extraction;
  const traceFields = trace
    ? (({ _id: traceId, ...rest }) => ({ id: traceId.toHexString(), ...rest }))(trace)
    : null;

  return {
    id: _id.toHexString(),
    extraction: extractionFields,
    trace: traceFields,
    fieldTrace: buildFieldTrace(
      extraction.response,
      trace ? String(trace.markdown ?? "") : null,
      chunkTexts,
      topKTexts,
    ),
  };
}
