// =====================================================================
// kredi-hesaplama.js — Kurum karşılaştırma ekranı (MOBİL ÖNCELİKLİ)
//
//   Göksenil (4 Ağu 2026): "satış danışmanları burayı sürekli kullanacakları
//   için (özellikle mobilde) bu simülatörü ayrı bir yerde de göstermemiz
//   gerekiyor." → ayrı sayfa + sol menüde.
//   Danışman müşterinin karşısında telefonundan açar: tutar + vade girer,
//   hangi kurumda ne ödeyeceğini gösterir, en uygun 5 teklifi WhatsApp'a
//   yapıştırır.
//
//   ⚠️ BU DOSYADA FİNANSAL FORMÜL YOKTUR. Taksit / oran / masraf / harç /
//      kredi kartı limiti hesabının TEK KAYNAĞI `kredi-motoru.js`'tir
//      (CLAUDE.md — JS'te finansal formül tekrarı YASAK). Buradaki tek
//      aritmetik, motorun döndürdüğü iki taksiti çıkarmaktan ibaret olan
//      "en düşükten fark" ve gösterim yuvarlamasıdır.
//
//   Sıralama (uygunlar önce → taksit ARTAN → uygunsuzlar sonda, eşitlikte
//   tanım sırası) motorun `krediSirala`sıyla yapılır — burada KOPYASI YOK.
//   krediHesapla SIRALANMAMIŞ döner; sıralayan tek yer o yardımcıdır.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata, urlParam, fmtPara, fmtSayi, kodTemiz } from './veri.js'
import { mat, pill, cipler, kartAlan, bosDurum, uyari, sayfaBaslik, binlikInputKur, toast, panoyaYaz } from './stitch-ui.js'
import { krediUrunleriYukle, krediHesapla, krediSirala, harcMaliyeti, krediKartiLimiti, KK_TAKSITLER } from './kredi-motoru.js'

// Hızlı vade çipleri — yalnız KISAYOL. Motor kısıtı değil; "Diğer" alanına
// 1-120 arası her vade yazılabilir.
const VADE_CIPLERI = [12, 24, 36, 48, 60]
const VARSAYILAN_VADE = 36
const EN_BUYUK_VADE = 120

// Tür etiketleri — kodlar motorun sözleşmesinden gelir ('bireysel'|'ticari'|
// 'ozel'). Burada ENUM tekrarı YOK: filtre listesi gelen üründen türetilir,
// bu tablo yalnız görünen adı verir. Motor yeni bir tür eklerse etiketi
// buraya yazılır; yazılmazsa kod temizlenip gösterilir (ekran bozulmaz).
const TUR_ETIKET = { bireysel: 'Bireysel', ticari: 'Ticari', ozel: 'Özel ürün' }
const TUR_FILTRE_ETIKET = { bireysel: 'Bireysel', ticari: 'Ticari', ozel: 'Özel ürünler' }
const TUR_SINIF = { bireysel: 'notr', ticari: 'bilgi', ozel: 'aktif' }
const TUR_SIRA = ['bireysel', 'ticari', 'ozel']

let URUNLER = []          // motordan gelen ürün parametreleri
let vade = VARSAYILAN_VADE
let filtre = 'hepsi'
let sonUygun = []         // son çizilen (filtreli + sıralı) UYGUN teklifler — kopyalama bunu kullanır
let hazir = false         // ürünler yüklendi mi (yüklenmediyse ciz() ekranı ezmesin)

// --- Gösterim biçimleri (sunum kuralları — belgeden birebir) -----------
//   Aylık taksit .............. 2 ondalık
//   Kredi / net tutar ......... 0 ondalık
//   Toplam geri ödeme ......... 0 ondalık
//   Faiz oranı ................ 2 ondalık + %
// Yuvarlama YALNIZ gösterimde; sıralama yuvarlanmamış taksitle yapılır.
const varMi = n => n !== null && n !== undefined && isFinite(n)
const paraTam = n => (varMi(n) ? fmtPara(Math.round(n)) : '—')
const paraIki = n => (varMi(n) ? fmtSayi(n, 2, 2) + ' ₺' : '—')
// Türkçe yazımda yüzde işareti sayının ÖNÜNDE durur: %4,68
const yuzde = o => (varMi(o) ? '%' + fmtSayi(o * 100, 2, 2) : '—')
// para-gir alanından ham sayı (binlik noktaları at)
const sayiOku = el => Number(String(el?.value || '').replace(/\./g, '').replace(/[^\d]/g, '')) || 0
const el = id => document.getElementById(id)

// =====================================================================
// KURULUM
// =====================================================================
export async function krediHesaplamaKur(d) {
  binlikInputKur()                       // .para-gir alanları canlı noktalanır
  el('baslik').innerHTML = sayfaBaslik(
    'Kredi Hesaplama',
    'Tutarı ve vadeyi girin — kurumların aylık taksitleri anında sıralanır.',
  )
  araclariCiz()
  olaylariBagla()
  urldenDoldur()
  await urunleriYukle()
}

// =====================================================================
// VERİ — ürün parametreleri (motor okur, biz yalnız durumları yönetiriz)
// =====================================================================
async function urunleriYukle() {
  const hedef = el('sonuc')
  hazir = false
  hedef.innerHTML = iskelet()
  el('ozet').textContent = 'Ürünler yükleniyor…'
  el('uygunsuz').innerHTML = ''

  // Motor sözleşmesi: krediUrunleriYukle → { urunler, hata }. `hata` doluysa
  // liste boş döner (motor fırlatmaz, ama ağ/modül kazası fırlatabilir →
  // try/catch da var). Sessiz catch YOK: her yol dbHata'ya düşer (§5.4).
  let liste = null, hata = null
  try {
    const y = await krediUrunleriYukle(supabase)
    if (Array.isArray(y)) liste = y                       // savunma: düz dizi dönerse
    else if (y && Array.isArray(y.urunler)) { liste = y.urunler; hata = y.hata || null }
    else hata = 'Ürün listesi beklenmeyen biçimde döndü.'
  } catch (e) {
    hata = e
  }

  if (hata) {
    dbHata('kredi ürünleri (krediUrunleriYukle)', hata)
    el('ozet').textContent = ''
    hedef.innerHTML = uyari(`<div class="space-y-2">
      <p class="font-bold">Kredi ürünleri okunamadı.</p>
      <p class="text-body-md">${kacis(hata.message || hata)}</p>
      <p class="text-body-md">Kredi ürün listesine erişemiyor olabilirsin. Sorun sürerse bilgi işleme haber ver.</p>
      <button type="button" id="urunYenile" class="mt-1 px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-bold inline-flex items-center gap-2">${mat('refresh', 'text-[18px]')} Tekrar dene</button>
    </div>`)
    el('urunYenile')?.addEventListener('click', urunleriYukle)
    kopyaGuncelle()
    return
  }

  URUNLER = liste
  hazir = true
  filtreleriCiz()
  ciz()
}

// =====================================================================
// ÇİZİM
// =====================================================================
function ciz() {
  if (!hazir) return                       // yükleme/hata ekranını ezme
  const sonucEl = el('sonuc'), uygunsuzEl = el('uygunsuz'), ozetEl = el('ozet')

  if (!URUNLER.length) {
    sonUygun = []
    ozetEl.textContent = ''
    sonucEl.innerHTML = bosDurum('Tanımlı kredi ürünü yok. Kredi birimi ürün parametrelerini girmemiş olabilir.', 'account_balance')
    uygunsuzEl.innerHTML = ''
    kopyaGuncelle()
    return
  }

  const tutar = sayiOku(el('tutar'))
  if (!tutar || !vade) {
    sonUygun = []
    ozetEl.textContent = ''
    sonucEl.innerHTML = bosDurum('Finansman tutarını girin — teklifler anında listelenir.', 'calculate')
    uygunsuzEl.innerHTML = ''
    kopyaGuncelle()
    return
  }

  const hepsi = krediHesapla(tutar, vade, URUNLER) || []
  const gorunen = krediSirala(hepsi.filter(x => filtre === 'hepsi' || x.tur === filtre))
  const uygun = gorunen.filter(x => !x.engel && varMi(x.taksit))
  const engelli = gorunen.filter(x => x.engel || !varMi(x.taksit))
  sonUygun = uygun

  ozetEl.innerHTML = `<span><b class="text-on-surface">${uygun.length}</b> uygun teklif${engelli.length ? ` · ${engelli.length} uygun değil` : ''}</span>
    <span class="shrink-0">${kacis(fmtPara(tutar))} · ${vade} ay</span>`

  sonucEl.innerHTML = uygun.length
    ? `<div class="grid gap-sm md:grid-cols-2 xl:grid-cols-3">${uygun.map((x, i) => kart(x, i === 0, uygun[0])).join('')}</div>`
    : bosDurum('Bu filtrede uygun teklif yok. Türü değiştirmeyi ya da vadeyi düşürmeyi deneyin.', 'search_off')

  uygunsuzEl.innerHTML = engelli.length
    ? `<h3 class="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface-variant mt-lg mb-sm">Uygun olmayan ürünler (${engelli.length})</h3>
       <div class="grid gap-sm md:grid-cols-2 xl:grid-cols-3">${engelli.map(engelKart).join('')}</div>`
    : ''

  kopyaGuncelle()
}

// NOT: Sıralama (uygunlar önce → taksit artan → uygunsuzlar sonda, eşitlikte
// tanım sırası) motorun `krediSirala`sındadır. Burada KOPYASI YAZILMADI;
// taksit değeri sayı olmayan ürünler yalnızca "uygunsuz" kovasına ayrılır.

function turEtiketi(t) { return TUR_ETIKET[t] || kodTemiz(t) || 'Diğer' }

// Kurum adı — `kredi_bankalari.ad` alanında ZATEN doğru yazımıyla duruyor
// ("Yapı Kredi", "Türkiye Finans", "Quick Finans"). BÜYÜK HARFE ÇEVİRME:
//   trBuyuk()  → "YAPI KREDI"  (İ kaybolur, arama normalizasyonudur)
//   buyuk()    → "QUİCK FİNANS" (yabancı marka adını bozar)
// Özel isimde iki dönüşüm de yanlış; müşteriye gösterilen ekranda kurum
// adı kaynaktaki gibi basılır. (Ölçüldü: her iki yol da canlı liste
// üzerinde en az bir kurumu bozuyordu.)
function bankaAdi(x) { return String(x.banka_ad || x.banka_kod || '') }

// --- Teklif kartı -----------------------------------------------------
// Tek kart tipi: mobilde tek sütun, geniş ekranda ızgara. İkinci bir
// masaüstü tablosu YOK (aynı bileşen, farklı sütun sayısı).
function kart(x, enIyi, enUcuz) {
  const ad = bankaAdi(x)
  const fark = (enUcuz && !enIyi && varMi(x.taksit) && varMi(enUcuz.taksit)) ? x.taksit - enUcuz.taksit : 0
  return `<article class="bg-surface-container-lowest border ${enIyi ? 'border-secondary ring-2 ring-secondary/25' : 'border-outline-variant'} rounded-2xl p-md custom-shadow kart-hover flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h4 class="text-title-lg font-black text-on-surface leading-tight break-words">${kacis(ad || '—')}</h4>
        <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
          ${pill(turEtiketi(x.tur), TUR_SINIF[x.tur] || 'notr')}
          ${x.urun_ad ? `<span class="text-label-sm font-bold text-on-surface-variant">${kacis(x.urun_ad)}</span>` : ''}
          ${enIyi ? `<span class="px-2.5 py-1 rounded-full text-label-sm font-bold bg-secondary-container text-on-secondary-container">EN UYGUN</span>` : ''}
        </div>
      </div>
      <div class="text-right shrink-0">
        <div class="text-2xl md:text-3xl font-black text-primary leading-none tabular-nums">${paraIki(x.taksit)}</div>
        <div class="text-[11px] uppercase tracking-wide text-on-surface-variant mt-1">aylık · ${x.n} ay</div>
      </div>
    </div>
    ${fark > 0
      ? `<p class="text-label-sm text-on-surface-variant">En düşükten <b class="text-on-surface">+${paraIki(fark)}</b> / ay fark</p>`
      : (enIyi ? `<p class="text-label-sm font-bold text-on-secondary-container">En düşük aylık taksit</p>` : '')}
    <div class="grid grid-cols-2 gap-x-3 gap-y-2 pt-3 border-t border-outline-variant">
      ${kartAlan(x.net ? 'Net tutar' : 'Kredi tutarı', paraTam(x.anapara), x.net ? 'müşterinin eline geçen' : '')}
      ${kartAlan('Efektif oran', yuzde(x.efektif), 'aylık · taban ' + yuzde(x.oran))}
      ${kartAlan('Toplam geri ödeme', paraTam(x.toplam))}
      ${kartAlan('Toplam maliyet', paraTam(x.maliyet))}
    </div>
  </article>`
}

// --- Uygun olmayan ürün kartı ----------------------------------------
// Sayısal alan GÖSTERİLMEZ (motor sözleşmesi): yalnız gerekçe.
function engelKart(x) {
  const ad = bankaAdi(x)
  return `<article class="bg-surface-container-low border border-outline-variant rounded-2xl p-md opacity-75">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h4 class="text-title-lg font-bold text-on-surface-variant leading-tight break-words">${kacis(ad || '—')}</h4>
        <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
          ${pill(turEtiketi(x.tur), 'notr')}
          ${x.urun_ad ? `<span class="text-label-sm font-bold text-on-surface-variant">${kacis(x.urun_ad)}</span>` : ''}
        </div>
      </div>
      ${mat('do_not_disturb_on', 'text-[20px] text-on-surface-variant shrink-0')}
    </div>
    <p class="mt-3 text-body-md text-on-error-container bg-error-container rounded-lg px-3 py-2">${kacis(x.engel || 'Bu tutar/vade için uygun değil.')}</p>
  </article>`
}

// Yükleme iskeleti — beyaz ekran yerine yapının kendisi görünür.
function iskelet() {
  const k = `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-md custom-shadow animate-pulse space-y-3">
    <div class="flex justify-between gap-3">
      <div class="space-y-2 flex-1"><div class="h-4 w-2/3 bg-surface-container-high rounded"></div><div class="h-3 w-1/3 bg-surface-container rounded"></div></div>
      <div class="h-7 w-24 bg-surface-container-high rounded"></div>
    </div>
    <div class="grid grid-cols-2 gap-2 pt-3 border-t border-outline-variant">
      ${'<div class="h-8 bg-surface-container rounded"></div>'.repeat(4)}
    </div>
  </div>`
  return `<div class="grid gap-sm md:grid-cols-2 xl:grid-cols-3">${k.repeat(6)}</div>`
}

// =====================================================================
// FİLTRE + VADE ÇİPLERİ
// =====================================================================
// Tür listesi VERİDEN türetilir (hardcoded enum yok): yalnız gerçekten var
// olan türler çip olur.
function filtreleriCiz() {
  const turler = [...new Set(URUNLER.map(u => u.tur).filter(Boolean))]
    .sort((a, b) => {
      const ia = TUR_SIRA.indexOf(a), ib = TUR_SIRA.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  if (!turler.includes(filtre)) filtre = 'hepsi'
  const ops = [['hepsi', 'Tümü'], ...turler.map(t => [t, TUR_FILTRE_ETIKET[t] || turEtiketi(t)])]
  el('filtreler').innerHTML = cipler(ops, filtre)
}

function vadeCiz() {
  el('vadeCipler').innerHTML = cipler(
    VADE_CIPLERI.map(v => [String(v), String(v)]), String(vade), { ad: 'vade', koyu: true },
  )
  const ozel = el('vadeOzel')
  // Çiplerden biri seçiliyse "Diğer" kutusu boşalır — iki yerde birden
  // seçili görünmesin.
  ozel.value = VADE_CIPLERI.includes(vade) ? '' : String(vade)
}

function vadeAyarla(v) {
  const n = Math.max(1, Math.min(EN_BUYUK_VADE, Math.round(Number(v) || 0)))
  if (!n) return
  vade = n
  vadeCiz()
  ciz()
  urlGuncelle()
}

// =====================================================================
// OLAYLAR
// =====================================================================
function olaylariBagla() {
  // Tutar — her tuşta anında hesap (kaydet düğmesi yok)
  el('tutar').addEventListener('input', () => { ciz(); urlGuncelle() })

  // Vade çipleri (kapsayıcıda delegasyon — çipler her seçimde yeniden çizilir)
  el('vadeCipler').addEventListener('click', e => {
    const b = e.target.closest('[data-vade]'); if (!b) return
    vadeAyarla(b.dataset.vade)
  })
  const ozel = el('vadeOzel')
  ozel.addEventListener('input', () => { if (ozel.value) vadeAyarla(ozel.value) })
  ozel.addEventListener('keydown', e => { if (e.key === 'Enter') ozel.blur() })   // mobilde klavyeyi kapat

  // Tür filtresi
  el('filtreler').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return
    filtre = b.dataset.f
    filtreleriCiz()
    ciz()
  })

  // Ek araçlar
  el('beyan').addEventListener('input', harcCiz)
  el('kkTutar').addEventListener('input', kkCiz)
  el('kkTaksit').addEventListener('change', kkCiz)

  el('kopyaBtn').addEventListener('click', kopyala)
}

// URL'i güncel tut → danışman bağlantıyı paylaşabilsin, araç kartından
// gelen ?tutar=&vade= geri yazılabilsin. Yazma sıklığı düşürülür (400 ms).
let _urlZ = null
function urlGuncelle() {
  clearTimeout(_urlZ)
  _urlZ = setTimeout(() => {
    const tutar = sayiOku(el('tutar'))
    const p = new URLSearchParams()
    if (tutar) p.set('tutar', String(tutar))
    if (vade) p.set('vade', String(vade))
    const q = p.toString()
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '')) }
    catch (e) { console.error('[kredi-hesaplama] URL güncellenemedi', e) }
  }, 400)
}

function urldenDoldur() {
  const t = Number(String(urlParam('tutar') || '').replace(/[^\d]/g, ''))
  const v = Number(String(urlParam('vade') || '').replace(/[^\d]/g, ''))
  if (t > 0) el('tutar').value = t.toLocaleString('tr-TR')
  if (v > 0 && v <= EN_BUYUK_VADE) vade = v
  vadeCiz()
}

// =====================================================================
// EK ARAÇLAR — harç maliyeti + kredi kartı limiti
//   İkisi de katlanabilir; hesap motorun işi, burada yalnız gösterim var.
// =====================================================================
function araclariCiz() {
  // ⚠️ text-[16px] BİLEREK: iOS Safari 16px'in ALTINDAKİ bir alana dokununca
  //   sayfayı yakınlaştırıyor. tema.js'te mobil için 16px kuralı var ama
  //   `:where()` sıfır özgüllüklü olduğu için Tailwind'in text-body-md'si
  //   (14px) onu yeniyor — ölçüldü: hesaplanan boyut 13-14px çıkıyordu.
  //   Bu sayfa mobil öncelikli; girdiler açıkça 16px.
  const inp = 'w-full border border-outline-variant rounded-lg px-3 py-2.5 text-[16px] bg-white outline-none focus:border-primary'
  const lbl = 'block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1'
  const taksitOps = (Array.isArray(KK_TAKSITLER) ? KK_TAKSITLER : [])
    .map(t => `<option value="${kacis(String(t))}"${Number(t) === 6 ? ' selected' : ''}>${kacis(String(t))} taksit</option>`).join('')

  el('araclar').innerHTML = `
    <h3 class="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface-variant mb-sm">Ek hesaplar</h3>

    <details class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow overflow-hidden mb-sm">
      <summary class="cursor-pointer select-none px-md py-3.5 flex items-center gap-2 text-title-lg font-bold text-primary">
        ${mat('receipt_long', 'text-[20px]')} Harç maliyeti
      </summary>
      <div class="px-md pb-md pt-3 border-t border-outline-variant space-y-3">
        <div>
          <label for="beyan" class="${lbl}">Satış beyanı (₺)</label>
          <input id="beyan" class="para-gir ${inp}" type="text" inputmode="numeric" autocomplete="off" placeholder="0" />
        </div>
        <div id="harcSonuc"></div>
        <p class="text-[12px] text-on-surface-variant">Satış beyanının binde 2'si (‰2) olarak hesaplanır.</p>
      </div>
    </details>

    <details class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow overflow-hidden">
      <summary class="cursor-pointer select-none px-md py-3.5 flex items-center gap-2 text-title-lg font-bold text-primary">
        ${mat('credit_card', 'text-[20px]')} Kredi kartı limiti
      </summary>
      <div class="px-md pb-md pt-3 border-t border-outline-variant space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label for="kkTutar" class="${lbl}">Çekilecek tutar (₺)</label>
            <input id="kkTutar" class="para-gir ${inp}" type="text" inputmode="numeric" autocomplete="off" placeholder="0" />
          </div>
          <div>
            <label for="kkTaksit" class="${lbl}">Taksit</label>
            <select id="kkTaksit" class="${inp}">${taksitOps || '<option value="">—</option>'}</select>
          </div>
        </div>
        <div id="kkSonuc"></div>
        <p class="text-[12px] text-on-surface-variant">Kartla ödemede bloke edilecek limit — taksit çarpanı kredi biriminin tablosundan gelir.</p>
      </div>
    </details>`

  harcCiz()
  kkCiz()
}

// Sonuç şeridi — iki araç da AYNI kutuyu kullanır (ikinci bir tip türetme).
function sonucSerit(etiket, deger, hataMi = false) {
  const kap = hataMi
    ? 'bg-error-container text-on-error-container border border-error/20'
    : 'bg-primary text-on-primary'
  return `<div class="${kap} rounded-xl px-4 py-3 flex items-baseline justify-between gap-3">
    <span class="text-[11px] font-bold uppercase tracking-wide ${hataMi ? '' : 'text-white/70'}">${kacis(etiket)}</span>
    <span class="text-title-lg font-black tabular-nums text-right">${kacis(deger)}</span>
  </div>`
}

function harcCiz() {
  const beyan = sayiOku(el('beyan'))
  const sonuc = harcMaliyeti(beyan)
  el('harcSonuc').innerHTML = beyan
    ? sonucSerit('Harç maliyeti · binde 2', paraIki(sonuc))
    : sonucSerit('Harç maliyeti · binde 2', 'Satış beyanı girin', true)
}

function kkCiz() {
  const tutar = sayiOku(el('kkTutar'))
  const taksit = Number(el('kkTaksit').value)
  const hedef = el('kkSonuc')
  if (!tutar) { hedef.innerHTML = sonucSerit('Gereken limit', 'Tutar girin', true); return }
  const limit = krediKartiLimiti(tutar, taksit)
  hedef.innerHTML = varMi(limit)
    ? sonucSerit(`Gereken limit · ${taksit} taksit`, paraIki(limit))
    : sonucSerit('Gereken limit', 'Bu taksit sayısı için çarpan tanımlı değil', true)
}

// =====================================================================
// "EN UYGUN 5 TEKLİFİ KOPYALA" — WhatsApp'a yapıştırılacak DÜZ METİN
//   Mobilde okunur olsun diye satırlar kısa tutuldu.
// =====================================================================
function kopyaGuncelle() {
  const btn = el('kopyaBtn')
  const adet = Math.min(5, sonUygun.length)
  btn.disabled = !adet
  btn.classList.toggle('opacity-50', !adet)
  btn.classList.toggle('pointer-events-none', !adet)
  el('kopyaMetin').textContent = adet ? `En uygun ${adet} teklifi kopyala` : 'Kopyalanacak teklif yok'
}

function kopyaMetni() {
  const tutar = sayiOku(el('tutar'))
  const satirlar = sonUygun.slice(0, 5).map((x, i) => {
    const ad = bankaAdi(x)
    const urun = x.urun_ad ? ` (${x.urun_ad})` : ''
    return [
      `${i + 1}. ${ad}${urun} — ${turEtiketi(x.tur)}`,
      `   Aylık ${paraIki(x.taksit)} × ${x.n} ay`,
      `   ${x.net ? 'Net tutar' : 'Kredi tutarı'}: ${paraTam(x.anapara)}`,
      `   Faiz: ${yuzde(x.oran)} (efektif ${yuzde(x.efektif)})`,
      `   Toplam geri ödeme: ${paraTam(x.toplam)}`,
    ].join('\n')
  })
  return `${fmtPara(tutar)} finansman · ${vade} ay\n\n${satirlar.join('\n\n')}\n\nİsmail Çalmaz Otomotiv`
}

async function kopyala() {
  if (!sonUygun.length) return
  const metin = kopyaMetni()
  const oldu = await panoyaYaz(metin)
  toast(oldu ? 'Teklifler panoya kopyalandı' : 'Kopyalanamadı — metni elle seçmen gerekebilir', oldu)
}

