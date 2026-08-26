// =====================================================================
// arac-kabul-yeni.js — Araç Kabul Workbench (WB1+WB2 tek ekran).
//   Sol %65 form (Kimlik · Detay · Sahibi · Stok Notu) + sağ %35 yapışkan
//   kolon (Canlı Önizleme · Sistem Doğrulama · Ekspertiz&Tramer · AI · Hazır
//   kapısı) + alt aksiyon çubuğu. Tasarım: stitch_next_gen (14).
//   Ekspertiz SVG (ekspertiz.js template-matching) + Tramer sürükle-bırak +
//   TSB kod lookup + müşteri master + çift kaydet.
//   Kaydet: stok_araclar(ALINDI) + arac_alislar + arac_ekspertiz + arac_tramer
//   + arac_evraklar (ekspertiz PDF/tramer/ruhsat → Supabase Storage arac-evrak
//   bucket; görseller WebP). YAKINDA: araç fotoğrafı (medya WB4) · genel AI
//   değerleme · ruhsat OCR/QR. Bkz [[dms-alis-fiyatlama-tasarim]].
// =====================================================================
import { supabase, getDanisman } from './supabase-client.js'
// ARAC_AKTIF_DURUMLAR BİLEREK ALINMIYOR — `KULLANIMDA` o listede yok ve
// mükerrer kontrolünü delen buydu (bkz. kaydet() içindeki not).
// fmtPara: paket aday listesinde kasko değerini basmak için (sql/209).
import { kacis, trBuyuk, buyuk, dbHata, bugunISO, telBicim, telSifirla, plakaNormal, aracEtiket, ARAC_DURUM_GRUP, aracDurumEtiket, fmtPara } from './veri.js'
import { mat, uyari, basHarf, telMaskeKur } from './stitch-ui.js'
import { ekspertizOku, svgBoya, PARCALAR, DURUMLAR, DURUM_ETIKET, duzeltmeKaydet,
         ekspertizFarkKaydet, ekspertizHedef } from './ekspertiz.js'
import { belgeSatirlari, tramerAyristir, aracDogrula } from './tramer-ocr.js'
import { evrakiYukle } from './arac-dosya.js'   // dosya işlemleri tek kaynak
import { tsbAdayAra, tsbAdaylariCiz, gecikmeli } from './tsb-paket.js'  // TSB arama tek kaynak

const KOK = () => document.getElementById('kok')
let TANIM = {}          // tip -> [{kod,ad,ust_kod}]
let SVGTXT = ''         // ekspertiz şeması ham
let paneller = Object.fromEntries(PARCALAR.map(p => [p, 'ORIJINAL']))
// Duzenlemede DB'deki ekspertiz hali — fark tabanli kaydetme icin gerekli
// (ekrandaki `paneller` ORIJINAL'lerle dolu geldigi icin fark ondan cikmaz).
let MEVCUT_EKSPERTIZ = []
let ekspFirma = 'BILINMEYEN'
let satici = null       // {id, ad_soyad, telefon} seçili müşteri
let ekspFile = null, tramerFile = null, ruhsatFile = null   // Storage'a yüklenecek evraklar
let tramerDetayFile = null   // ERP hasar detay sorgusu (varsa) — OCR yok, yalnız saklanır
// ⚠️ `benim` yalnız kaydet() içinde yereldi; arama/seçim akışında TANIMSIZDI.
//   Müşteri seçince ReferenceError verirdi — modül düzeyine alındı.
let BEN = null              // oturumdaki danışman (kurulumda dolar)
let hasarlar = []       // tramer hasar satırları [{tarih, neden, tutar}]
let kaydediliyor = false // yeniden-giriş kilidi (buton disable'ına ek güvence)

const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
function alan(et, ic) { return `<div class="flex flex-col gap-1"><label class="text-[11px] font-bold text-on-surface-variant uppercase">${et}</label>${ic}</div>` }
function sel(id, tip, bos = 'Seçiniz…') {
  const ops = (TANIM[tip] || []).map(t => `<option value="${kacis(t.kod)}">${kacis(t.ad)}</option>`).join('')
  return `<select id="${id}" class="${INP}"><option value="">${bos}</option>${ops}</select>`
}
// Numaralı bölüm başlığı (tasarımdaki ikon + alt çizgi deseni)
function bslk(ikon, metin) {
  return `<div class="flex items-center gap-2 mb-4 border-b border-outline-variant pb-3">${mat(ikon, 'text-primary')}<h3 class="text-headline-sm font-bold">${metin}</h3></div>`
}
// Sistem Doğrulama satırı iskeleti
function dgRow(id, etiket) {
  return `<div id="${id}" class="flex items-center justify-between">
    <div class="flex items-center gap-3"><span class="material-symbols-outlined text-outline text-lg dg-ikon">radio_button_unchecked</span><span class="text-sm dg-metin">${etiket}</span></div>
    <span class="text-[10px] text-outline font-bold dg-etiket">BEKLİYOR</span></div>`
}

// =====================================================================
// DÜZENLEME MODU (Göksenil, 10 Ağu 2026)
//   "araç kabul sayfasında ilgili kaydın üstüne tıkladığımda ... hem
//    pop-up'ta hem tam sayfada arac-kabul-yeni.html'e gitsin (araç
//    bilgileri dolu gelmeli tabii ki)"
//
//   URL: arac-kabul-yeni.html?id=<stok_araclar.id>
//
// ⚠️ DÜZENLEMEDE KORUNAN ALANLAR — bunlar kabul formunun DEĞİL, sonraki
//    aşamaların verisidir; kabul formundan yazılırsa geri gider:
//      stok_araclar.durum            araç STOKTA/SIPARISTE iken ALINDI'ya dönerdi
//      stok_araclar.fiyatlama_durumu kuyruk durumunu sıfırlardı
//      stok_araclar.olusturan        kaydı ilk açan kişi değişmemeli
//      arac_alislar.alis_fiyati      İSMAİL BEY fiyatlamada girer — ASLA ezme
//    Bu yüzden düzenlemede stok_araclar UPDATE'i bu kolonları İÇERMEZ ve
//    arac_alislar yalnız satıcı/alış şekli alanlarını günceller.
// =====================================================================
let DUZENLE_ID = null      // null → yeni kayıt · dolu → mevcut kaydı düzenle
let DUZENLE_ARAC = null    // yüklenen stok_araclar satırı (durum/fiyatlama için)

export async function aracKabulYeniKur(d) {
  BEN = d || null
  DUZENLE_ID = new URLSearchParams(location.search).get('id') || null
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`
  const [{ data: tanimlar, error }, svg] = await Promise.all([
    supabase.from('tanimlar').select('tip,kod,ad,ust_kod').eq('aktif', true)
      .in('tip', ['ALIS_SEKLI', 'YAKIT', 'VITES', 'KASA_TIPI', 'RENK', 'ARAC_TIPI', 'LOKASYON', 'PARK']).order('sira'),
    fetch('img/ekspertiz-sema.svg').then(r => r.text()).catch(() => ''),
  ])
  if (error) { dbHata('tanımlar', error); KOK().innerHTML = uyari('Tanımlar okunamadı: ' + kacis(error.message)); return }
  TANIM = {}; for (const t of (tanimlar || [])) (TANIM[t.tip] = TANIM[t.tip] || []).push(t)
  // Alış Şekli: öncelikliler en üstte, diğerleri altında (mevcut sıra korunur)
  const alisOncelik = ['ARABAM_COM', 'TAKAS', 'PESIN_ALIM', 'SONMEZ_GIRGIN']
  if (TANIM['ALIS_SEKLI']) TANIM['ALIS_SEKLI'].sort((a, b) => {
    const ia = alisOncelik.indexOf(a.kod), ib = alisOncelik.indexOf(b.kod)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  SVGTXT = svg
  ciz()
  if (DUZENLE_ID) await duzenlemeyeDoldur()
}

// Mevcut kaydı forma bas. ciz()'den SONRA çağrılır — alanlar var olmalı.
async function duzenlemeyeDoldur() {
  const [{ data: a, error: ae }, { data: al }, { data: eks }, { data: tra }] = await Promise.all([
    supabase.from('stok_araclar').select('*').eq('id', DUZENLE_ID).maybeSingle(),
    supabase.from('arac_alislar').select('satici_musteri_id, alis_sekli, alis_tarihi, musteriler(id, ad_soyad, telefon)')
      .eq('arac_id', DUZENLE_ID).maybeSingle(),
    supabase.from('arac_ekspertiz').select('parca_kodu, durum').eq('arac_id', DUZENLE_ID),
    supabase.from('arac_tramer').select('hasar_tarihi, aciklama, tutar, sorgu_tarihi').eq('arac_id', DUZENLE_ID),
  ])
  if (ae) { dbHata('düzenlenecek araç', ae); hata('Araç okunamadı: ' + ae.message); return }
  if (!a) { hata('Araç bulunamadı ya da erişim yetkiniz yok.'); return }
  DUZENLE_ARAC = a

  // --- araç alanları ---
  const yaz = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v }
  // sql/188 · Plakasız varlık düzenlenirken anahtar AÇIK gelmeli; yoksa kapı
  //   "plaka eksik" der ve kayıt güncellenemez.
  if (a.stok_kodu) {
    const kutu = document.getElementById('f_plakasiz')
    if (kutu) { kutu.checked = true; plakasizUygula() }
    yaz('f_stokkodu', a.stok_kodu)
  }
  yaz('f_plaka', buyuk(a.plaka)); yaz('f_sasi', a.sasi_no); yaz('f_motor', a.motor_no)
  yaz('f_marka', a.marka); yaz('f_model', a.model); yaz('f_versiyon', a.versiyon)
  yaz('f_yil', a.yil); yaz('f_km', a.km)
  yaz('f_yakit', a.yakit); yaz('f_vites', a.vites); yaz('f_kasa', a.kasa_tipi)
  yaz('f_renk', a.renk); yaz('f_arac_tipi', a.arac_tipi)
  yaz('f_tsbmarka', a.tsb_marka_id); yaz('f_tsbtip', a.tsb_tip_id)
  yaz('f_ruhsat', a.ruhsat_seri_no)
  yaz('f_muayene', a.muayene_tarihi); yaz('f_tescil', a.tescil_tarihi); yaz('f_ilktescil', a.ilk_tescil_tarihi)
  yaz('f_lokasyon', a.lokasyon); yaz('f_park', a.park); yaz('f_notu', a.notu)
  const anahtar = document.getElementById('f_anahtar'); if (anahtar) anahtar.checked = !!a.yedek_anahtar
  yaz('f_alis_sekli', al?.alis_sekli)

  // --- satıcı: mevcut müşteri SEÇİLİ gelir, yeni müşteri formu açılmaz ---
  // ⚠️ Alan kimlikleri msAra / msSecili / msForm (ms_ara DEĞİL — öyle bir alan
  //    yok, yazsaydık satıcı sessizce boş kalırdı). Ruhsattan eşleşme
  //    (satır ~932) ile birebir aynı desen kullanılır.
  const m = al?.musteriler ? (Array.isArray(al.musteriler) ? al.musteriler[0] : al.musteriler) : null
  if (m) {
    satici = { id: m.id, ad_soyad: m.ad_soyad, telefon: m.telefon }
    const sec = document.getElementById('msSecili')
    if (sec) {
      sec.innerHTML = `<div class="flex items-center gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/10 mt-1">${mat('check_circle', 'text-primary')}<b>${kacis(buyuk(m.ad_soyad))}</b> · ${kacis(telBicim(m.telefon || ''))} <span class="text-[10px] text-primary font-bold">KAYITLI SATICI</span> <button id="msKaldir" class="ml-auto text-error text-xs font-bold">kaldır</button></div>`
      document.getElementById('msForm')?.classList.add('hidden')
      const kaldir = document.getElementById('msKaldir')
      if (kaldir) kaldir.onclick = () => { satici = null; sec.innerHTML = ''; guncelle() }
    }
  }

  // --- ekspertiz panelleri ---
  MEVCUT_EKSPERTIZ = eks || []
  for (const e of (eks || [])) if (PARCALAR.includes(e.parca_kodu)) paneller[e.parca_kodu] = e.durum
  boyaBagla()

  // --- tramer hasarları ---
  hasarlar = (tra || []).map(t => ({ tarih: t.hasar_tarihi || '', neden: t.aciklama || '', tutar: t.tutar || '' }))
  if (hasarlar.length) { hasarListeCiz(); yaz('t_tarih', tra[0]?.sorgu_tarihi) }

  duzenlemeBasligi(a)
  guncelle()
}

// Ekranın "yeni kayıt" gibi görünmesi, düzenlediğini fark etmeden ikinci
// kayıt sandırırdı. Başlık + butonlar moda göre yazılır.
function duzenlemeBasligi(a) {
  const bas = document.querySelector('#kok h1, #kok h2')
  if (bas) bas.textContent = `Araç Kabul Kaydı — ${buyuk(a.plaka)}`
  const serit = document.getElementById('mukerrerSerit')
  if (serit) {
    serit.className = 'mt-4 p-3 rounded-xl bg-[#EFF6FF] border border-[#1D4ED8]/25'
    serit.innerHTML = `<div class="flex items-center gap-2 text-[12px] text-[#1D4ED8]">
      ${mat('edit_note', 'text-[18px]')}
      <span><b>Mevcut kayıt düzenleniyor</b> — durumu <b>${kacis(aracDurumEtiket(a.durum))}</b>.
      Fiyatlama ve alış tutarı bilgilerine bu ekrandan dokunulmaz.</span></div>`
    serit.classList.remove('hidden')
  }
  // ⚠️ Butonlarda `span` YOK — ikon mat() ile basılmış, metin düz text node.
  //    textContent'e yazmak İKONU SİLER; innerHTML ikonla birlikte kurulur.
  const sade = document.getElementById('akKaydetSade')
  if (sade) sade.innerHTML = `${mat('save', 'text-[18px]')} Değişiklikleri Kaydet`
  // Buton zaten ne yaptığını söylüyor; yanına ikinci bir cümle yazmak
  // kalabalık yapıyordu (Göksenil, 10 Ağu 2026: "çok kötü olmuş kaldıralım").
  const aciklama = sade?.parentElement?.querySelector('span')
  if (aciklama) aciklama.remove()
}

function ciz() {
  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 md:mb-6">
      <div><h2 class="text-headline-md text-primary font-bold">Araç Kabul</h2>
        <p class="text-body-md text-on-surface-variant">Yeni alınan aracı sisteme al ve doğrula</p></div>
      <a href="arac-kabul.html" class="px-4 h-10 flex items-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low text-sm font-bold">${mat('close', 'text-[18px]')} Vazgeç</a>
    </div>
    <div id="akHata" class="hidden mb-4 bg-error-container text-on-error-container border border-error/20 rounded-lg px-4 py-2.5 text-sm"></div>

    <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] gap-4 md:gap-6 items-start">

      <!-- SOL %65: Veri girişi -->
      <div class="flex flex-col gap-4 md:gap-6">

        <!-- 1. Araç Kimlik -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5 md:p-6">
          ${bslk('fingerprint', '1. Araç Kimlik Bilgileri')}
          <!-- sql/188 · Karavan/römork/iş makinesinde plaka ve şasi YOKTUR.
               Doğrulama kapısı ikisini de zorunlu tuttuğu için bu varlıklar
               sisteme hiç girilemiyordu (Göksenil, 11 Ağu 2026). -->
          <label class="flex items-center gap-2 mb-3 cursor-pointer select-none">
            <input id="f_plakasiz" type="checkbox" class="w-4 h-4 accent-[color:var(--md-sys-color-primary,#7b1f2b)]">
            <span class="text-[12px] font-bold text-on-surface-variant">Plakasız araç (karavan · römork · iş makinesi)</span>
          </label>
          <div class="grid grid-cols-3 gap-3">
            ${alan('Plaka *', `<input id="f_plaka" class="${INP} text-headline-sm font-bold text-primary" style="text-transform:uppercase" placeholder="34 ABC 123" autofocus />`)}
            ${alan('Şasi No (VIN)', `<input id="f_sasi" maxlength="17" class="${INP} font-mono" style="text-transform:uppercase" placeholder="WBA1234567890…" />`)}
            ${alan('Motor No', `<input id="f_motor" class="${INP} font-mono" style="text-transform:uppercase" placeholder="N47D20…" />`)}
          </div>
          <div id="f_kodSatir" class="hidden mt-3">
            ${alan('Stok Kodu *', `<input id="f_stokkodu" class="${INP} text-headline-sm font-bold text-primary font-mono" style="text-transform:uppercase" placeholder="KRV-001" />`)}
            <p class="text-[11px] text-on-surface-variant mt-1">Plaka olmadığı için araç bu kodla anılır — listelerde, cam etiketinde ve siparişte plaka yerine bu görünür.</p>
          </div>
          <!-- TSB Otomatik Tanıma — kod gir, araç bilgileri otomatik gelsin -->
          <div class="mt-4 p-4 rounded-xl bg-primary/5 border border-dashed border-primary/25">
            <div class="text-[11px] font-bold text-primary uppercase mb-2 flex items-center gap-1">${mat('auto_fix_high', 'text-[16px]')} TSB Otomatik Tanıma</div>
            <div class="flex flex-wrap items-end gap-2">
              <div class="flex-1 min-w-[100px]">${alan('Marka Kodu', `<input id="f_tsbmarka" class="${INP}" placeholder="ör. 090" />`)}</div>
              <div class="flex-1 min-w-[100px]">${alan('Tip Kodu', `<input id="f_tsbtip" class="${INP}" placeholder="ör. 2671" />`)}</div>
              <button id="tsbGetir" class="bg-primary text-on-primary px-5 h-10 rounded-lg text-sm font-bold flex items-center gap-1 hover:opacity-90">${mat('download', 'text-[18px]')} TSB Auto Fill</button>
            </div>
            <div id="tsbSonuc" class="text-[11px] text-on-surface-variant mt-1"></div>

            <!-- Paketten tip kodu bulma (sql/209) — Göksenil, 15 Ağu 2026:
                 "ihaleden araç alınca paketine kasko değer listesinden bakmam
                  gerekiyor, bunu pratik hâle getirelim."
                 arabam.com ilan başlığını yapıştır → benzerliğe göre adaylar. -->
            <div class="mt-3 pt-3 border-t border-primary/15">
              <div class="flex flex-wrap items-end gap-2">
                <div class="flex-1 min-w-[240px]">${alan('Paketten Tip Kodu Bul',
                  `<input id="f_paketara" class="${INP}" placeholder="İlan başlığını yapıştır — ör. Fiat Egea 1.4 Fire 95 Easy Sedan" />`)}</div>
                <div class="w-[110px]">${alan('Model Yılı', `<input id="f_paketyil" class="${INP}" inputmode="numeric" placeholder="ör. 2021" />`)}</div>
              </div>
              <div id="paketAdaylar" class="mt-1.5 space-y-1"></div>
            </div>

            <div class="text-[10px] text-on-surface-variant mt-1">Tip kodu tanınmazsa sorun değil — Marka/Model/Versiyon alanlarını elle yazabilirsin.</div>
          </div>
          ${/* Daha önce sattığımız araç geri geldiyse burada şerit çıkar.
                Göksenil (7 Ağu 2026): "şerit gösterip sorsun." Sessiz
                doldurma, o an elle yazdığın veriyi ezerdi. */''}
          <div id="gecmisSerit" class="hidden mt-4"></div>
          ${/* Aynı plaka ELDEKİ bir araçta duruyorsa kayıt ENGELLENİR.
                Göksenil (10 Ağu 2026): "plaka kontrolünde herhangi bir sorgu
                olmadığı için iki sefer kaydedilebilir olmuş, bunu istemiyorum."
                Canlıda ölçüldü: 35CLM042 iki kez kayıtlı (KULLANIMDA + ALINDI). */''}
          <div id="mukerrerSerit" class="hidden mt-4"></div>
        </div>

        <!-- 2. Detaylı Araç Bilgileri -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5 md:p-6">
          ${bslk('info', '2. Detaylı Araç Bilgileri')}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${alan('Marka', `<input id="f_marka" class="${INP}" />`)}
            ${alan('Model', `<input id="f_model" class="${INP}" />`)}
            <div class="md:col-span-2">${alan('Versiyon / Donanım', `<input id="f_versiyon" class="${INP}" />`)}</div>
            ${alan('Model Yılı', `<select id="f_yil" class="${INP}"><option value="">Seçiniz…</option></select>`)}
            ${alan('Yakıt Tipi', sel('f_yakit', 'YAKIT'))}
            ${alan('Şanzıman', sel('f_vites', 'VITES'))}
            ${alan('Gövde Tipi', sel('f_kasa', 'KASA_TIPI'))}
            ${alan('Araç Tipi', sel('f_arac_tipi', 'ARAC_TIPI'))}
            ${alan('Renk', sel('f_renk', 'RENK'))}
            <div class="md:col-span-2">${alan('Güncel Kilometre', `<div class="relative"><input id="f_km" type="number" class="${INP} font-bold text-primary pr-10" /><span class="absolute right-3 top-2.5 text-[11px] text-outline">KM</span></div>`)}</div>
            ${alan('Ruhsat Seri No', `<input id="f_ruhsat" class="${INP}" style="text-transform:uppercase" />`)}
            ${alan('Muayene Geçerlilik', `<input id="f_muayene" type="date" class="${INP}" />`)}
            ${/* Ruhsat OCR bu iki tarihi ZATEN okuyordu ((I) tescil, (B) ilk tescil)
                  ama form alanı olmadığı için atılıyordu. Bilgi işlem evrak takibi
                  tescil tarihini istiyor (Göksenil, 3 Ağu 2026) — kolonlar sql/153. */''}
            ${alan('Tescil Tarihi', `<input id="f_tescil" type="date" class="${INP}" />`)}
            ${alan('İlk Tescil Tarihi', `<input id="f_ilktescil" type="date" class="${INP}" />`)}
            ${alan('Lokasyon', sel('f_lokasyon', 'LOKASYON'))}
            ${alan('Park', sel('f_park', 'PARK'))}
            ${alan('Alış Şekli', sel('f_alis_sekli', 'ALIS_SEKLI', 'Seçiniz… (zorunlu değil)'))}
            <div class="flex items-end pb-1"><label class="flex items-center gap-2 text-sm"><input id="f_anahtar" type="checkbox" class="w-4 h-4 accent-primary" /> Yedek Anahtar</label></div>
          </div>
          <div id="alisIpucu" class="text-[11px] text-on-surface-variant mt-2">Alış Şekli zorunlu değil — İsmail Bey Fiyatlama ekranından girer. Müşteri kaynağı Arabam.com ise otomatik seçilir.</div>
        </div>

        <!-- 3. Araç Sahibi / Müşteri -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5 md:p-6">
          ${bslk('person', '3. Araç Sahibi / Müşteri')}
          <div class="flex gap-3 mb-3">
            <div class="flex-1 flex items-center bg-surface-container-low px-3 py-2 rounded-lg border border-outline-variant">
              ${mat('search', 'text-on-surface-variant')}
              <input id="msAra" placeholder="İsim veya telefon ile hızlı ara…" class="bg-transparent border-none focus:ring-0 focus:outline-none text-sm w-full ml-2" />
            </div>
            <button id="msYeni" class="bg-surface-container-high text-primary px-4 rounded-lg font-bold text-sm hover:bg-outline-variant transition-all flex items-center gap-1.5">${mat('person_add', 'text-[18px]')} Yeni Müşteri</button>
          </div>
          <div id="msSonuc"></div>
          <div id="msSecili"></div>
          <div id="msForm" class="hidden">
            <div class="text-[11px] text-on-surface-variant mb-1">Bilgi işlem için zorunlu değil — bulunamazsa doldur.</div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
              <!-- Şahıs / Tüzel — Göksenil: "müşteri ekle alanında şahıs mı
                   tüzel mi sorusu radio buton olarak görünsün." Eskiden tip
                   KOŞULSUZ 'SAHIS' yazılıyordu; ALJ ve ARABAM gibi ANONİM
                   ŞİRKETLER de şahıs görünüyordu. -->
              <div class="md:col-span-2">${alan('Müşteri Tipi', `<div class="flex gap-2">
                ${['SAHIS', 'SIRKET'].map((k, i) => `<label class="flex-1 cursor-pointer">
                  <input type="radio" name="ms_tip_r" value="${k}" class="peer sr-only" ${i === 0 ? 'checked' : ''}>
                  <span class="block text-center px-2 py-2 rounded-lg border border-outline-variant text-[12px] font-bold text-on-surface-variant bg-white peer-checked:bg-primary peer-checked:text-on-primary peer-checked:border-primary transition-all">${k === 'SAHIS' ? 'Şahıs' : 'Şirket'}</span>
                </label>`).join('')}
                <input type="hidden" id="ms_tip" value="SAHIS" />
              </div>`)}</div>
              ${alan('Ad / Ünvan', `<input id="ms_ad" class="${INP}" />`)}
              ${alan('Telefon (10 hane)', `<input id="ms_tel" inputmode="numeric" maxlength="16" placeholder="(5XX) XXX XX XX" class="${INP} tel-gir" />`)}
              ${alan('TC / Vergi No', `<input id="ms_tckn" maxlength="11" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')" class="${INP}" />`)}
              ${alan('Geliş Kaynağı', sel('ms_kaynak', 'ALIS_SEKLI', 'Bilinmiyor'))}
            </div>
            <div class="text-[10px] text-on-surface-variant mt-1">Telefonu başına <b>0 koymadan</b> gir — kayıtta 0'lı saklanır (05XXXXXXXXX).</div>
          </div>
        </div>

        <!-- 4. Stok Notu -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5 md:p-6">
          ${bslk('description', '4. Stok Notu')}
          <textarea id="f_notu" rows="3" class="${INP}" placeholder="Araç hakkında özel notlar, satın alma detayı, öne çıkan durum…"></textarea>
        </div>
      </div>

      <!-- SAĞ %35: Doğrulama Merkezi (yapışkan) -->
      <div class="xl:sticky xl:top-4 flex flex-col gap-4 md:gap-6">

        <!-- Canlı Önizleme (fotoğraf YAKINDA — medya WB4) -->
        <div class="bg-inverse-surface text-inverse-on-surface rounded-xl overflow-hidden custom-shadow">
          <div class="relative h-28 bg-gradient-to-br from-primary to-[#3a0d0d] flex items-end p-4 overflow-hidden">
            <span class="material-symbols-outlined absolute -right-2 -top-3 text-white/10 text-[130px] leading-none select-none">directions_car</span>
            <div class="relative">
              <span class="bg-primary text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider inline-block mb-1">Aktif Önizleme</span>
              <h4 id="pvPlaka" class="text-lg font-bold leading-tight">—</h4>
              <p id="pvArac" class="text-xs opacity-80">Araç bilgisi bekleniyor</p>
            </div>
          </div>
          <div class="p-4 grid grid-cols-2 gap-4 text-xs">
            <div><span class="block opacity-60">Şase</span><span id="pvSasi" class="font-mono">—</span></div>
            <div><span class="block opacity-60">Kilometre</span><span id="pvKm" class="font-bold text-primary-fixed">— KM</span></div>
          </div>
        </div>

        <!-- Sistem Doğrulama -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5">
          <h4 class="text-sm font-bold mb-4 flex items-center justify-between">Sistem Doğrulama
            <span class="text-[10px] font-bold text-on-surface-variant uppercase bg-surface-container px-2 py-0.5 rounded">Canlı</span></h4>
          <div class="space-y-3">
            ${dgRow('dgPlaka', 'Plaka Formatı')}
            ${dgRow('dgSasi', 'Şase No Geçerliliği')}
            ${dgRow('dgMusteri', 'Müşteri Kaydı')}
            ${dgRow('dgTsb', 'TSB Bilgileri')}
          </div>
        </div>

        <!-- Ekspertiz & Tramer (eski Döküman Merkezi yerine) -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-5">
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-sm font-bold flex items-center gap-2">${mat('assignment_turned_in', 'text-primary text-[20px]')} Ekspertiz</h4>
            <label class="text-xs font-bold text-primary flex items-center gap-1 cursor-pointer hover:underline">${mat('upload_file', 'text-[16px]')} PDF Yükle<input id="ekspPdf" type="file" accept="application/pdf" hidden /></label>
          </div>
          <div id="ekspDrop" class="border-2 border-dashed border-outline-variant rounded-lg p-3 transition-colors">
            <div id="ekspOzet" class="text-[11px] text-on-surface-variant mb-2 text-center">Ekspertiz PDF'ini buraya <b>sürükle-bırak</b> → DYNOMOSS otomatik dolar; diğer firmalarda parçalara tıklayarak işaretle.</div>
            <div id="svgKap" class="max-w-full mx-auto"></div>
            <!-- ÜSTÜN'de kaporta şeması PDF'te gömülü görsel; okunan hâli burada
                 gösterilir ki kullanıcı PDF'i ayrıca açmadan karşılaştırabilsin. -->
            <div id="ekspSemaKap"></div>
          </div>
          <div class="flex flex-wrap gap-2.5 justify-center mt-2 text-[10px]">
            <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#c8c8c8;border-radius:3px;display:inline-block"></i>Orijinal</span>
            <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#03A9F4;border-radius:3px;display:inline-block"></i>Boyalı</span>
            <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#f3de1f;border-radius:3px;display:inline-block"></i>Lokal</span>
            <span class="flex items-center gap-1"><i style="width:11px;height:11px;background:#ff1100;border-radius:3px;display:inline-block"></i>Değişen</span>
          </div>

          <div class="border-t border-outline-variant mt-4 pt-3">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-sm font-bold flex items-center gap-2">${mat('search_check', 'text-primary text-[20px]')} Tramer</h4>
              <label class="text-xs font-bold text-primary flex items-center gap-1 cursor-pointer hover:underline">${mat('upload_file', 'text-[16px]')} Yükle<input id="tramerPdf" type="file" accept="application/pdf,image/*" hidden /></label>
            </div>
            <div id="tramerDrop" class="border-2 border-dashed border-outline-variant rounded-lg p-3 transition-colors">
              <div id="tramerOzet" class="text-[11px] text-on-surface-variant mb-2 text-center">Tramer PDF'ini <b>veya ekran görüntüsünü</b> buraya <b>sürükle-bırak</b> → hasarlar otomatik okunur (görselde OCR, belge bilgisayardan çıkmaz). Veya elle ekle.</div>
              ${alan('Sorgu Tarihi', `<input id="t_tarih" type="date" value="${bugunISO()}" class="${INP}" />`)}
              <div class="grid grid-cols-2 gap-2 mt-2">
                ${alan('Hasar Tarihi', `<input id="h_tarih" type="date" class="${INP}" />`)}
                ${alan('Hasar Tutarı (₺)', `<input id="h_tutar" type="number" class="${INP}" />`)}
                <div class="col-span-2">${alan('Hasar Nedeni', `<input id="h_neden" class="${INP}" placeholder="ör. Kaporta/Boya, cam, mekanik…" />`)}</div>
              </div>
              <button id="h_ekle" class="w-full mt-2 bg-primary/10 text-primary h-9 rounded-lg text-sm font-bold flex items-center justify-center gap-1 hover:bg-primary/20">${mat('add', 'text-[18px]')} Hasar Ekle</button>
              <div id="hasarListe" class="mt-2"></div>
              <div id="tramerSatir" class="mt-2"></div>
            </div>

            <!-- ERP DETAY SORGUSU — Göksenil: "tramer görsel eklediğimde eğer
                 erp detay sorgusu var ise onu da sürükle bırak ile yükleyeceğim."
                 Ayrı belge (hasar kalemlerinin dökümü), ayrı evrak tipi:
                 TRAMER_DETAY (sql/122). OCR ÇALIŞTIRILMAZ — yalnız saklanır ve
                 araç kartında tramer belgesinin yanında gösterilir. -->
            <div id="tramerDetayDrop" class="border-2 border-dashed border-outline-variant rounded-lg p-3 mt-2 transition-colors">
              <label class="w-full flex items-center justify-center gap-2 cursor-pointer">
                ${mat('description', 'text-primary')}<span class="text-[11px] font-bold text-on-surface-variant uppercase">ERP Detay Sorgusu (varsa)</span>
                <input id="tramerDetayInp" type="file" accept="application/pdf,image/*" hidden />
              </label>
              <div id="tramerDetayOzet" class="text-[10px] text-on-surface-variant text-center mt-1">
                Hasar kalemlerinin dökümü. Sürükle-bırak ya da tıkla — danışmanlar araç kartında görebilecek.
              </div>
            </div>
          </div>

          <!-- Ruhsat görseli (QR/OCR + saklama YAKINDA) -->
          <div class="border-t border-outline-variant mt-4 pt-3">
            <div id="ruhsatDrop" class="border-2 border-dashed border-outline-variant rounded-lg p-3 transition-colors">
              <label class="w-full flex items-center justify-center gap-2 cursor-pointer">
                ${mat('qr_code_scanner', 'text-primary')}<span class="text-[11px] font-bold text-on-surface-variant uppercase">Ruhsatı sürükle-bırak</span>
                <input id="ruhsatInp" type="file" accept="image/*,application/pdf" hidden />
              </label>
              <div class="text-[10px] text-on-surface-variant text-center mt-1">
                <b>QR</b> → plaka · belge seri no · sahibin kimliği (kesin).<br>
                <b>Basılı metin (OCR)</b> → şasi · motor no · marka · model yılı · yakıt · renk · muayene.
                Yalnız <b>boş</b> alanlar doldurulur, yazdıkların ezilmez — okunanları kaydetmeden önce gözden geçir.
              </div>
              <div id="ruhsatOnizle"></div>
            </div>
          </div>
        </div>

        <!-- AI Analiz & Doğrulama (genel değerleme YAKINDA; okuma sonuçları gerçek) -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-hidden">
          <div class="bg-surface-container px-5 py-3 border-b border-outline-variant flex justify-between items-center">
            <h4 class="text-sm font-bold">AI Analiz & Doğrulama</h4>
            <span class="text-[10px] font-bold text-on-surface-variant uppercase bg-surface-container-lowest px-2 py-0.5 rounded">Yakında</span>
          </div>
          <div id="aiGovde" class="p-4 text-xs text-on-surface-variant">Ekspertiz/tramer yüklenince okuma sonuçları burada özetlenir. Piyasa analizi & AI değerleme yakında.</div>
        </div>

        <!-- Fiyatlamaya Hazırlık durumu (bilgi) -->
        <div id="hazirKart" class="border rounded-xl p-5 text-center space-y-2"></div>
      </div>
    </div>

    <!-- Alt aksiyon çubuğu (yapışkan) -->
    <div class="sticky bottom-3 z-30 mt-6 bg-surface-container-lowest/95 backdrop-blur border border-outline-variant rounded-xl custom-shadow px-4 py-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <button id="akKaydetSade" class="px-5 h-11 flex items-center gap-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low text-sm font-bold">${mat('save', 'text-[18px]')} Sadece Kaydet</button>
        <span class="text-xs text-on-surface-variant hidden sm:block">Taslak kaydeder, fiyatlamaya göndermez.</span>
      </div>
      <button id="akKaydet" class="bg-primary text-on-primary px-6 h-11 flex items-center gap-2 rounded-lg text-sm font-bold hover:opacity-90 shadow-sm">${mat('sell', 'text-[18px]')} Kaydet ve Fiyatlamaya Gönder ${mat('arrow_forward', 'text-[18px]')}</button>
    </div>`

  // SVG göm + boya + tıkla
  document.getElementById('svgKap').innerHTML = SVGTXT
  boyaBagla()

  document.getElementById('ekspPdf').addEventListener('change', e => ekspIsle(e.target.files[0]))
  document.getElementById('tramerPdf').addEventListener('change', e => tramerIsle(e.target.files[0]))
  document.getElementById('ruhsatInp').addEventListener('change', ruhsatYukle)
  document.getElementById('h_ekle').addEventListener('click', hasarEkle)
  document.getElementById('tsbGetir').addEventListener('click', tsbGetir)
  ;['f_tsbmarka', 'f_tsbtip'].forEach(id => document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); tsbGetir() }
  }))
  // Paketten tip kodu arama — yazdıkça, gecikmeli (sql/209)
  ;['f_paketara', 'f_paketyil'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', paketAraGecikmeli))
  document.getElementById('msAra').addEventListener('input', musteriAra)
  // Yeni müşteri formunu aç + arama kutusuna yazılanı Ad/Ünvan'a taşı
  const yeniMusteriAc = () => {
    document.getElementById('msForm').classList.remove('hidden')
    const adEl = document.getElementById('ms_ad')
    const q = document.getElementById('msAra').value.trim()
    if (q && !/^\d+$/.test(q) && !adEl.value) adEl.value = q
    adEl.focus(); guncelle()
  }
  document.getElementById('msYeni').addEventListener('click', yeniMusteriAc)
  document.getElementById('msAra').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (!satici) yeniMusteriAc() }
  })
  document.getElementById('akKaydet').addEventListener('click', () => kaydet(true))
  document.getElementById('akKaydetSade').addEventListener('click', () => kaydet(false))

  // Sürükle-bırak (ekspertiz PDF + tramer) — aynı davranış, tek yardımcı
  suruklebirakKur('ekspDrop', ekspIsle)
  suruklebirakKur('tramerDrop', tramerIsle)
  suruklebirakKur('ruhsatDrop', ruhsatIsle)
  // Şahıs/Tüzel radyosu → gizli ms_tip alanı (kaydet oradan okuyor)
  document.querySelectorAll('input[name="ms_tip_r"]').forEach(r =>
    r.addEventListener('change', () => { document.getElementById('ms_tip').value = r.value }))
  suruklebirakKur('tramerDetayDrop', tramerDetayIsle)
  document.getElementById('tramerDetayInp').addEventListener('change', e => tramerDetayIsle(e.target.files[0]))
  telMaskeKur()

  // Canlı önizleme + doğrulama
  ;['f_plaka', 'f_sasi', 'f_marka', 'f_model', 'f_versiyon', 'f_yil', 'f_km', 'ms_ad', 'ms_tel', 'f_stokkodu'].forEach(id =>
    document.getElementById(id).addEventListener('input', guncelle))
  document.getElementById('f_plakasiz').addEventListener('change', plakasizUygula)
  document.getElementById('f_stokkodu').addEventListener('input', mukerrerTaramaGecikmeli)
  document.getElementById('f_alis_sekli').addEventListener('change', guncelle)
  // Geçmiş satış taraması — plaka ya da şasi yazılınca (gecikmeli)
  ;['f_plaka', 'f_sasi'].forEach(id =>
    document.getElementById(id).addEventListener('input', gecmisTaramaGecikmeli))
  // Plaka mükerrer kontrolü — CANLI, yazarken (Göksenil, 10 Ağu 2026)
  document.getElementById('f_plaka').addEventListener('input', mukerrerTaramaGecikmeli)
  // Yeni müşteri formunda kaynak seçilince Alış Şekli otomatik dolabilir
  document.getElementById('ms_kaynak').addEventListener('change', e => { kaynakUygula(e.target.value); guncelle() })
  // Model/versiyon elle yazılıp alandan çıkınca öğrenilmiş yakıt/vites/kasa'yı getir
  ;['f_model', 'f_versiyon'].forEach(id => document.getElementById(id).addEventListener('blur', () => {
    const t = [document.getElementById('f_model').value.trim(), document.getElementById('f_versiyon').value.trim()].filter(Boolean).join(' ')
    if (t) ozellikDoldur(t)
  }))
  // Varsayılanlar: Lokasyon = İsmail Çalmaz Otomotiv, Park = Bahçe
  const setDef = (id, kod) => { const el = document.getElementById(id); if (el && !el.value) el.value = kod }
  setDef('f_lokasyon', 'ISMAIL_CALMAZ_OTOMOTIV')
  setDef('f_park', 'BAHCE')
  yilDoldur(varsayilanYillar())
  hasarListeCiz()
  guncelle()
}

// Sürükle-bırak kutusu bağla (kutu id'si + dosyayı işleyecek fonksiyon)
function suruklebirakKur(id, isle) {
  const drop = document.getElementById(id); if (!drop) return
  ;['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('border-primary', 'bg-primary/5') }))
  ;['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('border-primary', 'bg-primary/5') }))
  drop.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) isle(f) })
}

// --- Tramer hasar satırları ---
// (gg.aa.yyyy → ISO çevirisi artık tramer-ocr.js içinde; burada tekrarı kaldırıldı)
function hasarEkle() {
  const tarih = document.getElementById('h_tarih').value
  const neden = document.getElementById('h_neden').value.trim()
  const tutar = Number(document.getElementById('h_tutar').value) || 0
  if (!tarih && !neden && !tutar) return
  hasarlar.push({ tarih: tarih || null, neden, tutar })
  document.getElementById('h_tarih').value = ''; document.getElementById('h_neden').value = ''; document.getElementById('h_tutar').value = ''
  hasarListeCiz()
}
function hasarListeCiz() {
  const el = document.getElementById('hasarListe'); if (!el) return
  if (!hasarlar.length) { el.innerHTML = `<div class="text-[11px] text-on-surface-variant">Hasar eklenmedi.</div>`; return }
  const toplam = hasarlar.reduce((s, h) => s + (Number(h.tutar) || 0), 0)
  el.innerHTML = `<div class="text-[11px] font-bold mb-1">${hasarlar.length} hasar · Toplam ${toplam.toLocaleString('tr-TR')} ₺</div>` +
    hasarlar.map((h, i) => `<div class="flex items-center gap-2 text-[11px] border-t border-outline-variant/40 py-1">
      <span class="flex-1 min-w-0 truncate">${kacis(h.tarih || '—')} · ${kacis(buyuk(h.neden || ''))}</span>
      <b class="shrink-0">${(Number(h.tutar) || 0).toLocaleString('tr-TR')} ₺</b>
      <button data-hi="${i}" class="h-sil w-5 h-5 rounded-full hover:bg-error/10 text-error flex items-center justify-center shrink-0">${mat('close', 'text-[14px]')}</button></div>`).join('')
  el.querySelectorAll('.h-sil').forEach(b => b.addEventListener('click', () => { hasarlar.splice(+b.dataset.hi, 1); hasarListeCiz() }))
}

// Model Yılı açılır listesini doldur (TSB üretim yılları veya varsayılan aralık).
// Mevcut seçim listede yoksa başa eklenir (elle seçilen yıl kaybolmasın).
function yilDoldur(yillar, secili) {
  const el = document.getElementById('f_yil'); if (!el) return
  const cur = secili != null ? String(secili) : el.value
  let ys = (yillar || []).map(String)
  if (cur && !ys.includes(cur)) ys = [cur, ...ys]
  el.innerHTML = `<option value="">Seçiniz…</option>` +
    ys.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('')
}
function varsayilanYillar() {
  // TAM aralık — TSB'de olmayan eski araçlar da (2011 öncesi) girilebilsin.
  const y = new Date().getFullYear(); const arr = []
  for (let i = y + 1; i >= 1980; i--) arr.push(i)   // gelecek model yılı dahil
  return arr
}

// sql/188 · Plakasız araç anahtarı — plaka/şasi/motor alanlarını kilitler,
// yerine Stok Kodu alanını açar. Alanları GİZLEMİYOR, devre dışı bırakıyor:
// gizlenirse kullanıcı verinin nereye gittiğini anlamıyor.
function plakasizUygula() {
  const acik = !!document.getElementById('f_plakasiz').checked
  document.getElementById('f_kodSatir').classList.toggle('hidden', !acik)
  for (const id of ['f_plaka', 'f_sasi', 'f_motor']) {
    const el = document.getElementById(id); if (!el) continue
    el.disabled = acik
    el.classList.toggle('opacity-40', acik)
    if (acik) el.value = ''
  }
  const et = document.querySelector('label[for="f_plaka"]')
  if (et) et.textContent = acik ? 'Plaka (yok)' : 'Plaka *'
  MUKERRER = null
  if (acik) document.getElementById('f_stokkodu').focus()
  mukerrerTaramaGecikmeli()
  guncelle()
}

// --- Canlı önizleme + Sistem Doğrulama + Hazır kapısı ---
function guncelle() {
  const g = id => (document.getElementById(id)?.value || '').trim()
  const plakaHam = g('f_plaka')
  const marka = [g('f_marka'), g('f_model'), g('f_versiyon')].filter(Boolean).join(' ')
  const yil = g('f_yil'), km = g('f_km'), sasi = g('f_sasi')

  document.getElementById('pvPlaka').textContent =
    (document.getElementById('f_plakasiz')?.checked ? g('f_stokkodu') : plakaHam).toUpperCase() || '—'
  document.getElementById('pvArac').textContent = (marka || 'Araç bilgisi bekleniyor') + (yil ? ` (${yil})` : '')
  document.getElementById('pvSasi').textContent = sasi ? (sasi.length > 8 ? '…' + sasi.slice(-4).toUpperCase() : sasi.toUpperCase()) : '—'
  document.getElementById('pvKm').textContent = km ? (+km).toLocaleString('tr-TR') + ' KM' : '— KM'

  // sql/188 · Plakasız varlıkta kimlik = STOK KODU; plaka/şasi maddeleri
  //   "gerekmiyor" olarak YEŞİL sayılır. Kapı gevşetilmiyor, ölçtüğü şey
  //   değişiyor — kimliksiz kayıt yine geçemez.
  const plakasiz = !!document.getElementById('f_plakasiz')?.checked
  const kod = g('f_stokkodu')
  const plakaOk = plakasiz
    ? kod.length >= 3
    : /^\d{2}\s?[A-Za-zĞÜŞİÖÇğüşıöç]{1,4}\s?\d{2,5}$/.test(plakaHam)
  const sasiOk = plakasiz ? true : sasi.length === 17
  const musteriOk = !!(satici || g('ms_ad'))
  // Karavan/römork/iş makinesinin TSB marka-tip kodu YOKTUR (Göksenil,
  // 11 Ağu 2026). Kimlik zaten stok kodu; marka/model serbest kalır.
  const tsbOk = plakasiz ? true : !!(g('f_marka') && g('f_model'))
  // Mükerrer plaka/kod, biçim doğru olsa bile kapıyı KAPATIR (aynı araç iki kez girilemez)
  if (plakasiz) {
    dgSatir('dgPlaka', plakaOk && !MUKERRER,
      kod ? (MUKERRER ? 'MÜKERRER' : plakaOk ? 'TAMAM' : 'EN AZ 3 HANE') : 'BEKLİYOR')
    dgSatir('dgSasi', true, 'GEREKMİYOR')
  } else {
    dgSatir('dgPlaka', plakaOk && !MUKERRER,
      plakaHam ? (MUKERRER ? 'MÜKERRER' : plakaOk ? 'TAMAM' : 'HATALI') : 'BEKLİYOR')
    dgSatir('dgSasi', sasiOk, sasi ? (sasiOk ? 'DOĞRULANDI' : `${sasi.length}/17`) : 'BEKLİYOR')
  }
  dgSatir('dgMusteri', musteriOk, musteriOk ? 'TAMAM' : 'BEKLİYOR')
  dgSatir('dgTsb', tsbOk, plakasiz ? 'GEREKMİYOR' : (tsbOk ? 'TAMAM' : 'EKSİK'))

  // ⚠️ KAPI ARTIK DÖRT MADDEYE BAĞLI (Göksenil, 10 Ağu 2026: "sistem
  //   doğrulamasında 4 madde tamam değilse fiyatlamaya gönderememeli").
  //   Önceden yalnız PLAKA yeterliydi; şasisiz/müşterisiz/TSB'siz araç
  //   fiyatlama kuyruğuna düşüyor, İsmail Bey eksik künyeyle karşılaşıyordu.
  //   Alış Şekli hâlâ zorunlu DEĞİL — onu fiyatlamada kendisi giriyor.
  hazirGuncelle(plakaOk && !MUKERRER && sasiOk && musteriOk && tsbOk,
    { plaka: plakaOk && !MUKERRER, sasi: sasiOk, musteri: musteriOk, tsb: tsbOk })
}
function dgSatir(id, ok, metin) {
  const row = document.getElementById(id); if (!row) return
  const ik = row.querySelector('.dg-ikon'), et = row.querySelector('.dg-etiket'), mt = row.querySelector('.dg-metin')
  ik.textContent = ok ? 'check_circle' : 'radio_button_unchecked'
  ik.style.fontVariationSettings = ok ? "'FILL' 1" : ''
  ik.className = 'material-symbols-outlined text-lg dg-ikon ' + (ok ? 'text-green-600' : 'text-outline')
  mt.className = 'text-sm dg-metin ' + (ok ? 'font-medium' : '')
  et.textContent = metin
  et.className = 'text-[10px] font-bold dg-etiket ' + (ok ? 'text-green-600' : 'text-outline')
}
function hazirGuncelle(hazir, durumlar = null) {
  const el = document.getElementById('hazirKart')
  // Ekspertiz okunamadıysa ve hiçbir parça işaretlenmediyse uyar (araç "orijinal"
  // sanılmasın) — engellemez, uyarır.
  const eksikEksp = PANEL_OKUNMADI && !PARCALAR.some(p => paneller[p] !== 'ORIJINAL')
  const ekspUyari = eksikEksp
    ? `<p class="text-[11px] text-[#B45309] font-bold mt-1">⚠ Ekspertiz boya/değişen bilgisi işaretlenmedi — şemadan kontrol et.</p>` : ''

  // "Kaydet ve Fiyatlamaya Gönder" FİİLEN kilitlenir. Yalnız kartı kırmızıya
  // boyamak yetmez — buton tıklanabilir kalırsa eksik araç kuyruğa düşer.
  // "Sadece Kaydet" HER ZAMAN açık: taslak kaydetmek hep mümkün olmalı.
  const gonderBtn = document.getElementById('akKaydet')
  if (gonderBtn) {
    gonderBtn.disabled = !hazir
    gonderBtn.classList.toggle('opacity-40', !hazir)
    gonderBtn.classList.toggle('cursor-not-allowed', !hazir)
    gonderBtn.title = hazir ? '' : 'Sistem Doğrulaması tamamlanmadan fiyatlamaya gönderilemez.'
  }

  if (hazir) {
    el.className = 'border border-green-200 bg-green-50 rounded-xl p-5 text-center space-y-1'
    el.innerHTML = `<span class="material-symbols-outlined text-green-600 text-4xl" style="font-variation-settings:'FILL' 1">check_circle</span>
      <h5 class="text-green-700 font-extrabold tracking-tight">FİYATLAMAYA HAZIR</h5>
      <p class="text-[11px] text-green-700">Aşağıdan “Kaydet ve Fiyatlamaya Gönder” ile İsmail Bey kuyruğuna alabilirsin.</p>${ekspUyari}`
  } else {
    el.className = 'border border-error/20 bg-error-container/20 rounded-xl p-5 text-center space-y-1'
    // NEYİN eksik olduğu YAZILIR. "Hazır değil" deyip susmak, kullanıcıyı
    // dört maddeyi tek tek gözle aramaya bırakıyordu.
    const eksikAd = { plaka: 'Plaka', sasi: 'Şasi No', musteri: 'Müşteri', tsb: 'Marka/Model' }
    const eksikler = durumlar
      ? Object.keys(eksikAd).filter(k => !durumlar[k]).map(k => eksikAd[k])
      : []
    el.innerHTML = `<span class="material-symbols-outlined text-error text-4xl">lock</span>
      <h5 class="text-error font-extrabold tracking-tight">${MUKERRER ? 'BU PLAKA SİSTEMDE VAR' : 'FİYATLAMAYA HAZIR DEĞİL'}</h5>
      <p class="text-[11px] text-error font-medium">${MUKERRER
        ? 'Araç hâlâ elimizde göründüğü için yeni kayıt açılamaz. Yukarıdaki uyarıdan mevcut kaydı açın.'
        : eksikler.length
          ? `Eksik: <b>${kacis(eksikler.join(' · '))}</b><span class="block font-normal mt-0.5">Taslak olarak kaydedebilirsin; fiyatlamaya göndermek için dördü de tamam olmalı.</span>`
          : 'Sistem Doğrulaması tamamlanmadı.'}</p>${ekspUyari}`
  }
}

function boyaBagla() {
  const svg = document.querySelector('#svgKap svg'); if (!svg) return
  svgBoya(svg, paneller)
  for (const path of svg.querySelectorAll('[data-part]')) {
    path.style.cursor = 'pointer'
    path.onclick = () => {
      const p = path.getAttribute('data-part'); const eski = paneller[p]
      const i = DURUMLAR.indexOf(paneller[p])
      paneller[p] = DURUMLAR[(i + 1) % DURUMLAR.length]
      if (ekspFirma !== 'BILINMEYEN') duzeltmeKaydet(ekspFirma, p, eski, paneller[p])
      svgBoya(svg, paneller); ekspOzetCiz(); guncelle()
    }
  }
}
// EKSP_OKUNAMAYAN: PDF'ten durumu ÇIKARILAMAYAN parçalar (ad ad).
// PANEL_OKUNMADI: en az bir parça okunamadı → "0 boyalı parça" DEMEYİZ;
// bilmemek ile "hiç yok" aynı şey değil — kullanıcı 2 boya + 1 lokal + 1
// değişen olan aracı orijinal sanmıştı.
let PANEL_OKUNMADI = false
let EKSP_OKUNAMAYAN = []
function ekspOzetCiz(r) {
  const boyali = PARCALAR.filter(p => paneller[p] !== 'ORIJINAL')
  const el = document.getElementById('ekspOzet')
  const okunan = PARCALAR.length - EKSP_OKUNAMAYAN.length
  let h = ''
  if (ekspFirma !== 'BILINMEYEN') h += `<b>${kacis(ekspFirma)}</b>${r && r.km != null ? ' · KM: ' + r.km.toLocaleString('tr-TR') : ''} · `
  if (okunan === 0) {
    h += `<span class="text-amber-700 font-bold">⚠ Boya/değişen bilgisi PDF'ten okunamadı — şemadan ELLE işaretle.</span>`
  } else {
    h += `${okunan}/${PARCALAR.length} parça okundu · ${boyali.length} boyalı/değişen`
    // Hangi parçanın okunamadığını AÇIKÇA say — "13'ten 11'i okundu" deyip
    // hangi ikisi olduğunu söylememek kullanıcıyı yanıltırdı.
    if (EKSP_OKUNAMAYAN.length) h += `<br><span class="text-amber-700 font-bold">⚠ Okunamadı: ${kacis(EKSP_OKUNAMAYAN.join(', '))} — bunları elle işaretle.</span>`
  }
  if (r && r.sor && r.sor.length) h += ` · <span class="text-amber-700 font-bold">⚠ sor: ${kacis(r.sor.join(', '))}</span>`
  el.innerHTML = h
}
// AI kartını okuma sonuçlarıyla doldur (gerçek), genel değerleme yakında
function aiGuncelle(r) {
  const g = document.getElementById('aiGovde')
  const boyali = PARCALAR.filter(p => paneller[p] !== 'ORIJINAL').length
  const kmGirilen = (document.getElementById('f_km').value || '').trim()
  const satirlar = []
  if (ekspFirma !== 'BILINMEYEN') {
    if (PANEL_OKUNMADI) {
      // Firma tanındı ama panel tablosu çözülemedi → "0 parça" İDDİA ETME.
      satirlar.push(`<div class="flex items-center gap-2 bg-[#FFFBEB] p-2.5 rounded-lg border border-[#F59E0B]/30"><span class="material-symbols-outlined text-[#B45309] text-[18px]">warning</span><div><p class="font-bold text-[#92400E]">Ekspertiz okundu — ${kacis(ekspFirma)}</p><p class="text-[#B45309]">Boya/değişen tablosu bu firmada otomatik okunamıyor. Şemadaki parçalara tıklayarak <b>elle işaretle</b> — aksi halde araç orijinal görünür.</p></div></div>`)
    } else {
      satirlar.push(`<div class="flex items-center gap-2 bg-green-50 p-2.5 rounded-lg border border-green-100"><span class="material-symbols-outlined text-green-600 text-[18px]">check_circle</span><div><p class="font-bold text-green-800">Ekspertiz okundu — ${kacis(ekspFirma)}</p><p class="text-green-700">${boyali} parça boyalı/değişen işaretlendi.</p></div></div>`)
    }
    if (r && r.km != null && kmGirilen && +kmGirilen !== r.km) {
      satirlar.push(`<div class="flex items-center gap-2 bg-error-container p-2.5 rounded-lg border border-error/10 text-error"><span class="material-symbols-outlined text-[18px]">warning</span><div><p class="font-bold">KM farkı</p><p>Girilen: ${(+kmGirilen).toLocaleString('tr-TR')} · PDF: ${r.km.toLocaleString('tr-TR')}</p></div></div>`)
    }
  }
  satirlar.push(`<p class="text-on-surface-variant">Piyasa analizi & AI önerilen fiyat — <b>yakında</b>.</p>`)
  g.innerHTML = `<div class="space-y-2">${satirlar.join('')}</div>`
}

async function ekspIsle(f) {
  if (!f) return
  ekspFile = f
  const oz = document.getElementById('ekspOzet')
  oz.textContent = 'Okunuyor…'
  // ÜSTÜN'de şema gömülü görsel olduğu için OCR çalışır — ilerleme gösteriliyor.
  const r = await ekspertizOku(f, p => { oz.textContent = `Şema okunuyor (OCR)… %${Math.round(p * 100)}` })
  ekspFirma = r.firma
  if (r.hata) { oz.innerHTML = '<b class="text-error">Hata:</b> ' + kacis(r.hata); return }
  // ⚠️ Yalnız GERÇEKTEN okunan panel yazılır. Okunamayan panel ORİJİNAL
  // SAYILMAZ — kullanıcının önceki işaretini korur ve uyarı listesine girer.
  EKSP_OKUNAMAYAN = r.okunamayan || []
  PANEL_OKUNMADI = EKSP_OKUNAMAYAN.length > 0
  for (const p of PARCALAR) if (r.paneller[p]) paneller[p] = r.paneller[p]
  // ÜSTÜN şema görseli: kullanıcı PDF'i ayrıca açmadan yan yana karşılaştırsın.
  const gk = document.getElementById('ekspSemaKap')
  if (gk) gk.innerHTML = r.semaGorsel
    ? `<img src="${r.semaGorsel}" alt="ekspertiz şeması" class="mt-2 w-full rounded-lg border border-outline-variant" />
       <div class="text-[10px] text-on-surface-variant text-center mt-1">PDF'teki kaporta şeması — yukarıdaki işaretlemeyle karşılaştır.</div>`
    : ''
  if (r.km != null && !document.getElementById('f_km').value) { document.getElementById('f_km').value = r.km; guncelle() }
  boyaBagla(); ekspOzetCiz(r); aiGuncelle(r); guncelle()
}

// Tramer belgesi (PDF veya GÖRSEL) sürükle-bırak → otomatik okuma.
// Motor tramer-ocr.js: önce PDF metin katmanı (kesin), yoksa Tesseract OCR
// (tarayıcıda, ücretsiz, belge bilgisayardan çıkmaz).
// ⚠️ Okunan satırlar doğrudan kaydedilmez — mevcut düzenlenebilir hasar
// listesine düşer; kullanıcı düzeltip "Kaydet" dediğinde arac_tramer'a yazılır.
async function tramerIsle(f) {
  if (!f) return
  tramerFile = f
  const ozetEl = document.getElementById('tramerOzet')
  const satirEl = document.getElementById('tramerSatir')
  const gorselMi = !!(f.type && f.type.startsWith('image/'))

  // Görselse önizlemeyi HEMEN göster — OCR sürerken ne yüklediği görünsün.
  const onizleme = gorselMi
    ? `<img src="${URL.createObjectURL(f)}" alt="tramer" class="mt-1 w-full max-w-full max-h-56 object-contain rounded-lg border border-outline-variant" />`
    : ''
  satirEl.innerHTML = onizleme
  ozetEl.textContent = gorselMi ? 'Görüntü okunuyor (OCR)…' : 'Belge açılıyor…'

  let a, kaynak
  try {
    const r = await belgeSatirlari(f, p => { ozetEl.textContent = `Görüntü okunuyor (OCR)… %${Math.round(p * 100)}` })
    kaynak = r.kaynak
    a = tramerAyristir(r.satirlar)
  } catch (e) {
    console.error('[tramer-ocr] araç kabul okuma', e)
    ozetEl.innerHTML = `<b class="text-error">Okunamadı:</b> ${kacis(e.message)} — hasarları elle ekleyebilirsin.`
    return
  }

  // ⚠️ Boş sonuç mevcut EL GİRİŞİNİ EZMESİN: yalnız gerçekten satır okunduysa
  // liste değiştirilir. (Yanlış/bulanık bir görselin elle girilen hasarları
  // silmesi, kullanıcının fark etmeyeceği bir veri kaybı olurdu.)
  if (a.kayitlar.length) {
    hasarlar = a.kayitlar.map(k => ({ tarih: k.hasar_tarihi, neden: k.aciklama || '', tutar: k.tutar }))
    hasarListeCiz()
  }
  // Sorgu tarihi belgeden gelirse alana yaz (kullanıcı değiştirebilir)
  if (a.sorguTarihi) document.getElementById('t_tarih').value = a.sorguTarihi

  // Şasi doğrulaması — belge bu araca mı ait? (girilen şasi ile son 4 hane)
  const dg = aracDogrula(a, { sasi_no: document.getElementById('f_sasi').value.trim() })

  const rozet = kaynak === 'PDF_METIN'
    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">PDF metni — birebir</span>`
    : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">OCR — kontrol et</span>`
  const satirlar = [`<div class="flex flex-wrap items-center gap-1.5 justify-center">${rozet}<span class="font-bold">${a.kayitlar.length}</span> hasar okundu — aşağıdan düzeltebilirsin.</div>`]
  if (!a.kayitlar.length) satirlar[0] = `<div class="flex flex-wrap items-center gap-1.5 justify-center">${rozet}<span class="text-amber-700 font-bold">Hasar satırı okunamadı — elle ekle.</span></div>`
  if (dg.durum === 'UYUSMUYOR') satirlar.push(`<div class="mt-1 bg-error-container text-on-error-container rounded px-2 py-1 font-bold">⚠ ${kacis(dg.mesaj)}</div>`)
  else if (dg.durum === 'UYUYOR') satirlar.push(`<div class="mt-1 text-[#1a7a3d]">✓ ${kacis(dg.mesaj)}</div>`)
  if (a.uyarilar.length) satirlar.push(`<div class="mt-1 text-amber-700">${a.uyarilar.map(u => kacis(u)).join('<br>')}</div>`)
  ozetEl.innerHTML = satirlar.join('')
}

// ERP hasar detay sorgusu — yalnız SAKLANIR, okunmaz.
// ⚠️ Tramer görselinden farklı: onda OCR çalışıp hasar satırları çıkarılıyor.
//   Burada belge biçimi standart değil; yanlış okuyup hasar uydurmaktansa
//   hiç okumamak doğru. Danışman araç kartında belgeyi kendi görür.
function tramerDetayIsle(f) {
  if (!f) return
  tramerDetayFile = f
  const oz = document.getElementById('tramerDetayOzet'); if (!oz) return
  oz.innerHTML = `<span class="text-[#1a7a3d] font-bold">${mat('check_circle', 'text-[13px] align-middle')} ${kacis(f.name)}</span>
    <br><span class="text-on-surface-variant">Kaydedince araç kartında tramer belgesinin yanında görünecek.</span>`
}

// Ruhsat: sürükle-bırak/seç → İKİ AYRI OKUMA, ikisi de otomatik.
//   1) QR  — plaka · belge seri no · sahibin TCKN/VKN'si. KESİN.
//   2) OCR — basılı metinden şasi · motor no · marka · model yılı · yakıt ·
//            renk · muayene. TAHMİN; gerçek ruhsat çıktısıyla doğrulandı.
// ⚠️ Marka/model/şasi QR'DA YOK (2333 gerçek ruhsatta ölçüldü) — onlar yalnız
//   OCR'dan gelir ve YALNIZ BOŞ alana yazılır; elle veya TSB ile girileni ezmez.
function ruhsatYukle(e) { ruhsatIsle(e.target.files[0]) }

async function ruhsatIsle(f) {
  if (!f) return
  ruhsatFile = f
  const oz = document.getElementById('ruhsatOnizle')
  const gorselMi = !!(f.type && f.type.startsWith('image/'))
  const onizleme = gorselMi
    ? `<img src="${URL.createObjectURL(f)}" alt="ruhsat" class="mt-2 max-h-56 rounded-lg border border-outline-variant mx-auto" />`
    : `<div class="mt-2 text-[11px] text-on-surface-variant text-center">${kacis(f.name)}</div>`
  oz.innerHTML = onizleme +
    `<div id="ruhsatQrDurum" class="text-[11px] text-on-surface-variant text-center mt-1">QR okunuyor…</div>` +
    `<div id="ruhsatOcrDurum" class="text-[11px] text-on-surface-variant mt-1"></div>`

  const { ruhsatQrOku, plakaKarsilastir } = await import('./ruhsat-qr.js')
  const r = await ruhsatQrOku(f)
  const durum = document.getElementById('ruhsatQrDurum')
  if (!durum) return

  if (!r.ok) {
    durum.innerHTML = `<span class="text-amber-700">${kacis(r.hata || 'QR okunamadı')} — plaka/seri no elle girilecek.</span>
      <br><span class="text-on-surface-variant">Ruhsatı düz ve parlamasız çekersen okuma şansı artar.</span>`
  } else {
    const satirlar = []
    // Plaka: boşsa doldur, doluysa KARŞILAŞTIR (elle gireni ezme)
    const plakaEl = document.getElementById('f_plaka')
    if (!plakaEl.value.trim()) { plakaEl.value = r.plaka; satirlar.push('Plaka dolduruldu') }
    else {
      const k = plakaKarsilastir(r.plaka, plakaEl.value)
      if (k.durum === 'UYUSMUYOR') satirlar.push(`<span class="text-error font-bold">⚠ ${kacis(k.mesaj)}</span>`)
      else if (k.durum === 'UYUYOR') satirlar.push(`<span class="text-[#1a7a3d]">✓ ${kacis(k.mesaj)}</span>`)
    }
    // Belge seri no
    const seriEl = document.getElementById('f_ruhsat')
    if (seriEl && !seriEl.value.trim()) { seriEl.value = r.seri; satirlar.push('Belge seri no dolduruldu') }

    durum.innerHTML = `<span class="text-[#1a7a3d] font-bold">QR okundu</span> · ${kacis(r.plaka)} · Seri ${kacis(r.seri)}
      <br>${satirlar.join(' · ')}`
    guncelle()

    // Sahibi TCKN/VKN ile bul — varsa seç, yoksa yeni müşteri formuna yaz.
    await ruhsatSahibiEsle(r, durum)
  }

  // ⚠️ QR okunamasa BİLE OCR denenir — basılı metin ayrı bir kaynak.
  await ruhsatOcrIsle(f, r)
}

// --- Ruhsat basılı metni (OCR) → form alanları ---------------------------
// Göksenil'in onayladığı alanlar (gerçek Citroën C4 ruhsat çıktısında 9/9):
//   şasi · motor no · marka · model yılı · yakıt · renk · muayene tarihi
// Onaylanmayanlar (tip · cinsi · adres · ticari ad) BİLEREK bağlanmadı —
// gürültülü belgede yanlış değer üretiyorlar.
const RUHSAT_HEDEF = [
  { anahtar: 'sasi',       id: 'f_sasi',    ad: 'Şasi no' },
  { anahtar: 'motor_no',   id: 'f_motor',   ad: 'Motor no' },
  { anahtar: 'model_yili', id: 'f_yil',     ad: 'Model yılı' },
  { anahtar: 'yakit',      id: 'f_yakit',   ad: 'Yakıt' },
  { anahtar: 'renk',       id: 'f_renk',    ad: 'Renk' },
  { anahtar: 'muayene',    id: 'f_muayene', ad: 'Muayene', cevir: true },
  // ruhsat-ocr.js bu iki alanı okuyor ama hedefi yoktu → değer atılıyordu.
  { anahtar: 'tescil_tarihi', id: 'f_tescil',    ad: 'Tescil tarihi',     cevir: true },
  { anahtar: 'ilk_tescil',    id: 'f_ilktescil', ad: 'İlk tescil tarihi', cevir: true },
]

async function ruhsatOcrIsle(f, qr) {
  const kutu = document.getElementById('ruhsatOcrDurum')
  if (!kutu) return
  kutu.innerHTML = '<span class="text-on-surface-variant">Basılı bilgiler okunuyor (OCR)…</span>'

  let satirlar = []
  try {
    const s = await belgeSatirlari(f, p => {
      kutu.innerHTML = `<span class="text-on-surface-variant">Basılı bilgiler okunuyor… %${Math.round(p * 100)}</span>`
    })
    satirlar = s.satirlar || []
  } catch (e) {
    console.error('[ruhsat] OCR hata', e)
    kutu.innerHTML = `<span class="text-amber-700">Basılı metin okunamadı (${kacis(e.message)}) — araç bilgilerini elle gir.</span>`
    return
  }

  const { ruhsatAlanCikar, tarihISO } = await import('./ruhsat-ocr.js')
  const alanlar = ruhsatAlanCikar(satirlar, qr && qr.ok ? qr : null)
  console.debug('[ruhsat-ocr] okunan alanlar', alanlar)

  const doldu = [], atlandi = []
  for (const h of RUHSAT_HEDEF) {
    const ham = alanlar[h.anahtar]?.deger
    if (!ham) continue
    const deger = h.cevir ? tarihISO(ham) : ham
    if (!deger) continue
    const s = alanYaz(h.id, deger)
    if (s === 'doldu') doldu.push(`${h.ad}: <b>${kacis(deger)}</b>`)
    else if (s === 'dolu') atlandi.push(`${h.ad} (zaten dolu)`)
    else if (s === 'listede-yok') atlandi.push(`${h.ad} "${kacis(deger)}" listede yok`)
  }

  // Marka ayrı ele alınıyor: TSB kodunu da doldurmayı deniyor.
  const markaRapor = await ruhsatMarkaIsle(alanlar.marka?.deger)
  guncelle()

  const parcalar = []
  if (doldu.length) parcalar.push(`<span class="text-[#1a7a3d] font-bold">OCR dolduruldu</span> · ${doldu.join(' · ')}`)
  if (markaRapor) parcalar.push(markaRapor)
  if (atlandi.length) parcalar.push(`<span class="text-on-surface-variant">Atlanan: ${atlandi.join(' · ')}</span>`)
  if (!parcalar.length) parcalar.push('<span class="text-amber-700">Basılı metinden kullanılabilir bilgi çıkmadı — elle gir.</span>')
  parcalar.push('<span class="text-on-surface-variant">OCR tahmindir; kaydetmeden önce kontrol et.</span>')
  kutu.innerHTML = parcalar.join('<br>')
}

// Yalnız BOŞ alana yazar. Dönen: 'doldu' | 'dolu' | 'listede-yok' | 'yok'
function alanYaz(id, deger) {
  const el = document.getElementById(id)
  if (!el) return 'yok'
  if (String(el.value || '').trim()) return 'dolu'
  if (el.tagName === 'SELECT') {
    // Model Yılı listesi TSB'den gelir; OCR'ın yılı listede yoksa listeyi tazele.
    if (id === 'f_yil' && ![...el.options].some(o => o.value === deger)) yilDoldur(varsayilanYillar(), deger)
    if (![...el.options].some(o => o.value === deger)) return 'listede-yok'
  }
  el.value = deger
  return 'doldu'
}

// --- Marka adı → TSB marka kodu -----------------------------------------
// Göksenil kuralı: "marka yazdığında tsb marka kodu otomatik dolabilir,
// biz sadece tip kodunu gireriz."
// ⚠️ Eşleşme HER ZAMAN tek değil (RENAULT=123 · RENAULT (OYAK)=122).
//   Tek kod çıkarsa doldurulur; birden çok çıkarsa SEÇTİRİLİR, tahmin edilmez.
let tsbMarkaOnbellek = null
async function tsbMarkaListesi() {
  if (tsbMarkaOnbellek) return tsbMarkaOnbellek
  const { data, error } = await supabase.from('v_tsb_markalar').select('marka_kodu, marka, adet').limit(1000)
  if (error) { dbHata('tsb marka listesi', error); return [] }
  tsbMarkaOnbellek = data || []
  return tsbMarkaOnbellek
}

// Türkçe harfleri ASCII'ye indir + noktalama at: "CİTROEN" ve "CITROEN" eşit olsun.
function markaAnahtar(s) {
  return String(s || '')
    .replace(/[İIıi]/g, 'I').replace(/[Şş]/g, 'S').replace(/[Ğğ]/g, 'G')
    .replace(/[Üü]/g, 'U').replace(/[Öö]/g, 'O').replace(/[Çç]/g, 'C')
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function ruhsatMarkaIsle(markaAdi) {
  if (!markaAdi) return ''
  const markaEl = document.getElementById('f_marka')
  const kodEl = document.getElementById('f_tsbmarka')
  const liste = await tsbMarkaListesi()
  const q = markaAnahtar(markaAdi)

  let adaylar = liste.filter(m => markaAnahtar(m.marka) === q)
  if (!adaylar.length) {
    // "MERCEDES-BENZ" → "MERCEDES" gibi ön ek eşleşmesi (yaygın araçlar önce)
    adaylar = liste.filter(m => {
      const a = markaAnahtar(m.marka)
      return a.length >= 3 && (a.startsWith(q) || q.startsWith(a))
    }).sort((a, b) => b.adet - a.adet)
  }
  const kodlar = [...new Set(adaylar.map(m => m.marka_kodu))]

  if (!adaylar.length) {
    if (markaEl && !markaEl.value.trim()) markaEl.value = markaAdi
    return `<span class="text-amber-700">Marka <b>${kacis(markaAdi)}</b> okundu ama TSB listesinde bulunamadı — kodu elle gir.</span>`
  }
  if (kodlar.length === 1) {
    const s = adaylar[0]
    // TSB'nin yazımı OCR'ınkinden güvenilir ("CİTROEN" → "CITROEN")
    if (markaEl && !markaEl.value.trim()) markaEl.value = s.marka
    if (kodEl && !kodEl.value.trim()) {
      kodEl.value = s.marka_kodu
      return `<span class="text-[#1a7a3d] font-bold">TSB marka kodu bulundu</span> · ${kacis(s.marka)} → <b>${kacis(s.marka_kodu)}</b> · <span class="text-on-surface-variant">şimdi Tip Kodu'nu gir ve TSB Auto Fill'e bas.</span>`
    }
    return `<span class="text-on-surface-variant">Marka ${kacis(s.marka)} okundu (TSB kodu zaten dolu).</span>`
  }

  // Birden çok kod → kullanıcı seçsin
  if (markaEl && !markaEl.value.trim()) markaEl.value = markaAdi
  const dugmeler = adaylar.slice(0, 6).map(m =>
    `<button type="button" class="ruhsat-marka px-2 py-0.5 rounded border border-primary/30 text-primary text-[11px] font-bold hover:bg-primary/10"
       data-kod="${kacis(m.marka_kodu)}" data-ad="${kacis(m.marka)}">${kacis(m.marka)} · ${kacis(m.marka_kodu)}</button>`).join(' ')
  setTimeout(() => document.querySelectorAll('.ruhsat-marka').forEach(b => b.addEventListener('click', () => {
    document.getElementById('f_tsbmarka').value = b.dataset.kod
    document.getElementById('f_marka').value = b.dataset.ad
    guncelle()
  })), 0)
  return `<span class="text-amber-700 font-bold">Marka "${kacis(markaAdi)}" için birden çok TSB kodu var</span> — doğrusunu seç:<br>${dugmeler}`
}

// ⚠️ TCKN/VKN musteri_kimlik tablosunda (RLS KOLON GİZLEYEMEZ, o yüzden ayrı
// tabloda tutuluyor — CLAUDE.md §9). Buradan yalnız EŞLEŞTİRME için okunuyor.
async function ruhsatSahibiEsle(r, durum) {
  const { data: kim, error } = await supabase.from('musteri_kimlik')
    .select('musteri_id').eq('tckn_vergi_no', r.kimlik).limit(1)
  if (error) { dbHata('ruhsat kimlik eşleştirme', error); return }

  if (kim && kim.length) {
    const { data: m, error: me } = await supabase.from('musteriler')
      .select('id, ad_soyad, telefon, tip, kaynak').eq('id', kim[0].musteri_id).maybeSingle()
    if (me) { dbHata('ruhsat müşteri oku', me); return }
    if (m) {
      satici = m
      document.getElementById('msSecili').innerHTML = `<div class="flex items-center gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/10 mt-1">${mat('check_circle', 'text-primary')}<b>${kacis(buyuk(m.ad_soyad))}</b> · ${kacis(telBicim(m.telefon))} <span class="text-[10px] text-primary font-bold">RUHSATTAN</span> <button id="msKaldir" class="ml-auto text-error text-xs font-bold">kaldır</button></div>`
      document.getElementById('msForm').classList.add('hidden')
      document.getElementById('msKaldir').onclick = () => { satici = null; document.getElementById('msSecili').innerHTML = ''; guncelle() }
      durum.innerHTML += `<br><span class="text-[#1a7a3d]">✓ Sahibi bulundu: <b>${kacis(buyuk(m.ad_soyad))}</b> (${r.kimlikTipi})</span>`
      guncelle()
      return
    }
  }
  // Kayıt yok → yeni müşteri formunu aç ve kimlik alanını doldur
  const tcknEl = document.getElementById('ms_tckn')
  if (tcknEl && !tcknEl.value.trim()) {
    document.getElementById('msForm').classList.remove('hidden')
    tcknEl.value = r.kimlik
    durum.innerHTML += `<br><span class="text-amber-700">Bu ${r.kimlikTipi} ile kayıtlı müşteri yok — yeni müşteri formuna yazıldı, ad/telefon gir.</span>`
    guncelle()
  }
}

// =====================================================================
// GEÇMİŞ SATIŞ → ARAÇ KABUL OTOMATİK DOLDURMA
//
// Göksenil (7 Ağu 2026): "eğer aracı önceden sattıysak araç bilgileri
//   şasi - motor - tip versiyon ve kullanıma bağlı olmayan tüm kayıtları
//   otomatik doldurur, ben tekrar veri girmek zorunda kalmam. müşteri
//   bilgisini varsayılan olarak sattığımız kişiyi getirir."
//   Karar: "şerit gösterip sorsun."
//
// ⚠️ SESSİZ DOLDURMA YOK. Şerit çıkar, kullanıcı düğmeye basar. Sessiz
//    doldurma o an elle yazılmakta olan veriyi ezer ve kullanıcı ne
//    olduğunu anlamaz.
// ⚠️ DOLU ALAN EZİLMEZ — düğmeye basılsa bile yalnız BOŞ alanlar dolar.
// ⚠️ KULLANIMA BAĞLI ALANLAR DOLDURULMAZ: km, muayene, tescil tarihleri,
//    ruhsat seri no, plaka, lokasyon, park, alış şekli. Araç aradan
//    geçen sürede yol yapmış, muayeneye girmiş, plakası değişmiş olabilir;
//    eski değeri basmak YANLIŞ VERİ üretir.
// =====================================================================
const KUNYE_SADE = s => trBuyuk(s || '').replace(/[^A-Z0-9]/g, '')
let GECMIS = null, gecmisZaman = null, gecmisAnahtar = ''

function gecmisTaramaGecikmeli() {
  clearTimeout(gecmisZaman)
  gecmisZaman = setTimeout(gecmisTara, 600)
}

// =====================================================================
// PLAKA MÜKERRER KONTROLÜ — aynı araç iki kez kaydedilmesin
//
// Göksenil (10 Ağu 2026): "plaka kontrolünde herhangi bir sorgu olmadığı
//   için iki sefer kaydedilebilir olmuş, bunu istemiyorum. plaka yazarken
//   CANLI uyaracak."
// Canlıda ölçüldü: 35CLM042 iki ayrı kayıt (KULLANIMDA + ALINDI).
//
// KURAL: araç HÂLÂ BİZDEYSE uyarır ve kaydı engeller. Kapanmış durumlar
//   (TESLIM_EDILDI · SATIS_DISI) uyarı vermez — o araç artık bizde değil,
//   aynı plakalı araç yıllar sonra tekrar alınabilir (geri alım normal).
//
// ⚠️ ARAC_AKTIF_DURUMLAR KULLANILMAZ. O liste gruplardan türetiliyor ve
//    `KULLANIMDA` hiçbir grupta YOK — onunla baksaydık mevcut mükerrerin
//    (35CLM042) KULLANIMDA ayağı kaçardı. Kapanış grubunu DIŞLAMAK doğru
//    kural: geriye 18 durumun hepsi kalır, KULLANIMDA dahil.
// ⚠️ Sorgu plaka_norm ÜZERİNDEN ve TAM eşleşme. ilike '%…%' kısmi eşleşme
//    yapıp "34ABC12" yazarken "34ABC123"ü yakalar, yanlış alarm üretirdi.
// =====================================================================
let MUKERRER = null, mukerrerZaman = null, mukerrerAnahtar = ''

function mukerrerTaramaGecikmeli() {
  clearTimeout(mukerrerZaman)
  mukerrerZaman = setTimeout(mukerrerTara, 450)
}

async function mukerrerTara() {
  const serit = document.getElementById('mukerrerSerit'); if (!serit) return
  const plakasiz = !!document.getElementById('f_plakasiz')?.checked
  const temizle = () => { serit.classList.add('hidden'); serit.innerHTML = ''; MUKERRER = null }

  // ⚠️ Plakasız araçta `plaka_norm` NULL'dır (üretilmiş kolon, sql/169) —
  //    o yoldan tarama HİÇBİR ŞEY bulmaz. Kimlik stok_kodu, tarama da onun
  //    üzerinden yapılır; benzersizliği sql/188 index'i garanti eder.
  const anahtar = plakasiz
    ? trBuyuk(document.getElementById('f_stokkodu')?.value || '').trim()
    : KUNYE_SADE(document.getElementById('f_plaka')?.value)

  // Kısmi yazımda alarm vermemek için: plaka en az 6 hane (34ABC12 = 7),
  // stok kodu en az 3.
  if (anahtar.length < (plakasiz ? 3 : 6)) { mukerrerAnahtar = ''; temizle(); guncelle(); return }
  if (anahtar === mukerrerAnahtar) return
  mukerrerAnahtar = anahtar

  // ⚠️ Düzenleme modunda KENDİ kaydı hariç tutulur; yoksa araç kendi
  //    plakasıyla "mükerrer" sayılır ve kayıt kilitlenir.
  let q = supabase.from('stok_araclar')
    .select('id, plaka, stok_kodu, durum, marka, model, yil, created_at')
    .not('durum', 'in', `(${ARAC_DURUM_GRUP.KAPANIS.join(',')})`)
  q = plakasiz ? q.ilike('stok_kodu', anahtar) : q.eq('plaka_norm', anahtar)
  if (DUZENLE_ID) q = q.neq('id', DUZENLE_ID)
  const { data, error } = await q.limit(3)
  if (error) { dbHata('plaka mükerrer kontrol', error); return }
  if (!data || !data.length) { temizle(); guncelle(); return }

  MUKERRER = data[0]
  mukerrerSeritCiz(serit, data)
  guncelle()
}

function mukerrerSeritCiz(serit, kayitlar) {
  const s = kayitlar[0]
  const kunye = [s.yil, buyuk(s.marka), buyuk(s.model)].filter(Boolean).join(' ')
  const tarih = s.created_at ? new Date(s.created_at).toLocaleDateString('tr-TR') : ''
  serit.className = 'mt-4 p-4 rounded-xl bg-error-container/30 border-2 border-error'
  serit.innerHTML = `
    <div class="flex items-start gap-3">
      ${mat('error', 'text-[20px] text-error shrink-0')}
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-black text-error">${s.plaka ? 'BU PLAKA' : 'BU STOK KODU'} SİSTEMDE ZATEN VAR</div>
        <div class="text-[12px] text-error mt-0.5">
          <b>${kacis(aracEtiket(s))}</b>${kunye ? ' · ' + kacis(kunye) : ''} —
          durumu <b>${kacis(aracDurumEtiket(s.durum))}</b>${tarih ? ` · ${tarih} tarihinde kaydedilmiş` : ''}.
          ${kayitlar.length > 1 ? `<br><b>${kayitlar.length}</b> ayrı kayıt bulundu.` : ''}
        </div>
        <div class="text-[11px] text-error mt-1">
          Araç hâlâ elimizde göründüğü için <b>yeni kayıt açılamaz</b>.
          Aynı aracı ikinci kez kaydetmek stok sayısını, maliyeti ve raporları bozar.
          Mevcut kaydı açıp güncelleyin.
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-2.5">
          <a href="arac-kart.html?id=${encodeURIComponent(s.id)}" class="bg-error text-on-error px-4 h-9 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center gap-1">
            ${mat('open_in_new', 'text-[16px]')} Mevcut Kaydı Aç</a>
        </div>
      </div>
    </div>`
  serit.classList.remove('hidden')
}

async function gecmisTara() {
  const serit = document.getElementById('gecmisSerit'); if (!serit) return
  const sasi = KUNYE_SADE(document.getElementById('f_sasi')?.value)
  const plaka = KUNYE_SADE(document.getElementById('f_plaka')?.value)
  // Şasi 17 hane; kısmi yazımda yanlış eşleşmemek için en az 8 hane iste.
  const anahtar = sasi.length >= 8 ? 'S:' + sasi : (plaka.length >= 6 ? 'P:' + plaka : '')
  if (!anahtar) { serit.classList.add('hidden'); serit.innerHTML = ''; GECMIS = null; gecmisAnahtar = ''; return }
  if (anahtar === gecmisAnahtar) return          // aynı değer için tekrar sorgulama
  gecmisAnahtar = anahtar

  const kosul = anahtar.startsWith('S:')
    ? `sasi_no.ilike.%${sasi}%`
    : `plaka_norm.ilike.%${plaka}%,plaka.ilike.%${plaka}%`
  const { data, error } = await supabase.from('arsiv_satislar')
    .select(`sasi_no, plaka, marka, model, versiyon, model_yili, tsb_marka_kodu, tsb_tip_kodu,
             yakit, vites, kasa_tipi, renk, yedek_anahtar, noter_satis_tarihi,
             alici_ad, alici_telefon, alici_musteri_id`)
    .or(kosul).order('noter_satis_tarihi', { ascending: false, nullsFirst: false }).limit(1)
  if (error) { dbHata('geçmiş satış tarama', error); return }
  if (!data || !data.length) { serit.classList.add('hidden'); serit.innerHTML = ''; GECMIS = null; return }

  GECMIS = data[0]
  gecmisSeritCiz(serit, GECMIS)
}

function gecmisSeritCiz(serit, s) {
  const tarih = s.noter_satis_tarihi ? new Date(s.noter_satis_tarihi).toLocaleDateString('tr-TR') : 'tarihi bilinmiyor'
  const kunye = [s.model_yili, buyuk(s.marka), buyuk(s.model)].filter(Boolean).join(' ')
  serit.className = 'mt-4 p-4 rounded-xl bg-amber-50 border border-amber-300'
  serit.innerHTML = `
    <div class="flex items-start gap-3">
      ${mat('history', 'text-[20px] text-amber-700 shrink-0')}
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-bold text-amber-900">Bu aracı daha önce biz satmışız</div>
        <div class="text-[12px] text-amber-800 mt-0.5">
          ${kacis(buyuk(s.plaka) || '—')} · ${kacis(kunye) || 'künye yok'} ·
          <b>${tarih}</b> tarihinde <b>${kacis(buyuk(s.alici_ad) || 'alıcı kayıtsız')}</b>'a satılmış.
        </div>
        <div class="text-[11px] text-amber-700 mt-1">
          Araç bilgileri ve satıcı olarak bu kişi doldurulsun mu?
          Kilometre, muayene, tescil ve plaka <b>doldurulmaz</b> — araç o günden beri değişmiş olabilir.
          Dolu alanlara dokunulmaz.
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-2.5">
          <button id="gecmisDoldur" class="bg-amber-700 text-white px-4 h-9 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center gap-1">
            ${mat('auto_fix_high', 'text-[16px]')} Bilgileri Doldur</button>
          <button id="gecmisKapat" class="px-3 h-9 rounded-lg border border-amber-300 text-amber-800 text-[12px] font-bold hover:bg-amber-100">Kapat</button>
        </div>
      </div>
    </div>`
  serit.classList.remove('hidden')
  serit.querySelector('#gecmisKapat').addEventListener('click', () => { serit.classList.add('hidden'); serit.innerHTML = '' })
  serit.querySelector('#gecmisDoldur').addEventListener('click', () => gecmisUygula(serit))
}

// Metin alanı — YALNIZ boşsa yazar.
function bosaYaz(id, deger, sayac) {
  const el = document.getElementById(id)
  if (!el || !deger || String(el.value || '').trim()) return
  el.value = String(deger); sayac.push(id)
}
// <select> — kod ya da GÖRÜNEN AD ile eşleştir. Arşiv serbest metin tutuyor
// ("Benzin", "HATCHBACK 5 KAPI"); tanımlar kod tutuyor. Eşleşme yoksa
// alan BOŞ BIRAKILIR — yanlış seçenek işaretlemek sessiz hatadır.
function seceneginiSec(id, deger, sayac) {
  const el = document.getElementById(id)
  if (!el || !deger || el.value) return
  const hedef = trBuyuk(String(deger))
  const op = [...el.options].find(o => o.value && (trBuyuk(o.value) === hedef || trBuyuk(o.textContent) === hedef))
  if (op) { el.value = op.value; sayac.push(id) }
}

async function gecmisUygula(serit) {
  const s = GECMIS; if (!s) return
  const yazilan = []
  bosaYaz('f_sasi', s.sasi_no, yazilan)
  bosaYaz('f_marka', s.marka, yazilan)
  bosaYaz('f_model', s.model, yazilan)
  bosaYaz('f_versiyon', s.versiyon, yazilan)
  bosaYaz('f_tsbmarka', s.tsb_marka_kodu, yazilan)
  bosaYaz('f_tsbtip', s.tsb_tip_kodu, yazilan)
  seceneginiSec('f_yil', s.model_yili, yazilan)
  seceneginiSec('f_yakit', s.yakit, yazilan)
  seceneginiSec('f_vites', s.vites, yazilan)
  seceneginiSec('f_kasa', s.kasa_tipi, yazilan)
  seceneginiSec('f_renk', s.renk, yazilan)
  // Yedek anahtar kullanıma bağlı DEĞİL ama zamanla kaybolabilir; yalnız
  // "vardı" bilgisini işaretliyoruz, kullanıcı görüp kaldırabilir.
  const anh = document.getElementById('f_anahtar')
  if (anh && s.yedek_anahtar && !anh.checked) { anh.checked = true; yazilan.push('f_anahtar') }

  const musteriNot = await gecmisMusteriSec(s)
  guncelle()

  serit.className = 'mt-4 p-4 rounded-xl bg-[#ECFDF5] border border-[#10B981]/40'
  serit.innerHTML = `<div class="flex items-start gap-3">
    ${mat('check_circle', 'text-[20px] text-[#047857] shrink-0')}
    <div class="text-[12px] text-[#065F46]">
      <b>${yazilan.length} alan dolduruldu.</b> ${musteriNot}
      <div class="text-[11px] mt-1">Kilometre, muayene, tescil, ruhsat seri no ve plaka bilerek boş bırakıldı — bunları güncel belgeye göre gir.</div>
    </div></div>`
}

// Sattığımız kişiyi SATICI olarak seç. Müşteri kaydı varsa doğrudan seçilir;
// yoksa yeni müşteri formu ad/telefonla ön doldurulur.
// ⚠️ Araç aradan başkasına satılmış olabilir — bu yüzden seçim KALDIRILABİLİR
//    ve yeni müşteri aranabilir (Göksenil'in şartı).
async function gecmisMusteriSec(s) {
  if (satici) return 'Satıcı zaten seçili, dokunulmadı.'
  if (s.alici_musteri_id) {
    const { data: m, error } = await supabase.from('musteriler')
      .select('id, ad_soyad, telefon, tip, kaynak').eq('id', s.alici_musteri_id).maybeSingle()
    if (error) dbHata('geçmiş alıcı oku', error)
    if (m) {
      satici = m
      document.getElementById('msSecili').innerHTML = `<div class="flex items-center gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/10 mt-1">${mat('check_circle', 'text-primary')}<b>${kacis(buyuk(m.ad_soyad))}</b> · ${kacis(telBicim(m.telefon))} <span class="text-[10px] text-primary font-bold">ÖNCEKİ ALICI</span> <button id="msKaldir" class="ml-auto text-error text-xs font-bold">kaldır</button></div>`
      document.getElementById('msForm').classList.add('hidden')
      document.getElementById('msKaldir').onclick = () => { satici = null; document.getElementById('msSecili').innerHTML = ''; guncelle() }
      return `Satıcı olarak <b>${kacis(buyuk(m.ad_soyad))}</b> seçildi — araç başkasına geçtiyse “kaldır” deyip değiştir.`
    }
  }
  // Müşteri kaydı yok → yeni müşteri formunu ad/telefonla aç.
  if (s.alici_ad) {
    document.getElementById('msForm')?.classList.remove('hidden')
    const y = []
    bosaYaz('ms_ad', buyuk(s.alici_ad), y)
    bosaYaz('ms_tel', s.alici_telefon, y)
    return y.length ? 'Önceki alıcı yeni müşteri formuna yazıldı — kontrol et.' : ''
  }
  return ''
}

// --- Evrak → Supabase Storage (arac-evrak bucket). Görseller WebP'ye çevrilir. ---
// webpCevir + evrak yükleme → arac-dosya.js (tek kaynak, 7 Ağu 2026).
// Buradaki webpCevir, arac-detay.js'tekinin birebir kopyasıydı.
// ⚠️ DOSYA YOKSA {ok:true} — wizard dört evrağı birden gönderir, çoğu
//    opsiyoneldir; "seçilmedi" bir hata DEĞİLDİR.
async function evrakKaydet(aracId, file, tip) {
  if (!file) return { ok: true }
  return await evrakiYukle({ aracId, tip, dosya: file })
}

async function tsbGetir() {
  const mkInput = document.getElementById('f_tsbmarka')
  const ham = mkInput.value.trim()
  const tk = document.getElementById('f_tsbtip').value.trim()
  return tsbGetirDevam(mkInput, ham, tk)
}

// ---------- PAKETTEN TİP KODU BULMA (sql/209) ----------
// Göksenil, 15 Ağu 2026: "ihaleden araç aldığımda paketine kasko değer
// listesinden bakmam gerekiyor, bunu pratik hâle getirelim."
//
// Marka kodu zaten otomatik geliyor; eksik olan TİP kodu. Burada arabam.com
// ilan başlığı yapıştırılır, sunucu benzerliğe göre adayları sıralar.
//
// ⚠️ OTOMATİK SEÇİM YOK (Göksenil kararı). Ölçümde doğru paket 8/8 birinci
//    çıktı ama ikinciyle fark ince olabiliyor (Focus: 0,738'e karşı 0,714).
//    Yanlış tip kodu = yanlış kasko değeri; kullanıcı tıklayarak onaylar.
// ⚠️ Marka ADIYLA değil KODUYLA aranır. TSB'de Fiat Egea "FIAT" altında
//    değil "TOFAS-FIAT" (kod 100) altında — ada göre arama Egea'yı hiç
//    bulamıyor (denendi, 500L CROSS döndü).
// ⚠️ ARAMA MANTIĞI ARTIK tsb-paket.js'te (18 Ağu 2026). Fiyatlama ekranı da
//    aynı aramayı kullanıyor; ikinci kopya YAZILMADI (CLAUDE.md §4).
//    Burada kalan tek şey SİHİRBAZA ÖZGÜ olan: hangi form alanları okunur,
//    seçimden sonra ne olur (alanları doldur + Auto Fill).
const paketAraGecikmeli = gecikmeli(paketAra, 350)

async function paketAra() {
  const kap = document.getElementById('paketAdaylar')
  if (!kap) return
  const metin = (document.getElementById('f_paketara')?.value || '').trim()
  const marka = (document.getElementById('f_tsbmarka')?.value || '').trim()
  // Yıl: paket kutusundaki boşsa araç formundaki model yılını kullan
  const yil = (document.getElementById('f_paketyil')?.value || '').trim()
    || (document.getElementById('f_yil')?.value || '').trim()

  if (metin.length < 3) { kap.innerHTML = ''; return }
  kap.innerHTML = `<div class="text-[11px] text-on-surface-variant">Aranıyor…</div>`

  const sonuc = await tsbAdayAra({ metin, markaKodu: marka, yil })
  tsbAdaylariCiz(kap, sonuc, { yil, onSec: sec => {
    // İKİ ALAN BİRDEN dolar: marka kodu boşsa (ya da aday başka markadan
    // geldiyse) onu da yazarız, yoksa Auto Fill yanlış markada arar.
    document.getElementById('f_tsbmarka').value = sec.marka_kodu
    document.getElementById('f_tsbtip').value = sec.tip_kodu
    kap.innerHTML = `<div class="text-[11px] text-[#1a7a3d] font-bold">Marka ${kacis(sec.marka_kodu)} · Tip ${kacis(sec.tip_kodu)} seçildi — araç bilgileri getiriliyor…</div>`
    // Kullanıcının bugün elle yaptığı adımın aynısı: kodlar dolunca Auto Fill.
    tsbGetir()
  } })
}

async function tsbGetirDevam(mkInput, ham, tk) {
  const sonuc = document.getElementById('tsbSonuc')
  if (!ham) { sonuc.textContent = 'TSB marka kodu gir.'; return }
  // Marka kodu DB'de 3 haneli baştan sıfırlı ('21' → '021'). Tip 3-5 hane, değişken.
  const mk = /^\d+$/.test(ham) ? ham.padStart(3, '0') : ham
  if (mk !== ham) mkInput.value = mk
  sonuc.textContent = 'Sorgulanıyor…'
  // Kasko filtresi ARTIK sorguda değil (aracı elemesin) — yalnız yıl listesini süzer.
  const sorgu = async withTip => {
    let q = supabase.from('tsb_kasko_liste').select('marka, tip_adi, model_yili, kasko_degeri').eq('marka_kodu', mk)
    if (withTip && tk) q = q.eq('tip_kodu', tk)
    const { data, error } = await q.limit(1000)
    if (error) dbHata('tsb', error)
    return data || []
  }
  let data = await sorgu(true), tipVar = !!tk, uyari = ''
  if (!data.length && tk) { data = await sorgu(false); tipVar = false; if (data.length) uyari = 'Tip kodu eşleşmedi, marka kodundan getirildi. ' }
  if (!data.length) { sonuc.textContent = `TSB kaydı bulunamadı (marka ${mk}${tk ? ', tip ' + tk : ''}).`; return }
  document.getElementById('f_marka').value = data[0].marka || ''
  if (tipVar) {
    // tip_adi → model + versiyon: motor hacmi decimal'inde böl (1.6, 2,0) — model içindeki tam sayılar (8, 3) korunur
    const parts = (data[0].tip_adi || '').trim().split(/\s+/)
    let i = parts.findIndex(w => /^\d[.,]\d/.test(w)); if (i < 1) i = 1
    document.getElementById('f_model').value = parts.slice(0, i).join(' ')
    document.getElementById('f_versiyon').value = parts.slice(i).join(' ')
    await ozellikDoldur(data[0].tip_adi)   // yakıt/vites/kasa (VERSIYON-CHECK)
  }
  // Yıllar: önce kasko değeri > 0 olanlar; yoksa tüm yıllar (araç yine de bulundu)
  // Model Yılı = o modelin TSB üretim yılları (kutunun altına yazma). TSB'de yıl
  // yoksa (eski/kapsam dışı) tam aralık kalır → eski araçlar yine girilebilir.
  const yillar = [...new Set(data.map(d => d.model_yili).filter(Boolean))].sort((a, b) => b - a)
  yilDoldur(yillar.length ? yillar : varsayilanYillar())
  sonuc.innerHTML = kacis(uyari) + `${kacis(data[0].marka)}${tipVar ? ' · ' + kacis(data[0].tip_adi) : ''} ✓`
  guncelle()
}

// Versiyon (tip_adi) → yakıt/vites/kasa otomatik doldur (tsb_versiyon_ozellik).
// Anahtar normalizasyonu seed ile birebir (trBuyuk + trim + tek boşluk).
async function ozellikDoldur(tipAdi) {
  const key = trBuyuk(tipAdi || '').trim().replace(/\s+/g, ' ')
  if (!key) return
  // arac_tipi de öğrenilir (sql/183) — Göksenil 11 Ağu 2026'da dört alanı
  // birlikte saydı, tabloda yalnız üçü vardı.
  const { data, error } = await supabase.from('tsb_versiyon_ozellik').select('yakit, vites, kasa, arac_tipi').eq('tip_adi_key', key).limit(1)
  if (error) { dbHata('versiyon ozellik', error); return }
  const o = (data || [])[0]; if (!o) return
  // ⚠️ Yalnız BOŞ alan doldurulur — elle girilen değer EZİLMEZ.
  const setIf = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value) el.value = val }
  setIf('f_yakit', o.yakit); setIf('f_vites', o.vites); setIf('f_kasa', o.kasa); setIf('f_arac_tipi', o.arac_tipi)
  guncelle()
}

// Müşteri kaynağı Arabam.com ise Alış Şekli'ni otomatik seç (kullanıcı kuralı).
// Elle seçilmiş bir alış şeklini EZMEZ — yalnız boşsa doldurur.
function kaynakUygula(kaynak) {
  if (!kaynak || !/ARABAM/i.test(String(kaynak))) return
  const el = document.getElementById('f_alis_sekli'); if (!el || el.value) return
  el.value = 'ARABAM_COM'
  const ip = document.getElementById('alisIpucu')
  if (ip) ip.innerHTML = `<span class="text-primary font-bold">Müşteri kaynağı Arabam.com → Alış Şekli otomatik "Arabam.com" seçildi.</span> Gerekirse değiştir.`
}

let msZaman
function musteriAra(e) {
  clearTimeout(msZaman)
  const q = e.target.value.trim()
  const kutu = document.getElementById('msSonuc')
  if (q.length < 2) { kutu.innerHTML = ''; return }
  msZaman = setTimeout(async () => {
    // BİRLEŞİK ARAMA (musteri-sec.js): CRM + yalnız sigortada olanlar.
    const { musteriAra } = await import('./musteri-sec.js')
    const data = await musteriAra(q, 6)
    kutu.innerHTML = (data || []).length
      ? (data.map(m => `<button data-mid="${m.id}" class="ms-sec w-full text-left px-3 py-2 rounded-lg hover:bg-primary/5 flex items-center gap-2 border border-outline-variant/50 mb-1">
          <span class="w-7 h-7 rounded-full bg-primary-fixed text-primary text-[10px] flex items-center justify-center font-bold">${basHarf(m.ad_soyad)}</span>
          <span class="text-sm min-w-0 truncate flex-1"><b>${kacis(buyuk(m.ad_soyad))}</b>${m.telefon && m.telefon !== '-' ? ' · ' + kacis(telBicim(m.telefon)) : ''}</span>
          ${m.kaynak_modul === 'SIGORTA' ? '<span class="shrink-0 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">SİGORTA</span>' : ''}</button>`).join(''))
      : '<div class="text-[11px] text-on-surface-variant px-2 py-1">Kayıt yok — “Yeni Müşteri” ile ekle.</div>'
    kutu.querySelectorAll('.ms-sec').forEach(b => b.addEventListener('click', async () => {
      const secim = data.find(x => x.id === b.dataset.mid); if (!secim) return
      // Sigorta kaydıysa CRM'e aktarılır — ham sigorta id'si FK hatası verirdi
      const { musteriCoz } = await import('./musteri-sec.js')
      const m = await musteriCoz(secim, BEN)
      if (!m) { kutu.innerHTML = '<div class="text-[11px] text-error px-2 py-1">Müşteri hazırlanamadı.</div>'; return }
      satici = m
      document.getElementById('msSecili').innerHTML = `<div class="flex items-center gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/10 mt-1">${mat('check_circle', 'text-primary')}<b>${kacis(buyuk(m.ad_soyad))}</b> · ${kacis(telBicim(m.telefon))} <button id="msKaldir" class="ml-auto text-error text-xs font-bold">kaldır</button></div>`
      kutu.innerHTML = ''; document.getElementById('msAra').value = ''
      document.getElementById('msForm').classList.add('hidden')
      document.getElementById('msKaldir').onclick = () => { satici = null; document.getElementById('msSecili').innerHTML = ''; guncelle() }
      kaynakUygula(m.kaynak)
      guncelle()
    }))
  }, 250)
}

function hata(msg) { const h = document.getElementById('akHata'); h.textContent = msg; h.classList.remove('hidden'); h.scrollIntoView({ behavior: 'smooth', block: 'center' }) }

// Basit async onay modalı → Promise<boolean> (evet=true). Kabulde ekspertiz/
// tramer boşken "araç orijinal mi / tramer temiz mi" doğrulaması için.
function onaySor(baslik, mesaj, evetEtiket = 'Evet', hayirEtiket = 'Vazgeç') {
  return new Promise(resolve => {
    const ov = document.createElement('div')
    ov.className = 'fixed inset-0 z-[90] flex items-center justify-center p-4'
    ov.innerHTML = `<div class="absolute inset-0 bg-black/50" data-kapat></div>
      <div class="relative bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-3">
        <h3 class="font-bold text-primary flex items-center gap-2">${mat('help', 'text-[20px]')} ${kacis(baslik)}</h3>
        <p class="text-sm text-on-surface-variant leading-relaxed">${kacis(mesaj)}</p>
        <div class="flex justify-end gap-2 mt-1">
          <button data-hayir class="border border-outline-variant px-4 py-2 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container-low">${kacis(hayirEtiket)}</button>
          <button data-evet class="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90">${kacis(evetEtiket)}</button>
        </div>
      </div>`
    const kapat = v => { ov.remove(); document.removeEventListener('keydown', esc); resolve(v) }
    const esc = e => { if (e.key === 'Escape') kapat(false) }
    ov.querySelector('[data-evet]').addEventListener('click', () => kapat(true))
    ov.querySelector('[data-hayir]').addEventListener('click', () => kapat(false))
    ov.querySelector('[data-kapat]').addEventListener('click', () => kapat(false))
    document.addEventListener('keydown', esc)
    document.body.appendChild(ov)
  })
}

async function kaydet(gonder) {
  if (kaydediliyor) return                 // yeniden-giriş kilidi: çift kayıt engeli
  const g = id => document.getElementById(id).value.trim()
  // ⚠️ PLAKA NORMALLEŞTİRİLEREK KAYDEDİLİR — "35 ZZT 001" değil "35ZZT001".
  //    Faz 1 teslim testinde yakalandı: plaka yazıldığı gibi kaydediliyordu,
  //    boşluklu kayıt global aramada BULUNAMIYORDU. Ölçüm: canlıda boşluklu
  //    plaka 1 taneydi (test aracı) — yani herkes şimdiye kadar boşluksuz
  //    yazmış, kusur bu yüzden görünmemiş. Aynı uyuşmazlık mükerrer plaka
  //    kontrolünü ve talep-araç eşleştirmesini de etkiliyordu.
  //    Veritabanı tarafında `plaka_norm` üretilmiş kolonu aynı kuralı
  //    uygular (sql/169) — eski kayıtlar da aranabilir kalsın diye.
  // sql/188 · Plakasız varlık (karavan/römork/iş makinesi): kimlik stok kodu.
  const plakasiz = !!document.getElementById('f_plakasiz')?.checked
  const stokKodu = plakasiz ? trBuyuk(g('f_stokkodu')).trim() : ''
  const plaka = plakasiz ? null : plakaNormal(g('f_plaka'))
  const alisSekli = g('f_alis_sekli')
  if (plakasiz) {
    if (stokKodu.length < 3) return hata('Stok kodu zorunlu (en az 3 hane) — plakasız araç bu kodla anılır.')
  } else if (!plaka) return hata('Plaka zorunlu.')

  // FİYATLAMA KAPISI — buton zaten kilitli, bu SON kontrol (Göksenil, 10 Ağu
  // 2026: "4 madde tamam değilse fiyatlamaya gönderememeli"). Yalnız
  // "Kaydet ve Fiyatlamaya Gönder" yolunu bağlar; taslak kaydı serbest.
  if (gonder) {
    const eksik = []
    // Plakasız varlıkta VIN yoktur; şasi maddesi bu araçlar için aranmaz.
    if (!plakasiz && g('f_sasi').length !== 17) eksik.push('Şasi No (17 hane)')
    if (!(satici || g('ms_ad'))) eksik.push('Müşteri')
    if (!plakasiz && !(g('f_marka') && g('f_model'))) eksik.push('Marka/Model')
    if (eksik.length) {
      return hata('Fiyatlamaya gönderilemez — Sistem Doğrulaması eksik: ' + eksik.join(', ')
        + '. "Sadece Kaydet" ile taslak olarak saklayabilirsin.')
    }
  }

  // MÜKERRER KAPISI — arayüz zaten engelliyor, bu SON kontrol. Canlı tarama
  // gecikmeli (450 ms) çalışıyor; hızlı yapıştır + hemen Kaydet dizisinde
  // şerit henüz çizilmemiş olabilir. Burada SORGUYU TEKRARLAMAK gerekir,
  // MUKERRER değişkenine güvenmek o yarışı kaybeder.
  {
    // ⚠️ Plakasız araçta plaka_norm NULL — o kolondan aramak boş döner.
    //    Kimlik stok_kodu; benzersizliği ayrıca sql/188 index'i korur.
    let mq = supabase.from('stok_araclar')
      .select('id, plaka, stok_kodu, durum')
      .not('durum', 'in', `(${ARAC_DURUM_GRUP.KAPANIS.join(',')})`)
    mq = plakasiz ? mq.ilike('stok_kodu', stokKodu) : mq.eq('plaka_norm', plaka)
    if (DUZENLE_ID) mq = mq.neq('id', DUZENLE_ID)
    const { data: ayni, error: me } = await mq.limit(1)
    if (me) dbHata('mükerrer son kontrol', me)   // sorgu patlarsa kaydı bloklama
    else if (ayni && ayni.length) {
      MUKERRER = ayni[0]; guncelle()
      return hata(`Bu ${plakasiz ? 'stok kodu' : 'plaka'} sistemde zaten var (${aracEtiket(ayni[0])} · ${aracDurumEtiket(ayni[0].durum)}). Aynı araç iki kez kaydedilemez.`)
    }
  }
  // Alış Şekli ARTIK zorunlu DEĞİL — İsmail Bey fiyatlama ekranından girer.
  // Boş bırakıldığında varsayılan ATANMAZ (null yazılır), tahmin yürütülmez.

  const btnlar = [document.getElementById('akKaydet'), document.getElementById('akKaydetSade')]
  const btn = document.getElementById(gonder ? 'akKaydet' : 'akKaydetSade')
  const eskiHtml = btn.innerHTML
  kaydediliyor = true
  try {
    // Ekspertiz/tramer boşsa "orijinal mi / temiz mi" onayı — buton kilidinden
    // ÖNCE. İhaleden alınan orijinal araçta işaretlenecek parça / hasar OLMAZ;
    // yokluğu "eksik" değil, onaylı durum saymak için. "Geri dön" → hiçbir şey
    // yazılmadan çıkılır (kullanıcı işaretlemeye döner).
    const ekspVar = PARCALAR.some(p => paneller[p] !== 'ORIJINAL')
    const tramerVar = hasarlar.length > 0
    let ekspertizOrijinal = false, tramerTemiz = false
    if (!ekspVar) {
      ekspertizOrijinal = await onaySor('Ekspertiz işaretlemesi yok',
        'Boyalı/değişen parça işaretlenmedi. Araç orijinal mi? Evet → araç "orijinal" olarak kaydedilir; Geri dön → işaretlemeye dönebilirsin.',
        'Evet, orijinal', 'Geri dön')
      if (!ekspertizOrijinal) return
    }
    if (!tramerVar) {
      tramerTemiz = await onaySor('Tramer hasar kaydı yok',
        'Tramer hasar kaydı girilmedi. Araç tramer temiz (hasarsız) mı? Evet → "tramer temiz" olarak kaydedilir; Geri dön → hasar girebilirsin.',
        'Evet, temiz', 'Geri dön')
      if (!tramerTemiz) return
    }

    // ⚠️ ARABAM PAKETİ — kuyruğa gönderiliyorsa SORULUR (Göksenil, 10 Ağu 2026:
    //    "yeni araç kabul ettim, arabam.com için paket seçtirmedi").
    //    Fiyatlama kuyruğuna açılan DÖRT kapı var: satır menüsü, araç detayı,
    //    toplu işlem ve BU sihirbaz. Diğer üçü paketi soruyordu; sihirbaz
    //    atlanmıştı — aynı şikâyet 6 Ağu'da başka bir kapı için yapılmış,
    //    o turda bu kapı gözden kaçmış (bkz. arac-kabul.js fiyatlamaGonder).
    //    Paketsiz araçta piyasa ölçümü sessizce model geneline düşüyor;
    //    İsmail Bey daha kaba bir medyanla fiyat veriyor.
    //
    //    Paket sözlüğe marka/model/versiyon ile yazılır, araç id'si gerekmez —
    //    bu yüzden kayıttan ÖNCE sorulabiliyor.
    //    Vazgeçilirse FORM ÇÖPE GİTMEZ: araç taslak olarak kaydedilir,
    //    kuyruğa girmez. Kullanıcı sonra "Fiyatlamaya Gönder" diyebilir.
    let kuyruga = gonder
    if (gonder) {
      const { paketSorVeYaz } = await import('./arabam-paket.js')
      kuyruga = await paketSorVeYaz({
        marka: g('f_marka'), model: g('f_model'), versiyon: g('f_versiyon'),
      })
    }

    btnlar.forEach(b => b && (b.disabled = true)); btn.textContent = 'Kaydediliyor…'

    // Kaydı açan personel → süreç geçmişinde "sorumlu" olarak görünür.
    const benim = BEN || await getDanisman()

    // 0) Mükerrer engeli YUKARI ALINDI (fonksiyonun başındaki kontrol).
    //
    // ⚠️ BURADA ESKİ BİR KONTROL VARDI ve ÜÇ DELİĞİ YÜZÜNDEN İŞLEMİYORDU
    //    (Göksenil 10 Ağu 2026'da "iki sefer kaydedilebilir olmuş" derken
    //     kastettiği durum tam olarak buydu — sorgu vardı ama tutmuyordu):
    //      1) `in('durum', ARAC_AKTIF_DURUMLAR)` → o liste gruplardan
    //         türetiliyor ve `KULLANIMDA` hiçbir grupta YOK. Canlıdaki
    //         mükerrer 35CLM042 (KULLANIMDA + ALINDI) bu delikten geçmiş.
    //      2) `eq('plaka', …)` HAM plakaya bakıyordu; "35 CLM 042" gibi
    //         boşluklu yazım eşleşmiyordu (plaka_norm için sql/169 var).
    //      3) Düzenleme modunu bilmiyordu → kaydın KENDİSİNİ mükerrer
    //         sayıp güncellemeyi bloke ediyordu.
    //    Yerine geçen kontrol: kapanış durumlarını DIŞLAR (KULLANIMDA dahil
    //    18 durumu kapsar), plaka_norm üzerinden bakar, düzenlemede kendi
    //    kaydını hariç tutar. İki kontrol birden tutulmadı: ikisi ayrışırsa
    //    hangisinin geçerli olduğu belirsizleşir.
    // 1) Satıcı müşteri (seçili yoksa ve yeni girildiyse BUL ya da oluştur)
    //
    // ⚠️ ESKİDEN KOŞULSUZ INSERT'Tİ → MÜKERRER ÜRETİYORDU.
    //   Göksenil bildirdi: "ALJ Motorlu Araçlar 5 tane, hepsi mükerrer."
    //   Ölçüldü: 5 kayıt da aynı ad/telefon/TCKN, 31 Tem 12:29–12:37 arası,
    //   YALNIZ SONUNCUSUNDA alış var. Yani her deneme yeni müşteri açıyor,
    //   sonraki adım (plaka/araç) patlayınca müşteri ÖKSÜZ kalıyordu.
    //   Artık önce TCKN/VKN, sonra telefon ile MEVCUT kayıt aranıyor.
    let saticiId = satici?.id || null
    if (!saticiId && g('ms_ad')) {
      const tckn = (g('ms_tckn') || '').replace(/\D/g, '')
      const telNorm = g('ms_tel') ? telSifirla(g('ms_tel')) : ''

      // (a) Kimlik ile ara — en güvenilir eşleşme
      if (tckn) {
        const { data: k, error: ke } = await supabase.from('musteri_kimlik')
          .select('musteri_id').eq('tckn_vergi_no', tckn).limit(1)
        if (ke) dbHata('mükerrer müşteri (kimlik)', ke)
        if (k && k.length) saticiId = k[0].musteri_id
      }
      // (b) Kimlik yoksa/bulunamadıysa telefonla ara ('-' geçersiz)
      if (!saticiId && telNorm && telNorm !== '-') {
        const { data: t, error: te } = await supabase.from('musteriler')
          .select('id').eq('telefon', telNorm).limit(1)
        if (te) dbHata('mükerrer müşteri (telefon)', te)
        if (t && t.length) saticiId = t[0].id
      }

      if (saticiId) {
        // GERİ YAZMA — Göksenil: "müşteriler farklı modüllerden güncellenirse
        // gidip müşteri kaydından o veri güncellenecek."
        // ⚠️ BOŞ alan sessizce dolar; DOLU ve FARKLI alan ONAY sorar.
        //   Sessiz üzerine yazma, doğru numarayı yanlışıyla değiştirir.
        const { musteriGeriYaz, geriYazOzet } = await import('./musteri-sec.js')
        const oz = await musteriGeriYaz(saticiId, {
          ad_soyad: g('ms_ad'), telefon: telNorm, kimlik: tckn,
        })
        const ozet = geriYazOzet(oz)
        if (ozet) console.debug('[arac-kabul] müşteri geri yazma —', ozet)
      } else {
        const { data: m, error: me } = await supabase.from('musteriler')
          .insert({
            tip: g('ms_tip') || 'SAHIS',
            ad_soyad: g('ms_ad'),
            telefon: telNorm || '-',   // "(555) 000 00 00" → "05550000000"
            kaynak: g('ms_kaynak') || null,
            olusturan: benim?.id || null,
          }).select('id').single()
        if (me) { dbHata('müşteri', me); return hata('Müşteri eklenemedi: ' + me.message) }
        saticiId = m.id
        if (tckn) {
          const { error: ke } = await supabase.from('musteri_kimlik').upsert({ musteri_id: saticiId, tckn_vergi_no: tckn }, { onConflict: 'musteri_id' })
          if (ke) dbHata('musteri_kimlik', ke)
        }
      }
    }

    // 2) stok_araclar (ALINDI)
    const arac = {
      plaka, stok_kodu: stokKodu || null,
      sasi_no: g('f_sasi') || null, motor_no: g('f_motor') || null,
      marka: g('f_marka') || null, model: g('f_model') || null, versiyon: g('f_versiyon') || null,
      yil: g('f_yil') ? +g('f_yil') : null, yakit: g('f_yakit') || null, vites: g('f_vites') || null,
      kasa_tipi: g('f_kasa') || null, renk: g('f_renk') || null, arac_tipi: g('f_arac_tipi') || null,
      km: g('f_km') ? +g('f_km') : null, tsb_marka_id: g('f_tsbmarka') || null, tsb_tip_id: g('f_tsbtip') || null,
      ruhsat_seri_no: g('f_ruhsat') || null,
      muayene_tarihi: g('f_muayene') || null,   // ruhsat OCR'ından gelir (mua.geç.trh)
      tescil_tarihi: g('f_tescil') || null,           // ruhsat (I)  — sql/153
      ilk_tescil_tarihi: g('f_ilktescil') || null,    // ruhsat (B)  — sql/153
      lokasyon: g('f_lokasyon') || null, park: g('f_park') || null,
      yedek_anahtar: document.getElementById('f_anahtar').checked,
      notu: g('f_notu') || null,
      ekspertiz_orijinal: ekspertizOrijinal,   // işaretleme yok + "orijinal" onayı
      tramer_temiz: tramerTemiz,                // hasar yok + "temiz" onayı
    }
    // ⚠️ AKIŞA AİT KOLONLAR YALNIZ YENİ KAYITTA YAZILIR. Düzenlemede
    //    yazılsaydı STOKTA/SIPARISTE bir araç ALINDI'ya geri döner, kuyruk
    //    durumu sıfırlanır ve kaydı ilk açan kişi değişirdi.
    if (!DUZENLE_ID) {
      arac.durum = 'ALINDI'
      arac.fiyatlama_durumu = kuyruga ? 'BEKLIYOR' : null
      arac.olusturan = benim?.id || null       // süreç geçmişi "sorumlu"su
    } else if (kuyruga) {
      arac.fiyatlama_durumu = 'BEKLIYOR'       // düzenlemede yalnız kuyruğa GÖNDERİLİRSE
    }

    let aracId
    if (DUZENLE_ID) {
      // .select('id') ŞART: PostgREST'te eşleşme olmazsa UPDATE hata vermez,
      // 0 satır günceller ve "kaydedildi" sanılır (CLAUDE.md §5/1).
      const { data: su, error: sue } = await supabase.from('stok_araclar')
        .update(arac).eq('id', DUZENLE_ID).select('id')
      if (sue) { dbHata('stok_araclar güncelle', sue); return hata('Araç güncellenemedi: ' + sue.message) }
      if (!su || !su.length) return hata('Araç güncellenemedi — kayıt bulunamadı ya da yetkiniz yok.')
      aracId = DUZENLE_ID
    } else {
      const { data: sa, error: se } = await supabase.from('stok_araclar').insert(arac).select('id').single()
      if (se) { dbHata('stok_araclar', se); return hata('Araç kaydedilemedi: ' + se.message) }
      aracId = sa.id
    }

    // 3) arac_alislar — DÜZENLEMEDE alis_fiyati/masraf ALANLARINA DOKUNULMAZ
    //    (İsmail Bey fiyatlamada girer; buradan yazmak fiyatı sıfırlardı).
    if (DUZENLE_ID) {
      const { data: au, error: aue } = await supabase.from('arac_alislar')
        .update({ satici_musteri_id: saticiId, alis_sekli: alisSekli || null })
        .eq('arac_id', aracId).select('id')
      if (aue) dbHata('arac_alislar güncelle', aue)
      // Alış satırı hiç yoksa (eski/eksik kayıt) oluştur
      else if (!au || !au.length) {
        const { error: aie } = await supabase.from('arac_alislar').insert({
          arac_id: aracId, satici_musteri_id: saticiId, alis_tarihi: bugunISO(), alis_sekli: alisSekli || null,
        })
        if (aie) dbHata('arac_alislar (eksik satır)', aie)
      }
    } else {
      const { error: ae } = await supabase.from('arac_alislar').insert({
        arac_id: aracId, satici_musteri_id: saticiId, alis_tarihi: bugunISO(),
        alis_sekli: alisSekli || null,
      })
      if (ae) { dbHata('arac_alislar', ae); return hata('Alış kaydı eklenemedi (yetki?): ' + ae.message) }
    }

    // 4) arac_ekspertiz — FARK TABANLI (ortak yardımcı, ekspertiz.js).
    //    ⚠️ Eskiden düzenlemede TAMAMI silinip yeniden yazılıyordu. Silme
    //    politikası `is_master() or is_yonetici()`, yazma politikası her
    //    danışmana açık; yetkisiz biri düzenlediğinde silme HATA VERMEDEN
    //    0 satır siliyor, insert geçiyor ve aynı parçadan MÜKERRER satır
    //    kalıyordu (14 Ağu 2026 keşfi). sql/201 tekillik kısıtı bunu artık
    //    reddeder — o yüzden yazma yolu da düzeltildi, yoksa bu ekran
    //    kısıt ihlaliyle patlardı.
    //    Yeni davranış: yalnız değişen parçaya dokunulur; silme gerekiyorsa
    //    ve yetki yoksa kaydetme DURUR ve sebebini söyler.
    {
      const mevcutEks = {}
      for (const e of (MEVCUT_EKSPERTIZ || [])) mevcutEks[e.parca_kodu] = e.durum
      const r = await ekspertizFarkKaydet({
        aracId, mevcut: DUZENLE_ID ? mevcutEks : {}, hedef: ekspertizHedef(paneller),
        silebilir: !!(BEN && (BEN.master_admin || BEN.rol === 'yonetici')),
      })
      if (!r.ok) return hata(r.msg)
    }

    // 5) arac_tramer (her hasar bir satır) — ekspertizle aynı mantık
    if (DUZENLE_ID) {
      const { error: dt } = await supabase.from('arac_tramer').delete().eq('arac_id', aracId)
      if (dt) dbHata('tramer temizle', dt)
    }
    if (hasarlar.length) {
      const kayit = hasarlar.map(h => ({
        arac_id: aracId, sorgu_tarihi: g('t_tarih') || bugunISO(),
        hasar_tarihi: h.tarih || null, aciklama: h.neden || null, tutar: Number(h.tutar) || null,
      }))
      const { error: te } = await supabase.from('arac_tramer').insert(kayit)
      if (te) dbHata('tramer', te)
    }

    // 5b) Versiyon özelliği öğren (upsert; yalnız dolu alanlar — mevcudu ezmez)
    const tipAdiOgren = [g('f_model'), g('f_versiyon')].filter(Boolean).join(' ').trim()
    if (tipAdiOgren) {
      const kayit = { tip_adi_key: trBuyuk(tipAdiOgren).trim().replace(/\s+/g, ' ') }
      if (g('f_yakit')) kayit.yakit = g('f_yakit')
      if (g('f_vites')) kayit.vites = g('f_vites')
      if (g('f_kasa')) kayit.kasa = g('f_kasa')
      if (g('f_arac_tipi')) kayit.arac_tipi = g('f_arac_tipi')   // sql/183
      if (Object.keys(kayit).length > 1) {
        const { error: oe } = await supabase.from('tsb_versiyon_ozellik').upsert(kayit, { onConflict: 'tip_adi_key' })
        if (oe) dbHata('versiyon ozellik ogren', oe)
      }
    }

    // 6) Evraklar → Supabase Storage (ekspertiz PDF · tramer · ruhsat; görseller WebP)
    const yuklemeler = await Promise.all([
      evrakKaydet(aracId, ekspFile, 'EKSPERTIZ_PDF'),
      evrakKaydet(aracId, tramerFile, 'SBM_GORSEL'),
      evrakKaydet(aracId, tramerDetayFile, 'TRAMER_DETAY'),   // varsa (sql/122)
      evrakKaydet(aracId, ruhsatFile, 'RUHSAT'),
    ])
    const basarisiz = yuklemeler.filter(r => !r.ok)
    if (basarisiz.length) return hata('Araç kaydedildi ama bazı dosyalar yüklenemedi: ' + basarisiz.map(r => r.msg).join('; '))

    // Paket seçiminden vazgeçildiyse araç KAYDEDİLDİ ama kuyruğa GİRMEDİ.
    // Sessizce listeye dönmek "gönderdim" sanılmasına yol açar — bu oturumda
    // tam olarak bu yaşandı (araç kuyrukta sanıldı, değildi).
    if (gonder && !kuyruga) {
      alert(`${plaka} kaydedildi ancak FİYATLAMA KUYRUĞUNA GÖNDERİLMEDİ.\n\n`
        + 'arabam.com paket seçimi tamamlanmadı. Araç Kabul Merkezi\'nden '
        + '"Fiyatlamaya Gönder" diyerek tekrar deneyebilirsin.')
    }
    location.href = 'arac-kabul.html'
  } finally {
    kaydediliyor = false
    btnlar.forEach(b => b && (b.disabled = false)); btn.innerHTML = eskiHtml
  }
}
