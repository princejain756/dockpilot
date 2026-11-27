"""Vertex AI Model Armor prompt-injection guard with deterministic offline parity."""

from __future__ import annotations

import logging
import re
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_ADVERSARIAL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("SYSTEM_OVERRIDE", re.compile(r"\bsystem\s*(?:override|prompt|instruction)?\s*:", re.I)),
    ("IGNORE_INSTRUCTIONS", re.compile(r"\bignore\s+(?:previous|all|prior|the)\s+(?:instructions|shortage|missing|rules|policy)", re.I)),
    ("FORCE_FULL_RECEIPT", re.compile(r"\bmark\s+100%\s+received\b", re.I)),
    ("BYPASS_GATE", re.compile(r"\b(?:bypass|skip|disable|override)\s+(?:supervisor|approval|shortage|write[\s-]*gate|policy)\b", re.I)),
    ("ROLE_HIJACK", re.compile(r"\byou\s+are\s+now\s+(?:admin|supervisor|authorized)\b", re.I)),
]


def _local_screen(text: str) -> list[str]:
    findings: list[str] = []
    for label, pattern in _ADVERSARIAL_PATTERNS:
        if pattern.search(text):
            findings.append(label)
    return findings


class ModelArmorGuard:
    """Screens extracted challan/invoice OCR text through Vertex AI Model Armor before state mutation."""

    def __init__(self, project_id: str, location: str, template_id: str) -> None:
        self.project_id = project_id.strip()
        self.location = (location or "asia-south1").strip()
        self.template_id = (template_id or "dockpilot-challan-guard").strip()
        self._creds: Any = None

    @property
    def cloud_enabled(self) -> bool:
        return bool(self.project_id and self.template_id)

    def _access_token(self) -> str:
        import google.auth  # type: ignore
        import google.auth.transport.requests  # type: ignore

        if self._creds is None:
            self._creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if not self._creds.valid:
            self._creds.refresh(google.auth.transport.requests.Request())
        return str(self._creds.token)

    def inspect_text(self, text: str) -> dict[str, Any]:
        """Inspect OCR text or raw user input; return structured Model Armor verdict."""
        t0 = time.monotonic()
        clean_text = (text or "").strip()
        if not clean_text:
            return {
                "safe": True,
                "backend": "vertex_model_armor" if self.cloud_enabled else "deterministic_guard",
                "location": self.location,
                "template": self.template_id,
                "match_state": "NO_MATCH_FOUND",
                "findings": [],
                "latency_ms": 0.0,
            }

        local_findings = _local_screen(clean_text)

        if self.cloud_enabled:
            endpoint = (
                f"https://modelarmor.{self.location}.rep.googleapis.com/v1/"
                f"projects/{self.project_id}/locations/{self.location}/"
                f"templates/{self.template_id}:sanitizeUserPrompt"
            )
            try:
                token = self._access_token()
                with httpx.Client(timeout=8.0) as client:
                    resp = client.post(
                        endpoint,
                        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                        json={"userPromptData": {"text": clean_text[:8000]}},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                san = data.get("sanitizationResult", {})
                match_state = str(san.get("filterMatchState", "NO_MATCH_FOUND"))
                cloud_findings: list[str] = []
                for fname, fres in (san.get("filterResults") or {}).items():
                    if isinstance(fres, dict):
                        for inner in fres.values():
                            if isinstance(inner, dict) and inner.get("matchState") == "MATCH_FOUND":
                                cloud_findings.append(f"MODEL_ARMOR:{fname}:{inner.get('confidenceLevel', 'MATCH')}")
                all_findings = list(dict.fromkeys([*cloud_findings, *local_findings]))
                safe = match_state != "MATCH_FOUND" and not local_findings
                return {
                    "safe": safe,
                    "backend": "vertex_model_armor",
                    "location": self.location,
                    "template": self.template_id,
                    "match_state": "MATCH_FOUND" if not safe else match_state,
                    "findings": all_findings,
                    "latency_ms": round((time.monotonic() - t0) * 1000.0, 1),
                }
            except Exception as exc:
                logger.warning("Model Armor REST fallback triggered: %s", exc)

        safe = not local_findings
        return {
            "safe": safe,
            "backend": "deterministic_guard",
            "location": self.location,
            "template": self.template_id,
            "match_state": "MATCH_FOUND" if not safe else "NO_MATCH_FOUND",
            "findings": local_findings,
            "latency_ms": round((time.monotonic() - t0) * 1000.0, 1),
        }
