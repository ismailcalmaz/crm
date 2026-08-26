// =====================================================================
// sigorta-dikkat.js — Dikkat Listesi (bloke etmeyen inceleme kuyruğu)
//   Kontrol Edilmemiş / Tümü + tür filtre + sağ detay (Neden İşaretlendi,
//   Beklenen/Gerçekleşen karşılaştırma, Kontrol Edildi). İşlemleri durdurmaz.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara } from './veri.js'
import { mat } from './stitch-ui.js'
import { DIKKAT_TIP } from './sigorta.js'

let benim = null
const S = { liste: [], sekme: 'acik', tipF: '', secili: null }

const TIP_SINIF = {
  IADE_SAPMASI: 'bg-amber-100 text-amber-800', KOMISYON_MANUEL: 'bg-purple-100 text-purple-800',
  VERGI_MANUEL: 'bg-blue-100 text-blue-800', GEC_TUTAR_DEGISIKLIGI: 'bg-orange-100 text-orange-800',
  IADE_GECIKTI: 'bg-surface-container-high text-on-surface-variant',
}
const tipEt = t => DIKKAT_TIP[t] || t

export async function dikkatKur(danisman) {
  benim = danisman
  const sel = document.getElementById('dkTipF')
  sel.innerHTML = '<option value="">Tüm Tipler</option>' + Object.entries(DIKKAT_TIP).map(([k, v]) => `<option value="${k}">${kacis(v)}</option>`).join('')
  sel.addEventListener('change', () => { S.tipF = sel.value; ciz() })
  document.getElementById('dkTumu').addEventListener('click', tumunuIsaretle)
  await yukle()
}

async function yukle() {
  const { data, error } = await supabase.from('dikkat_kayitlari').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) { document.getElementById('dkListe').innerHTML = `<div class="bg-error-container text-on-error-container rounded-xl p-4">Yüklenemedi: ${kacis(error.message)}</div>`; return }
  S.liste = await enrich(data || [])
  ciz()
  const rows = filtreli()
  if (!S.secili && rows.length) S.secili = rows[0].id
  ciz()
}

async function enrich(rows) {
  const idsBy = t => rows.filter(r => r.tablo === t).map(r => r.kayit_id)
  const hIds = idsBy('police_hareketleri'), pIds = idsBy('policeler'), yIds = idsBy('yapbozlar')
  const [h, p, y] = await Promise.all([
    hIds.length ? supabase.from('police_hareketleri').select('id, tutar, beklenen_tutar, islem_tarihi, policeler(police_no, sigorta_araclari(plaka), sigorta_sirketleri(ad))').in('id', hIds) : Promise.resolve({ data: [] }),
    pIds.length ? supabase.from('policeler').select('id, police_no, brut, net, sigorta_araclari(plaka), sigorta_sirketleri(ad)').in('id', pIds) : Promise.resolve({ data: [] }),
    yIds.length ? supabase.from('yapbozlar').select('id, beklenen_iade, gerceklesen_iade, sigorta_araclari(plaka), policeler(police_no, sigorta_sirketleri(ad))').in('id', yIds) : Promise.resolve({ data: [] }),
  ])
  const hm = {}, pm = {}, ym = {}
  ;(h.data || []).forEach(x => hm[x.id] = x); (p.data || []).forEach(x => pm[x.id] = x); (y.data || []).forEach(x => ym[x.id] = x)
  return rows.map(r => {
    let plaka = '—', beklenen = null, gerceklesen = null, police_no = null, sirket = null
    if (r.tablo === 'police_hareketleri' && hm[r.kayit_id]) { const x = hm[r.kayit_id]; plaka = x.policeler?.sigorta_araclari?.plaka || '—'; beklenen = x.beklenen_tutar; gerceklesen = x.tutar != null ? Math.abs(x.tutar) : null; police_no = x.policeler?.police_no; sirket = x.policeler?.sigorta_sirketleri?.ad }
    else if (r.tablo === 'policeler' && pm[r.kayit_id]) { const x = pm[r.kayit_id]; plaka = x.sigorta_araclari?.plaka || '—'; police_no = x.police_no; sirket = x.sigorta_sirketleri?.ad }
    else if (r.tablo === 'yapbozlar' && ym[r.kayit_id]) { const x = ym[r.kayit_id]; plaka = x.sigorta_araclari?.plaka || '—'; beklenen = x.beklenen_iade; gerceklesen = x.gerceklesen_iade; police_no = x.policeler?.police_no; sirket = x.policeler?.sigorta_sirketleri?.ad }
    return { ...r, plaka, beklenen, gerceklesen, police_no, sirket }
  })
}

function filtreli() {
  return S.liste.filter(r => {
    if (S.sekme === 'acik' && r.kontrol_edildi) return false
    if (S.tipF && r.tip !== S.tipF) return false
    return true
  })
}

function ciz() {
  ozetCiz(); sekmelerCiz(); listeCiz(); detayCiz()
}

function ozetCiz() {
  const acik = S.liste.filter(r => !r.kontrol_edildi)
  const buAy = new Date().toISOString().slice(0, 7)
  const ay = S.liste.filter(r => (r.created_at || '').slice(0, 7) === buAy).length
  const etki = acik.reduce((t, r) => t + (Number(r.tutar_etkisi) || 0), 0)
  document.getElementById('dkOzet').textContent = `${acik.length} kontrol edilmemiş · Bu ay ${ay} kayıt · Toplam etki ${fmtPara(Math.round(etki))}`
}

function sekmelerCiz() {
  const kok = document.getElementById('dkSekmeler')
  const acikN = S.liste.filter(r => !r.kontrol_edildi).length
  const sek = (k, l, n) => `<button data-s="${k}" class="px-4 py-2 rounded-full text-label-md font-bold ${S.sekme === k ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${n})</button>`
  kok.innerHTML = sek('acik', 'Kontrol Edilmemiş', acikN) + sek('tumu', 'Tümü', S.liste.length)
  kok.querySelectorAll('[data-s]').forEach(el => el.addEventListener('click', () => { S.sekme = el.dataset.s; ciz() }))
}

function listeCiz() {
  const kok = document.getElementById('dkListe')
  const rows = filtreli()
  if (!rows.length) { kok.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-10 text-center text-on-surface-variant">Kayıt yok. 👍</div>`; return }
  kok.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden custom-shadow">
    <div class="overflow-x-auto"><table class="w-full text-left">
      <thead class="bg-surface-container-low border-b border-outline-variant"><tr>
        ${['Tip', 'Kayıt', 'Açıklama', 'Tutar Etkisi', 'Tarih'].map(h => `<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant whitespace-nowrap">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-outline-variant text-body-md">${rows.map(r => `<tr data-r="${r.id}" class="hover:bg-surface-container-low cursor-pointer ${S.secili === r.id ? 'bg-primary-fixed/40' : ''} ${r.kontrol_edildi ? 'opacity-60' : ''}">
        <td class="px-4 py-3"><span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${r.kontrol_edildi ? 'bg-secondary-container text-on-secondary-container' : (TIP_SINIF[r.tip] || 'bg-surface-container')}">${r.kontrol_edildi ? 'Kontrol Edildi' : tipEt(r.tip)}</span></td>
        <td class="px-4 py-3 font-mono font-bold">${kacis(r.plaka)}</td>
        <td class="px-4 py-3 text-on-surface-variant max-w-[280px] truncate">${kacis(r.aciklama)}</td>
        <td class="px-4 py-3 whitespace-nowrap font-bold ${r.tutar_etkisi == null ? 'text-on-surface-variant' : Number(r.tutar_etkisi) < 0 ? 'text-error' : 'text-secondary'}">${r.tutar_etkisi != null ? fmtPara(r.tutar_etkisi) : '—'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-on-surface-variant">${new Date(r.created_at).toLocaleDateString('tr-TR')}</td>
      </tr>`).join('')}</tbody></table></div></div>`
  kok.querySelectorAll('[data-r]').forEach(el => el.addEventListener('click', () => { S.secili = el.dataset.r; ciz() }))
}

function detayCiz() {
  const kok = document.getElementById('dkDetay')
  const r = filtreli().find(x => x.id === S.secili) || S.liste.find(x => x.id === S.secili)
  if (!r) { kok.innerHTML = `<div class="text-center text-on-surface-variant py-16">${mat('flag', 'text-3xl opacity-40')}<p class="mt-2">Bir kayıt seçin.</p></div>`; return }
  const karsilastirma = (r.beklenen != null && r.gerceklesen != null) ? `
    <div class="mt-4"><div class="text-label-md font-bold text-on-surface-variant mb-2">Karşılaştırma</div>
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-surface-container-low rounded-xl p-3"><div class="text-[11px] uppercase text-on-surface-variant">Beklenen</div><div class="text-title-lg font-bold text-on-surface">${fmtPara(r.beklenen)}</div></div>
        <div class="bg-surface-container-low rounded-xl p-3"><div class="text-[11px] uppercase text-on-surface-variant">Gerçekleşen</div><div class="text-title-lg font-bold text-on-surface">${fmtPara(r.gerceklesen)}</div></div>
      </div>
      <div class="flex items-center justify-between mt-2 px-1"><span class="text-body-md text-on-surface-variant">Fark Tutarı</span><span class="font-bold ${Number(r.tutar_etkisi) < 0 ? 'text-error' : 'text-secondary'}">${fmtPara(r.tutar_etkisi)}</span></div>
    </div>` : ''
  kok.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div><h3 class="text-headline-sm font-bold text-primary font-mono">${kacis(r.plaka)}</h3>
        ${r.police_no ? `<p class="text-label-sm text-on-surface-variant">${kacis(r.police_no)}${r.sirket ? ' · ' + kacis(r.sirket) : ''}</p>` : ''}</div>
      <span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${r.kontrol_edildi ? 'bg-secondary-container text-on-secondary-container' : (TIP_SINIF[r.tip] || 'bg-surface-container')}">${r.kontrol_edildi ? 'Kontrol Edildi' : tipEt(r.tip)}</span>
    </div>
    <div class="mt-4"><div class="text-label-md font-bold text-on-surface-variant mb-1">Neden İşaretlendi</div>
      <p class="text-body-md text-on-surface bg-surface-container-low rounded-xl p-3">${kacis(r.aciklama)}</p></div>
    ${karsilastirma}
    ${r.kontrol_edildi ? `<div class="mt-4 bg-secondary-container/40 rounded-xl p-3 text-body-md"><b>${mat('check_circle', 'text-secondary text-[18px]')} ${kacis(r.kontrol_eden || '')}</b> tarafından kontrol edildi.${r.kontrol_notu ? `<div class="mt-1 text-on-surface-variant">${kacis(r.kontrol_notu)}</div>` : ''}</div>`
      : `<div class="mt-4"><div class="text-label-md font-bold text-on-surface-variant mb-1">Kontrol</div>
        <textarea id="dkNot" rows="3" placeholder="Gözleminizi buraya yazın…" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"></textarea>
        <div class="flex gap-2 mt-3"><button id="dkKontrol" class="flex-1 bg-primary text-on-primary py-2.5 rounded-lg text-label-md font-bold hover:opacity-90">Kontrol Edildi</button>
          <button id="dkSonraki" class="px-4 py-2.5 rounded-lg text-label-md font-bold bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-container">Sonraki</button></div></div>`}
  `
  if (!r.kontrol_edildi) {
    kok.querySelector('#dkKontrol').addEventListener('click', () => kontrolEt(r))
    kok.querySelector('#dkSonraki').addEventListener('click', () => {
      const rows = filtreli(); const idx = rows.findIndex(x => x.id === r.id)
      const sonraki = rows[idx + 1] || rows[0]; if (sonraki && sonraki.id !== r.id) { S.secili = sonraki.id; ciz() }
    })
  }
}

async function kontrolEt(r) {
  const not = document.getElementById('dkNot')?.value.trim() || null
  const { error } = await supabase.from('dikkat_kayitlari').update({ kontrol_edildi: true, kontrol_eden: benim.email, kontrol_at: new Date().toISOString(), kontrol_notu: not }).eq('id', r.id)
  if (error) { console.error('kontrol', error); alert('Hata: ' + error.message); return }
  const rows = filtreli(); const idx = rows.findIndex(x => x.id === r.id)
  S.secili = rows[idx + 1]?.id || null
  await yukle()
}

async function tumunuIsaretle() {
  const acik = S.liste.filter(r => !r.kontrol_edildi)
  if (!acik.length) { alert('Kontrol edilmemiş kayıt yok.'); return }
  if (!confirm(`${acik.length} kayıt "Kontrol Edildi" olarak işaretlenecek. Onaylıyor musunuz?`)) return
  const { error } = await supabase.from('dikkat_kayitlari').update({ kontrol_edildi: true, kontrol_eden: benim.email, kontrol_at: new Date().toISOString() }).eq('kontrol_edildi', false)
  if (error) { alert('Hata: ' + error.message); return }
  await yukle()
}
