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


def _parse_sop_fields(text: str) -> dict[str, str]:
    title = ""
    doc_id = ""
    clause = ""
    revision = ""
    effective_date = ""
    body_lines: list[str] = []

    for line in text.splitlines():
        s = line.strip()
        if s.startswith("# ") and not title:
            title = s[2:].strip()
        elif s.startswith("Document ID:") and not doc_id:
            doc_id = s.split(":", 1)[1].strip()
        elif s.startswith("Revision:") and not revision:
            revision = s.split(":", 1)[1].strip()
        elif s.startswith("Effective Date:") and not effective_date:
            effective_date = s.split(":", 1)[1].strip()
        elif s.startswith("## ") and not clause:
            clause = s[3:].strip()
        elif s:
            body_lines.append(s)

    return {
        "title": title,
        "doc_id": doc_id,
        "clause": clause,
        "revision": revision,
        "effective_date": effective_date,
        "body": " ".join(body_lines),
    }


def _parse_sop_file(path: Path) -> _SOPChunk:
    fields = _parse_sop_fields(path.read_text(encoding="utf-8"))
    return _SOPChunk(
        doc_id=fields["doc_id"] or path.stem.upper(),
        title=fields["title"] or path.stem.replace("_", " ").title(),
        clause=fields["clause"] or "Clause 1",
        revision=fields["revision"] or "v1",
        effective_date=fields["effective_date"] or "2026-10-01",
        body=fields["body"],
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
        paths = sorted(corpus_dir.glob("*.md"))
        self._chunks = [_parse_sop_file(p) for p in paths]
        self._by_stem = {p.stem: chunk for p, chunk in zip(paths, self._chunks)}

    def search(self, query: str, scope: str = "all", top_k: int = 2) -> list[PolicyCitation]:
        """Return cited, <=150-token policy passages."""
        if self.settings.vertex_rag_corpus and self.settings.gcp_project_id:
            vertex_hits = self._try_vertex_rag(query, top_k=top_k)
            if vertex_hits:
                return vertex_hits
        return self._search_local(query=query, scope=scope, top_k=top_k)

    def _resolve_rag_location(self) -> str:
        if self.settings.vertex_rag_location.strip():
            return self.settings.vertex_rag_location.strip()
        m = re.search(r"/locations/([^/]+)/", self.settings.vertex_rag_corpus)
        if m:
            return m.group(1)
        return self.settings.gcp_location

    def _resolve_rag_project(self) -> str:
        m = re.search(r"/projects/([^/]+)/", self.settings.vertex_rag_corpus)
        if m:
            return m.group(1)
        return self.settings.gcp_project_id

    def _try_vertex_rag(self, query: str, top_k: int) -> list[PolicyCitation]:
        """Query managed Vertex AI RAG Engine via REST retrieveContexts; fall back on error."""
        try:
            import google.auth  # type: ignore
            from google.auth.transport.requests import Request  # type: ignore
            import httpx

            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            if not creds.valid:
                creds.refresh(Request())
            if not creds.token:
                return []

            rag_loc = self._resolve_rag_location()
            project = self._resolve_rag_project()
            if not rag_loc or not project:
                return []

            url = (
                f"https://{rag_loc}-aiplatform.googleapis.com/v1beta1/"
                f"projects/{project}/locations/{rag_loc}:retrieveContexts"
            )
            body = {
                "vertexRagStore": {
                    "ragResources": [{"ragCorpus": self.settings.vertex_rag_corpus}],
                },
                "query": {"text": query, "ragRetrievalConfig": {"topK": top_k}},
            }
            resp = httpx.post(
                url,
                headers={"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"},
                json=body,
                timeout=2.5,
            )
            resp.raise_for_status()
            payload = resp.json()
            contexts = (payload.get("contexts") or {}).get("contexts") or []

            citations: list[PolicyCitation] = []
            for idx, ctx in enumerate(contexts[:top_k], start=1):
                chunk_obj = ctx.get("chunk") or {}
                raw_text = (ctx.get("text") or chunk_obj.get("text") or "").strip()
                if not raw_text:
                    continue
                src_name = ctx.get("sourceDisplayName") or ctx.get("sourceUri") or ""
                stem = Path(src_name).stem if src_name else ""
                base = self._by_stem.get(stem)
                parsed = _parse_sop_fields(raw_text)
                citations.append(
                    PolicyCitation(
                        doc_id=parsed["doc_id"] or (base.doc_id if base else (stem.upper() or f"VERTEX-SOP-{idx}")),
                        title=parsed["title"] or (base.title if base else "Vertex AI Enterprise SOP"),
                        clause=parsed["clause"] or (base.clause if base else f"Retrieved Passage {idx}"),
                        revision=parsed["revision"] or (base.revision if base else "vertex-corpus"),
                        effective_date=parsed["effective_date"] or (base.effective_date if base else "2026-10-01"),
                        excerpt=_cap_words(parsed["body"] or raw_text, 105),
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
