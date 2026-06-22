/* Massif service worker — Web Push display + click-through.
 * Installability does not need a SW; this exists so the morning coach briefing can arrive as a
 * notification on the installed PWA. Registered on demand by the NotificationOptIn component. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Massif", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Massif";
  const options = {
    body: data.body || "",
    icon: "/icon",
    badge: "/icon",
    tag: "massif-briefing",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
