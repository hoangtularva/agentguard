"""Offline verification of Callwrit decision tokens.

agt1.<payload>.<HMAC-SHA256>  needs the app's shared key (stdlib only).
agt2.<payload>.<Ed25519>      needs the app's public key (GET /v1/keys/<app>) and the optional
                              `cryptography` package (pip install callwrit[ed25519]).
"""
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


def verify_decision_token(token: str, *, tool: str, args: dict, key: str | None = None, public_key: str | None = None,
                          app_id: str | None = None, now: float | None = None) -> dict:
    """Return the payload if `token` covers exactly this tool + args; raise TokenError otherwise.

    Single use is NOT enforced here: keep a cache of seen `jti`s or use POST /v1/tokens/verify.
    """
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 3 or parts[0] not in ("agt1", "agt2"):
        raise TokenError("MALFORMED", "Not an Callwrit decision token.")
    signed = f"{parts[0]}.{parts[1]}".encode()
    if parts[0] == "agt1":
        if not key:
            raise TokenError("BAD_SIGNATURE", "An HMAC (agt1) token needs the shared key.")
        if not hmac.compare_digest(hmac.new(key.encode(), signed, hashlib.sha256).digest(), _b64d(parts[2])):
            raise TokenError("BAD_SIGNATURE", "Signature mismatch.")
    else:
        if not public_key:
            raise TokenError("BAD_SIGNATURE", "An Ed25519 (agt2) token needs the app's public key.")
        try:
            from cryptography.exceptions import InvalidSignature
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        except ImportError:
            raise TokenError("UNSUPPORTED", "Install `cryptography` for Ed25519 tokens, or verify online with Callwrit.verify_token().") from None
        try:
            Ed25519PublicKey.from_public_bytes(_b64d(public_key)).verify(_b64d(parts[2]), signed)
        except (InvalidSignature, ValueError):
            raise TokenError("BAD_SIGNATURE", "Signature mismatch.") from None
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


class TokenVerifier:
    """Offline verifier with per-process single use (cache of seen token ids until expiry).

    Use in the service that performs the side effect; for replicated tools prefer
    `Callwrit.verify_token` (server-side single use).
    """

    def __init__(self, key: str | None = None, app_id: str | None = None, public_key: str | None = None):
        self.key, self.public_key, self.app_id, self._seen = key, public_key, app_id, {}

    def verify(self, token: str | None, tool: str, args: dict) -> dict:
        if not token:
            raise TokenError("MISSING", "No Callwrit decision token.")
        now = time.time()
        payload = verify_decision_token(token, key=self.key, public_key=self.public_key, tool=tool, args=args, app_id=self.app_id, now=now)
        self._seen = {j: e for j, e in self._seen.items() if e >= now}
        if payload["jti"] in self._seen:
            raise TokenError("REPLAYED", "Token was already used.")
        self._seen[payload["jti"]] = payload["exp"]
        return payload

    def protect(self, tool: str):
        """Decorator for tool implementations called as fn(callwrit_token=..., **args)."""

        def deco(fn):
            import functools

            @functools.wraps(fn)
            def wrapper(*, callwrit_token: str | None = None, **args):
                self.verify(callwrit_token, tool, args)
                return fn(**args)

            return wrapper

        return deco
