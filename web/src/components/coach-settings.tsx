"use client";

import { useEffect, useState, useTransition } from "react";
import { saveCoachSettings } from "@/app/actions";
import { CoachAvatar } from "@/components/coach-avatar";
import {
  COACH_SETTING_FIELDS,
  COACH_SETTINGS_DEFAULTS,
  COACH_INSTRUCTIONS_MAX,
  COACH_PERSONAS,
  personaAvatar,
  personaById,
  personaName,
  type CoachSettings,
  type Persona,
  type Gender,
} from "@/lib/coach-settings";

/** The header avatar IS the trigger: click it to open the persona gallery + settings. */
export function CoachSettingsModal({ initial }: { initial: CoachSettings }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<CoachSettings>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openModal() {
    setError(null);
    setS(initial); // discard unsaved edits from a previous open
    setOpen(true);
  }

  function set<K extends keyof CoachSettings>(key: K, value: CoachSettings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  function selectPersona(p: Persona) {
    setS((prev) => {
      const persona_gender: Gender | null = p.gendered
        ? (prev.persona === p.id && prev.persona_gender ? prev.persona_gender : "m")
        : null;
      const dims = p.id === "expert" ? {} : p.settings; // non-expert dictates the 7 dims
      return { ...prev, ...dims, persona: p.id, persona_gender };
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveCoachSettings(s);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
      }
    });
  }

  const selected = personaById(s.persona);
  const isExpert = s.persona === "expert";
  const triggerSrc = personaAvatar(initial.persona, initial.persona_gender);

  return (
    <>
      {/* Trigger = the avatar with a ⚙ pip */}
      <button
        type="button"
        onClick={openModal}
        aria-label="Personnaliser ton coach"
        title="Personnaliser ton coach"
        className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-alpine-400"
      >
        <CoachAvatar size="sm" src={triggerSrc} />
        <span className="absolute -right-0.5 -bottom-0.5 z-10 grid h-4 w-4 place-items-center rounded-full border border-stone-200 bg-white text-[9px] leading-none shadow-sm transition group-hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800">
          ⚙
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Personnalisation du coach"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-stone-900"
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800">
              <h2 className="text-base font-semibold">Choisis ton coach</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
              {/* ── Galerie de personas (sans emoji dans les libellés) ── */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {COACH_PERSONAS.map((p) => {
                  const active = s.persona === p.id;
                  const tileGender: Gender = active && s.persona_gender ? s.persona_gender : "m";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPersona(p)}
                      aria-pressed={active}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition ${
                        active
                          ? "border-alpine-500 bg-alpine-50 dark:bg-alpine-950/30"
                          : "border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"
                      }`}
                    >
                      <CoachAvatar size="md" src={personaAvatar(p.id, tileGender)} />
                      <span className={`text-xs leading-tight ${active ? "font-semibold text-alpine-700 dark:text-alpine-300" : "text-stone-600 dark:text-stone-300"}`}>
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Nom + présentation (qui + méthode) du coach choisi */}
              <div>
                <div className="text-sm font-semibold">{personaName(s.persona, s.persona_gender)}</div>
                <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">{selected.tagline}</p>
              </div>

              {/* ── Génération du briefing : gratuit (algorithmique) ou IA (voix du coach) ── */}
              <div>
                <div className="mb-1.5 text-sm font-medium">Génération du briefing</div>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { v: "free" as const, label: "Gratuit" },
                    { v: "ai" as const, label: "IA" },
                  ]).map(({ v, label }) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={s.briefing_mode === v}
                      onClick={() => set("briefing_mode", v)}
                      className={`min-h-9 rounded-full px-3 py-1.5 text-sm transition ${
                        s.briefing_mode === v
                          ? "bg-alpine-600 font-medium text-white"
                          : "border border-stone-300 text-stone-600 hover:bg-stone-100 active:bg-stone-200 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                  {s.briefing_mode === "ai"
                    ? "Le plan reste calculé automatiquement ; un petit appel IA réécrit la séance du jour et le résumé dans la voix de ton coach (consomme des tokens)."
                    : "Briefing 100 % automatique, gratuit et instantané. Le chat reste disponible quand tu veux échanger avec ton coach."}
                </p>
              </div>

              {/* ── Genre (personas humanoïdes) ── */}
              {selected.gendered && (
                <div>
                  <div className="mb-1.5 text-sm font-medium">Avatar</div>
                  <div className="flex gap-1.5">
                    {([
                      { g: "m" as Gender, label: "♂ Homme" },
                      { g: "f" as Gender, label: "♀ Femme" },
                    ]).map(({ g, label }) => (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={s.persona_gender === g}
                        onClick={() => set("persona_gender", g)}
                        className={`min-h-9 rounded-full px-3 py-1.5 text-sm transition ${
                          s.persona_gender === g
                            ? "bg-alpine-600 font-medium text-white"
                            : "border border-stone-300 text-stone-600 hover:bg-stone-100 active:bg-stone-200 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Réglages : toujours visibles ; éditables seulement en Expert, sinon grisés ── */}
              <div>
                <div className="mb-2 text-sm font-medium">
                  Réglages
                  {!isExpert && (
                    <span className="ml-1 font-normal text-stone-400">— lecture seule (choisis « Expert » pour les modifier)</span>
                  )}
                </div>
                <div className={`space-y-4 ${isExpert ? "" : "opacity-60"}`}>
                  {COACH_SETTING_FIELDS.map((f) => (
                    <div key={f.key}>
                      <div className="text-sm font-medium">{f.label}</div>
                      {isExpert && <p className="mb-1.5 text-xs text-stone-500 dark:text-stone-400">{f.hint}</p>}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {f.options.map((o) => {
                          const active = (s as any)[f.key] === o.value;
                          return (
                            <button
                              key={o.value}
                              type="button"
                              disabled={!isExpert}
                              aria-pressed={active}
                              onClick={() => set(f.key as keyof CoachSettings, o.value as any)}
                              className={`min-h-9 rounded-full px-3 py-1.5 text-sm transition disabled:cursor-default ${
                                active
                                  ? "bg-alpine-600 font-medium text-white"
                                  : "border border-stone-300 text-stone-600 enabled:hover:bg-stone-100 enabled:active:bg-stone-200 dark:border-stone-700 dark:text-stone-300 dark:enabled:hover:bg-stone-800"
                              }`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Consignes libres (tous profils) ── */}
              <div>
                <label className="text-sm font-medium" htmlFor="coach-custom">
                  Consignes personnalisées <span className="font-normal text-stone-400">(optionnel)</span>
                </label>
                <p className="mb-1.5 text-xs text-stone-500 dark:text-stone-400">
                  Tout ce qu&apos;il doit garder en tête (ex. « pas de blabla le matin », « appelle-moi par mon prénom »).
                </p>
                <textarea
                  id="coach-custom"
                  rows={3}
                  value={s.custom_instructions ?? ""}
                  maxLength={COACH_INSTRUCTIONS_MAX}
                  onChange={(e) => set("custom_instructions", e.target.value)}
                  className="w-full resize-y rounded-xl border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-alpine-400 focus:ring-2 focus:ring-alpine-200 sm:text-sm dark:border-stone-700 dark:bg-stone-900 dark:focus:ring-alpine-900"
                />
                <div className="mt-0.5 text-right text-xs text-stone-400">
                  {(s.custom_instructions ?? "").length}/{COACH_INSTRUCTIONS_MAX}
                </div>
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-stone-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-stone-800">
              <button
                type="button"
                onClick={() => setS(COACH_SETTINGS_DEFAULTS)}
                disabled={isPending}
                className="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50 dark:hover:text-stone-300"
              >
                Réinitialiser
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={isPending}
                  className="rounded-xl bg-alpine-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-alpine-700 active:bg-alpine-800 disabled:opacity-50"
                >
                  {isPending ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
