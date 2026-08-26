// =====================================================================
// evrak-takip.js — EVRAK TALEBİ iş takibi (bilgi işlem)
//
//   Göksenil: "güncel ekspertiz istenildiğinde sadece bilgi işlem
//   personelinin görebileceği bir alanda araç plakası / tescil tarihi /
//   yedek anahtarı / hangi danışman uyarı verecek. Önce pop-up, sonra bir
//   yerde iş takibi için sürekli dursun. Araç satılınca 'yayından kalktı
//   mı?' + 'satış noter nüshası gönderildi mi?' sorulsun; personel
//   işaretleyince aracın görünmesine gerek yok."
//
//   İKİ EKRAN, TEK KAYNAK: Ana Sayfa (özet kart + pop-up) ve
//   İlanlarımız → "Evrak Talepleri" sekmesi AYNI görünümü okur
//   (v_evrak_takip) ve AYNI RPC'yi çağırır (evrak_takip_isaretle).
//   Böylece "kartta var listede yok" durumu oluşamaz.
//
//   ⚠️ HESAP YOK, GÖSTERİM VAR. `satildi`, `bugun_kalkti`, `kapandi`
//   SUNUCUDA hesaplanır. Burada "satılmış sayılır mı" diye ikinci bir
//   tanım yazılmaz — ilan sayfasında bu hata bir kez yapıldı (bkz.
//   ilanlar.js kaldirilmaliHtml yorumu), tekrarlanmıyor.
// =====================================================================
import { supabase } from './supabase-client.js'
import {
  kacis, buyuk, dbHata, fmtTarih, fmtTarihKisa, gunGecti,
  aracDurumEtiket, kodTemiz,
} from './veri.js'
import { mat, pill, bosDurum } from './stitch-ui.js'

// İlanlarımız sayfasındaki sekme anahtarı — bildirim/kart bağlantıları
// buraya gider. Tek yerde tanımlı ki linkler sekme adından sapmasın.
export const EVRAK_SEKME = 'evrak'
export const EVRAK_LINK = 'ilanlar.html?sekme=' + EVRAK_SEKME

// §5.3 — varsayılan 1000 satır limiti sessizce keser. Liste küçük kalacak
// (açık evrak talebi), yine de sınır konur ve dayanırsa kullanıcı uyarılır.
export const EVRAK_LIMIT = 200

// Pop-up bir talebi kullanıcıya YALNIZCA BİR KEZ gösterir. 14 kişilik
// ekipte her açılışta tekrar eden pop-up en hızlı nefret edilen şeydir.
const GORULEN_ANAHTAR = 'ic_evrak_gorulen'
const GORULEN_UST_SINIR = 500      // sınırsız büyümesin (FIFO)

// ---------------------------------------------------------------------
// VERİ
// ---------------------------------------------------------------------
export async function evrakListesiOku() {
  const { data, error } = await supabase.from('v_evrak_takip')
    .select('*')
    .eq('kapandi', false)
    // Aksiyon bekleyenler (satılmış araçlar) üstte, sonra en eski talep önce.
    .order('satildi', { ascending: false })
    .order('talep_zamani', { ascending: true })
    .limit(EVRAK_LIMIT)
  if (error) {
    dbHata('evrak takip listesi', error)
    return { satirlar: [], kesildi: false, hata: error }
  }
  const satirlar = data || []
  const kesildi = satirlar.length >= EVRAK_LIMIT
  if (kesildi) console.warn('[evrak] liste ' + EVRAK_LIMIT + ' satırda kesildi — sayfalama gerekebilir.')
  return { satirlar, kesildi, hata: null }
}

// Tek alan işaretleme. RPC { tamam, kapandi } döner.
//   ⚠️ §5.1 mantığı RPC'de de geçerli: yetki yoksa hata GELMEZ, `tamam`
//   false döner. Sessizce "işaretledim" sanmamak için ayrıca kontrol edilir.
export async function evrakIsaretle(id, alan, deger) {
  const { data, error } = await supabase.rpc('evrak_takip_isaretle', {
    p_id: id, p_alan: alan, p_deger: !!deger,
  })
  if (error) {
    dbHata('evrak isaretle (' + alan + ')', error)
    return { tamam: false, kapandi: false, mesaj: error.message }
  }
  const s = Array.isArray(data) ? data[0] : data
  if (!s || s.tamam !== true) {
    console.error('[evrak] işaretleme uygulanmadı', { id, alan, deger, sonuc: s })
    return { tamam: false, kapandi: false, mesaj: 'İşaretleme uygulanmadı — yetkiniz olmayabilir.' }
  }
  return { tamam: true, kapandi: !!s.kapandi, mesaj: null }
}

// ---------------------------------------------------------------------
// GÖRÜNÜM YARDIMCILARI
// ---------------------------------------------------------------------
// Yedek anahtar: stok_araclar.yedek_anahtar boolean (arac-detay.js ile aynı
// alan). null/boş = bilgi hiç girilmemiş — "YOK" DEĞİLDİR, uydurmuyoruz.
export function yedekAnahtarDurum(v) {
  if (v === null || v === undefined || v === '') return { metin: 'Belirtilmemiş', sinif: 'notr' }
  const varMi = v === true || v === 1 ||
    (typeof v === 'string' && ['VAR', 'EVET', 'TRUE', '1'].includes(buyuk(v).trim()))
  return varMi ? { metin: 'Var', sinif: 'basari' } : { metin: 'YOK', sinif: 'hata' }
}

function bekleyenMetin(ts) {
  const g = gunGecti(ts)
  if (g === null) return 'tarih yok'
  if (g === 0) return 'bugün geldi'
  return g + ' gündür bekliyor'
}

// Yalnız http/https bağlantı açılır (kayıtta bozuk/kötü niyetli şema olursa
// tıklanır bağlantıya dönüşmesin).
function guvenliUrl(u) {
  const s = String(u || '').trim()
  return /^https?:\/\//i.test(s) ? s : null
}

function alanKutu(etiket, degerHtml) {
  return `<div class="min-w-0">
    <div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${kacis(etiket)}</div>
    <div class="text-body-md break-words">${degerHtml}</div>
  </div>`
}

// Bir talebin tek satırlık özeti (pop-up ve özet kart aynı metni kullanır)
export function evrakBaslikSatiri(r) {
  const arac = buyuk([r.marka, r.model].filter(Boolean).join(' '))
  return `<span class="font-mono text-label-md font-bold bg-surface-container px-2 py-0.5 rounded">${kacis(buyuk(r.plaka || '—'))}</span>
    <span class="text-body-md text-on-surface">${kacis(arac)}${r.yil ? ' ' + kacis(r.yil) : ''}</span>`
}

// ---------------------------------------------------------------------
// TAM LİSTE (İlanlarımız → Evrak Talepleri sekmesi)
// ---------------------------------------------------------------------
export function evrakListeHtml({ satirlar, kesildi }) {
  if (!satirlar.length) {
    return bosDurum('Açık evrak talebi yok. Yeni talep geldiğinde burada görünür.', 'assignment_turned_in')
  }
  const bilgi = `<p class="text-label-md text-on-surface-variant mb-3">
      ${mat('info', 'text-[15px] align-middle')} Araç <b>satılana kadar</b> listede kalır. Satıştan sonra
      <b>yayından kalktı mı</b> ve <b>noter nüshası gönderildi mi</b> işaretlenince satır kapanır ve listeden düşer.
    </p>`
  const uyariHtml = kesildi
    ? `<div class="bg-error-container text-on-error-container border border-error/20 rounded-xl p-3 mb-3 text-body-md">
         Liste ${EVRAK_LIMIT} kayıtta kesildi — daha eski talepler görünmüyor olabilir.</div>`
    : ''
  return bilgi + uyariHtml + `<div class="space-y-sm">${satirlar.map(evrakKart).join('')}</div>`
}

function evrakKart(r) {
  const anahtar = yedekAnahtarDurum(r.yedek_anahtar)
  const kaynak = r.kaynak ? kodTemiz(buyuk(r.kaynak)) : ''
  return `<div id="ev-${kacis(r.id)}" data-evrak="${kacis(r.id)}"
      class="bg-surface-container-lowest border border-outline-variant rounded-xl p-md custom-shadow space-y-3">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2 min-w-0">
        ${evrakBaslikSatiri(r)}
        ${r.arac_durum ? pill(aracDurumEtiket(r.arac_durum), 'notr') : ''}
        ${kaynak ? `<span class="text-label-sm text-on-surface-variant">${kacis(kaynak)}</span>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${r.satildi
          ? pill('Satıldı — kapanış işaretleri bekleniyor', 'aktif')
          : pill('Satış bekleniyor', 'bilgi')}
        <span class="text-label-sm text-on-surface-variant">${kacis(bekleyenMetin(r.talep_zamani))}</span>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
      ${alanKutu('Tescil Tarihi', r.tescil_tarihi ? kacis(fmtTarihKisa(r.tescil_tarihi)) : '<span class="text-on-surface-variant">—</span>')}
      ${alanKutu('Yedek Anahtar', pill(anahtar.metin, anahtar.sinif))}
      ${alanKutu('Talep Eden', `<span class="font-medium">${kacis(r.talep_eden_ad || '—')}</span>`)}
      ${alanKutu('Talep Zamanı', `<span class="text-on-surface-variant">${kacis(fmtTarih(r.talep_zamani))}</span>`)}
    </div>

    ${r.satildi ? kapanisSorulariHtml(r) : ''}
    <p data-durum class="text-body-sm hidden"></p>
    <div class="flex justify-end">
      <a href="arac-kart.html?id=${encodeURIComponent(r.arac_id || '')}"
        class="px-2.5 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold hover:bg-primary hover:text-white transition-all">Araç Kartı</a>
    </div>
  </div>`
}

// Araç satıldıysa sorulan iki soru. Satılmamış araçta HİÇ çizilmez —
// personel cevaplayamayacağı soruyu görmesin.
function kapanisSorulariHtml(r) {
  const url = guvenliUrl(r.ilan_url)
  const ilanBilgi = r.ilan_id
    ? `<div class="text-label-sm text-on-surface-variant flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
        <span>İlan ${kacis(r.ilan_no || '—')}</span>
        <span>·</span><span>${kacis(r.ilan_danisman_ad || 'danışman yok')}</span>
        <span>·</span><span>yayın ${kacis(fmtTarihKisa(r.ilan_yayin_tarihi))}</span>
        ${r.ilan_kaldirma_tarihi ? `<span>·</span><span>kalkma ${kacis(fmtTarihKisa(r.ilan_kaldirma_tarihi))}</span>` : ''}
        ${r.bugun_kalkti === true
          ? `<span class="px-2 py-0.5 rounded-full text-label-sm font-bold bg-amber-100 text-amber-800">BUGÜN kalktı</span>` : ''}
        ${url ? `<a href="${kacis(url)}" target="_blank" rel="noopener"
            class="text-primary font-bold hover:underline inline-flex items-center gap-0.5">İlanı aç ${mat('open_in_new', 'text-[14px]')}</a>` : ''}
      </div>`
    : `<div class="text-label-sm text-on-surface-variant mt-1">İlan kaydı yok</div>`

  return `<div class="border-t border-outline-variant pt-3 space-y-2">
    <label class="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" data-alan="ilan_kaldirildi" class="w-4 h-4 accent-[#5f1818] mt-0.5 shrink-0"
        ${r.ilan_kaldirildi ? 'checked' : ''} />
      <span class="min-w-0">
        <span class="text-body-md font-bold text-on-surface">Yayından kalktı mı?</span>
        ${ilanBilgi}
      </span>
    </label>
    <label class="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" data-alan="noter_nushasi" class="w-4 h-4 accent-[#5f1818] shrink-0"
        ${r.noter_nushasi ? 'checked' : ''} />
      <span class="text-body-md font-bold text-on-surface">Satış noter nüshası gönderildi mi?</span>
    </label>
  </div>`
}

// Kutuları bağlar. `yenile` listeyi yeniden çeken fonksiyon (satır kapanınca
// listeden düşsün diye). Olaylar KAPSAYICIDA dinlenir: liste her yenilemede
// yeniden çizildiği için tek tek bağlanan dinleyiciler ölürdü.
export function evrakListeBagla(kokEl, yenile) {
  if (!kokEl) { console.error('[evrak] evrakListeBagla: kök eleman yok'); return }
  kokEl.addEventListener('change', async e => {
    const kutu = e.target.closest('input[type="checkbox"][data-alan]')
    if (!kutu) return
    const kart = kutu.closest('[data-evrak]')
    if (!kart) return
    const durumEl = kart.querySelector('[data-durum]')
    const istenen = kutu.checked
    kart.querySelectorAll('input[data-alan]').forEach(i => { i.disabled = true })
    if (durumEl) { durumEl.className = 'text-body-sm text-on-surface-variant'; durumEl.textContent = 'Kaydediliyor…' }

    const sonuc = await evrakIsaretle(kart.dataset.evrak, kutu.dataset.alan, istenen)
    if (!sonuc.tamam) {
      kutu.checked = !istenen        // ekranı gerçeğe geri döndür
      kart.querySelectorAll('input[data-alan]').forEach(i => { i.disabled = false })
      if (durumEl) { durumEl.className = 'text-body-sm text-error'; durumEl.textContent = sonuc.mesaj || 'Kaydedilemedi.' }
      return
    }
    if (sonuc.kapandi) {
      if (durumEl) { durumEl.className = 'text-body-sm text-[#1a7a3d]'; durumEl.textContent = '✓ Tamamlandı — listeden düşüyor.' }
      if (typeof yenile === 'function') await yenile()
      return
    }
    kart.querySelectorAll('input[data-alan]').forEach(i => { i.disabled = false })
    if (durumEl) { durumEl.className = 'text-body-sm text-[#1a7a3d]'; durumEl.textContent = '✓ Kaydedildi.' }
  })
}

// ---------------------------------------------------------------------
// ANA SAYFA — ÖZET KART
// ---------------------------------------------------------------------
export function evrakOzetHtml(satirlar) {
  if (!satirlar.length) return ''
  const bekleyen = satirlar.filter(r => r.satildi).length
  const ilkUcu = satirlar.slice(0, 3).map(r => `
    <span class="inline-flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1">
      <span class="font-mono text-label-md font-bold">${kacis(buyuk(r.plaka || '—'))}</span>
      <span class="text-label-sm text-on-surface-variant">${kacis(r.talep_eden_ad || '—')}</span>
    </span>`).join('')

  return `<section class="bg-surface-container-lowest border border-outline-variant border-l-4 border-l-primary rounded-xl p-lg custom-shadow space-y-sm">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="min-w-0">
        <h4 class="text-title-lg text-on-surface flex items-center gap-2">${mat('description', 'text-primary')}
          Evrak Talebi — ${satirlar.length} açık kayıt</h4>
        <p class="text-body-md text-on-surface-variant mt-1">
          ${bekleyen ? `${bekleyen} aracın satışı tamamlandı, kapanış işaretleri bekliyor.` : 'Hepsi satış bekliyor; şimdilik aksiyon gerekmiyor.'}
        </p>
      </div>
      <a href="${EVRAK_LINK}" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold inline-flex items-center gap-2 hover:opacity-90 transition-all shrink-0">
        ${mat('arrow_forward', 'text-[18px]')} Listeye git
      </a>
    </div>
    <div class="flex flex-wrap gap-2">${ilkUcu}${satirlar.length > 3
      ? `<span class="text-label-sm text-on-surface-variant self-center">+${satirlar.length - 3} kayıt daha</span>` : ''}</div>
  </section>`
}

// ---------------------------------------------------------------------
// ANA SAYFA — POP-UP (talep başına BİR KEZ)
// ---------------------------------------------------------------------
function gorulenOku() {
  try {
    const ham = JSON.parse(localStorage.getItem(GORULEN_ANAHTAR) || '[]')
    return Array.isArray(ham) ? ham.map(String) : []
  } catch (e) {
    console.warn('[evrak] görülenler okunamadı, sıfırlanıyor', e)
    return []
  }
}
function gorulenYaz(idler) {
  try {
    localStorage.setItem(GORULEN_ANAHTAR, JSON.stringify(idler.slice(-GORULEN_UST_SINIR)))
  } catch (e) {
    // Kota dolu / gizli sekme: pop-up tekrar çıkabilir ama akış durmaz.
    console.warn('[evrak] görülenler yazılamadı', e)
  }
}

// Daha önce görülmemiş talepler için bir kez pop-up. Kapanınca değil
// AÇILINCA işaretlenir: sekme kazara kapanırsa bile aynı pop-up tekrar
// çıkmaz — bilgi kaybolmaz, kayıt zaten kalıcı listede duruyor.
export function evrakPopupGoster(satirlar) {
  const gorulen = gorulenOku()
  const yeni = satirlar.filter(r => !gorulen.includes(String(r.id)))
  if (!yeni.length) return
  if (document.getElementById('evrakOverlay')) return   // zaten açık

  const overlay = document.createElement('div')
  overlay.id = 'evrakOverlay'
  overlay.className = 'fixed inset-0 z-[100] bg-black/60 flex items-start justify-center overflow-y-auto p-4'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'evrakPopupBaslik')
  overlay.innerHTML = `
    <div class="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl my-8 stitch">
      <div class="px-6 py-4 border-b border-outline-variant">
        <h2 id="evrakPopupBaslik" class="text-headline-sm font-bold text-primary flex items-center gap-2">
          ${mat('description')} Evrak Talebi — ${yeni.length} yeni kayıt
        </h2>
        <p class="text-body-md text-on-surface-variant mt-1">
          Güncel ekspertiz istenen araçlar. Takip listesi <b>İlanlarımız → Evrak Talepleri</b> sekmesinde duruyor.
        </p>
      </div>
      <div class="px-6 py-4 space-y-3">${yeni.map(popupKart).join('')}</div>
      <div class="px-6 py-3 border-t border-outline-variant flex justify-end gap-3">
        <button id="evrakKapat" class="text-on-surface-variant hover:text-on-surface text-label-md font-bold px-3 py-2">Kapat</button>
        <a href="${EVRAK_LINK}" class="bg-primary text-on-primary px-4 py-2 rounded-lg text-label-md font-bold inline-flex items-center gap-2">
          ${mat('arrow_forward', 'text-[18px]')} Listeye Git
        </a>
      </div>
    </div>`
  document.body.appendChild(overlay)
  document.body.style.overflow = 'hidden'

  // Gösterildiği anda "görüldü" — tekrar eden pop-up olmasın.
  gorulenYaz(gorulen.concat(yeni.map(r => String(r.id))))

  const kapat = () => {
    overlay.remove()
    document.body.style.overflow = ''
    document.removeEventListener('keydown', esc)
  }
  const esc = e => { if (e.key === 'Escape') kapat() }
  overlay.querySelector('#evrakKapat').addEventListener('click', kapat)
  overlay.addEventListener('click', e => { if (e.target === overlay) kapat() })
  document.addEventListener('keydown', esc)
  overlay.querySelector('#evrakKapat').focus()
}

function popupKart(r) {
  const anahtar = yedekAnahtarDurum(r.yedek_anahtar)
  return `<div class="border border-outline-variant rounded-xl p-4 space-y-2">
    <div class="flex flex-wrap items-center gap-2">${evrakBaslikSatiri(r)}</div>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
      ${alanKutu('Tescil Tarihi', r.tescil_tarihi ? kacis(fmtTarihKisa(r.tescil_tarihi)) : '<span class="text-on-surface-variant">—</span>')}
      ${alanKutu('Yedek Anahtar', pill(anahtar.metin, anahtar.sinif))}
      ${alanKutu('Talep Eden', `<span class="font-medium">${kacis(r.talep_eden_ad || '—')}</span>`)}
    </div>
  </div>`
}
