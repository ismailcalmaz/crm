// =====================================================================
// kredi-motoru.js — Taşıt kredisi KARŞILAŞTIRMA motoru (23 ürün / 12 kurum)
//
// Kaynak: Göksenil'in gönderdiği "Kredi Motoru Aktarım Dokümanı" v1.0
//   (Kredi_Hesaplama.xlsx çevirisi). Matematik BİREBİR korundu.
//
// ⚠️ BU MOTOR `kredi-hesap.js`'İN YERİNE GEÇMEZ. İki ayrı soruya cevap
//   veriyorlar ve birbirini tamamlıyorlar:
//     kredi-hesap.js  → "bu ARACA ne kadar kredi çıkar?" (TSB kasko bandı,
//                        satış fiyatı → azami kredi, peşinat)
//     kredi-motoru.js → "bu TUTARI en ucuz kimden alırım?" (kurum kıyası)
//   Araç kartında ilki limiti bulur, ikincisi o limitle kurumları sıralar.
//
// ⚠️ PARAMETRELER KODDA DEĞİL, DB'DE (kredi_banka_parametreleri, sql/157).
//   Göksenil kararı: oranlar ayda bir değişiyor; kodda olsa her değişiklik
//   deploy isterdi ve banka oranları için ikinci bir doğru kaynak oluşurdu.
//   Can (kredi müdürü) parametre ekranından düzenler, sürüm geçmişi tutulur.
//
// Saf hesaplama: DOM/ağ/kütüphane bağımlılığı YOK (yükleyici hariç, o da
// supabase'i PARAMETRE olarak alır). Aynı girdi → daima aynı çıktı.
// =====================================================================

// ---------------------------------------------------------------------
// 1) TEMEL MATEMATİK
// ---------------------------------------------------------------------

// ⚠️ EN KRİTİK İNCE AYRINTI. Excel'de bu çağrı `ROUNDUP(x; 0,1)` yazıyor
//   ama Excel ikinci argümanı (num_digits) TAM SAYIYA KIRPAR: 0,1 → 0.
//   Yani "0,1'in katına yuvarla" DEĞİL, "tam sayıya yukarı yuvarla" demek.
//   Yanlış yorumlanırsa her ürünün taksiti kuruş düzeyinde sapar.
const yukariYuvarla = x => Math.ceil(x)

// Excel PMT(oran; vade; -pv) — dönem sonu ödemeli (type=0), gelecek değer 0.
//        pv · i
//   A = ─────────────
//       1 − (1+i)^(−n)
export function pmt(i, n, pv) {
  if (!isFinite(i) || !n) return NaN   // n=0/NaN/undefined → tanımsız
  if (i === 0) return pv / n           // faizsiz: eşit bölüşüm
  return pv * i / (1 - Math.pow(1 + i, -n))
}

// ---------------------------------------------------------------------
// 2) PARAMETRE YÜKLEYİCİ
// ---------------------------------------------------------------------
// Yalnız YÜRÜRLÜKTEKİ sürüm okunur: gecerli_bitis null + durum aktif.
// (ux_kbp_yururlukte kısmi tekil indeksi banka başına tek satır garantiler.)
export async function krediUrunleriYukle(supabase) {
  const { data, error } = await supabase
    .from('kredi_banka_parametreleri')
    .select(`banka_kod, tur, urun_ad, kesinti_katsayisi, sabit_ek, yuzde_ek, ek_masraf,
             carpan, faiz_bantlari, yukari_yuvarla, sabit_vade, pv_ham, net_tutar,
             kosul, formul_tipi, kredi_bankalari(ad)`)
    .is('gecerli_bitis', null).eq('durum', 'aktif').eq('hesaplama_tipi', 'AUTO')
  if (error) { console.error('[db] kredi urun parametreleri', error); return { urunler: [], hata: error.message } }
  const urunler = (data || []).map(p => ({
    banka_kod: p.banka_kod,
    banka_ad: (Array.isArray(p.kredi_bankalari) ? p.kredi_bankalari[0] : p.kredi_bankalari)?.ad || p.banka_kod,
    urun_ad: p.urun_ad || null,
    tur: p.tur || 'bireysel',
    kesinti: Number(p.kesinti_katsayisi),
    sabitEk: Number(p.sabit_ek),
    yuzdeEk: Number(p.yuzde_ek),
    ekMasraf: Number(p.ek_masraf),
    carpan: Number(p.carpan),
    bantlar: Array.isArray(p.faiz_bantlari) ? p.faiz_bantlari : [],
    ceil: !!p.yukari_yuvarla,
    sabitVade: p.sabit_vade || null,
    pvHam: !!p.pv_ham,
    net: !!p.net_tutar,
    kosul: Array.isArray(p.kosul) ? p.kosul : [],
    formul: p.formul_tipi || 'STANDART',
  }))
  return { urunler, hata: null }
}

// ---------------------------------------------------------------------
// 3) PARÇA HESAPLAR
// ---------------------------------------------------------------------

// Vadeye bağlı oran kademesi. vade_max DAHİL (V <= vade_max).
// ⚠️ Kademe KULLANICININ girdiği vade (V) üzerinden seçilir; ürünün sabit
//   vadesi (n) üzerinden DEĞİL. Katkı paylı ürünlerde n=12 ama oran yine
//   V'ye bakılarak bulunur (belge Bölüm 3.2 + Adım 2-3).
function oranBul(bantlar, V) {
  for (const b of bantlar) {
    if (b.vade_max == null) return Number(b.oran)
    if (V <= Number(b.vade_max)) return Number(b.oran)
  }
  return bantlar.length ? Number(bantlar[bantlar.length - 1].oran) : 0
}

// Uygunluk. Kurallar SIRAYLA değerlendirilir: önce tutar sınırı, sonra vade.
// null → uygun · string → uygunsuzluk gerekçesi.
function engelBul(kosullar, A, V) {
  for (const k of kosullar) {
    if (k.tip === 'tutar_esit' && A !== Number(k.deger)) return k.mesaj
    if (k.tip === 'tutar_max' && A > Number(k.deger)) return k.mesaj
    if (k.tip === 'vade_max_tutar_alti' && A <= Number(k.tutar) && V > Number(k.vade)) return k.mesaj
    if (k.tip === 'vade_max_tutar_ustu' && A > Number(k.tutar) && V > Number(k.vade)) return k.mesaj
  }
  return null
}

// Anapara (kredi tutarı) — masraf/komisyon brütleştirmesi bu adımda.
// ⚠️ Yuvarlama YALNIZ burada. Adım 4/6/7/8/9'da ara yuvarlama YOKTUR;
//   tüm ara değerler tam duyarlıklı float olarak taşınır.
function anaparaHesapla(u, A) {
  if (u.formul === 'NET_INDIRIM') {
    // Özel/net ürünler: müşterinin eline geçen tutar (kredi tutarı değil).
    const x = A * u.kesinti - u.sabitEk
    return u.ceil ? yukariYuvarla(x) : x
  }
  if (u.formul === 'BURGAN_TICARI') {
    // ⌈(A + sabitEk)/kesinti + (A + sabitEk) × 0,002 × 0,05⌉
    const t = A + u.sabitEk
    const x = t / u.kesinti + t * 0.002 * 0.05
    return u.ceil ? yukariYuvarla(x) : x
  }
  // STANDART: (A + sabitEk + ekMasraf) / kesinti + A × yuzdeEk
  const x = (A + u.sabitEk + u.ekMasraf) / u.kesinti + A * u.yuzdeEk
  return u.ceil ? yukariYuvarla(x) : x
}

// ---------------------------------------------------------------------
// 4) ANA HESAPLAMA
// ---------------------------------------------------------------------
// @param A       finansman tutarı (TL)
// @param V       vade (ay)
// @param urunler krediUrunleriYukle()'den gelen dizi
// @returns       ürün başına sonuç dizisi. SIRALAMA YAPILMAZ — o sunum
//                katmanının işi (uygunlar önce, taksit artan).
export function krediHesapla(A, V, urunler) {
  return (urunler || []).map(u => {
    const engel = engelBul(u.kosul, A, V)
    const n = u.sabitVade || V
    const oran = oranBul(u.bantlar, V)
    const efektif = oran * u.carpan          // vergi FAİZE çarpan, taksite değil
    const anapara = anaparaHesapla(u, A)
    const pv = u.pvHam ? A : anapara         // 6 üründe taksit ham tutardan
    const taksit = pmt(efektif, n, pv)
    const toplam = taksit * n
    return {
      banka_kod: u.banka_kod, banka_ad: u.banka_ad, urun_ad: u.urun_ad,
      tur: u.tur, net: u.net, engel,
      n, oran, efektif, anapara, taksit, toplam,
      maliyet: toplam - A,
    }
  })
}

// ---------------------------------------------------------------------
// 5) YARDIMCI HESAPLAR
// ---------------------------------------------------------------------

// Harç: satış beyanının binde 2'si. Başka hiçbir girdiye bağlı DEĞİL —
// finansman tutarı, kredi ürünü veya geri ödemeyle ilişkisi yok.
// (Önceki sürümde Otosor geri ödemesine bağlıydı; sadeleştirildi.)
export function harcMaliyeti(satisBeyani) {
  return (Number(satisBeyani) || 0) * 0.002
}

// Kredi kartı taksit çarpanları — gereken limit = tutar × çarpan.
// ⚠️ 11 taksit çarpanı (1,4942) 12 taksitten (1,3278) YÜKSEK. Kaynak
//   Excel'de böyle; belge Ek B.2'de "yazım hatası olabilir" diye
//   işaretlenmiş. BİREBİR korundu — düzeltme ayrı bir karardır.
export const KK_CARPAN = {
  1: 1.0357, 2: 1.0651, 3: 1.0867, 4: 1.1093,
  5: 1.1326, 6: 1.1571, 7: 1.1827, 8: 1.2095,
  9: 1.2375, 10: 1.2668, 11: 1.4942, 12: 1.3278,
}
export const KK_TAKSITLER = Object.keys(KK_CARPAN).map(Number).sort((a, b) => a - b)

// Tablo dışı taksitte NaN — uydurma değer üretme.
export function krediKartiLimiti(tutar, taksit) {
  const c = KK_CARPAN[taksit]
  return c === undefined ? NaN : (Number(tutar) || 0) * c
}

// ---------------------------------------------------------------------
// 6) SUNUM YARDIMCISI
// ---------------------------------------------------------------------
// Sıralama: uygunlar önce, aralarında taksit ARTAN; uygunsuzlar en sonda.
// Eşitlikte tanım sırası korunur (Array.sort kararlı).
// ⚠️ Sıralama YUVARLANMAMIŞ taksit değerine göre yapılır; ekrandaki 2
//   basamaklı gösterim yalnızca sunumdur.
export function krediSirala(sonuclar) {
  return [...(sonuclar || [])].sort((a, b) => {
    if (!!a.engel !== !!b.engel) return a.engel ? 1 : -1
    if (a.engel && b.engel) return 0
    return a.taksit - b.taksit
  })
}

// Belirli bir tür içinde EN UCUZ uygun teklif (araç kartı birleşimi için).
// Göksenil: "araç kartındaki simülatörde bireysel ve tüzelde en ucuz hangi
//   banka veriyorsa o altta gösterilmeli."
export function enUcuz(sonuclar, tur) {
  const uygun = (sonuclar || []).filter(s => !s.engel && (!tur || s.tur === tur) && isFinite(s.taksit))
  if (!uygun.length) return null
  return uygun.reduce((en, s) => (s.taksit < en.taksit ? s : en))
}
