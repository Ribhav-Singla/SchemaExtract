import pdf from "pdf-parse";

type Section = { section_id: number; heading: string; heading_level: number; content: string };
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
  scores: { semantic: number; lexical: number; entity: number; structural: number; final: number };
};

const synonyms: Record<string, string[]> = {
  name: ["name", "full name", "person name"], author: ["author", "authors", "written by"],
  organization: ["organization", "institution", "company", "university", "institute", "department"],
  title: ["title", "document title", "paper title", "report title", "heading"],
  keyword: ["keyword", "keywords", "key terms"], date: ["date", "year", "published", "created"],
  amount: ["amount", "total", "cost", "price", "value", "fee", "payment"],
  environment: ["environment", "dataset", "simulation", "setting"], algorithm: ["algorithm", "method", "model", "approach"],
};

function clean(text: string) { return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
function words(text: string): string[] { return text.toLowerCase().match(/[a-z0-9]+/g) ?? []; }
function flattenSchema(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child) ? flattenSchema(child, path) : [path];
  });
}
function queryTerms(schema: unknown) {
  return [...new Set(flattenSchema(schema).flatMap((field) => {
    const normalized = field.split(".").pop()!.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase();
    return [normalized, ...normalized.split(" ").flatMap((word) => synonyms[word] ?? [])];
  }))];
}
function normalize(values: number[]) {
  if (!values.length) return values;
  const min = Math.min(...values); const max = Math.max(...values);
  return max === min ? values.map(() => max ? 1 : 0) : values.map((value) => (value - min) / (max - min));
}
function splitSections(markdown: string): Section[] {
  const sections: Section[] = []; let heading = "Document Start"; let level = 0; let lines: string[] = [];
  const save = () => { const content = clean(lines.join("\n")); if (content) sections.push({ section_id: sections.length, heading, heading_level: level, content }); };
  for (const line of markdown.split("\n")) {
    const match = line.trim().match(/^(#{1,6})\s+(.+)/);
    if (match) { save(); heading = match[0].trim(); level = match[1].length; lines = []; } else lines.push(line);
  }
  save(); return sections;
}
function splitChunks(sections: Section[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const blocks = section.content.split(/\n\s*\n/).map(clean).filter(Boolean);
    let current = "";
    const flush = () => { if (!current) return; const text = clean(current); chunks.push({ chunk_id: "", chunk_index: 0, section: section.heading, section_level: section.heading_level, section_id: section.section_id, text, char_count: text.length, word_count: words(text).length, prev_text: "" }); current = ""; };
    for (const block of blocks) {
      if (block.length > 4500) { for (let start = 0; start < block.length; start += 4500) { if (current) flush(); current = block.slice(start, start + 4500); flush(); } continue; }
      if (current && current.length + block.length + 2 > 3000) flush();
      current = current ? `${current}\n\n${block}` : block;
    }
    flush();
  }
  let previous = "";
  return chunks.map((chunk, index) => { chunk.chunk_id = `chunk_${String(index + 1).padStart(4, "0")}`; chunk.chunk_index = index; chunk.prev_text = previous; previous = chunk.text.slice(-400); return chunk; });
}
function entityScore(text: string, fields: string[]) {
  const expectations = fields.filter((field) => /date|year/.test(field) ? /\b\d{4}\b/.test(text) : /email/.test(field) ? /@/.test(text) : /amount|cost|price|total/.test(field) ? /[$€£₹]|\b(?:USD|EUR|INR)\b/i.test(text) : false);
  return expectations.length / Math.max(fields.length, 1);
}

export async function extractText(buffer: Buffer) { return (await pdf(buffer)).text; }

export function rankChunks(markdown: string, schema: unknown, topK: number, threshold: number) {
  const fields: string[] = flattenSchema(schema); const terms: string[] = queryTerms(schema); const chunks = splitChunks(splitSections(markdown));
  const lexicalRaw = chunks.map((chunk) => { const text = words(`${chunk.section} ${chunk.text}`); return terms.reduce((score, term) => score + (text.includes(term.toLowerCase()) ? 1 : 0), 0); });
  const lexical = normalize(lexicalRaw); const semantic = lexical.map((value, index) => Math.min(1, value * 0.75 + (chunks[index].section_level ? 0.1 : 0)));
  const entity = normalize(chunks.map((chunk) => entityScore(chunk.text, fields))); const structural = normalize(chunks.map((chunk) => terms.reduce((score, term) => score + (chunk.section.toLowerCase().includes(term.toLowerCase()) ? 1 : 0), 0) + (chunk.chunk_index < 3 ? 0.2 : 0)));
  return chunks.map((chunk, index): RankedChunk => { const final = 0.4 * semantic[index] + 0.3 * lexical[index] + 0.2 * entity[index] + 0.1 * structural[index]; return { ...chunk, rank: 0, threshold, passes_threshold: final >= threshold, scores: { semantic: Number(semantic[index].toFixed(4)), lexical: Number(lexical[index].toFixed(4)), entity: Number(entity[index].toFixed(4)), structural: Number(structural[index].toFixed(4)), final: Number(final.toFixed(4)) } }; }).sort((a, b) => b.scores.final - a.scores.final).slice(0, topK).map((chunk, index) => ({ ...chunk, rank: index + 1 }));
}

export function countChunks(markdown: string) {
  return splitChunks(splitSections(markdown)).length;
}