// =====================================================================
// sigorta-rapor.js — Sigorta Raporları
//   Komisyon Analizi (v_komisyon_analizi) + Süreç Süreleri (v_sure_olcumleri)
//   + Şirket Performansı (v_sirket_performansi). Excel'e aktar (CSV).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, csvIndir } from './veri.js'
import { mat, sparkline } from './stitch-ui.js'

let benim = null
const D = { komisyon: [], sureler: [], performans: [] }

const SUREC_ET = { TEKLIF_HAZIRLAMA: ['Teklif Hazırlama', 'saat'], IADE_KAPANMA: ['İade Kapanma', 'gün'], ON_KAYIT_ESLESME: ['Ön Kayıt Eşleşme', 'saat'], YENILEME_ARAMA: ['Yenileme Araması', 'gün'] }

export async function raporKur(danisman) {
  benim = danisman
  const [kom, sur, per] = await Promise.all([
    supabase.from('v_komisyon_analizi').select('*'),
    supabase.from('v_sure_olcumleri').select('*'),
    supabase.from('v_sirket_performansi').select('*'),
  ])
  D.komisyon = kom.data || []
  D.sureler = sur.data || []
  D.performans = per.data || []
  komisyonCiz()
  surelerCiz()
  performansCiz()
  document.getElementById('rpExcel').addEventListener('click', excelAktar)
}

// --- Komisyon ---
function sirketOzet() {
  const m = {}
  for (const r of D.komisyon) {
    const k = r.sirket || '—'
    if (!m[k]) m[k] = { sirket: k, adet: 0, beklenen: 0, iade: 0, iptal: 0, gerceklesen: 0 }
    m[k].adet += Number(r.aktif_adet) || 0
    m[k].beklenen += Number(r.beklenen_komisyon) || 0
    m[k].iade += Number(r.iade_dususu) || 0
    m[k].iptal += Number(r.iptal_dususu) || 0
    m[k].gerceklesen += Number(r.gerceklesen_komisyon) || 0
  }
  return Object.values(m).sort((a, b) => b.gerceklesen - a.gerceklesen)
}

function komisyonCiz() {
  const ozet = sirketOzet()
  const topGer = ozet.reduce((t, r) => t + r.gerceklesen, 0)
  const topBek = ozet.reduce((t, r) => t + r.beklenen, 0)
  const topIade = Math.abs(ozet.reduce((t, r) => t + r.iade, 0))
  const topIptal = ozet.reduce((t, r) => t + r.iptal, 0)
  const kayip = topIade + topIptal
  document.getElementById('rpOzet').textContent = `${ozet.length} şirket · gerçekleşen komisyon ${fmtPara(Math.round(topGer))}`

  // Aylık trend (gerçekleşen komisyon) sparkline
  const aylik = {}
  for (const r of D.komisyon) { const d = (r.donem || '').slice(0, 7); aylik[d] = (aylik[d] || 0) + (Number(r.gerceklesen_komisyon) || 0) }
  const seri = Object.keys(aylik).sort().map(k => aylik[k])

  document.getElementById('rpKomOzet').innerHTML = `
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
      <div class="text-label-md text-on-surface-variant">Gerçekleşen Komisyon</div>
      <div class="text-headline-lg text-secondary mt-1">${fmtPara(Math.round(topGer))}</div>
      ${sparkline(seri, '#006e2d', 40)}
    </div>
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
      <div class="text-label-md text-on-surface-variant">Kayıp (İade + İptal)</div>
      <div class="text-headline-lg text-error mt-1">${fmtPara(Math.round(kayip))}</div>
      <div class="text-[11px] text-on-surface-variant mt-2">İade ${fmtPara(Math.round(topIade))} · İptal ${fmtPara(Math.round(topIptal))}</div>
    </div>`

  // Dağılım akışı
  const tam = topGer + kayip || 1
  const p = n => Math.round(n / tam * 100)
  document.getElementById('rpKomAkis').innerHTML = `
    <div class="text-label-md font-bold text-on-surface-variant mb-2">Komisyon Dağılım Akışı</div>
    <div class="flex h-8 rounded-lg overflow-hidden border border-outline-variant">
      <div class="bg-secondary text-white text-[11px] font-bold flex items-center justify-center" style="width:${p(topGer)}%" title="Gerçekleşen">${p(topGer) > 8 ? 'Gerçekleşen %' + p(topGer) : ''}</div>
      <div class="bg-amber-400 text-amber-950 text-[11px] font-bold flex items-center justify-center" style="width:${p(topIade)}%">${p(topIade) > 8 ? 'İade %' + p(topIade) : ''}</div>
      <div class="bg-error text-white text-[11px] font-bold flex items-center justify-center" style="width:${p(topIptal)}%">${p(topIptal) > 8 ? 'İptal %' + p(topIptal) : ''}</div>
    </div>
    <div class="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-[12px] text-on-surface-variant">
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-secondary"></span> Beklenen ${fmtPara(Math.round(topBek))}</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span> İade ${fmtPara(Math.round(topIade))}</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-error"></span> İptal ${fmtPara(Math.round(topIptal))}</span>
    </div>`

  // Şirket tablosu
  const oran = r => r.beklenen > 0 ? Math.round(r.gerceklesen / r.beklenen * 100) : 0
  document.getElementById('rpKomTablo').innerHTML = ozet.length ? `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden custom-shadow">
    <div class="overflow-x-auto"><table class="w-full text-left">
      <thead class="bg-surface-container-low border-b border-outline-variant"><tr>
        ${['Şirket', 'Poliçe', 'Beklenen', 'İade', 'İptal', 'Gerçekleşen', 'Oran'].map(h => `<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant whitespace-nowrap ${h !== 'Şirket' ? 'text-right' : ''}">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-outline-variant text-body-md">${ozet.map(r => `<tr class="hover:bg-surface-container-low">
        <td class="px-4 py-3 font-bold">${kacis(r.sirket)}</td>
        <td class="px-4 py-3 text-right">${r.adet}</td>
        <td class="px-4 py-3 text-right">${fmtPara(Math.round(r.beklenen))}</td>
        <td class="px-4 py-3 text-right text-amber-700">${fmtPara(Math.round(r.iade))}</td>
        <td class="px-4 py-3 text-right text-error">${fmtPara(Math.round(r.iptal))}</td>
        <td class="px-4 py-3 text-right font-bold text-secondary">${fmtPara(Math.round(r.gerceklesen))}</td>
        <td class="px-4 py-3 text-right"><span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${oran(r) >= 90 ? 'bg-secondary-container text-on-secondary-container' : oran(r) >= 75 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}">%${oran(r)}</span></td>
      </tr>`).join('')}</tbody>
      <tfoot class="bg-surface-container-low border-t-2 border-outline-variant font-bold"><tr>
        <td class="px-4 py-3">TOPLAM</td><td class="px-4 py-3 text-right">${ozet.reduce((t, r) => t + r.adet, 0)}</td>
        <td class="px-4 py-3 text-right">${fmtPara(Math.round(topBek))}</td>
        <td class="px-4 py-3 text-right text-amber-700">${fmtPara(Math.round(ozet.reduce((t, r) => t + r.iade, 0)))}</td>
        <td class="px-4 py-3 text-right text-error">${fmtPara(Math.round(topIptal))}</td>
        <td class="px-4 py-3 text-right text-secondary">${fmtPara(Math.round(topGer))}</td><td></td>
      </tr></tfoot>
    </table></div></div>` : bosKutu('Henüz komisyon verisi yok.')
}

// --- Süreç Süreleri ---
function surelerCiz() {
  const kok = document.getElementById('rpSureler')
  const kayit = Object.fromEntries(D.sureler.map(s => [s.surec, s]))
  kok.innerHTML = Object.entries(SUREC_ET).map(([kod, [l, birim]]) => {
    const s = kayit[kod]
    const deger = s && s.medyan_saat != null ? s.medyan_saat : (s && s.ortalama_saat != null ? s.ortalama_saat : null)
    return `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
      <div class="text-label-md text-on-surface-variant">${l}</div>
      <div class="mt-1"><span class="text-headline-lg text-on-surface">${deger != null ? String(deger).replace('.', ',') : '—'}</span> <span class="text-body-md text-on-surface-variant">${birim}</span></div>
      <div class="text-[11px] text-on-surface-variant mt-1">${s && s.ortalama_saat != null ? 'ortalama ' + String(s.ortalama_saat).replace('.', ',') + ' ' + birim + ' · ' + s.adet + ' kayıt' : 'veri yok'}</div>
    </div>`
  }).join('')
}

// --- Şirket Performansı ---
function performansCiz() {
  const rows = [...D.performans].sort((a, b) => (b.iade_adedi || 0) - (a.iade_adedi || 0))
  const kok = document.getElementById('rpPerformans')
  if (!rows.length) { kok.innerHTML = bosKutu('Henüz iade verisi yok.'); return }
  const maxOran = 100
  kok.innerHTML = `<div class="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-gutter items-start">
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden custom-shadow">
      <div class="overflow-x-auto"><table class="w-full text-left">
        <thead class="bg-surface-container-low border-b border-outline-variant"><tr>
          ${['Şirket', 'İade Adedi', 'Ort. İade Süresi', 'Ort. İade Oranı', 'Toplam Sapma'].map((h, i) => `<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant whitespace-nowrap ${i ? 'text-right' : ''}">${h}</th>`).join('')}
        </tr></thead>
        <tbody class="divide-y divide-outline-variant text-body-md">${rows.map(r => `<tr class="hover:bg-surface-container-low">
          <td class="px-4 py-3 font-bold">${kacis(r.sirket)}</td>
          <td class="px-4 py-3 text-right">${r.iade_adedi || 0}</td>
          <td class="px-4 py-3 text-right">${r.ort_iade_gun != null ? String(r.ort_iade_gun).replace('.', ',') + ' gün' : '—'}</td>
          <td class="px-4 py-3 text-right ${r.ort_iade_orani != null && r.ort_iade_orani < 90 ? 'text-error font-bold' : ''}">${r.ort_iade_orani != null ? '%' + String(r.ort_iade_orani).replace('.', ',') : '—'}</td>
          <td class="px-4 py-3 text-right font-bold ${Number(r.toplam_sapma) < 0 ? 'text-error' : 'text-on-surface'}">${r.toplam_sapma != null ? fmtPara(Math.round(r.toplam_sapma)) : '—'}</td>
        </tr>`).join('')}</tbody></table></div></div>
    <div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
      <div class="text-label-md font-bold text-on-surface-variant mb-3">İade Oranı Sıralaması</div>
      <div class="space-y-2.5">${[...rows].sort((a, b) => (b.ort_iade_orani || 0) - (a.ort_iade_orani || 0)).map(r => {
        const o = Number(r.ort_iade_orani) || 0
        return `<div><div class="flex justify-between text-[12px] mb-0.5"><span class="font-semibold">${kacis(r.sirket)}</span><span class="font-bold">%${String(r.ort_iade_orani ?? 0).replace('.', ',')}</span></div>
          <div class="h-2 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full rounded-full ${o >= 90 ? 'bg-secondary' : o >= 75 ? 'bg-amber-400' : 'bg-error'}" style="width:${Math.min(100, o / maxOran * 100)}%"></div></div></div>`
      }).join('')}</div>
    </div>
  </div>`
}

const bosKutu = m => `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-10 text-center text-on-surface-variant">${kacis(m)}</div>`

function excelAktar() {
  const ozet = sirketOzet()
  if (!ozet.length) { alert('Aktarılacak veri yok.'); return }
  const basliklar = ['Şirket', 'Poliçe Adedi', 'Beklenen Komisyon', 'İade Düşüşü', 'İptal Düşüşü', 'Gerçekleşen Komisyon', 'Oran %']
  const satirlar = ozet.map(r => [r.sirket, r.adet, Math.round(r.beklenen), Math.round(r.iade), Math.round(r.iptal), Math.round(r.gerceklesen), r.beklenen > 0 ? Math.round(r.gerceklesen / r.beklenen * 100) : 0])
  csvIndir('sigorta-komisyon-raporu', basliklar, satirlar)
}
