"""AgentGuard client: check every tool call of any Python agent before it runs.

Zero dependencies (urllib). Fail closed by default: if AgentGuard cannot be reached, guarded
tools do not run.
"""
from __future__ import annotations

import functools
import inspect
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .provenance import detect_injection_signals, extract_fingerprints


class AgentGuardBlocked(Exception):
    """The call was not allowed (BLOCK, rejected/expired approval, or AgentGuard unavailable)."""

    def __init__(self, tool: str, decision: str, reasons: list[dict], call_id: Optional[str] = None):
        msg = " ".join(r.get("message", "") for r in reasons) or "no reason given"
        super().__init__(f"AgentGuard {decision} for {tool}: {msg}")
        self.tool, self.decision, self.reasons, self.call_id = tool, decision, reasons, call_id


class ApprovalRequired(Exception):
    """A human must approve this call in the Approval Inbox first."""

    def __init__(self, tool: str, approval_id: str, reasons: list[dict], call_id: str):
        super().__init__(f"Approval required for {tool} (approval {approval_id})")
        self.tool, self.approval_id, self.reasons, self.call_id = tool, approval_id, reasons, call_id


class _HttpError(Exception):
    def __init__(self, status: int, body: dict):
        super().__init__(f"{status} {body.get('error', '')}: {body.get('message', '')}")
        self.status, self.body = status, body


@dataclass
class ToolContext:
    call_id: str
    decision_token: Optional[str] = None


@dataclass
class AgentGuard:
    base_url: str
    api_key: str
    timeout: float = 2.0
    privacy: bool = True
    #: "closed" (default) or "allow-reads": read-only guards may run when AgentGuard is unreachable.
    fail_mode: str = "closed"
    _opener: Any = field(default=None, repr=False)

    def request(self, method: str, path: str, body: Any = None) -> dict:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(
            self.base_url.rstrip("/") + path,
            data=data,
            method=method,
            headers={"authorization": f"Bearer {self.api_key}", "content-type": "application/json"},
        )
        try:
            with (self._opener or urllib.request.urlopen)(req, timeout=self.timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"{}")
            except ValueError:
                payload = {}
            raise _HttpError(e.code, payload) from None

    def start_session(self, *, user_ref: str, agent_id: str, prompt: str, tools: list[str],
                      resources: Optional[list[str]] = None, destinations: Optional[list[str]] = None,
                      agents: Optional[list[str]] = None) -> "Session":
        """One session per user task. `prompt` is trusted: recipients typed there are authorized."""
        r = self.request("POST", "/v1/sessions", {
            "userRef": user_ref, "agentId": agent_id, "agents": agents or [], "prompt": prompt,
            "mandate": {"tools": tools, "resources": resources or [], "destinations": destinations or []},
        })
        return Session(self, r["sessionId"], agent_id)

    def session(self, session_id: str, agent_id: str) -> "Session":
        return Session(self, session_id, agent_id)

    def verify_token(self, token: str, tool: str, args: dict) -> dict:
        """For tool backends (key scope `verify`): valid for exactly this tool + args, and unused?"""
        return self.request("POST", "/v1/tokens/verify", {"token": token, "tool": tool, "args": args})

    def _provenance(self, source_type: str, content: str) -> dict:
        if self.privacy:
            return {"fingerprints": extract_fingerprints(content), "signals": detect_injection_signals(source_type, content)}
        return {"content": content}


@dataclass
class Session:
    ag: AgentGuard
    id: str
    agent_id: str

    def as_agent(self, agent_id: str) -> "Session":
        """The same session acting as another agent (multi-agent hand-off keeps provenance)."""
        return Session(self.ag, self.id, agent_id)

    def add_source(self, *, type: str, label: str, content: str, sensitivity: str = "public") -> dict:  # noqa: A002
        """Register content the agent saw (email, web page, document, other agent's message) as UNTRUSTED."""
        return self.ag.request("POST", f"/v1/sessions/{self.id}/sources",
                               {"type": type, "label": label, "sensitivity": sensitivity, **self.ag._provenance(type, content)})

    def check(self, tool: str, args: dict, rationale: Optional[str] = None, parent_call_id: Optional[str] = None) -> dict:
        body = {"sessionId": self.id, "agentId": self.agent_id, "tool": tool, "args": args}
        if rationale:
            body["rationale"] = rationale
        if parent_call_id:
            body["parentCallId"] = parent_call_id
        return self.ag.request("POST", "/v1/check", body)

    def handoff(self, to_agent: str, message: str) -> "Session":
        """Multi-agent hand-off: register this agent's message to `to_agent` as UNTRUSTED provenance
        (it may carry what this agent read), then continue as `to_agent` in the same session."""
        self.add_source(type="agent_message", label=f"{self.agent_id} -> {to_agent}", content=message)
        return self.as_agent(to_agent)

    def wait_for_approval(self, approval_id: str, timeout: float = 600, interval: float = 2.0) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            a = self.ag.request("GET", f"/v1/approvals/{approval_id}")
            if a["status"] == "approved":
                return self.ag.request("POST", f"/v1/approvals/{approval_id}/consume")
            if a["status"] != "pending" or time.monotonic() > deadline:
                raise AgentGuardBlocked("approval", "REVIEW", [{"code": f"APPROVAL_{a['status'].upper()}", "message": f"Approval is {a['status']}."}], a.get("callId"))
            time.sleep(interval)

    def report_result(self, call_id: str, *, ok: bool, output: Any = None, summary: Optional[dict] = None) -> None:
        body: dict = {"ok": ok}
        if summary:
            body["summary"] = summary
        if output is not None:
            p = self.ag._provenance("tool_output", output if isinstance(output, str) else json.dumps(output, default=str))
            body.update({"output": p.get("content"), "outputFingerprints": p.get("fingerprints"), "signals": p.get("signals")})
            body = {k: v for k, v in body.items() if v is not None}
        try:
            self.ag.request("POST", f"/v1/calls/{call_id}/result", body)
        except Exception:  # reporting is best effort; the decision already happened
            pass

    def guard(self, tool: str, fn: Callable[..., Any], *, wait: bool = False, read_only: bool = False,
              report_output: bool = True, wait_timeout: float = 600, wait_interval: float = 2.0) -> Callable[..., Any]:
        """Wrap `fn(**args)`. It runs only on ALLOW (or after approval). If `fn` accepts a keyword
        argument `agentguard`, it receives a ToolContext with the decision token."""
        wants_ctx = "agentguard" in inspect.signature(fn).parameters

        @functools.wraps(fn)
        def wrapper(**args: Any) -> Any:
            try:
                r = self.check(tool, args)
            except Exception as e:  # noqa: BLE001 — any failure to get a decision is a refusal
                unavailable = not isinstance(e, _HttpError) or e.status >= 500 or e.status == 429
                if unavailable and read_only and self.ag.fail_mode == "allow-reads":
                    return fn(**args)
                raise AgentGuardBlocked(tool, "UNAVAILABLE" if unavailable else "BLOCK", [{"code": "AGENTGUARD_ERROR", "message": str(e)}]) from None
            ctx = ToolContext(r["callId"], r.get("decisionToken"))
            if r["decision"] == "BLOCK":
                raise AgentGuardBlocked(tool, "BLOCK", r["reasons"], r["callId"])
            if r["decision"] == "REVIEW":
                if not wait:
                    raise ApprovalRequired(tool, r["approvalId"], r["reasons"], r["callId"])
                w = self.wait_for_approval(r["approvalId"], wait_timeout, wait_interval)
                ctx = ToolContext(w["callId"], w.get("decisionToken"))
            try:
                out = fn(**args, agentguard=ctx) if wants_ctx else fn(**args)
            except Exception as e:
                self.report_result(ctx.call_id, ok=False, summary={"error": str(e)[:200]})
                raise
            self.report_result(ctx.call_id, ok=True, output=out if report_output else None)
            return out

        return wrapper


def guarded(session_getter: Callable[[], Session], tool: Optional[str] = None, **opts: Any):
    """Decorator form: `@guarded(lambda: current_session, "send_email")` above a tool function."""

    def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def call(**args: Any) -> Any:
            return session_getter().guard(tool or fn.__name__, fn, **opts)(**args)

        return call

    return deco
