import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Model2Vec static embeddings: each token maps to a fixed vector and a text's
// embedding is the mean of its token vectors. No transformer forward pass, so
// it runs in plain TypeScript without onnxruntime.

export const MODEL2VEC_MODEL =
  process.env.MODEL2VEC_MODEL ?? "minishlab/potion-base-8M";

const MODEL2VEC_FILES = ["config.json", "tokenizer.json", "model.safetensors"];

// Mirrors the transformers cache layout: the build ships models/model2vec,
// development downloads into the OS temp dir on first use.
const bundledCacheDir = path.join(process.cwd(), "models", "model2vec");
const cacheDir = process.env.NODE_ENV === "production"
  ? bundledCacheDir
  : path.join(os.tmpdir(), "model2vec-cache");
const allowRemote = process.env.NODE_ENV !== "production";

export interface Model2VecModel {
  name: string;
  dim: number;
  normalize: boolean;
  vocab: Map<string, number>;
  unkId: number | undefined;
  subwordPrefix: string;
  maxCharsPerWord: number;
  embeddings: Float32Array;
}

export function model2vecDirectory(modelName: string, root = cacheDir): string {
  return path.join(root, ...modelName.split("/"));
}

export async function downloadModel2Vec(
  modelName: string,
  root = cacheDir,
): Promise<string> {
  const directory = model2vecDirectory(modelName, root);
  await fs.mkdir(directory, { recursive: true });

  for (const file of MODEL2VEC_FILES) {
    const target = path.join(directory, file);

    try {
      await fs.access(target);
      continue;
    } catch {
      // not downloaded yet
    }

    const response = await fetch(
      `https://huggingface.co/${modelName}/resolve/main/${file}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to download ${modelName}/${file} (${response.status})`);
    }

    const temporary = `${target}.download`;
    await fs.writeFile(temporary, Buffer.from(await response.arrayBuffer()));
    await fs.rename(temporary, target);
  }

  return directory;
}

function readSafetensorsMatrix(buffer: Buffer): { data: Float32Array; rows: number; cols: number } {
  const headerLength = Number(buffer.readBigUInt64LE(0));
  const header = JSON.parse(buffer.subarray(8, 8 + headerLength).toString("utf8")) as Record<
    string,
    { dtype: string; shape: number[]; data_offsets: [number, number] }
  >;

  const tensor = header.embeddings ??
    Object.entries(header).find(([key]) => key !== "__metadata__")?.[1];
  if (!tensor || tensor.shape.length !== 2) {
    throw new Error("Model2Vec safetensors file has no 2-D embeddings tensor");
  }

  const [rows, cols] = tensor.shape;
  const start = 8 + headerLength + tensor.data_offsets[0];
  const end = 8 + headerLength + tensor.data_offsets[1];
  const bytes = buffer.subarray(start, end);
  const data = new Float32Array(rows * cols);

  if (tensor.dtype === "F32") {
    for (let i = 0; i < data.length; i++) data[i] = bytes.readFloatLE(i * 4);
  } else if (tensor.dtype === "F16") {
    for (let i = 0; i < data.length; i++) data[i] = halfToFloat(bytes.readUInt16LE(i * 2));
  } else {
    throw new Error(`Unsupported Model2Vec dtype: ${tensor.dtype}`);
  }

  return { data, rows, cols };
}

function halfToFloat(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x03ff;

  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

const models = new Map<string, Promise<Model2VecModel>>();

export function loadModel2Vec(modelName: string = MODEL2VEC_MODEL): Promise<Model2VecModel> {
  const existing = models.get(modelName);
  if (existing) return existing;

  const modelPromise = (async () => {
    let directory = model2vecDirectory(modelName);

    try {
      await fs.access(path.join(directory, "model.safetensors"));
    } catch {
      if (!allowRemote) {
        throw new Error(`Model2Vec model not bundled: ${directory}`);
      }
      directory = await downloadModel2Vec(modelName);
    }

    const [configText, tokenizerText, weights] = await Promise.all([
      fs.readFile(path.join(directory, "config.json"), "utf8"),
      fs.readFile(path.join(directory, "tokenizer.json"), "utf8"),
      fs.readFile(path.join(directory, "model.safetensors")),
    ]);

    const config = JSON.parse(configText) as { normalize?: boolean };
    const tokenizer = JSON.parse(tokenizerText) as {
      model: {
        type: string;
        vocab: Record<string, number>;
        unk_token?: string;
        continuing_subword_prefix?: string;
        max_input_chars_per_word?: number;
      };
    };

    if (tokenizer.model.type !== "WordPiece") {
      throw new Error(`Unsupported Model2Vec tokenizer: ${tokenizer.model.type}`);
    }

    const vocab = new Map(Object.entries(tokenizer.model.vocab));
    const { data, cols } = readSafetensorsMatrix(weights);

    return {
      name: modelName,
      dim: cols,
      normalize: config.normalize ?? true,
      vocab,
      unkId: tokenizer.model.unk_token ? vocab.get(tokenizer.model.unk_token) : undefined,
      subwordPrefix: tokenizer.model.continuing_subword_prefix ?? "##",
      maxCharsPerWord: tokenizer.model.max_input_chars_per_word ?? 100,
      embeddings: data,
    };
  })();

  modelPromise.catch(() => models.delete(modelName));
  models.set(modelName, modelPromise);
  return modelPromise;
}

// BertNormalizer (lowercase + strip accents) followed by BertPreTokenizer
// (split on whitespace, and every punctuation character is its own token).
function preTokenize(text: string): string[] {
  const normalized = text
    .replace(/[\u0000�\p{Cc}]/gu, (char) => (/\s/.test(char) ? " " : ""))
    .replace(/[一-鿿㐀-䶿豈-﫿]/g, " $& ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

  return normalized.match(/[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]/gu) ?? [];
}

function wordPiece(word: string, model: Model2VecModel): number[] {
  if (word.length > model.maxCharsPerWord) return [];

  const ids: number[] = [];
  let start = 0;

  while (start < word.length) {
    let end = word.length;
    let id: number | undefined;

    while (start < end) {
      const piece = (start > 0 ? model.subwordPrefix : "") + word.slice(start, end);
      id = model.vocab.get(piece);
      if (id !== undefined) break;
      end--;
    }

    // A word with any unmatched piece becomes [UNK], which Model2Vec skips.
    if (id === undefined) return [];
    ids.push(id);
    start = end;
  }

  return ids;
}

export function tokenizeForModel2Vec(model: Model2VecModel, text: string): number[] {
  return preTokenize(text).flatMap((word) => wordPiece(word, model));
}

export function embedWithModel2Vec(model: Model2VecModel, text: string): number[] {
  const vector = new Float64Array(model.dim);
  let count = 0;

  for (const id of tokenizeForModel2Vec(model, text)) {
    if (id === model.unkId) continue;
    const offset = id * model.dim;
    for (let i = 0; i < model.dim; i++) vector[i] += model.embeddings[offset + i];
    count++;
  }

  if (count === 0) return Array.from(vector);

  let norm = 0;
  for (let i = 0; i < model.dim; i++) {
    vector[i] /= count;
    norm += vector[i] * vector[i];
  }

  // Retrieval scores with a dot product, which equals cosine only for unit vectors.
  norm = Math.sqrt(norm);
  if (model.normalize && norm > 0) {
    for (let i = 0; i < model.dim; i++) vector[i] /= norm;
  }

  return Array.from(vector);
}
