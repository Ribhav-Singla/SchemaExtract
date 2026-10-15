import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Prints the project tree after a build so deploy logs show what was produced
// (e.g. whether models/transformers-cache was populated).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", "cache"]);
const MAX_DEPTH = Number(process.env.TREE_DEPTH ?? 4);

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function printTree(dir, prefix, depth) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries = entries
    .filter((entry) => !SKIP.has(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  entries.forEach((entry, index) => {
    const last = index === entries.length - 1;
    const fullPath = path.join(dir, entry.name);
    const branch = last ? "└── " : "├── ";

    if (entry.isDirectory()) {
      console.log(`${prefix}${branch}${entry.name}/`);
      if (depth < MAX_DEPTH) {
        printTree(fullPath, prefix + (last ? "    " : "│   "), depth + 1);
      }
    } else {
      console.log(`${prefix}${branch}${entry.name} (${formatSize(fs.statSync(fullPath).size)})`);
    }
  });
}

console.log(`${path.basename(root)}/`);
printTree(root, "", 1);
