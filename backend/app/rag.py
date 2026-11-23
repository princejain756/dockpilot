"""Grounded English SOP retrieval wrapped strictly as a backend tool (<=150 tokens)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.config import SOP_CORPUS_DIR, Settings
from app.models import PolicyCitation


@dataclass
class _SOPChunk:
    doc_id: str
    title: str
    clause: str
    revision: str
    effective_date: str
    body: str


def _parse_sop_file(path: Path) -> _SOPChunk:
    text = path.read_text(encoding="utf-8")
    title = path.stem.replace("_", " ").title()
    doc_id = path.stem.upper()
    clause = "Clause 1"
    revision = "v1"
    effective_date = "2026-10-01"
    body_lines: list[str] = []

    for line in text.splitlines():
        s = line.strip()
        if s.startswith("# "):
            title = s[2:].strip()
        elif s.startswith("Document ID:"):
            doc_id = s.split(":", 1)[1].strip()
        elif s.startswith("Revision:"):
            revision = s.split(":", 1)[1].strip()
        elif s.startswith("Effective Date:"):
            effective_date = s.split(":", 1)[1].strip()
        elif s.startswith("## "):
            clause = s[3:].strip()
        elif s:
            body_lines.append(s)

    return _SOPChunk(
        doc_id=doc_id,
        title=title,
        clause=clause,
        revision=revision,
        effective_date=effective_date,
        body=" ".join(body_lines),
    )


def _cap_words(text: str, max_words: int = 105) -> str:
    """Keep excerpt safely <= 150 tokens to protect per-turn Live billing."""
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


class SOPRetriever:
    """Retrieves English receiving SOP clauses via Vertex RAG Engine or local fallback."""

    def __init__(self, settings: Settings, corpus_dir: Path = SOP_CORPUS_DIR):
        self.settings = settings
        self.corpus_dir = corpus_dir
        self._chunks = [_parse_sop_file(p) for p in sorted(corpus_dir.glob("*.md"))]

    def search(self, query: str, scope: str = "all", top_k: int = 2) -> list[PolicyCitation]:
        """Return cited, <=150-token policy passages."""
        if self.settings.vertex_rag_corpus and self.settings.gcp_project_id:
            vertex_hits = self._try_vertex_rag(query, top_k=top_k)
            if vertex_hits:
                return vertex_hits
        return self._search_local(query=query, scope=scope, top_k=top_k)

    def _try_vertex_rag(self, query: str, top_k: int) -> list[PolicyCitation]:
        """Attempt Vertex AI RAG Engine retrieval; gracefully fall back if unavailable."""
        try:
            from vertexai import rag  # type: ignore
            import vertexai  # type: ignore

            vertexai.init(project=self.settings.gcp_project_id, location=self.settings.gcp_location)
            response = rag.retrieval_query(
                rag_resources=[rag.RagResource(rag_corpus=self.settings.vertex_rag_corpus)],
                text=query,
                rag_retrieval_config=rag.RagRetrievalConfig(top_k=top_k),
            )
            contexts = getattr(getattr(response, "contexts", None), "contexts", []) or []
            citations: list[PolicyCitation] = []
            for idx, ctx in enumerate(contexts[:top_k], start=1):
                raw_text = (getattr(ctx, "text", "") or "").strip()
                if not raw_text:
                    continue
                src = getattr(ctx, "source_uri", "") or f"VERTEX-SOP-{idx}"
                citations.append(
                    PolicyCitation(
                        doc_id=src.rsplit("/", 1)[-1],
                        title="Vertex AI Enterprise SOP",
                        clause=f"Retrieved Passage {idx}",
                        revision="vertex-corpus",
                        effective_date="2026-10-01",
                        excerpt=_cap_words(raw_text, 105),
                        source_backend="vertex_rag",
                    )
                )
            return citations
        except Exception:
            return []

    def _search_local(self, query: str, scope: str, top_k: int) -> list[PolicyCitation]:
        q_tokens = set(re.findall(r"[a-z0-9]+", f"{query} {scope}".lower()))
        # Hinglish -> English domain synonyms for cross-language retrieval accuracy
        synonym_map = {
            "short": {"shortage", "partial", "25000", "approval", "supervisor", "debit"},
            "kam": {"shortage", "partial", "25000", "approval"},
            "chaar": {"shortage", "partial", "25000", "supervisor"},
            "approval": {"supervisor", "25000", "threshold", "clause", "approve"},
            "chahiye": {"approval", "supervisor", "threshold"},
            "ruko": {"barge", "interrupt", "superseded", "correction", "read-back"},
            "peti": {"uom", "pack", "carton", "box", "multiplier"},
            "box": {"uom", "pack", "carton", "ambiguous"},
            "eway": {"expired", "hold", "bill", "active"},
            "bill": {"eway", "expired", "invoice", "debit"},
            "damage": {"damaged", "quarantine", "loose", "wet", "crushed"},
            "debit": {"debit", "claim", "cgst", "sgst", "invoice"},
        }
        expanded = set(q_tokens)
        for tok in q_tokens:
            expanded.update(synonym_map.get(tok, ()))

        scored: list[tuple[int, _SOPChunk]] = []
        for chunk in self._chunks:
            hay = set(re.findall(r"[a-z0-9]+", f"{chunk.doc_id} {chunk.title} {chunk.clause} {chunk.body}".lower()))
            overlap = len(expanded & hay)
            if "25000" in hay or "clause 4" in chunk.clause.lower():
                if expanded & {"shortage", "approval", "supervisor", "25000", "partial"}:
                    overlap += 3
            scored.append((overlap, chunk))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        selected = [c for score, c in scored[:top_k] if score > 0] or [scored[0][1]]
        return [
            PolicyCitation(
                doc_id=c.doc_id,
                title=c.title,
                clause=c.clause,
                revision=c.revision,
                effective_date=c.effective_date,
                excerpt=_cap_words(c.body, 105),
                source_backend="local_index",
            )
            for c in selected
        ]
