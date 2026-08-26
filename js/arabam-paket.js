// =====================================================================
// arabam-paket.js — arabam.com PAKET SEÇİCİ (tek kaynak)
//
// Göksenil (6 Ağu 2026): "aracı fiyatlamaya gönderirken paket seçimi
//   yaptırmadı bana."
//
// ⚠️ KUSUR BİRLEŞTİRMEDEN GELMİYOR — özellik baştan EKSİK BAĞLANMIŞTI.
//    Seçici yalnız arac-detay.js içine yazılmıştı; oysa fiyatlama
//    kuyruğuna gönderen BAŞKA giriş noktaları da var:
//      · Araç Kabul Merkezi — satır menüsü "Fiyatlamaya Gönder"  (tekil)
//      · Araç Kabul Merkezi — üstteki toplu düğme                (çoklu)
//    Bu iki yoldan gönderilen araçlarda paket hiç sorulmuyor, piyasa
//    ölçümü model geneline düşüyordu ve kimse fark etmiyordu.
//
// Bu modül o kodun TEK kopyası; arac-detay.js ve arac-kabul.js buradan
// çağırır. İkinci bir kopya yazmak bu projenin en sık hatası (CLAUDE.md §4).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, trBuyuk, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'

let PAKET_VERI = null

export async function paketVerisi() {
  if (PAKET_VERI) return PAKET_VERI
  const r = await fetch('veri/arabam-paketler.json')
  if (!r.ok) throw new Error('paket listesi yüklenemedi (' + r.status + ')')
  const ham = await r.json()
  // Düz listeye çevir: {etiket, slug, kategori}
  const liste = []
  for (const [kategori, markalar] of Object.entries(ham))
    for (const [marka, modeller] of Object.entries(markalar))
      for (const [model, paketler] of Object.entries(modeller))
        for (const [paket, slug] of Object.entries(paketler)) {
          const etiket = `${marka} ${model} ${paket.replace(/-/g, ' ')}`
          // `ara`: karşılaştırma için Türkçe-katlanmış hâli. Her tuş vuruşunda
          // binlerce kaydı yeniden katlamamak için BİR KEZ hesaplanıyor.
          liste.push({ etiket, ara: trBuyuk(etiket), slug, kategori, marka, model })
        }
  PAKET_VERI = liste
  return liste
}

export function paketSecici(arac) {
  return new Promise(resolve => {
    const on = `${arac.marka || ''} ${arac.model || ''} ${arac.versiyon || ''}`.trim()
    const ov = document.createElement('div')
    ov.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4'
    ov.innerHTML = `
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
      <div class="relative bg-surface-container-lowest w-full max-w-[560px] rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div class="px-5 py-4 border-b border-outline-variant">
          <h3 class="text-title-lg font-bold text-primary flex items-center gap-2">${mat('travel_explore')} arabam.com paketi</h3>
          <p class="text-[12px] text-on-surface-variant mt-1">Piyasa fiyatı bu pakete göre ölçülecek. Seçmezsen model geneli ölçülür.</p>
          <div class="text-[11px] mt-1.5 px-2 py-1 rounded bg-surface-container-low">CRM'deki araç: <b>${kacis(trBuyuk(on))}</b></div>
        </div>
        <div class="p-4 pb-2"><input id="pkAra" placeholder="Marka model paket ara…" autocomplete="off"
          class="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none" /></div>
        <div id="pkListe" class="flex-1 overflow-y-auto px-4 pb-2 min-h-[120px]"></div>
        <div class="px-5 py-3 border-t border-outline-variant flex justify-between gap-2">
          <button id="pkAtla" class="px-4 py-2 rounded-lg border border-outline-variant text-body-sm font-semibold hover:bg-surface-container-low">Model geneliyle devam</button>
          <button id="pkIptal" class="px-4 py-2 rounded-lg text-body-sm font-semibold text-on-surface-variant hover:bg-surface-container-low">Vazgeç</button>
        </div>
      </div>`
    document.body.appendChild(ov)

    const kapat = v => { ov.remove(); document.removeEventListener('keydown', esc); resolve(v) }
    const esc = e => { if (e.key === 'Escape') kapat(undefined) }
    document.addEventListener('keydown', esc)
    ov.querySelector('.absolute').addEventListener('click', () => kapat(undefined))
    ov.querySelector('#pkIptal').addEventListener('click', () => kapat(undefined))
    ov.querySelector('#pkAtla').addEventListener('click', () => kapat(null))   // null = model seviyesi

    const liste = ov.querySelector('#pkListe')
    const ara = ov.querySelector('#pkAra')
    let veri = []

    // ⚠️ TÜRKÇE "I" TUZAĞI (Göksenil, 10 Ağu 2026: "C3 AIRCROSS MAX —
    //    eşleşme yok, oysa arabam'da var"). Eski kod her iki tarafı
    //    `toLocaleLowerCase('tr')` ile küçültüyordu:
    //        CRM   "CITROEN"  -> "cıtroen"   (NOKTASIZ ı)
    //        paket "Citroen"  -> "citroen"   (noktalı i)
    //    İkisi asla eşleşmiyordu. Bu tek araca özgü değildi — büyük I içeren
    //    HER marka aranamıyordu: CITROEN, FIAT, AUDI, KIA, HYUNDAI, DACIA,
    //    MINI, NISSAN, MITSUBISHI… Kullanıcı "paket yok" sanıp model geneliyle
    //    devam ediyordu, piyasa ölçümü sessizce kabalaşıyordu.
    //    Çözüm: karşılaştırma trBuyuk() ile — ı/İ/i/I hepsi 'I'ya iniyor,
    //    sql/42'deki tr_upper() ile birebir aynı kural (veri.js tek kaynak).
    const suz = q => veri.filter(x => q.every(k => x.ara.includes(k)))

    const ciz = () => {
      const q = trBuyuk(ara.value || '').split(/\s+/).filter(Boolean)
      if (!q.length) { liste.innerHTML = `<div class="text-body-sm text-on-surface-variant py-6 text-center">Aramak için yazmaya başla.</div>`; return }

      // KADEMELİ DARALTMA: CRM künyesinde arabam etiketlerinde HİÇ geçmeyen
      // kelimeler olabiliyor — canlı örnek "RENAULT (OYAK) MEGANE SEDAN TOUCH":
      // arabam'da model yalnız "Megane", SEDAN/TOUCH geçmiyor. Her kelimenin
      // eşleşmesi arandığı için sonuç sıfır çıkıyor ve kullanıcı "paket yok"
      // sanıyordu. Sondan kelime atarak en dar isabetli aramayı buluyoruz.
      // En az 2 kelime korunur (marka + model kökü) — yoksa liste her şeyi döker.
      let kullanilan = q, ham = suz(q)
      while (!ham.length && kullanilan.length > 2) { kullanilan = kullanilan.slice(0, -1); ham = suz(kullanilan) }
      const atilan = q.slice(kullanilan.length)
      const bulunan = ham.slice(0, 60)

      if (!bulunan.length) { liste.innerHTML = `<div class="text-body-sm text-on-surface-variant py-6 text-center">
        Eşleşme yok.<br><span class="text-[11px]">Aramayı kısalt — örn. yalnız <b>marka + model</b> yaz.
        Bulamazsan "Model geneliyle devam" diyebilirsin.</span></div>`; return }

      // Neyin atıldığını SÖYLE: kullanıcı listeye bakıp "bu benim aracım değil"
      // demesin, aramanın nerede gevşetildiğini bilsin.
      const not = atilan.length
        ? `<div class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
             arabam listesinde geçmediği için <b>${kacis(atilan.join(', '))}</b> aramadan çıkarıldı.</div>`
        : ''
      liste.innerHTML = not + bulunan.map((x, i) => `<button data-i="${i}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-container-low border-b border-outline-variant/40 last:border-0">
        <div class="text-body-sm font-semibold">${kacis(trBuyuk(x.etiket))}</div>
        <div class="text-[10px] text-on-surface-variant">${kacis(x.slug)}</div></button>`).join('')
      liste.querySelectorAll('button[data-i]').forEach(b =>
        b.addEventListener('click', () => kapat(bulunan[+b.dataset.i])))
    }

    liste.innerHTML = `<div class="text-body-sm text-on-surface-variant py-6 text-center">Paket listesi yükleniyor…</div>`
    paketVerisi().then(v => {
      veri = v
      // Araç künyesinden ön arama — bilgi işlem çoğu zaman tek tık uzakta olsun
      // Parantezli ek KALDIRILIR: canlıda marka "RENAULT (OYAK)" olarak
      // duruyor; "(OYAK)" hiçbir arabam etiketinde geçmediği ve her kelimenin
      // eşleşmesi arandığı için ön arama SIFIR sonuç veriyordu — aynı
      // "eşleşme yok" çıkmazının ikinci kaynağı.
      ara.value = `${arac.marka || ''} ${arac.model || ''}`.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
      ciz(); ara.focus(); ara.select()
    }).catch(e => {
      console.error('[DMS] paket listesi', e)
      liste.innerHTML = `<div class="text-body-sm text-error py-6 text-center">Paket listesi yüklenemedi.</div>`
    })
    ara.addEventListener('input', ciz)
  })
}

export async function paketSozlugeYaz(arac, secim) {
  const kayit = {
    marka: (arac.marka || '').trim(), model: (arac.model || '').trim(),
    versiyon: secim ? (arac.versiyon || '').trim() || null : null,
    kategori: secim ? secim.kategori : 'Otomobil',
    slug: secim ? secim.slug : null,
    seviye: secim ? 'PAKET' : 'MODEL',
  }
  if (!kayit.slug) return true          // "model geneliyle devam" → sözlüğe yazma
  const { data, error } = await supabase.from('arabam_slug_eslesme')
    .upsert(kayit, { onConflict: 'marka,model,versiyon' }).select('id')
  if (error) { dbHata('arabam paket eşleşmesi', error); return false }
  if (!data?.length) { console.error('[DMS] paket eslesmesi yazilamadi (0 satir)'); return false }
  return true
}

// Kuyruğa göndermeden ÖNCE çağrılır: paketi sorar ve sözlüğe yazar.
// Dönüş: true → devam et · false → vazgeçildi/yazılamadı, GÖNDERME.
// ⚠️ Tek karar noktası burada; çağıranlar kendi kuralını yazmaz.
export async function paketSorVeYaz(arac) {
  const secim = await paketSecici(arac)
  if (secim === undefined) return false            // vazgeçildi
  return await paketSozlugeYaz(arac, secim)
}

// Toplu gönderimde: AYNI marka/model/versiyon için bir kez sorulur.
// 20 araç seçilip 20 kez pencere açılması kullanılamaz olurdu; eşleşme
// zaten (marka, model, versiyon) anahtarlı, aynı üçlü için tek cevap yeter.
export async function paketSorTopluca(araclar) {
  const gorulen = new Set()
  for (const a of araclar) {
    const anahtar = [(a.marka || '').trim(), (a.model || '').trim(), (a.versiyon || '').trim()].join('|')
    if (gorulen.has(anahtar)) continue
    gorulen.add(anahtar)
    if (!(await paketSorVeYaz(a))) return false    // birinde vazgeçildiyse tümü iptal
  }
  return true
}

