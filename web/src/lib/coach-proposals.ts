/** Coach WRITE proposals — types + persistence + read helpers, shared by the chat tools
 *  (web/src/lib/coach-chat.ts), the accept/dismiss server actions (web/src/app/actions.ts) and the
 *  timeline (web/src/lib/chat.ts). The LLM NEVER writes: a `propose_*` tool inserts a PENDING row here;
 *  the athlete validates it from a card (web/src/components/coach-proposal-card.tsx) and only the accept
 *  action commits — through the EXISTING write paths (createPlannedEvent / setRpe / a pinned upsert). */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProposalKind = "session" | "event" | "delete" | "activity_edit" | "reshape";
export type ProposalStatus = "pending" | "accepted" | "dismissed" | "superseded";

/** A coach PRESCRIPTION to create or REPLACE on a day (the heat→climbing swap). Committed as a pinned row
 *  (modified_by='user', is_pinned, status='planned') so the briefing regen plans around it, never over it. */
export type SessionPayload = {
  planned_date: string;
  sport_code: string | null;
  title: string;
  description?: string | null;
  system_tag?: string | null;
  intensity_zone?: string | null;
  target_duration_s?: number | null;
  target_distance_m?: number | null;
  target_vertical_m?: number | null;
  expected_altitude_m?: number | null;
  target_aerobic_load?: number | null;
  target_neuromuscular_load?: number | null;
  is_key?: boolean;
  replaces_session_id?: string | null; // id of the session this overwrites (today's run → climbing)
  forecast_note?: string | null;        // short FR impact line (from simulate_plan), shown on the card
  rationale: string;
};

/** An athlete-declared EVENT (commits via the existing createPlannedEvent path), optionally reshaping the
 *  week around it (regen_week → the background week regen, the same flow manual event-add already uses). */
export type EventPayload = {
  planned_date: string;
  sport_code: string | null;
  title: string;
  description?: string | null;
  target_distance_m?: number | null;
  target_vertical_m?: number | null;
  target_duration_s?: number | null;
  expected_altitude_m?: number | null;
  is_key?: boolean;
  regen_week?: boolean;
  forecast_note?: string | null;
  rationale: string;
};

export type DeletePayload = { session_id: string; rationale: string };
export type ActivityEditPayload = {
  activity_id: string;
  perceived_rpe?: number | null; // recomputes the session load via setRpe
  sport_code?: string | null;     // re-label the sport
  rationale: string;
};
export type ReshapePayload = { rationale: string };

export type ProposalPayload =
  | SessionPayload | EventPayload | DeletePayload | ActivityEditPayload | ReshapePayload;

/** The structured change stored in coach_proposals.operations (one op per proposal in v1). */
export type ProposalOperations = {
  payload: ProposalPayload;
  target_planned_id?: string | null;    // session-replace / delete target
  target_activity_id?: string | null;   // activity_edit target
  expected_fingerprint?: string | null; // target row snapshot at propose time (staleness guard)
  regen_week?: boolean;                  // event/reshape → trigger the background week regen on accept
};

/** UI-facing shape attached to a chat message (rendered by coach-proposal-card.tsx). */
export type ProposalCard = {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  summary: string | null;
  payload: ProposalPayload;
  regenWeek: boolean;
  forecastNote: string | null;
};

/** Stable fingerprint of a target row's mutable state — changes if a regen ran, the day got logged/linked,
 *  or the athlete edited it. Lets an accept on a STALE proposal be rejected instead of double-writing. */
export function fingerprintOf(
  row: { updated_at?: string | null; status?: string | null; linked_activity_id?: string | null } | null,
): string | null {
  if (!row) return null;
  return `${row.updated_at ?? ""}|${row.status ?? ""}|${row.linked_activity_id ?? ""}`;
}

/** A short FR summary for the card header (the prose around it lives in the coach's message). */
export function summarizeProposal(kind: ProposalKind, payload: ProposalPayload): string {
  switch (kind) {
    case "session": {
      const p = payload as SessionPayload;
      const verb = p.replaces_session_id ? "Remplacer la séance du" : "Ajouter une séance le";
      return `${verb} ${p.planned_date}${p.title ? ` : ${p.title}` : ""}`;
    }
    case "event": {
      const p = payload as EventPayload;
      return `Programmer « ${p.title} » le ${p.planned_date}${p.regen_week ? " et réorganiser la semaine" : ""}`;
    }
    case "delete":
      return "Retirer cette séance du plan";
    case "activity_edit": {
      const p = payload as ActivityEditPayload;
      if (p.perceived_rpe != null) return `Corriger le RPE de l'activité (${p.perceived_rpe})`;
      if (p.sport_code) return `Re-catégoriser l'activité (${p.sport_code})`;
      return "Corriger une activité enregistrée";
    }
    case "reshape":
      return "Réorganiser le plan de la semaine";
    default:
      return "Proposition du coach";
  }
}

/** Insert a PENDING proposal; returns its id + summary. `coach_message_id` is stamped later by
 *  sendCoachMessage (the coach reply row doesn't exist until the reply is generated). */
export async function insertProposal(
  sb: SupabaseClient,
  input: { kind: ProposalKind; operations: ProposalOperations; summary: string; simulation?: unknown | null },
): Promise<{ id: string; summary: string }> {
  const ins = await sb.from("coach_proposals").insert({
    kind: input.kind,
    status: "pending",
    operations: input.operations,
    summary: input.summary,
    simulation: input.simulation ?? null,
  }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  return { id: (ins.data as { id: string }).id, summary: input.summary };
}

/** Attach a set of proposals to the coach message that raised them (once that row exists). */
export async function stampProposalMessage(
  sb: SupabaseClient, proposalIds: string[], messageId: string,
): Promise<void> {
  if (!proposalIds.length) return;
  await sb.from("coach_proposals").update({ coach_message_id: messageId }).in("id", proposalIds);
}

/** Best-effort: supersede any still-pending proposals that target the same planned row (a newer one wins),
 *  so the timeline doesn't show two live cards for one day. Call BEFORE inserting the new proposal. */
export async function supersedePendingForTarget(sb: SupabaseClient, targetPlannedId: string): Promise<void> {
  try {
    await sb.from("coach_proposals").update({ status: "superseded" })
      .eq("status", "pending").eq("operations->>target_planned_id", targetPlannedId);
  } catch { /* non-critical */ }
}

/** Proposals for a page of coach messages, grouped by coach_message_id — feeds the chat timeline. */
export async function loadProposalsForMessages(
  sb: SupabaseClient, messageIds: string[],
): Promise<Map<string, ProposalCard[]>> {
  const out = new Map<string, ProposalCard[]>();
  if (!messageIds.length) return out;
  const { data } = await sb.from("coach_proposals")
    .select("id,coach_message_id,kind,status,summary,operations")
    .in("coach_message_id", messageIds)
    .order("created_at", { ascending: true });
  for (const p of (data ?? []) as any[]) {
    const ops = (p.operations ?? {}) as ProposalOperations;
    const arr = out.get(p.coach_message_id) ?? [];
    arr.push({
      id: p.id, kind: p.kind, status: p.status, summary: p.summary ?? null,
      payload: ops.payload, regenWeek: !!ops.regen_week,
      forecastNote: (ops.payload as any)?.forecast_note ?? null,
    });
    out.set(p.coach_message_id, arr);
  }
  return out;
}
