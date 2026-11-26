const CACHE = "thakirni-v9";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("thakirni-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// نجيب الجديد من النت، ولو مافي نت نرجع للنسخة المحفوظة
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // ملف التقويم نسويه هنا عشان الآيفون يفتح شاشة "إضافة للتقويم" على طول
  if (url.pathname.endsWith("/event.ics")) {
    const b64 = (url.searchParams.get("d") || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    e.respondWith(new Response(bytes, { headers: { "Content-Type": "text/calendar; charset=utf-8" } }));
    return;
  }
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  const inScope = url.origin === location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
  if (!isFont && !inScope) return;
  // ملفات القراية كبيرة، نخليها للمتصفح نفسه
  if (url.pathname.includes("/ocr/")) return;
  e.respondWith(
    // no-cache: نتأكد من السيرفر كل مرة عشان أي تعديل يوصل على طول
    fetch(isFont ? req : new Request(req, { cache: "no-cache" }))
      .then((res) => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});
