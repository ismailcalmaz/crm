// =====================================================================
// veri.js — Çekirdek CRM için ortak sabitler ve yardımcılar
// =====================================================================
import { supabase } from './supabase-client.js'

// =====================================================================
// DURUM MODELİ (sql/11 ile revize) — tek boyut = AŞAMA (pipeline).
//   Açık aşamalar → Kazanıldı (Satış/Alım) / Kaybedildi (kapanış).
//   Kaybedildi'de ayrı "kayip_nedeni" alanı zorunlu. Sıcaklık YOK.
//   Bu liste DB CHECK constraint ile BİREBİR aynı olmalı.
// =====================================================================
// NOT: Bu dört sabit artık eslestirme-cekirdek.js'te tanımlı — edge
// function da oradan okuyor. Böylece durum listeleri iki tarafta
// birbirinden sapamaz (sql/11 göçünden sonra tam bu olmuş, kapanmış
// müşterilere push gitmişti). Buradan yeniden dışa aktarılıyor ki
// mevcut `from './veri.js'` import'ları bozulmasın.
export {
  ACIK_ASAMALAR, KAZANILDI_DURUMLARI, KAYBEDILDI, KAPANIS_DURUMLARI,
} from './eslestirme-cekirdek.js'
import {
  ACIK_ASAMALAR, KAZANILDI_DURUMLARI, KAYBEDILDI, KAPANIS_DURUMLARI,
} from './eslestirme-cekirdek.js'

// Tüm durumlar (form select'leri bunu kullanır)
export const DURUMLAR = [...ACIK_ASAMALAR, ...KAZANILDI_DURUMLARI, KAYBEDILDI]

// Kapanış = Kazanıldı + Kaybedildi (danışmandan gizlenir, sadece yönetici
// görür; RLS ile aynı). Tanımı eslestirme-cekirdek.js'te, yukarıda yeniden
// dışa aktarılıyor.

// Danışman ana sayfa "cevap bekleyen" (idle, aksiyon gereken açık aşamalar)
export const AKSIYON_DURUMLARI = ['Yeni Talep', 'İletişim Kuruldu', 'Kredi Bekliyor']

// =====================================================================
// KREDİ — banka listesi ve sonuç durumları
//   Kredi biriminin "Kredi Takip" e-tablosundaki kolon sırasıyla aynı;
//   ekip aynı sırada görsün diye bilinçli olarak korunuyor.
//   Yeni kurum eklemek: sadece bu diziye ekle (şema değişmez).
// =====================================================================
export const BANKALAR = [
  'Burgan', 'Aktif', 'Yapı Kredi', 'ALJ Finans', 'Koç Finans', 'Quick Finans',
  'Kts/Teb', 'Akbank', 'Garanti', 'Otosor', 'Oto Vadeli', 'Vakıf Katılım',
]

// Renkler e-tablodaki alışkanlığı korur: onay yeşil, kısmi açık yeşil,
// red kırmızı, kullandırıldı sarı, pasif soluk.
export const KREDI_SONUCLARI = [
  ['degerlendirmede', 'Değerlendirmede', 'bg-blue-50 text-blue-900 border-blue-200'],
  ['on_onay',         'Ön Onay',         'bg-sky-100 text-sky-900 border-sky-300'],
  ['onay',            'Onay',            'bg-green-700 text-white border-green-800'],
  ['kismi_onay',      'Kısmi Onay',      'bg-green-100 text-green-900 border-green-300'],
  ['ret',             'Red',             'bg-red-600 text-white border-red-700'],
  ['kullandirildi',   'Kullandırıldı',   'bg-yellow-300 text-yellow-950 border-yellow-500'],
  ['pasif',           'Pasif',           'bg-surface-container-high text-on-surface-variant border-outline-variant'],
]
export function krediSonucEtiket(k) { return (KREDI_SONUCLARI.find(x => x[0] === k) || [])[1] || '—' }
export function krediSonucSinif(k) { return (KREDI_SONUCLARI.find(x => x[0] === k) || [])[2] || 'bg-surface-container border-outline-variant text-on-surface-variant' }

export const RED_NEDENLERI = [
  ['kkb_findeks', 'KKB / Findeks olumsuz'],
  ['gelir_yetersiz', 'Gelir yetersiz'],
  ['icra_dosyasi', 'İcra dosyası'],
  ['dava', 'Dava dosyası'],
  ['tramer', 'Tramer'],
  ['evrak_eksik', 'Evrak eksik'],
  ['musteri_vazgecti', 'Müşteri vazgeçti'],
  ['diger', 'Diğer'],
]

// Kayıp nedenleri (sadece Kaybedildi seçilince) — DB CHECK ile aynı
export const KAYIP_NEDENLERI = ['Fiyat yüksek', 'Kredi reddi', 'Faiz Yüksek', 'Başka bayiden aldı', 'Ulaşılamadı', 'Vazgeçti', 'Stokta yok']

// Hızlı not çipleri — duruma göre tek dokunuşla not başlangıcı (danışman düzenleyebilir)
// Peşinat konuşması — kampanya verisinden çıkan en önemli hamle.
// Peşinatsız gelen müşterilerin %10'u doğrudan çıkıyor; kalanın %30'u
// %20 peşinata ikna edilince satışa dönüyor (toplam ~%37). Yani bu
// konuşma yapılmadığında müşteri kaybediliyor. Metin bilinçli olarak
// yumuşak: kötü haberle başlamıyor, peşinatı müşterinin yararı olarak
// sunuyor (taksit düşer) ve karar için baskı yapmıyor.
export const PESINAT_CIPLERI = [
  'Peşinatsız seçenek anlatıldı, süreç kişiye göre değişkenlik gösterebiliyor',
  '%20 peşinatla onayın çok daha rahat çıktığı ve taksitin düştüğü anlatıldı',
  'Örnek verildi: 800.000 araçta %20 = 160.000 peşinat',
  'Kısmi peşinat da olur denildi, illa %20 gerekmiyor',
  'Düşünüp dönecek — dosyayı takip ediyorum dendi',
  'Peşinat bulabileceğini söyledi',
  'Peşinat veremiyor, peşinatsız devam edilecek',
]

export const HIZLI_NOTLAR = {
  'Yeni Talep': ['Ulaşılamadı, tekrar aranacak', 'Mesaj bırakıldı', 'İlk temas kuruldu',
    ...PESINAT_CIPLERI],
  'İletişim Kuruldu': ['Ulaşılamadı', 'Bilgi verildi', 'Görmeye/test için gelecek', 'Fiyat konuşuldu', 'Düşünüyor, geri dönecek',
    ...PESINAT_CIPLERI],
  'Test / Ekspertiz / Teklif': ['Aracı gördü / beğendi', 'Ekspertize gidildi', 'Teklif sunuldu'],
  'Pazarlık': ['Fiyat pazarlığı sürüyor', 'Takas değerlemesi bekleniyor', 'Son teklif verildi'],
  'Kredi Bekliyor': ['Kredi başvurusu yapıldı', 'Evrak bekleniyor', 'Banka onayı bekleniyor'],
  'Kapora / Rezerve': ['Kapora alındı', 'Araç rezerve edildi', 'Teslim tarihi belirlendi'],
  'Satış Tamamlandı': ['Satış tamamlandı, teslim edildi'],
  'Alım Yapıldı': ['Araç alındı / takas tamamlandı'],
  'Kaybedildi': ['Ulaşılamadı', 'Vazgeçti', 'Başka yerden aldı', 'Bütçe uymadı'],
}
export function hizliNotlar(durum) { return HIZLI_NOTLAR[durum] || [] }

// Bugünün tarihi (YYYY-MM-DD, yerel) — tarih inputları ve takip karşılaştırması için
export function bugunISO() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export function kapanisMi(durum) { return KAPANIS_DURUMLARI.includes(durum) }
export function kazanildiMi(durum) { return KAZANILDI_DURUMLARI.includes(durum) }
export function kaybedildiMi(durum) { return durum === KAYBEDILDI }

// Durum → rozet renk sınıfı
export function durumSinifi(durum) {
  if (KAZANILDI_DURUMLARI.includes(durum) || durum === 'Kapora / Rezerve') return 'basari'
  if (durum === KAYBEDILDI) return 'hata'
  if (['İletişim Kuruldu', 'Test / Ekspertiz / Teklif', 'Pazarlık', 'Kredi Bekliyor'].includes(durum)) return 'aktif'
  if (durum === 'Yeni Talep') return 'bilgi'
  return 'notr'
}

// --- Danışman haritası (id → kayıt). Küçük tablo, bir kez çekilir, önbelleğe alınır ---
let _danismanMap = null
export async function danismanMap() {
  if (_danismanMap) return _danismanMap
  const { data, error } = await supabase.from('danismanlar').select('id, ad_soyad, email, rol')
  if (error) { console.error('danismanlar okunamadı:', error); return {} }
  _danismanMap = {}
  for (const d of data) _danismanMap[d.id] = d
  return _danismanMap
}
export function danismanAdi(map, id) {
  if (!id) return '—'
  return map[id]?.ad_soyad || '—'
}

// --- Görüntü metni: TÜRKÇE büyük harf + kod temizliği -------------------
// ⚠️ trBuyuk() ARAMA NORMALİZASYONUDUR (Ç→C, İ→I katlar). GÖRÜNTÜDE
// KULLANMA — "BENZİN" yerine "BENZIN", "OTOMATİK" yerine "OTOMATIK" yazar.
// Görüntü için DAİMA buyuk() kullan.
export const buyuk = v => String(v ?? '').toLocaleUpperCase('tr')

// Enum kodunu insan diline çevir: alt çizgi ASLA ekranda görünmez.
// Göksenil kuralı: "_ çizgi kesinlikle göstermeyeceğiz programda."
export const kodTemiz = v => String(v ?? '').replace(/_/g, ' ').trim()

// tanimlar sözlüğü (tip|kod → ad). Bir kez çekilir, sayfada tekrar kullanılır.
// Kod yerine DAİMA ad gösterilir; ad yoksa kod temizlenip gösterilir.
let _tanimSozluk = null
export async function tanimSozlukYukle(supabase, tipler = null) {
  if (_tanimSozluk) return _tanimSozluk
  let q = supabase.from('tanimlar').select('tip, kod, ad').eq('aktif', true)
  if (tipler) q = q.in('tip', tipler)
  const { data, error } = await q
  if (error) { console.error('[tanim sözlük]', error); return (_tanimSozluk = {}) }
  _tanimSozluk = {}
  for (const t of (data || [])) _tanimSozluk[t.tip + '|' + t.kod] = t.ad
  return _tanimSozluk
}
export function tanimGoster(tip, kod, buyukHarf = false) {
  if (!kod) return ''
  const ad = (_tanimSozluk && _tanimSozluk[tip + '|' + kod]) || kodTemiz(kod)
  return buyukHarf ? buyuk(ad) : ad
}
// Kasa tipinde kapı sayısını at: "HATCHBACK 5 KAPI" → "HATCHBACK"
// (Göksenil: cam etiketinde ve listelerde kısa hali istiyor.)
export const kasaKisa = ad => kodTemiz(ad).replace(/\s*\d+\s*KAPI/i, '').trim()

// --- Formatlayıcılar ---
export function fmtPara(n) {
  if (n === null || n === undefined || n === '') return '—'
  return Number(n).toLocaleString('tr-TR') + ' ₺'
}
// Ondalık kontrolü gereken sayı biçimi (tr-TR). fmtPara SİMGE basar ve
// ondalığı yönetmez; taksit/oran gibi "2 hane şart" alanlar bunu kullanır.
// ⚠️ siparis-dosya.js içinde birebir aynı imzayla ÖZEL bir kopyası var —
//    o dosya bu ortak hâle taşınacak (tek kaynak). Yeni sayfa kopya YAZMASIN.
export function fmtSayi(n, min = 0, max = 2) {
  return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max })
}
// Telefon rakamlarını başına 0 ekleyerek normalize eder (saklama için): "05550000000"
export function telSifirla(tel) {
  let d = String(tel || '').replace(/\D/g, '')
  if (d.startsWith('90') && d.length === 12) d = d.slice(2)          // +90...
  if (d.length === 10 && d[0] === '5') d = '0' + d                    // 5XX... → 05XX...
  else if (d.length === 11 && d[0] !== '0') d = '0' + d.slice(-10)
  return d || String(tel || '')
}
// Telefonu görüntü için biçimler: "0 (539) 340 17 91". Tanınmazsa olduğu gibi döner.
export function telBicim(tel) {
  const d = telSifirla(tel)
  if (/^0\d{10}$/.test(d)) return `0 (${d.slice(1, 4)}) ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)}`
  return String(tel || '')
}
export function fmtButce(min, max) {
  if (!min && !max) return '—'
  if (min && max) return `${Number(min).toLocaleString('tr-TR')} – ${Number(max).toLocaleString('tr-TR')} ₺`
  return fmtPara(min || max)
}
export function fmtTarih(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}
export function fmtTarihKisa(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('tr-TR')
}

// Bir zaman damgasının üzerinden kaç TAM gün geçti (0 = bugün, null = tarih yok).
// "kaç gündür bekliyor / kaç gündür sessiz" sayımlarının tek kaynağı.
// ⚠️ finansDurum() bunun tersidir (GELECEK tarihe kalan gün) — karıştırma.
export function gunGecti(ts) {
  if (!ts) return null
  const t = new Date(ts).getTime()
  if (isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

// Katılım finans: finansman tarihine kalan gün + durum
export function finansDurum(tarih) {
  if (!tarih) return { kalan: null, durum: 'tarih_yok' }
  const b = new Date(); b.setHours(0, 0, 0, 0)
  const ft = new Date(String(tarih).slice(0, 10) + 'T00:00:00')
  const kalan = Math.round((ft - b) / 86400000)
  let durum = 'normal'
  if (kalan < 0) durum = 'gecti'
  else if (kalan <= 15) durum = 'yaklasti'
  return { kalan, durum }
}
export function finansEtiket(tarih) {
  const { kalan, durum } = finansDurum(tarih)
  if (durum === 'tarih_yok') return { metin: 'tarih yok', sinif: 'notr' }
  if (durum === 'gecti') return { metin: `${-kalan} gün geçti`, sinif: 'hata' }
  if (durum === 'yaklasti') return { metin: `${kalan} gün kaldı`, sinif: 'aktif' }
  return { metin: `${kalan} gün`, sinif: 'notr' }
}

// İstenen araç özeti (talep satırından)
export function aracOzet(t) {
  if (!t) return '—'
  const p = [t.marka, t.model, t.paket].filter(Boolean).join(' ')
  let yil = ''
  if (t.model_yili_min && t.model_yili_max) yil = ` (${t.model_yili_min}–${t.model_yili_max})`
  else if (t.model_yili_min || t.model_yili_max) yil = ` (${t.model_yili_min || t.model_yili_max})`
  return (p || '—') + yil
}

// --- WhatsApp / telefon ---
export function telNo(tel) { return (tel || '').replace(/[^0-9+]/g, '') }
export function waNo(tel) {
  let d = (tel || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = d.slice(1)
  if (d && !d.startsWith('90')) d = '90' + d
  return d
}
export const WA_VARSAYILAN = 'Merhaba, İsmail Çalmaz Otomotiv\'den ulaşıyorum.'
export function waHref(tel, mesaj = WA_VARSAYILAN) {
  const n = waNo(tel); if (!n) return null
  return `https://wa.me/${n}${mesaj ? '?text=' + encodeURIComponent(mesaj) : ''}`
}

// HTML kaçış (kullanıcı metni ekrana basılırken)
// PostgREST hata FIRLATMAZ, { data, error } döndürür. error kontrol edilmezse
// sorgu patlamış olsa bile kod "sonuç yok" sanıp devam eder — bu projede
// mükerrer kontrolünün sessizce boş dönmesi tam olarak böyle oluyordu.
// Sonucu önemsiz olan yazmalarda en azından konsola düşsün diye:
export function dbHata(nerede, error) {
  if (!error) return false
  console.error('[db] ' + nerede, error)
  return true
}

export function kacis(s) {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// URL parametresi
export function urlParam(ad) {
  return new URLSearchParams(location.search).get(ad)
}

// Telefonu normalize et (rakam-only, son 10 hane) — arama/eşleştirme için
export function telSon10(tel) {
  return (tel || '').replace(/\D/g, '').slice(-10)
}

// CSV / Excel dışa aktarma (UTF-8 BOM + noktalı virgül → Excel TR uyumlu)
export function csvIndir(dosyaAd, basliklar, satirlar) {
  const kacisCsv = v => {
    const s = (v ?? '').toString().replace(/"/g, '""')
    return /[";\n]/.test(s) ? `"${s}"` : s
  }
  const cizgiler = [basliklar.map(kacisCsv).join(';')]
  for (const r of satirlar) cizgiler.push(r.map(kacisCsv).join(';'))
  const blob = new Blob(['﻿' + cizgiler.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = dosyaAd.endsWith('.csv') ? dosyaAd : dosyaAd + '.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// =====================================================================
// DMS ÇEKİRDEĞİ (Faz 0) — sabitler DB CHECK constraint'leriyle BİREBİR aynı.
//   Kaynak migration'lar: sql/40 (araç durum), sql/41 (sipariş/olay).
//   Değişiklik daima ÇİFT yapılır: hem burada hem ilgili CHECK'te. Uymayan
//   değer insert'i sessizce başarısız yapar (CLAUDE.md §5).
// Not: Para biçimlendirme için AYRI yardımcı YOK — mevcut `fmtPara` kullanılır
//   (planın "paraBicimle"si = fmtPara; kopya yazılmadı).
// =====================================================================

// Araç durum makinesi (sql/40 stok_durum_check ile birebir)
export const ARAC_DURUMLARI = [
  'ALINDI', 'STOKTA', 'YAYINDA', 'REZERVE', 'SIPARISTE', 'TESLIM_EDILDI', 'SATIS_DISI',
]
// Araç yaşam döngüsü (sql/86 arac_durum_tanim + stok_araclar_durum_check ile
// BİREBİR). Yasak geçişler sunucuda arac_durum_gecis tablosundan uygulanır —
// burada tekrar tanımlama, arayüz yalnız etiket/gruplama yapar.
export const ARAC_DURUM_ETIKET = {
  ALIS_ADAYI: 'Alış Adayı', EKSPERTIZ_BEKLIYOR: 'Ekspertiz Bekliyor',
  EKSPERTIZ_TAMAMLANDI: 'Ekspertiz Tamamlandı', ALIS_ONAY_BEKLIYOR: 'Alış Onayı Bekliyor',
  SIGORTA_BEKLIYOR: 'Sigorta Bekliyor', NOTER_DEVRI: 'Noter Devri', ALINDI: 'Alındı',
  FIYATLANDIRMA_BEKLIYOR: 'Fiyatlandırma Bekliyor', STOKTA: 'Stokta',
  SANAYIDE: 'Sanayide', PARCA_BEKLIYOR: 'Parça Bekliyor', HAZIRLIK: 'Hazırlık',
  FOTOGRAF_BEKLIYOR: 'Fotoğraf Bekliyor', YAYINDA: 'Yayında',
  REZERVE: 'Rezerve', SIPARISTE: 'Siparişte', TESLIME_HAZIR: 'Teslime Hazır',
  TESLIM_EDILDI: 'Teslim Edildi', SATIS_DISI: 'Satış Dışı',
}
// Durum grupları (sql/86 arac_durum_tanim.grup)
export const ARAC_DURUM_GRUP = {
  ALIS: ['ALIS_ADAYI', 'EKSPERTIZ_BEKLIYOR', 'EKSPERTIZ_TAMAMLANDI', 'ALIS_ONAY_BEKLIYOR',
    'SIGORTA_BEKLIYOR', 'NOTER_DEVRI', 'ALINDI'],
  STOK: ['FIYATLANDIRMA_BEKLIYOR', 'STOKTA', 'YAYINDA'],
  OPERASYON: ['SANAYIDE', 'PARCA_BEKLIYOR', 'HAZIRLIK', 'FOTOGRAF_BEKLIYOR'],
  SATIS: ['REZERVE', 'SIPARISTE', 'TESLIME_HAZIR'],
  KAPANIS: ['TESLIM_EDILDI', 'SATIS_DISI'],
}
// Fiziksel envanterde duran araçlar (kapanış hariç hepsi)
// Kendi tesisimiz. Her araçta aynı yazdığı için ekranda bilgi TAŞIMIYOR,
// yalnız yer kaplıyor (Göksenil, 1 Ağu 2026: "ISMAIL_CALMAZ_OTOMOTIV yazısını
// kaldıralım, görünmesine gerek yok, park görünecek").
// ⚠️ Araç BAŞKA bir yerdeyse (konsinye, servis, ihale alanı) lokasyon MUTLAKA
//   gösterilir — o zaman gerçekten bilgi taşıyor. Bu yüzden alanı komple
//   silmiyoruz, yalnız kendi tesisimizi gizliyoruz.
export const KENDI_LOKASYON = 'ISMAIL_CALMAZ_OTOMOTIV'
export const disLokasyon = kod => (kod && kod !== KENDI_LOKASYON) ? kod : ''

export const ARAC_AKTIF_DURUMLAR = [
  ...ARAC_DURUM_GRUP.ALIS, ...ARAC_DURUM_GRUP.STOK,
  ...ARAC_DURUM_GRUP.OPERASYON, ...ARAC_DURUM_GRUP.SATIS,
]
// Satılabilir/stok sayılan durumlar (araç kabul hattını GEÇMİŞ olanlar)
export const ARAC_STOK_DURUMLARI = [
  ...ARAC_DURUM_GRUP.STOK, ...ARAC_DURUM_GRUP.OPERASYON, ...ARAC_DURUM_GRUP.SATIS,
  'TESLIM_EDILDI',
]
export const aracDurumEtiket = k => ARAC_DURUM_ETIKET[k] || k || '—'
// Stok listesinde "Aktif Stok" görünümünden GİZLENEN durumlar (BR-0123).
// Göksenil kararı: REZERVE araç listede GÖRÜNÜR (başka müşteriye satılabilir,
// satış müdürü onayıyla devredilebilir); SİPARİŞTEKİ araç GÖRÜNMEZ.
// Fiziksel envanterde durmaya devam ederler → KPI sayımından düşmezler,
// yalnız varsayılan listeden çıkarlar (durum filtresinden seçilerek görülür).
export const ARAC_LISTE_GIZLI = ['SIPARISTE', 'TESLIME_HAZIR']

// Alış KDV tagı (sql/82 stok_araclar_kdv_orani_chk + tanimlar tip='KDV' ile birebir).
// Yalnız muhasebe (yetki: kdv_yonet) / yönetici değiştirir; diğer herkes salt-okur.
export const KDV_KODLARI = ['1', '20', 'OZEL_MATRAH', 'BELLI_DEGIL']
export const KDV_ETIKET = { '1': '%1', '20': '%20', OZEL_MATRAH: 'Özel Matrah', BELLI_DEGIL: 'Belli Değil' }
export const kdvEtiket = k => KDV_ETIKET[k] || KDV_ETIKET.BELLI_DEGIL
// KDV tagını değiştirebilir mi? (sunucu tarafı asıl kontrol: sql/82 trigger)
//
// ⚠️ DÜZELTME (4 Ağu 2026): burada `rol === 'muhasebe'` YOKTU ama sunucudaki
//   is_kdv_yetkili() onu SAYIYORDU. Yani muhasebe personeli için sunucu izin
//   veriyor, arayüz seçim kutusunu hiç göstermiyordu — kullanıcı KDV'yi
//   giremiyor ama sebebini de göremiyordu. İstemci ile sunucu aynı olguya
//   farklı cevap veriyorsa ikisi de yanlış olabilir; burada eksik olan
//   istemciydi (sunucu kuralı doğru). Bkz. aynı sınıf hata: fazla tahsilat.
export const kdvYonetir = d => !!(d && (d.master_admin || d.rol === 'yonetici' ||
  d.rol === 'muhasebe' ||
  (Array.isArray(d.yetkiler) && d.yetkiler.includes('kdv_yonet'))))

// --- Kâr / kimlik görünürlüğü -----------------------------------------
// Göksenil (5 Ağu 2026): "kâr zarar ve kârlılık sadece yöneticilere açılacak."
//
// ⚠️ BU BİR AÇIK KAPATIYOR: Satış Merkezi kâr/zarar, kârlılık %, maliyet ve
//    alış fiyatını BUGÜNE KADAR HERKESE gösteriyordu (liste rozeti, arşiv
//    özeti, Excel çıktısı). 8.031 arşiv satışının tamamında bu alanlar dolu.
//
// ⚠️ Bu YALNIZ arayüz kapısı. Alanlar hâlâ v_satis_birlesik'ten iniyor;
//    isteyen ağ sekmesinden görebilir. Gerçek koruma kolon bazlı olmalı
//    (ayrı view ya da RLS) — o ayrı bir iş, burada kapsam dışı.
export const karGorur = d => !!(d && (d.master_admin || d.rol === 'yonetici'))
// ⚠️ TCKN/VKN için rol kapısı YOK — Göksenil kararı (5 Ağu 2026):
//    "TCKN / VKN tüm kullanıcılar görebilir hâle getir." Evrak ve noter
//    işlerini danışman yürüttüğü için kimlik ona da lazım. Kredi modülündeki
//    ayrım (kredi_basvuru_gizli) AYRI ve YERİNDE duruyor — orası dış kuruma
//    gönderilen başvuru verisi, burası kendi satış kaydımız.

// Aracın kasko kodu — TEK KAYNAK (notere gönderilen metin, satış dosyası
// araç şeridi, kredi kuyruğu araç kartı hepsi buradan okur).
// Elle girilmiş `kasko_kodu` varsa o esastır; yoksa TSB marka+tip kodundan
// birleştirilir. İkisi de yoksa null — UYDURMA, ekranda "—" gösterilir.
export function kaskoKodu(a) {
  if (a?.kasko_kodu) return String(a.kasko_kodu)
  const tsb = [a?.tsb_marka_id, a?.tsb_tip_id].filter(Boolean).join('-')
  return tsb || null
}

// Sipariş aşama + durum (sql/41 siparis_asama_check / siparis_durum_check ile birebir)
// ---------- TESLİM PLANI (sql/244-245) ----------
// ⚠️ TEK KAYNAK. Sınıf ve sıra SUNUCUDA hesaplanıyor (v_teslim_plani.sinif /
//   sira_anahtari); burada YALNIZCA görsel karşılıkları var. Sınıflandırma
//   mantığını istemcide TEKRARLAMA — iki yerde yaşayan kural sessizce eskir.
export const TESLIM_SINIF = {
  GECIKEN:         { etiket: 'Gecikti',          grup: 'GECİKEN',      sira: 0, cip: 'bg-error-container text-on-error-container', satir: 'bg-error/5' },
  GECIKEN_CEVAPLI: { etiket: 'Gecikti · yanıtlı', grup: 'GECİKEN',      sira: 1, cip: 'bg-amber-100 text-amber-900',                satir: 'bg-amber-50/60' },
  BUGUN:           { etiket: 'Bugün',            grup: 'BUGÜN TESLİM', sira: 2, cip: 'bg-blue-100 text-blue-800',                  satir: 'bg-blue-50/50' },
  TOLERANS:        { etiket: 'Dün olmadı',       grup: 'BUGÜN TESLİM', sira: 2, cip: 'bg-amber-100 text-amber-900',                satir: 'bg-amber-50/40' },
  YARIN:           { etiket: 'Yarın',            grup: 'YAKLAŞAN',     sira: 3, cip: 'bg-surface-container-high text-on-surface',  satir: '' },
  ILERI:           { etiket: '',                 grup: 'YAKLAŞAN',     sira: 4, cip: 'bg-surface-container-high text-on-surface',  satir: '' },
  TAHMIN:          { etiket: 'Tarih netleşmedi', grup: 'NETLEŞMEDİ',   sira: 5, cip: 'bg-amber-100 text-amber-900',                satir: '' },
  PLANSIZ:         { etiket: 'Plan yok',         grup: 'PLANSIZ',      sira: 6, cip: 'bg-error-container text-on-error-container', satir: '' },
  MUAF:            { etiket: 'İhale',            grup: 'MUAF',         sira: 7, cip: 'bg-surface-container-high text-on-surface-variant', satir: '' },
}

// Gecikmeden kimin sorumlu olduğu — kırmızı "suç" değil "kim çözecek" demektir.
// tanimlar(tip='TESLIM_GECIKME_NEDENI').ozellikler->>'sorumlu' ile aynı küme.
export const TESLIM_SORUMLU_ETIKET = {
  DANISMAN: 'Danışman', MUDUR: 'Satış Müdürü', KREDI: 'Kredi', FINANS: 'Finans',
  SIGORTA: 'Sigorta', OPERASYON: 'Operasyon', MUSTERI: 'Müşteri',
}

// Sipariş açarken sunulan hızlı seçenekler. "Netleşmedi" TAHMIN üretir:
// tarih yine girilir (boş kalmaz) ama kırmızı mekanizması işlemez.
export const TESLIM_CIPLERI = [
  { kod: 'bugun',  etiket: 'Bugün',     gun: 0, tip: 'SOZ' },
  { kod: 'yarin',  etiket: 'Yarın',     gun: 1, tip: 'SOZ' },
  { kod: 'g3',     etiket: '+3 gün',    gun: 3, tip: 'SOZ' },
  { kod: 'g7',     etiket: '+1 hafta',  gun: 7, tip: 'SOZ' },
  { kod: 'ozel',   etiket: 'Tarih seç', gun: null, tip: 'SOZ' },
  { kod: 'tahmin', etiket: 'Henüz netleşmedi', gun: 7, tip: 'TAHMIN' },
]

// Bugünden N gün sonrası (YYYY-MM-DD, yerel). bugunISO() zaten var (satır ~106),
// tekrar TANIMLAMA — aynı adla ikinci export modülü çalışma anında düşürür
// ("Identifier has already been declared"); node --check bunu GÖRMEZ.
export function gunEkleISO(ekGun = 0) {
  const d = new Date()
  d.setDate(d.getDate() + ekGun)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export const SIPARIS_ASAMALARI = ['TEKLIF', 'REZERVASYON', 'SIPARIS']
export const SIPARIS_DURUMLARI = ['ACIK', 'TESLIM_EDILDI', 'IPTAL']

// Teslimat onay alt-durumu (sql/48 siparis_teslimat_durum_check ile birebir).
// NULL = henüz onay sürecine girmedi. Finans (Bahadır) köprüsü üzerinden ilerler.
export const TESLIMAT_DURUMLARI = ['ONAY_BEKLIYOR', 'IADE', 'ONAYLANDI']
export const TESLIMAT_DURUM_ETIKET = {
  ONAY_BEKLIYOR: 'Finans onayında', IADE: 'İade edildi — düzelt', ONAYLANDI: 'Teslime hazır',
}

// Olay kataloğu v1 (sql/41 olay_tip_check ile birebir; sql/61 REZERVASYON_* ekledi)
export const OLAY_TIPLERI = [
  'ARAC_ALINDI', 'ARAC_STOGA_ALINDI', 'FIYAT_BELIRLENDI', 'FIYAT_DEGISTI',
  'ARAC_YAYINLANDI', 'YAYINDAN_KALKTI', 'ARAC_SATIS_DISI',
  'SIPARIS_OLUSTU', 'SIPARIS_IPTAL', 'ARAC_TESLIM_EDILDI',
  'TAHSILAT', 'TEDIYE', 'TRAMER_SORGULANDI', 'EKSPERTIZ_ISLENDI', 'MASRAF_EKLENDI',
  'TSB_LISTE_GUNCELLENDI', 'MUSTERI_OLUSTU',
  'TESLIMAT_ONAYA_GONDERILDI', 'TESLIMAT_IADE', 'TESLIMAT_ONAYLANDI',
  'REZERVASYON_OLUSTU', 'REZERVASYON_UZATILDI', 'REZERVASYON_FIYAT_GUNCELLENDI',
  'REZERVASYON_IPTAL', 'REZERVASYON_SURE_DOLDU', 'REZERVASYON_DEVRALINDI',
]

// Olay tipi → Türkçe etiket (zaman çizelgeleri tek kaynaktan okur).
// OLAY_TIPLERI ile birebir; yeni olay tipi eklenince buraya da etiket yazılır.
export const OLAY_ETIKET = {
  ARAC_ALINDI: 'Araç alındı', ARAC_STOGA_ALINDI: 'Araç stoğa alındı',
  FIYAT_BELIRLENDI: 'Fiyat belirlendi', FIYAT_DEGISTI: 'Fiyat değişti',
  ARAC_YAYINLANDI: 'Araç yayınlandı', YAYINDAN_KALKTI: 'Yayından kalktı',
  ARAC_SATIS_DISI: 'Araç satış dışı', SIPARIS_OLUSTU: 'Sipariş oluştu',
  SIPARIS_IPTAL: 'Sipariş iptal edildi', ARAC_TESLIM_EDILDI: 'Araç teslim edildi',
  TAHSILAT: 'Tahsilat', TEDIYE: 'Tediye', TRAMER_SORGULANDI: 'Tramer sorgulandı',
  EKSPERTIZ_ISLENDI: 'Ekspertiz işlendi', MASRAF_EKLENDI: 'Masraf eklendi',
  TSB_LISTE_GUNCELLENDI: 'TSB listesi güncellendi', MUSTERI_OLUSTU: 'Müşteri oluştu',
  TESLIMAT_ONAYA_GONDERILDI: 'Teslimat onaya gönderildi', TESLIMAT_IADE: 'Finans iade etti',
  TESLIMAT_ONAYLANDI: 'Teslimat onaylandı',
  REZERVASYON_OLUSTU: 'Rezervasyon oluştu', REZERVASYON_UZATILDI: 'Rezervasyon uzatıldı',
  REZERVASYON_FIYAT_GUNCELLENDI: 'Rezervasyon fiyatı güncellendi',
  REZERVASYON_IPTAL: 'Rezervasyon iptal edildi', REZERVASYON_SURE_DOLDU: 'Rezervasyon süresi doldu',
  REZERVASYON_DEVRALINDI: 'Rezervasyon devralındı',
  // 7 Ağu 2026 — canlıda ÜRETİLEN ama burada karşılığı OLMAYAN tipler.
  // Karşılığı olmayan tip ekranda HAM KODUYLA basılıyordu
  // ("ARAC_DURUM_DEGISTI"). Yeni olay tipi yazan herkes buraya da yazmalı.
  ARAC_DURUM_DEGISTI: 'Araç durumu değişti',
  GUNCEL_EKSPERTIZ_ISTENDI: 'Güncel ekspertiz istendi',
  ILAN_KALDIRILMALI: 'İlan kaldırılmalı',
}
// ⚠️ Sözlükte OLMAYAN tip artık HAM KODUYLA basılmaz. Eskiden `|| tip`
//    döndüğü için ekranda "TSB_LISTE_GUNCELLENDI" görünüyordu (Göksenil,
//    7 Ağu 2026: "boşluk yerine _ yazıyor, bunu istemiyorum").
//    Son çare alt çizgiyi boşluğa çevirir; yine de bilinen tipler yukarıya
//    YAZILMALI — çevirici kelimeyi Türkçeleştiremez.
export const olayAdi = tip => OLAY_ETIKET[tip] ||
  (String(tip || '').replace(/_/g, ' ').toLocaleLowerCase('tr')
    .replace(/^./, c => c.toLocaleUpperCase('tr')) || '—')
export function olayEtiket(tip) { return olayAdi(tip) }

// "NE oldu?" — `olaylar.veri` jsonb'sinden tek cümle. Boş dönebilir.
// Göksenil: "araç durumu değişti yazıyor ama ne olduğuna dair bilgi yok."
// TEK KAYNAK: DMS paneli Son İşlemler · araç kartı Yaşam Döngüsü · satış
// zaman çizelgesi hepsi buradan okur — dördüncü kopyayı YAZMA.
export function olayDetay(o) {
  const v = (o && o.veri) || {}
  if (v.ozet) return String(v.ozet)                    // sistem olayı kendi özetini yazar
  if (v.eski && v.yeni) return `${ARAC_DURUM_ETIKET[v.eski] || v.eski} → ${ARAC_DURUM_ETIKET[v.yeni] || v.yeni}`
  if (v.yeni_plaka) return `${v.eski_plaka || '—'} → ${v.yeni_plaka}${v.noter ? ' · ' + v.noter : ''}`
  if (v.neden) return String(v.neden)
  if (v.firma) return String(v.firma)
  return ''
}

// Olayı SİSTEM mi üretti? (cron · GitHub Actions · DB trigger → danisman_id boş)
// Kişi sütununu boş bırakmak "kimse yapmadı" izlenimi veriyordu.
export const olaySistemMi = o => !(o && o.danisman_id)
export const AI_SISTEM = 'AI-SİSTEM'

// Evrak tipi (sql/40 evrak_tip_check ile birebir) → Türkçe etiket
export const EVRAK_ETIKET = {
  EKSPERTIZ_PDF: 'Ekspertiz PDF', EKSPERTIZ_LINK: 'Ekspertiz Bağlantı',
  RUHSAT: 'Ruhsat', SBM_GORSEL: 'Tramer / SBM', DIGER: 'Diğer Belge',
}
export function evrakEtiket(tip) { return EVRAK_ETIKET[tip] || tip || '—' }

// Müşteri tipi (sql/39 musteriler_tip_check ile birebir) → arayüz etiketi
export const MUSTERI_TIPLERI = [['SAHIS', 'Bireysel'], ['SIRKET', 'Kurumsal']]
export function musteriTipEtiket(tip) { return (MUSTERI_TIPLERI.find(x => x[0] === tip) || [])[1] || tip || '—' }

// Rezervasyon nedeni (sql/61 siparis_rezervasyon_neden_check ile birebir)
export const REZERVASYON_NEDENLERI = [
  ['KAPORA_ALINDI', 'Kapora Alındı'],
  ['KAPORA_BEKLENIYOR', 'Kapora Bekleniyor'],
  ['KREDI_BEKLENIYOR', 'Kredi Bekleniyor'],
  ['EKSPERTIZ_BEKLENIYOR', 'Ekspertiz Bekleniyor'],
  ['NOTER_RANDEVUSU', 'Noter Randevusu'],
  ['DIGER', 'Diğer'],
]
export function rezervasyonNedenEtiket(kod) { return (REZERVASYON_NEDENLERI.find(x => x[0] === kod) || [])[1] || kod || '—' }

// Yetki bayrakları (danismanlar.yetkiler jsonb + yetkili() ile okunur;
// RLS/trigger muafiyetleri buradan bakar — DMS_TANIMLAR_SEED.md son listesi)
export const YETKI_BAYRAKLARI = [
  'min_alti_satis', 'satis_iptal', 'baskasinin_siparisini_iptal',
  'baskasinin_rezervasyonunu_sil', 'coklu_rezervasyon', 'satilan_araca_masraf',
  'teslimat_yapabilir', 'kz_goruntule', 'patron_raporu', 'tramer_sorgu',
  'medya_sil', 'sadece_kendi_kayitlari', 'son_satis_cari_duzenle',
  'son_satis_cari_kendi_kayitlari', 'masraf_varsayilan_yonet',
]

// Türkçe-fold büyük harf — arama normalizasyonu. sql/42 tr_upper() ile BİREBİR:
//   upper(translate(s,'ıİşŞğĞüÜöÖçÇ','iIsSgGuUoOcC')). İ/ı/i/I hepsi 'I'ya iner.
export function trBuyuk(s) {
  const m = { 'ı': 'i', 'İ': 'I', 'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G', 'ü': 'u', 'Ü': 'U', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C' }
  return (s || '').replace(/[ıİşŞğĞüÜöÖçÇ]/g, c => m[c]).toUpperCase()
}

// =====================================================================
// Aracın AŞAMASI — "şu an nerede?" sorusunun tek cümlelik cevabı.
// Göksenil (7 Ağu 2026): "plaka yazınca yanında aracın son durumu yazmalı
//   (alış listesi - fiyatlama - stok - sipariş - satış)".
//
// ⚠️ 17 durumu 5 aşamaya İNDİRİR; durum listesinin kendisi değildir.
//    Ekranda "Fiyatlandırma Bekliyor / Sanayide / Parça Bekliyor" gibi
//    ayrımlar aramada gürültü yapıyor — arayan kişi aracın hangi
//    departmanda olduğunu bilmek istiyor.
// ⚠️ FİYATLAMA, durumdan DEĞİL `fiyatlama_durumu`'ndan gelir: araç ALINDI
//    durumundayken de kuyrukta olabilir. O yüzden alış kontrolünden ÖNCE
//    bakılır (bkz. Araç Kabul rozetleri, aynı sıra).
// =====================================================================
export const ARAC_ASAMA = {
  ALIS: 'Alış Listesi', FIYATLAMA: 'Fiyatlama', STOK: 'Stok',
  SIPARIS: 'Sipariş', SATIS: 'Satış', KULLANIM: 'Kullanımda', DISI: 'Satış Dışı',
}
export function aracAsama(a) {
  if (!a) return ''
  const d = a.durum
  if (d === 'TESLIM_EDILDI') return ARAC_ASAMA.SATIS
  if (d === 'SATIS_DISI') return ARAC_ASAMA.DISI
  if (d === 'KULLANIMDA') return ARAC_ASAMA.KULLANIM
  if (ARAC_DURUM_GRUP.SATIS.includes(d)) return ARAC_ASAMA.SIPARIS
  if (a.fiyatlama_durumu === 'BEKLIYOR') return ARAC_ASAMA.FIYATLAMA
  if (ARAC_DURUM_GRUP.ALIS.includes(d)) return ARAC_ASAMA.ALIS
  return ARAC_ASAMA.STOK          // STOK + OPERASYON grupları
}
// Aşama rengi — rozet sınıfı. Aramada ve listelerde aynı renkler kullanılsın.
export const ASAMA_RENK = {
  [ARAC_ASAMA.ALIS]: 'bg-sky-100 text-sky-800',
  [ARAC_ASAMA.FIYATLAMA]: 'bg-indigo-100 text-indigo-800',
  [ARAC_ASAMA.STOK]: 'bg-emerald-100 text-emerald-800',
  [ARAC_ASAMA.SIPARIS]: 'bg-amber-100 text-amber-800',
  [ARAC_ASAMA.SATIS]: 'bg-primary/10 text-primary',
  [ARAC_ASAMA.KULLANIM]: 'bg-purple-100 text-purple-800',
  [ARAC_ASAMA.DISI]: 'bg-surface-container text-on-surface-variant',
}

// Plaka sadeleştirme — TEK KAYNAK. Boşluk/tire atılır, Türkçe harf ASCII'ye
// iner, büyük harfe çevrilir: "35 zzt 001" → "35ZZT001".
// ⚠️ `stok_araclar.plaka_norm` ve `arsiv_satislar.plaka_norm` üretilmiş
//    kolonları AYNI kuralı uygular (sql/169). İstemci ile veritabanı
//    ayrışırsa arama sessizce boş döner — Faz 1 testinde tam bu oldu.
export const plakaNormal = s => trBuyuk(s || '').replace(/[^A-Z0-9]/g, '')

// Araç kimliği — EKRANDA plaka yerine daima bunu kullan (sql/188).
// Karavan · römork · iş makinesi gibi plakasız varlıklarda plaka BOŞTUR;
// yerine `stok_kodu` (ör. KRV-001) gösterilir. `buyuk(a.plaka)` yazan her
// yer plakasız araçta boş kutu çizerdi.
// Yoksa BOŞ döner ('—' değil) — çağıran yer kendi varsayılanını seçsin;
// rozet/etiket gibi yerlerde boşsa hiç çizilmemesi gerekiyor.
export const aracEtiket = a => buyuk(a?.plaka || a?.stok_kodu || '')

// Marka TAKMA ADLARI — Göksenil, 12 Ağu 2026: "TOFAŞ-FIAT adını FİAT olarak
// gösterelim ama veritabanında TOFAS-FIAT olarak kalsın."
// ⚠️ YALNIZ GÖRÜNÜM. Veriye dokunulmaz: `stok_araclar.marka` hâlâ TOFAS-FIAT,
//    TSB eşleşmesi, arabam sözlüğü, GURU arşivi ve raporlar bozulmasın.
//    Ekranda marka basacak her yer `markaAd()` kullanır; filtre DEĞERİ ham
//    kalır, yalnız ETİKETİ değişir — yoksa filtre hiçbir araç bulamaz.
// ⚠️ Sıralama da bunu kullanmalı: "FİAT" gösterip T harfinde sıralamak
//    kullanıcıya bozuk görünür.
// ⚠️ `FIAT` de listede: stokta hem `FIAT` (5 araç) hem `TOFAS-FIAT` (23 araç)
//    var. İkisi de AYNI metne ('FİAT') çevrilmezse filtre noktalı/noktasız İ
//    farkıyla İKİ satır gösterir — 12 Ağu 2026'da canlıda tam bu oldu.
//    Gruplama metin eşitliğine bakar; "benzer" yetmez.
export const MARKA_TAKMA_AD = { 'TOFAS-FIAT': 'FİAT', 'TOFAŞ-FIAT': 'FİAT', 'FIAT': 'FİAT' }
export const markaAd = m => MARKA_TAKMA_AD[trBuyuk(m || '').trim()] || m || ''
export const plakasizMi = a => !a?.plaka && !!a?.stok_kodu

// =====================================================================
// SATIŞ TARİHİ — noter tarihi yoksa onay zamanına düş, ama SÖYLE.
//
// Arşiv kayıtlarında (eski sistemden gelen) noter tarihi hiç yok; tek
// tarih onay zamanı. Yedek yol o yüzden var. Ama düştüğümüzü belirtmezsek
// kullanıcı onay saatini noter tarihi sanır.
//
// ⚠️ Burada duruyor çünkü İKİ ekran gösteriyor: Satış Merkezi listesi/hızlı
//    paneli (satis.js) ve satış kaydı penceresi (satis-kayit-pencere.js).
//    19 Ağu 2026'da biri yedek yola düşüyor öbürü düşmüyordu; aynı dosya
//    için biri "19.08.2026" öbürü "—" diyordu. satis.js → pencere yönünde
//    zaten import var, ters yönde import etmek döngü yaratırdı.
// =====================================================================
export const satisGunu = s => s.satis_tarihi || s.onay_zamani
export const TURETILMIS_NOT = ' <span class="text-[10px] text-on-surface-variant font-normal">(onay zamanı)</span>'
