/** Filtered/searchable activities access — server-side via the service-role client (RLS off).
 *  Mirrors the getDashboard query patterns. Name search runs on the Strava title stored in
 *  sport_specific->>strava_name (zero backend); a later sub-phase extends it to descriptions. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/server";
import { ACTIVITY_COLS, enrichActivities, type Activity } from "./data";

export type ActivityOrder = "date_desc" | "date_asc" | "load_desc";

export type ActivityFilter = {
  from?: string;        // local_date >= (YYYY-MM-DD)
  to?: string;          // local_date <= (YYYY-MM-DD)
  sportIds?: number[];
  taxonomy?: string[];  // sports.taxonomy_group values
  minLoad?: number;     // training_load >=
  maxLoad?: number;     // training_load <=
  q?: string;           // keyword on the Strava name
  rpePending?: boolean; // needs_manual_rpe sport && perceived_rpe is null
  order?: ActivityOrder;
  limit?: number;
  offset?: number;
};

export type ActivityPage = { rows: Activity[]; total: number };

export type SportOption = {
  id: number; code: string; display_name: string; taxonomy_group: string | null; needs_manual_rpe: boolean;
};

let _sportsCache: SportOption[] | null = null;

/** All sports (id/code/name/taxonomy/rpe-flag), memoised for the process — seed data, ~22 rows. */
export async function getSports(client?: SupabaseClient): Promise<SportOption[]> {
  // Le cache est court-circuité quand un client est injecté : un test (ou une éval sur fixture) doit
  // voir SES sports, pas ceux qu'une lecture live aurait mis en cache dans le même process.
  if (_sportsCache && !client) return _sportsCache;
  const sb = client ?? await createServiceClient();
  const { data } = await sb.from("sports")
    .select("id,code,display_name,taxonomy_group,needs_manual_rpe")
    .order("display_name", { ascending: true });
  const sports = (data ?? []) as SportOption[];
  if (!client) _sportsCache = sports;
  return sports;
}

/** Sanitise a keyword for a PostgREST `.or()` ilike value: drop chars that break the or-filter
 *  grammar or act as wildcards (parentheses, comma, *, %, backslash). Spaces/accents are fine. */
function sanitizeOr(s: string): string {
  return s.replace(/[,()*%\\]/g, " ").trim();
}

/** `client` : client Supabase injecté. Sans lui la fonction s'en fabrique un — pratique dans une page,
 *  mais opaque : un appelant qui a déjà un client (un outil de l'agent, un test, une éval sur fixture)
 *  doit pouvoir imposer le sien, sinon ce chemin échappe à toute instrumentation. */
export async function listActivities(f: ActivityFilter, client?: SupabaseClient): Promise<ActivityPage> {
  const sb = client ?? await createServiceClient();
  const sports = await getSports(client);
  const sportById = new Map<number, SportOption>(sports.map((s) => [s.id, s]));

  // Resolve sport-derived filters (taxonomy, rpePending) into a concrete sport_id allow-list so the
  // exact-count pagination stays correct (these live on `sports`, not on `activities`).
  const preds: ((s: SportOption) => boolean)[] = [];
  if (f.sportIds?.length) preds.push((s) => f.sportIds!.includes(s.id));
  if (f.taxonomy?.length) preds.push((s) => f.taxonomy!.includes(s.taxonomy_group ?? "other"));
  if (f.rpePending) preds.push((s) => s.needs_manual_rpe);
  const allowed: number[] | null = preds.length
    ? sports.filter((s) => preds.every((p) => p(s))).map((s) => s.id)
    : null;

  if (allowed && allowed.length === 0) return { rows: [], total: 0 };

  const limit = Math.min(Math.max(f.limit ?? 50, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);

  let qb = sb.from("activities").select(ACTIVITY_COLS, { count: "exact" });
  if (f.from) qb = qb.gte("local_date", f.from);
  if (f.to) qb = qb.lte("local_date", f.to);
  if (allowed) qb = qb.in("sport_id", allowed);
  if (f.minLoad != null) qb = qb.gte("training_load", f.minLoad);
  if (f.maxLoad != null) qb = qb.lte("training_load", f.maxLoad);
  if (f.rpePending) qb = qb.is("perceived_rpe", null);
  // Keyword search over the Strava title AND the description (both in JSONB — no schema migration).
  // Names cover every activity; descriptions cover whatever the ingest has fetched (climbing today,
  // all activities once strava.sync fetches activity detail for every recent activity + a re-sync).
  const q = f.q && sanitizeOr(f.q.slice(0, 100));
  if (q) qb = qb.or(`sport_specific->>strava_name.ilike.*${q}*,raw_payload->>description.ilike.*${q}*`);

  if (f.order === "date_asc") qb = qb.order("started_at", { ascending: true });
  else if (f.order === "load_desc") qb = qb.order("training_load", { ascending: false, nullsFirst: false });
  else qb = qb.order("started_at", { ascending: false });

  qb = qb.range(offset, offset + limit - 1);

  const { data, count } = await qb;
  return { rows: enrichActivities(data ?? [], sportById as Map<number, any>), total: count ?? 0 };
}
