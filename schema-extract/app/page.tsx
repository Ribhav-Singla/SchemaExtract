"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type RankedChunk = {
  chunk_id: string;
  chunk_index: number;
  rank: number;
  section: string;
  section_level: number;
  section_id: number;
  text: string;
  prev_text: string;
  char_count: number;
  word_count: number;
  scores: { semantic: number; lexical: number; entity: number; structural: number; final: number };
  threshold: number;
  passes_threshold: boolean;
};

type AnalysisResult = { document: string; total_chunks: number; threshold: number; chunks: RankedChunk[] };

const sampleSchema = `{
  "research_area": "",
  "application": "",
  "base_algorithm": "",
  "environment": "",
  "main_finding": ""
}`;

export default function Home() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [schema, setSchema] = useState(sampleSchema);
  const [topK, setTopK] = useState("5");
  const [threshold, setThreshold] = useState("0.5");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function selectPdf(event: ChangeEvent<HTMLInputElement>) {
    setPdf(event.target.files?.[0] ?? null);
    setError("");
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!pdf) {
      setError("Choose a PDF before running the analysis.");
      return;
    }
    const formData = new FormData();
    formData.append("pdf", pdf);
    formData.append("schema", schema);
    formData.append("topK", topK);
    formData.append("threshold", threshold);
    setLoading(true);
    try {
      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand-mark">SE</div>
        <div><p className="eyebrow">Schema-aware document intelligence</p><h1>Find the signal<br /><em>inside your PDF.</em></h1></div>
        <div className="status"><span /> Local analysis</div>
      </header>
      <section className="workspace">
        <form className="control-panel" onSubmit={analyze}>
          <div className="section-heading"><span>01</span><h2>Load a document</h2></div>
          <label className="dropzone" htmlFor="pdf-upload">
            <input id="pdf-upload" type="file" accept="application/pdf,.pdf" onChange={selectPdf} />
            <span className="upload-icon">↑</span><strong>{pdf ? pdf.name : "Choose a PDF"}</strong>
            <small>{pdf ? `${(pdf.size / 1024 / 1024).toFixed(2)} MB ready` : "Drop it here or browse your files"}</small>
          </label>
          <div className="section-heading schema-heading"><span>02</span><h2>Define what matters</h2></div>
          <label className="field-label" htmlFor="schema">JSON schema</label>
          <textarea id="schema" value={schema} onChange={(event) => setSchema(event.target.value)} spellCheck={false} />
          <div className="settings-row">
            <label><span>Top chunks</span><input type="number" min="1" max="50" value={topK} onChange={(event) => setTopK(event.target.value)} /></label>
            <label><span>Pass threshold</span><input type="number" min="0" max="1" step="0.1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
          </div>
          <button className="analyze-button" type="submit" disabled={loading}>{loading ? "Reading document..." : "Analyze document →"}</button>
          {error && <p className="error">{error}</p>}
        </form>
        <section className="results-panel">
          <div className="results-header"><div><p className="eyebrow">Analysis output</p><h2>{result ? result.document : "Top matching chunks"}</h2></div>{result && <span className="count-pill">{result.chunks.length} of {result.total_chunks}</span>}</div>
          {!result && !loading && <div className="empty-state"><div className="empty-line" /><p>Your ranked evidence will appear here.</p><small>Upload a PDF and describe its key fields to begin.</small></div>}
          {loading && <div className="empty-state"><div className="loader" /><p>Extracting and ranking evidence...</p><small>Large documents may take a moment.</small></div>}
          {result && <div className="chunk-list">{result.chunks.map((chunk) => <article className="chunk" key={chunk.chunk_id}>
            <div className="chunk-meta"><span>Rank #{String(chunk.rank).padStart(2, "0")} · {chunk.chunk_id}</span><span className={chunk.passes_threshold ? "pass" : "review"}>{chunk.passes_threshold ? "Passes threshold" : "Below threshold"}</span></div>
            <div className="chunk-fields"><span><b>Section</b>{chunk.section}</span><span><b>Section level</b>{chunk.section_level}</span><span><b>Section ID</b>{chunk.section_id}</span><span><b>Chunk index</b>{chunk.chunk_index}</span></div>
            <p className="chunk-text">{chunk.text}</p>
            {chunk.prev_text && <details className="previous-context"><summary>Previous chunk context</summary><p>{chunk.prev_text}</p></details>}
            <div className="chunk-fields stats"><span><b>Characters</b>{chunk.char_count.toLocaleString()}</span><span><b>Words</b>{chunk.word_count.toLocaleString()}</span><span><b>Threshold</b>{chunk.threshold.toFixed(2)}</span></div>
            <div className="score-row"><span>Semantic <b>{chunk.scores.semantic.toFixed(4)}</b></span><span>Lexical <b>{chunk.scores.lexical.toFixed(4)}</b></span><span>Entity <b>{chunk.scores.entity.toFixed(4)}</b></span><span>Structural <b>{chunk.scores.structural.toFixed(4)}</b></span><span>Final <b>{chunk.scores.final.toFixed(4)}</b></span></div>
          </article>)}</div>}
        </section>
      </section>
    </main>
  );
}