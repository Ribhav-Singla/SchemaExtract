# Schema Extract

Schema Extract turns PDF documents into structured, evidence-backed JSON using configurable extraction providers.

## Getting started

Run the application from the `web` directory:

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the extractor.

## Environment configuration

Create `web/.env` with the required application settings. Never commit real credentials.

```env
MONGODB_URI=your-mongodb-connection-string
EXTRACTION_WORKER_URL=https://extraction-ai.ticketfusion.workers.dev
EXTRACTION_PROVIDER=apinex
NEXT_PUBLIC_EXTRACTION_PROVIDER=apinex

# Puter
NEXT_PUBLIC_PUTER_MODEL=gpt-5.6-luna

# Apinex
APINEX_API_KEY=your-api-key
APINEX_MODEL=free/gpt-6-luna

# Dashboard
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=change-this-password
NEXT_PUBLIC_DASHBOARD_USERNAME=admin
NEXT_PUBLIC_DASHBOARD_PASSWORD=change-this-password
```

`NEXT_PUBLIC_EXTRACTION_PROVIDER` is used by the browser to select the provider. Supported values are:

- `puter`
- `worker`
- `apinex`

The Apinex API key is used by the server-side `/api/extract/apinex` route and should not be exposed to the browser. Rotate any key that has been shared in logs, screenshots, or source control.

## Dashboard

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to view usage analytics.

The dashboard provides:

- Separate Puter, Worker, and Apinex usage summaries.
- Date range and PDF filename filters.
- Provider filtering.
- Requests-by-day visualization.
- Interactive Recharts line chart for per-request token usage.
- Hover details for request timestamp, provider, PDF name, and token count.
- Request-level token and model details.
- Server configuration metrics for CPU, memory, and disk usage.
- A separate server metrics refresh button.

### Dashboard login

The current dashboard login is a simple client-side UI gate using `NEXT_PUBLIC_DASHBOARD_USERNAME` and `NEXT_PUBLIC_DASHBOARD_PASSWORD`. It is not suitable for protecting sensitive production data because public environment variables are included in the browser bundle. Use a server-side authentication system before exposing the dashboard publicly.

## Extraction providers

The default provider is configured through the environment. To use Apinex:

```env
NEXT_PUBLIC_EXTRACTION_PROVIDER=apinex
APINEX_API_KEY=your-api-key
APINEX_MODEL=free/gpt-6-luna
```

Successful extraction usage is logged to MongoDB through `/api/usage`. Apinex token usage is stored from the provider response and displayed separately from Puter and Worker usage.

## Useful commands

```powershell
npm run dev
npm run lint
npx tsc --noEmit
npm run build
```

The project uses Next.js, React, Tailwind CSS, Lucide icons, Recharts, MongoDB, and the Hugging Face Transformers runtime.
