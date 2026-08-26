// =====================================================================
// cam-etiketi-duzenle.js — Cam etiketi YERLEŞİM EDİTÖRÜ (master admin)
//
//   Göksenil: "Görünenleri sürükleyip hizalamak, boyutlandırmak için küçük
//   bir editör yap. Her şeyi buradan ayarlayacağım."
//   Göksenil (matbaa kararı): "MATBAA ÇIKTISINI GÜNCELLEYEMEYİZ. MATBAA
//   ÇIKTISINA BAĞLI KALARAK İSTEDİĞİMİZ REVİZYONU YAPMALIYIZ."
//
//   ── Matbaa formunun ÖLÇÜLEN geometrisi (rehber JPG piksel analizi) ──
//   Matbaa YALNIZ çizgi + logo basıyor, TEK BİR YAZI BASMIYOR:
//     · dış çerçeve      0–7.4mm / 202–210mm / 264.7mm↓
//     · yatay bordo      33.7mm   → üst şerit (fiyat) burada biter
//     · yatay bordo      127.7mm  → orta blok (araç bilgisi) burada biter
//     · dikey bordo      104.5mm  (127.7 → 264.7 arası) → alt bloğu ikiye böler
//     · kısa yatay       218.2mm  (yalnız sağ sütunda) → kredi ayracı
//   Başlıklar, kutucuklar, ekspertiz şeması, renk efsanesi = YAZILIM basar.
//   Bu yüzden çizgilere dokunmadan içeriği serbestçe kurgulayabiliyoruz.
//
//   Konumlar MM cinsinden tutulur → yazıcı/ekran çözünürlüğünden bağımsız.
//   Kaydet → ayarlar.cam_etiketi_yerlesim (JSON).
// =====================================================================
import { supabase } from './supabase-client.js'
import { dbHata } from './veri.js'

// Alan kimlikleri cam-etiketi.js'teki data-alan değerleriyle BİREBİR.
//   x,y = sol üst köşe (mm) · g = genişlik (mm) · p = punto (mm)
//   h   = hiza (sol|orta|sag) · r = renk · k = kalınlık · gizli = basılmaz
export const VARSAYILAN_YERLESIM = {
  // ⚠️ PUNTOLAR "3 METREDEN OKUNSUN" DİYE BÜYÜTÜLDÜ (Göksenil: "cam
  // etiketindeki büyütebileceğimiz yazıları büyütmemiz gerekiyor, uzaktan
  // okunabilmeli"). Kör büyütme taşma yapar; her bölgenin matbaa çizgileri
  // arasındaki boşluğu ölçüp artışlar ona göre dağıtıldı.
  // KÜÇÜK KALANLAR bilinçli: kredi dipnotu (yasal ince yazı, uzaktan
  // okunması GEREKMEZ) ve renk açıklaması (şemanın yanında referans).

  // ── ÜST ŞERİT (7.4 → 33.0mm = 25.6mm) ──────────────────────────────
  // hMax 24: indirimli araçta üstü çizili referans fiyat da basılıyor ve
  // blok genişliyor. Sığmazsa punto kendiliğinden küçülür — matbaanın
  // 33.0mm'deki çizgisi kesilmesin diye emniyet kemeri.
  // x=9.7: beyaz alanın gerçek merkezi (7.4+201.9)/2 = 104.65mm. x=10 iken
  // alan merkezi 105 çıkıyordu (0.35mm sağa kaçık).
  // ⚠️ QR ÜST ŞERİDE, FİYATIN SOLUNA girdi (Göksenil, 1 Ağu 2026: "araç
  //   fiyatının sol tarafına hizalayabilirsin"). Fiyat artık TÜM beyaz alanı
  //   değil, QR'dan ARTAN alanı ortalıyor: beyaz alan 7.4–201.9, QR 10–34 →
  //   kalan 36–201.9 → x=36, g=163 (sağ kenar 199, matbaanın 201.9'daki
  //   çerçevesine 2.9mm pay; g=166'da kutu 202'ye dayanıyordu).
  fiyat:     { x: 36, y: 9.5, g: 163, p: 22,  h: 'orta', r: '#3f3f3f', k: 900, hMax: 24 },

  // ── ORTA BLOK (34.4 → 127.7mm) ─────────────────────────────────────
  yil:       { x: 18,  y: 44,  g: 62,  p: 32,  h: 'sol',  r: '#3f3f3f', k: 900 },
  // yakit/vites 72 → 60mm: model kutusu x=85'ten basliyor, 72mm'de x=90'a
  // uzanip UZUN MODEL ADLARINDA model bloguyla cakisiyordu.
  yakit:     { x: 18,  y: 88,  g: 60,  p: 11.5, h: 'sol', r: '#3f3f3f', k: 700, hMax: 14 },
  vites:     { x: 18,  y: 101, g: 60,  p: 11.5, h: 'sol', r: '#3f3f3f', k: 700, hMax: 14 },
  marka:     { x: 85,  y: 39,  g: 112, p: 12,  h: 'sol',  r: '#3f3f3f', k: 800, hMax: 14 },
  // hMax 34: uzun model+versiyon+kasa (ornek: Mercedes C 200 d BlueTEC AMG
  // Line 4MATIC 9G-Tronic Premium Plus Night Paket) 4 satira cikip KM'nin
  // uzerine biniyordu; simdi punto kendiliginden kuculup 34mm'ye sigiyor.
  model:     { x: 85,  y: 55,  g: 112, p: 9.5, h: 'sol',  r: '#3f3f3f', k: 700, hMax: 34 },
  km:        { x: 100, y: 93,  g: 88,  p: 12,  h: 'sag',  r: '#3f3f3f', k: 800, hMax: 14 },
  // Orta bloğun alt boş bandı
  // KDV: Göksenil "kdv i kaldır" → basılmıyor. Alan duruyor ki tek kutucukla
  // geri açılabilsin; veri (kdv_orani) zaten yerinde.
  kdv:       { x: 18,  y: 116, g: 80,  p: 6.5, h: 'sol',  r: '#5f1818', k: 800, gizli: true },
  muayene:   { x: 18,  y: 116, g: 58,  p: 6.5, h: 'sol',  r: '#3f3f3f', k: 700, hMax: 9 },
  garanti:   { x: 100, y: 109, g: 88,  p: 6.5, h: 'sag',  r: '#5f1818', k: 800, hMax: 17 },

  // ── ALT SOL: plaka + ekspertiz (7.4 → 104.0mm · 128.5 → 264.7mm) ───
  // Sıra: plaka → başlık → ŞEMA → efsane (şemanın ALTINDA, yatay) → sayım
  // ⚠️ x=11.7: sol beyaz alanın gerçek merkezi (7.4+104.0)/2 = 55.7mm.
  // Önce x=10 idi, merkez 54.0 çıkıyor ve tüm sol sütun 1.7mm SOLA kaçıyordu.
  // Plaka artik TR ROZETI olarak basiliyor (cerceve + mavi TR alani), bu
  // yuzden duz yazidan ~1.4em daha uzun: hMax 14 -> 18. Uzun plakada
  // sigdirma zaten puntoyu kucultuyor.
  plaka:     { x: 11.7, y: 129, g: 88,  p: 12,  h: 'orta', r: '#3f3f3f', k: 800, hMax: 18 },
  boyaOzet:  { x: 11.7, y: 147, g: 88,  p: 8.5, h: 'orta', r: '#5f1818', k: 800, hMax: 11 },
  // Şema 88 → 84mm: yazılar büyüyünce sol sütunda yer açmak gerekti.
  // Yükseklik en/boy oranından türer (84 × 0.911 ≈ 76.5mm) — şema hâlâ
  // sütunun neredeyse tamamını kaplıyor, kaybedilen 3.6mm plaka ve sayım
  // rozetlerinin okunurluğuna gitti.
  eksp:      { x: 14.7, y: 159, g: 82,  p: 4,   h: 'orta', r: '#3f3f3f', k: 700 },
  efsane:    { x: 11.7, y: 236, g: 88,  p: 4,   h: 'orta', r: '#444444', k: 600, hMax: 6 },
  // hMax 9: rozetler 5.5mm'de tek sıraya sigmayip 2 sira oluyor ve yedek
  // anahtarin uzerine biniyordu; punto kendiliginden tek siraya iniyor.
  sayim:     { x: 11.7, y: 244, g: 88,  p: 5.5, h: 'orta', r: '#ffffff', k: 800, hMax: 9 },
  // ⚠️ Eskiden "qr'ı şimdilik kaldır" denmişti; 1 Ağu 2026'da GERİ AÇILDI:
  //   "satış danışmanları qr'ı okutup ilgili araç kartına gidecek."
  // ⚠️ ESKİ YER (14, 245) KULLANILAMAZDI — ölçüldü: sol sütun 128.7–261.7
  //   arası dolu, en büyük boşluk 5.8mm. 25mm QR sayım rozetleri ve yedek
  //   anahtar satırının üstüne biniyordu. Göksenil "fiyatın soluna hizala"
  //   dedi → üst şeride taşındı.
  // Üst şerit 7.4–33.7mm (26.3mm). 24mm QR + 1mm pay → y=8, alt 32.
  //   "Araç Sayfası" alt yazısı KALDIRILDI: 24+4.2=28.2mm matbaanın 33.7'deki
  //   çizgisini aşıyordu. QR zaten personele yönelik (hedef sayfa giriş ister).
  qr:        { x: 10,  y: 8,   g: 24,  p: 3,   h: 'sol',  r: '#000000', k: 600, gizli: false },

  // ── ALT SAĞ: tramer + krediler + anahtar (104.5 → 202mm) ───────────
  // ⚠️ Matbaanın kısa yatay çizgisi 218.2mm'de: kredi1 ONUN ÜSTÜNDE bitmeli,
  // kredi2 ALTINDA başlamalı. Peşinat+taksit satırları blokları büyüttüğü
  // için aralıklar buna göre kuruldu.
  // Tramer artık SABİT yükseklikte: kayıt dökümü basılmıyor (15-20 kayıtlı
  // araçta taşıyordu), yerine toplam tutar + "N kayıt · en yüksek ₺X".
  // ⚠️ SAĞ SÜTUNDA hMax HER ALANDA ZORUNLU. Alanlar mm cinsinden SABİT y ile
  //    konumlanıyor; içerik uzayınca kutu aşağı büyüyor ve KOMŞUSUNU EZİYOR.
  //    Canlıda görüldü (11 Ağu 2026, 81AFB109): tramer 3 satıra çıkıp güven
  //    satırının üstüne bindi. hMax = (bir sonraki alanın y) − (bu alanın y)
  //    − pay; sığdır döngüsü puntoyu kendiliğinden küçültüyor.
  tramer:      { x: 107, y: 130, g: 93,  p: 11,  h: 'orta', r: '#3f3f3f', k: 800, hMax: 26 },
  // ⚠️ hMax ZORUNLU — 158 ile kredi1'in 166'sı arasında yalnız 8mm var.
  //    hMax YOKKEN uzun metin iki satıra sarıyor (~11mm) ve BİREYSEL KREDİ
  //    bloğunun ÜSTÜNE BİNİYORDU. Canlıda görüldü (11 Ağu 2026, 81AFB109):
  //    ibare "Takasa Açık"tan "Kredi Kartına 12 Ay Taksit"e uzayınca çakıştı.
  //    CSS'te flex-wrap:wrap olduğu için genişlik taşması da ALGILANMIYOR
  //    (metin sarıyor, scrollWidth büyümüyor) → tek koruma yükseklik sınırı.
  //    hMax ile punto kendiliğinden küçülüp tek satıra iniyor.
  guvenSerit:  { x: 110, y: 158, g: 87,  p: 4.5, h: 'orta', r: '#3f6b3f', k: 700, hMax: 7 },
  kredi1:      { x: 107, y: 166, g: 93,  p: 10.5, h: 'orta', r: '#3f3f3f', k: 800, hMax: 32 },
  // Bireysel kredi ile matbaanın 218.2mm'deki kısa çizgisi arasındaki boşluk.
  // Kurum sayısı veri.js'teki BANKALAR listesinden gelir → liste değişirse
  // etiketteki sayı da kendiliğinden düzelir, elle güncelleme gerekmez.
  finansSerit: { x: 110, y: 200, g: 87,  p: 4.8, h: 'orta', r: '#5f1818', k: 800, hMax: 18 },
  kredi2:      { x: 107, y: 220, g: 93,  p: 10.5, h: 'orta', r: '#3f3f3f', k: 800, hMax: 31 },
  // Dipnot KASITLI KÜÇÜK: yasal ince yazı, uzaktan okunması gerekmiyor.
  krediNot:    { x: 107, y: 253, g: 93,  p: 2.5, h: 'orta', r: '#6a6a6a', k: 500 },
  // ⚠️ Yedek anahtar SOL sütuna alındı: kredi blokları taksit+peşinat ile
  // büyüyünce sağ sütunda 218.2–264.7 arası (46.5mm) içerikle tam doldu
  // (kredi2 27.3 + dipnot 10.1 + anahtar 6.2 = 43.6, boşluk payı kalmıyordu).
  // Solda sayım rozetlerinin altı boştu.
  anahtar:     { x: 11.7, y: 255, g: 88,  p: 6,   h: 'orta', r: '#3f3f3f', k: 700, hMax: 9 },
}
const ALAN_ADI = {
  fiyat: 'Fiyat (üst şerit)',
  yil: 'Yıl', yakit: 'Yakıt', vites: 'Vites',
  marka: 'Marka', model: 'Model + versiyon', km: 'Kilometre',
  kdv: 'KDV durumu (kapalı)', muayene: 'Muayene tarihi', garanti: 'Garanti',
  plaka: 'Plaka', boyaOzet: 'Ekspertiz başlığı', eksp: 'Ekspertiz şeması',
  efsane: 'Renk açıklaması (şema altı)', sayim: 'Boya/değişen sayıları',
  qr: 'QR kod (araç kartı)',
  tramer: 'Tramer özeti', guvenSerit: 'Güven satırı (✓ maddeler)',
  kredi1: 'Bireysel kredi', finansSerit: 'Finans kurumu şeridi',
  kredi2: 'Ticari kredi', krediNot: 'Kredi dipnotu',
  anahtar: 'Yedek anahtar (VAR/YOK)',
}

// QR gizliyse 59 KB'lık üreteci hiç indirmeyelim.
export const alanGizliMi = ad => !!(YERLESIM && YERLESIM[ad] && YERLESIM[ad].gizli)
// QR'ın açacağı adres. Göksenil: "şimdilik sadece araç sayfasını açsın ama
// http://localhost:8000/ — canlıya aldığımda düzenleriz." Bu yüzden şablon
// AYARDA tutuluyor: canlıya geçişte kod değişmeyecek, tek kutu güncellenecek.
// Cam etiketindeki QR — satış danışmanı okutup ARAÇ KARTINA gider.
// Göksenil (1 Ağu 2026): "her araç kartı için farklı qr olacak, süresiz olacak,
// bu çok önemli."
// ⚠️ ESKİ DEĞER 'http://localhost:8000/arac.html?id={id}' İDİ — hem localhost
//   (telefonda açılmaz) hem de `arac.html` diye bir sayfa YOK (doğrusu
//   arac-kart.html). Yerleşimde alan `gizli:true` olduğu için hata hiç
//   görünmemişti; QR basılmıyordu.
// ⚠️ SÜRESİZLİK UYARISI (Göksenil bilerek seçti): adres GitHub Pages'e bağlı.
//   CRM ileride kendi alan adına taşınırsa O GÜNE KADAR BASILMIŞ tüm
//   etiketlerin QR'ı ölür ve yeniden basılması gerekir. Kalıcı çözüm, kendi
//   alan adı üzerinden bir yönlendirme adresiydi.
export const VARSAYILAN_QR_URL = 'https://ismailcalmaz.github.io/crm/arac-kart.html?id={id}'

// =====================================================================
// SABİT YAZILAR — Göksenil (11 Ağu 2026): "cam etiketindeki sabit yazılar
//   da düzenlenebilir olsun, kaydettiğimde üzerine kaydetsin."
//
// Bunlar araçtan gelmeyen, her etikette AYNI basılan metinlerdi ve kodda
// gömülüydü; değiştirmek için deploy gerekiyordu. Artık yerleşimle aynı
// ayar satırında (cam_etiketi_yerlesim.yazilar) tutuluyor — tek kayıt,
// tek "Kaydet".
//
// ⚠️ garantiKmSiniri METİN DEĞİL SAYI: garanti cümlesi kilometreden
//    TÜRETİLİR (elle işaretlenmez), sınır da yönetilebilir olmalı.
// =====================================================================
export const VARSAYILAN_YAZILAR = {
  garantiDusuk:     '3 AY / 5.000 KM MOTOR & MEKANİK GARANTİ',
  garantiYuksek:    '1 AY / 1.000 KM MOTOR & MEKANİK GARANTİ',
  garantiKmSiniri:  160000,
  boyasiz:          'BOYASIZ',
  ekspertizli:      'Ekspertiz',
  muayeneOn:        'MUAYENE',
  kmSon:            'KM',
  kdvSon:           'KDV',
  // Güven satırı (yeşil ✓ ibareler). İkincisi Göksenil isteğiyle
  // "Takasa Açık" → "Kredi Kartına 12 Ay Taksit" oldu (11 Ağu 2026).
  guvenEkspertiz:   'Ekspertiz Raporu Hazır',
  guvenIkinci:      'Kredi Kartına 12 Ay Taksit',
}
// Düzenleyicide gösterilecek etiketler (sıra da buradan)
const YAZI_ETIKET = {
  garantiDusuk:    'Garanti — km sınırının ALTINDA',
  garantiYuksek:   'Garanti — km sınırının ÜSTÜNDE',
  garantiKmSiniri: 'Garanti km sınırı (sayı)',
  boyasiz:         'Ekspertiz başlığı — hasarsız',
  ekspertizli:     'Ekspertiz başlığı — hasarlı',
  muayeneOn:       'Muayene öneki',
  kmSon:           'Kilometre soneki',
  kdvSon:          'KDV soneki',
  guvenEkspertiz:  'Güven satırı — 1. ibare (ekspertiz varsa)',
  guvenIkinci:     'Güven satırı — 2. ibare',
}

let YERLESIM = null, QR_URL = VARSAYILAN_QR_URL, SECILI = 'fiyat'
let YAZILAR = { ...VARSAYILAN_YAZILAR }

// cam-etiketi.js bu yardımcıyla okur — kodda sabit metin KALMASIN.
export function yazi(anahtar) {
  const v = YAZILAR?.[anahtar]
  return (v === undefined || v === null || v === '') ? VARSAYILAN_YAZILAR[anahtar] : v
}

// --- Yükle / uygula ---------------------------------------------------
export async function yerlesimYukle() {
  const { data, error } = await supabase.from('ayarlar')
    .select('deger').eq('anahtar', 'cam_etiketi_yerlesim').maybeSingle()
  if (error) console.error('[cam etiketi] yerleşim okunamadı', error)
  YERLESIM = { ...VARSAYILAN_YERLESIM }
  QR_URL = VARSAYILAN_QR_URL
  YAZILAR = { ...VARSAYILAN_YAZILAR }
  try {
    if (data?.deger) {
      const kayit = JSON.parse(data.deger)
      // Eski biçim (düz alan sözlüğü) ile geriye dönük uyum: 'alanlar' yoksa
      // kaydın kendisi alan sözlüğüdür.
      const alanlar = kayit && kayit.alanlar ? kayit.alanlar : kayit
      if (kayit && typeof kayit.qrUrl === 'string' && kayit.qrUrl) QR_URL = kayit.qrUrl
      // Sabit yazılar — kayıtta yoksa varsayılan kalır (eski kayıtlarda yok).
      for (const [k, v] of Object.entries(kayit?.yazilar || {})) {
        if (!(k in VARSAYILAN_YAZILAR)) continue        // artık olmayan anahtarı yok say
        if (v !== undefined && v !== null && v !== '') YAZILAR[k] = v
      }
      for (const [k, v] of Object.entries(alanlar || {})) {
        if (!VARSAYILAN_YERLESIM[k]) continue          // artık olmayan alanı yok say
        YERLESIM[k] = { ...VARSAYILAN_YERLESIM[k], ...v }
      }
    }
  } catch (e) {
    console.error('[cam etiketi] yerleşim JSON bozuk, varsayılana dönüldü', e)
    YERLESIM = { ...VARSAYILAN_YERLESIM }
    YAZILAR = { ...VARSAYILAN_YAZILAR }
  }
  return YERLESIM
}

export function qrAdresi(arac) {
  const plaka = String(arac?.plaka || '')
  return QR_URL
    .replaceAll('{id}', encodeURIComponent(arac?.id || ''))
    .replaceAll('{plaka}', encodeURIComponent(plaka))
    .replaceAll('{plakaduz}', encodeURIComponent(plaka.replace(/\s+/g, '')))
}

const HIZA = { sol: 'left', orta: 'center', sag: 'right' }

export function yerlesimUygula() {
  if (!YERLESIM) return
  document.querySelectorAll('.sayfa').forEach(sayfa => {
    const mmPx = sayfa.getBoundingClientRect().width / 210
    for (const [k, v] of Object.entries(YERLESIM)) {
      const el = sayfa.querySelector(`[data-alan="${k}"]`)
      if (!el) continue
      el.style.left = v.x + 'mm'
      el.style.top = v.y + 'mm'
      el.style.width = v.g + 'mm'
      el.style.fontSize = v.p + 'mm'
      el.style.textAlign = HIZA[v.h] || 'center'
      el.style.color = v.r || '#3f3f3f'
      el.style.fontWeight = v.k || 700
      // Gizli alan YAZDIRILMAZ; düzenleme modunda soluk görünür ki geri
      // açılabilsin (yoksa kaybolur, kullanıcı bulamaz).
      el.classList.toggle('alan-gizli', !!v.gizli)
    }
    if (mmPx > 0) sigdir(sayfa, mmPx)
  })
}

// --- Otomatik sığdırma -------------------------------------------------
// Puntolar "3 metreden okunsun" diye büyütüldü, ama metin uzunluğu araçtan
// araca değişiyor: "Qashqai 1.3 DIG-T" 2 satır, "C 200 d BlueTEC AMG Line
// 4MATIC 9G-Tronic Premium Plus Night Paket" 4 satır oluyor ve alttaki alanın
// üstüne biniyor. Sabit punto ile bu çözülemez — bu yüzden hMax verilen alan
// o yüksekliği aşarsa punto KENDİLİĞİNDEN küçülür.
// Böylece kısa metinli araçta yazı büyük, uzun metinlide taşma yok.
// Taban: hMax'sız alanlar hiç dokunulmadan kalır (ör. ekspertiz şeması).
// ⚠️ GENİŞLİK de kontrol edilir, sadece yükseklik DEĞİL.
// İlk sürüm yalnız yüksekliğe bakıyordu ve "2021" (32mm punto) kutusundan
// TAŞIP yandaki marka/model yazısına değiyordu: tek kelime satır kırılamaz →
// yükseklik artmaz → yükseklik kontrolü bunu göremez. Kutu çakışma ölçümü de
// göremez, çünkü kutular ayrı; taşan şey METİN.
const SIGDIR_ADIM = 0.25   // mm
function sigdir(sayfa, mmPx) {
  for (const [k, v] of Object.entries(YERLESIM)) {
    if (v.gizli) continue
    const el = sayfa.querySelector(`[data-alan="${k}"]`)
    if (!el) continue
    // Şema gibi punto ile ölçeklenmeyen alanlar dışarıda
    if (k === 'eksp' || k === 'qr') continue
    // ⚠️ İÇ elemanlar da kontrol edilir. Plaka TR rozeti gibi kendi kutusu
    // (overflow:hidden) olan bir yapıda taşma DIŞ elemanda görünmez —
    // içerideki kutu sessizce KIRPAR. Canlıda tam bu oldu: plaka numarasının
    // sağı kesiliyordu ama dış ölçüm "sığıyor" diyordu.
    const genislikTasiyor = e => {
      if (e.scrollWidth > e.clientWidth + 1) return true
      for (const c of e.children) if (genislikTasiyor(c)) return true
      return false
    }
    const tasiyor = () =>
      (v.hMax && el.offsetHeight / mmPx > v.hMax) ||   // satır sayısı taştı
      genislikTasiyor(el)                              // metin kutuya sığmadı
    const taban = Math.max(v.p * 0.45, 2)   // %55'ten fazla küçülme yok
    let p = v.p, guvenlik = 60
    while (tasiyor() && p - SIGDIR_ADIM >= taban && guvenlik-- > 0) {
      p = Math.round((p - SIGDIR_ADIM) * 100) / 100
      el.style.fontSize = p + 'mm'
    }
  }
}

// --- Editör -----------------------------------------------------------
export function duzenleyiciKur() {
  document.body.classList.add('duzenle-modu')
  panelCiz()
  // Sürükleme yalnız ilk sayfada; diğerleri aynı yerleşimi kullanır
  const ilk = document.querySelector('.sayfa')
  ilk?.querySelectorAll('[data-alan]').forEach(surukleBagla)
  sec(SECILI)
}

function surukleBagla(el) {
  el.addEventListener('mousedown', e => {
    const k = el.dataset.alan
    if (!YERLESIM[k]) return
    e.preventDefault()
    sec(k)
    const sayfa = el.closest('.sayfa')
    const mmPx = sayfa.getBoundingClientRect().width / 210   // 1 mm kaç piksel
    const bas = { mx: e.clientX, my: e.clientY, x: YERLESIM[k].x, y: YERLESIM[k].y }
    const hareket = ev => {
      YERLESIM[k].x = yuvarla(bas.x + (ev.clientX - bas.mx) / mmPx)
      YERLESIM[k].y = yuvarla(bas.y + (ev.clientY - bas.my) / mmPx)
      yerlesimUygula(); panelGuncelle()
    }
    const birak = () => {
      document.removeEventListener('mousemove', hareket)
      document.removeEventListener('mouseup', birak)
    }
    document.addEventListener('mousemove', hareket)
    document.addEventListener('mouseup', birak)
  })
}
const yuvarla = n => Math.round(n * 10) / 10

function sec(k) {
  SECILI = k
  document.querySelectorAll('[data-alan]').forEach(el =>
    el.classList.toggle('secili', el.dataset.alan === k))
  panelGuncelle()
}

function panelCiz() {
  const p = document.createElement('div')
  p.id = 'duzPanel'
  p.innerHTML = `
    <div class="dp-baslik">⚙️ Yerleşim Editörü</div>
    <select id="dpAlan">${Object.entries(ALAN_ADI).map(([k, a]) => `<option value="${k}">${a}</option>`).join('')}</select>
    <label class="dp-onay"><input type="checkbox" id="dpGizli" /> Bu alanı basma (gizle)</label>
    <div class="dp-satir"><label>X (mm)</label><input type="number" step="0.5" id="dpX" /></div>
    <div class="dp-satir"><label>Y (mm)</label><input type="number" step="0.5" id="dpY" /></div>
    <div class="dp-satir"><label>Genişlik</label><input type="number" step="1" id="dpG" /></div>
    <div class="dp-satir"><label>Punto (mm)</label><input type="number" step="0.5" id="dpP" /></div>
    <div class="dp-satir"><label>En çok (mm)</label><input type="number" step="1" id="dpHM" placeholder="sınır yok" /></div>
    <div class="dp-satir"><label>Hiza</label><select id="dpH"><option value="sol">Sol</option><option value="orta">Orta</option><option value="sag">Sağ</option></select></div>
    <div class="dp-satir"><label>Kalınlık</label><select id="dpK"><option value="400">İnce</option><option value="600">Orta</option><option value="700">Kalın</option><option value="800">Daha kalın</option><option value="900">En kalın</option></select></div>
    <div class="dp-satir"><label>Renk</label><input type="color" id="dpR" /></div>
    <div class="dp-ok">
      <button data-yon="yukari" title="0.5 mm yukarı">↑</button>
      <button data-yon="sol" title="0.5 mm sola">←</button>
      <button data-yon="asagi" title="0.5 mm aşağı">↓</button>
      <button data-yon="sag" title="0.5 mm sağa">→</button>
    </div>
    <div class="dp-satir dp-qr"><label>QR adresi</label></div>
    <input type="text" id="dpQr" placeholder="http://localhost:8000/..." />
    <p class="dp-ip">"En çok" = alanın azami yüksekliği; metin uzun gelirse punto oraya sığacak kadar küçülür.</p>
    <p class="dp-ip">QR adresinde <b>{id}</b>, <b>{plaka}</b>, <b>{plakaduz}</b> kullanılabilir. Canlıya geçince yalnız burayı değiştir.</p>
    ${/* Sabit yazılar — araçtan gelmeyen, her etikette aynı basılan metinler.
          Göksenil (11 Ağu 2026): "sabit yazılarda düzenlenebilir olsun,
          kaydettiğimde üzerine kaydetsin." Aynı Kaydet düğmesiyle yazılır. */''}
    <div class="dp-satir dp-qr"><label>Sabit yazılar</label></div>
    ${Object.keys(VARSAYILAN_YAZILAR).map(k => `
      <div class="dp-satir" style="flex-direction:column;align-items:stretch;gap:2px">
        <label style="font-size:10px;opacity:.8">${YAZI_ETIKET[k] || k}</label>
        <input type="${k === 'garantiKmSiniri' ? 'number' : 'text'}" id="dpYazi_${k}" />
      </div>`).join('')}
    <p class="dp-ip">Boş bırakılan yazı varsayılana döner. Garanti cümlesi kilometreye göre seçilir — sınırı da buradan değiştirebilirsin.</p>
    <div class="dp-alt">
      <button id="dpKaydet" class="dp-kaydet">Kaydet</button>
      <button id="dpSifirla">Varsayılana dön</button>
    </div>
    <p class="dp-ip">Alanı fareyle sürükle · oklar 0.5 mm kaydırır.<br>Kaydet'e basmadan değişiklik kalıcı olmaz.</p>
    <p class="dp-durum" id="dpDurum"></p>`
  document.body.appendChild(p)

  // Sabit yazı kutularını kayıtlı değerlerle doldur
  for (const k of Object.keys(VARSAYILAN_YAZILAR)) {
    const el = document.getElementById('dpYazi_' + k)
    if (el) el.value = yazi(k)
  }

  document.getElementById('dpAlan').addEventListener('change', e => sec(e.target.value))
  for (const id of ['dpX', 'dpY', 'dpG', 'dpP', 'dpHM', 'dpH', 'dpK', 'dpR']) {
    document.getElementById(id).addEventListener('input', panelUygula)
  }
  document.getElementById('dpGizli').addEventListener('change', e => {
    if (!YERLESIM[SECILI]) return
    YERLESIM[SECILI].gizli = e.target.checked
    yerlesimUygula()
  })
  document.getElementById('dpQr').addEventListener('input', e => { QR_URL = e.target.value })
  p.querySelectorAll('[data-yon]').forEach(b => b.addEventListener('click', () => {
    const v = YERLESIM[SECILI]; if (!v) return
    if (b.dataset.yon === 'sol') v.x = yuvarla(v.x - 0.5)
    if (b.dataset.yon === 'sag') v.x = yuvarla(v.x + 0.5)
    if (b.dataset.yon === 'yukari') v.y = yuvarla(v.y - 0.5)
    if (b.dataset.yon === 'asagi') v.y = yuvarla(v.y + 0.5)
    yerlesimUygula(); panelGuncelle()
  }))
  document.getElementById('dpKaydet').addEventListener('click', kaydet)
  document.getElementById('dpSifirla').addEventListener('click', () => {
    if (!confirm('Yerleşim varsayılana dönsün mü? Kaydet demeden kalıcı olmaz.')) return
    YERLESIM = JSON.parse(JSON.stringify(VARSAYILAN_YERLESIM))
    QR_URL = VARSAYILAN_QR_URL
    yerlesimUygula(); panelGuncelle()
  })
  document.getElementById('dpQr').value = QR_URL
}

function panelGuncelle() {
  const v = YERLESIM?.[SECILI]; if (!v) return
  document.getElementById('dpAlan').value = SECILI
  document.getElementById('dpX').value = v.x
  document.getElementById('dpY').value = v.y
  document.getElementById('dpG').value = v.g
  document.getElementById('dpP').value = v.p
  document.getElementById('dpH').value = v.h || 'orta'
  document.getElementById('dpK').value = String(v.k || 700)
  document.getElementById('dpR').value = v.r || '#3f3f3f'
  document.getElementById('dpHM').value = v.hMax ?? ''
  document.getElementById('dpGizli').checked = !!v.gizli
}

function panelUygula() {
  const v = YERLESIM?.[SECILI]; if (!v) return
  v.x = Number(document.getElementById('dpX').value)
  v.y = Number(document.getElementById('dpY').value)
  v.g = Number(document.getElementById('dpG').value)
  v.p = Number(document.getElementById('dpP').value)
  v.h = document.getElementById('dpH').value
  v.k = Number(document.getElementById('dpK').value)
  v.r = document.getElementById('dpR').value
  // "En çok": alan bu yüksekliği aşarsa punto kendiliğinden küçülür.
  // Boş bırakılırsa sınır yok (ör. ekspertiz şeması).
  const hm = document.getElementById('dpHM').value
  if (hm === '' || Number(hm) <= 0) delete v.hMax; else v.hMax = Number(hm)
  yerlesimUygula()
}

async function kaydet() {
  const d = document.getElementById('dpDurum')
  d.textContent = 'Kaydediliyor…'; d.style.color = '#bbb'
  // Yazı kutularındaki güncel değerleri al (kaydetmeden önce topla)
  for (const k of Object.keys(VARSAYILAN_YAZILAR)) {
    const el = document.getElementById('dpYazi_' + k)
    if (!el) continue
    const ham = el.value.trim()
    YAZILAR[k] = (k === 'garantiKmSiniri')
      ? (Number(ham.replace(/\D/g, '')) || VARSAYILAN_YAZILAR[k])
      : (ham || VARSAYILAN_YAZILAR[k])
  }
  const { data, error } = await supabase.from('ayarlar').upsert({
    anahtar: 'cam_etiketi_yerlesim',
    deger: JSON.stringify({ alanlar: YERLESIM, qrUrl: QR_URL, yazilar: YAZILAR }),
    aciklama: 'Cam etiketi alan konumları (mm) + QR adresi + sabit yazılar — editörden yönetilir',
  }, { onConflict: 'anahtar' }).select('anahtar')
  if (error) {
    dbHata('cam etiketi yerleşim kaydet', error)
    d.textContent = 'Kaydedilemedi: ' + error.message; d.style.color = '#ff8a8a'; return
  }
  // §5.1 — PostgREST 0 satır güncelleyip hata VERMEZ; yetki yoksa sessizce boş döner
  if (!data?.length) { d.textContent = 'Kaydedilemedi — yetki yok.'; d.style.color = '#ff8a8a'; return }
  d.textContent = '✓ Kaydedildi — herkeste geçerli'; d.style.color = '#7ee787'
}
