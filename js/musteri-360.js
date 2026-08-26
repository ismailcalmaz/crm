// =====================================================================
// musteri-360.js — MÜŞTERİ 360° (tek müşteri, tüm modüller)
//
//   Göksenil (1 Ağu 2026): "müşterinin hangi modülde olursa olsun verileri
//   tek bir yerde toplanmalı… ilgili müşteriye ne yaptıysak aynı kayıtta
//   hepsini görmeliyim: poliçesi var, kredi modülünden şu bankadan onaylı,
//   cari hareketlerinde şu transferi var, bu araçları aldı sattı."
//
//   VERİ: tek çağrı → musteri_360(uuid) (sql/124). SECURITY INVOKER, yani
//   RLS AYNEN İŞLER: sigorta/kredi görme yetkisi olmayanda o bölümler BOŞ
//   döner. Sayfa yetki AÇMAZ, yalnız birleştirir.
//
//   ⚠️ AI ASİSTAN paneli TASARIMDA VAR ama YAKINDA (Göksenil kararı).
//      Sahte skor/özet ÜRETİLMEZ — uydurma rakam gerçek sanılır. Panel
//      ne olacağını anlatır, veri gelmez.
//   ⚠️ İLETİŞİM GEÇMİŞİ (telefon/WhatsApp/SMS) de YAKINDA: santral
//      entegrasyonu henüz yok, veri kaynağı yok.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, buyuk, fmtPara, fmtTarih, fmtTarihKisa, telNo, dbHata, urlParam } from './veri.js'
import { mat, basHarf, uyari } from './stitch-ui.js'

const KOK = () => document.getElementById('kok')
let BEN = null, MID = null, D = null, sekme = 'genel'

const B = v => kacis(buyuk(v ?? ''))
const bos = (m, ik = 'inbox') => `<div class="text-center py-10 text-on-surface-variant">${mat(ik, 'text-3xl opacity-30')}<p class="mt-2 text-body-md">${kacis(m)}</p></div>`

export async function musteri360Kur(d) {
  BEN = d || null
  MID = urlParam('id')
  if (!MID) { KOK().innerHTML = uyari('Müşteri seçilmedi. Müşteri Merkezi\'nden bir müşteri açın.'); return }
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Müşteri 360° yükleniyor…</div>`
  await yukle()
}

async function yukle() {
  const { data, error } = await supabase.rpc('musteri_360', { p_musteri_id: MID })
  if (error) { dbHata('musteri_360', error); KOK().innerHTML = uyari('Müşteri okunamadı: ' + kacis(error.message)); return }
  D = data || {}
  if (!D.genel) { KOK().innerHTML = uyari('Müşteri bulunamadı.'); return }
  ciz()
}

function ciz() {
  KOK().innerHTML = `
    <div class="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-lg items-start">
      <div class="space-y-lg min-w-0">
        ${basligHtml()}
        ${kpiHtml()}
        ${sekmeCubuguHtml()}
        <div id="m360Govde"></div>
      </div>
      ${aiPanelHtml()}
    </div>`
  govdeCiz()
  KOK().querySelectorAll('[data-sekme]').forEach(b => b.addEventListener('click', () => {
    sekme = b.dataset.sekme
    KOK().querySelectorAll('[data-sekme]').forEach(x => sekmeStil(x, x.dataset.sekme === sekme))
    govdeCiz()
  }))
}

function sekmeStil(el, aktif) {
  el.className = `whitespace-nowrap flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-lg transition-all ${
    aktif ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-lowest/50'}`
}

// ---------- BAŞLIK ----------
function basligHtml() {
  const g = D.genel || {}
  const k = D.kpi || {}
  const tuzel = g.tip === 'TUZEL'
  // Modül rozetleri: o modülde VERİSİ VARSA yeşil nokta. Yetkisi olmayanda
  // veri boş döner → nokta sönük olur; bu doğru, "yok" demiyoruz, "görünmüyor".
  const modul = (ad, ik, varMi) => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-outline-variant bg-surface-container-lowest text-[11px] font-bold">
    ${mat(ik, 'text-[14px] text-on-surface-variant')} ${kacis(ad)}
    <span class="w-1.5 h-1.5 rounded-full ${varMi ? 'bg-green-500' : 'bg-outline-variant'}"></span></span>`
  return `<section class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
    <div class="flex flex-wrap items-start gap-lg">
      <div class="w-20 h-20 rounded-2xl bg-primary-fixed text-primary flex items-center justify-center text-title-lg font-black shrink-0">${basHarf(g.ad_soyad)}</div>
      <div class="flex-1 min-w-[260px]">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-headline-sm font-black text-on-surface">${B(g.ad_soyad) || '—'}</h2>
          <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${tuzel ? 'bg-blue-100 text-blue-800' : 'bg-secondary-container text-on-secondary-container'}">${tuzel ? 'Tüzel' : 'Şahıs'}</span>
        </div>
        <div class="flex flex-wrap gap-x-lg gap-y-1 mt-2 text-body-md text-on-surface-variant">
          ${g.telefon ? `<span class="inline-flex items-center gap-1">${mat('call', 'text-[16px]')} ${kacis(telNo(g.telefon))}</span>` : ''}
          ${g.e_posta ? `<span class="inline-flex items-center gap-1">${mat('mail', 'text-[16px]')} ${kacis(g.e_posta)}</span>` : ''}
          ${g.adres ? `<span class="inline-flex items-center gap-1">${mat('place', 'text-[16px]')} ${kacis(g.adres)}</span>` : ''}
        </div>
        <div class="flex flex-wrap gap-x-lg gap-y-1 mt-1.5 text-[12px] text-on-surface-variant">
          <span>İlk kayıt: <b class="text-on-surface">${g.created_at ? fmtTarihKisa(g.created_at) : '—'}</b></span>
          ${g.kimlik ? `<span>${tuzel ? 'Vergi No' : 'TCKN'}: <b class="text-on-surface font-mono">${kacis(g.kimlik)}</b></span>` : ''}
          ${g.meslek_grubu ? `<span>Meslek: <b class="text-on-surface">${kacis(g.meslek_grubu.replace(/_/g, ' '))}</b></span>` : ''}
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <span class="text-[10px] uppercase tracking-wide text-on-surface-variant">Modüller</span>
        <div class="flex flex-wrap gap-1.5 max-w-[330px]">
          ${modul('DMS', 'directions_car', (k.aldigi_arac + k.sattigi_arac + (k.arsiv_arac || 0)) > 0)}
          ${modul('Sigorta', 'shield', k.aktif_police > 0 || k.sigorta_eslesme > 0)}
          ${modul('Kredi', 'account_balance', k.kredi_basvuru > 0)}
          ${modul('Cari', 'receipt_long', (D.cari || []).length > 0 || (D.arsiv_cari || []).length > 0)}
          ${(k.arsiv_arac || k.arsiv_cari_adet) ? modul('Arşiv', 'inventory_2', true) : ''}
        </div>
      </div>
    </div>
  </section>`
}

// ---------- KPI ----------
function kpiHtml() {
  const k = D.kpi || {}
  const kart = (ik, et, deger, renk) => `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
    <div class="flex items-center gap-2 text-on-surface-variant">${mat(ik, 'text-[18px]')}<span class="text-[11px] font-bold uppercase tracking-wide">${kacis(et)}</span></div>
    <p class="text-headline-sm font-black mt-1.5 ${renk || 'text-on-surface'}">${deger}</p></div>`
  const bakiye = Number(k.cari_bakiye || 0)
  return `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-gutter">
    ${kart('directions_car', 'Satın Aldığı', k.aldigi_arac ?? 0)}
    ${kart('swap_horiz', 'Bize Sattığı', k.sattigi_arac ?? 0)}
    ${kart('shield', 'Aktif Poliçe', k.aktif_police ?? 0)}
    ${kart('account_balance', 'Kredi Başvurusu', k.kredi_basvuru ?? 0)}
    ${kart('account_balance_wallet', 'Cari Bakiye', fmtPara(bakiye), bakiye < 0 ? 'text-error' : 'text-green-700')}
    ${kart('bar_chart', 'İşlem Hacmi', fmtPara(k.islem_hacmi || 0))}
  </div>`
}

// ---------- SEKME ÇUBUĞU ----------
const SEKMELER = [
  ['genel', 'Genel', 'dashboard'],
  ['araclar', 'Araçlar', 'directions_car'],
  ['sigorta', 'Sigorta', 'shield'],
  ['kredi', 'Kredi', 'account_balance'],
  ['cari', 'Cari', 'receipt_long'],
  ['zaman', 'Zaman Tüneli', 'timeline'],
]
function sekmeCubuguHtml() {
  return `<div class="bg-surface-container rounded-xl p-1 flex gap-1 overflow-x-auto">
    ${SEKMELER.map(([k, l, ik]) => `<button data-sekme="${k}" class="whitespace-nowrap flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-lg transition-all ${k === sekme ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-lowest/50'}">${mat(ik, 'text-[18px]')}${kacis(l)}</button>`).join('')}
  </div>`
}

function govdeCiz() {
  const el = document.getElementById('m360Govde'); if (!el) return
  el.innerHTML = sekme === 'genel' ? genelHtml()
    : sekme === 'araclar' ? aracGovde()
    : sekme === 'sigorta' ? kutu('Sigorta Poliçeleri', 'shield', policeListe())
    : sekme === 'kredi' ? kutu('Kredi Başvuruları', 'account_balance', krediListe())
    : sekme === 'cari' ? kutu('Cari Hareketler', 'receipt_long', cariListe())
    : kutu('Zaman Tüneli', 'timeline', zamanTuneli())
}

function kutu(baslik, ik, govde, ek) {
  return `<section class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-hidden">
    <div class="flex items-center justify-between gap-2 px-lg py-3 border-b border-outline-variant">
      <h3 class="text-title-md text-primary flex items-center gap-2">${mat(ik, 'text-[20px]')} ${kacis(baslik)}</h3>${ek || ''}
    </div>
    <div class="p-lg">${govde}</div></section>`
}

function genelHtml() {
  return `<div class="space-y-lg">
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
      ${kutu('Araç Geçmişi', 'directions_car', aracListe(6))}
      ${kutu('Sigorta Poliçeleri', 'shield', policeListe(4))}
      ${kutu('Finansman & Kredi', 'account_balance', krediListe(4))}
    </div>
    ${kutu('Zaman Tüneli', 'timeline', zamanTuneli(12))}
  </div>`
}

// ---------- LİSTELER ----------
function aracSatiri(a, tur) {
  const ad = [a.marka, a.model, a.versiyon].filter(Boolean).join(' ')
  const tarih = tur === 'ALDI' ? (a.satis_tarihi || a.created_at) : a.alis_tarihi
  const tutar = tur === 'ALDI' ? a.anlasilan_tutar : a.alis_fiyati
  const rozet = tur === 'ALDI'
    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary-container text-on-secondary-container">Satın Aldı</span>`
    : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">Bize Sattı</span>`
  const iptal = a.durum === 'IPTAL' ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-container-high text-on-surface-variant">İptal</span>` : ''
  return `<div class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
    <div class="min-w-0 flex-1">
      <p class="text-body-md font-bold text-on-surface truncate">${B(ad) || '—'}${a.yil ? ` <span class="text-on-surface-variant font-normal">${kacis(a.yil)}</span>` : ''}</p>
      <p class="text-[11px] text-on-surface-variant">${a.plaka ? B(a.plaka) + ' · ' : ''}${tarih ? fmtTarihKisa(tarih) : '—'}</p>
    </div>
    <div class="text-right shrink-0">
      <p class="text-body-md font-bold text-on-surface">${tutar ? fmtPara(tutar) : '—'}</p>
      <div class="flex gap-1 justify-end mt-0.5">${rozet}${iptal}</div>
    </div></div>`
}
function aracListe(limit) {
  const hepsi = [
    ...(D.aldigi || []).map(a => ({ a, t: 'ALDI', ts: a.satis_tarihi || a.created_at })),
    ...(D.sattigi || []).map(a => ({ a, t: 'SATTI', ts: a.alis_tarihi })),
  ].sort((x, y) => new Date(y.ts || 0) - new Date(x.ts || 0))
  if (!hepsi.length) return bos('Bu müşteriyle araç işlemi yok.', 'directions_car')
  const g = limit ? hepsi.slice(0, limit) : hepsi
  return g.map(x => aracSatiri(x.a, x.t)).join('') +
    (limit && hepsi.length > limit ? `<p class="text-[11px] text-on-surface-variant text-center pt-2">+${hepsi.length - limit} işlem daha — Araçlar sekmesi</p>` : '')
}
function aracGovde() { return kutu('Araç Geçmişi', 'directions_car', aracListe() + arsivAracBolumu()) }

// GURU arşivinde bu müşteriye satılan araçlar (sql/142). Satış Merkezi'ndeki
// arşiv kaydına köprü verir; ayrı bir "geçmiş" sayfası YOK.
function arsivAracBolumu() {
  const a = D.arsiv_aldigi || []
  if (!a.length) return ''
  return `<div class="mt-lg pt-lg border-t-2 border-dashed border-outline-variant">
    <h4 class="text-title-sm text-on-surface font-bold flex items-center gap-1.5 mb-3">
      ${mat('inventory_2', 'text-[18px] text-on-surface-variant')} Arşiv Araçları (GURU)
      <span class="text-[11px] font-normal text-on-surface-variant">${kacis(String(a.length))} araç</span></h4>
    ${a.map(x => `<div class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
      <div class="min-w-0 flex-1">
        <p class="text-body-md font-bold text-on-surface"><span class="tabular-nums">${B(x.plaka) || '—'}</span>
          <span class="font-normal text-on-surface-variant">${[x.yil, x.marka, x.model].filter(Boolean).map(v => kacis(String(v))).join(' ')}</span></p>
        <p class="text-[11px] text-on-surface-variant">${x.satis_tarihi ? kacis(fmtTarihKisa(x.satis_tarihi)) : ''}${x.satis_sekli ? ' · ' + kacis(x.satis_sekli) : ''}${x.satis_sorumlusu ? ' · ' + kacis(x.satis_sorumlusu) : ''}</p>
      </div>
      <p class="text-body-md font-bold shrink-0 tabular-nums">${fmtPara(x.anlasilan_tutar)}</p>
    </div>`).join('')}
    <p class="text-[11px] text-on-surface-variant mt-2">Eski sistemden aktarıldı, salt okunur. Ayrıntı için Satış Merkezi → Arşiv.</p>
  </div>`
}

function policeListe(limit) {
  const p = D.policeler || []
  if (!p.length) return bos('Poliçe kaydı yok (ya da sigorta görme yetkiniz yok).', 'shield')
  const g = limit ? p.slice(0, limit) : p
  return g.map(x => `<div class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
    <div class="min-w-0 flex-1">
      <p class="text-body-md font-bold text-on-surface truncate">${kacis(x.sirket_ad || '—')}</p>
      <p class="text-[11px] text-on-surface-variant">${kacis(x.tur_ad || '')}${x.plaka ? ' · ' + B(x.plaka) : ''}</p>
    </div>
    <div class="text-right shrink-0">
      <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${x.durum === 'AKTIF' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}">${kacis(x.durum || '—')}</span>
      <p class="text-[11px] text-on-surface-variant mt-0.5">${x.baslangic ? fmtTarihKisa(x.baslangic) : ''}${x.bitis ? ' → ' + fmtTarihKisa(x.bitis) : ''}</p>
    </div></div>`).join('') +
    (limit && p.length > limit ? `<p class="text-[11px] text-on-surface-variant text-center pt-2">+${p.length - limit} poliçe daha</p>` : '')
}

function krediListe(limit) {
  const k = D.krediler || []
  if (!k.length) return bos('Kredi başvurusu yok (ya da görme yetkiniz yok).', 'account_balance')
  const g = limit ? k.slice(0, limit) : k
  return g.map(x => `<div class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
    <div class="min-w-0 flex-1">
      <p class="text-body-md font-bold text-on-surface truncate">${kacis(x.arac_ozet || x.plaka || 'Başvuru')}</p>
      <p class="text-[11px] text-on-surface-variant">${x.created_at ? fmtTarihKisa(x.created_at) : ''}${x.bekleme_nedeni ? ' · ' + kacis(x.bekleme_nedeni) : ''}</p>
    </div>
    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${x.sonuc === 'OLUMLU' ? 'bg-secondary-container text-on-secondary-container' : x.sonuc === 'OLUMSUZ' ? 'bg-error-container text-on-error-container' : 'bg-surface-container-high text-on-surface-variant'}">${kacis(x.sonuc || x.durum || '—')}</span>
  </div>`).join('') +
    (limit && k.length > limit ? `<p class="text-[11px] text-on-surface-variant text-center pt-2">+${k.length - limit} başvuru daha</p>` : '')
}

// GURU arşiv carisi (sql/142). CANLI CARİYE KARIŞTIRILMAZ — ayrı bölüm,
// ayrı toplam. Arşiv 2017-11 → 2024-10 arasını kapsar ve kapanmış
// hareketlerdir; canlı bakiyeye eklenirse teslimat kapısı dahil her
// gösterge yanılır (bkz. sql/142 başlığı).
function arsivCariBolumu() {
  const a = D.arsiv_cari || []
  const o = D.arsiv_ozet || {}
  if (!a.length) return ''
  const borc = Number(o.borc || 0), alacak = Number(o.alacak || 0), fark = Number(o.fark || 0)
  return `<div class="mt-lg pt-lg border-t-2 border-dashed border-outline-variant">
    <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3">
      <h4 class="text-title-sm text-on-surface font-bold flex items-center gap-1.5">${mat('inventory_2', 'text-[18px] text-on-surface-variant')} Arşiv Cari (GURU)</h4>
      <span class="text-[11px] text-on-surface-variant">${kacis(String(o.adet ?? a.length))} hareket${o.ilk ? ' · ' + kacis(fmtTarihKisa(o.ilk)) + ' – ' + kacis(fmtTarihKisa(o.son)) : ''}</span>
    </div>
    <div class="flex flex-wrap gap-x-6 gap-y-1 mb-1 text-body-md">
      <span class="text-on-surface-variant">Borç <b class="text-on-surface tabular-nums">${fmtPara(borc)}</b></span>
      <span class="text-on-surface-variant">Tahsilat <b class="text-green-700 tabular-nums">${fmtPara(alacak)}</b></span>
      <span class="text-on-surface-variant">Fark <b class="tabular-nums ${Math.abs(fark) < 0.005 ? 'text-on-surface' : 'text-error'}">${fmtPara(fark)}</b></span>
    </div>
    ${o.sapmali ? `<p class="text-[11px] text-error mb-3">⚠️ ${kacis(String(o.sapmali))} hareketin tutarı ölçek olarak absürt (eski sistem giriş hatası). Değerler değiştirilmedi ama toplamlara katılmadı.</p>` : '<div class="mb-3"></div>'}
    ${a.map(x => {
      const tutar = Number(x.alacak) || 0 ? Number(x.alacak) : -(Number(x.borc) || 0)
      const gelen = tutar > 0
      // ⚠️ Başlık `kasa`dan gelir. `hareket_tipi` 42.156 satırın HEPSİNDE
      //    "Kasa", `hareket` yalnız A/B (alacak/borç yönü) — ikisi de
      //    etiket olarak değersiz, ölçüldü.
      return `<div class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
        <div class="min-w-0 flex-1">
          <p class="text-body-md font-bold text-on-surface truncate">${kacis(x.kasa || x.aciklama || 'Kasa hareketi')}
            ${x.bagi_cikarim ? `<span class="text-[9px] font-black bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded-full align-middle" title="Açıklamada plaka yoktu; müşteri ve tarihten bir satışa bağlandı.">ÇIKARIM</span>` : ''}
            ${x.sapma ? `<span class="text-[9px] font-black bg-error-container text-on-error-container px-1.5 py-0.5 rounded-full align-middle" title="Tutar ölçek olarak absürt (eski sistem giriş hatası). Değer değiştirilmedi, toplama katılmadı.">SAPMA</span>` : ''}</p>
          <p class="text-[11px] text-on-surface-variant truncate">${x.tarih ? kacis(fmtTarihKisa(x.tarih)) : ''}${x.plaka ? ' · ' + kacis(x.plaka) : ''}${x.kasa && x.aciklama ? ' · ' + kacis(x.aciklama) : ''}</p>
        </div>
        <p class="text-body-md font-bold shrink-0 tabular-nums ${gelen ? 'text-green-700' : 'text-on-surface-variant'}">${gelen ? '+' : ''}${fmtPara(tutar)}</p>
      </div>`
    }).join('')}
    <p class="text-[11px] text-on-surface-variant mt-2">Bu hareketler eski sistemden aktarıldı, salt okunurdur ve yukarıdaki cari bakiyeye dahil değildir.</p>
  </div>`
}

function cariListe() {
  const c = D.cari || []
  const arsiv = arsivCariBolumu()
  if (!c.length) {
    return (arsiv
      ? `<p class="text-body-md text-on-surface-variant">Güncel sistemde cari hareket yok.</p>`
      : bos('Cari hareket yok (ya da görme yetkiniz yok).', 'receipt_long')) + arsiv
  }
  return c.map(x => {
    const artı = Number(x.isaretli) >= 0
    return `<div class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
      <div class="min-w-0 flex-1">
        <p class="text-body-md font-bold text-on-surface">${kacis((x.tip || '').replace(/_/g, ' '))}</p>
        <p class="text-[11px] text-on-surface-variant truncate">${x.tarih ? fmtTarihKisa(x.tarih) : ''}${x.aciklama ? ' · ' + kacis(x.aciklama) : ''}</p>
      </div>
      <p class="text-body-md font-bold shrink-0 ${artı ? 'text-green-700' : 'text-error'}">${artı ? '+' : ''}${fmtPara(x.isaretli)}</p>
    </div>`
  }).join('') + arsiv
}

function zamanTuneli(limit) {
  const o = D.olaylar || []
  if (!o.length) return bos('Henüz kayıtlı olay yok.', 'timeline')
  const g = limit ? o.slice(0, limit) : o
  return `<div class="space-y-0">${g.map(x => `<div class="flex gap-3 pb-4 last:pb-0 relative">
      <div class="flex flex-col items-center shrink-0">
        <span class="w-2.5 h-2.5 rounded-full bg-primary mt-1.5"></span>
        <span class="flex-1 w-px bg-outline-variant/60 mt-1"></span>
      </div>
      <div class="min-w-0 flex-1 -mt-0.5">
        <p class="text-body-md font-bold text-on-surface">${kacis((x.tip || 'Olay').replace(/_/g, ' '))}</p>
        <p class="text-[11px] text-on-surface-variant">${x.olusma_zamani ? fmtTarih(x.olusma_zamani) : ''}${x.danisman ? ' · ' + kacis(x.danisman) : ''}</p>
      </div></div>`).join('')}</div>` +
    (limit && o.length > limit ? `<p class="text-[11px] text-on-surface-variant text-center pt-2">+${o.length - limit} olay daha — Zaman Tüneli sekmesi</p>` : '')
}

// ---------- AI ASİSTAN (YAKINDA) ----------
// ⚠️ Sahte skor/özet ÜRETİLMEZ. Uydurulmuş bir "%82 satın alma olasılığı"
//   ekranda gerçek sanılır ve karar bozar. Panel neyin geleceğini anlatır.
function aiPanelHtml() {
  const satir = (ik, ad, aciklama) => `<div class="flex gap-2.5 py-2.5 border-b border-outline-variant/40 last:border-0">
    ${mat(ik, 'text-[18px] text-on-surface-variant/60 shrink-0 mt-0.5')}
    <div class="min-w-0"><p class="text-body-md font-bold text-on-surface">${kacis(ad)}</p>
    <p class="text-[11px] text-on-surface-variant leading-snug">${kacis(aciklama)}</p></div></div>`
  return `<aside class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-hidden xl:sticky xl:top-4">
    <div class="flex items-center justify-between gap-2 px-lg py-3 border-b border-outline-variant bg-surface-container">
      <h3 class="text-title-md text-primary flex items-center gap-2">${mat('auto_awesome', 'text-[20px]')} AI Asistan</h3>
      <span class="text-[10px] font-bold uppercase bg-surface-container-lowest text-on-surface-variant px-2 py-0.5 rounded">Yakında</span>
    </div>
    <div class="p-lg">
      <p class="text-[12px] text-on-surface-variant leading-relaxed mb-3">
        Bu panel müşterinin tüm modüllerdeki hareketini okuyup özetleyecek.
        <b class="text-on-surface">Şu an veri üretilmiyor</b> — uydurma bir skor
        göstermek yanlış karar verdirir.
      </p>
      ${satir('summarize', 'Son Görüşme Özeti', 'Notlar ve görüşme kayıtlarından otomatik özet.')}
      ${satir('trending_up', 'Satın Alma Olasılığı', 'Geçmiş işlem ve ilgi sinyallerinden skor.')}
      ${satir('mood', 'Müşteri Duygusu', 'Görüşme metinlerinden olumlu/olumsuz eğilim.')}
      ${satir('lightbulb', 'Önerilen Aksiyon', 'Sıradaki en iyi adım ve zamanlaması.')}
      ${satir('forum', 'İletişim Geçmişi', 'Telefon · WhatsApp · SMS — santral entegrasyonu bekliyor.')}
    </div>
  </aside>`
}
