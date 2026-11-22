# callwrit (Python)

Guard the tool calls of **any** Python agent (plain functions, LangChain/LangGraph tools, CrewAI, AutoGen, your own loop) with an Callwrit server. Zero dependencies, Python ≥ 3.10.

```python
from callwrit import Callwrit, CallwritBlocked, ApprovalRequired

ag = Callwrit("http://localhost:3000", api_key=os.environ["CALLWRIT_KEY"])
session = ag.start_session(
    user_ref=user.id, agent_id="researcher", agents=["writer"],
    prompt="Summarize my inbox and email it to boss@corp.example",   # trusted channel
    tools=["read_inbox", "send_email"],
)

read_inbox = session.guard("read_inbox", mail.list)                    # runs only on ALLOW
send_email = session.handoff("writer", notes).guard("send_email", mail.send)  # notes become untrusted provenance

read_inbox(folder="inbox")          # output registered as untrusted provenance (fingerprints only)
try:
    send_email(to="boss@corp.example", body=summary)
except ApprovalRequired as e:
    print("approve", e.approval_id, "in the Callwrit Approval Inbox")
except CallwritBlocked as e:
    print("blocked:", e.reasons)
```

- `guard(..., wait=True)` polls for the human decision, consumes the approval and runs once.
- A tool function that accepts a keyword argument `callwrit` receives a `ToolContext` with `decision_token`; verify it in the tool backend with `ag.verify_token(...)` (server, single use) or `verify_decision_token(token, key=..., tool=..., args=...)` (offline).
- Decorator form: `@guarded(lambda: current_session, "send_email")`.
- **Fail closed:** unreachable server, timeout (2 s), 5xx or 429 ⇒ `CallwritBlocked(decision="UNAVAILABLE")`. `fail_mode="allow-reads"` lets `read_only=True` guards run in that case; sinks never fail open.
- **Privacy mode** (default): sources and outputs are sent as email/URL fingerprints + local injection signals, never the text. Tool arguments are sent as-is.

Tests: `tests/test_sdk.py` (run against a live server by `npm test` in the repository).
