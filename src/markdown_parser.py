import re


def is_heading(line: str) -> bool:
    """Return whether a line is a Markdown heading."""
    return bool(re.match(r"^#{1,6}\s+.+", line.strip()))


def heading_level(line: str) -> int:
    """Return the number of leading Markdown heading markers."""
    return len(line) - len(line.lstrip("#"))


def clean_text(text: str) -> str:
    """Normalize excessive whitespace while preserving Markdown."""
    text = text.replace("\r\n", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_into_sections(markdown: str) -> list[dict]:
    """Split Markdown into logical sections based on headings."""
    sections = []
    current_heading = "Document Start"
    current_level = 0
    current_lines = []

    def save_section() -> None:
        content = clean_text("\n".join(current_lines))
        if content:
            sections.append({
                "section_id": len(sections),
                "heading": current_heading,
                "heading_level": current_level,
                "content": content,
            })

    for line in markdown.splitlines():
        if is_heading(line):
            save_section()
            current_heading = line.strip()
            current_level = heading_level(line)
            current_lines = []
        else:
            current_lines.append(line)

    save_section()
    return sections


def split_into_blocks(text: str) -> list[str]:
    """Split a section into semantic Markdown blocks."""
    blocks = []
    current = []
    in_code_block = False
    in_table = False
    in_list = False

    def flush() -> None:
        if current:
            block = clean_text("\n".join(current))
            if block:
                blocks.append(block)
        current.clear()

    for line in text.splitlines():
        stripped = line.strip()

        if stripped.startswith(("```", "~~~")):
            if not in_code_block:
                flush()
                in_code_block = True
            current.append(line)
            if len(current) > 1 and current[0].strip() != stripped:
                in_code_block = False
            continue

        if in_code_block:
            current.append(line)
            continue

        is_table_row = stripped.startswith("|") and stripped.endswith("|")
        if is_table_row:
            if not in_table:
                flush()
                in_table = True
            current.append(line)
            continue
        if in_table:
            flush()
            in_table = False

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
        if in_list:
            if stripped and (line.startswith(" ") or line.startswith("\t")):
                current.append(line)
                continue
            flush()
            in_list = False

        if not stripped:
            flush()
            continue

        current.append(line)

    flush()
    return blocks
