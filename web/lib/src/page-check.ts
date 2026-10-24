export type PageSource = "text" | "vision";

export interface PageCheck {
    source: PageSource;
    reason: string;
}

// Below this many non-whitespace characters the page is treated as scanned.
const MIN_TEXT_CHARS = 50;
// Share of letters/digits among non-whitespace characters; lower means garbled font encoding.
const MIN_ALNUM_RATIO = 0.5;
// Share of U+FFFD replacement characters above which the text layer is unusable.
const MAX_REPLACEMENT_RATIO = 0.05;

export function checkPage(text: string): PageCheck {
    const compact = text.replace(/\s+/g, "");

    if (compact.length < MIN_TEXT_CHARS) {
        return {
            source: "vision",
            reason: `only ${compact.length} text characters`,
        };
    }

    const replacements = compact.match(/�/g)?.length ?? 0;
    const replacementRatio = replacements / compact.length;
    if (replacementRatio > MAX_REPLACEMENT_RATIO) {
        return {
            source: "vision",
            reason: `${(replacementRatio * 100).toFixed(1)}% replacement characters`,
        };
    }

    const alnum = compact.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    const alnumRatio = alnum / compact.length;
    if (alnumRatio < MIN_ALNUM_RATIO) {
        return {
            source: "vision",
            reason: `${(alnumRatio * 100).toFixed(1)}% letters/digits`,
        };
    }

    return { source: "text", reason: "usable text layer" };
}
