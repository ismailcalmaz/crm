// =====================================================================
// web-takas.js — Web Takas: karşılaştırmalı çalışma alanı
//   Sol liste + sağ detay (elindeki ↔ istediği), satır-içi durum/atama.
//   Kaynak: CRM web_takas. AI/valuation history yok (o veri sistemde yok).
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, danismanAdi, fmtTarihKisa, kacis } from './veri.js'
import { mat, pill, avatar, uyari } from './stitch-ui.js'

const DURUMLAR = ['YENİ', 'İLETİŞİME GEÇİLDİ', 'DEĞERLENDİRİLDİ', 'ANLAŞILDI', 'VAZGEÇİLDİ']
const DURUM_SINIF = { 'YENİ': 'havuz', 'İLETİŞİME GEÇİLDİ': 'aktif', 'DEĞERLENDİRİLDİ': 'aktif', 'ANLAŞILDI': 'basari', 'VAZGEÇİLDİ': 'hata' }
let dmap = {}, danismanlar = [], _veri = [], filtre = 'HEPSI', arama = '', seciliId = null

function waLink(tel) {
  const d = (tel || '').replace(/\D/g, ''); if (!d) return null
  const n = d.startsWith('0') ? '9' + d : d.startsWith('90') ? d : '90' + d
  return 'https://wa.me/' + n
}
const elindeki = r => [r.marka, r.model, r.model_yili, r.paket].filter(Boolean).join(' ') || '—'

export async function webTakasKur() {
  dmap = await danismanMap()
  danismanlar = Object.values(dmap).filter(d => d.aktif !== false)
  document.getElementById('yenile')?.addEventListener('click', yukle)
  document.getElementById('filtreler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return; filtre = b.dataset.f; seciliId = null; ciz()
  })
  document.getElementById('takasAra')?.addEventListener('input', e => { arama = e.target.value.trim().toLocaleLowerCase('tr'); ciz() })
  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('liste')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const { data, error } = await supabase.from('web_takas').select('*').order('tarih', { ascending: false })
  if (error) { hedef.innerHTML = uyari(`Okunamadı: ${kacis(error.message)}`); return }
  _veri = data || []
  ciz()
}

function ciz() {
  kpiCiz(); filtreCiz()
  const hedef = document.getElementById('liste')
  let v = _veri
  if (filtre !== 'HEPSI') v = v.filter(r => r.durum === filtre)
  if (arama) v = v.filter(r => [r.ad_soyad, r.telefon, r.marka, r.model, r.istenen_arac].filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(arama))

  if (!v.length) { hedef.innerHTML = `<div class="flex flex-col items-center justify-center text-center py-14 text-on-surface-variant">${mat('swap_horiz', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">Bu filtrede takas talebi yok.</p></div>`; panelVarsayilan(v); return }
  hedef.innerHTML = v.map(kart).join('')
  hedef.querySelectorAll('[data-row]').forEach(el => el.addEventListener('click', () => detayAc(el.dataset.row)))
  panelVarsayilan(v)
}

function kart(r) {
  const aktif = seciliId === r.id
  const ist = (r.istenen_arac || '').trim()
  return `<div data-row="${r.id}" class="group cursor-pointer bg-white rounded-xl border border-outline-variant/70 ${aktif ? 'ring-2 ring-primary/30 bg-primary/5' : 'hover:shadow-md'} transition-all p-3 flex items-center gap-3">
    ${avatar(r.ad_soyad, 'w-9 h-9')}
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between gap-2">
        <p class="font-bold text-on-surface truncate">${kacis(r.ad_soyad) || '—'}</p>
        <span class="shrink-0">${pill(r.durum, DURUM_SINIF[r.durum] || 'notr')}</span>
      </div>
      <div class="flex items-center gap-1.5 mt-1 text-[12px] text-on-surface-variant min-w-0">
        <span class="truncate">${kacis(elindeki(r))}</span>
        ${mat('east', 'text-[14px] text-primary shrink-0')}
        <span class="truncate ${ist ? 'text-on-surface font-medium' : ''}">${kacis(ist) || 'farketmez'}</span>
      </div>
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
  const p = document.getElementById('takasDetay')
  p.classList.remove('hidden')
  p.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">${mat('swap_horiz', 'text-5xl opacity-30')}<p class="mt-3 font-semibold text-on-surface">Bir takas seçin</p><p class="text-label-sm mt-1 max-w-[220px]">Elindeki ve ilgilendiği araç karşılaştırması burada açılır.</p></div>`
}

function detayAc(id, sessiz) {
  const r = _veri.find(x => x.id === id); if (!r) return
  seciliId = id
  const panel = document.getElementById('takasDetay')
  const katman = document.getElementById('takasDetayKatman')
  const wa = waLink(r.telefon)
  const ist = (r.istenen_arac || '').trim()
  const spec = [r.km ? Number(r.km).toLocaleString('tr-TR') + ' km' : '', r.yakit, r.vites].filter(Boolean).join(' · ')
  const durumSec = DURUMLAR.map(d => `<option value="${kacis(d)}"${d === r.durum ? ' selected' : ''}>${kacis(d)}</option>`).join('')
  const danSec = `<option value="">— atanmadı —</option>` + danismanlar.map(d => `<option value="${d.id}"${d.id === r.atanan_danisman ? ' selected' : ''}>${kacis(d.ad_soyad)}</option>`).join('')

  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant">
      <div class="flex justify-between items-start mb-3">
        <div class="flex items-center gap-3 min-w-0">${avatar(r.ad_soyad, 'w-12 h-12')}
          <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate">${kacis(r.ad_soyad) || '—'}</h3>
            <p class="text-label-md text-on-surface-variant">${kacis(r.telefon || '—')}</p></div></div>
        <button id="takasKapat" class="p-1.5 hover:bg-surface-container-high rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex gap-2">
        ${r.telefon ? `<a href="tel:${kacis(r.telefon)}" class="flex-1 bg-primary text-on-primary py-2 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('call', 'text-[18px]')} Ara</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" class="flex-1 bg-[#25D366] text-white py-2 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('chat', 'text-[18px]')} WhatsApp</a>` : ''}
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-lg space-y-4">
      <div class="grid grid-cols-1 gap-2">
        <div class="rounded-xl border border-outline-variant p-3">
          <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant flex items-center gap-1">${mat('directions_car', 'text-[15px]')} Elindeki Araç</p>
          <p class="text-title-lg font-black text-on-surface mt-0.5">${kacis(elindeki(r))}</p>
          ${spec ? `<p class="text-label-sm text-on-surface-variant mt-0.5">${kacis(spec)}</p>` : ''}
        </div>
        <div class="flex justify-center">${mat('south', 'text-[22px] text-primary')}</div>
        <div class="rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
          <p class="text-[11px] font-bold uppercase tracking-wide text-primary flex items-center gap-1">${mat('interests', 'text-[15px]')} İlgilendiği</p>
          <p class="text-title-lg font-black text-on-surface mt-0.5">${kacis(ist) || 'Belirtilmemiş (farketmez)'}</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Durum</label>
          <select id="takasDurum" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md">${durumSec}</select></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Danışman</label>
          <select id="takasAtan" class="w-full bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md">${danSec}</select></div>
      </div>
      <span id="takasMsg" class="block text-label-sm text-on-surface-variant"></span>
    </div>
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest text-label-sm text-on-surface-variant flex items-center gap-2">${mat('schedule', 'text-[16px]')} ${fmtTarihKisa(r.tarih)}</div>`

  panel.classList.remove('hidden')
  if (window.innerWidth < 1280) {
    panel.classList.add('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[440px]', 'rounded-none')
    katman.classList.remove('hidden')
  }
  const kapat = () => { panel.classList.add('hidden'); panel.classList.remove('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[440px]', 'rounded-none'); katman.classList.add('hidden'); seciliId = null; ciz() }
  document.getElementById('takasKapat').addEventListener('click', kapat)
  katman.onclick = kapat
  document.getElementById('takasDurum').addEventListener('change', e => guncelle(r.id, { durum: e.target.value }))
  document.getElementById('takasAtan').addEventListener('change', e => guncelle(r.id, { atanan_danisman: e.target.value || null }))
  if (!sessiz) ciz()
}

async function guncelle(id, alanlar) {
  const msg = document.getElementById('takasMsg')
  if (msg) msg.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('web_takas').update(alanlar).eq('id', id)
  if (error) { if (msg) { msg.className = 'block text-label-sm text-error'; msg.textContent = 'Hata: ' + error.message }; return }
  const r = _veri.find(x => x.id === id); if (r) Object.assign(r, alanlar)
  if (msg) { msg.className = 'block text-label-sm text-green-700'; msg.textContent = 'Güncellendi ✓' }
  kpiCiz(); filtreCiz()
  // Liste rozetini tazele (seçili panel açık kalır)
  const el = document.querySelector(`[data-row="${id}"]`)
  if (el && alanlar.durum) { const p = el.querySelector('.shrink-0'); if (p) p.innerHTML = pill(alanlar.durum, DURUM_SINIF[alanlar.durum] || 'notr') }
}

function kpiCiz() {
  const say = d => _veri.filter(r => r.durum === d).length
  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('kpi').innerHTML =
    kart('swap_horiz', 'bg-primary-fixed text-primary', 'Toplam Takas', _veri.length, 'başvuru') +
    kart('fiber_new', 'bg-secondary/10 text-secondary', 'Yeni', say('YENİ'), 'iletişim bekliyor') +
    kart('handshake', 'bg-amber-100 text-amber-700', 'Değerlendirmede', say('İLETİŞİME GEÇİLDİ') + say('DEĞERLENDİRİLDİ'), 'süreçte') +
    kart('verified', 'bg-green-100 text-green-700', 'Anlaşıldı', say('ANLAŞILDI'), 'sonuçlandı')
}

function filtreCiz() {
  const say = k => k === 'HEPSI' ? _veri.length : _veri.filter(r => r.durum === k).length
  const ops = [['HEPSI', 'Tümü'], ...DURUMLAR.map(d => [d, d])]
  document.getElementById('filtreler').innerHTML = ops.map(([k, l]) => {
    const a = k === filtre
    return `<button data-f="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${kacis(l)} (${say(k)})</button>`
  }).join('')
}
