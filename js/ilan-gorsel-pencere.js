// =====================================================================
// ilan-gorsel-pencere.js — İlan görseli penceresi (araç kartı + İlanlarımız)
//   Tek pencere, iki giriş noktası: araç kartında "Görsel" düğmesi ve
//   İlanlarımız > Görseller sekmesindeki satırlar. Aynı kod iki yerde
//   çizildiği için ayrı modül — kopyalanmadı.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata } from './veri.js'
import { mat, panoyaYaz } from './stitch-ui.js'
import { veriTopla, htmlDoldur, metinUret, gorselUret } from './ilan-gorsel.js'

let _benim = null
export function ilanGorselKur(danisman) { _benim = danisman }

function bilgi(el, metin, tur = 'bilgi') {
  if (!el) return
  const renk = tur === 'hata' ? 'text-error' : tur === 'basari' ? 'text-[#1a7a3d]' : 'text-on-surface-variant'
  el.className = `text-body-sm ${renk}`
  el.textContent = metin
}

// ---------------------------------------------------------------------
// DONANIM KÜTÜPHANESİ (sql/120) — TSB marka+tip → model varsayılanı
//
// Kütüphaneyi yalnız master + bilgi işlem yazabilir (Göksenil kararı).
// ⚠️ Bu kapı DB politikasının (tsb_donanim_yaz/_guncelle) AYNASI. Ayrışırsa
//   düğme görünür ama yazma 0 satır döner ve kullanıcı sebebini anlamaz.
const kutuphaneYazar = d => !!(d && (d.master_admin || d.rol === 'bilgi_islem'))

function ekspOzet(paneller) {
  let b = 0, l = 0, dg = 0
  for (const d of Object.values(paneller || {})) {
    if (d === 'BOYALI') b++; else if (d === 'LOKAL BOYA') l++; else if (d === 'DEGISEN') dg++
  }
  return (b + l + dg) === 0 ? 'tamamı orijinal'
    : [dg ? `${dg} değişen` : '', b ? `${b} boyalı` : '', l ? `${l} lokal` : ''].filter(Boolean).join(' · ')
}

function donanimRozeti(v) {
  if (v.donanimKaynak === 'MODEL') {
    return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary" title="Aynı TSB marka+tip kodundaki araçlardan geldi">MODEL VARSAYILANI</span>`
  }
  if (v.donanimKaynak === 'ARAC') {
    return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant" title="Bu araca özel kaydedilmiş">BU ARACA ÖZEL</span>`
  }
  return ''
}

function donanimAltBilgi(v) {
  if (!v.tsb) {
    return `<p class="text-[11px] text-on-surface-variant mt-1">${mat('info', 'text-[13px] align-middle')} Bu araçta TSB marka/tip kodu yok — donanım yalnız bu araca kaydedilir.</p>`
  }
  const kod = `${v.tsb.marka_kodu} / ${v.tsb.tip_kodu}`
  if (!v.modelDonanim) {
    return `<p class="text-[11px] text-on-surface-variant mt-1">Bu model (<b>${kacis(kod)}</b>) için kayıtlı donanım yok — <b>kaydettiğinde model varsayılanı olur</b>, aynı araçtan geleni sen yazmazsın.</p>`
  }
  return `<div class="flex items-center justify-between gap-2 mt-1">
      <p class="text-[11px] text-on-surface-variant">Model <b>${kacis(kod)}</b>. Düzenlemen yalnız bu araca yazılır.</p>
      ${kutuphaneYazar(_benim) ? `<button id="igVarsayilanYap" class="shrink-0 bg-surface-container-low border border-primary/40 text-primary px-2 py-0.5 rounded text-[11px] font-bold">Varsayılan Yap</button>` : ''}
    </div>`
}

// ---------------------------------------------------------------------
// ÖNİZLEME — İFRAME İÇİNDE (yalıtım şart)
//
// ⚠️ ESKİ YOL SAYFAYI BOZUYORDU (Göksenil bildirdi, 1 Ağu 2026):
//   Şablonun <style> etiketleri doğrudan sayfaya enjekte ediliyordu. İlan
//   şablonunun CSS'i global (body, *, genel sınıf adları) olduğu için önizle'ye
//   basınca ARKADAKİ ARAÇ KARTI da yeniden biçimleniyor, sütunlar daralıyordu.
//   Çözüm: srcdoc'lu iframe → CSS dışarı SIZAMAZ.
//   Şablonda <script> yok (ilan-sablon.html'de 0 adet), bu yüzden sandbox'ta
//   allow-scripts YOK; yalnız allow-same-origin (yüksekliği okuyabilmek için).
//
// Şablon 800 px sabit genişlikte. Panele sığması için ölçekleniyor — eskiden
// ölçek yoktu ve görsel sağ tarafa oturmuyordu.
const ONIZLEME_EN = 800

function onizlemeCiz(kap, html) {
  kap.innerHTML = `<div class="ig-olcek" style="position:relative;width:100%;overflow:hidden">
    <iframe class="ig-cerceve" sandbox="allow-same-origin" title="İlan görseli önizleme"
            style="width:${ONIZLEME_EN}px;border:0;display:block;transform-origin:top left;background:#fff"></iframe>
  </div>`
  const olcek = kap.querySelector('.ig-olcek')
  const cer = kap.querySelector('.ig-cerceve')
  cer.addEventListener('load', () => {
    try {
      const d = cer.contentDocument
      const yuk = Math.max(d.body?.scrollHeight || 0, d.documentElement?.scrollHeight || 0, 400)
      cer.style.height = yuk + 'px'
      const k = Math.min(1, (kap.clientWidth || ONIZLEME_EN) / ONIZLEME_EN)
      cer.style.transform = `scale(${k})`
      olcek.style.height = Math.round(yuk * k) + 'px'
    } catch (e) { console.error('[ilan-gorsel] önizleme ölçek', e) }
  })
  cer.srcdoc = html
}

// ---------------------------------------------------------------------
// ARAÇ BİLGİLERİ — ilanı yazan kişi sahibinden formunu doldururken buradan
// okusun (Göksenil: "araç bilgileri gösterilmiyor, ilan girerken kolaylık olur").
function aracBilgiHtml(v) {
  const a = v.arac || {}
  const p = v.paneller || {}
  let boyali = 0, lokal = 0, degisen = 0
  for (const d of Object.values(p)) {
    if (d === 'BOYALI') boyali++; else if (d === 'LOKAL BOYA') lokal++; else if (d === 'DEGISEN') degisen++
  }
  const eksp = (boyali + lokal + degisen) === 0 ? 'Tamamı orijinal'
    : [degisen ? `${degisen} değişen` : '', boyali ? `${boyali} boyalı` : '', lokal ? `${lokal} lokal` : ''].filter(Boolean).join(' · ')
  const tl = n => (n || n === 0) ? '₺' + Number(n).toLocaleString('tr-TR') : '—'
  const sat = (et, deg) => `<div class="min-w-0">
    <p class="text-[10px] uppercase tracking-wide text-on-surface-variant">${kacis(et)}</p>
    <p class="text-body-sm font-bold text-on-surface truncate" title="${kacis(deg)}">${kacis(deg) || '—'}</p></div>`
  return `<div class="border border-outline-variant rounded-lg p-3 bg-surface-container-low">
    <div class="flex items-center justify-between gap-2 mb-2">
      <span class="text-[11px] font-bold text-primary uppercase tracking-wide flex items-center gap-1">${mat('directions_car', 'text-[15px]')} Araç Bilgileri</span>
      <button id="igBilgiKopya" class="bg-surface-container-lowest border border-outline-variant px-2 py-0.5 rounded text-[11px] font-bold">Tümünü Kopyala</button>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
      ${sat('Marka / Model', [a.marka, a.model].filter(Boolean).join(' '))}
      ${sat('Versiyon', a.versiyon)}
      ${sat('Yıl', a.yil)}
      ${sat('KM', a.km != null ? Number(a.km).toLocaleString('tr-TR') : '')}
      ${sat('Yakıt', a.yakit)}
      ${sat('Vites', a.vites)}
      ${sat('Kasa', a.kasa_tipi)}
      ${sat('Renk', a.renk)}
      ${sat('Plaka', a.plaka ? String(a.plaka).toUpperCase() : '')}
      ${sat('Fiyat', tl(v.fiyat))}
      ${sat('Kasko (TSB)', tl(v.kasko))}
      ${sat('Tramer', v.tramer?.adet ? `${v.tramer.adet} kayıt${v.tramer.tutar > 0 ? ' · ' + tl(v.tramer.tutar) : ''}` : 'Yok')}
      <div class="col-span-2 md:col-span-4">${sat('Ekspertiz', eksp)}</div>
    </div></div>`
}

function aracBilgiMetni(v) {
  const a = v.arac || {}
  return [
    [a.marka, a.model, a.versiyon].filter(Boolean).join(' '),
    a.yil ? `Model yılı: ${a.yil}` : '',
    a.km != null ? `KM: ${Number(a.km).toLocaleString('tr-TR')}` : '',
    a.yakit ? `Yakıt: ${a.yakit}` : '',
    a.vites ? `Vites: ${a.vites}` : '',
    a.kasa_tipi ? `Kasa: ${a.kasa_tipi}` : '',
    a.renk ? `Renk: ${a.renk}` : '',
    v.fiyat ? `Fiyat: ${Number(v.fiyat).toLocaleString('tr-TR')} TL` : '',
  ].filter(Boolean).join('\n')
}

/**
 * Görsel penceresini aç.
 * @param {string} aracId
 * @param {string} baslik  başlıkta gösterilecek araç adı (plaka + marka)
 * @param {Function} [bitince] üretim başarılıysa çağrılır (liste tazelemek için)
 * @param {{fotoHref?:string}} [opt] fotoHref verilirse başlığa "Fotoğraf Yükle"
 *   bağlantısı eklenir. Stok Merkezi'ndeki fotoğrafsız araç kutusu buradan
 *   giriyor: Göksenil butonun hem ilan görselini açmasını hem de fotoğraf
 *   yüklemeye yol vermesini istedi (1 Ağu 2026).
 */
export async function ilanGorselAc(aracId, baslik, bitince, opt = {}) {
  let v
  try { v = await veriTopla(aracId) } catch (e) { alert('Veri okunamadı: ' + e.message); return }
  const g = v.gorsel || {}

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[85] flex items-center justify-center p-4'
  ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
    <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[92vh]">
      <div class="flex items-center justify-between p-4 border-b border-outline-variant">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('image', 'text-[18px]')} İlan Görseli — ${kacis(baslik || '')}</h3>
        <div class="flex items-center gap-2">
          ${opt.fotoHref ? `<a href="${kacis(opt.fotoHref)}" class="bg-surface-container-low border border-primary/40 text-primary px-3 py-1.5 rounded-lg text-label-sm font-bold flex items-center gap-1 hover:bg-primary/5">${mat('add_photo_alternate', 'text-[16px]')} Fotoğraf Yükle</a>` : ''}
          <button data-kapat class="w-8 h-8 rounded-full hover:bg-surface-container-high flex items-center justify-center">${mat('close', 'text-[18px]')}</button>
        </div>
      </div>

      <div class="overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <!-- SOL: girdiler -->
        <div class="space-y-3">
          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <label class="block text-label-sm text-on-surface-variant">Donanım <span class="text-[11px]">(her satıra bir özellik)</span></label>
              ${donanimRozeti(v)}
            </div>
            <textarea id="igDonanim" rows="10" placeholder="Cam Tavan&#10;Isıtmalı Koltuk&#10;Geri Görüş Kamerası"
              class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-sm bg-white font-mono">${kacis(v.donanim || '')}</textarea>
            ${donanimAltBilgi(v)}
          </div>
          <!-- ⚠️ "Cinsi" ve "Tramer'i elle gir" KALDIRILDI (Göksenil, 1 Ağu 2026):
               "cinsi olmasın zaten veriyi araç detayından çekeceğiz",
               "trameri elle gir diye bir satır olmasın … araç kartındaki svg'i
                oraya basacağız, tramer'i de oradan basacağız adet ve tutar olarak".
               İkisi de zaten araç kaydından türetiliyordu; bunlar yalnızca
               ÜZERİNE YAZMA seçeneğiydi ve hiç kullanılmamıştı (canlıda 0 kayıt).
               Kolonlar DB'de duruyor (veri kaybı olmasın) ama kayıtta
               temizleniyor — bkz girdileriKaydet. -->
          <div class="border border-outline-variant rounded-lg p-3 text-[11px] leading-relaxed text-on-surface-variant">
            <b class="text-on-surface">Ekspertiz şeması ve tramer araç kaydından basılır.</b>
            Şu an: ekspertiz ${kacis(ekspOzet(v.paneller))} ·
            tramer <b>${v.tramer.adet ? `${v.tramer.adet} kayıt${v.tramer.tutar > 0 ? ' / ₺' + Number(v.tramer.tutar).toLocaleString('tr-TR') : ''}` : 'yok'}</b>.
            Yanlışsa araç kartından düzeltilir, görsel tazelenir.
          </div>

          <div class="bg-surface-container rounded-lg p-3 text-[11px] leading-relaxed text-on-surface-variant">
            <b class="text-on-surface">Kredi rakamları otomatik.</b> Satış fiyatı ve TSB kasko bedelinden
            hesaplanır (araç kartıyla aynı motor). Fiyat ya da TSB listesi değişince görsel
            <b>eski</b> işaretlenir, buradan tek tuşla tazelersin — <b>bağlantı değişmez</b>.
            <div class="mt-1.5 pt-1.5 border-t border-outline-variant">
              Fiyat: <b>${v.fiyat ? '₺' + Number(v.fiyat).toLocaleString('tr-TR') : '— (fiyatlanmamış)'}</b> ·
              Kasko: <b>${v.kasko ? '₺' + Number(v.kasko).toLocaleString('tr-TR') : '—'}</b>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button id="igOnizle" class="bg-surface-container-low border border-outline-variant text-on-surface px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1">${mat('visibility', 'text-[16px]')} Önizle</button>
            <button id="igUret" class="bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1">${mat('cloud_upload', 'text-[16px]')} Üret ve Yayına Al</button>
          </div>
          <p id="igDurum" class="text-body-sm text-on-surface-variant"></p>
        </div>

        <!-- SAĞ: araç bilgileri + önizleme + çıktılar -->
        <div class="space-y-3 min-w-0">
          ${aracBilgiHtml(v)}
          <div id="igOnizlemeKap" class="border border-outline-variant rounded-lg bg-surface-container overflow-auto max-h-[52vh] flex items-center justify-center p-2">
            ${g.gorsel_url
              ? `<img id="igImg" src="${kacis(g.gorsel_url)}?t=${Date.now()}" alt="İlan görseli" class="max-w-full">`
              : `<div class="text-center text-on-surface-variant py-12">${mat('image', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">Henüz görsel üretilmedi</p></div>`}
          </div>
          <div id="igBaglantiKap" class="${g.gorsel_url ? '' : 'hidden'} space-y-2">
            <div>
              <label class="block text-label-sm text-on-surface-variant mb-1">Görsel bağlantısı (sahibinden ilanına bu gider)</label>
              <div class="flex gap-2">
                <input id="igUrl" type="text" readonly value="${kacis(g.gorsel_url || '')}"
                  class="flex-1 min-w-0 border border-outline-variant rounded-lg px-3 py-2 text-body-sm bg-surface-container font-mono" />
                <button id="igUrlKopya" class="bg-surface-container-low border border-outline-variant px-3 py-2 rounded-lg text-label-sm font-bold whitespace-nowrap">Kopyala</button>
              </div>
            </div>
            <div>
              <label class="block text-label-sm text-on-surface-variant mb-1">İlan metni (şemasız — açıklamaya yapıştır)</label>
              <textarea id="igMetin" rows="6" readonly class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-sm bg-surface-container font-mono">${kacis(g.ilan_metni || '')}</textarea>
              <button id="igMetinKopya" class="mt-1 bg-surface-container-low border border-outline-variant px-3 py-1.5 rounded-lg text-label-sm font-bold">Metni Kopyala</button>
            </div>
          </div>
        </div>
      </div>
    </div>`
  document.body.appendChild(ov)

  const kapat = () => ov.remove()
  ov.querySelectorAll('[data-kapat]').forEach(b => b.addEventListener('click', kapat))
  const esc = e => { if (e.key === 'Escape') { kapat(); document.removeEventListener('keydown', esc) } }
  document.addEventListener('keydown', esc)

  const $ = s => ov.querySelector(s)
  const durumEl = $('#igDurum')

  // "Varsayılan Yap" — ekrandaki donanımı bu TSB marka+tip için model
  // varsayılanı yapar. Yalnız kütüphane yetkisi olanda çizilir.
  $('#igVarsayilanYap')?.addEventListener('click', async e => {
    const btn = e.currentTarget
    const donanim = $('#igDonanim').value.trim()
    if (!donanim) { bilgi(durumEl, 'Donanım boş — varsayılan yapılamaz.', 'hata'); return }
    if (!confirm(`Bu donanım listesi, TSB ${v.tsb.marka_kodu}/${v.tsb.tip_kodu} kodlu TÜM araçların varsayılanı olacak. Onaylıyor musun?`)) return
    btn.disabled = true
    try {
      await kutuphaneyeYaz(donanim, false)
      bilgi(durumEl, '✓ Model varsayılanı güncellendi — bu koddan gelen yeni araçlarda dolu gelir.', 'basari')
    } catch (err) {
      bilgi(durumEl, 'Varsayılan yapılamadı: ' + err.message, 'hata')
    } finally { btn.disabled = false }
  })

  // Girdileri kaydet, sonra taze veriyle çalış.
  async function girdileriKaydet() {
    const donanim = $('#igDonanim').value.trim() || null
    const kayit = {
      arac_id: aracId,
      donanim,
      // ⚠️ Elle cinsi/tramer artık YOK — arayüzden kaldırıldı. Eski bir kayıtta
      //   açık kalmışsa sessizce üzerine yazmaya devam ederdi; her kayıtta
      //   temizleniyor ki görsel daima araç kaydını yansıtsın.
      manuel_cinsi: null,
      manuel_tramer: false,
      tramer_adet_m: null,
      tramer_tutar_m: null,
    }
    const { data, error } = await supabase.from('ilan_gorselleri')
      .upsert(kayit, { onConflict: 'arac_id' }).select('arac_id')
    if (error) { dbHata('ilan görseli · girdi', error); throw new Error(error.message) }
    // §5.1 — yetki yoksa PostgREST hata vermez, 0 satır yazar.
    if (!data?.length) throw new Error('İlan yetkiniz yok (kayıt yazılamadı)')

    // KÜTÜPHANE: model için kayıt YOKSA yazılan donanım varsayılan olur
    // (Göksenil kararı). Kayıt VARSA dokunulmaz — düzenleme araca özeldir;
    // varsayılanı değiştirmek "Varsayılan Yap" ile BİLEREK yapılır.
    if (donanim && v.tsb && !v.modelDonanim && kutuphaneYazar(_benim)) {
      await kutuphaneyeYaz(donanim, true)
    }
  }

  // Kütüphaneye yaz. sessiz=true ise hata kullanıcıya patlatılmaz (kayıt
  // akışını bölmesin) — yalnız loglanır ve durum satırında belirtilir.
  async function kutuphaneyeYaz(donanim, sessiz) {
    if (!v.tsb) return false
    const { data, error } = await supabase.from('tsb_donanim')
      .upsert({ marka_kodu: v.tsb.marka_kodu, tip_kodu: v.tsb.tip_kodu, donanim,
                guncelleyen: _benim?.id || null }, { onConflict: 'marka_kodu,tip_kodu' })
      .select('marka_kodu')
    if (error) {
      dbHata('donanım kütüphanesi yaz', error)
      if (!sessiz) throw new Error(error.message)
      return false
    }
    if (!data?.length) {           // §5.1 — 0 satır = yetki yok
      if (!sessiz) throw new Error('Model varsayılanını yalnız bilgi işlem değiştirebilir.')
      return false
    }
    v.modelDonanim = donanim
    return true
  }

  $('#igOnizle').addEventListener('click', async () => {
    const btn = $('#igOnizle'); btn.disabled = true
    bilgi(durumEl, 'Önizleme hazırlanıyor…')
    try {
      await girdileriKaydet()
      const yeni = await veriTopla(aracId)
      const html = await htmlDoldur(yeni)
      // Önizleme yalıtılmış iframe'de (canvas'a gerek yok, daha hızlı ve net).
      // ⚠️ Şablonun <style>'ını sayfaya enjekte ETME — arkadaki sayfayı bozar.
      const kap = $('#igOnizlemeKap')
      kap.classList.remove('flex', 'items-center', 'justify-center')   // iframe tam genişlik alsın
      onizlemeCiz(kap, html)
      $('#igMetin') && ($('#igMetin').value = metinUret(yeni))
      bilgi(durumEl, 'Önizleme hazır — gerçek görsel bu düzenin resmi olur.', 'basari')
    } catch (e) {
      console.error('[ilan-gorsel] önizleme', e)
      bilgi(durumEl, 'Önizleme yapılamadı: ' + e.message, 'hata')
    } finally { btn.disabled = false }
  })

  $('#igUret').addEventListener('click', async () => {
    const btn = $('#igUret'); btn.disabled = true
    const eski = btn.innerHTML
    btn.textContent = 'Üretiliyor…'
    bilgi(durumEl, 'Görsel üretiliyor, bu birkaç saniye sürebilir…')
    try {
      await girdileriKaydet()
      const { url, metin } = await gorselUret(aracId, _benim?.id || null)
      $('#igOnizlemeKap').innerHTML = `<img id="igImg" src="${kacis(url)}?t=${Date.now()}" alt="İlan görseli" class="max-w-full">`
      $('#igBaglantiKap').classList.remove('hidden')
      $('#igUrl').value = url
      $('#igMetin').value = metin
      bilgi(durumEl, '✓ Görsel yayında. Bağlantı sabit — sahibinden ilanını değiştirmene gerek yok.', 'basari')
      bitince?.()
    } catch (e) {
      console.error('[ilan-gorsel] üretim', e)
      bilgi(durumEl, 'Üretilemedi: ' + e.message, 'hata')
      await supabase.from('ilan_gorselleri')
        .update({ durum: 'HATA', hata_mesaji: String(e.message).slice(0, 500) })
        .eq('arac_id', aracId)
    } finally { btn.disabled = false; btn.innerHTML = eski }
  })

  $('#igBilgiKopya')?.addEventListener('click', e => panoyaYaz(aracBilgiMetni(v), e.currentTarget))
  $('#igUrlKopya')?.addEventListener('click', e => panoyaYaz($('#igUrl').value, e.currentTarget))
  $('#igMetinKopya')?.addEventListener('click', e => panoyaYaz($('#igMetin').value, e.currentTarget))
}
