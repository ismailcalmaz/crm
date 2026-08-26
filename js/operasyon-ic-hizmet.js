// =====================================================================
// operasyon-ic-hizmet.js — Pasta Cila / Kuaför iş sayfası çekirdeği (F7-a)
//
//   Göksenil kararı: "Pasta cila personelinin gireceği bilgiler AYRI SAYFADA,
//   sadece o veri girişi yapabilecek, sayfayı da sadece o görecek. Kuaför
//   personeli aynı senaryoda. Operasyon müdürü kayıtları görebilir."
//
//   TEK dosya iki sayfayı besler (operasyon-pasta-cila / operasyon-kuafor);
//   fark yalnız işlem türü kodudur. Sayfa görünürlüğü yetki.js + master
//   admin'in kişiye verdiği izinle, YAZMA yetkisi sql/93 RLS ile korunur.
//
//   PARA YOK: personel prim tutarını görmez; burada yalnız "yapıldı" kaydı
//   tutulur, prim tarifesini finans ayrı belirler (F7-b).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, trBuyuk, buyuk, dbHata, fmtTarihKisa, danismanMap, danismanAdi } from './veri.js'
import { mat, bosDurum, uyari } from './stitch-ui.js'
import { mudurMu } from './yetki.js'

const KOK = () => document.getElementById('kok')
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
const B = v => kacis(buyuk(v ?? ''))

let BEN = null, TUR = null, TUR_AD = '', MUDUR = false, DMAP = {}
let KAYITLAR = [], ARAMA = ''

// Sayfa girişi — kod: 'PASTA_CILA' | 'KUAFOR'
export async function icHizmetKur(d, kod, baslik) {
  BEN = d; TUR = kod; TUR_AD = baslik
  MUDUR = mudurMu(d, 'operasyon')
  DMAP = await danismanMap()
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`
  await yukle()
}

async function yukle() {
  // Müdür HERKESİN kaydını görür; personel yalnız kendi yaptıklarını.
  let q = supabase.from('ic_hizmetler')
    .select('id, arac_id, islem_turu, personel_id, durum, notu, created_at, stok_araclar(plaka, marka, model, yil, durum)')
    .eq('islem_turu', TUR).order('created_at', { ascending: false }).limit(200)
  if (!MUDUR) q = q.eq('personel_id', BEN.id)
  const { data, error } = await q
  if (error) { dbHata('ic_hizmetler', error); KOK().innerHTML = uyari('Kayıtlar okunamadı: ' + kacis(error.message)); return }
  KAYITLAR = data || []
  ciz()
}

function ay(t) { return new Date(t).toISOString().slice(0, 7) }

function ciz() {
  const buAy = ay(new Date())
  const benimAy = KAYITLAR.filter(k => k.personel_id === BEN.id && ay(k.created_at) === buAy).length
  const benimToplam = KAYITLAR.filter(k => k.personel_id === BEN.id).length
  const tumAy = KAYITLAR.filter(k => ay(k.created_at) === buAy).length

  const kpi = (et, deger, alt, ik, renk) => `
    <div class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${et}</p>
        <p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p>
        <p class="text-[11px] text-on-surface-variant">${alt}</p></div></div>`

  const suz = KAYITLAR.filter(k => {
    if (!ARAMA) return true
    const a = k.stok_araclar || {}
    return trBuyuk([a.plaka, a.marka, a.model].filter(Boolean).join(' ')).includes(ARAMA)
  })

  const satir = k => {
    const a = k.stok_araclar || {}
    const benimMi = k.personel_id === BEN.id
    return `<tr class="border-b border-outline-variant/40">
      <td class="px-3 py-2.5"><b class="text-primary">${B(a.plaka) || '—'}</b><br>
        <span class="text-[11px] text-on-surface-variant">${a.yil ? a.yil + ' ' : ''}${B(a.marka)} ${B(a.model)}</span></td>
      ${MUDUR ? `<td class="px-3 py-2.5 text-body-sm">${B(danismanAdi(DMAP, k.personel_id)) || '—'}</td>` : ''}
      <td class="px-3 py-2.5 text-body-sm text-on-surface-variant">${kacis(k.notu || '—')}</td>
      <td class="px-3 py-2.5 text-body-sm whitespace-nowrap">${fmtTarihKisa(k.created_at)}</td>
      <td class="px-3 py-2.5 text-right">${(benimMi || MUDUR)
        ? `<button data-sil="${k.id}" class="w-8 h-8 rounded-lg hover:bg-error/10 text-error" title="Kaydı geri al">${mat('undo', 'text-[16px]')}</button>` : ''}</td>
    </tr>`
  }

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 md:mb-6 flex-wrap">
      <div><h2 class="text-headline-md text-primary font-bold">${kacis(TUR_AD)}</h2>
        <p class="text-body-md text-on-surface-variant">${MUDUR ? 'Tüm personelin kayıtları' : 'Yaptığın işleri buradan işaretle'}</p></div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-6">
      ${kpi('Bu Ay (senin)', benimAy, 'işlem', 'event_available', 'bg-primary-fixed text-primary')}
      ${kpi('Toplam (senin)', benimToplam, 'işlem', 'done_all', 'bg-green-100 text-green-700')}
      ${MUDUR ? kpi('Bu Ay (tüm ekip)', tumAy, 'işlem', 'groups', 'bg-amber-100 text-amber-700') : ''}
    </div>

    <!-- Araç seç + işaretle -->
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4 mb-4">
      <h3 class="font-bold text-on-surface flex items-center gap-2 mb-3">${mat('add_task', 'text-[20px] text-primary')} ${kacis(TUR_AD)} Yaptığım Aracı İşaretle</h3>
      <div class="flex flex-wrap items-end gap-2">
        <div class="flex-1 min-w-[240px]">
          <label class="text-[11px] font-bold text-on-surface-variant uppercase">Araç (plaka ile ara)</label>
          <input id="ihArac" placeholder="Plaka yaz…" autocomplete="off" class="${INP} mt-1" />
          <div id="ihSonuc" class="mt-1"></div>
        </div>
        <div class="flex-1 min-w-[200px]">
          <label class="text-[11px] font-bold text-on-surface-variant uppercase">Not (opsiyonel)</label>
          <input id="ihNot" placeholder="ör. ağır kirli, iki kez uygulandı" class="${INP} mt-1" />
        </div>
        <button id="ihKaydet" disabled class="px-5 h-10 rounded-lg bg-surface-container-high text-outline text-sm font-bold cursor-not-allowed flex items-center gap-1.5">${mat('check', 'text-[18px]')} İşaretle</button>
      </div>
      <div id="ihDurum" class="text-label-md mt-2"></div>
      <p class="text-[11px] text-on-surface-variant mt-2">Bir araca aynı iş <b>bir kez</b> işaretlenebilir. Yanlışlıkla işaretlediysen listedeki geri al düğmesini kullan.</p>
    </div>

    <!-- Kayıtlar -->
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-hidden">
      <div class="p-4 border-b border-outline-variant flex items-center justify-between gap-3 flex-wrap">
        <h3 class="font-bold text-on-surface flex items-center gap-2">${mat('history', 'text-[20px] text-primary')} Kayıtlar <span class="text-on-surface-variant font-normal">(${suz.length})</span></h3>
        <input id="ihAra" value="${kacis(ARAMA)}" placeholder="Plaka / marka ara…" class="${INP} w-56" />
      </div>
      ${suz.length ? `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
        <thead><tr class="bg-surface-container text-on-surface-variant text-label-xs uppercase">
          <th class="px-3 py-2">Araç</th>${MUDUR ? '<th class="px-3 py-2">Personel</th>' : ''}
          <th class="px-3 py-2">Not</th><th class="px-3 py-2">Tarih</th><th class="px-3 py-2"></th>
        </tr></thead><tbody>${suz.map(satir).join('')}</tbody></table></div>`
        : `<div class="p-6">${bosDurum('Kayıt yok.', 'inbox')}</div>`}
    </div>`

  bagla()
}

let secilenArac = null, aramaZaman
function bagla() {
  const inp = document.getElementById('ihArac')
  inp?.addEventListener('input', e => {
    clearTimeout(aramaZaman)
    secilenArac = null; butonDurum()
    const q = e.target.value.trim()
    if (q.length < 2) { document.getElementById('ihSonuc').innerHTML = ''; return }
    aramaZaman = setTimeout(() => aracAra(q), 250)
  })
  document.getElementById('ihKaydet')?.addEventListener('click', kaydet)
  document.getElementById('ihAra')?.addEventListener('input', e => {
    ARAMA = trBuyuk(e.target.value.trim())
    const p = e.target.selectionStart
    ciz()
    const y = document.getElementById('ihAra'); if (y) { y.focus(); try { y.setSelectionRange(p, p) } catch (_) {} }
  })
  document.querySelectorAll('[data-sil]').forEach(b => b.addEventListener('click', () => geriAl(b.dataset.sil)))
}

function butonDurum() {
  const b = document.getElementById('ihKaydet'); if (!b) return
  const aktif = !!secilenArac
  b.disabled = !aktif
  b.className = `px-5 h-10 rounded-lg text-sm font-bold flex items-center gap-1.5 ${aktif
    ? 'bg-primary text-on-primary hover:opacity-90' : 'bg-surface-container-high text-outline cursor-not-allowed'}`
}

async function aracAra(q) {
  // Operasyon/hazırlık hattındaki araçlar önce gelsin; teslim edilen gizlensin
  const { data, error } = await supabase.from('stok_araclar')
    .select('id, plaka, marka, model, yil, durum')
    .ilike('plaka', `%${q}%`).neq('durum', 'TESLIM_EDILDI').limit(8)
  if (error) { dbHata('araç ara', error); return }
  const kutu = document.getElementById('ihSonuc')
  kutu.innerHTML = (data || []).length
    ? data.map(a => `<button data-arac="${a.id}" class="ih-sec w-full text-left px-3 py-2 rounded-lg hover:bg-primary/5 border border-outline-variant/50 mb-1 flex items-center gap-2">
        <b class="text-primary">${B(a.plaka)}</b>
        <span class="text-body-sm text-on-surface-variant">${a.yil ? a.yil + ' ' : ''}${B(a.marka)} ${B(a.model)}</span></button>`).join('')
    : '<div class="text-[11px] text-on-surface-variant px-2 py-1">Araç bulunamadı.</div>'
  kutu.querySelectorAll('.ih-sec').forEach(b => b.addEventListener('click', () => {
    secilenArac = data.find(x => x.id === b.dataset.arac)
    document.getElementById('ihArac').value = (secilenArac?.plaka || '').toLocaleUpperCase('tr')
    kutu.innerHTML = ''
    butonDurum()
  }))
}

function durum(msg, hata = false) {
  const el = document.getElementById('ihDurum'); if (!el) return
  el.textContent = msg
  el.className = 'text-label-md mt-2 font-bold ' + (hata ? 'text-error' : 'text-secondary')
}

async function kaydet() {
  if (!secilenArac) return
  const notu = (document.getElementById('ihNot').value || '').trim() || null
  const btn = document.getElementById('ihKaydet'); btn.disabled = true
  const { error } = await supabase.from('ic_hizmetler').insert({
    arac_id: secilenArac.id, islem_turu: TUR, personel_id: BEN.id, durum: 'TAMAMLANDI', notu,
  })
  if (error) {
    dbHata('ic_hizmet ekle', error)
    // uq_ic_hizmet_arac_tur → aynı araca aynı iş ikinci kez yazılamaz
    durum(error.code === '23505'
      ? 'Bu araca zaten bu iş işaretlenmiş — ikinci kez eklenemez.'
      : 'Kaydedilemedi: ' + error.message, true)
    butonDurum(); return
  }
  document.getElementById('ihArac').value = ''
  document.getElementById('ihNot').value = ''
  secilenArac = null
  await yukle()
  durum('✓ İşaretlendi')
}

async function geriAl(id) {
  if (!confirm('Bu kayıt geri alınsın mı?')) return
  const { data, error } = await supabase.from('ic_hizmetler').delete().eq('id', id).select('id')
  if (error) { dbHata('ic_hizmet sil', error); alert('Geri alınamadı: ' + error.message); return }
  if (!data?.length) { alert('Geri alınamadı — bu kaydı yalnız operasyon müdürü kaldırabilir.'); return }
  await yukle()
}
