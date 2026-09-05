import re

from .config import MAX_CHUNK_CHARS, OVERLAP_CHARS, TARGET_CHUNK_CHARS
from .markdown_parser import clean_text, split_into_blocks


def split_large_block(block: str, max_chars: int) -> list[str]:
    """Split an oversized block at sentence boundaries where possible."""
    if len(block) <= max_chars:
        return [block]

    sentences = re.split(r"(?<=[.!?])\s+", block)
    pieces = []
    current = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        if len(current) + len(sentence) + 1 <= max_chars:
            current = f"{current} {sentence}".strip()
            continue

        if current:
            pieces.append(current)

        if len(sentence) > max_chars:
            for start in range(0, len(sentence), max_chars):
                pieces.append(sentence[start:start + max_chars].strip())
            current = ""
        else:
            current = sentence

    if current:
        pieces.append(current)
    return pieces


def get_overlap(text: str, overlap_chars: int) -> str:
    """Return the end of a chunk, starting at a sentence boundary if possible."""
    if len(text) <= overlap_chars:
        return text

    overlap = text[-overlap_chars:]
    match = re.search(r"[.!?]\s+", overlap)
    if match:
        overlap = overlap[match.end():]
    return overlap.strip()


def build_chunk(text: str, section: dict) -> dict:
    """Build a chunk with section metadata and basic statistics."""
    text = clean_text(text)
    return {
        "chunk_id": None,
        "chunk_index": None,
        "section": section["heading"],
        "section_level": section["heading_level"],
        "section_id": section["section_id"],
        "text": text,
        "char_count": len(text),
        "word_count": len(text.split()),
    }


def create_chunks(sections: list[dict]) -> list[dict]:
    """Convert sections into meaningful, overlapping chunks."""
    chunks = []

    for section in sections:
        processed_blocks = []
        for block in split_into_blocks(section["content"]):
            if len(block) > MAX_CHUNK_CHARS:
                processed_blocks.extend(split_large_block(block, MAX_CHUNK_CHARS))
            else:
                processed_blocks.append(block)

        current_blocks = []
        current_length = 0
        for block in processed_blocks:
            block_length = len(block)
            if current_blocks and current_length + block_length > TARGET_CHUNK_CHARS:
                chunk_text = "\n\n".join(current_blocks)
                chunks.append(build_chunk(chunk_text, section))
                overlap_text = get_overlap(chunk_text, OVERLAP_CHARS)
                current_blocks = [overlap_text]
                current_length = len(overlap_text)

            current_blocks.append(block)
            current_length += block_length + 2

        if current_blocks:
            chunks.append(build_chunk("\n\n".join(current_blocks), section))

    for index, chunk in enumerate(chunks):
        chunk["chunk_id"] = f"chunk_{index + 1:04d}"
        chunk["chunk_index"] = index

    return chunks
