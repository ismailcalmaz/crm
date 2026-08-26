// =====================================================================
// sigorta.js — Sigorta Paneli (tek dashboard / komuta merkezi)
//   KPI + Bugün Yapılacaklar (v_bugun_yapilacaklar) + Vize / Sahipsiz /
//   Şirket Araçları / Dikkat panelleri + global arama (sigorta_ara RPC).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, bugunISO, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'

let benim = null

export async function sigortaPanelKur(danisman) {
  benim = danisman
  await Promise.all([kpiCiz(), bugunCiz(), vizeCiz(), sahipsizCiz(), sirketCiz(), dikkatCiz()])
  aramaKur()
}

async function kpiCiz() {
  const ayIlk = new Date(); ayIlk.setDate(1); const ayIlkISO = ayIlk.toISOString().slice(0, 10)
  const bugun = bugunISO()
  const [kom, bekIade, bugKes, bugIade, acikF] = await Promise.all([
    supabase.from('policeler').select('komisyon_tutari, durum').gte('baslangic', ayIlkISO).limit(2000),
    supabase.from('yapbozlar').select('*', { count: 'exact', head: true }).eq('durum', 'SATILDI_IADE_BEKLIYOR'),
    supabase.from('policeler').select('*', { count: 'exact', head: true }).gte('created_at', bugun + 'T00:00:00'),
    supabase.from('police_hareketleri').select('*', { count: 'exact', head: true }).eq('tip', 'IADE').eq('islem_tarihi', bugun),
    supabase.from('sigorta_firsatlari').select('*', { count: 'exact', head: true }).in('durum', ['TEKLIF_BEKLIYOR', 'TEKLIF_VERILDI']),
  ])
  const komToplam = (kom.data || []).filter(p => p.durum !== 'IPTAL').reduce((t, p) => t + (Number(p.komisyon_tutari) || 0), 0)
  const kart = (l, v, ik, renk, buyuk = false) => `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg kart-hover ${buyuk ? 'col-span-2 lg:col-span-1' : ''}">
    <div class="flex items-center justify-between text-on-surface-variant text-label-md"><span>${l}</span>${mat(ik, renk + ' text-[20px]')}</div>
    <div class="text-headline-lg text-on-surface mt-1">${v}</div></div>`
  document.getElementById('pnKpi').innerHTML =
    kart('Bu Ay Komisyon', fmtPara(Math.round(komToplam)), 'payments', 'text-primary', true) +
    kart('Bekleyen İade', bekIade.count || 0, 'undo', 'text-amber-600') +
    kart('Bugün Kesilen', bugKes.count || 0, 'description', 'text-secondary') +
    kart('Bugün İade', bugIade.count || 0, 'task_alt', 'text-tertiary') +
    kart('Açık Fırsat', acikF.count || 0, 'handshake', 'text-primary')
}

const BUGUN_TIP = {
  IADE: ['İADE', 'bg-amber-100 text-amber-800', 'sigorta-yapboz.html'],
  YENILEME: ['YENİLEME', 'bg-blue-100 text-blue-800', 'sigorta-yenileme.html'],
  FIRSAT: ['TEKLİF', 'bg-tertiary-container text-on-tertiary-container', 'sigorta-firsat.html'],
  ON_KAYIT: ['ÖN KAYIT', 'bg-purple-100 text-purple-800', 'sigorta-firsat.html'],
  VIZE: ['VİZE', 'bg-red-100 text-red-800', ''],
}
async function bugunCiz() {
  const kok = document.getElementById('pnBugun')
  const { data, error } = await supabase.from('v_bugun_yapilacaklar').select('*').order('oncelik', { ascending: false }).limit(60)
  if (error) { kok.innerHTML = notYok('Yüklenemedi: ' + error.message); return }
  const rows = data || []
  document.getElementById('pnBugunSayi').textContent = rows.length
  if (!rows.length) { kok.innerHTML = `<div class="text-center py-8 text-on-surface-variant">${mat('celebration', 'text-3xl text-secondary')}<p class="mt-2 text-body-md">Bugün bekleyen iş yok. 🎉</p></div>`; return }
  kok.innerHTML = `<div class="divide-y divide-outline-variant">${rows.map(r => {
    const [et, sinif, href] = BUGUN_TIP[r.tip] || [r.tip, 'bg-surface-container text-on-surface-variant', '']
    const inner = `<div class="flex items-center gap-3 py-2.5">
      <span class="text-[10px] font-bold px-2 py-0.5 rounded ${sinif} shrink-0 w-20 text-center">${et}</span>
      <span class="font-bold font-mono text-on-surface shrink-0">${kacis(r.baslik || '—')}</span>
      <span class="text-body-md text-on-surface-variant truncate flex-1">${kacis(r.aciklama || '')}</span>
      ${href ? mat('chevron_right', 'text-on-surface-variant shrink-0') : ''}
    </div>`
    return href ? `<a href="${href}" class="block hover:bg-surface-container-low -mx-2 px-2 rounded-lg">${inner}</a>` : inner
  }).join('')}</div>`
}

async function vizeCiz() {
  const { data } = await supabase.from('v_vize_uyarilari').select('*').order('kalan_gun', { ascending: true })
  const rows = data || []
  document.getElementById('pnVize').innerHTML = panelBaslik('Vize Uyarıları', 'event_busy', 'text-error', rows.length) +
    (rows.length ? tabloMini(['Plaka', 'Vize', 'Kalan', 'Trafik'], rows.map(r => [
      `<span class="font-mono font-bold">${kacis(r.plaka)}</span>`,
      tarih(r.vize_tarihi),
      `<span class="font-bold ${r.kalan_gun <= 3 ? 'text-error' : 'text-amber-600'}">${r.kalan_gun} gün</span>`,
      r.trafik_gecerli ? mat('check_circle', 'text-secondary text-[18px]') : mat('cancel', 'text-error text-[18px]'),
    ])) : notYok('Vize uyarısı yok.'))
}

async function sahipsizCiz() {
  const { data } = await supabase.from('v_sahipsiz_satislar').select('*').order('created_at', { ascending: false })
  const rows = data || []
  document.getElementById('pnSahipsiz').innerHTML = panelBaslik('Sahipsiz Satışlar', 'report', 'text-tertiary', rows.length) +
    (rows.length ? tabloMini(['Plaka', 'Müşteri', 'Zaman'], rows.map(r => [
      `<span class="font-mono font-bold">${kacis(r.plaka || '—')}</span>`, kacis(r.musteri_adi || '—'), tarih((r.created_at || '').slice(0, 10)),
    ])) : notYok('Sahipsiz satış tespit edilmedi.'))
}

// ⚠️ KAPSAM DEĞİŞTİ (sql/166). Eskiden yalnız "bitişe ≤30 gün kalanlar"
//    listeleniyordu ve POLİÇESİ HİÇ OLMAYAN araç görünmüyordu — oysa
//    sigortasız şirket aracı en kritik olanı. Artık TÜM şirket araçları
//    gelir; poliçesizler EN ÜSTTE ve kırmızı.
// ⚠️ Liste artık CRM durumundan (stok_araclar.durum='KULLANIMDA') türüyor;
//    bildirim motoru da (BK-46) aynı anahtarı kullanıyor. Eskiden panel
//    `sigorta_araclari.kaynak` alanına bakıyordu ve o alan hiç
//    doldurulmadığı için panel DAİMA BOŞTU.
async function sirketCiz() {
  const { data, error } = await supabase.from('v_sirket_araci_bitisleri').select('*')
    .order('police_var', { ascending: true })          // poliçesizler önce
    .order('kalan_gun', { ascending: true, nullsFirst: true })
  if (error) dbHata('şirket araçları', error)
  const rows = data || []
  const satir = r => {
    if (!r.police_var) return [
      `<span class="font-mono font-bold">${kacis(r.plaka)}</span>`,
      `<span class="text-error font-bold">POLİÇE YOK</span>`, '—',
      `<span class="text-error font-bold">acil</span>`,
      kacis(r.tahsis_edilen || '—'),
    ]
    const k = Number(r.kalan_gun)
    const renk = k < 0 ? 'text-error' : k <= 7 ? 'text-error' : k <= 30 ? 'text-amber-700' : ''
    return [
      `<span class="font-mono font-bold">${kacis(r.plaka)}</span>`, kacis(r.tur || '—'), tarih(r.bitis),
      `<span class="font-bold ${renk}">${k < 0 ? Math.abs(k) + ' gün GEÇTİ' : k + ' gün'}</span>`,
      kacis(r.tahsis_edilen || '—'),
    ]
  }
  document.getElementById('pnSirket').innerHTML =
    panelBaslik('Şirket Araçları', 'local_shipping', 'text-primary', rows.length) +
    (rows.length ? tabloMini(['Plaka', 'Tür', 'Bitiş', 'Kalan', 'Tahsis'], rows.map(satir))
                 : notYok('Şirket kullanımında araç yok.'))
}

async function dikkatCiz() {
  const { data } = await supabase.from('dikkat_kayitlari').select('*').eq('kontrol_edildi', false).order('created_at', { ascending: false }).limit(6)
  const rows = data || []
  document.getElementById('pnDikkat').innerHTML =
    `<div class="flex items-center justify-between mb-3"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat('flag', 'text-[22px] text-error')} Dikkat Gerektiren ${rows.length ? `<span class="text-[11px] font-bold bg-error text-white px-2 py-0.5 rounded-full">${rows.length}</span>` : ''}</h3><a href="sigorta-dikkat.html" class="text-primary text-label-md font-bold hover:underline">Tümü</a></div>` +
    (rows.length ? `<div class="space-y-2">${rows.map(r => `<a href="sigorta-dikkat.html" class="block bg-surface-container-low rounded-lg px-3 py-2 hover:bg-surface-container">
      <div class="flex items-center justify-between"><span class="text-body-md font-semibold text-on-surface">${kacis(dikkatTipEt(r.tip))}</span>${r.tutar_etkisi != null ? `<span class="text-label-md font-bold ${Number(r.tutar_etkisi) < 0 ? 'text-error' : 'text-secondary'}">${fmtPara(r.tutar_etkisi)}</span>` : ''}</div>
      <div class="text-[12px] text-on-surface-variant truncate">${kacis(r.aciklama)}</div></a>`).join('')}</div>` : notYok('Kontrol bekleyen kayıt yok.'))
}

// --- Arama (sigorta_ara RPC) ---
function aramaKur() {
  const inp = document.getElementById('pnAra'); const kutu = document.getElementById('pnAraSonuc')
  let z
  inp.addEventListener('input', () => {
    clearTimeout(z); const q = inp.value.trim()
    if (q.length < 2) { kutu.classList.add('hidden'); return }
    z = setTimeout(() => ara(q, kutu), 250)
  })
  document.addEventListener('click', e => { if (!e.target.closest('#pnAra') && !e.target.closest('#pnAraSonuc')) kutu.classList.add('hidden') })
}
const ARA_TIP = { ARAC: ['directions_car', 'Araç'], MUSTERI: ['person', 'Müşteri'], POLICE: ['description', 'Poliçe'] }
async function ara(q, kutu) {
  kutu.classList.remove('hidden')
  kutu.innerHTML = `<p class="p-3 text-center text-on-surface-variant text-label-md">Aranıyor…</p>`
  const { data, error } = await supabase.rpc('sigorta_ara', { q })
  if (error) { kutu.innerHTML = `<p class="p-3 text-error text-label-md">${kacis(error.message)}</p>`; return }
  const rows = data || []
  if (!rows.length) { kutu.innerHTML = `<p class="p-4 text-center text-on-surface-variant text-label-md">"${kacis(q)}" için sonuç yok.</p>`; return }
  kutu.innerHTML = rows.map(r => {
    const [ik, et] = ARA_TIP[r.tip] || ['search', r.tip]
    return `<div class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-container-low border-b border-outline-variant last:border-0">
      <span class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant shrink-0">${mat(ik, 'text-[18px]')}</span>
      <div class="min-w-0 flex-1"><div class="font-semibold text-on-surface truncate">${kacis(r.baslik || '—')}</div><div class="text-[11px] text-on-surface-variant truncate">${kacis(r.aciklama || '')}</div></div>
      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant shrink-0">${et}</span></div>`
  }).join('')
}

// --- yardımcılar ---
const tarih = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : '—'
const notYok = m => `<div class="text-center py-6 text-on-surface-variant text-body-md">${kacis(m)}</div>`
const panelBaslik = (l, ik, renk, n) => `<div class="flex items-center justify-between mb-3"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat(ik, 'text-[22px] ' + renk)} ${l}</h3>${n ? `<span class="text-[11px] font-bold bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full">${n}</span>` : ''}</div>`
function tabloMini(basliklar, satirlar) {
  return `<div class="overflow-x-auto"><table class="w-full text-left text-body-md"><thead><tr>${basliklar.map(h => `<th class="pb-2 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${h}</th>`).join('')}</tr></thead>
    <tbody class="divide-y divide-outline-variant">${satirlar.map(s => `<tr>${s.map(c => `<td class="py-2 pr-3">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}
const DIKKAT_TIP = { IADE_SAPMASI: 'İade Sapması', KOMISYON_MANUEL: 'Komisyon Manuel', VERGI_MANUEL: 'Vergi Manuel', GEC_TUTAR_DEGISIKLIGI: 'Geç Tutar Değişikliği', IADE_GECIKTI: 'İade Gecikti' }
const dikkatTipEt = t => DIKKAT_TIP[t] || t
export { DIKKAT_TIP }
