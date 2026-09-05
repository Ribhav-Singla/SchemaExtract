import re
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


EMBEDDING_MODEL = "all-MiniLM-L6-v2"
SEMANTIC_WEIGHT = 0.40
LEXICAL_WEIGHT = 0.30
ENTITY_WEIGHT = 0.20
STRUCTURAL_WEIGHT = 0.10

FIELD_SYNONYMS = {
    "name": ["name", "full name", "person name"],
    "author": ["author", "authors", "written by"],
    "organization": [
        "organization", "organisation", "institution", "company",
        "university", "institute", "department",
    ],
    "affiliation": [
        "affiliation", "institution", "university", "department", "institute",
    ],
    "title": ["title", "document title", "paper title", "report title", "heading"],
    "keyword": ["keyword", "keywords", "key words", "key terms", "index terms"],
    "date": ["date", "day", "month", "year", "published", "created", "issued"],
    "amount": ["amount", "total", "cost", "price", "value", "fee", "payment", "payable"],
    "address": ["address", "location", "place", "residence"],
    "email": ["email", "e-mail", "email address"],
    "phone": ["phone", "telephone", "mobile", "contact number"],
    "percentage": ["percentage", "percent", "rate", "ratio"],
}

ENTITY_PATTERNS = {
    "EMAIL": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "PHONE": re.compile(r"\b(?:\+?\d[\d\s().-]{7,}\d)\b"),
    "DATE": re.compile(
        r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|"
        r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b",
        re.IGNORECASE,
    ),
    "MONEY": re.compile(
        r"(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|INR|Rs\.?)\b)",
        re.IGNORECASE,
    ),
    "PERCENT": re.compile(r"\b\d+(?:\.\d+)?\s?%"),
    "NUMBER": re.compile(r"\b\d+(?:\.\d+)?\b"),
    "ORG": re.compile(
        r"\b(?:University|Institute|College|Department|Corporation|Corp\.?|Company|Ltd\.?|Limited|Inc\.?)\b",
        re.IGNORECASE,
    ),
}


def flatten_schema(schema: Any, prefix: str = "") -> list[str]:
    fields = []
    if isinstance(schema, dict):
        for key, value in schema.items():
            field_name = f"{prefix}.{key}" if prefix else key
            if isinstance(value, dict):
                fields.extend(flatten_schema(value, field_name))
            elif isinstance(value, list):
                fields.append(field_name)
                if value and isinstance(value[0], dict):
                    fields.extend(flatten_schema(value[0], field_name))
            else:
                fields.append(field_name)
    return fields


def normalize_field_name(field: str) -> str:
    field = field.split(".")[-1]
    field = re.sub(r"[_-]+", " ", field)
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", field).lower().strip()


def expand_field(field: str) -> list[str]:
    normalized = normalize_field_name(field)
    terms = {normalized}
    for word in normalized.split():
        terms.update(FIELD_SYNONYMS.get(word, []))
    for key, synonyms in FIELD_SYNONYMS.items():
        if key in normalized:
            terms.update(synonyms)
    return sorted(terms)


def infer_entity_types(field: str) -> set[str]:
    field = normalize_field_name(field)
    types = set()
    if any(word in field for word in ("name", "author", "person", "researcher")):
        types.add("PERSON")
    if any(word in field for word in ("organization", "organisation", "company", "university", "institution", "institute", "department", "affiliation")):
        types.add("ORG")
    if any(word in field for word in ("date", "day", "month", "year")):
        types.add("DATE")
    if any(word in field for word in ("amount", "price", "cost", "fee", "payment", "total", "salary", "revenue")):
        types.add("MONEY")
    if any(word in field for word in ("percentage", "percent", "ratio", "rate")):
        types.add("PERCENT")
    if "email" in field:
        types.add("EMAIL")
    if any(word in field for word in ("phone", "mobile", "telephone")):
        types.add("PHONE")
    return types


def detect_entities(text: str) -> dict[str, int]:
    counts = {entity_type: len(pattern.findall(text)) for entity_type, pattern in ENTITY_PATTERNS.items()}
    counts["PERSON"] = len(re.findall(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b", text))
    return counts


def normalize_scores(scores: np.ndarray) -> np.ndarray:
    scores = np.asarray(scores, dtype=float)
    if len(scores) == 0 or scores.max() == scores.min():
        return np.zeros_like(scores)
    return (scores - scores.min()) / (scores.max() - scores.min())


def lexical_scores(chunks: list[dict], query_terms: list[str]) -> np.ndarray:
    if not chunks or not query_terms:
        return np.zeros(len(chunks))
    texts = [chunk["text"] for chunk in chunks]
    matrix = TfidfVectorizer(lowercase=True, stop_words="english", ngram_range=(1, 2)).fit_transform(texts + [" ".join(query_terms)])
    return normalize_scores(cosine_similarity(matrix[:-1], matrix[-1]).ravel())


def entity_scores(chunks: list[dict], expected_types: set[str]) -> np.ndarray:
    scores = []
    for chunk in chunks:
        counts = detect_entities(chunk["text"])
        score = sum(counts.get(entity_type, 0) > 0 for entity_type in expected_types)
        scores.append(score / len(expected_types) if expected_types else 0.0)
    return normalize_scores(np.array(scores))


def structural_scores(chunks: list[dict], fields: list[str]) -> np.ndarray:
    field_text = " ".join(normalize_field_name(field) for field in fields)
    metadata_fields = ("title", "author", "authors", "affiliation", "keyword", "keywords", "organization")
    scores = []
    for chunk in chunks:
        section = chunk.get("section", "").lower()
        score = sum(word in section for word in field_text.split() if len(word) > 3)
        if any(field in field_text for field in metadata_fields) and chunk.get("chunk_index", 0) <= 2:
            score += 2
        if any(word in section for word in ("reference", "bibliography")):
            score -= 2
        scores.append(score)
    return normalize_scores(np.array(scores))


class ChunkRetriever:
    def __init__(self, embedding_model: str = EMBEDDING_MODEL):
        from sentence_transformers import SentenceTransformer

        self.embedding_model = SentenceTransformer(embedding_model)

    def retrieve(
        self,
        chunks: list[dict],
        schema: Any,
        top_k: int = 5,
        threshold: float = 0.5,
    ) -> list[dict]:
        if not chunks:
            return []
        fields = flatten_schema(schema)
        expanded_terms = sorted({term for field in fields for term in expand_field(field)})
        expected_types = {entity_type for field in fields for entity_type in infer_entity_types(field)}

        texts = [chunk["text"] for chunk in chunks]
        query = " ".join(expanded_terms)
        embeddings = self.embedding_model.encode(texts + [query], normalize_embeddings=True, show_progress_bar=False)
        semantic = normalize_scores(np.dot(embeddings[:-1], embeddings[-1]))
        lexical = lexical_scores(chunks, expanded_terms)
        entity = entity_scores(chunks, expected_types)
        structural = structural_scores(chunks, fields)
        final = (SEMANTIC_WEIGHT * semantic + LEXICAL_WEIGHT * lexical + ENTITY_WEIGHT * entity + STRUCTURAL_WEIGHT * structural)

        ranked = []
        for index, chunk in enumerate(chunks):
            result = dict(chunk)
            result["scores"] = {
                "semantic": round(float(semantic[index]), 4),
                "lexical": round(float(lexical[index]), 4),
                "entity": round(float(entity[index]), 4),
                "structural": round(float(structural[index]), 4),
                "final": round(float(final[index]), 4),
            }
            result["threshold"] = threshold
            result["passes_threshold"] = bool(final[index] >= threshold)
            ranked.append(result)
        ranked.sort(key=lambda chunk: chunk["scores"]["final"], reverse=True)
        for rank, chunk in enumerate(ranked, start=1):
            chunk["rank"] = rank
        return ranked[:top_k]