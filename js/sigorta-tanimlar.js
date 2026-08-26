// =====================================================================
// sigorta-tanimlar.js — Sigorta modülü "Tanımlar" ekranı
//   Sol bölüm listesi + sağ master-detail. Silme YOK → pasife alma.
//   Yazma yalnızca sigorta_yetkili (+ master); personel SALT-OKUR
//   (banner + tüm aksiyonlar gizli). RLS zaten aynı kuralı uygular;
//   buradaki kilit yalnızca arayüz kolaylığı.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'

let benim = null
let yaziliYetki = false          // sigorta_yetkili veya master → düzenleyebilir
let aktifBolum = 'sirketler'
const cache = { sirketler: [], turler: [], tahsilat: [], kartlar: [] }

// --- Enum seçenek listeleri (etiketler Türkçe) ---
const E = {
  fiyatTipi: [['GERCEK_PRIM', 'Gerçek Prim'], ['SABIT_TUTAR', 'Sabit Tutar']],
  iadeKural: [['TAM_PRO_RATA', 'Tam Pro-rata'], ['TAVANLI_PRO_RATA', 'Tavanlı Pro-rata'], ['MANUEL', 'Manuel']],
  vergi:     [['TRAFIK', 'Trafik'], ['KASKO', 'Kasko'], ['YANGIN', 'Yangın'], ['MUAF', 'Muaf']],
  taraf:     [['MUSTERI', 'Müşteri'], ['SIRKET', 'Şirket']],
  sahip:     [['SIRKET', 'Şirket'], ['SAHIS', 'Şahıs']],
}
const etiket = (liste, v) => (liste.find(x => x[0] === v) || [])[1] || v || '—'
const paraTL = n => (n == null || n === '') ? '—' : Number(n).toLocaleString('tr-TR') + ' ₺'
const yuzde = n => (n == null || n === '') ? '—' : '%' + Number(n).toLocaleString('tr-TR')

// FK açılır liste seçenekleri (cache'ten)
const optSirket = () => cache.sirketler.map(s => [s.id, s.ad])
const optTur    = () => cache.turler.map(t => [t.id, t.ad])
const optTahsil = () => cache.tahsilat.map(t => [t.id, t.ad])
const optKart   = () => cache.kartlar.map(k => [k.id, k.ad])
const adBul     = (liste, id) => (liste.find(x => x.id === id) || {}).ad || '—'

// =====================================================================
// BÖLÜM TANIMLARI — her biri: tablo, başlık, ikon, sütunlar, form alanları
//   kolonlar[].v(kayit) → hücre HTML'i
//   alanlar[]           → { k, l, tip, ops?, adim?, ipucu?, zorunlu? }
// =====================================================================
function bolumler() {
  return {
    sirketler: {
      tablo: 'sigorta_sirketleri', baslik: 'Sigorta Şirketleri', ikon: 'apartment',
      sira: 'ad', ad: 'Şirket',
      kolonlar: [
        { b: 'Şirket', v: r => `<div class="font-bold text-on-surface flex items-center gap-2">${r.ana_sirket_id ? mat('subdirectory_arrow_right', 'text-[16px] text-on-surface-variant') : ''}${kacis(r.ad)}${r.kisa_kod ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">${kacis(r.kisa_kod)}</span>` : ''}</div>` },
        { b: 'Bağlı Olduğu', v: r => r.ana_sirket_id ? kacis(adBul(cache.sirketler, r.ana_sirket_id)) : '<span class="text-on-surface-variant">—</span>' },
        { b: 'Kısa Dönem Fiyat', v: r => r.kisa_donem_fiyat_tipi === 'SABIT_TUTAR'
            ? `<span class="font-medium">${paraTL(r.kisa_donem_otomobil)}</span> <span class="text-on-surface-variant text-[11px]">oto</span> / ${paraTL(r.kisa_donem_kamyonet)} <span class="text-on-surface-variant text-[11px]">kmyt</span>`
            : '<span class="text-on-surface-variant">Gerçek Prim</span>' },
        { b: 'İade Kuralı', v: r => r.iade_kural === 'TAVANLI_PRO_RATA'
            ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-error-container text-on-error-container">TAVANLI</span><div class="text-[11px] text-on-surface-variant mt-0.5">>${r.iade_tavan_esik_gun ?? '?'}g → ${paraTL(r.iade_tavan_otomobil)}</div>`
            : `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-secondary-container text-on-secondary-container">${etiket(E.iadeKural, r.iade_kural).toUpperCase()}</span>` },
      ],
      alanlar: [
        { k: 'ad', l: 'Şirket Adı', tip: 'text', zorunlu: true },
        { k: 'kisa_kod', l: 'Kısa Kod (arama)', tip: 'text', ipucu: 'Klavyeyle hızlı arama için (ör. SOMPO)' },
        { k: 'ana_sirket_id', l: 'Bağlı Olduğu Şirket', tip: 'select', ops: optSirket, ipucu: 'Alt şirketse ana şirketi seç; değilse boş bırak' },
        { k: 'kisa_donem_fiyat_tipi', l: 'Kısa Dönem (Yapboz) Fiyat Tipi', tip: 'select', ops: () => E.fiyatTipi },
        { k: 'kisa_donem_otomobil', l: 'Sabit Tutar — Otomobil', tip: 'para', ipucu: 'Yalnız "Sabit Tutar" seçiliyse (ör. 1.500)' },
        { k: 'kisa_donem_kamyonet', l: 'Sabit Tutar — Kamyonet', tip: 'para' },
        { k: 'iade_kural', l: 'İade Kuralı', tip: 'select', ops: () => E.iadeKural },
        { k: 'iade_tavan_esik_gun', l: 'İade Tavan Eşiği (gün)', tip: 'sayi', ipucu: 'Tavanlı ise: bu günden fazla kalanda tavan devreye girer (ör. 30)' },
        { k: 'iade_tavan_otomobil', l: 'İade Tavanı — Otomobil', tip: 'para' },
        { k: 'iade_tavan_kamyonet', l: 'İade Tavanı — Kamyonet', tip: 'para' },
        { k: 'notlar', l: 'Notlar', tip: 'metin' },
      ],
    },
    turler: {
      tablo: 'police_turleri', baslik: 'Poliçe Türleri', ikon: 'category',
      sira: 'sira', ad: 'Poliçe Türü',
      kolonlar: [
        { b: 'Tür', v: r => `<div class="font-bold text-on-surface">${kacis(r.ad)}</div><div class="text-[11px] text-on-surface-variant">${kacis(r.kod)}</div>` },
        { b: 'Taraf', v: r => (r.taraf || []).map(t => `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant mr-1">${etiket(E.taraf, t)}</span>`).join('') },
        { b: 'Vrs. Komisyon', v: r => `<span class="font-medium">${yuzde(r.varsayilan_komisyon)}</span>` },
        { b: 'Vergi Profili', v: r => etiket(E.vergi, r.vergi_profil) },
        { b: 'Araç', v: r => r.arac_gerektirir ? mat('check', 'text-secondary') : mat('remove', 'text-on-surface-variant') },
      ],
      alanlar: [
        { k: 'kod', l: 'Kod (benzersiz)', tip: 'text', zorunlu: true, ipucu: 'TRAFIK, KASKO, YAPBOZ… (büyük harf, tekil)' },
        { k: 'ad', l: 'Görünen Ad', tip: 'text', zorunlu: true },
        { k: 'taraf', l: 'Hangi Sekmede', tip: 'coklu', ops: () => E.taraf },
        { k: 'varsayilan_komisyon', l: 'Varsayılan Komisyon (%)', tip: 'yuzde', ipucu: 'Net üzerinden; şirket override yoksa bu geçerli' },
        { k: 'vergi_profil', l: 'Vergi Profili', tip: 'select', ops: () => E.vergi },
        { k: 'arac_gerektirir', l: 'Araç gerektirir', tip: 'evet_hayir' },
        { k: 'sira', l: 'Sıra', tip: 'sayi' },
      ],
    },
    komisyon: {
      tablo: 'sirket_komisyon_oranlari', baslik: 'Komisyon Oranları (Override)', ikon: 'percent',
      sira: 'gecerli_baslangic', ad: 'Komisyon Oranı', tarih: true,
      aciklama: 'Şirket × tür için özel oran. Boşsa tür varsayılanı kullanılır.',
      kolonlar: [
        { b: 'Şirket', v: r => `<span class="font-bold">${kacis(adBul(cache.sirketler, r.sirket_id))}</span>` },
        { b: 'Tür', v: r => kacis(adBul(cache.turler, r.police_turu_id)) },
        { b: 'Oran', v: r => `<span class="font-bold text-primary">${yuzde(r.oran)}</span>` },
        { b: 'Geçerli', v: r => new Date(r.gecerli_baslangic).toLocaleDateString('tr-TR') },
      ],
      alanlar: [
        { k: 'sirket_id', l: 'Şirket', tip: 'select', ops: optSirket, zorunlu: true },
        { k: 'police_turu_id', l: 'Poliçe Türü', tip: 'select', ops: optTur, zorunlu: true },
        { k: 'oran', l: 'Oran (%)', tip: 'yuzde', zorunlu: true },
        { k: 'gecerli_baslangic', l: 'Geçerlilik Başlangıcı', tip: 'gun' },
      ],
    },
    tahsilat: {
      tablo: 'tahsilat_sekilleri', baslik: 'Tahsilat Şekilleri', ikon: 'payments',
      sira: 'sira', ad: 'Tahsilat Şekli',
      kolonlar: [
        { b: 'Tahsilat Şekli', v: r => `<span class="font-bold">${kacis(r.ad)}</span>` },
        { b: 'Açıklama', v: r => kacis(r.aciklama || '—') },
      ],
      alanlar: [
        { k: 'ad', l: 'Ad', tip: 'text', zorunlu: true },
        { k: 'aciklama', l: 'Açıklama', tip: 'text' },
        { k: 'sira', l: 'Sıra', tip: 'sayi' },
      ],
    },
    kartlar: {
      tablo: 'odeme_kartlari', baslik: 'Ödeme Kartları', ikon: 'credit_card',
      sira: 'ad', ad: 'Ödeme Kartı',
      aciklama: 'Tam kart numarası ASLA saklanmaz — yalnızca son 4 hane.',
      kolonlar: [
        { b: 'Kart', v: r => `<span class="font-bold">${kacis(r.ad)}</span>${r.son_dort ? ` <span class="text-on-surface-variant">•••• ${kacis(r.son_dort)}</span>` : ''}` },
        { b: 'Sahip', v: r => `${etiket(E.sahip, r.sahip_tipi)}${r.sahip_adi ? ' · ' + kacis(r.sahip_adi) : ''}` },
        { b: 'Banka', v: r => kacis(r.banka || '—') },
      ],
      alanlar: [
        { k: 'ad', l: 'Kart Adı', tip: 'text', zorunlu: true, ipucu: 'Ör. Yapboz Kartı, İsmail Bey Şahsi' },
        { k: 'sahip_tipi', l: 'Sahip Tipi', tip: 'select', ops: () => E.sahip, zorunlu: true },
        { k: 'sahip_adi', l: 'Sahip Adı', tip: 'text' },
        { k: 'son_dort', l: 'Son 4 Hane', tip: 'text', ipucu: 'Güvenlik: yalnızca son 4 hane girin' },
        { k: 'banka', l: 'Banka', tip: 'text' },
      ],
    },
    kartKural: {
      tablo: 'tahsilat_kart_kurallari', baslik: 'Kart Eşleme Kuralları', ikon: 'rule',
      sira: 'oncelik', ad: 'Eşleme Kuralı',
      aciklama: '"Tahsilat nasıl yapıldı" cevabına göre doğru kart otomatik gelsin diye.',
      kolonlar: [
        { b: 'Taraf', v: r => etiket(E.taraf, r.taraf) },
        { b: 'Tahsilat Şekli', v: r => r.tahsilat_sekli_id ? kacis(adBul(cache.tahsilat, r.tahsilat_sekli_id)) : '<span class="text-on-surface-variant">(hepsi)</span>' },
        { b: 'Tür', v: r => r.police_turu_id ? kacis(adBul(cache.turler, r.police_turu_id)) : '<span class="text-on-surface-variant">(hepsi)</span>' },
        { b: 'Kart', v: r => `<span class="font-bold">${kacis(adBul(cache.kartlar, r.kart_id))}</span>` },
        { b: 'Öncelik', v: r => r.oncelik },
      ],
      alanlar: [
        { k: 'taraf', l: 'Taraf', tip: 'select', ops: () => E.taraf, zorunlu: true },
        { k: 'tahsilat_sekli_id', l: 'Tahsilat Şekli', tip: 'select', ops: optTahsil, ipucu: 'Şirket tarafında boş bırakılabilir' },
        { k: 'police_turu_id', l: 'Poliçe Türü', tip: 'select', ops: optTur, ipucu: 'Boş = tüm türler' },
        { k: 'kart_id', l: 'Gelecek Kart', tip: 'select', ops: optKart, zorunlu: true },
        { k: 'oncelik', l: 'Öncelik', tip: 'sayi', ipucu: 'Birden fazla eşleşirse yüksek öncelik kazanır' },
      ],
    },
    nedenler: {
      tablo: 'yenilenmeme_nedenleri', baslik: 'Yenilenmeme Nedenleri', ikon: 'cancel',
      sira: 'sira', ad: 'Yenilenmeme Nedeni',
      kolonlar: [{ b: 'Neden', v: r => `<span class="font-bold">${kacis(r.ad)}</span>` }],
      alanlar: [
        { k: 'ad', l: 'Neden', tip: 'text', zorunlu: true },
        { k: 'sira', l: 'Sıra', tip: 'sayi' },
      ],
    },
  }
}

// =====================================================================
// KURULUM
// =====================================================================
export async function tanimlarKur(danisman) {
  benim = danisman
  yaziliYetki = danisman.master_admin === true || danisman.rol === 'sigorta_yetkili'
  await cacheYenile()
  bannerCiz()
  navCiz()
  await bolumCiz()
}

async function cacheYenile() {
  const [s, t, th, k] = await Promise.all([
    supabase.from('sigorta_sirketleri').select('id, ad').order('ad'),
    supabase.from('police_turleri').select('id, ad').order('sira'),
    supabase.from('tahsilat_sekilleri').select('id, ad').order('sira'),
    supabase.from('odeme_kartlari').select('id, ad').order('ad'),
  ])
  cache.sirketler = s.data || []
  cache.turler = t.data || []
  cache.tahsilat = th.data || []
  cache.kartlar = k.data || []
}

function bannerCiz() {
  const el = document.getElementById('tanimBanner')
  if (!yaziliYetki) {
    el.innerHTML = `<div class="flex items-center gap-3 bg-tertiary-container/40 border border-tertiary/20 text-on-surface rounded-xl px-4 py-3">
      ${mat('lock', 'text-tertiary')}<span class="text-body-md">Tanımları yalnızca <b>sigorta yetkilisi</b> değiştirebilir. Bu ekranı salt-okur görüyorsunuz.</span></div>`
  } else {
    el.innerHTML = `<div class="flex items-center gap-3 bg-surface-container-low border border-outline-variant text-on-surface-variant rounded-xl px-4 py-3">
      ${mat('info', 'text-primary')}<span class="text-body-md">Kayıtlar silinmez, <b>pasife alınır</b> — geçmiş raporlar korunur.</span></div>`
  }
}

function navCiz() {
  const B = bolumler()
  const nav = document.getElementById('tanimNav')
  const oge = (key, b, sayi) => {
    const a = key === aktifBolum
    return `<button data-bolum="${key}" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${a ? 'bg-primary-fixed text-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-low'}">
      ${mat(b.ikon, a ? 'text-primary' : '')}<span class="flex-1 text-label-md">${b.baslik}</span>
      ${sayi != null ? `<span class="text-[11px] font-bold ${a ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'} px-1.5 py-0.5 rounded-full min-w-[20px] text-center">${sayi}</span>` : ''}</button>`
  }
  nav.innerHTML = Object.entries(B).map(([k, b]) => oge(k, b, null)).join('')
    + `<div class="border-t border-outline-variant my-1"></div>`
    + `<button data-bolum="ayarlar" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${aktifBolum === 'ayarlar' ? 'bg-primary-fixed text-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-low'}">
        ${mat('settings', aktifBolum === 'ayarlar' ? 'text-primary' : '')}<span class="flex-1 text-label-md">Ayarlar</span></button>`
  nav.querySelectorAll('[data-bolum]').forEach(el => el.addEventListener('click', () => {
    aktifBolum = el.dataset.bolum; navCiz(); bolumCiz()
  }))
}

async function bolumCiz() {
  if (aktifBolum === 'ayarlar') return ayarlarCiz()
  const B = bolumler()[aktifBolum]
  const kok = document.getElementById('tanimIcerik')
  kok.innerHTML = `<div class="p-10 text-center text-on-surface-variant">${mat('progress_activity', 'animate-spin')} Yükleniyor…</div>`

  let q = supabase.from(B.tablo).select('*')
  const { data, error } = await q.order(B.sira, { ascending: true })
  if (error) { kok.innerHTML = `<div class="bg-error-container text-on-error-container rounded-xl p-4">Yüklenemedi: ${kacis(error.message)}</div>`; return }
  const rows = data || []
  // Pasifler en altta
  rows.sort((a, b) => (a.aktif === false) - (b.aktif === false))

  const yeniBtn = yaziliYetki
    ? `<button id="tanimYeni" class="bg-primary text-on-primary pl-3 pr-4 h-10 flex items-center gap-1.5 rounded-lg text-label-md font-bold hover:opacity-90 transition-all shadow-sm shadow-primary/20">${mat('add', 'text-[20px]')} Yeni ${kacis(B.ad)}</button>`
    : ''

  const varAktif = 'aktif' in (rows[0] || B.alanlar.reduce((o, a) => (o[a.k] = null, o), {}))
  const kolonSayisi = B.kolonlar.length + (varAktif ? 1 : 0) + (yaziliYetki ? 1 : 0)

  kok.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h3 class="text-title-lg text-primary flex items-center gap-2">${mat(B.ikon, 'text-[22px]')} ${kacis(B.baslik)} <span class="text-on-surface-variant font-normal text-body-md">(${rows.length})</span></h3>
        ${B.aciklama ? `<p class="text-label-md text-on-surface-variant mt-0.5">${kacis(B.aciklama)}</p>` : ''}
      </div>
      ${yeniBtn}
    </div>
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden custom-shadow">
      <div class="overflow-x-auto"><table class="w-full text-left">
        <thead class="bg-surface-container-low border-b border-outline-variant">
          <tr>${B.kolonlar.map(c => `<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant whitespace-nowrap">${c.b}</th>`).join('')}
            ${varAktif ? '<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Durum</th>' : ''}
            ${yaziliYetki ? '<th class="px-4 py-3"></th>' : ''}</tr>
        </thead>
        <tbody class="divide-y divide-outline-variant text-body-md">
          ${rows.length ? rows.map(r => satirCiz(B, r, varAktif)).join('')
            : `<tr><td colspan="${kolonSayisi}" class="px-4 py-10 text-center text-on-surface-variant">Kayıt yok.${yaziliYetki ? ' “Yeni” ile ekleyin.' : ''}</td></tr>`}
        </tbody>
      </table></div>
    </div>`

  kok.querySelector('#tanimYeni')?.addEventListener('click', () => formAc(aktifBolum, null))
  kok.querySelectorAll('[data-duzenle]').forEach(el => el.addEventListener('click', () => {
    formAc(aktifBolum, rows.find(r => r.id === el.dataset.duzenle))
  }))
  kok.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('click', () =>
    aktifDegistir(B.tablo, el.dataset.toggle, el.dataset.durum === '1')))
}

function satirCiz(B, r, varAktif) {
  const pasif = r.aktif === false
  return `<tr class="${pasif ? 'opacity-50' : ''} hover:bg-surface-container-low transition-colors">
    ${B.kolonlar.map(c => `<td class="px-4 py-3 align-middle">${c.v(r)}</td>`).join('')}
    ${varAktif ? `<td class="px-4 py-3">${
      yaziliYetki
        ? `<button data-toggle="${r.id}" data-durum="${pasif ? 0 : 1}" title="${pasif ? 'Aktifleştir' : 'Pasife al'}" class="relative w-11 h-6 rounded-full transition-colors ${pasif ? 'bg-surface-container-high' : 'bg-secondary'}"><span class="absolute top-0.5 ${pasif ? 'left-0.5' : 'left-5'} w-5 h-5 bg-white rounded-full shadow transition-all"></span></button>`
        : `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${pasif ? 'bg-surface-container text-on-surface-variant' : 'bg-secondary-container text-on-secondary-container'}">${pasif ? 'Pasif' : 'Aktif'}</span>`
    }</td>` : ''}
    ${yaziliYetki ? `<td class="px-4 py-3 text-right"><button data-duzenle="${r.id}" class="text-on-surface-variant hover:text-primary p-1.5 rounded-lg hover:bg-surface-container" title="Düzenle">${mat('edit', 'text-[20px]')}</button></td>` : ''}
  </tr>`
}

async function aktifDegistir(tablo, id, suAn) {
  const { error } = await supabase.from(tablo).update({ aktif: !suAn }).eq('id', id)
  if (dbHata('aktif degistir', error)) { alert('Güncellenemedi: ' + error.message); return }
  await cacheYenile(); bolumCiz()
}

// =====================================================================
// FORM (yeni/düzenle) — modal
// =====================================================================
function formAc(bolumKey, kayit) {
  const B = bolumler()[bolumKey]
  const yeni = !kayit
  const alanHtml = B.alanlar.map(a => alanCiz(a, kayit ? kayit[a.k] : null)).join('')

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[8vh] px-4 overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-lg mb-10" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-lg py-4 border-b border-outline-variant sticky top-0 bg-surface-container-lowest rounded-t-2xl">
      <h3 class="text-title-lg text-primary flex items-center gap-2">${mat(yeni ? 'add_circle' : 'edit', 'text-[22px]')} ${yeni ? 'Yeni' : 'Düzenle'} — ${kacis(B.ad)}</h3>
      <button id="formKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button>
    </div>
    <form id="tanimForm" class="p-lg space-y-4">${alanHtml}
      <div id="formHata" class="hidden text-body-md bg-error-container text-on-error-container rounded-lg px-3 py-2"></div>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="formIptal" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">İptal</button>
        <button type="submit" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 shadow-sm shadow-primary/20 flex items-center gap-1.5">${mat('save', 'text-[18px]')} Kaydet</button>
      </div>
    </form>
  </div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelector('#formKapat').addEventListener('click', kapat)
  ov.querySelector('#formIptal').addEventListener('click', kapat)

  ov.querySelector('#tanimForm').addEventListener('submit', async e => {
    e.preventDefault()
    const btn = e.submitter; if (btn) btn.disabled = true
    const hata = ov.querySelector('#formHata')
    hata.classList.add('hidden')
    const payload = {}
    for (const a of B.alanlar) payload[a.k] = deger(ov, a)
    // Zorunlu kontrol
    for (const a of B.alanlar) if (a.zorunlu && (payload[a.k] == null || payload[a.k] === '')) {
      hata.textContent = `"${a.l}" zorunlu.`; hata.classList.remove('hidden'); if (btn) btn.disabled = false; return
    }
    let error
    if (yeni) ({ error } = await supabase.from(B.tablo).insert(payload))
    else ({ error } = await supabase.from(B.tablo).update(payload).eq('id', kayit.id))
    if (error) {
      console.error('tanim kaydet', error)
      hata.textContent = 'Kaydedilemedi: ' + error.message; hata.classList.remove('hidden')
      if (btn) btn.disabled = false; return
    }
    kapat()
    await cacheYenile(); navCiz(); bolumCiz()
  })
}

// Alan girdisi HTML'i
function alanCiz(a, val) {
  const id = 'f_' + a.k
  const ipucu = a.ipucu ? `<p class="text-[11px] text-on-surface-variant mt-1">${kacis(a.ipucu)}</p>` : ''
  const lbl = `<label for="${id}" class="block text-label-md font-bold text-on-surface mb-1">${kacis(a.l)}${a.zorunlu ? ' <span class="text-error">*</span>' : ''}</label>`
  const cls = 'w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none'

  if (a.tip === 'select') {
    const ops = (a.ops ? a.ops() : [])
    return `<div>${lbl}<select id="${id}" class="${cls}">
      <option value="">— seçin —</option>
      ${ops.map(([v, l]) => `<option value="${kacis(v)}"${String(val) === String(v) ? ' selected' : ''}>${kacis(l)}</option>`).join('')}
    </select>${ipucu}</div>`
  }
  if (a.tip === 'coklu') {
    const ops = a.ops ? a.ops() : []
    const seci = Array.isArray(val) ? val : []
    return `<div>${lbl}<div class="flex flex-wrap gap-2">${ops.map(([v, l]) => `
      <label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant cursor-pointer hover:border-primary">
        <input type="checkbox" name="${a.k}" value="${kacis(v)}"${seci.includes(v) ? ' checked' : ''} class="accent-[#5f1818]" /><span class="text-body-md">${kacis(l)}</span></label>`).join('')}</div>${ipucu}</div>`
  }
  if (a.tip === 'evet_hayir') {
    return `<div class="flex items-center justify-between"><div>${lbl.replace('mb-1', '')}${ipucu}</div>
      <input type="checkbox" id="${id}" ${val ? 'checked' : ''} class="w-5 h-5 accent-[#5f1818]" /></div>`
  }
  if (a.tip === 'metin') {
    return `<div>${lbl}<textarea id="${id}" rows="2" class="${cls}">${kacis(val || '')}</textarea>${ipucu}</div>`
  }
  // text / sayi / para / yuzde / gun
  const inputTip = (a.tip === 'sayi' || a.tip === 'para' || a.tip === 'yuzde') ? 'number' : (a.tip === 'gun' ? 'date' : 'text')
  const adim = a.tip === 'para' ? ' step="0.01"' : (a.tip === 'yuzde' ? ' step="0.001"' : '')
  const on = a.tip === 'para' ? '<span class="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-body-md">₺</span>'
    : a.tip === 'yuzde' ? '<span class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-body-md">%</span>' : ''
  const pad = a.tip === 'yuzde' ? ' pl-7' : (a.tip === 'para' ? ' pr-7' : '')
  return `<div>${lbl}<div class="relative">${on}<input type="${inputTip}"${adim} id="${id}" value="${val == null ? '' : kacis(val)}" class="${cls}${pad}" /></div>${ipucu}</div>`
}

// Alan değerini oku + tipe göre normalize et ('' → null)
function deger(ov, a) {
  if (a.tip === 'coklu') {
    return Array.from(ov.querySelectorAll(`input[name="${a.k}"]:checked`)).map(c => c.value)
  }
  if (a.tip === 'evet_hayir') return ov.querySelector('#f_' + a.k).checked
  const el = ov.querySelector('#f_' + a.k)
  let v = el.value.trim()
  if (v === '') return null
  if (a.tip === 'sayi' || a.tip === 'para' || a.tip === 'yuzde') return Number(v)
  return v
}

// =====================================================================
// AYARLAR (sistem eşikleri) — anahtar/değer, satır bazlı kaydet
// =====================================================================
async function ayarlarCiz() {
  const kok = document.getElementById('tanimIcerik')
  kok.innerHTML = `<div class="p-10 text-center text-on-surface-variant">${mat('progress_activity', 'animate-spin')} Yükleniyor…</div>`
  const { data, error } = await supabase.from('sigorta_ayarlari').select('*').order('anahtar')
  if (error) { kok.innerHTML = `<div class="bg-error-container text-on-error-container rounded-xl p-4">Yüklenemedi: ${kacis(error.message)}</div>`; return }
  const rows = data || []
  const bool = v => v === 'true' || v === 'false'

  kok.innerHTML = `
    <h3 class="text-title-lg text-primary flex items-center gap-2">${mat('settings', 'text-[22px]')} Ayarlar <span class="text-on-surface-variant font-normal text-body-md">(${rows.length})</span></h3>
    <p class="text-label-md text-on-surface-variant">Bildirim eşikleri ve yapboz kuralları. ${yaziliYetki ? 'Değeri değiştirip Enter’a basın.' : 'Salt-okur.'}</p>
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow divide-y divide-outline-variant">
      ${rows.map(r => `<div class="flex items-center gap-4 px-lg py-3.5">
        <div class="flex-1 min-w-0">
          <div class="font-mono text-label-md text-on-surface">${kacis(r.anahtar)}</div>
          <div class="text-[12px] text-on-surface-variant">${kacis(r.aciklama || '')}</div>
        </div>
        <div class="shrink-0">${
          !yaziliYetki
            ? `<span class="font-mono font-bold text-primary px-3 py-1.5 bg-surface-container-low rounded-lg">${kacis(r.deger)}</span>`
            : bool(r.deger)
              ? `<button data-ayar="${kacis(r.anahtar)}" data-bool="1" class="relative w-11 h-6 rounded-full transition-colors ${r.deger === 'true' ? 'bg-secondary' : 'bg-surface-container-high'}"><span class="absolute top-0.5 ${r.deger === 'true' ? 'left-5' : 'left-0.5'} w-5 h-5 bg-white rounded-full shadow transition-all"></span></button>`
              : `<input data-ayar="${kacis(r.anahtar)}" value="${kacis(r.deger)}" class="w-28 text-center font-mono font-bold text-primary bg-surface border border-outline-variant rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none" />`
        }</div>
      </div>`).join('')}
    </div>`

  if (!yaziliYetki) return
  kok.querySelectorAll('input[data-ayar]').forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur() })
    el.addEventListener('change', () => ayarKaydet(el.dataset.ayar, el.value.trim(), el))
  })
  kok.querySelectorAll('button[data-ayar]').forEach(el => el.addEventListener('click', async () => {
    const yeni = el.classList.contains('bg-secondary') ? 'false' : 'true'
    await ayarKaydet(el.dataset.ayar, yeni)
    ayarlarCiz()
  }))
}

async function ayarKaydet(anahtar, deger, el) {
  const { error } = await supabase.from('sigorta_ayarlari').update({ deger, guncelleyen: benim.email, updated_at: new Date().toISOString() }).eq('anahtar', anahtar)
  if (error) { console.error('ayar kaydet', error); alert('Kaydedilemedi: ' + error.message); return }
  if (el) { el.classList.add('ring-2', 'ring-secondary'); setTimeout(() => el.classList.remove('ring-2', 'ring-secondary'), 800) }
}
