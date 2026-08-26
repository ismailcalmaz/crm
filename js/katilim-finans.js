// =====================================================================
// katilim-finans.js — Finans Takip Merkezi (Görev Merkezi workspace)
//   "Bugün kimi aramalıyım?" — vade aciliyeti + sağ sticky detay + hızlı aksiyon.
//   Kaynak: CRM talepler (katilim_finans=true) + son görüşme notu.
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, danismanAdi, finansDurum, fmtPara, fmtTarihKisa, telNo, waHref, kacis } from './veri.js'
import { mat, avatar, uyari } from './stitch-ui.js'

let benim = null, dmap = {}, _veri = []
let filtre = 'aranacak', arama = '', danFiltre = '', seciliId = null

// Vade aciliyeti → renk (yeşil normal · amber yaklaşan · kırmızı geçti/bugün)
function aciliyet(tarih) {
  const { kalan, durum } = finansDurum(tarih)
  if (durum === 'tarih_yok') return { kalan: null, sinif: 'notr', bar: 'border-outline-variant', metin: 'Tarih yok', cls: 'text-on-surface-variant', bg: '' }
  if (kalan < 0) return { kalan, sinif: 'gecti', bar: 'border-error', metin: `${-kalan} gün geçti`, cls: 'text-error', bg: 'bg-error/5' }
  if (kalan === 0) return { kalan, sinif: 'bugun', bar: 'border-error', metin: 'Bugün', cls: 'text-error', bg: 'bg-error/5' }
  if (kalan <= 15) return { kalan, sinif: 'yaklasti', bar: 'border-amber-400', metin: `${kalan} gün kaldı`, cls: 'text-amber-700', bg: 'bg-amber-50' }
  return { kalan, sinif: 'normal', bar: 'border-green-500', metin: `${kalan} gün kaldı`, cls: 'text-green-700', bg: '' }
}
const aranacakMi = r => { const k = finansDurum(r.finansman_tarihi).kalan; return k != null && k <= 0 }

function sonNot(r) {
  const notlar = (r.gorusme_notlari || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return notlar[0] || null
}
function sahipAdi(r) {
  const n = (r.gorusme_notlari || []).find(g => g.sahip_danisman_id)
  return n ? danismanAdi(dmap, n.sahip_danisman_id) : '—'
}
function sahipId(r) {
  const n = (r.gorusme_notlari || []).find(g => g.sahip_danisman_id)
  return n?.sahip_danisman_id || null
}
function waLink(tel) {
  const d = (tel || '').replace(/\D/g, ''); if (!d) return null
  const n = d.startsWith('0') ? '9' + d : d.startsWith('90') ? d : '90' + d
  return 'https://wa.me/' + n
}
function dosyaNo(r) { return '#F-' + String(r.id).replace(/\D/g, '').slice(-5).padStart(5, '0') }

export async function katilimKur(danisman) {
  benim = danisman
  dmap = await danismanMap()
  document.getElementById('yenile')?.addEventListener('click', yukle)
  document.getElementById('finansAra')?.addEventListener('input', e => { arama = e.target.value.trim().toLocaleLowerCase('tr'); ciz() })
  document.getElementById('filtreler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return; filtre = b.dataset.f; seciliId = null; ciz()
  })
  document.getElementById('danismanFiltre')?.addEventListener('change', e => { danFiltre = e.target.value; seciliId = null; ciz() })
  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('liste')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const { data, error } = await supabase.from('talepler')
    .select('id, musteri_ad_soyad, telefon, marka, model, finansman_tutari, finansman_tarihi, gorusme_notlari(sahip_danisman_id, gorusme_notu, acan_id, musteri_durumu, created_at)')
    .eq('katilim_finans', true)
    .order('finansman_tarihi', { ascending: true, nullsFirst: false })
  if (error) { hedef.innerHTML = uyari(`Okunamadı: ${kacis(error.message)}`); return }
  _veri = data || []
  danismanFiltreKur()
  ciz()
}

// Danışman filtresi — yalnızca yönetici/master
function danismanFiltreKur() {
  const wrap = document.getElementById('danismanFiltreWrap')
  if (!wrap) return   // bayat önbellek HTML'i → sessiz geç, sayfayı çökertme
  if (!(benim?.master_admin || benim?.rol === 'yonetici')) { wrap.classList.add('hidden'); return }
  const ids = [...new Set(_veri.map(sahipId).filter(Boolean))]
  const opts = ids.map(id => [id, danismanAdi(dmap, id)]).sort((a, b) => a[1].localeCompare(b[1], 'tr'))
  wrap.classList.remove('hidden')
  document.getElementById('danismanFiltre').innerHTML =
    `<option value="">Tüm danışmanlar</option>` + opts.map(([id, ad]) => `<option value="${id}"${id === danFiltre ? ' selected' : ''}>${kacis(ad)}</option>`).join('')
}

function ciz() {
  bandCiz(); kpiCiz(); ozetSeritCiz(); filtreCiz()
  const hedef = document.getElementById('liste')

  let v = _veri
  if (danFiltre) v = v.filter(r => sahipId(r) === danFiltre)
  if (filtre === 'aranacak') v = v.filter(aranacakMi)
  else if (filtre === 'yaklasti') v = v.filter(r => finansDurum(r.finansman_tarihi).durum === 'yaklasti')
  else if (filtre === 'ileri') v = v.filter(r => finansDurum(r.finansman_tarihi).durum === 'normal')
  if (arama) v = v.filter(r => [r.musteri_ad_soyad, r.telefon, r.marka, r.model].filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(arama))
  // Aciliyete göre sırala: en yakın vade / en çok geçmiş önce
  v = v.slice().sort((a, b) => {
    const ka = finansDurum(a.finansman_tarihi).kalan, kb = finansDurum(b.finansman_tarihi).kalan
    return (ka == null ? 1e9 : ka) - (kb == null ? 1e9 : kb)
  })

  document.getElementById('finansSayac').textContent = `${v.length} kayıt`
  if (!v.length) {
    hedef.innerHTML = `<div class="flex flex-col items-center justify-center text-center py-14 text-on-surface-variant">${mat('event_available', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">Bu filtrede kayıt yok.</p></div>`
    panelVarsayilan(v); return
  }
  hedef.innerHTML = v.map(kart).join('')
  hedef.querySelectorAll('[data-row]').forEach(el => el.addEventListener('click', () => detayAc(el.dataset.row)))
  panelVarsayilan(v)
}

function kart(r) {
  const a = aciliyet(r.finansman_tarihi)
  const aktif = seciliId === r.id
  const wa = waLink(r.telefon)
  const arac = [r.marka, r.model].filter(Boolean).join(' ') || '—'
  const kritik = a.sinif === 'gecti' || a.sinif === 'bugun'
  return `<div data-row="${r.id}" class="group cursor-pointer bg-white rounded-xl border border-outline-variant/70 border-l-4 ${a.bar} ${aktif ? 'ring-2 ring-primary/30 bg-primary/5' : 'hover:shadow-md'} transition-all p-3 flex items-center gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0">${avatar(r.musteri_ad_soyad, 'w-9 h-9')}
          <div class="min-w-0"><p class="font-bold text-on-surface truncate flex items-center gap-1.5">${kacis(r.musteri_ad_soyad) || '—'}${kritik ? `<span class="bg-error/10 text-error text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Kritik</span>` : ''}</p>
            <p class="text-[11px] text-on-surface-variant truncate">${dosyaNo(r)} · ${kacis(arac)}</p></div></div>
        <div class="text-right shrink-0"><div class="font-black text-on-surface">${fmtPara(r.finansman_tutari)}</div><div class="text-[11px] font-bold ${a.cls}">${a.metin}</div></div>
      </div>
      <div class="flex items-center gap-2 mt-1.5 text-[12px] text-on-surface-variant">
        <span class="inline-flex items-center gap-1">${mat('call', 'text-[13px]')} ${kacis(r.telefon || '—')}</span>
        <span class="text-outline-variant">·</span>
        <span class="inline-flex items-center gap-1">${mat('person', 'text-[13px]')} ${kacis(sahipAdi(r))}</span>
        <span class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation()">
          ${r.telefon ? `<a href="tel:${kacis(r.telefon)}" class="p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary" title="Ara">${mat('call', 'text-[17px]')}</a>` : ''}
          ${wa ? `<a href="${wa}" target="_blank" class="p-1.5 rounded-lg hover:bg-green-100 text-on-surface-variant hover:text-green-600" title="WhatsApp">${mat('chat', 'text-[17px]')}</a>` : ''}
          <a href="talep.html?id=${r.id}" class="p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary" title="Talep detayı">${mat('open_in_new', 'text-[17px]')}</a>
        </span>
      </div>
    </div>
  </div>`
}

// --- Bugün Aranacaklar bandı ---
function bandCiz() {
  const aranacak = _veri.filter(r => (!danFiltre || sahipId(r) === danFiltre) && aranacakMi(r))
  const toplam = aranacak.reduce((s, r) => s + (Number(r.finansman_tutari) || 0), 0)
  document.getElementById('bugunBand').innerHTML = `
    <div class="rounded-2xl bg-on-surface text-white p-lg md:p-xl flex flex-col md:flex-row md:items-center justify-between gap-4 custom-shadow">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">${mat('phone_in_talk', 'text-[26px]')}</div>
        <div>
          <p class="text-headline-sm font-black leading-tight">Bugün Aranması Gerekenler: ${aranacak.length} Müşteri</p>
          <p class="text-white/70 text-body-md mt-0.5">Toplam bekleyen tutar: <span class="font-bold text-white">${fmtPara(toplam)}</span></p>
        </div>
      </div>
      <button id="siraylaAra" class="bg-primary text-on-primary px-6 py-3 rounded-xl text-label-md font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shrink-0 ${aranacak.length ? '' : 'opacity-40 pointer-events-none'}">${mat('play_arrow', 'text-[22px]')} Sırayla Ara</button>
    </div>`
  document.getElementById('siraylaAra')?.addEventListener('click', () => {
    filtre = 'aranacak'; seciliId = null; ciz()
    const ilk = _veri.filter(r => (!danFiltre || sahipId(r) === danFiltre) && aranacakMi(r))
      .sort((a, b) => finansDurum(a.finansman_tarihi).kalan - finansDurum(b.finansman_tarihi).kalan)[0]
    if (ilk) detayAc(ilk.id)
  })
}

// --- KPI ---
function kpiCiz() {
  const v = danFiltre ? _veri.filter(r => sahipId(r) === danFiltre) : _veri
  const toplam = v.reduce((s, r) => s + (Number(r.finansman_tutari) || 0), 0)
  const yak = v.filter(r => finansDurum(r.finansman_tarihi).durum === 'yaklasti').length
  const aranacak = v.filter(aranacakMi).length
  const enBuyuk = v.reduce((m, r) => Math.max(m, Number(r.finansman_tutari) || 0), 0)
  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight truncate">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('kpi').innerHTML =
    kart('account_balance_wallet', 'bg-primary-fixed text-primary', 'Toplam Bekleyen', fmtPara(toplam), v.length + ' kayıt') +
    kart('notifications_active', 'bg-amber-100 text-amber-700', 'Yaklaşan (≤15g)', yak, 'hatırlatma') +
    kart('phone_in_talk', 'bg-error-container text-error', 'Bugün Aranacak', aranacak, 'bugün + geçmiş') +
    kart('trending_up', 'bg-secondary/10 text-secondary', 'En Büyük Finansman', fmtPara(enBuyuk), 'tek kayıt')
}

// --- Yaklaşan hatırlatma özeti ---
function ozetSeritCiz() {
  const v = danFiltre ? _veri.filter(r => sahipId(r) === danFiltre) : _veri
  const say = (a, b) => v.filter(r => { const k = finansDurum(r.finansman_tarihi).kalan; return k != null && k >= a && k <= b }).length
  const gecti = v.filter(r => { const k = finansDurum(r.finansman_tarihi).kalan; return k != null && k < 0 }).length
  const kutular = [
    ['Geçti', gecti, 'text-error', 'bg-error/5'],
    ['Bugün', say(0, 0), 'text-error', 'bg-error/5'],
    ['3 gün', say(1, 3), 'text-amber-700', 'bg-amber-50'],
    ['7 gün', say(4, 7), 'text-amber-700', 'bg-amber-50'],
    ['15 gün', say(8, 15), 'text-amber-700', 'bg-amber-50'],
    ['30 gün', say(16, 30), 'text-green-700', 'bg-green-50'],
  ]
  document.getElementById('ozetSerit').innerHTML = kutular.map(([e, n, cls, bg]) =>
    `<div class="rounded-xl border border-outline-variant ${bg} p-3 text-center"><p class="text-headline-sm font-black ${cls} leading-none">${n}</p><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mt-1">${e}</p></div>`).join('')
}

function filtreCiz() {
  const v = danFiltre ? _veri.filter(r => sahipId(r) === danFiltre) : _veri
  const say = k => k === 'hepsi' ? v.length
    : k === 'aranacak' ? v.filter(aranacakMi).length
    : k === 'yaklasti' ? v.filter(r => finansDurum(r.finansman_tarihi).durum === 'yaklasti').length
    : v.filter(r => finansDurum(r.finansman_tarihi).durum === 'normal').length
  const ops = [['aranacak', 'Bugün Aranacak'], ['yaklasti', 'Yaklaşan (≤15g)'], ['ileri', 'İleri Tarihli'], ['hepsi', 'Hepsi']]
  document.getElementById('filtreler').innerHTML = ops.map(([k, l]) => {
    const a = k === filtre
    return `<button data-f="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${say(k)})</button>`
  }).join('')
}

// --- Sticky detay paneli ---
function panelVarsayilan(v) {
  if (window.innerWidth < 1280) return
  if (seciliId && v.some(r => r.id === seciliId)) detayAc(seciliId, true)
  else if (v.length) { seciliId = null; detayAc(v[0].id, true) }
  else { seciliId = null; panelBos() }
}
function panelBos() {
  const panel = document.getElementById('finansDetay')
  panel.classList.remove('hidden')
  panel.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">${mat('account_balance', 'text-5xl opacity-30')}<p class="mt-3 font-semibold text-on-surface">Bir kayıt seçin</p><p class="text-label-sm mt-1 max-w-[220px]">Müşteri, finansman tutarı, son not ve hızlı işlemler burada açılır.</p></div>`
}

function detayAc(id, sessiz) {
  const r = _veri.find(x => x.id === id); if (!r) return
  seciliId = id
  const panel = document.getElementById('finansDetay')
  const katman = document.getElementById('finansDetayKatman')
  const a = aciliyet(r.finansman_tarihi)
  const not = sonNot(r)
  const wa = waLink(r.telefon)
  const arac = [r.marka, r.model].filter(Boolean).join(' ') || '—'
  const kritik = a.sinif === 'gecti' || a.sinif === 'bugun'

  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant">
      <div class="flex justify-between items-start mb-3">
        <div class="flex items-center gap-3 min-w-0">${avatar(r.musteri_ad_soyad, 'w-12 h-12')}
          <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate">${kacis(r.musteri_ad_soyad) || '—'}</h3>
            <p class="text-label-md text-on-surface-variant truncate">${dosyaNo(r)} · ${kacis(arac)}</p></div></div>
        <button id="finansKapat" class="p-1.5 hover:bg-surface-container-high rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      ${kritik ? `<div class="mb-2"><span class="bg-error/10 text-error text-[11px] font-bold px-2 py-1 rounded uppercase tracking-wide">Kritik görev · ${kacis(a.metin)}</span></div>` : ''}
      <div class="rounded-xl border border-outline-variant p-3 mb-3">
        <div class="flex items-center justify-between"><span class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Bekleyen Finansman</span><span class="text-[11px] font-bold ${a.cls}">${kacis(a.metin)}</span></div>
        <p class="text-headline-sm font-black text-on-surface mt-1">${fmtPara(r.finansman_tutari)}</p>
        <p class="text-label-sm text-on-surface-variant mt-0.5">Hatırlatma: <b>${fmtTarihKisa(r.finansman_tarihi)}</b></p>
      </div>
      <div class="flex gap-2">
        ${r.telefon ? `<a href="tel:${kacis(r.telefon)}" class="flex-1 bg-primary text-on-primary py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('call', 'text-[18px]')} Hemen Ara</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" class="flex-1 bg-[#25D366] text-white py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('chat', 'text-[18px]')} WhatsApp</a>` : ''}
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-lg space-y-4">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1.5">Son Not</p>
        ${not?.gorusme_notu
      ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-body-md text-on-surface italic">"${kacis(not.gorusme_notu)}"<p class="text-[11px] text-on-surface-variant not-italic mt-2">${fmtTarihKisa(not.created_at)} · ${kacis(danismanAdi(dmap, not.acan_id) || '')}</p></div>`
      : '<p class="text-label-md text-on-surface-variant">Henüz not yok.</p>'}
      </div>
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1.5">Sahip Danışman</p>
        <p class="text-body-md font-semibold text-on-surface flex items-center gap-1.5">${mat('person', 'text-[18px] text-on-surface-variant')} ${kacis(sahipAdi(r))}</p>
      </div>
    </div>
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest">
      <a href="talep.html?id=${r.id}" class="w-full bg-surface-container text-primary py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:bg-surface-container-high">${mat('open_in_new', 'text-[18px]')} Talep Detayını Aç</a>
    </div>`

  panel.classList.remove('hidden')
  if (window.innerWidth < 1280) {
    panel.classList.add('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none')
    katman.classList.remove('hidden')
  }
  const kapat = () => { panel.classList.add('hidden'); panel.classList.remove('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none'); katman.classList.add('hidden'); seciliId = null; ciz() }
  document.getElementById('finansKapat').addEventListener('click', kapat)
  katman.onclick = kapat
  if (!sessiz) ciz()
}
