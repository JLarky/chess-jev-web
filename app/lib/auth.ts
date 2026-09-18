// Password gate for the Jev API, to keep strangers from spending TypeSafe
// credits. The password lives in the JEV_PASSWORD env var (server only).
// A successful login sets an httpOnly cookie holding an HMAC token derived
// from the password, so the password itself never sits client-side.
// When JEV_PASSWORD is unset the gate is disabled entirely (local dev).

import { createHmac, timingSafeEqual } from "crypto";

export const JEV_AUTH_COOKIE = "jev-auth";

function expectedToken(password: string): string {
  return createHmac("sha256", password).update("jev-auth-v1").digest("hex");
}

export function makeAuthToken(password: string): string {
  return expectedToken(password);
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
