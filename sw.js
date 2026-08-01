/*
 * ArTTiS — Service Worker
 * Strategi: cache-first dengan update di background (stale-while-revalidate).
 * File inti (HTML/manifest/ikon) di-precache saat install.
 * Library CDN (Tailwind, jsPDF, SheetJS, font) di-cache best-effort saat install,
 * dan otomatis ikut ter-cache saat pertama kali berhasil dimuat online.
 *
 * PENTING: naikkan CACHE_VERSION setiap kali ada update besar pada index.html,
 * supaya pengguna lama dapat versi terbaru (bukan versi cache basi).
 */
const CACHE_VERSION = 'arttis-v7';
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png'
];

// Library eksternal inti yang dipakai ArTTiS — dicache best-effort agar tetap
// tersedia saat offline (fitur yang butuh internet real-time seperti Generator
// Soal AI tetap butuh koneksi, ini hanya untuk aset statis library-nya).
const CDN_URLS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800;900&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await cache.addAll(PRECACHE_URLS);

    // Cache CDN inti. Mode 'no-cors' dipakai karena sebagian CDN tidak mengirim
    // header CORS untuk request non-module — hasilnya "opaque response", tapi
    // tetap bisa disimpan & dipakai ulang saat offline.
    const runtimeCache = await caches.open(RUNTIME);
    await Promise.all(CDN_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'no-cors' });
        await runtimeCache.put(url, res);
      } catch (e) {
        // Gagal (mis. offline saat install pertama) — tidak fatal,
        // akan otomatis ter-cache saat berhasil dimuat online nanti.
      }
    }));

    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('arttis-') && key !== PRECACHE && key !== RUNTIME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cached = await caches.match(req);

    // Selalu coba ambil versi terbaru dari jaringan di background,
    // supaya cache tidak basi selamanya begitu ada koneksi.
    const networkFetch = fetch(req).then(async (networkRes) => {
      try {
        const cache = await caches.open(RUNTIME);
        await cache.put(req, networkRes.clone());
      } catch (e) { /* respons opaque/cross-origin, abaikan error caching */ }
      return networkRes;
    }).catch(() => null);

    if (cached) {
      // Tidak menunggu networkFetch — langsung sajikan versi cache biar cepat & offline-safe.
      event.waitUntil(networkFetch);
      return cached;
    }

    const networkRes = await networkFetch;
    if (networkRes) return networkRes;

    // Offline total & belum ada cache sama sekali.
    if (req.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response(
      'Sedang offline dan konten ini belum tersimpan di cache. Buka ArTTiS sekali saat online agar bisa dipakai offline setelahnya.',
      { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  })());
});
