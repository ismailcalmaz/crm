// =====================================================================
// arac-detay.js — Araç Detayı (Künye + Süreçler). İki giriş noktası:
//   • aracDetayKur(d)          → tam sayfa (arac-detay.html?ref=<id>)
//   • aracDetayAc(id, d, opts) → POP-UP modal (Alış Listesi satırından)
//   Tasarım: Göksenil'in ilettiği 3 sütunlu Özet düzeni (birebir):
//   [Araç Bilgileri + Foto/Not] · [Durum Özeti + Alış Bilgileri] · [Hızlı Bilgi + Kısa Yol]
//   Başlık: plaka rozeti (TR) + durum pili + künye + Düzenle/Tam sayfa/Yazdır/Kapat.
//   Sekmeler: Özet · Evraklar · Ekspertiz · Tramer · Süreç Geçmişi · Masraf(finans).
//   Foto: yükle + sürükle-bırak sırala. Tahmini değer/kâr → "yakında" (sahte yok).
//   Bkz [[dms-alis-fiyatlama-tasarim]] · [[yetki-rol-haritasi]].
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, fmtTarih, kacis, trBuyuk, buyuk, dbHata, danismanMap, danismanAdi, urlParam, bugunISO, telSifirla, telBicim, REZERVASYON_NEDENLERI, rezervasyonNedenEtiket, KDV_KODLARI, kdvEtiket, kdvYonetir, ARAC_STOK_DURUMLARI, disLokasyon } from './veri.js'
import { masrafKapiBagla } from './masraf-kapi.js'
import { mat, bosDurum, uyari, basHarf, panoyaYaz } from './stitch-ui.js'
import { svgBoya, PARCALAR, DURUMLAR, DURUM_ETIKET, ekspertizOku,
         ekspertizFarkKaydet, ekspertizHedef } from './ekspertiz.js'
// Dosya işlemleri TEK KAYNAK (arac-dosya.js). Bu dosyada ayrı bir webpCevir /
// upload kopyası TUTMA — dört kopya ayrışmıştı, 7 Ağu 2026'da birleştirildi.
import { fotograflariYukle, fotografSil as dsFotoSil, evrakiYukle, evrakSil as dsEvrakSil,
         evrakAc as dsEvrakAc, evrakImzaliUrl, fotoUrl as dsFotoUrl } from './arac-dosya.js'

const KOK = () => document.getElementById('kok')
const one = v => (Array.isArray(v) ? v[0] : v) || null

// ---- Durum ----
let DANISMAN = null, DMAP = {}, TANIM = {}, MVAR = []
let ARAC = null, ALIS = null, NETMALIYET = null
let MASRAFLAR = [], FOTOLAR = [], EKS = [], TRM = [], EVR = [], OLAY = []
let ICHIZMET = []   // F7 — pasta cila / kuaför kayıtları (herkes görür, tutar YOK)
let EKSP_PANEL = {}, EKSP_DIRTY = false, EKSP_PDF = null
// Okunan raporun firması (DYNOMOSS/YAMANLAR/USTUN). Eskiden yalnız özet
// satırında gösterilip ATILIYORDU; satış dosyasındaki "Güncel İste" hangi
// firmaya yazacağını bilemiyordu. Artık stok_araclar.ekspertiz_firma'ya
// kaydediliyor (sql/151).
let EKSP_FIRMA = null
let KMENU = null, KMENU_DIS = null        // kart "..." menüsü
let SVGTXT = ''
let aktifSekme = 'ozet'
let duzenleArac = false, duzenleAlis = false   // kart bazlı satır-içi düzenleme
let duzenId = null                              // masraf satırı
let SRC_FOTO = null, TRAMER_GORSEL = null
let KAP = null, MODAL = null, ONKAPAT = null, MODAL_KAPAT = null, ESCDINLE = null

// ---- Rezervasyon (Faz R3) — bu araç için aktif REZERVASYON/SIPARIS satırı ----
let REZ = null                 // aktif siparisler satırı (asama REZERVASYON|SIPARIS, durum ACIK) veya null
let REZ_DRAWER = false         // "Rezervasyon Başlat" sağ drawer açık mı
let REZ_MUSTERI = null         // drawer'da seçili müşteri {id, ad_soyad, telefon}
let REZ_YENI_MUSTERI = false   // drawer'da "Yeni Müşteri" formu açık mı
let REZ_SURE = '24h'           // drawer geçerlilik süresi seçimi: 12h|24h|48h|ozel
let SIP_MODU = false           // drawer "Sipariş Oluştur" modunda mı (rezervsiz doğrudan sipariş)
let REZ_TIMER = null           // canlı sayaç setInterval id
let REZ_ESC = null             // drawer Esc dinleyicisi
let REZ_UZAT = false, REZ_DUZENLE = false, REZ_GUARD_DETAY = false   // aktif kart / guard kart alt panelleri

const B = v => kacis(buyuk(v ?? ''))
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
// Ekspertiz + Tramer artık Özet içinde (sekme değil) — hızlı giriş için.
const SEKMELER = [
  ['ozet', 'Özet', 'dashboard'], ['evraklar', 'Evraklar', 'folder'],
  ['surec', 'Süreç Geçmişi', 'history'], ['masraf', 'Masraf Defteri', 'receipt_long'],
]
const EVRAK_ETIKET = { EKSPERTIZ_PDF: 'Ekspertiz PDF', EKSPERTIZ_LINK: 'Ekspertiz Bağlantı', RUHSAT: 'Ruhsat', SBM_GORSEL: 'Tramer / SBM', TRAMER_DETAY: 'Tramer Detay Sorgusu', DIGER: 'Diğer Belge' }
// Araç kabul hattını GEÇMİŞ durumlar (operasyon dahil) — veri.js tek kaynak (sql/86)
const STOK_DURUM = ARAC_STOK_DURUMLARI

// ---- Yetki ----
// Masraf Defteri sekmesi — sunucudaki karşılığı arac_masraflar RLS'i
// (sql/155): is_master() OR is_yonetici() OR is_muhasebe() OR yetkili('finans').
// ⚠️ İkisi AYNI kalmalı; ayrışırsa ya sekme boş açılır ya da yazma sunucuda
//   sessizce 0 satır günceller (§5.1). 'muhasebe' 4 Ağu 2026'da eklendi.
const finansGorur = d => !!(d && (d.master_admin || d.rol === 'yonetici' || d.rol === 'muhasebe' ||
  (Array.isArray(d.yetkiler) && d.yetkiler.includes('finans'))))
const tamYetki = d => !!(d && (d.master_admin || d.rol === 'yonetici'))
const bilgiIslemMi = d => !!(d && Array.isArray(d.yetkiler) && d.yetkiler.includes('arac_kabul'))
// Araç FİYATLAMA KUYRUĞUNDAYKEN (BEKLIYOR), yönetici olmayan araç bilgilerini
// DÜZENLEYEMEZ (İsmail Bey fiyatlar) — yalnız Noter Alış + Alış Tarihi. Fiyatlama
// bitip stoğa geçince (FIYATLANDI/STOKTA) kilit KALKAR, bilgi işlem yine düzenler
// (Göksenil kararı: kilit sadece kuyruk ekranı için).
const aracKilitli = () => !tamYetki(DANISMAN) && ARAC?.fiyatlama_durumu === 'BEKLIYOR'
const varsayilanDuzenler = d => !!(d && (d.master_admin || (Array.isArray(d.yetkiler) && d.yetkiler.includes('masraf_varsayilan_yonet'))))
// sql/186 · Dosya silme = master + bilgi işlem (+ eskiden beri `medya_yonet`).
const fotoYetki = d => !!(d && (d.master_admin || d.rol === 'bilgi_islem'
  || (Array.isArray(d.yetkiler) && d.yetkiler.includes('medya_yonet'))))
const yoneticiMi = d => !!(d && (d.master_admin || d.rol === 'yonetici'))
// Belge silme yönetici kapısındaydı; bilgi işlem eklendi (DB'deki
// is_bilgi_islem() aynası). ⚠️ `yoneticiMi`'yi genişletme — ekspertiz ve
// tramer düzenleme de ona bağlı, onlar bilgi işleme açılmayacak.
const evrakSilYetki = d => !!(yoneticiMi(d) || (d && d.rol === 'bilgi_islem'))
const ekspYetki = d => yoneticiMi(d)
const tramerYetki = d => !!(yoneticiMi(d) || (d && Array.isArray(d.yetkiler) && d.yetkiler.includes('tramer_sorgu')))

const tanimAd = (tip, kod) => (TANIM[tip] || []).find(t => t.kod === kod)?.ad || kod || ''
const tipOzel = kod => (TANIM['MASRAF_TIPI'] || []).find(t => t.kod === kod)?.ozellikler || {}
function masrafTipiKod(val) {
  const v = trBuyuk((val || '').trim()); if (!v) return ''
  const t = (TANIM['MASRAF_TIPI'] || []).find(x => trBuyuk(x.ad) === v || trBuyuk(x.kod) === v)
  return t?.kod || ''
}
function masrafVarsayilan(tip, alisSekli) {
  if (!tip) return null
  const es = MVAR.filter(m => m.masraf_tipi === tip)
  const v = (alisSekli ? es.find(m => m.alis_sekli === alisSekli) : null) || es.find(m => !m.alis_sekli)
  return v ? Number(v.tutar) : null
}
const fotoUrl = dsFotoUrl
const fiyatlandiMi = () => ARAC && (ARAC.fiyatlama_durumu === 'FIYATLANDI' || STOK_DURUM.includes(ARAC.durum))
const stoktaMi = () => ARAC && STOK_DURUM.includes(ARAC.durum)

// Ekspertiz/Tramer "tamam" sayılma kuralı (Göksenil, AŞAMA 4):
//   • Araç TAMAMEN ORİJİNAL olabilir → arac_ekspertiz'de satır olmaz. Bu "ekspertiz
//     yapılmadı" demek DEĞİL. Ekspertiz PDF'i yüklüyse ekspertiz TAMAM'dır.
//   • Aracın TRAMER KAYDI OLMAYABİLİR → arac_tramer'de satır olmaz. SBM görseli
//     yüklüyse tramer sorgusu TAMAM'dır.
// Böylece "tramer görselini yükledim ama hâlâ Tramer Bekliyor yazıyor" biter.
const ekspertizPdfVar = () => EVR.some(e => e.tip === 'EKSPERTIZ_PDF' || e.tip === 'EKSPERTIZ_LINK')
const tramerBelgeVar = () => EVR.some(e => e.tip === 'SBM_GORSEL')
const ekspertizTamam = () => EKS.length > 0 || ekspertizPdfVar()
const tramerTamam = () => TRM.length > 0 || tramerBelgeVar()
// İlgili belgenin yüklenme zamanı (zaman çizelgesi için)
const evrakZamani = tipler => EVR.filter(e => tipler.includes(e.tip)).map(e => e.created_at).sort()[0] || null

function durumEtiketi() {
  const amber = 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30'
  // Rezervasyon Sistemi 2.0 — REZERVE/SIPARISTE/TESLIM_EDILDI stoktaMi() içinde de
  // sayılıyor (fiyatlandı sayılsınlar diye), ama üst rozette gerçek durumu göster.
  if (ARAC.durum === 'REZERVE') return { ad: 'Rezerve', cls: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30' }
  if (ARAC.durum === 'SIPARISTE') return { ad: 'Siparişte', cls: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#3B82F6]/30' }
  if (ARAC.durum === 'TESLIM_EDILDI') return { ad: 'Teslim Edildi', cls: 'bg-surface-container-high text-on-surface-variant border-outline-variant' }
  if (stoktaMi()) return { ad: ARAC.durum === 'YAYINDA' ? 'Yayında' : 'Stokta', cls: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#3B82F6]/30' }
  if (!ekspertizTamam()) return { ad: 'Ekspertiz Bekliyor', cls: amber }
  if (!tramerTamam()) return { ad: 'Tramer Bekliyor', cls: amber }
  if (!fiyatlandiMi()) return { ad: 'Fiyatlama Bekliyor', cls: amber }
  return { ad: 'Stoğa Hazır', cls: 'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30' }
}

// webpCevir → arac-dosya.js (yukarıda import edildi). Buradaki kopya kaldırıldı.

// =====================================================================
// Veri yükleme
// =====================================================================
async function veriYukle(aracId, d) {
  DANISMAN = d
  duzenleArac = false; duzenleAlis = false; duzenId = null; EKSP_DIRTY = false; EKSP_PDF = null; EKSP_FIRMA = null; TRAMER_GORSEL = null
  MASRAFLAR = []; NETMALIYET = null; FOTOLAR = []; EKS = []; TRM = []; EVR = []; OLAY = []; ICHIZMET = []
  REZ = null; REZ_DRAWER = false; REZ_MUSTERI = null; REZ_YENI_MUSTERI = false; REZ_SURE = '24h'
  REZ_UZAT = false; REZ_DUZENLE = false; REZ_GUARD_DETAY = false
  if (REZ_TIMER) { clearInterval(REZ_TIMER); REZ_TIMER = null }
  if (REZ_ESC) { document.removeEventListener('keydown', REZ_ESC); REZ_ESC = null }
  DMAP = await danismanMap()

  const [tan, arac, alis, mvar, evr, eks, trm, foto, olay, rez, ich] = await Promise.all([
    supabase.from('tanimlar').select('tip,kod,ad,ozellikler').eq('aktif', true)
      .in('tip', ['MASRAF_TIPI', 'ALIS_SEKLI', 'YAKIT', 'VITES', 'KASA_TIPI', 'RENK', 'ARAC_TIPI', 'LOKASYON', 'PARK']).order('sira'),
    supabase.from('stok_araclar')
      // ⚠️ Kolon listesi ELLE tutuluyor: olmayan bir ad yazılırsa PostgREST
      //    400 döner ve SAYFA BOŞ AÇILIR (v233'te bu yüzden kesinti oldu).
      //    Yeni kolon eklerken önce DB'de var olduğunu doğrula.
      .select('id,plaka,sasi_no,motor_no,marka,model,versiyon,yil,yakit,vites,kasa_tipi,renk,arac_tipi,km,tsb_marka_id,tsb_tip_id,ruhsat_seri_no,lokasyon,park,yedek_anahtar,durum,muayene_tarihi,tescil_tarihi,ilk_tescil_tarihi,notu,fiyatlama_durumu,kdv_orani,ekspertiz_firma,guncel_ekspertiz_istendi,olusturan,created_at,updated_at')
      .eq('id', aracId).maybeSingle(),
    supabase.from('arac_alislar').select('alis_fiyati,noter_alis_fiyati,alis_sekli,alis_tarihi,noter_adi,yevmiye_no,noter_tarihi,satici_musteri_id,satici:musteriler!satici_musteri_id(ad_soyad,telefon)')
      .eq('arac_id', aracId).order('alis_tarihi', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('masraf_varsayilanlari').select('masraf_tipi,alis_sekli,tutar').eq('aktif', true),
    supabase.from('arac_evraklar').select('id,tip,url,created_at').eq('arac_id', aracId).order('created_at'),
    supabase.from('arac_ekspertiz').select('parca_kodu,durum,created_at').eq('arac_id', aracId),
    supabase.from('arac_tramer').select('id,sorgu_tarihi,hasar_tarihi,aciklama,tutar,created_at').eq('arac_id', aracId).order('hasar_tarihi', { ascending: false }),
    supabase.from('arac_fotograflari').select('id,dosya_yolu,sira,created_at').eq('arac_id', aracId).order('sira').order('created_at'),
      supabase.from('olaylar').select('tip,veri,danisman_id,olusma_zamani').eq('arac_id', aracId).order('olusma_zamani', { ascending: false }).limit(50),
    supabase.from('siparisler')
      .select('id,arac_id,alici_musteri_id,danisman_id,asama,durum,gecerlilik_bitis,anlasilan_tutar,satis_sekli,rezervasyon_nedeni,kapora_tutar,rezervasyon_notu,created_at,musteriler(ad_soyad,telefon)')
      .eq('arac_id', aracId).in('asama', ['REZERVASYON', 'SIPARIS']).eq('durum', 'ACIK')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    // F7 — iç hizmetler (pasta cila / kuaför). Herkes GÖRÜR, prim tutarı YOK.
    supabase.from('ic_hizmetler')
      .select('id,islem_turu,personel_id,notu,created_at,operasyon_islem_turleri(ad)')
      .eq('arac_id', aracId).order('created_at', { ascending: false }),
  ])
  if (arac.error) { dbHata('araç detay', arac.error); ARAC = null; return }
  ARAC = arac.data || null
  if (!ARAC) return
  TANIM = {}; for (const t of (tan.data || [])) (TANIM[t.tip] = TANIM[t.tip] || []).push(t)
  MVAR = mvar.data || []; ALIS = alis.data || null
  EVR = evr.data || []; EKS = eks.data || []; TRM = trm.data || []; FOTOLAR = foto.data || []; OLAY = olay.data || []
  if (ich.error) dbHata('ic_hizmetler', ich.error); else ICHIZMET = ich.data || []
  if (tan.error) dbHata('tanımlar', tan.error)
  if (rez.error) { dbHata('aktif rezervasyon', rez.error); REZ = null } else REZ = rez.data || null
  EKSP_PANEL = Object.fromEntries(PARCALAR.map(p => [p, 'ORIJINAL']))
  for (const e of EKS) if (EKSP_PANEL[e.parca_kodu] !== undefined) EKSP_PANEL[e.parca_kodu] = e.durum
  if (!SVGTXT) SVGTXT = await fetch('img/ekspertiz-sema.svg').then(r => r.text()).catch(() => '')
  if (finansGorur(d)) await masrafYukle(aracId)
}
async function masrafYukle(aracId) {
  const [{ data: mler, error: e1 }, { data: mal, error: e2 }] = await Promise.all([
    supabase.from('arac_masraflar').select('id,masraf_tipi,yon,tutar,tedarikci,tarih,aciklama,olusturan,created_at')
      .eq('arac_id', aracId).order('tarih', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('v_arac_maliyet').select('maliyet').eq('arac_id', aracId).maybeSingle(),
  ])
  if (e1) { dbHata('masraf defteri', e1); MASRAFLAR = [] } else MASRAFLAR = mler || []
  if (e2) { dbHata('v_arac_maliyet', e2); NETMALIYET = null } else NETMALIYET = mal ? Number(mal.maliyet) : null
}

// =====================================================================
// Giriş noktaları
// =====================================================================
export async function aracDetayKur(d) {
  const ref = urlParam('ref')
  if (!ref) { KOK().innerHTML = uyari('Araç seçilmedi.'); return }
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Araç yükleniyor…</div>`
  aktifSekme = 'ozet'
  await veriYukle(ref, d)
  if (!ARAC) { KOK().innerHTML = uyari('Araç bulunamadı.'); return }
  KAP = KOK(); MODAL = null; ONKAPAT = null; MODAL_KAPAT = null
  ciz()
}

export async function aracDetayAc(aracId, d, opts = {}) {
  aktifSekme = opts.sekme || 'ozet'
  ONKAPAT = opts.onKapat || null
  const ov = document.createElement('div')
  ov.id = 'adModal'
  ov.className = 'fixed inset-0 z-[60] flex items-stretch md:items-center justify-center p-0 md:p-4'
  ov.innerHTML = `
    <div class="ad-arka absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
    <div class="relative bg-surface-container-lowest w-full md:max-w-[1440px] md:rounded-2xl shadow-2xl h-[100dvh] md:h-[95vh] flex flex-col overflow-hidden">
      <div id="adKap" class="flex-1 overflow-y-auto p-4 md:p-6"><div class="py-24 text-center text-on-surface-variant">Araç yükleniyor…</div></div>
    </div>`
  document.body.appendChild(ov)
  document.body.style.overflow = 'hidden'
  MODAL = ov; KAP = ov.querySelector('#adKap')
  const kapat = () => {
    if (ESCDINLE) { document.removeEventListener('keydown', ESCDINLE); ESCDINLE = null }
    if (REZ_TIMER) { clearInterval(REZ_TIMER); REZ_TIMER = null }
    if (REZ_ESC) { document.removeEventListener('keydown', REZ_ESC); REZ_ESC = null }
    ov.remove(); document.body.style.overflow = ''; MODAL = null; MODAL_KAPAT = null
    const cb = ONKAPAT; ONKAPAT = null
    if (typeof cb === 'function') cb()
  }
  MODAL_KAPAT = kapat
  ov.querySelector('.ad-arka').addEventListener('click', kapat)
  ESCDINLE = e => { if (e.key === 'Escape') kapat() }
  document.addEventListener('keydown', ESCDINLE)
  await veriYukle(aracId, d)
  if (!ARAC) { KAP.innerHTML = uyari('Araç bulunamadı.'); return }
  ciz()
}

// =====================================================================
// Çizim
// =====================================================================
function ciz() {
  if (!KAP) return
  kartMenuKapat()
  KAP.innerHTML = icerikHtml()
  bagla()
  ekspertizCiz()   // #adSvg varsa çizer (Özet'te ekspertiz kartı), yoksa no-op
  evrakGomCiz()    // yüklü ekspertiz PDF'i + tramer görselini kartın içine göm
  evrakOnizleCiz() // Evraklar sekmesindeki her belgeyi canlı önizle
  rezSayacBaslat() // aktif rezervasyon varsa canlı geri sayımı başlatır, yoksa no-op
}

function plakaBadge() {
  const p = (ARAC.plaka || '').toUpperCase()
  return `<div class="flex items-center bg-surface-container-low border border-outline-variant rounded-lg overflow-hidden h-9">
    <span class="bg-[#1e40af] text-white text-[10px] font-bold px-1.5 self-stretch flex items-center">TR</span>
    <span class="font-bold tracking-wide text-on-surface px-2">${kacis(p) || '—'}</span>
    <button id="adKopyaPlaka" class="px-2 text-outline hover:text-primary self-stretch" title="Plakayı kopyala">${mat('content_copy', 'text-[15px]')}</button>
  </div>`
}

function icerikHtml() {
  const a = ARAC
  const kunye = `${a.yil ? a.yil + ' ' : ''}${B(a.marka)} ${B(a.model)}`.trim() || '—'
  const alt = [B(a.versiyon), a.km != null ? `${Number(a.km).toLocaleString('tr-TR')} km` : '', B(tanimAd('YAKIT', a.yakit) || a.yakit), B(tanimAd('VITES', a.vites) || a.vites), B(tanimAd('RENK', a.renk) || a.renk)].filter(Boolean).join(' · ')
  const dur = durumEtiketi()
  const btnDis = 'px-3 h-9 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:bg-surface-container-low flex items-center gap-1'

  const sekmeBar = `<div class="flex flex-wrap items-center gap-1 p-1 bg-surface-container-high rounded-xl">
    ${SEKMELER.map(([k, l, ik]) => {
    if (k === 'masraf' && !finansGorur(DANISMAN)) return ''
    const kilit = k === 'masraf' ? ` ${mat('lock', 'text-[13px]')}` : ''
    const rozet = k === 'masraf' && MASRAFLAR.length ? `<span class="ml-0.5 bg-primary/10 text-primary text-[10px] px-1.5 rounded-full">${MASRAFLAR.length}</span>` : ''
    const aktif = aktifSekme === k
    return `<button data-sekme="${k}" class="whitespace-nowrap flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-lg transition-all ${aktif ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-lowest/50'}">${mat(ik, 'text-[18px]')}${l}${kilit}${rozet}</button>`
  }).join('')}
  </div>`

  return `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2.5 min-w-0">
          ${MODAL
      ? `<button class="ad-kapat2 w-9 h-9 rounded-full border border-outline-variant flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low shrink-0" title="Kapat">${mat('close', 'text-[18px]')}</button>`
      : `<a href="arac-kabul.html" class="w-9 h-9 rounded-full border border-outline-variant flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low shrink-0">${mat('arrow_back', 'text-[18px]')}</a>`}
          ${plakaBadge()}
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold border ${dur.cls} whitespace-nowrap">${dur.ad}</span>
        </div>
        <div class="text-center flex-1 min-w-[180px] order-last lg:order-none w-full lg:w-auto">
          <h2 class="text-headline-md font-extrabold text-on-surface leading-tight">${kunye}</h2>
          <p class="text-body-sm text-on-surface-variant">${alt || '—'}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${MODAL ? `<button id="adTamSayfa" class="${btnDis}" title="Tam sayfada aç">${mat('open_in_new', 'text-[16px]')}<span class="hidden sm:inline">Tam sayfa</span></button>` : ''}
          <button id="adYazdir" class="${btnDis}">${mat('print', 'text-[16px]')} Yazdır</button>
          ${MODAL ? `<button class="ad-kapat2 px-3 h-9 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1">${mat('close', 'text-[16px]')} Kapat</button>` : ''}
        </div>
      </div>
      ${sekmeBar}
      <div id="adSekme">${sekmeIcerik()}</div>
      ${footerHtml()}
    </div>`
}

function footerHtml() {
  return `<div class="flex items-center justify-between flex-wrap gap-2 text-[11px] text-on-surface-variant border-t border-outline-variant pt-3">
    <span>Oluşturan: <b>${B(danismanAdi(DMAP, ARAC.olusturan)) || '—'}</b> · ${ARAC.created_at ? fmtTarih(ARAC.created_at) : '—'}</span>
    <span class="flex items-center gap-1">Son güncelleme: ${ARAC.updated_at ? fmtTarih(ARAC.updated_at) : '—'} ${mat('sync', 'text-[13px]')}</span>
  </div>`
}

function sekmeIcerik() {
  switch (aktifSekme) {
    case 'ozet': return ozetHtml()
    case 'evraklar': return evraklarHtml()
    case 'ekspertiz': return ekspertizHtml()
    case 'tramer': return tramerHtml()
    case 'surec': return surecHtml()
    case 'masraf': return finansGorur(DANISMAN) ? masrafHtml() : masrafGizliHtml()
    default: return ''
  }
}

// ---- Kart kabuğu ----
function kart(ikon, baslik, ic, sag) {
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5">
    <div class="flex items-center justify-between gap-2 mb-3">
      <h3 class="text-sm font-bold text-primary flex items-center gap-2">${mat(ikon, 'text-[18px]')} ${baslik}</h3>
      ${sag != null ? sag : ''}
    </div>
    ${ic}
  </div>`
}

// =====================================================================
// ÖZET — 3 sütun
// =====================================================================
function ozetHtml() {
  return `<div class="flex flex-col gap-4 md:gap-5">
    ${rezervasyonSeridi()}
    <div class="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr_0.95fr] gap-4 md:gap-5 items-start">
      <div class="flex flex-col gap-4 md:gap-5">
        ${aracBilgiKart()}
        ${fotoGaleriHtml()}
      </div>
      <div class="flex flex-col gap-4 md:gap-5">
        ${durumOzetiHtml()}
        ${alisNotKart()}
      </div>
      <div class="flex flex-col gap-4 md:gap-5">
        ${hizliBilgiHtml()}
        ${hazirlikHtml()}
        ${kisaYolHtml()}
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 items-start">
      ${ekspertizHtml()}
      ${tramerHtml()}
    </div>
  </div>${rezDrawerHtml()}`
}

function satirCift(et, deger) {
  return `<div class="flex items-center justify-between gap-3 py-2 border-b border-outline-variant/40 last:border-0">
    <span class="text-body-sm text-on-surface-variant">${et}</span>
    <span class="text-body-sm font-bold text-right text-on-surface">${deger}</span></div>`
}

// ---- Araç Bilgileri (oku / düzenle) ----
function aracBilgiKart() {
  const a = ARAC
  if (duzenleArac && !aracKilitli()) return aracBilgiDuzenle()
  if (duzenleArac && aracKilitli()) duzenleArac = false   // kilitliyken düzenleme açılamaz
  const sol = [
    ['Plaka', B(a.plaka) || '—'], ['Şasi No', a.sasi_no ? kacis(a.sasi_no.toUpperCase()) : '—'],
    ['Motor No', a.motor_no ? kacis(a.motor_no.toUpperCase()) : '—'],
    ['Marka / Model', `${B(a.marka)} ${B(a.model)}`.trim() || '—'], ['Versiyon', B(a.versiyon) || '—'],
    ['Model Yılı', a.yil || '—'], ['Yakıt', B(tanimAd('YAKIT', a.yakit)) || B(a.yakit) || '—'],
    ['Vites', B(tanimAd('VITES', a.vites)) || B(a.vites) || '—'],
  ]
  const sag = [
    ['Kilometre', a.km != null ? Number(a.km).toLocaleString('tr-TR') + ' km' : '—'],
    ['Kasa Tipi', B(tanimAd('KASA_TIPI', a.kasa_tipi)) || B(a.kasa_tipi) || '—'],
    ['Renk', B(tanimAd('RENK', a.renk)) || B(a.renk) || '—'],
    ['Ruhsat Seri No', a.ruhsat_seri_no ? kacis(a.ruhsat_seri_no.toUpperCase()) : '—'],
    // Kendi tesisimizse satır hiç çizilmez — her araçta aynı, bilgi taşımıyor.
    // Dışarıdaysa (konsinye/servis) gösterilir. Bkz veri.js disLokasyon.
    ...(disLokasyon(a.lokasyon) ? [['Lokasyon', B(tanimAd('LOKASYON', a.lokasyon)) || B(a.lokasyon)]] : []),
    ['Park Yeri', B(tanimAd('PARK', a.park)) || B(a.park) || '—'],
    ['Yedek Anahtar', a.yedek_anahtar ? `<span class="inline-flex items-center gap-1 text-green-600">${mat('check_circle', 'text-[15px]')} Var</span>` : 'Yok'],
    ['Muayene', a.muayene_tarihi ? fmtTarih(a.muayene_tarihi) : '—'],
    ['Alış KDV', kdvSatirHtml()],
    ['Sorumlu', `<span class="inline-flex items-center gap-1.5">${mat('account_circle', 'text-outline text-[18px]')} ${B(danismanAdi(DMAP, a.olusturan)) || '—'}</span>`],
  ]
  const ic = `<div class="grid md:grid-cols-2 gap-x-8">
    <div>${sol.map(([e, v]) => satirCift(e, v)).join('')}</div>
    <div>${sag.map(([e, v]) => satirCift(e, v)).join('')}</div>
  </div>`
  const menu = aracKilitli()
    ? `<span class="text-[11px] font-semibold text-on-surface-variant flex items-center gap-1" title="Araç fiyatlamaya gönderildi — araç bilgileri düzenlemesi İsmail Bey / yöneticide">${mat('lock', 'text-[14px]')} Fiyatlamada</span>`
    : `<button id="adAracMenu" class="w-7 h-7 rounded-lg hover:bg-surface-container-high flex items-center justify-center text-outline" title="Seçenekler">${mat('more_horiz', 'text-[18px]')}</button>`
  return kart('directions_car', 'ARAÇ BİLGİLERİ', ic, menu)
}
// ---- Alış KDV tagı (muhasebe) ----
// Yetkisiz kullanıcı SALT-OKUR (rozet). Yetkili anında değiştirir — ayrı
// "Kaydet" yok, seçince yazılır. Sunucu koruması: sql/82 trg_stok_kdv_koru.
const KDV_RENK_D = {
  '1':         'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30',
  '20':        'bg-[#EFF6FF] text-[#1D4ED8] border-[#3B82F6]/30',
  OZEL_MATRAH: 'bg-[#F5F3FF] text-[#6D28D9] border-[#8B5CF6]/30',
  BELLI_DEGIL: 'bg-surface-container-high text-on-surface-variant border-outline-variant/40',
}
function kdvSatirHtml() {
  const k = ARAC.kdv_orani || 'BELLI_DEGIL'
  if (!kdvYonetir(DANISMAN)) {
    return `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${KDV_RENK_D[k]}">${kacis(kdvEtiket(k))}</span>`
  }
  return `<select id="d_kdv_hizli" class="border border-outline-variant rounded-lg pl-2.5 pr-8 py-1 text-body-sm bg-surface-container-low font-bold">
    ${KDV_KODLARI.map(x => `<option value="${x}"${x === k ? ' selected' : ''}>${kacis(kdvEtiket(x))}</option>`).join('')}
  </select>`
}
async function kdvKaydet(yeni) {
  const { data, error } = await supabase.from('stok_araclar').update({ kdv_orani: yeni }).eq('id', ARAC.id).select('id,kdv_orani')
  if (error) { dbHata('kdv güncelle', error); uyariGoster('KDV kaydedilemedi: ' + error.message); ciz(); return }
  if (!data?.length) { uyariGoster('KDV güncellenemedi — yetki yok.'); ciz(); return }
  ARAC.kdv_orani = data[0].kdv_orani
  uyariGoster('Alış KDV: ' + kdvEtiket(ARAC.kdv_orani), true)
}

function selDuz(id, tip, val) {
  const ops = (TANIM[tip] || []).map(t => `<option value="${kacis(t.kod)}"${t.kod === val ? ' selected' : ''}>${kacis(t.ad)}</option>`).join('')
  return `<select id="${id}" class="${INP}"><option value="">—</option>${ops}</select>`
}
function alanDuz(et, ic) { return `<div class="flex flex-col gap-1"><label class="text-[11px] font-bold text-on-surface-variant uppercase">${et}</label>${ic}</div>` }
function aracBilgiDuzenle() {
  const a = ARAC, v = s => kacis(s ?? '')
  const ic = `<div class="flex flex-col gap-4">
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      ${alanDuz('Plaka', `<input id="d_plaka" value="${v(a.plaka)}" style="text-transform:uppercase" class="${INP} font-bold text-primary" />`)}
      ${alanDuz('Şasi No', `<input id="d_sasi" maxlength="17" value="${v(a.sasi_no)}" style="text-transform:uppercase" class="${INP} font-mono" />`)}
      ${alanDuz('Motor No', `<input id="d_motor" value="${v(a.motor_no)}" style="text-transform:uppercase" class="${INP} font-mono" />`)}
      ${alanDuz('Marka', `<input id="d_marka" value="${v(a.marka)}" class="${INP}" />`)}
      ${alanDuz('Model', `<input id="d_model" value="${v(a.model)}" class="${INP}" />`)}
      ${alanDuz('Versiyon', `<input id="d_versiyon" value="${v(a.versiyon)}" class="${INP}" />`)}
      ${alanDuz('Model Yılı', `<input id="d_yil" type="number" value="${v(a.yil)}" class="${INP}" />`)}
      ${alanDuz('Kilometre', `<input id="d_km" type="number" value="${v(a.km)}" class="${INP}" />`)}
      ${alanDuz('Ruhsat Seri No', `<input id="d_ruhsatseri" value="${v(a.ruhsat_seri_no)}" style="text-transform:uppercase" class="${INP}" />`)}
      ${alanDuz('Yakıt', selDuz('d_yakit', 'YAKIT', a.yakit))}
      ${alanDuz('Vites', selDuz('d_vites', 'VITES', a.vites))}
      ${alanDuz('Kasa Tipi', selDuz('d_kasa', 'KASA_TIPI', a.kasa_tipi))}
      ${alanDuz('Renk', selDuz('d_renk', 'RENK', a.renk))}
      ${alanDuz('Lokasyon', selDuz('d_lokasyon', 'LOKASYON', a.lokasyon))}
      ${alanDuz('Park Yeri', selDuz('d_park', 'PARK', a.park))}
      ${alanDuz('Muayene', `<input id="d_muayene" type="date" value="${v(a.muayene_tarihi)}" class="${INP}" />`)}
      ${/* Tescil tarihleri: yeni araçta ruhsat OCR dolduruyor, ESKİ araçlarda
            NULL. Bilgi işlem evrak takibi bu alanı istiyor — buradan elle
            tamamlanabilsin (sql/153). */''}
      ${alanDuz('Tescil Tarihi', `<input id="d_tescil" type="date" value="${v(a.tescil_tarihi)}" class="${INP}" />`)}
      ${alanDuz('İlk Tescil', `<input id="d_ilktescil" type="date" value="${v(a.ilk_tescil_tarihi)}" class="${INP}" />`)}
      <div class="flex items-end pb-2"><label class="flex items-center gap-2 text-sm font-semibold cursor-pointer select-none">
        <input id="d_anahtar" type="checkbox" ${a.yedek_anahtar ? 'checked' : ''} style="width:20px;height:20px;accent-color:#5f1818;-webkit-appearance:auto;appearance:auto;flex:none;cursor:pointer;margin:0" />
        Yedek Anahtar</label></div>
    </div>
    <div id="adAracHata" class="hidden text-sm text-error"></div>
    <div class="flex items-center gap-2 justify-end">
      <button id="adAracVazgec" class="px-4 h-9 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:bg-surface-container-low">Vazgeç</button>
      <button id="adAracKaydet" class="px-5 h-9 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1">${mat('save', 'text-[16px]')} Kaydet</button>
    </div></div>`
  return kart('directions_car', 'ARAÇ BİLGİLERİNİ DÜZENLE', ic, `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">DÜZENLEME</span>`)
}

// ---- Durum Özeti (numaralı timeline) ----
function durumOzetiHtml() {
  const km = [
    { ad: 'Araç Kabul', tamam: true, t: ARAC.created_at },
    { ad: 'Ekspertiz', tamam: ekspertizTamam(), t: EKS.length ? EKS.map(e => e.created_at).sort()[0] : evrakZamani(['EKSPERTIZ_PDF', 'EKSPERTIZ_LINK']) },
    { ad: 'Tramer', tamam: tramerTamam(), t: TRM.length ? TRM.map(e => e.created_at).sort()[0] : evrakZamani(['SBM_GORSEL']) },
    { ad: 'Fiyatlama', tamam: fiyatlandiMi(), t: null },
    { ad: 'Stoğa Aktarma', tamam: stoktaMi(), t: null },
  ]
  const nokta = (m, i, son) => {
    const yuvar = m.tamam
      ? `<span class="w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0" style="font-variation-settings:'FILL' 1">${mat('check', 'text-[16px]')}</span>`
      : `<span class="w-7 h-7 rounded-full border-2 border-outline text-on-surface-variant flex items-center justify-center shrink-0 text-[12px] font-bold">${i + 1}</span>`
    return `<div class="flex gap-3">
      <div class="flex flex-col items-center">${yuvar}${son ? '' : `<span class="w-px flex-1 my-1 ${m.tamam ? 'bg-primary/40' : 'bg-outline-variant'}"></span>`}</div>
      <div class="pb-4 flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="text-body-sm font-bold ${m.tamam ? 'text-on-surface' : 'text-on-surface-variant'}">${m.ad}</span>
          ${m.tamam ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857]">Tamamlandı</span>` : ''}
        </div>
        <div class="text-[11px] text-on-surface-variant">${m.tamam && m.t ? fmtTarih(m.t) : (m.tamam ? '' : 'Bekliyor')}</div>
      </div></div>`
  }
  const timeline = km.map((m, i) => nokta(m, i, i === km.length - 1)).join('')
  const bekliyor = ARAC.fiyatlama_durumu === 'BEKLIYOR' && !fiyatlandiMi()
  const kabulHazir = ekspertizTamam() && tramerTamam()
  let alt
  if (fiyatlandiMi()) alt = `<div class="mt-1 p-2.5 rounded-lg text-center text-body-sm font-bold bg-[#EFF6FF] text-[#1D4ED8]">✅ Fiyatlandı</div>`
  else if (bekliyor) alt = `<div class="mt-1 p-2.5 rounded-lg text-center text-body-sm font-bold bg-primary/10 text-primary">🕒 Fiyatlama kuyruğunda</div>
    <button id="adFiyatGeri" class="w-full mt-2 py-2 rounded-lg border border-outline-variant text-body-sm font-semibold hover:bg-surface-container-low">Kuyruktan Geri Al</button>`
  else if (kabulHazir) alt = `<div class="mt-1 p-2.5 rounded-lg bg-[#ECFDF5] border border-[#10B981]/30 text-center text-body-sm font-bold text-[#047857]">🟢 Kabul tamamlandı — fiyatlamaya hazır</div>
    <button id="adFiyatGonder" class="w-full mt-2 py-2.5 rounded-lg bg-primary text-on-primary text-body-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('sell', 'text-[18px]')} Fiyatlamaya Gönder</button>`
  else alt = `<div class="mt-1 p-2.5 rounded-lg text-center text-[11px] text-on-surface-variant bg-surface-container-low">Ekspertiz ve tramer tamamlanınca fiyatlamaya gönderebilirsin.</div>`
  return kart('donut_large', 'DURUM ÖZETİ', `<div>${timeline}</div>${alt}`)
}

// ---- Alış Bilgileri + Stok Notu (finans) ----
function alisNotKart() {
  const finans = finansGorur(DANISMAN)
  const bilgiIslem = !finans && bilgiIslemMi(DANISMAN)   // sınırlı: yalnız Noter Alış + Alış Tarihi
  const alisYetki = finans || bilgiIslem
  const notGoster = `<div class="mt-3 pt-3 border-t border-outline-variant">
    <div class="text-[11px] font-bold text-on-surface-variant uppercase mb-1">Stok Notu</div>
    <p class="text-body-sm text-on-surface-variant whitespace-pre-wrap bg-surface-container-low rounded-lg p-2.5 min-h-[3rem]">${ARAC.notu ? kacis(ARAC.notu) : 'Not girilmemiş. (Fotoğraflar altından ekleyebilirsin.)'}</p></div>`
  if (!alisYetki) return kart('sticky_note_2', 'STOK NOTU', notGoster.replace('mt-3 pt-3 border-t border-outline-variant', ''))

  const noter = ALIS?.noter_alis_fiyati != null ? Number(ALIS.noter_alis_fiyati) : null
  // Alış tarafının noter kaydı (sql/180). Satışta noter adı / yevmiye no /
  // noter tarihi vardı, alışta yalnız TUTAR tutuluyordu — aracın mülkiyet
  // zincirinde kopukluk bırakıyordu (Göksenil, 10 Ağu 2026). Bilgi işlem girer.
  if (duzenleAlis) {
    const v = s => kacis(s ?? '')
    const ic = `<div class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3">
        ${alanDuz('Noter Alış (₺)', `<input id="d_noterfiyat" type="number" value="${v(ALIS?.noter_alis_fiyati)}" class="${INP} font-bold" />`)}
        ${finans ? alanDuz('Alış Şekli', selDuz('d_alissekli', 'ALIS_SEKLI', ALIS?.alis_sekli)) : ''}
        ${alanDuz('Alış Tarihi', `<input id="d_alistarih" type="date" value="${v(ALIS?.alis_tarihi)}" class="${INP}" />`)}
      </div>
      <div class="grid grid-cols-2 gap-3 pt-3 border-t border-outline-variant">
        ${alanDuz('Noter (alış devri)', `<input id="d_alisnoter" type="text" value="${v(ALIS?.noter_adi)}" placeholder="İZMİR 23. NOTERLİĞİ" class="${INP}" />`)}
        ${alanDuz('Yevmiye No', `<input id="d_alisyevmiye" type="text" value="${v(ALIS?.yevmiye_no)}" placeholder="12345" class="${INP}" />`)}
        ${alanDuz('Noter Tarihi', `<input id="d_alisnotertarih" type="date" value="${v(ALIS?.noter_tarihi)}" class="${INP}" />`)}
      </div>
      <p class="text-[11px] text-on-surface-variant">Noter tarihi alış tarihinden farklı olabilir — araç bugün alınıp devir ertesi gün yapılabilir.</p>
      ${bilgiIslem ? `<p class="text-[11px] text-on-surface-variant">Bilgi işlem Noter Alış, Alış Tarihi ve noter devir bilgilerini düzenler; Alış Şekli İsmail Bey / yöneticide.</p>` : ''}
      ${ALIS ? '' : `<p class="text-[11px] text-on-surface-variant">Alış kaydı yok — kaydedince oluşturulur.</p>`}
      ${notGoster}
      <div class="flex items-center gap-2 justify-end">
        <button id="adAlisVazgec" class="px-4 h-9 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:bg-surface-container-low">Vazgeç</button>
        <button id="adAlisKaydet" class="px-5 h-9 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1">${mat('save', 'text-[16px]')} Kaydet</button>
      </div></div>`
    return kart('payments', 'ALIŞ BİLGİLERİ', ic, `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">DÜZENLEME</span>`)
  }
  const sat = ALIS?.satici || null
  const saticiDeger = sat?.ad_soyad
    ? `${B(sat.ad_soyad)}${sat.telefon ? ` · <span class="font-normal text-on-surface-variant">${kacis(telBicim(sat.telefon))}</span>` : ''}`
    : '—'
  const ic = `${satirCift('Satıcı', saticiDeger)}
    ${satirCift('Noter Alış', noter != null ? fmtPara(noter) : '—')}
    ${satirCift('Alış Şekli', B(tanimAd('ALIS_SEKLI', ALIS?.alis_sekli)) || '—')}
    ${satirCift('Alış Tarihi', ALIS?.alis_tarihi ? fmtTarih(ALIS.alis_tarihi) : '—')}
    ${satirCift('Noter (alış devri)', B(ALIS?.noter_adi) || '—')}
    ${satirCift('Yevmiye No', B(ALIS?.yevmiye_no) || '—')}
    ${satirCift('Noter Tarihi', ALIS?.noter_tarihi ? fmtTarih(ALIS.noter_tarihi) : '—')}
    ${notGoster}`
  return kart('payments', 'ALIŞ BİLGİLERİ', ic, `<button id="adAlisDuzenle" class="px-3 h-8 rounded-lg border border-outline-variant text-[12px] font-bold text-on-surface-variant hover:border-primary/40 hover:text-primary hover:bg-primary/5 flex items-center gap-1 transition-colors">${mat('edit', 'text-[15px]')} Düzenle</button>`)
}

// ---- Aktif Önizleme (eski "Hızlı Bilgiler") ----
// Göksenil kararı (AŞAMA 4): Alış Fiyatı · Net Maliyet · Tahmini Değer · Tahmini
// Kâr BURADAN KALDIRILDI — bu rakamlar İsmail Bey'in Fiyatlama ekranına ait.
// Yerine Araç Kabul'deki "Aktif Önizleme" kartı geldi (aynı görsel dil).
function hizliBilgiHtml() {
  const a = ARAC
  const kunye = `${B(a.marka)} ${B(a.model)}`.trim() || 'Araç'
  const alt = [a.yil || '', B(a.versiyon)].filter(Boolean).join(' · ')
  const kapak = FOTOLAR.length ? fotoUrl(FOTOLAR[0].dosya_yolu) : null
  const kutu = (et, deger) => `<div><span class="block opacity-60 text-[10px] uppercase tracking-wide">${et}</span><span class="text-xs font-bold">${deger}</span></div>`
  return `<div class="bg-inverse-surface text-inverse-on-surface rounded-xl overflow-hidden custom-shadow">
    <div class="relative h-28 bg-gradient-to-br from-primary to-[#3a0d0d] flex items-end p-4 overflow-hidden">
      ${kapak
      ? `<img src="${kacis(kapak)}" alt="" class="absolute inset-0 w-full h-full object-cover opacity-35" loading="lazy" onerror="this.remove()" />`
      : `<span class="material-symbols-outlined absolute -right-2 -top-3 text-white/10 text-[130px] leading-none select-none">directions_car</span>`}
      <div class="relative">
        <span class="bg-primary text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider inline-block mb-1">Aktif Önizleme</span>
        <h4 class="text-lg font-bold leading-tight">${B(a.plaka) || '—'}</h4>
        <p class="text-xs opacity-80">${kunye}${alt ? ' · ' + alt : ''}</p>
      </div>
    </div>
    <div class="p-4 grid grid-cols-2 gap-3">
      ${kutu('Şase', a.sasi_no ? kacis(a.sasi_no.toUpperCase()) : '—')}
      ${kutu('Kilometre', a.km != null ? Number(a.km).toLocaleString('tr-TR') + ' KM' : '—')}
      ${kutu('Ekspertiz', ekspertizTamam()
      ? `${PARCALAR.filter(p => EKSP_PANEL[p] !== 'ORIJINAL').length || 'Orijinal'}${PARCALAR.some(p => EKSP_PANEL[p] !== 'ORIJINAL') ? ' parça' : ''}`
      : '<span class="text-amber-300">bekliyor</span>')}
      ${kutu('Tramer', tramerTamam()
      ? (TRM.length ? TRM.reduce((s, t) => s + (Number(t.tutar) || 0), 0).toLocaleString('tr-TR') + ' ₺' : 'Kayıt yok')
      : '<span class="text-amber-300">bekliyor</span>')}
    </div>
  </div>`
}

// ---- Hazırlık (iç hizmet: pasta cila / kuaför) ----
// Göksenil: "Pasta cila ve kuaför satış danışmanlarının araç kartında
// görebileceği bir yerde olacak — 'kuaförü yapıldı', 'pasta cilası yapıldı'."
// PRİM TUTARI BURADA YOK: personel primi finansın tarifesinden hesaplanır,
// satış danışmanı görmez (ic_hizmetler tablosunda para alanı da yok).
function hazirlikHtml() {
  if (!ICHIZMET.length) return ''
  const ik = { PASTA_CILA: 'auto_awesome', KUAFOR: 'cleaning_services' }
  const ic = ICHIZMET.map(h => {
    const ad = one(h.operasyon_islem_turleri)?.ad || h.islem_turu
    return `<div class="flex items-center gap-2.5 py-1.5">
      <span class="w-8 h-8 rounded-lg bg-[#ECFDF5] text-[#047857] flex items-center justify-center shrink-0">${mat(ik[h.islem_turu] || 'check', 'text-[18px]')}</span>
      <div class="min-w-0 flex-1">
        <div class="text-body-sm font-bold text-on-surface">${kacis(ad)} yapıldı</div>
        <div class="text-[11px] text-on-surface-variant">${B(danismanAdi(DMAP, h.personel_id)) || '—'} · ${fmtTarih(h.created_at)}${h.notu ? ' · ' + kacis(h.notu) : ''}</div>
      </div>
      ${mat('check_circle', 'text-[#047857] text-[18px] shrink-0')}
    </div>`
  }).join('')
  return kart('auto_awesome', 'HAZIRLIK', ic)
}

// ---- Kısa Yol ----
function kisaYolHtml() {
  const it = (ik, et, act) => `<button data-kisayol="${act}" class="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest hover:border-primary/40 hover:bg-primary/5 text-left transition-all">
    <span class="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">${mat(ik, 'text-[18px]')}</span>
    <span class="flex-1 text-body-sm font-bold text-on-surface">${et}</span>
    <span class="text-outline group-hover:text-primary group-hover:translate-x-0.5 transition-all">${mat('chevron_right', 'text-[18px]')}</span></button>`
  // ⚠️ "Fiyatlama Sayfasına Git" YALNIZ araç kuyruktayken görünür (Göksenil,
  //    7 Ağu 2026). Kuyrukta olmayan araç o sayfada zaten yok; kısa yol
  //    kullanıcıyı boş listeye götürüp "araç kayboldu" izlenimi veriyordu.
  //    "Stok Kartına Git" kaldırıldı — bu pencerenin kendisi araç kartı.
  const kuyrukta = ARAC.fiyatlama_durumu === 'BEKLIYOR' && !fiyatlandiMi()
  const ic = `<div class="flex flex-col gap-2">
    ${it('visibility', 'Ekspertiz Raporunu Görüntüle', 'ekspertiz')}
    ${it('search_check', 'Tramer Sorgusu', 'tramer')}
    ${kuyrukta ? it('sell', 'Fiyatlama Sayfasına Git', 'fiyatlama') : ''}
  </div>`
  return kart('bolt', 'KISA YOL', ic)
}

// ---- Foto galeri (+ not editörü) ----
function fotoGaleriHtml() {
  const yetki = fotoYetki(DANISMAN)
  const kartlar = FOTOLAR.map((f, i) => `<div class="foto-kart relative group aspect-[4/3] rounded-lg overflow-hidden border border-outline-variant bg-surface-container ${yetki ? 'cursor-move' : ''}" data-idx="${i}" ${yetki ? 'draggable="true"' : ''}>
      <img src="${kacis(fotoUrl(f.dosya_yolu))}" alt="araç fotoğrafı" class="w-full h-full object-cover pointer-events-none" loading="lazy" />
      <span class="absolute bottom-1 left-1 bg-black/55 text-white text-[10px] w-5 h-5 rounded flex items-center justify-center">${i + 1}</span>
      ${yetki ? `<button data-fotosil="${f.id}" data-yol="${kacis(f.dosya_yolu)}" class="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity" title="Sil">${mat('delete', 'text-[16px]')}</button>` : ''}
    </div>`).join('')
  const ekle = yetki ? `<label class="aspect-[4/3] rounded-lg border-2 border-dashed border-outline-variant flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-surface-container-low hover:border-primary/40 transition-colors text-on-surface-variant">
      ${mat('add', 'text-[26px]')}<span class="text-[11px] font-bold">Fotoğraf Ekle</span><span class="text-[9px]">Sürükle-bırak ile sırala</span>
      <input id="fotoInp" type="file" accept="image/*" multiple hidden /></label>` : ''
  const grid = (FOTOLAR.length || yetki)
    ? `<div id="fotoGrid" class="grid grid-cols-2 sm:grid-cols-3 gap-2">${kartlar}${ekle}</div>`
    : bosDurum('Henüz fotoğraf yok.', 'photo_library')
  const notEd = `<div class="mt-3 pt-3 border-t border-outline-variant flex items-end gap-2">
    <textarea id="nInp" rows="2" class="${INP} flex-1" placeholder="Araç hakkında not yaz…">${kacis(ARAC.notu || '')}</textarea>
    <button id="nKaydet" class="px-3 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1 shrink-0">${mat('save', 'text-[16px]')} Notu Kaydet</button></div>`
  return kart('photo_library', `ARAÇ FOTOĞRAFLARI ${FOTOLAR.length ? `(${FOTOLAR.length})` : ''}`,
    `<div id="fotoDurum" class="text-[11px] text-on-surface-variant mb-2 hidden"></div>${grid}${notEd}`)
}

// ---- EVRAKLAR ----
function evraklarHtml() {
  const yuk = (tip, et, ik) => `<label class="flex items-center gap-2 px-3 h-10 rounded-lg border border-dashed border-outline-variant hover:border-primary/40 hover:bg-surface-container-low cursor-pointer text-sm font-semibold text-on-surface-variant transition-colors">
      ${mat(ik, 'text-[18px] text-primary')} ${et}<input type="file" data-evraktip="${tip}" accept="application/pdf,image/*" hidden /></label>`
  const yukleme = `<div class="flex flex-wrap gap-2">${yuk('EKSPERTIZ_PDF', 'Ekspertiz PDF', 'assignment')}${yuk('RUHSAT', 'Ruhsat', 'badge')}${yuk('SBM_GORSEL', 'Tramer / SBM', 'search_check')}${yuk('TRAMER_DETAY', 'Tramer Detay Sorgusu', 'description')}${yuk('DIGER', 'Diğer Belge', 'attach_file')}</div>`
  const liste = EVR.length ? `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
    ${EVR.map(e => {
      const pdf = /\.pdf(\?|$)/i.test(e.url)
      return `<div class="rounded-2xl border border-outline-variant bg-surface-container-lowest overflow-hidden flex flex-col shadow-sm">
        <div class="flex items-center justify-between gap-2 p-2.5 border-b border-outline-variant">
          <span class="min-w-0"><span class="block text-body-sm font-bold truncate">${kacis(EVRAK_ETIKET[e.tip] || e.tip)}</span>
            <span class="block text-[11px] text-on-surface-variant">${fmtTarih(e.created_at)}</span></span>
          <div class="flex items-center gap-1 shrink-0">
            <button data-evrak="${kacis(e.url)}" class="ad-evrak w-7 h-7 rounded hover:bg-primary/10 text-primary flex items-center justify-center" title="Yeni sekmede aç">${mat('open_in_full', 'text-[16px]')}</button>
            ${evrakSilYetki(DANISMAN) ? `<button data-evraksil="${e.id}" data-yol="${kacis(e.url)}" class="w-7 h-7 rounded hover:bg-error/10 text-error flex items-center justify-center" title="Sil">${mat('delete', 'text-[16px]')}</button>` : ''}
          </div>
        </div>
        <div id="evon-${e.id}" class="h-64 bg-surface-container-high flex items-center justify-center overflow-hidden">
          <span class="flex flex-col items-center gap-1 text-on-surface-variant/50">${mat(pdf ? 'picture_as_pdf' : 'image', 'text-[32px]')}<span class="text-[10px]">yükleniyor…</span></span>
        </div>
      </div>`
    }).join('')}
  </div>` : `<div class="p-4">${bosDurum('Yüklü evrak yok — yukarıdan ekleyin.', 'folder_off')}</div>`
  return kart('folder', 'EVRAKLAR', `<div id="evrakDurum" class="text-[11px] text-on-surface-variant hidden mb-2"></div>${yukleme}<div class="mt-3">${liste}</div>`)
}

// ---- EKSPERTİZ ----
function ekspertizHtml() {
  const yetki = ekspYetki(DANISMAN)
  const boyali = PARCALAR.filter(p => EKSP_PANEL[p] !== 'ORIJINAL')
  const ozet = boyali.length
    ? `<div class="flex flex-wrap gap-1.5">${boyali.map(p => `<span class="text-[11px] font-bold px-2 py-0.5 rounded border border-outline-variant">${kacis(buyuk(p))}: ${kacis(DURUM_ETIKET[EKSP_PANEL[p]] || EKSP_PANEL[p])}</span>`).join('')}</div>`
    : `<p class="text-body-sm text-green-700 font-semibold">Boyalı/değişen parça yok — orijinal.</p>`
  const sag = yetki ? `<button id="adEkspKaydet" class="px-3 h-8 rounded-lg text-sm font-bold flex items-center gap-1 ${EKSP_DIRTY ? 'bg-primary text-on-primary hover:opacity-90' : 'border border-outline-variant text-on-surface-variant/50 cursor-not-allowed'}" ${EKSP_DIRTY ? '' : 'disabled'}>${mat('save', 'text-[16px]')} Kaydet</button>` : `<span class="text-[11px] text-on-surface-variant">${boyali.length} boyalı/değişen</span>`
  const pdfDrop = yetki ? `<label id="ekspDrop" class="flex items-center justify-center gap-2 mb-3 px-3 py-2.5 rounded-lg border-2 border-dashed border-outline-variant hover:border-primary/40 cursor-pointer text-[11px] font-semibold text-on-surface-variant text-center transition-colors">
      ${mat('upload_file', 'text-[16px] text-primary')} <span id="ekspPdfAd">Ekspertiz PDF sürükle-bırak / seç — DYNOMOSS otomatik dolar</span>
      <input id="ekspPdf" type="file" accept="application/pdf" hidden /></label>` : ''
  const ic = `<p class="text-[11px] text-on-surface-variant mb-2">${yetki ? 'PDF yükle → otomatik dolar; ya da parçalara tıklayarak işaretle (Orijinal → Boyalı → Lokal → Değişen). Sonra <b>Kaydet</b>.' : 'Ekspertiz düzenleme yalnız yöneticiye açık — görüntüleme modundasın.'}</p>
    ${pdfDrop}
    <div id="ekspPdfGom" class="mb-3"></div>
    <div id="ekspOzet" class="text-[11px] text-on-surface-variant mb-2 hidden"></div>
    <div id="adSvg" class="max-w-[520px] mx-auto w-full">${SVGTXT ? '' : bosDurum('Ekspertiz şeması yüklenemedi.', 'assignment_late')}</div>
    <div class="flex flex-wrap gap-2.5 justify-center text-[10px] my-3">
      <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#c8c8c8;border-radius:3px;display:inline-block"></i>Orijinal</span>
      <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#03A9F4;border-radius:3px;display:inline-block"></i>Boyalı</span>
      <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#f3de1f;border-radius:3px;display:inline-block"></i>Lokal</span>
      <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#ff1100;border-radius:3px;display:inline-block"></i>Değişen</span>
    </div>${ozet}`
  return `<div id="ekspKart">${kart('assignment_turned_in', 'EKSPERTİZ', ic, sag)}</div>`
}
// ---- Yüklenen evrakı KARTIN İÇİNDE göster (ekspertiz PDF · tramer görseli) ----
// Göksenil: "yüklediğim PDF görünmüyor, sadece SVG şeması var" / "tramer görselini
// yükledim burada görünmüyor". Storage bucket ÖZEL → imzalı URL (1 saat) gerekir,
// bu yüzden çizimden sonra asenkron doldurulur.
async function evrakGomCiz() {
  const doldur = async (kapId, tipler, baslik) => {
    const kap = KAP?.querySelector('#' + kapId); if (!kap) return
    const e = EVR.filter(x => tipler.includes(x.tip)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    if (!e) return
    const url = await evrakImzaliUrl(e.url)
    if (!url) return
    const pdf = /\.pdf(\?|$)/i.test(e.url)
    // PDF: etkileşimli iframe — kart içinde KAYDIRARAK okunur. Tam görünüm için
    // üstteki "Yeni sekmede aç" linki. (pointer-events-none kaydırmayı da
    // engelliyordu — kaldırıldı.)
    const govde = pdf
      ? `<iframe src="${kacis(url)}#toolbar=0&view=FitH" class="w-full h-[420px] rounded-lg border border-outline-variant bg-white" loading="lazy" title="${kacis(baslik)}"></iframe>`
      : `<img src="${kacis(url)}" alt="${kacis(baslik)}" class="w-full max-h-[420px] object-contain rounded-lg border border-outline-variant bg-white" loading="lazy" />`
    kap.innerHTML = `<div class="flex items-center justify-between gap-2 mb-1.5">
        <span class="text-[11px] font-bold text-on-surface-variant uppercase">${kacis(baslik)} · ${fmtTarih(e.created_at)}</span>
        <a href="${kacis(url)}" target="_blank" rel="noopener" class="text-[11px] font-bold text-primary hover:underline flex items-center gap-1">${mat('open_in_new', 'text-[14px]')} Yeni sekmede aç</a>
      </div>${govde}`
  }
  await Promise.all([
    doldur('ekspPdfGom', ['EKSPERTIZ_PDF'], 'Ekspertiz Raporu'),
    doldur('tramerGorselGom', ['SBM_GORSEL', 'TRAMER_DETAY'], 'Tramer / SBM Belgesi'),
  ])
}

// ---- Evraklar sekmesi: her belgeyi canlı önizle (img / PDF iframe) ----
// Storage bucket ÖZEL → imzalı URL (1 saat). Önizleme çizimden sonra asenkron
// doldurulur. PDF etkileşimli → kart içinde KAYDIRILARAK okunur; tam görünüm
// başlıktaki "aç" butonundan (yeni sekme).
async function evrakOnizleCiz() {
  await Promise.all(EVR.map(async e => {
    const kap = KAP?.querySelector('#evon-' + e.id); if (!kap) return
    const url = await evrakImzaliUrl(e.url)
    if (!url) return
    const et = kacis(EVRAK_ETIKET[e.tip] || e.tip)
    // Etkileşimli iframe → belge kart içinde KAYDIRILARAK okunur. Tam görünüm
    // için başlıktaki "aç" butonu (üstte, .ad-evrak).
    const onizle = /\.pdf(\?|$)/i.test(e.url)
      ? `<iframe src="${kacis(url)}#toolbar=0&view=FitH" class="w-full h-full border-0 bg-white" loading="lazy" title="${et}"></iframe>`
      : `<img src="${kacis(url)}" class="w-full h-full object-contain" loading="lazy" alt="${et}" />`
    kap.innerHTML = onizle
  }))
}

function ekspertizCiz() {
  const kap = KAP?.querySelector('#adSvg')
  if (!kap || !SVGTXT) return
  kap.innerHTML = SVGTXT
  const svg = kap.querySelector('svg'); if (!svg) return
  svgBoya(svg, EKSP_PANEL)
  if (!ekspYetki(DANISMAN)) return
  for (const path of svg.querySelectorAll('[data-part]')) {
    path.style.cursor = 'pointer'
    path.onclick = () => {
      const p = path.getAttribute('data-part'); if (EKSP_PANEL[p] === undefined) return
      const i = DURUMLAR.indexOf(EKSP_PANEL[p])
      EKSP_PANEL[p] = DURUMLAR[(i + 1) % DURUMLAR.length]
      EKSP_DIRTY = true; svgBoya(svg, EKSP_PANEL); ciz()
    }
  }
}

// ---- TRAMER ----
function tramerHtml() {
  const yetki = tramerYetki(DANISMAN)
  const toplam = TRM.reduce((s, t) => s + (Number(t.tutar) || 0), 0)
  const tablo = TRM.length ? `<div class="overflow-x-auto"><table class="w-full text-left border-collapse min-w-[560px]">
      <thead><tr class="text-[10px] uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
        <th class="px-4 py-2">Hasar Tarihi</th><th class="px-4 py-2">Açıklama</th><th class="px-4 py-2">Sorgu Tarihi</th><th class="px-4 py-2 text-right">Tutar</th><th class="px-4 py-2"></th></tr></thead>
      <tbody>${TRM.map(t => `<tr class="border-b border-outline-variant/40">
        <td class="px-4 py-2 text-body-sm whitespace-nowrap">${t.hasar_tarihi ? fmtTarih(t.hasar_tarihi) : '—'}</td>
        <td class="px-4 py-2 text-body-sm">${kacis(buyuk(t.aciklama || '—'))}</td>
        <td class="px-4 py-2 text-body-sm text-on-surface-variant whitespace-nowrap">${t.sorgu_tarihi ? fmtTarih(t.sorgu_tarihi) : '—'}</td>
        <td class="px-4 py-2 text-body-sm font-bold text-right whitespace-nowrap">${t.tutar != null ? Number(t.tutar).toLocaleString('tr-TR') + ' ₺' : '—'}</td>
        <td class="px-4 py-2 text-right">${yetki ? `<button data-tramersil="${t.id}" class="w-7 h-7 rounded hover:bg-error/10 text-error" title="Sil">${mat('delete', 'text-[16px]')}</button>` : ''}</td></tr>`).join('')}</tbody>
    </table></div>` : `<div class="p-4">${bosDurum(yetki ? 'Hasar kaydı yok — yukarıdan ekleyin.' : 'Hasar kaydı yok.', 'search_off')}</div>`
  const form = yetki ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-2 items-end bg-surface-container-low border border-outline-variant rounded-xl p-3 mb-3">
      ${alanDuz('Sorgu Tarihi', `<input id="t_sorgu" type="date" value="${bugunISO()}" class="${INP}" />`)}
      ${alanDuz('Hasar Tarihi', `<input id="t_htarih" type="date" class="${INP}" />`)}
      ${alanDuz('Hasar Tutarı (₺)', `<input id="t_tutar" type="number" class="${INP}" />`)}
      <label id="tramerDrop" class="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 min-h-10 rounded-lg border-2 border-dashed border-outline-variant hover:border-primary/40 cursor-pointer text-[11px] font-semibold text-on-surface-variant text-center transition-colors">
        <span class="flex items-center gap-1">${mat('image', 'text-[16px] text-primary')} SBM Görseli</span>
        <span id="t_gorselAd" class="text-[10px] text-on-surface-variant/70 truncate max-w-full">sürükle-bırak / seç</span>
        <input id="t_gorsel" type="file" accept="image/*,application/pdf" hidden /></label>
      <div class="col-span-2 md:col-span-3">${alanDuz('Hasar Nedeni', `<input id="t_neden" class="${INP}" />`)}</div>
      <button id="t_ekle" class="h-10 bg-primary text-on-primary rounded-lg text-sm font-bold flex items-center justify-center gap-1 hover:opacity-90">${mat('add', 'text-[18px]')} Hasar Ekle</button>
    </div>` : ''
  return `<div id="tramerKart">${kart('search_check', 'TRAMER / HASAR KAYDI',
    `<div id="tramerDurum" class="text-[11px] text-on-surface-variant hidden mb-2"></div>${form}<div id="tramerGorselGom" class="mb-3"></div>${tablo}`,
    `<span class="text-body-sm font-bold">${TRM.length} hasar · ${toplam.toLocaleString('tr-TR')} ₺</span>`)}</div>`
}

// =====================================================================
// REZERVASYON (Faz R3) — Özet'in üstünde 3 sütun grid'in ÜSTÜNDE gösterilir.
//   4 durum: (A) STOKTA/YAYINDA & rezerv yok → "Rezervasyon Başlat" şeridi
//            (B) aktif rezerv BENİM (asama REZERVASYON) → Aktif Rezervasyon kartı
//            (C) aktif rezerv BAŞKASININ → Guard (kilit) kartı
//            (D) araç zaten SİPARİŞ aşamasında → bilgi şeridi + Sipariş Merkezi linki
//   DB katmanı (sql/61-63) trigger'larla stok_araclar.durum + olaylar'ı otomatik
//   senkronlar — burada YALNIZ siparisler'e yazılır, stok_araclar'a ELLE dokunulmaz.
// =====================================================================
function rezervasyonSeridi() {
  const baslatilabilir = ARAC.durum === 'STOKTA' || ARAC.durum === 'YAYINDA'
  if (baslatilabilir && !REZ) return rezStokSeridi()
  if (REZ && REZ.asama === 'SIPARIS') return rezSiparisBilgi()
  if (REZ && REZ.asama === 'REZERVASYON' && REZ.danisman_id === DANISMAN?.id) return rezAktifKart()
  if (REZ && REZ.asama === 'REZERVASYON' && REZ.danisman_id !== DANISMAN?.id) return rezGuardKart()
  return ''
}

function rezStokSeridi() {
  return `<div class="bg-surface-container-lowest border border-[#10B981]/30 rounded-xl custom-shadow overflow-hidden">
    <div class="px-4 py-3 flex items-center gap-3 flex-wrap bg-[#ECFDF5]">
      <span class="w-9 h-9 rounded-full bg-[#10B981] text-white flex items-center justify-center shrink-0">${mat('check_circle', 'text-[20px]')}</span>
      <div class="flex-1 min-w-0"><div class="text-sm font-extrabold text-[#047857]">ARAÇ STOKTA${ARAC.durum === 'YAYINDA' ? ' & YAYINDA' : ''}</div>
        <div class="text-[11px] text-[#047857]/80">Satışa hazır — rezervasyon başlat ya da doğrudan sipariş oluştur.</div></div>
      <div class="flex items-center gap-2 shrink-0">
        <button id="rezBaslatBtn" class="px-4 h-10 rounded-lg border border-primary/40 text-primary bg-white text-sm font-bold hover:bg-primary/5 flex items-center gap-1.5">${mat('bookmark_add', 'text-[18px]')} Rezervasyon Başlat</button>
        <button id="sipBaslatBtn" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1.5">${mat('shopping_cart_checkout', 'text-[18px]')} Sipariş Oluştur</button>
      </div>
    </div></div>`
}

function rezSiparisBilgi() {
  const m = one(REZ.musteriler) || {}
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-hidden">
    <div class="px-4 py-3 flex items-center gap-3 flex-wrap bg-[#EFF6FF]">
      <span class="w-9 h-9 rounded-full bg-[#3B82F6] text-white flex items-center justify-center shrink-0">${mat('local_shipping', 'text-[20px]')}</span>
      <div class="flex-1 min-w-0"><div class="text-sm font-extrabold text-[#1D4ED8]">ARAÇ SİPARİŞ AŞAMASINDA</div>
        <div class="text-[11px] text-[#1D4ED8]/80">${B(m.ad_soyad) || 'Müşteri'} · ${REZ.anlasilan_tutar != null ? fmtPara(REZ.anlasilan_tutar) : '—'} — finansal süreç Satış Dosyası'ndan yönetilir.</div></div>
      <button id="rezSiparisGit" class="px-4 h-10 rounded-lg bg-[#1D4ED8] text-white text-sm font-bold hover:opacity-90 flex items-center gap-1.5 shrink-0">${mat('folder_open', 'text-[16px]')} Satış Dosyasını Aç</button>
    </div></div>`
}

// ---- (B) Aktif Rezervasyon — benim ----
function rezAktifKart() {
  const m = one(REZ.musteriler) || {}
  const dan = danismanAdi(DMAP, REZ.danisman_id)
  const f = rezKalanFormat(REZ.gecerlilik_bitis, REZ.created_at)
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-hidden">
    <div class="bg-[#ECFDF5] text-[#047857] px-4 py-2.5 flex items-center gap-2 text-sm font-extrabold">
      <span class="w-2 h-2 rounded-full bg-[#10B981] inline-block animate-pulse"></span> AKTİF REZERVASYON
      <span class="ml-auto text-[11px] font-semibold text-[#047857]/80">bu araç kilitlenmiştir</span>
    </div>
    <div class="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="flex items-center gap-2 min-w-0">${avatarKucuk(m.ad_soyad)}
        <div class="min-w-0"><div class="text-[10px] text-on-surface-variant uppercase">Müşteri</div><div class="text-sm font-bold truncate">${B(m.ad_soyad) || '—'}</div></div></div>
      <div><div class="text-[10px] text-on-surface-variant uppercase">Danışman</div><div class="text-sm font-bold">${B(dan) || '—'}</div></div>
      <div id="rezSayacBox" class="rounded-lg border p-2.5 flex flex-col items-center justify-center gap-1 col-span-2 md:col-span-1 ${f.bg}">
        <span class="text-[10px] font-bold uppercase ${f.renk}">Kalan Süre</span>
        <span id="rezSayac" class="text-base font-black ${f.renk}">${f.metin}</span>
        <div class="w-full h-1.5 rounded-full bg-white/60 overflow-hidden"><div id="rezSayacBar" class="h-full transition-all ${f.renk.replace('text-', 'bg-')}" style="width:${f.yuzde}%"></div></div>
      </div>
      <div><div class="text-[10px] text-on-surface-variant uppercase">Araç Fiyatı</div><div class="text-sm font-black text-primary">${REZ.anlasilan_tutar != null ? fmtPara(REZ.anlasilan_tutar) : '—'}</div></div>
      <div><div class="text-[10px] text-on-surface-variant uppercase">Alınan Kapora</div><div class="text-sm font-bold flex items-center gap-1 ${REZ.kapora_tutar ? 'text-[#047857]' : 'text-on-surface-variant'}">${REZ.kapora_tutar ? mat('check_circle', 'text-[14px]') : ''} ${REZ.kapora_tutar ? fmtPara(REZ.kapora_tutar) : '—'}</div></div>
      <div><div class="text-[10px] text-on-surface-variant uppercase">Bitiş Tarihi</div><div class="text-sm font-bold">${REZ.gecerlilik_bitis ? fmtTarih(REZ.gecerlilik_bitis) : '—'}</div></div>
      <div><div class="text-[10px] text-on-surface-variant uppercase">Neden</div><div class="text-sm font-bold">${kacis(rezervasyonNedenEtiket(REZ.rezervasyon_nedeni))}</div></div>
    </div>
    ${REZ.rezervasyon_notu ? `<div class="px-4 pb-3"><div class="text-[10px] text-on-surface-variant uppercase mb-1">Not</div><p class="text-body-sm bg-surface-container-low rounded-lg p-2.5 whitespace-pre-wrap">${kacis(REZ.rezervasyon_notu)}</p></div>` : ''}
    <div class="p-3 border-t border-outline-variant bg-surface-container-low flex flex-wrap gap-2">
      <button id="rezDonustur" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1.5">${mat('shopping_cart', 'text-[16px]')} Siparişe Dönüştür</button>
      <button id="rezUzat" class="px-4 h-10 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:bg-white flex items-center gap-1.5">${mat('update', 'text-[16px]')} Süre Uzat</button>
      <button id="rezDuzenle" class="px-4 h-10 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:bg-white flex items-center gap-1.5">${mat('edit', 'text-[16px]')} Düzenle</button>
      <button id="rezKaldir" class="ml-auto px-4 h-10 rounded-lg text-error text-sm font-bold hover:bg-error/10 flex items-center gap-1.5">${mat('cancel', 'text-[16px]')} Rezervi Kaldır</button>
    </div>
    ${REZ_UZAT ? rezUzatFormu() : ''}${REZ_DUZENLE ? rezDuzenleFormu() : ''}
  </div>`
}
function avatarKucuk(ad) { return `<div class="w-8 h-8 rounded-full bg-primary-fixed text-primary text-[11px] flex items-center justify-center font-bold shrink-0">${basHarf(ad)}</div>` }

function rezUzatFormu() {
  return `<div class="px-4 py-3 border-t border-outline-variant bg-surface-container-low flex flex-wrap items-end gap-2">
    <span class="text-[11px] font-bold text-on-surface-variant uppercase w-full">Süreyi Uzat</span>
    ${['12', '24', '48'].map(s => `<button data-uzatsaat="${s}" class="h-9 px-3 rounded-lg border border-outline-variant text-xs font-bold text-on-surface-variant hover:border-primary hover:text-primary bg-white">+${s} Saat</button>`).join('')}
    <input id="rezUzatTarih" type="datetime-local" class="${INP} w-52" />
    <button id="rezUzatKaydet" class="h-9 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold hover:opacity-90">Tarihi Kaydet</button>
    <button id="rezUzatVazgec" class="h-9 px-3 rounded-lg border border-outline-variant text-xs font-bold text-on-surface-variant bg-white">Vazgeç</button>
  </div>`
}
function rezDuzenleFormu() {
  return `<div class="px-4 py-3 border-t border-outline-variant bg-surface-container-low space-y-2">
    <span class="text-[11px] font-bold text-on-surface-variant uppercase">Rezervasyonu Düzenle</span>
    <div class="grid grid-cols-2 gap-2">
      ${alanDuz('Fiyat (₺)', `<input id="rezDzFiyat" type="text" inputmode="numeric" value="${REZ.anlasilan_tutar != null ? Number(REZ.anlasilan_tutar).toLocaleString('tr-TR') : ''}" class="${INP} font-bold" />`)}
      ${alanDuz('Kapora (₺)', `<input id="rezDzKapora" type="text" inputmode="numeric" value="${REZ.kapora_tutar != null ? Number(REZ.kapora_tutar).toLocaleString('tr-TR') : ''}" class="${INP} font-bold" />`)}
    </div>
    ${alanDuz('Neden', `<select id="rezDzNeden" class="${INP}"><option value="">—</option>${REZERVASYON_NEDENLERI.map(([k, l]) => `<option value="${k}" ${REZ.rezervasyon_nedeni === k ? 'selected' : ''}>${kacis(l)}</option>`).join('')}</select>`)}
    ${alanDuz('Not', `<textarea id="rezDzNot" rows="2" class="${INP}">${kacis(REZ.rezervasyon_notu || '')}</textarea>`)}
    <div class="flex justify-end gap-2 pt-1">
      <button id="rezDzVazgec" class="h-9 px-3 rounded-lg border border-outline-variant text-xs font-bold text-on-surface-variant bg-white">Vazgeç</button>
      <button id="rezDzKaydet" class="h-9 px-4 rounded-lg bg-primary text-on-primary text-xs font-bold hover:opacity-90">Kaydet</button>
    </div></div>`
}

// ---- (C) Guard — başkasının rezervasyonu ----
function rezGuardKart() {
  const m = one(REZ.musteriler) || {}
  const dan = danismanAdi(DMAP, REZ.danisman_id)
  const yon = yoneticiMi(DANISMAN)
  return `<div class="bg-surface-container-lowest border border-error/30 rounded-xl custom-shadow overflow-hidden">
    <div class="bg-error-container/50 text-on-error-container px-4 py-2.5 flex items-center gap-2 text-sm font-extrabold border-b border-error/20">
      ${mat('lock', 'text-[18px]')} SİSTEM KİLİDİ AKTİF
      <span class="ml-auto text-[11px] font-semibold opacity-80">Bu araç aktif olarak rezerve edilmiş</span>
    </div>
    <div class="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
      <div><div class="text-[10px] text-on-surface-variant uppercase">Danışman</div><div class="text-sm font-bold">${B(dan) || '—'}</div></div>
      <div><div class="text-[10px] text-on-surface-variant uppercase">Müşteri</div><div class="text-sm font-bold">${B(m.ad_soyad) || '—'}</div></div>
      <div><div class="text-[10px] text-on-surface-variant uppercase">Bitiş</div><div class="text-sm font-bold">${REZ.gecerlilik_bitis ? fmtTarih(REZ.gecerlilik_bitis) : '—'}</div></div>
    </div>
    ${REZ_GUARD_DETAY ? rezGuardDetayPanel() : ''}
    <div class="p-3 border-t border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-2">
      <button id="rezDetayGor" class="px-4 h-10 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:bg-white flex items-center gap-1.5">${mat('visibility', 'text-[16px]')} ${REZ_GUARD_DETAY ? 'Detayı Gizle' : 'Detayı Gör'}</button>
      ${yon ? `<button id="rezDevral" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1.5">${mat('swap_horiz', 'text-[16px]')} Rezervasyonunu Devral</button>
        <button id="rezKilitKaldir" title="Yönetici Yetkisi Gerektirir" class="ml-auto px-4 h-10 rounded-lg text-error text-sm font-bold hover:bg-error/10 flex items-center gap-1.5">${mat('lock_open', 'text-[16px]')} Kilidi Manuel Kaldır</button>`
        : `<span class="ml-auto text-[11px] text-on-surface-variant">Devralma / kilit kaldırma yönetici yetkisi gerektirir.</span>`}
    </div></div>`
}
function rezGuardDetayPanel() {
  return `<div class="px-4 py-3 border-t border-outline-variant bg-surface-container-low grid grid-cols-2 gap-3 text-sm">
    <div><span class="text-[10px] text-on-surface-variant uppercase block">Anlaşılan Tutar</span>${REZ.anlasilan_tutar != null ? fmtPara(REZ.anlasilan_tutar) : '—'}</div>
    <div><span class="text-[10px] text-on-surface-variant uppercase block">Kapora</span>${REZ.kapora_tutar != null ? fmtPara(REZ.kapora_tutar) : '—'}</div>
    <div><span class="text-[10px] text-on-surface-variant uppercase block">Neden</span>${kacis(rezervasyonNedenEtiket(REZ.rezervasyon_nedeni))}</div>
    <div><span class="text-[10px] text-on-surface-variant uppercase block">Not</span>${REZ.rezervasyon_notu ? kacis(REZ.rezervasyon_notu) : '—'}</div>
  </div>`
}

// ---- Canlı sayaç (kalan süre) ----
// Renk eşiği: >24s yeşil · <24s sarı · <6s turuncu · <1s kırmızı · dolmuş siyah.
function rezKalanFormat(bitis, baslangic) {
  if (!bitis) return { ms: null, metin: 'Süresiz', renk: 'text-on-surface-variant', bg: 'bg-surface-container-low border-outline-variant', yuzde: 0 }
  const ms = new Date(bitis) - Date.now()
  if (ms <= 0) return { ms, metin: 'Süresi Doldu', renk: 'text-white', bg: 'bg-[#1a1c20] border-[#1a1c20]', yuzde: 100 }
  const saat = ms / 3600000
  let renk, bg
  if (saat > 24) { renk = 'text-[#047857]'; bg = 'bg-[#ECFDF5] border-[#10B981]/30' }
  else if (saat > 6) { renk = 'text-[#B45309]'; bg = 'bg-[#FFFBEB] border-[#F59E0B]/30' }
  else if (saat > 1) { renk = 'text-[#C2410C]'; bg = 'bg-[#FFF7ED] border-[#FB923C]/30' }
  else { renk = 'text-[#B91C1C]'; bg = 'bg-[#FEF2F2] border-[#EF4444]/30' }
  const g = Math.floor(saat / 24), sa = Math.floor(saat % 24), dk = Math.floor((ms % 3600000) / 60000), sn = Math.floor((ms % 60000) / 1000)
  const metin = g > 0 ? `${g}g ${sa}s ${dk}dk` : sa > 0 ? `${sa}s ${dk}dk ${sn}sn` : `${dk}dk ${sn}sn`
  let yuzde = 100
  if (baslangic) { const toplam = new Date(bitis) - new Date(baslangic); if (toplam > 0) yuzde = Math.max(0, Math.min(100, (ms / toplam) * 100)) }
  return { ms, metin, renk, bg, yuzde }
}
function rezSayacTick() {
  if (!REZ || REZ.asama !== 'REZERVASYON' || !REZ.gecerlilik_bitis) { if (REZ_TIMER) { clearInterval(REZ_TIMER); REZ_TIMER = null }; return }
  const box = KAP?.querySelector('#rezSayacBox'), txt = KAP?.querySelector('#rezSayac'), bar = KAP?.querySelector('#rezSayacBar')
  if (!box || !txt || !bar) { if (REZ_TIMER) { clearInterval(REZ_TIMER); REZ_TIMER = null }; return }
  const f = rezKalanFormat(REZ.gecerlilik_bitis, REZ.created_at)
  box.className = `rounded-lg border p-2.5 flex flex-col items-center justify-center gap-1 col-span-2 md:col-span-1 ${f.bg}`
  txt.className = `text-base font-black ${f.renk}`; txt.textContent = f.metin
  bar.className = `h-full transition-all ${f.renk.replace('text-', 'bg-')}`; bar.style.width = f.yuzde + '%'
}
function rezSayacBaslat() {
  if (REZ_TIMER) { clearInterval(REZ_TIMER); REZ_TIMER = null }
  if (!REZ || REZ.asama !== 'REZERVASYON' || !REZ.gecerlilik_bitis) return
  rezSayacTick()
  REZ_TIMER = setInterval(rezSayacTick, 1000)
}

// ---- Drawer: "Aracı Rezerve Et" ----
function rezDrawerHtml() {
  if (!REZ_DRAWER) return ''
  const musteriSeciliHtml = REZ_MUSTERI
    ? `<div class="flex items-center gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/10">${avatarKucuk(REZ_MUSTERI.ad_soyad)}
        <span class="text-sm min-w-0 flex-1 truncate"><b>${kacis(buyuk(REZ_MUSTERI.ad_soyad))}</b> · ${kacis(telBicim(REZ_MUSTERI.telefon))}</span>
        <button id="rezMKaldir" class="text-error text-xs font-bold shrink-0">kaldır</button></div>` : ''
  const yeniMusteriForm = REZ_YENI_MUSTERI ? `<div class="grid grid-cols-2 gap-2 bg-surface-container-low border border-outline-variant rounded-lg p-3">
      <input id="rezYmAd" placeholder="Ad Soyad *" class="${INP} col-span-2" />
      <input id="rezYmTel" placeholder="Telefon" class="${INP} col-span-2" /></div>` : ''
  const nedenOpts = REZERVASYON_NEDENLERI.map(([k, l]) => `<option value="${k}">${kacis(l)}</option>`).join('')
  const sureBtn = (k, l) => `<button data-sure="${k}" class="flex-1 h-9 rounded-lg text-xs font-bold border transition-colors ${REZ_SURE === k ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary/40 bg-white'}">${l}</button>`
  return `
    <div id="rezBg" class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[90]"></div>
    <aside id="rezDrawer" class="fixed right-0 top-0 h-full w-full sm:w-[520px] bg-surface-container-lowest z-[95] shadow-2xl flex flex-col">
      <div class="px-5 py-4 border-b border-outline-variant flex items-center justify-between shrink-0">
        <h3 class="text-title-lg font-bold text-primary flex items-center gap-2">${mat(SIP_MODU ? 'shopping_cart_checkout' : 'bookmark_add')} ${SIP_MODU ? 'Sipariş Oluştur' : 'Aracı Rezerve Et'}</h3>
        <button id="rezDrawerKapat" class="w-8 h-8 rounded-full hover:bg-surface-container-low flex items-center justify-center text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div id="rezHata" class="hidden bg-error-container text-on-error-container border border-error/20 rounded-lg px-3 py-2 text-sm"></div>
        <div>
          <label class="text-[11px] font-bold text-on-surface-variant uppercase">Müşteri Bilgileri *</label>
          <div class="mt-1.5 flex items-center gap-2">
            <div class="relative flex-1">
              <input id="rezMAra" placeholder="İsim veya telefon ara…" class="${INP}" autocomplete="off" ${REZ_MUSTERI ? 'disabled' : ''} />
              <div id="rezMSonuc" class="absolute z-10 w-full mt-1 bg-white border border-outline-variant rounded-lg shadow-lg max-h-56 overflow-y-auto"></div>
            </div>
            <button id="rezYeniMBtn" class="px-3 h-10 rounded-lg border border-outline-variant text-xs font-bold text-primary hover:bg-primary/5 shrink-0 flex items-center gap-1">${mat('add', 'text-[16px]')} Yeni Müşteri</button>
          </div>
          <div class="mt-2">${musteriSeciliHtml}${yeniMusteriForm}</div>
        </div>
        <div class="grid ${SIP_MODU ? 'grid-cols-1' : 'grid-cols-2'} gap-3">
          ${alanDuz('Anlaşılan Satış Fiyatı (₺) *', `<input id="rezFiyat" type="text" inputmode="numeric" class="${INP} font-bold" />`)}
          ${SIP_MODU ? '' : alanDuz('Alınan Kapora (₺)', `<input id="rezKapora" type="text" inputmode="numeric" class="${INP} font-bold" />`)}
        </div>
        ${/* Satış tipi — SİPARİŞTE zorunlu (Göksenil: "aracı siparişe alırken
              soracak"). Bu alan bugüne kadar HİÇBİR ekranda sorulmuyordu.
              ⚠️ Alan İKİ MODDA da basılır: burada kapora girilen bir
                 REZERVASYON da siparişe dönüşüyor (siparisMi = SIP_MODU ||
                 kapora > 0). Yalnız SIP_MODU'da bassaydık o yoldan açılan
                 sipariş satış tipsiz kalırdı — düzeltmek istediğimiz hatanın
                 aynısı. Zorunluluk kaydederken koşullu uygulanır. */''}
        ${alanDuz(SIP_MODU ? 'Satış Tipi *' : 'Satış Tipi (kapora girilirse zorunlu)',
          `<select id="rezSatisTipi" class="${INP}"><option value="">Seçiniz…</option>${(TANIM['SATIS_SEKLI'] || []).map(t => `<option value="${kacis(t.kod)}">${kacis(t.ad)}</option>`).join('')}</select>`)}
        ${SIP_MODU ? `<div class="text-[11px] text-on-surface-variant bg-surface-container-low rounded-lg p-2.5">Sipariş oluşturulunca araç <b>SİPARİŞTE</b> olur, müşteri anlaşılan tutar kadar borçlanır ve <b>Satış Dosyası</b> açılır. Tahsilat/masraf oradan girilir.</div>` : `
        ${alanDuz('Rezervasyon Nedeni', `<select id="rezNeden" class="${INP}"><option value="">—</option>${nedenOpts}</select>`)}
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Geçerlilik Süresi</label>
          <div class="mt-1.5 flex gap-1.5">${sureBtn('12h', '12 Saat')}${sureBtn('24h', '24 Saat')}${sureBtn('48h', '48 Saat')}${sureBtn('ozel', 'Özel Tarih')}</div>
          ${REZ_SURE === 'ozel' ? `<input id="rezTarih" type="datetime-local" class="${INP} mt-2" />` : ''}
        </div>`}
        ${alanDuz('Görüşme Notu', `<textarea id="rezNot" rows="2" class="${INP}" placeholder="${SIP_MODU ? 'Sipariş notu…' : 'ör. Noter randevusu 30 Temmuz…'}"></textarea>`)}
      </div>
      <div class="p-4 border-t border-outline-variant shrink-0 space-y-1.5">
        <button id="rezKaydetBtn" class="w-full h-11 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat(SIP_MODU ? 'shopping_cart_checkout' : 'bookmark_add', 'text-[18px]')} ${SIP_MODU ? 'Sipariş Oluştur ve Dosyayı Aç' : 'Kaydet ve Rezerve Et'}</button>
        <p class="text-center text-[10px] text-on-surface-variant uppercase tracking-wide">İşlem kaydı oluşturulacaktır</p>
      </div>
    </aside>`
}
function rezDrawerKapat(cizYap = true) {
  REZ_DRAWER = false; SIP_MODU = false
  if (REZ_ESC) { document.removeEventListener('keydown', REZ_ESC); REZ_ESC = null }
  if (cizYap) ciz()
}

let REZ_M_TIMER
function rezMusteriAra(e) {
  clearTimeout(REZ_M_TIMER)
  const qv = e.target.value.trim()
  const kutu = KAP?.querySelector('#rezMSonuc'); if (!kutu) return
  if (qv.length < 2) { kutu.innerHTML = ''; return }
  REZ_M_TIMER = setTimeout(async () => {
    // BİRLEŞİK ARAMA (musteri-sec.js): CRM + yalnız sigortada olanlar.
    const { musteriAra } = await import('./musteri-sec.js')
    const data = await musteriAra(qv, 6)
    kutu.innerHTML = (data || []).length
      ? data.map(m => `<button data-mid="${m.id}" class="rez-msec w-full text-left px-3 py-2 hover:bg-primary/5 flex items-center gap-2 border-b border-outline-variant/50 last:border-0">
          <span class="w-7 h-7 rounded-full bg-primary-fixed text-primary text-[10px] flex items-center justify-center font-bold shrink-0">${basHarf(m.ad_soyad)}</span>
          <span class="text-sm min-w-0 truncate flex-1"><b>${kacis(buyuk(m.ad_soyad))}</b>${m.telefon && m.telefon !== '-' ? ' · ' + kacis(telBicim(m.telefon)) : ''}</span>
          ${m.kaynak_modul === 'SIGORTA' ? '<span class="shrink-0 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">SİGORTA</span>' : ''}</button>`).join('')
      : `<div class="text-[11px] text-on-surface-variant px-3 py-2">Kayıt yok — "Yeni Müşteri" ile ekle.</div>`
    kutu.querySelectorAll('.rez-msec').forEach(b => b.addEventListener('click', async () => {
      const secim = data.find(x => x.id === b.dataset.mid); if (!secim) return
      kutu.innerHTML = `<div class="px-3 py-2 text-[12px] text-on-surface-variant">Müşteri hazırlanıyor…</div>`
      // Sigorta kaydıysa CRM'e aktarılır — ham sigorta id'si FK hatası verirdi
      const { musteriCoz } = await import('./musteri-sec.js')
      const m = await musteriCoz(secim, DANISMAN)
      if (!m) { kutu.innerHTML = `<div class="px-3 py-2 text-[12px] text-error">Müşteri hazırlanamadı.</div>`; return }
      REZ_MUSTERI = m; REZ_YENI_MUSTERI = false; ciz()
    }))
  }, 250)
}

// ---- Aksiyonlar ----
async function rezKaydet() {
  const g = id => KAP.querySelector('#' + id)?.value?.trim() || ''
  const hataEl = KAP.querySelector('#rezHata')
  const hata = msg => { if (hataEl) { hataEl.textContent = msg; hataEl.classList.remove('hidden') } }
  if (hataEl) hataEl.classList.add('hidden')

  let musteriId = REZ_MUSTERI?.id || null
  if (!musteriId && REZ_YENI_MUSTERI) {
    const ad = g('rezYmAd')
    if (!ad) return hata('Yeni müşteri için ad soyad zorunlu.')
    const tel = g('rezYmTel')
    const { data: m, error: me } = await supabase.from('musteriler')
      .insert({ tip: 'SAHIS', ad_soyad: ad, telefon: tel ? telSifirla(tel) : '-' }).select('id, ad_soyad, telefon').single()
    if (me) { dbHata('rez müşteri ekle', me); return hata('Müşteri eklenemedi: ' + me.message) }
    musteriId = m.id; REZ_MUSTERI = m
  }
  if (!musteriId) return hata('Müşteri seçin veya yeni müşteri girin.')

  const fiyatRaw = g('rezFiyat').replace(/\./g, '').replace(/[^\d]/g, '')
  const kaporaRaw = g('rezKapora').replace(/\./g, '').replace(/[^\d]/g, '')
  if (SIP_MODU && !fiyatRaw) return hata('Anlaşılan satış fiyatı zorunlu (sipariş borcu bundan oluşur).')
  const kapora = kaporaRaw ? Number(kaporaRaw) : null
  const neden = g('rezNeden') || null
  const notMetni = g('rezNot') || null
  // Satış tipi: kayıt SİPARİŞE dönüşüyorsa zorunlu (SIP_MODU ya da kapora>0).
  // İsteğe bağlı bıraksaydık alan yine boş kalırdı — bugüne kadarki durum buydu.
  const satisTipi = g('rezSatisTipi') || ''
  if ((SIP_MODU || kapora > 0) && !satisTipi)
    return hata('Satış tipi zorunlu (Takas, Senetli, Vadeli, Otosor…).')

  let bitis
  if (REZ_SURE === 'ozel') {
    const t = g('rezTarih')
    if (!t) return hata('Özel tarih/saat seçin.')
    bitis = new Date(t).toISOString()
  } else {
    const saat = { '12h': 12, '24h': 24, '48h': 48 }[REZ_SURE] || 24
    bitis = new Date(Date.now() + saat * 3600000).toISOString()
  }

  const btn = KAP.querySelector('#rezKaydetBtn')
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…' }
  const siparisMi = SIP_MODU || kapora > 0
  const govde = {
    arac_id: ARAC.id, alici_musteri_id: musteriId, danisman_id: DANISMAN?.id, olusturan: DANISMAN?.id,
    durum: 'ACIK', asama: siparisMi ? 'SIPARIS' : 'REZERVASYON',
    anlasilan_tutar: fiyatRaw ? Number(fiyatRaw) : null, gecerlilik_bitis: siparisMi ? null : bitis,
    rezervasyon_nedeni: SIP_MODU ? null : neden, kapora_tutar: kapora, rezervasyon_notu: notMetni,
    satis_sekli: satisTipi || null,
  }
  const { data, error } = await supabase.from('siparisler').insert(govde).select('id')
  if (btn) { btn.disabled = false; btn.textContent = SIP_MODU ? 'Sipariş Oluştur ve Dosyayı Aç' : 'Kaydet ve Rezerve Et' }
  if (error) { dbHata('sipariş/rezervasyon kaydet', error); return hata('Kaydedilemedi: ' + error.message) }
  if (!data?.length) return hata('Kaydedilemedi — yetki/kayıt yok.')

  // Sipariş oluşturulduysa doğrudan Satış Dosyası'na git
  if (SIP_MODU) { location.href = 'siparis-dosya.html?id=' + encodeURIComponent(data[0].id); return }
  rezDrawerKapat(false)
  await veriYukle(ARAC.id, DANISMAN); ciz()
  uyariGoster(kapora > 0 ? 'Kapora alındı — araç SİPARİŞ oldu.' : 'Rezervasyon oluşturuldu, araç kilitlendi.', true)
}

async function rezSipariseDonustur() {
  if (!REZ) return
  if (!confirm('Bu rezervasyon siparişe dönüştürülsün mü? Araç SİPARİŞTE durumuna geçer.')) return
  const { data, error } = await supabase.from('siparisler').update({ asama: 'SIPARIS', gecerlilik_bitis: null }).eq('id', REZ.id).select('id')
  if (error) { dbHata('rez siparise dönüştür', error); uyariGoster('İşlem başarısız: ' + error.message); return }
  if (!data?.length) { uyariGoster('Güncellenemedi — yetki/kayıt yok.'); return }
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Sipariş oluşturuldu.', true)
}

async function rezSureUzatKaydet(saat, tarih) {
  const bitis = tarih
    ? new Date(tarih).toISOString()
    : new Date((REZ.gecerlilik_bitis ? new Date(REZ.gecerlilik_bitis) : new Date()).getTime() + saat * 3600000).toISOString()
  const { data, error } = await supabase.from('siparisler').update({ gecerlilik_bitis: bitis }).eq('id', REZ.id).select('id')
  if (error) { dbHata('rez süre uzat', error); uyariGoster('Uzatılamadı: ' + error.message); return }
  if (!data?.length) { uyariGoster('Uzatılamadı — yetki/kayıt yok.'); return }
  const { error: oErr } = await supabase.rpc('olay_ekle', { p_tip: 'REZERVASYON_UZATILDI', p_arac: ARAC.id, p_musteri: REZ.alici_musteri_id, p_siparis: REZ.id, p_danisman: DANISMAN?.id })
  if (oErr) dbHata('olay_ekle rez uzat', oErr)
  REZ_UZAT = false
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Süre uzatıldı.', true)
}

async function rezDuzenleKaydet() {
  const g = id => KAP.querySelector('#' + id)?.value?.trim() || ''
  const fiyatRaw = g('rezDzFiyat').replace(/\./g, '').replace(/[^\d]/g, '')
  const kaporaRaw = g('rezDzKapora').replace(/\./g, '').replace(/[^\d]/g, '')
  const yeniFiyat = fiyatRaw ? Number(fiyatRaw) : null
  const fiyatDegisti = Number(REZ.anlasilan_tutar || 0) !== Number(yeniFiyat || 0)
  const guncel = { anlasilan_tutar: yeniFiyat, kapora_tutar: kaporaRaw ? Number(kaporaRaw) : null, rezervasyon_nedeni: g('rezDzNeden') || null, rezervasyon_notu: g('rezDzNot') || null }
  const { data, error } = await supabase.from('siparisler').update(guncel).eq('id', REZ.id).select('id')
  if (error) { dbHata('rez düzenle', error); uyariGoster('Kaydedilemedi: ' + error.message); return }
  if (!data?.length) { uyariGoster('Kaydedilemedi — yetki/kayıt yok.'); return }
  if (fiyatDegisti) {
    const { error: oErr } = await supabase.rpc('olay_ekle', { p_tip: 'REZERVASYON_FIYAT_GUNCELLENDI', p_arac: ARAC.id, p_musteri: REZ.alici_musteri_id, p_siparis: REZ.id, p_danisman: DANISMAN?.id })
    if (oErr) dbHata('olay_ekle rez fiyat', oErr)
  }
  REZ_DUZENLE = false
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Rezervasyon güncellendi.', true)
}

async function rezKaldirAksiyon() {
  if (!REZ || !confirm('Bu rezervasyon kaldırılsın mı? Araç önceki durumuna döner.')) return
  const { data, error } = await supabase.from('siparisler').update({ durum: 'IPTAL' }).eq('id', REZ.id).select('id')
  if (error) { dbHata('rez kaldır', error); uyariGoster('İşlem başarısız: ' + error.message); return }
  if (!data?.length) { uyariGoster('İşlem başarısız — yetki/kayıt yok.'); return }
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Rezervasyon kaldırıldı.', true)
}

async function rezDevral() {
  if (!REZ || !yoneticiMi(DANISMAN) || !confirm('Bu rezervasyon devralınsın mı? Danışman siz olarak güncellenecek.')) return
  const { data, error } = await supabase.from('siparisler').update({ danisman_id: DANISMAN.id }).eq('id', REZ.id).select('id')
  if (error) { dbHata('rez devral', error); uyariGoster('Devralınamadı: ' + error.message); return }
  if (!data?.length) { uyariGoster('Devralınamadı — yetki/kayıt yok.'); return }
  const { error: oErr } = await supabase.rpc('olay_ekle', { p_tip: 'REZERVASYON_DEVRALINDI', p_arac: ARAC.id, p_musteri: REZ.alici_musteri_id, p_siparis: REZ.id, p_danisman: DANISMAN?.id })
  if (oErr) dbHata('olay_ekle rez devral', oErr)
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Rezervasyon devralındı.', true)
}

async function rezKilitKaldir() {
  if (!REZ || !yoneticiMi(DANISMAN) || !confirm('Kilit manuel olarak kaldırılsın mı? Rezervasyon iptal edilecek ve araç önceki durumuna dönecek.')) return
  const { data, error } = await supabase.from('siparisler').update({ durum: 'IPTAL' }).eq('id', REZ.id).select('id')
  if (error) { dbHata('rez kilit kaldır', error); uyariGoster('İşlem başarısız: ' + error.message); return }
  if (!data?.length) { uyariGoster('İşlem başarısız — yetki/kayıt yok.'); return }
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Kilit kaldırıldı.', true)
}

// ---- SÜREÇ GEÇMİŞİ ----
function surecHtml() {
  const olaylar = []
  // "kim" — işlemi yapan kullanıcı. Ekspertiz/tramer/evrak satırlarında ayrı bir
  // kullanıcı alanı YOK; kaydı açan personel (ARAC.olusturan) sorumludur.
  const sorumlu = danismanAdi(DMAP, ARAC.olusturan)
  olaylar.push({ t: ARAC.created_at, ik: 'add_circle', ad: 'Araç kabul edildi', kim: sorumlu })
  if (EKS.length) olaylar.push({ t: EKS.map(e => e.created_at).sort()[0], ik: 'assignment_turned_in', ad: `Ekspertiz işlendi (${EKS.filter(e => e.durum !== 'ORIJINAL').length} boyalı/değişen)`, kim: sorumlu })
  if (TRM.length) olaylar.push({ t: TRM.map(e => e.created_at).sort()[0], ik: 'search_check', ad: `Tramer sorgulandı (${TRM.length} hasar)`, kim: sorumlu })
  for (const e of EVR) olaylar.push({ t: e.created_at, ik: 'description', ad: `${EVRAK_ETIKET[e.tip] || e.tip} yüklendi`, kim: sorumlu })
  for (const o of OLAY) olaylar.push({ t: o.olusma_zamani, ik: 'bolt', ad: kacis(buyuk((o.tip || 'olay').replace(/_/g, ' '))), kim: danismanAdi(DMAP, o.danisman_id) || sorumlu })
  olaylar.sort((a, b) => new Date(b.t) - new Date(a.t))
  if (!olaylar.length) return `<div class="p-6">${bosDurum('Süreç kaydı yok.', 'history')}</div>`
  const ic = olaylar.map((o, i) => `<div class="flex gap-3">
      <div class="flex flex-col items-center"><span class="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">${mat(o.ik, 'text-[18px]')}</span>${i === olaylar.length - 1 ? '' : '<span class="w-px flex-1 my-0.5 bg-outline-variant"></span>'}</div>
      <div class="pb-4 min-w-0"><div class="text-body-sm font-semibold">${o.ad}</div>
        <div class="text-[11px] text-on-surface-variant flex items-center gap-1.5 flex-wrap">${o.t ? fmtTarih(o.t) : ''}
          ${o.kim ? `<span class="inline-flex items-center gap-1">${mat('account_circle', 'text-outline text-[14px]')} ${kacis(buyuk(o.kim))}</span>` : ''}</div></div></div>`).join('')
  return kart('history', 'SÜREÇ GEÇMİŞİ', ic)
}

// ---- MASRAF DEFTERİ (finans) ----
function masrafGizliHtml() {
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-8 text-center">
    ${mat('lock', 'text-[32px] text-on-surface-variant')}<p class="text-body-md text-on-surface-variant mt-2">Masraf bilgisi yalnız finans ve yönetici tarafından görülür.</p></div>`
}
function ozetKart(etiket, deger, vurgu = false) {
  return `<div class="bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3">
    <div class="text-[10px] uppercase tracking-wider text-on-surface-variant">${etiket}</div>
    <div class="text-heading-md font-bold ${vurgu ? 'text-primary' : 'text-on-surface'} mt-0.5">${deger}</div></div>`
}
function masrafHtml() {
  const gider = MASRAFLAR.filter(m => m.yon === 'GIDER').reduce((s, m) => s + Number(m.tutar || 0), 0)
  const gelir = MASRAFLAR.filter(m => m.yon === 'GELIR').reduce((s, m) => s + Number(m.tutar || 0), 0)
  const alisFiyat = ALIS?.alis_fiyati != null ? Number(ALIS.alis_fiyati) : null
  const tipOpsList = (TANIM['MASRAF_TIPI'] || []).map(t => `<option value="${kacis(t.ad || t.kod)}"></option>`).join('')
  const bugun = new Date().toISOString().slice(0, 10)
  const duzen = duzenId ? MASRAFLAR.find(m => m.id === duzenId) : null
  const tedGoster = tipOzel(duzen?.masraf_tipi || '').tedarikci_alani === true
  const serit = `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    ${ozetKart('Alış Fiyatı', alisFiyat != null ? fmtPara(alisFiyat) : '—')}${ozetKart('Σ Gider', fmtPara(gider))}
    ${ozetKart('Σ Gelir (indirim)', gelir ? '−' + fmtPara(gelir) : fmtPara(0))}${ozetKart('Net Maliyet', NETMALIYET != null ? fmtPara(NETMALIYET) : '—', true)}</div>`
  const form = `<div class="flex flex-wrap items-end gap-2 bg-surface-container-low border border-outline-variant rounded-xl p-3">
    <label class="flex flex-col gap-1 flex-1 min-w-[160px]"><span class="text-[10px] text-on-surface-variant">Masraf Tipi *</span>
      <input id="mTip" list="mTipList" autocomplete="off" placeholder="Yaz veya seç…" class="${INP}" /><datalist id="mTipList">${tipOpsList}</datalist></label>
    <label class="flex flex-col gap-1 w-28"><span class="text-[10px] text-on-surface-variant">Yön</span>
      <select id="mYon" class="${INP}"><option value="GIDER">Gider</option><option value="GELIR">Gelir</option></select></label>
    <label class="flex flex-col gap-1 w-32"><span class="text-[10px] text-on-surface-variant">Tutar (₺) *</span><input id="mTutar" type="number" inputmode="numeric" class="${INP}" /></label>
    <label id="mTedKap" class="flex-col gap-1 flex-1 min-w-[140px] ${tedGoster ? 'flex' : 'hidden'}"><span class="text-[10px] text-on-surface-variant">Tedarikçi</span><input id="mTed" class="${INP}" /></label>
    <label class="flex flex-col gap-1 flex-[2] min-w-[160px]"><span class="text-[10px] text-on-surface-variant">Açıklama</span><input id="mAcik" class="${INP}" /></label>
    <label class="flex flex-col gap-1 w-40"><span class="text-[10px] text-on-surface-variant">Tarih</span><input id="mTarih" type="date" value="${duzen?.tarih || bugun}" class="${INP}" /></label>
    <button id="mKaydet" class="bg-primary text-on-primary px-4 h-10 rounded-lg text-sm font-bold flex items-center gap-1 hover:opacity-90 shadow-sm">${mat(duzen ? 'save' : 'add', 'text-[18px]')} ${duzen ? 'Güncelle' : 'Ekle'}</button>
    ${duzen ? `<button id="mVazgec" class="px-3 h-10 rounded-lg border border-outline-variant text-on-surface-variant text-sm font-bold hover:bg-surface-container-low">Vazgeç</button>` : ''}</div>`
  // G5 — operasyon iş yazmadıysa uyarı şeridi (sql/111). Form ile liste
  // arasında durur ki masraf tipi seçilir seçilmez göze çarpsın.
  const opUyariKap = `<div id="mOpUyari" class="mt-2"></div>`
  const ic = `${serit}<div class="mt-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-primary">${mat('receipt_long')}<h4 class="text-sm font-bold">Masraf Defteri</h4>${duzen ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">DÜZENLENİYOR</span>` : ''}</div>
      ${varsayilanDuzenler(DANISMAN) ? `<a href="masraf-varsayilan.html" class="text-[12px] font-semibold text-primary hover:underline flex items-center gap-1">${mat('price_change', 'text-[16px]')} Varsayılanları yönet</a>` : ''}</div>
    <div class="mt-3">${form}</div>${opUyariKap}<div class="mt-3">${masrafTabloHtml()}</div>`
  return kart('receipt_long', 'MASRAF DEFTERİ', ic)
}
function masrafTabloHtml() {
  if (!MASRAFLAR.length) return `<div class="p-6">${bosDurum('Henüz masraf işlenmedi.', 'receipt_long')}</div>`
  const satir = m => {
    const gelir = m.yon === 'GELIR'
    return `<tr class="border-b border-outline-variant/40 hover:bg-surface-container-low/50">
      <td class="px-3 py-2 whitespace-nowrap text-body-sm">${fmtTarih(m.tarih)}</td>
      <td class="px-3 py-2 text-body-sm font-semibold">${kacis(tanimAd('MASRAF_TIPI', m.masraf_tipi))}</td>
      <td class="px-3 py-2 text-body-sm text-on-surface-variant">${kacis(m.aciklama || '')}</td>
      <td class="px-3 py-2 text-body-sm text-on-surface-variant">${kacis(m.tedarikci || '')}</td>
      <td class="px-3 py-2"><span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${gelir ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-surface-container-high text-on-surface-variant'}">${gelir ? 'GELİR' : 'GİDER'}</span></td>
      <td class="px-3 py-2 text-right text-body-sm font-bold whitespace-nowrap ${gelir ? 'text-[#047857]' : 'text-on-surface'}">${gelir ? '−' : ''}${fmtPara(m.tutar)}</td>
      <td class="px-3 py-2 text-body-sm text-on-surface-variant whitespace-nowrap">${kacis(danismanAdi(DMAP, m.olusturan))}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button data-duzen="${m.id}" class="w-7 h-7 rounded hover:bg-surface-container-high text-on-surface-variant" title="Düzelt">${mat('edit', 'text-[16px]')}</button>
        <button data-sil="${m.id}" class="w-7 h-7 rounded hover:bg-error/10 text-error" title="Sil">${mat('delete', 'text-[16px]')}</button></td></tr>`
  }
  return `<div class="border border-outline-variant rounded-xl overflow-x-auto"><table class="w-full text-left border-collapse min-w-[720px]">
      <thead><tr class="text-[10px] uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
        <th class="px-3 py-2">Tarih</th><th class="px-3 py-2">Tip</th><th class="px-3 py-2">Açıklama</th><th class="px-3 py-2">Tedarikçi</th>
        <th class="px-3 py-2">Yön</th><th class="px-3 py-2 text-right">Tutar</th><th class="px-3 py-2">Kaydeden</th><th class="px-3 py-2"></th></tr></thead>
      <tbody>${MASRAFLAR.map(satir).join('')}</tbody></table></div>`
}

// =====================================================================
// Olay bağlama
// =====================================================================
function bagla() {
  const q = s => KAP.querySelector(s)
  const qa = s => KAP.querySelectorAll(s)

  qa('button[data-sekme]').forEach(b => b.addEventListener('click', () => { aktifSekme = b.dataset.sekme; duzenleArac = false; duzenleAlis = false; duzenId = null; ciz() }))
  qa('.ad-kapat2').forEach(b => b.addEventListener('click', () => MODAL_KAPAT && MODAL_KAPAT()))
  q('#adAracMenu')?.addEventListener('click', () => kartMenu(q('#adAracMenu'), [{ ik: 'edit', et: 'Düzenle', fn: () => { duzenleArac = true; ciz() } }]))
  q('#adFiyatGonder')?.addEventListener('click', () => fiyatlamaGonderDetay('BEKLIYOR'))
  q('#adFiyatGeri')?.addEventListener('click', () => fiyatlamaGonderDetay(null))
  q('#adYazdir')?.addEventListener('click', () => window.print())
  q('#adTamSayfa')?.addEventListener('click', () => window.open('arac-detay.html?ref=' + encodeURIComponent(ARAC.id), '_blank', 'noopener'))
  q('#adKopyaPlaka')?.addEventListener('click', async () => {
    const oldu = await panoyaYaz(ARAC.plaka || '')
    uyariGoster(oldu ? 'Plaka kopyalandı' : 'Plaka kopyalanamadı', oldu)
  })

  // Araç bilgileri düzenleme
  q('#adAracVazgec')?.addEventListener('click', () => { duzenleArac = false; ciz() })
  q('#adAracKaydet')?.addEventListener('click', aracKaydet)
  // Alış KDV (muhasebe) — seçince anında yazılır
  q('#d_kdv_hizli')?.addEventListener('change', e => kdvKaydet(e.target.value))
  // Alış düzenleme
  q('#adAlisDuzenle')?.addEventListener('click', () => { duzenleAlis = true; ciz() })
  q('#adAlisVazgec')?.addEventListener('click', () => { duzenleAlis = false; ciz() })
  q('#adAlisKaydet')?.addEventListener('click', alisKaydet)
  // Not
  q('#nKaydet')?.addEventListener('click', notKaydet)
  // Kısa yol
  qa('button[data-kisayol]').forEach(b => b.addEventListener('click', () => kisaYolGit(b.dataset.kisayol)))

  // Foto
  q('#fotoInp')?.addEventListener('change', fotoYukle)
  qa('button[data-fotosil]').forEach(b => b.addEventListener('click', () => fotoSil(b.dataset.fotosil, b.dataset.yol)))
  fotoSuruklemeBagla()

  // Evrak
  qa('input[data-evraktip]').forEach(i => i.addEventListener('change', e => evrakYukle(e.target.dataset.evraktip, e.target.files[0])))
  qa('.ad-evrak').forEach(b => b.addEventListener('click', () => evrakAc(b.dataset.evrak)))
  qa('button[data-evraksil]').forEach(b => b.addEventListener('click', () => evrakSil(b.dataset.evraksil, b.dataset.yol)))

  // Ekspertiz (SVG + PDF sürükle-bırak)
  q('#adEkspKaydet')?.addEventListener('click', ekspertizKaydet)
  const ekspDrop = q('#ekspDrop')
  if (ekspDrop) {
    q('#ekspPdf')?.addEventListener('change', e => ekspertizPdfYukle(e.target.files[0]))
    ;['dragenter', 'dragover'].forEach(ev => ekspDrop.addEventListener(ev, e => { e.preventDefault(); ekspDrop.classList.add('border-primary', 'bg-primary/5') }))
    ;['dragleave', 'drop'].forEach(ev => ekspDrop.addEventListener(ev, e => { e.preventDefault(); ekspDrop.classList.remove('border-primary', 'bg-primary/5') }))
    ekspDrop.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) ekspertizPdfYukle(f) })
  }

  // Tramer
  q('#t_ekle')?.addEventListener('click', tramerEkle)
  qa('button[data-tramersil]').forEach(b => b.addEventListener('click', () => tramerSil(b.dataset.tramersil)))
  const tDrop = q('#tramerDrop')
  if (tDrop) {
    const ad = q('#t_gorselAd')
    const setGorsel = f => { TRAMER_GORSEL = f || null; if (ad) ad.textContent = f ? f.name : 'sürükle-bırak / seç' }
    q('#t_gorsel')?.addEventListener('change', e => setGorsel(e.target.files[0] || null))
    ;['dragenter', 'dragover'].forEach(ev => tDrop.addEventListener(ev, e => { e.preventDefault(); tDrop.classList.add('border-primary', 'bg-primary/5') }))
    ;['dragleave', 'drop'].forEach(ev => tDrop.addEventListener(ev, e => { e.preventDefault(); tDrop.classList.remove('border-primary', 'bg-primary/5') }))
    tDrop.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) setGorsel(f) })
  }

  // Masraf
  if (aktifSekme === 'masraf' && finansGorur(DANISMAN)) masrafBagla()

  // Rezervasyon (Faz R3) — Özet'te rezervasyonSeridi() render edildiyse bağlanır
  q('#rezBaslatBtn')?.addEventListener('click', () => { SIP_MODU = false; REZ_DRAWER = true; REZ_MUSTERI = null; REZ_YENI_MUSTERI = false; REZ_SURE = '24h'; ciz() })
  q('#sipBaslatBtn')?.addEventListener('click', () => { SIP_MODU = true; REZ_DRAWER = true; REZ_MUSTERI = null; REZ_YENI_MUSTERI = false; ciz() })
  q('#rezSiparisGit')?.addEventListener('click', () => { if (REZ) location.href = 'siparis-dosya.html?id=' + encodeURIComponent(REZ.id) })
  // Aktif kart (benim rezervasyonum)
  q('#rezDonustur')?.addEventListener('click', rezSipariseDonustur)
  q('#rezUzat')?.addEventListener('click', () => { REZ_UZAT = !REZ_UZAT; REZ_DUZENLE = false; ciz() })
  q('#rezDuzenle')?.addEventListener('click', () => { REZ_DUZENLE = !REZ_DUZENLE; REZ_UZAT = false; ciz() })
  q('#rezKaldir')?.addEventListener('click', rezKaldirAksiyon)
  qa('button[data-uzatsaat]').forEach(b => b.addEventListener('click', () => rezSureUzatKaydet(Number(b.dataset.uzatsaat), null)))
  q('#rezUzatKaydet')?.addEventListener('click', () => { const t = q('#rezUzatTarih')?.value; if (t) rezSureUzatKaydet(null, t); else uyariGoster('Tarih/saat seçin.') })
  q('#rezUzatVazgec')?.addEventListener('click', () => { REZ_UZAT = false; ciz() })
  q('#rezDzKaydet')?.addEventListener('click', rezDuzenleKaydet)
  q('#rezDzVazgec')?.addEventListener('click', () => { REZ_DUZENLE = false; ciz() })
  // Guard kart (başkasının rezervasyonu)
  q('#rezDetayGor')?.addEventListener('click', () => { REZ_GUARD_DETAY = !REZ_GUARD_DETAY; ciz() })
  q('#rezDevral')?.addEventListener('click', rezDevral)
  q('#rezKilitKaldir')?.addEventListener('click', rezKilitKaldir)
  // Drawer (Rezervasyon Başlat)
  if (REZ_DRAWER) {
    q('#rezDrawerKapat')?.addEventListener('click', () => rezDrawerKapat())
    q('#rezBg')?.addEventListener('click', () => rezDrawerKapat())
    q('#rezMAra')?.addEventListener('input', rezMusteriAra)
    q('#rezYeniMBtn')?.addEventListener('click', () => { REZ_YENI_MUSTERI = !REZ_YENI_MUSTERI; ciz() })
    q('#rezMKaldir')?.addEventListener('click', () => { REZ_MUSTERI = null; ciz() })
    qa('button[data-sure]').forEach(b => b.addEventListener('click', () => { REZ_SURE = b.dataset.sure; ciz() }))
    q('#rezKaydetBtn')?.addEventListener('click', rezKaydet)
    if (!REZ_ESC) {
      REZ_ESC = e => { if (e.key === 'Escape') rezDrawerKapat() }
      document.addEventListener('keydown', REZ_ESC)
    }
  } else if (REZ_ESC) { document.removeEventListener('keydown', REZ_ESC); REZ_ESC = null }
}

function masrafBagla() {
  const el = id => KAP.querySelector('#' + id)
  const tipEl = el('mTip'), yonEl = el('mYon'), tutarEl = el('mTutar'), tedKap = el('mTedKap')
  if (duzenId) {
    const m = MASRAFLAR.find(x => x.id === duzenId)
    if (m) { tipEl.value = tanimAd('MASRAF_TIPI', m.masraf_tipi); yonEl.value = m.yon; tutarEl.value = m.tutar; tutarEl.dataset.elle = '1'; el('mAcik').value = m.aciklama || ''; if (el('mTed')) el('mTed').value = m.tedarikci || '' }
  }
  const tipDegisti = () => {
    const kod = masrafTipiKod(tipEl.value); const oz = tipOzel(kod)
    yonEl.value = oz.varsayilan_yon || 'GIDER'
    tedKap.classList.toggle('hidden', oz.tedarikci_alani !== true); tedKap.classList.toggle('flex', oz.tedarikci_alani === true)
    if (tutarEl.dataset.elle !== '1') { const v = masrafVarsayilan(kod, ALIS?.alis_sekli); tutarEl.value = v != null ? v : '' }
  }
  tipEl?.addEventListener('change', tipDegisti)
  tipEl?.addEventListener('input', () => { if (masrafTipiKod(tipEl.value)) tipDegisti() })
  // G5 — operasyon iş yazmadıysa uyar (engel DEĞİL, sql/111). Tip alanı serbest
  // metin olduğu için kod çeviricisi masrafTipiKod ile veriliyor.
  masrafKapiBagla({ tipEl, kapId: 'mOpUyari', aracId: () => ARAC?.id, kod: masrafTipiKod })
  tutarEl?.addEventListener('input', () => { tutarEl.dataset.elle = tutarEl.value ? '1' : '' })
  el('mKaydet')?.addEventListener('click', masrafKaydet)
  el('mVazgec')?.addEventListener('click', () => { duzenId = null; ciz() })
  KAP.querySelectorAll('button[data-duzen]').forEach(b => b.addEventListener('click', () => { duzenId = b.dataset.duzen; ciz() }))
  KAP.querySelectorAll('button[data-sil]').forEach(b => b.addEventListener('click', () => masrafSil(b.dataset.sil)))
}

function fotoSuruklemeBagla() {
  KAP.querySelectorAll('.foto-kart[draggable="true"]').forEach(k => {
    k.addEventListener('dragstart', () => { SRC_FOTO = +k.dataset.idx; k.classList.add('opacity-40') })
    k.addEventListener('dragend', () => { SRC_FOTO = null; k.classList.remove('opacity-40') })
    k.addEventListener('dragover', e => { e.preventDefault(); k.classList.add('ring-2', 'ring-primary') })
    k.addEventListener('dragleave', () => k.classList.remove('ring-2', 'ring-primary'))
    k.addEventListener('drop', e => { e.preventDefault(); k.classList.remove('ring-2', 'ring-primary'); fotoSirala(SRC_FOTO, +k.dataset.idx) })
  })
}
async function fotoSirala(from, to) {
  if (from == null || to == null || from === to) return
  const arr = [...FOTOLAR]; const [t] = arr.splice(from, 1); arr.splice(to, 0, t); FOTOLAR = arr; ciz()
  for (let i = 0; i < FOTOLAR.length; i++) {
    const { data, error } = await supabase.from('arac_fotograflari').update({ sira: i }).eq('id', FOTOLAR[i].id).select('id')
    if (error) { dbHata('foto sıra', error); break }
    // ⚠️ .update() HATA VERMEDEN 0 satır güncelleyebilir (CLAUDE.md §5.1).
    //   Tam bu oldu: tabloda UPDATE politikası hiç yoktu, sürükle-bırak
    //   ekranda çalışıyor görünüp DB'ye hiçbir şey yazmıyordu (sql/118).
    if (!data || !data.length) {
      console.error('[db] foto sıra: 0 satır güncellendi — yetki yok', FOTOLAR[i].id)
      alert('Fotoğraf sırası kaydedilemedi: yetkin yok. Sıralamayı bilgi işlem yapabilir.')
      break
    }
  }
}

function kisaYolGit(act) {
  if (act === 'ekspertiz' || act === 'tramer') {
    if (aktifSekme !== 'ozet') { aktifSekme = 'ozet'; ciz() }
    KAP.querySelector(act === 'ekspertiz' ? '#ekspKart' : '#tramerKart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else if (act === 'fiyatlama') location.href = 'fiyatlama.html'
}

// Kart "..." açılır menüsü (fixed — taşma kırpmaz)
function kartMenu(btn, items) {
  kartMenuKapat()
  const menu = document.createElement('div')
  menu.className = 'fixed z-[80] w-44 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg py-1'
  menu.innerHTML = items.map((it, i) => `<button data-i="${i}" class="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-low flex items-center gap-2">${mat(it.ik, 'text-[16px]')} ${it.et}</button>`).join('')
  document.body.appendChild(menu); KMENU = menu
  const r = btn.getBoundingClientRect()
  menu.style.left = Math.max(8, r.right - 176) + 'px'
  let top = r.bottom + 4
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4)
  menu.style.top = top + 'px'
  menu.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => { const it = items[+b.dataset.i]; kartMenuKapat(); it.fn() }))
  KMENU_DIS = e => { if (!menu.contains(e.target)) kartMenuKapat() }
  setTimeout(() => document.addEventListener('click', KMENU_DIS), 0)
}
function kartMenuKapat() {
  if (KMENU_DIS) { document.removeEventListener('click', KMENU_DIS); KMENU_DIS = null }
  if (KMENU) { KMENU.remove(); KMENU = null }
}

// --- arabam paket eşleşmesi (bilgi işlem, kuyruğa gönderirken) -------------
// Piyasa analizi robotu bu sözlükten okur. Eşleşme yoksa araç MODEL
// seviyesinde ölçülür (Clio geneli gibi) — paket seçilirse rakam keskinleşir.
// Otomatik bulanık eşleştirme YOK: yanlış paket sessizce yanlış fiyat üretir.
// ⚠️ Paket seçici BU DOSYADAN ÇIKARILDI → arabam-paket.js (tek kaynak).
//    Araç Kabul Merkezi de aynı seçiciyi kullanıyor; iki kopya olsaydı
//    biri güncellenip öbürü unutulurdu.

// ⚠️ 7 Ağu 2026 — BU FONKSİYON CANLIDA PATLIYORDU:
//    "ReferenceError: paketSecici is not defined". Seçici bu dosyadan
//    çıkarıldı (yukarıdaki nota bak) ama IMPORT EKLENMEDİ. node --check
//    sözdizimine bakar, tanımsız çağrıyı GÖREMEZ; hata ancak butona
//    basınca ortaya çıkıyordu. Ders: bir fonksiyonu başka modüle taşırken
//    çağıran her yeri çalıştırarak dene, derlemeyle yetinme.
//    Artık tek karar noktası paketSorVeYaz — "vazgeçildi mi / yazıldı mı"
//    kuralı burada TEKRARLANMAZ (arabam-paket.js tek kaynak).
async function fiyatlamaGonderDetay(durum) {
  // Kuyruğa GÖNDERİRKEN paketi bilgi işlem seçer (İsmail Bey doğrudan fiyatı görsün)
  if (durum === 'BEKLIYOR') {
    const { paketSorVeYaz } = await import('./arabam-paket.js')
    if (!(await paketSorVeYaz(ARAC))) return               // vazgeçildi ya da yazılamadı
  }
  const { data, error } = await supabase.from('stok_araclar').update({ fiyatlama_durumu: durum }).eq('id', ARAC.id).select('id')
  if (error) { dbHata('fiyatlamaya gönder', error); uyariGoster('İşlem başarısız: ' + error.message); return }
  if (!data?.length) { uyariGoster('Güncellenemedi — yetki/kayıt yok.'); return }
  await veriYukle(ARAC.id, DANISMAN); ciz()
  uyariGoster(durum ? 'Fiyatlama kuyruğuna gönderildi.' : 'Kuyruktan geri alındı.', true)
}

// Ekspertiz PDF oku → SVG'yi doldur (Kaydet ile onaylanır; PDF evrak olarak yüklenir)
async function ekspertizPdfYukle(f) {
  if (!f) return
  const ozet = KAP.querySelector('#ekspOzet')
  if (ozet) { ozet.classList.remove('hidden'); ozet.textContent = 'PDF okunuyor…' }
  const r = await ekspertizOku(f, p => {
    if (ozet) ozet.textContent = `Şema okunuyor (OCR)… %${Math.round(p * 100)}`
  })
  if (r.hata) { uyariGoster('PDF okunamadı: ' + r.hata); if (ozet) ozet.classList.add('hidden'); return }
  // ⚠️ HATA DÜZELTMESİ: eskiden okunamayan panel `|| 'ORIJINAL'` ile ORİJİNAL
  // yazılıyordu. ÜSTÜN/YAMANLAR hiç okunamadığı için o PDF'ler aracı TÜMÜYLE
  // ORİJİNAL işaretliyordu — boyalı aracı orijinal fiyatlamak demekti.
  // Artık yalnız GERÇEKTEN okunan panel yazılır, kalanı olduğu gibi kalır.
  EKSP_PANEL = Object.fromEntries(PARCALAR.map(p => [p, r.paneller[p] || EKSP_PANEL[p] || 'ORIJINAL']))
  EKSP_PDF = f; EKSP_DIRTY = true; EKSP_FIRMA = r.firma || null
  ciz()
  if (ozet) {
    ozet.classList.remove('hidden')
    const boyali = PARCALAR.filter(p => EKSP_PANEL[p] !== 'ORIJINAL').length
    const eksik = (r.okunamayan || []).length
    ozet.innerHTML = `<b>${kacis(r.firma || 'Ekspertiz')}</b> okundu · ${boyali} boyalı/değişen${r.km != null ? ' · KM: ' + r.km.toLocaleString('tr-TR') : ''} — <b>Kaydet</b> ile onayla.`
      + (eksik ? `<br><span class="text-[#B45309] font-bold">⚠ ${eksik} parça okunamadı (${kacis((r.okunamayan || []).join(', '))}) — şemadan elle işaretle.</span>` : '')
  }
}

// =====================================================================
// Aksiyonlar
// =====================================================================
async function aracKaydet() {
  if (aracKilitli()) { duzenleArac = false; ciz(); uyariGoster('Araç fiyatlamaya gönderildi — araç bilgileri düzenlemesi kapalı.'); return }
  const g = id => KAP.querySelector('#' + id)?.value?.trim() ?? ''
  const hataEl = KAP.querySelector('#adAracHata')
  const hata = m => { if (hataEl) { hataEl.textContent = m; hataEl.classList.remove('hidden') } }
  const plaka = g('d_plaka').toUpperCase()
  if (!plaka) return hata('Plaka boş olamaz.')
  const btn = KAP.querySelector('#adAracKaydet'); if (btn) btn.disabled = true
  const guncel = {
    plaka, sasi_no: g('d_sasi').toUpperCase() || null, motor_no: g('d_motor').toUpperCase() || null,
    marka: g('d_marka') || null, model: g('d_model') || null, versiyon: g('d_versiyon') || null,
    yil: g('d_yil') ? +g('d_yil') : null, yakit: g('d_yakit') || null, vites: g('d_vites') || null,
    kasa_tipi: g('d_kasa') || null, renk: g('d_renk') || null, km: g('d_km') ? +g('d_km') : null,
    ruhsat_seri_no: g('d_ruhsatseri').toUpperCase() || null, lokasyon: g('d_lokasyon') || null, park: g('d_park') || null,
    muayene_tarihi: g('d_muayene') || null, yedek_anahtar: KAP.querySelector('#d_anahtar')?.checked || false,
    tescil_tarihi: g('d_tescil') || null, ilk_tescil_tarihi: g('d_ilktescil') || null,
  }
  const { data, error } = await supabase.from('stok_araclar').update(guncel).eq('id', ARAC.id).select('id')
  if (error) { dbHata('araç güncelle', error); if (btn) btn.disabled = false; return hata('Kaydedilemedi: ' + error.message) }
  if (!data?.length) { if (btn) btn.disabled = false; return hata('Güncellenemedi — yetki veya kayıt yok.') }
  duzenleArac = false
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Araç bilgileri kaydedildi.', true)
}

async function alisKaydet() {
  const g = id => KAP.querySelector('#' + id)?.value?.trim() ?? ''
  const btn = KAP.querySelector('#adAlisKaydet'); if (btn) btn.disabled = true
  // NOT: alis_fiyati burada YOK — Fiyatlama Merkezi'nde belirlenir, buradan ezilmez.
  const alisG = {
    noter_alis_fiyati: g('d_noterfiyat') ? +g('d_noterfiyat') : null,
    alis_tarihi: g('d_alistarih') || null,
    // sql/180 — alış devrinin noter kaydı. Boş bırakılabilir; zorunlu değil
    // çünkü ihaleden/kurumdan alımlarda noter devri farklı yürüyor.
    noter_adi: g('d_alisnoter') || null,
    yevmiye_no: g('d_alisyevmiye') || null,
    noter_tarihi: g('d_alisnotertarih') || null,
  }
  // Alış Şekli yalnız finans formunda var; bilgi işlem formunda YOK → gönderilmez
  // ki İsmail Bey'in girdiği alis_sekli null'a EZİLMESİN.
  const sekliEl = KAP.querySelector('#d_alissekli')
  if (sekliEl) alisG.alis_sekli = sekliEl.value || null
  let hata = null
  if (ALIS) {
    const { data, error } = await supabase.from('arac_alislar').update(alisG).eq('arac_id', ARAC.id).select('id')
    if (error) hata = error; else if (!data?.length) hata = { message: 'kayıt/yetki yok' }
  } else {
    const { error } = await supabase.from('arac_alislar').insert({ arac_id: ARAC.id, alis_tarihi: alisG.alis_tarihi || bugunISO(), ...alisG })
    if (error) hata = error
  }
  if (hata) { dbHata('alış kaydet', hata); if (btn) btn.disabled = false; uyariGoster('Alış kaydedilemedi (yetki?): ' + hata.message); return }
  duzenleAlis = false
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Alış bilgileri kaydedildi.', true)
}

async function notKaydet() {
  const notu = KAP.querySelector('#nInp')?.value.trim() || null
  const { data, error } = await supabase.from('stok_araclar').update({ notu }).eq('id', ARAC.id).select('id')
  if (error) { dbHata('not kaydet', error); uyariGoster('Not kaydedilemedi: ' + error.message); return }
  if (!data?.length) { uyariGoster('Not kaydedilemedi — yetki/kayıt yok.'); return }
  ARAC.notu = notu; ciz(); uyariGoster('Not kaydedildi.', true)
}

// Aşağıdaki beşi artık YALNIZCA arayüz işi yapar; dosya/DB işini
// arac-dosya.js yürütür. Sıra numarası FOTOLAR.length yerine mevcut EN
// BÜYÜK sıradan devam eder — silme sonrası uzunluk düşüp sıra çakışıyordu.
async function fotoYukle(e) {
  const files = [...(e.target.files || [])]; if (!files.length) return
  const durum = KAP.querySelector('#fotoDurum')
  const bilgi = t => { if (durum) { durum.textContent = t; durum.classList.remove('hidden') } }
  const bas = FOTOLAR.reduce((m, f) => Math.max(m, (f.sira ?? 0) + 1), 0)
  const { hata } = await fotograflariYukle({
    aracId: ARAC.id, dosyalar: files, baslangicSira: bas, yukleyen: DANISMAN?.id || null,
    ilerleme: (i, n) => bilgi(`Yükleniyor… (${i}/${n})`),
  })
  bilgi(hata ? `${hata} fotoğraf yüklenemedi (yetki: yalnız medya yöneticisi).` : 'Yüklendi.')
  await veriYukle(ARAC.id, DANISMAN); ciz()
}
async function fotoSil(id, yol) {
  if (!confirm('Bu fotoğraf silinsin mi?')) return
  const r = await dsFotoSil({ id, yol })
  if (!r.ok) { alert('Silinemedi: ' + r.msg); return }
  await veriYukle(ARAC.id, DANISMAN); ciz()
}

async function evrakYukle(tip, file) {
  if (!file) return
  const durum = KAP.querySelector('#evrakDurum'); const bilgi = t => { if (durum) { durum.textContent = t; durum.classList.remove('hidden') } }
  bilgi('Yükleniyor…')
  const r = await evrakiYukle({ aracId: ARAC.id, tip, dosya: file })
  if (!r.ok) { bilgi('Yüklenemedi: ' + r.msg); return }
  bilgi('Yüklendi.')
  await veriYukle(ARAC.id, DANISMAN); ciz()
}
async function evrakAc(yol) {
  const r = await dsEvrakAc(yol)
  if (!r.ok) alert('Belge açılamadı: ' + r.msg)
}
async function evrakSil(id, yol) {
  if (!confirm('Bu evrak silinsin mi?')) return
  const r = await dsEvrakSil({ id, yol })
  if (!r.ok) { uyariGoster('Silinemedi: ' + r.msg); return }
  await veriYukle(ARAC.id, DANISMAN); ciz()
}

// ⚠️ FARK TABANLI (ortak yardımcı, ekspertiz.js). Eskiden "hepsini sil +
//    hepsini yaz" idi; silme politikası master/yönetici, yazma politikası
//    herkese açık olduğu için yetkisiz kullanıcıda silme sessizce 0 satır
//    siliyor, insert geçiyor ve MÜKERRER satır kalıyordu. sql/201 tekillik
//    kısıtı bunu artık reddeder → bu ekran da fark tabanlına çevrildi,
//    yoksa kısıt ihlaliyle patlardı.
async function ekspertizKaydet() {
  const btn = KAP.querySelector('#adEkspKaydet'); if (btn) btn.disabled = true
  const mevcut = {}
  for (const e of (EKS || [])) mevcut[e.parca_kodu] = e.durum
  const r = await ekspertizFarkKaydet({
    aracId: ARAC.id, mevcut, hedef: ekspertizHedef(EKSP_PANEL),
    silebilir: !!(DANISMAN && (DANISMAN.master_admin || DANISMAN.rol === 'yonetici')),
  })
  if (!r.ok) { uyariGoster(r.msg); if (btn) btn.disabled = false; return }
  // PDF varsa evrak olarak yükle — tek kaynak arac-dosya.js.
  // (webpCevir PDF'i tanır ve dokunmadan geçirir; canvas'tan geçirmek bozardı.)
  if (EKSP_PDF) {
    const r = await evrakiYukle({ aracId: ARAC.id, tip: 'EKSPERTIZ_PDF', dosya: EKSP_PDF })
    if (!r.ok) console.error('[ekspertiz pdf]', r.msg)
    EKSP_PDF = null
  }
  // Firmayı araca yaz — satış dosyasındaki "Güncel İste" bunu okuyor (sql/151).
  // Okunamadıysa (elle işaretlenen rapor) MEVCUT DEĞERİ EZME.
  if (EKSP_FIRMA) {
    const { data: fd, error: fe } = await supabase.from('stok_araclar')
      .update({ ekspertiz_firma: EKSP_FIRMA }).eq('id', ARAC.id).select('id')
    if (fe) dbHata('ekspertiz firma yaz', fe)
    else if (!fd?.length) console.error('[ekspertiz firma] 0 satir guncellendi — yetki?')
    EKSP_FIRMA = null
  }
  EKSP_DIRTY = false
  await veriYukle(ARAC.id, DANISMAN); ciz(); uyariGoster('Ekspertiz kaydedildi.', true)
}

async function tramerEkle() {
  const g = id => KAP.querySelector('#' + id)?.value.trim() || ''
  const sorgu = g('t_sorgu') || bugunISO(); const htarih = g('t_htarih') || null
  const neden = g('t_neden') || null; const tutar = g('t_tutar') ? Number(g('t_tutar')) : null
  const gorsel = TRAMER_GORSEL || KAP.querySelector('#t_gorsel')?.files?.[0] || null
  if (!htarih && !neden && !tutar && !gorsel) { uyariGoster('Hasar bilgisi veya görsel gir.'); return }
  if (htarih || neden || tutar) {
    const { data, error } = await supabase.from('arac_tramer').insert({ arac_id: ARAC.id, sorgu_tarihi: sorgu, hasar_tarihi: htarih, aciklama: neden, tutar }).select('id')
    if (error) { dbHata('tramer ekle', error); uyariGoster('Hasar eklenemedi (yetki?): ' + error.message); return }
    if (!data?.length) { uyariGoster('Hasar eklenemedi — yetki/kayıt yok.'); return }
  }
  if (gorsel) await evrakYukle('SBM_GORSEL', gorsel)
  else { await veriYukle(ARAC.id, DANISMAN); ciz() }
}
async function tramerSil(id) {
  if (!confirm('Bu hasar satırı silinsin mi?')) return
  const { data, error } = await supabase.from('arac_tramer').delete().eq('id', id).select('id')
  if (error) { dbHata('tramer sil', error); uyariGoster('Silinemedi (yetki?): ' + error.message); return }
  if (!data?.length) { uyariGoster('Silinemedi — yetki/kayıt yok.'); return }
  await veriYukle(ARAC.id, DANISMAN); ciz()
}

async function masrafKaydet() {
  const el = id => KAP.querySelector('#' + id)
  const tip = masrafTipiKod(el('mTip').value); const tutar = Number(el('mTutar').value); const yon = el('mYon').value
  const tedGoster = tipOzel(tip).tedarikci_alani === true
  const ted = tedGoster ? (el('mTed')?.value.trim() || null) : null
  const aciklama = el('mAcik').value.trim() || null; const tarih = el('mTarih').value || new Date().toISOString().slice(0, 10)
  if (!tip) return uyariGoster('Geçerli bir masraf tipi seç (listeden).')
  if (!tutar || tutar <= 0) return uyariGoster('Tutar zorunlu (0’dan büyük).')
  if (duzenId) {
    const { data, error } = await supabase.from('arac_masraflar').update({ masraf_tipi: tip, yon, tutar, tedarikci: ted, aciklama, tarih }).eq('id', duzenId).select('id')
    if (error) { dbHata('masraf güncelle', error); return uyariGoster('Güncellenemedi (yetki?): ' + error.message) }
    if (!data?.length) return uyariGoster('Güncellenemedi: kayıt/yetki yok.')
    duzenId = null
  } else {
    const { data, error } = await supabase.from('arac_masraflar').insert({ arac_id: ARAC.id, masraf_tipi: tip, yon, tutar, tedarikci: ted, aciklama, tarih, olusturan: DANISMAN?.id || null }).select('id')
    if (error) { dbHata('masraf ekle', error); return uyariGoster('Masraf eklenemedi (yetki?): ' + error.message) }
    if (!data?.length) return uyariGoster('Masraf eklenemedi (yetki?).')
  }
  await masrafYukle(ARAC.id); ciz(); KAP.querySelector('#mTip')?.focus()
}
async function masrafSil(id) {
  if (!confirm('Bu masraf satırı silinsin mi?')) return
  const { data, error } = await supabase.from('arac_masraflar').delete().eq('id', id).select('id')
  if (error) { dbHata('masraf sil', error); return uyariGoster('Silinemedi (yetki?): ' + error.message) }
  if (!data?.length) return uyariGoster('Silinemedi: kayıt/yetki yok.')
  if (duzenId === id) duzenId = null
  await masrafYukle(ARAC.id); ciz()
}

function uyariGoster(msg, basari = false) {
  let el = document.getElementById('adUyari')
  if (!el) { el = document.createElement('div'); el.id = 'adUyari'; el.className = 'fixed bottom-4 right-4 z-[70]'; document.body.appendChild(el) }
  el.innerHTML = `<div class="${basari ? 'bg-green-600' : 'bg-error'} text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold">${kacis(msg)}</div>`
  setTimeout(() => { el.innerHTML = '' }, 3500)
}
