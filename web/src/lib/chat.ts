/** Conversation timeline for the /coach page — a READ-TIME merge of three sources, no duplication:
 *   coach_briefings (daily briefings) + activities (logged sessions) + coach_messages (chat turns).
 *  Sorted chronologically (oldest → newest) so the page renders like a chat with newest at the bottom. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/server";
import { todayLocal, dateMinusDays, whenLabelFr } from "./coach-context";
import { pickTopGoal, type GoalHeader } from "./profile-types";
import { loadCoachSettings, type CoachSettings } from "./coach-settings";
import { loadProposalsForMessages, type ProposalCard } from "./coach-proposals";
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
  proposals?: ProposalCard[]; // coach WRITE proposals raised in this turn (Accept/Modifier/Ignorer card)
};
export type TimelineItem = BriefingItem | ActivityGroupItem | MessageItem;

export type Conversation = {
  timeline: TimelineItem[];
  today: string;
  cursor: string | null;  // timestamp of the OLDEST loaded item (message or activity); pass to loadOlderConversation
  hasMore: boolean;        // is there a message/activity OLDER than `cursor`? false ⇒ start of the conversation (butée)
  profile: Profile | null;
  topGoal: GoalHeader | null;
  settings: CoachSettings;
};

// The discussion loads lazily, like a chat, paginated by CONVERSATIONAL ITEMS = chat messages AND
// activities (activities count as messages): at most MESSAGE_BATCH items show at first; scrolling to the
// top (or the button) pulls the next MESSAGE_BATCH older ones, until the very first item — the "butée".
// Briefings are folded in as context over the same span; when there is nothing yet, the last FLOOR_DAYS show.
export const MESSAGE_BATCH = 10;
const FLOOR_DAYS = 2;

/** French day label for a YYYY-MM-DD (UTC-pinned so the calendar date never shifts under a tz). */
function frDateLabel(localDate: string, today: string, yesterday: string): string {
  if (localDate === today) return "Aujourd'hui";
  if (localDate === yesterday) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(localDate + "T00:00:00Z"));
}

/** Build ONE page of the chat timeline, paginated by CONVERSATIONAL ITEMS — chat messages AND activities
 *  counted together (the athlete wants activities treated as messages, so a dense run of recent chat never
 *  hides them). The page is the newest `limit` items strictly before `beforeIso` (null ⇒ the very latest);
 *  briefings in the same [from, beforeIso) span are folded in as context. When there is no chat/activity at
 *  all in range, the span floors to the last FLOOR_DAYS so the page is never empty. Returns the items + the
 *  cursor (the limit-th item's timestamp, or null) to feed the next older page. Shared by getConversation
 *  (latest) and loadOlderConversation (older). NOTE: an activity-day can straddle the cursor; the client
 *  merges activity_group items by day, so a split day re-assembles across pages. */
export async function buildTimeline(
  sb: SupabaseClient, today: string, beforeIso: string | null, limit: number,
): Promise<{ items: TimelineItem[]; cursor: string | null }> {
  const yesterday = dateMinusDays(today, 1);

  // 1) Lower bound of the page = the limit-th most recent item among messages ∪ activities (each counts as
  //    one), so the page holds ~`limit` items and activities page in alongside chat instead of being hidden.
  let mtq = sb.from("coach_messages").select("created_at").order("created_at", { ascending: false }).limit(limit);
  let atq = sb.from("activities").select("started_at").order("started_at", { ascending: false }).limit(limit);
  if (beforeIso) { mtq = mtq.lt("created_at", beforeIso); atq = atq.lt("started_at", beforeIso); }
  const [mt, at] = await Promise.all([mtq, atq]);
  const times = [
    ...(mt.data ?? []).map((r: any) => String(r.created_at)),
    ...(at.data ?? []).map((r: any) => String(r.started_at)),
  ].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest → oldest
  const cursor: string | null = times.length ? times[Math.min(limit, times.length) - 1] : null;

  // 2) Fetch the full page [from, to): messages + activities + briefings. `from` = the cursor; floor to the
  //    last FLOOR_DAYS only when there is no chat/activity at all (so the page is never empty).
  const from = cursor ?? beforeIso ?? dateMinusDays(today, FLOOR_DAYS) + "T00:00:00Z";
  const to = beforeIso; // exclusive upper bound; null on the first page (open → includes today)

  let mq = sb.from("coach_messages")
    .select("id,role,kind,content,model,activity_ids,created_at")
    .gte("created_at", from);
  if (to) mq = mq.lt("created_at", to);

  let bq = sb.from("coach_briefings")
    .select("briefing_date,model,readiness,today_session,why,flag,reasoning,week_skeleton,confidence,created_at")
    .gte("created_at", from);
  if (to) bq = bq.lt("created_at", to);

  let aq = sb.from("activities")
    .select("id,local_date,started_at,sport_id,training_load,aerobic_load,neuromuscular_load," +
            "load_method_used,duration_s,distance_m,vertical_gain_m,vertical_loss_m,avg_hr,perceived_rpe,rpe_source")
    .gte("started_at", from);
  if (to) aq = aq.lt("started_at", to);

  const [cm, bm, am, sm] = await Promise.all([
    mq.order("created_at", { ascending: true }).limit(200),
    bq.order("created_at", { ascending: true }),
    aq.order("started_at", { ascending: true }).limit(1000),
    sb.from("sports").select("id,code,display_name,taxonomy_group,needs_manual_rpe"),
  ]);
  const msgs = cm.data ?? [];

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

  // Coach WRITE proposals raised in this page's coach turns → rendered as a card under each turn.
  const proposalsByMessage = await loadProposalsForMessages(sb, msgs.map((m: any) => m.id));

  for (const m of msgs) {
    const ids: string[] = (m as any).activity_ids ?? [];
    const refActivities = ids.map((id) => actById.get(id)).filter(Boolean) as Activity[];
    const proposals = proposalsByMessage.get((m as any).id);
    items.push({
      kind: "message", at: (m as any).created_at, id: (m as any).id,
      role: (m as any).role, messageKind: (m as any).kind, content: (m as any).content, model: (m as any).model,
      refActivities: refActivities.length ? refActivities : undefined,
      proposals: proposals?.length ? proposals : undefined,
    });
  }
  items.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  return { items, cursor };
}

/** Is there a chat message OR an activity strictly OLDER than `iso`? Drives `hasMore` / the "butée" (start
 *  of the conversation): once false, there is nothing more to page back to. Two cheap indexed head counts. */
export async function hasItemBefore(sb: SupabaseClient, iso: string | null): Promise<boolean> {
  if (!iso) return false;
  const [m, a] = await Promise.all([
    sb.from("coach_messages").select("id", { count: "exact", head: true }).lt("created_at", iso),
    sb.from("activities").select("id", { count: "exact", head: true }).lt("started_at", iso),
  ]);
  return (m.count ?? 0) > 0 || (a.count ?? 0) > 0;
}

export async function getConversation(): Promise<Conversation> {
  const sb = await createServiceClient();
  const today = todayLocal();

  const [page, pm, sm, gm, cs] = await Promise.all([
    buildTimeline(sb, today, null, MESSAGE_BATCH),
    sb.from("athlete_profile").select("*").limit(1).maybeSingle(),
    sb.from("sports").select("id,code"),
    sb.from("goals").select("title,sport_id,target_date,target_horizon,target_detail")
      .eq("status", "active").order("priority_rank", { ascending: true }).limit(1),
    loadCoachSettings(sb),
  ]);

  const sportCodeById = new Map<number, string>((sm.data ?? []).map((s: any) => [s.id, s.code]));

  return {
    timeline: page.items, today, cursor: page.cursor,
    hasMore: await hasItemBefore(sb, page.cursor),
    profile: (pm.data as Profile) ?? null,
    topGoal: pickTopGoal(gm.data, sportCodeById),
    settings: cs,
  };
}
