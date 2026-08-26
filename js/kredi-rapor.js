// =====================================================================
// kredi-rapor.js — Kredi raporu (yönetici + kredi birimi sorumlusu)
//
// E-tabloda her ay için ELLE kurulan iki tablo + pasta grafikler vardı.
// Burada aynı çıktı sorgudan üretiliyor; "yanlış sütun seçme" gibi bir
// hata mümkün değil (Ağustos'taki 744 rakamı öyle bir hataydı).
//
// ÖLÇÜM TANIMLARI:
//   başvuru     = o kuruma çip dokunulmuş dosya (satır varsa başvurulmuş)
//   onay        = onay + kısmi onay + kullandırıldı + pasif
//                 (pasif de bir onaydı — başka kurum kullanıldığı için düştü)
//   kullandırım = kullandırıldı
//   onay oranı        = onay / başvuru
//   kullandırım oranı = kullandırıldı / onay
//
// Kullandırılmayan onay = hâlâ 'onay'/'kısmi onay' duran satırlar. Pasif
// olanlar buraya girmez; e-tabloda elle pasife çekmenin amacı da buydu.
// =====================================================================
import { supabase } from './supabase-client.js'
import { BANKALAR, RED_NEDENLERI, kacis, fmtPara, danismanMap, danismanAdi } from './veri.js'
import { mat } from './stitch-ui.js'

let benim = null
let tumVeri = []
let grafikler = {}
let dmap = {}
let dosyaArama = ''

const ONAYLI_SAYILAN = ['onay', 'kismi_onay', 'kullandirildi', 'pasif']

// Otosor'da kullandirim tutari = satis beyani (is kurali). Diger bankalarda
// onaylanan/kullandirilan tutar. Tum kullandirim toplamlari bunu kullanir.
const kullTutar = s => Number(s.banka === 'Otosor' ? (s.satis_beyani ?? s.tutar) : s.tutar) || 0

// Profesyonel, marka uyumlu kategorik palet (bordo → altın → yeşil → teal → arduvaz).
// 12 kurum bu sırayla renklenir; birbirine yakın ama ayırt edilebilir tonlar.
const PALET = ['#5f1818', '#8f2d3b', '#b0434e', '#c86f5f', '#d99a6c', '#e3c07a',
               '#7fa25c', '#4f9d69', '#2f8f83', '#3a7ca5', '#5b6b8c', '#8a8f9c']
// Anlamsal durum renkleri — grafik/rozet/tabloda TUTARLI kullanılır.
const C_ONAY = '#2e7d4f', C_KULLANDIRIM = '#c98a1e', C_RED = '#c0392b',
      C_BEKLEYEN = '#e0a83e', C_BASVURU = '#94a3b8'

// Chart.js ortak stil: okunur ızgara, nokta-stil lejant, para/yüzde tooltip'i.
const IZGARA = 'rgba(100,100,110,.10)'
function lejant(pos = 'bottom') {
  return { position: pos, labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } }
}
function yuzdeToolTip() {
  return { callbacks: { label: c => {
    const t = c.dataset.data.reduce((a, b) => a + b, 0)
    return ` ${c.label}: ${c.parsed} (${t ? Math.round(c.parsed / t * 100) : 0}%)`
  } } }
}

export async function krediRaporKur(danisman) {
  benim = danisman
  dmap = await danismanMap()
  const ara = document.getElementById('dosyaArama')
  if (ara) ara.addEventListener('input', e => {
    dosyaArama = e.target.value.trim().toLocaleLowerCase('tr')
    dosyaListeCiz(seciliVeri())
  })
  const { data, error } = await supabase.from('kredi_basvurulari')
    .select('id, created_at, durum, kredi_personeli_id, gonderen_id, musteri_ad_soyad, arac_ozet, telefon, '
      + 'kredi_banka_sonuclari(banka, sonuc, tutar, satis_beyani, onay_tarihi), '
      + 'kredi_basvuru_gizli(red_nedeni, red_yorum)')
  if (error) {
    document.getElementById('ozet').innerHTML =
      `<div class="bg-error-container text-on-error-container border border-error/20 rounded-xl p-4">Rapor okunamadı: ${kacis(error.message)}</div>`
    return
  }
  tumVeri = data || []
  ayFiltresiKur()
  ciz()
}

function ayAnahtar(ts) { return (ts || '').slice(0, 7) }      // 2026-07
function ayEtiket(a) {
  const [y, m] = a.split('-')
  const adlar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']
  return `${adlar[Number(m) - 1]} ${y}`
}

function ayFiltresiKur() {
  const aylar = [...new Set(tumVeri.map(b => ayAnahtar(b.created_at)))].sort().reverse()
  const sel = document.getElementById('ayFiltre')
  sel.innerHTML = `<option value="">Tüm zamanlar</option>`
    + aylar.map(a => `<option value="${a}">${ayEtiket(a)}</option>`).join('')
  sel.value = aylar[0] || ''
  sel.addEventListener('change', ciz)
}

function seciliVeri() {
  const ay = document.getElementById('ayFiltre').value
  return ay ? tumVeri.filter(b => ayAnahtar(b.created_at) === ay) : tumVeri
}

function ciz() {
  const veri = seciliVeri()
  const satirlar = veri.flatMap(b => (b.kredi_banka_sonuclari || []))

  // Kurum bazında sayım
  const kurum = {}
  const bosKurum = () => ({ basvuru: 0, onay: 0, ret: 0, kullandirim: 0, bekleyen: 0, tutar: 0, bekleyenTutar: 0 })
  for (const banka of BANKALAR) kurum[banka] = bosKurum()
  for (const s of satirlar) {
    const k = (kurum[s.banka] ||= bosKurum())
    k.basvuru++
    if (ONAYLI_SAYILAN.includes(s.sonuc)) k.onay++
    if (s.sonuc === 'ret') k.ret++
    // Tutar yalnizca gerceklesen kullandirimda toplanir; onay tutarlarini
    // buraya katmak ciroyu oldugundan buyuk gosterir.
    if (s.sonuc === 'kullandirildi') { k.kullandirim++; k.tutar += kullTutar(s) }
    if (s.sonuc === 'onay' || s.sonuc === 'kismi_onay') { k.bekleyen++; k.bekleyenTutar += Number(s.tutar) || 0 }
  }

  const toplam = Object.values(kurum).reduce((a, k) => ({
    basvuru: a.basvuru + k.basvuru, onay: a.onay + k.onay,
    ret: a.ret + k.ret, kullandirim: a.kullandirim + k.kullandirim,
    bekleyen: a.bekleyen + k.bekleyen,
    tutar: a.tutar + k.tutar, bekleyenTutar: a.bekleyenTutar + k.bekleyenTutar,
  }), { basvuru: 0, onay: 0, ret: 0, kullandirim: 0, bekleyen: 0, tutar: 0, bekleyenTutar: 0 })

  ozetCiz(veri.length, toplam)
  huniCiz(veri)
  heatmapCiz()
  kurumTabloCiz(kurum, toplam)
  pastaCiz('grafikKullandirim', kurum, 'kullandirim')
  pastaCiz('grafikOnay', kurum, 'bekleyen')
  personelTabloCiz(veri)
  dosyaListeCiz(veri)
  redTabloCiz(veri)
  aylikCiz()
}

// Aylar arası karşılaştırma — ay filtresinden BAĞIMSIZ, tüm dönemler.
// E-tabloda her ay için ayrı tablo+grafik elle kuruluyordu; buradaki
// tek grafik hepsinin yerine geçer ve trendi görünür kılar.
function aylikCiz() {
  const el = document.getElementById('grafikAylik')
  if (!el || typeof Chart === 'undefined') return
  grafikler.aylik?.destroy()

  const ay = {}
  for (const b of tumVeri) {
    const a = ayAnahtar(b.created_at)
    const k = (ay[a] ||= { basvuru: 0, onay: 0, kullandirim: 0, ret: 0 })
    for (const s of (b.kredi_banka_sonuclari || [])) {
      k.basvuru++
      if (ONAYLI_SAYILAN.includes(s.sonuc)) k.onay++
      if (s.sonuc === 'kullandirildi') k.kullandirim++
      if (s.sonuc === 'ret') k.ret++
    }
  }
  const aylar = Object.keys(ay).sort()
  if (!aylar.length) return

  const ds = (label, key, renk) => ({
    label, data: aylar.map(a => ay[a][key]), backgroundColor: renk,
    borderRadius: 5, borderSkipped: false, maxBarThickness: 34,
  })
  grafikler.aylik = new Chart(el, {
    type: 'bar',
    data: {
      labels: aylar.map(ayEtiket),
      datasets: [
        ds('Başvuru', 'basvuru', C_BASVURU),
        ds('Onay', 'onay', C_ONAY),
        ds('Kullandırım', 'kullandirim', C_KULLANDIRIM),
        ds('Red', 'ret', C_RED),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } }, grid: { color: IZGARA } },
      },
      plugins: {
        legend: lejant('bottom'),
        tooltip: { padding: 10, boxPadding: 4, usePointStyle: true },
      },
    },
  })
}

const yuzde = (a, b) => b ? Math.round(a / b * 100) : 0

function ozetCiz(dosya, t) {
  // renk = anlamsal HEX; ikon çipi %10 alfa arkaplan + tam renk ikon.
  const kart = (ikon, renk, sayi, etiket, alt = '', vurgu = false) => `
    <div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex flex-col gap-3 ${vurgu ? 'ring-1 ring-primary/20' : ''}">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">${etiket}</span>
        <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background:${renk}1f;color:${renk}">${mat(ikon, 'text-[20px]')}</span>
      </div>
      <p class="text-headline-md font-bold leading-none ${vurgu ? 'text-primary' : 'text-on-surface'}">${sayi}</p>
      <p class="text-label-sm text-on-surface-variant leading-tight">${alt || '&nbsp;'}</p>
    </div>`
  document.getElementById('ozet').innerHTML = `
    <section class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-gutter">
      ${kart('folder_open', C_BASVURU, dosya, 'Dosya', 'toplam kayıt')}
      ${kart('send', '#3a7ca5', t.basvuru, 'Kuruma başvuru', 'çip dokunuşu')}
      ${kart('verified', C_ONAY, t.onay, 'Onay', '%' + yuzde(t.onay, t.basvuru) + ' onay oranı')}
      ${kart('paid', C_KULLANDIRIM, t.kullandirim, 'Kullandırım', '%' + yuzde(t.kullandirim, t.onay) + ' kullandırım oranı')}
      ${kart('account_balance_wallet', '#5f1818', fmtPara(t.tutar), 'Kullandırılan tutar', t.tutar ? 'gerçekleşen ciro' : 'tutar girilmemiş', true)}
      ${kart('hourglass_top', C_BEKLEYEN, t.bekleyen, 'Onaylı, kullanılmamış', t.bekleyenTutar ? fmtPara(t.bekleyenTutar) + ' masada' : 'takip edilmeli')}
    </section>`
}

// Dönüşüm hunisi — dosya başına yol (başvuru → onay → kullandırım → sonlandırma)
function huniCiz(veri) {
  const el = document.getElementById('huni'); if (!el) return
  const toplam = veri.length
  const bir = pred => veri.filter(b => (b.kredi_banka_sonuclari || []).some(pred)).length
  const asamalar = [
    ['Toplam Dosya', toplam, '#3a7ca5'],
    ['Onay Alan', bir(s => ONAYLI_SAYILAN.includes(s.sonuc)), C_ONAY],
    ['Kullandırılan', bir(s => s.sonuc === 'kullandirildi'), C_KULLANDIRIM],
    ['Sonlandırılan', veri.filter(b => b.durum === 'sonlandirildi').length, '#5f1818'],
  ]
  if (!toplam) { el.innerHTML = '<p class="text-body-md text-on-surface-variant">Bu dönemde dosya yok.</p>'; return }
  el.innerHTML = asamalar.map(([ad, n, renk]) => {
    const y = Math.round(n / toplam * 100)
    return `<div class="mb-3">
      <div class="flex justify-between text-label-md mb-1"><span class="font-bold text-on-surface">${ad}</span><span class="text-on-surface-variant tabular-nums">${n} · %${y}</span></div>
      <div class="h-7 rounded-lg bg-surface-container-high overflow-hidden"><div class="h-full rounded-lg flex items-center justify-end px-2 text-white text-label-sm font-bold" style="width:${Math.max(y, 8)}%;background:${renk}">${y >= 12 ? '%' + y : ''}</div></div>
    </div>`
  }).join('')
}

// Banka × ay onay oranı heatmap (tüm dönemler, son 6 ay)
function heatmapCiz() {
  const el = document.getElementById('heatmap'); if (!el) return
  const aylar = [...new Set(tumVeri.map(b => ayAnahtar(b.created_at)))].sort().slice(-6)
  const m = {}
  for (const b of tumVeri) {
    const a = ayAnahtar(b.created_at)
    for (const s of (b.kredi_banka_sonuclari || [])) {
      const g = (m[s.banka] ||= {}); const c = (g[a] ||= { b: 0, o: 0 }); c.b++; if (ONAYLI_SAYILAN.includes(s.sonuc)) c.o++
    }
  }
  const bankalar = BANKALAR.filter(bk => m[bk])
  if (!aylar.length || !bankalar.length) { el.innerHTML = '<p class="text-body-md text-on-surface-variant">Bu dönemde kayıt yok.</p>'; return }
  const renk = p => p == null ? 'bg-surface-container text-on-surface-variant' : p >= 75 ? 'bg-green-600 text-white' : p >= 50 ? 'bg-green-400 text-green-950' : p >= 25 ? 'bg-amber-300 text-amber-950' : 'bg-red-200 text-red-900'
  const adlar = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
  const ayKisa = a => adlar[Number(a.split('-')[1]) - 1]
  el.innerHTML = `<table class="w-full text-center text-label-sm border-separate" style="border-spacing:3px">
    <thead><tr><th></th>${aylar.map(a => `<th class="px-1 text-on-surface-variant font-bold">${ayKisa(a)}</th>`).join('')}</tr></thead>
    <tbody>${bankalar.map(bk => `<tr>
      <td class="text-left pr-2 font-bold whitespace-nowrap"><span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:${PALET[BANKALAR.indexOf(bk)] ?? '#8a8f9c'}"></span>${kacis(bk)}</span></td>
      ${aylar.map(a => { const c = m[bk][a]; const p = c && c.b ? Math.round(c.o / c.b * 100) : null; return `<td><div class="rounded-lg py-2 font-bold ${renk(p)}">${p == null ? '—' : '%' + p}</div></td>` }).join('')}
    </tr>`).join('')}</tbody></table>
    <div class="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-on-surface-variant"><span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-red-200"></span>0-25</span><span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-amber-300"></span>25-50</span><span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-green-400"></span>50-75</span><span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-green-600"></span>75+</span></div>`
}

function kurumTabloCiz(kurum, toplam) {
  const sirali = Object.entries(kurum).filter(([, k]) => k.basvuru > 0)
    .sort((a, b) => b[1].kullandirim - a[1].kullandirim)
  if (!sirali.length) {
    document.getElementById('kurumTablo').innerHTML =
      '<p class="text-body-md text-on-surface-variant">Bu dönemde kayıt yok.</p>'
    return
  }
  const bar = (deger, max, renk) => `
    <div class="flex items-center gap-2">
      <span class="w-8 text-right font-bold">${deger}</span>
      <div class="flex-1 min-w-[40px] h-2 bg-surface-container-high rounded-full overflow-hidden">
        <div class="h-full ${renk} rounded-full" style="width:${max ? Math.round(deger / max * 100) : 0}%"></div>
      </div>
    </div>`
  const maxB = Math.max(...sirali.map(([, k]) => k.basvuru), 1)

  document.getElementById('kurumTablo').innerHTML = `
    <div class="overflow-x-auto"><table class="w-full text-left zebra-table">
      <thead class="bg-primary text-white"><tr>
        <th class="px-lg py-3 text-label-md">Kuruluş</th>
        <th class="px-lg py-3 text-label-md">Başvuru</th>
        <th class="px-lg py-3 text-label-md text-right">Onay</th>
        <th class="px-lg py-3 text-label-md text-right">Red</th>
        <th class="px-lg py-3 text-label-md text-right">Kullandırım</th>
        <th class="px-lg py-3 text-label-md text-right">Tutar</th>
        <th class="px-lg py-3 text-label-md text-right">Onay %</th>
        <th class="px-lg py-3 text-label-md text-right">Kullandırım %</th>
        <th class="px-lg py-3 text-label-md text-right">Bekleyen</th>
      </tr></thead>
      <tbody class="text-body-md divide-y divide-outline-variant">
        ${sirali.map(([banka, k]) => `<tr class="hover:bg-surface-container-low/50 transition-colors">
          <td class="px-lg py-md font-bold"><span class="inline-flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${PALET[BANKALAR.indexOf(banka)] ?? '#8a8f9c'}"></span>${kacis(banka)}</span></td>
          <td class="px-lg py-md">${bar(k.basvuru, maxB, 'bg-primary')}</td>
          <td class="px-lg py-md text-right">${k.onay}</td>
          <td class="px-lg py-md text-right text-on-surface-variant">${k.ret}</td>
          <td class="px-lg py-md text-right font-bold text-green-800">${k.kullandirim}</td>
          <td class="px-lg py-md text-right whitespace-nowrap">${k.tutar ? fmtPara(k.tutar) : '—'}</td>
          <td class="px-lg py-md text-right">%${yuzde(k.onay, k.basvuru)}</td>
          <td class="px-lg py-md text-right">%${yuzde(k.kullandirim, k.onay)}</td>
          <td class="px-lg py-md text-right ${k.bekleyen ? 'text-amber-700 font-bold' : 'text-on-surface-variant'}">${k.bekleyen}</td>
        </tr>`).join('')}
        <tr class="bg-surface-container-low font-bold">
          <td class="px-lg py-md">TOPLAM</td>
          <td class="px-lg py-md">${toplam.basvuru}</td>
          <td class="px-lg py-md text-right">${toplam.onay}</td>
          <td class="px-lg py-md text-right">${toplam.ret}</td>
          <td class="px-lg py-md text-right text-green-800">${toplam.kullandirim}</td>
          <td class="px-lg py-md text-right whitespace-nowrap">${toplam.tutar ? fmtPara(toplam.tutar) : '—'}</td>
          <td class="px-lg py-md text-right">%${yuzde(toplam.onay, toplam.basvuru)}</td>
          <td class="px-lg py-md text-right">%${yuzde(toplam.kullandirim, toplam.onay)}</td>
          <td class="px-lg py-md text-right">${toplam.bekleyen}</td>
        </tr>
      </tbody>
    </table></div>`
}

function pastaCiz(canvasId, kurum, alan) {
  const el = document.getElementById(canvasId)
  if (!el || typeof Chart === 'undefined') return
  grafikler[canvasId]?.destroy()
  const veri = Object.entries(kurum).filter(([, k]) => k[alan] > 0)
  if (!veri.length) {
    const ctx = el.getContext('2d')
    ctx.clearRect(0, 0, el.width, el.height)
    return
  }
  // Kuruma göre renk SABİT olsun (BANKALAR sırası) → iki grafikte aynı
  // kurum aynı renk. Filtrelenince renk kaymaz.
  const renkAl = b => PALET[BANKALAR.indexOf(b)] ?? '#8a8f9c'
  grafikler[canvasId] = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: veri.map(([b]) => b),
      datasets: [{
        data: veri.map(([, k]) => k[alan]),
        backgroundColor: veri.map(([b]) => renkAl(b)),
        borderColor: '#fff', borderWidth: 2, hoverOffset: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: lejant('right'), tooltip: { padding: 10, usePointStyle: true, ...yuzdeToolTip() } },
    },
  })
}

// Kim kac dosya kapatti — kuyrukta "uzerine al" ile alinan dosyalar
// uzerinden. Hic sahiplenilmemis dosyalar ayri satirda toplanir ki
// toplam gorunurde kaybolmasin.
function personelTabloCiz(veri) {
  const say = {}
  for (const b of veri) {
    const kim = b.kredi_personeli_id || '_yok'
    const k = (say[kim] ||= { dosya: 0, basvuru: 0, onay: 0, kullandirim: 0, tutar: 0 })
    k.dosya++
    for (const s of (b.kredi_banka_sonuclari || [])) {
      k.basvuru++
      if (ONAYLI_SAYILAN.includes(s.sonuc)) k.onay++
      if (s.sonuc === 'kullandirildi') { k.kullandirim++; k.tutar += kullTutar(s) }
    }
  }
  const sirali = Object.entries(say).sort((a, b) => b[1].kullandirim - a[1].kullandirim)
  const hedef = document.getElementById('personelTablo')
  if (!hedef) return
  if (!sirali.length) {
    hedef.innerHTML = '<p class="text-body-md text-on-surface-variant">Bu dönemde kayıt yok.</p>'
    return
  }
  hedef.innerHTML = `
    <div class="overflow-x-auto"><table class="w-full text-left zebra-table">
      <thead class="bg-primary text-white"><tr>
        <th class="px-lg py-3 text-label-md">Kişi</th>
        <th class="px-lg py-3 text-label-md text-right">Dosya</th>
        <th class="px-lg py-3 text-label-md text-right">Başvuru</th>
        <th class="px-lg py-3 text-label-md text-right">Onay</th>
        <th class="px-lg py-3 text-label-md text-right">Kullandırım</th>
        <th class="px-lg py-3 text-label-md text-right">Tutar</th>
        <th class="px-lg py-3 text-label-md text-right">Dosya başı başvuru</th>
      </tr></thead>
      <tbody class="text-body-md divide-y divide-outline-variant">
        ${sirali.map(([kim, k]) => `<tr>
          <td class="px-lg py-md font-bold">${kim === '_yok'
            ? '<span class="text-on-surface-variant font-normal">Sahiplenilmemiş</span>'
            : kacis(danismanAdi(dmap, kim))}</td>
          <td class="px-lg py-md text-right">${k.dosya}</td>
          <td class="px-lg py-md text-right">${k.basvuru}</td>
          <td class="px-lg py-md text-right">${k.onay}</td>
          <td class="px-lg py-md text-right font-bold text-green-800">${k.kullandirim}</td>
          <td class="px-lg py-md text-right whitespace-nowrap">${k.tutar ? fmtPara(k.tutar) : '—'}</td>
          <td class="px-lg py-md text-right">${k.dosya ? (k.basvuru / k.dosya).toFixed(1) : '0'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`
}

// Dosya listesi — müşteri adına göre aranır, gönderen danışman görünür.
// Kredinin hangi danışmandan geldiğini raporda görme talebi (#6/#7).
function dosyaListeCiz(veri) {
  const hedef = document.getElementById('dosyaListe')
  if (!hedef) return
  let liste = veri.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  if (dosyaArama) liste = liste.filter(b =>
    (b.musteri_ad_soyad || '').toLocaleLowerCase('tr').includes(dosyaArama))

  const say = document.getElementById('dosyaSayi')
  if (say) say.textContent = `${liste.length} dosya`
  if (!liste.length) {
    hedef.innerHTML = '<p class="text-body-md text-on-surface-variant">Eşleşen dosya yok.</p>'
    return
  }
  const durumPill = s => {
    const cls = s.sonuc === 'kullandirildi' ? 'bg-yellow-200 text-yellow-950'
      : s.sonuc === 'onay' || s.sonuc === 'kismi_onay' ? 'bg-green-100 text-green-800'
      : s.sonuc === 'ret' ? 'bg-red-100 text-red-800'
      : 'bg-surface-container-high text-on-surface-variant'
    const t = s.sonuc === 'kullandirildi' ? kullTutar(s) : (Number(s.tutar) || 0)
    return `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}">${kacis(s.banka)}${t ? ' · ' + kacis(fmtPara(t)) : ''}</span>`
  }
  hedef.innerHTML = `
    <div class="overflow-x-auto"><table class="w-full text-left zebra-table">
      <thead class="bg-primary text-white"><tr>
        <th class="px-lg py-3 text-label-md">Müşteri</th>
        <th class="px-lg py-3 text-label-md">Gönderen danışman</th>
        <th class="px-lg py-3 text-label-md">Bankalar / durum</th>
        <th class="px-lg py-3 text-label-md text-right">Kullandırılan</th>
      </tr></thead>
      <tbody class="text-body-md divide-y divide-outline-variant">
        ${liste.map(b => {
          const s = (b.kredi_banka_sonuclari || []).filter(x => x.sonuc !== 'pasif')
          const kull = (b.kredi_banka_sonuclari || []).filter(x => x.sonuc === 'kullandirildi')
          const toplam = kull.reduce((a, x) => a + kullTutar(x), 0)
          return `<tr>
            <td class="px-lg py-md"><span class="font-bold">${kacis(b.musteri_ad_soyad || '—')}</span>
              <span class="block text-label-sm text-on-surface-variant">${kacis(b.telefon || '')}${b.arac_ozet ? ' · ' + kacis(b.arac_ozet) : ''}</span></td>
            <td class="px-lg py-md">${kacis(danismanAdi(dmap, b.gonderen_id))}</td>
            <td class="px-lg py-md"><div class="flex flex-wrap gap-1">${s.length ? s.map(durumPill).join('') : '<span class="text-on-surface-variant">—</span>'}</div></td>
            <td class="px-lg py-md text-right font-bold ${toplam ? 'text-green-800' : 'text-on-surface-variant'}">${toplam ? kacis(fmtPara(toplam)) : '—'}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table></div>`
}

function redTabloCiz(veri) {
  const sayac = {}
  for (const b of veri) {
    const g = b.kredi_basvuru_gizli
    const neden = Array.isArray(g) ? g[0]?.red_nedeni : g?.red_nedeni
    if (neden) sayac[neden] = (sayac[neden] || 0) + 1
  }
  const sirali = Object.entries(sayac).sort((a, b) => b[1] - a[1])
  const hedef = document.getElementById('redTablo')
  if (!sirali.length) {
    hedef.innerHTML = '<p class="text-body-md text-on-surface-variant">Bu dönemde sonlandırılmış redli dosya yok.</p>'
    return
  }
  const toplam = sirali.reduce((a, [, n]) => a + n, 0)
  const etiket = k => (RED_NEDENLERI.find(x => x[0] === k) || [])[1] || k
  hedef.innerHTML = `<div class="space-y-2.5">${sirali.map(([k, n]) => `
    <div class="flex items-center gap-3">
      <span class="w-44 sm:w-48 shrink-0 text-body-md">${kacis(etiket(k))}</span>
      <div class="flex-1 h-3.5 bg-surface-container-high rounded-full overflow-hidden">
        <div class="h-full rounded-full" style="width:${Math.round(n / toplam * 100)}%;background:${C_RED}"></div>
      </div>
      <span class="w-16 text-right font-bold tabular-nums">${n} <span class="text-on-surface-variant font-normal">%${Math.round(n / toplam * 100)}</span></span>
    </div>`).join('')}</div>`
}
