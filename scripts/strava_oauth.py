"""One-shot Strava OAuth handshake to obtain a refresh token that can READ ACTIVITIES.

The access/refresh tokens shown on the Strava app settings page only carry scope `read`, which
cannot read /athlete/activities. This runs the authorization flow with scope=activity:read_all,
captures the redirect on http://localhost (the app's registered Authorization Callback Domain),
exchanges the code, and writes STRAVA_REFRESH_TOKEN into the repo-root .env.

Run once (it opens your browser; you click "Authorize" while logged into Strava):
    ingest/.venv/bin/python scripts/strava_oauth.py
"""

from __future__ import annotations

import sys
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests

from massif_ingest.config import Settings

PORT = 8721
REDIRECT_URI = f"http://localhost:{PORT}/exchange_token"  # host must match the callback domain
SCOPE = "activity:read_all"
AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"
ROOT_ENV = Path(__file__).resolve().parent.parent / ".env"

_result: dict = {}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/exchange_token":
            self.send_response(404)
            self.end_headers()
            return
        q = urllib.parse.parse_qs(parsed.query)
        _result["code"] = q.get("code", [None])[0]
        _result["scope"] = q.get("scope", [""])[0]
        _result["error"] = q.get("error", [None])[0]
        body = ("Autorisation refusée — reviens au terminal." if _result["error"]
                else "Strava autorisé ✓ — tu peux fermer cet onglet et revenir au terminal.")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(f"<html><body><h2>{body}</h2></body></html>".encode())

    def log_message(self, *args):  # silence default request logging
        pass


def _write_refresh_token(token: str) -> None:
    lines = ROOT_ENV.read_text().splitlines() if ROOT_ENV.exists() else []
    out, found = [], False
    for line in lines:
        if line.startswith("STRAVA_REFRESH_TOKEN="):
            out.append(f"STRAVA_REFRESH_TOKEN={token}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"STRAVA_REFRESH_TOKEN={token}")
    ROOT_ENV.write_text("\n".join(out) + "\n")


def main() -> int:
    s = Settings.load()
    if not (s.strava_client_id and s.strava_client_secret):
        print("Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET in .env", file=sys.stderr)
        return 1

    auth_url = f"{AUTHORIZE_URL}?" + urllib.parse.urlencode({
        "client_id": s.strava_client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "approval_prompt": "force",
        "scope": SCOPE,
    })
    print("Ouvre cette URL et clique « Authorize » (laisse la case activité cochée) :")
    print(f"  {auth_url}\n")
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    server = HTTPServer(("localhost", PORT), _Handler)
    print(f"En attente du retour sur {REDIRECT_URI} …")
    while "code" not in _result:
        server.handle_request()

    if _result.get("error") or not _result.get("code"):
        print(f"Échec de l'autorisation : {_result.get('error')}", file=sys.stderr)
        return 1

    granted = _result.get("scope", "")
    if "activity:read" not in granted:
        print(f"⚠️ Scope insuffisant accordé : '{granted}'. Réautorise en laissant l'accès "
              f"aux activités coché.", file=sys.stderr)
        return 1

    resp = requests.post(TOKEN_URL, data={
        "client_id": s.strava_client_id,
        "client_secret": s.strava_client_secret,
        "code": _result["code"],
        "grant_type": "authorization_code",
    }, timeout=30)
    resp.raise_for_status()
    tok = resp.json()

    _write_refresh_token(tok["refresh_token"])
    print(f"\n✅ Refresh token écrit dans {ROOT_ENV}")
    print(f"   scope accordé : {granted}")
    print(f"   athlete id    : {tok.get('athlete', {}).get('id')}")
    print("Lance maintenant : ingest/.venv/bin/python -m massif_ingest.sync")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
