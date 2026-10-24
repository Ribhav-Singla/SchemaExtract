import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env, pipeline } from "@huggingface/transformers";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const cacheDirectory = path.join(webDirectory, "models", "transformers-cache");
const modelName = "Xenova/all-MiniLM-L6-v2";

env.cacheDir = cacheDirectory;
env.allowRemoteModels = true;

console.log(`Downloading ${modelName} into ${cacheDirectory}`);
await pipeline("feature-extraction", modelName);
console.log("Embedding model is ready for deployment.");

// Model2Vec static weights (NEXT_EMBEDDING_PROVIDER=model2vec) are plain files, so
// fetch them directly into models/model2vec/<org>/<name>.
const model2vecName = process.env.MODEL2VEC_MODEL ?? "minishlab/potion-base-8M";
const model2vecDirectory = path.join(webDirectory, "models", "model2vec", ...model2vecName.split("/"));
const model2vecFiles = ["config.json", "tokenizer.json", "model.safetensors"];

await fs.mkdir(model2vecDirectory, { recursive: true });
console.log(`Downloading ${model2vecName} into ${model2vecDirectory}`);

for (const file of model2vecFiles) {
  const target = path.join(model2vecDirectory, file);
  if (await fs.access(target).then(() => true, () => false)) continue;

  const response = await fetch(`https://huggingface.co/${model2vecName}/resolve/main/${file}`);
  if (!response.ok) {
    throw new Error(`Failed to download ${model2vecName}/${file} (${response.status})`);
  }
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}
console.log("Model2Vec model is ready for deployment.");
