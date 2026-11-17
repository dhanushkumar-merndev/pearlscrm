/* Pearl Aesthetic Clinic Library — browser push service worker.
 *
 * Firebase Cloud Messaging delivers data-only messages (see src/lib/push/fcm.ts),
 * so this worker shows them itself. It needs no Firebase config and loads no
 * third-party script. Notification text carries File IDs and case numbers only,
 * never patient names.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function sameOriginPath(link) {
  try {
    const url = new URL(link || "/notifications", self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : "/notifications";
  } catch {
    return "/notifications";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    const json = event.data ? event.data.json() : {};
    data = json.data || json;
  } catch {
    data = {};
  }

  const title = data.title || "Pearl Clinic";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.id || undefined,
      data: { link: sameOriginPath(data.link) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.link) || "/notifications";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(path);
          return;
        }
      }
      await self.clients.openWindow(path);
    })(),
  );
});
