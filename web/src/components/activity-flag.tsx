"use client";

/** Clickable, mobile-friendly replacement for the old hover-only ⚠ tooltip. Shows a prominent badge to
 *  the right of the activity type whenever the load is flagged (needs_review) OR a sport reclassification
 *  is suggested by keyword. Tapping opens a sheet that EXPLAINS the flag, offers a one-tap reclassification
 *  to the detected sport (and a full picker), and a shortcut to log an RPE — closing the loop on a
 *  mis-categorised outing (e.g. an alpinism / grande-voie day logged as a hike). Its own client island,
 *  mirroring the RpeControl pattern; reuses RpeControl for the RPE shortcut. */
import { useEffect, useState, useTransition } from "react";
import { reassignActivitySport, listSportsForReassign } from "@/app/actions";
import { RpeControl } from "./rpe";
import { ActivityEditButton } from "./activity-edit-modal";
import { sportIcon, TAXONOMY_FR, TAXONOMY_ORDER } from "@/lib/labels";
import { dur } from "@/lib/format";
import { REVIEW_STOP_RATIO, REVIEW_MIN_ELAPSED_S } from "@/lib/load";
import type { Activity } from "@/lib/data";

type SportOpt = { code: string; display_name: string; taxonomy_group: string | null };

/** `alwaysOffer` (séance detail page): render a reclassify trigger even when nothing is flagged/suggested,
 *  so the athlete can always fix a wrong category. In a list it stays null unless flagged or suggested. */
export function ActivityFlag({ a, alwaysOffer = false }: { a: Activity; alwaysOffer?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [picker, setPicker] = useState(false);
  const [sports, setSports] = useState<SportOpt[] | null>(null);

  const sugg = a.suggestedSport ?? null;
  const flagged = !!a.needs_review;
  const hasHint = flagged || !!sugg;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!hasHint && !alwaysOffer) return null;

  // Was this flagged for being mostly stopped? (the alpinism / grande-voie case). Mirror load.needs_review's
  // stop-ratio branch so the explanation can be specific; otherwise the flag is an HR/intensity glitch.
  const durS = a.duration_s ?? 0;
  const movS = a.moving_s ?? null;
  const mostlyStopped =
    movS != null && durS >= REVIEW_MIN_ELAPSED_S && movS / durS < REVIEW_STOP_RATIO;
  const stoppedS = movS != null && durS > 0 ? Math.max(durS - movS, 0) : null;

  const reassign = (code: string) =>
    start(async () => {
      await reassignActivitySport(a.id, code);
      setOpen(false);
      setPicker(false);
    });

  const openPicker = () => {
    setPicker(true);
    if (!sports) listSportsForReassign().then(setSports);
  };

  const badgeBase =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums transition-colors";
  const badgeStyle = flagged
    ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-400"
    : "border border-alpine-300 bg-alpine-50 text-alpine-700 hover:bg-alpine-100 dark:border-alpine-700/50 dark:bg-alpine-900/20 dark:text-alpine-400";

  const neutralStyle =
    "rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-500 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:text-stone-400 dark:hover:bg-stone-800/40";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        aria-label={
          flagged ? "Charge à vérifier — voir pourquoi" : sugg ? `Reclassement suggéré : ${sugg.label}` : "Reclasser le sport"
        }
        className={hasHint ? `${badgeBase} ${badgeStyle}` : neutralStyle}
      >
        {hasHint ? <>{flagged ? "⚠" : sportIcon(sugg!.code)} {sugg ? `${sugg.label} ?` : "à vérifier"}</> : "Reclasser le sport ▾"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px] sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-page p-4 dark:border-stone-800 sm:max-w-md sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold">
                {flagged ? "⚠ Charge à vérifier" : "Reclasser cette séance ?"}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600">
                ✕
              </button>
            </div>

            <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
              {flagged && mostlyStopped && stoppedS != null ? (
                <>
                  Environ <span className="font-medium tabular-nums">{dur(stoppedS)}</span> à l&apos;arrêt sur{" "}
                  <span className="tabular-nums">{dur(durS)}</span> (relais, approche, pauses ?). Notée sur le temps
                  écoulé, sa charge aérobie est probablement sur-estimée.
                </>
              ) : flagged ? (
                <>La charge repose sur une donnée douteuse (capteur FC ou intensité). Affine-la avec un RPE.</>
              ) : sugg ? (
                <>D&apos;après son titre, cette sortie ressemble plutôt à&nbsp;: {sugg.label}. Son type actuel sur-estime peut-être la charge.</>
              ) : (
                <>Si la catégorie n&apos;est pas la bonne, choisis le sport adéquat — la charge sera recalculée.</>
              )}
            </p>

            {sugg && (
              <button
                type="button"
                onClick={() => reassign(sugg.code)}
                disabled={pending}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-alpine-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 disabled:opacity-50"
              >
                {pending ? "…" : <>Valider&nbsp;: {sportIcon(sugg.code)} {sugg.label}</>}
              </button>
            )}

            {!picker ? (
              <button
                type="button"
                onClick={openPicker}
                disabled={pending}
                className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800/40"
              >
                {sugg ? "Choisir un autre sport ▾" : "Choisir le sport ▾"}
              </button>
            ) : (
              <label className="mt-2 block">
                <span className="sr-only">Choisir un sport</span>
                <select
                  defaultValue=""
                  disabled={pending || !sports}
                  onChange={(e) => e.target.value && reassign(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-page px-3 py-2 text-sm dark:border-stone-700"
                >
                  <option value="" disabled>
                    {sports ? "Sélectionner un sport…" : "Chargement…"}
                  </option>
                  {sports &&
                    TAXONOMY_ORDER.map((g) => {
                      const items = sports.filter((s) => (s.taxonomy_group ?? "other") === g);
                      if (!items.length) return null;
                      return (
                        <optgroup key={g} label={TAXONOMY_FR[g] ?? g}>
                          {items.map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.display_name}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                </select>
              </label>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3 dark:border-stone-800">
              <span className="text-xs text-stone-500">Effort perçu :</span>
              <RpeControl activityId={a.id} value={a.perceived_rpe} />
            </div>

            {/* Corriger les DONNÉES (D− aberrant, FC fantôme, durée…) — ferme ce panneau et ouvre la
                modale d'édition ; la correction survit aux re-syncs (user_overrides). */}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-stone-500">Données erronées&nbsp;?</span>
              <ActivityEditButton a={a} onOpen={() => setOpen(false)} label="Corriger (D−, FC, durée…) ▾" />
            </div>

            <a
              href={`/seance/${a.id}`}
              className="mt-3 block text-center text-xs text-alpine-700 hover:underline dark:text-alpine-400"
            >
              Ouvrir la séance →
            </a>
          </div>
        </div>
      )}
    </>
  );
}
