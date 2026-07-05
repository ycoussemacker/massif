import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegenProvider } from "@/components/regen-provider";
import { GarminAutoRefresh } from "@/components/garmin-auto-refresh";
import { StravaAutoRefresh } from "@/components/strava-auto-refresh";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://massif.vercel.app"),
  title: "Massif",
  description: "Multi-sport training load + agentic coach dashboard",
  applicationName: "Massif",
  // Installed-PWA behaviour on iOS: chrome-less standalone launch, content under the status bar
  // (paired with viewportFit:'cover' + the pages' env(safe-area-inset-*) padding).
  appleWebApp: { capable: true, title: "Massif", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Extend under the notch/camera so we control the safe area ourselves (pages pad with
  // env(safe-area-inset-*)); without "cover" those insets resolve to 0.
  viewportFit: "cover",
  // Standalone-window chrome tint — tracks the design system's dark-mode flip (page token).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Browser extensions (e.g. LanguageTool → data-lt-installed) mutate <html> before React
      // hydrates; suppress the resulting attribute-mismatch warning on this element only.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Les auto-refresh vivent DANS le provider : l'auto-sync Strava signale son état 'sync' au
            contexte pour que les surfaces concernées se grisent aussi sur le chemin automatique. */}
        <RegenProvider>
          {children}
          {/* On app open (background, no UI): pull Garmin recovery if this morning's isn't in yet, and
              refresh Strava activities + the load model so the graphs are current without a manual gesture. */}
          <GarminAutoRefresh />
          <StravaAutoRefresh />
        </RegenProvider>
      </body>
    </html>
  );
}
