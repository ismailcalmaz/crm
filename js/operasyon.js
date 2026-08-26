// =====================================================================
// operasyon.js — OPERASYON MERKEZİ (F7-b): canlı pano + ısı haritası +
//   lokasyon kanban (sürükle-bırak) + araç drawer + bekleme analizi.
//
//   "Operasyon ekibi Excel okumuyor, iş yönetiyor. Müdür sabah geldiğinde
//    10 saniyede tüm operasyonu okuyabilmeli." (Göksenil)
//
//   Kanban sütunları ve SLA süreleri KODDA DEĞİL — Operasyon Tanımları
//   sayfasından yönetilir (operasyon_lokasyonlar). Araç taşıma sunucudaki
//   arac_lokasyon_tasi() ile yapılır; lokasyon geçmişi ASLA SİLİNMEZ.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, trBuyuk, buyuk, dbHata, fmtPara, fmtTarihKisa, danismanMap, danismanAdi } from './veri.js'
import { mat, bosDurum, uyari, binlikInputKur } from './stitch-ui.js'
import { mudurMu } from './yetki.js'

const KOK = () => document.getElementById('kok')
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none w-full'
const B = v => kacis(buyuk(v ?? ''))

let BEN = null, YAZAR = false, DMAP = {}
let LOK = [], KART = [], TED = [], BEKLEME = []
let ISLEM = [], EMIR = []   // işlem türleri · iş emirleri (F7-c)
let DRAWER = null           // açık araç kartı (kanban satırı)
let SEKME = 'pano'          // pano | isemri
let MUDUR = false           // operasyon müdürü mü (onay yetkisi)

const SLA_RENK = {
  KRITIK: { kart: 'border-error/50 bg-error/5', rozet: 'bg-error text-on-error', ikon: '🔴' },
  UYARI:  { kart: 'border-[#F59E0B]/50 bg-[#FFFBEB]', rozet: 'bg-[#F59E0B] text-white', ikon: '🟡' },
  NORMAL: { kart: 'border-outline-variant bg-surface-container-lowest', rozet: 'bg-surface-container-high text-on-surface-variant', ikon: '🟢' },
}

export async function operasyonKur(d) {
  BEN = d
  YAZAR = mudurMu(d, 'operasyon') || d?.rol === 'operasyon'
  MUDUR = mudurMu(d, 'operasyon')   // yalnız müdür ONAYLAR (finans kuyruğuna o düşürür)
  DMAP = await danismanMap()
  binlikInputKur()
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`
  await yukle()
}

async function yukle() {
  const [lok, kart, ted, bek, isl, emir] = await Promise.all([
    supabase.from('operasyon_lokasyonlar').select('*').eq('aktif', true).order('sira'),
    supabase.from('v_operasyon_kanban').select('*').order('lokasyon_sira').order('gecen_saat', { ascending: false }),
    supabase.from('operasyon_tedarikciler').select('id, ad, kategori').eq('aktif', true).order('ad'),
    supabase.from('v_operasyon_bekleme').select('*').order('ort_gun', { ascending: false }).limit(12),
    supabase.from('operasyon_islem_turleri').select('kod, ad, ic_hizmet, varsayilan_tutar').eq('aktif', true).eq('ic_hizmet', false).order('sira'),
    supabase.from('is_emirleri')
      .select('*, stok_araclar(plaka, marka, model), operasyon_tedarikciler(ad), operasyon_islem_turleri(ad)')
      .order('created_at', { ascending: false }).limit(150),
  ])
  if (lok.error) dbHata('operasyon_lokasyonlar', lok.error)
  if (kart.error) { dbHata('v_operasyon_kanban', kart.error); KOK().innerHTML = uyari('Kanban okunamadı: ' + kacis(kart.error.message)); return }
  if (isl.error) dbHata('islem turleri', isl.error)
  if (emir.error) dbHata('is_emirleri', emir.error)
  LOK = lok.data || []; KART = kart.data || []; TED = ted.data || []; BEKLEME = bek.data || []
  ISLEM = isl.data || []; EMIR = emir.data || []
  ciz()
}

// ---------------------------------------------------------------- ÇİZİM
function ciz() {
  const kritik = KART.filter(k => k.sla === 'KRITIK')
  const uyari = KART.filter(k => k.sla === 'UYARI')
  const parca = KART.filter(k => k.lokasyon === 'PARCA_BEKLIYOR')
  const bugun0 = new Date(); bugun0.setHours(0, 0, 0, 0)
  const bugunTamam = KART.filter(k => k.lokasyon === 'TAMAMLANDI' && new Date(k.giris_zamani) >= bugun0).length
  const ortSaat = KART.length ? Math.round(KART.reduce((s, k) => s + (k.gecen_saat || 0), 0) / KART.length) : 0
  const slaBasari = KART.length ? Math.round((KART.filter(k => k.sla === 'NORMAL').length / KART.length) * 100) : 100

  const kpi = (et, deger, alt, ik, renk) => `
    <div class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${et}</p>
        <p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p>
        <p class="text-[11px] text-on-surface-variant">${alt}</p></div></div>`

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <div><h2 class="text-headline-md text-primary font-bold">Operasyon Merkezi</h2>
        <p class="text-body-md text-on-surface-variant">Araç nerede · kimde · neden bekliyor · ne zamandır</p></div>
      <div class="flex items-center gap-2">
        <a href="operasyon-tanimlar.html" class="px-3 h-10 flex items-center gap-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low text-sm font-bold">${mat('tune', 'text-[18px]')} Tanımlar</a>
        <button id="opYenile" class="px-3 h-10 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low text-sm font-bold">Yenile</button>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
      ${kpi('Operasyondaki', KART.filter(k => k.lokasyon !== 'TAMAMLANDI').length, 'araç', 'build', 'bg-primary-fixed text-primary')}
      ${kpi('Geciken', kritik.length, 'SLA aşıldı', 'error', 'bg-red-100 text-red-700')}
      ${kpi('Parça Bekleyen', parca.length, 'araç', 'inventory', 'bg-amber-100 text-amber-700')}
      ${kpi('Bugün Tamamlanan', bugunTamam, 'araç', 'task_alt', 'bg-green-100 text-green-700')}
      ${kpi('Ortalama Süre', (ortSaat / 24).toFixed(1), 'gün', 'schedule', 'bg-blue-100 text-blue-700')}
      ${kpi('SLA Başarı', '%' + slaBasari, 'zamanında', 'verified', 'bg-secondary/10 text-secondary')}
    </div>

    <div class="flex items-center gap-1 overflow-x-auto border-b border-outline-variant mb-4">
      ${sekmeBtn('pano', 'Canlı Pano', 'dashboard', KART.filter(k => k.lokasyon !== 'TAMAMLANDI').length)}
      ${sekmeBtn('isemri', 'İş Emirleri', 'assignment', EMIR.filter(e => e.is_durumu !== 'IPTAL').length)}
    </div>

    ${SEKME === 'pano' ? `
      ${isiHaritasi()}
      ${(kritik.length || uyari.length) ? mudahaleKuyrugu(kritik, uyari) : ''}
      ${kanbanHtml()}
      ${beklemeAnaliziHtml()}
    ` : isEmriHtml()}
    ${DRAWER ? drawerHtml() : ''}`

  bagla()
}

function sekmeBtn(k, ad, ik, adet) {
  return `<button data-sekme="${k}" class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${SEKME === k ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}">${mat(ik, 'text-[18px]')}${ad}<span class="ml-1 bg-surface-container-high text-on-surface-variant text-[10px] px-1.5 rounded-full">${adet}</span></button>`
}

// Isı haritası — sayıları okumadan darboğazı gör
function isiHaritasi() {
  const hucre = l => {
    const liste = KART.filter(k => k.lokasyon === l.kod)
    const kritik = liste.filter(k => k.sla === 'KRITIK').length
    const uyari = liste.filter(k => k.sla === 'UYARI').length
    const isi = kritik ? '🔴' : uyari ? '🟠' : liste.length >= 5 ? '🟡' : '🟢'
    return `<div class="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest">
      <span class="text-[15px]">${isi}</span>
      <span class="text-body-sm font-semibold text-on-surface truncate">${kacis(l.ad)}</span>
      <span class="ml-auto text-body-sm font-black ${kritik ? 'text-error' : 'text-on-surface'}">${liste.length}</span>
    </div>`
  }
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4 mb-4">
    <h3 class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2.5">Operasyon Yoğunluk Haritası</h3>
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">${LOK.map(hucre).join('')}</div>
    <p class="text-[11px] text-on-surface-variant mt-2">🟢 normal · 🟡 yoğun · 🟠 SLA riski · 🔴 müdahale gerekli</p>
  </div>`
}

function mudahaleKuyrugu(kritik, uyari) {
  const satir = k => `<button data-kart="${k.id}" class="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border ${SLA_RENK[k.sla].kart} hover:border-primary/40 transition-colors">
      <span>${SLA_RENK[k.sla].ikon}</span>
      <b class="text-primary">${B(k.plaka)}</b>
      <span class="text-body-sm text-on-surface-variant truncate">${kacis(k.lokasyon_ad)}${k.bekleme_sebebi ? ' · ' + kacis(k.bekleme_sebebi) : ''}</span>
      <span class="ml-auto text-body-sm font-bold shrink-0">${gunMetni(k.gecen_saat)}</span>
    </button>`
  return `<div class="bg-surface-container-lowest border border-error/30 rounded-xl custom-shadow p-4 mb-4">
    <h3 class="font-bold text-error flex items-center gap-2 mb-2.5">${mat('priority_high', 'text-[20px]')} Müdahale Gerekiyor (${kritik.length + uyari.length})</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">${[...kritik, ...uyari].slice(0, 10).map(satir).join('')}</div>
  </div>`
}

function gunMetni(saat) {
  if (saat == null) return '—'
  if (saat < 24) return `${saat} saat`
  const g = Math.floor(saat / 24)
  return `${g} gün`
}

// ---------------------------------------------------------------- KANBAN
function kanbanHtml() {
  const sutun = l => {
    const liste = KART.filter(k => k.lokasyon === l.kod)
    const kritik = liste.filter(k => k.sla === 'KRITIK').length
    return `<div class="flex flex-col min-w-0" data-sutun="${kacis(l.kod)}">
      <div class="flex items-center gap-2 px-3 py-2 rounded-t-xl border border-b-0 border-outline-variant bg-surface-container">
        <span class="w-2.5 h-2.5 rounded-full" style="background:${kacis(l.renk || '#94a3b8')}"></span>
        <span class="font-bold text-body-sm truncate">${kacis(l.ad)}</span>
        <span class="ml-auto text-[11px] font-bold ${kritik ? 'text-error' : 'text-on-surface-variant'}">${liste.length}</span>
      </div>
      ${/* Yükseklik 120 → 64: pano artık satır atlıyor, boş kolonlar dikeyde
            yer yiyordu (12 kolon × 120px = ekranın yarısı boşluk). */''}
      <div class="op-drop flex-1 min-h-[64px] p-2 space-y-2 border border-outline-variant rounded-b-xl bg-surface-container-low/30 transition-colors"
           data-lok="${kacis(l.kod)}">
        ${liste.map(kartHtml).join('') || `<p class="text-[11px] text-on-surface-variant text-center py-3">—</p>`}
      </div>
      ${l.kod === 'TESLIMAT_NOKTASI'
        ? `<p class="text-[10px] text-[#7C3AED] font-semibold mt-1 px-1 leading-snug">${mat('verified', 'text-[12px] align-middle')} Araç buraya çekilince <b>teslime hazır</b> sayılır ve satış dosyasındaki teslimat şartı yeşile döner. Yalnız siparişteki araçlar için geçerlidir.</p>`
        // Bu kolona araç OPERASYON DIŞINDAN düşer: danışman satış dosyasında
        // "Güncel İste"ye basınca (sql/151). Kolon aracın durumunu DEĞİŞTİRMEZ,
        // yalnız bekleme kuyruğudur — teslimat şartını hâlâ Teslimat Noktası açar.
        : l.kod === 'EKSPERTIZ_BEKLIYOR'
        ? `<p class="text-[10px] text-[#B45309] font-semibold mt-1 px-1 leading-snug">${mat('fact_check', 'text-[12px] align-middle')} Satış dosyasından <b>güncel kilometreli ekspertiz</b> istendi. Rapor gelince aracı <b>Teslimat Noktası</b>'na çekin.</p>`
        : l.hedef_saat ? `<p class="text-[10px] text-on-surface-variant mt-1 px-1">Hedef: ${l.hedef_saat} saat</p>` : ''}
    </div>`
  }
  // Göksenil (3 Ağu 2026): "burası sağa doğru kaydırmalı olmasın, kaportadan
  //   sonrası alta insin ki panelde görünmesi kolay olsun."
  //
  // ⚠️ Eskiden `overflow-x-auto` + sabit 260px kolonlardı: 12 lokasyon ekrana
  //   sığmıyor, son kolonlar (Teslimat Noktası dahil) görünmüyordu. Bu aynı
  //   zamanda SÜRÜKLEMEYİ de bozuyordu — HTML5 sürüklemesi kapsayıcıyı
  //   kendiliğinden kaydırmadığı için kartı görünmeyen kolona bırakmak
  //   imkânsızdı.
  //
  // auto-fill + minmax: kolon sayısını EKRAN belirler, ben sabitlemiyorum.
  //   Geniş ekranda 7-8, dizüstünde 5-6, tablette 2-3 kolon; kalanı alta iner.
  //   Sabit kolon sayısı yazsaydım başka ekranda yine taşardı.
  // Inline style bilerek: grid-template-columns arbitrary değeri Tailwind
  //   yapılandırmasına bağlı, burada garanti olsun.
  return `<div class="mb-4">
    <div class="flex items-center justify-between mb-2 gap-3">
      <h3 class="font-bold text-on-surface flex items-center gap-2">${mat('view_kanban', 'text-[20px] text-primary')} Lokasyon Panosu</h3>
      ${YAZAR ? `<span class="text-[11px] text-on-surface-variant text-right">Kartı sürükleyip bırakabilir ya da karttaki düğmeyle işaretleyebilirsin</span>` : ''}
    </div>
    <div class="grid gap-3 items-start" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${LOK.map(sutun).join('')}</div>
  </div>`
}

function kartHtml(k) {
  const s = SLA_RENK[k.sla] || SLA_RENK.NORMAL
  return `<div class="op-kart rounded-lg border p-2.5 cursor-pointer ${s.kart}" data-kart="${k.id}"
      ${YAZAR ? `draggable="true" data-arac="${k.arac_id}"` : ''}>
    <div class="flex items-center gap-1.5">
      <b class="text-primary text-body-sm">${B(k.plaka)}</b>
      <span class="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${s.rozet}">${gunMetni(k.gecen_saat)}</span>
    </div>
    <p class="text-[11px] text-on-surface-variant truncate">${k.yil ? k.yil + ' ' : ''}${B(k.marka)} ${B(k.model)}</p>
    ${k.bekleme_sebebi ? `<p class="text-[11px] text-on-surface mt-1 truncate">${mat('info', 'text-[12px] align-middle')} ${kacis(k.bekleme_sebebi)}</p>` : ''}
    ${k.beklenen_parca ? `<p class="text-[11px] text-[#B45309] mt-0.5 truncate">${kacis(k.beklenen_parca)}${k.termin_tarihi ? ' · ' + fmtTarihKisa(k.termin_tarihi) : ''}</p>` : ''}
    ${k.sorumlu_ad ? `<p class="text-[10px] text-on-surface-variant mt-1">${B(k.sorumlu_ad)}</p>` : ''}
    ${teslimeHazirBtnHtml(k)}
  </div>`
}

// --- "Teslime Hazır" tek tık onayı ----------------------------------------
// Göksenil (3 Ağu 2026): "Operasyon Teslime Hazır… bunu hâlâ onaylayamadım."
//
// ⚠️ BULGU: mekanizma çalışıyordu (kart Teslimat Noktası'na çekilince araç
//   TESLIME_HAZIR olup şart yeşile dönüyor — canlıda ölçüldü). Eksik olan
//   ONAY YOLUYDU. Elde yalnız iki yol vardı:
//     1. 12 kolonluk panoyu yatay kaydırıp kartı SON kolona sürüklemek
//        (HTML5 sürüklemesi kapsayıcıyı kendiliğinden kaydırmaz → pratikte
//         yapılamıyor),
//     2. kartı açıp 11 maddelik açılır listeden lokasyon seçip "Taşı".
//   İkisi de "onayla" hissi vermiyor. Artık kartın üstünde tek düğme var.
//
// Yalnız SİPARİŞTEKİ araçta çıkar: teslimat şartını açan trigger
// (teslimat_noktasi_durum_sync) da yalnız durum='SIPARISTE' iken çalışıyor.
// Diğer araçlarda düğmeyi göstermek "bastım ama olmadı" yaratırdı.
function teslimeHazirBtnHtml(k) {
  if (!YAZAR) return ''
  if (k.arac_durum === 'TESLIME_HAZIR') {
    return `<div class="mt-2 pt-2 border-t border-outline-variant/50 flex items-center gap-1 text-[11px] font-bold text-secondary">
      ${mat('check_circle', 'text-[14px]')} Teslime hazır
      <button data-teslimgeri="${k.arac_id}" class="ml-auto text-[10px] font-bold text-on-surface-variant underline hover:text-error">geri al</button>
    </div>`
  }
  if (k.arac_durum !== 'SIPARISTE') return ''
  return `<button data-teslimhazir="${k.arac_id}"
      class="mt-2 w-full py-1.5 rounded-lg bg-secondary text-on-primary text-[11px] font-bold flex items-center justify-center gap-1 hover:opacity-90">
      ${mat('verified', 'text-[14px]')} Teslime Hazır</button>`
}

// Kartın kendi sürüklemesi/tıklaması tetiklenmesin diye stopPropagation şart.
async function teslimeHazirIsaretle(aracId, geriAl) {
  // ⚠️ METİN sql/234'te DÜZELTİLDİ. Eskiden "şart yeniden kırmızıya döner"
  //   diyordu; operasyon bu işareti kaldırmanın satışı DURDURDUĞUNU sanıyordu.
  //   Şart artık ENGELLEMİYOR (Göksenil, 21 Ağu 2026) — danışman aracı teslime
  //   hazır işaretlenmese de dosyayı onaya gönderebiliyor. İşaret bir kapı
  //   değil, aracın fiziksel olarak hazır olduğunun kaydı.
  const soru = geriAl
    ? 'Araç teslimat noktasından geri alınsın mı? Satış dosyasındaki "Operasyon Teslime Hazır" işareti kalkar (satışı durdurmaz).'
    : 'Araç teslime hazır olarak işaretlensin mi? Satış dosyasındaki "Operasyon Teslime Hazır" şartı yeşile döner.'
  if (!confirm(soru)) return
  // Geri alma: aracı bir önceki bekleme kolonuna değil, HAZIRLIK'a değil —
  // açık hareketi kapatmak yetmez (kart panodan düşer). Ekspertiz bekleme
  // kolonuna geri koyuyoruz; trigger durumu SIPARISTE'ye çeviriyor.
  await lokasyonTasi(aracId, geriAl ? 'EKSPERTIZ_BEKLIYOR' : 'TESLIMAT_NOKTASI')
}

// ---------------------------------------------------------- BEKLEME ANALİZİ
function beklemeAnaliziHtml() {
  if (!BEKLEME.length) return ''
  const max = Math.max(...BEKLEME.map(b => Number(b.ort_gun) || 0), 1)
  const satir = b => `<div class="flex items-center gap-2 py-1.5">
    <span class="w-40 shrink-0 text-body-sm truncate">${kacis(b.lokasyon_ad)}${b.tedarikci_ad ? ' · ' + kacis(b.tedarikci_ad) : ''}</span>
    <div class="flex-1 h-2.5 rounded-full bg-surface-container overflow-hidden">
      <div class="h-full rounded-full bg-primary" style="width:${Math.round((Number(b.ort_gun) / max) * 100)}%"></div></div>
    <span class="w-20 shrink-0 text-right text-body-sm font-bold">${b.ort_gun} gün</span>
    <span class="w-16 shrink-0 text-right text-[11px] text-on-surface-variant">${b.islem_adedi} iş</span>
  </div>`
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
    <h3 class="font-bold text-on-surface flex items-center gap-2 mb-1">${mat('analytics', 'text-[20px] text-primary')} Bekleme Analizi</h3>
    <p class="text-[11px] text-on-surface-variant mb-2">Son 90 gün · ortalama bekleme süresi — en çok gecikme nerede/hangi firmada?</p>
    ${BEKLEME.map(satir).join('')}
  </div>`
}

// ------------------------------------------------------------- İŞ EMİRLERİ
// TAAHHÜT → GERÇEKLEŞEN → FATURA → ÖDENDİ. Operasyon müdürü onaylamadan
// finans GÖRMEZ; onay anında araç masraf defterine satır yazılır (sql/95).
const ASAMA = {
  TAAHHUT:     { ad: 'Taahhüt',     cls: 'bg-surface-container-high text-on-surface-variant', sira: 1 },
  GERCEKLESEN: { ad: 'Gerçekleşen', cls: 'bg-[#EFF6FF] text-[#1D4ED8]', sira: 2 },
  FATURA:      { ad: 'Fatura',      cls: 'bg-[#F5F3FF] text-[#6D28D9]', sira: 3 },
  ODENDI:      { ad: 'Ödendi',      cls: 'bg-[#ECFDF5] text-[#047857]', sira: 4 },
}
const FINANS_ET = {
  HAZIR_DEGIL: 'Operasyon onayı bekliyor', BEKLIYOR: 'Finans onayı bekliyor',
  ONAYLANDI: 'Finans onayladı', REDDEDILDI: 'Finans İADE ETTİ', ODENDI: 'Ödendi',
}

function isEmriHtml() {
  const acik = EMIR.filter(e => e.is_durumu !== 'IPTAL' && e.finans_durum !== 'ODENDI')
  const bekleyenOnay = EMIR.filter(e => !e.operasyon_onay_zamani && e.odenecek_tutar != null)
  const iade = EMIR.filter(e => e.finans_durum === 'REDDEDILDI')
  const toplamAcik = acik.reduce((s, e) => s + Number(e.odenecek_tutar || 0), 0)

  const satir = e => {
    const a = e.stok_araclar || {}
    const asama = ASAMA[e.maliyet_asamasi] || ASAMA.TAAHHUT
    const sapma = (e.gerceklesen_tutar != null && e.tahmini_tutar != null)
      ? Number(e.gerceklesen_tutar) - Number(e.tahmini_tutar) : null
    return `<details class="border ${e.finans_durum === 'REDDEDILDI' ? 'border-error/40 bg-error/5' : 'border-outline-variant'} rounded-xl p-3" data-emir="${e.id}">
      <summary class="cursor-pointer flex items-center gap-2 flex-wrap">
        <b class="text-primary">${B(a.plaka) || '—'}</b>
        <span class="text-body-sm font-semibold">${kacis(one(e.operasyon_islem_turleri)?.ad || e.islem_turu)}</span>
        <span class="text-[11px] text-on-surface-variant">${kacis(one(e.operasyon_tedarikciler)?.ad || '—')}</span>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${asama.cls}">${asama.ad}</span>
        <span class="ml-auto flex items-center gap-2">
          <b class="text-body-sm">${e.odenecek_tutar != null ? fmtPara(e.odenecek_tutar) : (e.tahmini_tutar != null ? '~' + fmtPara(e.tahmini_tutar) : '—')}</b>
          <span class="text-[10px] ${e.finans_durum === 'REDDEDILDI' ? 'text-error font-bold' : 'text-on-surface-variant'}">${kacis(FINANS_ET[e.finans_durum] || e.finans_durum)}</span>
        </span>
      </summary>

      <div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-body-sm">
        ${kutu('Taahhüt', e.tahmini_tutar != null ? fmtPara(e.tahmini_tutar) : '—')}
        ${kutu('Gerçekleşen', e.gerceklesen_tutar != null ? fmtPara(e.gerceklesen_tutar) : '—')}
        ${kutu('İskonto', e.iskonto ? fmtPara(e.iskonto) : '—')}
        ${kutu('Ödenecek', e.odenecek_tutar != null ? fmtPara(e.odenecek_tutar) : '—')}
      </div>
      ${sapma != null && sapma !== 0 ? `<p class="text-[11px] mt-1 ${sapma > 0 ? 'text-error' : 'text-green-700'} font-bold">
        Sapma: ${sapma > 0 ? '+' : ''}${fmtPara(sapma)} ${sapma > 0 ? '(tahmini aştı)' : '(tahminin altında)'}</p>` : ''}
      ${e.finans_notu ? `<p class="text-[11px] mt-2 p-2 rounded-lg bg-error-container text-on-error-container"><b>Finans notu:</b> ${kacis(e.finans_notu)}</p>` : ''}

      ${YAZAR && e.finans_durum !== 'ODENDI' ? `<div class="mt-3 pt-3 border-t border-outline-variant grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
        <label class="block"><span class="text-[10px] text-on-surface-variant">Gerçekleşen (₺)</span>
          <input data-alan="gerceklesen_tutar" value="${e.gerceklesen_tutar ?? ''}" type="number" class="${INP} mt-1" /></label>
        <label class="block"><span class="text-[10px] text-on-surface-variant">İskonto (₺)</span>
          <input data-alan="iskonto" value="${e.iskonto ?? 0}" type="number" class="${INP} mt-1" /></label>
        <label class="block"><span class="text-[10px] text-on-surface-variant">Fatura No</span>
          <input data-alan="fatura_no" value="${kacis(e.fatura_no || '')}" class="${INP} mt-1" /></label>
        <label class="block"><span class="text-[10px] text-on-surface-variant">Fatura Tutarı (₺)</span>
          <input data-alan="fatura_tutari" value="${e.fatura_tutari ?? ''}" type="number" class="${INP} mt-1" /></label>
        <div class="col-span-2 md:col-span-4 flex flex-wrap gap-2 justify-end">
          <button data-kaydet="${e.id}" class="px-4 h-9 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:bg-surface-container-low">Kaydet</button>
          ${!e.operasyon_onay_zamani && MUDUR
            ? `<button data-onay="${e.id}" class="px-4 h-9 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1.5">${mat('verified', 'text-[16px]')} Onayla → Finansa Gönder</button>`
            : e.operasyon_onay_zamani
              ? `<span class="text-[11px] text-on-surface-variant self-center">Onaylandı · ${fmtTarihKisa(e.operasyon_onay_zamani)}</span>`
              : `<span class="text-[11px] text-on-surface-variant self-center">Onayı operasyon müdürü verir</span>`}
        </div>
      </div>` : ''}
    </details>`
  }

  return `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      ${miniKpi('Açık İş Emri', acik.length, 'assignment')}
      ${miniKpi('Onay Bekleyen', bekleyenOnay.length, 'pending_actions')}
      ${miniKpi('Finans İadesi', iade.length, 'assignment_return', iade.length ? 'text-error' : '')}
      ${miniKpi('Açık Tutar', fmtPara(toplamAcik), 'payments')}
    </div>

    ${YAZAR ? `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4 mb-4">
      <h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('add_task', 'text-[20px] text-primary')} Yeni İş Emri</h3>
      <div class="flex flex-wrap items-end gap-2">
        <div class="min-w-[200px] flex-1">
          <label class="text-[10px] text-on-surface-variant">Araç (plaka ara)</label>
          <input id="ieArac" placeholder="Plaka…" autocomplete="off" class="${INP} mt-1" />
          <div id="ieSonuc" class="mt-1"></div>
        </div>
        <label class="block min-w-[160px]"><span class="text-[10px] text-on-surface-variant">İşlem *</span>
          <select id="ieIslem" class="${INP} mt-1"><option value="">Seçiniz…</option>${ISLEM.map(i => `<option value="${kacis(i.kod)}">${kacis(i.ad)}</option>`).join('')}</select></label>
        <label class="block min-w-[160px]"><span class="text-[10px] text-on-surface-variant">Tedarikçi</span>
          <select id="ieTed" class="${INP} mt-1"><option value="">—</option>${TED.map(t => `<option value="${t.id}">${kacis(t.ad)}</option>`).join('')}</select></label>
        <label class="block w-36"><span class="text-[10px] text-on-surface-variant">Tahmini (₺)</span>
          <input id="ieTahmini" type="number" placeholder="8000" class="${INP} mt-1" /></label>
        <label class="block flex-1 min-w-[160px]"><span class="text-[10px] text-on-surface-variant">Açıklama</span>
          <input id="ieAciklama" placeholder="ör. Arka tampon boya" class="${INP} mt-1" /></label>
        <button id="ieEkle" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1">${mat('add', 'text-[18px]')} Aç</button>
      </div>
      <div id="ieDurum" class="text-label-md mt-2"></div>
    </div>` : ''}

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
      <h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('receipt_long', 'text-[20px] text-primary')} İş Emirleri</h3>
      ${EMIR.length ? `<div class="space-y-2">${EMIR.map(satir).join('')}</div>` : bosDurum('Henüz iş emri yok.', 'assignment')}
      <p class="text-[11px] text-on-surface-variant mt-3">Maliyet zinciri: <b>Taahhüt</b> (tahmini) → <b>Gerçekleşen</b> → <b>Fatura</b> → <b>Ödendi</b>. Operasyon müdürü onaylamadan finans bu kaydı görmez; onay anında araç masraf defterine yazılır.</p>
    </div>`
}

const one = v => (Array.isArray(v) ? v[0] : v) || null
function miniKpi(et, deger, ik, renk = '') {
  return `<div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant flex items-center gap-2.5">
    ${mat(ik, 'text-[20px] text-on-surface-variant')}
    <div class="min-w-0"><p class="text-[10px] uppercase text-on-surface-variant">${et}</p>
      <p class="text-body-lg font-black ${renk || 'text-on-surface'}">${deger}</p></div></div>`
}

// ---------------------------------------------------------------- DRAWER
function drawerHtml() {
  const k = DRAWER
  const lokOps = LOK.filter(l => l.kod !== k.lokasyon)
    .map(l => `<option value="${kacis(l.kod)}">${kacis(l.ad)}</option>`).join('')
  const tedOps = TED.map(t => `<option value="${t.id}">${kacis(t.ad)}</option>`).join('')
  return `<div id="opDrawer" class="fixed inset-0 z-[70] flex justify-end">
    <div class="op-arka absolute inset-0 bg-black/40"></div>
    <aside class="relative w-[420px] max-w-[94vw] h-full bg-surface-container-lowest shadow-2xl border-l border-outline-variant flex flex-col">
      <div class="p-4 border-b border-outline-variant flex items-start gap-2">
        <div class="min-w-0">
          <h3 class="text-headline-sm font-black text-primary">${B(k.plaka)}</h3>
          <p class="text-body-sm text-on-surface-variant">${k.yil ? k.yil + ' ' : ''}${B(k.marka)} ${B(k.model)}</p>
        </div>
        <button class="op-kapat ml-auto w-9 h-9 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="flex-1 overflow-y-auto p-4 space-y-3">
        <div class="grid grid-cols-2 gap-3">
          ${kutu('Lokasyon', kacis(k.lokasyon_ad))}
          ${kutu('Geçen Süre', gunMetni(k.gecen_saat))}
          ${kutu('Sorumlu', B(k.sorumlu_ad) || '—')}
          ${kutu('Tedarikçi', kacis(k.tedarikci_ad || '—'))}
        </div>
        ${k.bekleme_sebebi ? `<div><p class="text-[11px] font-bold uppercase text-on-surface-variant">Bekleme Sebebi</p>
          <p class="text-body-sm bg-surface-container-low rounded-lg p-2.5 mt-1">${kacis(k.bekleme_sebebi)}</p></div>` : ''}
        ${k.beklenen_parca ? `<div><p class="text-[11px] font-bold uppercase text-on-surface-variant">Beklenen Parça</p>
          <p class="text-body-sm bg-[#FFFBEB] text-[#92400E] rounded-lg p-2.5 mt-1">${kacis(k.beklenen_parca)}${k.termin_tarihi ? ' · termin ' + fmtTarihKisa(k.termin_tarihi) : ''}</p></div>` : ''}

        <div id="opGecmis"><p class="text-body-sm text-on-surface-variant">Geçmiş yükleniyor…</p></div>

        ${/* Onay düğmesi lokasyon formunun ÜSTÜNDE: en sık yapılan iş bu,
              11 maddelik açılır listenin altına gömülmemeli. */''}
        ${YAZAR && k.arac_durum === 'SIPARISTE' ? `<div class="border-t border-outline-variant pt-3">
          <button data-teslimhazir="${k.arac_id}" class="w-full h-11 rounded-lg bg-secondary text-on-primary font-bold text-sm flex items-center justify-center gap-1.5 hover:opacity-90">
            ${mat('verified', 'text-[18px]')} Teslime Hazır İşaretle</button>
          <p class="text-[11px] text-on-surface-variant mt-1.5 leading-snug">Satış dosyasındaki <b>Operasyon Teslime Hazır</b> şartı yeşile döner.</p>
        </div>` : ''}
        ${YAZAR && k.arac_durum === 'TESLIME_HAZIR' ? `<div class="border-t border-outline-variant pt-3">
          <div class="w-full h-11 rounded-lg bg-secondary-container text-on-secondary-container font-bold text-sm flex items-center justify-center gap-1.5">
            ${mat('check_circle', 'text-[18px]')} Teslime hazır</div>
          <button data-teslimgeri="${k.arac_id}" class="w-full mt-1.5 text-[11px] font-bold text-on-surface-variant underline hover:text-error">Geri al</button>
        </div>` : ''}
        ${YAZAR ? `<div class="border-t border-outline-variant pt-3">
          <p class="text-[11px] font-bold uppercase text-on-surface-variant mb-2">Durumu Güncelle</p>
          <label class="text-[11px] text-on-surface-variant">Yeni lokasyon</label>
          <select id="opYeniLok" class="${INP} mt-1 mb-2"><option value="">Seçiniz…</option>${lokOps}</select>
          <label class="text-[11px] text-on-surface-variant">Tedarikçi (opsiyonel)</label>
          <select id="opTed" class="${INP} mt-1 mb-2"><option value="">—</option>${tedOps}</select>
          <input id="opSebep" placeholder="Bekleme sebebi (ör. Tampon Boya)" class="${INP} mb-2" />
          <div class="grid grid-cols-2 gap-2 mb-2">
            <input id="opParca" placeholder="Beklenen parça" class="${INP}" />
            <input id="opTermin" type="date" class="${INP}" />
          </div>
          <button id="opTasi" class="w-full h-11 rounded-lg bg-primary text-on-primary font-bold text-sm hover:opacity-90 flex items-center justify-center gap-1.5">${mat('move_down', 'text-[18px]')} Taşı</button>
        </div>` : ''}
      </div>
      <div class="p-3 border-t border-outline-variant">
        <a href="arac-kart.html?id=${encodeURIComponent(k.arac_id)}" class="w-full h-10 rounded-lg border border-outline-variant flex items-center justify-center gap-1.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container-low">${mat('open_in_new', 'text-[16px]')} Araç Kartını Aç</a>
      </div>
    </aside></div>`
}
function kutu(et, deger) {
  return `<div class="bg-surface-container-low rounded-lg p-2.5">
    <p class="text-[10px] uppercase tracking-wide text-on-surface-variant">${et}</p>
    <p class="text-body-sm font-bold text-on-surface">${deger}</p></div>`
}

async function gecmisYukle(aracId) {
  const { data, error } = await supabase.from('arac_lokasyon_hareketleri')
    .select('lokasyon, giris_zamani, cikis_zamani, bekleme_sebebi, sorumlu_id, operasyon_lokasyonlar(ad)')
    .eq('arac_id', aracId).order('giris_zamani', { ascending: false }).limit(30)
  const el = document.getElementById('opGecmis'); if (!el) return
  if (error) { dbHata('lokasyon geçmişi', error); el.innerHTML = uyari('Geçmiş okunamadı.'); return }
  const liste = data || []
  el.innerHTML = `<p class="text-[11px] font-bold uppercase text-on-surface-variant mb-2">Lokasyon Geçmişi (silinmez)</p>
    ${liste.length ? `<div class="space-y-0">${liste.map((h, i) => {
      const ad = (Array.isArray(h.operasyon_lokasyonlar) ? h.operasyon_lokasyonlar[0] : h.operasyon_lokasyonlar)?.ad || h.lokasyon
      const sure = Math.round((new Date(h.cikis_zamani || Date.now()) - new Date(h.giris_zamani)) / 3600000)
      return `<div class="flex gap-2.5">
        <div class="flex flex-col items-center">
          <span class="w-2.5 h-2.5 rounded-full ${h.cikis_zamani ? 'bg-outline-variant' : 'bg-primary'} shrink-0 mt-1.5"></span>
          ${i === liste.length - 1 ? '' : '<span class="w-px flex-1 bg-outline-variant my-0.5"></span>'}
        </div>
        <div class="pb-3 min-w-0">
          <p class="text-body-sm font-semibold">${kacis(ad)}${h.cikis_zamani ? '' : ' <span class="text-[10px] text-primary font-bold">ŞU AN</span>'}</p>
          <p class="text-[11px] text-on-surface-variant">${fmtTarihKisa(h.giris_zamani)} · ${gunMetni(sure)}${h.bekleme_sebebi ? ' · ' + kacis(h.bekleme_sebebi) : ''}</p>
        </div></div>`
    }).join('')}</div>` : '<p class="text-body-sm text-on-surface-variant">Kayıt yok.</p>'}`
}

// ---------------------------------------------------------------- OLAYLAR
function bagla() {
  document.getElementById('opYenile')?.addEventListener('click', yukle)
  document.querySelectorAll('[data-sekme]').forEach(b => b.addEventListener('click', () => { SEKME = b.dataset.sekme; DRAWER = null; ciz() }))

  // --- İş emri olayları ---
  document.querySelectorAll('[data-kaydet]').forEach(b => b.addEventListener('click', () => isEmriKaydet(b.dataset.kaydet, b.closest('[data-emir]'))))
  document.querySelectorAll('[data-onay]').forEach(b => b.addEventListener('click', () => isEmriOnayla(b.dataset.onay)))
  document.getElementById('ieEkle')?.addEventListener('click', isEmriAc)
  const ieArac = document.getElementById('ieArac')
  if (ieArac) {
    let z
    ieArac.addEventListener('input', e => {
      clearTimeout(z); ieSecilen = null
      const q = e.target.value.trim()
      if (q.length < 2) { document.getElementById('ieSonuc').innerHTML = ''; return }
      z = setTimeout(() => ieAracAra(q), 250)
    })
  }

  document.querySelectorAll('[data-kart]').forEach(el => el.addEventListener('click', () => {
    DRAWER = KART.find(k => k.id === el.dataset.kart) || null
    ciz()
    if (DRAWER) gecmisYukle(DRAWER.arac_id)
  }))
  document.querySelectorAll('.op-kapat, .op-arka').forEach(b => b.addEventListener('click', () => { DRAWER = null; ciz() }))
  document.getElementById('opTasi')?.addEventListener('click', tasi)

  // Tek tık onayı — kart tıklaması/sürüklemesi tetiklenmesin.
  document.querySelectorAll('[data-teslimhazir]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); teslimeHazirIsaretle(b.dataset.teslimhazir, false) }))
  document.querySelectorAll('[data-teslimgeri]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); teslimeHazirIsaretle(b.dataset.teslimgeri, true) }))

  if (!YAZAR) return
  // Sürükle-bırak: kartı başka sütuna bırak → arac_lokasyon_tasi()
  let suruklenen = null
  document.querySelectorAll('.op-kart[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => { suruklenen = el.dataset.arac; el.classList.add('opacity-50') })
    el.addEventListener('dragend', () => { suruklenen = null; el.classList.remove('opacity-50') })
  })
  document.querySelectorAll('.op-drop').forEach(z => {
    ;['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('bg-primary/5', 'border-primary') }))
    ;['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('bg-primary/5', 'border-primary') }))
    z.addEventListener('drop', async e => {
      e.preventDefault()
      if (!suruklenen) return
      await lokasyonTasi(suruklenen, z.dataset.lok)
    })
  })
}

async function lokasyonTasi(aracId, lokasyon, ekstra = {}) {
  const { error } = await supabase.rpc('arac_lokasyon_tasi', {
    p_arac: aracId, p_lokasyon: lokasyon,
    p_sorumlu: ekstra.sorumlu ?? null, p_tedarikci: ekstra.tedarikci ?? null,
    p_sebep: ekstra.sebep ?? null, p_parca: ekstra.parca ?? null,
    p_termin: ekstra.termin ?? null, p_not: ekstra.not ?? null,
  })
  if (error) { dbHata('lokasyon taşı', error); alert('Taşınamadı: ' + error.message); return }
  DRAWER = null
  await yukle()
}

async function tasi() {
  const lok = document.getElementById('opYeniLok').value
  if (!lok) { alert('Yeni lokasyon seçin.'); return }
  await lokasyonTasi(DRAWER.arac_id, lok, {
    tedarikci: document.getElementById('opTed').value || null,
    sebep: document.getElementById('opSebep').value.trim() || null,
    parca: document.getElementById('opParca').value.trim() || null,
    termin: document.getElementById('opTermin').value || null,
  })
}

// ------------------------------------------------------- İŞ EMRİ İŞLEMLERİ
let ieSecilen = null

function ieDurum(msg, hata = false) {
  const el = document.getElementById('ieDurum'); if (!el) return
  el.textContent = msg
  el.className = 'text-label-md mt-2 font-bold ' + (hata ? 'text-error' : 'text-secondary')
}

async function ieAracAra(q) {
  const { data, error } = await supabase.from('stok_araclar')
    .select('id, plaka, marka, model, yil').ilike('plaka', `%${q}%`)
    .neq('durum', 'TESLIM_EDILDI').limit(8)
  if (error) { dbHata('araç ara', error); return }
  const kutu = document.getElementById('ieSonuc'); if (!kutu) return
  kutu.innerHTML = (data || []).length
    ? data.map(a => `<button data-iearac="${a.id}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-primary/5 border border-outline-variant/50 mb-1">
        <b class="text-primary">${B(a.plaka)}</b> <span class="text-body-sm text-on-surface-variant">${a.yil || ''} ${B(a.marka)} ${B(a.model)}</span></button>`).join('')
    : '<div class="text-[11px] text-on-surface-variant px-2 py-1">Araç bulunamadı.</div>'
  kutu.querySelectorAll('[data-iearac]').forEach(b => b.addEventListener('click', () => {
    ieSecilen = data.find(x => x.id === b.dataset.iearac)
    document.getElementById('ieArac').value = (ieSecilen?.plaka || '').toLocaleUpperCase('tr')
    kutu.innerHTML = ''
  }))
}

async function isEmriAc() {
  if (!ieSecilen) return ieDurum('Önce araç seçin.', true)
  const islem = document.getElementById('ieIslem').value
  if (!islem) return ieDurum('İşlem türü seçin.', true)
  const tahmini = document.getElementById('ieTahmini').value
  const { error } = await supabase.from('is_emirleri').insert({
    arac_id: ieSecilen.id, islem_turu: islem,
    tedarikci_id: document.getElementById('ieTed').value || null,
    tahmini_tutar: tahmini ? Number(tahmini) : null,
    aciklama: document.getElementById('ieAciklama').value.trim() || null,
    sorumlu_id: BEN?.id || null, olusturan: BEN?.id || null,
  })
  if (error) { dbHata('iş emri aç', error); return ieDurum('Açılamadı: ' + error.message, true) }
  ieSecilen = null
  await yukle()
}

async function isEmriKaydet(id, kap) {
  const o = {}
  kap.querySelectorAll('[data-alan]').forEach(el => {
    const v = el.value.trim()
    o[el.dataset.alan] = el.type === 'number' ? (v === '' ? null : Number(v)) : (v || null)
  })
  // Fatura tutarı girildiyse tarihi de damgala (aşama FATURA'ya geçsin)
  if (o.fatura_tutari != null && !kap.dataset.faturaTarih) o.fatura_tarihi = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase.from('is_emirleri').update(o).eq('id', id).select('id')
  if (error) { dbHata('iş emri kaydet', error); alert('Kaydedilemedi: ' + error.message); return }
  if (!data?.length) { alert('Kaydedilemedi — yetki yok.'); return }
  await yukle()
}

async function isEmriOnayla(id) {
  if (!confirm('İş emri onaylansın mı?\n\nOnayladığında:\n• Araç masraf defterine yazılır (silinemez)\n• Finans ödeme kuyruğuna düşer')) return
  const { data, error } = await supabase.rpc('is_emri_onayla', { p_is_emri: id })
  if (error) { dbHata('iş emri onayla', error); alert('Onaylanamadı: ' + error.message); return }
  await yukle()
  alert(`✓ Onaylandı — ${data?.tutar ?? ''} ₺ masraf defterine yazıldı, finans kuyruğuna düştü.`)
}
