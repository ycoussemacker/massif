"use client";

import { useEffect, useState } from "react";

type State =
  | "loading"
  | "unsupported"
  | "ios-install"
  | "nokey"
  | "default"
  | "granted"
  | "denied";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Lets the athlete enable Web Push for the morning coach briefing on this device. iOS only allows
 * push from the home-screen-installed PWA, so we guide installation first when needed. */
export function NotificationOptIn() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    if (isIOS && !isStandalone()) {
      setState("ios-install");
      return;
    }
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      setState("unsupported");
      return;
    }
    if (!vapid) {
      setState("nokey");
      return;
    }
    setState(Notification.permission as "default" | "granted" | "denied");
  }, [vapid]);

  async function enable() {
    if (!vapid) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm as "default" | "denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState("granted");
    } catch {
      // surfaced as no state change — the athlete can retry
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("default");
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-1 text-sm font-medium text-stone-700 dark:text-stone-300">Notifications</h2>
      <p className="mb-3 text-xs text-stone-500 dark:text-stone-400">
        Recevoir le briefing du coach chaque matin sur ce téléphone.
      </p>

      {state === "loading" && <p className="text-sm text-stone-400">…</p>}

      {state === "unsupported" && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Notifications non supportées sur ce navigateur.
        </p>
      )}

      {state === "nokey" && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Notifications non configurées (clé VAPID manquante côté serveur).
        </p>
      )}

      {state === "ios-install" && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Sur iPhone : ouvre ce site dans Safari, puis{" "}
          <span className="font-medium text-stone-700 dark:text-stone-300">
            Partager → Sur l&apos;écran d&apos;accueil
          </span>
          . Rouvre l&apos;app depuis l&apos;écran d&apos;accueil et reviens ici pour activer les
          notifications.
        </p>
      )}

      {state === "default" && (
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {busy ? "Activation…" : "Activer les notifications"}
        </button>
      )}

      {state === "granted" && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Notifications activées ✓
          </span>
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="text-xs text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline disabled:opacity-50 dark:hover:text-stone-200"
          >
            Désactiver
          </button>
        </div>
      )}

      {state === "denied" && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Notifications bloquées. Autorise-les dans les réglages du navigateur, puis recharge la page.
        </p>
      )}
    </section>
  );
}
