// =====================================================================
// sohbet-widget.js — Sağ altta yüzen ekip sohbeti (Stitch / Tailwind)
//   • Presence ile çevrimiçi durumu (yeşil nokta)
//   • Kişiden kişiye realtime DM  • Sayfa fark etmeksizin toast bildirim
// Kullanım: auth.js/ustBarKur() içinden sohbetWidgetKur(danisman).
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, kacis, dbHata } from './veri.js'

let benim = null, kisiler = [], online = new Set(), okunmamis = {}
let acikKisi = null, panelAcik = false, kuruldu = false, araKelime = ''

const $ = id => document.getElementById(id)
const saat = ts => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
const mat = (a, e = '') => `<span class="material-symbols-outlined${e ? ' ' + e : ''}">${a}</span>`
function basHarf(ad) {
  const p = (ad || '?').trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '') || '?').toLocaleUpperCase('tr-TR')
}

export async function sohbetWidgetKur(danisman) {
  if (kuruldu) return
  kuruldu = true
  benim = danisman
  const map = await danismanMap()
  kisiler = Object.values(map).filter(d => d.id !== benim.id)
    .sort((a, b) => (a.ad_soyad || '').localeCompare(b.ad_soyad || '', 'tr'))
  domKur()
  await okunmamislariYukle()
  rozetGuncelle(); kisileriCiz(); presenceKur(); dmRealtimeKur()
}

function domKur() {
  const kok = document.createElement('div')
  kok.className = 'stitch fixed bottom-5 right-5 z-[9999] flex flex-col items-end gap-3'
  kok.style.fontFamily = 'Inter, system-ui, sans-serif'
  kok.innerHTML = `
    <div id="cxToastlar" class="flex flex-col items-end gap-2"></div>
    <div id="cxPanel" class="gizli w-[370px] max-w-[calc(100vw-2.5rem)] h-[540px] max-h-[calc(100vh-8rem)] bg-white rounded-2xl border border-outline-variant shadow-2xl flex flex-col overflow-hidden">
      <div class="bg-primary text-white px-4 py-3 flex items-center justify-between shrink-0">
        <span id="cxBaslik" class="font-bold flex items-center gap-1"><button id="cxGeri" class="gizli hover:opacity-80">${mat('arrow_back_ios_new', 'text-[16px]')}</button><span id="cxDurum" class="gizli w-2.5 h-2.5 rounded-full shrink-0"></span>Ekip Sohbeti</span>
        <button id="cxKapat" class="hover:opacity-80">${mat('close')}</button>
      </div>
      <div id="cxAraKutu" class="px-3 py-2 border-b border-outline-variant shrink-0"><input id="cxAra" placeholder="Kişi ara…" autocomplete="off" class="w-full bg-surface-container-low border border-outline-variant rounded-full px-3.5 py-2 text-body-md focus:outline-none focus:border-primary" /></div>
      <div id="cxKisiler" class="flex-1 overflow-y-auto"></div>
      <div id="cxKonusma" class="gizli flex-1 flex flex-col min-h-0">
        <div id="cxAkis" class="flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-background"></div>
        <form id="cxForm" class="flex gap-2 p-3 border-t border-outline-variant shrink-0">
          <input id="cxInput" placeholder="Mesaj yaz…" autocomplete="off" class="flex-1 border border-outline-variant rounded-full px-4 py-2 text-body-md focus:outline-none focus:border-primary" />
          <button type="submit" title="Gönder" class="bg-primary text-white w-10 h-10 rounded-full flex items-center justify-center shrink-0 hover:opacity-90">${mat('send', 'text-[18px]')}</button>
        </form>
      </div>
    </div>
    <div class="flex items-end gap-2">
      <div id="cxOkunmamisKisiler" class="flex flex-col items-end gap-2"></div>
      <button id="cxBtn" class="relative flex items-center gap-2 bg-primary text-white rounded-full pl-4 pr-5 py-3 shadow-lg hover:opacity-90 transition-all active:scale-95 shrink-0">
        ${mat('forum')}<span class="font-bold text-label-md">Sohbet</span>
        <span class="w-2.5 h-2.5 rounded-full bg-secondary ring-2 ring-white/40"></span>
        <span id="cxRozet" class="gizli absolute -top-1 -right-1 bg-white text-primary text-xs font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center">0</span>
      </button>
    </div>`
  document.body.appendChild(kok)

  $('cxBtn').addEventListener('click', () => panelAcik ? paneliKapat() : paneliAc())
  $('cxKapat').addEventListener('click', paneliKapat)
  $('cxGeri').addEventListener('click', listeyeDon)
  $('cxForm').addEventListener('submit', gonder)
  $('cxAra').addEventListener('input', e => { araKelime = e.target.value.trim().toLocaleLowerCase('tr'); kisileriCiz() })
}

// ⚠️ AÇILIŞTA YENİDEN ÇİZ. Liste sayfa yüklenirken bir kez çiziliyor; o an
//    presence verisi HENÜZ GELMEMİŞ oluyor (`online` boş) → herkes gri.
//    Sync ~1 sn sonra geliyor ama panel kapalıyken yeniden çizim yapılmıyordu,
//    panel açıldığında da çizilmiyordu → bayat gri liste. Yeşil nokta ancak
//    panel AÇIKKEN biri girip çıkarsa beliriyordu (Göksenil, 12 Ağu 2026).
//    Ölçüm: presence kanalında o anda 7 kişi kayıtlıydı, ekranda hiçbiri yeşil değildi.
function paneliAc() {
  panelAcik = true
  $('cxPanel').classList.remove('gizli')
  if (!acikKisi) kisileriCiz()
  okunmamisKisileriCiz()
}
function paneliKapat() { panelAcik = false; $('cxPanel').classList.add('gizli'); okunmamisKisileriCiz() }

function listeyeDon() {
  acikKisi = null
  $('cxKonusma').classList.add('gizli')
  $('cxKisiler').classList.remove('gizli')
  $('cxAraKutu').classList.remove('gizli')
  $('cxGeri').classList.add('gizli')
  $('cxBaslik').lastChild.textContent = 'Ekip Sohbeti'
  $('cxDurum')?.classList.add('gizli')
  kisileriCiz()
}

async function okunmamislariYukle() {
  const { data, error } = await supabase.from('direkt_mesajlar')
    .select('gonderen_id').eq('alici_id', benim.id).eq('okundu', false)
  okunmamis = {}
  if (error) return console.error('okunmamış:', error)
  for (const m of data) okunmamis[m.gonderen_id] = (okunmamis[m.gonderen_id] || 0) + 1
}
function toplamOkunmamis() { return Object.values(okunmamis).reduce((a, b) => a + b, 0) }
function rozetGuncelle() {
  const r = $('cxRozet')
  if (r) { const t = toplamOkunmamis(); r.textContent = t; r.classList.toggle('gizli', t === 0) }
  okunmamisKisileriCiz()
}

// Butonun solunda: okunmamışı olan her kişi için kalıcı "Ad Soyad (n)" çipi.
// Tıklayınca o sohbeti açar. Panel açıkken gizlenir (zaten liste görünüyor).
function okunmamisKisileriCiz() {
  const kap = $('cxOkunmamisKisiler'); if (!kap) return
  const idler = Object.keys(okunmamis).filter(id => okunmamis[id] > 0)
  if (panelAcik || !idler.length) { kap.innerHTML = ''; return }
  kap.innerHTML = idler.map(id => {
    const kisi = kisiler.find(k => k.id === id)
    const ad = kisi ? (kisi.ad_soyad || kisi.email) : 'Bilinmeyen'
    return `<button data-okisi="${id}" class="flex items-center gap-2 bg-white border border-outline-variant rounded-full pl-3 pr-2 py-2 shadow-lg hover:bg-surface-container-low transition-colors active:scale-95 max-w-[240px]">
      <span class="font-bold text-on-surface text-label-md truncate">${kacis(ad)}</span>
      <span class="bg-primary text-white text-xs font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center shrink-0">${okunmamis[id]}</span>
    </button>`
  }).join('')
  kap.querySelectorAll('[data-okisi]').forEach(el => el.addEventListener('click', () => kisiAc(el.dataset.okisi)))
}

function kisileriCiz() {
  const kap = $('cxKisiler'); if (!kap) return
  let liste = kisiler
  if (araKelime) liste = liste.filter(k => (k.ad_soyad || k.email || '').toLocaleLowerCase('tr').includes(araKelime))
  if (!liste.length) { kap.innerHTML = `<div class="p-6 text-center text-on-surface-variant text-body-md">${araKelime ? 'Kişi bulunamadı.' : 'Başka kullanıcı yok.'}</div>`; return }
  const sirali = [...liste].sort((a, b) => (online.has(b.id) ? 1 : 0) - (online.has(a.id) ? 1 : 0))
  kap.innerHTML = sirali.map(k => {
    const say = okunmamis[k.id] || 0, on = online.has(k.id)
    return `<div data-kisi="${k.id}" class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-container-low border-b border-outline-variant/60 transition-colors">
      <div class="relative shrink-0"><div class="w-10 h-10 rounded-full bg-primary-fixed text-primary flex items-center justify-center font-bold">${kacis(basHarf(k.ad_soyad))}</div>
        <span class="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-white ${on ? 'bg-secondary' : 'bg-outline-variant'}"></span></div>
      <div class="flex-1 min-w-0"><div class="font-semibold text-on-surface truncate">${kacis(k.ad_soyad || k.email)}</div>
        <div class="text-[12px] text-on-surface-variant">${on ? 'çevrimiçi' : kacis(k.rol)}</div></div>
      ${say ? `<span class="bg-primary text-white text-xs font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center">${say}</span>` : ''}
    </div>`
  }).join('')
  kap.querySelectorAll('[data-kisi]').forEach(el => el.addEventListener('click', () => kisiAc(el.dataset.kisi)))
}

// Konuşma başlığındaki çevrimiçi noktası (Göksenil, 12 Ağu 2026).
// ⚠️ Presence `sync` geldiğinde de çağrılır — konuşma AÇIKKEN karşı taraf
//    girip çıkarsa nokta anında renk değiştirsin. Liste yeniden çizilmiyor
//    (kişi listesi gizli), yalnız bu nokta güncelleniyor.
function konusmaDurumCiz() {
  const el = $('cxDurum'); if (!el) return
  if (!acikKisi) { el.classList.add('gizli'); return }
  const on = online.has(acikKisi.id)
  el.classList.remove('gizli')
  el.className = `w-2.5 h-2.5 rounded-full shrink-0 ${on ? 'bg-green-400' : 'bg-white/40'}`
  el.title = on ? 'çevrimiçi' : 'çevrimdışı'
}

async function kisiAc(kisiId) {
  acikKisi = kisiler.find(k => k.id === kisiId); if (!acikKisi) return
  if (!panelAcik) paneliAc()
  $('cxKisiler').classList.add('gizli')
  $('cxAraKutu').classList.add('gizli')
  $('cxKonusma').classList.remove('gizli')
  $('cxGeri').classList.remove('gizli')
  $('cxBaslik').lastChild.textContent = ' ' + (acikKisi.ad_soyad || acikKisi.email)
  konusmaDurumCiz()
  $('cxAkis').innerHTML = '<div class="bos m-auto text-on-surface-variant text-body-md">Yükleniyor…</div>'
  await mesajlariYukle()
  await okunduIsaretle(acikKisi.id)
}

async function mesajlariYukle() {
  const other = acikKisi.id
  const { data, error } = await supabase.from('direkt_mesajlar')
    .select('id, gonderen_id, alici_id, mesaj, created_at')
    .or(`and(gonderen_id.eq.${benim.id},alici_id.eq.${other}),and(gonderen_id.eq.${other},alici_id.eq.${benim.id})`)
    .order('created_at', { ascending: true })
  const akis = $('cxAkis'); if (!akis) return
  if (error) { akis.innerHTML = `<div class="bos m-auto text-on-surface-variant">Okunamadı: ${kacis(error.message)}</div>`; return }
  akis.innerHTML = data.length ? data.map(balon).join('') : '<div class="bos m-auto text-center text-on-surface-variant text-body-md">Henüz mesaj yok. İlk mesajı yaz. 👋</div>'
  akis.scrollTop = akis.scrollHeight
}

function balon(m) {
  const benimMi = m.gonderen_id === benim.id
  return `<div data-mid="${m.id}" class="max-w-[80%] rounded-2xl px-3 py-2 ${benimMi ? 'self-end bg-primary text-white' : 'self-start bg-surface-container border border-outline-variant text-on-surface'}">
    <div class="text-body-md whitespace-pre-wrap break-words">${kacis(m.mesaj)}</div>
    <div class="text-[10px] mt-0.5 ${benimMi ? 'text-white/70' : 'text-on-surface-variant'} text-right">${saat(m.created_at)}</div>
  </div>`
}

function mesajEkle(m) {
  const akis = $('cxAkis'); if (!akis) return
  if (akis.querySelector(`[data-mid="${m.id}"]`)) return
  const bos = akis.querySelector('.bos'); if (bos) bos.remove()
  akis.insertAdjacentHTML('beforeend', balon(m))
  akis.scrollTop = akis.scrollHeight
}

async function gonder(e) {
  e.preventDefault()
  const input = $('cxInput'), metin = input.value.trim()
  if (!metin || !acikKisi) return
  input.value = ''
  const { data, error } = await supabase.from('direkt_mesajlar').insert({
    gonderen_id: benim.id, alici_id: acikKisi.id, mesaj: metin,
  }).select('id, gonderen_id, alici_id, mesaj, created_at').single()
  if (error) { alert('Gönderilemedi: ' + error.message); input.value = metin; return }
  mesajEkle(data)
}

async function okunduIsaretle(kisiId) {
  if (!okunmamis[kisiId]) return
  const { error } = await supabase.from('direkt_mesajlar').update({ okundu: true })
    .eq('alici_id', benim.id).eq('gonderen_id', kisiId).eq('okundu', false)
  dbHata('sohbet okundu', error)   // başarısızsa rozet yenilemede geri gelir
  okunmamis[kisiId] = 0
  rozetGuncelle(); kisileriCiz()
}

function presenceKur() {
  const kanal = supabase.channel('cevrimici', { config: { presence: { key: benim.id } } })
  kanal.on('presence', { event: 'sync' }, () => {
    online = new Set(Object.keys(kanal.presenceState()))
    if (panelAcik && !acikKisi) kisileriCiz()
    if (acikKisi) konusmaDurumCiz()   // konuşma açıkken başlıktaki nokta canlı kalsın
  })
  kanal.subscribe(async status => {
    if (status === 'SUBSCRIBED') await kanal.track({ id: benim.id, ad_soyad: benim.ad_soyad, rol: benim.rol })
  })
}

function dmRealtimeKur() {
  supabase.channel('dm-widget-' + benim.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direkt_mesajlar' },
      async payload => {
        const m = payload.new
        if (m.gonderen_id !== benim.id && m.alici_id !== benim.id) return
        const karsi = m.gonderen_id === benim.id ? m.alici_id : m.gonderen_id
        if (acikKisi && acikKisi.id === karsi) {
          mesajEkle(m)
          if (m.alici_id === benim.id) await okunduIsaretle(karsi)
        } else if (m.alici_id === benim.id) {
          okunmamis[m.gonderen_id] = (okunmamis[m.gonderen_id] || 0) + 1
          rozetGuncelle()
          if (panelAcik && !acikKisi) kisileriCiz()
          toastGoster(m.gonderen_id, m.mesaj)
        }
      })
    .subscribe()
}

function toastGoster(gonderenId, metin) {
  const kap = $('cxToastlar'); if (!kap) return
  const kisi = kisiler.find(k => k.id === gonderenId)
  const ad = kisi ? (kisi.ad_soyad || kisi.email) : 'Yeni mesaj'
  const t = document.createElement('div')
  t.className = 'w-[300px] max-w-[calc(100vw-2.5rem)] bg-white border border-outline-variant border-l-4 border-l-primary rounded-xl shadow-xl px-4 py-3 cursor-pointer animate-[cxUp_.28s_ease]'
  t.innerHTML = `<div class="font-bold text-primary text-label-md">${kacis(ad)}</div><div class="text-body-md text-on-surface truncate">${kacis(metin)}</div>`
  t.addEventListener('click', () => { t.remove(); kisiAc(gonderenId) })
  kap.appendChild(t)
  setTimeout(() => t.remove(), 6000)
}
