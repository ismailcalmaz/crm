// =====================================================================
// siparis-evrak.js — Satış Dosyası "Evraklar" paneli
//
// Göksenil, 3 Ağu 2026:
//   "araç siparişte iken evraklar paneli olmalı, burada kullanıcı sayfalara
//    tıkladığında sayfa bilgileri otomatik dolacak. müşteriden imza alınması
//    gereken evraklar var; personel çıktı aldıktan sonra teslimat onaya
//    gönderirken 'şu sayfaların müşteri imzaları tamamlandı mı?' pop-up
//    şeklinde bir onay kutusu çıkmalı."
//
// İki belge (ikisinin de içeriği Göksenil'in gönderdiği DMS çıktılarından
// birebir alındı, 3 Ağu 2026):
//   1) SATIŞ DEVİR TESLİM TUTANAĞI — 6 bölüm + künye + alt bilgi
//   2) MASAK Kimlik Bildirim Formu — müşteri tipine göre 7 AYRI FORM,
//      her birinin kendi alanları ve kendi dip açıklaması var (aşağıda).
//
// Yazdırma: window.open + document.write. Ayrı bir HTML dosyası YOK —
//   çıktı tamamen veriden üretiliyor, kopya şablon tutmuyoruz.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, fmtTarih, buyuk, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'
// Lejant renkleri ekspertiz.js'ten — TEK KAYNAK. Burada ikinci bir renk
// tablosu tutulsaydı şemadaki renkle belgedeki lejant zamanla ayrışırdı.
import { RENK as EKS_RENK } from './ekspertiz.js'

// 5549 beyan formu müşteri tipleri — Göksenil'in DMS ekran görüntüsündeki sıra
export const MASAK_TIPLERI = [
  ['GERCEK_KISI', 'Gerçek Kişi'],
  ['TUZEL_KISI', 'Tüzel Kişi'],
  ['DERNEK_VAKIF', 'Dernek / Vakıf'],
  ['SENDIKA_KONFEDERASYON', 'Sendika / Konfederasyon'],
  ['TUZEL_KISILIGI_OLMAYAN_TESEKKUL', 'Tüzel Kişiliği Olmayan Teşekkül'],
  ['TUZEL_KISILIGI_OLMAYAN_IS_ORTAKLIGI', 'Tüzel Kişiliği Olmayan İş Ortaklığı'],
  ['SIYASI_PARTI', 'Siyasi Parti'],
]
const masakAd = kod => (MASAK_TIPLERI.find(t => t[0] === kod) || [])[1] || '—'

export const BELGELER = [
  { kod: 'SATIS_DEVIR_TESLIM', ad: 'Satış Devir Teslim Tutanağı', ikon: 'assignment_turned_in' },
  // Göksenil, 15 Ağu 2026 — DMS'teki "Satış Ekspertiz" çıktısının karşılığı.
  // Aracın boyalı/değişen durumunu ŞEMA ile alıcıya gösterip imzalatır.
  // ⚠️ Belge kodu ayrıca sql/208'de İKİ yerde tanımlı: siparis_evrak_belge_chk
  //    (yazılabilir kodlar) ve siparis_imza_eksikleri() (imza takibi).
  //    Buraya ekleyip oraya eklememek → insert CHECK'e takılır ve dış
  //    try/catch içinde SESSİZCE yutulur (CLAUDE.md §5.4).
  { kod: 'SATIS_EKSPERTIZ', ad: 'Satış Ekspertiz', ikon: 'car_repair' },
  { kod: 'MASAK', ad: 'MASAK — Kimlik Bildirim Formu', ikon: 'gavel' },
]

// MASAK eşiği koda GÖMÜLMEZ olurdu ama bu bir KANUN metni (5549), ayar değil.
// Değişirse kanun değişmiş demektir; o zaman metin de değişir.
const MASAK_ESIK = 85000

// ---------------------------------------------------------------------
// Belge penceresi — hem çıktı önizleme hem depolamadaki evrak
//
// Göksenil, 3 Ağu 2026: "yazdırma sayfalarını pop up ile gösterip oradan
//   yazdırmamız gerekiyor" + "ekspertiz/tramer/ruhsat pop up ile açılacak".
// Önceki hâli window.open + document.write idi: açılır pencere engelleyici
//   sessizce yutuyordu ve kullanıcı sayfadan kopuyordu.
// ---------------------------------------------------------------------
let PENCERE = null

export function belgePencere(baslik, altbaslik, icerikHtml, opt = {}) {
  belgePencereKapat()
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4'
  ov.innerHTML = `
    <div class="bp-bg absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
    <div class="relative w-full max-w-4xl h-[92vh] bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <div class="px-4 sm:px-5 py-3 border-b border-outline-variant flex items-center gap-3 bg-surface-container-low shrink-0">
        <span class="w-9 h-9 rounded-xl bg-primary-fixed text-primary flex items-center justify-center shrink-0">${mat(opt.ikon || 'description', 'text-[20px]')}</span>
        <div class="min-w-0 flex-1">
          <h2 class="font-black text-primary truncate">${kacis(baslik)}</h2>
          ${altbaslik ? `<p class="text-[11px] text-on-surface-variant truncate">${kacis(altbaslik)}</p>` : ''}
        </div>
        ${opt.disUrl ? `<a href="${kacis(opt.disUrl)}" target="_blank" rel="noopener" class="p-2 hover:bg-white rounded-full text-on-surface-variant shrink-0" title="Yeni sekmede aç">${mat('open_in_new')}</a>` : ''}
        ${opt.yazdirilabilir ? `<button id="bpYazdir" class="px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-bold hover:opacity-90 flex items-center gap-1.5 shrink-0">${mat('print', 'text-[18px]')} Yazdır</button>` : ''}
        <button class="bp-kapat p-2 hover:bg-white rounded-full text-on-surface-variant shrink-0">${mat('close')}</button>
      </div>
      <div class="flex-1 min-h-0 bg-surface">${icerikHtml}</div>
    </div>`
  document.body.appendChild(ov)
  PENCERE = ov
  ov.querySelector('.bp-bg').addEventListener('click', belgePencereKapat)
  ov.querySelector('.bp-kapat').addEventListener('click', belgePencereKapat)
  // ⚠️ İçerik iframe'i AYNI KÖKEN (srcdoc) olduğunda print edilebilir.
  //   İmzalı depolama URL'i ÇAPRAZ KÖKEN olur; orada tarayıcının kendi PDF
  //   görüntüleyicisi yazdırır, biz "Yazdır" düğmesi koymayız.
  ov.querySelector('#bpYazdir')?.addEventListener('click', () => {
    const f = ov.querySelector('iframe')
    try { f.contentWindow.focus(); f.contentWindow.print() }
    catch (err) { console.error('[evrak] yazdır', err); alert('Yazdırma başlatılamadı — sağ üstteki "Yeni sekmede aç" ile deneyin.') }
  })
  return ov
}

export function belgePencereKapat() { if (PENCERE) { PENCERE.remove(); PENCERE = null } }
document.addEventListener('keydown', e => { if (e.key === 'Escape') belgePencereKapat() })

// Depolamadaki bir evrağı pop-up'ta açar.
// ⚠️ arac_evraklar.url bir URL DEĞİL, `arac-evrak` bucket'ındaki YOLDUR
//   (arac/<id>/ruhsat_….pdf). Doğrudan href verilirse tarayıcı onu sayfaya
//   göre çözer ve 404 döner — 3 Ağu 2026'da tam bu oldu. Bucket ÖZEL,
//   erişim yalnız createSignedUrl ile.
export async function evrakAc(yol, baslik, altbaslik) {
  if (!yol) return
  const { data, error } = await supabase.storage.from('arac-evrak').createSignedUrl(yol, 3600)
  if (error || !data?.signedUrl) {
    dbHata('evrak imzalı url', error)
    alert('Belge açılamadı: ' + (error?.message || 'bilinmeyen hata'))
    return
  }
  const url = data.signedUrl
  const resimMi = /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(yol)
  const govde = resimMi
    ? `<div class="w-full h-full overflow-auto flex items-start justify-center p-3"><img src="${kacis(url)}" alt="" class="max-w-full h-auto rounded-lg shadow" /></div>`
    : `<iframe src="${kacis(url)}" class="w-full h-full border-0" title="${kacis(baslik)}"></iframe>`
  belgePencere(baslik, altbaslik, govde, { disUrl: url, ikon: resimMi ? 'image' : 'picture_as_pdf' })
}

// ---------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------
export function evrakPaneliHtml(ctx) {
  const { evraklar, kilit } = ctx
  const bul = kod => evraklar.find(e => e.belge_kodu === kod) || null

  const satir = b => {
    const e = bul(b.kod)
    const imzali = !!e?.imza_onay
    const yazdirildi = !!e?.yazdirma_zamani
    const rozet = imzali
      ? `<span class="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold whitespace-nowrap">İMZALANDI</span>`
      : yazdirildi
        ? `<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold whitespace-nowrap">ÇIKTI ALINDI</span>`
        : `<span class="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold whitespace-nowrap">BEKLİYOR</span>`

    const masakSecim = b.kod === 'MASAK'
      ? `<select id="evMasakTip" class="mt-2 w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none">
           <option value="">Müşteri tipi seçiniz…</option>
           ${MASAK_TIPLERI.map(([k, a]) => `<option value="${k}"${(e?.masak_tipi || varsayilanMasakTipi(ctx)) === k ? ' selected' : ''}>${kacis(a)}</option>`).join('')}
         </select>` : ''

    return `<div class="border border-outline-variant rounded-xl p-3" data-belge="${b.kod}">
      <div class="flex items-start gap-2">
        <span class="w-9 h-9 rounded-lg ${imzali ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary-fixed text-primary'} flex items-center justify-center shrink-0">${mat(b.ikon, 'text-[20px]')}</span>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-on-surface text-label-md leading-tight">${kacis(b.ad)}</p>
          <p class="text-[11px] text-on-surface-variant mt-0.5">${
            imzali ? `İmza onayı: ${kacis(fmtTarih(e.imza_zamani))}`
            : yazdirildi ? `Çıktı: ${kacis(fmtTarih(e.yazdirma_zamani))} — ıslak imza bekleniyor`
            : 'Henüz çıktı alınmadı'}${e?.masak_tipi ? ` · ${kacis(masakAd(e.masak_tipi))}` : ''}</p>
        </div>
        ${rozet}
      </div>
      ${masakSecim}
      <div class="flex flex-wrap gap-2 mt-2">
        <button class="ev-yazdir flex-1 min-w-[110px] px-3 py-2 rounded-lg border border-primary/40 text-primary text-label-md font-bold hover:bg-primary/5 flex items-center justify-center gap-1.5" data-kod="${b.kod}">
          ${mat('print', 'text-[16px]')} Yazdır</button>
        ${e?.imzali_url
          ? `<button class="ev-goster flex-1 min-w-[110px] px-3 py-2 rounded-lg border border-secondary text-secondary text-label-md font-bold hover:bg-secondary/5 flex items-center justify-center gap-1.5" data-yol="${kacis(e.imzali_url)}" data-ad="${kacis(b.ad)}">
              ${mat('visibility', 'text-[16px]')} İmzalı Nüsha</button>`
          : !kilit ? `<label class="ev-yukle-sar flex-1 min-w-[110px] px-3 py-2 rounded-lg border border-secondary text-secondary text-label-md font-bold hover:bg-secondary/5 flex items-center justify-center gap-1.5 cursor-pointer">
              ${mat('upload_file', 'text-[16px]')} İmzalıyı Yükle
              <input type="file" class="ev-yukle hidden" accept="application/pdf,image/*" data-kod="${b.kod}" /></label>` : ''}
        ${!imzali && !kilit ? `<button class="ev-imza px-3 py-2 rounded-lg border ${yazdirildi
            ? 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
            : 'border-outline-variant/40 text-outline cursor-not-allowed'} text-label-md font-bold flex items-center justify-center gap-1.5"
          data-kod="${b.kod}" ${yazdirildi ? '' : 'disabled'}
          title="${yazdirildi
            ? 'Taramadan geçirmeden yalnız işaretle'
            : 'Önce çıktı alın. Islak imzalı nüshayı yüklerseniz çıktı şartı aranmaz.'}">
          ${mat('draw', 'text-[16px]')}</button>` : ''}
      </div>
    </div>`
  }

  const eksik = BELGELER.filter(b => !bul(b.kod)?.imza_onay).length
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
    <div class="flex items-center justify-between mb-3 gap-2">
      <h3 class="font-bold text-on-surface flex items-center gap-2">${mat('folder_open', 'text-[20px] text-primary')} Evraklar</h3>
      ${eksik ? `<span class="text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">${eksik} imza eksik</span>`
        : `<span class="text-[11px] font-bold text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full">Tamam</span>`}
    </div>
    <div class="space-y-2">${BELGELER.map(satir).join('')}</div>
    <p class="text-label-sm text-on-surface-variant mt-3 leading-relaxed">${mat('info', 'text-[14px] align-middle')} Sayfa bilgileri araç, müşteri ve satış kayıtlarından otomatik dolar — elle alan doldurmanız gerekmez. Çıktıyı alıp müşteriye imzalatın, sonra <b>İmzalıyı Yükle</b> ile taranmış nüshayı sisteme koyun; imza onayı böyle verilir. Tarayıcı yoksa ${mat('draw', 'text-[13px] align-middle')} düğmesiyle yalnız işaretleyebilirsiniz. <b>İşaret geri alınamaz</b> (5549 · 8 yıl saklama).</p>
  </div>`
}

// Müşteri CRM'de SAHIS/SIRKET olarak tutuluyor; MASAK'ın 7 tipi daha geniş.
// Varsayılanı buradan türetiyoruz, personel gerekirse değiştirir.
function varsayilanMasakTipi(ctx) {
  return ctx.musteri?.tip === 'SIRKET' ? 'TUZEL_KISI' : 'GERCEK_KISI'
}

// ---------------------------------------------------------------------
// Olaylar
// ---------------------------------------------------------------------
export function evrakBagla(ctx) {
  document.querySelectorAll('.ev-yazdir').forEach(b =>
    b.addEventListener('click', () => yazdir(ctx, b.dataset.kod)))
  document.querySelectorAll('.ev-imza').forEach(b =>
    b.addEventListener('click', () => imzaIsaretle(ctx, b.dataset.kod)))
  document.querySelectorAll('.ev-goster').forEach(b =>
    b.addEventListener('click', () => imzaliAc(b.dataset.yol, b.dataset.ad)))
  document.querySelectorAll('.ev-yukle').forEach(i =>
    i.addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; imzaliYukle(ctx, i.dataset.kod, f) }))
  document.getElementById('evMasakTip')?.addEventListener('change', e =>
    kaydet(ctx, 'MASAK', { masak_tipi: e.target.value || null }))
}

// siparis_evraklari satırı yoksa açar, varsa günceller. Yazılan SATIRI döner —
// belge_no'yu trigger atıyor (sql/133), çıktıya basmak için geri okumak şart.
// ⚠️ upsert(onConflict) KULLANILMIYOR — CLAUDE.md §5.2. Önce select, sonra
//   insert/update. Burada partial index yok ama desen tek: sürprize yer bırakma.
const ALAN = 'id, belge_kodu, belge_no, masak_tipi, yazdirma_zamani, yazdiran, imza_onay, imza_onaylayan, imza_zamani, imzali_url'
async function kaydet(ctx, kod, yama, opt = {}) {
  const mevcut = ctx.evraklar.find(e => e.belge_kodu === kod)
  let satir = null
  if (mevcut) {
    const { data, error } = await supabase.from('siparis_evraklari')
      .update(yama).eq('id', mevcut.id).select(ALAN)
    if (error) { dbHata('evrak güncelle', error); alert('Evrak güncellenemedi: ' + error.message); return null }
    if (!data?.length) { alert('Evrak güncellenemedi — yetki yok.'); return null }
    satir = data[0]
  } else {
    const { data, error } = await supabase.from('siparis_evraklari')
      .insert({ siparis_id: ctx.siparis.id, belge_kodu: kod, ...yama }).select(ALAN)
    if (error) { dbHata('evrak ekle', error); alert('Evrak kaydedilemedi: ' + error.message); return null }
    if (!data?.length) { alert('Evrak kaydedilemedi — yetki yok.'); return null }
    satir = data[0]
  }
  if (!opt.yenilemeyi_atla) await ctx.yenile()
  return satir
}

async function imzaIsaretle(ctx, kod) {
  const b = BELGELER.find(x => x.kod === kod)
  if (!confirm(`“${b.ad}” müşteri tarafından ıslak imzalı olarak alındı mı?\n\n⚠️ Bu işaret GERİ ALINAMAZ — yalnız yönetici geri alabilir.`)) return
  await kaydet(ctx, kod, { imza_onay: true, imza_zamani: new Date().toISOString(), imza_onaylayan: ctx.benim?.id || null })
}

async function yazdir(ctx, kod) {
  let tip = null
  if (kod === 'MASAK') {
    tip = document.getElementById('evMasakTip')?.value || null
    if (!tip) { alert('Önce MASAK müşteri tipini seçin.'); return }
  }
  // ⚠️ SIRA ÖNEMLİ: kayıt ÖNCE açılır. Belge no'yu insert trigger'ı atıyor;
  //   önce yazdırıp sonra kaydetseydik ilk çıktının künyesi boş çıkardı.
  const satir = await kaydet(ctx, kod, {
    yazdirma_zamani: new Date().toISOString(),
    yazdiran: ctx.benim?.id || null,
    ...(tip ? { masak_tipi: tip } : {}),
  }, { yenilemeyi_atla: true })
  if (!satir) return

  // ⚠️ TEK YÖNLENDİRME: belgeHtml. Eskiden burada ve belgeHtml'de AYRI
  //    üçlü koşul vardı; üçüncü belge eklenirken birinin unutulması
  //    "önizleme doğru, çıktı yanlış belge" demekti.
  const html = belgeHtml(ctx, kod, tip, satir)
  const b = BELGELER.find(x => x.kod === kod)
  // srcdoc → aynı köken → contentWindow.print() çalışır (üstteki Yazdır düğmesi).
  belgePencere(b?.ad || 'Belge', satir.belge_no || '',
    `<iframe class="w-full h-full border-0 bg-white" srcdoc="${kacis(html)}" title="${kacis(b?.ad || 'Belge')}"></iframe>`,
    { yazdirilabilir: true, ikon: b?.ikon })
  await ctx.yenile()
}

// İmzalı nüshayı sisteme yükle — Göksenil: "danışman belgeyi yazdırır,
//   müşteriye imzalatır ve imzalı nüshayı sisteme yükleyerek siparişi
//   tamamlar." Yükleme imza onayını da verir; ayrı bir tık gerekmez.
async function imzaliYukle(ctx, kod, file) {
  if (!file) return
  const b = BELGELER.find(x => x.kod === kod)
  const mevcut = ctx.evraklar.find(e => e.belge_kodu === kod)
  const uzanti = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
  const yol = `siparis/${ctx.siparis.id}/${kod.toLowerCase()}_${Date.now()}.${uzanti}`
  const { error: ue } = await supabase.storage.from('arac-evrak')
    .upload(yol, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (ue) { dbHata('imzalı nüsha yükle', ue); alert('Yüklenemedi: ' + ue.message); return }
  const ok = await kaydet(ctx, kod, {
    imzali_url: yol, imzali_yukleyen: ctx.benim?.id || null, imzali_zamani: new Date().toISOString(),
    ...(mevcut?.imza_onay ? {} : { imza_onay: true, imza_zamani: new Date().toISOString(), imza_onaylayan: ctx.benim?.id || null }),
  })
  if (!ok) {
    // Kayıt tutmadıysa yüklenen dosya öksüz kalmasın
    const { error: se } = await supabase.storage.from('arac-evrak').remove([yol])
    if (se) dbHata('öksüz imzalı nüsha sil', se)
    return
  }
  alert(`“${b.ad}” imzalı nüshası yüklendi ve imza onayı işaretlendi.`)
}

const imzaliAc = (yol, ad) => evrakAc(yol, 'İmzalı Nüsha', ad)

// ---------------------------------------------------------------------
// İmza onay kutusu — teslimat onaya gönderirken
// ---------------------------------------------------------------------
// Göksenil: "teslimat onaya gönderirken şu sayfaların müşteri imzaları
//   tamamlandı mı? pop-up şeklinde bir onay kutusu çıkmalı."
// Eksik varsa kullanıcı yine de devam edebilir (kapı `evrak_tamam`), ama
// hangi sayfanın imzasız olduğunu ADIYLA görür — "hepsi tamam mı?" diye
// soran boş bir kutu, hiç sormamakla aynı şeydir.
export async function imzaOnayiAl(siparisId) {
  const { data, error } = await supabase.rpc('siparis_imza_eksikleri', { p_siparis: siparisId })
  if (error) { dbHata('imza eksikleri', error); return confirm('İmza durumu okunamadı. Yine de devam edilsin mi?') }
  const eksik = data || []
  const ad = k => (BELGELER.find(b => b.kod === k) || {}).ad || k
  if (!eksik.length) {
    return confirm('Tüm evrakların ıslak imzası alınmış görünüyor.\n\nDosya finans kontrolüne gönderilsin mi?\nGönderdikten sonra finans onaylayana kadar cari işlem ekleyemezsiniz.')
  }
  return confirm(
    'MÜŞTERİ İMZALARI TAMAMLANDI MI?\n\n' +
    'Aşağıdaki sayfaların imzası henüz işaretlenmedi:\n\n' +
    eksik.map(e => '  • ' + ad(e.belge_kodu) + (e.yazdirildi ? ' (çıktı alındı)' : ' (çıktı alınmadı)')).join('\n') +
    '\n\nİmzalar tamamsa Evraklar panelinden işaretleyin.\n' +
    'Yine de dosyayı finans kontrolüne göndermek istiyor musunuz?')
}

// ---------------------------------------------------------------------
// Çıktılar
// ---------------------------------------------------------------------
// Dışa açık: belge HTML'ini veriden üretir, DB'ye dokunmaz. Yazdırma akışı
// bunu kullanır; ayrıca düzen değişikliği yaparken gerçek kodu örnek veriyle
// çizdirip göze bakabilmeyi sağlar (bu projede test altyapısı yok).
export function belgeHtml(ctx, kod, tip, satir) {
  if (kod === 'MASAK') return masakHtml(ctx, tip, satir)
  if (kod === 'SATIS_EKSPERTIZ') return satisEkspertizHtml(ctx, satir)
  return tutanakHtml(ctx, satir)
}

const K = v => kacis(buyuk(v ?? '') || '')
const bos = '____________________________'

function ortak(ctx) {
  const a = ctx.arac || {}
  const s = ctx.siparis || {}
  return {
    arac: [a.yil, a.marka, a.model, a.versiyon].filter(Boolean).join(' '),
    plaka: a.plaka || '', sasi: a.sasi_no || '', motor: a.motor_no || '',
    km: a.km != null ? Number(a.km).toLocaleString('tr-TR') : '',
    renk: a.renk || '', kasko: a.kasko_kodu || '',
    tutar: s.anlasilan_tutar != null ? fmtPara(s.anlasilan_tutar) : '',
    // Liste fiyatı v_arac_guncel_fiyat'tan gelir; indirim = liste − anlaşılan.
    // İkisinden biri yoksa satır boş kalır — uydurulmuş 0 basılmaz.
    liste: ctx.listeFiyat != null ? fmtPara(ctx.listeFiyat) : '',
    indirim: (ctx.listeFiyat != null && s.anlasilan_tutar != null)
      ? fmtPara(Math.max(0, Number(ctx.listeFiyat) - Number(s.anlasilan_tutar))) : '',
    noterBedel: s.noter_satis_tutari != null ? fmtPara(s.noter_satis_tutari) : '',
    tarih: new Date().toLocaleDateString('tr-TR'),
    // SIP-000412 — siparisler.sira (sql/133). uuid'in ilk 6 hanesi numara
    // değil rastgele hex'ti; noter evrakında referans olarak kullanılamazdı.
    siparisNo: s.sira != null ? 'SIP-' + String(s.sira).padStart(6, '0') : '—',
  }
}

// Belge künyesi — Göksenil'in önerdiği çerçeveli üst blok:
//   "Bu sayede belge hem noter evrakı ciddiyetinde görünür hem de danışman
//    hiçbir alan doldurmadan otomatik PDF oluşturabilir."
function cerceve(baslik, kunye, govde) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${kacis(baslik)}</title>
<style>
  /* ⚠️ TEK SAYFA KISITI (Göksenil, 3 Ağu 2026). A4'te kullanılabilir yükseklik
     297mm − 2×11mm ≈ 1032px @96dpi. İlk sürüm 1097px'ti, ikinci sayfaya
     taşıyordu. Boşluklar buna göre kısıldı — satır eklerken yeniden ölç. */
  @page { size: A4; margin: 11mm 13mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5px; color: #111; margin: 0; }
  .kunye { border: 1.5px solid #6B1F2A; border-radius: 3px; margin-bottom: 9px; }
  .kunye .ust { padding: 5px 10px 3px; border-bottom: 1px solid #E3D9DB; }
  .kunye .firma { color: #6B1F2A; font-size: 12px; font-weight: 800; letter-spacing: .4px; }
  .kunye h1 { font-size: 16px; text-align: center; margin: 5px 0 7px; letter-spacing: 1px; font-weight: 800; }
  .kunye .kt { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 18px; padding: 4px 10px; font-size: 10px; }
  .kunye .kt span { color: #555; }
  .kunye .kt b { color: #111; }
  h2 { font-size: 10.5px; background: #F3F0F1; border-left: 3px solid #6B1F2A;
       padding: 3px 7px; margin: 8px 0 4px; letter-spacing: .3px; }
  table { width: 100%; border-collapse: collapse; }
  td { border: 1px solid #C4C4C4; padding: 2.2px 6px; vertical-align: top; }
  td.e { background: #FAFAFA; width: 32%; font-weight: 600; }
  ul.tik { list-style: none; margin: 0; padding: 0; }
  ul.tik li { padding: 2px 0 2px 2px; border-bottom: 1px dotted #DDD; }
  ul.tik li:last-child { border-bottom: 0; }
  .kanun { border: 1px solid #6B1F2A; background: #FCF7F8; padding: 6px 9px;
           font-size: 9.5px; line-height: 1.5; margin: 6px 0; text-align: justify; }
  .imza { margin-top: 6px; width: 100%; }
  .imza td { border: 1px solid #C4C4C4; padding: 4px 8px; }
  .imza .bas { background: #FAFAFA; font-weight: 700; text-align: center; }
  .imza .alan { height: 46px; vertical-align: bottom; font-size: 9px; color: #777; }
  .altbilgi { margin-top: 9px; border-top: 1px solid #DDD; padding-top: 5px;
              font-size: 8.5px; color: #777; line-height: 1.5; }
  @media print { .yaz { display: none; } }
  .yaz { position: fixed; top: 8px; right: 8px; background: #6B1F2A; color: #fff;
         border: 0; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; }
</style></head><body>
<button class="yaz" onclick="window.print()">Yazdır</button>
<div class="kunye">
  <div class="ust"><div class="firma">İSMAİL ÇALMAZ OTOMOTİV</div></div>
  <h1>${kacis(baslik.toLocaleUpperCase('tr'))}</h1>
  <div class="kt">${kunye}</div>
</div>
${govde}
</body></html>`
}

const sat = (e, d) => `<tr><td class="e">${kacis(e)}</td><td>${d || bos}</td></tr>`
const kt = (e, d) => `<div><span>${kacis(e)}</span> : <b>${d || '—'}</b></div>`

function altbilgi(ctx, belgeNo) {
  return `<div class="altbilgi">
    Bu belge <b>İÇ OS</b> (AI-Powered Automotive Operating System) tarafından elektronik olarak oluşturulmuştur.<br>
    Belge No : ${kacis(belgeNo || '—')} &nbsp;·&nbsp; Oluşturma Tarihi : ${kacis(new Date().toLocaleString('tr-TR'))} &nbsp;·&nbsp; Oluşturan : ${K(ctx.danismanAd)}
  </div>`
}

function tutanakHtml(ctx, satir) {
  const o = ortak(ctx)
  const a = ctx.arac || {}
  const m = ctx.musteri || {}
  const belgeNo = satir?.belge_no || ctx.evraklar.find(e => e.belge_kodu === 'SATIS_DEVIR_TESLIM')?.belge_no
  // ⚠️ Yakıt/vites/renk BÜYÜK HARFE ÇEVRİLMEZ: tanimlar.ad zaten "Dizel",
  //   "Manuel", "Beyaz" diye düzgün yazılmış. buyuk() ile ezmek belgeyi
  //   "DIZEL MANUEL BEYAZ" yapıyordu — Göksenil'in taslağındaki hâli değil.
  const tanim = (tip, kod) => ctx.tanim?.[tip]?.[kod] || kod || ''
  // 4. bölümdeki tikler — sistemde bilgisi olan satır otomatik işaretlenir,
  //    olmayan boş kutu kalır ki personel elle işaretlesin.
  const tik = (isaretli, metin) => `<li>${isaretli ? '☑' : '☐'} ${kacis(metin)}</li>`

  return cerceve('Satış Devir Teslim Tutanağı',
    `${kt('Belge No', kacis(belgeNo || 'çıktı alınınca atanır'))}${kt('Sipariş No', kacis(o.siparisNo))}
     ${kt('Tarih', kacis(o.tarih))}${kt('Satış Danışmanı', K(ctx.danismanAd))}`,
    `
    <h2>1. ARAÇ BİLGİLERİ</h2>
    <table>
      ${sat('Marka', kacis(a.marka || ''))}${sat('Model', kacis(a.model || ''))}
      ${sat('Versiyon', kacis(a.versiyon || ''))}${sat('Model Yılı', kacis(a.yil || ''))}
      ${sat('Plaka', K(o.plaka))}${sat('Şasi No', K(o.sasi))}
      ${sat('Kilometre', o.km ? kacis(o.km) + ' km' : '')}
      ${sat('Yakıt', kacis(tanim('YAKIT', a.yakit)))}${sat('Vites', kacis(tanim('VITES', a.vites)))}
      ${sat('Renk', kacis(tanim('RENK', a.renk)))}
    </table>

    <h2>2. ALICI BİLGİLERİ</h2>
    <table>
      ${sat('Ad Soyad / Unvan', kacis(m.ad_soyad || ''))}
      ${sat('T.C. Kimlik / Vergi No', kacis(ctx.kimlik || ''))}
      ${sat('Telefon', kacis(m.telefon || ''))}
      ${sat('Adres', kacis(m.adres || ''))}
    </table>

    <!-- Göksenil, 3 Ağu 2026: "teslim tarihi ve sipariş no yukarıda yazıyor,
         satış bilgilerinde tekrar yazıyor" → künyeden okunuyor, buradan çıktı.
         Yerine liste fiyatı + indirim + satış bedeli geldi. -->
    <h2>3. SATIŞ BİLGİLERİ</h2>
    <table>
      ${sat('Araç Liste Fiyatı', kacis(o.liste))}
      ${sat('Yapılan İndirim', kacis(o.indirim))}
      ${sat('Araç Satış Bedeli', kacis(o.tutar))}
    </table>

    <!-- ⚠️ İşaretsiz satır BASILMIYOR. Yedek anahtarı olmayan araçta boş
         kutu bırakmak, imzalı belgeye "acaba" sokar. Göksenil: "yedek
         anahtarı var ise onaylı, yok ise yazdırmayalım." -->
    <h2>4. ARAÇ TESLİM DURUMU</h2>
    <p style="margin:4px 0 5px;font-size:10px;color:#444;">Aşağıdaki hususlar müşteriye eksiksiz olarak teslim edilmiş ve açıklanmıştır.</p>
    <ul class="tik">
      ${tik(true, 'Araç anahtarı teslim edilmiştir.')}
      ${a.yedek_anahtar === true ? tik(true, 'Yedek anahtar teslim edilmiştir.') : ''}
      ${ctx.evrakDosya?.EKSPERTIZ_PDF ? tik(true, 'Ekspertiz raporu müşteriye teslim edilmiştir.') : ''}
      ${tik(true, 'Araç ruhsatı teslim edilmiştir.')}
    </ul>

    <h2>5. MÜŞTERİ BEYANI</h2>
    <div class="kanun">
      Yukarıda bilgileri bulunan aracı inceleyerek teslim aldığımı, ekspertiz raporunu
      okuyup kabul ettiğimi, araç tesliminden sonra kullanıcı kaynaklı oluşabilecek
      arıza, hasar ve kullanım hatalarından satıcının sorumlu olmadığını kabul ve
      beyan ederim.
    </div>

    <h2>6. İMZALAR</h2>
    <table class="imza">
      <tr><td class="bas" style="width:50%">ARAÇ TESLİM ALAN</td><td class="bas">SATIŞ DANIŞMANI</td></tr>
      <tr><td>Ad Soyad : ${kacis(m.ad_soyad || '')}</td><td>Ad Soyad : ${kacis(ctx.danismanAd || '')}</td></tr>
      <tr><td class="alan">İmza</td><td class="alan">İmza</td></tr>
      <tr><td>Tarih : ${bos}</td><td>Tarih : ${bos}</td></tr>
    </table>

    ${altbilgi(ctx, belgeNo)}`)
}

// =====================================================================
// SATIŞ EKSPERTİZ (sql/208)
//
// Göksenil, 15 Ağu 2026: "evraklar kısmına SATIŞ EKSPERTİZ adında
//   yazdırılabilir bir sayfa yapmamız gerekiyor; senaryo satış devir
//   teslim tutanağı gibi olmalı."
// Düzen DMS çıktısından (Yazdır.pdf, 6 Ağu 2026) BİREBİR alındı:
//   başlık → Araç Bilgisi → Hasar Bilgisi (şema + lejant) → İmzalar → künye.
//
// ⚠️ "Ekspertiz Onay Kodu" ve "Ekspertiz Tarihi" CRM'de TUTULMUYOR.
//    Referans çıktıda da BOŞ geliyorlar — kaynak sistemde de doldurulmuyor.
//    Uydurmak yerine elle doldurulacak boş satır bırakılıyor; bu belge
//    zaten ıslak imzalanıyor.
// ⚠️ Araç Fiyatı = ANLAŞILAN TUTAR (Göksenil kararı): müşterinin gerçekte
//    ödediği rakam. Liste fiyatı basılsaydı pazarlık yapan alıcı belgede
//    kendi ödemediği bir tutar görürdü.
// =====================================================================
function satisEkspertizHtml(ctx, satir) {
  const o = ortak(ctx)
  const a = ctx.arac || {}
  const m = ctx.musteri || {}
  const belgeNo = satir?.belge_no || ctx.evraklar.find(e => e.belge_kodu === 'SATIS_EKSPERTIZ')?.belge_no
  // Yakıt/vites/renk tanimlar.ad'dan düzgün yazımıyla gelir — buyuk() ile
  // ezilmez (tutanakta yaşanan "DIZEL MANUEL BEYAZ" hatası).
  const tanim = (tip, kod) => ctx.tanim?.[tip]?.[kod] || kod || ''

  // Hasar kaydı: tramer satır sayısı / toplam tutar. Referans çıktıdaki
  // "0 / 0,00" biçimi. Kayıt yoksa 0 basılır — boş bırakmak "sorgulanmadı"
  // ile "hasarsız"ı karıştırırdı, oysa ikisi çok farklı.
  const trm = ctx.tramer || []
  const trmTutar = trm.reduce((s, t) => s + (Number(t.tutar) || 0), 0)

  const lejant = [['BOYALI', 'Boyanmış'], ['LOKAL BOYA', 'Lokal Boya'],
                  ['DEGISEN', 'Değişen'], ['ORIJINAL', 'Orijinal']]
    .map(([k, ad]) => `<span class="lj"><i style="background:${EKS_RENK[k]}"></i>${kacis(ad)}</span>`).join('')

  // Şema ctx'ten HAZIR BOYALI gelir (siparis-dosya.js svgBoya ile boyayıp
  // serileştirir) — tek kaynak ekspertiz.js/svgBoya, ikinci boyayıcı yazılmadı.
  // ⚠️ Parça girilmemiş araçta şema YİNE basılır, tüm parçalar orijinal
  //    renginde (Göksenil, 15 Ağu 2026: "parça girilmemiş ise araç
  //    orijinaldir"). Buradaki uyarı yalnız SVG dosyası okunamadığında
  //    çıkar — o bir teknik arıza, veri durumu değil.
  const sema = ctx.ekspertizSvg
    ? `<div class="sema">${ctx.ekspertizSvg}</div>`
    : `<div class="sema-yok">Ekspertiz şeması yüklenemedi. Belgeyi yazdırmadan önce sayfayı yenileyin.</div>`

  return cerceve('Satış Ekspertiz',
    `${kt('Belge No', kacis(belgeNo || 'çıktı alınınca atanır'))}${kt('Sipariş No', kacis(o.siparisNo))}
     ${kt('Tarih', kacis(o.tarih))}${kt('Satış Danışmanı', K(ctx.danismanAd))}`,
    `
    <style>
      .ekiki { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
      .sema { text-align: center; margin: 4px 0; }
      .sema svg { max-width: 100%; max-height: 300px; height: auto; }
      .sema-yok { border: 1px dashed #C4C4C4; padding: 14px; text-align: center;
                  color: #777; font-size: 9.5px; }
      .lejant { display: flex; gap: 14px; justify-content: center; margin-top: 3px; font-size: 9.5px; }
      .lj { display: inline-flex; align-items: center; gap: 4px; }
      .lj i { width: 10px; height: 10px; border: 1px solid #999; display: inline-block; }
      .not { font-size: 9px; color: #777; margin-top: 4px; }
    </style>

    <h2>ARAÇ BİLGİSİ</h2>
    <div class="ekiki">
      <table>
        ${sat('Plaka No', K(o.plaka))}${sat('Şasi No', K(o.sasi))}
        ${sat('Motor No', K(o.motor))}${sat('Marka', kacis(a.marka || ''))}
        ${sat('Model', kacis(a.model || ''))}${sat('Versiyon', kacis(a.versiyon || ''))}
        ${sat('Yıl', kacis(a.yil || ''))}${sat('KM', o.km ? kacis(o.km) + ' KM' : '')}
      </table>
      <table>
        ${sat('Renk', kacis(tanim('RENK', a.renk)))}
        ${sat('Yakıt', kacis(tanim('YAKIT', a.yakit)))}
        ${sat('Vites', kacis(tanim('VITES', a.vites)))}
        ${sat('Ekspertiz Onay Kodu', '')}
        ${sat('Ekspertiz Tarihi', '')}
        ${sat('Ekspertiz Firma Adı', kacis(a.ekspertiz_firma || ''))}
        ${sat('Araç Fiyatı', o.tutar ? '<b>' + kacis(o.tutar) + '</b>' : '')}
      </table>
    </div>

    <h2>HASAR BİLGİSİ</h2>
    <table>
      ${sat('Hasar Kaydı', `${trm.length} / ${trmTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`)}
    </table>
    ${sema}
    <div class="lejant">${lejant}</div>
    <div class="not">Şemadaki renkler aracın boya/değişen durumunu gösterir. Renklendirilmemiş parçalar orijinaldir.</div>

    <h2>İMZALAR</h2>
    <div class="not" style="margin:0 0 3px">Başlık altına el yazınız ile tam adınızı, tarihi ve imzayı ekleyiniz.</div>
    <table class="imza">
      <tr><td class="bas" style="width:50%">SATICI</td><td class="bas">ALICI</td></tr>
      <!-- Göksenil, 15 Ağu 2026: "satıcı kısmına firma unvanı SABİT olsun,
           alıcı kısmına sipariş açılan müşteri adını yazalım."
           Alıcı adı siparisler.alici_musteri_id üzerinden gelir — o siparişin
           ASIL müşterisi; siparisler'in musteriler'e tek FK'si bu, gömülü
           sorgu başka bir kişiye çözülemez (doğrulandı).
           ⚠️ BU YORUMDA TERS TIRNAK KULLANMA: metin bir şablon dizesinin
              İÇİNDE; ters tırnak diziyi erken kapatır. Bir kez yaşandı,
              node --check geçirdi, deploy kapısı yakaladı. -->
      <tr><td><b>${kacis(FIRMA.unvan)}</b></td><td><b>${kacis(m.ad_soyad || '')}</b></td></tr>
      <tr><td class="alan">İmza</td><td class="alan">İmza</td></tr>
      <tr><td>Tarih : ${bos}</td><td>Tarih : ${bos}</td></tr>
    </table>

    <div class="altbilgi">
      <b>${kacis(FIRMA.unvan)}</b><br>
      ${kacis(FIRMA.adres)} &nbsp;·&nbsp; ${kacis(FIRMA.telefon)}<br>
      ${kacis(FIRMA.vd)} &nbsp;·&nbsp; ${kacis(FIRMA.yetki)}
    </div>
    ${altbilgi(ctx, belgeNo)}`)
}


// =====================================================================
// MASAK — Kimlik Bildirim Formları (7 tip)
//
// Göksenil, 3 Ağu 2026: mevcut DMS'teki 7 sayfanın ekran görüntülerini
//   gönderdi. Alan adları, sırası, gruplaması ve dip açıklamaları
//   ORADAN BİREBİR alındı; önceki 5549 standardından türettiğim taban
//   tamamen atıldı.
//
// Düzen: kutulu tablo DEĞİL — solda etiket, sağda altı çizgili değer.
//   DMS çıktısı böyle; personel aynı sayfayı görmeli.
//
// ⚠️ DMS'te SENDİKA formunun alan etiketleri "Dernek/ Vakıf Adı",
//   "Amacı", "Kütük/ Sicil No" diye duruyor — Dernek formundan kopyalanmış
//   ve düzeltilmemiş. Bunu OLDUĞU GİBİ TAŞIMADIM: sendika beyanında
//   "Dernek/Vakıf Adı" yazan bir satıra imza attırmak yanlış olur.
//   "Sendika/ Konfederasyon Adı" yazdım. İtiraz gelirse geri alınır.
//
// Değer eşlemesi CRM müşteri kaydından gelir. Kurum adı/sicil/amaç gibi
//   alanlar CRM'de TUTULMUYOR → boş bırakılır, personel elle doldurur.
//   Boş bırakmak, yanlış doldurmaktan iyidir.
// =====================================================================

// Firma künyesi — her formun altında basılır. Değişirse tek yerden değişir.
// (ayarlar tablosuna taşınabilir; sık değişen bir veri değil, bugün sabit.)
const FIRMA = {
  unvan: 'İsmail Çalmaz Otomotiv Yedek Parça İnşaat Sanayi Ve Ticaret Anonim Şirketi',
  adres: 'EMREZ MAH. AKÇAY CADDESİ NO:60/2 İzmir / Gaziemir',
  telefon: '0 (232) 253 70 10',
  vd: 'V.D / No. GAZİEMİR / 4811197195',
  yetki: 'Yetki No.3500617',
}

// Her tipte aynı olan iki grup
const G_YETKILI = v => [
  ['Yetkili Adı Soyadı', v.ad], ['T.C. Kimlik No.', v.kimlik],
  ['Doğum Tarihi / Doğum Yeri', v.dogum], ['Uyruğu', ''],
  ['Kimlik Türü', ''], ['Kimlik Seri No.', ''],
]
const G_IMZA = [['Adı Soyadı (Kendi el yazısı ile)', ''], ['İmza', ''], ['Tarih', '']]

const MASAK_FORM = {
  GERCEK_KISI: {
    baslik: 'Gerçek Kişi Kimlik Bildirim Formu',
    gruplar: v => [
      [['Adı Soyadı', v.ad], ['T.C. Kimlik No.', v.kimlik],
       ['Doğum Tarihi/ Doğum Yeri', v.dogum], ['Uyruğu', ''],
       ['Kimlik Türü', ''], ['Kimlik Seri No.', ''],
       ['Adres', v.adres], ['Telefon No.', v.tel], ['E-Posta', v.eposta]],
      G_IMZA,
    ],
    aciklama: 'Kimlik doğrulaması, Türk vatandaşları için T.C. kimlik kartı, sürücü belgesi veya pasaport gibi üzerinde T.C. kimlik numarası bulunan resmi belgelerle yapılır. Gerektiğinde belgenin aslı veya noter onaylı sureti ibraz edilir ve okunabilir fotokopisi ya da elektronik kopyası alınır. Sürekli iş ilişkisinde, beyan edilen adres; yerleşim yeri belgesi veya son üç ay içinde düzenlenmiş fatura gibi belgelerle teyit edilir.',
  },

  TUZEL_KISI: {
    baslik: 'Tüzel Kimlik Bildirim Formu',
    gruplar: v => [
      [['Ünvan', v.kurumAd], ['Ticaret Sicil No.', ''], ['Vergi Dairesi', v.vd],
       ['Vergi Kimlik No.', v.kurumAd ? v.kimlik : ''], ['Faaliyet Konusu', v.meslek],
       ['Adres', v.adres], ['Telefon No.', v.tel], ['E-Posta', v.eposta]],
      G_YETKILI(v), G_IMZA,
    ],
    aciklama: 'Ünvan, ticaret sicil numarası, faaliyet konusu ve adres bilgileri ticaret sicil belgeleri ile; vergi kimlik numarası ise Gelir İdaresi kayıtları üzerinden doğrulanır. Temsilcilerin kimlik bilgileri, resmi kimlik belgeleri ile teyit edilir. %25’i aşan hissedarı olan gerçek kişiler için ayrı kimlik bildirim formu doldurulur.',
  },

  DERNEK_VAKIF: {
    baslik: 'Dernek / Vakıf Kimlik Bildirim Formu',
    gruplar: v => [
      [['Dernek/ Vakıf Adı', v.kurumAd], ['Amacı', ''], ['Kütük/ Sicil No', ''],
       ['Adres', v.adres], ['Telefon No.', v.tel], ['E-Posta', v.eposta]],
      G_YETKILI(v), G_IMZA,
    ],
    aciklama: 'Dernek veya vakıf bilgilerinin doğruluğu dernekler dairesi veya vakıflar genel müdürlüğü kayıtlarından teyit edilir. Temsilcilerin kimlik bilgileri resmi belgelerle doğrulanır.',
  },

  SENDIKA_KONFEDERASYON: {
    baslik: 'Sendika / Konfederasyon Kimlik Bildirim Formu',
    gruplar: v => [
      // DMS'te bu üç etiket "Dernek/ Vakıf Adı / Amacı / Kütük/ Sicil No"
      // olarak duruyor (kopyala-yapıştır artığı). Sendikaya uyarlandı.
      [['Sendika/ Konfederasyon Adı', v.kurumAd], ['Amacı', ''], ['Kütük/ Sicil No', ''],
       ['Adres', v.adres], ['Telefon No.', v.tel], ['E-Posta', v.eposta]],
      G_YETKILI(v), G_IMZA,
    ],
    aciklama: 'Sendika veya konfederasyona ilişkin bilgiler, Çalışma ve Sosyal Güvenlik Bakanlığı kayıtları ve ilgili resmi belgeler üzerinden teyit edilir. Temsilcilerin kimlik bilgileri resmi kimlik belgeleri ile doğrulanır.',
  },

  TUZEL_KISILIGI_OLMAYAN_TESEKKUL: {
    baslik: 'Tüzel Kişiliği Olmayan Teşekkül Kimlik Bildirim Formu',
    gruplar: v => [
      [['Teşekkül Adı', v.kurumAd], ['Adres', v.adres],
       ['Telefon No.', v.tel], ['E-Posta', v.eposta]],
      G_YETKILI(v), G_IMZA,
    ],
    aciklama: 'Tüzel kişiliği olmayan teşekküle ilişkin bilgiler, ilgili teşekkülün beyanına dayalı olarak alınır ve gerektiğinde destekleyici belgelerle teyit edilir. Temsilcilerin kimlik bilgileri resmi belgelerle doğrulanır.',
  },

  TUZEL_KISILIGI_OLMAYAN_IS_ORTAKLIGI: {
    baslik: 'Tüzel Kişiliği Olmayan İş Ortaklığı Kimlik Bildirim Formu',
    gruplar: v => [
      [['Ortaklık Adı', v.kurumAd], ['Amacı', ''], ['Faaliyet Konusu', v.meslek],
       ['Adres', v.adres], ['Vergi Kimlik No', v.kurumAd ? v.kimlik : ''],
       ['Vergi Dairesi', v.vd], ['Telefon No.', v.tel], ['E-Posta', v.eposta]],
      G_YETKILI(v), G_IMZA,
    ],
    aciklama: 'Tüzel kişiliği olmayan iş ortaklığına ilişkin bilgiler, ortaklık sözleşmesi ve taraf beyanlarına dayanarak alınır. Ortaklık temsilcilerinin kimlik bilgileri resmi belgelerle doğrulanır.',
  },

  SIYASI_PARTI: {
    baslik: 'Siyasi Parti Kimlik Bildirim Formu',
    gruplar: v => [
      [['Parti Adı/ Birim', v.kurumAd], ['Adres', v.adres],
       ['Telefon No.', v.tel], ['E-Posta', v.eposta]],
      G_YETKILI(v), G_IMZA,
    ],
    aciklama: 'Siyasi partiye ilişkin bilgilerin doğruluğu, Yargıtay Cumhuriyet Başsavcılığı Siyasi Partiler Bürosu kayıtlarından teyit edilir. Parti temsilcilerinin kimlik bilgileri ise resmi kimlik belgeleri ile doğrulanır.',
  },
}

// CRM müşteri kaydı → form değerleri.
// ⚠️ SAHIS/SIRKET ayrımı: müşteri şirketse ad_soyad UNVANDIR, kurum alanına
//   gider ve yetkili boş kalır. Şahıssa tam tersi. DMS her iki durumda da adı
//   "Yetkili"ye yazıyor, şirket satışında Ünvan boş kalıyordu.
function masakDeger(ctx) {
  const m = ctx.musteri || {}
  const sirket = m.tip === 'SIRKET'
  return {
    ad: sirket ? '' : kacis(m.ad_soyad || ''),
    kurumAd: sirket ? kacis(m.ad_soyad || '') : '',
    kimlik: kacis(ctx.kimlik || ''),
    dogum: m.dogum_tarihi ? kacis(new Date(m.dogum_tarihi).toLocaleDateString('tr-TR')) : '',
    adres: kacis(m.adres || ''),
    tel: kacis(m.telefon || ''),
    eposta: kacis(m.e_posta || ''),
    vd: kacis(m.vergi_dairesi || ''),
    meslek: kacis(m.meslek_grubu || ''),
  }
}

function masakHtml(ctx, tip, satir) {
  const form = MASAK_FORM[tip] || MASAK_FORM.GERCEK_KISI
  const v = masakDeger(ctx)
  const belgeNo = satir?.belge_no || ctx.evraklar.find(e => e.belge_kodu === 'MASAK')?.belge_no
  const o = ortak(ctx)

  const satirlar = (grup, ilkGrup) => grup.map(([e, d], i) => `
    <tr${i === 0 && !ilkGrup ? ' class="ara"' : ''}>
      <td class="et">${kacis(e)}</td>
      <td class="dg">${d || '&nbsp;'}</td>
    </tr>`).join('')

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${kacis(form.baslik)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; color: #2B3038; margin: 0; }
  .ust { display: flex; justify-content: space-between; align-items: flex-start;
         border-bottom: 1px solid #E3E5E8; padding-bottom: 10px; margin-bottom: 12px; }
  h1 { font-size: 21px; font-weight: 600; margin: 0; line-height: 1.25; max-width: 70%; }
  .tn { font-size: 10px; color: #6B7280; white-space: nowrap; padding-top: 6px; }
  .grupbas { font-size: 9.5px; color: #9AA0A6; margin: 0 0 2px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 7px 0 5px; vertical-align: bottom; }
  td.et { width: 33%; font-size: 10px; color: #6B7280; }
  td.dg { border-bottom: 1px solid #E3E5E8; font-weight: 700; font-size: 11px; padding-left: 6px; }
  tr.ara td { padding-top: 20px; }
  .aciklama { margin: 14px 0 0 33%; font-size: 9px; color: #9AA0A6;
              line-height: 1.55; text-align: justify; }
  .dip { margin-top: 26px; border-top: 1px solid #E3E5E8; padding-top: 8px;
         display: flex; justify-content: space-between; align-items: flex-end;
         font-size: 9px; color: #4B5058; line-height: 1.7; }
  @media print { .yaz { display: none; } }
  .yaz { position: fixed; top: 8px; right: 8px; background: #6B1F2A; color: #fff;
         border: 0; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; }
</style></head><body>
<button class="yaz" onclick="window.print()">Yazdır</button>
<div class="ust">
  <h1>${kacis(form.baslik)}</h1>
  <div class="tn">Tarih/ No: ${kacis(o.tarih)}${belgeNo ? ' / ' + kacis(belgeNo) : ''}</div>
</div>
<p class="grupbas">Kişisel Bilgiler</p>
<table>${form.gruplar(v).map((g, i) => satirlar(g, i === 0)).join('')}</table>
<p class="aciklama">${kacis(form.aciklama)}</p>
<div class="dip">
  <div>${kacis(FIRMA.unvan)}<br>${kacis(FIRMA.adres)}<br>${kacis(FIRMA.vd)}</div>
  <div>${kacis(FIRMA.yetki)}</div>
</div>
</body></html>`
}
