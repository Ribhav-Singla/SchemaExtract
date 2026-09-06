# Scoring Walkthrough: One Example Per Signal

A worked, numeric example of how [`retriever.ts`](./retriever.ts) scores a
chunk against a schema, covering all four signals — semantic, lexical,
entity, structural — on the *same* three chunks so you can see how each
signal disagrees or agrees. For the architecture and rationale behind the
pipeline, see [`RETRIEVAL_SCORING.md`](./RETRIEVAL_SCORING.md); this doc is
just the arithmetic.

## The setup

**Schema:**

```json
{
  "title": "string",
  "authors": ["string"],
  "organization": "string",
  "contactEmail": "string",
  "publishedDate": "string"
}
```

**Three candidate chunks** (trimmed for readability):

| | chunkIndex | section | text |
|---|---|---|---|
| **A** (title block) | 0 | "Document Start" | `Title: Neurosymbolic Reinforcement Learning for UAV Navigation`<br>`Authors: John Smith, Priya Nair`<br>`Organization: Department of Computer Science, MIT`<br>`Email: john.smith@mit.edu`<br>`Date: 12 March 2024` |
| **B** (body text) | 1 | "Document Start" | `Neuro-symbolic AI aims to unify two perspectives within artificial intelligence: the pattern recognition capabilities of neural networks and the reasoning of symbolic systems [1]. In RL, external knowledge has been incorporated in various forms...` |
| **C** (references) | 14 | "References" | `1. Acharya, R., et al. Neurosymbolic reinforcement learning: A survey. 2023.`<br>`2. Smith, J., Doe, A. Deep RL. 2022.` |

**Step 0 — schema → query** (`flattenSchema` → `expandField` →
`inferEntityTypes`):

| field | expanded terms (subset) | inferred entity type |
|---|---|---|
| `title` | title, document title, paper title, heading | — |
| `authors` | authors, author, written by | `PERSON` |
| `organization` | organization, organisation, institution, university, department | `ORG` |
| `contactEmail` | contact email, email, e-mail, email address | `EMAIL` |
| `publishedDate` | published date, date, published, created, issued, year | `DATE` |

`expectedTypes = {PERSON, ORG, EMAIL, DATE}` (size 4). 4 of 5 fields resolved
to an entity type, and all four are "metadata" types (`METADATA_ENTITY_TYPES`),
so `computeAdaptiveWeights` picks the metadata-leaning profile:

```
semantic 0.3 · lexical 0.2 · entity 0.3 · structural 0.2
```

(see [`RETRIEVAL_SCORING.md`](./RETRIEVAL_SCORING.md#3-adaptive-weights) for
when each profile applies.)

---

## 1. Entity — regex hits against expected types

`entityScores` runs `detectEntities` on `boundaryContext(chunk)` (the chunk's
text, with a bit of `prevText` prepended) and counts how many of the 4
expected types (`PERSON`, `ORG`, `EMAIL`, `DATE`) show up at least once.

**Chunk A:**
- `EMAIL` pattern matches `john.smith@mit.edu` → present.
- `DATE` pattern matches `12 March 2024` (`\d{1,2}\s+Mar[a-z]*\s+\d{2,4}`) → present.
- `ORG` pattern matches `Department` in "Department of Computer Science" → present.
- `PERSON` bigram heuristic (`[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}`) matches `John Smith` → present.
- **4 / 4 expected types found → raw score 1.0**

**Chunk B:**
- No email, no `Department`/`University`/etc., no date-shaped text, and no
  `Capitalized Capitalized` bigram (citations like `Acharya et al.` don't
  match — `et` isn't capitalized).
- **0 / 4 → raw score 0.0**

**Chunk C:**
- Citation-style names (`Smith, J.`) don't match the `First Last` bigram
  pattern (single initials aren't `[A-Z][a-z]{2,}`), bare years like `2023`
  don't match the `DATE` pattern (no separators, no month name), no org
  keywords, no email.
- **0 / 4 → raw score 0.0**

Normalized (`normalizeScores`, min 0 / max 1): **A = 1.0, B = 0.0, C = 0.0.**

This is the sharpest signal here: entity detection doesn't care about
literal field-name words, only real instances of the data itself.

## 2. Lexical — TF-IDF over the expanded query terms

`lexicalScores` builds a `natural.TfIdf` corpus from the chunk texts only
(not the query — see the fix note in `RETRIEVAL_SCORING.md`), then scores the
query string (all expanded terms joined) against each document.

Query terms that literally appear in the corpus and where: `title`,
`authors`, `organization`, `email`, `date`, `department` — every one of them
appears **only** in chunk A (chunk B and C never use those label words, even
though chunk C conceptually is about authors/dates via citations).

With a 3-document corpus, a term appearing in exactly 1 document has
`idf = log(N / df) = log(3/1) ≈ 1.10`. Chunk A contains 6 such terms once
each, contributing roughly:

```
score(A) ≈ 6 terms × tf(1) × idf(1.10) ≈ 6.6
score(B) ≈ 0   (none of those terms appear)
score(C) ≈ 0   (none of those terms appear)
```

(`natural`'s actual TF-IDF variant uses its own smoothing, so the library's
real numbers won't match this exactly — but the *ordering* and the *reason*
are exactly this: literal term overlap, weighted by rarity across the chunk
set.)

Normalized: **A = 1.0, B = 0.0, C = 0.0.**

Contrast with entity scoring: lexical caught chunk A because it uses the
literal words `Title:`, `Authors:`, `Date:` as labels. If chunk A instead
read `Neurosymbolic RL for UAV Navigation — J. Smith, P. Nair (MIT), 2024`
with no labels at all, lexical would score it near zero while entity would
still catch the email/date/org/name — this is exactly why the two signals
are scored and weighted separately instead of merged into one.

## 3. Structural — position and section cues

`structuralScores` checks the section heading, the previous chunk's trailing
lines, and document position (`sectionId`, `sectionLevel`, `chunkIndex`)
against the field vocabulary.

**Chunk A:** section = `"document start"`. The word `document` (from the
expanded term "document title") appears in the section name → **+1**. The
schema's field names include `title` and `organization`, both in the
"looks like metadata" list (`metadataFields`), and the chunk sits at
`sectionId = 0`, `sectionLevel = 0`, `chunkIndex = 0` (all within the
opening-section thresholds) → **+2** metadata bonus. No reference/
bibliography penalty. **Raw score = 3.**

**Chunk B:** same section (`"document start"`) and same opening-section
position (`sectionId = 0`, `chunkIndex = 1 ≤ 3`) → it *also* gets the
`document` match (**+1**) and the metadata bonus (**+2**). **Raw score = 3.**

**Chunk C:** section = `"references"`. No field-vocabulary words match it,
it's well past the opening section, and the section name contains
`"reference"` → **−2** penalty. **Raw score = −2.**

Normalized (min −2, max 3, range 5): **A = 1.0, B = 1.0, C = 0.0.**

Notice structural alone can't tell A and B apart here — both are early
chunks in the same top-level section, and a real "Document Start" section
in academic PDFs often does span the title block *and* the first paragraph
of the introduction before the next heading appears. That's expected and
fine: structural score is one of four signals precisely so that a case like
this gets resolved by lexical/entity/semantic instead of relying on section
boundaries alone.

## 4. Semantic — embedding cosine similarity

`this.embedChunks(chunks)` embeds each chunk's text (batched, cached by
`chunkId`) with `Xenova/all-MiniLM-L6-v2`, embeds the query string once, and
scores `dotProduct(chunkEmbedding, queryEmbedding)` (a cosine similarity,
since both vectors are L2-normalized).

This can't be hand-computed the way TF-IDF or regex counts can — it depends
on the actual model weights — but the *shape* of the result is predictable
from what the query is about. The query is a bag of concept words: `title,
author, organization, email, date, department, university, ...`. Chunk A
*is* a title/author/org/email/date block — topically it's almost exactly
the query, even setting aside literal overlap. Chunk B is a methodology
paragraph about neurosymbolic RL — topically distant from "title/author/
date" concepts. Chunk C is a references list — topically closer to B than
to A (no real title-page concepts), though citation metadata (names, years)
gives it a little more overlap than a pure-methodology paragraph.

Illustrative cosine similarities (representative, not reproducible by hand):

```
raw semantic:  A ≈ 0.62   B ≈ 0.18   C ≈ 0.25
```

Normalized: **A = 1.0, B = 0.0, C ≈ 0.16.**

This is the signal that would still catch chunk A even if it had *no*
literal field labels and *no* regex-shaped entities at all — e.g. a title
page formatted as a bare byline with no "Title:"/"Author:" labels — because
it reasons about meaning, not surface form.

## Putting it together

| chunk | semantic | lexical | entity | structural | **final** (0.3·sem + 0.2·lex + 0.3·ent + 0.2·struct) |
|---|---|---|---|---|---|
| A | 1.0 | 1.0 | 1.0 | 1.0 | **1.0** |
| B | 0.0 | 0.0 | 0.0 | 1.0 | **0.2** |
| C | 0.16 | 0.0 | 0.0 | 0.0 | **≈0.048** |

Chunk A wins on every signal (as it should — it's the actual metadata
block). The more interesting rows are B vs. C: structural alone would have
called them a tie-breaker away from each other (1.0 vs. 0.0, correctly
favoring the *section*), but it's semantic (0.16 vs 0.0) that gives C a
sliver of credit over B for citation-adjacent content, while entity and
lexical correctly stay at zero for both since neither has real field values
or literal field labels. No single signal gets the full ranking right on
its own — that's the reason the score is a blend, not a cascade.

If `topK ≥ 2`, both A and B would clear a `threshold` of, say, `0.15`, while
C would not — matching the intuition that the title block and the
introduction (same section) are plausible candidates, while a reference-list
chunk is not.
