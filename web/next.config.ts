import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdf-parse",
    "pdfjs-dist",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  outputFileTracingIncludes: {
    "/api/**/*": [
      // transformers.js loads onnxruntime-node at runtime, so file tracing
      // can't see it: ship its JS, its dependency, and the Linux binaries.
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/bin/*/linux/x64/**/*",
      "./node_modules/onnxruntime-common/**/*",
      // pdfjs-dist loads its own pinned @napi-rs/canvas (and that copy's
      // platform binary) through a runtime require, which tracing can't see.
      "./node_modules/pdfjs-dist/node_modules/@napi-rs/**/*",
      "./node_modules/pdf-parse/node_modules/@napi-rs/**/*",
      "./models/transformers-cache/**/*",
      // Static Model2Vec weights, used when NEXT_EMBEDDING_PROVIDER=model2vec.
      "./models/model2vec/**/*",
    ],
  },
};

export default nextConfig;
