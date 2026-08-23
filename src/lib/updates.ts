/**
 * Picks up a new deployment without the user having to hard-refresh.
 *
 * The service worker is built with `skipWaiting` + `clientsClaim`, so a new
 * build activates and claims open pages as soon as it is fetched. That swaps
 * the *worker*, not the JavaScript already running in the page — a tab left
 * open since before the deploy, or an app resumed from the home screen, keeps
 * executing the old bundle indefinitely. It still reports "Synced", because the
 * old sync code still runs and still succeeds; it is simply the old sync code.
 *
 * That is how a shipped fix can fail to reach a device that never appears
 * broken. Reloading once when the controller changes closes the gap.
 */
export function reloadOnNewVersion(): void {
  if (!('serviceWorker' in navigator)) return

  // On the very first visit there is no controller yet, and `clientsClaim`
  // fires this event as the worker takes over. Reloading then would be a
  // pointless flash, so only react once a worker was already in charge.
  if (!navigator.serviceWorker.controller) return

  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    location.reload()
  })
}
