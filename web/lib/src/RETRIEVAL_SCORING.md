# Chunk Retrieval Scoring

How [`retriever.ts`](./retriever.ts) ranks document chunks against a target
extraction schema, and why it's built this way.

## Pipeline

```
schema ──flatten──► fields ──expand──► query terms ──┐
                        │                            │
                        └──infer entity types──┐     │
                                                ▼     ▼
chunks ──┬─► semantic (embeddings · query)◄────┘     │
         ├─► lexical  (TF-IDF · query terms)◄────────┘
         ├─► entity   (regex hits · expected types)
         └─► structural (section/position cues)
                        │
                        ▼
         weighted sum → final score → rank
                        │
                        ▼
              MMR diversification → top K
```

## 1. Schema → query

- `flattenSchema` walks the (possibly nested) JSON schema into a list of
  `SchemaField { path, type? }` — dotted field paths (`author.name`,
  `total.amount`) plus, when the schema's leaf values are type names rather
  than blank placeholders (`"amount": "number"` instead of `"amount": ""`),
  the declared type (lowercased). Blank placeholders (`""`, `[]`) still work
  and just leave `type` undefined, so older schemas keep behaving exactly as
  before.
- `normalizeFieldName` strips the path down to the leaf, un-camelCases and
  un-snake_cases it (`totalAmount` → `total amount`).
- `expandField` adds domain synonyms from `FIELD_SYNONYMS` (`amount` also
  pulls in `total`, `cost`, `price`, `fee`, …). The union of every field's
  expansion, joined into one string, is the query embedded for semantic
  search and the term list used for TF-IDF.
- `inferEntityTypes(path, type?)` maps each field to the `EntityType`s it's
  likely to resolve to, primarily from the field *name* (`author` → `PERSON`,
  `total` → `MONEY`, `date` → `DATE`, …). When the name gives no signal at
  all, it falls back to the schema's *declared type*: a field typed
  `"number"`/`"double"`/`"integer"`/… (and with no more specific name match)
  is expected to resolve to `NUMBER`. This is what makes a field like
  `"quantity": "number"` or `"tax_rate": "double"` — whose name doesn't hint
  at money or a percentage — still get real entity-scoring credit instead of
  contributing no expected type at all. This drives both entity scoring and
  the adaptive weight profile below.

## 2. Four signals

| Signal | What it measures | Source |
|---|---|---|
| **semantic** | Cosine similarity between the chunk's embedding and the query's embedding | `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` |
| **lexical** | TF-IDF relevance of the expanded query terms against the chunk, relative to the rest of the corpus | `natural.TfIdf` over chunk texts only |
| **entity** | Fraction of the schema's expected entity types (`PERSON`, `MONEY`, `DATE`, …) actually found in the chunk | regex patterns + a capitalized-bigram heuristic for names |
| **structural** | Positional/section cues — is this chunk in the document's opening section, does its section heading or the previous chunk's trailing lines mention the field, is it in the references section (penalized) | `section`, `sectionId`, `sectionLevel`, `chunkIndex`, `prevText` |

Each signal is min-max normalized across the chunk set (`normalizeScores`) so
none dominates purely by scale.

### Boundary context (`prevText`)

Chunk boundaries regularly split a field from its value — a table header or
a label like `"Total Amount:"` at the tail of one chunk, the number at the
head of the next. `boundaryContext()` prepends the last ~200 characters of
`prevText` before scanning for entities, and `structuralScores` separately
checks the previous chunk's last 1–2 non-empty lines against the field
vocabulary. This is why the chunk shape carries `prevText` at all — it's a
free recall boost that costs nothing extra to compute.

### Structural scoring, concretely

- Every field-vocabulary word found in `section` (the section heading) adds
  to the score; the same word found in `prevText`'s tail adds half as much
  (weaker signal — it's about the *neighboring* chunk, not this one).
- If the query looks like document metadata (`title`, `author`, `keywords`,
  `affiliation`, …) **and** the chunk is in the first logical section
  (`sectionId === 0`), at a shallow heading level (`sectionLevel <= 1`), near
  the start of the chunk stream (`chunkIndex <= 3`), it gets a flat bonus.
  `sectionId` is used instead of only `chunkIndex` because an opening section
  ("Document Start" in the sample data) can span more chunks than a fixed
  index cutoff assumes.
- Chunks whose section mentions `reference` or `bibliography` are penalized —
  citations are lexically dense with the same author/date/org vocabulary as
  real metadata, but are almost never the field's actual value.

### Lexical scoring fix

The previous implementation added the query itself as an extra "document" to
the TF-IDF corpus before scoring. That inflates the document frequency of
exactly the terms being searched for, deflating their IDF weight — the more
specific the query term, the more this understated its own relevance. The
corpus is now built from chunk texts only; `tfidf.tfidfs(query, …)` scores
the query against each existing document without touching the corpus.

## 3. Adaptive weights

Static weights (`0.4 / 0.3 / 0.2 / 0.1` for semantic/lexical/entity/
structural) are a reasonable default, but the right blend depends on what the
schema is asking for:

- **Fields with no inferable entity type** (free-text summaries,
  descriptions, arbitrary content) — regex and position have nothing to grab
  onto. Weight shifts to `semantic 0.5 / lexical 0.35 / entity 0 / structural
  0.15`.
- **Fields dominated by "metadata" entity types** (`PERSON`, `ORG`, `EMAIL`,
  `PHONE`, `DATE` — the kind of thing that lives in a title page or byline,
  not prose) — pattern and position cues are unusually reliable. Weight
  shifts to `semantic 0.3 / lexical 0.2 / entity 0.3 / structural 0.2`.
- Otherwise, the static defaults apply.

`computeAdaptiveWeights` is exported standalone and can be disabled via
`retrieve(chunks, schema, topK, threshold, { adaptiveWeights: false })` to
fall back to the fixed weights.

## 4. Final score and diversification

`final = w.semantic·semantic + w.lexical·lexical + w.entity·entity + w.structural·structural`,
per chunk, then chunks are sorted descending.

Picking the top K by score alone tends to return several near-duplicate
chunks (e.g. three paragraphs all restating the same figure) at the expense
of covering more distinct fields. The top `max(4·K, K+5)` candidates are
re-ranked with **Maximal Marginal Relevance** (`mmrRerank`): at each step, the
candidate maximizing `λ·relevance − (1−λ)·max_similarity_to_already_selected`
is picked, using the same normalized embeddings already computed for
semantic scoring (no extra embedding calls). Default `λ = 0.7` — mostly
relevance-driven, with enough diversity pressure to avoid redundant picks.
Disable via `{ diversify: false }` to get the old plain-cutoff behavior.

`passesThreshold` remains informational only — `retrieve()` always returns
up to `topK` chunks regardless of whether they clear `threshold`; the caller
decides what to do with chunks below it.

## 5. Performance

- **Batched embeddings**: all chunk texts are embedded in a single pipeline
  call (`model(texts, …)`) instead of one `await` per chunk.
- **Embedding cache**: vectors are cached module-wide, keyed by
  `(model, chunkId, charCount)`. Re-running retrieval against the same
  document with a different schema (a common flow — user edits the schema,
  re-extracts) reuses embeddings instead of recomputing them. Capped at 4000
  entries with FIFO eviction to bound memory on long-lived serverless
  instances.

## Tuning checklist

- Add new field vocabulary → `FIELD_SYNONYMS`.
- Add a new entity type → extend `EntityType`, `ENTITY_PATTERNS` (or the
  `PERSON` heuristic in `detectEntities`), and `inferEntityTypes`.
- New structural cue available in the chunker output → extend
  `structuralScores`.
- Suspect over/under-diversification → adjust `mmrLambda` (closer to 1 =
  less diversity pressure) or the `poolSize` multiplier in `retrieve()`.
