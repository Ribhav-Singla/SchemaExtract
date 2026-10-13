import type { Section, Chunk, Header } from "./types";


export function isHeading(line: string): boolean {
    return /^#{1,6}\s+.+/.test(line.trim());
}

export function headingLevel(line: string): number {
    return line.length - line.trimStart().replace(/^#+/, "").length;
}

export function cleanText(text: string): string {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}


export function findHeaders(markdown: string): Header[] {
    const headers: Header[] = [];

    const lines = markdown.split(/\r?\n/);

    lines.forEach((line, index) => {
        const lineNumber = index + 1;

        if (isHeading(line)) {
            headers.push({
                headerId: headers.length,
                heading: line.trim(),
                headingLevel: headingLevel(line),
                lineNumber,
            });
        }
    });

    return headers;
}

export function splitIntoSections(
    markdown: string,
    headers?: Header[]
): Section[] {
    const detectedHeaders = headers ?? findHeaders(markdown);

    const headerLines = new Map<number, Header>();

    for (const header of detectedHeaders) {
        headerLines.set(header.lineNumber, header);
    }

    const sections: Section[] = [];

    let currentHeading = "Document Start";
    let currentLevel = 0;
    let currentLines: string[] = [];

    const saveSection = (): void => {
        const content = cleanText(currentLines.join("\n"));

        if (content) {
            sections.push({
                sectionId: sections.length,
                heading: currentHeading,
                headingLevel: currentLevel,
                content,
            });
        }
    };

    const lines = markdown.split(/\r?\n/);

    lines.forEach((line, index) => {
        const lineNumber = index + 1;

        const header = headerLines.get(lineNumber);

        if (header) {
            saveSection();

            currentHeading = header.heading;
            currentLevel = header.headingLevel;
            currentLines = [];
        } else {
            currentLines.push(line);
        }
    });

    saveSection();

    return sections;
}

export function splitIntoBlocks(text: string): string[] {
    const blocks: string[] = [];
    let current: string[] = [];

    let inCodeBlock = false;
    let inTable = false;
    let inList = false;

    const flush = (): void => {
        if (current.length > 0) {
            const block = cleanText(current.join("\n"));

            if (block) {
                blocks.push(block);
            }
        }

        current = [];
    };

    const lines = text.split(/\r?\n/);

    for (const line of lines) {
        const stripped = line.trim();

        // Code block
        if (
            stripped.startsWith("```") ||
            stripped.startsWith("~~~")
        ) {
            if (!inCodeBlock) {
                flush();
                inCodeBlock = true;
            }

            current.push(line);

            // Closing code fence
            if (
                current.length > 1 &&
                current[0].trim() !== stripped
            ) {
                inCodeBlock = false;
            }

            continue;
        }

        if (inCodeBlock) {
            current.push(line);
            continue;
        }

        // Table row
        const isTableRow =
            stripped.startsWith("|") &&
            stripped.endsWith("|");

        if (isTableRow) {
            if (!inTable) {
                flush();
                inTable = true;
            }

            current.push(line);
            continue;
        }

        if (inTable) {
            flush();
            inTable = false;
        }

        // List item
        const isListItem =
            /^[-*+]\s+/.test(stripped) ||
            /^\d+[.)]\s+/.test(stripped);

        if (isListItem) {
            if (!inList) {
                flush();
                inList = true;
            }

            current.push(line);
            continue;
        }

        if (inList) {
            // Continuation of a list item
            if (
                stripped &&
                (line.startsWith(" ") || line.startsWith("\t"))
            ) {
                current.push(line);
                continue;
            }

            flush();
            inList = false;
        }

        // Empty line = new block
        if (!stripped) {
            flush();
            continue;
        }

        current.push(line);
    }

    flush();

    return blocks;
}