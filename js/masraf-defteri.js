// =====================================================================
// masraf-defteri.js — Araç özelinde masraf defteri (TEK KAYNAK)
//
// Göksenil (4 Ağu 2026): "muhasebe … araç özelinde masraf defterine kayıt
//   işlemesi gerekiyor" → sonra: "aynı hata masraf defterinde de var, bunu
//   da yap."
//
// ⚠️ NEDEN AYRI MODÜL: defter `arac-detay.js` içinde vardı ama CANLI araç
//   kartı `arac-kart.js` (arac-kart.html onu yüklüyor). arac-detay.js ayrı
//   bir sayfa. Kodu oraya KOPYALAMAK yanlış olurdu — bu projede en sık
//   tekrarlanan hata var olan bir şeyin ikinci kopyasını yazmak. Bu modül
//   kendi verisini çeker, kendi olaylarını bağlar; çağıran sayfa yalnız
//   nereye çizileceğini ve kim olduğunu söyler.
//
// Yetki: sunucudaki karşılığı arac_masraflar RLS'i (sql/155):
//   is_master() OR is_yonetici() OR is_muhasebe() OR yetkili('finans')
// ⚠️ İstemci kapısı `masrafGorur` ile AYNI kalmalı; ayrışırsa ya kart boş
//   açılır ya da yazma sunucuda sessizce 0 satır günceller (§5.1).
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, fmtTarih, kacis, trBuyuk, buyuk, dbHata, danismanAdi } from './veri.js'
import { mat, bosDurum, toast } from './stitch-ui.js'
import { masrafKapiBagla } from './masraf-kapi.js'

const INP = 'bg-surface-container-lowest border border-outline-variant rounded-lg px-3 h-10 text-body-md focus:ring-2 focus:ring-primary/20 focus:outline-none'

// Masraf defterini görebilir/yazabilir mi? sql/155 RLS'iyle birebir.
// Göksenil (4 Ağu 2026): "yöneticiler / bilgi işlem / muhasebe / finans".
export const masrafGorur = d => !!(d && (d.master_admin || d.rol === 'yonetici' ||
  d.rol === 'muhasebe' || d.rol === 'bilgi_islem' ||
  (Array.isArray(d.yetkiler) && d.yetkiler.includes('finans'))))
const varsayilanDuzenler = d => !!(d && (d.master_admin ||
  (Array.isArray(d.yetkiler) && d.yetkiler.includes('masraf_varsayilan_yonet'))))

// --- Modül durumu (araç başına) ---
let AID = null          // araç id
let BEN = null          // oturumdaki kişi
let DMAP = {}           // danışman id → ad
let TIPLER = []         // tanimlar MASRAF_TIPI
let MVAR = []           // masraf_varsayilanlari
let SATIRLAR = []       // arac_masraflar
let ALIS_FIYAT = null   // özet şeridi
let ALIS_SEKLI = null   // varsayılan tutar eşleşmesi
let NET = null          // v_arac_maliyet
let duzenId = null      // düzenlenen satır
let KAP = null          // çizim kabı
let yenile = null       // çağıranın tazeleme kancası (maliyet kartı vs.)
let BASLIK = ''         // pencere alt başlığı (plaka · marka model)

const tipAd = kod => TIPLER.find(t => t.kod === kod)?.ad || kod || ''
const tipOzel = kod => TIPLER.find(t => t.kod === kod)?.ozellikler || {}
// Kullanıcı datalist'e serbest metin yazabiliyor; okunur addan koda çevir.
function tipKod(val) {
  const v = trBuyuk((val || '').trim()); if (!v) return ''
  return TIPLER.find(x => trBuyuk(x.ad) === v || trBuyuk(x.kod) === v)?.kod || ''
}
// Varsayılan tutar: önce alış şekline özel eşleşme, yoksa geneli.
function varsayilanTutar(kod) {
  if (!kod) return null
  const es = MVAR.filter(m => m.masraf_tipi === kod)
  const v = (ALIS_SEKLI ? es.find(m => m.alis_sekli === ALIS_SEKLI) : null) || es.find(m => !m.alis_sekli)
  return v ? Number(v.tutar) : null
}

// Veriyi çek. Yetkisi olmayan için HİÇ sorgu atılmaz (RLS zaten 0 satır
// döndürürdü ama boşuna istek atmanın anlamı yok).
export async function masrafYukle({ aracId, ben, dmap, alisFiyati, alisSekli, baslik }) {
  AID = aracId; BEN = ben || null; DMAP = dmap || {}
  if (baslik !== undefined) BASLIK = baslik || ''
  ALIS_FIYAT = alisFiyati ?? null; ALIS_SEKLI = alisSekli ?? null
  SATIRLAR = []; NET = null; duzenId = null
  if (!aracId || !masrafGorur(BEN)) return

  // Çağıran alış bilgisini vermediyse KENDİMİZ çekeriz: özet şeridindeki
  // "Alış Fiyatı" ve varsayılan tutarın alış şekline göre seçilmesi buna
  // bağlı. Sayfanın bu veriyi taşımak zorunda kalmaması için modül kendi
  // kendine yetiyor.
  if (alisFiyati === undefined || alisSekli === undefined) {
    const { data: al, error: ae } = await supabase.from('arac_alislar')
      .select('alis_fiyati, alis_sekli').eq('arac_id', aracId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (ae) dbHata('arac alis (masraf ozeti)', ae)
    if (alisFiyati === undefined) ALIS_FIYAT = al?.alis_fiyati != null ? Number(al.alis_fiyati) : null
    if (alisSekli === undefined) ALIS_SEKLI = al?.alis_sekli ?? null
  }

  const [{ data: mler, error: e1 }, { data: mal, error: e2 }, { data: tnm, error: e3 }, { data: mv, error: e4 }] = await Promise.all([
    supabase.from('arac_masraflar').select('id,masraf_tipi,yon,tutar,tedarikci,tarih,aciklama,olusturan,created_at')
      .eq('arac_id', aracId).order('tarih', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('v_arac_maliyet').select('maliyet').eq('arac_id', aracId).maybeSingle(),
    supabase.from('tanimlar').select('kod,ad,ozellikler,sira').eq('tip', 'MASRAF_TIPI').eq('aktif', true).order('sira'),
    supabase.from('masraf_varsayilanlari').select('masraf_tipi,alis_sekli,tutar').eq('aktif', true),
  ])
  if (e1) dbHata('masraf defteri', e1); else SATIRLAR = mler || []
  if (e2) dbHata('v_arac_maliyet', e2); else NET = mal ? Number(mal.maliyet) : null
  if (e3) dbHata('masraf tipleri', e3); else TIPLER = tnm || []
  if (e4) dbHata('masraf varsayilanlari', e4); else MVAR = mv || []
}

export const masrafSayisi = () => SATIRLAR.length

function ozetKart(etiket, deger, vurgu = false) {
  return `<div class="bg-surface-container-low border border-outline-variant rounded-xl px-4 py-3">
    <div class="text-[10px] uppercase tracking-wider text-on-surface-variant">${etiket}</div>
    <div class="text-body-lg font-bold ${vurgu ? 'text-primary' : 'text-on-surface'} mt-0.5">${deger}</div></div>`
}

function tabloHtml() {
  if (!SATIRLAR.length) return `<div class="p-6">${bosDurum('Henüz masraf işlenmedi.', 'receipt_long')}</div>`
  const satir = m => {
    const gelir = m.yon === 'GELIR'
    return `<tr class="border-b border-outline-variant/40 hover:bg-surface-container-low/50">
      <td class="px-3 py-2 whitespace-nowrap text-body-sm">${kacis(fmtTarih(m.tarih))}</td>
      <td class="px-3 py-2 text-body-sm font-semibold">${kacis(tipAd(m.masraf_tipi))}</td>
      <td class="px-3 py-2 text-body-sm text-on-surface-variant">${kacis(m.aciklama || '')}</td>
      <td class="px-3 py-2 text-body-sm text-on-surface-variant">${kacis(m.tedarikci || '')}</td>
      <td class="px-3 py-2"><span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${gelir ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-surface-container-high text-on-surface-variant'}">${gelir ? 'GELİR' : 'GİDER'}</span></td>
      <td class="px-3 py-2 text-right text-body-sm font-bold whitespace-nowrap ${gelir ? 'text-[#047857]' : 'text-on-surface'}">${gelir ? '−' : ''}${fmtPara(m.tutar)}</td>
      <td class="px-3 py-2 text-body-sm text-on-surface-variant whitespace-nowrap">${kacis(buyuk(danismanAdi(DMAP, m.olusturan) || ''))}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button data-mduzen="${m.id}" class="w-7 h-7 rounded hover:bg-surface-container-high text-on-surface-variant" title="Düzelt">${mat('edit', 'text-[16px]')}</button>
        <button data-msil="${m.id}" class="w-7 h-7 rounded hover:bg-error/10 text-error" title="Sil">${mat('delete', 'text-[16px]')}</button></td></tr>`
  }
  return `<div class="border border-outline-variant rounded-xl overflow-x-auto"><table class="w-full text-left border-collapse min-w-[720px]">
      <thead><tr class="text-[10px] uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
        <th class="px-3 py-2">Tarih</th><th class="px-3 py-2">Tip</th><th class="px-3 py-2">Açıklama</th><th class="px-3 py-2">Tedarikçi</th>
        <th class="px-3 py-2">Yön</th><th class="px-3 py-2 text-right">Tutar</th><th class="px-3 py-2">Kaydeden</th><th class="px-3 py-2"></th></tr></thead>
      <tbody>${SATIRLAR.map(satir).join('')}</tbody></table></div>`
}

// Kartın GÖVDESİ. Çağıran kendi kutu/kart sarmalayıcısını kullanır ki
// sayfanın görsel diline uysun (arac-kart.js `kutu()`, arac-detay.js `kart()`).
export function masrafGovdeHtml() {
  if (!masrafGorur(BEN)) {
    return `<div class="p-8 text-center">${mat('lock', 'text-[32px] text-on-surface-variant')}
      <p class="text-body-md text-on-surface-variant mt-2">Masraf bilgisi yalnız muhasebe, finans ve yönetici tarafından görülür.</p></div>`
  }
  const gider = SATIRLAR.filter(m => m.yon === 'GIDER').reduce((s, m) => s + Number(m.tutar || 0), 0)
  const gelir = SATIRLAR.filter(m => m.yon === 'GELIR').reduce((s, m) => s + Number(m.tutar || 0), 0)
  const duzen = duzenId ? SATIRLAR.find(m => m.id === duzenId) : null
  const tedGoster = tipOzel(duzen?.masraf_tipi || '').tedarikci_alani === true
  const bugun = new Date().toISOString().slice(0, 10)
  const tipOps = TIPLER.map(t => `<option value="${kacis(t.ad || t.kod)}"></option>`).join('')

  const serit = `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    ${ozetKart('Alış Fiyatı', ALIS_FIYAT != null ? fmtPara(ALIS_FIYAT) : '—')}
    ${ozetKart('Σ Gider', fmtPara(gider))}
    ${ozetKart('Σ Gelir (indirim)', gelir ? '−' + fmtPara(gelir) : fmtPara(0))}
    ${ozetKart('Net Maliyet', NET != null ? fmtPara(NET) : '—', true)}</div>`

  const form = `<div class="flex flex-wrap items-end gap-2 bg-surface-container-low border border-outline-variant rounded-xl p-3">
    <label class="flex flex-col gap-1 flex-1 min-w-[160px]">
      <span class="text-[10px] text-on-surface-variant flex items-center justify-between gap-2">Masraf Tipi *
        <button type="button" id="mTipYeni" class="text-[10px] font-bold text-primary hover:underline inline-flex items-center gap-0.5" title="Listede olmayan bir masraf tipi ekle">${mat('add', 'text-[13px]')} Yeni tip</button></span>
      <input id="mTip" list="mTipList" autocomplete="off" placeholder="Listeden seç (yazarak ara)…" class="${INP}" /><datalist id="mTipList">${tipOps}</datalist></label>
    <label class="flex flex-col gap-1 w-28"><span class="text-[10px] text-on-surface-variant">Yön</span>
      <select id="mYon" class="${INP}"><option value="GIDER">Gider</option><option value="GELIR">Gelir</option></select></label>
    <label class="flex flex-col gap-1 w-32"><span class="text-[10px] text-on-surface-variant">Tutar (₺) *</span>
      <input id="mTutar" type="number" inputmode="numeric" class="${INP}" /></label>
    <label id="mTedKap" class="flex-col gap-1 flex-1 min-w-[140px] ${tedGoster ? 'flex' : 'hidden'}"><span class="text-[10px] text-on-surface-variant">Tedarikçi</span>
      <input id="mTed" class="${INP}" /></label>
    <label class="flex flex-col gap-1 flex-[2] min-w-[160px]"><span class="text-[10px] text-on-surface-variant">Açıklama</span>
      <input id="mAcik" class="${INP}" /></label>
    <label class="flex flex-col gap-1 w-40"><span class="text-[10px] text-on-surface-variant">Tarih</span>
      <input id="mTarih" type="date" value="${kacis(duzen?.tarih || bugun)}" class="${INP}" /></label>
    <button id="mKaydet" class="bg-primary text-on-primary px-4 h-10 rounded-lg text-sm font-bold flex items-center gap-1 hover:opacity-90 shadow-sm">${mat(duzen ? 'save' : 'add', 'text-[18px]')} ${duzen ? 'Güncelle' : 'Ekle'}</button>
    ${duzen ? `<button id="mVazgec" class="px-3 h-10 rounded-lg border border-outline-variant text-on-surface-variant text-sm font-bold hover:bg-surface-container-low">Vazgeç</button>` : ''}</div>`

  // Operasyon iş emri yazılmadıysa uyarı şeridi (sql/111). Form ile listenin
  // ARASINDA durur ki masraf tipi seçilir seçilmez göze çarpsın.
  return `${serit}
    ${duzen ? `<div class="mt-3 text-[11px] font-bold px-2 py-1 rounded bg-primary/10 text-primary inline-block">DÜZENLENİYOR</div>` : ''}
    <div class="mt-3">${form}</div>
    <div id="mOpUyari" class="mt-2"></div>
    <div class="mt-3">${tabloHtml()}</div>
    ${varsayilanDuzenler(BEN) ? `<div class="mt-2 text-right"><a href="masraf-varsayilan.html" class="text-[12px] font-semibold text-primary hover:underline inline-flex items-center gap-1">${mat('price_change', 'text-[16px]')} Varsayılanları yönet</a></div>` : ''}`
}

// Olayları bağla. `kap` = kartın DOM kabı, `tazele` = çağıranın yeniden çizimi.
export function masrafBagla(kap, tazele) {
  KAP = kap || document; yenile = tazele || null
  if (!masrafGorur(BEN)) return
  const el = s => KAP.querySelector('#' + s)
  const tipEl = el('mTip'), yonEl = el('mYon'), tutarEl = el('mTutar')
  if (!tipEl) return

  // Düzenleme kipinde formu doldur
  const duzen = duzenId ? SATIRLAR.find(m => m.id === duzenId) : null
  if (duzen) {
    tipEl.value = tipAd(duzen.masraf_tipi); yonEl.value = duzen.yon
    tutarEl.value = duzen.tutar; tutarEl.dataset.elle = '1'
    el('mAcik').value = duzen.aciklama || ''
    if (el('mTed')) el('mTed').value = duzen.tedarikci || ''
  }

  const tipDegisti = () => {
    const kod = tipKod(tipEl.value); const oz = tipOzel(kod)
    el('mTedKap')?.classList.toggle('hidden', oz.tedarikci_alani !== true)
    el('mTedKap')?.classList.toggle('flex', oz.tedarikci_alani === true)
    if (oz.yon) yonEl.value = oz.yon
    // Kullanıcı tutarı ELLE yazdıysa varsayılan onu EZMEZ.
    if (tutarEl.dataset.elle !== '1') {
      const v = varsayilanTutar(kod)
      tutarEl.value = v != null ? v : ''
    }
  }
  tipEl.addEventListener('change', tipDegisti)
  tipEl.addEventListener('input', () => { if (tipKod(tipEl.value)) tipDegisti() })
  tutarEl.addEventListener('input', () => { tutarEl.dataset.elle = '1' })
  masrafKapiBagla({ tipEl, kapId: 'mOpUyari', aracId: () => AID, kod: tipKod })

  el('mTipYeni')?.addEventListener('click', () => tipEkle(tipEl.value))
  el('mKaydet')?.addEventListener('click', kaydet)
  el('mVazgec')?.addEventListener('click', () => { duzenId = null; yenile?.() })
  KAP.querySelectorAll('button[data-mduzen]').forEach(b =>
    b.addEventListener('click', () => { duzenId = b.dataset.mduzen; yenile?.() }))
  KAP.querySelectorAll('button[data-msil]').forEach(b =>
    b.addEventListener('click', () => sil(b.dataset.msil)))
}

// ⚠️ 7 Ağu 2026 — GÖRÜNMEYEN UYARI. Buradaki kutu `bottom-4 right-4 z-[70]`
//    idi: Sohbet düğmesi (z-9999, bottom-5 right-5) TAM ÜSTÜNDE duruyordu ve
//    masraf penceresinin kendisi de z-95. Yani "kırmızı bir uyarı çıkıyor ama
//    göremiyorum" — kullanıcı kaydedilmediğini anlıyor, SEBEBİNİ göremiyordu.
//    stitch-ui'deki ORTAK toast'a geçildi (alt-orta, z-10000): sohbet
//    düğmesiyle yatayda çakışmaz, hiçbir katman üstüne binmez.
//    CLAUDE.md §4: sayfa KENDİ toast'ını yazmaz — bu kopya kaldırıldı.
const uyar = (mesaj, basari = false) => toast(mesaj, basari)

// §5.1: .update()/.insert()/.delete() sonrası DAİMA .select('id') + length.
// RLS reddi hata DEĞİL 0 satır döndürür — kontrol edilmezse "kaydettim"
// diyip hiçbir şey yazmamış oluruz.
async function kaydet() {
  const el = s => KAP.querySelector('#' + s)
  const kod = tipKod(el('mTip').value)
  const tutar = Number(el('mTutar').value)
  const yon = el('mYon').value
  const ted = tipOzel(kod).tedarikci_alani === true ? (el('mTed')?.value.trim() || null) : null
  const aciklama = el('mAcik').value.trim() || null
  const tarih = el('mTarih').value || new Date().toISOString().slice(0, 10)
  // Yazılan tip tanımlı değilse SEBEBİ söyle. Eski metin ("Geçerli bir masraf
  // tipi seç") kullanıcının ne yanlış yaptığını anlatmıyordu; üstelik alanın
  // yer tutucusu "Yaz veya seç…" diyerek serbest yazıya izin varmış izlenimi
  // veriyor. Yer tutucu da düzeltildi.
  if (!kod) {
    const yazilan = el('mTip').value.trim()
    return uyar(yazilan
      ? `"${yazilan}" tanımlı bir masraf tipi değil — listeden seç, detayı Açıklama'ya yaz.`
      : 'Masraf tipi zorunlu — listeden seç.')
  }
  if (!tutar || tutar <= 0) return uyar('Tutar zorunlu (0’dan büyük).')

  if (duzenId) {
    const { data, error } = await supabase.from('arac_masraflar')
      .update({ masraf_tipi: kod, yon, tutar, tedarikci: ted, aciklama, tarih }).eq('id', duzenId).select('id')
    if (error) { dbHata('masraf guncelle', error); return uyar('Güncellenemedi (yetki?): ' + error.message) }
    if (!data?.length) return uyar('Güncellenemedi: kayıt/yetki yok.')
    duzenId = null
  } else {
    const { data, error } = await supabase.from('arac_masraflar')
      .insert({ arac_id: AID, masraf_tipi: kod, yon, tutar, tedarikci: ted, aciklama, tarih, olusturan: BEN?.id || null }).select('id')
    if (error) { dbHata('masraf ekle', error); return uyar('Masraf eklenemedi (yetki?): ' + error.message) }
    if (!data?.length) return uyar('Masraf eklenemedi (yetki?).')
  }
  uyar('Masraf kaydedildi.', true)
  await yenile?.()
}

async function sil(id) {
  if (!confirm('Bu masraf satırı silinsin mi?')) return
  const { data, error } = await supabase.from('arac_masraflar').delete().eq('id', id).select('id')
  if (error) { dbHata('masraf sil', error); return uyar('Silinemedi (yetki?): ' + error.message) }
  if (!data?.length) return uyar('Silinemedi: kayıt/yetki yok.')
  if (duzenId === id) duzenId = null
  uyar('Masraf silindi.', true)
  await yenile?.()
}

// ---------------------------------------------------------------------
// YENİ MASRAF TİPİ
// Göksenil (7 Ağu 2026): "yeni tip ekleme düğmesi olsun — bilgi işlem,
//   yönetici, muhasebe ve finans ekleyebilsin."
//   Tetikleyen olay: masraf tipine elle "SAHİBİNDEN İLAN FARK BEDELİ"
//   yazılıyordu, liste dışı olduğu için kayıt engelleniyordu.
//
// Yetki kapısı VERİTABANINDA: sql/168 `tanimlar_masraf_tipi_ekle` —
// yalnız INSERT, yalnız tip='MASRAF_TIPI'. Mevcut tipi yeniden adlandırma
// ya da silme BİLEREK verilmedi: bir tipin adını değiştirmek geçmiş
// raporları sessizce değiştirir. Buradaki düğme sadece görünürlük.
//
// ⚠️ `kod` ADDAN ÜRETİLİR ve raporların anahtarı odur. Türkçe harfler
//    ASCII'ye katlanır (trBuyuk) — "İLAN FARKI" → ILAN_FARKI. Aksi halde
//    aynı tip iki farklı kodla iki kez doğar ve rapor ikiye bölünürdü.
// ---------------------------------------------------------------------
const tipKodUret = ad => trBuyuk(ad).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

function yeniTipPenceresi(onerilen) {
  return new Promise(resolve => {
    const ov = document.createElement('div')
    ov.className = 'fixed inset-0 z-[105] flex items-center justify-center p-4'
    ov.innerHTML = `
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
      <div class="relative bg-surface-container-lowest w-full max-w-[420px] rounded-2xl shadow-2xl">
        <div class="px-5 py-4 border-b border-outline-variant">
          <h3 class="text-title-lg font-bold text-primary flex items-center gap-2">${mat('add_circle')} Yeni masraf tipi</h3>
          <p class="text-[12px] text-on-surface-variant mt-1">Listeye kalıcı olarak eklenir; bundan sonra herkes bu tipi seçebilir.</p>
        </div>
        <div class="px-5 py-4 flex flex-col gap-2">
          <label class="text-[10px] text-on-surface-variant">Tip adı</label>
          <input id="ytAd" autocomplete="off" placeholder="Örn. Sahibinden İlan Fark Bedeli"
            class="${INP} w-full" value="${kacis(onerilen || '')}" />
          <div id="ytKod" class="text-[11px] text-on-surface-variant"></div>
        </div>
        <div class="px-5 py-3 border-t border-outline-variant flex justify-end gap-2">
          <button id="ytVaz" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-semibold hover:bg-surface-container-low">Vazgeç</button>
          <button id="ytOk" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-body-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">Ekle</button>
        </div>
      </div>`
    document.body.appendChild(ov)
    const kapat = v => { ov.remove(); document.removeEventListener('keydown', esc); resolve(v) }
    const esc = e => { if (e.key === 'Escape') kapat(null) }
    document.addEventListener('keydown', esc)
    ov.querySelector('.absolute').addEventListener('click', () => kapat(null))
    ov.querySelector('#ytVaz').addEventListener('click', () => kapat(null))
    const inp = ov.querySelector('#ytAd'), ok = ov.querySelector('#ytOk'), kodEl = ov.querySelector('#ytKod')
    const tazele = () => {
      const ad = inp.value.trim(); const kod = tipKodUret(ad)
      // Üretilecek kodu ŞİMDİ göster — rapor anahtarı bu, sonradan
      // değiştirilemiyor; kullanıcı ne oluşturduğunu görsün.
      kodEl.textContent = kod ? `Kod: ${kod}` : 'En az bir harf ya da rakam gerekli.'
      ok.disabled = !kod
    }
    inp.addEventListener('input', tazele)
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !ok.disabled) kapat(inp.value.trim()) })
    ok.addEventListener('click', () => { if (!ok.disabled) kapat(inp.value.trim()) })
    tazele(); inp.focus(); inp.select()
  })
}

async function tipEkle(onerilen) {
  const ad = await yeniTipPenceresi((onerilen || '').trim())
  if (!ad) return
  const kod = tipKodUret(ad)
  const mevcut = TIPLER.find(t => trBuyuk(t.ad) === trBuyuk(ad) || t.kod === kod)
  if (mevcut) { tipSec(mevcut.ad); return uyar(`"${mevcut.ad}" zaten listede — seçildi.`, true) }

  const sira = TIPLER.reduce((m, t) => Math.max(m, Number(t.sira) || 0), 0) + 1
  // §5.1: insert sonrası .select + length. RLS reddi hata DEĞİL 0 satır döner.
  const { data, error } = await supabase.from('tanimlar')
    .insert({ tip: 'MASRAF_TIPI', kod, ad, aktif: true, sira }).select('kod,ad')
  if (error) {
    dbHata('masraf tipi ekle', error)
    return uyar(error.code === '23505'
      ? 'Bu masraf tipi zaten var.'
      : 'Yeni tip eklenemedi (yetki?): ' + error.message)
  }
  if (!data || !data.length) return uyar('Yeni tip eklenemedi — bu yetki yönetici, muhasebe, finans ve bilgi işlemde.')

  await yenile?.()          // TIPLER'i DB'den tazeler ve formu yeniden çizer
  tipSec(data[0].ad)
  uyar(`"${data[0].ad}" masraf tipi eklendi.`, true)
}

// Yeniden çizim SONRASI tip alanını doldur — eleman yenilendiği için
// eski referans işe yaramaz. `input` olayı tetiklenir ki tedarikçi alanı /
// varsayılan tutar kuralları da çalışsın.
function tipSec(ad) {
  const inp = KAP?.querySelector('#mTip')
  if (!inp) return
  inp.value = ad
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.focus()
}

// ---------------------------------------------------------------------
// POP-UP
// Göksenil (4 Ağu 2026): "burayı bir yukarıdaki cam etiketi butonun yanına
//   masraflar diye bir buton yapalım, pop up şeklinde açılsın."
// Kart araç kartını uzatıyordu; defter herkesin her gün baktığı bir şey
// değil, isteyince açılsın.
// ---------------------------------------------------------------------
let PENCERE = null

export function masrafPencereAc(tazele) {
  if (!masrafGorur(BEN)) return
  masrafPencereKapat()
  const ov = document.createElement('div')
  ov.id = 'mdPencere'
  ov.className = 'fixed inset-0 z-[95] flex items-start justify-center pt-[6vh] px-4 bg-black/40 backdrop-blur-sm overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-5xl mb-8" onclick="event.stopPropagation()">
      <div class="px-5 py-4 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low">
        <div class="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary">${mat('receipt_long', '', true)}</div>
        <div class="min-w-0">
          <h3 class="text-lg font-black text-primary">Masraf Defteri</h3>
          <p class="text-xs text-on-surface-variant truncate" id="mdBaslik"></p>
        </div>
        <button class="md-kapat ml-auto p-2 hover:bg-white rounded-full text-on-surface-variant shrink-0">${mat('close')}</button>
      </div>
      <div id="mdGovde" class="p-5"></div>
    </div>`
  document.body.appendChild(ov)
  PENCERE = ov
  const esc = e => { if (e.key === 'Escape') masrafPencereKapat() }
  ov._esc = esc
  document.addEventListener('keydown', esc)
  ov.addEventListener('click', e => { if (e.target === ov) masrafPencereKapat() })
  ov.querySelectorAll('.md-kapat').forEach(b => b.addEventListener('click', masrafPencereKapat))
  masrafPencereCiz(tazele)
}

export function masrafPencereKapat() {
  if (!PENCERE) return
  document.removeEventListener('keydown', PENCERE._esc)
  PENCERE.remove(); PENCERE = null
}

// Pencere AÇIKKEN yeniden çiz — sayfanın tamamını yenilemek yerine yalnız
// gövdeyi tazeler; kayıt/silme sonrası pencere kapanmasın diye.
export function masrafPencereCiz(tazele) {
  if (!PENCERE) return
  const bas = PENCERE.querySelector('#mdBaslik')
  if (bas) bas.textContent = BASLIK || ''
  const govde = PENCERE.querySelector('#mdGovde')
  if (!govde) { console.error('[masraf] pencere govdesi bulunamadi'); return }
  govde.innerHTML = masrafGovdeHtml()
  masrafBagla(govde, async () => {
    await masrafYenile()
    masrafPencereCiz(tazele)
    await tazele?.()          // çağıran maliyet/fiyat kartını da tazelesin
  })
}

// Yalnız defter verisini tazele (araç/alış bilgisi zaten elimizde).
async function masrafYenile() {
  await masrafYukle({ aracId: AID, ben: BEN, dmap: DMAP, alisFiyati: ALIS_FIYAT, alisSekli: ALIS_SEKLI })
}
