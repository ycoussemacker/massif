/** Minimal stateless session: an HMAC-signed cookie value, verified in middleware (edge) and set
 * in the /api/login route (node). Web Crypto only, so it runs in both runtimes with no deps.
 * This is a single-password gate in front of an app with NO row-level auth — a UX/access gate,
 * not per-user security. RLS + real auth is the eventual Phase-9 work. */

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function sign(secret: string, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

/** Returns a signed token `payload.signature`, valid for `ttlDays`. */
export async function signSession(secret: string, ttlDays = 30): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + ttlDays * 86_400_000 })));
  return `${payload}.${await sign(secret, payload)}`;
}

/** True iff the token is well-formed, correctly signed, and unexpired. */
export async function verifySession(secret: string, token?: string): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await sign(secret, payload);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const { exp } = JSON.parse(b64urlDecode(payload));
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}
