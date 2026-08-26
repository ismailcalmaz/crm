// =====================================================================
// tsb-paket.js — TSB tip kodu ARAMA (tek kaynak)
//
// Göksenil (18 Ağu 2026): "İsmail Bey fiyatlama yaparken ... sadece TSB
//   marka ve tip kodunu güncellemeli."
//
// ⚠️ NEDEN AYRI MODÜL — kopyalamamak için. Bu kod önce yalnız
//    arac-kabul-yeni.js içine yazılmıştı. Fiyatlama ekranına da lazım
//    olunca iki seçenek vardı: kopyala, ya da buraya çıkar.
//    Kopyalamak bu projenin EN SIK hatası (CLAUDE.md §4) — arabam-paket.js
//    tam olarak aynı dersin ürünü. İkinci bir kopya yazma.
//
// Bölüşüm: bu modül ARAMAYI ve ADAY ÇİZİMİNİ yapar; seçimle NE YAPILACAĞINI
// çağıran bilir (sihirbazda form alanlarını doldurur + Auto Fill çalıştırır;
// fiyatlamada doğrudan stok_araclar'a yazar). Ortak olan arama, farklı olan
// sonuç — o yüzden onSec geri çağrısı.
//
// ⚠️ Marka ADIYLA değil KODUYLA aranır. TSB'de Fiat Egea "FIAT" altında
//    DEĞİL, "TOFAS-FIAT" (kod 100) altında; ada göre arama Egea'yı hiç
//    bulamıyor (denendi, 500L CROSS döndü). Marka kodu boş bırakılabilir —
//    sunucu metinde geçen TÜM markaları aday alır (sql/210).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, dbHata } from './veri.js'

// Marka kodu DB'de 3 haneli baştan sıfırlı ('21' → '021') — tsbGetir ile aynı kural.
export function markaKoduNormal(ham) {
  const s = String(ham ?? '').trim()
  if (!s) return null
  return /^\d+$/.test(s) ? s.padStart(3, '0') : s
}

export function yilNormal(ham) {
  const s = String(ham ?? '').trim()
  return /^\d{4}$/.test(s) ? Number(s) : null
}

// Adayları getirir. Dönüş: { ok, adaylar, hata }
export async function tsbAdayAra({ metin, markaKodu = null, yil = null, limit = 5 }) {
  const m = String(metin ?? '').trim()
  if (m.length < 3) return { ok: true, adaylar: [] }
  const { data, error } = await supabase.rpc('tsb_tip_ara', {
    p_marka_kodu: markaKoduNormal(markaKodu),
    p_yil: yilNormal(yil),
    p_metin: m,
    p_limit: limit,
  })
  if (error) {                                  // CLAUDE.md §5.4 — sessiz catch yok
    dbHata('tsb_tip_ara', error)
    return { ok: false, adaylar: [], hata: error.message }
  }
  return { ok: true, adaylar: data || [] }
}

// Aday listesini kaba çizer ve tıklamayı bağlar.
// ⚠️ OTOMATİK SEÇİM YOK (Göksenil kararı): doğru paket testlerde hep birinci
//    çıktı ama ikinciyle fark ince olabiliyor (Focus 0,738'e karşı 0,714).
//    Yanlış tip kodu = yanlış kasko değeri; kullanıcı tıklayarak onaylar.
export function tsbAdaylariCiz(kap, sonuc, { yil = null, onSec } = {}) {
  if (!kap) return
  if (!sonuc.ok) {
    kap.innerHTML = `<div class="text-[11px] text-error">Arama başarısız: ${kacis(sonuc.hata || '')}</div>`
    return
  }
  if (!sonuc.adaylar.length) {
    kap.innerHTML = `<div class="text-[11px] text-on-surface-variant">Aday bulunamadı${
      yilNormal(yil) ? ` (${yilNormal(yil)})` : ''} — marka adının metinde geçtiğinden emin ol, yılı değiştir ya da tip kodunu elle gir.</div>`
    return
  }

  kap.innerHTML = sonuc.adaylar.map(d => {
    const yuzde = Math.round((Number(d.skor) || 0) * 100)
    // Skor rengi: yüksek yeşil, orta amber, düşük nötr. Kullanıcı "bu ne
    // kadar emin" sorusunu rakama bakmadan görsün.
    // ⚠️ Skorun düşük görünmesi normal: TSB tip adında marka tekrarlanmıyor
    //    ("ZS 1.0T…", "MG ZS…" değil). Mutlak değer değil, İKİNCİYLE FARK önemli.
    const renk = yuzde >= 70 ? 'bg-green-100 text-green-800'
      : yuzde >= 45 ? 'bg-amber-100 text-amber-800'
      : 'bg-surface-container-high text-on-surface-variant'
    // Marka da yazılıyor: TSB'de beklenmedik marka altında olabiliyor
    // (Egea "TOFAS-FIAT"), kullanıcı neyi seçtiğini görsün.
    return `<button type="button" class="paket-aday w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg border border-outline-variant hover:border-primary hover:bg-primary/5 transition-colors"
      data-tip="${kacis(d.tip_kodu)}" data-marka="${kacis(d.marka_kodu)}" data-ad="${kacis(d.tip_adi)}">
      <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${renk}">%${yuzde}</span>
      <span class="flex-1 min-w-0">
        <span class="block text-[12px] font-bold text-on-surface truncate">${kacis(d.tip_adi)}</span>
        <span class="block text-[10px] text-on-surface-variant">${kacis(d.marka)} ${kacis(d.marka_kodu)} · Tip ${kacis(d.tip_kodu)} · ${d.model_yili || '—'} · Kasko ${fmtPara(d.kasko_degeri)}</span>
      </span>
      <span class="text-primary text-[11px] font-bold shrink-0">Seç</span>
    </button>`
  }).join('')

  kap.querySelectorAll('.paket-aday').forEach(b => b.addEventListener('click', () =>
    onSec?.({ marka_kodu: b.dataset.marka, tip_kodu: b.dataset.tip, tip_adi: b.dataset.ad })))
}

// Yazdıkça arama için ortak gecikme sarmalayıcı (350 ms — ölçülmüş değer).
export function gecikmeli(fn, ms = 350) {
  let z = null
  return (...a) => { clearTimeout(z); z = setTimeout(() => fn(...a), ms) }
}
