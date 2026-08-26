// =====================================================================
// satis-kayit-pencere.js — SATIŞ KAYDI tam görünüm pop-up'ı
//
// Göksenil'in 16 maddelik revizyonu (5 Ağu 2026) uygulanmıştır.
//
// ⚠️ EN BÜYÜK DEĞİŞİKLİK ESTETİK DEĞİL, BİLGİ ÖNCELİĞİ (madde 16):
//    "satış danışmanı araçtan önce müşteriyi ve ödemeyi kontrol ediyor."
//    Göz rotası: HEADER → SATIŞ TUTARI → MÜŞTERİ → TAHSİLAT → ARAÇ →
//    TESLİM → DETAYLAR. Sütun sırası buna göre kuruldu:
//      sol : Müşteri · Araç · Ekspertiz · Alış · Zaman Çizelgesi
//      sağ : Finans · Tahsilat · Teslim · Notlar · Evrak
//    (Önceki sürümde araç en üstteydi — yanlış öncelik.)
//
// Diğer maddeler:
//  1  Header: plaka + model + TEK SATIR künye (yıl·km·yakıt·vites·kasa·
//     renk) + rozetler + park. "Araç kartına bakmadan fikir oluşmalı."
//  2  Satış Tutarı kartı diğerlerinden BASKIN (2 sütun yer kaplar).
//  3  Araç fotoğrafı büyük (320×220), foto sayısı rozeti, hover zoom.
//  4  Müşteri kartı: avatar + Ara / WhatsApp / SMS / Cari Kartı.
//  5  Finans TABLO DEĞİL, 5 mini KPI kartı.
//  6  Kart başlıklarında bordo dikey çizgi.
//  7  Ekspertiz şeması büyütüldü (~320px).
//  8  Gerçek dikey zaman çizelgesi (nokta + bağlantı çizgisi).
//  9  Footer ikon kutuları, outline + hover.
// 10  Kartlar tek ızgarada, yükseklikler dengelendi.
// 11/12 Daha az çizgi, daha çok boşluk (24px ritmi).
// 13/14 Hover ve mikro animasyon: modal 0.96→1, KPI sayaç, sekme
//     altı çizgisi kayar, kart/foto/evrak hover.
//
// ⚠️ TASARIMDAN İKİ BİLİNÇLİ SAPMA (Göksenil'in ayrı talimatları):
//    · TCKN herkeste görünür (rol kapısı YOK).
//    · Kâr/Zarar ve maliyet zinciri YALNIZ YÖNETİCİDE.
// =====================================================================
import { fmtPara, fmtTarih, fmtTarihKisa, kacis, buyuk, telNo, telBicim, waHref,
  musteriTipEtiket, danismanAdi, olayEtiket, evrakEtiket, karGorur,
  TURETILMIS_NOT } from './veri.js'
import { mat, basHarf } from './stitch-ui.js'
import { svgBoya, RENK, DURUM_ETIKET } from './ekspertiz.js'
// ⚠️ Masraf ekranı KOPYALANMADI: aynı defter arac-kart ve arac-detay'da da
//    kullanılıyor. Modül kendi yetkisini (masrafGorur) ve kendi verisini
//    yönetiyor; buradan yalnız araç kimliği veriliyor.
import { masrafGorur, masrafYukle, masrafGovdeHtml, masrafBagla } from './masraf-defteri.js'

const BUY = v => kacis(buyuk(v))
let PEN = null
let SEKME = 'tahsilat'
let MASRAF_DURUM = 'bos'        // bos | yukleniyor | hazir

export function satisKayitKapat() {
  if (!PEN) return
  document.removeEventListener('keydown', PEN._esc)
  PEN.remove(); PEN = null
  try {
    const u = new URL(location.href)
    if (u.searchParams.has('satis')) { u.searchParams.delete('satis'); history.replaceState(null, '', u) }
  } catch { /* adres güncellenemezse pencere yine kapanır */ }
}

// --- stil: hover + mikro animasyon (madde 13-14) ----------------------
// ⚠️ Tailwind'de keyframes yok; bu kurallar bir KEZ enjekte edilir.
const STIL_ID = 'sk-stil'
function stilKur() {
  if (document.getElementById(STIL_ID)) return
  const st = document.createElement('style')
  st.id = STIL_ID
  st.textContent = `
    @keyframes skAc { from { opacity:0; transform:scale(.96) } to { opacity:1; transform:none } }
    @keyframes skBel { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
    .sk-modal { animation: skAc .2s cubic-bezier(.2,.8,.2,1) both }
    .sk-bel { animation: skBel .28s ease both }
    .sk-kart { transition: box-shadow .2s ease, transform .2s ease }
    .sk-kart:hover { box-shadow: 0 12px 28px -14px rgba(0,0,0,.25); transform: translateY(-2px) }
    .sk-foto img { transition: transform .4s cubic-bezier(.2,.8,.2,1) }
    .sk-foto:hover img { transform: scale(1.07) }
    .sk-evrak { transition: transform .15s ease, box-shadow .15s ease }
    .sk-evrak:hover { transform: scale(1.03); box-shadow: 0 6px 14px -8px rgba(0,0,0,.3) }
    .sk-tl .sk-nokta { transition: background-color .2s, box-shadow .2s, transform .2s }
    .sk-tl:hover .sk-nokta { background:#5f1818; box-shadow:0 0 0 4px rgba(95,24,24,.14); transform:scale(1.15) }
    .sk-tl:hover .sk-tl-ad { color:#5f1818 }
    .sk-sekmeler { position:relative }
    .sk-cizgi { position:absolute; bottom:0; height:2px; background:#5f1818; transition: left .22s cubic-bezier(.2,.8,.2,1), width .22s cubic-bezier(.2,.8,.2,1) }
    .sk-eylem { transition: background-color .15s, border-color .15s, transform .15s }
    .sk-eylem:hover:not(:disabled) { transform: translateY(-1px) }`
  document.head.appendChild(st)
}

// --- ortak parçacıklar -------------------------------------------------
const L = 'block text-[11px] text-gray-500 font-medium leading-tight'
const V = 'text-[12.5px] text-gray-900 font-semibold leading-snug break-words'

// Etiket ÜSTTE, değer ALTTA. (Yan yana düzende değer sütunu ~50px'e
// düşüyor ve "BENZIN" -> "BEN/ZIN" diye harf harf kırılıyordu.)
const alan = (e, d, vc) => `<div class="min-w-0"><span class="${L}">${kacis(e)}</span>
    <div class="${vc || V}">${d}</div></div>`

// Madde 6: başlıkta bordo dikey çizgi · madde 11: tek ince kenarlık
const kart = (baslik, ikon, ic, sagUst = '', ek = '') => `
  <section class="sk-kart bg-white border border-gray-200/70 rounded-xl p-5 ${ek}">
    <div class="flex justify-between items-center gap-3 mb-4">
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="w-[3px] h-4 rounded-full bg-primary shrink-0"></span>
        <span class="text-primary shrink-0">${mat(ikon, 'text-[16px]')}</span>
        <h4 class="text-[12px] font-bold text-gray-700 uppercase tracking-wide truncate">${kacis(baslik)}</h4>
      </div>
      ${sagUst}
    </div>
    ${ic}</section>`

// Madde 5: finans için mini KPI
const miniKpi = (etiket, deger, renk = 'text-gray-900', kap = 'bg-gray-50 border-gray-200/70') =>
  `<div class="rounded-lg border ${kap} px-3 py-2 min-w-0">
      <div class="text-[10px] font-bold text-gray-500 uppercase tracking-wide truncate">${kacis(etiket)}</div>
      <div class="text-[14px] font-bold ${renk} tabular-nums truncate">${deger}</div></div>`

/**
 * @param s   satış satırı · @param v panel verisi · @param opt bağlam
 */
export function satisKayitAc(s, v, opt) {
  satisKayitKapat(); stilKur()
  SEKME = 'tahsilat'; MASRAF_DURUM = 'bos'
  const kar = karGorur(opt.ben)

  const ov = document.createElement('div')
  ov.className = 'stitch fixed inset-0 z-[110] flex items-start sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm'
  // ⚠️ MOBİLDE KAYDIRMA (19 Ağu 2026 — "satış detayda sayfa kaymıyor").
  //    Eski kurgu: kabuk `overflow-hidden`, içeride tek kaydırıcı olarak
  //    `flex-1 overflow-y-auto` gövde; başlık/KPI/alt çubuk `shrink-0`.
  //    Masaüstünde doğru. Ama 390×844 telefonda KPI şeridi `grid-cols-1`
  //    ile 6 kartı ALT ALTA diziyor (~400 px), başlık sarıyor (~150 px),
  //    alt çubuk 8 düğmeyle sarıyor (~130 px) → shrink-0 toplamı ekranı
  //    aşıyor. flex-1 gövdeye 0 px kalıyor, kabuk da kırptığı için
  //    HİÇBİR ŞEY kaymıyordu.
  //    Çözüm: dar ekranda kabuğun KENDİSİ kayar, gövde normal akışta olur.
  //    Geniş ekranda eski davranış aynen duruyor (sm: önekleri).
  // ⚠️ Bu yorum önce `${/* … */''}` biçiminde yazılmıştı — şablon dizgisi
  //    DIŞINDA olduğu için `$` ayrı bir değişken okumasına dönüşüyor,
  //    node --check'ten GEÇİYOR ama tarayıcıda ReferenceError atıyordu.
  //    Şablon dizgisi içindeki `${/* … */''}` kalıbı geçerli; dışarıda değil.
  ov.innerHTML = `<div class="sk-modal w-full h-full sm:h-auto sm:max-w-[1380px] sm:max-h-[94vh] bg-gray-50 sm:rounded-2xl shadow-2xl overflow-y-auto sm:overflow-hidden flex flex-col" onclick="event.stopPropagation()">
      ${basligiCiz(s, opt.arsiv)}
      ${kpiSeridi(s, kar)}
      <div class="sm:flex-1 sm:overflow-y-auto">
        ${opt.arsiv ? `<div class="mx-6 mt-5 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-900 flex items-start gap-2">
            ${mat('inventory_2', 'text-[16px] shrink-0')}<span><b>GURU arşiv kaydı.</b> Eski sistemden aktarılmıştır — cari hareketleri, evraklar, notlar ve sipariş bağlantıları bulunmaz.</span></div>` : ''}
        ${/* Madde 16: SOL müşteri-odaklı, SAĞ para-odaklı. Madde 12: 24px ritim. */''}
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 p-6 items-start">
          <div class="flex flex-col gap-6 sk-bel">
            ${musteriKarti(s)}
            ${aracKarti(s, opt.kapakUrl, v)}
            ${ekspertizKarti(s)}
            ${alisKarti(s, kar)}
            ${zamanKarti(v)}
          </div>
          <div class="flex flex-col gap-6 sk-bel">
            ${finansKarti(s, kar)}
            <div id="skTahsilatKap"></div>
            ${teslimKarti(s)}
            ${notKarti(v, opt)}
            ${evrakKarti(v)}
          </div>
        </div>
      </div>
      ${altCubuk(s, opt.arsiv)}
    </div>`
  document.body.appendChild(ov)
  PEN = ov

  const esc = e => { if (e.key === 'Escape') satisKayitKapat() }
  ov._esc = esc
  document.addEventListener('keydown', esc)
  ov.addEventListener('click', e => { if (e.target === ov) satisKayitKapat() })
  ov.querySelectorAll('[data-sk-kapat]').forEach(b => b.addEventListener('click', satisKayitKapat))

  semaCiz(ov, s, opt)
  sayacCalistir(ov)

  const tahsilatCiz = async () => {
    const kap = ov.querySelector('#skTahsilatKap')
    kap.innerHTML = tahsilatKarti(s, v, opt)
    cizgiKonumla(ov)
    ov.querySelectorAll('[data-sk-sekme]').forEach(b => b.addEventListener('click', () => { SEKME = b.dataset.skSekme; tahsilatCiz() }))
    ov.querySelectorAll('#skTahsilatKap [data-evrak]').forEach(b => b.addEventListener('click', () => opt.parcalar.evrakAc(b.dataset.evrak)))

    if (SEKME !== 'masraf') return
    // ⚠️ TEMBEL YÜKLEME: masraf defteri 4 ayrı sorgu atıyor. Herkese, her
    //    pencere açılışında ödetmek yerine yalnız sekmeye basılınca çekilir.
    if (MASRAF_DURUM === 'bos') {
      MASRAF_DURUM = 'yukleniyor'
      await masrafYukle({ aracId: s.arac_id, ben: opt.ben, dmap: opt.dmap })
      MASRAF_DURUM = 'hazir'
      if (PEN !== ov || SEKME !== 'masraf') return   // pencere kapandı/sekme değişti
      return tahsilatCiz()
    }
    if (MASRAF_DURUM === 'hazir') {
      const yer = kap.querySelector('#skMasrafGovde')
      if (yer) { yer.innerHTML = masrafGovdeHtml(); masrafBagla(yer, tahsilatCiz) }
    }
  }
  tahsilatCiz()
  ov.querySelectorAll('[data-evrak]').forEach(b => b.addEventListener('click', () => opt.parcalar.evrakAc(b.dataset.evrak)))

  ov.querySelectorAll('[data-kopya]').forEach(b => b.addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText(e.currentTarget.dataset.kopya || '')
      const t = e.currentTarget, eski = t.innerHTML
      t.innerHTML = mat('check', 'text-[13px] text-green-600')
      setTimeout(() => { t.innerHTML = eski }, 1200)
    } catch (err) { console.error('[satis-kayit] kopyalanamadı', err) }
  }))
  ov.querySelector('#skYazdir')?.addEventListener('click', () => window.print())

  try {
    const u = new URL(location.href); u.searchParams.set('satis', s.id); history.replaceState(null, '', u)
  } catch { /* adres güncellenemezse pencere yine çalışır */ }
}

// Madde 14: KPI sayaç animasyonu. Hedef değer data-sayac'ta tutulur.
function sayacCalistir(ov) {
  ov.querySelectorAll('[data-sayac]').forEach(el => {
    const hedef = Number(el.dataset.sayac)
    if (!isFinite(hedef) || Math.abs(hedef) < 1) return
    const bas = performance.now(), sure = 620
    const adim = z => {
      const t = Math.min(1, (z - bas) / sure)
      const y = 1 - Math.pow(1 - t, 3)            // easeOutCubic
      el.textContent = fmtPara(Math.round(hedef * y))
      if (t < 1) requestAnimationFrame(adim)
    }
    requestAnimationFrame(adim)
  })
}

// Madde 14: sekme altı çizgisi kayar
function cizgiKonumla(ov) {
  const kap = ov.querySelector('.sk-sekmeler'); if (!kap) return
  const aktif = kap.querySelector('[data-sk-sekme][data-aktif="1"]')
  const cizgi = kap.querySelector('.sk-cizgi')
  if (!aktif || !cizgi) return
  cizgi.style.left = aktif.offsetLeft + 'px'
  cizgi.style.width = aktif.offsetWidth + 'px'
}

// ---------------------------------------------------------------- başlık
// Madde 1: araç kartına bakmadan fikir oluşsun — tek satır künye.
function basligiCiz(s, arsiv) {
  const teslim = s.teslim_durumu === 'TESLIM_EDILDI'
  const arac = [buyuk(s.marka), buyuk(s.model), buyuk(s.versiyon)].filter(Boolean).join(' ')
  const kunye = [
    s.yil ? String(s.yil) : '',
    s.km != null ? Number(s.km).toLocaleString('tr-TR') + ' km' : '',
    buyuk(s.yakit), buyuk(s.vites), buyuk(s.kasa_tipi), buyuk(s.renk),
  ].filter(Boolean).map(x => kacis(x)).join(' <span class="text-gray-300">•</span> ')
  const rozet = (cls, ikon, metin) => `<span class="px-2.5 py-1 ${cls} text-[10px] font-bold rounded-full inline-flex items-center gap-1">${mat(ikon, 'text-[12px]')}${kacis(metin)}</span>`
  const meta = (e, d) => `<div class="flex flex-col gap-0.5"><span class="text-gray-400">${kacis(e)}</span><span class="text-gray-700 font-semibold">${d}</span></div>`
  return `<header class="shrink-0 flex justify-between items-start gap-6 px-6 py-5 bg-white border-b border-gray-200/70 flex-wrap">
      <div class="flex gap-4 min-w-0">
        <div class="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm">${mat('directions_car', 'text-[24px]')}</div>
        <div class="min-w-0">
          <div class="flex items-baseline gap-2 flex-wrap">
            <h1 class="text-2xl font-black text-gray-900 tracking-tight">${BUY(s.yeni_plaka || s.plaka) || '—'}</h1>
            <button type="button" data-kopya="${kacis(s.yeni_plaka || s.plaka || '')}" title="Plakayı kopyala"
              class="text-gray-300 hover:text-gray-600">${mat('content_copy', 'text-[14px]')}</button>
            <span class="text-[14px] font-semibold text-gray-600 truncate">${kacis(arac)}</span>
          </div>
          <p class="text-[11.5px] text-gray-500 font-medium mt-1">${kunye || '—'}</p>
          <div class="flex items-center gap-2 mt-2 flex-wrap">
            ${rozet(teslim ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800', teslim ? 'check_circle' : 'schedule', teslim ? 'Teslim Edildi' : 'Teslim Bekliyor')}
            ${/* "CRM Satışı" etiketi KALDIRILDI (Göksenil) — her kayıt zaten
                  CRM satışı, bilgi taşımıyordu. ARŞİV rozeti KALDI: o kayıtta
                  cari/evrak/not bulunmadığını açıklıyor, gerçekten bilgi. */''}
            ${arsiv ? rozet('bg-amber-200 text-amber-900', 'inventory_2', 'Arşiv Kaydı') : ''}
            ${s.park ? rozet('bg-gray-100 text-gray-700', 'place', buyuk(s.park)) : ''}
          </div>
        </div>
      </div>
      <div class="flex gap-6 text-[10.5px] leading-tight items-start">
        ${meta('Onay Zamanı', s.onay_zamani ? kacis(fmtTarih(s.onay_zamani)) : '—')}
        ${meta('Danışman', BUY(s.danisman_ad) || '—')}
        ${meta('Noter', BUY(s.noter_adi) || '—')}
        ${meta('Yevmiye No', BUY(s.yevmiye_no) || '—')}
        <button type="button" data-sk-kapat class="text-gray-400 hover:text-gray-800 ml-1">${mat('close', 'text-[22px]')}</button>
      </div>
    </header>`
}

// ------------------------------------------------------------------- KPI
// Madde 2: Satış Tutarı BASKIN — iki sütun yer kaplar, yazısı büyük.
function kpiSeridi(s, kar) {
  const b = Number(s.kalan_bakiye) || 0
  const kalanMetin = b < -0.005 ? `${kacis(fmtPara(Math.abs(b)))} fazla`
    : b > 0.005 ? kacis(fmtPara(b)) : '0 ₺'
  const kalanRenk = Math.abs(b) > 0.005 ? 'text-red-600' : 'text-green-600'

  const kutu = (kap, ikonRenk, etiket, ikon, ic, ek = '') => `
    <div class="sk-kart bg-white border border-gray-200/70 rounded-xl p-4 flex items-center gap-3 ${ek}">
      <span class="w-10 h-10 rounded-xl ${kap} ${ikonRenk} flex items-center justify-center shrink-0">${mat(ikon, 'text-[19px]')}</span>
      <div class="min-w-0">
        <div class="text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">${kacis(etiket)}</div>
        ${ic}</div></div>`

  const kartlar = [
    // Baskın kart: 2 sütun + 24px yazı
    kutu('bg-primary/10', 'text-primary', 'Satış Tutarı', 'payments',
      `<div class="text-[24px] font-black text-gray-900 tabular-nums leading-tight" data-sayac="${Number(s.anlasilan_tutar) || 0}">${kacis(fmtPara(s.anlasilan_tutar))}</div>`,
      'sm:col-span-2'),
    kutu('bg-green-50', 'text-green-600', 'Tahsilat', 'savings',
      `<div class="text-[16px] font-bold text-green-700 tabular-nums" data-sayac="${Number(s.tahsilat_toplam) || 0}">${kacis(fmtPara(s.tahsilat_toplam))}</div>`),
    kutu('bg-blue-50', 'text-blue-600', 'Kalan Bakiye', 'schedule',
      `<div class="text-[16px] font-bold ${kalanRenk} tabular-nums">${kalanMetin}</div>`),
    kutu('bg-purple-50', 'text-purple-600', 'Teslim Tarihi', 'event',
      `<div class="text-[16px] font-bold text-gray-800">${s.teslim_tarihi ? kacis(fmtTarihKisa(s.teslim_tarihi)) : '—'}</div>`),
  ]
  // ⚠️ Kâr kartı YALNIZ YÖNETİCİDE (Göksenil kararı).
  if (kar) {
    const kz = s.kar_zarar == null ? null : Number(s.kar_zarar)
    const yuzde = s.kar_zarar_yuzde == null ? '' : `<span class="text-[11px] text-gray-400 ml-1">%${kacis(Number(s.kar_zarar_yuzde).toLocaleString('tr-TR', { maximumFractionDigits: 1 }))}</span>`
    kartlar.push(kutu('bg-amber-50', 'text-amber-600', 'Kâr / Zarar', 'trending_up',
      `<div class="text-[16px] font-bold ${kz == null ? 'text-gray-400' : kz < 0 ? 'text-red-600' : 'text-green-700'} tabular-nums">${kz == null ? '—' : kacis(fmtPara(kz))}${yuzde}</div>`))
  }
  // grid-cols-1 → grid-cols-2: telefonda 6 kart alt alta ~400 px yiyordu.
  // İki sütun yüksekliği yarıya indiriyor; kartlar dar ama okunur.
  return `<div class="shrink-0 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 ${kar ? 'xl:grid-cols-6' : 'xl:grid-cols-5'} gap-3 sm:gap-4 px-4 sm:px-6 py-4 sm:py-5 bg-gray-50 border-b border-gray-200/70">${kartlar.join('')}</div>`
}

// ------------------------------------------------- SOL: müşteri öncelikli
// Madde 4: avatar + hızlı eylemler. Bu ekran satış danışmanının ekranı.
function musteriKarti(s) {
  const wa = waHref(s.musteri_telefon)
  const tel = s.musteri_telefon ? telNo(s.musteri_telefon) : ''
  const eylem = (yol, ikon, ad, cls, disHedef) => yol
    ? `<a href="${kacis(yol)}"${disHedef ? ' target="_blank" rel="noopener"' : ''}
        class="sk-eylem flex items-center gap-1.5 px-3 h-9 rounded-lg border text-[11.5px] font-bold ${cls}">
        ${mat(ikon, 'text-[15px]')}${kacis(ad)}</a>`
    : ''
  return kart('Müşteri', 'person', `
    <div class="flex items-center gap-4 mb-4">
      <span class="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center font-black text-[17px] shrink-0">
        ${kacis(basHarf(buyuk(s.musteri_ad_soyad) || '?'))}</span>
      <div class="min-w-0">
        <div class="text-[17px] font-bold text-gray-900 truncate">${BUY(s.musteri_ad_soyad) || '—'}</div>
        <div class="text-[12.5px] text-gray-500 flex items-center gap-2 flex-wrap">
          <span class="tabular-nums">${s.musteri_telefon ? kacis(telBicim(s.musteri_telefon)) : 'Telefon yok'}</span>
          ${s.musteri_telefon ? `<button type="button" data-kopya="${kacis(tel)}" class="text-gray-400 hover:text-gray-700">${mat('content_copy', 'text-[13px]')}</button>` : ''}
          <span class="text-gray-300">•</span><span>${kacis(musteriTipEtiket(s.musteri_tipi))}</span>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 mb-4">
      ${eylem(tel ? 'tel:' + tel : '', 'call', 'Ara', 'border-gray-200 text-gray-700 hover:bg-gray-50')}
      ${eylem(wa, 'chat', 'WhatsApp', 'border-green-200 text-green-700 hover:bg-green-50', true)}
      ${eylem(tel ? 'sms:' + tel : '', 'sms', 'SMS', 'border-gray-200 text-gray-700 hover:bg-gray-50')}
      ${eylem(s.musteri_id ? 'musteri-360.html?id=' + encodeURIComponent(s.musteri_id) : '', 'account_circle', 'Cari Kartı', 'border-primary/30 text-primary hover:bg-primary/5')}
    </div>
    ${/* TCKN'de rol kapısı YOK — Göksenil kararı. */''}
    <div class="rounded-lg bg-orange-50 border border-orange-200/70 px-3 py-2 flex items-center justify-between gap-3">
      <span class="text-[10.5px] font-bold text-orange-900 uppercase tracking-wide">TCKN / VKN</span>
      <span class="font-mono font-bold text-gray-900 tabular-nums text-[13px] flex items-center gap-1.5">${BUY(s.alici_kimlik) || '—'}
        ${s.alici_kimlik ? `<button type="button" data-kopya="${kacis(s.alici_kimlik)}" class="text-gray-400 hover:text-gray-700">${mat('content_copy', 'text-[12px]')}</button>` : ''}</span>
    </div>`)
}

// Madde 3: fotoğraf büyük (320×220) + hover zoom + foto sayısı
function aracKarti(s, kapakUrl, v) {
  const adet = (v?.fotolar?.length) || s.foto_adet || 0
  const foto = kapakUrl
    ? `<div class="sk-foto relative rounded-xl overflow-hidden border border-gray-200/70 shrink-0 w-full sm:w-[320px] h-[220px] bg-gray-100 cursor-pointer">
         <img src="${kacis(kapakUrl)}" alt="araç" loading="lazy" class="w-full h-full object-cover" />
         ${adet ? `<span class="absolute top-2.5 right-2.5 bg-black/65 text-white text-[11px] font-bold px-2 py-1 rounded-lg flex items-center gap-1">
             ${mat('photo_camera', 'text-[13px]')}${adet}</span>` : ''}
         <span class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent text-white text-[11px] font-semibold px-3 py-2 flex items-center gap-1">
           ${mat('photo_library', 'text-[14px]')} Tüm Fotoğraflar</span>
       </div>`
    : `<div class="w-full sm:w-[320px] h-[220px] rounded-xl border border-dashed border-gray-300 flex items-center justify-center text-[12px] text-gray-400 shrink-0">Fotoğraf yok</div>`
  const bilgi = [
    ['Plaka', BUY(s.plaka) || '—'],
    ['Yeni Plaka', s.yeni_plaka ? `<span class="text-primary font-bold">${BUY(s.yeni_plaka)}</span>` : '—'],
    ['Şasi No', `<span class="font-mono text-[11px]">${BUY(s.sasi_no) || '—'}</span>`],
    ['Yeni Ruhsat Seri No', BUY(s.yeni_ruhsat_seri_no) || '—'],
    ['Yedek Anahtar', s.yedek_anahtar == null ? '—' : s.yedek_anahtar
      ? `<span class="text-green-600 inline-flex items-center gap-1">${mat('check_circle', 'text-[13px]')}Var</span>`
      : '<span class="text-gray-500">Yok</span>'],
    ['Park Alanı', BUY(s.park) || '—'],
  ].map(([e, d]) => alan(e, d)).join('')
  // Künye zaten HEADER'da; burada tekrar edilmez (madde 1 + madde 12).
  return kart('Araç', 'directions_car',
    `<div class="flex flex-col sm:flex-row gap-5">${foto}
      <div class="grid grid-cols-2 gap-x-4 gap-y-3 min-w-0 flex-1 content-start">${bilgi}</div></div>`)
}

// Madde 7: şema büyütüldü
function ekspertizKarti(s) {
  const hasar = (b, d, kirmizi) => `<div class="text-right leading-tight rounded-lg px-2.5 py-1.5 border ${
    kirmizi ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-50 border-gray-200/70 text-gray-600'}">
      <div class="text-[9.5px] font-bold uppercase tracking-wide">${kacis(b)}</div>
      <div class="text-[12px] font-bold">${d}</div></div>`
  const sagUst = `<div class="flex items-center gap-2 shrink-0">
      ${hasar('Hasar', s.hasar_adedi == null ? '—' : kacis(String(s.hasar_adedi)) + ' adet', Number(s.hasar_adedi) > 0)}
      ${hasar('Tutar', s.hasar_tutari == null ? '—' : kacis(fmtPara(s.hasar_tutari)), Number(s.hasar_tutari) > 0)}</div>`
  const efsane = ['ORIJINAL', 'BOYALI', 'LOKAL BOYA', 'DEGISEN'].map(d =>
    `<div class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block border border-black/10" style="background:${RENK[d] || '#d1d5db'}"></span>${kacis(DURUM_ETIKET[d] || d)}</div>`).join('')
  return kart('Ekspertiz', 'fact_check', `
    ${/* ⚠️ w-full ŞART: `w-auto` denemem svg'yi 0×0'a çökertip şemayı
          canlıda TAMAMEN KAYBETMİŞTİ (ölçüldü). Yükseklik sabit kapla
          sınırlanır, yoksa genişliğe yayılıp ekranı kaplıyor. */''}
    <div data-sk-sema class="h-[320px] flex items-center justify-center [&_svg]:w-full [&_svg]:h-full"></div>
    ${/* "Detayları Görüntüle" KALDIRILDI (Göksenil, 5 Ağu 2026). */''}
    <div class="flex gap-4 text-[10.5px] text-gray-500 flex-wrap mt-3 pt-3 border-t border-gray-100">${efsane}</div>`, sagUst)
}

async function semaCiz(ov, s, opt) {
  const yer = ov.querySelector('[data-sk-sema]'); if (!yer) return
  const metin = await opt.parcalar.semaYukle()
  if (!metin) { yer.innerHTML = `<p class="text-[11px] text-gray-400">Ekspertiz şeması yüklenemedi.</p>`; return }
  yer.innerHTML = metin
  const svg = yer.querySelector('svg')
  const { semada } = opt.parcalar.panelAyristir(s.ekspertiz_paneller)
  if (svg) svgBoya(svg, semada)
  // ⚠️ Kayıt YOKSA şema "hepsi orijinal" gibi duruyordu — veri yokluğu ile
  //    hasarsızlık aynı görünüyordu. Artık açıkça yazılır.
  if (!Object.keys(semada).length) {
    yer.insertAdjacentHTML('beforeend',
      `<div class="absolute inset-x-0 bottom-1 text-center text-[10.5px] text-gray-400">Bu araç için ekspertiz kaydı yok.</div>`)
    yer.classList.add('relative')
  }
}

function alisKarti(s, kar) {
  const varMi = [s.alis_sekli, s.alis_tarihi, s.alis_fiyati, s.alis_km, s.masraf,
    s.satici_ad, s.alis_noter, s.alis_sorumlusu].some(x => x != null && x !== '')
  if (!varMi) return ''
  const alanlar = [
    ['Alış Şekli', BUY(s.alis_sekli) || '—'],
    ['Alış Tarihi', s.alis_tarihi ? kacis(fmtTarihKisa(s.alis_tarihi)) : '—'],
    ['Alış KM', s.alis_km != null ? kacis(Number(s.alis_km).toLocaleString('tr-TR')) : '—'],
    ['Satıcı', BUY(s.satici_ad) || '—'],
    ['Satıcı Kimlik', `<span class="font-mono">${BUY(s.satici_kimlik) || '—'}</span>`],
    ['Alış Noteri', BUY(s.alis_noter) || '—'],
    ['Alış Sorumlusu', BUY(s.alis_sorumlusu) || '—'],
    // ⚠️ Maliyet zinciri yalnız yöneticide.
    kar ? ['Alış Fiyatı', `<span class="text-blue-600 font-bold">${kacis(fmtPara(s.alis_fiyati))}</span>`] : null,
    kar ? ['Masraf', kacis(fmtPara(s.masraf))] : null,
    kar ? ['Maliyet', `<span class="font-bold">${kacis(fmtPara(s.maliyet))}</span>`] : null,
  ].filter(Boolean).map(([e, d]) => alan(e, d)).join('')
  const kilit = kar ? '' : `<p class="mt-3 text-[10.5px] text-gray-400 flex items-center gap-1">${mat('lock', 'text-[12px]')} Alış fiyatı, masraf ve maliyet yalnız yöneticide görünür.</p>`
  return kart('Alış', 'local_shipping', `<div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">${alanlar}</div>${kilit}`)
}

// Madde 8: gerçek dikey zaman çizelgesi
function zamanKarti(v) {
  const olaylar = [...(v.olaylar || [])].reverse()
  const ic = !olaylar.length
    ? `<p class="text-[12px] text-gray-400">Kayıtlı olay yok.</p>`
    : `<ol class="relative pl-6">
        <span class="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-gray-200"></span>
        ${olaylar.map((o, i) => `<li class="sk-tl relative pb-4 last:pb-0 cursor-default">
            <span class="sk-nokta absolute -left-6 top-1 w-2.5 h-2.5 rounded-full ${i === olaylar.length - 1 ? 'bg-primary' : 'bg-gray-300'}"></span>
            <div class="flex items-baseline gap-2">
              <span class="text-[11px] font-bold text-gray-400 tabular-nums shrink-0">${kacis(saatMetni(o.olusma_zamani))}</span>
              <span class="sk-tl-ad text-[12.5px] font-semibold text-gray-800">${kacis(olayEtiket(o.tip))}</span>
            </div>
            <div class="text-[10.5px] text-gray-400">${kacis(fmtTarihKisa(o.olusma_zamani))}</div>
          </li>`).join('')}
      </ol>`
  return kart('Zaman Çizelgesi', 'history', ic)
}
const saatMetni = iso => { try { return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) } catch { return '—' } }

// -------------------------------------------------- SAĞ: para öncelikli
// Madde 5: tablo değil, mini KPI kartları
function finansKarti(s, kar) {
  const b = Number(s.kalan_bakiye) || 0
  const kalan = b < -0.005 ? [`${kacis(fmtPara(Math.abs(b)))} fazla`, 'text-red-600', 'bg-red-50 border-red-200/70']
    : b > 0.005 ? [kacis(fmtPara(b)), 'text-red-600', 'bg-red-50 border-red-200/70']
    : ['0 ₺', 'text-green-700', 'bg-green-50 border-green-200/70']
  const ust = [
    miniKpi('Anlaşılan', kacis(fmtPara(s.anlasilan_tutar)), 'text-primary', 'bg-primary/5 border-primary/15'),
    miniKpi('Liste Fiyatı', kacis(fmtPara(s.liste_fiyati))),
    miniKpi('Tahsilat', kacis(fmtPara(s.tahsilat_toplam)), 'text-green-700', 'bg-green-50 border-green-200/70'),
    miniKpi('Resmî Tahsilat', kacis(fmtPara(s.resmi_tahsilat))),
    miniKpi('Kalan', kalan[0], kalan[1], kalan[2]),
  ].join('')
  const alt = [
    ['Noter Satış Tutarı', kacis(fmtPara(s.noter_satis_tutari))],
    ['Resmî Fark', `<span class="${Number(s.resmi_fark) < 0 ? 'text-red-600' : ''}">${kacis(fmtPara(s.resmi_fark))}</span>`],
    ['İade Toplam', `<span class="${Number(s.iade_toplam) > 0 ? 'text-red-600' : ''}">${kacis(fmtPara(s.iade_toplam))}</span>`],
    kar ? ['Maliyet', kacis(fmtPara(s.maliyet))] : null,
    kar ? ['Kâr / Zarar', s.kar_zarar == null ? '—'
      : `<span class="${Number(s.kar_zarar) < 0 ? 'text-red-600' : 'text-green-700'} font-bold">${kacis(fmtPara(s.kar_zarar))}</span>`] : null,
  ].filter(Boolean).map(([e, d]) => alan(e, d)).join('')
  return kart('Finans', 'account_balance', `
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">${ust}</div>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 pt-3 border-t border-gray-100">${alt}</div>
    <p class="mt-3 text-[10.5px] text-gray-400">Tutarlar satış onayı anında dondurulmuştur; sonraki cari düzeltmelerden etkilenmez.</p>`)
}

function tahsilatKarti(s, v, opt) {
  // Masraf sekmesi: yalnız yetkisi olana VE aracı olan kayda (arşivde
  // arac_id yok). Yetkiyi masraf-defteri'nin kendi kuralı belirler —
  // burada ikinci bir yetki tanımı YAZILMADI.
  const masrafVar = !!s.arac_id && masrafGorur(opt.ben)
  const sekmeler = [['tahsilat', 'Tahsilat', 'receipt_long'], ['evrak', 'Evraklar', 'attachment']]
  if (masrafVar) sekmeler.push(['masraf', 'Masraflar', 'request_quote'])
  if (SEKME === 'masraf' && !masrafVar) SEKME = 'tahsilat'

  const bas = sekmeler.map(([k, ad, ikon]) => `<button type="button" data-sk-sekme="${k}" data-aktif="${SEKME === k ? 1 : 0}"
      class="px-4 h-11 flex items-center gap-1.5 text-[12px] font-bold whitespace-nowrap ${SEKME === k ? 'text-primary' : 'text-gray-500 hover:text-gray-800'}">
      ${mat(ikon, 'text-[15px]')}${kacis(ad)}</button>`).join('')
  const ic = SEKME === 'masraf'
    ? (MASRAF_DURUM === 'hazir'
        ? `<div id="skMasrafGovde"></div>`
        : `<p class="py-8 text-center text-[12px] text-gray-400">Masraflar yükleniyor…</p>`)
    : SEKME === 'evrak' ? evrakIzgara(v, 4) : cariTablo(s, v, opt)
  return `<section class="sk-kart bg-white border border-gray-200/70 rounded-xl overflow-hidden">
      <div class="sk-sekmeler flex border-b border-gray-200/70 px-2">${bas}<span class="sk-cizgi"></span></div>
      <div class="p-5">${ic}</div></section>`
}

function cariTablo(s, v, opt) {
  const arsiv = opt.arsiv
  const satirlar = arsiv ? (v.arsivCari || []) : (v.hareketler || [])
  const h = 'px-2 py-2 text-[11px]'
  const govde = !satirlar.length
    ? `<tr><td colspan="4" class="py-8 text-center text-[12px] text-gray-400">Bu satışa ait cari hareket yok.</td></tr>`
    : satirlar.map(x => {
        const eksi = !arsiv && x.tip === 'TEDIYE'
        const tutar = arsiv ? (Number(x.alacak) || 0) : (Number(x.tutar) || 0)
        const tur = arsiv ? (x.hareket_tipi || x.hareket || '—')
          : (x.alt_tip ? opt.katalogAd(x.alt_tip) : (x.tip === 'TAHSILAT' ? 'Tahsilat' : x.tip === 'TEDIYE' ? 'Tediye' : x.tip))
        return `<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <td class="${h} whitespace-nowrap tabular-nums text-gray-500">${kacis(fmtTarihKisa(arsiv ? x.odeme_tarihi : (x.tarih || x.created_at)))}</td>
            <td class="${h} font-semibold text-gray-800">${BUY(tur)}</td>
            <td class="${h} text-gray-500 truncate max-w-[160px]">${BUY(arsiv ? x.aciklama : (x.banka || x.aciklama)) || '—'}</td>
            <td class="${h} text-right font-bold tabular-nums ${eksi ? 'text-gray-500' : 'text-gray-900'}">${eksi ? '−' : ''}${kacis(fmtPara(Math.abs(tutar)))}</td>
          </tr>`
      }).join('')
  // ⚠️ TOPLAM = SATIRLARIN TOPLAMI DEĞİL. Listede SİPARİŞ BORCU ve NOTER
  //    MASRAFI gibi TAHSİLAT OLMAYAN kalemler var; hepsini toplayınca
  //    canlıda "3.340.000 ₺" yazdı, gerçek tahsilat 1.680.000 ₺.
  const toplam = arsiv ? satirlar.reduce((a, x) => a + (Number(x.alacak) || 0), 0) : (Number(s.tahsilat_toplam) || 0)
  return `<div class="overflow-x-auto"><table class="w-full text-left border-collapse min-w-[380px]">
      <thead><tr class="text-[10px] uppercase tracking-wider text-gray-400">
        <th class="${h} font-bold">Tarih</th><th class="${h} font-bold">Türü</th>
        <th class="${h} font-bold">Açıklama</th><th class="${h} font-bold text-right">Tutar</th></tr></thead>
      <tbody>${govde}</tbody></table></div>
    <div class="mt-4 pt-4 border-t border-gray-200 flex justify-between items-center">
      <span class="text-[12px] font-bold text-gray-700 uppercase tracking-wide">Toplam Tahsilat</span>
      <span class="text-[19px] font-black text-green-700 tabular-nums">${kacis(fmtPara(toplam))}</span></div>`
}

const EVRAK_RENK = ['bg-orange-50 border-orange-200/70 text-orange-500', 'bg-purple-50 border-purple-200/70 text-purple-500',
  'bg-blue-50 border-blue-200/70 text-blue-500', 'bg-red-50 border-red-200/70 text-red-500',
  'bg-green-50 border-green-200/70 text-green-600']
// ⚠️ Sütun sınıfı SABİT yazılmalı: `sm:grid-cols-${'${n}'}` gibi dinamik bir ad
//    Tailwind tarafından ÜRETİLMEZ (kaynağı tarayarak sınıf topluyor) ve
//    ızgara sessizce tek sütuna düşer.
const EVRAK_IZGARA = { 4: 'grid-cols-3 sm:grid-cols-4', 5: 'grid-cols-3 sm:grid-cols-5' }
function evrakIzgara(v, sutun) {
  const hepsi = v.evraklar || []
  if (!hepsi.length) return `<p class="py-8 text-center text-[12px] text-gray-400">Bu araca ait evrak yok.</p>`
  return `<div class="grid ${EVRAK_IZGARA[sutun] || EVRAK_IZGARA[4]} gap-2.5">${hepsi.map((e, i) => `
    <button type="button" data-evrak="${kacis(e.url)}" title="${kacis(evrakEtiket(e.tip))}"
      class="sk-evrak ${EVRAK_RENK[i % EVRAK_RENK.length]} border rounded-xl p-3 flex flex-col items-center gap-1.5">
      ${mat('picture_as_pdf', 'text-[20px]')}
      <span class="text-[10px] text-gray-700 font-semibold leading-tight text-center break-words w-full">${kacis(evrakEtiket(e.tip))}</span>
    </button>`).join('')}</div>`
}
const evrakKarti = v => kart('Evraklar', 'attachment', evrakIzgara(v, 5))

function teslimKarti(s) {
  const teslim = s.teslim_durumu === 'TESLIM_EDILDI'
  const alanlar = [
    ['Satış Tipi', BUY(s.satis_tipi) || `<span class="text-gray-400">— <span class="text-[10px]">(girilmemiş)</span></span>`],
    // ⚠️ Burada yedek yol YOKTU: aynı dosya için Satış Merkezi listesi
    //    tarih, bu pencere "—" gösteriyordu (19 Ağu). Tek kaynak:
    //    satis.js'teki satisGunu + TURETILMIS_NOT.
    ['Satış Tarihi', s.satis_tarihi || s.onay_zamani
      ? kacis(fmtTarihKisa(s.satis_tarihi || s.onay_zamani)) + (s.satis_tarihi ? '' : TURETILMIS_NOT)
      : '—'],
    ['Noter', `<span class="text-primary">${BUY(s.noter_adi) || '—'}</span>`],
    ['Yevmiye No', `${BUY(s.yevmiye_no) || '—'}${s.yevmiye_no ? ` <button type="button" data-kopya="${kacis(s.yevmiye_no)}" class="text-gray-400 hover:text-gray-700 align-middle">${mat('content_copy', 'text-[12px]')}</button>` : ''}`],
    ['Teslim Tarihi', s.teslim_tarihi ? kacis(fmtTarihKisa(s.teslim_tarihi)) : '—'],
    ['Onay Zamanı', s.onay_zamani ? kacis(fmtTarih(s.onay_zamani)) : '—'],
  ].map(([e, d]) => alan(e, d)).join('')
  const rozet = teslim
    ? `<span class="bg-green-100 text-green-700 text-[10.5px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1">${mat('check_circle', 'text-[12px]')}TESLİM EDİLDİ</span>`
    : `<span class="bg-amber-100 text-amber-800 text-[10.5px] font-bold px-2.5 py-1 rounded-full">BEKLİYOR</span>`
  return kart('Teslim', 'gavel', `<div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">${alanlar}</div>`, rozet)
}

function notKarti(v, opt) {
  const notlar = v.notlar || []
  const rez = v.rezNot ? `<div class="rounded-lg bg-primary/5 border border-primary/15 p-3 mb-2.5">
      <div class="text-[10px] font-bold text-primary uppercase tracking-wide mb-0.5">Sipariş / Rezervasyon Notu</div>
      <div class="text-[12px] text-gray-700">${kacis(v.rezNot)}</div></div>` : ''
  const ic = !notlar.length && !v.rezNot
    ? `<p class="text-[12px] text-gray-400">Bu satışa ait not yok.</p>`
    : rez + notlar.map(n => `<div class="flex items-start gap-2.5 mb-2.5 last:mb-0">
        <span class="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-[10px] font-bold shrink-0">
          ${kacis(basHarf(buyuk(danismanAdi(opt.dmap, n.danisman_id)) || '?'))}</span>
        <div class="min-w-0 flex-1 rounded-lg rounded-tl-none bg-gray-50 border border-gray-200/70 p-2.5">
          <div class="flex items-baseline gap-2">
            <span class="text-[11px] font-bold text-gray-700 truncate">${BUY(danismanAdi(opt.dmap, n.danisman_id))}</span>
            <span class="text-[10px] text-gray-400 ml-auto shrink-0 tabular-nums">${kacis(fmtTarih(n.created_at))}</span>
          </div>
          <div class="text-[12px] text-gray-700 break-words mt-0.5">${kacis(n.icerik)}</div>
        </div></div>`).join('')
  return kart('Notlar', 'sticky_note_2', ic)
}

// -------------------------------------------------------------- alt çubuk
// Madde 9: ikon kutuları, outline, hover
function altCubuk(s, arsiv) {
  const btn = (ikon, etiket, id, ikonRenk) => `<button type="button" ${id ? `id="${id}"` : 'disabled title="Yakında"'}
      class="sk-eylem bg-white border px-3.5 h-10 rounded-lg text-[11.5px] font-bold flex items-center gap-2
        ${id ? 'border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300' : 'border-gray-200/60 text-gray-300 cursor-not-allowed'}">
      ${mat(ikon, `text-[16px] ${id ? (ikonRenk || 'text-gray-400') : 'text-gray-300'}`)}${kacis(etiket)}</button>`
  return `<footer class="shrink-0 border-t border-gray-200/70 px-6 py-4 bg-white flex items-center justify-between gap-3 flex-wrap">
      <div class="flex gap-2.5 flex-wrap">
        ${btn('picture_as_pdf', 'PDF Oluştur', null)}
        ${btn('print', 'Yazdır', 'skYazdir', 'text-gray-500')}
        ${btn('share', 'Paylaş', null)}
        ${btn('history', 'Geçmiş', null)}
      </div>
      ${/* "Araç Kartına Git" ve "Siparişe Git" KALDIRILDI (Göksenil,
            5 Ağu 2026). Cari Kartı bağlantısı Müşteri kartında duruyor. */''}
      <div class="flex gap-2.5 flex-wrap">
        <button type="button" data-sk-kapat class="sk-eylem bg-primary text-white px-6 h-10 rounded-lg text-[11.5px] font-bold flex items-center gap-2 hover:opacity-90 shadow-sm">
          ${mat('close', 'text-[16px]')} Kapat</button>
      </div>
    </footer>`
}
