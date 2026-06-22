import type { MetadataRoute } from "next";

/** PWA manifest — makes Massif installable on the iPhone home screen (standalone window).
 * Colours are literal hex (a manifest can't read CSS custom properties); keep in sync with the
 * --color-page / --color-ink tokens in globals.css. Icons come from app/icon.tsx (generated). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Massif",
    short_name: "Massif",
    description: "Charge d'entraînement multi-sport + coach",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f5f1", // --color-page (warm paper)
    theme_color: "#1b2330", // --color-ink (charcoal-navy)
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
