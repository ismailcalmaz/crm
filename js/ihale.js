// =====================================================================
// ihale.js — İHALE (kendi stoğumuzu ihaleye çıkarma) · sql/110
//
//   Göksenil: "İsmail Bey fiyatlarken ihale olduğunu belirtiyor. Sonraki süreç
//   operasyon ekibi aracı ihale firmasına götürüyor. Satın alma birimi ihaleye
//   çıktığını takip ediyor. Satıldığında… bilgi işlem aracı siparişe alıyor…
//   noter, yevmiye numarası, resmî satış beyanı… cariye tahsilat… teslimat
//   onaya gitsin. İhale satışları master admine, İsmail Bey'e, Samet Bey'e
//   bildirim olarak gitsin."
//
//   Dört rol, tek sayfa:
//     İsmail Bey / master  → "İhaleye Çıkar" (işaretleme)
//     MASTER ADMİN         → onay kuyruğu (Göksenil: "sorgu bana dönsün")
//     operasyon / satın alma → götürüldü · ihalede · geri çek
//     bilgi işlem / master → satış kaydı (noter + yevmiye + resmî beyan)
//
//   ⚠️ KURAL YOK, ÇAĞRI VAR. Onay sırası, yetki ve cari/teslimat zinciri
//   sunucudaki fonksiyonlarda (sql/110). Buradaki düğmeler yalnız çağırır;
//   istemcide ikinci bir kural yazılmaz — yazılsaydı sunucuyla ayrışabilirdi.
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, fmtTarihKisa, kacis, trBuyuk, dbHata } from './veri.js'
import { mat, bosDurum, stitchTablo, kpiKart, sekmeBar } from './stitch-ui.js'
import { ihaleIsaretler, ihaleOnaylar, ihaleTakipEder, ihaleSatisiKaydeder } from './yetki.js'

let BEN = null
let LISTE = []
let sekme = 'onay'

const SEKMELER = [
  { key: 'onay',    label: 'Onay Bekleyenler', ik: 'pending_actions',
    rozet: () => LISTE.filter(i => i.onay_durumu === 'BEKLIYOR').length || null },
  { key: 'surec',   label: 'Süreçte',          ik: 'local_shipping',
    rozet: () => LISTE.filter(i => i.onay_durumu === 'ONAYLANDI' && ['HAZIR', 'IHALEDE'].includes(i.durum)).length || null },
  { key: 'satilan', label: 'Satılanlar',       ik: 'task_alt' },
  { key: 'kapali',  label: 'Geri Çekilenler',  ik: 'undo' },
]

export async function ihaleKur(d) {
  BEN = d
  document.getElementById('yenile')?.addEventListener('click', yukle)

  const cikarBtn = document.getElementById('cikarBtn')
  if (ihaleIsaretler(BEN)) {
    cikarBtn.classList.remove('hidden')
    cikarBtn.classList.add('flex')
    cikarBtn.addEventListener('click', cikarAc)
  }

  document.getElementById('sekmeler').addEventListener('click', e => {
    const b = e.target.closest('[data-sekme]'); if (!b) return
    sekme = b.dataset.sekme; ciz()
  })

  // Olay KAPSAYICIDA — içerik her sekme değişiminde yeniden çiziliyor.
  document.getElementById('icerik').addEventListener('click', e => {
    const o = e.target.closest('.ih-onay')
    if (o) { onayla(o.dataset.id, o.dataset.karar === 'evet'); return }
    const t = e.target.closest('.ih-takip')
    if (t) { takip(t.dataset.id, t.dataset.durum); return }
    const s = e.target.closest('.ih-satis')
    if (s) { satisAc(s.dataset.id, s.dataset.ad); return }
  })

  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('icerik')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const { data, error } = await supabase.from('v_ihale_takip').select('*').order('isaret_tarihi', { ascending: false })
  if (error) {
    dbHata('ihale takip', error)
    hedef.innerHTML = `<div class="uyari-kutu">İhale listesi okunamadı: ${kacis(error.message)}</div>`
    return
  }
  LISTE = data || []
  document.getElementById('sayac').textContent = LISTE.length ? `· ${LISTE.length} kayıt` : ''
  kpiCiz()
  ciz()
}

function kpiCiz() {
  const bekleyen = LISTE.filter(i => i.onay_durumu === 'BEKLIYOR')
  const ihalede = LISTE.filter(i => i.durum === 'IHALEDE').length
  const satilan = LISTE.filter(i => i.durum === 'SATILDI')
  const ciro = satilan.reduce((s, i) => s + (Number(i.noter_satis_tutari) || 0), 0)
  // Onayda bekleyen en eski kayıt — "kaç gündür bekliyor" görünsün
  const enEski = bekleyen.length ? Math.max(...bekleyen.map(i => i.bekleme_gun || 0)) : 0
  document.getElementById('kpi').innerHTML = [
    kpiKart('pending_actions', 'bg-amber-100 text-amber-700', bekleyen.length, 'Onay Bekliyor',
      bekleyen.length ? `en eskisi ${enEski} gündür` : 'Kuyruk boş'),
    kpiKart('local_shipping', 'bg-blue-100 text-blue-700', ihalede, 'İhalede', 'Firmada, sonuç bekleniyor'),
    kpiKart('task_alt', 'bg-green-100 text-green-700', satilan.length, 'Satıldı', 'Toplam'),
    kpiKart('payments', 'bg-purple-100 text-purple-700', ciro ? fmtPara(ciro) : '—', 'İhale Cirosu', 'Resmî beyan toplamı'),
  ].join('')
}

function ciz() {
  document.getElementById('sekmeler').innerHTML =
    sekmeBar(SEKMELER.map(s => [s.key, s.label, s.ik, s.rozet ? s.rozet() : null]), sekme)
  const h = document.getElementById('icerik')
  const suzgec = {
    onay:    i => i.onay_durumu === 'BEKLIYOR',
    surec:   i => i.onay_durumu === 'ONAYLANDI' && ['HAZIR', 'IHALEDE'].includes(i.durum),
    satilan: i => i.durum === 'SATILDI',
    kapali:  i => i.durum === 'GERI_CEKILDI',
  }[sekme]
  const veri = LISTE.filter(suzgec)
  if (!veri.length) {
    h.innerHTML = bosDurum({
      onay: 'Onay bekleyen ihale yok.', surec: 'Süreçte ihale yok.',
      satilan: 'Henüz ihalede satılan araç yok.', kapali: 'Geri çekilen ihale yok.',
    }[sekme], 'gavel')
    return
  }
  h.innerHTML = ({ onay: onayHtml, surec: surecHtml, satilan: satilanHtml, kapali: kapaliHtml }[sekme])(veri)
}

function aracHucre(i) {
  return `<div><p class="font-bold text-on-surface">${kacis(trBuyuk(i.plaka || '—'))}</p>
    <p class="text-[12px] text-on-surface-variant">${kacis(trBuyuk([i.marka, i.model].filter(Boolean).join(' ')))} ${i.yil || ''}</p></div>`
}
const aracLink = i => `<a href="arac-kart.html?id=${encodeURIComponent(i.arac_id)}" class="px-2.5 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold hover:bg-primary hover:text-white transition-all">Araç</a>`

// ---------- ONAY KUYRUĞU (master admin) ----------
function onayHtml(veri) {
  const yetkili = ihaleOnaylar(BEN)
  const satirlar = veri.map(i => ({
    hucreler: [
      aracHucre(i),
      `<div><p class="text-body-sm">${kacis(i.isaretleyen || '—')}</p>
        <p class="text-[11px] text-on-surface-variant">${fmtTarihKisa(i.isaret_tarihi)}${i.bekleme_gun ? ` · ${i.bekleme_gun} gündür` : ''}</p></div>`,
      `<span class="text-body-sm">${i.crm_fiyati ? fmtPara(i.crm_fiyati) : '—'}</span>`,
      `<span class="text-[12px] text-on-surface-variant">${kacis(i.isaret_notu || '')}</span>`,
      `<div class="flex justify-end gap-1.5">${yetkili ? `
        <button class="ih-onay px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-label-md font-bold" data-id="${i.ihale_id}" data-karar="evet">Onayla</button>
        <button class="ih-onay px-2.5 py-1.5 rounded-lg border border-error/40 text-error text-label-md font-bold hover:bg-error/5" data-id="${i.ihale_id}" data-karar="hayir">Reddet</button>` : ''}
        ${aracLink(i)}</div>`,
    ],
  }))
  const not = yetkili ? '' :
    `<p class="text-body-sm text-on-surface-variant mb-3">${mat('info', 'text-[16px] align-middle')} İhale onayını yalnız master admin verir.</p>`
  return not + stitchTablo(['Araç', 'İşaretleyen', 'CRM Fiyatı', 'Not', ['', true]], satirlar)
}

// ---------- SÜREÇ (operasyon / satın alma / bilgi işlem) ----------
function surecHtml(veri) {
  const takipci = ihaleTakipEder(BEN)
  const satisci = ihaleSatisiKaydeder(BEN)
  const satirlar = veri.map(i => ({
    hucreler: [
      aracHucre(i),
      `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${i.durum === 'IHALEDE' ? 'bg-blue-100 text-blue-700' : 'bg-surface-container text-on-surface-variant'}">${i.durum === 'IHALEDE' ? 'İhalede' : 'Hazır'}</span>`,
      `<div><p class="text-[12px] text-on-surface-variant">${i.goturuldu_tarihi ? 'Götürüldü: ' + fmtTarihKisa(i.goturuldu_tarihi) : 'Henüz götürülmedi'}</p>
        <p class="text-[11px] text-on-surface-variant">${kacis(i.takip_notu || '')}</p></div>`,
      `<span class="text-body-sm">${i.crm_fiyati ? fmtPara(i.crm_fiyati) : '—'}</span>`,
      `<div class="flex flex-wrap justify-end gap-1.5">
        ${takipci && i.durum !== 'IHALEDE' ? `<button class="ih-takip px-2.5 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold" data-id="${i.ihale_id}" data-durum="IHALEDE">İhaleye Götürüldü</button>` : ''}
        ${satisci && i.durum === 'IHALEDE' ? `<button class="ih-satis px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-label-md font-bold" data-id="${i.ihale_id}" data-ad="${kacis([i.plaka, i.marka, i.model].filter(Boolean).join(' '))}">Satış Kaydet</button>` : ''}
        ${takipci ? `<button class="ih-takip px-2.5 py-1.5 rounded-lg border border-error/40 text-error text-label-md font-bold hover:bg-error/5" data-id="${i.ihale_id}" data-durum="GERI_CEKILDI">Geri Çek</button>` : ''}
        ${aracLink(i)}</div>`,
    ],
  }))
  return stitchTablo(['Araç', 'Durum', 'Takip', 'CRM Fiyatı', ['', true]], satirlar)
}

// ---------- SATILANLAR ----------
function satilanHtml(veri) {
  const satirlar = veri.map(i => ({
    hucreler: [
      aracHucre(i),
      `<span class="text-body-sm">${kacis(i.ihale_firmasi || '—')}</span>`,
      `<div><p class="text-body-sm font-bold">${i.noter_satis_tutari ? fmtPara(i.noter_satis_tutari) : '—'}</p>
        <p class="text-[11px] text-on-surface-variant">resmî beyan</p></div>`,
      `<div><p class="text-[12px]">${kacis(i.noter_adi || '—')}</p>
        <p class="text-[11px] text-on-surface-variant">yevmiye ${kacis(i.yevmiye_no || '—')}</p></div>`,
      `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${i.teslimat_durumu === 'ONAYLANDI' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">${i.teslimat_durumu === 'ONAYLANDI' ? 'Teslimat onaylandı' : 'Teslimat onayında'}</span>`,
      `<div class="flex justify-end gap-1.5">${aracLink(i)}</div>`,
    ],
  }))
  return stitchTablo(['Araç', 'İhale Firması', 'Tutar', 'Noter', 'Teslimat', ['', true]], satirlar)
}

function kapaliHtml(veri) {
  const satirlar = veri.map(i => ({
    hucreler: [
      aracHucre(i),
      `<span class="text-body-sm">${kacis(i.onay_durumu === 'REDDEDILDI' ? 'Reddedildi' : 'Geri çekildi')}</span>`,
      `<span class="text-[12px] text-on-surface-variant">${kacis(i.red_nedeni || i.takip_notu || '—')}</span>`,
      `<span class="text-[11px] text-on-surface-variant">${fmtTarihKisa(i.onay_tarihi || i.isaret_tarihi)}</span>`,
      `<div class="flex justify-end gap-1.5">${aracLink(i)}</div>`,
    ],
  }))
  return stitchTablo(['Araç', 'Sonuç', 'Neden', 'Tarih', ['', true]], satirlar)
}

// ---------- İŞLEMLER ----------
async function onayla(id, evet) {
  let neden = null
  if (!evet) {
    neden = prompt('Reddetme nedeni? (zorunlu)')
    if (neden === null) return
    if (!neden.trim()) { alert('Reddetme nedeni zorunlu.'); return }
  }
  const { error } = await supabase.rpc('ihale_onayla', { p_id: id, p_onay: evet, p_neden: neden })
  if (error) { console.error('[ihale] onay', error); alert('İşlem yapılamadı: ' + error.message); return }
  await yukle()
}

async function takip(id, durum) {
  let not = null
  if (durum === 'GERI_CEKILDI') {
    not = prompt('Geri çekme nedeni?')
    if (not === null) return
  }
  const { error } = await supabase.rpc('ihale_takip', {
    p_id: id, p_durum: durum,
    p_goturuldu: durum === 'IHALEDE' ? new Date().toISOString().slice(0, 10) : null,
    p_not: not,
  })
  if (error) { console.error('[ihale] takip', error); alert('İşlem yapılamadı: ' + error.message); return }
  await yukle()
}

// ---------- İHALEYE ÇIKAR (işaretleme) ----------
// ⚠️ Göksenil'in tarifinde işaret FİYATLAMA sırasında konuyor. Fiyatlama
// ekranı canlı ve İsmail Bey her gün kullanıyor; oraya dokunmak ayrı onay
// istiyor (.ai/26 kabul listesi). Bu yüzden işaretleme şimdilik BURADAN
// yapılıyor — akış aynı, giriş noktası farklı.
async function cikarAc() {
  const { data: araclar, error } = await supabase.from('stok_araclar')
    .select('id, plaka, marka, model, yil, durum')
    .in('durum', ['STOKTA', 'YAYINDA', 'SANAYIDE', 'HAZIRLIK', 'FOTOGRAF_BEKLIYOR', 'FIYATLANDIRMA_BEKLIYOR'])
    .order('plaka')
  if (error) { dbHata('ihale · arac listesi', error); alert('Araçlar okunamadı: ' + error.message); return }
  const acikta = new Set(LISTE.filter(i => !['SATILDI', 'GERI_CEKILDI'].includes(i.durum)).map(i => i.arac_id))
  const uygun = (araclar || []).filter(a => !acikta.has(a.id))
  if (!uygun.length) { alert('İhaleye çıkarılabilecek araç yok.'); return }

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[85] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('gavel', 'text-[18px]')} İhaleye Çıkar</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="p-4 space-y-3">
        <div>
          <label class="block text-label-sm text-on-surface-variant mb-1">Araç <span class="text-error">*</span></label>
          <select id="ihArac" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white">
            ${uygun.map(a => `<option value="${a.id}">${kacis(trBuyuk([a.plaka, a.marka, a.model].filter(Boolean).join(' ')))} ${a.yil || ''}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-label-sm text-on-surface-variant mb-1">Not</label>
          <textarea id="ihNot" rows="2" placeholder="neden ihaleye çıkıyor?" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-sm bg-white"></textarea>
        </div>
        <p class="text-[11px] text-on-surface-variant">Kaydedince <b>master admin onayına</b> düşer; onay verilmeden araç ihaleye götürülemez.</p>
        <p id="ihDurum" class="text-body-sm text-on-surface-variant"></p>
      </div>
      <div class="flex justify-end gap-2 p-4 border-t border-outline-variant">
        <button data-kapat class="px-4 py-2 rounded-lg border border-outline-variant text-label-md font-bold">Vazgeç</button>
        <button id="ihKaydet" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-bold">Onaya Gönder</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))

  ov.querySelector('#ihKaydet').addEventListener('click', async () => {
    const btn = ov.querySelector('#ihKaydet'); btn.disabled = true
    const durumEl = ov.querySelector('#ihDurum'); durumEl.textContent = 'Kaydediliyor…'
    const { error: e2 } = await supabase.rpc('ihale_isaretle', {
      p_arac: ov.querySelector('#ihArac').value,
      p_not: ov.querySelector('#ihNot').value.trim() || null,
    })
    if (e2) {
      console.error('[ihale] isaretle', e2)
      durumEl.className = 'text-body-sm text-error'
      durumEl.textContent = 'Kaydedilemedi: ' + e2.message
      btn.disabled = false
      return
    }
    durumEl.className = 'text-body-sm text-[#1a7a3d]'
    durumEl.textContent = '✓ Master admin onayına gönderildi.'
    setTimeout(() => { kapat(); yukle() }, 1200)
  })
}

// ---------- SATIŞ KAYDI (bilgi işlem) ----------
async function satisAc(ihaleId, ad) {
  // Alıcı = ihale firması, TÜZEL müşteri (Göksenil kararı)
  const { data: firmalar, error } = await supabase.from('musteriler')
    .select('id, ad_soyad').eq('tip', 'SIRKET').order('ad_soyad').limit(500)
  if (error) { dbHata('ihale · firma listesi', error); alert('Firmalar okunamadı: ' + error.message); return }

  // Alıcıların ezici çoğunluğu arabam.com — varsayılan olarak seçili gelsin
  // (Göksenil, 25 Ağu 2026). Yine de değiştirilebilir.
  // ⚠️ 'araba' ile eşleştirme YETMEZ: listede "Araba Sepeti Otomotiv A.Ş" ve
  //   "Arabasatcom Teknoloji ..." de var. Ayrım 'arabam' ÖN EKİNDE.
  // ⚠️ toLocaleLowerCase('tr') şart — düz toLowerCase Türkçe I'yı bozar.
  // Firma adı değişirse eşleşme düşer ve varsayılan seçili gelmez; zararsız,
  // kullanıcı listeden seçer. Sabit UUID gömmek yerine bu tercih edildi.
  const varsayilanFirma = (firmalar || []).find(f =>
    (f.ad_soyad || '').toLocaleLowerCase('tr').startsWith('arabam'))?.id || ''

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[85] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('receipt_long', 'text-[18px]')} İhale Satışı — ${kacis(trBuyuk(ad || ''))}</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="overflow-y-auto p-4 space-y-3">
        <div>
          <label class="block text-label-sm text-on-surface-variant mb-1">İhale firması (alıcı) <span class="text-error">*</span></label>
          <select id="isFirma" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white">
            <option value="">— seç —</option>
            ${(firmalar || []).map(f => `<option value="${f.id}"${f.id === varsayilanFirma ? ' selected' : ''}>${kacis(f.ad_soyad)}</option>`).join('')}
          </select>
          <p class="text-[11px] text-on-surface-variant mt-1">Firma listede yoksa önce Müşteri Merkezi'nden <b>şirket</b> olarak eklenmeli.</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">Resmî satış beyanı (₺) <span class="text-error">*</span></label>
            <input id="isBeyan" type="number" min="0" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
          </div>
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">Anlaşılan tutar (₺)</label>
            <input id="isAnlasilan" type="number" min="0" placeholder="resmî beyanla dolar" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
            <p id="isAnlasilanNot" class="text-[11px] text-on-surface-variant mt-1">Resmî beyanı izliyor — farklıysa üzerine yazın.</p>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">Noter <span class="text-error">*</span></label>
            <input id="isNoter" type="text" placeholder="örn. Gaziemir 3. Noteri" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
          </div>
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">Yevmiye no <span class="text-error">*</span></label>
            <input id="isYevmiye" type="text" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
          </div>
        </div>
        <div>
          <label class="block text-label-sm text-on-surface-variant mb-1">Satış tarihi</label>
          <input id="isTarih" type="date" value="${new Date().toISOString().slice(0, 10)}" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
        </div>
        <div class="p-3 rounded-lg bg-surface-container text-[12px] text-on-surface-variant leading-relaxed">
          Kaydedince sistem <b>tek işlemde</b>: siparişi açar (danışmansız, şirket satışı),
          resmî beyanı <b>finansın belirlediği hesaba tahsilat</b> olarak yazar,
          dosyayı <b>teslimat onayına</b> gönderir ve master admin + İsmail Bey + Samet Bey'e bildirim atar.
        </div>
        <p id="isDurum" class="text-body-sm text-on-surface-variant"></p>
      </div>
      <div class="flex justify-end gap-2 p-4 border-t border-outline-variant">
        <button data-kapat class="px-4 py-2 rounded-lg border border-outline-variant text-label-md font-bold">Vazgeç</button>
        <button id="isKaydet" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-bold">Satışı Kaydet</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))

  // ---- Resmî beyan → anlaşılan tutar canlı aynası -------------------------
  // İkisi çoğu ihalede aynı; kullanıcı aynı sayıyı iki kez yazıyordu.
  // ⚠️ Bayraklar MODAL KAPSAMINDA (modül düzeyinde DEĞİL): satisAc her
  //   açılışta yeniden çalışıyor, bayrak dışarıda tutulsaydı bir kez elle
  //   tutar giren kullanıcıda ayna bir daha HİÇ açılmazdı. Aynı hata
  //   siparis-dosya.js'te yaşandı, orada elle sıfırlanıyor.
  // ⚠️ Ölçüt DEĞER KARŞILAŞTIRMASI, tuşa basma değil: aynanın programla
  //   yazdığı değer 'input' olayı üretmez, dolayısıyla kullanıcının yazdığı
  //   ile aynanın yazdığı birbirine karışmaz.
  const beyanEl = ov.querySelector('#isBeyan')
  const anlEl   = ov.querySelector('#isAnlasilan')
  const anlNot  = ov.querySelector('#isAnlasilanNot')
  let anlElle = false      // kullanıcı anlaşılan tutarı kendi mi yazdı?
  let anlAynaSon = ''      // aynanın en son yazdığı değer

  beyanEl.addEventListener('input', () => {
    if (anlElle) return
    anlAynaSon = beyanEl.value
    anlEl.value = anlAynaSon
  })

  anlEl.addEventListener('input', () => {
    if (anlEl.value === '') {           // temizlendi → ayna geri açılır
      anlElle = false
      anlAynaSon = ''
      anlNot.textContent = 'Resmî beyanı izliyor — farklıysa üzerine yazın.'
      anlNot.className = 'text-[11px] text-on-surface-variant mt-1'
      return
    }
    if (anlEl.value === anlAynaSon || anlElle) return
    anlElle = true
    anlNot.textContent = 'Elle girildi — resmî beyanı artık izlemiyor. Temizlerseniz yeniden izler.'
    anlNot.className = 'text-[11px] text-amber-800 mt-1'
  })

  ov.querySelector('#isKaydet').addEventListener('click', async () => {
    const durumEl = ov.querySelector('#isDurum')
    const firma = ov.querySelector('#isFirma').value
    const beyan = Number(ov.querySelector('#isBeyan').value) || 0
    const noter = ov.querySelector('#isNoter').value.trim()
    const yevmiye = ov.querySelector('#isYevmiye').value.trim()
    // Zorunlular istemcide de kontrol ediliyor ki kullanıcı sunucu hatasıyla
    // karşılaşmadan eksiği görsün; asıl kapı yine sunucuda (sql/110).
    if (!firma || !beyan || !noter || !yevmiye) {
      durumEl.className = 'text-body-sm text-error'
      durumEl.textContent = 'Firma, resmî beyan, noter ve yevmiye zorunlu.'
      return
    }
    const btn = ov.querySelector('#isKaydet'); btn.disabled = true
    durumEl.className = 'text-body-sm text-on-surface-variant'
    durumEl.textContent = 'Kaydediliyor…'
    const { data, error: e2 } = await supabase.rpc('ihale_satisi_kaydet', {
      p_ihale_id: ihaleId, p_firma_musteri_id: firma,
      p_anlasilan: Number(ov.querySelector('#isAnlasilan').value) || null,
      p_resmi_beyan: beyan, p_noter_adi: noter, p_yevmiye_no: yevmiye,
      p_satis_tarihi: ov.querySelector('#isTarih').value || null,
    })
    if (e2) {
      console.error('[ihale] satis', e2)
      durumEl.className = 'text-body-sm text-error'
      durumEl.textContent = 'Kaydedilemedi: ' + e2.message
      btn.disabled = false
      return
    }
    durumEl.className = 'text-body-sm text-[#1a7a3d]'
    durumEl.textContent = `✓ Satış kaydedildi. Tahsilat ${kacis(data?.kasa || '')} hesabına yazıldı, dosya teslimat onayına gitti.`
    setTimeout(() => { kapat(); yukle() }, 1800)
  })
}
