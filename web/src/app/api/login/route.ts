import { NextRequest, NextResponse } from "next/server";
import { signSession } from "@/lib/auth";

/** Login form target. Checks the single shared password (APP_PASSWORD), sets the signed session
 * cookie (massif_auth), and redirects back to `from`. Open-redirect-guarded. */
export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const fromRaw = String(form.get("from") ?? "/");
  // only allow same-origin absolute paths (no protocol-relative //host)
  const dest = fromRaw.startsWith("/") && !fromRaw.startsWith("//") ? fromRaw : "/";

  const expected = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;

  // Gate not configured → let them straight in (matches middleware behaviour in local dev).
  if (!expected || !secret) {
    return NextResponse.redirect(new URL(dest, origin), { status: 303 });
  }

  if (password !== expected) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "1");
    url.searchParams.set("from", dest);
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(dest, origin), { status: 303 });
  res.cookies.set("massif_auth", await signSession(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
