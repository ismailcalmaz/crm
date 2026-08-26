// =====================================================================
// sigorta-musteri.js — Sigorta Müşterileri (Müşteri 360°)
//   Sol liste (v_musteri_360) + sağ dosya: poliçe geçmişi (yıl gruplu),
//   araçlar, tahsilat durumu, yaklaşan yenilemeler. Poliçeye tıkla →
//   Poliçe Dosyası zaman çizelgesi (v_police_timeline) modalı.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, fmtTarih, telNo, waHref, bugunISO } from './veri.js'
import { mat, avatar } from './stitch-ui.js'
import { gunFark } from './sigorta-ortak.js'

let benim = null
const S = { liste: [], ara: '', secili: null }

const DURUM_ET = { AKTIF: ['AKTİF', 'bg-amber-100 text-amber-800'], SURESI_DOLDU: ['BİTTİ', 'bg-surface-container-high text-on-surface-variant'], YENILENDI: ['YENİLENDİ', 'bg-secondary-container text-on-secondary-container'], IPTAL: ['İPTAL', 'bg-red-100 text-red-800'] }
const tcMask = tc => tc ? tc.slice(0, 4) + '****' + tc.slice(-3) : '—'

export async function musteriKur(danisman) {
  benim = danisman
  const { data, error } = await supabase.from('v_musteri_360').select('*').order('toplam_komisyon', { ascending: false }).limit(500)
  if (error) { document.getElementById('mtListe').innerHTML = `<div class="p-4 text-error text-label-md">${kacis(error.message)}</div>`; return }
  S.liste = data || []
  document.getElementById('mtOzet').textContent = `${S.liste.length} müşteri`
  listeCiz()
  document.getElementById('mtAra').addEventListener('input', e => { S.ara = e.target.value.toLocaleLowerCase('tr'); listeCiz() })
  if (S.liste.length) sec(S.liste[0].musteri_id)
  else document.getElementById('mtDetay').innerHTML = bosDetay()
}

function filtreli() {
  return S.liste.filter(m => !S.ara || (`${m.ad_soyad} ${m.tc_kimlik || ''} ${m.telefon || ''}`).toLocaleLowerCase('tr').includes(S.ara))
}

function listeCiz() {
  const kok = document.getElementById('mtListe')
  const rows = filtreli()
  if (!rows.length) { kok.innerHTML = `<div class="p-6 text-center text-on-surface-variant text-body-md">Müşteri yok.</div>`; return }
  kok.innerHTML = rows.map(m => `<button data-m="${m.musteri_id}" class="w-full flex items-center gap-3 px-3 py-2.5 border-b border-outline-variant text-left hover:bg-surface-container-low ${S.secili === m.musteri_id ? 'bg-primary-fixed/40' : ''}">
    ${avatar(m.ad_soyad, 'w-9 h-9')}
    <div class="min-w-0 flex-1"><div class="font-semibold text-on-surface truncate">${kacis(m.ad_soyad || '—')}</div>
      <div class="text-[11px] text-on-surface-variant truncate">${m.police_adedi || 0} poliçe · ${fmtPara(Math.round(Number(m.toplam_komisyon) || 0))}</div></div>
  </button>`).join('')
  kok.querySelectorAll('[data-m]').forEach(el => el.addEventListener('click', () => sec(el.dataset.m)))
}

async function sec(id) {
  S.secili = id; listeCiz()
  const m = S.liste.find(x => x.musteri_id === id)
  const kok = document.getElementById('mtDetay')
  kok.innerHTML = `<div class="p-10 text-center text-on-surface-variant">${mat('progress_activity', 'animate-spin')} Yükleniyor…</div>`
  const [polR, aracR, harR] = await Promise.all([
    supabase.from('policeler').select('id, police_no, brut, komisyon_tutari, baslangic, bitis, durum, tur_id, police_turleri(ad,kod), sigorta_sirketleri(ad), sigorta_araclari(plaka)').eq('musteri_id', id).order('baslangic', { ascending: false }),
    supabase.from('sigorta_araclari').select('id, plaka, marka, versiyon, model_yili, kaynak').eq('musteri_id', id).eq('aktif', true),
    supabase.from('police_hareketleri').select('tahsilat_durum, policeler!inner(musteri_id)').eq('policeler.musteri_id', id),
  ])
  detayCiz(m, polR.data || [], aracR.data || [], harR.data || [])
}

function detayCiz(m, policeler, araclar, hareketler) {
  const kok = document.getElementById('mtDetay')
  const aktif = policeler.filter(p => p.durum === 'AKTIF').length
  const wa = waHref(m.telefon)
  // Poliçe geçmişi — yıla göre grupla
  const yillar = {}
  for (const p of policeler) { const y = (p.baslangic || '').slice(0, 4) || '—'; (yillar[y] = yillar[y] || []).push(p) }
  const yilSirali = Object.keys(yillar).sort((a, b) => b.localeCompare(a))
  // Tahsilat sayıları
  const th = { TAHSIL_EDILDI: 0, BEKLIYOR: 0, IADE: 0 }
  for (const h of hareketler) { if (h.tahsilat_durum === 'TAHSIL_EDILDI') th.TAHSIL_EDILDI++; else if (h.tahsilat_durum === 'BEKLIYOR') th.BEKLIYOR++ }
  th.IADE = hareketler.filter(h => h.tahsilat_durum === 'IADE').length
  // Yaklaşan yenilemeler
  const yaklasan = policeler.filter(p => p.durum === 'AKTIF' && p.bitis && gunFark(bugunISO(), p.bitis) <= 60 && gunFark(bugunISO(), p.bitis) >= -5 && p.police_turleri?.kod !== 'YAPBOZ')

  kok.innerHTML = `
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg mb-gutter">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 class="text-headline-md text-primary">${kacis(m.ad_soyad || '—')}</h3>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-md text-on-surface-variant mt-1">
            <span class="font-mono">TC ${tcMask(m.tc_kimlik)}</span>
            ${m.telefon ? `<span>${kacis(m.telefon)}</span>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${m.telefon ? `<a href="tel:${telNo(m.telefon)}" class="bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1.5">${mat('call', 'text-[16px]')} Ara</a>` : ''}
          ${wa ? `<a href="${wa}" target="_blank" rel="noopener" class="bg-white border border-outline-variant text-secondary px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1.5">${mat('chat', 'text-[16px]')} WhatsApp</a>` : ''}
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3 mt-4">
        ${kpi('Toplam Poliçe', m.police_adedi || 0)}${kpi('Aktif', aktif)}${kpi('Toplam Komisyon', fmtPara(Math.round(Number(m.toplam_komisyon) || 0)))}
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-gutter items-start">
      <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
        <h4 class="text-title-lg text-primary mb-3">Poliçe Geçmişi</h4>
        ${policeler.length ? yilSirali.map(y => {
          const list = yillar[y]
          const top = list.reduce((t, p) => t + (Number(p.brut) || 0), 0)
          return `<div class="mb-4"><div class="flex items-center justify-between border-b border-outline-variant pb-1 mb-2">
            <span class="font-bold text-on-surface">${y}</span><span class="text-[11px] text-on-surface-variant">Top: ${fmtPara(Math.round(top))}</span></div>
            <div class="space-y-1.5">${list.map(p => {
              const [dl, dc] = DURUM_ET[p.durum] || [p.durum, 'bg-surface-container']
              return `<button data-pol="${p.id}" class="w-full flex items-center gap-3 py-1.5 text-left hover:bg-surface-container-low rounded-lg px-1">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded ${turSinif(p.police_turleri?.kod)} w-16 text-center shrink-0">${kacis((p.police_turleri?.ad || '').split(' ')[0] || '—')}</span>
                <span class="font-mono font-bold text-on-surface shrink-0">${kacis(p.sigorta_araclari?.plaka || '—')}</span>
                <span class="text-[12px] text-on-surface-variant flex-1 truncate">${tar(p.baslangic)} – ${tar(p.bitis)}</span>
                <span class="font-semibold ${p.durum === 'IPTAL' ? 'line-through text-on-surface-variant' : ''}">${fmtPara(p.brut)}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${dc} shrink-0">${dl}</span></button>`
            }).join('')}</div></div>`
        }).join('') : `<p class="text-on-surface-variant text-body-md py-4">Bu müşterinin poliçesi yok.</p>`}
      </div>

      <div class="space-y-gutter">
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
          <h4 class="text-title-lg text-primary mb-3">Araçlar</h4>
          ${araclar.length ? araclar.map(a => `<div class="flex items-center gap-3 py-2 border-b border-outline-variant last:border-0">
            <span class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant">${mat('directions_car', 'text-[18px]')}</span>
            <div class="min-w-0"><div class="font-mono font-bold text-on-surface">${kacis(a.plaka)}</div><div class="text-[11px] text-on-surface-variant truncate">${kacis([a.marka, a.versiyon, a.model_yili].filter(Boolean).join(' ') || '—')}</div></div>
            <span class="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${a.kaynak === 'CRM_STOK' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}">${a.kaynak === 'CRM_STOK' ? 'BİZDEN' : 'HARİCİ'}</span>
          </div>`).join('') : `<p class="text-on-surface-variant text-body-md">Araç yok.</p>`}
        </div>
        <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
          <h4 class="text-title-lg text-primary mb-3">Tahsilat Durumu</h4>
          ${thSatir('Tahsil Edildi', th.TAHSIL_EDILDI, 'bg-secondary')}${thSatir('Bekliyor', th.BEKLIYOR, 'bg-amber-500')}${thSatir('İade', th.IADE, 'bg-primary')}
        </div>
        ${yaklasan.length ? `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
          <h4 class="text-title-lg text-primary mb-3">Yaklaşan Yenilemeler</h4>
          ${yaklasan.map(p => { const k = gunFark(bugunISO(), p.bitis); return `<div class="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
            <div><span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${turSinif(p.police_turleri?.kod)}">${kacis((p.police_turleri?.ad || '').split(' ')[0])}</span> <span class="text-body-md">${tar(p.bitis)}</span></div>
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${k <= 3 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}">${k} gün kaldı</span></div>` }).join('')}
        </div>` : ''}
      </div>
    </div>`
  kok.querySelectorAll('[data-pol]').forEach(el => el.addEventListener('click', () => policeDosyaModal(el.dataset.pol)))
}

// --- Poliçe Dosyası (zaman çizelgesi) modalı ---
async function policeDosyaModal(policeId) {
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[8vh] px-4 overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-lg mb-10" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-lg py-4 border-b border-outline-variant"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat('schedule', 'text-[22px]')} Poliçe Dosyası</h3>
      <button id="pdKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div id="pdIcerik" class="p-lg"><div class="text-center text-on-surface-variant py-8">${mat('progress_activity', 'animate-spin')} Yükleniyor…</div></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat); ov.querySelector('#pdKapat').addEventListener('click', kapat)
  const { data, error } = await supabase.from('v_police_timeline').select('*').eq('police_id', policeId).order('an', { ascending: true })
  const kok = ov.querySelector('#pdIcerik')
  if (error) { kok.innerHTML = `<p class="text-error">${kacis(error.message)}</p>`; return }
  const rows = data || []
  if (!rows.length) { kok.innerHTML = `<p class="text-on-surface-variant text-center py-6">Hareket yok.</p>`; return }
  const OLAY = { POLICE_OLUSTURULDU: ['description', 'text-primary'], TAHSILAT: ['payments', 'text-secondary'], IADE: ['undo', 'text-amber-600'], ZEYIL: ['edit', 'text-tertiary'], EK_PRIM: ['add', 'text-tertiary'], DEGISIKLIK: ['history', 'text-on-surface-variant'] }
  kok.innerHTML = `<div class="relative pl-4">
    <div class="absolute left-[7px] top-2 bottom-2 w-px bg-outline-variant"></div>
    ${rows.map(r => {
      const [ik, renk] = OLAY[r.olay] || (r.olay.startsWith('YAPBOZ') ? ['extension', 'text-amber-600'] : ['circle', 'text-on-surface-variant'])
      return `<div class="relative pb-5 pl-6">
        <span class="absolute -left-[9px] top-0.5 w-4 h-4 rounded-full bg-surface-container-lowest border-2 border-current ${renk} flex items-center justify-center"></span>
        <div class="text-[11px] text-on-surface-variant">${fmtTarih(r.an)}${r.kullanici ? ' · ' + kacis(r.kullanici) : ''}</div>
        <div class="font-semibold text-on-surface">${kacis(olayEt(r.olay))}</div>
        <div class="text-body-md text-on-surface-variant">${kacis(r.aciklama || '')}</div>
      </div>`
    }).join('')}
  </div>`
}
const olayEt = o => ({ POLICE_OLUSTURULDU: 'Poliçe oluşturuldu', TAHSILAT: 'Tahsilat yapıldı', IADE: 'İade işlendi', ZEYIL: 'Zeyil', EK_PRIM: 'Ek prim', DEGISIKLIK: 'Değişiklik', YAPBOZ_AKTIF: 'Yapboz açıldı', YAPBOZ_SATILDI_IADE_BEKLIYOR: 'Araç satıldı — iade bekliyor', YAPBOZ_IADE_EDILDI: 'Yapboz iadesi işlendi', YAPBOZ_SURESI_DOLDU: 'Yapboz süresi doldu' }[o] || o)

// --- yardımcılar ---
const tar = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : '—'
const kpi = (l, v) => `<div class="bg-surface-container-low rounded-xl p-3 text-center"><div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${l}</div><div class="text-title-lg font-bold text-on-surface mt-0.5">${v}</div></div>`
const thSatir = (l, n, renk) => `<div class="flex items-center gap-2 py-1.5"><span class="w-2.5 h-2.5 rounded-full ${renk}"></span><span class="text-body-md flex-1">${l}</span><span class="font-bold">${n}</span></div>`
const bosDetay = () => `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-16 text-center text-on-surface-variant">${mat('contacts', 'text-3xl opacity-40')}<p class="mt-2">Henüz sigorta müşterisi yok.</p></div>`
const TUR_SINIF = { TRAFIK: 'bg-blue-100 text-blue-800', KASKO: 'bg-tertiary-container text-on-tertiary-container', YAPBOZ: 'bg-amber-100 text-amber-800', KONUT: 'bg-green-100 text-green-800', FERDI_KAZA: 'bg-purple-100 text-purple-800', TSS: 'bg-pink-100 text-pink-800', DASK: 'bg-cyan-100 text-cyan-800', ISYERI: 'bg-orange-100 text-orange-800' }
const turSinif = k => TUR_SINIF[k] || 'bg-surface-container text-on-surface-variant'
