import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@huggingface/transformers", "onnxruntime-web"],
};

export default nextConfig;