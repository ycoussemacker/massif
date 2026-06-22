import Image from "next/image";
import { READINESS, type Readiness } from "@/lib/labels";

// The coach's face. `src` is the selected persona's portrait (web/public/coach/…) resolved via
// personaAvatar() in coach-settings; when null, a tasteful mountain placeholder is shown instead.
// Keeps the readiness ring + status dot identical across every persona and size.

type Size = "hero" | "md" | "sm" | "xs";

// Readiness-tinted ring (the coach visibly "wears" today's verdict). Neutral stone when unknown.
const RING: Record<Readiness, string> = {
  green: "ring-emerald-400",
  amber: "ring-amber-400",
  red: "ring-red-400",
};

const SIZE: Record<Size, { box: string; glyph: string; img: string; dot: boolean; dotCls: string }> = {
  hero: { box: "h-14 w-14 sm:h-20 sm:w-20", glyph: "text-2xl sm:text-3xl", img: "80px", dot: true, dotCls: "h-3.5 w-3.5" },
  md: { box: "h-12 w-12", glyph: "text-lg", img: "48px", dot: false, dotCls: "" },
  sm: { box: "h-9 w-9", glyph: "text-base", img: "36px", dot: true, dotCls: "h-2.5 w-2.5" },
  xs: { box: "h-7 w-7", glyph: "text-sm", img: "28px", dot: false, dotCls: "" },
};

/** Presentational, server-safe (no "use client"): placeholder needs no JS. */
export function CoachAvatar({
  size = "hero", readiness = null, src = null,
}: {
  size?: Size;
  readiness?: Readiness | null;
  src?: string | null;
}) {
  const s = SIZE[size];
  const ring = readiness ? RING[readiness] : "ring-stone-300 dark:ring-stone-700";
  const dotColor = readiness ? READINESS[readiness].dot : "bg-stone-400";
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center rounded-full bg-white ring-2 ring-offset-2 ring-offset-white transition dark:bg-stone-900 dark:ring-offset-stone-900 ${ring} ${s.box}`}
    >
      <span className="relative h-full w-full overflow-hidden rounded-full">
        {src ? (
          <Image src={src} alt="Coach" fill sizes={s.img} className="rounded-full object-cover" />
        ) : (
          <span
            aria-hidden
            className={`grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-stone-200 to-stone-300 dark:from-stone-700 dark:to-stone-800 ${s.glyph}`}
          >
            🏔️
          </span>
        )}
      </span>
      {s.dot && (
        <span
          aria-hidden
          className={`absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-white dark:ring-stone-900 ${s.dotCls} ${dotColor}`}
        />
      )}
    </span>
  );
}
