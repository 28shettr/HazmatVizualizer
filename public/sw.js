const VERSION = "v3";
const CACHE_NAME = `pedro-visualizer-${VERSION}`;

// Derive the deployment base path from the service worker's own URL so the
// same file works whether the app is served from "/" or "/HazmatVizualizer/".
const SCOPE = new URL("./", self.location).pathname;

const APP_STATIC_RESOURCES = [
  "",
  "favicon.ico",
  "fields/centerstage.webp",
  "fields/intothedeep.webp",
  "fields/decode.webp",
  "robot.png",
  "fonts/Poppins-Regular.ttf",
  "fonts/Poppins-SemiBold.ttf",
  "fonts/Poppins-Light.ttf",
  "fonts/Poppins-ExtraLight.ttf",
].map((path) => SCOPE + path);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Best-effort: don't let a single 404 abort the whole install.
      await Promise.allSettled(
        APP_STATIC_RESOURCES.map((url) => cache.add(url)),
      );
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
          return undefined;
        }),
      );
      await clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request.url);
      if (cachedResponse) {
        return cachedResponse;
      }
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        return new Response(null, { status: 404 });
      }
    })(),
  );
});
