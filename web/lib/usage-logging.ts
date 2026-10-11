import { getSchemaExtractDatabase } from "./mongodb";

export interface ExtractionUsageLog {
  provider: "puter" | "worker";
  pdfName: string;
  pdfSize: number;
  userSchema: Record<string, unknown>;
  topKChunks: unknown[];
  response: unknown;
  usage?: unknown;
  usageDetails?: unknown;
  model?: string;
  customRules?: string;
}

export async function logExtractionUsage(log: ExtractionUsageLog): Promise<void> {
  const database = await getSchemaExtractDatabase();

  await database.collection("extractions").insertOne({
    created_on: new Date(),
    provider: log.provider,
    pdf_name: log.pdfName,
    pdf_size: log.pdfSize,
    user_schema: log.userSchema,
    top_k_chunks: log.topKChunks,
    response: log.response,
    usage: log.usage ?? null,
    usageDetails: log.usageDetails ?? null,
    model: log.model ?? null,
    custom_rules: log.customRules ?? "",
  });
}
