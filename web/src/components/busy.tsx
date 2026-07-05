"use client";

import type { ReactNode } from "react";
import { useRegen, type BusyScope } from "./regen-provider";

/** Grise/floute une section pendant qu'une mise à jour la concerne (P5 : « voir sur quoi ça
 *  travaille »). Un VOILE posé au-dessus du contenu (bg-page/50 + backdrop-blur) plutôt qu'un
 *  filter/opacity sur le contenu : un `filter` sur l'ancêtre ferait des modales `fixed` enfants des
 *  boîtes positionnées par rapport à la section (cassé), et le voile bloque naturellement les clics
 *  sur des données périmées. Scopes : voir BusyScope (regen / sync / garmin). */
export function Dim({
  on, children, className = "", rounded = "rounded-2xl", label,
}: {
  on: BusyScope | BusyScope[];
  children: ReactNode;
  className?: string;
  /** Rayon du voile — aligne-le sur la carte enveloppée (rounded-2xl par défaut). */
  rounded?: string;
  /** Petit libellé centré optionnel (ex. « Mise à jour… ») pour les grandes sections. */
  label?: string;
}) {
  const { busy } = useRegen();
  const active = (Array.isArray(on) ? on : [on]).some(busy);
  return (
    <div className={`relative ${className}`.trim()} aria-busy={active}>
      {children}
      {active && (
        <div className={`absolute inset-0 z-20 flex items-center justify-center bg-page/50 backdrop-blur-[1.5px] backdrop-saturate-50 ${rounded}`} aria-hidden>
          {label && (
            <span className="flex items-center gap-2 rounded-full border border-stone-200 bg-white/90 px-3 py-1 text-xs font-medium text-stone-600 dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300">
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-stone-500 dark:border-stone-600 dark:border-t-stone-300" />
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
