// =====================================================================
// tramer-ocr-pencere.js — Tramer belgesi sürükle-bırak + onay penceresi
//
//   Göksenil: "sisteme sürükle bırak diyeceğim, o metne dönüştürecek."
//
// ⚠️ ONAYSIZ KAYIT YOK. Okunan her satır düzenlenebilir bir tabloda gösterilir;
// kullanıcı "Kaydet" demeden arac_tramer'a hiçbir şey yazılmaz. Satır tek tek
// çıkarılabilir. OCR'a körlemesine güvenip fiyatlamayı etkileyen bir rakam
// yazmak, bu projede kaçındığımız hata sınıfı.
//
// Motor: tramer-ocr.js (önce PDF metin katmanı, yoksa Tesseract).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'
import { belgeSatirlari, tramerAyristir, aracDogrula, ozet } from './tramer-ocr.js'

const trTarih = iso => {
  if (!iso) return ''
  const [y, a, g] = iso.split('-')
  return `${g}.${a}.${y}`
}

/**
 * @param {object} arac  {id, plaka, sasi_no}
 * @param {Function} bitince kaydedince çağrılır (listeyi tazelemek için)
 */
export function tramerOcrAc(arac, bitince) {
  let AYRIS = null

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[86] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('document_scanner', 'text-[18px]')} Tramer Belgesinden Oku — ${kacis(arac?.plaka || '')}</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>

      <div class="overflow-y-auto p-4 space-y-3">
        <div id="toBirak" class="border-2 border-dashed border-outline-variant rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
          ${mat('upload_file', 'text-4xl text-on-surface-variant opacity-40')}
          <p class="mt-2 text-body-md font-bold text-on-surface">Tramer belgesini buraya sürükle</p>
          <p class="text-[12px] text-on-surface-variant mt-1">PDF veya ekran görüntüsü · tıklayarak da seçebilirsin</p>
          <p class="text-[11px] text-on-surface-variant mt-2">Belge bilgisayarından çıkmaz — okuma tarayıcıda yapılır.</p>
          <input id="toDosya" type="file" accept="application/pdf,image/*" hidden />
        </div>

        <div id="toDurum" class="hidden">
          <div class="flex items-center gap-2 text-body-sm text-on-surface-variant">
            <span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            <span id="toDurumMetin">Okunuyor…</span>
          </div>
          <div class="h-1.5 bg-surface-container rounded-full mt-2 overflow-hidden">
            <div id="toBar" class="h-full bg-primary transition-all" style="width:0%"></div>
          </div>
        </div>

        <div id="toSonuc" class="hidden space-y-3"></div>
      </div>

      <div class="flex items-center justify-between gap-2 p-4 border-t border-outline-variant">
        <span id="toOzet" class="text-body-sm text-on-surface-variant"></span>
        <div class="flex gap-2">
          <button data-kapat class="px-4 py-2 rounded-lg border border-outline-variant text-label-md font-bold">Vazgeç</button>
          <button id="toKaydet" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-bold hidden">Kaydet</button>
        </div>
      </div>
    </div>`
  document.body.appendChild(ov)

  const $ = s => ov.querySelector(s)
  const kapat = () => ov.remove()
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))

  const birak = $('#toBirak'), dosya = $('#toDosya')
  birak.addEventListener('click', () => dosya.click())
  dosya.addEventListener('change', e => { if (e.target.files?.[0]) isle(e.target.files[0]) })
  ;['dragenter', 'dragover'].forEach(t => birak.addEventListener(t, e => {
    e.preventDefault(); birak.classList.add('border-primary', 'bg-primary/5')
  }))
  ;['dragleave', 'drop'].forEach(t => birak.addEventListener(t, e => {
    e.preventDefault(); birak.classList.remove('border-primary', 'bg-primary/5')
  }))
  birak.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0]
    if (f) isle(f)
  })

  async function isle(file) {
    $('#toDurum').classList.remove('hidden')
    $('#toSonuc').classList.add('hidden')
    $('#toKaydet').classList.add('hidden')
    $('#toDurumMetin').textContent = 'Belge açılıyor…'
    $('#toBar').style.width = '5%'
    try {
      const { satirlar, kaynak } = await belgeSatirlari(file, p => {
        $('#toDurumMetin').textContent = 'Görüntü okunuyor (OCR)…'
        $('#toBar').style.width = Math.round(10 + p * 85) + '%'
      })
      if (kaynak === 'PDF_METIN') {
        $('#toDurumMetin').textContent = 'PDF metni okundu'
        $('#toBar').style.width = '95%'
      }
      AYRIS = tramerAyristir(satirlar)
      AYRIS._kaynak = kaynak
      $('#toBar').style.width = '100%'
      setTimeout(() => $('#toDurum').classList.add('hidden'), 300)
      sonucCiz()
    } catch (e) {
      console.error('[tramer-ocr] okuma', e)
      $('#toDurum').classList.add('hidden')
      $('#toSonuc').classList.remove('hidden')
      $('#toSonuc').innerHTML = `<div class="bg-error-container text-on-error-container rounded-lg px-3 py-2 text-body-sm">
        Belge okunamadı: ${kacis(e.message)}<br><span class="text-[12px]">Tarayıcı OCR kütüphanesini indiremediyse internet bağlantısını kontrol et.</span></div>`
    }
  }

  function sonucCiz() {
    const kap = $('#toSonuc')
    kap.classList.remove('hidden')
    const dg = aracDogrula(AYRIS, arac)

    // Kaynak rozeti: PDF metni KESİN, OCR tahminî — kullanıcı ne kadar
    // güveneceğini bilsin.
    const kaynakRozet = AYRIS._kaynak === 'PDF_METIN'
      ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">PDF metni — birebir okundu</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">Görüntüden okundu (OCR) — kontrol et</span>`

    const dogrulama = dg.durum === 'UYUSMUYOR'
      ? `<div class="bg-error-container text-on-error-container border border-error/30 rounded-lg px-3 py-2 text-body-sm font-bold">${mat('warning', 'text-[16px] align-middle')} ${kacis(dg.mesaj)}</div>`
      : dg.durum === 'UYUYOR'
        ? `<div class="text-[12px] text-[#1a7a3d]">✓ ${kacis(dg.mesaj)}</div>`
        : `<div class="text-[12px] text-on-surface-variant">Şasi karşılaştırılamadı (araçta şasi no kayıtlı değil).</div>`

    const uyari = AYRIS.uyarilar.length
      ? `<div class="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-3 py-2 text-[12px]">${AYRIS.uyarilar.map(u => kacis(u)).join('<br>')}</div>` : ''

    const satir = (k, i) => `<tr class="border-b border-outline-variant/40" data-sira="${i}">
      <td class="p-1"><input data-a="hasar_tarihi" type="date" value="${kacis(k.hasar_tarihi || '')}" class="w-full border border-outline-variant rounded px-2 py-1 text-[12px] bg-white"></td>
      <td class="p-1"><input data-a="aciklama" type="text" value="${kacis(k.aciklama || '')}" class="w-full border border-outline-variant rounded px-2 py-1 text-[12px] bg-white"></td>
      <td class="p-1"><input data-a="tutar" type="number" step="0.01" min="0" value="${k.tutar ?? ''}" placeholder="tutar yok" class="w-full border border-outline-variant rounded px-2 py-1 text-[12px] bg-white text-right"></td>
      <td class="p-1 text-right"><button class="to-sil w-7 h-7 rounded hover:bg-error/10 text-error" title="Bu satırı alma">${mat('close', 'text-[16px]')}</button></td>
    </tr>`

    kap.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">${kaynakRozet}
        ${AYRIS.markaModel ? `<span class="text-[12px] text-on-surface-variant">${kacis(AYRIS.markaModel)}</span>` : ''}</div>
      ${dogrulama}${uyari}
      <div>
        <label class="block text-label-sm text-on-surface-variant mb-1">Sorgu tarihi</label>
        <input id="toSorgu" type="date" value="${kacis(AYRIS.sorguTarihi || '')}" class="border border-outline-variant rounded-lg px-3 py-1.5 text-body-sm bg-white">
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead><tr class="text-left text-[11px] uppercase text-on-surface-variant">
            <th class="p-1">Hasar Tarihi</th><th class="p-1">Hasar Nedeni</th><th class="p-1 text-right">Tutar (₺)</th><th></th>
          </tr></thead>
          <tbody id="toSatirlar">${AYRIS.kayitlar.map(satir).join('')}</tbody>
        </table>
      </div>
      <p class="text-[11px] text-on-surface-variant">Tutarı olmayan kayıtlar boş bırakılır — SBM belgesinde “−” olarak geçer, bu normaldir.</p>`

    kap.querySelectorAll('.to-sil').forEach(b => b.addEventListener('click', e => {
      e.target.closest('tr').remove(); ozetGuncelle()
    }))
    kap.addEventListener('input', ozetGuncelle)
    $('#toKaydet').classList.toggle('hidden', !AYRIS.kayitlar.length)
    ozetGuncelle()
  }

  function tablodanOku() {
    return [...ov.querySelectorAll('#toSatirlar tr')].map(tr => {
      const al = a => tr.querySelector(`[data-a="${a}"]`)?.value?.trim() || ''
      const t = al('tutar')
      return { hasar_tarihi: al('hasar_tarihi') || null, aciklama: al('aciklama') || null,
               tutar: t === '' ? null : Number(t) }
    }).filter(k => k.hasar_tarihi)
  }

  function ozetGuncelle() {
    const o = ozet(tablodanOku())
    $('#toOzet').textContent = o.adet
      ? `${o.adet} kayıt · ${fmtPara(o.toplam)}${o.tutarsiz ? ` · ${o.tutarsiz} kayıtta tutar yok` : ''}`
      : 'Kaydedilecek satır yok'
  }

  $('#toKaydet').addEventListener('click', async () => {
    const kayitlar = tablodanOku()
    if (!kayitlar.length) return
    const btn = $('#toKaydet'); btn.disabled = true
    const eski = btn.textContent; btn.textContent = 'Kaydediliyor…'
    const sorgu = $('#toSorgu')?.value || null
    const { data, error } = await supabase.from('arac_tramer')
      .insert(kayitlar.map(k => ({ ...k, arac_id: arac.id, sorgu_tarihi: sorgu })))
      .select('id')
    if (error) {
      dbHata('tramer ocr kaydet', error)
      $('#toOzet').textContent = 'Kaydedilemedi: ' + error.message
      btn.disabled = false; btn.textContent = eski
      return
    }
    // §5.1 — PostgREST yetki yoksa hata vermez, 0 satır yazar.
    if (!data?.length) {
      $('#toOzet').textContent = 'Kaydedilemedi — yetkiniz yok.'
      btn.disabled = false; btn.textContent = eski
      return
    }
    $('#toOzet').textContent = `✓ ${data.length} tramer kaydı eklendi.`
    setTimeout(() => { kapat(); bitince?.() }, 900)
  })
}
