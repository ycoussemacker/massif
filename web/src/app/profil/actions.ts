"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

// ── helpers ───────────────────────────────────────────────────────────────────

function str(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
function numF(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function intF(v: FormDataEntryValue | null): number | null {
  const n = numF(v);
  return n == null ? null : Math.round(n);
}

function revalidateAll() {
  revalidatePath("/profil");
  revalidatePath("/");
  revalidatePath("/coach");
}

// ── profile ─────────────────────────────────────────────────────────────────

export type SaveState = { ok: boolean; error?: string } | null;

/** Update (or insert) the single athlete_profile row from the profile form.
 *  Identity + personal data + physiological baselines + training preferences (jsonb).
 *  useActionState signature: returns a result state for inline feedback (never throws). */
export async function updateProfile(_prev: SaveState, form: FormData): Promise<SaveState> {
  try {
    const sex = str(form.get("sex"));
    if (sex != null && !["M", "F", "other"].includes(sex)) throw new Error("Sexe invalide");

    const weeklyNotes = str(form.get("weekly_structure_notes"));
    const maxWeeklyHours = numF(form.get("max_weekly_hours"));
    // Weekday picker submits one hidden input per selected day → collect into an ordered array.
    const noHardDays = form.getAll("no_hard_days").map((v) => String(v)).filter(Boolean);
    const constraintsNotes = str(form.get("constraints_notes"));

    // Keep jsonb columns null when fully empty, else a compact structured object.
    const weekly_structure = weeklyNotes ? { notes: weeklyNotes } : null;
    const constraints =
      maxWeeklyHours == null && noHardDays.length === 0 && constraintsNotes == null
        ? null
        : {
            max_weekly_hours: maxWeeklyHours,
            no_hard_days: noHardDays.length ? noHardDays : null,
            notes: constraintsNotes,
          };

    const row: Record<string, unknown> = {
      name: str(form.get("name")),
      birthdate: str(form.get("birthdate")),
      sex,
      height_cm: numF(form.get("height_cm")),
      weight_kg: numF(form.get("weight_kg")),
      max_hr: intF(form.get("max_hr")),
      resting_hr: intF(form.get("resting_hr")),
      lthr: intF(form.get("lthr")),
      hrv_baseline_ms: numF(form.get("hrv_baseline_ms")),
      weekly_structure,
      constraints,
    };

    const sb = await createServiceClient();
    const { data: existing } = await sb.from("athlete_profile").select("id").limit(1).maybeSingle();
    const res = existing
      ? await sb.from("athlete_profile").update(row).eq("id", (existing as any).id)
      : await sb.from("athlete_profile").insert(row); // id is generated-always identity
    if (res.error) throw new Error(res.error.message);

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur inconnue" };
  }
}

// ── goals ─────────────────────────────────────────────────────────────────────

export type GoalInput = {
  title: string;
  sport_id: number | null;
  kind: string | null;
  target_date: string | null;     // ISO date or null
  target_horizon: string | null;
  target_detail: string | null;
  notes?: string | null;
};

const KINDS = ["race", "performance", "volume", "skill", "other"];

function cleanGoal(input: GoalInput): Record<string, unknown> {
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("Le titre de l'objectif est requis");
  if (title.length > 200) throw new Error("Titre trop long (200 caractères max)");
  const kind = input.kind && KINDS.includes(input.kind) ? input.kind : null;
  return {
    title,
    sport_id: input.sport_id ?? null,
    kind,
    target_date: input.target_date || null,
    target_horizon: (input.target_horizon ?? "").trim() || null,
    target_detail: (input.target_detail ?? "").trim() || null,
    notes: (input.notes ?? "")?.toString().trim() || null,
  };
}

/** Create a goal, appended at the end of the active ranking (least important by default). */
export async function createGoal(input: GoalInput): Promise<void> {
  const sb = await createServiceClient();
  const { data: top } = await sb.from("goals").select("priority_rank")
    .eq("status", "active").order("priority_rank", { ascending: false }).limit(1).maybeSingle();
  const nextRank = ((top as any)?.priority_rank ?? 0) + 1;

  const res = await sb.from("goals").insert({ ...cleanGoal(input), priority_rank: nextRank, status: "active" });
  if (res.error) throw new Error(res.error.message);
  revalidateAll();
}

export async function updateGoal(id: string, input: GoalInput): Promise<void> {
  const sb = await createServiceClient();
  const res = await sb.from("goals").update(cleanGoal(input)).eq("id", id);
  if (res.error) throw new Error(res.error.message);
  revalidateAll();
}

export async function deleteGoal(id: string): Promise<void> {
  const sb = await createServiceClient();
  const res = await sb.from("goals").delete().eq("id", id);
  if (res.error) throw new Error(res.error.message);
  revalidateAll();
}

export async function setGoalStatus(id: string, status: "active" | "achieved" | "abandoned"): Promise<void> {
  if (!["active", "achieved", "abandoned"].includes(status)) throw new Error("Statut invalide");
  const sb = await createServiceClient();
  const res = await sb.from("goals").update({ status }).eq("id", id);
  if (res.error) throw new Error(res.error.message);
  revalidateAll();
}

/** Rewrite priority_rank to match the given order (index 0 = most important = rank 1). */
export async function reorderGoals(orderedIds: string[]): Promise<void> {
  const sb = await createServiceClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const res = await sb.from("goals").update({ priority_rank: i + 1 }).eq("id", orderedIds[i]);
    if (res.error) throw new Error(res.error.message);
  }
  revalidateAll();
}
