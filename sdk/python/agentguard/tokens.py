"""Offline verification of AgentGuard decision tokens (agt1.<payload>.<hmac>)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any


class TokenError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def canonical_json(value: Any) -> str:
    """Same canonical form as the server: recursively sorted keys, no whitespace (null is kept)."""

    def sort(v: Any) -> Any:
        if isinstance(v, dict):
            return {k: sort(v[k]) for k in sorted(v)}
        if isinstance(v, list):
            return [sort(x) for x in v]
        return v

    return json.dumps(sort(value), separators=(",", ":"), ensure_ascii=False)


def hash_canonical(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_decision_token(token: str, *, key: str, tool: str, args: dict, app_id: str | None = None, now: float | None = None) -> dict:
    """Return the payload if `token` covers exactly this tool + args; raise TokenError otherwise.

    Single use is NOT enforced here: keep a cache of seen `jti`s or use POST /v1/tokens/verify.
    """
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 3 or parts[0] != "agt1":
        raise TokenError("MALFORMED", "Not an AgentGuard decision token.")
    want = hmac.new(key.encode(), f"agt1.{parts[1]}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(want, _b64d(parts[2])):
        raise TokenError("BAD_SIGNATURE", "Signature mismatch.")
    payload = json.loads(_b64d(parts[1]))
    if (now if now is not None else time.time()) > payload.get("exp", 0):
        raise TokenError("EXPIRED", "Decision token expired.")
    if app_id and payload.get("app") != app_id:
        raise TokenError("WRONG_APP", "Token was issued for another app.")
    if payload.get("tool") != tool:
        raise TokenError("WRONG_TOOL", f"Token covers {payload.get('tool')!r}, not {tool!r}.")
    if payload.get("ah") != hash_canonical(args):
        raise TokenError("ARGS_MISMATCH", "Arguments differ from the allowed call.")
    return payload
