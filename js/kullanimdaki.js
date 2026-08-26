// =====================================================================
// kullanimdaki.js — ŞİRKETİN KENDİ KULLANDIĞI ARAÇLAR (sql/109)
//
//   Göksenil: "Kullanımda olan araçları bilgi işlem veya master admin giriyor.
//   Giriş aynı fakat satış fiyatı olmak zorunda değil, KİME TAHSİS EDİLDİ
//   sorgusu dönmeli. Bu araçlarda trafik sigortası ve kaskosu her sene
//   yenileniyor, sigorta modülü ile haberleşmesi gerek. Kullanımdaki araç
//   satılması için stok listesine gelebilir, onun için de bilgi işlem /
//   master admin / İsmail Bey (sadece satış fiyatını bildirmek için)
//   STOĞA AL diye bir seçenek olması gerek."
//
//   ⚠️ HESAP YOK, GÖSTERİM VAR. "Stoğa Al" kararını sunucudaki
//   kullanimdaki_stoga_al() verir (yetki + durum kontrolü + fiyat yazma orada).
//   Buradaki düğme yalnız çağırır; istemcide ikinci bir kural yazılmaz.
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, fmtTarihKisa, kacis, trBuyuk, dbHata } from './veri.js'
import { mat, bosDurum, stitchTablo, kpiKart } from './stitch-ui.js'
import { kullanimYonetir, fiyatYonetir } from './yetki.js'

let BEN = null
let LISTE = []

export async function kullanimdakiKur(d) {
  BEN = d
  document.getElementById('yenile')?.addEventListener('click', yukle)
  // Olay KAPSAYICIDA: içerik her yüklemede yeniden çiziliyor, tek tek düğmeye
  // bağlansaydı ilk çizimden sonrakiler ölürdü (ilanlar.js'te aynı ders).
  document.getElementById('icerik').addEventListener('click', e => {
    const b = e.target.closest('.ku-stoga')
    if (b) stogaAlAc(b.dataset.arac, b.dataset.ad)
  })
  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('icerik')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  const { data, error } = await supabase.from('v_kullanimdaki_araclar').select('*').order('plaka')
  if (error) {
    dbHata('kullanimdaki araclar', error)
    hedef.innerHTML = `<div class="uyari-kutu">Liste okunamadı: ${kacis(error.message)}</div>`
    return
  }
  LISTE = data || []
  document.getElementById('sayac').textContent = LISTE.length ? `· ${LISTE.length} araç` : ''
  kpiCiz()
  ciz()
}

function kpiCiz() {
  const tahsissiz = LISTE.filter(a => !a.tahsis_edilen_id).length
  // Sigorta 30 günden az kaldıysa ya da bitmişse: yenileme zamanı.
  const yakin = LISTE.filter(a => a.sigorta_kalan_gun != null && a.sigorta_kalan_gun <= 30).length
  const poliçesiz = LISTE.filter(a => !a.police_sayisi).length
  document.getElementById('kpi').innerHTML = [
    kpiKart('directions_car', 'bg-blue-100 text-blue-700', LISTE.length, 'Kullanımdaki Araç', 'Satışta değil'),
    kpiKart('person_off', 'bg-amber-100 text-amber-700', tahsissiz, 'Tahsis Edilmemiş', tahsissiz ? 'Kime verildi belirsiz' : 'Hepsi belli'),
    kpiKart('event_busy', 'bg-red-100 text-red-700', yakin, 'Sigortası Bitiyor', '30 gün ve altı'),
    kpiKart('shield', 'bg-purple-100 text-purple-700', poliçesiz, 'Poliçesi Görünmeyen', 'Sigorta modülünde kayıt yok'),
  ].join('')
}

// Sigorta durumu — kalan güne göre renk. police_sayisi 0 ise "kayıt yok":
// sigortası yok demek DEĞİL, sigorta modülünde bu plakayla eşleşen poliçe yok.
function sigortaHtml(a) {
  if (!a.police_sayisi) {
    return `<span class="text-[12px] text-on-surface-variant">Kayıt yok</span>`
  }
  const g = a.sigorta_kalan_gun
  const sinif = g < 0 ? 'bg-red-100 text-red-700'
    : g <= 30 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
  const metin = g < 0 ? `${Math.abs(g)} gün geçti` : `${g} gün kaldı`
  return `<div><span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${sinif}">${metin}</span>
    <p class="text-[11px] text-on-surface-variant mt-0.5">${fmtTarihKisa(a.en_yakin_bitis)}</p></div>`
}

function ciz() {
  const h = document.getElementById('icerik')
  if (!LISTE.length) {
    h.innerHTML = bosDurum('Şirket kullanımında araç yok.', 'directions_car')
    return
  }
  // Sigortası biten/bitmek üzere olanlar üstte
  const sirali = LISTE.slice().sort((a, b) => {
    const ga = a.sigorta_kalan_gun ?? 99999, gb = b.sigorta_kalan_gun ?? 99999
    return ga - gb || String(a.plaka || '').localeCompare(String(b.plaka || ''), 'tr')
  })
  const yetkili = kullanimYonetir(BEN) || fiyatYonetir(BEN)
  const satirlar = sirali.map(a => ({
    hucreler: [
      `<div><p class="font-bold text-on-surface">${kacis(trBuyuk(a.plaka || '—'))}</p>
        <p class="text-[12px] text-on-surface-variant">${kacis(trBuyuk([a.marka, a.model, a.versiyon].filter(Boolean).join(' ')))} ${a.yil || ''}</p></div>`,
      a.tahsis_edilen
        ? `<div><p class="text-body-sm font-bold">${kacis(a.tahsis_edilen)}</p>
           <p class="text-[11px] text-on-surface-variant">${a.tahsis_tarihi ? fmtTarihKisa(a.tahsis_tarihi) : ''}</p></div>`
        : `<span class="text-[12px] text-amber-700 font-bold">Tahsis edilmemiş</span>`,
      `<span class="text-body-sm">${a.km ? Number(a.km).toLocaleString('tr-TR') + ' km' : '—'}</span>`,
      sigortaHtml(a),
      `<div class="flex justify-end gap-1.5">
        ${yetkili ? `<button class="ku-stoga px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-label-md font-bold"
            data-arac="${a.arac_id}" data-ad="${kacis([a.plaka, a.marka, a.model].filter(Boolean).join(' '))}"
            title="Satışa çıkarmak için stoğa al">Stoğa Al</button>` : ''}
        <a href="arac-kart.html?id=${encodeURIComponent(a.arac_id)}" class="px-2.5 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold hover:bg-primary hover:text-white transition-all">Araç</a>
      </div>`,
    ],
  }))
  h.innerHTML = stitchTablo(['Araç', 'Tahsis', 'KM', 'Sigorta', ['', true]], satirlar)
}

// ---------- STOĞA AL ----------
// Fiyat OPSİYONEL: İsmail Bey fiyatı burada bildirirse araç doğrudan STOKTA
// olur; boş bırakılırsa FIYATLANDIRMA_BEKLIYOR'a düşer ve fiyatlama merkezinde
// görünür. Kararı sunucu veriyor — burada sadece gösteriyoruz.
function stogaAlAc(aracId, ad) {
  const fiyatVar = fiyatYonetir(BEN)
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[85] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('inventory_2', 'text-[18px]')} Stoğa Al</h3>
        <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
      </div>
      <div class="p-4 space-y-3">
        <p class="text-body-md"><b>${kacis(trBuyuk(ad || ''))}</b> satışa çıkarılacak.</p>
        ${fiyatVar ? `
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">Satış fiyatı (₺)</label>
            <input id="kuFiyat" type="number" min="0" placeholder="boş = sonra fiyatlanır"
              class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
          </div>
          <div>
            <label class="block text-label-sm text-on-surface-variant mb-1">Minimum fiyat (₺)</label>
            <input id="kuMin" type="number" min="0" placeholder="opsiyonel"
              class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
          </div>
        </div>
        <p class="text-[11px] text-on-surface-variant">Fiyat girersen araç doğrudan <b>Stokta</b> olur. Boş bırakırsan <b>Fiyatlandırma Bekliyor</b>'a düşer ve fiyatlama merkezinde görünür.</p>
        ` : `<p class="text-[12px] text-on-surface-variant">Fiyat yazma yetkin yok — araç <b>Fiyatlandırma Bekliyor</b>'a düşecek, fiyatı İsmail Bey verecek.</p>`}
        <p id="kuDurum" class="text-body-sm text-on-surface-variant"></p>
      </div>
      <div class="flex justify-end gap-2 p-4 border-t border-outline-variant">
        <button data-kapat class="px-4 py-2 rounded-lg border border-outline-variant text-label-md font-bold">Vazgeç</button>
        <button id="kuOnay" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-bold">Stoğa Al</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))

  ov.querySelector('#kuOnay').addEventListener('click', async () => {
    const btn = ov.querySelector('#kuOnay'); btn.disabled = true
    const durumEl = ov.querySelector('#kuDurum')
    durumEl.textContent = 'İşleniyor…'
    const fiyat = Number(ov.querySelector('#kuFiyat')?.value) || null
    const min = Number(ov.querySelector('#kuMin')?.value) || null
    const { data, error } = await supabase.rpc('kullanimdaki_stoga_al', {
      p_arac: aracId, p_satis_fiyati: fiyat, p_min_fiyat: min,
    })
    if (error) {
      console.error('[kullanimdaki] stoga al', error)
      durumEl.className = 'text-body-sm text-error'
      durumEl.textContent = 'Yapılamadı: ' + error.message
      btn.disabled = false
      return
    }
    durumEl.className = 'text-body-sm text-[#1a7a3d]'
    durumEl.textContent = `✓ Araç ${data?.durum === 'STOKTA' ? 'stoğa alındı' : 'fiyatlandırma sırasına alındı'}.`
    setTimeout(() => { kapat(); yukle() }, 1200)
  })
}
