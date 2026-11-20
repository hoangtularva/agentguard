import { type KeyObject, createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from "node:crypto";
import { hashCanonical } from "./canonical";

/**
 * Decision tokens: proof, checkable by the tool itself, that AgentGuard allowed THIS call.
 *
 *   agt1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, "agt1." + payload))>   shared-key
 *   agt2.<base64url(JSON payload)>.<base64url(Ed25519(privateKey, "agt2." + payload))> public-key
 *
 * The payload binds the call id, app, agent, tool and a canonical hash of the arguments, and
 * expires quickly. A tool that verifies the token before acting refuses calls that bypassed
 * the guard, were altered after the decision, or replay an old decision (single use is
 * enforced by the server's consumption record or the verifier's own cache).
 */
export interface DecisionTokenPayload {
  /** Token id (single use). */
  jti: string;
  app: string;
  agent: string;
  call: string;
  tool: string;
  /** hashCanonical(args) */
  ah: string;
  /** Issued at / expires at, unix seconds. */
  iat: number;
  exp: number;
}

export type TokenCheck =
  | { ok: true; payload: DecisionTokenPayload }
  | { ok: false; code: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "WRONG_TOOL" | "ARGS_MISMATCH" | "WRONG_APP"; message: string };

const PREFIX = "agt1";
const PREFIX_ED = "agt2";
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (key: string | Buffer, body: string) => createHmac("sha256", key).update(`${PREFIX}.${body}`).digest();
/** PKCS#8 / SPKI DER prefixes for raw 32-byte Ed25519 keys (RFC 8410). */
const ED_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const ED_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** Per-app signing key derived from a server secret, so no signing key is stored at rest. */
export function deriveTokenKey(serverSecret: string, appId: string, keyVersion: number): string {
  return createHmac("sha256", serverSecret).update(`agentguard/decision-token/${appId}/${keyVersion}`).digest("hex");
}

/**
 * Per-app Ed25519 key pair derived from the server secret (no private key at rest). The public
 * key (base64url, 32 bytes) can be handed to any tool service: it verifies without a secret.
 */
export function deriveEd25519KeyPair(serverSecret: string, appId: string, keyVersion: number): { privateKey: KeyObject; publicKey: string } {
  const seed = createHmac("sha256", serverSecret).update(`agentguard/decision-token-ed25519/${appId}/${keyVersion}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([ED_PKCS8, seed]), format: "der", type: "pkcs8" });
  const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(ED_SPKI.length);
  return { privateKey, publicKey: b64(raw) };
}

export function signDecisionTokenEd25519(privateKey: KeyObject, payload: DecisionTokenPayload): string {
  const body = b64(JSON.stringify(payload));
  return `${PREFIX_ED}.${body}.${b64(sign(null, Buffer.from(`${PREFIX_ED}.${body}`), privateKey))}`;
}

export function signDecisionToken(key: string, payload: DecisionTokenPayload): string {
  const body = b64(JSON.stringify(payload));
  return `${PREFIX}.${body}.${b64(mac(key, body))}`;
}

/**
 * Verify signature, expiry and that the token covers exactly this tool + arguments.
 * Does NOT enforce single use: pair it with a consumption check (server or local cache).
 */
export function verifyDecisionToken(
  token: string,
  opts: {
    /** Shared HMAC key (agt1 tokens). */
    key?: string;
    /** Ed25519 public key, base64url raw 32 bytes (agt2 tokens). */
    publicKey?: string;
    tool: string;
    args: unknown;
    appId?: string;
    nowSeconds?: number;
  },
): TokenCheck {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || (parts[0] !== PREFIX && parts[0] !== PREFIX_ED))
    return { ok: false, code: "MALFORMED", message: "Not an AgentGuard decision token." };
  const [kind, body, sig] = parts;
  const got = Buffer.from(sig, "base64url");
  if (kind === PREFIX) {
    if (!opts.key) return { ok: false, code: "BAD_SIGNATURE", message: "An HMAC (agt1) token needs the shared key." };
    const want = mac(opts.key, body);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, code: "BAD_SIGNATURE", message: "Signature mismatch." };
  } else {
    if (!opts.publicKey) return { ok: false, code: "BAD_SIGNATURE", message: "An Ed25519 (agt2) token needs the app's public key." };
    let valid = false;
    try {
      const pub = createPublicKey({ key: Buffer.concat([ED_SPKI, Buffer.from(opts.publicKey, "base64url")]), format: "der", type: "spki" });
      valid = verify(null, Buffer.from(`${PREFIX_ED}.${body}`), pub, got);
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, code: "BAD_SIGNATURE", message: "Signature mismatch." };
  }
  let payload: DecisionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "MALFORMED", message: "Unreadable payload." };
  }
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now > payload.exp) return { ok: false, code: "EXPIRED", message: "Decision token expired." };
  if (opts.appId && payload.app !== opts.appId) return { ok: false, code: "WRONG_APP", message: "Token was issued for another app." };
  if (payload.tool !== opts.tool) return { ok: false, code: "WRONG_TOOL", message: `Token covers "${payload.tool}", not "${opts.tool}".` };
  if (payload.ah !== hashCanonical(opts.args)) return { ok: false, code: "ARGS_MISMATCH", message: "Arguments differ from the allowed call." };
  return { ok: true, payload };
}
