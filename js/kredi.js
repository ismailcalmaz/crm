// =====================================================================
// kredi.js — Kredi Operasyon Merkezi (çalışma alanı: sol liste + sağ dosya)
//
// Düzen değişti, İŞ KURALLARI aynen korunuyor (kredi-islem.js'ten):
//   * Çipe dokunulmadıysa o kuruma BAŞVURULMAMIŞTIR.
//   * Kullandırıldı → diğer onaylar otomatik pasif (trigger sql/35).
//   * Onaya geçişte onay_tarihi damgalanır ("N gündür onaylı").
//   * TCKN/red nedeni gizli tabloda (yalnızca kredi + yönetici).
//   * Satış danışmanı SALT-OKUMA (çip/atama/sonlandırma gizli).
// Workspace düzeni 1200-buton sorununu da çözer: yalnızca SEÇİLİ dosyanın
// 12 çipi çizilir, sol liste hafif satırlardır.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import {
  danismanAdi, danismanMap, fmtPara, fmtTarihKisa, kacis, urlParam, buyuk, dbHata,
  BANKALAR, krediSonucEtiket, krediSonucSinif, RED_NEDENLERI, kaskoKodu, evrakEtiket,
} from './veri.js'
import { mat, pill, avatar, uyari, binlikInputKur, bilgiKutu } from './stitch-ui.js'
import { cipMenuAc, atamaYaz, duzenleAc, sonlandirAc, kullandirimBaslatAc } from './kredi-islem.js'
import { kaskoBedeliYukle } from './kredi-hesap.js'
import { evrakAc } from './siparis-evrak.js'
import { guncelIsteBtnHtml, guncelEkspertizAc } from './guncel-ekspertiz.js'

const ctx = () => ({ benim, dmap, yenile: yukle })

let benim = null, dmap = {}, aktifAraclar = new Set()
let _hepsi = [], arama = '', arsivGoster = false, saltOkur = false
let filtre = 'tumu', seciliId = null
const ONAYLI = ['onay', 'kismi_onay']

// Araç bilgi katmanı (kasko · belgeler · güncel ekspertiz) — dosya AÇILDIKÇA
// tembel yüklenir ve önbelleğe alınır.
// ⚠️ Neden toplu değil: tsb_kasko_liste eşleşmesi araç başına ayrı sorgu ister
//   (marka+tip+yıl üçlüsü), arac_evraklar ise dosya başına 3-4 satır — arşivle
//   birlikte yüzlerce dosyada tek `.in()` sorgusu 1000 satır limitine takılırdı
//   (CLAUDE.md §5.3). Seçili dosya için 3 küçük sorgu, sonrası önbellek.
let ARAC_BILGI = new Map()    // stok_araclar.id → { arac, evrak:{tip:yol}, kasko }
let EKSPERTIZ_FIRMA = {}      // tanimlar tip=EKSPERTIZ_FIRMASI → {kod:{ad, grup_adi}}

export async function krediKur(danisman) {
  benim = danisman
  // Bildirim linki (kredi.html?id=…) → o dosyayı aç. Sonlandırılmış olabilir,
  // arşivi de aç ki listeye gelsin.
  const acId = urlParam('id')
  if (acId) { seciliId = acId; arsivGoster = true }
  saltOkur = !(benim.master_admin || benim.rol === 'kredi' || benim.rol === 'yonetici')
  binlikInputKur()
  dmap = await danismanMap()
  await ekspertizFirmalariYukle()
  document.getElementById('yenile')?.addEventListener('click', () => yukle())
  let z
  document.getElementById('krediArama')?.addEventListener('input', e => {
    clearTimeout(z); arama = e.target.value.trim().toLocaleLowerCase('tr'); z = setTimeout(() => yukle(), 250)
  })
  document.getElementById('arsivChk')?.addEventListener('change', e => { arsivGoster = e.target.checked; yukle() })
  document.getElementById('krediFiltreler')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return; filtre = b.dataset.f; listeCiz()
  })
  await yukle()
}

async function yukle() {
  // "Stokta görünmüyor" uyarısı için aktif araç referansları: hem SITE ilan
  // araçları hem DMS stok_araclar (Krediye Gönder DMS aracının id'sini stok_ref yapar).
  const [{ data: araclar }, { data: dmsAraclar }] = await Promise.all([
    siteDb.from('araclar').select('id').eq('durum', 'aktif').limit(2000),
    supabase.from('stok_araclar').select('id').in('durum', ['ALINDI', 'STOKTA', 'YAYINDA', 'REZERVE', 'SIPARISTE']).limit(3000),
  ])
  aktifAraclar = new Set([...(araclar || []).map(a => a.id), ...(dmsAraclar || []).map(a => a.id)])

  let q = supabase.from('kredi_basvurulari')
    .select('*, kredi_banka_sonuclari(id, banka, banka_kod, vade, sonuc, tutar, satis_beyani, onay_tarihi, not_metni), kredi_basvuru_gizli(tckn, red_nedeni, red_yorum)')
    .order('created_at', { ascending: true }).order('id', { ascending: true })
  if (!arsivGoster) q = q.eq('durum', 'kuyrukta')
  const { data, error } = await q
  if (error) { document.getElementById('kuyrukListe').innerHTML = uyari('Kuyruk okunamadı: ' + kacis(error.message)); return }

  let hepsi = data || []
  if (arama) hepsi = hepsi.filter(b =>
    [(b.musteri_ad_soyad || ''), (b.telefon || ''), (b.plaka || ''), (b.arac_ozet || '')].join(' ').toLocaleLowerCase('tr').includes(arama))
  _hepsi = hepsi
  kpiCiz(); listeCiz()
}

// --- Sınıflandırma yardımcıları ---
const bankalari = b => b.kredi_banka_sonuclari || []
const kullandirildiMi = b => bankalari(b).some(s => s.sonuc === 'kullandirildi')
const onayliMi = b => !kullandirildiMi(b) && bankalari(b).some(s => ONAYLI.includes(s.sonuc))
function gunFarki(ts) { return ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : null }
function enEskiOnayGun(b) {
  return bankalari(b).filter(s => ONAYLI.includes(s.sonuc)).map(s => gunFarki(s.onay_tarihi)).filter(g => g !== null).sort((a, c) => c - a)[0]
}
const riskliMi = b => { const g = enEskiOnayGun(b); return onayliMi(b) && g != null && g >= 7 }
function gizliAl(b) { const g = b.kredi_basvuru_gizli; return Array.isArray(g) ? (g[0] || {}) : (g || {}) }
function dosyaNo(b) { return '#CR-' + String(b.id).replace(/\D/g, '').slice(-6).padStart(6, '0') }

// Dosyanın "kredi tutarı": kullandırılan varsa o, yoksa en yüksek onay tutarı
function dosyaTutar(b) {
  const kull = bankalari(b).find(s => s.sonuc === 'kullandirildi')
  if (kull) return (kull.banka === 'Otosor' && kull.satis_beyani != null) ? kull.satis_beyani : kull.tutar
  const onaylar = bankalari(b).filter(s => ONAYLI.includes(s.sonuc)).map(s => Number(s.tutar) || 0)
  return onaylar.length ? Math.max(...onaylar) : null
}

// =====================================================================
// Araç bilgi katmanı — kasko kodu · kasko değeri · ruhsat/ekspertiz/SBM
//
// Göksenil (3 Ağu 2026): "kredi personeli de kredisi onaylı ise güncel
//   ekspertizi kendileri isteyebiliyorlar; onlar için en uygun yer kredi
//   kuyruğundaki araç sekmesinde olabilir. ayrıca oraya kasko kodu - kasko
//   değeri - ruhsat - ekspertiz - sbm görselini de eklememiz gerekiyor."
// =====================================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// ⚠️ kredi_basvurulari.stok_ref METİNDİR: DMS aracında stok_araclar.id (uuid),
//   SITE ilan aracında site araclar.id. uuid değilse stok_araclar sorgusu
//   PostgREST'te 22P02 ile patlar — önce biçimi doğrula.
const STOK_KOLON = 'id, marka, model, versiyon, yil, plaka, sasi_no, ruhsat_seri_no, kasko_kodu, tsb_marka_id, tsb_tip_id, ekspertiz_firma'

async function ekspertizFirmalariYukle() {
  const { data, error } = await supabase.from('tanimlar')
    .select('kod, ad, ozellikler').eq('tip', 'EKSPERTIZ_FIRMASI').eq('aktif', true)
  if (error) { dbHata('ekspertiz firma tanımları', error); return }
  EKSPERTIZ_FIRMA = {}
  for (const t of (data || [])) EKSPERTIZ_FIRMA[t.kod] = { ad: t.ad, ...(t.ozellikler || {}) }
}

async function aracBilgiYukle(aracId) {
  if (!aracId || !UUID_RE.test(aracId)) return null
  if (ARAC_BILGI.has(aracId)) return ARAC_BILGI.get(aracId)

  // ⚠️ GEÇİCİ YEDEK YOL: stok_araclar.guncel_ekspertiz_istendi kolonunu sql/152
  //   açacak. O migration canlıya alınmadan bu sayfa deploy edilirse PostgREST
  //   42703 döndürüp SORGUNUN TAMAMINI düşürür ve araç kutusu boş kalırdı.
  //   sql/152 uygulandıktan sonra bu if bloğu silinebilir (temizlik listesi).
  let { data: arac, error } = await supabase.from('stok_araclar')
    .select(STOK_KOLON + ', guncel_ekspertiz_istendi').eq('id', aracId).maybeSingle()
  if (error && error.code === '42703') {
    console.warn('[kredi] stok_araclar.guncel_ekspertiz_istendi yok — sql/152 bekleniyor')
    ;({ data: arac, error } = await supabase.from('stok_araclar')
      .select(STOK_KOLON).eq('id', aracId).maybeSingle())
  }
  if (error) { dbHata('kredi araç bilgisi', error); return null }

  let bilgi = { arac: arac || null, evrak: {}, kasko: null }
  if (arac) {
    const [{ data: evraklar, error: evErr }, kasko] = await Promise.all([
      supabase.from('arac_evraklar').select('tip, url').eq('arac_id', aracId),
      kaskoBedeliYukle(supabase, arac),   // tsb_kasko_liste — tek araç, filtreli
    ])
    if (evErr) dbHata('araç evrakları', evErr)
    for (const e of (evraklar || [])) if (!bilgi.evrak[e.tip] && e.url) bilgi.evrak[e.tip] = e.url
    bilgi.kasko = kasko
  }
  ARAC_BILGI.set(aracId, bilgi)
  return bilgi
}

// Yükleme iskeleti — beş kutucuk, aynı ölçüde
const EK_ISKELET = `<div class="mt-2 pt-2 border-t border-outline-variant/60 grid grid-cols-2 md:grid-cols-3 gap-x-2 gap-y-0.5">
  ${[0, 1, 2, 3, 4].map(() => `<div class="flex items-center gap-2 p-2 animate-pulse">
    <span class="w-8 h-8 rounded-lg bg-surface-container-high"></span>
    <div class="flex-1 space-y-1"><div class="h-2 w-12 rounded bg-surface-container-high"></div><div class="h-2.5 w-20 rounded bg-surface-container-high"></div></div>
  </div>`).join('')}</div>`

function aracEkHtml(b, bilgi, kapali) {
  if (!bilgi?.arac) {
    return b.stok_ref
      ? `<p class="text-label-sm text-on-surface-variant mt-2 flex items-center gap-1">${mat('info', 'text-[15px]')} Bu dosya DMS stok aracına bağlı değil — kasko ve belge bilgisi yok.</p>`
      : ''
  }
  const a = bilgi.arac
  const ev = bilgi.evrak || {}
  const yok = '<span class="text-on-surface-variant font-normal">—</span>'
  const kod = kaskoKodu(a)
  const kasko = bilgi.kasko

  // Belge kutucuğu — bucket ÖZEL: doğrudan href 404 verir, evrakAc imzalı URL
  // üretip pop-up'ta açar (satış dosyasındaki ders, siparis-evrak.js).
  const belge = (ikon, tip, deger) => {
    const yol = ev[tip] || null
    const ad = evrakEtiket(tip)
    return bilgiKutu(ikon, ad, yol ? kacis(deger) : yok, yol
      ? { vurgu: 'bg-primary-fixed text-primary', tikla: { veri: { yol, ad }, baslik: ad + ' — pop-up\'ta aç' } }
      : {})
  }

  // "Güncel İste": Göksenil'in kuralı — kredi ONAYLANDIYSA istenir. Onaysız
  // dosyada düğme gizlenmez, PASİF gösterilir (neden istenemediği yazsın).
  const uygun = onayliMi(b) || kullandirildiMi(b)
  const btn = (kapali || saltOkur) ? '' : guncelIsteBtnHtml(a.guncel_ekspertiz_istendi, {
    id: 'krGuncelIste',
    pasif: !uygun,
    pasifBaslik: 'Güncel ekspertiz, kredi onayı geldikten sonra istenir.',
  })
  const ipucu = !uygun ? 'Kredi onaylandığında güncel kilometreli ekspertiz isteyebilirsiniz.'
    : a.guncel_ekspertiz_istendi ? 'Son istek: ' + fmtTarihKisa(a.guncel_ekspertiz_istendi)
      : 'Ekspertiz firmasından güncel kilometreli rapor iste.'

  return `<div class="mt-2 pt-2 border-t border-outline-variant/60">
    <div class="grid grid-cols-2 md:grid-cols-3 gap-x-2 gap-y-0.5">
      ${bilgiKutu('shield', 'Kasko Kodu', kod ? kacis(kod) : yok, { vurgu: kod ? 'bg-primary-fixed text-primary' : '' })}
      ${bilgiKutu('payments', 'Kasko Değeri', kasko != null ? kacis(fmtPara(kasko)) : yok, { vurgu: kasko != null ? 'bg-secondary-container text-on-secondary-container' : '' })}
      ${belge('description', 'RUHSAT', buyuk(a.ruhsat_seri_no) || 'Belgeyi Aç')}
      ${belge('fact_check', 'EKSPERTIZ_PDF', 'Raporu Aç')}
      ${belge('report', 'SBM_GORSEL', 'Belgeyi Aç')}
    </div>
    ${btn ? `<div class="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-outline-variant/40 flex-wrap">
      ${btn}<span class="text-[11px] text-on-surface-variant">${kacis(ipucu)}</span></div>` : ''}
  </div>`
}

async function aracEkDoldur(b, kapali) {
  const aracId = b.stok_ref
  const hedef = document.getElementById('krAracEk')
  if (!hedef) return
  if (!aracId) { hedef.innerHTML = ''; return }
  if (!ARAC_BILGI.has(aracId)) hedef.innerHTML = EK_ISKELET

  const bilgi = await aracBilgiYukle(aracId)
  // Cevap gelene kadar kullanıcı başka dosya açmış olabilir — geç gelen
  // sonucu YAZMA, yoksa panelde yanlış aracın kaskosu görünür.
  if (seciliId !== b.id) return
  const el = document.getElementById('krAracEk')
  if (!el) return
  el.innerHTML = aracEkHtml(b, bilgi, kapali)

  el.querySelectorAll('button[data-yol]').forEach(btn => btn.addEventListener('click',
    () => evrakAc(btn.dataset.yol, btn.dataset.ad, buyuk(bilgi?.arac?.plaka || b.plaka || ''))))
  el.querySelector('#krGuncelIste')?.addEventListener('click', () => guncelIsteAc(b, bilgi))
}

function guncelIsteAc(b, bilgi) {
  const a = bilgi?.arac
  if (!a) return
  const baslik = [a.yil, a.marka, a.model].filter(Boolean).join(' ') || b.arac_ozet || 'Araç —'
  return guncelEkspertizAc({
    plaka: a.plaka || b.plaka,
    baslik,
    sasi: a.sasi_no,
    ruhsatYol: bilgi.evrak.RUHSAT || null,
    firma: a.ekspertiz_firma ? EKSPERTIZ_FIRMA[a.ekspertiz_firma] || null : null,
    aracId: a.id || null,
    ekspertizYol: bilgi.evrak.EKSPERTIZ_PDF || null,
    firmalar: Object.entries(EKSPERTIZ_FIRMA).map(([kod, f]) => ({ kod, ...f })),
    // ⚠️ Sipariş RPC'si DEĞİL: kredi kuyruğunda sipariş olmayabilir ve kredi
    //   personeli siparis.danisman_id kontrolünden geçemez (sql/151). Araç
    //   tabanlı ikiz RPC (sql/152) aynı biçimde {tamam, ruhsat_var, …} döner.
    istek: () => supabase.rpc('guncel_ekspertiz_iste_arac', { p_arac: a.id }),
    yenile: async () => { ARAC_BILGI.delete(a.id); await aracEkDoldur(b, b.durum === 'sonlandirildi') },
  })
}

// --- Görev sayaçları ---
function kpiCiz() {
  const kuyrukta = _hepsi.filter(b => b.durum === 'kuyrukta')
  const kullandirilan = kuyrukta.filter(kullandirildiMi)
  const onayli = kuyrukta.filter(onayliMi)
  const riskli = kuyrukta.filter(riskliMi)
  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('krediKpi').innerHTML =
    kart('inbox', 'bg-primary-fixed text-primary', 'Kuyrukta', kuyrukta.length, 'açık dosya') +
    kart('verified', 'bg-green-100 text-green-700', 'Onaylı — bekliyor', onayli.length, 'kullandırım bekliyor') +
    kart('paid', 'bg-yellow-100 text-yellow-800', 'Kullandırıldı', kullandirilan.length, 'sonlandırma bekliyor') +
    kart('warning', 'bg-error-container text-error', 'Riskli', riskli.length, '7+ gündür onaylı')
}

// --- Sol liste ---
function esle(b, k) {
  if (k === 'calisilan') return b.durum === 'kuyrukta' && !kullandirildiMi(b) && !onayliMi(b)
  if (k === 'onayli') return b.durum === 'kuyrukta' && onayliMi(b)
  if (k === 'kullandirildi') return b.durum === 'kuyrukta' && kullandirildiMi(b)
  if (k === 'riskli') return riskliMi(b)
  if (k === 'arsiv') return b.durum === 'sonlandirildi'
  return true   // tumu
}
function filtrele(liste) { return liste.filter(b => esle(b, filtre)) }
function sayFiltre(k) { return _hepsi.filter(b => esle(b, k)).length }

function listeCiz() {
  filtreCiz()
  const hedef = document.getElementById('kuyrukListe')
  const veri = filtrele(_hepsi)
  document.getElementById('kuyrukSayac').textContent = `${veri.length} dosya`
  if (!veri.length) {
    hedef.innerHTML = `<div class="flex flex-col items-center justify-center text-center py-12 text-on-surface-variant">${mat('folder_off', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">Bu filtrede dosya yok.</p></div>`
    panelVarsayilan(veri); return
  }
  hedef.innerHTML = veri.map(satir).join('')
  hedef.querySelectorAll('[data-dosya]').forEach(el => el.addEventListener('click', () => dosyaAc(el.dataset.dosya)))
  panelVarsayilan(veri)
}

function filtreCiz() {
  const ops = [['tumu', 'Tümü'], ['calisilan', 'Çalışılan'], ['onayli', 'Onaylı'], ['kullandirildi', 'Kullandırıldı'], ['riskli', 'Riskli']]
  if (arsivGoster) ops.push(['arsiv', 'Sonlandırılmış'])
  document.getElementById('krediFiltreler').innerHTML = ops.map(([k, l]) => {
    const a = k === filtre
    return `<button data-f="${k}" class="px-md py-xs rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} (${sayFiltre(k)})</button>`
  }).join('')
}

function satir(b) {
  const aktif = seciliId === b.id
  const kapali = b.durum === 'sonlandirildi'
  const dokunulan = bankalari(b).filter(s => s.sonuc && s.sonuc !== 'pasif').length
  const t = dosyaTutar(b)
  const risk = riskliMi(b)
  let rozet = ''
  if (kapali) rozet = `<span class="text-[11px] font-bold ${b.sonuc === 'onayli' ? 'text-green-700' : 'text-error'}">${b.sonuc === 'onayli' ? 'Onaylı kapandı' : 'Redli kapandı'}</span>`
  else if (kullandirildiMi(b)) rozet = `<span class="text-[11px] font-bold text-yellow-700">Kullandırıldı</span>`
  else if (onayliMi(b)) { const g = enEskiOnayGun(b); rozet = `<span class="text-[11px] font-bold ${risk ? 'text-error' : 'text-green-700'}">${g != null ? g + ' gündür onaylı' : 'Onaylı'}</span>` }
  else rozet = `<span class="text-[11px] text-on-surface-variant">${dokunulan ? dokunulan + ' banka başvuruldu' : 'yeni dosya'}</span>`
  const bar = risk ? 'border-error' : kullandirildiMi(b) ? 'border-yellow-400' : onayliMi(b) ? 'border-green-500' : 'border-outline-variant'

  return `<div data-dosya="${b.id}" class="group cursor-pointer bg-white rounded-xl border border-outline-variant/70 border-l-4 ${bar} ${aktif ? 'ring-2 ring-primary/30 bg-primary/5' : 'hover:shadow-md'} transition-all p-3">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2.5 min-w-0">${avatar(b.musteri_ad_soyad, 'w-8 h-8')}
        <div class="min-w-0"><p class="font-bold text-on-surface truncate">${kacis(b.musteri_ad_soyad) || '—'}</p>
          <p class="text-[11px] text-on-surface-variant truncate">${kacis(b.arac_ozet || '—')}${b.plaka ? ' · <b class="text-on-surface">' + kacis(b.plaka) + '</b>' : ''}</p></div></div>
      <div class="text-right shrink-0">${t != null ? `<div class="font-black text-on-surface text-body-md">${fmtPara(t)}</div>` : ''}${rozet}</div>
    </div>
  </div>`
}

// --- Sağ çalışma alanı ---
function panelVarsayilan(veri) {
  if (window.innerWidth < 1280) return
  if (seciliId && veri.some(b => b.id === seciliId)) dosyaAc(seciliId, true)
  else if (veri.length) { seciliId = null; dosyaAc(veri[0].id, true) }
  else { seciliId = null; panelBos() }
}
function panelBos() {
  const p = document.getElementById('dosyaCalisma')
  p.classList.remove('hidden')
  p.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">${mat('account_balance', 'text-5xl opacity-30')}<p class="mt-3 font-semibold text-on-surface">Bir dosya seçin</p><p class="text-label-sm mt-1 max-w-[240px]">Banka statü paneli, timeline ve işlemler burada açılır.</p></div>`
}

function stepperCiz(b) {
  const asamalar = [
    ['Başvuru', true],
    ['Onay', onayliMi(b) || kullandirildiMi(b)],
    ['Kullandırım', kullandirildiMi(b)],
    ['Sonlandırma', b.durum === 'sonlandirildi'],
  ]
  return `<div class="flex items-center gap-1.5 mt-3">${asamalar.map(([ad, tamam], i) => `
    <div class="flex items-center gap-1.5 ${i ? 'flex-1' : ''}">
      ${i ? `<div class="flex-1 h-0.5 ${tamam ? 'bg-primary' : 'bg-outline-variant'}"></div>` : ''}
      <div class="flex items-center gap-1 shrink-0">
        <span class="w-5 h-5 rounded-full flex items-center justify-center text-[12px] ${tamam ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}">${tamam ? mat('check', 'text-[13px]') : (i + 1)}</span>
        <span class="text-[11px] font-bold ${tamam ? 'text-primary' : 'text-on-surface-variant'} hidden sm:inline">${ad}</span>
      </div>
    </div>`).join('')}</div>`
}

function bankaGrid(b, kapali) {
  const harita = Object.fromEntries(bankalari(b).map(s => [s.banka, s]))
  const pasif = kapali || saltOkur
  return BANKALAR.map(banka => {
    const s = harita[banka]
    const sinif = s ? krediSonucSinif(s.sonuc) : 'bg-surface-container border-outline-variant border-dashed text-on-surface-variant'
    const tutar = (s?.banka === 'Otosor' && s?.satis_beyani != null) ? s.satis_beyani : s?.tutar
    // R6-4 Faz B: onaylı/kısmi onaylı bir sonuçta "Kullandırma Başla" — kredi
    // müdürü onayına gider (kredi_kullandirim_baslat RPC). Doğrudan 'kullandirildi'
    // yazmak yerine bu yol izlenir (bkz. kredi-islem.js kullandirimBaslatAc).
    const kullandirimUygun = !pasif && s && ONAYLI.includes(s.sonuc)
    return `<div class="border rounded-xl p-3 text-left min-h-[92px] flex flex-col ${sinif}${pasif ? ' opacity-70' : ''}">
      <button type="button" data-cip="${kacis(banka)}"${pasif ? ' disabled' : ''} class="flex-1 flex flex-col items-start text-left w-full${pasif ? '' : ' hover:opacity-90 transition-opacity'}">
        <span class="text-[11px] font-bold uppercase tracking-wide opacity-80">${kacis(banka)}</span>
        <span class="text-label-md font-bold mt-0.5">${s ? kacis(krediSonucEtiket(s.sonuc)) : 'Başvurulmadı'}</span>
        ${tutar != null ? `<span class="text-title-lg font-black leading-tight mt-auto">${kacis(fmtPara(tutar))}</span>` : '<span class="mt-auto"></span>'}
        ${s?.not_metni ? `<span class="text-[10px] leading-tight mt-1 bg-black/5 rounded px-1 py-0.5 truncate">📝 ${kacis(s.not_metni)}</span>` : ''}
      </button>
      ${kullandirimUygun ? `<button type="button" data-kullandirim-baslat="${kacis(banka)}" class="mt-1.5 pt-1.5 border-t border-current/20 text-[10px] font-black uppercase tracking-wide text-left hover:underline flex items-center gap-1">${mat('bolt', 'text-[13px]')} Kullandırma Başla</button>` : ''}
    </div>`
  }).join('')
}

function timelineCiz(b) {
  const olaylar = []
  olaylar.push({ ts: b.created_at, ik: 'add_circle', b: 'Dosya oluşturuldu', m: danismanAdi(dmap, b.gonderen_id) + ' gönderdi' })
  for (const s of bankalari(b)) {
    if (ONAYLI.includes(s.sonuc) && s.onay_tarihi) olaylar.push({ ts: s.onay_tarihi, ik: 'verified', b: `${s.banka} onayı`, m: (s.tutar ? fmtPara(s.tutar) : '') + (s.sonuc === 'kismi_onay' ? ' (kısmi)' : '') })
    if (s.sonuc === 'kullandirildi' && s.onay_tarihi) olaylar.push({ ts: s.onay_tarihi, ik: 'paid', b: `${s.banka} kullandırıldı`, m: fmtPara((s.banka === 'Otosor' && s.satis_beyani != null) ? s.satis_beyani : s.tutar) })
  }
  if (b.durum === 'sonlandirildi' && b.sonlandirma_tarihi) olaylar.push({ ts: b.sonlandirma_tarihi, ik: 'flag', b: b.sonuc === 'onayli' ? 'Onaylı kapandı' : 'Redli kapandı', m: '' })
  olaylar.sort((x, y) => new Date(y.ts) - new Date(x.ts))
  const notlar = bankalari(b).filter(s => s.not_metni)
  return `<div class="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[6px] before:top-1 before:bottom-1 before:w-px before:bg-outline-variant">
    ${olaylar.map(o => `<div class="relative">
      <div class="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full bg-primary ring-4 ring-white"></div>
      <div class="flex justify-between items-baseline gap-2"><span class="font-bold text-label-md text-on-surface flex items-center gap-1.5">${mat(o.ik, 'text-[15px] text-on-surface-variant')} ${kacis(o.b)}</span><span class="text-[11px] text-on-surface-variant shrink-0">${fmtTarihKisa(o.ts)}</span></div>
      ${o.m ? `<p class="text-label-sm text-on-surface-variant mt-0.5">${kacis(o.m)}</p>` : ''}</div>`).join('')}
    </div>
    ${notlar.length ? `<p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mt-4 mb-2">Banka notları</p><div class="space-y-1.5">${notlar.map(s => `<div class="bg-surface-container-low rounded-lg px-3 py-2 text-label-sm"><b>${kacis(s.banka)}:</b> ${kacis(s.not_metni)}</div>`).join('')}</div>` : ''}
    <p class="text-[10px] text-on-surface-variant mt-3">Timeline yalnızca dosya açılışı + onay/kullandırım tarihlerini gösterir; başvuru/red için ayrı zaman damgası tutulmuyor.</p>`
}

function dosyaAc(id, sessiz) {
  const b = _hepsi.find(x => x.id === id); if (!b) return
  seciliId = id
  const panel = document.getElementById('dosyaCalisma')
  const katman = document.getElementById('dosyaKatman')
  const kapali = b.durum === 'sonlandirildi'
  const gizli = gizliAl(b)
  const aracYok = b.stok_ref && !aktifAraclar.has(b.stok_ref)
  const t = dosyaTutar(b)
  const personel = b.kredi_personeli_id ? danismanAdi(dmap, b.kredi_personeli_id) : null
  const wa = (function () { const d = (b.telefon || '').replace(/\D/g, ''); if (!d) return null; const n = d.startsWith('0') ? '9' + d : d.startsWith('90') ? d : '90' + d; return 'https://wa.me/' + n })()

  const atamaHtml = (kapali || saltOkur) ? '' : (b.kredi_personeli_id === benim.id
    ? `<span class="inline-flex items-center gap-1">${pill('Sende', 'basari')}<button data-birak class="text-label-sm text-on-surface-variant underline">bırak</button></span>`
    : (personel
      ? `<span class="inline-flex items-center gap-1">${pill(personel, 'bilgi')}<button data-devral class="text-label-sm text-on-surface-variant underline">devral</button></span>`
      : `<button data-uzerinal class="text-label-md text-primary font-bold underline">Üzerine al</button>`))

  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant">
      <div class="flex justify-between items-start gap-3">
        <div class="flex items-center gap-3 min-w-0">${avatar(b.musteri_ad_soyad, 'w-12 h-12')}
          <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate">${kacis(b.musteri_ad_soyad) || '—'}</h3>
            <p class="text-label-md text-on-surface-variant truncate">${dosyaNo(b)} · ${kacis(b.telefon || '—')}${gizli.tckn ? ' · <b class="text-on-surface">TC ' + kacis(gizli.tckn) + '</b>' : ''}</p></div></div>
        <div class="text-right shrink-0">
          <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Kredi tutarı</p>
          <p class="text-headline-sm font-black text-primary leading-tight">${t != null ? fmtPara(t) : '—'}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 mt-2 flex-wrap">
        ${kapali ? pill(b.sonuc === 'onayli' ? 'Onaylı kapandı' : 'Redli kapandı', b.sonuc === 'onayli' ? 'basari' : 'uyari') : atamaHtml}
        <button id="dosyaKapat" class="ml-auto p-1.5 hover:bg-surface-container-high rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      ${stepperCiz(b)}
    </div>
    <div class="flex-1 overflow-y-auto p-lg space-y-5">
      <div class="bg-surface-container-low rounded-xl p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Araç</p>
        <p class="text-body-lg font-medium text-on-surface mt-0.5">${kacis(b.arac_ozet || '—')}</p>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-label-md">
          ${b.plaka ? `<span class="text-on-surface-variant">Plaka: <b class="text-on-surface font-mono">${kacis(b.plaka)}</b></span>` : ''}
          <span class="text-on-surface-variant">Satış danışmanı: <b class="text-on-surface">${kacis(danismanAdi(dmap, b.satis_danismani_id || b.gonderen_id))}</b></span>
        </div>
        ${aracYok ? `<p class="text-label-md text-error mt-1 flex items-center gap-1">${mat('warning', 'text-[16px]')} Bu araç stokta görünmüyor</p>` : ''}
        ${b.aciklama ? `<p class="text-body-md text-on-surface-variant mt-1.5">${kacis(b.aciklama)}</p>` : ''}
        ${kapali && gizli.red_nedeni ? `<p class="text-body-md text-error mt-2">Red nedeni: ${kacis((RED_NEDENLERI.find(x => x[0] === gizli.red_nedeni) || [])[1] || gizli.red_nedeni)}${gizli.red_yorum ? ' — ' + kacis(gizli.red_yorum) : ''}</p>` : ''}
        <!-- kasko kodu · kasko değeri · ruhsat / ekspertiz / SBM + Güncel İste (tembel yüklenir) -->
        <div id="krAracEk"></div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Banka Statü Paneli${kapali ? ' (kapalı)' : saltOkur ? ' (salt okuma)' : ''}</p>
          <div class="flex items-center gap-2 text-[10px] text-on-surface-variant"><span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-500"></span>Onay</span><span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span>Kısmi</span><span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-500"></span>Red</span></div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${bankaGrid(b, kapali)}</div>
        ${(kapali || saltOkur) ? '' : '<p class="text-[11px] text-on-surface-variant mt-2">Başvurduğun kuruma dokun: durum · tutar · not gir.</p>'}
      </div>
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-3">Operasyonel Timeline</p>
        ${timelineCiz(b)}
      </div>
    </div>
    ${(kapali || saltOkur) ? '' : `
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest flex flex-wrap items-center gap-2">
      ${b.telefon ? `<a href="tel:${kacis(b.telefon)}" class="flex-1 min-w-[90px] bg-primary text-on-primary py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('call', 'text-[18px]')} Ara</a>` : ''}
      ${wa ? `<a href="${wa}" target="_blank" class="flex-1 min-w-[90px] bg-[#25D366] text-white py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:opacity-90">${mat('chat', 'text-[18px]')} WhatsApp</a>` : ''}
      <button id="dosyaDuzenle" class="border border-outline-variant px-3 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">${mat('edit', 'text-[18px]')}</button>
      <button id="dosyaSonlandir" class="border border-outline-variant px-3 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Sonlandır</button>
    </div>`}`

  panel.classList.remove('hidden')
  if (window.innerWidth < 1280) {
    panel.classList.add('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[96vw]', 'max-w-[520px]', 'rounded-none')
    katman.classList.remove('hidden')
  }
  const kapat = () => { panel.classList.add('hidden'); panel.classList.remove('fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[96vw]', 'max-w-[520px]', 'rounded-none'); katman.classList.add('hidden'); seciliId = null; listeCiz() }
  document.getElementById('dosyaKapat').addEventListener('click', kapat)
  katman.onclick = kapat

  // Araç kutusunun zengin kısmı (kasko · belgeler · Güncel İste) — panel
  // ÇİZİLDİKTEN sonra doldurulur; sorguları paneli bekletmesin.
  aracEkDoldur(b, kapali)

  if (!saltOkur && !kapali) {
    panel.querySelectorAll('[data-cip]').forEach(btn => btn.addEventListener('click', () => cipMenuAc(b, btn.dataset.cip, ctx())))
    panel.querySelectorAll('[data-kullandirim-baslat]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation()
      const s = bankalari(b).find(x => x.banka === btn.dataset.kullandirimBaslat)
      if (s) kullandirimBaslatAc(b, s, ctx())
    }))
    panel.querySelector('#dosyaSonlandir')?.addEventListener('click', () => sonlandirAc(b, ctx()))
    panel.querySelector('#dosyaDuzenle')?.addEventListener('click', () => duzenleAc(b, ctx()))
    panel.querySelector('[data-uzerinal]')?.addEventListener('click', () => atamaYaz(b.id, benim.id, ctx()))
    panel.querySelector('[data-birak]')?.addEventListener('click', () => atamaYaz(b.id, null, ctx()))
    panel.querySelector('[data-devral]')?.addEventListener('click', () => {
      if (confirm(`Bu dosya ${danismanAdi(dmap, b.kredi_personeli_id)} üzerinde. Devralmak istiyor musun?`)) atamaYaz(b.id, benim.id, ctx())
    })
  }
  if (!sessiz) listeCiz()
}
