// =====================================================================
// stitch-ui.js — Stitch (Tailwind) sayfaları için ortak görünüm yardımcıları
//   İkon, rozet, avatar, boş durum, uyarı. Tüm dönüştürülen sayfalar kullanır.
// =====================================================================
import { kacis } from './veri.js'

// Material Symbols ikonu
export function mat(ad, ekstra = '', dolu = false) {
  return `<span class="material-symbols-outlined${ekstra ? ' ' + ekstra : ''}"${dolu ? ` style="font-variation-settings:'FILL' 1"` : ''}>${ad}</span>`
}

// Binlik ayraçlı CANLI sayı girişi — class="para-gir" olan input'lar yazarken
// 1.000.000 gibi noktalanır. Kaydederken value.replace(/\D/g,'') ile ham sayı
// alınır (mevcut kaydetme yolları zaten noktayı temizliyor). Delegasyon olduğu
// için dinamik eklenen input'lar da (drawer/modal) otomatik kapsanır.
let _binlikKuruldu = false
export function binlikInputKur() {
  if (_binlikKuruldu) return; _binlikKuruldu = true
  document.addEventListener('input', e => {
    const t = e.target
    if (!t || !t.classList || !t.classList.contains('para-gir')) return
    const ham = String(t.value || '').replace(/\D/g, '')
    t.value = ham ? Number(ham).toLocaleString('tr-TR') : ''
  })
}

// Telefon maskesi — class="tel-gir" olan input'lar yazarken "(539) 340 17 91"
// biçimine girer. 10 hane, başa 0 YAZILMAZ (kullanıcı kuralı); veritabanına
// kaydederken telSifirla() ile "05550000000" olur. Delegasyon → dinamik
// eklenen input'lar (drawer/modal) da kapsanır.
let _telKuruldu = false
export function telMaskeKur() {
  if (_telKuruldu) return; _telKuruldu = true
  document.addEventListener('input', e => {
    const t = e.target
    if (!t || !t.classList || !t.classList.contains('tel-gir')) return
    let d = String(t.value || '').replace(/\D/g, '')
    if (d.startsWith('90')) d = d.slice(2)      // +90 yapıştırıldı
    if (d.startsWith('0')) d = d.slice(1)       // 0'lı yapıştırıldı → at
    d = d.slice(0, 10)
    let s = ''
    if (d.length) s = '(' + d.slice(0, 3)
    if (d.length >= 3) s += ') ' + d.slice(3, 6)
    if (d.length > 6) s += ' ' + d.slice(6, 8)
    if (d.length > 8) s += ' ' + d.slice(8, 10)
    t.value = s
  })
}

// Durum sınıfı → Tailwind pill sınıfı
export const PILL = {
  basari: 'bg-green-100 text-green-800', aktif: 'bg-amber-100 text-amber-800',
  hata: 'bg-red-100 text-red-800', bilgi: 'bg-blue-100 text-blue-800', yeni: 'bg-blue-100 text-blue-800',
  havuz: 'bg-primary/10 text-primary', notr: 'bg-surface-container-high text-on-surface-variant',
}
export function pill(metin, sinif) {
  return `<span class="px-3 py-1 rounded-full text-label-sm font-bold ${PILL[sinif] || PILL.notr}">${kacis(metin)}</span>`
}

// Mini trend çizgisi (SVG) — KPI kartlarında premium his. <2 nokta ise boş.
export function sparkline(vals, hex = '#5f1818', h = 30) {
  const v = (vals || []).filter(x => x != null && !isNaN(x))
  if (v.length < 2) return `<div style="height:${h}px"></div>`
  const w = 150, mx = Math.max(...v), mn = Math.min(...v), rng = (mx - mn) || 1
  const px = i => (i / (v.length - 1) * w).toFixed(1)
  const py = val => (h - 3 - ((val - mn) / rng) * (h - 6)).toFixed(1)
  const pts = v.map((val, i) => `${px(i)},${py(val)}`).join(' ')
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="block mt-1">
    <polygon points="0,${h} ${pts} ${w},${h}" fill="${hex}" opacity="0.08"/>
    <polyline points="${pts}" fill="none" stroke="${hex}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${w}" cy="${py(v[v.length - 1])}" r="2.6" fill="${hex}"/></svg>`
}

// Ad Soyad → iki harf (avatar)
export function basHarf(ad) {
  const p = (ad || '?').trim().split(/\s+/).filter(Boolean)
  const h = (p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')
  return (h || '?').toLocaleUpperCase('tr-TR')
}

// Renkli avatar dairesi (baş harfli)
export function avatar(ad, boyut = 'w-10 h-10') {
  return `<div class="${boyut} rounded-full bg-primary-fixed text-primary flex items-center justify-center font-bold shrink-0">${basHarf(ad)}</div>`
}

// Boş durum kutusu
// Boş ekranlar — marka illüstrasyonu (boş tepsi + anahtar) + metin. Görsel
// yüklenmezse (eski önbellek / yol) ikon fallback devreye girer.
export function bosDurum(metin, ikon = 'inbox') {
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant custom-shadow flex flex-col items-center gap-3">
    <img src="img/bos-durum.png" alt="" class="w-28 h-28 object-contain select-none pointer-events-none"
      onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'material-symbols-outlined text-3xl opacity-60',textContent:'${ikon}'}))" />
    <span class="text-body-md">${kacis(metin)}</span></div>`
}

// Uyarı kutusu
export function uyari(metin) {
  return `<div class="bg-error-container text-on-error-container border border-error/20 rounded-xl p-4">${metin}</div>`
}

// Filtre çipleri (Stitch pill) — ops: [[key,label],...]; #filtreler'e basılır, tıklama çağıran tarafta
//   opt.ad   → data-* adı (varsayılan 'f' → data-f). Aynı sayfada birden çok
//              çip grubu varsa (ör. tür filtresi + vade seçimi) ayrıştırır.
//   opt.koyu → BORDO zemin üstünde kullanılacak varyant. Açık zemindeki
//              varyantla aynı ölçü/köşe/geçiş; yalnız kontrast döner.
//              (Ayrı bir çip bileşeni TÜRETME — iki varyant da burada.)
export function cipler(ops, aktif, opt = {}) {
  const ad = opt.ad || 'f'
  return ops.map(([k, l]) => {
    const a = k === aktif
    const cls = opt.koyu
      ? (a ? 'bg-white text-primary shadow-sm' : 'bg-white/10 border border-white/30 text-white/85 hover:bg-white/20')
      : (a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary')
    return `<button type="button" data-${ad}="${kacis(k)}" aria-pressed="${a}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${cls}">${kacis(l)}</button>`
  }).join('')
}

// ---------------------------------------------------------------------
// Kart içi etiket/değer alanı — TEK KAYNAK. stitchTablo'nun mobil kartında
// kullanılan tipografiyle BİREBİR aynı; böylece elle yazılan kartlar da
// (teklif kartı vb.) aynı görsel dili konuşur.
// ⚠️ `deger` HAM HTML basılır (biçimlendirilmiş sayı/rozet gelebilsin diye).
//    Kullanıcı/DB metnini geçirirken kacis() ÇAĞIRANIN görevidir.
// ---------------------------------------------------------------------
export function kartAlan(etiket, deger, alt = '') {
  return `<div class="min-w-0">
    <div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${kacis(etiket)}</div>
    <div class="text-body-md break-words tabular-nums">${deger}</div>
    ${alt ? `<div class="text-[11px] text-on-surface-variant">${kacis(alt)}</div>` : ''}
  </div>`
}

// ---------------------------------------------------------------------
// Toast (geçici bildirim) — TEK KAYNAK. body'ye eklenir, sayfa yeniden
// çizilse de kaybolmaz. Aynı anda birden çok toast üst üste binmesin diye
// bir önceki kaldırılır.
// ⚠️ Sayfa içi kopyaları (fiyatlama.js · havuz.js · web-iletisim.js) buraya
//    taşınmalı — yeni sayfalar KENDİ toast'ını YAZMASIN.
// ---------------------------------------------------------------------
let _toastEl = null
export function toast(metin, basari = true) {
  if (_toastEl) _toastEl.remove()
  const t = document.createElement('div')
  // ⚠️ z-[10000]: Sohbet widget'ı z-[9999]. Toast onun ALTINDA kalırsa
  //    kullanıcı hata mesajını göremez, işlem "sessizce başarısız" görünür
  //    (7 Ağu 2026, masraf ekleme). Bu sayının sohbetten BÜYÜK kalması şart.
  t.className = `fixed bottom-5 left-1/2 -translate-x-1/2 z-[10000] px-4 py-2.5 rounded-lg shadow-lg text-sm font-bold flex items-center gap-2 ${basari ? 'bg-[#065F46] text-white' : 'bg-error text-white'}`
  t.setAttribute('role', 'status')
  t.innerHTML = `${mat(basari ? 'check_circle' : 'error', 'text-[18px]')} ${kacis(metin)}`
  document.body.appendChild(t)
  _toastEl = t
  setTimeout(() => { if (t === _toastEl) _toastEl = null; t.remove() }, 3000)
}

// ---------------------------------------------------------------------
// Durum çipi — noktalı rozet. `pill()`in zengin kardeşi: soldaki renkli
// nokta durumu tek bakışta okutur (Sipariş Merkezi deseni, tek kaynağa
// taşındı). metin + kap sınıfı + nokta sınıfı.
// ---------------------------------------------------------------------
export function durumCip(metin, cls, nokta) {
  return `<span class="inline-flex items-center px-3 py-1 rounded-full ${cls} text-label-sm font-bold whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full ${nokta} mr-2"></span>${kacis(metin)}</span>`
}

// ---------------------------------------------------------------------
// Bilgi / belge kutucuğu — ikon + etiket + değer. TEK KAYNAK: satış
// dosyasındaki araç şeridi ve kredi kuyruğundaki araç kartı aynı ölçü,
// aynı köşe, aynı hizadadır. Yeni bir kutu tipi TÜRETME, buradan geçir.
//
// ⚠️ `deger` HAM HTML basılır (çağıran "—" gibi süslü bir parça verebilsin
//    diye). Kullanıcı/DB metnini geçirirken kacis() ÇAĞIRANIN görevidir.
//   opt.vurgu  → ikon kabının renk sınıfı (varsayılan: nötr)
//   opt.tikla  → verilirse <button> üretir: { veri:{yol,ad}, baslik, sinif }
//                veri anahtarları data-* olarak basılır (data-yol, data-ad).
// ---------------------------------------------------------------------
export function bilgiKutu(ikon, etiket, deger, opt = {}) {
  const govde = `<span class="w-8 h-8 rounded-lg ${opt.vurgu || 'bg-surface-container-high text-on-surface-variant'} flex items-center justify-center shrink-0">${mat(ikon, 'text-[18px]')}</span>
    <div class="min-w-0 text-left">
      <p class="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">${kacis(etiket)}</p>
      <p class="text-label-md font-bold text-on-surface truncate">${deger}</p>
    </div>`
  if (!opt.tikla) return `<div class="flex items-center gap-2 p-2">${govde}</div>`
  const veri = Object.entries(opt.tikla.veri || {}).map(([k, v]) => ` data-${k}="${kacis(v)}"`).join('')
  const sinif = opt.tikla.sinif || 'w-full flex items-center gap-2 p-2 rounded-lg hover:bg-primary-fixed/30 transition-colors cursor-pointer'
  return `<button type="button" class="${sinif}"${veri} title="${kacis(opt.tikla.baslik || etiket)}">${govde}</button>`
}

// ---------------------------------------------------------------------
// KPI kartı — TEK KAYNAK. Tüm merkez ekranları (Sipariş/Satış/…) aynı
// ölçü, aynı köşe, aynı gölge. `alt` ve `trend` seçimlik: verilmezse
// kart Sipariş Merkezi'ndeki sade hâliyle birebir aynı çıkar.
//   trend: { yuzde: 12.5, iyiMi: true }  → yeşil/kırmızı küçük değişim rozeti
// ---------------------------------------------------------------------
export function kpiKart(ikon, ikonSinif, deger, etiket, alt = '', trend = null) {
  const trendHtml = trend && trend.yuzde != null && isFinite(trend.yuzde)
    ? `<span class="inline-flex items-center gap-0.5 text-label-sm font-bold px-2 py-0.5 rounded-full ${trend.iyiMi ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'}">
         ${mat(trend.yuzde >= 0 ? 'trending_up' : 'trending_down', 'text-[14px]')}%${Math.abs(Math.round(trend.yuzde))}</span>`
    : ''
  return `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow hover:shadow-md transition-shadow">
    <div class="flex justify-between items-start mb-3">
      <div class="p-2 rounded-lg ${ikonSinif}">${mat(ikon, 'text-[22px]')}</div>
      ${trendHtml}
    </div>
    <div class="text-2xl md:text-3xl font-black text-on-surface leading-none mb-1">${deger}</div>
    <div class="text-label-sm text-on-surface-variant uppercase tracking-wide font-medium">${kacis(etiket)}</div>
    ${alt ? `<div class="text-label-sm text-on-surface-variant mt-1">${kacis(alt)}</div>` : ''}
  </div>`
}

// ---------------------------------------------------------------------
// Sekme çubuğu — alt çizgili sekmeler (arac-detay deseni, tek kaynağa
// taşındı). ops: [[kod, etiket, ikon?, rozet?], ...]
// Tıklama çağıran tarafta: `[data-sekme]` dinlenir.
// ---------------------------------------------------------------------
// ⚠️ `overflow-x-auto` KALDIRILDI, yerine `flex-wrap` (22 Ağu 2026, Göksenil:
//   "sağa doğru kaydırmalı ve yukarı aşağı ok var, bunun olmasını istemiyorum").
//   Tarayıcıda ÖLÇÜLDÜ (İlanlarımız, 9 sekme):
//     · sekmeler 1520px istiyor → 1440px'te 95px, 1280'de 255px, 1024'te 511px taşma
//     · 1180px altında AKTİF sekme tamamen ekran dışında kalıyor; ?sekme=evrak ile
//       gelen kullanıcı hangi sekmede olduğunu göremiyordu
//     · `overflow-x: auto` yazınca CSS `overflow-y`yi de OTOMATİK `auto` hesaplıyor
//       (spec: bir eksen visible değilse diğeri de auto olur). 1px'lik taşma
//       yüzünden HER genişlikte dikey kaydırma oku çıkıyordu — istenmeyen "ok" bu.
//     · Yatay çubuk ayrıca 16px yer yiyordu (offsetHeight 61 · clientHeight 45).
//   flex-wrap ölçümü: yatay taşma 0, kaydırma çubuğu yok, tüm sekmeler görünür.
export function sekmeBar(ops, aktif) {
  return `<div class="flex items-center gap-1 flex-wrap border-b border-outline-variant" role="tablist">${ops.map(([k, l, ik, rozet]) => {
    const a = k === aktif
    return `<button role="tab" aria-selected="${a}" data-sekme="${k}" class="whitespace-nowrap flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${a ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}">${ik ? mat(ik, 'text-[18px]') : ''}${kacis(l)}${rozet ? `<span class="text-[10px] font-black bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded-full">${kacis(String(rozet))}</span>` : ''}</button>`
  }).join('')}</div>`
}

// ---------------------------------------------------------------------
// Sağ yan panel (drawer) — TEK KAYNAK.
//   Ölçü / animasyon (translate-x, 200 ms) / Esc / backdrop davranışı
//   burada; sayfalar yalnız içerik doldurur. Kabuk bir kez basılır,
//   sonra şu bölgeler doldurulur:
//     #<id>BaslikMetin  başlık metni (ikon ayrı span, karışmasın diye ayrı id)
//     #<id>Ust          başlık altı sabit alan (galeri / rozet / sekme çubuğu)
//     #<id>Govde        kaydırılabilir gövde
//     #<id>Alt          sabit alt aksiyon şeridi
//
//   kok.insertAdjacentHTML('beforeend', yanPanel({ id: 'sm', baslik: '…' }))
//   yanPanelBagla('sm', () => { /* kapanınca */ })
//   yanPanelAc('sm')  ·  yanPanelKapat('sm')
// ---------------------------------------------------------------------
export function yanPanel({ id, baslik = '', ikon = '', genislik = 'sm:w-[420px]' }) {
  return `
    <div id="${id}Bg" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-[90] hidden opacity-0 transition-opacity duration-200"></div>
    <aside id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}Baslik" tabindex="-1"
      class="fixed right-0 top-0 h-full w-full ${genislik} max-w-full bg-surface-container-lowest z-[95] shadow-2xl flex flex-col hidden translate-x-full transition-transform duration-200 outline-none"
      style="transition-timing-function:cubic-bezier(.4,0,.2,1)">
      <div class="px-5 py-4 border-b border-outline-variant flex items-center justify-between gap-3 shrink-0">
        <h3 id="${id}Baslik" class="text-title-lg font-bold text-primary flex items-center gap-2 min-w-0">${ikon ? mat(ikon) : ''}<span id="${id}BaslikMetin" class="truncate">${kacis(baslik)}</span></h3>
        <button type="button" data-yanpanel-kapat="${id}" aria-label="Paneli kapat"
          class="w-9 h-9 rounded-full hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant shrink-0">${mat('close')}</button>
      </div>
      <div id="${id}Ust" class="shrink-0"></div>
      <div id="${id}Govde" class="flex-1 overflow-y-auto"></div>
      <div id="${id}Alt" class="shrink-0"></div>
    </aside>`
}

// Panelin kapanma yollarını bağlar (kapat butonu · backdrop · Esc). Bir kez çağrılır.
export function yanPanelBagla(id, kapanincaCb) {
  const panel = document.getElementById(id)
  const bg = document.getElementById(id + 'Bg')
  if (!panel || !bg) { console.error('[stitch-ui] yanPanelBagla: panel yok →', id); return }
  const kapat = () => yanPanelKapat(id, kapanincaCb)
  bg.addEventListener('click', kapat)
  document.querySelectorAll(`[data-yanpanel-kapat="${id}"]`).forEach(b => b.addEventListener('click', kapat))
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.classList.contains('translate-x-full')) kapat()
  })
}

export function yanPanelAc(id) {
  const panel = document.getElementById(id)
  const bg = document.getElementById(id + 'Bg')
  if (!panel || !bg) { console.error('[stitch-ui] yanPanelAc: panel yok →', id); return }
  bg.classList.remove('hidden'); panel.classList.remove('hidden')
  requestAnimationFrame(() => {
    bg.classList.add('opacity-100')
    panel.classList.remove('translate-x-full')
    panel.focus()
  })
}

export function yanPanelKapat(id, kapanincaCb) {
  const panel = document.getElementById(id)
  const bg = document.getElementById(id + 'Bg')
  if (!panel || !bg) return
  panel.classList.add('translate-x-full')
  bg.classList.remove('opacity-100')
  setTimeout(() => { bg.classList.add('hidden'); panel.classList.add('hidden') }, 200)
  if (typeof kapanincaCb === 'function') kapanincaCb()
}

// Sayfa başlığı (başlık + alt metin + sağ aksiyon)
export function sayfaBaslik(baslik, altMetin, sagHtml = '') {
  return `<div class="flex flex-col md:flex-row md:items-center justify-between gap-md">
    <div>
      <h2 class="text-headline-md text-primary">${kacis(baslik)}</h2>
      ${altMetin ? `<p class="text-body-md text-on-surface-variant">${kacis(altMetin)}</p>` : ''}
    </div>
    ${sagHtml ? `<div class="flex flex-wrap items-center gap-sm">${sagHtml}</div>` : ''}
  </div>`
}

// Stitch veri tablosu (bordo başlık, zebra, tıklanır satır)
//   basliklar: ['Müşteri', ...]  ·  satirlar: [{git?, hucreler:[html,...]}]
// Tablo + mobil kart görünümü.
//   Geniş ekran (md ve üstü) → klasik tablo.
//   Dar ekran (mobil)        → her satır bir kart.
// Danışmanlar sahada telefonla çalışıyor; yatay kaydırmalı tablo orada
// kullanılmıyordu. Tek bileşen olduğu için bu değişiklik stitchTablo
// kullanan TÜM sayfaları (talepler, havuz, stok, web formları…) kapsar.
export function stitchTablo(basliklar, satirlar) {
  const sonIdx = basliklar.length - 1
  // Son kolon 'sag' bayraklıysa aksiyon kolonudur (İncele/Sahiplen).
  // Tabloda sağa sabitlenir, kartta alt satıra alınır.
  const sonSabit = Array.isArray(basliklar[sonIdx]) && basliklar[sonIdx][1] === true
  const thSabit = sonSabit ? ' sticky right-0 z-20 bg-primary' : ''
  const tdSabit = sonSabit ? ' sticky right-0 z-10 yapisik-hucre' : ''
  const ad = b => (Array.isArray(b) ? b[0] : b)

  const tablo = `
    <div class="overflow-x-auto"><table class="w-full text-left zebra-table">
      <thead class="bg-primary text-white"><tr>${basliklar.map((b, i) => {
        // Başlık ya metin, ya [etiket, sagaYasli], ya [etiket, sagaYasli, thHtml].
        // 3. yuva YALNIZ tablo başlığında kullanılır (ör. sıralama düğmesi);
        // mobil kart etiketi hep `etiket` metnini gösterir — oraya HTML
        // basılsaydı kartta ham işaretleme görünürdü.
        const [baslik, sag, thHtml] = Array.isArray(b) ? b : [b, false, null]
        return `<th class="px-lg py-3 text-label-md font-medium whitespace-nowrap${sag ? ' text-right' : ''}${i === sonIdx ? thSabit : ''}">${thHtml || baslik}</th>`
      }).join('')}</tr></thead>
      <tbody class="text-body-md divide-y divide-outline-variant">${satirlar.map(s =>
        // `sinif`: satıra ek CSS (ör. rezerve araçta açık yeşil zemin). İsteğe
        // bağlı — vermeyen çağıranlar etkilenmez.
        `<tr class="${s.git ? 'tiklanir hover:bg-surface-container-low transition-colors cursor-pointer' : ''}${s.sinif ? ' ' + s.sinif : ''}"${s.git ? ` data-git="${s.git}"` : ''}>${s.hucreler.map((h, i) => `<td class="px-lg py-md align-middle${i === sonIdx ? tdSabit : ''}">${h}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`

  // Boş sayılanlar: hiç içerik, veya sadece yer tutucu tire (—, -).
  // Kartta "BÜTÇE: —" gibi satırlar bilgi taşımıyor, sadece yer kaplıyordu.
  const bosMu = h => {
    const t = String(h ?? '').replace(/<[^>]*>/g, '').trim()
    return !t || t === '—' || t === '-'
  }
  const kartlar = satirlar.map(s => {
    const h = s.hucreler
    const aksiyon = sonSabit ? h[sonIdx] : null
    const sonAlan = sonSabit ? sonIdx - 1 : sonIdx
    // 1. hücre başlık; aradakiler etiket/değer; aksiyon varsa altta.
    const alanlar = []
    for (let i = 1; i <= sonAlan; i++) {
      if (bosMu(h[i])) continue
      alanlar.push(`<div class="min-w-0">
        <div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${ad(basliklar[i])}</div>
        <div class="text-body-md break-words">${h[i]}</div>
      </div>`)
    }
    return `<div class="${s.git ? 'tiklanir cursor-pointer active:bg-surface-container-low ' : ''}bg-surface-container-lowest border border-outline-variant rounded-xl p-md space-y-3"${s.git ? ` data-git="${s.git}"` : ''}>
      <div class="text-title-md font-bold text-on-surface break-words">${h[0]}</div>
      ${alanlar.length ? `<div class="grid grid-cols-2 gap-x-3 gap-y-2">${alanlar.join('')}</div>` : ''}
      ${aksiyon && !bosMu(aksiyon) ? `<div class="pt-2 border-t border-outline-variant flex justify-end">${aksiyon}</div>` : ''}
    </div>`
  }).join('')

  return `
    <div class="hidden md:block bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden custom-shadow">${tablo}</div>
    <div class="md:hidden space-y-sm">${kartlar}</div>`
}

// Tıklanır satırları bağla (a/button tıklamasında satır navigasyonunu engelle)
// Hem tablo satırlarına (tr.tiklanir) hem mobil kartlara (div.tiklanir) bağlanır.
export function tabloTikla(kokEl) {
  kokEl.querySelectorAll('.tiklanir[data-git]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('a,button')) return
    location.href = el.dataset.git
  }))
}

// ---------------------------------------------------------------------
// Panoya kopyalama — TEK KAYNAK.
// Daha önce kredi-hesaplama.js · ilan-gorsel-pencere.js · admin.js içinde
// üç ayrı kopyası vardı (arac-detay/arac-kart da elle yazıyordu). Birleşti.
//
// ⚠️ navigator.clipboard YALNIZ secure context'te (https / localhost) var.
//    http üzerinden açıldığında undefined gelir → execCommand yedeği şart.
// ⚠️ Sessiz catch YOK (CLAUDE.md §5.4): her başarısızlık konsola düşer.
//
// @param {string} metin        panoya yazılacak metin
// @param {HTMLElement} [btn]   verilirse butona geri bildirim basılır ve
//                              1,8 sn sonra eski içerik geri gelir
// @returns {Promise<boolean>}  kopyalandı mı (çağıran kendi toast'ını basabilir)
// ---------------------------------------------------------------------
const _panoEski = new WeakMap()   // btn → orijinal innerHTML
const _panoSaat = new WeakMap()   // btn → geri alma zamanlayıcısı

export async function panoyaYaz(metin, btn) {
  let ok = false
  const yazi = String(metin ?? '')

  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(yazi); ok = true }
    catch (e) { console.error('[pano] clipboard API başarısız, yedek yola geçiliyor', e) }
  }

  if (!ok) {
    try {
      const ta = document.createElement('textarea')
      ta.value = yazi
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      ta.remove()
      if (!ok) console.error('[pano] yedek kopyalama false döndü')
    } catch (e) {
      console.error('[pano] yedek kopyalama hatası', e)
      ok = false
    }
  }

  if (btn) {
    // Hızlı ardışık tıklamada "✓ Kopyalandı" kalıcı yazı olmasın: orijinal
    // içerik ilk tıklamada saklanır, sonrakiler onu ezmez.
    if (!_panoEski.has(btn)) _panoEski.set(btn, btn.innerHTML)
    clearTimeout(_panoSaat.get(btn))
    btn.innerHTML = ok ? '✓ Kopyalandı' : 'Kopyalanamadı'
    _panoSaat.set(btn, setTimeout(() => {
      btn.innerHTML = _panoEski.get(btn)
      _panoEski.delete(btn); _panoSaat.delete(btn)
    }, 1800))
  }

  return ok
}
