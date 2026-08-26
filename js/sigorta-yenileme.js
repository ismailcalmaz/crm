// =====================================================================
// sigorta-yenileme.js — Yenilemeler arama kuyruğu
//   Yaklaşan (policeler bitişi <= eşik) + Yenilenmeyenler (yenileme_takip).
//   Sağ detay: Ara/WhatsApp + Sonuç Kaydı (Yenilendi/Yenilenmedi+neden)
//   → yenileme_takip upsert. Yapboz hariç.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, bugunISO, telNo, waHref, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'
import { artiGun, gunFark } from './sigorta-ortak.js'

let benim = null
const cache = { yapbozTurId: null, nedenler: [], esik: 30 }
const S = { yaklasan: [], yenilenmeyen: [], takipMap: {}, sekme: 'yaklasan', secili: null }

export async function yenilemeKur(danisman) {
  benim = danisman
  await cacheYukle()
  await yukle()
}

async function cacheYukle() {
  const [tur, ned, ay] = await Promise.all([
    supabase.from('police_turleri').select('id').eq('kod', 'YAPBOZ').limit(1),
    supabase.from('yenilenmeme_nedenleri').select('id, ad').eq('aktif', true).order('sira'),
    supabase.from('sigorta_ayarlari').select('deger').eq('anahtar', 'yenileme_liste_gun').limit(1),
  ])
  cache.yapbozTurId = tur.data && tur.data[0]?.id
  cache.nedenler = ned.data || []
  cache.esik = ay.data && ay.data[0] ? Number(ay.data[0].deger) : 30
}

async function yukle() {
  const sinir = artiGun(bugunISO(), cache.esik)
  const polSelect = 'id, police_no, brut, bitis, tur_id, durum, police_turleri(ad,kod), sigorta_sirketleri(ad), sigorta_araclari(plaka), sigorta_musterileri(ad_soyad, telefon)'
  let q = supabase.from('policeler').select(polSelect).eq('durum', 'AKTIF').lte('bitis', sinir).order('bitis', { ascending: true })
  if (cache.yapbozTurId) q = q.neq('tur_id', cache.yapbozTurId)
  const [pol, tak, ynm] = await Promise.all([
    q,
    supabase.from('yenileme_takip').select('id, police_id, durum'),
    // yenileme_takip'in policeler'e İKİ FK'i var (police_id + yeni_police_id) →
    // embed'i police_id ile belirt, yoksa PostgREST belirsizlik hatası verir.
    supabase.from('yenileme_takip').select('id, police_id, durum, serbest_not, arama_tarihi, neden_id, policeler!police_id(id, police_no, brut, bitis, police_turleri(ad), sigorta_sirketleri(ad), sigorta_araclari(plaka), sigorta_musterileri(ad_soyad, telefon))').eq('durum', 'YENILENMEDI').order('arama_tarihi', { ascending: false }),
  ])
  S.takipMap = {}; (tak.data || []).forEach(t => { S.takipMap[t.police_id] = t })
  // Yaklaşan = due poliçeler, henüz YENILENDI/YENILENMEDI olmayan
  S.yaklasan = (pol.data || []).filter(p => { const t = S.takipMap[p.id]; return !t || (t.durum !== 'YENILENDI' && t.durum !== 'YENILENMEDI') })
  S.yenilenmeyen = ynm.data || []
  kpiCiz(); sekmelerCiz(); listeCiz()
  if (!S.secili && S.yaklasan.length) sec(S.yaklasan[0].id)
  else detayCiz()
}

function kpiCiz() {
  const acil = S.yaklasan.filter(p => gunFark(bugunISO(), p.bitis) <= 3).length
  const brutToplam = S.yaklasan.reduce((t, p) => t + (Number(p.brut) || 0), 0)
  const kart = (ik, l, v, renk) => `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg kart-hover">
    <div class="flex items-center gap-2 text-on-surface-variant text-label-md">${mat(ik, renk + ' text-[20px]')} ${l}</div>
    <div class="text-headline-lg text-on-surface mt-1">${v}</div></div>`
  document.getElementById('ynKpi').innerHTML =
    kart('autorenew', 'Arama Bekleyen', S.yaklasan.length, 'text-primary') +
    kart('priority_high', 'Acil (≤3 gün)', acil, 'text-error') +
    kart('payments', 'Yaklaşan Prim', fmtPara(Math.round(brutToplam)), 'text-tertiary') +
    kart('cancel', 'Yenilenmeyen', S.yenilenmeyen.length, 'text-on-surface-variant')
  document.getElementById('ynOzet').textContent = `${S.yaklasan.length} arama bekliyor · ${acil} acil`
}

function sekmelerCiz() {
  const kok = document.getElementById('ynSekmeler')
  const sek = (k, l, n) => `<button data-s="${k}" class="px-4 py-2 rounded-full text-label-md font-bold transition-colors ${S.sekme === k ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${n})</button>`
  kok.innerHTML = sek('yaklasan', 'Yaklaşan Yenilemeler', S.yaklasan.length) + sek('yenilenmeyen', 'Yenilenmeyenler', S.yenilenmeyen.length)
  kok.querySelectorAll('[data-s]').forEach(el => el.addEventListener('click', () => { S.sekme = el.dataset.s; sekmelerCiz(); listeCiz() }))
}

function kalanRozet(bitis) {
  const k = gunFark(bugunISO(), bitis)
  if (k < 0) return `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">${-k} gün geçti</span>`
  if (k <= 3) return `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">${k} gün</span>`
  if (k <= 15) return `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">${k} gün</span>`
  return `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">${k} gün</span>`
}

function listeCiz() {
  const kok = document.getElementById('ynListe')
  const rows = S.sekme === 'yaklasan' ? S.yaklasan : S.yenilenmeyen.map(t => ({ ...t.policeler, _takip: t }))
  if (!rows.length) { kok.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-10 text-center text-on-surface-variant">Kayıt yok.</div>`; return }
  kok.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden custom-shadow">
    <div class="overflow-x-auto"><table class="w-full text-left">
      <thead class="bg-surface-container-low border-b border-outline-variant"><tr>
        ${['Plaka', 'Müşteri', 'Tür', 'Şirket', 'Bitiş', 'Kalan'].map(h => `<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant whitespace-nowrap">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-outline-variant text-body-md">${rows.map(p => `<tr data-p="${p.id}" class="hover:bg-surface-container-low cursor-pointer ${S.secili === p.id ? 'bg-primary-fixed/40' : ''}">
        <td class="px-4 py-3 font-bold font-mono">${kacis(p.sigorta_araclari?.plaka || '—')}</td>
        <td class="px-4 py-3">${kacis(p.sigorta_musterileri?.ad_soyad || '—')}</td>
        <td class="px-4 py-3">${kacis(p.police_turleri?.ad || '—')}</td>
        <td class="px-4 py-3">${kacis(p.sigorta_sirketleri?.ad || '—')}</td>
        <td class="px-4 py-3 whitespace-nowrap">${p.bitis ? new Date(p.bitis + 'T00:00:00').toLocaleDateString('tr-TR') : '—'}</td>
        <td class="px-4 py-3">${S.sekme === 'yaklasan' ? kalanRozet(p.bitis) : '<span class="text-[11px] text-on-surface-variant">Yenilenmedi</span>'}</td>
      </tr>`).join('')}</tbody></table></div></div>`
  kok.querySelectorAll('[data-p]').forEach(el => el.addEventListener('click', () => sec(el.dataset.p)))
}

function sec(id) { S.secili = id; listeCiz(); detayCiz() }

async function detayCiz() {
  const kok = document.getElementById('ynDetay')
  const rows = S.sekme === 'yaklasan' ? S.yaklasan : S.yenilenmeyen.map(t => ({ ...t.policeler, _takip: t }))
  const p = rows.find(x => x.id === S.secili)
  if (!p) { kok.innerHTML = `<div class="text-center text-on-surface-variant py-16">${mat('touch_app', 'text-3xl opacity-50')}<p class="mt-2">Bir poliçe seçin.</p></div>`; return }
  const m = p.sigorta_musterileri || {}
  const wa = waHref(m.telefon)

  kok.innerHTML = `
    <div class="flex items-start justify-between">
      <div><h3 class="text-headline-sm font-bold text-primary">${kacis(m.ad_soyad || '—')}</h3>
        <p class="text-label-sm text-on-surface-variant font-mono">${kacis(p.sigorta_araclari?.plaka || '')}</p></div>
      ${S.sekme === 'yaklasan' ? kalanRozet(p.bitis) : ''}
    </div>
    <div class="mt-3 bg-surface-container-low rounded-xl p-3 flex items-center justify-between">
      <div class="text-body-md font-semibold">${kacis(m.telefon || 'Telefon yok')}</div>
      <div class="flex gap-2">
        ${m.telefon ? `<a href="tel:${telNo(m.telefon)}" class="bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1.5">${mat('call', 'text-[16px]')} Ara</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" rel="noopener" class="bg-white border border-outline-variant text-secondary px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1.5">${mat('chat', 'text-[16px]')} WhatsApp</a>` : ''}
      </div>
    </div>
    <div class="mt-4">
      <div class="text-label-md font-bold text-on-surface-variant mb-2">Poliçe Detayları</div>
      <div class="grid grid-cols-2 gap-3 text-body-md">
        ${det('Sigorta Türü', p.police_turleri?.ad)}${det('Şirket', p.sigorta_sirketleri?.ad)}
        ${det('Bitiş Tarihi', p.bitis ? new Date(p.bitis + 'T00:00:00').toLocaleDateString('tr-TR') : '—')}${det('Brüt Prim', fmtPara(p.brut))}
      </div>
    </div>
    ${S.sekme === 'yaklasan' ? sonucFormu(p) : `<div class="mt-4 bg-surface-container-low rounded-xl p-3 text-body-md"><b>Yenilenmedi.</b> ${p._takip?.serbest_not ? kacis(p._takip.serbest_not) : ''}<div class="mt-2"><button data-tekrar="${p._takip?.id}" class="text-primary font-bold text-label-md">${mat('undo', 'text-[16px]')} Tekrar Ara Listesine Al</button></div></div>`}
  `
  if (S.sekme === 'yaklasan') sonucBagla(p)
  else kok.querySelector('[data-tekrar]')?.addEventListener('click', () => tekrarAra(p._takip.id))
}
const det = (l, v) => `<div><div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${l}</div><div class="font-semibold">${kacis(v || '—')}</div></div>`

function sonucFormu(p) {
  return `<div class="mt-4 bg-surface-container-low rounded-xl p-4 border border-outline-variant">
    <div class="text-label-md font-bold text-on-surface-variant mb-2">Sonuç Kaydı</div>
    <div class="inline-flex rounded-lg border border-outline-variant overflow-hidden w-full mb-3">
      <button data-sonuc="YENILENDI" class="flex-1 px-3 py-2.5 text-label-md font-bold bg-surface text-on-surface-variant">Yenilendi</button>
      <button data-sonuc="YENILENMEDI" class="flex-1 px-3 py-2.5 text-label-md font-bold bg-surface text-on-surface-variant">Yenilenmedi</button>
    </div>
    <div id="ynNedenKutu" class="hidden mb-3"><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Yenilenmeme Nedeni</label>
      <select id="ynNeden" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md">${cache.nedenler.map(n => `<option value="${n.id}">${kacis(n.ad)}</option>`).join('')}</select></div>
    <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Poliçe Notu</label>
    <textarea id="ynNot" rows="2" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" placeholder="Görüşme detaylarını girin…"></textarea>
    <div id="ynYenilendiNot" class="hidden mt-2 text-[12px] text-on-surface-variant">Yenilendi işaretlenince yeni poliçeyi <a href="sigorta-police.html" class="text-primary font-bold underline">Poliçe Girişi</a>'nden kesebilirsiniz.</div>
    <div class="flex gap-2 mt-3">
      <button id="ynKaydet" class="flex-1 bg-primary text-on-primary py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 disabled:opacity-50" disabled>Kaydet ve Sonraki</button>
      <button id="ynErtele" class="px-4 py-2.5 rounded-lg text-label-md font-bold bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-container">Ertele</button>
    </div>
  </div>`
}

function sonucBagla(p) {
  const kok = document.getElementById('ynDetay')
  let sonuc = null
  const btns = kok.querySelectorAll('[data-sonuc]')
  const kaydet = kok.querySelector('#ynKaydet')
  btns.forEach(b => b.addEventListener('click', () => {
    sonuc = b.dataset.sonuc
    btns.forEach(x => x.className = `flex-1 px-3 py-2.5 text-label-md font-bold ${x.dataset.sonuc === sonuc ? (sonuc === 'YENILENDI' ? 'bg-secondary text-on-secondary' : 'bg-error text-on-error') : 'bg-surface text-on-surface-variant'}`)
    kok.querySelector('#ynNedenKutu').classList.toggle('hidden', sonuc !== 'YENILENMEDI')
    kok.querySelector('#ynYenilendiNot').classList.toggle('hidden', sonuc !== 'YENILENDI')
    kaydet.disabled = false
  }))
  kaydet.addEventListener('click', async () => {
    if (!sonuc) return
    kaydet.disabled = true
    const yama = {
      police_id: p.id, bitis_tarihi: p.bitis, durum: sonuc, arama_tarihi: bugunISO(), arayan: benim.email,
      neden_id: sonuc === 'YENILENMEDI' ? kok.querySelector('#ynNeden').value : null,
      serbest_not: kok.querySelector('#ynNot').value.trim() || null, updated_at: new Date().toISOString(),
    }
    const mevcut = S.takipMap[p.id]
    let error
    if (mevcut) ({ error } = await supabase.from('yenileme_takip').update(yama).eq('id', mevcut.id))
    else ({ error } = await supabase.from('yenileme_takip').insert(yama))
    if (error) { console.error('yenileme kaydet', error); alert('Kaydedilemedi: ' + error.message); kaydet.disabled = false; return }
    // Sonraki kayda geç
    const idx = S.yaklasan.findIndex(x => x.id === p.id)
    const sonraki = S.yaklasan[idx + 1]?.id || null
    S.secili = sonraki
    await yukle()
  })
  kok.querySelector('#ynErtele').addEventListener('click', () => {
    const idx = S.yaklasan.findIndex(x => x.id === p.id)
    const sonraki = S.yaklasan[idx + 1] || S.yaklasan[0]
    if (sonraki) sec(sonraki.id)
  })
}

async function tekrarAra(takipId) {
  const { error } = await supabase.from('yenileme_takip').update({ durum: 'BEKLIYOR', updated_at: new Date().toISOString() }).eq('id', takipId)
  if (dbHata('tekrar ara', error)) { alert('Hata: ' + error.message); return }
  S.sekme = 'yaklasan'; await yukle()
}
