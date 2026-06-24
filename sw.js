// StockSense Service Worker v1.0
// Handles push notifications for BUY/SHORT signals
// Works even when Chrome is minimised or screen is off

const CACHE_NAME = 'stocksense-v33';
const ASSETS = ['/', '/index.html'];

// ===== INSTALL — cache the app shell =====
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
});

// ===== ACTIVATE — clean old caches =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH — serve from cache when offline =====
self.addEventListener('fetch', event => {
  // Only cache same-origin GET requests
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ===== PUSH — receive push notification from server =====
self.addEventListener('push', event => {
  let data = { title: 'StockSense Signal', body: 'New signal detected', signal: 'BUY', symbol: '?', confidence: 0 };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch(e) {}

  const isShort = data.signal === 'SHORT';
  const icon = isShort ? '📉' : '📈';
  const color = isShort ? '#ff3355' : '#00ff88';

  event.waitUntil(
    self.registration.showNotification(
      `${icon} StockSense — ${data.signal} Signal`,
      {
        body: `${data.symbol} ${data.confidence}% | ₹${data.price} | RSI: ${data.rsi} | Vol: ${data.volRatio}x`,
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        tag: `stocksense-signal-${data.symbol}`,   // replaces previous notif for same stock
        renotify: true,
        vibrate: [200, 100, 200, 100, 400],
        data: { url: '/', signal: data.signal, symbol: data.symbol },
        actions: [
          { action: 'view', title: '👁 View Signal' },
          { action: 'dismiss', title: '✕ Dismiss' }
        ]
      }
    )
  );
});

// ===== NOTIFICATION CLICK — open/focus the app =====
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('stocksense') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ===== MESSAGE — receive signal from main tab and show local notification =====
// Used when push server isn't set up — main tab sends signal directly to SW
self.addEventListener('message', event => {
  if (event.data?.type !== 'SHOW_SIGNAL_NOTIFICATION') return;
  const d = event.data;
  const isShort = d.signal === 'SHORT';
  const icon = isShort ? '📉' : '📈';

  self.registration.showNotification(
    `${icon} StockSense — ${d.signal} Signal`,
    {
      body: `${d.symbol} ${d.confidence}% | ₹${d.price} | RSI: ${d.rsi} | Vol: ${d.volRatio}x\n${d.sectorWeak ? '⚠️ Sector Weak' : ''}`,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: `stocksense-signal-${d.symbol}`,
      renotify: true,
      vibrate: isShort ? [400, 100, 400, 100, 800] : [200, 100, 200],
      data: { url: '/', signal: d.signal, symbol: d.symbol },
      actions: [
        { action: 'view', title: '👁 View Signal' },
        { action: 'dismiss', title: '✕ Dismiss' }
      ]
    }
  );
});
