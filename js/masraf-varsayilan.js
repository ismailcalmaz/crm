// =====================================================================
// masraf-varsayilan.js — Masraf sabit tutarları CRUD (finans-yönetimli).
//   Yalnız Göksenil + Bahadır DÜZENLER (sql/53 mv_yaz strict + bayrak);
//   diğer yöneticiler SALT-OKUR. Taban satır = "Tüm kaynaklar" (alis_sekli NULL),
//   kaynak istisnası = belirli alış şekli. Fiyatlama + Araç Detayı masraf
//   girişleri bu tabloyu masraf_varsayilan() ile okur.
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, kacis, dbHata } from './veri.js'
import { mat, bosDurum, uyari } from './stitch-ui.js'

const KOK = () => document.getElementById('kok')
let DANISMAN = null, TANIM = {}, ROWS = []
let duzenId = null

const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
const tanimAd = (tip, kod) => (TANIM[tip] || []).find(t => t.kod === kod)?.ad || kod || ''
// Strict düzenleme yetkisi — sql/53 yonetebilir_masraf_varsayilan()'in istemci karşılığı
const duzenleyebilir = d => !!(d && (d.master_admin
  || (Array.isArray(d.yetkiler) && d.yetkiler.includes('masraf_varsayilan_yonet'))))

export async function masrafVarsayilanKur(d) {
  DANISMAN = d
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`
  const [{ data: tanimlar }, { data: rows, error }] = await Promise.all([
    supabase.from('tanimlar').select('tip,kod,ad').eq('aktif', true)
      .in('tip', ['MASRAF_TIPI', 'ALIS_SEKLI']).order('sira'),
    supabase.from('masraf_varsayilanlari')
      .select('id,masraf_tipi,alis_sekli,tutar,aktif,aciklama,updated_at').order('masraf_tipi'),
  ])
  if (error) { dbHata('masraf varsayilanlari', error); KOK().innerHTML = uyari('Okunamadı: ' + kacis(error.message)); return }
  TANIM = {}; for (const t of (tanimlar || [])) (TANIM[t.tip] = TANIM[t.tip] || []).push(t)
  ROWS = rows || []
  ciz()
}

function ciz() {
  const yaz = duzenleyebilir(DANISMAN)
  KOK().innerHTML = `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-3">
          <a href="fiyatlama.html" class="w-9 h-9 rounded-lg border border-outline-variant flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low">${mat('arrow_back', 'text-[18px]')}</a>
          <div>
            <h2 class="text-headline-sm font-bold text-on-surface flex items-center gap-2">${mat('price_change')} Masraf Varsayılanları</h2>
            <p class="text-body-sm text-on-surface-variant">Masraf tiplerinin sabit tutarları. Alış şekline özel istisna en özel kazanır; "Tüm kaynaklar" tabandır.</p>
          </div>
        </div>
      </div>

      ${yaz ? formHtml() : `<div class="text-body-sm text-on-surface-variant bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2">${mat('visibility', 'text-[16px]')} Salt-okuma — düzenleme yalnız yetkili finans kullanıcısında.</div>`}
      ${tabloHtml(yaz)}
    </div>`
  if (yaz) bagla()
}

function formHtml() {
  const duzen = duzenId ? ROWS.find(r => r.id === duzenId) : null
  const tipOps = (TANIM['MASRAF_TIPI'] || []).map(t =>
    `<option value="${kacis(t.kod)}" ${duzen?.masraf_tipi === t.kod ? 'selected' : ''}>${kacis(t.ad || t.kod)}</option>`).join('')
  const kaynakOps = `<option value="">Tüm kaynaklar (taban)</option>` + (TANIM['ALIS_SEKLI'] || []).map(t =>
    `<option value="${kacis(t.kod)}" ${duzen?.alis_sekli === t.kod ? 'selected' : ''}>${kacis(t.ad || t.kod)}</option>`).join('')
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4 flex flex-wrap items-end gap-2">
    ${duzen ? `<span class="w-full text-[11px] font-bold text-primary">DÜZENLENİYOR — ${kacis(tanimAd('MASRAF_TIPI', duzen.masraf_tipi))}</span>` : ''}
    <label class="flex flex-col gap-1 flex-1 min-w-[150px]"><span class="text-[10px] text-on-surface-variant">Masraf Tipi *</span>
      <select id="vTip" class="${INP}"><option value="">Seçiniz…</option>${tipOps}</select></label>
    <label class="flex flex-col gap-1 flex-1 min-w-[160px]"><span class="text-[10px] text-on-surface-variant">Kaynak (Alış Şekli)</span>
      <select id="vKaynak" class="${INP}">${kaynakOps}</select></label>
    <label class="flex flex-col gap-1 w-36"><span class="text-[10px] text-on-surface-variant">Tutar (₺) *</span>
      <input id="vTutar" type="number" inputmode="numeric" value="${duzen?.tutar ?? ''}" class="${INP}" /></label>
    <label class="flex flex-col gap-1 flex-[2] min-w-[160px]"><span class="text-[10px] text-on-surface-variant">Açıklama</span>
      <input id="vAcik" value="${duzen ? kacis(duzen.aciklama || '') : ''}" class="${INP}" /></label>
    <button id="vKaydet" class="bg-primary text-on-primary px-4 h-10 rounded-lg text-sm font-bold flex items-center gap-1 hover:opacity-90 shadow-sm">${mat(duzen ? 'save' : 'add', 'text-[18px]')} ${duzen ? 'Güncelle' : 'Ekle'}</button>
    ${duzen ? `<button id="vVazgec" class="px-3 h-10 rounded-lg border border-outline-variant text-on-surface-variant text-sm font-bold hover:bg-surface-container-low">Vazgeç</button>` : ''}
  </div>`
}

function tabloHtml(yaz) {
  if (!ROWS.length) return `<div class="p-6">${bosDurum('Henüz varsayılan tutar tanımlanmadı.', 'price_change')}</div>`
  const satir = r => `<tr class="border-b border-outline-variant/40 hover:bg-surface-container-low/50 ${r.aktif ? '' : 'opacity-50'}">
    <td class="px-3 py-2 text-body-sm font-semibold">${kacis(tanimAd('MASRAF_TIPI', r.masraf_tipi))}</td>
    <td class="px-3 py-2 text-body-sm">${r.alis_sekli ? kacis(tanimAd('ALIS_SEKLI', r.alis_sekli)) : '<span class="text-on-surface-variant italic">Tüm kaynaklar</span>'}</td>
    <td class="px-3 py-2 text-right text-body-sm font-bold whitespace-nowrap">${fmtPara(r.tutar)}</td>
    <td class="px-3 py-2 text-body-sm text-on-surface-variant">${kacis(r.aciklama || '')}</td>
    ${yaz ? `<td class="px-3 py-2 text-right whitespace-nowrap">
      <button data-duzen="${r.id}" class="w-7 h-7 rounded hover:bg-surface-container-high text-on-surface-variant" title="Düzelt">${mat('edit', 'text-[16px]')}</button>
      <button data-sil="${r.id}" class="w-7 h-7 rounded hover:bg-error/10 text-error" title="Sil">${mat('delete', 'text-[16px]')}</button></td>` : ''}
  </tr>`
  return `<div class="border border-outline-variant rounded-xl overflow-x-auto">
    <table class="w-full text-left border-collapse min-w-[560px]">
      <thead><tr class="text-[10px] uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
        <th class="px-3 py-2">Masraf Tipi</th><th class="px-3 py-2">Kaynak</th>
        <th class="px-3 py-2 text-right">Tutar</th><th class="px-3 py-2">Açıklama</th>${yaz ? '<th class="px-3 py-2"></th>' : ''}</tr></thead>
      <tbody>${ROWS.map(satir).join('')}</tbody>
    </table></div>`
}

function bagla() {
  document.getElementById('vKaydet')?.addEventListener('click', kaydet)
  document.getElementById('vVazgec')?.addEventListener('click', () => { duzenId = null; ciz() })
  document.querySelectorAll('button[data-duzen]').forEach(b =>
    b.addEventListener('click', () => { duzenId = b.dataset.duzen; ciz() }))
  document.querySelectorAll('button[data-sil]').forEach(b =>
    b.addEventListener('click', () => sil(b.dataset.sil)))
}

async function kaydet() {
  const el = id => document.getElementById(id)
  const tip = el('vTip').value
  const kaynak = el('vKaynak').value || null
  const tutar = Number(el('vTutar').value)
  const aciklama = el('vAcik').value.trim() || null
  if (!tip) return uyariGoster('Masraf tipi zorunlu.')
  if (!(tutar >= 0)) return uyariGoster('Geçerli tutar girin (0 veya üzeri).')

  const govde = { masraf_tipi: tip, alis_sekli: kaynak, tutar, aciklama, guncelleyen: DANISMAN?.id || null }
  if (duzenId) {
    const { data, error } = await supabase.from('masraf_varsayilanlari').update(govde).eq('id', duzenId).select('id')
    if (error) return kayitHata(error)
    if (!data?.length) return uyariGoster('Güncellenemedi: kayıt yok / yetki yok.')  // §5.1
    duzenId = null
  } else {
    const { data, error } = await supabase.from('masraf_varsayilanlari').insert(govde).select('id')
    if (error) return kayitHata(error)
    if (!data?.length) return uyariGoster('Eklenemedi (yetki?).')
  }
  await masrafVarsayilanKur(DANISMAN)
}

function kayitHata(error) {
  dbHata('varsayilan kaydet', error)
  // uq_masraf_varsayilan ihlali → aynı tip+kaynak zaten var
  if ((error.code === '23505') || /uq_masraf_varsayilan|duplicate/i.test(error.message || ''))
    return uyariGoster('Bu masraf tipi + kaynak için zaten bir tutar var. Mevcut satırı düzeltin.')
  uyariGoster('Kaydedilemedi (yetki?): ' + error.message)
}

async function sil(id) {
  if (!confirm('Bu varsayılan tutar silinsin mi?')) return
  const { data, error } = await supabase.from('masraf_varsayilanlari').delete().eq('id', id).select('id')
  if (error) { dbHata('varsayilan sil', error); return uyariGoster('Silinemedi (yetki?): ' + error.message) }
  if (!data?.length) return uyariGoster('Silinemedi: kayıt yok / yetki yok.')
  if (duzenId === id) duzenId = null
  await masrafVarsayilanKur(DANISMAN)
}

function uyariGoster(msg) {
  let el = document.getElementById('mvUyari')
  if (!el) { el = document.createElement('div'); el.id = 'mvUyari'; el.className = 'fixed bottom-4 right-4 z-50'; document.body.appendChild(el) }
  el.innerHTML = `<div class="bg-error text-on-error px-4 py-2 rounded-lg shadow-lg text-sm font-semibold">${kacis(msg)}</div>`
  setTimeout(() => { el.innerHTML = '' }, 4000)
}
