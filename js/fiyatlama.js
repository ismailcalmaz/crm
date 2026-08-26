// =====================================================================
// fiyatlama.js — Fiyatlama Merkezi (WB3, İsmail Bey karar paneli).
//   Bilgi işlem "Fiyatlamaya Gönder" → burada kuyruk → alış/satış/min/masraf
//   → "Fiyatla ve Stoğa Al" (fiyatlama_durumu=FIYATLANDI, durum=STOKTA).
//   Sağ kolon Araç Değerleme: TSB Kasko + Karlılık + PİYASA ANALİZİ gerçek;
//   Talep/AI hâlâ "yakında". Piyasa kartı v_arac_alis_onerisi'ni okur —
//   net alış hesabı VERİTABANINDA (sql/109), burada tek satır hesap yok.
//   Ölçüm yetersizse rakam yerine "yetersiz veri" yazılır: uydurma rakam
//   YOK — yanlış fiyat kararı verdirmemek için. Notlar gerçek.
//   Para tabloları finans-gated. Bkz [[dms-alis-fiyatlama-tasarim]].
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, kacis, trBuyuk, buyuk, dbHata, danismanMap, danismanAdi,
         telBicim, telNo, waHref, musteriTipEtiket, fmtTarihKisa } from './veri.js'
import { mat, bosDurum, uyari, basHarf } from './stitch-ui.js'
import { PARCALAR, svgBoya } from './ekspertiz.js'
import { ihaleIsaretler } from './yetki.js'
import { masrafKapiBagla } from './masraf-kapi.js'
import { tsbAdayAra, tsbAdaylariCiz, gecikmeli } from './tsb-paket.js'  // TSB arama tek kaynak

const KOK = () => document.getElementById('kok')
let DANISMAN = null
let DMAP = {}
let TANIM = {}
let SVGTXT = ''
let TUM = []
let secili = null
let masraflar = []
let IHALE = {}  // arac_id -> acik ihale cikisi (sql/110) — dugmenin durumu icin
let MVAR = []   // masraf_varsayilanlari — finans-yönetimli sabit tutarlar (RLS: yönetici/finans okur)

// Masraf tipi + seçili alış şekline göre varsayılan tutar (en özel kazanır: kaynak > taban)
function masrafVarsayilan(tip, alisSekli) {
  if (!tip) return null
  const eslesenler = MVAR.filter(m => m.masraf_tipi === tip)
  const ozel = alisSekli ? eslesenler.find(m => m.alis_sekli === alisSekli) : null
  const taban = eslesenler.find(m => !m.alis_sekli)
  const v = ozel || taban
  return v ? Number(v.tutar) : null
}

const B = v => kacis(buyuk(v ?? ''))
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
const tanimAd = (tip, kod) => (TANIM[tip] || []).find(t => t.kod === kod)?.ad || kod || ''
// Para girişi: "1000000" → "1.000.000" (yazarken); paraNum: alandan sayı oku
const paraFmt = v => { const d = String(v ?? '').replace(/\D/g, ''); return d ? Number(d).toLocaleString('tr-TR') : '' }
const paraNum = id => { const d = String(document.getElementById(id)?.value || '').replace(/\D/g, ''); return d ? Number(d) : null }

export async function fiyatlamaKur(d) {
  DANISMAN = d
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Fiyatlama kuyruğu yükleniyor…</div>`
  const [{ data: tanimlar }, { data: mvar, error: mvarErr }, svg, dmap] = await Promise.all([
    supabase.from('tanimlar').select('tip,kod,ad').eq('aktif', true)
      .in('tip', ['ALIS_SEKLI', 'MASRAF_TIPI', 'RENK', 'YAKIT', 'VITES']).order('sira'),
    supabase.from('masraf_varsayilanlari').select('masraf_tipi,alis_sekli,tutar').eq('aktif', true),
    fetch('img/ekspertiz-sema.svg').then(r => r.text()).catch(() => ''),
    danismanMap(),
  ])
  if (mvarErr) console.error('[DMS] masraf varsayilan okunamadi', mvarErr)  // RLS bloklarsa boş → elle girilir
  MVAR = mvar || []
  TANIM = {}; for (const t of (tanimlar || [])) (TANIM[t.tip] = TANIM[t.tip] || []).push(t)
  SVGTXT = svg; DMAP = dmap
  await yukle()
}

async function yukle() {
  const { data, error } = await supabase.from('stok_araclar')
    .select(`id, plaka, marka, model, versiyon, yil, yakit, vites, km, renk, durum, yedek_anahtar, fiyatlama_durumu, updated_at,
             tsb_marka_id, tsb_tip_id, ekspertiz_orijinal, tramer_temiz,
             arac_alislar(alis_fiyati, alis_sekli, alis_tarihi, satici_musteri_id, cikis_ili,
                          musteriler:satici_musteri_id(id, ad_soyad, telefon, tip, e_posta, adres)),
             arac_ekspertiz(parca_kodu, durum), arac_tramer(tutar, aciklama, hasar_tarihi),
             arac_masraflar(id, masraf_tipi, tutar, aciklama), arac_evraklar(id, tip, url),
             arac_fiyatlar(satis_fiyati, min_satis_fiyati, gecerli_baslangic)`)
    .eq('fiyatlama_durumu', 'BEKLIYOR')
    .order('updated_at', { ascending: true })
  if (error) { dbHata('fiyatlama yükle', error); KOK().innerHTML = uyari('Kuyruk okunamadı: ' + kacis(error.message)); return }
  // Açık ihale çıkışları — "İhalede Satılacak" düğmesi zaten işaretliyse
  // tekrar basılmasın (sunucudaki tek-açık-kayıt kısıtı da engeller, ama
  // kullanıcı sebebini düğmede görsün).
  {
    // ⚠️ Süzme SUNUCUDA değil burada: PostgREST `not.in` sözdizimi yanlış
    // yazılırsa hata döner, IHALE boş kalır ve düğme "işaretlenmemiş" gösterir —
    // kullanıcı basar, sunucu tekrar kaydı reddeder, sebebi anlaşılmaz.
    // Liste küçük (açık ihale çıkışları), istemcide süzmek daha güvenli.
    const { data: ih, error: ihErr } = await supabase.from('v_ihale_takip')
      .select('arac_id, onay_durumu, durum')
    if (ihErr) console.error('[DMS] ihale cikislari okunamadi', ihErr)
    IHALE = {}
    for (const r of (ih || [])) {
      if (r.durum === 'SATILDI' || r.durum === 'GERI_CEKILDI') continue
      IHALE[r.arac_id] = r
    }
  }
  TUM = (data || []).map(nitele)
  if (!secili || !TUM.find(a => a.id === secili)) { secili = TUM[0]?.id || null; masraflar = [] }
  ciz()
}

function nitele(a) {
  const eks = a.arac_ekspertiz || []
  const trm = a.arac_tramer || []
  const alis = (a.arac_alislar || [])[0] || null
  const fiyat = (a.arac_fiyatlar || []).sort((x, y) => new Date(y.gecerli_baslangic) - new Date(x.gecerli_baslangic))[0] || null
  const trmTutar = trm.reduce((s, t) => s + (Number(t.tutar) || 0), 0)
  const trmAdet = trm.reduce((s, t) => { const m = String(t.aciklama || '').match(/\d+/); return s + (m ? +m[0] : 1) }, 0)
  const evr = new Set((a.arac_evraklar || []).map(e => e.tip))
  // Orijinal araçta ekspertiz satırı, temiz araçta tramer satırı OLMAZ; kabulde
  // verilen onay (ekspertiz_orijinal / tramer_temiz) da bölümü TAMAM sayar.
  const eksTamam = eks.length > 0 || !!a.ekspertiz_orijinal
  const trmTamam = trm.length > 0 || !!a.tramer_temiz
  return {
    ...a, _alis: alis, _fiyat: fiyat, _trmTutar: trmTutar, _trmAdet: trmAdet, _trmVar: trm.length > 0,
    _eksSay: eks.length,
    _boyali: eks.filter(e => e.durum === 'BOYALI').length,
    _degisen: eks.filter(e => e.durum === 'DEGISEN').length,
    _lokal: eks.filter(e => e.durum === 'LOKAL BOYA').length,
    _ekspertizOrijinal: eks.length === 0 && !!a.ekspertiz_orijinal,
    _tramerTemiz: trm.length === 0 && !!a.tramer_temiz,
    _tramerVarEvrak: evr.has('SBM_GORSEL'), _ekspertizPdf: evr.has('EKSPERTIZ_PDF') || evr.has('EKSPERTIZ_LINK'),
    _hazir: trmTamam && eksTamam,
  }
}

function ciz() {
  const secA = TUM.find(a => a.id === secili) || null
  // Seçili aracın masrafları DB'den (İsmail Bey girdikçe kaydedilir, tekrar açılınca gelir)
  masraflar = (secA?.arac_masraflar || []).map(m => ({ id: m.id, tip: m.masraf_tipi, tutar: Number(m.tutar) || 0, aciklama: m.aciklama || null }))

  const hazir = TUM.filter(a => a._hazir).length
  const kpi = (et, dg, kutu, renk) => `
    <div class="rounded-xl p-4 flex flex-col gap-1 border ${kutu}">
      <span class="text-label-xs font-bold uppercase tracking-wider ${renk.et}">${et}</span>
      <span class="text-heading-md font-bold ${renk.dg}">${dg}</span></div>`
  const kpiHtml = `<div class="grid grid-cols-3 gap-3 md:gap-4">
    ${kpi('Kuyrukta', TUM.length, 'bg-primary/5 border-primary/10 custom-shadow', { et: 'text-primary', dg: 'text-primary' })}
    ${kpi('Fiyatlamaya Hazır', hazir, 'bg-[#ECFDF5] border-[#10B981]/20', { et: 'text-[#065F46]', dg: 'text-[#047857]' })}
    ${kpi('Eksik Veri', TUM.length - hazir, 'bg-[#FFFBEB] border-[#F59E0B]/20', { et: 'text-[#92400E]', dg: 'text-[#B45309]' })}
  </div>`

  const satir = a => {
    const aktif = a.id === secili
    return `<button data-id="${a.id}" class="fq-satir w-full text-left p-3 rounded-xl border transition-all ${aktif ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/20' : 'bg-surface-container-lowest border-outline-variant hover:border-primary/30'}">
      <div class="flex items-center justify-between gap-2">
        <span class="text-body-sm font-bold text-primary">${B(a.plaka) || '—'}</span>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${a._hazir ? 'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30' : 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30'}">${a._hazir ? 'Hazır' : 'Eksik'}</span>
      </div>
      <div class="text-[11px] text-on-surface-variant mt-0.5">${a.yil ? a.yil + ' ' : ''}${B(a.marka)} ${B(a.model)}</div>
      <div class="text-[10px] text-outline-variant mt-0.5">${a.km != null ? a.km.toLocaleString('tr-TR') + ' km' : ''}${a._trmAdet ? ' · Tramer ' + a._trmAdet : ''}${a._boyali ? ' · ' + a._boyali + ' boyalı' : ''}</div>
    </button>`
  }
  const listeHtml = TUM.length
    ? `<div class="flex flex-col gap-2">${TUM.map(satir).join('')}</div>`
    : bosDurum('Fiyatlama kuyruğu boş. Araç Kabul’dan “Fiyatlamaya Gönder” ile araç yollayın.', 'sell')

  const detayHtml = secA ? detayCiz(secA)
    : `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-8">${bosDurum('Fiyatlanacak aracı seçin.', 'directions_car')}</div>`

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 md:mb-6">
      <div><h2 class="text-headline-md text-primary font-bold">Fiyatlama Merkezi</h2>
        <p class="text-body-md text-on-surface-variant">İsmail Bey karar paneli — alış, satış, masraf, kâr</p></div>
    </div>
    ${kpiHtml}
    <div class="mt-4 md:mt-6 flex flex-col xl:flex-row gap-4 md:gap-6">
      <aside class="w-full xl:w-[260px] shrink-0">
        <h3 class="text-label-xs uppercase tracking-wider text-on-surface-variant mb-2">Kuyruk (${TUM.length})</h3>
        ${listeHtml}
      </aside>
      <div class="flex-1 min-w-0">${detayHtml}</div>
    </div>`

  bagla()
  if (secA) { svgDoldur(secA); guncelleProjeksiyon(); kaskoDoldur(secA); piyasaDoldur(secA); notlarDoldur(secA) }
}

// --- Sağ değerleme kutusu (küçük kart) ---
function degKart(baslik, ic, yakinda = false) {
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
    <div class="flex items-center justify-between mb-2">
      <span class="text-label-xs uppercase tracking-wider text-on-surface-variant">${baslik}</span>
      ${yakinda ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">yakında</span>` : ''}
    </div>${ic}</div>`
}

function durumKart(a) {
  // Tramer/ekspertiz kutusu, ilgili görseli (SBM / ekspertiz PDF) varsa TIKLANIR
  // → pop-up. Yoksa düz kutu.
  const tile = (ik, et, dg, renk, evraktip) => {
    const tikli = (evraktip === 'SBM_GORSEL' && a._tramerVarEvrak) || (evraktip === 'EKSPERTIZ_PDF' && a._ekspertizPdf)
    const ortak = 'flex items-center gap-2 p-3 rounded-lg border border-outline-variant/60 bg-surface-container-low'
    const ic = `<span class="material-symbols-outlined text-[20px]" style="color:${renk}">${ik}</span>
      <div class="flex flex-col min-w-0"><span class="text-[10px] uppercase text-on-surface-variant">${et}</span>
        <span class="text-body-sm font-bold truncate">${dg}</span></div>`
    return tikli
      ? `<button data-evrakac="${evraktip}" class="${ortak} w-full text-left hover:border-primary/40 hover:bg-primary/5 transition-colors">${ic}${mat('visibility', 'text-[16px] text-primary ml-auto shrink-0')}</button>`
      : `<div class="${ortak}">${ic}</div>`
  }
  return `<div class="grid grid-cols-1 md:grid-cols-3 gap-2">
    ${tile('search_check', 'Tramer', a._trmVar ? `${a._trmAdet} kayıt · ${fmtPara(a._trmTutar)}` : (a._tramerTemiz ? 'Temiz (onaylı)' : 'Kayıt yok'), a._trmTutar ? '#B45309' : '#10B981', 'SBM_GORSEL')}
    ${tile('assignment_turned_in', 'Ekspertiz', a._eksSay ? `${a._boyali} boyalı · ${a._degisen} değişen · ${a._lokal} lokal` : (a._ekspertizOrijinal ? 'Orijinal (onaylı)' : 'Temiz'), a._degisen ? '#ba1a1a' : (a._boyali ? '#F59E0B' : '#10B981'), 'EKSPERTIZ_PDF')}
    ${tile('key', 'Yedek Anahtar', a.yedek_anahtar ? 'VAR' : 'YOK', a.yedek_anahtar ? '#10B981' : '#ba1a1a')}
  </div>`
}

// Tramer/ekspertiz belgesini pop-up'ta göster (imzalı URL). Özel bucket.
async function evrakPopupAc(tip) {
  const a = TUM.find(x => x.id === secili); if (!a) return
  const list = (a.arac_evraklar || []).filter(x => x.tip === tip)
  const e = list[list.length - 1]; if (!e) return
  const baslik = tip === 'SBM_GORSEL' ? 'Tramer / SBM Belgesi' : 'Ekspertiz Raporu'
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[90] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/60" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat(tip === 'SBM_GORSEL' ? 'search_check' : 'assignment_turned_in', 'text-[20px]')} ${baslik}</h3>
        <div class="flex items-center gap-2">
          <a id="evrakYeni" target="_blank" rel="noopener" class="text-[11px] font-bold text-primary hover:underline items-center gap-1 hidden sm:flex">${mat('open_in_new', 'text-[14px]')} Yeni sekme</a>
          <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
        </div>
      </div>
      <div id="evrakGovde" class="p-3 flex-1 overflow-auto flex items-center justify-center min-h-[300px]"><span class="text-body-sm text-on-surface-variant">yükleniyor…</span></div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = ev => { if (ev.key === 'Escape') kapat() }
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  document.addEventListener('keydown', esc)
  const { data, error } = await supabase.storage.from('arac-evrak').createSignedUrl(e.url, 3600)
  const govde = ov.querySelector('#evrakGovde')
  if (error || !data?.signedUrl) { dbHata('[evrak] imzalı url', error); govde.innerHTML = `<span class="text-body-sm text-error">Belge açılamadı.</span>`; return }
  const url = data.signedUrl
  ov.querySelector('#evrakYeni').href = url
  govde.innerHTML = /\.pdf(\?|$)/i.test(e.url)
    ? `<iframe src="${kacis(url)}#toolbar=0&view=FitH" class="w-full h-[72vh] border-0 rounded-lg bg-white" title="${kacis(baslik)}"></iframe>`
    : `<img src="${kacis(url)}" class="max-w-full max-h-[76vh] object-contain rounded-lg" alt="${kacis(baslik)}" />`
}

// --- Araç sahibi (satıcı) şeridi -------------------------------------------
// Göksenil (13 Ağu 2026): "bu sayfada araç özelinde araç sahibi bilgilerini de
//   göstermemiz gerekiyor."
// Kaynak: arac_alislar.satici_musteri_id → musteriler. Fiyatlama kararı
// verilirken "bu aracı kimden aldık, ulaşabilir miyim" sorusu için.
//
// ⚠️ SAYFAYI YALNIZ YÖNETİCİ / SATIŞ MÜDÜRÜ ve ayrıca yetki verilenler görür
//    (yetki.js ROL_VARSAYILAN) — alış fiyatını zaten gören roller. Telefon
//    bu yüzden açık gösteriliyor; danışman bu sayfaya girmiyor.
// ⚠️ Telefon alanında '-' YAZAN kayıtlar var (15 aracın 5'i, 13 Ağu ölçümü).
//    Boş değil, tire. Doğrudan `tel:` bağlantısı yapılsaydı çalışmayan bir
//    düğme çıkardı; rakam sayısı 10'un altındaysa "telefon yok" yazılır.
// ⚠️ Takas/peşin alımda satıcı bazen "İsmail Çalmaz Otomotiv" (kendi
//    şirketimiz) olarak kayıtlı — gizlenmiyor, aracın nasıl geldiğini söylüyor.
function saticiSeridi(a) {
  const al = a._alis
  const ham = al?.musteriler
  const m = Array.isArray(ham) ? ham[0] : ham
  const kutu = ic => `<div class="mt-3 pt-3 border-t border-outline-variant/60">
      <div class="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 mb-2">
        ${mat('person', 'text-[14px]')} Araç Sahibi</div>${ic}</div>`

  if (!al) return kutu(`<p class="text-label-md text-on-surface-variant">Alış kaydı yok — araç kabulde satıcı girilmemiş.</p>`)
  if (!m) return kutu(`<p class="text-label-md text-on-surface-variant">Satıcı kaydı girilmemiş.</p>`)

  const rakam = telNo(m.telefon).replace(/\D/g, '')
  const telVar = rakam.length >= 10
  const wa = telVar ? waHref(m.telefon) : null
  const ek = (ik, v) => v ? `<span class="inline-flex items-center gap-1 text-[11.5px] text-on-surface-variant">${mat(ik, 'text-[13px]')} ${kacis(v)}</span>` : ''

  return kutu(`
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      ${m.id
        ? `<a href="musteri-360.html?id=${encodeURIComponent(m.id)}" class="font-bold text-primary hover:underline">${kacis(buyuk(m.ad_soyad))}</a>`
        : `<span class="font-bold text-on-surface">${kacis(buyuk(m.ad_soyad))}</span>`}
      <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-surface-container-high border border-outline-variant text-on-surface-variant">${kacis(musteriTipEtiket(m.tip))}</span>
      ${telVar
        ? `<a href="tel:${kacis(telNo(m.telefon))}" class="inline-flex items-center gap-1 font-semibold text-on-surface hover:text-primary">${mat('call', 'text-[15px]')} ${kacis(telBicim(m.telefon))}</a>
           ${wa ? `<a href="${kacis(wa)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-[11.5px] font-bold text-secondary hover:underline">${mat('chat', 'text-[13px]')} WhatsApp</a>` : ''}`
        : `<span class="text-[11.5px] text-on-surface-variant">telefon yok</span>`}
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
      ${ek('event', al.alis_tarihi ? 'Alış ' + fmtTarihKisa(al.alis_tarihi) : '')}
      ${ek('location_on', al.cikis_ili)}
      ${ek('mail', m.e_posta)}
      ${ek('home', m.adres)}
    </div>`)
}

function detayCiz(a) {
  const alisSekli = a._alis?.alis_sekli || ''
  const alisFiyat = a._alis?.alis_fiyati ?? ''
  const satisFiyat = a._fiyat?.satis_fiyati ?? ''
  const minFiyat = a._fiyat?.min_satis_fiyati ?? ''
  const alisSekliOps = (TANIM['ALIS_SEKLI'] || []).map(t =>
    `<option value="${kacis(t.kod)}" ${t.kod === alisSekli ? 'selected' : ''}>${kacis(t.ad)}</option>`).join('')
  const masrafOps = (TANIM['MASRAF_TIPI'] || []).map(t => `<option value="${kacis(t.kod)}">${kacis(t.ad)}</option>`).join('')
  const cip = (ik, v) => v ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container-high border border-outline-variant text-[11px] font-bold">${mat(ik, 'text-[14px]')} ${kacis(buyuk(v))}</span>` : ''

  return `<div class="flex flex-col gap-4 md:gap-6">
    <!-- Künye + çipler + araç sahibi -->
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5">
      <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <span class="bg-primary/5 px-2 py-1 rounded text-primary font-bold text-heading-md border border-primary/10">${B(a.plaka) || '—'}</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${a._hazir ? 'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30' : 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30'}">${a._hazir ? '🟢 Fiyatlamaya Hazır' : '🟠 Eksik Veri'}</span>
          </div>
          <h3 class="text-heading-md font-bold text-on-surface mt-2">${a.yil ? a.yil + ' ' : ''}${B(a.marka)} ${B(a.model)} ${B(a.versiyon)}</h3>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${cip('local_gas_station', tanimAd('YAKIT', a.yakit))}
          ${cip('settings', tanimAd('VITES', a.vites))}
          ${a.km != null ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container-high border border-outline-variant text-[11px] font-bold">${mat('speed', 'text-[14px]')} ${a.km.toLocaleString('tr-TR')} KM</span>` : ''}
          ${cip('palette', tanimAd('RENK', a.renk))}
        </div>
      </div>
      ${saticiSeridi(a)}
    </div>

    <!-- 2 kolon: SOL durum+fiyatlama · SAĞ değerleme -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">

      <!-- SOL -->
      <div class="flex flex-col gap-4 md:gap-6">
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5">
          <h4 class="text-label-xs uppercase tracking-wider text-on-surface-variant mb-3 flex items-center gap-1">${mat('fact_check', 'text-[16px]')} Araç Durumu</h4>
          ${durumKart(a)}
          <div id="fSvg" class="max-w-[280px] mx-auto mt-3"></div>
          <div class="mt-3 p-2 rounded-lg text-center text-label-md font-bold ${a._hazir ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FFFBEB] text-[#B45309]'}">${a._hazir ? '🟢 FİYATLAMAYA HAZIR' : '🟠 EKSİK VERİ'}</div>
        </div>

        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5 flex flex-col gap-4">
          <h4 class="text-headline-sm font-bold text-primary flex items-center gap-2">${mat('payments')} Fiyatlama</h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label class="flex flex-col gap-1"><span class="text-[11px] font-bold text-on-surface-variant uppercase">Alış Fiyatı (₺) *</span>
              <input id="fAlis" type="text" inputmode="numeric" value="${paraFmt(alisFiyat)}" class="${INP} para" /></label>
            <label class="flex flex-col gap-1"><span class="text-[11px] font-bold text-on-surface-variant uppercase">Satış Fiyatı (₺) *</span>
              <input id="fSatis" type="text" inputmode="numeric" value="${paraFmt(satisFiyat)}" class="${INP} para" /></label>
            <label class="flex flex-col gap-1"><span class="text-[11px] font-bold text-on-surface-variant uppercase">Min. Satış (₺)</span>
              <input id="fMin" type="text" inputmode="numeric" value="${paraFmt(minFiyat)}" class="${INP} para" /></label>
          </div>
          <label class="flex flex-col gap-1 max-w-xs"><span class="text-[11px] font-bold text-on-surface-variant uppercase">Alış Şekli *</span>
            <select id="fSekli" class="${INP}"><option value="">Seçiniz…</option>${alisSekliOps}</select></label>

          <div class="border-t border-outline-variant pt-3">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-on-surface-variant uppercase">Masraflar</span>
              ${(DANISMAN?.master_admin || (Array.isArray(DANISMAN?.yetkiler) && DANISMAN.yetkiler.includes('masraf_varsayilan_yonet'))) ? `<a href="masraf-varsayilan.html" class="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1">${mat('price_change', 'text-[14px]')} Varsayılanlar</a>` : ''}
            </div>
            <div class="flex flex-wrap items-end gap-2 mt-2">
              <label class="flex flex-col gap-1 flex-1 min-w-[140px]"><span class="text-[10px] text-on-surface-variant">Masraf Tipi</span>
                <select id="mTip" class="${INP}"><option value="">Seçiniz…</option>${masrafOps}</select></label>
              <label class="flex flex-col gap-1 w-32"><span class="text-[10px] text-on-surface-variant">Tutar (₺)</span>
                <input id="mTutar" type="text" inputmode="numeric" class="${INP} para" /></label>
              <button id="mEkle" class="bg-primary/10 text-primary px-3 h-10 rounded-lg text-sm font-bold flex items-center gap-1 hover:bg-primary/20">${mat('add', 'text-[18px]')} Ekle</button>
            </div>
            ${/* Göksenil (11 Ağu 2026): "masraflarda diğer'i işaretlediğimde
                  metin kutusu açılmalı, oraya girip tutarını yazıp enter'a
                  basınca eklemesi gerekiyor."
                ⚠️ "Diğer" masrafın NE OLDUĞU yazılmazsa ay sonunda kalem
                   anlamsız kalıyor — tip DIGER seçilince açıklama ZORUNLU.
                   Kolon zaten var (arac_masraflar.aciklama), şema değişmedi. */''}
            <label id="mAciklamaKap" class="hidden flex-col gap-1 mt-2">
              <span class="text-[10px] text-on-surface-variant">Açıklama <b class="text-error">*</b> <span class="normal-case font-normal">— bu masraf ne için?</span></span>
              <input id="mAciklama" type="text" maxlength="120" placeholder="Örn. cam filmi, ekspertiz farkı…" class="${INP}" />
            </label>
            <div id="mOpUyari" class="mt-2"></div>
            <div id="masrafListe" class="mt-2"></div>
          </div>

          <div id="fUyariKap"></div>
          <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
            ${ihaleDugmesi(a)}
            ${iadeDugmesi(a)}
            <button id="fKaydetTaslak" class="px-4 h-11 flex items-center gap-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low text-sm font-bold">${mat('save', 'text-[18px]')} Kaydet</button>
            <button id="fKaydet" class="bg-primary text-on-primary px-5 h-11 flex items-center gap-1.5 rounded-lg text-sm font-bold hover:opacity-90 shadow-sm">${mat('sell', 'text-[18px]')} Fiyatla</button>
          </div>
        </div>
      </div>

      <!-- SAĞ: Araç Değerleme -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2 text-primary"><span class="material-symbols-outlined text-[20px]">insights</span><h4 class="text-headline-sm font-bold">Araç Değerleme</h4></div>
        ${degKart('TSB Kasko Değeri', `<div id="tsbKasko"><span class="text-body-sm text-on-surface-variant">yükleniyor…</span></div>`)}
        ${degKart('Piyasa Analizi · arabam.com', `<div id="piyasaKart"><span class="text-body-sm text-on-surface-variant">yükleniyor…</span></div>`)}
        <div class="grid grid-cols-2 gap-3">
          ${degKart('Talep', `<div class="text-body-md font-bold text-outline-variant">—</div>`, true)}
          ${degKart('Tahmini Satış Süresi', `<div class="text-body-md font-bold text-outline-variant">—</div>`, true)}
        </div>
        <!-- Karlılık (bordo, GERÇEK) -->
        <div id="karKutu" class="rounded-xl p-4 bg-primary text-on-primary"></div>
        ${degKart('Son 12 Ay Satış Arşivi', `<div class="grid grid-cols-4 gap-1 text-center">
          ${['Adet', 'Min', 'Ort', 'Max'].map(x => `<div><div class="text-[10px] uppercase text-on-surface-variant">${x}</div><div class="text-body-sm font-bold text-outline-variant">—</div></div>`).join('')}</div>`, true)}
        ${degKart('AI Karar Desteği', `<div class="text-body-sm text-on-surface-variant">Yapay zekâ önerilen satış fiyatı ve satış ihtimali — AI bağlanınca aktif.</div>`, true)}
      </div>
    </div>

    <!-- Araç Notları -->
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5">
      <h4 class="text-headline-sm font-bold text-primary flex items-center gap-2 mb-3">${mat('sticky_note_2')} Araç Notları</h4>
      <div id="notlarListe" class="mb-3"><span class="text-body-sm text-on-surface-variant">yükleniyor…</span></div>
      <div class="flex items-center gap-2">
        <input id="notInput" placeholder="Yeni bir not ekleyin…" class="${INP}" />
        <button id="notEkle" class="bg-primary text-on-primary px-4 h-10 rounded-lg text-sm font-bold flex items-center gap-1 hover:opacity-90 shrink-0">${mat('send', 'text-[18px]')} Gönder</button>
      </div>
    </div>
  </div>`
}

function svgDoldur(a) {
  const kap = document.getElementById('fSvg'); if (!kap || !SVGTXT) return
  kap.innerHTML = SVGTXT
  const svg = kap.querySelector('svg'); if (!svg) return
  const paneller = Object.fromEntries(PARCALAR.map(p => [p, 'ORIJINAL']))
  for (const e of (a.arac_ekspertiz || [])) paneller[e.parca_kodu] = e.durum
  svgBoya(svg, paneller)
  svg.querySelectorAll('[data-part]').forEach(p => { p.style.cursor = 'default'; p.onclick = null })
}

// ⚠️ TSB KODU BURADA DÜZELTİLEBİLİR (Göksenil, 18 Ağu 2026) — fiyatlama
//    ekranındaki TEK yazma yetkisi budur. Sebebi: kasko değeri doğrudan bu
//    koddan geliyor; yanlış kodla verilmiş fiyatı sonradan düzeltmek zor.
//    Diğer her şey (plaka, ruhsat, alış fiyatı…) İADE yolundan gider.
async function kaskoDoldur(a) {
  const el = document.getElementById('tsbKasko'); if (!el) return
  const duzeltBtn = `<button id="tsbDuzelt" class="text-[11px] font-bold text-primary hover:underline shrink-0" title="TSB marka/tip kodunu düzelt">Kodu düzelt</button>`
  const kodSatiri = (a.tsb_marka_id && a.tsb_tip_id)
    ? `<span class="text-[10px] text-on-surface-variant">Marka ${kacis(a.tsb_marka_id)} · Tip ${kacis(a.tsb_tip_id)}</span>` : ''
  const sar = govde => {
    el.innerHTML = `<div class="flex items-start justify-between gap-2"><div class="min-w-0">${govde}<div>${kodSatiri}</div></div>${duzeltBtn}</div>
      <div id="tsbDuzeltKap" class="hidden mt-2"></div>`
    document.getElementById('tsbDuzelt')?.addEventListener('click', () => tsbDuzeltAc(a))
  }

  if (!a.tsb_marka_id || !a.tsb_tip_id || !a.yil) {
    sar(`<span class="text-body-sm text-on-surface-variant">TSB kodu / yıl eksik</span>`); return
  }
  const { data, error } = await supabase.from('tsb_kasko_liste')
    .select('kasko_degeri, liste_donemi').eq('marka_kodu', a.tsb_marka_id).eq('tip_kodu', a.tsb_tip_id)
    .eq('model_yili', a.yil).gt('kasko_degeri', 0).order('liste_donemi', { ascending: false }).limit(1)
  if (error) { dbHata('tsb kasko', error) }
  if (!data || !data.length) {
    sar(`<span class="text-body-sm text-on-surface-variant">TSB kasko kaydı yok</span>`); return
  }
  sar(`<span class="text-heading-lg font-bold text-on-surface">${fmtPara(data[0].kasko_degeri)}</span>`)
}

// TSB kodu düzeltme paneli — arama tsb-paket.js'te, burada yalnız yazma.
function tsbDuzeltAc(a) {
  const kap = document.getElementById('tsbDuzeltKap'); if (!kap) return
  if (!kap.classList.contains('hidden')) { kap.classList.add('hidden'); kap.innerHTML = ''; return }
  kap.classList.remove('hidden')
  // Tohum metin aracın kendi tanımı — arama zaten ilan başlığı bekliyor.
  const tohum = [a.marka, a.model, a.versiyon].filter(Boolean).join(' ')
  kap.innerHTML = `
    <input id="tsbAraMetin" class="${INP} text-[12px]" value="${kacis(tohum)}"
           placeholder="İlan başlığı — ör. Fiat Egea 1.4 Fire 95 Easy Sedan" />
    <div class="text-[10px] text-on-surface-variant mt-1">Model yılı: <b>${kacis(String(a.yil || '—'))}</b> · aday seçince kod kaydedilir.</div>
    <div id="tsbAraAdaylar" class="mt-1.5 space-y-1"></div>`
  const ara = gecikmeli(async () => {
    const metin = (document.getElementById('tsbAraMetin')?.value || '').trim()
    const kutu = document.getElementById('tsbAraAdaylar'); if (!kutu) return
    if (metin.length < 3) { kutu.innerHTML = ''; return }
    kutu.innerHTML = `<div class="text-[11px] text-on-surface-variant">Aranıyor…</div>`
    const sonuc = await tsbAdayAra({ metin, yil: a.yil })
    tsbAdaylariCiz(kutu, sonuc, { yil: a.yil, onSec: sec => tsbKoduYaz(a, sec) })
  }, 350)
  document.getElementById('tsbAraMetin')?.addEventListener('input', ara)
  ara()
}

async function tsbKoduYaz(a, sec) {
  const kutu = document.getElementById('tsbAraAdaylar')
  if (kutu) kutu.innerHTML = `<div class="text-[11px] text-on-surface-variant">Kaydediliyor…</div>`
  const { data, error } = await supabase.from('stok_araclar')
    .update({ tsb_marka_id: sec.marka_kodu, tsb_tip_id: sec.tip_kodu })
    .eq('id', a.id).select('id')                     // §5: .select + length kontrolü
  if (error) {
    dbHata('tsb kodu yaz', error)
    if (kutu) kutu.innerHTML = `<div class="text-[11px] text-error">Kaydedilemedi: ${kacis(error.message)}</div>`
    return
  }
  if (!data?.length) {                               // RLS 0 satır döndürebilir — sessiz geçme
    if (kutu) kutu.innerHTML = `<div class="text-[11px] text-error">Kaydedilemedi — yetki veya kayıt yok.</div>`
    return
  }
  // Bellekteki nesneyi de güncelle ki kart yeniden çizilince doğru kodu okusun.
  a.tsb_marka_id = sec.marka_kodu
  a.tsb_tip_id = sec.tip_kodu
  toast(`TSB kodu güncellendi: Marka ${sec.marka_kodu} · Tip ${sec.tip_kodu}`)
  await kaskoDoldur(a)                               // kasko değeri yeni kodla yeniden okunur
}

// --- Piyasa analizi + net alış önerisi (v_arac_alis_onerisi) ---------------
// Hesabın tamamı VERİTABANINDA (sql/109). Burada tek satır kod hesap yapmaz —
// formül hem burada hem robotta yaşasaydı iki kopya ayrışırdı.
async function piyasaDoldur(a) {
  const el = document.getElementById('piyasaKart'); if (!el) return

  const { data, error } = await supabase.from('v_arac_alis_onerisi')
    .select('kapsam,seviye,slug,ilan_adet,yetersiz,olcum_zamani,piyasa_tabani,marj_yuzde,saf_alis,ekspertiz_yuzde,hasarli_parca,tramer_tutari,tramer_yuzde,toplam_dusus_yuzde,nihai_alis,hata,paket_yetersizdi')
    .eq('arac_id', a.id)
  if (error) {
    dbHata('piyasa analizi', error)
    el.innerHTML = `<span class="text-body-sm text-error">Piyasa verisi okunamadı.</span>`
    return
  }

  const tr = (data || []).find(x => x.kapsam === 'TR')
  const izm = (data || []).find(x => x.kapsam === 'IZMIR')

  if (!tr && !izm) {
    // ⚠️ "Ölçüm yok" ile "paket seçilmedi" AYNI ŞEY DEĞİL. Eski metin ikisini
    //    ayırmadan "paket seçilmediyse ölçüm yapılamaz" diyordu; Göksenil
    //    paketi SEÇTİĞİ hâlde bu uyarıyı gördü (10 Ağu 2026) ve seçimin
    //    kaydedilmediğini sandı. Oysa eşleşme yazılmıştı, robot henüz
    //    koşmamıştı. Mesaj artık eşleşmeyi OKUYUP durumu söylüyor.
    const { data: esl, error: eslErr } = await supabase.from('arabam_slug_eslesme')
      .select('slug, seviye, versiyon').eq('marka', a.marka || '').eq('model', a.model || '')
    if (eslErr) dbHata('arabam eşleşme', eslErr)
    // Sözlük (marka, model, versiyon) ile anahtarlı: aracın versiyonuna birebir
    // uyan PAKET kaydı varsa o, yoksa versiyonsuz MODEL kaydı geçerli.
    const kayit = (esl || []).find(x => (x.versiyon || '') === (a.versiyon || ''))
      || (esl || []).find(x => !x.versiyon) || null

    el.innerHTML = kayit
      ? `<div class="text-body-sm font-semibold text-on-surface">Ölçüm bekleniyor</div>
         <div class="text-[11px] text-on-surface-variant mt-1">
           Paket eşleşti: <b>${kacis(kayit.slug)}</b>${kayit.seviye === 'MODEL' ? ' (model geneli)' : ''}.<br>
           Ölçüm <b>fiyatlamaya gönderilirken başlatıldı</b> — genellikle birkaç dakikada gelir,
           sayfayı yenileyin. Gecikirse sabah 07:00 koşusu tamamlar.
         </div>`
      : `<div class="text-body-sm font-semibold text-amber-800">arabam paketi seçilmemiş</div>
         <div class="text-[11px] text-on-surface-variant mt-1">
           Ölçüm yapılabilmesi için paket eşleşmesi gerekiyor. Araç Kabul Merkezi'nden
           aracı kuyruktan geri alıp tekrar <b>Fiyatlamaya Gönder</b> dediğinde paket sorulur.
         </div>`
    return
  }

  const esas = tr || izm
  if (esas.hata) {
    el.innerHTML = `<div class="text-body-sm text-error">Ölçüm yapılamadı</div>
      <div class="text-[11px] text-on-surface-variant mt-1">${kacis(esas.hata)}</div>`
    return
  }

  // Net alış rakamı (yetersiz veri varsa rakam YOK — uydurma sayı gösterilmez)
  const netKutu = (x, etiket) => {
    if (!x) return ''
    const deger = x.yetersiz || x.nihai_alis == null
      ? `<div class="text-body-sm font-bold text-on-surface-variant">yetersiz veri</div>`
      : `<div class="text-headline-sm font-bold text-on-surface">${fmtPara(x.nihai_alis)}</div>`
    return `<div class="flex-1">
      <div class="text-[10px] uppercase tracking-wider text-on-surface-variant">${etiket}</div>
      ${deger}
      <div class="text-[10px] text-on-surface-variant">${x.ilan_adet || 0} ilan</div></div>`
  }

  // Döküm — Türkiye üzerinden (asıl karar rakamı)
  const satir = (et, sag, vurgu = false) => `<div class="flex justify-between text-body-sm py-0.5${vurgu ? ' font-bold border-t border-outline-variant mt-1 pt-1.5' : ''}">
    <span class="${vurgu ? '' : 'text-on-surface-variant'}">${et}</span><span>${sag}</span></div>`

  const d = esas
  const eksTutar = Math.round(d.saf_alis * (Number(d.ekspertiz_yuzde) || 0) / 100)
  const trmTutar = Math.round(d.saf_alis * (Number(d.tramer_yuzde) || 0) / 100)
  const dokum = d.yetersiz ? '' : `
    ${satir('Piyasa medyanı (hasarsız)', fmtPara(d.piyasa_tabani))}
    ${satir(`Kâr marjı −%${d.marj_yuzde}`, '−' + fmtPara(Math.round(d.piyasa_tabani - d.saf_alis)))}
    ${Number(d.ekspertiz_yuzde) ? satir(`Ekspertiz −%${d.ekspertiz_yuzde} (${d.hasarli_parca} parça)`, '−' + fmtPara(eksTutar)) : ''}
    ${Number(d.tramer_yuzde) ? satir(`Tramer −%${d.tramer_yuzde} (${fmtPara(d.tramer_tutari)})`, '−' + fmtPara(trmTutar)) : ''}
    ${satir('Net alış (Türkiye)', fmtPara(d.nihai_alis), true)}`

  const zaman = d.olcum_zamani ? new Date(d.olcum_zamani).toLocaleString('tr-TR',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  // ⚠️ "Model geneli" iki farklı sebepten olabilir ve ikisi AYNI ŞEY DEĞİL:
  //    a) sözlükte hiç paket seçilmemiş  → seçilirse rakam keskinleşir
  //    b) paket SEÇİLMİŞ ama ölçümü yetersiz kaldı → robot model geneline
  //       düştü (robotlar/piyasa/analiz.py). Burada "paket seçilirse
  //       keskinleşir" demek YANLIŞ; paket zaten seçili, arabam'da o pakete
  //       yetecek ilan yok. Göksenil bu cümleyi 10 Ağu 2026'da gördü ve
  //       seçimini yapmamış sandı — bugün üçüncü kez aynı sınıf hata.
  const seviyeEt = d.seviye === 'PAKET'
    ? 'Paket seviyesinde ölçüm'
    : d.paket_yetersizdi
      ? `Model geneli ölçüm — “${d.paket_yetersizdi}” paketinde yeterli ilan yok, model geneline düşüldü`
      : 'Model geneli ölçüm — paket seçilirse keskinleşir'

  el.innerHTML = `
    <div class="flex gap-3 mb-2">${netKutu(tr, 'Net alış · Türkiye')}${netKutu(izm, 'İzmir')}</div>
    ${dokum}
    <div class="text-[10px] text-on-surface-variant mt-2">${kacis(seviyeEt)}${zaman ? ' · ' + zaman : ''}${d.slug ? ' · ' + kacis(d.slug) : ''}</div>
    ${d.dusus_asildi ? `<div class="text-[11px] text-error mt-1">Düşüş toplamı %100'ü aştı — rakam elle değerlendirilmeli.</div>` : ''}`
}

async function notlarDoldur(a) {
  const el = document.getElementById('notlarListe'); if (!el) return
  const { data, error } = await supabase.from('arac_notlari')
    .select('id, icerik, created_at, danisman_id').eq('arac_id', a.id).order('created_at', { ascending: false })
  if (error) { dbHata('notlar', error); el.innerHTML = `<span class="text-body-sm text-error">Notlar okunamadı.</span>`; return }
  if (!(data || []).length) { el.innerHTML = `<div class="text-body-sm text-on-surface-variant">Henüz not yok.</div>`; return }
  const yonetebilir = !!(DANISMAN?.master_admin || DANISMAN?.rol === 'yonetici')   // master + yönetici (sen + İsmail Bey)
  el.innerHTML = data.map(n => {
    const ad = danismanAdi(DMAP, n.danisman_id); const t = new Date(n.created_at)
    return `<div class="flex gap-3 py-3 border-b border-outline-variant/40 last:border-0" data-not="${n.id}">
      <div class="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">${basHarf(ad)}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2"><span class="text-body-sm font-bold">${B(ad)}</span>
          <span class="flex items-center gap-1 shrink-0">
            <span class="text-[11px] text-on-surface-variant">${t.toLocaleDateString('tr-TR')} · ${t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            ${yonetebilir ? `<button class="not-duzenle w-6 h-6 rounded hover:bg-primary/10 text-primary flex items-center justify-center" title="Düzenle">${mat('edit', 'text-[14px]')}</button>
              <button class="not-sil w-6 h-6 rounded hover:bg-error/10 text-error flex items-center justify-center" title="Sil">${mat('delete', 'text-[14px]')}</button>` : ''}
          </span></div>
        <div class="not-metin text-body-sm text-on-surface mt-0.5">${kacis(n.icerik)}</div>
      </div></div>`
  }).join('')
  if (!yonetebilir) return
  el.querySelectorAll('.not-sil').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('[data-not]')?.dataset.not; if (!id) return
    if (!confirm('Bu not silinsin mi?')) return
    const { data: d, error: e } = await supabase.from('arac_notlari').delete().eq('id', id).select('id')
    if (e) { dbHata('not sil', e); toast('Not silinemedi: ' + e.message, false); return }
    if (!d || !d.length) { toast('Silme yetkiniz yok.', false); return }   // §5: 0 satır = yetki yok
    await notlarDoldur(a)
  }))
  el.querySelectorAll('.not-duzenle').forEach(b => b.addEventListener('click', () => {
    const row = b.closest('[data-not]'); const id = row?.dataset.not; if (!id) return
    const metinEl = row.querySelector('.not-metin'); const eski = metinEl.textContent
    metinEl.innerHTML = `<div class="flex items-center gap-2 mt-1">
      <input class="not-inp ${INP}" value="${kacis(eski)}" />
      <button class="not-kaydet bg-primary text-on-primary px-3 h-9 rounded-lg text-sm font-bold shrink-0 flex items-center">${mat('save', 'text-[16px]')}</button>
      <button class="not-vazgec border border-outline-variant px-3 h-9 rounded-lg text-sm font-bold shrink-0">Vazgeç</button></div>`
    const inp = metinEl.querySelector('.not-inp'); inp.focus()
    metinEl.querySelector('.not-vazgec').addEventListener('click', () => notlarDoldur(a))
    const kaydet = async () => {
      const yeni = inp.value.trim(); if (!yeni || yeni === eski) return notlarDoldur(a)
      const { data: d, error: e } = await supabase.from('arac_notlari').update({ icerik: yeni }).eq('id', id).select('id')
      if (e) { dbHata('not düzenle', e); toast('Not düzenlenemedi: ' + e.message, false); return }
      if (!d || !d.length) { toast('Düzenleme yetkiniz yok.', false); return }
      await notlarDoldur(a)
    }
    metinEl.querySelector('.not-kaydet').addEventListener('click', kaydet)
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') kaydet() })
  }))
}

function masrafListeCiz() {
  const el = document.getElementById('masrafListe'); if (!el) return
  if (!masraflar.length) { el.innerHTML = `<div class="text-[11px] text-on-surface-variant">Masraf eklenmedi.</div>`; return }
  el.innerHTML = `<div class="flex flex-wrap gap-2">${masraflar.map((m, i) =>
    `<span class="inline-flex items-center gap-1.5 bg-surface-container-high border border-outline-variant rounded-full pl-3 pr-1.5 py-1 text-[12px]" ${m.aciklama ? `title="${kacis(m.aciklama)}"` : ''}>
      <b>${kacis(buyuk(tanimAd('MASRAF_TIPI', m.tip)))}</b>${m.aciklama ? ` <span class="text-on-surface-variant">(${kacis(m.aciklama)})</span>` : ''} · ${fmtPara(m.tutar)}
      <button data-mi="${i}" class="mSil w-5 h-5 rounded-full hover:bg-error/10 text-error flex items-center justify-center">${mat('close', 'text-[14px]')}</button>
    </span>`).join('')}</div>`
  el.querySelectorAll('.mSil').forEach(b => b.addEventListener('click', async () => {
    const i = +b.dataset.mi; const m = masraflar[i]; if (!m) return
    if (m.id) {   // DB'de kayıtlı → sil
      const { data, error } = await supabase.from('arac_masraflar').delete().eq('id', m.id).select('id')
      if (error) { dbHata('masraf sil', error); return }
      if (!data || !data.length) return   // yetki yoksa 0 satır
    }
    masraflar.splice(i, 1)
    const secA = TUM.find(a => a.id === secili)
    if (secA?.arac_masraflar) secA.arac_masraflar = secA.arac_masraflar.filter(x => x.id !== m.id)
    masrafListeCiz(); guncelleProjeksiyon()
  }))
}

function guncelleProjeksiyon() {
  const kutu = document.getElementById('karKutu'); if (!kutu) return
  const num = id => paraNum(id) || 0
  const alis = num('fAlis'), satis = num('fSatis')
  const masrafTop = masraflar.reduce((s, m) => s + (Number(m.tutar) || 0), 0)
  const maliyet = alis + masrafTop
  const kar = satis - maliyet
  const marj = satis > 0 ? (kar / satis) * 100 : 0
  kutu.innerHTML = `
    <div class="text-label-xs uppercase tracking-wider opacity-80 mb-2">Karlılık Projeksiyonu</div>
    <div class="grid grid-cols-2 gap-3 text-sm">
      <div><div class="opacity-70 text-[11px]">Alış / Masraf</div><div class="font-bold">${fmtPara(alis)} / ${fmtPara(masrafTop)}</div></div>
      <div><div class="opacity-70 text-[11px]">Toplam Maliyet</div><div class="font-bold">${fmtPara(maliyet)}</div></div>
    </div>
    <div class="mt-3 pt-3 border-t border-white/20 flex items-end justify-between">
      <div><div class="opacity-70 text-[11px]">Net Kâr Hedefi</div><div class="text-heading-md font-bold">${fmtPara(kar)}</div></div>
      <div class="text-right"><div class="opacity-70 text-[11px]">Marj</div><div class="text-heading-md font-bold">%${marj.toFixed(2).replace('.', ',')}</div></div>
    </div>`
}

function bagla() {
  document.querySelectorAll('.fq-satir').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.id === secili) return
    secili = b.dataset.id; ciz()   // masraflar ciz() içinde araçtan yüklenir
  }))
  const secA = TUM.find(a => a.id === secili)
  if (!secA) return
  // Para alanları yazarken "1.000.000" biçimi
  document.querySelectorAll('.para').forEach(el => el.addEventListener('input', e => { e.target.value = paraFmt(e.target.value) }))
  ;['fAlis', 'fSatis', 'fMin'].forEach(id => document.getElementById(id)?.addEventListener('input', guncelleProjeksiyon))
  // Masraf tipi/alış şekli seçilince tutarı varsayılanla doldur (elle yazılmadıysa)
  const mTutarEl = document.getElementById('mTutar')
  const otoDoldur = () => {
    if (!mTutarEl || mTutarEl.dataset.elle === '1') return   // kullanıcı yazdıysa dokunma
    const v = masrafVarsayilan(document.getElementById('mTip')?.value, document.getElementById('fSekli')?.value)
    mTutarEl.value = v != null ? paraFmt(v) : ''
    mTutarEl.dataset.oto = v != null ? '1' : ''
  }
  document.getElementById('mTip')?.addEventListener('change', otoDoldur)
  // G5 — operasyon iş yazmadıysa uyar (engel DEĞİL, sql/111)
  masrafKapiBagla({ tipEl: document.getElementById('mTip'), kapId: 'mOpUyari',
                    aracId: () => secili })
  document.getElementById('fSekli')?.addEventListener('change', otoDoldur)
  mTutarEl?.addEventListener('input', () => { mTutarEl.dataset.elle = mTutarEl.value ? '1' : '' })
  // Ekle → anında arac_masraflar'a yaz (masrafEkle); varsayılan tutar + para biçimi korunur
  document.getElementById('mEkle')?.addEventListener('click', () => masrafEkle(secA))
  // "Diğer" seçilince açıklama kutusu açılır ve odaklanır
  document.getElementById('mTip')?.addEventListener('change', e => {
    const kap = document.getElementById('mAciklamaKap')
    const digerMi = e.target.value === 'DIGER'
    kap?.classList.toggle('hidden', !digerMi)
    kap?.classList.toggle('flex', digerMi)
    if (digerMi) document.getElementById('mAciklama')?.focus()
    else { const ac = document.getElementById('mAciklama'); if (ac) ac.value = '' }
  })
  // Enter ile ekle — tutar VE açıklama alanlarında (Göksenil: "enter'a basınca
  // eklemesi gerekiyor"). Not kutusundaki desenle aynı.
  for (const id of ['mTutar', 'mAciklama']) {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); masrafEkle(secA) }
    })
  }
  document.getElementById('fIhale')?.addEventListener('click', () => ihaleIsaretle(secA))
  document.getElementById('fIade')?.addEventListener('click', () => iadeAc(secA))
  document.getElementById('fKaydet')?.addEventListener('click', () => kaydet(secA, true))
  document.getElementById('fKaydetTaslak')?.addEventListener('click', () => kaydet(secA, false))
  document.getElementById('notEkle')?.addEventListener('click', () => notEkle(secA))
  document.getElementById('notInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') notEkle(secA) })
  document.querySelectorAll('[data-evrakac]').forEach(b => b.addEventListener('click', () => evrakPopupAc(b.dataset.evrakac)))
  masrafListeCiz()
}

// Masraf ekle → ANINDA arac_masraflar'a yaz (son "Kaydet"i beklemez; tekrar açılınca gelir)
async function masrafEkle(a) {
  const tip = document.getElementById('mTip').value
  const tutar = paraNum('mTutar')
  const acEl = document.getElementById('mAciklama')
  const aciklama = (acEl?.value || '').trim()

  // Sessizce çıkma — ne eksikse SÖYLE. Önceden `if (!tip || !tutar) return`
  // hiçbir uyarı vermeden duruyordu; kullanıcı Ekle'ye basıp bir şey
  // olmamasını anlamıyordu (bugün defalarca aynı sınıf: doğru davranış +
  // sessiz sonuç).
  if (!tip)   { uyariGoster('Masraf tipi seçin.'); return }
  if (!tutar) { uyariGoster('Tutar girin.'); document.getElementById('mTutar')?.focus(); return }
  if (tip === 'DIGER' && !aciklama) {
    uyariGoster('"Diğer" masrafın ne olduğunu yazın — açıklamasız kalem ay sonunda anlamsız kalır.')
    acEl?.focus(); return
  }

  const { data, error } = await supabase.from('arac_masraflar')
    .insert({ arac_id: a.id, masraf_tipi: tip, tutar, yon: 'GIDER',
              aciklama: aciklama || null, olusturan: DANISMAN?.id || null })
    .select('id').single()
  if (error) { dbHata('masraf ekle', error); uyariGoster('Masraf eklenemedi (yetki?): ' + error.message); return }
  masraflar.push({ id: data.id, tip, tutar, aciklama: aciklama || null })
  a.arac_masraflar = [...(a.arac_masraflar || []), { id: data.id, masraf_tipi: tip, tutar, aciklama: aciklama || null }]
  document.getElementById('mTip').value = ''
  const mt = document.getElementById('mTutar')
  if (mt) { mt.value = ''; mt.dataset.elle = ''; mt.dataset.oto = '' }   // varsayılan tekrar dolabilsin
  if (acEl) acEl.value = ''
  const kap = document.getElementById('mAciklamaKap')
  kap?.classList.add('hidden'); kap?.classList.remove('flex')
  document.getElementById('mTip')?.focus()   // arka arkaya masraf girişi hızlansın
  masrafListeCiz(); guncelleProjeksiyon()
}

async function notEkle(a) {
  const inp = document.getElementById('notInput'); const v = (inp?.value || '').trim(); if (!v) return
  const { error } = await supabase.from('arac_notlari').insert({ arac_id: a.id, danisman_id: DANISMAN?.id || null, icerik: v })
  if (error) { dbHata('not ekle', error); alert('Not eklenemedi: ' + error.message); return }
  inp.value = ''; await notlarDoldur(a)
}

// Formdaki fiyat alanlarını yazar — TEK KAYNAK.
// Hem "Fiyatla/Kaydet" hem "İhalede Satılacak" bunu çağırır. İki ayrı yazma
// yolu olsaydı biri düzeltilip diğeri unutulurdu (bu projede en sık yapılan
// hata, var olan bir yardımcının kopyasını yazmak).
//
// DOĞRULAMA YAPMAZ — hangi alanın zorunlu olduğuna ÇAĞIRAN karar verir:
// Kaydet üçünü de ister, İhale hiçbirini istemez (Göksenil, 15 Ağu 2026).
//
// ⚠️ Boş bırakılan alan YAZILMAZ. Kolonlar null kabul ediyor ama boş bir
//    alanın mevcut dolu değerin üzerine null yazması veri kaybı olurdu.
// ⚠️ .update()/.insert() RLS engellediğinde HATA VERMEZ, 0 satır döner
//    (CLAUDE.md §5.1). Bu yüzden her yazmada .select('id') + uzunluk kontrolü:
//    aksi hâlde "kaydedildi" der, hiçbir şey yazılmaz.
async function fiyatAlanlariniYaz(a) {
  const alis = paraNum('fAlis'), satis = paraNum('fSatis'), min = paraNum('fMin')
  const sekli = document.getElementById('fSekli')?.value || ''

  // 1) Alış: mevcut satırı güncelle (yoksa oluştur)
  if (alis != null || sekli) {
    const yama = {}
    if (alis != null) yama.alis_fiyati = alis
    if (sekli) yama.alis_sekli = sekli
    if (a._alis) {
      const { data, error } = await supabase.from('arac_alislar')
        .update(yama).eq('arac_id', a.id).select('id')
      if (error) { dbHata('arac_alislar güncelle', error); return { ok: false, msg: 'Alış güncellenemedi (yetki?): ' + error.message } }
      if (!data?.length) return { ok: false, msg: 'Alış güncellenemedi — hiçbir satır değişmedi (yetki?).' }
    } else {
      const { data, error } = await supabase.from('arac_alislar')
        .insert({ arac_id: a.id, alis_tarihi: new Date().toISOString().slice(0, 10), ...yama })
        .select('id')
      if (error) { dbHata('arac_alislar insert', error); return { ok: false, msg: 'Alış kaydı eklenemedi (yetki?): ' + error.message } }
      if (!data?.length) return { ok: false, msg: 'Alış kaydı eklenemedi (yetki?).' }
    }
  }

  // 2) Satış/min: append-only fiyat satırı — AMA son fiyatla BİREBİR aynıysa
  //    yeni geçmiş satırı AÇMA (tekrar Kaydet'te mükerrer satır olmasın).
  if (satis != null || min != null) {
    const oncekiSatis = a._fiyat?.satis_fiyati != null ? Number(a._fiyat.satis_fiyati) : null
    const oncekiMin = a._fiyat?.min_satis_fiyati != null ? Number(a._fiyat.min_satis_fiyati) : null
    if (!(oncekiSatis === satis && oncekiMin === (min ?? null))) {
      const { data, error } = await supabase.from('arac_fiyatlar')
        .insert({ arac_id: a.id, satis_fiyati: satis, min_satis_fiyati: min, degistiren_danisman_id: DANISMAN?.id || null })
        .select('id')
      if (error) { dbHata('arac_fiyatlar', error); return { ok: false, msg: 'Fiyat kaydı eklenemedi (yetki?): ' + error.message } }
      if (!data?.length) return { ok: false, msg: 'Fiyat kaydı eklenemedi (yetki?).' }
    }
  }
  // 3) Masraflar zaten anında kaydedildi (masrafEkle) — burada tekrar yazılmaz
  return { ok: true }
}

async function kaydet(a, stoga) {
  const num = id => paraNum(id)
  const alis = num('fAlis'), satis = num('fSatis')
  const sekli = document.getElementById('fSekli')?.value || ''
  if (!alis) return uyariGoster('Alış fiyatı zorunlu.')
  if (!satis) return uyariGoster('Satış fiyatı zorunlu.')
  if (!sekli) return uyariGoster('Alış şekli zorunlu.')

  const btnlar = [document.getElementById('fKaydet'), document.getElementById('fKaydetTaslak')]
  const btn = document.getElementById(stoga ? 'fKaydet' : 'fKaydetTaslak')
  const eskiHtml = btn.innerHTML
  btnlar.forEach(b => b && (b.disabled = true)); btn.textContent = 'Kaydediliyor…'
  try {
    const y = await fiyatAlanlariniYaz(a)
    if (!y.ok) return uyariGoster(y.msg)
    // Stoğa al (opsiyonel)
    if (stoga) {
      const { data, error: se } = await supabase.from('stok_araclar')
        .update({ fiyatlama_durumu: 'FIYATLANDI', durum: 'STOKTA' }).eq('id', a.id).select('id')
      if (se) { dbHata('stok_araclar güncelle', se); return uyariGoster('Durum güncellenemedi: ' + se.message) }
      if (!data?.length) return uyariGoster('Durum güncellenemedi — hiçbir satır değişmedi (yetki?).')
      secili = null
    }
    masraflar = []
    toast(stoga ? 'Fiyatlandı ve stoğa alındı.' : 'Taslak kaydedildi.')
    await yukle()
  } finally {
    btnlar.forEach(b => b && (b.disabled = false)); if (document.getElementById(btn.id)) btn.innerHTML = eskiHtml
  }
}

// ---------- İHALEDE SATILACAK (sql/110, sql/206) ----------
// Göksenil: "fiyatlama sayfasında da kalsın, İsmail Bey 'ihalede satılacak'
// diyebilir. AMA BURADA İHALEDE SATILACAK KARARINI İSMAİL BEY VERİYOR."
//
// 15 Ağu 2026 — ONAY ADIMI KALDIRILDI: "İsmail Bey ihalede satılacak
// işaretlediğinde onaysız ihale sayfasına göndersin, yine bana bildirim
// gelsin." Karar da onay da İsmail Bey'de; master admin haberdar edilir
// ama akışı beklemez (BK-41 bildirimi devam ediyor, metni güncellendi).
//
// Aşağıdaki "İhale onayında" etiketi ESKİ kayıtlar için duruyor: sql/206
// öncesinde işaretlenmiş ve hâlâ onay bekleyen satırlar var.
// ── BİLGİ İŞLEME İADE (sql/216) ───────────────────────────────────────────
// Göksenil, 18 Ağu 2026: "araç bilgilerinde sorun varsa bilgi işleme iade
// edebilmeli". Önceden İsmail Bey özelden mesaj atıyor, Göksenil Araç
// Kabul'den düzeltip tekrar gönderiyordu — sistemde hiç izi yoktu.
//
// ⚠️ SEBEP ZORUNLU ve HAZIR SEÇENEKLİ. Serbest metin tek başına bırakılsaydı
//    "bu araç yanlış" yazılırdı; bilgi işlem yine neyin yanlış olduğunu
//    aramak zorunda kalırdı. Hazır seçenekler ölçümden geldi (audit_log:
//    en çok düzeltilen alanlar).
const IADE_SEBEPLERI = [
  'Ekspertiz raporu hatalı / eksik',
  'Ruhsat bilgileri hatalı',
  'Plaka veya şasi hatalı',
  'Alış fiyatı / alış şekli hatalı',
  'Evrak eksik',
  'Araç bilgileri hatalı (km, renk, donanım)',
]

function iadeDugmesi(a) {
  if (!a) return ''
  return `<button id="fIade" class="px-4 h-11 flex items-center gap-1.5 rounded-lg border border-error/40 text-error hover:bg-error/5 text-sm font-bold" title="Araç bilgilerinde sorun var — bilgi işleme geri gönder">
    ${mat('assignment_return', 'text-[18px]')} Bilgi İşleme İade</button>`
}

function iadeAc(a) {
  if (!a) return
  document.getElementById('iadeKutu')?.remove()
  const d = document.createElement('div')
  d.id = 'iadeKutu'
  d.className = 'fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4'
  d.innerHTML = `
    <div class="bg-surface rounded-xl shadow-xl w-full max-w-lg p-5" role="dialog" aria-modal="true">
      <h3 class="text-title-md font-black text-on-surface flex items-center gap-2">
        ${mat('assignment_return', 'text-[20px] text-error')} Bilgi İşleme İade</h3>
      <p class="text-body-sm text-on-surface-variant mt-1">
        <b>${kacis(trBuyuk(a.plaka || ''))}</b> fiyatlama kuyruğundan çıkacak ve bilgi işleme
        bildirim gidecek. Düzeltilince kuyruğa geri döner ve size haber verilir.</p>
      <p class="text-[12px] font-bold text-on-surface mt-4 mb-1.5">Sorun ne? <span class="text-error">*</span></p>
      <div id="iadeSecenek" class="flex flex-wrap gap-1.5">
        ${IADE_SEBEPLERI.map((r, i) => `<button type="button" data-sebep="${i}"
            class="px-2.5 py-1.5 rounded-lg border border-outline-variant text-[12px] font-bold text-on-surface hover:bg-primary/5 transition-colors">${kacis(r)}</button>`).join('')}
      </div>
      <textarea id="iadeNot" rows="3" placeholder="Ayrıntı (isteğe bağlı ama yardımcı olur)"
        class="${INP} mt-3 resize-none"></textarea>
      <div id="iadeUyari" class="text-[12px] text-error mt-1.5 min-h-[16px]"></div>
      <div class="flex justify-end gap-2 mt-3">
        <button id="iadeVazgec" class="px-4 h-10 rounded-lg border border-outline-variant text-sm font-bold text-on-surface">Vazgeç</button>
        <button id="iadeGonder" class="px-4 h-10 rounded-lg bg-error text-white text-sm font-bold flex items-center gap-1.5">
          ${mat('send', 'text-[17px]')} İade Et</button>
      </div>
    </div>`
  document.body.appendChild(d)

  let secilenler = new Set()
  d.querySelectorAll('[data-sebep]').forEach(b => b.addEventListener('click', () => {
    const i = b.dataset.sebep
    if (secilenler.has(i)) { secilenler.delete(i); b.classList.remove('bg-error-container', 'border-error', 'text-on-error-container') }
    else { secilenler.add(i); b.classList.add('bg-error-container', 'border-error', 'text-on-error-container') }
    document.getElementById('iadeUyari').textContent = ''
  }))
  const kapat = () => d.remove()
  d.addEventListener('click', e => { if (e.target === d) kapat() })
  document.getElementById('iadeVazgec').addEventListener('click', kapat)
  document.getElementById('iadeGonder').addEventListener('click', () => iadeGonder(a, secilenler, kapat))
  document.getElementById('iadeNot').focus()
}

async function iadeGonder(a, secilenler, kapat) {
  const not = (document.getElementById('iadeNot')?.value || '').trim()
  const basliklar = [...secilenler].sort().map(i => IADE_SEBEPLERI[i])
  // Sebep zorunlu: ya seçenek ya metin. İkisi de boşsa sunucu da reddeder,
  // ama kullanıcı sunucuya gitmeden görsün.
  if (!basliklar.length && !not) {
    document.getElementById('iadeUyari').textContent = 'En az bir sorun seçin ya da ayrıntı yazın.'
    return
  }
  const neden = [basliklar.join(' · '), not].filter(Boolean).join(' — ')

  const btn = document.getElementById('iadeGonder')
  const eski = btn?.innerHTML
  if (btn) { btn.disabled = true; btn.textContent = 'Gönderiliyor…' }

  const { data, error } = await supabase.rpc('fiyatlama_iade', { p_arac: a.id, p_neden: neden })
  if (error) {                                   // CLAUDE.md §5.4 — sessiz catch yok
    console.error('[DMS] fiyatlama iade', error)
    document.getElementById('iadeUyari').textContent = 'Gönderilemedi: ' + error.message
    if (btn) { btn.disabled = false; btn.innerHTML = eski }
    return
  }
  if (!data?.ok) {                               // RPC iş kuralı reddi (yetki/durum)
    document.getElementById('iadeUyari').textContent = data?.hata || 'İade edilemedi.'
    if (btn) { btn.disabled = false; btn.innerHTML = eski }
    return
  }
  kapat()
  secili = null                                  // araç kuyruktan çıktı
  masraflar = []
  toast('Araç bilgi işleme iade edildi.')
  await yukle()
}

function ihaleDugmesi(a) {
  if (!ihaleIsaretler(DANISMAN) || !a) return ''
  const mevcut = IHALE[a.id]
  if (mevcut) {
    const etiket = mevcut.onay_durumu === 'BEKLIYOR' ? 'İhale onayında'
      : mevcut.durum === 'IHALEDE' ? 'İhalede' : 'İhaleye çıkacak'
    return `<span class="mr-auto px-3 h-11 flex items-center gap-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-bold">
      ${mat('gavel', 'text-[18px]')} ${etiket}</span>`
  }
  return `<button id="fIhale" class="mr-auto px-4 h-11 flex items-center gap-1.5 rounded-lg border border-primary/40 text-primary hover:bg-primary/5 text-sm font-bold" title="Bu araç perakende yerine ihalede satılsın">
    ${mat('gavel', 'text-[18px]')} İhalede Satılacak</button>`
}

async function ihaleIsaretle(a) {
  if (!a) return
  if (!confirm(`${trBuyuk(a.plaka || '')} ihale listesine gönderilecek.

Ekrandaki fiyatlama kaydedilecek ve araç fiyatlama kuyruğundan çıkacak.
Devam edilsin mi?`)) return
  const not = prompt('Not (neden ihaleye çıkıyor?) — opsiyonel')
  if (not === null) return   // vazgeçti
  const btn = document.getElementById('fIhale')
  const eskiHtml = btn?.innerHTML
  if (btn) { btn.disabled = true; btn.textContent = 'Gönderiliyor…' }

  // ⚠️ ÖNCE FİYATLAMA KAYDEDİLİR — bu adım eskiden YOKTU.
  //    İşaretlemenin ardından yukle() sayfayı veritabanından yeniden çiziyor;
  //    İsmail Bey'in yazdığı ama "Fiyatla/Kaydet"e basmadığı rakamlar orada
  //    uçuyordu. "Fiyatlamayı baştan girmek zorunda kalıyorum" şikâyetinin
  //    sebebi buydu — veritabanından silinen bir şey yoktu, hiç yazılmıyordu.
  //    Zorunlu alan YOK (Göksenil, 15 Ağu 2026): ne doldurulmuşsa o yazılır.
  const y = await fiyatAlanlariniYaz(a)
  if (!y.ok) {
    uyariGoster(y.msg)
    if (btn) { btn.disabled = false; btn.innerHTML = eskiHtml }
    return
  }

  // Onay adımı kaldırıldı (sql/206): kayıt doğrudan ONAYLANDI+HAZIR açılır,
  // araç ihale sayfasının "Süreç" sekmesine düşer. Master admine bildirim
  // yine gider (BK-41).
  const { error } = await supabase.rpc('ihale_isaretle', { p_arac: a.id, p_not: not.trim() || null })
  if (error) {
    console.error('[DMS] ihale isaretle', error)
    uyariGoster('İşaretlenemedi: ' + error.message)
    if (btn) { btn.disabled = false; btn.innerHTML = eskiHtml }
    return
  }
  secili = null       // araç kuyruktan çıktı, seçim bir sonrakine geçsin
  masraflar = []
  toast('Fiyatlama kaydedildi, araç ihale listesine gönderildi.')
  await yukle()
}

// Global başarı/hata bildirimi (KOK yeniden çizilse de body'de kalır)
function toast(msg, basari = true) {
  const t = document.createElement('div')
  t.className = `fixed bottom-5 left-1/2 -translate-x-1/2 z-[95] px-4 py-2.5 rounded-lg shadow-lg text-sm font-bold flex items-center gap-2 ${basari ? 'bg-[#065F46] text-white' : 'bg-error text-white'}`
  t.innerHTML = `${mat(basari ? 'check_circle' : 'error', 'text-[18px]')} ${kacis(msg)}`
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 3000)
}

function uyariGoster(msg) {
  const kap = document.getElementById('fUyariKap')
  if (kap) {
    kap.innerHTML = `<div class="bg-error-container text-on-error-container border border-error/20 rounded-lg px-3 py-2 text-sm">${kacis(msg)}</div>`
    kap.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => { if (kap) kap.innerHTML = '' }, 4000)
  } else alert(msg)
}
