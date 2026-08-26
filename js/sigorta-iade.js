// =====================================================================
// sigorta-iade.js — Şirket İadeleri (sigorta personeli girer → finans öder)
//
//   Akış (sql/79):
//     1) Sigorta personeli iadeyi girer  → durum='bekliyor'
//     2) Kayıt finansa (Bahadır) köprü RPC'siyle düşer
//     3) Finans öder → sigorta_iade_tamamla() RPC → durum='iade_edildi'
//
//   ÖNEMLİ: "İadesi Yapıldı" butonu BU SAYFADA YOKTUR. Durum güncellemesi
//   yalnız finans köprüsünün RPC'siyle yapılır (sql/79). Bu ekran sadece
//   giriş + izleme yapar; para iki yerden yazılmaz (bkz. .ai/00 §14.1).
//
//   Kart bilgisi ZORUNLU: odeme_kart_id VEYA odeme_kart_manuel dolu olmalı
//   (DB CHECK `sigorta_iade_kart_zorunlu`). Aynı kural formda da uygulanır.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, fmtTarihKisa, dbHata, bugunISO, danismanMap, danismanAdi } from './veri.js'
import { mat, uyari, bosDurum, binlikInputKur, kpiKart, sekmeBar, stitchTablo, sayfaBaslik, pill } from './stitch-ui.js'
import { kartBloguCiz, kartEtiket as kartEtiketOrtak, KART_ALANLAR } from './kart-gorsel.js'

let benim = null
let danMap = {}

// Sayfa durumu
const S = {
  sekme: 'bekliyor',     // 'bekliyor' | 'iade_edildi'
  liste: [],
  kartlar: [],           // odeme_kartlari (aktif)
  turler: [],            // police_turleri (aktif)
  yukleniyor: true,
  hata: null,
  kesildi: false,        // 1000 satır limitine dayanıldı mı (§5.3)
}

// Form durumu (DOM'da tutulmayan seçimler)
const F = {
  police: null,          // seçili poliçe kaydı
  kartMod: 'sistem',     // 'sistem' | 'manuel'
  otoKart: null,         // poliçeden otomatik gelen kart (odeme_kartlari satırı)
  otoKilit: false,       // otomatik kart rozetle gösteriliyor (Değiştir'e basılmadı)
  arama: [],             // son poliçe arama sonucu
}

const LIMIT = 1000
const ALAN_CSS = 'w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'
const ETIKET_CSS = 'block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1'
const HATA_CSS = 'text-label-sm text-error mt-1 hidden'

// Gösterim: Türkçe büyük harf (trBuyuk ARAMA normalizasyonudur, gösterimde kullanılmaz)
const BUY = v => kacis(String(v ?? '').toLocaleUpperCase('tr'))
// ⚠️ Bu ifade burada modül-yerel yazılmıştı ve sigorta-yapboz.js'te
//    bankasız bir kopyası vardı. Artık kart-gorsel.js tek kaynak.
const kartEtiket = kartEtiketOrtak
// Tarih (date, 'YYYY-MM-DD') — veri.js yardımcısı, saat eklenerek TZ kayması önlenir
const tarih = d => d ? fmtTarihKisa(d + 'T00:00:00') : '—'

// IBAN — gösterimde 4'lü gruplar, kayıtta boşluksuz
const ibanHam = s => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 26)
const ibanBicim = s => ibanHam(s).replace(/(.{4})/g, '$1 ').trim()
const ibanGecerli = h => /^TR\d{24}$/.test(h)
// para-gir alanından ham sayı (binlik noktaları temizlenir)
const paraHam = v => String(v || '').replace(/\./g, '').replace(/[^\d]/g, '')

// =====================================================================
// GİRİŞ NOKTASI
// =====================================================================
export async function sigortaIadeKur(danisman) {
  benim = danisman
  binlikInputKur()

  const kok = document.getElementById('kok')
  kok.innerHTML = kabuk()
  olaylariBagla()

  danMap = await danismanMap()
  await refVeriYukle()
  await listeYukle()
}

// --- Referans veriler (kart listesi + ürün/poliçe türleri) --------------
async function refVeriYukle() {
  const [k, t] = await Promise.all([
    // Kart görseli için alt uzantı ve ilk dört de gerekiyor (sql/224).
    supabase.from('odeme_kartlari').select(KART_ALANLAR).eq('aktif', true).order('ad'),
    supabase.from('police_turleri').select('id, ad').eq('aktif', true).order('sira'),
  ])
  dbHata('odeme_kartlari oku', k.error)
  dbHata('police_turleri oku', t.error)
  S.kartlar = k.data || []
  S.turler = t.data || []

  const sel = document.getElementById('siKartSec')
  sel.innerHTML = '<option value="">— kart seçin —</option>' +
    S.kartlar.map(x => `<option value="${kacis(x.id)}">${kacis(kartEtiket(x))}</option>`).join('')
  if (!S.kartlar.length) {
    document.getElementById('siKartNot').textContent = 'Tanımlı kart yok — Tanımlar’dan ekleyin ya da kartı elle yazın.'
  }

  const urun = document.getElementById('siUrunSec')
  urun.innerHTML = '<option value="">— ürün seçin —</option>' +
    S.turler.map(x => `<option value="${kacis(x.ad)}">${kacis(x.ad)}</option>`).join('') +
    '<option value="__serbest">Diğer (elle yazacağım)…</option>'
}

// --- Liste ---------------------------------------------------------------
async function listeYukle() {
  S.yukleniyor = true; S.hata = null; ciz()
  const { data, error } = await supabase.from('sigorta_iadeleri')
    .select(`id, police_id, musteri_adi, musteri_iban, urun_adi, iade_tutari, islem_tarihi,
             odeme_kart_id, odeme_kart_manuel, durum, not_metni, giren,
             iade_edildigi_tarih, odeyen_ref, created_at,
             odeme_kartlari(ad, son_dort, banka), policeler(police_no)`)
    .order('created_at', { ascending: false })
    .limit(LIMIT)
  S.yukleniyor = false
  if (dbHata('sigorta_iadeleri liste oku', error)) {
    S.hata = error.message; S.liste = []; ciz(); return
  }
  S.liste = data || []
  S.kesildi = S.liste.length >= LIMIT
  ciz()
}

// =====================================================================
// KABUK (bir kez basılır — form alanları yeniden çizilmez, girdi kaybolmaz)
// =====================================================================
function kabuk() {
  return `
    ${sayfaBaslik('Şirket İadeleri', 'Sigorta şirketinden müşteriye yapılacak iadeler — girildiğinde finansa düşer, ödemeyi finans işaretler.')}

    <div id="siKpi" class="grid grid-cols-1 sm:grid-cols-3 gap-gutter mt-lg"></div>

    <!-- ---------------------------------------------------------------- -->
    <!-- İade Giriş Formu                                                  -->
    <!-- ---------------------------------------------------------------- -->
    <section class="bg-surface-container-lowest border border-outline-variant rounded-2xl custom-shadow mt-lg overflow-hidden">
      <button type="button" id="siFormAc" aria-expanded="true" aria-controls="siFormGovde"
        class="w-full flex items-center justify-between gap-3 px-lg py-4 text-left hover:bg-surface-container-low transition-colors">
        <span class="flex items-center gap-2 text-title-lg font-bold text-primary">${mat('add_circle', 'text-[22px]')} Yeni İade Girişi</span>
        <span id="siFormOk" class="text-on-surface-variant">${mat('expand_less')}</span>
      </button>

      <form id="siForm" novalidate class="px-lg pb-lg space-y-4 border-t border-outline-variant pt-4">

        <!-- Poliçe arama (opsiyonel) -->
        <div class="bg-surface-container-low rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <label for="siPoliceQ" class="${ETIKET_CSS} mb-0">Poliçe Ara <span class="normal-case font-medium tracking-normal">(opsiyonel — müşteri, ürün ve kart otomatik dolar)</span></label>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <input id="siPoliceQ" type="search" placeholder="Poliçe no veya plaka…" autocomplete="off" class="${ALAN_CSS} flex-1" />
            <button type="button" id="siPoliceAra" class="bg-surface border border-outline-variant text-on-surface-variant px-4 h-[42px] rounded-lg text-label-md font-bold hover:border-primary hover:text-primary flex items-center justify-center gap-1.5">${mat('search', 'text-[18px]')} Ara</button>
          </div>
          <div id="siPoliceSonuc" class="space-y-1"></div>
          <div id="siPoliceSecili" class="hidden"></div>
        </div>

        <!-- Müşteri -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label for="siMusteri" class="${ETIKET_CSS}">Müşteri Adı Soyadı <span class="text-error">*</span></label>
            <input id="siMusteri" class="${ALAN_CSS}" autocomplete="off" />
            <p id="siMusteriHata" class="${HATA_CSS}" role="alert"></p>
          </div>
          <div>
            <label for="siIban" class="${ETIKET_CSS}">IBAN <span class="text-error">*</span></label>
            <input id="siIban" class="${ALAN_CSS} font-mono" placeholder="TR00 0000 0000 0000 0000 0000 00" autocomplete="off" inputmode="text" />
            <p id="siIbanHata" class="${HATA_CSS}" role="alert"></p>
            <p id="siIbanUyari" class="text-label-sm text-amber-700 mt-1 hidden">IBAN TR ile başlayıp 26 karakter olmalı — kontrol edin.</p>
          </div>
        </div>

        <!-- Ürün · Tutar · Tarih -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label for="siUrunSec" class="${ETIKET_CSS}">Ürün Adı <span class="text-error">*</span></label>
            <select id="siUrunSec" class="${ALAN_CSS}"><option value="">— ürün seçin —</option></select>
            <input id="siUrunSerbest" class="${ALAN_CSS} mt-2 hidden" placeholder="Ürün adını yazın…" autocomplete="off" />
            <p id="siUrunHata" class="${HATA_CSS}" role="alert"></p>
          </div>
          <div>
            <label for="siTutar" class="${ETIKET_CSS}">İade Tutarı (₺) <span class="text-error">*</span></label>
            <input id="siTutar" class="para-gir ${ALAN_CSS} text-right font-bold" inputmode="numeric" autocomplete="off" placeholder="0" />
            <p id="siTutarHata" class="${HATA_CSS}" role="alert"></p>
          </div>
          <div>
            <label for="siTarih" class="${ETIKET_CSS}">İşlem Tarihi <span class="text-error">*</span></label>
            <input id="siTarih" type="date" value="${bugunISO()}" class="${ALAN_CSS}" />
            <p class="text-label-sm text-on-surface-variant mt-1">İadenin fiilen yapıldığı tarih.</p>
            <p id="siTarihHata" class="${HATA_CSS}" role="alert"></p>
          </div>
        </div>

        <!-- Ödeme kartı (ZORUNLU — sistemden ya da elle) -->
        <div class="bg-surface-container-low rounded-xl p-4 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span class="${ETIKET_CSS} mb-0">Ödeme Kartı <span class="text-error">*</span></span>
            <div class="inline-flex rounded-lg border border-outline-variant overflow-hidden self-start" role="group" aria-label="Kart giriş yöntemi">
              <button type="button" data-kartmod="sistem" class="px-3 py-2 text-label-md font-bold bg-primary text-on-primary">Sistemdeki kart</button>
              <button type="button" data-kartmod="manuel" class="px-3 py-2 text-label-md font-bold bg-surface text-on-surface-variant">Sistemde yok — elle</button>
            </div>
          </div>

          <div id="siKartSistem" class="space-y-2">
            <div id="siKartOto" class="hidden items-center justify-between gap-2 bg-surface border border-outline-variant rounded-lg px-3 py-2.5">
              <span class="flex items-center gap-2 min-w-0">${mat('credit_card', 'text-primary text-[20px]')}<span id="siKartOtoAd" class="font-semibold text-on-surface truncate"></span></span>
              <span class="flex items-center gap-2 shrink-0">
                ${pill('Poliçeden', 'bilgi')}
                <button type="button" id="siKartDegistir" class="text-label-md font-bold text-primary hover:underline">Değiştir</button>
              </span>
            </div>
            <div id="siKartSecSar">
              <label for="siKartSec" class="sr-only">Kart seçimi</label>
              <select id="siKartSec" class="${ALAN_CSS}"><option value="">— kart seçin —</option></select>
            </div>
            <!-- İade hangi karta gelecek — tam bilgi, kopyalanabilir (Göksenil, 19 Ağu 2026) -->
            <div id="siKartGorsel"></div>
          </div>

          <div id="siKartManuelSar" class="hidden">
            <label for="siKartManuel" class="${ETIKET_CSS}">Kart Bilgisi (elle)</label>
            <input id="siKartManuel" class="${ALAN_CSS}" placeholder="Örn. Garanti şirket kartı ••••1234" autocomplete="off" />
          </div>

          <p id="siKartNot" class="text-label-sm text-on-surface-variant"></p>
          <p id="siKartHata" class="${HATA_CSS}" role="alert"></p>
        </div>

        <!-- Not -->
        <div>
          <label for="siNot" class="${ETIKET_CSS}">Not</label>
          <input id="siNot" class="${ALAN_CSS}" placeholder="İsteğe bağlı…" autocomplete="off" />
        </div>

        <div id="siMesaj" class="hidden" aria-live="polite"></div>

        <div class="flex flex-col sm:flex-row sm:justify-end gap-2 pt-1">
          <button type="button" id="siTemizle" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Formu Temizle</button>
          <button type="submit" id="siKaydet" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5">${mat('send', 'text-[18px]')} Kaydet ve Finansa Gönder</button>
        </div>
      </form>
    </section>

    <!-- ---------------------------------------------------------------- -->
    <!-- Sekmeler + liste                                                  -->
    <!-- ---------------------------------------------------------------- -->
    <div id="siSekmeler" class="mt-lg"></div>
    <div id="siListe" class="mt-lg"></div>`
}

// =====================================================================
// OLAYLAR
// =====================================================================
function olaylariBagla() {
  const q = id => document.getElementById(id)

  // Form aç/kapa
  q('siFormAc').addEventListener('click', () => {
    const g = q('siForm'), acik = !g.classList.contains('hidden')
    g.classList.toggle('hidden', acik)
    q('siFormAc').setAttribute('aria-expanded', String(!acik))
    q('siFormOk').innerHTML = mat(acik ? 'expand_more' : 'expand_less')
  })

  // Poliçe arama
  q('siPoliceAra').addEventListener('click', policeAra)
  q('siPoliceQ').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); policeAra() }
    if (e.key === 'Escape') { e.preventDefault(); q('siPoliceSonuc').innerHTML = '' }
  })

  // IBAN canlı biçimlendirme + yumuşak uyarı
  q('siIban').addEventListener('input', e => {
    e.target.value = ibanBicim(e.target.value)
    ibanUyariGuncelle()
  })

  // Ürün: "Diğer" seçilirse serbest metin
  q('siUrunSec').addEventListener('change', e => {
    const serbest = e.target.value === '__serbest'
    q('siUrunSerbest').classList.toggle('hidden', !serbest)
    if (serbest) q('siUrunSerbest').focus()
  })

  // Kart modu
  document.querySelectorAll('[data-kartmod]').forEach(b => b.addEventListener('click', () => kartModAyarla(b.dataset.kartmod)))
  // Kart elle değiştirilince görsel de değişmeli — yoksa yanlış kartın
  // numarası ekranda kalır (yapboz ekranında aynı kusur vardı).
  q('siKartSec').addEventListener('change', kartGorunum)
  q('siKartDegistir').addEventListener('click', () => { F.otoKilit = false; kartGorunum() })

  // Kaydet / temizle
  q('siForm').addEventListener('submit', e => { e.preventDefault(); kaydet() })
  q('siTemizle').addEventListener('click', () => { formTemizle(); q('siMusteri').focus() })
}

function ibanUyariGuncelle() {
  const h = ibanHam(document.getElementById('siIban').value)
  document.getElementById('siIbanUyari').classList.toggle('hidden', !h || ibanGecerli(h))
}

function kartModAyarla(mod) {
  F.kartMod = mod
  document.querySelectorAll('[data-kartmod]').forEach(b => {
    const a = b.dataset.kartmod === mod
    b.className = `px-3 py-2 text-label-md font-bold ${a ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant'}`
  })
  kartGorunum()
}

function kartGorunum() {
  const sistem = F.kartMod === 'sistem'
  document.getElementById('siKartSistem').classList.toggle('hidden', !sistem)
  document.getElementById('siKartManuelSar').classList.toggle('hidden', sistem)
  const otoVar = sistem && F.otoKart && F.otoKilit
  const oto = document.getElementById('siKartOto')
  oto.classList.toggle('hidden', !otoVar)
  oto.classList.toggle('flex', !!otoVar)
  document.getElementById('siKartSecSar').classList.toggle('hidden', !!otoVar)
  if (F.otoKart) document.getElementById('siKartOtoAd').textContent = kartEtiket(F.otoKart)

  // Kart görseli: sistem kartı seçiliyse çiz, elle IBAN modunda gizle.
  // Kaynak tek: otomatik kilitliyse F.otoKart, değilse select'in değeri.
  const hedef = document.getElementById('siKartGorsel')
  if (!sistem) { hedef.innerHTML = ''; return }
  const secId = otoVar ? F.otoKart.id : document.getElementById('siKartSec').value
  kartBloguCiz(hedef, S.kartlar.find(k => k.id === secId), 'sigorta-iade')
}

// =====================================================================
// POLİÇE ARAMA → müşteri / ürün / kart otomatik doldurma
// =====================================================================
async function policeAra() {
  const kutu = document.getElementById('siPoliceSonuc')
  const q = document.getElementById('siPoliceQ').value.trim()
  if (q.length < 2) { kutu.innerHTML = `<p class="text-label-md text-on-surface-variant">En az 2 karakter yazın.</p>`; return }
  kutu.innerHTML = `<p class="text-label-md text-on-surface-variant flex items-center gap-1.5">${mat('progress_activity', 'text-[16px] animate-spin')} Aranıyor…</p>`

  const alanlar = 'id, police_no, baslangic, bitis, tur_id, police_turleri(ad), sigorta_araclari(plaka), sigorta_musterileri(ad_soyad)'
  // 1) Poliçe no  2) Plaka (araç üzerinden) — iki sorgu, sonuç birleştirilir
  const { data: aracList, error: eA } = await supabase.from('sigorta_araclari')
    .select('id').ilike('plaka', `%${q}%`).limit(20)
  if (dbHata('sigorta_araclari plaka ara', eA)) { kutu.innerHTML = uyari('Araç araması başarısız: ' + kacis(eA.message)); return }
  const aracIds = (aracList || []).map(a => a.id)

  const [p1, p2] = await Promise.all([
    supabase.from('policeler').select(alanlar).ilike('police_no', `%${q}%`).order('baslangic', { ascending: false }).limit(20),
    aracIds.length
      ? supabase.from('policeler').select(alanlar).in('arac_id', aracIds).order('baslangic', { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (dbHata('policeler no ara', p1.error) || dbHata('policeler plaka ara', p2.error)) {
    kutu.innerHTML = uyari('Poliçe araması başarısız: ' + kacis((p1.error || p2.error).message)); return
  }

  const harita = new Map()
  ;[...(p1.data || []), ...(p2.data || [])].forEach(p => harita.set(p.id, p))
  F.arama = [...harita.values()].slice(0, 20)

  if (!F.arama.length) {
    kutu.innerHTML = `<p class="text-label-md text-on-surface-variant">Sonuç yok — poliçe sistemde olmayabilir. Alanları elle doldurup kartı “elle” girebilirsiniz.</p>`
    return
  }
  kutu.innerHTML = F.arama.map(p => `
    <button type="button" data-pol="${kacis(p.id)}" class="w-full text-left bg-surface border border-outline-variant rounded-lg px-3 py-2 hover:border-primary hover:bg-surface-container-low transition-colors flex items-center justify-between gap-3">
      <span class="min-w-0">
        <span class="font-semibold text-on-surface font-mono">${kacis(p.police_no || '—')}</span>
        <span class="text-on-surface-variant text-label-md"> · ${BUY(p.sigorta_araclari?.plaka || '—')}</span>
        <span class="block text-label-sm text-on-surface-variant truncate">${BUY(p.sigorta_musterileri?.ad_soyad || 'Müşteri bağlı değil')} · ${kacis(p.police_turleri?.ad || '—')}</span>
      </span>
      <span class="text-label-sm text-on-surface-variant shrink-0">${tarih(p.baslangic)}</span>
    </button>`).join('')
  kutu.querySelectorAll('[data-pol]').forEach(b => b.addEventListener('click', () => policeSec(b.dataset.pol)))
}

async function policeSec(id) {
  const p = F.arama.find(x => x.id === id); if (!p) return
  F.police = p
  document.getElementById('siPoliceSonuc').innerHTML = ''
  document.getElementById('siPoliceQ').value = ''

  const secili = document.getElementById('siPoliceSecili')
  secili.className = 'flex items-center justify-between gap-2 bg-surface border border-primary/40 rounded-lg px-3 py-2.5'
  secili.innerHTML = `<span class="flex items-center gap-2 min-w-0">${mat('link', 'text-primary text-[20px]')}
      <span class="min-w-0"><span class="font-semibold font-mono text-on-surface">${kacis(p.police_no || '—')}</span>
      <span class="block text-label-sm text-on-surface-variant truncate">${BUY(p.sigorta_araclari?.plaka || '—')} · ${kacis(p.police_turleri?.ad || '—')}</span></span></span>
    <button type="button" id="siPoliceKaldir" class="text-label-md font-bold text-on-surface-variant hover:text-error shrink-0">Bağlantıyı kaldır</button>`
  document.getElementById('siPoliceKaldir').addEventListener('click', policeKaldir)

  // Ön dolum: müşteri + ürün
  const ad = p.sigorta_musterileri?.ad_soyad
  if (ad) document.getElementById('siMusteri').value = String(ad).toLocaleUpperCase('tr')
  const urun = p.police_turleri?.ad
  if (urun && S.turler.some(t => t.ad === urun)) {
    document.getElementById('siUrunSec').value = urun
    document.getElementById('siUrunSerbest').classList.add('hidden')
  }

  await kartOtoDoldur(p.id)
}

function policeKaldir() {
  F.police = null; F.otoKart = null; F.otoKilit = false
  const s = document.getElementById('siPoliceSecili')
  s.className = 'hidden'; s.innerHTML = ''
  document.getElementById('siKartNot').textContent = ''
  kartGorunum()
}

// Poliçenin tahsilat hareketinden kartı bul:
//   police_hareketleri.kart_id → odeme_kartlari
//   Öncelik: MÜŞTERİ tarafı KESİM (müşterinin ödediği kart) → herhangi KESİM → en yeni hareket
async function kartOtoDoldur(policeId) {
  const not = document.getElementById('siKartNot')
  not.textContent = 'Kart aranıyor…'
  const { data, error } = await supabase.from('police_hareketleri')
    .select('id, tip, taraf, kart_id, islem_tarihi, odeme_kartlari(id, ad, sahip_adi, son_dort, banka)')
    .eq('police_id', policeId).not('kart_id', 'is', null)
    .order('islem_tarihi', { ascending: false }).limit(20)
  if (dbHata('police_hareketleri kart oku', error)) {
    not.textContent = 'Kart okunamadı: ' + error.message
    return
  }
  const rows = data || []
  const sec = rows.find(r => r.tip === 'KESIM' && r.taraf === 'MUSTERI') || rows.find(r => r.tip === 'KESIM') || rows[0]
  const kart = sec?.odeme_kartlari || null
  if (!kart) {
    F.otoKart = null; F.otoKilit = false
    not.textContent = 'Bu poliçede kayıtlı kart bulunamadı — kartı seçin ya da elle yazın.'
    kartGorunum(); return
  }
  F.otoKart = kart; F.otoKilit = true
  kartModAyarla('sistem')
  const sel = document.getElementById('siKartSec')
  if (S.kartlar.some(k => k.id === kart.id)) sel.value = kart.id
  not.textContent = 'Kart poliçe tahsilat hareketinden otomatik geldi.'
  kartGorunum()
}

// =====================================================================
// KAYDET
// =====================================================================
function hataGoster(id, metin) {
  const el = document.getElementById(id)
  el.textContent = metin || ''
  el.classList.toggle('hidden', !metin)
}

function mesajGoster(tip, metin) {
  const el = document.getElementById('siMesaj')
  el.className = tip === 'basari'
    ? 'flex items-center gap-2 bg-secondary-container text-on-secondary-container rounded-lg px-3 py-2.5 text-body-md'
    : 'flex items-center gap-2 bg-error-container text-on-error-container rounded-lg px-3 py-2.5 text-body-md'
  el.innerHTML = `${mat(tip === 'basari' ? 'check_circle' : 'error', 'text-[18px]')}<span>${kacis(metin)}</span>`
}
function mesajGizle() { const el = document.getElementById('siMesaj'); el.className = 'hidden'; el.innerHTML = '' }

function urunDegeri() {
  const sec = document.getElementById('siUrunSec').value
  return sec === '__serbest' ? document.getElementById('siUrunSerbest').value.trim() : sec
}

async function kaydet() {
  mesajGizle()
  const q = id => document.getElementById(id)
  const musteri = q('siMusteri').value.trim().toLocaleUpperCase('tr')
  const iban = ibanHam(q('siIban').value)
  const urun = urunDegeri()
  const tutar = Number(paraHam(q('siTutar').value))
  const islemTarihi = q('siTarih').value
  const kartId = (F.kartMod === 'sistem') ? (q('siKartSec').value || (F.otoKilit && F.otoKart ? F.otoKart.id : '')) : ''
  const kartManuel = (F.kartMod === 'manuel') ? q('siKartManuel').value.trim() : ''
  const notMetni = q('siNot').value.trim()

  // --- Doğrulama (hatalar alan altında) --------------------------------
  let ilkHata = null
  const kontrol = (id, kosul, metin, odak) => {
    hataGoster(id, kosul ? '' : metin)
    if (!kosul && !ilkHata) ilkHata = odak
  }
  kontrol('siMusteriHata', !!musteri, 'Müşteri adı soyadı zorunlu.', 'siMusteri')
  kontrol('siIbanHata', !!iban, 'IBAN zorunlu.', 'siIban')
  kontrol('siUrunHata', !!urun, 'Ürün adı zorunlu.', 'siUrunSec')
  kontrol('siTutarHata', tutar > 0, 'İade tutarı 0’dan büyük olmalı.', 'siTutar')
  kontrol('siTarihHata', !!islemTarihi, 'İşlem tarihi zorunlu.', 'siTarih')
  // DB CHECK `sigorta_iade_kart_zorunlu` ile birebir: biri dolu olmak zorunda
  kontrol('siKartHata', !!(kartId || kartManuel),
    F.kartMod === 'sistem' ? 'Kart seçin ya da “Sistemde yok — elle” ile kart bilgisini yazın.' : 'Kart bilgisini yazın.',
    F.kartMod === 'sistem' ? 'siKartSec' : 'siKartManuel')
  ibanUyariGuncelle()   // TR/26 hane yumuşak uyarı — kaydı engellemez
  if (ilkHata) { document.getElementById(ilkHata)?.focus(); return }

  const btn = q('siKaydet'); btn.disabled = true
  const kayit = {
    police_id: F.police?.id || null,
    musteri_adi: musteri,
    musteri_iban: iban,
    urun_adi: urun,
    iade_tutari: tutar,
    islem_tarihi: islemTarihi,
    odeme_kart_id: kartId || null,
    odeme_kart_manuel: kartManuel || null,
    durum: 'bekliyor',
    not_metni: notMetni || null,
    giren: benim?.id || null,
  }
  const { data, error } = await supabase.from('sigorta_iadeleri').insert(kayit).select('id')
  btn.disabled = false
  if (dbHata('sigorta_iadeleri insert', error)) {
    mesajGoster('hata', 'Kaydedilemedi: ' + error.message); return
  }
  if (!data || !data.length) {
    console.error('[sigorta-iade] insert 0 satır döndü (RLS?)', kayit)
    mesajGoster('hata', 'Kayıt oluşmadı — yetkiniz olmayabilir. Bilgi İşlem’e bildirin.'); return
  }
  formTemizle()
  mesajGoster('basari', 'İade kaydedildi ve finansa gönderildi. Ödeme yapıldığında “İadesi Yapılanlar” sekmesine geçer.')
  setTimeout(mesajGizle, 10000)
  S.sekme = 'bekliyor'
  await listeYukle()
}

function formTemizle() {
  const q = id => document.getElementById(id)
  ;['siMusteri', 'siIban', 'siTutar', 'siNot', 'siKartManuel', 'siUrunSerbest', 'siPoliceQ'].forEach(id => { q(id).value = '' })
  q('siUrunSec').value = ''
  q('siUrunSerbest').classList.add('hidden')
  q('siKartSec').value = ''
  q('siTarih').value = bugunISO()
  q('siPoliceSonuc').innerHTML = ''
  q('siIbanUyari').classList.add('hidden')
  ;['siMusteriHata', 'siIbanHata', 'siUrunHata', 'siTutarHata', 'siTarihHata', 'siKartHata'].forEach(id => hataGoster(id, ''))
  policeKaldir()
  kartModAyarla('sistem')
}

// =====================================================================
// ÇİZİM — KPI · sekmeler · liste
// =====================================================================
function ciz() { kpiCiz(); sekmelerCiz(); listeCiz() }

const bekleyenler = () => S.liste.filter(x => x.durum === 'bekliyor')
const yapilanlar = () => S.liste.filter(x => x.durum === 'iade_edildi')

function kpiCiz() {
  const bek = bekleyenler()
  const bekTutar = bek.reduce((t, x) => t + (Number(x.iade_tutari) || 0), 0)
  const buAy = new Date().toISOString().slice(0, 7)
  const ayTutar = yapilanlar()
    .filter(x => (x.iade_edildigi_tarih || '').slice(0, 7) === buAy)
    .reduce((t, x) => t + (Number(x.iade_tutari) || 0), 0)
  document.getElementById('siKpi').innerHTML =
    kpiKart('hourglass_top', 'bg-amber-100 text-amber-700', bek.length, 'Bekleyen İade', 'Finans ödemesi bekliyor') +
    kpiKart('payments', 'bg-primary/10 text-primary', fmtPara(bekTutar), 'Bekleyen Toplam Tutar') +
    kpiKart('task_alt', 'bg-secondary-container text-on-secondary-container', fmtPara(ayTutar), 'Bu Ay İade Edilen', 'İçinde bulunulan ay')
}

function sekmelerCiz() {
  const kok = document.getElementById('siSekmeler')
  kok.innerHTML = sekmeBar([
    ['bekliyor', 'Bekleyen İadeler', 'hourglass_top', bekleyenler().length],
    ['iade_edildi', 'İadesi Yapılanlar', 'task_alt', yapilanlar().length],
  ], S.sekme)
  kok.querySelectorAll('[data-sekme]').forEach(b => b.addEventListener('click', () => { S.sekme = b.dataset.sekme; ciz() }))
}

// Kart hücresi — kaynak rozetiyle (SİSTEM / MANUEL)
function kartHucre(r) {
  if (r.odeme_kart_id && r.odeme_kartlari) {
    return `<span class="inline-flex flex-wrap items-center gap-1.5">${kacis(kartEtiket(r.odeme_kartlari))} ${pill('SİSTEM', 'bilgi')}</span>`
  }
  if (r.odeme_kart_manuel) {
    return `<span class="inline-flex flex-wrap items-center gap-1.5">${kacis(r.odeme_kart_manuel)} ${pill('MANUEL', 'notr')}</span>`
  }
  return '—'
}

function listeCiz() {
  const kok = document.getElementById('siListe')
  if (S.yukleniyor) {
    kok.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 space-y-3 custom-shadow">
      ${Array.from({ length: 4 }, () => `<div class="h-10 rounded-lg bg-surface-container-high animate-pulse"></div>`).join('')}
    </div>`
    return
  }
  if (S.hata) {
    kok.innerHTML = uyari(`İadeler okunamadı: ${kacis(S.hata)} <button type="button" id="siTekrar" class="ml-2 underline font-bold">Tekrar dene</button>`)
    document.getElementById('siTekrar')?.addEventListener('click', listeYukle)
    return
  }

  const bekliyor = S.sekme === 'bekliyor'
  const rows = bekliyor ? bekleyenler() : yapilanlar()
  if (!rows.length) {
    kok.innerHTML = bosDurum(bekliyor ? 'Bekleyen iade yok. Yeni iadeyi yukarıdaki formdan girin.' : 'Henüz iadesi yapılan kayıt yok.', bekliyor ? 'hourglass_empty' : 'task_alt')
    return
  }

  // Not: stitchTablo'da [baslik, true] bayrağı YALNIZ son kolonda anlamlı
  // (sağa sabitlenen aksiyon kolonu). Tutar kolonunda kullanılmaz.
  const basliklar = bekliyor
    ? ['Müşteri', 'Ürün', 'Tutar', 'İşlem Tarihi', 'Kart', 'Giren', 'Not']
    : ['Müşteri', 'Ürün', 'Tutar', 'İşlem Tarihi', 'İade Edildiği Tarih', 'Ödeyen', 'Kart']

  const satirlar = rows.map(r => {
    const musteri = `<div class="font-bold text-on-surface">${BUY(r.musteri_adi)}</div>
      <div class="text-label-sm text-on-surface-variant font-mono">${kacis(ibanBicim(r.musteri_iban))}</div>
      ${r.policeler?.police_no ? `<div class="text-label-sm text-on-surface-variant">Poliçe ${kacis(r.policeler.police_no)}</div>` : ''}`
    const tutar = `<span class="font-bold whitespace-nowrap">${fmtPara(r.iade_tutari)}</span>`
    return {
      hucreler: bekliyor
        ? [musteri, kacis(r.urun_adi), tutar, tarih(r.islem_tarihi), kartHucre(r), kacis(danismanAdi(danMap, r.giren)), kacis(r.not_metni || '—')]
        : [musteri, kacis(r.urun_adi), tutar, tarih(r.islem_tarihi), tarih(r.iade_edildigi_tarih), kacis(r.odeyen_ref || '—'), kartHucre(r)],
    }
  })

  const not = bekliyor
    ? `<div class="flex items-start gap-2 bg-surface-container-low border border-outline-variant text-on-surface-variant rounded-xl px-4 py-3 mb-md text-body-md">
         ${mat('info', 'text-primary text-[20px]')}<span>Bu kayıtlar finansa düştü. <b>“İadesi Yapıldı”</b> işaretini finans birimi koyar — bu ekrandan işaretlenmez.</span></div>`
    : ''
  const kesikNot = S.kesildi
    ? `<p class="text-label-sm text-on-surface-variant mt-sm">Yalnız en yeni ${LIMIT} kayıt gösteriliyor.</p>`
    : ''
  kok.innerHTML = not + stitchTablo(basliklar, satirlar) + kesikNot
}
