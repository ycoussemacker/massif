import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

/** Single-password gate (Next 16 "proxy" convention — formerly middleware). Unauthenticated requests
 * are redirected to /login. When APP_PASSWORD or AUTH_SECRET is unset (local dev), the gate is OFF so
 * nobody is locked out. The matcher lets the PWA assets (manifest, icons, service worker) and the
 * login flow through unauthenticated. */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|login|api/login).*)",
  ],
};

export async function proxy(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !process.env.APP_PASSWORD) return NextResponse.next(); // gate not configured

  const token = req.cookies.get("massif_auth")?.value;
  if (await verifySession(secret, token)) return NextResponse.next();

  const from = req.nextUrl.pathname + req.nextUrl.search;
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?from=${encodeURIComponent(from)}`;
  return NextResponse.redirect(url);
}
