"""Live FinOps, latency, barge-in, and SNR telemetry meter."""

from __future__ import annotations

from dataclasses import dataclass, field


# Verified Google Cloud Gemini 3.8 Live non-global USD per 1M token rates (2026-11-23)
RATE_TEXT_IN = 0.75
RATE_IMAGE_IN = 1.00
RATE_AUDIO_IN = 3.00
RATE_TEXT_OUT = 4.50
RATE_AUDIO_OUT = 12.00

NAIVE_MONOLITHIC_PROMPT_TOKENS = 20000


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * q))))
    return round(ordered[idx], 1)


@dataclass
class FinOpsMeter:
    """Tracks observed Live API token/latency metrics and shadow naive cost."""

    fx_inr_per_usd: float = 84.50
    turns: int = 0
    text_in_tokens: int = 0
    image_in_tokens: int = 0
    audio_in_tokens: int = 0
    text_out_tokens: int = 0
    audio_out_tokens: int = 0
    active_prompt_tokens: int = 110
    duration_seconds: float = 0.0
    ttfa_samples_ms: list[float] = field(default_factory=list)
    barge_stop_samples_ms: list[float] = field(default_factory=list)
    snr_before_db: float | None = None
    snr_after_db: float | None = None
    dropped_audio_frames: int = 0
    noise_filter_mode: str = "raw"

    def record_usage(
        self,
        *,
        text_in: int = 0,
        image_in: int = 0,
        audio_in: int = 0,
        text_out: int = 0,
        audio_out: int = 0,
        is_new_turn: bool = True,
    ) -> None:
        if is_new_turn:
            self.turns += 1
        self.text_in_tokens += max(0, text_in)
        self.image_in_tokens += max(0, image_in)
        self.audio_in_tokens += max(0, audio_in)
        self.text_out_tokens += max(0, text_out)
        self.audio_out_tokens += max(0, audio_out)

    def record_ttfa(self, ms: float) -> None:
        if ms >= 0:
            self.ttfa_samples_ms.append(round(ms, 1))

    def record_barge_stop(self, ms: float) -> None:
        if ms >= 0:
            self.barge_stop_samples_ms.append(round(ms, 1))

    def metered_usd(self) -> float:
        return (
            (self.text_in_tokens * RATE_TEXT_IN)
            + (self.image_in_tokens * RATE_IMAGE_IN)
            + (self.audio_in_tokens * RATE_AUDIO_IN)
            + (self.text_out_tokens * RATE_TEXT_OUT)
            + (self.audio_out_tokens * RATE_AUDIO_OUT)
        ) / 1_000_000.0

    def metered_inr(self) -> float:
        return self.metered_usd() * self.fx_inr_per_usd

    def metered_inr_per_min(self) -> float:
        mins = max(self.duration_seconds / 60.0, 1.0 if self.turns == 0 else self.duration_seconds / 60.0)
        if self.duration_seconds < 5.0:
            return round(self.metered_inr(), 2)
        return round(self.metered_inr() / max(mins, 1e-6), 2)

    def shadow_naive_inr(self) -> float:
        """Estimate equivalent session cost under a 20K monolithic prompt + unpruned turns."""
        turns = max(1, self.turns)
        naive_text_in = NAIVE_MONOLITHIC_PROMPT_TOKENS * turns
        # Assume unpruned quadratic audio context (~1.8x retained vs compressed)
        naive_audio_in = max(self.audio_in_tokens, turns * 125) * 1.8
        usd = (
            (naive_text_in * RATE_TEXT_IN)
            + (self.image_in_tokens * RATE_IMAGE_IN)
            + (naive_audio_in * RATE_AUDIO_IN)
            + (self.text_out_tokens * RATE_TEXT_OUT)
            + (self.audio_out_tokens * RATE_AUDIO_OUT)
        ) / 1_000_000.0
        return usd * self.fx_inr_per_usd

    def shadow_naive_inr_per_min(self) -> float:
        if self.duration_seconds < 5.0:
            return round(self.shadow_naive_inr(), 2)
        return round(self.shadow_naive_inr() / (self.duration_seconds / 60.0), 2)

    def snapshot(self) -> dict[str, object]:
        return {
            "turns": self.turns,
            "active_prompt_tokens": self.active_prompt_tokens,
            "naive_prompt_tokens": NAIVE_MONOLITHIC_PROMPT_TOKENS,
            "tokens": {
                "text_in": self.text_in_tokens,
                "image_in": self.image_in_tokens,
                "audio_in": self.audio_in_tokens,
                "text_out": self.text_out_tokens,
                "audio_out": self.audio_out_tokens,
            },
            "duration_seconds": round(self.duration_seconds, 1),
            "metered_inr": round(self.metered_inr(), 4),
            "metered_inr_per_min": self.metered_inr_per_min(),
            "shadow_naive_inr": round(self.shadow_naive_inr(), 4),
            "shadow_naive_inr_per_min": self.shadow_naive_inr_per_min(),
            "ttfa_p50_ms": _percentile(self.ttfa_samples_ms, 0.50),
            "ttfa_p95_ms": _percentile(self.ttfa_samples_ms, 0.95),
            "ttfa_last_ms": self.ttfa_samples_ms[-1] if self.ttfa_samples_ms else 0.0,
            "barge_stop_p50_ms": _percentile(self.barge_stop_samples_ms, 0.50),
            "barge_stop_last_ms": self.barge_stop_samples_ms[-1] if self.barge_stop_samples_ms else 0.0,
            "snr_before_db": self.snr_before_db,
            "snr_after_db": self.snr_after_db,
            "dropped_audio_frames": self.dropped_audio_frames,
            "noise_filter_mode": self.noise_filter_mode,
        }
