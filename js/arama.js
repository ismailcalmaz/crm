// =====================================================================
// arama.js — Üst bar GLOBAL arama: müşteri (ad/telefon) + ARAÇ (plaka/şasi)
//
// Göksenil (7 Ağu 2026): "dms panelinde arama butonunda plaka arayınca
//   bulmuyor, sanırım orası sadece CRM tarafındaki taleplere ait kalmış."
//   Doğru teşhis: kutu yalnız `talepler` tablosunu sorguluyordu. DMS'e
//   geçtikten sonra araçlar bu aramaya HİÇ bağlanmamıştı.
//
// Artık üç kaynak birden aranır ve ayrı başlıklar altında gösterilir:
//   1. Müşteri  → talepler        (ad / telefon)
//   2. Araç     → stok_araclar    (plaka / şasi) + AŞAMA rozeti
//   3. Geçmiş   → v_arac_gecmis_satis (CRM + GURU arşivi birlikte)
//
// ⚠️ AYNI PLAKA İKİ KEZ ÇIKABİLİR ve BU DOĞRUDUR (Göksenil'in isteği):
//    aracı sattıysak "Satış" kaydı geçmişte durur; sonra geri aldıysak
//    envanterde YENİ bir kayıt olur. Arayan kişi ikisini yan yana görüp
//    "bunu daha önce satmışız, geri almışız" diyebilmeli. Geçmiş satırını
//    gizlemek bu bilgiyi yok eder.
//
// ⚠️ FİYAT YOK. Bu kutuyu 14 danışmanın hepsi görüyor; sonuçlarda hiçbir
//    tutar/maliyet alanı ÇEKİLMEZ (RLS satır düzeyindedir, kolon gizlemez).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, telSon10, trBuyuk, buyuk, plakaNormal, aracAsama, ARAC_ASAMA, ASAMA_RENK } from './veri.js'

export function aramaKur(input, kutu) {
  let zaman
  // Yer tutucu artık ne aranabileceğini söylüyor — "Müşteri ara" yazdığı
  // için kimse plaka aramayı denemiyordu.
  if (input.placeholder) input.placeholder = 'Ara: plaka · şasi · müşteri · telefon'
  input.addEventListener('input', () => {
    clearTimeout(zaman); zaman = setTimeout(() => ara(input.value.trim(), kutu), 280)
  })
  input.addEventListener('focus', () => { if (kutu.children.length) kutu.classList.remove('gizli') })
  document.addEventListener('click', e => {
    if (e.target !== input && !kutu.contains(e.target)) kutu.classList.add('gizli')
  })
}

// Plaka sadeleştirme veri.js'te TEK KAYNAK (plakaNormal) — veritabanındaki
// `plaka_norm` üretilmiş kolonu aynı kuralı uygular (sql/169).
const plakaSade = plakaNormal

const baslik = t => `<div class="ara-baslik">${t}</div>`

async function ara(q, kutu) {
  if (q.length < 2) { kutu.classList.add('gizli'); return }
  const digits = q.replace(/\D/g, '')
  const pl = plakaSade(q)

  // Üçü paralel — tek tek beklemek kutuyu gözle görülür yavaşlatıyordu.
  const [musteriR, aracR, gecmisR] = await Promise.all([
    musteriAra(q, digits),
    pl.length >= 3 ? aracAra(pl) : Promise.resolve({ data: [], error: null }),
    pl.length >= 3 ? gecmisAra(pl) : Promise.resolve({ data: [], error: null }),
  ])

  kutu.classList.remove('gizli')
  // §5: hata YUTULMAZ. Biri patlarsa diğerlerini yine göster, ama söyle.
  const hatalar = [musteriR.error, aracR.error, gecmisR.error].filter(Boolean)
  hatalar.forEach(e => console.error('[arama]', e))

  const parcalar = [
    aracHtml(aracR.data || []),
    gecmisHtml(gecmisR.data || [], aracR.data || []),
    musteriHtml(musteriR.data || []),
  ].filter(Boolean)

  if (!parcalar.length) {
    kutu.innerHTML = `<div class="bos">Sonuç yok${hatalar.length ? ' (bazı kaynaklar okunamadı)' : ''}</div>`
    return
  }
  kutu.innerHTML = parcalar.join('')
}

// ---------------------------------------------------------------- müşteri
function musteriAra(q, digits) {
  let query = supabase.from('talepler')
    .select('id, musteri_ad_soyad, telefon, gorusme_notlari(musteri_durumu, created_at)')
    .limit(6)
  // Telefon aramasında SON 10 HANE kullanılır — uygulamanın geri kalanı
  // (mükerrer kontrolü, müşteri kartı) telSon10() ile arıyor. Ham rakamla
  // arayınca baştaki 0'sız kayıtlar BULUNAMIYORDU → santral aynı müşteriye
  // ikinci talebi açıyordu.
  return digits.length >= 3
    ? query.ilike('telefon_norm', '%' + telSon10(digits) + '%')
    // ⚠️ `ad_ara` (sql/129): noktasız ı yüzünden 'bahadı' → 'BAHADIR'ı
    //   bulamıyordu. İki taraf da ASCII'ye indirgenir.
    : query.ilike('ad_ara', '%' + trBuyuk(q) + '%')
}

function musteriHtml(rows) {
  if (!rows.length) return ''
  return baslik('Müşteri') + rows.map(t => {
    // Notlar sıralı gelmiyor; EN YENİ notun durumu gösterilir (uygulamanın
    // geri kalanı hep bu mantıkta). Öncesinde rastgele/eski durum çıkıyordu.
    const durum = (t.gorusme_notlari || []).slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.musteri_durumu || ''
    const hedef = t.telefon ? `musteri.html?tel=${encodeURIComponent(t.telefon)}` : `talep.html?id=${t.id}`
    return `<a href="${hedef}">
      <div class="ad">${kacis(t.musteri_ad_soyad) || '—'}</div>
      <div class="alt">${kacis(t.telefon) || 'telefon yok'}${durum ? ' · ' + kacis(durum) : ''}</div>
    </a>`
  }).join('')
}

// ---------------------------------------------------------------- araç
// Fiyat/maliyet alanı BİLEREK çekilmiyor (bkz. dosya başı).
// ⚠️ `plaka` DEĞİL `plaka_norm` üzerinde ara (sql/169). Ham kolonda boşluk
//    olabiliyor ("35 ZZT 001"); sadeleştirilmiş sorgu ona EŞLEŞMEZ ve arama
//    sessizce "Sonuç yok" der — Faz 1 teslim testinde yakalandı.
function aracAra(pl) {
  return supabase.from('stok_araclar')
    .select('id, plaka, eski_plaka, sasi_no, marka, model, yil, durum, fiyatlama_durumu')
    .or(`plaka_norm.ilike.%${pl}%,sasi_no.ilike.%${pl}%,eski_plaka.ilike.%${pl}%`)
    .order('created_at', { ascending: false })
    .limit(6)
}

function aracHtml(rows) {
  if (!rows.length) return ''
  return baslik('Araç') + rows.map(a => {
    const asama = aracAsama(a)
    const kunye = [a.yil, buyuk(a.marka), buyuk(a.model)].filter(Boolean).join(' ')
    return `<a href="arac-kart.html?id=${encodeURIComponent(a.id)}">
      <div class="ad">${kacis(buyuk(a.plaka) || a.sasi_no || '—')}
        <span class="ara-rozet ${ASAMA_RENK[asama] || ''}">${kacis(asama)}</span></div>
      <div class="alt">${kacis(kunye) || 'künye yok'}${a.eski_plaka ? ' · eski: ' + kacis(buyuk(a.eski_plaka)) : ''}</div>
    </a>`
  }).join('')
}

// ---------------------------------------------------------------- geçmiş satış
// v_arac_gecmis_satis = satis_snapshot (CRM) ∪ arsiv_satislar (GURU),
// şasi anahtarlı. Plaka satış anında DEĞİŞEBİLİR (35NSD813 → 35DDL758),
// bu yüzden iki plaka kolonunda da aranır.
function gecmisAra(pl) {
  return supabase.from('v_arac_gecmis_satis')
    .select('sasi_no, plaka, satis_anindaki_plaka, satis_tarihi, musteri_ad_soyad, marka, model, yil, kaynak')
    .or(`plaka.ilike.%${pl}%,satis_anindaki_plaka.ilike.%${pl}%`)
    .order('satis_tarihi', { ascending: false })
    .limit(6)
}

function gecmisHtml(rows, araclar) {
  if (!rows.length) return ''
  // Envanterde AYNI ŞASİ ile duran bir araç varsa, bu satış "geri alınmış"
  // demektir — kullanıcının asıl görmek istediği bilgi bu.
  // ⚠️ Şasiden ARAÇ KARTINA bağla. Geri alınmış araçta kullanıcının bir
  //    sonraki hamlesi "peki şimdi nerede?" — onu tek tıkla göstermek,
  //    Satış Merkezi'ni filtresiz açmaktan çok daha faydalı.
  //    (satis.js yalnız `?satis=<id>` derin bağlantısını tanıyor; arşiv
  //     satırlarının o id'si bu view'da yok, o yüzden düz link.)
  // ⚠️ KAPANMIŞ KAYIT "GERİ ALINDI" DEĞİLDİR. Satılan araç `stok_araclar`'da
  //    TESLIM_EDILDI olarak DURMAYA DEVAM EDER — sadece "şasi envanterde var
  //    mı" diye bakmak HER SATILAN ARACA "geri alındı" yazdırıyordu (canlı
  //    provada 35DDL758'de yakalandı). Geri alım, aynı şasiyle AÇIK bir
  //    kaydın olması demektir: yeni bir alış kaydı açılmıştır.
  const acikMi = a => {
    const s = aracAsama(a)
    return s !== ARAC_ASAMA.SATIS && s !== ARAC_ASAMA.DISI
  }
  const envanter = new Map(araclar.filter(a => acikMi(a) && (a.sasi_no || '').trim())
    .map(a => [(a.sasi_no || '').trim(), a.id]))
  const tarih = t => t ? new Date(t).toLocaleDateString('tr-TR') : '—'
  return baslik('Geçmiş satış') + rows.map(s => {
    const aracId = envanter.get((s.sasi_no || '').trim())
    const kunye = [s.yil, buyuk(s.marka), buyuk(s.model)].filter(Boolean).join(' ')
    const hedef = aracId ? `arac-kart.html?id=${encodeURIComponent(aracId)}` : 'satis.html'
    return `<a href="${hedef}">
      <div class="ad">${kacis(buyuk(s.plaka) || '—')}
        <span class="ara-rozet bg-primary/10 text-primary">Satış</span>
        ${aracId ? `<span class="ara-rozet bg-amber-100 text-amber-800" title="Bu araç satıldıktan sonra tekrar alınmış — tıkla, güncel kaydına git">geri alındı</span>` : ''}</div>
      <div class="alt">${tarih(s.satis_tarihi)} · ${kacis(s.musteri_ad_soyad) || 'alıcı yok'}${kunye ? ' · ' + kacis(kunye) : ''} · ${kacis(s.kaynak)}</div>
    </a>`
  }).join('')
}
