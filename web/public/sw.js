// Web push for Timeline: show notifications with sound and open the post on click.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data.json(); } catch { d = { title: 'Timeline', body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    if (navigator.setAppBadge && d.badge !== undefined) navigator.setAppBadge(d.badge).catch(() => {});
    await self.registration.showNotification(d.title || 'Timeline', {
      body: d.body || '', icon: '/icon.svg', badge: '/icon.svg', tag: d.notificationId, renotify: true,
      data: { url: d.url || '/', notificationId: d.notificationId },
      requireInteraction: d.type === 'reminder',
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  if (event.notification.data?.notificationId) url.searchParams.set('n', event.notification.data.notificationId);
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === url.origin) { await c.focus(); c.postMessage({ type: 'navigate', url: url.pathname + url.search }); return; }
    }
    await clients.openWindow(url.href);
  })());
});
