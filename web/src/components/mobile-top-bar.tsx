"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/** Mobile home top bar (wordmark + coach shortcut) with a scroll-aware "headroom" behaviour — NOT a
 *  permanently-pinned bar (that reads dated). It rides the page in normal flow at the top; scrolling DOWN
 *  slides it up out of the way; the smallest scroll UP brings it back as a SEMI-TRANSPARENT frosted
 *  overlay, so the coach chat is always one tap away without stealing the screen. At the very top it sits
 *  flush and transparent (seamless over the page). A flow spacer reserves its height so nothing jumps
 *  (the page wrapper already pads the safe-area inset; the fixed bar re-adds it so it covers the notch). */
export function MobileTopBar() {
  const [revealed, setRevealed] = useState(true);
  const [atTop, setAtTop] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const top = y <= 4;
        const dy = y - lastY.current;
        setAtTop(top);
        if (top) setRevealed(true);
        else if (dy < -4) setRevealed(true);   // un petit scroll vers le haut → réapparaît
        else if (dy > 4) setRevealed(false);    // scroll vers le bas → s'efface
        lastY.current = y;
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div
        data-mobile-topbar
        // Slide via `top` (NOT a CSS transform): a transform on the ancestor of an SVG that paints with
        // `stroke="url(#…)"` makes Chromium drop the gradient (the coach icon would render blank).
        style={{ top: revealed ? 0 : "calc(-3.5rem - env(safe-area-inset-top))" }}
        className={`fixed inset-x-0 z-40 pt-[env(safe-area-inset-top)] transition-[top,background-color] duration-300 ease-out md:hidden ${
          atTop
            ? "bg-transparent"
            : "border-b border-stone-200/60 bg-white/70 backdrop-blur-md dark:border-stone-800/60 dark:bg-stone-900/70"
        } ${revealed ? "" : "pointer-events-none"}`}
      >
        <div className="flex h-12 items-center justify-between px-4">
          <Link
            href="/"
            aria-label="Massif — accueil"
            className="shrink-0 text-lg font-bold tracking-tight text-stone-900 transition-opacity hover:opacity-70 dark:text-stone-100"
          >
            massif<span className="text-summit-500">.</span>
          </Link>
          <Link
            href="/coach"
            aria-label="Discuter avec le coach"
            className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
          >
            {/* Trait en dégradé bleu→orange, sans fond (discret) */}
            <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden>
              <defs>
                <linearGradient id="coachStroke" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="var(--color-alpine-500)" />
                  <stop offset="1" stopColor="var(--color-summit-500)" />
                </linearGradient>
              </defs>
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" stroke="url(#coachStroke)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
      {/* Réserve la hauteur de la barre dans le flux (le wrapper de page gère déjà l'inset safe-area). */}
      <div className="h-14 md:hidden" aria-hidden />
    </>
  );
}
