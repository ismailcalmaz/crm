// =====================================================================
// cam-etiketi.js — Cam etiketi yazdırma (G2)
//
//   Göksenil: "Cam etiketi PDF'ini matbaaya gönderip çıktılarını
//   aldırıyorum." + "MATBAA ÇIKTISINI GÜNCELLEYEMEYİZ. MATBAA ÇIKTISINA
//   BAĞLI KALARAK İSTEDİĞİMİZ REVİZYONU YAPMALIYIZ."
//
//   ⚠️ Rehber JPG'nin piksel analiziyle ÖLÇÜLDÜ: matbaa formu YALNIZ çizgi
//   ve alt logoyu basıyor — TEK BİR BAŞLIK YAZISI BASMIYOR. "TRAMER TUTARI",
//   "BİREYSEL KREDİ TUTARI", VAR/YOK kutucukları, ekspertiz şeması ve renk
//   efsanesi dahil her şeyi BU DOSYA basar. Bu yüzden çizgilere sadık kalmak
//   şartıyla içerik serbestçe kurgulanabilir (yeni matbaa kalıbı gerekmez).
//   Çizgiler: yatay 33.7 / 127.7 / 218.2(sağ sütun) · dikey 104.5 · alt bant 264.7
//
//   Ekranda rehber görsel görünür, YAZDIRIRKEN GİZLENİR — kâğıtta zaten basılı.
//   Konumlar cam-etiketi-duzenle.js'te mm cinsinden; master admin editörden
//   sürükleyerek ayarlar, ayarlar.cam_etiketi_yerlesim'e kaydeder.
//
//   Kullanım: cam-etiketi.html?id=<arac_id>  · toplu: ?id=id1,id2,id3
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata, urlParam, buyuk, kdvEtiket, tanimSozlukYukle, tanimGoster, kasaKisa, BANKALAR } from './veri.js'
import { svgBoya, PARCALAR, RENK, DURUM_ETIKET } from './ekspertiz.js'
import { yerlesimYukle, yerlesimUygula, duzenleyiciKur, qrAdresi, alanGizliMi, yazi } from './cam-etiketi-duzenle.js'
import { camEtiketiBasar } from './yetki.js'

// ⚠️ trBuyuk() DEĞİL — o arama normalizasyonu, Türkçe harfleri katlar
// (BENZİN→BENZIN). Türkçe metinde daima buyuk().
const B = v => kacis(buyuk(v))
// PLAKA için Türkçe büyütme KULLANILMAZ: tr kuralı i→İ çevirir ve küçük
// yazılmış bir plaka ("35 cai 103") "35 CAİ 103" olurdu — Türk plakalarında
// noktalı İ yoktur. Marka/model Göksenil kararıyla Türkçe büyütmede
// (NİSSAN / QASHQAİ), plaka düz büyütmede kalır.
const BL = v => kacis(String(v ?? '').toUpperCase())
// Matbaa örneğindeki biçim ₺ ÖNDE ("₺1.880.000") — veri.js'teki fmtPara
// ₺'yi sona koyar, o yüzden etikete özel biçimleyici.
const paraOn = n => (n === null || n === undefined || n === '') ? '—' : '₺' + Number(n).toLocaleString('tr-TR')

// Garanti kuralı — Göksenil: "3 AY / 5.000 KM MOTOR & MEKANİK GARANTİSİ VAR.
// 160.000 KM SINIRININ ALTINDA KALAN ARAÇLARA / ÜSTÜ OLURSA 1 AY / 1.000 KM"
// Kilometreden TÜRETİLİR → kanıtlanabilir, elle işaretlenmez.
//
// ⚠️ METİNLER VE SINIR ARTIK KODDA SABİT DEĞİL (Göksenil, 11 Ağu 2026:
//    "sabit yazılarda düzenlenebilir olsun"). Editörden değiştirilir,
//    ayarlar.cam_etiketi_yerlesim.yazilar'a yazılır. Buradaki değerler
//    yalnız VARSAYILAN — ayar okunamazsa bunlar basılır.
// ⚠️ GARANTI_KM_SINIRI dışa aktarılmaya devam ediyor: başka modüller
//    import ediyor olabilir, imzayı bozmuyoruz.
export const GARANTI_KM_SINIRI = 160000
export function garantiMetni(km) {
  if (km == null || km === '') return ''
  const sinir = Number(yazi('garantiKmSiniri')) || GARANTI_KM_SINIRI
  return Number(km) <= sinir ? yazi('garantiDusuk') : yazi('garantiYuksek')
}

let SVGTXT = ''
let QR = null   // vendor/qr.js — yüklenemezse QR alanı boş basılır
let INDIRIM = {}   // arac_id → v_arac_indirim satırı
let SIRALI = []    // basım kaydı için sayfadaki araçlar

export async function camEtiketiKur(d) {
  const kok = document.getElementById('kok')
  // Yetki kapısı: bilgi işlem + yönetim (Göksenil kararı). Buton gizlense de
  // adres elle yazılabildiği için sayfanın kendisi de kontrol eder.
  // ⚠️ Bu bir GÖRÜNÜRLÜK kapısı; asıl koruma sunucuda (v_arac_min_fiyat
  // kendi kapısını taşır, sql/99) — kapıdan geçmeyende fiyat zaten boş döner.
  if (!camEtiketiBasar(d)) {
    kok.innerHTML = mesaj('Cam etiketi basma yetkiniz yok. Bilgi işlem birimine başvurun.')
    document.getElementById('cubuk')?.classList.add('gizli')
    return
  }
  const ham = urlParam('id') || ''
  const idler = ham.split(',').map(s => s.trim()).filter(Boolean)
  if (!idler.length) { kok.innerHTML = mesaj('Araç seçilmedi. Stok listesinden "Cam Etiketi" ile açın.'); return }

  durum('Yükleniyor…')
  const [aracR, fiyatR, indR, kredi] = await Promise.all([
    supabase.from('stok_araclar')
      .select(`id, plaka, marka, model, versiyon, yil, km, yakit, vites, renk, kasa_tipi,
               kasko_kodu, tsb_marka_id, tsb_tip_id, yedek_anahtar, muayene_tarihi, kdv_orani,
               arac_ekspertiz(parca_kodu, durum), arac_evraklar(tip),
               arac_tramer(id, tutar)`)
      .in('id', idler),
    supabase.from('v_arac_min_fiyat').select('arac_id, satis_fiyati').in('arac_id', idler),
    // G2 indirim rozeti — referans fiyat MEVZUATA GÖRE sunucuda hesaplanır
    // (sql/101: penceredeki EN DÜŞÜK uygulanan fiyat). Burada "bir önceki
    // fiyat" gibi bir kısayol yazmak yanıltıcı etiket bastırır.
    supabase.from('v_arac_indirim').select('arac_id, eski_fiyat, indirim_tutari').in('arac_id', idler),
    // Peşinatlar/krediler: kredi modülünün TEK KAYNAK hesabı (kredi-hesap.js
    // formülleri burada TEKRARLANMAZ) — modül yoksa alanlar boş basılır.
    import('./kredi-hesap.js').catch(e => { console.error('[cam etiketi] kredi-hesap', e); return null }),
    yerlesimYukle(),
  ])
  if (aracR.error) { dbHata('cam etiketi araç', aracR.error); kok.innerHTML = mesaj('Araç okunamadı: ' + aracR.error.message); return }
  // QR üreteci yerelde (vendor) — çevrimdışıyken de çalışsın. QR alanı kapalı
  // olduğu sürece 59 KB'lık dosya HİÇ indirilmez.
  if (!alanGizliMi('qr')) {
    const qrMod = await import('./vendor/qr.js').catch(e => { console.error('[cam etiketi] qr modülü', e); return null })
    QR = qrMod?.default || null
  }
  const fiyatMap = {}
  for (const r of (fiyatR.data || [])) fiyatMap[r.arac_id] = r.satis_fiyati
  if (fiyatR.error) console.error('[cam etiketi] min fiyat görünümü', fiyatR.error)
  INDIRIM = {}
  for (const r of (indR.data || [])) INDIRIM[r.arac_id] = r
  if (indR.error) console.error('[cam etiketi] indirim görünümü', indR.error)

  if (!SVGTXT) SVGTXT = await fetch('img/ekspertiz-sema.svg').then(r => r.text()).catch(e => { console.error('[cam etiketi] şema', e); return '' })
  // Kod yerine tanımlardaki ADI göster (BENZIN → BENZİN, HATCHBACK_5_KAPI → HATCHBACK)
  await tanimSozlukYukle(supabase, ['YAKIT', 'VITES', 'RENK', 'KASA_TIPI'])

  // ⚠️ Faiz oranları CANLIDAN okunmalı. Okumazsak kredi-hesap.js'in emniyet
  // varsayılanları kullanılır ve KÂĞITTAKİ kredi tutarı araç kartındakinden
  // FARKLI çıkar (müşteriye iki ayrı rakam gösterilmiş olur).
  const oranlar = kredi ? await kredi.krediOranlariYukle(supabase) : null

  // URL'deki sıraya sadık kal (toplu çıktıda liste sırası korunsun)
  const sirali = idler.map(id => (aracR.data || []).find(a => a.id === id)).filter(Boolean)
  SIRALI = sirali
  // TSB kasko bedeli — ticari (tüzel) kredi bunun üzerinden hesaplanır
  // Basım kaydında "etikete BASILAN fiyat" lazım — render sırasında iliştir.
  sirali.forEach(a => { a._etiketFiyat = fiyatMap[a.id] ?? null })
  const kaskoMap = await kaskoYukle(kredi, sirali)
  kok.innerHTML = sirali.map(a => sayfaHtml(a, fiyatMap[a.id], kredi, kaskoMap[a.id] ?? null, oranlar)).join('')
  sirali.forEach(a => ekspertizBoya(a))
  yerlesimUygula()                       // kayıtlı konumları uygula
  durum(`${sirali.length} etiket hazır`)
  kur()
  // Editör YALNIZ master admin'de ve ?duzenle=1 ile açılır
  if (d?.master_admin) {
    document.getElementById('duzenleBtn')?.classList.remove('gizli')
    if (urlParam('duzenle') === '1') duzenleyiciKur()
  }
}

// ⚠️ Eski kod bu alanlara PEŞİNAT basıyordu; matbaa örneğindeki rakam KREDİ
// TUTARI'ydı (1.880.000 ₺ araçta 349.729 = kredi, peşinat 1.530.271 olurdu).
// kredi-hesap.js ikisini de döndürür — sonucun TAMAMI alınıyor ki tutar,
// peşinat, taksit ve vade birlikte basılabilsin.
function krediler(fiyat, kasko, kredi, oranlar) {
  if (!kredi || !fiyat) return { bireysel: null, ticari: null }
  try {
    const o = oranlar || kredi.VARSAYILAN_ORANLAR
    const b = kredi.hesapOtosor(fiyat, o)
    const t = kasko ? kredi.hesapTuzel(fiyat, kasko, o) : null
    return {
      bireysel: b?.durum === 'OK' ? b : null,
      ticari: t?.durum === 'OK' ? t : null,
    }
  } catch (e) { console.error('[cam etiketi] kredi hesabı', e); return { bireysel: null, ticari: null } }
}

// Ekspertiz başlığı — boyasız araçta bu bir SATIŞ ARGÜMANI, büyük yazılır.
// Boyalı araçta yalnız başlık kalır; sayılar aşağıdaki renkli rozetlerde.
function ekspertizBaslik(a) {
  const liste = (a.arac_ekspertiz || []).filter(e => e.durum && e.durum !== 'ORIJINAL')
  return liste.length ? yazi('ekspertizli') : yazi('boyasiz')   // editörden düzenlenir
}

// Renkli sayım rozetleri — "1 Boyalı" mavi · "2 Lokal" sarı · "1 Değişen" kırmızı.
// Renkler ekspertiz.js'teki RENK ile BİREBİR (şemadaki panel rengiyle aynı),
// böylece müşteri rozetle şemayı gözüyle eşleştirebiliyor.
const ROZET_YAZI = { BOYALI: '#fff', 'LOKAL BOYA': '#3f3f3f', DEGISEN: '#fff' }
function sayimRozetleri(a) {
  const liste = a.arac_ekspertiz || []
  return ['BOYALI', 'LOKAL BOYA', 'DEGISEN'].map(d => {
    const n = liste.filter(e => e.durum === d).length
    if (!n) return ''
    return `<span class="rozet" style="background:${RENK[d]};color:${ROZET_YAZI[d]}">${n} ${kacis(DURUM_ETIKET[d] || d)}</span>`
  }).filter(Boolean).join('')
}

// Tramer — Göksenil: "bazı araçlarda 15 20 tane tramer kaydı olabiliyor,
// hepsini oraya yazdıramayız". Bu yüzden kayıt DÖKÜMÜ BASILMIYOR; kaç kayıt
// olursa olsun SABİT yükseklikte 3 satır çıkar:
//   TRAMER KAYDI  ·  TOPLAM TUTAR (en büyük)  ·  "N kayıt · en yüksek ₺X"
// "En yüksek tek hasar" bilerek eklendi: 20 kayıtlı bir araçta müşterinin
// asıl sorusu "tek büyük kaza mı, 20 küçük çizik mi". Toplam tutar bunu
// söylemez, en yüksek tek kalem söyler — hem de tek satırda.
//
// ⚠️ Kayıt YOKSA "0 ₺" YAZMAYIZ. Tramer sorgulanmamış bir araçta "0 ₺"
// basmak müşteriye kanıtlanamayan bir iddiadır (arac-detay.js'teki "aracın
// tramer kaydı olmayabilir" notu). Kayıt yoksa açıkça öyle yazar.
function tramerOzeti(a) {
  const trm = a.arac_tramer || []
  // 1) Hiç kayıt yok → "Kayıt Yok"
  if (!trm.length) return { deger: 'Kayıt Yok', alt: '' }

  // 2) Kayıt var ama HİÇBİRİNDE tutar girilmemiş (yalnız tutanak tutulmuş)
  //    → "2 Adet / —". Tutar sütununu boş bırakmak yerine tire basıyoruz ki
  //    "tutar sıfır" ile "tutar bilinmiyor" karışmasın.
  //    ⚠️ null/'' ile 0 AYRI: 0 girilmiş bir kayıt gerçek bir bilgidir
  //    (hasar kaydı var, bedeli sıfır) ve toplama girer.
  const girilmis = trm.filter(t => t.tutar !== null && t.tutar !== undefined && t.tutar !== '')
  if (!girilmis.length) return { deger: `${trm.length} Adet / —`, alt: '' }

  // 3) Tutarlı kayıt var → "X Adet / ₺X"
  const tutarlar = girilmis.map(t => Number(t.tutar) || 0)
  const toplam = tutarlar.reduce((s, v) => s + v, 0)
  // Kayıtların bir kısmında tutar yoksa bunu gizlemeyelim: toplam eksik demektir
  const eksik = trm.length - girilmis.length
  const alt = eksik ? `${eksik} kayıtta tutar belirtilmemiş` : ''
  return { deger: `${trm.length} Adet / ${paraOn(toplam)}`, alt }
}

// Güven satırı — YALNIZ KANITLANABİLİR maddeler basılır.
// 1. ibare ("Ekspertiz Raporu Hazır") ancak araçta gerçekten ekspertiz evrakı
// varsa çıkar; olmayan araçta bu ibare müşteriye yanlış beyan olurdu.
// 2. ibare her araçta basılır (şirket politikası beyanı, araca bağlı değil).
//
// ⚠️ METİNLER EDİTÖRDEN DÜZENLENİR (yazi()). 2. ibare "Takasa Açık" idi,
//    Göksenil isteğiyle "Kredi Kartına 12 Ay Taksit" oldu (11 Ağu 2026) —
//    kampanya değişince kod değil, editördeki yazı güncellenir.
function guvenMaddeleri(a) {
  const tipler = new Set((a.arac_evraklar || []).map(e => e.tip))
  const maddeler = []
  if (tipler.has('EKSPERTIZ_PDF') || tipler.has('EKSPERTIZ_LINK')) maddeler.push(yazi('guvenEkspertiz'))
  const ikinci = yazi('guvenIkinci')
  if (ikinci) maddeler.push(ikinci)
  return maddeler.map(m => `<span class="g-madde">✓ ${kacis(m)}</span>`).join('')
}

// Kredi dipnotu — Göksenil: "sadece ticari kredi tutarı için değil,
// bireysel ticari ikisinde de".
// ⚠️ TSB kasko ibaresi PARANTEZE ALINDI çünkü yalnız TİCARİ kredi için doğru:
// hesapTuzel() kasko bedelini kullanır, bireysel (hesapOtosor) yalnız satış
// fiyatını kullanır — kasko hiç girmez. "İkisi de TSB'ye göre" demek
// müşteriye yanlış bilgi olurdu. Bağlayıcı olmama kısmı İKİSİNİ DE kapsıyor.
// "Bağlayıcı değildir" kasıtlı: taksit rakamı kâğıda basıldığı an bayatlamaya
// başlar, teklif yerine geçmemeli.
export const KREDI_DIPNOT =
  'Bireysel ve ticari kredi tutarları güncel banka faiz oranlarıyla hesaplanmıştır ' +
  '(ticari kredide TSB kasko değeri esas alınır). Faiz oranları değişebileceğinden ' +
  'peşinat ve taksit tutarları bağlayıcı değildir; güncel teklif için satış ' +
  'danışmanınıza başvurunuz.'

// Kredi bloğu — Göksenil: "aylık taksit miktarını büyük yazacaksın, altına
// peşinat. Müşteriye ne kadar küçük sayı gösterirsek algısını o kadar
// değiştirebiliriz." Bu yüzden EN BÜYÜK rakam AYLIK TAKSİT.
//   başlık (büyük)  →  kredi tutarı (orta)  →  AYLIK TAKSİT (en büyük)
//                                            →  peşinat + vade (küçük)
// ⚠️ Kredi tutarı BLOKTA KALIYOR: başlık "KREDİ TUTARI" diyor, altındaki tek
// büyük rakam taksit olsaydı başlık yanlış bir sayıyı işaret ederdi.
function krediBlok(alan, baslik, r) {
  if (!r) {
    return `<div class="alan a-kutu" data-alan="${alan}">
      <span class="ust-b">${kacis(baslik)}</span><span class="buyuk">—</span></div>`
  }
  // ⚠️ HİZA: "₺138.055 / AY" gibi ekli bir dize ORTALANDIĞINDA rakamın kendisi
  // üstündeki "₺1.246.000"a göre sola kayar — kutu tam ortalı olsa bile göz
  // bunu eğrilik olarak görür (ölçüldü: kutu sapması 0.0mm, sorun optikti).
  // Çözüm: "/ AY" eki ayrı bir BAŞLIK satırına alındı, büyük satırda YALNIZ
  // para dizesi kaldı → iki para satırı da aynı biçimde, üst üste hizalı.
  const taksitVar = !!(r.vade && r.taksit)
  // Kredi tutarı BÜYÜK satırdan alt satıra indi (taksit en büyük olsun diye)
  // ve başlık "… KREDİ TUTARI" değil "… KREDİ" oldu — başlığın işaret ettiği
  // rakam artık taksit; "TUTARI" deseydik başlık yanlış sayıyı gösterirdi.
  const alt = [
    `Kredi ${paraOn(Math.round(r.kredi))}`,
    r.pesinat != null ? `Peşinat ${paraOn(Math.round(r.pesinat))}` : '',
    r.vade ? `${r.vade} Ay` : '',
  ].filter(Boolean).join(' · ')
  return `<div class="alan a-kutu" data-alan="${alan}">
      <span class="ust-b">${kacis(baslik)}</span>
      ${taksitVar ? '<span class="ara">Aylık Taksit</span>' : ''}
      <span class="buyuk">${paraOn(Math.round(taksitVar ? r.taksit : r.kredi))}</span>
      <span class="ek">${kacis(alt)}</span>
    </div>`
}

const ayYil = t => {
  if (!t) return ''
  const g = new Date(t)
  return isNaN(g) ? '' : String(g.getMonth() + 1).padStart(2, '0') + '/' + g.getFullYear()
}

function qrSvg(a) {
  if (!QR) return ''
  try {
    const q = QR(0, 'M')                     // tip 0 = otomatik boyut
    q.addData(qrAdresi(a))
    q.make()
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
  } catch (e) { console.error('[cam etiketi] QR üretilemedi', e); return '' }
}

function sayfaHtml(a, fiyat, kredi, kasko, oranlar) {
  const k = krediler(fiyat, kasko, kredi, oranlar)
  // ⚠️ Kampanya DEĞİL: Göksenil "bu bir kampanya değil, aracın piyasa değeri
  // değişmiş olabilir" dedi → etikete TARİH ARALIĞI BASILMAZ. Var olmayan bir
  // kampanya ima etmesin; rozet penceresi dolunca sessizce kaybolur.
  const ind = INDIRIM[a.id] || null
  const trm = tramerOzeti(a)
  const kdv = (a.kdv_orani && a.kdv_orani !== 'BELLI_DEGIL') ? buyuk(kdvEtiket(a.kdv_orani)) + ' ' + yazi('kdvSon') : ''
  const muayene = ayYil(a.muayene_tarihi)
  const garanti = garantiMetni(a.km)
  const anahtarVar = !!a.yedek_anahtar

  const efsane = ['ORIJINAL', 'BOYALI', 'LOKAL BOYA', 'DEGISEN']
    .map(x => `<span><i style="background:${RENK[x]}"></i>${kacis(DURUM_ETIKET[x] || x)}</span>`).join('')

  // Model + versiyon tek blokta (matbaa örneğinde alt alta sarıyor)
  const model = [B(a.model), B(a.versiyon)].filter(Boolean).join(' ')
  // Kasa tipi formda ayrı yeri olmadığı için model satırının sonuna eklenir
  const kasa = a.kasa_tipi ? buyuk(kasaKisa(tanimGoster('KASA_TIPI', a.kasa_tipi))) : ''

  return `<div class="sayfa" data-arac="${a.id}">
    <img class="rehber" src="img/cam-etiketi-rehber.jpg" alt="" />
    <div class="izgara"></div>

    <!-- ÜST ŞERİT (→33.7mm) -->
    <div class="alan a-fiyat" data-alan="fiyat">
      <span class="f-ana">${paraOn(fiyat)}</span>
      ${ind ? `<span class="f-yan"><span class="f-eski">${paraOn(ind.eski_fiyat)}</span><span class="f-ind">${paraOn(ind.indirim_tutari)} indirim</span></span>` : ''}
    </div>

    <!-- ORTA BLOK (33.7→127.7mm) -->
    <div class="alan a-yil"   data-alan="yil">${B(a.yil) || ''}</div>
    <div class="alan a-yakit" data-alan="yakit">${kacis(tanimGoster('YAKIT', a.yakit, true))}</div>
    <div class="alan a-vites" data-alan="vites">${kacis(tanimGoster('VITES', a.vites, true))}</div>
    <div class="alan a-marka" data-alan="marka">${B(a.marka)}</div>
    <div class="alan a-model" data-alan="model">${model}${kasa ? ` <span class="ince">${kacis(kasa)}</span>` : ''}</div>
    ${/* "KM" · "KDV" · "MUAYENE" sabitleri editörden düzenlenir (yazi()) */''}
    <div class="alan a-km"    data-alan="km">${a.km != null ? Number(a.km).toLocaleString('tr-TR') + ' ' + kacis(yazi('kmSon')) : ''}</div>
    <div class="alan a-kdv"   data-alan="kdv">${kacis(kdv)}</div>
    <div class="alan a-muayene" data-alan="muayene">${muayene ? kacis(yazi('muayeneOn')) + ' ' + kacis(muayene) : ''}</div>
    <div class="alan a-garanti" data-alan="garanti">${kacis(garanti)}</div>

    <!-- ALT SOL: plaka + ekspertiz (→104.5mm) -->
    <div class="alan a-plaka" data-alan="plaka">
      <span class="pl-kutu"><span class="pl-tr">TR</span><span class="pl-no">${BL(a.plaka) || '—'}</span></span>
    </div>
    <div class="alan a-boya"  data-alan="boyaOzet">${kacis(ekspertizBaslik(a))}</div>
    <div class="alan a-eksp"  data-alan="eksp"><div class="eksp-svg">${SVGTXT || ''}</div></div>
    <div class="alan a-efsane" data-alan="efsane">${efsane}</div>
    <div class="alan a-sayim" data-alan="sayim">${sayimRozetleri(a)}</div>
    <!-- Alt yazı kaldırıldı: QR üst şeride (fiyatın soluna) taşındı ve
         24mm + 4.2mm yazı, matbaanın 33.7mm'deki çizgisini aşıyordu. -->
    <div class="alan a-qr" data-alan="qr">${qrSvg(a)}</div>

    <!-- ALT SAĞ: tramer → güven → krediler → dipnot (104.5→202mm) -->
    <div class="alan a-kutu" data-alan="tramer">
      <span class="ust-b">Tramer Kaydı</span>
      <span class="buyuk">${kacis(trm.deger)}</span>
      ${trm.alt ? `<span class="ek">${kacis(trm.alt)}</span>` : ''}
    </div>
    <div class="alan a-guven" data-alan="guvenSerit">${guvenMaddeleri(a)}</div>
    ${krediBlok('kredi1', 'Bireysel Kredi', k.bireysel)}
    <div class="alan a-serit" data-alan="finansSerit">
      <span class="s-ust">${BANKALAR.length} Finans Kurumu</span>
      <span class="s-alt">Size en uygun teklifi buluyoruz</span>
    </div>
    ${krediBlok('kredi2', 'Ticari Kredi', k.ticari)}
    <div class="alan a-not" data-alan="krediNot">${kacis(KREDI_DIPNOT)}</div>
    <div class="alan a-anahtar" data-alan="anahtar">
      <span class="ah-ikon">🔑</span>
      <span class="ah-c">VAR <i class="kutucuk">${anahtarVar ? '✓' : ''}</i></span>
      <span class="ah-c">YOK <i class="kutucuk">${anahtarVar ? '' : '✓'}</i></span>
    </div>
  </div>`
}

function ekspertizBoya(a) {
  const kap = document.querySelector(`.sayfa[data-arac="${a.id}"] .eksp-svg svg`)
  if (!kap) return
  const paneller = Object.fromEntries(PARCALAR.map(p => [p, 'ORIJINAL']))
  for (const e of (a.arac_ekspertiz || [])) if (paneller[e.parca_kodu] !== undefined) paneller[e.parca_kodu] = e.durum
  svgBoya(kap, paneller)
  // Yazdırmada renkler solmasın
  kap.querySelectorAll('[data-part]').forEach(p => { p.style.cursor = 'default' })
}

function mesaj(m) { return `<div style="max-width:600px;margin:40px auto;background:#fff;padding:24px;border-radius:12px">${kacis(m)}</div>` }
function durum(m) { const el = document.getElementById('durum'); if (el) el.textContent = m }

// ---------- ETİKET BASILDI KAYDI (sql/102) ----------
// Göksenil kararı: yazdırmaya basılınca OTOMATİK değil, kişi işaretleyince.
// Tarayıcı "gerçekten yazdırıldı mı" bilgisini vermez; iptal edilen yazdırmayı
// "basıldı" saymak yanıltıcı olurdu. Tek dürüst yol beyan.
// Neden kaydediyoruz: etiket/kasa fiyat uyuşmazlığında tüketici lehine olan
// fiyat uygulanır → camdaki etiketin HANGİ fiyatla basıldığı bilinmeli.
async function basimKaydet() {
  const btn = document.getElementById('basildiBtn')
  if (!SIRALI.length) return
  btn.disabled = true
  const eski = btn.textContent
  btn.textContent = 'Kaydediliyor…'
  const satirlar = SIRALI.map(a => ({
    arac_id: a.id,
    satis_fiyati: a._etiketFiyat ?? null,
    eski_fiyat: (INDIRIM[a.id] || {}).eski_fiyat ?? null,
  }))
  const { data, error } = await supabase.from('cam_etiketi_basimlari')
    .insert(satirlar).select('id')
  if (error) {
    dbHata('cam etiketi basım kaydı', error)
    btn.textContent = 'Kaydedilemedi'
    setTimeout(() => { btn.textContent = eski; btn.disabled = false }, 2500)
    return
  }
  // §5.1 — PostgREST 0 satır yazıp HATA VERMEZ; yetki yoksa sessizce boş döner.
  if (!data?.length) {
    btn.textContent = 'Yetki yok'
    setTimeout(() => { btn.textContent = eski; btn.disabled = false }, 2500)
    return
  }
  btn.textContent = `✓ ${data.length} etiket kaydedildi`
  durum(`${data.length} araç için basım kaydı düşüldü`)
}

function kur() {
  document.getElementById('yazdir')?.addEventListener('click', () => window.print())
  document.getElementById('basildiBtn')?.addEventListener('click', basimKaydet)
  document.getElementById('izgaraKutu')?.addEventListener('change', e =>
    document.body.classList.toggle('izgara-acik', e.target.checked))
  document.getElementById('rehberKutu')?.addEventListener('change', e =>
    document.body.classList.toggle('rehber-kapali', !e.target.checked))
  document.getElementById('opaklik')?.addEventListener('input', e =>
    document.documentElement.style.setProperty('--rehber-opaklik', e.target.value / 100))
  // Düzenle: aynı sayfayı ?duzenle=1 ile açar
  const dbtn = document.getElementById('duzenleBtn')
  if (dbtn) {
    const u = new URL(location.href); u.searchParams.set('duzenle', '1')
    dbtn.href = u.toString()
    if (urlParam('duzenle') === '1') { dbtn.textContent = '✓ Düzenleme açık'; dbtn.style.background = '#1f7a3d' }
  }
}

// TSB kasko bedeli (ticari kredi için) — sorgunun kendisi kredi-hesap.js'te
// (TEK KAYNAK). Buradaki eski kopya gt(0) ve liste_donemi sıralaması
// yapmadığı için araç kartından FARKLI bir satır seçebiliyordu; kâğıt ile
// ekran ayrı ticari kredi tutarı gösterirdi.
async function kaskoYukle(kredi, araclar) {
  const map = {}
  if (!kredi) return map
  await Promise.all(araclar.map(async a => {
    const v = await kredi.kaskoBedeliYukle(supabase, a)
    if (v) map[a.id] = Number(v)
  }))
  return map
}
