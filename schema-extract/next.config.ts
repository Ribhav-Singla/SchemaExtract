import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  turbopack: {
    resolveAlias: {
      "@huggingface/transformers": "./node_modules/@huggingface/transformers/dist/transformers.web.js",
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@huggingface/transformers": path.resolve(
        "node_modules/@huggingface/transformers/dist/transformers.web.js",
      ),
      "onnxruntime-node": false,
    };
    return config;
  },
};

export default nextConfig;