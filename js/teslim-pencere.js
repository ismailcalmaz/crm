// =====================================================================
// teslim-pencere.js — "Teslim Et" pop-up'ı: noter kaydı + ruhsat QR
//
// Göksenil (5 Ağu 2026): "TESLİM ET butonuna basıyorum, 'araç teslim
//   edildi olarak işaretlensin mi' bildirimi geldi. Bunu POP UP ile
//   istiyorum. Ve ben hâlâ işlem yapılan noteri, yevmiye noyu, yeni
//   ruhsat belge seri noyu, yeni plakayı (değiştiyse) girmedim."
//
// ⚠️ İKİ AYRI KUSUR VARDI:
//   1. Onay tarayıcının `confirm()` kutusuydu — sipariş kapatan bir işlem
//      için fazla sığ, hangi araç/müşteri olduğu bile görünmüyordu.
//   2. Asıl sorun: noter devri KAYDEDİLMEDEN teslim edilebiliyordu.
//      Noter devri satışın KENDİSİ; kaydı olmadan dosya eksik kapanıyor
//      ve sonradan kimse geri dönüp doldurmuyor. Artık bu alanlar
//      pop-up'ta ZORUNLU (Göksenil kararı).
//
// İKİ KİP (19 Ağu 2026):
//   mod:'teslim' (varsayılan) → siparis_teslim_et, dosyayı KAPATIR
//   mod:'noter'               → aynı alanları YALNIZ KAYDEDER, kapatmaz
// İkinci kip neden gerekti: finans onayı dosyayı doğrudan satışa
// düşürebiliyor (Bahadır'ın sistemi teslimat-tamamla'yı kendisi çağırıyor),
// o yüzden noter/ruhsat verisi ONAYA GÖNDERMEDEN ÖNCE alınmalı — sonra
// girilecek ekran kalmıyor. Aynı pencerenin kopyasını yazmak yerine kip
// eklendi: QR okuyucu, doğrulama ve alan adları tek yerde kalsın.
//
// Zorunlu: noter adı · yevmiye no · yeni ruhsat seri no
// Koşullu: yeni plaka — YALNIZ siparisler.plaka_degisecek = true ise
//   (o beyan Noter Satış Bilgisi kartında alınıyor, sql/150).
//
// Ruhsat QR (ruhsat-qr.js) seri no ve plakayı kendiliğinden doldurur.
// Kopya okuyucu YAZILMADI — Araç Kabul sihirbazındaki aynı modül.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, buyuk, dbHata, fmtTarih, bugunISO } from './veri.js'
import { mat } from './stitch-ui.js'

const INP = 'w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 h-11 text-[16px] focus:ring-2 focus:ring-primary/20 focus:outline-none'
const LBL = 'text-[11px] font-bold text-on-surface-variant uppercase tracking-wide'

let PEN = null

export function teslimPencereKapat() {
  if (!PEN) return
  document.removeEventListener('keydown', PEN._esc)
  PEN.remove(); PEN = null
}

// @param s        sipariş satırı (id, noter_adi, yevmiye_no, yeni_ruhsat_seri_no,
//                 yeni_plaka, plaka_degisecek, satis_tarihi)
// @param bilgi    { plaka, baslik, musteri } — başlıkta gösterilir
// @param bitince  başarıdan sonra çağıranın tazelemesi
// @param secenek  { mod: 'teslim' | 'noter' }
export function teslimPencereAc(s, bilgi, bitince, secenek = {}) {
  teslimPencereKapat()
  const noterKipi = secenek.mod === 'noter'
  const plakaDegisecek = s.plaka_degisecek === true
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[100] flex items-start justify-center pt-[5vh] px-4 bg-black/40 backdrop-blur-sm overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-lg mb-8" onclick="event.stopPropagation()">
      <div class="px-5 py-4 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low">
        <div class="w-10 h-10 rounded-xl bg-secondary/15 flex items-center justify-center text-secondary shrink-0">${mat(noterKipi ? 'gavel' : 'done_all', '', true)}</div>
        <div class="min-w-0">
          <h3 class="text-lg font-black text-primary">${noterKipi ? 'Noter Devri Bilgileri' : 'Aracı Teslim Et'}</h3>
          <p class="text-xs text-on-surface-variant truncate">${kacis(bilgi?.plaka || '')}${bilgi?.baslik ? ' · ' + kacis(bilgi.baslik) : ''}${bilgi?.musteri ? ' · ' + kacis(bilgi.musteri) : ''}</p>
        </div>
        <button class="tp-kapat ml-auto p-2 hover:bg-white rounded-full text-on-surface-variant shrink-0">${mat('close')}</button>
      </div>

      <div class="p-5 space-y-4">
        <div class="${noterKipi ? 'bg-blue-50 border-blue-300 text-blue-900' : 'bg-amber-50 border-amber-300 text-amber-900'} border rounded-lg p-3 text-[12.5px] flex items-start gap-2">
          ${mat(noterKipi ? 'info' : 'warning', 'text-[16px] shrink-0')}
          <span>${noterKipi
            ? 'Bu bilgiler <b>kaydedilir, dosya kapanmaz</b>. Finans onayı dosyayı doğrudan satışa düşürebildiği için noter devri <b>onaya göndermeden önce</b> giriliyor (BR-0131).'
            : 'Bu işlem <b>siparişi kapatır</b> ve geri alınamaz. Noter devir bilgileri kayda geçmeden teslim yapılamaz.'}</span>
        </div>

        ${/* Ruhsat QR — seri no ve plakayı elle yazdırmamak için. Sürükle-bırak,
              dosya seç ve (mobilde) kamera; üçü de aynı okuyucuya gider. */''}
        <div id="tpQrKap" class="rounded-xl border-2 border-dashed border-outline-variant p-3 text-center transition-colors">
          <p class="text-[12px] text-on-surface-variant">${mat('qr_code_scanner', 'text-[18px] align-middle text-primary')}
            <b>Yeni ruhsatı okut</b> — seri no, plaka ve noter adı kendiliğinden dolar</p>
          <div class="flex gap-2 justify-center mt-2 flex-wrap">
            <button type="button" id="tpDosyaBtn" class="px-3 h-9 rounded-lg border border-primary text-primary text-[12px] font-bold hover:bg-primary/5">${mat('upload_file', 'text-[15px] align-middle')} Dosya seç</button>
            <button type="button" id="tpKameraBtn" class="px-3 h-9 rounded-lg border border-primary text-primary text-[12px] font-bold hover:bg-primary/5">${mat('photo_camera', 'text-[15px] align-middle')} Kamerayla oku</button>
          </div>
          <input type="file" id="tpDosya" accept="image/*,application/pdf" class="hidden" />
          ${/* capture: mobilde doğrudan arka kamerayı açar. Masaüstünde
                tarayıcı bunu yok sayıp dosya seçici gösterir — yedek yol
                kendiliğinden çalışır, ayrı koda gerek yok. */''}
          <input type="file" id="tpKamera" accept="image/*" capture="environment" class="hidden" />
          <p id="tpQrDurum" class="text-[11px] text-on-surface-variant mt-2"></p>
          ${/* OCR ayrı satırda: QR anında döner, basılı metin okuması saniyeler
                sürer. Tek satıra yazsalardı QR sonucu OCR ilerlemesiyle silinirdi. */''}
          <p id="tpOcrDurum" class="text-[11px] text-on-surface-variant mt-1"></p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="${LBL}" for="tpTarih">Noter Tarihi</label>
            <input id="tpTarih" type="date" value="${kacis(s.satis_tarihi || bugunISO())}" class="${INP} mt-1" /></div>
          <div><label class="${LBL}" for="tpNoter">Noter Adı *</label>
            <input id="tpNoter" type="text" placeholder="Noterlik adı" value="${kacis(s.noter_adi || '')}" class="${INP} mt-1" /></div>
          <div><label class="${LBL}" for="tpYevmiye">Yevmiye No *</label>
            <input id="tpYevmiye" type="text" value="${kacis(s.yevmiye_no || '')}" class="${INP} mt-1" /></div>
          <div><label class="${LBL}" for="tpRuhsat">Yeni Ruhsat Seri No *</label>
            <input id="tpRuhsat" type="text" style="text-transform:uppercase" value="${kacis(s.yeni_ruhsat_seri_no || '')}" class="${INP} mt-1" /></div>
          ${plakaDegisecek ? `<div class="sm:col-span-2"><label class="${LBL}" for="tpPlaka">Yeni Plaka *</label>
            <input id="tpPlaka" type="text" style="text-transform:uppercase" value="${kacis(s.yeni_plaka || '')}" class="${INP} mt-1" />
            <p class="text-[11px] text-on-surface-variant mt-1">Satış dosyasında <b>plaka değişecek</b> işaretlenmişti.</p></div>`
            : `<div class="sm:col-span-2 text-[11px] text-on-surface-variant flex items-center gap-1">
                 ${mat('info', 'text-[14px]')} Plaka değişmiyor${s.plaka_degisecek == null ? ' (dosyada işaretlenmemiş)' : ''} — yeni plaka sorulmuyor.</div>`}
        </div>

        <div id="tpHata" class="hidden bg-error-container text-on-error-container border border-error/20 rounded-lg px-3 py-2 text-sm"></div>
      </div>

      <div class="flex justify-end gap-2 px-5 pb-5">
        <button class="tp-kapat px-5 h-11 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
        <button id="tpOnay" class="px-6 h-11 bg-secondary text-on-primary rounded-lg text-sm font-bold hover:opacity-90 flex items-center gap-2">${mat(noterKipi ? 'save' : 'done_all', 'text-[18px]')} ${noterKipi ? 'Kaydet' : 'Teslim Et'}</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  PEN = ov
  const esc = e => { if (e.key === 'Escape') teslimPencereKapat() }
  ov._esc = esc
  document.addEventListener('keydown', esc)
  ov.addEventListener('click', e => { if (e.target === ov) teslimPencereKapat() })
  ov.querySelectorAll('.tp-kapat').forEach(b => b.addEventListener('click', teslimPencereKapat))

  const q = sel => ov.querySelector(sel)
  const hataGoster = m => { const h = q('#tpHata'); if (h) { h.textContent = m; h.classList.remove('hidden') } }
  const hataGizle = () => q('#tpHata')?.classList.add('hidden')

  // --- QR ---
  const qrDurum = q('#tpQrDurum')

  // --- Noter adı: QR'da YOK, basılı metinden (OCR) ---------------------
  // Göksenil: "yeni ruhsatı okutmaya ek olarak noter adını da okuyup
  //   otomatik doldursun — İZMİR 23.NOTERLİĞİ mesela."
  // 2023'ten beri tescil noterde yapıldığı için ruhsatın "VERİLDİĞİ İL /
  // İLÇE" kutusunda noterlik adı yazıyor. QR yalnız plaka/seri/kimlik
  // taşır — bu yüzden ayrı bir OCR geçişi şart.
  async function noterOku(dosya) {
    const el = q('#tpNoter'), d = q('#tpOcrDurum')
    if (!el || !d) return
    // ⚠️ ELLE GİRİLENİ EZME: alan doluysa OCR hiç çalışmaz. Kullanıcının
    //    yazdığını bir tahminle değiştirmek en sinsi veri kaybı olurdu.
    if (el.value.trim()) return
    d.className = 'text-[11px] text-on-surface-variant mt-1'
    d.textContent = 'Noter adı okunuyor (OCR)…'
    let satirlar = []
    try {
      const { belgeSatirlari } = await import('./tramer-ocr.js')
      const r = await belgeSatirlari(dosya, p => {
        d.textContent = `Noter adı okunuyor… %${Math.round(p * 100)}`
      })
      satirlar = r.satirlar || []
    } catch (e) {
      console.error('[teslim] ruhsat OCR hata', e)
      d.className = 'text-[11px] text-amber-700 mt-1'
      d.textContent = 'Basılı metin okunamadı — noter adını elle gir.'
      return
    }
    const { ruhsatAlanCikar } = await import('./ruhsat-ocr.js')
    const alanlar = ruhsatAlanCikar(satirlar, null)
    console.debug('[teslim] ruhsat OCR alanları', alanlar)
    const noter = alanlar.noter?.deger
    if (noter && !el.value.trim()) {
      el.value = noter
      d.className = 'text-[11px] text-secondary font-semibold mt-1'
      d.textContent = `Noter adı okundu: ${noter}`
      return
    }
    // Sessiz geçme: neden dolmadığını söyle. Trafik tescilden verilmiş
    // ruhsatlarda o kutuda ilçe adı yazar, noterlik yazmaz.
    d.className = 'text-[11px] text-amber-700 mt-1'
    d.textContent = 'Noter adı okunamadı — elle gir. (Ruhsat trafik tescilden verildiyse üzerinde noterlik yazmaz.)'
  }

  async function qrIsle(dosya) {
    if (!dosya) return
    qrDurum.textContent = 'Ruhsat okunuyor…'
    const { ruhsatQrOku, plakaKarsilastir } = await import('./ruhsat-qr.js')
    const r = await ruhsatQrOku(dosya)
    if (!r.ok) {
      // Sessiz geçme: neden okunamadığını yaz, elle giriş yolu açık kalsın.
      qrDurum.className = 'text-[11px] text-amber-700 mt-2'
      qrDurum.textContent = (r.hata || 'QR okunamadı') + ' — alanları elle girebilirsiniz.'
      // ⚠️ QR okunamasa BİLE noter denenir: basılı metin AYRI bir kaynak,
      //    QR'a bağlı değil (Araç Kabul sihirbazındaki aynı yaklaşım).
      await noterOku(dosya)
      return
    }
    const doldu = []
    if (r.seri) { q('#tpRuhsat').value = r.seri; doldu.push('seri no') }
    if (r.plaka && q('#tpPlaka')) { q('#tpPlaka').value = r.plaka; doldu.push('plaka') }
    qrDurum.className = 'text-[11px] text-secondary font-semibold mt-2'
    qrDurum.textContent = doldu.length ? `Ruhsat okundu — ${doldu.join(' ve ')} dolduruldu.` : 'Ruhsat okundu.'
    // Plaka değişmiyor deniyorsa ama QR'daki plaka araçtakinden FARKLIYSA uyar:
    // ya beyan yanlış ya yanlış ruhsat okutuldu. Sessiz geçmek ikisini de gizler.
    if (r.plaka && !plakaDegisecek && bilgi?.plaka && !plakaKarsilastir(r.plaka, bilgi.plaka)) {
      qrDurum.className = 'text-[11px] text-amber-700 mt-2'
      qrDurum.textContent += ` ⚠ Ruhsattaki plaka (${r.plaka}) araçtakinden farklı — dosyada "plaka değişecek" işaretlenmemiş.`
    }
    await noterOku(dosya)
  }
  q('#tpDosyaBtn').addEventListener('click', () => q('#tpDosya').click())
  q('#tpKameraBtn').addEventListener('click', () => q('#tpKamera').click())
  q('#tpDosya').addEventListener('change', e => qrIsle(e.target.files?.[0]))
  q('#tpKamera').addEventListener('change', e => qrIsle(e.target.files?.[0]))
  const kap = q('#tpQrKap')
  ;['dragenter', 'dragover'].forEach(ev => kap.addEventListener(ev, e => { e.preventDefault(); kap.classList.add('border-primary', 'bg-primary/5') }))
  ;['dragleave', 'drop'].forEach(ev => kap.addEventListener(ev, e => { e.preventDefault(); kap.classList.remove('border-primary', 'bg-primary/5') }))
  kap.addEventListener('drop', e => { e.preventDefault(); qrIsle(e.dataTransfer?.files?.[0]) })

  // --- Onay ---
  q('#tpOnay').addEventListener('click', async () => {
    hataGizle()
    const tarih = q('#tpTarih').value || bugunISO()
    const noter = q('#tpNoter').value.trim()
    const yevmiye = q('#tpYevmiye').value.trim()
    const ruhsat = q('#tpRuhsat').value.trim().toUpperCase()
    const plaka = q('#tpPlaka') ? q('#tpPlaka').value.trim().toUpperCase() : null

    // Göksenil kararı: eksikse teslim EDİLEMEZ.
    if (!noter) return hataGoster('Noter adı zorunlu.')
    if (!yevmiye) return hataGoster('Yevmiye no zorunlu.')
    if (!ruhsat) return hataGoster('Yeni ruhsat seri no zorunlu.')
    if (plakaDegisecek && !plaka) return hataGoster('Plaka değişecek işaretli — yeni plaka zorunlu.')

    const btn = q('#tpOnay'); btn.disabled = true; btn.textContent = 'Kaydediliyor…'

    // --- NOTER KİPİ: yalnız kaydet, dosyayı KAPATMA ---------------------
    // ⚠️ Burada siparis_teslim_et ÇAĞRILMAZ: o fonksiyon plakayı da devreder
    //    ve siparişi TESLIM_EDILDI yapar. Bu adımda araç henüz teslim
    //    edilmedi; yalnız noter evrakı elimizde. Karıştırılırsa dosya
    //    finans onayına gitmeden kapanır.
    if (noterKipi) {
      const yama = {
        satis_tarihi: tarih, noter_adi: noter,
        yevmiye_no: yevmiye, yeni_ruhsat_seri_no: ruhsat,
      }
      if (plakaDegisecek) yama.yeni_plaka = plaka
      const { data: y, error: yErr } = await supabase.from('siparisler')
        .update(yama).eq('id', s.id).select('id')
      btn.disabled = false; btn.innerHTML = `${mat('save', 'text-[18px]')} Kaydet`
      // §5.1 — .update() sessizce 0 satır günceller; select('id') + length şart.
      if (yErr) { dbHata('noter devri kaydet', yErr); return hataGoster('Kaydedilemedi: ' + yErr.message) }
      if (!y?.length) return hataGoster('Kaydedilemedi — bu dosyada değişiklik yetkiniz yok.')
      teslimPencereKapat()
      await bitince?.()
      return
    }

    // ⚠️ TEK RPC (sql/159). Teslim artık İKİ tabloya yazıyor:
    //   siparisler (noter kaydı + teslim) ve stok_araclar (plaka devri).
    //   İstemciden iki ayrı update atsaydık biri geçip öbürü düşebilirdi:
    //   sipariş "teslim edildi" olurken araç eski plakada kalırdı.
    //   Fonksiyon tek işlem — ya ikisi de olur ya hiçbiri.
    //   Zorunlu alanlar SUNUCUDA da denetleniyor; buradaki kapı atlansa
    //   bile veri eksik yazılamaz.
    const { data, error } = await supabase.rpc('siparis_teslim_et', {
      p_siparis: s.id, p_satis_tarihi: tarih, p_noter: noter,
      p_yevmiye: yevmiye, p_ruhsat_seri: ruhsat, p_yeni_plaka: plaka,
    })
    btn.disabled = false; btn.innerHTML = `${mat('done_all', 'text-[18px]')} Teslim Et`
    if (error) { dbHata('teslim et', error); return hataGoster('İşlem başarısız: ' + error.message) }
    if (!data?.tamam) return hataGoster(data?.hata || 'Kaydedilemedi.')

    teslimPencereKapat()
    // Plaka gerçekten devredildiyse kullanıcıya söyle — araç artık başka
    // plakayla görünecek, sessiz kalmak kafa karıştırır.
    if (data.plaka_degisti) {
      alert(`Araç teslim edildi.

Plaka devredildi: ${data.eski_plaka} → ${data.yeni_plaka}
Eski plaka araç kartında görünmeye devam edecek.`)
    }
    await bitince?.()
  })
}
