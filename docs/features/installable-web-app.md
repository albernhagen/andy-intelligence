# Installable web app

The web app can be added to an iPhone's Home Screen and opens full screen with its own icon: the mark on an indigo square (AI-392; `design-details.md` Logo). A service worker is registered only to show pushes (from M7: Mobile's later tickets) and open their same-origin links; it caches nothing, so the app is never stale offline and nothing signed-in is stored (AI-172, ADR-0052).

**How to use:** In Safari, Share → Add to Home Screen. Remove a bad service worker: Safari Settings → Advanced → Website Data, delete the site; on desktop, DevTools → Application → Service workers → Unregister.
