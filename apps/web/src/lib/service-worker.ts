// Registers the service worker in public/sw.js (AI-172). It only shows pushes and opens
// their links; it caches nothing (see sw.js). Failures are logged, never thrown: the app
// works the same without it.
export async function registerServiceWorker(nav: Navigator = navigator): Promise<void> {
  if (!("serviceWorker" in nav)) return;
  try {
    await nav.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.error("service worker registration failed", err);
  }
}
