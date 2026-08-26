// =====================================================================
// profil.js — Kişisel Performans Merkezi (sağ üstteki avatardan açılır)
//   Gerçek istatistik: gorusme_notlari sayımları (1000-cap'i aşmak için
//   count:'exact' head sorguları). Rozet/son-giriş verisi YOK — koymuyoruz.
// =====================================================================
import { supabase } from './supabase-client.js'
import { signOut } from './auth.js'
import { etkinSayfalar, SAYFALAR } from './yetki.js'
import { kacis } from './veri.js'
import { mat, avatar } from './stitch-ui.js'

let benim = null
const ROL_ET = { yonetici: 'Yönetici', santral: 'Santral', satinalma: 'Satın Alma', kredi: 'Kredi Birimi', danisman: 'Danışman' }
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

async function say(kur) {
  let q = supabase.from('gorusme_notlari').select('id', { count: 'exact', head: true })
  q = kur(q)
  const { count } = await q
  return count || 0
}
const iso = d => d.toISOString()

export async function profilKur(danisman) {
  benim = danisman
  heroCiz()
  yetkiCiz()
  imzaCiz()
  ayarCiz()
  await kpiCiz()
  await trendCiz()
}

function heroCiz() {
  const rol = benim.master_admin ? 'Master Admin' : (ROL_ET[benim.rol] || 'Danışman')
  document.getElementById('profilHero').innerHTML = `
    <div class="relative p-lg md:p-xl flex flex-col sm:flex-row items-center sm:items-end gap-5 text-white">
      <div class="absolute inset-0 bg-gradient-to-br from-primary/80 to-on-surface"></div>
      <div class="relative w-24 h-24 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-4xl font-black shrink-0 border-2 border-white/30">${kacis(basHarf(benim.ad_soyad || benim.email))}</div>
      <div class="relative text-center sm:text-left flex-1 min-w-0">
        <h2 class="text-headline-lg font-black truncate">${kacis(benim.ad_soyad || benim.email)}</h2>
        <p class="text-white/80 text-body-lg mt-1">${kacis(rol)}</p>
        <div class="flex flex-wrap justify-center sm:justify-start gap-2 mt-3">
          <span class="bg-white/15 backdrop-blur px-3 py-1 rounded-full text-label-sm font-bold">${kacis(benim.email)}</span>
          ${benim.telefon ? `<span class="bg-white/15 backdrop-blur px-3 py-1 rounded-full text-label-sm font-bold">${kacis(benim.telefon)}</span>` : ''}
          <span class="bg-white/15 backdrop-blur px-3 py-1 rounded-full text-label-sm font-bold flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-400"></span>${benim.aktif !== false ? 'Aktif' : 'Pasif'}</span>
        </div>
      </div>
    </div>`
}
function basHarf(ad) {
  const p = (ad || '?').trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '') || '?').toLocaleUpperCase('tr-TR')
}

async function kpiCiz() {
  const now = new Date()
  const ayBasi = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const bugun = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  const me = benim.id
  const gorusme = q => q.eq('acan_id', me).eq('acilis_notu', false)

  const [buAy, toplam, buGun, ustBir] = await Promise.all([
    say(q => gorusme(q).gte('created_at', ayBasi)),
    say(q => gorusme(q)),
    say(q => gorusme(q).gte('created_at', bugun)),
    benim.rol === 'kredi'
      ? supabase.from('kredi_basvurulari').select('id', { count: 'exact', head: true }).eq('kredi_personeli_id', me).eq('durum', 'kuyrukta').then(r => r.count || 0)
      : say(q => q.eq('sahip_danisman_id', me)),
  ])

  const kart = (ik, renk, deger, etiket, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('profilKpi').innerHTML =
    kart('forum', 'bg-primary-fixed text-primary', buAy, 'Bu Ay Görüşme', 'açtığın not') +
    kart('today', 'bg-secondary/10 text-secondary', buGun, 'Bugün', 'bugünkü görüşme') +
    kart('history', 'bg-amber-100 text-amber-700', toplam, 'Toplam Görüşme', 'tüm zamanlar') +
    (benim.rol === 'kredi'
      ? kart('credit_score', 'bg-green-100 text-green-700', ustBir, 'Kredi Dosyam', 'kuyrukta')
      : kart('assignment_ind', 'bg-green-100 text-green-700', ustBir, 'Üzerimdeki İş', 'sahiplendiğim not'))
}

async function trendCiz() {
  const me = benim.id
  const now = new Date()
  const aylar = []
  for (let i = 5; i >= 0; i--) aylar.push(new Date(now.getFullYear(), now.getMonth() - i, 1))
  const sonuc = await Promise.all(aylar.map((d, idx) => {
    const bas = iso(d)
    const son = iso(new Date(d.getFullYear(), d.getMonth() + 1, 1))
    return say(q => q.eq('acan_id', me).eq('acilis_notu', false).gte('created_at', bas).lt('created_at', son))
  }))
  const max = Math.max(...sonuc, 1)
  const el = document.getElementById('profilTrend')
  el.innerHTML = `<div class="flex items-end justify-between gap-2 h-40">${aylar.map((d, i) => {
    const h = Math.round(sonuc[i] / max * 100)
    const buAy = i === aylar.length - 1
    return `<div class="flex-1 flex flex-col items-center gap-1.5 min-w-0">
      <span class="text-label-sm font-bold ${buAy ? 'text-primary' : 'text-on-surface-variant'}">${sonuc[i]}</span>
      <div class="w-full rounded-lg ${buAy ? 'bg-primary' : 'bg-primary/25'} transition-all" style="height:${Math.max(h, 3)}%;min-height:6px"></div>
      <span class="text-[11px] text-on-surface-variant">${AYLAR[d.getMonth()].slice(0, 3)}</span>
    </div>`
  }).join('')}</div>`
}

function yetkiCiz() {
  const keys = etkinSayfalar(benim)
  const gorunen = SAYFALAR.filter(s => keys.includes(s.key))
  document.getElementById('profilYetki').innerHTML =
    (benim.master_admin ? '<span class="bg-primary text-on-primary text-label-md font-bold px-3 py-1.5 rounded-full">Tüm sayfalar (Master)</span>' : '')
    + gorunen.map(s => `<span class="bg-primary-fixed text-primary text-label-md font-bold px-3 py-1.5 rounded-full flex items-center gap-1">${mat('check', 'text-[15px]')} ${kacis(s.label)}</span>`).join('')
    + '<span class="bg-surface-container text-on-surface-variant text-label-md px-3 py-1.5 rounded-full">Yenilikler</span>'
}

function imzaCiz() {
  const rol = benim.master_admin ? 'Master Admin' : (ROL_ET[benim.rol] || 'Danışman')
  const imzaText = `${benim.ad_soyad || ''}\n${rol} · İsmail Çalmaz Otomotiv${benim.telefon ? '\n' + benim.telefon : ''}\n${benim.email}`
  document.getElementById('profilImza').innerHTML = `
    <div class="border-l-4 border-primary bg-surface-container-low rounded-r-lg p-4">
      <p class="font-black text-on-surface">${kacis(benim.ad_soyad || '')}</p>
      <p class="text-label-md text-primary font-bold">${kacis(rol)} · İsmail Çalmaz Otomotiv</p>
      ${benim.telefon ? `<p class="text-label-md text-on-surface-variant mt-1">${mat('call', 'text-[14px]')} ${kacis(benim.telefon)}</p>` : ''}
      <p class="text-label-md text-on-surface-variant">${mat('mail', 'text-[14px]')} ${kacis(benim.email)}</p>
    </div>
    <button id="imzaKopyala" class="mt-3 w-full border border-outline-variant text-primary py-2 rounded-lg text-label-md font-bold hover:bg-surface-container-low flex items-center justify-center gap-1.5">${mat('content_copy', 'text-[18px]')} İmzayı Kopyala</button>
    <span id="imzaMsg" class="block text-label-sm text-green-700 mt-1"></span>`
  document.getElementById('imzaKopyala').addEventListener('click', () => {
    navigator.clipboard?.writeText(imzaText)
    document.getElementById('imzaMsg').textContent = 'Kopyalandı ✓'
  })
}

function ayarCiz() {
  const izin = ('Notification' in window) ? Notification.permission : 'unsupported'
  const izinMetin = izin === 'granted' ? 'Açık ✓' : izin === 'denied' ? 'Tarayıcıdan kapalı' : izin === 'unsupported' ? 'Desteklenmiyor' : 'Kapalı'
  const izinCls = izin === 'granted' ? 'text-green-700' : izin === 'denied' ? 'text-error' : 'text-on-surface-variant'
  document.getElementById('profilAyar').innerHTML = `
    <div class="flex items-center justify-between gap-2 py-2 border-b border-outline-variant/60">
      <span class="text-body-md text-on-surface flex items-center gap-2">${mat('notifications', 'text-[20px] text-on-surface-variant')} Push bildirim</span>
      <span id="pushDurum" class="text-label-md font-bold ${izinCls}">${izinMetin}</span>
    </div>
    ${izin === 'default' ? '<button id="pushAc" class="w-full mt-1 border border-outline-variant text-primary py-2 rounded-lg text-label-md font-bold hover:bg-surface-container-low">Bildirimleri Aç</button>' : ''}
    <div class="flex items-center justify-between gap-2 py-2 border-b border-outline-variant/60">
      <span class="text-body-md text-on-surface flex items-center gap-2">${mat('circle', 'text-[12px] text-green-500')} Durum</span>
      <span class="text-label-md font-bold text-green-700">Çevrimiçi</span>
    </div>
    <button id="cikisBtn" class="w-full mt-2 bg-error-container text-error py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('logout', 'text-[18px]')} Çıkış Yap</button>
    <p class="text-[11px] text-on-surface-variant mt-2">Rolünü veya yetkilerini yalnızca yönetici değiştirebilir. Değişiklik için yöneticine başvur.</p>`
  document.getElementById('pushAc')?.addEventListener('click', async () => {
    try { await Notification.requestPermission() } catch { /* yoksay */ }
    ayarCiz()
  })
  document.getElementById('cikisBtn').addEventListener('click', signOut)
}
