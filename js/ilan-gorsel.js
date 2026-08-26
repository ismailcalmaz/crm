// =====================================================================
// ilan-gorsel.js — SAHİBİNDEN İLAN GÖRSELİ (sql/107)
//
// Siteden taşındı: ismailcalmaz-site/js/ilan-uret.js + ilan-canvas.js.
// Doldurma mantığı (metin kalıpları, ÇIKMAZ kuralı, kampanya basamakları)
// BİREBİR korundu — çıktı sitedekiyle aynı görünür. Değişen tek şey VERİ
// KAYNAĞI: Google Sheet ve site `araclar` tablosu yerine CRM stoğu.
//
// ⚠️ KREDİ RAKAMLARI SABİT KOLON DEĞİL, CANLI HESAP (Göksenil kararı).
// Sitede peşinat/taksit araclar tablosunda metin kolonlardı ve elle
// güncelleniyordu. Burada kredi-hesap.js çağrılıyor — cam etiketi ve araç
// kartıyla AYNI motor. Fiyat ya da TSB kasko değişince rakam kendiliğinden
// değişir; sql/107 tetikleyicileri de görseli ESKI işaretler.
//
// ⚠️ ÜRETİM TARAYICIDA. html2canvas 800px'lik gizli bir kapsayıcıyı tarar.
// Bu yüzden şablon genişliği SABİT 800px olmalı (bkz. ilan-sablon.html).
// html2canvas ~200KB — sadece üretim anında dinamik import ediliyor
// (qr.js'te olduğu gibi), sayfa açılışına yük binmiyor.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata, buyuk } from './veri.js'
import { PARCALAR, RENK } from './ekspertiz.js'
import { krediOranlariYukle, kaskoBedeliYukle, hesapBireysel, hesapTuzel } from './kredi-hesap.js'

export const BUCKET = 'ilan-gorselleri'

// ---------------------------------------------------------------------
// YARDIMCILAR — sitedeki karşılıklarının birebir aynısı
// ---------------------------------------------------------------------
function norm(s) {
  if (s == null) return ''
  s = String(s).trim().toUpperCase()
  const ceviri = { 'İ': 'I', 'I': 'I', 'Ş': 'S', 'Ğ': 'G', 'Ü': 'U', 'Ö': 'O', 'Ç': 'C', 'Â': 'A' }
  for (const [a, b] of Object.entries(ceviri)) s = s.split(a).join(b)
  for (const ch of [' ', '.', '-', '_', '/', '\t', '\n', '\r']) s = s.split(ch).join('')
  return s
}
// Sayıyı ₺ biçimine çevir; metinse (TAMAMINA/ÇIKMAZ) dokunma.
function tl(s) {
  if (s === null || s === undefined || s === '') return ''
  const t = String(s).split('₺').join('').split('TL').join('').split('.').join('').split(',').join('').trim()
  if (!/^\d+$/.test(t)) return String(s).trim()
  return '₺' + Number(t).toLocaleString('tr-TR')
}
// Hücre boş mu / kullanılamaz mı? true ise O SATIR HİÇ YAZILMAZ.
function gecersizMi(deger) {
  if (deger === null || deger === undefined) return true
  const s = String(deger).trim()
  if (!s) return true
  return ['CIKMAZ', 'CIKMIYOR', 'YOK', '-', 'YOKTUR'].includes(norm(s))
}
const say = v => Math.round(Number(v) || 0)

// ---------------------------------------------------------------------
// KREDİ SATIRLARI
// ---------------------------------------------------------------------
function krediAciklamalariUret(row) {
  const satirlar = []

  // VERGİ LEVHALI (ticari/tüzel) — CRM'de hesapTuzel
  if (!gecersizMi(row.tuzel_kredi)) {
    const metin = norm(row.tuzel_kredi).includes('TAMAM')
      ? `<span class="tutar-mini">${tl(row.tuzel_taksit)}</span> başlayan taksitlerle ` +
        `<span class="vurgu-mini">TAMAMINA</span> kredi çıkartarak anında sahip olabilirsiniz.`
      : `<span class="tutar-mini">${tl(row.tuzel_taksit)}</span> başlayan taksitlerle ` +
        `<span class="tutar-mini">${tl(row.tuzel_kredi)}</span> peşinat vererek anında sahip olabilirsiniz.`
    satirlar.push(`<div class="kredi-aciklama"><strong>VERGİ LEVHALI MÜŞTERİLERİMİZ</strong> Aracımıza ${metin}</div>`)
  }

  // BİREYSEL
  // ⚠️ Sitede bu satırın TAMAMINA hâli yoktu (peşinat oradan hazır metin
  // geliyordu). Burada canlı hesap var: peşinat 0 çıkabilir ve "₺0 peşinat"
  // yazmak yanlış olurdu — tüzeldeki gibi TAMAMINA kalıbına düşüyor.
  if (!gecersizMi(row.bireysel_pesinat) && !gecersizMi(row.bireysel_taksit)) {
    const metin = norm(row.bireysel_pesinat).includes('TAMAM')
      ? `<span class="tutar-mini">${tl(row.bireysel_taksit)}</span> başlayan taksitlerle ` +
        `<span class="vurgu-mini">TAMAMINA</span> kredi çıkartarak anında sahip olabilirsiniz.`
      : `<span class="tutar-mini">${tl(row.bireysel_taksit)}</span> başlayan taksitlerle ` +
        `<span class="tutar-mini">${tl(row.bireysel_pesinat)}</span> peşinat vererek anında sahip olabilirsiniz.`
    satirlar.push(`<div class="kredi-aciklama"><strong>BİREYSEL MÜŞTERİLERİMİZ</strong> Aracımıza ${metin}</div>`)
  }

  // DİJİTAL SENET
  if (!gecersizMi(row.dijital_senet)) {
    satirlar.push(
      `<div class="kredi-aciklama">Ayrıca bu araca dijital senet sistemi ile ` +
      `<span class="tutar-mini">${tl(row.dijital_senet)}</span> peşinat vererek sahip olabilirsiniz.</div>`)
  }

  return satirlar.join('\n')
}

// Kampanya 1 basamakları (50k / 100k / limit). Faiz %0 ise düz bölme.
function krediSatirlariUret(ayarlar) {
  let limit = 140000, vade = 6, faiz = 0
  try {
    limit = parseInt(parseFloat(ayarlar.kampanya1_limit ?? '140000'))
    vade = parseInt(parseFloat(ayarlar.kampanya1_vade ?? '6'))
    faiz = parseFloat(ayarlar.kampanya1_faiz ?? '0')
  } catch { /* varsayılanlar kalır */ }
  const aylik = tutar => faiz === 0 ? Math.round(tutar / vade)
    : Math.round(tutar * (1 + (faiz / 100) * vade) / vade)
  const basamaklar = [...new Set([50000, 100000, limit])].sort((a, b) => a - b).filter(b => b <= limit)
  return basamaklar.map((b, i) => {
    const ek = (i === basamaklar.length - 1) ? 'aylık ödemeler ile faydalanabilirsiniz.' : 'aylık ödeme'
    return `<div class="kredi-satir"><span>${tl(String(b))} için</span>` +
           `<span class="tutar">${tl(String(aylik(b)))}</span><span>${ek}</span></div>`
  }).join('')
}

// Kampanya 1 bloğu — TSB kasko üst sınırın üstündeyse HİÇ gösterilmez.
function k1BlokUret(ayarlar, row) {
  const ustSinir = Number(ayarlar.ilan_kasko_ust_sinir ?? 2000000)
  if (Number(row.kasko || 0) >= ustSinir) return ''
  const limit = tl(ayarlar.kampanya1_limit ?? '140000')
  const faiz = String(ayarlar.kampanya1_faiz ?? '0').split('.').join(',')
  const vade = ayarlar.kampanya1_vade ?? '6'
  return `<div class="kredi-ozet">${limit}'e kadar %${faiz} faiz oranı ile ${vade} ay vadeli kredi imkanımızdan;</div>\n`
       + krediSatirlariUret(ayarlar)
}

// ---------------------------------------------------------------------
// EKSPERTİZ — CRM'in KENDİ 13 parçalı şeması (cam etiketiyle aynı)
// ---------------------------------------------------------------------
let _semaCache = null
async function semaHam() {
  if (_semaCache) return _semaCache
  const res = await fetch('img/ekspertiz-sema.svg')
  if (!res.ok) throw new Error('ekspertiz-sema.svg yüklenemedi')
  _semaCache = await res.text()
  return _semaCache
}

// paneller: {'Ön Kaput':'BOYALI', …} → SVG metni (fill'ler gömülü).
// ⚠️ fill NİTELİK olarak yazılıyor, style olarak değil: html2canvas
// tarama sırasında SVG'yi ayrı bir belge gibi ele alıyor ve dışarıdan
// verilen sınıf/stil kurallarını taşımıyor.
async function semaUret(paneller) {
  const ham = await semaHam()
  const kap = document.createElement('div')
  kap.innerHTML = ham
  const svg = kap.querySelector('svg')
  if (!svg) return ''
  for (const p of svg.querySelectorAll('[data-part]')) {
    const ad = p.getAttribute('data-part')
    p.setAttribute('fill', RENK[paneller[ad]] || RENK.ORIJINAL)
  }
  return kap.innerHTML
}

function ekspertizSayilari(paneller) {
  let boyali = 0, lokal = 0, degisen = 0
  for (const d of Object.values(paneller || {})) {
    if (d === 'BOYALI') boyali++
    else if (d === 'LOKAL BOYA') lokal++
    else if (d === 'DEGISEN') degisen++
  }
  return { boyali, lokal, degisen }
}

function ekspertizMetinUret(paneller) {
  const { boyali, lokal, degisen } = ekspertizSayilari(paneller)
  const parcalar = []
  if (boyali) parcalar.push(`<span class="eks-boyali">${boyali} boyalı parça</span>`)
  if (lokal) parcalar.push(`<span class="eks-lokal">${lokal} lokal boyalı parça</span>`)
  if (degisen) parcalar.push(`<span class="eks-degisen">${degisen} değişen parça</span>`)
  if (parcalar.length) return 'Aracımızda ' + parcalar.join(', ') + ' vardır.'
  return 'Aracımızda <span class="durum-iyi">BOYA – LOKAL BOYA – DEĞİŞEN YOKTUR.</span>'
}

// ---------------------------------------------------------------------
// TRAMER — cam etiketiyle AYNI kural (Göksenil):
//   kayıt yok           → "hasar kaydı yoktur"
//   kayıt var, tutar yok → "X adet" (tutar cümlesi hiç kurulmaz)
//   karışık / tutarlı    → "X adet … Toplam: ₺Y" (girilmiş tutarların toplamı)
// ---------------------------------------------------------------------
function tramerMetinUret(t) {
  if (!t.adet) return 'Aracımızın tramerinde <span class="durum-iyi">hasar kaydı yoktur.</span>'
  const adetKutu = `<span class="tutar-mini">${t.adet} adet</span>`
  const tutarKutu = t.tutar > 0
    ? ` Toplam tramer tutarı: <span class="tutar-mini">${tl(String(say(t.tutar)))}</span>.` : ''
  return `Aracımızın tramerinde ${adetKutu} hasar kaydı bulunmaktadır.${tutarKutu}`
}

function donanimHtmlUret(metin) {
  if (!metin) return '<div class="donanim-item">Donanım bilgisi için bizi arayın</div>'
  const parcalar = metin.split(';').join('\n').split('\n').map(d => d.trim()).filter(Boolean)
  if (!parcalar.length) return '<div class="donanim-item">Donanım bilgisi için bizi arayın</div>'
  return parcalar.map(d => `<div class="donanim-item">${kacis(d)}</div>`).join('')
}

function cinsiUret(arac) {
  if (arac.manuel_cinsi) return arac.manuel_cinsi        // ruhsattaki ifade kazanır
  const kasa = (arac.kasa_tipi || '').trim()
  if (!kasa) return 'OTOMOBİL'
  if (norm(kasa).includes('TICAR')) return 'TİCARİ'
  return `OTOMOBİL (${kasa})`
}

// ---------------------------------------------------------------------
// VERİ TOPLAMA — CRM stoğu
// ---------------------------------------------------------------------
export async function veriTopla(aracId) {
  const { data: arac, error: aErr } = await supabase.from('stok_araclar')
    .select(`id, plaka, marka, model, versiyon, yil, km, yakit, vites, kasa_tipi, renk,
             tsb_marka_id, tsb_tip_id, durum,
             arac_ekspertiz(parca_kodu, durum), arac_tramer(tutar)`)
    .eq('id', aracId).maybeSingle()
  if (aErr) { dbHata('ilan görseli · araç', aErr); throw new Error(aErr.message) }
  if (!arac) throw new Error('Araç bulunamadı')

  const [{ data: ayarSatir, error: yErr }, { data: fiyatSatir, error: fErr },
         { data: gorsel, error: gErr }] = await Promise.all([
    supabase.from('ayarlar').select('anahtar, deger'),
    supabase.from('v_arac_min_fiyat').select('satis_fiyati').eq('arac_id', aracId).maybeSingle(),
    supabase.from('ilan_gorselleri').select('*').eq('arac_id', aracId).maybeSingle(),
  ])
  if (yErr) dbHata('ilan görseli · ayarlar', yErr)
  if (fErr) dbHata('ilan görseli · fiyat', fErr)
  if (gErr) dbHata('ilan görseli · kayıt', gErr)

  const ayarlar = {}
  for (const a of (ayarSatir || [])) ayarlar[a.anahtar] = a.deger

  const fiyat = fiyatSatir?.satis_fiyati ?? null
  const oranlar = await krediOranlariYukle(supabase)
  const kasko = await kaskoBedeliYukle(supabase, arac)

  // --- EKSPERTİZ: override varsa o, yoksa arac_ekspertiz ---
  const paneller = Object.fromEntries(PARCALAR.map(p => [p, 'ORIJINAL']))
  const kaynak = gorsel?.eks_parcalar
    ? Object.entries(gorsel.eks_parcalar).map(([parca_kodu, durum]) => ({ parca_kodu, durum }))
    : (arac.arac_ekspertiz || [])
  for (const e of kaynak) if (paneller[e.parca_kodu] !== undefined) paneller[e.parca_kodu] = e.durum

  // --- TRAMER: override varsa o, yoksa arac_tramer ---
  let tramer
  if (gorsel?.manuel_tramer) {
    tramer = { adet: Number(gorsel.tramer_adet_m) || 0, tutar: Number(gorsel.tramer_tutar_m) || 0 }
  } else {
    const kayitlar = arac.arac_tramer || []
    const girilmis = kayitlar.filter(t => t.tutar !== null && t.tutar !== undefined && t.tutar !== '')
    tramer = { adet: kayitlar.length, tutar: girilmis.reduce((s, t) => s + (Number(t.tutar) || 0), 0) }
  }

  // --- KREDİ: canlı hesap → sitedeki `row` biçimine köprü ---
  const bir = hesapBireysel(fiyat, kasko, oranlar)
  const tuz = hesapTuzel(fiyat, kasko, oranlar)
  const ustSinir = Number(ayarlar.ilan_kasko_ust_sinir ?? 2000000)
  const dsOran = Number(ayarlar.ilan_dijital_senet_oran ?? 0.20)

  // Göksenil formülü: IF(kasko>=üstSınır;"ÇIKMAZ"; IF(fiyat yok;0; fiyat-fiyat*0,8))
  const dijital = (Number(kasko || 0) >= ustSinir || !fiyat) ? 'ÇIKMAZ' : String(say(fiyat * dsOran))

  const row = {
    plaka: arac.plaka || '',
    kasko: kasko || 0,
    dijital_senet: dijital,
    bireysel_pesinat: bir.durum !== 'OK' ? 'ÇIKMAZ' : (bir.pesinat <= 0 ? 'TAMAMINA' : String(say(bir.pesinat))),
    bireysel_taksit: bir.durum === 'OK' ? String(say(bir.taksit)) : 'ÇIKMAZ',
    // "Tamamına finansman" → şablon TAMAMINA metnini kurar (peşinat satırı yerine)
    tuzel_kredi: tuz.durum !== 'OK' ? 'ÇIKMAZ' : (tuz.pesinat <= 0 ? 'TAMAMINA' : String(say(tuz.pesinat))),
    tuzel_taksit: tuz.durum === 'OK' ? String(say(tuz.taksit)) : 'ÇIKMAZ',
  }

  // --- DONANIM: araca özel > model varsayılanı (tsb_donanim, sql/120) ---
  // Göksenil: "aynı marka tip kodunda varsayılan olarak getir; değişiklik
  // varsa o aracın özelinde kaydet." Aynı modelden yeni araç geldiğinde
  // donanım satırı dolu gelsin diye.
  // ⚠️ TSB kodu olmayan araçta (ör. 35DD035) kütüphane anahtarı yok — o
  //   zaman yalnız araca özel değer kullanılır.
  const tsb = (arac.tsb_marka_id && arac.tsb_tip_id)
    ? { marka_kodu: arac.tsb_marka_id, tip_kodu: arac.tsb_tip_id } : null
  let modelDonanim = ''
  if (tsb) {
    const { data: kut, error: kErr } = await supabase.from('tsb_donanim')
      .select('donanim').eq('marka_kodu', tsb.marka_kodu).eq('tip_kodu', tsb.tip_kodu).maybeSingle()
    if (kErr) dbHata('donanım kütüphanesi', kErr)
    modelDonanim = kut?.donanim || ''
  }
  const aracDonanim = gorsel?.donanim || ''
  const donanim = aracDonanim || modelDonanim
  const donanimKaynak = aracDonanim ? 'ARAC' : (modelDonanim ? 'MODEL' : 'YOK')

  return { arac: { ...arac, manuel_cinsi: gorsel?.manuel_cinsi || null },
           ayarlar, row, paneller, tramer, fiyat, kasko,
           donanim, donanimKaynak, modelDonanim, tsb, gorsel }
}

// ---------------------------------------------------------------------
// ŞABLONU DOLDUR
// ---------------------------------------------------------------------
let _sablonCache = null
async function sablonHam() {
  if (_sablonCache) return _sablonCache
  const res = await fetch('ilan-sablon.html')
  if (!res.ok) throw new Error('ilan-sablon.html yüklenemedi')
  _sablonCache = await res.text()
  return _sablonCache
}

export async function htmlDoldur(v) {
  const { arac, ayarlar, row, paneller, tramer, donanim } = v
  const km = arac.km ? Number(arac.km).toLocaleString('tr-TR') + ' km' : ''
  const yer = {
    FIRMA_ADI: kacis(buyuk(ayarlar.ilan_firma_adi || 'İsmail Çalmaz Otomotiv')),
    MODEL_YILI: kacis(String(arac.yil || '')),
    PLAKA: kacis(String(arac.plaka || '').toUpperCase()),
    K1_BLOK: k1BlokUret(ayarlar, row),
    K2_FAIZ: kacis(String(ayarlar.kampanya2_faiz ?? '0.75').split('.').join(',')),
    K2_VADE: kacis(String(ayarlar.kampanya2_vade ?? '11')),
    KREDI_ACIKLAMALAR: krediAciklamalariUret(row),
    MODEL_ADI: kacis(buyuk([arac.marka, arac.model, arac.versiyon].filter(Boolean).join(' '))),
    CINSI: kacis(cinsiUret(arac)),
    YAKIT_VITES: kacis(`${arac.yakit || ''} / ${arac.vites || ''}`.replace(/^ \/ | \/ $/g, '').trim()),
    KM: kacis(km),
    DONANIM_LISTESI: donanimHtmlUret(donanim),
    EKSPERTIZ_METIN: ekspertizMetinUret(paneller),
    EKSPERTIZ_SEMA: await semaUret(paneller),
    TRAMER_METIN: tramerMetinUret(tramer),
    ADRES: kacis(ayarlar.ilan_adres || ''),
    TELEFON: kacis(ayarlar.ilan_telefon || ''),
  }
  let html = await sablonHam()
  for (const [k, val] of Object.entries(yer)) html = html.split(`{{${k}}}`).join(val)
  return html
}

// ---------------------------------------------------------------------
// ŞEMASIZ DÜZ METİN — sahibinden açıklamasına elle yapıştırmak için
// ---------------------------------------------------------------------
function htmlTemizle(s) {
  s = s.replace(/<\/(div|p|li|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  // ⚠️ </span> BOŞLUĞA çevrilir, yoksa yan yana duran rozetler metinde
  // yapışır: "₺50.000 için₺8.333aylık ödeme". HTML'de araları flex boşluğu
  // ayırıyordu; etiketler silinince o boşluk da gidiyor.
  s = s.replace(/<\/span>/gi, ' ').replace(/<[^>]+>/g, '')
  s = s.split('&nbsp;').join(' ').split('&amp;').join('&')
  return s.split('\n').map(l => l.split(/\s+/).filter(Boolean).join(' ')).filter(l => l.trim()).join('\n')
}

export function metinUret(v) {
  const { arac, ayarlar, row, paneller, tramer, donanim } = v
  const s = []
  s.push('PEŞİNAT DETAYI')
  const ustSinir = Number(ayarlar.ilan_kasko_ust_sinir ?? 2000000)
  if (Number(row.kasko || 0) < ustSinir) {
    s.push(`${tl(ayarlar.kampanya1_limit ?? '140000')}'e kadar ` +
           `%${String(ayarlar.kampanya1_faiz ?? '0').split('.').join(',')} faiz oranı ile ` +
           `${ayarlar.kampanya1_vade ?? '6'} ay vadeli kredi imkanımızdan;`)
    htmlTemizle(krediSatirlariUret(ayarlar)).split('\n').forEach(l => { if (l.trim()) s.push(l.trim()) })
  }
  s.push(`%${String(ayarlar.kampanya2_faiz ?? '0.75').split('.').join(',')} faiz oranlı ` +
         `${ayarlar.kampanya2_vade ?? '11'} ay vadeli kampanyalı taşıt kredilerimizden de faydalanabilirsiniz.`)
  htmlTemizle(krediAciklamalariUret(row)).split('\n').forEach(l => { if (l.trim()) s.push(l.trim()) })

  s.push('', 'ARAÇ MODEL BİLGİSİ')
  s.push(`MODEL ADI: ${buyuk([arac.marka, arac.model, arac.versiyon].filter(Boolean).join(' '))}`)
  s.push(`MODEL YILI: ${arac.yil || ''}`)
  s.push(`CİNSİ: ${cinsiUret(arac)}`)
  s.push(`YAKIT / VİTES: ${arac.yakit || ''} / ${arac.vites || ''}`)
  if (arac.km) s.push(`KM: ${Number(arac.km).toLocaleString('tr-TR')} km`)

  s.push('', 'EKSPERTİZ DETAYI', htmlTemizle(ekspertizMetinUret(paneller)))
  s.push('', 'TRAMER BİLGİSİ', htmlTemizle(tramerMetinUret(tramer)))
  if (donanim) {
    s.push('', 'ARAÇ DONANIM DETAYI')
    donanim.split(';').join('\n').split('\n').map(x => x.trim()).filter(Boolean).forEach(d => s.push(`• ${d}`))
  }
  s.push('', ayarlar.ilan_firma_adi || 'İsmail Çalmaz Otomotiv')
  s.push(`${ayarlar.ilan_adres || ''} · ${ayarlar.ilan_telefon || ''}`)
  return s.join('\n')
}

// ---------------------------------------------------------------------
// ÜRETİM — html2canvas → JPEG → Storage
// ---------------------------------------------------------------------
let _h2c = null
async function html2canvasYukle() {
  if (_h2c) return _h2c
  _h2c = (await import('./vendor/html2canvas.js')).default
  return _h2c
}

async function canvasUret(html) {
  const html2canvas = await html2canvasYukle()
  const govde = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  const icerik = govde ? govde[1] : html
  const stiller = (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n')

  const kap = document.createElement('div')
  kap.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#fff;z-index:-1'
  kap.innerHTML = stiller + icerik
  document.body.appendChild(kap)
  // Fontlar hazır olmadan taranırsa metinler kayar
  try { await document.fonts?.ready } catch { /* desteklenmiyorsa geç */ }
  await new Promise(r => setTimeout(r, 250))

  let blob
  try {
    const canvas = await html2canvas(kap.querySelector('.ilan') || kap, {
      scale: 2,               // sahibinden'de okunaklı olsun (1600px genişlik)
      backgroundColor: '#fff',
      useCORS: true,
      logging: false,
    })
    blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92))
  } finally {
    kap.remove()
  }
  if (!blob) throw new Error('Görsel oluşturulamadı (canvas boş döndü)')
  return blob
}

// Girdilerin özeti — aynı veriyle iki kez üretmeyi gereksiz kılar,
// ayrıca "bu görsel hangi veriyle basıldı" sorusunu cevaplar.
async function veriOzeti(v) {
  const yuk = JSON.stringify({
    arac: [v.arac.marka, v.arac.model, v.arac.versiyon, v.arac.yil, v.arac.km,
           v.arac.yakit, v.arac.vites, v.arac.kasa_tipi, v.arac.manuel_cinsi],
    paneller: v.paneller, tramer: v.tramer, row: v.row,
    ayarlar: Object.fromEntries(Object.entries(v.ayarlar)
      .filter(([k]) => k.startsWith('kampanya') || k.startsWith('ilan_'))),
    donanim: v.donanim,
  })
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(yuk))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Bir araç için görseli baştan sona üret, yükle, kaydet.
 * @returns {{url:string, metin:string}}
 */
export async function gorselUret(aracId, danismanId = null) {
  const v = await veriTopla(aracId)
  const html = await htmlDoldur(v)
  const blob = await canvasUret(html)

  // URL SABİT: <arac_id>.jpg — sahibinden ilanındaki bağlantı hiç değişmez.
  const yol = `${aracId}.jpg`
  const { error: sErr } = await supabase.storage.from(BUCKET)
    .upload(yol, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '300' })
  if (sErr) { dbHata('ilan görseli · storage', sErr); throw new Error('Yüklenemedi: ' + sErr.message) }
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(yol)

  const metin = metinUret(v)
  const kayit = {
    arac_id: aracId, durum: 'HAZIR', gorsel_url: pub.publicUrl, ilan_metni: metin,
    veri_hash: await veriOzeti(v), son_uretim: new Date().toISOString(), hata_mesaji: null,
  }
  if (danismanId && !v.gorsel) kayit.olusturan_id = danismanId

  const { data, error } = await supabase.from('ilan_gorselleri')
    .upsert(kayit, { onConflict: 'arac_id' }).select('arac_id')
  if (error) { dbHata('ilan görseli · kayıt', error); throw new Error(error.message) }
  // §5.1 — PostgREST yetki yoksa HATA VERMEZ, 0 satır yazar.
  if (!data?.length) throw new Error('Kaydedilemedi: ilan yetkiniz yok')

  return { url: pub.publicUrl, metin }
}

/** Sadece önizleme (yüklemeden) — pencerede göstermek için data URL. */
export async function onizleme(aracId) {
  const v = await veriTopla(aracId)
  const blob = await canvasUret(await htmlDoldur(v))
  return URL.createObjectURL(blob)
}
