/** Web Push delivery of the morning briefing to the athlete's installed PWA.
 *
 * Called at the end of the coach run (coach.ts) once the briefing is written. Sends a VAPID-signed
 * notification to every device in push_subscriptions. Expired endpoints (404/410) are pruned. The
 * whole thing is best-effort: a missing VAPID key or a send failure must never fail the briefing.
 */
import webpush from "web-push";
import { db } from "./db.js";

export type PushBriefing = {
  readiness: "green" | "amber" | "red";
  title: string; // today's session title
  why: string; // rationale → notification body
};

const DOT: Record<string, string> = { green: "🟢", amber: "🟡", red: "🔴" };

export async function sendBriefingPush(b: PushBriefing): Promise<void> {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:coach@massif.app";
  if (!pub || !priv) {
    console.log("push: skipped (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set)");
    return;
  }

  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth");
  if (error) {
    console.log(`push: skipped (${error.message})`);
    return;
  }
  if (!subs?.length) {
    console.log("push: no registered devices");
    return;
  }

  webpush.setVapidDetails(subject, pub, priv);
  const body = b.why.length > 180 ? b.why.slice(0, 177) + "…" : b.why;
  const payload = JSON.stringify({
    title: `${DOT[b.readiness] ?? "•"} Massif — ${b.title}`,
    body,
    url: "/",
  });

  let sent = 0;
  for (const s of subs as Array<{ endpoint: string; p256dh: string; auth: string }>) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (e: unknown) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        console.log("push: pruned an expired subscription");
      } else {
        console.log(`push: send failed (${code ?? (e as Error)?.message ?? e})`);
      }
    }
  }
  console.log(`push: notified ${sent}/${subs.length} device(s)`);
}
