// =====================================================================
// yayin-merkezi.js — YAYIN MERKEZİ (Göksenil tasarımı, 6 Ağu 2026)
//
//   "Bu modülün içinde kanal bazlı çalışırım."
//   Tümü · sahibinden.com (manuel) · ismailcalmaz.com · arabam.com (otomatik)
//
//   ⚠️ HESAP YOK, GÖSTERİM VAR. Yayın kararı, engeller ve uyarılar SUNUCUDA
//   üretilir (v_yayin_karar, sql/167). Burada tekrar hesaplanırsa iki farklı
//   doğru ortaya çıkar — ilanlar.js'te aynı kural yazılı, uyuyoruz.
//
//   Kanal doğaları BİLEREK farklı:
//     sahibinden → insan ilan girer, no'yu CRM'e yazar (İlanlarımız ekranı)
//     site/arabam → sistem feed üretir, karşı taraf çeker; elle aç/kapa YOK
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, fmtTarih, kacis, trBuyuk, dbHata } from './veri.js'
import { mat, bosDurum, uyari, cipler, kpiKart, sekmeBar, stitchTablo } from './stitch-ui.js'

const FEED_URL = 'https://gmbovpszyzssncrlfaix.supabase.co/functions/v1/stok-yayin?islem=feed'

const KANALLAR = [
  ['tumu', 'Tümü'],
  ['sahibinden', 'sahibinden.com'],
  ['site', 'ismailcalmaz.com'],
  ['arabam', 'arabam.com'],
]

let BEN = null
let kanal = 'tumu'
let sekme = ''
let V = { karar: [], is: null, yayinda: [], ilanlar: [], log: [], feed: null }

export async function yayinMerkeziKur(d) {
  BEN = d
  document.getElementById('yenile')?.addEventListener('click', yukle)

  // cipler() düğmelere data-f basar (stitch-ui.js) — data-cip DEĞİL.
  document.getElementById('kanallar').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return
    kanal = b.dataset.f; sekme = ''        // kanal değişince ilk sekmeye dön
    ciz()
  })

  // İçerik her çizimde yenilendiği için olay KAPSAYICIDA dinlenir.
  document.getElementById('icerik').addEventListener('click', e => {
    const s = e.target.closest('[data-sekme]')
    if (s) { sekme = s.dataset.sekme; ciz(); return }
    const j = e.target.closest('#feedKopyala')
    if (j) { feedKopyala(); return }
  })

  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('icerik')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'

  const [kararR, isR, yayindaR, ilanR, logR] = await Promise.all([
    supabase.from('v_yayin_karar').select('*'),
    supabase.from('v_yayin_is_listesi').select('*').maybeSingle(),
    supabase.from('v_yayin_araclari').select('arac_id, plaka, marka, model, versiyon, yil, satis_fiyati, foto_sayisi'),
    supabase.from('ilanlar').select('id, arac_id, kanal_kodu, durum, ilan_no, ilan_fiyati, yenileme_tarihi'),
    supabase.from('entegrasyon_loglari').select('fonksiyon, sonuc, hata, created_at')
      .like('fonksiyon', 'stok-yayin%').order('created_at', { ascending: false }).limit(20),
  ])
  for (const [ad, r] of [['karar', kararR], ['is listesi', isR], ['yayinda', yayindaR],
    ['ilanlar', ilanR], ['log', logR]]) {
    if (r.error) dbHata('yayin ' + ad, r.error)
  }
  if (kararR.error) {
    hedef.innerHTML = uyari('Yayın verisi okunamadı: ' + kacis(kararR.error.message))
    return
  }

  V = {
    karar: kararR.data || [], is: isR.data || null, yayinda: yayindaR.data || [],
    ilanlar: ilanR.data || [], log: logR.data || [], feed: V.feed,
  }
  document.getElementById('sayac').textContent =
    `${V.is?.site_uygun_adet ?? 0} araç yayına uygun · ${V.karar.length} araç izleniyor`
  ciz()
}

// ---------- ÇİZİM ----------
function ciz() {
  document.getElementById('kanallar').innerHTML = cipler(KANALLAR, kanal)
  kpiCiz()
  const h = document.getElementById('icerik')
  h.innerHTML = ({ tumu: tumuHtml, sahibinden: sahibindenHtml, site: siteHtml, arabam: arabamHtml }[kanal])()
}

function kpiCiz() {
  const is = V.is || {}
  const sahAktif = V.ilanlar.filter(i => i.kanal_kodu === 'SAHIBINDEN' && i.durum === 'YAYINDA').length
  const bekleyen = V.karar.filter(k => !k.site_uygun).length
  const sorunlu = V.karar.filter(k => (k.engeller || []).length >= 2).length
  // Sağlık = yayına uygun araç oranı. Tek tanım, JS'te formül tekrarı değil:
  // pay ve payda doğrudan karar motorundan geliyor.
  const saglik = V.karar.length ? Math.round((is.site_uygun_adet || 0) * 100 / V.karar.length) : null

  document.getElementById('kpi').innerHTML = [
    kpiKart('campaign', 'bg-blue-100 text-blue-700',
      sahAktif + (is.site_uygun_adet || 0), 'Aktif İlan', 'Tüm kanallar'),
    kpiKart('pending_actions', 'bg-amber-100 text-amber-700',
      bekleyen, 'Yayın Bekleyen', bekleyen ? 'Eksiği giderilmeli' : 'Bekleyen yok'),
    kpiKart('warning', 'bg-red-100 text-red-700',
      sorunlu, 'Sorunlu', sorunlu ? 'Birden fazla eksik' : 'Sorun yok'),
    kpiKart('health_and_safety', 'bg-green-100 text-green-700',
      saglik == null ? '—' : '%' + saglik, 'Yayın Sağlığı', 'Uygun / izlenen araç'),
  ].join('')
}

// ---------- TÜMÜ (dashboard) ----------
function tumuHtml() {
  const is = V.is || {}
  const sahAktif = V.ilanlar.filter(i => i.kanal_kodu === 'SAHIBINDEN' && i.durum === 'YAYINDA').length
  const sonFeed = V.log.find(l => l.fonksiyon === 'stok-yayin:feed')

  const kanalKart = (baslik, adet, birim, altEtiket, altDeger, durum, ipucu) => `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-lg custom-shadow">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-title-md font-black text-on-surface">${kacis(baslik)}</h4>
        <span class="inline-flex items-center gap-1 text-label-sm font-bold px-2 py-0.5 rounded-full ${
          durum === 'aktif' ? 'bg-secondary-container text-on-secondary-container'
          : 'bg-surface-container-high text-on-surface-variant'}">
          ${durum === 'aktif' ? '● Aktif' : '○ Kapalı'}</span>
      </div>
      <p class="text-headline-md font-black text-on-surface">${adet}<span class="text-body-md font-normal text-on-surface-variant ml-1">${kacis(birim)}</span></p>
      <div class="mt-3 pt-3 border-t border-outline-variant flex items-center justify-between text-label-md">
        <span class="text-on-surface-variant">${kacis(altEtiket)}</span>
        <span class="font-bold text-on-surface">${kacis(altDeger)}</span>
      </div>
      ${ipucu ? `<p class="mt-2 text-[11px] text-on-surface-variant">${kacis(ipucu)}</p>` : ''}
    </div>`

  const isSatir = (ikon, sayi, baslik, alt) => sayi
    ? `<div class="flex items-center gap-3 p-3 border-b border-outline-variant last:border-0">
         <span class="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center text-on-surface-variant">${mat(ikon, 'text-[20px]')}</span>
         <div class="flex-1 min-w-0">
           <p class="font-bold text-on-surface text-body-md">${sayi} ${kacis(baslik)}</p>
           <p class="text-label-sm text-on-surface-variant">${kacis(alt)}</p>
         </div></div>` : ''

  const isListesi = [
    isSatir('image_not_supported', is.fotografsiz, 'araç fotoğrafsız', 'Fotoğraf yüklenmeli'),
    isSatir('error', is.versiyonsuz, 'araç versiyon eksik', 'arabam.com kategoriyi versiyondan eşliyor'),
    isSatir('payments', is.fiyatsiz, 'araç fiyatsız', 'Fiyatlama bekliyor'),
    isSatir('inventory_2', is.durum_uygunsuz, 'araç durumu uygun değil', 'Siparişte / sanayide / şirket kullanımında'),
    isSatir('fact_check', is.ekspertizsiz, 'araç ekspertizsiz', 'Hasar/boya bilgisi gönderilemiyor'),
  ].filter(Boolean).join('')

  return `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
      ${kanalKart('sahibinden.com', sahAktif, 'ilan', 'Yönetim', 'Manuel', sahAktif ? 'aktif' : 'kapali',
        'İlan numarası elle girilir — İlanlarımız ekranından yönetilir.')}
      ${kanalKart('ismailcalmaz.com', is.site_uygun_adet ?? 0, 'araç', 'Senkron', 'KAPALI', 'kapali',
        'Site şu an Google Sheet\'ten besleniyor. Stok göçü sonrası açılacak.')}
      ${kanalKart('arabam.com', is.arabam_uygun_adet ?? 0, 'ilan', 'Son feed',
        sonFeed ? fmtTarih(sonFeed.created_at) : '—', 'aktif',
        'Feed halka açık; arabam belirli saatlerde okur.')}
    </div>

    <div class="mt-lg bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow overflow-hidden">
      <div class="px-lg py-3 border-b border-outline-variant flex items-center gap-2">
        ${mat('checklist', 'text-[20px] text-primary')}
        <h3 class="text-title-md font-black text-on-surface">Bugün Yapılacaklar</h3>
      </div>
      ${isListesi || `<div class="p-lg">${bosDurum('Eksik yok — tüm araçlar yayına uygun.', 'task_alt')}</div>`}
    </div>`
}

// ---------- SAHİBİNDEN (manuel kanal) ----------
function sahibindenHtml() {
  const aktif = V.ilanlar.filter(i => i.kanal_kodu === 'SAHIBINDEN' && i.durum === 'YAYINDA')
  return `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-lg custom-shadow">
      <div class="flex items-start gap-3">
        ${mat('touch_app', 'text-[24px] text-primary')}
        <div class="flex-1">
          <h3 class="text-title-md font-black text-on-surface">Manuel kanal</h3>
          <p class="text-body-md text-on-surface-variant mt-1">
            sahibinden.com ilanları elle giriliyor: ilan numarası, yenileme takvimi,
            kalite kontrol ve adil dağıtım <b>İlanlarımız</b> ekranından yönetiliyor.
            Şu an <b>${aktif.length}</b> aktif ilan var.
          </p>
          <a href="ilanlar.html" class="inline-flex items-center gap-1.5 mt-3 bg-primary text-on-primary px-4 py-2 rounded-lg text-label-md font-bold">
            ${mat('open_in_new', 'text-[18px]')} İlanlarımız ekranına git</a>
        </div>
      </div>
    </div>`
}

// ---------- OTOMATİK KANALLAR ----------
function otomatikSekmeler(aktifSekme) {
  return sekmeBar([
    ['yayinda', 'Yayındaki Araçlar', 'inventory_2', V.yayinda.length || null],
    ['bekleyen', 'Yayın Bekleyenler', 'pending_actions', V.karar.filter(k => !k.site_uygun).length || null],
    ['feed', 'Feed Durumu', 'rss_feed'],
  ], aktifSekme)
}

function yayindakiTablo() {
  if (!V.yayinda.length) return bosDurum('Yayına uygun araç yok.', 'inventory_2')
  // stitchTablo satırları {hucreler, git} bekler — düz dizi DEĞİL (stitch-ui.js).
  return stitchTablo(
    ['Plaka', 'Araç', 'Yıl', 'Fiyat', 'Foto'],
    V.yayinda.map(a => ({
      git: 'arac-kart.html?id=' + encodeURIComponent(a.arac_id),
      hucreler: [
        kacis(a.plaka ? trBuyuk(a.plaka) : '—'),
        kacis([a.marka, a.model, a.versiyon].filter(Boolean).join(' ')),
        kacis(String(a.yil ?? '—')),
        a.satis_fiyati != null ? fmtPara(a.satis_fiyati) : '—',
        String(a.foto_sayisi ?? 0),
      ],
    })))
}

// Yayın Karar Motoru — "neden yayında değil" tek satırda tüm kontroller
function bekleyenListe(arabamMi) {
  const liste = V.karar.filter(k => arabamMi ? !k.arabam_uygun : !k.site_uygun)
  if (!liste.length) return bosDurum('Bekleyen araç yok.', 'task_alt')

  const rozet = (tamam, etiket) => `
    <span class="inline-flex items-center gap-1 text-label-sm px-2 py-0.5 rounded-full ${
      tamam ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'}">
      ${mat(tamam ? 'check' : 'close', 'text-[14px]')}${kacis(etiket)}</span>`

  return `<div class="grid gap-md">${liste.map(k => `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-lg custom-shadow">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p class="font-black text-on-surface text-title-sm">
            ${kacis([k.marka, k.model].filter(Boolean).join(' ')) || 'Araç'}
            <span class="text-on-surface-variant font-normal">${kacis(k.plaka ? trBuyuk(k.plaka) : '')}</span>
          </p>
          <p class="text-label-sm text-on-surface-variant mt-0.5">Durum: ${kacis(k.arac_durum)}</p>
        </div>
        <a href="arac-kart.html?id=${encodeURIComponent(k.arac_id)}"
           class="text-label-md font-bold text-primary inline-flex items-center gap-1">
           ${mat('arrow_forward', 'text-[16px]')} Git</a>
      </div>

      <div class="flex flex-wrap gap-1.5 mt-3">
        ${rozet(k.k_fotograf, 'Fotoğraf' + (k.foto_adet ? ` (${k.foto_adet})` : ''))}
        ${rozet(k.k_fiyat, 'Fiyat')}
        ${rozet(k.k_durum, 'Durum')}
        ${rozet(k.k_versiyon, 'Versiyon')}
        ${rozet(k.k_ekspertiz, 'Ekspertiz')}
        ${rozet(k.k_marka_model, 'Marka/Model')}
        ${arabamMi ? rozet(k.k_yakit_eslesme, 'Yakıt eşleşmesi') : ''}
      </div>

      ${(k.engeller || []).length ? `<ul class="mt-3 space-y-1">${k.engeller.map(e =>
        `<li class="text-body-md text-error flex items-start gap-1.5">${mat('block', 'text-[16px] mt-0.5')}<span>${kacis(e)}</span></li>`).join('')}</ul>` : ''}
      ${(k.uyarilar || []).length ? `<ul class="mt-2 space-y-1">${k.uyarilar.map(u =>
        `<li class="text-label-md text-on-surface-variant flex items-start gap-1.5">${mat('info', 'text-[15px] mt-0.5')}<span>${kacis(u)}</span></li>`).join('')}</ul>` : ''}
    </div>`).join('')}</div>`
}

function feedDurumHtml(arabamMi) {
  const son = V.log.slice(0, 8)
  const gecmis = son.length
    ? stitchTablo(['Zaman', 'İşlem', 'Sonuç'], son.map(l => ({
        hucreler: [
          fmtTarih(l.created_at),
          kacis(l.fonksiyon.replace('stok-yayin:', '')),
          l.sonuc === 'OK'
            ? '<span class="text-green-700 font-bold">OK</span>'
            : `<span class="text-error font-bold">${kacis(l.hata || 'HATA')}</span>`,
        ],
      })))
    : bosDurum('Henüz feed kaydı yok.', 'rss_feed')

  const adres = arabamMi ? `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-lg custom-shadow mb-lg">
      <h4 class="text-title-sm font-black text-on-surface mb-2">Feed adresi</h4>
      <p class="text-label-sm text-on-surface-variant mb-2">arabam.com bu adresi belirli saatlerde okur. Listede olmayan ilanları pasife alır.</p>
      <div class="flex items-center gap-2 flex-wrap">
        <code class="text-[11px] bg-surface-container px-2 py-1.5 rounded break-all flex-1 min-w-[240px]">${kacis(FEED_URL)}</code>
        <button id="feedKopyala" class="bg-surface-container-low border border-outline-variant px-3 py-1.5 rounded-lg text-label-md font-bold inline-flex items-center gap-1">
          ${mat('content_copy', 'text-[16px]')} Kopyala</button>
        <a href="${kacis(FEED_URL)}" target="_blank" rel="noopener"
           class="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-label-md font-bold inline-flex items-center gap-1">
          ${mat('open_in_new', 'text-[16px]')} Aç</a>
      </div>
    </div>` : `
    <div class="uyari-kutu mb-lg text-body-md">
      <b>Site senkronu kapalı.</b> ismailcalmaz.com şu an Google Sheet'ten besleniyor (160 araç).
      CRM'de yayın şartını sağlayan ${V.is?.site_uygun_adet ?? 0} araç var; kaynağı şimdi çevirmek siteyi boşaltır.
      Stok göçü tamamlanınca <code>ayarlar.yayin_site_aktif</code> açılacak.
    </div>`

  return adres + gecmis
}

function siteHtml() {
  const s = sekme || 'yayinda'
  return otomatikSekmeler(s) + `<div class="mt-lg">${
    s === 'yayinda' ? yayindakiTablo() : s === 'bekleyen' ? bekleyenListe(false) : feedDurumHtml(false)
  }</div>`
}

function arabamHtml() {
  const s = sekme || 'feed'
  return sekmeBar([
    ['feed', 'Feed Durumu', 'rss_feed'],
    ['bekleyen', 'Yayın Bekleyenler', 'pending_actions', V.karar.filter(k => !k.arabam_uygun).length || null],
    ['yayinda', 'Feed\'deki Araçlar', 'inventory_2', V.is?.arabam_uygun_adet || null],
  ], s) + `<div class="mt-lg">${
    s === 'feed' ? feedDurumHtml(true) : s === 'bekleyen' ? bekleyenListe(true) : yayindakiTablo()
  }</div>`
}

async function feedKopyala() {
  try {
    await navigator.clipboard.writeText(FEED_URL)
    const b = document.getElementById('feedKopyala')
    if (b) { const e = b.innerHTML; b.textContent = 'Kopyalandı'; setTimeout(() => { b.innerHTML = e }, 1500) }
  } catch (e) {
    console.error('panoya kopyalanamadi', e)
    alert('Kopyalanamadı, adresi elle seçin.')
  }
}
