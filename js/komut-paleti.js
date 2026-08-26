// =====================================================================
// komut-paleti.js — Global Ctrl+K komut paleti (her sayfada)
//   Müşteri (talepler) + araç (stok) araması + izne göre hızlı eylemler.
//   ustBarKur() içinden komutPaletiKur(danisman) ile kurulur.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import { kacis } from './veri.js'
import { etkinSayfalar } from './yetki.js'
import { mat, avatar } from './stitch-ui.js'

let benim = null

export function komutPaletiKur(danisman) {
  benim = danisman
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ac() }
  })
}

function eylemler() {
  const keys = etkinSayfalar(benim)
  return [
    keys.includes('talepler') && ['add_circle', 'Yeni Talep Oluştur', 'talepler.html?yeni=1'],
    keys.includes('havuz') && ['inbox', 'Havuza Git', 'havuz.html'],
    keys.includes('stok') && ['directions_car', 'Stok / Envanter', 'stok.html'],
    keys.includes('kredi') && ['credit_score', 'Kredi Kuyruğu', 'kredi.html'],
    keys.includes('katilim_finans') && ['account_balance', 'Katılım Finans', 'katilim-finans.html'],
    ['person', 'Profilim', 'profil.html'],
  ].filter(Boolean)
}

function ac() {
  if (document.getElementById('kmdOv')) return
  const ov = document.createElement('div')
  ov.id = 'kmdOv'
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[12vh] px-4'
  ov.innerHTML = `<div class="bg-white rounded-2xl custom-shadow w-full max-w-xl overflow-hidden" onclick="event.stopPropagation()">
    <div class="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">
      ${mat('search', 'text-on-surface-variant')}
      <input id="kmdInput" placeholder="Müşteri, araç veya komut ara…" class="flex-1 outline-none text-body-lg bg-transparent placeholder:text-on-surface-variant/60" />
      <kbd class="text-[10px] border border-outline-variant rounded px-1.5 py-0.5 text-on-surface-variant">ESC</kbd>
    </div>
    <div id="kmdSonuc" class="max-h-[56vh] overflow-y-auto p-2"></div>
    <div class="flex items-center gap-4 px-4 py-2 border-t border-outline-variant text-[11px] text-on-surface-variant bg-surface-container-lowest">
      <span class="flex items-center gap-1">${mat('bolt', 'text-[14px]')} Ctrl+K aç/kapat</span></div>
  </div>`
  document.body.appendChild(ov)
  const inp = ov.querySelector('#kmdInput')
  const sonuc = ov.querySelector('#kmdSonuc')
  const kapat = () => { ov.remove(); window.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.addEventListener('click', kapat)
  window.addEventListener('keydown', esc)

  const eylemCiz = (q) => eylemler().filter(a => !q || a[1].toLocaleLowerCase('tr').includes(q))
  const ilkCiz = () => {
    sonuc.innerHTML = `<p class="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Hızlı Eylem</p>`
      + eylemCiz('').map(a => `<a href="${a[2]}" class="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container-low text-left">${mat(a[0], 'text-primary')}<span class="text-body-md">${a[1]}</span></a>`).join('')
      + `<p class="px-2 pt-3 text-[11px] text-on-surface-variant">Aramak için yazmaya başla — müşteri adı, telefon, araç…</p>`
  }
  ilkCiz()
  inp.focus()

  let z
  inp.addEventListener('input', () => {
    clearTimeout(z)
    const raw = inp.value.trim()
    if (!raw) { ilkCiz(); return }
    z = setTimeout(() => ara(raw, sonuc, kapat), 220)
  })
}

async function ara(raw, sonuc, kapat) {
  const q = raw.toLocaleLowerCase('tr')
  const g = raw.replace(/[,()*%]/g, ' ').trim()   // .or() filtre sözdizimini bozma
  sonuc.innerHTML = `<p class="p-4 text-center text-on-surface-variant text-label-md">Aranıyor…</p>`
  const keys = etkinSayfalar(benim)
  const [musteriR, aracR] = await Promise.all([
    keys.includes('talepler') || keys.includes('havuz')
      ? supabase.from('talepler').select('id, musteri_ad_soyad, telefon, marka, model')
          .or(`musteri_ad_soyad.ilike.%${g}%,telefon.ilike.%${g}%`).limit(6)
      : Promise.resolve({ data: [] }),
    keys.includes('stok')
      ? siteDb.from('araclar').select('id, marka, model, yil, plaka, fiyat')
          .or(`marka.ilike.%${g}%,model.ilike.%${g}%,plaka.ilike.%${g}%`).eq('durum', 'aktif').limit(5)
      : Promise.resolve({ data: [] }),
  ])
  const musteri = musteriR.data || [], arac = aracR.data || []
  const eyl = eylemler().filter(a => a[1].toLocaleLowerCase('tr').includes(q))

  let html = ''
  if (musteri.length) {
    html += `<p class="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Müşteriler</p>`
    html += musteri.map(t => `<a href="talep.html?id=${t.id}" class="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container-low text-left">
      ${avatar(t.musteri_ad_soyad, 'w-8 h-8')}
      <div class="min-w-0 flex-1"><p class="font-semibold text-on-surface truncate">${kacis(t.musteri_ad_soyad) || '—'}</p>
        <p class="text-[11px] text-on-surface-variant truncate">${kacis(t.telefon || '')}${(t.marka || t.model) ? ' · ' + kacis([t.marka, t.model].filter(Boolean).join(' ')) : ''}</p></div>
      ${mat('arrow_forward', 'text-on-surface-variant text-[16px]')}</a>`).join('')
  }
  if (arac.length) {
    html += `<p class="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Araçlar</p>`
    html += arac.map(a => `<a href="stok-arac.html?ref=${encodeURIComponent(a.id)}" class="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container-low text-left">
      <span class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant shrink-0">${mat('directions_car', 'text-[18px]')}</span>
      <div class="min-w-0 flex-1"><p class="font-semibold text-on-surface truncate">${kacis([a.marka, a.model, a.yil].filter(Boolean).join(' '))}</p>
        <p class="text-[11px] text-on-surface-variant truncate">${kacis(a.plaka || '')}</p></div>
      ${mat('arrow_forward', 'text-on-surface-variant text-[16px]')}</a>`).join('')
  }
  if (eyl.length) {
    html += `<p class="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Hızlı Eylem</p>`
    html += eyl.map(a => `<a href="${a[2]}" class="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-container-low text-left">${mat(a[0], 'text-primary')}<span class="text-body-md">${a[1]}</span></a>`).join('')
  }
  sonuc.innerHTML = html || `<p class="p-6 text-center text-on-surface-variant text-label-md">"${kacis(raw)}" için sonuç yok.</p>`
}
