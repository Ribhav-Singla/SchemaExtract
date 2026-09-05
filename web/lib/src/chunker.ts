import {
  MAX_CHUNK_CHARS,
  OVERLAP_CHARS,
  TARGET_CHUNK_CHARS,
} from "./config";

import {
  cleanText,
  splitIntoBlocks,
} from "./markdown_parser";

import type { Section, Chunk } from "./types";


export function splitLargeBlock(
  block: string,
  maxChars: number
): string[] {
  if (block.length <= maxChars) {
    return [block];
  }

  const sentences = block.split(/(?<=[.!?])\s+/);

  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();

    if (!trimmedSentence) {
      continue;
    }

    if (
      current.length +
        trimmedSentence.length +
        1 <=
      maxChars
    ) {
      current = `${current} ${trimmedSentence}`.trim();
      continue;
    }

    if (current) {
      pieces.push(current);
    }

    if (trimmedSentence.length > maxChars) {
      for (
        let start = 0;
        start < trimmedSentence.length;
        start += maxChars
      ) {
        pieces.push(
          trimmedSentence
            .slice(start, start + maxChars)
            .trim()
        );
      }

      current = "";
    } else {
      current = trimmedSentence;
    }
  }

  if (current) {
    pieces.push(current);
  }

  return pieces;
}

export function getOverlap(
  text: string,
  overlapChars: number
): string {
  if (text.length <= overlapChars) {
    return text;
  }

  let overlap = text.slice(-overlapChars);

  const match = overlap.search(/[.!?]\s+/);

  if (match !== -1) {
    const boundary = overlap.match(/[.!?]\s+/);

    if (boundary && boundary.index !== undefined) {
      overlap = overlap.slice(
        boundary.index + boundary[0].length
      );
    }
  }

  return overlap.trim();
}

export function buildChunk(
  text: string,
  section: Section
): Chunk {
  const cleanedText = cleanText(text);

  return {
    chunkId: null,
    chunkIndex: null,
    section: section.heading,
    sectionLevel: section.headingLevel,
    sectionId: section.sectionId,
    text: cleanedText,
    charCount: cleanedText.length,
    wordCount: cleanedText.split(/\s+/).filter(Boolean).length,
    prevText: "",
  };
}

export function createChunks(
  sections: Section[]
): Chunk[] {
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const processedBlocks: string[] = [];

    for (const block of splitIntoBlocks(section.content)) {
      if (block.length > MAX_CHUNK_CHARS) {
        processedBlocks.push(
          ...splitLargeBlock(
            block,
            MAX_CHUNK_CHARS
          )
        );
      } else {
        processedBlocks.push(block);
      }
    }

    const currentBlocks: string[] = [];
    let currentLength = 0;

    for (const block of processedBlocks) {
      const blockLength = block.length;

      if (
        currentBlocks.length > 0 &&
        currentLength + blockLength >
          TARGET_CHUNK_CHARS
      ) {
        const chunkText =
          currentBlocks.join("\n\n");

        chunks.push(
          buildChunk(chunkText, section)
        );

        currentBlocks.length = 0;
        currentLength = 0;
      }

      currentBlocks.push(block);

      currentLength += blockLength + 2;
    }

    if (currentBlocks.length > 0) {
      chunks.push(
        buildChunk(
          currentBlocks.join("\n\n"),
          section
        )
      );
    }
  }

  chunks.forEach((chunk, index) => {
    chunk.chunkId = `chunk_${String(
      index + 1
    ).padStart(4, "0")}`;

    chunk.chunkIndex = index;
  });

  return chunks;
}


export function appendPreviousText(
  chunks: Chunk[]
): Chunk[] {
  let previousText = "";

  for (const chunk of chunks) {
    chunk.prevText = previousText;

    previousText = getOverlap(
      String(chunk.text),
      OVERLAP_CHARS
    );
  }

  return chunks;
}