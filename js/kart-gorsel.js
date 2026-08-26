// =====================================================================
// kart-gorsel.js — Ödeme kartını kredi kartı görseli üzerinde gösterir.
//   ÜÇ ekran kullanır: poliçe kesme · yapboz iadesi · şirket iadesi.
//   (Göksenil, 19 Ağu 2026: "kart bilgilerini bir kredi kartı görselinin
//    üzerinde gösterebiliriz, daha şık durur")
//
// ⚠️ KART NUMARASI VE CVV CRM'DE SAKLANMIYOR.
//    Tanıtıcı alanlar (ad, banka, alt uzantı, ilk4/son4) `odeme_kartlari`
//    tablosunda aynalanıyor; tam numara + son kullanma + CVV Bahadır'ın
//    finans modülünde durur ve `kart-detay` edge function'ı ile ANLIK
//    çekilir. Buradaki değişkenlerden başka hiçbir yere yazılmaz:
//    localStorage yok, sessionStorage yok, önbellek yok.
//    (sw.js:56 yalnız kendi kaynağımızdaki GET'leri önbelleğe alıyor;
//     bu çağrı farklı kaynak + POST, service worker'a hiç uğramıyor.)
//
// ⚠️ Köprü kurulmadıysa (FINANS_URL/FINANS_SECRET yok) uç 503 döner.
//    O durumda görsel KAYBOLMAZ: elimizdeki maskeli bilgiyle çizilir,
//    altına tek satır açıklama düşer. Böylece özellik bugün de işe yarar.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis } from './veri.js'
import { mat, panoyaYaz } from './stitch-ui.js'

// Kart etiketi — TEK KAYNAK.
// ⚠️ Bu ifade sigorta-iade.js:50'de modül-yerel yazılmıştı ve
//    sigorta-yapboz.js:477'de bankasız bir kopyası vardı. Artık burada.
export const kartEtiket = k => k
  ? [k.ad, k.son_dort ? '••••' + String(k.son_dort).trim() : '', k.banka ? '· ' + k.banka : '']
      .filter(Boolean).join(' ')
  : ''

// Maske — sql/224 `kart_maske()` ile AYNI biçim. İkisi ayrışırsa rapor ile
// ekran farklı görünür; biçimi burada da tek yerde tutuyoruz.
export const kartMaske = (ilk, son) => {
  const i = String(ilk ?? '').trim(), s = String(son ?? '').trim()
  return (i || s) ? `${i || '****'} ***** ${s || '****'}` : ''
}

// 16 haneyi 4'lü gruplara böl (gösterim). Kopyalanan değer BOŞLUKSUZ olur.
const dortlu = no => String(no || '').replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim()

const AG_RENK = {
  VISA:       'from-[#1a1f71] to-[#3b4bbd]',
  MASTERCARD: 'from-[#22262b] to-[#4a5158]',
  TROY:       'from-[#0d5c63] to-[#158f99]',
  AMEX:       'from-[#0b6b52] to-[#12a37c]',
}
const VARSAYILAN_RENK = 'from-[#4a2530] to-[#7B1E28]'   // bordo — proje teması

// ---------------------------------------------------------------------
// Kopyalanabilir alan
// ---------------------------------------------------------------------
// ⚠️ `genis` (tam satır kaplasın) ile `buyuk` (numara tipografisi) AYRI
//    bayraklar. Tek bayrağa bağladığımda kart sahibi adı da numara kadar
//    büyük çıktı ve kartın görsel hiyerarşisi bozuldu — provada görüldü.
//    Kartta göz ÖNCE numaraya gitmeli; ad ikinci sırada.
function alan(etiket, gosterim, kopya, { genis = false, buyuk = false } = {}) {
  const bos = gosterim == null || gosterim === ''
  return `<div class="min-w-0 ${genis ? 'col-span-2' : ''}">
    <div class="text-[9px] uppercase tracking-[0.12em] text-white/55">${kacis(etiket)}</div>
    <div class="flex items-center gap-1.5 min-w-0">
      <span class="${buyuk ? 'text-[17px] tracking-[0.14em]' : 'text-[13px]'} font-semibold text-white ${
        buyuk ? 'tabular-nums' : ''} truncate">${
        bos ? '<span class="text-white/40">—</span>' : kacis(gosterim)}</span>
      ${bos ? '' : `<button type="button" class="kgKopya shrink-0 text-white/60 hover:text-white p-0.5 rounded"
        data-kopya="${kacis(String(kopya))}" title="Kopyala">${mat('content_copy', 'text-[14px]')}</button>`}
    </div>
  </div>`
}

// ---------------------------------------------------------------------
// Görselin kendisi
//   kart  : odeme_kartlari satırı (tanıtıcı alanlar)
//   detay : kart-detay yanıtı ({kart_no, son_kullanma, cvv, tip}) ya da null
//   not   : altında gösterilecek açıklama (köprü yok / hata / yükleniyor)
// ---------------------------------------------------------------------
export function kartGorseliHtml(kart, detay = null, not = '') {
  if (!kart) return ''
  // ⚠️ Ödeme ağı ÖNCE detaydan, yoksa aynalanan kolondan (sql/231).
  //    Bahadır listeye `tip`i ekledi çünkü personel doğru kartı
  //    alt_uzanti + tip ikilisine bakarak ayırt ediyor; yalnız detaya
  //    bağlı kalsaydı ağ, kart AÇILMADAN görünmezdi.
  const ag = String(detay?.tip || kart.tip || '').toUpperCase()
  const renk = AG_RENK[ag] || VARSAYILAN_RENK
  const noGoster = detay?.kart_no ? dortlu(detay.kart_no)
                                  : kartMaske(kart.ilk_dort, kart.son_dort)
  const noKopya = detay?.kart_no ? String(detay.kart_no).replace(/\D/g, '') : ''

  return `
  <div class="kgKart rounded-2xl bg-gradient-to-br ${renk} text-white p-4 shadow-lg shadow-black/20 max-w-[420px]">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[13px] font-bold truncate">${kacis(kart.banka || kart.ad || 'Kart')}</div>
        <div class="text-[10px] text-white/60 truncate">${
          [kart.alt_uzanti, kart.ad !== kart.banka ? kart.ad : null].filter(Boolean).map(kacis).join(' · ') || '&nbsp;'}</div>
      </div>
      <div class="text-right shrink-0">
        ${ag ? `<div class="text-[11px] font-bold tracking-wider text-white/85">${kacis(ag)}</div>` : ''}
        ${mat('contactless', 'text-[18px] text-white/50')}
      </div>
    </div>

    <div class="mt-4 mb-3">
      ${alan('Kart Numarası', noGoster, noKopya || noGoster, { genis: true, buyuk: true })}
    </div>

    <div class="grid grid-cols-2 gap-x-3 gap-y-2">
      ${alan('Kart Sahibi', kart.sahip_adi, kart.sahip_adi, { genis: true })}
      ${alan('Son Kullanma', detay?.son_kullanma, detay?.son_kullanma)}
      ${/* ⚠️ CVV `null` GELEBİLİR ve bu bir hata değil: PCI-DSS 3.2 CVV
             saklamayı şifreli bile olsa yasaklıyor, finans tarafı alanı
             nullable bıraktı (Bahadır durum raporu, 19 Ağu). alan() null'ı
             "—" basıp kopyala düğmesini gizliyor — boş dize beklemiyoruz. */''}
      ${alan('CVV', detay?.cvv, detay?.cvv)}
    </div>
  </div>
  ${not ? `<p class="text-body-sm text-on-surface-variant mt-1.5 flex items-start gap-1.5 max-w-[420px]">
    ${mat('info', 'text-[15px] mt-0.5 shrink-0')}<span>${kacis(not)}</span></p>` : ''}`
}

// Kopyalama düğmelerini bağla (görsel her çizildiğinde çağrılır)
// ⚠️ panoyaYaz'a `btn` GEÇMİYORUZ: ortak sürüm butona "✓ Kopyalandı"
//    METNİ basıyor, buradaki düğmeler ise kartın içinde 14px'lik ikonlar —
//    metin taşar ve kartın hizası bozulur. Geri bildirimi ikon değiştirerek
//    burada veriyoruz; kopyalama mantığı yine TEK KAYNAKTA.
export function kartGorseliBagla(kok) {
  kok?.querySelectorAll('.kgKopya').forEach(b =>
    b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation()
      const ok = await panoyaYaz(b.dataset.kopya)
      const eski = b.innerHTML
      b.innerHTML = mat(ok ? 'check' : 'error', 'text-[14px]')
      b.classList.toggle('text-white', ok)
      setTimeout(() => { b.innerHTML = eski; b.classList.remove('text-white') }, 1200)
    }))
}

// ---------------------------------------------------------------------
// Tam bilgiyi çek (edge function)
// ---------------------------------------------------------------------
async function detayCek(kartId, nerede) {
  const { data, error } = await supabase.functions.invoke('kart-detay', {
    body: { kart_id: kartId, nerede },
  })
  if (error) {
    // ⚠️ SESSİZ GEÇME YOK (§5.4). Sunucu gövdesini de okumaya çalışıyoruz;
    //    supabase-js hata gövdesini error.context içinde taşıyor.
    let govde = null
    try { govde = await error.context?.json?.() } catch { /* gövde okunamadı */ }
    console.error('[kart] detay alinamadi', error, govde)
    return { hata: govde?.hata || 'baglanti', mesaj: govde?.mesaj || error.message }
  }
  return { kart: data?.kart || null }
}

// ---------------------------------------------------------------------
// ANA GİRİŞ — hedef elemana kart bloğunu çizer.
//   hedef : DOM elemanı (boşsa hiçbir şey yapmaz)
//   kart  : odeme_kartlari satırı
//   nerede: 'sigorta-police' | 'sigorta-yapboz' | 'sigorta-iade'  (log için)
//
// Çağıran her yeniden çizimde bunu tekrar çağırabilir; istek yarıştaysa
// `jeton` ile en son isteğin sonucu kazanır (kullanıcı hızlı kart
// değiştirdiğinde eski yanıtın ekranı ezmesini engeller).
// ---------------------------------------------------------------------
let _jeton = 0
export async function kartBloguCiz(hedef, kart, nerede) {
  if (!hedef) return
  if (!kart) { hedef.innerHTML = ''; return }

  const benim = ++_jeton
  // 1) Önce elimizdekiyle çiz — ekran boş kalmasın
  hedef.innerHTML = kartGorseliHtml(kart, null, 'Kart bilgisi alınıyor…')
  kartGorseliBagla(hedef)

  const sonuc = await detayCek(kart.id, nerede)
  if (benim !== _jeton) return          // daha yeni bir istek var, bunu yut

  if (sonuc.kart) {
    hedef.innerHTML = kartGorseliHtml(kart, sonuc.kart, '')
  } else {
    const not = sonuc.hata === 'finans_koprusu_yapilandirilmadi'
      ? 'Kart bilgisi köprüsü henüz kurulmadı — yalnız maskeli bilgi gösteriliyor.'
      : sonuc.hata === 'yetkisiz'
        ? 'Kart bilgisini yalnızca sigorta birimi ve muhasebe görebilir.'
        : sonuc.hata === 'eslesmemis_kart'
          ? 'Bu kart finans modülüyle eşleşmemiş — Tanımlar\'dan senkronlayın.'
          : (sonuc.mesaj || 'Kart bilgisi alınamadı.')
    hedef.innerHTML = kartGorseliHtml(kart, null, not)
  }
  kartGorseliBagla(hedef)
}

// ---------------------------------------------------------------------
// Tahsilat şekline göre kartı seç — TEK KAYNAK
//   `tahsilat_kart_kurallari` üzerinden en yüksek öncelikli eşleşme.
// ⚠️ TARAF TUZAĞI: poliçe kesiminde para MÜŞTERİDEN tahsil edilir
//    (taraf='MUSTERI'); yapboz iadesinde para ŞİRKETE döner (taraf='SIRKET').
//    Kopyala-yapıştır yapılıp yanlış taraf verilirse kural HİÇ eşleşmez ve
//    ekran sessizce boş kalır — bu yüzden taraf zorunlu parametre.
// ---------------------------------------------------------------------
export function kartSec(kurallar, kartlar, { taraf, tahsilatSekliId, policeTuruId }) {
  const aday = (kurallar || [])
    .filter(k => k.taraf === taraf
      && (!k.tahsilat_sekli_id || k.tahsilat_sekli_id === tahsilatSekliId)
      && (!k.police_turu_id || k.police_turu_id === policeTuruId))
    .sort((a, b) => (b.oncelik || 0) - (a.oncelik || 0))
  for (const k of aday) {
    const kart = (kartlar || []).find(x => x.id === k.kart_id)
    // ⚠️ Kural pasif bir karta işaret ediyor olabilir; kartlar listesi
    //    aktif=true süzgeçli geldiği için bulunamayan kuralı ATLA ve
    //    sıradakine bak. (Eski kod ilk kuralı alıp select'i boş bırakıyordu.)
    if (kart) return kart
  }
  return null
}

// odeme_kartlari için ortak select — üç ekran da AYNI alanları çeksin.
// ⚠️ sigorta-yapboz.js banka ve sahip_adi'yı çekmiyordu; kart görselinde
//    o alanlar boş çıkıyordu.
export const KART_ALANLAR = 'id, ad, sahip_tipi, sahip_adi, ilk_dort, son_dort, banka, alt_uzanti, finans_kart_id, aktif'
