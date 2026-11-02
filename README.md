# Schema Extract

Schema Extract turns PDF documents into structured JSON that matches a schema you supply. It parses the PDF locally, picks out the passages relevant to your schema with hybrid retrieval, and sends only those passages to Anthropic Claude for extraction.

The app is a Next.js project in [`web/`](web/).

## How it works

1. **PDF → Markdown.** Each page's text layer is converted to Markdown. Pages with no usable text (scanned pages, garbled font encodings) are rendered to an image and transcribed by Claude vision instead.
2. **Chunking.** The Markdown is split into sections by heading, then into overlapping chunks of about 1,800 characters.
3. **Retrieval.** Chunks are ranked against the schema fields with a weighted hybrid score:
   - semantic similarity: 0.4
   - lexical match (TF-IDF or BM25): 0.3
   - entity match: 0.2
   - structural signals: 0.1
4. **Extraction.** The top-ranked chunks, your schema, and any formatting rules go to Claude, which returns JSON that follows the schema.
5. **Logging.** Token usage and a trace of each pipeline stage are stored in MongoDB and shown on the dashboard.

Steps 1 and 2 depend only on the PDF, so they start as soon as a file is picked and are cached by content hash. Changing the schema re-runs only retrieval and extraction.

## Requirements

- Node.js 20+
- A MongoDB database (for usage logging and the dashboard)
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

## Getting started

```powershell
cd web
npm install
npm run download:model   # fetches the local embedding models into web/models/
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), upload a PDF, and enter a schema. [`web/examples/example1.json`](web/examples/example1.json) is an example invoice schema:

```json
{
  "invoice_number": "string",
  "store_name": "string",
  "order_items": [
    { "order_id": "string", "item": [{ "name": "string", "quantity": "number", "price": "number" }] }
  ],
  "total_amount": "number"
}
```

## Configuration

Create `web/.env`. Next.js reads it only at startup, so restart the dev server after editing it.

```env
# Required
NEXT_ANTHROPIC_API_KEY=sk-ant-...
NEXT_MONGODB_URI=mongodb+srv://...

# Claude models (optional)
NEXT_CLAUDE_MODEL=claude-haiku-5-5
NEXT_CLAUDE_VISION_MODEL=            # defaults to NEXT_CLAUDE_MODEL

# Retrieval (optional)
NEXT_EMBEDDING_PROVIDER=transformers # "transformers" (MiniLM, default) or "model2vec" (static, no ONNX)
NEXT_LEXICAL_SCORER=tfidf            # "tfidf" (default) or "bm25"

# Dashboard
NEXT_PUBLIC_DASHBOARD_USERNAME=admin
NEXT_PUBLIC_DASHBOARD_PASSWORD=change-this-password

# SEO (optional)
NEXT_PUBLIC_SITE_URL=https://schema-extract.vercel.app
```

Only the `NEXT_PUBLIC_*` variables reach the browser. Everything else is read server-side only. Never commit `.env`, and rotate any key that has appeared in logs, screenshots, or source control.

### Limits

- PDF size: 4 MB
- Schema length: 2,000 characters
- Custom rules: 2,000 characters. Rules that try to override the instructions, change the output format, or add fields outside the schema are rejected.

### Output formatting options

The extractor can normalise values as it extracts them:

- **Dates:** `DD-MM-YYYY`, `MM-DD-YYYY`, `YYYY-MM-DD`, `DD-MM`, `DD Mon YYYY`, `Mon DD, YYYY`
- **Strings:** Proper Case, camelCase, PascalCase, UPPERCASE, lowercase
- **Numbers:** Plain, 2 decimals, Comma-separated, Compact

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/prepare` | POST | Parses and chunks the PDF and caches chunk embeddings. Streams NDJSON progress events (`chunked`, `ready`, `failed`). |
| `/api/analyse` | POST | Ranks the cached chunks against the schema. |
| `/api/extract` | POST | Sends the ranked chunks to Claude and returns the extracted JSON. |
| `/api/usage` | GET / POST | Reads or records usage and trace data in MongoDB. |
| `/api/dashboard/system` | GET | Reports server CPU, memory, and disk usage. |

## Dashboard

[http://localhost:3000/dashboard](http://localhost:3000/dashboard) shows:

- request counts, token usage, and PDF volume
- per-day and per-request charts
- filters by date range and filename
- a stage-by-stage trace of each run
- server resource metrics

> **Note:** The dashboard login is a client-side check against `NEXT_PUBLIC_*` variables, which are bundled into the browser. It does not protect data. Add server-side authentication before exposing the dashboard publicly.

## Scripts

Run these from `web/`:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Download the models (prebuild), then build for production |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npx tsc --noEmit` | Type-check |
| `npm run download:model` | Download `Xenova/all-MiniLM-L6-v2` and `minishlab/potion-base-8M` into `web/models/` |

The downloaded models are git-ignored. Production loads them from the local cache and never downloads them during a user request.

## Project layout

```
web/
├── app/
│   ├── page.tsx              # Extractor UI
│   ├── dashboard/            # Usage dashboard
│   ├── components/           # Schema editor, JSON viewer, run details, …
│   └── api/                  # Route handlers (see above)
├── lib/
│   ├── main.ts               # Pipeline orchestration and chunk cache
│   ├── analysis-pipeline.ts  # Upload validation and request handling
│   ├── custom-rules.ts       # Formatting options and rule validation
│   ├── usage-logging.ts      # MongoDB usage records
│   └── src/
│       ├── pdf.ts            # PDF → Markdown
│       ├── page-check.ts     # Decides text layer vs. vision per page
│       ├── vision.ts         # Claude vision transcription
│       ├── markdown_parser.ts
│       ├── chunker.ts
│       ├── retriever.ts      # Hybrid ranking
│       └── model2vec.ts      # Static embedding provider
├── scripts/                  # Model download and build helpers
├── models/                   # Downloaded embedding models (git-ignored)
└── examples/                 # Sample schemas
```

## Troubleshooting

- **`401 authentication_error: invalid x-api-key`:** Anthropic rejected `NEXT_ANTHROPIC_API_KEY`. The key is wrong, truncated, or revoked. Create a new key in the Console, paste it without quotes, and restart the dev server.
- **`NEXT_ANTHROPIC_API_KEY is not configured`:** The variable is missing from `web/.env`, or the server was started before you added it.
- **Slow first extraction, or a model-not-found error:** Run `npm run download:model`.
