// =====================================================================
// stok.js — Stok Merkezi (DMS iç envanteri): stok_araclar üzerinden.
//   Kaynak SITE `araclar` DEĞİL — CRM `stok_araclar` (19 durumlu makine,
//   sql/86 · veri.js ARAC_DURUM_GRUP). "Aktif Stok" görünümü REZERVE aracı
//   GÖSTERİR, SİPARİŞTEKİ aracı gizler (BR-0123 · Göksenil kararı).
//   Güncel + MİN satış fiyatı v_arac_min_fiyat'tan (sql/99). .ai/18 gereği
//   satış danışmanı da min fiyatı görür — fiyatın yanındaki ⓘ ile açılır.
//   Stok yaşı v_stokta_kalis'ten (finans/yönetici) → yoksa created_at fallback.
//   Detay linki → arac-kart.html?id=<uuid> (DMS kartı; SITE stok-arac.html ayrı).
//   Eşleşen açık talep sinyali eslestirme-cekirdek uygunTalepler ile.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import { uygunTalepler } from './eslestirme.js'
import { fmtPara, kacis, trBuyuk, buyuk, kapanisMi, dbHata, ARAC_DURUM_ETIKET, ARAC_AKTIF_DURUMLAR, ARAC_LISTE_GIZLI,
  ARAC_DURUM_GRUP, KDV_KODLARI, kdvEtiket, danismanMap, danismanAdi, plakaNormal, aracEtiket, markaAd } from './veri.js'
import { mat, bosDurum, stitchTablo, tabloTikla } from './stitch-ui.js'
import { svgBoya, PARCALAR, RENK } from './ekspertiz.js'
import { camEtiketiBasar, fiyatYonetir, ilanYonetir } from './yetki.js'

let tumVeri = []
let acikTalepler = []          // eşleştirme için açık talepler
let talepSay = {}, notSay = {} // aracId → sayı
let gorunum = 'kart'
const f = { arama: '', marka: '', model: '', yil: '', yakit: '', vites: '', durum: 'aktif', kdv: '', fiyatMin: '', fiyatMax: '', kmMin: '', kmMax: '' }
// Araç kapak fotoğrafı (arac-foto PUBLIC bucket → doğrudan public URL)
const kapakUrl = yol => supabase.storage.from('arac-foto').getPublicUrl(yol).data.publicUrl
// ⚠️ Ekspertiz şeması (7,5 KB) YALNIZ küçük popup'ta kullanılıyor ama
//    eskiden açılışta `await fetch(...)` ile indiriliyor ve listeyi
//    bekletiyordu. Artık tembel: ilk popup'ta indirilir, sonuç saklanır.
let EKSP_SVG_PS = null
function eksSvgYukle() {
  if (!EKSP_SVG_PS) EKSP_SVG_PS = fetch('img/ekspertiz-sema.svg').then(r => r.text()).catch(() => '')
  return EKSP_SVG_PS
}

// Aktif stok = teslim edilmemiş + satış dışı olmayan (fiziksel envanterde duran).
// Durum listesi veri.js'ten gelir (sql/86 ile birebir) — burada tekrar YAZMA.
const AKTIF = new Set(ARAC_AKTIF_DURUMLAR)
function aktifMi(a) { return AKTIF.has(a.durum) }

// Durum rozeti — tasarım renk paleti (yeşil/mavi/mor/amber/kırmızı)
// Grup rengi (sql/86 arac_durum_tanim.grup) — 19 durum tek tek boyanmaz
const GRUP_RENK = {
  ALIS:      'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30',
  STOK:      'bg-[#EFF6FF] text-[#1D4ED8] border-[#3B82F6]/30',
  OPERASYON: 'bg-[#FFF7ED] text-[#C2410C] border-[#F97316]/30',
  SATIS:     'bg-[#F5F3FF] text-[#6D28D9] border-[#8B5CF6]/30',
  KAPANIS:   'bg-surface-container-high text-on-surface-variant border-outline-variant/40',
}
const DURUM_GRUBU = {}
for (const [grup, kodlar] of Object.entries(ARAC_DURUM_GRUP)) for (const k of kodlar) DURUM_GRUBU[k] = grup
const DURUM_RENK = {
  // Öne çıkanlar grup renginden ayrılır (yayında yeşil, satış dışı kırmızı)
  YAYINDA:    'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30',
  SIPARISTE:  'bg-[#EEF2FF] text-[#4338CA] border-[#6366F1]/30',
  SATIS_DISI: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30',
}
const durumRenk = d => DURUM_RENK[d] || GRUP_RENK[DURUM_GRUBU[d]] || GRUP_RENK.KAPANIS
function durumRozet(a, kucuk) {
  const cls = durumRenk(a.durum)
  const pad = kucuk ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
  return `<span class="inline-block ${pad} rounded-full font-bold border ${cls}">${kacis(ARAC_DURUM_ETIKET[a.durum] || a.durum)}</span>`
}

// Stok yaşı (gün): v_stokta_kalis (finans/yönetici) yoksa created_at fallback
function stokGun(a) {
  if (a._sks != null) return a._sks
  if (!a.created_at) return null
  return Math.max(0, Math.floor((Date.now() - new Date(a.created_at)) / 86400000))
}
function gunRozet(a) {
  const g = stokGun(a)
  if (g == null) return '<span class="text-on-surface-variant">—</span>'
  let cls = 'bg-blue-100 text-blue-800'
  if (!aktifMi(a)) cls = 'bg-surface-container-high text-on-surface-variant'
  else if (g > 45) cls = 'bg-red-100 text-red-800'
  else if (g > 30) cls = 'bg-amber-100 text-amber-800'
  return `<span class="inline-block px-2.5 py-1 rounded-full text-xs font-bold ${cls}">${g} gün</span>`
}
function paraSayi(v) { const s = (v || '').replace(/\D/g, ''); return s ? Number(s) : null }

// Alış KDV rozeti — "Belli Değil" nötr/soluk (muhasebe doldurunca renklenir)
const KDV_RENK = {
  '1':          'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30',
  '20':         'bg-[#EFF6FF] text-[#1D4ED8] border-[#3B82F6]/30',
  OZEL_MATRAH:  'bg-[#F5F3FF] text-[#6D28D9] border-[#8B5CF6]/30',
  BELLI_DEGIL:  'bg-surface-container-high text-on-surface-variant border-outline-variant/40',
}
function kdvRozet(a) {
  const k = a.kdv_orani || 'BELLI_DEGIL'
  return `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${KDV_RENK[k] || KDV_RENK.BELLI_DEGIL}">${kacis(kdvEtiket(k))}</span>`
}

// d = giriş yapan danışman (cam etiketi yetkisi için gerekli). Geçilmezse
// buton gizlenir — yetkisiz gösterilmesindense yetkiliye gösterilmemesi yeğ.
let BEN = null
let DMAP = {}          // danışman id → ad (rezerve balonunda kullanılır)

// Fiyat sıralaması — null (varsayılan marka/model) · 'artan' · 'azalan'.
// Göksenil, 15 Ağu 2026: "fiyata tıkladığımızda azdan çoğa, çoktan aza
// sıralayabilsin (rezervedeki araçlar hariç)."
let fiyatSira = null

// ⚠️ Kilitli (REZERVE / SİPARİŞTE) araçlar sıralamaya GİRMEZ, listenin
//    başındaki yerini korur — Göksenil'in "rezervedeki araçlar hariç"
//    şartı bu. Onları da fiyata sokmak, bağlanmış araçları listenin
//    ortasına dağıtır ve "önce kilitliler" düzenini bozardı.
// ⚠️ Fiyatsız araç, yön ne olursa olsun SONA gider. Sayısal karşılaştırmada
//    null 0 gibi davranır ve "azdan çoğa"da listenin tepesini kaplardı.
function fiyataGoreSirala(liste) {
  if (!fiyatSira) return liste
  const yon = fiyatSira === 'artan' ? 1 : -1
  const kilitli = liste.filter(a => a._kilit)
  const serbest = liste.filter(a => !a._kilit).sort((a, b) => {
    const x = a._fiyat, y = b._fiyat
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (Number(x) - Number(y)) * yon
  })
  return [...kilitli, ...serbest]
}

// ---------- FİLTRE PANELİ (açılır/kapanır) ----------
// Göksenil, 15 Ağu 2026: "bütün rollerde arama yerini tıklayınca alta doğru
// açılan bir alan yapalım, araçları daha kolay görebilsinler."
// Kapalı başlar (araçlar hemen görünsün), kullanıcı açarsa tercihi hatırlanır.
function filtrePaneliKur() {
  const p = document.getElementById('filtrePanel')
  if (!p) return
  try {
    if (localStorage.getItem('stokFiltreAcik') === '1') p.open = true
  } catch (e) {
    // Gizli sekmede localStorage okunamayabilir — panel yalnız hatırlamaz,
    // çalışmaya devam eder. Sessiz geçmiyoruz ki sebebi konsolda görünsün.
    console.debug('[stok] filtre tercihi okunamadi', e)
  }
  // ⚠️ Ok yönü CSS ile DEĞİL, ikon değiştirilerek çevriliyor.
  //    `group-open:rotate-180` denendi ve ÜRETİLMEDİ (Tailwind CDN JIT,
  //    ölçüldü: transform kimlik matrisi kalıyor). Build adımı olmadığı için
  //    üretilmeyen bir sınıfa güvenmek sessizce çalışmayan arayüz demek.
  const okGuncelle = () => {
    const ok = document.getElementById('filtreOk')
    if (ok) ok.textContent = p.open ? 'expand_less' : 'expand_more'
  }
  okGuncelle()
  p.addEventListener('toggle', () => {
    okGuncelle()
    try { localStorage.setItem('stokFiltreAcik', p.open ? '1' : '0') }
    catch (e) { console.debug('[stok] filtre tercihi yazilamadi', e) }
  })
}

// Panel KAPALIYKEN aktif filtre varsa liste kısa görünür ve sebebi görünmez
// olur — "araçlar kayboldu" şikâyetinin klasik kaynağı. Başlıktaki rozet
// kaç filtrenin açık olduğunu söyler.
// ⚠️ `durum` varsayılanı 'aktif'; kullanıcı seçimi sayılmaz.
function filtreOzetCiz() {
  const el = document.getElementById('filtreOzet')
  if (!el) return
  const sayi = Object.entries(f).filter(([k, v]) => v && !(k === 'durum' && v === 'aktif')).length
  el.textContent = String(sayi)
  el.classList.toggle('hidden', sayi === 0)
}

function fiyatBaslikHtml() {
  const ik = fiyatSira === 'artan' ? 'arrow_upward' : fiyatSira === 'azalan' ? 'arrow_downward' : 'unfold_more'
  return `<button id="siraFiyat" class="inline-flex items-center gap-1 hover:opacity-80 cursor-pointer"
    title="Fiyata göre sırala — rezerve/siparişteki araçlar hariç, başta kalır">Fiyat ${
    mat(ik, 'text-[16px] align-middle' + (fiyatSira ? '' : ' opacity-60'))}</button>`
}
export async function stokKur(d = null) {
  BEN = d
  DMAP = await danismanMap()

  // Göksenil, 15 Ağu 2026: "mobil görünümde karşımıza direkt KPI'ler ve arama
  // alanları çıkıyor, araçlar onun altında kalıyor — danışman rolünde
  // KPI'leri göstermeyelim."
  // ⚠️ Yalnız MOBİLDE gizlenir (`hidden md:grid`), masaüstünde durur:
  //    danışman da stok yaşını/yayında sayısını görebilsin, sadece küçük
  //    ekranda araçların önünü kapatmasın.
  // ⚠️ JS ile ekran genişliği ölçülmüyor — CSS sınıfı, cihaz döndürüldüğünde
  //    de doğru davranır; `window.innerWidth` bir kez okunsaydı yatay çevirmede
  //    yanlış kalırdı.
  if (BEN?.rol === 'danisman' && !BEN?.master_admin) {
    document.getElementById('kpi')?.classList.add('hidden', 'md:grid')
  }
  filtrePaneliKur()
  document.getElementById('yenile')?.addEventListener('click', yukle)
  document.getElementById('arama')?.addEventListener('input', e => { f.arama = trBuyuk(e.target.value.trim()); ciz() })
  document.getElementById('fMarka')?.addEventListener('change', e => { f.marka = e.target.value; modelSecenek(); f.model = ''; ciz() })
  document.getElementById('fModel')?.addEventListener('change', e => { f.model = e.target.value; ciz() })
  document.getElementById('fYil')?.addEventListener('change', e => { f.yil = e.target.value; ciz() })
  document.getElementById('fYakit')?.addEventListener('change', e => { f.yakit = e.target.value; ciz() })
  document.getElementById('fVites')?.addEventListener('change', e => { f.vites = e.target.value; ciz() })
  // Durum filtresi: 19 durum gruplu olarak doldurulur (sql/86). HTML'de elle
  // yazılıydı, yeni durumlar eklenince orası unutuluyordu — tek kaynak veri.js.
  const durumSel = document.getElementById('fDurum')
  if (durumSel) {
    const secili = durumSel.value || 'aktif'
    durumSel.innerHTML = `<option value="aktif">Aktif Stok</option>` +
      Object.entries(ARAC_DURUM_GRUP).map(([grup, kodlar]) =>
        `<optgroup label="${kacis(grup)}">` +
        kodlar.map(k => `<option value="${k}">${kacis(ARAC_DURUM_ETIKET[k] || k)}</option>`).join('') +
        `</optgroup>`).join('') +
      `<option value="hepsi">Hepsi</option>`
    durumSel.value = secili
  }
  // KDV filtresi seçeneklerini bir kez doldur (kodlar sabit — sql/82 CHECK ile birebir)
  const kdvSel = document.getElementById('fKdv')
  if (kdvSel && !kdvSel.options.length) {
    kdvSel.innerHTML = `<option value="">Tüm KDV</option>` +
      KDV_KODLARI.map(k => `<option value="${k}">${kacis(kdvEtiket(k))}</option>`).join('')
  }
  document.getElementById('fDurum')?.addEventListener('change', e => { f.durum = e.target.value; ciz() })
  document.getElementById('fKdv')?.addEventListener('change', e => { f.kdv = e.target.value; ciz() })
  const rng = (id, key) => document.getElementById(id)?.addEventListener('input', e => { f[key] = e.target.value; ciz() })
  rng('fFiyatMin', 'fiyatMin'); rng('fFiyatMax', 'fiyatMax'); rng('fKmMin', 'kmMin'); rng('fKmMax', 'kmMax')
  document.getElementById('temizle')?.addEventListener('click', temizle)
  // Cam etiketi — filtrelenmiş listenin TAMAMI için toplu çıktı.
  // Yetki: bilgi işlem + yönetim (Göksenil kararı). Yetkisi olmayanda buton
  // DOM'dan kaldırılır — daha önce burada yalnız bu yorum vardı, kapı yoktu.
  if (!camEtiketiBasar(BEN)) document.getElementById('camEtiket')?.remove()
  document.getElementById('camEtiket')?.addEventListener('click', () => {
    const v = suz()
    if (!v.length) { alert('Listede araç yok.'); return }
    camEtiketSecim(v)
  })
  // Toplu fiyat — İsmail Bey / bilgi işlem / master (sql/100 is_fiyat_yetkili).
  // Yetkisizde buton DOM'dan kaldırılır; sunucu zaten insert'i reddeder ama
  // görünen bir butonun sessizce çalışmaması kullanıcıyı yanıltır.
  if (!fiyatYonetir(BEN)) document.getElementById('topluFiyat')?.remove()
  document.getElementById('topluFiyat')?.addEventListener('click', () => {
    const v = suz().filter(a => a._fiyat != null)
    if (!v.length) { alert('Listede fiyatlı araç yok.'); return }
    topluFiyatEkrani(v)
  })
  document.getElementById('gorunum')?.addEventListener('click', e => {
    const b = e.target.closest('[data-gorunum]'); if (!b) return
    gorunum = b.dataset.gorunum
    document.querySelectorAll('#gorunum [data-gorunum]').forEach(x => { x.classList.toggle('text-primary', x.dataset.gorunum === gorunum); x.classList.toggle('text-on-surface-variant', x.dataset.gorunum !== gorunum) })
    ciz()
  })
  // Ekspertiz ikonu (kart + tablo) → küçük SVG popup (satır navigasyonunu engelle)
  document.getElementById('liste')?.addEventListener('click', e => {
    const b = e.target.closest('.eksp-ac'); if (!b) return
    e.preventDefault(); e.stopPropagation()
    const a = tumVeri.find(x => x.id === b.dataset.id); if (a) ekspertizPopup(a)
  })
  // ⓘ → minimum satış fiyatı (danışmanın pazarlık tabanı)
  document.getElementById('liste')?.addEventListener('click', e => {
    const b = e.target.closest('.min-ac'); if (!b) return
    e.preventDefault(); e.stopPropagation()
    const a = tumVeri.find(x => x.id === b.dataset.id); if (a) minFiyatPopup(a, b)
  })
  // Fotoğrafsız araç kutusundaki "Fotoğraf Yükle" → ilan görseli penceresi.
  // Göksenil: "ilanı yayınlayacak kişi verileri buradan görebilir, ilan
  // görselinin linkini buradan kopyalayabilir olmalı." Pencerede ayrıca araç
  // kartına (fotoğraf yükleme yeri) bağlantı var.
  // Rezerve/sipariş rozetine gelince balon (Göksenil: "mouse ile üzerine
  // geldiğimde kimin rezervinde olduğunu, ne kadara anlaştığını yazsın")
  document.getElementById('liste')?.addEventListener('mouseover', e => {
    const r = e.target.closest('.rez-rozet'); if (!r) return
    const a = tumVeri.find(x => x.id === r.dataset.rez); if (a) rezBalonAc(a, r)
  })
  document.getElementById('liste')?.addEventListener('mouseout', e => {
    if (e.target.closest('.rez-rozet')) document.getElementById('rezBalon')?.remove()
  })
  document.getElementById('liste')?.addEventListener('click', async e => {
    const b = e.target.closest('.foto-yukle'); if (!b) return
    e.preventDefault(); e.stopPropagation()          // kart <a>; sayfa değişmesin
    const { ilanGorselAc, ilanGorselKur } = await import('./ilan-gorsel-pencere.js')
    ilanGorselKur(BEN)
    await ilanGorselAc(b.dataset.id, b.dataset.ad, () => yukle(),
      { fotoHref: 'arac-kart.html?id=' + encodeURIComponent(b.dataset.id) })
  })
  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('liste')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  // =====================================================================
  // ⚠️ AÇILIŞ SIRALI DEĞİL, PARALEL (19 Ağu 2026 — "stok biraz geç yükleniyor")
  //
  // ÖLÇÜM: DB tarafı hızlı — en yavaş sorgu 77 ms (talepler), araç tablosu
  //   181 satır. Yavaşlık sorgulardan değil, ARD ARDA DİZİLMİŞ DÖRT
  //   GİDİŞ-DÖNÜŞTEN geliyordu:
  //     1) ana toplu sorgu  →  2) SİTE kapak sorgusu (AYRI Supabase projesi,
  //     370 KB)  →  3) ekspertiz SVG indirmesi  →  4) sinyal + KPI sorguları
  //   Dördü de `await` ile sırayla bekleniyor, liste ancak sonunda çiziliyordu.
  //
  // YENİ: hepsi burada BAŞLAR. Liste, ana sorgu + sinyaller gelir gelmez
  //   çizilir. SİTE kapakları (en ağır parça) kritik yolda DEĞİL — gelince
  //   yamalanıp yeniden çizilir. SVG hiç indirilmez, popup açılırsa iner.
  // =====================================================================
  const sinyalPs = crmSinyalleriYukle()   // await ETME — arka planda koşsun
  const kpiPs    = kpiYukle()
  const siteKapakPs = siteKapaklariOku()

  const [aracR, fiyatR, sksR, fotoR, indR, etkR, rezR] = await Promise.all([
    supabase.from('stok_araclar')
      .select(`id, plaka, stok_kodu, eski_plaka, marka, model, versiyon, yil, yakit, vites, km, renk, kasa_tipi, durum, fiyatlama_durumu, lokasyon, park, kdv_orani, created_at,
               muayene_tarihi, foto_sira, arac_evraklar(tip), arac_ekspertiz(parca_kodu, durum), arac_tramer(id, tutar)`)
      .order('created_at', { ascending: false }),
    // G1: min satış fiyatı (ⓘ ikonu) — .ai/18 gereği satış danışmanı da görür;
    // yetkisi olmayan (kredi/sigorta/muhasebe) için view BOŞ döner (sql/99).
    supabase.from('v_arac_min_fiyat').select('arac_id, satis_fiyati, min_satis_fiyati'),
    supabase.from('v_stokta_kalis').select('arac_id, sks_gun'),   // danışmanda RLS ile boş döner → fallback
    // ⚠️ `created_at` EŞİTLİK BOZUCU — kaldırma. `sira` berabere kalırsa
    //   Postgres satır sırasını GARANTİ ETMEZ; kapak fotoğrafı her yüklemede
    //   değişebilir (35NSD813'te yaşandı). Bkz sql/117.
    supabase.from('arac_fotograflari').select('id, arac_id, dosya_yolu, sira').order('sira').order('created_at').limit(2000),
    // G2: indirim rozeti (sql/101) — referans fiyat MEVZUATA GÖRE hesaplanır
    // (penceredeki en düşük uygulanan fiyat), burada yeniden hesaplanmaz.
    supabase.from('v_arac_indirim').select('arac_id, eski_fiyat, yeni_fiyat, indirim_tutari, indirim_yuzde'),
    // G2: cam etiketi güncel mi (sql/102) — fiyat değişip etiket yenilenmediyse
    // camdaki fiyat yanlış demektir; etiket/kasa uyuşmazlığı riski.
    supabase.from('v_arac_etiket_durum').select('arac_id, durum, etiket_fiyati'),
    // REZERVE / SİPARİŞTE bilgisi — Göksenil: "rezervede olduğuna dair bir
    // bilgi yok… kimin rezervinde, ne kadara anlaştığı yazsın."
    // ⚠️ RLS: siparis_oku = master OR yönetici OR kendi kaydı. Satış danışmanı
    //   BAŞKASININ rezerv DETAYINI göremez → bu sorgu onda boş döner.
    //   Ama aracın REZERVE olduğu `stok_araclar.durum`'dan herkese görünür;
    //   rozet ondan çiziliyor, detay varsa balona ekleniyor. Danışmanın
    //   "boşta sanıp ikinci kez satması" böylece engelleniyor.
    supabase.from('siparisler')
      .select('arac_id, asama, anlasilan_tutar, kapora_tutar, gecerlilik_bitis, rezervasyon_nedeni, danisman_id')
      .eq('durum', 'ACIK'),
  ])
  if (aracR.error) { dbHata('stok yükle', aracR.error); hedef.innerHTML = `<div class="uyari-kutu">Araçlar okunamadı: ${kacis(aracR.error.message)}</div>`; return }
  if (fiyatR.error) console.error('[db] guncel fiyat', fiyatR.error)   // fiyat yoksa liste yine çalışır
  if (fotoR.error) console.error('[db] arac_fotograflari', fotoR.error)
  if (indR.error) console.error('[db] v_arac_indirim', indR.error)
  if (etkR.error) console.error('[db] v_arac_etiket_durum', etkR.error)
  const indMap = {}; for (const r of (indR.data || [])) indMap[r.arac_id] = r
  const etkMap = {}; for (const r of (etkR.data || [])) etkMap[r.arac_id] = r
  const fiyatMap = {}, minMap = {}
  for (const r of (fiyatR.data || [])) { fiyatMap[r.arac_id] = r.satis_fiyati; minMap[r.arac_id] = r.min_satis_fiyati }
  const sksMap = {}; for (const r of (sksR.data || [])) sksMap[r.arac_id] = r.sks_gun
  // Kapak fotoğrafı — HAZIR URL olarak tutulur. Önce DMS yüklemesi (arac-foto
  // public bucket), o yoksa SİTE ilan fotoğrafı.
  const fotoMap = {}
  for (const r of (fotoR.data || [])) if (!fotoMap[r.arac_id]) fotoMap[r.arac_id] = kapakUrl(r.dosya_yolu)   // ilk (en düşük sıra)
  // sql/185 · Araç kartında elle seçilen KAPAK burayı ezer. `foto_sira[0]`
  // ya bir arac_fotograflari.id'sidir ya da site ilan foto URL'i.
  const fotoIdMap = {}; for (const r of (fotoR.data || [])) fotoIdMap[r.id] = r.dosya_yolu
  const elleKapak = {}
  for (const a of (aracR.data || [])) {
    const k = Array.isArray(a.foto_sira) ? a.foto_sira[0] : null
    if (!k) continue
    if (/^https?:\/\//i.test(k)) elleKapak[a.id] = k                       // site fotoğrafı
    else if (fotoIdMap[k]) elleKapak[a.id] = kapakUrl(fotoIdMap[k])        // CRM fotoğrafı
  }
  for (const k in elleKapak) fotoMap[k] = elleKapak[k]   // elle seçim her iki kaynağı da ezer
  if (rezR.error) console.error('[db] rezervasyon', rezR.error)
  const rezMap = {}; for (const r of (rezR.data || [])) rezMap[r.arac_id] = r

  // ⚠️ `.catch` ŞART: bu ikisi artık ERKEN başlıyor. Biri reddederse ve
  //    yakalanmazsa yukle() komple düşer, liste hiç çizilmez. Sinyal/KPI
  //    süs bilgisi — yoksa liste yine doğru.
  await Promise.all([sinyalPs, kpiPs]).catch(e => console.warn('[stok] sinyal/kpi', e))
  tumVeri = (aracR.data || []).map(a => nitele(a, fiyatMap, sksMap, fotoMap, minMap, indMap, etkMap, rezMap))
  // Göksenil: "kart görünümde araç kartların en başında görünsün."
  //   → Kilitli araçlar (rezerve/siparişte) hâlâ en üstte.
  // Göksenil, 12 Ağu 2026: "araçlar önce marka isimleri ile A'dan Z'ye
  //   sıralansın, kendi içlerinde de model isimlerine göre A'dan Z'ye."
  //   → Kilitli/serbest her iki grubun İÇİNDE marka, sonra model alfabetik.
  //     Fiyata göre sıralama kaldırıldı.
  // ⚠️ localeCompare 'tr' ŞART: varsayılan karşılaştırmada Ç/Ğ/İ/Ö/Ş/Ü
  //    latin harflerden SONRA gelir; "Çelik" listenin sonuna düşer.
  // ⚠️ Markası/modeli boş araç sona atılır — boş dize alfabetik olarak en
  //    başa gelir ve künyesiz araçlar listenin tepesini kaplardı.
  const trSirala = (x, y) => {
    const bos = s => !s || !String(s).trim()
    if (bos(x) !== bos(y)) return bos(x) ? 1 : -1
    return String(x || '').localeCompare(String(y || ''), 'tr', { sensitivity: 'base' })
  }
  tumVeri.sort((a, b) => (b._kilit ? 1 : 0) - (a._kilit ? 1 : 0)
    || trSirala(markaAd(a.marka), markaAd(b.marka))
    || trSirala(a.model, b.model)
    || trSirala(a.versiyon, b.versiyon))
  talepSayHesapla()
  secenekleriDoldur()
  ciz()

  // SİTE kapakları GELİNCE yamala. Liste çoktan ekranda; burada yalnız
  // fotoğrafsız araçların kapağı doluyor. Hiç eşleşme yoksa yeniden
  // çizmiyoruz — bedava DOM işi olurdu.
  siteKapakPs.then(siteMap => {
    if (!siteMap) return
    let degisen = 0
    for (const a of tumVeri) {
      // ⚠️ Alan `_kapak`. `_foto` BAŞKA BİR ŞEY: SBM görsel evrakı var mı
      //    diye bir boolean (nitele içinde `evr.has('SBM_GORSEL')`). İlk
      //    yazımda onu kullanmıştım — hem SBM'si olan araçları atlardı hem
      //    de boolean'ı URL'le ezip evrak rozetini bozardı.
      if (a._kapak || !a.plaka || elleKapak[a.id]) continue
      const u = siteMap[plakaNormal(a.plaka)]
      if (u) { a._kapak = u; degisen++ }
    }
    if (degisen) ciz()
  })
}

// SİTE (salt okunur) ilan fotoğrafları — plakaya göre ilk kapak.
// ⚠️ SİTE'ye DÜŞÜŞ: araç kartı fotoğrafları zaten iki kaynaktan topluyordu
//    (arac_fotograflari + SİTE araclar, plaka eşleşmesiyle) ama LİSTE yalnız
//    ilkine bakıyordu. Sonuç: eski DMS'ten gelen fotoğrafı olan araç kartta
//    fotoğraflı, stok listesinde fotoğrafsız görünüyordu (Göksenil,
//    10 Ağu 2026 · 34NPH109 — 20 fotoğrafı sitede, listede kapak yok).
// ⚠️ 370 KB iniyor (445 satır × ~880 karakterlik `fotolar` listesi) ama
//    her satırdan yalnız İLK url kullanılıyor. Bu yüzden kritik yolda
//    değil: liste onsuz çizilir, gelince kapaklar yamalanır.
// SİTE salt okunur; hata olursa liste yine çalışır, sadece kapak boş kalır.
async function siteKapaklariOku() {
  try {
    const { data, error } = await siteDb.from('araclar').select('plaka, fotolar')
    if (error) { console.warn('[stok] site kapak okunamadi', error); return null }
    const siteMap = {}
    for (const r of (data || [])) {
      const k = plakaNormal(r.plaka)
      if (k && r.fotolar && !siteMap[k]) siteMap[k] = String(r.fotolar).split(',')[0].trim()
    }
    return siteMap
  } catch (e) { console.warn('[stok] site kapak', e); return null }
}

// Araç satırını türetilmiş alanlarla zenginleştir
function nitele(a, fiyatMap, sksMap, fotoMap, minMap, indMap, etkMap, rezMap) {
  const evr = new Set((a.arac_evraklar || []).map(e => e.tip))
  return {
    ...a,
    _fiyat: fiyatMap[a.id] ?? null,
    _indirim: (indMap && indMap[a.id]) || null,
    _etiket: (etkMap && etkMap[a.id]) || null,
    _min: (minMap && minMap[a.id] != null) ? minMap[a.id] : null,
    _sks: sksMap[a.id] ?? null,
    _eks: (a.arac_ekspertiz || []).filter(e => e.durum && e.durum !== 'ORIJINAL').length,
    _eksPanel: Object.fromEntries((a.arac_ekspertiz || []).map(e => [e.parca_kodu, e.durum])),
    _eksListe: (a.arac_ekspertiz || []).filter(e => e.durum && e.durum !== 'ORIJINAL'),
    _tramerTutar: (a.arac_tramer || []).reduce((s2, t) => s2 + (Number(t.tutar) || 0), 0),
    _tramer: (a.arac_tramer || []).length,
    _ekspertizPdf: evr.has('EKSPERTIZ_PDF') || evr.has('EKSPERTIZ_LINK'),
    _ruhsat: evr.has('RUHSAT'),
    _foto: evr.has('SBM_GORSEL'),
    // fotoMap artık HAZIR URL tutuyor (DMS yüklemesi ya da SİTE ilan fotoğrafı) —
    // kapakUrl() burada TEKRAR uygulanmaz, yoksa site URL'i bucket yolu sanılır.
    _kapak: (fotoMap && fotoMap[a.id]) || null,
    // Kilitli mi? Durum HERKESE görünür; detay (kim/ne kadar) RLS'e tabi.
    _kilit: (a.durum === 'REZERVE' || a.durum === 'SIPARISTE') ? a.durum : null,
    _rez: (rezMap && rezMap[a.id]) || null,
  }
}

// CRM sinyalleri: eşleştirme için açık talepler + araç başına not sayısı (arac_notlari)
async function crmSinyalleriYukle() {
  try {
    const [talepR, notR] = await Promise.all([
      supabase.from('talepler').select('id, marka, model, butce_min, butce_max, model_yili_min, model_yili_max, gorusme_notlari(musteri_durumu, created_at)').limit(2000),
      supabase.from('arac_notlari').select('arac_id').limit(5000),
    ])
    if (talepR.error) throw talepR.error
    acikTalepler = (talepR.data || []).filter(t => {
      const son = (t.gorusme_notlari || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
      return !kapanisMi(son?.musteri_durumu)
    })
    notSay = {}
    for (const n of (notR.data || [])) if (n.arac_id) notSay[n.arac_id] = (notSay[n.arac_id] || 0) + 1
  } catch (e) { console.warn('CRM sinyalleri yüklenemedi:', e); acikTalepler = []; notSay = {} }
}

// Araç başına eşleşen açık talep sayısı (yalnız aktif araçlarda anlamlı)
function talepSayHesapla() {
  talepSay = {}
  for (const a of tumVeri) {
    if (!aktifMi(a)) { talepSay[a.id] = 0; continue }
    // eşleştirme çekirdeği {marka, model, yil, fiyat} okur
    talepSay[a.id] = uygunTalepler({ marka: a.marka, model: a.model, yil: a.yil, fiyat: a._fiyat }, acikTalepler).length
  }
}

function opt(sel, deger, list, hepsi) {
  const el = document.getElementById(sel); if (!el) return
  el.innerHTML = `<option value="">${hepsi}</option>` + list.map(v => `<option value="${kacis(v)}"${v === deger ? ' selected' : ''}>${kacis(v)}</option>`).join('')
}
// Marka filtresi — GÖSTERİLEN ADA GÖRE GRUPLANIR (Göksenil, 12 Ağu 2026).
//
// Stokta hem `FIAT` (5 araç) hem `TOFAS-FIAT` (23 araç) var; takma ad ikisini
// de FİAT gösterince filtrede noktalı/noktasız İ farkıyla ayrılan İKİ satır
// oluştu. Danışman "FIAT" seçince 23 aracı göremiyordu.
//
// ÇÖZÜM: seçenek değeri artık GÖSTERİLEN AD; filtre de `markaAd(a.marka)`
//   ile karşılaştırıyor. Tek "FİAT" satırı 28 aracın hepsini getirir.
//
// ⚠️ VERİYE DOKUNULMADI. `stok_araclar.marka` hâlâ TOFAS-FIAT — arabam
//    piyasa sözlüğü marka METNİYLE eşleşiyor (15 satır TOFAS-FIAT adına
//    kayıtlı) ve veri birleştirilseydi o araçların piyasa ölçümü düşerdi.
//    Ölçüldü, bu yüzden birleştirme YAPILMADI.
function optMarka(sel, deger, list, hepsi) {
  const el = document.getElementById(sel); if (!el) return
  const adlar = [...new Set(list.map(v => markaAd(v)).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'tr', { sensitivity: 'base' }))
  el.innerHTML = `<option value="">${hepsi}</option>`
    + adlar.map(v => `<option value="${kacis(v)}"${v === deger ? ' selected' : ''}>${kacis(v)}</option>`).join('')
}
function benzersiz(alan, on) {
  return [...new Set((on || tumVeri).map(a => a[alan]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'tr'))
}
function secenekleriDoldur() {
  optMarka('fMarka', f.marka, benzersiz('marka'), 'Tüm Markalar')
  modelSecenek()
  opt('fYil', f.yil, benzersiz('yil').sort((a, b) => b - a), 'Tüm Yıllar')
  opt('fYakit', f.yakit, benzersiz('yakit'), 'Tüm Yakıtlar')
  opt('fVites', f.vites, benzersiz('vites'), 'Tüm Vitesler')
}
function modelSecenek() {
  const kaynak = f.marka ? tumVeri.filter(a => markaAd(a.marka) === f.marka) : tumVeri
  opt('fModel', f.model, benzersiz('model', kaynak), 'Tüm Modeller')
}

function temizle() {
  Object.assign(f, { arama: '', marka: '', model: '', yil: '', yakit: '', vites: '', durum: 'aktif', kdv: '', fiyatMin: '', fiyatMax: '', kmMin: '', kmMax: '' })
  document.getElementById('arama').value = ''
  document.getElementById('fDurum').value = 'aktif'
  const kdvEl = document.getElementById('fKdv'); if (kdvEl) kdvEl.value = ''
  ;['fFiyatMin', 'fFiyatMax', 'fKmMin', 'fKmMax'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
  secenekleriDoldur()
  ciz()
}

const GIZLI = new Set(ARAC_LISTE_GIZLI)
function durumSuz(a) {
  if (f.durum === 'hepsi') return true
  // "Aktif Stok" = satılabilir liste. Siparişteki araç burada GÖRÜNMEZ (BR-0123),
  // REZERVE araç GÖRÜNÜR. İkisi de durum filtresinden seçilerek listelenebilir.
  if (f.durum === 'aktif') return aktifMi(a) && !GIZLI.has(a.durum)
  return a.durum === f.durum
}
function suz() {
  const fMin = paraSayi(f.fiyatMin), fMax = paraSayi(f.fiyatMax)
  const kMin = paraSayi(f.kmMin), kMax = paraSayi(f.kmMax)
  return tumVeri.filter(a => {
    if (!durumSuz(a)) return false
    if (f.marka && markaAd(a.marka) !== f.marka) return false
    if (f.model && a.model !== f.model) return false
    if (f.yil && String(a.yil) !== String(f.yil)) return false
    if (f.yakit && a.yakit !== f.yakit) return false
    if (f.vites && a.vites !== f.vites) return false
    if (f.kdv && (a.kdv_orani || 'BELLI_DEGIL') !== f.kdv) return false
    const fiyat = Number(a._fiyat) || 0
    if (fMin && fiyat < fMin) return false
    if (fMax && fiyat > fMax) return false
    const km = Number(a.km) || 0
    if (kMin && km < kMin * 1000) return false
    if (kMax && km > kMax * 1000) return false
    // Arama ESKİ PLAKAYI da kapsar: araç geri alındığında danışman eski
    // plakayı hatırlıyor olabilir (Göksenil, 5 Ağu 2026). Sigorta modülü
    // de aynı şeyi yapıyor (sql/36 arama_metni).
    if (f.arama && !trBuyuk([a.marka, a.model, a.versiyon, a.plaka, a.eski_plaka, a.yil].filter(Boolean).join(' ')).includes(f.arama)) return false
    return true
  })
}

function ciz() {
  kpiCiz()
  filtreOzetCiz()
  const hedef = document.getElementById('liste')
  const v = fiyataGoreSirala(suz())
  document.getElementById('sayac').textContent = `${v.length} araç`
  if (!v.length) { hedef.innerHTML = bosDurum('Bu filtrede araç yok.', 'directions_car'); return }
  hedef.innerHTML = gorunum === 'kart' ? kartlarCiz(v) : tabloCiz(v)
  if (gorunum === 'tablo') tabloTikla(hedef)
  // Fiyat başlığı her çizimde yeniden üretiliyor → dinleyici de yeniden bağlanır.
  // Döngü: yok → azdan çoğa → çoktan aza → yok (marka/model sırasına dönüş).
  document.getElementById('siraFiyat')?.addEventListener('click', () => {
    fiyatSira = fiyatSira === 'artan' ? 'azalan' : fiyatSira === 'azalan' ? null : 'artan'
    ciz()
  })
}

// ---------- G2: İNDİRİM ROZETİ ----------
// ⚠️ Referans fiyat BURADA HESAPLANMAZ. Mevzuat (6502 + Fiyat Etiketi
// Yönetmeliği) indirimden önceki fiyat olarak penceredeki EN DÜŞÜK UYGULANAN
// fiyatı istiyor; bu hesap sql/101 v_arac_indirim içinde, tek yerde.
// İstemcide "bir önceki fiyat" gibi bir kısayol yazmak yanıltıcı rozet üretir.
function indirimHtml(a) {
  const i = a._indirim
  if (!i || i.eski_fiyat == null) return ''
  return `<div class="flex items-center justify-end gap-1.5 mb-0.5">
      <span class="line-through text-on-surface-variant text-label-sm">${fmtPara(i.eski_fiyat)}</span>
      <span class="inline-block px-1.5 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] border border-[#10B981]/30 text-[10px] font-bold whitespace-nowrap">${fmtPara(i.indirim_tutari)} indirim</span>
    </div>`
}

// ---------- G2: CAM ETİKETİ GÜNCEL Mİ ----------
// Etiket/kasa fiyat uyuşmazlığında tüketici lehine fiyat uygulanır → camdaki
// etiket eskiyse bu bir RİSK. Yalnız etiket basabilenlere gösterilir; başkası
// için gürültü olurdu.
function etiketRozet(a) {
  if (!camEtiketiBasar(BEN)) return ''
  const e = a._etiket
  if (!e || e.durum === 'GUNCEL') return ''
  const eski = e.durum === 'ESKI'
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
    eski ? 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30' : 'bg-surface-container-high text-on-surface-variant border-outline-variant/40'
  }" title="${eski ? 'Fiyat değişti, camdaki etiket eski fiyatı gösteriyor' : 'Bu araç için cam etiketi hiç basılmadı'}">${
    mat(eski ? 'error' : 'print_disabled', 'text-[12px]')} ${eski ? 'Etiket eski' : 'Etiket yok'}</span>`
}

function fiyatHtml(a, buyuk) {
  // ⓘ — min satış fiyatı (danışmanın pazarlık tabanı). Yetkisi olmayanda
  // _min null gelir (view boş döner) → ikon hiç çizilmez.
  const info = a._min != null
    ? ` <button class="min-ac inline-flex align-middle text-on-surface-variant hover:text-primary" data-id="${a.id}" title="Minimum satış fiyatını gör">${mat('info', 'text-[15px]')}</button>`
    : ''
  if (a._fiyat != null) return `<div class="text-right">
      ${indirimHtml(a)}
      <div class="text-primary font-black ${buyuk ? 'text-title-lg' : ''}">${fmtPara(a._fiyat)}${info}</div>
    </div>`
  if (a.fiyatlama_durumu === 'BEKLIYOR') return `<div class="text-right text-amber-700 text-label-sm font-bold">Fiyat bekliyor</div>`
  return `<div class="text-right text-on-surface-variant text-label-sm">Fiyatsız</div>`
}

// ---------- REZERVE / SİPARİŞTE ROZETİ + HOVER BALONU ----------
// Göksenil: "rezerve etiketi olsun, üzerine geldiğimde mouse ile kimin
// rezervinde (hangi danışman) olduğunu, ne kadara anlaştığını yazsın."
// ⚠️ Rozet DURUMDAN çizilir (herkes görür). Balondaki danışman/tutar
//   `siparisler`den gelir ve RLS'e tabidir: satış danışmanı başkasının
//   rezerv detayını göremez → balon "detay yetkiniz yok" der, rozet kalır.
//   Aracın kilitli olduğunu HERKES görmeli, yoksa ikinci kez satılır.
function rezRozet(a) {
  if (!a._kilit) return ''
  const rezerve = a._kilit === 'REZERVE'
  const cls = rezerve ? 'bg-[#DCFCE7] text-[#166534] border-[#86EFAC]' : 'bg-orange-100 text-orange-800 border-orange-300'
  return `<span class="rez-rozet inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold cursor-help ${cls}" data-rez="${kacis(a.id)}">
    ${mat(rezerve ? 'bookmark' : 'shopping_cart', 'text-[13px]')} ${rezerve ? 'REZERVE' : 'SİPARİŞTE'}</span>`
}

function rezBalonAc(a, hedef) {
  document.getElementById('rezBalon')?.remove()
  const r = a._rez
  const rezerve = a._kilit === 'REZERVE'
  const dan = r ? danismanAdi(DMAP, r.danisman_id) : null
  const satir = (et, dg) => `<p class="text-[11px] opacity-75">${kacis(et)}</p><p class="text-body-md font-bold mb-1.5">${dg}</p>`
  let govde
  if (!r) {
    // RLS: bu kullanıcı sipariş satırını okuyamıyor
    govde = `<p class="text-[12px] opacity-85 leading-snug">Bu araç ${rezerve ? 'rezerve edilmiş' : 'siparişe alınmış'}.<br>Detayı görme yetkiniz yok — satış müdürüne sorun.</p>`
  } else {
    const kalan = r.gecerlilik_bitis ? Math.round((new Date(r.gecerlilik_bitis) - Date.now()) / 3600000) : null
    govde = satir(rezerve ? 'Rezerve eden' : 'Satış danışmanı', kacis(buyuk(dan || '—')))
      + satir('Anlaşılan fiyat', r.anlasilan_tutar ? fmtPara(r.anlasilan_tutar) : '—')
      + (Number(r.kapora_tutar) > 0 ? satir('Alınan kapora', fmtPara(r.kapora_tutar)) : '')
      + (rezerve && kalan != null ? `<p class="text-[11px] opacity-75 mt-1">${kalan > 0 ? `Bitişine ${kalan} saat` : 'Süresi doldu'}</p>` : '')
  }
  const el = document.createElement('div')
  el.id = 'rezBalon'
  el.className = 'fixed z-[95] bg-inverse-surface text-inverse-on-surface rounded-xl shadow-2xl px-4 py-3 max-w-[260px] pointer-events-none'
  el.innerHTML = `<p class="text-[10px] uppercase tracking-wide opacity-70 mb-1.5">${rezerve ? 'Rezervasyon' : 'Sipariş'}</p>${govde}`
  document.body.appendChild(el)
  const k = hedef.getBoundingClientRect()
  el.style.left = Math.max(8, Math.min(k.left, window.innerWidth - el.offsetWidth - 8)) + 'px'
  el.style.top = (k.bottom + 6 + el.offsetHeight > window.innerHeight ? k.top - el.offsetHeight - 6 : k.bottom + 6) + 'px'
}

// --- Kart kapak alanı: fotoğraf VEYA "henüz fotoğraf yok" kutusu ---
// Göksenil, 1 Ağu 2026: fotoğrafsız araçta sessiz bir araba ikonu yerine ne
// yapılacağını söyleyen bir kutu istendi. Düğme yalnız ilan yetkisi olanlarda
// (bilgi işlem + yönetici + master) — satış danışmanı görmez.
// ⚠️ Kart bir <a>; düğme tıklaması araç kartına GİTMEMELİ → dinleyicide
//   preventDefault + stopPropagation var (aşağıda, .foto-yukle).
function kapakAlaniHtml(a) {
  if (a._kapak) {
    return `<img src="${kacis(a._kapak)}" alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" onerror="this.remove()">`
  }
  // ⚠️ Marka/model henüz girilmemiş araçta düz birleştirme " · 35DD035" gibi
  //   baştan ayraçlı bir başlık üretiyordu (canlıda görüldü) — filtre şart.
  const ad = [[markaAd(a.marka), a.model].filter(Boolean).join(' '), aracEtiket(a)]
    .filter(Boolean).join(' · ') || 'Araç'
  return `<div class="absolute inset-0 flex flex-col items-center justify-center text-center px-4 gap-1">
    ${mat('no_photography', 'text-5xl text-on-surface-variant/25')}
    <p class="text-label-lg font-bold text-on-surface-variant mt-1">Henüz Fotoğraf Yok</p>
    <p class="text-[11px] text-on-surface-variant/70 leading-snug max-w-[240px]">Araç fotoğrafları yüklendiğinde burada görüntülenecek.</p>
    ${ilanYonetir(BEN) ? `<button type="button" class="foto-yukle mt-2 bg-primary text-on-primary px-3.5 py-1.5 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:opacity-90 shadow-sm"
        data-id="${kacis(a.id)}" data-ad="${kacis(ad)}">${mat('add_photo_alternate', 'text-[16px]')} Fotoğraf Yükle</button>` : ''}
  </div>`
}

// --- Kart görünümü (evrak/ekspertiz sinyalleri + durum + CRM) ---
function kartlarCiz(v) {
  return `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">${v.map(kart).join('')}</div>`
}
function kart(a) {
  const km = a.km ? Number(a.km).toLocaleString('tr-TR') + ' km' : '—'
  const tSay = talepSay[a.id] || 0
  const nSay = notSay[a.id] || 0
  const chip = t => `<span class="bg-surface-container text-on-surface-variant text-[11px] font-bold px-2 py-1 rounded-md">${kacis(t)}</span>`
  const sinyal = (ik, deger, etiket, vurgu) => `<div class="flex flex-col items-center gap-0.5"><span class="material-symbols-outlined text-[18px] ${vurgu ? 'text-primary' : 'text-on-surface-variant'}">${ik}</span><span class="text-label-sm font-bold ${vurgu ? 'text-primary' : 'text-on-surface'}">${deger}</span><span class="text-[10px] text-on-surface-variant">${etiket}</span></div>`
  const evrakDurum = (tamam, ik) => `<span class="material-symbols-outlined text-[16px] ${tamam ? 'text-green-600' : 'text-on-surface-variant/40'}" title="${ik}">${tamam ? 'check_circle' : 'radio_button_unchecked'}</span>`

  return `<a href="arac-kart.html?id=${encodeURIComponent(a.id)}" class="group bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-hidden flex flex-col hover:shadow-lg hover:border-primary/30 transition-all">
    <div class="relative aspect-[16/10] bg-surface-container overflow-hidden flex items-center justify-center">
      ${kapakAlaniHtml(a)}
      ${tSay > 0 ? `<div class="absolute bottom-2 right-2 bg-white/95 text-primary text-[11px] font-bold px-2.5 py-1 rounded-full shadow flex items-center gap-1">${mat('local_fire_department', 'text-[14px]')} ${tSay} müşteri</div>` : ''}
      ${aracEtiket(a) ? `<div class="absolute bottom-2 left-2 bg-black/70 text-white text-[11px] font-bold px-2 py-1 rounded tracking-wide">${kacis(aracEtiket(a))}</div>` : ''}
      ${a._kilit ? `<div class="absolute top-2 left-2">${rezRozet(a)}</div>` : ''}
    </div>
    <div class="p-lg flex-1 flex flex-col">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0"><h3 class="font-bold text-on-surface truncate">${kacis([markaAd(a.marka), a.model].filter(Boolean).join(' ')) || '—'}</h3>
          ${a.versiyon ? `<p class="text-label-sm text-on-surface-variant truncate">${kacis(a.versiyon)}</p>` : ''}</div>
        ${fiyatHtml(a, true)}
      </div>
      <div class="flex flex-wrap gap-1.5 mt-3">
        ${chip((a.yil || '—') + ' Model')}${chip(km)}${a.yakit ? chip([a.yakit, a.vites].filter(Boolean).join(' / ')) : ''}${a.renk ? chip(a.renk) : ''}
        ${a.kdv_orani && a.kdv_orani !== 'BELLI_DEGIL' ? `<span class="text-[11px] font-bold px-2 py-1 rounded-md ${KDV_RENK[a.kdv_orani] || ''}" title="Alış KDV">KDV ${kacis(kdvEtiket(a.kdv_orani))}</span>` : ''}
        ${etiketRozet(a)}
      </div>
      <div class="flex items-center gap-2 mt-3 text-on-surface-variant">
        ${evrakDurum(a._ekspertizPdf, 'Ekspertiz PDF')}
        ${evrakDurum(a._ruhsat, 'Ruhsat')}
        <button class="eksp-ac inline-flex items-center justify-center" data-id="${a.id}" title="Ekspertiz şeması (tıkla)">${mat('assignment_turned_in', 'text-[16px] ' + (a._eks > 0 ? 'text-amber-600' : 'text-green-600'))}</button>
        ${a._tramer > 0
      ? `<span class="material-symbols-outlined text-[16px] text-green-600" title="Tramer var">check_circle</span>`
      : `<span class="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 text-green-800" title="Tramer yok">TRAMERSİZ</span>`}
        <span class="text-[10px]">evrak</span>
      </div>
      <div class="mt-auto pt-4 flex items-center justify-between border-t border-outline-variant/60 mt-4">
        <div class="flex items-center gap-4">
          ${sinyal('local_fire_department', tSay, 'Talep', tSay > 0)}
          ${sinyal('sticky_note_2', nSay, 'Not', false)}
          <div class="flex flex-col items-center gap-0.5"><span class="material-symbols-outlined text-[18px] text-on-surface-variant">schedule</span><span class="text-label-sm font-bold text-on-surface">${stokGun(a) ?? '—'}</span><span class="text-[10px] text-on-surface-variant">gün</span></div>
        </div>
        <span class="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-label-sm font-bold flex items-center gap-1 group-hover:opacity-90">${mat('visibility', 'text-[16px]')} Detay</span>
      </div>
    </div>
  </a>`
}

// --- Tablo görünümü (yoğun) ---
// Alış KDV kolonu stok_araclar.kdv_orani'ndan gelir (sql/82). Değeri YALNIZ
// muhasebe (yetki: kdv_yonet) araç detayından değiştirir — burada salt-okur.
function tabloCiz(v) {
  const ekspIkon = a => `<button class="eksp-ac inline-flex items-center justify-center w-8 h-8 rounded-lg border border-outline-variant hover:bg-primary hover:text-white transition-all" data-id="${a.id}" title="Ekspertiz şeması">${mat('assignment_turned_in', 'text-[18px] ' + (a._eks > 0 ? 'text-amber-600' : 'text-green-600'))}</button>`
  // Boya/Tramer: hangi parça ne durumda — parça parça, kendi renginde
  const PARCA_KISA = { 'Ön Kaput': 'Kaput', 'Arka Kaput (Bagaj)': 'Bagaj', 'Ön Çamurluk Sol': 'Sol Ön Çmr.',
    'Ön Çamurluk Sağ': 'Sağ Ön Çmr.', 'Arka Çamurluk Sol': 'Sol Arka Çmr.', 'Arka Çamurluk Sağ': 'Sağ Arka Çmr.',
    'Ön Kapı Sol': 'Sol Ön Kapı', 'Ön Kapı Sağ': 'Sağ Ön Kapı', 'Arka Kapı Sol': 'Sol Arka Kapı',
    'Arka Kapı Sağ': 'Sağ Arka Kapı', 'Marşpiyel Sol': 'Sol Marşpiyel', 'Marşpiyel Sağ': 'Sağ Marşpiyel' }
  const DURUM_KISA = { BOYALI: 'boyalı', 'LOKAL BOYA': 'lokal boya', DEGISEN: 'değişen' }
  const orijTramer = a => {
    const rozet = []
    if (!a._eksListe || !a._eksListe.length) {
      rozet.push('<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">Orijinal</span>')
    } else {
      for (const e of a._eksListe) {
        const ad = PARCA_KISA[e.parca_kodu] || e.parca_kodu
        rozet.push(`<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style="background:${RENK[e.durum] || '#94a3b8'}${e.durum === 'LOKAL BOYA' ? ';color:#3b2b00' : ''}">${kacis(ad)} ${kacis(DURUM_KISA[e.durum] || e.durum)}</span>`)
      }
    }
    if (a._tramer === 0) rozet.push('<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">Tramersiz</span>')
    else if (a._tramerTutar) rozet.push(`<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">Tramer ${Number(a._tramerTutar).toLocaleString('tr-TR')} ₺</span>`)
    return rozet.join(' ')
  }
  // Vize (muayene) tarihi — geçmişse kırmızı, 30 günden azsa amber
  const vize = a => {
    if (!a.muayene_tarihi) return '<span class="text-on-surface-variant text-[11px]">—</span>'
    const kalan = Math.floor((new Date(a.muayene_tarihi) - Date.now()) / 86400000)
    const cls = kalan < 0 ? 'bg-red-100 text-red-800' : kalan <= 30 ? 'bg-amber-100 text-amber-800' : 'text-on-surface-variant'
    return `<span class="inline-block px-2 py-0.5 rounded text-[11px] font-bold ${cls}">${new Date(a.muayene_tarihi).toLocaleDateString('tr-TR')}</span>`
  }
  const satirlar = v.map(a => {
    const km = a.km ? Number(a.km).toLocaleString('tr-TR') + ' km' : '—'
    const tSay = talepSay[a.id] || 0, nSay = notSay[a.id] || 0
    const crm = `<div class="flex items-center gap-3 text-label-sm"><span class="inline-flex items-center gap-1 ${tSay > 0 ? 'text-primary font-bold' : 'text-on-surface-variant'}">${mat('local_fire_department', 'text-[16px]')} ${tSay}</span><span class="inline-flex items-center gap-1 text-on-surface-variant">${mat('sticky_note_2', 'text-[16px]')} ${nSay}</span></div>`
    const foto = a._kapak ? `<img src="${kacis(a._kapak)}" alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" onerror="this.remove()">` : mat('directions_car', 'text-[20px] opacity-30')
    return {
      git: `arac-kart.html?id=${encodeURIComponent(a.id)}`,
      // Göksenil: "liste görünümde araç satırı açık yeşil olsun"
      // ⚠️ Tailwind sınıfı zebra kuralını YENEMİYOR — tema.js'te özgüllüğü
      //   yeterli `.zebra-table tbody tr.rez-satir` kuralı var.
      sinif: a._kilit === 'REZERVE' ? 'rez-satir' : a._kilit === 'SIPARISTE' ? 'sip-satir' : '',
      hucreler: [
        `<div class="flex items-center gap-3"><div class="relative w-16 h-10 rounded overflow-hidden bg-surface-container shrink-0 flex items-center justify-center">${foto}</div><div class="min-w-0"><p class="font-bold text-on-surface flex items-center gap-1.5">${kacis([markaAd(a.marka), a.model].filter(Boolean).join(' ')) || '—'}${rezRozet(a)}</p><p class="text-[12px] text-on-surface-variant">${kacis(a.yil) || '—'} | ${km}${aracEtiket(a) ? ' · ' + kacis(aracEtiket(a)) : ''}</p></div></div>`,
        `<div class="text-[12px]"><span class="font-semibold text-on-surface">${kacis(buyuk(a.kasa_tipi || '—'))}</span><br><span class="text-on-surface-variant">${kacis(buyuk([a.yakit, a.vites].filter(Boolean).join(' / ')) || '—')}</span></div>`,
        `<div class="flex justify-center">${ekspIkon(a)}</div>`,
        crm,
        // Göksenil, 15 Ağu 2026: "liste görünümde Alış KDV bölümünde
        // 'etiket yok' yazısı var, bunu kaldıralım."
        // ⚠️ YALNIZ "Etiket yok" kalkıyor, "Etiket eski" KALIYOR.
        //    Ölçüm: aktif stoktaki 133 aracın 133'ü BASILMADI — her satırda
        //    çıkan rozet bilgi taşımaz, KDV kolonunu kalabalıklaştırır.
        //    "Etiket eski" ise gerçek risk: camdaki fiyat kasadakinden
        //    düşükse tüketici lehine o uygulanır (6502). Bugün hiç
        //    görünmüyor çünkü henüz hiç etiket basılmamış; basılmaya
        //    başlandığında görünmesi ŞART.
        //    Kart görünümü değişmedi (orada tek satırlık rozet şeridinde).
        `<div class="text-right">${kdvRozet(a)}${a._etiket?.durum === 'ESKI' && etiketRozet(a) ? '<div class="mt-1">' + etiketRozet(a) + '</div>' : ''}</div>`,
        fiyatHtml(a, false),
        `<div class="flex flex-wrap gap-1">${orijTramer(a) || '<span class="text-on-surface-variant text-[11px]">—</span>'}</div>`,
        `<div class="text-center">${vize(a)}</div>`,
        `<div class="text-right">${gunRozet(a)}</div>`,
        `<div class="flex justify-end"><a href="arac-kart.html?id=${encodeURIComponent(a.id)}" title="Detay" class="p-1.5 rounded-lg border border-outline-variant hover:bg-primary hover:text-white transition-all inline-flex">${mat('visibility', 'text-[18px]')}</a></div>`,
      ],
    }
  })
  // 'Fiyat' başlığı tıklanır (3. yuva yalnız tablo başlığında kullanılır;
  // mobil kart etiketi düz 'Fiyat' metnini görür — bkz. stitch-ui.js).
  return stitchTablo(['Araç', 'Kasa / Yakıt / Vites', 'Ekspertiz', 'CRM', ['Alış KDV', true], ['Fiyat', true, fiyatBaslikHtml()], 'Boya / Tramer', 'Vize', ['Stok Yaşı', true], ['', true]], satirlar)
}

// ---------- G2: TOPLU FİYAT DEĞİŞİMİ ----------
// Göksenil: "ikisi de — yüzde ve tutar."
// ⚠️ MİN SATIŞ FİYATI KORUNUR: yeni fiyat min'in altına inerse o araç
// UYGULANMAZ ve önizlemede kırmızı işaretlenir. Min fiyat altı satış yalnız
// satış müdürü onayıyla olur (E kararı) — toplu işlemle sessizce delinemez.
// ⚠️ Tek transaction'da N satır yazılıyor; hepsi AYNI now() damgasını alır.
// Güncel fiyatı 'sira' belirliyor (sql/100) — o sütun olmasaydı bu ekran
// "güncel fiyat" kavramını bozardı.
function topluFiyatEkrani(liste) {
  let tip = 'yuzde', deger = '', secili = new Set(liste.map(a => a.id))

  const hesapla = a => {
    const eski = Number(a._fiyat)
    const d = Number(String(deger).replace(',', '.'))
    if (!isFinite(d) || !d) return { eski, yeni: eski, fark: 0 }
    const yeni = tip === 'yuzde' ? Math.round(eski * (1 + d / 100)) : Math.round(eski + d)
    return { eski, yeni: Math.max(0, yeni), fark: Math.max(0, yeni) - eski }
  }
  // Min fiyatı bilinmeyen araçta engelleme YAPILMAZ (yetkisi olmayan kullanıcıda
  // _min null gelir); sunucu tarafı kural ayrı, burada yalnız görünür uyarı.
  const minAlti = (a, y) => a._min != null && y < Number(a._min)

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[88vh]">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('payments', 'text-[18px]')} Toplu Fiyat Değişimi</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="p-4 border-b border-outline-variant flex flex-wrap items-end gap-3">
        <div>
          <label class="block text-label-sm text-on-surface-variant mb-1">Değişim türü</label>
          <div class="inline-flex rounded-lg border border-outline-variant overflow-hidden">
            <button data-tip="yuzde" class="tf-tip px-3 py-1.5 text-body-sm font-bold bg-primary text-on-primary">Yüzde (%)</button>
            <button data-tip="tutar" class="tf-tip px-3 py-1.5 text-body-sm font-bold border-l border-outline-variant">Tutar (₺)</button>
          </div>
        </div>
        <div>
          <label class="block text-label-sm text-on-surface-variant mb-1">Değer <span class="text-on-surface-variant">(indirim için eksi)</span></label>
          <input id="tfDeger" type="text" inputmode="decimal" placeholder="-5" class="w-32 border border-outline-variant rounded-lg px-3 py-1.5 text-body-md bg-white" />
        </div>
        <div class="text-label-sm text-on-surface-variant" id="tfOzet"></div>
      </div>
      <div id="tfListe" class="overflow-y-auto p-1 flex-1"></div>
      <div class="p-4 border-t border-outline-variant flex items-center justify-between gap-2">
        <span id="tfUyari" class="text-label-sm text-error font-bold"></span>
        <div class="flex gap-2">
          <button data-kapat class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-semibold hover:bg-surface-container">Vazgeç</button>
          <button id="tfUygula" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-body-sm font-bold" disabled>Uygula</button>
        </div>
      </div>
    </div>`
  document.body.appendChild(ov)

  const listeEl = ov.querySelector('#tfListe'), ozetEl = ov.querySelector('#tfOzet')
  const uyariEl = ov.querySelector('#tfUyari'), btn = ov.querySelector('#tfUygula')

  function ciz() {
    let engel = 0, uygulanacak = 0
    listeEl.innerHTML = liste.map(a => {
      const h = hesapla(a), sec = secili.has(a.id), kotu = minAlti(a, h.yeni)
      if (sec && kotu) engel++
      else if (sec && h.fark !== 0) uygulanacak++
      return `<label class="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-container cursor-pointer border-b border-outline-variant/40 last:border-0 ${kotu ? 'bg-[#FEF2F2]' : ''}">
        <input type="checkbox" data-id="${a.id}" ${sec && !kotu ? 'checked' : ''} ${kotu ? 'disabled' : ''} class="w-4 h-4 accent-[#5f1818] shrink-0" />
        <span class="font-bold text-body-sm whitespace-nowrap">${kacis((aracEtiket(a) || '—'))}</span>
        <span class="text-body-sm truncate flex-1">${kacis(buyuk([markaAd(a.marka), a.model].filter(Boolean).join(' ')))}</span>
        <span class="text-label-sm text-on-surface-variant whitespace-nowrap">${fmtPara(h.eski)}</span>
        ${mat('arrow_forward', 'text-[14px] text-on-surface-variant')}
        <span class="text-label-sm font-bold whitespace-nowrap ${h.fark < 0 ? 'text-[#047857]' : h.fark > 0 ? 'text-[#B91C1C]' : 'text-on-surface-variant'}">${fmtPara(h.yeni)}</span>
        ${kotu ? '<span class="text-[10px] font-bold text-error whitespace-nowrap">MİN ALTI</span>' : ''}
      </label>`
    }).join('')
    ozetEl.textContent = `${liste.length} araç · ${uygulanacak} uygulanacak`
    uyariEl.textContent = engel ? `${engel} araç minimum satış fiyatının altına düştüğü için uygulanmayacak.` : ''
    btn.disabled = uygulanacak === 0
    btn.classList.toggle('opacity-40', uygulanacak === 0)
  }

  ov.querySelectorAll('.tf-tip').forEach(b => b.addEventListener('click', () => {
    tip = b.dataset.tip
    ov.querySelectorAll('.tf-tip').forEach(x => {
      const aktif = x.dataset.tip === tip
      x.classList.toggle('bg-primary', aktif)
      x.classList.toggle('text-on-primary', aktif)
    })
    ciz()
  }))
  ov.querySelector('#tfDeger').addEventListener('input', e => { deger = e.target.value; ciz() })
  listeEl.addEventListener('change', e => {
    const k = e.target.closest('input[data-id]'); if (!k) return
    k.checked ? secili.add(k.dataset.id) : secili.delete(k.dataset.id)
    ciz()
  })
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  document.addEventListener('keydown', esc)

  btn.addEventListener('click', async () => {
    const yazilacak = liste
      .filter(a => secili.has(a.id))
      .map(a => ({ a, h: hesapla(a) }))
      .filter(x => x.h.fark !== 0 && !minAlti(x.a, x.h.yeni))
    if (!yazilacak.length) return
    if (!confirm(`${yazilacak.length} aracın satış fiyatı değiştirilecek. Geçmişe yeni satır yazılır (geri alınmaz). Devam edilsin mi?`)) return
    btn.disabled = true; btn.textContent = 'Yazılıyor…'
    // Append-only: min fiyat KORUNUR (aynı değer tekrar yazılır), yalnız
    // satış fiyatı değişir.
    const satirlar = yazilacak.map(x => ({
      arac_id: x.a.id,
      satis_fiyati: x.h.yeni,
      min_satis_fiyati: x.a._min != null ? Number(x.a._min) : null,
      degistiren_danisman_id: BEN?.id || null,
    }))
    const { data, error } = await supabase.from('arac_fiyatlar').insert(satirlar).select('id')
    if (error) {
      dbHata('toplu fiyat', error)
      uyariEl.textContent = 'Yazılamadı: ' + error.message
      btn.disabled = false; btn.textContent = 'Uygula'; return
    }
    // §5.1 — PostgREST yetki yoksa 0 satır yazıp HATA VERMEZ.
    if (!data?.length) {
      uyariEl.textContent = 'Yazılamadı — fiyat değiştirme yetkiniz yok.'
      btn.disabled = false; btn.textContent = 'Uygula'; return
    }
    kapat()
    await yukle()
  })

  ciz()
}

// ---------- CAM ETİKETİ SEÇİM PENCERESİ ----------
// Göksenil: "toplu cam etiketi çıkartma senaryosunu nasıl yapacağız? şimdi
// ona basınca stokta 3 araç var 3'ünü de gösterdi."
// Eski davranış: filtredeki HER araç körlemesine yazdırılıyordu. 3 araçta
// sorun değil, 60 araçta 60 sayfa. Filtre bir seçim aracı değil; asıl istenen
// "şu üç aracın etiketi". Bu yüzden butona basınca ARADAKİ SEÇİM ADIMI açılır.
// Liste çizimine DOKUNULMADI (kart/tablo iki görünüm de aynı kaldı) —
// seçim tamamen bu pencerede, tek yerde.
function camEtiketSecim(liste) {
  const secili = new Set(liste.map(a => a.id))   // varsayılan: hepsi seçili
  const satir = a => `<label class="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-container cursor-pointer border-b border-outline-variant/40 last:border-0">
      <input type="checkbox" data-id="${a.id}" checked class="w-4 h-4 accent-[#5f1818] shrink-0" />
      <span class="font-bold text-body-sm whitespace-nowrap">${kacis((aracEtiket(a) || '—'))}</span>
      <span class="text-body-sm truncate flex-1">${kacis(buyuk([markaAd(a.marka), a.model].filter(Boolean).join(' ')))}</span>
      <span class="text-label-sm text-on-surface-variant whitespace-nowrap">${a.yil || ''}</span>
      <span class="text-label-sm font-semibold whitespace-nowrap">${a._fiyat != null ? fmtPara(a._fiyat) : '—'}</span>
    </label>`

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh]">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('print', 'text-[18px]')} Cam Etiketi — Araç Seçimi</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="px-4 py-2 border-b border-outline-variant flex items-center justify-between gap-2">
        <label class="flex items-center gap-2 text-body-sm cursor-pointer font-semibold">
          <input type="checkbox" id="ceHepsi" checked class="w-4 h-4 accent-[#5f1818]" /> Tümünü seç
        </label>
        <span class="text-label-sm text-on-surface-variant">Filtredeki ${liste.length} araç</span>
      </div>
      <div id="ceListe" class="overflow-y-auto p-1">${liste.map(satir).join('')}</div>
      <div class="p-4 border-t border-outline-variant flex items-center justify-end gap-2">
        <button data-kapat class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-semibold hover:bg-surface-container">Vazgeç</button>
        <button id="ceYazdir" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-body-sm font-bold">Yazdır (${liste.length})</button>
      </div>
    </div>`
  document.body.appendChild(ov)

  const btn = ov.querySelector('#ceYazdir')
  const hepsiKutu = ov.querySelector('#ceHepsi')
  const tazele = () => {
    btn.textContent = `Yazdır (${secili.size})`
    btn.disabled = secili.size === 0
    btn.classList.toggle('opacity-40', secili.size === 0)
    hepsiKutu.checked = secili.size === liste.length
    hepsiKutu.indeterminate = secili.size > 0 && secili.size < liste.length
  }
  ov.querySelector('#ceListe').addEventListener('change', e => {
    const k = e.target.closest('input[data-id]'); if (!k) return
    k.checked ? secili.add(k.dataset.id) : secili.delete(k.dataset.id)
    tazele()
  })
  hepsiKutu.addEventListener('change', e => {
    secili.clear()
    if (e.target.checked) liste.forEach(a => secili.add(a.id))
    ov.querySelectorAll('#ceListe input[data-id]').forEach(k => { k.checked = e.target.checked })
    tazele()
  })
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  document.addEventListener('keydown', esc)
  btn.addEventListener('click', () => {
    if (!secili.size) return
    // Liste sırasını koru — çıktı ekrandaki sırayla aynı olsun
    const idler = liste.filter(a => secili.has(a.id)).map(a => a.id)
    if (idler.length > 30 && !confirm(`${idler.length} araç için etiket açılacak. Devam edilsin mi?`)) return
    window.open('cam-etiketi.html?id=' + idler.join(','), '_blank')
    kapat()
  })
  tazele()
}

// Ekspertiz şeması küçük popup (kart + tablo ikonundan açılır)
async function ekspertizPopup(a) {
  const panel = Object.fromEntries(PARCALAR.map(p => [p, 'ORIJINAL']))
  for (const [k, val] of Object.entries(a._eksPanel || {})) if (panel[k] !== undefined && val) panel[k] = val
  const boyali = PARCALAR.filter(p => panel[p] !== 'ORIJINAL').length
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-md p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-primary flex items-center gap-2 min-w-0">${mat('assignment_turned_in', 'text-[18px]')}<span class="truncate">${kacis([markaAd(a.marka), a.model].filter(Boolean).join(' ') || 'Araç')} — Ekspertiz</span></h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center shrink-0">${mat('close', 'text-[18px]')}</button>
      </div>
      <div id="eksPopSvg" class="max-w-full mx-auto"></div>
      <div class="flex flex-wrap gap-2.5 justify-center text-[10px] mt-3">
        <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#c8c8c8;border-radius:3px;display:inline-block"></i>Orijinal</span>
        <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#03A9F4;border-radius:3px;display:inline-block"></i>Boyalı</span>
        <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#f3de1f;border-radius:3px;display:inline-block"></i>Lokal</span>
        <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#ff1100;border-radius:3px;display:inline-block"></i>Değişen</span>
      </div>
      <p class="text-center text-body-sm mt-2 ${boyali ? 'text-on-surface font-semibold' : 'text-green-700 font-semibold'}">${boyali ? boyali + ' boyalı/değişen parça' : 'Orijinal — boyalı/değişen parça yok'}</p>
    </div>`
  document.body.appendChild(ov)
  const svgKap = ov.querySelector('#eksPopSvg')
  svgKap.innerHTML = '<p class="text-center text-on-surface-variant text-sm py-6">Şema yükleniyor…</p>'
  const svgMetin = await eksSvgYukle()
  if (!svgKap.isConnected) return   // kullanıcı bu arada kapattıysa dokunma
  if (svgMetin) { svgKap.innerHTML = svgMetin; const svg = svgKap.querySelector('svg'); if (svg) svgBoya(svg, panel) }
  else svgKap.innerHTML = '<p class="text-center text-on-surface-variant text-sm py-6">Ekspertiz şeması yüklenemedi.</p>'
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  document.addEventListener('keydown', esc)
}

// F5 — KPI artık JS'te HESAPLANMAZ, v_kpi_stok'tan okunur (tek kaynak, .ai/22).
// Sebep: JS yalnız yüklenmiş 1000 satırı görüyordu; aynı KPI iki ekranda farklı
// çıkabiliyordu. View tüm tabloyu sayar, RLS çağıranın yetkisiyle uygulanır.
let KPI = null
async function kpiYukle() {
  const { data, error } = await supabase.from('v_kpi_stok').select('*').maybeSingle()
  if (error) { dbHata('v_kpi_stok', error); KPI = null; return }
  KPI = data || null
}
function kpiCiz() {
  // View okunamazsa (yetki/ağ) yüklenmiş veriden tahmin et — ekran boş kalmasın
  const aktif = KPI ? KPI.aktif_stok : tumVeri.filter(aktifMi).length
  const yayinda = KPI ? KPI.yayinda : tumVeri.filter(a => a.durum === 'YAYINDA').length
  const bekleyen = KPI ? KPI.bagli : tumVeri.filter(a => a.durum === 'REZERVE' || a.durum === 'SIPARISTE').length
  const ortYas = KPI && KPI.ort_stok_yasi != null ? KPI.ort_stok_yasi : '—'

  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('kpi').innerHTML =
    kart('inventory_2', 'bg-primary-fixed text-primary', 'Aktif Stok', aktif, 'envanterde') +
    kart('public', 'bg-green-100 text-green-700', 'Yayında', yayinda, 'sitede/ilanda') +
    kart('bookmark', 'bg-secondary/10 text-secondary', 'Rezerve / Siparişte', bekleyen, 'bağlanmış') +
    kart('schedule', 'bg-amber-100 text-amber-700', 'Ort. Stok Yaşı', ortYas + (ortYas === '—' ? '' : ' gün'),
      KPI && KPI.yaslanan_45 ? `${KPI.yaslanan_45} araç 45 günü geçti` : 'aktif araçlar')
}

// Minimum satış fiyatı balonu (ⓘ) — .ai/18: Owner · Satış Müdürü · Satış
// Danışmanı · Satın Alma · IT görür. Yetkisi olmayanda _min null gelir ve
// ikon zaten çizilmez (sunucu tarafı kapı: sql/99 v_arac_min_fiyat).
function minFiyatPopup(a, btn) {
  document.getElementById('minBalon')?.remove()
  const fark = (a._fiyat != null && a._min != null) ? Number(a._fiyat) - Number(a._min) : null
  const el = document.createElement('div')
  el.id = 'minBalon'
  el.className = 'fixed z-[90] bg-inverse-surface text-inverse-on-surface rounded-xl shadow-2xl px-4 py-3 text-left'
  el.innerHTML = `<p class="text-[10px] uppercase tracking-wide opacity-70">Minimum Satış Fiyatı</p>
    <p class="text-title-lg font-black">${fmtPara(a._min)}</p>
    ${fark != null ? `<p class="text-[11px] opacity-80 mt-0.5">Pazarlık payı: <b>${fmtPara(fark)}</b></p>` : ''}
    <p class="text-[10px] opacity-60 mt-1">Bu tutarın altına satış satış müdürü onayı ister.</p>`
  document.body.appendChild(el)
  const r = btn.getBoundingClientRect()
  el.style.left = Math.max(8, Math.min(r.left - 100, window.innerWidth - el.offsetWidth - 8)) + 'px'
  el.style.top = (r.bottom + 6) + 'px'
  const kapat = ev => { if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('click', kapat) } }
  setTimeout(() => document.addEventListener('click', kapat), 0)
}
