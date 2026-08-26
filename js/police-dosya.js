// =====================================================================
// police-dosya.js — Sigorta şirketi Excel/XML dosyalarını poliçe satırına
//   çeviren TEK KAYNAK. DOM'a dokunmaz, sadece dosya → satır dizisi.
//   Çıktı doğrudan `police_ice_aktar` RPC'sine (sql/220) gider.
//
//   Desteklenen 5 biçim (18 Ağu 2026'da örnek dosyalarla ÖLÇÜLDÜ):
//     HEPIYI_XLSX  .xlsx  75 sütun · başlık 1. satır · alanlar "P " önekli
//     SOMPO_XLSB   .xlsb  41 sütun · başlık 3. satır · SONDA TOPLAM BLOĞU
//     NEOVA_XML    <POLICELER>       · BILGILER/POLICE_BILGI anahtar-değer
//     QUICK_XML    <PoliceTransferDto> · UrunSorular/Soru anahtar-değer
//     PUSULA_XML   <Acente>          · TarifeSorusu anahtar-değer
//
//   İki Excel AYNI rapordur: ilk 30 sütun aynı sırada, yalnız etiket farklı
//   ("P Brüt Prim" ↔ "Brüt Prim"). Tek çekirdek + eşanlamlı sözlüğü yeter.
// =====================================================================

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs'
let _xlsx = null
async function xlsxYukle() {
  if (!_xlsx) _xlsx = await import(/* @vite-ignore */ XLSX_URL)
  return _xlsx
}

export const BICIM_AD = {
  HEPIYI_XLSX: 'HepiYi / Sigortan Seninle (Excel)',
  SOMPO_XLSB:  'Sompo (Excel .xlsb)',
  NEOVA_XML:   'Neova (XML)',
  QUICK_XML:   'Quick (XML)',
  PUSULA_XML:  'Pusula acente çıktısı (XML)',
}

// =====================================================================
// SAYI
// =====================================================================
// Üç ayrı kural ölçüldü:
//   hepiyi  → Türk biçimi metin  '-1.878,78'
//   sompo   → gerçek number       16901.21
//   XML'ler → nokta ondalık metin '-3718.3800'
// Ayrım: son virgül mü son nokta mı ondalık ayracı.
export function sayi(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim().replace(/\s/g, '')
  if (!s) return null
  const sonV = s.lastIndexOf(','), sonN = s.lastIndexOf('.')
  if (sonV > sonN) s = s.replace(/\./g, '').replace(',', '.')   // 1.878,78
  else if (sonV > -1 && sonN > -1) s = s.replace(/,/g, '')      // 1,878.78
  else s = s.replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

// =====================================================================
// TARİH  →  'YYYY-MM-DD'
// =====================================================================
// ⚠️ toISOString() KULLANILMAZ. Excel'den `cellDates:true` ile gelen Date
//    yerel gece yarısıdır; UTC+3'te toISOString() bir ÖNCEKİ günü verir.
//    5/5 satırda ölçüldü (8/10/26 → 2026-08-09, doğrusu 2026-08-10).
//    Yapboz günlük ücreti ve yenileme tarihi bu tarihlerden hesaplandığı
//    için sessiz bir para hatası olurdu.
const iki = n => String(n).padStart(2, '0')
const yerelISO = d => `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`

export function tarih(v) {
  if (v === null || v === undefined || v === '') return null

  // 1) SheetJS cellDates:true → Date nesnesi
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : yerelISO(v)

  // 2) Excel seri numarası (cellDates kapalıysa). Sıfır noktası 1899-12-30.
  //    UTC üzerinden kurup UTC bileşenleriyle okuyoruz ki yerel saat dilimi
  //    araya girip günü kaydırmasın.
  if (typeof v === 'number') {
    if (v < 1 || v > 80000) return null
    const ms = Math.round(v * 86400000)
    const d = new Date(Date.UTC(1899, 11, 30) + ms)
    return `${d.getUTCFullYear()}-${iki(d.getUTCMonth() + 1)}-${iki(d.getUTCDate())}`
  }

  const s = String(v).trim()
  // 3) ISO: '2026-08-03T00:00:00' veya '2026-08-03' → ilk 10 karakter.
  //    new Date(...) + toISOString YAPILMAZ (yine kayma riski).
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // 4) dd/MM/yyyy veya dd.MM.yyyy  (hepiyi ve Pusula böyle; ölçüldü:
  //    hepiyi '10/08/2026' = 10 Ağustos, Pusula '05/08/2026' = 5 Ağustos)
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (m) return `${m[3]}-${iki(m[2])}-${iki(m[1])}`
  return null
}

// =====================================================================
// KİMLİK / PLAKA
// =====================================================================
// ⚠️ sompo dosyasında TC MASKELİ geliyor: '2*********0'. Maskeli değeri
//    kimlik sanıp yazarsak hem çöp veri olur hem yanlış müşteri eşleşir.
export function tcTemiz(v) {
  const s = String(v ?? '')
  if (s.includes('*')) return null
  const d = s.replace(/\D/g, '')
  return d.length === 11 ? d : null
}
export function vknTemiz(v) {
  const s = String(v ?? '')
  if (s.includes('*')) return null
  const d = s.replace(/\D/g, '')
  return d.length === 10 ? d : null
}
// hepiyi plakası boşluklu geliyor: '35 AK2575'
export const plakaTemiz = v => String(v ?? '').toLocaleUpperCase('tr')
  .replace(/İ/g, 'I').replace(/[^A-Z0-9]/g, '') || null

// =====================================================================
// BRANŞ = VERGİ PARMAK İZİ  (ürün kodu DEĞİL)
// =====================================================================
// Ürün kodu her şirkette farklı: hepiyi 301=trafik/351=kasko,
// sompo 311=trafik/307=kasko. Koda göre eşleme YANLIŞ olur.
// Vergi yapısı ise evrensel ve bizim sigorta_vergi_hesapla ile birebir:
//   TRAFİK : GDV=net×5%  THGF=(brüt−net−GDV)×5/7  GÜVENCE=(...)×2/7
//   KASKO  : GDV=net×5%  THGF=0  GÜVENCE=0
//   YANGIN : YSV dolu
// Ölçüm: hepiyi trafik net 31.077,72 → 1.553,89 / 1.398,50 / 559,40 (tam).
export function vergiProfili({ gdv, thgf, guvence, ysv }) {
  const d = x => Math.abs(sayi(x) || 0) > 0.005
  if (d(ysv)) return 'YANGIN'
  if (d(thgf) || d(guvence)) return 'TRAFIK'
  if (d(gdv)) return 'KASKO'
  return 'MUAF'
}

// Ad → bizdeki tür kodu. Ad yoksa vergi profiline düşer.
const TUR_DESEN = [
  [/TRAF[İI]K|ZORUNLU\s*MAL[İI]/i,               'TRAFIK'],
  [/KASKO/i,                                     'KASKO'],
  [/DASK|ZORUNLU\s*DEPREM/i,                     'DASK'],
  [/KONUT|YANGIN/i,                              'KONUT'],
  [/[İI]SYER[İI]|[İI]ŞYER/i,                    'ISYERI'],
  [/FERD[İI]\s*KAZA/i,                           'FERDI_KAZA'],
  [/TAMAMLAYICI\s*SA[ĞG]LIK|\bTSS\b/i,           'TSS'],
]
// `adlar` tek metin ya da öncelik sıralı dizi olabilir (ör. [branş, ürün]).
export function turCikar(adlar, profil) {
  const liste = (Array.isArray(adlar) ? adlar : [adlar])
    .map(x => String(x ?? '').trim()).filter(Boolean)
  for (const a of liste) for (const [re, kod] of TUR_DESEN)
    if (re.test(a)) return { tur_kod: kod, tur_ad: liste[0] }

  // ⚠️ Ad tanınmadı → KARARI VERGİ PARMAK İZİ VERİR.
  //    Türkiye Sigorta kaskoyu "Birleşik Paket (1.0)" diye adlandırıyor;
  //    buna ayrı bir tür açmak kasko raporunu şirket şirket parçalardı.
  //    Yeni tür yalnız parmak izi de belirsizken (MUAF) açılır.
  if (profil === 'TRAFIK') return { tur_kod: 'TRAFIK', tur_ad: liste[0] || null }
  if (profil === 'KASKO')  return { tur_kod: 'KASKO',  tur_ad: liste[0] || null }
  return { tur_kod: null, tur_ad: liste[0] || null }   // → sql/220 türü açar
}

// ⚠️ EV KURALINA UYUM: sigorta_vergi_hesapla (sql/36) TRAFİK DIŞINDA
//    (brüt − net)'in TAMAMINI gider_vergisi'ne yazıyor. Neova'nın konut
//    poliçesinde dosya GV 94,99 + YSV 25,75 diye ayırıyor; ayrı bırakırsak
//    brüt = net + vergiler dengesi 25,75 TL açık veriyor (ölçüldü).
//    YSV için kolonumuz yok; ev kuralına uyup birleştiriyoruz.
const yuvarla2 = n => Math.round((n + Number.EPSILON) * 100) / 100
export function vergiNormal(brut, net, gdv, thgf, guvence, profil) {
  if (profil === 'TRAFIK') {
    return { gider_vergisi: gdv ?? 0, thgf: thgf ?? 0, guvence_hesabi: guvence ?? 0 }
  }
  return { gider_vergisi: yuvarla2((brut ?? 0) - (net ?? 0)), thgf: 0, guvence_hesabi: 0 }
}

// =====================================================================
// EXCEL ÇEKİRDEĞİ — iki dosya tek koddan okunur
// =====================================================================
// Başlık adları normalleştirilip eşanlamlı sözlüğünden çözülür. Sıraya
// GÜVENİLMEZ: sütun eklenirse sıra kayar, ad kalır.
const bnorm = s => String(s ?? '').toLocaleUpperCase('tr')
  .replace(/[İI]/g, 'I').replace(/[ŞS]/g, 'S').replace(/[ĞG]/g, 'G')
  .replace(/[ÜU]/g, 'U').replace(/[ÖO]/g, 'O').replace(/[ÇC]/g, 'C')
  .replace(/[^A-Z0-9]/g, '')

const EXCEL_ALAN = {
  police_no:  ['POLICENO'],
  zeyl_no:    ['ZEYILNO', 'ZEYLNO'],
  baslangic:  ['PBASTARIH', 'BASLANGICTARIHI'],
  bitis:      ['PBITTARIHI', 'BITISTARIHI'],
  brut:       ['PBRUTPRIM', 'BRUTPRIM'],
  net:        ['PNETPRIM', 'NETPRIM'],
  gdv:        ['PGDV', 'GDV'],
  guvence:    ['PGF', 'GF'],
  thgf:       ['PTHGF', 'THGF'],
  ysv:        ['PYSV', 'YSV'],
  musteri_ad: ['UMUSTERIADI', 'MUSTERIUNVANI'],
  plaka:      ['PPLAKA', 'PLAKA'],
  komisyon:   ['PKOMISYON', 'KOMISYON'],
  tc:         ['UMUSTCKIMLIKNO', 'MUSTCKIMLIKNO'],
  vkn:        ['UMUSVERGINUMARASI', 'MUSVERGINUMARASI'],
  dogum:      ['UMUSDOGUMTARIHI', 'MUSDOGUMTARIHI'],
  eposta:     ['UMUSEPOSTAADRESI', 'MUSEPOSTAADRESI'],
  adres:      ['UMUSADRESI', 'MUSADRESI'],
  marka:      ['MARKA', 'ARACMARKASI'],
  versiyon:   ['TIPI'],
  motor_no:   ['MOTORNO'],
  sasi_no:    ['SASINO'],
  model_yili: ['MODELYILI'],
  urun_ad:    ['URUNADI'],
  urun_no:    ['URUNNO'],
}

function basliktanIndeks(basliklar) {
  const ix = {}
  const harita = new Map()
  basliklar.forEach((b, i) => { const k = bnorm(b); if (k && !harita.has(k)) harita.set(k, i) })
  for (const [alan, adlar] of Object.entries(EXCEL_ALAN)) {
    for (const ad of adlar) if (harita.has(ad)) { ix[alan] = harita.get(ad); break }
  }
  return ix
}

// Başlık satırını bul: "POLICENO" içeren ilk satır.
// (hepiyi'de 1. satır, sompo'da 3. satır — üstte ünvan + tarih aralığı var.)
function baslikSatiri(satirlar) {
  for (let i = 0; i < Math.min(satirlar.length, 20); i++) {
    if ((satirlar[i] || []).some(h => bnorm(h) === 'POLICENO')) return i
  }
  return -1
}

function excelSatirlari(matris, uyarilar) {
  const bi = baslikSatiri(matris)
  if (bi < 0) throw new Error('Başlık satırı bulunamadı (POLİÇE NO sütunu yok)')
  const ix = basliktanIndeks(matris[bi])
  for (const zorunlu of ['police_no', 'baslangic', 'bitis', 'brut', 'net']) {
    if (ix[zorunlu] === undefined) throw new Error(`Zorunlu sütun yok: ${zorunlu}`)
  }

  const cik = []
  let bos = 0, toplamBlogu = 0
  for (let r = bi + 1; r < matris.length; r++) {
    const s = matris[r] || []
    const no = String(s[ix.police_no] ?? '').trim()

    // ⚠️ sompo dosyasının SONUNDA 36 satırlık TOPLAM BLOĞU var
    //    (Brüt Prim / Net Prim / GDV / GF / THGF / YSV / Komisyon / TDD ×
    //     Tahakkuk-İptal-Net). Bunlar poliçe değil. Ayraç: poliçe no
    //     tamamen rakam DEĞİLSE veri bitmiştir.
    if (!no) { bos++; continue }
    if (!/^\d[\d.,]*$/.test(no)) { toplamBlogu++; continue }

    const al = a => (ix[a] === undefined ? null : s[ix[a]])
    const gdv = sayi(al('gdv')), thgf = sayi(al('thgf'))
    const guv = sayi(al('guvence')), ysv = sayi(al('ysv'))
    const profil = vergiProfili({ gdv, thgf, guvence: guv, ysv })
    const tur = turCikar(al('urun_ad'), profil)
    const plaka = plakaTemiz(al('plaka'))
    const brut = sayi(al('brut')) ?? 0, net = sayi(al('net')) ?? 0
    const v = vergiNormal(brut, net, gdv, thgf, guv, profil)

    cik.push({
      police_no: no.replace(/\.0+$/, ''),           // xlsb sayı olarak veriyor
      _grup: metin(al('urun_no')) || null,
      zeyl_no: Math.round(sayi(al('zeyl_no')) || 0),
      ...tur, vergi_profil: profil,
      baslangic: tarih(al('baslangic')), bitis: tarih(al('bitis')),
      brut, net, ...v,
      komisyon_tutari: sayi(al('komisyon')),
      plaka,
      marka: metin(al('marka')), versiyon: metin(al('versiyon')),
      model_yili: sayi(al('model_yili')),
      sasi_no: metin(al('sasi_no')), motor_no: metin(al('motor_no')),
      musteri_ad: metin(al('musteri_ad')),
      tc_kimlik: tcTemiz(al('tc')), vergi_no: vknTemiz(al('vkn')),
      dogum_tarihi: tarih(al('dogum')),
      eposta: metin(al('eposta')), adres: metin(al('adres')),
    })
  }
  if (bos) uyarilar.push(`${bos} boş satır atlandı`)
  if (toplamBlogu) uyarilar.push(`${toplamBlogu} özet/toplam satırı atlandı (poliçe değil)`)
  return cik
}

const metin = v => {
  const s = String(v ?? '').trim()
  return s && s !== 'null' && s !== 'undefined' ? s : null
}

// =====================================================================
// XML ORTAK — üç dosyanın üçü de ANAHTAR-DEĞER düğümü kullanıyor
// =====================================================================
// ⚠️ Araç/plaka bilgisi etiket ADINDA değil, bu listelerde. Etiket adı
//    taraması yapıp "plaka yok" sonucuna varmak bir kez yanlış rapora yol
//    açtı — anahtar listesi çıkarılmadan karar verilmez.
//    Police(Pusula) TarifeSorusuKodu/TarifeSorusuCevap
//    Quick          SoruAd/SoruCevap
//    Neova          BILGI_ADI/ACIKLAMA
function anahtarDeger(kapsayan, kayitEtiket, adEtiket, degerEtiket) {
  const d = {}
  for (const e of kapsayan.getElementsByTagName(kayitEtiket)) {
    const k = (e.getElementsByTagName(adEtiket)[0]?.textContent || '').trim()
    const v = (e.getElementsByTagName(degerEtiket)[0]?.textContent || '').trim()
    if (k && v && d[k] === undefined) d[k] = v
  }
  return d
}
// ⚠️ KODLAMA TUZAĞI — Neova dosyası `encoding="iso-8859-9"` ilan ediyor.
//    file.text() her şeyi UTF-8 sanar; Türkçe harfler U+FFFD'ye dönüp
//    GİDER → GİDER� olur. Bu yalnız branş eşlemesini değil, MÜŞTERİ
//    ADLARINI ve ADRESLERİ de bozar — ölçüldü (kod 65533).
//    Çözüm: bayt olarak oku, ilan edilen kodlamayla çöz, sonra bildirimi
//    UTF-8'e çevir ki DOMParser ikinci kez yorumlamaya kalkmasın.
export async function xmlMetni(file) {
  const buf = await file.arrayBuffer()
  const bas = new TextDecoder('utf-8').decode(buf.slice(0, 300))
  const m = bas.match(/encoding\s*=\s*["']([\w-]+)["']/i)
  let metinIcerik
  try { metinIcerik = new TextDecoder(m ? m[1] : 'utf-8').decode(buf) }
  catch { metinIcerik = new TextDecoder('utf-8').decode(buf) }
  if (metinIcerik.includes('�')) {
    // iso-8859-9 / windows-1254 birbirinin üst kümesi; hangisi temiz çıkarsa o.
    for (const k of ['windows-1254', 'iso-8859-9']) {
      try {
        const alt = new TextDecoder(k).decode(buf)
        if (!alt.includes('�')) { metinIcerik = alt; break }
      } catch { /* bu kodlama yok, sonrakini dene */ }
    }
  }
  return metinIcerik.replace(/^(\s*<\?xml[^>]*encoding\s*=\s*["'])[\w-]+(["'])/i, '$1utf-8$2')
}

const et = (n, ad) => n.getElementsByTagName(ad)[0]?.textContent?.trim() || null
// Doğrudan çocuk (aynı adlı torunlara kaymamak için)
function cocuk(n, ad) {
  for (const c of n.children) if (c.tagName === ad) return c.textContent.trim()
  return null
}

// ⚠️ İPTAL ZEYLİNDE İŞARET TUZAĞI: Quick'te prim −3.718,38 iken vergiler
//    +363,46 (pozitif) geliyor. Vergileri primin işaretine çekmezsek
//    brüt = net + vergi dengesi tutmaz.
const isaretle = (tutar, referans) => (tutar == null ? null
  : (referans != null && referans < 0 ? -Math.abs(tutar) : Math.abs(tutar)))

// =====================================================================
// NEOVA
// =====================================================================
function neovaOku(kok, uyarilar) {
  const cik = []
  for (const p of kok.getElementsByTagName('POLICE')) {
    const b = anahtarDeger(p, 'POLICE_BILGI', 'BILGI_ADI', 'ACIKLAMA')
    const net = sayi(cocuk(p, 'TOPLAM_NET_PRIM'))
    const gdv = isaretle(sayi(cocuk(p, 'TOPLAM_GV')), net)
    const thgf = isaretle(sayi(cocuk(p, 'TOPLAM_TF')), net)
    const guv = isaretle(sayi(cocuk(p, 'TOPLAM_GF')), net)
    const ysv = isaretle(sayi(cocuk(p, 'TOPLAM_YSV')), net)
    const profil = vergiProfili({ gdv, thgf, guvence: guv, ysv })
    const sig = p.getElementsByTagName('POLICE_SIGORTALI')[0]
    const ad = sig ? [et(sig, 'AD1'), et(sig, 'AD2')].filter(Boolean).join(' ') : null
    const brut = sayi(cocuk(p, 'BRUT_PRIM')) ?? 0
    cik.push({
      police_no: cocuk(p, 'CARI_POL_NO'),
      zeyl_no: Math.round(sayi(cocuk(p, 'ZEYL_SIRA_NO')) || 0),
      // TARIFE_ADI daha ayırt edici ("NEOVA GENİŞLETİLMİŞ KASKO");
      // BRANS_ADI genel ("KAZA OTO") — önce özgül olanı dene.
      ...turCikar([cocuk(p, 'TARIFE_ADI'), cocuk(p, 'BRANS_ADI')], profil),
      vergi_profil: profil,
      baslangic: tarih(cocuk(p, 'BASLAMA_TARIH')), bitis: tarih(cocuk(p, 'BITIS_TARIH')),
      brut, net: net ?? 0,
      ...vergiNormal(brut, net ?? 0, gdv, thgf, guv, profil),
      komisyon_tutari: sayi(cocuk(p, 'TOPLAM_KOMISYON_TL')) ?? sayi(cocuk(p, 'TOPLAM_KOMISYON')),
      plaka: plakaTemiz(b['PLAKA']),
      marka: metin(b['MARKA']), versiyon: metin(b['TİP'] || b['TIP']),
      model_yili: sayi(b['MODEL']),
      sasi_no: metin(b['ŞASİ NO'] || b['SASI NO']), motor_no: metin(b['MOTOR NO']),
      musteri_ad: metin(ad),
      tc_kimlik: tcTemiz(sig && et(sig, 'TC_KIMLIK_NO')),
      vergi_no: vknTemiz(sig && et(sig, 'VERGI_NO')),
      dogum_tarihi: tarih(sig && et(sig, 'DOGUM_TARIH')),
      telefon: metin(b['SİG. CEP TEL'] || b['SIGORTALI TEL']),
      eposta: metin(b['SIGORTALI EMAIL']),
    })
  }
  return cik
}

// =====================================================================
// QUICK
// =====================================================================
const QUICK_KESINTI = { '1': 'gdv', '3': 'guvence', '4': 'thgf' }
function quickOku(kok, uyarilar) {
  const cik = []
  for (const p of kok.getElementsByTagName('Police')) {
    const net = sayi(cocuk(p, 'NetPrimTL')) ?? sayi(cocuk(p, 'NetPrim'))
    const v = { gdv: 0, guvence: 0, thgf: 0 }
    for (const k of p.getElementsByTagName('Kesinti')) {
      const alan = QUICK_KESINTI[et(k, 'KesintiKodu')]
      if (alan) v[alan] += Math.abs(sayi(et(k, 'YerelKesintiTutar')) || 0)
    }
    const gdv = isaretle(v.gdv, net), thgf = isaretle(v.thgf, net), guv = isaretle(v.guvence, net)
    const profil = vergiProfili({ gdv, thgf, guvence: guv, ysv: 0 })
    const s = anahtarDeger(p, 'Soru', 'SoruAd', 'SoruCevap')
    const sig = p.getElementsByTagName('Sigortali')[0]
    const il = (s['PLAKA İL KODU'] || '').replace(/\D/g, '')
    const brut = sayi(cocuk(p, 'BrutPrimTL')) ?? sayi(cocuk(p, 'BrutPrim')) ?? 0
    cik.push({
      police_no: cocuk(p, 'PoliceNo'),
      zeyl_no: Math.round(sayi(cocuk(p, 'ZeyilNo')) || 0),
      ...turCikar(cocuk(p, 'UrunAd'), profil), vergi_profil: profil,
      baslangic: tarih(cocuk(p, 'BaslamaTarihi')), bitis: tarih(cocuk(p, 'BitisTarihi')),
      brut, net: net ?? 0,
      ...vergiNormal(brut, net ?? 0, gdv, thgf, guv, profil),
      komisyon_tutari: sayi(cocuk(p, 'AcenteKomisyonTL')) ?? sayi(cocuk(p, 'AcenteKomisyon')),
      // ⚠️ Plaka İKİ PARÇA: il kodu + gövde
      plaka: plakaTemiz(il + (s['PLAKA NO'] || '')),
      marka: metin(s['MARKA']), versiyon: metin(s['TİP']),
      model_yili: sayi(s['MODEL YILI']),
      sasi_no: metin(s['ŞASİ NO']), motor_no: metin(s['MOTOR NO']),
      musteri_ad: metin(sig && et(sig, 'SigortaliAd')),
      tc_kimlik: tcTemiz(sig && et(sig, 'Tckn')), vergi_no: vknTemiz(sig && et(sig, 'Vkn')),
      dogum_tarihi: tarih(sig && et(sig, 'DogumTarihi')),
      telefon: metin(sig && et(sig, 'Gsm')), eposta: metin(sig && et(sig, 'Email')),
      adres: metin(sig && et(sig, 'Adres')),
    })
  }
  return cik
}

// =====================================================================
// PUSULA (acente XML çıktısı)
// =====================================================================
// ⚠️ VERGİ EŞLEMESİ ÖLÇÜLDÜ — ISVEREN_PAYI BRÜTE DAHİL DEĞİL.
//    net 678,69 + BSMV 33,93 + FON 33,93 + GUVENCE_FONU 13,57 = 760,12 = brüt.
//    ISVEREN_PAYI 6,79 ayrıca ödenir; toplarsak her trafik poliçesi şişer.
const PUSULA_VERGI = { VERGI: 'gdv', FON: 'thgf', GUVENCE_FONU: 'guvence' }
// Bizim `police_durumu` enum'unda KISMI_IPTAL yok — en yakın karşılık AKTIF,
// çünkü poliçe yürürlükte, yalnız bir zeyliyle kısmen iptal edilmiş.
const PUSULA_DURUM = { AKTIF: 'AKTIF', KISMI_IPTAL: 'AKTIF', MEBDEINDEN_IPTAL: 'IPTAL' }

function pusulaOku(kok, uyarilar) {
  const cik = []
  let isaretSatiri = 0
  for (const p of kok.getElementsByTagName('Police')) {
    const zeyl = Math.round(sayi(cocuk(p, 'ZeyilNo')) || 0)
    const brut = sayi(cocuk(p, 'TLBrutPrim')) ?? 0

    // ⚠️ zeyl 100000 = Pusula'nın "güncel hâl" işaret satırı. Ölçüm: bu
    //    numaraya sahip 91 kaydın 91'inde de brüt prim 0,00 — para taşımıyor.
    //    Alınırsa poliçe listesinde hayalet satır olur.
    if (zeyl === 100000 && Math.abs(brut) < 0.005) { isaretSatiri++; continue }

    const net = sayi(cocuk(p, 'TLNetPrim')) ?? 0
    const v = { gdv: 0, thgf: 0, guvence: 0 }
    for (const x of p.getElementsByTagName('Vergi')) {
      const alan = PUSULA_VERGI[et(x, 'VergiTipi')]
      if (alan) v[alan] += sayi(et(x, 'TLVergiTutari')) || 0
    }
    const profil = vergiProfili({ gdv: v.gdv, thgf: v.thgf, guvence: v.guvence, ysv: 0 })
    const s = anahtarDeger(p, 'TarifeSorusu', 'TarifeSorusuKodu', 'TarifeSorusuCevap')
    const sig = p.getElementsByTagName('Sigortali')[0]
    const kimlik = sig && et(sig, 'KimlikNo')
    cik.push({
      police_no: cocuk(p, 'PoliceNo'), zeyl_no: zeyl,
      // BransAdi genel ve temiz ("Zorunlu Trafik" / "Kasko" / "DASK");
      // UrunAdi ürün markası ("Birleşik Paket (1.0)") — önce branşı dene.
      ...turCikar([cocuk(p, 'BransAdi'), cocuk(p, 'UrunAdi')], profil), vergi_profil: profil,
      baslangic: tarih(cocuk(p, 'BaslangicTarihi')), bitis: tarih(cocuk(p, 'BitisTarihi')),
      brut, net,
      ...vergiNormal(brut, net, isaretle(v.gdv, net), isaretle(v.thgf, net),
                     isaretle(v.guvence, net), profil),
      komisyon_tutari: sayi(cocuk(p, 'TLAcenteKomisyonTutari')),
      durum: PUSULA_DURUM[cocuk(p, 'PoliceDurumu')] || null,
      plaka: plakaTemiz((s['PLAKA_IL_KODU'] || '') + (s['PLAKA_NO'] || '')),
      marka: metin(s['ARAC_MARKASI']), versiyon: metin(s['ARAC_TIPI']),
      model_yili: sayi(s['ARAC_MODELI'] || s['EGM_MODEL_YILI']),
      sasi_no: metin(s['SASI_NO']), motor_no: metin(s['MOTOR_NO']),
      musteri_ad: metin(sig && et(sig, 'AdSoyadUnvan')),
      tc_kimlik: tcTemiz(kimlik), vergi_no: vknTemiz(kimlik),
    })
  }
  if (isaretSatiri) uyarilar.push(`${isaretSatiri} "güncel hâl" işaret satırı atlandı (brüt 0, para taşımıyor)`)
  return cik
}

// =====================================================================
// BİÇİM TANIMA + GİRİŞ NOKTASI
// =====================================================================
function xmlBicim(kok) {
  const t = kok.tagName
  if (t === 'POLICELER') return 'NEOVA_XML'
  if (t === 'PoliceTransferDto') return 'QUICK_XML'
  if (t === 'Acente') return 'PUSULA_XML'
  return null
}

export async function dosyaOku(file) {
  const uyarilar = []
  const ad = file.name || ''
  const uzanti = (ad.split('.').pop() || '').toLowerCase()
  let bicim = null, satirlar = []

  if (uzanti === 'xml') {
    const doc = new DOMParser().parseFromString(await xmlMetni(file), 'application/xml')
    const hata = doc.querySelector('parsererror')
    if (hata) throw new Error('XML okunamadı: ' + hata.textContent.slice(0, 120))
    bicim = xmlBicim(doc.documentElement)
    if (!bicim) throw new Error(`Tanınmayan XML kökü: <${doc.documentElement.tagName}>`)
    satirlar = bicim === 'NEOVA_XML' ? neovaOku(doc.documentElement, uyarilar)
             : bicim === 'QUICK_XML' ? quickOku(doc.documentElement, uyarilar)
             : pusulaOku(doc.documentElement, uyarilar)
  } else if (['xlsx', 'xlsb', 'xls', 'xlsm'].includes(uzanti)) {
    const XLSX = await xlsxYukle()
    const buf = await file.arrayBuffer()
    // ⚠️ cellDates:true ŞART — yoksa tarihler seri numarası gelir ve
    //    biçim tahminine kalırız.
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const sh = wb.Sheets[wb.SheetNames[0]]
    const matris = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: null, blankrows: true })
    satirlar = excelSatirlari(matris, uyarilar)
    // Hangi Excel? Başlıkta "P " öneki varsa hepiyi, yoksa sompo.
    const bi = baslikSatiri(matris)
    bicim = (matris[bi] || []).some(h => /^P\s/.test(String(h ?? ''))) ? 'HEPIYI_XLSX' : 'SOMPO_XLSB'
  } else {
    throw new Error(`Desteklenmeyen dosya türü: .${uzanti} (xlsx · xlsb · xml)`)
  }

  // ---- ortak temizlik + tutarlılık uyarıları -------------------------
  const gecerli = []
  let tarihsiz = 0, nosuz = 0
  for (const s of satirlar) {
    if (!s.police_no) { nosuz++; continue }
    if (!s.baslangic || !s.bitis) { tarihsiz++; continue }
    gecerli.push(s)
  }

  // ⚠️ BRÜTÜ SIFIR ZEYL SATIRLARI: prim yok → vergi parmak izi de yok →
  //    branş belirlenemez. sompo'da 2 böyle satır ölçüldü (plaka değişikliği
  //    zeyli). Bunlara "Tanımsız Branş" açmak çöp tür üretirdi — AYNI
  //    poliçe numaralı kardeş satırdan dolduruyoruz.
  //    İki aşamalı devralma, ikisi de YALNIZ BU DOSYADAN öğreniliyor
  //    (sabit ürün kodu tablosu YOK — kod her şirkette farklı):
  //      a) aynı poliçe numaralı kardeş satır
  //      b) aynı ürün grubu. Ürün no yoksa poliçe numarasının ilk 3 hanesi
  //         ürün kodudur (ölçüm: sompo 311…=trafik, 307…=kasko).
  const grupAnahtar = s => s._grup || String(s.police_no || '').slice(0, 3)
  const noHarita = new Map(), grupHarita = new Map()
  for (const s of gecerli) if (s.tur_kod) {
    noHarita.set(s.police_no, s)
    if (!grupHarita.has(grupAnahtar(s))) grupHarita.set(grupAnahtar(s), s)
  }
  let devralan = 0
  for (const s of gecerli) {
    if (s.tur_kod) continue
    const k = noHarita.get(s.police_no) || grupHarita.get(grupAnahtar(s))
    if (k) { s.tur_kod = k.tur_kod; s.tur_ad = s.tur_ad || k.tur_ad; s.vergi_profil = s.vergi_profil === 'MUAF' ? k.vergi_profil : s.vergi_profil; devralan++ }
    else if (!s.tur_ad) s.tur_ad = 'Tanımsız Branş'
  }
  for (const s of gecerli) delete s._grup
  if (devralan) uyarilar.push(`${devralan} sıfır primli satırın branşı aynı dosyadaki kardeş poliçeden alındı`)
  if (nosuz) uyarilar.push(`${nosuz} satırda poliçe no yok, atlandı`)
  if (tarihsiz) uyarilar.push(`${tarihsiz} satırda başlangıç/bitiş tarihi yok, atlandı`)

  const maskeli = gecerli.filter(s => !s.tc_kimlik && !s.vergi_no).length
  if (maskeli) uyarilar.push(`${maskeli} satırda kimlik no yok (maskeli/boş) — müşteri yalnız ada göre eşleşecek`)
  const zeyl = gecerli.filter(s => s.zeyl_no > 0).length
  if (zeyl) uyarilar.push(`${zeyl} zeyl satırı (iptal/değişiklik) ana poliçeye bağlanacak`)
  const plakasiz = gecerli.filter(s => !s.plaka && /TRAFIK|KASKO/.test(s.tur_kod || '')).length
  if (plakasiz) uyarilar.push(`${plakasiz} araç poliçesinde plaka yok`)

  return {
    bicim, bicimAd: BICIM_AD[bicim] || bicim,
    satirlar: gecerli, uyarilar,
    istatistik: {
      okunan: satirlar.length, gecerli: gecerli.length,
      brut: gecerli.reduce((t, s) => t + (s.brut || 0), 0),
      komisyon: gecerli.reduce((t, s) => t + (s.komisyon_tutari || 0), 0),
    },
  }
}
