// =====================================================================
// web-iletisim.js — Mesaj Merkezi (Apple Mail düzeni)
//   Sol gelen kutusu + sağ mesaj detayı + hızlı yanıtlar (WhatsApp şablonu).
//   Kaynak: CRM web_iletisim. Tek mesajlık form kaydı — thread değil.
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, fmtTarihKisa, kacis } from './veri.js'
import { mat, pill, avatar, uyari } from './stitch-ui.js'

const DURUMLAR = ['YENİ', 'OKUNDU', 'YANITLANDI', 'KAPANDI']
const DURUM_SINIF = { 'YENİ': 'havuz', 'OKUNDU': 'aktif', 'YANITLANDI': 'basari', 'KAPANDI': 'notr' }
const DURUM_NOKTA = { 'YENİ': 'bg-error', 'OKUNDU': 'bg-amber-400', 'YANITLANDI': 'bg-green-500', 'KAPANDI': 'bg-outline' }
let dmap = {}, danismanlar = [], _veri = [], filtre = 'HEPSI', arama = '', seciliId = null

// Hızlı yanıt şablonları — WhatsApp'ta ön-dolu açılır (metinler düzenlenebilir başlangıç)
const HIZLI_YANITLAR = [
  ['directions_car', 'Araç müsait', 'Merhaba, ilgilendiğiniz araç hâlâ mevcut. Uygun olduğunuzda showroom’umuzda görebilirsiniz.'],
  ['credit_score', 'Kredi / finansman', 'Merhaba, aracınız için kredi ve katılım finans seçeneklerimiz mevcut. Detayları paylaşabiliriz.'],
  ['location_on', 'Konum / adres', 'İsmail Çalmaz Otomotiv — Gaziemir / İzmir. Yol tarifi için konumumuzu gönderebiliriz.'],
  ['schedule', 'Çalışma saatleri', 'Hafta içi 09:00–19:00, Cumartesi 09:00–18:00 arası açığız. Bekleriz!'],
]

function waLink(tel, metin) {
  const d = (tel || '').replace(/\D/g, ''); if (!d) return null
  const n = d.startsWith('0') ? '9' + d : d.startsWith('90') ? d : '90' + d
  return 'https://wa.me/' + n + (metin ? '?text=' + encodeURIComponent(metin) : '')
}
function toast(msg, ik = 'check_circle') {
  const t = document.getElementById('iletiToast')
  t.innerHTML = `${mat(ik, 'text-[20px] text-green-400')} ${kacis(msg)}`
  t.classList.remove('hidden')
  clearTimeout(toast._z); toast._z = setTimeout(() => t.classList.add('hidden'), 2400)
}
const yanitlanmamis = r => r.durum === 'YENİ' || r.durum === 'OKUNDU'

export async function webIletisimKur() {
  dmap = await danismanMap()
  danismanlar = Object.values(dmap).filter(d => d.aktif !== false)
  document.getElementById('yenile')?.addEventListener('click', yukle)
  document.getElementById('filtreler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return; filtre = b.dataset.f; seciliId = null; ciz()
  })
  document.getElementById('iletiAra')?.addEventListener('input', e => { arama = e.target.value.trim().toLocaleLowerCase('tr'); ciz() })
  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('liste')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const { data, error } = await supabase.from('web_iletisim').select('*').order('tarih', { ascending: false })
  if (error) { hedef.innerHTML = uyari(`Okunamadı: ${kacis(error.message)}`); return }
  _veri = data || []
  ciz()
}

function ciz() {
  kpiCiz(); filtreCiz()
  const hedef = document.getElementById('liste')
  let v = _veri
  if (filtre === 'yanitlanmamis') v = v.filter(yanitlanmamis)
  else if (filtre !== 'HEPSI') v = v.filter(r => r.durum === filtre)
  if (arama) v = v.filter(r => [r.ad_soyad, r.telefon, r.eposta, r.konu, r.mesaj].filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(arama))

  if (!v.length) { hedef.innerHTML = `<div class="flex flex-col items-center justify-center text-center py-14 text-on-surface-variant">${mat('mark_email_read', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">Bu kutuda mesaj yok.</p></div>`; panelVarsayilan(v); return }
  hedef.innerHTML = v.map(satir).join('')
  hedef.querySelectorAll('[data-row]').forEach(el => el.addEventListener('click', () => { const r = _veri.find(x => x.id === el.dataset.row); if (r && r.durum === 'YENİ') guncelle(r.id, { durum: 'OKUNDU' }, true); detayAc(el.dataset.row) }))
  panelVarsayilan(v)
}

function satir(r) {
  const aktif = seciliId === r.id
  const yeni = r.durum === 'YENİ'
  return `<div data-row="${r.id}" class="group cursor-pointer px-4 py-3 flex gap-3 ${aktif ? 'bg-primary/5 border-l-2 border-primary' : 'hover:bg-surface-container-low border-l-2 border-transparent'} transition-colors">
    ${avatar(r.ad_soyad, 'w-9 h-9')}
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between gap-2">
        <p class="font-bold text-on-surface truncate flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${DURUM_NOKTA[r.durum] || 'bg-outline'} shrink-0"></span>${kacis(r.ad_soyad) || '—'}</p>
        <span class="text-[11px] text-on-surface-variant shrink-0">${fmtTarihKisa(r.tarih)}</span>
      </div>
      <p class="text-label-md ${yeni ? 'font-bold text-on-surface' : 'text-on-surface-variant'} truncate mt-0.5">${kacis(r.konu) || '(konu yok)'}</p>
      <p class="text-[12px] text-on-surface-variant truncate">${kacis(r.mesaj) || ''}</p>
    </div>
  </div>`
}

function panelVarsayilan(v) {
  if (window.innerWidth < 1280) return
  if (seciliId && v.some(r => r.id === seciliId)) detayAc(seciliId, true)
  else if (v.length) { seciliId = null; detayAc(v[0].id, true) }
  else { seciliId = null; panelBos() }
}
function panelBos() {
  const p = document.getElementById('iletiDetay')
  p.classList.remove('hidden')
  p.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">${mat('forum', 'text-5xl opacity-30')}<p class="mt-3 font-semibold text-on-surface">Bir mesaj seçin</p><p class="text-label-sm mt-1 max-w-[240px]">Mesaj içeriği, kişi bilgisi ve hızlı yanıtlar burada açılır.</p></div>`
}

function detayAc(id, sessiz) {
  const r = _veri.find(x => x.id === id); if (!r) return
  seciliId = id
  const panel = document.getElementById('iletiDetay')
  const katman = document.getElementById('iletiDetayKatman')
  const wa = waLink(r.telefon)
  const durumSec = DURUMLAR.map(d => `<option value="${kacis(d)}"${d === r.durum ? ' selected' : ''}>${kacis(d)}</option>`).join('')
  const danSec = `<option value="">— atanmadı —</option>` + danismanlar.map(d => `<option value="${d.id}"${d.id === r.atanan_danisman ? ' selected' : ''}>${kacis(d.ad_soyad)}</option>`).join('')

  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">${avatar(r.ad_soyad, 'w-11 h-11')}
        <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate">${kacis(r.ad_soyad) || '—'}</h3>
          <p class="text-label-md text-on-surface-variant truncate">${kacis([r.telefon, r.eposta].filter(Boolean).join(' · ')) || '—'}</p></div></div>
      <div class="flex items-center gap-1 shrink-0">
        ${r.telefon ? `<a href="tel:${kacis(r.telefon)}" title="Ara" class="w-9 h-9 rounded-lg bg-primary text-on-primary inline-flex items-center justify-center hover:opacity-90">${mat('call', 'text-[18px]')}</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" title="WhatsApp" class="w-9 h-9 rounded-lg bg-[#25D366] text-white inline-flex items-center justify-center hover:opacity-90">${mat('chat', 'text-[18px]')}</a>` : ''}
        ${r.eposta ? `<a href="mailto:${kacis(r.eposta)}" title="E-posta" class="w-9 h-9 rounded-lg bg-surface-container text-on-surface-variant inline-flex items-center justify-center hover:bg-surface-container-high">${mat('mail', 'text-[18px]')}</a>` : ''}
        <button id="iletiKapat" class="w-9 h-9 rounded-lg hover:bg-surface-container-high text-on-surface-variant inline-flex items-center justify-center">${mat('close')}</button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-lg space-y-4">
      <div class="flex items-center gap-2">${pill(r.durum, DURUM_SINIF[r.durum] || 'notr')}<span class="text-label-sm text-on-surface-variant">${fmtTarihKisa(r.tarih)}</span></div>
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Konu</p>
        <p class="text-title-lg font-bold text-on-surface">${kacis(r.konu) || '(konu belirtilmemiş)'}</p>
      </div>
      <div class="bg-surface-container-low rounded-xl rounded-tl-sm p-4">
        <p class="text-body-md text-on-surface whitespace-pre-wrap">${kacis(r.mesaj) || '(mesaj metni yok)'}</p>
      </div>
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-2">Hızlı Yanıtlar ${wa ? '<span class="font-normal normal-case">(WhatsApp’ta açılır)</span>' : '<span class="font-normal normal-case">(kopyalanır)</span>'}</p>
        <div class="grid grid-cols-1 gap-2">
          ${HIZLI_YANITLAR.map((h, i) => `<button data-hy="${i}" class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-outline-variant hover:border-primary hover:bg-surface-container-low text-left"><span class="w-8 h-8 rounded-lg bg-primary-fixed text-primary flex items-center justify-center shrink-0">${mat(h[0], 'text-[18px]')}</span><span class="text-body-md font-semibold text-on-surface">${h[1]}</span>${mat('arrow_forward', 'text-[16px] text-on-surface-variant ml-auto')}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest grid grid-cols-2 gap-2">
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Durum</label>
        <select id="iletiDurum" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md">${durumSec}</select></div>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Atanan</label>
        <select id="iletiAtan" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md">${danSec}</select></div>
    </div>`

  panel.classList.remove('hidden')
  if (window.innerWidth < 1280) {
    panel.classList.add('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[94vw]', 'max-w-[460px]', 'rounded-none')
    katman.classList.remove('hidden')
  }
  const kapat = () => { panel.classList.add('hidden'); panel.classList.remove('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[94vw]', 'max-w-[460px]', 'rounded-none'); katman.classList.add('hidden'); seciliId = null; ciz() }
  document.getElementById('iletiKapat').addEventListener('click', kapat)
  katman.onclick = kapat
  document.getElementById('iletiDurum').addEventListener('change', e => guncelle(r.id, { durum: e.target.value }))
  document.getElementById('iletiAtan').addEventListener('change', e => guncelle(r.id, { atanan_danisman: e.target.value || null }))
  panel.querySelectorAll('[data-hy]').forEach(b => b.addEventListener('click', () => {
    const metin = HIZLI_YANITLAR[+b.dataset.hy][2]
    const link = waLink(r.telefon, metin)
    if (link) { window.open(link, '_blank'); if (r.durum !== 'KAPANDI') guncelle(r.id, { durum: 'YANITLANDI' }) }
    else { navigator.clipboard?.writeText(metin); toast('Yanıt kopyalandı') }
  }))
  if (!sessiz) ciz()
}

async function guncelle(id, alanlar, sessiz) {
  const { error } = await supabase.from('web_iletisim').update(alanlar).eq('id', id)
  if (error) { if (!sessiz) alert('Güncellenemedi: ' + error.message); return }
  const r = _veri.find(x => x.id === id); if (r) Object.assign(r, alanlar)
  if (sessiz) { kpiCiz(); filtreCiz(); const el = document.querySelector(`[data-row="${id}"]`); if (el) { const r2 = _veri.find(x => x.id === id); if (r2) el.outerHTML = satir(r2) } ; bindSatir(id) }
  else { kpiCiz(); filtreCiz(); if (!sessiz) toast('Güncellendi ✓') }
}
function bindSatir(id) {
  const el = document.querySelector(`[data-row="${id}"]`)
  if (el) el.addEventListener('click', () => { const r = _veri.find(x => x.id === id); if (r && r.durum === 'YENİ') guncelle(r.id, { durum: 'OKUNDU' }, true); detayAc(id) })
}

function kpiCiz() {
  const say = d => _veri.filter(r => r.durum === d).length
  const yanitsiz = _veri.filter(yanitlanmamis).length
  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('kpi').innerHTML =
    kart('inbox', 'bg-primary-fixed text-primary', 'Toplam Mesaj', _veri.length, 'gelen kutusu') +
    kart('mark_email_unread', 'bg-error-container text-error', 'Yanıtlanmamış', yanitsiz, 'yeni + okundu') +
    kart('mark_email_read', 'bg-green-100 text-green-700', 'Yanıtlandı', say('YANITLANDI'), 'dönüş yapıldı') +
    kart('done_all', 'bg-secondary/10 text-secondary', 'Kapandı', say('KAPANDI'), 'sonuçlandı')
}

function filtreCiz() {
  const say = k => k === 'HEPSI' ? _veri.length : k === 'yanitlanmamis' ? _veri.filter(yanitlanmamis).length : _veri.filter(r => r.durum === k).length
  const ops = [['HEPSI', 'Tümü'], ['yanitlanmamis', 'Yanıtlanmamış'], ['YANITLANDI', 'Yanıtlandı'], ['KAPANDI', 'Kapandı']]
  document.getElementById('filtreler').innerHTML = ops.map(([k, l]) => {
    const a = k === filtre
    return `<button data-f="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${kacis(l)} (${say(k)})</button>`
  }).join('')
}
