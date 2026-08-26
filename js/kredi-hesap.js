// =====================================================================
// kredi-hesap.js — Araç kredi simülatörü: TEK KAYNAK finansal formüller.
//   Göksenil'in verdiği Excel kuralları BİREBİR çevrildi (tahmin YOK).
//   Saf JS, hiçbir şey import etmez → ileride SQL/edge ile paylaşılabilir.
//   §5/K5: JS'te finansal formül tekrarı YASAK — bu dosya o tek yer.
//
//   FAİZ ORANLARI DEĞİŞKEN: hesap fonksiyonları `oranlar` parametresi alır.
//   Bu değerler DB'den (ayarlar) okunur; kredi personeli (can.kaya) düzenler.
//   VARSAYILAN_ORANLAR yalnızca DB boşsa devreye giren emniyet değeridir.
//
//   Girdiler: fiyat = güncel satış fiyatı (v_arac_guncel_fiyat)
//             kasko = TSB kasko bedeli (tsb_kasko_liste.kasko_degeri)
//   durum: 'OK' | 'FIYATLA' | 'CIKMAZ' | 'KASKO_YOK'
//
//   Efektif aylık oran = taban × carpan (örn. OTOSOR 3,6% × 1,3 = %4,68).
//   ⚠ Bireysel'in kendi oran/vadesi var; değeri can.kaya kesinleştirecek
//     (varsayılan geçicidir, işaretli).
// =====================================================================

// ---------------------------------------------------------------------
// GİRDİ YÜKLEYİCİLERİ — hesabın iki değişken girdisi (faiz oranları ve TSB
// kasko bedeli) TEK YERDEN okunur. Daha önce araç kartında özel birer kopya
// vardı; cam etiketi kendi (eksik) kopyasını kullanınca KÂĞITTAKİ kredi
// tutarı EKRANDAKİNDEN farklı çıkıyordu. supabase parametre olarak geçer →
// bu dosya hâlâ hiçbir şey import etmez (SQL/edge'e taşınabilirliği korunur).
// ---------------------------------------------------------------------
export async function krediOranlariYukle(supabase) {
  const { data, error } = await supabase.from('kredi_oranlari').select('*').eq('id', 1).maybeSingle()
  if (error) { console.error('[db] kredi_oranlari', error); return VARSAYILAN_ORANLAR }
  if (!data) return VARSAYILAN_ORANLAR
  return {
    otosor:   { taban: Number(data.otosor_taban), carpan: Number(data.otosor_carpan) },
    bireysel: { taban: Number(data.bireysel_taban), carpan: Number(data.bireysel_carpan), vade: Number(data.bireysel_vade) },
    tuzel:    { taban: Number(data.tuzel_taban), carpan: Number(data.tuzel_carpan), vade: Number(data.tuzel_vade) },
  }
}

// TSB kasko bedeli — ticari (tüzel) kredinin tabanı.
// gt(0): bedeli 0 olan satır kredi hesabını sıfırlar · liste_donemi desc:
// aynı araç için birden çok liste dönemi varsa EN GÜNCEL olan alınır.
export async function kaskoBedeliYukle(supabase, a) {
  if (!a?.tsb_marka_id || !a?.tsb_tip_id || !a?.yil) return null
  const { data, error } = await supabase.from('tsb_kasko_liste')
    .select('kasko_degeri').eq('marka_kodu', a.tsb_marka_id).eq('tip_kodu', a.tsb_tip_id)
    .eq('model_yili', a.yil).gt('kasko_degeri', 0).order('liste_donemi', { ascending: false }).limit(1)
  if (error) { console.error('[db] tsb kasko', error); return null }
  return data?.[0]?.kasko_degeri ?? null
}

export const VARSAYILAN_ORANLAR = {
  otosor:   { taban: 0.036,  carpan: 1.3 },              // %4,68/ay
  bireysel: { taban: 0.0468, carpan: 1,   vade: 36 },   // ⚠ geçici — kendi oran/vadesi can.kaya'dan
  tuzel:    { taban: 0.0369, carpan: 1.05, vade: 60 },  // %3,8745/ay · 60 ay
}
const efektifOran = o => (o.taban || 0) * (o.carpan != null ? o.carpan : 1)

// Excel PMT(oran, vade, bugünkü_değer) — pv negatif → pozitif taksit
export function pmt(oran, vade, pv) {
  if (!vade) return 0
  if (!oran) return -pv / vade
  return (-pv * oran) / (1 - Math.pow(1 + oran, -vade))
}
// Ters: hedef taksitten kredi çöz — "taksit ↑ ⇒ kredi ↑ ⇒ peşinat ↓"
export function taksittenKredi(oran, vade, taksit) {
  if (!vade || taksit <= 0) return 0
  if (!oran) return taksit * vade
  return taksit * (1 - Math.pow(1 + oran, -vade)) / oran
}

// OTOSOR vade kuralı (fiyata göre)
export function otosorVade(fiyat) {
  return fiyat < 800000 ? 36 : fiyat < 1200000 ? 24 : 12
}

// --- OTOSOR --- taksit = PMT(oran, AQ vade, -AR maxKredi); ÇIKMAZ: fiyat ≥ 2.000.000
export function hesapOtosor(fiyat, oranlar = VARSAYILAN_ORANLAR) {
  if (fiyat == null) return { durum: 'FIYATLA' }
  if (fiyat >= 2000000) return { durum: 'CIKMAZ', uyari: 'Fiyat 2.000.000 ₺ ve üzeri' }
  const vade = otosorVade(fiyat)
  const maxKredi = fiyat > 1200000 ? (fiyat - 100000) * 0.70 : fiyat
  const oran = efektifOran(oranlar.otosor)
  return { durum: 'OK', oran, vade, maxKredi, kredi: maxKredi, pesinat: fiyat - maxKredi, taksit: pmt(oran, vade, -maxKredi) }
}

// --- BİREYSEL (kasko bandına bağlı; kendi oran/vadesi) ---
export function hesapBireysel(fiyat, kasko, oranlar = VARSAYILAN_ORANLAR) {
  if (fiyat == null) return { durum: 'FIYATLA' }
  if (kasko == null || kasko <= 0) return { durum: 'KASKO_YOK', uyari: 'TSB kasko bedeli yok' }
  if (kasko > 2000001) return { durum: 'CIKMAZ', uyari: 'Kasko bedeli 2.000.001 ₺ üzeri' }
  let kredi = kasko < 400000 ? (kasko * 0.70) / 1.005
            : kasko < 799000 ? (kasko * 0.50) / 1.005
            : kasko < 1200000 ? (kasko * 0.30) / 1.005
            : kasko < 2000000 ? (kasko * 0.20) / 1.005
            : 0
  kredi = Math.min(kredi, fiyat)
  const oran = efektifOran(oranlar.bireysel)
  const vade = oranlar.bireysel.vade || otosorVade(fiyat)
  return { durum: 'OK', oran, vade, maxKredi: kredi, kredi, pesinat: fiyat - kredi, taksit: pmt(oran, vade, -kredi) }
}

// --- TÜZEL — Göksenil Excel formülü (finanse edilen tutar üzerinden):
//   Peşinat = fiyat − kasko/1.005 (<0 → "Tamamına finansman", peşinat 0)
//   Kredi   = min(kasko/1.005, fiyat)
//   Taksit  = PMT(oran, vade, −kredi) → vade seçilince (12/24/36/48/60) taksit DEĞİŞİR.
//   Vade seçenekleri VADELER_TUZEL; varsayılan 60.
export const VADELER_TUZEL = [12, 24, 36, 48, 60]
export function hesapTuzel(fiyat, kasko, oranlar = VARSAYILAN_ORANLAR) {
  if (fiyat == null) return { durum: 'FIYATLA' }
  if (kasko == null || kasko <= 0) return { durum: 'KASKO_YOK', uyari: 'TSB kasko bedeli yok' }
  const vade = oranlar.tuzel.vade || 60
  const oran = efektifOran(oranlar.tuzel)
  const tabanKredi = kasko / 1.005
  const kredi = Math.min(tabanKredi, fiyat)
  const pesinat = Math.max(0, fiyat - tabanKredi)
  const uyari = (fiyat - tabanKredi < 0) ? 'Tamamına finansman' : undefined
  return { durum: 'OK', oran, vade, maxKredi: kredi, kredi, pesinat, taksit: pmt(oran, vade, -kredi), uyari }
}

// Danışman peşinatı/krediyi değiştirince yeniden hesapla (oran + vade kural sabiti)
export function yenidenHesapla(oran, vade, fiyat, kredi, maxKredi) {
  const k = Math.max(0, Math.min(kredi, maxKredi))
  return { kredi: k, pesinat: fiyat - k, taksit: pmt(oran, vade, -k) }
}

export const KREDI_TIPLERI = [
  { kod: 'otosor', ad: 'OTOSOR' },
  { kod: 'bireysel', ad: 'Bireysel Kredi' },
  { kod: 'tuzel', ad: 'Tüzel Kredi' },
]
