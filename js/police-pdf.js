// =====================================================================
// police-pdf.js — Sigorta poliçesi PDF'inden alan çıkarma (tek kaynak)
//
// Göksenil (18 Ağu 2026): "pdf'i sürükle bırak ile yükleyecek personel,
//   sistem içinden metinleri okuyup kullanıcının onayına sunacak —
//   veriler doğru mu kontrol et diye."
//
// ⚠️ PDF→METİN BURADA YAZILMADI. tramer-ocr.js `belgeSatirlari()` zaten
//    pdf.js ile metni çıkarıyor, metin katmanı yoksa OCR'a düşüyor.
//    İkinci bir okuyucu yazmak bu projenin en sık hatası (CLAUDE.md §4).
//    Bu modül YALNIZ ayrıştırma yapar.
//
// ⚠️ ASLA OTOMATİK KAYDETMEZ. Çıkan her alan kullanıcının onayına sunulur.
//
// ── SAĞLAYICI PROFİLLERİ (19 Ağu 2026) ───────────────────────────────────
//   İlk sürüm YALNIZ Türkiye Sigorta'ya kalibreydi. Neova ve Sompo
//   belgeleri denendiğinde hiçbir alan okunmadı — şablonlar birbirine hiç
//   benzemiyor. Üç gerçek belgenin pdf.js çıktısı ölçülerek profiller
//   yazıldı; ortak alan adları aynı kalıyor, yalnız desenler değişiyor.
//
//   TÜRKİYE:  "Plaka 34 GOP437 Araç Grubu Kamyonet"
//             "Poliçe No : 974227799 / 0"
//             "Süre (Gün)" başlığının ALTINDAKİ değer satırı
//             "Toplam Brüt Prim 1.650,00 TL" · "Net Prim (SGK Dahil) 1.473,22 TL"
//   NEOVA:    "Poliçe No 535146105 Müşteri No 00JG96U"
//             "Başlama Tarihi 13/08/2026 Bitiş Tarihi 12/10/2026"
//             "Plaka No 35CFH013 Sası No U5YPH812GML937066"
//             "BRÜT KATKI PRİMİ 1.500,42" · "TOPLAM NET KATKI PRİMİ 1.343,78"
//   SOMPO:    başlık satırı "SOMPO SİGORTA TRAFİK SİGORTA POLİÇESİ"
//             sütun başlığı + değer satırı (poliçe no · tarihler · süre)
//             "Kullanım Tarzı : ... Plaka No : 35 CME373"
//             "Toplam Brüt Prim : 1,526.21 TL" · "Toplam Net Prim : 1,363.82 TL"
//
// ⚠️ SAYI BİÇİMİ TUZAĞI — sessiz ve tehlikeli.
//    Türkiye/Neova Türkçe biçim yazıyor (1.500,42), SOMPO ANGLO biçim
//    yazıyor (1,526.21). Eski tek desen `(\d{1,3}(?:\.\d{3})*,\d{2})`
//    Sompo'nun "1,526.21" değerinden "1,52" parçasını yakalayıp brütü
//    **1,52 TL** okuyordu. Ölçüldü. Yanlış tutar, hiç okumamaktan KÖTÜDÜR:
//    yapboz iadesi bu rakamdan hesaplanıyor. sayiOku() son ayıraca bakarak
//    biçimi kendisi bulur.
//
// ⚠️ pypdf ile pdf.js AYNI ÇIKTIYI VERMEZ. Desenler UYGULAMANIN kullandığı
//    pdf.js çıktısına göre yazıldı (CLAUDE.md §10).
// =====================================================================

// Tutar: hem 1.500,42 hem 1,526.21 hem 1500 biçimini yakalar.
// ⚠️ Sondaki `(?![\d.,])`: tarihin ("12.08.2026") bir parçasını tutar
//    sanmasın diye. Bu olmadan "12.08" bir tutar gibi eşleşiyordu.
const RE_TUTAR = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?![\d.,])/
const RE_TARIH = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/g

/**
 * "1.500,42" · "1,526.21" · "1500" → 1500.42 / 1526.21 / 1500
 * Biçimi SON AYIRACA bakarak bulur: en sağdaki ayıraç ondalık ayıracıdır.
 */
export function sayiOku(ham) {
  const t = String(ham ?? '').trim()
  if (!t) return null
  const nokta = t.lastIndexOf('.'), virgul = t.lastIndexOf(',')
  let d
  if (virgul > nokta)      d = t.replace(/\./g, '').replace(',', '.')   // 1.500,42
  else if (nokta > virgul) d = t.replace(/,/g, '')                      // 1,526.21
  else                     d = t                                        // 1500
  const n = Number(d)
  return Number.isFinite(n) ? n : null
}

const iki = n => String(n).padStart(2, '0')
const iso = (g, a, y) => `${y}-${iki(a)}-${iki(g)}`
const B = v => String(v ?? '').trim().toLocaleUpperCase('tr')
const plakaTemiz = v => B(v).replace(/[^0-9A-ZÇĞİÖŞÜ]/g, '') || null

// Kullanım tarzı / araç grubu metnini formdaki İKİ seçeneğe eşler.
// ⚠️ Başka bir şey çıkarsa TAHMİN ETME — null döner, kullanıcı seçer.
//    Sompo'nun motosiklet poliçesi tam bu duruma düşüyor; formda
//    motosiklet seçeneği YOK (yapboz ücreti otomobil/kamyonet üzerinden).
function aracTipiEsle(metin, uyarilar) {
  const t = B(metin)
  if (!t) return null
  if (/KAMYONET|KAMYON|PANELVAN/.test(t)) return 'KAMYONET'
  if (/OTOMOB/.test(t)) return 'OTOMOBIL'
  uyarilar.push(`Araç tipi tanınmadı: "${String(metin).trim()}" — elle seçin.`)
  return null
}

/** Satırlar içinde ilk eşleşen yakalama grubunu döndürür. */
function bul(satirlar, re, grup = 1) {
  for (const s of satirlar) { const m = s.match(re); if (m) return m[grup] }
  return null
}
function bulHepsi(satirlar, re) {
  for (const s of satirlar) { const m = s.match(re); if (m) return m }
  return null
}

/** Etiketten SONRAKİ ilk tutarı okur (aynı satırda birden çok tutar olabilir). */
function tutarBul(satirlar, etiketRe) {
  for (const s of satirlar) {
    const m = s.match(etiketRe)
    if (!m) continue
    const kalan = s.slice(m.index + m[0].length)
    const t = kalan.match(RE_TUTAR) || s.match(RE_TUTAR)
    if (t) return sayiOku(t[1])
  }
  return null
}

// =====================================================================
// SAĞLAYICI PROFİLLERİ
// Her profil aynı alan adlarını doldurur; `tani` belgeyi tanır.
// =====================================================================

const TURKIYE = {
  kod: 'TURKIYE', ad: 'Türkiye Sigorta',
  tani: metin => /TÜRKİYE\s+SİGORTA/i.test(metin),
  oku(satirlar, A, uyarilar) {
    const p = bulHepsi(satirlar, /^Plaka\s+(.+?)\s+Araç\s*Grubu\s+(.+)$/i)
    if (p) { A.plaka = plakaTemiz(p[1]); A.arac_tipi = aracTipiEsle(p[2], uyarilar) }
    else {
      const ps = satirlar.find(s => /^Plaka\s/i.test(s))
      if (ps) A.plaka = plakaTemiz((ps.replace(/^Plaka\s+/i, '').split(/\s{2,}/)[0] || ''))
    }
    A.sirket_adi = bul(satirlar, /Sigorta\s*Şirketi\s*[UÜ]nvanı\s*:?\s*(.+)$/i)
    A.police_no  = bul(satirlar, /Poliçe\s*No\s*:\s*(\d+)\s*\/\s*\d+/i)

    // Tarihler + süre: başlıklı satırın ALTINDAKİ değer satırından
    const bi = satirlar.findIndex(s => /Süre\s*\(\s*Gün\s*\)/i.test(s))
    if (bi >= 0 && satirlar[bi + 1]) {
      const deger = satirlar[bi + 1]
      const t = [...deger.matchAll(RE_TARIH)]
      if (t.length >= 3) {           // tanzim · başlangıç · bitiş
        A.baslangic = iso(t[1][1], t[1][2], t[1][3])
        A.bitis     = iso(t[2][1], t[2][2], t[2][3])
      } else if (t.length === 2) {
        A.baslangic = iso(t[0][1], t[0][2], t[0][3])
        A.bitis     = iso(t[1][1], t[1][2], t[1][3])
        uyarilar.push('Tanzim tarihi ayırt edilemedi; ilk tarih başlangıç sayıldı.')
      }
      const sn = deger.match(/-\s*(\d{1,4})\s*$/)
      if (sn) A.sure_gun = Number(sn[1])
    }

    A.brut = tutarBul(satirlar, /Toplam\s*Brüt\s*Prim/i)
    A.net  = tutarBul(satirlar, /Net\s*Prim/i)
    A.tahsilat_metni = bul(satirlar, /Tahsil\s*Yöntemi\s*:?\s*(.+)$/i)
    A.sasi_no = bul(satirlar, /Sasi\s*numarasi\s+([A-Z0-9]{17})/i)
    A.marka   = bul(satirlar, /Araç\s*Markası\s*:?\s*(.+)$/i)?.split(/\s{2,}|\s+Tescil/i)[0]?.trim() || null
    const my = bul(satirlar, /Araç\s*Modeli\s*:?\s*(\d{4})\b/i)
    if (my) A.model_yili = Number(my)
  },
}

const NEOVA = {
  kod: 'NEOVA', ad: 'Neova Katılım Sigorta',
  tani: metin => /NEOVA/i.test(metin),
  oku(satirlar, A, uyarilar) {
    const p = bulHepsi(satirlar, /Plaka\s*No\s+([0-9A-ZÇĞİÖŞÜ\s]+?)\s+Sası\s*No\s+([A-Z0-9]{17})/i)
    if (p) { A.plaka = plakaTemiz(p[1]); A.sasi_no = B(p[2]) }
    else A.plaka = plakaTemiz(bul(satirlar, /Plaka\s*No\s+([0-9A-ZÇĞİÖŞÜ\s]{5,12})/i))

    A.arac_tipi  = aracTipiEsle(bul(satirlar, /Kullanım\s*Tarzı\s+(.+?)\s+Kademe/i), uyarilar)
    A.sirket_adi = bul(satirlar, /Sigorta\s*Şirketi\s*[UÜ]nvanı\s*:?\s*(.+)$/i)
    A.police_no  = bul(satirlar, /Poliçe\s*No\s+(\d{6,})/i)

    const t = bulHepsi(satirlar, /Başlama\s*Tarihi\s+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s+Bitiş\s*Tarihi\s+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i)
    if (t) {
      const g = x => { const m = x.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/); return iso(m[1], m[2], m[3]) }
      A.baslangic = g(t[1]); A.bitis = g(t[2])
    }
    const sg = bul(satirlar, /Poliçe\s*Süresi\s+(\d{1,4})\s*g[üu]n/i)
    if (sg) A.sure_gun = Number(sg)

    // ⚠️ "KATKI PRİMİ" — katılım sigortasında prim böyle adlanıyor.
    A.brut = tutarBul(satirlar, /BR[ÜU]T\s*KATKI\s*PR[İI]M[İI]/i)
    A.net  = tutarBul(satirlar, /TOPLAM\s*NET\s*KATKI\s*PR[İI]M[İI]/i)
    // Peşinat satırı: "Peşinat 13/8/2026 1.500,42 GÜVENCE HESABI 25,56"
    const pes = satirlar.find(s => /^Peşinat\s/i.test(s))
    if (pes) A.tahsilat_metni = 'Peşinat'

    A.marka = bul(satirlar, /^Marka\s+(.+?)\s+Trf/i) || bul(satirlar, /^Marka\s+(.+)$/i)
    const my = bul(satirlar, /^Model\s+(\d{4})\b/i)
    if (my) A.model_yili = Number(my)
  },
}

const SOMPO = {
  kod: 'SOMPO', ad: 'Sompo Sigorta',
  tani: metin => /SOMPO/i.test(metin),
  oku(satirlar, A, uyarilar) {
    // ⚠️ Sompo'da "Sigorta Şirketi Unvanı" DİYE BİR ETİKET YOK. Şirket adı
    //    yalnız başlık satırında geçiyor; oradan alınıyor.
    A.sirket_adi = bul(satirlar, /^(SOMPO\s+SİGORTA)\b/i) || 'SOMPO SİGORTA'

    // Sütun başlığı + değer satırı:
    //   MÜŞTERİ NO ACENTE NO POLİÇE NO EK NO YENİLEME NO BAŞLAMA ... SÜRE
    //   55430119 413908 311000621546866 0 0 12/08/2026 11/10/2026 60 Gün
    const bi = satirlar.findIndex(s => /MÜŞTERİ\s*NO/i.test(s) && /POLİÇE\s*NO/i.test(s) && /BAŞLAMA\s*TARİHİ/i.test(s))
    if (bi >= 0 && satirlar[bi + 1]) {
      const d = satirlar[bi + 1]
      const m = d.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s+(\d{1,4})/)
      if (m) {
        A.police_no = m[3]
        const g = x => { const q = x.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/); return iso(q[1], q[2], q[3]) }
        A.baslangic = g(m[6]); A.bitis = g(m[7]); A.sure_gun = Number(m[8])
      } else {
        uyarilar.push('Poliçe başlık satırı okundu ama değer satırı çözülemedi.')
      }
    }

    // "Kullanım Tarzı : MOTOSİKLET VE YÜK MOTOSİKLETİ Plaka No : 35 CME373"
    const kp = bulHepsi(satirlar, /Kullanım\s*Tarzı\s*:?\s*(.+?)\s+Plaka\s*No\s*:?\s*([0-9A-ZÇĞİÖŞÜ\s]+?)\s*$/i)
    if (kp) { A.arac_tipi = aracTipiEsle(kp[1], uyarilar); A.plaka = plakaTemiz(kp[2]) }
    else {
      A.plaka = plakaTemiz(bul(satirlar, /Plaka\s*No\s*:?\s*([0-9A-ZÇĞİÖŞÜ\s]{5,12})/i))
      A.arac_tipi = aracTipiEsle(bul(satirlar, /Kullanım\s*Tarzı\s*:?\s*(.+)$/i), uyarilar)
    }

    A.brut = tutarBul(satirlar, /Toplam\s*Brüt\s*Prim\s*:/i)
    A.net  = tutarBul(satirlar, /Toplam\s*Net\s*Prim\s*:/i)
    A.sasi_no = bul(satirlar, /Şasi\s*No\s+([A-Z0-9]{17})/i)
    A.marka = bul(satirlar, /EGM\s*Marka\s*Bilgisi\s+(.+)$/i)
    const my = bul(satirlar, /EGM\s*Model\s*Yılı\s+(\d{4})\b/i)
    if (my) A.model_yili = Number(my)
  },
}

// Tanınmayan şirket: ortak etiketleri dener. Bulursa da UYARIR — desenler
// bu belgeye göre doğrulanmadı, kullanıcı her alanı kontrol etmeli.
const GENEL = {
  kod: 'GENEL', ad: null,
  tani: () => true,
  oku(satirlar, A, uyarilar) {
    uyarilar.push('Bu sigorta şirketinin şablonu tanınmadı — okunan alanları TEK TEK doğrulayın.')
    A.plaka      = plakaTemiz(bul(satirlar, /Plaka\s*(?:No)?\s*:?\s*([0-9A-ZÇĞİÖŞÜ\s]{5,12})/i))
    A.sirket_adi = bul(satirlar, /Sigorta\s*Şirketi\s*[UÜ]nvanı\s*:?\s*(.+)$/i)
                || bul(satirlar, /^([A-ZÇĞİÖŞÜ\s.]*\bSİGORTA\b[A-ZÇĞİÖŞÜ\s.]*)$/m)
    A.police_no  = bul(satirlar, /Poliçe\s*No\s*:?\s*(\d{6,})/i)
    A.arac_tipi  = aracTipiEsle(bul(satirlar, /(?:Kullanım\s*Tarzı|Araç\s*Grubu)\s*:?\s*(.+?)(?:\s{2,}|$)/i), uyarilar)
    A.brut = tutarBul(satirlar, /(?:Toplam\s*)?Br[üu]t\s*(?:Katkı\s*)?Prim/i)
    A.net  = tutarBul(satirlar, /(?:Toplam\s*)?Net\s*(?:Katkı\s*)?Prim/i)
    const t = bulHepsi(satirlar, /Başlama\s*(?:Tarihi)?\s*:?\s*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4}).*?Bitiş\s*(?:Tarihi)?\s*:?\s*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i)
    if (t) {
      const g = x => { const q = x.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/); return iso(q[1], q[2], q[3]) }
      A.baslangic = g(t[1]); A.bitis = g(t[2])
    }
  },
}

const PROFILLER = [TURKIYE, NEOVA, SOMPO, GENEL]

/**
 * Poliçe PDF satırlarından alanları çıkarır.
 * @returns {{alanlar:Object, saglayici:string, bulunan:number, eksik:string[], uyarilar:string[]}}
 *   alanlar: { plaka, arac_tipi, sirket_adi, police_no, baslangic, bitis,
 *              sure_gun, brut, net, tahsilat_metni, sasi_no, marka, model_yili }
 */
export function policeAyristir(satirlar) {
  const A = {}
  const uyarilar = []
  const metin = (satirlar || []).join('\n')

  const profil = PROFILLER.find(p => p.tani(metin)) || GENEL
  profil.oku(satirlar || [], A, uyarilar)

  // ── Ortak çapraz denetimler ────────────────────────────────────────
  // ⚠️ Süre ile tarih farkı tutmuyorsa SÖYLE. Yapboz ücreti gün sayısından
  //    hesaplanıyor; sessiz 1 günlük kayma doğrudan paraya dönüşür.
  if (A.baslangic && A.bitis && A.sure_gun) {
    const fark = Math.round((new Date(A.bitis) - new Date(A.baslangic)) / 86400000)
    if (Math.abs(fark - A.sure_gun) > 1) {
      uyarilar.push(`Süre tutarsız: belgede ${A.sure_gun} gün, tarih farkı ${fark} gün.`)
    }
  }
  if (A.brut != null && A.net != null && A.net > A.brut) {
    uyarilar.push('Net, brütten büyük çıktı — alanlar ters okunmuş olabilir.')
  }
  // ⚠️ Trafik poliçesinde brüt genelde netin %5-15 üstünde. Çok uzaksa
  //    sayı biçimi yanlış okunmuş olabilir (Sompo'nun 1,526.21 vakası).
  if (A.brut != null && A.net != null && A.net > 0) {
    const oran = A.brut / A.net
    if (oran < 1 || oran > 1.6) {
      uyarilar.push(`Brüt/net oranı olağandışı (${oran.toFixed(2)}) — tutarları kontrol edin.`)
    }
  }

  const zorunlu = ['plaka', 'sirket_adi', 'baslangic', 'bitis', 'brut']
  const eksik = zorunlu.filter(k => A[k] == null || A[k] === '')
  const bulunan = Object.values(A).filter(v => v != null && v !== '').length

  return { alanlar: A, saglayici: profil.kod, bulunan, eksik, uyarilar }
}

/** Okunan şirket adını Tanımlar'daki kayıtla eşler (birebir değil, içerir). */
export function sirketEsle(sirketler, ad) {
  if (!ad) return null
  const n = x => String(x || '').toLocaleUpperCase('tr').replace(/[^A-ZÇĞİÖŞÜ0-9]/g, '')
  const hedef = n(ad)
  return sirketler.find(s => hedef.includes(n(s.ad)) || n(s.ad).includes(hedef))
      || sirketler.find(s => s.kisa_kod && hedef.includes(n(s.kisa_kod)))
      // Son çare: şirket adının İLK kelimesi (NEOVA · SOMPO · TÜRKİYE …)
      || sirketler.find(s => { const ilk = n(String(s.ad).split(/\s+/)[0]); return ilk.length >= 4 && hedef.includes(ilk) })
      || null
}
