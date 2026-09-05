import argparse
from pathlib import Path

from src.chunker import append_previous_text, create_chunks
from src.markdown_parser import find_headers, split_into_sections
from src.pdf import pdf_to_markdown
from src.storage import save_json, save_markdown


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert PDF to Markdown using PyMuPDF4LLM and create "
            "meaningful Markdown chunks."
        )
    )
    parser.add_argument("pdf", help="Input PDF file")
    parser.add_argument("--output-dir", default="output", help="Output directory")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = Path(args.pdf)

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError("Input file must be a PDF")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    markdown = pdf_to_markdown(pdf_path)
    save_markdown(markdown, output_dir / f"{pdf_path.stem}.md")

    print()
    print("=" * 60)
    print("LAYER 1.5: MARKDOWN -> MEANINGFUL CHUNKS")
    print("=" * 60)

    headers = find_headers(markdown)
    save_json(
        {"total_headers": len(headers), "headers": headers},
        output_dir / f"{pdf_path.stem}_headers.json",
        "Headers",
    )
    print(f"Headers detected: {len(headers)}")

    sections = split_into_sections(markdown, headers)
    save_json(
        {"total_sections": len(sections), "sections": sections},
        output_dir / f"{pdf_path.stem}_sections.json",
        "Sections",
    )
    print(f"Sections detected: {len(sections)}")

    chunks = create_chunks(sections)
    save_json(
        {"total_chunks": len(chunks), "chunks": chunks},
        output_dir / f"{pdf_path.stem}_chunks.json",
        "Chunks",
    )
    print(f"Chunks created: {len(chunks)}")

    chunks = append_previous_text(chunks)

    if chunks:
        sizes = [chunk["char_count"] for chunk in chunks]
        print(f"Smallest chunk: {min(sizes):,} chars")
        print(f"Largest chunk:  {max(sizes):,} chars")
        print(f"Average chunk:  {sum(sizes) / len(sizes):,.0f} chars")

    save_json(
        {"total_chunks": len(chunks), "chunks": chunks},
        output_dir / f"{pdf_path.stem}_final.json",
        "Final chunks",
    )

    print()
    print("=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == "__main__":
    main()
