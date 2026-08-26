// =====================================================================
// durgun-uyari.js — Durgun talep ZORLAMA pop-up'ı
//   Danışman uygulamayı açınca, 3+ gündür güncellenmemiş KENDİ aktif
//   taleplerini engelleyici modal olarak görür. Her biri için ya
//   "Aradım" (görüşme notu gir) ya da "Kapat" (kapanış durumu) seçilir —
//   çözmeden geçilmez. "Bugünlük ertele" ile günde bir kez ertelenebilir.
//   auth.js → ustBarKur sonunda çağrılır (her sayfada).
// =====================================================================
import { supabase } from './supabase-client.js'
import { DURUMLAR, KAYIP_NEDENLERI, kapanisMi, kaybedildiMi, aracOzet, kacis } from './veri.js'

const DURGUN_GUN = 3
const bugunStr = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}
const guncelNot = t => (t.gorusme_notlari || []).slice()
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null
const gunFark = ts => Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)

export async function durgunUyariKur(danisman) {
  if (!danisman) return
  if (localStorage.getItem('durgun-ertele') === bugunStr()) return   // bugünlük ertelendi
  if (sessionStorage.getItem('durgun-oturum') === '1') return        // bu oturumda kontrol edildi

  const { data, error } = await supabase.from('talepler')
    .select('id, musteri_ad_soyad, telefon, marka, model, paket, aciklama, '
      + 'gorusme_notlari(id, musteri_durumu, sahip_danisman_id, created_at, sonraki_adim_tarihi)')
  if (error || !data) return

  const durgunlar = data.map(t => ({ t, n: guncelNot(t) }))
    .filter(({ n }) => n
      && n.sahip_danisman_id === danisman.id      // benim sahiplendiğim
      && !kapanisMi(n.musteri_durumu)             // açık durum
      && !n.sonraki_adim_tarihi                   // ileri takip planı yok
      && gunFark(n.created_at) >= DURGUN_GUN)      // 3+ gündür sessiz
    .map(({ t, n }) => ({ ...t, _durum: n.musteri_durumu, _gun: gunFark(n.created_at) }))

  if (!durgunlar.length) { sessionStorage.setItem('durgun-oturum', '1'); return }
  modalGoster(danisman, durgunlar)
}

function modalGoster(danisman, liste) {
  const kapanislar = DURUMLAR.filter(kapanisMi)
  const overlay = document.createElement('div')
  overlay.id = 'durgunOverlay'
  overlay.className = 'fixed inset-0 z-[100] bg-black/60 flex items-start justify-center overflow-y-auto p-4'
  overlay.innerHTML = `
    <div class="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl my-8">
      <div class="px-6 py-4 border-b border-outline-variant">
        <h2 class="text-headline-sm font-bold text-error flex items-center gap-2">
          <span class="material-symbols-outlined">warning</span> Durgun talepler — karar bekliyor
        </h2>
        <p class="text-body-md text-on-surface-variant mt-1">
          <b id="durgunSayi">${liste.length}</b> talebin 3+ gündür güncellenmedi.
          Her biri için <b>Aradım</b> (not gir) ya da <b>Kapat</b> (durum) seç.
        </p>
      </div>
      <div id="durgunKart" class="px-6 py-4 space-y-3"></div>
      <div class="px-6 py-3 border-t border-outline-variant flex justify-end">
        <button id="durgunErtele" class="text-on-surface-variant hover:text-on-surface text-label-md font-medium">Bugünlük ertele</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  document.body.style.overflow = 'hidden'

  const kartlar = overlay.querySelector('#durgunKart')
  liste.forEach(t => kartlar.appendChild(kartYap(danisman, t, kapanislar)))

  overlay.querySelector('#durgunErtele').addEventListener('click', () => {
    localStorage.setItem('durgun-ertele', bugunStr())
    kapat()
  })
  function kapat() { overlay.remove(); document.body.style.overflow = '' }
}

function kapat() {
  sessionStorage.setItem('durgun-oturum', '1')
  document.getElementById('durgunOverlay')?.remove()
  document.body.style.overflow = ''
}
function kartCoz(el) {
  el.remove()
  const kalan = document.querySelectorAll('#durgunKart > div').length
  const sayi = document.getElementById('durgunSayi'); if (sayi) sayi.textContent = kalan
  if (kalan === 0) kapat()
}

function kartYap(danisman, t, kapanislar) {
  const el = document.createElement('div')
  el.className = 'border border-outline-variant rounded-xl p-4'
  const arac = aracOzet(t) || (t.aciklama || '').slice(0, 60) || '—'
  el.innerHTML = `
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <p class="font-bold text-on-surface">${kacis(t.musteri_ad_soyad) || '—'}</p>
        <p class="text-label-sm text-on-surface-variant">${kacis(arac)} · ${kacis(t.telefon || '')}</p>
        <p class="text-label-sm font-bold text-error mt-1 flex items-center gap-1">
          <span class="material-symbols-outlined text-[14px]">schedule</span> ${t._gun} gündür sessiz · ${kacis(t._durum)}
        </p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button data-act="aradim" class="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-label-md font-bold">📞 Aradım</button>
        <button data-act="kapat" class="bg-error text-white px-3 py-1.5 rounded-lg text-label-md font-bold">Kapat</button>
      </div>
    </div>
    <div data-form class="mt-3 hidden"></div>`
  const alan = el.querySelector('[data-form]')
  el.querySelector('[data-act="aradim"]').addEventListener('click', () => aradimForm(danisman, t, el, alan))
  el.querySelector('[data-act="kapat"]').addEventListener('click', () => kapatForm(danisman, t, el, alan, kapanislar))
  return el
}

async function notKaydet(veri, btn, el, hataMsj) {
  btn.disabled = true; const eski = btn.textContent; btn.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('gorusme_notlari').insert(veri)
  if (error) { btn.disabled = false; btn.textContent = eski; alert(hataMsj + error.message); return }
  kartCoz(el)
}

function aradimForm(danisman, t, el, alan) {
  alan.classList.remove('hidden')
  alan.innerHTML = `
    <textarea data-not rows="2" placeholder="Görüşme notu (ör. aradım, düşünüyor / meşguldü, tekrar arayacağım)" class="w-full border border-outline-variant rounded-lg p-2 text-body-md"></textarea>
    <div class="flex items-end gap-2 mt-2 flex-wrap">
      <label class="text-label-sm flex flex-col gap-1">Sonraki arama (ops.)
        <input type="date" data-tarih class="border border-outline-variant rounded-lg p-1.5 text-body-md">
      </label>
      <button data-kaydet class="bg-primary text-on-primary px-4 py-1.5 rounded-lg text-label-md font-bold ml-auto">Kaydet</button>
    </div>`
  alan.querySelector('[data-kaydet]').addEventListener('click', e => {
    const not = alan.querySelector('[data-not]').value.trim()
    if (!not) { alert('Kısa bir görüşme notu yazın.'); return }
    notKaydet({
      talep_id: t.id, gorusme_notu: not,
      musteri_ad_soyad: t.musteri_ad_soyad, telefon: t.telefon,
      musteri_durumu: t._durum,                                  // açık durumu koru
      sonraki_adim_tarihi: alan.querySelector('[data-tarih]').value || null,
      acan_id: danisman.id, sahip_danisman_id: danisman.id,      // sahiplenme korunur
    }, e.currentTarget, el, 'Kaydedilemedi: ')
  })
}

function kapatForm(danisman, t, el, alan, kapanislar) {
  alan.classList.remove('hidden')
  alan.innerHTML = `
    <div class="flex items-end gap-2 flex-wrap">
      <label class="text-label-sm flex flex-col gap-1">Kapanış durumu
        <select data-durum class="border border-outline-variant rounded-lg p-1.5 text-body-md">
          ${kapanislar.map(d => `<option value="${kacis(d)}">${kacis(d)}</option>`).join('')}
        </select>
      </label>
      <label class="text-label-sm flex flex-col gap-1 hidden" data-kayip-alan>Kayıp nedeni
        <select data-kayip class="border border-outline-variant rounded-lg p-1.5 text-body-md">${KAYIP_NEDENLERI.map(k => `<option>${kacis(k)}</option>`).join('')}</select>
      </label>
      <button data-kaydet class="bg-error text-white px-4 py-1.5 rounded-lg text-label-md font-bold ml-auto">Kapat</button>
    </div>`
  const durumSel = alan.querySelector('[data-durum]')
  const kayipAlan = alan.querySelector('[data-kayip-alan]')
  const kayipGuncelle = () => kayipAlan.classList.toggle('hidden', !kaybedildiMi(durumSel.value))
  durumSel.addEventListener('change', kayipGuncelle); kayipGuncelle()
  alan.querySelector('[data-kaydet]').addEventListener('click', e => {
    const durum = durumSel.value
    notKaydet({
      talep_id: t.id, gorusme_notu: 'Durgun talep kapatıldı.',
      musteri_ad_soyad: t.musteri_ad_soyad, telefon: t.telefon,
      musteri_durumu: durum,
      kayip_nedeni: kaybedildiMi(durum) ? alan.querySelector('[data-kayip]').value : null,
      acan_id: danisman.id, sahip_danisman_id: danisman.id,
    }, e.currentTarget, el, 'Kapatılamadı: ')
  })
}
