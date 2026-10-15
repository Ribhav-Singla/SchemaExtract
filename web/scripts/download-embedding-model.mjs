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