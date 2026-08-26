// =====================================================================
// arac-dosya.js — ARAÇ DOSYALARI (fotoğraf + evrak) TEK KAYNAK
//
// Göksenil (7 Ağu 2026): "evet ortak modül en mantıklısı."
//
// ⚠️ NEDEN: aynı yükleme mantığının DÖRT kopyası vardı ve HEPSİ FARKLIYDI:
//     arac-detay.js   foto + evrak   (webpCevir 2000px/0.85)
//     arac-kabul-yeni.js evrak       (webpCevir'in birebir ikinci kopyası)
//     arac-kart.js    foto           (resimWebp 1600px/0.82, ayrı yazılmış)
//     dms-panel       —              (hiç yoktu; bu yüzden pop-up'ta
//                                     yükleme yapılamıyordu)
//   Kopyalar ayrıştıkça biri düzeltilip öbürü unutuluyordu. Ölçülen fark:
//     · arac-kart.js  satır ekleme BAŞARISIZ olursa storage nesnesini SİLER
//       → sahipsiz dosya kalmaz.  arac-detay.js SİLMİYORDU.
//     · arac-kart.js  dosya adında crypto.randomUUID() kullanır → çakışma yok.
//       arac-detay.js `Date.now()_sira` kullanıyordu; aynı milisaniyede iki
//       yükleme aynı adı üretebilir.
//   Bu modül İKİSİNİN İYİ YANINI alır: UUID adlandırma + başarısızlıkta
//   storage temizliği. Yani birleştirme sadece tekrarı değil, iki gerçek
//   kusuru da kaldırıyor.
//
// ⚠️ ÇÖZÜNÜRLÜK BİLEREK FARKLI:
//     evrak 2000px / 0.85 — ruhsat ve ekspertiz OKUNABİLİR olmalı.
//     foto  1600px / 0.82 — galeri görseli; storage 500MB sınırı korunur.
//   Tek sayıya indirmedim; ikisi farklı işler.
//
// §5.1: insert sonrası `error` DAİMA kontrol edilir. RLS reddi hata değil
//       0 satır/None döner — sessiz başarısızlık bu projenin bir numaralı
//       hata sınıfı.
// =====================================================================
import { supabase } from './supabase-client.js'
import { dbHata } from './veri.js'

const FOTO_KOVA = 'arac-foto'
const EVRAK_KOVA = 'arac-evrak'

// ---------------------------------------------------------------------
// Görseli küçült + WebP'e çevir. Görsel DEĞİLSE (PDF vb.) dosyayı olduğu
// gibi döndürür — PDF'i canvas'tan geçirmek onu bozar.
// ---------------------------------------------------------------------
export async function webpCevir(file, maxBoyut = 2000, kalite = 0.85) {
  const uzantiOf = v => (file.name.split('.').pop() || v).toLowerCase()
  if (!file.type || !file.type.startsWith('image/')) {
    return { blob: file, uzanti: uzantiOf('bin'), mime: file.type }
  }
  try {
    const img = await createImageBitmap(file)
    const oran = Math.min(1, maxBoyut / Math.max(img.width, img.height))
    const w = Math.round(img.width * oran), h = Math.round(img.height * oran)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise(res => c.toBlob(res, 'image/webp', kalite))
    if (!blob) return { blob: file, uzanti: uzantiOf('jpg'), mime: file.type }
    return { blob, uzanti: 'webp', mime: 'image/webp' }
  } catch (e) {
    // Çevrim başarısızsa YÜKLEMEYİ İPTAL ETME — orijinali gönder.
    console.error('[dosya] webp çevrim', e)
    return { blob: file, uzanti: uzantiOf('jpg'), mime: file.type }
  }
}

// ---------------------------------------------------------------------
// FOTOĞRAF — çoklu yükleme
//   aracId        : hedef araç
//   dosyalar      : FileList | File[]
//   baslangicSira : mevcut son sıradan devam et (kapak = sira 0 kuralı)
//   yukleyen      : danışman id
//   ilerleme      : (yapilan, toplam) → arayüz metni yazar (opsiyonel)
// Dönüş: { eklenen, hata, sonSira }
// ---------------------------------------------------------------------
export async function fotograflariYukle({ aracId, dosyalar, baslangicSira = 0, yukleyen = null, ilerleme = null }) {
  const liste = [...(dosyalar || [])].filter(f => f && f.type && f.type.startsWith('image/'))
  let sira = Number(baslangicSira) || 0, eklenen = 0, hata = 0, i = 0
  for (const f of liste) {
    i++
    ilerleme?.(i, liste.length)
    try {
      const { blob } = await webpCevir(f, 1600, 0.82)
      const yol = `${aracId}/${crypto.randomUUID()}.webp`
      const { error: ue } = await supabase.storage.from(FOTO_KOVA)
        .upload(yol, blob, { contentType: 'image/webp', upsert: false })
      if (ue) { dbHata('foto storage', ue); hata++; continue }
      const { error: ie } = await supabase.from('arac_fotograflari')
        .insert({ arac_id: aracId, dosya_yolu: yol, sira: sira++, yukleyen })
      if (ie) {
        // ⚠️ Satır yazılamadıysa DOSYAYI GERİ AL. Yoksa kovada hiçbir kayda
        //    bağlı olmayan görsel birikir ve kimse fark etmez.
        dbHata('foto kayıt', ie)
        await supabase.storage.from(FOTO_KOVA).remove([yol])
        hata++; continue
      }
      eklenen++
    } catch (e) { console.error('[dosya] foto', e); hata++ }
  }
  return { eklenen, hata, sonSira: sira }
}

export async function fotografSil({ id, yol }) {
  // Sıra: ÖNCE satır. Satır silinemezse (yetki) dosya duruyor olsun —
  // tersi olsaydı kayıt kalır, görseli kaybolurdu.
  const { data, error } = await supabase.from('arac_fotograflari').delete().eq('id', id).select('id')
  if (error) { dbHata('foto sil', error); return { ok: false, msg: error.message } }
  if (!data || !data.length) return { ok: false, msg: 'Silinemedi — yetki veya kayıt yok.' }
  if (yol) { const { error: se } = await supabase.storage.from(FOTO_KOVA).remove([yol]); if (se) dbHata('foto storage sil', se) }
  return { ok: true }
}

// ---------------------------------------------------------------------
// EVRAK — tek dosya (RUHSAT, EKSPERTIZ_PDF, SBM_GORSEL…)
// Dönüş: { ok, msg, yol }
// ---------------------------------------------------------------------
export async function evrakiYukle({ aracId, tip, dosya }) {
  if (!dosya) return { ok: false, msg: 'Dosya seçilmedi.' }
  try {
    const { blob, uzanti, mime } = await webpCevir(dosya)      // evrak: 2000/0.85
    const yol = `arac/${aracId}/${String(tip).toLowerCase()}_${crypto.randomUUID()}.${uzanti}`
    const { error: ue } = await supabase.storage.from(EVRAK_KOVA)
      .upload(yol, blob, { contentType: mime || dosya.type, upsert: false })
    if (ue) { dbHata('evrak storage', ue); return { ok: false, msg: ue.message } }
    const { data, error: ie } = await supabase.from('arac_evraklar')
      .insert({ arac_id: aracId, tip, url: yol }).select('id')
    if (ie || !data || !data.length) {
      // Satır yazılamadı → yüklenen dosyayı geri al (bkz. foto notu).
      if (ie) dbHata('evrak kayıt', ie)
      await supabase.storage.from(EVRAK_KOVA).remove([yol])
      return { ok: false, msg: ie ? ie.message : 'Kaydedilemedi — yetki yok.' }
    }
    return { ok: true, yol }
  } catch (e) {
    console.error('[dosya] evrak', e)
    return { ok: false, msg: e.message }
  }
}

export async function evrakSil({ id, yol }) {
  const { data, error } = await supabase.from('arac_evraklar').delete().eq('id', id).select('id')
  if (error) { dbHata('evrak sil', error); return { ok: false, msg: error.message } }
  if (!data || !data.length) return { ok: false, msg: 'Silinemedi — yetki veya kayıt yok.' }
  // ⚠️ Satır silindi ama KOVA politikası kapalıysa dosya yerinde kalır ve
  //   storage.remove() bunu HATA OLARAK BİLDİRMEZ — boş dizi döner. Yetim
  //   dosya oluşur, kimse fark etmez. Bu yüzden dönen listeyi de ölç.
  if (yol) {
    const { data: sd, error: se } = await supabase.storage.from(EVRAK_KOVA).remove([yol])
    if (se) dbHata('evrak storage sil', se)
    else if (!sd || !sd.length) console.warn('[dosya] evrak kaydı silindi ama dosya kovada kaldı (yetki?)', yol)
  }
  return { ok: true }
}

// Evrak için imzalı URL — gömülü önizleme (iframe/img) bunu kullanır.
// Kova ÖZEL, doğrudan URL çalışmaz; süre dolunca bağlantı ölür.
export async function evrakImzaliUrl(yol, saniye = 3600) {
  if (!yol) return null
  const { data, error } = await supabase.storage.from(EVRAK_KOVA).createSignedUrl(yol, saniye)
  if (error || !data?.signedUrl) { dbHata('evrak imzalı url', error); return null }
  return data.signedUrl
}

// İmzalı bağlantıyla evrağı aç. Kova ÖZEL — doğrudan URL çalışmaz.
export async function evrakAc(yol, saniye = 3600) {
  if (!yol) return { ok: false, msg: 'Dosya yolu yok.' }
  const { data, error } = await supabase.storage.from(EVRAK_KOVA).createSignedUrl(yol, saniye)
  if (error || !data?.signedUrl) {
    dbHata('evrak imzalı url', error)
    return { ok: false, msg: error?.message || 'Belge açılamadı.' }
  }
  window.open(data.signedUrl, '_blank', 'noopener')
  return { ok: true }
}

// Fotoğraf herkese açık kovada — imza gerekmez.
export const fotoUrl = yol => {
  try { return supabase.storage.from(FOTO_KOVA).getPublicUrl(yol).data.publicUrl }
  catch (e) { console.error('[dosya] foto url', e); return '' }
}
