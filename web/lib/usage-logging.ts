import { getSchemaExtractDatabase } from "./mongodb";

export interface ExtractionUsageLog {
  pdfName: string;
  pdfSize: number;
  userSchema: Record<string, unknown>;
  topKChunks: unknown[];
  response: unknown;
  usage?: unknown;
  model?: string;
  customRules?: string;
  traceId?: string | null;
}

export async function logExtractionUsage(log: ExtractionUsageLog): Promise<void> {
  const database = await getSchemaExtractDatabase();

  await database.collection("extractions").insertOne({
    created_on: new Date(),
    provider: "claude",
    pdf_name: log.pdfName,
    pdf_size: log.pdfSize,
    user_schema: log.userSchema,
    top_k_chunks: log.topKChunks,
    response: log.response,
    usage: log.usage ?? null,
    model: log.model ?? null,
    custom_rules: log.customRules ?? "",
    trace_id: log.traceId ?? null,
  });
}
