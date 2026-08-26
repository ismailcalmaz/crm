// =====================================================================
// kredi-parametre.js — Kredi Parametre Yönetimi (R6-2, Can'ın ekranı).
//   Banka bazlı hesaplama parametrelerini (AUTO/MANUEL) versiyonlu yayınlar.
//   Şema + RPC'ler sql/70-72'de canlı: kredi_bankalari, kredi_banka_parametreleri
//   (versiyonlu, IMMUTABLE — asla UPDATE edilmez, yalnız yeni versiyon açılır),
//   kredi_parametre_log (audit, SECURITY DEFINER trigger yazıyor),
//   kredi_net_hesapla (canlı önizleme RPC'si), kredi_parametre_yayinla (yeni
//   versiyon RPC'si — eskiyi atomik arşivler). Formül burada YAZILMAZ, RPC'ler
//   çağrılır (tek kaynak DB'de).
//   Erişim: yalnız master + 'kredi_parametre_yonet' yetkisi. RLS zaten kapalı
//   tutuyor (sql/70); burada da guard var ki sayfa hiç render olmasın.
//   NOT: bu sayfa henüz yetki.js SAYFALAR / nav'a bağlanmadı (ana oturum işi).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, fmtTarih, fmtTarihKisa, dbHata, danismanMap, danismanAdi, trBuyuk } from './veri.js'
import { mat, uyari, bosDurum, binlikInputKur } from './stitch-ui.js'

let benim = null
let danMap = {}
let bankalar = []          // kredi_bankalari satırları
let aktifParams = {}       // banka_kod -> yürürlükteki (gecerli_bitis null + durum aktif) parametre satırı
let seciliBanka = null
let versiyonlar = []       // seçili bankanın tüm versiyonları (versiyon desc)
let auditKayitlari = []    // seçili bankanın son log kayıtları
let secilenTip = 'MANUEL'  // form üstündeki AUTO/MANUEL segment
let taslak = {}            // formun İLK render değerleri (yürürlükteki parametreden)
let bantlar = []           // faiz bantları düzenleme dizisi [{vade_max, oran(%)}]
let onizlemeSonuc = null

const INP = 'w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-body-md font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all'

// --- Giriş noktası ------------------------------------------------------
export async function krediParametreKur(danisman) {
  benim = danisman
  const kok = document.getElementById('kok')
  const yetkili = !!(benim?.master_admin || (Array.isArray(benim?.yetkiler) && benim.yetkiler.includes('kredi_parametre_yonet')))
  if (!yetkili) { kok.innerHTML = uyari('Bu sayfaya yetkiniz yok.'); return }

  binlikInputKur()
  kok.innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`

  danMap = await danismanMap()
  const tamam = await verileriYukle()
  if (!tamam) { kok.innerHTML = uyari('Veriler okunamadı. Sayfayı yenileyip tekrar deneyin.'); return }

  if (bankalar.length) {
    // Açılışta hesap görünsün diye ilk AUTO bankayı seç (yoksa ilk banka).
    // MANUEL bankalarda önizleme "Elle giriş" der — bu doğru davranıştır.
    if (!seciliBanka || !bankalar.some(b => b.kod === seciliBanka)) {
      seciliBanka = (bankalar.find(b => aktifParams[b.kod]?.hesaplama_tipi === 'AUTO') || bankalar[0]).kod
    }
    await bankaDetayYukle(seciliBanka)
    taslakBaslat(seciliBanka)
  }
  ciz()
}

// --- Veri okuma -----------------------------------------------------------
async function verileriYukle() {
  const [{ data: b, error: e1 }, { data: p, error: e2 }] = await Promise.all([
    supabase.from('kredi_bankalari').select('kod, ad, aktif').order('ad'),
    supabase.from('kredi_banka_parametreleri').select('*').is('gecerli_bitis', null).eq('durum', 'aktif'),
  ])
  const hata1 = dbHata('kredi_bankalari oku', e1)
  const hata2 = dbHata('kredi_banka_parametreleri (yururlukte) oku', e2)
  if (hata1 || hata2) { bankalar = []; aktifParams = {}; return false }
  bankalar = b || []
  aktifParams = {}
  for (const row of (p || [])) aktifParams[row.banka_kod] = row
  return true
}

async function bankaDetayYukle(kod) {
  const [{ data: v, error: e1 }, { data: a, error: e2 }] = await Promise.all([
    supabase.from('kredi_banka_parametreleri').select('*').eq('banka_kod', kod).order('versiyon', { ascending: false }),
    supabase.from('kredi_parametre_log').select('*').eq('banka_kod', kod).order('created_at', { ascending: false }).limit(10),
  ])
  dbHata('versiyon gecmisi oku', e1)
  dbHata('audit log oku', e2)
  versiyonlar = v || []
  auditKayitlari = a || []
  onizlemeSonuc = null
}

// Formun ilk render değerlerini yürürlükteki parametreden kur (yoksa MANUEL varsayılan)
function taslakBaslat(kod) {
  const p = aktifParams[kod]
  secilenTip = p?.hesaplama_tipi || 'MANUEL'
  taslak = {
    kesinti_katsayisi: p?.kesinti_katsayisi ?? 1,
    sabit_ek: p?.sabit_ek ?? 0,
    yuzde_ek: p?.yuzde_ek ?? 0,
    carpan: p?.carpan ?? 1,
    dosya_masrafi: p?.dosya_masrafi ?? 0,
    yukari_yuvarla: p?.yukari_yuvarla ?? true,
    ozel_not: p?.ozel_not ?? '',
  }
  bantlar = (Array.isArray(p?.faiz_bantlari) && p.faiz_bantlari.length)
    ? p.faiz_bantlari.map(x => ({ vade_max: x.vade_max ?? '', oran: x.oran != null ? (Number(x.oran) * 100).toFixed(2) : '' }))
    : [{ vade_max: '', oran: '' }]
}

// =====================================================================
// ÇİZİM
// =====================================================================
function ciz() {
  const kok = document.getElementById('kok')
  const banka = bankalar.find(b => b.kod === seciliBanka)
  kok.innerHTML = `
    <div class="pb-28">
      <div class="mb-lg">
        <h2 class="text-headline-md text-primary">Kredi Parametre Yönetimi</h2>
        <p class="text-body-md text-on-surface-variant">Banka bazlı hesaplama formüllerini yönet. Her yayın yeni bir versiyon açar; eski versiyon donar, kayıtlı krediler kaymaz.</p>
      </div>
      ${kpiHtml()}
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-lg mt-lg items-start">
        <div class="lg:col-span-4 flex flex-col gap-sm">
          <div class="flex items-center justify-between px-1">
            <span class="text-title-md text-on-surface">Bankalar</span>
            <button type="button" id="bankaEkleBtn" class="text-primary text-label-sm font-bold hover:underline flex items-center gap-1">${mat('add', 'text-[16px]')} Banka Ekle</button>
          </div>
          <div class="flex flex-col gap-2">${bankalar.length ? bankalar.map(bankaSatiriHtml).join('') : bosDurum('Henüz banka tanımlı değil.', 'account_balance')}</div>
        </div>
        <div class="lg:col-span-8 flex flex-col gap-lg">
          ${banka ? [bankaHeaderHtml(banka), parametreKartiHtml(), onizlemeKartiHtml(), altGridHtml()].join('') : bosDurum('Soldan bir banka seçin.', 'account_balance')}
        </div>
      </div>
    </div>
    <div class="fixed bottom-0 left-0 md:left-[260px] right-0 bg-surface/95 backdrop-blur-xl border-t border-outline-variant p-md flex items-center justify-between gap-md z-40 flex-wrap">
      <span id="durumMetin" class="text-body-sm text-on-surface-variant flex items-center gap-2">&nbsp;</span>
      <div class="flex items-center gap-2 ml-auto">
        <button type="button" id="btnGeriAl" class="px-lg h-10 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:pointer-events-none" ${banka ? '' : 'disabled'}>Değişiklikleri Geri Al</button>
        <button type="button" id="btnYayinla" class="px-lg h-10 rounded-lg bg-primary text-on-primary text-label-md font-bold shadow-sm hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none" ${banka ? '' : 'disabled'}>${mat('publish', 'text-[18px]')} Yeni Versiyon Yayınla</button>
      </div>
    </div>`
  baglaOlaylar()
}

function kpiHtml() {
  const aktifBanka = bankalar.filter(b => b.aktif).length
  const paramList = Object.values(aktifParams)
  const autoSayisi = paramList.filter(p => p.hesaplama_tipi === 'AUTO').length
  const manuelSayisi = paramList.filter(p => p.hesaplama_tipi === 'MANUEL').length
  const sonTarih = paramList.reduce((max, p) => {
    const t = p.gecerli_baslangic || p.created_at
    return (!max || (t && t > max)) ? t : max
  }, null)
  const kart = (etiket, deger, ikon, renk, bg) => `
    <div class="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant custom-shadow flex items-center justify-between kart-hover">
      <div class="flex flex-col">
        <span class="text-[11px] uppercase tracking-wide text-on-surface-variant font-bold mb-1">${kacis(etiket)}</span>
        <span class="text-headline-md font-bold ${renk}">${kacis(deger)}</span>
      </div>
      <div class="w-11 h-11 rounded-full ${bg} flex items-center justify-center ${renk} shrink-0">${mat(ikon)}</div>
    </div>`
  return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-lg">
    ${kart('Aktif Banka', String(aktifBanka), 'account_balance', 'text-primary', 'bg-primary/10')}
    ${kart('AUTO Hesap', String(autoSayisi).padStart(2, '0'), 'bolt', 'text-secondary', 'bg-secondary/10')}
    ${kart('MANUEL Hesap', String(manuelSayisi).padStart(2, '0'), 'settings_accessibility', 'text-on-surface-variant', 'bg-surface-container-high')}
    ${kart('Son Güncelleme', sonTarih ? fmtTarihKisa(sonTarih) : '—', 'history_edu', 'text-primary', 'bg-primary/10')}
  </div>`
}

function bankaSatiriHtml(b) {
  const p = aktifParams[b.kod]
  const secili = b.kod === seciliBanka
  const rozet = !p
    ? `<span class="text-[10px] bg-error-container text-on-error-container px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter shrink-0">Parametre yok</span>`
    : p.hesaplama_tipi === 'AUTO'
      ? `<span class="text-[10px] bg-secondary text-on-secondary px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter shrink-0">Auto</span>`
      : `<span class="text-[10px] bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter shrink-0">Manuel</span>`
  const sonGuncelleme = p ? fmtTarihKisa(p.gecerli_baslangic || p.created_at) : '—'
  return `<div data-banka="${kacis(b.kod)}" class="tiklanir cursor-pointer transition-colors p-md rounded-xl flex items-center gap-3 ${secili ? 'bg-primary/5 border-l-4 border-primary shadow-sm' : 'bg-surface-container-lowest border border-outline-variant hover:bg-surface-container-low'}">
    <div class="w-11 h-11 rounded-lg flex items-center justify-center font-bold shrink-0 ${secili ? 'bg-primary text-on-primary' : 'bg-primary-fixed text-primary'}">${kacis((b.ad || '?').slice(0, 2).toUpperCase())}</div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2"><span class="text-title-md font-bold text-on-surface truncate">${kacis(b.ad)}</span>${rozet}</div>
      <p class="text-[11px] text-on-surface-variant truncate">Son güncelleme: ${sonGuncelleme}${b.aktif ? '' : ' · Pasif banka'}</p>
    </div>
    ${secili ? mat('chevron_right', 'text-primary shrink-0') : ''}
  </div>`
}

function bankaHeaderHtml(banka) {
  const p = aktifParams[seciliBanka]
  return `<section class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow p-lg flex flex-col md:flex-row md:items-center justify-between gap-md">
    <div class="flex items-center gap-lg min-w-0">
      <div class="w-14 h-14 rounded-xl bg-primary-fixed text-primary flex items-center justify-center font-bold text-title-lg shrink-0">${kacis((banka.ad || '?').slice(0, 2).toUpperCase())}</div>
      <div class="min-w-0">
        <h2 class="text-headline-sm font-bold text-on-surface truncate">${kacis(banka.ad)}</h2>
        <span class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Yürürlükteki Versiyon: <span class="text-primary">${p ? 'v' + p.versiyon : 'yok'}</span></span>
      </div>
    </div>
    <div class="inline-flex bg-surface-container-low rounded-lg p-1 gap-1 shrink-0">
      <button type="button" data-tip-btn="AUTO" class="px-4 py-1.5 rounded-md text-label-md font-bold transition-colors flex items-center gap-1.5 ${secilenTip === 'AUTO' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}">${mat('bolt', 'text-[16px]')} AUTO</button>
      <button type="button" data-tip-btn="MANUEL" class="px-4 py-1.5 rounded-md text-label-md font-bold transition-colors flex items-center gap-1.5 ${secilenTip === 'MANUEL' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}">${mat('settings_accessibility', 'text-[16px]')} MANUEL</button>
    </div>
  </section>`
}

function girdi(id, etiket, deger, sonek = '') {
  return `<div class="flex flex-col gap-1">
    <label for="${id}" class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${kacis(etiket)}</label>
    <div class="flex items-center gap-1">
      <input id="${id}" inputmode="decimal" value="${kacis(String(deger ?? ''))}" class="${INP}">
      ${sonek ? `<span class="text-on-surface-variant text-label-md shrink-0">${kacis(sonek)}</span>` : ''}
    </div>
  </div>`
}

function bantSatiriHtml(row, i) {
  return `<div class="flex items-center gap-2" data-bant-row="${i}">
    <input data-bant="vade" type="number" min="1" placeholder="kalan hepsi" value="${row.vade_max === '' || row.vade_max == null ? '' : kacis(String(row.vade_max))}" class="${INP} flex-1">
    <input data-bant="oran" inputmode="decimal" placeholder="örn. 3.71" value="${kacis(String(row.oran ?? ''))}" class="${INP} flex-1">
    <span class="text-on-surface-variant text-label-md shrink-0">%</span>
    <button type="button" data-bant-sil="${i}" class="w-9 h-9 shrink-0 rounded-lg hover:bg-error/10 text-error flex items-center justify-center" title="Satırı sil">${mat('delete', 'text-[16px]')}</button>
  </div>`
}

function parametreKartiHtml() {
  const kapali = secilenTip === 'MANUEL'
  return `<section class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow p-lg">
    <h3 class="text-title-md text-primary flex items-center gap-2 mb-lg">${mat('analytics', 'text-[20px]')} Hesaplama Parametreleri</h3>
    <div id="autoAlanlar" class="${kapali ? 'opacity-40 pointer-events-none' : ''} transition-opacity">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-lg">
        ${girdi('kesinti', 'Kesinti Katsayısı', taslak.kesinti_katsayisi)}
        ${girdi('sabitEk', 'Sabit Ek Masraf', taslak.sabit_ek, '₺')}
        ${girdi('yuzdeEk', 'Yüzde Ek', taslak.yuzde_ek)}
        ${girdi('carpan', 'Çarpan', taslak.carpan, '×')}
        ${girdi('dosyaMasrafi', 'Dosya Masrafı', taslak.dosya_masrafi, '₺')}
        <div class="flex flex-col gap-1">
          <span class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Yukarı Yuvarla</span>
          <label class="flex items-center gap-2 h-[42px]">
            <input id="yukariYuvarla" type="checkbox" ${taslak.yukari_yuvarla ? 'checked' : ''} class="w-5 h-5 rounded border-outline-variant text-primary focus:ring-primary/30">
            <span class="text-body-sm text-on-surface-variant">Çekilecek krediyi tam sayıya yuvarla</span>
          </label>
        </div>
      </div>
      <div class="mt-lg">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Faiz Bantları (kademeli vade/oran)</span>
          <button type="button" id="bantEkle" class="text-primary text-label-sm font-bold hover:underline flex items-center gap-1">${mat('add', 'text-[16px]')} Satır Ekle</button>
        </div>
        <div class="flex items-center gap-2 text-[10px] uppercase tracking-wide text-on-surface-variant mb-1 px-1">
          <span class="flex-1">Vade ≤ (ay, boş = kalan hepsi)</span><span class="flex-1">Oran (%)</span><span class="w-9"></span>
        </div>
        <div id="bantSatirlari" class="space-y-2">${bantlar.map(bantSatiriHtml).join('')}</div>
      </div>
    </div>
    <div class="mt-lg flex flex-col gap-1">
      <label for="ozelNot" class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Özel Not</label>
      <textarea id="ozelNot" rows="2" class="${INP} resize-none" placeholder="Örn. Kampanya kodu, geçerlilik koşulu…">${kacis(taslak.ozel_not || '')}</textarea>
    </div>
  </section>`
}

function onizlemeKartiHtml() {
  return `<section class="bg-on-background text-white rounded-xl shadow-xl p-lg relative overflow-hidden">
    <div class="absolute top-0 right-0 w-64 h-64 bg-primary/30 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none"></div>
    <div class="relative z-10">
      <div class="flex items-center justify-between mb-lg flex-wrap gap-2">
        <h3 class="text-title-md text-white/70">Canlı Hesap Önizleme</h3>
        <span class="text-[11px] text-white/40 text-right">Yürürlükteki KAYITLI versiyonu hesaplar — yayınlayınca güncellenir</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-md items-end mb-lg">
        <div class="flex flex-col gap-1">
          <label for="onzNet" class="text-[11px] uppercase tracking-wide text-white/50">İstenen Net (₺)</label>
          <input id="onzNet" class="para-gir bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-body-md text-white placeholder-white/30 focus:ring-2 focus:ring-white/30 outline-none" placeholder="1.000.000" inputmode="numeric">
        </div>
        <div class="flex flex-col gap-1">
          <label for="onzVade" class="text-[11px] uppercase tracking-wide text-white/50">Vade (ay)</label>
          <input id="onzVade" type="number" min="1" class="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-body-md text-white placeholder-white/30 focus:ring-2 focus:ring-white/30 outline-none" placeholder="36">
        </div>
        <button type="button" id="onzHesapla" class="bg-white/10 hover:bg-white/20 text-white rounded-lg px-4 py-2 text-label-md font-bold flex items-center justify-center gap-2 transition-colors">${mat('refresh', 'text-[18px]')} Yeniden Hesapla</button>
      </div>
      <div id="onzSonuc">${onizlemeSonucRenderHtml(onizlemeSonuc, null)}</div>
    </div>
  </section>`
}

function onizlemeSonucRenderHtml(sonuc, hata) {
  if (hata) return `<div class="text-red-300 text-body-sm flex items-center gap-2">${mat('error', 'text-[18px]')} ${kacis(hata)}</div>`
  if (!sonuc) return `<span class="text-white/40 text-body-sm">İstenen net tutarı girip hesaplayın.</span>`
  if (!sonuc.hesaplama_tipi) return `<div class="text-amber-300 text-body-sm flex items-center gap-2">${mat('warning', 'text-[18px]')} ${kacis(sonuc.uyari || 'Yürürlükte parametre yok.')}</div>`
  if (sonuc.manuel) return `<div class="text-amber-200 text-body-sm flex items-center gap-2">${mat('info', 'text-[18px]')} ${kacis(sonuc.uyari || 'Elle giriş — bu banka manuel hesaplanıyor.')}</div>`
  const alan = (etiket, deger) => `<div><span class="text-[11px] uppercase tracking-wide text-white/40 block">${etiket}</span><span class="text-title-md font-bold">${deger}</span></div>`
  return `
    <div class="grid grid-cols-2 md:grid-cols-3 gap-md mb-md">
      ${alan('Çekilecek Kredi', fmtPara(sonuc.cekilecek_kredi))}
      ${alan('Net Geçen', fmtPara(sonuc.net_gecen))}
      ${alan('Kesinti', fmtPara(sonuc.kesinti))}
      ${alan('Dosya Masrafı', fmtPara(sonuc.dosya_masrafi))}
      ${alan('Aylık Taksit', sonuc.taksit != null ? fmtPara(Math.round(sonuc.taksit)) : '—')}
      ${alan('Efektif Faiz', sonuc.faiz_efektif != null ? '%' + (Number(sonuc.faiz_efektif) * 100).toFixed(2) : '—')}
    </div>
    ${sonuc.uyari ? `<div class="text-white/50 text-[11px] pt-2 border-t border-white/10">${kacis(sonuc.uyari)}</div>` : ''}`
}

const ALAN_ETIKET = {
  hesaplama_tipi: 'Hesaplama Tipi', kesinti_katsayisi: 'Kesinti Katsayısı', sabit_ek: 'Sabit Ek',
  yuzde_ek: 'Yüzde Ek', carpan: 'Çarpan', dosya_masrafi: 'Dosya Masrafı',
  yukari_yuvarla: 'Yukarı Yuvarla', ozel_not: 'Özel Not', faiz_bantlari: 'Faiz Bantları', durum: 'Durum',
}
function auditIslemEtiket(islem) {
  return islem === 'YENI_VERSIYON' ? 'Yeni versiyon' : islem === 'GUNCELLEME' ? 'Güncelleme' : (islem || '—')
}
function auditFarkHtml(eski, yeni) {
  if (!eski || !yeni) return ''
  const degisen = Object.keys(ALAN_ETIKET).filter(k => JSON.stringify(eski[k]) !== JSON.stringify(yeni[k]))
  if (!degisen.length) return ''
  return `<div class="mt-1 space-y-0.5">${degisen.map(k =>
    `<div class="text-[11px] flex gap-1 flex-wrap"><span class="text-on-surface-variant shrink-0">${kacis(ALAN_ETIKET[k])}:</span>
      <span class="text-error line-through">${kacis(String(eski[k] ?? '—'))}</span>
      <span class="text-on-surface-variant">→</span>
      <span class="text-secondary font-bold">${kacis(String(yeni[k] ?? '—'))}</span></div>`).join('')}</div>`
}

function versiyonGecmisiHtml() {
  if (!versiyonlar.length) return bosDurum('Bu banka için henüz versiyon yok.', 'history')
  return `<div class="space-y-md">${versiyonlar.map(v => {
    const yururlukte = v.durum === 'aktif' && !v.gecerli_bitis
    return `<div class="flex items-start gap-md ${yururlukte ? '' : 'ml-1 pl-4 border-l border-outline-variant'}">
      ${yururlukte ? `<div class="w-2 h-2 rounded-full bg-primary mt-2 ring-4 ring-primary/10 shrink-0"></div>` : ''}
      <div class="flex-1 min-w-0">
        <div class="flex justify-between items-start gap-2 flex-wrap">
          <span class="text-title-md font-bold text-on-surface">v${v.versiyon} ${yururlukte ? '<span class="text-[11px] font-normal text-on-surface-variant">(Yürürlükte)</span>' : `<span class="text-[11px] font-normal text-on-surface-variant">(${kacis(v.durum)})</span>`}</span>
          <span class="text-[11px] text-on-surface-variant whitespace-nowrap">${fmtTarih(v.gecerli_baslangic || v.created_at)}</span>
        </div>
        <p class="text-body-sm text-on-surface-variant">${v.hesaplama_tipi === 'AUTO' ? 'AUTO hesap' : 'Manuel giriş'} · ${kacis(danismanAdi(danMap, v.olusturan))}</p>
        ${!yururlukte ? `<button type="button" data-geri-yukle="${v.versiyon}" class="text-primary text-[11px] font-bold mt-1 hover:underline">Bu versiyonu geri yükle</button>` : ''}
      </div>
    </div>`
  }).join('')}</div>`
}

function auditHtml() {
  if (!auditKayitlari.length) return bosDurum('Henüz değişiklik kaydı yok.', 'history_edu')
  return `<div class="divide-y divide-outline-variant">${auditKayitlari.map(a => `
    <div class="py-3 first:pt-0 last:pb-0">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span class="text-label-md font-bold text-on-surface">${kacis(auditIslemEtiket(a.islem))} · v${a.versiyon ?? '—'}</span>
        <span class="text-[11px] text-on-surface-variant whitespace-nowrap">${fmtTarih(a.created_at)}</span>
      </div>
      <p class="text-[11px] text-on-surface-variant">${kacis(danismanAdi(danMap, a.yapan))}</p>
      ${auditFarkHtml(a.eski, a.yeni)}
    </div>`).join('')}</div>`
}

function altGridHtml() {
  return `<div class="grid grid-cols-1 md:grid-cols-2 gap-lg">
    <section class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow p-lg">
      <h3 class="text-title-md text-on-surface mb-lg">Versiyon Geçmişi</h3>
      ${versiyonGecmisiHtml()}
    </section>
    <section class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow p-lg">
      <h3 class="text-title-md text-on-surface mb-lg">Son Değişiklikler</h3>
      ${auditHtml()}
    </section>
  </div>`
}

// =====================================================================
// OLAYLAR — tek delege edilmiş dinleyici (kok yeniden çizilse de kalır)
// =====================================================================
function baglaOlaylar() {
  const kok = document.getElementById('kok')
  if (kok.dataset.bagli) return
  kok.dataset.bagli = '1'
  kok.addEventListener('click', async e => {
    const bankaEl = e.target.closest('[data-banka]')
    if (bankaEl) { await bankaSec(bankaEl.dataset.banka); return }
    if (e.target.closest('#bankaEkleBtn')) { await bankaEkle(); return }
    const tipBtn = e.target.closest('[data-tip-btn]')
    if (tipBtn) { tipSec(tipBtn.dataset.tipBtn); return }
    if (e.target.closest('#bantEkle')) { bantSatirEkle(); return }
    const silEl = e.target.closest('[data-bant-sil]')
    if (silEl) { bantSatirSil(Number(silEl.dataset.bantSil)); return }
    if (e.target.closest('#onzHesapla')) { await onizleHesapla(); return }
    if (e.target.closest('#btnYayinla')) { await yayinla(); return }
    if (e.target.closest('#btnGeriAl')) { geriAl(); return }
    const geriYukleEl = e.target.closest('[data-geri-yukle]')
    if (geriYukleEl) { await versiyonGeriYukle(Number(geriYukleEl.dataset.geriYukle)); return }
  })
  kok.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.id === 'onzNet' || e.target.id === 'onzVade')) {
      e.preventDefault()
      onizleHesapla()
    }
  })
}

async function bankaSec(kod) {
  if (kod === seciliBanka) return
  seciliBanka = kod
  await bankaDetayYukle(kod)
  taslakBaslat(kod)
  ciz()
}

function tipSec(yeniTip) {
  secilenTip = yeniTip
  document.querySelectorAll('[data-tip-btn]').forEach(b => {
    const aktif = b.dataset.tipBtn === yeniTip
    b.classList.toggle('bg-primary', aktif)
    b.classList.toggle('text-on-primary', aktif)
    b.classList.toggle('text-on-surface-variant', !aktif)
  })
  const alan = document.getElementById('autoAlanlar')
  if (alan) { alan.classList.toggle('opacity-40', yeniTip === 'MANUEL'); alan.classList.toggle('pointer-events-none', yeniTip === 'MANUEL') }
}

function bantlariDomdanOku() {
  const container = document.getElementById('bantSatirlari')
  if (!container) return bantlar
  const satirlar = [...container.querySelectorAll('[data-bant-row]')]
  bantlar = satirlar.map(s => ({
    vade_max: s.querySelector('[data-bant="vade"]')?.value ?? '',
    oran: s.querySelector('[data-bant="oran"]')?.value ?? '',
  }))
  return bantlar
}
function bantContainerCiz() {
  const el = document.getElementById('bantSatirlari')
  if (el) el.innerHTML = bantlar.map(bantSatiriHtml).join('')
}
function bantSatirEkle() {
  bantlariDomdanOku()
  bantlar.push({ vade_max: '', oran: '' })
  bantContainerCiz()
}
function bantSatirSil(i) {
  bantlariDomdanOku()
  bantlar.splice(i, 1)
  if (!bantlar.length) bantlar.push({ vade_max: '', oran: '' })
  bantContainerCiz()
}

function sayiOku(id) {
  const v = document.getElementById(id)?.value ?? ''
  const n = Number(String(v).trim().replace(',', '.'))
  return isNaN(n) ? 0 : n
}

// Formdan (DOM) yayınlanacak gövdeyi oku. Faiz bantı oranı %'den ondalığa çevrilir.
function formOkuGovde() {
  bantlariDomdanOku()
  const faiz_bantlari = bantlar
    .filter(b => String(b.oran).trim() !== '')
    .map(b => ({
      vade_max: (b.vade_max === '' || b.vade_max == null) ? null : Number(b.vade_max),
      oran: Number(String(b.oran).replace(',', '.')) / 100,
    }))
  return {
    kesinti_katsayisi: sayiOku('kesinti') || 1,
    sabit_ek: sayiOku('sabitEk'),
    yuzde_ek: sayiOku('yuzdeEk'),
    carpan: sayiOku('carpan') || 1,
    dosya_masrafi: sayiOku('dosyaMasrafi'),
    yukari_yuvarla: !!document.getElementById('yukariYuvarla')?.checked,
    ozel_not: (document.getElementById('ozelNot')?.value || '').trim() || null,
    faiz_bantlari,
  }
}

function durumGoster(msg, hata = false) {
  const el = document.getElementById('durumMetin')
  if (!el) return
  el.innerHTML = hata
    ? `${mat('error', 'text-[16px] text-error')} <span class="text-error">${kacis(msg)}</span>`
    : `${mat('check_circle', 'text-[16px] text-secondary')} <span>${kacis(msg)}</span>`
}

async function onizleHesapla() {
  if (!seciliBanka) return
  const istenenRaw = document.getElementById('onzNet')?.value || ''
  const istenen = Number(istenenRaw.replace(/\D/g, ''))
  const vadeRaw = document.getElementById('onzVade')?.value || ''
  const vade = vadeRaw ? Number(vadeRaw) : null
  const sonucEl = document.getElementById('onzSonuc')
  if (!istenen) { if (sonucEl) sonucEl.innerHTML = onizlemeSonucRenderHtml(null, 'İstenen net tutarı girin.'); return }
  if (sonucEl) sonucEl.innerHTML = `<span class="text-white/60 text-body-sm">Hesaplanıyor…</span>`
  const { data, error } = await supabase.rpc('kredi_net_hesapla', {
    p_banka_kod: seciliBanka, p_istenen_net: istenen, p_vade: vade,
  })
  if (dbHata('kredi_net_hesapla', error)) {
    if (sonucEl) sonucEl.innerHTML = onizlemeSonucRenderHtml(null, 'Hesaplanamadı: ' + (error.message || ''))
    return
  }
  const sonuc = Array.isArray(data) ? data[0] : data
  onizlemeSonuc = sonuc
  if (sonucEl) sonucEl.innerHTML = onizlemeSonucRenderHtml(sonuc, null)
}

async function bankaEkle() {
  const kodRaw = prompt('Banka kodu (örn. ING, DENIZBANK) — büyük harf, boşluksuz:')
  if (!kodRaw) return
  const kod = trBuyuk(kodRaw).trim().replace(/[^A-Z0-9_]/g, '_')
  if (!kod) return
  if (bankalar.some(b => b.kod === kod)) { durumGoster('Bu kod zaten var: ' + kod, true); return }
  const ad = prompt('Banka adı (görünen isim):', kodRaw)
  if (!ad) return
  durumGoster('Ekleniyor…')
  const { data, error } = await supabase.from('kredi_bankalari').insert({ kod, ad: ad.trim() }).select('kod')
  if (dbHata('kredi_bankalari insert', error)) { durumGoster('Eklenemedi: ' + (error.message || ''), true); return }
  if (!data?.length) { durumGoster('Eklenemedi (yetki?).', true); return }

  const { error: e2 } = await supabase.rpc('kredi_parametre_yayinla', {
    p_banka_kod: kod, p_hesaplama_tipi: 'MANUEL', p_kesinti_katsayisi: 1, p_sabit_ek: 0,
    p_yuzde_ek: 0, p_carpan: 1, p_faiz_bantlari: [], p_dosya_masrafi: 0, p_yukari_yuvarla: true,
    p_ozel_not: null,
  })
  if (dbHata('ilk parametre yayinla', e2)) durumGoster('Banka eklendi ama ilk parametre oluşturulamadı: ' + (e2.message || ''), true)

  seciliBanka = kod
  const tamam = await verileriYukle()
  if (!tamam) return
  await bankaDetayYukle(kod)
  taslakBaslat(kod)
  ciz()
  if (!e2) durumGoster('Banka eklendi: ' + ad)
}

async function yayinla() {
  if (!seciliBanka) return
  const tip = secilenTip
  const govde = formOkuGovde()
  if (tip === 'AUTO') {
    if (!(govde.kesinti_katsayisi > 0)) { durumGoster('Kesinti katsayısı 0\'dan büyük olmalı.', true); return }
    if (!(govde.carpan > 0)) { durumGoster('Çarpan 0\'dan büyük olmalı.', true); return }
    if (!govde.faiz_bantlari.length) { durumGoster('En az bir faiz bandı (oran) girilmeli.', true); return }
  }
  const btn = document.getElementById('btnYayinla')
  if (btn) btn.disabled = true
  durumGoster('Yayınlanıyor…')
  const { data, error } = await supabase.rpc('kredi_parametre_yayinla', {
    p_banka_kod: seciliBanka, p_hesaplama_tipi: tip,
    p_kesinti_katsayisi: govde.kesinti_katsayisi, p_sabit_ek: govde.sabit_ek,
    p_yuzde_ek: govde.yuzde_ek, p_carpan: govde.carpan,
    p_faiz_bantlari: govde.faiz_bantlari, p_dosya_masrafi: govde.dosya_masrafi,
    p_yukari_yuvarla: govde.yukari_yuvarla, p_ozel_not: govde.ozel_not,
  })
  if (btn) btn.disabled = false
  if (dbHata('kredi_parametre_yayinla', error)) { durumGoster('Yayınlanamadı: ' + (error.message || ''), true); return }
  const yeni = Array.isArray(data) ? data[0] : data
  const tamam = await verileriYukle()
  if (!tamam) return
  await bankaDetayYukle(seciliBanka)
  taslakBaslat(seciliBanka)
  ciz()
  durumGoster(`Yeni versiyon yayınlandı — v${yeni?.versiyon ?? '?'}.`)
}

function geriAl() {
  if (!seciliBanka) return
  taslakBaslat(seciliBanka)
  ciz()
  durumGoster('Değişiklikler geri alındı (yürürlükteki değerlere döndü).')
}

async function versiyonGeriYukle(v) {
  const row = versiyonlar.find(x => x.versiyon === v)
  if (!row) return
  if (!confirm(`v${v} değerleri yeni bir versiyon olarak yayınlansın mı?`)) return
  durumGoster('Geri yükleniyor…')
  const { data, error } = await supabase.rpc('kredi_parametre_yayinla', {
    p_banka_kod: seciliBanka, p_hesaplama_tipi: row.hesaplama_tipi,
    p_kesinti_katsayisi: row.kesinti_katsayisi, p_sabit_ek: row.sabit_ek,
    p_yuzde_ek: row.yuzde_ek, p_carpan: row.carpan,
    p_faiz_bantlari: row.faiz_bantlari, p_dosya_masrafi: row.dosya_masrafi,
    p_yukari_yuvarla: row.yukari_yuvarla, p_ozel_not: row.ozel_not,
  })
  if (dbHata('versiyon geri yukle', error)) { durumGoster('Geri yüklenemedi: ' + (error.message || ''), true); return }
  const yeni = Array.isArray(data) ? data[0] : data
  const tamam = await verileriYukle()
  if (!tamam) return
  await bankaDetayYukle(seciliBanka)
  taslakBaslat(seciliBanka)
  ciz()
  durumGoster(`v${v} değerleri v${yeni?.versiyon ?? '?'} olarak yeniden yayınlandı.`)
}
