// =====================================================================
// tramer-ocr.js — SBM/TRAMER BELGESİNDEN OTOMATİK VERİ OKUMA
//
//   Göksenil: "sisteme sürükle bırak diyeceğim, o metne dönüştürecek —
//   ücretsiz bir şekilde."
//
// ⚠️ ÖNCE METİN, SONRA OCR. SBM belgesi dijital üretiliyor: PDF ise metin
// katmanı vardır ve pdf.js onu BİREBİR okur — OCR'a hiç gerek yok, sonuç
// kesin. OCR yalnızca ekran görüntüsü/fotoğraf geldiğinde devreye girer.
// Ekspertiz okuyucusu (ekspertiz.js) da aynı deseni kullanıyor.
//
// ⚠️ ÜCRETSİZ ve YEREL. Tesseract.js tarayıcıda (WASM) çalışır; belge hiçbir
// yere GİTMEZ. Ücretsiz bulut OCR servisleri tramer belgesini üçüncü tarafa
// gönderirdi — müşteri verisi olduğu için o yol kapalı.
//
// ⚠️ OCR SESSİZCE YAZMAZ. Çıkardığı her satır kullanıcıya gösterilir, o
// onaylamadan veritabanına hiçbir şey yazılmaz. Fotoğraftan okunan bir rakama
// körlemesine güvenip tramer tutarı yazmak, sonra o rakamla araç fiyatlamak
// bu projede kaçındığımız hata sınıfıdır.
//
// GERÇEK BELGEYLE KALİBRE EDİLDİ (31 Tem 2026, FORD RANGER örneği):
//   Başlık : "Araç Marka ve Model: ..." · "Şasi No: ***9035"
//   Tablo  : Hasar Tarihi | Hasar Nedeni | Hasar Tutarı
//            13.02.2022  Carpma      -
//            13.01.2018  ERP-Çarpma  9.283,83 TL
//   Alt    : "Bu sorgu 31.07.2026 17:27 tarihinde yapılmıştır..."
// =====================================================================

// ---------------------------------------------------------------------
// KÜTÜPHANELER — ikisi de dinamik yüklenir (sayfa açılışına yük binmez)
// ---------------------------------------------------------------------
let _pdfjs = null
async function pdfjs() {
  if (_pdfjs) return _pdfjs
  // ekspertiz.js ile AYNI sürüm — iki farklı pdf.js indirmemek için.
  const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs')
  lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs'
  _pdfjs = lib
  return lib
}

let _tess = null
async function tesseract() {
  if (_tess) return _tess
  const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js')
  // ⚠️ tesseract.js ESM paketi HER ŞEYİ `default` altında veriyor; modülün
  // kendisinde createWorker YOK. `mod.createWorker` çağırmak
  // "T.createWorker is not a function" ile patlıyordu ve bu hata ancak GERÇEK
  // bir görüntü okunduğunda ortaya çıkıyordu (metin katmanlı PDF bu yola hiç
  // girmiyor). İki biçimi de kabul ediyoruz.
  _tess = (mod && typeof mod.createWorker === 'function') ? mod : (mod.default || mod)
  if (typeof _tess?.createWorker !== 'function') {
    throw new Error('OCR kütüphanesi yüklenemedi (createWorker yok).')
  }
  return _tess
}

// ---------------------------------------------------------------------
// METİN ÇIKARMA
// ---------------------------------------------------------------------
// pdf.js kelimeleri {str,x,y} olarak verir, satır kavramı YOKTUR. Aynı satırın
// parçalarını y koordinatına göre grupluyoruz — yoksa "13.02.2022" ile
// "9.283,83 TL" ayrı satırlarmış gibi görünür ve eşleştirme çöker.
function kelimeleriSatirlastir(kelimeler, tolerans = 4) {
  const satirlar = []
  for (const k of kelimeler.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const son = satirlar[satirlar.length - 1]
    if (son && Math.abs(son.y - k.y) <= tolerans) son.parcalar.push(k)
    else satirlar.push({ y: k.y, parcalar: [k] })
  }
  return satirlar.map(s =>
    s.parcalar.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim()
  ).filter(Boolean)
}

async function pdfMetni(file) {
  const lib = await pdfjs()
  const buf = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: buf }).promise
  const tumSatirlar = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const sayfa = await pdf.getPage(i)
    const vp = sayfa.getViewport({ scale: 1 })
    const tc = await sayfa.getTextContent()
    const kelimeler = tc.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ str: it.str.trim(), x: it.transform[4], y: vp.height - it.transform[5] }))
    tumSatirlar.push(...kelimeleriSatirlastir(kelimeler))
  }
  return { satirlar: tumSatirlar, pdf, lib }
}

// PDF'in ilk sayfasını görüntüye çevir (metin katmanı yoksa OCR için)
async function pdfSayfaGoruntu(pdf, olcek = 2) {
  const sayfa = await pdf.getPage(1)
  const vp = sayfa.getViewport({ scale: olcek })
  const c = document.createElement('canvas')
  c.width = vp.width; c.height = vp.height
  await sayfa.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
  return c
}

/**
 * PDF'in ilk sayfasını canvas olarak döndürür (ruhsat QR okuyucusu kullanır).
 * ⚠️ pdf.js yükleyicisi BURADA tek kopya — ruhsat-qr.js kendi kopyasını
 * yazmasın diye dışa açıldı (CLAUDE.md §4: kopya yardımcı yazma).
 */
export async function pdfIlkSayfaCanvas(file, olcek = 3) {
  const lib = await pdfjs()
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise
  return pdfSayfaGoruntu(pdf, olcek)
}

async function ocrMetni(kaynak, ilerleme) {
  const T = await tesseract()
  // 'tur' Türkçe başlıkları ("Hasar Tarihi", "Hasar Tutarı") doğru okusun diye;
  // sütunu bulmak için o başlıklar gerekiyor. İlk kullanımda dil paketi bir kez
  // inip tarayıcıda önbelleğe alınır.
  const worker = await T.createWorker('tur', 1, {
    logger: m => { if (m.status === 'recognizing text' && ilerleme) ilerleme(m.progress) },
  })
  try {
    const { data } = await worker.recognize(kaynak)
    return String(data.text || '').split('\n').map(s => s.trim()).filter(Boolean)
  } finally {
    await worker.terminate()
  }
}

/**
 * Dosyadan satır listesi çıkarır.
 * @returns {{satirlar:string[], kaynak:'PDF_METIN'|'OCR'}}
 */
export async function belgeSatirlari(file, ilerleme) {
  const pdfMi = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  if (pdfMi) {
    const { satirlar, pdf } = await pdfMetni(file)
    // Metin katmanı var mı? Taranmış PDF'te item'lar boş gelir.
    // Eşik düşük tutuldu: SBM belgesi kısa, 5 satır bile gerçek metin demek.
    if (satirlar.join('').length > 40) return { satirlar, kaynak: 'PDF_METIN' }
    const c = await pdfSayfaGoruntu(pdf)
    return { satirlar: await ocrMetni(c, ilerleme), kaynak: 'OCR' }
  }
  return { satirlar: await ocrMetni(file, ilerleme), kaynak: 'OCR' }
}

// ---------------------------------------------------------------------
// AYRIŞTIRMA — gerçek SBM belgesine göre kalibre
// ---------------------------------------------------------------------
const RE_TARIH = /(\d{2})\.(\d{2})\.(\d{4})/
// 9.283,83 TL · 1.691,88TL · 12.345,67 ₺ — binlik nokta, kuruş virgül
const RE_TUTAR = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:TL|₺)?/i

const isoTarih = m => `${m[3]}-${m[2]}-${m[1]}`
const tutarSayi = s => Number(String(s).replace(/\./g, '').replace(',', '.'))

/**
 * Ham satırlardan tramer kayıtlarını çıkarır.
 * @returns {{sorguTarihi, sasiSon, markaModel, kayitlar:[{hasar_tarihi,aciklama,tutar}], uyarilar:string[]}}
 */
export function tramerAyristir(satirlar) {
  const metin = satirlar.join('\n')
  const uyarilar = []

  // Sorgu tarihi — "Bu sorgu 31.07.2026 17:27 tarihinde yapılmıştır"
  // ⚠️ Bu satır DA tarih içeriyor; hasar satırı sanılmasın diye ayrı yakalanıyor
  // ve aşağıda hasar taramasından açıkça dışlanıyor.
  const sorguM = metin.match(/Bu\s+sorgu\s+(\d{2}\.\d{2}\.\d{4})/i)
  const sorguTarihi = sorguM ? isoTarih(sorguM[1].match(RE_TARIH)) : null

  // ⚠️ Ş/S ve ç/c toleransı: belgenin KENDİSİ tutarsız (aynı belgede "Carpma"
  // ç'siz, "ERP-Çarpma" ç'li yazıyor); OCR de Türkçe harfleri düşürebiliyor.
  // Tek bir harfe bağlanan regex bu yüzden sessizce boş döner.
  const sasiM = metin.match(/[ŞS]asi\s*No\s*:?\s*\**\s*([A-Z0-9]{4,})/i)
  const sasiSon = sasiM ? sasiM[1].slice(-4).toUpperCase() : null

  const markaM = metin.match(/Ara[çc]\s*Marka\s*ve\s*Model\s*:?\s*(.+)/i)
  const markaModel = markaM ? markaM[1].trim() : null

  const kayitlar = []
  for (const ham of satirlar) {
    const s = ham.trim()
    // Hasar satırı TARİHLE BAŞLAR. Alt bilgi ("Bu sorgu…"), başlık ve yasal
    // uyarı da tarih/rakam içeriyor — baştan eşleşme onları eler.
    const bas = s.match(/^(\d{2}\.\d{2}\.\d{4})\b/)
    if (!bas) continue
    const t = bas[1].match(RE_TARIH)
    const kalan = s.slice(bas[0].length).trim()

    // Tutar: satırın SONUNDA. "-" ise tutar YOK (kayıt var, tutar girilmemiş).
    let tutar = null
    const tutarM = kalan.match(new RegExp(RE_TUTAR.source + '\\s*$', 'i'))
    if (tutarM) tutar = tutarSayi(tutarM[1])

    // Açıklama = tarihle tutar arasında kalan; sondaki "-" temizlenir.
    let aciklama = (tutarM ? kalan.slice(0, tutarM.index) : kalan)
      .replace(/[-–—]\s*$/, '').replace(/\s+/g, ' ').trim()

    // ⚠️ Filigran ("Sigorta Bilgi ve Gözetim Merkezi") tam Hasar Nedeni
    // sütununun üstünde duruyor; OCR onu açıklamaya karıştırabiliyor.
    const filigran = /sigorta\s*bilgi\s*ve\s*g[öo]zetim|merkezi/i
    if (filigran.test(aciklama)) {
      aciklama = aciklama.replace(filigran, '').replace(/\s+/g, ' ').trim()
      uyarilar.push(`${bas[1]} satırında filigran metni temizlendi — açıklamayı kontrol et.`)
    }

    kayitlar.push({ hasar_tarihi: isoTarih(t), aciklama: aciklama || null, tutar })
  }

  if (!kayitlar.length) uyarilar.push('Belgede hasar satırı bulunamadı. Görüntü net mi?')
  if (!sorguTarihi) uyarilar.push('Sorgu tarihi okunamadı — elle gir.')

  return { sorguTarihi, sasiSon, markaModel, kayitlar, uyarilar }
}

/**
 * Belgenin gerçekten BU araca ait olup olmadığını söyler.
 * ⚠️ Yanlış aracın tramerini kaydetmek, sonra o veriyle fiyatlamak demek —
 * ucuz bir kontrolle önlenebiliyorsa önlenmeli. Şasi son 4 hanesi SBM
 * belgesinde maskesiz veriliyor ("***9035").
 * @returns {{durum:'UYUYOR'|'UYUSMUYOR'|'BILINMIYOR', mesaj:string|null}}
 */
export function aracDogrula(ayristirma, arac) {
  const belge = ayristirma?.sasiSon
  const kayit = String(arac?.sasi_no || '').trim().slice(-4).toUpperCase()
  if (!belge || !kayit) return { durum: 'BILINMIYOR', mesaj: null }
  if (belge === kayit) return { durum: 'UYUYOR', mesaj: `Şasi son 4 hane uyuşuyor (${belge}).` }
  return {
    durum: 'UYUSMUYOR',
    mesaj: `DİKKAT: Belgedeki şasi ***${belge}, bu aracın şasisi ***${kayit}. Belge başka araca ait olabilir.`,
  }
}

/** Cam etiketi/ilan görseli ile AYNI özet kuralı (Göksenil): karışık kayıtta
 *  adet TÜMÜ, tutar yalnız girilmiş olanların toplamı. */
export function ozet(kayitlar) {
  const girilmis = kayitlar.filter(k => k.tutar != null && k.tutar > 0)
  return {
    adet: kayitlar.length,
    toplam: girilmis.reduce((s, k) => s + k.tutar, 0),
    tutarsiz: kayitlar.length - girilmis.length,
  }
}
