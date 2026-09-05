from pathlib import Path

import pymupdf4llm


def pdf_to_markdown(pdf_path: Path) -> str:
    """Convert a PDF file to Markdown with PyMuPDF4LLM."""
    print("=" * 60)
    print("LAYER 1: PDF -> MARKDOWN")
    print("=" * 60)
    print(f"Input PDF: {pdf_path}")

    markdown = pymupdf4llm.to_markdown(str(pdf_path))
    print(f"Markdown characters: {len(markdown):,}")
    return markdown
