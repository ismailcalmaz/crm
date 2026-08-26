// =====================================================================
// musteri-sec.js — ORTAK MÜŞTERİ ARAMA / ÇÖZME / GERİ YAZMA
//
//   Göksenil (1 Ağu 2026):
//   "burada olan müşteriler araç kabulde, sipariş rezervede, kredide de
//    çıkacak değil mi? ve kim hangi kaydı güncellerse müşteri tablosundan
//    güncellenecek doğru mu"
//   → O gün ikisi de HAYIR'dı. Bu modül ikisini de sağlar.
//
// ── 1) ARAMA: v_musteri_birlesik (CRM + yalnız sigortada olanlar)
// ── 2) ÇÖZME: sigorta kaydı seçilirse ARKA PLANDA CRM'e aktarılır
//      ⚠️ ŞART: 11 tablo musteriler.id'ye FOREIGN KEY ile bağlı
//        (arac_alislar, siparisler, cari_hareketler, talepler,
//         satis_snapshot, kredi_kullandirim, olaylar, sms_loglari…).
//        Aramaya sigorta kaydını koyup id'sini olduğu gibi kullansaydık
//        kaydetme anında FK HATASI verirdi. Bu yüzden seçim anında gerçek
//        bir `musteriler` satırı doğar ve o id kullanılır.
// ── 3) GERİ YAZMA: modülde girilen bilgi müşteri kütüğüne işlenir
//      ⚠️ BOŞ alan SESSİZCE doldurulur; DOLU ve FARKLI alan SORULUR.
//        Sessiz üzerine yazma, doğru veriyi yanlışla değiştirir — bu
//        projede en pahalı hata sınıfı bu.
// =====================================================================
import { supabase } from './supabase-client.js'
import { dbHata, telSifirla, buyuk, trBuyuk } from './veri.js'

// ⚠️ KAYIT İÇİN `buyuk()` KULLAN, `trBuyuk()` DEĞİL.
//   trBuyuk ASCII'ye indirger (Ş→S, Ğ→G, Ü→U) — o bir ARAMA normalizasyonu.
//   Kayıtta kullanınca isim BOZULUR: "AHMET KURŞUN" → "AHMET KURSUN".
//   Canlı provada tam bu oldu; v209'dan beri sipariş panelinde de vardı.

/**
 * Birleşik listede müşteri ara (CRM + sigorta).
 * @param {string} q  isim ya da telefon/TCKN parçası
 * @returns {Promise<Array>} [{id, kaynak_modul, ad_soyad, telefon, kimlik, police_adedi}]
 */
export async function musteriAra(q, adet = 8) {
  const v = String(q || '').trim()
  if (v.length < 2) return []
  const rakam = v.replace(/\D/g, '')
  let sel = supabase.from('v_musteri_birlesik')
    .select('id, kaynak_modul, ad_soyad, telefon, telefon_norm, kimlik, tip, police_adedi')
    .limit(adet)
  // 3+ rakam yazıldıysa telefon/kimlik araması, değilse isim araması.
  // ⚠️ `or` içinde virgül PostgREST'te ayraçtır — desen tırnaksız verilir.
  // ⚠️ İSİM ARAMASI `ad_ara` ÜZERİNDEN (sql/129): Postgres'in lower/upper'ı
  //   Türkçe I/ı çiftini bilmiyor — 'BAHADIR' lower'da 'bahadir' oluyor,
  //   kullanıcı 'bahadı' yazınca EŞLEŞME KAYBOLUYORDU (canlıda ölçüldü:
  //   '%bahad%'→1, '%bahadı%'→0). Karşılaştırma iki tarafta da ASCII'ye
  //   indirgeniyor; trBuyuk() DB'deki translate() ile BİREBİR aynı eşleme.
  sel = rakam.length >= 3
    ? sel.or(`telefon_norm.ilike.%${rakam}%,kimlik.ilike.%${rakam}%`)
    : sel.ilike('ad_ara', `%${trBuyuk(v)}%`)
  const { data, error } = await sel
  if (error) { dbHata('müşteri ara', error); return [] }
  return data || []
}

/**
 * Seçilen kaydı KULLANILABİLİR bir müşteriye çevirir.
 * SIGORTA kaydıysa CRM'e aktarır + sigorta kaydına açıkça bağlar.
 * @returns {Promise<{id, ad_soyad, telefon, aktarildi:boolean}|null>}
 */
export async function musteriCoz(secim, benim) {
  if (!secim) return null
  if (secim.kaynak_modul !== 'SIGORTA') {
    return { id: secim.id, ad_soyad: secim.ad_soyad, telefon: secim.telefon, aktarildi: false }
  }
  const { data: yeni, error } = await supabase.from('musteriler').insert({
    tip: secim.tip === 'SIRKET' ? 'SIRKET' : 'SAHIS',
    ad_soyad: buyuk(secim.ad_soyad || ''),
    // Sigorta kütüğünde telefon YOK (1782 kaydın hepsinde boş) — '-' ile açılır,
    // kullanıcı ilk işlemde gerçek numarayı girer ve geri yazma onu işler.
    telefon: (secim.telefon_norm && secim.telefon_norm.length >= 10) ? telSifirla(secim.telefon_norm) : '-',
    kaynak: 'SIGORTA',
    olusturan: benim?.id || null,
  }).select('id, ad_soyad, telefon').single()
  if (error) { dbHata('sigorta müşterisi aktar', error); return null }

  if (secim.kimlik) {
    const { error: ke } = await supabase.from('musteri_kimlik')
      .upsert({ musteri_id: yeni.id, tckn_vergi_no: secim.kimlik }, { onConflict: 'musteri_id' })
    if (ke) dbHata('aktarma kimlik', ke)
  }
  // Açık bağlantı — yoksa kişi birleşik listede İKİ KEZ görünür (sql/126 provası)
  const { data: bag, error: be } = await supabase.from('sigorta_musterileri')
    .update({ crm_musteri_id: yeni.id }).eq('id', secim.id).select('id')
  if (be) dbHata('sigorta bağlantı', be)
  else if (!bag || !bag.length) console.error('[musteri-sec] sigorta bağlantısı 0 satır — yetki?')   // §5.1

  return { ...yeni, aktarildi: true }
}

// Hangi alan hangi kolona yazılır + ekranda nasıl anılır
const ALAN = {
  telefon:      { kolon: 'telefon',       ad: 'Telefon',   duzelt: v => telSifirla(String(v).replace(/\D/g, '')) },
  e_posta:      { kolon: 'e_posta',       ad: 'E-posta' },
  adres:        { kolon: 'adres',         ad: 'Adres' },
  meslek_grubu: { kolon: 'meslek_grubu',  ad: 'Meslek grubu' },
  dogum_tarihi: { kolon: 'dogum_tarihi',  ad: 'Doğum tarihi' },
  vergi_dairesi:{ kolon: 'vergi_dairesi', ad: 'Vergi dairesi' },
  ad_soyad:     { kolon: 'ad_soyad',      ad: 'Ad / Ünvan', duzelt: v => buyuk(v) },
}

/**
 * Modülde girilen bilgiyi MÜŞTERİ KÜTÜĞÜNE geri yaz.
 * Göksenil: "müşteriler farklı modüllerden güncellenirse gidip müşteri
 * kaydından o veri güncellenecek."
 *
 * ⚠️ Kural: BOŞ alan sessizce dolar. DOLU ve FARKLI alan için ONAY SORULUR.
 *   Sessiz üzerine yazma, doğru numarayı yanlışıyla değiştirir.
 *
 * @param {string} musteriId
 * @param {object} yeni  {telefon, e_posta, adres, kimlik, ...}
 * @param {object} [opt] {sor:boolean} — false ise yalnız boş alanlar dolar
 * @returns {Promise<{dolduruldu:string[], guncellendi:string[], atlandi:string[]}>}
 */
export async function musteriGeriYaz(musteriId, yeni, opt = {}) {
  const sor = opt.sor !== false
  const sonuc = { dolduruldu: [], guncellendi: [], atlandi: [] }
  if (!musteriId || !yeni) return sonuc

  const { data: m, error } = await supabase.from('musteriler')
    .select('id, ad_soyad, telefon, e_posta, adres, meslek_grubu, dogum_tarihi, vergi_dairesi')
    .eq('id', musteriId).maybeSingle()
  if (error) { dbHata('geri yazma oku', error); return sonuc }
  if (!m) return sonuc

  const yama = {}
  for (const [anahtar, tanim] of Object.entries(ALAN)) {
    let deger = yeni[anahtar]
    if (deger == null || String(deger).trim() === '') continue
    deger = tanim.duzelt ? tanim.duzelt(deger) : String(deger).trim()
    const mevcut = m[tanim.kolon]
    // '-' telefon "boş" sayılır: aktarma sırasında yer tutucu olarak yazılıyor
    const mevcutBos = mevcut == null || String(mevcut).trim() === '' || String(mevcut).trim() === '-'
    if (mevcutBos) { yama[tanim.kolon] = deger; sonuc.dolduruldu.push(tanim.ad); continue }
    if (String(mevcut) === String(deger)) continue                      // aynı — dokunma
    if (!sor) { sonuc.atlandi.push(tanim.ad); continue }
    const onay = confirm(`${tanim.ad} farklı:\n\nKayıtlı: ${buyuk(mevcut)}\nYeni:    ${buyuk(deger)}\n\nMüşteri kaydı güncellensin mi?`)
    if (onay) { yama[tanim.kolon] = deger; sonuc.guncellendi.push(tanim.ad) }
    else sonuc.atlandi.push(tanim.ad)
  }

  if (Object.keys(yama).length) {
    const { data, error: ue } = await supabase.from('musteriler').update(yama).eq('id', musteriId).select('id')
    if (ue) { dbHata('müşteri geri yazma', ue); return sonuc }
    if (!data || !data.length) { console.error('[musteri-sec] geri yazma 0 satır — yetki?'); return sonuc }   // §5.1
  }

  // Kimlik AYRI tabloda (RLS kolon gizleyemez, CLAUDE.md §9)
  const kimlik = String(yeni.kimlik || '').replace(/\D/g, '')
  if (kimlik) {
    const { data: k } = await supabase.from('musteri_kimlik')
      .select('tckn_vergi_no').eq('musteri_id', musteriId).maybeSingle()
    const mevcut = k?.tckn_vergi_no || ''
    if (!mevcut || (mevcut !== kimlik && (!sor || confirm(`Kimlik no farklı:\n\nKayıtlı: ${mevcut}\nYeni:    ${kimlik}\n\nGüncellensin mi?`)))) {
      const { error: ke } = await supabase.from('musteri_kimlik')
        .upsert({ musteri_id: musteriId, tckn_vergi_no: kimlik }, { onConflict: 'musteri_id' })
      if (ke) dbHata('kimlik geri yazma', ke)
      else (mevcut ? sonuc.guncellendi : sonuc.dolduruldu).push('Kimlik no')
    }
  }
  return sonuc
}

/** Geri yazma sonucunu tek satırlık insan diline çevir (boşsa '' döner). */
export function geriYazOzet(s) {
  const p = []
  if (s.dolduruldu.length) p.push(`müşteri kaydına eklendi: ${s.dolduruldu.join(', ')}`)
  if (s.guncellendi.length) p.push(`güncellendi: ${s.guncellendi.join(', ')}`)
  if (s.atlandi.length) p.push(`değiştirilmedi: ${s.atlandi.join(', ')}`)
  return p.join(' · ')
}
