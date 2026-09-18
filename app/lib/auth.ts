// Password gate for the Jev API, to keep strangers from spending TypeSafe
// credits. The password lives in the JEV_PASSWORD env var (server only),
// either as the raw password or as its SHA-256 hex digest (auto-detected:
// 64 hex chars). The digest form keeps the plaintext password out of the
// env var entirely; compute it with: echo -n "pw" | sha256sum
// A successful login sets an httpOnly cookie holding an HMAC token derived
// from the stored env value, so the password itself never sits client-side.
// When JEV_PASSWORD is unset the gate is disabled entirely (local dev).

import { createHash, createHmac, timingSafeEqual } from "crypto";

export const JEV_AUTH_COOKIE = "jev-auth";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function isDigest(stored: string): boolean {
  return /^[0-9a-f]{64}$/i.test(stored);
}

/** Compare a login attempt against the stored env value (raw or digest). */
export function verifyPassword(
  input: string | undefined,
  stored: string | undefined
): boolean {
  if (!stored || !input) return false;
  const candidate = isDigest(stored) ? sha256Hex(input) : input;
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

function expectedToken(stored: string): string {
  return createHmac("sha256", stored).update("jev-auth-v1").digest("hex");
}

export function makeAuthToken(stored: string): string {
  return expectedToken(stored);
}

/** True when the request carries a valid auth cookie, or the gate is off. */
export function isAuthed(
  cookieHeader: string | null,
  password: string | undefined
): boolean {
  if (!password) return true;
  const m = (cookieHeader ?? "").match(/(?:^|;\s*)jev-auth=([^;]+)/);
  const token = m?.[1];
  if (!token) return false;
  const expected = Buffer.from(expectedToken(password));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
