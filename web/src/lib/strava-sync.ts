/** On-demand Strava pull in TypeScript — a faithful (recent-window) mirror of
 *  `ingest/massif_ingest/strava.py` `sync()`. Lets the web app refresh the athlete's latest Strava
 *  activities the instant they ask (pull-to-refresh / button), without waiting for the nightly Python
 *  cron. It refreshes the OAuth token, pulls the last N days of activities, derives D- from the
 *  altitude stream, computes the two load channels via `computeLoad` (mirror of load.py), and upserts.
 *
 *  Garmin is NOT handled here (no API, Python-only); recovery stays on the nightly cron. Python remains
 *  the source of truth: the next cron re-pulls + recomputes identically (incl. auto-creating sports for
 *  unseen sport_types, which this fast path maps to 'unknown' until then). KEEP IN SYNC with strava.py. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeLoad, resolveProfile, ALT_HYPOXIA_THRESHOLD_M,
  type LoadProfile, type LoadParams, type ThresholdRow,
} from "./load";

const API = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";

const STREAM_KEYS: Record<string, string> = {
  heartrate: "hr",
  velocity_smooth: "velocity",
  altitude: "altitude",
  watts: "power",
  cadence: "cadence",
  distance: "distance",
  grade_smooth: "grade",
  time: "time",
};

type Sport = {
  id: number;
  code: string;
  taxonomy_group: string;
  load_method_ladder: string[] | null;
  uses_distance: boolean;
  uses_hr: boolean;
  needs_manual_rpe: boolean;
  source_aliases: string[] | null;
};

export type StravaSyncResult = { pulled: number; newest: string | null };

async function getAccessToken(sb: SupabaseClient): Promise<string> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("STRAVA_CLIENT_ID/SECRET manquants côté serveur.");

  const { data: tokenRow } = await sb
    .from("integration_tokens")
    .select("refresh_token,scope,athlete_id")
    .eq("provider", "strava")
    .maybeSingle();
  const refreshToken = tokenRow?.refresh_token || process.env.STRAVA_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("Aucun refresh token Strava — connecte Strava dans Profil.");

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) throw new Error(`Échec du refresh token Strava (${resp.status}).`);
  const tok = await resp.json();

  // Persist the (possibly rotated) token so the next run + the UI panel stay current (mirror strava.py).
  await sb.from("integration_tokens").upsert(
    {
      provider: "strava",
      access_token: tok.access_token ?? null,
      refresh_token: tok.refresh_token ?? refreshToken,
      expires_at: tok.expires_at ? new Date(tok.expires_at * 1000).toISOString() : null,
      scope: tokenRow?.scope ?? null,
      athlete_id: tokenRow?.athlete_id ?? null,
    },
    { onConflict: "provider" },
  );
  return tok.access_token as string;
}

async function get(token: string, path: string, params: Record<string, string>): Promise<Response> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function fetchActivities(token: string, afterEpoch: number): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const resp = await get(token, "/athlete/activities", {
      after: String(afterEpoch),
      per_page: "100",
      page: String(page),
    });
    if (resp.status === 429) throw new Error("Strava rate-limit atteint — réessaie dans quelques minutes.");
    if (!resp.ok) throw new Error(`Strava /athlete/activities ${resp.status}`);
    const batch = (await resp.json()) as any[];
    if (!batch.length) break;
    out.push(...batch);
  }
  return out;
}

async function fetchStreams(token: string, activityId: number): Promise<Record<string, number[]>> {
  const resp = await get(token, `/activities/${activityId}/streams`, {
    keys: Object.keys(STREAM_KEYS).join(","),
    key_by_type: "true",
  });
  if (resp.status === 404) return {};
  if (!resp.ok) return {};
  const raw = (await resp.json()) as Record<string, { data: number[] }>;
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(raw)) if (STREAM_KEYS[k] && v?.data) out[STREAM_KEYS[k]] = v.data;
  return out;
}

async function fetchDescription(token: string, activityId: number): Promise<string | null> {
  const resp = await get(token, `/activities/${activityId}`, { include_all_efforts: "false" });
  if (!resp.ok) return null;
  const detail = await resp.json();
  return detail?.description ?? null;
}

/** Mirror of strava.vertical_loss_from_altitude — D- with hysteresis to reject GPS/baro jitter. */
function verticalLossFromAltitude(altitude: number[], deadbandM = 2.0): number {
  let loss = 0;
  let peak: number | null = null;
  for (const alt of altitude) {
    if (typeof alt !== "number") continue;
    if (peak === null || alt > peak) peak = alt;
    else if (peak - alt >= deadbandM) {
      loss += peak - alt;
      peak = alt;
    }
  }
  return Math.round(loss * 10) / 10;
}

/** Mirror of strava.altitude_stats — (max_m, avg_m, time_high_s) for the heat/altitude context + the
 *  avg the tss/rtss altitude correction reads. time_high ≈ (fraction of samples above ~1500 m) × duration. */
function altitudeStats(
  altitude: number[],
  durationS: number | null,
): { maxM: number | null; avgM: number | null; timeHighS: number | null } {
  const vals = altitude.filter((a) => typeof a === "number");
  if (!vals.length) return { maxM: null, avgM: null, timeHighS: null };
  const maxM = Math.round(Math.max(...vals) * 10) / 10;
  const avgM = Math.round((vals.reduce((t, a) => t + a, 0) / vals.length) * 10) / 10;
  const highFrac = vals.filter((a) => a >= ALT_HYPOXIA_THRESHOLD_M).length / vals.length;
  const timeHighS = durationS ? Math.round(highFrac * durationS) : null;
  return { maxM, avgM, timeHighS };
}

/** Mirror of strava._climbing_sport_code. */
function climbingSportCode(sportType: string, name: string | null, description: string | null): string {
  const text = `${name ?? ""} ${description ?? ""}`.toLowerCase();
  // 'grande voie' (multi-pitch) first — it contains 'voie' but is its own sport (mirror strava.py).
  if (["grande voie", "grandes voies", "multipitch", "multi-pitch", "multi pitch"].some((k) => text.includes(k)))
    return "grande_voie";
  if (text.includes("bloc") || text.includes("boulder")) return "bouldering";
  if (["falaise", "crag", "extérieur", "exterieur", "outdoor", "dehors", "rocher"].some((k) => text.includes(k)))
    return "rock_climbing";
  if (["voie", "salle", "indoor", "gym", "mur"].some((k) => text.includes(k))) return "indoor_climbing";
  return sportType === "Bouldering" ? "bouldering" : "indoor_climbing";
}

function localDate(startedAt: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(startedAt));
}

/** Pull the last `afterDays` of Strava activities and upsert them with computed load. Returns a count
 *  + the newest local_date seen. Defaults to a short window — this is the "I just finished, show it
 *  now" path; deep history backfill stays a Python job. */
export async function syncStrava(sb: SupabaseClient, afterDays = 21): Promise<StravaSyncResult> {
  const token = await getAccessToken(sb);
  const afterEpoch = Math.floor(Date.now() / 1000) - afterDays * 86400;
  const summaries = await fetchActivities(token, afterEpoch);
  if (!summaries.length) return { pulled: 0, newest: null };

  const [{ data: sportsRows }, { data: profileRow }, { data: rpeRows }, { data: paramRows }, { data: thresholdRows }] = await Promise.all([
    sb.from("sports").select("id,code,taxonomy_group,load_method_ladder,uses_distance,uses_hr,needs_manual_rpe,source_aliases"),
    sb.from("athlete_profile").select("max_hr,resting_hr,lthr,ftp_watts,threshold_pace_s_per_km,weight_kg,timezone").limit(1).maybeSingle(),
    sb.from("activities").select("source_activity_id,perceived_rpe").eq("source", "strava").eq("rpe_source", "user"),
    sb.from("athlete_load_params").select("param,value"),
    sb.from("athlete_thresholds").select("*").order("effective_date", { ascending: true }),
  ]);
  // Personalized load coefficients (empty → population defaults; mirror of db.load_load_params).
  const loadParams: LoadParams = Object.fromEntries(
    ((paramRows ?? []) as { param: string; value: number }[]).filter((r) => r.value != null).map((r) => [r.param, Number(r.value)]),
  );
  // Effective-dated thresholds (empty / table-absent → base profile; mirror of db.load_threshold_history).
  const thresholdHistory = (thresholdRows ?? []) as ThresholdRow[];

  const sportMap = new Map<string, Sport>();
  for (const s of (sportsRows ?? []) as Sport[]) {
    sportMap.set(s.code, s);
    for (const alias of s.source_aliases ?? []) sportMap.set(alias, s);
  }
  const unknown = sportMap.get("unknown");
  const profile = (profileRow ?? {}) as LoadProfile & { timezone?: string };
  const tz = profileRow?.timezone || "Europe/Paris";
  const userRpe = new Map<string, number>();
  for (const r of (rpeRows ?? []) as any[]) if (r.source_activity_id && r.perceived_rpe != null) userRpe.set(r.source_activity_id, r.perceived_rpe);

  let pulled = 0;
  let newest: string | null = null;
  for (const act of summaries) {
    const sportType = act.sport_type || act.type || "Workout";
    let sport = sportMap.get(sportType) || unknown;
    if (!sport) continue; // no 'unknown' seed → skip (shouldn't happen)

    // Climbing: read the description to split bloc / voie salle / falaise (mirror strava.py).
    if (sport.taxonomy_group === "technical_strength") {
      const description = await fetchDescription(token, act.id);
      sport = sportMap.get(climbingSportCode(sportType, act.name, description)) || sport;
    }

    // D- from the altitude stream (Strava summaries lack descent), for HR/distance sports. The same
    // stream also yields heat/altitude context + the avg the tss/rtss altitude correction reads.
    let descentM: number | null = null;
    let hasStreams = false;
    let altStats: { maxM: number | null; avgM: number | null; timeHighS: number | null } | null = null;
    if (sport.uses_distance || sport.uses_hr) {
      const streams = await fetchStreams(token, act.id);
      hasStreams = Object.keys(streams).length > 0;
      if (streams.altitude) {
        descentM = verticalLossFromAltitude(streams.altitude);
        altStats = altitudeStats(streams.altitude, Math.round(act.elapsed_time || 0) || null);
      }
    }

    const movingS = act.moving_time ?? null;
    const distanceM = act.distance ?? null;
    const avgPace = distanceM && movingS && distanceM > 0 ? Math.round((movingS / (distanceM / 1000)) * 100) / 100 : null;
    const rpe = userRpe.get(String(act.id)) ?? null;

    const row: Record<string, unknown> = {
      source: "strava",
      source_activity_id: String(act.id),
      sport_id: sport.id,
      started_at: act.start_date,
      local_date: localDate(act.start_date, tz),
      duration_s: Math.round(act.elapsed_time || 0),
      moving_s: movingS != null ? Math.round(movingS) : null,
      distance_m: distanceM,
      vertical_gain_m: act.total_elevation_gain ?? null,
      avg_hr: act.average_heartrate ? Math.round(act.average_heartrate) : null,
      max_hr: act.max_heartrate ? Math.round(act.max_heartrate) : null,
      avg_power_w: act.average_watts ?? null,
      np_power_w: act.weighted_average_watts ?? null,
      avg_pace_s_per_km: avgPace,
      calories: act.calories ?? null,
      perceived_rpe: rpe,
      rpe_source: rpe ? "user" : sport.needs_manual_rpe ? "pending" : "estimated",
      sport_specific: { strava_name: act.name, strava_sport_type: sportType },
      raw_payload: act,
      has_streams: hasStreams,
    };
    if (descentM != null) row.vertical_loss_m = descentM;
    // Heat context (set only when present, so a temp-less device / re-sync never blanks a stored value);
    // altitude stats — avg_altitude_m must be on the row before computeLoad (the tss/rtss correction reads it).
    if (act.average_temp != null) row.avg_temp_c = act.average_temp;
    if (altStats) {
      if (altStats.maxM != null) row.max_altitude_m = altStats.maxM;
      if (altStats.avgM != null) row.avg_altitude_m = altStats.avgM;
      if (altStats.timeHighS != null) row.time_high_altitude_s = altStats.timeHighS;
    }

    // Resolve thresholds as-of this activity's date (rec 2); empty history → base profile unchanged.
    const effProfile = resolveProfile(profile, thresholdHistory, row.local_date as string);
    const r = computeLoad(row, sport, effProfile, loadParams);
    row.aerobic_load = r.aerobic_load;
    row.neuromuscular_load = r.neuromuscular_load;
    row.load_method_used = r.load_method_used;
    row.intensity_factor = r.intensity_factor;
    row.effective_days = r.effective_days;
    row.needs_review = r.needs_review;

    const { error } = await sb.from("activities").upsert(row, { onConflict: "source,source_activity_id" });
    if (error) throw new Error(`upsert activity failed: ${error.message}`);
    pulled++;
    const ld = row.local_date as string;
    if (!newest || ld > newest) newest = ld;
  }
  return { pulled, newest };
}
