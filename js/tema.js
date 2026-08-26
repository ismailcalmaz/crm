// =====================================================================
// tema.js — Stitch tasarım sistemini (Tailwind + Material Symbols) enjekte eder
//   Her sayfada auth.js tarafından yüklenir. Stitch'ten gelen tasarımlar
//   OLDUĞU GİBİ (Tailwind utility class'ları) çalışsın diye.
//
//   preflight KAPALI + Stitch base resetleri ".stitch" altına izole edildi;
//   böylece henüz dönüştürülmemiş (eski style.css'li) sayfalar bozulmaz.
// =====================================================================

// Stitch tasarım token'ları (projeden birebir)
const TW_CONFIG = {
  darkMode: 'class',
  corePlugins: { preflight: false },   // eski sayfaları korumak için base reset kapalı
  theme: {
    extend: {
      colors: {
        'surface-container-lowest': '#ffffff',
        'error': '#ba1a1a', 'error-container': '#ffdad6', 'on-error': '#ffffff', 'on-error-container': '#93000a',
        'primary': '#5f1818', 'primary-container': '#7a2420', 'on-primary': '#ffffff', 'on-primary-container': '#ef8189',
        'primary-fixed': '#ffdadb', 'primary-fixed-dim': '#ffb2b6', 'on-primary-fixed': '#40000d', 'on-primary-fixed-variant': '#7e2934',
        'inverse-primary': '#ffb2b6', 'surface-tint': '#9c404a',
        'secondary': '#006e2d', 'secondary-container': '#7cf994', 'on-secondary': '#ffffff', 'on-secondary-container': '#007230',
        'secondary-fixed': '#7ffc97', 'secondary-fixed-dim': '#62df7d', 'on-secondary-fixed': '#002109', 'on-secondary-fixed-variant': '#005320',
        'tertiary': '#00204f', 'tertiary-container': '#003578', 'on-tertiary': '#ffffff', 'on-tertiary-container': '#6fa0ff',
        'tertiary-fixed': '#d8e2ff', 'tertiary-fixed-dim': '#adc6ff', 'on-tertiary-fixed': '#001a42', 'on-tertiary-fixed-variant': '#004395',
        'background': '#f9f9fe', 'on-background': '#1a1c20',
        'surface': '#f9f9fe', 'surface-bright': '#f9f9fe', 'surface-dim': '#d9d9df',
        'surface-container-low': '#f3f3f9', 'surface-container': '#ededf3', 'surface-container-high': '#e8e8ed', 'surface-container-highest': '#e2e2e7',
        'on-surface': '#1a1c20', 'on-surface-variant': '#554243', 'surface-variant': '#e2e2e7',
        'inverse-surface': '#2e3035', 'inverse-on-surface': '#f0f0f6',
        'outline': '#887272', 'outline-variant': '#dbc0c1',
      },
      borderRadius: { 'DEFAULT': '0.4rem', 'lg': '0.6rem', 'xl': '1rem', 'full': '9999px' },
      spacing: { 'base': '4px', 'xs': '4px', 'sm': '8px', 'md': '16px', 'lg': '24px', 'xl': '32px', 'gutter': '20px', 'margin': '24px', 'container-max-width': '1440px' },
      fontFamily: {
        'body-md': ['Inter'], 'body-lg': ['Inter'], 'label-md': ['Inter'], 'label-sm': ['Inter'],
        'title-lg': ['Inter'], 'headline-sm': ['Inter'], 'headline-md': ['Inter'], 'headline-lg': ['Inter'],
      },
      fontSize: {
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'label-sm': ['11px', { lineHeight: '16px', fontWeight: '600' }],
        'label-md': ['13px', { lineHeight: '18px', letterSpacing: '0.01em', fontWeight: '500' }],
        'title-lg': ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'headline-sm': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
      },
    },
  },
}

// Stitch yardımcı stilleri + ".stitch" altına izole edilmiş base reset (mini-preflight)
const STIL = `
  .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; display: inline-block; vertical-align: middle; line-height: 1; }
  .custom-shadow { box-shadow: 0 1px 2px rgba(27,29,33,.04), 0 8px 30px rgba(27,29,33,.06); }
  /* Premium kart etkileşimi — hover'da hafifçe kalkar (Apple/Linear hissi) */
  .kart-hover { transition: transform .18s ease, box-shadow .18s ease; }
  .kart-hover:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(27,29,33,.07), 0 16px 44px rgba(27,29,33,.11); }
  @media (prefers-reduced-motion: reduce) { .kart-hover { transition: none; } .kart-hover:hover { transform: none; } }
  /* Sayı sayaç + grafik giriş animasyonu için yumuşak fade */
  .fade-in { animation: fadeIn .4s ease both; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .zebra-table tbody tr:nth-child(even) { background-color: #f7f8fa; }
  /* Tek satırlara da AÇIK arka plan: sağa sabitlenen hücre (.yapisik-hucre) bunu
     inherit eder; yoksa saydam kalır ve altından kayan içerik görünür. */
  .zebra-table tbody tr:nth-child(odd) { background-color: #fff; }
  /* Kilitli araç satırları (Stok Merkezi): rezerve açık yeşil, siparişte açık turuncu.
     ⚠️ ÖZGÜLLÜK ŞART: zebra kuralı .zebra-table tbody tr:nth-child(odd) (0,2,2);
        (Bu blok bir template literal içinde — YORUMDA BACKTICK KULLANMA,
         stringi kapatır ve tüm modül SyntaxError verir. Tam bu oldu.)
        tek Tailwind sınıfı (0,1,0) onu YENEMİYOR ve satır BEYAZ kalıyordu
        (canlıda ölçüldü: sınıf duruyor, computed background rgb(255,255,255)).
        Buradaki seçici (0,3,2) ile zebrayı geçiyor. .yapisik-hucre zaten
        inherit olduğu için sabit kolon da aynı rengi alır. */
  .zebra-table tbody tr.rez-satir { background-color: #F0FDF4; }
  .zebra-table tbody tr.sip-satir { background-color: #FFF7ED; }
  /* Tablo yatayda taşınca son kolon (İşlemler) sağda sabit kalsın — buton hep görünür */
  .yapisik-hucre { background-color: inherit; box-shadow: -6px 0 8px -6px rgba(27,29,33,.10); }
  /* Stitch bölgelerine (.stitch) izole base reset — eski sayfalara dokunmaz */
  .stitch, .stitch * { box-sizing: border-box; }
  .stitch :where(h1,h2,h3,h4,h5,h6,p,figure) { margin: 0; }
  .stitch :where(ul,ol) { margin: 0; padding: 0; list-style: none; }
  .stitch :where(a) { color: inherit; text-decoration: none; }
  .stitch :where(button) { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  .stitch :where(input,select,textarea) { font: inherit; color: inherit; }
  .stitch :where(svg) { display: inline-block; vertical-align: middle; }

  /* --- ONAY / RADYO KUTULARI GORUNMUYORDU (olculdu 22 Agu 2026) -------
     ⚠️ BU BLOK BİR TEMPLATE LITERAL İÇİNDE — YORUMDA BACKTICK KULLANMA,
        stringi kapatır ve tüm modül SyntaxError verir. (Yukarıda da aynı
        uyarı var; bu düzeltmeyi yazarken tam o hataya düştüm.)
     Zincir:
       1. corePlugins.preflight = false  (eski sayfaları korumak için)
       2. cdn.tailwindcss.com?plugins=forms
     forms eklentisi checkbox'a  appearance: none  veriyor — yani TARAYICI
     artık kutuyu kendisi ÇİZMİYOR — ve yerine  border-width: 1px  +
     border-color: #6b7280  koyuyor. AMA  border-style  VERMİYOR; onu
     preflight'ın  * { border-style: solid }  kuralının verdiğini varsayıyor.
     Preflight kapalı olduğu için border-style başlangıç değeri  none
     kalıyor, border-width 0'a düşüyor ve geriye BEYAZ kart üzerinde
     BEYAZ 16x16 kare kalıyor.
     Canlı ölçüm: appearance "none" · borderStyle "none" · borderWidth "0px"
     · background rgb(255,255,255) → hiç görünmüyor.
     ⚠️ .stitch ile SINIRLANDIRILMADI: forms eklentisi genel, dolayısıyla
        hata da genel — eski sayfalardaki kutular da görünmüyordu. */
  input[type="checkbox"], input[type="radio"] {
    border-style: solid;
    border-width: 1px;
    border-color: #9aa0a6;
    /* ⚠️ ISARETLI HAL MAVI CIKIYORDU (olculdu: rgb(37,99,235) = Tailwind
       blue-600). appearance:none oldugu icin forms eklentisi isaretli
       arka plani CURRENTCOLOR'dan aliyor ve kendi varsayilani #2563eb.
       Kodda her yerde yazan  accent-[#5f1818]  sinifi accent-color'i
       ayarlar; appearance:none iken tarayici o ozelligi KULLANMAZ, yani
       o sinif bugune kadar hicbir sey yapmiyordu. Rengi color ile
       veriyoruz — uygulamanin bordosu. */
    color: var(--md-sys-color-primary, #5f1818);
  }
  /* Isaretli halde forms eklentisi border-color'i transparent yapip
     background'i currentcolor'a cekiyor; accent-* sinifi rengi veriyor.
     Odak halkasi da gorunur kalsin. */
  input[type="checkbox"]:focus-visible, input[type="radio"]:focus-visible {
    outline: 2px solid var(--md-sys-color-primary, #5f1818);
    outline-offset: 2px;
  }

  /* --- Mobil kullanılabilirlik ------------------------------------- */
  /* iOS Safari, yazı boyutu 16px'in ALTINDA olan bir alana dokunulduğunda
     sayfayı otomatik yakınlaştırır ve kullanıcı elle geri uzaklaştırmak
     zorunda kalır. Çözüm user-scalable=no DEĞİL (erişilebilirliği bozar,
     ayrıca iOS 10'dan beri yok sayılıyor) — girdileri 16px yapmak. */
  @media (max-width: 767px) {
    .stitch :where(input,select,textarea) { font-size: 16px; }
    /* Dokunma hedefi: parmak ~44px. Küçük butonlar ıskalanıyordu. */
    .stitch :where(button, a.btn, [data-sahiplen], .tiklanir a, .tiklanir button) {
      min-height: 44px;
    }
    /* ⚠️ Onay/radyo kutuları HARİÇ: 16px'lik kareyi 16x44 dikdörtgene
       uzatıyordu (koşumda ölçüldü: .stitch içi 44px, dışı 16px). */
    .stitch :where(input:not([type="checkbox"]):not([type="radio"]),select,textarea) { min-height: 44px; }
  }
  .stitch { font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
`

let kuruldu = false
export function temaKur() {
  if (kuruldu) return
  kuruldu = true
  const head = document.head
  const ekle = (etiket, ozellik) => { const e = document.createElement(etiket); Object.assign(e, ozellik); head.appendChild(e); return e }

  // =====================================================================
  // FOUC AÇILIŞI — "yüklenirken stilsiz görünüp sonra düzeliyor" (19 Ağu 2026)
  //
  // ESKİ KOD: tw.onload → iki requestAnimationFrame → tema-hazir.
  // İKİ AYRI KUSUR vardı, ikisi de ölçümle bulundu:
  //
  //  1) `onload` yalnız BETİĞİN İNDİĞİNİ söyler. Tailwind Play CDN, CSS'i
  //     ondan SONRA eşzamansız üretir (DOM'u tarayıp derler). Ölçüm: modül
  //     başlangıcından ilk CSS'e **99 ms**. İki rAF ≈ 32 ms → aradaki farkta
  //     sayfa AÇIK ve STİLSİZ kalıyordu. Kullanıcının gördüğü tam buydu:
  //     ikon adları ("directions_car", "search") düz yazı olarak, serif
  //     fontla, kutusuz menüyle.
  //
  //  2) rAF arka plan sekmesinde HİÇ tetiklenmiyor. O durumda açılış
  //     3 sn'lik güvenlik ağına düşüyordu (ölçüm: tema-hazir 3007 ms) —
  //     yani sekmeye dönen kullanıcı 3 sn boş ekran görüyordu.
  //
  // YENİ: Tailwind'in GERÇEKTEN stil ürettiğini bir sondayla ölçüyoruz.
  // `.hidden` bir Tailwind utility'si (display:none) ve style.css'te
  // TANIMLI DEĞİL (doğrulandı) — yani display'in none olması yalnız
  // Tailwind derlendiyse mümkün. Yoklama setTimeout ile; rAF'a bağlı değil.
  // =====================================================================
  const sonda = document.createElement('div')
  sonda.className = 'hidden'
  sonda.setAttribute('aria-hidden', 'true')
  sonda.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  document.body.appendChild(sonda)
  const twStilVar = () => { try { return getComputedStyle(sonda).display === 'none' } catch { return true } }

  let acildi = false
  const gorunur = () => {
    if (acildi) return
    acildi = true
    document.documentElement.classList.add('tema-hazir')
    sonda.remove()
  }
  const T0 = Date.now()
  const yokla = () => {
    if (acildi) return
    if (twStilVar()) return gorunur()
    if (Date.now() - T0 >= 3000) return gorunur()   // güvenlik ağı: CDN takılsa bile ekranı aç
    setTimeout(yokla, 16)
  }
  setTimeout(yokla, 0)

  // Bağlantı ön-ısıtma (daha hızlı yükleme)
  ekle('link', { rel: 'preconnect', href: 'https://cdn.tailwindcss.com' })
  // Fontlar: Inter + Material Symbols
  ekle('link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' })
  const pc = ekle('link', { rel: 'preconnect', href: 'https://fonts.gstatic.com' }); pc.crossOrigin = 'anonymous'
  ekle('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' })
  // ⚠️ İkon fontunda `display=block`, `swap` DEĞİL. `swap` yedek fontla
  //    çizer; ikonlarda yedek font yok, o yüzden ligatür ADI düz yazı
  //    olarak görünüyor ("directions_car", "search", "notifications" —
  //    kullanıcının ekran görüntüsünde tam bu vardı). `block` görünmez
  //    çizer, font gelince ikon belirir: yanlış metin hiç görünmez.
  //    Metin fontunda (Inter) `swap` DOĞRU — orada yedek font okunur bir
  //    şey gösterir, gizlemek daha kötü olurdu.
  ekle('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block' })

  // Yardımcı stiller
  const st = document.createElement('style'); st.textContent = STIL; head.appendChild(st)

  // Tailwind (Play CDN) — yüklenince config'i uygula
  const tw = document.createElement('script')
  tw.src = 'https://cdn.tailwindcss.com?plugins=forms,container-queries'
  tw.onload = () => {
    try { window.tailwind.config = TW_CONFIG } catch (e) { /* yoksay */ }
    // ⚠️ BURADAN `gorunur()` ÇAĞIRMA. Config atamak Play CDN'de YENİ bir
    //    derleme tetikler; onload anında ekranı açmak tam da düzelttiğimiz
    //    stilsiz pencereyi geri getirir. Açılışa yukarıdaki sonda karar verir.
    yokla()
  }
  tw.onerror = gorunur   // CDN yüklenemezse yine de göster
  head.appendChild(tw)
}
