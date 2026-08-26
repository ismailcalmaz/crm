// =====================================================================
// web-satis.js — Satın Alma sayfası (2 sekme):
//   1) Web "aracını sat" başvuruları
//   2) Tedarik: stokta karşılığı olmayan açık müşteri araç talepleri
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import { danismanMap, fmtTarih, fmtButce, fmtPara, aracOzet, kacis } from './veri.js'
import { mat, pill, uyari, bosDurum, stitchTablo, cipler } from './stitch-ui.js'
import { uygunAraclar } from './eslestirme.js'

// --- Sekme 1: web satış ---
const DURUMLAR = ['YENİ', 'İLETİŞİME GEÇİLDİ', 'DEĞERLENDİRİLDİ', 'ALINDI', 'VAZGEÇİLDİ']
const DURUM_SINIF = { 'YENİ': 'havuz', 'İLETİŞİME GEÇİLDİ': 'aktif', 'DEĞERLENDİRİLDİ': 'aktif', 'ALINDI': 'basari', 'VAZGEÇİLDİ': 'hata' }
const SEL = 'bg-surface border border-outline-variant rounded px-2 py-1 text-sm'
let dmap = {}, danismanlar = [], filtre = 'HEPSI', benim = null, _satis = []

// --- Sekme 2: tedarik ---
const TD = [['bekliyor', 'Bekliyor'], ['tedarik_ediliyor', 'Tedarik Ediliyor'], ['bulundu', 'Bulundu'], ['vazgecildi', 'Vazgeçildi']]
const TD_SINIF = { bekliyor: 'havuz', tedarik_ediliyor: 'aktif', bulundu: 'basari', vazgecildi: 'hata' }
const TD_ETIKET = Object.fromEntries(TD)
let tdFiltre = 'aktif', tedarikVeri = []
const joker = v => { const n = (v || '').toLocaleLowerCase('tr').trim(); return !n || n === 'farketmez' || n === '-' }
const spesifik = t => !joker(t.marka) || !joker(t.model)
const tdEtkin = t => !['bulundu', 'vazgecildi'].includes(t.tedarik_durum)

export async function webSatisKur(danisman) {
  benim = danisman
  dmap = await danismanMap()
  danismanlar = Object.values(dmap).filter(d => d.aktif !== false)

  document.getElementById('yenile')?.addEventListener('click', hepsiYenile)
  document.getElementById('filtreler').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return
    filtre = b.dataset.f; satisCiz()
  })
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => sekmeGec(b.dataset.tab)))
  document.getElementById('tedarikFiltre').addEventListener('click', e => {
    const b = e.target.closest('[data-tf]'); if (!b) return
    tdFiltre = b.dataset.tf; tedarikCiz()
  })

  await yukle()
  await tedarikYukle()
}

async function hepsiYenile() { await yukle(); await tedarikYukle() }

function sekmeGec(tab) {
  const satis = tab === 'satis'
  document.getElementById('bolumSatis').classList.toggle('gizli', !satis)
  document.getElementById('bolumTedarik').classList.toggle('gizli', satis)
  const aktif = 'border-primary text-primary', pasif = 'border-transparent text-on-surface-variant hover:text-primary'
  document.getElementById('tabSatis').className = `px-4 py-2 text-label-md font-bold border-b-2 -mb-px ${satis ? aktif : pasif}`
  document.getElementById('tabTedarik').className = `px-4 py-2 text-label-md font-bold border-b-2 -mb-px ${satis ? pasif : aktif}`
}

// ============================ SEKME 1: WEB SATIŞ ============================
async function yukle() {
  const hedef = document.getElementById('liste')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const { data, error } = await supabase.from('web_satis').select('*').order('tarih', { ascending: false })
  if (error) { hedef.innerHTML = uyari(`Okunamadı: ${kacis(error.message)}`); return }
  _satis = data || []
  satisCiz()
}

// Bugün özeti — durum kırılımı (hero)
function satisHeroCiz() {
  const say = d => _satis.filter(r => r.durum === d).length
  const bugun = new Date().toISOString().slice(0, 10)
  const bugunGelen = _satis.filter(r => (r.tarih || '').slice(0, 10) === bugun).length
  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('satisHero').innerHTML =
    kart('sell', 'bg-primary-fixed text-primary', 'Toplam Başvuru', _satis.length, 'aracını sat') +
    kart('fiber_new', 'bg-secondary/10 text-secondary', 'Bugün Gelen', bugunGelen, 'yeni başvuru') +
    kart('phone_in_talk', 'bg-amber-100 text-amber-700', 'Aranacak (Yeni)', say('YENİ'), 'iletişim bekliyor') +
    kart('rule', 'bg-green-100 text-green-700', 'Değerlendirmede', say('DEĞERLENDİRİLDİ'), 'karar aşaması')
}

function satisCiz() {
  satisHeroCiz()
  document.getElementById('filtreler').innerHTML = cipler([['HEPSI', 'Tümü'], ...DURUMLAR.map(d => [d, d])], filtre)
  const hedef = document.getElementById('liste')
  const data = filtre === 'HEPSI' ? _satis : _satis.filter(r => r.durum === filtre)
  if (!data.length) { hedef.innerHTML = bosDurum('Bu filtrede web satış talebi yok.', 'sell'); return }

  const danOpt = s => `<option value="">— atanmadı —</option>` + danismanlar.map(d => `<option value="${d.id}"${d.id === s ? ' selected' : ''}>${kacis(d.ad_soyad)}</option>`).join('')
  const durumOpt = s => DURUMLAR.map(d => `<option value="${kacis(d)}"${d === s ? ' selected' : ''}>${kacis(d)}</option>`).join('')

  const satirlar = data.map(r => {
    const arac = [r.marka, r.model, r.model_yili, r.paket].filter(Boolean).join(' ')
    const spec = [r.km ? r.km.toLocaleString('tr-TR') + ' km' : '', r.yakit, r.vites].filter(Boolean).join(' · ')
    return { hucreler: [
      `<div><p class="font-bold">${kacis(r.ad_soyad)}</p><p class="text-label-sm text-on-surface-variant">${kacis(r.telefon) || ''}</p></div>`,
      `<div><p>${kacis(arac) || '—'}</p><p class="text-label-sm text-on-surface-variant">${kacis(spec)}</p></div>`,
      pill(r.durum, DURUM_SINIF[r.durum] || 'notr'),
      `<select data-durum="${r.id}" class="${SEL}">${durumOpt(r.durum)}</select>`,
      `<select data-atan="${r.id}" class="${SEL}">${danOpt(r.atanan_danisman)}</select>`,
      fmtTarih(r.tarih),
    ] }
  })
  hedef.innerHTML = stitchTablo(['Müşteri', 'Araç', 'Durum', 'Durum Değiştir', 'Atanan Danışman', 'Tarih'], satirlar)
  hedef.querySelectorAll('[data-durum]').forEach(s => s.addEventListener('change', () => guncelle(s.dataset.durum, { durum: s.value })))
  hedef.querySelectorAll('[data-atan]').forEach(s => s.addEventListener('change', () => guncelle(s.dataset.atan, { atanan_danisman: s.value || null })))
}

async function guncelle(id, alanlar) {
  const { error } = await supabase.from('web_satis').update(alanlar).eq('id', id)
  if (error) { alert('Güncellenemedi: ' + error.message); return }
  await yukle()
}

// ============================ SEKME 2: TEDARİK ============================
async function tedarikYukle() {
  const hedef = document.getElementById('tedarikListe')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const [talepR, aracR] = await Promise.all([
    supabase.from('talepler')
      .select('id, musteri_ad_soyad, telefon, marka, model, paket, model_yili_min, model_yili_max, butce_min, butce_max, aciklama, talep_tarihi, tedarik_durum, tedarik_not, kapali')
      .eq('kapali', false)
      .order('talep_tarihi', { ascending: false }),
    siteDb.from('araclar').select('marka, model, yil, fiyat, durum'),
  ])
  if (talepR.error) { hedef.innerHTML = uyari(`Okunamadı: ${kacis(talepR.error.message)}`); return }
  const araclar = aracR.data || []
  // Spesifik araç isteyen + kriterine uyan aktif stok bulunmayan talepler
  tedarikVeri = (talepR.data || []).filter(t => spesifik(t) && uygunAraclar(t, araclar).length === 0)
  rozetGuncelle()
  tedarikCiz()
}

function rozetGuncelle() {
  const rozet = document.getElementById('tedarikSayi'); if (!rozet) return
  const n = tedarikVeri.filter(tdEtkin).length
  rozet.textContent = n || ''
  rozet.style.display = n ? '' : 'none'
}

function tedarikCiz() {
  tedarikKararCiz()
  const say = k => k === 'hepsi' ? tedarikVeri.length
    : k === 'aktif' ? tedarikVeri.filter(tdEtkin).length
    : tedarikVeri.filter(t => (t.tedarik_durum || 'bekliyor') === k).length
  const ops = [['aktif', 'Aktif'], ['bekliyor', 'Bekleyen'], ['tedarik_ediliyor', 'Tedarik Ediliyor'], ['bulundu', 'Bulundu'], ['vazgecildi', 'Vazgeçildi'], ['hepsi', 'Hepsi']]
  document.getElementById('tedarikFiltre').innerHTML = ops.map(([k, l]) => {
    const a = k === tdFiltre
    return `<button data-tf="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${say(k)})</button>`
  }).join('')

  let veri = tedarikVeri
  if (tdFiltre === 'aktif') veri = tedarikVeri.filter(tdEtkin)
  else if (tdFiltre !== 'hepsi') veri = tedarikVeri.filter(t => (t.tedarik_durum || 'bekliyor') === tdFiltre)

  const hedef = document.getElementById('tedarikListe')
  if (!veri.length) { hedef.innerHTML = bosDurum('Bu filtrede tedarik talebi yok.', 'inventory'); return }

  const tdOpt = s => TD.map(([v, l]) => `<option value="${v}"${(s || 'bekliyor') === v ? ' selected' : ''}>${l}</option>`).join('')
  const satirlar = veri.map(t => {
    const acik = (t.aciklama || '').trim()
    const durum = t.tedarik_durum || 'bekliyor'
    return { hucreler: [
      `<div><p class="font-bold">${kacis(t.musteri_ad_soyad)}</p><p class="text-label-sm text-on-surface-variant">${kacis(t.telefon) || ''}</p></div>`,
      `<div class="max-w-[260px]"><p class="font-bold">${kacis(aracOzet(t))}</p><p class="text-label-sm text-on-surface-variant">${kacis(fmtButce(t.butce_min, t.butce_max))}</p>${acik ? `<p class="text-label-sm text-on-surface-variant clamp-2 break-words">${kacis(acik)}</p>` : ''}</div>`,
      pill(TD_ETIKET[durum], TD_SINIF[durum]),
      `<select data-td="${t.id}" class="${SEL}">${tdOpt(t.tedarik_durum)}</select>`,
      `<input data-tn="${t.id}" value="${kacis(t.tedarik_not) || ''}" placeholder="Tedarik notu…" class="${SEL} w-[180px]" />`,
      fmtTarih(t.talep_tarihi),
    ] }
  })
  hedef.innerHTML = stitchTablo(['Müşteri', 'Aranan Araç / Bütçe', 'Durum', 'Durum Değiştir', 'Not', 'Talep Tarihi'], satirlar)
  hedef.querySelectorAll('[data-td]').forEach(s => s.addEventListener('change', () => tedarikGuncelle(s.dataset.td, { tedarik_durum: s.value })))
  hedef.querySelectorAll('[data-tn]').forEach(inp => inp.addEventListener('change', () => tedarikGuncelle(inp.dataset.tn, { tedarik_not: inp.value.trim() || null })))
}

// Tedarik Karar Motoru — talepleri modele göre grupla: kaç müşteri, potansiyel ciro, arz açığı
function tedarikOzet() {
  const grup = {}
  for (const t of tedarikVeri.filter(tdEtkin)) {
    const ad = [t.marka, t.model].filter(Boolean).join(' ').trim() || 'Belirsiz'
    const g = (grup[ad] ||= { ad, adet: 0, min: Infinity, max: 0, ciro: 0 })
    g.adet++
    if (t.butce_min) g.min = Math.min(g.min, Number(t.butce_min))
    if (t.butce_max) g.max = Math.max(g.max, Number(t.butce_max))
    g.ciro += Number(t.butce_max || t.butce_min || 0)
  }
  return Object.values(grup).sort((a, b) => b.adet - a.adet || b.ciro - a.ciro)
}

function tedarikKararCiz() {
  const kutu = document.getElementById('tedarikKarar'); if (!kutu) return
  const ozet = tedarikOzet()
  const aktif = tedarikVeri.filter(tdEtkin)
  const toplamMusteri = aktif.length
  const toplamCiro = ozet.reduce((s, g) => s + g.ciro, 0)
  const maxAdet = ozet[0]?.adet || 1

  if (!ozet.length) {
    kutu.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-xl text-center">
      <div class="w-14 h-14 mx-auto rounded-2xl bg-green-100 text-green-700 flex items-center justify-center">${mat('verified', 'text-3xl')}</div>
      <p class="mt-3 text-title-lg font-bold text-on-surface">Arz açığı yok 🎉</p>
      <p class="text-body-md text-on-surface-variant mt-1">Açık taleplerin tümü stoktaki araçlarla karşılanabiliyor.</p></div>`
    return
  }
  const araligi = g => fmtButce(g.min === Infinity ? null : g.min, g.max || null)
  const enCok = ozet.slice(0, 2).map((g, i) => `
    <div class="bg-surface-container-lowest rounded-2xl border ${i === 0 ? 'border-primary/30' : 'border-outline-variant'} custom-shadow p-lg flex flex-col justify-between">
      <div class="flex items-center justify-between">
        <div class="w-10 h-10 rounded-xl ${i === 0 ? 'bg-primary-fixed text-primary' : 'bg-amber-100 text-amber-700'} flex items-center justify-center">${mat(i === 0 ? 'trending_up' : 'local_fire_department', 'text-[22px]')}</div>
        <span class="text-[10px] font-bold uppercase tracking-wide ${i === 0 ? 'text-primary' : 'text-amber-700'}">${i === 0 ? 'En Çok Aranan' : 'Yüksek Talep'}</span>
      </div>
      <div class="mt-3"><p class="text-title-lg font-black text-on-surface truncate">${kacis(g.ad)}</p><p class="text-body-md text-on-surface-variant">${g.adet} aktif bekleyen müşteri</p></div>
      <div class="mt-3"><div class="flex justify-between text-[11px] text-on-surface-variant mb-1"><span>Talep yoğunluğu</span><span class="font-bold">${Math.round(g.adet / maxAdet * 100)}%</span></div><div class="h-2 rounded-full bg-surface-container overflow-hidden"><div class="h-full ${i === 0 ? 'bg-primary' : 'bg-amber-400'}" style="width:${Math.round(g.adet / maxAdet * 100)}%"></div></div></div>
    </div>`).join('')

  const satirlar = ozet.map(g => `
    <tr class="border-b border-outline-variant/40">
      <td class="px-lg py-md"><div class="flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-surface-container text-on-surface-variant flex items-center justify-center shrink-0">${mat('directions_car', 'text-[20px]')}</div><p class="font-bold text-on-surface">${kacis(g.ad)}</p></div></td>
      <td class="px-lg py-md"><span class="inline-flex items-center gap-1.5 bg-primary-fixed text-primary text-label-sm font-bold px-2.5 py-1 rounded-full">${mat('group', 'text-[15px]')} ${g.adet} müşteri bekliyor</span></td>
      <td class="px-lg py-md text-body-md text-on-surface">${kacis(araligi(g))}</td>
      <td class="px-lg py-md text-right"><p class="font-black text-primary text-title-lg">${fmtPara(g.ciro)}</p><p class="text-[10px] uppercase tracking-wide text-on-surface-variant">potansiyel</p></td>
    </tr>`).join('')

  kutu.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
      <div class="rounded-2xl bg-on-surface text-white p-lg custom-shadow flex flex-col justify-between">
        <div>
          <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/70">${mat('warning', 'text-[16px]')} Kritik Stok Açığı</p>
          <p class="text-headline-lg font-black mt-1">${ozet.length} Model</p>
          <p class="text-white/70 text-body-md mt-1">${toplamMusteri} müşteri, kriterine uyan stok bulunmadığı için bekliyor.</p>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-4">
          <div class="bg-white/10 rounded-xl p-3"><p class="text-[10px] uppercase tracking-wide text-white/60">Potansiyel Ciro</p><p class="font-black text-title-lg">${fmtPara(toplamCiro)}</p></div>
          <div class="bg-white/10 rounded-xl p-3"><p class="text-[10px] uppercase tracking-wide text-white/60">Bekleyen</p><p class="font-black text-title-lg">${toplamMusteri} kişi</p></div>
        </div>
      </div>
      ${enCok}
    </div>
    <div class="mt-lg bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-hidden">
      <div class="p-lg border-b border-outline-variant flex items-center justify-between">
        <h3 class="text-title-lg text-primary flex items-center gap-2">${mat('insights')} Talep Analizi & Tedarik Önceliği</h3>
        <span class="text-label-sm text-on-surface-variant">${ozet.length} model · potansiyel ciroya göre</span>
      </div>
      <div class="overflow-x-auto"><table class="w-full text-left border-collapse">
        <thead class="bg-surface-container-low text-[11px] uppercase tracking-wider text-on-surface-variant"><tr>
          <th class="px-lg py-3 font-bold">Araç Modeli</th><th class="px-lg py-3 font-bold">Talep Yoğunluğu</th><th class="px-lg py-3 font-bold">Bütçe Aralığı</th><th class="px-lg py-3 font-bold text-right">Potansiyel Ciro</th>
        </tr></thead>
        <tbody>${satirlar}</tbody>
      </table></div>
    </div>
    <p class="text-[11px] text-on-surface-variant mt-2">Potansiyel ciro = bekleyen müşterilerin bütçe üst sınırlarının toplamı (gerçek talep verisi). Pazar/tahmin verisi kullanılmaz.</p>`
}

async function tedarikGuncelle(id, alanlar) {
  alanlar.tedarik_guncelleyen = benim?.id || null
  alanlar.tedarik_tarih = new Date().toISOString()
  const { error } = await supabase.from('talepler').update(alanlar).eq('id', id)
  if (error) { alert('Güncellenemedi: ' + error.message); return }
  const t = tedarikVeri.find(x => x.id === id); if (t) Object.assign(t, alanlar)
  rozetGuncelle()
  tedarikCiz()
}
