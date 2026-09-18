import { NextResponse } from "next/server";
import { JEV_AUTH_COOKIE, makeAuthToken, verifyPassword } from "../../lib/auth";

// POST { password } -> sets the auth cookie when the password matches
// JEV_PASSWORD (raw or SHA-256 hex digest). Fail closed: when JEV_PASSWORD
// is unset, login is rejected too.
export async function POST(req: Request) {
  const password = process.env.JEV_PASSWORD;
  if (!password)
    return NextResponse.json(
      { ok: false, error: "Jev is not configured (JEV_PASSWORD is not set)" },
      { status: 503 }
    );
  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to the 401 below
  }
  if (!verifyPassword(body.password, password)) {
    return NextResponse.json(
      { ok: false, error: "wrong password" },
      { status: 401 }
    );
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(JEV_AUTH_COOKIE, makeAuthToken(password), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
