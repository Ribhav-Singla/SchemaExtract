function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])/g;

/**
 * Wraps JSON text in syntax-highlighting spans (key/string/number/boolean/
 * null/punctuation). Output is safe to use with dangerouslySetInnerHTML: the
 * source is HTML-escaped before any span markup is added, so the raw text
 * itself can never inject markup.
 */
export function highlightJson(source: string): string {
  const escaped = escapeHtml(source);

  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(escaped)) !== null) {
    result += escaped.slice(lastIndex, match.index);

    const [full, str, colonAfter, num, bool, nul, punct] = match;

    if (str !== undefined) {
      const isKey = Boolean(colonAfter);

      result += `<span class="${isKey ? "text-editor-key" : "text-editor-string"}">${str}</span>`;

      if (colonAfter) {
        result += `<span class="text-editor-punct">${colonAfter}</span>`;
      }
    } else if (num !== undefined) {
      result += `<span class="text-editor-number">${num}</span>`;
    } else if (bool !== undefined) {
      result += `<span class="text-editor-bool">${bool}</span>`;
    } else if (nul !== undefined) {
      result += `<span class="text-editor-null">${nul}</span>`;
    } else if (punct !== undefined) {
      result += `<span class="text-editor-punct">${punct}</span>`;
    }

    lastIndex = match.index + full.length;
  }

  result += escaped.slice(lastIndex);

  return result;
}

export function countLines(source: string): number {
  return source.length === 0 ? 1 : source.split("\n").length;
}
