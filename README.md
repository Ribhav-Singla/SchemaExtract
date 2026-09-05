# SchemaExtract

SchemaExtract is also available as an interactive Next.js app. Upload a PDF,
paste a JSON schema, and inspect the ranked `top_chunks` response in the
browser.

### Run the web app

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, choose a PDF, edit the schema if needed, and
select **Analyze document**. The app extracts text on the server, creates
meaningful sections and chunks, then displays ranked results with their
semantic, lexical, entity, structural, and final scores.

The `examples/` and `output/` directories contain reference schemas and sample
pipeline results.

---
