// =====================================================================
// ruhsat-ocr.js — RUHSAT BASILI ALANLARINI OCR METNİNDEN ÇIKARMA (TAHMİN)
//
//   Amaç: ruhsat-test.html teşhis ekranını beslemek. Göksenil hangi alanın
//   doğru geldiğini görüp "şunu al" diyecek; ancak ONDAN SONRA araç kabul
//   formuna bağlanacak.
//
// ⚠️ BURADAKİ HER ŞEY TAHMİNDİR. QR yalnız 3 alan verir (plaka · belge seri ·
//   TCKN/VKN) ve onlar KESİNDİR. Şasi, motor no, marka, model vb. belgenin
//   üstünde yalnızca BASILI METİN — telefon fotoğrafından OCR ile okunur ve
//   yanılabilir. Bu yüzden hiçbiri forma SESSİZCE yazılmaz.
//
// YÖNTEM: ruhsat AB standardı ALAN KODLARIYLA etiketli — (A) PLAKA,
//   (E) ŞASE NO, (D.1) MARKASI… Önce bu etikete tutunuyoruz (sağlam),
//   bulunamazsa desene düşüyoruz (ör. şasi = 17 haneli VIN kalıbı).
//   Hangi yolla bulunduğu `yontem` alanında raporlanır.
// =====================================================================

// Teşhis ekranındaki satır sırası + açıklamalar
export const RUHSAT_ALANLAR = [
  { key: 'plaka',        ad: 'Plaka',                 kod: '(A)',     not: 'QR veriyor — kesin' },
  { key: 'belge_seri',   ad: 'Belge seri no',         kod: 'BELGE',   not: 'QR veriyor — kesin' },
  { key: 'kimlik',       ad: 'Sahip TCKN / VKN',      kod: '(Y.4)',   not: 'QR veriyor — kesin' },
  { key: 'sasi',         ad: 'Şasi No (VIN)',         kod: '(E)',     not: '17 hane; QR’da YOK, OCR tahmini' },
  { key: 'motor_no',     ad: 'Motor No',              kod: '(P.5)',   not: 'QR’da YOK' },
  { key: 'marka',        ad: 'Markası',               kod: '(D.1)',   not: '' },
  { key: 'tip',          ad: 'Tipi',                  kod: '(D.2)',   not: '' },
  { key: 'ticari_ad',    ad: 'Ticari adı',            kod: '(D.3)',   not: 'Model adı genelde burada' },
  { key: 'model_yili',   ad: 'Model yılı',            kod: '(D.4)',   not: '' },
  { key: 'arac_sinifi',  ad: 'Araç sınıfı',           kod: '(J)',     not: 'M1 / N1 …' },
  { key: 'cinsi',        ad: 'Cinsi',                 kod: '(D.5)',   not: '' },
  { key: 'renk',         ad: 'Rengi',                 kod: '(R)',     not: 'FORM KODU döner (tanimlar.RENK)' },
  { key: 'yakit',        ad: 'Yakıt cinsi',           kod: '(P.3)',   not: 'FORM KODU döner (tanimlar.YAKIT)' },
  { key: 'motor_gucu',   ad: 'Motor gücü (kW)',       kod: '(P.2)',   not: '' },
  { key: 'silindir',     ad: 'Silindir hacmi (cm³)',  kod: '(P.1)',   not: '' },
  { key: 'koltuk',       ad: 'Koltuk sayısı',         kod: '(S.1)',   not: '' },
  { key: 'net_agirlik',  ad: 'Net ağırlık (kg)',      kod: '(G.1)',   not: '' },
  { key: 'azami_agirlik',ad: 'Azami yüklü ağırlık',   kod: '(F.1)',   not: '' },
  { key: 'ilk_tescil',   ad: 'İlk tescil tarihi',     kod: '(B)',     not: '' },
  { key: 'tescil_tarihi',ad: 'Tescil tarihi',         kod: '(I)',     not: '' },
  { key: 'tescil_sira',  ad: 'Tescil sıra no',        kod: '(Y.2)',   not: '' },
  { key: 'kullanim',     ad: 'Kullanım amacı',        kod: '(Y.3)',   not: '' },
  { key: 'sahip_ad',     ad: 'Soyadı / ticari ünvanı',kod: '(C.1.1)', not: 'Müşteri adı' },
  { key: 'adres',        ad: 'Adresi',                kod: '(C.1.3)', not: '' },
  { key: 'muayene',      ad: 'Muayene geçerlilik',    kod: '(Z.2)',   not: 'mua.geç.trh — stok_araclar.muayene_tarihi' },
  { key: 'tescil_yeri',  ad: 'Verildiği il / ilçe',   kod: '(Y.1)',   not: '' },
  { key: 'noter',        ad: 'Noterlik adı',          kod: '(X.1)',   not: 'Verildiği il/ilçe NOTERLİK ise — teslim pop-up noter alanı' },
]

// Türkçe harf toleransı: OCR İ/I, Ş/S, Ğ/G, Ç/C karıştırır.
function normal(s) {
  return String(s || '')
    .replace(/[İIıi]/g, 'I').replace(/[ŞşSs]/g, 'S').replace(/[ĞğGg]/g, 'G')
    .replace(/[ÜüUu]/g, 'U').replace(/[ÖöOo]/g, 'O').replace(/[ÇçCc]/g, 'C')
    .toUpperCase()
}

// ⚠️ Etiketin DEVAMI değer sanılmasın: "VERİLDİĞİ İL / İLÇE" etiketinde
// "VERİLDİĞİ İL"e tutunursak değer "/ İLÇE" çıkıyordu; "SOYADI / TİCARİ
// ÜNVANI"da da "TİCARİ ÜNVANI" çıkıyordu. Bu yüzden (1) etiketler UZUNDAN
// KISAYA denenir, (2) boşluk farkları yok sayılır, (3) etiket parçasına
// benzeyen değerler atlanır.
const ETIKET_KELIMELERI = /^(?:[\/|:\-–—.\s]*)?(?:İLÇE|ILCE|TİCARİ ÜNVANI|TICARI UNVANI|ADI|SOYADI|NO|TARİHİ|SAYISI|CİNSİ|AMACI|SÜR\.?DAHİL)/i

function etiketSonrasi(metin, etiketler, opt = {}) {
  // Boşluk toleransı için hem metni hem etiketi tek boşluğa indir
  const ham = metin.replace(/[ \t]+/g, ' ')
  const N = normal(ham)
  const sirali = [...etiketler].sort((a, b) => b.length - a.length)   // uzun etiket önce
  for (const et of sirali) {
    const e = normal(et.replace(/[ \t]+/g, ' '))
    const i = N.indexOf(e)
    if (i < 0) continue
    let kalan = ham.slice(i + e.length)
    // ⚠️ Sonraki alan koduna kadar KESMEK, iki sütunlu düzende her şeyi siler:
    //   "(D.1) MARKASI (D.2) TİPİ ... ADRESİ" → kesince geriye BOŞLUK kalıyor,
    //   değer ise BİR ALT SATIRDA ("— CİTROEN B || EMREZ MAH...").
    // Bu yüzden: kesilmiş parçada işe yarar bir şey yoksa KESME, ham metinle
    // devam et (alt satırlar da taransın).
    const son = kalan.search(/\([A-ZİŞĞÜÖÇ]{1,2}\.?\d?\)|\n\s*\n/)
    if (son > 0) {
      const kirpik = kalan.slice(0, son)
      if (/[A-Za-z0-9ÇĞİÖŞÜçğıöşü]{2,}/.test(kirpik.replace(/^[\s:.\-–—|]+/, ''))) kalan = kirpik
      else kalan = kalan.slice(0, 400)   // sütun etiketleri araya girmiş — alt satırlara bak
    }

    const satirlar = kalan.split('\n').map(s => s.replace(/^[\s:.\-–—|]+/, '').trim()).filter(Boolean)

    // Alanın KENDİ biçimine uyan ilk parçayı ara (iki sütunlu OCR gürültüsü
    // arasından doğru değeri seçmenin tek güvenilir yolu bu).
    // ⚠️ Etiket satırında BAŞKA SÜTUNLARIN etiketleri de duruyor
    //    ("(D.3) TİCARİ ADI (D.4) MODEL YILI (J) ARAÇ SINIFI"). Onları silmeden
    //    aramak "TİPİ" / "MODEL" gibi etiket kelimelerini DEĞER sandırıyor.
    //    Önce aynı satırda (etiketler silinmiş), sonra alt satırlarda ara.
    if (opt.dogrula) {
      const nl = kalan.indexOf('\n')
      const ayniSatir = nl < 0 ? kalan : kalan.slice(0, nl)
      const altSatirlar = nl < 0 ? '' : kalan.slice(nl + 1)
      for (const kapsam of [etiketleriSil(ayniSatir), etiketleriSil(altSatirlar)]) {
        if (!kapsam.trim()) continue
        const v = opt.dogrula(kapsam)
        if (v) return String(v).trim()
      }
      continue
    }
    for (const d of satirlar) {
      if (ETIKET_KELIMELERI.test(d)) continue   // etiketin devamı — değer değil
      if (d.replace(/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]/g, '').length < 1) continue
      return d.replace(/\s{2,}/g, ' ').trim()
    }
  }
  return null
}

// Şasi (VIN): 17 hane, I/O/Q kullanılmaz. Etikete gerek yok — desen tek başına
// çok ayırt edici, OCR etiketi kaçırsa bile bulunur.
function vinBul(metin) {
  const aday = String(metin).toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []
  // Sadece rakamdan oluşanları ele (tescil sıra no 19 hane ama 17'lik parçası tutabilir)
  return aday.find(v => /[A-Z]/.test(v) && /\d/.test(v)) || null
}

// "(D.2) TİPİ", "(CA3) ADRESİ" gibi ALAN KODU + BÜYÜK HARFLİ ETİKET bloklarını
// siler. İki sütunlu OCR çıktısında değeri etiketten ayırmanın anahtarı bu.
function etiketleriSil(t) {
  return String(t)
    .replace(/\(\s*[A-ZİŞĞÜÖÇ]{1,3}\s*\.?\s*\d?\s*\)\s*[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s./]{1,28}/g, ' ')
    .replace(/\(\s*[A-ZİŞĞÜÖÇ]{1,3}\s*\.?\s*\d?\s*\)/g, ' ')
}

// Gurultulu metinden ilk ANLAMLI kelime. Etiket parcalarini, tek harfleri ve
// bilinen sutun basliklarini eler. min = en az kac karakter olmali.
const COP_KELIME = /^(?:NO|ADI|VE|B|I|İ|BI|Bİ|BU|BÜ|EA|EG|EĞ|II|LAL|VU|ON|ORANI|GUC|GÜÇ|MAH|CAD)$/i
function ilkKelime(t, min = 3) {
  const parcalar = String(t).replace(/[|;:_"'`~]+/g, ' ').split(/[\s,]+/)
  for (const ham of parcalar) {
    const k = ham.replace(/^[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]+|[^A-Za-z0-9ÇĞİÖŞÜçğıöşü)(-]+$/g, '')
    if (k.length < min) continue
    if (COP_KELIME.test(k)) continue
    // ⚠️ Alan kodu sayılmak için PARANTEZ ya da NOKTA şart: "(D.4)" / "D.4"
    //    kod, ama "C4" bir MODEL ADI (Citroën C4). Eski desen onu da eliyordu.
    if (/^\([A-ZİŞĞÜÖÇ]\.?\d?\)$/.test(k) || /^[A-ZİŞĞÜÖÇ]\.\d$/.test(k)) continue
    if (!/[A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,}/.test(k)) continue
    return k
  }
  return undefined
}

// --- Noterlik adı -------------------------------------------------------
// Göksenil (5 Ağu 2026): "yeni ruhsatı okutmaya ek olarak noter adını da
//   okuyup otomatik doldursun — İZMİR 23.NOTERLİĞİ mesela."
//
// 2023'ten beri araç tescili noterde yapılıyor ve ruhsatın "VERİLDİĞİ İL /
// İLÇE" alanına noterlik yazılıyor:  "İZMİR / İZMİR 23 NOTERLİĞİ"
//
// ⚠️ QR bu bilgiyi TAŞIMAZ (QR'da yalnız plaka/seri/kimlik var) — bu yüzden
//    değer ancak basılı metinden, yani OCR'dan gelebilir.
// ⚠️ TRAFİK TESCİLDEN verilmiş ruhsatlarda burası ilçe adıdır
//    ("İZMİR / KARABAĞLAR"). O durumda noter YOKTUR ve alan BOŞ bırakılır —
//    ilçe adını noter diye yazmak sessiz yanlış veri olurdu.
// ⚠️ Çapa "NOTERL" (NOTERLİĞİ). Ruhsattaki komşu ETİKETLER "(Z.3.2) NOTER
//    SATIŞ NO" ve "(Z.3.3) NOTERİN ADI" bu deseni TUTTURMAZ — ikisinde de
//    NOTER'den sonra L gelmiyor. Etiketi değer sanma tuzağı böyle kapandı.
const NOTER_COP = /^(?:IL|ILCE|ADI|NO|VE|BILGILER|DIGER|MUHUR|IMZA|SATIS|TARIHI|NOTER)$/
function noterAdi(t) {
  const ham = String(t).replace(/\s+/g, ' ')
  // ⚠️ normal() harf harf değiştirir (İ→I, Ş→S…) — UZUNLUĞU KORUR, bu yüzden
  //    normalleştirilmiş metinde bulunan indeks HAM metinde de aynı yeri gösterir.
  //    Ham metin üzerinde arasaydık OCR'ın "NOTERLIĞI/NOTERLİGİ" varyasyonları kaçardı.
  const i = normal(ham).indexOf('NOTERL')
  if (i < 0) return undefined
  // NOTERLİĞİ'nden ÖNCEKİ son "kelime + sıra no" parçası:
  //   "İZMİR / İZMİR 23" → il "İZMİR", sıra "23"
  const m = ham.slice(0, i).trim().match(/([A-Za-zÇĞİÖŞÜçğıöşü]{3,25})\s*(\d{1,3})?\s*[.\s]*$/)
  if (!m) return undefined
  const ad = m[1].toLocaleUpperCase('tr-TR')
  if (NOTER_COP.test(normal(ad))) return undefined
  return m[2] ? `${ad} ${m[2]}. NOTERLİĞİ` : `${ad} NOTERLİĞİ`
}

const PLAKA_RE = /\b(\d{2})\s?([A-ZÇĞİÖŞÜ]{1,3})\s?(\d{2,5})\b/

// Ruhsat "28-05-2027" yazar, <input type="date"> "2027-05-28" ister.
export function tarihISO(s) {
  const m = String(s || '').match(/(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})/)
  if (!m) return null
  const [, gun, ay, yil] = m
  return `${yil}-${ay.padStart(2, '0')}-${gun.padStart(2, '0')}`
}

// --- RENK ve YAKIT: kapalı liste → doğrudan FORM KODU -------------------
// Ruhsat bu alanları serbest metin yazar ("GÜMÜŞ GRİ", "BENZİNLİ"); formdaki
// açılır listeler ise `tanimlar` kodlarını istiyor (GUMUS_GRI, BENZIN).
// Çeviriyi İKİ YERDE yapmamak için okuyucu doğrudan form kodunu döndürür.
//
// ⚠️ İKİ TUZAK, ikisi de kapatıldı:
//   1. "GRİ" kelimesi "GÜMÜŞ GRİ" içinde geçiyor → UZUN AD ÖNCE denenir.
//   2. "SARI" kelimesi adresteki "SARIYER"in içinde geçiyor → kelime sınırı
//      şart (iki sütunlu OCR'da adres yan sütundan sızabiliyor).
const RENK_ESLESME = [
  ['GUMUS GRI', 'GUMUS_GRI'], ['GUMUSGRI', 'GUMUS_GRI'], ['GUMUS', 'GUMUS_GRI'],
  ['KAHVERENGI', 'KAHVERENGI'], ['SAMPANYA', 'SAMPANYA'], ['LACIVERT', 'LACIVERT'],
  ['TURKUAZ', 'TURKUAZ'], ['TURUNCU', 'TURUNCU'], ['KIRMIZI', 'KIRMIZI'],
  ['BEYAZ', 'BEYAZ'], ['SIYAH', 'SIYAH'], ['YESIL', 'YESIL'], ['BORDO', 'BORDO'],
  ['PEMBE', 'PEMBE'], ['MAVI', 'MAVI'], ['FUME', 'FUME'], ['SARI', 'SARI'],
  ['GRI', 'GRI'], ['BEJ', 'BEJ'], ['MOR', 'MOR'],
].sort((a, b) => b[0].length - a[0].length)

function renkKodu(metin) {
  const N = normal(metin)   // Ü→U, İ→I, Ş→S … OCR'ın Türkçe karmaşasını düzler
  for (const [ad, kod] of RENK_ESLESME) {
    if (new RegExp(`(?:^|[^A-Z0-9])${ad}(?:[^A-Z0-9]|$)`).test(N)) return kod
  }
  return undefined
}

// Sıra ÖNEMLİ: "BENZİN+LPG" içinde "BENZİN" de var — LPG önce sorulmalı.
const YAKIT_ESLESME = [
  [/BENZ[İIı]N\s*[+\/&-]?\s*LPG|LPG\s*[+\/&-]?\s*BENZ[İIı]N|\bLPG\b/i, 'BENZIN_LPG'],
  [/\bD[İIı]ZEL/i,                                                     'DIZEL'],
  [/\bELEKTR[İIı]K/i,                                                  'ELEKTRIK'],
  [/H[İIı]BR[İIı]T|HYBR[İIı]D/i,                                       'HIBRIT'],
  [/\bBENZ[İIı]N/i,                                                    'BENZIN'],
]
function yakitKodu(metin) {
  for (const [re, kod] of YAKIT_ESLESME) if (re.test(String(metin))) return kod
  return undefined
}

/**
 * OCR satırlarından ruhsat alanlarını çıkarmayı dener.
 * @param {string[]} satirlar OCR ham satırları
 * @param {object} qr ruhsatQrOku() sonucu (varsa KESİN alanlar oradan gelir)
 * @returns {Object<string,{deger:string, kaynak:'QR'|'OCR', yontem:string}>}
 */
export function ruhsatAlanCikar(satirlar, qr) {
  const metin = (satirlar || []).join('\n')
  const out = {}
  const koy = (key, deger, kaynak, yontem) => {
    if (deger == null || deger === '') return
    if (out[key] && out[key].kaynak === 'QR') return   // QR'ı OCR EZMESİN
    out[key] = { deger: String(deger).trim(), kaynak, yontem }
  }

  // --- 1) QR: kesin alanlar önce yazılır ---
  if (qr && qr.ok) {
    koy('plaka', qr.plaka, 'QR', 'qr')
    koy('belge_seri', qr.seri, 'QR', 'qr')
    koy('kimlik', qr.kimlik, 'QR', 'qr')
  }

  // --- 2) Etikete tutunan alanlar ---
  const ET = {
    sasi:          ['(E) ŞASE NO', 'ŞASE NO', 'SASE NO', 'ŞASİ NO'],
    motor_no:      ['(P.5) MOTOR NO', 'MOTOR NO'],
    marka:         ['(D.1) MARKASI', 'MARKASI'],
    tip:           ['(D.2) TİPİ', 'TİPİ'],
    ticari_ad:     ['(D.3) TİCARİ ADI', 'TİCARİ ADI'],
    model_yili:    ['(D.4) MODEL YILI', 'MODEL YILI'],
    arac_sinifi:   ['(J) ARAÇ SINIFI', 'ARAÇ SINIFI'],
    cinsi:         ['(D.5) CİNSİ', 'CİNSİ'],
    renk:          ['(R) RENGİ', 'RENGİ'],
    yakit:         ['(P.3) YAKIT CİNSİ', 'YAKIT CİNSİ'],
    motor_gucu:    ['(P.2) MOTOR GÜCÜ', 'MOTOR GÜCÜ'],
    silindir:      ['(P.1) SİLİNDİR HACMİ', 'SİLİNDİR HACMİ'],
    koltuk:        ['(S.1) KOLTUK SAYISI', 'KOLTUK SAYISI'],
    net_agirlik:   ['(G.1) NET AĞIRLIĞI', 'NET AĞIRLIĞI'],
    azami_agirlik: ['(F.1) AZAMİ YÜKLÜ AĞIRLIĞI', 'AZAMİ YÜKLÜ AĞIRLIĞI'],
    ilk_tescil:    ['(B) İLK TESCİL TARİHİ', 'İLK TESCİL TARİHİ'],
    tescil_tarihi: ['(I) TESCİL TARİHİ', 'TESCİL TARİHİ'],
    tescil_sira:   ['(Y.2) TESCİL SIRA NO', 'TESCİL SIRA NO'],
    kullanim:      ['(Y.3) KULLANIM AMACI', 'KULLANIM AMACI'],
    sahip_ad:      ['(C.1.1) SOYADI/ TİCARİ ÜNVANI', '(C.1.1) SOYADI/TİCARİ ÜNVANI', 'SOYADI/ TİCARİ ÜNVANI', 'SOYADI / TİCARİ ÜNVANI', 'TİCARİ ÜNVANI'],
    adres:         ['(C.1.3) ADRESİ', 'ADRESİ'],
    tescil_yeri:   ['(Y.1) VERİLDİĞİ İL / İLÇE', 'VERİLDİĞİ İL / İLÇE', 'VERİLDİĞİ İL/İLÇE', 'VERİLDİĞİ İL'],
    // Aynı kutu, farklı okuma: tescil_yeri ham metni verir, noter ondan
    // noterlik adını süzer. (X.1) yeni basım ruhsatlarda görülen kod.
    noter:         ['(X.1) VERİLDİĞİ İL / İLÇE', '(Y.1) VERİLDİĞİ İL / İLÇE', 'VERİLDİĞİ İL / İLÇE', 'VERİLDİĞİ İL/İLÇE', 'VERİLDİĞİ İL'],
    belge_seri:    ['BELGE Seri', 'BELGE SERİ'],
    plaka:         ['(A) PLAKA', 'PLAKA'],
  }
  // ⚠️ HER ALANIN KENDİ DOĞRULAYICISI VAR — gerçek OCR çıktısıyla öğrenildi.
  // Ruhsat İKİ SÜTUNLU; OCR sol ve sağ sütunu AYNI SATIRA birleştiriyor:
  //   "-(P.S) MOTOR NO Dİ (Z.3.2) NOTER SATIŞ NO 10XVDWI1870534"
  // Satır sırasına güvenen okuma burada çöp toplar. Ayrıca OCR (P.5)'i (P.S)
  // okuyabiliyor. Bu yüzden: etiketten sonraki metinde, o alanın BİÇİMİNE
  // uyan ilk parçayı arıyoruz. Uyan yoksa alan BOŞ bırakılır — çöp yazmaktansa
  // "bulunamadı" demek doğru olan.
  const AY = '(?:0?[1-9]|1[0-2])', GUN = '(?:0?[1-9]|[12]\\d|3[01])'
  // ⚠️ Baştaki \b YOK: OCR "mua.geç.tfhs28-05-2027" gibi BİTİŞİK yazabiliyor,
  //    \b oradan eşleşmeyi engelliyordu.
  const TARIH_RE = new RegExp(`${GUN}[./-]${AY}[./-](?:19|20)\\d{2}`)
  const DOGRULA = {
    // 17 hane VIN — I/O/Q yok, hem harf hem rakam içerir
    sasi:          t => (t.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []).find(v => /[A-Z]/.test(v) && /\d/.test(v)),
    // Motor no: 5-20 harf+rakam. Etiket parçalarını ve saf sayıları ele.
    motor_no:      t => (t.toUpperCase().match(/\b[A-Z0-9]{5,20}\b/g) || [])
                          .find(v => /\d/.test(v) && !/^(NOTER|SATIS|SATIŞ|ADI|MOTOR)$/.test(v) && !/^\d{1,4}$/.test(v)),
    model_yili:    t => (t.match(/\b(19[89]\d|20[0-4]\d)\b/) || [])[0],
    arac_sinifi:   t => (t.toUpperCase().match(/\b([MNLOT][1-3][G]?)\b/) || [])[0],
    yakit:         t => yakitKodu(t),
    renk:          t => renkKodu(t),
    motor_gucu:    t => (t.match(/\b\d{1,4}\b/) || [])[0],
    silindir:      t => (t.match(/\b\d{3,5}\b/) || [])[0],
    koltuk:        t => (t.match(/\b\d{1,2}\b/) || [])[0],
    net_agirlik:   t => (t.match(/\b\d{3,5}\b/) || [])[0],
    azami_agirlik: t => (t.match(/\b\d{3,5}\b/) || [])[0],
    ilk_tescil:    t => (t.match(TARIH_RE) || [])[0],
    tescil_tarihi: t => (t.match(TARIH_RE) || [])[0],
    muayene:       t => (t.match(TARIH_RE) || [])[0],
    tescil_sira:   t => (t.match(/\b\d{12,22}\b/) || [])[0],
    plaka:         t => { const m = t.toUpperCase().match(PLAKA_RE); return m ? m[0].replace(/\s+/g, '') : undefined },
    noter:         t => noterAdi(t),
    // Metin alanlari: iki sutunlu gurultuden ILK ANLAMLI kelimeyi al.
    // ("'— CİTROEN B || EMREZ MAH..." -> CİTROEN · "C4 2022 M1 Bi" -> C4)
    marka:         t => ilkKelime(t, 3),
    ticari_ad:     t => ilkKelime(t, 2),
    cinsi:         t => ilkKelime(t, 4),
    belge_seri:    t => { const m = t.toUpperCase().match(/\b([A-Z]{1,3})\s*[№N]?[o°]?\s*(\d{4,8})\b/); return m ? m[1] + m[2] : undefined },
  }
  // Muayene tarihi ruhsatta "(Z.2) DİĞER BİLGİLER" kutusunda serbest metin:
  // "mua.geç.trh: 03-02-2027". OCR bunu "mua.geç.tfhs28-05-2027" gibi bozabiliyor.
  ET.muayene = ['mua.geç.trh', 'mua.gec.trh', 'MUA.GEÇ', 'MUA.GEC', 'MUAYENE']

  for (const [key, etiketler] of Object.entries(ET)) {
    const d = etiketSonrasi(metin, etiketler, { dogrula: DOGRULA[key] })
    if (d) koy(key, d, 'OCR', 'etiket')
  }

  // --- 3) Etiket bulunamadıysa: TÜM METİNDE desen ara (yalnız çok ayırt edici
  //        olanlar — yanlış eşleşme riski düşük olanlar) ---
  // ⚠️ noter BURADA da aranıyor: ruhsat iki sütunlu ve OCR "VERİLDİĞİ İL /
  //    İLÇE" etiketini sık bozuyor. "NOTERLİĞİ" kelimesi tek başına yeterince
  //    ayırt edici — etiket kaçsa bile değer bulunur.
  const genel = { sasi: 'VIN deseni', plaka: 'plaka deseni', model_yili: 'yıl deseni', muayene: 'tarih deseni', noter: 'noterlik deseni' }
  for (const [key, yontem] of Object.entries(genel)) {
    if (out[key] || !DOGRULA[key]) continue
    const v = DOGRULA[key](metin)
    if (v) koy(key, v, 'OCR', yontem)
  }

  return out
}
