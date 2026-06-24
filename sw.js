// StockSense Service Worker v2.0
// Handles push notifications, live scan progress notification, and background sync

const SW_VERSION = 'v2.0 — 24 Jun 2026 19:00'; // UPDATE THIS when uploading new sw.js
const CACHE_NAME = 'stocksense-v33';

// ===== INSTALL =====
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(['/', '/index.html']).catch(() => {}))
  );
});

// ===== ACTIVATE =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH =====
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', event => {
  const action = event.action;
  const data = event.notification.data || {};
  event.notification.close();

  if (action === 'stop') {
    // Send stop message to all open tabs
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
        cls.forEach(c => c.postMessage({ type: 'SW_STOP_SCAN' }));
      })
    );
    return;
  }

  if (action === 'scannow') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
        cls.forEach(c => c.postMessage({ type: 'SW_SCAN_NOW' }));
        // Focus or open app
        const openClient = cls.find(c => c.url.includes('stocksense') && 'focus' in c);
        if (openClient) return openClient.focus();
        if (clients.openWindow) return clients.openWindow('/');
      })
    );
    return;
  }

  if (action === 'view' || action === 'dismiss') {
    if (action === 'view') {
      event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
          const openClient = cls.find(c => 'focus' in c);
          if (openClient) return openClient.focus();
          if (clients.openWindow) return clients.openWindow('/');
        })
      );
    }
    return;
  }

  // Default tap — focus app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const openClient = cls.find(c => 'focus' in c);
      if (openClient) return openClient.focus();
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ===== MESSAGE from main tab =====
self.addEventListener('message', event => {
  const d = event.data;
  if (!d || !d.type) return;

  switch (d.type) {

    // Live scan progress notification
    case 'SCAN_PROGRESS': {
      const pct = Math.round((d.scanned / d.total) * 100);
      const bar = '█'.repeat(Math.floor(pct/10)) + '░'.repeat(10 - Math.floor(pct/10));
      self.registration.showNotification('⏱ StockSense — Scanning...', {
        body: `${bar} ${d.scanned}/${d.total} stocks\n🟢 ${d.buys} BUY  🔴 ${d.shorts} SHORT  |  Scan #${d.scanNum}`,
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        tag: 'stocksense-live',          // same tag = updates in place, no stacking
        renotify: false,                  // silent update — no sound/vibration on progress
        silent: true,
        ongoing: true,                    // Android: can't be swiped away while scan runs
        data: { type: 'progress' },
        actions: [
          { action: 'stop', title: '⏹ Stop' }
        ]
      });
      break;
    }

    // Scan complete notification
    case 'SCAN_COMPLETE': {
      const signals = [...(d.buys || []), ...(d.shorts || [])];
      const signalText = signals.length > 0
        ? signals.slice(0, 3).map(s => `${s.signal === 'BUY' ? '🟢' : '🔴'} ${s.symbol} ${s.confidence}% ₹${s.price}`).join('\n')
        : '🟡 No signals — all AVOID';
      self.registration.showNotification(
        signals.length > 0 ? `📊 Scan #${d.scanNum} — ${signals.length} Signal${signals.length > 1 ? 's' : ''} Found!` : `📊 Scan #${d.scanNum} Complete — No Signals`,
        {
          body: `${signalText}\n⏳ Next scan in ${Math.round(d.restSecs / 60)}m`,
          icon: '/icon-192.png',
          badge: '/icon-72.png',
          tag: 'stocksense-live',
          renotify: signals.length > 0,   // vibrate only when signals found
          silent: signals.length === 0,
          vibrate: signals.length > 0 ? [300, 100, 300, 100, 600] : undefined,
          data: { type: 'complete', signals },
          actions: [
            { action: 'scannow', title: '⚡ Scan Now' },
            { action: 'stop', title: '⏹ Stop' }
          ]
        }
      );
      break;
    }

    // Rest countdown notification (updates every 30s)
    case 'REST_TICK': {
      const mins = Math.floor(d.secsLeft / 60);
      const secs = d.secsLeft % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const lastSignals = (d.lastSignals || []).slice(0, 2)
        .map(s => `${s.signal === 'BUY' ? '🟢' : '🔴'} ${s.symbol} ${s.confidence}%`)
        .join('  ') || '🟡 No signals last scan';
      self.registration.showNotification(`⏳ Next scan in ${timeStr}`, {
        body: `${lastSignals}\nScan #${d.scanNum} of session`,
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        tag: 'stocksense-live',
        renotify: false,
        silent: true,
        data: { type: 'rest' },
        actions: [
          { action: 'scannow', title: '⚡ Scan Now' },
          { action: 'stop', title: '⏹ Stop' }
        ]
      });
      break;
    }

    // Individual signal notification (fired for each BUY/SHORT)
    case 'SHOW_SIGNAL_NOTIFICATION': {
      const isShort = d.signal === 'SHORT';
      self.registration.showNotification(
        `${isShort ? '📉' : '📈'} StockSense — ${d.signal} Signal`,
        {
          body: `${d.symbol} ${d.confidence}% | ₹${d.price} | RSI: ${d.rsi} | Vol: ${d.volRatio}x${d.sectorWeak ? '\n⚠️ Sector Weak' : ''}`,
          icon: '/icon-192.png',
          badge: '/icon-72.png',
          tag: `stocksense-signal-${d.symbol}`,
          renotify: true,
          vibrate: isShort ? [400, 100, 400, 100, 800] : [200, 100, 200],
          data: { type: 'signal', signal: d.signal, symbol: d.symbol },
          actions: [
            { action: 'view', title: '👁 View' },
            { action: 'dismiss', title: '✕ Dismiss' }
          ]
        }
      );
      break;
    }

    // Clear the live notification (when scan session stopped)
    case 'CLEAR_LIVE_NOTIFICATION': {
      self.registration.getNotifications({ tag: 'stocksense-live' })
        .then(notifs => notifs.forEach(n => n.close()));
      break;
    }

    // Version check — page asks SW what version it is
    case 'VERSION_CHECK': {
      event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
      break;
    }
  }
});
