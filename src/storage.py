import json
from pathlib import Path

from .config import MAX_CHUNK_CHARS, OVERLAP_CHARS, TARGET_CHUNK_CHARS


def save_markdown(markdown: str, output_path: Path) -> None:
    """Save converted Markdown to disk."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown, encoding="utf-8")
    print(f"Markdown saved: {output_path}")


def save_chunks(chunks: list[dict], output_path: Path) -> None:
    """Save chunks and their configuration as formatted JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "total_chunks": len(chunks),
        "chunking_config": {
            "target_chunk_chars": TARGET_CHUNK_CHARS,
            "max_chunk_chars": MAX_CHUNK_CHARS,
            "overlap_chars": OVERLAP_CHARS,
        },
        "chunks": chunks,
    }
    output_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Chunks saved: {output_path}")
