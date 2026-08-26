// =====================================================================
// talepler.js — Talep listesi (Stitch tablo + filtre) + Yeni Talep
// =====================================================================
import { supabase } from './supabase-client.js'
import {
  DURUMLAR, KAYIP_NEDENLERI, danismanMap, danismanAdi, aracOzet, fmtButce, fmtTarihKisa,
  durumSinifi, kapanisMi, kaybedildiMi, telSon10, csvIndir, kacis, bugunISO,
} from './veri.js'
import { mat, pill, avatar, bosDurum, uyari, stitchTablo, tabloTikla } from './stitch-ui.js'
import { ARAC_KATALOG } from './arac-katalog.js'

let benim = null, dmap = {}, _liste = [], filtre = 'hepsi', _mkMevcut = []
let tarihAsc = false   // false = yeni→eski (varsayılan); tarih başlığına tıklayınca döner

// Talep, tarihinden 1 ay (30 gün) sonra otomatik pasif sayılır (durumu ne olursa olsun)
const PASIF_GUN = 30
function pasifMi(t) {
  if (!t.talep_tarihi) return false
  return (Date.now() - new Date(t.talep_tarihi).getTime()) > PASIF_GUN * 86400000
}

// Kaynak rozeti — Instagram/Web talepleri listede göze çarpsın (telefon = varsayılan, rozetsiz)
function kaynakRozet(kaynak) {
  if (kaynak === 'instagram-dm') {
    return `<span class="inline-flex items-center gap-1 text-label-sm font-bold px-2 py-0.5 rounded-full text-white" style="background:linear-gradient(45deg,#f58529,#dd2a7b,#8134af)" title="Instagram DM'den geldi">${mat('photo_camera', 'text-[13px]')} Instagram</span>`
  }
  if (kaynak === 'web-takas' || kaynak === 'web-iletisim') {
    return `<span class="inline-flex items-center gap-1 bg-secondary/10 text-secondary text-label-sm font-bold px-2 py-0.5 rounded-full" title="Web sitesinden geldi">${mat('language', 'text-[13px]')} Web</span>`
  }
  return ''
}

// Talep kategorisi (GÜNCEL = en son nota göre)
function kategori(t) {
  const not = guncelNot(t)
  if (!not || !not.sahip_danisman_id) return 'havuz'
  if (kapanisMi(not.musteri_durumu)) return 'kapanan'
  return 'aktif'
}

// Takip: güncel notun sonraki adım tarihi bugün veya geçmişse "aranacak"
function takipTarihi(t) { return guncelNot(t)?.sonraki_adim_tarihi || null }
function takipGeldiMi(t) {
  const d = takipTarihi(t)
  return !!d && d <= bugunISO() && !kapanisMi(guncelNot(t)?.musteri_durumu)
}

// Durgun: AKTİF talep, son notu N gündür güncellenmemiş, ileri takip tarihi de yok.
// "İletişim kuruldu deyip susulmuş" talepleri yakalar (kapandı mı devam mı belirsiz).
const DURGUN_GUN = 3
function sessizGun(t) {   // son not üzerinden kaç gün geçti
  const not = guncelNot(t)
  if (!not?.created_at) return 0
  return Math.floor((Date.now() - new Date(not.created_at).getTime()) / 86400000)
}
function durgunMu(t) {
  if (kategori(t) !== 'aktif') return false            // sahiplenilmiş + açık durum
  if (guncelNot(t)?.sonraki_adim_tarihi) return false  // takip planlı → "Aranacak" ilgilenir
  return sessizGun(t) >= DURGUN_GUN
}

// --- Kademeli araç seçimi (Araç Tipi > Marka > Model) + model yılı + bütçe formatı ---
function katalogKur() {
  const kat = document.getElementById('katKategori')
  const marka = document.getElementById('katMarka')
  const model = document.getElementById('katModel')
  const yilMin = document.getElementById('katYilMin')
  const yilMax = document.getElementById('katYilMax')
  if (!kat) return

  const doldur = (sel, liste, ilk) => {
    sel.innerHTML = `<option value="">${ilk}</option>` +
      liste.map(v => `<option value="${kacis(v)}">${kacis(v)}</option>`).join('')
  }
  doldur(kat, Object.keys(ARAC_KATALOG), 'Seçiniz')

  const buYil = new Date().getFullYear() + 1
  const yillar = []
  for (let y = buYil; y >= 1990; y--) yillar.push(String(y))
  if (yilMin) doldur(yilMin, yillar, 'min')
  if (yilMax) doldur(yilMax, yillar, 'max')

  kat.addEventListener('change', () => {
    const k = kat.value
    if (k && ARAC_KATALOG[k]) { doldur(marka, Object.keys(ARAC_KATALOG[k]), 'Seçiniz'); marka.disabled = false }
    else { marka.innerHTML = '<option value="">Önce araç tipi seçin</option>'; marka.disabled = true }
    model.innerHTML = '<option value="">Önce marka seçin</option>'; model.disabled = true
  })
  marka.addEventListener('change', () => {
    const k = kat.value, m = marka.value
    if (k && m && ARAC_KATALOG[k]?.[m]) { doldur(model, ARAC_KATALOG[k][m], 'Seçiniz'); model.disabled = false }
    else { model.innerHTML = '<option value="">Önce marka seçin</option>'; model.disabled = true }
  })
}

// Para girişi: yazarken binlik nokta (1.000.000)
function paraFormatla(el) {
  const v = el.value.replace(/\D/g, '')
  el.value = v ? Number(v).toLocaleString('tr-TR') : ''
}
function paraKur() {
  document.querySelectorAll('.para-input').forEach(el =>
    el.addEventListener('input', () => paraFormatla(el)))
}
// Noktalı/formatlı metinden sayı ("1.000.000" → 1000000)
function paraSayi(v) { const s = (v || '').replace(/\D/g, ''); return s ? Number(s) : null }

export async function taleplerKur(danisman) {
  benim = danisman
  dmap = await danismanMap()

  const durumSel = document.getElementById('yeniTalepDurum')
  if (durumSel) durumSel.innerHTML = DURUMLAR.map(d => `<option value="${kacis(d)}">${kacis(d)}</option>`).join('')

  katalogKur()
  paraKur()

  document.getElementById('yeniAcBtn')?.addEventListener('click', () => {
    mukerrerKapat()
    document.getElementById('yeniTalepKart').classList.toggle('gizli')
  })
  // "Yeni Eylem → Yeni Talep" menüsünden gelindiyse formu doğrudan aç
  if (new URLSearchParams(location.search).get('yeni') === '1') {
    document.getElementById('yeniTalepKart')?.classList.remove('gizli')
    setTimeout(() => document.getElementById('yeniTalepKart')?.scrollIntoView({ behavior: 'smooth' }), 200)
  }
  document.getElementById('talepForm')?.addEventListener('submit', kaydet)
  document.getElementById('iptalBtn')?.addEventListener('click', () => {
    mukerrerKapat()
    document.getElementById('yeniTalepKart').classList.add('gizli')
  })
  const kc = document.getElementById('katilimCheck')
  kc?.addEventListener('change', () =>
    document.getElementById('finansAlanlari').classList.toggle('gizli', !kc.checked))
  document.getElementById('yenile')?.addEventListener('click', yukle)
  document.getElementById('excelBtn')?.addEventListener('click', excelAktar)
  document.getElementById('filtreler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return
    filtre = b.dataset.f; ciz()
  })
  const araEl = document.getElementById('talepAra')
  araEl?.addEventListener('input', e => { arama = e.target.value.trim().toLocaleLowerCase('tr'); ciz() })
  document.getElementById('yogunluk')?.addEventListener('click', e => {
    const b = e.target.closest('[data-yog]'); if (!b) return; yog = b.dataset.yog
    document.querySelectorAll('#yogunluk [data-yog]').forEach(x => { x.classList.toggle('text-primary', x.dataset.yog === yog); x.classList.toggle('text-on-surface-variant', x.dataset.yog !== yog) })
    ciz()
  })
  // Ctrl+K artık global komut paletidir (auth.js → komut-paleti.js)
  document.getElementById('filtreBtn')?.addEventListener('click', filtrePaneliAc)
  await yukle()
  realtimeKur()
}

// --- Otomatik yenileme: yeni talep/not gelince listeyi tazele (manuel yenileme gerekmez) ---
let _kanal = null, _yenidenZaman = null
function planlaYenile() { clearTimeout(_yenidenZaman); _yenidenZaman = setTimeout(() => yukle(), 800) }
function realtimeKur() {
  if (_kanal) return
  _kanal = supabase.channel('talepler-canli')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'talepler' }, planlaYenile)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gorusme_notlari' }, planlaYenile)
    .subscribe()
}

function excelAktar(idler) {
  const kaynak = (Array.isArray(idler) && idler.length) ? _liste.filter(t => idler.includes(t.id)) : _liste
  if (!kaynak.length) return
  const basliklar = ['Müşteri', 'Telefon', 'Marka', 'Model', 'Bütçe Min', 'Bütçe Max', 'Durum', 'Sahip', 'Tarih']
  const satirlar = kaynak.map(t => {
    const not = guncelNot(t)
    return [t.musteri_ad_soyad, t.telefon, t.marka, t.model, t.butce_min, t.butce_max,
      not?.musteri_durumu || '', not?.sahip_danisman_id ? danismanAdi(dmap, not.sahip_danisman_id) : 'Havuzda',
      fmtTarihKisa(t.talep_tarihi)]
  })
  csvIndir('talepler', basliklar, satirlar)
}

async function yukle() {
  const hedef = document.getElementById('talepListe')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const { data, error } = await supabase.from('talepler')
    .select('*, gorusme_notlari(id, musteri_durumu, sahip_danisman_id, acan_id, gorusme_notu, acilis_notu, kayip_nedeni, created_at, sonraki_adim_tarihi)')
    .order('talep_tarihi', { ascending: false })

  if (error) { hedef.innerHTML = uyari(`Okunamadı: ${kacis(error.message)}`); return }
  _liste = data || []
  ciz()
}

// ==== Workspace render (code.html + DESIGN.md düzeni, marka bordosu) ====
let yog = 'normal', arama = '', seciliId = null
const secili = new Set()
const kaynakFiltre = new Set(), danismanFiltre = new Set()   // gelişmiş filtre (advanced_filter_state)

function waLink(tel) {
  const d = (tel || '').replace(/\D/g, '')
  if (!d) return null
  const n = d.startsWith('0') ? '9' + d : d.startsWith('90') ? d : '90' + d
  return 'https://wa.me/' + n
}

// AI öncelik skoru — şeffaf kural: aşama + takip gecikmesi + sessizlik + bütçe
function aiSkor(t) {
  const not = guncelNot(t)
  if (!not) return { p: 50, e: '🟠', cls: 'text-amber-700' }
  if (kapanisMi(not.musteri_durumu)) return { p: 10, e: '🟢', cls: 'text-on-surface-variant opacity-50' }
  let p = 38
  const d = not.musteri_durumu
  if (d === 'Pazarlık' || d === 'Kredi Bekliyor' || d === 'Kapora / Rezerve') p += 30
  else if (d === 'Test / Ekspertiz / Teklif') p += 18
  else if (d === 'İletişim Kuruldu') p += 8
  const tk = not.sonraki_adim_tarihi
  if (tk) { if (tk < bugunISO()) p += 26; else if (tk === bugunISO()) p += 16 }
  else if (not.sahip_danisman_id) { const s = sessizGun(t); if (s >= 7) p += 24; else if (s >= 3) p += 12 }
  if (!not.sahip_danisman_id) p += 10
  if (t.butce_max || t.butce_min) p += 5
  p = Math.max(5, Math.min(99, p))
  const e = p >= 75 ? '🔥' : p >= 50 ? '🟠' : '🟢'
  const cls = p >= 75 ? 'text-error font-bold' : p >= 50 ? 'text-amber-700 font-bold' : 'text-on-surface-variant'
  return { p, e, cls }
}

// Akıllı satır rengi: geciken/sessiz → kırmızı, bugün aranacak → sarı
function satirRenk(t) {
  const not = guncelNot(t)
  if (!not || kapanisMi(not.musteri_durumu)) return { row: '', bar: '' }
  const tk = not.sonraki_adim_tarihi
  if (tk && tk < bugunISO()) return { row: 'bg-error/5', bar: 'border-l-4 border-error' }
  if (tk === bugunISO()) return { row: 'bg-amber-50', bar: 'border-l-4 border-amber-400' }
  if (!tk && not.sahip_danisman_id && sessizGun(t) >= 7) return { row: 'bg-error/5', bar: 'border-l-4 border-error' }
  return { row: '', bar: '' }
}

function ciz() {
  const hedef = document.getElementById('talepListe')
  const aktifListe = _liste.filter(t => !pasifMi(t))
  const pasifListe = _liste.filter(pasifMi)

  const say = k => {
    if (k === 'pasif') return pasifListe.length
    if (k === 'hepsi') return aktifListe.length
    if (k === 'finans') return aktifListe.filter(t => t.katilim_finans).length
    if (k === 'takip') return aktifListe.filter(takipGeldiMi).length
    if (k === 'durgun') return aktifListe.filter(durgunMu).length
    return aktifListe.filter(t => kategori(t) === k).length
  }
  const ops = [['hepsi', 'Hepsi'], ['havuz', 'Havuzda'], ['aktif', 'Aktif'], ['takip', 'Aranacak'], ['durgun', 'Durgun'], ['kapanan', 'Kapanan'], ['finans', 'Katılım Finans'], ['pasif', 'Pasif']]
  document.getElementById('filtreler').innerHTML = ops.map(([k, l]) => {
    const a = k === filtre
    return `<button data-f="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${say(k)})</button>`
  }).join('')

  let veri = filtre === 'pasif' ? pasifListe
    : filtre === 'hepsi' ? aktifListe
    : filtre === 'finans' ? aktifListe.filter(t => t.katilim_finans)
    : filtre === 'takip' ? aktifListe.filter(takipGeldiMi)
    : filtre === 'durgun' ? aktifListe.filter(durgunMu)
    : aktifListe.filter(t => kategori(t) === filtre)

  if (arama) {
    const q = arama
    veri = veri.filter(t => [t.musteri_ad_soyad, t.telefon, t.marka, t.model, t.paket, t.aciklama]
      .filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(q))
  }
  // Gelişmiş filtre: kaynak + danışman (boşsa filtre yok)
  if (kaynakFiltre.size) veri = veri.filter(t => kaynakFiltre.has(t.kaynak || 'telefon'))
  if (danismanFiltre.size) veri = veri.filter(t => {
    const s = guncelNot(t)?.sahip_danisman_id
    return danismanFiltre.has(s || 'havuz')
  })
  veri = veri.slice().sort((a, b) => (new Date(b.talep_tarihi || 0)) - (new Date(a.talep_tarihi || 0)))

  const filtreSayi = kaynakFiltre.size + danismanFiltre.size
  const fBadge = document.getElementById('filtreRozet')
  if (fBadge) { fBadge.textContent = filtreSayi || ''; fBadge.classList.toggle('hidden', !filtreSayi) }
  document.getElementById('talepSayac').textContent = `${veri.length} talep`

  if (!veri.length) { hedef.innerHTML = `<div class="p-10 text-center text-on-surface-variant">${mat('search_off', 'text-3xl opacity-50')}<p class="mt-2">Bu filtrede talep yok.</p></div>`; return }

  const pad = yog === 'sik' ? 'py-1.5' : 'py-3'
  const satirlar = veri.map(t => {
    const not = guncelNot(t)
    const havuzda = !not || !not.sahip_danisman_id
    const sk = aiSkor(t)
    const rr = satirRenk(t)
    const sec = secili.has(t.id)
    const aktif = seciliId === t.id
    const arac = [t.marka, t.model].filter(Boolean).join(' ') || (t.aciklama ? '' : '—')
    // durum + alt etiket
    const tk = not?.sonraki_adim_tarihi
    let alt = ''
    if (not && !kapanisMi(not.musteri_durumu)) {
      if (tk && tk < bugunISO()) alt = `<span class="block text-[11px] text-error font-bold italic mt-0.5">${sessizGun(t)} gündür bekliyor</span>`
      else if (tk === bugunISO()) alt = `<span class="block text-[11px] text-amber-700 font-bold mt-0.5">Bugün aranacak</span>`
      else if (!tk && not.sahip_danisman_id && sessizGun(t) >= 3) alt = `<span class="block text-[11px] text-error font-bold italic mt-0.5">${sessizGun(t)} gündür sessiz</span>`
    }
    const durumHtml = not ? pill(not.musteri_durumu, durumSinifi(not.musteri_durumu)) + alt : '<span class="text-on-surface-variant italic">not yok</span>'
    const danisman = (not && not.sahip_danisman_id)
      ? `<span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-secondary"></span>${kacis(danismanAdi(dmap, not.sahip_danisman_id))}</span>`
      : '<span class="text-on-surface-variant italic">Havuzda</span>'
    const wa = waLink(t.telefon)
    const hover = `<div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation()">
      ${t.telefon ? `<a href="tel:${kacis(t.telefon)}" class="p-1.5 rounded hover:bg-primary/10 text-on-surface-variant hover:text-primary" title="Ara">${mat('call', 'text-[18px]')}</a>` : ''}
      ${wa ? `<a href="${wa}" target="_blank" class="p-1.5 rounded hover:bg-green-100 text-on-surface-variant hover:text-green-600" title="WhatsApp">${mat('chat', 'text-[18px]')}</a>` : ''}
      ${havuzda && not ? `<button data-sahiplen="${not.id}" data-talep="${t.id}" class="p-1.5 rounded hover:bg-primary/10 text-primary" title="Sahiplen">${mat('person_add', 'text-[18px]')}</button>`
        : `<a href="talep.html?id=${t.id}" class="p-1.5 rounded hover:bg-primary/10 text-on-surface-variant hover:text-primary" title="Detay sayfası">${mat('open_in_new', 'text-[18px]')}</a>`}
    </div>`
    return `<tr data-row="${t.id}" class="group cursor-pointer transition-colors ${rr.row} ${rr.bar} ${aktif ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-container-low'}">
      <td class="${pad} px-3 text-center" onclick="event.stopPropagation()"><input type="checkbox" data-chk="${t.id}" ${sec ? 'checked' : ''} class="w-4 h-4 accent-[#5f1818] align-middle"></td>
      <td class="${pad} px-2 text-center whitespace-nowrap"><span class="${sk.cls} text-label-sm">${sk.e} ${sk.p}</span></td>
      <td class="${pad} px-3"><div class="flex items-center gap-2.5 min-w-0">${avatar(t.musteri_ad_soyad, 'w-8 h-8')}<div class="min-w-0"><p class="font-semibold text-on-surface flex items-center gap-1.5 flex-wrap">${kacis(t.musteri_ad_soyad)}${kaynakRozet(t.kaynak)}${t.katilim_finans ? `<span class="inline-flex items-center gap-0.5 bg-tertiary/10 text-tertiary text-[10px] font-bold px-1.5 py-0.5 rounded-full">${mat('account_balance', 'text-[12px]')} Finans</span>` : ''}</p><p class="text-[11px] text-on-surface-variant truncate">${kacis(t.telefon || '')}</p></div></div></td>
      <td class="${pad} px-3">${durumHtml}</td>
      <td class="${pad} px-3"><div class="max-w-[220px]"><p class="text-body-md text-on-surface truncate">${kacis(arac)}</p>${t.aciklama ? `<p class="text-[11px] text-on-surface-variant truncate">${kacis(t.aciklama)}</p>` : (fmtButce(t.butce_min, t.butce_max) !== '—' ? `<p class="text-[11px] text-on-surface-variant">${kacis(fmtButce(t.butce_min, t.butce_max))}</p>` : '')}</div></td>
      <td class="${pad} px-3 text-body-md">${danisman}</td>
      <td class="${pad} px-3 text-right whitespace-nowrap"><span class="text-[11px] text-on-surface-variant mr-1 group-hover:hidden">${fmtTarihKisa(t.talep_tarihi)}</span>${hover}</td>
    </tr>`
  }).join('')

  hedef.innerHTML = `<table class="w-full text-left border-collapse">
    <thead class="sticky top-0 z-10 bg-surface-container-low/95 backdrop-blur border-b border-outline-variant">
      <tr class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        <th class="py-2.5 px-3 w-10 text-center"><input type="checkbox" id="chkHepsi" class="w-4 h-4 accent-[#5f1818] align-middle"></th>
        <th class="py-2.5 px-2 w-14 text-center">AI</th>
        <th class="py-2.5 px-3">Müşteri</th>
        <th class="py-2.5 px-3">Durum</th>
        <th class="py-2.5 px-3">Aranan Araç</th>
        <th class="py-2.5 px-3">Danışman</th>
        <th class="py-2.5 px-3 text-right">Tarih / İşlem</th>
      </tr></thead>
    <tbody class="divide-y divide-outline-variant/40 text-body-md">${satirlar}</tbody></table>`

  // Olaylar
  hedef.querySelectorAll('[data-row]').forEach(tr =>
    tr.addEventListener('click', () => detayAc(tr.dataset.row)))
  hedef.querySelectorAll('[data-chk]').forEach(c =>
    c.addEventListener('change', () => { c.checked ? secili.add(c.dataset.chk) : secili.delete(c.dataset.chk); bulkBarCiz() }))
  hedef.querySelector('#chkHepsi')?.addEventListener('change', e => {
    veri.forEach(t => e.target.checked ? secili.add(t.id) : secili.delete(t.id)); ciz(); bulkBarCiz()
  })
  hedef.querySelectorAll('[data-sahiplen]').forEach(b =>
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); sahiplen(b.dataset.sahiplen, b.dataset.talep, b) }))
  // Detay panelini dolu tut: seçili hâlâ listedeyse onu, değilse masaüstünde ilk talebi aç
  if (seciliId && veri.some(t => t.id === seciliId)) detayAc(seciliId, true)
  else if (window.innerWidth >= 1280 && veri.length) { seciliId = null; detayAc(veri[0].id, true) }
  else if (window.innerWidth >= 1280) { seciliId = null; panelBos() }
}

// ---- Detay paneli (satıra tıklayınca; sayfa değişmez) ----
function detayAc(id, sessiz) {
  const t = _liste.find(x => x.id === id); if (!t) return
  seciliId = id
  const panel = document.getElementById('talepDetay')
  const katman = document.getElementById('detayKatman')
  const notlar = (t.gorusme_notlari || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const not = notlar[0]
  const wa = waLink(t.telefon)
  const tkTimeline = notlar.map(n => {
    const ikon = kapanisMi(n.musteri_durumu) ? 'flag' : n.acilis_notu ? 'add' : n.gorusme_notu ? 'edit_note' : 'sync_alt'
    return `<div class="relative">
      <div class="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full bg-primary ring-4 ring-white"></div>
      <div class="flex justify-between items-baseline gap-2"><span class="font-bold text-label-md text-on-surface">${kacis(n.musteri_durumu || '—')}</span><span class="text-[11px] text-on-surface-variant shrink-0">${fmtTarihKisa(n.created_at)}</span></div>
      ${n.gorusme_notu ? `<p class="text-label-sm text-on-surface-variant italic mt-0.5">"${kacis(n.gorusme_notu)}"</p>` : ''}
      <p class="text-[11px] text-on-surface-variant mt-0.5">${kacis(danismanAdi(dmap, n.sahip_danisman_id || n.acan_id) || 'Havuz')}</p>
    </div>`
  }).join('') || '<p class="text-on-surface-variant text-label-md">Henüz kayıt yok.</p>'

  const durumSec = DURUMLAR.map(d => `<option value="${kacis(d)}"${not && d === not.musteri_durumu ? ' selected' : ''}>${kacis(d)}</option>`).join('')
  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant">
      <div class="flex justify-between items-start mb-4">
        <div class="flex items-center gap-3 min-w-0">${avatar(t.musteri_ad_soyad, 'w-12 h-12')}
          <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate">${kacis(t.musteri_ad_soyad)}</h3>
            <p class="text-label-md text-on-surface-variant">${kacis(t.telefon || '—')}</p></div></div>
        <button id="detayKapat" class="p-1.5 hover:bg-surface-container-high rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex gap-2">
        <a href="talep.html?id=${t.id}" class="flex-1 bg-surface-container text-primary py-2 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:bg-surface-container-high">${mat('person', 'text-[18px]')} Profil</a>
        ${t.telefon ? `<a href="tel:${kacis(t.telefon)}" class="flex-1 bg-primary text-on-primary py-2 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('call', 'text-[18px]')} Ara</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" class="w-11 bg-[#25D366] text-white rounded-lg flex items-center justify-center hover:opacity-90">${mat('chat', 'text-[20px]')}</a>` : ''}
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-lg">
      <div class="grid grid-cols-2 gap-2 mb-4 text-label-sm">
        <div class="bg-surface-container-low rounded-lg p-2.5"><p class="text-on-surface-variant text-[11px] uppercase tracking-wide">Aranan araç</p><p class="font-bold text-on-surface">${kacis([t.marka, t.model].filter(Boolean).join(' ') || '—')}</p></div>
        <div class="bg-surface-container-low rounded-lg p-2.5"><p class="text-on-surface-variant text-[11px] uppercase tracking-wide">Bütçe</p><p class="font-bold text-on-surface">${kacis(fmtButce(t.butce_min, t.butce_max))}</p></div>
      </div>
      ${t.katilim_finans ? `<div class="bg-tertiary/5 border border-tertiary/20 rounded-lg p-2.5 mb-4 text-label-sm flex items-center gap-2 text-tertiary font-bold">${mat('account_balance', 'text-[18px]')} Katılım Finans talebi${t.finansman_tutari ? ' · ' + kacis(fmtButce(t.finansman_tutari, null)) : ''}</div>` : ''}
      <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-3">Zaman Çizelgesi</p>
      <div class="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[6px] before:top-1 before:bottom-1 before:w-px before:bg-outline-variant">${tkTimeline}</div>
    </div>
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest space-y-2">
      <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant flex items-center gap-1.5">${mat('edit_note', 'text-[16px] text-primary')} Yeni Görüşme Notu</label>
      <textarea id="detayNot" rows="2" placeholder="Müşteriyle görüşmenin özeti… (boş bırakılırsa sadece durum değişir)" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-3 text-body-md resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"></textarea>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="block text-[10px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Durum</label>
          <select id="detayDurum" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md">${durumSec}</select></div>
        <div><label class="block text-[10px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Sonraki adım</label>
          <input type="date" id="detaySonraki" value="${not?.sonraki_adim_tarihi || ''}" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md"></div>
      </div>
      <div id="detayKayipWrap" class="gizli"><select id="detayKayip" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-3 text-body-md">${KAYIP_NEDENLERI.map(k => `<option value="${kacis(k)}">${kacis(k)}</option>`).join('')}</select></div>
      <button id="detayKaydet" class="w-full bg-primary text-on-primary py-2.5 rounded-lg font-bold text-label-md hover:opacity-90 flex items-center justify-center gap-1.5">${mat('save', 'text-[18px]')} Notu Kaydet</button>
      <span id="detayDurumMsg" class="block text-label-sm text-on-surface-variant"></span>
    </div>`

  panel.classList.remove('hidden')
  // mobil: overlay
  if (window.innerWidth < 1280) {
    panel.classList.add('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none')
    katman.classList.remove('hidden')
  }
  const kapat = () => { panel.classList.add('hidden'); panel.classList.remove('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none'); katman.classList.add('hidden'); seciliId = null; ciz() }
  document.getElementById('detayKapat').addEventListener('click', kapat)
  katman.onclick = kapat
  const dSel = document.getElementById('detayDurum')
  dSel?.addEventListener('change', () => document.getElementById('detayKayipWrap').classList.toggle('gizli', !kaybedildiMi(dSel.value)))
  document.getElementById('detayKaydet')?.addEventListener('click', () => detayNotEkle(t, not))
  if (!sessiz) ciz()   // seçili satır vurgusu güncellensin
}

// Boş detay paneli (hiçbir talep seçili değilken masaüstünde beyaz boşluk kalmasın)
function panelBos() {
  const panel = document.getElementById('talepDetay')
  panel.classList.remove('hidden')
  panel.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">
    ${mat('touch_app', 'text-5xl opacity-30')}
    <p class="mt-3 font-semibold text-on-surface">Bir talep seçin</p>
    <p class="text-label-sm mt-1 max-w-[220px]">Soldaki listeden bir talebe tıklayın; müşteri detayı, zaman çizelgesi ve görüşme notu burada açılır.</p></div>`
}

// Detaydan yeni görüşme notu ekle — talebin durumu = en yeni not (CLAUDE.md §3).
// Not: durum değişimi = YENİ not eklenerek yapılır (mevcut not güncellenmez).
async function detayNotEkle(t, sonNot) {
  const msg = document.getElementById('detayDurumMsg')
  const metin = document.getElementById('detayNot').value.trim()
  const durum = document.getElementById('detayDurum').value
  const sonraki = document.getElementById('detaySonraki').value || null
  const kayip = kaybedildiMi(durum) ? document.getElementById('detayKayip').value : null
  if (!metin && durum === (sonNot?.musteri_durumu || '')) { msg.className = 'block text-label-sm text-error'; msg.textContent = 'Not yazın ya da durumu değiştirin.'; return }
  if (kapanisMi(durum) && !confirm(`"${durum}" kapanış durumu — talep aktif havuzdan düşecek. Devam?`)) return
  msg.className = 'block text-label-sm text-on-surface-variant'; msg.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('gorusme_notlari').insert({
    talep_id: t.id,
    gorusme_notu: metin || null,
    musteri_ad_soyad: t.musteri_ad_soyad,
    telefon: t.telefon || null,
    musteri_durumu: durum,
    sonraki_adim_tarihi: sonraki,
    kayip_nedeni: kayip,
    sahip_danisman_id: sonNot?.sahip_danisman_id ?? null,   // sahiplik korunur (not eklemek talebi devralmaz)
    acan_id: benim.id,
    acilis_notu: false,
  })
  if (error) { console.error('detay not ekle basarisiz', error); msg.className = 'block text-label-sm text-error'; msg.textContent = 'Hata: ' + error.message; return }
  msg.textContent = 'Not eklendi ✓'
  await yukle()   // seciliId korunur → detay yeni timeline ile tazelenir
}

// ---- Toplu işlem çubuğu (bulk_actions_state mockup: Ata · Durum · WhatsApp · Excel) ----
function bulkBarCiz() {
  const bar = document.getElementById('bulkBar')
  if (!secili.size) { bar.classList.add('hidden'); return }
  bar.classList.remove('hidden')
  bar.innerHTML = `
    <span class="flex items-center gap-2 pr-3 border-r border-white/20"><span class="bg-primary px-2 py-0.5 rounded text-[12px] font-bold">${secili.size}</span> seçili</span>
    <button data-bulk="ata" class="flex items-center gap-1.5 hover:text-primary-fixed text-label-md font-bold" title="Havuz taleplerini üzerine al">${mat('assignment_ind', 'text-[18px]')} Üzerime al</button>
    <button data-bulk="durum" class="flex items-center gap-1.5 hover:text-primary-fixed text-label-md font-bold" title="Seçili taleplerin durumunu değiştir">${mat('sync_alt', 'text-[18px]')} Durum Değiştir</button>
    <button data-bulk="wa" class="flex items-center gap-1.5 hover:text-primary-fixed text-label-md font-bold" title="WhatsApp'tan yaz">${mat('chat', 'text-[18px]')} WhatsApp</button>
    <button data-bulk="excel" class="flex items-center gap-1.5 hover:text-primary-fixed text-label-md font-bold">${mat('download', 'text-[18px]')} Dışa Aktar</button>
    <button data-bulk="temizle" class="ml-1 hover:bg-white/10 rounded-full p-1">${mat('close', 'text-[18px]')}</button>`
  bar.querySelector('[data-bulk="temizle"]').onclick = () => { secili.clear(); bulkBarCiz(); ciz() }
  bar.querySelector('[data-bulk="excel"]').onclick = () => excelAktar([...secili])
  bar.querySelector('[data-bulk="ata"]').onclick = bulkAta
  bar.querySelector('[data-bulk="durum"]').onclick = bulkDurum
  bar.querySelector('[data-bulk="wa"]').onclick = bulkWhatsapp
}

// Toplu durum değiştir — küçük modal, seçili taleplerin GÜNCEL notunu günceller.
// Kaybedildi hariç (kayıp nedeni tek tek girilmeli, CHECK ihlali olmasın).
function bulkDurum() {
  const secler = DURUMLAR.filter(d => !kaybedildiMi(d)).map(d =>
    `<button data-d="${kacis(d)}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-container-low">${pill(d, durumSinifi(d))}</button>`).join('')
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="bg-white rounded-2xl custom-shadow w-full max-w-xs p-4 space-y-1" onclick="event.stopPropagation()">
    <p class="font-bold text-primary mb-2 flex items-center gap-1.5">${mat('sync_alt', 'text-[18px]')} Durum Değiştir · ${secili.size} talep</p>
    ${secler}
    <button data-kapat class="w-full mt-2 text-on-surface-variant text-label-md py-2 hover:bg-surface-container-low rounded-lg">Vazgeç</button></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelector('[data-kapat]').onclick = kapat
  ov.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', async () => {
    const durum = b.dataset.d; kapat()
    if (kapanisMi(durum) && !confirm(`"${durum}" kapanış durumu — ${secili.size} talep aktif havuzdan düşecek. Devam?`)) return
    const notIds = [...secili].map(id => { const t = _liste.find(x => x.id === id); return guncelNot(t)?.id }).filter(Boolean)
    if (!notIds.length) return alert('Güncellenecek not bulunamadı.')
    const { error } = await supabase.from('gorusme_notlari').update({ musteri_durumu: durum }).in('id', notIds)
    if (error) { console.error('bulk durum', error); return alert('Güncellenemedi: ' + error.message) }
    secili.clear(); bulkBarCiz(); await yukle()
  }))
}

// Toplu WhatsApp — birden çok sekme tarayıcıda engellenir; tek seçime izin ver.
function bulkWhatsapp() {
  const idler = [...secili]
  if (idler.length !== 1) return alert('WhatsApp mesajı tek talep için açılır. Lütfen tek bir talep seçin.')
  const t = _liste.find(x => x.id === idler[0])
  const wa = waLink(t?.telefon)
  if (!wa) return alert('Bu talepte telefon numarası yok.')
  window.open(wa, '_blank')
}

async function bulkAta() {
  const idler = [...secili]
  const notIdler = idler.map(id => { const t = _liste.find(x => x.id === id); const n = t && guncelNot(t); return (n && !n.sahip_danisman_id) ? n.id : null }).filter(Boolean)
  if (!notIdler.length) return alert('Seçilenler arasında havuzda (sahipsiz) talep yok.')
  if (!confirm(`${notIdler.length} havuz talebi üzerinize alınacak. Devam?`)) return
  const { error } = await supabase.from('gorusme_notlari').update({ sahip_danisman_id: benim.id }).in('id', notIdler).is('sahip_danisman_id', null)
  if (error) return alert('Atama başarısız: ' + error.message)
  secili.clear(); bulkBarCiz(); await yukle()
}

async function sahiplen(notId, talepId, btn) {
  if (!benim) return alert('Oturum bulunamadı. Sayfayı yenileyin.')
  if (btn) { btn.disabled = true; btn.textContent = 'Sahipleniliyor…' }
  // .select('id') ŞART: is('sahip_danisman_id', null) guard'ı 0 satır eşleştirdiğinde
  // PostgREST HATA DÖNDÜRMEZ, boş başarı döner. select olmadan iki danışman aynı
  // talebe aynı anda bastığında ikisi de "sahiplendim" sanıyordu.
  const { data, error } = await supabase.from('gorusme_notlari')
    .update({ sahip_danisman_id: benim.id }).eq('id', notId).is('sahip_danisman_id', null)
    .select('id')
  if (error) {
    alert('Sahiplenme başarısız: ' + error.message)
    if (btn) { btn.disabled = false; btn.textContent = 'Sahiplen' }
    return
  }
  if (!data || !data.length) {
    alert('Bu talebi bu sırada başka bir danışman sahiplendi.')
    if (btn) { btn.disabled = false; btn.textContent = 'Sahiplen' }
    await yukle()
    return
  }
  // Sahiplenildi → doğrudan detaya git (liste yenileyip başa atma yok)
  location.href = 'talep.html?id=' + talepId
}

// --- Mükerrer talep kontrolü: aynı telefonla açık talep var mı? ---
async function mukerrerBul(tel) {
  const son10 = telSon10(tel)
  if (!son10 || son10.length < 7) return []
  const { data, error } = await supabase.from('talepler')
    .select('id, musteri_ad_soyad, telefon, marka, model, talep_tarihi, katilim_finans, gorusme_notlari(id, musteri_durumu, sahip_danisman_id, created_at)')
    .ilike('telefon_norm', '%' + son10 + '%')
    .order('talep_tarihi', { ascending: false })
    .limit(10)
  // Hatayı yutma: boş dizi dönersek "mükerrer yok" sanılır ve kopya talep açılır.
  if (error) { console.error('[db] mukerrerBul', error); throw error }
  return data || []
}

// Bir talebin "güncel" notu = en son oluşturulan not
function guncelNot(t) {
  const notlar = (t.gorusme_notlari || []).slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return notlar[0] || null
}

// Uyarı panelini çiz: mevcut talep(ler) + durum güncelle + "yine de oluştur"
function mukerrerGoster(mevcut) {
  const kutu = document.getElementById('mukerrerUyari')
  const kartlar = mevcut.map(t => {
    const not = guncelNot(t)
    const durum = not?.musteri_durumu || 'Yeni Talep'
    const sahipTxt = not?.sahip_danisman_id ? danismanAdi(dmap, not.sahip_danisman_id) : 'Havuzda'
    const kayipOpt = KAYIP_NEDENLERI.map(k => `<option value="${kacis(k)}">${kacis(k)}</option>`).join('')
    return `
      <div class="border border-outline-variant rounded-lg p-3 bg-white flex flex-col gap-2" data-talep="${t.id}" data-not="${not?.id || ''}">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="font-bold flex items-center gap-2">${kacis(t.musteri_ad_soyad)} ${pill(durum, durumSinifi(durum))}${t.katilim_finans ? `<span class="inline-flex items-center gap-1 bg-tertiary/10 text-tertiary text-label-sm font-bold px-2 py-0.5 rounded-full">${mat('account_balance', 'text-[13px]')} Finans</span>` : ''}</div>
          <a href="talep.html?id=${t.id}" class="text-primary text-label-md font-bold inline-flex items-center gap-1">İncele ${mat('arrow_forward', 'text-[16px]')}</a>
        </div>
        <div class="text-label-sm text-on-surface-variant">${kacis(aracOzet(t))} · ${kacis(t.telefon || '')} · ${fmtTarihKisa(t.talep_tarihi)} · ${kacis(sahipTxt)}</div>
        <div class="flex items-end gap-2 flex-wrap">
          <label class="text-label-sm flex flex-col gap-1">Durumu güncelle
            <select class="mk-durum" data-not="${not?.id || ''}">
              ${DURUMLAR.map(d => `<option value="${kacis(d)}"${d === durum ? ' selected' : ''}>${kacis(d)}</option>`).join('')}
            </select>
          </label>
          <label class="text-label-sm flex flex-col gap-1 mk-kayip-wrap gizli">Kayıp nedeni
            <select class="mk-kayip">${kayipOpt}</select>
          </label>
          <button type="button" class="mk-guncelle btn btn-cizgi btn-kucuk" data-talep="${t.id}"${not ? '' : ' disabled title="Bu talepte not yok"'}>Durumu Kaydet</button>
        </div>
      </div>`
  }).join('')
  kutu.innerHTML = `
    <div class="border-l-4 border-tertiary bg-tertiary/5 rounded-lg p-3 space-y-3">
      <p class="font-bold text-tertiary flex items-center gap-2">${mat('warning', 'text-[18px]')} Bu numarayla zaten talep var</p>
      <p class="text-label-sm text-on-surface-variant">Tekrar açmadan önce mevcut talebi kontrol edin. Gerekirse durumunu güncelleyin ya da yine de yeni talep oluşturun.</p>
      ${kartlar}
      <div class="flex items-center gap-2 pt-1">
        <button type="button" id="mkYineOlustur" class="btn btn-gold btn-kucuk">Yine de Yeni Talep Oluştur</button>
        <button type="button" id="mkVazgec" class="btn btn-cizgi btn-kucuk">Vazgeç</button>
      </div>
    </div>`
  kutu.classList.remove('gizli')

  kutu.querySelectorAll('.mk-durum').forEach(sel => sel.addEventListener('change', () => {
    const kayipWrap = sel.closest('[data-talep]').querySelector('.mk-kayip-wrap')
    kayipWrap.classList.toggle('gizli', !kaybedildiMi(sel.value))
  }))
  kutu.querySelectorAll('.mk-guncelle').forEach(b =>
    b.addEventListener('click', () => mkDurumKaydet(b.dataset.talep, b)))
  document.getElementById('mkVazgec').addEventListener('click', mukerrerKapat)
  document.getElementById('mkYineOlustur').addEventListener('click', () => { mukerrerKapat(); talebiKaydet() })
}

function mukerrerKapat() {
  const kutu = document.getElementById('mukerrerUyari')
  if (kutu) { kutu.classList.add('gizli'); kutu.innerHTML = '' }
}

// Mevcut talebin güncel notunu, seçilen duruma güncelle (talep.js ile aynı mantık: not update)
async function mkDurumKaydet(talepId, btn) {
  const t = _mkMevcut.find(x => x.id === talepId)
  const not = t && guncelNot(t)
  if (!not) return alert('Bu talepte güncellenecek not yok. Talebi açıp not ekleyin.')
  const kart = btn.closest('[data-talep]')
  const yeniDurum = kart.querySelector('.mk-durum').value
  const kayip = kaybedildiMi(yeniDurum) ? kart.querySelector('.mk-kayip').value : null
  if (kapanisMi(yeniDurum) &&
      !confirm(`"${yeniDurum}" bir kapanış durumu. Not aktif havuzdan düşecek. Devam edilsin mi?`)) return
  btn.disabled = true; btn.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('gorusme_notlari')
    .update({ musteri_durumu: yeniDurum, kayip_nedeni: kayip }).eq('id', not.id)
  if (error) { btn.disabled = false; btn.textContent = 'Durumu Kaydet'; return alert('Durum güncellenemedi: ' + error.message) }
  not.musteri_durumu = yeniDurum
  btn.textContent = 'Güncellendi ✓'
  await yukle()
}

async function kaydet(e) {
  e.preventDefault()
  const f = e.target
  const durum = document.getElementById('kayitDurum')
  const g = id => f[id].value.trim()

  if (!g('musteri_ad_soyad')) { durum.className = 'soluk'; durum.textContent = 'Müşteri adı zorunlu.'; return }

  // Mükerrer kontrolü — telefon girildiyse aynı numaralı açık talep var mı?
  const tel = g('telefon')
  if (tel) {
    durum.className = 'soluk'; durum.textContent = 'Kontrol ediliyor…'
    let mevcut = []
    try {
      mevcut = await mukerrerBul(tel)
    } catch {
      // Kontrol yapılamadıysa sessizce kaydetme — kararı danışmana bırak.
      durum.className = 'text-red-600'
      durum.textContent = 'Mükerrer kontrolü yapılamadı.'
      if (!confirm('Bu numarayla başka kayıt var mı kontrol edilemedi (bağlantı hatası).\n\nYine de kaydedilsin mi?')) return
    }
    durum.textContent = ''
    if (mevcut.length) { _mkMevcut = mevcut; mukerrerGoster(mevcut); return }
  }
  await talebiKaydet()
}

async function talebiKaydet() {
  const f = document.getElementById('talepForm')
  const durum = document.getElementById('kayitDurum')
  const btn = f.querySelector('button[type=submit]')
  const g = id => f[id].value.trim()
  const sayi = id => f[id].value ? Number(f[id].value) : null

  btn.disabled = true
  durum.className = 'soluk'
  durum.textContent = 'Kaydediliyor…'

  const { data: talep, error: e1 } = await supabase.from('talepler').insert({
    musteri_ad_soyad: g('musteri_ad_soyad'),
    telefon: g('telefon') || null,
    eposta: g('eposta') || null,
    marka: g('marka') || null,
    model: g('model') || null,
    paket: g('paket') || null,
    model_yili_min: sayi('model_yili_min'),
    model_yili_max: sayi('model_yili_max'),
    butce_min: paraSayi(f['butce_min'].value),
    butce_max: paraSayi(f['butce_max'].value),
    aciklama: g('aciklama') || null,
    kaynak: f['kaynak'].value,
    katilim_finans: f['katilim_finans'].checked,
    finansman_tutari: f['katilim_finans'].checked && f['finansman_tutari'].value ? Number(f['finansman_tutari'].value) : null,
    finansman_tarihi: f['katilim_finans'].checked && f['finansman_tarihi'].value ? f['finansman_tarihi'].value : null,
  }).select('id').single()

  if (e1) { durum.className = 'durum-mesaj hata'; durum.textContent = 'Talep kaydedilemedi: ' + e1.message; btn.disabled = false; return }

  const { error: e2 } = await supabase.from('gorusme_notlari').insert({
    talep_id: talep.id,
    gorusme_notu: g('gorusme_notu') || null,
    musteri_ad_soyad: g('musteri_ad_soyad'),
    telefon: g('telefon') || null,
    musteri_durumu: f['musteri_durumu'].value,
    acan_id: benim.id,
    // Talep girişindeki bu ilk kayıt notu boşsa "açılış" sayılır (görüşme metriğini kirletmez)
    acilis_notu: !g('gorusme_notu'),
  })

  if (e2) { durum.className = 'durum-mesaj hata'; durum.textContent = 'Talep açıldı ama not oluşturulamadı: ' + e2.message; btn.disabled = false; await yukle(); return }

  f.reset()
  mukerrerKapat()
  document.getElementById('finansAlanlari')?.classList.add('gizli')
  document.getElementById('yeniTalepKart').classList.add('gizli')
  durum.textContent = ''
  btn.disabled = false
  await yukle()
}

// =====================================================================
// Ctrl+K Komut Paleti (global_search_overlay mockup, marka bordosu)
// =====================================================================
function komutPaletiAc() {
  if (document.getElementById('kmdOv')) return
  const ov = document.createElement('div')
  ov.id = 'kmdOv'
  ov.className = 'fixed inset-0 bg-black/40 z-[70] flex items-start justify-center pt-[12vh] px-4'
  ov.innerHTML = `<div class="bg-white rounded-2xl custom-shadow w-full max-w-xl overflow-hidden" onclick="event.stopPropagation()">
    <div class="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">
      ${mat('search', 'text-on-surface-variant')}
      <input id="kmdInput" placeholder="Müşteri, telefon, araç veya komut ara…" class="flex-1 outline-none text-title-md bg-transparent placeholder:text-on-surface-variant/60">
      <kbd class="text-[10px] border border-outline-variant rounded px-1.5 py-0.5 text-on-surface-variant">ESC</kbd>
    </div>
    <div id="kmdSonuc" class="max-h-[52vh] overflow-y-auto p-2"></div>
    <div class="flex items-center gap-4 px-4 py-2 border-t border-outline-variant text-[11px] text-on-surface-variant bg-surface-container-lowest">
      <span class="flex items-center gap-1">${mat('keyboard_return', 'text-[14px]')} Seç</span>
      <span class="flex items-center gap-1">${mat('bolt', 'text-[14px]')} Ctrl+K aç/kapat</span></div>
  </div>`
  document.body.appendChild(ov)
  const inp = ov.querySelector('#kmdInput')
  const sonuc = ov.querySelector('#kmdSonuc')
  const kapat = () => { ov.remove(); window.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.addEventListener('click', kapat)
  window.addEventListener('keydown', esc)

  const eylemler = [
    ['add_circle', 'Yeni Talep Oluştur', () => { document.getElementById('yeniTalepKart')?.classList.remove('gizli'); document.getElementById('yeniTalepKart')?.scrollIntoView({ behavior: 'smooth' }) }],
    ['download', 'Tümünü Excel’e Aktar', () => excelAktar()],
    ['refresh', 'Listeyi Yenile', () => yukle()],
    ['tune', 'Gelişmiş Filtre', () => filtrePaneliAc()],
  ]
  const render = () => {
    const q = inp.value.trim().toLocaleLowerCase('tr')
    const leads = (q
      ? _liste.filter(t => [t.musteri_ad_soyad, t.telefon, t.marka, t.model].filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(q))
      : _liste.slice().sort((a, b) => new Date(b.talep_tarihi || 0) - new Date(a.talep_tarihi || 0))
    ).slice(0, 6)
    const acts = eylemler.filter(a => !q || a[1].toLocaleLowerCase('tr').includes(q))
    let html = ''
    if (leads.length) {
      html += `<p class="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">${q ? 'Talepler' : 'Son Talepler'}</p>`
      html += leads.map(t => {
        const not = guncelNot(t)
        return `<button data-lead="${t.id}" class="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container-low text-left">
          ${avatar(t.musteri_ad_soyad, 'w-8 h-8')}
          <div class="min-w-0 flex-1"><p class="font-semibold text-on-surface truncate">${kacis(t.musteri_ad_soyad)}</p>
            <p class="text-[11px] text-on-surface-variant truncate">${kacis(t.telefon || '')}${not ? ' · ' + kacis(not.musteri_durumu) : ''}</p></div>
          ${mat('arrow_forward', 'text-on-surface-variant text-[16px]')}</button>`
      }).join('')
    }
    if (acts.length) {
      html += `<p class="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Hızlı Eylem</p>`
      html += acts.map((a, i) => `<button data-act="${i}" class="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container-low text-left">${mat(a[0], 'text-primary')}<span class="text-body-md">${a[1]}</span></button>`).join('')
    }
    if (!html) html = `<p class="p-6 text-center text-on-surface-variant text-label-md">Sonuç yok.</p>`
    sonuc.innerHTML = html
    sonuc.querySelectorAll('[data-lead]').forEach(b => b.onclick = () => { kapat(); const id = b.dataset.lead; seciliId = null; detayAc(id); document.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: 'center' }) })
    sonuc.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { kapat(); acts[+b.dataset.act][2]() })
  }
  render()
  inp.addEventListener('input', render)
  inp.focus()
}

// =====================================================================
// Gelişmiş Filtre paneli (advanced_filter_state mockup) — Kaynak + Danışman
// =====================================================================
const KAYNAK_ETIKET = { 'telefon': 'Telefon', 'kapi': 'Kapı (Showroom)', 'web-takas': 'Web — Takas', 'web-iletisim': 'Web — İletişim', 'instagram-dm': 'Instagram DM' }
function filtrePaneliAc() {
  if (document.getElementById('fltOv')) return
  // Listedeki gerçek danışmanlar (havuz dahil)
  const dset = new Map()
  let havuzVar = false
  _liste.forEach(t => { const s = guncelNot(t)?.sahip_danisman_id; if (s) dset.set(s, danismanAdi(dmap, s)); else havuzVar = true })
  const danismanlar = [...dset.entries()].sort((a, b) => a[1].localeCompare(b[1], 'tr'))

  const kaynakChk = Object.entries(KAYNAK_ETIKET).map(([k, l]) =>
    `<label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant cursor-pointer hover:border-primary ${kaynakFiltre.has(k) ? 'bg-primary/5 border-primary' : ''}">
      <input type="checkbox" data-kaynak="${k}" ${kaynakFiltre.has(k) ? 'checked' : ''} class="w-4 h-4 accent-[#5f1818]"><span class="text-body-md">${l}</span></label>`).join('')
  const danismanChk = (havuzVar ? [['havuz', 'Havuzda (sahipsiz)']] : []).concat(danismanlar).map(([id, ad]) =>
    `<label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant cursor-pointer hover:border-primary ${danismanFiltre.has(id) ? 'bg-primary/5 border-primary' : ''}">
      <input type="checkbox" data-dan="${id}" ${danismanFiltre.has(id) ? 'checked' : ''} class="w-4 h-4 accent-[#5f1818]"><span class="text-body-md truncate">${kacis(ad)}</span></label>`).join('')

  const ov = document.createElement('div')
  ov.id = 'fltOv'
  ov.className = 'fixed inset-0 bg-black/40 z-[65] flex justify-end'
  ov.innerHTML = `<div class="bg-white w-full max-w-sm h-full overflow-y-auto flex flex-col" onclick="event.stopPropagation()">
    <div class="p-lg border-b border-outline-variant flex items-center justify-between">
      <div class="flex items-center gap-2">${mat('tune', 'text-primary')}<h3 class="text-title-lg font-bold text-primary">Gelişmiş Filtre</h3></div>
      <button data-kapat class="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button>
    </div>
    <div class="p-lg space-y-5 flex-1">
      <div><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-2">Kaynak</p><div class="grid grid-cols-1 gap-2">${kaynakChk}</div></div>
      <div><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-2">Danışman</p><div class="grid grid-cols-1 gap-2 max-h-[40vh] overflow-y-auto pr-1">${danismanChk || '<p class="text-label-md text-on-surface-variant">Danışman yok.</p>'}</div></div>
    </div>
    <div class="p-lg border-t border-outline-variant flex items-center gap-2 bg-surface-container-lowest">
      <button data-temizle class="flex-1 border border-outline-variant text-on-surface py-2.5 rounded-lg font-bold text-label-md hover:bg-surface-container">Temizle</button>
      <button data-uygula class="flex-1 bg-primary text-on-primary py-2.5 rounded-lg font-bold text-label-md hover:opacity-90">Uygula</button>
    </div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelector('[data-kapat]').onclick = kapat
  // seçimi anlık topla
  ov.querySelectorAll('[data-kaynak]').forEach(c => c.onchange = () => { c.checked ? kaynakFiltre.add(c.dataset.kaynak) : kaynakFiltre.delete(c.dataset.kaynak); c.closest('label').classList.toggle('bg-primary/5', c.checked); c.closest('label').classList.toggle('border-primary', c.checked) })
  ov.querySelectorAll('[data-dan]').forEach(c => c.onchange = () => { c.checked ? danismanFiltre.add(c.dataset.dan) : danismanFiltre.delete(c.dataset.dan); c.closest('label').classList.toggle('bg-primary/5', c.checked); c.closest('label').classList.toggle('border-primary', c.checked) })
  ov.querySelector('[data-temizle]').onclick = () => { kaynakFiltre.clear(); danismanFiltre.clear(); kapat(); ciz() }
  ov.querySelector('[data-uygula]').onclick = () => { kapat(); ciz() }
}
