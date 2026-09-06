'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, and only where it can honestly help.
 *
 * Two conditions before it runs. The browser must support it, and the page must
 * be in a secure context — `localhost` counts, which is where this product lives
 * today. A registration that silently fails is worse than none: it makes the
 * install prompt appear and then leaves the offline page missing.
 *
 * A failure is left alone rather than reported. The application works perfectly
 * without a service worker; the only thing lost is the offline shell, and nagging
 * a family about it would be noise about something they did not ask for.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

    const register = () => {
      void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {
        // No offline shell. Everything else is unaffected.
      });
    };

    // After load, so registration never competes with the first paint.
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
