"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QuickAddEvent } from "@/components/quick-add-event";
import { deletePlannedEvent } from "@/app/actions";
import { useRegen } from "@/components/regen-provider";
import { sportIcon, sportName } from "@/lib/labels";
import { STATE } from "@/lib/theme";
import { weatherIcon, weatherLabel, weatherTempBadge } from "@/lib/weather";
import { fmt, longDateFr } from "@/lib/format";
import { daysBetween } from "@/lib/coach-context";
import type { CalDay } from "@/lib/calendar";
import type { SportOption } from "@/lib/activities";

/** The interactive month/week grid. Day cells encode state by TEXTURE/SHAPE, never sport colour (design
 *  system): realised = solid stone glyph chip; planned = dashed-outline glyph chip; goal = 🏆 + glyph;
 *  the only colour is the readiness dot (TSB traffic-light) and the Alpine "today" ring. Tap a day → a
 *  detail sheet: PAST days show what was realised (read-only); today/future show planned activities + an
 *  "ajouter" action (you can't plan in the past). */
export function CalendarGrid({
  view,
  rangeStart,
  rangeEnd,
  anchorMonth,
  today,
  days,
  sports,
}: {
  view: "month" | "week";
  rangeStart: string;
  rangeEnd: string;
  anchorMonth: number | null; // month (1-12) to treat as in-month for dimming; null in week view
  today: string;
  days: CalDay[];
  sports: SportOption[];
}) {
  const router = useRouter();
  const regen = useRegen();
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, startDelete] = useTransition();
  // After deleting an event in the next 7 days, offer to regenerate the week plan (background).
  const [askRegen, setAskRegen] = useState(false);

  const byDate = new Map<string, CalDay>(days.map((d) => [d.date, d]));

  // Contiguous dates [rangeStart, rangeEnd].
  const cells: string[] = [];
  for (let d = new Date(rangeStart + "T00:00:00Z"), last = new Date(rangeEnd + "T00:00:00Z");
    d.getTime() <= last.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    cells.push(d.toISOString().slice(0, 10));
  }

  const readinessColor = (c: CalDay): string | null => {
    if (c.tsb == null || c.ctl == null || c.ctl <= 0) return null;
    return c.tsb >= 0.1 * c.ctl ? STATE.ready : c.tsb >= -0.3 * c.ctl ? STATE.caution : STATE.rest;
  };

  const DOW = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

  const openDay = openDate ? byDate.get(openDate) : null;
  const isPast = openDate ? openDate < today : false;

  function close() { setOpenDate(null); setAdding(false); setAskRegen(false); }
  function openCell(date: string) { setOpenDate(date); setAdding(false); setAskRegen(false); }
  function removeEvent(id: string) {
    const within7 = !!openDate && (() => { const o = daysBetween(today, openDate); return o >= 0 && o <= 7; })();
    startDelete(async () => {
      try {
        await deletePlannedEvent(id);
        router.refresh();
        if (within7) setAskRegen(true); // propose replanning the week
      } catch { /* surfaced by the page */ }
    });
  }

  return (
    <>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {DOW.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-stone-400">{d}</div>
        ))}
        {cells.map((date) => {
          const c = byDate.get(date);
          const inMonth = anchorMonth == null || Number(date.slice(5, 7)) === anchorMonth;
          const isToday = date === today;
          const dot = c ? readinessColor(c) : null;
          const dayNum = Number(date.slice(8, 10));
          // Sober forecast glyph — today/future only (never a past cell), and only when we have a row.
          const wx = c?.weather && date >= today ? c.weather : null;
          // Temperature badge (🥵/🥶) shown ALONGSIDE the sky-condition icon — a stormy heatwave reads as ⛈️🥵.
          const wtemp = wx ? weatherTempBadge({ tempMaxC: wx.tempMaxC, tempMinC: wx.tempMinC, feelsMaxC: wx.feelsMaxC }) : null;
          return (
            <button
              key={date}
              type="button"
              onClick={() => openCell(date)}
              className={`group flex flex-col rounded-lg border p-1.5 text-left transition-colors ${
                view === "week" ? "min-h-28" : "min-h-20 sm:min-h-24"
              } ${
                isToday ? "border-alpine-400 ring-1 ring-alpine-400" : "border-stone-200 dark:border-stone-800"
              } ${inMonth ? "bg-white hover:bg-stone-50 dark:bg-stone-900 dark:hover:bg-stone-800/60" : "bg-stone-50/50 dark:bg-stone-900/40"}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-xs tabular-nums ${inMonth ? "text-stone-600 dark:text-stone-300" : "text-stone-300 dark:text-stone-600"}`}>
                  {dayNum}
                </span>
                <span className="flex items-center gap-1">
                  {wx && (
                    <span aria-hidden className="text-sm leading-none"
                      title={`${weatherLabel(wx.weatherCode)}${wtemp ? ` · ${wtemp.label}` : ""}${wx.feelsMaxC != null ? ` · ressenti ${Math.round(wx.feelsMaxC)} °C` : ""}`}>
                      {weatherIcon(wx.weatherCode, { precipMm: wx.precipMm, windKmh: wx.windKmh, tempMaxC: wx.tempMaxC })}{wtemp?.emoji ?? ""}
                    </span>
                  )}
                  {c?.goals.length ? <span aria-hidden title="Objectif">🏆</span> : null}
                  {dot && <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} title="Disponibilité (TSB)" />}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {c?.done.map((a, i) => (
                  <span key={`d${i}`} title="Réalisé"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-stone-100 text-sm dark:bg-stone-800">
                    {sportIcon(a.sportCode)}
                  </span>
                ))}
                {c?.planned.map((p) => (
                  <span key={p.id} title={`Prévu : ${p.title}${p.isEvent ? " (événement)" : ""}`}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-stone-300 text-sm opacity-70 dark:border-stone-600 ${
                      p.isKey ? "ring-1 ring-stone-300 dark:ring-stone-600" : ""
                    }`}>
                    {sportIcon(p.sportCode)}
                  </span>
                ))}
                {c?.goals.map((g, i) => g.sportCode ? (
                  <span key={`g${i}`} title={`Objectif : ${g.title}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-stone-300 text-sm dark:border-stone-600">
                    {sportIcon(g.sportCode)}
                  </span>
                ) : null)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Légende */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-400">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3.5 w-3.5 rounded bg-stone-100 dark:bg-stone-800" /> réalisé</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3.5 w-3.5 rounded border border-dashed border-stone-300 dark:border-stone-600" /> prévu</span>
        <span className="inline-flex items-center gap-1">🏆 objectif</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATE.ready }} /> disponibilité</span>
      </div>

      {/* Détail du jour — passé : consultation du réalisé ; aujourd'hui/futur : prévu + ajout. */}
      {openDate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={close}>
          <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-800 dark:bg-stone-900"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold capitalize text-stone-900 dark:text-stone-50">{longDateFr(openDate)}</h3>
                {!isPast && openDay?.weather && openDate >= today && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                    <span aria-hidden>{weatherIcon(openDay.weather.weatherCode, { precipMm: openDay.weather.precipMm, windKmh: openDay.weather.windKmh, tempMaxC: openDay.weather.tempMaxC })}</span>
                    <span>{weatherLabel(openDay.weather.weatherCode)}</span>
                    {(() => { const t = weatherTempBadge({ tempMaxC: openDay.weather.tempMaxC, tempMinC: openDay.weather.tempMinC, feelsMaxC: openDay.weather.feelsMaxC }); return t ? <span aria-hidden title={t.label}>{t.emoji}</span> : null; })()}
                    {openDay.weather.tempMaxC != null && (
                      <span className="tabular-nums">{Math.round(openDay.weather.tempMaxC)} °C{openDay.weather.feelsMaxC != null ? ` (ressenti ${Math.round(openDay.weather.feelsMaxC)})` : ""}</span>
                    )}
                  </p>
                )}
              </div>
              <button type="button" onClick={close}
                className="text-stone-400 transition hover:text-stone-600 dark:hover:text-stone-300" aria-label="Fermer">✕</button>
            </div>

            {/* Après suppression d'un événement à ≤ 7 j : proposer de régénérer le plan (arrière-plan). */}
            {askRegen && (
              <div className="mb-3 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
                <p className="text-sm text-stone-700 dark:text-stone-200">
                  Activité supprimée — elle était dans les 7 jours. Régénérer le plan de la semaine&nbsp;?{" "}
                  <span className="text-stone-400">(en arrière-plan, tu peux continuer)</span>
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => { regen.regenerate(); setAskRegen(false); }}
                    className="rounded-lg bg-alpine-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-alpine-700">
                    Régénérer le plan
                  </button>
                  <button type="button" onClick={() => setAskRegen(false)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-500 transition hover:text-stone-700 dark:hover:text-stone-300">
                    Plus tard
                  </button>
                </div>
              </div>
            )}

            {adding ? (
              <QuickAddEvent sports={sports} defaultDate={openDate} variant="modal"
                onSaved={() => { setAdding(false); router.refresh(); }} />
            ) : (
              <div className="space-y-4">
                {/* Objectif / Course — événement spécial (charge estimée + cible de forme sur la page séance) */}
                {openDay && openDay.goals.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Objectif</div>
                    <ul className="space-y-1">
                      {openDay.goals.map((g) => (
                        <li key={g.id}>
                          <Link href={`/seance/${g.id}`}
                            className="group flex items-center justify-between gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm transition-colors hover:bg-stone-50 dark:border-stone-600 dark:hover:bg-stone-800/40">
                            <span className="flex min-w-0 items-center gap-2 text-stone-700 dark:text-stone-200">
                              <span aria-hidden>🏆</span>
                              {g.sportCode && <span aria-hidden>{sportIcon(g.sportCode)}</span>}
                              <span className="truncate font-medium">{g.title}</span>
                            </span>
                            <span className="shrink-0 text-stone-300 transition-colors group-hover:text-alpine-600 dark:text-stone-600" aria-hidden>→</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Réalisé (passé + aujourd'hui) — chaque ligne ouvre la page séance */}
                {openDay && openDay.done.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Réalisé</div>
                    <ul className="space-y-1">
                      {openDay.done.map((a) => (
                        <li key={a.id}>
                          <Link href={`/seance/${a.id}`}
                            className="group flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-sm transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/40">
                            <span className="flex items-center gap-2 text-stone-700 dark:text-stone-200">
                              <span aria-hidden>{sportIcon(a.sportCode)}</span>
                              {sportName(a.sportCode, a.sportCode ?? "—")}
                            </span>
                            <span className="tabular-nums text-stone-500">{fmt(a.load, 0)} pts</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Prévu (aujourd'hui + futur uniquement) — chaque ligne ouvre la page séance */}
                {!isPast && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Prévu</div>
                    {openDay && openDay.planned.length > 0 ? (
                      <ul className="space-y-1">
                        {openDay.planned.map((p) => (
                          <li key={p.id} className="flex items-center gap-2">
                            <Link href={`/seance/${p.id}`}
                              className="group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm transition-colors hover:bg-stone-50 dark:border-stone-600 dark:hover:bg-stone-800/40">
                              <span className="flex min-w-0 items-center gap-2 text-stone-700 dark:text-stone-200">
                                <span aria-hidden>{sportIcon(p.sportCode)}</span>
                                <span className="truncate">{p.title}</span>
                                {p.modifiedBy === "coach" && <span className="shrink-0 text-[10px] uppercase tracking-wide text-stone-400">coach</span>}
                              </span>
                              <span className="shrink-0 text-stone-300 transition-colors group-hover:text-alpine-600 dark:text-stone-600" aria-hidden>→</span>
                            </Link>
                            {p.modifiedBy === "user" && (
                              <button type="button" onClick={() => removeEvent(p.id)} disabled={deleting}
                                className="shrink-0 text-xs text-stone-400 transition hover:text-red-600 disabled:opacity-50" aria-label="Supprimer">
                                ✕
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-stone-500 dark:text-stone-400">Rien de prévu ce jour-là.</p>
                    )}
                    <button type="button" onClick={() => setAdding(true)}
                      className="mt-2 rounded-lg bg-alpine-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-alpine-700">
                      + Ajouter une activité prévue
                    </button>
                  </div>
                )}

                {/* Jour passé sans activité ni objectif */}
                {isPast && (!openDay || (openDay.done.length === 0 && openDay.goals.length === 0)) && (
                  <p className="text-sm text-stone-500 dark:text-stone-400">Aucune activité ce jour-là.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
