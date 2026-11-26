"""Application configuration for DockPilot."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SOP_CORPUS_DIR = BASE_DIR / "sop_corpus"
DEFAULT_SQLITE_PATH = Path(tempfile.gettempdir()) / "dockpilot_ledger.sqlite3"


def _env_str(key: str, default: str = "") -> str:
    return os.getenv(key, default)


@dataclass(frozen=True)
class Settings:
    """Environment-driven runtime settings for DockPilot."""

    gcp_project_id: str = field(default_factory=lambda: _env_str("GCP_PROJECT_ID", ""))
    gcp_location: str = field(default_factory=lambda: _env_str("GCP_LOCATION", "asia-south1"))
    vertex_fallback_location: str = field(
        default_factory=lambda: _env_str("VERTEX_FALLBACK_LOCATION", "us-central1")
    )
    gemini_live_model: str = field(default_factory=lambda: _env_str("GEMINI_LIVE_MODEL", "gemini-3.8-live"))
    gemini_live_voice: str = field(default_factory=lambda: _env_str("GEMINI_LIVE_VOICE", "Despina"))
    gemini_live_language_code: str = field(
        default_factory=lambda: _env_str("GEMINI_LIVE_LANGUAGE_CODE", "hi-IN")
    )
    gemini_api_key: str = field(default_factory=lambda: _env_str("GEMINI_API_KEY", ""))
    storage_backend: str = field(default_factory=lambda: _env_str("STORAGE_BACKEND", "sqlite"))
    sqlite_path: str = field(default_factory=lambda: _env_str("DOCKPILOT_SQLITE_PATH", str(DEFAULT_SQLITE_PATH)))
    firestore_database: str = field(default_factory=lambda: _env_str("FIRESTORE_DATABASE", "(default)"))
    vertex_rag_corpus: str = field(default_factory=lambda: _env_str("VERTEX_RAG_CORPUS", ""))
    vertex_rag_location: str = field(default_factory=lambda: _env_str("VERTEX_RAG_LOCATION", ""))
    hitl_shortage_threshold_inr: int = field(
        default_factory=lambda: int(os.getenv("HITL_SHORTAGE_THRESHOLD_INR", "25000"))
    )
    fx_inr_per_usd: float = field(default_factory=lambda: float(os.getenv("FX_INR_PER_USD", "84.50")))
    git_sha: str = field(default_factory=lambda: _env_str("GIT_SHA", "clean-room-dev"))
    cors_origins: str = field(default_factory=lambda: _env_str("CORS_ORIGINS", "*"))


def get_settings() -> Settings:
    """Return current immutable settings snapshot."""
    return Settings()
