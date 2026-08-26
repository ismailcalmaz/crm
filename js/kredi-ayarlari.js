// =====================================================================
// kredi-ayarlari.js — Kredi faiz oranları düzenleme (yalnız izinli: can.kaya).
//   kredi_oranlari (tek satır) okunur/yazılır. RLS sql/51: master VEYA
//   'kredi_ayarlari' izni yazabilir. Formüller kredi-hesap.js'te (tek kaynak);
//   burası yalnız DEĞİŞKENLERİ (taban×çarpan + vadeler) günceller.
//   Canlı önizleme: örnek fiyat/kasko ile taksitin nasıl değiştiğini gösterir.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, dbHata } from './veri.js'
import { mat, uyari } from './stitch-ui.js'
import { hesapOtosor, hesapBireysel, hesapTuzel } from './kredi-hesap.js'

let benim = null, satir = {}
const ORNEK_FIYAT = 1000000, ORNEK_KASKO = 950000

export async function krediAyarlariKur(danisman) {
  benim = danisman
  const kok = document.getElementById('kok')
  const { data, error } = await supabase.from('kredi_oranlari').select('*').eq('id', 1).maybeSingle()
  if (error) { dbHata('kredi_oranlari oku', error); kok.innerHTML = uyari('Oranlar okunamadı: ' + kacis(error.message)); return }
  satir = data || {}
  ciz()
}

function num(id) { return Number((document.getElementById(id)?.value || '').replace(',', '.')) || 0 }
// Formdaki değerlerden kredi-hesap oranlar nesnesi (taban % → ondalık)
function oranlarOku() {
  return {
    otosor:   { taban: num('otTaban') / 100, carpan: num('otCarpan') },
    bireysel: { taban: num('biTaban') / 100, carpan: num('biCarpan'), vade: num('biVade') },
    tuzel:    { taban: num('tuTaban') / 100, carpan: num('tuCarpan'), vade: num('tuVade') },
  }
}

function grup(baslik, ik, icerik, efektifId) {
  return `<section class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow overflow-hidden">
    <div class="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
      <h3 class="text-title-md text-primary flex items-center gap-2">${mat(ik, 'text-[20px]')} ${kacis(baslik)}</h3>
      <span class="text-label-md font-bold text-secondary">Efektif: <span id="${efektifId}">—</span>/ay</span>
    </div>
    <div class="p-lg grid grid-cols-2 md:grid-cols-3 gap-lg">${icerik}</div>
  </section>`
}
function girdi(id, etiket, deger, sonek) {
  return `<div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">${kacis(etiket)}</label>
    <div class="flex items-center gap-1">
      <input id="${id}" inputmode="decimal" value="${kacis(String(deger ?? ''))}" class="oInp w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white focus:border-primary focus:ring-1 focus:ring-primary">
      ${sonek ? `<span class="text-on-surface-variant text-label-md">${sonek}</span>` : ''}
    </div></div>`
}

function ciz() {
  const kok = document.getElementById('kok')
  const p = n => (Number(n) * 100).toFixed(2)   // ondalık → %
  kok.innerHTML = `
    <div class="mb-lg">
      <h2 class="text-headline-md text-primary">Kredi Ayarları</h2>
      <p class="text-body-md text-on-surface-variant">Araç kartındaki kredi simülatörünün faiz oranları ve vadeleri. Değişiklik anında tüm danışmanların hesabına yansır.</p>
    </div>
    <div class="space-y-lg max-w-[1100px]">
      ${grup('OTOSOR', 'credit_score', `
        ${girdi('otTaban', 'Taban Faiz', p(satir.otosor_taban ?? 0.036), '%')}
        ${girdi('otCarpan', 'Çarpan', satir.otosor_carpan ?? 1.3, '×')}
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Vade</label>
          <p class="text-body-md text-on-surface mt-2">Fiyata göre kural (36/24/12 ay)</p></div>`, 'otEf')}
      ${grup('Bireysel Kredi', 'person', `
        ${girdi('biTaban', 'Taban Faiz', p(satir.bireysel_taban ?? 0.0468), '%')}
        ${girdi('biCarpan', 'Çarpan', satir.bireysel_carpan ?? 1, '×')}
        ${girdi('biVade', 'Vade', satir.bireysel_vade ?? 36, 'ay')}`, 'biEf')}
      ${grup('Tüzel Kredi', 'apartment', `
        ${girdi('tuTaban', 'Taban Faiz', p(satir.tuzel_taban ?? 0.0369), '%')}
        ${girdi('tuCarpan', 'Çarpan', satir.tuzel_carpan ?? 1.05, '×')}
        ${girdi('tuVade', 'Vade', satir.tuzel_vade ?? 60, 'ay')}`, 'tuEf')}

      <section class="bg-surface-container-low rounded-2xl border border-outline-variant p-lg">
        <h3 class="text-title-md text-on-surface flex items-center gap-2 mb-3">${mat('calculate', 'text-[20px]')} Örnek (Fiyat ${fmtPara(ORNEK_FIYAT)} · Kasko ${fmtPara(ORNEK_KASKO)})</h3>
        <div id="onizleme" class="grid grid-cols-1 md:grid-cols-3 gap-lg"></div>
      </section>

      <div class="flex items-center gap-3 flex-wrap">
        <button id="kaydet" class="bg-primary text-on-primary px-lg py-2.5 rounded-lg text-label-md font-bold flex items-center gap-2 hover:opacity-90">${mat('save', 'text-[18px]')} Kaydet</button>
        <span id="durum" class="text-label-md"></span>
        ${satir.updated_at ? `<span class="text-[11px] text-on-surface-variant ml-auto">Son güncelleme: ${new Date(satir.updated_at).toLocaleString('tr-TR')}</span>` : ''}
      </div>
    </div>`

  kok.querySelectorAll('.oInp').forEach(i => i.addEventListener('input', onizle))
  document.getElementById('kaydet').addEventListener('click', kaydet)
  onizle()
}

function onizle() {
  const o = oranlarOku()
  const ef = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = '%' + (t.taban * t.carpan * 100).toFixed(2) }
  ef('otEf', o.otosor); ef('biEf', o.bireysel); ef('tuEf', o.tuzel)
  const kart = (ad, r) => {
    if (r.durum !== 'OK') return `<div class="rounded-xl border border-outline-variant p-3"><p class="font-bold text-on-surface">${ad}</p><p class="text-label-md text-on-surface-variant mt-1">${r.durum}</p></div>`
    return `<div class="rounded-xl border border-outline-variant p-3">
      <p class="font-bold text-on-surface">${ad}</p>
      <p class="text-title-md font-black text-primary mt-1">${fmtPara(Math.round(r.taksit))}<span class="text-label-sm font-normal text-on-surface-variant"> / ay × ${r.vade}</span></p>
      <p class="text-[11px] text-on-surface-variant">kredi ${fmtPara(Math.round(r.kredi))} · peşinat ${r.pesinat <= 0 ? 'yok' : fmtPara(Math.round(r.pesinat))}</p></div>`
  }
  document.getElementById('onizleme').innerHTML =
    kart('OTOSOR', hesapOtosor(ORNEK_FIYAT, o)) +
    kart('Bireysel', hesapBireysel(ORNEK_FIYAT, ORNEK_KASKO, o)) +
    kart('Tüzel', hesapTuzel(ORNEK_FIYAT, ORNEK_KASKO, o))
}

async function kaydet() {
  const durum = document.getElementById('durum'); const btn = document.getElementById('kaydet')
  const o = oranlarOku()
  // basit doğrulama
  for (const [ad, t] of [['OTOSOR', o.otosor], ['Bireysel', o.bireysel], ['Tüzel', o.tuzel]]) {
    if (t.taban <= 0 || t.carpan <= 0) { durum.innerHTML = `<span class="text-error">${kacis(ad)}: taban ve çarpan 0'dan büyük olmalı.</span>`; return }
  }
  btn.disabled = true; durum.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('kredi_oranlari').update({
    otosor_taban: o.otosor.taban, otosor_carpan: o.otosor.carpan,
    bireysel_taban: o.bireysel.taban, bireysel_carpan: o.bireysel.carpan, bireysel_vade: o.bireysel.vade,
    tuzel_taban: o.tuzel.taban, tuzel_carpan: o.tuzel.carpan, tuzel_vade: o.tuzel.vade,
    guncelleyen: benim.id,
  }).eq('id', 1)
  btn.disabled = false
  if (error) { dbHata('kredi_oranlari yaz', error); durum.innerHTML = `<span class="text-error">Kaydedilemedi: ${kacis(error.message)}</span>`; return }
  durum.innerHTML = `<span class="text-secondary flex items-center gap-1">${mat('check_circle', 'text-[18px]')} Kaydedildi — simülatör güncellendi.</span>`
}
