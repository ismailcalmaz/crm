// =====================================================================
// ruhsat-qr.js — ARAÇ TESCİL BELGESİ (RUHSAT) QR OKUYUCU
//
//   Göksenil: "ruhsatı sürükle bırak yaptığımda QR kodunu ücretsiz olarak
//   okuttursak."
//
// ⚠️ QR'DA NE VAR — 2333 GERÇEK RUHSATTAN ÖLÇÜLDÜ (1 Ağu 2026), tahmin DEĞİL:
//   Yük tek satır, üç alan, tire ile ayrılmış:
//       IJ156258-06DKC104-6490790903
//       └belge─┘ └plaka─┘ └TCKN/VKN┘
//   Belgeyle birebir eşleşiyor: "BELGE Seri: IJ № 156258" · "(A) PLAKA" ·
//   "(Y.4) T.C. KİMLİK NO / VERGİ NO".
//
// ⚠️ MARKA / MODEL / ŞASİ / MOTOR / RENK / YAKIT / YIL QR'DA **YOKTUR**.
//   Onlar belgenin üstünde yalnızca BASILI METİN. QR bir veri kabı değil,
//   NVI doğrulama anahtarıdır. Bu yüzden burada o alanlar doldurulmaz —
//   "okudum" deyip boş bırakmak, kullanıcıya yanlış güven verirdi.
//
// ⚠️ Ölçülen başarı oranı: 70 gerçek ruhsatta 51 (%73). Okunamayan belgeler
//   genelde QR'sız eski format ya da parlamalı/eğik fotoğraf. Okunamazsa
//   kullanıcı elle girer — akış DURMAZ.
//
// ⚠️ ÜCRETSİZ ve YEREL: önce tarayıcının yerleşik BarcodeDetector'ı, yoksa
//   jsQR (WASM değil, saf JS). Belge hiçbir yere GİTMEZ.
// =====================================================================

// TCKN 11 hane, VKN 10 hane. Plaka boşluklu da gelebiliyor (16BOT44 gibi
// boşluksuz da) — bu yüzden ortadaki alan serbest bırakıldı.
const RUHSAT_QR = /^([A-Z]{1,3}\d{4,8})-([A-Z0-9 ]{5,12})-(\d{10,11})$/i

let _jsqr = null
async function jsQR() {
  if (_jsqr) return _jsqr
  const m = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm')
  _jsqr = m.default || m
  return _jsqr
}

/** Dosya → canvas (görselse doğrudan, PDF ise ilk sayfa 3x render). */
async function canvasYap(file) {
  const pdfMi = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  if (pdfMi) {
    const { pdfIlkSayfaCanvas } = await import('./tramer-ocr.js')
    return pdfIlkSayfaCanvas(file, 3)
  }
  const bmp = await createImageBitmap(file)
  const c = document.createElement('canvas')
  c.width = bmp.width; c.height = bmp.height
  c.getContext('2d').drawImage(bmp, 0, 0)
  return c
}

// Kaynak canvas'tan bir dikdörtgeni istenen ölçekte yeni canvas'a al.
function kirp(c, x, y, w, h, olcek = 1) {
  const d = document.createElement('canvas')
  d.width = Math.round(w * olcek); d.height = Math.round(h * olcek)
  const g = d.getContext('2d', { willReadFrequently: true })
  g.imageSmoothingEnabled = olcek < 1     // küçültürken yumuşat, büyütürken sertleştir
  g.drawImage(c, x, y, w, h, 0, 0, d.width, d.height)
  return d
}

/**
 * Canvas'ta QR ara.
 * ⚠️ PARÇALI TARAMA ŞART — ölçüldü: tüm kareyi tek seferde jsQR'a vermek
 * telefon fotoğraflarında ÇALIŞMIYOR (8 gerçek ruhsatta yalnız 2). Ruhsat
 * fotoğrafı 4000+ px ve QR karenin küçük bir köşesinde kalıyor; jsQR o
 * ölçekte deseni bulamıyor. Görüntüyü örtüşen parçalara bölüp her parçayı
 * ayrı taramak sorunu çözüyor.
 */
async function qrAra(c) {
  // 1) Yerleşik BarcodeDetector (varsa) — en hızlısı, perspektifte de iyi
  try {
    if ('BarcodeDetector' in window) {
      // eslint-disable-next-line no-undef
      const desteklenen = await BarcodeDetector.getSupportedFormats?.() || []
      if (!desteklenen.length || desteklenen.includes('qr_code')) {
        // eslint-disable-next-line no-undef
        const det = new BarcodeDetector({ formats: ['qr_code'] })
        for (const b of await det.detect(c)) if (b.rawValue) return b.rawValue
      }
    }
  } catch (e) { console.debug('[ruhsat-qr] BarcodeDetector kullanılamadı', e) }

  // 2) jsQR — parçalı tarama
  const q = await jsQR()
  const dene = (kanvas) => {
    const im = kanvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, kanvas.width, kanvas.height)
    const r = q(im.data, im.width, im.height, { inversionAttempts: 'attemptBoth' })
    return (r && r.data) ? r.data : null
  }

  const W = c.width, H = c.height
  const enBuyuk = Math.max(W, H)

  // 2a) Tüm kare — makul boyuta indirilmiş (büyük görüntüde jsQR yavaş ve zayıf)
  const kucultme = enBuyuk > 1600 ? 1600 / enBuyuk : 1
  let s = dene(kirp(c, 0, 0, W, H, kucultme))
  if (s) return s

  // 2b) Örtüşen parçalar. Ruhsatta QR sağ altta ama fotoğraf döndürülmüş
  //     olabildiği için TÜM kare taranıyor. %50 örtüşme, parça sınırına denk
  //     gelen QR'ın kesilmemesi için.
  // ⚠️ Bölme listesi ÖLÇÜLEREK seçildi: [2,3] ile 5/8 okunuyor, 4'ü eklemek
  // yeni bir belge kazandırmıyor ama BAŞARISIZ durumu ~7 sn'ye çıkarıyordu.
  for (const bol of [2, 3]) {
    const pw = Math.ceil(W / bol), ph = Math.ceil(H / bol)
    const adimX = Math.max(1, Math.floor(pw / 2)), adimY = Math.max(1, Math.floor(ph / 2))
    for (let y = 0; y + 1 < H; y += adimY) {
      for (let x = 0; x + 1 < W; x += adimX) {
        const w = Math.min(pw, W - x), h = Math.min(ph, H - y)
        if (w < 80 || h < 80) continue
        // Parçayı ~1000 px'e getir: çok küçükse büyüt, çok büyükse küçült
        const hedef = 1000 / Math.max(w, h)
        s = dene(kirp(c, x, y, w, h, Math.min(Math.max(hedef, 0.5), 3)))
        if (s) return s
      }
    }
  }
  return null
}

/**
 * Ruhsat dosyasından QR oku.
 * @returns {Promise<{ok:boolean, ham:string|null, seri:string|null,
 *                     plaka:string|null, kimlik:string|null,
 *                     kimlikTipi:'TCKN'|'VKN'|null, hata:string|null}>}
 */
export async function ruhsatQrOku(file) {
  const bos = { ok: false, ham: null, seri: null, plaka: null, kimlik: null, kimlikTipi: null, hata: null }
  try {
    const c = await canvasYap(file)
    const ham = await qrAra(c)
    if (!ham) return { ...bos, hata: 'QR bulunamadı' }

    const m = String(ham).trim().match(RUHSAT_QR)
    if (!m) {
      // QR var ama beklenen biçimde değil — ham değeri GİZLEMEDEN döndür,
      // sessizce yutmak ileride hata ayıklamayı imkânsız kılardı.
      return { ...bos, ham, hata: 'QR okundu ama ruhsat biçimi değil' }
    }
    const kimlik = m[3]
    return {
      ok: true, ham,
      seri: m[1].toUpperCase(),
      plaka: m[2].toUpperCase().replace(/\s+/g, ''),
      kimlik,
      kimlikTipi: kimlik.length === 11 ? 'TCKN' : 'VKN',
      hata: null,
    }
  } catch (e) {
    console.error('[ruhsat-qr] okuma hatası', e)
    return { ...bos, hata: e.message }
  }
}

/** Plaka karşılaştırma — belge bu araca mı ait? (tramer şasi kontrolüyle aynı fikir) */
export function plakaKarsilastir(qrPlaka, girilenPlaka) {
  const a = String(qrPlaka || '').toUpperCase().replace(/\s+/g, '')
  const b = String(girilenPlaka || '').toUpperCase().replace(/\s+/g, '')
  if (!a || !b) return { durum: 'BILINMIYOR', mesaj: null }
  if (a === b) return { durum: 'UYUYOR', mesaj: `Plaka ruhsatla uyuşuyor (${a}).` }
  return {
    durum: 'UYUSMUYOR',
    mesaj: `DİKKAT: Ruhsattaki plaka ${a}, forma girilen ${b}. Belge başka araca ait olabilir.`,
  }
}
