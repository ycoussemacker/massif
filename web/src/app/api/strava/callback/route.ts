import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/** Strava OAuth callback: validate state, exchange the code for tokens, and persist them to
 *  integration_tokens (provider='strava'). The ingest job reads the refresh_token from there
 *  (falling back to STRAVA_REFRESH_TOKEN in .env). Always redirects back to /profil. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const profil = (status: string) => NextResponse.redirect(`${url.origin}/profil?strava=${status}`);

  if (url.searchParams.get("error")) return profil("denied");

  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope") ?? "";
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("strava_oauth_state")?.value;

  if (!code || !state || state !== cookieState) return profil("error");
  if (!scope.includes("activity:read")) return profil("scope");

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return profil("error");

  let tok: any;
  try {
    const resp = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!resp.ok) return profil("error");
    tok = await resp.json();
  } catch {
    return profil("error");
  }

  const sb = await createServiceClient();
  const { error } = await sb.from("integration_tokens").upsert(
    {
      provider: "strava",
      access_token: tok.access_token ?? null,
      refresh_token: tok.refresh_token ?? null,
      expires_at: tok.expires_at ? new Date(tok.expires_at * 1000).toISOString() : null,
      scope,
      athlete_id: tok.athlete?.id != null ? String(tok.athlete.id) : null,
    },
    { onConflict: "provider" },
  );

  const res = profil(error ? "error" : "ok");
  res.cookies.delete("strava_oauth_state");
  return res;
}
