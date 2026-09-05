# SchemaExtract

## Schema-aware chunk scoring

Run the existing PDF-to-chunks pipeline without ranking:

```bash
python main.py path/to/document.pdf
```

Rank chunks against a JSON schema using semantic, lexical, entity, and
structural scores:

```bash
python main.py path/to/document.pdf --schema examples/example1.json --top-k 5
```

Use `--threshold` to control the pass flag (default: `0.5`):

```bash
python main.py path/to/document.pdf --schema examples/example1.json --threshold 0.7
```

Each ranked chunk includes separate semantic, lexical, entity, and structural
scores, a `total_score`, and a `passes_threshold` boolean. Results are saved as
`<document>_top_chunks.json` in the output directory.
