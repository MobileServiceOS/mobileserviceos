interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;

export function setupInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent('msos:install-available'));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
  });
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function clearInstallPrompt(): void {
  deferred = null;
}

/**
 * Service worker update detection.
 *
 * When a new SW is deployed:
 *   1. Browser fetches sw.js, sees it changed → installs new SW in parallel
 *      with the active one
 *   2. New SW sits in `registration.waiting` until current tabs close
 *   3. We dispatch `msos:update-available` so <UpdateBanner> can show
 *   4. When user taps Update, applyServiceWorkerUpdate() posts SKIP_WAITING
 *      to the waiting SW, which triggers controllerchange + reload
 */
export function setupServiceWorkerUpdates(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then((registration) => {
    if (registration.waiting) {
      window.dispatchEvent(new CustomEvent('msos:update-available'));
    }
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent('msos:update-available'));
        }
      });
    });
  }).catch((e) => {
    console.warn('[pwa] update detection setup failed:', e);
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/**
 * Tell the waiting service worker to activate now. The SW receives the
 * SKIP_WAITING message (handled in public/sw.js) and triggers
 * controllerchange, which our listener turns into a reload.
 */
export function applyServiceWorkerUpdate(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then((registration) => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  });
}
