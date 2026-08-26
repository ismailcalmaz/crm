// =====================================================================
// sigorta-ortak.js — Sigorta sayfalarının paylaştığı yardımcılar
//   Kopya yardımcı yazma (bu projenin 1 no'lu hatası) yerine tek kaynak.
// =====================================================================
import { kacis } from './veri.js'
import { mat } from './stitch-ui.js'

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100
export const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000

// Tarih aritmetiği (YYYY-MM-DD)
export function artiYil(iso, y) { const d = new Date(iso + 'T00:00:00'); d.setFullYear(d.getFullYear() + y); return d.toISOString().slice(0, 10) }
export function artiGun(iso, g) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + g); return d.toISOString().slice(0, 10) }
export function gunFark(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000) }

// Vergi kırılımı — sql/36 sigorta_vergi_hesapla ile birebir
export function vergiHesapla(brut, net, profil) {
  brut = Number(brut) || 0; net = Number(net) || 0
  if (profil === 'MUAF' || !brut || !net) return { gv: 0, thgf: 0, guvence: 0 }
  const bsmv = round2(net * 0.05)
  const kalan = round2(brut - net - bsmv)
  if (profil === 'TRAFIK' && kalan > 0) return { gv: bsmv, thgf: round2(kalan * 5 / 7), guvence: round2(kalan * 2 / 7) }
  return { gv: round2(brut - net), thgf: 0, guvence: 0 }
}

// Yapboz günlük ücreti — sql/36 yapboz_gunluk_ucret ile birebir
//   Şirket SABIT_TUTAR ise sabit/60, değilse poliçe brütü/60
export function yapbozGunluk(sirket, aracTipi, policeBrut, gun = 60) {
  let taban
  if (sirket && sirket.kisa_donem_fiyat_tipi === 'SABIT_TUTAR') {
    taban = aracTipi === 'KAMYONET' ? (sirket.kisa_donem_kamyonet ?? sirket.kisa_donem_otomobil) : sirket.kisa_donem_otomobil
  }
  taban = (taban == null) ? policeBrut : taban
  return round4((Number(taban) || 0) / gun)
}

// Beklenen iade — sql/36 yapboz_beklenen_iade ile birebir (client önizleme)
//   satisGunuDahil: sigorta_ayarlari.yapboz_satis_gunu_dahil
export function beklenenIade(sirket, aracTipi, policeBrut, alis, satis, gun = 60, satisGunuDahil = false) {
  let kull = Math.max(gunFark(alis, satis) + (satisGunuDahil ? 1 : 0), 0)
  kull = Math.min(kull, gun)
  const kalan = gun - kull
  const gunluk = yapbozGunluk(sirket, aracTipi, policeBrut, gun)
  let tutar = round2(gunluk * kalan)
  let tavan = false
  if (sirket && sirket.iade_kural === 'TAVANLI_PRO_RATA' && kalan > (sirket.iade_tavan_esik_gun ?? 999)) {
    const t = aracTipi === 'KAMYONET' ? (sirket.iade_tavan_kamyonet ?? sirket.iade_tavan_otomobil) : sirket.iade_tavan_otomobil
    if (t != null && tutar > Number(t)) { tutar = Number(t); tavan = true }
  }
  return { kullanilan: kull, kalan, tutar, tavan }
}

// Sigorta şirketi seçici (ana/alt rozet + arama). onSec(sirket) çağrılır.
export function sirketSecici(sirketler, onSec) {
  const byId = id => sirketler.find(s => s.id === id)
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[12vh] px-4'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-lg overflow-hidden" onclick="event.stopPropagation()">
    <div class="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">${mat('search', 'text-on-surface-variant')}
      <input id="ssAra" placeholder="Sigorta şirketi ara…" class="flex-1 outline-none text-body-lg bg-transparent" />
      <kbd class="text-[10px] border border-outline-variant rounded px-1.5 py-0.5 text-on-surface-variant">ESC</kbd></div>
    <div id="ssListe" class="max-h-[52vh] overflow-y-auto p-2"></div></div>`
  document.body.appendChild(ov)
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  ov.addEventListener('click', kapat); document.addEventListener('keydown', esc)
  const inp = ov.querySelector('#ssAra'); const liste = ov.querySelector('#ssListe')
  const ciz = (q = '') => {
    const f = sirketler.filter(s => !q || (s.ad + ' ' + (s.kisa_kod || '')).toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')))
    // ⚠️ ALT ŞİRKETTE ACENTE ADI YAZILIR (Göksenil, 18 Ağu 2026):
    //    "alt şirket kısmında hangi acenteden yapıyorsak onun da gözükmesi
    //     lazım — Sigortayeri, Erkoç gibi". Bağ Tanımlar'da ZATEN kurulu
    //    (ör. Zurich → İzmir Erkoç); eksik olan yalnızca burada gösterilmesiydi.
    const acenteAdi = id => (sirketler.find(x => x.id === id) || {}).ad || ''
    liste.innerHTML = f.length ? f.map(s => `<button data-s="${s.id}" class="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-container-low text-left">
      <span class="flex items-center gap-2 min-w-0">${s.ana_sirket_id ? mat('subdirectory_arrow_right', 'text-[16px] text-on-surface-variant') : ''}<span class="min-w-0"><span class="font-semibold text-on-surface">${kacis(s.ad)}</span>${
        s.ana_sirket_id ? `<span class="block text-[11px] text-on-surface-variant truncate">${kacis(acenteAdi(s.ana_sirket_id))} üzerinden</span>` : ''}</span></span>
      <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${s.ana_sirket_id ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-primary-fixed text-primary'}">${s.ana_sirket_id ? 'ALT ŞİRKET' : 'ANA ŞİRKET'}</span></button>`).join('')
      : `<p class="p-6 text-center text-on-surface-variant text-label-md">Sonuç yok. Şirketi <b>Tanımlar</b>'dan ekleyin.</p>`
    liste.querySelectorAll('[data-s]').forEach(el => el.addEventListener('click', () => { onSec(byId(el.dataset.s)); kapat() }))
  }
  ciz(); inp.focus()
  inp.addEventListener('input', () => ciz(inp.value))
}
