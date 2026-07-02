"use client";

import { VIZ } from "@/lib/theme";
import { HelpButton, type HelpContent } from "./help";

// Thresholds MIRROR the readiness engine (`R` in web/src/lib/briefing-algo.ts):
//   tsb_neuro_amber = -4  → "jambes chargées"  (lingering structural/tendon debt)
//   tsb_neuro_red   = -15 → "jambes très chargées"
// Keep in sync if the engine retunes these.
const NEURO_AMBER = -4;
const NEURO_RED = -15;

const HELP: HelpContent = {
  title: "Fraîcheur des jambes (canal neuromusculaire)",
  blocks: [
    {
      type: "p",
      text:
        "Cardio frais (Alpine) mais jambes encore chargées (Summit) — les structures (descente, " +
        "force) récupèrent plus lentement et c'est invisible à la montre. On évite la grosse " +
        "descente aujourd'hui.",
    },
    {
      type: "dl",
      items: [
        { k: "Jambes OK", v: "fraîcheur neuro ≥ −4 — rien ne freine côté structures." },
        { k: "Jambes chargées", v: "fraîcheur neuro entre −15 et −4 — dette structurelle qui traîne." },
        { k: "Jambes très chargées", v: "fraîcheur neuro < −15 — protège les jambes, même si le cardio va bien." },
      ],
    },
  ],
};

/** A compact chip that makes the NEUROMUSCULAR freshness legible next to the readiness verdict — the
 *  whole point of the 2-channel model ("cardio frais MAIS jambes encore chargées"). Keyed on
 *  `tsb_neuromuscular`. The CHANNEL identity is Summit/neuro (the leading dot, `VIZ.neuro`); the STATE
 *  (chargé / très chargé) wears the readiness ramp (caution / rest). Renders nothing when fresh — by
 *  default we stay quiet; pass `showWhenOk` for a discreet "jambes OK". */
export function LegsChip({ tsbNeuro, showWhenOk = false }: { tsbNeuro: number | null; showWhenOk?: boolean }) {
  if (tsbNeuro == null) return null;

  const loaded = tsbNeuro < NEURO_AMBER;
  if (!loaded && !showWhenOk) return null;

  // STATE colour comes from the readiness ramp (Tailwind emerald/amber/red tints) — never the channel hue.
  const tone = !loaded
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
    : tsbNeuro < NEURO_RED
      ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";

  const label = !loaded ? "Jambes OK" : tsbNeuro < NEURO_RED ? "Jambes très chargées" : "Jambes chargées";

  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {/* Channel identity = Summit/neuro dot (the neuromuscular pole), independent of the state tint. */}
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: VIZ.neuro }} />
      <span className="tabular-nums">{label}</span>
      <HelpButton content={HELP} />
    </span>
  );
}
