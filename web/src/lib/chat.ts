/** Conversation timeline for the /coach page — a READ-TIME merge of three sources, no duplication:
 *   coach_briefings (daily briefings) + activities (logged sessions) + coach_messages (chat turns).
 *  Sorted chronologically (oldest → newest) so the page renders like a chat with newest at the bottom. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/server";
import { todayLocal, dateMinusDays, whenLabelFr } from "./coach-context";
import { pickTopGoal, type GoalHeader } from "./profile-types";
import { loadCoachSettings, type CoachSettings } from "./coach-settings";
import type { Activity, Briefing, Profile } from "./data";

// ── TEST PHASE ────────────────────────────────────────────────────────────────
// true  → the "Commente" button shows under EVERY day's activity bubble (easy to test on old data).
// false → only today + yesterday (prevents needless coach token spend). Flip once the feature is validated.
const COMMENT_ON_ALL_DAYS = true;

export type BriefingItem = {
  kind: "briefing";
  at: string;
  briefing: Briefing & { created_at: string };
};
/** One bubble per calendar day, holding that day's N sessions + the "Commente" action. */
export type ActivityGroupItem = {
  kind: "activity_group";
  at: string;          // latest started_at of the day → places the bubble after that day's morning briefing
  localDate: string;   // YYYY-MM-DD (the key the comment action uses)
  dateLabel: string;   // "Aujourd'hui" / "Hier" / "lun. 22 juin"
  whenLabel: string;   // "d'aujourd'hui" / "d'hier" / "du 21 juin" — for the optimistic chat bubble
  activities: Activity[];
  commentable: boolean; // whether the "Commente" button is offered for this day
};
export type MessageItem = {
  kind: "message";
  at: string;
  id: string;
  role: "user" | "coach";
  messageKind: "chat" | "activity_comment";
  content: string;
  model: string | null;
  refActivities?: Activity[]; // for activity_comment: the activities this message is about (faded reference)
};
export type TimelineItem = BriefingItem | ActivityGroupItem | MessageItem;

export type Conversation = {
  timeline: TimelineItem[];
  today: string;
  windowStart: string;   // oldest local date loaded by default (J−INITIAL_DAYS); older loads on scroll
  hasMore: boolean;       // is there any briefing/activity/message OLDER than windowStart?
  profile: Profile | null;
  topGoal: GoalHeader | null;
  settings: CoachSettings;
};

// The discussion loads lazily, like a chat: by default only the last few days; scrolling to the top
// pulls older days in fixed-size batches (empty windows are skipped so a batch always carries content).
const INITIAL_DAYS = 2;  // default window = today, J−1, J−2 (≥ today−2); J−3 and older load on demand
export const BATCH_DAYS = 3; // each "load older" pulls the next non-empty 3-day window further back

/** French day label for a YYYY-MM-DD (UTC-pinned so the calendar date never shifts under a tz). */
function frDateLabel(localDate: string, today: string, yesterday: string): string {
  if (localDate === today) return "Aujourd'hui";
  if (localDate === yesterday) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(localDate + "T00:00:00Z"));
}

/** Build the chat timeline (briefings + per-day activity groups + chat messages) for a LOCAL-date
 *  window [from, to]; `to == null` means "no upper bound" (the recent window, includes today).
 *  Messages are windowed by `created_at` against UTC-midnight of the same dates, so the recent window
 *  and the older batches partition the message stream exactly (no gap, no overlap at the boundary).
 *  Reused by getConversation (recent) and the loadOlderConversation action (older 3-day batches). */
export async function buildTimeline(
  sb: SupabaseClient, today: string, from: string, to: string | null,
): Promise<TimelineItem[]> {
  const yesterday = dateMinusDays(today, 1);

  let bq = sb.from("coach_briefings")
    .select("briefing_date,model,readiness,today_session,why,flag,reasoning,week_skeleton,confidence,created_at")
    .gte("briefing_date", from);
  if (to) bq = bq.lte("briefing_date", to);

  let aq = sb.from("activities")
    .select("id,local_date,started_at,sport_id,training_load,aerobic_load,neuromuscular_load," +
            "load_method_used,duration_s,distance_m,vertical_gain_m,vertical_loss_m,avg_hr,perceived_rpe,rpe_source")
    .gte("local_date", from);
  if (to) aq = aq.lte("local_date", to);

  let cq = sb.from("coach_messages")
    .select("id,role,kind,content,model,activity_ids,created_at")
    .gte("created_at", from + "T00:00:00Z");
  if (to) cq = cq.lt("created_at", dateMinusDays(to, -1) + "T00:00:00Z"); // < (to + 1 day) at UTC midnight

  const [bm, am, cm, sm] = await Promise.all([
    bq.order("created_at", { ascending: true }),
    aq.order("started_at", { ascending: true }).limit(1000),
    cq.order("created_at", { ascending: true }),
    sb.from("sports").select("id,code,display_name,taxonomy_group,needs_manual_rpe"),
  ]);

  const sportById = new Map<number, any>((sm.data ?? []).map((s: any) => [s.id, s]));
  const activities: Activity[] = (am.data ?? []).map((a: any) => {
    const s = sportById.get(a.sport_id);
    return {
      ...a,
      sport: s?.display_name ?? s?.code ?? "—",
      sport_code: s?.code ?? null,
      taxonomy_group: s?.taxonomy_group ?? null,
      needs_manual_rpe: !!s?.needs_manual_rpe,
    };
  });

  const actById = new Map<string, Activity>(activities.map((a) => [a.id, a]));
  const items: TimelineItem[] = [];
  for (const b of bm.data ?? []) items.push({ kind: "briefing", at: (b as any).created_at, briefing: b as any });

  // Group activities by calendar day → one bubble per day, carrying the "Commente" action.
  const byDay = new Map<string, Activity[]>();
  for (const a of activities) {
    const arr = byDay.get(a.local_date) ?? [];
    arr.push(a);
    byDay.set(a.local_date, arr);
  }
  for (const [localDate, acts] of byDay) {
    acts.sort((p, q) => (p.started_at < q.started_at ? -1 : p.started_at > q.started_at ? 1 : 0));
    items.push({
      kind: "activity_group",
      at: acts[acts.length - 1].started_at,
      localDate,
      dateLabel: frDateLabel(localDate, today, yesterday),
      whenLabel: whenLabelFr(localDate, today),
      activities: acts,
      commentable: COMMENT_ON_ALL_DAYS || localDate === today || localDate === yesterday,
    });
  }

  for (const m of cm.data ?? []) {
    const ids: string[] = (m as any).activity_ids ?? [];
    const refActivities = ids.map((id) => actById.get(id)).filter(Boolean) as Activity[];
    items.push({
      kind: "message", at: (m as any).created_at, id: (m as any).id,
      role: (m as any).role, messageKind: (m as any).kind, content: (m as any).content, model: (m as any).model,
      refActivities: refActivities.length ? refActivities : undefined,
    });
  }
  items.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  return items;
}

/** Earliest LOCAL date that has ANY conversation content (briefing / activity / message), or null when
 *  the store is empty. Drives `hasMore` (is anything older than the loaded window?) and the older-batch
 *  loop's stop condition. Three cheap indexed limit-1 reads. */
export async function oldestContentDate(sb: SupabaseClient): Promise<string | null> {
  const [m, b, a] = await Promise.all([
    sb.from("coach_messages").select("created_at").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    sb.from("coach_briefings").select("briefing_date").order("briefing_date", { ascending: true }).limit(1).maybeSingle(),
    sb.from("activities").select("local_date").order("started_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  const dates = [
    (m.data as any)?.created_at ? String((m.data as any).created_at).slice(0, 10) : null,
    (b.data as any)?.briefing_date ?? null,
    (a.data as any)?.local_date ?? null,
  ].filter((d): d is string => !!d);
  return dates.length ? dates.reduce((min, d) => (d < min ? d : min)) : null;
}

export async function getConversation(): Promise<Conversation> {
  const sb = await createServiceClient();
  const today = todayLocal();
  const windowStart = dateMinusDays(today, INITIAL_DAYS);

  const [timeline, pm, sm, gm, cs, oldest] = await Promise.all([
    buildTimeline(sb, today, windowStart, null),
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("sports").select("id,code"),
    sb.from("goals").select("title,sport_id,target_date,target_horizon,target_detail")
      .eq("status", "active").order("priority_rank", { ascending: true }).limit(1),
    loadCoachSettings(sb),
    oldestContentDate(sb),
  ]);

  const sportCodeById = new Map<number, string>((sm.data ?? []).map((s: any) => [s.id, s.code]));

  return {
    timeline, today, windowStart,
    hasMore: oldest != null && oldest < windowStart,
    profile: (pm.data as Profile) ?? null,
    topGoal: pickTopGoal(gm.data, sportCodeById),
    settings: cs,
  };
}
