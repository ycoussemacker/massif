"use client";

import { useEffect, useRef } from "react";

/** Horizontal-scroll container that starts scrolled to the far RIGHT (most recent data) on mount,
 *  while content keeps normal chronological order (oldest left → newest right). */
export function ScrollRight({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
