# Schema Extract

Schema Extract turns PDF documents into structured, evidence-backed JSON using Anthropic Claude.

## Getting started

Run the application from the `web` directory:

```powershell
npm install
npm run download:model
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the extractor.

## Environment configuration

Create `web/.env` with the required application settings. Never commit real credentials.

```env
NEXT_MONGODB_URI=your-mongodb-connection-string

# Claude
NEXT_ANTHROPIC_API_KEY=your-anthropic-api-key
NEXT_CLAUDE_MODEL=claude-haiku-5-5

# Dashboard
NEXT_PUBLIC_DASHBOARD_USERNAME=admin
NEXT_PUBLIC_DASHBOARD_PASSWORD=change-this-password
```

Every variable uses the `NEXT_` prefix. `NEXT_MONGODB_URI`, `NEXT_ANTHROPIC_API_KEY` and `NEXT_CLAUDE_MODEL` are only read server-side (`/api/extract`, `/api/usage`) and are never sent to the browser; only `NEXT_PUBLIC_*` variables are. `NEXT_CLAUDE_MODEL` defaults to `claude-haiku-5-5`. Rotate any key that has been shared in logs, screenshots, or source control.

## Dashboard

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to view usage analytics.

The dashboard provides:

- Claude usage summary (requests, tokens, PDF volume).
- Date range and PDF filename filters.
- Requests-by-day visualization.
- Interactive Recharts line chart for per-request token usage.
- Hover details for request timestamp and token count.
- Request-level token and model details.
- Server configuration metrics for CPU, memory, and disk usage.
- A separate server metrics refresh button.

### Dashboard login

The current dashboard login is a simple client-side UI gate using `NEXT_PUBLIC_DASHBOARD_USERNAME` and `NEXT_PUBLIC_DASHBOARD_PASSWORD`. It is not suitable for protecting sensitive production data because public environment variables are included in the browser bundle. Use a server-side authentication system before exposing the dashboard publicly.

## Extraction

Ranked chunks are sent to Claude by the server-side `/api/extract` route. Successful extraction usage is logged to MongoDB through `/api/usage`.

## Useful commands

```powershell
npm run dev
npm run lint
npx tsc --noEmit
npm run build
```

The project uses Next.js, React, Tailwind CSS, Lucide icons, Recharts, MongoDB, and the Hugging Face Transformers runtime.

### Embedding model deployment

The retrieval model is downloaded into `web/models/transformers-cache/` and is
ignored by Git because it is a generated deployment artifact. Run
`npm run download:model` once before building or deploying. Production loads
the model from this local cache and does not download it during the first user
request.
