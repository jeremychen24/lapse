// Screen Wake Lock keeps iOS from auto-locking (which would stop the camera).
// The lock drops whenever the page is hidden, so it's re-taken on return.

let lock = null;
let want = false;

async function acquire() {
  if (!want || lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    const l = await navigator.wakeLock.request('screen');
    if (!want) return void l.release().catch(() => {});
    lock = l;
    lock.addEventListener('release', () => (lock = null));
  } catch {
    lock = null;
  }
}

export function keepAwake(on) {
  want = on;
  if (on) acquire();
  else if (lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}

export const wakeSupported = () => 'wakeLock' in navigator;

document.addEventListener('visibilitychange', acquire);
