// =====================================================================
// musteri-merkezi.js — Müşteri Merkezi (next-gen Stitch tasarımı, PROJE bordo
//   temasına uyarlanmış). Müşteri master'ın (musteriler + musteri_kimlik) tek
//   komuta ekranı: KPI + liste + Customer 360 önizleme paneli + Yeni Müşteri.
//   Tasarım kaynağı: stitch_next_gen_crm_workspace. Renkler proje token'ları
//   (tema.js) — lacivert kullanılmaz. Tüm VERİ değerleri büyük harf (trBuyuk).
// =====================================================================
import { supabase } from './supabase-client.js'
import { danismanMap, danismanAdi, fmtPara, fmtTarih, telNo, waHref, telBicim, telSifirla, kacis, trBuyuk, buyuk, dbHata } from './veri.js'
import { mat, basHarf, bosDurum, uyari } from './stitch-ui.js'

const KOK = () => document.getElementById('kok')
let TUM = []            // müşteriler (+ kimlik, +bakiye, +araç)
let DMAP = {}           // danışman id → ad
let secili = null       // seçili müşteri id
let arama = ''
let sayfa = 1                 // liste sayfası (Göksenil: sayfada 20 kayıt)
const SAYFA_BOY = 20

// Büyük-harf VERİ + kaçış (Türkçe-doğru; tr_upper ile birebir)
const B = v => kacis(buyuk(v ?? ''))

export async function musteriMerkeziKur() {
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant text-body-md">Müşteriler yükleniyor…</div>`
  DMAP = await danismanMap()
  await yukle()
}

async function yukle() {
  // BİRLEŞİK LİSTE (sql/126): CRM müşterileri + yalnız sigortada olanlar.
  // ⚠️ GÖÇ DEĞİL. Sigortadaki 1782 kaydın 1728'inde HİÇBİR kimlik yok
  //   (telefon 0 adet) — ana tabloya taşımak listeyi kullanılamaz yapardı.
  //   security_invoker: danışman sigorta satırlarını GÖRMEZ (RLS).
  // ⚠️ 5000 limiti AÇIKÇA veriliyor: varsayılan 1000 satır sessizce keserdi
  //   ve "müşterim kayıp" denirdi (CLAUDE.md §5.3).
  // ⚠️ .limit(5000) YETMEZ — PostgREST SUNUCUDA 1000 satırda keser ve HATA
  //   VERMEZ. Canlıda görüldü: 1790 kayıt varken "Toplam Müşteri 1.000"
  //   yazıyordu; KPI'lar da (mükerrer, aktif) eksik kümeden hesaplanıyordu.
  //   Bu yüzden SAYFALAMA şart (CLAUDE.md §5.3).
  const KOLON = 'id, kaynak_modul, tip, ad_soyad, telefon, telefon_norm, e_posta, meslek_grubu, kvkk_izni, kaynak, adres, notlar, olusturan, created_at, kimlik, police_adedi'
  const SAYFA = 1000
  TUM = []
  for (let bas = 0; ; bas += SAYFA) {
    const { data, error } = await supabase.from('v_musteri_birlesik')
      .select(KOLON).order('created_at', { ascending: false }).range(bas, bas + SAYFA - 1)
    if (error) { dbHata('musteri-merkezi yükle', error); KOK().innerHTML = uyari('Müşteriler okunamadı: ' + kacis(error.message)); return }
    TUM.push(...(data || []))
    if (!data || data.length < SAYFA) break
    if (bas > 50000) { console.warn('[musteri] sayfalama üst sınıra dayandı'); break }   // sonsuz döngü emniyeti
  }

  // Cari bakiye (v_cari_bakiye) + araç ilişkisi (siparişlerde alıcı) eşle
  const [{ data: bak }, { data: sip }] = await Promise.all([
    supabase.from('v_cari_bakiye').select('musteri_id, bakiye'),
    supabase.from('siparisler').select('alici_musteri_id'),
  ])
  const bakMap = new Map((bak || []).map(b => [b.musteri_id, Number(b.bakiye) || 0]))
  const aracSay = {}
  for (const s of (sip || [])) if (s.alici_musteri_id) aracSay[s.alici_musteri_id] = (aracSay[s.alici_musteri_id] || 0) + 1
  for (const m of TUM) {
    m._bakiye = bakMap.get(m.id) ?? 0
    m._arac = aracSay[m.id] || 0
    // PostgREST embed sürüme göre obje VEYA tek elemanlı dizi dönebilir — ikisini de karşıla
    m._tckn = m.kimlik || ''            // view düz kolon veriyor (eskiden nested musteri_kimlik)
    m._sigortaOnly = m.kaynak_modul === 'SIGORTA'
  }

  if (!secili || !TUM.find(m => m.id === secili)) secili = TUM[0]?.id || null
  ciz()
}

// --- Müşteri sağlık durumu (hesaplanır) ---
function saglik(m) {
  const yeni = (Date.now() - new Date(m.created_at)) < 7 * 86400000
  if (m._bakiye < 0) return { nokta: 'bg-error animate-pulse', metin: 'Riskli', renk: 'text-error' }
  if (yeni) return { nokta: 'bg-blue-500', metin: 'Yeni Kayıt', renk: '' }
  return { nokta: 'bg-green-500', metin: 'Kritik Değil', renk: '' }
}
const KAYNAK_IKON = { WEB: 'public', 'INSTAGRAM': 'alternate_email', 'REFERANS': 'person_pin_circle', 'TELEFON': 'call', 'KAPI': 'storefront' }

function filtreli() {
  const q = trBuyuk(arama).trim()
  if (!q) return TUM
  const rakam = arama.replace(/\D/g, '')   // boşsa telefon eşleşmesi ATLANIR (yoksa hepsi eşleşir)
  return TUM.filter(m =>
    trBuyuk(m.ad_soyad).includes(q) ||
    (rakam && (m.telefon_norm || '').includes(rakam)) ||
    (rakam && (m._tckn || '').includes(rakam)))
}

function ciz() {
  const liste = filtreli()
  const secM = TUM.find(m => m.id === secili) || null

  // --- KPI'lar (hepsi gerçek/hesaplanmış) ---
  const toplam = TUM.length
  const buAy = TUM.filter(m => { const d = new Date(m.created_at), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() }).length
  const aktif = TUM.filter(m => (Date.now() - new Date(m.created_at)) < 180 * 86400000).length
  const telSay = {}; for (const m of TUM) if (m.telefon_norm) telSay[m.telefon_norm] = (telSay[m.telefon_norm] || 0) + 1
  const mukerrer = Object.values(telSay).filter(n => n > 1).reduce((a, n) => a + n, 0)
  const kvkkOnayli = TUM.filter(m => m.kvkk_izni).length
  const kvkkYuzde = toplam ? Math.round(100 * kvkkOnayli / toplam) : 0
  const borclu = TUM.filter(m => m._bakiye < 0).length
  const tcknEksik = TUM.filter(m => !m._tckn).length

  const kpi = (etiket, deger, sagHtml, vurgu = false) => `
    <div class="bg-surface-container-lowest p-4 rounded-xl border ${vurgu ? 'border-error/30 bg-error-container/10' : 'border-outline-variant'} custom-shadow flex flex-col gap-1">
      <span class="text-label-sm ${vurgu ? 'text-error font-bold' : 'text-on-surface-variant font-medium'} uppercase tracking-wider">${etiket}</span>
      <div class="flex items-end justify-between">
        <span class="text-2xl font-bold ${vurgu ? 'text-error' : 'text-primary'}">${deger}</span>
        ${sagHtml}
      </div>
    </div>`

  const kpiHtml = `<div class="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
    ${kpi('Toplam Müşteri', toplam.toLocaleString('tr-TR'), mat('groups', 'text-primary text-xl'))}
    ${kpi('Bu Ay Yeni', buAy.toLocaleString('tr-TR'), mat('person_add', 'text-primary text-xl'))}
    ${kpi('Aktif Müşteri', aktif.toLocaleString('tr-TR'), '<span class="w-2 h-2 bg-green-500 rounded-full mb-2"></span>')}
    ${kpi('Mükerrer Şüpheli', mukerrer.toLocaleString('tr-TR'), mat('warning', 'text-error text-xl', true), true)}
    ${kpi('KVKK Onaylı', '%' + kvkkYuzde, mat('verified_user', 'text-primary text-xl'))}
  </div>`

  // --- Müşteri listesi (tablo) ---
  const satir = m => {
    const s = saglik(m)
    const tel = (m.telefon || '').replace(/(\d{4})\d+(\d{2})$/, '$1 *** $2')
    const kIkon = KAYNAK_IKON[trBuyuk(m.kaynak)] || 'help'
    const sec = m.id === secili
    return `<tr data-id="${m.id}" class="mm-satir group cursor-pointer transition-colors border-l-4 ${sec ? 'border-l-primary bg-primary/5' : 'border-l-transparent hover:bg-primary/5'}">
      <td class="px-4 md:px-6 py-4">
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-on-surface">${B(m.ad_soyad)}</span>
            <span class="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded">${m.tip === 'SIRKET' ? 'ŞİRKET' : 'ŞAHIS'}</span>
            ${m._sigortaOnly ? `<span class="px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded" title="Bu kayıt yalnız sigorta modülünde — CRM'e aktarılmadı">SİGORTA${m.police_adedi ? ' · ' + m.police_adedi : ''}</span>` : ''}
          </div>
          <span class="text-xs text-on-surface-variant">${kacis(tel)}${m._tckn ? ' | ' + kacis(m._tckn) : ''}</span>
        </div>
      </td>
      <td class="px-4 md:px-6 py-4 hidden md:table-cell">
        <div class="flex flex-col">
          <span class="text-sm font-medium text-on-surface">Kayıt</span>
          <span class="text-[11px] text-on-surface-variant">${fmtTarih(m.created_at)}</span>
        </div>
      </td>
      <td class="px-4 md:px-6 py-4">
        <div class="flex items-center gap-1.5">
          <div class="w-2.5 h-2.5 rounded-full ${s.nokta}"></div>
          <span class="text-xs font-medium ${s.renk}">${s.metin}</span>
        </div>
      </td>
      <td class="px-4 md:px-6 py-4 hidden lg:table-cell">
        <span class="flex items-center gap-1 text-xs font-medium text-on-surface-variant">${mat(kIkon, 'text-sm')} ${B(m.kaynak) || '—'}</span>
      </td>
      <td class="px-4 md:px-6 py-4 hidden lg:table-cell">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-primary-fixed text-primary text-[10px] flex items-center justify-center font-bold">${basHarf(danismanAdi(DMAP, m.olusturan))}</div>
          <span class="text-xs text-on-surface-variant">${B(danismanAdi(DMAP, m.olusturan))}</span>
        </div>
      </td>
      <td class="px-4 md:px-6 py-4 text-right">
        <div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <!-- Müşteri 360° — bu müşterinin DMS/sigorta/kredi/cari verisi tek ekranda (sql/124) -->
          <a href="musteri-360.html?id=${encodeURIComponent(m.id)}" onclick="event.stopPropagation()" class="p-1.5 hover:bg-white rounded-md text-primary" title="Müşteri 360°">${mat('hub', 'text-lg')}</a>
          <a href="${waHref(m.telefon)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="p-1.5 hover:bg-white rounded-md text-green-600" title="WhatsApp">${mat('chat', 'text-lg')}</a>
          <a href="tel:${telNo(m.telefon)}" onclick="event.stopPropagation()" class="p-1.5 hover:bg-white rounded-md text-primary" title="Ara">${mat('call', 'text-lg')}</a>
        </div>
      </td>
    </tr>`
  }

  // --- Sayfalama (Göksenil: "sayfada 20 kayıt göstersin") ---
  // ⚠️ Sayfa numarası filtre/arama değişince taşabilir → her çizimde sınırla.
  const sayfaAdedi = Math.max(1, Math.ceil(liste.length / SAYFA_BOY))
  if (sayfa > sayfaAdedi) sayfa = sayfaAdedi
  if (sayfa < 1) sayfa = 1
  const sayfalik = liste.slice((sayfa - 1) * SAYFA_BOY, sayfa * SAYFA_BOY)

  const listeHtml = `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow overflow-hidden flex flex-col">
    <div class="px-4 md:px-6 py-4 border-b border-outline-variant flex justify-between items-center gap-3 bg-surface-container-low/50">
      <h2 class="text-headline-sm font-bold text-primary flex items-center gap-2">${mat('list')} Müşteri Listesi</h2>
      <div class="flex items-center bg-white px-3 py-1.5 rounded-full border border-outline-variant w-52 md:w-64">
        ${mat('search', 'text-on-surface-variant text-lg')}
        <input id="mmArama" type="search" value="${kacis(arama)}" placeholder="Telefon, ad veya TC ara…" class="bg-transparent border-none focus:ring-0 focus:outline-none text-body-md w-full ml-2" />
      </div>
    </div>
    <div class="overflow-x-auto">
      ${liste.length ? `<table class="w-full text-left border-collapse">
        <thead><tr class="bg-surface-container text-on-surface-variant text-[11px] uppercase font-bold tracking-widest">
          <th class="px-4 md:px-6 py-3 border-b border-outline-variant">Müşteri / Kimlik</th>
          <th class="px-4 md:px-6 py-3 border-b border-outline-variant hidden md:table-cell">Son İşlem</th>
          <th class="px-4 md:px-6 py-3 border-b border-outline-variant">Sağlık</th>
          <th class="px-4 md:px-6 py-3 border-b border-outline-variant hidden lg:table-cell">Kaynak</th>
          <th class="px-4 md:px-6 py-3 border-b border-outline-variant hidden lg:table-cell">Kaydeden</th>
          <th class="px-4 md:px-6 py-3 border-b border-outline-variant text-right">İşlem</th>
        </tr></thead>
        <tbody class="divide-y divide-outline-variant/30">${sayfalik.map(satir).join('')}</tbody>
      </table>` : `<div class="p-6">${bosDurum(arama ? 'Aramayla eşleşen müşteri yok.' : 'Henüz müşteri kaydı yok. “Yeni Müşteri” ile ekleyin.', 'person_search')}</div>`}
    </div>
    <div class="px-4 md:px-6 py-3 border-t border-outline-variant flex justify-between items-center text-xs text-on-surface-variant bg-surface-container-low/30">
      <span>Toplam ${toplam.toLocaleString('tr-TR')} kayıt${arama ? ` · ${liste.length} eşleşme` : ''}${liste.length ? ` · ${((sayfa - 1) * SAYFA_BOY) + 1}–${Math.min(sayfa * SAYFA_BOY, liste.length)} gösteriliyor` : ''}</span>
      ${sayfaAdedi > 1 ? `<div class="flex items-center gap-1">
        <button data-sayfa="1" class="mm-sayfa px-2 py-1 rounded hover:bg-surface-container disabled:opacity-30" ${sayfa === 1 ? 'disabled' : ''} title="İlk sayfa">${mat('first_page', 'text-[16px]')}</button>
        <button data-sayfa="${sayfa - 1}" class="mm-sayfa px-2 py-1 rounded hover:bg-surface-container disabled:opacity-30" ${sayfa === 1 ? 'disabled' : ''} title="Önceki">${mat('chevron_left', 'text-[16px]')}</button>
        <span class="px-2 font-bold text-on-surface">${sayfa} / ${sayfaAdedi}</span>
        <button data-sayfa="${sayfa + 1}" class="mm-sayfa px-2 py-1 rounded hover:bg-surface-container disabled:opacity-30" ${sayfa === sayfaAdedi ? 'disabled' : ''} title="Sonraki">${mat('chevron_right', 'text-[16px]')}</button>
        <button data-sayfa="${sayfaAdedi}" class="mm-sayfa px-2 py-1 rounded hover:bg-surface-container disabled:opacity-30" ${sayfa === sayfaAdedi ? 'disabled' : ''} title="Son sayfa">${mat('last_page', 'text-[16px]')}</button>
      </div>` : ''}
    </div>
  </div>`

  // --- Alt bento (gerçek türetilmiş metrikler) ---
  const bentoHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
    <div class="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant custom-shadow flex flex-col justify-between gap-3 min-h-[140px]">
      <div class="flex justify-between items-start">
        <span class="text-sm font-bold text-primary">KVKK Doluluk</span>
        <span class="text-[10px] font-bold text-on-surface-variant uppercase">${new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</span>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex-1 h-2 bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-primary rounded-full" style="width:${kvkkYuzde}%"></div></div>
        <span class="text-sm font-extrabold text-on-surface">%${kvkkYuzde}</span>
      </div>
      <p class="text-xs text-on-surface-variant leading-relaxed">${toplam.toLocaleString('tr-TR')} müşteriden ${kvkkOnayli.toLocaleString('tr-TR')} tanesi KVKK onaylı.</p>
    </div>
    <div class="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant custom-shadow flex flex-col min-h-[140px]">
      <span class="text-sm font-bold text-primary mb-3">Bekleyen Aksiyonlar</span>
      <div class="space-y-2.5">
        <div class="flex items-center gap-3 p-2 bg-error-container/10 rounded-lg border border-error/10">
          ${mat('notification_important', 'text-error text-lg')}
          <div class="flex-1"><p class="text-xs font-bold text-on-surface">${borclu} Borçlu Müşteri</p><p class="text-[10px] text-on-surface-variant">Cari bakiyesi negatif</p></div>
        </div>
        <div class="flex items-center gap-3 p-2 bg-primary/5 rounded-lg border border-primary/10">
          ${mat('badge', 'text-primary text-lg')}
          <div class="flex-1"><p class="text-xs font-bold text-on-surface">${tcknEksik} TCKN Eksik</p><p class="text-[10px] text-on-surface-variant">Kimlik bilgisi girilmemiş</p></div>
        </div>
      </div>
    </div>
  </div>`

  // --- Sağ Customer 360 paneli ---
  const panelHtml = secM ? panel360(secM) : `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow p-8">${bosDurum('Bir müşteri seçin.', 'person')}</div>`

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 md:mb-6">
      <div>
        <h2 class="text-headline-md text-primary font-bold">Müşteri Merkezi</h2>
        <p class="text-body-md text-on-surface-variant">Müşteri kayıtları — ara, incele, ekle</p>
      </div>
      <button id="mmYeniBtn" class="bg-primary text-on-primary pl-3 pr-4 h-10 flex items-center gap-1.5 rounded-lg text-label-md font-bold hover:opacity-90 shadow-sm shrink-0">${mat('person_add', 'text-[18px]')}<span class="hidden sm:inline">Yeni Müşteri</span></button>
    </div>
    <div class="flex flex-col xl:flex-row gap-4 md:gap-6">
      <div class="flex-1 min-w-0 flex flex-col gap-4 md:gap-6">
        ${kpiHtml}
        ${listeHtml}
        ${bentoHtml}
      </div>
      <aside class="w-full xl:w-[380px] shrink-0">${panelHtml}</aside>
    </div>
    ${modalHtml()}`

  baglaOlaylar()
}

function panel360(m) {
  const s = saglik(m)
  const borc = m._bakiye < 0
  const saglik360 = (etiket, deger, sonuk = false) => `
    <div class="bg-white border border-outline-variant p-2 rounded-lg text-center">
      <p class="text-[10px] text-on-surface-variant uppercase font-bold">${etiket}</p>
      <p class="text-lg font-extrabold ${sonuk ? 'text-on-surface-variant/40' : 'text-on-surface'}">${deger}</p>
    </div>`
  const tab = (ikon, ad, href) => `
    <a ${href ? `href="${href}"` : ''} class="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-primary/5 transition-colors group">
      ${mat(ikon, 'text-on-surface-variant group-hover:text-primary')}<span class="text-[10px] font-medium text-on-surface-variant">${ad}</span></a>`
  const telUrl = 'musteri.html?tel=' + encodeURIComponent(m.telefon || '')
  return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow flex flex-col overflow-hidden">
    <div class="relative h-28 bg-primary flex items-end px-6 pb-4">
      <div class="flex items-center gap-4 w-full">
        <div class="w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-primary font-extrabold text-xl shadow-xl">${basHarf(m.ad_soyad)}</div>
        <div class="flex flex-col min-w-0">
          <h3 class="text-on-primary font-bold text-lg leading-tight truncate">${B(m.ad_soyad)}</h3>
          <span class="text-[10px] text-on-primary/85 font-bold mt-1 bg-white/15 px-2 py-0.5 rounded w-fit">${m.tip === 'SIRKET' ? 'KURUMSAL' : 'BİREYSEL'}</span>
        </div>
      </div>
    </div>
    <div class="p-6 space-y-5">
      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col"><span class="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">Telefon</span><span class="text-sm font-semibold text-on-surface">${kacis(telBicim(m.telefon) || '—')}</span></div>
        <div class="flex flex-col"><span class="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">TC / Vergi No</span><span class="text-sm font-semibold text-on-surface">${kacis(m._tckn || '—')}</span></div>
        <div class="col-span-2 flex flex-col"><span class="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">Adres</span><span class="text-sm font-semibold text-on-surface">${B(m.adres) || '—'}</span></div>
      </div>
      <div class="flex items-center justify-between p-2 rounded-lg border ${m.kvkk_izni ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'}">
        <span class="text-xs font-bold flex items-center gap-1 ${m.kvkk_izni ? 'text-green-700' : 'text-amber-700'}">${mat(m.kvkk_izni ? 'check_circle' : 'gpp_maybe', 'text-sm')} ${m.kvkk_izni ? 'KVKK Onaylı' : 'KVKK İzni Yok'}</span>
      </div>
      <div class="bg-surface-container-low p-4 rounded-xl border border-outline-variant space-y-3">
        <div class="flex justify-between items-center"><h4 class="text-xs font-extrabold text-primary uppercase">Customer Health 360</h4>
          <span class="px-2 py-0.5 ${borc ? 'bg-error' : 'bg-green-500'} text-white text-[10px] font-bold rounded-full">${borc ? 'BORÇLU' : 'AKTİF'}</span></div>
        <div class="grid grid-cols-3 gap-2">
          ${saglik360('Araç', m._arac || '0', !m._arac)}
          ${saglik360('Sigorta', '—', true)}
          ${saglik360('Kredi', '—', true)}
        </div>
        <div class="pt-2 border-t border-outline-variant/50 flex justify-between text-xs">
          <span class="text-on-surface-variant font-medium">Cari Durumu:</span>
          <span class="font-bold ${borc ? 'text-error' : 'text-green-600'}">${borc ? fmtPara(-m._bakiye) + ' borç' : 'Borç Yok'}</span>
        </div>
      </div>
      <div class="border-t border-outline-variant pt-4">
        <div class="grid grid-cols-4 gap-2">
          ${tab('person', 'Genel', telUrl)}
          ${tab('directions_car', 'Araçlar', '')}
          ${tab('support_agent', 'Talepler', telUrl)}
          ${tab('forum', 'Görüşme', telUrl)}
          ${tab('account_balance', 'Kredi', '')}
          ${tab('security', 'Sigorta', '')}
          ${tab('receipt_long', 'Cari', '')}
          ${tab('folder_open', 'Dosyalar', '')}
        </div>
      </div>
    </div>
    <div class="p-4 bg-surface-container-low border-t border-outline-variant flex gap-2">
      ${m._sigortaOnly
        ? `<button id="mmAktar" class="flex-1 bg-primary text-on-primary py-2 rounded-lg text-xs font-bold hover:opacity-90 shadow-sm transition-all">CRM'e Aktar</button>`
        : `<button id="mmDuzenle" class="flex-1 bg-white border border-outline-variant py-2 rounded-lg text-xs font-bold hover:bg-surface-container transition-all">Düzenle</button>
      <a href="musteri-360.html?id=${encodeURIComponent(m.id)}" class="flex-1 bg-primary text-on-primary py-2 rounded-lg text-xs font-bold text-center hover:opacity-90 shadow-sm transition-all">Müşteri 360°</a>`}
    </div>
  </div>`
}

// --- Yeni/Düzenle Müşteri modalı ---
function modalHtml() {
  return `<div id="mmModal" class="fixed inset-0 z-[100] bg-on-surface/40 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 hidden">
    <div class="bg-surface-container-lowest w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
      <div class="px-6 md:px-8 py-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-primary-fixed flex items-center justify-center text-primary">${mat('person_add')}</div>
          <div><h2 id="mmModalBaslik" class="text-xl font-extrabold text-primary tracking-tight">Yeni Müşteri Kaydı</h2>
            <p class="text-xs text-on-surface-variant font-medium">Zorunlu: Ad Soyad · Telefon · TC/Vergi No</p></div>
        </div>
        <button id="mmKapat" class="p-2 hover:bg-white rounded-full transition-colors text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex-1 overflow-y-auto p-6 md:p-8 space-y-5">
        <div id="mmHata" class="hidden bg-error-container text-on-error-container border border-error/20 rounded-lg px-4 py-2.5 text-sm"></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${alan('Müşteri Tipi', `<select id="mmTip" class="${INP}"><option value="SAHIS">Bireysel</option><option value="SIRKET">Kurumsal</option></select>`)}
          ${alan('TC / Vergi No *', `<input id="mmTckn" type="text" inputmode="numeric" maxlength="11" oninput="this.value=this.value.replace(/[^0-9]/g,'')" class="${INP}" />`)}
          ${alan('Ad Soyad / Unvan *', `<input id="mmAd" type="text" class="${INP}" />`)}
          ${alan('Kaynak', `<select id="mmKaynak" class="${INP}"><option value="">—</option><option>Web</option><option>Instagram</option><option>Referans</option><option>Telefon</option><option>Kapı</option><option>Diğer</option></select>`)}
          ${alan('Telefon *', `<input id="mmTel" type="tel" placeholder="05XX XXX XX XX" class="${INP}" />`)}
          ${alan('E-Posta', `<input id="mmEposta" type="email" class="${INP}" />`)}
        </div>
        ${alan('Adres', `<textarea id="mmAdres" rows="2" class="${INP}"></textarea>`)}
        ${alan('Müşteri Notu', `<textarea id="mmNot" rows="2" class="${INP}" placeholder="Kısa not…"></textarea>`)}
        <label class="flex items-start gap-3 p-3 rounded-lg border border-outline-variant bg-surface-container-low cursor-pointer">
          <input id="mmKvkk" type="checkbox" class="mt-0.5 w-4 h-4 accent-primary" />
          <span class="text-sm text-on-surface"><b>KVKK aydınlatma / ticari ileti izni</b><br><span class="text-xs text-on-surface-variant">İşaretli değilse pazarlama SMS'i gönderilmez (işlemsel bilgilendirme serbest).</span></span>
        </label>
      </div>
      <div class="px-6 md:px-8 py-5 bg-surface-container-low border-t border-outline-variant flex justify-end gap-3">
        <button id="mmVazgec" class="px-6 py-2.5 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-white border border-transparent hover:border-outline-variant transition-all">Vazgeç</button>
        <button id="mmKaydet" class="px-8 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-bold hover:opacity-90 shadow-md transition-all">Kaydet</button>
      </div>
    </div>
  </div>`
}
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
function alan(etiket, ic) {
  return `<div class="flex flex-col gap-1.5"><label class="text-[11px] font-bold text-on-surface-variant uppercase">${etiket}</label>${ic}</div>`
}

// --- Olay bağlama ---
function baglaOlaylar() {
  document.querySelectorAll('.mm-satir').forEach(tr => tr.addEventListener('click', () => { secili = tr.dataset.id; ciz() }))
  const ar = document.getElementById('mmArama')
  document.querySelectorAll('.mm-sayfa').forEach(b => b.addEventListener('click', () => { sayfa = Number(b.dataset.sayfa) || 1; ciz() }))
  if (ar) ar.addEventListener('input', e => { arama = e.target.value; sayfa = 1; const p = e.target.selectionStart; ciz(); const y = document.getElementById('mmArama'); if (y) { y.focus(); try { y.setSelectionRange(p, p) } catch (_) {} } })

  // "Yeni Müşteri" — sayfa başlığındaki buton (sidebar'da değil)
  document.getElementById('mmYeniBtn')?.addEventListener('click', () => modalAc(null))
  document.getElementById('mmDuzenle')?.addEventListener('click', () => modalAc(TUM.find(m => m.id === secili)))
  document.getElementById('mmAktar')?.addEventListener('click', () => sigortadanAktar(TUM.find(m => m.id === secili)))
  document.getElementById('mmKapat')?.addEventListener('click', modalKapat)
  document.getElementById('mmVazgec')?.addEventListener('click', modalKapat)
  document.getElementById('mmKaydet')?.addEventListener('click', kaydet)
  window.addEventListener('keydown', escKapat)
}
function escKapat(e) { if (e.key === 'Escape') modalKapat() }

let duzenlenenId = null
function modalAc(m) {
  duzenlenenId = m?.id || null
  document.getElementById('mmModalBaslik').textContent = m ? 'Müşteri Düzenle' : 'Yeni Müşteri Kaydı'
  document.getElementById('mmTip').value = m?.tip || 'SAHIS'
  document.getElementById('mmTckn').value = m?._tckn || ''
  document.getElementById('mmAd').value = m?.ad_soyad || ''
  document.getElementById('mmKaynak').value = m?.kaynak || ''
  document.getElementById('mmTel').value = m?.telefon || ''
  document.getElementById('mmEposta').value = m?.e_posta || ''
  document.getElementById('mmAdres').value = m?.adres || ''
  document.getElementById('mmNot').value = m?.notlar || ''
  document.getElementById('mmKvkk').checked = !!m?.kvkk_izni
  document.getElementById('mmHata').classList.add('hidden')
  document.getElementById('mmModal').classList.remove('hidden')
}
function modalKapat() { document.getElementById('mmModal')?.classList.add('hidden') }
function hataGoster(msg) { const h = document.getElementById('mmHata'); h.textContent = msg; h.classList.remove('hidden') }

async function kaydet() {
  const tip = document.getElementById('mmTip').value
  const tckn = document.getElementById('mmTckn').value.trim()
  const ad = document.getElementById('mmAd').value.trim()
  const tel = document.getElementById('mmTel').value.trim()
  if (!ad) return hataGoster('Ad Soyad zorunlu.')
  if (!tel) return hataGoster('Telefon zorunlu.')
  if (!tckn) return hataGoster('TC / Vergi No zorunlu.')

  const govde = {
    tip, ad_soyad: ad, telefon: telSifirla(tel),
    e_posta: document.getElementById('mmEposta').value.trim() || null,
    kaynak: document.getElementById('mmKaynak').value || null,
    adres: document.getElementById('mmAdres').value.trim() || null,
    notlar: document.getElementById('mmNot').value.trim() || null,
    kvkk_izni: document.getElementById('mmKvkk').checked,
  }
  const btn = document.getElementById('mmKaydet'); btn.disabled = true; btn.textContent = 'Kaydediliyor…'

  let musteriId = duzenlenenId
  if (duzenlenenId) {
    const { error } = await supabase.from('musteriler').update(govde).eq('id', duzenlenenId).select('id')
    if (error) { dbHata('müşteri güncelle', error); btn.disabled = false; btn.textContent = 'Kaydet'; return hataGoster('Kaydedilemedi: ' + error.message) }
  } else {
    const { data, error } = await supabase.from('musteriler').insert(govde).select('id').single()
    if (error) { dbHata('müşteri ekle', error); btn.disabled = false; btn.textContent = 'Kaydet'; return hataGoster('Kaydedilemedi: ' + error.message) }
    musteriId = data.id
  }
  // Kimlik (TCKN) — ayrı tablo
  const { error: kErr } = await supabase.from('musteri_kimlik').upsert({ musteri_id: musteriId, tckn_vergi_no: tckn }, { onConflict: 'musteri_id' })
  if (kErr) dbHata('kimlik kaydet', kErr)   // müşteri yazıldı; kimlik hatası bloklamaz ama loglanır

  btn.disabled = false; btn.textContent = 'Kaydet'
  modalKapat()
  secili = musteriId
  await yukle()
}


// ---------- SİGORTA MÜŞTERİSİNİ CRM'E AKTAR ----------
// Göksenil: "bütün müşterileri tek bir yerde görmeliyim." Liste birleşik
// (sql/126) ama sigorta kayıtları SALT OKUNUR — çünkü 1782 kaydın 1728'inde
// hiçbir kimlik yok. İşlem yapılacak kişi buradan CRM'e alınır ve gerçek
// telefon/TCKN O AN girilir.
// ⚠️ Aktarma sonrası `sigorta_musterileri.crm_musteri_id` yazılır. Köprü
//   TCKN/telefonla da eşliyor ama kimlik girilmezse eşleşmez ve kişi listede
//   İKİ KEZ görünürdü; açık bağlantı o açığı kapatır (canlı provayla ölçüldü).
async function sigortadanAktar(m) {
  if (!m) return
  if (!confirm(`"${buyuk(m.ad_soyad)}" CRM müşteri kütüğüne aktarılacak.

Sigortadaki poliçeleri bu kayda bağlanacak. Devam edilsin mi?`)) return

  const { data: yeni, error } = await supabase.from('musteriler').insert({
    tip: m.tip === 'SIRKET' ? 'SIRKET' : 'SAHIS',
    ad_soyad: buyuk(m.ad_soyad),
    telefon: (m.telefon_norm && m.telefon_norm.length >= 10) ? telSifirla(m.telefon_norm) : '-',
    e_posta: m.e_posta || null,
    adres: m.adres || null,
    notlar: m.notlar || null,
    kaynak: 'SIGORTA',
  }).select('id').single()
  if (error) { dbHata('sigortadan aktar', error); alert('Aktarılamadı: ' + error.message); return }

  if (m._tckn) {
    const { error: ke } = await supabase.from('musteri_kimlik')
      .upsert({ musteri_id: yeni.id, tckn_vergi_no: m._tckn }, { onConflict: 'musteri_id' })
    if (ke) dbHata('aktarma kimlik', ke)
  }
  // Açık bağlantı — mükerrer görünmesin
  const { data: bag, error: be } = await supabase.from('sigorta_musterileri')
    .update({ crm_musteri_id: yeni.id }).eq('id', m.id).select('id')
  if (be) { dbHata('sigorta bağlantı', be); alert('Müşteri açıldı ama sigorta kaydına bağlanamadı: ' + be.message) }
  else if (!bag || !bag.length) alert('Müşteri açıldı ama sigorta kaydına bağlanamadı (yetki?).')   // §5.1

  secili = yeni.id
  await yukle()
  alert('Aktarıldı. Telefon ve TCKN alanlarını Düzenle ile tamamlayabilirsin.')
}
