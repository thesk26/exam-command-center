self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "Exam Command Center", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Exam Command Center", {
    body: d.body, tag: d.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(l => {
    for (const c of l) if ("focus" in c) { c.navigate(e.notification.data.url); return c.focus(); }
    return clients.openWindow(e.notification.data.url);
  }));
});
