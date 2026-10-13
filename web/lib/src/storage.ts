import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { Chunk } from "./types";
import {
  MAX_CHUNK_CHARS,
  OVERLAP_CHARS,
  TARGET_CHUNK_CHARS,
} from "./config";



export async function saveMarkdown(
  markdown: string,
  outputPath: string
): Promise<void> {
  await mkdir(dirname(outputPath), {
    recursive: true,
  });

  await writeFile(outputPath, markdown, {
    encoding: "utf-8",
  });

  console.log(`Markdown saved: ${outputPath}`);
}

export async function saveChunks(
  chunks: Chunk[],
  outputPath: string
): Promise<void> {
  await mkdir(dirname(outputPath), {
    recursive: true,
  });

  const data = {
    total_chunks: chunks.length,

    chunking_config: {
      target_chunk_chars: TARGET_CHUNK_CHARS,
      max_chunk_chars: MAX_CHUNK_CHARS,
      overlap_chars: OVERLAP_CHARS,
    },

    chunks,
  };

  await writeFile(
    outputPath,
    JSON.stringify(data, null, 2),
    {
      encoding: "utf-8",
    }
  );

  console.log(`Chunks saved: ${outputPath}`);
}

export async function saveJson(
  data: unknown,
  outputPath: string,
  label: string
): Promise<void> {
  await mkdir(dirname(outputPath), {
    recursive: true,
  });

  await writeFile(
    outputPath,
    JSON.stringify(data, null, 2),
    {
      encoding: "utf-8",
    }
  );

  console.log(`${label} saved: ${outputPath}`);
}