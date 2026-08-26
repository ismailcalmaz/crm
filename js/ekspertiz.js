// =====================================================================
// ekspertiz.js — Ekspertiz kuşbakışı şeması (SVG) + PDF template-matching
//   okuyucu. 3 firma (DYNOMOSS/YAMANLAR/ÜSTÜN) ekspertiz PDF'inden KM +
//   13 panel durumunu çıkarır (VISION YOK, client-side pdf.js, offline).
//   Kalibrasyon: [[dms-alis-fiyatlama-tasarim]]. DYNOMOSS kalibre+kanıtlı;
//   YAMANLAR/ÜSTÜN best-effort → kullanırken düzeltme öğrenir.
// =====================================================================
import { kacis, trBuyuk, dbHata } from './veri.js'
import { supabase } from './supabase-client.js'

// 13 parça (SVG data-part ile birebir) + durum renkleri
export const PARCALAR = ['Ön Kaput', 'Tavan', 'Arka Kaput (Bagaj)',
  'Ön Çamurluk Sol', 'Ön Çamurluk Sağ', 'Arka Çamurluk Sol', 'Arka Çamurluk Sağ',
  'Ön Kapı Sol', 'Ön Kapı Sağ', 'Arka Kapı Sol', 'Arka Kapı Sağ',
  'Marşpiyel Sol', 'Marşpiyel Sağ']
export const DURUMLAR = ['ORIJINAL', 'BOYALI', 'LOKAL BOYA', 'DEGISEN']
export const RENK = { ORIJINAL: '#c8c8c8', BOYALI: '#03A9F4', 'LOKAL BOYA': '#f3de1f', DEGISEN: '#ff1100' }
export const DURUM_ETIKET = { ORIJINAL: 'Orijinal', BOYALI: 'Boyalı', 'LOKAL BOYA': 'Lokal', DEGISEN: 'Değişen' }

// --- Ekspertiz kaydetme: TEK KAYNAK, FARK TABANLI ---------------------------
// 14 Ağu 2026. Üç ekran da (Araç Kabul sihirbazı · Araç Detay · Araç Kartı
// "Revize") ekspertizi "hepsini sil + hepsini yaz" ile kaydediyordu. Üç ayrı
// kopya, üç ayrı hata.
//
// ⚠️ SESSİZ MÜKERRER KAYIT: `arac_ekspertiz` SİLME politikası
//    `is_master() or is_yonetici()`, YAZMA politikası her danışmana açık.
//    Yetkisiz biri düzenlediğinde silme HATA VERMEZ, 0 satır siler
//    (CLAUDE.md §5.1) ve ardından gelen insert geçer → aynı parçadan İKİ
//    satır. sql/201 tekillik kısıtı bunu artık imkânsız kılıyor, ama kısıt
//    tek başına eklenseydi o ekranlar sert hata verirdi. Bu yüzden yazma
//    yolu da fark tabanlı yapıldı: silme YALNIZ gerçekten orijinale çekilen
//    parçalarda çalışır, ona da yetki ÖNCEDEN kontrol edilir.
// ⚠️ DENETİM: sql/200 ile tablo denetime bağlı. Sil+yaz kalıbı tek parça
//    değişiminde bile 13 SİLME + 13 EKLEME üretip "şu parça şundan şuna
//    döndü" satırını kaybediyordu. Fark tabanlı yazma gerçek GÜNCELLEME
//    satırı üretir.
// ⚠️ Silme/güncelleme `parca_kodu` üzerinden, satır id'si üzerinden DEĞİL:
//    geçmişte oluşmuş mükerrer satır varsa id ile gidilse kopya arkada
//    kalırdı; parca_kodu ile hepsi birden düzelir.
//
// mevcut / hedef: { 'Ön Kaput': 'BOYALI', … } — hedef'te ORIJINAL BULUNMAZ
//   (orijinal = satır yok). silebilir: master/yönetici mi (silme RLS aynası).
export async function ekspertizFarkKaydet({ aracId, mevcut, hedef, silebilir }) {
  const m = mevcut || {}, h = hedef || {}
  const eklenecek = Object.keys(h).filter(p => !(p in m))
  const guncel = Object.keys(h).filter(p => p in m && m[p] !== h[p])
  const silinecek = Object.keys(m).filter(p => !(p in h))

  if (!eklenecek.length && !guncel.length && !silinecek.length) {
    return { ok: true, degisti: false, eklendi: 0, guncellendi: 0, silindi: 0 }
  }
  // Yetki ÖNCE kontrol edilir: yarım yazıp sonra takılmak, kaydı tutarsız
  // bırakırdı (bir parça güncellenmiş, diğeri silinememiş).
  if (silinecek.length && !silebilir) {
    return { ok: false, degisti: false,
      msg: `Orijinale çekilen parça (${silinecek.join(', ')}) için silme yetkiniz yok.\n\n`
         + 'Ekspertiz satırı silmeyi yalnız yönetici/master admin yapabilir. '
         + 'Diğer değişiklikler kaydedilmedi; parçayı eski durumunda bırakıp tekrar deneyin.' }
  }

  for (const p of guncel) {
    const { data, error } = await supabase.from('arac_ekspertiz')
      .update({ durum: h[p] }).eq('arac_id', aracId).eq('parca_kodu', p).select('id')
    if (error || !data?.length) {
      dbHata('ekspertiz güncelle', error)
      return { ok: false, msg: `"${p}" güncellenemedi` + (error ? ': ' + error.message : ' (yetki?)') }
    }
  }
  if (silinecek.length) {
    const { data, error } = await supabase.from('arac_ekspertiz')
      .delete().eq('arac_id', aracId).in('parca_kodu', silinecek).select('id')
    if (error || !data?.length) {
      dbHata('ekspertiz sil', error)
      return { ok: false, msg: 'Orijinale çekilen parçalar silinemedi' + (error ? ': ' + error.message : ' (yetki?)') }
    }
  }
  if (eklenecek.length) {
    const govde = eklenecek.map(p => ({ arac_id: aracId, parca_kodu: p, durum: h[p] }))
    const { data, error } = await supabase.from('arac_ekspertiz').insert(govde).select('id')
    if (error || !data || data.length !== govde.length) {
      dbHata('ekspertiz ekle', error)
      return { ok: false, msg: 'Yeni parçalar yazılamadı' + (error ? ': ' + error.message : ' (yetki?)') }
    }
  }
  return { ok: true, degisti: true,
    eklendi: eklenecek.length, guncellendi: guncel.length, silindi: silinecek.length }
}

// Panel haritasından "hedef" üret: ORIJINAL olanlar DIŞARIDA kalır.
export function ekspertizHedef(paneller) {
  const h = {}
  for (const p of PARCALAR) if (paneller?.[p] && paneller[p] !== 'ORIJINAL') h[p] = paneller[p]
  return h
}

// --- SVG'yi durumlara göre boya (paneller: {parça: durum}) ---
export function svgBoya(svgEl, paneller) {
  if (!svgEl) return
  for (const path of svgEl.querySelectorAll('[data-part]')) {
    const p = path.getAttribute('data-part')
    const d = paneller[p]
    path.style.fill = d ? (RENK[d] || RENK.ORIJINAL) : RENK.ORIJINAL
    path.style.cursor = 'pointer'
  }
}

// ---------------------------------------------------------------------
// pdf.js dinamik yükle (CDN ESM; app'in build adımı yok)
// ---------------------------------------------------------------------
let _pdfjs = null
async function pdfjs() {
  if (_pdfjs) return _pdfjs
  const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs')
  lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs'
  _pdfjs = lib
  return lib
}

// Bir sayfanın kelimelerini {str,x,y} olarak al (y: ÜSTTEN, pymupdf ile aynı yön)
async function sayfaKelime(page) {
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  return tc.items.filter(i => i.str && i.str.trim()).map(i => ({
    str: i.str.trim(),
    x: i.transform[4],
    y: vp.height - i.transform[5],   // pdf.js alttan → üstten çevir
  }))
}

// --- Firma tanı ---
function firmaTani(metin) {
  const f = trBuyuk(metin)
  if (f.includes('DYNOMOSS')) return 'DYNOMOSS'
  if (f.includes('677/40') || f.includes('USTUN OTO') || f.includes('BUCA')) return 'USTUN'
  if (f.includes('TESLIM FORMU') || f.includes('YAMANLAR') || f.includes('2200811237')) return 'YAMANLAR'
  return 'BILINMEYEN'
}
// Yalnız FİRMAYI tanı — panel/OCR yok, sadece PDF metni.
//
// Göksenil (3 Ağu 2026): "hangi ekspertiz firmasından geldi ise SVG'i otomatik
//   dolduruyorsun, senin biliyor olman lazım ekspertiz firmasını." Haklı:
//   firma zaten `ekspertizOku()` içinde tanınıyordu ama sonuç hiçbir yere
//   yazılmıyordu, o yüzden geçmiş araçlarda "bilinmiyor" görünüyordu.
//   Kullanıcıya SORMAK yanlış cevap; doğrusu depodaki PDF'i okuyup tanımak.
//
// ⚠️ Bu yol KASITLI OLARAK HAFİF: ekspertizOku() şema OCR'ı yaptığı için
//   saniyeler sürüyor. Firma tanımak için metin yeter — ilk 2 sayfa okunur.
export async function ekspertizFirmaTani(file) {
  try {
    const lib = await pdfjs()
    const buf = await file.arrayBuffer()
    const pdf = await lib.getDocument({ data: buf }).promise
    let metin = ''
    for (let i = 1; i <= Math.min(2, pdf.numPages); i++) {
      const kelimeler = await sayfaKelime(await pdf.getPage(i))
      metin += ' ' + kelimeler.map(k => k.str).join(' ')
    }
    const firma = firmaTani(metin)
    return firma === 'BILINMEYEN' ? null : firma
  } catch (e) {
    console.error('[ekspertiz firma tanı]', e)
    return null
  }
}

// --- KM (firma regex) ---
// ⚠️ HATA DÜZELTMESİ: eski desen "K\w{0,2}LOMETRE" idi. JS'te `\w` SADECE ASCII
// eşler; "KİLOMETRE"deki İ harfi `\w` DEĞİLDİR. Bu yüzden ÜSTÜN ve YAMANLAR'da
// KM hiç okunmuyordu (sessizce null dönüyordu, hata da vermiyordu).
// Türkçe harfleri açıkça yazıyoruz.
const TRH = '[A-Za-zĞÜŞİÖÇğüşıöçİI]'
function kmCoz(metin, firma) {
  let m
  if (firma === 'DYNOMOSS') m = metin.match(/(\d{4,7})\s*\/\s*[A-Za-zĞÜŞİÖÇğüşıöç]{3,}/)
  else if (firma === 'YAMANLAR') m = metin.match(new RegExp(`K${TRH}{0,2}LOMETRE\\s*\\/?\\s*M${TRH}?L\\s+([\\d.]+)`, 'i'))
  else if (firma === 'USTUN') m = metin.match(new RegExp(`K${TRH}{0,2}LOMETRE\\s*:?\\s*([\\d.]+)`, 'i'))
  return m ? parseInt(m[1].replace(/\D/g, ''), 10) : null
}

// ⚠️ ÜSTÜN'de düz metinden KM okunamıyor: PDF'te ETİKETLER ve DEĞERLER ayrı
// metin blokları hâlinde yazılıyor ("KİLOMETRE" ile "28.835" metin akışında yan
// yana DEĞİL). Bu yüzden aynı SATIRDA (y yakınlığı) sağdaki ilk sayı alınıyor.
function kmSatirdan(kelimeler) {
  const et = kelimeler.find(k => /^K[İIi]?LOMETRE$/i.test(k.str.replace(/[:：]/g, '')))
  if (!et) return null
  const aday = kelimeler
    .filter(k => Math.abs(k.y - et.y) <= 4 && k.x > et.x && /^[\d.]{3,}$/.test(k.str))
    .sort((a, b) => a.x - b.x)[0]
  if (!aday) return null
  const n = parseInt(aday.str.replace(/\D/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// --- Durum kelimesi → kanonik durum ---
// ⚠️ Sözlük 315 gerçek rapordan çıkarıldı (31 Tem 2026), uydurulmadı:
//   ÜSTÜN   : ORİJİNAL · BOYALI · LOKAL BOYALI · SÖKME TAKMA BOYA · DEĞİŞMİŞ PARÇA
//             · PLASTİK · KAPLAMA
//   YAMANLAR: Orijinal · Boyalı · Boya · Plastik · K.Çekiç · Değişen · Tadilat
//             · Kordon · Yarım · Ezik · Ayar · Hasarlı
// Sıra ÖNEMLİ: "LOKAL BOYALI" hem LOKAL hem BOYALI içerir, LOKAL önce bakılmalı.
function durumKanon(w) {
  const u = trBuyuk(w)
  if (u.includes('ORJ') || u.includes('ORIJ')) return 'ORIJINAL'
  if (u.includes('DEGIS') || u.includes('DEGS')) return 'DEGISEN'
  // ÜSTÜN "SÖKME TAKMA BOYA" — eski kod yalnız bitişik 'SOKTAK' arıyordu ve
  // gerçek belgede HİÇ eşleşmiyordu (sessiz kayıp).
  if (u.includes('SOKME') || u.includes('SOKTAK') || u.includes('SOK TAK')) return 'BOYALI'
  if (u.includes('ONARIM')) return 'BOYALI'          // onarım boya (DYNOMOSS)
  if (u.includes('YARIM') || u.includes('KORDON')) return 'LOKAL BOYA'  // YAMANLAR
  if (u.includes('TADILAT')) return 'BOYALI'         // tadilat boya
  if (u.includes('LOKAL')) return 'LOKAL BOYA'
  if (u.includes('BOYALI') || u === 'BOYA') return 'BOYALI'
  // Plastik/kaplama parça: boyanabilir sac değil → değer kaybı yok, orijinal say.
  if (u.includes('PLASTIK') || u.includes('KAPLAMA')) return 'ORIJINAL'
  if (u.includes('CEKIC') || u.includes('AYAR') || u.includes('EZIK')) return 'ORIJINAL'  // kaporta çekiç/ayar/ezik → orijinal
  if (u.includes('HASARLI')) return 'HASARLI'        // → kullanıcıya sor
  return null
}

// Aynı panele iki bulgu düşerse AĞIR OLANI al (eksik bildirmektense fazla bildir).
const AGIRLIK = { ORIJINAL: 0, 'LOKAL BOYA': 1, BOYALI: 2, DEGISEN: 3, HASARLI: 4 }
const agirOlan = (a, b) => (!a ? b : !b ? a : (AGIRLIK[b] > AGIRLIK[a] ? b : a))

// --- DYNOMOSS: 13 sabit slot (pymupdf pt, kaporta sayfası) ---
const DYNO_SLOT = [
  [285, 268, 'Marşpiyel Sağ'], [175, 307, 'Ön Çamurluk Sağ'], [239, 307, 'Ön Kapı Sağ'],
  [308, 307, 'Arka Kapı Sağ'], [380, 307, 'Arka Çamurluk Sağ'], [152, 387, 'Ön Kaput'],
  [294, 387, 'Tavan'], [433, 387, 'Arka Kaput (Bagaj)'], [173, 465, 'Ön Çamurluk Sol'],
  [245, 465, 'Ön Kapı Sol'], [313, 465, 'Arka Kapı Sol'], [383, 465, 'Arka Çamurluk Sol'],
  [260, 505, 'Marşpiyel Sol']]

// ⚠️ DYNOMOSS DAVRANIŞI DEĞİŞMEDİ: her slot en yakın kelimeyi alır, eşik yok,
// kelime yoksa ORİJİNAL. Kalibre + kanıtlı olduğu için dokunulmadı; yalnız
// çıktı ortak biçime (okunamayan/guven) sarıldı.
function dynoPanel(kelimeler) {
  const dk = kelimeler.map(k => ({ ...k, d: durumKanon(k.str) })).filter(k => k.d && k.y < 560)
  const out = {}; const sor = []
  for (const [sx, sy, parca] of DYNO_SLOT) {
    let best = null, bd = 1e9
    for (const k of dk) { const dist = Math.hypot(k.x - sx, k.y - sy); if (dist < bd) { bd = dist; best = k } }
    if (best && best.d === 'HASARLI') { out[parca] = 'ORIJINAL'; sor.push(parca) }
    else out[parca] = best ? best.d : 'ORIJINAL'
  }
  return { paneller: out, sor, okunamayan: [], guven: 'yuksek', manuel: false }
}

// =====================================================================
// YAMANLAR — "KAPORTA BOYA KONTROLLERİ" sayfası. METİN katmanı var, OCR YOK.
//
// ⚠️ 16 gerçek YAMANLAR raporuyla ölçüldü (31 Tem 2026). Düzen 5 görünüm:
//     üst şerit = SOL yan (ters çevrilmiş) · orta = arka görünüm | KUŞBAKIŞI |
//     ön görünüm · alt şerit = SAĞ yan.  ÖN daima SAĞDA (ÜSTÜN'ün TERSİ).
// ⚠️ Ön/arka tampon sütunları (nx<0.17 ve nx>0.84) 13 panelin dışında —
//    okunup panel sanılmasın diye ELENİYOR.
// ⚠️ Bir panelde iki bulgu üst üste yazılabiliyor ("Orijinal" + "K.Çekiç");
//    ikisi de aynı slota düşer, agirOlan() ile ağır olan kazanır.
// =====================================================================
const YAM_YAN = [[0.307, 'Arka Çamurluk'], [0.407, 'Arka Kapı'],
                 [0.515, 'Ön Kapı'], [0.636, 'Ön Çamurluk']]

function yamanlarPanel(kelimeler, sayfaGen, sayfaYuk) {
  const dk = kelimeler.map(k => ({
    d: durumKanon(k.str),
    nx: ((k.x != null ? k.x : k.x0)) / sayfaGen,
    ny: ((k.y != null ? k.y : k.y0)) / sayfaYuk,
  })).filter(k => k.d)

  const out = {}
  const koy = (parca, d) => { out[parca] = agirOlan(out[parca], d) }

  for (const k of dk) {
    // --- üst şerit = SOL yan · alt şerit = SAĞ yan
    if (k.ny > 0.22 && k.ny < 0.32) {
      if (k.ny < 0.262) { koy('Marşpiyel Sol', k.d); continue }
      koy(enYakinYan(k.nx) + ' Sol', k.d); continue
    }
    if (k.ny > 0.52 && k.ny < 0.63) {
      if (k.ny > 0.582) { koy('Marşpiyel Sağ', k.d); continue }
      koy(enYakinYan(k.nx) + ' Sağ', k.d); continue
    }
    // --- orta şerit = kuşbakışı (tamponlar hariç)
    if (k.ny > 0.38 && k.ny < 0.46) {
      if (k.nx < 0.17 || k.nx > 0.84) continue          // ön/arka tampon görünümü
      if (k.nx < 0.42) koy('Arka Kaput (Bagaj)', k.d)
      else if (k.nx > 0.58) koy('Ön Kaput', k.d)
      else koy('Tavan', k.d)
    }
  }
  return sonucla(out)
}
function enYakinYan(nx) {
  let ad = YAM_YAN[0][1], en = 9
  for (const [a, p] of YAM_YAN) { const d = Math.abs(nx - a); if (d < en) { en = d; ad = p } }
  return ad
}

// =====================================================================
// ÜSTÜN — OTOMATİK PANEL OKUMA YOK, KARAR VERİLDİ (Göksenil, 31 Tem 2026:
// "üstünü es geç onu manuel ben yapayım").
//
// Neden: panel bilgisi metin katmanında YOK (149 raporda doğrulandı); sayfaya
// gömülü 506x458 JPEG'in İÇİNE ~7 px ölçüsünde basılmış. Üç yol denendi ve
// ÖLÇÜLEREK elendi (Tesseract kelimeyi bozuyor · renk taraması medyan 11/13 ·
// "kırmızı=değişen" çizimin far/stoplarıyla karışıyor). Ayrıntı ve sayılar:
// EKSPERTIZ_USTUN_SORUN.md
//
// Burada kalan TEK iş: kaporta şemasını sayfadan kırpıp ekranda göstermek.
// Kullanıcı PDF'i ayrıca açmadan, şemaya bakarak 13 paneli elle işaretliyor.
// ⚠️ Şema görseli 141/141 raporda AYNI dikdörtgende: (108,221)-(488,565) pt.
// =====================================================================
const USTUN_SEMA = { x0: 108, y0: 221, x1: 488, y1: 565 }   // sayfa pt

/** Sayfanın şema bölgesini kırpıp canvas döndür (ekranda göstermek için). */
async function ustunSemaCanvas(page, olcek = 3) {
  const vp = page.getViewport({ scale: olcek })
  const tam = document.createElement('canvas')
  tam.width = Math.ceil(vp.width); tam.height = Math.ceil(vp.height)
  await page.render({ canvasContext: tam.getContext('2d'), viewport: vp }).promise
  const c = document.createElement('canvas')
  c.width = Math.round((USTUN_SEMA.x1 - USTUN_SEMA.x0) * olcek)
  c.height = Math.round((USTUN_SEMA.y1 - USTUN_SEMA.y0) * olcek)
  c.getContext('2d').drawImage(tam, USTUN_SEMA.x0 * olcek, USTUN_SEMA.y0 * olcek,
    c.width, c.height, 0, 0, c.width, c.height)
  return c
}

// Panel TAHMİNİ YAPILMAZ — 13'ü de "okunamayan" sayılır ve kullanıcı elle
// işaretler. Yapılan tek şey kaporta şemasını kırpıp göstermek.
async function ustunPanel(page) {
  const c = await ustunSemaCanvas(page, 2)
  return { ...sonucla({}), semaGorsel: c.toDataURL('image/png') }
}

// Okunan panel haritasını ortak sonuç biçimine çevir.
// ⚠️ Okunamayan panel ORİJİNAL SAYILMAZ — `okunamayan` listesine girer ve
//    kullanıcıya "elle işaretle" diye gösterilir. Sessizce orijinal yazmak,
//    boyalı bir aracı orijinal fiyatlamak demekti.
function sonucla(out) {
  const paneller = {}, sor = [], okunamayan = []
  for (const p of PARCALAR) {
    const d = out[p]
    if (!d) { okunamayan.push(p); continue }
    if (d === 'HASARLI') { paneller[p] = 'ORIJINAL'; sor.push(p) }
    else paneller[p] = d
  }
  const n = PARCALAR.length - okunamayan.length
  return {
    paneller, sor, okunamayan,
    guven: n === PARCALAR.length ? 'yuksek' : n >= 9 ? 'orta' : 'dusuk',
    manuel: n === 0,
  }
}

// ---------------------------------------------------------------------
// Ana: File → {firma, km, paneller, sor, guven, kaporataSayfa, hata}
// ---------------------------------------------------------------------
export async function ekspertizOku(file, ilerleme) {
  try {
    const lib = await pdfjs()
    const buf = await file.arrayBuffer()
    const pdf = await lib.getDocument({ data: buf }).promise
    // ilk 6 sayfanın metni → firma + km; kaporta sayfasını bul
    let tumMetin = '', kaportaIdx = 0, kaportaKelime = null, kaportaSayfa = null, kaportaVp = null
    const n = Math.min(pdf.numPages, 6)
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i)
      const kel = await sayfaKelime(page)
      const metin = kel.map(k => k.str).join(' ')
      tumMetin += ' ' + metin
      if (/KAPORTA|Boya Kontrol|KAROSER/i.test(metin) && !kaportaKelime) {
        kaportaIdx = i; kaportaKelime = kel; kaportaSayfa = page
        kaportaVp = page.getViewport({ scale: 1 })
      }
    }
    const firma = firmaTani(tumMetin)
    // Düz metinden okunamazsa satır hizasından dene (ÜSTÜN böyle).
    const km = kmCoz(tumMetin, firma) ?? (kaportaKelime ? kmSatirdan(kaportaKelime) : null)
    let sonuc = {
      firma, km, paneller: {}, sor: [], okunamayan: PARCALAR.slice(),
      guven: 'dusuk', kaportaSayfa: kaportaIdx, manuel: true,
    }
    if (firma === 'DYNOMOSS' && kaportaKelime) {
      sonuc = { ...sonuc, ...dynoPanel(kaportaKelime) }
    } else if (firma === 'YAMANLAR' && kaportaKelime && kaportaVp) {
      sonuc = { ...sonuc, ...yamanlarPanel(kaportaKelime, kaportaVp.width, kaportaVp.height) }
    } else if (firma === 'USTUN' && kaportaSayfa) {
      // Panel okuma KAPALI (bkz. ustunPanel açıklaması) — yalnız şema görseli.
      sonuc = { ...sonuc, ...(await ustunPanel(kaportaSayfa)) }
    }
    return sonuc
  } catch (e) {
    console.error('[ekspertiz] PDF okunamadı', e)
    return {
      firma: 'BILINMEYEN', km: null, paneller: {}, sor: [], okunamayan: PARCALAR.slice(),
      hata: e.message, manuel: true, guven: 'dusuk',
    }
  }
}

// ---------------------------------------------------------------------
// ⚠️ TRAMER OKUMA BURADAN KALDIRILDI (31 Tem 2026).
//   Eski `tramerOku()` yalnız PDF metin katmanını okuyordu; görsel/ekran
//   görüntüsü gelince çaresizdi. Yerine tramer-ocr.js geçti: önce PDF metni,
//   yoksa tarayıcı içi OCR — ve gerçek SBM belgesiyle kalibre edildi.
//   Aynı belgeyi iki ayrı ayrıştırıcının okuması bu projede kaçındığımız
//   "kopya yardımcı" tuzağıydı (CLAUDE.md §4), o yüzden tek kaynak bırakıldı.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Öğrenme döngüsü: kullanıcı düzeltmelerini sakla (firma+parça bazında)
//   İleride bu düzeltmeler kalibrasyonu iyileştirir (20-30 araçta öğrenir).
//   v1: localStorage'a firma bazında sık düzeltmeleri biriktir; ileride DB.
// ---------------------------------------------------------------------
export function duzeltmeKaydet(firma, parca, eski, yeni) {
  try {
    const key = 'ic-ekspertiz-ogrenme'
    const veri = JSON.parse(localStorage.getItem(key) || '{}')
    const yol = `${firma}|${parca}`
    veri[yol] = veri[yol] || []
    veri[yol].push({ eski, yeni, t: new Date().toISOString().slice(0, 10) })
    if (veri[yol].length > 50) veri[yol] = veri[yol].slice(-50)
    localStorage.setItem(key, JSON.stringify(veri))
  } catch (e) { /* yoksay */ }
}
