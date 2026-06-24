/** Server-side Web Push from the web app (VAPID). Mirror of coach/src/push.ts, generic payload — used
 *  to notify the athlete when a background plan regeneration finishes while they've left/closed the PWA.
 *  Best-effort: a missing VAPID key or a send failure must never break the caller. */
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

export async function sendPush(
  sb: SupabaseClient,
  n: { title: string; body: string; url?: string },
): Promise<void> {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:coach@massif.app";
  if (!pub || !priv) return;

  const { data: subs } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth");
  if (!subs?.length) return;

  webpush.setVapidDetails(subject, pub, priv);
  const payload = JSON.stringify({
    title: n.title,
    body: n.body.length > 180 ? n.body.slice(0, 177) + "…" : n.body,
    url: n.url ?? "/",
  });

  for (const s of subs as Array<{ endpoint: string; p256dh: string; auth: string }>) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    } catch (e: unknown) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }
}
