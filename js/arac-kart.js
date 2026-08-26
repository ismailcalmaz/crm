// =====================================================================
// arac-kart.js — DMS Araç Kartı (stok_araclar 360-lite), 3 kolonlu düzen.
//   Satır A: Teknik | Ekspertiz (SVG şema + PDF) | Fiyat
//   Satır B: Kredi simülatörü (OTOSOR/Bireysel/Tüzel) | Foto galeri | Eşleşen müşteri
//   Satır C: Araç notları | Yaşam döngüsü
//   Gizlilik DB'de: v_arac_maliyet (finans), arac_tramer (yetkili) RLS ile boş döner.
//   Fiyat v_arac_guncel_fiyat'tan; kasko TSB listesinden; foto SITE yayın ilanından.
//   Finansal formüller TEK KAYNAK: kredi-hesap.js (§5). Ekspertiz SVG: ekspertiz.js.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import { uygunTalepler } from './eslestirme.js'
import { danismanMap, danismanAdi, fmtPara, fmtTarih, fmtTarihKisa, fmtButce, telNo, telSifirla, waHref, kacis, trBuyuk, buyuk, urlParam, kapanisMi, dbHata, ARAC_DURUM_ETIKET, REZERVASYON_NEDENLERI, rezervasyonNedenEtiket, disLokasyon,
  KDV_KODLARI, kdvEtiket, kdvYonetir, aracEtiket, markaAd, kaskoKodu } from './veri.js'
import { mat, avatar, basHarf, uyari, binlikInputKur, panoyaYaz } from './stitch-ui.js'
import { svgBoya, RENK, DURUM_ETIKET, DURUMLAR, PARCALAR, ekspertizFarkKaydet, ekspertizHedef } from './ekspertiz.js'
import { camEtiketiBasar, ilanYonetir, kullanimYonetir, operasyonIsiGorur, operasyonIsiYazar, fiyatYonetir } from './yetki.js'
// Dosya işlemleri TEK KAYNAK — bu dosyada ayrı upload/webp kopyası TUTMA.
import { fotograflariYukle, fotografSil, evrakAc, evrakImzaliUrl, evrakiYukle, evrakSil as dsEvrakSil, fotoUrl as dsFotoUrl } from './arac-dosya.js'
import { olayAdi, olayDetay, olaySistemMi, AI_SISTEM } from './veri.js'   // olay anlatımı tek kaynak
// Teslim planı çipleri TEK KAYNAK (sql/244-245). Burada yeniden tanımlama.
import { TESLIM_CIPLERI, gunEkleISO, bugunISO } from './veri.js'

// Şirket kullanımına ALINAMAYAN durumlar — müşteriye söz verilmiş araçlar.
// Sunucudaki kullanimdaki_tahsis_et() ile BİREBİR aynı liste (sql/165);
// burada gizlemek nezaket, asıl kapı orada.
const KULLANIM_DISI = ['KULLANIMDA', 'REZERVE', 'SIPARISTE', 'TESLIME_HAZIR', 'TESLIM_EDILDI']
import { ilanGorselAc, ilanGorselKur } from './ilan-gorsel-pencere.js'
import { masrafYukle, masrafGorur, masrafSayisi, masrafPencereAc } from './masraf-defteri.js'
import { krediUrunleriYukle, krediHesapla as kurumKarsilastir, enUcuz } from './kredi-motoru.js'
import { hesapOtosor, hesapBireysel, hesapTuzel, yenidenHesapla, taksittenKredi, otosorVade, pmt, VADELER_TUZEL, KREDI_TIPLERI, VARSAYILAN_ORANLAR,
         krediOranlariYukle as oranlariYukle, kaskoBedeliYukle as kaskoYukleOrtak } from './kredi-hesap.js'

let benim = null, dmap = {}, id = null, sonArac = null, svgTxt = ''
let KASALAR = []   // kapora tahsilati icin kasa secimi (sql/172)
let TANIM = {}   // tip -> [{kod,ad}] (YAKIT/VITES/KASA_TIPI/RENK/ARAC_TIPI) — kod→okunur ad
let sipRezAktif = null   // bu araç için aktif sipariş/rezervasyon (varsa)
let krediDurum = null    // bu aracın kredi durumu: 'onayli' | 'degerlendirmede' | null

// Foto galeri durumu (fotolar = {url, rowId, yol, silinebilir} nesneleri)
let fotolar = [], fotoIndex = 0, fotoTimer = null, fotoHover = false, canMedya = false
let canSirala = false, srcFoto = null   // foto sıralama (yalnız bilgi işlem)
let canEvrakSil = false                 // evrak silme (master + bilgi işlem + yönetici)
// Kredi simülatör durumu (aktif tip + o tipin canlı hesabı)
let krediTip = 'otosor', krediFiyat = null, krediKasko = null, krediOranlar = VARSAYILAN_ORANLAR
// 23 kurum ürünü (sql/157, DB'den). Araç kartındaki limit hesabı KENDİ
// mantığıyla kalıyor; bu liste yalnız "aynı tutarı en ucuz kim veriyor"
// şeridini beslemek için. Göksenil: "bireysel ve tüzelde en ucuz hangi
// banka veriyorsa o altta gösterilmeli."
let KURUM_URUNLERI = []

const DURUM_RENK = {
  ALINDI: 'bg-[#FFFBEB] text-[#B45309]', STOKTA: 'bg-[#EFF6FF] text-[#1D4ED8]',
  YAYINDA: 'bg-[#ECFDF5] text-[#047857]', REZERVE: 'bg-[#F5F3FF] text-[#6D28D9]',
  SIPARISTE: 'bg-[#EEF2FF] text-[#4338CA]', TESLIM_EDILDI: 'bg-white/15 text-white',
  SATIS_DISI: 'bg-[#FEF2F2] text-[#B91C1C]',
}
const EKS_RENK = {
  ORIJINAL: 'bg-green-100 text-green-800', BOYALI: 'bg-blue-100 text-blue-800',
  'LOKAL BOYA': 'bg-yellow-100 text-yellow-800', DEGISEN: 'bg-red-100 text-red-800',
  ONARIM: 'bg-orange-100 text-orange-800', PLASTIK: 'bg-slate-100 text-slate-700',
  BAKILAMADI: 'bg-gray-100 text-gray-600',
}
const EVRAK_ETIKET = { EKSPERTIZ_PDF: 'Ekspertiz PDF', EKSPERTIZ_LINK: 'Ekspertiz Linki', RUHSAT: 'Ruhsat', SBM_GORSEL: 'SBM Görseli', TRAMER_DETAY: 'Tramer Detay Sorgusu', DIGER: 'Diğer' }
// Siparişe Al panelindeki yeni müşteri formu için ortak input stili
const REZ_INP = 'w-full mt-0.5 bg-white border border-outline-variant rounded-lg px-2.5 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none'
// Kod → okunur ad (yakıt/vites/kasa/renk). Eşleşme yoksa kodu döndürür.
const tanimAd = (tip, kod) => (TANIM[tip] || []).find(t => t.kod === kod)?.ad || kod || ''
const pesinatMetni = v => v <= 0 ? 'Peşinatsız' : fmtPara(Math.round(v))
// #4: Kâr/Zarar görüntüleme yetkisi — yalnız master veya kz_goruntule (yönetici).
function kzGorebilir() { return !!(benim && (benim.master_admin || (Array.isArray(benim.yetkiler) && benim.yetkiler.includes('kz_goruntule')))) }

function uyumSkor(arac, t) {
  let p = 72
  const fiyat = Number(arac._fiyat) || 0
  const bmin = Number(t.butce_min) || 0, bmax = Number(t.butce_max) || 0
  if (fiyat > 0 && bmax) {
    if (fiyat <= bmax) p += 10
    if (bmin && fiyat >= bmin) p += 4
    if (bmin && bmax > bmin) { const orta = (bmin + bmax) / 2; const yakin = 1 - Math.min(1, Math.abs(fiyat - orta) / ((bmax - bmin) / 2)); p += Math.round(yakin * 8) }
  }
  p += (t.model && t.model !== '-') ? 8 : (t.marka ? 4 : 0)
  const yil = Number(arac.yil) || 0
  if (yil && t.model_yili_min && yil >= Number(t.model_yili_min)) p += 2
  return Math.max(60, Math.min(99, Math.round(p)))
}

export async function aracKartKur(danisman) {
  benim = danisman
  ilanGorselKur(danisman)
  // sql/186 · Silme yetkisi = master + bilgi işlem (+ eskiden beri `medya_yonet`).
  canMedya = !!(benim.master_admin || benim.rol === 'bilgi_islem'
    || (Array.isArray(benim.yetkiler) && benim.yetkiler.includes('medya_yonet')))
  // Evrak silme yalnız master + bilgi işlem + yönetici — DB'deki is_bilgi_islem()
  // fonksiyonunun aynası (kopyası değil: yetkisiz düğmeyi görmez, görse de RLS
  // 0 satır döner ve evrakSil() uyarır — CLAUDE.md §5.1).
  canEvrakSil = !!(benim.master_admin || benim.rol === 'bilgi_islem' || benim.rol === 'yonetici')
  // Fotoğraf SIRALAMA yalnız bilgi işlemde (Göksenil kuralı, 1 Ağu 2026).
  // Sıra = kapak fotoğrafı; danışman yanlışlıkla değiştirmesin.
  canSirala = !!(benim.master_admin || benim.rol === 'bilgi_islem')
  dmap = await danismanMap()
  id = urlParam('id')
  const kok = document.getElementById('kok')
  if (!id) { kok.innerHTML = '<div class="uyari-kutu">Araç bulunamadı. <a href="stok.html" class="text-primary font-bold">Stok Merkezi\'ne dön</a></div>'; return }
  kok.innerHTML = `<div class="py-24 text-center text-on-surface-variant">Araç yükleniyor…</div>`
  svgTxt = await fetch('img/ekspertiz-sema.svg').then(r => r.text()).catch(() => '')
  binlikInputKur()
  document.addEventListener('keydown', e => { if (e.key === 'Escape') lightboxKapat() })
  await yukle()
}

async function yukle() {
  const kok = document.getElementById('kok')
    const [aracR, fiyatR, maliyetR, talepR, notR, olayR, sipR, gecmisR, indR, ilanR, yasamR, kanalR,
           kasaR, tanimR, opIsR, opTedR, opTurR, masrafR, alisR, alisGecmisR] = await Promise.all([
    supabase.from('stok_araclar')
      .select(`id, plaka, stok_kodu, sasi_no, motor_no, marka, model, versiyon, yil, yakit, vites, kasa_tipi, renk, arac_tipi, km,
               tsb_marka_id, tsb_tip_id, kasko_kodu, lokasyon, park, yedek_anahtar, durum, fiyatlama_durumu, satis_disi_nedeni, muayene_tarihi, created_at,
               kdv_orani, tescil_tarihi, eski_plaka, foto_sira,
               arac_ekspertiz(parca_kodu, durum), arac_evraklar(id, tip, url), arac_tramer(sorgu_tarihi, hasar_tarihi, aciklama, tutar)`)
      .eq('id', id).single(),
    // G1: min satış fiyatı da gelsin (ⓘ balonu). Yetkisi olmayanda view boş
    // döner → _min null kalır ve ikon çizilmez (sql/99).
    supabase.from('v_arac_min_fiyat').select('satis_fiyati, min_satis_fiyati').eq('arac_id', id).maybeSingle(),
    // sql/199: kırılım da geliyor (alış + masraf = maliyet). Görünüm
    // security_invoker=on olduğu için RLS çağıran için değerlendirilir.
    supabase.from('v_arac_maliyet').select('maliyet, alis_fiyati, masraf_toplam').eq('arac_id', id).maybeSingle(),
    supabase.from('talepler').select('id, musteri_ad_soyad, telefon, marka, model, butce_min, butce_max, model_yili_min, model_yili_max, gorusme_notlari(sahip_danisman_id, musteri_durumu, created_at)').limit(2000),
    supabase.from('arac_notlari').select('id, icerik, danisman_id, created_at').eq('arac_id', id).order('created_at', { ascending: false }),
    supabase.from('olaylar').select('tip, veri, danisman_id, olusma_zamani').eq('arac_id', id).order('olusma_zamani', { ascending: false }).limit(50),
    // anlasilan_tutar ALINIYOR: Krediye Gönder kutusu bu tutarla ön dolar
    // (liste fiyatı DEĞİL — bkz. kgTutar notu).
    supabase.from('siparisler').select('id, asama, durum, anlasilan_tutar').eq('arac_id', id).in('asama', ['REZERVASYON', 'SIPARIS']).eq('durum', 'ACIK').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    // G2 fiyat geçmişi (sql/100). security_invoker=true → kimin göreceği
    // arac_fiyatlar'ın kendi SELECT politikasından gelir; yetkisizde BOŞ döner
    // ve bölüm hiç çizilmez (ikinci bir istemci kapısı gerekmez).
    supabase.from('v_arac_fiyat_gecmis')
      .select('sira, gecerli_baslangic, satis_fiyati, onceki_satis_fiyati, fark, yon, degistiren')
      .eq('arac_id', id).order('sira', { ascending: false }).limit(30),
    // G2 indirim rozeti (sql/101) — referans fiyat MEVZUATA GÖRE sunucuda.
    supabase.from('v_arac_indirim')
      .select('eski_fiyat, indirim_tutari, indirim_yuzde, referans_gun, referans_tarih')
      .eq('arac_id', id).maybeSingle(),
    // G3: bu aracin ilanlari + yasam dongusu (sql/104-105)
    supabase.from('ilanlar')
      .select('id, kanal_kodu, danisman_id, durum, ilan_no, ilan_url, ilan_fiyati, yayin_tarihi, yenileme_tarihi, son_yenileme')
      .eq('arac_id', id).order('sira', { ascending: false }),
    supabase.from('v_ilan_yasam')
      .select('ilan_id, ilan_yasi_gun, evre, evre_renk, evre_oneri, yenileme_gecti, yenilemeye_saat')
      .eq('arac_id', id),
    supabase.from('ilan_kanallari').select('kod, ad'),
    // Kapora tahsilati hangi kasaya girecek — Siparise Al kutusunda sorulur (sql/172)
    supabase.from('kasa_hesaplari').select('id, ad, tip').order('ad'),
    supabase.from('tanimlar').select('tip,kod,ad,sira').eq('aktif', true)
      // ⚠️ BU LİSTE, SAYFANIN KULLANDIĞI HER `TANIM['…']` TİPİNİ İÇERMEK
      //   ZORUNDA. Eksik tip sessizce BOŞ açılır liste demek: sorgu hata
      //   vermez, o tipi hiç getirmez.
      //   · MESLEK_GRUBU eksikti → meslek grubu listesi boştu.
      //   · SATIS_SEKLI eksikti → "Aracı siparişe al"da Satış Tipi ZORUNLU
      //     ama liste BOŞ; sipariş hiç açılamıyordu (Göksenil, 7 Ağu 2026).
      //   Yeni bir TANIM['X'] yazarken X'i BURAYA da ekle.
      //   · MASRAF_TIPI + ALIS_SEKLI: yaşam döngüsü denetim satırlarında
      //     kod yerine ad yazılsın diye (13 Ağu 2026) — "NOTER_MUSAVIRLIK"
      //     değil "Noter + Müşavirlik".
      .in('tip', ['YAKIT', 'VITES', 'KASA_TIPI', 'RENK', 'ARAC_TIPI', 'MESLEK_GRUBU', 'SATIS_SEKLI', 'MASRAF_TIPI', 'ALIS_SEKLI'])
      .order('sira'),
    // C/4 (Göksenil, 5 Ağu 2026): araç sanayiye gitse de ilan YAYINDA kalır.
    // Kartta "bu araç sanayidedir" bilgisi HERKESE görünür (hero şeridi);
    // HANGİ FİRMA + YAPILAN İŞ yalnız operasyona görünür. View
    // security_invoker=true → yetkisi olmayanda BOŞ döner ve bölüm hiç
    // çizilmez; ikinci bir istemci kapısı gerekmez (sql/159).
    supabase.from('v_arac_operasyon_isleri')
      .select('id, islem_turu, islem_adi, firma_adi, tedarikci_id, aciklama, is_durumu, maliyet_asamasi, created_at')
      .eq('arac_id', id).order('created_at', { ascending: false }),
    supabase.from('operasyon_tedarikciler').select('id, ad, kategori').eq('aktif', true).order('ad'),
    supabase.from('operasyon_islem_turleri').select('kod, ad, kategori').eq('aktif', true).eq('ic_hizmet', false).order('sira'),
    // Göksenil (5 Ağu 2026): "araca yapılan masrafların NE OLDUKLARINI herkes
    // görecek ama TUTARLARI yazmayacak." View'da tutar kolonu YOK (sql/160) —
    // olmayan kolon sızdırılamaz. Tutar hâlâ arac_masraflar RLS'inde.
    supabase.from('v_arac_masraf_kalem')
      .select('id, masraf_adi, yon, tarih, aciklama')
      .eq('arac_id', id).order('tarih', { ascending: false }),
    // Alış satırı — KONSİNYE tespiti + revizyon hedefi (sql/232 turunda eklendi).
    // ⚠️ `id` DE ALINIYOR: güncelleme `.eq('id', …)` ile yapılacak. Projedeki
    //    diğer üç yol `.eq('arac_id', …)` kullanıyor ve arac_id'de TEKİLLİK
    //    KISITI YOK — bir araçta iki alış satırı oluşursa ikisini birden ezer.
    // ⚠️ Yetkisi olmayanda RLS boş döndürür → alan hiç çizilmez, ikinci bir
    //    istemci kapısı gerekmez.
    supabase.from('arac_alislar').select('id, alis_fiyati, alis_sekli')
      .eq('arac_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    // Alış fiyatı geçmişi (sql/232). Kaynak audit_log; görünüm tanımlayıcı
    // hakkıyla çalışır, kapı görünümün WHERE'inde.
    supabase.from('v_arac_alis_gecmis')
      .select('sira, tarih, alis_fiyati, onceki_alis_fiyati, fark, yon, degistiren')
      .eq('arac_id', id).order('sira', { ascending: false }).limit(30),
  ])
  TANIM = {}; for (const t of (tanimR?.data || [])) (TANIM[t.tip] = TANIM[t.tip] || []).push(t)
  KASALAR = kasaR?.data || []
  sipRezAktif = sipR?.data || null

  if (aracR.error || !aracR.data) {
    kok.innerHTML = uyari('Araç okunamadı: ' + kacis(aracR.error?.message || 'bulunamadı') + ' — <a href="stok.html" class="text-primary font-bold">Stok Merkezi</a>')
    return
  }
  const a = { ...aracR.data, _fiyat: fiyatR.data?.satis_fiyati ?? null, _min: fiyatR.data?.min_satis_fiyati ?? null,
    _gecmis: gecmisR.data || [], _indirim: indR.data || null }
  if (fiyatR.error) console.error('[db] guncel fiyat', fiyatR.error)
  if (gecmisR.error) console.error('[db] fiyat gecmisi', gecmisR.error)
  if (indR.error) console.error('[db] indirim', indR.error)
  if (ilanR.error) console.error('[db] ilanlar', ilanR.error)
  if (yasamR.error) console.error('[db] ilan yasam', yasamR.error)
  {
    const yasamMap = {}; for (const r of (yasamR.data || [])) yasamMap[r.ilan_id] = r
    const kanalMap = {}; for (const r of (kanalR.data || [])) kanalMap[r.kod] = r.ad
    a._ilanlar = (ilanR.data || []).map(i => ({
      ...i, _yasam: yasamMap[i.id] || null, _kanal_ad: kanalMap[i.kanal_kodu] || i.kanal_kodu,
      _danisman: danismanAdi(dmap, i.danisman_id),
    }))
  }
  // C/4 operasyon verisi. opIsR boşsa (yetkisiz) bölüm çizilmez.
  if (opIsR.error) console.error('[db] operasyon isleri', opIsR.error)
  if (opTedR.error) console.error('[db] operasyon tedarikciler', opTedR.error)
  if (opTurR.error) console.error('[db] operasyon islem turleri', opTurR.error)
  a._opIsler = opIsR.data || []
  a._opTedarikciler = opTedR.data || []
  a._opTurler = opTurR.data || []
  if (masrafR.error) console.error('[db] masraf kalemleri', masrafR.error)
  a._masrafKalem = masrafR.data || []
  if (alisR.error) console.error('[db] arac alis', alisR.error)
  if (alisGecmisR.error) console.error('[db] alis gecmisi', alisGecmisR.error)
  a._alis = alisR.data || null
  a._alisGecmis = alisGecmisR.data || []

  sonArac = a

  // Masraf defteri verisi — çizimden ÖNCE gelmeli, kart onu okuyor.
  // Yetkisi olmayanda modül hiç sorgu atmaz.
  await masrafYukle({ aracId: id, ben: benim, dmap,
    baslik: [aracEtiket(a) || null, [markaAd(a.marka), a.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') })

  // İlan görseli durumu — düğmedeki rozet (HAZIR ✓ / ESKI).
  {
    const { data: gd, error: gdErr } = await supabase.from('ilan_gorselleri')
      .select('durum').eq('arac_id', id).maybeSingle()
    if (gdErr) console.error('[db] ilan gorsel durumu', gdErr)
    a._gorselDurum = gd?.durum || null
  }

  // Maliyet + K/Z (finans/yönetici RLS)
  let maliyet = maliyetR.data?.maliyet ?? null
  const alisFiyati = maliyetR.data?.alis_fiyati ?? null      // sql/199 — null: alış girilmemiş
  const masrafToplam = maliyetR.data?.masraf_toplam ?? null
  let kzYuzde = null
  if (maliyet != null && Number(maliyet) > 0 && a._fiyat != null) {
    const { data: kz, error: kzErr } = await supabase.rpc('f_kz_yuzde', { p_satis: a._fiyat, p_maliyet: maliyet })
    if (kzErr) console.error('[db] f_kz_yuzde', kzErr); else kzYuzde = kz
  }

  // Kasko bedeli (TSB listesi — kredi simülatörü girdisi)
  krediKasko = await kaskoBedeli(a)
  krediFiyat = a._fiyat
  krediOranlar = await krediOranlariYukle()
  {
    const { urunler, hata } = await krediUrunleriYukle(supabase)
    if (hata) console.error('[db] kurum urunleri', hata)
    KURUM_URUNLERI = urunler
  }

  // #1: bu aracın kredi durumu (Krediye Gönder → stok_ref=arac.id; ayrıca plaka eşleşmesi).
  //     Banka sonuçlarında onay varsa 'onayli', yalnız kuyruktaysa 'degerlendirmede'.
  const kbOr = aracEtiket(a) ? `stok_ref.eq.${a.id},plaka.eq.${a.plaka}` : `stok_ref.eq.${a.id}`
  const kbR = await supabase.from('kredi_basvurulari')
    .select('id, durum, kredi_banka_sonuclari(sonuc)').neq('durum', 'sonlandirildi').or(kbOr).limit(1)
  if (kbR.error) console.warn('[db] kredi durum kontrol', kbR.error)
  const kb = kbR.data && kbR.data[0]
  krediDurum = kb
    ? ((kb.kredi_banka_sonuclari || []).some(s => ['onay', 'kismi_onay', 'kullandirildi'].includes(s.sonuc)) ? 'onayli' : 'degerlendirmede')
    : null

  // Fotoğraflar (SITE yayın ilanı + arac_evraklar görselleri)
  fotolar = await fotolariTopla(a)

  // Eşleşen açık talepler
  const acik = (talepR.data || []).filter(t => {
    const son = (t.gorusme_notlari || []).slice().sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0]
    return !kapanisMi(son?.musteri_durumu)
  })
  const uygun = uygunTalepler({ marka: a.marka, model: a.model, yil: a.yil, fiyat: a._fiyat }, acik)

  const notlar = notR.error ? [] : (notR.data || [])
  if (notR.error) console.error('[db] arac notlari', notR.error)
  const olaylar = olayR.error ? [] : (olayR.data || [])
  if (olayR.error) console.warn('[db] olaylar', olayR.error)
  DENETIM = await denetimYukle()

  kok.innerHTML = `
    ${heroHtml(a)}
    ${siparisAksiyonHtml(a)}
    ${krediDurumHtml()}
    ${krediSigortaHtml(a)}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mt-lg">
      ${teknikHtml(a)}
      ${ekspertizHtml(a)}
      ${fiyatKutuHtml(a, maliyet, kzYuzde, alisFiyati, masrafToplam)}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter mt-lg">
      ${krediHtml(a)}
      ${galeriHtml()}
      ${timelineHtml(a, notlar, olaylar)}
    </div>
    ${evraklarKartHtml(a)}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter mt-lg">
      ${notKutuHtml(notlar)}
        ${musteriHtml(a, uygun)}
      </div>
      ${/* main dalindan: masraf kalemleri (tutarsiz) + operasyon isleri */''}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter mt-lg">
        ${masrafKalemHtml(a)}
        ${operasyonHtml(a)}
    </div>`

  document.getElementById('masrafBtn')?.addEventListener('click', () => masrafPencereAc(yukle))
  document.getElementById('kullanimaAlBtn')?.addEventListener('click', () => kullanimaAlAc(a))
  ekspertizSvgBoya(a)
  // Alış KDV — seçim ANINDA yazılır, ayrı "Kaydet" yok (muhasebe, sql/82).
  document.getElementById('akKdv')?.addEventListener('change', e => kdvYaz(e.target.value))
  document.getElementById('akTsbAc')?.addEventListener('click', () => tsbSeciciAc(a))
  galeriBaslat()
  evraklarDoldur(a)
  krediBaglaOlaylar()
  document.getElementById('notForm')?.addEventListener('submit', notEkle)
  notlariBagla()
  document.getElementById('fiyatRevizeBtn')?.addEventListener('click', () => fiyatRevizeAc(sonArac))
  document.getElementById('teknikDuzenleBtn')?.addEventListener('click', async () => {
    const { aracDetayAc } = await import('./arac-detay.js')
    // ⚠️ Seçenek adı `onKapat` (arac-detay.js:206). Yanlış ad sessizce yok
    //   sayılır ve düzenlemeden sonra kart tazelenmezdi.
    await aracDetayAc(id, benim, { onKapat: () => yukle() })
  })
  document.getElementById('opIsForm')?.addEventListener('submit', opIsEkle)
  document.getElementById('rezBaslatBtn')?.addEventListener('click', () => rezervasyonAc('rez'))
  document.getElementById('siparisAlBtn')?.addEventListener('click', () => rezervasyonAc('sip'))
  document.getElementById('satisDosyaBtn')?.addEventListener('click', e => { location.href = 'siparis-dosya.html?id=' + encodeURIComponent(e.currentTarget.dataset.sid) })
  document.getElementById('eksPdfAc')?.addEventListener('click', e => ekspertizPdfAc(e.currentTarget.dataset.yol))
  // Ekspertiz şeması revizyonu — ciz() tekrar çağrılır, tıklama bağları
  // ekspertizSvgBoya içinde yenilenir.
  document.getElementById('eksDuzenleBtn')?.addEventListener('click', () => { eksDuzenle = true; eksTaslak = null; yukle() })
  document.getElementById('eksVazgec')?.addEventListener('click', () => { eksDuzenle = false; eksTaslak = null; yukle() })
  document.getElementById('eksKaydet')?.addEventListener('click', ekspertizRevizeKaydet)
  document.getElementById('kartMinBtn')?.addEventListener('click', e => minFiyatBalon(sonArac, e.currentTarget))
  document.getElementById('camEtiketBtn')?.addEventListener('click', () =>
    window.open('cam-etiketi.html?id=' + encodeURIComponent(id), '_blank'))
  document.getElementById('krediGonderBtn')?.addEventListener('click', () => krediGonderAc(sonArac))
  // G3 — İlan işlemleri
  document.getElementById('yayinlaBtn')?.addEventListener('click', () => yayinlaAc(sonArac))
  document.getElementById('gorselBtn')?.addEventListener('click', () =>
    ilanGorselAc(sonArac.id, `${sonArac.plaka || ''} ${sonArac.marka || ''} ${sonArac.model || ''}`.trim(), () => yukle()))
}

// ---------- SİPARİŞ AKSİYONU (Stok Merkezi araç kartından) ----------
function siparisAksiyonHtml(a) {
  if (sipRezAktif && sipRezAktif.asama === 'SIPARIS') {
    return `<div class="mt-lg bg-[#EFF6FF] border border-[#3B82F6]/30 rounded-2xl px-lg py-3 flex items-center gap-3 flex-wrap custom-shadow">
      <span class="w-9 h-9 rounded-full bg-[#3B82F6] text-white flex items-center justify-center shrink-0">${mat('local_shipping', 'text-[20px]')}</span>
      <div class="flex-1 min-w-0"><div class="text-sm font-extrabold text-[#1D4ED8]">ARAÇ SİPARİŞ AŞAMASINDA</div>
        <div class="text-[11px] text-[#1D4ED8]/80">Finansal süreç (tahsilat/masraf/noter) Satış Dosyası'ndan yönetilir.</div></div>
      <button id="satisDosyaBtn" data-sid="${sipRezAktif.id}" class="px-4 h-10 rounded-lg bg-[#1D4ED8] text-white text-sm font-bold hover:opacity-90 flex items-center gap-1.5 shrink-0">${mat('folder_open', 'text-[16px]')} Satış Dosyasını Aç</button>
    </div>`
  }
  if (sipRezAktif && sipRezAktif.asama === 'REZERVASYON') {
    return `<div class="mt-lg bg-[#FFFBEB] border border-[#F59E0B]/30 rounded-2xl px-lg py-3 flex items-center gap-3 flex-wrap custom-shadow">
      <span class="w-9 h-9 rounded-full bg-[#F59E0B] text-white flex items-center justify-center shrink-0">${mat('lock_clock', 'text-[20px]')}</span>
      <div class="flex-1 min-w-0"><div class="text-sm font-extrabold text-[#B45309]">ARAÇ REZERVE EDİLDİ</div>
        <div class="text-[11px] text-[#B45309]/80">Kapora alınırsa sipariş olur; süre/uzatma ve cari süreç Satış Dosyası'ndan yönetilir.</div></div>
      <button id="satisDosyaBtn" data-sid="${sipRezAktif.id}" class="px-4 h-10 rounded-lg bg-[#B45309] text-white text-sm font-bold hover:opacity-90 flex items-center gap-1.5 shrink-0">${mat('folder_open', 'text-[16px]')} Dosyayı Aç</button>
    </div>`
  }
  if (a.durum !== 'STOKTA' && a.durum !== 'YAYINDA') return ''
  return `<div class="mt-lg bg-surface-container-lowest border border-[#10B981]/30 rounded-2xl px-lg py-3 flex items-center gap-3 flex-wrap custom-shadow">
    <span class="w-9 h-9 rounded-full bg-[#10B981] text-white flex items-center justify-center shrink-0">${mat('check_circle', 'text-[20px]')}</span>
    <div class="flex-1 min-w-0"><div class="text-sm font-extrabold text-[#047857]">ARAÇ STOKTA — SATIŞA HAZIR</div>
      <div class="text-[11px] text-[#047857]/80">Rezervasyon geçici kilittir; Siparişe Al doğrudan satış sürecini başlatır ve Satış Dosyası açılır.</div></div>
    <div class="flex items-center gap-2 shrink-0">
      <button id="rezBaslatBtn" class="px-4 h-10 rounded-lg border border-primary/40 text-primary text-sm font-bold hover:bg-primary/5 flex items-center gap-1.5">${mat('bookmark_add', 'text-[18px]')} Rezervasyon Başlat</button>
      <button id="siparisAlBtn" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1.5">${mat('shopping_cart_checkout', 'text-[18px]')} Siparişe Al</button>
    </div>
  </div>`
}

// Rezervasyon Başlat drawer (premium tasarım — Stitch "Aracı Rezerve Et").
//   Kapora girilmezse REZERVASYON (araç kilitlenir, süre sayacı) —
//   kapora girilirse SİPARİŞ olur, Satış Dosyası açılır (kapora→sipariş kuralı, arac-detay ile aynı).
function rezervasyonAc(mod) {
  const a = sonArac
  const sipMod = mod === 'sip'
  let secMusteri = null, mZaman, sure = '24h'
  // Planlanan teslim tarihi — VARSAYILAN SEÇİLİ ÇİP YOK, danışman bilinçli seçsin.
  // Yalnız SİPARİŞTE sorulur; rezervasyon geçici kilittir, teslim sözü içermez.
  let teslimCip = null
  const araclabel = [a.marka, a.model, a.yil].filter(Boolean).join(' ').toLocaleUpperCase('tr')
  const altSatir = [tanimAd('RENK', a.renk), tanimAd('KASA_TIPI', a.kasa_tipi), a.km ? Number(a.km).toLocaleString('tr-TR') + ' KM' : null].filter(Boolean).join(' • ').toLocaleUpperCase('tr')
  const sureBtn = (kod, etiket, ikon) => `<button type="button" data-sure="${kod}" class="rezSureBtn py-3 rounded-xl text-sm font-bold transition-all ${kod === sure ? 'bg-primary text-on-primary shadow-lg shadow-primary/20' : 'hover:bg-surface-container-highest text-on-surface-variant'} ${ikon ? 'flex items-center justify-center gap-1' : ''}">${ikon ? mat(ikon, 'text-[18px]') : ''}${etiket}</button>`
  // Teslim çipi düğmesi — TESLIM_CIPLERI'nden çizilir, hiçbiri başta seçili değil.
  const teslimBtn = c => `<button type="button" data-tcip="${kacis(c.kod)}" class="rezTeslimBtn py-2.5 px-1 rounded-xl text-[12px] font-bold transition-all hover:bg-surface-container-highest text-on-surface-variant">${kacis(c.etiket)}</button>`
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[95] flex'
  ov.innerHTML = `
    <div class="rez-bg absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
    <aside class="relative ml-auto h-full w-full sm:w-[560px] bg-surface-container-lowest shadow-2xl flex flex-col">
      <div class="px-gutter py-4 border-b border-outline-variant/40 flex items-start justify-between shrink-0">
        <div>
          <h3 class="text-headline-md font-black text-primary tracking-tight">${sipMod ? 'Siparişe Al' : 'Aracı Rezerve Et'}</h3>
          <div class="flex items-center gap-2 mt-1"><span class="w-2 h-2 rounded-full bg-[#10B981]"></span>
            <p class="text-[12px] font-bold text-on-surface-variant uppercase tracking-wider">${kacis(araclabel || 'Araç')}</p></div>
        </div>
        <button class="rez-kapat w-9 h-9 rounded-full hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant shrink-0">${mat('close', 'text-[26px]')}</button>
      </div>
      <div class="flex-1 overflow-y-auto p-gutter space-y-5">
        <!-- Araç önizleme mini-kart -->
        <div class="relative h-40 rounded-xl overflow-hidden bg-gradient-to-br from-[#4a1020] to-[#7a1e38] flex items-end">
          <div class="absolute inset-0 flex items-center justify-center">${mat('directions_car', 'text-[96px] text-white/10')}</div>
          <div class="relative p-4 text-white w-full">
            ${aracEtiket(a) ? `<p class="text-[11px] font-bold tracking-wide opacity-80">${kacis(aracEtiket(a))}</p>` : ''}
            <p class="text-title-sm font-bold">${kacis(altSatir) || '—'}</p>
          </div>
        </div>
        <div id="rezHata" class="hidden bg-error-container text-on-error-container border border-error/20 rounded-lg px-3 py-2 text-sm"></div>
        <!-- Müşteri -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Müşteri Bilgileri *</label>
            <button id="rezYeni" class="text-primary text-[13px] font-bold flex items-center gap-1 hover:underline">${mat('add_circle', 'text-[18px]')} Yeni Müşteri</button>
          </div>
          <div class="relative">
            <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-outline">${mat('search', 'text-[20px]')}</span>
            <input id="rezAra" placeholder="İsim veya telefon numarası ile ara…" autocomplete="off" class="w-full pl-11 pr-4 py-3.5 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none text-sm transition-all" />
            <div id="rezSonuc" class="absolute z-10 w-full mt-1 bg-white border border-outline-variant rounded-lg shadow-lg max-h-56 overflow-y-auto"></div>
          </div>
          <div id="rezSecili"></div>
          <!-- Yeni müşteri formu — PANELİN İÇİNDE (eskiden prompt() idi).
               Göksenil: "sağdaki panelde sorması çok daha doğru bir UX…
               prompt() kullanımını tamamen kaldır." prompt() ile telefon/il/not
               gibi alan eklemek mümkün değildi; TCKN, KVKK, kara liste gibi
               ileride gelecek alanlar da ancak burada yaşayabilir. -->
          <div id="rezYeniForm" class="hidden mt-2 border border-primary/25 rounded-xl p-3 bg-primary/[0.03] space-y-2">
            <div class="flex items-center justify-between">
              <span id="ry_baslik" class="text-[11px] font-bold text-primary uppercase tracking-wide flex items-center gap-1">${mat('person_add', 'text-[15px]')} Yeni Müşteri</span>
              <button id="rezYeniVazgec" type="button" class="text-on-surface-variant text-[12px] font-bold hover:underline">Vazgeç</button>
            </div>
            <!-- Şahıs / Tüzel — Göksenil: "şahıs mı tüzel mi sorusu radio buton
                 olarak görünsün" ve HERKES görsün (danışman da eksiksiz girsin). -->
            <div class="flex gap-2">
              ${['SAHIS', 'SIRKET'].map((k, i) => `<label class="flex-1 cursor-pointer">
                <input type="radio" name="ry_tip" value="${k}" class="peer sr-only" ${i === 0 ? 'checked' : ''}>
                <span class="block text-center px-2 py-2 rounded-lg border border-outline-variant text-[12px] font-bold text-on-surface-variant bg-white peer-checked:bg-primary peer-checked:text-on-primary peer-checked:border-primary transition-all">${k === 'SAHIS' ? 'Şahıs' : 'Şirket'}</span>
              </label>`).join('')}
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="col-span-2">
                <label class="text-[10px] font-bold text-on-surface-variant uppercase"><span id="ry_adEt">Ad Soyad</span> *</label>
                <input id="ry_ad" class="${REZ_INP}" style="text-transform:uppercase" autocomplete="off" />
              </div>
              <div>
                <label class="text-[10px] font-bold text-on-surface-variant uppercase">Telefon *</label>
                <input id="ry_tel" class="${REZ_INP}" inputmode="numeric" placeholder="5XX XXX XX XX" autocomplete="off" />
              </div>
              <!-- Kimlik: şahısta TC (11), tüzelde Vergi No (10). İkisi de
                   musteri_kimlik.tckn_vergi_no'ya yazılır — RLS kolon
                   gizleyemediği için o alan AYRI tabloda (CLAUDE.md §9). -->
              <div>
                <label class="text-[10px] font-bold text-on-surface-variant uppercase"><span id="ry_kimlikEt">T.C. Kimlik No</span></label>
                <input id="ry_kimlik" class="${REZ_INP}" inputmode="numeric" autocomplete="off" />
              </div>
              <div id="ry_vdSar" class="hidden">
                <label class="text-[10px] font-bold text-on-surface-variant uppercase">Vergi Dairesi</label>
                <input id="ry_vd" class="${REZ_INP}" autocomplete="off" />
              </div>
              <div id="ry_dogumSar">
                <label class="text-[10px] font-bold text-on-surface-variant uppercase">Doğum Tarihi</label>
                <input id="ry_dogum" type="date" class="${REZ_INP}" />
              </div>
              <div class="col-span-2">
                <label class="text-[10px] font-bold text-on-surface-variant uppercase">E-posta</label>
                <input id="ry_eposta" class="${REZ_INP}" inputmode="email" autocomplete="off" placeholder="ornek@gmail.com" />
                <div id="ry_epostaOner" class="flex flex-wrap gap-1 mt-1"></div>
              </div>
              <div class="col-span-2">
                <label class="text-[10px] font-bold text-on-surface-variant uppercase">Meslek Grubu</label>
                <select id="ry_meslek" class="${REZ_INP}"><option value="">Seçiniz…</option>${(TANIM['MESLEK_GRUBU'] || []).map(t => `<option value="${kacis(t.kod)}">${kacis(t.ad)}</option>`).join('')}</select>
              </div>
              <div>
                <label class="text-[10px] font-bold text-on-surface-variant uppercase">İl</label>
                <input id="ry_il" class="${REZ_INP}" autocomplete="off" />
              </div>
              <div>
                <label class="text-[10px] font-bold text-on-surface-variant uppercase">Not</label>
                <input id="ry_not" class="${REZ_INP}" autocomplete="off" />
              </div>
            </div>
            <div id="ry_hata" class="text-[12px] text-error"></div>
            <button id="ry_kaydet" type="button" class="w-full bg-primary text-on-primary h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('person_check', 'text-[18px]')} <span id="ry_kaydetMetin">Kaydet ve Seç</span></button>
          </div>
        </div>
        <!-- Fiyat + Kapora -->
        <div class="grid grid-cols-2 gap-stack-md">
          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Anlaşılan Satış Fiyatı (₺) *</label>
            <div class="relative"><input id="rezFiyat" inputmode="numeric" placeholder="0" class="para-gir w-full p-3.5 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary outline-none text-sm font-bold" />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-outline font-bold">₺</span></div>
          </div>
          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Alınan Kapora (₺)</label>
            <div class="relative"><input id="rezKapora" inputmode="numeric" placeholder="0" class="para-gir w-full p-3.5 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary outline-none text-sm font-bold" />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-outline font-bold">₺</span></div>
          </div>
        </div>
        <!-- MİN FİYAT ALTI — sql/225. Danışman rakamı YAZARKEN öğrensin;
             eskiden kaydete basıp "yalnız SATIŞ MÜDÜRÜ onayıyla" duvarına
             tosluyor ve onay isteyebileceği hiçbir yol bulamıyordu. -->
        <div id="rezMinUyari" class="hidden rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2.5 space-y-2">
          <div class="flex items-start gap-1.5 text-[11px] font-bold text-amber-800">
            ${mat('gpp_maybe', 'text-[16px] mt-px shrink-0')}
            <span id="rezMinMetin"></span>
          </div>
          <textarea id="rezMinGerekce" rows="2" placeholder="Gerekçe — müdür neye göre karar verecek? (ör. müşteri başka galeriden daha ucuz teklif aldı, araç 90 gündür stokta)"
            class="w-full p-2.5 bg-surface rounded-lg border border-amber-400/40 focus:border-amber-500 outline-none text-[12px]"></textarea>
          <p class="text-[10px] text-amber-700 leading-snug">
            Kaydedince sipariş <b>açılır</b> ve satış müdürüne onay bildirimi gider.
            Onay gelene kadar araç <b>teslimata gönderilemez</b>.</p>
        </div>
        <div id="rezKaporaNot" class="hidden text-[11px] font-bold text-[#047857] bg-[#ECFDF5] border border-[#10B981]/25 rounded-lg px-3 py-2 flex items-center gap-1.5">${mat('info', 'text-[15px]')} Kapora girildi — kayıt <b>SİPARİŞ</b> olur ve Satış Dosyası açılır. Süre gerekmez.</div>
        ${/* ⚠️ KAPORA ARTIK CARİ DEFTERE TAHSİLAT OLARAK DÜŞÜYOR (sql/172).
              Faz 1 zincir testinde yakalandı: kapora yalnız `siparisler`
              alanında duruyordu, defterde YOKTU; ekran "Ödenen 0" diyordu.
              Teslimat kapısı "bakiye TAM 0" şartına baktığı için bakiye hiç
              kapanmıyordu.
              Ödeme tipi ve kasa SORULUYOR: tutarı bilip parayı nereye
              aldığını bilmemek, finansa mutabakatı olmayan satır bırakmak
              demek. Bir kusuru kapatırken yenisini açmamak için zorunlu. */''}
        <div id="rezKaporaOdeme" class="hidden grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Kapora Nasıl Alındı *</label>
            <select id="rezKaporaTip" class="${REZ_INP}">
              <option value="NAKIT">Nakit</option>
              <option value="HAVALE_EFT">Havale / EFT</option>
              <option value="KREDI_KARTI">Kredi Kartı</option>
            </select>
          </div>
          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Hangi Kasaya *</label>
            <select id="rezKaporaKasa" class="${REZ_INP}"><option value="">Seçiniz…</option></select>
          </div>
        </div>
        ${/* Satış tipi — SİPARİŞTE sorulur (Göksenil, 5 Ağu 2026:
              "aracı siparişe alırken soracak"). Bu alan bugüne kadar HİÇBİR
              ekranda sorulmuyordu: sipariş açılırken koda null yazılıyor,
              sonra kimse doldurmuyordu → Satış Merkezi "Satış Tipi —"
              gösteriyordu. Rezervasyonda sorulmaz; rezervasyon henüz satış
              değil, kapora girilince (mod SİPARİŞ olunca) belirir. */''}
        <div id="rezSatisTipiSar" class="hidden space-y-1.5">
          <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Satış Tipi *</label>
          <div class="relative">
            <select id="rezSatisTipi" class="w-full p-3.5 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary outline-none appearance-none text-sm">
              <option value="">Seçiniz…</option>
              ${(TANIM['SATIS_SEKLI'] || []).map(t => `<option value="${kacis(t.kod)}">${kacis(t.ad)}</option>`).join('')}
            </select>
            <span class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">${mat('expand_more')}</span>
          </div>
        </div>
        ${/* PLANLANAN TESLİM TARİHİ (sql/244-245). Siparişte ZORUNLU, rezervasyonda
              hiç sorulmaz. Tarih INSERT'te doğrudan yazılır; sonradan değişiklik
              yalnız teslim_plani_degistir() RPC'siyle olur (BR-0142) — bu pencere
              yalnızca ilk sözü kaydeder.
              "Henüz netleşmedi" tarihi boş bırakmaz: +7 gün TAHMİN yazar, böylece
              kayıt plansız kalmaz ama kırmızı mekanizması işlemez. */''}
        <div id="rezTeslimSar" class="hidden space-y-1.5">
          <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Planlanan Teslim Tarihi *</label>
          <div class="grid grid-cols-3 gap-2 p-1 bg-surface-container rounded-2xl">
            ${TESLIM_CIPLERI.map(teslimBtn).join('')}
          </div>
          <input id="rezTeslimTarih" type="date" min="${bugunISO()}" class="hidden mt-2 w-full p-3 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary outline-none text-sm" />
          <p id="rezTeslimOzet" class="hidden text-[11px] font-bold text-[#047857] bg-[#ECFDF5] border border-[#10B981]/25 rounded-lg px-3 py-2"></p>
        </div>
        <!-- Rezervasyon nedeni -->
        <div id="rezNedenSar" class="space-y-1.5">
          <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Rezervasyon Nedeni</label>
          <div class="relative">
            <select id="rezNeden" class="w-full p-3.5 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary outline-none appearance-none text-sm">
              <option value="">Seçiniz…</option>
              ${REZERVASYON_NEDENLERI.filter(([k]) => k !== 'KAPORA_ALINDI').map(([k, l]) => `<option value="${k}">${kacis(l)}</option>`).join('')}
            </select>
            <span class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-outline">${mat('expand_more')}</span>
          </div>
        </div>
        <!-- Geçerlilik süresi -->
        <div id="rezSureSar" class="space-y-1.5">
          <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Geçerlilik Süresi</label>
          <div class="grid grid-cols-4 gap-2 p-1 bg-surface-container rounded-2xl">
            ${sureBtn('12h', '12s')}${sureBtn('24h', '24s')}${sureBtn('48h', '48s')}${sureBtn('ozel', 'Özel', 'calendar_today')}
          </div>
          <input id="rezTarih" type="datetime-local" class="hidden mt-2 w-full p-3 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary outline-none text-sm" />
        </div>
        <!-- Görüşme notu -->
        <div class="space-y-1.5">
          <label class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide">Görüşme Notu</label>
          <textarea id="rezNot" rows="3" placeholder="Müşteri ile yapılan görüşme detaylarını buraya ekleyin…" class="w-full p-3.5 bg-surface rounded-xl border border-outline-variant/60 focus:border-primary outline-none text-sm resize-none"></textarea>
        </div>
      </div>
      <div class="p-gutter bg-surface-container-low border-t border-outline-variant/30 shrink-0">
        <button id="rezKaydet" class="w-full bg-primary hover:opacity-90 text-on-primary py-4 rounded-2xl text-title-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl shadow-primary/10">${mat('verified')} <span id="rezKaydetMetin">Kaydet ve Rezerve Et</span></button>
        <p class="mt-3 text-center text-[10px] font-bold text-on-surface-variant/60 tracking-[0.2em] uppercase">İşlem kaydı oluşturulacaktır</p>
      </div>
    </aside>`
  document.body.appendChild(ov)
  const q = s => ov.querySelector(s)
  const kapat = () => ov.remove()
  ov.querySelector('.rez-bg').addEventListener('click', kapat)
  ov.querySelector('.rez-kapat').addEventListener('click', kapat)

  // Sipariş modu: süre + neden gizli, kapora opsiyonel, buton sipariş metni
  if (sipMod) {
    q('#rezSureSar').classList.add('hidden')
    q('#rezNedenSar').classList.add('hidden')
    q('#rezSatisTipiSar').classList.remove('hidden')   // sipariş = satış tipi sorulur
    q('#rezTeslimSar').classList.remove('hidden')      // sipariş = teslim tarihi sorulur
    q('#rezKaydetMetin').textContent = 'Sipariş Oluştur ve Dosyayı Aç'
  }

  // Seçili çipten planlanan tarih + plan tipi. Seçim yoksa null döner
  // (kaydet doğrulaması bunu yakalar). Tarih hesabı gunEkleISO ile — burada
  // ikinci bir tarih matematiği YAZMA.
  const teslimSecimi = () => {
    if (!teslimCip) return null
    const c = TESLIM_CIPLERI.find(x => x.kod === teslimCip)
    if (!c) return null
    if (c.kod === 'ozel') {
      const t = (q('#rezTeslimTarih')?.value || '').trim()
      // ⚠️ min="" HTML kısıtı klavyeden/yapıştırmadan aşılabilir. Sunucu INSERT'te
      //   geçmiş tarihi REDDETMİYOR (yasak yalnız teslim_plani_degistir'de), yani
      //   burada durdurmazsak doğar doğmaz "gecikmiş" sipariş açılır.
      return (t && t >= bugunISO()) ? { tarih: t, tip: c.tip } : null
    }
    return { tarih: gunEkleISO(c.gun), tip: c.tip }
  }
  const teslimOzetYaz = () => {
    const p = q('#rezTeslimOzet'); if (!p) return
    const s = teslimSecimi()
    p.classList.toggle('hidden', !s)
    if (!s) { p.textContent = ''; return }
    p.textContent = s.tip === 'TAHMIN'
      ? 'Tahmini teslim: ' + fmtTarihKisa(s.tarih) + ' — tarih netleşmedi, gecikme sayacı işlemez.'
      : 'Müşteriye verilen teslim sözü: ' + fmtTarihKisa(s.tarih)
  }
  ov.querySelectorAll('.rezTeslimBtn').forEach(b => b.addEventListener('click', () => {
    teslimCip = b.dataset.tcip
    ov.querySelectorAll('.rezTeslimBtn').forEach(x => {
      const aktif = x.dataset.tcip === teslimCip
      x.classList.toggle('bg-primary', aktif); x.classList.toggle('text-on-primary', aktif)
      x.classList.toggle('shadow-lg', aktif); x.classList.toggle('shadow-primary/20', aktif)
      x.classList.toggle('hover:bg-surface-container-highest', !aktif); x.classList.toggle('text-on-surface-variant', !aktif)
    })
    q('#rezTeslimTarih').classList.toggle('hidden', teslimCip !== 'ozel')
    teslimOzetYaz()
  }))
  q('#rezTeslimTarih').addEventListener('change', teslimOzetYaz)

  // Süre segment kontrolü
  ov.querySelectorAll('.rezSureBtn').forEach(b => b.addEventListener('click', () => {
    sure = b.dataset.sure
    ov.querySelectorAll('.rezSureBtn').forEach(x => {
      const aktif = x.dataset.sure === sure
      x.classList.toggle('bg-primary', aktif); x.classList.toggle('text-on-primary', aktif)
      x.classList.toggle('shadow-lg', aktif); x.classList.toggle('shadow-primary/20', aktif)
      x.classList.toggle('hover:bg-surface-container-highest', !aktif); x.classList.toggle('text-on-surface-variant', !aktif)
    })
    q('#rezTarih').classList.toggle('hidden', sure !== 'ozel')
  }))

  // Kapora girilince mod SİPARİŞ olur → süre/neden gizlenir, buton metni değişir
  //
  // ⚠️ `if (sipMod) return` EN BAŞTAYDI ve ödeme bilgisini de atlıyordu:
  //   sipariş modunda kapora yazan danışmana kasa/ödeme tipi alanları HİÇ
  //   açılmıyor, kasa listesi doldurulmuyordu. Kaydederken doğrulama "Kapora
  //   hangi kasaya girdi? Seçmeden kaydedilemez" diyordu ama seçilecek yer
  //   yoktu — sipariş hiç oluşturulamıyordu (Göksenil, 10 Ağu 2026).
  //   Ödeme bilgisi HER MODDA gösterilir; erken çıkış yalnız moda özgü
  //   (süre/neden/buton metni) kısımdan önce.
  q('#rezKapora').addEventListener('input', () => {
    // ⚠️ Sayısal karşılaştırma: '0' yazılınca eskiden true dönüyordu ve teslim
    //   alanı beliriyordu ama insert koşulu (kapora > 0) false olduğu için seçim
    //   sessizce atılıyordu. İki koşul artık birebir aynı.
    const kaporaVar = Number((q('#rezKapora').value || '').replace(/\D/g, '') || 0) > 0
    // Kapora varsa ODEME BILGISI zorunlu — cariye tahsilat olarak duser (sql/172)
    const ko = q('#rezKaporaOdeme')
    ko.classList.toggle('hidden', !kaporaVar); ko.classList.toggle('grid', kaporaVar)
    const ks = q('#rezKaporaKasa')
    if (kaporaVar && ks.options.length <= 1) {
      ks.innerHTML = '<option value="">Seçiniz…</option>' +
        KASALAR.map(k => `<option value="${kacis(k.id)}">${kacis(k.ad)}</option>`).join('')
    }
    // ⚠️ Teslim tarihi çipi ERKEN DÖNÜŞTEN ÖNCE ayarlanır. Görünürlük koşulu
    //   kaydetteki siparisMi ile BİREBİR aynı (sipMod || kapora > 0); aşağıya
    //   koysaydık kaporalı rezervasyonda alan hiç çıkmaz, kaydet ise
    //   "Planlanan teslim tarihi seçin." diye duvara toslardı.
    q('#rezTeslimSar').classList.toggle('hidden', !(sipMod || kaporaVar))
    if (sipMod) return   // sipariş modunda süre/neden zaten gizli, mod değişmez
    q('#rezKaporaNot').classList.toggle('hidden', !kaporaVar)
    q('#rezSureSar').classList.toggle('hidden', kaporaVar)
    q('#rezNedenSar').classList.toggle('hidden', kaporaVar)
    // Kapora girilince kayıt SİPARİŞ olur → satış tipi de sorulmaya başlar.
    q('#rezSatisTipiSar').classList.toggle('hidden', !kaporaVar)
    q('#rezKaydetMetin').textContent = kaporaVar ? 'Sipariş Oluştur ve Dosyayı Aç' : 'Kaydet ve Rezerve Et'
  })

  // Min satış fiyatı altı canlı uyarısı (sql/225).
  // ⚠️ a._min yalnız yetkili rollerde dolu gelir (v_arac_min_fiyat).
  //    Boşsa kutu HİÇ çizilmez — rakamı görmeyene rakam sızdırmayız.
  const minAlti = () => {
    if (a._min == null) return false
    const t = Number((q('#rezFiyat').value || '').replace(/\D/g, ''))
    return t > 0 && t < Number(a._min)
  }
  const minKontrol = () => {
    const kutu = q('#rezMinUyari'); if (!kutu) return
    const alti = minAlti()
    kutu.classList.toggle('hidden', !alti)
    if (alti) {
      const t = Number((q('#rezFiyat').value || '').replace(/\D/g, ''))
      q('#rezMinMetin').innerHTML =
        `Minimum satış fiyatı <b>${fmtPara(a._min)}</b> — <b>${fmtPara(Number(a._min) - t)}</b> altındasınız.
         Bu satış <b>satış müdürü onayı</b> ister.`
    }
  }
  q('#rezFiyat').addEventListener('input', minKontrol)

  const seciliCiz = () => {
    // "Güncelle" — Göksenil: "eğer müşterinin eski kaydı varsa güncelleyecek."
    // Eksik TCKN/e-posta/meslek gibi alanlar sipariş anında tamamlanabilsin.
    q('#rezSecili').innerHTML = secMusteri ? `<div class="mt-2 flex items-center gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/10"><span class="w-7 h-7 rounded-full bg-primary-fixed text-primary text-[10px] flex items-center justify-center font-bold">${basHarf(secMusteri.ad_soyad)}</span><span class="text-sm flex-1 truncate"><b>${kacis(buyuk(secMusteri.ad_soyad))}</b> · ${kacis(telNo(secMusteri.telefon))}</span><button id="rezDuzenle" class="text-primary text-xs font-bold hover:underline">güncelle</button><button id="rezKaldir" class="text-error text-xs font-bold">kaldır</button></div>` : ''
    q('#rezKaldir')?.addEventListener('click', () => { secMusteri = null; q('#rezAra').disabled = false; seciliCiz() })
    q('#rezDuzenle')?.addEventListener('click', () => duzenleFormAc(secMusteri.id))
  }
  q('#rezAra').addEventListener('input', e => {
    clearTimeout(mZaman); const v = e.target.value.trim(); const kutu = q('#rezSonuc')
    if (v.length < 2) { kutu.innerHTML = ''; return }
    mZaman = setTimeout(async () => {
      // BİRLEŞİK ARAMA: CRM + yalnız sigortada olanlar (musteri-sec.js).
      // Sigorta kaydı seçilirse arka planda CRM'e aktarılır — 11 tablo
      // musteriler.id'ye FK ile bağlı, ham sigorta id'si FK hatası verirdi.
      const { musteriAra } = await import('./musteri-sec.js')
      const data = await musteriAra(v, 6)
      // Sonuçların ALTINA daima "yeni oluştur" satırı — kullanıcı listede
      // bulamayınca başka bir düğme aramasın (HubSpot/Salesforce deseni).
      const bulunan = (data || []).map(m => `<button data-mid="${m.id}" class="rez-msec w-full text-left px-3 py-2 hover:bg-primary/5 text-sm border-b border-outline-variant/50 flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate"><b>${kacis(buyuk(m.ad_soyad))}</b>${m.telefon && m.telefon !== '-' ? ' · ' + kacis(telNo(m.telefon)) : ''}</span>
          ${m.kaynak_modul === 'SIGORTA' ? '<span class="shrink-0 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">SİGORTA</span>' : ''}
        </button>`).join('')
      const yok = (data || []).length ? '' : `<div class="text-[11px] text-on-surface-variant px-3 pt-2">Müşteri bulunamadı</div>`
      kutu.innerHTML = bulunan + yok +
        `<button id="rezYeniSatir" class="w-full text-left px-3 py-2.5 hover:bg-primary/10 text-sm text-primary font-bold flex items-center gap-1.5">
          ${mat('add_circle', 'text-[17px]')} <span class="truncate">"${kacis(v)}" ile yeni müşteri oluştur</span></button>`
      kutu.querySelectorAll('.rez-msec').forEach(b => b.addEventListener('click', async () => {
        const secim = (data || []).find(x => x.id === b.dataset.mid); if (!secim) return
        kutu.innerHTML = `<div class="px-3 py-2 text-[12px] text-on-surface-variant">Müşteri hazırlanıyor…</div>`
        const { musteriCoz } = await import('./musteri-sec.js')
        const m = await musteriCoz(secim, benim)
        if (!m) { kutu.innerHTML = `<div class="px-3 py-2 text-[12px] text-error">Müşteri hazırlanamadı.</div>`; return }
        secMusteri = m
        kutu.innerHTML = ''; q('#rezAra').value = ''; q('#rezAra').disabled = true
        seciliCiz()
        if (m.aktarildi) {
          const h = q('#rezHata'); h.textContent = 'Sigorta müşterisi CRM kütüğüne aktarıldı — telefon/TCKN alanlarını "güncelle" ile tamamla.'; h.classList.remove('hidden')
        }
      }))
      kutu.querySelector('#rezYeniSatir')?.addEventListener('click', () => yeniFormAc(v))
    }, 250)
  })
  // ---- Yeni müşteri: PANEL İÇİ FORM (prompt() kaldırıldı) ----
  // Göksenil: "prompt() kullanımını tamamen kaldır… kullanıcı uygulamadan hiç
  // çıkmadan müşteri arama, yeni müşteri oluşturma ve sipariş oluşturma
  // işlemlerini aynı panel içinde tamamlasın."
  let duzenlenenId = null   // dolu ise INSERT değil UPDATE (mevcut kaydı tamamla)

  const tipSecili = () => (q('input[name="ry_tip"]:checked') || {}).value || 'SAHIS'
  const tipUygula = () => {
    const tuzel = tipSecili() === 'SIRKET'
    q('#ry_adEt').textContent = tuzel ? 'Şirket Adı' : 'Ad Soyad'
    q('#ry_kimlikEt').textContent = tuzel ? 'Vergi No' : 'T.C. Kimlik No'
    q('#ry_vdSar').classList.toggle('hidden', !tuzel)      // vergi dairesi yalnız tüzelde
    q('#ry_dogumSar').classList.toggle('hidden', tuzel)    // doğum tarihi yalnız şahısta
  }
  q('#rezYeniForm').querySelectorAll('input[name="ry_tip"]').forEach(r =>
    r.addEventListener('change', tipUygula))

  // --- E-posta alan adı önerisi ---
  // Göksenil: "@ ten sonrasını seçimli yapalım ya da otomatik tahmin et."
  // ⚠️ <datalist> İŞE YARAMAZ: değerin TAMAMIYLA eşleşir, "ali@gm" yazınca
  //   "gmail.com" seçeneğini süzemez. Bu yüzden @'ten sonrasını kendimiz
  //   süzüp tıklanabilir çip olarak veriyoruz.
  const EPOSTA_ALAN = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com',
    'yandex.com', 'msn.com', 'windowslive.com', 'hotmail.com.tr', 'yahoo.com.tr',
    'superonline.com', 'mynet.com', 'ttmail.com']
  const epostaOner = () => {
    const el = q('#ry_eposta'), kutu = q('#ry_epostaOner')
    const v = el.value.trim(), i = v.indexOf('@')
    if (i < 0) { kutu.innerHTML = ''; return }
    const yerel = v.slice(0, i), son = v.slice(i + 1).toLowerCase()
    const uyan = EPOSTA_ALAN.filter(d => d.startsWith(son) && d !== son).slice(0, 4)
    kutu.innerHTML = uyan.map(d => `<button type="button" data-alan="${d}" class="ry-eposta-cip px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold hover:bg-primary/20">${yerel}@${d}</button>`).join('')
    kutu.querySelectorAll('.ry-eposta-cip').forEach(b => b.addEventListener('click', () => {
      el.value = `${yerel}@${b.dataset.alan}`; kutu.innerHTML = ''; el.focus()
    }))
  }
  q('#ry_eposta').addEventListener('input', epostaOner)

  const formTemizle = () => {
    ;['ry_ad', 'ry_tel', 'ry_kimlik', 'ry_vd', 'ry_dogum', 'ry_eposta', 'ry_il', 'ry_not']
      .forEach(i => { const el = q('#' + i); if (el) el.value = '' })
    q('#ry_meslek').value = ''
    q('#ry_epostaOner').innerHTML = ''
    q('#ry_hata').textContent = ''
    const ilk = q('input[name="ry_tip"][value="SAHIS"]'); if (ilk) ilk.checked = true
    tipUygula()
  }

  const yeniFormAc = (onAd) => {
    duzenlenenId = null
    q('#rezSonuc').innerHTML = ''
    formTemizle()
    q('#ry_baslik').innerHTML = `${mat('person_add', 'text-[15px]')} Yeni Müşteri`
    q('#ry_kaydetMetin').textContent = 'Kaydet ve Seç'
    q('#rezYeniForm').classList.remove('hidden')
    // Aramaya yazılan METİN forma taşınır — kullanıcı ikinci kez yazmasın.
    // Rakam yazılmışsa isim değil TELEFON aranmıştır, o alana konur.
    const rakam = (onAd || '').replace(/\D/g, '')
    if (rakam.length >= 7) q('#ry_tel').value = rakam
    else if (onAd) q('#ry_ad').value = onAd
    q('#ry_ad').focus()
  }

  // Göksenil: "eğer müşterinin eski kaydı varsa güncelleyecek."
  // Seçili müşterinin TAM kaydı (+ kimlik) çekilip forma basılır; kaydet UPDATE eder.
  const duzenleFormAc = async (mid) => {
    const [{ data: m, error: me }, { data: k }] = await Promise.all([
      supabase.from('musteriler').select('id, tip, ad_soyad, telefon, e_posta, meslek_grubu, adres, notlar, dogum_tarihi, vergi_dairesi').eq('id', mid).maybeSingle(),
      supabase.from('musteri_kimlik').select('tckn_vergi_no').eq('musteri_id', mid).maybeSingle(),
    ])
    if (me) { dbHata('müşteri oku', me); return }
    if (!m) return
    formTemizle()
    duzenlenenId = mid
    const r = q(`input[name="ry_tip"][value="${m.tip === 'SIRKET' ? 'SIRKET' : 'SAHIS'}"]`); if (r) r.checked = true
    tipUygula()
    q('#ry_ad').value = m.ad_soyad || ''
    q('#ry_tel').value = m.telefon || ''
    q('#ry_kimlik').value = k?.tckn_vergi_no || ''
    q('#ry_vd').value = m.vergi_dairesi || ''
    q('#ry_dogum').value = m.dogum_tarihi || ''
    q('#ry_eposta').value = m.e_posta || ''
    q('#ry_meslek').value = m.meslek_grubu || ''
    q('#ry_il').value = m.adres || ''
    q('#ry_not').value = m.notlar || ''
    q('#ry_baslik').innerHTML = `${mat('edit', 'text-[15px]')} Müşteri Bilgilerini Güncelle`
    q('#ry_kaydetMetin').textContent = 'Güncelle'
    q('#rezYeniForm').classList.remove('hidden')
  }

  const yeniFormKapat = () => { q('#rezYeniForm').classList.add('hidden'); duzenlenenId = null; formTemizle() }

  const yeniMusteriKaydet = async () => {
    const hata = q('#ry_hata'); hata.textContent = ''
    const tuzel = tipSecili() === 'SIRKET'
    const ad = q('#ry_ad').value.trim()
    const telHam = q('#ry_tel').value.replace(/\D/g, '')
    const kimlik = q('#ry_kimlik').value.replace(/\D/g, '')
    const eposta = q('#ry_eposta').value.trim()
    if (!ad) { hata.textContent = (tuzel ? 'Şirket adı' : 'Ad soyad') + ' zorunlu.'; q('#ry_ad').focus(); return }
    // 10 hane (5XX…) ya da başında 0 ile 11 hane kabul; ikisi de telSifirla ile normalleşir
    if (telHam.length !== 10 && !(telHam.length === 11 && telHam.startsWith('0'))) {
      hata.textContent = 'Telefon 10 haneli olmalı (ör. 5395441254).'; q('#ry_tel').focus(); return
    }
    // Kimlik OPSİYONEL ama girildiyse hane sayısı doğru olmalı — yarım TCKN
    // sonradan "mükerrer müşteri" avında işe yaramaz, hiç olmaması yeğdir.
    if (kimlik && ((tuzel && kimlik.length !== 10) || (!tuzel && kimlik.length !== 11))) {
      hata.textContent = tuzel ? 'Vergi no 10 haneli olmalı.' : 'T.C. kimlik no 11 haneli olmalı.'
      q('#ry_kimlik').focus(); return
    }
    if (eposta && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(eposta)) {
      hata.textContent = 'E-posta biçimi hatalı.'; q('#ry_eposta').focus(); return
    }

    const kayit = {
      tip: tuzel ? 'SIRKET' : 'SAHIS',
      ad_soyad: buyuk(ad),
      telefon: telSifirla(telHam),
      e_posta: eposta || null,
      meslek_grubu: q('#ry_meslek').value || null,
      adres: q('#ry_il').value.trim() || null,
      notlar: q('#ry_not').value.trim() || null,
      dogum_tarihi: (!tuzel && q('#ry_dogum').value) ? q('#ry_dogum').value : null,
      vergi_dairesi: (tuzel && q('#ry_vd').value.trim()) ? q('#ry_vd').value.trim() : null,
    }
    const btn = q('#ry_kaydet'); btn.disabled = true
    let m, error
    if (duzenlenenId) {
      ({ data: m, error } = await supabase.from('musteriler').update(kayit).eq('id', duzenlenenId).select('id, ad_soyad, telefon'))
    } else {
      ({ data: m, error } = await supabase.from('musteriler').insert({ ...kayit, olusturan: benim?.id || null }).select('id, ad_soyad, telefon'))
    }
    btn.disabled = false
    if (error) { dbHata('rez müşteri kaydet', error); hata.textContent = 'Kaydedilemedi: ' + error.message; return }
    if (!m || !m.length) { hata.textContent = 'Kaydedilemedi (yetki yok).'; return }   // §5.1

    // Kimlik AYRI tabloda (musteri_kimlik) — RLS kolon gizleyemediği için.
    if (kimlik) {
      const { error: ke } = await supabase.from('musteri_kimlik')
        .upsert({ musteri_id: m[0].id, tckn_vergi_no: kimlik }, { onConflict: 'musteri_id' }).select('musteri_id')
      if (ke) { dbHata('musteri_kimlik', ke); hata.textContent = 'Müşteri kaydedildi ama kimlik yazılamadı: ' + ke.message }
    }
    secMusteri = m[0]
    yeniFormKapat()
    q('#rezAra').value = ''; q('#rezAra').disabled = true
    seciliCiz()
  }
  q('#rezYeni').addEventListener('click', () => yeniFormAc(q('#rezAra').value.trim()))
  q('#rezYeniVazgec').addEventListener('click', yeniFormKapat)
  q('#ry_kaydet').addEventListener('click', yeniMusteriKaydet)
  ;['ry_ad', 'ry_tel', 'ry_il', 'ry_not'].forEach(i =>
    q('#' + i).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); yeniMusteriKaydet() } }))
  const yeniMusteri = yeniFormAc   // arama kutusundaki Enter da formu açar
  // Müşteri bulunamadıysa Enter → yazılan isimle yeni müşteri kartı aç (alış akışıyla aynı)
  q('#rezAra').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (secMusteri) return
    const secenek = q('#rezSonuc').querySelector('.rez-msec')
    if (secenek) { secenek.click(); return }   // tek/ilk eşleşme varsa onu seç
    if (q('#rezAra').value.trim()) yeniMusteri(q('#rezAra').value.trim())
  })

  q('#rezKaydet').addEventListener('click', async () => {
    const hata = m => { const h = q('#rezHata'); h.textContent = m; h.classList.remove('hidden') }
    q('#rezHata').classList.add('hidden')
    if (!secMusteri) return hata('Müşteri seçin veya ekleyin.')
    const fiyatRaw = (q('#rezFiyat').value || '').replace(/\D/g, '')
    const kaporaRaw = (q('#rezKapora').value || '').replace(/\D/g, '')
    const kapora = kaporaRaw ? Number(kaporaRaw) : null
    const siparisMi = sipMod || kapora > 0
    // Göksenil: "Anlaşılan Satış Fiyatı … zorunlu." Artık REZERVASYONDA da
    // zorunlu — eskiden yalnız siparişte isteniyordu. Fiyatsız rezervasyon,
    // müşteriyle hangi rakamda anlaşıldığını kayıtsız bırakıyordu.
    if (!fiyatRaw) return hata(siparisMi
      ? 'Sipariş için anlaşılan satış fiyatı zorunlu (sipariş borcu bundan oluşur).'
      : 'Anlaşılan satış fiyatı zorunlu.')
    // ⚠️ Satış tipi YALNIZ siparişte zorunlu. İsteğe bağlı bıraksaydık alan
    //    yine boş kalırdı — bugüne kadarki durum tam olarak buydu.
    const satisTipi = siparisMi ? (q('#rezSatisTipi')?.value || '') : ''
    if (siparisMi && !satisTipi) return hata('Satış tipi zorunlu (Takas, Senetli, Vadeli, Otosor…).')
    // Planlanan teslim tarihi — sunucu ŞU AN zorunlu tutmuyor, zorunluluk ayrı
    // migration ile gelecek. O yüzden kapı BURADA: plansız sipariş, teslim
    // panosunda "Plan yok" kırmızısı olarak birikirdi.
    // İhale satışında sunucu plan_muaf=true damgalıyor (sql/245) — takip dışı.
    // Tarih sormak anlamsız plan kaydı üretirdi.
    const teslimGerekli = siparisMi && satisTipi !== 'IHALE'
    const teslim = teslimGerekli ? teslimSecimi() : null
    if (teslimGerekli && !teslim) return hata(teslimCip === 'ozel'
      ? 'Planlanan teslim tarihi seçin — takvimden bir gün işaretleyin.'
      : 'Planlanan teslim tarihi seçin.')
    // Kapora cariye tahsilat olarak duser; hangi kasaya girdigi bilinmeden
    // yazmak finansa mutabakatsiz satir birakir (sql/172).
    if (kapora > 0 && !(q('#rezKaporaKasa')?.value)) return hata('Kapora hangi kasaya girdi? Seçmeden kaydedilemez — tahsilat cari deftere bu hesaba yazılıyor.')

    let bitis = null
    if (!siparisMi) {
      if (sure === 'ozel') {
        const t = q('#rezTarih').value
        if (!t) return hata('Özel süre için tarih/saat seçin.')
        bitis = new Date(t).toISOString()
      } else {
        const saat = { '12h': 12, '24h': 24, '48h': 48 }[sure] || 24
        bitis = new Date(Date.now() + saat * 3600000).toISOString()
      }
    }
    // Min altı satış — gerekçesiz sunucu zaten reddeder, ama kullanıcıyı
    // sunucuya kadar götürmeden burada duruyoruz (daha net mesaj).
    const minAltiMi = minAlti()
    const minGerekce = (q('#rezMinGerekce')?.value || '').trim()
    if (minAltiMi && !minGerekce) {
      q('#rezMinGerekce')?.focus()
      return hata('Minimum fiyatın altındasınız — satış müdürü onayı için GEREKÇE yazın.')
    }

    const btn = q('#rezKaydet'); btn.disabled = true; q('#rezKaydetMetin').textContent = 'Kaydediliyor…'
    const { data, error } = await supabase.from('siparisler').insert({
      arac_id: a.id, alici_musteri_id: secMusteri.id, danisman_id: benim?.id, olusturan: benim?.id,
      durum: 'ACIK', asama: siparisMi ? 'SIPARIS' : 'REZERVASYON',
      anlasilan_tutar: fiyatRaw ? Number(fiyatRaw) : null, gecerlilik_bitis: bitis,
      rezervasyon_nedeni: siparisMi ? (kapora > 0 ? 'KAPORA_ALINDI' : null) : (q('#rezNeden').value || null),
      kapora_tutar: kapora, rezervasyon_notu: (q('#rezNot').value || '').trim() || null,
      satis_sekli: satisTipi || null,
      // Teslim planı (sql/244-245) — YALNIZ INSERT'te doğrudan yazılabilir.
      // Rezervasyonda null; rezervasyon teslim sözü değildir.
      planlanan_teslim_tarihi: teslim?.tarih || null,
      plan_tipi: teslim?.tip || null,
      // Kapora ödeme bilgisi → trigger bunu cariye TAHSILAT olarak yazar (sql/172)
      kapora_odeme_tipi: kapora > 0 ? (q('#rezKaporaTip')?.value || null) : null,
      kapora_kasa_id: kapora > 0 ? (q('#rezKaporaKasa')?.value || null) : null,
      // sql/225 — min altıysa sipariş "onay bekliyor" damgasıyla AÇILIR.
      // Talep edeni ve zamanı tetikleyici damgalıyor; buradan yazmak ikinci
      // bir kaynak olurdu.
      ...(minAltiMi ? { min_fiyat_onay_durumu: 'BEKLIYOR', min_fiyat_gerekce: minGerekce } : {}),
    }).select('id')
    if (error) {
      dbHata('rezervasyon/sipariş oluştur', error)
      btn.disabled = false
      q('#rezKaydetMetin').textContent = siparisMi ? 'Sipariş Oluştur ve Dosyayı Aç' : 'Kaydet ve Rezerve Et'
      // ⚠️ Ham Postgres metnini basmak yerine sınıflandır: eskiden 42501
      //    (min fiyat), 23505 (çift kayıt) ve 23514 (7 gün) aynı gri satır
      //    olarak çıkıyor, kullanıcı ne yapacağını bilmiyordu.
      const m = error.message || ''
      if (/BR-0112|BR-0504|BR-0111/.test(m)) {
        q('#rezMinUyari')?.classList.remove('hidden')
        q('#rezMinGerekce')?.focus()
        return hata('Bu tutar minimum satış fiyatının altında — gerekçe yazıp kaydedin, satış müdürüne onaya gider.')
      }
      if (/BR-0123/.test(m)) return hata('Bu araçta zaten açık bir kayıt var — önce onu kapatın.')
      if (/BR-0116/.test(m)) return hata('Rezervasyon süresi en fazla 7 gün olabilir.')
      return hata('Kaydedilemedi: ' + m)
    }
    if (!data?.length) { btn.disabled = false; return hata('Kaydedilemedi — yetki/kayıt yok.') }
    // Kapora → sipariş: doğrudan Satış Dosyası. Rezervasyon: kartı yenile, kilitli şeridi göster.
    if (siparisMi) { location.href = 'siparis-dosya.html?id=' + encodeURIComponent(data[0].id); return }
    kapat(); await yukle()
  })
}

function kutu(baslik, ik, govde, ek) {
  return `<section class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-hidden flex flex-col">
    <div class="flex items-center justify-between gap-2 px-lg py-3 border-b border-outline-variant">
      <h3 class="text-title-md text-primary flex items-center gap-2">${mat(ik, 'text-[20px]')} ${kacis(baslik)}</h3>
      ${ek || ''}
    </div>
    <div class="p-lg flex-1">${govde}</div>
  </section>`
}

// ---------- HERO ----------
function heroHtml(a) {
  const durumCls = DURUM_RENK[a.durum] || 'bg-white/15 text-white'
  const altSatir = [a.versiyon, a.km ? Number(a.km).toLocaleString('tr-TR') + ' KM' : null, [tanimAd('YAKIT', a.yakit), tanimAd('VITES', a.vites)].filter(Boolean).join(' ')].filter(Boolean).join('  ·  ')
  // ⓘ — minimum satış fiyatı (danışmanın pazarlık tabanı). _min null ise
  // (yetki yok) ikon hiç çizilmez.
  const minInfo = a._min != null
    ? ` <button id="kartMinBtn" class="inline-flex align-middle text-white/70 hover:text-white" title="Minimum satış fiyatını gör">${mat('info', 'text-[18px]')}</button>`
    : ''
  const fiyat = a._fiyat != null ? fmtPara(a._fiyat) + minInfo
    : a.fiyatlama_durumu === 'BEKLIYOR' ? '<span class="text-amber-300 text-title-lg">Fiyat bekliyor</span>'
    : '<span class="text-white/50 text-title-lg">Fiyatsız</span>'
  return `<div class="rounded-2xl overflow-hidden custom-shadow relative bg-gradient-to-br from-[#4a1020] to-[#7a1e38] min-h-[200px] flex flex-col justify-end">
    <div class="absolute inset-0 flex items-center justify-center">${mat('directions_car', 'text-[120px] text-white/10')}</div>
    <div class="relative p-lg md:p-xl text-white">
      <div class="flex items-center gap-2 mb-2 flex-wrap">
        <span class="px-3 py-1 rounded-full text-xs font-bold ${durumCls}">${kacis(ARAC_DURUM_ETIKET[a.durum] || a.durum)}</span>
        ${aracEtiket(a) ? `<span class="bg-black/40 text-white text-[11px] font-bold px-2.5 py-1 rounded tracking-wide">${kacis(aracEtiket(a))}</span>` : ''}
      </div>
      <div class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-headline-md md:text-headline-lg font-black leading-none text-white">${kacis([markaAd(a.marka), a.model].filter(Boolean).join(' ')) || '—'}${a.yil ? ` <span class="text-white/60">${kacis(a.yil)}</span>` : ''}</h2>
          <p class="text-white/80 mt-2 text-body-lg">${kacis(altSatir) || '—'}</p>
        </div>
        <div class="text-right"><div class="text-headline-md md:text-headline-lg font-black">${fiyat}</div></div>
      </div>
      ${a.durum === 'SATIS_DISI' && a.satis_disi_nedeni ? `<p class="mt-2 text-white/70 text-label-md">Satış dışı nedeni: ${kacis(a.satis_disi_nedeni)}</p>` : ''}
      ${a.durum === 'SANAYIDE' ? `<p class="mt-3 inline-flex items-center gap-1.5 bg-amber-400/20 text-amber-100 px-3 py-1.5 rounded-lg text-label-md font-bold">${mat('build', 'text-[16px]')} Bu araç sanayidedir — ilanı yayında kalmaya devam eder.</p>` : ''}
    </div>
  </div>`
}


// ---------- ALIŞ KDV (muhasebe) ----------
// Göksenil (4 Ağu 2026): "muhasebe departmanı araç kartında aracın kdv'sini
//   girebileceği/seçebileceği bir alan olması gerekiyor."
//
// ⚠️ BENİM HATAM: "zaten var" demiştim — arac-detay.js'te var, ama CANLI araç
//   kartı bu dosya (arac-kart.js). arac-kart.html → arac-kart.js yüklüyor;
//   arac-detay.js başka bir sayfa (arac-detay.html) ve stok listesinde KDV
//   yalnız OKUNUR rozet. Yani muhasebe personelinin KDV gireceği yer
//   HİÇBİR YERDE YOKTU. Alan buraya eklendi.
//
// Yetkisi yoksa sabit rozet görür; varsa seçer ve seçim ANINDA yazılır
// ("Kaydet" yok). Sunucu koruması ayrıca var: sql/82 trg_stok_kdv_koru.
const KDV_RENK_K = {
  '1': 'bg-secondary-container text-on-secondary-container border-secondary/30',
  '20': 'bg-amber-100 text-amber-900 border-amber-300',
  OZEL_MATRAH: 'bg-primary-fixed text-primary border-primary/30',
  BELLI_DEGIL: 'bg-surface-container-high text-on-surface-variant border-outline-variant',
}
function kdvAlanHtml(a) {
  const k = a.kdv_orani || 'BELLI_DEGIL'
  if (!kdvYonetir(benim)) {
    return `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${KDV_RENK_K[k] || KDV_RENK_K.BELLI_DEGIL}">${kacis(kdvEtiket(k))}</span>`
  }
  return `<select id="akKdv" class="border border-outline-variant rounded-lg pl-2 pr-7 py-1 text-body-sm bg-surface-container-low font-bold">
    ${KDV_KODLARI.map(x => `<option value="${x}"${x === k ? ' selected' : ''}>${kacis(kdvEtiket(x))}</option>`).join('')}
  </select>`
}

// §5.1: .update() 0 satır güncelleyebilir — DAİMA say, sessiz geçme.
// =====================================================================
// KASKO / TSB KODU SEÇİCİ
//
// Göksenil (19 Ağu 2026): "bu aracın kasko kodunu girmeden sisteme
//   kaydettim, nereden kasko kodunu seçebileceğim".
//
// ⚠️ NEDEN BURAYA EKLENDİ: seçici YALNIZ Fiyatlama Merkezi'ndeydi
//   (fiyatlama.js tsbDuzeltAc). O kuyruk `fiyatlama_durumu='BEKLIYOR'`
//   ile süzülüyor; araç fiyatlanınca kuyruktan düşüyor ve kodu girecek
//   HİÇBİR ekran kalmıyordu. Kasko değeri bu koddan türediği için de
//   kod boş kalınca sigorta/kredi ekranlarında "kasko kodu eksik" çıkıyor.
//
// ⚠️ ARAMA BURADA YAZILMADI: tsb-paket.js (tsbAdayAra + tsbAdaylariCiz)
//   tek kaynak. Fiyatlama ekranı da aynı modülü kullanıyor; ikinci bir
//   arayıcı yazmak bu projenin en sık hatası (CLAUDE.md §4).
// =====================================================================
async function tsbSeciciAc(a) {
  const kap = document.getElementById('akTsbKap'); if (!kap) return
  if (!kap.classList.contains('hidden')) { kap.classList.add('hidden'); kap.innerHTML = ''; return }
  kap.classList.remove('hidden')

  const { tsbAdayAra, tsbAdaylariCiz, gecikmeli } = await import('./tsb-paket.js')
  // Tohum metin aracın kendi künyesi — arama ilan başlığı biçimi bekliyor.
  const tohum = [markaAd(a.marka), a.model, a.versiyon].filter(Boolean).join(' ')
  kap.innerHTML = `
    <input id="akTsbAra" class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2.5 py-1.5 text-[12px] focus:ring-2 focus:ring-primary/20 focus:outline-none"
           value="${kacis(tohum)}" placeholder="İlan başlığı — ör. Fiat Fiorino 1.3 M.Jet Combi Safeline" />
    <span class="block text-[10px] text-on-surface-variant mt-1">Model yılı: <b>${kacis(String(a.yil || '—'))}</b> · aday seçince kod kaydedilir.</span>
    <span id="akTsbAdaylar" class="block mt-1.5 space-y-1"></span>`

  const ara = gecikmeli(async () => {
    const metin = (document.getElementById('akTsbAra')?.value || '').trim()
    const kutu = document.getElementById('akTsbAdaylar'); if (!kutu) return
    if (metin.length < 3) { kutu.innerHTML = ''; return }
    kutu.innerHTML = '<span class="block text-[11px] text-on-surface-variant">Aranıyor…</span>'
    const sonuc = await tsbAdayAra({ metin, yil: a.yil })
    tsbAdaylariCiz(kutu, sonuc, { yil: a.yil, onSec: sec => tsbKodunuYaz(a, sec) })
  }, 350)
  document.getElementById('akTsbAra')?.addEventListener('input', ara)
  ara()
}

async function tsbKodunuYaz(a, sec) {
  const kutu = document.getElementById('akTsbAdaylar')
  if (kutu) kutu.innerHTML = '<span class="block text-[11px] text-on-surface-variant">Kaydediliyor…</span>'
  const { data, error } = await supabase.from('stok_araclar')
    .update({ tsb_marka_id: sec.marka_kodu, tsb_tip_id: sec.tip_kodu })
    .eq('id', a.id).select('id')
  // §5.1 — .update() sessizce 0 satır günceller; select('id') + length ŞART.
  if (error) {
    dbHata('tsb kodu yaz', error)
    if (kutu) kutu.innerHTML = `<span class="block text-[11px] text-error">Kaydedilemedi: ${kacis(error.message)}</span>`
    return
  }
  if (!data?.length) {
    if (kutu) kutu.innerHTML = '<span class="block text-[11px] text-error">Kaydedilemedi — yetkiniz yok.</span>'
    return
  }
  await yukle()   // kart yeniden çizilsin; kod ve ona bağlı kasko değeri tazelensin
}

async function kdvYaz(deger) {
  const { data, error } = await supabase.from('stok_araclar')
    .update({ kdv_orani: deger }).eq('id', id).select('id,kdv_orani')
  if (error) { dbHata('kdv guncelle', error); alert('KDV kaydedilemedi: ' + error.message); await yukle(); return }
  if (!data?.length) { alert('KDV güncellenemedi — yetkiniz yok.'); await yukle(); return }
  await yukle()
}

// ---------- TEKNİK ----------
function teknikHtml(a) {
  const bilgi = (e, d) => `<div><p class="text-[11px] text-on-surface-variant uppercase tracking-wide">${e}</p><p class="text-body-md font-medium text-on-surface mt-0.5">${d || '—'}</p></div>`
  const govde = `<div class="grid grid-cols-2 gap-lg">
    ${bilgi('Yıl / KM', (kacis(a.yil) || '—') + ' · ' + (a.km ? Number(a.km).toLocaleString('tr-TR') + ' km' : '—'))}
    ${bilgi('Yakıt / Vites', kacis([tanimAd('YAKIT', a.yakit), tanimAd('VITES', a.vites)].filter(Boolean).join(' / ')))}
    ${bilgi('Renk / Kasa', kacis([tanimAd('RENK', a.renk), tanimAd('KASA_TIPI', a.kasa_tipi)].filter(Boolean).join(' · ')))}
    ${bilgi('Versiyon', kacis(a.versiyon))}
    ${/* Göksenil (5 Ağu 2026): "eski plakasını da göstermemiz gerekiyor.
          Satılan aracı geri aldığımızda yeni plakasından sorguluyoruz,
          eski plakası da buymuş diyoruz." Plaka devri teslim sırasında
          yapılıyor (sql/159); eski plaka stok_araclar.eski_plaka'da. */''}
    ${bilgi('Plaka', kacis(aracEtiket(a)) +
      (a.eski_plaka ? `<span class="block text-[11px] font-normal text-on-surface-variant mt-0.5">eski: ${kacis(buyuk(a.eski_plaka))}</span>` : ''))}
    ${bilgi('Şasi No', kacis(a.sasi_no))}
    ${bilgi('Motor No', kacis(a.motor_no))}
    ${bilgi(disLokasyon(a.lokasyon) ? 'Lokasyon / Park' : 'Park',
            kacis([disLokasyon(a.lokasyon), a.park].filter(Boolean).join(' · ') || '—'))}
    ${/* ⚠️ KASKO KODU BURADAN DA SEÇİLEBİLİR (Göksenil, 19 Ağu 2026:
           "bu aracın kasko kodunu girmeden kaydettim, nereden seçeceğim").
           Seçici YALNIZ Fiyatlama Merkezi'ndeydi ve o kuyruk
           `fiyatlama_durumu='BEKLIYOR'` ile süzülüyor — araç fiyatlanınca
           kuyruktan düşüyor ve kodu girecek HİÇBİR yer kalmıyordu.
           Arama/aday çizimi tsb-paket.js'ten; burada ikinci bir arayıcı
           YAZILMADI (CLAUDE.md §4).
           ⚠️ Okuma `kaskoKodu()` ile: ham `kasko_kodu` kolonu çoğu araçta
           BOŞ, kod TSB marka+tip'ten türetiliyor (veri.js tek kaynak). */''}
    ${bilgi('Kasko / TSB Kodu', `<span class="inline-flex items-center gap-2 flex-wrap">
      <span>${kaskoKodu(a) ? kacis(kaskoKodu(a)) : '<span class="text-error font-normal">girilmedi</span>'}</span>
      ${fiyatYonetir(benim) ? `<button id="akTsbAc" class="text-[11px] font-bold text-primary hover:underline shrink-0">${kaskoKodu(a) ? 'Düzelt' : 'Kodu seç'}</button>` : ''}
    </span>${/* ⚠️ <span class="block">, <div> DEĞİL: bilgi() içeriği <p> içine
              koyuyor ve <p> içinde <div> geçersiz — tarayıcı <p>'yi erken
              kapatır, panel kartın dışına düşer. */''}
    ${fiyatYonetir(benim) ? '<span id="akTsbKap" class="hidden block mt-2"></span>' : ''}`)}
    ${bilgi('Yedek Anahtar', a.yedek_anahtar
      ? `<span class="inline-flex items-center gap-1 text-green-700 font-bold">${mat('key', 'text-[15px]')} Var</span>`
      : `<span class="inline-flex items-center gap-1 text-error font-bold">${mat('key_off', 'text-[15px]')} Yok</span>`)}
    ${bilgi('Muayene', a.muayene_tarihi ? fmtTarihKisa(a.muayene_tarihi) : '—')}
    ${bilgi('Tescil', a.tescil_tarihi ? fmtTarihKisa(a.tescil_tarihi) : '—')}
    ${bilgi('Alış KDV', kdvAlanHtml(a))}
  </div>`
  return kutu('Teknik Bilgi', 'directions_car', govde, teknikDuzenleButonu(a))
}

// Göksenil, 1 Ağu 2026: "bilgi işlem birimi aracın teknik bilgisini
// düzenleyebilmeli (fiyatlamadan sonra)."
// ⚠️ YENİ BİR DÜZENLEME FORMU YAZILMADI. Araç Detay'daki form zaten var ve
//   kilit kuralı orada tanımlı (fiyatlama kuyruğundayken — BEKLIYOR —
//   yönetici olmayan düzenleyemez; FİYATLANDI'dan sonra kilit kalkar).
//   Burası yalnız o formu POP-UP olarak açan bir GİRİŞ NOKTASI; kural tek
//   yerde kalsın diye kopyalanmadı.
const teknikDuzenler = d => !!(d && (d.master_admin || d.rol === 'yonetici' || d.rol === 'bilgi_islem'
  || (Array.isArray(d.yetkiler) && d.yetkiler.includes('arac_kabul'))))

function teknikDuzenleButonu(a) {
  if (!teknikDuzenler(benim)) return ''
  const beklemede = a.fiyatlama_durumu === 'BEKLIYOR' && !(benim.master_admin || benim.rol === 'yonetici')
  if (beklemede) {
    return `<span class="text-[11px] text-on-surface-variant flex items-center gap-1" title="Fiyatlama tamamlanınca düzenlenebilir">${mat('lock', 'text-[13px]')} Fiyatlama bekliyor</span>`
  }
  return `<button id="teknikDuzenleBtn" class="cursor-pointer bg-surface-container-low border border-primary/40 text-primary px-2.5 py-1 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:bg-primary/5" title="Araç bilgilerini düzenle">
    ${mat('edit', 'text-[16px]')} Düzenle
  </button>`
}

// ---------- YAPILAN İŞLEMLER (masraf kalemleri — HERKES görür, tutarsız) ----------
// Göksenil kararı (5 Ağu 2026): "araca yapılan masrafların ne olduklarını
// herkes görecek ama tutarları yazmayacak."
// Kaynak v_arac_masraf_kalem (sql/160): `tutar` kolonu view'da HİÇ YOK.
// Danışman aracın boyandığını/bakım gördüğünü müşteriye anlatabilsin diye
// açık; rakam finans tarafında kalır.
function masrafKalemHtml(a) {
  const kalemler = a._masrafKalem || []
  const govde = kalemler.length
    ? `<div class="grid gap-sm">${kalemler.map(k => `
        <div class="flex items-start justify-between gap-3 border-b border-outline-variant/60 pb-2 last:border-0 last:pb-0">
          <div class="min-w-0">
            <p class="font-bold text-on-surface text-body-md">
              ${kacis(k.masraf_adi)}
              ${k.yon === 'GELIR' ? `<span class="ml-1 text-[10px] font-bold text-green-700 uppercase">gelir</span>` : ''}
            </p>
            ${k.aciklama ? `<p class="text-body-md text-on-surface-variant mt-0.5">${kacis(k.aciklama)}</p>` : ''}
          </div>
          <span class="text-[11px] text-on-surface-variant whitespace-nowrap">${fmtTarihKisa(k.tarih)}</span>
        </div>`).join('')}</div>`
    : `<p class="text-on-surface-variant text-body-md">Bu araca işlenmiş masraf yok.</p>`
  return kutu('Yapılan İşlemler', 'handyman', govde)
}

// ---------- OPERASYON — SANAYİ (C/4: yalnız operasyon görür) ----------
// Göksenil kararı (5 Ağu 2026): araç sanayiye gitse de ilan yayında kalır.
// "Sanayidedir" bilgisi hero'da HERKESE; hangi firmada olduğu ve yapılan iş
// YALNIZ burada, yalnız operasyona. Asıl koruma sunucuda: v_arac_operasyon_isleri
// security_invoker → is_emirleri RLS'i (sql/159). Buradaki kapı görünürlük içindir.
function operasyonHtml(a) {
  if (!operasyonIsiGorur(benim)) return ''

  const isler = a._opIsler || []
  const tedarikciler = a._opTedarikciler || []
  const turler = a._opTurler || []
  const yazar = operasyonIsiYazar(benim)

  const rozet = {
    ACIK: 'bg-blue-100 text-blue-800', DEVAM: 'bg-amber-100 text-amber-800',
    TAMAMLANDI: 'bg-green-100 text-green-800', IPTAL: 'bg-surface-variant text-on-surface-variant',
  }

  const liste = isler.length
    ? isler.map(i => `
      <div class="border border-outline-variant rounded-lg p-md">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <p class="font-bold text-on-surface">${kacis(i.islem_adi || i.islem_turu)}</p>
          <span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${rozet[i.is_durumu] || 'bg-surface-variant text-on-surface-variant'}">${kacis(i.is_durumu)}</span>
        </div>
        <p class="text-body-md text-on-surface-variant mt-1 inline-flex items-center gap-1">
          ${mat('store', 'text-[15px]')} ${kacis(i.firma_adi || 'Firma seçilmedi')}
        </p>
        ${i.aciklama ? `<p class="text-body-md text-on-surface mt-1">${kacis(i.aciklama)}</p>` : ''}
        <p class="text-[11px] text-on-surface-variant mt-1">${fmtTarihKisa(i.created_at)}</p>
      </div>`).join('')
    : `<p class="text-on-surface-variant text-body-md">Bu araç için iş emri yok.</p>`

  // Firma tanımı yoksa form işe yaramaz — operasyon tanımlarına yönlendir.
  const form = !yazar ? ''
    : !tedarikciler.length
      ? `<div class="uyari-kutu mt-md text-body-md">Firma listesi boş.
           <a href="operasyon-tanimlar.html" class="text-primary font-bold">Operasyon Tanımları</a>'ndan
           sanayi/tedarikçi firmalarını ekleyin.</div>`
      : `<form id="opIsForm" class="mt-md grid gap-sm border-t border-outline-variant pt-md">
          <div class="grid grid-cols-2 gap-sm">
            <label class="grid gap-1">
              <span class="text-[11px] text-on-surface-variant uppercase tracking-wide">Yapılan iş</span>
              <select id="opIsTur" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" required>
                <option value="">Seçin…</option>
                ${turler.map(t => `<option value="${kacis(t.kod)}">${kacis(t.ad)}</option>`).join('')}
              </select>
            </label>
            <label class="grid gap-1">
              <span class="text-[11px] text-on-surface-variant uppercase tracking-wide">Hangi firmada</span>
              <select id="opIsFirma" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" required>
                <option value="">Seçin…</option>
                ${tedarikciler.map(t => `<option value="${kacis(t.id)}">${kacis(t.ad)}</option>`).join('')}
              </select>
            </label>
          </div>
          <input id="opIsAciklama" maxlength="500" autocomplete="off" placeholder="Açıklama (ör. sağ ön çamurluk kaporta + boya)"
                 class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white focus:border-primary focus:ring-1 focus:ring-primary">
          <div class="flex items-center gap-2">
            <button type="submit" class="bg-primary text-on-primary px-4 py-2 rounded-lg text-label-md font-bold flex items-center gap-1">${mat('add', 'text-[18px]')} İş emri ekle</button>
            <span id="opIsDurum" class="text-label-md"></span>
          </div>
        </form>`

  return kutu('Operasyon — Sanayi', 'build', `<div class="grid gap-sm">${liste}</div>${form}`)
}

// İş emri ekle — arayüzün gerçek yolu: doğrudan is_emirleri insert.
// Yetkisiz kullanıcıda RLS 0 satır yazar; §5.1 gereği data.length kontrol
// edilir, sessiz başarı gösterilmez.
async function opIsEkle(e) {
  e.preventDefault()
  const durum = document.getElementById('opIsDurum')
  const btn = e.target.querySelector('button[type="submit"]')
  const tur = document.getElementById('opIsTur').value
  const firma = document.getElementById('opIsFirma').value
  const aciklama = document.getElementById('opIsAciklama').value.trim()
  if (!tur || !firma) return

  btn.disabled = true
  durum.className = 'text-label-md text-on-surface-variant'
  durum.textContent = 'Kaydediliyor…'

  const { data, error } = await supabase.from('is_emirleri').insert({
    arac_id: id, islem_turu: tur, tedarikci_id: firma,
    aciklama: aciklama || null, is_durumu: 'ACIK',
    maliyet_asamasi: 'TAAHHUT', finans_durum: 'HAZIR_DEGIL',
    sorumlu_id: benim?.id || null, olusturan: benim?.id || null,
  }).select('id')

  if (error) {
    dbHata('is emri ekle', error)
    durum.className = 'text-label-md font-bold text-error'
    durum.textContent = 'Eklenemedi: ' + error.message
    btn.disabled = false; return
  }
  if (!data?.length) {
    durum.className = 'text-label-md font-bold text-error'
    durum.textContent = 'Eklenemedi — iş emri açma yetkiniz yok.'
    btn.disabled = false; return
  }
  yukle()
}

// ---------- EKSPERTİZ (SVG şema + PDF) ----------
function ekspertizHtml(a) {
  const eks = a.arac_ekspertiz || []
  const evr = a.arac_evraklar || []
  const pdf = evr.find(e => e.tip === 'EKSPERTIZ_PDF') || evr.find(e => e.tip === 'EKSPERTIZ_LINK')
  const say = {}; for (const e of eks) say[e.durum] = (say[e.durum] || 0) + 1
  const efsane = Object.keys(RENK).map(d => `<span class="inline-flex items-center gap-1 text-[10px] text-on-surface-variant"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:${RENK[d]}"></span>${kacis(DURUM_ETIKET[d] || d)}${say[d] ? ' ·' + say[d] : ''}</span>`).join('')
  const sema = svgTxt
    ? `<div id="eksSvg" class="w-full max-w-[240px] mx-auto">${svgTxt}</div>`
    : '<p class="text-on-surface-variant text-body-md text-center">Şema yüklenemedi.</p>'
  // HATA DÜZELTMESİ: pdf.url bir STORAGE YOLU ('arac/<id>/ekspertiz_pdf_…pdf'),
  // URL değil. <a href> onu sayfaya göreli çözüp 404 veriyordu. arac-evrak
  // bucket'ı ÖZEL — imzalı URL gerekiyor (tıklanınca üretilir).
  // EKSPERTIZ_LINK ise zaten dış bir adres, doğrudan açılır.
  const pdfBtn = pdf
    ? (pdf.tip === 'EKSPERTIZ_LINK'
      ? `<a href="${kacis(pdf.url)}" target="_blank" rel="noopener" class="flex items-center justify-center gap-2 bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold hover:opacity-90 mt-3">${mat('open_in_new', 'text-[18px]')} Ekspertiz Linki</a>`
      : `<button id="eksPdfAc" data-yol="${kacis(pdf.url)}" class="w-full flex items-center justify-center gap-2 bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold hover:opacity-90 mt-3">${mat('picture_as_pdf', 'text-[18px]')} Ekspertiz PDF</button>`)
    : `<p class="text-[11px] text-on-surface-variant text-center mt-3">Ekspertiz PDF yüklü değil.</p>`
  const duzenlemeAlani = eksDuzenle
    ? `<div class="mt-3 bg-primary/5 border border-primary/30 rounded-lg p-2.5">
         <p class="text-[11.5px] text-on-surface-variant leading-relaxed">Parçaya dokundukça durum sırayla değişir:
           <b>Orijinal → Boyalı → Lokal → Değişen</b>. Bitince <b>Kaydet</b>'e basın.</p>
         <div class="flex items-center gap-2 mt-2">
           <button id="eksKaydet" class="flex-1 bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold hover:opacity-90">Kaydet</button>
           <button id="eksVazgec" class="px-3 py-2 rounded-lg border border-outline-variant text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
         </div>
       </div>`
    : ''
  const govde = `${sema}<div class="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3">${efsane}</div>${eks.length || eksDuzenle ? '' : '<p class="text-[11px] text-on-surface-variant text-center mt-2">Ekspertiz şeması girilmemiş.</p>'}${duzenlemeAlani}${pdfBtn}${tramerOzetHtml(a)}`
  return kutu('Ekspertiz', 'build', govde, ekspertizDuzenleButonu())
}

// ---------- EKSPERTİZ ŞEMASI REVİZYONU (araç kartından) ----------
// Göksenil, 13 Ağu 2026: "bu aracın araç svg boyalı parçalarını revize etmek
//   istiyorum ama izin vermiyor, master admin değiştirebilsin."
//
// Şema araç kartında BİLEREK salt-okunurdu (tıklamalar kapatılıyordu); tek
// düzenleme yeri Araç Kabul sihirbazıydı. Araç stoğa girip fiyatlandıktan
// sonra oraya dönmek akışa aykırı, o yüzden revizyon buraya alındı.
//
// ⚠️ KAPI SUNUCUNUN AYNASI: arac_ekspertiz DELETE politikası
//    `is_master() or is_yonetici()`. Kaydetme sil+yaz olduğu için düzenlemeyi
//    de aynı iki role açıyoruz — daha genişi (ör. bilgi işlem) düğmeyi görür
//    ama kaydederken silme adımı sessizce 0 satır dönerdi.
// ⚠️ OTOMATİK KAYDETME YOK. Her tıklama bir tur döndürüyor; anlık yazsaydık
//    "Orijinal"e getirmek için üç kez yazma yapardık ve yanlış ara durumlar
//    kayda geçerdi. Kaydet'e basılana kadar değişiklik yalnız ekranda.
// ⚠️ ORİJİNAL parçalar TABLOYA YAZILMAZ (sihirbazla aynı kural) — tablo
//    yalnız hasarlı parçaları tutar, "satır yok" = orijinal demektir.
let eksDuzenle = false
let eksTaslak = null   // { 'Ön Kaput': 'BOYALI', … } — yalnız düzenleme sırasında

function ekspertizDuzenleyebilir() {
  return !!(benim && (benim.master_admin || benim.rol === 'yonetici'))
}

function ekspertizDuzenleButonu() {
  if (!ekspertizDuzenleyebilir() || eksDuzenle) return ''
  return `<button id="eksDuzenleBtn" class="cursor-pointer bg-surface-container-low border border-primary/40 text-primary px-2.5 py-1 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:bg-primary/5" title="Ekspertiz şemasını revize et">
    ${mat('edit', 'text-[16px]')} Revize
  </button>`
}

function ekspertizSvgBoya(a) {
  const kap = document.getElementById('eksSvg'); if (!kap) return
  const svg = kap.querySelector('svg'); if (!svg) return
  const kayitli = {}; for (const e of (a.arac_ekspertiz || [])) kayitli[e.parca_kodu] = e.durum
  // Düzenleme sırasında taslak gösterilir; kapalıyken daima DB'deki hâli.
  const paneller = eksDuzenle ? (eksTaslak ||= { ...kayitli }) : kayitli
  svgBoya(svg, paneller)

  if (!eksDuzenle) {
    svg.querySelectorAll('[data-part]').forEach(p => { p.style.cursor = 'default'; p.onclick = null })
    return
  }
  for (const path of svg.querySelectorAll('[data-part]')) {
    path.style.cursor = 'pointer'
    path.onclick = () => {
      const p = path.getAttribute('data-part')
      // ⚠️ Kayıtsız parça `undefined`; indexOf -1 döner, +1 ile 0 = ORIJINAL
      //    olurdu ve ilk tıklama HİÇBİR ŞEYİ DEĞİŞTİRMEZDİ. Varsayılan
      //    ORIJINAL'e sabitleniyor ki ilk tıklama BOYALI'ya geçsin.
      const suan = paneller[p] || 'ORIJINAL'
      paneller[p] = DURUMLAR[(DURUMLAR.indexOf(suan) + 1) % DURUMLAR.length]
      svgBoya(svg, paneller)
    }
  }
}

// Kaydetme FARK TABANLI — ortak yardımcı ekspertiz.js'te (TEK KAYNAK).
// Sil+yaz kalıbı neden bırakıldığı ve mükerrer satır tuzağı orada yazılı.
// Buradaki tek iş: taslağı hedefe çevirip yardımcıyı çağırmak ve olay yazmak.
async function ekspertizRevizeKaydet() {
  if (!ekspertizDuzenleyebilir()) return
  const btn = document.getElementById('eksKaydet')
  const bitir = () => { if (btn) { btn.disabled = false; btn.textContent = 'Kaydet' } }
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…' }

  const mevcut = {}
  for (const e of (sonArac?.arac_ekspertiz || [])) mevcut[e.parca_kodu] = e.durum

  const r = await ekspertizFarkKaydet({
    aracId: id, mevcut, hedef: ekspertizHedef(eksTaslak || {}),
    silebilir: ekspertizDuzenleyebilir(),
  })
  if (!r.ok) { alert(r.msg); bitir(); await yukle(); return }

  // Hiçbir şey değişmediyse olay da yazma — boş "Ekspertiz işlendi" satırı
  // yaşam döngüsünü kirletirdi.
  if (r.degisti) {
    const { error: oErr } = await supabase.rpc('olay_ekle', {
      p_tip: 'EKSPERTIZ_ISLENDI', p_arac: id, p_musteri: null, p_siparis: null, p_danisman: benim?.id || null,
    })
    if (oErr) dbHata('olay_ekle ekspertiz revizyon', oErr)
  }

  bitir()
  eksDuzenle = false; eksTaslak = null
  await yukle()
}

// ---------- FİYAT ----------
// #1: Bu aracın kredi durumu şeridi — onaylı (yeşil) / değerlendirmede (amber)
function krediDurumHtml() {
  if (krediDurum === 'onayli') {
    return `<div class="mt-lg bg-[#ECFDF5] border border-[#10B981]/40 rounded-2xl px-lg py-2.5 flex items-center gap-2.5 custom-shadow">
      <span class="w-8 h-8 rounded-full bg-[#10B981] text-white flex items-center justify-center shrink-0">${mat('verified', 'text-[18px]')}</span>
      <div class="text-sm font-extrabold text-[#047857]">✓ Bu aracın kredisi ONAYLI</div>
    </div>`
  }
  if (krediDurum === 'degerlendirmede') {
    return `<div class="mt-lg bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-2xl px-lg py-2.5 flex items-center gap-2.5 custom-shadow">
      <span class="w-8 h-8 rounded-full bg-[#F59E0B] text-white flex items-center justify-center shrink-0">${mat('hourglass_top', 'text-[18px]')}</span>
      <div class="text-sm font-bold text-[#B45309]">🏦 Kredi değerlendirmesi yapılıyor — kredi birimi başvuruyu işliyor.</div>
    </div>`
  }
  return ''
}

// ---------- ŞİRKET KULLANIMINA AL (sql/165) ----------
// Araç "Kullanımdaki Araçlar" listesine geçer. Yazma kararı SUNUCUDA
// (kullanimdaki_tahsis_et): yetki, durum ve personel denetimi orada.
// Burada ikinci bir kural YAZILMAZ — istemci/sunucu ayrışması bu projede
// KDV alanında yaşandı, tekrarlanmıyor.
function kullanimaAlAc(a) {
  const eski = document.getElementById('kaOverlay'); if (eski) eski.remove()
  const INP = 'w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 h-11 text-[16px] focus:ring-2 focus:ring-primary/20 focus:outline-none'
  // Tahsis listesi: aktif personel (dmap zaten yüklü — ikinci sorgu yok).
  const kisiler = Object.values(dmap || {})
    .filter(d => d && d.ad_soyad)
    .sort((x, y) => String(x.ad_soyad).localeCompare(String(y.ad_soyad), 'tr'))
    .map(d => `<option value="${kacis(d.id)}">${kacis(buyuk(d.ad_soyad))}</option>`).join('')

  const ov = document.createElement('div')
  ov.id = 'kaOverlay'
  ov.className = 'stitch fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-sm overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md mb-8" onclick="event.stopPropagation()">
      <div class="px-5 py-4 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low">
        <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">${mat('badge', '', true)}</div>
        <div class="min-w-0">
          <h3 class="text-lg font-black text-primary">Şirket Kullanımına Al</h3>
          <p class="text-xs text-on-surface-variant truncate">${kacis(aracEtiket(a))} · ${kacis(buyuk([markaAd(a.marka), a.model].filter(Boolean).join(' ')))}</p>
        </div>
        <button class="ka-kapat ml-auto p-2 hover:bg-white rounded-full text-on-surface-variant shrink-0">${mat('close')}</button>
      </div>
      <div class="p-5 space-y-4">
        <div class="bg-primary/5 border border-primary/20 rounded-lg p-3 text-[12.5px] text-on-surface flex items-start gap-2">
          ${mat('info', 'text-[16px] text-primary shrink-0')}
          <span>Araç <b>Kullanımdaki Araçlar</b> listesine geçer, stoktan ve satıştan düşer.
          Geri almak için o sayfadaki <b>Stoğa Al</b> düğmesi kullanılır.</span>
        </div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase" for="kaKisi">Kime Tahsis Edildi</label>
          <select id="kaKisi" class="${INP} mt-1"><option value="">— Belirtilmedi —</option>${kisiler}</select></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase" for="kaTarih">Tahsis Tarihi</label>
          <input id="kaTarih" type="date" value="${new Date().toISOString().slice(0, 10)}" class="${INP} mt-1" /></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase" for="kaNot">Not</label>
          <input id="kaNot" type="text" placeholder="ör. Servis aracı" class="${INP} mt-1" /></div>
        <div id="kaHata" class="hidden bg-error-container text-on-error-container border border-error/20 rounded-lg px-3 py-2 text-sm"></div>
      </div>
      <div class="flex justify-end gap-2 px-5 pb-5">
        <button class="ka-kapat px-5 h-11 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
        <button id="kaOnay" class="px-6 h-11 bg-primary text-on-primary rounded-lg text-sm font-bold hover:opacity-90 flex items-center gap-2">${mat('badge', 'text-[18px]')} Kullanıma Al</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => { document.removeEventListener('keydown', esc); ov.remove() }
  const esc = e => { if (e.key === 'Escape') kapat() }
  document.addEventListener('keydown', esc)
  ov.addEventListener('click', e => { if (e.target === ov) kapat() })
  ov.querySelectorAll('.ka-kapat').forEach(b => b.addEventListener('click', kapat))

  ov.querySelector('#kaOnay').addEventListener('click', async () => {
    const h = ov.querySelector('#kaHata'); h.classList.add('hidden')
    const btn = ov.querySelector('#kaOnay'); btn.disabled = true; btn.textContent = 'İşleniyor…'
    const { data, error } = await supabase.rpc('kullanimdaki_tahsis_et', {
      p_arac: a.id,
      p_tahsis_edilen: ov.querySelector('#kaKisi').value || null,
      p_tarih: ov.querySelector('#kaTarih').value || null,
      p_not: (ov.querySelector('#kaNot').value || '').trim() || null,
    })
    btn.disabled = false; btn.innerHTML = `${mat('badge', 'text-[18px]')} Kullanıma Al`
    // ⚠️ İKİ AYRI BAŞARISIZLIK: `error` (yetki/ağ) ve `data.ok=false`
    //    (iş kuralı). İkincisini kontrol etmezsek "başarılı" sanılır.
    if (error) { dbHata('kullanıma al', error); h.textContent = 'İşlem başarısız: ' + error.message; h.classList.remove('hidden'); return }
    if (!data?.ok) { h.textContent = data?.hata || 'Kaydedilemedi.'; h.classList.remove('hidden'); return }
    kapat()
    alert(`Araç şirket kullanımına alındı.${data.tahsis_edilen ? '\n\nTahsis edilen: ' + data.tahsis_edilen : ''}\n\nArtık "Kullanımdaki Araçlar" sayfasında görünecek.`)
    await yukle()
  })
}

// ---------- KREDİYE GÖNDER (stok-arac.js'ten taşındı) ----------
// ⚠️ "Sigorta Teklifi Al" BURADAN KALDIRILDI (Göksenil, 10 Ağu 2026):
//   "stoktaki bir araca sigorta teklifi istemeyeceğiz. siparişe alındıktan
//    sonra sigorta modülüne göndereceğiz, onlar aracın yeni müşterisine
//    sigortasını kesecekler."
//   Stokta aracın ALICISI henüz yok; poliçe yeni sahibine kesildiği için
//   müşteri elle yazdırılıyordu ve üç ayrı alan aynı bilgiyi soruyordu.
//   Ölçüldü: canlıya çıktığından beri sigorta_firsatlari'nda 0 kayıt.
//   Yeni yeri: SİPARİŞ DOSYASI → "Sigortaya Gönder" (siparis-dosya.js, sql/182).
//   Krediye Gönder yerinde KALIYOR — kredi başvurusu satıştan önce de olur.
function krediSigortaHtml(a) {
  const b = 'px-4 h-10 rounded-lg bg-surface-container-lowest border border-primary/40 text-primary text-sm font-bold hover:bg-primary/5 flex items-center gap-1.5 custom-shadow'
  return `<div class="mt-lg flex flex-wrap gap-2">
    <button id="krediGonderBtn" class="${b}">${mat('credit_score', 'text-[18px]')} Krediye Gönder</button>
    ${camEtiketiBasar(benim) ? `<button id="camEtiketBtn" class="${b}">${mat('print', 'text-[18px]')} Cam Etiketi</button>` : ''}
    ${/* Göksenil (4 Ağu 2026): "cam etiketi butonun yanına masraflar diye bir
          buton yapalım, pop up şeklinde açılsın." Defter kart olarak sayfayı
          uzatıyordu; herkesin her gün baktığı bir şey değil. */''}
    ${masrafGorur(benim) ? `<button id="masrafBtn" class="${b}">${mat('receipt_long', 'text-[18px]')} Masraflar${masrafSayisi() ? `<span class="ml-1 text-[10px] font-black bg-primary/10 text-primary px-1.5 rounded-full">${masrafSayisi()}</span>` : ''}</button>` : ''}
    ${/* Göksenil (5 Ağu 2026): "aracı kullanımdaki araçlara aktaracağım,
          araç kartında nereden yapmam gerek?" — O yol HİÇ YOKTU: KULLANIMDA
          durumu 89 modülün hiçbirinde geçmiyordu, yalnız dönüş yolu
          (Kullanımdaki Araçlar > Stoğa Al) vardı. Düğme buraya kondu.
          ⚠️ Müşteri süreci açık araçta GÖSTERİLMEZ — sunucu da reddeder
             (sql/165); ikisi aynı kuralı uygular. */''}
    ${kullanimYonetir(benim) && !KULLANIM_DISI.includes(a.durum)
      ? `<button id="kullanimaAlBtn" class="${b}">${mat('badge', 'text-[18px]')} Kullanıma Al</button>` : ''}
  </div>`
}

// Tramer/hasar özeti — ekspertiz kartının altında (salt-okunur; RLS yetkisizde boş döner)
function tramerOzetHtml(a) {
  const trm = a.arac_tramer || []
  if (!trm.length) return `<div class="mt-3 pt-3 border-t border-outline-variant/50"><p class="text-[11px] text-on-surface-variant flex items-center gap-1">${mat('search_check', 'text-[14px]')} Tramer: hasar kaydı yok.</p></div>`
  const toplam = trm.reduce((s, t) => s + (Number(t.tutar) || 0), 0)
  const satir = t => `<div class="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-outline-variant/40 last:border-0">
    <span class="text-on-surface-variant whitespace-nowrap">${t.hasar_tarihi ? fmtTarihKisa(t.hasar_tarihi) : '—'}</span>
    <span class="flex-1 truncate">${kacis(buyuk(t.aciklama || '—'))}</span>
    <span class="font-bold text-error whitespace-nowrap">${t.tutar != null ? Number(t.tutar).toLocaleString('tr-TR') + ' ₺' : '—'}</span></div>`
  return `<div class="mt-3 pt-3 border-t border-outline-variant/50">
    <div class="flex items-center justify-between mb-1">
      <span class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide flex items-center gap-1">${mat('search_check', 'text-[14px]')} Tramer / Hasar</span>
      <span class="text-[11px] font-bold text-error">${trm.length} hasar · ${toplam.toLocaleString('tr-TR')} ₺</span></div>
    ${trm.map(satir).join('')}</div>`
}

function krediGonderAc(a) {
  const inp = 'mt-1 w-full border border-outline-variant rounded-lg px-3 py-2 text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary'
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[95] flex items-start justify-center pt-[10vh] px-4 bg-black/40 backdrop-blur-sm'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-5 py-4 border-b border-outline-variant"><h3 class="text-title-lg font-bold text-primary flex items-center gap-2">${mat('credit_score')} Krediye Gönder</h3>
      <button class="kg-kapat p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div class="p-5 space-y-3">
      <p class="text-[11px] text-on-surface-variant bg-surface-container-low rounded-lg p-2.5">${kacis([a.marka, a.model, a.yil].filter(Boolean).join(' '))} · ${kacis(aracEtiket(a))} — müşteri ön bilgisi girin, kredi birimi kuyruktan devam eder.</p>
      ${musteriAramaKutusu('kg', inp)}
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Müşteri Ad Soyad *</label><input id="kgAd" class="${inp}" /></div>
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Telefon *</label><input id="kgTel" inputmode="tel" maxlength="11" placeholder="10 haneli, başa 0 koymadan — 5395441254" class="${inp}" /></div>
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">TC Kimlik No *</label><input id="kgTc" inputmode="numeric" maxlength="11" placeholder="11 hane — sadece kredi birimi görür" class="${inp}" /></div>
      ${/* ⚠️ ANLAŞILAN TUTAR — kredi birimine giden rakam BUDUR, liste fiyatı
            DEĞİL. Faz 1 zincir testinde yakalandı: başvuruya liste fiyatı
            (1.050.000) yazılıyordu, oysa anlaşılan 1.040.000'di; banka
            10.000 fazla tutarla çalışacaktı.
            Göksenil (7 Ağu 2026): "kredinin liste fiyatını görmesine gerek
            yok, anlaşılan rakamı görsünler… otomatik liste fiyat yazılı
            gelir, orayı değiştirmek isterse danışman değiştirir kaydeder."
            Ön dolgu: sipariş varsa anlaşılan tutar, yoksa liste fiyatı. */''}
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Anlaşılan Tutar (₺) *</label>
        <input id="kgTutar" inputmode="numeric" class="para-gir ${inp}" />
        <div class="text-[10px] text-on-surface-variant mt-1">Kredi birimi bu tutarla çalışır. Liste fiyatı ile aynıysa da girilmeli.</div></div>
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Açıklama</label><textarea id="kgNot" rows="2" placeholder="Peşinat durumu, özel not…" class="${inp}"></textarea></div>
      <div id="kgDurum" class="text-label-md"></div>
    </div>
    <div class="flex justify-end gap-2 px-5 pb-5"><button class="kg-kapat px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="kgGonder" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('send', 'text-[18px]')} Kredi Kuyruğuna Gönder</button></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelectorAll('.kg-kapat').forEach(x => x.addEventListener('click', kapat))
  // Ön dolgu: AÇIK SİPARİŞ varsa anlaşılan tutar, yoksa liste fiyatı.
  // Danışman değiştirip gönderebilir; kredi birimine giden rakam budur.
  const onTutar = Number(sipRezAktif?.anlasilan_tutar) || Number(a._fiyat) || null
  if (onTutar) {
    const t = ov.querySelector('#kgTutar')
    t.value = Number(onTutar).toLocaleString('tr-TR')
  }
  const kgMusteriId = musteriAramaBagla(ov, 'kg', m => {
    ov.querySelector('#kgAd').value = buyuk(m.ad_soyad || '')
    if (m.telefon && m.telefon !== '-') ov.querySelector('#kgTel').value = String(m.telefon).replace(/\D/g, '').slice(-10)
    if (m.kimlik) ov.querySelector('#kgTc').value = m.kimlik
  })
  ov.querySelector('#kgGonder').addEventListener('click', async () => {
    const durum = ov.querySelector('#kgDurum')
    const ad = ov.querySelector('#kgAd').value.trim(); if (!ad || !ad.includes(' ')) { durum.innerHTML = '<span class="text-error">Ad ve soyad zorunlu.</span>'; return }
    const tel = ov.querySelector('#kgTel').value.trim(); if (!tel) { durum.innerHTML = '<span class="text-error">Telefon zorunlu.</span>'; return }
    const tc = ov.querySelector('#kgTc').value.trim(); if (!/^\d{11}$/.test(tc)) { durum.innerHTML = '<span class="text-error">TC Kimlik No zorunlu (11 hane).</span>'; return }
    const tutar = Number(String(ov.querySelector('#kgTutar').value || '').replace(/\D/g, ''))
    if (!tutar) { durum.innerHTML = '<span class="text-error">Anlaşılan tutar zorunlu — kredi birimi bu rakamla çalışır.</span>'; return }
    const btn = ov.querySelector('#kgGonder'); btn.disabled = true; durum.textContent = 'Gönderiliyor…'
    const satisDan = (benim?.rol === 'danisman' || benim?.rol === 'santral') ? benim.id : null
    const { data: basvuruId, error } = await supabase.rpc('kredi_basvuru_olustur', {
      p_musteri: ad.toLocaleUpperCase('tr'), p_telefon: telSifirla(tel), p_tckn: tc,
      p_stok_ref: String(a.id),
      // ⚠️ ANLAŞILAN tutar yazılır, `a._fiyat` (liste) DEĞİL.
      p_arac_ozet: [a.marka, a.model, a.yil].filter(Boolean).join(' ') + ' · ' + fmtPara(tutar),
      p_plaka: a.plaka || null, p_talep_id: null,
      p_aciklama: ov.querySelector('#kgNot').value.trim() || null, p_satis_danismani: satisDan,
      p_musteri_id: kgMusteriId() || null,          // sql/128 — kredi artık müşteriye bağlı
    })
    if (error) { dbHata('kredi başvuru', error); btn.disabled = false; durum.innerHTML = '<span class="text-error">Hata: ' + kacis(error.message) + '</span>'; return }
    // Tutarı kolona da yaz (sql/172) — özet metin ekrana, kolon rapora.
    // ⚠️ RPC imzası DEĞİŞTİRİLMEDİ: iki aşırı yükleme var, parametre eklemek
    //    PostgREST'te belirsizlik hatası üretirdi. Başarısız olursa özet
    //    metin yine doğru; sessiz geçmesin diye loglanıyor.
    if (basvuruId) {
      const { error: te } = await supabase.from('kredi_basvurulari')
        .update({ anlasilan_tutar: tutar }).eq('id', basvuruId).select('id')
      if (te) dbHata('kredi anlaşılan tutar', te)
    }
    // GERİ YAZMA — kutuda girilen telefon/TCKN müşteri kütüğüne işlensin
    if (kgMusteriId()) {
      const { musteriGeriYaz } = await import('./musteri-sec.js')
      await musteriGeriYaz(kgMusteriId(), { telefon: tel, kimlik: tc })
    }
    durum.innerHTML = `<span class="text-secondary flex items-center gap-1">${mat('check_circle', 'text-[16px]')} Kredi kuyruğuna gönderildi.</span>`
    setTimeout(kapat, 1200)
  })
}

// ---------- G3: YAYINLA ----------
// Göksenil: "araç kartında sadece Fotoğraflar Yükle butonunun yanına Yayınla
// butonu ekleyeceğiz, bilgi işlem personeli oradan girecek."
// ⚠️ Ayrı bir "İlan" kutusu YOK (denendi, istenmedi). İlanın durumu, yenileme
// ve yayından kaldırma işlemleri İLANLARIMIZ sayfasında — günlük operasyon
// orada yapılıyor, araç kartı yalnızca GİRİŞ NOKTASI.
// ⚠️ Parametre ALMAZ: galeriHtml() parametresiz bir fonksiyon ve buton oradan
// çiziliyor; `a` orada tanımsız kalıyordu. Modül düzeyindeki sonArac kullanılır.
function yayinlaButonu() {
  if (!ilanYonetir(benim) || !sonArac) return ''
  const aktif = (sonArac._ilanlar || []).filter(i => i.durum === 'YAYINDA').length
  return `<button id="yayinlaBtn" class="cursor-pointer bg-surface-container-low border border-primary/40 text-primary px-2.5 py-1 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:bg-primary/5" title="İlan yayınla (ilan numarasını gir)">
    ${mat('campaign', 'text-[16px]')} Yayınla${aktif ? ` <span class="text-[10px] bg-primary text-on-primary px-1.5 rounded-full">${aktif}</span>` : ''}
  </button>`
}

// Sahibinden ilan görseli (sql/107). Yayınla'nın komşusu: ikisi de yayın
// hazırlığının parçası ve ikisini de bilgi işlem yapıyor.
function gorselButonu() {
  if (!ilanYonetir(benim) || !sonArac) return ''
  const d = sonArac._gorselDurum
  const rozet = d === 'ESKI' ? ' <span class="text-[10px] bg-error text-on-error px-1.5 rounded-full">eski</span>'
              : d === 'HAZIR' ? ' <span class="text-[10px] text-[#1a7a3d]">✓</span>' : ''
  return `<button id="gorselBtn" class="cursor-pointer bg-surface-container-low border border-outline-variant text-on-surface px-2.5 py-1 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:bg-surface-container" title="Sahibinden ilan görseli üret">
    ${mat('image', 'text-[16px]')} Görsel${rozet}
  </button>`
}

// Yayınla penceresi — kanal, ilan no, fiyat, danışman önerisi, kalite kontrol
async function yayinlaAc(a) {
  const [kanalR, maddeR, oneriR, gorselR] = await Promise.all([
    supabase.from('ilan_kanallari').select('kod, ad, aktif').eq('aktif', true).order('sira'),
    supabase.from('ilan_kalite_maddeleri').select('kod, ad, zorunlu').eq('aktif', true).order('sira'),
    // Adil atama önerisi — hesap SUNUCUDA (sql/105). İstemcide tekrarlanmaz.
    supabase.rpc('ilan_onerilen_danisman', { p_fiyat: a._fiyat ?? null }),
    // Göksenil (11 Ağu 2026): "yayınlaya tıkladığımda bana sahibinden için
    //   ürettiğimiz görselin gelmesi gerekiyor, aynı şekilde arabam.com'da
    //   yayınlanacak metin otomatik gelmesi gerek."
    // ⚠️ İKİSİ DE ZATEN ÜRETİLİYOR (sql/107, ilan_gorselleri): gorsel_url ve
    //   ilan_metni dolu. Eksik olan tek şey burada GÖSTERİLMELERİYDİ —
    //   personel görseli/metni ayrı ekrandan alıp geliyordu.
    supabase.from('ilan_gorselleri')
      .select('gorsel_url, ilan_metni, durum, son_uretim')
      .eq('arac_id', a.id).maybeSingle(),
  ])
  if (gorselR?.error) dbHata('ilan görseli', gorselR.error)
  const gorsel = gorselR?.data || null
  if (kanalR.error) { dbHata('ilan kanallari', kanalR.error); return }
  if (maddeR.error) console.error('[db] kalite maddeleri', maddeR.error)
  if (oneriR.error) console.error('[db] atama onerisi', oneriR.error)
  const kanallar = kanalR.data || []
  const maddeler = maddeR.data || []
  const oneri = oneriR.data || []
  // ⚠️ Burada `uyariGoster(...)` çağrılıyordu — bu dosyada BÖYLE BİR FONKSİYON
  //    YOK, import da edilmemiş. Aktif ilan kanalı olmayan araçta "İlan Yayınla"
  //    ReferenceError atıp sessizce hiçbir şey açmıyordu. (7 Ağu 2026 taraması)
  if (!kanallar.length) { alert('Aktif ilan kanalı yok. Kanalları bilgi işlem tanımlar.'); return }

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[88vh]">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('campaign', 'text-[18px]')} İlan Yayınla</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="overflow-y-auto p-4 space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">Kanal</label>
            <select id="ykKanal" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white">
              ${kanallar.map(k => `<option value="${kacis(k.kod)}">${kacis(k.ad)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">İlan No <span class="text-error">*</span></label>
            <input id="ykNo" type="text" autocomplete="off" placeholder="örn. 1234567890" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-label-sm text-on-surface-variant mb-1">İlan Bağlantısı (opsiyonel)</label>
            <input id="ykUrl" type="url" autocomplete="off" placeholder="https://..." class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
          </div>
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">İlandaki Fiyat</label>
            <input id="ykFiyat" type="text" inputmode="numeric" value="${a._fiyat ?? ''}" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
            <p class="text-[11px] text-on-surface-variant mt-1">CRM fiyatı: <b>${a._fiyat != null ? fmtPara(a._fiyat) : '—'}</b></p>
          </div>
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">İlan Danışmanı</label>
            <select id="ykDanisman" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white">
              ${oneri.map((o, i) => `<option value="${o.danisman_id}" ${i === 0 ? 'selected' : ''}>${kacis(o.ad_soyad)} — bu baremde ${o.barem_adet}, toplam ${o.toplam_adet}${i === 0 ? '  ⭐ önerilen' : ''}</option>`).join('')}
            </select>
            ${oneri.length ? `<p class="text-[11px] text-secondary font-semibold mt-1">${mat('auto_awesome', 'text-[13px] align-middle')} Öneri: bu baremde en az ilanı olan danışman. İstersen değiştir.</p>` : '<p class="text-[11px] text-error mt-1">Danışman listesi boş.</p>'}
          </div>
          ${/* Göksenil (11 Ağu 2026): "ilan bitiş tarihini şimdilik geçici olarak
                aç, stoktaki eski araçları kaydediyorum, bitiş tarihlerini
                girebileyim ki ilan süresi bittiğinde bana uyarı versin."
              ⚠️ BOŞ BIRAKILIRSA sunucu hesaplar (ilan_sonraki_yenileme, sql/105
                — pazar→pazartesi + saat kuralı). Elle giriş yalnız GEÇMİŞTEN
                taşınan ilanlar için; yeni ilanlarda dokunulmaz. */''}
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">İlan Bitiş / Yenileme Tarihi</label>
            <input id="ykYenileme" type="date" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
            <p class="text-[11px] text-on-surface-variant mt-1">Boş bırakırsan sistem hesaplar. Eski ilanları taşırken tarihi elle gir — süre dolunca uyarı bu tarihe göre gelir.</p>
          </div>
        </div>
        ${/* Sahibinden görseli + arabam metni.
              ⚠️ ÜRETİLMEMİŞSE DE BÖLÜM GÖSTERİLİR. Önce "kayıt yoksa gizle"
                 yazmıştım; o zaman kullanıcı görselin NEDEN gelmediğini
                 bilemez, boş ekrana bakar. Bu projede bugün üç kez aynı sınıf
                 hata çıktı (doğru davranış + sessiz/eksik anlatım). */''}
        <div class="rounded-xl border border-outline-variant overflow-hidden">
          <div class="px-3 py-2 bg-surface-container flex items-center justify-between gap-2">
            <span class="text-label-md font-bold text-on-surface flex items-center gap-1.5">${mat('auto_awesome', 'text-[16px] text-primary')} Yayın Malzemesi</span>
            <span class="text-[11px] text-on-surface-variant">${gorsel?.son_uretim ? fmtTarih(gorsel.son_uretim) : ''}${gorsel?.durum === 'ESKI' ? ' · <b class="text-error">araç bilgisi değişti, yenile</b>' : ''}</span>
          </div>
          <div class="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            ${gorsel?.gorsel_url ? `<div>
              <div class="text-[11px] font-bold text-on-surface-variant uppercase mb-1">Sahibinden Görseli</div>
              <a href="${kacis(gorsel.gorsel_url)}" target="_blank" rel="noopener" class="block rounded-lg overflow-hidden border border-outline-variant hover:opacity-90">
                <img src="${kacis(gorsel.gorsel_url)}" alt="ilan görseli" class="w-full h-36 object-cover" onerror="this.parentElement.innerHTML='<div class=\\'p-3 text-[11px] text-error\\'>Görsel açılamadı</div>'" />
              </a>
              <a href="${kacis(gorsel.gorsel_url)}" download target="_blank" rel="noopener" class="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">${mat('download', 'text-[14px]')} İndir</a>
            </div>` : `<div class="text-[11px] text-on-surface-variant">Görsel üretilmemiş — <b>Görsel</b> düğmesinden üretin.</div>`}
            ${gorsel?.ilan_metni ? `<div class="flex flex-col min-h-0">
              <div class="text-[11px] font-bold text-on-surface-variant uppercase mb-1">arabam.com İlan Metni</div>
              <textarea id="ykMetin" readonly class="w-full h-36 border border-outline-variant rounded-lg px-2 py-1.5 text-[12px] bg-surface-container-lowest resize-none">${kacis(gorsel.ilan_metni)}</textarea>
              <button type="button" id="ykMetinKopya" class="mt-1 self-start inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">${mat('content_copy', 'text-[14px]')} Metni kopyala</button>
            </div>` : `<div class="text-[11px] text-on-surface-variant">İlan metni üretilmemiş — <b>Görsel</b> düğmesinden üretin.</div>`}
          </div>
        </div>
        <div>
          <h4 class="font-bold text-on-surface text-body-md mb-2 flex items-center gap-1.5">${mat('fact_check', 'text-[16px]')} Kalite Kontrol</h4>
          <div id="ykMaddeler" class="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            ${maddeler.map(m => `<label class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-container cursor-pointer">
              <input type="checkbox" data-kod="${kacis(m.kod)}" data-zorunlu="${m.zorunlu ? 1 : 0}" class="w-4 h-4 accent-[#5f1818]" />
              <span class="text-body-sm">${kacis(m.ad)}${m.zorunlu ? ' <span class="text-error">*</span>' : ''}</span>
            </label>`).join('')}
          </div>
          <p class="text-[11px] text-on-surface-variant mt-1">Zorunlu maddeler işaretlenmeden yayınlanamaz. Kimin onayladığı kayda geçer; yönetici sonradan geri çekebilir.</p>
        </div>
      </div>
      <div class="p-4 border-t border-outline-variant flex items-center justify-between gap-2">
        <span id="ykDurum" class="text-label-sm font-bold"></span>
        <div class="flex gap-2">
          <button data-kapat class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-semibold hover:bg-surface-container">Vazgeç</button>
          <button id="ykKaydet" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-body-sm font-bold">Yayınla</button>
        </div>
      </div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  document.addEventListener('keydown', esc)

  // arabam metnini panoya al — personel ilan sayfasına yapıştırsın diye.
  ov.querySelector('#ykMetinKopya')?.addEventListener('click', async e => {
    const ta = ov.querySelector('#ykMetin'); if (!ta) return
    if (await panoyaYaz(ta.value)) {
      e.currentTarget.innerHTML = `${mat('check', 'text-[14px]')} Kopyalandı`
    } else {
      // Pano izni yoksa sessiz kalma — seçili bırak, kullanıcı Ctrl+C yapsın.
      ta.removeAttribute('readonly'); ta.select(); ta.setAttribute('readonly', '')
      e.currentTarget.innerHTML = `${mat('content_copy', 'text-[14px]')} Metin seçildi — Ctrl+C`
    }
  })

  ov.querySelector('#ykKaydet').addEventListener('click', async () => {
    const durum = ov.querySelector('#ykDurum'), btn = ov.querySelector('#ykKaydet')
    const no = ov.querySelector('#ykNo').value.trim()
    if (!no) { durum.className = 'text-label-sm font-bold text-error'; durum.textContent = 'İlan numarası zorunlu.'; return }
    const eksik = [...ov.querySelectorAll('#ykMaddeler input[data-zorunlu="1"]')].filter(k => !k.checked)
    if (eksik.length) {
      durum.className = 'text-label-sm font-bold text-error'
      durum.textContent = `${eksik.length} zorunlu kalite maddesi işaretlenmedi.`
      return
    }
    btn.disabled = true; durum.className = 'text-label-sm font-bold text-on-surface-variant'; durum.textContent = 'Kaydediliyor…'

    const maddeObj = {}
    ov.querySelectorAll('#ykMaddeler input[data-kod]').forEach(k => { maddeObj[k.dataset.kod] = k.checked })
    const fiyatHam = ov.querySelector('#ykFiyat').value.replace(/[^\d]/g, '')

    // 1) Kalite kontrol kaydı (kim onayladı)
    const { error: ke } = await supabase.from('ilan_kalite_kontrol').insert({
      arac_id: a.id, maddeler: maddeObj, onaylayan_id: benim?.id || null,
    })
    if (ke) { dbHata('kalite kontrol', ke); durum.className = 'text-label-sm font-bold text-error'; durum.textContent = 'Kalite kaydı yazılamadı: ' + ke.message; btn.disabled = false; return }

    // 2) Yenileme tarihi: ELLE GİRİLDİYSE o, yoksa SUNUCU hesaplar.
    //    Sunucu kuralı (pazar→pazartesi + saat, sql/105) istemcide
    //    TEKRARLANMAZ — iki farklı takvim oluşurdu.
    //    Elle giriş eski ilanları taşımak için (Göksenil, 11 Ağu 2026).
    const elleTarih = (ov.querySelector('#ykYenileme')?.value || '').trim()
    let yen = null
    if (elleTarih) {
      yen = elleTarih                       // <input type="date"> → YYYY-MM-DD
    } else {
      const { data: hesap, error: ye } = await supabase.rpc('ilan_sonraki_yenileme')
      if (ye) console.error('[db] sonraki yenileme', ye)
      yen = hesap || null
    }

    // 3) İlan
    const { data: ilanD, error: ie } = await supabase.from('ilanlar').insert({
      arac_id: a.id,
      kanal_kodu: ov.querySelector('#ykKanal').value,
      danisman_id: ov.querySelector('#ykDanisman').value || null,
      durum: 'YAYINDA',
      ilan_no: no,
      ilan_url: ov.querySelector('#ykUrl').value.trim() || null,
      ilan_fiyati: fiyatHam ? Number(fiyatHam) : null,
      yenileme_tarihi: yen || null,
      olusturan_id: benim?.id || null,
    }).select('id')
    if (ie) {
      dbHata('ilan yayinla', ie)
      durum.className = 'text-label-sm font-bold text-error'
      durum.textContent = /duplicate|unique/i.test(ie.message)
        ? 'Bu araç bu kanalda zaten yayında.' : 'Yayınlanamadı: ' + ie.message
      btn.disabled = false; return
    }
    // §5.1 — PostgREST yetki yoksa 0 satır yazıp HATA VERMEZ
    if (!ilanD?.length) {
      durum.className = 'text-label-sm font-bold text-error'
      durum.textContent = 'Yayınlanamadı — ilan yayınlama yetkiniz yok.'
      btn.disabled = false; return
    }

    // 4) Hareket kaydı (append-only iz)
    await supabase.from('ilan_hareketleri').insert({
      ilan_id: ilanD[0].id, tip: 'YAYIN', yeni_deger: no,
      aciklama: 'İlan yayınlandı', yapan_id: benim?.id || null,
    })
    kapat()
    await yukle()
  })
}


function fiyatKutuHtml(a, maliyet, kzYuzde, alisFiyati, masrafToplam) {
  const satir = (e, d, cls) => `<div class="flex items-center justify-between py-2 border-b border-outline-variant/50 last:border-0"><span class="text-on-surface-variant text-label-md">${e}</span><span class="font-bold ${cls || 'text-on-surface'}">${d}</span></div>`
  // İNDİRİM ROZETİ — referans fiyat MEVZUATA GÖRE sunucuda hesaplanır
  // (sql/101: penceredeki EN DÜŞÜK uygulanan fiyat). İstemcide "bir önceki
  // fiyat" kısayolu yazmak yanıltıcı indirim gösterirdi.
  const ind = a._indirim
  const guncelDeger = a._fiyat != null
    ? (ind ? `<span class="line-through text-on-surface-variant text-label-md font-semibold mr-1.5">${fmtPara(ind.eski_fiyat)}</span>${fmtPara(a._fiyat)}` : fmtPara(a._fiyat))
    : (a.fiyatlama_durumu === 'BEKLIYOR' ? 'Fiyat bekliyor' : '—')
  let govde = satir('Güncel Satış Fiyatı', guncelDeger, 'text-primary text-title-md')
  if (ind) {
    govde += `<div class="mt-1 mb-2 flex items-center gap-2 flex-wrap">
      <span class="inline-block px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] border border-[#10B981]/30 text-[11px] font-bold">${fmtPara(ind.indirim_tutari)} indirim (%${ind.indirim_yuzde})</span>
      ${ind.referans_gun ? `<span class="text-[10px] text-on-surface-variant">Referans: son ${ind.referans_gun} günün en düşük uygulanan fiyatı${ind.referans_tarih ? ' · ' + fmtTarihKisa(ind.referans_tarih) : ''}</span>` : ''}
    </div>`
  }
  govde += satir('Kasko Bedeli (TSB)', krediKasko != null ? fmtPara(krediKasko) : '—')
  // #4: Kâr/Zarar (ve maliyet) YALNIZ master veya yönetici (kz_goruntule) görür.
  //     RLS zaten maliyet'i sınırlar; bu UI kapısı "hiçbir yerde göstermeyiz" kuralını garantiler.
  if (maliyet != null && kzGorebilir()) {
    // Göksenil, 13 Ağu 2026: "master admin aracın alış fiyatını da görmeli
    //   fiyat tagında." Maliyet zaten alış+masraf toplamıydı ama alışın kendisi
    //   hiçbir yerde görünmüyordu. Kırılım sql/199 ile v_arac_maliyet'ten gelir
    //   — istemcide toplama/çıkarma YAPILMAZ, üç sayı da aynı satırdan okunur.
    // ⚠️ alis_fiyati NULL = alış kaydı hiç girilmemiş. 0 ₺ yazmak yerine bunu
    //   söyle; 13 araçta (131'in) alış girilmemiş durumda (13 Ağu ölçümü).
    // KONSİNYE rozeti: bu araç bizim değil, alış = araç sahibine ödenecek
    // tutar. Rozet olmadan 2.900.000'lik "alış" peşin ödenmiş sanılıyor
    // (Göksenil, 20 Ağu 2026).
    const konRozet = konsinyeMi(a)
      ? ` <span class="ml-1 px-1.5 py-0.5 rounded bg-secondary-container/60 text-secondary text-[10px] font-bold align-middle">Konsinye</span>`
      : ''
    govde += satir('Alış Fiyatı' + konRozet, alisFiyati != null ? fmtPara(alisFiyati) : 'girilmemiş',
      alisFiyati != null ? 'text-on-surface' : 'text-amber-700')
    // Konsinyede karar sayısı marjdır (komisyon), maliyet üzerinden K/Z değil.
    if (konsinyeMi(a) && alisFiyati != null && a._fiyat != null) {
      govde += satir('Marj (satış − alış)', marjMetni(Number(a._fiyat), Number(alisFiyati)))
    }
    if (masrafToplam != null && Number(masrafToplam) !== 0) {
      govde += satir('Masraf', fmtPara(masrafToplam))
    }
    govde += satir('Maliyet (alış + masraf)', fmtPara(maliyet))
    // B-7 (7 Ağu 2026): yüzdenin TABANI ekranlar arasında farklı —
    //   burada  kâr/MALİYET  (f_kz_yuzde),  Fiyatlama Merkezi'nde  kâr/SATIŞ.
    //   Aynı araç 902.500 maliyet / 1.050.000 satışta %16,34 ve %14,05 gösteriyordu.
    //   TL tutarı iki tabana da bağlı değil; tartışmayı bitiren sayı bu, o yüzden
    //   yüzdenin ÖNÜNE yazılıyor. Taban hizalaması (4 nesne: f_kz_yuzde +
    //   v_satis_liste + v_arsiv_satis_liste + v_satis_birlesik) Göksenil kararıyla
    //   sunum sonrasına park edildi → sql/173.
    if (kzYuzde != null) {
      const kar = Number(kzYuzde) >= 0
      const karTl = a._fiyat != null ? Number(a._fiyat) - Number(maliyet) : null
      const deger = (karTl != null ? fmtPara(karTl) + ' · ' : '') + `%${kzYuzde}`
      govde += satir('Kâr / Zarar', deger, kar ? 'text-green-700' : 'text-error')
      govde += `<p class="text-[11px] text-on-surface-variant -mt-1">Yüzde maliyet üzerinden. Fiyatlama Merkezi satış üzerinden hesaplar.</p>`
    }
    govde += `<p class="text-[11px] text-on-surface-variant mt-2">${mat('lock', 'text-[13px] align-middle')} Maliyet/K-Z yalnızca master/yönetici.</p>`
  } else {
    govde += `<p class="text-[11px] text-on-surface-variant mt-2">Maliyet ve K/Z gizli (yalnız master/yönetici).</p>`
  }
  govde += fiyatGecmisHtml(a)
  govde += alisGecmisHtml(a)
  return kutu('Fiyat', 'payments', govde, fiyatRevizeButonu(a))
}

// ---------- FİYAT REVİZYONU (araç kartından) ----------
// Göksenil, 1 Ağu 2026: "araç kartında fiyat revizyonu yapabilmeli bilgi işlem
// personeli." Kapı `fiyatYonetir` (yetki.js) — DB'deki is_fiyat_yetkili()
// aynası: master · rol='bilgi_islem' · 'fiyat_yonet' yetkisi (İsmail Bey).
// ⚠️ Burada eskiden `fiyatRevizeder` adıyla AYNI mantığın ikinci kopyası
//   duruyordu; yetki.js'ten import edilen `fiyatYonetir` zaten bu sayfada
//   kullanılıyordu. Kopya silindi (CLAUDE.md §4 — en sık tekrarlanan hata).
// ⚠️ Araç HENÜZ FİYATLANMADIYSA revizyon YOK — ilk fiyat İsmail Bey'in
//   Fiyatlama Merkezi'ndeki işi. Burası yalnız REVİZE.

// KONSİNYE — araç bizim değil; "alış fiyatı" araç sahibiyle mutabık kalınan
// tutar. Satışı pazarlıkta düşürünce sahibinin tutarı da yeniden konuşulur,
// yoksa fark tamamen galeriden gider (35YFS40: satış 3.030.000 → 3.000.000
// revize edilmiş, alış 2.900.000'de kalmış → marj 130.000'den 100.000'e
// inmiş). Göksenil, 20 Ağu 2026.
//
// ⚠️ Alış fiyatını yazan TEK arayüz yolu Fiyatlama Merkezi'ydi ve o kuyruk
//   `fiyatlama_durumu='BEKLIYOR'` ile süzülüyor — araç fiyatlanınca kuyruktan
//   düşüyor ve alışa ulaşan hiçbir form kalmıyordu. Ölçüm: audit_log'da
//   alis_fiyati değişen 175 kaydın 175'inde de eski değer NULL; yani bugüne
//   kadar TEK BİR alış revizyonu yapılamamış.
// ⚠️ Yalnız KONSİNYE (Göksenil kararı). Peşin alım / takas / ihalede alış
//   zaten ödenmiş; oynatmak geçmişe dönük K/Z rakamlarını sessizce bozar.
// ⚠️ İki alan BAĞIMSIZ (Göksenil kararı): satış değişince alış kendiliğinden
//   kaymaz, sistem yalnız aradaki marjı canlı gösterir.
const konsinyeMi = a => (a?._alis?.alis_sekli || '') === 'KONSINYE'
// Alış alanı, alış satırı OKUNABİLDİĞİNDE çizilir. Okuma ve yazma aynı RLS
// kümesinden geliyor (arac_alislar_finans / _kabul_*), o yüzden ayrı bir
// istemci kapısı yazılmıyor — yine de yazma sonrası 0-satır kontrolü var (§5.1).
const alisRevizeEdilir = a => fiyatYonetir(benim) && konsinyeMi(a) && !!a?._alis?.id

function fiyatRevizeButonu(a) {
  if (!fiyatYonetir(benim) || a._fiyat == null) return ''
  return `<button id="fiyatRevizeBtn" class="cursor-pointer bg-surface-container-low border border-primary/40 text-primary px-2.5 py-1 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:bg-primary/5" title="Satış fiyatını revize et">
    ${mat('edit', 'text-[16px]')} Revize
  </button>`
}

// Marj şeridi — konsinyede tek anlamlı sayı bu. Yüzde SATIŞ üzerinden
// (komisyon mantığı); maliyet tabanı burada yanıltıcı olurdu.
function marjMetni(satis, alis) {
  if (!(satis > 0) || !(alis > 0)) return '<span class="text-on-surface-variant">Marj: —</span>'
  const fark = satis - alis
  const yuzde = (fark / satis) * 100
  const cls = fark > 0 ? 'text-green-700' : fark < 0 ? 'text-error' : 'text-on-surface-variant'
  return `<span class="${cls} font-bold">Marj: ${fmtPara(fark)} · %${yuzde.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</span>`
}

function fiyatRevizeAc(a) {
  const ov = document.createElement('div')
  ov.id = 'fiyatRevizeKat'
  ov.className = 'fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4'
  const inp = 'para-gir w-full border border-outline-variant rounded-lg px-3 py-2 text-body-lg font-bold bg-white focus:border-primary focus:ring-1 focus:ring-primary'
  const alisVar = alisRevizeEdilir(a)
  const alisSimdi = a._alis?.alis_fiyati != null ? Number(a._alis.alis_fiyati) : null
  const alisBlok = alisVar ? `
      <div class="pt-3 border-t border-outline-variant">
        <label class="text-[11px] font-bold text-on-surface-variant uppercase flex items-center gap-1.5">
          ${mat('handshake', 'text-[14px]')} Alış Fiyatı (₺)
          <span class="px-1.5 py-0.5 rounded bg-secondary-container/60 text-secondary text-[10px] font-bold normal-case">Konsinye</span>
        </label>
        <input id="frAlis" class="${inp}" inputmode="numeric" value="${alisSimdi != null ? alisSimdi.toLocaleString('tr-TR') : ''}">
        <p class="text-[11px] text-on-surface-variant mt-1">Araç sahibiyle mutabık kalınan tutar. Satış fiyatından bağımsız yazılır.</p>
        <div id="frMarj" class="mt-2 rounded-lg bg-surface-container-low px-3 py-2 text-label-md">${marjMetni(a._fiyat, alisSimdi)}</div>
      </div>` : ''
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl w-full max-w-md custom-shadow overflow-hidden max-h-[92vh] overflow-y-auto" role="dialog" aria-modal="true">
    <div class="px-lg py-3 border-b border-outline-variant flex items-center justify-between">
      <h3 class="text-title-md text-primary flex items-center gap-2">${mat('payments', 'text-[20px]')} Fiyat Revizyonu</h3>
      <button class="frKapat w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center">${mat('close')}</button>
    </div>
    <div class="p-lg space-y-3">
      <p class="text-body-md text-on-surface-variant">${kacis([markaAd(a.marka), a.model].filter(Boolean).join(' '))}${aracEtiket(a) ? ' · ' + kacis(aracEtiket(a)) : ''}</p>
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Yeni Satış Fiyatı (₺)</label>
        <input id="frSatis" class="${inp}" inputmode="numeric" value="${a._fiyat != null ? Number(a._fiyat).toLocaleString('tr-TR') : ''}"></div>
      <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Minimum Satış Fiyatı (₺)</label>
        <input id="frMin" class="${inp}" inputmode="numeric" value="${a._min != null ? Number(a._min).toLocaleString('tr-TR') : ''}">
        <p class="text-[11px] text-on-surface-variant mt-1">Pazarlık tabanı. Boş bırakılabilir.</p></div>
      ${alisBlok}
      <div id="frUyari" class="text-[12px] text-error"></div>
      <div class="flex gap-2 pt-1">
        <button class="frKapat flex-1 border border-outline-variant px-4 h-11 rounded-lg text-label-md font-bold">Vazgeç</button>
        <button id="frKaydet" class="flex-1 bg-primary text-on-primary px-4 h-11 rounded-lg text-label-md font-bold flex items-center justify-center gap-1">${mat('save', 'text-[18px]')} Revizyonu Kaydet</button>
      </div>
    </div></div>`
  document.body.appendChild(ov)
  binlikInputKur()
  const kapat = () => ov.remove()
  ov.querySelectorAll('.frKapat').forEach(b => b.addEventListener('click', kapat))
  ov.addEventListener('click', e => { if (e.target === ov) kapat() })

  const sayi = v => { const t = String(v || '').replace(/[^\d]/g, ''); return t ? Number(t) : null }

  // Marj yazarken güncellensin — iki alan bağımsız olduğu için kullanıcının
  // tek geri bildirimi bu satır.
  if (alisVar) {
    const marjTazele = () => {
      const el = ov.querySelector('#frMarj'); if (!el) return
      el.innerHTML = marjMetni(sayi(ov.querySelector('#frSatis').value), sayi(ov.querySelector('#frAlis').value))
    }
    ov.querySelector('#frSatis').addEventListener('input', marjTazele)
    ov.querySelector('#frAlis').addEventListener('input', marjTazele)
  }

  ov.querySelector('#frKaydet').addEventListener('click', async () => {
    const uyariEl = ov.querySelector('#frUyari'); uyariEl.textContent = ''
    const satis = sayi(ov.querySelector('#frSatis').value)
    const min = sayi(ov.querySelector('#frMin').value)
    const alis = alisVar ? sayi(ov.querySelector('#frAlis').value) : null
    if (!satis) { uyariEl.textContent = 'Satış fiyatı zorunlu.'; return }
    if (min && min > satis) { uyariEl.textContent = 'Minimum fiyat, satış fiyatından büyük olamaz.'; return }
    if (alisVar && !alis) { uyariEl.textContent = 'Konsinyede alış fiyatı boş bırakılamaz.'; return }

    // ⚠️ Fiyat DEĞİŞMEDİYSE yeni geçmiş satırı AÇMA — mükerrer geçmiş tam
    //   böyle oluşmuştu (35NSD813'te 5 aynı satır, bkz sql/119).
    const satisDegisti = !(Number(a._fiyat) === satis && (a._min == null ? null : Number(a._min)) === min)
    const alisDegisti = alisVar && alis !== alisSimdi
    if (!satisDegisti && !alisDegisti) {
      uyariEl.textContent = 'Hiçbir şey değişmedi — yeni kayıt açılmadı.'; return
    }

    const btn = ov.querySelector('#frKaydet'); btn.disabled = true; btn.textContent = 'Kaydediliyor…'
    // ⚠️ İKİ AYRI YAZMA, TEK TRANSACTION DEĞİL. Biri tutup öbürü düşerse
    //   "kaydedildi" demek yanlış olur; hangisinin yazıldığı AYRI AYRI
    //   raporlanıyor.
    const sorun = []
    let yazilan = 0
    if (alisDegisti) {
      // .eq('id', …) — arac_id'de TEKİLLİK KISITI YOK; arac_id ile güncelleme
      // olası ikinci alış satırını da ezerdi (projedeki diğer üç yolun açığı).
      const { data, error } = await supabase.from('arac_alislar')
        .update({ alis_fiyati: alis }).eq('id', a._alis.id).select('id')
      if (error) { dbHata('alis revize', error); sorun.push('Alış: ' + error.message) }
      else if (!data || !data.length) sorun.push('Alış yazılamadı — yetkin yok (0 satır).')   // §5.1
      else yazilan++
    }
    if (satisDegisti) {
      const { data, error } = await supabase.from('arac_fiyatlar')
        .insert({ arac_id: id, satis_fiyati: satis, min_satis_fiyati: min, degistiren_danisman_id: benim.id })
        .select('id')
      if (error) { dbHata('fiyat revize', error); sorun.push('Satış: ' + error.message) }
      else if (!data || !data.length) sorun.push('Satış yazılamadı — yetkin yok (0 satır).')  // §5.1
      else yazilan++
    }
    btn.disabled = false; btn.textContent = 'Revizyonu Kaydet'
    if (sorun.length) {
      uyariEl.innerHTML = kacis(sorun.join(' · ')) + (yazilan ? '<br><b>Diğer alan kaydedildi.</b>' : '')
      if (yazilan) await yukle()
      return
    }
    kapat(); await yukle()
  })
}

// ---------- ALIŞ FİYATI GEÇMİŞİ (sql/232) ----------
// Kaynak v_arac_alis_gecmis — audit_log üzerinden. `arac_alislar` yerinde
// UPDATE edildiği için satış tarafındaki gibi sürüm satırı YOK; geçmiş
// denetim kaydından türetiliyor. (Alışı append-only'ye çevirmek altı bağımlı
// görünümü birden bozardı — gerekçe sql/232 başlığında.)
// ⚠️ Yetkisi olmayanda görünüm BOŞ döner → bölüm hiç çizilmez; burada ikinci
//   bir istemci kapısı YAZILMAZ (tek kaynak sunucudaki kapı).
// ⚠️ Yönler satış tarafıyla TERS okunur: alışta ZAM = maliyetimiz arttı
//   (kötü), İNDİRİM = azaldı (iyi). Renkler bu yüzden YON_STIL'den ayrı
//   kuruluyor; aynı haritayı paylaşsalardı ok yönü doğru, rengi ters olurdu.
const ALIS_YON_STIL = {
  INDIRIM: ['trending_down', 'text-[#047857]'],
  ZAM:     ['trending_up', 'text-[#B91C1C]'],
  ILK:     ['flag', 'text-on-surface-variant'],
  AYNI:    ['remove', 'text-on-surface-variant'],
}
function alisGecmisHtml(a) {
  const g = a._alisGecmis || []
  // Tek "ILK" satırı geçmiş değil, mevcut değerin ta kendisi — bölüm açılmaz.
  if (g.length < 2) return ''
  const satirlar = g.map(r => {
    const [ik, cls] = ALIS_YON_STIL[r.yon] || ALIS_YON_STIL.AYNI
    const fark = r.fark != null && r.yon !== 'ILK'
      ? `<span class="${cls} font-bold whitespace-nowrap">${Number(r.fark) > 0 ? '+' : ''}${fmtPara(r.fark)}</span>`
      : '<span class="text-on-surface-variant">—</span>'
    return `<div class="flex items-center gap-2 py-1.5 border-b border-outline-variant/40 last:border-0 text-[11px]">
      ${mat(ik, 'text-[14px] ' + cls)}
      <span class="text-on-surface-variant whitespace-nowrap">${fmtTarihKisa(r.tarih)}</span>
      <span class="font-bold text-on-surface whitespace-nowrap">${fmtPara(r.alis_fiyati)}</span>
      ${fark}
      <span class="text-on-surface-variant truncate ml-auto">${kacis(r.degistiren || '—')}</span>
    </div>`
  }).join('')
  return `<details class="mt-2 border-t border-outline-variant/60 pt-2">
    <summary class="cursor-pointer text-label-md font-bold text-primary flex items-center gap-1.5 select-none">
      ${mat('handshake', 'text-[16px]')} Alış Geçmişi <span class="text-on-surface-variant font-normal">(${g.length})</span>
    </summary>
    <div class="mt-2">${satirlar}</div>
  </details>`
}

// ---------- G2: FİYAT GEÇMİŞİ ----------
// Kaynak v_arac_fiyat_gecmis (sql/100). security_invoker=true olduğu için
// yetkisi olmayanda sorgu BOŞ döner → bölüm hiç çizilmez; burada ikinci bir
// yetki kontrolü YAZILMAZ (tek kaynak sunucudaki RLS).
// ⚠️ Sıralama 'sira' ile: aynı transaction'da yazılan satırlar aynı zaman
// damgasını alır (toplu fiyat), tarih tek başına sıralayamaz.
const YON_STIL = {
  INDIRIM: ['trending_down', 'text-[#047857]'],
  ZAM:     ['trending_up', 'text-[#B91C1C]'],
  ILK:     ['flag', 'text-on-surface-variant'],
  AYNI:    ['remove', 'text-on-surface-variant'],
}
function fiyatGecmisHtml(a) {
  const g = a._gecmis || []
  if (!g.length) return ''
  const satirlar = g.map(r => {
    const [ik, cls] = YON_STIL[r.yon] || YON_STIL.AYNI
    const fark = r.fark != null && r.yon !== 'ILK'
      ? `<span class="${cls} font-bold whitespace-nowrap">${Number(r.fark) > 0 ? '+' : ''}${fmtPara(r.fark)}</span>`
      : '<span class="text-on-surface-variant">—</span>'
    return `<div class="flex items-center gap-2 py-1.5 border-b border-outline-variant/40 last:border-0 text-[11px]">
      ${mat(ik, 'text-[14px] ' + cls)}
      <span class="text-on-surface-variant whitespace-nowrap">${fmtTarihKisa(r.gecerli_baslangic)}</span>
      <span class="font-bold text-on-surface whitespace-nowrap">${fmtPara(r.satis_fiyati)}</span>
      ${fark}
      <span class="text-on-surface-variant truncate ml-auto">${kacis(r.degistiren || '—')}</span>
    </div>`
  }).join('')
  return `<details class="mt-3 border-t border-outline-variant/60 pt-2">
    <summary class="cursor-pointer text-label-md font-bold text-primary flex items-center gap-1.5 select-none">
      ${mat('history', 'text-[16px]')} Fiyat Geçmişi <span class="text-on-surface-variant font-normal">(${g.length})</span>
    </summary>
    <div class="mt-2">${satirlar}</div>
  </details>`
}


// --- "Aynı tutarı en ucuz kim veriyor?" şeridi -------------------------
// Göksenil (4 Ağu 2026): "araç kartındaki simülatörde bireysel ve tüzelde
//   en ucuz hangi banka veriyorsa o altta gösterilmeli."
//
// ⚠️ Limit hesabı DEĞİŞMEDİ. Bireysel/tüzel tabanını TSB kasko bedelinden,
//   OTOSOR'u satış bedelinden alan mantık (kredi-hesap.js) aynen duruyor —
//   bu şerit onun BULDUĞU tutarı alıp 23 kurum arasında kıyaslıyor.
//   İki hesap birbirinin yerine geçmez: biri "ne kadar çıkar", öbürü
//   "en ucuz kim".
//
// OTOSOR sekmesinde şerit YOK: OTOSOR zaten tek bir kurum, kendisiyle
// kıyaslamak anlamsız.
const KREDI_TUR_ESLEME = { bireysel: 'bireysel', tuzel: 'ticari' }

function enUcuzSeridiHtml(kredi, vade) {
  const tur = KREDI_TUR_ESLEME[krediTip]
  if (!tur || !KURUM_URUNLERI.length || !(kredi > 0) || !vade) return ''
  const en = enUcuz(kurumKarsilastir(kredi, vade, KURUM_URUNLERI), tur)
  if (!en) return ''
  const bag = `kredi-hesaplama.html?tutar=${Math.round(kredi)}&vade=${vade}`
  return `<div id="enUcuzSerit" class="mt-3 rounded-xl border border-secondary/40 bg-secondary-container/30 p-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="min-w-0">
          <p class="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Bu tutarda en ucuz</p>
          <p class="text-body-md font-black text-on-surface truncate">${kacis(en.banka_ad)}${en.urun_ad ? ` <span class="font-semibold text-on-surface-variant">· ${kacis(en.urun_ad)}</span>` : ''}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-[10px] text-on-surface-variant">aylık</p>
          <p class="text-title-md font-black text-secondary leading-tight">${fmtPara(Math.round(en.taksit))}</p>
        </div>
      </div>
      <a href="${kacis(bag)}" class="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">
        ${mat('compare_arrows', 'text-[14px]')} Tüm kurumları karşılaştır</a>
    </div>`
}

// ---------- KREDİ SİMÜLATÖRÜ ----------
function krediHesapla(tip) {
  if (tip === 'otosor') return hesapOtosor(krediFiyat, krediOranlar)
  if (tip === 'bireysel') return hesapBireysel(krediFiyat, krediKasko, krediOranlar)
  return hesapTuzel(krediFiyat, krediKasko, krediOranlar)
}
function krediHtml(a) {
  const radios = KREDI_TIPLERI.map(t => `<label class="flex-1 cursor-pointer">
    <input type="radio" name="krediTip" value="${t.kod}" class="peer sr-only" ${t.kod === krediTip ? 'checked' : ''}>
    <span class="block text-center px-2 py-2 rounded-lg border border-outline-variant text-label-md font-bold text-on-surface-variant peer-checked:bg-primary peer-checked:text-on-primary peer-checked:border-primary transition-all">${kacis(t.ad)}</span>
  </label>`).join('')
  const govde = `<div class="flex gap-2 mb-4">${radios}</div>
    <div class="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] text-amber-800 flex items-center gap-1">${mat('warning', 'text-[14px]')} Taslak formüller — sayıları onaylaman gerekiyor.</div>
    <div id="krediGovde"></div>`
  return kutu('Kredi Simülatörü', 'credit_score', govde)
}
function vadeSecenekler() {
  if (krediTip === 'tuzel') return VADELER_TUZEL   // 12/24/36/48/60 — tıklanınca taksit değişir
  const max = otosorVade(krediFiyat)
  return [12, 24, 36].filter(v => v <= max)
}
function mesajKutu(ik, metin, cls) { return `<div class="text-center py-6 ${cls || 'text-on-surface-variant'}">${mat(ik, 'text-3xl opacity-30')}<p class="mt-2 text-body-md">${kacis(metin)}</p></div>` }

function krediGovdeCiz() {
  const el = document.getElementById('krediGovde'); if (!el) return
  const r = krediHesapla(krediTip)
  if (r.durum === 'FIYATLA') { el.innerHTML = mesajKutu('sell', 'Araç fiyatlanınca kredi hesaplanır.'); return }
  if (r.durum === 'KASKO_YOK') { el.innerHTML = mesajKutu('report', (r.uyari || 'TSB kasko bedeli yok') + ' — bu kredi türü kasko bedeline bağlı.'); return }
  if (r.durum === 'CIKMAZ') { el.innerHTML = `<div class="text-center py-6 text-error"><p class="font-bold">Kredi çıkmaz</p><p class="text-label-md text-on-surface-variant mt-1">${kacis(r.uyari || '')}</p></div>`; return }
  el._oran = r.oran; el._maxKredi = r.maxKredi; el._uyari = r.uyari || ''
  el._taksitSabit = !!r.taksitSabit; el._taksitTabani = r.taksitTabani   // tüzel: taksit peşinat kaydırınca değişmez
  if (el._kredi == null) el._kredi = r.maxKredi
  if (el._vade == null || !vadeSecenekler().includes(el._vade)) el._vade = r.vade
  krediCiz()
}

// Tek render fonksiyonu — her yeniden çizimde tam kurar ve olayları bağlar
function krediCiz() {
  const el = document.getElementById('krediGovde'); if (!el) return
  const oran = el._oran, vade = el._vade, maxKredi = el._maxKredi
  const h = yenidenHesapla(oran, vade, krediFiyat, el._kredi, maxKredi)
  el._kredi = h.kredi
  if (el._taksitSabit) h.taksit = pmt(oran, vade, -el._taksitTabani)   // tüzel: sabit taksit
  const kutu3 = (id, etiket, deger, vurgu) => `<div class="rounded-xl border ${vurgu ? 'border-primary/40 bg-primary/5' : 'border-outline-variant'} p-3 text-center"><p class="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p id="${id}" class="text-title-md font-black ${vurgu ? 'text-primary' : 'text-on-surface'} leading-tight mt-0.5">${deger}</p></div>`
  el.innerHTML = `
    <div class="grid grid-cols-3 gap-2 mb-3">
      ${kutu3('kTaksit', 'Aylık Taksit', fmtPara(Math.round(h.taksit)), true)}
      ${kutu3('kKredi', 'Kredi', fmtPara(Math.round(h.kredi)))}
      ${kutu3('kPesinat', 'Peşinat', pesinatMetni(h.pesinat))}
    </div>
    <div class="space-y-3">
      <div>
        <div class="flex justify-between text-[11px] text-on-surface-variant mb-1"><span>Peşinat</span><span>${pesinatMetni(krediFiyat - maxKredi)} – ${fmtPara(krediFiyat)}</span></div>
        <input id="pesinatRange" type="range" min="${Math.round(krediFiyat - maxKredi)}" max="${Math.round(krediFiyat)}" step="1000" value="${Math.round(h.pesinat)}" class="w-full">
      </div>
      <div>
        <label class="block text-[11px] text-on-surface-variant mb-1">Hedef aylık taksit (₺) — peşinat/kredi buna göre ayarlanır</label>
        <input id="taksitHedef" inputmode="numeric" placeholder="${Math.round(h.taksit)}" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white focus:border-primary focus:ring-1 focus:ring-primary">
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] text-on-surface-variant">Vade:</span>
        ${vadeSecenekler().map(v => `<button type="button" data-vade="${v}" class="vadeBtn px-2.5 py-1 rounded-lg border text-label-sm font-bold ${v === vade ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant'}">${v} ay</button>`).join('')}
      </div>
      ${el._uyari ? `<p class="text-[11px] text-amber-700">${mat('info', 'text-[13px] align-middle')} ${kacis(el._uyari)}</p>` : ''}
    </div>
    ${enUcuzSeridiHtml(h.kredi, vade)}`
  el.querySelector('#pesinatRange').addEventListener('input', ev => { el._kredi = krediFiyat - Number(ev.target.value); krediKutuGuncelle(false) })
  el.querySelector('#taksitHedef').addEventListener('input', ev => {
    const hedef = Number((ev.target.value || '').replace(/\D/g, '')); if (!hedef) return
    el._kredi = Math.min(maxKredi, taksittenKredi(oran, vade, hedef)); krediKutuGuncelle(true)
  })
  el.querySelectorAll('.vadeBtn').forEach(b => b.addEventListener('click', () => { el._vade = Number(b.dataset.vade); krediCiz() }))
}
// Ağır yeniden-render olmadan 3 kutu (+ taksit değişince range) güncelle — kaydırma akıcı kalsın
function krediKutuGuncelle(taksitDegisti) {
  const el = document.getElementById('krediGovde'); if (!el) return
  const h = yenidenHesapla(el._oran, el._vade, krediFiyat, el._kredi, el._maxKredi)
  el._kredi = h.kredi
  if (el._taksitSabit) h.taksit = pmt(el._oran, el._vade, -el._taksitTabani)   // tüzel: sabit taksit
  const set = (id, v) => { const x = el.querySelector('#' + id); if (x) x.textContent = fmtPara(v) }
  set('kTaksit', Math.round(h.taksit)); set('kKredi', Math.round(h.kredi))
  const px = el.querySelector('#kPesinat'); if (px) px.textContent = pesinatMetni(h.pesinat)
  if (taksitDegisti) { const r = el.querySelector('#pesinatRange'); if (r) r.value = Math.round(h.pesinat) }
  // ⚠️ Şerit BU HIZLI YOLDA da tazelenmeli. Peşinat kaydırılınca kredi
  //   tutarı değişiyor; şerit güncellenmezse ekranda "1.250.000 için en
  //   ucuz" derken kutuda 900.000 yazar — sessiz tutarsızlık.
  const eski = el.querySelector('#enUcuzSerit')
  if (eski) {
    const yeniHtml = enUcuzSeridiHtml(h.kredi, el._vade)
    if (yeniHtml) eski.outerHTML = yeniHtml
    else eski.remove()
  }
}
function krediBaglaOlaylar() {
  document.querySelectorAll('input[name="krediTip"]').forEach(r => r.addEventListener('change', ev => {
    krediTip = ev.target.value
    const el = document.getElementById('krediGovde'); if (el) { el._kredi = null; el._vade = null }
    krediGovdeCiz()
  }))
  krediGovdeCiz()
}

// ---------- FOTO GALERİ (döner/hover durur/tıkla-lightbox) + yükleme/silme ----------
async function fotolariTopla(a) {
  const list = []
  // 1) DMS yüklenen fotolar (arac_fotograflari, public bucket) — silinebilir
  try {
    const { data, error } = await supabase.from('arac_fotograflari')
      .select('id, dosya_yolu, sira').eq('arac_id', a.id).order('sira').order('created_at')
    if (error) throw error
    for (const r of (data || [])) {
      const url = dsFotoUrl(r.dosya_yolu)
      list.push({ url, rowId: r.id, yol: r.dosya_yolu, sira: r.sira, silinebilir: canMedya })
    }
  } catch (e) { console.error('[db] arac_fotograflari', e) }
  // 2) SITE yayın ilanı fotoları (plaka eşleşmesi) — silinemez
  if (a.plaka) {
    try {
      const pl = trBuyuk(a.plaka)
      const { data } = await siteDb.from('araclar').select('fotolar').or(`plaka.ilike.${pl},plaka.ilike.${pl.replace(/\s/g, '')}`).limit(1)
      const csv = data?.[0]?.fotolar
      if (csv) for (const u of csv.split(',')) { const t = u.trim(); if (t) list.push({ url: t, rowId: null, yol: null, silinebilir: false }) }
    } catch (e) { console.warn('SITE foto', e) }
  }
  const gorulen = new Set()
  const tekil = list.filter(f => !gorulen.has(f.url) && gorulen.add(f.url))
  return fotoSirala_uygula(tekil, a.foto_sira)
}

// Birleşik sıra (sql/185). SİTE fotoğraflarının satır kimliği yok; sıra CRM'de
// `stok_araclar.foto_sira` içinde anahtar listesi olarak tutulur.
// ⚠️ Listede olmayan fotoğraf SONA düşer, listede olup artık gelmeyen anahtar
//   yok sayılır — site ilanı değişince sıralama bozulmasın, kaybolmasın.
function fotoAnahtar(f) { return f.rowId || f.url }
function fotoSirala_uygula(list, sira) {
  if (!Array.isArray(sira) || !sira.length) return list
  const yer = new Map(sira.map((k, i) => [k, i]))
  return list
    .map((f, i) => ({ f, i, s: yer.has(fotoAnahtar(f)) ? yer.get(fotoAnahtar(f)) : Infinity }))
    .sort((a, b) => (a.s - b.s) || (a.i - b.i))
    .map(x => x.f)
}

function yukleButonu() {
  if (!canMedya) return `<span class="text-[11px] text-on-surface-variant">${fotolar.length} foto</span>`
  return `<label class="cursor-pointer bg-primary text-on-primary px-2.5 py-1 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:opacity-90" title="Fotoğraf yükle">
    ${mat('add_photo_alternate', 'text-[16px]')} Yükle
    <input id="fotoInput" type="file" accept="image/*" multiple class="hidden">
  </label>`
}
function galeriHtml() {
  if (!fotolar.length) {
    const bos = `<div class="aspect-[4/3] rounded-xl bg-surface-container flex flex-col items-center justify-center text-on-surface-variant">${mat('no_photography', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">Fotoğraf yok</p>${canMedya ? '<p class="text-[11px]">Yüklemek için “Yükle”ye bas.</p>' : '<p class="text-[11px]">Araç yayına çıkınca ilan fotoğrafları görünür.</p>'}</div>`
    return kutu('Fotoğraflar', 'photo_library', `${bos}<div id="fotoDurum" class="text-[11px] text-on-surface-variant mt-2 text-center"></div>`, `<div class="flex items-center gap-2">${gorselButonu()}${yayinlaButonu()}${yukleButonu()}</div>`)
  }
  const nokta = fotolar.map((_, i) => `<button data-fi="${i}" class="fnokta w-2 h-2 rounded-full ${i === 0 ? 'bg-primary' : 'bg-on-surface-variant/30'}"></button>`).join('')
  const govde = `<div id="galeri" class="relative aspect-[4/3] rounded-xl overflow-hidden bg-black cursor-zoom-in group">
      <img id="galeriImg" src="${kacis(fotolar[0].url)}" alt="" class="w-full h-full object-contain" onerror="this.style.opacity=.2">
      <button id="galeriPrev" class="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">${mat('chevron_left')}</button>
      <button id="galeriNext" class="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">${mat('chevron_right')}</button>
      <div class="absolute top-1 right-2 bg-black/50 text-white text-[11px] px-2 py-0.5 rounded-full"><span id="galeriSayac">1</span>/${fotolar.length}</div>
      ${canMedya ? `<button id="fotoSil" class="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-error/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition" title="Bu fotoğrafı sil">${mat('delete', 'text-[18px]')}</button>` : ''}
    </div>
    <div id="galeriNokta" class="flex justify-center gap-1.5 mt-2">${nokta}</div>
    ${siralamaSeridi()}
    <div id="fotoDurum" class="text-[11px] text-on-surface-variant mt-1 text-center"></div>`
  return kutu('Fotoğraflar', 'photo_library', govde, `<div class="flex items-center gap-2">${gorselButonu()}${yayinlaButonu()}${yukleButonu()}</div>`)
}
// ---------- FOTO SIRALAMA (yalnız bilgi işlem) ----------
// İlk sıradaki fotoğraf Stok Merkezi'nin KAPAK görselidir. Bu şerit olmadan
// kapak, yüklenme sırasına kalıyordu; 35NSD813'te direksiyon kolu yakın çekimi
// kapak olmuştu (Göksenil bildirdi). Bkz sql/117.
// ⚠️ 11 Ağu 2026 — ARTIK SİTE FOTOĞRAFLARI DA SIRALANIR (sql/185).
//   Eskiden yalnız `arac_fotograflari` satırları sıralanabiliyordu; stoktaki
//   araçların çoğunda CRM fotoğrafı olmadığı için şerit hiç çıkmıyordu
//   (34DVV780: CRM 0 / site 20). Sıra artık stok_araclar.foto_sira'da.
function siralanabilirler() { return fotolar }

function siralamaSeridi() {
  if (!canSirala) return ''
  const s = siralanabilirler()
  // ⚠️ SESSİZ GİZLEME YASAK: tek fotoğrafta şerit anlamsız ama sebebi yazılır.
  if (s.length < 2) {
    if (!fotolar.length) return ''
    return `<div class="mt-3 pt-2 border-t border-outline-variant text-[11px] text-on-surface-variant flex items-start gap-1">
        ${mat('info', 'text-[15px] shrink-0')}<span>Sıralama için en az 2 fotoğraf gerekir.</span>
      </div>`
  }
  const kart = (f, i) => `<div class="fsira relative shrink-0 w-16 h-12 rounded-md overflow-hidden border-2 ${i === 0 ? 'border-primary' : 'border-transparent'} cursor-grab bg-surface-container"
        draggable="true" data-si="${i}" title="Sürükleyerek sıralayın">
      <img src="${kacis(f.url)}" alt="" class="w-full h-full object-cover pointer-events-none">
      ${i === 0 ? '<span class="absolute bottom-0 inset-x-0 bg-primary text-on-primary text-[9px] font-bold text-center leading-[13px]">KAPAK</span>' : ''}
    </div>`
  return `<div class="mt-3 pt-2 border-t border-outline-variant">
      <div class="flex items-center gap-1 text-[11px] font-bold text-on-surface-variant uppercase mb-1.5">
        ${mat('swap_horiz', 'text-[15px]')} Fotoğraf sırası
        <span class="font-normal normal-case text-on-surface-variant/70">— ilk sıradaki, Stok Merkezi'nde kapak olur</span>
      </div>
      <div id="fsiraSerit" class="flex gap-1.5 overflow-x-auto pb-1">${s.map(kart).join('')}</div>
    </div>`
}

function siralamaBagla() {
  const serit = document.getElementById('fsiraSerit'); if (!serit) return
  serit.querySelectorAll('.fsira').forEach(k => {
    k.addEventListener('dragstart', () => { srcFoto = +k.dataset.si; k.classList.add('opacity-40') })
    k.addEventListener('dragend', () => { srcFoto = null; k.classList.remove('opacity-40') })
    k.addEventListener('dragover', e => { e.preventDefault(); k.classList.add('ring-2', 'ring-primary') })
    k.addEventListener('dragleave', () => k.classList.remove('ring-2', 'ring-primary'))
    k.addEventListener('drop', e => {
      e.preventDefault(); k.classList.remove('ring-2', 'ring-primary')
      fotoSirala(srcFoto, +k.dataset.si)
    })
  })
}

async function fotoSirala(from, to) {
  if (from == null || to == null || from === to) return
  const s = siralanabilirler()
  const yeni = [...s]; const [tasinan] = yeni.splice(from, 1); yeni.splice(to, 0, tasinan)
  const durum = document.getElementById('fotoDurum')
  if (durum) durum.textContent = 'Sıra kaydediliyor…'
  // 1) Birleşik sıra → stok_araclar.foto_sira (CRM + SİTE fotoğrafları birlikte)
  const anahtarlar = yeni.map(fotoAnahtar)
  const { data: sd, error: se } = await supabase.from('stok_araclar')
    .update({ foto_sira: anahtarlar }).eq('id', id).select('id')
  if (se) { dbHata('foto sıra', se); if (durum) durum.textContent = 'Sıra kaydedilemedi: ' + se.message; return }
  // ⚠️ .update() hata vermeden 0 satır güncelleyebilir (CLAUDE.md §5.1)
  if (!sd || !sd.length) { if (durum) durum.textContent = 'Sıra kaydedilemedi (yetki?).'; return }
  // 2) CRM fotoğraflarının `sira` alanı da güncellenir — yalnız `sira` okuyan
  //    sayfalar (stok listesi kapağı, sipariş merkezi, satış) uyumlu kalsın.
  // ⚠️ (arac_id, sira) BENZERSİZ DEĞİL — bilerek. Satır satır yazarken ara
  //   adımda iki foto aynı sırada kalıyor; benzersiz kısıt burayı patlatırdı.
  for (let i = 0; i < yeni.length; i++) {
    if (!yeni[i].rowId || yeni[i].sira === i) continue
    const { data, error } = await supabase.from('arac_fotograflari')
      .update({ sira: i }).eq('id', yeni[i].rowId).select('id')
    if (error) { dbHata('foto sıra (crm)', error); if (durum) durum.textContent = 'Sıra kısmen kaydedildi: ' + error.message; return }
    if (!data || !data.length) { if (durum) durum.textContent = 'Sıra kısmen kaydedildi (yetki?).'; return }
  }
  if (durum) durum.textContent = 'Sıra kaydedildi — kapak: 1. fotoğraf.'
  await yukle()
}

function galeriGoster(i) {
  if (!fotolar.length) return
  fotoIndex = (i + fotolar.length) % fotolar.length
  const img = document.getElementById('galeriImg'); if (img) { img.style.opacity = 1; img.src = fotolar[fotoIndex].url }
  const s = document.getElementById('galeriSayac'); if (s) s.textContent = String(fotoIndex + 1)
  document.querySelectorAll('.fnokta').forEach((n, k) => n.className = `fnokta w-2 h-2 rounded-full ${k === fotoIndex ? 'bg-primary' : 'bg-on-surface-variant/30'}`)
  const sil = document.getElementById('fotoSil'); if (sil) sil.style.display = fotolar[fotoIndex].silinebilir ? '' : 'none'
}
function galeriBaslat() {
  document.getElementById('fotoInput')?.addEventListener('change', e => fotoYukle(e.target.files))
  if (fotoTimer) { clearInterval(fotoTimer); fotoTimer = null }
  const g = document.getElementById('galeri'); if (!g) return
  fotoIndex = 0; fotoHover = false
  g.addEventListener('mouseenter', () => { fotoHover = true })
  g.addEventListener('mouseleave', () => { fotoHover = false })
  g.addEventListener('click', () => lightboxAc(fotoIndex))
  document.getElementById('galeriPrev')?.addEventListener('click', e => { e.stopPropagation(); galeriGoster(fotoIndex - 1) })
  document.getElementById('galeriNext')?.addEventListener('click', e => { e.stopPropagation(); galeriGoster(fotoIndex + 1) })
  document.getElementById('fotoSil')?.addEventListener('click', e => { e.stopPropagation(); fotoSil(fotolar[fotoIndex]) })
  document.querySelectorAll('.fnokta').forEach(n => n.addEventListener('click', e => { e.stopPropagation(); galeriGoster(Number(n.dataset.fi)) }))
  siralamaBagla()
  galeriGoster(0)
  if (fotolar.length > 1) fotoTimer = setInterval(() => { if (!fotoHover) galeriGoster(fotoIndex + 1) }, 4000)
}
function lightboxAc(i) {
  lightboxKapat()
  const ov = document.createElement('div')
  ov.id = 'fotoLightbox'
  ov.className = 'fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-4'
  ov.innerHTML = `<button class="lbKapat absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20">${mat('close')}</button>
    <button id="lbPrev" class="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20">${mat('chevron_left')}</button>
    <img id="lbImg" src="${kacis(fotolar[i].url)}" class="max-w-full max-h-full object-contain rounded-lg">
    <button id="lbNext" class="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20">${mat('chevron_right')}</button>
    <div class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/10 text-white text-label-md px-3 py-1 rounded-full"><span id="lbSayac">${i + 1}</span>/${fotolar.length}</div>`
  let li = i
  const goster = k => { li = (k + fotolar.length) % fotolar.length; ov.querySelector('#lbImg').src = fotolar[li].url; ov.querySelector('#lbSayac').textContent = String(li + 1) }
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.lbKapat')) lightboxKapat() })
  ov.querySelector('#lbPrev').addEventListener('click', e => { e.stopPropagation(); goster(li - 1) })
  ov.querySelector('#lbNext').addEventListener('click', e => { e.stopPropagation(); goster(li + 1) })
  document.body.appendChild(ov)
}
function lightboxKapat() { document.getElementById('fotoLightbox')?.remove() }

// Yükleme/silme/küçültme → arac-dosya.js (tek kaynak, 7 Ağu 2026).
// Buradaki `resimWebp`/`yukleImg` kopyası ile arac-detay.js'teki `webpCevir`
// aynı işi iki farklı ayarla yapıyordu; modül ikisini de kapsıyor.
// ⚠️ SIRA KURALI KORUNDU: `sira` yazılmazsa tüm fotoğraflar sira=0 olur,
//    berabere kalır ve Stok Merkezi kapağı rastgele seçilir (35NSD813'te
//    direksiyon kolu kapak olmuştu). Yeni yüklenen daima son sıradan devam.
async function fotoYukle(files) {
  if (!files || !files.length) return
  const durum = document.getElementById('fotoDurum')
  // ⚠️ Yalnız CRM fotoğrafları — site fotoğraflarında `sira` yok (undefined),
  //    listeye karıştırılırsa başlangıç sırası hep 1'e düşerdi.
  const bas = fotolar.filter(f => f.rowId).reduce((m, f) => Math.max(m, (f.sira ?? 0) + 1), 0)
  const { eklenen, hata } = await fotograflariYukle({
    aracId: id, dosyalar: files, baslangicSira: bas, yukleyen: benim.id,
    ilerleme: (i, n) => { if (durum) durum.textContent = `Yükleniyor… (${i}/${n})` },
  })
  if (durum) durum.textContent = `${eklenen} yüklendi${hata ? ` · ${hata} hata` : ''}.`
  await yukle()
}
async function fotoSil(foto) {
  if (!foto?.silinebilir || !foto.rowId) return
  if (!confirm('Bu fotoğraf silinsin mi?')) return
  const r = await fotografSil({ id: foto.rowId, yol: foto.yol })
  if (!r.ok) { alert('Silinemedi: ' + r.msg); return }
  await yukle()
}

// ---------- EŞLEŞEN MÜŞTERİLER ----------
function musteriHtml(a, uygun) {
  if (!uygun.length) return kutu('Eşleşen Müşteriler', 'group', `<div class="text-center py-6 text-on-surface-variant">${mat('person_search', 'text-3xl opacity-30')}<p class="mt-2 text-body-md">Eşleşen açık talep yok.</p></div>`)
  const sirali = uygun.map(t => ({ t, s: uyumSkor(a, t) })).sort((x, y) => y.s - x.s).slice(0, 10)
  const sahip = t => { const n = (t.gorusme_notlari || []).find(g => g.sahip_danisman_id); return n ? danismanAdi(dmap, n.sahip_danisman_id) : 'Havuzda' }
  const govde = `<div class="space-y-2">${sirali.map(({ t, s }) => {
    const tel = telNo(t.telefon), wa = waHref(t.telefon)
    const istek = [t.marka, t.model].filter(v => v && v !== '-' && v.toLowerCase() !== 'farketmez').join(' ')
    const skorCls = s >= 90 ? 'text-green-700' : s >= 80 ? 'text-primary' : 'text-amber-700'
    return `<div class="border border-outline-variant rounded-xl p-2.5 flex items-center gap-2 hover:border-primary/40 hover:bg-surface-container-low transition-all">
      <a href="talep.html?id=${t.id}" class="flex items-center gap-2 min-w-0 flex-1">
        ${avatar(t.musteri_ad_soyad, 'w-9 h-9')}
        <div class="min-w-0"><p class="font-bold text-on-surface truncate text-body-md">${kacis(t.musteri_ad_soyad) || '—'}</p>
          <p class="text-[11px] text-on-surface-variant truncate">${kacis(fmtButce(t.butce_min, t.butce_max))}${istek ? ' · ' + kacis(istek) : ''} · ${kacis(sahip(t))}</p></div>
      </a>
      <div class="text-center shrink-0"><div class="text-title-md font-black ${skorCls} leading-none">%${s}</div></div>
      <div class="flex gap-1 shrink-0">
        ${tel ? `<a href="tel:${tel}" class="w-8 h-8 rounded-lg bg-primary text-on-primary inline-flex items-center justify-center">${mat('call', 'text-[16px]')}</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" class="w-8 h-8 rounded-lg bg-[#25D366] text-white inline-flex items-center justify-center">${mat('chat', 'text-[16px]')}</a>` : ''}
      </div>
    </div>`
  }).join('')}</div>`
  return kutu('Eşleşen Müşteriler', 'group', govde, `<span class="text-label-sm text-on-surface-variant">${uygun.length}</span>`)
}

// ---------- EVRAKLAR (ruhsat · ekspertiz PDF · tramer/SBM · diğer) ----------
// Veri load'da arac_evraklar(tip,url) zaten geliyor. Özel bucket → imzalı URL
// ile önizleme çizimden sonra asenkron doldurulur.

// Yükleme şeridi — Göksenil, 11 Ağu 2026 (35BYT563): "araç stokta, ekspertiz
// dosyası yeni geldi, yükleyebileceğim bir alan yok". Yükleme yalnız Araç
// Kabul sihirbazında ve Araç Detay'da vardı; araç stoka girdikten sonra
// gelen belge (ekspertiz PDF'i, tramer detayı) hiçbir yerden eklenemiyordu.
// ⚠️ Yükleme arac-dosya.js'e devredilir — burada ikinci bir kopya YAZMA.
//    PDF'ler webp'ye ÇEVRİLMEZ (webpCevir tanıyıp dokunmadan geçirir).
function evrakYuklemeSeridi() {
  const dg = (tip, et, ik) => `<label class="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-dashed border-outline-variant hover:border-primary/50 hover:bg-surface-container-low cursor-pointer text-[11px] font-bold text-on-surface-variant transition-colors">
      ${mat(ik, 'text-[15px] text-primary')} ${et}<input type="file" data-evraktip="${tip}" accept="application/pdf,image/*" hidden></label>`
  return `<div class="flex flex-wrap gap-2 mb-3">
      ${dg('EKSPERTIZ_PDF', 'Ekspertiz PDF', 'assignment')}${dg('RUHSAT', 'Ruhsat', 'badge')}
      ${dg('SBM_GORSEL', 'Tramer / SBM', 'search_check')}${dg('TRAMER_DETAY', 'Tramer Detay', 'description')}
      ${dg('DIGER', 'Diğer Belge', 'attach_file')}
    </div><div id="akEvrakDurum" class="text-[11px] text-on-surface-variant mb-2 hidden"></div>`
}

function evraklarKartHtml(a) {
  const evr = a.arac_evraklar || []
  // ⚠️ Eskiden belge yoksa kart HİÇ çizilmiyordu — belgesiz araca belge
  //    eklemenin yolu yoktu. Artık boşken de yükleme şeridiyle çizilir.
  if (!evr.length) {
    return `<div class="mt-lg">${kutu('Ruhsat / Ekspertiz / Tramer Belgeleri', 'folder',
      `${evrakYuklemeSeridi()}<p class="text-[12px] text-on-surface-variant text-center py-4">Bu araca ait belge yok — yukarıdan ekleyin.</p>`)}</div>`
  }
  // Göksenil: "danışmanlar araç kartında sbm görseline tıkladıklarında varsa
  // detay sorgusunu da görebilecekler." → SBM kutusunda, ERP detay sorgusu
  // varsa doğrudan onu açan bir düğme. Aynı .ak-evrakac dinleyicisini
  // kullanır (data-evrakac = detay belgesinin dizini), yeni kod yolu yok.
  const detayIdx = evr.findIndex(x => x.tip === 'TRAMER_DETAY')
  const oge = (e, i) => {
    const pdf = /\.pdf(\?|$)/i.test(e.url)
    const detayDugmesi = (e.tip === 'SBM_GORSEL' && detayIdx >= 0)
      ? `<button data-evrakac="${detayIdx}" class="ak-evrakac shrink-0 px-1.5 h-6 rounded bg-primary/10 text-primary text-[10px] font-bold flex items-center gap-0.5" title="ERP hasar detay sorgusunu aç">${mat('description', 'text-[13px]')} Detay</button>`
      : ''
    // sql/186 · Yanlış slota yüklenen belge buradan silinebilir olmalıydı;
    // silme yalnız Araç Detay sayfasında vardı, kullanıcı burada kilitli kaldı
    // (Göksenil, 11 Ağu 2026 · 34HAL964 — SBM görseli tramer slotuna gitmişti).
    const silDugmesi = canEvrakSil && e.id
      ? `<button data-evraksil="${kacis(e.id)}" data-yol="${kacis(e.url)}" data-etiket="${kacis(EVRAK_ETIKET[e.tip] || e.tip)}"
           class="ak-evraksil w-6 h-6 rounded hover:bg-error/10 text-error flex items-center justify-center shrink-0" title="Bu belgeyi sil">${mat('delete', 'text-[15px]')}</button>`
      : ''
    return `<div class="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden flex flex-col">
      <div class="flex items-center justify-between gap-2 p-2 border-b border-outline-variant">
        <span class="text-[12px] font-bold truncate">${kacis(EVRAK_ETIKET[e.tip] || e.tip)}</span>
        <span class="flex items-center gap-1 shrink-0">${detayDugmesi}
        <button data-evrakac="${i}" class="ak-evrakac w-6 h-6 rounded hover:bg-primary/10 text-primary flex items-center justify-center shrink-0" title="Yeni sekmede aç">${mat('open_in_full', 'text-[15px]')}</button>${silDugmesi}</span>
      </div>
      <div id="akEvon-${i}" class="h-48 bg-surface-container-high flex items-center justify-center overflow-hidden">
        <span class="flex flex-col items-center gap-1 text-on-surface-variant/50">${mat(pdf ? 'picture_as_pdf' : 'image', 'text-[28px]')}<span class="text-[10px]">yükleniyor…</span></span>
      </div></div>`
  }
  const govde = `${evrakYuklemeSeridi()}<div class="grid grid-cols-2 md:grid-cols-3 gap-3">${evr.map(oge).join('')}</div>`
  return `<div class="mt-lg">${kutu('Ruhsat / Ekspertiz / Tramer Belgeleri', 'folder', govde, `<span class="text-label-sm text-on-surface-variant">${evr.length}</span>`)}</div>`
}

async function evraklarDoldur(a) {
  const evr = a.arac_evraklar || []
  await Promise.all(evr.map(async (e, i) => {
    const kap = document.getElementById('akEvon-' + i); if (!kap) return
    const url = await evrakImzaliUrl(e.url)
    if (!url) return
    const et = kacis(EVRAK_ETIKET[e.tip] || e.tip)
    kap.dataset.url = url
    kap.innerHTML = /\.pdf(\?|$)/i.test(e.url)
      ? `<iframe src="${kacis(url)}#toolbar=0&view=FitH" class="w-full h-full border-0 bg-white" loading="lazy" title="${et}"></iframe>`
      : `<img src="${kacis(url)}" class="w-full h-full object-contain" loading="lazy" alt="${et}" />`
  }))
  // ⚠️ DİNLEYİCİ BİRİKMESİ — 12 Ağu 2026'da canlıda ölçüldü.
  //   evraklarDoldur() her çizimde çalışıyor ve aynı düğümlere HER SEFERİNDE
  //   yeni dinleyici ekliyordu. Bu düğümler yeniden çizimde korunduğu için
  //   dinleyiciler üst üste binip TEK dosya seçiminde İKİ yükleme (aynı
  //   saniyede iki EKSPERTIZ_PDF satırı), tek silme tıklamasında birden
  //   çok silme üretiyordu. `bagli` bayrağı bir düğüme bir kez bağlar;
  //   düğüm gerçekten yenilenirse bayrak da gider, koruma kendiliğinden
  //   doğru davranır.
  const birKez = (sec, olay, isle) => document.querySelectorAll(sec).forEach(el => {
    if (el.dataset.bagli === olay) return
    el.dataset.bagli = olay
    el.addEventListener(olay, isle)
  })
  birKez('.ak-evrakac', 'click', e => {
    const b = e.currentTarget
    const url = document.getElementById('akEvon-' + b.dataset.evrakac)?.dataset.url
    if (url) window.open(url, '_blank', 'noopener')
  })
  birKez('.ak-evraksil', 'click', e => evrakSilAk(e.currentTarget.dataset))
  birKez('input[data-evraktip]', 'change', e => {
    const inp = e.currentTarget, dosya = inp.files[0]
    inp.value = ''   // aynı dosya tekrar seçilebilsin + artık change yeniden tetiklenmesin
    evrakYukleAk(inp.dataset.evraktip, dosya)
  })
}

let evrakYuklemeDevam = false
async function evrakYukleAk(tip, dosya) {
  if (!dosya) return
  if (evrakYuklemeDevam) return   // çift yükleme kilidi (aynı anda iki istek gitmesin)
  evrakYuklemeDevam = true
  const d = document.getElementById('akEvrakDurum')
  const yaz = t => { if (d) { d.textContent = t; d.classList.remove('hidden') } }
  yaz('Yükleniyor…')
  try {
    const r = await evrakiYukle({ aracId: id, tip, dosya })
    // ⚠️ Sessiz başarı yok: yüklenemediğinde sebebi ekrana yazılır (CLAUDE.md §5.4)
    if (!r.ok) { yaz('Yüklenemedi: ' + (r.msg || 'yetki yok.')); return }
    yaz('Yüklendi.')
    await yukle()
  } finally { evrakYuklemeDevam = false }
}

// Belge silme — önce satır, sonra kovadaki dosya (arac-dosya.js tek kaynak).
// ⚠️ RLS 0 satır dönebilir (CLAUDE.md §5.1); evrakSil bunu `ok:false` ile
//   bildirir, sessizce "silindi" deme.
async function evrakSilAk({ evraksil, yol, etiket }) {
  if (!evraksil) return
  if (!confirm(`“${etiket}” belgesi silinecek. Bu işlem geri alınamaz.\n\nDevam edilsin mi?`)) return
  const r = await dsEvrakSil({ id: evraksil, yol })
  if (!r.ok) { alert('Belge silinemedi: ' + (r.msg || 'yetkiniz yok.')); return }
  await yukle()
}

// ---------- NOTLAR ----------
function notKutuHtml(notlar) {
  const form = `<form id="notForm" class="flex gap-2 mb-3">
    <input id="notMetin" placeholder="Araca not düş…" autocomplete="off" class="flex-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white focus:border-primary focus:ring-1 focus:ring-primary">
    <button type="submit" class="bg-primary text-on-primary px-4 py-2 rounded-lg text-label-md font-bold flex items-center gap-1">${mat('add', 'text-[18px]')} Ekle</button></form>`
  // Düzenle/Sil: master + yönetici (Göksenil + İsmail Bey). DB politikası da
  // birebir bu: arac_notlari_duzenle / _sil = is_master() OR is_yonetici().
  const liste = notlar.length
    ? `<div class="space-y-2">${notlar.map(n => `<div class="bg-surface-container-low rounded-lg p-3" data-not="${kacis(n.id)}">
        <div class="flex items-center justify-between gap-2 mb-1"><span class="text-label-sm font-bold text-on-surface">${kacis(danismanAdi(dmap, n.danisman_id))}</span>
          <span class="flex items-center gap-1 shrink-0"><span class="text-[11px] text-on-surface-variant">${fmtTarih(n.created_at)}</span>
          ${notYonetir(benim) ? `<button class="not-duzenle w-6 h-6 rounded hover:bg-primary/10 text-primary flex items-center justify-center" title="Düzenle">${mat('edit', 'text-[14px]')}</button>
            <button class="not-sil w-6 h-6 rounded hover:bg-error/10 text-error flex items-center justify-center" title="Sil">${mat('delete', 'text-[14px]')}</button>` : ''}
          </span></div>
        <p class="not-metin text-body-md text-on-surface whitespace-pre-wrap">${kacis(n.icerik)}</p></div>`).join('')}</div>`
    : '<p class="text-on-surface-variant text-body-md">Henüz not yok.</p>'
  return kutu('Araç Notları', 'sticky_note_2', form + liste)
}

// Not yönetimi = master + yönetici. Bu kapı DB politikasının kopyası DEĞİL,
// aynası: yetkisiz kullanıcı düğmeyi görmez, görse de RLS 0 satır döner ve
// aşağıdaki data.length kontrolü uyarır (CLAUDE.md §5.1).
const notYonetir = d => !!(d && (d.master_admin || d.rol === 'yonetici'))

function notlariBagla() {
  if (!notYonetir(benim)) return
  document.querySelectorAll('.not-sil').forEach(b => b.addEventListener('click', async () => {
    const notId = b.closest('[data-not]')?.dataset.not; if (!notId) return
    if (!confirm('Bu not silinsin mi?')) return
    const { data, error } = await supabase.from('arac_notlari').delete().eq('id', notId).select('id')
    if (error) { dbHata('not sil', error); alert('Not silinemedi: ' + error.message); return }
    if (!data || !data.length) { alert('Silme yetkiniz yok.'); return }   // §5.1: 0 satır = yetki yok
    await yukle()
  }))
  document.querySelectorAll('.not-duzenle').forEach(b => b.addEventListener('click', () => {
    const row = b.closest('[data-not]'); const notId = row?.dataset.not; if (!notId) return
    const p = row.querySelector('.not-metin'); const eski = p.textContent
    p.innerHTML = `<div class="flex items-center gap-2">
      <input class="not-inp flex-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white focus:border-primary focus:ring-1 focus:ring-primary" value="${kacis(eski)}">
      <button class="not-kaydet bg-primary text-on-primary px-3 h-9 rounded-lg text-label-md font-bold shrink-0 flex items-center">${mat('save', 'text-[16px]')}</button>
      <button class="not-vazgec border border-outline-variant px-3 h-9 rounded-lg text-label-md font-bold shrink-0">Vazgeç</button></div>`
    const inp = p.querySelector('.not-inp'); inp.focus()
    p.querySelector('.not-vazgec').addEventListener('click', () => yukle())
    const kaydet = async () => {
      const yeni = inp.value.trim()
      if (!yeni || yeni === eski) return yukle()
      const { data, error } = await supabase.from('arac_notlari').update({ icerik: yeni }).eq('id', notId).select('id')
      if (error) { dbHata('not düzenle', error); alert('Not düzenlenemedi: ' + error.message); return }
      if (!data || !data.length) { alert('Düzenleme yetkiniz yok.'); return }
      await yukle()
    }
    p.querySelector('.not-kaydet').addEventListener('click', kaydet)
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') kaydet() })
  }))
}

// ---------- YAŞAM DÖNGÜSÜ · DENETİM KATMANI ----------
// Göksenil, 13 Ağu 2026: "her kayıttan 1 tane yazmasını istiyorum, aynı
//   tarihteki işlemleri tek kayıtta göstersin. Üzerine tıkladığımda kim hangi
//   değişiklikleri yaptıysa onun eski/yeni hâlini de gösterebilir; böylece
//   personel hata yaptıysa nedenini master admin görür."
//
// Eskiden her olay ayrı satırdı: 11 Ağu'da 8 işlem yapılan araçta 8 satır
// alt alta diziliyor, hangi gün ne olduğu okunmuyordu. Artık GÜN BAŞINA TEK
// satır; açılınca o günün işlemleri ve alan alan eski → yeni değişimi.
//
// ⚠️ DENETİM YALNIZ MASTER ADMIN'E AÇIK. audit_log RLS'i `is_master()`.
//    Diğer roller sorguyu atsa boş dönerdi; hiç atmıyoruz ki 3 gereksiz
//    istek gitmesin ve "veri yok" ile "yetkin yok" karışmasın.
// ⚠️ ÜÇ AYRI SORGU, tek `.or()` DEĞİL. Çocuk tabloların (arac_alislar,
//    arac_masraflar, arac_fiyatlar) kayit_id'si o satırın kendi id'si;
//    araç bağı JSON içinde. PostgREST `.or()` içine gömülü json yolu yazmak
//    kırılgan — sözdizimi yanlışsa hata döner ve liste SESSİZCE boş kalırdı
//    (CLAUDE.md §5). Üç sorgu ayrı ayrı ölçülüyor, hatası ayrı loglanıyor.
// ⚠️ GUNCELLEME satırı hem eski_deger hem yeni_deger içinde arac_id taşır →
//    iki sorgudan da döner. `id` ile tekilleştiriliyor.
let DENETIM = []

async function denetimYukle() {
  if (!benim?.master_admin) return []
  const sec = 'id, created_at, tablo, islem, eski_deger, yeni_deger, degisen_alanlar, danisman_id, kullanici, departman'
  const [a, b, c] = await Promise.all([
    supabase.from('audit_log').select(sec).eq('tablo', 'stok_araclar').eq('kayit_id', id),
    supabase.from('audit_log').select(sec).eq('yeni_deger->>arac_id', id),
    supabase.from('audit_log').select(sec).eq('eski_deger->>arac_id', id),
  ])
  for (const [ad, r] of [['stok_araclar', a], ['yeni_deger', b], ['eski_deger', c]]) {
    if (r.error) console.error('[db] audit_log ' + ad, r.error)
  }
  const harita = new Map()
  for (const r of [...(a.data || []), ...(b.data || []), ...(c.data || [])]) harita.set(r.id, r)
  return [...harita.values()].sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
}

// Alan adı → okunur etiket. Liste CANLI VERİDEN çıkarıldı (13 Ağu 2026:
// audit_log'da fiilen değişen alanlar taranıp yazıldı) — tahminle
// doldurulmadı. Haritada olmayan alan ham adıyla gösterilir, gizlenmez.
const DENETIM_ALAN = {
  durum: 'Durum', fiyatlama_durumu: 'Fiyatlama durumu', plaka: 'Plaka', eski_plaka: 'Eski plaka',
  plaka_norm: 'Plaka (normalize)', sasi_no: 'Şasi no', motor_no: 'Motor no', yil: 'Model yılı',
  km: 'KM', renk: 'Renk', yakit: 'Yakıt', vites: 'Vites', model: 'Model', versiyon: 'Versiyon',
  kasa_tipi: 'Kasa tipi', notu: 'Stok notu', yedek_anahtar: 'Yedek anahtar',
  ekspertiz_orijinal: 'Ekspertiz orijinal onayı', tramer_temiz: 'Tramer temiz onayı',
  ekspertiz_firma: 'Ekspertiz firması', foto_sira: 'Fotoğraf sırası',
  guncel_ekspertiz_istendi: 'Güncel ekspertiz istendi', guncel_ekspertiz_isteyen: 'Güncel ekspertizi isteyen',
  tahsis_edilen_id: 'Tahsis edilen', tahsis_tarihi: 'Tahsis tarihi', tahsis_notu: 'Tahsis notu',
  tsb_marka_id: 'TSB marka', tsb_tip_id: 'TSB tip', olusturan: 'Oluşturan',
  alis_fiyati: 'Alış fiyatı', alis_sekli: 'Alış şekli', alis_tarihi: 'Alış tarihi',
  noter_alis_fiyati: 'Noter alış fiyatı', satici_musteri_id: 'Satıcı',
  noter_adi: 'Noter', noter_tarihi: 'Noter tarihi', yevmiye_no: 'Yevmiye no',
  satis_fiyati: 'Satış fiyatı', min_satis_fiyati: 'Min. satış fiyatı',
  masraf_tipi: 'Masraf tipi', tutar: 'Tutar', aciklama: 'Açıklama', yon: 'Yön', tarih: 'Tarih',
  gecerli_baslangic: 'Geçerlilik başlangıcı', degistiren_danisman_id: 'Değiştiren',
  cikis_ili: 'Çıkış ili', ruhsat_seri_no: 'Ruhsat seri no', nakliye_durumu: 'Nakliye durumu',
}
// Kod tutan alanlar → okunur ad. Kaynak: aynı sayfanın TANIM haritası ve
// veri.js'teki durum etiketleri — burada ÜÇÜNCÜ bir kopya tutulmuyor.
const DENETIM_KOD_COZ = {
  // ⚠️ `durum` İKİ AYRI ANLAMA GELİYOR: stok_araclar'da aracın durumu
  //    (STOKTA/SIPARISTE…), arac_ekspertiz'de parçanın durumu (BOYALI/
  //    DEGISEN…). Tablo bilinmeden çevrilirse ekspertiz satırında araç
  //    durum etiketleri aranır, bulunmaz ve ham kod basılırdı.
  durum: (v, tablo) => tablo === 'arac_ekspertiz'
    ? (DURUM_ETIKET[v] || v)
    : (ARAC_DURUM_ETIKET[v] || v),
  masraf_tipi: v => tanimAd('MASRAF_TIPI', v),
  alis_sekli: v => tanimAd('ALIS_SEKLI', v),
  renk: v => tanimAd('RENK', v), yakit: v => tanimAd('YAKIT', v),
  vites: v => tanimAd('VITES', v), kasa_tipi: v => tanimAd('KASA_TIPI', v),
  yon: v => (v === 'GIDER' ? 'Gider' : v === 'GELIR' ? 'Gelir' : v),
  // Canlıda yalnız iki değer var (13 Ağu: FIYATLANDI 135 · BEKLIYOR 4 · boş 1).
  fiyatlama_durumu: v => ({ BEKLIYOR: 'Bekliyor', FIYATLANDI: 'Fiyatlandı' }[v] || v),
}
const DENETIM_TABLO = {
  stok_araclar: 'Araç', arac_alislar: 'Alış', arac_fiyatlar: 'Fiyat',
  arac_masraflar: 'Masraf', arac_ekspertiz: 'Ekspertiz', arac_tramer: 'Tramer',
}
const DENETIM_ISLEM = { EKLEME: 'eklendi', GUNCELLEME: 'değişti', SILME: 'silindi' }
// Ekranda anlamı olmayan teknik alanlar — EKLEME/SİLME özetinde atlanır.
const DENETIM_GIZLI = new Set(['id', 'arac_id', 'created_at', 'updated_at', 'olusturan',
  'plaka_norm', 'ad_ara', 'sira'])

// Değeri okunur yaz. Para alanları binlik ayraçlı, boolean Evet/Hayır,
// uuid'ler kısaltılır (tam uuid ekranda bilgi taşımıyor), null "—".
function denetimDeger(alan, v, tablo) {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır'
  if (Array.isArray(v)) return v.length ? v.length + ' kayıt' : '—'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60)
  const s = String(v)
  if (DENETIM_KOD_COZ[alan]) return DENETIM_KOD_COZ[alan](s, tablo) || s
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) {
    // Danışman kimliği ise adını göster, değilse kısalt — tam uuid ekranda
    // hiçbir şey anlatmıyor, satırı da taşırıyor.
    return danismanAdi(dmap, s) || (s.slice(0, 8) + '…')
  }
  if (/fiyat|tutar|bedel/.test(alan) && !isNaN(Number(s))) return fmtPara(Number(s))
  // ⚠️ Tarih testi ALAN ADINA değil DEĞERE bakar: `gecerli_baslangic` adında
  //    "tarih/zaman" geçmiyor ve ham ISO damgası ekrana basılıyordu.
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s)) return fmtTarihKisa(s)
  return s
}

function denetimSatirHtml(r) {
  const saat = new Date(r.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const kim = danismanAdi(dmap, r.danisman_id) || r.kullanici || '—'
  // Ekspertizde hangi PARÇA olduğu başlıkta yazmalı — yoksa "Ekspertiz
  // değişti · Durum: Boyalı → Değişen" satırı hangi panele ait belli olmaz.
  const parca = r.tablo === 'arac_ekspertiz'
    ? (r.yeni_deger?.parca_kodu || r.eski_deger?.parca_kodu || '') : ''
  const baslik = `${DENETIM_TABLO[r.tablo] || r.tablo} ${DENETIM_ISLEM[r.islem] || r.islem}`
    + (parca ? ` — ${parca}` : '')
  let detay = ''
  if (r.islem === 'GUNCELLEME') {
    const alanlar = (r.degisen_alanlar || []).filter(f => !DENETIM_GIZLI.has(f))
    detay = alanlar.map(f => `<div class="flex items-baseline gap-1.5 flex-wrap">
        <span class="text-on-surface-variant">${kacis(DENETIM_ALAN[f] || f)}:</span>
        <span class="line-through text-on-surface-variant">${kacis(denetimDeger(f, r.eski_deger?.[f], r.tablo))}</span>
        <span class="text-on-surface-variant">→</span>
        <span class="font-bold text-on-surface">${kacis(denetimDeger(f, r.yeni_deger?.[f], r.tablo))}</span>
      </div>`).join('')
    if (!alanlar.length) detay = `<div class="text-on-surface-variant">Görünür alan değişmedi.</div>`
  } else {
    // EKLEME / SİLME: satırın kendisinden birkaç anlamlı alan
    const kaynak = r.islem === 'SILME' ? r.eski_deger : r.yeni_deger
    const alanlar = Object.keys(kaynak || {})
      .filter(f => !DENETIM_GIZLI.has(f) && kaynak[f] != null && kaynak[f] !== ''
                   && !(r.tablo === 'arac_ekspertiz' && f === 'parca_kodu'))   // başlıkta zaten var
    detay = alanlar.slice(0, 6).map(f => `<div class="flex items-baseline gap-1.5 flex-wrap">
        <span class="text-on-surface-variant">${kacis(DENETIM_ALAN[f] || f)}:</span>
        <span class="font-bold text-on-surface">${kacis(denetimDeger(f, kaynak[f], r.tablo))}</span>
      </div>`).join('')
  }
  return `<div class="py-2 border-b border-outline-variant/40 last:border-0">
    <div class="flex items-baseline justify-between gap-2">
      <span class="font-bold text-[11.5px] text-on-surface">${kacis(baslik)}</span>
      <span class="text-[10.5px] text-on-surface-variant shrink-0">${kacis(saat)} · ${kacis(kim)}</span>
    </div>
    <div class="mt-1 space-y-0.5 text-[11px]">${detay}</div>
  </div>`
}

function timelineHtml(a, notlar, olaylar) {
  const ev = []
  // ⚠️ ESKİDEN `o.tip.replace(/_/g,' ')` idi → ekranda "ARAC DURUM DEGISTI"
  //    yazıyordu: ne Türkçe, ne de NE OLDUĞUNU söylüyordu (Göksenil, 7 Ağu
  //    2026: "araç durum değişti yazıyor, o yazmamalı, açıklayıcı olmalı").
  //    Anlatım veri.js'te TEK KAYNAK — üçüncü kopyayı buraya yazma.
  for (const o of olaylar) ev.push({
    ts: o.olusma_zamani, ik: 'bolt',
    baslik: olayAdi(o.tip),
    metin: olayDetay(o) || undefined,
    kim: olaySistemMi(o) ? AI_SISTEM : danismanAdi(dmap, o.danisman_id),
  })
  for (const n of notlar) ev.push({ ts: n.created_at, ik: 'sticky_note_2', baslik: 'Not', metin: n.icerik, kim: danismanAdi(dmap, n.danisman_id) })
  if (a.created_at) ev.push({ ts: a.created_at, ik: 'add_circle', baslik: 'Araç kaydı oluşturuldu', kim: '' })
  ev.sort((x, y) => new Date(y.ts) - new Date(x.ts))

  // --- GÜN BAŞINA TEK KAYIT -------------------------------------------------
  // ⚠️ Gün anahtarı YEREL tarihten üretilir. `ts.slice(0,10)` (UTC) yazsaydık
  //    akşam 21:00'den sonraki işlemler ERTESİ GÜNE düşerdi — Türkiye UTC+3.
  const gunAnahtar = ts => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const gunEtiket = ts => new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

  const gunler = new Map()
  const gunAl = ts => {
    const k = gunAnahtar(ts)
    if (!gunler.has(k)) gunler.set(k, { anahtar: k, etiket: gunEtiket(ts), ts, olaylar: [], denetim: [] })
    return gunler.get(k)
  }
  for (const o of ev) gunAl(o.ts).olaylar.push(o)
  for (const d of DENETIM) gunAl(d.created_at).denetim.push(d)

  const sirali = [...gunler.values()].sort((x, y) => y.anahtar.localeCompare(x.anahtar))

  const gunHtml = (g, ilk) => {
    // Aynı gün TEKRARLAYAN aynı olay tek satırda toplanır: "Masraf eklendi ×4".
    const tekil = new Map()
    for (const o of g.olaylar) {
      const k = o.baslik + '|' + (o.metin || '') + '|' + (o.kim || '')
      if (tekil.has(k)) tekil.get(k).adet++
      else tekil.set(k, { ...o, adet: 1 })
    }
    const liste = [...tekil.values()]
    const ozet = liste.slice(0, 3).map(o => o.baslik + (o.adet > 1 ? ` ×${o.adet}` : '')).join(' · ')
      + (liste.length > 3 ? ` +${liste.length - 3}` : '')
    const islemSayi = g.olaylar.length + g.denetim.length

    const olayListe = liste.map(o => `<div class="py-1.5 border-b border-outline-variant/40 last:border-0">
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-bold text-label-md text-on-surface flex items-center gap-1.5">
            ${mat(o.ik, 'text-[15px] text-on-surface-variant')} ${kacis(o.baslik)}${o.adet > 1 ? ` <span class="text-on-surface-variant font-normal">×${o.adet}</span>` : ''}</span>
          <span class="text-[11px] text-on-surface-variant shrink-0">${kacis(new Date(o.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }))}</span>
        </div>
        ${o.metin ? `<p class="text-label-sm text-on-surface-variant mt-0.5 whitespace-pre-wrap">${kacis(o.metin)}</p>` : ''}
        ${o.kim ? `<p class="text-[11px] text-on-surface-variant mt-0.5">${kacis(o.kim)}</p>` : ''}
      </div>`).join('')

    const denetimBlok = g.denetim.length
      ? `<div class="mt-2 pt-2 border-t border-outline-variant/60">
           <p class="text-[10.5px] font-black uppercase tracking-wider text-on-surface-variant flex items-center gap-1 mb-1">
             ${mat('manage_search', 'text-[13px]')} Kim ne değiştirdi <span class="font-normal normal-case tracking-normal">(${g.denetim.length})</span></p>
           ${g.denetim.map(denetimSatirHtml).join('')}
         </div>`
      : ''

    return `<details class="relative" ${ilk ? 'open' : ''}>
      <div class="absolute -left-[21px] top-1.5 w-3.5 h-3.5 rounded-full bg-primary ring-4 ring-white"></div>
      <summary class="cursor-pointer select-none list-none flex items-baseline justify-between gap-2">
        <span class="font-bold text-label-md text-on-surface">${kacis(g.etiket)}</span>
        <span class="text-[11px] text-on-surface-variant shrink-0">${islemSayi} işlem</span>
      </summary>
      <p class="text-[11px] text-on-surface-variant mt-0.5">${kacis(ozet)}</p>
      <div class="mt-1.5">${olayListe}${denetimBlok}</div>
    </details>`
  }

  const govde = sirali.length
    ? `<div class="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[6px] before:top-1 before:bottom-1 before:w-px before:bg-outline-variant">
        ${sirali.map((g, i) => gunHtml(g, i === 0)).join('')}
      </div>`
    : '<p class="text-on-surface-variant text-body-md">Henüz kayıtlı olay yok.</p>'
  return kutu('Yaşam Döngüsü', 'timeline', govde)
}

// Faiz oranları ve kasko bedeli artık kredi-hesap.js'te (TEK KAYNAK) — cam
// etiketi de aynı yükleyicileri kullanıyor ki kâğıttaki tutar ekrandakiyle
// birebir aynı olsun. Buradaki sarmalayıcılar yalnız mevcut çağrıları korur.
const krediOranlariYukle = () => oranlariYukle(supabase)
const kaskoBedeli = a => kaskoYukleOrtak(supabase, a)

async function notEkle(e) {
  e.preventDefault()
  const inp = document.getElementById('notMetin'); const metin = inp.value.trim(); if (!metin) return
  const btn = e.target.querySelector('button'); btn.disabled = true
  const { error } = await supabase.from('arac_notlari').insert({ arac_id: id, danisman_id: benim.id, icerik: metin })
  btn.disabled = false
  if (error) { console.error('[db] not ekle', error); alert('Not eklenemedi: ' + error.message); return }
  inp.value = ''
  await yukle()
}

// Ekspertiz PDF'i aç — arac-evrak bucket'ı ÖZEL, imzalı URL gerekir.
// Önceden href'e ham storage yolu konuyordu ve tarayıcı onu sayfaya göreli
// çözüp 404 veriyordu (Göksenil bildirdi).
async function ekspertizPdfAc(yol) {
  const r = await evrakAc(yol)
  if (!r.ok) alert('Ekspertiz PDF açılamadı: ' + r.msg)
}

// Minimum satış fiyatı balonu (araç kartı) — stok listesindekiyle aynı davranış
function minFiyatBalon(a, btn) {
  document.getElementById('minBalonKart')?.remove()
  const fark = (a._fiyat != null && a._min != null) ? Number(a._fiyat) - Number(a._min) : null
  const el = document.createElement('div')
  el.id = 'minBalonKart'
  el.className = 'fixed z-[90] bg-inverse-surface text-inverse-on-surface rounded-xl shadow-2xl px-4 py-3'
  el.innerHTML = `<p class="text-[10px] uppercase tracking-wide opacity-70">Minimum Satış Fiyatı</p>
    <p class="text-title-lg font-black">${fmtPara(a._min)}</p>
    ${fark != null ? `<p class="text-[11px] opacity-80 mt-0.5">Pazarlık payı: <b>${fmtPara(fark)}</b></p>` : ''}
    <p class="text-[10px] opacity-60 mt-1">Bu tutarın altına satış, satış müdürü onayı ister.</p>`
  document.body.appendChild(el)
  const r = btn.getBoundingClientRect()
  el.style.left = Math.max(8, Math.min(r.left - 60, window.innerWidth - el.offsetWidth - 8)) + 'px'
  el.style.top = (r.bottom + 6) + 'px'
  const kapat = ev => { if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('click', kapat) } }
  setTimeout(() => document.addEventListener('click', kapat), 0)
}


// ---------- KREDİ / SİGORTA KUTULARINDA MÜŞTERİ ARAMA ----------
// Göksenil: "krediye gönder butonunda müşteri ad soyad telefon tc kimlik var,
// buradan veri gidiyor onlara. burayı bağlarsak olur. sigorta teklifi al
// butonunda da aynı şekilde."
//
// ⚠️ ÖNCESİ: iki kutu da müşteriyi ELLE YAZDIRIYOR ve hiçbir yere
//   BAĞLAMIYORDU. Aynı kişi kredi/sigorta/DMS'te 3 ayrı "kayıt" gibi
//   duruyordu. Artık birleşik aramadan seçilen müşteri FK ile bağlanıyor
//   (sql/128) ve alanlar kendiliğinden doluyor.
// ⚠️ Seçim ZORUNLU DEĞİL: müşterisi henüz açılmamış bir kişi için elle
//   yazıp göndermeye devam edilebilir — akış kırılmasın.
function musteriAramaKutusu(id, inp) {
  return `<div>
    <label class="text-[11px] font-bold text-on-surface-variant uppercase">Müşteri Kütüğünden Seç <span class="font-normal normal-case">(isteğe bağlı — alanları doldurur)</span></label>
    <div class="relative">
      <input id="${id}Ara" class="${inp}" placeholder="İsim, telefon veya TC ile ara…" autocomplete="off" />
      <div id="${id}Sonuc" class="absolute z-10 w-full mt-1 bg-white border border-outline-variant rounded-lg shadow-lg max-h-48 overflow-y-auto"></div>
    </div>
    <div id="${id}Secili" class="text-[11px] text-on-surface-variant mt-1"></div>
  </div>`
}

// secilince(m) → seçilen müşteriyi alanlara basar. Dönen: () => secilenId
function musteriAramaBagla(ov, id, secilince) {
  let zaman = null, secilenId = null
  const ara = ov.querySelector('#' + id + 'Ara')
  const kutu = ov.querySelector('#' + id + 'Sonuc')
  const bilgi = ov.querySelector('#' + id + 'Secili')
  ara.addEventListener('input', e => {
    clearTimeout(zaman)
    const v = e.target.value.trim()
    if (v.length < 2) { kutu.innerHTML = ''; return }
    zaman = setTimeout(async () => {
      const { musteriAra } = await import('./musteri-sec.js')
      const data = await musteriAra(v, 6)
      kutu.innerHTML = data.length
        ? data.map(m => `<button data-mid="${m.id}" class="mk-sec w-full text-left px-3 py-2 hover:bg-primary/5 text-sm border-b border-outline-variant/50 last:border-0 flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate"><b>${kacis(buyuk(m.ad_soyad))}</b>${m.telefon && m.telefon !== '-' ? ' · ' + kacis(telNo(m.telefon)) : ''}</span>
            ${m.kaynak_modul === 'SIGORTA' ? '<span class="shrink-0 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">SİGORTA</span>' : ''}
          </button>`).join('')
        : `<div class="text-[11px] text-on-surface-variant px-3 py-2">Kayıt yok — bilgileri elle gir.</div>`
      kutu.querySelectorAll('.mk-sec').forEach(b => b.addEventListener('click', async () => {
        const secim = data.find(x => x.id === b.dataset.mid); if (!secim) return
        kutu.innerHTML = `<div class="px-3 py-2 text-[12px] text-on-surface-variant">Hazırlanıyor…</div>`
        // Sigorta kaydıysa CRM'e aktarılır — FK ancak gerçek musteriler.id kabul eder
        const { musteriCoz } = await import('./musteri-sec.js')
        const m = await musteriCoz(secim, benim)
        if (!m) { kutu.innerHTML = `<div class="px-3 py-2 text-[12px] text-error">Hazırlanamadı.</div>`; return }
        secilenId = m.id
        kutu.innerHTML = ''; ara.value = ''
        bilgi.innerHTML = `<span class="text-[#1a7a3d] font-bold">${mat('check_circle', 'text-[13px] align-middle')} ${kacis(buyuk(m.ad_soyad))}</span> bağlandı${m.aktarildi ? ' <span class="text-on-surface-variant">(sigortadan aktarıldı)</span>' : ''}`
        secilince({ ...m, kimlik: secim.kimlik })
      }))
    }, 250)
  })
  return () => secilenId
}
