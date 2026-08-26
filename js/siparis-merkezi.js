// =====================================================================
// siparis-merkezi.js — Sipariş Merkezi (Premium Enterprise DMS · R5)
//   YALNIZ siparişe alınmış araçların operasyon tablosu (asama=SIPARIS ve
//   sonrası: Sipariş / Teslim Onay / Satıldı / Teslim Edildi / İptal).
//   Teklif & Rezervasyon bu ekranda GÖRÜNMEZ (onlar Araç Kartı akışında).
//
//   Tasarım kaynağı: Stitch "Premium Enterprise DMS — Sipariş Merkezi",
//   PROJE bordo temasına uyarlandı. Klasik ERP tablosu DEĞİL:
//     • 6 KPI kartı · tek satır filtre · zengin tablo · satır-içi accordion
//     • Satıra tıkla → tam sayfa Satış Dosyası (siparis-dosya.html) — popup YOK
//     • "Durum" (sağlık) kolonu: dosya açılmadan problemi gösterir (Göksenil onayı)
//     • Teslimat Onaya Gönder hem buradan hem Satış Dosyası'ndan yapılır
//     • İptal → neden SORULUR (tanimlar IPTAL_NEDENI + serbest); araç DB trigger
//       (sql/62) ile otomatik STOKTA'ya döner. İptal nedeni siparisler'e yazılır (sql/66).
//   Kurallar (değişmedi):
//     • Bakiye UI'da HESAPLANMAZ — v_siparis_bakiye'den okunur (security_invoker).
//     • Onaya-gönder/teslim gate'leri SUNUCUDA da zorlanır (sql/48); UI yansıtır.
//     • olaylar'a yazma yalnız olay_ekle() RPC ile.
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, danismanAdi, fmtPara, fmtTarih, fmtTarihKisa, kacis, trBuyuk, buyuk, telNo, dbHata, TESLIMAT_DURUM_ETIKET, rezervasyonNedenEtiket, disLokasyon, TESLIM_SINIF, TESLIM_SORUMLU_ETIKET, TESLIM_CIPLERI, bugunISO, gunEkleISO, urlParam } from './veri.js'
import { mat, basHarf, uyari, binlikInputKur, cipler, toast } from './stitch-ui.js'
import { satisMuduruMu, mudurMu } from './yetki.js'
import { teslimPencereAc } from './teslim-pencere.js'

const KOK = () => document.getElementById('kok')

let BEN = null
let SIP = []                 // asama=SIPARIS siparişleri (+ araç/müşteri embed + _bakiye + _sonHareket)
let DMAP = {}
let KASA = []
let IPTAL_NEDENLERI = []      // [{kod, ad}]
let GECIKME_NEDENLERI = []    // tanimlar TESLIM_GECIKME_NEDENI → [{kod, ad, ozellikler:{sorumlu, not_zorunlu}}]
let KAPAK = new Map()         // arac_id → kapak fotoğrafı dosya_yolu (sira 0)
let acikDrawer = null         // sağdan açılan hızlı bakış panelinin sipariş id'si
let tikZaman = null           // tek tık / çift tık ayrımı için gecikme
let NOT_BALON = null          // açık görüşme notu balonu
let PLAN = new Map()          // siparis_id -> v_teslim_plani satırı (sınıf/sıra SUNUCUDAN)
let BUGUN_TAMAM = 0           // bugüne planlanıp TESLİM EDİLMİŞ dosya sayısı
let spmPlan = null            // Stoktan Sipariş modalında seçilen teslim planı
// Açık "Tarih / gerekçe" penceresindeki SİSTEM TEŞHİSİ (gecikme_nedeni_turet).
// ⚠️ Bu RPC HİÇBİR ŞEY YAZMAZ, yalnız önerir. Danışmana boş "neden gecikti?"
//    kutusu sorulmaz: sistem sebebi zaten biliyor, danışman DOĞRULAR.
//    RPC hata verirse null kalır ve pencere Faz 1'deki gibi çalışır.
let sptTeshis = null
const filtre = { arama: '', danisman: '', durum: '', sinif: '' }

const one = v => (Array.isArray(v) ? v[0] : v) || null
const B = v => kacis(buyuk(v ?? ''))
const sifirMi = b => b != null && Math.abs(b) < 0.005
// ⚠️ Bakiye TAM SIFIR olmalı (sql/149): eksik tahsilat da FAZLA tahsilat
//    da teslimat onayını engeller. Kısa süre `>= -0.005` ("borç kalmadı mı")
//    denendi, Göksenil düzeltti. Kapılarda sifirMi() kullanılır; sunucudaki
//    şart 5 ile aynı eşik olmalı.
const bugunMu = d => { if (!d) return false; const x = new Date(d), n = new Date(); return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth() && x.getDate() === n.getDate() }

export async function siparisMerkeziKur(d) {
  BEN = d || null
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant text-body-md">Siparişler yükleniyor…</div>`
  binlikInputKur()
  DMAP = await danismanMap()
  await yukle()
  derinBaglanti()
}

// ---------- Derin bağlantı: bildirimden doğrudan pencereye ----------
// Bildirimler siparis.html'e "?id=<siparis>&gerekce=1" ile bağlanır.
// Kullanıcıyı listede satır aratmak yerine O DOSYANIN penceresi açılır.
// ⚠️ yukle() BİTTİKTEN sonra çağrılır: pencere ciz()'in bastığı #spModalKat
//    içine yazılıyor, erken çağrılırsa kap henüz yok.
function derinBaglanti() {
  const id = urlParam('id')
  if (!id || urlParam('gerekce') !== '1') return
  // Parametreyi URL'den düşür: sayfa yenilenince pencere tekrar açılmasın.
  try {
    const u = new URL(location.href); u.searchParams.delete('gerekce')
    history.replaceState(null, '', u.pathname + u.search + u.hash)
  } catch (e) { console.warn('[teslim] derin bağlantı URL temizlenemedi', e) }
  const s = SIP.find(x => x.id === id)
  if (!s) return toast('Bu sipariş listede değil — teslim edilmiş, iptal edilmiş ya da görme yetkiniz dışında olabilir.')
  if (!s._plan) return toast('Bu dosyada teslim planı kaydı yok.')
  if (s._plan.plan_muaf) return toast('İhale dosyasında teslim planı tutulmaz.')
  // Plan satırı var ama tarih yoksa doğru kapı göç penceresi (planBtnHtml ile aynı ayrım).
  if (!s._plan.planlanan) return gocAc(id)
  planAc(id)
}

async function yukle() {
  const [{ data: kasa, error: kErr }, { data: iptalN, error: iErr }, { data: gecikmeN, error: gErr }] = await Promise.all([
    supabase.from('kasa_hesaplari').select('id, ad, tip').eq('aktif', true).order('sira'),
    supabase.from('tanimlar').select('kod, ad, sira').eq('tip', 'IPTAL_NEDENI').eq('aktif', true).order('sira'),
    // Teslim gecikme gerekçeleri (sql/244) — "Tarih / gerekçe" penceresinde
    // kullanılır. ozellikler->>'sorumlu' kimin çözeceğini, 'not_zorunlu' ise
    // açıklamanın şart olup olmadığını söyler; ikisi de sunucuda da dayatılır.
    supabase.from('tanimlar').select('kod, ad, ozellikler').eq('tip', 'TESLIM_GECIKME_NEDENI').eq('aktif', true).order('sira'),
  ])
  if (kErr) dbHata('kasa hesapları', kErr)
  if (iErr) dbHata('iptal nedenleri', iErr)
  if (gErr) dbHata('teslim gecikme nedenleri', gErr)
  KASA = kasa || []
  IPTAL_NEDENLERI = iptalN || []
  GECIKME_NEDENLERI = gecikmeN || []

  const { data, error } = await supabase.from('siparisler')
    .select(`id, arac_id, alici_musteri_id, danisman_id, olusturan, asama, durum, teslimat_durumu,
             anlasilan_tutar, kapora_tutar, rezervasyon_nedeni, rezervasyon_notu, satis_sekli, satis_tarihi, noter_adi, yevmiye_no,
             yeni_ruhsat_seri_no, yeni_plaka, plaka_degisecek,
             teslim_tarihi, created_at, sira,
             stok_araclar(marka, model, versiyon, yil, plaka, km, renk, lokasyon, durum, ruhsat_url),
             musteriler(ad_soyad, telefon)`)
    .eq('asama', 'SIPARIS')
    // ⚠️ TESLİM EDİLEN SİPARİŞ BURADA LİSTELENMEZ (Göksenil, 5 Ağu 2026):
    //   "aracın satışını gerçekleştirdim, araç sipariş merkezinde durmaya
    //    devam ediyor — satılan araç satış merkezinde görünmeli sadece."
    //   Teslim = dosya kapandı; buradan sonrası Satış Merkezi'nin işi
    //   (satis_snapshot). Süzgeç SUNUCUDA: satır hiç indirilmiyor.
    .neq('durum', 'TESLIM_EDILDI')
    .order('created_at', { ascending: false })
  if (error) { dbHata('siparis yükle', error); KOK().innerHTML = uyari('Siparişler okunamadı: ' + kacis(error.message)); return }
  SIP = data || []

  // ---- Teslim planı (sql/244-245) ----
  // ⚠️ Sınıf (sinif) ve sıra (sira_anahtari) SUNUCUDA hesaplanır. Aynı kuralı
  //    burada TEKRARLAMA: iki yerde yaşayan kural sessizce eskir.
  // ⚠️ PostgREST varsayılan 1000 satır limiti sessizce keser (CLAUDE.md §5/3).
  //    Limiti açıkça veriyoruz; dolarsa sayfalama gerekir, uyarı basılır.
  const PLAN_LIMIT = 2000
  PLAN = new Map()
  const { data: plan, error: pErr } = await supabase.from('v_teslim_plani').select('*').limit(PLAN_LIMIT)
  if (pErr) dbHata('teslim planı', pErr)
  if ((plan || []).length >= PLAN_LIMIT) console.warn('[teslim] v_teslim_plani ' + plan.length + ' satır döndü — limite dayandı, sayfalama gerekli')
  for (const p of (plan || [])) PLAN.set(p.siparis_id, p)

  // "Bugün Teslim" sayacının TAMAM ayağı: teslim edilen sipariş v_teslim_plani'dan
  // DÜŞER (view yalnız açık + teslim edilmemiş dosyaları taşır) ve ana listede de
  // yoktur (durum != TESLIM_EDILDI süzgeci). O yüzden ayrı sayılır.
  // ⚠️ `durum` SÜZGECİ ŞART: iptal edilmiş ama teslim_tarihi dolu kalan dosya
  //    (iptal, teslim damgasını silmiyor) sayacı şişiriyordu — "3 tamam"
  //    yazarken bugün gerçekte 2 araç teslim edilmişti. "Tamam" = TESLIM_EDILDI.
  const { data: tesEdilen, error: teErr } = await supabase.from('siparisler')
    .select('id').eq('planlanan_teslim_tarihi', bugunISO())
    .eq('durum', 'TESLIM_EDILDI').not('teslim_tarihi', 'is', null).limit(1000)
  if (teErr) dbHata('bugün teslim edilen', teErr)
  BUGUN_TAMAM = (tesEdilen || []).length

  // Sipariş bazlı bakiye
  const { data: bak, error: bErr } = await supabase.from('v_siparis_bakiye').select('siparis_id, bakiye')
  if (bErr) dbHata('sipariş bakiye', bErr)
  const bakMap = new Map((bak || []).map(b => [b.siparis_id, Number(b.bakiye)]))

  // Son hareket (en yeni olay) — görünen siparişler için
  const ids = SIP.map(s => s.id)
  const sonMap = new Map()
  if (ids.length) {
    const { data: olaylar, error: oErr } = await supabase.from('olaylar')
      .select('siparis_id, olusma_zamani').in('siparis_id', ids).order('olusma_zamani', { ascending: false })
    if (oErr) dbHata('son hareket', oErr)
    for (const o of (olaylar || [])) if (!sonMap.has(o.siparis_id)) sonMap.set(o.siparis_id, o.olusma_zamani)
  }
  // Kapak fotoğrafı — Göksenil: "ilk kolonda araç kapak fotoğrafı olsun."
  // ⚠️ ÖNCEKİ HALİ YANLIŞTI: kolonda `a.ruhsat_url` gösteriliyordu, yani
  //   RUHSAT TARAMASI. Kapak = arac_fotograflari'nda sira 0 (sql/117).
  //   `created_at` ikincil sıralama eşitlik bozucu — sira berabere kalırsa
  //   kapak rastgele değişiyordu.
  const aracIds = [...new Set(SIP.map(s => s.arac_id).filter(Boolean))]
  KAPAK = new Map()
  if (aracIds.length) {
    const { data: fotolar, error: fErr } = await supabase.from('arac_fotograflari')
      .select('arac_id, dosya_yolu, sira').in('arac_id', aracIds).order('sira').order('created_at')
    if (fErr) dbHata('kapak fotoğrafı', fErr)
    for (const f of (fotolar || [])) if (!KAPAK.has(f.arac_id)) KAPAK.set(f.arac_id, f.dosya_yolu)
  }

  // ---- Sorumlu çipi: teslim defterinin SON satırı (sql/248) ----
  // Gerekçe girilmiş dosyada "kim çözecek" birimini satırda göstermek için
  // siparis_teslim_planlari'nın siparis başına EN BÜYÜK id'li satırı okunur
  // (id bigint, artan → id DESC ile ilk gelen o dosyanın son hareketidir).
  // ⚠️ PostgREST varsayılan 1000 satır limiti sessizce keser (CLAUDE.md §5/3).
  const DEFTER_LIMIT = 2000
  const sorumluMap = new Map()
  if (ids.length) {
    const { data: defter, error: dErr } = await supabase.from('siparis_teslim_planlari')
      .select('id, siparis_id, beyan_edilen_sorumlu')
      .in('siparis_id', ids).order('id', { ascending: false }).limit(DEFTER_LIMIT)
    if (dErr) dbHata('teslim planı defteri', dErr)
    if ((defter || []).length >= DEFTER_LIMIT) console.warn('[teslim] siparis_teslim_planlari ' + defter.length + ' satır döndü — limite dayandı, sayfalama gerekli')
    for (const d of (defter || [])) if (!sorumluMap.has(d.siparis_id)) sorumluMap.set(d.siparis_id, d.beyan_edilen_sorumlu || null)
  }

  for (const s of SIP) {
    s._bakiye = bakMap.has(s.id) ? bakMap.get(s.id) : null
    // Son defter satırında beyan yoksa (ör. ilk plan / öne alma) çip basılmaz.
    s._sorumlu = sorumluMap.get(s.id) || null
    s._sonHareket = sonMap.get(s.id) || s.created_at
    s._plan = PLAN.get(s.id) || null
    s._sinif = s._plan?.sinif || null
    // Planı olmayan satır (ör. iptal edilmiş dosya view'da yok) en dibe:
    // 9 > sunucudaki en büyük sira_anahtari (7 = muaf).
    s._sira = s._plan?.sira_anahtari != null ? Number(s._plan.sira_anahtari) : 9
    s._gecikme = Number(s._plan?.gecikme_gun) || 0
  }
  // Sıra: sunucunun sira_anahtari ARTAN -> en çok geciken üstte -> en yeni üstte.
  // ⚠️ Sınıflandırma burada YOK, yalnız sunucudan gelen anahtarla sıralama var.
  SIP.sort((a, b) => (a._sira - b._sira) || (b._gecikme - a._gecikme) ||
    (new Date(b.created_at) - new Date(a.created_at)))
  ciz()
}

const kapakUrl = yol => supabase.storage.from('arac-foto').getPublicUrl(yol).data.publicUrl

// ---------- Türetimler ----------
function aracBaslik(a) { return a ? ([a.yil, a.marka, a.model].filter(Boolean).join(' ') || 'Araç —') : 'Araç —' }
// İnsan okunur sipariş numarası (sql/133) — evraktaki SIP-000412 ile aynı.
function siparisNo(s) { return s.sira != null ? 'SIP-' + String(s.sira).padStart(6, '0') : '#SP-' + String(s.id).slice(0, 6).toUpperCase() }
function acikMi(s) { return s.durum === 'ACIK' }
function satildiMi(s) { return !!s.satis_tarihi }

// Aşama çipi (siparişin yaşam döngüsü)
function asamaCip(s) {
  if (s.durum === 'IPTAL') return cip('İptal', 'bg-surface-container-high text-on-surface-variant', 'bg-on-surface-variant')
  if (s.durum === 'TESLIM_EDILDI') return cip('Teslim Edildi', 'bg-blue-100 text-blue-800', 'bg-blue-600')
  if (satildiMi(s)) return cip('Satıldı', 'bg-secondary-container text-on-secondary-container', 'bg-secondary')
  if (s.teslimat_durumu) return cip('Teslim Onay', 'bg-amber-100 text-amber-800', 'bg-amber-500')
  return cip('Sipariş', 'bg-orange-100 text-orange-800', 'bg-orange-500')
}

// Durum = SAĞLIK kolonu (Göksenil onaylı kurallar). Dosya açılmadan problemi gösterir.
function saglik(s) {
  // ⚠️ BAKİYE İŞARETİ: borç NEGATİF, fazla tahsilat POZİTİF (sql/65).
  //    Eskiden yalnız sifirMi()'ye bakılıyordu; +10.000 ₺ FAZLA tahsilatı
  //    olan dosya "Tahsilat Eksik" görünüyordu — müşteri fazla ödemişken.
  //    Canlı örnekler: 35NSD813 +10.000 (açık), 35CMF667 +500.000 (iptal).
  const fazla = s._bakiye != null && s._bakiye > 0.005
  // İptal edilmiş siparişte fazla tahsilat = İADE BORCU: borç satırı
  // düşmüş, tahsilat duruyor. Listede görünmezse kimse fark etmez.
  if (s.durum === 'IPTAL') return fazla
    ? cip('İptal · İade Bekliyor', 'bg-error-container text-on-error-container', 'bg-error')
    : cip('İptal', 'bg-surface-container-high text-on-surface-variant', 'bg-on-surface-variant')
  if (s.durum === 'TESLIM_EDILDI') return cip('Tamamlandı', 'bg-secondary-container text-on-secondary-container', 'bg-secondary')
  if (s.teslimat_durumu === 'IADE') return cip('Finans İade — Kritik', 'bg-error-container text-on-error-container', 'bg-error')
  if (s.teslimat_durumu === 'ONAY_BEKLIYOR') return cip('Finans Kontrolünde', 'bg-surface-container-high text-on-surface-variant', 'bg-on-surface-variant')
  if (s.teslimat_durumu === 'ONAYLANDI') return cip('Teslim Hazır', 'bg-blue-100 text-blue-800', 'bg-blue-600')
  // ⚠️ Etiket KISALTILDI (19 Ağu 2026): "Mali durum yöneticide" 13 px'te
  //    çipi 175 px yapıyordu, kolon 150 px — masaüstünde de 5 px taşıyordu
  //    (mobil düzenlemesinden ÖNCE de vardı, ölçümle görüldü). Anlam aynı:
  //    bakiyeyi bu kullanıcı göremiyor.
  if (s._bakiye == null) return cip('Mali durum gizli', 'bg-surface-container-high text-on-surface-variant', 'bg-outline')
  if (fazla) return cip('Fazla Tahsilat', 'bg-amber-100 text-amber-800', 'bg-amber-500')
  if (s._bakiye < -0.005) return cip('Tahsilat Eksik', 'bg-orange-100 text-orange-800', 'bg-orange-500')
  return cip('Hazır', 'bg-secondary-container text-on-secondary-container', 'bg-secondary')
}

// ⚠️ `whitespace-nowrap` çip için DOĞRU (etiket ortadan bölünmesin) ama
//    mobilde 126 px'lik kolona sığması gerekiyor: dolgu ve tipografi dar
//    ekranda küçültülüyor, `max-w-full` + `truncate` ise sığmayanı komşu
//    hücreye taşırmak yerine üç noktayla kesiyor.
//    Ölçüm: "Mali durum yöneticide" 13 px'te 168 px, 11 px'te 132 px.
// ⚠️ `min-w-0` İKİ YERDE de şart — provada ölçülerek bulundu:
//    · DIŞ çip: kendisi de bir flex öğesi. `min-width:auto` = min-content
//      (nowrap metnin tam genişliği, 142 px) ve CSS'te **min-width
//      max-width'i EZER** — `max-w-full` hiç devreye girmiyordu.
//    · İÇ span: `truncate` ancak `min-width:0` ile küçülebilir.
//    Biri eksik olursa çip hücreden taşıyor ve komşuya biniyor.
function cip(metin, cls, dot) {
  return `<span class="inline-flex items-center px-2 sm:px-3 py-1 rounded-full ${cls} text-[11px] sm:text-label-sm font-bold whitespace-nowrap max-w-full min-w-0"><span class="w-1.5 h-1.5 rounded-full ${dot} mr-1.5 sm:mr-2 shrink-0"></span><span class="truncate min-w-0">${kacis(metin)}</span></span>`
}

// Tahsilat ilerlemesi (v_siparis_bakiye + anlaşılan) → {yuzde, kalan, fazla, fazlaVar, odenen, gizli}
//
// ⚠️ Göksenil (3 Ağu 2026, v240'ı görünce): "sipariş merkezinde de %100
//    tamamlandı yazıyor, burası da hatalı." Haklıydı — sağlık çipi v239'da
//    "Fazla Tahsilat" demeye başlamıştı ama yüzde/bar/bakiye hücresi hâlâ
//    "%100 · Tamamlandı" diyordu. `kalan = max(0, −bakiye)` fazlayı sıfıra
//    kırpınca odenen = toplam çıkıyor, yüzde 100 oluyordu. Aynı olguya tek
//    cevap: fazla varsa yüzde GÖSTERİLMEZ, yerine fazla tutarı yazılır.
function tahsilat(s) {
  const toplam = Number(s.anlasilan_tutar) || 0
  if (s._bakiye == null) return { gizli: true }
  // kalan = ödenmesi gereken (borç), fazla = iade/mahsup edilmesi gereken.
  // İkisi AYRI tutulur; eskiden fazla, Math.max(0, …) ile sıfıra kırpılıp
  // görünmez oluyordu.
  const kalan = Math.max(0, -s._bakiye)
  const fazla = Math.max(0, s._bakiye)
  const fazlaVar = fazla > 0.005
  const odenen = toplam > 0 ? Math.max(0, toplam - kalan) : 0
  const yuzde = toplam > 0 ? Math.min(100, Math.round(100 * odenen / toplam)) : (kalan === 0 ? 100 : 0)
  return { yuzde, kalan, fazla, fazlaVar, odenen, toplam, gizli: false }
}

function sonHareketMetni(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso)
  const gun = Math.floor(ms / 86400000)
  if (bugunMu(iso)) return `Bugün · ${new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
  if (gun === 1) return 'Dün'
  if (gun < 7) return `${gun} gün önce`
  return fmtTarih(iso).split(' ')[0]
}

// ---------- Filtreleme ----------
function filtreli() {
  const q = trBuyuk(filtre.arama).trim(), rakam = filtre.arama.replace(/\D/g, '')
  return SIP.filter(s => {
    // ⚠️ İPTAL EDİLEN SİPARİŞ VARSAYILAN LİSTEDE GÖRÜNMEZ (Göksenil,
    //   7 Ağu 2026: "sipariş iptal ettim ama araç hâlâ sipariş merkezinde
    //   duruyor, durmamalı"). İptal = artık iş değil; listede durunca
    //   "bu araç hâlâ siparişte" izlenimi veriyor ve araç iki yerde birden
    //   görünüyordu (hem stokta hem siparişte).
    //   SİLMİYORUZ, GİZLİYORUZ: "İptal" süzgecine basınca hepsi gelir —
    //   iptal geçmişi denetim için gerekli.
    if (s.durum === 'IPTAL' && filtre.durum !== 'IPTAL') return false
    // Teslim planı sınıfı süzgeci (plansız şeridindeki "Bu grubu göster").
    if (filtre.sinif && s._sinif !== filtre.sinif) return false
    if (filtre.danisman && s.danisman_id !== filtre.danisman) return false
    if (filtre.durum) {
      const d = filtre.durum
      if (d === 'SIPARIS' && (s.teslimat_durumu || satildiMi(s) || s.durum !== 'ACIK')) return false
      if (d === 'TESLIM_ONAY' && !s.teslimat_durumu) return false
      if (d === 'SATILDI' && !satildiMi(s)) return false
      if (d === 'IPTAL' && s.durum !== 'IPTAL') return false
    }
    if (!q) return true
    const a = one(s.stok_araclar), m = one(s.musteriler)
    return trBuyuk(aracBaslik(a)).includes(q) || trBuyuk(a?.plaka).includes(q) ||
      trBuyuk(m?.ad_soyad).includes(q) || (rakam && (a?.plaka || '').replace(/\D/g, '').includes(rakam)) ||
      siparisNo(s).includes(q) || (rakam && String(s.sira || '').includes(rakam))
  })
}

// ---------- KPI ----------
// ⚠️ İPTAL EDİLEN SİPARİŞ HİÇBİR SAYAÇTA YOK (Göksenil, 7 Ağu 2026:
//    "sayaçta düşsün"). Liste iptalleri gizlerken sayaç onları saymaya
//    devam ediyordu: ekranda "1 sipariş gösteriliyor (toplam 4)" ve
//    "Toplam Sipariş 4" çıkıyordu — kullanıcı üç siparişin nerede
//    olduğunu arıyordu. İptal = iş değil; ne listede ne sayaçta.
//    İptal geçmişi silinmedi, "İptal" süzgecinden görülür.
const iptalHaric = () => SIP.filter(s => s.durum !== 'IPTAL')

function kpiHesap() {
  const gecerli = iptalHaric()      // tüm sayaçlar bu küme üzerinde
  const acik = gecerli.filter(acikMi)
  const eksikTahsilat = acik.reduce((a, s) => a + (typeof s._bakiye === 'number' && s._bakiye < -0.005 ? -s._bakiye : 0), 0)
  // ⚠️ "Bugün Teslim" v_teslim_plani'dan okunur, ana listeden DEĞİL: liste
  //    teslim edilenleri hiç yüklemiyor, oradan sayılsa "tamam" daima 0 çıkardı.
  // ⚠️ KPI ile TABLO BAŞLIĞI AYNI KÜMEYİ SAYAR. "BUGÜN TESLİM" grup başlığı
  //    veri.js TESLIM_SINIF'taki `grup` alanından geliyor ve orada BUGUN ile
  //    TOLERANS ("Dün olmadı") AYNI gruba düşüyor. Sayaç yalnız BUGUN sayınca
  //    kullanıcı başlıkta 5, kartta 3 okuyordu. Küme tek yerden türetilir:
  const bugunGrubu = ['BUGUN', 'TOLERANS']
  const planlar = [...PLAN.values()]
  const bugunTeslim = {
    planli: planlar.filter(p => bugunGrubu.includes(p.sinif)).length + BUGUN_TAMAM,
    tamam: BUGUN_TAMAM,
    geciken: planlar.filter(p => p.sinif === 'GECIKEN' || p.sinif === 'GECIKEN_CEVAPLI').length,
  }
  return {
    toplam: gecerli.length,
    bugun: gecerli.filter(s => bugunMu(s.created_at)).length,
    onayBekleyen: gecerli.filter(s => s.teslimat_durumu === 'ONAY_BEKLIYOR').length,
    eksikTahsilat,
    bugunTeslim,
    bugunNoter: gecerli.filter(s => bugunMu(s.satis_tarihi)).length,
    // ⚠️ "Tamamlanan Satış" kartı KALDIRILDI: teslim edilen siparişler artık
    //    yüklenmediği için o sayaç daima 0 gösterirdi — yanlış bilgi.
    //    Yerine SIRADAKİ İŞ konuldu: finans onayı verilmiş ama henüz teslim
    //    edilmemiş dosyalar. "Teslim Onay Bekleyen" kartıyla birlikte
    //    zincirin iki halkasını gösterir: bekliyor → hazır → (teslim → Satış Merkezi).
    teslimeHazir: gecerli.filter(s => s.durum === 'ACIK' && s.teslimat_durumu === 'ONAYLANDI').length,
  }
}

function kpiKart(ikon, ikonBg, sayi, etiket, alt = '') {
  return `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow hover:shadow-md transition-shadow">
    <div class="flex justify-between items-start mb-3">
      <div class="p-2 rounded-lg ${ikonBg}">${mat(ikon, 'text-[22px]')}</div>
    </div>
    <div class="text-2xl md:text-3xl font-black text-on-surface leading-none mb-1">${sayi}</div>
    <div class="text-label-sm text-on-surface-variant uppercase tracking-wide font-medium">${etiket}</div>
    ${alt ? `<div class="text-[11px] text-on-surface-variant mt-1 leading-tight">${kacis(alt)}</div>` : ''}
  </div>`
}

// ---------- Çizim ----------
function ciz() {
  // Plansız dosya kalmadıysa süzgeci ÜZERİNDE BIRAKMA: şerit de kaybolduğu
  // için kullanıcı boş listeye bakıp süzgeci nereden kaldıracağını aramaz.
  if (filtre.sinif === 'PLANSIZ' && !SIP.some(s => s.durum !== 'IPTAL' && s._sinif === 'PLANSIZ')) filtre.sinif = ''
  const k = kpiHesap()
  const list = filtreli()

  // ⚠️ KART SAYISI ROLE GÖRE DEĞİŞİR (Göksenil kararı): "Eksik Tahsilat"
  //    danışmana GÖSTERİLMEZ — mali toplam onun işi değil, satırda zaten
  //    "Mali durum gizli" çipini görüyor. Satış müdürü / finans müdürü /
  //    master görmeye devam eder: müdür 7 kart, danışman 6 kart.
  const maliGorur = satisMuduruMu(BEN) || mudurMu(BEN, 'finans')
  const kartlar = [
    kpiKart('fact_check', 'bg-primary-fixed text-primary', k.toplam, 'Toplam Sipariş'),
    kpiKart('today', 'bg-blue-100 text-blue-700', k.bugun, 'Bugün Açılan'),
    kpiKart('local_shipping', 'bg-blue-100 text-blue-700', k.bugunTeslim.planli, 'Bugün Teslim',
      `${k.bugunTeslim.planli} planlı · ${k.bugunTeslim.tamam} tamam · ${k.bugunTeslim.geciken} geciken`),
    kpiKart('verified', 'bg-amber-100 text-amber-700', k.onayBekleyen, 'Teslim Onay Bekleyen'),
    maliGorur ? kpiKart('payments', 'bg-error-container text-on-error-container', fmtPara(k.eksikTahsilat), 'Eksik Tahsilat') : '',
    kpiKart('gavel', 'bg-surface-container-high text-on-surface', k.bugunNoter, 'Bugünkü Noter'),
    kpiKart('done_all', 'bg-secondary-container text-on-secondary-container', k.teslimeHazir, 'Teslime Hazır'),
  ].filter(Boolean)
  const kpiHtml = `<div class="grid grid-cols-2 md:grid-cols-3 ${kartlar.length === 7 ? 'xl:grid-cols-7' : 'xl:grid-cols-6'} gap-3 md:gap-4">${kartlar.join('')}</div>`

  const danOpts = [...new Set(SIP.map(s => s.danisman_id).filter(Boolean))]
    .map(id => `<option value="${id}" ${filtre.danisman === id ? 'selected' : ''}>${kacis(danismanAdi(DMAP, id))}</option>`).join('')
  // "Teslim Edildi" seçeneği KALDIRILDI — o satırlar artık hiç yüklenmiyor,
  // seçenek dursa boş liste döndürüp "kayıt kayboldu" izlenimi verirdi.
  const durumOpts = [['', 'Tüm Durumlar'], ['SIPARIS', 'Sipariş'], ['TESLIM_ONAY', 'Teslim Onay'], ['SATILDI', 'Satıldı'], ['IPTAL', 'İptal']]
    .map(([v, l]) => `<option value="${v}" ${filtre.durum === v ? 'selected' : ''}>${l}</option>`).join('')

  const filtreHtml = `<div class="bg-surface-container-lowest p-3 rounded-2xl border border-outline-variant custom-shadow flex flex-wrap items-center gap-3">
    <div class="flex-1 min-w-[220px] relative">
      ${mat('search', 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]')}
      <input id="spArama" type="search" value="${kacis(filtre.arama)}" placeholder="Dosya no, plaka, şasi veya müşteri…" class="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border-none rounded-xl text-body-sm focus:ring-2 focus:ring-primary/20 outline-none" />
    </div>
    <select id="spDanisman" class="bg-surface-container-low border-none rounded-xl px-4 py-2.5 text-body-sm font-semibold focus:ring-2 focus:ring-primary/20"><option value="">Danışman Seçiniz</option>${danOpts}</select>
    <select id="spDurum" class="bg-surface-container-low border-none rounded-xl px-4 py-2.5 text-body-sm font-semibold focus:ring-2 focus:ring-primary/20">${durumOpts}</select>
    ${(filtre.arama || filtre.danisman || filtre.durum || filtre.sinif) ? `<button id="spTemizle" class="text-error text-label-md font-bold px-3 py-2 hover:bg-error/5 rounded-lg">Filtreyi Temizle</button>` : ''}
    <div class="h-8 w-px bg-outline-variant mx-1"></div>
    <button id="spExcel" title="Excel (CSV) indir" class="p-2.5 text-on-surface-variant hover:bg-surface-container-high rounded-xl">${mat('file_download')}</button>
    <button id="spYazdir" title="Yazdır" class="p-2.5 text-on-surface-variant hover:bg-surface-container-high rounded-xl">${mat('print')}</button>
    <button id="spYenile" title="Yenile" class="p-2.5 text-primary hover:bg-primary/10 rounded-xl">${mat('refresh')}</button>
  </div>`

  const govde = list.length
    ? tabloGovde(list)
    : `<tr><td colspan="9" class="py-16 text-center text-on-surface-variant"><div class="flex flex-col items-center gap-2">${mat('inbox', 'text-4xl opacity-30')}<span>${SIP.length ? 'Filtreye uyan sipariş yok.' : 'Henüz siparişe alınmış araç yok. Stoktan sipariş oluştur.'}</span></div></td></tr>`

  // Göksenil, 3 Ağu 2026: "listede dosya id'i gizle · ilk kolonda araç kapak
  //   fotoğrafı olsun · burada sağ tarafa doğru bir taşma var onu istemiyorum"
  // ⚠️ TAŞMANIN SEBEBİ min-w-[980px] idi: tablo dar ekranda bile 980px'e
  //   zorlanıyor, sayfa yatay kayıyordu. Kaldırıldı; onun yerine ikincil
  //   kolonlar ekran daraldıkça gizleniyor (bilgi drawer'da zaten var).
  // ⚠️ MOBİL ÖLÇÜMÜ (19 Ağu 2026, 358 px kap): sabit kolonlar 72+150+130 =
  //   352 px yiyor, geriye kalan 6 px Araç ve Müşteri arasında bölüşülüyordu
  //   — her birine 3 px. `table-fixed` olduğu için kolonlar küçülmüyor,
  //   içerik üst üste biniyordu ("üstüste binmiş görünüyor").
  //   İlk denemede kolonları daraltmak YETMEDİ (2. tur, kullanıcı ekran
  //   görüntüsü): 375 px'te Araç ~140 + çipler ~90 + bakiye ~90 + dolgular
  //   = 413 px isteniyor, kap 343 px. Üç kolon o genişliğe SIĞMIYOR.
  //   Çözüm: dar ekranda foto ve Müşteri kolonları kapanıyor (Araç
  //   hücresine iniyor) ve BAKİYE, Durum kolonunun ALTINA iniyor —
  //   satır yükseliyor, yan yana sıkışma bitiyor (Göksenil önerisi).
  //   Kalan iki kolon: Durum/Bakiye 126 px · Araç ~217 px.
  const tabloHtml = `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-x-auto sm:overflow-hidden">
    <table class="w-full text-left border-collapse table-fixed">
      <thead><tr class="bg-surface-container-low/60 border-b border-outline-variant text-label-sm text-on-surface-variant uppercase tracking-wide">
        <th class="p-3 font-bold hidden sm:table-cell sm:w-[72px]"></th>
        <th class="p-3 font-bold">Araç</th>
        <th class="p-3 font-bold hidden sm:table-cell">Müşteri</th>
        <th class="p-3 font-bold hidden lg:table-cell w-[150px]">Danışman</th>
        ${/* ⚠️ Mobil tablo tuzağı (table-fixed): kolon genişliği <th>'de
              tanımlı; th ve td AYNI kırılımda gizlenmezse yuva kayar ve
              hücreler komşuya biner. İkisi de `hidden xl:table-cell`.
              ⚠️ KIRILIM lg DEĞİL xl — ÖLÇÜLDÜ: yan menü 260 px + sayfa dolgusu
              48 px düşünce lg (1024) kabı 716 px kalıyor, sabit kolonlar ise
              72+150+136+150+130+130 = 768 px istiyor → Araç ve Müşteri'ye
              -52 px kalıyor, tablo kabı taşıyor ve `sm:overflow-hidden`
              sağdan kesiyor. xl (1280) kabında 972 px var, sabitler 872 px →
              artı 100 px. lg altında bilgi kaybolmuyor: Araç hücresindeki
              tek şeride iniyor. */''}
        <th class="p-3 font-bold hidden xl:table-cell w-[130px]">Teslim</th>
        <th class="px-2 py-3 sm:p-3 font-bold w-[126px] sm:w-[150px]">Durum / Bakiye<span class="hidden sm:inline"> </span></th>
        <th class="p-3 font-bold hidden md:table-cell w-[130px]">Tahsilat</th>
        <th class="p-3 font-bold text-right hidden sm:table-cell sm:w-[130px]">Kalan Bakiye</th>
        <th class="p-3 font-bold text-right hidden xl:table-cell w-[110px]">Son Hareket</th>
      </tr></thead>
      <tbody class="divide-y divide-outline-variant/30">${govde}</tbody>
    </table>
    <div class="p-4 flex items-center justify-between bg-surface-container-low/30 text-label-md text-on-surface-variant">
      <span><b class="text-on-surface">${list.length}</b> sipariş gösteriliyor${list.length !== iptalHaric().length ? ` (toplam ${iptalHaric().length})` : ''}</span>
      <span class="hidden sm:inline text-label-sm">Tek tık: hızlı bakış · Çift tık: satış dosyası</span>
    </div>
  </div>`

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 md:mb-6">
      <div><p class="text-label-sm text-on-surface-variant uppercase tracking-wider font-medium mb-0.5">Operasyonel Özet</p>
        <h2 class="text-headline-md text-primary font-black">Sipariş Merkezi</h2></div>
      <button id="spStoktan" class="bg-primary text-on-primary pl-4 pr-5 h-11 flex items-center gap-2 rounded-xl text-label-md font-bold hover:opacity-90 shadow-md hover:shadow-lg transition-all active:scale-95">${mat('add_circle', 'text-[20px]')}<span class="hidden sm:inline">Stoktan Sipariş Oluştur</span></button>
    </div>
    ${kpiHtml}
    <div class="mt-4 md:mt-6 mb-4">${filtreHtml}</div>
    ${plansizSeritHtml()}
    ${tabloHtml}
    ${drawerHtml()}
    ${modalKabuk()}`
  baglaOlaylar()
}

// ---------- Teslim planı (sql/244-245) ----------
// ⚠️ TEK KAYNAK SUNUCU: sınıf (sinif) ve sıra (sira_anahtari) v_teslim_plani'den
//    gelir, burada YALNIZ görsel karşılıkları (veri.js TESLIM_SINIF) uygulanır.
//    Tarih karşılaştırması / "geç mi" hesabı bu dosyada YAPILMAZ.

// Sınıf rozeti: etiket + gecikme varsa "3 gün geç".
function teslimRozet(s) {
  const p = s._plan; if (!p) return ''
  const k = TESLIM_SINIF[p.sinif]; if (!k) return ''
  const gec = Number(p.gecikme_gun) || 0
  const metin = [k.etiket, gec > 0 ? gec + ' gün geç' : ''].filter(Boolean).join(' · ')
  if (!metin) return ''   // ILERI sınıfının etiketi boş — rozet basılmaz, tarih yeter
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full ${k.cip} text-[11px] font-bold whitespace-nowrap max-w-full min-w-0"><span class="truncate min-w-0">${kacis(metin)}</span></span>`
}

// Kaçıncı erteleme — ayrı, küçük rozet. 0 ise hiç basılmaz.
function ertelemeRozet(s) {
  const n = Number(s._plan?.erteleme_sayisi) || 0
  if (n <= 0) return ''
  return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold whitespace-nowrap">${n}. erteleme</span>`
}

// Sorumlu birim çipi — gerekçe girilmiş dosyalarda "kim çözecek" (sql/248).
// ⚠️ Kırmızı "suç" değil "kim çözecek" demek. Etiketler veri.js
//    TESLIM_SORUMLU_ETIKET'ten gelir, burada yeniden yazılmaz.
function sorumluCip(s) {
  const et = TESLIM_SORUMLU_ETIKET[s._sorumlu]; if (!et) return ''
  return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary-fixed text-primary text-[10px] font-bold whitespace-nowrap max-w-full min-w-0"><span class="truncate min-w-0">${kacis(et)}</span></span>`
}

const planTarihi = p => (p?.planlanan ? fmtTarihKisa(p.planlanan) : '—')

// Teslim planı düğmesi — İKİ AYRI UÇ, tek düğmeye bağlanamazlar:
//   · planı OLMAYAN dosya → "Tarih gir"        → teslim_plani_goc()
//   · planı OLAN dosya    → "Tarih / gerekçe"  → teslim_plani_degistir()
// Göç RPC'si "plan varsa" reddeder, değiştir RPC'si de tarihsiz dosyada
// "planlanan teslim tarihi gerekli" der; ayrımı düğme yapar ki kullanıcı
// reddedilen bir pencereyle karşılaşmasın.
// ⚠️ Göç artık müdüre özel DEĞİL: sql/246 dosyanın danışmanına da ileri/bugün
//    tarihli plan girme hakkı verdi (geçmiş tarih hâlâ yalnız satış müdürü).
//    Muaf (ihale) dosyada plan tutulmadığı için düğme hiç basılmaz.
function planBtnHtml(s) {
  const p = s._plan
  if (!p || p.plan_muaf) return ''
  return p.planlanan
    ? `<button type="button" data-plan="${s.id}" class="${PLAN_BTN}">Tarih / gerekçe</button>`
    : `<button type="button" data-goc="${s.id}" class="${PLAN_BTN}">Tarih gir</button>`
}

// Masaüstü "Teslim" kolonu
function teslimHucre(s) {
  if (!s._plan) return `<span class="text-label-sm text-on-surface-variant">—</span>`
  return `<div class="flex flex-col gap-1 items-start min-w-0 max-w-full">
    <span class="text-label-md font-semibold text-on-surface tabular-nums">${kacis(planTarihi(s._plan))}</span>
    ${teslimRozet(s)}${sorumluCip(s)}${ertelemeRozet(s)}${planBtnHtml(s)}
  </div>`
}

// xl altında Araç hücresine inen TEK ŞERİT (kolon orada kapalı — bkz. th yorumu)
function teslimSeritHtml(s) {
  if (!s._plan) return ''
  return `<div class="xl:hidden mt-1 flex flex-wrap items-center gap-1 min-w-0">
    ${mat('event', 'text-[13px] text-on-surface-variant')}
    <span class="text-label-sm text-on-surface-variant tabular-nums">${kacis(planTarihi(s._plan))}</span>
    ${teslimRozet(s)}${sorumluCip(s)}${ertelemeRozet(s)}${planBtnHtml(s)}
  </div>`
}

// Grup başlıklı gövde. Sıra SUNUCUDAN geldiği için aynı gruptaki satırlar
// zaten ardışık; başlık grup değişince bir kez basılır (colspan = kolon sayısı).
function tabloGovde(list) {
  const grubu = s => TESLIM_SINIF[s._sinif]?.grup || null
  const parca = []
  let onceki = null
  for (let i = 0; i < list.length; i++) {
    const g = grubu(list[i])
    if (g && g !== onceki) {
      let n = 0
      for (let j = i; j < list.length && grubu(list[j]) === g; j++) n++
      parca.push(`<tr class="bg-surface-container-low/70"><td colspan="9" class="px-3 py-1.5 text-label-sm font-black uppercase tracking-wide text-on-surface-variant">${kacis(g)} · ${n}</td></tr>`)
    }
    onceki = g
    parca.push(satirHtml(list[i]))
  }
  return parca.join('')
}

// Göç şeridi — planlanan tarihi olmayan açık siparişler.
// Yalnız satış müdürü/master görür: geçmiş tarihli planı SADECE onlar
// yazabiliyor (teslim_plani_goc RPC'si is_master/is_satis_muduru istiyor),
// danışmana gösterilse tıklanamayan bir uyarı olurdu.
function plansizSeritHtml() {
  if (!satisMuduruMu(BEN)) return ''
  const n = iptalHaric().filter(s => s._sinif === 'PLANSIZ').length
  if (!n) return ''
  const suzuk = filtre.sinif === 'PLANSIZ'
  return `<div class="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-[#FFFBEB] px-4 py-3">
    ${mat('event_busy', 'text-amber-800')}
    <span class="flex-1 min-w-[200px] text-body-md font-bold text-amber-900">${n} siparişte planlanan teslim tarihi yok — girin</span>
    <button id="spPlansizSuz" type="button" class="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-label-md font-bold hover:opacity-90">${suzuk ? 'Süzgeci kaldır' : 'Bu grubu göster'}</button>
  </div>`
}

// ---------- Göç penceresi: planlanan teslim tarihini GİR ----------
// ⚠️ Bu kolonlara UPDATE ile DOKUNULAMAZ — trigger reddeder (BR-0142).
//    Plansız dosyaya ilk tarihi yazmanın tek yolu teslim_plani_goc RPC'si;
//    farkı GEÇMİŞ TARİH kabul etmesi (söz geçen hafta verilmiş olabilir).
function gocAc(id) {
  const s = SIP.find(x => x.id === id); if (!s) return
  const a = one(s.stok_araclar)
  // Geçmiş tarihi YALNIZ satış müdürü/master yazabilir (sql/246). Danışmanın
  // takvimi bugünden başlar — sunucu zaten reddediyor, takvim de göstermesin.
  const gecmisSerbest = satisMuduruMu(BEN)
  const kat = document.getElementById('spModalKat')
  kat.classList.remove('hidden')
  kat.innerHTML = `<div class="sp-bg absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
    <div class="relative mx-auto mt-[12vh] w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden">
      <div class="px-6 py-5 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low">
        <div class="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary">${mat('event')}</div>
        <div class="min-w-0"><h2 class="text-lg font-black text-primary">Planlanan Teslim Tarihi</h2>
          <p class="text-xs text-on-surface-variant truncate">${B(aracBaslik(a))} · ${B(a?.plaka) || '—'}</p></div></div>
      <div class="p-6 space-y-3">
        <div id="spgHata" class="hidden bg-error-container text-on-error-container rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Tarih *</label>
          <input id="spgTarih" type="date" value="${kacis(bugunISO())}" ${gecmisSerbest ? '' : `min="${kacis(bugunISO())}"`} class="${INP} mt-1" />
          <p class="text-[11px] text-on-surface-variant mt-1">${gecmisSerbest
            ? 'Müşteriye verilmiş söz geçmişteyse geçmiş tarihi yazın — gerçeği yazmak raporu düzeltir.'
            : 'Söz geçmiş bir güne verildiyse satış müdürüne bildirin: geçmiş tarihli planı yalnız o kaydedebilir.'}</p></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Plan Tipi *</label>
          <select id="spgTip" class="${INP} mt-1">
            <option value="TAHMIN" selected>Henüz netleşmedi (tahmin)</option>
            <option value="SOZ">Müşteriye söz verildi</option>
          </select></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Not</label>
          <textarea id="spgNot" rows="2" placeholder="Tarih nereden biliniyor? (görüşme, WhatsApp…)" class="${INP} mt-1 resize-none"></textarea></div>
      </div>
      <div class="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex justify-end gap-3">
        <button class="sp-kapat px-5 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-white">Vazgeç</button>
        <button id="spgKaydet" class="px-6 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-bold hover:opacity-90">Kaydet</button></div>
    </div>`
  kat.querySelector('.sp-bg').addEventListener('click', modalKapat)
  kat.querySelectorAll('.sp-kapat').forEach(b => b.addEventListener('click', modalKapat))
  document.getElementById('spgKaydet').addEventListener('click', () => gocKaydet(s))
}

async function gocKaydet(s) {
  const hata = msg => { const h = document.getElementById('spgHata'); h.textContent = msg; h.classList.remove('hidden') }
  document.getElementById('spgHata').classList.add('hidden')
  const tarih = document.getElementById('spgTarih').value
  const tip = document.getElementById('spgTip').value
  const not = document.getElementById('spgNot').value.trim() || null
  if (!tarih) return hata('Tarih zorunlu.')
  const btn = document.getElementById('spgKaydet'); btn.disabled = true; btn.textContent = 'Kaydediliyor…'
  const { data, error } = await supabase.rpc('teslim_plani_goc', { p_siparis: s.id, p_tarih: tarih, p_tip: tip, p_not: not })
  // ⚠️ Ham Postgres metni basılmaz — yetki / geçmiş tarih / plan zaten var
  //    aynı gri satır olarak çıkıyor, kullanıcı ne yapacağını bilmiyordu.
  if (error) { dbHata('teslim planı göç', error); btn.disabled = false; btn.textContent = 'Kaydet'; return hata(planHataMetni(error)) }
  if (!data?.ok) { console.error('teslim_plani_goc beklenmeyen yanıt', data); btn.disabled = false; btn.textContent = 'Kaydet'; return hata('Kaydedilemedi — sunucu onay vermedi.') }
  modalKapat()
  // ⚠️ Sonuç mesajı toast() ile: #icerik yeniden çizilince içine yazılan
  //    uyarı silinir ve işlem "sessizce başarısız" görünür.
  toast('Planlanan teslim tarihi kaydedildi.')
  await yukle()
}

// ---------- Tarih / gerekçe penceresi: planı OLAN dosya ----------
// ⚠️ Planlanan tarihe UPDATE ile DOKUNULAMAZ (BR-0142). Tek kapı
//    teslim_plani_degistir() RPC'si; hangi işlem olduğunu (GEREKCE / ERTELEME /
//    ERKEN / DUZELTME) SUNUCU karar verir. Bu kuralları burada TEKRARLAMA —
//    pencere yalnız girdi toplar ve dönen `tur`u Türkçeye çevirir.
// ⚠️ Tarih BOŞ bırakılabilir: "tarih değişmiyor, yalnız gerekçe veriyorum"
//    demektir (sunucu tur=GEREKCE üretir ve gerekçeyi zorunlu tutar).
// FAZ 2 — Danışmana BOŞ "neden gecikti?" kutusu SORULMAZ: pencere açılırken
//    gecikme_nedeni_turet() çağrılır, sistemin teşhisi en üstte şerit olarak
//    gösterilir, danışman tek tıkla DOĞRULAR (p_kaynak='OTOMATIK'). Yazı
//    yazmak yalnız sebep sistem dışıysa gerekir ("Başka sebep seç" →
//    p_kaynak='DANISMAN'). Şerit basılamazsa pencere Faz 1'deki gibi çalışır.
function planAc(id) {
  const s = SIP.find(x => x.id === id); if (!s) return
  const p = s._plan; if (!p) return
  const a = one(s.stok_araclar)
  // Gerekçe SORUMLU BİRİMİYLE gösterilir ("Kredi parası gelmedi — Kredi"):
  // kırmızı "suç" değil "kim çözecek" demek (veri.js TESLIM_SORUMLU_ETIKET).
  const nedenOpts = GECIKME_NEDENLERI.map(n => {
    const sor = TESLIM_SORUMLU_ETIKET[n.ozellikler?.sorumlu] || ''
    return `<option value="${kacis(n.kod)}">${kacis(n.ad)}${sor ? ' — ' + kacis(sor) : ''}</option>`
  }).join('')
  const kat = document.getElementById('spModalKat')
  kat.classList.remove('hidden')
  kat.innerHTML = `<div class="sp-bg absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
    <div class="relative mx-auto mt-[10vh] w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden">
      <div class="px-6 py-5 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low">
        <div class="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary">${mat('edit_calendar')}</div>
        <div class="min-w-0"><h2 class="text-lg font-black text-primary">Teslim Tarihi / Gerekçe</h2>
          <p class="text-xs text-on-surface-variant truncate">${B(aracBaslik(a))} · ${B(a?.plaka) || '—'}</p></div></div>
      <div class="p-6 space-y-3">
        <div id="sptHata" class="hidden bg-error-container text-on-error-container rounded-lg px-3 py-2 text-sm"></div>
        <div class="rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-bold text-on-surface-variant uppercase">Mevcut Plan</span>
            <span class="text-label-md font-black text-on-surface tabular-nums">${kacis(planTarihi(p))}</span>
          </div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1">
            ${teslimRozet(s)}${ertelemeRozet(s)}
            <span class="text-[11px] text-on-surface-variant">${p.plan_tipi === 'TAHMIN' ? 'Tahmin (gecikme sayacı işlemez)' : 'Müşteriye söz verildi'}</span>
          </div>
        </div>
        <div id="sptTeshis" data-sip="${kacis(s.id)}"></div>
        <div id="sptElle" class="space-y-3">
          <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Yeni Teslim Tarihi</label>
            <input id="sptTarih" type="date" min="${kacis(bugunISO())}" class="${INP} mt-1" />
            <p class="text-[11px] text-on-surface-variant mt-1">Boş bırakırsanız tarih değişmez, yalnız gerekçe kaydedilir. Geçmiş bir gün seçilemez (BR-0141).</p></div>
          <div><div class="flex items-center gap-2 flex-wrap">
              <label class="text-[11px] font-bold text-on-surface-variant uppercase">Gerekçe</label>
              <span id="sptOneriRozet" class="hidden inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary-fixed text-primary text-[10px] font-bold whitespace-nowrap">sistem önerisi</span></div>
            <select id="sptNeden" class="${INP} mt-1"><option value="">Seçiniz…</option>${nedenOpts}</select>
            <p class="text-[11px] text-on-surface-variant mt-1">Tarih ileri alınıyorsa ya da hiç değişmiyorsa gerekçe zorunludur. Öne alırken istenmez.</p>
            <div id="sptCeliski" class="hidden mt-2 rounded-lg border border-amber-300 bg-[#FFFBEB] px-3 py-2 text-[11px] font-semibold text-amber-900"></div></div>
          <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Açıklama</label>
            <textarea id="sptNot" rows="2" placeholder="Ne oldu, ne zaman çözülür?" class="${INP} mt-1 resize-none"></textarea></div>
        </div>
      </div>
      <div class="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex justify-end gap-3">
        <button class="sp-kapat px-5 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-white">Vazgeç</button>
        <button id="sptKaydet" class="px-6 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-bold hover:opacity-90">Kaydet</button></div>
    </div>`
  kat.querySelector('.sp-bg').addEventListener('click', modalKapat)
  kat.querySelectorAll('.sp-kapat').forEach(b => b.addEventListener('click', modalKapat))
  document.getElementById('sptKaydet').addEventListener('click', () => planKaydet(s))
  // Gerekçe değişince: "sistem önerisi" rozeti ve çelişki uyarısı tazelenir.
  document.getElementById('sptNeden').addEventListener('change', celiskiTazele)
  // Teşhis ASENKRON gelir — pencere anında açılır, şerit hazır olunca yerleşir.
  teshisYukle(s)
}

// ---------- Sistem teşhisi (FAZ 2) ----------
// gecikme_nedeni_turet() HİÇBİR ŞEY YAZMAZ, yalnız önerir. Hata / boş yanıt
// halinde şerit basılmaz ve pencere Faz 1'deki hâliyle çalışmaya devam eder —
// yeni özellik eski akışı BOZMAZ.
async function teshisYukle(s) {
  sptTeshis = null
  const { data, error } = await supabase.rpc('gecikme_nedeni_turet', { p_siparis: s.id })
  if (error) { dbHata('gecikme nedeni türet', error); return }
  if (!data || data.bulunamadi || !data.neden_kod) { console.warn('[teslim] sistem teşhisi boş döndü', data); return }
  // Yanıt gelene kadar pencere kapanmış ya da BAŞKA dosya açılmış olabilir:
  // şeridi yanlış dosyaya yapıştırmamak için kabın data-sip'i doğrulanır.
  const kap = document.getElementById('sptTeshis')
  if (!kap || kap.dataset.sip !== s.id) return
  sptTeshis = data

  const n = GECIKME_NEDENLERI.find(x => x.kod === data.neden_kod)
  const sorumlu = TESLIM_SORUMLU_ETIKET[data.sorumlu] || ''
  const bilinen = !!n     // gerekçe listesinde karşılığı yoksa tek tık kaydedilemez
  kap.innerHTML = `<div class="rounded-xl border border-primary/40 bg-primary-fixed/60 px-3 py-2.5">
      <div class="flex items-start gap-2">
        <span class="shrink-0 text-primary">${mat('troubleshoot')}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-black text-primary uppercase tracking-wider">Sistem teşhisi</p>
          <p class="text-body-md font-bold text-on-surface leading-snug">${kacis(data.aciklama || n?.ad || '—')}</p>
          <p class="text-[11px] text-on-surface-variant mt-0.5">${kacis(n?.ad || data.neden_kod)}${sorumlu ? ' — ' + kacis(sorumlu) : ''}</p>
        </div>
      </div>
      <div class="mt-2.5 flex flex-wrap gap-2">
        ${bilinen ? `<button id="sptOnayla" type="button" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-[13px] font-bold hover:opacity-90">Doğru, kaydet</button>` : ''}
        <button id="sptBaska" type="button" class="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-[13px] font-bold hover:opacity-90">Başka sebep seç</button>
      </div>
      ${bilinen ? '' : `<p class="mt-2 text-[11px] font-semibold text-amber-900">Bu teşhisin gerekçe listesinde karşılığı yok — aşağıdan elle seçin.</p>`}
    </div>`

  // Önerilen kod gerekçe seçicide BAŞTAN SEÇİLİ gelir + "sistem önerisi" rozeti.
  const sec = document.getElementById('sptNeden')
  if (sec && bilinen) { sec.value = data.neden_kod; celiskiTazele() }
  // Teşhis varken elle giriş bloğu kapalı durur: danışmandan yazı istemiyoruz.
  if (bilinen) elleGoster(false)
  document.getElementById('sptOnayla')?.addEventListener('click', () => teshisOnayla(s))
  document.getElementById('sptBaska')?.addEventListener('click', () => elleGoster(true))
}

// Elle giriş bloğu (tarih / gerekçe / açıklama) ve alt "Kaydet" düğmesi
// birlikte açılır kapanır — biri görünüp öteki gizli kalırsa pencere
// "kaydedilemiyor" görünür.
function elleGoster(ac) {
  document.getElementById('sptElle')?.classList.toggle('hidden', !ac)
  document.getElementById('sptKaydet')?.classList.toggle('hidden', !ac)
}

// Çelişki rozeti: danışman sistemin teşhisinden FARKLI bir sorumluya işaret
// eden gerekçe seçerse görünürlük sağlanır. ⚠️ ENGELLEME YOK — kayıt yine geçer.
function celiskiTazele() {
  const kutu = document.getElementById('sptCeliski'), rozet = document.getElementById('sptOneriRozet')
  const sec = document.getElementById('sptNeden'); if (!kutu || !sec) return
  const secili = sec.value || ''
  rozet?.classList.toggle('hidden', !(sptTeshis && secili && secili === sptTeshis.neden_kod))
  if (!sptTeshis || !secili || secili === sptTeshis.neden_kod) { kutu.classList.add('hidden'); kutu.textContent = ''; return }
  const secN = GECIKME_NEDENLERI.find(x => x.kod === secili)
  if ((secN?.ozellikler?.sorumlu || '') === (sptTeshis.sorumlu || '')) { kutu.classList.add('hidden'); kutu.textContent = ''; return }
  const oneriN = GECIKME_NEDENLERI.find(x => x.kod === sptTeshis.neden_kod)
  const sor = TESLIM_SORUMLU_ETIKET[sptTeshis.sorumlu] || ''
  kutu.innerHTML = `Sistem teşhisi: ${kacis(oneriN?.ad || sptTeshis.neden_kod)}${sor ? ' (' + kacis(sor) + ')' : ''}. Yine de kaydedilecek.`
  kutu.classList.remove('hidden')
}

// "Doğru, kaydet" — sistemin teşhisi AYNEN onaylanır (p_kaynak='OTOMATIK').
// Tarih değişmediği için p_yeni_tarih null gider; sunucu tur=GEREKCE üretir.
async function teshisOnayla(s) {
  const t = sptTeshis; if (!t) return
  const hata = msg => { const h = document.getElementById('sptHata'); if (h) { h.textContent = msg; h.classList.remove('hidden') } }
  document.getElementById('sptHata')?.classList.add('hidden')
  // Açıklaması zorunlu bir gerekçe tek tıkla kaydedilemez — sunucu reddeder.
  // Kullanıcıyı hataya çarptırmak yerine elle bloğu açıp yazdırıyoruz.
  const n = GECIKME_NEDENLERI.find(x => x.kod === t.neden_kod)
  if (n && String(n.ozellikler?.not_zorunlu) === 'true') {
    elleGoster(true)
    return hata('Bu gerekçe için açıklama zorunlu — aşağıya yazıp Kaydet deyin.')
  }
  const btn = document.getElementById('sptOnayla'); if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…' }
  const geri = () => { if (btn) { btn.disabled = false; btn.textContent = 'Doğru, kaydet' } }
  const { data, error } = await supabase.rpc('teslim_plani_degistir', {
    p_siparis: s.id, p_yeni_tarih: null, p_neden_kod: t.neden_kod, p_not: null,
    p_plan_tipi: null, p_kaynak: 'OTOMATIK',
  })
  if (error) { dbHata('teslim planı değiştir (otomatik)', error); geri(); elleGoster(true); return hata(planHataMetni(error)) }
  if (!data?.ok) { console.error('teslim_plani_degistir beklenmeyen yanıt', data); geri(); return hata('Kaydedilemedi — sunucu onay vermedi.') }
  modalKapat()
  // ⚠️ Sonuç mesajı toast() ile — #icerik yeniden çizilince içine yazılan silinir.
  toast(planSonucMetni(data))
  await yukle()
}

async function planKaydet(s) {
  const hata = msg => { const h = document.getElementById('sptHata'); h.textContent = msg; h.classList.remove('hidden') }
  document.getElementById('sptHata').classList.add('hidden')
  const tarih = document.getElementById('sptTarih').value || null
  const neden = document.getElementById('sptNeden').value || null
  const not = document.getElementById('sptNot').value.trim() || null
  // İstemcide YALNIZ iki bariz kontrol: hangi işlem olduğuna sunucu karar verir,
  // burada o sınıflandırma tekrarlanmaz (iki yerde yaşayan kural sessizce eskir).
  if (!tarih && !neden) return hata('Tarihi değiştirmiyorsanız bir gerekçe seçmelisiniz.')
  const n = GECIKME_NEDENLERI.find(x => x.kod === neden)
  if (n && String(n.ozellikler?.not_zorunlu) === 'true' && !not) return hata('Bu gerekçe için açıklama zorunlu.')
  const btn = document.getElementById('sptKaydet'); btn.disabled = true; btn.textContent = 'Kaydediliyor…'
  const geri = () => { btn.disabled = false; btn.textContent = 'Kaydet' }
  const { data, error } = await supabase.rpc('teslim_plani_degistir', {
    p_siparis: s.id, p_yeni_tarih: tarih, p_neden_kod: neden, p_not: not,
    p_plan_tipi: null, p_kaynak: 'DANISMAN',
  })
  if (error) { dbHata('teslim planı değiştir', error); geri(); return hata(planHataMetni(error)) }
  if (!data?.ok) { console.error('teslim_plani_degistir beklenmeyen yanıt', data); geri(); return hata('Kaydedilemedi — sunucu onay vermedi.') }
  modalKapat()
  // ⚠️ Sonuç mesajı toast() ile: #icerik'e yazılan uyarıyı hemen ardından
  //    gelen yeniden çizim siler, işlem "sessizce başarısız" görünürdü.
  toast(planSonucMetni(data))
  await yukle()
}

// Dönen `tur` → kullanıcının anlayacağı tek cümle. Sınıflandırma sunucunun.
function planSonucMetni(d) {
  const kac = Number(d?.erteleme_sayisi) || 0
  if (d?.tur === 'GEREKCE') return 'Gerekçe kaydedildi.'
  if (d?.tur === 'ERTELEME') return `Teslim tarihi ertelendi (${kac}. erteleme). Satış müdürüne bildirildi.`
  if (d?.tur === 'ERKEN') return 'Teslim tarihi öne alındı.'
  if (d?.tur === 'DUZELTME') return 'Tarih düzeltildi.'
  return 'Teslim planı güncellendi.'
}

// Sunucu hatasını SINIFLANDIR (arac-kart.js / siparis-dosya.js ile aynı desen).
// Ham Postgres metni kullanıcıya ne yapacağını söylemiyor; iki RPC de bunu kullanır.
function planHataMetni(error) {
  const m = error?.message || ''
  if (/BR-0141|geçmiş bir gün|Geçmiş tarihli/i.test(m)) {
    return 'Teslim tarihi geçmiş bir güne verilemez (BR-0141). Bugünü veya ileri bir günü seçin; geçmişteki sözü yalnız satış müdürü kaydedebilir.'
  }
  if (/BR-0143|Gerekçe seçilmeden/i.test(m)) return 'Tarih ertelenirken gerekçe zorunlu — listeden bir neden seçin.'
  if (/açıklama zorunlu/i.test(m)) return 'Seçtiğiniz gerekçe için açıklama yazmanız gerekiyor.'
  if (/Geçersiz gerekçe kodu/i.test(m)) return 'Gerekçe listesi değişmiş görünüyor — sayfayı yenileyip tekrar deneyin.'
  if (/zaten plan var/i.test(m)) return 'Bu dosyada zaten bir plan var — listeyi yenileyip "Tarih / gerekçe" düğmesini kullanın.'
  if (/Sipariş bulunamadı/i.test(m)) return 'Sipariş bulunamadı — liste eskimiş olabilir, yenileyin.'
  if (error?.code === '42501' || /yetkiniz yok|yalnız satış müdürü/i.test(m)) {
    return 'Bu dosyanın teslim planına dokunma yetkiniz yok — dosyanın danışmanı veya satış müdürü değiştirebilir.'
  }
  return 'Kaydedilemedi: ' + m
}

// ---------- Tablo satırı ----------
function satirHtml(s) {
  const a = one(s.stok_araclar), m = one(s.musteriler)
  const dan = danismanAdi(DMAP, s.danisman_id)
  const t = tahsilat(s)
  const teslimSerit = teslimSeritHtml(s)
  // Kenar çizgisi: eksik tahsilat kadar FAZLA tahsilat da işaretlenir —
  // ikisi de teslimatı engelliyor (sql/149), ikisi de göze çarpmalı.
  const kenar = s.durum === 'IPTAL' ? (t.fazlaVar ? 'border-l-error' : 'border-l-outline-variant')
    : (s._bakiye != null && Math.abs(s._bakiye) > 0.005) ? 'border-l-error/60' : 'border-l-transparent group-hover:border-l-primary'
  const foto = KAPAK.get(s.arac_id)
  const not = (s.rezervasyon_notu || '').trim()

  // Fazla tahsilatta yüzde YAZILMAZ — "%100" o dosyanın tamam olduğunu ima
  // ediyordu, oysa bakiye sıfır değil ve teslimat kilitli.
  const tahsilatHucre = t.gizli
    ? `<span class="text-label-sm text-on-surface-variant flex items-center gap-1">${mat('lock', 'text-[14px]')} —</span>`
    : t.fazlaVar
      ? `<div class="flex flex-col gap-1.5 w-32">
          <div class="flex justify-between text-label-sm"><span class="font-bold text-error">Fazla</span><span class="text-error font-semibold">+${fmtPara(t.fazla)}</span></div>
          <div class="h-1.5 w-full bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-error" style="width:100%"></div></div>
        </div>`
      : `<div class="flex flex-col gap-1.5 w-32">
          <div class="flex justify-between text-label-sm"><span class="font-bold ${t.yuzde >= 100 ? 'text-secondary' : t.yuzde < 30 ? 'text-error' : 'text-on-surface'}">%${t.yuzde}</span><span class="text-on-surface-variant">${fmtPara(t.odenen)}</span></div>
          <div class="h-1.5 w-full bg-surface-container rounded-full overflow-hidden"><div class="h-full ${t.yuzde >= 100 ? 'bg-secondary' : t.yuzde < 30 ? 'bg-error' : 'bg-primary'} transition-all" style="width:${t.yuzde}%"></div></div>
        </div>`

  // Mobilde bakiye Durum kolonunun altına iniyor: küçük tipografi, sola
  // yaslı. `text-headline-sm` (22 px) 126 px'lik kolona sığmıyor, sayı
  // taşıp komşu hücrenin üstüne biniyordu (kullanıcı ekran görüntüsü).
  const bakiyeKompakt = t.gizli
    ? `<span class="text-on-surface-variant">${mat('lock', 'text-[14px]')}</span>`
    : t.fazlaVar
      ? `<span class="text-error font-bold text-[12px] leading-tight block truncate">${fmtPara(t.fazla)} fazla</span>`
      : t.kalan === 0
        ? `<span class="text-secondary font-bold text-[11px] flex items-center gap-0.5 truncate">${mat('check_circle', 'text-[14px]')} Tamamlandı</span>`
        : `<span class="text-[14px] font-black text-primary block truncate">${fmtPara(t.kalan)}</span>`

  const bakiyeHucre = t.gizli
    ? `<span class="text-on-surface-variant">${mat('lock', 'text-[16px]')}</span>`
    : t.fazlaVar
      ? `<span class="text-error font-bold flex flex-col items-end leading-tight"><span class="text-headline-sm font-black">${fmtPara(t.fazla)}</span><span class="text-label-sm">fazla tahsilat</span></span>`
      : t.kalan === 0
        ? `<span class="text-secondary font-bold flex items-center justify-end gap-1">${mat('check_circle', 'text-[18px]')} Tamamlandı</span>`
        : `<span class="text-headline-sm font-black text-primary">${fmtPara(t.kalan)}</span>`

  return `
    <tr data-satir="${s.id}" class="group hover:bg-surface-container-low/60 transition-colors cursor-pointer align-middle select-none ${TESLIM_SINIF[s._sinif]?.satir || ''}">
      <td class="p-2 pl-3 border-l-4 ${kenar} transition-colors hidden sm:table-cell">
        <div class="w-14 h-11 rounded-lg bg-surface overflow-hidden border border-outline-variant flex items-center justify-center">
          ${foto ? `<img src="${kacis(kapakUrl(foto))}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'material-symbols-outlined text-on-surface-variant',textContent:'directions_car'}))" />`
            : `<span class="material-symbols-outlined text-on-surface-variant">directions_car</span>`}
        </div>
      </td>
      <td class="px-2 py-3 sm:p-3 border-l-4 sm:border-l-0 ${kenar} transition-colors overflow-hidden">
        <div class="min-w-0 flex items-center gap-1.5">
          <div class="min-w-0">
            <div class="font-bold text-on-surface truncate">${B(aracBaslik(a))}</div>
            <div class="text-label-sm text-on-surface-variant tabular-nums truncate">${B(a?.plaka) || '—'} · ${kacis(fmtTarih(s.created_at).split(' ')[0])}</div>
            ${/* Müşteri kolonu dar ekranda kapalı — adı BURAYA iniyor ki
                  bilgi kaybolmasın. Geniş ekranda gizli, orada kendi
                  kolonunda zaten var. */''}
            <div class="sm:hidden text-label-sm text-primary font-semibold truncate">${B(m?.ad_soyad) || '—'}</div>
            ${/* Teslim kolonu xl altında kapalı — bilgi TEK ŞERİT olarak buraya iniyor. */''}
            ${teslimSerit}
          </div>
          ${not ? `<button class="sp-not shrink-0 w-6 h-6 rounded-md bg-amber-100 text-amber-800 flex items-center justify-center hover:bg-amber-200" data-not="${s.id}" title="Görüşme notu">${mat('sticky_note_2', 'text-[15px]')}</button>` : ''}
        </div>
      </td>
      <td class="p-3 hidden sm:table-cell"><div class="flex flex-col min-w-0"><span class="font-semibold text-on-surface truncate">${B(m?.ad_soyad) || '—'}</span>
        <span class="text-label-sm text-on-surface-variant tabular-nums truncate">${kacis(telNo(m?.telefon)) || '—'}</span></div></td>
      <td class="p-3 hidden lg:table-cell"><div class="flex items-center gap-2 min-w-0"><span class="w-8 h-8 rounded-full bg-primary-fixed text-primary flex items-center justify-center font-bold text-[11px] shrink-0">${basHarf(dan)}</span><span class="text-label-md text-on-surface truncate">${B(dan) || '—'}</span></div></td>
      <td class="p-3 hidden xl:table-cell overflow-hidden">${teslimHucre(s)}</td>
      ${/* ⚠️ `items-stretch sm:items-start`: dar ekranda çipler kolon
            genişliğine yaslanır. `items-start` iken çip `fit-content`
            boyutlanıyor ve — ÖLÇÜLDÜ — `max-width` onu KÜÇÜLTMÜYOR;
            açık `max-width:126px` bile 142 px'te bırakıyordu. `min-w-0`,
            `overflow:hidden`, `white-space:normal` denendi, hiçbiri
            çalışmadı. Yalnız `align-self:stretch` (yani items-stretch)
            kolon genişliğine indiriyor; ellips o zaman devreye giriyor.
            Geniş ekranda eski hugging davranışı korunuyor (sm:). */''}
      <td class="px-2 py-3 sm:p-3 overflow-hidden"><div class="flex flex-col gap-1 items-stretch sm:items-start min-w-0 max-w-full">
        ${asamaCip(s)}${saglik(s)}
        ${/* Bakiye kolonu dar ekranda kapalı — buraya, çiplerin ALTINA iniyor. */''}
        <div class="sm:hidden w-full pt-0.5 border-t border-outline-variant/40 mt-0.5">${bakiyeKompakt}</div>
      </div></td>
      <td class="p-3 hidden md:table-cell">${tahsilatHucre}</td>
      <td class="p-3 text-right hidden sm:table-cell">${bakiyeHucre}</td>
      <td class="p-3 text-right hidden xl:table-cell"><span class="text-label-sm text-on-surface-variant whitespace-nowrap">${sonHareketMetni(s._sonHareket)}</span></td>
    </tr>`
}

// ---------- Sağdan açılan hızlı bakış paneli ----------
// Göksenil, 3 Ağu 2026: "son hareketlerdeki aşağı okuna tıkladığımda açılan bir
//   yer var onu istemiyorum. sağ tarafta açılır bir şey yap. iki sefer
//   tıkladığımda satış dosyasına gitsin."
// Satır-içi accordion kaldırıldı: tabloyu itiyor, uzun listede kaydırmayı
// bozuyordu. Panel sabit konumlu, tabloya hiç dokunmuyor.
function drawerHtml() {
  const s = acikDrawer ? SIP.find(x => x.id === acikDrawer) : null
  if (!s) return `<div id="spDrawer" class="hidden"></div>`
  const a = one(s.stok_araclar), m = one(s.musteriler)
  const t = tahsilat(s)
  const foto = KAPAK.get(s.arac_id)
  const not = (s.rezervasyon_notu || '').trim()
  const bilgi = (e, d) => `<div class="flex justify-between gap-3 py-1.5 border-b border-outline-variant/40 last:border-0">
    <span class="text-label-sm text-on-surface-variant shrink-0">${e}</span>
    <span class="text-label-md font-semibold text-on-surface text-right min-w-0 break-words">${d}</span></div>`

  return `<div id="spDrawer" class="fixed inset-0 z-[90]">
    <div class="sp-dbg absolute inset-0 bg-black/30"></div>
    <aside class="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-surface-container-lowest shadow-2xl flex flex-col">
      <div class="px-5 py-4 border-b border-outline-variant flex items-start gap-3 bg-surface-container-low">
        <div class="w-16 h-12 rounded-lg bg-surface overflow-hidden border border-outline-variant flex items-center justify-center shrink-0">
          ${foto ? `<img src="${kacis(kapakUrl(foto))}" alt="" class="w-full h-full object-cover" />` : `<span class="material-symbols-outlined text-on-surface-variant">directions_car</span>`}
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="font-black text-primary truncate">${B(aracBaslik(a))}</h3>
          <p class="text-label-sm text-on-surface-variant tabular-nums">${B(a?.plaka) || '—'}${a?.versiyon ? ' · ' + B(a.versiyon) : ''}</p>
        </div>
        <button class="sp-dkapat p-2 hover:bg-white rounded-full text-on-surface-variant shrink-0">${mat('close')}</button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div class="flex flex-wrap gap-2">${asamaCip(s)}${saglik(s)}</div>

        ${not ? `<div class="bg-[#FFFBEB] border border-amber-300 rounded-xl p-3">
          <p class="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-1">${mat('sticky_note_2', 'text-[13px] align-middle')} Görüşme Notu</p>
          <p class="text-body-md text-amber-900 whitespace-pre-wrap leading-relaxed">${kacis(not)}</p></div>` : ''}

        <div>
          <h4 class="text-[10px] text-primary font-bold uppercase tracking-wider mb-1">Dosya</h4>
          ${bilgi('Anlaşılan Tutar', s.anlasilan_tutar != null ? fmtPara(s.anlasilan_tutar) : '—')}
          ${bilgi('Kapora', s.kapora_tutar != null ? fmtPara(s.kapora_tutar) : '—')}
          ${bilgi('Rezervasyon Nedeni', s.rezervasyon_nedeni ? kacis(rezervasyonNedenEtiket(s.rezervasyon_nedeni)) : '—')}
          ${bilgi('Açılış', kacis(fmtTarih(s.created_at)))}
        </div>

        <div>
          <h4 class="text-[10px] text-primary font-bold uppercase tracking-wider mb-1">Noter / Teslimat</h4>
          ${bilgi('Noter Satış Tarihi', s.satis_tarihi ? kacis(fmtTarih(s.satis_tarihi).split(' ')[0]) : '—')}
          ${bilgi('Noter / Yevmiye', [s.noter_adi, s.yevmiye_no].filter(Boolean).map(kacis).join(' · ') || '—')}
          ${bilgi('Teslimat', s.teslimat_durumu ? kacis(TESLIMAT_DURUM_ETIKET[s.teslimat_durumu] || s.teslimat_durumu) : (s.durum === 'TESLIM_EDILDI' ? 'Teslim edildi' : 'Bekliyor'))}
          ${disLokasyon(a?.lokasyon) ? bilgi('Lokasyon', B(a.lokasyon)) : ''}
        </div>

        <div>
          <h4 class="text-[10px] text-primary font-bold uppercase tracking-wider mb-1">Alıcı</h4>
          ${bilgi('Müşteri', B(m?.ad_soyad) || '—')}
          ${bilgi('Telefon', kacis(telNo(m?.telefon)) || '—')}
          ${bilgi('Danışman', B(danismanAdi(DMAP, s.danisman_id)) || '—')}
        </div>

        ${t.gizli ? '' : `<div class="rounded-xl border ${t.fazlaVar ? 'border-error/50 bg-error-container/40' : 'border-outline-variant'} p-3 text-center">
          ${t.fazlaVar
            ? `<div class="text-label-sm text-on-surface-variant">${s.durum === 'IPTAL' ? 'İade bekleyen tutar' : 'Fazla tahsilat'}</div>
               <div class="text-headline-sm font-black text-error">${fmtPara(t.fazla)}</div>
               <div class="text-label-sm text-error mt-1">İade edilmeli ya da başka dosyaya mahsup edilmeli — bakiye tam sıfırlanmadan teslimat onaya gönderilemez.</div>`
            : t.kalan === 0
              ? `<div class="text-secondary font-black flex items-center justify-center gap-1">${mat('check_circle', 'text-[18px]')} Borç kapandı</div>`
              : `<div class="text-label-sm text-on-surface-variant">Kalan bakiye</div><div class="text-headline-sm font-black text-error">${fmtPara(t.kalan)}</div>`}</div>`}
      </div>

      <div class="p-4 border-t border-outline-variant bg-surface-container-low flex flex-col gap-2">
        ${acikMi(s) ? aksiyonBtn(s) : ''}
        <button data-dosya="${s.id}" class="w-full py-2.5 bg-primary text-on-primary rounded-lg text-label-md font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('folder_open', 'text-[18px]')} Satış Dosyasını Aç</button>
        ${acikMi(s) ? `<button data-iptal="${s.id}" class="w-full py-2 border border-error/40 text-error rounded-lg text-label-md font-bold hover:bg-error/5">Siparişi İptal Et</button>` : ''}
      </div>
    </aside>
  </div>`
}

// Aşama/teslimat durumuna göre ana aksiyon (inline)
function aksiyonBtn(s) {
  const cls = 'w-full py-2.5 text-label-md rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all'
  const td = s.teslimat_durumu
  if (td === 'ONAYLANDI') return `<button data-teslim="${s.id}" class="${cls} bg-secondary text-on-primary hover:opacity-90">${mat('done_all', 'text-[18px]')} Teslim Et</button>`
  if (td === 'ONAY_BEKLIYOR') return `<span class="${cls} bg-blue-100 text-blue-800 cursor-default">${mat('hourglass_top', 'text-[18px]')} Finans onayında</span>`
  if (td === 'IADE') return `<button data-onaygonder="${s.id}" class="${cls} bg-amber-500 text-white hover:opacity-90">${mat('replay', 'text-[18px]')} Tekrar Onaya Gönder</button>`
  // Bakiye TAM SIFIR değilse (eksik VEYA fazla) düğme kilitli — sql/149.
  if (sifirMi(s._bakiye)) return `<button data-onaygonder="${s.id}" class="${cls} bg-white border border-primary text-primary hover:bg-primary hover:text-on-primary">${mat('send', 'text-[18px]')} Teslimat Kontrolüne Gönder</button>`
  const ipucu = s._bakiye == null ? 'Cari görünmüyor'
    : s._bakiye > 0 ? 'Fazla tahsilat iade/mahsup edilmeli'
      : 'Borç kapatılmalı'
  return `<button disabled title="${ipucu}" class="${cls} bg-surface-container-high text-outline cursor-not-allowed">${mat('lock', 'text-[18px]')} Teslimat Kontrolüne Gönder</button>`
}

// ---------- Modal kabuğu (Stoktan Sipariş + İptal ortak konteyneri) ----------
function modalKabuk() {
  return `<div id="spModalKat" class="fixed inset-0 z-[100] hidden"></div>`
}
// ⚠️ Sistem teşhisi pencereyle birlikte ölür: kalırsa bir sonraki dosyanın
//    çelişki uyarısı ÖNCEKİ dosyanın teşhisine göre hesaplanır.
function modalKapat() { sptTeshis = null; const k = document.getElementById('spModalKat'); if (k) { k.classList.add('hidden'); k.innerHTML = '' } }

// ---------- Stoktan Sipariş Oluştur ----------
async function stoktanAc() {
  const kat = document.getElementById('spModalKat')
  kat.classList.remove('hidden')
  kat.innerHTML = `<div class="sp-bg absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
    <div class="relative mx-auto mt-[6vh] w-full max-w-lg bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
      <div class="px-6 py-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
        <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary">${mat('add_shopping_cart')}</div>
          <div><h2 class="text-xl font-black text-primary tracking-tight">Stoktan Sipariş Oluştur</h2><p class="text-xs text-on-surface-variant">Stoktaki araç + alıcı + anlaşılan tutar → Satış Dosyası</p></div></div>
        <button class="sp-kapat p-2 hover:bg-white rounded-full text-on-surface-variant">${mat('close')}</button></div>
      <div class="flex-1 overflow-y-auto p-6 space-y-4">
        <div id="spmHata" class="hidden bg-error-container text-on-error-container border border-error/20 rounded-lg px-4 py-2.5 text-sm"></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Araç (stokta) *</label><select id="spmArac" class="${INP} mt-1"><option value="">Yükleniyor…</option></select></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Alıcı Müşteri *</label><select id="spmMusteri" class="${INP} mt-1"><option value="">Yükleniyor…</option></select></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">Anlaşılan Tutar (₺) *</label><input id="spmTutar" inputmode="numeric" placeholder="0" class="${INP} mt-1 font-bold para-gir" /></div>
        <div>
          <label class="text-[11px] font-bold text-on-surface-variant uppercase">Planlanan Teslim Tarihi *</label>
          <div id="spmCipler" class="flex flex-wrap gap-2 mt-1.5"></div>
          <input id="spmTarih" type="date" class="${INP} mt-2 hidden" />
          <p class="text-[11px] text-on-surface-variant mt-1.5">Müşteriye ne söz verdiyseniz onu seçin. Netleşmediyse <b>Henüz netleşmedi</b>: dosya plansız kalmaz ama kırmızı sayaç işlemez.</p>
        </div>
        <p class="text-[11px] text-on-surface-variant">Sipariş oluşunca araç <b>SİPARİŞTE</b> olur, stok listesinden düşer, müşteri anlaşılan tutar kadar borçlanır.</p>
        <p class="text-[11px] text-on-surface-variant bg-surface-container-low rounded-lg p-2.5">
          <b>Kapora ayrı girilmez.</b> Kapora da bir tahsilattır — dosya açıldıktan sonra
          <b>Tahsilat</b> aksiyonundan nasıl alındıysa öyle işleyin
          (ör. <i>5.000 ₺ · Havale · Enpara</i>). Böylece cariye anında yansır ve
          hangi kasadan girdiği kaybolmaz.</p>
      </div>
      <div class="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex justify-end gap-3">
        <button class="sp-kapat px-6 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-white border border-transparent hover:border-outline-variant">Vazgeç</button>
        <button id="spmKaydet" class="px-6 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-bold hover:opacity-90 shadow-md">Sipariş Oluştur ve Dosyayı Aç</button></div>
    </div>`
  kat.querySelector('.sp-bg').addEventListener('click', modalKapat)
  kat.querySelectorAll('.sp-kapat').forEach(b => b.addEventListener('click', modalKapat))
  spmPlan = null
  spmCipCiz()
  document.getElementById('spmTarih').addEventListener('change', e => { if (spmPlan && spmPlan.kod === 'ozel') spmPlan.tarih = e.target.value })

  const [{ data: aralar, error: aErr }, { data: musteriler, error: mErr }] = await Promise.all([
    supabase.from('stok_araclar').select('id, marka, model, yil, plaka, durum').in('durum', ['STOKTA', 'YAYINDA']).order('created_at', { ascending: false }),
    supabase.from('musteriler').select('id, ad_soyad, telefon').order('ad_soyad'),
  ])
  if (aErr) dbHata('araç listesi', aErr); if (mErr) dbHata('müşteri listesi', mErr)
  document.getElementById('spmArac').innerHTML = `<option value="">Seçin…</option>` + (aralar || []).map(a => `<option value="${a.id}">${kacis(buyuk([a.yil, a.marka, a.model].filter(Boolean).join(' ')))} — ${kacis(a.plaka || '—')}</option>`).join('')
  document.getElementById('spmMusteri').innerHTML = `<option value="">Seçin…</option>` + (musteriler || []).map(m => `<option value="${m.id}">${kacis(buyuk(m.ad_soyad))}${m.telefon ? ' · ' + kacis(telNo(m.telefon)) : ''}</option>`).join('')
  document.getElementById('spmKaydet').addEventListener('click', stoktanKaydet)
}

// Stoktan Sipariş: teslim planı çipleri. Seçenekler veri.js TESLIM_CIPLERI'nden
// gelir (TEK KAYNAK) — burada yeniden tanımlanmaz. "Tarih seç" takvimi açar,
// "Henüz netleşmedi" TAHMIN tipi üretir (tarih yine yazılır, kırmızı işlemez).
function spmCipCiz() {
  const kap = document.getElementById('spmCipler'); if (!kap) return
  kap.innerHTML = cipler(TESLIM_CIPLERI.map(c => [c.kod, c.etiket]), spmPlan?.kod || '', { ad: 'spc' })
  kap.querySelectorAll('[data-spc]').forEach(b => b.addEventListener('click', () => {
    const c = TESLIM_CIPLERI.find(x => x.kod === b.dataset.spc); if (!c) return
    const gir = document.getElementById('spmTarih')
    if (c.gun == null) {
      // ⚠️ SESSİZ VARSAYILAN YOK. Eskiden burada `gir.value || gunEkleISO(3)`
      //    vardı: "Tarih seç" çipine basıp takvimi hiç açmayan kullanıcı,
      //    farkında olmadan +3 GÜNLÜK MÜŞTERİ SÖZÜ kaydediyordu ve zorunluluk
      //    kapısı memnun oluyordu. Diğer iki giriş noktası (arac-kart.js,
      //    arac-detay.js) aynı çipte null döndürüp kullanıcıyı zorluyor —
      //    üç nokta aynı davranır. Boş kalırsa stoktanKaydet() uyarır.
      spmPlan = { kod: c.kod, tarih: gir.value || null, tip: c.tip }
      gir.min = bugunISO(); gir.classList.remove('hidden'); gir.focus()
    } else {
      spmPlan = { kod: c.kod, tarih: gunEkleISO(c.gun), tip: c.tip }
      gir.classList.add('hidden')
    }
    spmCipCiz()
  }))
}

async function stoktanKaydet() {
  const hata = msg => { const h = document.getElementById('spmHata'); h.textContent = msg; h.classList.remove('hidden') }
  document.getElementById('spmHata').classList.add('hidden')
  const arac_id = document.getElementById('spmArac').value
  const musteri_id = document.getElementById('spmMusteri').value
  const tutarRaw = document.getElementById('spmTutar').value.replace(/\D/g, '')
  if (!arac_id) return hata('Stoktan araç seçin.')
  if (!musteri_id) return hata('Alıcı müşteri seçin.')
  if (!tutarRaw) return hata('Anlaşılan tutar zorunlu (sipariş borcu bundan oluşur).')
  if (!spmPlan || !spmPlan.tarih) return hata('Planlanan teslim tarihini seçin (netleşmediyse "Henüz netleşmedi").')
  const btn = document.getElementById('spmKaydet'); btn.disabled = true; btn.textContent = 'Oluşturuluyor…'
  // Blok B/3 (Göksenil, 6 Ağu 2026): "kapora yazmasına gerek yok, o da bir
  // tahsilat neticesinde." Kapora artık sipariş açılışında ayrı alan DEĞİL;
  // dosyadaki Tahsilat aksiyonundan nasıl alındıysa öyle işlenir
  // (ör. 5.000 ₺ · Havale · Enpara). Eskiden kapora_tutar yazılıyordu ama
  // cariye HİÇ yansımıyordu → kapora ya iki kez tahsil ediliyor ya hiç.
  const kayit = {
    arac_id, alici_musteri_id: musteri_id, danisman_id: BEN?.id, olusturan: BEN?.id,
    durum: 'ACIK', asama: 'SIPARIS', anlasilan_tutar: Number(tutarRaw),
    // ⚠️ Bu iki kolon YALNIZ INSERT'te doğrudan yazılabilir. Sonradan UPDATE
    //    ile değiştirilemez (trigger reddeder, BR-0142); değişiklik
    //    teslim_plani_degistir() / teslim_plani_goc() RPC'lerinden geçer.
    planlanan_teslim_tarihi: spmPlan.tarih, plan_tipi: spmPlan.tip,
  }
  // BR-0112/0504 — min satış fiyatının altındaysa satış müdürü onayı ŞART.
  // Sunucu zaten reddediyor (sql/88); burada onayı VEREBİLECEK kişiye sorup
  // damgayı ekliyoruz ki müdür ekranı terk etmeden işlemi bitirebilsin.
  if (satisMuduruMu(BEN)) {
    const { data: mf } = await supabase.from('arac_fiyatlar')
      .select('min_satis_fiyati').eq('arac_id', arac_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const min = mf?.min_satis_fiyati != null ? Number(mf.min_satis_fiyati) : null
    if (min != null && Number(tutarRaw) < min) {
      if (!confirm(`Anlaşılan tutar minimum satış fiyatının ALTINDA.\n\nMinimum: ${fmtPara(min)}\nAnlaşılan: ${fmtPara(Number(tutarRaw))}\n\nSatış müdürü olarak bu indirimi onaylıyor musunuz? (BR-0112/0504)`)) {
        btn.disabled = false; btn.textContent = 'Sipariş Oluştur ve Dosyayı Aç'
        return hata('Min fiyat altı satış onaylanmadı.')
      }
      kayit.min_fiyat_onay_veren = BEN?.id || null
      kayit.min_fiyat_onay_not = 'Sipariş açılışında satış müdürü onayı'
    }
  }
  const { data, error } = await supabase.from('siparisler').insert(kayit).select('id')
  if (error) { dbHata('stoktan sipariş', error); btn.disabled = false; btn.textContent = 'Sipariş Oluştur ve Dosyayı Aç'; return hata('Kaydedilemedi: ' + error.message) }
  if (!data?.length) { btn.disabled = false; return hata('Kaydedilemedi — yetki/kayıt yok.') }
  location.href = 'siparis-dosya.html?id=' + encodeURIComponent(data[0].id)
}

// ---------- İptal (neden sorulur) ----------
function iptalAc(id) {
  const s = SIP.find(x => x.id === id); if (!s) return
  const kat = document.getElementById('spModalKat')
  kat.classList.remove('hidden')
  const nedenOpts = IPTAL_NEDENLERI.map(n => `<option value="${kacis(n.kod)}">${kacis(n.ad)}</option>`).join('')
  kat.innerHTML = `<div class="sp-bg absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
    <div class="relative mx-auto mt-[12vh] w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden">
      <div class="px-6 py-5 border-b border-outline-variant flex items-center gap-3 bg-error/5">
        <div class="w-10 h-10 rounded-xl bg-error-container flex items-center justify-center text-on-error-container">${mat('cancel')}</div>
        <div><h2 class="text-lg font-black text-error">Siparişi İptal Et</h2><p class="text-xs text-on-surface-variant">Araç otomatik <b>STOKTA</b>'ya döner. Neden zorunlu.</p></div></div>
      <div class="p-6 space-y-3">
        <div id="spiHata" class="hidden bg-error-container text-on-error-container rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="text-[11px] font-bold text-on-surface-variant uppercase">İptal Nedeni *</label>
          <select id="spiNeden" class="${INP} mt-1"><option value="">Seçiniz…</option>${nedenOpts}</select></div>
        <div id="spiNotSar"><label class="text-[11px] font-bold text-on-surface-variant uppercase">Açıklama</label>
          <textarea id="spiNot" rows="2" placeholder="Serbest açıklama (Diğer için zorunlu)" class="${INP} mt-1 resize-none"></textarea></div>
      </div>
      <div class="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex justify-end gap-3">
        <button class="sp-kapat px-5 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-white">Vazgeç</button>
        <button id="spiOnay" class="px-6 py-2.5 bg-error text-on-error rounded-lg text-sm font-bold hover:opacity-90">İptal Et</button></div>
    </div>`
  kat.querySelector('.sp-bg').addEventListener('click', modalKapat)
  kat.querySelectorAll('.sp-kapat').forEach(b => b.addEventListener('click', modalKapat))
  document.getElementById('spiOnay').addEventListener('click', () => iptalKaydet(s))
}

async function iptalKaydet(s) {
  const hata = msg => { const h = document.getElementById('spiHata'); h.textContent = msg; h.classList.remove('hidden') }
  document.getElementById('spiHata').classList.add('hidden')
  const neden = document.getElementById('spiNeden').value
  const not = document.getElementById('spiNot').value.trim() || null
  if (!neden) return hata('İptal nedeni seçin.')
  if (neden === 'DIGER' && !not) return hata('"Diğer" için açıklama yazın.')
  const btn = document.getElementById('spiOnay'); btn.disabled = true; btn.textContent = 'İptal ediliyor…'
  const { error } = await supabase.from('siparisler').update({ durum: 'IPTAL', iptal_nedeni: neden, iptal_not: not }).eq('id', s.id).select('id')
  if (error) { dbHata('sipariş iptal', error); btn.disabled = false; btn.textContent = 'İptal Et'; return hata('Başarısız: ' + error.message) }
  modalKapat(); acikDrawer = null; await yukle()
}

// ---------- Aksiyonlar (mevcut mantık korunur) ----------
async function onayaGonder(id) {
  const s = SIP.find(x => x.id === id); if (!s) return
  // ⚠️ Eskiden yalnız "Kalan: −10.000 ₺" gibi anlamsız bir metin basıyordu
  //    (borç yokken eksi kalan). Artık fazla ve eksik AYRI anlatılıyor;
  //    ikisi de onaya göndermeyi engelliyor (sql/149).
  if (!sifirMi(s._bakiye)) {
    alert(s._bakiye == null ? 'Cari bakiye görünmüyor.'
      : s._bakiye > 0
        ? 'Bu dosyada ' + fmtPara(s._bakiye) + ' FAZLA TAHSİLAT var.\n\n'
          + 'Bakiye tam sıfırlanmadan teslimat onaya gönderilemez. Fazlayı iade edin '
          + 'ya da başka bir dosyaya mahsup edin.'
        : 'Borç kapatılmadan onaya gönderilemez. Kalan: ' + fmtPara(-s._bakiye))
    return
  }
  if (!confirm('Teslimat finans onayına gönderilsin mi?')) return
  const { error } = await supabase.from('siparisler').update({ teslimat_durumu: 'ONAY_BEKLIYOR' }).eq('id', id).select('id')
  if (error) { dbHata('onaya gönder', error); alert('İşlem başarısız: ' + error.message); return }
  const { error: oErr } = await supabase.rpc('olay_ekle', { p_tip: 'TESLIMAT_ONAYA_GONDERILDI', p_arac: s.arac_id, p_musteri: s.alici_musteri_id, p_siparis: id, p_danisman: BEN?.id })
  if (oErr) dbHata('olay_ekle onaya gönder', oErr)
  await yukle()
}

// Göksenil (5 Ağu 2026): "teslim et butonuna basıyorum … bunu pop up ile
//   istiyorum. Ve ben hâlâ noteri, yevmiye noyu, yeni ruhsat seri noyu,
//   yeni plakayı girmedim."
//
// ⚠️ Eskiden burada tarayıcının `confirm()` kutusu vardı ve noter devri
//   KAYDEDİLMEDEN teslim edilebiliyordu. Noter devri satışın kendisi;
//   kaydı olmadan dosya eksik kapanıyordu. Artık pencere o alanları
//   ZORUNLU istiyor ve ruhsat QR'ından dolduruyor (teslim-pencere.js).
//   Yazma da orada, tek update'te: noter kaydı + teslim birlikte geçer.
async function teslimEt(id) {
  const s = SIP.find(x => x.id === id); if (!s) return
  if (s.teslimat_durumu !== 'ONAYLANDI') { alert('Teslim için finans onayı (ONAYLANDI) gerekli.'); return }
  const a = one(s.stok_araclar), m = one(s.musteriler)
  teslimPencereAc(s, {
    plaka: a?.plaka ? buyuk(a.plaka) : '',
    baslik: aracBaslik(a),
    musteri: m?.ad_soyad ? buyuk(m.ad_soyad) : '',
  }, yukle)
}

// ---------- Excel (CSV) ----------
function csvIndir() {
  const list = filtreli()
  // Kalan ve Fazla AYRI kolon — tek kolonda toplanınca fazla tahsilat
  // sıfır görünüyor ve dışa aktarımdan da kayboluyordu.
  const bas = ['Dosya', 'Tarih', 'Arac', 'Plaka', 'Musteri', 'Telefon', 'Danisman', 'Asama', 'Anlasilan', 'Kalan', 'FazlaTahsilat', 'Durum']
  const satir = s => {
    const a = one(s.stok_araclar), m = one(s.musteriler), t = tahsilat(s)
    return [siparisNo(s), fmtTarih(s.created_at), buyuk(aracBaslik(a)), a?.plaka || '', buyuk(m?.ad_soyad || ''), m?.telefon || '', danismanAdi(DMAP, s.danisman_id), s.durum, s.anlasilan_tutar || '', t.gizli ? '' : t.kalan, t.gizli ? '' : t.fazla, s.durum]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')
  }
  const csv = '﻿' + [bas.join(';'), ...list.map(satir)].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = 'siparisler.csv'; a.click(); URL.revokeObjectURL(url)
}

// ---------- Olay bağlama ----------
function baglaOlaylar() {
  const arama = document.getElementById('spArama')
  arama?.addEventListener('input', e => {
    filtre.arama = e.target.value; const p = e.target.selectionStart; ciz()
    const y = document.getElementById('spArama'); if (y) { y.focus(); try { y.setSelectionRange(p, p) } catch (_) {} }
  })
  document.getElementById('spDanisman')?.addEventListener('change', e => { filtre.danisman = e.target.value; ciz() })
  document.getElementById('spDurum')?.addEventListener('change', e => { filtre.durum = e.target.value; ciz() })
  document.getElementById('spTemizle')?.addEventListener('click', () => { filtre.arama = ''; filtre.danisman = ''; filtre.durum = ''; filtre.sinif = ''; ciz() })
  document.getElementById('spYenile')?.addEventListener('click', yukle)
  document.getElementById('spExcel')?.addEventListener('click', csvIndir)
  document.getElementById('spYazdir')?.addEventListener('click', () => window.print())
  document.getElementById('spStoktan')?.addEventListener('click', stoktanAc)
  // Göç şeridi: PLANSIZ grubuna süz / süzgeci kaldır.
  document.getElementById('spPlansizSuz')?.addEventListener('click', () => {
    filtre.sinif = filtre.sinif === 'PLANSIZ' ? '' : 'PLANSIZ'; ciz()
  })

  // Tek tık → sağ panel · Çift tık → satış dosyası.
  // ⚠️ Tarayıcı çift tıkta ÖNCE iki click olayı yollar. Tek tıkı gecikmeli
  //   çalıştırıp dblclick gelirse iptal ediyoruz; yoksa çift tıkta panel
  //   bir açılıp hemen sayfa değişirdi (göz kırpması + boşuna çizim).
  document.querySelectorAll('[data-satir]').forEach(tr => {
    tr.addEventListener('click', ev => {
      if (ev.target.closest('[data-not],[data-dosya],[data-iptal],[data-onaygonder],[data-teslim],[data-goc],[data-plan]')) return
      clearTimeout(tikZaman)
      const id = tr.dataset.satir
      tikZaman = setTimeout(() => { acikDrawer = id; ciz() }, 230)
    })
    tr.addEventListener('dblclick', ev => {
      if (ev.target.closest('[data-not],[data-dosya],[data-iptal],[data-onaygonder],[data-teslim],[data-goc],[data-plan]')) return
      clearTimeout(tikZaman)
      location.href = 'siparis-dosya.html?id=' + encodeURIComponent(tr.dataset.satir)
    })
  })

  // Sağ panel kapatma
  document.querySelector('#spDrawer .sp-dbg')?.addEventListener('click', drawerKapat)
  document.querySelector('#spDrawer .sp-dkapat')?.addEventListener('click', drawerKapat)

  // Görüşme notu balonu (satır içinde, panele girmeden)
  document.querySelectorAll('.sp-not').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); clearTimeout(tikZaman); notBalonAc(b.dataset.not, b)
  }))
  document.querySelectorAll('[data-dosya]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); location.href = 'siparis-dosya.html?id=' + encodeURIComponent(b.dataset.dosya) }))
  document.querySelectorAll('[data-iptal]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); iptalAc(b.dataset.iptal) }))
  document.querySelectorAll('[data-goc]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); clearTimeout(tikZaman); gocAc(b.dataset.goc) }))
  document.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); clearTimeout(tikZaman); planAc(b.dataset.plan) }))
  document.querySelectorAll('[data-onaygonder]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); onayaGonder(b.dataset.onaygonder) }))
  document.querySelectorAll('[data-teslim]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); teslimEt(b.dataset.teslim) }))
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { modalKapat(); notBalonKapat(); drawerKapat() } })
}

function drawerKapat() { if (acikDrawer) { acikDrawer = null; ciz() } }

// Görüşme notu balonu — stok.js'teki rezerve balonuyla aynı desen.
// Yeniden çizim yok: DOM'a tek bir kutu eklenir, dışarı tıklayınca gider.
function notBalonAc(id, hedef) {
  notBalonKapat()
  const s = SIP.find(x => x.id === id); if (!s) return
  const not = (s.rezervasyon_notu || '').trim(); if (!not) return
  const a = one(s.stok_araclar)
  const el = document.createElement('div')
  el.className = 'fixed z-[95] w-72 bg-[#FFFBEB] border border-amber-300 rounded-xl shadow-xl p-3'
  el.innerHTML = `<p class="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-1">Görüşme Notu · ${B(a?.plaka) || ''}</p>
    <p class="text-body-md text-amber-900 whitespace-pre-wrap leading-relaxed">${kacis(not)}</p>`
  document.body.appendChild(el)
  const r = hedef.getBoundingClientRect()
  el.style.left = Math.max(8, Math.min(window.innerWidth - 296, r.left)) + 'px'
  let top = r.bottom + 6
  if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - el.offsetHeight - 6)
  el.style.top = top + 'px'
  NOT_BALON = el
  setTimeout(() => document.addEventListener('click', notBalonKapat, { once: true }), 0)
}
function notBalonKapat() { if (NOT_BALON) { NOT_BALON.remove(); NOT_BALON = null } }

const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
// Teslim hücresindeki küçük bağlantı düğmesi (Tarih gir / Tarih / gerekçe).
const PLAN_BTN = 'mt-0.5 text-[11px] font-bold text-primary underline underline-offset-2 hover:opacity-80'
