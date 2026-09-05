import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@huggingface/transformers", "onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/onnxruntime-node/bin/**/*"],
  },
};

export default nextConfig;