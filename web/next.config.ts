import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdf-parse",
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
      "./models/transformers-cache/**/*",
    ],
  },
};

export default nextConfig;
