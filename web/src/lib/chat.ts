/** Conversation timeline for the /coach page — a READ-TIME merge of three sources, no duplication:
 *   coach_briefings (daily briefings) + activities (logged sessions) + coach_messages (chat turns).
 *  Sorted chronologically (oldest → newest) so the page renders like a chat with newest at the bottom. */
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
  profile: Profile | null;
  topGoal: GoalHeader | null;
  settings: CoachSettings;
};

const ACTIVITY_LIMIT = 60; // newest N activities folded into the conversation

/** French day label for a YYYY-MM-DD (UTC-pinned so the calendar date never shifts under a tz). */
function frDateLabel(localDate: string, today: string, yesterday: string): string {
  if (localDate === today) return "Aujourd'hui";
  if (localDate === yesterday) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(localDate + "T00:00:00Z"));
}

export async function getConversation(): Promise<Conversation> {
  const sb = await createServiceClient();
  const today = todayLocal();

  const [bm, am, cm, pm, sm, gm, cs] = await Promise.all([
    sb.from("coach_briefings")
      .select("briefing_date,model,readiness,today_session,why,flag,reasoning,week_skeleton,confidence,created_at")
      .order("created_at", { ascending: true }),
    sb.from("activities")
      .select("id,local_date,started_at,sport_id,training_load,aerobic_load,neuromuscular_load," +
              "load_method_used,duration_s,distance_m,vertical_gain_m,vertical_loss_m,avg_hr,perceived_rpe,rpe_source")
      .order("started_at", { ascending: false }).limit(ACTIVITY_LIMIT),
    sb.from("coach_messages")
      .select("id,role,kind,content,model,activity_ids,created_at").order("created_at", { ascending: true }),
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("sports").select("id,code,display_name,taxonomy_group,needs_manual_rpe"),
    sb.from("goals").select("title,sport_id,target_date,target_horizon,target_detail")
      .eq("status", "active").order("priority_rank", { ascending: true }).limit(1),
    loadCoachSettings(sb),
  ]);

  const sportById = new Map<number, any>((sm.data ?? []).map((s: any) => [s.id, s]));
  const sportCodeById = new Map<number, string>((sm.data ?? []).map((s: any) => [s.id, s.code]));
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
  const yesterday = dateMinusDays(today, 1);
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

  return {
    timeline: items, today,
    profile: (pm.data as Profile) ?? null,
    topGoal: pickTopGoal(gm.data, sportCodeById),
    settings: cs,
  };
}
