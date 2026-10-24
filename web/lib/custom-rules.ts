export const MAX_CUSTOM_RULES_LENGTH = 2000;

export const DATE_FORMAT_OPTIONS = [
  "DD-MM-YYYY",
  "MM-DD-YYYY",
  "YYYY-MM-DD",
  "DD-MM",
  "DD Mon YYYY",
  "Mon DD, YYYY",
] as const;

export const STRING_CASE_OPTIONS = [
  "Proper Case",
  "camelCase",
  "PascalCase",
  "UPPERCASE",
  "lowercase",
] as const;

export const NUMBER_FORMAT_OPTIONS = [
  "Plain",
  "2 decimals",
  "Comma-separated",
  "Compact",
] as const;

// Custom rules may only refine how values are formatted or chosen. Anything
// that addresses the model itself, changes its role/output, or tries to break
// out of the prompt structure is rejected outright rather than sanitised.
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|forget|override|bypass|skip|drop)\b[^.\n]{0,40}\b(previous|prior|above|earlier|preceding|all|any|system|original|other|these|those)\b[^.\n]{0,25}\b(instructions?|rules?|prompts?|directions?|guidelines?|constraints?|context)\b/i, "tries to override the extraction instructions"],
  [/\b(new|updated|real|actual|true)\s+(instructions?|rules?|task|prompt|objective)\b/i, "tries to replace the extraction instructions"],
  [/\b(system|developer|assistant)\s*(prompt|message|instructions?|role)\b/i, "references the model's system prompt"],
  [/\b(reveal|print|show|repeat|output|leak|tell me|what (is|are))\b[^.\n]{0,40}\b(prompt|instructions?|system|api[\s_-]?key|secret|token|env(ironment)?)\b/i, "asks for hidden instructions or secrets"],
  [/\b(you are|you're|act as|acting as|pretend|roleplay|role-play|behave as|from now on|you must now|you will now)\b/i, "tries to change the model's role"],
  [/\b(jailbreak|DAN mode|developer mode|god mode|unfiltered|no restrictions)\b/i, "contains a known jailbreak phrase"],
  [/\b(do not|don't|never|stop)\b[^.\n]{0,20}\b(return|output|respond (with|in))\b[^.\n]{0,20}\bjson\b/i, "tries to change the JSON output format"],
  [/\b(respond|reply|answer|write|output|return)\b[^.\n]{0,30}\b(markdown|html|xml|yaml|prose|plain text|essay|poem|story|code|script)\b/i, "tries to change the output format"],
  [/\b(add|include|create|insert|append)\b[^.\n]{0,30}\b(new|extra|additional)\s+(fields?|keys?|properties)\b/i, "tries to add fields outside the schema"],
  [/\b(call|invoke|run|execute|fetch|browse|visit|open)\b[^.\n]{0,30}\b(tool|function|url|https?:|command|shell|code)\b/i, "asks the model to take actions"],
  [/https?:\/\/|www\./i, "contains a URL"],
  [/<\/?\s*[a-z_][\w-]*\s*>|<\|[^|]*\|>|\[\/?(INST|SYS)\]|<<\/?SYS>>/i, "contains prompt markup or tags"],
  [/^\s*(system|assistant|user|human|ai)\s*:/im, "contains a chat role prefix"],
  [/```|~~~/, "contains a code fence"],
  [/[A-Za-z0-9+/]{120,}={0,2}/, "contains an encoded blob"],
  [/[​-‏‪-‮⁠-⁤﻿]/, "contains hidden or bidirectional control characters"],
  // eslint-disable-next-line no-control-regex
  [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/, "contains control characters"],
];

export function validateCustomRules(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "Custom rules must be text.";

  if (value.length > MAX_CUSTOM_RULES_LENGTH) {
    return `Custom rules must be ${MAX_CUSTOM_RULES_LENGTH.toLocaleString()} characters or fewer.`;
  }

  const normalized = value.normalize("NFKC");
  for (const [pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return `Custom rules rejected: ${reason}. Rules may only describe how to format or choose extracted values.`;
    }
  }

  return null;
}
