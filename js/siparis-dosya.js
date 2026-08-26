// =====================================================================
// siparis-dosya.js — Rezervasyon 2.0 · Faz R4b: Satış Dosyası / Cari İşlem
//   Merkezi. Sipariş Merkezi'nden (siparis-merkezi.js) tek bir sipariş
//   satırının TAM sayfa görünümü: araç/müşteri özeti + KPI'lar + Cari
//   İşlem Merkezi (sol kolonun en üstünde, sayfa içi form) + Cari Defteri
//   (orta kolon, timeline) + Satış Durumu İzleyici + "Satışı Gerçekleştir"
//   (noter) akışı. Form ile defter AYNI EKRANDA — biri diğerini örtmez.
//
//   Şema (R4a — sql/64 + sql/65, CANLI):
//     cari_hareketler: tip(SIPARIS_BORCU/TAHSILAT/TEDIYE/IPTAL_DUZELTME/ACILIS),
//       alt_tip(tanimlar.kod, tip=CARI_ISLEM_TIPI), kasa_hesap_id, odeme_tipi,
//       pos_turu, pos_turu_serbest, ters_kayit_id, takas_arac_id. INSERT-ONLY
//       (RLS: UPDATE/DELETE yok — düzeltme = ters kayıt, cari_ters_kayit_guard
//       trigger'ı orijinalle aynı musteri_id/tutar zorunlu kılar).
//     v_siparis_bakiye: ters-kayıt anti-join dışlamalı, tek doğru bakiye kaynağı.
//     siparisler: satis_tarihi/noter_adi/yevmiye_no — "SATILDI" TÜRETİLMİŞ
//       durum (satis_tarihi dolu = satıldı). Yeni enum AÇILMADI.
//
//   Kilit: satis_tarihi dolu VEYA teslimat_durumu set ise finansal aksiyonlar
//   (cari işlem ekle, ters kayıt, satışı gerçekleştir) UI'da gizlenir/pasif.
//   DB tarafı kilit (RLS) R4c'de ayrı — burada yalnız görsel.
//
//   Kapsam DIŞI (bilinçli): Takas Aracı otomatik Araç Kabul/ALINDI kaydı
//   (R4d) — burada yalnızca cari mahsup + bilgiyi açıklamada tutuyoruz.
//   Finans rolü RLS (R4c).
//
//   AŞAMA 3 eki (sql/80 — CANLI):
//     · Cari'ye USD/EUR/Altın girişi. TL karşılığını **DB hesaplar**
//       (trg_cari_doviz_tl: tutar = tutar_doviz × kur). Bu dosya yabancı
//       parada `tutar` GÖNDERMEZ — para_birimi + tutar_doviz + kur yeter.
//       Böylece bakiye view'ları ve "tek kaynak" kuralı bozulmaz.
//     · Noter Harcı: taban `noter_harci_hesapla(siparis)` RPC'sinden gelir
//       (MAX(anlaşılan, kasko) × oran). Danışman artırabilir, AZALTAMAZ.
//     · Otosor Dosya Masrafı: masraf = KREDİ TUTARI (brüt) × ayarlardaki oran;
//       "krediden geçecek net" ayrı alan, açıklamaya yazılır (kolonu yok).
//     · Plaka Basım: noter WhatsApp formunda "plaka değişecek" işaretlenirse
//       ayarlardaki ücret kadar TEDIYE satırı (onay sorularak) eklenir.
//     · Kredi transferi: `kredi_transfer_bekliyor` RPC (BEKLIYOR). 'GECTI'
//       kullandırım onayında trigger'la olur — bu ekran GECTI YAZMAZ.
//   Oran/ücretler `ayarlar` tablosundan okunur; koda sabit sayı gömülmez.
// =====================================================================
import { supabase } from './supabase-client.js'
import {
  danismanMap, danismanAdi, fmtPara, fmtTarih, fmtTarihKisa, kacis, trBuyuk, buyuk,
  dbHata, bugunISO, urlParam, csvIndir, telNo, kaskoKodu, TESLIMAT_DURUM_ETIKET,
  ARAC_DURUM_ETIKET, TESLIM_SINIF, TESLIM_SORUMLU_ETIKET,
} from './veri.js'
import { mat, basHarf, bosDurum, uyari, binlikInputKur } from './stitch-ui.js'
import { satisMuduruMu } from './yetki.js'
import { evrakPaneliHtml, evrakBagla, imzaOnayiAl, evrakAc } from './siparis-evrak.js'
import { guncelIsteBtnHtml, guncelEkspertizAc } from './guncel-ekspertiz.js'
// Şema boyama TEK KAYNAK — "Satış Ekspertiz" belgesi için (sql/208).
import { svgBoya } from './ekspertiz.js'

const KOK = () => document.getElementById('kok')
const one = v => (Array.isArray(v) ? v[0] : v) || null
const B = v => kacis(buyuk(v ?? ''))
// ⚠️ YEREL `const buyuk` KALDIRILDI — veri.js'ten ZATEN import ediliyor ve
//   tanımı BİREBİR aynı (toLocaleUpperCase('tr')). İkisi bir arada
//   "Identifier 'buyuk' has already been declared" SyntaxError'u veriyordu:
//   modül hiç yüklenmiyor, sayfa BEYAZ açılıyordu (Göksenil bildirdi).
//   Kural yine geçerli: gösterime giden ad için buyuk(), aramada trBuyuk().
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
const LBL = 'text-[11px] font-bold text-on-surface-variant uppercase'
// Araç kapak fotoğrafı (arac-foto PUBLIC bucket → doğrudan public URL). stok.js
// ile aynı desen — paylaşımlı yardımcı yok, sayfa yerel (stok.js'te de yerel).
const kapakUrl = yol => supabase.storage.from('arac-foto').getPublicUrl(yol).data.publicUrl
const sifirMi = b => b != null && Math.abs(b) < 0.005

let BEN = null
let SIP_ID = null
let S = null                 // siparisler satırı (+ embed)
let DMAP = {}
let KATALOG = []              // tanimlar tip=CARI_ISLEM_TIPI [{kod, ad, ozellikler, sira}]
let POSLAR = []               // tanimlar tip=POS_CIHAZI [{kod, ad, ozellikler:{tur, kasa_hesap_id}}] (sql/196)
let KREDI_OZET = null         // siparis_kredi_ozeti RPC: {var, brut, net, banka, durum, cari_yazildi} (sql/197)
let KASA = []                 // kasa_hesaplari aktif
let LISTE_FIYAT = null        // v_arac_guncel_fiyat.satis_fiyati
let KAPAK = null              // kapak foto public url
let HAREKETLER = []           // cari_hareketler (bu siparişe ait)
let BAKIYE = null             // v_siparis_bakiye.bakiye (null → görünmüyor/yok)
let ONAYLI_KREDI = null       // R5: müşterinin onaylı+kullandırılmamış kredisi {banka, onayli_limit, banka_sonuc_id, kredi_personeli} — RPC ile
let ONAYLAR = new Map()       // cari_hareket_id → {onay_durumu, karar_notu} (finansın satır kararları)
// F3 — "Teslimata Gönder" 7 şartı. Kapıyı SUNUCU söyler (sql/88
// teslimata_gonderilebilir); istemci yalnız gösterir. Böylece arayüz atlanarak
// (konsol/başka sekme) gönderim yapılamaz.
// ⚠️ Şartlar KOD ile eşleştirilir (sql/247), Türkçe etiketle DEĞİL.
//   Etiket metni bir gün düzeltilirse `find` undefined döner, kart çizilmez ve
//   HATA ÇIKMAZ — üç eşleştirme bu yüzden koda çevrildi.
let TESLIMAT_SART = null      // { uygun, eksikler[], sartlar[{kod, ad, tamam}] }
// FAZ 2 — Teslim planı (sql/247-249). Üçü de SALT OKUNUR: sınıf/sıra
// v_teslim_plani'de, teşhis gecikme_nedeni_turet'te SUNUCUDA hesaplanır.
// ⚠️ Sınıflandırmayı burada TEKRARLAMA (veri.js TESLIM_SINIF yalnız görsel
//   karşılıktır). Tarih DEĞİŞTİRME de burada YAPILMAZ: tek kapı
//   teslim_plani_degistir() RPC'si ve o pencere Sipariş Merkezi'nde yaşıyor —
//   düğme oraya YÖNLENDİRİR, pencereyi ikinci kez yazmaz (CLAUDE.md §4).
let TESLIM_PLAN = null        // v_teslim_plani satırı (planlanan, sinif, gecikme_gun, plan_tipi, erteleme_sayisi, plan_muaf…)
let TESLIM_TESHIS = null      // gecikme_nedeni_turet RPC: {neden_kod, sorumlu, aciklama, kaynak:'OTOMATIK', …} — HİÇBİR ŞEY YAZMAZ, önerir
let TESLIM_DEFTER = []        // siparis_teslim_planlari satırları (en yeni üstte) — salt okunur defter
let GECIKME_NEDEN = {}        // tanimlar TESLIM_GECIKME_NEDENI: kod → {ad, sorumlu} (defterdeki neden_kod'u insan diline çevirmek için)
let KAPORA_IADE = null        // BR-0501 kapora_iadeleri satırı (yoksa null → karar bekliyor)
let RESMI = null              // R7-2: v_siparis_resmi_tahsilat.resmi_tahsilat (EFT+net kredi+POS+takas noter beyanı−EFT iade)
let TCKN = null                // musteri_kimlik.tckn_vergi_no — yalnız WhatsApp taslağında TC son4 için, gösterime basılmaz
let AYAR = {}                 // ayarlar tablosu: anahtar → deger (metin). Oran/ücretler koda GÖMÜLMEZ.
let NOTER_HARC = null         // noter_harci_hesapla RPC sonucu {anlasilan, kasko_degeri, taban, oran, harc}
let ALIS = null               // arac_alislar son satırı — "aracın eski sahibi" (satici_musteri_id)
let EVRAK = {}                // arac_evraklar: tip → url (EKSPERTIZ_PDF / SBM_GORSEL / RUHSAT / TRAMER_DETAY)
let EKSPERTIZ = {}            // arac_ekspertiz: parça kodu → durum (Satış Ekspertiz belgesi)
let TRAMER = []               // arac_tramer satırları — hasar adedi/tutarı
let EKSPERTIZ_SVG = ''        // boyanmış şema (belgeye gömülür)
let KREDI_BASVURU = null      // bu araca/müşteriye ait kredi_basvurulari satırı; null → NAKİT satış
let SIGORTA_FIRSAT = null     // bu SİPARİŞE ait sigorta_firsatlari satırı (sql/182)
let EVRAKLAR = []             // siparis_evraklari satırları (SATIS_DEVIR_TESLIM · MASAK)
let TANIM = {}                // {YAKIT:{kod:ad}, VITES:{…}, RENK:{…}} — tutanakta okunur ad
let EKSPERTIZ_FIRMA = {}      // {DYNOMOSS:{ad, grup_adi, telefon}, …} — "Güncel İste" ipucu (sql/151)
// Bu ŞASİYE ait geçmiş satışlar (bu sipariş hariç) + plaka değişim izi.
// Göksenil (5 Ağu 2026): "tam iz yapalım, ilgili satış dosyasında bunu
//   gösterelim; bunu şasi no ile eşleştirilen kayıtlarda yapabiliriz."
// ⚠️ Eşleştirme PLAKA ile DEĞİL şasi ile: araç peşin/takasla geri alınınca
//   Araç Kabul'den YENİ kayıt açılıyor (arac_id değişiyor) ve plaka da
//   devredilmiş olabiliyor. Zaman içinde sabit kalan tek alan şasi.
let GECMIS_SATIS = [], PLAKA_IZ = []
let otosorMasrafElle = false  // Otosor formunda danışman masrafı elle değiştirdiyse otomatik hesap üzerine YAZMAZ

let drawerAcik = false
let aksiyonSecili = null      // 'TAHSILAT' | 'KAPORA_IADESI' | 'TAKAS_ARAC' | 'SAHIBINE_IADE' | 'NOTER_MASRAFI' | 'SIGORTA' | 'NOTER_HARCI' | 'OTOSOR_DOSYA_MASRAFI'
let satisModalAcik = false
let filtreTip = 'TUMU'
let KMENU = null, KMENU_DIS = null   // ⋮ açılır menüsü (arac-detay.js kartMenu ile aynı desen)

const AKSIYONLAR = [
  { kod: 'TAHSILAT', ad: 'Tahsilat', ikon: 'payments' },
  { kod: 'KAPORA_IADESI', ad: 'Kapora İadesi', ikon: 'assignment_return' },
  { kod: 'TAKAS_ARAC', ad: 'Takas Aracı', ikon: 'sync_alt' },
  { kod: 'SAHIBINE_IADE', ad: 'Takas İadesi', ikon: 'undo' },
  { kod: 'NOTER_MASRAFI', ad: 'Noter Masrafı', ikon: 'receipt_long' },
  { kod: 'SIGORTA', ad: 'Sigorta', ikon: 'shield' },
  { kod: 'NOTER_HARCI', ad: 'Noter Harcı', ikon: 'gavel' },
  { kod: 'OTOSOR_DOSYA_MASRAFI', ad: 'Otosor Dosya Masrafı', ikon: 'request_quote' },
]

// Göksenil, 12 Ağu 2026: "katalogdan besleyelim ama düğme şekilleri kalsın;
// ben kataloğa veri girdiğimde düğmelere eklenir."
//
// Yukarıdaki sekiz düğme ÖZEL forma sahip (POS türü, takas aracı, noter harcı
// tabanı, Otosor iki-kayıt hesabı…) — koda gömülü kalır. `tanimlar`
// (tip=CARI_ISLEM_TIPI) içindeki DİĞER tediye kalemleri otomatik düğme olur.
// Böylece "LPG Uyum" gibi yeni bir masraf Tanımlar'dan eklenince burada
// kendiliğinden belirir; kimse kod değiştirmez.
//
// ⚠️ Neden gerekti: liste sabit sekiz düğmeydi, LPG uyumu "Noter Masrafı"na
//    yazılıp açıklamaya not düşülüyordu (11 Ağu 2026 · silinen siparişte
//    ölçüldü). Rapor "noter masrafı" der, gerçekte LPG uyumudur.
//
// ⚠️ Tahsilat kalemleri (NAKIT/HAVALE/KREDI_KARTI) düğme OLMAZ — onlar tek
//    "Tahsilat" düğmesinin içindeki ödeme tipi seçimi. İkinci kez düğme
//    yapmak aynı işlemi iki farklı yoldan girmek demek olurdu.
const KATALOG_DISI = ['NAKIT_TAHSILAT', 'HAVALE_TAHSILAT', 'KREDI_KARTI_TAHSILAT',
  'TAKAS_MAHSUP', 'TRAFIK_SIGORTASI', 'KASKO']

function aksiyonListesi() {
  const varolan = new Set(AKSIYONLAR.map(a => a.kod).concat(KATALOG_DISI))
  const ek = (KATALOG || [])
    .filter(k => !varolan.has(k.kod) && (k.ozellikler?.yon || 'TEDIYE') === 'TEDIYE')
    .map(k => ({ kod: k.kod, ad: k.ad, ikon: k.ozellikler?.ikon || 'receipt_long', katalog: true }))
  return AKSIYONLAR.concat(ek)
}
const aksiyonBul = kod => aksiyonListesi().find(a => a.kod === kod)

// Cari para birimleri (sql/80 cari_para_birimi_check ile BİREBİR) —
// [kod, menü etiketi, kısa birim]. Enum DB CHECK'i tekrar etmesin diye
// tek yerde; yeni birim eklenirse önce CHECK, sonra burası.
const PARA_BIRIMLERI = [
  ['TRY', '₺ TRY (Türk Lirası)', '₺'],
  ['USD', '$ USD (Dolar)', 'USD'],
  ['EUR', '€ EUR (Euro)', 'EUR'],
  ['XAU', 'Altın (XAU)', 'gr altın'],
]
const birimKisa = kod => (PARA_BIRIMLERI.find(p => p[0] === kod) || [])[2] || kod

// --- Sayı okuma/biçimleme (yerel) -----------------------------------------
// `fmtPara` (veri.js) TAM SAYI ₺ gösterir; kur (34,25) ve kuruşlu döviz
// karşılığı için ondalık gerekiyor. Kopya değil, farklı hassasiyet.
const fmtSayi = (n, min = 0, max = 2) => Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max })
const fmtTL2 = n => fmtSayi(n, 2, 2) + ' ₺'
// TR biçimli girişi sayıya çevirir: "1.234.567" → 1234567 · "34,25" → 34.25
function sayiOku(v) {
  const s = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return isFinite(n) ? n : 0
}
// Ayar değeri (metin) → sayı. Ayar YOKSA null döner; tahmini varsayılan
// ÜRETİLMEZ — para tutarında sessiz varsayım hatadır, arayüz uyarı gösterir.
function ayarSayi(anahtar) {
  const ham = AYAR[anahtar]
  if (ham == null || ham === '') return null
  const n = Number(String(ham).replace(',', '.'))
  return isFinite(n) ? n : null
}
// 0.002 → "binde 2" · 0.01 → "%1"
function oranMetin(oran) {
  const o = Number(oran || 0)
  if (!o) return '—'
  return o < 0.01 ? 'binde ' + fmtSayi(o * 1000, 0, 2) : '%' + fmtSayi(o * 100, 0, 2)
}

const OLAY_ETIKET = {
  SIPARIS_OLUSTU: 'Sipariş oluştu', TAHSILAT: 'Tahsilat', TEDIYE: 'Tediye',
  IPTAL_DUZELTME: 'İptal / Düzeltme', SIPARIS_BORCU: 'Sipariş Borcu',
}
const ODEME_ETIKET = { NAKIT: 'Nakit', HAVALE_EFT: 'Havale/EFT', KREDI_KARTI: 'Kredi Kartı' }
const POS_ETIKET = { FIZIKI_POS: 'Fiziki POS', N_KOLAY_POS: 'N Kolay POS', DIGER: 'Diğer' }

export async function siparisDosyaKur(d) {
  BEN = d || null
  SIP_ID = urlParam('id')
  if (!SIP_ID) { KOK().innerHTML = uyari('Sipariş belirtilmedi. Sipariş Merkezi\'nden bir kayıt seçin.'); return }
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant text-body-md">Satış dosyası yükleniyor…</div>`
  binlikInputKur()
  DMAP = await danismanMap()
  await yukle()
}

async function yukle() {
  const [{ data: sip, error: sErr }, { data: katalog }, { data: kasa }, { data: resmi, error: rErr }, { data: ayarlar, error: aErr }] = await Promise.all([
    supabase.from('siparisler')
      .select(`id, arac_id, alici_musteri_id, danisman_id, olusturan, asama, durum, teslimat_durumu,
               anlasilan_tutar, satis_sekli, teslim_tarihi, satis_tarihi, noter_adi, yevmiye_no, noter_satis_tutari,
               yeni_plaka, yeni_ruhsat_seri_no, plaka_degisecek, guncel_ekspertiz_istendi, guncel_ekspertiz_isteyen,
               kredi_transfer_durumu, kredi_transfer_notu, created_at,
               sigorta_tamam, sigorta_tamam_zamani, evrak_tamam, evrak_tamam_zamani,
               min_fiyat_onay_veren, min_fiyat_onay_zamani, min_fiyat_onay_not,
               min_fiyat_onay_durumu, min_fiyat_gerekce, min_fiyat_talep_eden,
               min_fiyat_talep_zamani, min_fiyat_red_nedeni, min_satis_snapshot,
               kapora_tutar, iptal_nedeni, iptal_not,
               rezervasyon_notu, sira,
               tediye_evraki_alindi, tediye_evraki_eden, tediye_evraki_zamani,
               stok_araclar(id, marka, model, versiyon, yil, plaka, km, renk, yakit, vites, lokasyon, durum, kasko_kodu, tsb_marka_id, tsb_tip_id,
                            yedek_anahtar, ruhsat_url, ruhsat_seri_no, sasi_no, motor_no, ekspertiz_orijinal, tramer_temiz, ekspertiz_firma),
               musteriler(ad_soyad, telefon, tip, e_posta, adres, dogum_tarihi, vergi_dairesi, meslek_grubu)`)
      .eq('id', SIP_ID).maybeSingle(),
    // POS_CIHAZI aynı sorguda gelir (sql/196) — kredi kartı tahsilatında hangi
    // POS seçilirse bağlı hesabı otomatik gelsin diye.
    supabase.from('tanimlar').select('tip, kod, ad, ozellikler, sira').in('tip', ['CARI_ISLEM_TIPI', 'POS_CIHAZI']).eq('aktif', true).order('sira'),
    supabase.from('kasa_hesaplari').select('id, ad, tip').eq('aktif', true).order('sira'),
    // R7-2: finansın noter beyanıyla karşılaştırdığı kanıtlı tahsilat (sql/75)
    supabase.from('v_siparis_resmi_tahsilat').select('resmi_tahsilat').eq('siparis_id', SIP_ID).maybeSingle(),
    // Aşama 3: ücret/oranlar (sql/80). Noter harcı oranı UI'da okunmaz —
    // onu RPC sunucuda ayarlardan alır, tek kaynak orada kalsın.
    supabase.from('ayarlar').select('anahtar, deger').in('anahtar', ['plaka_basim_ucreti', 'otosor_dosya_masrafi_orani', 'varsayilan_nakit_kasa']),
  ])
  if (sErr) { dbHata('sipariş yükle', sErr); KOK().innerHTML = uyari('Sipariş okunamadı: ' + kacis(sErr.message)); return }
  if (!sip) { KOK().innerHTML = uyari('Sipariş bulunamadı ya da bu kayda erişiminiz yok.'); return }
  if (rErr) dbHata('resmî tahsilat yükle', rErr)
  if (aErr) dbHata('ayarlar yükle (ücret/oran)', aErr)
  S = sip
  KATALOG = (katalog || []).filter(t => t.tip === 'CARI_ISLEM_TIPI')
  POSLAR = (katalog || []).filter(t => t.tip === 'POS_CIHAZI')
  KASA = kasa || []
  RESMI = resmi ? Number(resmi.resmi_tahsilat) : 0
  AYAR = Object.fromEntries((ayarlar || []).map(a => [a.anahtar, a.deger]))

  const aracId = S.arac_id
  const [{ data: fiyat }, { data: fotolar }, { data: hareketler, error: hErr }, { data: bak, error: bErr }, { data: onayliKredi }, { data: kimlik, error: kErr }, { data: onaylar, error: oErr }, { data: krediOzet, error: koErr }] = await Promise.all([
    aracId ? supabase.from('v_arac_guncel_fiyat').select('satis_fiyati').eq('arac_id', aracId).maybeSingle() : Promise.resolve({ data: null }),
    // `created_at` eşitlik bozucu — sira berabere kalırsa kapak rastgele
    // değişiyordu (bkz sql/117). Kaldırma.
    aracId ? supabase.from('arac_fotograflari').select('dosya_yolu, sira').eq('arac_id', aracId).order('sira').order('created_at').limit(1) : Promise.resolve({ data: [] }),
    supabase.from('cari_hareketler')
      .select('id, tip, alt_tip, kasa_hesap_id, tutar, para_birimi, kur, tutar_doviz, kredi_tutari, tarih, aciklama, odeme_tipi, banka, pos_turu, pos_turu_serbest, ters_kayit_id, takas_arac_id, takas_noter_beyani, kaydeden, created_at, kredi_teyit_zamani, kredi_teyit_eden')
      .eq('siparis_id', SIP_ID).order('tarih', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('v_siparis_bakiye').select('bakiye').eq('siparis_id', SIP_ID).maybeSingle(),
    // R5: müşterinin onaylı+kullandırılmamış kredisi (decoupled RPC — kredi hesabı YAPMAZ)
    S.alici_musteri_id ? supabase.rpc('musteri_onayli_kredi', { p_musteri_id: S.alici_musteri_id }) : Promise.resolve({ data: [] }),
    // yalnız "Notere Gönder (WhatsApp)" taslağında TC son4 göstermek için — ekrana basılmaz
    S.alici_musteri_id ? supabase.from('musteri_kimlik').select('tckn_vergi_no').eq('musteri_id', S.alici_musteri_id).maybeSingle() : Promise.resolve({ data: null }),
    // Finansın satır bazlı kararları (IADE'de hangi satır neden reddedildi görünsün)
    supabase.from('cari_hareket_onay').select('cari_hareket_id, onay_durumu, karar_notu').eq('siparis_id', SIP_ID),
    // D4 (sql/197): Otosor formunun brüt/net rakamları. Düz select ÇALIŞMAZ —
    // kredi_kullandirim RLS'i danışmana kapalı, RPC dar bir pencere açar.
    supabase.rpc('siparis_kredi_ozeti', { p_siparis: SIP_ID }),
  ])
  if (hErr) dbHata('cari hareket yükle', hErr)
  if (bErr) dbHata('sipariş bakiye', bErr)

  // Göksenil 3 Ağu 2026 — "araç siparişte iken yukarıdaki kartta olması gereken:
  //   ekspertiz / tramer / ruhsat / kasko kodu / eski sahibi / yedek anahtar"
  // Eski sahip = aracı stoğa kaydederken girilen satıcı (arac_alislar.satici_musteri_id).
  // Ekspertiz parçaları + tramer: "Satış Ekspertiz" belgesi (sql/208) için.
  // Şema ve hasar adedi oradan basılır.
  const [{ data: alis, error: alErr }, { data: evraklar, error: evErr },
         { data: eksp, error: ekErr }, { data: tram, error: trErr }] = await Promise.all([
    aracId ? supabase.from('arac_alislar')
      .select('alis_tarihi, satici_musteri_id, musteriler:satici_musteri_id(ad_soyad, telefon)')
      .eq('arac_id', aracId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    aracId ? supabase.from('arac_evraklar').select('tip, url').eq('arac_id', aracId)
      : Promise.resolve({ data: [] }),
    aracId ? supabase.from('arac_ekspertiz').select('parca_kodu, durum').eq('arac_id', aracId)
      : Promise.resolve({ data: [] }),
    aracId ? supabase.from('arac_tramer').select('tutar').eq('arac_id', aracId)
      : Promise.resolve({ data: [] }),
  ])
  if (alErr) dbHata('araç alış (eski sahip)', alErr)
  if (evErr) dbHata('araç evrakları', evErr)
  if (ekErr) dbHata('araç ekspertiz', ekErr)
  if (trErr) dbHata('araç tramer', trErr)
  ALIS = alis || null
  EVRAK = {}
  for (const e of (evraklar || [])) if (!EVRAK[e.tip]) EVRAK[e.tip] = e.url
  EKSPERTIZ = {}
  for (const e of (eksp || [])) if (e.parca_kodu) EKSPERTIZ[e.parca_kodu] = e.durum
  TRAMER = tram || []
  await ekspertizSemasiHazirla()

  // İmza gereken evraklar (sql/132)
  const { data: sevrak, error: seErr } = await supabase.from('siparis_evraklari')
    .select('id, belge_kodu, masak_tipi, yazdirma_zamani, yazdiran, imza_onay, imza_onaylayan, imza_zamani')
    .eq('siparis_id', SIP_ID)
  if (seErr) dbHata('sipariş evrakları', seErr)
  EVRAKLAR = sevrak || []

  // Yakıt/vites/renk KOD olarak tutuluyor; tutanakta okunur ad basılmalı.
  // EKSPERTIZ_FIRMASI da burada: "Güncel İste" penceresinde hangi WhatsApp
  // grubunun seçileceğini hatırlatmak için (sql/151). Grup adı mesaj GÖNDERMEZ
  // — WhatsApp gruba programatik gönderime izin vermiyor, bu yalnız ipucu.
  const { data: tnm, error: tnErr } = await supabase.from('tanimlar')
    // SATIS_SEKLI: Noter kartındaki "Satış Tipi" seçimi (sipariş açılırken
    // sorulur ama eski/eksik dosyalar buradan düzeltilebilsin).
    .select('tip, kod, ad, ozellikler').in('tip', ['YAKIT', 'VITES', 'RENK', 'EKSPERTIZ_FIRMASI', 'SATIS_SEKLI', 'TESLIM_GECIKME_NEDENI']).eq('aktif', true)
  if (tnErr) dbHata('yakıt/vites/renk/ekspertiz tanımları', tnErr)
  TANIM = {}
  EKSPERTIZ_FIRMA = {}
  GECIKME_NEDEN = {}
  for (const t of (tnm || [])) {
    (TANIM[t.tip] ||= {})[t.kod] = t.ad
    if (t.tip === 'EKSPERTIZ_FIRMASI') EKSPERTIZ_FIRMA[t.kod] = { ad: t.ad, ...(t.ozellikler || {}) }
    // Gecikme nedeninin SORUMLUSU tanımın özelliğinde duruyor (sql/244) —
    // defterdeki `beyan_edilen_sorumlu` boşsa buradan tamamlanır.
    if (t.tip === 'TESLIM_GECIKME_NEDENI') GECIKME_NEDEN[t.kod] = { ad: t.ad, sorumlu: t.ozellikler?.sorumlu || null }
  }

  // Kredi transferi kartı: bu aracın kredi modülünde kaydı var mı?
  // Yoksa satış NAKİT demektir → kart pasif (Göksenil, 3 Ağu 2026).
  KREDI_BASVURU = null
  // Plaka DB'de boşluksuz tutuluyor (35NSD813). Kredi modülü elle girildiği
  // için farklı yazılmış olabilir — eşleşmezse kart "kayıt yok" der, uydurmaz.
  const plakaAra = (one(S.stok_araclar)?.plaka || '').trim()
  if (S.alici_musteri_id || plakaAra) {
    let q = supabase.from('kredi_basvurulari')
      .select('id, durum, sonuc, plaka, musteri_id, kredi_personeli_id, bekleme_nedeni, created_at')
      .order('created_at', { ascending: false }).limit(1)
    // ⚠️ .or() içine BOŞ değer koyulamaz: `plaka.ilike.` PostgREST'te sözdizimi
    //   hatası verir (400). Plakasız araç canlıda var, o yüzden ayrı dallar.
    if (S.alici_musteri_id && plakaAra) q = q.or(`musteri_id.eq.${S.alici_musteri_id},plaka.ilike.${plakaAra}`)
    else if (S.alici_musteri_id)        q = q.eq('musteri_id', S.alici_musteri_id)
    else                                q = q.ilike('plaka', plakaAra)
    const { data: kb, error: kbErr } = await q.maybeSingle()
    if (kbErr) dbHata('kredi başvurusu (araç)', kbErr)
    KREDI_BASVURU = kb || null
  }
  // Sigorta fırsatı: bu SİPARİŞ sigorta birimine gönderildi mi? (sql/182)
  // ⚠️ Teklif STOKTAN değil SİPARİŞTEN istenir — poliçe aracın YENİ sahibine
  //   kesilir, o da ancak sipariş açılınca belli olur (Göksenil, 10 Ağu 2026).
  SIGORTA_FIRSAT = null
  {
    // ⚠️ TABLODAN DEĞİL GÖRÜNÜMDEN: teklif rakamları ve kesilen poliçenin
    //    şirket/bitiş bilgisi v_sigorta_firsat_detay'da birleştirilmiş (sql/219).
    //    Aynı birleştirmeyi burada tekrar yazmak ikinci kopya olurdu.
    const { data: sf, error: sfErr } = await supabase.from('v_sigorta_firsat_detay')
      .select('id, durum, not_metni, created_at, teklif_verildi_at, sonuclandi_at, kayip_nedeni, teklif_pesin, teklif_taksitli, teklif_taksit_ay, police_sirket_adi, police_bitis, police_no, police_tur_adi')
      .eq('siparis_id', SIP_ID).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (sfErr) dbHata('sigorta fırsatı', sfErr)
    SIGORTA_FIRSAT = sf || null
  }
  // F3 — 7 şartı SUNUCUDAN sor (bakiye/araç durumu yazıldıktan sonra çalışmalı)
  // Şasi geçmişi — araç bilgisi geldikten sonra
  GECMIS_SATIS = []; PLAKA_IZ = []
  {
    const sasi = (one(S.stok_araclar)?.sasi_no || '').trim()
    if (sasi) {
      const [{ data: gs, error: gErr }, { data: pz, error: pErr }] = await Promise.all([
        supabase.from('v_arac_gecmis_satis')
          .select('siparis_id, satis_tarihi, plaka, musteri_ad_soyad, danisman_ad, kaynak, anlasilan_tutar')
          .eq('sasi_no', sasi).order('satis_tarihi', { ascending: false }).limit(50),
        supabase.from('arac_plaka_gecmisi')
          .select('eski_plaka, yeni_plaka, degisim_tarihi')
          .eq('sasi_no', sasi).order('degisim_tarihi', { ascending: false }).limit(20),
      ])
      if (gErr) dbHata('gecmis satislar (sasi)', gErr)
      // Bu siparişin KENDİSİ listede çıkmasın — "geçmiş" olan diğerleri.
      else GECMIS_SATIS = (gs || []).filter(x => x.siparis_id !== SIP_ID)
      if (pErr) dbHata('plaka gecmisi', pErr); else PLAKA_IZ = pz || []
    }
  }
  const { data: sart, error: tErr } = await supabase.rpc('teslimata_gonderilebilir', { p_siparis: SIP_ID })
  if (tErr) { dbHata('teslimat şartları', tErr); TESLIMAT_SART = null } else TESLIMAT_SART = sart || null

  // FAZ 2 — Teslim planı / teşhis / defter (sql/247-249). Üçü de OKUMA.
  // ⚠️ gecikme_nedeni_turet HİÇBİR ŞEY YAZMAZ, yalnız "sistem ne düşünüyor"u
  //   döndürür. Danışmana boş "neden gecikti?" kutusu sorulmaz; teşhis
  //   gösterilir, o DOĞRULAR (doğrulama Sipariş Merkezi'ndeki pencerede).
  {
    const [{ data: plan, error: plErr }, { data: teshis, error: thErr }, { data: defter, error: dfErr }] = await Promise.all([
      supabase.from('v_teslim_plani')
        .select('siparis_id, planlanan, ilk_planlanan, plan_tipi, erteleme_sayisi, son_cevap_ptt, plan_muaf, sorumlu_danisman, cevap_var, gecikme_gun, kirmizi_gunu, sinif, sira_anahtari')
        .eq('siparis_id', SIP_ID).maybeSingle(),
      supabase.rpc('gecikme_nedeni_turet', { p_siparis: SIP_ID }),
      // Defter salt okunur (BR-0142) — buradan yalnız okunur, asla yazılmaz.
      supabase.from('siparis_teslim_planlari')
        .select('tur, eski_tarih, yeni_tarih, neden_kod, neden_kaynak, neden_not, beyan_edilen_sorumlu, gecikme_gun, kaydeden, created_at')
        .eq('siparis_id', SIP_ID).order('created_at', { ascending: false }).limit(50),
    ])
    if (plErr) dbHata('teslim planı (v_teslim_plani)', plErr)
    TESLIM_PLAN = plan || null
    if (thErr) dbHata('gecikme nedeni türet', thErr)
    // one(): RPC jsonb döndürürse nesne, `returns table` döndürürse dizi gelir —
    // bu dosyada iki desen de var (siparis_kredi_ozeti nesne, musteri_onayli_kredi dizi).
    TESLIM_TESHIS = one(teshis)
    if (dfErr) dbHata('teslim planı defteri', dfErr)
    TESLIM_DEFTER = defter || []
  }
  // BR-0501 — kapora iadesi kararı (yalnız iptal edilmiş + kaporalı dosyalarda anlamlı)
  const { data: ki, error: kiErr } = await supabase.from('kapora_iadeleri')
    .select('id, tutar, karar, karar_gerekce, karar_veren, karar_zamani, finans_durum, finans_notu, finans_zamani')
    .eq('siparis_id', SIP_ID).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (kiErr) dbHata('kapora iade', kiErr)
  KAPORA_IADE = ki || null
  if (kErr) dbHata('müşteri kimlik yükle (whatsapp taslağı)', kErr)
  LISTE_FIYAT = fiyat?.satis_fiyati ?? null
  KAPAK = (fotolar && fotolar[0]?.dosya_yolu) ? kapakUrl(fotolar[0].dosya_yolu) : null
  HAREKETLER = hareketler || []
  BAKIYE = bak ? Number(bak.bakiye) : (S.asama === 'SIPARIS' ? null : 0)
  ONAYLI_KREDI = (onayliKredi && onayliKredi[0]) || null
  TCKN = kimlik?.tckn_vergi_no || null
  if (koErr) dbHata('kredi özeti (Otosor)', koErr)
  KREDI_OZET = krediOzet || null
  if (oErr) dbHata('finans satır kararları', oErr)
  ONAYLAR = new Map((onaylar || []).map(o => [o.cari_hareket_id, o]))

  ciz()
}

// --- Türetilmiş durum yardımcıları -------------------------------------
function satildiMi() { return !!S.satis_tarihi }
// İnsan okunur sipariş numarası (sql/133). Eskiden uuid'in ilk 8 hanesi
// basılıyordu — o bir NUMARA değil rastgele hex'ti; evrakla eşleşmiyordu.
function siparisNo() { return S.sira != null ? 'SIP-' + String(S.sira).padStart(6, '0') : '#SP-' + (S.id || '').slice(0, 8).toUpperCase() }
// Kilit: satıldıysa VEYA teslimat finansın elindeyse (ONAY_BEKLIYOR/ONAYLANDI).
// IADE = finans "düzelt" dedi → dosya AÇILIR, danışman cariyi düzeltip tekrar gönderir.
// ⚠️ IADE ÖNCE gelir. Eski sıralamada `!!S.satis_tarihi` ilk koşuldu; noter
//    devri artık ONAYA GÖNDERMEDEN ÖNCE giriliyor (sql/226) ve satis_tarihi
//    o anda doluyor. Finans dosyayı IADE ettiğinde ikinci koşul "açılsın"
//    dese bile birincisi kilitli tutuyordu → danışman cariyi düzeltemiyor,
//    düzeltemediği için tekrar onaya gönderemiyordu. IADE = "düzelt" demek;
//    dosya AÇILIR.
function kilitliMi() {
  if (S.teslimat_durumu === 'IADE') return false
  return !!S.satis_tarihi || !!S.teslimat_durumu
}

// Noter künyesi düzeltilebilir mi?
// ⚠️ `kilitliMi()` BURADA KULLANILAMAZ: noter devri artık onaya göndermeden
//    ÖNCE giriliyor ve satis_tarihi'yi dolduruyor → dosya o an kilitleniyor.
//    Kilide bağlasaydık danışman kendi girdiği yevmiye numarasındaki yazım
//    hatasını bir daha düzeltemezdi. Kilit = CARİ yazma yasağı; noter künyesi
//    ayrı bir boyut (noterKapisi()'ndaki aynı ders).
//    Dosya finansın elindeyken (ONAY_BEKLIYOR/ONAYLANDI) ya da teslim
//    edildiyse kapalı; IADE'de açık — düzeltme zaten o yüzden isteniyor.
function noterDuzenlenebilir() {
  return S.durum === 'ACIK' && (!S.teslimat_durumu || S.teslimat_durumu === 'IADE')
}
function durumPil() {
  if (S.durum === 'TESLIM_EDILDI') return { metin: 'Teslim Edildi', sinif: 'bg-secondary text-on-primary' }
  if (satildiMi()) return { metin: 'Satıldı', sinif: 'bg-secondary text-on-primary' }
  return { metin: 'Sipariş Aşamasında', sinif: 'bg-primary-fixed text-primary' }
}
// sql/65 trigger'ı (anlaşılan tutar düzeltmesi) CARI_ISLEM_TIPI kataloğunda
// olmayan alt_tip='ANLASMA_DUZELTME' yazıyor (bilinçli — kod tarafı sözleşmesi,
// bkz. sql/65 yorumu). Burada okunabilir Türkçe karşılığı veriliyor.
const ALT_TIP_EK_ETIKET = { ANLASMA_DUZELTME: 'Anlaşma Tutarı Düzeltmesi' }
function katalogAd(kod) {
  if (!kod) return null
  return KATALOG.find(k => k.kod === kod)?.ad || ALT_TIP_EK_ETIKET[kod] || kod
}
function kasaAd(id) { return KASA.find(k => k.id === id)?.ad || '—' }

// Tahsilat toplamı — yalnız GERÇEK nakit girişi (TAHSILAT), ters-kayıtlı
// satırlar hariç. IPTAL_DUZELTME nakitsiz borç affı olduğu için "ödenen"
// sayılmaz (sql/65 yorum notu) — Kalan Bakiye zaten v_siparis_bakiye'den
// (IPTAL_DUZELTME dahil) okunuyor, ayrışma burada bilinçli.
// Terslenmiş (iptal edilmiş) satır id'leri — hem orijinal hem ters kayıt.
// Üç yerde aynı döngü yazılıyordu, tek yardımcıya alındı.
function tersliIdSeti() {
  const tersli = new Set()
  for (const h of HAREKETLER) if (h.ters_kayit_id) { tersli.add(h.ters_kayit_id); tersli.add(h.id) }
  return tersli
}
function odenenToplam() {
  const tersli = tersliIdSeti()
  return HAREKETLER.filter(h => h.tip === 'TAHSILAT' && !tersli.has(h.id)).reduce((a, h) => a + Number(h.tutar || 0), 0)
}
// ⚠️ BAKİYE İŞARETİ: v_siparis_bakiye'de SIPARIS_BORCU = −tutar,
//    TAHSILAT = +tutar (sql/65). Yani BORÇ NEGATİF, FAZLA TAHSİLAT POZİTİF.
//
//    kalanBakiye() pozitif bakiyeyi Math.max(0, …) ile SIFIRA KIRPIYORDU;
//    fazla tahsilat "Borç kapandı" diye görünüyordu. Canlı ölçüm
//    (35NSD813, 3 Ağu 2026): borç 1.670.000, tahsilat 1.530.000 + 150.000
//    = 1.680.000 → bakiye +10.000. Ekranda "0 ₺ · Borç kapandı" yazıyordu,
//    10.000 ₺ hiçbir yerde görünmüyordu.
//
//    Artık ikisi AYRI: kalanBakiye() = ödenmesi gereken, fazlaTahsilat() =
//    iade/mahsup edilmesi gereken.
function kalanBakiye() { return BAKIYE == null ? null : Math.max(0, -BAKIYE) }
function fazlaTahsilat() { return BAKIYE == null ? null : Math.max(0, BAKIYE) }
const fazlaVarMi = () => { const f = fazlaTahsilat(); return f != null && f > 0.005 }
// ⚠️ BAKİYE TAM SIFIR OLMALI (sql/149). Kısa süre `>= -0.005` denendi
//    ("borç kalmadı mı" mantığı); Göksenil düzeltti: fazla tahsilat da
//    teslimatı ve satışı ENGELLER, önce iade ya da mahsup gerekir.
//    Sunucudaki şart 5 ile AYNI eşik — ayrışırsa ekran ile kapı çelişir.
const bakiyeSifirMi = () => sifirMi(BAKIYE)
function tamamlanmaYuzde() {
  const anl = Number(S.anlasilan_tutar) || 0
  if (anl <= 0) return 0
  return Math.min(100, Math.round(100 * odenenToplam() / anl))
}

// --- Ana çizim -----------------------------------------------------------
function ciz() {
  hareketMenuKapat()   // KOK yeniden kurulacak; document.body'ye eklenen açık ⋮ menüsü öksüz kalmasın
  const a = one(S.stok_araclar), m = one(S.musteriler)
  const dan = danismanAdi(DMAP, S.danisman_id)
  const pil = durumPil()
  const kilit = kilitliMi()

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <div class="flex items-center gap-3 min-w-0">
        <a href="siparis.html" class="p-2 hover:bg-surface-container rounded-full shrink-0" title="Sipariş Merkezi'ne dön">${mat('arrow_back')}</a>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-label-sm font-bold text-on-surface-variant uppercase tracking-wider">Satış Dosyası</span>
            <span class="text-label-sm text-on-surface-variant">· Sipariş Merkezi / ${kacis(siparisNo())}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="px-3 py-1.5 rounded-full text-label-sm font-bold flex items-center gap-1.5 ${pil.sinif}">
          <span class="w-1.5 h-1.5 rounded-full bg-current"></span>${pil.metin}</span>
        <button id="sdYazdir" class="p-2 hover:bg-surface-container-high rounded-full border border-outline-variant" title="Yazdır">${mat('print')}</button>
        <button id="sdPaylas" class="p-2 hover:bg-surface-container-high rounded-full border border-outline-variant" title="Bağlantıyı kopyala">${mat('share')}</button>
        ${S.durum === 'ACIK' && !kilitliMi() ? `<button id="sdIptalBtn" class="px-3 py-2 rounded-lg border border-error/40 text-error text-label-md font-bold hover:bg-error/5 flex items-center gap-1.5">${mat('cancel', 'text-[18px]')} Sipariş İptal</button>` : ''}
      </div>
    </div>

    ${kilit ? `<div class="mb-4 bg-primary-fixed/60 border border-primary/20 text-on-primary-fixed rounded-xl p-3 flex items-center gap-2 text-body-md">
      ${mat('lock', 'text-[18px]')} Bu satış tamamlanmıştır. Finansal kayıtlar kilitlenmiştir.</div>` : ''}

    ${krediTransferBandHtml()}
    ${krediKartHtml()}
    ${ustKartHtml(a, m, dan)}
    ${tediyeEvrakiSeridi()}
    ${kpiHtml()}
    ${fazlaTahsilatSeridi()}
    ${aracGecmisHtml()}

    <div class="mt-4 md:mt-6 flex flex-col xl:flex-row gap-4 md:gap-5 items-start">
      <div class="w-full ${drawerAcik && !kilit ? 'xl:w-[440px]' : 'xl:w-[320px]'} shrink-0 flex flex-col gap-4">${solPanelHtml()}</div>
      <div class="flex-1 min-w-0 w-full flex flex-col gap-4 order-last xl:order-none">${sagPanelHtml()}</div>
      <div class="w-full xl:w-[320px] shrink-0 flex flex-col gap-4">${sagKolonHtml()}</div>
    </div>

    ${satisModalHtml()}
  `
  baglaOlaylar()
  // Cari işlem formu artık sayfanın içinde (sol kolon) — çizim sonrası kendi
  // olaylarını ve hazırlığını burada alır. Panel olduğu dönemde bu iş
  // drawerAc/aksiyonSec içinde yapılıyordu.
  if (drawerAcik && !kilit) { baglaDrawerOlaylari(); formHazirla() }
}

// R5→R6-4 Faz B: Müşterinin onaylı+kullandırılmamış kredisi varsa üstte bilgi
//   kartı — artık SALT-OKUNUR (Göksenil kararı: cari TEK yerden Can onayında
//   yazılır, çift-yazım riski). Danışman burada aksiyon ALAMAZ; kullandırım
//   kredi biriminde (kredi.html "Kullandırma Başla" → kredi-kullandirim.html
//   onayı) yapılır, onaylanınca cari'ye kırmızı KREDI_TAHSILAT işlenir.
function krediKartHtml() {
  if (!ONAYLI_KREDI || kilitliMi() || !kalanBakiye()) return ''   // borç yok/görünmüyorsa gizle
  const k = ONAYLI_KREDI
  return `<div class="mb-4 bg-[#EFF6FF] border border-[#3B82F6]/30 rounded-xl p-4 flex items-center gap-4 flex-wrap custom-shadow">
    <span class="w-11 h-11 rounded-xl bg-[#1D4ED8] text-white flex items-center justify-center shrink-0">${mat('account_balance', 'text-[24px]')}</span>
    <div class="flex-1 min-w-0">
      <div class="text-sm font-extrabold text-[#1D4ED8]">🏦 Bu müşterinin kullanılabilir onaylı kredisi bulunmaktadır</div>
      <div class="text-[12px] text-[#1D4ED8]/90 flex flex-wrap gap-x-5 gap-y-0.5 mt-1">
        <span>Banka: <b>${kacis(k.banka || '—')}</b></span>
        <span>Onaylanan Limit: <b>${k.onayli_limit != null ? fmtPara(k.onayli_limit) : '—'}</b></span>
        ${k.kredi_personeli && k.kredi_personeli !== '—' ? `<span>Kredi Personeli: <b>${kacis(k.kredi_personeli)}</b></span>` : ''}
      </div>
      <p class="text-[11px] text-[#1D4ED8]/80 mt-1.5 flex items-center gap-1">${mat('info', 'text-[14px]')} Onaylı kredi — kullandırım kredi biriminde yapılır; tamamlanınca cari'ye kırmızı işlenir.</p>
    </div>
  </div>`
}

// --- Kredi transferi (sql/80) ---------------------------------------------
// Danışman "kredi hesaba geçmedi" der → RPC durumu BEKLIYOR yapar, finans
// (Bahadır) kuyrukta kırmızı görür. 'GECTI' kullandırım onayında trigger'la
// olur — bu ekran ASLA GECTI yazmaz (para tek yerden yazılır, §14.1).
function krediTahsilatGeldiMi() {
  const tersli = tersliIdSeti()
  return HAREKETLER.some(h => h.alt_tip === 'KREDI_TAHSILAT' && !tersli.has(h.id))
}

function krediTransferBandHtml() {
  const d = S.kredi_transfer_durumu
  if (d === 'BEKLIYOR') return `<div class="mb-4 bg-error/5 border border-error/40 rounded-xl p-3 flex items-start gap-2">
      ${mat('error', 'text-[18px] text-error shrink-0 mt-0.5')}
      <div class="min-w-0">
        <p class="font-bold text-error text-body-md">Kredi transferi bekleniyor — finans bilgilendirildi</p>
        ${S.kredi_transfer_notu ? `<p class="text-label-sm text-on-surface-variant mt-0.5">Not: ${kacis(S.kredi_transfer_notu)}</p>` : ''}
      </div></div>`
  if (d === 'GECTI') return `<div class="mb-4 bg-secondary-container border border-secondary/30 rounded-xl p-3 flex items-center gap-2">
      ${mat('verified', 'text-[18px] text-on-secondary-container shrink-0')}
      <p class="font-bold text-on-secondary-container text-body-md">Kredi transferi tamamlandı</p></div>`
  return ''
}

const KREDI_DURUM_ET = {
  kuyrukta: 'Kuyrukta', islemde: 'İşlemde', bekliyor: 'Bekliyor', sonlandirildi: 'Sonlandırıldı',
}
const KREDI_SONUC_ET = { onayli: 'Onaylı', redli: 'Redli', vazgecildi: 'Vazgeçildi' }

// Göksenil, 3 Ağu 2026: "kredi transferi — araç kredili satılıyorsa kredinin son
//   durumu burada görünmeli; nakit satılıyorsa yani kredi modülünde bu aracın
//   kaydı yoksa burası pasif olmalı."
// KREDI_BASVURU null → NAKİT. Kart gizlenmez, PASİF gösterilir: danışman
// "kredi kartı yok" ile "kredi kaydı yok" arasındaki farkı görmeli.
function krediTransferKartHtml() {
  if (S.durum !== 'ACIK') return ''
  const bas = `<h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('account_balance', 'text-[20px] text-primary')} Kredi Transferi</h3>`
  const sar = govde => `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">${bas}${govde}</div>`

  // 1) Kredi modülünde kayıt yok → nakit satış
  if (!KREDI_BASVURU) {
    return sar(`<div class="w-full py-3 rounded-lg bg-surface-container-high text-outline font-bold text-label-md flex items-center justify-center gap-2">
        ${mat('payments', 'text-[18px]')} Nakit satış — kredi kaydı yok</div>
      <p class="text-label-sm text-on-surface-variant mt-2 text-center leading-relaxed">Kredi modülünde bu araca/müşteriye ait başvuru bulunamadı. Kredili satışa dönerse burası kendiliğinden açılır.</p>`)
  }

  const k = KREDI_BASVURU
  const sonuc = k.sonuc ? (KREDI_SONUC_ET[k.sonuc] || k.sonuc) : null
  const renk = k.sonuc === 'onayli' ? 'bg-secondary-container text-on-secondary-container'
    : k.sonuc === 'redli' ? 'bg-error-container text-on-error-container'
    : 'bg-[#EFF6FF] text-[#1D4ED8]'
  const ozet = `<div class="flex items-center gap-2 mb-3 py-2 px-3 rounded-lg ${renk} text-label-md font-bold">
      ${mat(k.sonuc === 'onayli' ? 'verified' : k.sonuc === 'redli' ? 'cancel' : 'hourglass_top', 'text-[18px]')}
      <span>Kredi dosyası: ${kacis(KREDI_DURUM_ET[k.durum] || k.durum)}${sonuc ? ' · ' + kacis(sonuc) : ''}</span>
      <a href="kredi.html" class="ml-auto text-[11px] underline font-normal shrink-0">Kredi modülü</a>
    </div>
    ${k.bekleme_nedeni ? `<p class="text-label-sm text-on-surface-variant mb-3">Bekleme nedeni: <b>${kacis(k.bekleme_nedeni)}</b></p>` : ''}`

  // 2) Para geldi / dosya kilitli → yalnız özet
  if (kilitliMi() || S.kredi_transfer_durumu === 'GECTI' || krediTahsilatGeldiMi()) return sar(ozet)

  // 3) Danışman "kredi geçmedi" diyebilir
  const bekliyor = S.kredi_transfer_durumu === 'BEKLIYOR'
  return sar(`${ozet}
      <button id="sdKrediTransferBtn" ${bekliyor ? 'disabled' : ''} class="w-full ${bekliyor ? 'bg-surface-container-high text-outline cursor-not-allowed' : 'border border-error/40 text-error hover:bg-error/5'} font-bold py-2.5 rounded-lg text-label-md flex items-center justify-center gap-2 transition-all">
        ${mat(bekliyor ? 'hourglass_top' : 'report', 'text-[18px]')} ${bekliyor ? 'Finans bilgilendirildi' : 'Kredi Geçmedi — Finansa Bildir'}</button>
      <p class="text-label-sm text-on-surface-variant mt-2 text-center leading-relaxed">${bekliyor
        ? 'Kredi hesaba geçince durum kullandırım onayıyla otomatik yeşile döner.'
        : 'Banka kredisi hesaba geçmediyse finans birimini bilgilendirin.'}</p>`)
}

async function krediTransferBildir() {
  const not = prompt('Finansa iletmek istediğiniz not (opsiyonel):', '')
  if (not === null) return   // Vazgeç
  const btn = document.getElementById('sdKrediTransferBtn')
  if (btn) { btn.disabled = true; btn.textContent = 'Bildiriliyor…' }
  const { error } = await supabase.rpc('kredi_transfer_bekliyor', { p_siparis: S.id, p_not: not.trim() || null })
  if (error) {
    dbHata('kredi transfer bekliyor', error)
    alert('Finansa bildirilemedi: ' + (error.message || 'bilinmeyen hata'))
    if (btn) { btn.disabled = false; btn.textContent = 'Kredi Geçmedi — Finansa Bildir' }
    return
  }
  await yukle()
}

// ---------- SİGORTA (sql/182) ----------
// Göksenil (10 Ağu 2026): "stoktaki bir araca sigorta teklifi istemeyeceğiz.
//   siparişe alındıktan sonra sigorta modülüne göndereceğiz, onlar aracın yeni
//   müşterisine sigortasını kesecekler."
//
// ⚠️ ÖNCESİ araç kartındaydı ve müşteriyi ELLE seçtiriyordu — stokta aracın
//   alıcısı henüz yok, o yüzden üç ayrı alan (arama kutusu / "bağlandı" satırı
//   / serbest "Müşteri Adı") aynı bilgiyi soruyordu. Ölçüldü: o buton canlıya
//   çıktığından beri sigorta_firsatlari'nda 0 kayıt — kimse kullanmamış.
//   Artık araç da müşteri de SİPARİŞTEN gelir, hiçbir şey elle yazılmaz.

// Poliçe kesmek için gereken alanlar (Göksenil): TCKN · doğum tarihi · plaka ·
// ruhsat seri no · kasko kodu. Eksikse gönderim engellenmez ama SÖYLENİR —
// sigorta birimi eksik veriyle poliçe kesemez, dosya orada bekler.
// Poliçeye gidecek alanların TEK kaynağı. Hem eksik listesi hem pop-up
// buradan beslenir — iki ayrı yerde hesaplanırsa biri düzeltilip öbürü
// unutuluyor (bu dosyada daha önce yaşandı).
//
// ⚠️ KASKO KODU HAM KOLONDAN OKUNMAZ. `kasko_kodu` çoğu araçta BOŞ; kod TSB
//   marka+tip'ten türetilir (veri.js `kaskoKodu()` tek kaynak). İlk sürümde
//   ham kolona baktığım için satış dosyasında kod GÖRÜNDÜĞÜ hâlde "eksik:
//   kasko kodu" yazıyordu (Göksenil, 10 Ağu 2026). Aynı tuzak 7 Ağu'da bu
//   dosyanın 809. satırında düzeltilmişti — uyarı orada duruyordu.
function sigortaAlanlari() {
  const a = one(S.stok_araclar) || {}
  const m = one(S.musteriler) || {}
  return [
    { etiket: 'TCKN',           deger: TCKN },
    { etiket: 'Doğum tarihi',   deger: m.dogum_tarihi ? fmtTarih(m.dogum_tarihi) : null },
    { etiket: 'Plaka',          deger: a.plaka ? B(a.plaka) : null },
    { etiket: 'Ruhsat seri no', deger: a.ruhsat_seri_no },
    { etiket: 'Kasko kodu',     deger: kaskoKodu(a) },
  ]
}

function sigortaEksikler() {
  return sigortaAlanlari().filter(x => !x.deger).map(x => x.etiket.toLocaleLowerCase('tr'))
}

const SIGORTA_DURUM_ET = {
  TEKLIF_BEKLIYOR: 'Teklif bekleniyor', TEKLIF_VERILDI: 'Teklif verildi',
  KAZANILDI: 'Poliçe kesildi', KAYBEDILDI: 'Kaybedildi', MUAF: 'Muaf (kendi yaptırıyor)',
}

// Sigorta biriminin girdiği teklif rakamları (sql/219). Göksenil:
// "sipariş dosyasındaki sigorta tagında girmiş olduğu rakamlar görünecek".
// Müşteri kendi yaptırsa bile BU rakam durur — danışman ne teklif
// ettiğimizi görebilmeli. Müşterinin başka yerden aldığı fiyat saklanmaz.
function sigortaTeklifHtml(f) {
  if (!f || (f.teklif_pesin == null && f.teklif_taksitli == null)) return ''
  const kutu = (et, tutar, alt) => `<div class="flex-1 min-w-0 bg-surface-container-low rounded-lg px-3 py-2">
      <div class="text-[10px] uppercase tracking-wide text-on-surface-variant">${et}</div>
      <div class="font-bold text-on-surface">${fmtPara(tutar)}</div>
      ${alt ? `<div class="text-[10px] text-on-surface-variant">${alt}</div>` : ''}</div>`
  return `<div class="flex gap-2 mt-2">
    ${f.teklif_pesin != null ? kutu('Peşin', f.teklif_pesin) : ''}
    ${f.teklif_taksitli != null ? kutu('Taksitli', f.teklif_taksitli, (f.teklif_taksit_ay || 12) + ' ay') : ''}
  </div>`
}

// Poliçe BIZDEN kesildiyse: nereden kesildiği + ne zaman bittiği.
// (Göksenil: "sigortanın nerden kesildiği, sigorta bitiş tarihi burada görünecek")
function sigortaPoliceHtml(f) {
  if (!f || !f.police_sirket_adi) return ''
  return `<div class="mt-2 px-3 py-2 rounded-lg bg-secondary-container text-on-secondary-container text-label-sm">
    <div class="flex items-center gap-1.5 font-bold">${mat('verified', 'text-[16px]')} ${kacis(f.police_sirket_adi)}</div>
    <div class="mt-0.5">${f.police_tur_adi ? kacis(f.police_tur_adi) + ' · ' : ''}${
      f.police_no ? 'No ' + kacis(f.police_no) + ' · ' : ''}Bitiş <b>${f.police_bitis ? fmtTarih(f.police_bitis) : '—'}</b></div>
  </div>`
}

function sigortaKartHtml() {
  const bas = `<h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('shield', 'text-[20px] text-primary')} Sigorta</h3>`
  const sar = govde => `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">${bas}${govde}</div>`

  // 1) Zaten gönderilmiş → durumu göster
  if (SIGORTA_FIRSAT) {
    const d = SIGORTA_FIRSAT.durum
    const renk = d === 'KAZANILDI' ? 'bg-secondary-container text-on-secondary-container'
      : d === 'KAYBEDILDI' ? 'bg-error-container text-on-error-container'
      : 'bg-[#EFF6FF] text-[#1D4ED8]'
    const ikon = d === 'KAZANILDI' ? 'verified' : d === 'KAYBEDILDI' ? 'cancel' : 'hourglass_top'
    return sar(`<div class="flex items-center gap-2 py-2 px-3 rounded-lg ${renk} text-label-md font-bold">
        ${mat(ikon, 'text-[18px]')}
        <span>${kacis(SIGORTA_DURUM_ET[d] || d)}</span>
        <a href="sigorta-firsat.html" class="ml-auto text-[11px] underline font-normal shrink-0">Sigorta modülü</a>
      </div>
      ${sigortaTeklifHtml(SIGORTA_FIRSAT)}
      ${sigortaPoliceHtml(SIGORTA_FIRSAT)}
      ${SIGORTA_FIRSAT.kayip_nedeni ? `<p class="text-label-sm text-on-surface-variant mt-2">Neden: <b>${kacis(SIGORTA_FIRSAT.kayip_nedeni)}</b></p>` : ''}
      <p class="text-label-sm text-on-surface-variant mt-2 text-center">${fmtTarih(SIGORTA_FIRSAT.created_at)} tarihinde gönderildi.</p>`)
  }

  // 2) Dosya kilitliyse yalnız bilgi
  if (kilitliMi()) return sar(`<div class="w-full py-3 rounded-lg bg-surface-container-high text-outline font-bold text-label-md flex items-center justify-center gap-2">
      ${mat('lock', 'text-[18px]')} Dosya kapalı</div>`)

  // 3) Gönderilebilir
  const eksik = sigortaEksikler()
  return sar(`<button id="sdSigortaGonderBtn" class="w-full bg-primary text-on-primary font-bold py-2.5 rounded-lg text-label-md flex items-center justify-center gap-2 hover:opacity-90 transition-all">
      ${mat('send', 'text-[18px]')} Sigortaya Gönder</button>
    ${eksik.length ? `<div class="mt-2 px-3 py-2 rounded-lg bg-[#FEF3C7] text-[#92400E] text-label-sm">
        ${mat('warning', 'text-[15px] align-middle')} <b>Poliçe için eksik:</b> ${kacis(eksik.join(', '))}.
        <span class="block mt-0.5 font-normal">Gönderebilirsiniz ama sigorta birimi bu bilgiler olmadan poliçe kesemez.</span>
      </div>`
    : `<p class="text-label-sm text-on-surface-variant mt-2 text-center leading-relaxed">Araç ve alıcı bilgileri siparişten gider — TCKN, doğum tarihi, plaka, ruhsat seri no ve kasko kodu hazır.</p>`}`)
}

// ⚠️ confirm() KULLANILMAZ. Tarayıcının kendi kutusu hem sistemin dışında
//   duruyor hem de yalnız düz metin alıyor — "ne gönderiliyor" gösterilemiyor.
//   Göksenil (10 Ağu 2026): "uyarı bana chrome'dan geliyor, pop-up olarak
//   gelsin istiyorum." Pop-up gidecek ALANLARI tek tek gösterir; eksik olan
//   sarı, dolu olan yeşil — danışman göndermeden önce ne eksik görür.
function sigortayaGonder() {
  const a = one(S.stok_araclar) || {}
  const m = one(S.musteriler) || {}
  const alanlar = sigortaAlanlari()
  const eksikSayi = alanlar.filter(x => !x.deger).length

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[95] flex items-start justify-center pt-[10vh] px-4 bg-black/40 backdrop-blur-sm'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-5 py-4 border-b border-outline-variant">
      <h3 class="text-title-lg font-bold text-primary flex items-center gap-2">${mat('shield')} Sigortaya Gönder</h3>
      <button class="sg-kapat p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button>
    </div>
    <div class="p-5 space-y-3">
      <p class="text-body-md text-on-surface-variant">Bu araç için sigorta biriminden teklif istenecek. Birim <b>Fırsatlar</b> ekranından görür ve poliçeyi <b>aracın yeni sahibine</b> keser.</p>
      <div class="rounded-xl border border-outline-variant overflow-hidden">
        <div class="px-3 py-2 bg-surface-container text-label-md font-bold text-on-surface">${B(a.plaka || '—')} · ${kacis(buyuk(m.ad_soyad || '—'))}</div>
        ${alanlar.map(x => `<div class="flex items-center justify-between px-3 py-2 border-t border-outline-variant/60 text-body-md">
            <span class="text-on-surface-variant">${kacis(x.etiket)}</span>
            ${x.deger
              ? `<span class="font-bold text-on-surface flex items-center gap-1">${mat('check_circle', 'text-[15px] text-[#1a7a3d]')} ${kacis(String(x.deger))}</span>`
              : `<span class="font-bold text-[#92400E] bg-[#FEF3C7] px-2 py-0.5 rounded flex items-center gap-1">${mat('warning', 'text-[14px]')} eksik</span>`}
          </div>`).join('')}
      </div>
      ${eksikSayi ? `<div class="px-3 py-2 rounded-lg bg-[#FEF3C7] text-[#92400E] text-label-sm">
          <b>${eksikSayi} bilgi eksik.</b> Gönderebilirsiniz ama sigorta birimi bu bilgiler olmadan poliçe kesemez; dosya onlarda bekler.
        </div>` : ''}
      <div id="sgDurum" class="text-label-md"></div>
    </div>
    <div class="flex justify-end gap-2 px-5 pb-5">
      <button class="sg-kapat px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="sgOnayla" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('send', 'text-[18px]')} Gönder</button>
    </div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelectorAll('.sg-kapat').forEach(x => x.addEventListener('click', kapat))
  ov.querySelector('#sgOnayla').addEventListener('click', () => sigortaFirsatiYaz(ov, a, m))
}

async function sigortaFirsatiYaz(ov, a, m) {
  const btn = ov.querySelector('#sgOnayla')
  const durum = ov.querySelector('#sgDurum')
  btn.disabled = true; btn.textContent = 'Gönderiliyor…'

  // ⚠️ arac_id KULLANILMAZ: o kolon sigorta_araclari'na FK'lidir (sigorta
  //   modülünün kendi araç kütüğü). CRM aracı crm_arac_ref (text) ile taşınır.
  //   arac_id yazılırsa FK ihlali alınır — canlıda ölçüldü.
  // ⚠️ Mükerrer engeli PARTIAL unique index; upsert ÇALIŞMAZ (CLAUDE.md §5/2).
  //   Düz insert edilir, çakışma olursa aşağıda yakalanır.
  // Kasko kodu HAM KOLONDAN değil kaskoKodu() yardımcısından — kolon çoğu
  // araçta boş, kod TSB marka+tip'ten türetilir (bkz. sigortaAlanlari notu).
  const notParcalari = [
    [a.marka, a.model, a.versiyon, a.yil].filter(Boolean).join(' '),
    a.ruhsat_seri_no ? 'Ruhsat: ' + a.ruhsat_seri_no : null,
    kaskoKodu(a) ? 'Kasko kodu: ' + kaskoKodu(a) : null,
  ].filter(Boolean)

  const { error } = await supabase.from('sigorta_firsatlari').insert({
    siparis_id: SIP_ID,
    crm_arac_ref: S.arac_id ? String(S.arac_id) : null,
    crm_musteri_id: S.alici_musteri_id || null,
    plaka: (a.plaka || '').trim() || null,
    musteri_adi: buyuk(m.ad_soyad || '') || null,
    talep_eden: BEN?.email || null,
    durum: 'TEKLIF_BEKLIYOR',
    not_metni: notParcalari.join(' — ') || null,
  })
  if (error) {
    dbHata('sigorta fırsatı gönder', error)
    // Hata da pop-up'ın İÇİNDE gösterilir — tarayıcı kutusuna düşmez.
    durum.innerHTML = `<span class="text-error">${kacis(error.code === '23505'
      ? 'Bu sipariş için zaten açık bir sigorta talebi var.'
      : 'Gönderilemedi: ' + (error.message || 'bilinmeyen hata'))}</span>`
    btn.disabled = false; btn.textContent = 'Gönder'
    return
  }
  durum.innerHTML = `<span class="text-secondary flex items-center gap-1">${mat('check_circle', 'text-[16px]')} Sigorta birimine gönderildi.</span>`
  setTimeout(() => { ov.remove(); yukle() }, 1000)
}

function ustKartHtml(a, m, dan) {
  const yuzde = tamamlanmaYuzde()
  const kalan = kalanBakiye()
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-hidden">
    <div class="flex flex-col md:flex-row">
      <div class="w-full md:w-64 h-44 md:h-auto relative bg-surface shrink-0 border-b md:border-b-0 md:border-r border-outline-variant">
        ${KAPAK ? `<img src="${kacis(KAPAK)}" alt="" class="w-full h-full object-cover" onerror="this.style.display='none'" />`
          : `<div class="w-full h-full flex items-center justify-center text-on-surface-variant">${mat('directions_car', 'text-4xl opacity-50')}</div>`}
        ${a?.plaka ? `<span class="absolute left-3 bottom-3 bg-white/95 border border-outline-variant px-2.5 py-1 rounded-lg text-label-md font-bold shadow-sm">${B(a.plaka)}</span>` : ''}
      </div>
      <div class="flex-1 p-4 md:p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p class="text-[11px] text-on-surface-variant uppercase font-bold tracking-wider">Araç Bilgisi</p>
          <p class="text-title-lg font-bold text-on-surface">${B(aracBaslik(a))}</p>
          <p class="text-body-md text-on-surface-variant">${B(a?.versiyon) || ''}</p>
        </div>
        <div class="md:text-right">
          <p class="text-[11px] text-on-surface-variant uppercase font-bold tracking-wider">Satış Danışmanı</p>
          <div class="flex items-center gap-2 md:justify-end mt-0.5">
            <span class="text-body-md font-semibold text-on-surface">${B(dan) || '—'}</span>
            <div class="w-7 h-7 rounded-full bg-primary-fixed text-primary text-[11px] flex items-center justify-center font-bold shrink-0">${basHarf(dan)}</div>
          </div>
        </div>
        <div>
          <p class="text-[11px] text-on-surface-variant uppercase font-bold tracking-wider">Müşteri</p>
          <p class="text-body-md font-semibold text-on-surface">${B(m?.ad_soyad) || '—'}</p>
          <p class="text-label-sm text-on-surface-variant">${kacis(m?.telefon || '—')}</p>
        </div>
        <div class="md:text-right">
          <p class="text-[11px] text-on-surface-variant uppercase font-bold tracking-wider">Tahsilat Durumu</p>
          <div class="flex items-center gap-2 md:justify-end mt-1">
            <div class="w-24 h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full ${fazlaVarMi() ? 'bg-error' : 'bg-secondary'}" style="width:${yuzde}%"></div></div>
            <span class="text-label-sm font-bold ${fazlaVarMi() ? 'text-error' : 'text-secondary'}">%${yuzde}</span>
          </div>
          <p class="text-[11px] text-on-surface-variant mt-1">${
            // ⚠️ Fazla tahsilatta eskiden "Kalan Bakiye: 0 ₺" + %100 yazıyordu;
            //    sayfanın geri kalanı "10.000 ₺ fazla" derken burası kapanmış
            //    gösteriyordu. Aynı olguya iki cevap kalmasın.
            fazlaVarMi()
              ? `Fazla Tahsilat: <b class="text-error">${fmtPara(fazlaTahsilat())}</b>`
              : `Kalan Bakiye: <b class="${kalan ? 'text-error' : 'text-secondary'}">${kalan == null ? '—' : fmtPara(kalan)}</b>`}</p>
        </div>
      </div>
    </div>
    ${aracDosyaSeridiHtml(a)}
  </div>`
}

// Göksenil, 3 Ağu 2026: "araç siparişte iken yukarıdaki kartta olması gereken —
//   araç ekspertizi / tramer bilgisi / ruhsatı / kasko kodu / aracın eski sahibi
//   (aracı stoğa kaydederken girdiğimiz müşteri) / aracın yedek anahtar durumu"
// Belge kutuları TIKLANABİLİR (yeni sekmede açar); belge yoksa gri "yok" der —
// var gibi görünüp boş açılan bir bağlantı bırakmıyoruz.
// ⚠️ BELGE AÇMA: arac_evraklar.url bir URL DEĞİL, `arac-evrak` bucket'ındaki
//   YOLDUR. Önce doğrudan <a href> verilmişti → tarayıcı yolu sayfaya göre
//   çözdü ve ekspertiz/tramer/ruhsat 404 döndü (3 Ağu 2026). Bucket ÖZEL;
//   erişim imzalı URL ile ve pop-up içinde (evrakAc).

// --- Bu aracın geçmişi (şasi eşleşmesi) ------------------------------
// Göksenil'in istediği dört alan: satış tarihi · araç plakası · müşteri
//   ad soyad · satış danışmanı. Kaynak da yazılıyor ki "GURU arşivi mi,
//   bu sistemde mi" ayırt edilsin.
// Kayıt yoksa kart HİÇ çizilmez — boş kutu yer kaplar, bilgi taşımaz.
function aracGecmisHtml() {
  if (!GECMIS_SATIS.length && !PLAKA_IZ.length) return ''
  const satis = GECMIS_SATIS.map(g => `<tr class="border-b border-outline-variant/40 last:border-0">
      <td class="px-2 py-1.5 whitespace-nowrap text-body-sm">${g.satis_tarihi ? kacis(fmtTarihKisa(g.satis_tarihi)) : '—'}</td>
      <td class="px-2 py-1.5 font-mono font-bold text-body-sm whitespace-nowrap">${B(g.plaka) || '—'}</td>
      <td class="px-2 py-1.5 text-body-sm truncate">${B(g.musteri_ad_soyad) || '—'}</td>
      <td class="px-2 py-1.5 text-body-sm text-on-surface-variant truncate">${B(g.danisman_ad) || '—'}</td>
      <td class="px-2 py-1.5 text-right"><span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${g.kaynak === 'GURU' ? 'bg-surface-container-high text-on-surface-variant' : 'bg-primary/10 text-primary'}">${kacis(g.kaynak || '')}</span></td>
    </tr>`).join('')

  const iz = PLAKA_IZ.map(p => `<div class="flex items-center gap-2 text-[12px] py-1">
      <span class="font-mono font-bold">${B(p.eski_plaka)}</span>
      ${mat('arrow_forward', 'text-[14px] text-on-surface-variant')}
      <span class="font-mono font-bold text-primary">${B(p.yeni_plaka)}</span>
      <span class="ml-auto text-on-surface-variant">${kacis(fmtTarihKisa(p.degisim_tarihi))}</span>
    </div>`).join('')

  const ic = `
    ${GECMIS_SATIS.length ? `<div class="overflow-x-auto"><table class="w-full text-left border-collapse min-w-[520px]">
        <thead><tr class="text-[10px] uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
          <th class="px-2 py-1.5">Satış Tarihi</th><th class="px-2 py-1.5">Plaka</th>
          <th class="px-2 py-1.5">Müşteri</th><th class="px-2 py-1.5">Danışman</th><th class="px-2 py-1.5"></th></tr></thead>
        <tbody>${satis}</tbody></table></div>` : ''}
    ${PLAKA_IZ.length ? `<div class="${GECMIS_SATIS.length ? 'mt-3 pt-3 border-t border-outline-variant/60' : ''}">
        <p class="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Plaka Değişim İzi</p>
        ${iz}</div>` : ''}
    <p class="text-[11px] text-on-surface-variant mt-2">${mat('info', 'text-[13px] align-middle')} Eşleştirme <b>şasi no</b> ile yapılır — araç geri alınınca yeni kayıt açıldığı ve plaka değişebildiği için tek sabit alan odur.</p>`

  // ⚠️ Bu dosyada global bir kart() yardımcısı YOK (750. satırdaki yerel bir
  //   sabit). Noter Satış Bilgisi kartıyla aynı sarmalayıcı elle yazıldı;
  //   olmayan bir yardımcıyı çağırmak çalışma anında patlardı.
  return `<div class="mt-4 bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <h3 class="font-bold text-on-surface flex items-center gap-2">${mat('history', 'text-[20px] text-primary')} Bu Aracın Geçmişi</h3>
        ${GECMIS_SATIS.length ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">${GECMIS_SATIS.length} önceki satış</span>` : ''}
      </div>
      ${ic}
    </div>`
}

function aracDosyaSeridiHtml(a) {
  const kutu = (ikon, etiket, deger, opt = {}) => {
    const govde = `<span class="w-8 h-8 rounded-lg ${opt.vurgu || 'bg-surface-container-high text-on-surface-variant'} flex items-center justify-center shrink-0">${mat(ikon, 'text-[18px]')}</span>
      <div class="min-w-0 text-left">
        <p class="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">${etiket}</p>
        <p class="text-label-md font-bold text-on-surface truncate">${deger}</p>
      </div>`
    if (opt.yol) {
      return `<button class="sd-evrak w-full flex items-center gap-2 p-2 rounded-lg hover:bg-primary-fixed/30 transition-colors cursor-pointer"
        data-yol="${kacis(opt.yol)}" data-ad="${kacis(etiket)}" title="${kacis(etiket)} — pop-up'ta aç">${govde}</button>`
    }
    if (opt.balon) {
      return `<div class="sd-balon flex items-center gap-2 p-2 rounded-lg hover:bg-surface-container-high transition-colors cursor-help" data-balon="${kacis(opt.balon)}">${govde}</div>`
    }
    return `<div class="flex items-center gap-2 p-2">${govde}</div>`
  }
  const yok = '<span class="text-on-surface-variant font-normal">—</span>'
  const eski = one(ALIS?.musteriler)?.ad_soyad
  const ruhsatYol = EVRAK.RUHSAT || null
  const anahtar = a?.yedek_anahtar
  const tramerYol = EVRAK.SBM_GORSEL || null

  return `<div class="border-t border-outline-variant bg-surface-container-low/60 px-2 py-1.5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-2 gap-y-0.5">
    <div class="flex items-center gap-1">
      <div class="min-w-0 flex-1">${kutu('fact_check', 'Ekspertiz',
        EVRAK.EKSPERTIZ_PDF ? (a?.ekspertiz_orijinal === false ? 'Raporu Aç · işlem var' : 'Raporu Aç') : yok,
        { yol: EVRAK.EKSPERTIZ_PDF, vurgu: EVRAK.EKSPERTIZ_PDF ? 'bg-primary-fixed text-primary' : '' })}</div>
      ${satildiMi() ? '' : guncelIsteBtnHtml(S.guncel_ekspertiz_istendi)}
    </div>
    ${kutu('report', 'Tramer',
      a?.tramer_temiz === true ? (tramerYol ? 'Temiz · SBM' : 'Temiz')
        : a?.tramer_temiz === false ? (tramerYol ? 'Kayıt var · SBM' : 'Kayıt var')
        : (tramerYol ? 'SBM Belgesi' : yok),
      { yol: tramerYol, vurgu: a?.tramer_temiz === false ? 'bg-amber-100 text-amber-800' : a?.tramer_temiz === true ? 'bg-secondary-container text-on-secondary-container' : '' })}
    ${kutu('description', 'Ruhsat',
      B(a?.ruhsat_seri_no) || (ruhsatYol ? 'Belgeyi Aç' : yok),
      { yol: ruhsatYol, vurgu: ruhsatYol ? 'bg-primary-fixed text-primary' : '' })}
    ${/* ⚠️ HAM KOLON DEĞİL, `kaskoKodu(a)` yardımcısı. `kasko_kodu` kolonu
          çoğu araçta BOŞ — kod TSB marka+tip'ten türetilir (veri.js tek
          kaynak). Burada ham kolon okunduğu için 48AYH876'da "—" yazıyordu,
          oysa tsb 021-1897 duruyordu (Göksenil, 7 Ağu 2026). Aynı kart
          Excel/yazdır çıktısında ZATEN yardımcıyı kullanıyordu; ekran ile
          çıktı birbirini tutmuyordu. */''}
    ${kutu('shield', 'Kasko Kodu', B(kaskoKodu(a)) || yok)}
    ${kutu('person', 'Eski Sahibi', eski ? B(eski) : yok, { balon: eski ? 'eski' : '' })}
    ${kutu('key', 'Yedek Anahtar',
      anahtar === true ? 'Var' : anahtar === false ? 'YOK' : yok,
      { vurgu: anahtar === false ? 'bg-error-container text-on-error-container' : anahtar === true ? 'bg-secondary-container text-on-secondary-container' : '' })}
  </div>`
}

// --- "Güncel İste" — güncel kilometreli ekspertiz isteği ------------------
// Pencere, mesaj metni, ruhsat paylaşımı ve düğme HTML'i guncel-ekspertiz.js'e
// TAŞINDI (TEK KAYNAK): kredi kuyruğu da aynı akışı açıyor, iki kopya tutmak
// düzeltmeyi bir tarafta unutmak demekti. Davranış birebir aynı; burada yalnız
// bu ekranın bağlamı (araç, ruhsat yolu, firma, sipariş RPC'si) hazırlanıyor.
function sdGuncelEkspertizAc() {
  const a = one(S.stok_araclar)
  return guncelEkspertizAc({
    plaka: a?.plaka, baslik: aracBaslik(a), sasi: a?.sasi_no,
    ruhsatYol: EVRAK.RUHSAT || null,
    firma: a?.ekspertiz_firma ? EKSPERTIZ_FIRMA[a.ekspertiz_firma] || null : null,
    // Firma kayitli degilse pencere depodaki PDF'ten TANIR ve araca yazar
    // (Goksenil: "senin biliyor olman lazim ekspertiz firmasini").
    aracId: a?.id || null,
    ekspertizYol: EVRAK.EKSPERTIZ_PDF || null,
    firmalar: Object.entries(EKSPERTIZ_FIRMA).map(([kod, f]) => ({ kod, ...f })),
    istek: () => supabase.rpc('guncel_ekspertiz_iste', { p_siparis: S.id }),
    yenile: yukle,
  })
}

// Eski sahibi balonu — Göksenil: "eski sahibi mouse over ile pop up açılacak".
// ⚠️ Alış FİYATI gösterilmiyor: bu bir SATIŞ dosyası, alış maliyeti burada
//   işi olmayan bir bilgi. Sorgusuna da eklenmedi (bkz. yukle()).
let ESKI_BALON = null
function eskiSahipBalonAc(hedef) {
  eskiSahipBalonKapat()
  const m = one(ALIS?.musteriler); if (!m) return
  const el = document.createElement('div')
  el.className = 'fixed z-[95] w-64 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl p-3'
  el.innerHTML = `<p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Aracın Eski Sahibi</p>
    <p class="font-bold text-on-surface">${B(m.ad_soyad)}</p>
    ${m.telefon ? `<p class="text-label-md text-on-surface-variant tabular-nums mt-0.5">${kacis(telNo(m.telefon))}</p>` : ''}
    ${ALIS?.alis_tarihi ? `<p class="text-[11px] text-on-surface-variant mt-1.5 pt-1.5 border-t border-outline-variant/60">Alış tarihi: <b>${kacis(fmtTarih(ALIS.alis_tarihi).split(' ')[0])}</b></p>` : ''}`
  document.body.appendChild(el)
  const r = hedef.getBoundingClientRect()
  el.style.left = Math.max(8, Math.min(window.innerWidth - 272, r.left)) + 'px'
  let top = r.bottom + 6
  if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - el.offsetHeight - 6)
  el.style.top = top + 'px'
  ESKI_BALON = el
}
function eskiSahipBalonKapat() { if (ESKI_BALON) { ESKI_BALON.remove(); ESKI_BALON = null } }

// Fazla tahsilat şeridi — KPI kartlarının hemen üstünde, gözden kaçmasın.
// İptal edilmiş siparişte bu doğrudan İADE BORCUdur: borç satırı silinmiş,
// tahsilat duruyor (canlı örnek 35CMF667, 500.000 ₺).
function fazlaTahsilatSeridi() {
  if (!fazlaVarMi()) return ''
  const iptal = S.durum === 'IPTAL'
  return `<div class="mt-4 flex items-start gap-2 p-3 rounded-xl border ${iptal ? 'bg-error-container border-error/40' : 'bg-amber-50 border-amber-300'}">
    ${mat('account_balance_wallet', (iptal ? 'text-error' : 'text-amber-700') + ' text-[20px] shrink-0')}
    <div class="min-w-0">
      <p class="font-bold ${iptal ? 'text-on-error-container' : 'text-amber-900'}">
        ${iptal ? 'İade bekliyor' : 'Fazla tahsilat'}: ${fmtPara(fazlaTahsilat())}</p>
      <p class="text-label-md ${iptal ? 'text-on-error-container/80' : 'text-amber-800'}">
        ${iptal
          ? 'Sipariş iptal edildi; borç kaydı düştü ama tahsilat duruyor. Bu tutar müşteriye iade edilmeli ya da başka bir dosyaya mahsup edilmeli.'
          : 'Müşteri borcundan fazla ödemiş. Bakiye tam sıfırlanmadan teslimat onaya gönderilemez, dolayısıyla satış da yapılamaz. Fazlayı iade edin ya da bir sonraki işleme mahsup edin.'}</p>
    </div></div>`
}

// --- D3: Tediye evrağı şeridi (Göksenil, 12 Ağu 2026) ----------------------
// "Noter satış beyanıyla resmî tahsilat arasında 48.000 ₺ fark vardır… bu
//  uyarının yukarıda belirgin olması gerekiyor. alındı ise teslimat onaya
//  gönderebilecek alınmadı ise gönderemeyecek."
//
// Uyarı eskiden Noter kartının içinde, sayfanın aşağısında, sıradan bir not
// olarak duruyordu ve hiçbir şeyi engellemiyordu. Artık künyenin hemen altında
// ve teslimat kapısının şartı (sql/198).
//
// ⚠️ FARK YOKSA HİÇ GÖRÜNMEZ — her gün görülen ekranda sürekli duran uyarı
//    bir süre sonra okunmaz olur.
// ⚠️ KAPI SUNUCUDA. Buradaki kutu yalnız işareti koyar; "gönderilebilir mi"
//    kararını teslimata_gonderilebilir verir.
function noterFarki() {
  const bedel = S.noter_satis_tutari != null ? Number(S.noter_satis_tutari) : null
  if (bedel == null) return null
  const fark = RESMI - bedel
  return sifirMi(fark) ? null : fark
}

// İşareti koyma yetkisi: dosyanın danışmanı + finans/satış müdürü + muhasebe +
// master. Geri alma YALNIZ finans/muhasebe/master (sql/198 ile aynı kural —
// sunucu son sözü söyler, buradaki yalnız aynası).
function tediyeGeriAlabilir() {
  return !!(BEN && (BEN.master_admin || BEN.rol === 'yonetici' || BEN.rol === 'muhasebe'
    || BEN.mudur_birim === 'finans' || BEN.mudur_birim === 'satis'))
}
function tediyeIsaretleyebilir() {
  return tediyeGeriAlabilir() || (BEN && S.danisman_id === BEN.id)
}

function tediyeEvrakiSeridi() {
  const fark = noterFarki()
  if (fark == null) return ''
  const alindi = !!S.tediye_evraki_alindi
  const kilit = satildiMi()
  const yetki = alindi ? tediyeGeriAlabilir() : tediyeIsaretleyebilir()
  const eden = S.tediye_evraki_eden ? danismanAdi(DMAP, S.tediye_evraki_eden) : null

  return `<div class="mt-4 flex items-start gap-3 p-3.5 rounded-xl border ${
    alindi ? 'bg-secondary-container/40 border-secondary/40' : 'bg-amber-50 border-amber-300'}">
    ${mat(alindi ? 'task_alt' : 'warning', (alindi ? 'text-secondary' : 'text-amber-700') + ' text-[22px] shrink-0')}
    <div class="min-w-0 flex-1">
      <p class="font-bold ${alindi ? 'text-secondary' : 'text-amber-900'}">
        Noter beyanı ile resmî tahsilat arasında ${fmtPara(Math.abs(fark))} fark var</p>
      <p class="text-label-md ${alindi ? 'text-on-surface-variant' : 'text-amber-800'} mt-0.5">
        ${alindi
          ? `Bu tutar kadar tediye evrağı <b>alındı</b>${eden ? ` — ${kacis(eden)}` : ''}${S.tediye_evraki_zamani ? ` · ${fmtTarihKisa(S.tediye_evraki_zamani)}` : ''}.`
          : 'Bu tutar kadar <b>tediye evrağı alınmalı</b>. Alınmadan teslimat kontrole gönderilemez.'}</p>
    </div>
    ${kilit ? '' : `<button id="sdTediyeBtn" ${yetki ? '' : 'disabled'}
      class="shrink-0 px-3 py-2 rounded-lg text-label-md font-bold border transition-all ${
        yetki
          ? (alindi ? 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
                    : 'border-amber-500 bg-amber-500 text-white hover:opacity-90')
          : 'border-outline-variant text-outline cursor-not-allowed'}"
      title="${yetki ? '' : (alindi ? 'İşareti yalnız finans müdürü, muhasebe veya master admin geri alabilir.' : 'Bu dosyada işaret koyma yetkiniz yok.')}">
      ${alindi ? 'İşareti geri al' : 'Tediye evrağı alındı'}</button>`}
  </div>`
}

async function tediyeEvrakiTikla() {
  const yeni = !S.tediye_evraki_alindi
  if (!yeni && !confirm('Tediye evrağı işareti geri alınacak.\n\nBu dosya teslimat kontrolüne gönderilemez hâle gelecek. Devam edilsin mi?')) return
  const btn = document.getElementById('sdTediyeBtn')
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…' }
  const { data, error } = await supabase.rpc('tediye_evraki_isaretle', { p_siparis: S.id, p_alindi: yeni })
  if (error) { dbHata('tediye evrağı işaretle', error); alert('Kaydedilemedi: ' + error.message); await yukle(); return }
  if (!data?.ok) { alert(data?.neden || 'Kaydedilemedi.'); await yukle(); return }
  await yukle()
}

function kpiHtml() {
  const liste = LISTE_FIYAT != null ? Number(LISTE_FIYAT) : null
  const anlasilan = S.anlasilan_tutar != null ? Number(S.anlasilan_tutar) : null
  const iskonto = (liste != null && anlasilan != null) ? liste - anlasilan : null
  const kalan = kalanBakiye()
  const kart = (etiket, deger, altHtml, accent, doluMu, id) => `
    <div class="${doluMu ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest border border-outline-variant'} p-4 rounded-xl custom-shadow flex flex-col justify-between gap-1.5 border-l-4 ${accent}">
      <p class="text-label-sm ${doluMu ? 'text-on-primary/80' : 'text-on-surface-variant'} uppercase tracking-wider font-medium">${etiket}</p>
      <span ${id ? `id="${id}"` : ''} class="text-2xl font-bold ${doluMu ? 'text-on-primary' : 'text-on-surface'}">${deger}</span>
      ${altHtml || ''}
    </div>`
  return `<div class="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 mt-4 md:mt-5">
    ${kart('Liste Fiyatı', liste != null ? fmtPara(liste) : '—', '', 'border-l-outline-variant', false)}
    ${kart('Anlaşılan Fiyat', anlasilan != null ? fmtPara(anlasilan) : '—',
      iskonto != null && iskonto !== 0 ? `<span class="text-label-sm font-bold ${iskonto > 0 ? 'text-secondary' : 'text-error'}">${iskonto > 0 ? '−' : '+'}${fmtPara(Math.abs(iskonto))} ${iskonto > 0 ? 'iskonto' : ''}</span>` : '',
      'border-l-primary', false)}
    ${kart('Ödenen Toplam', fmtPara(odenenToplam()), '<span class="text-label-sm font-bold text-secondary">Tahsil edildi</span>', 'border-l-secondary', false)}
    ${(() => {
      // Üç durum: kalan borç · tam kapalı · FAZLA TAHSİLAT. Üçüncüsü
      // eskiden sıfıra kırpılıp "Borç kapandı" görünüyordu.
      const fazla = fazlaTahsilat()
      if (fazlaVarMi()) return kart('Güncel Bakiye', fmtPara(fazla),
        `<span class="text-label-sm font-bold text-on-primary">${mat('warning', 'text-[15px] align-middle')} Fazla tahsilat — iade/mahsup gerekir</span>`,
        'border-l-error', true, 'sdGuncelBakiyeDeger')
      return kart('Güncel Bakiye', kalan == null ? '—' : fmtPara(kalan),
        `<span class="text-label-sm font-medium text-on-primary/80">${kalan ? 'Kalan tahsilat' : 'Borç kapandı'}</span>`,
        'border-l-primary-fixed', true, 'sdGuncelBakiyeDeger')
    })()}
  </div>`
}

// R8 — "Satışı Gerçekleştir" (noter) kapısı.
// Göksenil, 3 Ağu 2026: "satışı gerçekleştir butonu pasifte durmalı çünkü henüz
//   teslimat onaydan sorgu dönmedi (teslimat onaya gönderip Bahadır onaylayacaktı)"
// ⚠️ kilitliMi() BURADA KULLANILAMAZ: teslimat onaya gidince kilit zaten true
//   oluyor (cari defteri kapatmak için). Kilit = cari yazma yasağı; noter kapısı
//   AYRI bir boyut. İkisini aynı bayrağa bağlarsak buton hiç açılmaz.
function noterKapisi() {
  if (satildiMi())               return { acik: false, not: 'Noter bilgileri kayıtlı — satış tamamlandı.' }
  if (S.durum !== 'ACIK')        return { acik: false, not: 'Dosya açık değil.' }
  const td = S.teslimat_durumu
  if (td === 'ONAYLANDI')        return { acik: true,  not: 'Finans onayladı — noter bilgilerini girerek satışı kesinleştirin.' }
  if (td === 'ONAY_BEKLIYOR')    return { acik: false, not: 'Finans kontrolünde — onay dönmeden noter satışı yapılamaz.' }
  if (td === 'IADE')             return { acik: false, not: 'Finans dosyayı iade etti — düzeltip tekrar gönderin.' }
  return { acik: false, not: 'Önce dosyayı teslimat kontrolüne gönderin; finans onayladıktan sonra açılır.' }
}

function solPanelHtml() {
  const kilit = kilitliMi()
  const noter = noterKapisi()
  // Evraklar SOL kolonun BAŞINDA — Teslimat Kontrolü sağ kolonun başında.
  //   İkisi karşılıklı duruyor; "biri solda biri sağda" böyle okunuyor.
  //   Altta kalırsa dosyayı açan onları görmüyor (ilk hâlinde 1331px'deydi).
  //
  // ⚠️ NOTER SATIŞ BİLGİSİ ARTIK EN ÜSTTE (Göksenil, 21 Ağu 2026:
  //   "Noter Satış Bilgisi tagını cari işlem merkezinin üzerine taşı").
  //   Sebebi sıralama zevki değil: sql/233 ile bu kartın iki alanı
  //   (noter satış bedeli + "plaka değişecek mi?") teslimat onayının
  //   ÖN KOŞULU oldu. Kart cari defterin altında kalınca danışman onu
  //   görmeden aşağı iniyor, sonra kapıya takılıp neden takıldığını
  //   arıyordu. Kapının şartı yukarıda sorulur.
  return `
    ${noterBilgiKartHtml()}
    ${cariIslemKartiHtml(kilit)}
    ${evrakPaneliHtml(evrakCtx())}
    ${gorusmeNotuHtml()}
    ${/* ⚠️ Satış TAMAMLANDIYSA ölü düğme basma. Noter devri artık onaya
          göndermeden önce giriliyor (sql/226) ve satis_tarihi o anda
          doluyor; buton anında "disabled + satış tamamlandı" hâline
          düşüyor, ekranda anlamsız bir kilit duruyordu (Göksenil,
          19 Ağu: "satışı gerçekleştir pasif"). Tamamlanmışsa DURUMU
          gösteriyoruz + noter künyesini düzeltme yolu bırakıyoruz. */''}
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
      ${satildiMi() ? `
        <div class="w-full py-3 rounded-lg bg-secondary-container text-on-secondary-container font-bold text-label-md flex items-center justify-center gap-2">
          ${mat('verified', 'text-[18px]')} Satış Tamamlandı</div>
        <p class="text-label-sm text-on-surface-variant mt-2 text-center leading-relaxed">
          ${/* ⚠️ B() zaten kacis() uyguluyor — dışına ikinci kacis() koyma,
                 metin "&amp;" gibi görünür. */''}
          ${[B(S.noter_adi) || null,
             S.yevmiye_no ? 'Yevmiye ' + kacis(S.yevmiye_no) : null,
             S.satis_tarihi ? kacis(fmtTarihKisa(S.satis_tarihi)) : null]
            .filter(Boolean).join(' · ') || 'Noter bilgileri kayıtlı.'}</p>
        ${!noterDuzenlenebilir() ? '' : `<button id="sdNoterDuzelt" class="w-full mt-3 border border-outline-variant text-on-surface-variant hover:bg-surface-container-low font-bold py-2.5 rounded-lg text-label-md flex items-center justify-center gap-1.5">
          ${mat('edit_note', 'text-[16px]')} Noter Bilgilerini Düzelt</button>`}
      ` : `
        <button id="sdSatisGerBtn" ${noter.acik ? '' : 'disabled'} class="w-full ${noter.acik ? 'bg-secondary text-on-primary hover:opacity-90' : 'bg-surface-container-high text-outline cursor-not-allowed'} font-bold py-3 rounded-lg text-label-md flex items-center justify-center gap-2 transition-all">
          ${mat(noter.acik ? 'task_alt' : 'lock', 'text-[18px]')} SATIŞI GERÇEKLEŞTİR</button>
        <p class="text-label-sm ${noter.acik ? 'text-on-surface-variant' : 'text-amber-800'} mt-2 text-center leading-relaxed">${kacis(noter.not)}</p>
      `}
    </div>
    `
}

// --- Cari İşlem Merkezi — artık SOL KOLONUN EN ÜSTÜNDE, panel değil ---------
// Göksenil (12 Ağu 2026): "cari defteri ile cari işlem merkezini aynı yerde
//   tutmalıydık, veri girdikçe danışman kendi kendini kontrol etsin" ·
//   "evraklar tagının üstüne gelsin".
//
// Eskiden form sağdan açılan bir PANELDİ ve arkasına siyah perde koyuyordu:
// danışman tutarı yazarken defteri göremiyordu. Tablet/telefonda panel tam
// ekrandı, defter tamamen kayboluyordu. Artık form sayfanın içinde duruyor;
// defter ortadaki kolonda açık kalıyor, ikisi aynı anda görünüyor.
//
// ⚠️ Form açıkken sol kolon genişler (320 → 440px). Dar kolonda tutar/tarih
//    yan yana sıkışıyordu; orta kolon `flex-1` olduğu için defter daralır ama
//    görünür kalır.
function cariIslemKartiHtml(kilit) {
  const acik = drawerAcik && !kilit
  return `<div class="bg-surface-container-lowest border ${acik ? 'border-primary/40' : 'border-outline-variant'} rounded-xl custom-shadow p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-on-surface flex items-center gap-2">${mat('account_balance_wallet', 'text-[20px] text-primary')} Cari İşlem Merkezi</h3>
        ${acik ? `<button id="sdDrawerKapat" class="p-1.5 hover:bg-surface-container rounded-full shrink-0" title="Kapat">${mat('close', 'text-[20px]')}</button>` : ''}
      </div>
      ${kilit
        ? `<div class="border-2 border-dashed border-outline-variant rounded-xl p-6 text-center text-on-surface-variant text-body-md">${mat('lock', 'text-2xl opacity-50')}<p class="mt-1">Satış tamamlandı, yeni işlem eklenemez.</p></div>`
        : acik
          ? formIcerikHtml()
          : `<button id="sdCariEkleBtn" class="w-full border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-fixed/20 rounded-xl p-6 flex flex-col items-center gap-2 text-on-surface-variant hover:text-primary transition-colors">
              <span class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center">${mat('add', 'text-2xl')}</span>
              <span class="font-bold text-body-md">Cari İşlem Ekle</span>
            </button>
            <p class="text-label-sm text-on-surface-variant mt-3 leading-relaxed">Tahsilat, mahsup veya noter masrafı gibi tüm finansal hareketleri buradan yönetebilirsiniz. İşlemler anlık olarak cari defterine işlenir.</p>`}
    </div>`
}

// Göksenil, 3 Ağu 2026: "evraklar ve teslimat kontrolü aşağıda kalmış.
//   bence biri solda biri sağda olmalı, cari defteri ortada."
// SOL: noter · görüşme notu · cari işlem ekle · satışı gerçekleştir · EVRAKLAR
// ORTA: durum izleyici + cari defteri
// SAĞ: TESLİMAT KONTROLÜ · kredi transferi · kapora iadesi
function sagKolonHtml() {
  return `
    ${teslimatKartHtml()}
    ${teslimPlaniKartHtml()}
    ${krediTransferKartHtml()}
    ${sigortaKartHtml()}
    ${minFiyatOnayKartHtml()}
    ${kaporaIadeKartHtml()}`
}

// Evrak modülüne verilen bağlam. TCKN yalnız ÇIKTIYA basılır (kanuni zorunluluk,
// 5549) — ekrana asla yazılmaz; siparis-dosya.js'in kendi kuralı korunuyor.
// Ekspertiz şemasını "Satış Ekspertiz" belgesi (sql/208) için hazırlar.
// ⚠️ Boyama ekspertiz.js/svgBoya ile yapılır — TEK KAYNAK. Belgeye özel
//    ikinci bir boyayıcı yazılsaydı şemadaki renkle diğer ekranlardaki
//    renk zamanla ayrışırdı.
// ⚠️ Belge yeni bir pencerede string olarak üretiliyor; bu yüzden SVG
//    burada DOM'da boyanıp SERİLEŞTİRİLİYOR. Canlı DOM düğümü belgeye
//    taşınamaz.
// ⚠️ PARÇA GİRİLMEMİŞSE ŞEMA YİNE BASILIR. Göksenil, 15 Ağu 2026:
//    "ekspertiz parçası girilmemiş ise araç orijinaldir, svg'i orijinal
//    hâli ile göstereceğiz." svgBoya kaydı olmayan parçayı zaten ORİJİNAL
//    rengine boyuyor; erken çıkış yapmak, hasarsız aracın belgesini
//    şemasız bırakıyordu — alıcı "ekspertiz yapılmamış" sanabilirdi.
async function ekspertizSemasiHazirla() {
  EKSPERTIZ_SVG = ''
  try {
    const metin = await fetch('img/ekspertiz-sema.svg').then(r => r.ok ? r.text() : '')
    if (!metin) { console.error('[sd] ekspertiz semasi okunamadi'); return }
    const kap = document.createElement('div')
    kap.innerHTML = metin
    const svg = kap.querySelector('svg')
    if (!svg) { console.error('[sd] ekspertiz semasinda svg yok'); return }
    svgBoya(svg, EKSPERTIZ)
    // svgBoya imleç de atıyor (ekranda tıklanır olsun diye); kâğıtta anlamsız.
    for (const p of svg.querySelectorAll('[data-part]')) p.style.cursor = ''
    EKSPERTIZ_SVG = svg.outerHTML
  } catch (e) {
    console.error('[sd] ekspertiz semasi hazirlanamadi', e)
  }
}

function evrakCtx() {
  return {
    siparis: S,
    ekspertizPaneller: EKSPERTIZ,
    ekspertizSvg: EKSPERTIZ_SVG,
    tramer: TRAMER,
    arac: one(S.stok_araclar),
    musteri: one(S.musteriler),
    kimlik: TCKN,
    danismanAd: danismanAdi(DMAP, S.danisman_id),
    benim: BEN,
    evraklar: EVRAKLAR,
    evrakDosya: EVRAK,          // arac_evraklar: tip → depolama yolu (tutanaktaki ekspertiz tiki)
    listeFiyat: LISTE_FIYAT,    // tutanağın 3. bölümü: liste fiyatı + indirim
    kilit: kilitliMi(),
    tanim: TANIM,
    yenile: yukle,
  }
}

// Sipariş açılırken girilen "Görüşme notu" (siparisler.rezervasyon_notu).
// Göksenil, 3 Ağu 2026: "görüşme notu varsa satış dosyasında da bu notu görmemiz gerekmekte."
function gorusmeNotuHtml() {
  const not = (S.rezervasyon_notu || '').trim()
  if (!not) return ''
  return `<div class="bg-[#FFFBEB] border border-amber-300 rounded-xl custom-shadow p-4">
    <h3 class="font-bold text-amber-900 flex items-center gap-2 mb-2">${mat('sticky_note_2', 'text-[20px]')} Görüşme Notu</h3>
    <p class="text-body-md text-amber-900 whitespace-pre-wrap leading-relaxed">${kacis(not)}</p>
  </div>`
}

// R7: Teslimat Kontrolü kartı — durum + finans iadesi + "Teslimat Kontrolüne Gönder".
//   Kapı: müşteri bakiyesi 0 (sql/48 trigger sunucuda da zorlar).
//   Fark notu SOFT — butonu engellemez (noterBilgiKartHtml'de gösterilir).
// ---- BR-0501 · Kapora İadesi -----------------------------------------------
// "Kapora iadesi otomatik DEĞİL: SATIŞ MÜDÜRÜ karar verir, FİNANS onaylar."
// Kart yalnız İPTAL edilmiş + kaporası olan dosyada görünür.
const KAPORA_FINANS_ETIKET = {
  BEKLIYOR: 'Finans onayı bekliyor', ONAYLANDI: 'Finans onayladı',
  REDDEDILDI: 'Finans reddetti', ODENDI: 'Ödendi',
}
// =====================================================================
// MİN FİYAT ALTI SATIŞ ONAYI (sql/225)
// Danışman min fiyatın altında sipariş açtı → sipariş "BEKLIYOR" damgasıyla
// açıldı, satış müdürüne bildirim gitti. Karar bu karttan veriliyor.
// ⚠️ Kilit ARTIK bildirimle açılıyor — eskiden kapı vardı, zili yoktu:
//    danışman hata alıyor ama onay isteyebileceği hiçbir yol bulamıyordu.
// =====================================================================
function minFiyatOnayKartHtml() {
  const d = S.min_fiyat_onay_durumu || 'GEREKMEZ'
  if (d === 'GEREKMEZ') return ''
  const mudur = satisMuduruMu(BEN)
  const min = S.min_satis_snapshot != null ? Number(S.min_satis_snapshot) : null
  const tutar = S.anlasilan_tutar != null ? Number(S.anlasilan_tutar) : null
  const fark = (min != null && tutar != null) ? min - tutar : null

  const ozet = `<div class="grid grid-cols-3 gap-2 mb-3">
    ${[['Anlaşılan', tutar], ['Minimum', min], ['Fark', fark]].map(([et, v]) => `
      <div class="bg-surface-container-low rounded-lg px-2.5 py-2">
        <div class="text-[10px] uppercase tracking-wide text-on-surface-variant">${et}</div>
        <div class="text-title-sm font-bold ${et === 'Fark' ? 'text-error' : ''}">${v == null ? '—' : fmtPara(v)}</div>
      </div>`).join('')}
  </div>
  ${S.min_fiyat_gerekce ? `<div class="mb-3">
    <div class="text-[10px] uppercase tracking-wide text-on-surface-variant mb-0.5">Danışmanın gerekçesi</div>
    <p class="text-label-md text-on-surface bg-surface-container-low rounded-lg px-3 py-2">${kacis(S.min_fiyat_gerekce)}</p>
  </div>` : ''}`

  let govde
  if (d === 'BEKLIYOR') {
    govde = ozet + (mudur
      ? `<label class="text-[11px] font-bold text-on-surface-variant uppercase">Karar notu</label>
         <textarea id="mfNot" rows="2" class="${INP} mt-1 mb-3 resize-none" placeholder="Kararın gerekçesi (redde ZORUNLU, kayda geçer)"></textarea>
         <div class="flex flex-wrap gap-2">
           <button id="mfOnay" class="flex-1 min-w-[150px] px-3 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('check_circle', 'text-[16px]')} Onayla</button>
           <button id="mfRed" class="flex-1 min-w-[150px] px-3 py-2.5 rounded-lg border border-error text-error text-label-md font-bold hover:bg-error-container flex items-center justify-center gap-1.5">${mat('cancel', 'text-[16px]')} Reddet</button>
         </div>
         <p id="mfHata" class="hidden text-label-sm text-error mt-2"></p>`
      : `<div class="w-full py-3 rounded-lg bg-amber-100 text-amber-900 font-bold text-label-md flex items-center justify-center gap-2">
           ${mat('hourglass_top', 'text-[18px]')} Satış müdürü onayı bekleniyor</div>
         <p class="text-label-sm text-on-surface-variant mt-2 text-center">Onay gelene kadar araç teslimata gönderilemez.</p>`)
  } else if (d === 'ONAY') {
    govde = ozet + `<div class="w-full py-3 rounded-lg bg-secondary-container text-on-secondary-container font-bold text-label-md flex items-center justify-center gap-2">
      ${mat('verified', 'text-[18px]')} Satış müdürü onayladı</div>
      ${S.min_fiyat_onay_not ? `<p class="text-label-sm text-on-surface-variant mt-2 text-center">${kacis(S.min_fiyat_onay_not)}</p>` : ''}`
  } else {
    govde = ozet + `<div class="w-full py-3 rounded-lg bg-error-container text-on-error-container font-bold text-label-md flex items-center justify-center gap-2">
      ${mat('block', 'text-[18px]')} Reddedildi</div>
      ${S.min_fiyat_red_nedeni ? `<p class="text-label-sm text-on-surface-variant mt-2 text-center">${kacis(S.min_fiyat_red_nedeni)}</p>` : ''}
      <p class="text-label-sm text-on-surface-variant mt-1 text-center">Tutarı yükseltin ya da yeniden onay isteyin.</p>`
  }

  return `<div class="bg-surface-container-lowest rounded-2xl custom-shadow p-4 md:p-5">
    <h3 class="text-title-md text-primary flex items-center gap-2 mb-3">
      ${mat('gpp_maybe', 'text-[20px]')} Min Fiyat Altı Satış</h3>
    ${govde}</div>`
}

async function minFiyatKarar(onay) {
  const hata = m => { const h = document.getElementById('mfHata'); if (h) { h.textContent = m; h.classList.remove('hidden') } }
  const not = (document.getElementById('mfNot')?.value || '').trim()
  if (!onay && !not) return hata('Reddederken gerekçe zorunlu.')
  const { data, error } = await supabase.rpc('min_fiyat_onay_karar', {
    p_siparis: S.id, p_onay: onay, p_not: not || null,
  })
  if (error) { dbHata('min fiyat karar', error); return hata(error.message) }   // §5.4
  if (!data?.ok) return hata(data?.hata || 'Karar kaydedilemedi.')
  await yukle()
}

function kaporaIadeKartHtml() {
  const kapora = S.kapora_tutar != null ? Number(S.kapora_tutar) : 0
  if (S.durum !== 'IPTAL' || kapora <= 0) return ''
  const mudur = satisMuduruMu(BEN)

  let govde
  if (!KAPORA_IADE) {
    govde = mudur
      ? `<p class="text-label-md text-on-surface-variant mb-3">Bu dosyada <b>${fmtPara(kapora)}</b> kapora var. İade edilip edilmeyeceğine <b>satış müdürü</b> karar verir; iade edilecekse finans onaylayıp öder.</p>
         <label class="text-[11px] font-bold text-on-surface-variant uppercase">Gerekçe</label>
         <textarea id="kiGerekce" rows="2" class="${INP} mt-1 mb-3 resize-none" placeholder="Kararın gerekçesi (kayda geçer)"></textarea>
         <div class="flex flex-wrap gap-2">
           <button id="kiIadeEt" class="flex-1 min-w-[150px] px-3 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('assignment_return', 'text-[16px]')} İade Edilecek</button>
           <button id="kiIadeEtme" class="flex-1 min-w-[150px] px-3 py-2.5 rounded-lg border border-outline-variant text-on-surface-variant text-label-md font-bold hover:bg-surface-container-low flex items-center justify-center gap-1.5">${mat('block', 'text-[16px]')} İade Edilmeyecek</button>
         </div>`
      : `<div class="flex items-center gap-2 py-3 px-3 rounded-lg bg-[#FFFBEB] text-[#92400E] font-bold text-label-md">
           ${mat('hourglass_top', 'text-[18px]')} ${fmtPara(kapora)} kapora — <span class="font-normal">satış müdürünün iade kararı bekleniyor.</span></div>`
  } else {
    const iade = KAPORA_IADE.karar === 'IADE_EDILECEK'
    const fd = KAPORA_IADE.finans_durum
    const renk = fd === 'ODENDI' ? 'bg-[#ECFDF5] text-[#047857]'
      : fd === 'REDDEDILDI' ? 'bg-error-container text-on-error-container'
      : fd === 'ONAYLANDI' ? 'bg-[#EFF6FF] text-[#1D4ED8]' : 'bg-[#FFFBEB] text-[#92400E]'
    govde = `<div class="flex items-center gap-2 mb-2">
        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold border ${iade ? 'bg-primary/10 text-primary border-primary/20' : 'bg-surface-container-high text-on-surface-variant border-outline-variant'}">${iade ? 'İADE EDİLECEK' : 'İADE EDİLMEYECEK'}</span>
        <span class="text-label-md font-bold">${fmtPara(KAPORA_IADE.tutar)}</span>
        <span class="text-[11px] text-on-surface-variant ml-auto">${kacis(danismanAdi(DMAP, KAPORA_IADE.karar_veren) || '')} · ${fmtTarih(KAPORA_IADE.karar_zamani)}</span>
      </div>
      ${KAPORA_IADE.karar_gerekce ? `<p class="text-label-md text-on-surface-variant bg-surface-container-low rounded-lg p-2.5 mb-2 whitespace-pre-wrap">${kacis(KAPORA_IADE.karar_gerekce)}</p>` : ''}
      ${iade ? `<div class="flex items-center gap-2 py-2 px-3 rounded-lg ${renk} font-bold text-label-md">
          ${mat(fd === 'ODENDI' ? 'check_circle' : 'hourglass_top', 'text-[18px]')} ${kacis(KAPORA_FINANS_ETIKET[fd] || fd)}
          ${KAPORA_IADE.finans_notu ? `<span class="font-normal">— ${kacis(KAPORA_IADE.finans_notu)}</span>` : ''}</div>` : ''}`
  }
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
    <h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('savings', 'text-[20px] text-primary')} Kapora İadesi</h3>
    ${govde}</div>`
}

async function kaporaKararVer(karar) {
  const kapora = Number(S.kapora_tutar || 0)
  const gerekce = document.getElementById('kiGerekce')?.value.trim() || null
  const et = karar === 'IADE_EDILECEK'
  if (!confirm(`${fmtPara(kapora)} kapora için karar: ${et ? 'İADE EDİLECEK' : 'İADE EDİLMEYECEK'}\n\n${et ? 'Finans kuyruğuna düşecek ve onaylanınca ödenecek.' : 'İade yapılmayacak; karar kayda geçer.'}\n\nOnaylıyor musunuz?`)) return
  const { data, error } = await supabase.from('kapora_iadeleri').insert({
    siparis_id: S.id, tutar: kapora, karar, karar_gerekce: gerekce, karar_veren: BEN?.id || null,
  }).select('id')
  if (error) { dbHata('kapora iade karar', error); alert('Karar kaydedilemedi: ' + error.message); return }
  if (!data?.length) { alert('Karar kaydedilemedi — yalnız satış müdürü karar verebilir.'); return }
  await yukle()
}

// ---------- TESLİM PLANI KARTI (FAZ 2, sql/247-249) ----------
// Fikir: danışmana boş "neden gecikti?" kutusu SORULMAZ. Sistem sebebi zaten
// biliyor; kart teşhisi gösterir, danışman doğrular. Kırmızı "suç" değil
// "kim çözecek" demektir (veri.js TESLIM_SORUMLU_ETIKET).
// ⚠️ Sınıflandırma SUNUCUDA (v_teslim_plani.sinif). Burada tarih karşılaştırması
//   ya da "geç mi" hesabı YAPILMAZ — iki yerde yaşayan kural sessizce eskir.

// Defterdeki tur → tek kelimelik Türkçe karşılık (sql/245 tur CHECK'i ile birebir).
const TESLIM_TUR_ETIKET = {
  ILK_PLAN: 'İlk plan', ERTELEME: 'Erteleme', GEREKCE: 'Gerekçe',
  GOC: 'Plan girildi', DUZELTME: 'Düzeltme', ERKEN: 'Öne alındı', MUAFIYET: 'Muafiyet',
}

// "22.08" — zaman çizelgesi dar kolonda yaşıyor, dd.mm.yyyy üç kez yan yana
// gelince satır taşıyordu; yıl dosyanın kendisinden zaten belli.
// ⚠️ new Date() ile ÇEVİRME: kolon `date` tipinde ('2026-08-22'), Date bunu
//   UTC gece yarısı sayar ve negatif saat diliminde bir gün geriye kayar.
//   Metni doğrudan ayrıştırmak bu riski tamamen kaldırır.
const planGunAy = d => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? m[3] + '.' + m[2] : '—'
}

// Defterin tek satırı: "22.08 → 29.08 · Kredi parası gelmedi (Kredi) · Barış D. · 2 gün gecikme"
function teslimDefterSatiri(r) {
  const nd = GECIKME_NEDEN[r.neden_kod] || null
  const nedenAd = nd?.ad || r.neden_kod || null
  const sorumlu = TESLIM_SORUMLU_ETIKET[r.beyan_edilen_sorumlu || nd?.sorumlu] || null
  const kim = r.kaydeden ? danismanAdi(DMAP, r.kaydeden) : null
  const gec = Number(r.gecikme_gun) || 0
  // İlk plan bir "değişiklik" değil, başlangıç — ok işareti yanıltıcı olurdu.
  const bas = r.tur === 'ILK_PLAN'
    ? 'İlk plan: ' + planGunAy(r.yeni_tarih)
    : (r.eski_tarih && r.yeni_tarih && r.eski_tarih !== r.yeni_tarih)
      ? planGunAy(r.eski_tarih) + ' → ' + planGunAy(r.yeni_tarih)
      : (TESLIM_TUR_ETIKET[r.tur] || r.tur || '') + ': ' + planGunAy(r.yeni_tarih || r.eski_tarih)
  const parcalar = [
    bas,
    nedenAd ? nedenAd + (sorumlu ? ' (' + sorumlu + ')' : '') : null,
    kim,
    gec > 0 ? gec + ' gün gecikme' : null,
  ].filter(Boolean)
  // Gerekçeyi SİSTEM mi türetti, danışman mı seçti — defterin ayırt ettiği şey bu.
  const kaynakCip = r.neden_kaynak === 'OTOMATIK'
    ? `<span class="ml-1 px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold align-middle">sistem</span>` : ''
  return `<li class="relative pl-4 pb-2 last:pb-0">
      <span class="absolute left-0 top-[6px] w-[7px] h-[7px] rounded-full bg-outline"></span>
      <p class="text-label-md text-on-surface leading-snug">${kacis(parcalar.join(' · '))}${kaynakCip}</p>
      ${r.neden_not ? `<p class="text-[11px] text-on-surface-variant leading-snug">${kacis(r.neden_not)}</p>` : ''}
      <p class="text-[10px] text-on-surface-variant">${kacis(fmtTarih(r.created_at))}</p>
    </li>`
}

function teslimPlaniKartHtml() {
  // İptal edilmiş dosyada teslim planı anlamsız; ihale (muaf) dosyada plan
  // hiç tutulmaz (v_teslim_plani.plan_muaf) — kart basılmaz.
  if (S.durum === 'IPTAL') return ''
  const p = TESLIM_PLAN
  if (p?.plan_muaf) return ''

  // 1) ÜST SATIR — tarih + sınıf rozeti + plan tipi + erteleme sayısı
  const k = p ? TESLIM_SINIF[p.sinif] : null
  const gec = Number(p?.gecikme_gun) || 0
  const rozetMetin = k ? [k.etiket, gec > 0 ? gec + ' gün geç' : ''].filter(Boolean).join(' · ') : ''
  const rozet = rozetMetin
    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full ${k.cip} text-[11px] font-bold whitespace-nowrap">${kacis(rozetMetin)}</span>` : ''
  const tipCip = p?.planlanan
    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold" title="${p.plan_tipi === 'TAHMIN' ? 'Tahmin — gecikme sayacı işlemez' : 'Müşteriye söz verildi'}">${p.plan_tipi === 'TAHMIN' ? 'TAHMİN' : 'SÖZ'}</span>` : ''
  const ertN = Number(p?.erteleme_sayisi) || 0
  const ertCip = ertN > 0
    ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold">${ertN}. erteleme</span>` : ''

  const ustHtml = p?.planlanan
    ? `<div class="flex items-baseline gap-2 flex-wrap">
         <span class="text-title-md font-black text-on-surface tabular-nums">${kacis(fmtTarihKisa(p.planlanan))}</span>
         ${rozet}${tipCip}${ertCip}
       </div>`
    : `<div class="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2">
         ${mat('event_busy', 'text-[18px]')}<span class="text-label-md font-bold">Teslim planı girilmemiş</span>
       </div>`

  // 2) SİSTEM TEŞHİSİ — yalnız dosya GECİKMİŞSE. Gecikmemiş dosyada bu satır
  //    gereksiz gürültü olur (danışman zaten bir şey beklemiyor).
  const t = TESLIM_TESHIS
  const teshisHtml = (gec > 0 && t?.aciklama) ? `
    <div class="mt-3 flex items-start gap-2 rounded-lg bg-surface-container-low border border-outline-variant px-3 py-2">
      ${mat('troubleshoot', 'text-[17px] text-primary shrink-0 mt-[1px]')}
      <p class="text-label-md text-on-surface leading-snug">
        <span class="font-bold">Sistem:</span> ${kacis(t.aciklama)}${
          TESLIM_SORUMLU_ETIKET[t.sorumlu] ? ` — <span class="font-bold">${kacis(TESLIM_SORUMLU_ETIKET[t.sorumlu])}</span>` : ''}
      </p>
    </div>` : ''

  // 3) ERTELEME GEÇMİŞİ — defter boşsa bölüm HİÇ ÇİZİLMEZ.
  const defterHtml = TESLIM_DEFTER.length ? `
    <div class="mt-3 pt-3 border-t border-outline-variant">
      <p class="text-[11px] font-bold text-on-surface-variant uppercase mb-2">Plan Geçmişi</p>
      <ul class="border-l border-outline-variant ml-[3px] space-y-0">${TESLIM_DEFTER.map(teslimDefterSatiri).join('')}</ul>
    </div>` : ''

  // 4) DÜĞME — pencereyi BURADA AÇMIYORUZ. Tarih/gerekçe penceresi Sipariş
  //    Merkezi'nde yaşıyor (teslim_plani_degistir / teslim_plani_goc ayrımı,
  //    neden listesi, not_zorunlu kuralı hep orada). Aynı pencereyi ikinci kez
  //    yazmak bu projede defalarca ayrışmaya yol açtı — TEK KAYNAK kalsın.
  //    Planı olan / olmayan ayrımını yalnız ETİKET yansıtır; hangi pencerenin
  //    açılacağına Sipariş Merkezi karar verir.
  const btnHtml = S.durum === 'ACIK' ? `
    <a href="siparis.html?id=${encodeURIComponent(S.id)}&gerekce=1"
       class="mt-3 w-full px-3 py-2.5 rounded-lg border border-outline-variant text-on-surface text-label-md font-bold hover:bg-surface-container-low flex items-center justify-center gap-1.5">
      ${mat('edit_calendar', 'text-[16px]')} ${p?.planlanan ? 'Tarih / gerekçe' : 'Tarih gir'}</a>` : ''

  return `<div class="bg-surface-container-lowest border ${(!p?.planlanan || gec > 0) ? 'border-amber-300' : 'border-outline-variant'} rounded-xl custom-shadow p-4">
    <h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('event', 'text-[20px] text-primary')} Teslim Planı</h3>
    ${ustHtml}${teshisHtml}${defterHtml}${btnHtml}
  </div>`
}

function teslimatKartHtml() {
  if (satildiMi() && S.durum === 'TESLIM_EDILDI') return ''
  const td = S.teslimat_durumu
  // NOT: bakiye kontrolü artık burada YAPILMAZ — 7 şartın biri olarak sunucudan
  // gelir (sql/88). Kredi transferi bekliyorsa bakiye açık olsa da kapı açılır.

  // Finans hangi satırları reddetti?
  const redler = HAREKETLER.filter(h => ONAYLAR.get(h.id)?.onay_durumu === 'RED')
  const iadeUyari = td === 'IADE' ? `
    <div class="bg-error/5 border border-error/30 rounded-xl p-3 mb-3">
      <p class="font-bold text-error flex items-center gap-2">${mat('assignment_return', 'text-[18px]')} Finans dosyayı iade etti — düzeltme bekleniyor</p>
      ${redler.length ? `<ul class="mt-2 space-y-1 text-label-md">${redler.map(h => `<li class="flex justify-between gap-2 border-b border-error/10 pb-1 last:border-0">
          <span>${kacis(h.alt_tip || h.tip)} · ${fmtPara(h.tutar)}</span>
          <span class="text-error font-medium">${kacis(ONAYLAR.get(h.id)?.karar_notu || 'Reddedildi')}</span></li>`).join('')}</ul>`
        : `<p class="text-label-md text-on-surface-variant mt-1">Finansın notu bildirimlerinizde; cari hareketleri düzeltip tekrar gönderin.</p>`}
    </div>` : ''

  // Şart listesi (sunucudan — sql/88, 233, 234). Sayı SABİT DEĞİL: bazı
  //   şartlar yalnız koşulu varken listeye giriyor (tediye evrağı yalnız
  //   fark varsa, kredi istisnası yalnız bakiye 0 değilken). Buraya
  //   "7 şart" yazmak yanıltıcıydı — ekran diziyi olduğu gibi çizer.
  const sartlar = TESLIMAT_SART?.sartlar || []
  const uygun = !!TESLIMAT_SART?.uygun
  // Sağ taraf rozeti: sunucudan gelen kanıt (poliçe no / araç durumu / bakiye).
  //   Şart artık "işaretlendi mi" değil "ölçüldü mü" — kanıtı da göstermeliyiz.
  const rozet = (cls, metin) => `<span class="shrink-0 px-2 py-0.5 rounded-full ${cls} text-[10px] font-bold">${kacis(metin)}</span>`
  const kanit = x => {
    if (x.police_no) return rozet('bg-secondary-container text-on-secondary-container', 'Poliçe ' + x.police_no)
    if (x.kaynak === 'IMZA') return rozet('bg-secondary-container text-on-secondary-container', x.imzali + ' belge imzalı')
    if (x.kaynak === 'ELLE') return rozet('bg-amber-100 text-amber-800', 'elle işaretlendi')
    if (x.imzasiz) return rozet('bg-error-container text-on-error-container', x.imzasiz + ' imza eksik')
    // D3 (sql/198): tediye evrağı şartı — kanıt, noter beyanı ile resmî
    // tahsilat arasındaki fark. Şart yalnız fark varsa listeye giriyor.
    if (x.fark != null) return rozet(x.tamam ? 'bg-secondary-container text-on-secondary-container' : 'bg-amber-100 text-amber-800', fmtPara(x.fark) + ' fark')
    if (x.bakiye != null && !x.tamam) return `<span class="shrink-0">${fmtPara(Math.abs(x.bakiye))}</span>`
    // ⚠️ Şart YEŞİL olsa bile fazla tahsilat varsa söylenmeli. Sunucu
    //    "borç kalmadı" diye tamam diyor (doğru), ama +10.000 ₺ iade/mahsup
    //    bekliyor. Göksenil kararı (3 Ağu 2026): "uyar, durdurma".
    if (x.bakiye != null && x.tamam && Number(x.bakiye) > 0.005)
      return rozet('bg-amber-100 text-amber-800', fmtPara(x.bakiye) + ' fazla')
    return ''
  }
  // ⚠️ `engelleyici: false` ARTIK OKUNUYOR. Sunucu bu bayrağı sql/164'ten
  //   beri yazıyordu ama burası hiç bakmıyordu: "Sigorta Tamamlandı"
  //   engellemediği hâlde KIRMIZI ÇARPI olarak çiziliyor, düğme ise açık
  //   duruyordu — "kırmızı ama gönderebiliyorum" çelişkisi. sql/234 ile
  //   "Operasyon Teslime Hazır" da engellemez oldu; iki kırmızı birden
  //   olacaktı. Üç hâl ayrıldı:
  //     tamam                → yeşil tik
  //     eksik + engellemez   → amber "bilgi", düğmeyi kilitlemez
  //     eksik + engeller     → kırmızı çarpı (eski davranış)
  // ⚠️ `engelleyici` YOKSA engeller varsayılır: bayrağı yazmayan bir şart
  //   sessizce engellemez hâle düşmesin.
  const sartBicim = x => {
    if (x.tamam) return { ikon: 'check_circle', ikonCls: 'text-green-600', satirCls: 'text-on-surface-variant', dolu: true }
    if (x.engelleyici === false) return { ikon: 'info', ikonCls: 'text-amber-600', satirCls: 'text-amber-800', dolu: false }
    return { ikon: 'cancel', ikonCls: 'text-error', satirCls: 'text-error font-semibold', dolu: false }
  }
  const sartListe = sartlar.length ? `<ul class="mb-3 space-y-1">${sartlar.map(x => {
    const b = sartBicim(x)
    return `<li class="flex items-center gap-2 text-label-md ${b.satirCls}"${x.ipucu && !x.tamam ? ` title="${kacis(x.ipucu)}"` : ''}>
        <span class="material-symbols-outlined text-[17px] ${b.ikonCls}"${b.dolu ? ` style="font-variation-settings:'FILL' 1"` : ''}>${b.ikon}</span>
        <span class="flex-1">${kacis(x.ad)}${x.ipucu && !x.tamam ? `<span class="block text-[11px] font-normal text-on-surface-variant">${kacis(x.ipucu)}</span>` : ''}</span>
        ${kanit(x)}
      </li>`
  }).join('')}</ul>` : ''

  // Eksik şartları kapatma düğmeleri (yetkiye göre)
  // ⚠️ Sigorta artık POLİÇEDEN otomatik okunuyor (sql/131). Elle işaret yalnız
  //   İSTİSNA: poliçe sigorta modülüne henüz girilmediyse sigorta birimi
  //   sorumluluğu üstlenerek kapıyı açabilir. Düğme bu yüzden "istisna" dilinde.
  const sigortaSart = sartlar.find(x => x.kod === 'SIGORTA')
  const policeVar = !!sigortaSart?.police_no
  const sigortaYetki = !!(BEN && (BEN.master_admin || BEN.rol === 'yonetici' ||
    BEN.rol === 'sigorta_yetkili' || BEN.rol === 'sigorta_personel' || BEN.mudur_birim === 'sigorta'))
  const isaretBtn = []
  if (!policeVar && !S.sigorta_tamam && sigortaYetki) {
    isaretBtn.push(`<button id="sdSigortaTamam" class="flex-1 min-w-[150px] px-3 py-2 rounded-lg border border-amber-400 bg-amber-50 text-amber-900 text-label-md font-bold hover:bg-amber-100 flex items-center justify-center gap-1.5">${mat('shield', 'text-[16px]')} Poliçesiz Onayla (istisna)</button>`)
  }
  // Evrak şartı da artık ÖLÇÜLÜYOR (sql/134): iki belgenin imzası onaylıysa
  //   kendiliğinden yeşil. Elle işaret yalnız istisna — tarayıcı yok, belge
  //   fiziksel dosyada gibi durumlarda dosya kilitlenmesin diye.
  const evrakSart = sartlar.find(x => x.kod === 'EVRAK')
  if (evrakSart && !evrakSart.tamam && !kilitliMi()) {
    isaretBtn.push(`<button id="sdEvrakTamam" class="flex-1 min-w-[150px] px-3 py-2 rounded-lg border border-amber-400 bg-amber-50 text-amber-900 text-label-md font-bold hover:bg-amber-100 flex items-center justify-center gap-1.5">${mat('task', 'text-[16px]')} İmzasız Onayla (istisna)</button>`)
  }
  const isaretHtml = isaretBtn.length ? `<div class="flex flex-wrap gap-2 mb-3">${isaretBtn.join('')}</div>` : ''

  // ⚠️ NOTER DEVRİ (sql/226) — istisna düğmesi DEĞİL, akışın kendisi.
  //    Finans onayı dosyayı doğrudan satışa düşürebiliyor (Bahadır'ın
  //    sistemi teslimat-tamamla'yı kendisi çağırıyor, 19 Ağu ölçümü), o
  //    yüzden noter/yevmiye/yeni ruhsat ONAYA GÖNDERMEDEN ÖNCE alınıyor.
  //    Bu yüzden diğer istisna düğmelerinin arasına değil, listenin üstüne
  //    ve birincil renkle konuyor: danışman burada durup girecek.
  const noterSart = sartlar.find(x => x.kod === 'NOTER_DEVRI')
  const noterEksik = noterSart && !noterSart.tamam
  const noterHtml = (noterSart && noterDuzenlenebilir()) ? `<button id="sdNoterDevri" class="w-full mb-3 px-3 py-2.5 rounded-lg ${noterEksik
      ? 'bg-primary text-on-primary hover:opacity-90'
      : 'border border-outline-variant text-on-surface-variant hover:bg-surface-container-low'} text-label-md font-bold flex items-center justify-center gap-1.5">
      ${mat(noterEksik ? 'gavel' : 'edit_note', 'text-[16px]')} ${noterEksik ? 'Noter Devrini Gir (ruhsat QR)' : 'Noter Devrini Düzenle'}</button>` : ''

  let govde
  if (td === 'ONAY_BEKLIYOR') {
    govde = `<div class="w-full py-3 rounded-lg bg-blue-100 text-blue-800 font-bold text-label-md flex items-center justify-center gap-2">
      ${mat('hourglass_top', 'text-[18px]')} Finans kontrolünde — dosya kilitli</div>
      <p class="text-label-sm text-on-surface-variant mt-2 text-center">Finans onaylayınca aracı teslim edebileceksiniz.</p>`
  } else if (td === 'ONAYLANDI') {
    // ⚠️ ESKİ METİN YANLIŞTI: "teslim işlemini finans birimi kendi ekranından
    //    tamamlar" diyordu ve burada HİÇBİR düğme yoktu. Danışman "her şey
    //    onaylı" görüp bekliyor, dosya Sipariş Merkezi'nde asılı kalıyordu
    //    (Göksenil, 19 Ağu: "her şey tamam, burada neden hâlâ sipariş
    //    sayfasında"). Teslimi DANIŞMAN yapıyor — düğme dosyanın kendisinde
    //    olmalı; Sipariş Merkezi'nin yan panelinde vardı, burada yoktu.
    // ⚠️ Finans köprüsü de kapatabiliyor (Bahadır'ın paneli teslimat-tamamla'yı
    //    çağırıyor); ikisi de meşru, metin ikisini de söylüyor.
    const kapanabilir = S.durum === 'ACIK'
    govde = `<div class="w-full py-3 rounded-lg bg-secondary-container text-on-secondary-container font-bold text-label-md flex items-center justify-center gap-2">
      ${mat('verified', 'text-[18px]')} Finans onayladı</div>
      ${kapanabilir ? `
        <button id="sdTeslimEt" class="w-full mt-3 bg-secondary text-on-primary hover:opacity-90 font-bold py-3 rounded-lg text-label-md flex items-center justify-center gap-2 transition-all">
          ${mat('done_all', 'text-[18px]')} ARACI TESLİM ET</button>
        <p class="text-label-sm text-on-surface-variant mt-2 text-center leading-relaxed">Araç müşteriye teslim edilince bu düğmeye basın — dosya kapanır. Finans birimi kendi ekranından da kapatabilir.</p>`
        : `<p class="text-label-sm text-on-surface-variant mt-2 text-center">Dosya kapandı.</p>`}`
  } else {
    // Kapı artık 7 ŞARTIN TAMAMI (sql/88) — yalnız bakiye değil.
    const btnCls = uygun
      ? 'bg-primary text-on-primary hover:opacity-90'
      : 'bg-surface-container-high text-outline cursor-not-allowed'
    const ilkEksik = (TESLIMAT_SART?.eksikler || [])[0]
    govde = `${sartListe}${noterHtml}${isaretHtml}
      <button id="sdOnayaGonderBtn" ${uygun ? '' : 'disabled'} class="w-full ${btnCls} font-bold py-3 rounded-lg text-label-md flex items-center justify-center gap-2 transition-all">
        ${mat(uygun ? 'send' : 'lock', 'text-[18px]')} ${td === 'IADE' ? 'Düzelttim — Tekrar Gönder' : 'Teslimat Kontrolüne Gönder'}</button>
      <p class="text-label-sm ${uygun ? 'text-on-surface-variant' : 'text-error'} mt-2 text-center leading-relaxed">${
        uygun ? 'Dosya finans kontrolüne gider; onaydan sonra araç teslim edilir.'
        : TESLIMAT_SART == null ? 'Şartlar okunamadı — sayfayı yenileyin.'
        : kacis(ilkEksik || 'Eksik şart var.')}</p>`
  }

  return `<div class="bg-surface-container-lowest border ${td === 'IADE' ? 'border-error/40' : 'border-outline-variant'} rounded-xl custom-shadow p-4">
    <h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('local_shipping', 'text-[20px] text-primary')} Teslimat Kontrolü</h3>
    ${iadeUyari}${govde}
  </div>`
}

// Sigorta/evrak şart işaretleri — kapıyı açan iki eksik (sql/88)
async function sartIsaretle(alan) {
  const ad = alan === 'sigorta_tamam' ? 'Sigorta' : 'Evraklar'
  const soru = alan === 'sigorta_tamam'
    ? 'POLİÇESİZ ONAY (istisna)\n\nBu araca sigorta modülünde satış sonrası aktif poliçe BULUNAMADI.\nYine de teslimat kapısını açmak, poliçe sorumluluğunu üstlenmek demektir.\n\nOnaylıyor musunuz?'
    : 'İMZASIZ ONAY (istisna)\n\nEvraklar panelinde imzası onaylanmamış belge var.\nYine de işaretlemek, ıslak imzaların alındığı sorumluluğunu üstlenmek demektir.\n(5549 · evraklar 8 yıl saklanır.)\n\nOnaylıyor musunuz?'
  if (!confirm(soru)) return
  const yama = alan === 'sigorta_tamam'
    ? { sigorta_tamam: true, sigorta_tamam_zamani: new Date().toISOString(), sigorta_isaretleyen: BEN?.id || null }
    : { evrak_tamam: true, evrak_tamam_zamani: new Date().toISOString() }
  const { data, error } = await supabase.from('siparisler').update(yama).eq('id', S.id).select('id')
  if (error) { dbHata(alan + ' işaretle', error); alert('İşaretlenemedi: ' + error.message); return }
  if (!data?.length) { alert('İşaretlenemedi — yetki yok.'); return }
  await yukle()
}

// Noter devri penceresi — teslim-pencere.js'in 'noter' kipi.
// ⚠️ Ayrı bir pencere YAZILMADI: ruhsat QR okuyucusu, alan doğrulaması ve
//    plaka uyarısı orada duruyor. Kopyalasaydım biri düzeltilip öbürü
//    unutulurdu (bu projede en sık tekrarlanan hata — CLAUDE.md §4).
// Aracı teslim et — teslim-pencere.js'in NORMAL kipi (siparis_teslim_et).
// Noter alanları zaten dolu geliyor; pencere onları gösterip onay istiyor,
// gerekirse ruhsat QR ile düzeltiliyor. Ayrı bir pencere yazılmadı.
async function teslimEtAc() {
  const { teslimPencereAc } = await import('./teslim-pencere.js')
  const a = one(S.stok_araclar), m = one(S.musteriler)
  teslimPencereAc(S, { plaka: a?.plaka, baslik: aracBaslik(a), musteri: m?.ad_soyad },
    async () => { await yukle() })
}

async function noterDevriAc() {
  const { teslimPencereAc } = await import('./teslim-pencere.js')
  const a = one(S.stok_araclar), m = one(S.musteriler)
  teslimPencereAc(S, { plaka: a?.plaka, baslik: aracBaslik(a), musteri: m?.ad_soyad },
    async () => { await yukle() }, { mod: 'noter' })
}

// ⚠️ Noter satış bedeli `blur`'de kaydediliyor (noterBedelKaydet). Kullanıcı
//   tutarı yazıp DOĞRUDAN "Gönder"e basarsa kaydetme isteğiyle kapı sorgusu
//   YARIŞIR: sunucu eski (boş) değeri görüp dosyayı haksız yere geri çevirir.
//   sql/233 ile bu alan kapının ÖN KOŞULU olduğu için yarış artık sıradan bir
//   senaryo — kapıyı sormadan önce bekleyen düzenleme yazılıyor.
//   Burada `yukle()` çağrılmaz: çağıran zaten devam edecek, ortada yeniden
//   çizim yapmak tıklanan düğmeyi DOM'dan koparırdı.
async function bekleyenNoterBedeliniYaz() {
  const el = document.getElementById('sdNoterBedel')
  if (!el) return                       // kilitli dosyada input yok, sadece metin
  const raw = (el.value || '').replace(/\D/g, '')
  const tutar = raw ? Number(raw) : null
  const onceki = S.noter_satis_tutari != null ? Number(S.noter_satis_tutari) : null
  if (tutar === onceki) return
  const { data, error } = await supabase.from('siparisler')
    .update({ noter_satis_tutari: tutar }).eq('id', S.id).select('id')
  if (error || !data?.length) { dbHata('noter satış bedeli (gönder öncesi)', error); return }
  S.noter_satis_tutari = tutar          // yerel kopya da tazelensin
}

async function teslimatOnayaGonder() {
  await bekleyenNoterBedeliniYaz()
  // Kapıyı SUNUCU söyler; istemci son bir kez tazeler (arayüz bayat olabilir).
  const { data: sart, error: sErr } = await supabase.rpc('teslimata_gonderilebilir', { p_siparis: S.id })
  if (sErr) { dbHata('teslimat şartları', sErr); alert('Şartlar kontrol edilemedi: ' + sErr.message); return }
  if (!sart?.uygun) {
    alert('Teslimata gönderilemez — eksik şartlar:\n\n• ' + (sart?.eksikler || ['bilinmiyor']).join('\n• '))
    TESLIMAT_SART = sart || null; ciz(); return
  }
  // Göksenil, 3 Ağu 2026: "teslimat onaya gönderirken şu sayfaların müşteri
  //   imzaları tamamlandı mı? pop-up şeklinde bir onay kutusu çıkmalı."
  if (!await imzaOnayiAl(SIP_ID)) return
  const btn = document.getElementById('sdOnayaGonderBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Gönderiliyor…' }
  const { data, error } = await supabase.from('siparisler')
    .update({ teslimat_durumu: 'ONAY_BEKLIYOR' }).eq('id', S.id).select('id')
  if (error || !data?.length) {
    dbHata('teslimat onaya gönder', error)
    // ⚠️ Sunucu kapısı (sql/226) istemci kapısı atlansa bile tutar; mesajı
    //    ham göstermek yerine ne yapılacağını söyle.
    // ⚠️ Sunucu kapısı (sql/233) — noter satış bilgisi. BR-0131'den ÖNCE
    //    bakılıyor çünkü akışta da önce o geliyor: bedel/plaka notere
    //    GİDERKEN, devir künyesi noterden DÖNERKEN giriliyor.
    if (/BR-0132/.test(error?.message || '')) {
      alert(`Noter satış bilgisi girilmeden dosya finans onayına gönderilemez.

Sol kolonun en üstündeki "Noter Satış Bilgisi" kartından:
  • Noter Satış Bedeli'ni yazın
  • "Plaka değişecek mi?" sorusunu cevaplayın`)
      if (btn) { btn.disabled = false; btn.textContent = 'Teslimat Kontrolüne Gönder' }
      await yukle(); return
    }
    if (/BR-0131/.test(error?.message || '')) {
      alert(`Noter devri kaydedilmeden dosya finans onayına gönderilemez.

Yukarıdaki "Noter Devrini Gir" düğmesinden yeni ruhsatı okutun; seri no ve plaka kendiliğinden dolar.`)
      if (btn) { btn.disabled = false; btn.textContent = 'Teslimat Kontrolüne Gönder' }
      await yukle(); return
    }
    alert('Gönderilemedi: ' + (error?.message || 'yetki/kayıt yok'))
    if (btn) { btn.disabled = false; btn.textContent = 'Teslimat Kontrolüne Gönder' }
    return
  }
  const { error: oErr } = await supabase.rpc('olay_ekle', { p_tip: 'TESLIMAT_ONAYA_GONDERILDI', p_arac: S.arac_id, p_musteri: S.alici_musteri_id, p_siparis: S.id, p_danisman: BEN?.id })
  if (oErr) dbHata('olay_ekle teslimat', oErr)
  await yukle()
}

// R7-5: Noter satış bedeli (siparisler.noter_satis_tutari — mevcut kolon, yeni
//   kolon açılmadı) + resmî tahsilat (v_siparis_resmi_tahsilat) karşılaştırması.
//   Fark notu SOFT — hiçbir butonu engellemez, yalnız finansı uyarır.
// ⚠️ AMA KARTIN KENDİSİ ARTIK SOFT DEĞİL (sql/233): "Noter Satış Bedeli" ve
//   "Plaka değişecek mi?" cevabı teslimat onayının ÖN KOŞULU. İkisi de
//   girilmeden Teslimat Kontrolüne Gönder çalışmaz (BR-0132). Kart bu
//   yüzden sol kolonun EN ÜSTÜNDE duruyor.
function noterBilgiKartHtml() {
  // ⚠️ Bu alan kilitliMi()'ye BAĞLANAMAZ. Noter satışı artık finans onayından
  //   SONRA yapılıyor (sql/131 + noterKapisi), ama kilitliMi() teslimat onaya
  //   gittiği an true oluyor → alan tam ihtiyaç duyulduğu anda salt-okunur
  //   olurdu. Kilit = cari yazma yasağı; noter bedeli cari kaydı DEĞİL,
  //   siparisler.noter_satis_tutari kolonu. Yalnız satış tamamlanınca donar.
  const kilit = satildiMi()
  const bedel = S.noter_satis_tutari != null ? Number(S.noter_satis_tutari) : null
  const fark = bedel != null ? (RESMI - bedel) : null
  const farkVarMi = fark != null && !sifirMi(fark)
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
      <h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('gavel', 'text-[20px] text-primary')} Noter Satış Bilgisi</h3>
      <div>
        <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Noter Satış Bedeli</label>
        ${kilit
          ? `<p class="text-body-lg font-bold text-on-surface mt-1">${bedel != null ? fmtPara(bedel) : '—'}</p>`
          : `<input id="sdNoterBedel" type="text" inputmode="numeric" placeholder="0" value="${bedel != null ? Math.round(bedel).toLocaleString('tr-TR') : ''}" class="${INP} mt-1 font-bold text-primary para-gir" />`}
      </div>
      <div class="mt-3 pt-3 border-t border-outline-variant/60 flex items-center justify-between">
        <span class="text-label-sm text-on-surface-variant">Resmî Tahsilat</span>
        <span class="font-bold text-body-md text-on-surface">${fmtPara(RESMI)}</span>
      </div>
      ${farkVarMi ? `<div class="mt-3 pt-3 border-t border-outline-variant/60 flex items-center justify-between text-[12.5px]">
        <span class="text-on-surface-variant">Fark</span>
        <span class="font-bold ${S.tediye_evraki_alindi ? 'text-secondary' : 'text-amber-800'}">${fmtPara(Math.abs(fark))}
          · ${S.tediye_evraki_alindi ? 'tediye evrağı alındı' : 'tediye evrağı bekliyor'}</span>
      </div>` : ''}
      ${plakaDegisecekHtml(kilit)}
      <button id="sdNotereGonderWa" class="w-full mt-3 border border-secondary text-secondary hover:bg-secondary/5 font-bold py-2.5 rounded-lg text-label-md flex items-center justify-center gap-2 transition-all">
        ${mat('chat', 'text-[18px]', true)} Notere Gönder (WhatsApp)</button>
    </div>`
}

// --- Plaka değişecek mi? ---------------------------------------------------
// Göksenil (3 Ağu 2026): "notere gönder whatsapp butonunda plaka değişecek mi
//   sorusu var; onu orada değil direk satış dosyasının içinde sormalı."
// Eskiden soru YALNIZ WhatsApp penceresindeydi ve hiçbir yere yazılmıyordu:
// pencere kapanınca cevap kayboluyor, ikinci açan baştan cevaplıyor,
// operasyon/muhasebe hiç göremiyordu. Artık kartta sorulur, siparisler
// .plaka_degisecek'e yazılır (sql/150) ve WhatsApp metni oradan okur.
//
// Üç durum: null = HENÜZ SORULMADI · false = hayır · true = evet.
// "Sorulmadı"yı "hayır"a eşitlemiyoruz; danışman uyarılabilsin.
function plakaBasimEklendiMi() {
  const tersli = tersliIdSeti()
  return HAREKETLER.some(h => h.alt_tip === 'PLAKA_BASIM' && !tersli.has(h.id))
}

function plakaDegisecekHtml(kilit) {
  const secim = S.plaka_degisecek            // null | false | true
  const ucret = ayarSayi('plaka_basim_ucreti')
  const eklendi = plakaBasimEklendiMi()
  // ⚠️ secim BOOLEAN, kod ('evet'/'hayir') METİN — doğrudan === ile
  //    karşılaştırılmaz. İlk yazışta öyle yapmıştım ve hiçbir düğme seçili
  //    görünmüyordu (koşum yakaladı).
  const dugme = (kod, etiket) => {
    const aktif = secim != null && secim === (kod === 'evet')
    return `<button type="button" data-plakadeg="${kod}" ${kilit ? 'disabled' : ''}
      class="flex-1 py-2 rounded-lg border font-bold text-label-md transition-all ${kilit ? 'opacity-60 cursor-not-allowed ' : ''}${
        aktif ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'}">${etiket}</button>`
  }
  return `<div class="mt-3 pt-3 border-t border-outline-variant/60">
      <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
        Plaka Değişecek mi?
        ${secim == null ? `<span class="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full normal-case tracking-normal">cevaplanmadı</span>` : ''}
      </label>
      <div class="flex gap-2 mt-1.5" role="group" aria-label="Plaka değişecek mi">
        ${dugme('hayir', 'Hayır')}${dugme('evet', 'Evet')}
      </div>
      ${secim === true ? (
        eklendi
          ? `<p class="mt-2 text-[12px] text-secondary font-semibold flex items-center gap-1">${mat('check_circle', 'text-[15px]')} Plaka basım ücreti cariye eklendi.</p>`
          : ucret == null
            ? `<p class="mt-2 text-[12px] text-amber-900">Plaka basım ücreti tanımlı değil (<b>plaka_basim_ucreti</b> ayarı) — cariye elle girilmeli.</p>`
            : `<p class="mt-2 text-[12px] text-amber-900">Plaka basım ücreti <b>${fmtPara(ucret)}</b> cariye eklenmedi.
                 ${kilitliMi() ? 'Dosya kilitli — kilit kalkınca eklenebilir.' : '<button type="button" id="sdPlakaUcretEkle" class="underline font-bold">Şimdi ekle</button>'}</p>`
      ) : ''}
    </div>`
}

// Kartta "Evet"e basılınca ücret hemen sorulur (Göksenil kararı, 3 Ağu 2026);
// WhatsApp penceresi artık yalnız mesajı gösterir.
async function plakaDegisecekSec(deger) {
  if (satildiMi()) return
  if (S.plaka_degisecek === deger) return
  const { data, error } = await supabase.from('siparisler')
    .update({ plaka_degisecek: deger }).eq('id', S.id).select('id')
  if (error || !data?.length) { dbHata('plaka değişecek kaydet', error); alert('Kaydedilemedi: ' + (error?.message || 'yetki/kayıt yok')); return }
  S.plaka_degisecek = deger
  ciz()
  if (deger === true) await plakaBasimUcretiSor()
}

// Ücreti cariye TEDIYE olarak yazar. İki kez yazılmasın diye önce cari
// defterine bakar — "eklendi mi" bilgisinin tek kaynağı orası, ayrı bayrak yok.
async function plakaBasimUcretiSor() {
  const ucret = ayarSayi('plaka_basim_ucreti')
  if (ucret == null || plakaBasimEklendiMi() || kilitliMi()) return
  const kasa = await kasaSor(`Plaka basım ücreti ${fmtPara(ucret)} cariye tediye olarak eklenecek.`)
  if (!kasa) return
  const tamam = await cariSatirEkle({
    tip: 'TEDIYE', alt_tip: 'PLAKA_BASIM', kasa_hesap_id: kasa,
    tutar: ucret, tarih: bugunISO(), aciklama: 'Plaka basım ücreti (noter işlemi)',
  })
  if (tamam) await yukle()
}

// Küçük kasa/hesap seçim penceresi — confirm() ile seçim yaptıramıyoruz.
function kasaSor(baslik) {
  return new Promise(coz => {
    const ov = document.createElement('div')
    ov.className = 'fixed inset-0 z-[110] flex items-start justify-center pt-[14vh] px-4 bg-black/40 backdrop-blur-sm'
    ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-sm" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-outline-variant"><h3 class="font-black text-primary">Kasa / Hesap Seçin</h3>
          <p class="text-xs text-on-surface-variant mt-0.5">${kacis(baslik)}</p></div>
        <div class="p-5"><select id="ksSecim" class="${INP}">${kasaOptions()}</select></div>
        <div class="flex justify-end gap-2 px-5 pb-5">
          <button class="ks-vazgec px-5 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
          <button id="ksTamam" class="px-6 py-2.5 bg-secondary text-on-primary rounded-lg text-sm font-bold hover:opacity-90">Cariye Ekle</button>
        </div></div>`
    document.body.appendChild(ov)
    const esc = e => { if (e.key === 'Escape') bitir(null) }
    const bitir = v => { document.removeEventListener('keydown', esc); ov.remove(); coz(v) }
    document.addEventListener('keydown', esc)
    ov.addEventListener('click', e => { if (e.target === ov) bitir(null) })
    ov.querySelector('.ks-vazgec').addEventListener('click', () => bitir(null))
    ov.querySelector('#ksTamam').addEventListener('click', () => {
      const v = ov.querySelector('#ksSecim')?.value || null
      if (!v) { alert('Kasa/hesap seçin.'); return }
      bitir(v)
    })
  })
}

function sagPanelHtml() {
  return `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4 md:p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-bold text-on-surface uppercase tracking-wide text-label-md">Satış Durumu İzleyici</h3>
        <span class="text-[11px] text-on-surface-variant">Son güncelleme: ${fmtTarih(S.created_at)}</span>
      </div>
      ${stepperHtml()}
    </div>
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4 md:p-5">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 class="font-bold text-on-surface">Cari Defteri — İşlem Geçmişi</h3>
        <div class="flex items-center gap-2">
          <select id="sdFiltre" class="${INP} !w-auto text-label-sm py-1.5">
            <option value="TUMU" ${filtreTip === 'TUMU' ? 'selected' : ''}>Tümü</option>
            <option value="TAHSILAT" ${filtreTip === 'TAHSILAT' ? 'selected' : ''}>Tahsilat</option>
            <option value="TEDIYE" ${filtreTip === 'TEDIYE' ? 'selected' : ''}>Tediye</option>
            <option value="SIPARIS_BORCU" ${filtreTip === 'SIPARIS_BORCU' ? 'selected' : ''}>Sipariş Borcu</option>
            <option value="IPTAL_DUZELTME" ${filtreTip === 'IPTAL_DUZELTME' ? 'selected' : ''}>İptal/Düzeltme</option>
          </select>
          <button id="sdExcel" class="px-3 py-1.5 rounded-lg border border-outline-variant text-label-sm font-bold hover:bg-surface-container-low flex items-center gap-1">${mat('download', 'text-[16px]')} Excel'e Aktar</button>
        </div>
      </div>
      ${timelineHtml()}
    </div>`
}

function stepperHtml() {
  // ⚠️ Eskiden sifirMi(BAKIYE) idi: +10.000 fazla tahsilatta ADIM YEŞİL
  //    OLMUYORDU, ama sunucudaki teslimat şartı (sql/131) "tamam" diyordu.
  //    Aynı olguya iki farklı cevap. Artık ikisi de "borç kalmadı mı".
  const bakiyeKapandi = bakiyeSifirMi()
  const adimlar = [
    { ad: 'Sipariş', tamam: true },
    { ad: 'Tahsilat', tamam: bakiyeKapandi },
    { ad: 'Noter', tamam: satildiMi() },
    { ad: 'Teslim', tamam: S.durum === 'TESLIM_EDILDI' },
  ]
  const aktifIdx = adimlar.map(a => a.tamam).lastIndexOf(true)
  return `<div class="flex items-start overflow-x-auto pb-1">${adimlar.map((ad, i) => {
    const renk = ad.tamam ? 'bg-secondary text-on-primary' : (i === aktifIdx + 1 ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant')
    const step = `<div class="flex flex-col items-center gap-1.5 shrink-0 w-20"><div class="w-9 h-9 rounded-full ${renk} flex items-center justify-center text-[13px] font-bold">${ad.tamam ? mat('check', 'text-[18px]') : i + 1}</div><span class="text-[10px] font-bold uppercase text-center ${ad.tamam ? 'text-secondary' : 'text-on-surface-variant'}">${ad.ad}</span></div>`
    const cizgi = i < adimlar.length - 1 ? `<div class="flex-1 h-0.5 self-start mt-[18px] ${adimlar[i + 1].tamam ? 'bg-secondary' : 'bg-surface-container-high'}"></div>` : ''
    return step + cizgi
  }).join('')}</div>`
}

// R7-5: Cari defteri artık gruplu — işaret/bakiye mantığı DEĞİŞMEDİ (v_siparis_bakiye
//   tek kaynak), yalnız görünüm 4 kalıcı gruba ayrıldı: Sipariş Borcu · Tahsilatlar
//   (TAHSILAT + Takas Mahsubu, ikisi de borç azaltır) · Borca Eklenenler/İadeler
//   (Takas Mahsubu HARİÇ diğer TEDIYE — Noter, Sahibine İade, Kapora İadesi, Sigorta…)
//   · İptal/Düzeltme. Dropdown filtre önceki gibi tip'e göre daraltır; gruplama bu
//   daraltılmış listeye uygulanır (TEDIYE seçilince Takas Mahsubu otomatik ayrı görünür).
const CARI_GRUPLAR = [
  { baslik: 'Sipariş Borcu', ikon: 'receipt_long', sec: h => h.tip === 'SIPARIS_BORCU' || h.tip === 'ACILIS' },
  { baslik: 'Tahsilatlar', ikon: 'payments', sec: h => h.tip === 'TAHSILAT' || h.alt_tip === 'TAKAS_MAHSUP' },
  { baslik: 'Borca Eklenenler / İadeler', ikon: 'undo', sec: h => h.tip === 'TEDIYE' && h.alt_tip !== 'TAKAS_MAHSUP' },
  { baslik: 'İptal / Düzeltme', ikon: 'history', sec: h => h.tip === 'IPTAL_DUZELTME' },
]

function timelineHtml() {
  const tersli = tersliIdSeti()
  const gorunen = filtreTip === 'TUMU' ? HAREKETLER : HAREKETLER.filter(h => h.tip === filtreTip)
  const kalan = kalanBakiye()

  if (!HAREKETLER.length) return bosDurum('Henüz cari hareket yok. Soldan "Cari İşlem Ekle" ile başlayın.', 'receipt_long')
  if (!gorunen.length) return `<p class="text-body-md text-on-surface-variant text-center py-8">Bu filtreye uyan hareket yok.</p>`

  const gruplarHtml = CARI_GRUPLAR.map(g => {
    const satirlarArr = gorunen.filter(g.sec)
    if (!satirlarArr.length) return ''
    const toplam = satirlarArr.filter(h => !tersli.has(h.id)).reduce((a, h) => a + Number(h.tutar || 0), 0)
    return `<div class="mb-5 last:mb-0">
      <div class="flex items-center justify-between mb-1.5 px-0.5">
        <span class="text-label-sm font-black uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">${mat(g.ikon, 'text-[15px]')}${kacis(g.baslik)}</span>
        <span class="text-label-sm font-bold text-on-surface-variant">Toplam ${fmtPara(toplam)}</span>
      </div>
      <div>${satirlarArr.map(h => hareketSatirHtml(h, tersli)).join('')}</div>
    </div>`
  }).join('')

  return `${gruplarHtml}
    <div class="mt-1 flex justify-between items-center p-3 rounded-lg bg-surface-container-low border border-outline-variant">
      <span class="text-label-md font-bold text-on-surface-variant uppercase">Net Bakiye</span>
      <span class="text-lg font-black ${kalan || fazlaVarMi() ? 'text-error' : 'text-secondary'}">${
        kalan == null ? '—'
        : fazlaVarMi() ? fmtPara(fazlaTahsilat()) + ' fazla tahsilat'
        : kalan ? fmtPara(kalan) + ' kalan tahsilat'
        : 'Borç kapandı'}</span>
    </div>`
}

// TL dışı satırlarda tutarın altındaki küçük gri satır: "1.000 USD × 34,25".
// Kayıt anındaki kur donmuştur (sql/80) — sonradan kur değişse de bu değişmez.
function dovizNotu(h) {
  if (!h.para_birimi || h.para_birimi === 'TRY') return ''
  return `${fmtSayi(h.tutar_doviz, 0, 4)} ${kacis(birimKisa(h.para_birimi))} × ${fmtSayi(h.kur, 2, 6)}`
}

function hareketSatirHtml(h, tersli) {
  const artan = h.tip === 'SIPARIS_BORCU' || h.tip === 'TEDIYE' || h.tip === 'ACILIS'
  // R6-4 Faz B: kredi kullandırımı (Can onayından cari'ye düşen KREDI_TAHSILAT)
  // diğer tahsilatlardan görsel olarak ayrılır (kırmızı + rozet). Bakiye/işaret
  // mantığı DEĞİŞMEZ — hâlâ borç azaltan bir tahsilat, sadece rengi farklı.
  //
  // sql/173 (Göksenil): kırmızı ARTIK KALICI DEĞİL. "Kredi hesaba düştüğünde
  //   Bahadır veya Can onaylayacak, onay alındıktan sonra caride kırmızı yerine
  //   normal renkte yazacak." Kırmızı = para yolda; teyitliyse sıradan tahsilat.
  //   ⚠️ Teyit YALNIZCA görseldir — bakiyeyi/teslimat kapısını ETKİLEMEZ
  //   (Göksenil kararı: bakiye bugünkü gibi Can'ın kullandırım onayında kapanır).
  const krediMi = h.alt_tip === 'KREDI_TAHSILAT'
  const krediBekliyor = krediMi && !h.kredi_teyit_zamani
  const renk = krediBekliyor ? 'text-error' : (artan ? 'text-primary' : 'text-secondary')
  const isaret = artan ? '+' : '−'
  const soluk = tersli.has(h.id) ? 'opacity-50 line-through decoration-1' : ''
  const altParca = [
    h.odeme_tipi ? ODEME_ETIKET[h.odeme_tipi] || h.odeme_tipi : null,
    // POS artık katalogdan (sql/196): adı `pos_turu_serbest`e yazılıyor, hangi
    // tür olursa olsun gösterilir — eskiden yalnız 'DIGER'de görünüyordu.
    h.pos_turu ? (h.pos_turu_serbest ? kacis(h.pos_turu_serbest) : (POS_ETIKET[h.pos_turu] || h.pos_turu)) : null,
    h.kasa_hesap_id ? kasaAd(h.kasa_hesap_id) : null,
    h.banka && krediMi ? kacis(h.banka) : null,
    h.alt_tip === 'TAKAS_MAHSUP' && h.takas_noter_beyani != null ? 'Noter beyanı ' + fmtPara(h.takas_noter_beyani) : null,
  ].filter(Boolean).join(' · ')
  return `<div class="flex items-start gap-3 py-3 border-b border-outline-variant/40 last:border-0 ${soluk}">
      <div class="w-9 h-9 rounded-full ${krediBekliyor ? 'bg-error-container' : 'bg-surface-container-high'} flex items-center justify-center shrink-0 mt-0.5">${mat(artan ? 'arrow_upward' : 'arrow_downward', `text-[16px] ${renk}`)}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <p class="font-bold text-body-md ${krediBekliyor ? 'text-error' : 'text-on-surface'} truncate flex items-center gap-1.5">${B(katalogAd(h.alt_tip)) || kacis(OLAY_ETIKET[h.tip] || h.tip)}${krediMi ? (krediBekliyor
            ? '<span class="text-[9px] font-black bg-error text-white px-1.5 py-0.5 rounded-full tracking-wide shrink-0" title="Kredi parası henüz hesaba geçmedi">HESABA GEÇMEDİ</span>'
            : '<span class="text-[9px] font-black bg-secondary-container text-secondary px-1.5 py-0.5 rounded-full tracking-wide shrink-0" title="Kredi parası hesaba geçti, teyit edildi">HESABA GEÇTİ</span>') : ''}</p>
          <div class="shrink-0 text-right">
            <span class="font-bold text-body-md ${renk}">${isaret}${fmtPara(h.tutar)}</span>
            ${dovizNotu(h) ? `<div class="text-[11px] text-on-surface-variant leading-tight">${dovizNotu(h)}</div>` : ''}
          </div>
        </div>
        <p class="text-label-sm text-on-surface-variant truncate">${fmtTarihKisa(h.tarih)}${altParca ? ' · ' + altParca : ''}${B(h.aciklama) ? ' · ' + B(h.aciklama) : ''}</p>
      </div>
      <button data-hmenu="${h.id}" class="p-1.5 hover:bg-surface-container-high rounded-full shrink-0 text-on-surface-variant" title="İşlemler">${mat('more_vert', 'text-[18px]')}</button>
    </div>`
}

function aracBaslik(a) { return a ? ([a.yil, a.marka, a.model].filter(Boolean).join(' ') || 'Araç —') : 'Araç —' }

// --- İşlem Merkezi formu ---------------------------------------------------
// 12 Ağu 2026'ya kadar sağdan açılan bir drawer'dı (siparis-merkezi.js deseni).
// Artık sol kolonun en üstünde, sayfanın içinde — bkz. cariIslemKartiHtml().
function kasaOptions(secili) {
  return `<option value="">Kasa/Hesap seçin…</option>` + KASA.map(k => `<option value="${k.id}" ${k.id === secili ? 'selected' : ''}>${kacis(k.ad)}${k.tip ? ' (' + kacis(k.tip) + ')' : ''}</option>`).join('')
}

function formIcerikHtml() {
  const secim = aksiyonListesi().map(a => `
    <button data-aksiyon="${a.kod}" class="bg-surface-container-low hover:bg-primary-fixed/40 hover:border-primary border border-transparent rounded-xl p-3 flex flex-col items-center gap-1.5 text-on-surface transition-colors">
      <span class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-primary border border-outline-variant">${mat(a.ikon, 'text-[17px]')}</span>
      <span class="text-[11px] font-bold text-center leading-tight">${a.ad}</span>
    </button>`).join('')

  if (!aksiyonSecili) return `<div class="grid grid-cols-3 gap-2">${secim}</div>`

  return `
    <button id="sdAksiyonGeri" class="text-label-sm font-bold text-primary flex items-center gap-1 mb-3">${mat('arrow_back', 'text-[16px]')} Farklı işlem seç</button>
    <p class="text-label-md font-bold text-on-surface mb-3">${kacis(aksiyonBul(aksiyonSecili)?.ad || '')}</p>
    ${aksiyonFormHtml(aksiyonSecili)}
    <div id="sdBakiyeOnizleme" class="mt-3"></div>
    <button id="sdIslemKaydet" class="w-full mt-3 bg-primary text-on-primary hover:opacity-90 font-bold py-3 rounded-lg text-label-md transition-all">İşlemi Kaydet</button>`
}

// --- Canlı bakiye önizlemesi ----------------------------------------------
// Göksenil: "veri girdikçe danışman kendi kendini kontrol etsin."
// Kaydet düğmesinin hemen üstünde: şu anki bakiye → bu işlemden sonraki bakiye.
//
// ⚠️ İŞARET YÖNÜ: BAKIYE negatifse BORÇ var (kalanBakiye = -BAKIYE), pozitifse
//    FAZLA tahsilat. Tahsilat BAKIYE'yi artırır (borcu azaltır), tediye azaltır.
//    Ters yazılırsa önizleme borcu artıyor gösterir ve danışmanı yanıltır —
//    ölçüm: 35ARA580'de borç 718.000, tahsilat 718.000, bakiye 0.
// ⚠️ Bu YALNIZ ÖNİZLEME. Gerçek bakiyeyi v_siparis_bakiye hesaplar; burada
//    yapılan aritmetik hiçbir yere yazılmaz.
function islemYonu(kod) {
  if (kod === 'TAHSILAT' || kod === 'TAKAS_ARAC') return 1        // borcu azaltır
  if (kod === 'OTOSOR_DOSYA_MASRAFI') return -1                   // borca eklenir
  if (aksiyonBul(kod)?.katalog) {
    const kt = (KATALOG || []).find(x => x.kod === kod)
    return kt?.ozellikler?.yon === 'TAHSILAT' ? 1 : -1
  }
  return -1                                                       // tediye
}

function bakiyeOnizlemeCiz() {
  const kutu = document.getElementById('sdBakiyeOnizleme')
  if (!kutu || BAKIYE == null || !aksiyonSecili) return
  const girilen = sayiOku(document.getElementById('sdTutar')?.value)
  const birim = document.getElementById('sdParaBirimi')?.value || 'TRY'
  const kur = birim === 'TRY' ? 1 : sayiOku(document.getElementById('sdKur')?.value)
  const tl = (girilen && kur) ? girilen * kur : null
  const metin = b => b == null ? '—' : (Math.abs(b) < 0.005 ? 'kapandı (0 ₺)'
    : b < 0 ? fmtPara(-b) + ' borç' : fmtPara(b) + ' fazla')

  if (!tl) {
    kutu.innerHTML = `<div class="bg-surface-container-low rounded-lg p-2.5 text-label-sm text-on-surface-variant">
      Şu anki bakiye: <b class="text-on-surface">${metin(BAKIYE)}</b></div>`
    return
  }
  const yeni = BAKIYE + islemYonu(aksiyonSecili) * tl
  const kapandi = Math.abs(yeni) < 0.005
  const fazla = yeni > 0.005
  kutu.innerHTML = `<div class="rounded-lg p-2.5 text-label-sm border ${
    kapandi ? 'bg-secondary-container/40 border-secondary/40 text-secondary'
    : fazla ? 'bg-amber-50 border-amber-300 text-amber-900'
    : 'bg-surface-container-low border-outline-variant text-on-surface-variant'}">
    <div class="flex items-center justify-between gap-2">
      <span>Şu an</span><b>${metin(BAKIYE)}</b></div>
    <div class="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-current/15">
      <span class="font-bold">Bu işlemden sonra</span>
      <b class="text-body-md">${metin(yeni)}</b></div>
    ${fazla ? `<p class="mt-1.5 text-[11.5px] font-semibold">Fazla tahsilat oluşur — teslimat kapısı kapanır.</p>` : ''}
  </div>`
}

// Aksiyona göre form alanları — tasarım kararınca 6 sabit form (katalogdan
// dinamik "alanlar" üretimi yerine): her aksiyonun alan seti Rezervasyon 2.0
// R4b planında birebir tarif edildi, kasa_hesap_id TÜM TAHSİLAT/TEDİYE
// satırlarında CHECK ile zorunlu (sql/64 cari_kasa_zorunlu) — hepsinde var.
function aksiyonFormHtml(kod) {
  if (kod === 'TAHSILAT') return `
    <div class="space-y-3">
      <div><label class="${LBL}">Ödeme Tipi</label>
        <select id="sdOdemeTipi" class="${INP} mt-1">
          <option value="NAKIT">Nakit</option><option value="HAVALE_EFT">Havale/EFT</option><option value="KREDI_KARTI">Kredi Kartı</option>
        </select></div>
      <div id="sdKartTuruSarma" class="hidden">
        <label class="${LBL}">POS</label>
        ${POSLAR.length
          ? `<select id="sdPos" class="${INP} mt-1">${POSLAR.map(p =>
              `<option value="${kacis(p.kod)}">${kacis(p.ad)}</option>`).join('')}</select>`
          : uyari('Tanımlı POS yok. <b>Cari İşlem Kalemleri → POS Cihazları</b> ekranından POS ekleyin; eklenmeden kasa otomatik seçilemez.')}
      </div>
      <div id="sdKasaSarma"><label class="${LBL}">Kasa/Banka</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      <div id="sdKasaOto" class="hidden bg-surface-container-low rounded-lg p-2.5 text-label-sm text-on-surface-variant flex items-center gap-2">
        ${mat('lock', 'text-[16px] shrink-0')}<span id="sdKasaOtoMetin"></span>
      </div>
      ${tutarBlokHtml({ etiket: 'Tutar' })}
      <div><label class="${LBL}">Açıklama</label><input id="sdAciklama" type="text" placeholder="Opsiyonel" class="${INP} mt-1" /></div>
    </div>`

  if (kod === 'KAPORA_IADESI' || kod === 'SAHIBINE_IADE') return `
    <div class="space-y-3">
      <div><label class="${LBL}">İade Yöntemi</label>
        <select id="sdOdemeTipi" class="${INP} mt-1"><option value="NAKIT">Nakit</option><option value="HAVALE_EFT">Havale/EFT</option></select></div>
      <div><label class="${LBL}">Kasa/Hesap</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      ${tutarBlokHtml({ etiket: 'Tutar' })}
      <div><label class="${LBL}">Açıklama</label><input id="sdAciklama" type="text" placeholder="${kod === 'SAHIBINE_IADE' ? 'Takas aracı sahibine iade notu' : 'Opsiyonel'}" class="${INP} mt-1" /></div>
    </div>`

  if (kod === 'TAKAS_ARAC') return `
    <div class="space-y-3">
      <p class="text-label-sm text-on-surface-variant bg-surface-container-low rounded-lg p-2.5">Takas aracının bilgileri; değeri kadar cari borcunuzdan Takas Mahsubu düşülür. Kaydedince araç <strong>Araç Kabul</strong> listesine düşer ve bilgi işleme bildirim gider — detayları onlar tamamlar.</p>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="${LBL}">Plaka</label><input id="sdTakasPlaka" type="text" placeholder="34 ABC 123" class="${INP} mt-1" /></div>
        <div><label class="${LBL}">Model Yılı</label><input id="sdTakasYil" type="text" inputmode="numeric" placeholder="2019" class="${INP} mt-1" /></div>
      </div>
      <div id="sdTakasPlakaDurum" class="hidden"></div>
      <div><label class="${LBL}">Araç Bilgisi</label><input id="sdTakasBilgi" type="text" placeholder="Marka Model Paket" class="${INP} mt-1" /></div>
      <div><label class="${LBL}">Kasa/Hesap</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      ${tutarBlokHtml({ etiket: 'Takas Değeri', beyan: true })}
    </div>`

  if (kod === 'NOTER_MASRAFI') return `
    <div class="space-y-3">
      <div><label class="${LBL}">Kasa/Hesap</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      ${tutarBlokHtml({ etiket: 'Tutar' })}
      <div><label class="${LBL}">Açıklama</label><input id="sdAciklama" type="text" placeholder="Örn. plaka + harç" class="${INP} mt-1" /></div>
    </div>`

  // Katalogdan gelen kalem (LPG Uyum, Plaka Basım…) — sade form.
  // Özel formu olanlar yukarıda/aşağıda kendi dalına düşer; buraya yalnız
  // `aksiyonListesi()`in kataloktan eklediği kalemler gelir.
  if (aksiyonBul(kod)?.katalog) return `
    <div class="space-y-3">
      <div class="bg-surface-container-low rounded-lg p-2.5 text-label-sm text-on-surface-variant flex items-center gap-2">
        ${mat('info', 'text-[16px]')} Bu tutar <b class="mx-1">müşteri borcuna eklenir</b> (tediye).</div>
      <div><label class="${LBL}">Kasa/Hesap</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      ${tutarBlokHtml({ etiket: 'Tutar' })}
      <div><label class="${LBL}">Açıklama</label><input id="sdAciklama" type="text" placeholder="Opsiyonel" class="${INP} mt-1" /></div>
    </div>`

  if (kod === 'SIGORTA') return `
    <div class="space-y-3">
      <div><label class="${LBL}">Poliçe Türü</label>
        <select id="sdSigortaTip" class="${INP} mt-1"><option value="TRAFIK_SIGORTASI">Trafik Sigortası</option><option value="KASKO">Kasko</option></select></div>
      <div><label class="${LBL}">Kasa/Hesap</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      ${tutarBlokHtml({ etiket: 'Tutar' })}
      <div><label class="${LBL}">Açıklama</label><input id="sdAciklama" type="text" placeholder="Opsiyonel" class="${INP} mt-1" /></div>
    </div>`

  // Noter Harcı — taban RPC'den (MAX(anlaşılan, kasko) × oran). Kutu önce
  // "hesaplanıyor" der, RPC dönünce noterHarcUygula() doldurur. TL dışı yok.
  if (kod === 'NOTER_HARCI') return `
    <div class="space-y-3">
      <div id="sdHarcBilgi" class="bg-surface-container-low rounded-lg p-2.5 text-label-sm text-on-surface-variant flex items-center gap-2">
        ${mat('hourglass_top', 'text-[16px]')} Noter harcı tabanı hesaplanıyor…</div>
      <div><label class="${LBL}">Kasa/Hesap</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      ${tutarBlokHtml({ etiket: 'Harç Tutarı', dovizli: false })}
      <div><label class="${LBL}">Açıklama</label><input id="sdAciklama" type="text" placeholder="Opsiyonel" class="${INP} mt-1" /></div>
    </div>`

  // Otosor Dosya Masrafı — D4 (Göksenil, 12 Ağu 2026): "kredi tutarı brüt ve
  //   net geçen tahsilat kredi modülünden otomatik olarak gelmeli danışman
  //   burada veri girmemeli."
  //
  // ⚠️ ARTIK TEK KAYIT ÜRETİR. Eskiden tahsilatı da bu düğme yazıyordu; oysa
  //    kredi kullandırım onayı (kredi_kullandirim_onayla) aynı tahsilatı zaten
  //    cari'ye yazıyor — 12 Ağu ölçümü: 35ARA580 dosyasında Can Bey'in onayı
  //    670.000 ₺ KREDI_TAHSILAT satırını üretmişti. İki yol birden çalışsaydı
  //    tahsilat iki kez sayılırdı. Kredi parası TEK YERDEN girer.
  if (kod === 'OTOSOR_DOSYA_MASRAFI') {
    const oran = ayarSayi('otosor_dosya_masrafi_orani')
    const k = KREDI_OZET
    const alan = (etiket, deger) => `<div>
      <label class="${LBL}">${etiket}</label>
      <p class="text-body-lg font-bold text-on-surface mt-1">${deger != null ? fmtPara(deger) : '—'}</p></div>`
    return `
    <div class="space-y-3">
      <p class="text-label-sm text-on-surface-variant bg-surface-container-low rounded-lg p-2.5">
        Bu işlem <b>tek kayıt</b> oluşturur: <b>Otosor Dosya Masrafı</b> =
        kredi tutarı (brüt) × ${oran != null ? oranMetin(oran) : 'oran'} — müşteri borcuna eklenir.<br>
        Kredi parasının tahsilatı burada girilmez; kredi birimi kullandırımı onayladığında cariye kendiliğinden yazılır.
      </p>
      ${k?.var
        ? `<div class="border border-outline-variant rounded-lg p-3">
             <div class="text-[11px] font-black text-on-surface-variant uppercase tracking-wide mb-2 flex items-center gap-1.5">
               ${mat('account_balance', 'text-[15px]')} Kredi modülünden ${k.banka ? '· ' + kacis(k.banka) : ''}</div>
             <div class="grid grid-cols-2 gap-3">
               ${alan('Kredi Tutarı (brüt)', k.brut != null ? Number(k.brut) : null)}
               ${alan('Otosor\'dan Geçen Net', k.net != null ? Number(k.net) : null)}
             </div>
             <p class="text-[12px] mt-2 ${k.cari_yazildi ? 'text-secondary font-semibold' : 'text-amber-900'} flex items-center gap-1">
               ${k.cari_yazildi
                 ? mat('check_circle', 'text-[15px]') + ' Kredi tahsilatı cariye yazıldı.'
                 : mat('hourglass_top', 'text-[15px]') + ' Kullandırım henüz onaylanmadı — tahsilat onaydan sonra cariye düşer.'}
             </p>
           </div>`
        : uyari('Bu dosyada <b>kredi kullandırım kaydı yok</b>. Brüt tutar kredi biriminde girilmeden dosya masrafı hesaplanamaz — kredi birimine iletin.')}
      ${oran == null ? uyari('<b>otosor_dosya_masrafi_orani</b> ayarı bulunamadı. Oranı yönetici Ayarlar\'dan tanımlamalı.') : ''}
      <div id="sdOtosorHesap" class="bg-surface-container-low rounded-lg p-2.5 text-label-sm text-on-surface-variant">Hesaplanıyor…</div>
      <div><label class="${LBL}">Kasa/Hesap</label><select id="sdKasa" class="${INP} mt-1">${kasaOptions()}</select></div>
      ${tutarBlokHtml({ etiket: 'Dosya Masrafı', dovizli: false })}
      <div><label class="${LBL}">Açıklama</label><input id="sdAciklama" type="text" placeholder="Opsiyonel" class="${INP} mt-1" /></div>
    </div>`
  }

  return ''
}

// Tutar + Tarih (+ opsiyonel para birimi / kur) — TÜM cari formlarında AYNI blok.
//   dovizli=false → yalnız ₺ (noter harcı, otosor gibi TL formüllü kalemler).
//   Kur ondalıklıdır → `para-gir` KULLANILMAZ (binlik biçimleme ondalığı siler,
//   .ai/04 kuralı). Tutar alanı TL'de para-gir'li, döviz seçilince sınıf
//   kaldırılır ki kuruş/gram girilebilsin (paraBirimiUygula).
// `beyan: true` → tutarın YANINDA noter beyanı alanı (yalnız Takas Aracı).
// Ayrı bir blok YAZILMADI: kur/para birimi/tarih mantığı burada tek kaynak,
// kopyası tutulsaydı biri düzeltilip diğeri unutulurdu (CLAUDE.md §4).
function tutarBlokHtml({ etiket = 'Tutar', dovizli = true, beyan = false } = {}) {
  return `
    ${dovizli ? `<div><label class="${LBL}">Para Birimi</label>
      <select id="sdParaBirimi" class="${INP} mt-1">${PARA_BIRIMLERI.map(([k, ad]) => `<option value="${k}">${kacis(ad)}</option>`).join('')}</select></div>` : ''}
    <div class="grid grid-cols-2 gap-3">
      <div><label id="sdTutarLbl" for="sdTutar" data-etiket="${kacis(etiket)}" class="${LBL}">${kacis(etiket)} (₺)</label>
        <input id="sdTutar" type="text" inputmode="decimal" placeholder="0" class="${INP} mt-1 font-bold text-primary para-gir" /></div>
      ${beyan ? `<div><label class="${LBL}" for="sdBeyan">Beyan (₺)</label>
        <input id="sdBeyan" type="text" inputmode="numeric" placeholder="0" class="${INP} mt-1 font-bold para-gir" />
        <p id="sdBeyanNot" class="text-[11px] text-on-surface-variant mt-1">Takas değerini izliyor — elle değiştirebilirsiniz.</p></div>` : ''}
      <div><label class="${LBL}">Tarih</label><input id="sdTarih" type="date" value="${bugunISO()}" class="${INP} mt-1" /></div>
    </div>
    ${dovizli ? `<div id="sdKurSarma" class="hidden">
      <label class="${LBL}" for="sdKur">Kur (işlem anındaki)</label>
      <input id="sdKur" type="text" inputmode="decimal" placeholder="Örn. 34,25" class="${INP} mt-1 font-bold" />
      <p id="sdDovizOnizleme" class="text-label-sm text-on-surface-variant mt-1.5" aria-live="polite"></p>
    </div>` : ''}`
}

// --- TAKAS: PLAKADAN ARAÇ BULMA (sql/236) ---------------------------------
// Göksenil (21 Ağu 2026): "'bu araç alış listesinde var, eklenemez' gibi bir
//   kayıt gördüm. Eğer var ise alışta veya stokta model yılı ve araç
//   bilgisini otomatik doldurur."
//
// ⚠️ Hata ESKİDEN KAYIT ANINDA çıkıyordu: danışman formun tamamını doldurup
//   Kaydet'e bastığında öğreniyordu. Artık plaka yazılır yazılmaz görünüyor.
// ⚠️ Kayıt ARTIK ENGELLENMİYOR (Göksenil kararı): plaka sistemde varsa yeni
//   taslak açılmaz, cari satırı MEVCUT kayda bağlanır (sql/236). Eski
//   davranış TESLIM_EDILDI'yi geçirdiği için "sattığımız aracı geri aldık"
//   vakasında her seferinde aynı plakadan yeni satır açıyordu.
// ⚠️ AKTİF STOĞUMUZSA (STOKTA/SIPARISTE/TESLIME_HAZIR/KULLANIMDA) amber
//   uyarı çıkar ama durdurmaz — büyük ihtimalle plaka yanlış yazılmıştır.
// ⚠️ Normalleştirme SUNUCUDA. İstemcide ikinci bir plaka temizleme YAZILMAZ;
//   sunucudaki `plaka_norm` (boşluk + tire siler) tek kaynak, kopyası
//   ayrışırdı.
let takasPlakaSon = ''      // en son sorulan normalleştirilmiş plaka
let takasAramaZaman = null

function takasPlakaArat() {
  clearTimeout(takasAramaZaman)
  takasAramaZaman = setTimeout(takasPlakaAra, 400)
}

async function takasPlakaAra() {
  const el = document.getElementById('sdTakasPlaka')
  const kutu = document.getElementById('sdTakasPlakaDurum')
  if (!el || !kutu) return
  const ham = (el.value || '').trim()
  // Kaba bir alt sınır: 5 karakterden kısa plakayla arama yapmak her tuşta
  // yüzlerce satır eşleşen anlamsız sorgu demek.
  if (ham.replace(/[\s-]/g, '').length < 5) {
    kutu.classList.add('hidden'); kutu.innerHTML = ''; takasPlakaSon = ''
    return
  }
  if (ham === takasPlakaSon) return
  takasPlakaSon = ham
  const { data, error } = await supabase.rpc('takas_plaka_bul', { p_plaka: ham })
  // ⚠️ Hatada `takasPlakaSon` SIFIRLANIR. Yoksa plaka "sorulmuş" sayılır ve
  //   aynı plakayla ikinci deneme hiç istek atmaz — geçici bir ağ hatası
  //   kalıcı sessizliğe döner.
  if (error) { dbHata('takas plaka ara', error); takasPlakaSon = ''; return }
  // Kullanıcı beklerken plakayı değiştirdiyse bu yanıt BAYAT — yazma.
  if ((document.getElementById('sdTakasPlaka')?.value || '').trim() !== ham) return
  if (!data?.bulundu) { kutu.classList.add('hidden'); kutu.innerHTML = ''; return }

  // ⚠️ DOLU ALANI EZME. Danışman kendi yazdıysa üstüne yazmak veri kaybı.
  const dolduruldu = []
  const yilEl = document.getElementById('sdTakasYil')
  if (yilEl && !yilEl.value.trim() && data.yil) { yilEl.value = data.yil; dolduruldu.push('model yılı') }
  const bilgiEl = document.getElementById('sdTakasBilgi')
  if (bilgiEl && !bilgiEl.value.trim() && data.arac_bilgisi) { bilgiEl.value = data.arac_bilgisi; dolduruldu.push('araç bilgisi') }

  const durumAd = ARAC_DURUM_ETIKET[data.durum] || data.durum || '—'
  const cls = data.aktif_stok
    ? 'bg-amber-50 border-amber-300 text-amber-900'
    : 'bg-surface-container-low border-outline-variant text-on-surface-variant'
  const uyari = data.aktif_stok
    ? `<p class="mt-1 font-bold">Bu araç şu an bizim aktif stoğumuzda. Plakayı kontrol edin — yanlışsa takas yanlış araca bağlanır.</p>`
    : ''
  kutu.className = `rounded-lg border p-2.5 text-label-sm ${cls}`
  kutu.innerHTML = `<div class="flex items-start gap-2">
      ${mat(data.aktif_stok ? 'warning' : 'info', 'text-[16px] shrink-0 mt-0.5')}
      <div class="min-w-0">
        <p><b>Sistemde kayıtlı:</b> ${kacis(durumAd)}${data.arac_bilgisi ? ' · ' + kacis(data.arac_bilgisi) : ''}</p>
        ${dolduruldu.length ? `<p class="mt-0.5">${kacis(dolduruldu.join(' ve '))} otomatik dolduruldu.</p>` : ''}
        <p class="mt-0.5">Yeni kayıt açılmayacak; takas bu araca bağlanacak.</p>
        ${uyari}
      </div>
    </div>`
}

// --- BEYAN (takas noter beyanı) -------------------------------------------
// Göksenil (21 Ağu 2026): "takas değerine yazdığım şey canlı olarak beyan'da
//   yazmalı ama beyanı kullanıcı değiştirebilir olmalı."
//
// ⚠️ KİRLİ BAYRAĞI ŞART. Aynalama koşulsuz olsaydı kullanıcının elle yazdığı
//   beyan, takas değerine bir daha dokunulduğu anda ezilirdi — "yazdım, gitti"
//   sınıfı hata. Kullanıcı beyana bir kez dokunduysa ayna durur.
// ⚠️ BEYAN DAİMA ₺. Takas değeri USD/EUR/altın olabilir; beyan noterde TL
//   yazılır. O yüzden ayna HAM tutarı değil TL KARŞILIĞINI kopyalar. Kur
//   girilmemişse kopyalanacak güvenilir bir sayı yoktur → ayna bekler.
let beyanElle = false
let beyanAynaSon = ''   // aynanın en son yazdığı değer — "kullanıcı mı değiştirdi?" ölçütü

function beyanTlKarsiligi() {
  const miktar = sayiOku(document.getElementById('sdTutar')?.value)
  if (!miktar) return null
  const pb = document.getElementById('sdParaBirimi')?.value || 'TRY'
  if (pb === 'TRY') return miktar
  const kur = sayiOku(document.getElementById('sdKur')?.value)
  return kur ? miktar * kur : null
}

function beyanAynala() {
  const el = document.getElementById('sdBeyan'); if (!el || beyanElle) return
  const tl = beyanTlKarsiligi()
  beyanAynaSon = tl ? Math.round(tl).toLocaleString('tr-TR') : ''
  el.value = beyanAynaSon
}

// Kullanıcı beyana dokundu → ayna kapanır, not değişir.
function beyanElleIsaretle() {
  if (beyanElle) return
  beyanElle = true
  const not = document.getElementById('sdBeyanNot')
  if (not) {
    not.textContent = 'Elle girildi — takas değerini artık izlemiyor.'
    not.classList.add('text-amber-800')
  }
}

// Para birimi değişince: kur alanı + tutar etiketi + para-gir sınıfı.
function paraBirimiUygula() {
  const pb = document.getElementById('sdParaBirimi')?.value || 'TRY'
  const tl = pb === 'TRY'
  document.getElementById('sdKurSarma')?.classList.toggle('hidden', tl)
  const tutar = document.getElementById('sdTutar')
  if (tutar) {
    tutar.classList.toggle('para-gir', tl)
    if (tl) { const ham = String(tutar.value || '').replace(/\D/g, ''); tutar.value = ham ? Number(ham).toLocaleString('tr-TR') : '' }
  }
  const lbl = document.getElementById('sdTutarLbl')
  if (lbl) lbl.textContent = `${lbl.dataset.etiket || 'Tutar'} (${birimKisa(pb)})`
  dovizOnizlemeCiz()
}

// Canlı önizleme: "1.000 USD × 34,25 = 34.250,00 ₺". TL karşılığını KAYDEDERKEN
// DB hesaplar; bu yalnız danışmanın gördüğü kontrol satırıdır.
function dovizOnizlemeCiz() {
  const el = document.getElementById('sdDovizOnizleme'); if (!el) return
  const pb = document.getElementById('sdParaBirimi')?.value || 'TRY'
  if (pb === 'TRY') { el.textContent = ''; return }
  const miktar = sayiOku(document.getElementById('sdTutar')?.value)
  const kur = sayiOku(document.getElementById('sdKur')?.value)
  if (!miktar || !kur) { el.textContent = 'Tutar ve kur girilince TL karşılığı burada görünür.'; return }
  el.innerHTML = `${fmtSayi(miktar, 0, 4)} ${kacis(birimKisa(pb))} × ${fmtSayi(kur, 2, 6)} = <b class="text-on-surface">${fmtTL2(miktar * kur)}</b>`
}

// Otosor: masraf = kredi (brüt) × oran. Danışman masrafı elle değiştirdiyse
// (otosorMasrafElle) otomatik hesap tutarı EZMEZ.
// D4: brüt artık formdan DEĞİL kredi modülünden (siparis_kredi_ozeti, sql/197).
// Danışman yalnız hesaplanan masrafı gerekirse düzeltebilir (otosorMasrafElle).
function otosorHesapla() {
  const oran = ayarSayi('otosor_dosya_masrafi_orani')
  const kredi = KREDI_OZET?.var && KREDI_OZET.brut != null ? Number(KREDI_OZET.brut) : null
  const masraf = (oran != null && kredi) ? Math.round(kredi * oran * 100) / 100 : null
  const bilgi = document.getElementById('sdOtosorHesap')
  if (bilgi) {
    bilgi.innerHTML = masraf == null
      ? (kredi == null
          ? 'Kredi tutarı gelmedi — masraf hesaplanamıyor.'
          : `Oran tanımlı değil — masraf hesaplanamıyor.`)
      : `Dosya masrafı = Kredi <b>${fmtPara(kredi)}</b> × ${oranMetin(oran)} = <b class="text-on-surface">${fmtTL2(masraf)}</b>`
  }
  if (masraf != null && !otosorMasrafElle) {
    const t = document.getElementById('sdTutar')
    if (t) t.value = Math.round(masraf).toLocaleString('tr-TR')
  }
}

// Noter harcı tabanını RPC'den al, forma yaz (tutar ön-dolu + bilgi kutusu).
async function noterHarcUygula() {
  const { data, error } = await supabase.rpc('noter_harci_hesapla', { p_siparis: S.id })
  const bilgi = document.getElementById('sdHarcBilgi')
  if (error) {
    dbHata('noter harcı hesapla', error)
    NOTER_HARC = null
    if (bilgi) bilgi.innerHTML = `${mat('warning', 'text-[16px] text-error')} Noter harcı tabanı hesaplanamadı — tutarı elle girin. (${kacis(error.message || 'bilinmeyen hata')})`
    return
  }
  NOTER_HARC = (Array.isArray(data) ? data[0] : data) || null
  if (!NOTER_HARC) {
    if (bilgi) bilgi.innerHTML = `${mat('warning', 'text-[16px] text-error')} Noter harcı tabanı bulunamadı — tutarı elle girin.`
    return
  }
  const { anlasilan, kasko_degeri: kasko, taban, oran, harc } = NOTER_HARC
  if (bilgi) {
    bilgi.innerHTML = `Taban: MAX(anlaşılan <b>${anlasilan != null ? fmtPara(anlasilan) : '—'}</b> · kasko <b>${kasko != null ? fmtPara(kasko) : '—'}</b>) × ${oranMetin(oran)} = <b class="text-on-surface">${fmtTL2(harc)}</b>`
      + `<div class="mt-1">Tutarı artırabilirsiniz; bu tabanın <b>altına inemez</b>.${Number(taban || 0) <= 0 ? ' <span class="text-error">Taban 0 — anlaşılan tutar/kasko değeri yok.</span>' : ''}</div>`
  }
  const t = document.getElementById('sdTutar')
  if (t && !sayiOku(t.value)) t.value = Math.round(Number(harc) || 0).toLocaleString('tr-TR')
}

// Form sayfanın içinde olduğu için açma/kapama/aksiyon değişimi ciz() ile olur;
// ayrı bir DOM enjeksiyonu yok. `drawerAcik` adı korundu — çağıran yerler
// (kaydet, iptal, ters kayıt) aynı isimle çalışıyor.
function aksiyonSec(kod) {
  aksiyonSecili = kod
  ciz()
}
// aksiyon verilirse doğrudan o formla açılır (Düzenle → ters+yeni akışı için)
function drawerAc(aksiyon = null) {
  drawerAcik = true; aksiyonSecili = aksiyon
  ciz()
  // Form sol kolonun en üstünde; kullanıcı sayfanın altındaki bir satırdan
  // "düzelt" dediyse formu göremeyebilir — görüş alanına al.
  document.getElementById('sdCariEkleBtn')?.scrollIntoView({ block: 'nearest' })
  document.getElementById('sdAksiyonGeri')?.scrollIntoView({ block: 'nearest' })
}

// Form çizildikten sonraki hazırlık (async veri / ilk hesap). Tek yerde
// olsun ki aksiyonSec ve drawerAc aynı davranışı üretsin.
function formHazirla() {
  otosorMasrafElle = false
  // ⚠️ Beyan aynası her formda SIFIRDAN başlar. Bayrak modül düzeyinde
  //   tutulduğu için sıfırlanmazsa bir kez elle beyan giren danışmanın
  //   sonraki takasında ayna hiç çalışmazdı (aynı sayfa, aynı oturum).
  beyanElle = false; beyanAynaSon = ''
  takasPlakaSon = ''; clearTimeout(takasAramaZaman)
  if (aksiyonSecili === 'NOTER_HARCI') { NOTER_HARC = null; noterHarcUygula() }
  if (aksiyonSecili === 'OTOSOR_DOSYA_MASRAFI') otosorHesapla()
  // D1: form ilk açıldığında da otomatik kasa uygulanmalı — yalnız `change`
  // olayına bağlansaydı danışman ödeme tipine dokunmadan kaydettiğinde kasa
  // boş kalır ve CHECK insert'i reddederdi.
  kasaOtomatikUygula()
  bakiyeOnizlemeCiz()
}
function drawerKapat() {
  drawerAcik = false; aksiyonSecili = null
  ciz()
}

// --- "Satışı Gerçekleştir" (noter) modalı ---------------------------------
function satisModalHtml() {
  if (!satisModalAcik) return ''
  const bugun = bugunISO()
  return `<div id="sdSatisModal" class="fixed inset-0 z-[100] bg-on-surface/40 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
      <div class="px-6 py-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
        <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-secondary/15 flex items-center justify-center text-secondary">${mat('task_alt')}</div>
          <div><h2 class="text-xl font-extrabold text-primary tracking-tight">Satışı Gerçekleştir</h2><p class="text-xs text-on-surface-variant">Noter bilgileri</p></div></div>
        <button id="sdSatisKapat" class="p-2 hover:bg-white rounded-full text-on-surface-variant">${mat('close')}</button></div>
      <div class="flex-1 overflow-y-auto p-6 space-y-4">
        <div id="sdSatisHata" class="hidden bg-error-container text-on-error-container border border-error/20 rounded-lg px-4 py-2.5 text-sm"></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Noter Tarihi</label><input id="sdNoterTarih" type="date" value="${bugun}" class="${INP} mt-1" /></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Noter Adı</label><input id="sdNoterAdi" type="text" placeholder="Noterlik adı" class="${INP} mt-1" /></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Yevmiye No</label><input id="sdYevmiyeNo" type="text" class="${INP} mt-1" /></div>
        ${/* Satış tipi sipariş açılırken soruluyor; burada DÜZELTİLEBİLİR.
              Teslim sonrası değişiklik satis_snapshot'a da yansır (sql/164) —
              yani Satış Merkezi eski değeri göstermeye devam etmez. */''}
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Satış Tipi</label>
          <select id="sdSatisTipi" class="${INP} mt-1"><option value="">Seçiniz…</option>${
            Object.entries(TANIM['SATIS_SEKLI'] || {}).map(([k, a]) =>
              `<option value="${kacis(k)}" ${S.satis_sekli === k ? 'selected' : ''}>${kacis(a)}</option>`).join('')
          }</select></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Yeni Ruhsat No</label><input id="sdYeniRuhsat" type="text" class="${INP} mt-1" /></div>
        <div>
          <label class="text-[11px] font-bold text-on-surface-variant uppercase">Plaka Değişti mi?</label>
          ${/* Noter Satış Bilgisi kartındaki BEYANDAN ön-doldurulur (sql/150).
                Beyan "değişecek" ise burası Evet açılır, danışman yeni plakayı
                yazar. Yine de değiştirilebilir — beyan tahmindir, burası
                gerçekleşendir (yeni_plaka). İkisini karıştırma. */''}
          ${beyanNotu()}
          <div class="flex gap-2 mt-1.5">
            <button type="button" id="sdPlakaHayir" data-secim="hayir" class="flex-1 py-2 rounded-lg border ${S.plaka_degisecek === true ? 'border-outline-variant text-on-surface-variant' : 'border-primary bg-primary text-on-primary'} font-bold text-label-md">Hayır</button>
            <button type="button" id="sdPlakaEvet" data-secim="evet" class="flex-1 py-2 rounded-lg border ${S.plaka_degisecek === true ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant text-on-surface-variant'} font-bold text-label-md">Evet</button>
          </div>
          <input id="sdYeniPlaka" type="text" placeholder="Yeni plaka" class="${INP} mt-2 ${S.plaka_degisecek === true ? '' : 'hidden'}" />
        </div>
      </div>
      <div class="px-6 py-5 bg-surface-container-low border-t border-outline-variant flex justify-end gap-3">
        <button id="sdSatisVazgec" class="px-6 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-white border border-transparent hover:border-outline-variant">Vazgeç</button>
        <button id="sdSatisKaydet" class="px-8 py-2.5 bg-secondary text-on-primary rounded-lg text-sm font-bold hover:opacity-90 shadow-md">Satışı Kesinleştir</button></div>
    </div></div>`
}

// Noter öncesi beyan ile satış anındaki gerçek durum ayrı iki bilgi; modalda
// hangisinden geldiğini yazmazsak danışman "ben bunu seçmemiştim" der.
function beyanNotu() {
  if (S.plaka_degisecek == null) return ''
  return `<p class="text-[11px] text-on-surface-variant mt-1">Kartta <b>${S.plaka_degisecek ? 'değişecek' : 'değişmeyecek'}</b> işaretlenmişti — gerçekleşen farklıysa değiştirin.</p>`
}

// --- Olay bağlama ----------------------------------------------------------
// #6: Sipariş İptal — neden sorar, araç sql/62 trigger'ıyla STOKTA'ya döner.
async function siparisIptalAc() {
  const { data: nedenler } = await supabase.from('tanimlar').select('kod, ad').eq('tip', 'IPTAL_NEDENI').eq('aktif', true).order('sira')
  const opts = (nedenler || []).map(n => `<option value="${kacis(n.kod)}">${kacis(n.ad)}</option>`).join('')
  const tahsilat = odenenToplam()   // #: tahsilat 0 değilse danışmanı uyar (cari geri alınmaz)
  const uyariHtml = tahsilat > 0.005 ? `<div class="bg-amber-50 border border-amber-300 rounded-lg p-3 text-[13px] text-amber-900">
      <b>⚠️ Dikkat:</b> Bu siparişte <b>${fmtPara(tahsilat)}</b> tutarında tahsilat/cari hareket var. İptal, cari hareketleri <b>GERİ ALMAZ</b> (ledger tarihsel kalır). İptalden önce <b>cari hareketleri kontrol et</b>.
      <label class="flex items-center gap-2 mt-2 font-bold cursor-pointer"><input type="checkbox" id="siKontrol" class="accent-error w-4 h-4" /> Cari hareketleri kontrol ettim, iptali onaylıyorum.</label>
    </div>` : ''
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-black/40 backdrop-blur-sm'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md" onclick="event.stopPropagation()">
    <div class="px-5 py-4 border-b border-outline-variant flex items-center gap-3 bg-error/5">
      <div class="w-10 h-10 rounded-xl bg-error-container flex items-center justify-center text-on-error-container">${mat('cancel')}</div>
      <div><h3 class="text-lg font-black text-error">Siparişi İptal Et</h3><p class="text-xs text-on-surface-variant">Araç otomatik STOKTA'ya döner.</p></div></div>
    <div class="p-5 space-y-3">
      <div id="siHata" class="hidden bg-error-container text-on-error-container rounded-lg px-3 py-2 text-sm"></div>
      ${uyariHtml}
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">İptal Nedeni *</label>
        <select id="siNeden" class="${INP} mt-1"><option value="">Seçiniz…</option>${opts}</select></div>
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Açıklama</label>
        <textarea id="siNot" rows="2" placeholder="Serbest açıklama (Diğer için zorunlu)" class="${INP} mt-1 resize-none"></textarea></div>
    </div>
    <div class="flex justify-end gap-2 px-5 pb-5"><button class="si-kapat px-5 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="siOnay" class="px-6 py-2.5 bg-error text-on-error rounded-lg text-sm font-bold hover:opacity-90">İptal Et</button></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelectorAll('.si-kapat').forEach(b => b.addEventListener('click', kapat))
  ov.querySelector('#siOnay').addEventListener('click', async () => {
    const hata = m => { const h = ov.querySelector('#siHata'); h.textContent = m; h.classList.remove('hidden') }
    ov.querySelector('#siHata').classList.add('hidden')
    const neden = ov.querySelector('#siNeden').value
    const not = ov.querySelector('#siNot').value.trim() || null
    if (!neden) return hata('İptal nedeni seçin.')
    if (neden === 'DIGER' && !not) return hata('"Diğer" için açıklama yazın.')
    if (tahsilat > 0.005 && !ov.querySelector('#siKontrol')?.checked) return hata('Bu siparişte tahsilat var — cari hareketleri kontrol ettiğinizi onaylayın.')
    const btn = ov.querySelector('#siOnay'); btn.disabled = true; btn.textContent = 'İptal ediliyor…'
    const { error } = await supabase.from('siparisler').update({ durum: 'IPTAL', iptal_nedeni: neden, iptal_not: not }).eq('id', S.id).select('id')
    if (error) { dbHata('sipariş iptal', error); btn.disabled = false; btn.textContent = 'İptal Et'; return hata('Başarısız: ' + error.message) }
    // BR-0501 — kapora varsa dosyada KAL: iade kararı kartı burada veriliyor.
    if (Number(S.kapora_tutar || 0) > 0) { kapat(); await yukle(); return }
    location.href = 'siparis.html'
  })
}

function baglaOlaylar() {
  document.getElementById('sdYazdir')?.addEventListener('click', () => window.print())
  document.getElementById('sdIptalBtn')?.addEventListener('click', siparisIptalAc)
  document.getElementById('sdOnayaGonderBtn')?.addEventListener('click', teslimatOnayaGonder)
  document.getElementById('sdNoterDevri')?.addEventListener('click', noterDevriAc)
  document.getElementById('sdNoterDuzelt')?.addEventListener('click', noterDevriAc)
  document.getElementById('sdTeslimEt')?.addEventListener('click', teslimEtAc)
  document.getElementById('mfOnay')?.addEventListener('click', () => minFiyatKarar(true))
  document.getElementById('mfRed')?.addEventListener('click', () => minFiyatKarar(false))
  evrakBagla(evrakCtx())

  // Araç belgeleri → imzalı URL + pop-up (doğrudan href 404 veriyordu)
  document.querySelectorAll('.sd-evrak').forEach(b =>
    b.addEventListener('click', () => evrakAc(b.dataset.yol, b.dataset.ad, B(one(S.stok_araclar)?.plaka))))
  // Eski sahibi → üzerine gelince balon
  document.querySelectorAll('.sd-balon').forEach(el => {
    el.addEventListener('mouseenter', () => eskiSahipBalonAc(el))
    el.addEventListener('mouseleave', eskiSahipBalonKapat)
    el.addEventListener('click', () => eskiSahipBalonAc(el))   // dokunmatik
  })
  document.getElementById('sdGuncelIste')?.addEventListener('click', sdGuncelEkspertizAc)
  document.getElementById('sdSigortaTamam')?.addEventListener('click', () => sartIsaretle('sigorta_tamam'))
  document.getElementById('sdEvrakTamam')?.addEventListener('click', () => sartIsaretle('evrak_tamam'))
  document.getElementById('kiIadeEt')?.addEventListener('click', () => kaporaKararVer('IADE_EDILECEK'))
  document.getElementById('kiIadeEtme')?.addEventListener('click', () => kaporaKararVer('IADE_EDILMEYECEK'))
  document.getElementById('sdPaylas')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); alert('Bağlantı kopyalandı.') }
    catch (e) { alert(location.href) }
  })
  document.getElementById('sdCariEkleBtn')?.addEventListener('click', () => drawerAc())
  document.getElementById('sdSatisGerBtn')?.addEventListener('click', () => {
    // #10: Bakiye 0 değilse satış gerçekleştirilemez; öncesinde teslimat onaya
    //      gönderilip ONAYLANMIŞ olmalı (finans akışı, sql/48 ile aynı kapı).
    const kalan = kalanBakiye()
    if (kalan == null) { alert('Cari bakiye görünmüyor — satış yapılamaz.'); return }
    if (kalan > 0.005) { alert('Bakiye sıfırlanmadan satış gerçekleştirilemez.\nKalan tahsilat: ' + fmtPara(kalan)); return }
    // ⚠️ Fazla tahsilat satışı ENGELLER (Göksenil düzeltmesi): bakiye tam
    //    sıfır olmadan noter satışı yapılamaz. Sunucudaki şart 5 (sql/149)
    //    de aynı kuralı uyguluyor — ikisi ayrışırsa buton açık görünüp
    //    işlem sunucuda patlardı.
    if (fazlaVarMi()) {
      alert('Bu dosyada ' + fmtPara(fazlaTahsilat()) + ' FAZLA TAHSİLAT var.\n\n'
        + 'Bakiye tam sıfırlanmadan satış gerçekleştirilemez. Fazlayı müşteriye iade edin '
        + 'ya da başka bir dosyaya mahsup edin.')
      return
    }
    if (S.teslimat_durumu !== 'ONAYLANDI') {
      alert('Satıştan önce teslimatı finans onayına gönderip onay alın.\nMevcut durum: ' + (S.teslimat_durumu ? (TESLIMAT_DURUM_ETIKET[S.teslimat_durumu] || S.teslimat_durumu) : 'onaya gönderilmedi'))
      return
    }
    satisModalAcik = true; ciz()
  })
  document.getElementById('sdFiltre')?.addEventListener('change', e => { filtreTip = e.target.value; ciz() })
  document.getElementById('sdExcel')?.addEventListener('click', excelAktar)
  document.querySelectorAll('[data-hmenu]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); hareketMenuAc(b, b.dataset.hmenu) }))

  document.getElementById('sdSatisKapat')?.addEventListener('click', () => { satisModalAcik = false; ciz() })
  document.getElementById('sdSatisVazgec')?.addEventListener('click', () => { satisModalAcik = false; ciz() })
  document.getElementById('sdPlakaHayir')?.addEventListener('click', () => plakaSecimUygula(false))
  document.getElementById('sdPlakaEvet')?.addEventListener('click', () => plakaSecimUygula(true))
  document.getElementById('sdSatisKaydet')?.addEventListener('click', satisGerceklestirKaydet)
  document.getElementById('sdNoterBedel')?.addEventListener('blur', noterBedelKaydet)
  document.getElementById('sdNotereGonderWa')?.addEventListener('click', notereGonderAc)
  document.querySelectorAll('[data-plakadeg]').forEach(b =>
    b.addEventListener('click', () => plakaDegisecekSec(b.dataset.plakadeg === 'evet')))
  document.getElementById('sdPlakaUcretEkle')?.addEventListener('click', plakaBasimUcretiSor)
  document.getElementById('sdTediyeBtn')?.addEventListener('click', tediyeEvrakiTikla)
  document.getElementById('sdKrediTransferBtn')?.addEventListener('click', krediTransferBildir)
  document.getElementById('sdSigortaGonderBtn')?.addEventListener('click', sigortayaGonder)

  // ciz() her veri yenilemede tekrar çağrılır — dinleyici birikmesin diye önce kaldır.
  window.removeEventListener('keydown', escKapat)
  window.addEventListener('keydown', escKapat)
}

function escKapat(e) {
  if (e.key !== 'Escape') return
  if (satisModalAcik) { satisModalAcik = false; ciz() }
  else if (drawerAcik) drawerKapat()
}

function baglaDrawerOlaylari() {
  document.getElementById('sdDrawerKapat')?.addEventListener('click', drawerKapat)
  document.querySelectorAll('[data-aksiyon]').forEach(b => b.addEventListener('click', () => aksiyonSec(b.dataset.aksiyon)))
  document.getElementById('sdAksiyonGeri')?.addEventListener('click', () => aksiyonSec(null))
  document.getElementById('sdOdemeTipi')?.addEventListener('change', e => odemeTipiUygula(e.target.value))
  document.getElementById('sdPos')?.addEventListener('change', kasaOtomatikUygula)
  // Döviz/altın: birim → kur alanı; tutar/kur → canlı TL önizlemesi
  document.getElementById('sdParaBirimi')?.addEventListener('change', () => { paraBirimiUygula(); bakiyeOnizlemeCiz(); beyanAynala() })
  document.getElementById('sdKur')?.addEventListener('input', () => { dovizOnizlemeCiz(); bakiyeOnizlemeCiz(); beyanAynala() })
  document.getElementById('sdTutar')?.addEventListener('input', () => {
    // Otosor'da danışman masrafı elle yazdıysa otomatik hesap artık ezmez
    if (aksiyonSecili === 'OTOSOR_DOSYA_MASRAFI') otosorMasrafElle = true
    dovizOnizlemeCiz()
    bakiyeOnizlemeCiz()
    beyanAynala()
  })
  // ⚠️ Kirli bayrağı TUŞA DEĞİL DEĞERE bakıyor. `keydown` ile işaretlemek
  //   yanlıştı: Tab, ok tuşu, Ctrl+C de tetikliyor ve alan hiç değişmeden
  //   ayna kapanıyordu. Ayna yazdığı değeri `beyanAynaSon`'da tutuyor;
  //   `input` anında değer ondan farklıysa değişikliği KULLANICI yapmıştır.
  //   (Binlik maskesi de `input` tetikler ama aynı metni üretir → fark yok.)
  //   Programatik `el.value = …` hiçbir olay yaymaz, yanlış işaretlemez.
  document.getElementById('sdTakasPlaka')?.addEventListener('input', takasPlakaArat)
  document.getElementById('sdTakasPlaka')?.addEventListener('blur', takasPlakaAra)
  const beyanEl = document.getElementById('sdBeyan')
  beyanEl?.addEventListener('input', () => {
    if (!beyanElle && beyanEl.value !== beyanAynaSon) beyanElleIsaretle()
  })
  document.getElementById('sdIslemKaydet')?.addEventListener('click', islemKaydetTikla)
}

// Ödeme tipine göre alanları göster/gizle (Kredi Kartı → kart türü alanı açılır).
// R6-4 Faz B: 'KREDI' seçeneği KALDIRILDI (bkz. TAHSILAT formu) — danışman
// artık kredi tahsilatını elle giremiyor, bu yüzden kredi dalı da kaldırıldı.
function odemeTipiUygula(deger) {
  const kart = deger === 'KREDI_KARTI'
  document.getElementById('sdKartTuruSarma')?.classList.toggle('hidden', !kart)
  kasaOtomatikUygula()
}

// --- D1: ödeme tipine göre kasa (Göksenil, 12 Ağu 2026) --------------------
// "nakit seçili ise kasa seçtirmeyecek · fiziki pos ise hangi bankanın posuysa
//  o banka hesabı otomatik seçilir · sanal pos ta kasa seçilmeyecek".
//
// ⚠️ KASA ALANI KALDIRILAMAZ, yalnız OTOMATİKLEŞİR. `cari_kasa_zorunlu` CHECK'i
//    (sql/64) TAHSİLAT/TEDİYE satırlarında kasa_hesap_id istiyor; select
//    kaldırılsa insert reddedilir ve kullanıcı sebebini göremezdi. Bu yüzden
//    select gizlenir ama değeri programatik doldurulur.
// ⚠️ POS'un bağlı hesabı silinmiş/pasif olabilir — o durumda otomatik seçim
//    başarısız olur ve kasa seçimi ELLE geri açılır, sessizce boş kalmaz.
function otomatikKasa() {
  const odeme = document.getElementById('sdOdemeTipi')?.value
  if (odeme === 'NAKIT') {
    const id = AYAR.varsayilan_nakit_kasa || KASA.find(k => k.tip === 'NAKIT')?.id || null
    return KASA.find(k => k.id === id) ? { id, aciklama: null } : null
  }
  if (odeme === 'KREDI_KARTI') {
    const p = POSLAR.find(x => x.kod === document.getElementById('sdPos')?.value)
    const id = p?.ozellikler?.kasa_hesap_id || null
    return KASA.find(k => k.id === id) ? { id, aciklama: p.ad } : null
  }
  return null   // Havale/EFT → paranın hangi bankaya geldiği gerçek bir seçim, elle kalır
}

function kasaOtomatikUygula() {
  const sec = document.getElementById('sdKasa')
  const sarma = document.getElementById('sdKasaSarma')
  const kutu = document.getElementById('sdKasaOto')
  const metin = document.getElementById('sdKasaOtoMetin')
  if (!sec || !sarma || !kutu) return
  const oto = otomatikKasa()
  if (oto) {
    sec.value = oto.id
    sarma.classList.add('hidden')
    kutu.classList.remove('hidden')
    if (metin) metin.innerHTML = `Kasa otomatik: <b>${kacis(kasaAd(oto.id))}</b>${oto.aciklama ? ` · ${kacis(oto.aciklama)}` : ''}`
  } else {
    sarma.classList.remove('hidden')
    kutu.classList.add('hidden')
  }
}

function plakaSecimUygula(evet) {
  document.getElementById('sdPlakaHayir')?.classList.toggle('bg-primary', !evet)
  document.getElementById('sdPlakaHayir')?.classList.toggle('text-on-primary', !evet)
  document.getElementById('sdPlakaHayir')?.classList.toggle('border-primary', !evet)
  document.getElementById('sdPlakaHayir')?.classList.toggle('text-on-surface-variant', evet)
  document.getElementById('sdPlakaEvet')?.classList.toggle('bg-primary', evet)
  document.getElementById('sdPlakaEvet')?.classList.toggle('text-on-primary', evet)
  document.getElementById('sdPlakaEvet')?.classList.toggle('border-primary', evet)
  document.getElementById('sdPlakaEvet')?.classList.toggle('text-on-surface-variant', !evet)
  document.getElementById('sdYeniPlaka')?.classList.toggle('hidden', !evet)
}

function excelAktar() {
  const basliklar = ['Tarih', 'Tip', 'Kalem', 'Ödeme', 'Kasa', 'Tutar (₺)', 'Para Birimi', 'Döviz Tutarı', 'Kur', 'Kredi Tutarı', 'Açıklama']
  const satirlar = HAREKETLER.map(h => [
    fmtTarihKisa(h.tarih), h.tip, katalogAd(h.alt_tip), ODEME_ETIKET[h.odeme_tipi] || '', kasaAd(h.kasa_hesap_id),
    h.tutar, h.para_birimi || 'TRY', h.tutar_doviz ?? '', h.para_birimi && h.para_birimi !== 'TRY' ? h.kur : '',
    h.kredi_tutari ?? '', h.aciklama || '',
  ])
  csvIndir(`satis-dosyasi-${(S.id || '').slice(0, 8)}`, basliklar, satirlar)
}

// Bir satır terslenebilir mi: kendisi zaten bir tersleme olmamalı VE daha önce
// terslenmemiş olmalı (ix_cari_ters_kayit_tek tek-eşleşme kısıtı, sql/64).
// Göksenil, 3 Ağu 2026: "cari defterinde sipariş borcu silinemez düzenlemez.
//   diğer bilgiler silinebilir / düzenlenebilir olmalı."
// SIPARIS_BORCU ve ACILIS satırları ELLE girilmez — trg_siparis_cari (sql/65)
// anlaşılan tutardan üretir. Elle düzeltilirse cari, siparişin anlaşma tutarıyla
// çelişir. Tutar değişecekse anlaşma tutarı değiştirilir; trigger farkı
// ANLASMA_DUZELTME satırı olarak kendisi yazar (o da SIPARIS_BORCU tipindedir).
const OTOMATIK_TIPLER = new Set(['SIPARIS_BORCU', 'ACILIS'])
function hareketTersleneblirMi(h) {
  if (OTOMATIK_TIPLER.has(h.tip)) return false
  if (h.ters_kayit_id) return false
  return !HAREKETLER.some(x => x.ters_kayit_id === h.id)
}

// --- ⋮ hareket menüsü (arac-detay.js kartMenu ile aynı desen) -------------
function hareketMenuAc(btn, id) {
  hareketMenuKapat()
  const h = HAREKETLER.find(x => x.id === id); if (!h) return
  const kilit = kilitliMi()
  const tersleneblir = hareketTersleneblirMi(h)
  const items = []
  if (!kilit && tersleneblir) items.push({ ik: 'edit', et: 'Düzenle', fn: () => hareketDuzenle(id) })
  if (!kilit && tersleneblir) items.push({ ik: 'undo', et: 'Ters Kayıt Oluştur', fn: () => hareketTersle(id) })
  // sql/173: kredi parası hesaba düştü mü? Yalnız Can/Bahadır (kredi_kullandirim_onay)
  // ya da master. Ters kaydı olan satırda anlamsız — RPC de reddeder.
  if (h.alt_tip === 'KREDI_TAHSILAT' && krediTeyitEdebilir() && !tersliIdSeti().has(h.id)) {
    items.push(h.kredi_teyit_zamani
      ? { ik: 'undo', et: 'Para teyidini geri al', fn: () => krediTeyitEt(id, false) }
      : { ik: 'account_balance', et: 'Para hesaba düştü', fn: () => krediTeyitEt(id, true) })
  }
  items.push({ ik: 'visibility', et: 'Detay', fn: () => hareketDetay(id) })
  // sql/189 · SİLME — yalnız master admin (Göksenil kararı, 12 Ağu 2026:
  //   ters kayıt yerine gerçek silme istendi). DB politikası birebir aynı:
  //   cari_sil = is_master(). Buradaki kapı yalnız düğmeyi gizler; yetkisiz
  //   biri çağırsa RLS 0 satır döner ve aşağıdaki kontrol uyarır (§5.1).
  //   İz kaybolmaz: trg_audit_tahsilat silinen satırın tamamını audit_log'a yazar.
  if (BEN?.master_admin) items.push({ ik: 'delete', et: 'Hareketi Sil', fn: () => hareketSil(id) })

  const menu = document.createElement('div')
  menu.className = 'fixed z-[80] w-48 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg py-1'
  menu.innerHTML = items.map((it, i) => `<button data-i="${i}" class="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-low flex items-center gap-2">${mat(it.ik, 'text-[16px]')} ${it.et}</button>`).join('')
  document.body.appendChild(menu); KMENU = menu
  const r = btn.getBoundingClientRect()
  menu.style.left = Math.max(8, Math.min(window.innerWidth - 200, r.right - 192)) + 'px'
  let top = r.bottom + 4
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4)
  menu.style.top = top + 'px'
  menu.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => { const it = items[+b.dataset.i]; hareketMenuKapat(); it.fn() }))
  KMENU_DIS = e => { if (!menu.contains(e.target)) hareketMenuKapat() }
  setTimeout(() => document.addEventListener('click', KMENU_DIS), 0)
}
// sql/173 — kredi parası teyidi. Sunucudaki guard ile AYNI koşul
// (is_master() or yetkili('kredi_kullandirim_onay')); burası yalnız düğmeyi
// gizler, asıl kapı RPC'nin içinde. Canlı ölçüm (7 Ağu 2026): bu yetki
// Can Kaya + Bahadır Çalmaz'da.
// sql/190 (Göksenil, 12 Ağu 2026): "hesaba geçtiğini kredi müdürü veya
// Bahadır'dan bilgi alınması gerekiyor." Önceden bu yetki `kredi_kullandirim_onay`
// taşıyan ALTI kişideydi (Arif Can, Cahit, Samet, İsmail dahil); paranın
// geldiğini hesabı gören kişi teyit etmeli.
// ⚠️ Sunucudaki `kredi_karar_yetkisi()` ile BİREBİR aynı koşul — burası
//    yalnız düğmeyi gizler, asıl kapı RPC'nin içinde.
function krediTeyitEdebilir() {
  return !!(BEN && (BEN.master_admin || BEN.mudur_birim === 'kredi' || BEN.mudur_birim === 'finans'))
}

async function krediTeyitEt(id, teyit) {
  const h = HAREKETLER.find(x => x.id === id); if (!h) return
  const soru = teyit
    ? `${fmtPara(h.tutar)} tutarındaki kredi parasının hesaba düştüğünü teyit ediyor musunuz?\n\nBanka: ${h.banka || '—'}\n\nTeyit sonrası cari satırı kırmızıdan normale döner.`
    : 'Para teyidi geri alınacak, satır yeniden kırmızı görünecek. Onaylıyor musunuz?'
  if (!confirm(soru)) return
  const { error } = await supabase.rpc('kredi_tahsilat_teyit', { p_hareket_id: id, p_teyit: teyit })
  if (error) { dbHata('kredi tahsilat teyit', error); alert('İşlem yapılamadı: ' + error.message); return }
  await yukle()
  // Sessiz başarı = bozuk buton sanılıyor — geri bildirim zorunlu.
  alert(teyit ? 'Para teyit edildi.' : 'Teyit geri alındı.')
}

function hareketMenuKapat() {
  if (KMENU_DIS) { document.removeEventListener('click', KMENU_DIS); KMENU_DIS = null }
  if (KMENU) { KMENU.remove(); KMENU = null }
}

// sql/189 · Cari hareketi SİL — geri alınamaz, yalnız master admin.
// ⚠️ Ters kayıt (Ters Kayıt Oluştur) hâlâ duruyor ve günlük düzeltme için
//   doğru olan odur; silme yalnız çöp/test kaydı temizliği içindir.
async function hareketSil(id) {
  const h = HAREKETLER.find(x => x.id === id); if (!h) return
  const ad = (B(katalogAd(h.alt_tip)) || h.tip)
  if (!confirm(`${ad} · ${fmtPara(h.tutar)}\n\nBu cari hareket TAMAMEN SİLİNECEK. Geri alınamaz ve bakiye yeniden hesaplanır.\n\nGünlük bir hatayı düzeltiyorsanız "Ters Kayıt Oluştur" daha doğrudur — o, izi koruyarak bakiyeyi sıfırlar.\n\nYine de silinsin mi?`)) return
  const { data, error } = await supabase.from('cari_hareketler').delete().eq('id', id).select('id')
  if (error) { dbHata('cari hareket sil', error); alert('Silinemedi: ' + error.message); return }
  // ⚠️ .delete() hata vermeden 0 satır silebilir (CLAUDE.md §5.1)
  if (!data || !data.length) { alert('Silinemedi — yetkiniz yok (yalnız master admin).'); return }
  await yukle()
  alert('Cari hareket silindi.')
}

function hareketDetay(id) {
  const h = HAREKETLER.find(x => x.id === id); if (!h) return
  const satir = (et, deger) => `<div class="flex justify-between gap-4 py-1.5 border-b border-outline-variant/40 last:border-0"><span class="text-on-surface-variant">${et}</span><span class="font-semibold text-right">${deger}</span></div>`
  const govde = [
    satir('Kalem', B(katalogAd(h.alt_tip)) || kacis(h.tip)),
    satir('Yön', kacis(h.tip)),
    satir('Tutar', fmtPara(h.tutar)),
    h.para_birimi && h.para_birimi !== 'TRY' ? satir('Döviz / Altın', `${fmtSayi(h.tutar_doviz, 0, 4)} ${kacis(birimKisa(h.para_birimi))}`) : '',
    h.para_birimi && h.para_birimi !== 'TRY' ? satir('İşlem Kuru', fmtSayi(h.kur, 2, 6)) : '',
    h.kredi_tutari != null ? satir('Kredi Tutarı (brüt)', fmtPara(h.kredi_tutari)) : '',
    satir('Tarih', fmtTarihKisa(h.tarih)),
    h.odeme_tipi ? satir('Ödeme Tipi', kacis(ODEME_ETIKET[h.odeme_tipi] || h.odeme_tipi)) : '',
    h.pos_turu ? satir('Kart Türü', kacis(POS_ETIKET[h.pos_turu] || h.pos_turu) + (h.pos_turu_serbest ? ' — ' + kacis(h.pos_turu_serbest) : '')) : '',
    h.alt_tip === 'KREDI_TAHSILAT' && h.banka ? satir('Banka', `<span class="${h.kredi_teyit_zamani ? 'font-bold' : 'text-error font-bold'}">${kacis(h.banka)}</span>`) : '',
    // sql/173 — para gerçekten hesaba düştü mü? Bakiyeye etkisi YOK, bilgi amaçlı.
    h.alt_tip === 'KREDI_TAHSILAT' ? satir('Para Durumu', h.kredi_teyit_zamani
      ? `<span class="text-secondary font-bold">Hesaba düştü</span> · ${fmtTarihKisa(h.kredi_teyit_zamani)}${h.kredi_teyit_eden ? ' · ' + kacis(danismanAdi(DMAP, h.kredi_teyit_eden)) : ''}`
      : '<span class="text-error font-bold">Bankadan bekleniyor</span>') : '',
    h.alt_tip === 'TAKAS_MAHSUP' && h.takas_noter_beyani != null ? satir('Takas Noter Beyanı', fmtPara(h.takas_noter_beyani)) : '',
    h.kasa_hesap_id ? satir('Kasa/Hesap', kacis(kasaAd(h.kasa_hesap_id))) : '',
    h.aciklama ? satir('Açıklama', B(h.aciklama)) : '',
    satir('Kaydeden', B(danismanAdi(DMAP, h.kaydeden))),
    satir('Kayıt Zamanı', fmtTarih(h.created_at)),
    h.ters_kayit_id ? satir('Durum', '<span class="text-error">Ters kayıt (iptal edilmiş)</span>') : '',
  ].filter(Boolean).join('')
  gosterBilgiModal('İşlem Detayı', `<div class="text-body-md">${govde}</div>`)
}

function gosterBilgiModal(baslik, icHtml) {
  document.getElementById('sdBilgiModal')?.remove()
  const div = document.createElement('div')
  div.id = 'sdBilgiModal'
  div.className = 'fixed inset-0 z-[110] bg-on-surface/40 backdrop-blur-sm flex items-center justify-center p-4'
  div.innerHTML = `<div class="bg-surface-container-lowest w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
    <div class="px-5 py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
      <h2 class="text-lg font-extrabold text-primary">${kacis(baslik)}</h2>
      <button data-kapat class="p-2 hover:bg-white rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div class="flex-1 overflow-y-auto p-5">${icHtml}</div></div>`
  document.body.appendChild(div)
  div.addEventListener('click', e => { if (e.target === div || e.target.closest('[data-kapat]')) div.remove() })
}

// Ters kayıt DAİMA TL yazılır: cari_ters_kayit_guard orijinalle aynı `tutar`ı
// (TL karşılığı) şart koşuyor. Döviz alanları kopyalanmaz — aksi hâlde trigger
// tutar'ı yeniden hesaplar ve guard'a takılırdı.
async function hareketTersle(id) {
  const h = HAREKETLER.find(x => x.id === id); if (!h) return
  if (!confirm(`"${katalogAd(h.alt_tip)}" (${fmtPara(h.tutar)}) için ters kayıt oluşturulsun mu? Bu işlem geri alınamaz, orijinal kayıt geçmişte kalır.`)) return
  const tamam = await cariSatirEkle({
    tip: h.tip, alt_tip: h.alt_tip, kasa_hesap_id: h.kasa_hesap_id, odeme_tipi: h.odeme_tipi,
    pos_turu: h.pos_turu, pos_turu_serbest: h.pos_turu_serbest, tutar: h.tutar, tarih: bugunISO(),
    aciklama: 'Ters kayıt: ' + (h.aciklama || katalogAd(h.alt_tip)), ters_kayit_id: h.id,
  })
  if (tamam) await yukle()
}

function hareketDuzenle(id) {
  const h = HAREKETLER.find(x => x.id === id); if (!h) return
  if (!confirm(`"${katalogAd(h.alt_tip)}" (${fmtPara(h.tutar)}) düzenlemek için önce ters kayıt oluşturulacak, sonra doğru tutarla yeni kayıt gireceksiniz. Devam edilsin mi?`)) return
  cariSatirEkle({
    tip: h.tip, alt_tip: h.alt_tip, kasa_hesap_id: h.kasa_hesap_id, odeme_tipi: h.odeme_tipi,
    pos_turu: h.pos_turu, pos_turu_serbest: h.pos_turu_serbest, tutar: h.tutar, tarih: bugunISO(),
    aciklama: 'Ters kayıt: ' + (h.aciklama || katalogAd(h.alt_tip)), ters_kayit_id: h.id,
  }).then(async tamam => {
    if (!tamam) return
    await yukle()
    // Düzeltilmiş değerle yeniden giriş için drawer'ı aynı aksiyonla aç
    const aksiyonKod = h.alt_tip === 'NAKIT_TAHSILAT' || h.alt_tip === 'HAVALE_TAHSILAT' || h.alt_tip === 'KREDI_KARTI_TAHSILAT' ? 'TAHSILAT'
      : h.alt_tip === 'KAPORA_IADESI' ? 'KAPORA_IADESI' : h.alt_tip === 'SAHIBINE_IADE' ? 'SAHIBINE_IADE'
      : h.alt_tip === 'TAKAS_MAHSUP' ? 'TAKAS_ARAC' : h.alt_tip === 'NOTER_MASRAFI' ? 'NOTER_MASRAFI'
      : h.alt_tip === 'NOTER_HARCI' ? 'NOTER_HARCI' : h.alt_tip === 'OTOSOR_DOSYA_MASRAFI' ? 'OTOSOR_DOSYA_MASRAFI'
      : (h.alt_tip === 'TRAFIK_SIGORTASI' || h.alt_tip === 'KASKO') ? 'SIGORTA' : null
    drawerAc(aksiyonKod)
  })
}

// --- Kaydetme aksiyonları ---------------------------------------------------
async function cariSatirEkle(gov) {
  if (!S.alici_musteri_id) { alert('Siparişte alıcı müşteri yok, işlem eklenemez.'); return false }
  const govde = { musteri_id: S.alici_musteri_id, siparis_id: S.id, kaydeden: BEN?.id, ...gov }
  const { data, error } = await supabase.from('cari_hareketler').insert(govde).select('id')
  if (error || !data?.length) { dbHata('cari işlem ekle', error); alert('Kaydedilemedi: ' + (error?.message || 'bilinmeyen hata')); return false }
  const { error: oErr } = await supabase.rpc('olay_ekle', { p_tip: gov.tip, p_arac: S.arac_id, p_musteri: S.alici_musteri_id, p_siparis: S.id, p_danisman: BEN?.id })
  if (oErr) dbHata('olay_ekle cari', oErr)
  return true
}

// Otosor: TEK cari satırı — dosya masrafı (D4, 12 Ağu 2026).
//   Eskiden burada ayrıca KREDI_TAHSILAT yazılıyordu. Kaldırıldı: aynı tahsilatı
//   kredi kullandırım onayı da yazıyor ve iki yol birden çalıştığında tahsilat
//   iki kez sayılıyordu. Kredi parası artık TEK kapıdan girer.
async function otosorKaydet({ krediBrut, masraf, kasa, tarih, aciklamaGirisi }) {
  const btn = document.getElementById('sdIslemKaydet')
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…' }
  const oncekiBakiye = kalanBakiye()

  const masrafOk = await cariSatirEkle({
    tip: 'TEDIYE', alt_tip: 'OTOSOR_DOSYA_MASRAFI', kasa_hesap_id: kasa,
    kredi_tutari: krediBrut, tutar: masraf, tarih,
    aciklama: [`Otosor Dosya Masrafı · Kredi ${fmtPara(krediBrut)}`, aciklamaGirisi].filter(Boolean).join(' · '),
  })
  if (btn) { btn.disabled = false; btn.textContent = 'İşlemi Kaydet' }
  if (!masrafOk) return
  drawerKapat()
  await yukle()
  canliBakiyeAnimasyonu(oncekiBakiye, kalanBakiye())
}

async function islemKaydetTikla() {
  const kod = aksiyonSecili; if (!kod) return
  // sayiOku: TL'de "1.000.000" → 1000000, döviz/altında "12,5" → 12.5
  const tutar = sayiOku(document.getElementById('sdTutar')?.value)
  if (!tutar || tutar <= 0) { alert('Geçerli bir tutar girin.'); return }
  const tarih = document.getElementById('sdTarih')?.value || bugunISO()
  const kasa = document.getElementById('sdKasa')?.value || null
  const odemeSecili = document.getElementById('sdOdemeTipi')?.value
  if (!kasa) { alert('Kasa/hesap seçin.'); return }
  const aciklamaGirisi = document.getElementById('sdAciklama')?.value.trim() || null

  let gov = null
  if (kod === 'TAHSILAT') {
    // R6-4 Faz B: 'KREDI' ödeme tipi KALDIRILDI — kredi tahsilatı artık yalnız
    // Can'ın kullandırım onayında (kredi_kullandirim_onayla RPC) cari'ye yazılır.
    const odeme = odemeSecili
    const altTip = odeme === 'NAKIT' ? 'NAKIT_TAHSILAT' : odeme === 'HAVALE_EFT' ? 'HAVALE_TAHSILAT' : 'KREDI_KARTI_TAHSILAT'
    // D2: POS artık katalogdan (sql/196). Eski `pos_turu` kolonu geçmiş
    // kayıtlar ve raporlar için DOLDURULMAYA DEVAM EDER — CHECK'i 3 değerle
    // sınırlı olduğu için katalog türü ona eşlenir, POS'un asıl kimliği
    // `pos_kod`ta durur.
    let posKod = null, pos = null, posSerbest = null
    if (odeme === 'KREDI_KARTI') {
      posKod = document.getElementById('sdPos')?.value || null
      if (!posKod) { alert('POS seçin. Tanımlı POS yoksa Cari İşlem Kalemleri → POS Cihazları ekranından ekleyin.'); return }
      const p = POSLAR.find(x => x.kod === posKod)
      pos = p?.ozellikler?.tur === 'FIZIKI' ? 'FIZIKI_POS' : (posKod === 'N_KOLAY' ? 'N_KOLAY_POS' : 'DIGER')
      posSerbest = p?.ad || null
    }
    gov = { tip: 'TAHSILAT', alt_tip: altTip, kasa_hesap_id: kasa, odeme_tipi: odeme, pos_turu: pos, pos_turu_serbest: posSerbest, pos_kod: posKod, tutar, tarih, aciklama: aciklamaGirisi }
  } else if (kod === 'KAPORA_IADESI' || kod === 'SAHIBINE_IADE') {
    const odeme = document.getElementById('sdOdemeTipi').value
    gov = { tip: 'TEDIYE', alt_tip: kod, kasa_hesap_id: kasa, odeme_tipi: odeme, tutar, tarih, aciklama: aciklamaGirisi }
  } else if (kod === 'TAKAS_ARAC') {
    // Blok C/3 (Göksenil, 5 Ağu 2026): takasla gelen araç ARAÇ KABUL'de
    // görünsün, bilgi işleme bildirim gitsin. Eskiden burada yalnız cari
    // satırı yazılıyor, plaka/yıl/bilgi serbest metin olarak açıklamaya
    // gömülüyordu → araç elle girilmezse KAYBOLUYORDU.
    // Artık tek RPC üçünü atomik yapar: taslak araç (ALIS_ADAYI) +
    // cari TAKAS_MAHSUP (takas_arac_id bağlı) + TAKAS_ARACI_GELDI olayı
    // (sql/162). gov null bırakılır — insert RPC içinde.
    const plaka = document.getElementById('sdTakasPlaka')?.value.trim() || ''
    const yilHam = document.getElementById('sdTakasYil')?.value.replace(/\D/g, '') || ''
    const bilgi = document.getElementById('sdTakasBilgi')?.value.trim() || ''
    // ⚠️ KARAR DEĞİŞTİ (Göksenil, 21 Ağu 2026). Eskiden burada şu yazıyordu:
    //   "cari hareketinde YALNIZ takas ettiğimiz fiyat geçerli. Takasın noter
    //    beyanı buraya GİRİLMEZ — o, aracın alış kaydının konusudur."
    //   Artık beyan cari satırına da yazılıyor (sql/235): cari defterde takas
    //   satırının yanında görünüyor ve Bahadır'ın onay kuyruğuna gidiyor.
    // ⚠️ Eski kararın KORUDUĞU ŞEY DURUYOR: beyan cari MATEMATİĞE girmiyor.
    //   Bakiye, tahsilat toplamı, resmî tahsilat hiçbiri onu okumaz —
    //   borcu düşüren tek sayı yine takas değeri. Ölçüldü.
    // Beyan DAİMA ₺: alan TL yazılır, tutar dövizse TL karşılığı aynalanır.
    const beyan = sayiOku(document.getElementById('sdBeyan')?.value)
    const { data: takasArac, error: takasErr } = await supabase.rpc('takas_araci_kaydet', {
      p_siparis: S.id, p_plaka: plaka || null, p_yil: yilHam ? Number(yilHam) : null,
      p_bilgi: bilgi || null, p_tutar: tutar, p_kasa: kasa, p_tarih: tarih,
      p_noter_beyani: beyan || null,
    })
    if (takasErr || !takasArac) {
      dbHata('takas araci kaydet', takasErr)
      alert('Takas kaydedilemedi: ' + (takasErr?.message || 'bilinmeyen hata'))
      return
    }
    drawerKapat()
    await yukle()
    return
  } else if (aksiyonBul(kod)?.katalog) {
    // Katalogdan gelen kalem — yön kataloğun kendisinde tanımlı (ozellikler.yon).
    // ⚠️ Varsayılan TEDIYE: kataloğa yön yazılmadan kalem eklenirse tutar
    //    borca eklenir. Yanlışlıkla TAHSILAT sayıp borcu azaltmaktan iyidir.
    const kt = (KATALOG || []).find(x => x.kod === kod)
    gov = { tip: kt?.ozellikler?.yon === 'TAHSILAT' ? 'TAHSILAT' : 'TEDIYE',
            alt_tip: kod, kasa_hesap_id: kasa, tutar, tarih, aciklama: aciklamaGirisi }
  } else if (kod === 'NOTER_MASRAFI') {
    gov = { tip: 'TEDIYE', alt_tip: 'NOTER_MASRAFI', kasa_hesap_id: kasa, tutar, tarih, aciklama: aciklamaGirisi }
  } else if (kod === 'SIGORTA') {
    const tip = document.getElementById('sdSigortaTip')?.value || 'TRAFIK_SIGORTASI'
    gov = { tip: 'TEDIYE', alt_tip: tip, kasa_hesap_id: kasa, tutar, tarih, aciklama: aciklamaGirisi }
  } else if (kod === 'NOTER_HARCI') {
    // Taban RPC'den geldi: danışman ARTIRABİLİR, azaltamaz (sql/80 kararı).
    const min = NOTER_HARC?.harc != null ? Number(NOTER_HARC.harc) : null
    if (min != null && tutar < min - 0.005) {
      alert(`Noter harcı ${oranMetin(NOTER_HARC.oran)} tabanının altına inemez (en az ${fmtTL2(min)}).`)
      return
    }
    gov = { tip: 'TEDIYE', alt_tip: 'NOTER_HARCI', kasa_hesap_id: kasa, tutar, tarih, aciklama: aciklamaGirisi }
  } else if (kod === 'OTOSOR_DOSYA_MASRAFI') {
    // D4: brüt kredi tutarı kredi modülünden gelir, danışman girmez.
    // ⚠️ Kayıt yoksa DURDURULUR — uydurma bir brüt üzerinden masraf yazmak,
    //    müşterinin borcunu yanlış tutarla artırır.
    const krediBrut = KREDI_OZET?.var && KREDI_OZET.brut != null ? Number(KREDI_OZET.brut) : null
    if (!krediBrut) {
      alert('Kredi tutarı kredi modülünden gelmedi — dosya masrafı yazılamaz.\n\nKredi birimi kullandırım kaydını girmeden bu işlem yapılamaz.')
      return
    }
    if (!tutar) { alert('Dosya masrafı hesaplanamadı.'); return }
    return otosorKaydet({ krediBrut, masraf: tutar, kasa, tarih, aciklamaGirisi })
  }
  if (!gov) return

  // Döviz/altın: TL karşılığını DB hesaplar (sql/80 trg_cari_doviz_tl) →
  // `tutar` GÖNDERİLMEZ; girilen değer tutar_doviz olur.
  const paraBirimi = document.getElementById('sdParaBirimi')?.value || 'TRY'
  if (paraBirimi !== 'TRY') {
    const kur = sayiOku(document.getElementById('sdKur')?.value)
    if (!kur || kur <= 0) { alert('İşlem anındaki kuru girin.'); return }
    delete gov.tutar
    gov.para_birimi = paraBirimi
    gov.tutar_doviz = tutar
    gov.kur = kur
  }

  const btn = document.getElementById('sdIslemKaydet'); if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…' }
  const oncekiBakiye = kalanBakiye()
  const tamam = await cariSatirEkle(gov)
  if (!tamam) { if (btn) { btn.disabled = false; btn.textContent = 'İşlemi Kaydet' }; return }
  if (btn) { btn.disabled = false; btn.textContent = 'İşlemi Kaydet' }
  drawerKapat()
  await yukle()
  canliBakiyeAnimasyonu(oncekiBakiye, kalanBakiye())
}

// Güncel Bakiye KPI'sını eski→yeni değere kısa bir sayaçla animasyonla geçirir.
function canliBakiyeAnimasyonu(eski, yeni) {
  if (eski == null || yeni == null || eski === yeni) return
  const el = document.getElementById('sdGuncelBakiyeDeger')
  if (!el) return
  const sure = 550, basla = performance.now()
  const adim = now => {
    const t = Math.min(1, (now - basla) / sure)
    const deger = eski + (yeni - eski) * t
    el.textContent = fmtPara(Math.round(deger))
    if (t < 1) requestAnimationFrame(adim)
  }
  requestAnimationFrame(adim)
}

async function satisGerceklestirKaydet() {
  const tarih = document.getElementById('sdNoterTarih')?.value
  const noterAdi = document.getElementById('sdNoterAdi')?.value.trim() || null
  const yevmiye = document.getElementById('sdYevmiyeNo')?.value.trim() || null
  const yeniRuhsat = document.getElementById('sdYeniRuhsat')?.value.trim() || null
  const plakaDegisti = document.getElementById('sdPlakaEvet')?.classList.contains('bg-primary')
  const yeniPlaka = plakaDegisti ? (document.getElementById('sdYeniPlaka')?.value.trim() || null) : null
  const hata = msg => { const h = document.getElementById('sdSatisHata'); if (h) { h.textContent = msg; h.classList.remove('hidden') } }
  if (!tarih) return hata('Noter tarihi girin.')

  const btn = document.getElementById('sdSatisKaydet'); if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…' }
  const satisTipi = document.getElementById('sdSatisTipi')?.value || null
  const { data, error } = await supabase.from('siparisler').update({
    satis_tarihi: tarih, noter_adi: noterAdi, yevmiye_no: yevmiye,
    yeni_ruhsat_seri_no: yeniRuhsat, yeni_plaka: yeniPlaka,
    satis_sekli: satisTipi,
  }).eq('id', S.id).select('id')
  if (btn) { btn.disabled = false; btn.textContent = 'Satışı Kesinleştir' }
  if (error || !data?.length) { dbHata('satışı gerçekleştir', error); return hata('Kaydedilemedi: ' + (error?.message || 'bilinmeyen hata')) }
  satisModalAcik = false
  await yukle()
}

// R7-5: Noter satış bedeli — blur'da kaydeder (mevcut kolon, siparisler.noter_satis_tutari).
// Değişmediyse boşuna yazmaz. §5: .update() sonrası .select('id') + length kontrolü.
async function noterBedelKaydet(e) {
  const raw = (e.target.value || '').replace(/\D/g, '')
  const tutar = raw ? Number(raw) : null
  const oncekiTutar = S.noter_satis_tutari != null ? Number(S.noter_satis_tutari) : null
  if (tutar === oncekiTutar) return
  const { data, error } = await supabase.from('siparisler').update({ noter_satis_tutari: tutar }).eq('id', S.id).select('id')
  if (error || !data?.length) { dbHata('noter satış bedeli güncelle', error); alert('Noter satış bedeli kaydedilemedi: ' + (error?.message || 'bilinmeyen hata')); return }
  await yukle()
}

// --- Notere Gönder (WhatsApp) ---------------------------------------------
// wa.me/?text= hedef numara belirtmez; danışman WhatsApp'ta noteri kendisi
// seçer. Metin: plaka · km · kasko kodu · müşteri · anlaşılan · noter bedeli.
//
// ⚠️ Bu pencere ARTIK SORU SORMAZ. "Plaka değişecek mi?" ve plaka basım
//    ücreti Noter Satış Bilgisi kartına taşındı (Göksenil, 3 Ağu 2026):
//    burada sorulunca cevap hiçbir yere yazılmıyor, pencere kapanınca
//    kayboluyordu. Pencerenin tek işi mesajı göstermek + WhatsApp'ı açmak.
// ⚠️ Yerel `kaskoKodu` KALDIRILDI — veri.js'te TEK KAYNAK olarak duruyor
//   (tanımı birebir aynı: elle girilen kod varsa o, yoksa TSB marka-tip).
//   Kredi kuyruğu da aynı kutuyu gösterdiği için kopya tutulmuyor.

// Plaka satırı KARTTAKİ cevaptan gelir. Cevaplanmadıysa mesaja yanlış bir
// varsayım ("değişmeyecek") yazmaktansa hiç yazma — notere yanlış bilgi
// gitmesindense eksik gitsin, danışman zaten kartta uyarılıyor.
function notereMetin() {
  const a = one(S.stok_araclar), m = one(S.musteriler)
  const tcSon4 = TCKN ? String(TCKN).slice(-4) : null
  return [
    'Noter satış bilgisi',
    `Araç: ${buyuk(aracBaslik(a))}`,
    `Plaka: ${a?.plaka ? buyuk(a.plaka) : '—'}`,
    `KM: ${a?.km != null ? fmtSayi(a.km, 0, 0) : '—'}`,
    `Kasko Kodu: ${kaskoKodu(a) || '—'}`,
    `Müşteri: ${buyuk(m?.ad_soyad || '—')}${tcSon4 ? ' (TC ***' + tcSon4 + ')' : ''}`,
    `Anlaşılan Fiyat: ${S.anlasilan_tutar != null ? fmtPara(S.anlasilan_tutar) : '—'}`,
    `Noter Satış Bedeli: ${S.noter_satis_tutari != null ? fmtPara(S.noter_satis_tutari) : '—'}`,
    S.plaka_degisecek == null ? null : (S.plaka_degisecek ? 'Plaka değişecek' : 'Plaka değişmeyecek'),
  ].filter(Boolean).join('\n')
}

function notereGonderAc() {
  const cevapsiz = S.plaka_degisecek == null
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-sm overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md mb-8" onclick="event.stopPropagation()">
      <div class="px-5 py-4 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low">
        <div class="w-10 h-10 rounded-xl bg-secondary/15 flex items-center justify-center text-secondary">${mat('chat', '', true)}</div>
        <div><h3 class="text-lg font-black text-primary">Notere Gönder</h3>
          <p class="text-xs text-on-surface-variant">Mesajı kontrol edin, WhatsApp'ta noteri seçeceksiniz.</p></div>
      </div>
      <div class="p-5 space-y-3">
        ${cevapsiz
          ? `<div class="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-[12.5px] text-amber-900 flex items-start gap-2">
               ${mat('info', 'text-[16px] shrink-0')}
               <span><b>Plaka değişecek mi?</b> sorusu henüz cevaplanmadı — mesajda plaka satırı yer almıyor.
                 Cevaplamak için pencereyi kapatıp <b>Noter Satış Bilgisi</b> kartındaki seçimi yapın.</span>
             </div>`
          : `<div class="bg-surface-container-low rounded-lg p-2.5 text-label-sm text-on-surface-variant flex items-center gap-1.5">
               ${mat(S.plaka_degisecek ? 'sync_alt' : 'check_circle', 'text-[16px]')}
               Plaka ${S.plaka_degisecek ? '<b class="mx-1">değişecek</b>' : '<b class="mx-1">değişmeyecek</b>'} (kartta işaretlendi)
             </div>`}
        <div>
          <label class="${LBL}" for="ngMetin">Gönderilecek Mesaj</label>
          <textarea id="ngMetin" rows="9" readonly class="${INP} mt-1 resize-none font-mono text-[12px] leading-relaxed"></textarea>
        </div>
      </div>
      <div class="flex justify-end gap-2 px-5 pb-5">
        <button class="ng-kapat px-5 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
        <button id="ngGonder" class="px-6 py-2.5 bg-secondary text-on-primary rounded-lg text-sm font-bold hover:opacity-90 flex items-center gap-2">${mat('open_in_new', 'text-[18px]')} WhatsApp'ta Aç</button>
      </div>
    </div>`
  document.body.appendChild(ov)

  const escDinle = e => { if (e.key === 'Escape') kapat() }
  const kapat = () => { document.removeEventListener('keydown', escDinle); ov.remove() }
  document.addEventListener('keydown', escDinle)
  ov.addEventListener('click', e => { if (e.target === ov) kapat() })
  ov.querySelectorAll('.ng-kapat').forEach(b => b.addEventListener('click', kapat))
  ov.querySelector('#ngMetin').value = notereMetin()

  ov.querySelector('#ngGonder').addEventListener('click', () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(notereMetin()), '_blank')
    kapat()
  })
}
