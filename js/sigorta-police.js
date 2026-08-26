// =====================================================================
// sigorta-police.js — Poliçe Giriş Tezgahı (Faz 2)
//   Sol: Müşteri+Araç (TC→master). Sağ: TSB (kod→marka/versiyon/kasko).
//   Alt: Trafik/Kasko sekmeleri + CANLI vergi/komisyon önizleme (SQL'i
//   birebir yansıtır; kesin değer DB trigger'ında). Ekstra: Konut/Ferdi
//   Kaza/TSS modalları. Kaydet → müşteri+araç+poliçe(ler) tek akış.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import { kacis, fmtPara, bugunISO, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'
import { round2, artiYil, vergiHesapla, sirketSecici } from './sigorta-ortak.js'
import { kartBloguCiz, kartSec, KART_ALANLAR } from './kart-gorsel.js'

let benim = null
let FIRSAT_ID = null      // ?firsat= ile gelindiyse dolu (sql/217)
const cache = { turler: [], sirketler: [], komisyon: [], tahsilat: [], kartlar: [], kartKural: [] }

// Ekranın tuttuğu tüm veri
const S = {
  musteri: { id: null, tc_kimlik: '', ad_soyad: '', dogum_tarihi: '', telefon: '', meslek: '', adres: '' },
  arac: { id: null, plaka: '', ruhsat_seri_no: '', model_yili: '', tsb_marka_kodu: '', tsb_tip_kodu: '', marka: '', versiyon: '', kasko_degeri: '', tip: 'OTOMOBIL', kaynak: 'HARICI_MUSTERI', crm_arac_ref: null },
  police: {
    // ⚠️ belge_no KALDIRILDI (Göksenil, 18 Ağu 2026: "işaretli alan gerek yok").
    //    Ölçüm: 8.453 poliçenin HİÇBİRİNDE dolu değildi. Kolon veritabanında
    //    duruyor (geçmişi bozmamak için), formda sorulmuyor.
    // komisyon_orani: BOŞ bırakılırsa DB trigger'ı şirket/tür oranından
    //    hesaplar; yazılırsa yazılan geçerlidir (sql/36 police_hesapla_trigger).
    trafik: { sirket_id: null, brut: '', net: '', police_no: '', yeni_plaka: '', komisyon_orani: '', baslangic: bugunISO(), bitis: artiYil(bugunISO(), 1) },
    kasko:  { sirket_id: null, brut: '', net: '', police_no: '', yeni_plaka: '', komisyon_orani: '', baslangic: bugunISO(), bitis: artiYil(bugunISO(), 1) },
  },
  ekstra: [],           // { tur_kod, etiket, sirket_id, brut, net, police_no, adres?, meslek?, dogum_tarihi? }
  aktifSekme: 'trafik',
  // Tahsilat şekli KAYDA aittir, poliçe türüne değil: trafik + kasko aynı
  // anda kesilse bile tahsilat tektir (sql/218).
  tahsilat_sekli_id: null,
  // Tahsilat şeklinden çözülen kart (sql/224). Poliçeye yazılır; maske ve
  // adı veritabanı tetikleyicisi o andaki karttan fotoğraflar.
  kart_id: null,
}

const turByKod = k => cache.turler.find(t => t.kod === k)
const sirketById = id => cache.sirketler.find(s => s.id === id)
const sirketAna = id => { const s = sirketById(id); return s && !s.ana_sirket_id }

// Komisyon oranı: şirket override → tür varsayılanı
function komisyonOran(turId, sirketId) {
  const ov = cache.komisyon
    .filter(k => k.police_turu_id === turId && k.sirket_id === sirketId && k.aktif)
    .sort((a, b) => (b.gecerli_baslangic || '').localeCompare(a.gecerli_baslangic || ''))[0]
  if (ov) return Number(ov.oran)
  const t = cache.turler.find(t => t.id === turId)
  return t ? Number(t.varsayilan_komisyon) : 0
}

// =====================================================================
export async function policeGirisKur(danisman) {
  benim = danisman
  await cacheYukle()
  musteriFormCiz()
  aracFormCiz()
  sekmelerCiz()
  policePanelCiz()
  ekstraCiplerCiz()
  ekstraListeCiz()
  await listeYukle()
  await firsattanDoldur()          // ?firsat= varsa müşteri+araç hazır gelir

  document.getElementById('pgTemizle').addEventListener('click', temizle)
  document.getElementById('pgKaydet').addEventListener('click', kaydet)
  document.getElementById('pgYeniMusteri').addEventListener('click', () => { musteriTemizle(); durumMsg('Yeni müşteri — bilgileri elle girin.', 'info') })
}

async function cacheYukle() {
  const [t, s, k, th, kt, kk] = await Promise.all([
    supabase.from('police_turleri').select('id, kod, ad, vergi_profil, varsayilan_komisyon, taraf, arac_gerektirir').eq('aktif', true).order('sira'),
    supabase.from('sigorta_sirketleri').select('id, ad, ana_sirket_id, kisa_kod').eq('aktif', true).order('ad'),
    supabase.from('sirket_komisyon_oranlari').select('sirket_id, police_turu_id, oran, gecerli_baslangic, aktif').eq('aktif', true),
    // Tahsilat şekilleri — YENİ TABLO AÇILMADI, Tanımlar'dan yönetilen
    // mevcut liste kullanılıyor (sql/218).
    supabase.from('tahsilat_sekilleri').select('id, ad').eq('aktif', true).order('sira'),
    // Kart görseli (sql/223-224). Kartların kaynağı Bahadır'ın modülü;
    // burada yalnız tanıtıcı alanlar duruyor, tam numara/CVV kart-detay
    // ucundan anlık geliyor.
    supabase.from('odeme_kartlari').select(KART_ALANLAR).eq('aktif', true).order('ad'),
    supabase.from('tahsilat_kart_kurallari')
      .select('taraf, tahsilat_sekli_id, police_turu_id, kart_id, oncelik')
      .eq('aktif', true),
  ])
  cache.turler = t.data || []
  cache.sirketler = s.data || []
  cache.komisyon = k.data || []
  cache.tahsilat = th.data || []
  cache.kartlar = kt.data || []
  cache.kartKural = kk.data || []
  if (th.error) dbHata('tahsilat sekilleri', th.error)   // §5.4 — sessiz geçme
  if (kt.error) dbHata('odeme_kartlari', kt.error)
  if (kk.error) dbHata('tahsilat_kart_kurallari', kk.error)
}

// --------------------------------------------------------- Müşteri formu
function musteriFormCiz() {
  const kok = document.getElementById('pgMusteriForm')
  const m = S.musteri
  const alan = (k, l, tip = 'text', ekstra = '') => `
    <div${k === 'tc_kimlik' ? ' class="relative"' : ''}>
      <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">${l}</label>
      <input data-m="${k}" type="${tip}" value="${kacis(m[k] || '')}" ${ekstra}
        class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none ${k === 'tc_kimlik' ? 'pr-10' : ''}" />
      ${k === 'tc_kimlik' ? `<button id="pgTcAra" class="absolute right-2 top-[30px] text-on-surface-variant hover:text-primary" title="Müşteriyi ara">${mat('search', 'text-[20px]')}</button>` : ''}
    </div>`
  kok.innerHTML =
    alan('tc_kimlik', 'TC Kimlik No', 'text', 'inputmode="numeric" maxlength="11"') +
    alan('ad_soyad', 'Ad Soyad') +
    alan('dogum_tarihi', 'Doğum Tarihi', 'date') +
    alan('plaka_arac', 'Araç Plakası') +   // araç plakası (özel işlenir)
    alan('ruhsat_arac', 'Ruhsat Seri No') +
    alan('telefon', 'Telefon', 'tel')

  // plaka/ruhsat araç state'ine gider
  kok.querySelector('[data-m="plaka_arac"]').value = S.arac.plaka || ''
  kok.querySelector('[data-m="ruhsat_arac"]').value = S.arac.ruhsat_seri_no || ''

  kok.querySelectorAll('[data-m]').forEach(el => el.addEventListener('input', () => {
    const k = el.dataset.m
    if (k === 'plaka_arac') S.arac.plaka = el.value.toLocaleUpperCase('tr')
    else if (k === 'ruhsat_arac') S.arac.ruhsat_seri_no = el.value
    else S.musteri[k] = el.value
  }))
  kok.querySelector('[data-m="plaka_arac"]').addEventListener('blur', plakaAra)
  document.getElementById('pgTcAra').addEventListener('click', musteriAra)
  kok.querySelector('[data-m="tc_kimlik"]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); musteriAra() } })
}

async function musteriAra() {
  const tc = (S.musteri.tc_kimlik || '').trim()
  if (!tc) { durumMsg('Önce TC kimlik no girin.', 'info'); return }
  const { data, error } = await supabase.from('sigorta_musterileri').select('*').eq('tc_kimlik', tc).limit(1)
  if (dbHata('musteri ara', error)) { durumMsg('Arama hatası: ' + error.message, 'hata'); return }
  if (data && data.length) {
    const m = data[0]
    S.musteri = { id: m.id, tc_kimlik: m.tc_kimlik || '', ad_soyad: m.ad_soyad || '', dogum_tarihi: m.dogum_tarihi || '', telefon: m.telefon || '', meslek: m.meslek || '', adres: m.adres || '' }
    musteriFormCiz()
    durumMsg('Müşteri bulundu — bilgiler dolduruldu.', 'ok')
  } else durumMsg('Kayıt yok — yeni müşteri olarak kaydedilecek.', 'info')
}

function durumMsg(metin, tip) {
  const renk = tip === 'ok' ? 'bg-secondary-container text-on-secondary-container' : tip === 'hata' ? 'bg-error-container text-on-error-container' : 'bg-surface-container-low text-on-surface-variant'
  const ikon = tip === 'ok' ? 'check_circle' : tip === 'hata' ? 'error' : 'info'
  document.getElementById('pgMusteriDurum').innerHTML = `<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-body-md ${renk}">${mat(ikon, 'text-[18px]')} ${kacis(metin)}</div>`
}

// --------------------------------------------------------- Araç (TSB) formu
function aracFormCiz() {
  const kok = document.getElementById('pgAracForm')
  const a = S.arac
  const inp = (k, l, tip = 'text', ekstra = '') => `<div>
    <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">${l}</label>
    <input data-a="${k}" type="${tip}" value="${kacis(a[k] || '')}" ${ekstra}
      class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none" /></div>`
  kok.innerHTML = `
    <div class="grid grid-cols-3 gap-3">
      ${inp('model_yili', 'Model Yılı', 'number')}
      ${inp('tsb_marka_kodu', 'TSB Marka', 'text', 'maxlength="3"')}
      ${inp('tsb_tip_kodu', 'TSB Tip', 'text', 'maxlength="3"')}
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      ${inp('marka', 'Marka')}
      ${inp('versiyon', 'Versiyon / Tip Adı')}
    </div>
    <div class="flex items-end justify-between gap-3 mt-4">
      <div>
        <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Araç Tipi</label>
        <div class="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          ${['OTOMOBIL', 'KAMYONET'].map(tp => `<button data-tip="${tp}" class="px-4 py-2 text-label-md font-bold ${a.tip === tp ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant hover:bg-surface-container-low'}">${tp === 'OTOMOBIL' ? 'Otomobil' : 'Kamyonet'}</button>`).join('')}
        </div>
      </div>
      <div class="text-right">
        <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Kasko Değeri (₺)</label>
        <input data-a="kasko_degeri" type="number" step="0.01" value="${kacis(a.kasko_degeri || '')}"
          class="w-40 text-right bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-headline-sm font-bold text-primary focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none" />
      </div>
    </div>
    <p id="pgTsbNot" class="text-[11px] text-on-surface-variant mt-2"></p>`

  kok.querySelectorAll('[data-a]').forEach(el => el.addEventListener('input', () => { S.arac[el.dataset.a] = el.value }))
  kok.querySelectorAll('[data-a="model_yili"],[data-a="tsb_marka_kodu"],[data-a="tsb_tip_kodu"]').forEach(el => el.addEventListener('blur', tsbAra))
  kok.querySelectorAll('[data-tip]').forEach(el => el.addEventListener('click', () => { S.arac.tip = el.dataset.tip; aracFormCiz() }))
}

async function tsbAra() {
  const { model_yili, tsb_marka_kodu, tsb_tip_kodu } = S.arac
  const not = document.getElementById('pgTsbNot')
  if (!model_yili || !tsb_marka_kodu || !tsb_tip_kodu) return
  const { data, error } = await supabase.from('tsb_kasko_liste')
    .select('marka, tip_adi, kasko_degeri').eq('marka_kodu', tsb_marka_kodu).eq('tip_kodu', tsb_tip_kodu).eq('model_yili', Number(model_yili)).limit(1)
  if (error) { if (not) not.textContent = ''; return }
  if (data && data.length) {
    const r = data[0]
    S.arac.marka = r.marka; S.arac.versiyon = r.tip_adi; S.arac.kasko_degeri = r.kasko_degeri || ''
    aracFormCiz()
    if (not) { not.textContent = 'TSB listesinden dolduruldu.'; not.className = 'text-[11px] text-secondary mt-2' }
  } else if (not) {
    not.textContent = 'TSB listesinde bulunamadı — marka/versiyon/kasko değerini elle girin. (TSB listesi henüz yüklenmedi.)'
    not.className = 'text-[11px] text-on-surface-variant mt-2'
  }
}

async function plakaAra() {
  const plaka = (S.arac.plaka || '').trim()
  const rozet = document.getElementById('pgSistemRozet')
  if (!plaka) return
  // 1) Sigorta aracı zaten var mı?
  const { data: sa } = await supabase.from('sigorta_araclari').select('id, marka, versiyon, model_yili, tip, tsb_marka_kodu, tsb_tip_kodu').eq('plaka', plaka).eq('aktif', true).limit(1)
  if (sa && sa.length) {
    const a = sa[0]
    Object.assign(S.arac, { id: a.id, marka: a.marka || '', versiyon: a.versiyon || '', model_yili: a.model_yili || '', tip: a.tip || 'OTOMOBIL', tsb_marka_kodu: a.tsb_marka_kodu || '', tsb_tip_kodu: a.tsb_tip_kodu || '' })
    aracFormCiz(); return
  }
  // 2) CRM stokunda mı? (siteDb — salt okuma; hata olursa yoksay)
  try {
    const { data: st } = await siteDb.from('araclar').select('id, marka, model, yil').ilike('plaka', plaka).limit(1)
    if (st && st.length) {
      const v = st[0]
      S.arac.marka = S.arac.marka || v.marka || ''
      S.arac.versiyon = S.arac.versiyon || v.model || ''
      S.arac.model_yili = S.arac.model_yili || v.yil || ''
      S.arac.kaynak = 'CRM_STOK'; S.arac.crm_arac_ref = v.id
      if (rozet) rozet.classList.remove('hidden')
      aracFormCiz()
    }
  } catch (e) { /* siteDb yoksa yoksay */ }
}

// --------------------------------------------------------- Poliçe sekmeleri
function sekmelerCiz() {
  const kok = document.getElementById('pgSekmeler')
  const sek = (k, l) => {
    const a = S.aktifSekme === k
    return `<button data-sek="${k}" class="text-body-md font-bold pb-3 -mb-px border-b-2 ${a ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'} flex items-center gap-2">
      <span class="w-2 h-2 rounded-full ${policeDolu(k) ? 'bg-secondary' : 'bg-outline-variant'}"></span>${l}</button>`
  }
  kok.innerHTML = sek('trafik', 'Trafik Sigortası') + sek('kasko', 'Kasko')
  kok.querySelectorAll('[data-sek]').forEach(el => el.addEventListener('click', () => { S.aktifSekme = el.dataset.sek; sekmelerCiz(); policePanelCiz() }))
}
const policeDolu = k => { const p = S.police[k]; return p.sirket_id && p.brut && p.net }

function policePanelCiz() {
  const kok = document.getElementById('pgPolicePanel')
  const k = S.aktifSekme
  const p = S.police[k]
  const s = p.sirket_id ? sirketById(p.sirket_id) : null
  const inp = (key, l, tip = 'text', genislik = '') => `<div class="${genislik}">
    <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">${l}</label>
    <input data-p="${key}" type="${tip}" ${tip === 'number' ? 'step="0.01"' : ''} value="${kacis(p[key] || '')}"
      class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none" /></div>`

  kok.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <div class="col-span-2">
        <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1 flex items-center gap-2">Sigorta Şirketi ${s && sirketAna(s.id) ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-primary-fixed text-primary">ANA ŞİRKET</span>' : s ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-tertiary-container text-on-tertiary-container">ALT ŞİRKET</span>' : ''}</label>
        <button id="pgSirketSec" class="w-full text-left bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md flex items-center justify-between hover:border-primary">
          <span class="${s ? 'text-on-surface' : 'text-on-surface-variant'}">${s ? kacis(s.ad) : 'Şirket seçin…'}</span>${mat('unfold_more', 'text-on-surface-variant text-[20px]')}</button>
      </div>
      ${inp('brut', 'Brüt Ücret', 'number')}
      ${inp('net', 'Net Ücret', 'number')}
      ${inp('police_no', 'Poliçe No <span class="text-error">*</span>')}
      ${inp('yeni_plaka', 'Yeni Plaka')}
      ${inp('komisyon_orani', 'Komisyon %', 'number')}
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
      ${inp('baslangic', 'Başlangıç Tarihi <span class="text-error">*</span>', 'date')}
      ${inp('bitis', 'Bitiş Tarihi <span class="text-error">*</span>', 'date')}
      <div class="col-span-2"><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Tahsilat Şekli</label>
        <select id="pgTahsilat" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none">
          <option value="">— seçilmedi —</option>
          ${cache.tahsilat.map(t => `<option value="${t.id}"${S.tahsilat_sekli_id === t.id ? ' selected' : ''}>${kacis(t.ad)}</option>`).join('')}
        </select></div>
    </div>
    <div id="pgKart" class="mt-3"></div>
    <div id="pgHesap" class="mt-4"></div>`

  kok.querySelectorAll('[data-p]').forEach(el => el.addEventListener('input', () => {
    p[el.dataset.p] = el.value
    if (['brut', 'net', 'komisyon_orani'].includes(el.dataset.p)) hesapCiz()
  }))
  // Tahsilat şekli poliçe TÜRÜNE değil KAYDA aittir (trafik+kasko aynı anda
  // kesilse de tek tahsilat yapılıyor) — bu yüzden S üzerinde tutuluyor.
  document.getElementById('pgTahsilat')?.addEventListener('change', e => {
    S.tahsilat_sekli_id = e.target.value || null
    kartCiz()
  })
  document.getElementById('pgSirketSec').addEventListener('click', () => sirketSecici(cache.sirketler, sec => { p.sirket_id = sec.id; policePanelCiz(); sekmelerCiz() }))
  hesapCiz()
  kartCiz()
}

// ---------------------------------------------------------------------
// Tahsilat şekline karşılık gelen kartın görseli
// ⚠️ policePanelCiz() sekme her değiştiğinde paneli BAŞTAN çiziyor; bu
//    yüzden kart bloğu DOM'da tutulan geçici duruma değil, S.tahsilat_sekli_id
//    ile cache.kartKural'a bakarak her seferinde yeniden üretiliyor.
// ⚠️ taraf='MUSTERI': poliçe kesiminde para MÜŞTERİDEN tahsil ediliyor.
//    Yapboz iadesindeki 'SIRKET' değerini buraya kopyalamak kuralı hiç
//    eşleştirmez ve ekran sessizce boş kalır.
function kartCiz() {
  const hedef = document.getElementById('pgKart')
  if (!hedef) return
  if (!S.tahsilat_sekli_id) { hedef.innerHTML = ''; return }
  const p = S.police[S.aktifSekme] || {}
  const kart = kartSec(cache.kartKural, cache.kartlar, {
    taraf: 'MUSTERI',
    tahsilatSekliId: S.tahsilat_sekli_id,
    policeTuruId: p.tur_id || null,
  })
  if (!kart) { hedef.innerHTML = ''; return }   // kural yoksa gösterme
  S.kart_id = kart.id                            // kayıtta poliçeye yazılacak
  kartBloguCiz(hedef, kart, 'sigorta-police')
}

function hesapCiz() {
  const k = S.aktifSekme
  const p = S.police[k]
  const kok = document.getElementById('pgHesap')
  if (!kok) return
  if (!p.brut || !p.net) { kok.innerHTML = `<div class="text-[12px] text-on-surface-variant px-1">Brüt ve net ücret girilince vergi ve komisyon otomatik hesaplanır.</div>`; return }
  const profil = k === 'trafik' ? 'TRAFIK' : 'KASKO'
  const v = vergiHesapla(p.brut, p.net, profil)
  const tur = turByKod(k === 'trafik' ? 'TRAFIK' : 'KASKO')
  // ⚠️ ELLE GİRİLEN ORAN KAZANIR (Göksenil: "her şirkette farklı").
  //    Boşsa şirket/tür oranı gösterilir — DB trigger'ı da aynı kuralı
  //    uyguluyor, önizleme ile kayıt böylece ayrışmıyor.
  const elle = String(p.komisyon_orani ?? '').trim()
  const oran = elle !== '' ? Number(elle)
    : (p.sirket_id && tur ? komisyonOran(tur.id, p.sirket_id) : (tur ? Number(tur.varsayilan_komisyon) : 0))
  const kom = round2((Number(p.net) || 0) * oran / 100)
  const kalem = (l, v) => `<div><div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${l}</div><div class="font-bold text-on-surface">${fmtPara(v)}</div></div>`
  kok.innerHTML = `<div class="bg-surface-container-low border border-outline-variant rounded-xl p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
    <div class="flex items-center gap-2 text-primary font-bold text-label-md">${mat('info', 'text-[18px]')} OTOMATİK HESAPLANDI</div>
    ${profil === 'TRAFIK' ? kalem('Gider Vergisi', v.gv) + kalem('THGF', v.thgf) + kalem('Güvence Hesabı', v.guvence) : kalem('Gider Vergisi (BSMV)', v.gv)}
    <div class="ml-auto"><div class="text-[11px] uppercase tracking-wide text-on-surface-variant">Komisyon (%${oran})</div><div class="font-bold text-primary text-title-lg">${fmtPara(kom)}</div></div>
  </div>`
}

// --------------------------------------------------------- Ekstra poliçeler
const EKSTRA = [['KONUT', 'Konut', 'home'], ['FERDI_KAZA', 'Ferdi Kaza', 'shield'], ['TSS', 'TSS', 'health_and_safety']]
function ekstraCiplerCiz() {
  const kok = document.getElementById('pgEkstraCipler')
  kok.innerHTML = EKSTRA.map(([kod, l, ik]) => {
    const ekli = S.ekstra.some(e => e.tur_kod === kod)
    return `<button data-ek="${kod}" class="px-3 py-2 rounded-full border text-label-md font-bold flex items-center gap-1.5 ${ekli ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">
      ${mat(ekli ? 'check' : ik, 'text-[18px]')} ${l}</button>`
  }).join('')
  kok.querySelectorAll('[data-ek]').forEach(el => el.addEventListener('click', () => ekstraModal(el.dataset.ek)))
}
function ekstraListeCiz() {
  const kok = document.getElementById('pgEkstraListe')
  if (!S.ekstra.length) { kok.innerHTML = ''; return }
  kok.innerHTML = S.ekstra.map((e, i) => `<div class="flex items-center justify-between gap-3 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2">
    <div class="min-w-0"><span class="font-bold text-on-surface">${kacis(e.etiket)}</span>
      <span class="text-on-surface-variant text-label-md">· ${kacis(sirketById(e.sirket_id)?.ad || '—')} · Brüt ${fmtPara(e.brut)}${e.adres ? ' · ' + kacis(e.adres) : ''}${e.meslek ? ' · ' + kacis(e.meslek) : ''}</span></div>
    <button data-sil="${i}" class="text-on-surface-variant hover:text-error p-1" title="Kaldır">${mat('close', 'text-[18px]')}</button></div>`).join('')
  kok.querySelectorAll('[data-sil]').forEach(el => el.addEventListener('click', () => { S.ekstra.splice(Number(el.dataset.sil), 1); ekstraCiplerCiz(); ekstraListeCiz() }))
}

function ekstraModal(kod) {
  const mevcut = S.ekstra.find(e => e.tur_kod === kod)
  const meta = EKSTRA.find(x => x[0] === kod)
  const m = S.musteri
  const alanTip = { KONUT: ['adres'], FERDI_KAZA: ['meslek', 'dogum'], TSS: ['dogum'] }[kod]
  const g = mevcut || { sirket_id: null, brut: '', net: '', police_no: '', adres: m.adres || '', meslek: m.meslek || '', dogum_tarihi: m.dogum_tarihi || '' }

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[8vh] px-4 overflow-y-auto'
  const kilit = (l, v) => `<div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">${l}</label>
    <div class="bg-surface-container border border-outline-variant rounded-lg px-3 py-2.5 text-body-md text-on-surface-variant flex items-center justify-between">${kacis(v || '—')} ${mat('lock', 'text-[16px]')}</div>
    <p class="text-[11px] text-secondary mt-1">Müşteri kaydından dolduruldu</p></div>`
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md mb-10" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-lg py-4 border-b border-outline-variant">
      <h3 class="text-title-lg text-primary flex items-center gap-2">${mat(meta[2], 'text-[22px]')} ${meta[1]} Poliçesi</h3>
      <button id="ekKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div class="p-lg space-y-3">
      ${kilit('TC Kimlik No', m.tc_kimlik)}
      ${kilit('Ad Soyad', m.ad_soyad)}
      ${alanTip.includes('dogum') ? kilit('Doğum Tarihi', m.dogum_tarihi) : ''}
      ${alanTip.includes('adres') ? `<div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Adres</label><textarea id="ekAdres" rows="2" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none" placeholder="Lütfen adresi giriniz…">${kacis(g.adres || '')}</textarea></div>` : ''}
      ${alanTip.includes('meslek') ? `<div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Meslek</label><input id="ekMeslek" value="${kacis(g.meslek || '')}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none" placeholder="Meslek giriniz…" /></div>` : ''}
      <div class="border-t border-outline-variant pt-3">
        <label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Sigorta Şirketi</label>
        <button id="ekSirket" class="w-full text-left bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md flex items-center justify-between hover:border-primary"><span id="ekSirketAd" class="${g.sirket_id ? 'text-on-surface' : 'text-on-surface-variant'}">${g.sirket_id ? kacis(sirketById(g.sirket_id)?.ad) : 'Şirket seçin…'}</span>${mat('unfold_more', 'text-on-surface-variant text-[20px]')}</button>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Brüt ₺</label><input id="ekBrut" type="number" step="0.01" value="${kacis(g.brut || '')}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Net ₺</label><input id="ekNet" type="number" step="0.01" value="${kacis(g.net || '')}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Poliçe No <span class="text-error">*</span></label><input id="ekPno" value="${kacis(g.police_no || '')}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      </div>
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg">
      <button id="ekVazgec" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="ekKaydet" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('save', 'text-[18px]')} Kaydet</button>
    </div></div>`
  document.body.appendChild(ov)
  let secId = g.sirket_id
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelector('#ekKapat').addEventListener('click', kapat)
  ov.querySelector('#ekVazgec').addEventListener('click', kapat)
  ov.querySelector('#ekSirket').addEventListener('click', () => sirketSecici(cache.sirketler, s => { secId = s.id; ov.querySelector('#ekSirketAd').textContent = s.ad; ov.querySelector('#ekSirketAd').className = 'text-on-surface' }))
  ov.querySelector('#ekKaydet').addEventListener('click', () => {
    const brut = ov.querySelector('#ekBrut').value, net = ov.querySelector('#ekNet').value
    const pno = ov.querySelector('#ekPno').value.trim()
    if (!secId || !brut || !net || !pno) { alert('Şirket, brüt, net ve poliçe no zorunlu.'); return }
    const kayit = {
      tur_kod: kod, etiket: meta[1], sirket_id: secId, brut: Number(brut), net: Number(net),
      police_no: pno,
      adres: ov.querySelector('#ekAdres')?.value.trim() || null,
      meslek: ov.querySelector('#ekMeslek')?.value.trim() || null,
      dogum_tarihi: alanTip.includes('dogum') ? (m.dogum_tarihi || null) : null,
    }
    const i = S.ekstra.findIndex(e => e.tur_kod === kod)
    if (i >= 0) S.ekstra[i] = kayit; else S.ekstra.push(kayit)
    kapat(); ekstraCiplerCiz(); ekstraListeCiz()
  })
}

// --------------------------------------------------------- KAYDET
// ── FIRSATTAN ÖN-DOLDURMA (sql/217) ───────────────────────────────────────
// Göksenil, 18 Ağu 2026: "araç bilgileri ve müşteri bilgileri dolu gelecek
// şekilde buradan girip poliçeyi kaydet'e bastığımda danışmana bildirim
// gidecek sigortası kesildi olarak."
//
// ⚠️ KAYNAK YENİ DEĞİL: v_sigorta_firsat_detay zaten TCKN, doğum tarihi,
//    telefon, plaka, ruhsat, kasko kodu, marka/model/yıl taşıyor. İkinci bir
//    birleştirme yazılmadı (CLAUDE.md §4).
// ⚠️ Kasko kodu "marka-tip" biçiminde tek metin; forma İKİ ayrı alan olarak
//    girer. Ayıramazsak alanları BOŞ bırakırız — yanlış kod, boş koddan
//    kötüdür (yanlış kasko değeri = yanlış prim).
async function firsattanDoldur() {
  const id = new URLSearchParams(location.search).get('firsat')
  if (!id) return
  const { data, error } = await supabase.from('v_sigorta_firsat_detay')
    .select('*').eq('id', id).maybeSingle()
  if (error) { dbHata('firsat detay', error); durumMsg('Fırsat okunamadı: ' + error.message, 'hata'); return }
  if (!data) { durumMsg('Fırsat bulunamadı.', 'hata'); return }

  FIRSAT_ID = id
  S.musteri = {
    id: null,
    tc_kimlik: (data.musteri_tckn || '').trim(),
    ad_soyad: (data.musteri_ad_soyad || data.musteri_adi || '').trim(),
    dogum_tarihi: data.musteri_dogum_tarihi || '',
    telefon: (data.musteri_telefon || '').trim(),
    meslek: '', adres: '',
  }
  const kasko = String(data.arac_kasko_kodu || '')
  const [mk, tk] = kasko.includes('-') ? kasko.split('-', 2) : ['', '']
  S.arac = {
    ...S.arac,
    id: null,
    plaka: (data.arac_plaka || data.plaka || '').trim(),
    ruhsat_seri_no: (data.arac_ruhsat_seri_no || '').trim(),
    model_yili: data.arac_yil || '',
    tsb_marka_kodu: (mk || '').trim(),
    tsb_tip_kodu: (tk || '').trim(),
    marka: (data.arac_marka || '').trim(),
    kaynak: 'CRM_SATIS',
    crm_arac_ref: data.crm_arac_id || null,
  }
  musteriFormCiz()
  aracFormCiz()
  const eksik = []
  if (!S.musteri.tc_kimlik) eksik.push('TCKN')
  if (!S.musteri.dogum_tarihi) eksik.push('doğum tarihi')
  if (!S.arac.ruhsat_seri_no) eksik.push('ruhsat seri no')
  if (!S.arac.tsb_marka_kodu || !S.arac.tsb_tip_kodu) eksik.push('kasko kodu')
  durumMsg(eksik.length
    ? `Sipariş dosyasından geldi — eksik: ${eksik.join(', ')}. Tamamlayıp kaydedin.`
    : 'Sipariş dosyasından geldi, bilgiler hazır. Poliçe bilgilerini girip kaydedin.',
    eksik.length ? 'info' : 'ok')
}

async function kaydet() {
  const btn = document.getElementById('pgKaydet')
  const trafikVar = policeDolu('trafik'), kaskoVar = policeDolu('kasko')
  if (!trafikVar && !kaskoVar && !S.ekstra.length) { durumMsg('En az bir poliçe (trafik/kasko/ekstra) girin.', 'hata'); return }
  if (!S.musteri.ad_soyad) { durumMsg('Müşteri ad soyad zorunlu.', 'hata'); return }
  // Poliçe no + tarih zorunlu
  const eksik = []
  if (trafikVar) { const p = S.police.trafik; if (!(p.police_no || '').trim()) eksik.push('Trafik poliçe no'); if (!p.baslangic || !p.bitis) eksik.push('Trafik tarih') }
  if (kaskoVar) { const p = S.police.kasko; if (!(p.police_no || '').trim()) eksik.push('Kasko poliçe no'); if (!p.baslangic || !p.bitis) eksik.push('Kasko tarih') }
  S.ekstra.forEach(e => { if (!(e.police_no || '').trim()) eksik.push(e.etiket + ' poliçe no') })
  if (eksik.length) { durumMsg('Zorunlu alan eksik: ' + eksik.join(', '), 'hata'); return }
  btn.disabled = true; const eski = btn.innerHTML; btn.innerHTML = mat('progress_activity', 'animate-spin text-[18px]') + ' Kaydediliyor…'
  try {
    const musteriId = await musteriKaydet()
    const aracId = await aracKaydet(musteriId)
    const olusan = []
    if (trafikVar) olusan.push(await policeEkle('TRAFIK', S.police.trafik, aracId, musteriId))
    if (kaskoVar) olusan.push(await policeEkle('KASKO', S.police.kasko, aracId, musteriId))
    for (const e of S.ekstra) {
      const pid = await policeEkle(e.tur_kod, e, aracId, musteriId)
      const { error } = await supabase.from('ekstra_police_detaylari').insert({ police_id: pid, tur_kod: e.tur_kod, adres: e.adres, meslek: e.meslek, dogum_tarihi: e.dogum_tarihi })
      if (error) console.error('ekstra detay', error)
      olusan.push(pid)
    }
    durumMsg(`${olusan.length} poliçe kaydedildi.`, 'ok')
    temizle(); await listeYukle()
  } catch (e) {
    console.error('police kaydet', e)
    durumMsg('Kaydedilemedi: ' + (e.message || e), 'hata')
  } finally {
    btn.disabled = false; btn.innerHTML = eski
  }
}

async function musteriKaydet() {
  const m = S.musteri
  const alan = { ad_soyad: m.ad_soyad, dogum_tarihi: m.dogum_tarihi || null, telefon: m.telefon || null, meslek: m.meslek || null, adres: m.adres || null }
  if (m.tc_kimlik) {
    const { data } = await supabase.from('sigorta_musterileri').select('id').eq('tc_kimlik', m.tc_kimlik).limit(1)
    if (data && data.length) {
      await supabase.from('sigorta_musterileri').update(alan).eq('id', data[0].id)
      return data[0].id
    }
  }
  const { data, error } = await supabase.from('sigorta_musterileri').insert({ tc_kimlik: m.tc_kimlik || null, ...alan, kaynak: 'MANUEL' }).select('id').single()
  if (error) throw error
  return data.id
}

async function aracKaydet(musteriId) {
  const a = S.arac
  const payload = {
    plaka: a.plaka || '—', ruhsat_seri_no: a.ruhsat_seri_no || null, model_yili: a.model_yili ? Number(a.model_yili) : null,
    tsb_marka_kodu: a.tsb_marka_kodu || null, tsb_tip_kodu: a.tsb_tip_kodu || null,
    marka: a.marka || null, versiyon: a.versiyon || null, tip: a.tip || 'OTOMOBIL',
    kaynak: a.kaynak || 'HARICI_MUSTERI', crm_arac_ref: a.crm_arac_ref || null, musteri_id: musteriId,
  }
  if (a.id) { await supabase.from('sigorta_araclari').update(payload).eq('id', a.id); return a.id }
  if (a.plaka) {
    const { data } = await supabase.from('sigorta_araclari').select('id').eq('plaka', a.plaka).eq('aktif', true).limit(1)
    if (data && data.length) { await supabase.from('sigorta_araclari').update(payload).eq('id', data[0].id); return data[0].id }
  }
  const { data, error } = await supabase.from('sigorta_araclari').insert(payload).select('id').single()
  if (error) throw error
  return data.id
}

async function policeEkle(turKod, p, aracId, musteriId) {
  const tur = turByKod(turKod)
  if (!tur) throw new Error(`Poliçe türü bulunamadı: ${turKod}`)
  const row = {
    police_no: (p.police_no || '').trim(),
    tur_id: tur.id, sirket_id: p.sirket_id, acente: 'SIGORTAN_SENINLE',
    tahsilat_sekli_id: S.tahsilat_sekli_id || null,
    // ⚠️ Yalnız kart_id yazılıyor; kart_maske/kart_adi'yı DB tetikleyicisi
    //    dolduruyor (sql/224). Buradan maske göndermek fotoğrafı ikinci bir
    //    yerde üretmek olurdu — biçim ayrışır.
    kart_id: S.kart_id || null,
    arac_id: aracId, musteri_id: musteriId, brut: Number(p.brut), net: Number(p.net),
    // ⚠️ ESKİDEN SABİT 0 GÖNDERİLİYORDU ve trigger her seferinde kendi
    //    oranını yazıyordu — kullanıcının girdiği oran hiç ulaşmıyordu.
    //    Boş bırakılırsa (null) trigger hesaplar; yazılırsa yazılan geçerli.
    komisyon_orani: String(p.komisyon_orani ?? '').trim() === ''
      ? null : Number(p.komisyon_orani),
    komisyon_tutari: 0,                      // trigger net × oran ile doldurur
    baslangic: p.baslangic || bugunISO(), bitis: p.bitis || artiYil(bugunISO(), 1),
    yeni_plaka: p.yeni_plaka || null, olusturan: benim.email,
    // Fırsattan gelindiyse bağ kurulur: DB tetikleyicisi (sql/217) fırsatı
    // KAZANILDI yapar ve siparişin danışmanına bildirim gönderir.
    firsat_id: FIRSAT_ID,
  }
  const { data, error } = await supabase.from('policeler').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

function temizle() {
  // ⚠️ Fırsat bağı da bırakılır. Bırakılmazsa aynı oturumda kesilen SONRAKİ
  //    poliçe yanlış fırsata bağlanır ve yanlış danışmana bildirim gider.
  FIRSAT_ID = null
  S.tahsilat_sekli_id = null
  S.kart_id = null
  S.musteri = { id: null, tc_kimlik: '', ad_soyad: '', dogum_tarihi: '', telefon: '', meslek: '', adres: '' }
  musteriTemizle(true)
}
function musteriTemizle(hepsi) {
  S.arac = { id: null, plaka: '', ruhsat_seri_no: '', model_yili: '', tsb_marka_kodu: '', tsb_tip_kodu: '', marka: '', versiyon: '', kasko_degeri: '', tip: 'OTOMOBIL', kaynak: 'HARICI_MUSTERI', crm_arac_ref: null }
  if (hepsi) {
    // ⚠️ İKİNCİ SIFIRLAMA — baştaki S.police ile ALAN ALAN AYNI OLMALI.
    //    Burada belge_no kalmış ve komisyon_orani eksikti: temizledikten
    //    sonra komisyon kutusu tanımsız oluyor, kaldırılan alan geri geliyordu.
    S.police = {
      trafik: { sirket_id: null, brut: '', net: '', police_no: '', yeni_plaka: '', komisyon_orani: '', baslangic: bugunISO(), bitis: artiYil(bugunISO(), 1) },
      kasko:  { sirket_id: null, brut: '', net: '', police_no: '', yeni_plaka: '', komisyon_orani: '', baslangic: bugunISO(), bitis: artiYil(bugunISO(), 1) },
    }
    S.tahsilat_sekli_id = null
    // ⚠️ İKİNCİ SIFIRLAMA — yukarıdaki temizle() ile alan alan aynı olmalı.
    //    kart_id burada unutulursa bir sonraki poliçe ÖNCEKİ kartla kaydedilir.
    S.kart_id = null
    S.ekstra = []
  }
  document.getElementById('pgSistemRozet')?.classList.add('hidden')
  document.getElementById('pgMusteriDurum').innerHTML = ''
  musteriFormCiz(); aracFormCiz(); sekmelerCiz(); policePanelCiz(); ekstraCiplerCiz(); ekstraListeCiz()
}

// --------------------------------------------------------- Son poliçeler
async function listeYukle() {
  const kok = document.getElementById('pgListe')
  const { data, error } = await supabase.from('policeler')
    .select('id, police_no, brut, net, komisyon_tutari, baslangic, bitis, durum, created_at, police_turleri(ad,kod), sigorta_sirketleri(ad), sigorta_araclari(plaka), sigorta_musterileri(ad_soyad)')
    .order('created_at', { ascending: false }).limit(20)
  if (error) { kok.innerHTML = `<div class="bg-error-container text-on-error-container rounded-xl p-4">Yüklenemedi: ${kacis(error.message)}</div>`; return }
  const rows = data || []
  if (!rows.length) { kok.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 text-center text-on-surface-variant">Henüz poliçe kesilmedi.</div>`; return }
  kok.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden custom-shadow">
    <div class="overflow-x-auto"><table class="w-full text-left">
      <thead class="bg-surface-container-low border-b border-outline-variant"><tr>
        ${['Poliçe No', 'Tür', 'Şirket', 'Müşteri / Araç', 'Brüt', 'Komisyon', 'Tarih'].map(h => `<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant whitespace-nowrap">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-outline-variant text-body-md">${rows.map(r => `<tr class="hover:bg-surface-container-low">
        <td class="px-4 py-3 font-mono text-label-md">${kacis(r.police_no)}</td>
        <td class="px-4 py-3">${kacis(r.police_turleri?.ad || '—')}</td>
        <td class="px-4 py-3">${kacis(r.sigorta_sirketleri?.ad || '—')}</td>
        <td class="px-4 py-3"><div class="font-semibold">${kacis(r.sigorta_musterileri?.ad_soyad || '—')}</div><div class="text-[11px] text-on-surface-variant">${kacis(r.sigorta_araclari?.plaka || '')}</div></td>
        <td class="px-4 py-3 whitespace-nowrap">${fmtPara(r.brut)}</td>
        <td class="px-4 py-3 whitespace-nowrap font-semibold text-primary">${fmtPara(r.komisyon_tutari)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-on-surface-variant">${new Date(r.created_at).toLocaleDateString('tr-TR')}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>`
}
