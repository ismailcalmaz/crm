// =====================================================================
// havuz.js — "İş kapma" inbox workspace (Slack/HubSpot/Linear mantığı)
//   Split layout: sol kart listesi (Sahipsiz | Benim İşlerim) + sağ detay.
//   Kaynak: gorusme_notlari (sahipsiz = sahip yok), talepler ile birleşik.
// =====================================================================
import { supabase } from './supabase-client.js'
import {
  DURUMLAR, KAYIP_NEDENLERI, danismanMap, danismanAdi, aracOzet, fmtButce,
  fmtTarihKisa, durumSinifi, kapanisMi, kaybedildiMi, kacis, bugunISO,
} from './veri.js'
import { mat, pill, avatar, uyari } from './stitch-ui.js'

let benim = null, dmap = {}
let havuz = [], benimIsler = []
let sekme = 'sahipsiz', arama = '', filtre = 'hepsi', seciliId = null

const NOT_ALANLARI =
  'id, gorusme_notu, musteri_ad_soyad, telefon, musteri_durumu, acan_id, sahip_danisman_id, talep_id, created_at, ' +
  'talepler(marka,model,paket,model_yili_min,model_yili_max,butce_min,butce_max,kaynak)'

// --- Yardımcılar ---------------------------------------------------

function waLink(tel) {
  const d = (tel || '').replace(/\D/g, '')
  if (!d) return null
  const n = d.startsWith('0') ? '9' + d : d.startsWith('90') ? d : '90' + d
  return 'https://wa.me/' + n
}

// Havuz aciliyet skoru — TAZE iş = yüksek skor (soğumadan kap). Şeffaf kural.
function havuzSkor(n) {
  const dk = (Date.now() - new Date(n.created_at).getTime()) / 60000
  let p = 40
  if (dk < 15) p += 52
  else if (dk < 60) p += 40
  else if (dk < 180) p += 26
  else if (dk < 720) p += 14
  else if (dk < 1440) p += 6
  const t = n.talepler || {}
  if (t.butce_max || t.butce_min) p += 6
  if (['instagram-dm', 'web-takas', 'web-iletisim'].includes(t.kaynak)) p += 4
  return Math.max(5, Math.min(99, Math.round(p)))
}

// Bekleme süresi — metin + aciliyet rengi (0-1sa yeşil · 1g turuncu · 3g kırmızı · 7g+ bordo)
function bekleme(ts) {
  const dk = (Date.now() - new Date(ts).getTime()) / 60000
  if (dk < 60) return { txt: Math.max(1, Math.floor(dk)) + ' dk', cls: 'text-green-700', bar: 'border-green-500', bg: 'bg-green-50' }
  if (dk < 1440) return { txt: Math.floor(dk / 60) + ' saat', cls: 'text-amber-700', bar: 'border-amber-400', bg: 'bg-amber-50' }
  const gun = Math.floor(dk / 1440)
  if (dk < 4320) return { txt: gun + ' gün', cls: 'text-error', bar: 'border-error', bg: 'bg-error/5' }
  return { txt: gun + ' gün', cls: 'text-primary', bar: 'border-primary', bg: 'bg-primary/5' }
}

const KAYNAK_MINI = {
  'instagram-dm': ['photo_camera', 'Instagram', 'text-pink-600'],
  'web-takas': ['language', 'Web · Takas', 'text-secondary'],
  'web-iletisim': ['language', 'Web', 'text-secondary'],
  'kapi': ['storefront', 'Kapı', 'text-on-surface-variant'],
  'telefon': ['call', 'Telefon', 'text-on-surface-variant'],
}
function kaynakMini(k) {
  const [ik, ad, cls] = KAYNAK_MINI[k] || KAYNAK_MINI['telefon']
  return `<span class="inline-flex items-center gap-1 ${cls} text-[11px] font-bold">${mat(ik, 'text-[13px]')} ${ad}</span>`
}
function kaynakEtiket(k) { return (KAYNAK_MINI[k] || KAYNAK_MINI['telefon'])[1] }

function toast(msg, ikon = 'check_circle') {
  const t = document.getElementById('havuzToast')
  t.innerHTML = `${mat(ikon, 'text-[20px] text-green-400')} ${kacis(msg)}`
  t.classList.remove('hidden')
  clearTimeout(toast._z); toast._z = setTimeout(() => t.classList.add('hidden'), 2600)
}

// --- Kurulum -------------------------------------------------------

export async function havuzKur(danisman) {
  benim = danisman
  dmap = await danismanMap()
  document.getElementById('yenile')?.addEventListener('click', yukle)
  document.getElementById('havuzSekme')?.addEventListener('click', e => {
    const b = e.target.closest('[data-sekme]'); if (!b) return
    sekme = b.dataset.sekme; seciliId = null
    document.querySelectorAll('#havuzSekme [data-sekme]').forEach(x => {
      const a = x.dataset.sekme === sekme
      x.classList.toggle('bg-primary', a); x.classList.toggle('text-on-primary', a)
      x.classList.toggle('text-on-surface-variant', !a)
    })
    listeCiz()
  })
  document.getElementById('havuzAra')?.addEventListener('input', e => { arama = e.target.value.trim().toLocaleLowerCase('tr'); listeCiz() })
  document.getElementById('havuzFiltreler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return
    filtre = b.dataset.f; listeCiz()
  })
  await yukle()
  realtimeKur()
}

let _kanal = null, _zaman = null
function planla() { clearTimeout(_zaman); _zaman = setTimeout(yukle, 800) }
function realtimeKur() {
  if (_kanal) return
  _kanal = supabase.channel('havuz-canli')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gorusme_notlari' }, planla)
    .subscribe()
}

async function yukle() {
  const [{ data: h, error: e1 }, { data: b, error: e2 }] = await Promise.all([
    supabase.from('gorusme_notlari').select(NOT_ALANLARI)
      .is('sahip_danisman_id', null).is('stok_ref', null).order('created_at', { ascending: false }),
    supabase.from('gorusme_notlari').select(NOT_ALANLARI)
      .eq('sahip_danisman_id', benim.id).is('stok_ref', null).order('updated_at', { ascending: false }),
  ])
  const hedef = document.getElementById('havuzListe')
  if (e1 || e2) { hedef.innerHTML = uyari(`Veri okunamadı: ${kacis((e1 || e2).message)}`); return }
  havuz = h || []
  // Benim işlerim: yalnızca AÇIK (kapanmamış) işler
  benimIsler = (b || []).filter(n => !kapanisMi(n.musteri_durumu))
  kpiCiz()
  listeCiz()
}

// --- KPI -----------------------------------------------------------

function kpiCiz() {
  const bugun = bugunISO()
  const bugunGelen = havuz.filter(n => (n.created_at || '').slice(0, 10) === bugun).length
  // Ortalama bekleme (saat) — yüklü havuz listesinden hesaplanır (kesin)
  let ortTxt = '—'
  if (havuz.length) {
    const ortDk = havuz.reduce((s, n) => s + (Date.now() - new Date(n.created_at).getTime()) / 60000, 0) / havuz.length
    ortTxt = ortDk < 60 ? Math.round(ortDk) + ' dk' : ortDk < 1440 ? (ortDk / 60).toFixed(1) + ' sa' : (ortDk / 1440).toFixed(1) + ' g'
  }
  const kart = (ik, etiket, deger, renk) => `
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p></div>
    </div>`
  document.getElementById('havuzKpi').innerHTML =
    kart('inbox', 'Sahipsiz İş', havuz.length, 'bg-primary-fixed text-primary') +
    kart('assignment_ind', 'Benim İşlerim', benimIsler.length, 'bg-secondary/10 text-secondary') +
    kart('fiber_new', 'Bugün Gelen', bugunGelen, 'bg-green-100 text-green-700') +
    kart('hourglass_top', 'Ort. Bekleme', ortTxt, 'bg-amber-100 text-amber-700')

  const ss = document.getElementById('sekmeSahipsizSay'); if (ss) ss.textContent = havuz.length
  const bs = document.getElementById('sekmeBenimSay'); if (bs) bs.textContent = benimIsler.length
}

// --- Liste ---------------------------------------------------------

function kaynakOf(n) { return n.talepler?.kaynak || 'telefon' }

function listeFiltre(liste) {
  let v = liste
  if (filtre === 'bugun') v = v.filter(n => (n.created_at || '').slice(0, 10) === bugunISO())
  else if (filtre === 'instagram') v = v.filter(n => kaynakOf(n) === 'instagram-dm')
  else if (filtre === 'web') v = v.filter(n => ['web-takas', 'web-iletisim'].includes(kaynakOf(n)))
  else if (filtre === 'telefon') v = v.filter(n => kaynakOf(n) === 'telefon')
  if (arama) v = v.filter(n => [n.musteri_ad_soyad, n.telefon, n.talepler?.marka, n.talepler?.model, n.talepler?.paket]
    .filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(arama))
  return v
}

function listeCiz() {
  const hedef = document.getElementById('havuzListe')
  const havuzMu = sekme === 'sahipsiz'
  const ham = havuzMu ? havuz : benimIsler

  // Filtre çipleri
  const say = f => {
    const g = ham
    if (f === 'hepsi') return g.length
    if (f === 'bugun') return g.filter(n => (n.created_at || '').slice(0, 10) === bugunISO()).length
    if (f === 'instagram') return g.filter(n => kaynakOf(n) === 'instagram-dm').length
    if (f === 'web') return g.filter(n => ['web-takas', 'web-iletisim'].includes(kaynakOf(n))).length
    if (f === 'telefon') return g.filter(n => kaynakOf(n) === 'telefon').length
    return 0
  }
  const ops = [['hepsi', 'Hepsi'], ['bugun', 'Bugün'], ['instagram', 'Instagram'], ['web', 'Web'], ['telefon', 'Telefon']]
  document.getElementById('havuzFiltreler').innerHTML = ops.map(([k, l]) => {
    const a = k === filtre
    return `<button data-f="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${say(k)})</button>`
  }).join('')

  let veri = listeFiltre(ham)
  if (havuzMu) veri = veri.slice().sort((a, b) => havuzSkor(b) - havuzSkor(a))   // en acil önce

  if (!veri.length) {
    hedef.innerHTML = havuzMu
      ? `<div class="flex flex-col items-center justify-center text-center py-16 px-6">
          <div class="w-16 h-16 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center">${mat('celebration', 'text-4xl')}</div>
          <p class="mt-4 text-title-md font-bold text-on-surface">Havuz temiz! 🎉</p>
          <p class="text-body-md text-on-surface-variant mt-1 max-w-[280px]">${arama || filtre !== 'hepsi' ? 'Bu filtrede sahipsiz iş yok.' : 'Tüm işler sahiplenilmiş. Yeni bir talep gelince burada anında görünür.'}</p></div>`
      : `<div class="flex flex-col items-center justify-center text-center py-16 px-6">${mat('assignment_ind', 'text-4xl opacity-30')}
          <p class="mt-3 text-title-md font-bold text-on-surface">Aktif işin yok</p>
          <p class="text-body-md text-on-surface-variant mt-1 max-w-[280px]">Soldaki Sahipsiz listesinden bir iş kap; buraya düşsün.</p></div>`
    panelVarsayilan(veri)
    return
  }

  hedef.innerHTML = veri.map(n => kart(n, havuzMu)).join('')

  hedef.querySelectorAll('[data-row]').forEach(el => el.addEventListener('click', () => detayAc(el.dataset.row)))
  hedef.querySelectorAll('[data-sahiplen]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); sahiplen(b.dataset.sahiplen, b) }))
  panelVarsayilan(veri)
}

function kart(n, havuzMu) {
  const sk = havuzSkor(n)
  const bk = bekleme(n.created_at)
  const aktif = seciliId === n.id
  const arac = aracOzet(n.talepler)
  const butce = fmtButce(n.talepler?.butce_min, n.talepler?.butce_max)
  const wa = waLink(n.telefon)
  const acil = havuzMu && sk >= 80
  const rozet = havuzMu
    ? `<div class="shrink-0 text-center w-12"><div class="text-title-md font-black ${bk.cls} leading-none">${sk}</div><div class="text-[9px] font-bold uppercase tracking-wide text-on-surface-variant mt-0.5">skor</div></div>`
    : `<div class="shrink-0">${pill(n.musteri_durumu, durumSinifi(n.musteri_durumu))}</div>`

  const hover = `<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation()">
    ${n.telefon ? `<a href="tel:${kacis(n.telefon)}" class="p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary" title="Ara">${mat('call', 'text-[18px]')}</a>` : ''}
    ${wa ? `<a href="${wa}" target="_blank" class="p-1.5 rounded-lg hover:bg-green-100 text-on-surface-variant hover:text-green-600" title="WhatsApp">${mat('chat', 'text-[18px]')}</a>` : ''}
  </div>`
  const aksiyon = havuzMu
    ? `<button data-sahiplen="${n.id}" class="shrink-0 bg-primary text-on-primary px-3.5 py-2 rounded-lg text-label-md font-bold hover:opacity-90 transition-all flex items-center gap-1.5">${mat('bolt', 'text-[16px]')} Sahiplen</button>`
    : `<a href="talep.html?id=${n.talep_id}" onclick="event.stopPropagation()" class="shrink-0 text-primary p-1.5 rounded-lg hover:bg-primary/10" title="Detay sayfası">${mat('open_in_new', 'text-[18px]')}</a>`

  return `<div data-row="${n.id}" class="group cursor-pointer bg-white rounded-xl border border-outline-variant/70 border-l-4 ${bk.bar} ${aktif ? 'ring-2 ring-primary/30 bg-primary/5' : 'hover:shadow-md hover:border-outline-variant'} transition-all p-3 flex items-center gap-3">
    ${rozet}
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          ${avatar(n.musteri_ad_soyad, 'w-8 h-8')}
          <div class="min-w-0"><p class="font-bold text-on-surface truncate flex items-center gap-1.5">${kacis(n.musteri_ad_soyad) || '—'}${acil ? `<span class="bg-error/10 text-error text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Acil</span>` : ''}</p>
            <p class="text-[11px] text-on-surface-variant truncate">${kacis(n.telefon || '')}</p></div>
        </div>
        <span class="text-[11px] font-bold ${bk.cls} shrink-0 whitespace-nowrap">${bk.txt}</span>
      </div>
      <div class="flex items-center gap-2 mt-1.5 flex-wrap text-[12px] text-on-surface-variant">
        ${kaynakMini(kaynakOf(n))}
        <span class="text-outline-variant">·</span>
        <span class="inline-flex items-center gap-1">${mat('directions_car', 'text-[13px]')} ${kacis(arac)}</span>
        ${butce !== '—' ? `<span class="text-outline-variant">·</span><span class="font-semibold text-on-surface">${kacis(butce)}</span>` : ''}
      </div>
    </div>
    ${hover}
    ${aksiyon}
  </div>`
}

// --- Detay paneli --------------------------------------------------

function panelVarsayilan(veri) {
  if (window.innerWidth < 1280) return
  if (seciliId && veri.some(n => n.id === seciliId)) detayAc(seciliId, true)
  else if (veri.length) { seciliId = null; detayAc(veri[0].id, true) }
  else { seciliId = null; panelBos() }
}

function panelBos() {
  const panel = document.getElementById('havuzDetay')
  panel.classList.remove('hidden')
  panel.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">
    ${mat('touch_app', 'text-5xl opacity-30')}
    <p class="mt-3 font-semibold text-on-surface">Bir iş seçin</p>
    <p class="text-label-sm mt-1 max-w-[220px]">Listeden bir işe tıklayın; müşteri, araç, son notlar ve hızlı işlemler burada açılır.</p></div>`
}

async function detayAc(id, sessiz) {
  const havuzMu = sekme === 'sahipsiz'
  const n = (havuzMu ? havuz : benimIsler).find(x => x.id === id)
  if (!n) return
  seciliId = id
  const panel = document.getElementById('havuzDetay')
  const katman = document.getElementById('havuzDetayKatman')
  const wa = waLink(n.telefon)
  const sk = havuzSkor(n)
  const bk = bekleme(n.created_at)
  const arac = aracOzet(n.talepler)
  const butce = fmtButce(n.talepler?.butce_min, n.talepler?.butce_max)

  // Bu talebin notları (zaman çizelgesi için)
  let notlar = [n]
  if (n.talep_id) {
    const { data } = await supabase.from('gorusme_notlari')
      .select('id, musteri_durumu, gorusme_notu, acan_id, sahip_danisman_id, created_at')
      .eq('talep_id', n.talep_id).order('created_at', { ascending: false }).limit(20)
    if (data && data.length) notlar = data
  }
  const timeline = notlar.map(x => `
    <div class="relative">
      <div class="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full bg-primary ring-4 ring-white"></div>
      <div class="flex justify-between items-baseline gap-2"><span class="font-bold text-label-md text-on-surface">${kacis(x.musteri_durumu || '—')}</span><span class="text-[11px] text-on-surface-variant shrink-0">${fmtTarihKisa(x.created_at)}</span></div>
      ${x.gorusme_notu ? `<p class="text-label-sm text-on-surface-variant italic mt-0.5">"${kacis(x.gorusme_notu)}"</p>` : ''}
      <p class="text-[11px] text-on-surface-variant mt-0.5">${kacis(danismanAdi(dmap, x.sahip_danisman_id || x.acan_id) || 'Havuz')}</p>
    </div>`).join('')

  const durumSec = DURUMLAR.map(d => `<option value="${kacis(d)}"${d === n.musteri_durumu ? ' selected' : ''}>${kacis(d)}</option>`).join('')

  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant">
      <div class="flex justify-between items-start mb-3">
        <div class="flex items-center gap-3 min-w-0">${avatar(n.musteri_ad_soyad, 'w-12 h-12')}
          <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate flex items-center gap-2">${kacis(n.musteri_ad_soyad) || '—'}${havuzMu && sk >= 80 ? `<span class="bg-error/10 text-error text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Acil</span>` : ''}</h3>
            <p class="text-label-md text-on-surface-variant flex items-center gap-2">${kaynakMini(kaynakOf(n))} <span class="text-outline-variant">·</span> <span class="${bk.cls} font-bold">${bk.txt} bekliyor</span></p></div></div>
        <button id="havuzDetayKapat" class="p-1.5 hover:bg-surface-container-high rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      ${havuzMu
      ? `<button id="havuzDetaySahiplen" class="w-full bg-primary text-on-primary py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-sm shadow-primary/20">${mat('bolt', 'text-[18px]')} Bu İşi Sahiplen</button>`
      : `<a href="talep.html?id=${n.talep_id}" class="w-full bg-surface-container text-primary py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-2 hover:bg-surface-container-high">${mat('open_in_new', 'text-[18px]')} Talep Detayına Git</a>`}
      <div class="flex gap-2 mt-2">
        ${n.telefon ? `<a href="tel:${kacis(n.telefon)}" class="flex-1 bg-surface-container-low border border-outline-variant text-on-surface py-2 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:bg-surface-container">${mat('call', 'text-[18px]')} Ara</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" class="flex-1 bg-[#25D366] text-white py-2 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('chat', 'text-[18px]')} WhatsApp</a>` : ''}
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-lg">
      <div class="grid grid-cols-2 gap-2 mb-4 text-label-sm">
        <div class="bg-surface-container-low rounded-lg p-2.5"><p class="text-on-surface-variant text-[11px] uppercase tracking-wide">İlgilenilen Araç</p><p class="font-bold text-on-surface">${kacis(arac)}</p></div>
        <div class="bg-surface-container-low rounded-lg p-2.5"><p class="text-on-surface-variant text-[11px] uppercase tracking-wide">Bütçe</p><p class="font-bold text-on-surface">${kacis(butce)}</p></div>
      </div>
      <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-3">Son Notlar</p>
      <div class="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[6px] before:top-1 before:bottom-1 before:w-px before:bg-outline-variant">${timeline}</div>
    </div>
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest space-y-2">
      <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant flex items-center gap-1.5">${mat('edit_note', 'text-[16px] text-primary')} Hızlı Not</label>
      <textarea id="havuzNot" rows="2" placeholder="Görüşme özeti… (boş bırakılırsa sadece durum değişir)" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-3 text-body-md resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"></textarea>
      <div class="flex gap-2">
        <select id="havuzNotDurum" class="flex-1 bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md">${durumSec}</select>
        <button id="havuzNotKaydet" class="bg-primary text-on-primary px-4 rounded-lg font-bold text-label-md hover:opacity-90 flex items-center gap-1.5">${mat('send', 'text-[18px]')}</button>
      </div>
      <div id="havuzNotKayipWrap" class="gizli"><select id="havuzNotKayip" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-3 text-body-md">${KAYIP_NEDENLERI.map(k => `<option value="${kacis(k)}">${kacis(k)}</option>`).join('')}</select></div>
      <span id="havuzNotMsg" class="block text-label-sm text-on-surface-variant"></span>
    </div>`

  panel.classList.remove('hidden')
  if (window.innerWidth < 1280) {
    panel.classList.add('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none')
    katman.classList.remove('hidden')
  }
  const kapat = () => { panel.classList.add('hidden'); panel.classList.remove('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none'); katman.classList.add('hidden'); seciliId = null; listeCiz() }
  document.getElementById('havuzDetayKapat').addEventListener('click', kapat)
  katman.onclick = kapat
  document.getElementById('havuzDetaySahiplen')?.addEventListener('click', () => sahiplen(n.id))
  const dSel = document.getElementById('havuzNotDurum')
  dSel?.addEventListener('change', () => document.getElementById('havuzNotKayipWrap').classList.toggle('gizli', !kaybedildiMi(dSel.value)))
  document.getElementById('havuzNotKaydet')?.addEventListener('click', () => notEkle(n))
  if (!sessiz) listeCiz()
}

// Detaydan hızlı not ekle — yeni gorusme_notu (sahiplik korunur; havuzsa havuzda kalır)
async function notEkle(n) {
  const msg = document.getElementById('havuzNotMsg')
  const metin = document.getElementById('havuzNot').value.trim()
  const durum = document.getElementById('havuzNotDurum').value
  const kayip = kaybedildiMi(durum) ? document.getElementById('havuzNotKayip').value : null
  if (!metin && durum === n.musteri_durumu) { msg.className = 'block text-label-sm text-error'; msg.textContent = 'Not yazın ya da durumu değiştirin.'; return }
  if (kapanisMi(durum) && !confirm(`"${durum}" kapanış durumu — iş aktif havuzdan düşecek. Devam?`)) return
  msg.className = 'block text-label-sm text-on-surface-variant'; msg.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('gorusme_notlari').insert({
    talep_id: n.talep_id,
    gorusme_notu: metin || null,
    musteri_ad_soyad: n.musteri_ad_soyad,
    telefon: n.telefon || null,
    musteri_durumu: durum,
    kayip_nedeni: kayip,
    sahip_danisman_id: n.sahip_danisman_id ?? null,
    acan_id: benim.id,
    acilis_notu: false,
  })
  if (error) { console.error('havuz not ekle basarisiz', error); msg.className = 'block text-label-sm text-error'; msg.textContent = 'Hata: ' + error.message; return }
  msg.textContent = 'Not eklendi ✓'
  await yukle()
}

// --- Sahiplen (yarış korumalı) -------------------------------------

async function sahiplen(id, btn) {
  if (btn) { btn.disabled = true }
  // .select('id') ŞART: is(null) guard'ı 0 satır eşleştirince PostgREST hata
  // döndürmez, boş başarı döner → iki danışman aynı işi "aldım" sanabilir.
  const { data, error } = await supabase.from('gorusme_notlari')
    .update({ sahip_danisman_id: benim.id }).eq('id', id).is('sahip_danisman_id', null).select('id')
  if (error) { alert('Sahiplenme başarısız: ' + error.message); if (btn) btn.disabled = false; return }
  if (!data || !data.length) { toast('Bu işi başka biri sahiplendi.', 'info'); await yukle(); return }
  toast('İş üzerine alındı ✓')
  seciliId = null
  sekme = 'benim'
  document.querySelectorAll('#havuzSekme [data-sekme]').forEach(x => {
    const a = x.dataset.sekme === 'benim'
    x.classList.toggle('bg-primary', a); x.classList.toggle('text-on-primary', a); x.classList.toggle('text-on-surface-variant', !a)
  })
  await yukle()
}
