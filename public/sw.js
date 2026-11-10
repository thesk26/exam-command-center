const SHELL_CACHE = "exam-command-center-shell-v1";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("exam-command-center-") && key !== SHELL_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/functions/")) return;
  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".png") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
    return;
  }
  event.respondWith(fetch(request).then(async (response) => {
    if (response.ok) await (await caches.open(SHELL_CACHE)).put("/", response.clone());
    return response;
  }).catch(async () => (await caches.match(request)) ?? (await caches.match("/"))));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "Exam Command Center", body: event.data?.text() || "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Exam Command Center", {
    body: data.body || "",
    tag: data.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const windowClient of windows) {
      if ("focus" in windowClient) { windowClient.navigate(target); return windowClient.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});