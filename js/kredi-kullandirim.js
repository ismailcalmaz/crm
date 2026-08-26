// =====================================================================
// kredi-kullandirim.js — R6-4 Faz B: "Kullandırıma Geçen İşlemler" kuyruğu
//   (Can'ın ekranı). Kredi personelinin kredi.js'te "Kullandırma Başla" ile
//   açtığı kredi_kullandirim (durum='ONAY_BEKLIYOR') satırlarını listeler;
//   Onayla → kredi_kullandirim_onayla RPC (dondur + cari yaz + ONAYLANDI).
//   İptal → kredi_kullandirim_iptal RPC (ters kayıt, İADE YOK).
//   Formül/iş mantığı burada YAZILMAZ — hepsi sql/74 RPC'lerinde.
//
//   Erişim: master veya 'kredi_kullandirim_onay' yetkisi. RLS (sql/74)
//   ayrıca is_master()/is_kredi() istiyor — bu ikisi örtüşmüyorsa (örn.
//   yetki bayrağı rol='kredi' olmayan birine atanırsa) RLS satırları
//   SESSİZCE boş döner (hata değil). Bu, bu görevin ATAMA yapmayan
//   kapsamı dışındaki bilinen bir açık (bkz. sql/74 sonundaki not).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, fmtTarih, dbHata, danismanMap, danismanAdi, bugunISO } from './veri.js'
import { mat, uyari, bosDurum, binlikInputKur } from './stitch-ui.js'

let benim = null
let danMap = {}
let liste = []              // kredi_kullandirim, durum='ONAY_BEKLIYOR'
let bugunOnaylanan = 0
let iptalAcikId = null      // hangi satırın "İptal nedeni" formu açık
let mesgul = null           // RPC çağrısı süren satır id'si (butonlar kilitli)
let hatalar = {}            // id -> satır altı hata metni
let taslakNet = {}          // id -> "Onaylanan Net Geçen" alanında son yazılan değer (hata sonrası kaybolmasın)

const one = v => (Array.isArray(v) ? v[0] : v) || null

// --- Giriş noktası ------------------------------------------------------
export async function krediKullandirimKur(danisman) {
  benim = danisman
  const kok = document.getElementById('kok')
  const yetkili = !!(benim?.master_admin || (Array.isArray(benim?.yetkiler) && benim.yetkiler.includes('kredi_kullandirim_onay')))
  if (!yetkili) { kok.innerHTML = uyari('Bu sayfaya yetkiniz yok.'); return }

  binlikInputKur()
  kok.innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`
  danMap = await danismanMap()
  await yukle()
}

// --- Veri okuma -----------------------------------------------------------
async function yukle() {
  const [{ data, error }, { count: bugunSayi, error: e2 }] = await Promise.all([
    supabase.from('kredi_kullandirim')
      .select(`id, banka_kod, siparis_id, musteri_id, baslatan_id, kullandiran_danisman_id,
                sistem_net_gecen, manuel_net_gecen, created_at,
                kredi_bankalari(ad),
                kredi_banka_sonuclari(banka, sonuc, tutar),
                musteriler(ad_soyad),
                siparisler(id, anlasilan_tutar, stok_araclar(marka, model, yil, plaka))`)
      .eq('durum', 'ONAY_BEKLIYOR')
      .order('created_at', { ascending: true }),
    supabase.from('kredi_kullandirim')
      .select('id', { count: 'exact', head: true })
      .eq('durum', 'ONAYLANDI')
      .gte('onay_tarihi', bugunISO() + 'T00:00:00'),
  ])
  if (dbHata('kredi_kullandirim liste oku', error)) {
    document.getElementById('kok').innerHTML = uyari('Kuyruk okunamadı: ' + kacis(error.message))
    return
  }
  dbHata('kredi_kullandirim bugun sayisi', e2)
  liste = data || []
  bugunOnaylanan = bugunSayi ?? 0
  ciz()
}

// --- Görüntü yardımcıları ---------------------------------------------
function bankaAdi(kk) { return kk.kredi_bankalari?.ad || one(kk.kredi_banka_sonuclari)?.banka || kk.banka_kod || '—' }
function musteriAdi(kk) { return one(kk.musteriler)?.ad_soyad || '—' }
function aracOzeti(kk) {
  const sip = one(kk.siparisler)
  const a = sip ? one(sip.stok_araclar) : null
  if (!a) return '—'
  return [a.yil, a.marka, a.model].filter(Boolean).join(' ') + (a.plaka ? ' · ' + a.plaka : '') || '—'
}
function anlasilanTutar(kk) { const sip = one(kk.siparisler); return sip?.anlasilan_tutar }

// =====================================================================
// ÇİZİM
// =====================================================================
function ciz() {
  const kok = document.getElementById('kok')
  kok.innerHTML = `
    <div class="mb-lg">
      <h2 class="text-headline-md text-primary">Kullandırıma Geçen İşlemler</h2>
      <p class="text-body-md text-on-surface-variant">Kredi personelinin başlattığı kullandırım istekleri — onayla veya iptal et. Onaylananlar cari'ye kırmızı KREDİ tahsilatı olarak işlenir.</p>
    </div>
    ${kpiHtml()}
    <div class="mt-lg space-y-md">
      ${liste.length ? liste.map(satirHtml).join('') : bosDurum('Onay bekleyen kullandırım isteği yok.', 'inbox')}
    </div>`
  baglaOlaylar()
}

function kpiHtml() {
  const kart = (etiket, deger, ikon, renk, bg) => `
    <div class="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${bg} flex items-center justify-center ${renk} shrink-0">${mat(ikon)}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p></div>
    </div>`
  return `<div class="grid grid-cols-2 gap-gutter max-w-lg">
    ${kart('Onay Bekleyen', String(liste.length), 'inbox', 'text-primary', 'bg-primary-fixed')}
    ${kart('Bugün Onaylanan', String(bugunOnaylanan), 'verified', 'text-green-700', 'bg-green-100')}
  </div>`
}

function satirHtml(kk) {
  const banka = bankaAdi(kk)
  const musteri = musteriAdi(kk)
  const aracOz = aracOzeti(kk)
  const kullandiran = danismanAdi(danMap, kk.kullandiran_danisman_id)
  const baslatan = danismanAdi(danMap, kk.baslatan_id)
  const iptalAcik = iptalAcikId === kk.id
  const kilit = mesgul === kk.id
  const onayNetVarsayilan = taslakNet[kk.id] ?? Number(kk.manuel_net_gecen || 0).toLocaleString('tr-TR')

  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-lg space-y-3" data-kk="${kk.id}">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-title-md font-bold text-on-surface">${kacis(banka)}</span>
          <span class="text-[11px] text-on-surface-variant">${fmtTarih(kk.created_at)}</span>
        </div>
        <p class="text-body-md text-on-surface mt-0.5">${kacis(musteri)}</p>
        <p class="text-label-sm text-on-surface-variant">${kacis(aracOz)}</p>
      </div>
      <div class="text-right shrink-0">
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Manuel Net Geçen</p>
        <p class="text-title-lg font-black text-primary">${fmtPara(kk.manuel_net_gecen)}</p>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-label-sm bg-surface-container-low rounded-lg p-3">
      <div><span class="text-on-surface-variant block text-[10px] uppercase">Kullandıran</span><b>${kacis(kullandiran)}</b></div>
      <div><span class="text-on-surface-variant block text-[10px] uppercase">Başlatan</span><b>${kacis(baslatan)}</b></div>
      <div><span class="text-on-surface-variant block text-[10px] uppercase">Sistem Hesabı (ref.)</span><b>${kk.sistem_net_gecen != null ? fmtPara(kk.sistem_net_gecen) : 'Elle giriş'}</b></div>
      <div><span class="text-on-surface-variant block text-[10px] uppercase">Anlaşılan Tutar</span><b>${anlasilanTutar(kk) != null ? fmtPara(anlasilanTutar(kk)) : '—'}</b></div>
    </div>

    <div class="flex items-end gap-2 flex-wrap">
      <div class="flex-1 min-w-[160px]">
        <label class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Onaylanan Net Geçen (₺)</label>
        <input id="kkOnayNet-${kk.id}" class="para-gir w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-body-md font-bold focus:ring-2 focus:ring-primary/20 outline-none" value="${kacis(onayNetVarsayilan)}" inputmode="numeric"${kilit ? ' disabled' : ''} />
      </div>
      <button data-onayla="${kk.id}" class="bg-primary text-on-primary px-lg h-10 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5 disabled:opacity-50"${kilit ? ' disabled' : ''}>${mat('check_circle', 'text-[18px]')} ${kilit ? 'İşleniyor…' : 'Kullandırımı Tamamla'}</button>
      <button data-iptal-ac="${kk.id}" class="border border-outline-variant text-error px-lg h-10 rounded-lg text-label-md font-bold hover:bg-error/5 disabled:opacity-50"${kilit ? ' disabled' : ''}>İptal</button>
    </div>

    ${iptalAcik ? `<div class="bg-error-container/40 border border-error/30 rounded-lg p-3 space-y-2">
      <label class="text-[11px] font-bold uppercase tracking-wide text-on-error-container">İptal nedeni *</label>
      <textarea id="kkIptalNot-${kk.id}" rows="2" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2 text-body-md focus:ring-2 focus:ring-error/20 outline-none" placeholder="Kısaca yazın"${kilit ? ' disabled' : ''}></textarea>
      <div class="flex items-center gap-2">
        <button data-iptal-onayla="${kk.id}" class="bg-error text-white px-lg h-9 rounded-lg text-label-md font-bold disabled:opacity-50"${kilit ? ' disabled' : ''}>Evet, iptal et</button>
        <button data-iptal-vazgec="${kk.id}" class="text-label-md text-on-surface-variant underline"${kilit ? ' disabled' : ''}>Vazgeç</button>
      </div>
    </div>` : ''}

    ${hatalar[kk.id] ? `<p class="text-label-sm text-error">${kacis(hatalar[kk.id])}</p>` : ''}
  </div>`
}

// =====================================================================
// OLAYLAR — tek delege edilmiş dinleyici (kok yeniden çizilse de kalır)
// =====================================================================
function baglaOlaylar() {
  const kok = document.getElementById('kok')
  if (kok.dataset.bagli) return
  kok.dataset.bagli = '1'
  kok.addEventListener('click', e => {
    const onaylaBtn = e.target.closest('[data-onayla]')
    if (onaylaBtn) { onayla(onaylaBtn.dataset.onayla); return }
    const iptalAcBtn = e.target.closest('[data-iptal-ac]')
    if (iptalAcBtn) { iptalAcikId = iptalAcBtn.dataset.iptalAc; ciz(); return }
    const iptalVazgecBtn = e.target.closest('[data-iptal-vazgec]')
    if (iptalVazgecBtn) { iptalAcikId = null; ciz(); return }
    const iptalOnaylaBtn = e.target.closest('[data-iptal-onayla]')
    if (iptalOnaylaBtn) { iptalOnayla(iptalOnaylaBtn.dataset.iptalOnayla); return }
  })
}

async function onayla(id) {
  const input = document.getElementById(`kkOnayNet-${id}`)
  taslakNet[id] = input?.value || taslakNet[id]
  const raw = (input?.value || '').replace(/\D/g, '')
  const tutar = Number(raw)
  if (!tutar || tutar <= 0) { hatalar[id] = 'Onaylanan net geçen tutarı girin.'; ciz(); return }

  hatalar[id] = null; mesgul = id; ciz()
  const { error } = await supabase.rpc('kredi_kullandirim_onayla', { p_kullandirim_id: id, p_onaylanan_net_gecen: tutar })
  mesgul = null
  if (dbHata('kredi_kullandirim_onayla', error)) { hatalar[id] = 'Onaylanamadı: ' + (error.message || ''); ciz(); return }
  delete taslakNet[id]; delete hatalar[id]
  await yukle()
}

async function iptalOnayla(id) {
  const ta = document.getElementById(`kkIptalNot-${id}`)
  const not = (ta?.value || '').trim()
  if (!not) { hatalar[id] = 'İptal notu zorunlu.'; ciz(); return }

  hatalar[id] = null; mesgul = id; ciz()
  const { error } = await supabase.rpc('kredi_kullandirim_iptal', { p_kullandirim_id: id, p_not: not })
  mesgul = null
  if (dbHata('kredi_kullandirim_iptal', error)) { hatalar[id] = 'İptal edilemedi: ' + (error.message || ''); ciz(); return }
  iptalAcikId = null; delete hatalar[id]
  await yukle()
}
