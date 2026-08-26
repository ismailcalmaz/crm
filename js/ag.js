// =====================================================================
// ag.js — Ağ dayanıklılık katmanı (AŞAMA 7).
//   • agFetch      : Supabase'in kullandığı fetch sarmalayıcısı
//       - ağ hatası / 5xx / 429'da üstel geri çekilmeli (backoff) YENİDEN DENEME
//       - PostgREST hatalarını TEK YERDEN loglar (sessiz catch yok — §5.4)
//       - 1000 satır limiti uyarısı (§5.3: varsayılan limit sessizce keser)
//   • cevrimdisiBannerKur : internet gidince/gelince üstte şerit
//   • kurtarmaKur         : bozuk Service Worker önbelleğinden otomatik kurtarma
//   • onbellekSifirla     : elle tam temizlik (konsoldan da çağrılabilir)
//
// ⚠️ YAZMA İSTEKLERİ YENİDEN DENENMEZ. Bir POST/PATCH/DELETE ağ hatası
// verdiğinde isteğin sunucuya ULAŞIP ULAŞMADIĞINI bilemeyiz; yeniden
// denemek cari hareketini/tahsilatı ÇİFT yazabilir. Para sisteminde çift
// kayıt, tek kayıp denemeden çok daha pahalıdır. Yalnız GET/HEAD denenir.
// =====================================================================

const YENIDEN_DENENIR = new Set(['GET', 'HEAD'])
const MAX_DENEME = 3                    // ilk deneme + 2 tekrar
const BEKLE = [400, 1200]               // ms — üzerine %0-40 rastgele pay

const bekle = ms => new Promise(r => setTimeout(r, ms))

function yontem(girdi, ayar) {
  return String(ayar?.method || (girdi && girdi.method) || 'GET').toUpperCase()
}
function adres(girdi) {
  try { return typeof girdi === 'string' ? girdi : (girdi?.url || String(girdi)) } catch { return '?' }
}

// PostgREST/Storage hatalarını tek yerden logla (hangi çağrı, hangi durum)
async function hataLogla(url, durum, cevap) {
  try {
    const klon = cevap.clone()
    const metin = await klon.text()
    console.error(`[ag] ${durum} ${kisaUrl(url)} → ${metin.slice(0, 400)}`)
  } catch (_) { console.error(`[ag] ${durum} ${kisaUrl(url)}`) }
}
function kisaUrl(u) {
  try { const x = new URL(u); return x.pathname + (x.search ? x.search.slice(0, 160) : '') } catch { return String(u).slice(0, 160) }
}

// §5.3 — PostgREST varsayılan 1000 satırda SESSİZCE keser. Sayım/rapor
// sorgularında yanlış sonuç üretir. Tam 1000 satır dönerse yüksek sesle uyar.
async function limitUyar(url, cevap) {
  try {
    const aralik = cevap.headers.get('content-range')   // "0-999/*"
    if (!aralik) return
    const m = aralik.match(/^(\d+)-(\d+)\//)
    if (!m) return
    const adet = Number(m[2]) - Number(m[1]) + 1
    if (adet === 1000) {
      console.warn(`[ag] ⚠ 1000 SATIR LİMİTİ: ${kisaUrl(url)} — sonuç kesilmiş olabilir, sayfalama (range/limit) ekleyin.`)
    }
  } catch (_) { /* yoksay */ }
}

export async function agFetch(girdi, ayar) {
  const m = yontem(girdi, ayar)
  const url = adres(girdi)
  const denenebilir = YENIDEN_DENENIR.has(m)
  let sonHata = null

  for (let deneme = 0; deneme < (denenebilir ? MAX_DENEME : 1); deneme++) {
    try {
      const cevap = await fetch(girdi, ayar)
      // 5xx / 429 / 408 → geçici sayılır, GET ise tekrar dene
      if (denenebilir && (cevap.status >= 500 || cevap.status === 429 || cevap.status === 408)) {
        if (deneme < MAX_DENEME - 1) {
          const b = BEKLE[deneme] * (1 + Math.random() * 0.4)
          console.warn(`[ag] ${cevap.status} ${kisaUrl(url)} — ${Math.round(b)}ms sonra yeniden denenecek (${deneme + 1}/${MAX_DENEME - 1})`)
          await bekle(b)
          continue
        }
      }
      if (!cevap.ok) await hataLogla(url, cevap.status, cevap)
      else await limitUyar(url, cevap)
      cevrimdisiIsaretle(false)
      return cevap
    } catch (e) {
      sonHata = e
      // Ağ hatası: cevap YOK. GET ise yeniden dene, yazmada asla.
      if (denenebilir && deneme < MAX_DENEME - 1) {
        const b = BEKLE[deneme] * (1 + Math.random() * 0.4)
        console.warn(`[ag] ağ hatası ${kisaUrl(url)} — ${Math.round(b)}ms sonra yeniden denenecek (${deneme + 1}/${MAX_DENEME - 1})`)
        await bekle(b)
        continue
      }
      console.error(`[ag] ${m} ${kisaUrl(url)} BAŞARISIZ:`, e?.message || e)
      if (!navigator.onLine) cevrimdisiIsaretle(true)
      throw e
    }
  }
  throw sonHata || new Error('ag: bilinmeyen hata')
}

// =====================================================================
// Çevrimdışı şeridi
// =====================================================================
let _bannerKuruldu = false
function banner() {
  let el = document.getElementById('agBanner')
  if (el) return el
  el = document.createElement('div')
  el.id = 'agBanner'
  el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;display:none;' +
    'padding:8px 16px;text-align:center;font:600 13px/1.4 system-ui,sans-serif;' +
    'background:#7f1d1d;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25)'
  document.body.appendChild(el)
  return el
}
function cevrimdisiIsaretle(kapali) {
  if (!_bannerKuruldu) return
  const el = banner()
  if (kapali || !navigator.onLine) {
    el.textContent = '⚠ İnternet bağlantısı yok — girdiğin veriler KAYDEDİLMEZ. Bağlantı gelince tekrar dene.'
    el.style.background = '#7f1d1d'
    el.style.display = 'block'
  } else if (el.dataset.geldi === '1') {
    el.textContent = '✓ Bağlantı geri geldi.'
    el.style.background = '#065f46'
    el.style.display = 'block'
    clearTimeout(cevrimdisiIsaretle._t)
    cevrimdisiIsaretle._t = setTimeout(() => { el.style.display = 'none'; el.dataset.geldi = '' }, 2500)
  } else {
    el.style.display = 'none'
  }
}
export function cevrimdisiBannerKur() {
  if (_bannerKuruldu) return
  _bannerKuruldu = true
  banner()
  window.addEventListener('offline', () => cevrimdisiIsaretle(true))
  window.addEventListener('online', () => { banner().dataset.geldi = '1'; cevrimdisiIsaretle(false) })
  if (!navigator.onLine) cevrimdisiIsaretle(true)
}

// =====================================================================
// Service Worker / önbellek kurtarma
//   Bozuk ya da yarım kalmış bir önbellek, modül yüklemesini kırar ve sayfa
//   bembeyaz açılır ("Failed to fetch dynamically imported module"). O durumda
//   TEK SEFER otomatik temizleyip yeniden yükleriz — döngüye girmemek için
//   sessionStorage bayrağı ile korunur.
// =====================================================================
export async function onbellekSifirla(yenidenYukle = true) {
  try {
    // Aktif service worker'a da haber ver (kendi önbelleğini boşaltsın)
    try { navigator.serviceWorker?.controller?.postMessage({ tip: 'ONBELLEK_SIFIRLA' }) } catch (_) {}
    if ('caches' in window) {
      const ks = await caches.keys()
      await Promise.all(ks.map(k => caches.delete(k)))
    }
    if ('serviceWorker' in navigator) {
      const rs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(rs.map(r => r.unregister()))
    }
    console.warn('[ag] önbellek + service worker temizlendi')
  } catch (e) { console.error('[ag] önbellek temizlenemedi', e) }
  if (yenidenYukle) location.reload()
}

const MODUL_HATASI = /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError/i
export function kurtarmaKur() {
  const denendi = () => { try { return sessionStorage.getItem('ic-onbellek-kurtarma') === '1' } catch { return false } }
  const isaretle = () => { try { sessionStorage.setItem('ic-onbellek-kurtarma', '1') } catch (_) {} }

  const bak = mesaj => {
    if (!mesaj || !MODUL_HATASI.test(String(mesaj))) return
    if (denendi()) { console.error('[ag] modül yüklenemedi ve kurtarma zaten denendi — sunucu/ağ sorunu olabilir'); return }
    isaretle()
    console.warn('[ag] modül yüklenemedi → önbellek sıfırlanıp yeniden yükleniyor')
    onbellekSifirla(true)
  }
  window.addEventListener('error', e => bak(e?.message))
  window.addEventListener('unhandledrejection', e => bak(e?.reason?.message || e?.reason))

  // Sayfa sorunsuz açıldıysa bayrağı düşür (bir sonraki gerçek arıza kurtarılabilsin)
  window.addEventListener('load', () => {
    setTimeout(() => { try { sessionStorage.removeItem('ic-onbellek-kurtarma') } catch (_) {} }, 4000)
  })

  // Konsoldan elle: crmOnbellekSifirla()
  window.crmOnbellekSifirla = () => onbellekSifirla(true)
}
