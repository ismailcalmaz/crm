// =====================================================================
// dms-panel.js — DMS modülü ana sayfası: OPERASYON KONTROL MERKEZİ
//
//   Göksenil'in tasarımı (1 Ağu 2026): ana sayfa bir rapor ekranı değil
//   "kokpit". Kullanıcı girdiğinde hangi araçların beklediğini, nerede
//   darboğaz olduğunu ve bugün neyin öncelikli olduğunu ANINDA görmeli.
//
//   Veri: dms_panel_ozet() RPC (sql/115) — üst şerit + akış + stok yaşı +
//   bugünkü operasyon + kritik uyarılar TEK çağrıda. Listeler ayrı select.
//
// ⚠️ ROL KAPISI (Göksenil'in verdiği): Bugün Yapılacaklar · Hızlı İşlemler ·
//    Kritik Uyarılar YALNIZ bilgi işlem + yönetici. Kalan bölümler herkese,
//    ve herkese GALERİ GENELİ gösterilir (danışman da toplamı görür).
// ⚠️ FİYAT GİZLİLİĞİ: bu sayfa hiçbir yerde satış/min fiyat/maliyet ÇEKMEZ.
//    RLS satır düzeyindedir, KOLON GİZLEYEMEZ — danışmana gidecek sorguya o
//    alanları hiç koymuyoruz.
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, danismanAdi, kacis, buyuk, dbHata, fmtTarihKisa,
         olayAdi, olayDetay, olaySistemMi, AI_SISTEM } from './veri.js'
import { mat, kpiKart, sayfaBaslik, bosDurum, stitchTablo, durumCip, toast } from './stitch-ui.js'
// Yükleme mantığı BURAYA KOPYALANMAZ — arac-dosya.js tek kaynak (7 Ağu 2026).
import { evrakiYukle, fotograflariYukle } from './arac-dosya.js'
// Evrak Talebi kartı da KOPYALANMIYOR — evrak-takip.js tek kaynak; home.js
// ile birebir aynı üç fonksiyon çağrılıyor (Göksenil, 22 Ağu 2026).
import { evrakTakipEder } from './yetki.js'
import { evrakListesiOku, evrakOzetHtml, evrakPopupGoster } from './evrak-takip.js'

let OZET = null, DMAP = {}, BEN = null

// Yönetim görünürlüğü — tek yerde tanımlı, üç bölüm de bunu kullanır.
const yonetimGorur = d => !!(d?.master_admin || d?.rol === 'yonetici' || d?.rol === 'bilgi_islem')
const say = n => Number(n || 0).toLocaleString('tr-TR')

// ---------------------------------------------------------------------
// Ana ızgara — kolon sayısı ROLE göre değişir çünkü kart sayısı değişiyor:
// yönetim 8 kart görür (4 kolona tam oturur), diğer roller 5 kart (3 kolon).
// Sabit 4 kolon kullanılsaydı danışmanın ekranında satır sonu boş kalırdı.
//
// ⚠️ min-[1800px] özel kırılma noktası: Tailwind'in 2xl'i 1536px ve bu ekranda
//    4 kolon henüz dar kalıyor. Canlıda ölçüldü (7 Ağu 2026).
// ⚠️ Sınıf adları BÜTÜN yazılmalı — Tailwind CDN'i DOM'u tarayarak sınıf
//    üretiyor, `col-span-${n}` gibi birleştirilmiş adları göremez.
// ⚠️ `tam` span'i ROLE bağlı: 3 kolonlu ızgarada `col-span-4` istemek CSS
//    Grid'e ÖRTÜK bir 4. kolon açtırır ve kart ızgaradan taşar.
const IZGARA = {
  yonetim: {
    kolon: 'grid-cols-1 lg:grid-cols-2 min-[1800px]:grid-cols-4',
    genis: 'lg:col-span-2 min-[1800px]:col-span-2',
    tam:   'lg:col-span-2 min-[1800px]:col-span-4',
  },
  diger: {
    kolon: 'grid-cols-1 lg:grid-cols-2 min-[1800px]:grid-cols-3',
    genis: 'lg:col-span-2 min-[1800px]:col-span-2',
    tam:   'lg:col-span-2 min-[1800px]:col-span-3',
  },
}

// Izgara hücresi. Sarmalayıcı `display:grid` olduğu için içindeki kart
// SATIR YÜKSEKLİĞİNE kadar uzar. Eski düzende `items-start` vardı ve kartların
// alt kenarları tırtıklı kalıyordu — canlı ölçümde tek ekranda ~550px ölü
// dikey alan çıktı (192+203+77+80). "Düzensiz duruyor" şikâyetinin kaynağı buydu.
const hucre = (icerik, span) => icerik ? `<div class="grid ${span || ''}">${icerik}</div>` : ''

// Akış şeridi: 9 adım. Durum adları/sırası arac_durum_tanim'dan gelir (tek
// gerçek kaynak); burada yalnız hangi durumun hangi adıma toplandığı yazılı.
// ⚠️ Sıra durum makinesinin KENDİ sırası (Göksenil kararı) → oklar hep ileri akar.
const AKIS_ADIM = [
  { ad: 'Araç Kabul',  ikon: 'add_road',       kodlar: ['ALIS_ADAYI', 'ALIS_ONAY_BEKLIYOR', 'SIGORTA_BEKLIYOR', 'NOTER_DEVRI', 'ALINDI'] },
  { ad: 'Ekspertiz',   ikon: 'search',         kodlar: ['EKSPERTIZ_BEKLIYOR', 'EKSPERTIZ_TAMAMLANDI'] },
  { ad: 'Fiyatlama',   ikon: 'sell',           kodlar: ['FIYATLANDIRMA_BEKLIYOR'] },
  { ad: 'Stok',        ikon: 'warehouse',      kodlar: ['STOKTA'] },
  { ad: 'Operasyon',   ikon: 'build',          kodlar: ['SANAYIDE', 'PARCA_BEKLIYOR', 'HAZIRLIK'] },
  { ad: 'Fotoğraf',    ikon: 'photo_camera',   kodlar: ['FOTOGRAF_BEKLIYOR'] },
  { ad: 'İlan',        ikon: 'public',         kodlar: ['YAYINDA'] },
  { ad: 'Rezervasyon', ikon: 'bookmark',       kodlar: ['REZERVE', 'SIPARISTE'] },
  { ad: 'Teslim',      ikon: 'local_shipping', kodlar: ['TESLIME_HAZIR'] },
]

// =====================================================================
// Giriş
// =====================================================================
export async function dmsPanelKur(d) {
  const kok = document.getElementById('kok')
  kok.innerHTML = `<div class="py-24 text-center text-on-surface-variant">
    ${mat('progress_activity', 'animate-spin text-4xl')}<p class="mt-3 text-body-md">Panel yükleniyor…</p></div>`

  BEN = d
  const yonetim = yonetimGorur(d)
  const IZ = yonetim ? IZGARA.yonetim : IZGARA.diger

  const [ozetR, dmap, araclarR, olaylarR, yapilacakR, yukR, kisiR, evrakR] = await Promise.all([
    supabase.rpc('dms_panel_ozet'),
    danismanMap(),
    sonAraclarCek(),
    sonIslemlerCek(),
    yonetim ? yapilacaklarCek() : Promise.resolve({ data: [], error: null }),
    personelYukCek(),
    satisDanismanlariCek(),
    // Evrak Talebi — Göksenil (22 Ağu 2026): "ben ve bilgi işlem DMS tarafında
    //   çalıştığımız için o tarafta görmemiz gerekiyor."
    // ⚠️ Yetkisi olmayan için SORGU HİÇ ATILMIYOR: v_evrak_takip'in RLS'i zaten
    //   boş döndürürdü ama gereksiz istek gitmesin ve "veri yok" ile "yetkin
    //   yok" karışmasın (dms-panel'deki diğer bölümlerin deseni).
    evrakTakipEder(d) ? evrakListesiOku() : Promise.resolve({ satirlar: [] }),
  ])

  // §5 — her çağrıda error kontrolü, istisnasız
  if (ozetR.error) { dbHata('dms panel özet', ozetR.error); kok.innerHTML = hataKutu(ozetR.error.message); return }
  OZET = ozetR.data || {}
  DMAP = dmap || {}
  dbHata('dms son araçlar', araclarR.error)
  dbHata('dms son işlemler', olaylarR.error)
  dbHata('dms bugün yapılacaklar', yapilacakR.error)
  dbHata('dms personel iş yükü', yukR.error)
  dbHata('dms satış danışmanları', kisiR.error)

  kok.innerHTML = `
    <div class="space-y-lg">
      ${sayfaBaslik('Operasyon Kontrol Merkezi',
        'Tüm araç operasyonlarını tek ekrandan yönet.',
        `<span class="text-body-sm text-on-surface-variant">${kacis(uzunTarih())}</span>`)}

      ${/* Evrak Talebi — başlığın hemen altında, home.js ile AYNI konumda.
            Izgaraya değil dikey yığına giriyor: kart tam genişlikte bir
            <section> ve ızgara hücresine sokulursa diğer kartların yüksekliğini
            bozar. Boş listede evrakOzetHtml zaten '' döndürür. */''}
      ${evrakOzetHtml(evrakR?.satirlar || [])}

      ${kpiSerit()}

      ${akisKart()}

      <div class="grid gap-lg ${IZ.kolon}">
        ${yonetim ? hucre(yapilacaklarKart(yapilacakR.data || [])) : ''}
        ${yonetim ? hucre(kritikKart()) : ''}
        ${yonetim ? hucre(hizliIslemlerKart()) : ''}
        ${hucre(stokYasiKart())}
        ${hucre(bugunkuOperasyonKart())}
        ${hucre(sonIslemlerKart(olaylarR.data || []))}
        ${hucre(sonAraclarKart(araclarR.data || []), yonetim ? IZ.genis : IZ.tam)}
        ${hucre(personelYukKart(yukR.data || [], kisiR.data || []), IZ.tam)}
      </div>
    </div>`

  donutCiz()
  // ⚠️ Pop-up talep başına BİR KEZ çıkar (localStorage'da "görüldü" işareti).
  //   home.js'te de aynı çağrı var; hangi sayfa önce açılırsa orada çıkar,
  //   ikinci kez çıkmaz. Kalıcı ÖZET KART ise iki sayfada da durur — asıl
  //   istenen buydu, kaçırılmasın.
  evrakPopupGoster(evrakR?.satirlar || [])
  // Kritik uyarı satırları → pop-up (delegasyon değil; kart tek sefer çiziliyor)
  document.querySelectorAll('button[data-kritik]').forEach(b =>
    b.addEventListener('click', () => kritikPencereAc(b.dataset.kritik, b.dataset.metin)))
}

const hataKutu = m => `<div class="bg-error-container text-on-error-container rounded-xl p-lg">
  Panel verisi alınamadı: ${kacis(m)}</div>`

function uzunTarih() {
  return new Date().toLocaleDateString('tr-TR',
    { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })
}

// =====================================================================
// Veri çekiciler
// =====================================================================
function sonAraclarCek() {
  return supabase.from('stok_araclar')
    .select('id, plaka, marka, model, durum, created_at, olusturan')
    .order('created_at', { ascending: false }).limit(8)
}

// `veri` ALINIYOR: olayın NE olduğunu yazabilmek için (eski→yeni durum,
// TSB özeti…). Onsuz satırda yalnız "Araç durumu değişti" yazıyordu ve
// neyin neye döndüğü hiçbir yerde görünmüyordu (Göksenil, 7 Ağu 2026).
function sonIslemlerCek() {
  return supabase.from('olaylar')
    .select('id, tip, veri, olusma_zamani, danisman_id, arac_id, stok_araclar(plaka)')
    .order('olusma_zamani', { ascending: false }).limit(8)
}

// Bugün yapılacaklar = eksiği olan araçlar.
// ⚠️ Tasarımda saat vardı ("09:00 ekspertiz bekliyor") ama sistemde RANDEVU/SAAT
//    kavramı YOK. Uydurma saat basmaktansa eksiğin kendisini yazıyoruz.
// ⚠️ RUHSAT `stok_araclar.ruhsat_url`'DEN OKUNMAZ. O kolon hiçbir yerde
//    YAZILMIYOR — canlıda 5 aracın 5'inde de NULL (7 Ağu 2026 ölçümü).
//    Ruhsat `arac_evraklar` içinde tip='RUHSAT' satırıdır. Eski kod kolona
//    baktığı için ruhsatı YÜKLÜ araçlara "Ruhsat yüklenmedi" diyordu
//    (48AYH876 tam olarak bu). dms_panel_ozet() RPC'si zaten doğru bakıyordu;
//    tutarsızlık buradaydı.
function yapilacaklarCek() {
  return supabase.from('stok_araclar')
    .select('id, plaka, durum, fiyatlama_durumu, ruhsat_url, created_at, arac_evraklar(tip)')
    .in('durum', ['ALINDI', 'STOKTA', 'YAYINDA', 'FIYATLANDIRMA_BEKLIYOR', 'FOTOGRAF_BEKLIYOR'])
    .order('created_at', { ascending: true }).limit(60)
}

// Ruhsat var mı? — kolon YA DA evrak satırı (RPC ile aynı kural).
const ruhsatVar = a => !!a.ruhsat_url ||
  (a.arac_evraklar || []).some(e => String(e.tip).toUpperCase() === 'RUHSAT')

// Aktif satış danışmanları. danismanMap() `aktif` alanını GETİRMEZ; onunla
// filtrelersek ayrılmış personel de panelde listelenirdi — ayrı çekiyoruz.
function satisDanismanlariCek() {
  return supabase.from('danismanlar')
    .select('id, ad_soyad')
    .eq('aktif', true).eq('rol', 'danisman')
    .order('ad_soyad')
}

// Personel iş yükü: danışman bazlı SATIŞ adedi (bugün / bu ay / bu yıl).
// ⚠️ BUGÜN 0 GÖSTERİR — bilinen ve kabul edilmiş durum (Göksenil: "sen bugün
//    kuracaksın rakamlar 0 gösterecek, backendi Bahadır'la kuracağız").
//    Satışlar hâlâ eski DMS'te yapılıyor; guncel_satislar'da danışman kolonu YOK.
function personelYukCek() {
  const yil = new Date().getFullYear()
  return supabase.from('siparisler')
    .select('danisman_id, created_at')
    .eq('durum', 'ACIK')
    .gte('created_at', `${yil}-01-01`)
    .limit(1000)
}

// =====================================================================
// Üst şerit — 6 KPI
// =====================================================================
function kpiSerit() {
  const k = OZET.kpi || {}
  const b = OZET.bugun || {}
  return `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-md">
    ${kpiKart('directions_car', 'bg-primary/10 text-primary', say(k.aktif_stok), 'Aktif Stok', 'Stokta + yayında')}
    ${kpiKart('car_rental', 'bg-green-100 text-green-700', say(k.bugun_gelen), 'Bugün Gelen Araç', 'Araç kabule eklenen')}
    ${kpiKart('hourglass_top', 'bg-amber-100 text-amber-700', say(k.islem_bekleyen), 'İşlem Bekleyen', 'Sanayi · parça · hazırlık')}
    ${kpiKart('photo_camera', 'bg-indigo-100 text-indigo-700', say(k.ilan_bekleyen), 'İlan Bekleyen', 'Fotoğrafı olmayan')}
    ${kpiKart('sell', 'bg-sky-100 text-sky-700', say(k.fiyat_bekleyen), 'Fiyat Bekleyen', 'Fiyatlanmamış araç')}
    ${kpiKart('task_alt', 'bg-teal-100 text-teal-700', say(k.teslime_hazir), 'Teslime Hazır', `Bugün ${say(b.teslim)} teslim`)}
  </div>`
}

// =====================================================================
// Araç İş Akışı
// =====================================================================
function akisKart() {
  const akis = OZET.akis || []
  const sayiOf = kod => Number(akis.find(a => a.kod === kod)?.sayi || 0)
  const adimlar = AKIS_ADIM.map(a => ({ ...a, sayi: a.kodlar.reduce((t, k) => t + sayiOf(k), 0) }))
  const enBuyuk = Math.max(1, ...adimlar.map(a => a.sayi))

  // ⚠️ ESKİDEN TEK SATIR + YATAY KAYDIRMA İDİ. 9 adım × 94px = 846px; kart
  //    hiçbir ekranda o kadar geniş değil, bu yüzden kaydırma çubuğu çıkıyor,
  //    son adımlar görünmüyor ve kartın altı boş kalıyordu (Göksenil,
  //    7 Ağu 2026: "sağa doğru kaydırmalı olmuş, altı boş").
  //    Artık 3 sütunlu ızgara: 9 adım = tam 3 satır, kaydırma YOK, kart dolu.
  // ⚠️ Ok işareti KALDIRILDI, yerine SIRA NUMARASI kondu. Izgarada satır
  //    sonundaki ok "bir sonraki" yerine boşluğu gösterip akışı yanlış
  //    anlatıyordu; numara sırayı ok olmadan da okutur.
  const kutu = (a, i) => `
    <a href="stok.html?durum=${encodeURIComponent(a.kodlar.join(','))}"
       class="group flex items-center gap-3 p-2.5 rounded-xl border border-outline-variant
              hover:border-primary hover:bg-primary/5 transition-colors"
       title="${kacis(a.ad)} — listeyi aç">
      <span class="relative shrink-0">
        <span class="w-11 h-11 rounded-full border border-outline-variant flex items-center justify-center
                     text-on-surface-variant group-hover:border-primary group-hover:text-primary transition-colors">
          ${mat(a.ikon, 'text-[20px]')}</span>
        <span class="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-surface-container text-on-surface-variant
                     text-[9px] font-black flex items-center justify-center">${i + 1}</span>
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <span class="text-xl font-black text-on-surface leading-none">${say(a.sayi)}</span>
          <span class="text-label-sm text-on-surface-variant truncate">${kacis(a.ad)}</span>
        </span>
        <span class="block w-full h-1 rounded-full bg-surface-container overflow-hidden mt-1.5">
          <span class="block h-full bg-primary" style="width:${Math.round(a.sayi / enBuyuk * 100)}%"></span></span>
      </span>
    </a>`

  // 9 adım geniş ekranda TEK SIRA. Bu bir boru hattı; 3x3 ızgara olarak
  // okunmuyordu ve kartın sağında ölü alan bırakıyordu. min-[1800px]'de adım
  // başına ~260px düşüyor (canlı ölçüm) — ikon + sayı + etiket + doluluk
  // çubuğu rahat sığıyor. Daha dar ekranda 9 kolon 150px'e iniyor ve etiketler
  // kırpılıyor, o yüzden kademeli: 1 → 2 → 3 → 5 → 9.
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow p-lg">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-title-md font-bold">Araç İş Akışı</h3>
      <span class="text-label-sm text-on-surface-variant hidden sm:block">Adıma tıkla → liste açılır</span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 min-[1800px]:grid-cols-9 gap-2">${adimlar.map(kutu).join('')}</div>
  </div>`
}

// =====================================================================
// Bugün Yapılacaklar (yalnız yönetim + bilgi işlem)
// =====================================================================
function yapilacaklarKart(rows) {
  const isler = []
  for (const a of rows) {
    if (isler.length >= 8) break
    if (a.fiyatlama_durumu === 'BEKLIYOR') isler.push({ a, is: 'Fiyat girilecek', renk: 'bg-sky-500' })
    else if (a.durum === 'FOTOGRAF_BEKLIYOR') isler.push({ a, is: 'Fotoğraf çekilecek', renk: 'bg-indigo-500' })
    else if (!ruhsatVar(a)) isler.push({ a, is: 'Ruhsat yüklenmedi', renk: 'bg-amber-500' })
  }
  // ⚠️ Bağlantı `?id=` DEĞİL `?ref=` — arac-detay.js urlParam('ref') okur.
  //    `?id=` ile açılan sayfa aracı bulamıyor, boş açılıyordu.
  const govde = isler.length
    ? isler.map(x => `<a href="arac-detay.html?ref=${encodeURIComponent(x.a.id)}"
        class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0
               hover:bg-surface-container-low rounded-lg px-2 -mx-2 transition-colors">
        <span class="w-2 h-2 rounded-full ${x.renk} shrink-0"></span>
        <span class="font-mono text-label-md font-bold bg-surface-container px-2 py-0.5 rounded shrink-0">${kacis(x.a.plaka || '—')}</span>
        <span class="text-body-sm text-on-surface-variant flex-1 min-w-0 truncate">${kacis(x.is)}</span>
        ${mat('chevron_right', 'text-[18px] text-outline shrink-0')}</a>`).join('')
    : `<div class="text-body-sm text-on-surface-variant py-6 text-center">Bekleyen iş yok.</div>`

  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow p-lg">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-title-md font-bold">Bugün Yapılacaklar</h3>
      <span class="text-label-sm font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">${isler.length}</span>
    </div>${govde}</div>`
}

// =====================================================================
// Hızlı İşlemler (yalnız yönetim + bilgi işlem)
// =====================================================================
function hizliIslemlerKart() {
  const eylem = (ikon, metin, href) => `<a href="${href}"
    class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-outline-variant
           hover:border-primary hover:bg-primary/5 transition-colors">
    ${mat(ikon, 'text-[19px] text-primary')}<span class="text-label-md font-medium">${metin}</span></a>`
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow p-lg">
    <h3 class="text-title-md font-bold mb-3">Hızlı İşlemler</h3>
    <div class="space-y-2">
      ${/* Sıra iş akışını izler: aracı kabul et → listesini aç → fiyatla →
            ilana ver → stokta izle. "Araç Kabul Merkezi" en altta duruyordu,
            oysa yeni kabulden hemen sonra gidilen yer orası (Göksenil). */''}
      ${eylem('add', 'Yeni Araç Kabul', 'arac-kabul-yeni.html')}
      ${eylem('assignment_turned_in', 'Araç Kabul Merkezi', 'arac-kabul.html')}
      ${eylem('sell', 'Fiyatlandır', 'fiyatlama.html')}
      ${eylem('public', 'İlan Yayınla', 'ilanlar.html')}
      ${eylem('warehouse', 'Stok Merkezi', 'stok.html')}
    </div></div>`
}

// =====================================================================
// Stok Yaşı Analizi (herkes)
// =====================================================================
const YAS_RENK = ['#7c6cf5', '#12b3a8', '#f5a524', '#f97316', '#9ca3af']

function stokYasiKart() {
  const sy = OZET.stok_yasi || {}
  const dil = sy.dilimler || []
  const toplam = dil.reduce((t, x) => t + Number(x.sayi || 0), 0)
  const liste = dil.map((x, i) => `<div class="flex items-center gap-2 text-body-sm">
      <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${YAS_RENK[i]}"></span>
      <span class="flex-1 text-on-surface-variant">${kacis(x.etiket)}</span>
      <span class="font-bold">${say(x.sayi)}</span>
      <span class="text-on-surface-variant w-10 text-right">%${toplam ? Math.round(x.sayi / toplam * 100) : 0}</span>
    </div>`).join('')

  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow p-lg">
    <h3 class="text-title-md font-bold mb-3">Stok Yaşı Analizi</h3>
    <div class="flex items-center gap-4">
      <div class="relative w-[132px] h-[132px] shrink-0">
        <canvas id="yasDonut" width="132" height="132"></canvas>
        <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span class="text-[10px] text-on-surface-variant">Ortalama</span>
          <span class="text-2xl font-black leading-none">${say(sy.ortalama)}</span>
          <span class="text-[10px] text-on-surface-variant">gün</span>
        </div>
      </div>
      <div class="flex-1 space-y-1.5 min-w-0">${liste}</div>
    </div>
    <div class="mt-3 pt-3 border-t border-outline-variant text-body-sm text-on-surface-variant">
      En yaşlı araç: <b class="text-on-surface">${say(sy.en_yasli)} gün</b>${sy.en_yasli_plaka ? ` · ${kacis(sy.en_yasli_plaka)}` : ''}
    </div></div>`
}

function donutCiz() {
  const el = document.getElementById('yasDonut')
  if (!el || typeof Chart === 'undefined') return
  const dil = (OZET.stok_yasi && OZET.stok_yasi.dilimler) || []
  if (!dil.some(x => Number(x.sayi) > 0)) return
  // eslint-disable-next-line no-undef
  new Chart(el, {
    type: 'doughnut',
    data: {
      labels: dil.map(x => x.etiket),
      datasets: [{ data: dil.map(x => Number(x.sayi || 0)), backgroundColor: YAS_RENK, borderWidth: 0 }],
    },
    options: { cutout: '72%', plugins: { legend: { display: false } }, responsive: false },
  })
}

// =====================================================================
// Bugünkü Operasyon (herkes)
// =====================================================================
function bugunkuOperasyonKart() {
  const b = OZET.bugun || {}
  const satir = (ikon, ad, deger) => `<div class="flex items-center gap-3 py-2 border-b border-outline-variant/40 last:border-0">
      ${mat(ikon, 'text-[18px] text-on-surface-variant')}
      <span class="flex-1 text-body-sm">${ad}</span>
      <span class="text-lg font-black">${say(deger)}</span></div>`
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow p-lg">
    <h3 class="text-title-md font-bold mb-2">Bugünkü Operasyon</h3>
    ${satir('car_rental', 'Araç Girişi', b.arac_girisi)}
    ${satir('search', 'Ekspertiz', b.ekspertiz)}
    ${satir('sell', 'Fiyatlama', b.fiyatlama)}
    ${satir('public', 'İlan', b.ilan)}
    ${satir('handshake', 'Satılan', b.satilan)}
    ${satir('local_shipping', 'Teslim', b.teslim)}
  </div>`
}

// =====================================================================
// Kritik Uyarılar (yalnız yönetim + bilgi işlem)
// =====================================================================
// Her uyarı kodunun ÇÖZÜM adresi. Göksenil (7 Ağu 2026): "üzerine
// tıkladığımda pop up şeklinde bilgi vermeli, hemen çözüm için pop up'ta
// aksiyon alınmalı." Sayıyı görüp hangi araç olduğunu bulmak için Stok
// Merkezi'nde tek tek aramak gerekiyordu.
// ⚠️ Aksiyon = düzeltmenin YAPILDIĞI ekrana tek tıkla gitmek. Dosya yükleme
//    (ruhsat/fotoğraf) ve fiyat girişi kendi formlarında yaşıyor; onların
//    ikinci bir kopyasını buraya yazmak bu projenin en sık hatası (§4).
// ⚠️ İKİ TÜR AKSİYON VAR:
//   `yukle` → dosya SEÇİLİR ve pop-up'ın İÇİNDE yüklenir (ruhsat, fotoğraf).
//             Yükleme mantığı arac-dosya.js'ten gelir; buraya kopyalanmaz.
//   `bag`   → düzeltme bir formda yapılıyorsa o ekrana götürür (fiyat,
//             ekspertiz şeması). O formların ikinci kopyasını buraya
//             yazmak, birleştirmek için uğraştığımız hatanın ta kendisi.
const KRITIK_AKSIYON = {
  FIYAT_GECIKTI: { et: 'Fiyatla', ik: 'sell', bag: () => 'fiyatlama.html' },
  EKSPERTIZ_YOK: { et: 'Ekspertiz gir', ik: 'assignment', bag: a => `arac-detay.html?ref=${encodeURIComponent(a.id)}` },
  FOTO_YOK: {
    et: 'Fotoğraf yükle', ik: 'photo_camera', kabul: 'image/*', coklu: true,
    yukle: async (a, dosyalar) => {
      const { eklenen, hata } = await fotograflariYukle({
        aracId: a.id, dosyalar, baslangicSira: 0, yukleyen: BEN?.id || null,
      })
      return eklenen
        ? { ok: true, msg: `${eklenen} fotoğraf yüklendi.` }
        : { ok: false, msg: `Yüklenemedi${hata ? ` (${hata} hata)` : ''} — yetki: medya yöneticisi.` }
    },
  },
  RUHSAT_YOK: {
    et: 'Ruhsat yükle', ik: 'upload_file', kabul: 'image/*,application/pdf',
    yukle: async (a, dosyalar) => {
      const r = await evrakiYukle({ aracId: a.id, tip: 'RUHSAT', dosya: dosyalar[0] })
      return r.ok ? { ok: true, msg: 'Ruhsat yüklendi.' } : { ok: false, msg: r.msg }
    },
  },
}

function kritikKart() {
  const kr = (OZET.kritik || []).filter(x => Number(x.sayi) > 0)
  const govde = kr.length
    ? kr.map(x => {
        const uyari = x.seviye === 'uyari'
        return `<button type="button" data-kritik="${kacis(x.kod)}" data-metin="${kacis(x.metin)}"
          class="w-full text-left flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0
                 hover:bg-surface-container-low rounded-lg px-2 -mx-2 transition-colors">
          ${mat(uyari ? 'warning' : 'info', `text-[19px] ${uyari ? 'text-[#B45309]' : 'text-sky-600'} shrink-0`)}
          <span class="min-w-0 flex-1">
            <span class="block text-label-md font-bold ${uyari ? 'text-[#B45309]' : 'text-sky-700'}">${say(x.sayi)} araç</span>
            <span class="block text-body-sm text-on-surface-variant">${kacis(x.metin)}</span>
          </span>
          ${mat('chevron_right', 'text-[18px] text-outline shrink-0')}
        </button>`
      }).join('')
    : `<div class="text-body-sm text-on-surface-variant py-6 text-center">Kritik uyarı yok.</div>`
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow p-lg">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-title-md font-bold">Kritik Uyarılar</h3>
      <span class="text-label-sm font-bold bg-error-container text-on-error-container px-2 py-0.5 rounded-full">${kr.length}</span>
    </div>${govde}</div>`
}

// Uyarıya konu araçlar. Kurallar dms_panel_ozet() RPC'siyle BİREBİR AYNI
// olmalı — ayrışırsa "3 araç" yazıp pop-up'ta 2 araç listelenir.
async function kritikAraclarCek(kod) {
  if (kod === 'FIYAT_GECIKTI') {
    const sinir = new Date(Date.now() - 7 * 86400000).toISOString()
    return supabase.from('stok_araclar')
      .select('id, plaka, marka, model, created_at')
      .eq('fiyatlama_durumu', 'BEKLIYOR').lt('created_at', sinir)
      .order('created_at').limit(200)
  }
  // Kalan üçü "aktif stok" (STOKTA + YAYINDA) üzerinde eksik arar.
  return supabase.from('stok_araclar')
    .select('id, plaka, marka, model, created_at, ruhsat_url, ekspertiz_orijinal, arac_ekspertiz(id), arac_fotograflari(id), arac_evraklar(tip)')
    .in('durum', ['STOKTA', 'YAYINDA']).order('created_at').limit(500)
}

const KRITIK_SUZ = {
  EKSPERTIZ_YOK: a => !(a.arac_ekspertiz || []).length && !a.ekspertiz_orijinal,
  FOTO_YOK: a => !(a.arac_fotograflari || []).length,
  RUHSAT_YOK: a => !ruhsatVar(a),
  FIYAT_GECIKTI: () => true,
}

async function kritikPencereAc(kod, metin) {
  const aks = KRITIK_AKSIYON[kod]
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4'
  ov.innerHTML = `
    <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
    <div class="relative bg-surface-container-lowest w-full max-w-[560px] rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
      <div class="px-5 py-4 border-b border-outline-variant flex items-start gap-3">
        ${mat('warning', 'text-[22px] text-[#B45309] shrink-0')}
        <div class="min-w-0 flex-1">
          <h3 class="text-title-lg font-bold text-on-surface">${kacis(metin)}</h3>
          <p class="text-[12px] text-on-surface-variant mt-0.5">Sağdaki düğme düzeltmenin yapıldığı ekranı açar.</p>
        </div>
        <button id="krKapat" class="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant shrink-0">${mat('close', 'text-[20px]')}</button>
      </div>
      <div id="krListe" class="flex-1 overflow-y-auto px-4 py-3 min-h-[120px]">
        <div class="text-body-sm text-on-surface-variant py-6 text-center">Yükleniyor…</div>
      </div>
    </div>`
  document.body.appendChild(ov)
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  document.addEventListener('keydown', esc)
  ov.querySelector('.absolute').addEventListener('click', kapat)
  ov.querySelector('#krKapat').addEventListener('click', kapat)

  const liste = ov.querySelector('#krListe')
  const { data, error } = await kritikAraclarCek(kod)
  if (error) {
    dbHata('kritik uyarı listesi', error)
    liste.innerHTML = `<div class="text-body-sm text-error py-6 text-center">Liste okunamadı: ${kacis(error.message)}</div>`
    return
  }
  const araclar = (data || []).filter(KRITIK_SUZ[kod] || (() => true))
  if (!araclar.length) {
    liste.innerHTML = `<div class="text-body-sm text-on-surface-variant py-6 text-center">Bu uyarıya giren araç kalmamış.</div>`
    return
  }
  const gun = t => Math.max(0, Math.floor((Date.now() - new Date(t)) / 86400000))
  const dugme = a => aks.yukle
    // Dosya seçimi <label>+gizli input ile: <button> içine input konulamaz.
    // ⚠️ Görünen metin AYRI bir <span> — durum yazarken label.textContent'e
    //    yazmak input'u da siler ve düğme bir daha çalışmaz.
    ? `<label class="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg cursor-pointer
                     bg-primary text-on-primary text-[12px] font-bold hover:opacity-90">
         ${mat(aks.ik, 'text-[15px]')}<span data-et>${aks.et}</span>
         <input type="file" class="hidden" data-yukle="${kacis(a.id)}"
                accept="${kacis(aks.kabul)}" ${aks.coklu ? 'multiple' : ''} /></label>`
    : `<a href="${aks.bag(a)}" class="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg
         bg-primary text-on-primary text-[12px] font-bold hover:opacity-90">
         ${mat(aks.ik, 'text-[15px]')} ${aks.et}</a>`

  liste.innerHTML = araclar.map(a => `
    <div id="kr-${kacis(a.id)}" class="flex items-center gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
      <span class="font-mono text-label-md font-bold bg-surface-container px-2 py-0.5 rounded shrink-0">${kacis(a.plaka || '—')}</span>
      <span class="min-w-0 flex-1">
        <span class="block text-body-sm truncate">${kacis(buyuk([a.marka, a.model].filter(Boolean).join(' ')) || '—')}</span>
        <span class="block text-[11px] text-on-surface-variant">${gun(a.created_at)} gündür stokta</span>
      </span>
      ${dugme(a)}
    </div>`).join('')

  if (!aks.yukle) return
  // Pop-up İÇİNDE yükleme. Satır, sonucu kendi üstünde gösterir; pencere
  // kapanmaz ki arka arkaya birkaç araç halledilebilsin.
  liste.querySelectorAll('input[data-yukle]').forEach(inp => {
    inp.addEventListener('change', async e => {
      const dosyalar = [...(e.target.files || [])]
      if (!dosyalar.length) return
      const a = araclar.find(x => x.id === inp.dataset.yukle)
      const satir = liste.querySelector('#kr-' + CSS.escape(inp.dataset.yukle))
      const etiket = inp.closest('label')
      const et = etiket?.querySelector('[data-et]')
      const kilit = k => { etiket?.classList.toggle('opacity-60', k); etiket?.classList.toggle('pointer-events-none', k) }
      kilit(true); if (et) et.textContent = 'Yükleniyor…'
      const r = await aks.yukle(a, dosyalar)
      if (r.ok) {
        // Satırı "tamam"a çevir — sayfayı yeniden çizmiyoruz ki kullanıcı
        // listenin neresinde kaldığını kaybetmesin.
        if (satir) satir.innerHTML = `<span class="font-mono text-label-md font-bold bg-surface-container px-2 py-0.5 rounded">${kacis(a.plaka || '—')}</span>
          <span class="flex-1 text-body-sm text-[#047857] font-semibold flex items-center gap-1">${mat('check_circle', 'text-[16px]')} ${kacis(r.msg)}</span>`
        toast(`${a.plaka || 'Araç'} — ${r.msg}`)
      } else {
        // Aynı dosya tekrar seçilebilsin diye value sıfırlanır; aksi halde
        // 'change' olayı bir daha tetiklenmez ve düğme ölü görünür.
        kilit(false); if (et) et.textContent = aks.et; inp.value = ''
        toast(r.msg, false)
      }
    })
  })
}

// =====================================================================
// Son Eklenen Araçlar (herkes · galeri geneli)
// =====================================================================
function sonAraclarKart(rows) {
  const govde = rows.length
    // ⚠️ stitchTablo satırları {hucreler:[...]} bekler — düz dizi verilirse
    //    "Cannot read properties of undefined (reading 'map')" ile patlar.
    ? stitchTablo(['Plaka', 'Model', 'Durum', 'Sorumlu', 'Eklenme'],
        rows.map(a => ({
          git: `arac-detay.html?ref=${encodeURIComponent(a.id)}`,   // ?id= DEĞİL — bkz. yapilacaklarKart
          hucreler: [
            `<span class="font-mono font-bold">${kacis(a.plaka || '—')}</span>`,
            kacis(buyuk([a.marka, a.model].filter(Boolean).join(' ')) || '—'),
            durumEtiket(a.durum),
            kacis(danismanAdi(DMAP, a.olusturan) || '—'),
            kacis(fmtTarihKisa(a.created_at)),
          ],
        })))
    : bosDurum('Henüz araç eklenmemiş.', 'directions_car')
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow overflow-hidden">
    <div class="p-lg pb-3"><h3 class="text-title-md font-bold">Son Eklenen Araçlar</h3></div>
    ${govde}</div>`
}

// Durum adı/rengi: ad ve grup arac_durum_tanim'dan (özet içinde) gelir.
function durumEtiket(kod) {
  const a = (OZET.akis || []).find(x => x.kod === kod)
  const ad = (a && a.ad) || kod || '—'
  const g = a && a.grup
  const [cls, nokta] =
    g === 'SATIS' ? ['bg-green-100 text-green-800', 'bg-green-500']
    : g === 'OPERASYON' ? ['bg-amber-100 text-amber-800', 'bg-amber-500']
    : g === 'ALIS' ? ['bg-sky-100 text-sky-800', 'bg-sky-500']
    : ['bg-surface-container text-on-surface-variant', 'bg-outline']
  return durumCip(ad, cls, nokta)
}

// =====================================================================
// Son İşlemler (herkes)
// =====================================================================
// ⚠️ OLAY ANLATIMI ARTIK BURADA DEĞİL — veri.js TEK KAYNAK (7 Ağu 2026).
//    Bu blok bu sabah buraya yazıldı, öğleden sonra araç kartı da aynı şeye
//    ihtiyaç duyunca üçüncü kopya doğacaktı. Üstelik veri.js'te ZATEN daha
//    kapsamlı bir OLAY_ETIKET varmış (26 tip) — `node --check` iki tanımı
//    yakaladı. Buradaki kopya kaldırıldı; etiket/detay/sistem-kişi mantığı
//    veri.js'ten import ediliyor.

// Kim yaptı? Sistem olaylarında (danisman_id boş) "AI-SİSTEM" rozeti;
// boş bırakmak "kimse yapmadı" izlenimi veriyordu.
function olayKisi(o) {
  if (!olaySistemMi(o)) return `<span class="text-label-sm text-on-surface-variant">${kacis(danismanAdi(DMAP, o.danisman_id))}</span>`
  return `<span class="text-[10px] font-black tracking-wide px-1.5 py-0.5 rounded
    bg-primary/10 text-primary" title="Sistem tarafından oluşturuldu">${AI_SISTEM}</span>`
}

function sonIslemlerKart(rows) {
  const saat = ts => ts ? new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '--:--'
  const govde = rows.length
    ? rows.map(o => {
        const detay = olayDetay(o)
        return `<div class="flex items-start gap-3 py-2.5 border-b border-outline-variant/40 last:border-0">
        <span class="text-label-sm text-on-surface-variant font-mono shrink-0 w-11">${saat(o.olusma_zamani)}</span>
        ${o.stok_araclar && o.stok_araclar.plaka
          ? `<span class="font-mono text-label-sm font-bold bg-surface-container px-2 py-0.5 rounded shrink-0">${kacis(o.stok_araclar.plaka)}</span>` : ''}
        <span class="flex-1 min-w-0">
          <span class="block text-body-sm">${kacis(olayAdi(o.tip))}</span>
          ${detay ? `<span class="block text-[11px] text-on-surface-variant break-words">${kacis(detay)}</span>` : ''}
        </span>
        <span class="shrink-0 hidden sm:block">${olayKisi(o)}</span>
      </div>`
      }).join('')
    : `<div class="text-body-sm text-on-surface-variant py-6 text-center">Henüz işlem kaydı yok.</div>`
  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow p-lg">
    <h3 class="text-title-md font-bold mb-2">Son İşlemler</h3>${govde}</div>`
}

// =====================================================================
// Personel İş Yükü — danışman bazlı satış adedi (bugün / bu ay / bu yıl)
// ⚠️ Arayüz hazır, rakamlar bugün 0. Göksenil'in kararı: "sen bugün kuracaksın,
//    rakamlar 0 gösterecek; backendi Bahadır'la kuracağız." Kullanıcı "sistem
//    bozuk" sanmasın diye sebebi kartın İÇİNDE açıkça yazıyor.
// =====================================================================
function personelYukKart(rows, kisiler) {
  const bugun = new Date().toISOString().slice(0, 10)
  const ay = bugun.slice(0, 7)
  const sayac = {}
  for (const r of (rows || [])) {
    if (!r.danisman_id) continue
    const t = String(r.created_at || '').slice(0, 10)
    const s = sayac[r.danisman_id] || (sayac[r.danisman_id] = { bugun: 0, ay: 0, yil: 0 })
    s.yil++
    if (t.startsWith(ay)) s.ay++
    if (t === bugun) s.bugun++
  }
  // Satışı 0 olsa da AKTİF danışmanları listele — boş tablo "veri gelmiyor" sanılır.
  const liste = (kisiler || []).slice()
    .sort((a, b) => ((sayac[b.id] || {}).yil || 0) - ((sayac[a.id] || {}).yil || 0))

  const govde = liste.length
    ? stitchTablo(['Personel', ['Bugün', true], ['Bu Ay', true], ['Bu Yıl', true]],
        liste.map(x => {
          const s = sayac[x.id] || { bugun: 0, ay: 0, yil: 0 }
          return { hucreler: [kacis(x.ad_soyad || '—'), say(s.bugun), say(s.ay), say(s.yil)] }
        }))
    : bosDurum('Satış danışmanı bulunamadı.', 'group')

  return `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow overflow-hidden">
    <div class="p-lg pb-2 flex items-start justify-between gap-3">
      <div>
        <h3 class="text-title-md font-bold">Personel İş Yükü</h3>
        <p class="text-body-sm text-on-surface-variant">Danışman bazlı satış adedi</p>
      </div>
      <button id="detayliRapor" type="button" disabled
        class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/40 text-on-primary
               text-label-md font-bold cursor-not-allowed" title="Finans modülü kurulunca açılacak">
        Detaylı Raporlar ${mat('arrow_forward', 'text-[16px]')}</button>
    </div>
    <div class="mx-lg mb-3 text-[11px] bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
      ${mat('info', 'text-[14px] align-middle')} Rakamlar şu an <b>0</b>: satışlar hâlâ eski DMS'te yapılıyor ve
      CRM'e danışman bilgisiyle akmıyor. Arka uç finans tarafıyla birlikte kurulacak.
    </div>
    ${govde}</div>`
}
