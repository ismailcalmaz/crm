// =====================================================================
// eslestirme-cekirdek.js — Talep ↔ Stok eşleştirmenin TEK KAYNAĞI
//
// Bu dosya hem tarayıcıda (crm/js) hem Deno'da (edge function) çalışır:
// saf JavaScript, hiçbir şey import etmez, DOM/Supabase/console kullanmaz.
//
// NEDEN AYRI DOSYA: bu mantık eskiden iki yerde ayrı ayrı yazılıydı
// (crm/js/eslestirme.js ve eslesme-tarama/index.ts). İkisi bir kez
// birbirinden saptı: sql/11 durum revizyonu enum'ları Title Case'e
// çevirdi, TS tarafındaki BÜYÜK HARFLİ liste bayat kaldı ve kapanmış
// müşterilere push bildirimi gitti. Tek kaynak bunu önler.
//
// ⚠️ İKİ KOPYA VAR (deploy hedefleri farklı ağaçlar):
//     crm/js/eslestirme-cekirdek.js          → GitHub Pages (subtree)
//     supabase/functions/_shared/…           → Supabase CLI (esbuild)
//   İkisi BİREBİR aynı olmalı. `node dogrula-cekirdek.js` farkı yakalar
//   ve deploy öncesi çalıştırılmalıdır.
// =====================================================================

// --- Durum modeli (DB CHECK constraint ile birebir) -------------------
export const ACIK_ASAMALAR = [
  'Yeni Talep',
  'İletişim Kuruldu',
  'Test / Ekspertiz / Teklif',
  'Pazarlık',
  'Kredi Bekliyor',
  'Kapora / Rezerve',
]
export const KAZANILDI_DURUMLARI = ['Satış Tamamlandı', 'Alım Yapıldı']
export const KAYBEDILDI = 'Kaybedildi'
export const KAPANIS_DURUMLARI = [...KAZANILDI_DURUMLARI, KAYBEDILDI]

export function kapanisMi(durum) { return KAPANIS_DURUMLARI.includes(durum) }

// --- Normalize --------------------------------------------------------
// Türkçe-duyarsız: küçült + Türkçe harfleri ASCII'ye katla.
//   Kritik: "CLIO" tr-locale'de "clıo" (noktasız ı) olur, "Clio" ise "clio"
//   → noktasız/noktalı i eşleşmezdi. Katlama bunu ve ş/ğ/ü/ö/ç farkını giderir.
export const norm = s => (s || '').toString().toLocaleLowerCase('tr')
  .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
  .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .trim()

export const joker = v => { const n = norm(v); return !n || n === 'farketmez' || n === '-' }

// --- Eşleştirme -------------------------------------------------------
// Talebin araç terimi, aracın MARKA+MODEL birleşimiyle karşılaştırılır.
//
// NEDEN BİRLEŞİK: müşteriler çoğunlukla model adı söylüyor ("golf var mı",
// "clio bakıyorum") ve bu değer talep.marka alanına yazılıyor. Eskiden
// karşılaştırma marka↔marka, model↔model şeklindeydi; "golf" hiçbir zaman
// "VOLKSWAGEN"e uymuyordu ve eşleştirme Instagram taleplerinde fiilen hiç
// çalışmıyordu. Birleşik metinde "volkswagen golf".includes("golf") → uyar.
// Distribütör eki de aynı yolla çözülür: "renault (oyak) megane" ⊃ "renault".
const ARAC_TERIM_MIN = 3   // 1-2 harflik terim her şeye uyar, gürültü olur

function terimUyar(aracMetin, terim) {
  const t = norm(terim)
  if (!t || t.length < ARAC_TERIM_MIN) return true      // ayırt edici değil, eleme
  // Müşteri belirli bir araç adı söylediyse, marka/modeli boş bir stok
  // kaydını göstermek gürültü. Eskiden bunlar her talebe uyuyordu ve
  // "golf" isteyen müşteriye verisi eksik bir karavan çıkıyordu.
  if (!aracMetin) return false
  return aracMetin.includes(t) || t.includes(aracMetin)
}

// Bir araç, bir talebin kriterlerine uyuyor mu?
export function aracUyar(arac, talep) {
  const aracMetin = norm([arac.marka, arac.model].filter(Boolean).join(' '))
  if (!joker(talep.marka) && !terimUyar(aracMetin, talep.marka)) return false
  if (!joker(talep.model) && !terimUyar(aracMetin, talep.model)) return false
  // Bütçe (%5 üst, %10 alt tolerans)
  const fiyat = Number(arac.fiyat) || 0
  if (fiyat > 0) {
    if (talep.butce_max && fiyat > Number(talep.butce_max) * 1.05) return false
    if (talep.butce_min && fiyat < Number(talep.butce_min) * 0.9) return false
  }
  // Model yılı aralığı
  const yil = Number(arac.yil) || 0
  if (yil > 0) {
    if (talep.model_yili_min && yil < Number(talep.model_yili_min)) return false
    if (talep.model_yili_max && yil > Number(talep.model_yili_max)) return false
  }
  return true
}

// Talebe uygun aktif araçlar (fiyata göre artan)
export function uygunAraclar(talep, araclar) {
  const aktif = (araclar || []).filter(a => (a.durum || 'aktif') === 'aktif')
  return aktif.filter(a => aracUyar(a, talep))
    .sort((a, b) => (Number(a.fiyat) || 0) - (Number(b.fiyat) || 0))
}

// Bir araca uygun bekleyen talepler.
// Sıkı kural: talep BELİRLİ bir araç istemiş olmalı (marka veya model);
// "genel bilgi almak istiyor" gibi belirsiz talepler her araca uymasın.
export function uygunTalepler(arac, talepler) {
  return (talepler || []).filter(t =>
    (!joker(t.marka) || !joker(t.model)) && aracUyar(arac, t))
}
