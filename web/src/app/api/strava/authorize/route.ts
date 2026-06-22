import { NextRequest, NextResponse } from "next/server";

/** Kick off the Strava OAuth flow: redirect to Strava's consent screen with scope activity:read_all.
 *  The callback domain registered in the Strava app must be `localhost` (port/path are ignored there).
 *  A short-lived state cookie guards against CSRF on the callback. */
export async function GET(req: NextRequest) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "STRAVA_CLIENT_ID manquant dans web/.env.local" },
      { status: 500 },
    );
  }

  const origin = req.nextUrl.origin;
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: `${origin}/api/strava/callback`,
    approval_prompt: "auto",
    scope: "activity:read_all", // required to read /athlete/activities
    state,
  });

  const res = NextResponse.redirect(`https://www.strava.com/oauth/authorize?${params}`);
  res.cookies.set("strava_oauth_state", state, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}
