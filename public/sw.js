// Service worker disabled — this file remains so existing installs can
// unregister themselves and purge their old caches. New visitors will not
// register a service worker (see index.html).

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.navigate(client.url);
      }
    })(),
  );
});
