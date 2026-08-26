// =====================================================================
// masraf-kapi.js — G5: MASRAF ↔ OPERASYON KAPISI (sql/111)
//
//   Göksenil: "…operasyon birimi yapılan / yapılacak işi yazmaz ise masraf
//   defterine işlerken UYARI VERECEK."
//
//   ⚠️ UYARI, ENGEL DEĞİL. Masraf her hâlükârda kaydedilir. Amaç muhasebeyi
//   durdurmak değil, operasyonun iş yazmadığını görünür kılmak — engelleseydik
//   gerçek bir fatura sırf operasyon geç yazdı diye deftere girmez, muhasebe de
//   kaydı sistem dışına kaçırırdı.
//
//   İki ekran da bunu kullanır (araç detayı masraf defteri + fiyatlama).
//   Ortak modül: kural iki yerde yazılırsa biri unutulur ve ekranlar ayrışır.
//
//   Karar SUNUCUDA: hangi masraf tipinin operasyon kaydı beklediği
//   tanimlar.ozellikler.operasyon_gerekli'de, kontrol masraf_operasyon_kontrol()
//   içinde. Burada hesap YOK — çağır, cevabı göster.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis } from './veri.js'

/**
 * Bu araç + masraf tipi için operasyon uyarısı var mı?
 * @returns {Promise<string|null>} uyarı metni ya da null
 */
export async function masrafOperasyonUyarisi(aracId, masrafTipi) {
  if (!aracId || !masrafTipi) return null
  const { data, error } = await supabase.rpc('masraf_operasyon_kontrol', {
    p_arac: aracId, p_masraf_tipi: masrafTipi,
  })
  // Kontrol çalışmazsa masraf girişi ENGELLENMEZ — uyarı gösterilemez, o kadar.
  // Sessiz catch değil: hata konsola yazılır (§5).
  if (error) { console.error('[G5] masraf operasyon kontrol', error); return null }
  return data?.uyari || null
}

/**
 * Uyarı şeridini bir kaba çizer (uyarı yoksa kabı boşaltır).
 * @param {HTMLElement|string} kap element ya da id
 */
export function masrafUyariGoster(kap, uyari) {
  const el = typeof kap === 'string' ? document.getElementById(kap) : kap
  if (!el) return
  if (!uyari) { el.innerHTML = ''; return }
  el.innerHTML = `<div class="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-3 py-2 text-sm">
      <span class="material-symbols-outlined text-[18px] shrink-0">engineering</span>
      <span>${kacis(uyari)}</span>
    </div>`
}

/**
 * Tip alanı değişince uyarıyı tazeleyen hazır bağlayıcı.
 * @param {object} o {tipEl, kapId, aracId, kod} — kod: değeri masraf tipi
 *        koduna çeviren fonksiyon (araç detayında serbest metin var).
 */
export function masrafKapiBagla({ tipEl, kapId, aracId, kod = v => v }) {
  if (!tipEl) return
  const tazele = async () => {
    const t = kod(tipEl.value)
    masrafUyariGoster(kapId, t ? await masrafOperasyonUyarisi(aracId(), t) : null)
  }
  tipEl.addEventListener('change', tazele)
  tipEl.addEventListener('input', tazele)
  return tazele
}
