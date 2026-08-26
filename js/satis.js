// =====================================================================
// satis.js — SATIŞ MERKEZİ (Premium Enterprise DMS · Aşama 1b)
//
//   Kaynak: v_satis_birlesik (sql/139) — İKİ kaynağı birleştiren köprü:
//     kaynak='CRM'  → satis_snapshot (sql/78). Teslimat onayı (ONAYLANDI)
//                     anında DONMUŞ satış fotoğrafı.
//     kaynak='GURU' → arsiv_satislar (sql/136). 2018-2025 arası GURU'dan
//                     aktarılan 8.031 geçmiş satış. SALT OKUNUR.
//
//   Buradaki hiçbir tutar UI'da yeniden HESAPLANMAZ — kaynak ne yazıyorsa
//   o gösterilir (Göksenil kararı: "veriler sabit, tekrar hesaplanmayacak").
//   Sadece KPI şeridinde ve liste özetinde sayım / toplam / ortalama yapılır.
//
//   ⚠️ GEÇMİŞ SATIŞLARIN AYRI SAYFASI YOKTUR (Göksenil, 3 Ağu 2026:
//      "mevcuttaki satışlar sayfasına at kayıtları köprü kullanarak.
//      başka sayfa oluşturmayalım"). Ayırt etme `kaynak` çipiyle yapılır.
//
//   ⚠️ SAYFALAMA ZORUNLU: PostgREST tek istekte en çok 1.000 satır döndürür
//      (CLAUDE.md §5.3). Arşivle birlikte 8.000'i aşan satır var; range()
//      döngüsü olmadan liste SESSİZCE kesilir ve rapor yanlış çıkar.
//      Aynı tuzak stok.js'te yaşandı.
//
//   RLS: master + yönetici hepsini, danışman kendi satışını görür
//   (satis_snapshot_oku). Arşivi kimlik doğrulanmış herkes okur, hiç kimse
//   YAZAMAZ (arsiv_satislar'da yalnız SELECT politikası var — ölçüldü:
//   danışman UPDATE/DELETE = 0 satır). İstemci tarafında ek filtre YOK.
//
//   ⚠️ ARAMA, FİLTRE VE SAYFALAMA SUNUCUDA (sql/147). İstemcide yalnız
//      görünen sayfa durur. Eskiden 8.031 satırın tamamı iniyordu — 7,1 MB
//      ve 17,7 sn. Ölçümler ve gerekçe "SUNUCU TARAFI SAYFALAMA" başlığında.
//
//   Ekran düzeni:
//     • Global arama (plaka / şasi / müşteri / telefon / danışman / noter)
//     • 6 KPI kartı — TAMAMI sunucudan (satis_ozet), geçen aya göre rozet
//     • Kaynak çipi (Tümü/Güncel/Arşiv) + dönem çipi + 5 açılır filtre;
//       seçenek listeleri de sunucudan gelir
//     • 64px satırlı zengin tablo + çoklu seçim + sticky toplu işlem barı
//     • Sağ detay paneli (drawer) — ağır alanlar satır açılınca gelir;
//       arşiv satırlarında canlı sekmeler GİZLENİR (siparis_id/arac_id yok)
//     • Sunucu sayfalaması, sayfa boyu kullanıcı seçimli (20/50/100)
//
//   Bileşenler tek kaynaktan: stitch-ui.js (kpiKart, durumCip, sekmeBar,
//   yanPanel*, cipler, bosDurum, uyari, mat, basHarf). Bu sayfaya özel
//   kart/buton tipi TÜRETİLMEDİ.
// =====================================================================
import { supabase } from './supabase-client.js'
import {
  fmtPara, fmtTarih, fmtTarihKisa, kacis, trBuyuk, telNo, telBicim, waHref, dbHata,
  danismanMap, danismanAdi, csvIndir, olayEtiket, evrakEtiket, musteriTipEtiket,
  karGorur, satisGunu, TURETILMIS_NOT,
} from './veri.js'
// Çift tık → tam görünüm pop-up (Göksenil tasarımı). Sekme çizicileri
// KOPYALANMADI, pencereye enjekte edilir — bkz. satis-kayit-pencere.js.
import { satisKayitAc } from './satis-kayit-pencere.js'
import {
  mat, basHarf, uyari, bosDurum, cipler, kpiKart, durumCip, sekmeBar,
  yanPanel, yanPanelAc, yanPanelKapat, yanPanelBagla,
} from './stitch-ui.js'
// Ekspertiz şeması TEK KAYNAK: ekspertiz.js + img/ekspertiz-sema.svg.
// Bu sayfaya özel şema/renk/etiket TÜRETİLMEDİ (stok.js ile aynı desen).
import { svgBoya, PARCALAR, RENK, DURUM_ETIKET } from './ekspertiz.js'

const KOK = () => document.getElementById('kok')
// Sayfa boyu kullanıcı seçimli (Göksenil: "20-50-100 kayıtların
// görünebileceği kullanıcıların seçim yapacağı bir şey ekle").
const SAYFA_BOY_SECENEK = [20, 50, 100]
// Excel'de kaçak döngüye karşı emniyet freni (PostgREST 1.000'lik sayfalar).
const AZAMI_SATIR = 60000
let SAYFA_BOY = 50

let BEN = null
let SNAP = []                       // YALNIZ görünen sayfanın satırları
let TOPLAM = 0                      // sunucudan gelen filtreli toplam (count:'exact')
let YUKLENIYOR = false
let ISTEK_DAMGA = 0                 // yarış koruması: eski sayfa isteği düşer
let DMAP = {}                       // danışman id → kayıt (not/olay yazarı için)
let KATALOG = []                    // tanimlar(CARI_ISLEM_TIPI) — tahsilat satır etiketleri
let OZET = null                     // satis_ozet() — KPI + toplam + filtre seçenekleri (sql/147)
let SECIM = new Set()               // seçili snapshot id'leri
let SAYFA = 0
let PANEL_ID = null                 // açık detay panelindeki snapshot id
let PANEL_SEKME = 'ozet'
const PANEL_ONBELLEK = new Map()    // snapshot id → { fotolar, hareketler, evraklar, notlar, rezNot, olaylar }

const filtre = {
  arama: '', donem: 'tumu', kaynak: 'tumu',
  danisman: '', marka: '', model: '', satisTipi: '', teslim: '', park: '', musteriTipi: '',
  yilMin: '', yilMax: '', fiyatMin: '', fiyatMax: '', tarihBas: '', tarihSon: '',
}
const FILTRE_BOS = { ...filtre }
let GELISMIS_ACIK = false

const DONEM_CIP = [['tumu', 'Tümü'], ['bugun', 'Bugün'], ['hafta', 'Bu Hafta'], ['ay', 'Bu Ay']]
const KAYNAK_CIP = [['tumu', 'Tümü'], ['CRM', 'Güncel'], ['GURU', 'Arşiv']]
const arsivMi = s => s.kaynak === 'GURU'

// --- Küçük yardımcılar -------------------------------------------------
// Gösterim büyük harfi: .ai/04_FRONTEND § "Türkçe metin" — ekranda
// toLocaleUpperCase('tr'). trBuyuk() YALNIZ arama karşılaştırmasında
// (Ç→C katlar, ekranda "ÇALMAZ"ı "CALMAZ" yapar).
const BUY = v => kacis(String(v ?? '').toLocaleUpperCase('tr'))
const fotoUrl = yol => { try { return supabase.storage.from('arac-foto').getPublicUrl(yol).data.publicUrl } catch (e) { console.error('[satis] foto url', e); return '' } }
const dosyaNo = id => id ? '#SM-' + String(id).slice(0, 8).toUpperCase() : ''
// Arşivin sipariş dosyası yok; kimliği kendi id'sinden türer.
const kayitNo = s => arsivMi(s) ? '#AR-' + String(s.id || '').slice(0, 8).toUpperCase() : dosyaNo(s.siparis_id)

// Satışın "gün"ü: noter satış tarihi, yoksa snapshot anı (onay).
// satisGunu + TURETILMIS_NOT → veri.js (iki ekran ortak kullanıyor)
const gunBasi = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function haftaBasi(d) {
  const x = gunBasi(d)
  const g = (x.getDay() + 6) % 7          // Pazartesi = 0
  x.setDate(x.getDate() - g)
  return x
}

// --- Kurulum -----------------------------------------------------------
export async function satisMerkeziKur(d) {
  BEN = d || null
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant text-body-md">Satışlar yükleniyor…</div>`
  DMAP = await danismanMap()
  panelKabuguKur()
  await yukle()
  await derinBaglanti()
}

// ?satis=<id> ile gelinmişse o kaydı doğrudan tam görünümde aç.
// ⚠️ Sunucu tarafı sayfalama var (sql/147): aranan kayıt AÇIK SAYFADA
//    OLMAYABİLİR. O yüzden listede yoksa tek satır ayrıca çekilir —
//    yoksa link "çalışmıyor" görünürdü.
async function derinBaglanti() {
  let id
  try { id = new URL(location.href).searchParams.get('satis') } catch { return }
  if (!id) return
  if (!SNAP.find(x => x.id === id)) {
    const { data, error } = await supabase.from('v_satis_liste')
      .select(LISTE_KOLON).eq('id', id).maybeSingle()
    if (error) { dbHata('derin bağlantı — satış', error); return }
    if (!data) { console.error('[satis] derin bağlantı: kayıt bulunamadı', id); return }
    SNAP.push(data)
  }
  await tamGorunumAc(id)
}

// Detay paneli kabuğu bir KEZ basılır (ciz() KOK'u yeniden yazdığı için
// panelin dışarıda durması gerekiyor — aksi hâlde her filtrede kapanırdı).
let panelKuruldu = false
function panelKabuguKur() {
  if (panelKuruldu) return
  panelKuruldu = true
  const kap = document.createElement('div')
  kap.className = 'stitch'
  kap.id = 'smPanelKap'
  kap.innerHTML = yanPanel({ id: 'smPanel', baslik: 'Satış Detayı', ikon: 'receipt_long', genislik: 'sm:w-[420px]' })
  document.body.appendChild(kap)
  yanPanelBagla('smPanel', () => { PANEL_ID = null })
  // Sekme tıklamaları (panel kabuğu sabit → tek delegasyon yeter)
  document.getElementById('smPanel')?.addEventListener('click', e => {
    const b = e.target.closest('[data-sekme]')
    if (!b) return
    PANEL_SEKME = b.dataset.sekme
    panelIcerikCiz()
  })
}

// =====================================================================
// KOLON BÖLÜNMESİ — sayfa açılış süresinin tamamı buradan geliyordu.
//
// ÖLÇÜM (8.031 satır, canlı, 3 Ağu 2026):
//     59 kolon · ardışık 9 istek  →  17.727 ms   ← eski hâli
//     59 kolon · paralel          →   7.823 ms
//     35 kolon · ardışık          →   6.197 ms
//     35 kolon · paralel          →   1.643 ms   ← yeni hâli
//
//   Darboğaz SIRALAMA DEĞİL, VERİ BOYUTU: aynı sorgu 11 kolonla sayfa
//   başına ~500 ms, 35 kolonla ~1.300 ms sürüyor. Sıralamayı tamamen
//   kaldırmak hiçbir şey kazandırmadı (410 ms ↔ 590 ms) — ölçüldü.
//
// Bu yüzden liste YALNIZ kendi ihtiyacını çeker. Ağır alanlar (ekspertiz
// jsonb dizisi, alış tarafı, tramer, resmî tutarlar) satır açıldığında tek
// istekle gelir — ölçüm: 253 ms.
// =====================================================================

// Liste + arama + filtre + KPI + özet şeridinin DOKUNDUĞU her alan.
// Buradan bir alan çıkarmadan önce filtreli() / kpiHesap() /
// satirHtml() / benzersiz() içinde kullanılmadığını doğrula.
const LISTE_KOLON = `
  id, siparis_id, arac_id, musteri_id, kaynak,
  plaka, yeni_plaka, marka, model, versiyon, yil, yakit, vites, sasi_no, park, kapak_foto,
  musteri_ad_soyad, musteri_telefon, musteri_tipi, danisman_ad,
  anlasilan_tutar, kalan_bakiye, kar_zarar, kar_zarar_yuzde,
  satis_tipi, satis_tarihi, noter_adi, yevmiye_no, teslim_durumu, onay_zamani`
// ⚠️ `ara` ve `gun` SEÇİLMEZ: yalnız sunucudaki filtre/arama için varlar.
//    Kimlik/satıcı alanları da listede değil — arama zaten `ara` üzerinden,
//    Excel ise ağır kolonlardan (v_satis_birlesik) okuyor. Bu liste
//    v_satis_liste'de GERÇEKTEN var olan kolonlardan oluşmalı; olmayan bir
//    ad PostgREST'ten 400 döndürür ve sayfa boş kalır (bir kez oldu).

// Detay panelinin ve Excel'in EK olarak istediği alanlar.
const AGIR_KOLON = `
  id, danisman_id, renk, km, kasa_tipi, maliyet,
  alici_kimlik, satici_ad, satici_kimlik, alis_noter,
  liste_fiyati, noter_satis_tutari, tahsilat_toplam, iade_toplam,
  resmi_tahsilat, resmi_fark, yeni_ruhsat_seri_no, teslim_tarihi,
  alis_sekli, alis_tarihi, alis_fiyati, masraf, alis_km, alis_sorumlusu,
  foto_adet, nas_klasor, ekspertiz_paneller, hasar_adedi, hasar_tutari, yedek_anahtar`

// =====================================================================
// SUNUCU TARAFI SAYFALAMA (sql/147)
//
// Göksenil: "8 binlik kayıt inmesin, sayfa açılır açılmaz ilk sayfa insin —
//   sonra 2. sayfaya kullanıcı geçerse o sayfa insin."
//
// ÖLÇÜM — neden böyle:
//     8.031 satır × 35 kolon = 7,1 MB   →  17,7 sn   (eski: hepsi inerdi)
//     50 satır + count:'exact'          →     673 ms
//    100 satır                          →     406 ms
//     filtreli 50 satır + tam sayım     →     527 ms
//
// ⚠️ count:'exact' SAYFA SORGUSUYLA BİRLİKTE ucuz. Ayrı bir head:true
//    sayım isteği 2.338 ms sürüyordu — o yüzden tek istekte alınıyor.
//
// ⚠️ ARAMA VE FİLTRE ARTIK SUNUCUDA. Elde yalnız görünen sayfa var;
//    istemcide filtrelemek eksik sonuç verirdi. Arama `ara` kolonuna
//    vurur — Türkçe İ/ı katlaması hem veride hem sorguda aynı (sql/147 +
//    veri.js/trBuyuk).
// =====================================================================

// Dönem filtresinin başlangıç günü (yyyy-mm-dd) — 'bugun' tam eşleşme.
function donemFiltre(q) {
  const simdi = new Date()
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (filtre.donem === 'bugun') return q.eq('gun', iso(gunBasi(simdi)))
  if (filtre.donem === 'hafta') return q.gte('gun', iso(haftaBasi(simdi)))
  if (filtre.donem === 'ay') return q.gte('gun', iso(new Date(simdi.getFullYear(), simdi.getMonth(), 1)))
  return q
}

// Geçerli filtreleri PostgREST sorgusuna uygular. Tek kaynak — sayfa,
// Excel ve sayım hep buradan geçer ki üçü farklı sonuç vermesin.
function sorguKur(kolon, sayimli) {
  let q = sayimli
    ? supabase.from('v_satis_liste').select(kolon, { count: 'exact' })
    : supabase.from('v_satis_liste').select(kolon)
  if (filtre.kaynak !== 'tumu') q = q.eq('kaynak', filtre.kaynak)
  if (filtre.danisman) q = q.eq('danisman_ad', filtre.danisman)
  if (filtre.marka) q = q.eq('marka', filtre.marka)
  if (filtre.model) q = q.eq('model', filtre.model)
  if (filtre.satisTipi) q = q.eq('satis_tipi', filtre.satisTipi)
  if (filtre.teslim) q = q.eq('teslim_durumu', filtre.teslim)
  if (filtre.park) q = q.eq('park', filtre.park)
  if (filtre.musteriTipi) q = q.eq('musteri_tipi', filtre.musteriTipi)
  if (filtre.yilMin) q = q.gte('yil', Number(filtre.yilMin))
  if (filtre.yilMax) q = q.lte('yil', Number(filtre.yilMax))
  if (filtre.fiyatMin) q = q.gte('anlasilan_tutar', Number(filtre.fiyatMin))
  if (filtre.fiyatMax) q = q.lte('anlasilan_tutar', Number(filtre.fiyatMax))
  // ⚠️ Serbest tarih aralığı VARSA dönem çipi uygulanmaz — ikisi aynı
  //    kolona (gun) vurup birbirini daraltır, kullanıcı boş liste görürdü.
  if (filtre.tarihBas || filtre.tarihSon) {
    if (filtre.tarihBas) q = q.gte('gun', filtre.tarihBas)
    if (filtre.tarihSon) q = q.lte('gun', filtre.tarihSon)
  } else {
    q = donemFiltre(q)
  }
  // % ve _ desen karakteri; kullanıcı metninden temizlenir ki arama
  // beklenmedik biçimde genişlemesin.
  const a = trBuyuk(filtre.arama).trim().replace(/[%_]/g, '')
  if (a) q = q.like('ara', '%' + a + '%')
  return q.order('onay_zamani', { ascending: false, nullsFirst: false }).order('id')
}

// Görünen sayfayı getirir. Eski istek geç dönerse damgayla düşürülür —
// hızlı yazarken sayfa eski sonuca atlamasın.
async function sayfaYukle() {
  const damga = ++ISTEK_DAMGA
  YUKLENIYOR = true
  cizListe()
  const { data, error, count } = await sorguKur(LISTE_KOLON, true)
    .range(SAYFA * SAYFA_BOY, SAYFA * SAYFA_BOY + SAYFA_BOY - 1)
  if (damga !== ISTEK_DAMGA) return
  YUKLENIYOR = false
  if (error) {
    dbHata('satış listesi', error)
    SNAP = []; TOPLAM = 0
  } else {
    SNAP = data || []
    TOPLAM = count ?? SNAP.length
  }
  // Seçim sayfaya özgü: sayfa/filtre değişince taşınmaz.
  SECIM = new Set()
  cizListe()
}

// Bir satırın ağır alanlarını getirip YERİNDE birleştirir. Zaten yüklüyse
// ağa çıkmaz — panel ikinci kez açıldığında istek yok.
async function agirYukle(s) {
  if (!s || s._agir) return s
  const { data, error } = await supabase.from('v_satis_birlesik')
    .select(AGIR_KOLON).eq('id', s.id).maybeSingle()
  if (error) { dbHata('satış ağır alanlar', error); return s }
  Object.assign(s, data || {}, { _agir: true })
  return s
}

// Excel için: seçili satırların ağır alanlarını topluca getirir (id demetleri
// hâlinde, paralel). Tek tek çekmek 8.000 istek olurdu.
async function agirTopluYukle(list) {
  const eksik = list.filter(s => !s._agir)
  if (!eksik.length) return
  const DEMET = 200
  const parcalar = []
  for (let i = 0; i < eksik.length; i += DEMET) parcalar.push(eksik.slice(i, i + DEMET))
  const sonuc = await Promise.all(parcalar.map(p =>
    supabase.from('v_satis_birlesik').select(AGIR_KOLON).in('id', p.map(s => s.id))))
  const harita = new Map()
  for (const r of sonuc) {
    if (r.error) { dbHata('Excel ağır alanlar', r.error); continue }
    for (const d of (r.data || [])) harita.set(d.id, d)
  }
  for (const s of eksik) {
    const d = harita.get(s.id)
    if (d) Object.assign(s, d, { _agir: true })
  }
}

async function yukle() {
  // Yenilemede açık panel kapanır ve detay önbelleği düşer — aksi hâlde
  // ekranda eski (bayat) cari hareket / not listesi kalırdı.
  if (panelKuruldu) yanPanelKapat('smPanel', () => { PANEL_ID = null })
  PANEL_ONBELLEK.clear()

  // ⚠️ LİSTE, ÖZETİ BEKLEMEZ. satis_ozet() soğuk çağrıda 2.833 ms, sıcakta
  //    97 ms sürüyor (ölçüldü — plan önbelleği). Onu beklemek listeyi de
  //    ~3 sn geciktiriyordu. Artık iskelet basılır, liste hemen çekilir
  //    (156 ms), KPI ve filtre seçenekleri gelince YERİNDE güncellenir.
  SECIM = new Set()
  SAYFA = 0
  ciz()
  // ⚠️ SIRAYLA: ikisi aynı anda gidince satis_ozet (8.031 satırı tarayan
  //    KPI+seçenek sorgusu) liste sorgusunu DB'de bekletiyordu — ölçüm:
  //    liste tek başına 156 ms, birlikte 3.178 ms. Önce liste, sonra özet.
  await sayfaYukle()
  ozetYukle()
}

// KPI + filtre seçeneklerini arkada getirir ve YALNIZ o iki kabı yeniler.
// Tüm KOK'u yeniden yazmıyor: kullanıcı bu sırada arama kutusuna yazıyor
// olabilir, odak kaybolmasın.
async function ozetYukle() {
  const [ozetR, katalogR] = await Promise.all([
    supabase.rpc('satis_ozet'),
    supabase.from('tanimlar').select('kod, ad, sira').eq('tip', 'CARI_ISLEM_TIPI').order('sira'),
  ])
  if (ozetR.error) dbHata('satis_ozet', ozetR.error)
  if (katalogR.error) dbHata('cari işlem tipi kataloğu', katalogR.error)
  OZET = ozetR.data || OZET
  KATALOG = katalogR.data || []
  const kpiEl = document.getElementById('smKpi')
  const filtreEl = document.getElementById('smFiltre')
  if (!kpiEl || !filtreEl) return
  kpiEl.innerHTML = kpiHtml()
  filtreEl.innerHTML = filtreHtml()
  baglaFiltre()                    // YALNIZ filtre çubuğu yeniden bağlanır
}

// --- Filtreleme --------------------------------------------------------
// ⚠️ donemUyar() ve filtreli() KALDIRILDI. Filtre/arama artık sunucuda
//    (sorguKur). Elde yalnız görünen sayfa olduğu için istemcide
//    filtrelemek EKSİK sonuç verirdi.

// Varsayılandan sapan tek bir alan bile "filtre var" demektir. Elle liste
// tutmak yerine FILTRE_BOS ile karşılaştırılıyor ki yeni bir filtre
// eklendiğinde burayı güncellemek unutulmasın.
function filtreVarMi() {
  return Object.keys(FILTRE_BOS).some(k => filtre[k] !== FILTRE_BOS[k])
}

// Aktif filtreleri tek tek kaldırılabilir rozet olarak listeler —
// "hangi filtre açıktı" sorusunu ekranda cevaplar.
const FILTRE_ETIKET = {
  arama: 'Arama', donem: 'Dönem', kaynak: 'Kaynak', danisman: 'Danışman',
  marka: 'Marka', model: 'Model', satisTipi: 'Satış Tipi', teslim: 'Teslim',
  park: 'Park', musteriTipi: 'Müşteri Tipi', yilMin: 'Yıl ≥', yilMax: 'Yıl ≤',
  fiyatMin: 'Fiyat ≥', fiyatMax: 'Fiyat ≤', tarihBas: 'Tarih ≥', tarihSon: 'Tarih ≤',
}
const DONEM_ADI = Object.fromEntries(DONEM_CIP)
const KAYNAK_ADI = Object.fromEntries(KAYNAK_CIP)
function aktifFiltreHtml() {
  const acik = Object.keys(FILTRE_BOS).filter(k => filtre[k] !== FILTRE_BOS[k])
  if (!acik.length) return '<span data-fkaplar></span>'
  const deger = k => k === 'donem' ? DONEM_ADI[filtre[k]]
    : k === 'kaynak' ? KAYNAK_ADI[filtre[k]]
    : k === 'teslim' ? (filtre[k] === 'TESLIM_EDILDI' ? 'Teslim Edildi' : 'Teslim Bekliyor')
    : k === 'musteriTipi' ? musteriTipEtiket(filtre[k])
    : (k === 'fiyatMin' || k === 'fiyatMax') ? fmtPara(filtre[k])
    : filtre[k]
  return `<div data-fkaplar class="flex flex-wrap items-center gap-1.5 mt-2">
    ${acik.map(k => `<button data-fkaldir="${k}" title="Bu filtreyi kaldır"
        class="inline-flex items-center gap-1 text-label-sm font-bold bg-primary-fixed text-primary pl-2.5 pr-1.5 py-1 rounded-full hover:bg-primary/15">
        ${kacis(FILTRE_ETIKET[k] || k)}: ${kacis(String(deger(k)))}${mat('close', 'text-[14px]')}</button>`).join('')}
    <button id="smTumunuTemizle" class="text-label-sm font-bold text-error px-2 py-1 rounded-full hover:bg-error/5">Tümünü temizle</button>
  </div>`
}

// ⚠️ TOPLAM CİRO / TOPLAM KÂR / ORTALAMA MARJ ŞERİDİ KALDIRILDI
//    (Göksenil, 3 Ağu 2026: "bunları finans modülüne göndereceğiz zaten
//    burada hesaplamasına gerek yok"). Kâr rakamı satır bazında kâr
//    rozetinde duruyor; toplu finansal özet Satış Merkezi'nin işi değil.
//    Not: şerit yavaşlığın sebebi DEĞİLDİ — o zaten inmiş satırlardan
//    hesaplanıyordu, maliyeti sıfırdı (ölçüm kayıtları sql/146 başlığında).

// --- KPI ---------------------------------------------------------------
// NOT: Burada YALNIZ sayım / toplam / ortalama yapılır. Tek bir satırın
// tutarı asla yeniden hesaplanmaz — snapshot alanları olduğu gibi toplanır.
function kpiHesap() {
  // ⚠️ TAMAMI SUNUCUDAN (sql/147 satis_ozet). Elde yalnız görünen sayfa
  //    var; istemcide toplamak 50 satırın rakamını 8.031'inki gibi
  //    gösterirdi. Boş dönerse sıfır basılır, uydurma yapılmaz.
  const o = OZET || {}
  const say = v => Number(v) || 0
  const ayOrt = o.ayAdet ? say(o.ayCiro) / o.ayAdet : 0
  const oncekiOrt = o.oncekiAyAdet ? say(o.oncekiAyCiro) / o.oncekiAyAdet : 0
  return {
    bugunAdet: o.bugunAdet || 0, bugunTutar: say(o.bugunTutar),
    bugunTrend: trend(o.bugunAdet || 0, o.dunAdet || 0),
    ayAdet: o.ayAdet || 0, ayTrend: trend(o.ayAdet || 0, o.oncekiAyAdet || 0),
    ayCiro: say(o.ayCiro), ayCiroTrend: trend(say(o.ayCiro), say(o.oncekiAyCiro)),
    teslimEdilen: o.teslimEdilen || 0, teslimBekleyen: o.teslimBekleyen || 0,
    arsivAdet: o.arsivAdet || 0,
    ortalama: ayOrt, ortalamaTrend: trend(ayOrt, oncekiOrt),
  }
}

function trend(simdi, onceki) {
  if (!onceki) return null
  const y = ((simdi - onceki) / onceki) * 100
  return { yuzde: y, iyiMi: y >= 0 }
}

// --- Rozetler ----------------------------------------------------------
function teslimCip(s) {
  return s.teslim_durumu === 'TESLIM_EDILDI'
    ? durumCip('Teslim Edildi', 'bg-secondary-container text-on-secondary-container', 'bg-secondary')
    : durumCip('Teslim Bekliyor', 'bg-amber-100 text-amber-800', 'bg-amber-500')
}
// Arşiv satırında teslim durumu ayırt edici değil (hepsi tamamlanmış satış);
// yerine kaydın NEREDEN geldiği gösterilir.
function durumHtml(s) {
  return arsivMi(s)
    // Kısa etiket: kolon genişliği sınırlı, "Arşiv · GURU" adı kırpılmaya
    // zorluyordu. Kaynağın tamamı title'da ve detay panelinde yazıyor.
    ? durumCip('Arşiv', 'bg-surface-container-high text-on-surface-variant', 'bg-on-surface-variant')
    : teslimCip(s)
}
function bakiyeRozet(s) {
  const b = Number(s.kalan_bakiye) || 0
  return Math.abs(b) < 0.005
    ? `<span class="inline-flex items-center gap-1 text-label-sm font-bold text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full whitespace-nowrap">${mat('check_circle', 'text-[14px]')} ₺0 Tamamlandı</span>`
    : `<span class="inline-flex items-center gap-1 text-label-sm font-bold text-on-error-container bg-error-container px-2 py-0.5 rounded-full whitespace-nowrap">${mat('error', 'text-[14px]')} ${kacis(fmtPara(Math.abs(b)))}</span>`
}
// Arşivde kalan bakiye kavramı yok (cari kapanmış). Onun yerine kâr/zarar:
// satış raporunda aranan asıl rakam bu.
function karRozet(s) {
  // ⚠️ Göksenil (5 Ağu 2026): "kâr zarar ve kârlılık sadece yöneticilere."
  //    Bu rozet arşiv satırlarında liste ve panel başlığında görünüyordu —
  //    yani 8.031 satışın kârı her danışmana açıktı.
  if (!karGorur(BEN)) return `<span class="text-label-sm text-on-surface-variant">—</span>`
  if (s.kar_zarar == null) return `<span class="text-label-sm text-on-surface-variant">kâr bilinmiyor</span>`
  const k = Number(s.kar_zarar) || 0
  const y = s.kar_zarar_yuzde != null ? ` · %${kacis(Number(s.kar_zarar_yuzde).toLocaleString('tr-TR', { maximumFractionDigits: 1 }))}` : ''
  const zarar = k < 0
  return `<span class="inline-flex items-center gap-1 text-label-sm font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${zarar ? 'text-on-error-container bg-error-container' : 'text-on-secondary-container bg-secondary-container'}">
    ${mat(zarar ? 'trending_down' : 'trending_up', 'text-[14px]')} ${zarar ? '−' : ''}${kacis(fmtPara(Math.abs(k)))}${y}</span>`
}
const tutarRozet = s => arsivMi(s) ? karRozet(s) : bakiyeRozet(s)
function plakaHtml(s) {
  return s.yeni_plaka && s.yeni_plaka !== s.plaka
    ? `<span class="tabular-nums">${BUY(s.plaka) || '—'}</span> <span class="text-on-surface-variant">→</span> <span class="tabular-nums text-primary">${BUY(s.yeni_plaka)}</span>`
    : `<span class="tabular-nums">${BUY(s.plaka) || '—'}</span>`
}

// --- Çizim -------------------------------------------------------------
// ⚠️ Filtre seçenekleri SUNUCUDAN (sql/147 satis_ozet.secenekler). Elde
//    yalnız görünen sayfa olduğu için SNAP'ten türetmek açılır listeleri
//    sayfadan sayfaya değiştirirdi.
function secenek(ad) { return (OZET?.secenekler?.[ad]) || [] }

function secimAc(id, etiket, secenekler, aktif, etiketleyici = v => v, kucuk = false) {
  if (!secenekler.length) return ''         // veri yoksa filtreyi hiç gösterme
  const sinif = kucuk
    ? 'w-full min-w-0 bg-surface-container-low border-none rounded-lg px-2.5 py-1.5 text-body-sm font-semibold focus:ring-2 focus:ring-primary/20'
    : 'bg-surface-container-low border-none rounded-xl px-4 py-2.5 text-body-sm font-semibold focus:ring-2 focus:ring-primary/20'
  return `<select id="${id}" aria-label="${kacis(etiket)}" class="${sinif}">
    <option value="">${kacis(etiket)}</option>
    ${secenekler.map(v => `<option value="${kacis(v)}"${aktif === v ? ' selected' : ''}>${kacis(etiketleyici(v))}</option>`).join('')}
  </select>`
}

// KPI şeridi — tamamı sunucudan (kpiHesap). ozetYukle() bunu tek başına
// yeniden basabilsin diye ciz()'den AYRI duruyor.
function kpiHtml() {
  const k = kpiHesap()
  return `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
    ${kpiKart('today', 'bg-primary-fixed text-primary', k.bugunAdet, 'Bugün Satış', fmtPara(k.bugunTutar), k.bugunTrend)}
    ${kpiKart('calendar_month', 'bg-blue-100 text-blue-700', k.ayAdet, 'Bu Ay Satış', 'adet', k.ayTrend)}
    ${kpiKart('payments', 'bg-secondary-container text-on-secondary-container', fmtPara(k.ayCiro), 'Bu Ay Ciro', 'anlaşılan tutar toplamı', k.ayCiroTrend)}
    ${kpiKart('local_shipping', 'bg-secondary-container text-on-secondary-container', k.teslimEdilen, 'Teslim Edilen', 'güncel satışlar')}
    ${kpiKart('hourglass_top', 'bg-amber-100 text-amber-700', k.teslimBekleyen, 'Teslim Bekleyen', 'finans onayı verildi')}
    ${k.arsivAdet
      ? kpiKart('inventory_2', 'bg-surface-container-high text-on-surface-variant', k.arsivAdet.toLocaleString('tr-TR'), 'Arşiv Kaydı', 'GURU · 2018-2025')
      : kpiKart('leaderboard', 'bg-surface-container-high text-on-surface', fmtPara(Math.round(k.ortalama)), 'Ortalama Satış', 'bu ay', k.ortalamaTrend)}
  </div>`
}

// Filtre çubuğu — seçenekleri sunucudan (secenek()). Özet gelmeden önce
// listeler boş; secimAc() boş listede filtreyi hiç basmıyor.
function filtreHtml() {
  // Seçenekler ADDAN üretilir (yukarıdaki filtre notu). Arşivde danisman_id
  // olmadığı için id'ye dayanan liste geçmiş danışmanları hiç göstermiyordu.
  const danSecenek = secenek('danisman')
  const danHtml = danSecenek.length
    ? `<select id="smDanisman" aria-label="Danışman" class="bg-surface-container-low border-none rounded-xl px-4 py-2.5 text-body-sm font-semibold focus:ring-2 focus:ring-primary/20">
        <option value="">Danışman</option>
        ${danSecenek.map(ad => `<option value="${kacis(ad)}"${filtre.danisman === ad ? ' selected' : ''}>${kacis(ad)}</option>`).join('')}
      </select>` : ''

  // Kaynak çipi yalnız iki kaynak da varsa anlamlı (arşiv aktarılmadan önce
  // tek çip gösterip kullanıcıyı yanıltmayalım).
  const kaynakHtml = secenek('kaynak').length > 1
    ? `<div id="smKaynakCipler" class="flex flex-wrap items-center gap-2">${cipler(KAYNAK_CIP, filtre.kaynak)}</div>
       <div class="h-8 w-px bg-outline-variant mx-1 hidden md:block"></div>` : ''

  // Model listesi SEÇİLİ MARKAYA bağlı (sql/148 markaModel haritası).
  // Marka seçilmeden 289 modeli tek listede vermek işe yaramazdı.
  const modeller = filtre.marka ? (OZET?.secenekler?.markaModel?.[filtre.marka] || []) : []
  const modelHtml = modeller.length
    ? secimAc('smModel', 'Model', modeller, filtre.model, v => String(v).toLocaleUpperCase('tr'))
    : ''
  return `<div class="bg-surface-container-lowest p-3 rounded-2xl border border-outline-variant custom-shadow flex flex-wrap items-center gap-3">
    ${kaynakHtml}
    <div id="smCipler" class="flex flex-wrap items-center gap-2">${cipler(DONEM_CIP, filtre.donem)}</div>
    <div class="h-8 w-px bg-outline-variant mx-1 hidden md:block"></div>
    ${danHtml}
    ${secimAc('smMarka', 'Marka', secenek('marka'), filtre.marka, v => String(v).toLocaleUpperCase('tr'))}
    ${modelHtml}
    ${secimAc('smSatisTipi', 'Satış Tipi', secenek('satisTipi'), filtre.satisTipi)}
    <button id="smGelismis" class="flex items-center gap-1 text-label-md font-bold px-3 py-2 rounded-xl ${GELISMIS_ACIK ? 'bg-primary-fixed text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}">
      ${mat('tune', 'text-[18px]')} Gelişmiş${mat(GELISMIS_ACIK ? 'expand_less' : 'expand_more', 'text-[18px]')}</button>
    <div class="flex-1"></div>
    <button id="smExcel" title="Excel (CSV) indir" aria-label="Excel indir" class="p-2.5 text-on-surface-variant hover:bg-surface-container-high rounded-xl">${mat('file_download')}</button>
    <button id="smYazdir" title="Yazdır" aria-label="Yazdır" class="p-2.5 text-on-surface-variant hover:bg-surface-container-high rounded-xl">${mat('print')}</button>
    <button id="smYenile" title="Yenile" aria-label="Yenile" class="p-2.5 text-primary hover:bg-primary/10 rounded-xl">${mat('refresh')}</button>
    </div>
    ${GELISMIS_ACIK ? gelismisHtml() : ''}
    ${aktifFiltreHtml()}
  </div>`
}

// Sayısal/tarih aralığı ikilisi — yıl, fiyat ve tarih aynı deseni kullanır.
function aralikHtml(etiket, idMin, idMax, degMin, degMax, tip, ipucuMin, ipucuMax) {
  const kutu = (id, deger, ipucu) => `<input id="${id}" type="${tip}" value="${kacis(deger)}"
    placeholder="${kacis(String(ipucu ?? ''))}"
    class="w-full min-w-0 bg-surface-container-low border-none rounded-lg px-2.5 py-1.5 text-body-sm font-semibold focus:ring-2 focus:ring-primary/20" />`
  return `<label class="flex flex-col gap-1 min-w-0">
    <span class="text-label-sm text-on-surface-variant uppercase tracking-wide">${kacis(etiket)}</span>
    <span class="flex items-center gap-1.5 min-w-0">${kutu(idMin, degMin, ipucuMin)}
      <span class="text-on-surface-variant shrink-0">–</span>${kutu(idMax, degMax, ipucuMax)}</span>
  </label>`
}

// ⚠️ Gelişmiş panel VARSAYILAN KAPALI: danışmanların çoğu hızlı satırla
//    çalışıyor; hepsini birden göstermek çubuğu okunmaz yapıyordu.
//    Yer tutucular verinin GERÇEK aralığını gösterir (sql/148).
function gelismisHtml() {
  const ar = OZET?.secenekler || {}
  return `<div class="mt-3 pt-3 border-t border-outline-variant grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
    ${aralikHtml('Model Yılı', 'smYilMin', 'smYilMax', filtre.yilMin, filtre.yilMax, 'number', ar.yilMin, ar.yilMax)}
    ${aralikHtml('Anlaşılan Fiyat', 'smFiyatMin', 'smFiyatMax', filtre.fiyatMin, filtre.fiyatMax, 'number',
                 ar.fiyatMin != null ? Math.round(ar.fiyatMin) : '', ar.fiyatMax != null ? Math.round(ar.fiyatMax) : '')}
    ${aralikHtml('Satış Tarihi', 'smTarihBas', 'smTarihSon', filtre.tarihBas, filtre.tarihSon, 'date')}
    <label class="flex flex-col gap-1 min-w-0"><span class="text-label-sm text-on-surface-variant uppercase tracking-wide">Danışman</span>
      ${secimAc('smDanisman2', 'Tümü', secenek('danisman'), filtre.danisman, v => v, true)}</label>
    <label class="flex flex-col gap-1 min-w-0"><span class="text-label-sm text-on-surface-variant uppercase tracking-wide">Müşteri Tipi</span>
      ${secimAc('smMusteriTipi', 'Tümü', secenek('musteriTipi'), filtre.musteriTipi, musteriTipEtiket, true)}</label>
    <label class="flex flex-col gap-1 min-w-0"><span class="text-label-sm text-on-surface-variant uppercase tracking-wide">Teslim / Park</span>
      <span class="flex items-center gap-1.5 min-w-0">
        ${secimAc('smTeslim', 'Teslim', secenek('teslim'), filtre.teslim, v => v === 'TESLIM_EDILDI' ? 'Edildi' : 'Bekliyor', true)}
        ${secimAc('smPark', 'Park', secenek('park'), filtre.park, v => v, true)}
      </span></label>
  </div>`
}

function ciz() {
  KOK().innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 md:mb-6">
      <div>
        <p class="text-label-sm text-on-surface-variant uppercase tracking-wider font-medium mb-0.5">Satış Operasyonu</p>
        <h2 class="text-headline-md text-primary font-black">Satış Merkezi</h2>
        <p class="text-body-md text-on-surface-variant">Tüm satış süreçlerini tek ekrandan yönetin.</p>
      </div>
    </div>

    <div class="relative mb-4 md:mb-6">
      ${mat('search', 'absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant')}
      <input id="smArama" type="search" value="${kacis(filtre.arama)}" autocomplete="off"
        aria-label="Satış ara"
        placeholder="Plaka, yeni plaka, şasi, müşteri adı, telefon veya dosya no ile ara…"
        class="w-full pl-12 pr-4 h-14 bg-surface-container-lowest border border-outline-variant rounded-2xl text-body-lg custom-shadow focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all" />
    </div>

    <div id="smKpi">${kpiHtml()}</div>
    <div id="smFiltre" class="mt-4 md:mt-6 mb-4">${filtreHtml()}</div>
    <div id="smSecimBar"></div>
    <div id="smListe"></div>`

  baglaUst()
  cizListe()
}

// Yalnız tablo + seçim barı yeniden çizilir (arama kutusu odağını kaybetmez).
function cizListe() {
  const el = document.getElementById('smListe')
  if (!el) return
  const toplamSayfa = Math.max(1, Math.ceil(TOPLAM / SAYFA_BOY))

  if (YUKLENIYOR && !SNAP.length) {
    el.innerHTML = `<div class="py-16 text-center text-on-surface-variant text-body-md flex items-center justify-center gap-2">
      ${mat('sync', 'animate-spin')} Yükleniyor…</div>`
    return
  }
  if (!SNAP.length) {
    el.innerHTML = bosDurum(filtreVarMi()
      ? 'Filtreye uyan satış yok. Filtreleri gevşetmeyi deneyin.'
      : 'Henüz tamamlanmış satış yok. Teslimat onayı verilen siparişler burada listelenir.', 'receipt_long')
    cizSecimBar()
    return
  }

  const hepsiSecili = SNAP.every(s => SECIM.has(s.id))
  const ilkSira = SAYFA * SAYFA_BOY + 1
  const sonSira = SAYFA * SAYFA_BOY + SNAP.length

  el.innerHTML = `
    <div id="smTablo" class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-x-auto sm:overflow-hidden ${YUKLENIYOR ? 'opacity-60' : ''}">
      <div>
        <table class="w-full text-left border-collapse table-fixed">
          ${/* ⚠️ <colgroup> KALDIRILDI. `display:none` verilen <td> satırdan
                TAMAMEN çıkıyor, kalan hücreler bir ÖNCEKİ <col> yuvasına
                kayıyor. Provada ölçüldü (375 px): Araç kolonu gizli seçim
                kolonunun 0 genişliğini alıp 0 px'e düştü, içerik 48 px
                taştı. Genişlikler artık <th>'lerde — hücreyle birlikte
                hareket ederler, kayma imkânsız. */''}
          <thead><tr class="bg-surface-container-low/60 border-b border-outline-variant text-label-sm text-on-surface-variant uppercase tracking-wide">
            <th class="px-3 py-3 hidden md:table-cell md:w-[40px]"><input type="checkbox" id="smHepsi" aria-label="Sayfadaki tüm satışları seç" ${hepsiSecili ? 'checked' : ''} class="w-4 h-4 accent-primary cursor-pointer" /></th>
            <th class="px-2 py-3 font-bold w-[40%] sm:w-[38%] md:w-[28%]">Araç</th>
            <th class="px-2 py-3 font-bold w-[60%] sm:w-[28%] md:w-[23%]">Müşteri<span class="sm:hidden"> / Fiyat</span></th>
            <th class="px-2 py-3 font-bold hidden md:table-cell md:w-[19%]">Danışman / Tip</th>
            <th class="px-2 py-3 font-bold text-right hidden sm:table-cell sm:w-[20%] md:w-[14%]">Anlaşılan Fiyat</th>
            <th class="px-2 py-3 font-bold hidden md:table-cell md:w-[8%]">Tarih</th>
            <th class="px-2 py-3 font-bold text-right hidden sm:table-cell sm:w-[14%] md:w-[8%]">İşlem</th>
          </tr></thead>
          <tbody class="divide-y divide-outline-variant/30">${SNAP.map(satirHtml).join('')}</tbody>
        </table>
      </div>
      <div class="p-4 flex flex-wrap items-center justify-between gap-3 bg-surface-container-low/30 text-label-md text-on-surface-variant">
        <div class="flex items-center gap-3 flex-wrap">
          <span><b class="text-on-surface tabular-nums">${ilkSira.toLocaleString('tr-TR')}–${sonSira.toLocaleString('tr-TR')}</b>
            / <b class="text-on-surface tabular-nums">${TOPLAM.toLocaleString('tr-TR')}</b> satış</span>
          <label class="flex items-center gap-1.5">
            <span class="text-label-sm">Sayfada</span>
            <select id="smBoy" aria-label="Sayfa başına kayıt" class="bg-surface-container-low border-none rounded-lg px-2 py-1 text-label-md font-bold focus:ring-2 focus:ring-primary/20">
              ${SAYFA_BOY_SECENEK.map(n => `<option value="${n}"${n === SAYFA_BOY ? ' selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>
        </div>
        ${toplamSayfa > 1 ? `<div class="flex items-center gap-2">
          <button id="smOnceki" ${SAYFA === 0 ? 'disabled' : ''} aria-label="Önceki sayfa" class="px-3 py-1.5 rounded-lg border border-outline-variant hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed">${mat('chevron_left', 'text-[18px]')}</button>
          <span class="tabular-nums">${(SAYFA + 1).toLocaleString('tr-TR')} / ${toplamSayfa.toLocaleString('tr-TR')}</span>
          <button id="smSonraki" ${SAYFA >= toplamSayfa - 1 ? 'disabled' : ''} aria-label="Sonraki sayfa" class="px-3 py-1.5 rounded-lg border border-outline-variant hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed">${mat('chevron_right', 'text-[18px]')}</button>
        </div>` : ''}
      </div>
    </div>`

  cizSecimBar()
  baglaListe()
}

// ⚠️ SATIR YATAY KAYDIRMA OLMADAN SIĞMALI (Göksenil, 3 Ağu 2026:
//    "sağa doğru kaydırmadan görmek istiyorum, kullanıcı bütün bilgileri
//    tek bir yerden görmeli").
//
//    ÖNCEKİ HÂLİ 842 px TAŞIYORDU (tablo 2.218 px / kap 1.376 px). Sebep:
//    `truncate` sınıfı vardı ama tablo OTOMATİK yerleşimdeydi — hücre
//    içeriğe göre genişliyor, kısıt hiç uygulanmıyordu. Ölçüm: ARAÇ 635 px,
//    MÜŞTERİ 643 px.
//
//    ÇÖZÜM: `table-fixed` + yüzdeli kolon genişliği. Artık truncate gerçekten
//    çalışıyor. Danışman ve Satış Tipi TEK hücrede birleştirildi (bilgi
//    kaybı yok, iki satır). Kırpılan her metne `title` konuyor ki üzerine
//    gelince tamamı görünsün.
//    ⚠️ Genişlikler önce <colgroup>'taydı; 19 Ağu 2026'da <th>'ye taşındı —
//    nedeni hemen aşağıda.
// Yüzdeler ÖLÇÜMLE dengelendi: ilk denemede danışman kolonu 147 px kalıp
// "GÖKSENİL T…" diye kırpıyordu. Toplam tam 100 olmalı.
// ⚠️ DURUM KOLONU KALDIRILDI (Göksenil, 3 Ağu 2026). Bilgi kaybolmasın
//    diye durum/kaynak rozeti plakanın YANINA taşındı — orada yer var,
//    ayrı kolon 102 px yiyordu. Boşalan genişlik araç/müşteri/danışmana
//    dağıtıldı; toplam tam 100 olmalı.
// ⚠️ KOLON GENİŞLİKLERİ ARTIK <th>'DE (19 Ağu 2026).
//    Önce satır içi `style="width:%"` ile <colgroup>'taydı; satır içi stile
//    medya sorgusu yazılamadığı için 390 px telefonda tarih 25 px, işlem
//    25 px kalıyor, `table-fixed` kolonu büyütmediği için içerik komşunun
//    üstüne biniyordu ("üstüste binmiş görünüyor").
//    Sonra medya sorgulu <col> sınıfları denendi — DAHA KÖTÜ oldu: gizli
//    <td> satırdan tamamen çıkınca kalan hücreler bir önceki <col> yuvasına
//    kayıyor, Araç kolonu 0 px'e düşüyordu (provada ölçüldü).
//    <th> genişliği hücreyle birlikte hareket eder; kayma olamaz.
//    Dar ekranda seçim/danışman/tarih/işlem kolonları kapanıyor, bilgileri
//    Müşteri hücresinin altına iniyor — kaybolmuyor.
//    Yüzdeler her kırılımda 100'e tamamlanmalı:
//      <640 : Araç 42 + Müşteri 32 + Fiyat 26
//      640+ : Araç 38 + Müşteri 28 + Fiyat 20 + İşlem 14
//      768+ : 28 + 23 + 19 + 14 + 8 + 8  (+ 40 px seçim kutusu)


function satirHtml(s) {
  const secili = SECIM.has(s.id)
  const wa = waHref(s.musteri_telefon)
  const altSatir = [s.yakit, s.vites].filter(Boolean).map(v => String(v).toLocaleUpperCase('tr')).join(' · ')
  // ⚠️ VERSİYON TEKRARINI ELE: GURU verisinde model ve versiyon çoğu kez
  //    aynı ("318İ · 318İ") ya da versiyon modeli kapsıyor. Dar kolonda bu
  //    tekrar, gerçek bilgiyi (yakıt/vites) kırpılmaya itiyordu.
  const model = String(s.model || '')
  const versiyon = String(s.versiyon || '')
  const versiyonYaz = versiyon && !versiyon.toLocaleUpperCase('tr').startsWith(model.toLocaleUpperCase('tr'))
  const aracAlt = [s.yil, BUY(s.marka), BUY(s.model)].filter(Boolean).join(' ')
    + (versiyonYaz ? ' · ' + BUY(versiyon) : '') + (altSatir ? ' · ' + kacis(altSatir) : '')
  const musteriAlt = (kacis(telBicim(s.musteri_telefon)) || '—')
    + (s.musteri_tipi ? ' · ' + kacis(musteriTipEtiket(s.musteri_tipi)) : '')
  // title: kırpılan metnin tamamı fareyle üzerine gelince görünsün
  const ipucu = v => kacis(String(v ?? '').replace(/<[^>]*>/g, ''))
  return `
    <tr data-id="${kacis(s.id)}" class="group sm:h-16 hover:bg-surface-container-low/60 transition-colors cursor-pointer ${secili ? 'bg-primary/5' : ''}">
      <td class="px-3 py-3 hidden md:table-cell"><input type="checkbox" data-sec="${kacis(s.id)}" aria-label="Satışı seç" ${secili ? 'checked' : ''} class="w-4 h-4 accent-primary cursor-pointer" /></td>
      <td class="px-2 py-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-12 h-9 rounded-lg bg-surface overflow-hidden shrink-0 border border-outline-variant flex items-center justify-center">
            ${s.kapak_foto
              ? `<img src="${kacis(fotoUrl(s.kapak_foto))}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'material-symbols-outlined text-on-surface-variant text-[20px]',textContent:'directions_car'}))" />`
              : `<span class="material-symbols-outlined text-on-surface-variant text-[20px]">directions_car</span>`}
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-bold text-on-surface truncate flex items-center gap-1.5">${plakaHtml(s)}${durumHtml(s)}</div>
            <div class="text-label-sm text-on-surface-variant truncate" title="${ipucu(aracAlt)}">${aracAlt}</div>
          </div>
        </div>
      </td>
      <td class="px-2 py-3 overflow-hidden"><div class="flex flex-col min-w-0">
        <span class="font-semibold text-on-surface truncate" title="${ipucu(s.musteri_ad_soyad)}">${BUY(s.musteri_ad_soyad) || '—'}</span>
        <span class="text-label-sm text-on-surface-variant tabular-nums truncate">${musteriAlt}</span>
        ${/* Danışman/tip ve tarih kolonları dar ekranda kapalı — bilgi
              BURAYA iniyor, kaybolmuyor. Geniş ekranda gizli. */''}
        <span class="md:hidden text-label-sm text-on-surface-variant truncate">${BUY(s.danisman_ad) || '—'}${s.satis_tipi ? ' · ' + BUY(s.satis_tipi) : ''}</span>
        <span class="md:hidden text-label-sm text-on-surface-variant tabular-nums truncate">${kacis(fmtTarihKisa(satisGunu(s)))}${s.satis_tarihi ? '' : ' (onay)'}</span>
        ${/* Fiyat kolonu dar ekranda kapalı — tutar ve kâr rozeti BURAYA
              iniyor. Yan yana üç kolon 375 px'e sığmıyordu (ölçüm: 413 px
              isteniyor, 343 px var); alt alta konunca satır yükseliyor ve
              hepsi okunur kalıyor. */''}
        <span class="sm:hidden mt-1 pt-1 border-t border-outline-variant/40 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <b class="text-[14px] font-black text-on-surface tabular-nums">${kacis(fmtPara(s.anlasilan_tutar))}</b>
          ${tutarRozet(s)}
        </span>
      </div></td>
      <td class="px-2 py-3 hidden md:table-cell"><div class="flex items-center gap-1.5 min-w-0">
        <span class="w-6 h-6 rounded-full bg-primary-fixed text-primary flex items-center justify-center font-bold text-[10px] shrink-0">${basHarf(s.danisman_ad)}</span>
        <div class="min-w-0 flex-1">
          <div class="text-label-md text-on-surface truncate" title="${ipucu(s.danisman_ad)}">${BUY(s.danisman_ad) || '—'}</div>
          <div class="text-label-sm text-on-surface-variant truncate" title="${ipucu(s.satis_tipi)}">${BUY(s.satis_tipi) || '—'}</div>
        </div>
      </div></td>
      <td class="px-2 py-3 text-right hidden sm:table-cell"><div class="flex flex-col items-end gap-0.5 min-w-0">
        <span class="text-title-md font-black text-on-surface tabular-nums truncate w-full">${kacis(fmtPara(s.anlasilan_tutar))}</span>
        ${tutarRozet(s)}
      </div></td>
      <td class="px-2 py-3 hidden md:table-cell"><div class="flex flex-col">
        <span class="text-body-md text-on-surface tabular-nums">${kacis(fmtTarihKisa(satisGunu(s)))}</span>
        <span class="text-label-sm text-on-surface-variant">${s.satis_tarihi ? 'noter' : 'onay'}</span>
      </div></td>
      <td class="px-2 py-3 text-right hidden sm:table-cell"><div class="flex items-center justify-end gap-0.5">
        <button data-detay="${kacis(s.id)}" title="Detayı aç" aria-label="Detayı aç" class="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant">${mat('right_panel_open', 'text-[19px]')}</button>
        ${s.siparis_id ? `<button data-dosya="${kacis(s.siparis_id)}" title="Satış dosyasını aç" aria-label="Satış dosyasını aç" class="p-1.5 rounded-lg hover:bg-surface-container-high text-primary">${mat('folder_open', 'text-[19px]')}</button>` : ''}
        ${s.musteri_id ? `<button data-musteri="${kacis(s.musteri_id)}" title="Müşteri kartını aç" aria-label="Müşteri kartını aç" class="p-1.5 rounded-lg hover:bg-surface-container-high text-primary">${mat('person', 'text-[19px]')}</button>` : ''}
        ${wa ? `<a href="${kacis(wa)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp ile yaz" class="p-1.5 rounded-lg hover:bg-surface-container-high text-secondary inline-flex">${mat('chat', 'text-[19px]')}</a>` : ''}
      </div></td>
    </tr>`
}

function cizSecimBar() {
  const el = document.getElementById('smSecimBar')
  if (!el) return
  if (!SECIM.size) { el.innerHTML = ''; return }
  el.innerHTML = `<div class="sticky top-2 z-40 mb-4 bg-primary text-on-primary rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 shadow-lg">
    <span class="font-bold flex items-center gap-2">${mat('check_circle', 'text-[20px]')} ${SECIM.size} kayıt seçildi</span>
    <div class="flex-1"></div>
    <button id="smSecExcel" class="px-4 py-2 rounded-xl bg-on-primary/15 hover:bg-on-primary/25 text-label-md font-bold flex items-center gap-1.5 transition-colors">${mat('file_download', 'text-[18px]')} Excel</button>
    <button id="smSecYazdir" class="px-4 py-2 rounded-xl bg-on-primary/15 hover:bg-on-primary/25 text-label-md font-bold flex items-center gap-1.5 transition-colors">${mat('print', 'text-[18px]')} Yazdır</button>
    <button id="smSecTemizle" class="px-3 py-2 rounded-xl hover:bg-on-primary/15 text-label-md font-bold transition-colors">Seçimi Bırak</button>
  </div>`
  document.getElementById('smSecExcel')?.addEventListener('click', e => excelIndir(true, e.currentTarget))
  document.getElementById('smSecYazdir')?.addEventListener('click', yazdir)
  document.getElementById('smSecTemizle')?.addEventListener('click', () => { SECIM.clear(); cizListe() })
}

// --- Olay bağlama ------------------------------------------------------
// ⚠️ İKİYE BÖLÜNDÜ. ozetYukle() filtre çubuğunu yeniden basıyor ve
//    olaylarını tekrar bağlamak zorunda; ama arama kutusu O DOM'da DEĞİL.
//    Tek bir baglaUst() çağırmak arama kutusuna İKİNCİ bir 'input'
//    dinleyicisi ekler ve her tuşta iki istek gider.
function baglaArama() {
  let zamanlayici
  document.getElementById('smArama')?.addEventListener('input', e => {
    filtre.arama = e.target.value
    clearTimeout(zamanlayici)
    // 320 ms: her tuşta sunucuya gitmemek için. sayfaYukle() damgayla
    // eski isteği düşürdüğü için hızlı yazmada sonuç karışmaz.
    zamanlayici = setTimeout(() => { SAYFA = 0; temizleGoster(); sayfaYukle() }, 320)
  })
}

function baglaFiltre() {
  document.getElementById('smCipler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return
    filtre.donem = b.dataset.f; SAYFA = 0
    document.getElementById('smCipler').innerHTML = cipler(DONEM_CIP, filtre.donem)
    temizleGoster(); sayfaYukle()
  })
  document.getElementById('smKaynakCipler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return
    filtre.kaynak = b.dataset.f; SAYFA = 0; SECIM.clear()
    document.getElementById('smKaynakCipler').innerHTML = cipler(KAYNAK_CIP, filtre.kaynak)
    temizleGoster(); sayfaYukle()
  })
  // Filtre alanı değişince: 1. sayfaya dön, sunucudan yeniden çek.
  // `yeniden` true ise filtre çubuğu da yeniden basılır (marka değişince
  // model listesi değişmeli, aktif rozetler güncellenmeli).
  // ⚠️ HER filtre değişiminde çubuk KOMPLE yeniden basılır. Kısmi
  //    güncelleme denemesi, değişmemiş <select>'lere İKİNCİ dinleyici
  //    ekliyordu (aynı sınıf hata baglaArama notunda anlatılan). Çubuk
  //    küçük, yeniden basmak ucuz; arama kutusu bu DOM'da değil, odak
  //    kaybolmuyor.
  const uygula = () => { SAYFA = 0; filtreYenile(); sayfaYukle() }
  const bagS = (id, alan) => document.getElementById(id)?.addEventListener('change', e => {
    filtre[alan] = e.target.value
    // Marka değişince eski model seçimi geçersiz kalır — temizlenir.
    if (alan === 'marka') filtre.model = ''
    uygula()
  })
  bagS('smDanisman', 'danisman'); bagS('smDanisman2', 'danisman')
  bagS('smMarka', 'marka'); bagS('smModel', 'model')
  bagS('smSatisTipi', 'satisTipi'); bagS('smTeslim', 'teslim'); bagS('smPark', 'park')
  bagS('smMusteriTipi', 'musteriTipi')

  // Sayı/tarih kutuları: 'change' (odak çıkışı / Enter) yeterli — her tuşta
  // sunucuya gitmek gereksiz.
  const bagA = (id, alan) => document.getElementById(id)?.addEventListener('change', e => {
    filtre[alan] = e.target.value.trim(); uygula()
  })
  bagA('smYilMin', 'yilMin'); bagA('smYilMax', 'yilMax')
  bagA('smFiyatMin', 'fiyatMin'); bagA('smFiyatMax', 'fiyatMax')
  bagA('smTarihBas', 'tarihBas'); bagA('smTarihSon', 'tarihSon')

  document.getElementById('smGelismis')?.addEventListener('click', () => {
    GELISMIS_ACIK = !GELISMIS_ACIK
    filtreYenile()
  })

  // Aktif filtre rozetleri — tek tek kaldırma
  document.getElementById('smFiltre')?.querySelectorAll('[data-fkaldir]').forEach(b =>
    b.addEventListener('click', () => {
      filtre[b.dataset.fkaldir] = FILTRE_BOS[b.dataset.fkaldir]
      if (b.dataset.fkaldir === 'marka') filtre.model = ''
      if (b.dataset.fkaldir === 'arama') { const a = document.getElementById('smArama'); if (a) a.value = '' }
      SAYFA = 0; filtreYenile(); sayfaYukle()
    }))
  document.getElementById('smTumunuTemizle')?.addEventListener('click', temizle)
  document.getElementById('smExcel')?.addEventListener('click', e => excelIndir(false, e.currentTarget))
  document.getElementById('smYazdir')?.addEventListener('click', yazdir)
  document.getElementById('smYenile')?.addEventListener('click', yukle)
}

function baglaUst() { baglaArama(); baglaFiltre() }

// Filtre çubuğunu yeniden basar ve olaylarını tekrar bağlar. Arama kutusu
// bu DOM'da DEĞİL — odak korunur (bkz. baglaArama notu).
function filtreYenile() {
  const el = document.getElementById('smFiltre')
  if (!el) return
  el.innerHTML = filtreHtml()
  baglaFiltre()
}

function temizle() {
  Object.assign(filtre, FILTRE_BOS)
  const a = document.getElementById('smArama'); if (a) a.value = ''
  SAYFA = 0
  filtreYenile()
  sayfaYukle()
}

// "Filtreyi Temizle" düğmesi KALDIRILDI — yerini aktif filtre rozetleri
// aldı (her biri tek tek kaldırılabiliyor + "Tümünü temizle").
function temizleGoster() { filtreYenile() }

function baglaListe() {
  const kok = document.getElementById('smListe'); if (!kok) return
  // Tek tık → sağ panel · Çift tık → tam görünüm pop-up (Göksenil).
  //
  // ⚠️ ÖLÇÜLEN HATA (5 Ağu 2026, canlı Chrome): çift tık HİÇ ÇALIŞMIYORDU.
  //    Sebep, tek tıkın açtığı sağ panelin `#smPanelBg` örtüsü:
  //    `fixed inset-0 z-[90]` ile TÜM EKRANI kaplıyor. İlk tık paneli
  //    açtığı an ikinci tık artık satıra değil ÖRTÜYE düşüyor —
  //    dblclick olayı `tr` üzerinde hiç oluşmuyor, üstelik örtüye tıklamak
  //    paneli kapatıyordu. (elementFromPoint ile doğrulandı.)
  //
  //    ÇÖZÜM: paneli KISA BİR SÜRE GECİKTİR. O sürede ikinci tık gelirse
  //    çift tık sayılır, panel hiç açılmaz → örtü de basılmaz → olay
  //    satıra ulaşır. Gelmezse panel açılır. Gecikme 220 ms; panel zaten
  //    veri yüklüyor, kullanıcı bunu hissetmiyor.
  //
  // ⚠️ Mobilde çift tık yine güvenilir değil (tarayıcı yakınlaştırma
  //    jesti sayıyor); oradaki yol sağ paneldeki "Tam Görünüm" düğmesi.
  let tikZaman = null
  kok.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('a,button,input')) return
      if (tikZaman) return                     // ikinci tık — dblclick devralır
      tikZaman = setTimeout(() => { tikZaman = null; panelAc(tr.dataset.id) }, 220)
    })
    tr.addEventListener('dblclick', e => {
      if (e.target.closest('a,button,input')) return
      clearTimeout(tikZaman); tikZaman = null  // panel açılmasın
      tamGorunumAc(tr.dataset.id)
    })
  })
  kok.querySelectorAll('[data-sec]').forEach(c => c.addEventListener('change', e => {
    e.stopPropagation()
    const id = c.dataset.sec
    if (c.checked) SECIM.add(id); else SECIM.delete(id)
    cizListe()
  }))
  document.getElementById('smHepsi')?.addEventListener('change', e => {
    for (const s of SNAP) { if (e.target.checked) SECIM.add(s.id); else SECIM.delete(s.id) }
    cizListe()
  })
  kok.querySelectorAll('[data-detay]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); panelAc(b.dataset.detay) }))
  kok.querySelectorAll('[data-dosya]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation()
    location.href = 'siparis-dosya.html?id=' + encodeURIComponent(b.dataset.dosya)
  }))
  kok.querySelectorAll('[data-musteri]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation()
    location.href = 'musteri-360.html?id=' + encodeURIComponent(b.dataset.musteri)
  }))
  // Sayfa değişimi artık SUNUCUDAN yeni satır çeker.
  const git = n => { SAYFA = n; sayfaYukle(); KOK().scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  document.getElementById('smOnceki')?.addEventListener('click', () => git(Math.max(0, SAYFA - 1)))
  document.getElementById('smSonraki')?.addEventListener('click', () => git(SAYFA + 1))
  document.getElementById('smBoy')?.addEventListener('change', e => {
    SAYFA_BOY = Number(e.target.value) || 50
    SAYFA = 0
    sayfaYukle()
  })
}

// --- Dışa aktarma / yazdırma ------------------------------------------
// ⚠️ Excel LİSTEDEN DEĞİL SUNUCUDAN üretilir. Ekranda yalnız bir sayfa
//    var; ekrandakini yazmak "8.031 satışı dışa aktardım" sanısıyla 50
//    satırlık dosya verirdi. Seçim varsa yalnız seçili satırlar (onlar
//    zaten görünen sayfada), yoksa FİLTREYE UYAN HEPSİ indirilir.
async function excelIndir(yalnizSecili, dugme) {
  const eskiHtml = dugme?.innerHTML
  if (dugme) { dugme.disabled = true; dugme.innerHTML = mat('hourglass_top', 'animate-pulse') }
  let kaynak = []
  try {
    if (yalnizSecili) {
      kaynak = SNAP.filter(s => SECIM.has(s.id))
    } else {
      // Sayfa sayfa çek — PostgREST tek istekte 1.000 satır sınırlı (§5.3).
      for (let bas = 0; bas < AZAMI_SATIR; bas += 1000) {
        const { data, error } = await sorguKur(LISTE_KOLON, false).range(bas, bas + 999)
        if (error) { dbHata('Excel liste', error); break }
        kaynak.push(...(data || []))
        if (!data || data.length < 1000) break
      }
    }
    if (kaynak.length) await agirTopluYukle(kaynak)
  } finally {
    if (dugme) { dugme.disabled = false; dugme.innerHTML = eskiHtml }
  }
  if (!kaynak.length) return
  // Kolon sırası Göksenil'in istediği rapor düzeni (3 Ağu 2026):
  //   ALIŞ tarafı → SATIŞ tarafı → kâr. Arşiv dışı satırlarda alış alanları
  //   boş kalır (satis_snapshot alış maliyetini taşımıyor).
  const bas = ['Kaynak', 'Kayit No', 'Plaka', 'Sasi', 'Marka', 'Model', 'Versiyon', 'Yil',
    'Alis Sekli', 'Alis Fiyati', 'Masraf', 'Maliyet', 'Noter Tarihi Alis', 'Alis Musteri TC',
    'Satici', 'Alis Sorumlusu', 'Alis KM',
    'Satis Fiyati', 'Anlasilan', 'Noter Satis Tutari', 'Noter Satis Tarihi',
    'Satis Musterisi', 'Satis Musteri TC', 'Telefon', 'Musteri Tipi', 'Satis KM', 'Satis Sekli',
    'Kar/Zarar', 'Kar/Zarar %',
    'Danisman', 'Noter', 'Yevmiye', 'Yeni Plaka', 'Park',
    'Tahsilat Toplam', 'Iade Toplam', 'Resmi Tahsilat', 'Resmi Fark', 'Kalan Bakiye',
    'Teslim Durumu', 'Teslim Tarihi']
  const satirlar = kaynak.map(s => [
    arsivMi(s) ? 'Arşiv (GURU)' : 'Güncel', kayitNo(s), s.plaka, s.sasi_no,
    s.marka, s.model, s.versiyon, s.yil,
    s.alis_sekli, s.alis_fiyati, s.masraf, s.maliyet,
    s.alis_tarihi ? fmtTarihKisa(s.alis_tarihi) : '', s.satici_kimlik,
    s.satici_ad, s.alis_sorumlusu, s.alis_km,
    s.liste_fiyati, s.anlasilan_tutar, s.noter_satis_tutari,
    s.satis_tarihi ? fmtTarihKisa(s.satis_tarihi) : '',
    s.musteri_ad_soyad, s.alici_kimlik, s.musteri_telefon, musteriTipEtiket(s.musteri_tipi),
    s.km, s.satis_tipi,
    s.kar_zarar, s.kar_zarar_yuzde,
    s.danisman_ad, s.noter_adi, s.yevmiye_no, s.yeni_plaka, s.park,
    s.tahsilat_toplam, s.iade_toplam, s.resmi_tahsilat, s.resmi_fark, s.kalan_bakiye,
    arsivMi(s) ? '' : (s.teslim_durumu === 'TESLIM_EDILDI' ? 'Teslim Edildi' : 'Teslim Bekliyor'),
    s.teslim_tarihi && !arsivMi(s) ? fmtTarihKisa(s.teslim_tarihi) : '',
  ])
  // ⚠️ Maliyet/kâr kolonları yalnız yöneticide. Değerleri boşaltmak yerine
  //    KOLONU KOMPLE ÇIKARIYORUZ: başlığı duran boş bir "Kâr/Zarar" kolonu
  //    "veri yok" sanılır, oysa veri var ama yetki yok.
  const KAR_KOLONLARI = new Set(['Alis Fiyati', 'Masraf', 'Maliyet', 'Kar/Zarar', 'Kar/Zarar %'])
  if (!karGorur(BEN)) {
    const tut = bas.map((b, i) => (KAR_KOLONLARI.has(b) ? -1 : i)).filter(i => i >= 0)
    csvIndir('satis-merkezi', tut.map(i => bas[i]), satirlar.map(r => tut.map(i => r[i])))
    return
  }
  csvIndir('satis-merkezi', bas, satirlar)
}

// Seçim varsa yalnız seçili satırlar yazdırılır; sonra görünüm geri alınır.
function yazdir() {
  const trler = [...document.querySelectorAll('#smTablo tbody tr[data-id]')]
  const gizlenen = SECIM.size ? trler.filter(tr => !SECIM.has(tr.dataset.id)) : []
  gizlenen.forEach(tr => tr.classList.add('hidden'))
  const geri = () => { gizlenen.forEach(tr => tr.classList.remove('hidden')); window.removeEventListener('afterprint', geri) }
  window.addEventListener('afterprint', geri)
  window.print()
  setTimeout(geri, 1500)   // afterprint desteklemeyen tarayıcılar için güvenlik ağı
}

// =====================================================================
// DETAY PANELİ
//   Snapshot alanları DONMUŞ gösterilir. Sekmelerdeki ek veri (fotoğraf,
//   cari hareket, evrak, not, olay) CANLI okunur — bunlar snapshot'ta yok.
// =====================================================================
async function panelAc(id) {
  const s = SNAP.find(x => x.id === id)
  if (!s) { console.error('[satis] panelAc: kayıt bulunamadı', id); return }
  PANEL_ID = id
  PANEL_SEKME = 'ozet'

  const bas = document.getElementById('smPanelBaslikMetin')
  if (bas) bas.innerHTML = plakaHtml(s)
  document.getElementById('smPanelUst').innerHTML = `<div class="px-5 py-3 border-b border-outline-variant flex items-center gap-2">${durumHtml(s)}${tutarRozet(s)}</div>`
  document.getElementById('smPanelGovde').innerHTML = `<div class="py-16 text-center text-on-surface-variant text-body-md">Detay yükleniyor…</div>`

  // Arşivin sipariş dosyası yok; onun yerine (varsa) müşteri kartına gidilir.
  const alt = s.siparis_id
    ? `<button data-panel-dosya="${kacis(s.siparis_id)}" class="w-full h-11 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('folder_open', 'text-[18px]')} Satış Dosyasını Aç</button>`
    : s.musteri_id
      ? `<button data-panel-musteri="${kacis(s.musteri_id)}" class="w-full h-11 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('person', 'text-[18px]')} Müşteri Kartını Aç</button>`
      : `<p class="text-center text-label-md text-on-surface-variant">Bu arşiv kaydı bir CRM müşterisine bağlanamadı.</p>`
  // ⚠️ "Tam Görünüm" düğmesi MOBİLİN TEK YOLU: çift tık orada güvenilir
  //    değil (tarayıcı yakınlaştırma jesti sayıyor). Masaüstünde de duruyor,
  //    çünkü çift tıkın bir şey yaptığı hiçbir yerde yazmıyor.
  const tamBtn = `<button data-panel-tam="${kacis(id)}" class="w-full h-11 mb-2 rounded-lg border border-primary text-primary text-sm font-bold hover:bg-primary/5 flex items-center justify-center gap-1.5">${mat('open_in_full', 'text-[18px]')} Tam Görünüm</button>`
  document.getElementById('smPanelAlt').innerHTML = `<div class="p-4 border-t border-outline-variant">${tamBtn}${alt}</div>`
  document.querySelector('[data-panel-tam]')?.addEventListener('click', e =>
    tamGorunumAc(e.currentTarget.dataset.panelTam))
  document.querySelector('[data-panel-dosya]')?.addEventListener('click', e => {
    location.href = 'siparis-dosya.html?id=' + encodeURIComponent(e.currentTarget.dataset.panelDosya)
  })
  document.querySelector('[data-panel-musteri]')?.addEventListener('click', e => {
    location.href = 'musteri-360.html?id=' + encodeURIComponent(e.currentTarget.dataset.panelMusteri)
  })
  yanPanelAc('smPanel')

  // Ağır alanlar listede yok (yukarıdaki KOLON BÖLÜNMESİ notu) — panel
  // açılırken getirilir. Sekme çubuğu ve özet bunlara bağlı olduğu için
  // içerik çizilmeden ÖNCE beklenir.
  await Promise.all([agirYukle(s), panelVeriYukle(s)])
  if (PANEL_ID === id) panelIcerikCiz()
}

// Tam görünüm pop-up: liste satırından çift tıkla ya da panelden düğmeyle.
// Ağır alanlar + panel verisi panelAc ile AYNI yollardan gelir; ikinci bir
// yükleyici yazılmadı (önbellek de ortak).
async function tamGorunumAc(id) {
  const s = SNAP.find(x => x.id === id)
  if (!s) { console.error('[satis] tam görünüm: kayıt bulunamadı', id); return }
  await Promise.all([agirYukle(s), panelVeriYukle(s)])
  const v = PANEL_ONBELLEK.get(s.id) || BOS_PANEL
  const kapak = v.fotolar?.[0]?.dosya_yolu || s.kapak_foto
  satisKayitAc(s, v, {
    ben: BEN,
    arsiv: arsivMi(s),
    kapakUrl: kapak ? fotoUrl(kapak) : '',
    dmap: DMAP,
    katalogAd,
    // ⚠️ Alt panelleri pencere KENDİ çizer (tasarım tablo/kart/balon düzeni
    //    istiyor, sağ paneldekiler dar liste düzeninde). Buradan yalnız
    //    ORTAK yardımcılar geçirilir — şema yükleme/ayrıştırma ve evrak
    //    açma kopyalanmaz. Ters import DÖNGÜ olurdu.
    parcalar: { panelAyristir, semaYukle, evrakAc },
  })
}

async function panelVeriYukle(s) {
  if (PANEL_ONBELLEK.has(s.id)) return

  // ARŞİV: canlı tabloların hiçbirinde karşılığı yok (sipariş/olay/not/evrak
  // GURU'da kalmıştı). Tek canlı veri arşiv cari hareketleri — o okunur.
  if (arsivMi(s)) {
    const { data, error } = await supabase.from('arsiv_cari')
      .select('id, borc, alacak, hareket, hareket_tipi, kasa, aciklama, odeme_tarihi, musteri_id, musteri_unvan, bagi_cikarim, sapma')
      .eq('arsiv_satis_id', s.id)
      .order('odeme_tarihi', { ascending: false, nullsFirst: false })
    dbHata('arşiv satış — cari hareketler', error)
    PANEL_ONBELLEK.set(s.id, {
      fotolar: [], hareketler: [], evraklar: [], notlar: [], rezNot: null, olaylar: [],
      arsivCari: data || [],
    })
    return
  }

  const aracId = s.arac_id, sipId = s.siparis_id
  const [fotoR, hareketR, evrakR, notR, sipR, olayR] = await Promise.all([
    aracId ? supabase.from('arac_fotograflari').select('id, dosya_yolu, sira').eq('arac_id', aracId).order('sira').order('created_at') : Promise.resolve({ data: [], error: null }),
    sipId ? supabase.from('cari_hareketler').select('id, tip, alt_tip, tutar, tarih, aciklama, banka, created_at').eq('siparis_id', sipId).order('tarih', { ascending: false }).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    aracId ? supabase.from('arac_evraklar').select('id, tip, url, created_at').eq('arac_id', aracId).order('created_at') : Promise.resolve({ data: [], error: null }),
    aracId ? supabase.from('arac_notlari').select('id, icerik, danisman_id, created_at').eq('arac_id', aracId).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    sipId ? supabase.from('siparisler').select('rezervasyon_notu').eq('id', sipId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sipId ? supabase.from('olaylar').select('id, tip, veri, danisman_id, olusma_zamani').eq('siparis_id', sipId).order('olusma_zamani', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ])
  dbHata('satış detayı — fotoğraflar', fotoR.error)
  dbHata('satış detayı — cari hareketler', hareketR.error)
  dbHata('satış detayı — evraklar', evrakR.error)
  dbHata('satış detayı — notlar', notR.error)
  dbHata('satış detayı — sipariş notu', sipR.error)
  dbHata('satış detayı — olaylar', olayR.error)

  PANEL_ONBELLEK.set(s.id, {
    fotolar: fotoR.data || [],
    hareketler: hareketR.data || [],
    evraklar: evrakR.data || [],
    notlar: notR.data || [],
    rezNot: sipR.data?.rezervasyon_notu || null,
    olaylar: olayR.data || [],
    arsivCari: [],
  })
}

const BOS_PANEL = { fotolar: [], hareketler: [], evraklar: [], notlar: [], rezNot: null, olaylar: [], arsivCari: [] }

function panelIcerikCiz() {
  if (!PANEL_ID) return
  const s = SNAP.find(x => x.id === PANEL_ID); if (!s) return
  const v = PANEL_ONBELLEK.get(PANEL_ID) || BOS_PANEL
  const arsiv = arsivMi(s)

  // Arşivde canlı sekmelerin karşılığı yok — boş sekme göstermek yerine
  // hiç basılmaz. Kapak fotoğrafı arşivde tek karedir (NAS'ta kalanlar için
  // Özet sekmesinde klasör yolu yazar).
  const sekmeler = arsiv
    ? [['ozet', 'Özet', 'summarize'], ['tahsilat', 'Cari Hareketler', 'payments', v.arsivCari.length || '']]
    : [['ozet', 'Özet', 'summarize'],
       ['tahsilat', 'Tahsilatlar', 'payments', v.hareketler.length || ''],
       ['evrak', 'Evraklar', 'description', v.evraklar.length || ''],
       ['not', 'Notlar', 'sticky_note_2', (v.notlar.length + (v.rezNot ? 1 : 0)) || ''],
       ['zaman', 'Zaman', 'history', v.olaylar.length || '']]
  if (!sekmeler.some(t => t[0] === PANEL_SEKME)) PANEL_SEKME = 'ozet'

  // Galeri: tüm fotoğraflar, yatay kaydırmalı
  const ust = document.getElementById('smPanelUst')
  if (ust) {
    const kareler = arsiv
      ? (s.kapak_foto ? [s.kapak_foto] : [])
      : v.fotolar.map(f => f.dosya_yolu)
    const galeri = kareler.length
      ? `<div class="flex gap-2 overflow-x-auto px-5 py-3 border-b border-outline-variant">${kareler.map(y =>
          `<a href="${kacis(fotoUrl(y))}" target="_blank" rel="noopener" class="shrink-0 w-40 h-28 rounded-xl overflow-hidden border border-outline-variant bg-surface block">
            <img src="${kacis(fotoUrl(y))}" alt="Araç fotoğrafı" loading="lazy" class="w-full h-full object-cover" /></a>`).join('')}</div>`
      : ''
    ust.innerHTML = `<div class="px-5 py-3 border-b border-outline-variant flex flex-wrap items-center gap-2">${durumHtml(s)}${tutarRozet(s)}
        <span class="text-label-sm text-on-surface-variant ml-auto tabular-nums">${kacis(kayitNo(s))}</span></div>${galeri}
      ${sekmeBar(sekmeler, PANEL_SEKME)}`
  }

  const govde = document.getElementById('smPanelGovde')
  if (!govde) return
  govde.innerHTML = PANEL_SEKME === 'ozet' ? (arsiv ? sekmeArsivOzet(s) : sekmeOzet(s))
    : PANEL_SEKME === 'tahsilat' ? (arsiv ? sekmeArsivCari(v.arsivCari, s) : sekmeTahsilat(v.hareketler))
    : PANEL_SEKME === 'evrak' ? sekmeEvrak(v.evraklar)
    : PANEL_SEKME === 'not' ? sekmeNot(v.notlar, v.rezNot)
    : sekmeZaman(v.olaylar)

  govde.querySelectorAll('[data-evrak]').forEach(b => b.addEventListener('click', () => evrakAc(b.dataset.evrak)))
  // Şema innerHTML'den SONRA boyanır (svgBoya gerçek DOM düğümü ister).
  if (PANEL_SEKME === 'ozet') ekspertizCiz(govde, s)
}

const satirBilgi = (etiket, deger) => `<div class="flex items-start justify-between gap-3 py-2 border-b border-outline-variant/50 last:border-0">
  <span class="text-label-sm text-on-surface-variant uppercase tracking-wide shrink-0">${kacis(etiket)}</span>
  <span class="text-body-md font-semibold text-on-surface text-right min-w-0 break-words">${deger}</span></div>`
const blok = (baslik, ikon, icerik) => `<div class="px-5 py-4 border-b border-outline-variant last:border-0">
  <h4 class="text-label-sm text-primary font-bold uppercase tracking-wide flex items-center gap-1.5 mb-2">${mat(ikon, 'text-[16px]')}${kacis(baslik)}</h4>
  ${icerik}</div>`

function sekmeOzet(s) {
  const wa = waHref(s.musteri_telefon)
  return `
    ${blok('Müşteri', 'person', [
      satirBilgi('Ad Soyad', BUY(s.musteri_ad_soyad) || '—'),
      satirBilgi('Telefon', s.musteri_telefon
        ? `<a href="tel:${kacis(telNo(s.musteri_telefon))}" class="text-primary tabular-nums">${kacis(telBicim(s.musteri_telefon))}</a>${wa ? ` <a href="${kacis(wa)}" target="_blank" rel="noopener" class="text-secondary ml-1" aria-label="WhatsApp">${mat('chat', 'text-[16px]')}</a>` : ''}`
        : '—'),
      satirBilgi('Müşteri Tipi', kacis(musteriTipEtiket(s.musteri_tipi))),
    ].join(''))}

    ${blok('Araç', 'directions_car', [
      satirBilgi('Araç', [s.yil, BUY(s.marka), BUY(s.model)].filter(Boolean).join(' ') + (s.versiyon ? ' ' + BUY(s.versiyon) : '')),
      satirBilgi('Plaka', plakaHtml(s)),
      satirBilgi('Şasi No', BUY(s.sasi_no) || '—'),
      satirBilgi('Yakıt / Vites', [s.yakit, s.vites].filter(Boolean).map(v => BUY(v)).join(' · ') || '—'),
      satirBilgi('Renk / Kasa', [s.renk, s.kasa_tipi].filter(Boolean).map(v => BUY(v)).join(' · ') || '—'),
      satirBilgi('KM', s.km != null ? kacis(Number(s.km).toLocaleString('tr-TR')) : '—'),
      satirBilgi('Park', BUY(s.park) || '—'),
      satirBilgi('Yeni Ruhsat Seri No', BUY(s.yeni_ruhsat_seri_no) || '—'),
      satirBilgi('Yedek Anahtar', s.yedek_anahtar == null ? '—'
        : s.yedek_anahtar ? `<span class="text-secondary font-bold">Var</span>` : `<span class="text-on-surface-variant">Yok</span>`),
      s.arac_id ? satirBilgi('Araç Kartı', `<a href="arac-kart.html?id=${encodeURIComponent(s.arac_id)}" class="text-primary font-bold">Aç</a>`) : '',
    ].join(''))}

    ${ekspertizBloku(s)}

    ${blok('Satış / Noter', 'gavel', [
      // ⚠️ satis_tarihi boşsa onay_zamani'na düşüyoruz (arşiv kayıtlarında
      //    noter tarihi hiç yok). Düştüğümüzü SÖYLEMEZSEK kullanıcı onay
      //    saatini noter tarihi sanır — 19 Ağu'da tam bu oldu: bu panel
      //    tarih gösterirken satış penceresi "—" diyordu, ikisi aynı
      //    dosyaydı. Aynı yardımcı + aynı işaret iki ekranda da kullanılıyor.
      satirBilgi('Satış Tarihi', kacis(fmtTarihKisa(satisGunu(s))) + (s.satis_tarihi ? '' : TURETILMIS_NOT)),
      satirBilgi('Satış Tipi', BUY(s.satis_tipi) || '—'),
      satirBilgi('Noter', BUY(s.noter_adi) || '—'),
      satirBilgi('Yevmiye No', BUY(s.yevmiye_no) || '—'),
      satirBilgi('Danışman', BUY(s.danisman_ad) || '—'),
      satirBilgi('Teslim Tarihi', s.teslim_tarihi ? kacis(fmtTarihKisa(s.teslim_tarihi)) : '—'),
      satirBilgi('Onay Zamanı', kacis(fmtTarih(s.onay_zamani))),
    ].join(''))}

    ${blok('Finansal (satış anında donduruldu)', 'account_balance', [
      satirBilgi('Anlaşılan Tutar', `<span class="text-headline-sm font-black text-primary">${kacis(fmtPara(s.anlasilan_tutar))}</span>`),
      satirBilgi('Liste Fiyatı', kacis(fmtPara(s.liste_fiyati))),
      satirBilgi('Noter Satış Tutarı', kacis(fmtPara(s.noter_satis_tutari))),
      satirBilgi('Tahsilat Toplamı', kacis(fmtPara(s.tahsilat_toplam))),
      satirBilgi('İade Toplamı', kacis(fmtPara(s.iade_toplam))),
      satirBilgi('Resmî Tahsilat', kacis(fmtPara(s.resmi_tahsilat))),
      satirBilgi('Resmî Fark', `<span class="${(Number(s.resmi_fark) || 0) < 0 ? 'text-error' : 'text-on-surface'}">${kacis(fmtPara(s.resmi_fark))}</span>`),
      satirBilgi('Kalan Bakiye', bakiyeRozet(s)),
    ].join(''))}
    <p class="px-5 py-3 text-label-sm text-on-surface-variant">Bu tutarlar satış onayı anında dondurulmuştur; sonradan yapılan cari düzeltmelerden etkilenmez.</p>`
}

// --- Ekspertiz şeması + tramer ----------------------------------------
// Şema bir kez indirilir (stok.js deseni). Kaynak: img/ekspertiz-sema.svg,
// 13 data-part. Boyama ekspertiz.js/svgBoya ile — burada renk TÜRETİLMEZ.
let EKSP_SVG = ''
async function semaYukle() {
  if (EKSP_SVG) return EKSP_SVG
  try {
    EKSP_SVG = await fetch('img/ekspertiz-sema.svg').then(r => r.ok ? r.text() : '')
  } catch (e) { console.error('[satis] ekspertiz şeması indirilemedi', e); EKSP_SVG = '' }
  return EKSP_SVG
}

// Görünüm (sql/139) iki kaynağı da [{parca, durum}] biçimine getiriyor.
// Şemada karşılığı OLMAYANLAR (Ön/Arka Tampon) ve boya durumu olmayan
// hasarlar (Plastik/Ezik/Vuruk/Çizik) sessizce düşmez — ayrı listelenir.
function panelAyristir(liste) {
  const semada = {}, disarida = []
  for (const p of (liste || [])) {
    if (!p?.parca) continue
    if (PARCALAR.includes(p.parca) && RENK[p.durum]) semada[p.parca] = p.durum
    else disarida.push(p)
  }
  return { semada, disarida }
}

function ekspertizBloku(s) {
  const { semada, disarida } = panelAyristir(s.ekspertiz_paneller)
  const sayi = Object.keys(semada).length
  const tramerVar = s.hasar_adedi != null || s.hasar_tutari != null
  if (!sayi && !disarida.length && !tramerVar) return ''

  const efsane = ['BOYALI', 'LOKAL BOYA', 'DEGISEN']
    .filter(d => Object.values(semada).includes(d))
    .map(d => `<span class="inline-flex items-center gap-1 text-label-sm">
        <span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:${RENK[d]}"></span>${kacis(DURUM_ETIKET[d])}</span>`).join('')

  const sema = sayi
    ? `<div data-eksp-svg class="bg-surface-container-low rounded-xl p-2 [&_svg]:w-full [&_svg]:h-auto"></div>
       <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-on-surface-variant">
         <span class="text-label-sm">${sayi} parça işaretli</span>${efsane}</div>`
    : `<p class="text-label-md text-on-surface-variant">Şemaya işlenebilen ekspertiz kaydı yok.</p>`

  const dis = disarida.length
    ? `<div class="mt-2 pt-2 border-t border-outline-variant/50">
         <p class="text-label-sm text-on-surface-variant mb-1">Şemada gösterilemeyen kayıtlar:</p>
         <div class="flex flex-wrap gap-1">${disarida.map(p =>
           `<span class="text-label-sm bg-surface-container-high px-2 py-0.5 rounded-full">${BUY(p.parca)} · ${kacis(p.durum)}</span>`).join('')}</div></div>`
    : ''

  // Tramer: 0 hasar "sorgulandı, kayıt yok" demek — boş bırakmak yanıltıcı olur.
  const tramer = tramerVar
    ? `<div class="mt-3 pt-3 border-t border-outline-variant/50">
        ${satirBilgi('Tramer Hasar Adedi', s.hasar_adedi == null ? '—'
          : s.hasar_adedi === 0 ? '<span class="text-secondary font-bold">Kayıt yok</span>'
          : `<span class="text-error font-black">${kacis(String(s.hasar_adedi))}</span> adet`)}
        ${satirBilgi('Tramer Hasar Tutarı', s.hasar_tutari == null ? '—'
          : `<span class="${Number(s.hasar_tutari) > 0 ? 'text-error' : ''}">${kacis(fmtPara(s.hasar_tutari))}</span>`)}
       </div>`
    : `<p class="mt-3 pt-3 border-t border-outline-variant/50 text-label-sm text-on-surface-variant">Tramer sorgusu kaydı yok.</p>`

  return blok('Ekspertiz / Tramer', 'car_crash', sema + dis + tramer)
}

// innerHTML basıldıktan SONRA çağrılır: şema indirilip svgBoya ile boyanır.
async function ekspertizCiz(kap, s) {
  const yer = kap?.querySelector('[data-eksp-svg]')
  if (!yer) return
  const svgMetin = await semaYukle()
  if (!svgMetin) { yer.innerHTML = `<p class="text-center text-label-md text-on-surface-variant py-4">Ekspertiz şeması yüklenemedi.</p>`; return }
  yer.innerHTML = svgMetin
  const svg = yer.querySelector('svg')
  if (svg) svgBoya(svg, panelAyristir(s.ekspertiz_paneller).semada)
}

// --- ARŞİV (GURU) özet sekmesi ---------------------------------------
// Alış → Satış → Kâr sıralaması Göksenil'in rapor düzeni. Boş alanlar
// GURU'da da boştu; uydurulmaz, "—" basılır.
function sekmeArsivOzet(s) {
  const km = v => v != null && v !== '' ? kacis(Number(v).toLocaleString('tr-TR')) + ' km' : '—'
  const kimlik = v => v ? `<span class="tabular-nums">${kacis(v)}</span>` : '—'
  const wa = waHref(s.musteri_telefon)
  return `
    <div class="px-5 py-3 bg-surface-container-high/50 border-b border-outline-variant flex items-start gap-2">
      ${mat('inventory_2', 'text-[18px] text-on-surface-variant shrink-0 mt-0.5')}
      <p class="text-label-md text-on-surface-variant">Bu kayıt <b class="text-on-surface">GURU arşivinden</b> aktarıldı
      (2018-2025). Salt okunurdur; sipariş dosyası, evrak ve olay geçmişi eski sistemde kalmıştır.</p>
    </div>

    ${blok('Araç', 'directions_car', [
      satirBilgi('Araç', [s.yil, BUY(s.marka), BUY(s.model)].filter(Boolean).join(' ') + (s.versiyon ? ' ' + BUY(s.versiyon) : '')),
      satirBilgi('Plaka', plakaHtml(s)),
      satirBilgi('Şasi No', BUY(s.sasi_no) || '—'),
      satirBilgi('Yakıt / Vites', [s.yakit, s.vites].filter(Boolean).map(v => BUY(v)).join(' · ') || '—'),
      satirBilgi('Renk / Kasa', [s.renk, s.kasa_tipi].filter(Boolean).map(v => BUY(v)).join(' · ') || '—'),
      satirBilgi('Yedek Anahtar', s.yedek_anahtar == null ? '—'
        : s.yedek_anahtar
          ? `<span class="text-secondary font-bold">Var</span>`
          : `<span class="text-on-surface-variant">Yok</span>`),
    ].join(''))}

    ${ekspertizBloku(s)}

    ${blok('Alış', 'call_received', [
      satirBilgi('Alış Şekli', BUY(s.alis_sekli) || '—'),
      satirBilgi('Alış Tarihi', s.alis_tarihi ? kacis(fmtTarihKisa(s.alis_tarihi)) : '—'),
      // Maliyet zinciri yalnız yöneticide (veri.js karGorur).
      karGorur(BEN) ? satirBilgi('Alış Fiyatı', kacis(fmtPara(s.alis_fiyati))) : '',
      karGorur(BEN) ? satirBilgi('Masraf', kacis(fmtPara(s.masraf))) : '',
      karGorur(BEN) ? satirBilgi('Maliyet', `<span class="font-black">${kacis(fmtPara(s.maliyet))}</span>`) : '',
      satirBilgi('Alış KM', km(s.alis_km)),
      satirBilgi('Satıcı', BUY(s.satici_ad) || '—'),
      satirBilgi('Satıcı TC / VKN', kimlik(s.satici_kimlik)),
      satirBilgi('Alış Noteri', BUY(s.alis_noter) || '—'),
      satirBilgi('Alış Sorumlusu', BUY(s.alis_sorumlusu) || '—'),
    ].join(''))}

    ${blok('Satış', 'call_made', [
      satirBilgi('Noter Satış Tarihi', s.satis_tarihi ? kacis(fmtTarihKisa(s.satis_tarihi)) : '—'),
      satirBilgi('Satış Şekli', BUY(s.satis_tipi) || '—'),
      satirBilgi('Satış Fiyatı (liste)', kacis(fmtPara(s.liste_fiyati))),
      satirBilgi('Anlaşılan', `<span class="text-headline-sm font-black text-primary">${kacis(fmtPara(s.anlasilan_tutar))}</span>`),
      satirBilgi('Noter Satış Bedeli', kacis(fmtPara(s.noter_satis_tutari))),
      satirBilgi('Satış KM', km(s.km)),
      satirBilgi('Satış Noteri', BUY(s.noter_adi) || '—'),
      satirBilgi('Satış Sorumlusu', BUY(s.danisman_ad) || '—'),
    ].join(''))}

    ${blok('Alıcı', 'person', [
      satirBilgi('Ad Soyad / Unvan', BUY(s.musteri_ad_soyad) || '—'),
      satirBilgi('TC / VKN', kimlik(s.alici_kimlik)),
      satirBilgi('Telefon', s.musteri_telefon
        ? `<a href="tel:${kacis(telNo(s.musteri_telefon))}" class="text-primary tabular-nums">${kacis(telBicim(s.musteri_telefon))}</a>${wa ? ` <a href="${kacis(wa)}" target="_blank" rel="noopener" class="text-secondary ml-1" aria-label="WhatsApp">${mat('chat', 'text-[16px]')}</a>` : ''}`
        : '—'),
      s.musteri_id
        ? satirBilgi('CRM Müşterisi', `<a href="musteri-360.html?id=${encodeURIComponent(s.musteri_id)}" class="text-primary font-bold">Kartı Aç</a>`)
        : satirBilgi('CRM Müşterisi', '<span class="text-on-surface-variant font-normal">eşleşmedi</span>'),
    ].join(''))}

    ${blok('Kâr / Zarar', 'trending_up', [
      satirBilgi('Kâr / Zarar', karRozet(s)),
      satirBilgi('Toplam Tahsilat', kacis(fmtPara(s.tahsilat_toplam))),
    ].join(''))}

    ${s.nas_klasor ? `<div class="px-5 py-4 border-t border-outline-variant">
      <h4 class="text-label-sm text-primary font-bold uppercase tracking-wide flex items-center gap-1.5 mb-1">${mat('folder', 'text-[16px]')}Fotoğraf Arşivi (NAS)</h4>
      <p class="text-body-md text-on-surface break-all">${kacis(s.nas_klasor)}</p>
      <p class="text-label-sm text-on-surface-variant mt-1">${s.foto_adet ? kacis(String(s.foto_adet)) + ' fotoğraf' : 'Fotoğraflar'} NAS'ta durur; CRM'e yalnız kapak karesi taşındı.</p>
    </div>` : ''}`
}

// Bir arşiv cari satırı. Başlık `kasa`dan gelir: `hareket_tipi` 42.156
// satırın HEPSİNDE "Kasa", `hareket` yalnız A/B yön kodu — ikisi de etiket
// olarak değersiz (ölçüldü).
function arsivCariSatir(h, sahibiYaz) {
  const tutar = Number(h.alacak) || 0 ? Number(h.alacak) : -(Number(h.borc) || 0)
  const gelen = tutar > 0
  const alt = [h.odeme_tarihi ? fmtTarihKisa(h.odeme_tarihi) : '—',
    sahibiYaz && h.musteri_unvan ? h.musteri_unvan : null,
    h.kasa && h.aciklama ? h.aciklama : null].filter(Boolean).map(v => kacis(v)).join(' · ')
  return `<div class="px-5 py-3 flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="font-bold text-body-md text-on-surface truncate">${BUY(h.kasa || h.aciklama) || 'Kasa hareketi'}
        ${h.bagi_cikarim ? `<span class="text-[9px] font-black bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded-full tracking-wide align-middle" title="Bu hareket açıklamasında plaka geçmiyordu; müşteri ve tarih üzerinden bu satışa bağlandı.">ÇIKARIM</span>` : ''}
        ${h.sapma ? `<span class="text-[9px] font-black bg-error-container text-on-error-container px-1.5 py-0.5 rounded-full tracking-wide align-middle" title="Tutar ölçek olarak absürt (eski sistem giriş hatası). Değer değiştirilmedi ama toplamlara katılmıyor.">SAPMA</span>` : ''}</div>
      <div class="text-label-sm text-on-surface-variant tabular-nums break-words">${alt}</div>
    </div>
    <span class="font-black tabular-nums shrink-0 ${gelen ? 'text-secondary' : 'text-on-surface-variant'}">${gelen ? '' : '−'}${kacis(fmtPara(Math.abs(tutar)))}</span>
  </div>`
}

// ⚠️ TOPLAMLAR YALNIZ ALICININ SATIRLARINDAN. Bir satışa bağlı cari
//    satırların hepsi alıcıya ait değil: plaka açıklamada geçtiği için ALIŞ
//    tarafı (takası veren kişi) ve üçüncü kişi hareketleri de bağlanmıştı.
//    Ölçüm: 16.357 bağlı satırın 793'ü satıcının, 2.328'i üçüncü kişinin.
//    34Y0402'de takasın 112.000 ₺'si tahsilat sanılıp fark eksiye düşüyordu.
function sekmeArsivCari(hareketler, s) {
  if (!hareketler.length) return `<div class="p-5">${bosDurum('Bu satışa bağlanabilen arşiv cari hareketi yok.', 'payments')}</div>`
  const alici = hareketler.filter(h => h.musteri_id && h.musteri_id === s.musteri_id)
  const diger = hareketler.filter(h => !alici.includes(h))
  // Ölçek sapması olan satırlar (sql/144) listede görünür ama TOPLANMAZ.
  let borc = 0, alacak = 0
  for (const h of alici) { if (h.sapma) continue; borc += Number(h.borc) || 0; alacak += Number(h.alacak) || 0 }
  const fark = borc - alacak
  const sapmali = hareketler.filter(h => h.sapma).length

  const ozet = alici.length
    ? `<div class="px-5 py-3 bg-surface-container-low/60 border-b border-outline-variant">
        <div class="flex flex-wrap gap-x-6 gap-y-1 text-label-md">
          <span>Borç <b class="tabular-nums">${kacis(fmtPara(borc))}</b></span>
          <span>Tahsilat <b class="tabular-nums text-secondary">${kacis(fmtPara(alacak))}</b></span>
          <span class="ml-auto">Fark <b class="tabular-nums ${Math.abs(fark) < 0.005 ? '' : 'text-error'}">${kacis(fmtPara(fark))}</b></span>
        </div>
        ${Math.abs(fark) >= 0.005 ? `<p class="text-label-sm text-on-surface-variant mt-1.5">
          ⚠️ Eski sistemden aktarıldı; bazı tahsilatlar bu satışa bağlanamamış olabilir.
          Kesin durum için müşterinin tam cari geçmişine bakın.</p>` : ''}
        ${sapmali ? `<p class="text-label-sm text-on-error-container mt-1.5">
          ⚠️ ${kacis(String(sapmali))} hareketin tutarı ölçek olarak absürt (eski sistem giriş hatası).
          Değerler değiştirilmedi ama yukarıdaki toplamlara katılmadı.</p>` : ''}
       </div>` : ''

  const digerBlok = diger.length
    ? `<div class="px-5 py-2 bg-surface-container-high/40 border-y border-outline-variant">
         <p class="text-label-sm text-on-surface-variant">Bu araçla ilgili <b>diğer taraf</b> hareketleri (alış / üçüncü kişi) — alıcının hesabına <b>dahil değil</b>:</p>
       </div>
       <div class="divide-y divide-outline-variant/50 opacity-75">${diger.map(h => arsivCariSatir(h, true)).join('')}</div>`
    : ''

  return ozet
    + (alici.length
        ? `<div class="divide-y divide-outline-variant/50">${alici.map(h => arsivCariSatir(h, false)).join('')}</div>`
        : `<p class="px-5 py-4 text-label-md text-on-surface-variant">Alıcıya ait cari hareket bağlanamadı.</p>`)
    + digerBlok
}

function katalogAd(kod) { return KATALOG.find(k => k.kod === kod)?.ad || kod }

function sekmeTahsilat(hareketler) {
  if (!hareketler.length) return `<div class="p-5">${bosDurum('Bu satışa ait cari hareket yok.', 'payments')}</div>`
  return `<div class="divide-y divide-outline-variant/50">${hareketler.map(h => {
    const krediMi = h.alt_tip === 'KREDI_TAHSILAT'
    const eksi = h.tip === 'TEDIYE'
    const ad = h.alt_tip ? katalogAd(h.alt_tip) : (h.tip === 'TAHSILAT' ? 'Tahsilat' : h.tip === 'TEDIYE' ? 'Tediye' : h.tip)
    return `<div class="px-5 py-3 flex items-start justify-between gap-3 ${krediMi ? 'bg-error/5' : ''}">
      <div class="min-w-0">
        <div class="font-bold text-body-md truncate flex items-center gap-1.5 ${krediMi ? 'text-error' : 'text-on-surface'}">
          ${BUY(ad)}${krediMi ? `<span class="text-[9px] font-black bg-error text-white px-1.5 py-0.5 rounded-full tracking-wide shrink-0">KREDİ</span>` : ''}</div>
        <div class="text-label-sm text-on-surface-variant tabular-nums">${kacis(fmtTarihKisa(h.tarih || h.created_at))}${h.banka ? ' · ' + BUY(h.banka) : ''}</div>
        ${h.aciklama ? `<div class="text-label-sm text-on-surface-variant break-words mt-0.5">${kacis(h.aciklama)}</div>` : ''}
      </div>
      <span class="font-black tabular-nums shrink-0 ${krediMi ? 'text-error' : eksi ? 'text-on-surface-variant' : 'text-secondary'}">${eksi ? '−' : ''}${kacis(fmtPara(Math.abs(Number(h.tutar) || 0)))}</span>
    </div>`
  }).join('')}</div>`
}

function sekmeEvrak(evraklar) {
  if (!evraklar.length) return `<div class="p-5">${bosDurum('Bu araca ait evrak yok.', 'description')}</div>`
  return `<div class="divide-y divide-outline-variant/50">${evraklar.map(e => `
    <div class="px-5 py-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-9 h-9 rounded-lg bg-surface-container-high text-on-surface-variant flex items-center justify-center shrink-0">${mat('description', 'text-[18px]')}</span>
        <div class="min-w-0">
          <div class="text-body-md font-bold truncate">${kacis(evrakEtiket(e.tip))}</div>
          <div class="text-label-sm text-on-surface-variant">${kacis(fmtTarihKisa(e.created_at))}</div>
        </div>
      </div>
      <button data-evrak="${kacis(e.url)}" class="px-3 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold text-primary hover:bg-primary/5 shrink-0">Aç</button>
    </div>`).join('')}</div>`
}

// Evrak bucket'ı özel — http linki değilse imzalı URL üretilir (arac-detay deseni).
async function evrakAc(yol) {
  if (!yol) return
  if (/^https?:\/\//i.test(yol)) { window.open(yol, '_blank', 'noopener'); return }
  const { data, error } = await supabase.storage.from('arac-evrak').createSignedUrl(yol, 3600)
  if (error || !data?.signedUrl) {
    dbHata('evrak imzalı url', error)
    alert('Belge açılamadı: ' + (error?.message || 'bilinmeyen hata'))
    return
  }
  window.open(data.signedUrl, '_blank', 'noopener')
}

function sekmeNot(notlar, rezNot) {
  if (!notlar.length && !rezNot) return `<div class="p-5">${bosDurum('Bu satışa ait not yok.', 'sticky_note_2')}</div>`
  const rez = rezNot ? `<div class="px-5 py-3 bg-primary/5 border-b border-outline-variant">
      <div class="text-label-sm text-primary font-bold uppercase tracking-wide mb-1">Sipariş / Rezervasyon Notu</div>
      <div class="text-body-md text-on-surface break-words">${kacis(rezNot)}</div></div>` : ''
  return rez + `<div class="divide-y divide-outline-variant/50">${notlar.map(n => `
    <div class="px-5 py-3">
      <div class="flex items-center gap-2 mb-1">
        <span class="w-7 h-7 rounded-full bg-primary-fixed text-primary flex items-center justify-center font-bold text-[10px] shrink-0">${basHarf(danismanAdi(DMAP, n.danisman_id))}</span>
        <span class="text-label-md font-bold text-on-surface truncate">${BUY(danismanAdi(DMAP, n.danisman_id))}</span>
        <span class="text-label-sm text-on-surface-variant ml-auto shrink-0">${kacis(fmtTarih(n.created_at))}</span>
      </div>
      <div class="text-body-md text-on-surface break-words">${kacis(n.icerik)}</div>
    </div>`).join('')}</div>`
}

function sekmeZaman(olaylar) {
  if (!olaylar.length) return `<div class="p-5">${bosDurum('Bu satış için kayıtlı olay yok.', 'history')}</div>`
  return `<div class="px-5 py-4"><ol class="relative border-l border-outline-variant ml-3 space-y-4">${olaylar.map(o => `
    <li class="ml-5">
      <span class="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-primary mt-1.5"></span>
      <div class="text-body-md font-bold text-on-surface">${kacis(olayEtiket(o.tip))}</div>
      <div class="text-label-sm text-on-surface-variant">${kacis(fmtTarih(o.olusma_zamani))}${o.danisman_id ? ' · ' + BUY(danismanAdi(DMAP, o.danisman_id)) : ''}</div>
    </li>`).join('')}</ol></div>`
}
