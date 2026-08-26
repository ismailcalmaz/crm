// =====================================================================
// arac-kabul.js — Araç Kabul Merkezi (Alış Listesi). Stitch "next-gen".
//   Satıra/İşlemler tıkla → Araç Detayı POP-UP (arac-detay.js · aracDetayAc).
//   Checkbox seçince toplu işlem çubuğu. "Yeni Araç Kabul" → workbench.
//   stok_araclar + arac_evraklar/ekspertiz/tramer/alislar'a bağlı.
//   Bkz [[dms-alis-fiyatlama-tasarim]].
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, danismanAdi, fmtPara, kacis, trBuyuk, buyuk, dbHata, aracEtiket, ARAC_STOK_DURUMLARI, ARAC_DURUM_GRUP } from './veri.js'
import { mat, basHarf, bosDurum, uyari, toast } from './stitch-ui.js'
import { aracDetayAc } from './arac-detay.js'

const KOK = () => document.getElementById('kok')
let DANISMAN = null
let TUM = []
let DMAP = {}
let secili = null
let arama = ''
let filtre = 'tumu'
let secim = new Set()   // toplu seçim (checkbox)
let MENU_EL = null, MENU_DIS = null   // "..." işlem menüsü (fixed, body'ye eklenir)
let KPI = null                        // v_kpi_alis (F5 — JS'te sayım YOK)

const B = v => kacis(buyuk(v ?? ''))
// Araç kabul hattını GEÇMİŞ durumlar — veri.js tek kaynak (sql/86)
const STOK_DURUM = ARAC_STOK_DURUMLARI

export async function aracKabulKur(d) {
  DANISMAN = d
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant text-body-md">Araçlar yükleniyor…</div>`
  DMAP = await danismanMap()
  await yukle()
}

async function yukle() {
  const { data, error } = await supabase.from('stok_araclar')
    .select(`id, plaka, stok_kodu, marka, model, versiyon, yil, yakit, vites, km, renk, durum, park, lokasyon, fiyatlama_durumu, fiyatlama_iade_nedeni, fiyatlama_iade_zamani, created_at, olusturan,
             ekspertiz_orijinal, tramer_temiz,
             arac_evraklar(id, tip, url), arac_ekspertiz(durum), arac_tramer(id), arac_alislar(alis_fiyati, alis_sekli),
             ihale_cikislari(id, durum)`)
    // Araç Kabul = alış/kabul hattı: henüz stoğa GEÇMEMİŞ araçlar. Stok/operasyon/
    // satış durumundakiler Stok Merkezi'ne geçmiştir, burada görünmez (Göksenil
    // kararı). ALIŞ grubunun TAMAMI listelenir (sql/86) — yeni bir alış durumu
    // eklenince araç sessizce kaybolmasın.
    .in('durum', ARAC_DURUM_GRUP.ALIS)
    .order('created_at', { ascending: false })
  if (error) { dbHata('arac-kabul yükle', error); KOK().innerHTML = uyari('Araçlar okunamadı: ' + kacis(error.message)); return }
  const { data: kpi, error: kErr } = await supabase.from('v_kpi_alis').select('*').maybeSingle()
  if (kErr) dbHata('v_kpi_alis', kErr)
  KPI = kpi || null
  // ⚠️ İHALEYE ÇIKARILAN ARAÇ BU LİSTEDE DURMAZ (Göksenil, 21 Ağu 2026:
  //   "ihale sayfasında olan araç burada görünmeye devam ediyor").
  //   Sebep: `ihale_isaretle` YALNIZ `fiyatlama_durumu='FIYATLANDI'` yazıyor,
  //   aracın `durum`una dokunmuyor. Araç `ALINDI` kalıyor, bu liste de
  //   ALIŞ grubunun tamamını gösterdiği için araç "Fiyatlandı" etiketiyle
  //   asılı kalıyordu (canlıda iki araç: 35YT336, 77ADK633).
  // ⚠️ Aracın DURUMUNU değiştirerek çözmedik: ihaledeki araç fiziksel olarak
  //   hâlâ bizde ve durum makinesine dokunmak bütün akışı etkilerdi. Süzme
  //   burada, tek satırda.
  // ⚠️ Yalnız AÇIK ihale kaydı düşürür. Geri çekilen (GERI_CEKILDI) ya da
  //   satılan (SATILDI) araç listeye kendiliğinden geri gelir.
  const IHALE_ACIK = ['ONAY_BEKLIYOR', 'HAZIR', 'IHALEDE']
  const ihaledeMi = a => (a.ihale_cikislari || []).some(i => IHALE_ACIK.includes(i.durum))
  TUM = (data || []).filter(a => !ihaledeMi(a)).map(nitele)
  // seçili artık sadece satır vurgusu (panel yok); geçersizse ilk araç
  if (!secili || !TUM.find(a => a.id === secili)) secili = TUM[0]?.id || null
  // toplu seçimden silinmiş araçları at
  secim = new Set([...secim].filter(id => TUM.find(a => a.id === id)))
  ciz()
}

// Bir araç satırının türetilmiş durum bilgileri
function nitele(a) {
  const evr = new Set((a.arac_evraklar || []).map(e => e.tip))
  const eksSay = (a.arac_ekspertiz || []).length
  const trmSay = (a.arac_tramer || []).length
  const alis = (a.arac_alislar || [])[0] || null
  return {
    ...a,
    _foto: evr.has('SBM_GORSEL'),
    _ekspertizPdf: evr.has('EKSPERTIZ_PDF') || evr.has('EKSPERTIZ_LINK'),
    _ruhsat: evr.has('RUHSAT'),
    // Orijinal araçta işaretlenecek parça, temiz araçta hasar satırı OLMAZ.
    // "Satır yok" tek başına eksiklik değil; kabulde verilen açık onay
    // (ekspertiz_orijinal / tramer_temiz) da bölümü TAMAM sayar.
    _ekspertiz: eksSay > 0 || !!a.ekspertiz_orijinal,
    _tramer: trmSay > 0 || !!a.tramer_temiz,
    _ekspertizOrijinal: eksSay === 0 && !!a.ekspertiz_orijinal,
    _tramerTemiz: trmSay === 0 && !!a.tramer_temiz,
    _alisFiyati: alis?.alis_fiyati ?? null,
    _alisSekli: alis?.alis_sekli || null,
    _hazir: (trmSay > 0 || !!a.tramer_temiz) && (eksSay > 0 || !!a.ekspertiz_orijinal)
            && (evr.has('EKSPERTIZ_PDF') || evr.has('EKSPERTIZ_LINK')) && evr.has('RUHSAT'),
  }
}
// ⚠️ FİYATLAMA DURUMU BU ROZETTE GÖRÜNMEK ZORUNDA (Göksenil, 7 Ağu 2026:
//    "fiyatlamaya gönder butonu çalışmıyor"). Buton ÇALIŞIYORDU — kayıt
//    yazılıyor, araç Fiyatlama Merkezi'ne düşüyordu; ama satır tıklamadan
//    önceki hâliyle bire bir aynı kalıyordu. Kullanıcı için "hiçbir şey
//    olmadı" = "buton bozuk". Sessiz başarı, başarısızlıkla aynı görünür.
//    Stok durumu fiyatlamadan SONRA gelir, o yüzden ilk sırada kalır.
function durumBilgi(a) {
  if (a.durum === 'STOKTA' || a.durum === 'YAYINDA') return { ad: a.durum === 'YAYINDA' ? 'Yayında' : 'Stokta', cls: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#3B82F6]/30' }
  // İADE en görünür durum: araç kimsenin kuyruğunda değil, bekliyor (sql/216).
  if (a.fiyatlama_durumu === 'IADE') return { ad: 'Fiyatlamadan İade', cls: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/40' }
  if (a.fiyatlama_durumu === 'FIYATLANDI') return { ad: 'Fiyatlandı', cls: 'bg-[#F0FDFA] text-[#0F766E] border-[#14B8A6]/30' }
  if (a.fiyatlama_durumu === 'BEKLIYOR') return { ad: 'Fiyatlamada', cls: 'bg-[#EEF2FF] text-[#4338CA] border-[#6366F1]/30' }
  if (a._hazir && a.durum === 'ALINDI') return { ad: 'Stoğa Hazır', cls: 'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30' }
  if (a._ekspertiz || a._tramer) return { ad: 'İnceleme', cls: 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30' }
  return { ad: 'Ön Kayıt', cls: 'bg-surface-container-high text-on-surface-variant border-outline-variant/30' }
}

// Bir aracın eksikleri — "Eksik Evrak: 1" tıklanınca NEYİN eksik olduğunu
// yazabilmek için tek kaynak. Sıra = kullanıcının gördüğü sıra.
//   zorunlu:true → "Eksik Evrak" KPI/filtresini besleyen belgeler.
const EKSIK_TANIM = [
  { anahtar: '_ekspertizPdf', ad: 'Ekspertiz PDF', ikon: 'assignment', zorunlu: true },
  { anahtar: '_ruhsat',       ad: 'Ruhsat',        ikon: 'badge',      zorunlu: true },
  { anahtar: '_ekspertiz',    ad: 'Ekspertiz işaretlemesi (boya/değişen)', ikon: 'assignment_turned_in', zorunlu: false },
  { anahtar: '_tramer',       ad: 'Tramer hasar kaydı', ikon: 'search_check', zorunlu: false },
  { anahtar: '_foto',         ad: 'Tramer / SBM görseli', ikon: 'image', zorunlu: false },
]
const eksikListe = a => EKSIK_TANIM.filter(t => !a[t.anahtar])

// "Eksik Evrak" KPI → hangi araçta ne eksik, tek bakışta
function eksikEvrakPopup() {
  const liste = TUM.filter(a => !a._ekspertizPdf || !a._ruhsat)
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4'
  const govde = liste.length ? liste.map(a => {
    const eksik = eksikListe(a)
    const rozet = e => `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${e.zorunlu ? 'bg-error-container text-on-error-container border-error/20' : 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30'}">${mat(e.ikon, 'text-[13px]')} ${kacis(e.ad)}</span>`
    return `<button data-git="${a.id}" class="w-full text-left p-3 rounded-xl border border-outline-variant hover:border-primary/40 hover:bg-primary/5 transition-colors">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-body-sm font-bold text-primary">${aracEtiket(a) || '—'}</span>
        <span class="text-[11px] text-on-surface-variant truncate">${a.yil ? a.yil + ' ' : ''}${B(a.marka)} ${B(a.model)}</span>
        <span class="ml-auto text-[10px] text-on-surface-variant shrink-0">${mat('open_in_new', 'text-[14px]')}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">${eksik.map(rozet).join('')}</div>
    </button>`
  }).join('') : `<div class="p-4">${bosDurum('Eksik evrakı olan araç yok.', 'task_alt')}</div>`

  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('folder_off', 'text-[20px]')} Eksik Evrak (${liste.length})</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="p-4 flex flex-col gap-2 overflow-y-auto">${govde}</div>
      <div class="px-4 py-2.5 border-t border-outline-variant text-[11px] text-on-surface-variant">
        <b>Kırmızı</b> = evrak eksik (bu sayıya girer) · <b>Sarı</b> = veri eksik (bilgi amaçlı). Satıra tıkla → araç detayı.
      </div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  ov.querySelectorAll('[data-git]').forEach(b => b.addEventListener('click', () => {
    kapat(); aracDetayAc(b.dataset.git, DANISMAN, { sekme: 'evraklar', onKapat: yukle })
  }))
  document.addEventListener('keydown', esc)
}

// Tek aracın eksikleri (satırdaki "N eksik" rozeti)
function aracEksikPopup(a) {
  const eksik = eksikListe(a)
  if (!eksik.length) return
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-primary">${aracEtiket(a) || 'Araç'} — Eksikler</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="flex flex-col gap-1.5">${eksik.map(e => `<div class="flex items-center gap-2 text-body-sm p-2 rounded-lg ${e.zorunlu ? 'bg-error-container/40 text-on-error-container' : 'bg-[#FFFBEB] text-[#92400E]'}">${mat(e.ikon, 'text-[18px]')} ${kacis(e.ad)}</div>`).join('')}</div>
      <button data-git class="w-full mt-3 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90">Araç Detayını Aç</button>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  ov.querySelector('[data-git]').addEventListener('click', () => { kapat(); aracDetayAc(a.id, DANISMAN, { sekme: 'evraklar', onKapat: yukle }) })
  document.addEventListener('keydown', esc)
}

function filtreli() {
  let liste = TUM
  const q = trBuyuk(arama).trim()
  if (q) liste = liste.filter(a => (aracEtiket(a).includes(q) || trBuyuk(a.stok_kodu).includes(q)) || trBuyuk(a.marka).includes(q) || trBuyuk(a.model).includes(q))
  switch (filtre) {
    case 'bugun': { const b = new Date(); b.setHours(0, 0, 0, 0); liste = liste.filter(a => new Date(a.created_at) >= b); break }
    case 'hafta': { const h = new Date(); h.setDate(h.getDate() - 7); liste = liste.filter(a => new Date(a.created_at) >= h); break }
    case 'eksik_evrak': liste = liste.filter(a => !a._ekspertizPdf || !a._ruhsat); break
    case 'ekspertiz': liste = liste.filter(a => !a._ekspertiz); break
    case 'tramer': liste = liste.filter(a => !a._tramer); break
    case 'stok_bekleyen': liste = liste.filter(a => a.durum === 'ALINDI'); break
    case 'fiyatlamada': liste = liste.filter(a => a.fiyatlama_durumu === 'BEKLIYOR'); break
    case 'iade': liste = liste.filter(a => a.fiyatlama_durumu === 'IADE'); break
    case 'takas': liste = liste.filter(a => trBuyuk(a._alisSekli) === 'TAKAS'); break
    case 'ihale': liste = liste.filter(a => (trBuyuk(a._alisSekli) || '').includes('IHALE')); break
  }
  return liste
}

function ciz() {
  menuKapat()   // açık menü varsa temizle (yeniden çizimde orphan kalmasın)
  const liste = filtreli()

  // KPI — F5: sayımlar v_kpi_alis'ten (tek kaynak, .ai/22). View okunamazsa
  // yüklenmiş listeden tahmin edilir, ekran boş kalmaz.
  const bugun0 = new Date(); bugun0.setHours(0, 0, 0, 0)
  const bekleyen = KPI ? KPI.bekleyen_alis : TUM.filter(a => a.durum === 'ALINDI').length
  const bugunAlinan = KPI ? KPI.bugun_alinan : TUM.filter(a => new Date(a.created_at) >= bugun0).length
  const toplamAlis = TUM.reduce((s, a) => s + (Number(a._alisFiyati) || 0), 0)   // finans-only RLS → danışmanda 0
  // Eksik evrak: view iki ayrı sayı verir (PDF / ruhsat); liste ise "biri bile
  // eksikse" mantığıyla çalışır. Popup listesiyle KPI'ın tutması için sayım
  // listeden alınır — view sayıları KPI alt yazısında bilgi olarak durur.
  const eksikEvrak = TUM.filter(a => !a._ekspertizPdf || !a._ruhsat).length
  const stogaBekleyen = TUM.filter(a => a.durum === 'ALINDI' && a._hazir).length

  const kpi = (etiket, deger, kutuCls, degerCls, sagHtml = '', id = '') => `
    <div ${id ? `id="${id}"` : ''} class="rounded-xl p-4 flex flex-col gap-1 border transition-all ${kutuCls}">
      <span class="text-label-xs font-label-xs uppercase tracking-wider ${degerCls.etiket}">${etiket}</span>
      <div class="flex items-center gap-2"><span class="text-heading-md font-bold ${degerCls.deger}">${deger}</span>${sagHtml}</div>
    </div>`
  const kpiHtml = `<div class="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
    ${kpi('Bekleyen Alış', bekleyen, 'bg-surface-container-lowest border-outline-variant custom-shadow', { etiket: 'text-on-surface-variant', deger: 'text-on-surface' })}
    ${kpi('Bugün Alınan', bugunAlinan, 'bg-[#ECFDF5] border-[#10B981]/20', { etiket: 'text-[#065F46]', deger: 'text-[#047857]' }, mat('trending_up', 'text-[16px] text-[#10B981]'))}
    ${kpi('Toplam Alış', fmtPara(toplamAlis), 'bg-primary/5 border-primary/10 custom-shadow', { etiket: 'text-primary', deger: 'text-primary' })}
    ${kpi('Eksik Evrak', eksikEvrak, 'bg-[#FFFBEB] border-[#F59E0B]/20' + (eksikEvrak ? ' cursor-pointer hover:border-[#F59E0B]/60' : ''), { etiket: 'text-[#92400E]', deger: 'text-[#B45309]' }, eksikEvrak ? `<span class="text-[10px] font-bold text-[#B45309] underline">neler eksik?</span>` : '', 'akEksikKpi')}
    ${kpi('Stoğa Bekleyen', stogaBekleyen, 'bg-[#EFF6FF] border-[#3B82F6]/20', { etiket: 'text-[#1E40AF]', deger: 'text-[#1D4ED8]' })}
  </div>`

  // Filtre çipleri
  const CIP = [['tumu', 'Tümü'], ['bugun', 'Bugün'], ['hafta', 'Bu Hafta'], ['eksik_evrak', `Eksik Evrak`], ['ekspertiz', 'Ekspertiz Bekliyor'], ['tramer', 'Tramer Bekliyor'], ['fiyatlamada', 'Fiyatlamada'], ['iade', 'Fiyatlamadan İade'], ['stok_bekleyen', 'Stoğa Aktarılmadı'], ['takas', 'Takas'], ['ihale', 'İhale']]
  const cipHtml = `<div class="flex items-center gap-2 overflow-x-auto pb-1">
    ${mat('filter_list', 'text-outline text-[20px]')}
    ${CIP.map(([k, l]) => `<button data-cip="${k}" class="whitespace-nowrap px-4 py-1.5 rounded-full text-label-xs font-bold transition-colors ${filtre === k ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}">${l}${k === 'eksik_evrak' && eksikEvrak ? ` <span class="bg-error text-white text-[10px] px-1 rounded-full">${eksikEvrak}</span>` : ''}</button>`).join('')}
  </div>`

  // Belge ikonu (üzerine gelince ne olduğu + var/yok yazar)
  const belge = (ikon, aktif, etiket, renk = '#10B981') =>
    `<span class="material-symbols-outlined text-[18px]" title="${kacis(etiket)}: ${aktif ? 'var' : 'EKSİK'}" style="color:${aktif ? renk : '#c5c5d3'}">${ikon}</span>`
  // Workflow noktaları
  const wf = a => {
    const adim = [true, a._ekspertiz, a._tramer, (a._ekspertizPdf && a._ruhsat), a.durum !== 'ALINDI']
    return `<div class="flex items-center">${adim.map((d, i) => `${i ? `<div class="w-4 h-[1px]" style="background:${adim[i - 1] ? '#10B981' : '#E5E7EB'}"></div>` : ''}<div class="w-2 h-2 rounded-full" style="background:${d ? '#10B981' : '#E5E7EB'}"></div>`).join('')}</div>`
  }

  const satir = a => {
    const d = durumBilgi(a)
    const sec = secim.has(a.id)
    const aktif = a.id === secili
    return `<tr data-id="${a.id}" class="mm-satir group hover:bg-primary/5 transition-colors cursor-pointer ${aktif ? 'bg-primary/5' : ''}">
      <td class="px-4 py-2"><input type="checkbox" data-cb="${a.id}" ${sec ? 'checked' : ''} class="rounded border-outline-variant text-primary focus:ring-primary h-4 w-4" /></td>
      <td class="px-4 py-2">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded bg-surface-container-high flex items-center justify-center text-outline shrink-0">${mat('directions_car', 'text-[20px]')}</div>
          <div class="flex flex-col"><span class="text-body-sm font-bold text-primary">${aracEtiket(a) || '—'}</span>
            <span class="text-[11px] text-on-surface-variant">${a.yil ? a.yil + ' ' : ''}${B(a.marka)} ${B(a.model)}</span></div>
        </div>
      </td>
      <td class="px-4 py-2"><div class="flex gap-1.5 items-center">
        ${belge('image', a._foto, 'Tramer/SBM görseli')}${belge('description', a._ruhsat, 'Ruhsat')}${belge('assignment_turned_in', a._ekspertiz, a._ekspertizOrijinal ? 'Orijinal (onaylı)' : 'Ekspertiz işaretlemesi', '#F59E0B')}${belge('search_check', a._tramer, a._tramerTemiz ? 'Tramer temiz (onaylı)' : 'Tramer hasar kaydı')}
        ${eksikListe(a).length ? `<button class="ak-eksik ml-1 text-[10px] font-bold text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/30 rounded px-1.5 py-0.5" data-id="${a.id}" title="Neler eksik?">${eksikListe(a).length} eksik</button>` : ''}
      </div></td>
      <td class="px-4 py-2 hidden md:table-cell">${wf(a)}</td>
      <td class="px-4 py-2"><span title="${kacis(a.fiyatlama_durumu === 'IADE' ? ('İade sebebi: ' + (a.fiyatlama_iade_nedeni || '—')) : d.ad)}" class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${d.cls}">${d.ad}</span></td>
      <td class="px-4 py-2 hidden lg:table-cell">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">${basHarf(danismanAdi(DMAP, a.olusturan))}</div>
          <span class="text-[11px] text-on-surface-variant">${B(danismanAdi(DMAP, a.olusturan))}</span>
        </div>
      </td>
      <td class="px-4 py-2 text-right">
        <button class="mm-menu w-8 h-8 rounded-lg hover:bg-surface-container-high inline-flex items-center justify-center text-on-surface-variant" data-id="${a.id}" title="İşlemler">${mat('more_vert', 'text-[20px]')}</button>
      </td>
    </tr>`
  }

  const tabloHtml = `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-visible relative custom-shadow">
    <div class="overflow-x-auto">
      ${liste.length ? `<table class="w-full text-left border-collapse">
        <thead><tr class="bg-surface-container text-on-surface-variant text-label-xs uppercase">
          <th class="px-4 py-3 w-10"></th><th class="px-4 py-3">Araç</th><th class="px-4 py-3">Belgeler</th>
          <th class="px-4 py-3 hidden md:table-cell">Workflow</th><th class="px-4 py-3">Durum</th>
          <th class="px-4 py-3 hidden lg:table-cell">Sorumlu</th><th class="px-4 py-3 text-right">İşlemler</th>
        </tr></thead>
        <tbody class="divide-y divide-outline-variant/30">${liste.map(satir).join('')}</tbody>
      </table>` : `<div class="p-6">${bosDurum(arama || filtre !== 'tumu' ? 'Filtreye uyan araç yok.' : 'Henüz araç kabulü yok. “Yeni Araç Kabul” ile başlayın.', 'directions_car')}</div>`}
    </div>
    <div class="px-4 py-3 border-t border-outline-variant flex justify-between items-center text-xs text-on-surface-variant bg-surface-container-low/30">
      <span>Toplam ${TUM.length} araç${(arama || filtre !== 'tumu') ? ` · ${liste.length} gösteriliyor` : ''}</span>
      <button id="akExcel" class="flex items-center gap-1 hover:text-primary transition-colors">${mat('file_download', 'text-[18px]')} Excel'e Aktar</button>
    </div>
  </div>`

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 md:mb-6">
      <div><h2 class="text-headline-md text-primary font-bold">Araç Kabul Merkezi</h2>
        <p class="text-body-md text-on-surface-variant">Alış listesi — kabul, ekspertiz, tramer, evrak</p></div>
      <div class="flex items-center gap-2 shrink-0">
        <div class="hidden sm:flex items-center bg-surface-container-low px-3 py-1.5 rounded-full border border-outline-variant w-56">
          ${mat('search', 'text-on-surface-variant text-lg')}
          <input id="akArama" type="search" value="${kacis(arama)}" placeholder="Plaka, marka, şasi…" class="bg-transparent border-none focus:ring-0 focus:outline-none text-body-md w-full ml-2" />
        </div>
        <button id="akYeni" class="bg-primary text-on-primary pl-3 pr-4 h-10 flex items-center gap-1.5 rounded-lg text-label-md font-bold hover:opacity-90 shadow-sm">${mat('add', 'text-[18px]')}<span class="hidden sm:inline">Yeni Araç Kabul</span></button>
      </div>
    </div>
    ${kpiHtml}
    <div class="mt-4 md:mt-6">${cipHtml}</div>
    ${topluCubukHtml()}
    <div class="mt-4">${tabloHtml}</div>`

  bagla()
}

// Toplu işlem çubuğu (checkbox seçilince görünür)
function topluCubukHtml() {
  if (!secim.size) return ''
  const yonetici = !!(DANISMAN && (DANISMAN.master_admin || DANISMAN.rol === 'yonetici'))
  const yakinda = (ik, et) => `<button disabled title="yakında" class="px-3 h-9 rounded-lg border border-outline-variant text-on-surface-variant/50 text-sm font-semibold flex items-center gap-1 cursor-not-allowed">${mat(ik, 'text-[16px]')} ${et} <span class="text-[9px] font-bold bg-surface-container px-1 rounded">yakında</span></button>`
  return `<div class="mt-4 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
    <span class="text-sm font-bold text-primary">${secim.size} araç seçildi</span>
    <button id="akSecTemizle" class="px-3 h-9 rounded-lg border border-outline-variant text-sm font-semibold hover:bg-surface-container-low">Seçimi Temizle</button>
    <div class="w-px h-6 bg-outline-variant mx-1"></div>
    <button id="akTopluFiyat" class="px-3 h-9 rounded-lg bg-primary text-on-primary text-sm font-bold flex items-center gap-1 hover:opacity-90">${mat('sell', 'text-[16px]')} Fiyatlamaya Gönder</button>
    <button id="akTopluStok" class="px-3 h-9 rounded-lg border border-primary/30 text-primary text-sm font-bold flex items-center gap-1 hover:bg-primary/5">${mat('inventory_2', 'text-[16px]')} Stoğa Aktar</button>
    ${yakinda('assignment', 'Ekspertiz İste')}
    ${yakinda('label', 'Etiket Yazdır')}
    ${yakinda('note_add', 'Not Ekle')}
    ${yonetici ? yakinda('delete', 'Sil') : ''}
  </div>`
}

function bagla() {
  // Satır tıkla → ARAÇ KABUL FORMU (dolu). Göksenil (10 Ağu 2026):
  //   "hem pop-up'ta hem tam sayfada arac-kabul-yeni.html'e gitsin
  //    (araç bilgileri dolu gelmeli tabii ki)"
  // ⚠️ ÖNCESİ arac-detay.js pop-up'ıydı; oradan "tam ekran" arac-detay.html
  //   açıyordu. Kabul merkezinde çalışan kişi kaydı DÜZENLEMEK istiyor,
  //   okumak değil — bu yüzden doğrudan kabul formuna gidiliyor.
  document.querySelectorAll('.mm-satir').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('input[type=checkbox]') || e.target.closest('.mm-menu') || e.target.closest('.ak-eksik')) return
    location.href = 'arac-kabul-yeni.html?id=' + encodeURIComponent(tr.dataset.id)
  }))
  // "Eksik Evrak" KPI + satırdaki "N eksik" rozeti → neyin eksik olduğunu yaz
  const eksikKpi = document.getElementById('akEksikKpi')
  if (eksikKpi && TUM.some(a => !a._ekspertizPdf || !a._ruhsat)) eksikKpi.addEventListener('click', eksikEvrakPopup)
  document.querySelectorAll('.ak-eksik').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); const a = TUM.find(x => x.id === b.dataset.id); if (a) aracEksikPopup(a)
  }))
  // "..." İşlemler menüsü (fixed konum — tablo taşması kırpamaz)
  document.querySelectorAll('.mm-menu').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); menuAc(b, TUM.find(a => a.id === b.dataset.id))
  }))
  // Checkbox
  document.querySelectorAll('input[data-cb]').forEach(cb => cb.addEventListener('change', e => {
    e.stopPropagation()
    const id = e.target.dataset.cb; e.target.checked ? secim.add(id) : secim.delete(id); ciz()
  }))
  document.querySelectorAll('button[data-cip]').forEach(b => b.addEventListener('click', () => { filtre = b.dataset.cip; ciz() }))
  const ar = document.getElementById('akArama')
  if (ar) ar.addEventListener('input', e => { arama = e.target.value; const p = e.target.selectionStart; ciz(); const y = document.getElementById('akArama'); if (y) { y.focus(); try { y.setSelectionRange(p, p) } catch (_) {} } })
  document.getElementById('akYeni')?.addEventListener('click', () => { location.href = 'arac-kabul-yeni.html' })
  document.getElementById('akExcel')?.addEventListener('click', excelAktar)
  // Toplu işlemler
  document.getElementById('akSecTemizle')?.addEventListener('click', () => { secim.clear(); ciz() })
  document.getElementById('akTopluFiyat')?.addEventListener('click', topluFiyat)
  document.getElementById('akTopluStok')?.addEventListener('click', topluStok)
}

// "..." İşlemler menüsü — body'ye eklenen fixed menü (hiçbir overflow kırpamaz)
function menuAc(btn, a) {
  if (!a) return
  menuKapat()
  const fiyatlandi = a.fiyatlama_durumu === 'FIYATLANDI' || STOK_DURUM.includes(a.durum)
  const kuyrukta = a.fiyatlama_durumu === 'BEKLIYOR' && !fiyatlandi
  const iadeli = a.fiyatlama_durumu === 'IADE'
  const items = [{ ik: 'edit_note', et: 'Kabul Formunu Aç', fn: () => { location.href = 'arac-kabul-yeni.html?id=' + encodeURIComponent(a.id) } }]
  // ⚠️ İADE'den çıkış DÜZ UPDATE ile YAPILMAZ: fiyatlama_iade_cozuldu() RPC'si
  //    iade edene "düzeltildi" bildirimini gönderiyor (BK-59). Düz update
  //    durumu değiştirir ama kimseye haber vermez — İsmail Bey aracın
  //    döndüğünü göremez.
  if (iadeli) items.push({ ik: 'task_alt', et: 'Düzeltildi, Fiyatlamaya Gönder', vurgu: true, fn: () => iadeCozuldu(a) })
  else if (!fiyatlandi) items.push(kuyrukta
    ? { ik: 'undo', et: 'Kuyruktan Geri Al', fn: () => fiyatlamaGonder(a.id, null) }
    : { ik: 'sell', et: 'Fiyatlamaya Gönder', vurgu: true, fn: () => fiyatlamaGonder(a.id, 'BEKLIYOR') })
  items.push({ ik: 'print', et: 'Yazdır', fn: () => aracDetayAc(a.id, DANISMAN, { onKapat: yukle }) })
  // Silme YALNIZ master admin'de (Göksenil, 7 Ağu 2026). DB tarafı zaten
  // hazır: stok_araclar_sil politikası is_master() OR is_yonetici(); burada
  // menüyü master admin'e açıyoruz — asıl kapı RLS.
  if (DANISMAN?.master_admin) items.push({ ik: 'delete', et: 'Aracı Sil', tehlike: true, fn: () => aracSil(a) })

  const menu = document.createElement('div')
  menu.className = 'fixed z-[80] w-52 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg py-1'
  menu.innerHTML = items.map((it, i) => `<button data-i="${i}" class="w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${it.tehlike ? 'text-error font-semibold hover:bg-error/10 border-t border-outline-variant/60 mt-1 pt-2.5' : `hover:bg-surface-container-low ${it.vurgu ? 'text-primary font-semibold' : ''}`}">${mat(it.ik, 'text-[16px]')} ${it.et}</button>`).join('')
  document.body.appendChild(menu)
  MENU_EL = menu
  const r = btn.getBoundingClientRect()
  const left = Math.max(8, r.right - 208)
  let top = r.bottom + 4
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4)
  menu.style.left = left + 'px'; menu.style.top = top + 'px'
  menu.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => { const it = items[+b.dataset.i]; menuKapat(); it.fn() }))
  MENU_DIS = e => { if (!menu.contains(e.target)) menuKapat() }
  setTimeout(() => { document.addEventListener('click', MENU_DIS); window.addEventListener('scroll', menuKapat, true); window.addEventListener('resize', menuKapat) }, 0)
}
function menuKapat() {
  if (MENU_DIS) { document.removeEventListener('click', MENU_DIS); window.removeEventListener('scroll', menuKapat, true); window.removeEventListener('resize', menuKapat); MENU_DIS = null }
  if (MENU_EL) { MENU_EL.remove(); MENU_EL = null }
}

// Fiyatlama kuyruğuna gönder / geri al (durum: 'BEKLIYOR' | null)
// ⚠️ KUYRUĞA GÖNDERİRKEN arabam paketi SORULUR (Göksenil, 6 Ağu 2026:
//    "paket seçimi yaptırmadı bana"). Seçici yalnız araç detayına
//    bağlanmıştı; bu yoldan gönderilen araçlarda paket hiç sorulmuyor,
//    piyasa ölçümü sessizce model geneline düşüyordu.
//    Geri alırken (durum=null) sorulmaz — ölçülecek bir şey yok.
// İade edilen aracı düzeltip kuyruğa geri gönder (sql/216).
// Sebebi kullanıcıya GÖSTERİR: bilgi işlem neyi düzelttiğini teyit etmeden
// göndermesin — bugünkü "bu araç yanlış" mesajının tekrarı olmasın.
async function iadeCozuldu(a) {
  if (!a) return
  const neden = a.fiyatlama_iade_nedeni || '(sebep kaydedilmemiş)'
  if (!confirm(`${buyuk(a.plaka || '')} fiyatlama kuyruğuna geri gönderilecek.

İADE SEBEBİ:
${neden}

Bu sorun düzeltildi mi?`)) return
  const not = prompt('Ne düzeltildi? (isteğe bağlı — iade edene bu not gider)') 
  if (not === null) return
  const { data, error } = await supabase.rpc('fiyatlama_iade_cozuldu',
    { p_arac: a.id, p_not: not.trim() || null })
  if (error) { dbHata('iade cozuldu', error); toast('İşlem başarısız: ' + error.message, false); return }
  if (!data?.ok) { toast(data?.hata || 'Gönderilemedi.', false); return }
  await yukle()
  toast(`${buyuk(a.plaka || '') || 'Araç'} düzeltildi, fiyatlama kuyruğuna gönderildi.`)
}

async function fiyatlamaGonder(id, durum) {
  if (!id) return
  const a = TUM.find(x => x.id === id)
  if (durum === 'BEKLIYOR') {
    if (a) {
      const { paketSorVeYaz } = await import('./arabam-paket.js')
      if (!(await paketSorVeYaz(a))) return          // vazgeçildi ya da yazılamadı
    } else console.error('[DMS] fiyatlamaGonder: araç listede bulunamadı', id)
  }
  const { data, error } = await supabase.from('stok_araclar')
    .update({ fiyatlama_durumu: durum }).eq('id', id).select('id')   // §5: .select + length
  if (error) { dbHata('fiyatlamaya gönder', error); toast('İşlem başarısız: ' + error.message, false); return }
  if (!data || !data.length) { toast('Güncellenemedi — yetki veya kayıt yok.', false); return }
  await yukle()
  // Başarıyı SÖYLE. Rozet değişikliği tek başına yetmiyor: kullanıcı menüye
  // bakıyor, satıra değil. Sessiz başarı = "buton çalışmadı".
  const p = buyuk(a?.plaka || '') || 'Araç'
  toast(durum === 'BEKLIYOR'
    ? `${p} fiyatlama kuyruğuna gönderildi.`
    : `${p} fiyatlama kuyruğundan çıkarıldı.`)
}

// =====================================================================
// ARAÇ SİLME — yalnız master admin (Göksenil, 7 Ağu 2026)
//
// ⚠️ GERİ ALINAMAZ. Canlı şema 7 Ağu 2026'da ölçüldü:
//    · ON DELETE CASCADE → 20 tablo: evrak, ekspertiz, tramer, fotoğraf,
//      masraf, alış, fiyat, ilan, ilan görselleri, ilan kalite kontrol,
//      iş emri, anahtar hareketi, lokasyon hareketi, not, piyasa analizi,
//      cam etiketi, evrak takip, iç hizmet, ihale çıkışı, geri alım.
//    · NO ACTION → 6 tablo: siparisler · satis_snapshot · arsiv_satislar ·
//      talepler · olaylar · cari_hareketler(takas_arac_id).
//
// NO ACTION olan bir tabloda satır varsa Postgres silmeyi FK hatasıyla
// reddeder. Bu bilinçli bir EMNİYET: satışa/talebe dokunmuş araç silinemez,
// geçmiş bozulmaz. Ham FK metnini kullanıcıya göstermek yerine ÖNCE sayıp
// hangi kaydın engellediğini Türkçe yazıyoruz.
//
// ⚠️ Storage CASCADE ETMEZ. Fotoğraf/evrak dosyaları silinmeden önce
//    yolları okunur, satır silindikten sonra bucket'tan kaldırılır —
//    aksi halde arac-foto / arac-evrak içinde sahipsiz dosya birikir.
// =====================================================================
const SILME_ENGEL = [
  ['siparisler', 'arac_id', 'sipariş'],
  ['satis_snapshot', 'arac_id', 'satış kaydı'],
  ['arsiv_satislar', 'arac_id', 'arşiv satış'],
  ['talepler', 'arac_id', 'müşteri talebi'],
  ['cari_hareketler', 'takas_arac_id', 'takas cari hareketi'],
]
// ⚠️ `olaylar` BİLEREK LİSTEDE DEĞİL (sql/243). O bir sistem günlüğü:
//    ölçüldü, 214 aracın 214'ünde var ve 197 araç YALNIZCA onun yüzünden
//    silinemiyordu. İş anlamı taşımıyor; sunucudaki arac_sil() RPC'si
//    aracı silerken olay satırlarını da temizliyor.
//    Bu liste artık arac_sil()'in reddettiği kümenin AYNISI — ayrışırsa
//    kullanıcı ya boşuna engellenir ya da sunucu hatasıyla karşılaşır.

// Silme onay penceresi — plaka yazılmadan "Sil" düğmesi açılmaz.
// Dönüş: true → sil · false → vazgeçildi.
function silOnayi(a, plaka) {
  return new Promise(resolve => {
    const sade = s => trBuyuk(s || '').replace(/\s+/g, '')
    const ov = document.createElement('div')
    ov.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4'
    ov.innerHTML = `
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
      <div class="relative bg-surface-container-lowest w-full max-w-[480px] rounded-2xl shadow-2xl flex flex-col">
        <div class="px-5 py-4 border-b border-outline-variant">
          <h3 class="text-title-lg font-bold text-error flex items-center gap-2">${mat('warning')} Araç kalıcı olarak silinecek</h3>
          <p class="text-[12px] text-on-surface-variant mt-1">Bu işlem <b>geri alınamaz.</b></p>
        </div>
        <div class="px-5 py-4 flex flex-col gap-3">
          <div class="px-3 py-2 rounded-lg bg-surface-container-low text-body-sm">
            <b>${kacis(plaka)}</b>${a.marka || a.model ? ` · ${kacis(buyuk(`${a.marka || ''} ${a.model || ''}`.trim()))}` : ''}
          </div>
          <div class="text-[12px] text-on-surface-variant leading-relaxed">
            Araçla birlikte <b>silinecekler:</b> evrak, ekspertiz, tramer, fotoğraflar,
            masraflar, alış kaydı, ilan ve ilan görselleri, iş emirleri, anahtar ve
            lokasyon geçmişi, <b>sistem olay kayıtları</b>. Yüklenmiş dosyalar da
            depodan kaldırılır. Silme işleminin kendisi denetim defterine yazılır.
          </div>
          <label class="text-[12px] font-bold text-on-surface">Onaylamak için plakayı yaz</label>
          <input id="silPlaka" autocomplete="off" placeholder="${kacis(plaka)}"
            class="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm font-bold tracking-wide focus:ring-2 focus:ring-error/20 focus:outline-none" />
        </div>
        <div class="px-5 py-3 border-t border-outline-variant flex justify-end gap-2">
          <button id="silVaz" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-semibold hover:bg-surface-container-low">Vazgeç</button>
          <button id="silOnay" disabled class="px-4 py-2 rounded-lg bg-error text-white text-body-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">Kalıcı Olarak Sil</button>
        </div>
      </div>`
    document.body.appendChild(ov)

    const kapat = v => { ov.remove(); document.removeEventListener('keydown', esc); resolve(v) }
    const esc = e => { if (e.key === 'Escape') kapat(false) }
    document.addEventListener('keydown', esc)
    ov.querySelector('.absolute').addEventListener('click', () => kapat(false))
    ov.querySelector('#silVaz').addEventListener('click', () => kapat(false))
    const onay = ov.querySelector('#silOnay')
    const inp = ov.querySelector('#silPlaka')
    inp.addEventListener('input', () => { onay.disabled = sade(inp.value) !== sade(plaka) })
    onay.addEventListener('click', () => { if (!onay.disabled) kapat(true) })
    inp.focus()
  })
}

async function aracSil(a) {
  if (!a) return
  const plaka = aracEtiket(a) || '(plakasız)'

  // 1) Bağlı kayıt var mı? — FK hatası beklemeden anlaşılır sebep
  const kont = await Promise.all(SILME_ENGEL.map(([t, k]) =>
    supabase.from(t).select('*', { count: 'exact', head: true }).eq(k, a.id)))
  const engel = []
  kont.forEach((r, i) => {
    if (r.error) { dbHata('silme öncesi ' + SILME_ENGEL[i][0], r.error); engel.push(`${SILME_ENGEL[i][2]} kontrol edilemedi`) }
    else if (r.count) engel.push(`${r.count} ${SILME_ENGEL[i][2]}`)
  })
  if (engel.length) {
    alert(`${plaka} SİLİNEMEZ.\n\nBu araca bağlı kayıtlar var:\n· ${engel.join('\n· ')}\n\n`
      + 'Satışa, siparişe ya da talebe dokunmuş araç silinmez — geçmiş bozulur.')
    return
  }

  // 2) Plakayı yazdırarak onay (tek tıkla kaza olmasın)
  // ⚠️ prompt() DEĞİL: yıkıcı işlemin uyarısı okunabilir olmalı ve sistem
  //    diyaloğu bazı tarayıcı/oturumlarda bastırılıyor — buton sessizce
  //    hiçbir şey yapmış gibi görünürdü. Uygulama içi pencere kullanılıyor.
  if (!(await silOnayi(a, plaka))) return

  // 3) Storage yollarını SİLMEDEN ÖNCE oku (satır gidince yol da gider)
  const [fotoR, evrakR] = await Promise.all([
    supabase.from('arac_fotograflari').select('dosya_yolu').eq('arac_id', a.id),
    supabase.from('arac_evraklar').select('url').eq('arac_id', a.id),
  ])
  if (fotoR.error) dbHata('silme öncesi foto yolları', fotoR.error)
  if (evrakR.error) dbHata('silme öncesi evrak yolları', evrakR.error)
  const fotoYol = (fotoR.data || []).map(f => f.dosya_yolu).filter(Boolean)
  const evrakYol = (evrakR.data || []).map(e => e.url).filter(Boolean)

  // 4) Satırı sil — arac_sil() RPC (sql/243)
  // ⚠️ Düz `.delete()` DEĞİL: olaylar.arac_id FK'sı NO ACTION ve olaylar'da
  //    DELETE politikası yok, dolayısıyla tarayıcıdan gelen düz DELETE
  //    her araçta ham FK hatasıyla düşüyordu. RPC master admin'i doğrular,
  //    gerçek iş kaydı varsa yine reddeder, yoksa olay satırlarını
  //    temizleyip aracı siler ve silmeyi audit_log'a yazar.
  const { data, error } = await supabase.rpc('arac_sil', { p_arac_id: a.id })
  if (error) { dbHata('araç sil', error); alert('Silinemedi: ' + error.message); return }
  if (!data?.ok) { alert('Silinemedi — sunucu onaylamadı.'); return }

  // 5) Dosyaları temizle (satır gitti; buradaki hata silmeyi geçersiz kılmaz)
  if (fotoYol.length) { const { error: e } = await supabase.storage.from('arac-foto').remove(fotoYol); if (e) dbHata('foto storage sil', e) }
  if (evrakYol.length) { const { error: e } = await supabase.storage.from('arac-evrak').remove(evrakYol); if (e) dbHata('evrak storage sil', e) }

  secim.delete(a.id)
  await yukle()
  toast(`${plaka} silindi.`)
}

// Toplu: seçili araçları fiyatlama kuyruğuna gönder
// ⚠️ Paket AYNI marka/model/versiyon için BİR KEZ sorulur — 20 araç seçilip
//    20 pencere açılması kullanılamaz olurdu. Eşleşme zaten o üçlüyle
//    anahtarlı (arabam_slug_eslesme), tek cevap hepsini kapsar.
async function topluFiyat() {
  const ids = [...secim]; if (!ids.length) return
  const secililer = TUM.filter(a => secim.has(a.id))
  const { paketSorTopluca } = await import('./arabam-paket.js')
  if (!(await paketSorTopluca(secililer))) return    // birinde vazgeçildi → tümü iptal
  const { data, error } = await supabase.from('stok_araclar')
    .update({ fiyatlama_durumu: 'BEKLIYOR' }).in('id', ids).select('id')
  if (error) { dbHata('toplu fiyatlama', error); toast('İşlem başarısız: ' + error.message, false); return }
  secim.clear(); await yukle()
  toast(`${data?.length || 0} araç fiyatlama kuyruğuna gönderildi.`)
}

// Toplu: seçili araçları stoğa aktar — yalnız FİYATLANMIŞ + ALINDI olanlar → STOKTA
// (Satış fiyatı olmadan stoğa aktarılamaz — fiyat Fiyatlama Merkezi'nde girilir.)
async function topluStok() {
  const secililer = [...secim].map(id => TUM.find(a => a.id === id)).filter(Boolean)
  const fiyatsiz = secililer.filter(a => a.durum === 'ALINDI' && a.fiyatlama_durumu !== 'FIYATLANDI')
  const ids = secililer.filter(a => a.durum === 'ALINDI' && a.fiyatlama_durumu === 'FIYATLANDI').map(a => a.id)
  if (!ids.length) {
    alert(fiyatsiz.length
      ? `Stoğa aktarılamaz: seçili ${fiyatsiz.length} araç henüz fiyatlanmadı. Önce Fiyatlama Merkezi'nde fiyat girilmeli.`
      : 'Seçilenler arasında stoğa aktarılabilecek (fiyatlanmış, Alındı durumunda) araç yok.')
    return
  }
  const atlanan = fiyatsiz.length ? ` (${fiyatsiz.length} fiyatsız araç atlanacak)` : ''
  if (!confirm(`${ids.length} araç stoğa aktarılsın mı?${atlanan} (Durum: Alındı → Stokta)`)) return
  const { data, error } = await supabase.from('stok_araclar')
    .update({ durum: 'STOKTA' }).in('id', ids).select('id')
  if (error) { dbHata('toplu stoğa aktar', error); alert('İşlem başarısız: ' + error.message); return }
  alert(`${data?.length || 0} araç stoğa aktarıldı.`)
  secim.clear(); await yukle()
}

function excelAktar() {
  const liste = filtreli()
  const bas = ['PLAKA', 'YIL', 'MARKA', 'MODEL', 'VERSİYON', 'DURUM', 'ALIŞ ŞEKLİ', 'SORUMLU']
  const satirlar = liste.map(a => [aracEtiket(a), a.yil, a.marka, a.model, a.versiyon, durumBilgi(a).ad, a._alisSekli, danismanAdi(DMAP, a.olusturan)].map(x => buyuk(x ?? '')))
  import('./veri.js').then(({ csvIndir }) => csvIndir('arac-kabul', bas, satirlar))
}
