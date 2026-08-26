// =====================================================================
// guncel-ekspertiz.js — "Güncel İste": güncel kilometreli ekspertiz isteği
//
// TEK KAYNAK. İki ekran aynı pencereyi, aynı metni, aynı paylaşım inişini
// kullanır:
//   · Satış Dosyası (siparis-dosya.js)  → RPC guncel_ekspertiz_iste(p_siparis)
//   · Kredi Operasyon Merkezi (kredi.js) → RPC guncel_ekspertiz_iste_arac(p_arac)
// Kopyası yazılmaz; yeni bir çağıran eklenecekse buraya parametre eklenir.
//
// Göksenil (3 Ağu 2026): "Ekspertiz Raporu Aç butonunun oraya GÜNCEL İSTE
//   adında bir buton koy… bu butona basıldıysa operasyonda göster, personel
//   onaylasın." Sipariş noter satışından ÖNCE açılabildiği için elde eski
//   kilometreli rapor kalıyor; noter öncesi güncelini istemek gerekiyor.
//   (3 Ağu 2026, ikinci tur): "kredi personeli de kredisi onaylı ise güncel
//   ekspertizi kendileri isteyebiliyorlar" → kredi kuyruğu da bu pencereyi açar.
//
// ⚠️ WHATSAPP GERÇEĞİ — gruba otomatik gönderim YOK:
//   · wa.me yalnız NUMARAYA gider ve DOSYA EKLEYEMEZ (sadece metin)
//   · resmî WhatsApp Business Cloud API gruplara HİÇ mesaj göndermiyor
//   Bu yüzden akış yarı otomatik (Göksenil onayı): metin hazır açılır,
//   kullanıcı grubu seçip gönderir. Butona basılması DB'ye yazılır —
//   operasyon senaryosu buna bağlı, mesajın gidip gitmediğine değil.
//
// ✅ Ruhsat görseli mesaja EKLENEBİLİYOR. Tarayıcının Web Share API'si
//    (navigator.share({files})) dosyayı doğrudan WhatsApp'a verir. Üç kademeli
//    iniş:
//      1. navigator.canShare({files}) → paylaş menüsü (mobil + Windows/Chrome)
//      2. pano: görsel kopyalanır + wa.me açılır → WhatsApp Web'de Ctrl+V
//      3. hiçbiri yoksa: görsel pop-up'ta açılır, elle eklenir
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, buyuk, dbHata, fmtTarih } from './veri.js'
import { mat } from './stitch-ui.js'
import { evrakAc } from './siparis-evrak.js'

const EKSPERTIZ_ISTEK_METNI = 'Merhaba kolay gelsin, güncel kilometreli ekspertizi rica edebilir miyim?'
// Form sınıfları — satış dosyasındaki pencereyle birebir aynı görünüm.
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
const LBL = 'text-[11px] font-bold text-on-surface-variant uppercase'

// Ekspertiz firmasını PDF'ten TANI ve araca yaz.
//
// Neden burada: firma bilgisi `ekspertiz.js` içinde rapor okunurken zaten
// çıkarılıyor (SVG'yi onunla boyuyoruz) ama sonuç sql/151'e kadar hiçbir yere
// yazılmıyordu → geçmiş araçlarda NULL. Kullanıcıya sormak yerine depodaki
// PDF'i açıp tanıyoruz. Bir kez çalışır, sonuç araca yazılır.
//
// ⚠️ Yalnız metin okunur (ilk 2 sayfa) — şema OCR'ı ÇALIŞTIRILMAZ, o saniyeler
//   sürüyor ve firma için gereksiz.
async function ekspertizFirmasiTani(ov, o) {
  const ad = ov.querySelector('#geFirmaAd')
  const not = ov.querySelector('#geGrupNot')
  const yaz = (metin, grup) => {
    if (ad) ad.textContent = metin
    if (not) not.innerHTML = grup ? `<span class="text-on-surface-variant"> · grup:</span> <b>${kacis(grup)}</b>` : ''
  }
  const { data: imza, error: iErr } = await supabase.storage.from('arac-evrak').createSignedUrl(o.ekspertizYol, 600)
  if (iErr || !imza?.signedUrl) { dbHata('ekspertiz imzalı url', iErr); yaz('okunamadı', null); return }
  let dosya
  try {
    const c = await fetch(imza.signedUrl)
    if (!c.ok) { console.error('[ekspertiz indir] HTTP', c.status); yaz('okunamadı', null); return }
    dosya = new File([await c.blob()], 'ekspertiz.pdf', { type: 'application/pdf' })
  } catch (e) { console.error('[ekspertiz indir]', e); yaz('okunamadı', null); return }

  const { ekspertizFirmaTani } = await import('./ekspertiz.js')
  const kod = await ekspertizFirmaTani(dosya)
  if (!kod) { yaz('tanınamadı', null); return }

  const f = (o.firmalar || []).find(x => x.kod === kod) || null
  yaz(f?.ad || kod, f?.grup_adi || null)

  // §5.1: .update() 0 satır güncelleyebilir — DAİMA say.
  const { data, error } = await supabase.from('stok_araclar')
    .update({ ekspertiz_firma: kod }).eq('id', o.aracId).select('id')
  if (error) { dbHata('ekspertiz firma yaz', error); return }
  if (!data?.length) console.error('[ekspertiz firma] 0 satir guncellendi — yetki?')
}

// Özel bucket → imzalı URL → File. Paylaşım için gerçek dosya nesnesi gerek.
async function ruhsatDosyasiAl(yol, plaka) {
  if (!yol) return null
  const { data, error } = await supabase.storage.from('arac-evrak').createSignedUrl(yol, 600)
  if (error || !data?.signedUrl) { dbHata('ruhsat imzalı url', error); return null }
  try {
    const c = await fetch(data.signedUrl)
    if (!c.ok) { console.error('[ruhsat indir] HTTP', c.status); return null }
    const blob = await c.blob()
    const uzanti = (yol.match(/\.(\w+)(?:\?|$)/) || [, 'jpg'])[1]
    const ad = String(plaka || 'arac').replace(/\s+/g, '')
    return new File([blob], `ruhsat_${ad}.${uzanti}`, { type: blob.type || 'image/jpeg' })
  } catch (e) { console.error('[ruhsat indir]', e); return null }
}

// Görseli panoya kopyala (WhatsApp Web'de Ctrl+V ile yapışır).
// ⚠️ Pano yalnız PNG kabul ediyor; JPEG'i canvas'tan PNG'ye çeviriyoruz.
async function panoyaKopyala(dosya) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
  try {
    let blob = dosya
    if (dosya.type !== 'image/png') {
      const bit = await createImageBitmap(dosya)
      const cv = document.createElement('canvas')
      cv.width = bit.width; cv.height = bit.height
      cv.getContext('2d').drawImage(bit, 0, 0)
      blob = await new Promise(r => cv.toBlob(r, 'image/png'))
      if (!blob) return false
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch (e) { console.error('[pano kopyala]', e); return false }
}

// "Güncel İste" / "İstendi" düğmesi.
//   istendi → timestamptz ya da null (damga; siparişte ya da araçta)
//   opt: { id, pasif, pasifBaslik }
export function guncelIsteBtnHtml(istendi, opt = {}) {
  const { id = 'sdGuncelIste', pasif = false, pasifBaslik = '' } = opt
  const baslik = pasif
    ? (pasifBaslik || 'Şu an güncel ekspertiz istenemez')
    : (istendi
      ? 'Güncel ekspertiz istendi: ' + fmtTarih(istendi) + ' — tekrar istemek için tıklayın'
      : 'Ekspertiz firmasından güncel kilometreli rapor iste')
  return `<button id="${kacis(id)}" type="button"${pasif ? ' disabled' : ''} title="${kacis(baslik)}"
      class="shrink-0 px-2 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition-colors ${
        pasif ? 'border-outline-variant text-on-surface-variant opacity-60 cursor-not-allowed'
        : istendi ? 'border-secondary/50 bg-secondary-container text-on-secondary-container'
                  : 'border-primary text-primary hover:bg-primary-fixed/40'}">
      ${mat(istendi ? 'mark_email_read' : 'refresh', 'text-[15px]')} ${istendi ? 'İstendi' : 'Güncel İste'}</button>`
}

// Mesaj metni — plaka/şasi yazılır ki ruhsat görseli eklenemese bile firma
// aracı tanısın (Göksenil: ruhsat yoksa uyar ama göndermeye izin ver).
export function guncelIstekMetni({ plaka, baslik, sasi }) {
  return [
    EKSPERTIZ_ISTEK_METNI,
    '',
    `Plaka: ${plaka ? buyuk(plaka) : '—'}`,
    `Araç: ${buyuk(baslik || 'Araç —')}`,
    sasi ? `Şasi: ${buyuk(sasi)}` : null,
  ].filter(x => x !== null).join('\n')
}

// Pencereyi aç.
//   o.plaka / o.baslik / o.sasi  → mesaj metni
//   o.ruhsatYol                   → arac-evrak bucket YOLU (URL değil) ya da null
//   o.firma                       → { ad, grup_adi } ya da null (hatırlatma)
//   o.istek()                     → RPC çağrısı, { data, error } döndürür
//   o.yenile()                    → başarıdan sonra çağıran ekranı tazeler
export async function guncelEkspertizAc(o) {
  const firma = o.firma || null
  const ruhsatYol = o.ruhsatYol || null
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-sm overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md mb-8" onclick="event.stopPropagation()">
      <div class="px-5 py-4 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low">
        <div class="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary">${mat('fact_check', '', true)}</div>
        <div><h3 class="text-lg font-black text-primary">Güncel Ekspertiz İste</h3>
          <p class="text-xs text-on-surface-variant">Mesaj hazır açılır, grubu siz seçersiniz.</p></div>
      </div>
      <div class="p-5 space-y-3">
        ${/* Göksenil (3 Ağu 2026): "ekspertiz firması bilinmiyor yazıyor ama
              rapor dynomoss'un… senin biliyor olman lazım." Haklı — okuyucu
              firmayı ZATEN tanıyor (ekspertiz.js firmaTani), SVG'yi onunla
              dolduruyor; ama sonuç hiçbir yere yazılmıyordu, o yüzden geçmiş
              araçlarda NULL kalmış. Kullanıcıya SORMAK yanlış cevap: burada
              depodaki PDF açılıp firma tanınıyor ve araca yazılıyor (bir kez).
              Kısa süre seçim kutusu yapmıştım; Göksenil düzeltti. */''}
        <div class="bg-surface-container-low rounded-lg p-2.5 text-label-sm" id="geFirmaKutu">
          <span class="text-on-surface-variant">Ekspertiz firması:</span>
          <b class="text-on-surface" id="geFirmaAd">${firma ? kacis(firma.ad) : 'okunuyor…'}</b>
          <span id="geGrupNot">${firma?.grup_adi ? `<span class="text-on-surface-variant"> · grup:</span> <b>${kacis(firma.grup_adi)}</b>` : ''}</span>
        </div>

        ${ruhsatYol
      ? `<div class="bg-secondary-container/40 border border-secondary/30 rounded-lg p-2.5 text-label-sm flex items-start gap-2">
               ${mat('attach_file', 'text-[16px] text-secondary shrink-0')}
               <div class="min-w-0"><b>Ruhsat görseli mesaja eklenecek.</b>
                 <p class="text-[11px] text-on-surface-variant" id="gePaylasNot">Paylaş menüsü açılacak — WhatsApp'ı ve grubu seçin, görsel ve metin birlikte gider.</p></div>
             </div>`
      : `<div class="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-[12.5px] text-amber-900 flex items-start gap-2">
               ${mat('warning', 'text-[16px] shrink-0')}
               <div><b>Bu araçta ruhsat görseli yok.</b>
                 <p class="mt-0.5">Mesajı yine de gönderebilirsiniz — plaka ve şasi metne yazıldı.
                   <b>Bilgi işlem birimine bildirim gidecek</b>, ruhsatı onlar yükleyecek.</p></div>
             </div>`}

        <div>
          <label class="${LBL}" for="geMetin">Gönderilecek Mesaj</label>
          <textarea id="geMetin" rows="6" readonly class="${INP} mt-1 resize-none font-mono text-[12px] leading-relaxed"></textarea>
        </div>
      </div>
      <div class="flex justify-end gap-2 px-5 pb-5">
        <button class="ge-kapat px-5 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
        <button id="geGonder" class="px-6 py-2.5 bg-secondary text-on-primary rounded-lg text-sm font-bold hover:opacity-90 flex items-center gap-2">${mat('open_in_new', 'text-[18px]')} WhatsApp'ta Aç</button>
      </div>
    </div>`
  document.body.appendChild(ov)

  const esc = e => { if (e.key === 'Escape') kapat() }
  const kapat = () => { document.removeEventListener('keydown', esc); ov.remove() }
  document.addEventListener('keydown', esc)
  ov.addEventListener('click', e => { if (e.target === ov) kapat() })
  ov.querySelectorAll('.ge-kapat').forEach(b => b.addEventListener('click', kapat))
  ov.querySelector('#geMetin').value = guncelIstekMetni(o)
  // ⚠️ Otomatik odak YOK: "WhatsApp'ta Aç" odaklı olsaydı Enter'a basmak
  //   isteği kazara kaydederdi. Esc kapatır, Tab ile gezilir.

  // Firma kayıtlı değilse: depodaki ekspertiz PDF'ini aç, firmayı TANI, araca
  // yaz. Kullanıcıya sorulmaz. Bir kez çalışır — bir daha bu yola girilmez.
  if (!firma && o.ekspertizYol && o.aracId) ekspertizFirmasiTani(ov, o)

  // Dosyayı ÖNDEN indir: paylaş menüsü kullanıcı hareketinin içinde açılmalı,
  // araya `await fetch` girerse tarayıcı hareketi "kullanıcı başlatmadı" sayıp
  // navigator.share'i reddediyor.
  let ruhsatDosya = null
  if (ruhsatYol) {
    ruhsatDosyasiAl(ruhsatYol, o.plaka).then(d => {
      ruhsatDosya = d
      const not = ov.querySelector('#gePaylasNot')
      if (!not) return
      if (d && navigator.canShare?.({ files: [d] })) not.textContent = 'Paylaş menüsü açılacak — WhatsApp\'ı ve grubu seçin, görsel ve metin birlikte gider.'
      else if (d) not.textContent = 'Bu tarayıcı paylaşımı desteklemiyor: görsel panoya kopyalanacak, WhatsApp\'ta Ctrl+V ile yapıştırın.'
      else not.textContent = 'Ruhsat indirilemedi — görsel pop-up\'ta açılacak, elle ekleyin.'
    })
  }

  ov.querySelector('#geGonder').addEventListener('click', async () => {
    const metin = guncelIstekMetni(o)
    let paylasildi = false

    // 1) En iyi yol: dosya + metin doğrudan WhatsApp'a.
    if (ruhsatDosya && navigator.canShare?.({ files: [ruhsatDosya] })) {
      try {
        await navigator.share({ files: [ruhsatDosya], text: metin })
        paylasildi = true
      } catch (e) {
        // AbortError = kullanıcı paylaş menüsünü kapattı; istek de kaydedilmez.
        if (e?.name === 'AbortError') return
        console.error('[paylaş]', e)
      }
    }
    // 2) Pano: görsel kopyalanır, wa.me metinle açılır → Ctrl+V.
    if (!paylasildi) {
      const kopyalandi = ruhsatDosya ? await panoyaKopyala(ruhsatDosya) : false
      // window.open kullanıcı hareketinin İÇİNDE kalmalı.
      window.open('https://wa.me/?text=' + encodeURIComponent(metin), '_blank')
      if (ruhsatDosya && !kopyalandi) evrakAc(ruhsatYol, 'Ruhsat', buyuk(o.plaka || ''))
      else if (kopyalandi) alert('Ruhsat görseli panoya kopyalandı. WhatsApp\'ta grubu seçip Ctrl+V ile yapıştırın.')
    }

    kapat()
    const { data, error } = await o.istek()
    if (error) { dbHata('güncel ekspertiz iste', error); alert('İstek kaydedilemedi: ' + error.message); return }
    if (!data?.tamam) { alert('İstek kaydedilemedi: ' + (data?.hata || 'bilinmeyen hata')); return }
    await o.yenile?.()
  })
}
