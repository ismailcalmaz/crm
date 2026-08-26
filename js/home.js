// =====================================================================
// home.js — Kişiye özel Ana Sayfa (Stitch tasarımı, Tailwind markup)
//   danisman → cevap bekleyen talepler + telefon + "Ara" + santral notu
//   santral  → açtığı taleplerin durumu
//   yonetici → kısa özet + Detaylı Panel bağlantısı
//   Veri/Supabase mantığı korunur; yalnızca görünüm Stitch'e taşındı.
// =====================================================================
import { supabase } from './supabase-client.js'
import {
  AKSIYON_DURUMLARI, danismanMap, danismanAdi, aracOzet, fmtButce, fmtTarihKisa,
  durumSinifi, finansDurum, finansEtiket, telNo, waHref, kacis, kapanisMi, kazanildiMi, kaybedildiMi, fmtPara,
  bugunISO, BANKALAR, krediSonucEtiket, krediSonucSinif,
} from './veri.js'
import { cipMenuAc, atamaYaz, sonlandirAc, duzenleAc } from './kredi-islem.js'
import { evrakTakipEder } from './yetki.js'
import { evrakListesiOku, evrakOzetHtml, evrakPopupGoster } from './evrak-takip.js'

let benim = null, dmap = {}

const NOT_ALAN =
  'id, talep_id, gorusme_notu, musteri_ad_soyad, telefon, musteri_durumu, acan_id, sahip_danisman_id, created_at, ' +
  'talepler(marka,model,paket,butce_min,butce_max)'

function ilkAd(ad) { return (ad || '').trim().split(' ')[0] || '' }
function selamMetni() { const s = new Date().getHours(); return s < 12 ? 'Günaydın' : s < 18 ? 'İyi günler' : 'İyi akşamlar' }
function bugunMu(ts) { return new Date(ts).toDateString() === new Date().toDateString() }
function gecenSure(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 86400000
  if (d < 1) return 'bugün'
  if (d < 2) return 'dün'
  return Math.floor(d) + ' gün önce'
}
function basHarf(ad) {
  const p = (ad || '?').trim().split(/\s+/).filter(Boolean)
  const h = (p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')
  return (h || '?').toLocaleUpperCase('tr-TR')
}
function mat(ad, ekstra = '', dolu = false) {
  return `<span class="material-symbols-outlined${ekstra ? ' ' + ekstra : ''}"${dolu ? ` style="font-variation-settings:'FILL' 1"` : ''}>${ad}</span>`
}

// Durum → Tailwind pill sınıfı
const PILL = {
  basari: 'bg-green-100 text-green-800', aktif: 'bg-amber-100 text-amber-800',
  hata: 'bg-red-100 text-red-800', bilgi: 'bg-blue-100 text-blue-800', yeni: 'bg-blue-100 text-blue-800',
  havuz: 'bg-primary-fixed text-primary', notr: 'bg-surface-container-high text-on-surface-variant',
}
function pill(metin, sinif) {
  return `<span class="px-2.5 py-0.5 text-[11px] font-bold rounded-full ${PILL[sinif] || PILL.notr}">${kacis(metin)}</span>`
}

const KOK = () => document.getElementById('anaKok')

// Bir talebin "güncel" notu = en son oluşturulan not (talepler.js ile aynı mantık)
function guncelNot(t) {
  const notlar = (t.gorusme_notlari || []).slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return notlar[0] || null
}

export async function homeKur(danisman) {
  benim = danisman
  dmap = await danismanMap()
  const rol = danisman.master_admin ? 'yonetici' : danisman.rol
  if (rol === 'yonetici') await yoneticiOzet()
  else if (rol === 'santral') await santralGorunum()
  else if (rol === 'kredi') await krediGorunum()
  else await danismanGorunum()
  // Rol görünümü çizildikten SONRA: hangi görünüm olursa olsun aynı yere düşer.
  await evrakBolumu(danisman)
}

// --- Evrak Talebi (bilgi işlem) — özet kart + bir kerelik pop-up ---------
// Liste asıl olarak İlanlarımız → "Evrak Talepleri" sekmesinde durur; burada
// yalnız hatırlatma var. İkisi de v_evrak_takip'i okur, ayrışamazlar.
async function evrakBolumu(d) {
  if (!evrakTakipEder(d)) return
  const { satirlar } = await evrakListesiOku()
  if (!satirlar.length) return
  const kok = KOK()
  if (!kok) return
  // Selamlama başlığının hemen altına — her rol görünümünde ilk çocuk odur.
  const html = evrakOzetHtml(satirlar)
  if (kok.firstElementChild) kok.firstElementChild.insertAdjacentHTML('afterend', html)
  else kok.insertAdjacentHTML('afterbegin', html)
  evrakPopupGoster(satirlar)
}

// ---------------------------------------------------------------- KREDİ
// Kredi personeline danışman ekranı gösteriliyordu: "Cevap Bekleyen
// Talepler", havuz kartı (izni yok, bağlantı çalışmıyor), Sahiplen
// düğmeleri… Hiçbiri onun işi değil. Bu görünüm sadece kuyruğu anlatır.
// Kredi dashboard: SON 1 AY tüm dosyalar (durum farketmez), yeniden eskiye.
// Danışman(gönderen) · müşteri · banka onay durumları görünür ve çipler
// buradan ANLIK düzenlenebilir (kuyruğa gitmeden). Çip/atama/sonlandırma
// kredi.js ile aynı paylaşımlı modülü (kredi-islem) kullanır.
const KREDI_AY = 30
let krediHepsi = []

async function krediGorunum() {
  const kesim = new Date(Date.now() - KREDI_AY * 86400000).toISOString()
  const { data, error } = await supabase.from('kredi_basvurulari')
    .select('id, musteri_ad_soyad, telefon, arac_ozet, plaka, durum, sonuc, aciklama, '
      + 'kredi_personeli_id, gonderen_id, created_at, sonlandirma_tarihi, '
      + 'kredi_banka_sonuclari(id, banka, sonuc, tutar, satis_beyani, onay_tarihi, not_metni), '
      + 'kredi_basvuru_gizli(tckn, red_nedeni, red_yorum)')
    .gte('created_at', kesim)
    .order('created_at', { ascending: false })
  if (error) { KOK().innerHTML = uyari('Kuyruk okunamadı: ' + kacis(error.message)); return }
  krediHepsi = data || []

  const kuyrukta = krediHepsi.filter(b => b.durum === 'kuyrukta')
  const sonuclu = b => b.kredi_banka_sonuclari || []
  const onayli = kuyrukta.filter(b => sonuclu(b).some(s => ['onay', 'kismi_onay'].includes(s.sonuc)))
  const dokunulmamis = kuyrukta.filter(b => !sonuclu(b).length)
  const bugun = new Date().toISOString().slice(0, 10)
  const bugunKapanan = krediHepsi.filter(b =>
    b.durum === 'sonlandirildi' && (b.sonlandirma_tarihi || '').slice(0, 10) === bugun)

  const kpi = kpiCiz([
    { sayi: kuyrukta.length, etiket: 'Kuyrukta', ikon: 'inbox', renk: 'bordo' },
    { sayi: dokunulmamis.length, etiket: 'Hiç dokunulmamış', ikon: 'pending_actions', renk: 'turuncu' },
    { sayi: onayli.length, etiket: 'Onaylı, kullandırım bekliyor', ikon: 'verified', renk: 'yesil' },
    { sayi: bugunKapanan.length, etiket: 'Bugün sonlandırılan', ikon: 'task_alt', renk: 'mavi' },
  ])

  const baslik = baslikCiz('Kredi Birimi',
    `${selamMetni()}, ${kacis(ilkAd(benim.ad_soyad) || benim.email)} — son 1 ayın ${krediHepsi.length} dosyası (yeni → eski).`,
    `<a href="kredi.html" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold flex items-center gap-2 hover:opacity-90">${mat('credit_score', 'text-[18px]')} Kredi Kuyruğuna Git</a>`)

  KOK().innerHTML = baslik + kpi
    + `<section class="mt-lg space-y-sm" id="krediDashListe"></section>`
    + (krediHepsi.length ? '' : bosDurum('Son 1 ayda dosya yok.'))
  krediDashCiz()
}

const krediCtx = () => ({ benim, dmap, yenile: krediGorunum })

// sql/190 · Başvurunun SON KARARI kredi müdürü + Bahadır + master'da.
// Göksenil (12 Ağu 2026): "kredi danışmanı sonlandıra basıyor, burası yanlış."
// ⚠️ Sunucudaki `kredi_karar_yetkisi()` ile birebir aynı koşul; burası yalnız
//    düğmeyi gizler, RPC yetkisiz çağrıda zaten istisna atar.
const krediSonKarar = d => !!(d && (d.master_admin || d.mudur_birim === 'kredi' || d.mudur_birim === 'finans'))

function krediDashKart(b) {
  const harita = Object.fromEntries((b.kredi_banka_sonuclari || []).map(s => [s.banka, s]))
  const kapali = b.durum === 'sonlandirildi'
  const onay = (b.kredi_banka_sonuclari || []).filter(s => ['onay', 'kismi_onay'].includes(s.sonuc))
  const gun = onay.map(s => s.onay_tarihi
    ? Math.floor((Date.now() - new Date(s.onay_tarihi).getTime()) / 86400000) : null)
    .filter(g => g !== null).sort((a, c) => c - a)[0]
  const personel = b.kredi_personeli_id ? danismanAdi(dmap, b.kredi_personeli_id) : null

  const cipler = BANKALAR.map(banka => {
    const s = harita[banka]
    const sinif = s ? krediSonucSinif(s.sonuc)
      : 'bg-surface-container border-outline-variant text-on-surface-variant border-dashed'
    const tutar = (s?.banka === 'Otosor' && s?.satis_beyani != null) ? s.satis_beyani : s?.tutar
    return `<button data-cip="${kacis(banka)}"${kapali ? ' disabled' : ''} class="border rounded-lg px-2 py-1 text-[11px] font-bold text-left ${sinif}${kapali ? ' opacity-70' : ''}">
      ${s ? kacis(krediSonucEtiket(s.sonuc)) : kacis(banka)}
      ${s ? `<span class="block text-[9px] opacity-75 leading-none">${kacis(banka)}</span>` : ''}
      ${tutar != null ? `<span class="block text-[10px] font-bold leading-tight">${kacis(fmtPara(tutar))}</span>` : ''}
      ${s?.not_metni ? `<span class="block text-[10px] leading-tight bg-black/5 rounded px-1">📝 ${kacis(s.not_metni)}</span>` : ''}
    </button>`
  }).join('')

  return `<div id="kd-${b.id}" class="bg-surface-container-lowest border border-outline-variant rounded-xl p-md custom-shadow space-y-2">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="text-title-sm font-bold text-on-surface">${kacis(b.musteri_ad_soyad)}
          ${kapali ? pill(b.sonuc === 'onayli' ? 'onaylı kapandı' : 'redli kapandı', b.sonuc === 'onayli' ? 'basari' : 'hata') : ''}</p>
        <p class="text-label-sm text-on-surface-variant">
          ${kacis(b.telefon || '—')}${b.arac_ozet ? ' · ' + kacis(b.arac_ozet) : ''}
          · <span class="font-medium">${kacis(danismanAdi(dmap, b.gonderen_id))}</span> gönderdi
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${gun != null ? pill(gun + ' gün onaylı', gun >= 7 ? 'uyari' : 'basari') : ''}
        ${kapali ? '' : (b.kredi_personeli_id === benim.id
          ? `<span class="inline-flex items-center gap-1">${pill('Sende', 'basari')}<button data-birak class="text-[11px] text-on-surface-variant underline">bırak</button></span>`
          : (personel
            ? `<span class="inline-flex items-center gap-1">${pill(personel, 'bilgi')}<button data-devral class="text-[11px] text-on-surface-variant underline">devral</button></span>`
            : `<button data-uzerinal class="text-label-sm text-primary font-bold underline">Üzerine al</button>`))}
      </div>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">${cipler}</div>
    ${kapali ? '' : `<div class="flex items-center gap-3 pt-1">
      <button data-duzenle class="text-label-sm text-on-surface-variant underline">Müşteri bilgisi</button>
      ${krediSonKarar(benim)
        ? '<button data-sonlandir class="text-label-sm text-on-surface-variant underline">Sonlandır</button>'
        : '<span class="text-label-sm text-on-surface-variant/60" title="Son kararı kredi müdürü verir">Sonlandırma: kredi müdüründe</span>'}
    </div>`}
  </div>`
}

function krediDashCiz() {
  const hedef = document.getElementById('krediDashListe')
  if (!hedef) return
  hedef.innerHTML = krediHepsi.map(krediDashKart).join('')
  krediHepsi.forEach(b => {
    const kok = document.getElementById('kd-' + b.id)
    if (!kok) return
    kok.querySelectorAll('[data-cip]').forEach(btn =>
      btn.addEventListener('click', () => cipMenuAc(b, btn.dataset.cip, krediCtx())))
    kok.querySelector('[data-uzerinal]')?.addEventListener('click', () => atamaYaz(b.id, benim.id, krediCtx()))
    kok.querySelector('[data-birak]')?.addEventListener('click', () => atamaYaz(b.id, null, krediCtx()))
    kok.querySelector('[data-devral]')?.addEventListener('click', () => {
      if (confirm(`Bu dosya ${danismanAdi(dmap, b.kredi_personeli_id)} üzerinde. Devralmak istiyor musun?`)) atamaYaz(b.id, benim.id, krediCtx())
    })
    kok.querySelector('[data-duzenle]')?.addEventListener('click', () => duzenleAc(b, krediCtx()))
    kok.querySelector('[data-sonlandir]')?.addEventListener('click', () => sonlandirAc(b, krediCtx()))
  })
}

// --- Ortak parçalar (Stitch markup) ---
function baslikCiz(baslik, altMetin, sagHtml = '') {
  return `<div class="flex flex-col md:flex-row md:items-center justify-between gap-md">
    <div>
      <h2 class="text-headline-md text-primary">${kacis(baslik)}</h2>
      <p class="text-body-md text-on-surface-variant">${kacis(altMetin)}</p>
    </div>
    ${sagHtml ? `<div class="flex gap-sm">${sagHtml}</div>` : ''}
  </div>`
}

const KPI_RENK = {
  bordo: 'bg-primary-fixed text-primary', mavi: 'bg-blue-100 text-blue-700',
  yesil: 'bg-secondary-container text-on-secondary-container', turuncu: 'bg-orange-100 text-orange-700',
}
function kpiCiz(kartlar) {
  return `<section class="grid grid-cols-2 lg:grid-cols-4 gap-gutter">
    ${kartlar.map(k => `<div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant custom-shadow">
      <div class="flex justify-between items-start">
        <div>
          <p class="text-label-md text-on-surface-variant">${kacis(k.etiket)}</p>
          <h3 class="text-headline-md text-primary mt-1">${k.sayi}</h3>
        </div>
        <div class="p-2 rounded-lg ${KPI_RENK[k.renk] || KPI_RENK.bordo}">${mat(k.ikon || 'circle')}</div>
      </div>
    </div>`).join('')}
  </section>`
}

// ---------------------------------------------------------------- DANIŞMAN
async function danismanGorunum() {
  const { data, error } = await supabase.from('gorusme_notlari').select(NOT_ALAN)
    .in('musteri_durumu', AKSIYON_DURUMLARI)
    .or(`sahip_danisman_id.eq.${benim.id},sahip_danisman_id.is.null`)
    .order('created_at', { ascending: true })

  const liste = data || []
  const banaAtanan = liste.filter(n => n.sahip_danisman_id === benim.id)
  const havuz = liste.filter(n => !n.sahip_danisman_id)

  const kpi = kpiCiz([
    { sayi: liste.length, etiket: 'Cevap bekleyen', ikon: 'pending_actions', renk: 'bordo' },
    { sayi: banaAtanan.length, etiket: 'Sana atanan', ikon: 'assignment_ind', renk: 'yesil' },
    { sayi: havuz.length, etiket: 'Havuzda fırsat', ikon: 'group', renk: 'mavi' },
    { sayi: liste.filter(n => bugunMu(n.created_at)).length, etiket: 'Bugün gelen', ikon: 'schedule', renk: 'turuncu' },
  ])

  const alt = `${selamMetni()}, ${kacis(ilkAd(benim.ad_soyad) || benim.email)} — ` +
    (liste.length ? `${liste.length} talep cevabını bekliyor. En eskisinden başla.` : 'cevap bekleyen talebin yok. 🎉')
  const baslik = baslikCiz('Cevap Bekleyen Talepler', alt)

  const [taleplerim, finansHtml, satislarim, krediBekleyen] = await Promise.all([
    taleplerimHtml(), finansHatirlatmaHtml(), satislarimHtml(), krediBekleyenHtml(false),
  ])

  // Havuzda 290 kayıt var; hepsini kart olarak basmak sayfayı 447 kartlık bir
  // duvara çeviriyordu ve kimse nereden başlayacağını bulamıyordu. Artık
  // kendi işleri tam kart, havuz ise özet + en yeni 5 örnek + havuza bağlantı.
  const HAVUZ_ONIZLEME = 5
  const havuzOnizleme = havuz.slice(-HAVUZ_ONIZLEME).reverse()   // en yeniler
  const gosterilen = banaAtanan.concat(havuzOnizleme)

  let listeHtml
  if (error) listeHtml = uyari(`Okunamadı: ${kacis(error.message)}`)
  else if (!liste.length) listeHtml = bosDurum('Şu an aksiyon bekleyen talep yok. Havuzu da kontrol edebilirsin.')
  else listeHtml = `
    ${banaAtanan.length ? `
    <section class="space-y-md">
      <div class="flex items-center justify-between">
        <h4 class="text-title-lg text-on-surface">Cevap bekleyen işlerin</h4>
        <span class="text-label-sm text-on-surface-variant bg-surface-container-high px-3 py-1 rounded-full">${banaAtanan.length} kayıt</span>
      </div>
      <div class="space-y-sm">${banaAtanan.map(isKarti).join('')}</div>
    </section>` : ''}

    ${havuz.length ? `
    <section class="space-y-md">
      <div class="bg-surface-container-lowest border border-outline-variant border-l-4 border-l-secondary rounded-xl p-lg custom-shadow flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 class="text-title-lg text-on-surface flex items-center gap-2">${mat('group', 'text-secondary')} Havuzda ${havuz.length} müşteri bekliyor</h4>
          <p class="text-body-md text-on-surface-variant mt-1">Sahipsiz talepler. İstediğini sahiplenip aramaya başlayabilirsin.</p>
        </div>
        <a href="havuz.html" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold inline-flex items-center gap-2 hover:opacity-90 transition-all shrink-0">
          ${mat('arrow_forward', 'text-[18px]')} Havuza git
        </a>
      </div>
      ${havuzOnizleme.length ? `
        <p class="text-label-sm text-on-surface-variant">En son gelenler:</p>
        <div class="space-y-sm">${havuzOnizleme.map(isKarti).join('')}</div>` : ''}
    </section>` : ''}`

  // Kredi bekleyenler ustte: onayli ama satisa donmemis dosya = para masada
  KOK().innerHTML = baslik + kpi + krediBekleyen + satislarim + taleplerim + finansHtml + listeHtml
  tabloTikla()   // Taleplerim satırları → talep detayı
  // Sadece DOM'a basılanlara bağla (havuzun tamamı değil, önizlemedeki 5'i).
  gosterilen.forEach(n => {
    document.getElementById('is-' + n.id)?.querySelector('[data-sahiplen]')
      ?.addEventListener('click', () => sahiplen(n.id))
  })
}

function isKarti(n) {
  const tel = telNo(n.telefon), wa = waHref(n.telefon)
  const sahipsiz = !n.sahip_danisman_id
  const araBtn = tel
    ? `<a href="tel:${tel}" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all">${mat('call', 'text-[18px]')} Ara</a>`
    : ''
  const waBtn = wa
    ? `<a href="${wa}" target="_blank" class="border border-secondary text-secondary bg-secondary-container/10 px-lg py-sm rounded-lg text-label-md font-bold flex items-center justify-center gap-2 hover:bg-secondary-container/20 transition-all">${mat('chat', 'text-[18px]', true)} WhatsApp</a>`
    : ''
  return `<div id="is-${n.id}" class="bg-surface-container-lowest border border-outline-variant rounded-xl p-md flex flex-col md:flex-row items-start md:items-center justify-between gap-md custom-shadow hover:translate-x-1 transition-transform duration-200">
    <div class="flex items-center gap-4 w-full md:w-56 shrink-0">
      <div class="w-12 h-12 bg-primary-fixed text-primary rounded-full flex items-center justify-center font-bold text-lg shrink-0">${basHarf(n.musteri_ad_soyad)}</div>
      <div class="min-w-0">
        <h5 class="text-[16px] font-semibold text-on-surface flex items-center gap-2 flex-wrap">${kacis(n.musteri_ad_soyad) || '—'}
          ${sahipsiz ? pill('HAVUZDA', 'havuz') : ''}</h5>
        <p class="text-body-md text-on-surface-variant">${kacis(n.telefon) || 'telefon yok'}</p>
      </div>
    </div>
    <div class="flex-1 w-full md:w-auto px-0 md:px-lg border-l-0 md:border-l border-outline-variant">
      <div class="flex items-center gap-2 text-primary mb-1">
        ${mat('directions_car', 'text-[18px]')}<span class="text-label-md font-bold">${kacis(aracOzet(n.talepler))}</span>
        ${pill(n.musteri_durumu, durumSinifi(n.musteri_durumu))}
      </div>
      ${n.gorusme_notu
        ? `<p class="text-body-md text-on-surface-variant italic leading-relaxed">"${kacis(n.gorusme_notu)}"</p>`
        : `<p class="text-body-md text-on-surface-variant">Santral notu yok</p>`}
      <p class="text-[12px] text-on-surface-variant mt-1">${kacis(fmtButce(n.talepler?.butce_min, n.talepler?.butce_max))} · Açan: ${kacis(danismanAdi(dmap, n.acan_id))} · ${gecenSure(n.created_at)}</p>
    </div>
    <div class="flex flex-col items-stretch md:items-end gap-2 w-full md:w-auto">
      <div class="flex items-center gap-2 w-full">${araBtn}${waBtn}</div>
      <div class="flex items-center gap-3 justify-end text-[12px] w-full">
        ${sahipsiz ? `<button data-sahiplen="1" class="text-on-surface-variant hover:text-primary font-bold">Sahiplen</button>` : ''}
        <a href="talep.html?id=${n.talep_id}" class="text-primary font-bold">Detay / Not Ekle →</a>
      </div>
    </div>
  </div>`
}

// Danışmanın KENDİ talepleri (sahiplendiği + açık) — satıra tıklayınca talep detayı açılır
// Onaylı kredisi olup satışa dönmemiş dosyalar — PARA MASADA.
// Kredi birimi e-tablosunda "kullandırılmayan onay" diye elle sayılan şey
// buydu; burada danışmanın önüne aksiyon listesi olarak çıkıyor.
// Veri RPC'den gelir: kredi tabloları danışmana RLS ile kapalı, bu
// fonksiyon yalnızca kendi dosyalarının dar özetini döner (tutar/TCKN yok).
async function krediBekleyenHtml(hepsi = false) {
  const { data, error } = await supabase.rpc(
    hepsi ? 'kredi_onayli_bekleyen_tum' : 'kredi_onayli_bekleyen')
  if (error) { console.error('[db] kredi bekleyen', error); return '' }
  if (!data || !data.length) return ''

  const satirlar = data.map(r => ({
    hucreler: [
      `<span class="font-bold text-on-surface">${kacis(r.musteri || 'Müşteri')}</span>`,
      kacis(r.telefon || '—'),
      kacis(r.arac || '—'),
      kacis(r.banka || '—'),
      ...(hepsi ? [kacis(r.gonderen || '—')] : []),
      pill(r.gun + ' gündür onaylı', r.gun >= 7 ? 'uyari' : 'basari'),
      `<a href="kredi.html" class="text-primary font-bold">Aç →</a>`,
    ],
  }))

  return tabloSarma(
    ['Müşteri', 'Telefon', 'Araç', 'Onaylayan kurum', ...(hepsi ? ['Gönderen'] : []),
     'Bekleme', ''],
    satirlar,
    'Onaylı kredisi var, satışa dönmedi — acil aksiyon')
}

// Danışmanın kendi kaydettiği satışlar — işaretlemenin karşılığı burası.
// Kapanış durumları RLS ile gizlendiği için satış bilgisi talepler
// tablosundan okunuyor; böylece danışman kendi kazancını görmeye devam ediyor.
async function satislarimHtml() {
  const ayBasi = new Date(); ayBasi.setDate(1)
  const ayISO = ayBasi.toISOString().slice(0, 10)

  const { data, error } = await supabase.from('talepler')
    .select('id, musteri_ad_soyad, marka, model, satis_tarihi, satis_fiyati')
    .eq('satis_kaydeden', benim.id)
    .gte('satis_tarihi', ayISO)
    .order('satis_tarihi', { ascending: false })
  if (error) { console.error('[db] satislarim', error); return '' }
  if (!data || !data.length) return ''      // satış yoksa bölümü hiç gösterme

  const toplam = data.reduce((s, t) => s + Number(t.satis_fiyati || 0), 0)
  const satirlar = data.slice(0, 5).map(t => `
    <a href="talep.html?id=${t.id}" class="flex items-center justify-between gap-3 py-2 border-b border-outline-variant last:border-0 hover:bg-surface-container-low rounded px-2 -mx-2">
      <span class="text-body-md text-on-surface truncate">${kacis(t.musteri_ad_soyad || 'Müşteri')}
        <span class="text-on-surface-variant">${kacis(aracOzet(t) || '')}</span></span>
      <span class="text-label-md text-on-surface-variant shrink-0">${kacis(fmtTarihKisa(t.satis_tarihi))}</span>
    </a>`).join('')

  return `<section class="bg-surface-container-lowest border border-outline-variant border-l-4 border-l-tertiary rounded-xl p-lg custom-shadow space-y-sm">
    <div class="flex items-center justify-between gap-3">
      <h4 class="text-title-lg text-on-surface flex items-center gap-2">${mat('handshake', 'text-tertiary')} Bu ayki satışlarım</h4>
      <span class="text-title-lg font-bold text-tertiary">${data.length}${toplam ? ` · ${kacis(fmtPara(toplam))}` : ''}</span>
    </div>
    ${satirlar}
  </section>`
}

async function taleplerimHtml() {
  const { data, error } = await supabase.from('talepler')
    .select('id, musteri_ad_soyad, telefon, marka, model, paket, aciklama, kaynak, talep_tarihi, '
      + 'gorusme_notlari(musteri_durumu, sahip_danisman_id, sonraki_adim_tarihi, created_at)')
    .order('talep_tarihi', { ascending: false })
  if (error) return uyari(`Talepleriniz okunamadı: ${kacis(error.message)}`)

  const benimki = (data || [])
    .map(t => ({ ...t, _not: guncelNot(t) }))
    .filter(t => t._not && t._not.sahip_danisman_id === benim.id && !kapanisMi(t._not.musteri_durumu))

  if (!benimki.length) {
    return `<section class="space-y-md">
      <h4 class="text-title-lg text-on-surface">Taleplerim</h4>
      ${bosDurum('Üzerinde açık talebin yok. Havuzdan talep sahiplenebilirsin.')}
    </section>`
  }

  const satirlar = benimki.map(t => {
    const takip = t._not.sonraki_adim_tarihi
    const takipRozet = takip
      // bugunISO() yerel saate göre (TR = UTC+3); ham toISOString() UTC verdiği
      // için 00:00-03:00 arası rozet bir gün yanlış renkleniyordu. Tarih de
      // TR biçiminde gösterilmeli (talepler listesiyle tutarlı olsun).
      ? `<div class="mt-1 inline-flex items-center gap-1 text-[12px] font-bold ${takip <= bugunISO() ? 'text-error' : 'text-tertiary'}">${mat('event_upcoming', 'text-[14px]')} ${kacis(fmtTarihKisa(takip))}</div>`
      : ''
    const arac = aracOzet(t)
    const acik = (t.aciklama || '').trim()
    return {
      git: `talep.html?id=${t.id}`,
      hucreler: [
        `<div class="font-bold text-on-surface">${kacis(t.musteri_ad_soyad) || '—'}</div>`
          + (t.kaynak === 'instagram-dm'
            ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full text-white mt-1" style="background:linear-gradient(45deg,#f58529,#dd2a7b,#8134af)">${mat('photo_camera', 'text-[12px]')} Instagram</span>` : ''),
        kacis(t.telefon) || '—',
        `<div class="max-w-[260px]">${arac && arac !== '—' ? `<span class="font-bold">${kacis(arac)}</span>` : ''}`
          + (acik ? `<div class="text-[12px] text-on-surface-variant clamp-2 break-words" title="${kacis(acik)}">${kacis(acik)}</div>` : (arac && arac !== '—' ? '' : '<span class="text-on-surface-variant">—</span>'))
          + `</div>`,
        pill(t._not.musteri_durumu, durumSinifi(t._not.musteri_durumu)) + takipRozet,
        gecenSure(t._not.created_at),
      ],
    }
  })

  return `<section class="space-y-md">
    <div class="flex items-center justify-between">
      <h4 class="text-title-lg text-on-surface">Taleplerim</h4>
      <a href="talepler.html" class="text-primary text-label-md font-bold inline-flex items-center gap-1">Tüm talepler ${mat('arrow_forward', 'text-[16px]')}</a>
    </div>
    ${tabloSarma(['Müşteri', 'Telefon', 'Aranan Araç', 'Durum', 'Son Hareket'], satirlar,
      `Üzerimdeki açık talepler (${benimki.length})`)}
  </section>`
}

// Danışmanın katılım finans müşterileri — finansman tarihi yaklaşan/geçen
async function finansHatirlatmaHtml() {
  const { data, error } = await supabase.from('talepler')
    .select('id, musteri_ad_soyad, telefon, finansman_tarihi, gorusme_notlari(sahip_danisman_id)')
    .eq('katilim_finans', true)
  // Hata olursa bölüm sessizce kaybolurdu → danışman hatırlatmayı hiç görmezdi.
  if (error) {
    console.error('[db] finansHatirlatma', error)
    return `<section class="bg-error-container text-on-error-container border border-error/20 rounded-xl p-4">
      Katılım finans hatırlatmaları yüklenemedi. Sayfayı yenileyin.</section>`
  }
  const benimki = (data || [])
    .filter(r => (r.gorusme_notlari || []).some(g => g.sahip_danisman_id === benim.id))
    .map(r => ({ ...r, _d: finansDurum(r.finansman_tarihi) }))
    .filter(r => r._d.durum === 'yaklasti' || r._d.durum === 'gecti')
    .sort((a, b) => (a.finansman_tarihi || '').localeCompare(b.finansman_tarihi || ''))
  if (!benimki.length) return ''

  return `<section class="bg-surface-container-lowest border border-outline-variant border-l-4 border-l-primary rounded-xl p-lg custom-shadow">
    <h4 class="text-title-lg text-primary flex items-center gap-2 mb-1">${mat('event')} Finansman Hatırlatması — ${benimki.length} müşteri</h4>
    <p class="text-body-md text-on-surface-variant mb-3">Katılım finans tarihi yaklaşan müşterilerini araman gerekiyor.</p>
    <div class="divide-y divide-outline-variant">
      ${benimki.map(r => { const et = finansEtiket(r.finansman_tarihi); const tel = telNo(r.telefon); const wa = waHref(r.telefon)
        return `<div class="flex items-center gap-3 flex-wrap py-2">
          <a href="talep.html?id=${r.id}" class="font-bold text-on-surface min-w-[150px]">${kacis(r.musteri_ad_soyad) || '—'}</a>
          ${pill(et.metin, et.sinif)}
          <span class="text-on-surface-variant text-body-md">${kacis(r.telefon) || ''}</span>
          <div class="ml-auto flex gap-2">
            ${tel ? `<a href="tel:${tel}" class="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-label-md font-bold">Ara</a>` : ''}
            ${wa ? `<a href="${wa}" target="_blank" class="border border-secondary text-secondary px-3 py-1.5 rounded-lg text-label-md font-bold">WhatsApp</a>` : ''}
          </div>
        </div>` }).join('')}
    </div>
  </section>`
}

async function sahiplen(id) {
  // .select('id') ŞART — guard 0 satır eşleştirse bile PostgREST hata dönmez.
  // Onsuz, başkası önce sahiplendiğinde kullanıcı sessizce "sahiplendim" sanıyordu.
  const { data, error } = await supabase.from('gorusme_notlari')
    .update({ sahip_danisman_id: benim.id }).eq('id', id).is('sahip_danisman_id', null)
    .select('id')
  if (error) return alert('Sahiplenme başarısız: ' + error.message)
  if (!data || !data.length) alert('Bu talebi bu sırada başka bir danışman sahiplendi.')
  await danismanGorunum()
}

// ---------------------------------------------------------------- SANTRAL
async function santralGorunum() {
  const { data, error } = await supabase.from('gorusme_notlari')
    .select(NOT_ALAN).eq('acan_id', benim.id).order('created_at', { ascending: false }).limit(50)
  const liste = data || []
  const baslik = baslikCiz('Ana Sayfa',
    `${selamMetni()}, ${kacis(ilkAd(benim.ad_soyad) || benim.email)} — bugün ${liste.filter(n => bugunMu(n.created_at)).length} talep açtın.`,
    `<a href="talepler.html" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold flex items-center gap-2">${mat('add', 'text-[18px]')} Yeni Talep</a>`)
  const kpi = kpiCiz([
    { sayi: liste.length, etiket: 'Açtığın talepler', ikon: 'assignment', renk: 'bordo' },
    { sayi: liste.filter(n => n.sahip_danisman_id).length, etiket: 'Sahiplenilen', ikon: 'assignment_ind', renk: 'yesil' },
    { sayi: liste.filter(n => !n.sahip_danisman_id).length, etiket: 'Havuzda bekleyen', ikon: 'group', renk: 'mavi' },
    { sayi: liste.filter(n => bugunMu(n.created_at)).length, etiket: 'Bugün', ikon: 'schedule', renk: 'turuncu' },
  ])

  let govde
  if (error) govde = uyari(kacis(error.message))
  else if (!liste.length) govde = bosDurum('Henüz talep açmadın. "Yeni Talep" ile başla.')
  else govde = tabloSarma(
    ['Müşteri', 'Durum', 'Sahip', 'Tarih'],
    liste.map(n => ({
      git: `talep.html?id=${n.talep_id}`,
      hucreler: [
        `<div class="font-bold text-on-surface">${kacis(n.musteri_ad_soyad) || '—'}</div><div class="text-on-surface-variant text-[12px]">${kacis(n.telefon) || ''}</div>`,
        pill(n.musteri_durumu, durumSinifi(n.musteri_durumu)),
        n.sahip_danisman_id ? kacis(danismanAdi(dmap, n.sahip_danisman_id)) : pill('HAVUZDA', 'havuz'),
        gecenSure(n.created_at),
      ],
    })),
    'Açtığın Son Talepler')

  KOK().innerHTML = baslik + kpi + govde
  tabloTikla()
}

// ---------------------------------------------------------------- YÖNETİCİ
// ---------------------------------------------------------------- YÖNETİCİ
// Operasyon merkezi: Öncelikler → KPI (delta+sparkline) → 12 ay trend →
// performans + bekleyenler. Sayımlar sunucu tarafında (RPC), 1000-satır
// limitinden etkilenmez.
const KPI_HEX = { bordo: '#5f1818', turuncu: '#c98a1e', mavi: '#3a7ca5', yesil: '#2e7d4f' }

function sparkSVG(vals, hex) {
  const v = (vals || []).filter(x => x != null && !isNaN(x))
  if (v.length < 2) return '<div class="h-[30px]"></div>'
  const w = 150, h = 30, mx = Math.max(...v), mn = Math.min(...v), rng = (mx - mn) || 1
  const px = i => (i / (v.length - 1) * w).toFixed(1)
  const py = val => (h - 3 - ((val - mn) / rng) * (h - 6)).toFixed(1)
  const pts = v.map((val, i) => `${px(i)},${py(val)}`).join(' ')
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="block mt-1">
    <polygon points="0,${h} ${pts} ${w},${h}" fill="${hex}" opacity="0.08"/>
    <polyline points="${pts}" fill="none" stroke="${hex}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${w}" cy="${py(v[v.length - 1])}" r="2.6" fill="${hex}"/></svg>`
}

function kpiKartV2(k) {
  const hex = KPI_HEX[k.renk] || KPI_HEX.bordo
  const d = k.delta
  const deltaHtml = (d == null)
    ? `<span class="text-label-sm text-on-surface-variant">${k.alt || '&nbsp;'}</span>`
    : `<span class="text-label-sm font-bold ${d > 0 ? 'text-green-700' : d < 0 ? 'text-red-600' : 'text-on-surface-variant'}">${d > 0 ? '▲ +' + d : d < 0 ? '▼ ' + d : '● 0'} <span class="font-normal text-on-surface-variant">düne göre</span></span>`
  return `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">${kacis(k.etiket)}</span>
      <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background:${hex}1f;color:${hex}">${mat(k.ikon, 'text-[20px]')}</span>
    </div>
    <p class="text-headline-md font-bold leading-none text-on-surface">${k.sayi}</p>
    ${deltaHtml}
    ${sparkSVG(k.seri, hex)}
  </div>`
}

const ONCELIK_SEV = {
  kritik: { bg: 'bg-red-50', bd: 'border-red-200', dot: 'bg-red-500', ic: 'text-red-600', et: 'Kritik' },
  uyari:  { bg: 'bg-amber-50', bd: 'border-amber-200', dot: 'bg-amber-500', ic: 'text-amber-600', et: 'Uyarı' },
  bilgi:  { bg: 'bg-blue-50', bd: 'border-blue-200', dot: 'bg-blue-500', ic: 'text-blue-600', et: 'Takip' },
  basari: { bg: 'bg-green-50', bd: 'border-green-200', dot: 'bg-green-500', ic: 'text-green-700', et: 'Bugün' },
}
function oncelikMerkezi(items) {
  const aktif = items.filter(i => i.sayi > 0)
  const govde = aktif.length
    ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
        ${aktif.map(i => { const s = ONCELIK_SEV[i.sev]
          return `<a href="${i.href}" class="${s.bg} border ${s.bd} rounded-2xl p-lg flex items-start gap-3 hover:shadow-md transition-shadow">
            <span class="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center shrink-0 ${s.ic}">${mat(i.ikon, 'text-[22px]')}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5"><span class="w-2 h-2 rounded-full ${s.dot}"></span><span class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${s.et}</span></div>
              <p class="text-title-md font-bold text-on-surface leading-tight"><span class="text-headline-sm">${i.sayi}</span> ${kacis(i.metin)}</p>
            </div></a>`
        }).join('')}</div>`
    : `<div class="bg-secondary-container/40 border border-outline-variant rounded-2xl p-lg flex items-center gap-3 text-on-surface custom-shadow">${mat('task_alt', 'text-secondary')} Bugün acil bir aksiyon yok — her şey yolunda. 🎉</div>`
  return `<section class="space-y-3">
    <h3 class="text-title-lg text-primary flex items-center gap-2">${mat('bolt', 'text-[22px]')} Bugün Yapılması Gerekenler</h3>
    ${govde}
  </section>`
}

let anaGrafik = null
function aylikTrendCiz(trend) {
  const el = document.getElementById('grafikTrend')
  if (!el || typeof Chart === 'undefined' || !trend || !trend.length) return
  anaGrafik?.destroy()
  const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
  const etk = a => { const [y, m] = a.split('-'); return AY[+m - 1] + ' ' + y.slice(2) }
  const ds = (l, k, c, f) => ({ label: l, data: trend.map(t => t[k]), borderColor: c, backgroundColor: f, fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 })
  anaGrafik = new Chart(el, {
    type: 'line',
    data: { labels: trend.map(t => etk(t.ay)), datasets: [
      ds('Talep', 'talep', '#3a7ca5', 'rgba(58,124,165,.08)'),
      ds('Satış', 'satis', '#2e7d4f', 'rgba(46,125,79,.12)'),
      ds('Kayıp', 'kayip', '#c0392b', 'rgba(192,57,43,.07)'),
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(100,100,110,.10)' }, ticks: { precision: 0, font: { size: 11 } } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 9, padding: 14, font: { size: 12 } } },
        tooltip: { padding: 10, usePointStyle: true },
      },
    },
  })
}

async function yoneticiOzet() {
  const dunISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const [ozetR, oncelikR, trendR, gunlukR, notlarR, bekleyenR, satisR] = await Promise.all([
    supabase.rpc('gunluk_ozet_al'),
    supabase.rpc('anasayfa_oncelikler'),
    supabase.rpc('anasayfa_aylik_trend'),
    supabase.from('gunluk_ozet').select('tarih, havuz, aktif, kazanildi, donusum, yeni_talep').order('tarih', { ascending: true }).limit(60),
    supabase.from('gorusme_notlari').select('talep_id, sahip_danisman_id, musteri_durumu'),
    supabase.from('gorusme_notlari')
      .select('id, talep_id, musteri_ad_soyad, telefon, musteri_durumu, acan_id, created_at')
      .is('sahip_danisman_id', null).order('created_at', { ascending: true }).limit(8),
    supabase.from('talepler').select('id, satis_kaydeden').not('satis_tarihi', 'is', null),
  ])
  const bugun = ozetR.data || {}
  const onc = oncelikR.data || {}
  const trend = trendR.data || []
  const gunluk = gunlukR.data || []
  const d = notlarR.data || []
  const satislar = satisR.data || []

  const dun = gunluk.find(g => g.tarih === dunISO)
  const delta = key => (dun && dun[key] != null && bugun[key] != null) ? bugun[key] - dun[key] : null
  const seri = key => gunluk.map(g => g[key])

  const baslik = baslikCiz('Yönetici Özeti',
    `${selamMetni()}, ${kacis(ilkAd(benim.ad_soyad) || benim.email)} — bugünün öncelikleri ve işin genel seyri.`,
    `<a href="dashboard.html" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold flex items-center gap-2 hover:opacity-90">${mat('bar_chart', 'text-[18px]')} Detaylı Panel</a>`)

  const oncelikHtml = oncelikMerkezi([
    { sev: 'kritik', ikon: 'phone_missed', sayi: onc.aranmayan_7g || 0, metin: 'müşteri 7+ gündür aranmadı', href: 'havuz.html' },
    { sev: 'bilgi', ikon: 'credit_score', sayi: onc.kredi_onay_bekleyen || 0, metin: 'kredi kullandırım bekliyor', href: 'kredi-rapor.html' },
    { sev: 'basari', ikon: 'local_shipping', sayi: onc.bugun_teslim || 0, metin: 'bugün satış kaydı', href: 'dashboard.html' },
  ])

  const kpiHtml = `<section class="grid grid-cols-2 lg:grid-cols-4 gap-gutter">
    ${kpiKartV2({ etiket: 'Havuzda bekleyen', sayi: bugun.havuz ?? '—', ikon: 'inbox', renk: 'turuncu', delta: delta('havuz'), seri: seri('yeni_talep'), alt: 'son 30 gün talep girişi' })}
    ${kpiKartV2({ etiket: 'Aktif iş', sayi: bugun.aktif ?? '—', ikon: 'work', renk: 'mavi', delta: delta('aktif'), seri: seri('aktif') })}
    ${kpiKartV2({ etiket: 'Kazanıldı', sayi: bugun.kazanildi ?? '—', ikon: 'verified', renk: 'yesil', delta: delta('kazanildi'), seri: seri('kazanildi') })}
    ${kpiKartV2({ etiket: 'Dönüşüm', sayi: '%' + (bugun.donusum ?? 0), ikon: 'trending_up', renk: 'bordo', delta: delta('donusum'), seri: seri('donusum') })}
  </section>`

  const trendKart = `<section class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
    <h3 class="text-title-lg text-primary mb-1 flex items-center gap-2">${mat('show_chart', 'text-[22px]')} Son 12 Ay — Talep · Satış · Kayıp</h3>
    <p class="text-label-md text-on-surface-variant mb-4">İşin genel seyri: aylık talep girişi, kaydedilen satış ve kayıp.</p>
    <div class="h-72"><canvas id="grafikTrend"></canvas></div>
  </section>`

  // Danışman performansı
  const grup = {}
  for (const n of d) {
    if (!n.sahip_danisman_id) continue
    const g = (grup[n.sahip_danisman_id] ||= { toplam: 0, kazan: 0, kayip: 0, aktif: 0 })
    g.toplam++
    if (kazanildiMi(n.musteri_durumu)) g.kazan++
    else if (kaybedildiMi(n.musteri_durumu)) g.kayip++
    else g.aktif++
  }
  const kazanNotTalep = new Set(d.filter(n => kazanildiMi(n.musteri_durumu)).map(n => n.talep_id))
  for (const t of satislar) {
    if (!t.satis_kaydeden || kazanNotTalep.has(t.id)) continue
    const g = (grup[t.satis_kaydeden] ||= { toplam: 0, kazan: 0, kayip: 0, aktif: 0 })
    g.toplam++; g.kazan++
  }
  const perf = Object.entries(grup)
    .map(([id, g]) => ({ ad: danismanAdi(dmap, id), ...g, oran: (g.kazan + g.kayip) ? Math.round(g.kazan / (g.kazan + g.kayip) * 100) : 0 }))
    .sort((a, b) => b.toplam - a.toplam)
  const enYuk = Math.max(1, ...perf.map(p => p.aktif))
  const perfHtml = perf.length
    ? tabloSarma(['Danışman', 'Aktif iş (yük)', 'Kazanıldı', 'Kaybedildi', 'Dönüşüm'],
        perf.map(s => ({ hucreler: [
          `<span class="font-bold text-on-surface">${kacis(s.ad)}</span>`,
          `<div class="flex items-center gap-2"><span class="w-6 text-right">${s.aktif}</span><div class="flex-1 min-w-[60px] h-2 bg-surface-container-high rounded-full overflow-hidden"><div class="h-full bg-primary rounded-full" style="width:${Math.round(s.aktif / enYuk * 100)}%"></div></div></div>`,
          String(s.kazan), String(s.kayip),
          pill('%' + s.oran, s.oran >= 30 ? 'basari' : s.oran >= 10 ? 'aktif' : 'notr'),
        ] })), 'Danışman Performansı')
    : bosDurum('Henüz sahiplenilen iş yok.')

  // Havuzda uzun bekleyenler
  const bek = bekleyenR.data || []
  const bekHtml = bek.length
    ? tabloSarma(['Müşteri', 'Telefon', 'Durum', 'Açan', 'Bekleme', ''],
        bek.map(n => ({ git: `talep.html?id=${n.talep_id}`, hucreler: [
          `<span class="font-bold text-on-surface">${kacis(n.musteri_ad_soyad) || '—'}</span>`,
          kacis(n.telefon) || '—',
          pill(n.musteri_durumu, durumSinifi(n.musteri_durumu)),
          kacis(danismanAdi(dmap, n.acan_id)),
          gecenSure(n.created_at),
          `<a href="talep.html?id=${n.talep_id}" class="inline-block bg-primary text-on-primary px-3 py-1.5 rounded-lg text-label-md font-bold">Aç</a>`,
        ] })), 'Havuzda Uzun Bekleyenler — acil aksiyon')
    : `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 text-center text-on-surface-variant custom-shadow flex items-center justify-center gap-2">${mat('celebration', 'text-secondary')} Havuzda bekleyen iş yok.</div>`

  const krediBekleyen = await krediBekleyenHtml(true)
  KOK().innerHTML = baslik + oncelikHtml + kpiHtml + trendKart + krediBekleyen
    + `<div class="grid grid-cols-1 xl:grid-cols-2 gap-gutter items-start">${perfHtml}${bekHtml}</div>`
  aylikTrendCiz(trend)
  tabloTikla()
}

// --- Küçük yardımcılar (Stitch) ---
function uyari(metin) {
  return `<div class="bg-error-container text-on-error-container border border-error/20 rounded-xl p-4">${metin}</div>`
}
function bosDurum(metin) {
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant custom-shadow">${kacis(metin)}</div>`
}
function tabloSarma(basliklar, satirlar, kartBaslik = '') {
  return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden custom-shadow">
    ${kartBaslik ? `<div class="p-lg border-b border-outline-variant"><h4 class="text-title-lg text-primary">${kacis(kartBaslik)}</h4></div>` : ''}
    <div class="overflow-x-auto"><table class="w-full text-left zebra-table">
      <thead class="bg-primary text-white"><tr>${basliklar.map(b => `<th class="px-lg py-3 text-label-md font-medium whitespace-nowrap">${b}</th>`).join('')}</tr></thead>
      <tbody class="text-body-md">${satirlar.map(s => `<tr class="${s.git ? 'tiklanir hover:bg-surface-container-low transition-colors cursor-pointer' : ''}"${s.git ? ` data-git="${s.git}"` : ''}>${s.hucreler.map(h => `<td class="px-lg py-md align-middle">${h}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </div>`
}
function tabloTikla() {
  // a/button koruması ŞART: yoksa hücre içindeki linke basınca hem link hem
  // satır navigasyonu tetikleniyor (çifte gezinme). stitch-ui.js'teki eşdeğeri
  // bu kontrolü yapıyordu, buradaki kopya yapmıyordu.
  KOK().querySelectorAll('tr.tiklanir').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('a,button')) return
    location.href = tr.dataset.git
  }))
}
