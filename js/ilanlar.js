// =====================================================================
// ilanlar.js — İLAN OPERASYON MERKEZİ ("İlanlarımız")
//
//   Göksenil: "yöneticilere İlanlarımız diye bir sayfa olacak, dashboard ve
//   diğer ekranlar bunun içinde olacak."
//   Tek sayfa, sekmeli: Bugün · Takvim · Dağılım · Fiyat · Yönetici.
//
//   ⚠️ HESAP YOK, GÖSTERİM VAR. Yaşam evresi, sağlık puanı, barem, adil atama
//   ve fiyat uyuşmazlığı SUNUCUDA hesaplanır (sql/103-105). Burada tekrar
//   hesaplanırsa iki farklı doğru ortaya çıkar — cam etiketinde bu hatayı
//   bir kez yaptık (indirim referansı), tekrarlamıyoruz.
// =====================================================================
import { supabase } from './supabase-client.js'
import { fmtPara, fmtTarih, fmtTarihKisa, kacis, trBuyuk, buyuk, dbHata, urlParam } from './veri.js'
import { mat, bosDurum, stitchTablo, kpiKart, sekmeBar, toast } from './stitch-ui.js'
import { ilanYonetir, kampanyaYonetir, evrakTakipEder } from './yetki.js'
import { ilanGorselAc, ilanGorselKur } from './ilan-gorsel-pencere.js'
import { gorselUret } from './ilan-gorsel.js'
import {
  EVRAK_SEKME, evrakListesiOku, evrakListeHtml, evrakListeBagla,
} from './evrak-takip.js'

let BEN = null
let V = { bugun: [], yasam: [], dagilim: [], fiyat: [], yonetici: [], saglik: [],
          baremler: [], kaldir: [], gorseller: [], ayarlar: {},
          evrak: [], evrakKesildi: false }
let sekme = 'bugun'
// Sayfa geneli arama — aktif sekmenin listesini süzer. Statik olarak HTML'de
// duruyor (#ara), `ciz()` onu YENİDEN ÇİZMEZ; yoksa her tuşta odak kaybolurdu.
let arama = ''
const ARAMA_ALAN = ['plaka', 'marka', 'model', 'kanal_kodu', 'ilan_no',
  'danisman', 'ilan_danismani', 'ad_soyad', 'arac_durumu', 'evre']
function aramaUyar(r) {
  if (!arama) return true
  // ⚠️ Türkçe küçültme: `toLowerCase()` 'I' harfini 'i' yapar, 'İ'yi bırakır.
  //   Plakada I çok geçtiği için ARAMA SESSİZCE ÇALIŞMAZDI (bkz. veri.js
  //   Türkçe İ dersi). toLocaleLowerCase('tr') iki tarafta da kullanılıyor.
  const q = arama.toLocaleLowerCase('tr')
  return ARAMA_ALAN.some(a => {
    const v = r?.[a]
    return v != null && String(v).toLocaleLowerCase('tr').includes(q)
  })
}
const suz = liste => (liste || []).filter(aramaUyar)

const SEKMELER = [
  { key: 'bugun',    label: 'Bugün Yapılacaklar', ik: 'today', rozet: () => V.bugun.length || null },
  { key: 'takvim',   label: 'Yayın Takvimi',      ik: 'calendar_month' },
  { key: 'dagilim',  label: 'İlan Dağılımı',      ik: 'balance' },
  { key: 'fiyat',    label: 'Fiyat Uyuşmazlığı',  ik: 'price_change', rozet: () => V.fiyat.length || null },
  { key: 'saglik',   label: 'İlan Sağlığı',       ik: 'monitor_heart' },
  { key: 'gorsel',   label: 'İlan Görselleri',    ik: 'image',
    rozet: () => V.gorseller.filter(g => g.gorsel_durumu === 'ESKI').length || null },
  // Evrak Talebi iş takibi — YALNIZ bilgi işlem/yönetici/master. Danışmanda
  // sekme hiç çizilmez (RLS zaten 0 satır verir; boş sekme göstermiyoruz).
  { key: EVRAK_SEKME, label: 'Evrak Talepleri', ik: 'description',
    gizli: d => !evrakTakipEder(d), rozet: () => V.evrak.length || null },
  { key: 'yonetici', label: 'Yönetici Görünümü',  ik: 'admin_panel_settings' },
  { key: 'kampanya', label: 'Kampanya Ayarları',  ik: 'tune', gizli: d => !kampanyaYonetir(d) },
]
const gorunurSekmeler = () => SEKMELER.filter(s => !s.gizli || !s.gizli(BEN))

export async function ilanlarKur(d) {
  BEN = d
  ilanGorselKur(d)
  // Derin bağlantı: bildirim / ana sayfa kartı doğrudan sekmeye götürebilsin
  // (ör. ilanlar.html?sekme=evrak). Erişilemeyen sekme adı yok sayılır.
  const istenen = urlParam('sekme')
  if (istenen && gorunurSekmeler().some(s => s.key === istenen)) sekme = istenen
  document.getElementById('yenile')?.addEventListener('click', yukle)
  // Arama: yalnız #icerik yeniden çizilir — kutu HTML'de sabit durduğu için
  // odak ve imleç konumu korunur.
  document.getElementById('ara')?.addEventListener('input', e => {
    arama = e.target.value.trim()
    icerikCiz()
    const t = document.getElementById('aramaTemizle')
    if (t) t.classList.toggle('hidden', !arama)
  })
  document.getElementById('aramaTemizle')?.addEventListener('click', () => {
    arama = ''
    const k = document.getElementById('ara'); if (k) { k.value = ''; k.focus() }
    document.getElementById('aramaTemizle')?.classList.add('hidden')
    icerikCiz()
  })
  document.getElementById('sekmeler').addEventListener('click', e => {
    const b = e.target.closest('[data-sekme]'); if (!b) return
    sekme = b.dataset.sekme; ciz()
  })
  // İçerik her sekme değişiminde yeniden çizildiği için olay KAPSAYICIDA
  // dinlenir (tek tek düğmeye bağlansaydı ilk çizimden sonrakiler ölürdü).
  document.getElementById('icerik').addEventListener('click', e => {
    const y = e.target.closest('.il-yenile')
    if (y) { ilanHareket(y.dataset.id, 'YENILEME'); return }
    const k = e.target.closest('.il-kaldir')
    if (k) {
      const neden = prompt('Yayından kaldırma nedeni? (satıldı / rezerve / fiyat / diğer)')
      if (neden === null) return
      ilanHareket(k.dataset.id, 'KALDIRMA', neden.trim() || null)
    }
    const g = e.target.closest('.ig-ac')
    if (g) { ilanGorselAc(g.dataset.arac, g.dataset.ad || '', yukle); return }
    const t = e.target.closest('#igTopluBtn')
    if (t) { topluGorselGuncelle(t); return }
    const s = e.target.closest('#kampanyaKaydet')
    if (s) { kampanyaKaydet(s); return }
    const tp = e.target.closest('#ilTopluYenile')
    if (tp) { topluYenile(tp); return }
  })
  // Seçim kutuları `change` yayar, `click` değil — ayrı dinleyici şart.
  document.getElementById('icerik').addEventListener('change', e => {
    if (e.target.id === 'ilTumu') {
      document.querySelectorAll('.il-sec').forEach(k => { k.checked = e.target.checked })
      secimTazele(); return
    }
    if (e.target.classList?.contains('il-sec')) secimTazele()
  })
  // Evrak işaret kutuları — dinleyici BİR KEZ kapsayıcıya bağlanır (içerik her
  // sekme değişiminde yeniden çizilir; tek tek bağlansaydı ölürdü).
  evrakListeBagla(document.getElementById('icerik'), yukle)
  await yukle()
}

async function yukle() {
  const hedef = document.getElementById('icerik')
  hedef.innerHTML = '<div class="text-on-surface-variant p-4">Yükleniyor…</div>'
  // Evrak takibi yalnız yetkili kullanıcıda sorgulanır — yetkisizde RLS zaten
  // 0 satır döner, boşuna istek atmıyoruz.
  const evrakSoz = evrakTakipEder(BEN)
    ? evrakListesiOku()
    : Promise.resolve({ satirlar: [], kesildi: false, hata: null })
  const [bugunR, yasamR, dagR, fiyatR, yonR, saglikR, baremR,
         kaldirR, gorselR, ayarR] = await Promise.all([
    supabase.from('v_ilan_bugun').select('*'),
    supabase.from('v_ilan_yasam').select('*').eq('durum', 'YAYINDA'),
    supabase.from('v_danisman_ilan_dagilim').select('*').order('sira'),
    supabase.from('v_ilan_fiyat_uyusmazlik').select('*'),
    supabase.from('v_ilan_yonetici').select('*'),
    supabase.from('v_ilan_saglik').select('*'),
    supabase.from('ilan_baremleri').select('kod, ad, sira').order('sira'),
    supabase.from('v_ilan_kaldirilmali').select('*'),
    supabase.from('v_ilan_gorsel_durum').select('*').order('plaka'),
    supabase.from('ayarlar').select('anahtar, deger'),
  ])
  for (const [ad, r] of [['bugun', bugunR], ['yasam', yasamR], ['dagilim', dagR],
    ['fiyat', fiyatR], ['yonetici', yonR], ['saglik', saglikR], ['barem', baremR],
    ['kaldirilmali', kaldirR], ['gorsel', gorselR], ['ayarlar', ayarR]]) {
    if (r.error) console.error('[db] ilan ' + ad, r.error)
  }
  if (bugunR.error) { dbHata('ilan bugun', bugunR.error); hedef.innerHTML = `<div class="uyari-kutu">İlanlar okunamadı: ${kacis(bugunR.error.message)}</div>`; return }
  // Hatası dbHata ile zaten loglandı (evrak-takip.js); burada yalnız veri alınır.
  const evrakR = await evrakSoz
  V = {
    bugun: bugunR.data || [], yasam: yasamR.data || [], dagilim: dagR.data || [],
    fiyat: fiyatR.data || [], yonetici: yonR.data || [], saglik: saglikR.data || [],
    baremler: baremR.data || [],
    kaldir: kaldirR.data || [], gorseller: gorselR.data || [],
    ayarlar: Object.fromEntries((ayarR.data || []).map(a => [a.anahtar, a.deger])),
    evrak: evrakR.satirlar, evrakKesildi: evrakR.kesildi,
  }
  kpiCiz()
  ciz()
}

function kpiCiz() {
  const aktif = V.yasam.length
  const bugun = V.bugun.length
  const geciken = V.bugun.filter(r => r.yenileme_gecti).length
  const inceleme = V.yasam.filter(r => r.evre_kod === 'INCELEME').length
  // ⚠️ Bu sayı ÖNCE burada, teslim_tarihi'ne bakarak tahmin ediliyordu.
  // Artık v_ilan_kaldirilmali'dan geliyor: "hangi durumlar ilanı düşürür"
  // kuralı ayarlar.ilan_kaldir_durumlar'da (sql/106) ve BİLDİRİM de aynı
  // görünümü okuyor — ekranla uyarı asla ayrışmıyor.
  const satildi = V.kaldir.length
  const eskiGorsel = V.gorseller.filter(g => g.gorsel_durumu === 'ESKI').length
  const ort = V.saglik.length
    ? Math.round(V.saglik.reduce((s, r) => s + (Number(r.toplam) || 0), 0) / V.saglik.length) : null

  document.getElementById('kpi').innerHTML = [
    kpiKart('campaign', 'bg-blue-100 text-blue-700', aktif, 'Aktif İlan', 'Tüm kanallarda'),
    kpiKart('event_available', 'bg-amber-100 text-amber-700', bugun, 'Bugün Yenilenecek', geciken ? geciken + ' tanesi gecikti' : 'Gecikme yok'),
    kpiKart('price_change', 'bg-red-100 text-red-700', V.fiyat.length, 'Fiyat Uyuşmayan', 'İlan ≠ CRM'),
    // ⚠️ Satılan araç HÂLÂ YAYINDA ise ilan düşürülmeli — sessiz kalırsa
    // müşteri satılmış araca talep gönderir.
    kpiKart('remove_shopping_cart', 'bg-purple-100 text-purple-700', satildi, 'Yayından Kaldırılacak', 'Satılmış ama yayında'),
    kpiKart('gavel', 'bg-orange-100 text-orange-700', inceleme, 'Yönetici İncelemesi', '120+ gün'),
    kpiKart('image', 'bg-teal-100 text-teal-700', eskiGorsel, 'Eskiyen Görsel', eskiGorsel ? 'Fiyat/kasko değişti' : 'Hepsi güncel'),
    kpiKart('monitor_heart', 'bg-green-100 text-green-700', ort ?? '—', 'İlan Sağlık Ort.', ort != null ? '100 üzerinden' : 'Veri yok'),
  ].join('')
}

function ciz() {
  // ⚠️ sekmeBar DİZİ bekler: [kod, etiket, ikon, rozet] (stitch-ui.js).
  // Nesne geçilirse sekmeler boş çizilir — imza kontrol edilmeden yazılmıştı.
  document.getElementById('sekmeler').innerHTML =
    sekmeBar(gorunurSekmeler().map(s => [s.key, s.label, s.ik, s.rozet ? s.rozet() : null]), sekme)
  icerikCiz()
}

// Yalnız içerik — arama her tuşta bunu çağırır, sekme çubuğuna dokunmaz.
function icerikCiz() {
  const h = document.getElementById('icerik')
  h.innerHTML = ({
    bugun: bugunHtml, takvim: takvimHtml, dagilim: dagilimHtml,
    fiyat: fiyatHtml, saglik: saglikHtml, yonetici: yoneticiHtml,
    gorsel: gorselHtml, kampanya: kampanyaHtml, [EVRAK_SEKME]: evrakHtml,
  }[sekme] || bugunHtml)()
}

// ---------- BUGÜN YAPILACAKLAR ----------
function bugunHtml() {
  const kaldir = kaldirilmaliHtml()
  if (!V.bugun.length) return kaldir || bosDurum('Bugün yenilenecek ilan yok.', 'task_alt')
  return kaldir + yenilenecekHtml()
}

// ⚠️ ÇELİŞKİLİ AKSİYON KAPISI. İki blok bağımsız kümeden çiziliyordu
//   (V.kaldir = satıldı ama yayında · V.bugun = yenilemesi gelmiş) ve kesişim
//   elenmiyordu: aynı ilan üstte "Yayından Kaldır", altta "Yenilendi" olarak
//   çıkıyordu. "Yenilendi"ye basmak satılmış aracın ilanını 30 gün daha
//   yayında bırakır — sayfanın iki satır yukarıda uyardığı şeyin tam tersi.
//   Canlıda ölçüldü (22 Ağu 2026): kesişim 1 satır, satış temposuyla artar.
const kaldirilacakIdler = () => new Set((V.kaldir || []).map(r => r.ilan_id))

// Satilan aracin ilani hala yayindaysa EN USTTE, kirmizi. Kaynak sunucudaki
// v_ilan_kaldirilmali — BK-37 bildirimi de AYNI gorunumu okuyor (sql/106),
// yani "bildirimde var ekranda yok" durumu olusamaz.
function kaldirilmaliHtml() {
  if (!V.kaldir.length) return ''
  const satirlar = V.kaldir.map(r => `
    <div class="flex flex-wrap items-center gap-3 justify-between p-3 rounded-xl bg-error/5 border border-error/30">
      <div class="min-w-0">
        <p class="font-bold text-on-surface">${kacis(trBuyuk(r.plaka || '—'))}
          <span class="text-[11px] font-normal text-error ml-1">${kacis(r.arac_durumu)}</span></p>
        <p class="text-[12px] text-on-surface-variant">${kacis(trBuyuk([r.marka, r.model].filter(Boolean).join(' ')))}
          · ${kacis(r.kanal_kodu)}${r.ilan_no ? ' · ilan ' + kacis(r.ilan_no) : ''}</p>
      </div>
      <div class="flex gap-1.5">
        ${ilanYonetir(BEN) ? `<button class="il-kaldir px-2.5 py-1.5 rounded-lg bg-error text-on-error text-label-md font-bold" data-id="${r.ilan_id}">Yayından Kaldır</button>` : ''}
        <a href="arac-kart.html?id=${encodeURIComponent(r.arac_id)}" class="px-2.5 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold hover:bg-primary hover:text-white transition-all">Araç</a>
      </div>
    </div>`).join('')
  return `<div class="mb-4 space-y-2">
      <h3 class="font-bold text-error flex items-center gap-2">${mat('remove_shopping_cart', 'text-[18px]')} Satıldı — ilan hâlâ yayında (${V.kaldir.length})</h3>
      ${satirlar}
    </div>`
}

function yenilenecekHtml() {
  if (!V.bugun.length) return ''
  const kaldirilacak = kaldirilacakIdler()
  // Gecikenler önce, sonra saate göre
  const liste = suz(V.bugun).slice().sort((a, b) => {
    if (a.yenileme_gecti !== b.yenileme_gecti) return a.yenileme_gecti ? -1 : 1
    return new Date(a.yenileme_tarihi) - new Date(b.yenileme_tarihi)
  })
  if (!liste.length) return bosDurum('Aramaya uyan yenileme yok.', 'search_off')
  // Toplu işaretleme şeridi — yenileme akışı canlıda 75 ilanda TOPLAM 1 kez
  // kullanılmış (ilan_hareketleri: YAYIN 75 · YENILEME 1), buna karşılık
  // 24 ilan ortalama 8 gün gecikmiş. Darboğaz tek tek tıklamak.
  const secilebilir = liste.filter(r => !kaldirilacak.has(r.ilan_id))
  const serit = (ilanYonetir(BEN) && secilebilir.length) ? `
    <div class="flex flex-wrap items-center gap-3 mb-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant">
      <label class="flex items-center gap-2 cursor-pointer text-label-md font-bold">
        <input type="checkbox" id="ilTumu" class="w-4 h-4 accent-[#5f1818]"> Tümünü seç (${secilebilir.length})
      </label>
      <span id="ilSecimSayi" class="text-label-md text-on-surface-variant">0 seçili</span>
      <button id="ilTopluYenile" disabled
        class="ml-auto bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
        ${mat('autorenew', 'text-[16px]')} Seçilenleri yenilendi işaretle</button>
    </div>` : ''
  const satirlar = liste.map(r => {
    const engelli = kaldirilacak.has(r.ilan_id)
    const gecikme = r.yenileme_gecti && r.yenileme_tarihi
      ? Math.floor((Date.now() - new Date(r.yenileme_tarihi).getTime()) / 86400000) : 0
    return {
    hucreler: [
      `<div class="flex items-center gap-2">
        ${(ilanYonetir(BEN) && !engelli) ? `<input type="checkbox" class="il-sec w-4 h-4 accent-[#5f1818] shrink-0" data-id="${r.ilan_id}">` : '<span class="w-4 shrink-0"></span>'}
        <span class="font-bold ${r.yenileme_gecti ? 'text-error' : 'text-on-surface'}">${saat(r.yenileme_tarihi)}</span>
        ${gecikme > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-error-container text-on-error-container text-[10px] font-black whitespace-nowrap">${gecikme} gün geç</span>` : ''}
      </div>`,
      `<div><p class="font-bold text-on-surface">${kacis(buyuk(r.plaka || '—'))}</p>
        <p class="text-[12px] text-on-surface-variant">${kacis(buyuk([r.marka, r.model].filter(Boolean).join(' ')))}</p></div>`,
      evreRozet(r),
      `<span class="text-body-sm">${kacis(r.danisman || '—')}</span>`,
      `<span class="text-body-sm">${kacis(r.kanal_kodu)}</span>`,
      // ⚠️ İşlem BURADA yapılır. Araç kartında yalnız "Yayınla" var (Göksenil
      // kararı); günlük yenileme/kaldırma operasyonu bu sayfaya ait.
      // ⚠️ Satılmış aracın ilanında "Yenilendi" GÖSTERİLMEZ. Basılsaydı ilan
      //   30 gün daha yayında kalırdı — üstteki kırmızı blok tam bunun
      //   tersini söylüyor. Yerine ne yapılacağı yazılıyor.
      `<div class="flex justify-end gap-1.5">${engelli
        ? `<span class="text-[11px] font-bold text-error whitespace-nowrap">satıldı → yukarıdan kaldır</span>`
        : (ilanYonetir(BEN) ? `
        <button class="il-yenile px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-label-md font-bold" data-id="${r.ilan_id}" title="sahibinden'de yeniledim">Yenilendi</button>
        <button class="il-kaldir px-2.5 py-1.5 rounded-lg border border-error/40 text-error text-label-md font-bold hover:bg-error/5" data-id="${r.ilan_id}" title="Yayından kaldır">Kaldır</button>` : '')}
        <a href="arac-kart.html?id=${encodeURIComponent(r.arac_id)}" class="px-2.5 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold hover:bg-primary hover:text-white transition-all">Araç</a>
      </div>`,
    ],
  }})
  return serit + stitchTablo(['Saat', 'Araç', 'Evre', 'Danışman', 'Kanal', ['', true]], satirlar)
}

// ---------- YAYIN TAKVİMİ ----------
function takvimHtml() {
  const ileri = suz(V.yasam).filter(r => r.yenileme_tarihi).slice()
    .sort((a, b) => new Date(a.yenileme_tarihi) - new Date(b.yenileme_tarihi))
  if (!ileri.length) return bosDurum(arama ? 'Aramaya uyan ilan yok.' : 'Planlanmış yenileme yok.',
    arama ? 'search_off' : 'calendar_month')
  const gunler = {}
  for (const r of ileri) {
    const g = new Date(r.yenileme_tarihi).toLocaleDateString('tr-TR')
    ;(gunler[g] = gunler[g] || []).push(r)
  }
  // ⚠️ Plaka ARTIK GÖRÜNÜMDEN geliyor (sql/241). Eskiden V.bugun'dan ödünç
  //   alınmaya çalışılıyordu; o küme yalnız "yenilemesi bugüne/geçmişe düşen"
  //   24 satır olduğu için takvimin 75 satırının 51'i plaka yerine UUID'nin
  //   ilk 8 karakterini basıyordu (canlıda ölçüldü, 22 Ağu 2026).
  return Object.entries(gunler).map(([gun, kayitlar]) => `
    <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md mb-md custom-shadow">
      <h4 class="font-bold text-primary mb-2">${kacis(gun)} <span class="text-on-surface-variant font-normal text-label-md">(${kayitlar.length} ilan)</span></h4>
      ${kayitlar.map(r => `<div class="flex items-center gap-3 py-1.5 border-b border-outline-variant/40 last:border-0">
        <span class="font-bold text-body-sm w-14 ${r.yenileme_gecti ? 'text-error' : 'text-on-surface-variant'}">${saat(r.yenileme_tarihi)}</span>
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${kacis(r.evre_renk || '#999')}"></span>
        <a href="arac-kart.html?id=${encodeURIComponent(r.arac_id)}" class="text-body-sm font-semibold text-primary hover:underline">${kacis(buyuk(r.plaka || '—'))}</a>
        <span class="text-label-sm text-on-surface-variant truncate">${kacis(trBuyuk([r.marka, r.model].filter(Boolean).join(' ')))}</span>
        <span class="ml-auto text-label-sm text-on-surface-variant">${r.ilan_yasi_gun} gün</span>
      </div>`).join('')}
    </div>`).join('')
}

// ---------- İLAN DAĞILIMI (BAREM BAZLI) ----------
function dagilimHtml() {
  if (!V.dagilim.length) return bosDurum('Danışman dağılımı hesaplanamadı.', 'balance')
  const kisiler = [...new Set(V.dagilim.map(r => r.danisman_id))]
  const bul = (kid, bk) => (V.dagilim.find(r => r.danisman_id === kid && r.barem_kod === bk) || {}).adet || 0
  const satirlar = kisiler.map(kid => {
    const ad = (V.dagilim.find(r => r.danisman_id === kid) || {}).ad_soyad || '—'
    const hucre = V.baremler.map(b => {
      const n = bul(kid, b.kod)
      return `<div class="text-center"><span class="font-bold text-on-surface">${n}</span>
        <div class="h-1 rounded-full mt-1 ${n ? 'bg-primary' : 'bg-outline-variant/40'}"></div></div>`
    })
    const toplam = V.baremler.reduce((s, b) => s + bul(kid, b.kod), 0)
    return { hucreler: [`<span class="font-bold">${kacis(ad)}</span>`, ...hucre,
      `<span class="font-bold text-primary">${toplam}</span>`] }
  })
  return `<p class="text-label-md text-on-surface-variant mb-2">
      ${mat('info', 'text-[15px] align-middle')} Yeni araç geldiğinde sistem, o baremde <b>en az ilanı olan</b> danışmanı önerir; eşitlikte toplam ilan sayısına bakar.
    </p>` +
    stitchTablo(['Danışman', ...V.baremler.map(b => [b.ad, true]), ['Toplam', true]], satirlar)
}

// ---------- FİYAT UYUŞMAZLIĞI ----------
function fiyatHtml() {
  if (!V.fiyat.length) return bosDurum('Tüm ilan fiyatları CRM ile uyumlu.', 'price_check')
  const liste = suz(V.fiyat)
  if (!liste.length) return bosDurum('Aramaya uyan ilan yok.', 'search_off')
  const satirlar = liste.map(r => ({
    hucreler: [
      `<div><p class="font-bold">${kacis(buyuk(r.plaka || '—'))}</p>
        <p class="text-[12px] text-on-surface-variant">${kacis(buyuk([r.marka, r.model].filter(Boolean).join(' ')))}</p></div>`,
      `<span class="font-bold">${fmtPara(r.crm_fiyati)}</span>`,
      `<span class="font-bold">${fmtPara(r.ilan_fiyati)}</span>`,
      `<span class="font-bold ${Number(r.fark) > 0 ? 'text-error' : 'text-[#047857]'}">${Number(r.fark) > 0 ? '+' : ''}${fmtPara(r.fark)}</span>`,
      `<span class="text-body-sm">${kacis(r.kanal_kodu)}</span>`,
      `<div class="flex justify-end"><a href="arac-kart.html?id=${encodeURIComponent(r.arac_id)}" class="px-3 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold hover:bg-primary hover:text-white transition-all">Düzelt</a></div>`,
    ],
  }))
  return stitchTablo(['Araç', ['CRM Fiyatı', true], ['İlan Fiyatı', true], ['Fark', true], 'Kanal', ['', true]], satirlar)
}

// ---------- İLAN SAĞLIĞI ----------
function saglikHtml() {
  // ⚠️ YALNIZ YAYINDA. Görünümün kendi durum süzgeci YOK; kaldırılan ilan
  //   listede ve ortalamada kalıyordu — üstelik `yenileme_gecti` true'ya
  //   döndüğü için puanı 0'a inip ortalamayı kalıcı aşağı çekiyordu.
  //   Kardeş sorgu (v_ilan_yasam) 93. satırda zaten YAYINDA'ya kısıtlı;
  //   ikisi ayrışıktı. Kolon sql/241'de eklendi.
  const yayinda = suz((V.saglik || []).filter(r => r.durum === 'YAYINDA'))
  if (!yayinda.length) return bosDurum('Sağlık puanı hesaplanacak yayında ilan yok.', 'monitor_heart')
  const liste = yayinda.slice().sort((a, b) => (a.toplam || 0) - (b.toplam || 0))
  const satirlar = liste.map(r => {
    const p = Number(r.toplam) || 0
    const cls = p >= 80 ? 'text-[#047857]' : p >= 50 ? 'text-amber-700' : 'text-error'
    return { hucreler: [
      `<a href="arac-kart.html?id=${encodeURIComponent(r.arac_id)}" class="font-bold text-primary hover:underline">${kacis(buyuk(r.plaka || '—'))}</a>
        <p class="text-[11px] text-on-surface-variant">${kacis(trBuyuk([r.marka, r.model].filter(Boolean).join(' ')))}</p>`,
      `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style="background:${kacis(r.evre_renk || '#666')}">${kacis(r.evre || '—')}</span>`,
      `<span class="text-body-sm">${r.ilan_yasi_gun} gün</span>`,
      `<span class="text-body-sm">${r.foto_puan}</span>`,
      `<span class="text-body-sm">${r.ekspertiz_puan}</span>`,
      `<span class="text-body-sm">${r.fiyat_puan}</span>`,
      `<span class="text-body-sm">${r.yenileme_puan}</span>`,
      `<span class="text-body-sm">${r.yas_puan}</span>`,
      `<span class="font-black ${cls}">${p}</span>`,
    ] }
  })
  return `<p class="text-label-md text-on-surface-variant mb-2">
      ${mat('info', 'text-[15px] align-middle')} Puan yaşam döngüsüyle <b>aynı girdiden</b> türer — ikisi asla çelişmez. Düşükten yükseğe sıralı.
    </p>` +
    stitchTablo(['Araç', 'Evre', ['Yaş', true], ['Foto', true], ['Eksp.', true], ['Fiyat', true], ['Yenileme', true], ['İlan Yaşı', true], ['Toplam', true]], satirlar)
}

// ---------- YÖNETİCİ GÖRÜNÜMÜ ----------
function yoneticiHtml() {
  if (!V.yonetici.length) return bosDurum('Henüz ilan kaydı yok.', 'admin_panel_settings')
  const liste = suz(V.yonetici)
  if (!liste.length) return bosDurum('Aramaya uyan ilan yok.', 'search_off')
  const satirlar = liste.map(r => ({
    hucreler: [
      `<div><p class="font-bold">${kacis(buyuk(r.plaka || '—'))}</p>
        <p class="text-[12px] text-on-surface-variant">${kacis(buyuk([r.marka, r.model].filter(Boolean).join(' ')))}</p></div>`,
      `<span class="text-body-sm">${kacis(r.ilan_danismani || '—')}</span>`,
      `<span class="text-body-sm">${kacis(r.kanal_kodu)}</span>`,
      `<span class="text-body-sm">${fmtTarihKisa(r.yayin_tarihi)}</span>`,
      r.satan_danisman
        ? `<span class="text-body-sm font-semibold ${r.ilan_sahibi_satti ? 'text-[#047857]' : 'text-on-surface'}">${kacis(r.satan_danisman)}${r.ilan_sahibi_satti ? ' ✓' : ''}</span>`
        : '<span class="text-on-surface-variant">—</span>',
      r.yayindan_satisa_gun != null
        ? `<span class="font-bold ${r.yayindan_satisa_gun <= 30 ? 'text-[#047857]' : r.yayindan_satisa_gun <= 60 ? 'text-amber-700' : 'text-error'}">${r.yayindan_satisa_gun} gün</span>`
        : '<span class="text-on-surface-variant">—</span>',
      `<span class="text-label-sm">${kacis(r.durum)}</span>`,
    ],
  }))
  return `<p class="text-label-md text-on-surface-variant mb-2">
      ${mat('info', 'text-[15px] align-middle')} ✓ = ilanı alan danışman aynı zamanda <b>satan</b> kişi. Süre sütunu "kim daha hızlı aksiyon aldı" sorusunun cevabı.
    </p>` +
    stitchTablo(['Araç', 'İlan Danışmanı', 'Kanal', 'Yayın', 'Satan', ['Yayından Satışa', true], 'Durum'], satirlar)
}

// ---------- EVRAK TALEPLERİ ----------
// Çizim ve işaretleme mantığı evrak-takip.js'te (Ana Sayfa kartı/pop-up ile
// TEK KAYNAK). Burada yalnız yetki kapısı + veriyi geçirme var.
function evrakHtml() {
  if (!evrakTakipEder(BEN)) return bosDurum('Evrak taleplerini bilgi işlem birimi takip eder.', 'lock')
  return evrakListeHtml({ satirlar: V.evrak, kesildi: V.evrakKesildi })
}

// ---------- yardımcılar ----------
function evreRozet(r) {
  if (!r.evre) return '<span class="text-on-surface-variant">—</span>'
  return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap" style="background:${kacis(r.evre_renk || '#666')}">${kacis(r.evre)}</span>`
}
// Saat gösterimi TR'ye göre — veritabanı UTC, sunucu tarafı zaten
// Europe/Istanbul ile hesaplıyor (sql/105); burada da aynı dilimde gösterilir.
function saat(t) {
  if (!t) return '—'
  const g = new Date(t)
  return isNaN(g) ? '—' : g.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
}

// ---------- TOPLU YENİLEME ----------
function seciliIdler() {
  return [...document.querySelectorAll('.il-sec:checked')].map(k => k.dataset.id)
}
function secimTazele() {
  const n = seciliIdler().length
  const s = document.getElementById('ilSecimSayi'); if (s) s.textContent = n + ' seçili'
  const b = document.getElementById('ilTopluYenile'); if (b) b.disabled = n === 0
}

// ⚠️ Tek tek `ilanHareket` ÇAĞIRMIYOR: o her seferinde `yukle()` yapıyor
//   (11 sorgu). 24 ilan için 264 gereksiz sorgu olurdu. Burada döngü yazma
//   yapar, yenileme EN SONDA bir kez.
// ⚠️ Sonraki yenileme tarihi SUNUCUDAN, ilan başına ayrı ayrı alınıyor —
//   pazar→pazartesi kaydırması ve saat korunumu orada (sql/105).
async function topluYenile(btn) {
  const idler = seciliIdler()
  if (!idler.length) return
  if (!confirm(`${idler.length} ilan "yenilendi" olarak işaretlenecek.\n\nsahibinden tarafında yenilemeyi zaten yaptıysanız onaylayın.`)) return
  btn.disabled = true
  const eskiMetin = btn.innerHTML
  let ok = 0
  const hatalar = []
  for (const id of idler) {
    const sonuc = await birYenile(id)
    if (sonuc.tamam) ok++; else hatalar.push(sonuc.mesaj)
    btn.textContent = `İşleniyor… ${ok + hatalar.length}/${idler.length}`
  }
  btn.innerHTML = eskiMetin
  // ⚠️ Toast KULLANILIYOR: sonuç metni #icerik içine yazılsaydı hemen ardından
  //   gelen yukle() onu siler ve kullanıcı hiçbir şey görmez (kampanya ve
  //   toplu görselde bu hata canlıda vardı).
  if (hatalar.length) toast(`${ok}/${idler.length} yenilendi · ${hatalar.length} hata: ${hatalar[0]}`, false)
  else toast(`${ok} ilan yenilendi olarak işaretlendi.`)
  await yukle()
}

// Tek ilanın yenileme yazması. `ilanHareket` ile AYNI kuralları uygular ama
// sayfayı yeniden yüklemez — toplu akış bunu döngüde çağırır.
async function birYenile(ilanId) {
  const { data: yen, error: ye } = await supabase.rpc('ilan_sonraki_yenileme')
  // ⚠️ RPC HATASINDA DURUYORUZ. Eskiden hata yutulup akış devam ediyordu:
  //   `yenileme_tarihi` GEÇMİŞTE kalıyor, ilan listeden hiç düşmüyor, ama
  //   `ilan_hareketleri`'ne "YENILEME" kaydı yine de yazılıyordu — denetim
  //   defteri olmayan bir yenilemeyi doğruluyordu.
  if (ye || !yen) { dbHata('sonraki yenileme', ye); return { tamam: false, mesaj: 'Yenileme tarihi hesaplanamadı.' } }
  const { data, error } = await supabase.from('ilanlar')
    .update({ son_yenileme: new Date().toISOString(), yenileme_tarihi: yen })
    .eq('id', ilanId).select('id')
  if (error) { dbHata('ilan yenile', error); return { tamam: false, mesaj: error.message } }
  if (!data?.length) return { tamam: false, mesaj: 'yetki yok (0 satır)' }   // §5.1
  const { error: he } = await supabase.from('ilan_hareketleri')
    .insert({ ilan_id: ilanId, tip: 'YENILEME', yapan_id: BEN?.id || null })
  if (he) dbHata('ilan hareketi', he)   // §5.4 — yutma, logla
  return { tamam: true }
}

// ---------- İLAN İŞLEMİ (yenileme / kaldırma) ----------
// Yenileme tarihi SUNUCUDA hesaplanır (sql/105: 30 gün + pazar→pazartesi,
// saat korunur). İstemcide tekrarlanırsa iki farklı takvim oluşur.
async function ilanHareket(ilanId, tip, ek) {
  const guncelle = tip === 'KALDIRMA'
    ? { durum: 'KALDIRILDI', kaldirma_tarihi: new Date().toISOString(), kaldirma_nedeni: ek || null }
    : { son_yenileme: new Date().toISOString() }
  if (tip === 'YENILEME') {
    const { data: yen, error: ye } = await supabase.rpc('ilan_sonraki_yenileme')
    // ⚠️ ESKİDEN YUTULUYORDU. Hata olunca `yenileme_tarihi` geçmişte kalıyor,
    //   ilan listeden düşmüyor ("düğme çalışmıyor"), ama ALTTAKİ hareket
    //   insert'i yine de atılıp denetim defterine olmayan bir yenileme
    //   yazılıyordu. Artık duruyoruz ve sebebini söylüyoruz.
    if (ye || !yen) {
      dbHata('sonraki yenileme', ye)
      alert('Yenileme tarihi hesaplanamadı — kayıt yapılmadı. Tekrar deneyin.')
      return
    }
    guncelle.yenileme_tarihi = yen
  }
  const { data, error } = await supabase.from('ilanlar').update(guncelle).eq('id', ilanId).select('id')
  if (error) { dbHata('ilan hareket', error); alert('İşlem yapılamadı: ' + error.message); return }
  // §5.1 — PostgREST yetki yoksa 0 satır günceller ve HATA VERMEZ.
  if (!data?.length) { alert('İşlem yapılamadı — ilan yönetme yetkiniz yok.'); return }
  const { error: he } = await supabase.from('ilan_hareketleri').insert({
    ilan_id: ilanId, tip, aciklama: ek || null, yapan_id: BEN?.id || null,
  })
  if (he) dbHata('ilan hareketi', he)   // §5.4 — sessiz catch yok
  toast(tip === 'YENILEME' ? 'İlan yenilendi olarak işaretlendi.' : 'İlan yayından kaldırıldı.')
  await yukle()
}

// ---------- İLAN GÖRSELLERİ (sql/107) ----------
// Göksenil: "araç yayınlanırken sahibinden için hazır bir görsel üretiyordum,
// bu işi artık burada yapmak istiyorum." Üretim TARAYICIDA; veritabanı
// yalnızca hangi görselin eskidiğini işaretler.
const GORSEL_ROZET = {
  HAZIR:  ['Güncel', 'bg-green-100 text-green-700'],
  ESKI:   ['ESKİ',   'bg-red-100 text-red-700'],
  HATA:   ['Hata',   'bg-orange-100 text-orange-700'],
  TASLAK: ['Taslak', 'bg-surface-container text-on-surface-variant'],
  YOK:    ['Yok',    'bg-surface-container text-on-surface-variant'],
}

function gorselHtml() {
  if (!V.gorseller.length) return bosDurum('Stokta görsel üretilecek araç yok.', 'image')
  const eski = V.gorseller.filter(g => g.gorsel_durumu === 'ESKI')
  const oncelik = d => d === 'ESKI' ? 0 : d === 'HATA' ? 1 : d === 'YOK' ? 2 : 3
  const sirali = suz(V.gorseller).slice().sort((a, b) =>
    oncelik(a.gorsel_durumu) - oncelik(b.gorsel_durumu) ||
    String(a.plaka || '').localeCompare(String(b.plaka || ''), 'tr'))

  const ust = (eski.length && ilanYonetir(BEN)) ? `
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 border border-amber-300">
      <div>
        <p class="font-bold text-on-surface">${eski.length} görselin verisi değişti</p>
        <p class="text-[12px] text-on-surface-variant">Fiyat, TSB kasko, ekspertiz ya da kampanya ayarı güncellendi. Bağlantılar aynı kalır — sahibinden ilanlarına dokunmana gerek yok.</p>
      </div>
      <button id="igTopluBtn" class="bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold flex items-center gap-1">${mat('autorenew', 'text-[16px]')} Eskiyenleri Güncelle</button>
    </div>
    <p id="igTopluDurum" class="text-body-sm text-on-surface-variant mb-2"></p>` : ''

  const satirlar = sirali.map(g => {
    const [et, sinif] = GORSEL_ROZET[g.gorsel_durumu] || GORSEL_ROZET.YOK
    return { hucreler: [
      `<div><p class="font-bold text-on-surface">${kacis(trBuyuk(g.plaka || '—'))}</p>
        <p class="text-[12px] text-on-surface-variant">${kacis(trBuyuk([g.marka, g.model].filter(Boolean).join(' ')))} ${g.yil || ''}</p></div>`,
      `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${sinif}">${et}</span>`,
      `<span class="text-body-sm">${g.satis_fiyati ? fmtPara(g.satis_fiyati) : '—'}</span>`,
      `<span class="text-body-sm">${g.ilanda ? 'İlanda' : '—'}</span>`,
      `<span class="text-[12px] text-on-surface-variant">${g.son_uretim ? fmtTarihKisa(g.son_uretim) : '—'}</span>`,
      `<div class="flex justify-end gap-1.5">
        ${g.gorsel_url ? `<a href="${kacis(g.gorsel_url)}" target="_blank" rel="noopener" class="px-2.5 py-1.5 rounded-lg border border-outline-variant text-label-md font-bold">Aç</a>` : ''}
        ${ilanYonetir(BEN) ? `<button class="ig-ac px-2.5 py-1.5 rounded-lg bg-primary text-on-primary text-label-md font-bold" data-arac="${g.arac_id}" data-ad="${kacis([g.plaka, g.marka, g.model].filter(Boolean).join(' '))}">${g.gorsel_url ? 'Düzenle' : 'Üret'}</button>` : ''}
      </div>`,
    ] }
  })
  return ust + stitchTablo(['Araç', 'Görsel', 'Fiyat', 'İlan', 'Son Üretim', ['', true]], satirlar)
}

// Eskiyenleri SIRAYLA üretir. Paralel DEĞİL: her üretim gizli bir 800px'lik
// düzeni tarayıcıda tarıyor; aynı anda çalıştırılırsa sekme kilitlenir.
async function topluGorselGuncelle(btn) {
  const eski = V.gorseller.filter(g => g.gorsel_durumu === 'ESKI')
  if (!eski.length) return
  const durumEl = document.getElementById('igTopluDurum')
  btn.disabled = true
  let basarili = 0
  const hatalar = []
  for (const [i, g] of eski.entries()) {
    if (durumEl) durumEl.textContent = `${i + 1}/${eski.length} — ${g.plaka || ''} üretiliyor…`
    try {
      await gorselUret(g.arac_id, BEN?.id || null)
      basarili++
    } catch (e) {
      console.error('[ilan-gorsel] toplu üretim', g.plaka, e)
      hatalar.push(`${g.plaka || g.arac_id}: ${e.message}`)
      await supabase.from('ilan_gorselleri')
        .update({ durum: 'HATA', hata_mesaji: String(e.message).slice(0, 500) })
        .eq('arac_id', g.arac_id)
    }
  }
  // ⚠️ Aynı sebeple toast: `durumEl` #icerik içinde, `yukle()` onu siliyor.
  toast(`${basarili}/${eski.length} görsel güncellendi`
    + (hatalar.length ? ` · ${hatalar.length} hata (ayrıntı konsolda)` : ''), !hatalar.length)
  btn.disabled = false
  await yukle()
}

// ---------- KAMPANYA AYARLARI ----------
// Göksenil: "ilan görsel kampanya ayarları var, onu hem Can yönetebilecek
// hem de master admin." Asıl kapı sunucuda (sql/107 ayarlar_kampanya_yaz);
// buradaki gizleme yalnızca görgü kuralı, yetki değil.
const KAMPANYA_ALANLARI = [
  ['kampanya1_limit', 'Kampanya 1 üst limit (₺)', 'number'],
  ['kampanya1_faiz', 'Kampanya 1 aylık faiz (%)', 'text'],
  ['kampanya1_vade', 'Kampanya 1 vade (ay)', 'number'],
  ['kampanya2_faiz', 'Kampanya 2 aylık faiz (%)', 'text'],
  ['kampanya2_vade', 'Kampanya 2 vade (ay)', 'number'],
  ['ilan_kasko_ust_sinir', 'Kasko üst sınırı (₺) — üstünde kampanya çıkmaz', 'number'],
  ['ilan_dijital_senet_oran', 'Dijital senet peşinat oranı (0.20 = %20)', 'text'],
  ['ilan_firma_adi', 'Görseldeki firma adı', 'text'],
  ['ilan_adres', 'Görseldeki adres', 'text'],
  ['ilan_telefon', 'Görseldeki telefon', 'text'],
]

function kampanyaHtml() {
  if (!kampanyaYonetir(BEN)) return bosDurum('Kampanya ayarlarını kredi müdürü ve master admin düzenler.', 'lock')
  const alanlar = KAMPANYA_ALANLARI.map(([k, etiket, tip]) => `
    <div>
      <label class="block text-label-sm text-on-surface-variant mb-1">${kacis(etiket)}</label>
      <input data-ayar="${k}" type="${tip}" step="any" value="${kacis(V.ayarlar[k] ?? '')}"
        class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white" />
    </div>`).join('')
  return `<div class="max-w-3xl space-y-4">
      <div class="p-3 rounded-xl bg-surface-container text-body-sm text-on-surface-variant">
        Bu değerler <b>ilan görselindeki</b> kampanya metinlerini üretir. Kaydedince
        <b>tüm görseller eski işaretlenir</b>; “İlan Görselleri” sekmesinden tek tuşla tazelenir.
        Peşinat ve taksit rakamları buradan gelmez — onlar araç fiyatı ve TSB kaskodan hesaplanır.
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${alanlar}</div>
      <div class="flex items-center gap-3">
        <button id="kampanyaKaydet" class="bg-primary text-on-primary px-4 py-2 rounded-lg text-label-md font-bold">Kaydet</button>
        <span id="kampanyaDurum" class="text-body-sm text-on-surface-variant"></span>
      </div>
    </div>`
}

async function kampanyaKaydet(btn) {
  const durumEl = document.getElementById('kampanyaDurum')
  btn.disabled = true
  if (durumEl) { durumEl.textContent = 'Kaydediliyor…'; durumEl.className = 'text-body-sm text-on-surface-variant' }

  const degisen = []
  for (const [k] of KAMPANYA_ALANLARI) {
    const el = document.querySelector(`[data-ayar="${k}"]`)
    if (!el) continue
    const yeni = String(el.value).trim()
    if (yeni !== String(V.ayarlar[k] ?? '')) degisen.push([k, yeni])
  }
  if (!degisen.length) {
    if (durumEl) durumEl.textContent = 'Değişiklik yok.'
    btn.disabled = false
    return
  }

  let yazilan = 0
  for (const [k, v] of degisen) {
    // ⚠️ upsert DEĞİL update: satırlar sql/107 ile zaten var. upsert olsaydı
    // yetkisiz kullanıcıda INSERT yolu denenir ve hata "yetkiniz yok" yerine
    // anlamsız bir çakışma hatası olarak dönerdi.
    const { data, error } = await supabase.from('ayarlar')
      .update({ deger: v }).eq('anahtar', k).select('anahtar')
    if (error) { dbHata('kampanya ayarı ' + k, error); continue }
    // §5.1 — RLS engellerse hata YOK, sessizce 0 satır.
    if (data?.length) yazilan++
  }

  btn.disabled = false
  const tamam = yazilan === degisen.length
  // ⚠️ MESAJ TOAST'A TAŞINDI. `durumEl` #icerik'in içindeydi ve hemen alttaki
  //   `yukle()` ilk işi olarak #icerik.innerHTML'i "Yükleniyor…" ile eziyordu
  //   — kullanıcı ne "✓ kaydedildi" ne de "yetkiniz olmayabilir" uyarısını
  //   GÖREBİLİYORDU. §5.1 kısmi-başarı tespiti doğru yapılıp çöpe atılıyordu.
  toast(tamam ? `${yazilan} ayar kaydedildi — görseller eski işaretlendi.`
              : `${yazilan}/${degisen.length} kaydedildi — yetkiniz olmayabilir.`, tamam)
  await yukle()
}
