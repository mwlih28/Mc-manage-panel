/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// injectManifest fills this in at build time with the hashed asset list —
// required for vite-plugin-pwa's injectManifest strategy to work at all.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

// The actual point of PWA support here: a real OS-level notification for
// crash/security-alert/suspend even when no Kretase tab is open.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; serverId?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Kretase', body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Kretase', {
      body: payload.body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { serverId: payload.serverId },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const serverId = (event.notification.data as { serverId?: string } | undefined)?.serverId;
  const url = serverId ? `/servers/${serverId}` : '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
