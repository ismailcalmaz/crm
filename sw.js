// =====================================================================
// sw.js — Service Worker (PWA)
//   Ağ öncelikli: her zaman taze içerik dener, çevrimdışıysa önbellekten
//   döner. Böylece güncellemeler anında gelir + çevrimdışı açılır.
//   Supabase/CDN gibi çapraz-köken istekler ES engellenmez (varsayılan ağ).
// =====================================================================
const CACHE = 'ic-crm-v371'

self.addEventListener('install', e => { self.skipWaiting() })

// Sayfadan gelen "önbelleği sıfırla" isteği (ag.js onbellekSifirla) — bozuk
// önbellekten kurtarma yolunun service worker tarafı.
self.addEventListener('message', e => {
  if (e.data && e.data.tip === 'ONBELLEK_SIFIRLA') {
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
  }
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))))
  self.clients.claim()
})

// Sunucudan push → uygulama kapalıyken bile bildirim göster
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { baslik: e.data && e.data.text() } }
  const baslik = d.baslik || 'Yeni bildirim'
  const opt = {
    body: d.mesaj || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || 'crm-push',
    data: { link: d.link || 'talepler.html' },
    // ⚠️ P1 (KRİTİK) bildirimler ekranda ASILI kalır — kullanıcı kapatana
    //    kadar gitmez. 19 Ağu 2026: min fiyat onayı aynı saniyede gelen
    //    "Yeni sipariş" bildiriminin arasında kaybolmuş, satış müdürü
    //    ancak sipariş dosyasına girince görmüştü. Bir satışı kilitleyen
    //    bildirim kendiliğinden kaybolmamalı.
    requireInteraction: d.oncelik === 1,
    ...(d.oncelik === 1 ? { vibrate: [200, 100, 200] } : {}),
  }
  e.waitUntil(self.registration.showNotification(baslik, opt))
})

// Bildirime tıklama → açık CRM sekmesini odakla, yoksa link ile aç
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const link = (e.notification.data && e.notification.data.link) || 'talepler.html'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) {
        if ('focus' in c) { c.focus(); if ('navigate' in c) c.navigate(link).catch(() => {}); return }
      }
      return self.clients.openWindow(link)
    })
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  // Sadece kendi kaynağımızdaki GET istekleri (statik). Supabase/esm.sh vb. dokunma.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // cache:'reload' → tarayıcı HTTP önbelleğini ATLA, daima sunucudan çek.
  // Yoksa "ağ öncelikli" olsa bile fetch() HTTP önbelleğinden bayat dosya
  // döndürür ve CACHE sürümünü artırmak güncellemeyi getirmez (kullanıcılar
  // ~10 dk eski JS görür). Bu, deploy'ların anında gelmesini sağlar.
  // Navigasyon (HTML) isteğinden new Request kurmak hata verir; onu olduğu
  // gibi bırak, cache atlamayı yalnızca alt kaynaklara (JS/CSS/img) uygula.
  const istek = e.request.mode === 'navigate'
    ? e.request : new Request(e.request, { cache: 'reload' })
  e.respondWith(
    fetch(istek)
      .then(res => {
        if (res && res.ok) {
          const kopya = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, kopya))
        }
        return res
      })
      // Çevrimdışı → önbellek. Sayfa (navigate) isteğinde önbellekte de yoksa
      // beyaz ekran yerine açıklayıcı bir çevrimdışı sayfası dön.
      .catch(() => caches.match(e.request).then(c => c || (e.request.mode === 'navigate' ? cevrimdisiSayfa() : undefined)))
  )
})

function cevrimdisiSayfa() {
  return new Response(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Bağlantı yok — İÇ CRM</title></head>
     <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#faf7f7;font:400 15px/1.5 system-ui,sans-serif;color:#3b2b2b">
       <div style="text-align:center;max-width:420px;padding:32px">
         <div style="font-size:56px">📶</div>
         <h1 style="color:#5f1818;font-size:20px;margin:12px 0 8px">İnternet bağlantısı yok</h1>
         <p style="margin:0 0 20px;color:#6b5b5b">Bu sayfa daha önce açılmadığı için çevrimdışı gösterilemiyor. Bağlantın gelince tekrar dene.</p>
         <button onclick="location.reload()" style="background:#5f1818;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-weight:700;font-size:15px;cursor:pointer">Tekrar Dene</button>
       </div>
     </body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}
