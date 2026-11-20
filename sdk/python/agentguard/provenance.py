"""Privacy-mode helpers. Must stay identical to packages/core/src/provenance.ts
(checked by tests/integration/sdk-python.test.ts on shared fixtures)."""
from __future__ import annotations

import re

_EMAIL = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.I)
_URL = re.compile(r"https?://[^\s\"'<>)]+", re.I)
_PATTERNS = [
    ("injection_override", re.compile(r"\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all)\b.{0,20}\b(instructions?|rules?)\b", re.I)),
    ("injection_role", re.compile(r"\b(system (prompt|notice|message)|you are now|new instructions?|as the assistant)\b", re.I)),
    ("injection_action", re.compile(r"\b(send|forward|email|export|upload|transfer)\b.{0,80}\b(to|at)\b\s+\S+(@|https?://)", re.I)),
    ("injection_secrecy", re.compile(r"\b(do not (tell|mention|inform)|without (telling|notifying)|silently|secretly)\b", re.I)),
]
UNTRUSTED_TYPES = {"document", "email", "web", "tool_output"}


def normalize_value(v: str) -> str:
    return re.sub(r"/+$", "", v.strip().lower())


def extract_fingerprints(text: str) -> list[str]:
    """Normalized emails and http(s) URLs in `text`: all destination provenance needs."""
    found = _EMAIL.findall(text) + [m.group(0) for m in _URL.finditer(text)]
    return sorted({normalize_value(re.sub(r"[.,;:]+$", "", v)) for v in found})


def detect_injection_signals(source_type: str, content: str) -> list[str]:
    """Deterministic heuristics for instruction-like text in untrusted content (escalate only)."""
    if source_type not in UNTRUSTED_TYPES:
        return []
    hits = [name for name, rx in _PATTERNS if rx.search(content)]
    return ["injection_suspected", *hits] if hits else []
