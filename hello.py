import argparse
import json
import re
from pathlib import Path

import pymupdf4llm


# ============================================================
# CONFIGURATION
# ============================================================

TARGET_CHUNK_CHARS = 3000
MAX_CHUNK_CHARS = 4500
OVERLAP_CHARS = 400


# ============================================================
# MARKDOWN PARSING
# ============================================================

def is_heading(line: str) -> bool:
    """
    Detect Markdown headings:

        # Title
        ## Introduction
        ### Method
    """
    return bool(re.match(r"^#{1,6}\s+.+", line.strip()))


def heading_level(line: str) -> int:
    return len(line) - len(line.lstrip("#"))


def clean_text(text: str) -> str:
    """Normalize excessive whitespace while preserving Markdown."""
    text = text.replace("\r\n", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ============================================================
# SECTION DETECTION
# ============================================================

def split_into_sections(markdown: str):
    """
    Split Markdown into logical sections based on headings.

    Each section contains:
        - section_id
        - heading
        - heading_level
        - content
    """

    lines = markdown.splitlines()

    sections = []

    current_heading = "Document Start"
    current_level = 0
    current_lines = []

    for line in lines:

        if is_heading(line):

            # Save previous section
            if current_lines:
                content = clean_text("\n".join(current_lines))

                if content:
                    sections.append({
                        "section_id": len(sections),
                        "heading": current_heading,
                        "heading_level": current_level,
                        "content": content
                    })

            # Start new section
            current_heading = line.strip()
            current_level = heading_level(line)
            current_lines = []

        else:
            current_lines.append(line)

    # Save final section
    if current_lines:
        content = clean_text("\n".join(current_lines))

        if content:
            sections.append({
                "section_id": len(sections),
                "heading": current_heading,
                "heading_level": current_level,
                "content": content
            })

    return sections


# ============================================================
# BLOCK DETECTION
# ============================================================

def split_into_blocks(text: str):
    """
    Split a section into semantic Markdown blocks.

    We preserve:
        - paragraphs
        - tables
        - lists
        - code blocks
        - equations
        - captions

    Blank lines normally separate blocks.
    Tables and lists are kept together.
    """

    lines = text.splitlines()

    blocks = []
    current = []

    in_code_block = False
    in_table = False
    in_list = False

    def flush():
        nonlocal current

        if current:
            block = clean_text("\n".join(current))

            if block:
                blocks.append(block)

        current = []

    for line in lines:

        stripped = line.strip()

        # ----------------------------------------------------
        # Code blocks
        # ----------------------------------------------------

        if stripped.startswith("```") or stripped.startswith("~~~"):

            if not in_code_block:
                flush()
                in_code_block = True

            current.append(line)

            # Closing fence
            if len(current) > 1 and (
                stripped.startswith("```")
                or stripped.startswith("~~~")
            ):
                if current[0].strip() != stripped:
                    in_code_block = False

            continue

        if in_code_block:
            current.append(line)
            continue

        # ----------------------------------------------------
        # Markdown tables
        # ----------------------------------------------------

        is_table_row = stripped.startswith("|") and stripped.endswith("|")

        if is_table_row:

            if not in_table:
                flush()
                in_table = True

            current.append(line)
            continue

        elif in_table:
            flush()
            in_table = False

        # ----------------------------------------------------
        # Lists
        # ----------------------------------------------------

        is_list_item = bool(
            re.match(r"^[-*+]\s+", stripped)
            or re.match(r"^\d+[.)]\s+", stripped)
        )

        if is_list_item:

            if not in_list:
                flush()
                in_list = True

            current.append(line)
            continue

        elif in_list:

            # Continuation of list item
            if stripped and (
                line.startswith(" ")
                or line.startswith("\t")
            ):
                current.append(line)
                continue

            flush()
            in_list = False

        # ----------------------------------------------------
        # Blank line = paragraph boundary
        # ----------------------------------------------------

        if not stripped:
            flush()
            continue

        current.append(line)

    flush()

    return blocks


# ============================================================
# OVERSIZED BLOCK SPLITTING
# ============================================================

def split_large_block(block: str, max_chars: int):
    """
    Split a very large paragraph/block.

    Preference:
        sentence boundary
        → line boundary
        → hard character boundary
    """

    if len(block) <= max_chars:
        return [block]

    sentences = re.split(
        r"(?<=[.!?])\s+",
        block
    )

    pieces = []
    current = ""

    for sentence in sentences:

        sentence = sentence.strip()

        if not sentence:
            continue

        if len(current) + len(sentence) + 1 <= max_chars:

            if current:
                current += " " + sentence
            else:
                current = sentence

        else:

            if current:
                pieces.append(current)

            # Sentence itself is too large
            if len(sentence) > max_chars:

                start = 0

                while start < len(sentence):

                    end = min(
                        start + max_chars,
                        len(sentence)
                    )

                    pieces.append(
                        sentence[start:end].strip()
                    )

                    start = end

                current = ""

            else:
                current = sentence

    if current:
        pieces.append(current)

    return pieces


# ============================================================
# CHUNK CREATION
# ============================================================

def create_chunks(sections):
    """
    Convert sections into meaningful chunks.

    Rules:
        1. Keep blocks together.
        2. Target ~3000 characters.
        3. Never exceed ~4500 characters.
        4. Preserve section information.
        5. Add overlap between chunks.
    """

    chunks = []

    for section in sections:

        blocks = split_into_blocks(
            section["content"]
        )

        # ----------------------------------------------------
        # Split oversized blocks
        # ----------------------------------------------------

        processed_blocks = []

        for block in blocks:

            if len(block) > MAX_CHUNK_CHARS:

                pieces = split_large_block(
                    block,
                    MAX_CHUNK_CHARS
                )

                processed_blocks.extend(pieces)

            else:
                processed_blocks.append(block)

        # ----------------------------------------------------
        # Build chunks
        # ----------------------------------------------------

        current_blocks = []
        current_length = 0

        for block in processed_blocks:

            block_length = len(block)

            # If adding this block exceeds target,
            # create the current chunk first.
            if (
                current_blocks
                and current_length + block_length > TARGET_CHUNK_CHARS
            ):

                chunk_text = "\n\n".join(
                    current_blocks
                )

                chunks.append(
                    build_chunk(
                        chunk_text,
                        section
                    )
                )

                # --------------------------------------------
                # Overlap
                # --------------------------------------------

                overlap_text = get_overlap(
                    chunk_text,
                    OVERLAP_CHARS
                )

                current_blocks = [overlap_text]
                current_length = len(overlap_text)

            current_blocks.append(block)
            current_length += block_length + 2

        # ----------------------------------------------------
        # Remaining blocks
        # ----------------------------------------------------

        if current_blocks:

            chunk_text = "\n\n".join(
                current_blocks
            )

            chunks.append(
                build_chunk(
                    chunk_text,
                    section
                )
            )

    # Add IDs after creation
    for i, chunk in enumerate(chunks):

        chunk["chunk_id"] = f"chunk_{i + 1:04d}"

        chunk["chunk_index"] = i

    return chunks


# ============================================================
# OVERLAP
# ============================================================

def get_overlap(text: str, overlap_chars: int) -> str:
    """
    Get overlap from the END of the previous chunk.

    Prefer starting at a sentence boundary.
    """

    if len(text) <= overlap_chars:
        return text

    overlap = text[-overlap_chars:]

    # Try to start at a sentence boundary
    match = re.search(
        r"[.!?]\s+",
        overlap
    )

    if match:
        overlap = overlap[match.end():]

    return overlap.strip()


# ============================================================
# CHUNK METADATA
# ============================================================

def build_chunk(text: str, section: dict):
    """
    Create the final chunk object.
    """

    text = clean_text(text)

    return {
        "chunk_id": None,
        "chunk_index": None,

        "section": section["heading"],
        "section_level": section["heading_level"],
        "section_id": section["section_id"],

        "text": text,

        "char_count": len(text),

        # Useful later if you add token-based retrieval.
        "word_count": len(text.split())
    }


# ============================================================
# PDF → MARKDOWN
# ============================================================

def pdf_to_markdown(pdf_path: Path) -> str:

    print("=" * 60)
    print("LAYER 1: PDF → MARKDOWN")
    print("=" * 60)

    print(f"Input PDF: {pdf_path}")

    markdown = pymupdf4llm.to_markdown(
        str(pdf_path)
    )

    print(
        f"Markdown characters: {len(markdown):,}"
    )

    return markdown


# ============================================================
# SAVE FUNCTIONS
# ============================================================

def save_markdown(markdown: str, output_path: Path):

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    output_path.write_text(
        markdown,
        encoding="utf-8"
    )

    print(
        f"Markdown saved: {output_path}"
    )


def save_chunks(chunks, output_path: Path):

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    data = {
        "total_chunks": len(chunks),
        "chunking_config": {
            "target_chunk_chars": TARGET_CHUNK_CHARS,
            "max_chunk_chars": MAX_CHUNK_CHARS,
            "overlap_chars": OVERLAP_CHARS
        },
        "chunks": chunks
    }

    with output_path.open(
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            data,
            f,
            indent=2,
            ensure_ascii=False
        )

    print(
        f"Chunks saved: {output_path}"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    parser = argparse.ArgumentParser(
        description=(
            "Convert PDF to Markdown using "
            "PyMuPDF4LLM and create meaningful "
            "Markdown chunks."
        )
    )

    parser.add_argument(
        "pdf",
        help="Input PDF file"
    )

    parser.add_argument(
        "--output-dir",
        default="output",
        help="Output directory"
    )

    args = parser.parse_args()

    pdf_path = Path(args.pdf)

    if not pdf_path.exists():
        raise FileNotFoundError(
            f"PDF not found: {pdf_path}"
        )

    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError(
            "Input file must be a PDF"
        )

    output_dir = Path(args.output_dir)

    output_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    # --------------------------------------------------------
    # Layer 1
    # --------------------------------------------------------

    markdown = pdf_to_markdown(
        pdf_path
    )

    markdown_path = (
        output_dir /
        f"{pdf_path.stem}.md"
    )

    save_markdown(
        markdown,
        markdown_path
    )

    # --------------------------------------------------------
    # Chunking
    # --------------------------------------------------------

    print()
    print("=" * 60)
    print("LAYER 1.5: MARKDOWN → MEANINGFUL CHUNKS")
    print("=" * 60)

    sections = split_into_sections(
        markdown
    )

    print(
        f"Sections detected: {len(sections)}"
    )

    chunks = create_chunks(
        sections
    )

    print(
        f"Chunks created: {len(chunks)}"
    )

    # --------------------------------------------------------
    # Statistics
    # --------------------------------------------------------

    if chunks:

        sizes = [
            c["char_count"]
            for c in chunks
        ]

        print(
            f"Smallest chunk: {min(sizes):,} chars"
        )

        print(
            f"Largest chunk:  {max(sizes):,} chars"
        )

        print(
            f"Average chunk:  "
            f"{sum(sizes) / len(sizes):,.0f} chars"
        )

    # --------------------------------------------------------
    # Save JSON
    # --------------------------------------------------------

    chunks_path = (
        output_dir /
        f"{pdf_path.stem}_chunks.json"
    )

    save_chunks(
        chunks,
        chunks_path
    )

    print()
    print("=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == "__main__":
    main()