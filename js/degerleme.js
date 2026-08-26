// =====================================================================
// degerleme.js — Akıllı Fiyat Analiz Merkezi (SİTE, salt-okunur)
//   Web "aracımı değerlet" talepleri + robotun arabam.com sonuçları:
//   TR / İzmir / Stok fiyat karşılaştırması. Uydurma tahmin yok.
// =====================================================================
import { degerlemeListesi } from './site-client.js'
import { fmtPara, fmtTarihKisa, kacis } from './veri.js'
import { mat, pill, avatar } from './stitch-ui.js'

const DURUM_SINIF = { bekliyor: 'aktif', isleniyor: 'aktif', tamamlandi: 'basari', hata: 'hata' }
const DURUM_ETIKET = { bekliyor: 'Bekliyor', isleniyor: 'İşleniyor', tamamlandi: 'Tamamlandı', hata: 'Hata' }
let _veri = [], filtre = 'HEPSI', arama = '', seciliId = null

export async function degerlemeKur() {
  document.getElementById('yenile')?.addEventListener('click', yukle)
  document.getElementById('filtreler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return; filtre = b.dataset.f; seciliId = null; ciz()
  })
  document.getElementById('degerAra')?.addEventListener('input', e => { arama = e.target.value.trim().toLocaleLowerCase('tr'); ciz() })
  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('liste')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  // service_role köprüsü (degerleme-listesi) — SITE anon SELECT yasak, bkz. site-client.js
  _veri = await degerlemeListesi()
  ciz()
}

const aracAdi = r => [r.marka, r.model, r.yil].filter(Boolean).join(' ') || '—'

function ciz() {
  kpiCiz(); filtreCiz()
  const hedef = document.getElementById('liste')
  let v = _veri
  if (filtre !== 'HEPSI') v = v.filter(r => (r.durum || 'bekliyor') === filtre)
  if (arama) v = v.filter(r => [r.ad_soyad, r.telefon, r.marka, r.model].filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(arama))

  if (!v.length) { hedef.innerHTML = `<div class="flex flex-col items-center justify-center text-center py-14 text-on-surface-variant">${mat('query_stats', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">Bu filtrede değerleme yok.</p></div>`; panelVarsayilan(v); return }
  hedef.innerHTML = v.map(kart).join('')
  hedef.querySelectorAll('[data-row]').forEach(el => el.addEventListener('click', () => detayAc(el.dataset.row)))
  panelVarsayilan(v)
}

function kart(r) {
  const durum = r.durum || 'bekliyor'
  const aktif = seciliId === r.id
  const km = r.km ? Number(r.km).toLocaleString('tr-TR') + ' km' : '—'
  const tr = r.sonuc_tr_ort ? fmtPara(r.sonuc_tr_ort) : (durum === 'tamamlandi' ? 'sonuç yok' : '—')
  return `<div data-row="${r.id}" class="group cursor-pointer bg-white rounded-xl border border-outline-variant/70 ${aktif ? 'ring-2 ring-primary/30 bg-primary/5' : 'hover:shadow-md'} transition-all p-3 flex items-center gap-3">
    ${avatar(r.ad_soyad, 'w-9 h-9')}
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between gap-2">
        <p class="font-bold text-on-surface truncate">${kacis(aracAdi(r))}</p>
        <span class="shrink-0">${pill(DURUM_ETIKET[durum], DURUM_SINIF[durum] || 'notr')}</span>
      </div>
      <div class="flex items-center gap-2 mt-1 text-[12px] text-on-surface-variant flex-wrap">
        <span class="inline-flex items-center gap-1">${mat('person', 'text-[13px]')} ${kacis(r.ad_soyad) || '—'}</span>
        <span class="text-outline-variant">·</span><span>${kacis(km)}</span>
        ${r.sonuc_tr_ort ? `<span class="text-outline-variant">·</span><span class="font-semibold text-primary">TR ort: ${kacis(tr)}</span>` : ''}
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
  const p = document.getElementById('degerDetay')
  p.classList.remove('hidden')
  p.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">${mat('insights', 'text-5xl opacity-30')}<p class="mt-3 font-semibold text-on-surface">Bir değerleme seçin</p><p class="text-label-sm mt-1 max-w-[220px]">Türkiye / İzmir / stok fiyat karşılaştırması burada açılır.</p></div>`
}

// Yatay karşılaştırma çubuğu — TR / İzmir / Stok ortalamaları
function kiyasBar(etiket, deger, max, cls) {
  if (!deger) return ''
  const w = Math.max(4, Math.round(deger / max * 100))
  return `<div class="mb-2.5">
    <div class="flex justify-between text-label-sm mb-1"><span class="text-on-surface-variant">${etiket}</span><span class="font-bold text-on-surface">${fmtPara(deger)}</span></div>
    <div class="h-2.5 rounded-full bg-surface-container overflow-hidden"><div class="h-full ${cls}" style="width:${w}%"></div></div>
  </div>`
}

function detayAc(id, sessiz) {
  const r = _veri.find(x => x.id === id); if (!r) return
  seciliId = id
  const panel = document.getElementById('degerDetay')
  const katman = document.getElementById('degerDetayKatman')
  const durum = r.durum || 'bekliyor'
  const km = r.km ? Number(r.km).toLocaleString('tr-TR') + ' km' : '—'
  const stokOrt = (r.sonuc_stok_min && r.sonuc_stok_max) ? (Number(r.sonuc_stok_min) + Number(r.sonuc_stok_max)) / 2 : null
  const degerler = [r.sonuc_tr_ort, r.sonuc_izmir_ort, stokOrt].map(Number).filter(v => v > 0)
  const max = degerler.length ? Math.max(...degerler) : 1

  let govde = ''
  if (durum === 'tamamlandi') {
    const kiyas = kiyasBar('Türkiye ortalaması', Number(r.sonuc_tr_ort) || 0, max, 'bg-secondary')
      + kiyasBar('İzmir ortalaması', Number(r.sonuc_izmir_ort) || 0, max, 'bg-amber-400')
      + kiyasBar('Bizim stok (ort.)', stokOrt || 0, max, 'bg-primary')
    const rozet = (etiket, ort, min, mx, adet) => (ort || adet) ? `
      <div class="bg-surface-container-low rounded-lg p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p>
        <p class="text-title-lg font-black text-on-surface mt-0.5">${ort ? fmtPara(ort) : '—'}</p>
        <p class="text-[11px] text-on-surface-variant">${(min || mx) ? fmtPara(min) + ' – ' + fmtPara(mx) : ''}${adet ? ` · ${adet} ilan` : ''}</p>
      </div>` : ''
    govde = `
      <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-3">Piyasa Karşılaştırması</p>
      ${kiyas || '<p class="text-body-md text-on-surface-variant">Karşılaştırılacak fiyat verisi yok.</p>'}
      <div class="grid grid-cols-2 gap-2 mt-4">
        ${rozet('Türkiye', r.sonuc_tr_ort, r.sonuc_tr_min, r.sonuc_tr_max, r.sonuc_tr_adet)}
        ${rozet('İzmir', r.sonuc_izmir_ort, r.sonuc_izmir_min, r.sonuc_izmir_max, r.sonuc_izmir_adet)}
      </div>
      ${r.sonuc_stok_adet ? `<div class="mt-2 bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-center gap-2 text-primary text-label-md font-bold">${mat('directions_car', 'text-[18px]')} Stokta ${r.sonuc_stok_adet} benzer araç · ${fmtPara(r.sonuc_stok_min)} – ${fmtPara(r.sonuc_stok_max)}</div>` : ''}`
  } else if (durum === 'hata') {
    govde = `<div class="bg-error/5 border border-error/20 rounded-lg p-4 text-error text-body-md flex items-start gap-2">${mat('error', 'text-[20px]')} <span>${kacis(r.sonuc_hata) || 'Değerleme yapılamadı.'}</span></div>`
  } else {
    govde = `<div class="text-center py-10 text-on-surface-variant">${mat('hourglass_top', 'text-4xl opacity-40')}<p class="mt-2 text-body-md">Robot değerlemeyi yapıyor…</p></div>`
  }

  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant">
      <div class="flex justify-between items-start mb-2">
        <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate">${kacis(aracAdi(r))}</h3>
          <p class="text-label-md text-on-surface-variant">${kacis([r.paket, km, r.yakit, r.vites].filter(Boolean).join(' · ')) || '—'}</p></div>
        <button id="degerKapat" class="p-1.5 hover:bg-surface-container-high rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex items-center gap-2">${pill(DURUM_ETIKET[durum], DURUM_SINIF[durum] || 'notr')}<span class="text-label-sm text-on-surface-variant">${fmtTarihKisa(r.eklendi)}</span></div>
    </div>
    <div class="flex-1 overflow-y-auto p-lg">${govde}</div>
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest text-label-sm text-on-surface-variant flex items-center gap-2">
      ${mat('info', 'text-[16px]')} ${kacis(r.ad_soyad) || 'Müşteri'} · ${kacis(r.telefon || '')}
    </div>`

  panel.classList.remove('hidden')
  if (window.innerWidth < 1280) {
    panel.classList.add('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none')
    katman.classList.remove('hidden')
  }
  const kapat = () => { panel.classList.add('hidden'); panel.classList.remove('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[92vw]', 'max-w-[420px]', 'rounded-none'); katman.classList.add('hidden'); seciliId = null; ciz() }
  document.getElementById('degerKapat').addEventListener('click', kapat)
  katman.onclick = kapat
  if (!sessiz) ciz()
}

function kpiCiz() {
  const say = d => _veri.filter(r => (r.durum || 'bekliyor') === d).length
  const tamamlanan = _veri.filter(r => r.durum === 'tamamlandi')
  const trList = tamamlanan.map(r => Number(r.sonuc_tr_ort)).filter(v => v > 0)
  const ortTr = trList.length ? Math.round(trList.reduce((s, v) => s + v, 0) / trList.length) : null
  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight truncate">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('kpi').innerHTML =
    kart('query_stats', 'bg-primary-fixed text-primary', 'Toplam Değerleme', _veri.length, 'talep') +
    kart('check_circle', 'bg-green-100 text-green-700', 'Tamamlanan', tamamlanan.length, 'sonuç hazır') +
    kart('hourglass_top', 'bg-amber-100 text-amber-700', 'Bekleyen', say('bekliyor') + say('isleniyor'), 'robot işliyor') +
    kart('trending_up', 'bg-secondary/10 text-secondary', 'Ort. TR Fiyat', ortTr ? fmtPara(ortTr) : '—', 'tamamlananlar')
}

function filtreCiz() {
  const say = k => k === 'HEPSI' ? _veri.length : _veri.filter(r => (r.durum || 'bekliyor') === k).length
  const ops = [['HEPSI', 'Tümü'], ['tamamlandi', 'Tamamlandı'], ['bekliyor', 'Bekliyor'], ['isleniyor', 'İşleniyor'], ['hata', 'Hata']]
  document.getElementById('filtreler').innerHTML = ops.map(([k, l]) => {
    const a = k === filtre
    return `<button data-f="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${say(k)})</button>`
  }).join('')
}
