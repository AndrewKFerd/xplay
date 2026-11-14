// Web-app mode (phones, tablets, any browser without the desktop app): offline cache via sw.js and an
// "Install app" button. Under tools/serve.py (the desktop app) none of this runs.
let deferred = null; // Chrome/Edge/Android install prompt
const listeners = new Set();
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });

export async function initPWA(hasServer) {
  if (!('serviceWorker' in navigator)) return;
  if (hasServer) { // desktop app: drop any worker left from browsing the same address as a web app
    (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister());
    return;
  }
  if (!isSecureContext) return;
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    // Files loaded before the worker took over aren't cached yet: add them so the next launch works offline.
    const cache = await caches.open('xplay-app');
    const urls = performance.getEntriesByType('resource').map((r) => r.name)
      .filter((u) => u.startsWith(location.origin) && !/\/(api\/|img\?|events)/.test(u));
    await Promise.all(['./', ...new Set(urls)].map((u) => cache.match(u).then((hit) => hit || cache.add(u)).catch(() => {})));
  } catch (e) { console.warn('service worker', e); }
}

/** Mounts the home page's install button into `slot` (hidden when installing isn't possible). */
export function installButton(slot) {
  const draw = () => {
    if (!slot.isConnected) return listeners.delete(draw);
    if (standalone()) slot.innerHTML = '';
    else if (deferred) slot.innerHTML = '<button class="btn sm primary" data-install>📲 Install app</button>';
    else if (isIOS()) slot.innerHTML = '<span class="muted small">📲 To install: Share → <b>Add to Home Screen</b></span>';
    else slot.innerHTML = '';
  };
  slot.onclick = async (e) => {
    if (!e.target.closest('[data-install]') || !deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    draw();
  };
  listeners.add(draw);
  draw();
}
