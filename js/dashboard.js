// =====================================================================
// dashboard.js — Panel (Stitch tasarımı): KPI + Son İlanlar + Son Aktiviteler
//   + Detaylı grafikler (Chart.js, bordo). Gerçek veri; görünüm Stitch.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import { DURUMLAR, KAZANILDI_DURUMLARI, kapanisMi, kaybedildiMi, danismanMap, danismanAdi, fmtPara, kacis, bugunISO } from './veri.js'
import { sparkline } from './stitch-ui.js'

const BORDO = '#5f1818', renkler = [
  '#5f1818', '#3b82f6', '#16a34a', '#c2650f', '#8a2836', '#0891b2',
  '#9333ea', '#64748b', '#b3261e', '#0f766e', '#a16207',
]
let grafikler = []

function mat(ad, ekstra = '') { return `<span class="material-symbols-outlined${ekstra ? ' ' + ekstra : ''}">${ad}</span>` }
const KPI_RENK = {
  bordo: 'bg-primary-fixed text-primary', mavi: 'bg-blue-100 text-blue-700',
  yesil: 'bg-secondary-container text-on-secondary-container', turuncu: 'bg-orange-100 text-orange-700',
}
function gecenSureKisa(ts) {
  const dk = (Date.now() - new Date(ts).getTime()) / 60000
  if (dk < 1) return 'az önce'
  if (dk < 60) return Math.floor(dk) + ' dk önce'
  if (dk < 1440) return Math.floor(dk / 60) + ' saat önce'
  const g = Math.floor(dk / 1440)
  return g === 1 ? 'dün' : g + ' gün önce'
}

export async function dashboardKur() {
  document.getElementById('yenile')?.addEventListener('click', yukle)
  await yukle()
}

async function yukle() {
  const dmap = await danismanMap()

  const [araclarR, notlar, aktiviteR, talepCount, wSatis, wTakas, wIletisim, degerleme, gunlukR, trendR, ozetR, satisOzetR] = await Promise.all([
    siteDb.from('araclar').select('id, marka, model, versiyon, yil, yakit, fiyat, durum, fotolar, satildi_tarih, eklendi'),
    supabase.from('gorusme_notlari').select('gorusme_notu, musteri_durumu, sahip_danisman_id, acan_id, acilis_notu, sonraki_adim_tarihi, created_at, talep_id'),
    supabase.from('gorusme_notlari').select('id, musteri_ad_soyad, acan_id, sahip_danisman_id, musteri_durumu, created_at, talep_id, talepler(marka,model)').order('created_at', { ascending: false }).limit(8),
    supabase.from('talepler').select('*', { count: 'exact', head: true }),
    supabase.from('web_satis').select('durum'),
    supabase.from('web_takas').select('durum'),
    supabase.from('web_iletisim').select('durum'),
    // degerleme_talepleri SİTE veritabanında yaşıyor (bkz. degerleme.js).
    // Burada CRM db'sinden okunuyordu → tablo yok, sorgu sessizce hata dönüyor,
    // "Web Talepleri" grafiğindeki Değerleme çubuğu HER ZAMAN 0 görünüyordu.
    siteDb.from('degerleme_talepleri').select('durum'),
    supabase.from('gunluk_ozet').select('tarih, havuz, aktif, yeni_talep').order('tarih', { ascending: true }).limit(60),
    supabase.rpc('anasayfa_aylik_trend'),
    supabase.rpc('gunluk_ozet_al'),
    supabase.rpc('satis_ozet_kredi'),   // GÜNCEL sheet satışları (kredili/nakit)
  ])

  if (notlar.error) {
    document.getElementById('uyari').innerHTML =
      `<div class="bg-error-container text-on-error-container border border-error/20 rounded-xl p-4">Veri okunamadı: ${kacis(notlar.error.message)} (Yalnızca yönetici tüm veriyi görebilir.)</div>`
  }

  const araclar = araclarR.data || []
  const notData = notlar.data || []

  // --- KPI ---
  const aktifStok = araclar.filter(a => (a.durum || 'aktif') !== 'satildi').length
  const now = new Date(), ayBasi = new Date(now.getFullYear(), now.getMonth(), 1)
  // Gerçek satış GÜNCEL sheet'ten (guncel_satislar) gelir; SITE araclar tablosu
  // güncel stok olduğu için satılanları saymaz (hep 0 çıkardı). RPC boşsa stok
  // tabanlı eski sayıya düş.
  const buAySatilanStok = araclar.filter(a => a.durum === 'satildi' && a.satildi_tarih && new Date(a.satildi_tarih) >= ayBasi).length
  const buAySatilan = satisOzetR.data?.[0]?.bu_ay ?? buAySatilanStok
  // havuz/aktif = sunucu RPC (tekil talep, 1000-limitinden etkilenmez) — Ana Sayfa ile aynı
  const ozet = ozetR.data || {}
  const havuz = ozet.havuz ?? notData.filter(n => !n.sahip_danisman_id).length
  const aktifIs = ozet.aktif ?? notData.filter(n => n.sahip_danisman_id && !kapanisMi(n.musteri_durumu)).length
  const gunluk = gunlukR.data || []
  const seri = key => gunluk.map(g => g[key])
  kpiCiz([
    { sayi: aktifStok, birim: 'Araç', etiket: 'Aktif Stok', ikon: 'directions_car', renk: 'bordo' },
    { sayi: havuz, birim: 'Talep', etiket: 'Havuzda Bekleyen', ikon: 'person_add', renk: 'mavi', seri: seri('yeni_talep') },
    { sayi: buAySatilan, birim: 'Adet', etiket: 'Bu Ay Satılan', ikon: 'payments', renk: 'yesil' },
    { sayi: aktifIs, birim: 'İş', etiket: 'Aktif İş', ikon: 'work', renk: 'turuncu', seri: seri('aktif') },
  ])
  satisKpiCiz(satisOzetR.data?.[0])

  // Tüm grafikleri ÖNCE sıfırla (yoksa aşağıda yeniden çizilenler bunları siler)
  grafikler.forEach(g => g.destroy()); grafikler = []
  // --- 12 ay trend + Stok analizi + İşletme sağlığı (yeni) ---
  trendCiz(trendR.data || [])
  const stokAn = stokAnaliziCiz(araclar)
  saglikSkoruCiz({ aktifStok, buAySatilan, havuz, aktifIs, yasli: stokAn.yasli60, notData })

  // --- Son İlanlar (en yeni araçlar) ---
  sonIlanlarCiz(araclar)

  // --- Son Aktiviteler ---
  sonAktiviteCiz(aktiviteR.data || [], dmap)

  // --- Danışman Not Karnesi (şimdilik gizli — istenirse geri açılır) ---
  // notKarneCiz(notData, dmap)

  // --- Alt grafikler (durum / yük / web / satış) ---
  cizBar('grafikDurum', DURUMLAR, DURUMLAR.map(d => notData.filter(n => n.musteri_durumu === d).length), 'İş sayısı', true)

  const yuk = {}
  for (const n of notData) if (n.sahip_danisman_id && !kapanisMi(n.musteri_durumu)) yuk[n.sahip_danisman_id] = (yuk[n.sahip_danisman_id] || 0) + 1
  const yukIds = Object.keys(yuk).sort((a, b) => yuk[b] - yuk[a])
  cizBar('grafikYuk', yukIds.map(id => danismanAdi(dmap, id)), yukIds.map(id => yuk[id]), 'Aktif iş', false)

  cizBar('grafikWeb', ['Satış', 'Takas', 'İletişim', 'Değerleme'],
    [(wSatis.data || []).length, (wTakas.data || []).length, (wIletisim.data || []).length, (degerleme.data || []).length], 'Toplam kayıt', false)

  const say = (arr, deger) => (arr.data || []).filter(r => r.durum === deger).length
  const wsDurumlar = ['YENİ', 'İLETİŞİME GEÇİLDİ', 'DEĞERLENDİRİLDİ', 'ALINDI', 'VAZGEÇİLDİ']
  cizPasta('grafikSatis', wsDurumlar, wsDurumlar.map(d => say(wSatis, d)))

  huniCiz(notData)
}

// --- KPI kartları (ikon çipi + sparkline + hover-lift) ---
const KPI_HEX = { bordo: '#5f1818', mavi: '#3a7ca5', yesil: '#2e7d4f', turuncu: '#c98a1e' }
function kpiCiz(kartlar) {
  document.getElementById('kpi').innerHTML = kartlar.map(k => {
    const hex = KPI_HEX[k.renk] || KPI_HEX.bordo
    return `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow kart-hover flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">${kacis(k.etiket)}</span>
        <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background:${hex}1f;color:${hex}">${mat(k.ikon, 'text-[20px]')}</span>
      </div>
      <p class="text-headline-md font-bold leading-none text-on-surface">${k.sayi} <span class="text-label-md font-normal text-on-surface-variant">${kacis(k.birim || '')}</span></p>
      ${k.seri ? sparkline(k.seri, hex) : '<div style="height:30px"></div>'}
    </div>`
  }).join('')
}

// --- Satış KPI (GÜNCEL sheet — güvenilir satış kaynağı) ---
function satisKpiCiz(so) {
  const bol = document.getElementById('satisBolum'); if (!bol) return
  if (!so || (so.toplam || 0) === 0) { bol.classList.add('hidden'); return }
  bol.classList.remove('hidden')
  const kart = (etiket, sayi, birim, ikon, hex, alt) => `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow kart-hover flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">${etiket}</span>
      <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background:${hex}1f;color:${hex}">${mat(ikon, 'text-[20px]')}</span>
    </div>
    <p class="text-headline-md font-bold leading-none text-on-surface">${sayi} <span class="text-label-md font-normal text-on-surface-variant">${birim || ''}</span></p>
    ${alt ? `<p class="text-[11px] text-on-surface-variant">${alt}</p>` : '<div style="height:16px"></div>'}
  </div>`
  document.getElementById('satisKpi').innerHTML =
    kart('Bugün Satılan', so.bugun || 0, 'Adet', 'today', '#2e7d4f', '') +
    kart('Bu Ay Satılan', so.bu_ay || 0, 'Adet', 'sell', '#5f1818', `Kredili ${so.bu_ay_kredili || 0} · Nakit ${so.bu_ay_nakit || 0}`) +
    kart('Bu Ay Kredili Satış', so.bu_ay_kredili || 0, 'Adet', 'credit_score', '#3a7ca5', 'Kullandırılan kredi ile') +
    kart('Bu Ay Ciro', fmtPara(so.bu_ay_ciro), '', 'payments', '#c98a1e', '')
}

// --- 12 ay trend (Talep · Satış · Kayıp) ---
function trendCiz(trend) {
  const el = document.getElementById('grafikTrend'); if (!el || !window.Chart || !trend.length) return
  const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
  const etk = a => { const [y, m] = a.split('-'); return AY[+m - 1] + ' ' + y.slice(2) }
  const ds = (l, k, c, f) => ({ label: l, data: trend.map(t => t[k]), borderColor: c, backgroundColor: f, fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 })
  grafikler.push(new Chart(el, {
    type: 'line',
    data: { labels: trend.map(t => etk(t.ay)), datasets: [
      ds('Talep', 'talep', '#3a7ca5', 'rgba(58,124,165,.08)'),
      ds('Satış', 'satis', '#2e7d4f', 'rgba(46,125,79,.12)'),
      ds('Kayıp', 'kayip', '#c0392b', 'rgba(192,57,43,.07)'),
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { beginAtZero: true, grid: { color: 'rgba(100,100,110,.10)' }, ticks: { precision: 0, font: { size: 11 } } } },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 9, padding: 14, font: { size: 12 } } }, tooltip: { padding: 10, usePointStyle: true } },
    },
  }))
}

// --- Stok analizi: marka / yakıt / fiyat bandı + ort. model yılı ---
function stokAnaliziCiz(araclar) {
  const aktif = araclar.filter(a => (a.durum || 'aktif') !== 'satildi')
  const marka = {}; aktif.forEach(a => { const m = (a.marka || 'Diğer').trim() || 'Diğer'; marka[m] = (marka[m] || 0) + 1 })
  const mSir = Object.entries(marka).sort((a, b) => b[1] - a[1]).slice(0, 8)
  cizBar('grafikMarka', mSir.map(x => x[0]), mSir.map(x => x[1]), 'Araç', true)

  const yakit = {}; aktif.forEach(a => { const y = (a.yakit || 'Bilinmiyor').trim() || 'Bilinmiyor'; yakit[y] = (yakit[y] || 0) + 1 })
  const ySir = Object.entries(yakit).sort((a, b) => b[1] - a[1])
  cizPasta('grafikYakit', ySir.map(x => x[0]), ySir.map(x => x[1]))

  const bant = [['0-500B', 0, 500000], ['500B-1M', 500000, 1000000], ['1-2M', 1000000, 2000000], ['2M+', 2000000, Infinity]]
  cizBar('grafikFiyat', bant.map(b => b[0]), bant.map(([, lo, hi]) => aktif.filter(a => { const f = Number(a.fiyat) || 0; return f >= lo && f < hi }).length), 'Araç', false)

  const yillar = aktif.map(a => Number(a.yil)).filter(y => y > 1990 && y < 2035)
  const ortYil = yillar.length ? Math.round(yillar.reduce((a, b) => a + b, 0) / yillar.length) : null
  const ozet = document.getElementById('stokOzet')
  if (ozet) ozet.textContent = `— ${aktif.length} aktif araç${ortYil ? ` · ort. model yılı ${ortYil}` : ''}`
  return { yasli60: 0 }   // gerçek stok yaşı DMS'te; site 'eklendi' kazınma tarihi
}

// --- İşletme Sağlığı skoru (kural-tabanlı gösterge) ---
function saglikSkoruCiz(d) {
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)))
  const gercek = (d.notData || []).filter(n => !n.acilis_notu)
  const dolu = gercek.filter(n => (n.gorusme_notu || '').trim()).length
  const kalemler = [
    { ad: 'Satış momentumu', p: clamp(d.buAySatilan * 10) },
    { ad: 'Talep takibi', p: clamp(100 - (d.havuz + d.aktifIs) / 25) },
    { ad: 'Stok derinliği', p: clamp(d.aktifStok / 1.6) },
    { ad: 'Veri disiplini', p: gercek.length ? clamp(dolu / gercek.length * 100) : 50 },
  ]
  const genel = Math.round(kalemler.reduce((a, k) => a + k.p, 0) / kalemler.length)
  const renk = p => p >= 75 ? '#2e7d4f' : p >= 55 ? '#c98a1e' : '#c0392b'
  const nokta = p => p >= 75 ? '🟢' : p >= 55 ? '🟡' : '🔴'
  const hedef = document.getElementById('saglikSkor'); if (!hedef) return
  hedef.innerHTML = `
    <div class="flex items-end gap-2 mb-4">
      <span class="text-[44px] leading-none font-bold" style="color:${renk(genel)}">${genel}</span>
      <span class="text-label-md text-on-surface-variant mb-1.5">/ 100 genel</span>
    </div>
    <div class="space-y-3">${kalemler.map(k => `
      <div>
        <div class="flex justify-between text-label-md mb-1"><span>${nokta(k.p)} ${k.ad}</span><span class="font-bold tabular-nums">${k.p}</span></div>
        <div class="h-2 bg-surface-container-high rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${k.p}%;background:${renk(k.p)}"></div></div>
      </div>`).join('')}</div>
    <p class="text-[11px] text-on-surface-variant mt-4">Kural-tabanlı gösterge — kesin mali ölçüm değil, genel gidişat.</p>`
}

// --- Son İlanlar (foto-kart) ---
function sonIlanlarCiz(araclar) {
  const hedef = document.getElementById('sonIlanlar')
  const yeni = [...araclar].sort((a, b) => (b.eklendi || '').localeCompare(a.eklendi || '')).slice(0, 6)
  if (!yeni.length) { hedef.innerHTML = '<div class="p-lg text-on-surface-variant text-center">Araç bulunamadı.</div>'; return }
  hedef.innerHTML = `<div class="p-lg grid grid-cols-1 sm:grid-cols-2 gap-gutter">
    ${yeni.map(a => {
      const foto = (a.fotolar || '').split(',')[0]?.trim()
      const satildi = a.durum === 'satildi'
      return `<a href="stok-arac.html?ref=${encodeURIComponent(a.id)}" class="block bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden kart-hover">
        <div class="aspect-[16/10] bg-surface-container-highest overflow-hidden relative">
          ${foto ? `<img src="${kacis(foto)}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.parentElement.querySelector('.yedek').style.display='flex'">` : ''}
          <div class="yedek w-full h-full items-center justify-center text-on-surface-variant" style="display:${foto ? 'none' : 'flex'}">${mat('directions_car', 'text-4xl opacity-40')}</div>
          <span class="absolute top-2 left-2 px-2.5 py-1 rounded-full text-[11px] font-bold ${satildi ? 'bg-green-600 text-white' : 'bg-white/90 text-primary'}">${satildi ? 'Satıldı' : 'Yayında'}</span>
        </div>
        <div class="p-3">
          <p class="font-bold text-on-surface truncate">${kacis([a.marka, a.model].filter(Boolean).join(' '))}</p>
          <p class="text-label-sm text-on-surface-variant">${kacis(a.yil) || ''}${a.yakit ? ' · ' + kacis(a.yakit) : ''}</p>
          <p class="text-title-md text-primary font-bold mt-1">${fmtPara(a.fiyat)}</p>
        </div></a>`
    }).join('')}</div>`
}

// --- Son Aktiviteler (Stitch timeline, gerçek görüşmeler) ---
function sonAktiviteCiz(notlar, dmap = {}) {
  const hedef = document.getElementById('sonAktivite')
  if (!notlar.length) { hedef.innerHTML = '<div class="text-on-surface-variant text-center py-6">Aktivite yok.</div>'; return }
  const stil = n => {
    if (KAZANILDI_DURUMLARI.includes(n.musteri_durumu)) return { bg: 'bg-secondary', ik: 'done_all' }
    if (kaybedildiMi(n.musteri_durumu)) return { bg: 'bg-red-400', ik: 'cancel' }
    if (!n.sahip_danisman_id) return { bg: 'bg-orange-400', ik: 'inbox' }
    return { bg: 'bg-primary', ik: 'person' }
  }
  hedef.innerHTML = `<div class="relative space-y-6">
    <div class="absolute left-[15px] top-2 bottom-2 w-px bg-outline-variant"></div>
    ${notlar.map(n => { const s = stil(n); const arac = [n.talepler?.marka, n.talepler?.model].filter(Boolean).join(' ')
      // Aktiviteyi yapan danışman: sahiplenen varsa o, yoksa açan (santral/danışman)
      const kimId = n.sahip_danisman_id || n.acan_id
      const kim = kimId ? danismanAdi(dmap, kimId) : (n.sahip_danisman_id ? '' : 'Havuz')
      return `<div class="flex gap-4 relative z-10">
        <div class="w-8 h-8 shrink-0 rounded-full ${s.bg} flex items-center justify-center text-white ring-4 ring-white">${mat(s.ik, 'text-sm')}</div>
        <div class="min-w-0">
          <p class="text-label-md text-on-surface"><span class="font-bold">${kacis(n.musteri_ad_soyad) || '—'}</span> · ${kacis(n.musteri_durumu)}</p>
          <p class="text-[11px] text-on-surface-variant mt-1">${kim && kim !== '—' ? '<span class="font-medium text-primary">' + kacis(kim) + '</span> • ' : ''}${gecenSureKisa(n.created_at)}${arac ? ' • ' + kacis(arac) : ''}</p>
        </div>
      </div>`
    }).join('')}
  </div>`
}

// --- Danışman Not Karnesi: doldurma oranı + dokunulmamış talep + bekleyen takip ---
function notKarneCiz(notData, dmap) {
  const kart = document.getElementById('notKarneKart')
  const hedef = document.getElementById('notKarne')
  const ozet = document.getElementById('notKarneOzet')
  if (!kart || !hedef) return

  // Açılış kayıtları görüşme sayılmaz — gerçek notlar üzerinden değerlendir
  const gercek = notData.filter(n => !n.acilis_notu)

  // Danışman bazında doldurma
  const byDan = {}
  for (const n of gercek) {
    const id = n.sahip_danisman_id || n.acan_id
    if (!id) continue
    const r = byDan[id] || (byDan[id] = { toplam: 0, dolu: 0 })
    r.toplam++
    if ((n.gorusme_notu || '').trim()) r.dolu++
  }
  const satirlar = Object.keys(byDan).map(id => {
    const r = byDan[id]
    const oran = r.toplam ? Math.round(r.dolu / r.toplam * 100) : 0
    return { ad: danismanAdi(dmap, id), ...r, bos: r.toplam - r.dolu, oran }
  }).sort((a, b) => a.oran - b.oran)   // en düşük doldurma üstte (dikkat çeksin)

  // Dokunulmamış talep = hiç gerçek (dolu, açılış olmayan) notu olmayan talep
  const talepReal = {}
  for (const n of notData) {
    const has = !n.acilis_notu && (n.gorusme_notu || '').trim()
    talepReal[n.talep_id] = talepReal[n.talep_id] || !!has
  }
  const dokunulmamis = Object.values(talepReal).filter(v => !v).length

  // Bekleyen takip = talebin güncel notunda sonraki_adim_tarihi bugün/geçmiş (açık)
  const guncel = {}
  for (const n of notData) {
    const c = guncel[n.talep_id]
    if (!c || (n.created_at || '') > (c.created_at || '')) guncel[n.talep_id] = n
  }
  const bugun = bugunISO()
  const bekleyenTakip = Object.values(guncel).filter(n =>
    n.sonraki_adim_tarihi && n.sonraki_adim_tarihi <= bugun && !kapanisMi(n.musteri_durumu)).length

  if (!satirlar.length && !dokunulmamis) { kart.style.display = 'none'; return }
  kart.style.display = ''

  const rozet = (metin, sinif) => `<span class="px-3 py-1 rounded-full text-label-sm font-bold ${sinif}">${metin}</span>`
  ozet.innerHTML =
    rozet(`Dokunulmamış talep: ${dokunulmamis}`, dokunulmamis ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800')
    + rozet(`Bekleyen takip: ${bekleyenTakip}`, bekleyenTakip ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')

  const oranRenk = o => o >= 80 ? 'text-green-700' : o >= 50 ? 'text-amber-700' : 'text-red-700'
  hedef.innerHTML = `<table class="w-full text-left zebra-table">
    <thead class="bg-primary text-white"><tr>
      <th class="px-lg py-3 text-label-md font-medium">Danışman</th>
      <th class="px-lg py-3 text-label-md font-medium text-right">Görüşme Notu</th>
      <th class="px-lg py-3 text-label-md font-medium text-right">Dolu</th>
      <th class="px-lg py-3 text-label-md font-medium text-right">Boş</th>
      <th class="px-lg py-3 text-label-md font-medium text-right">Doldurma</th>
    </tr></thead>
    <tbody class="text-body-md">${satirlar.map(s => `
      <tr>
        <td class="px-lg py-md font-medium">${kacis(s.ad)}</td>
        <td class="px-lg py-md text-right">${s.toplam}</td>
        <td class="px-lg py-md text-right text-green-700 font-bold">${s.dolu}</td>
        <td class="px-lg py-md text-right ${s.bos ? 'text-red-700 font-bold' : 'text-on-surface-variant'}">${s.bos}</td>
        <td class="px-lg py-md text-right font-bold ${oranRenk(s.oran)}">%${s.oran}</td>
      </tr>`).join('')}</tbody></table>`
}

// --- Satış hunisi (tema renkleri) ---
function huniCiz(notData) {
  const hedef = document.getElementById('huni'); if (!hedef) return
  const say = arr => notData.filter(n => arr.includes(n.musteri_durumu)).length
  const asama = [
    { ad: 'Yeni / İlgi', n: say(['Yeni Talep', 'İletişim Kuruldu']), renk: '#94a3b8' },
    { ad: 'Teklif / Test', n: say(['Test / Ekspertiz / Teklif']), renk: '#3b82f6' },
    { ad: 'Pazarlık', n: say(['Pazarlık']), renk: '#c2650f' },
    { ad: 'Kredi / Kapora', n: say(['Kredi Bekliyor', 'Kapora / Rezerve']), renk: '#8a2836' },
    { ad: 'Kazanıldı', n: say(['Satış Tamamlandı', 'Alım Yapıldı']), renk: '#16a34a' },
  ]
  const max = Math.max(1, ...asama.map(a => a.n))
  hedef.innerHTML = asama.map(a => `<div class="mb-3">
    <div class="flex justify-between text-body-md mb-1"><span>${a.ad}</span><strong>${a.n}</strong></div>
    <div class="h-3.5 bg-surface-container-high rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${Math.round(a.n / max * 100)}%; background:${a.renk}; transition:width .4s"></div></div>
  </div>`).join('')
}

function cizBar(id, etiketler, veriler, baslik, yatay) {
  const ctx = document.getElementById(id); if (!ctx || !window.Chart) return
  grafikler.push(new Chart(ctx, {
    type: 'bar',
    data: { labels: etiketler, datasets: [{ label: baslik, data: veriler, backgroundColor: BORDO, borderRadius: 6, borderWidth: 0, maxBarThickness: 36 }] },
    options: {
      indexAxis: yatay ? 'y' : 'x', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { precision: 0 } }, y: { ticks: { precision: 0 } } },
    },
  }))
}

function cizPasta(id, etiketler, veriler) {
  const ctx = document.getElementById(id); if (!ctx || !window.Chart) return
  const toplam = veriler.reduce((a, b) => a + (Number(b) || 0), 0)
  grafikler.push(new Chart(ctx, {
    type: 'doughnut',
    data: { labels: etiketler, datasets: [{ data: veriler, backgroundColor: renkler, borderColor: '#fff', borderWidth: 2, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 9, padding: 12, font: { size: 11 } } } } },
    plugins: [{ id: 'merkez', afterDraw(c) {
      const a = c.chartArea; if (!a) return
      const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2
      const g = c.ctx; g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillStyle = '#221c19'; g.font = '700 22px system-ui,sans-serif'; g.fillText(String(toplam), x, y - 6)
      g.fillStyle = '#8a7d74'; g.font = '500 11px system-ui,sans-serif'; g.fillText('Toplam', x, y + 12); g.restore()
    } }],
  }))
}
