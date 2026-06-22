import { sportIcon } from "@/lib/labels";
import { daysTo, type GoalHeader } from "@/lib/profile-types";

/** Top-priority goal, shown in page headers. Deadline = J−N if dated, else the fuzzy horizon text. */
export function GoalBadge({ goal }: { goal: GoalHeader | null }) {
  if (!goal) return null;
  const d = daysTo(goal.target_date);
  const deadline = d != null ? (d >= 0 ? `J−${d}` : "échéance passée") : goal.target_horizon;
  return (
    <p className="text-sm text-stone-600 dark:text-stone-400">
      🎯 {goal.sport_code && <span aria-hidden>{sportIcon(goal.sport_code)} </span>}
      {goal.title}
      {goal.target_detail && ` · ${goal.target_detail}`}
      {deadline && <span className="font-medium text-stone-900 dark:text-stone-200"> · {deadline}</span>}
    </p>
  );
}
