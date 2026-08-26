// =====================================================================
// eslestirme.js — Talep ↔ Stok eşleştirme (frontend girişi)
//
// Mantığın kendisi eslestirme-cekirdek.js'te; burası sadece yeniden
// dışa aktarır. Böylece edge function (supabase/functions/eslesme-tarama)
// ile aynı kodu kullanır ve ikisi birbirinden sapamaz.
// Mevcut import'lar bozulmasın diye isimler aynı bırakıldı.
// =====================================================================
export { aracUyar, uygunAraclar, uygunTalepler, norm, joker } from './eslestirme-cekirdek.js'
