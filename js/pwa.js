// =====================================================================
// pwa.js — PWA kurulumu (her sayfada, auth.js tarafından yüklenir)
//   manifest + tema rengi + apple ikonlarını enjekte eder, SW'yi kaydeder.
//   HTML dosyalarını tek tek düzenlememek için JS ile eklenir.
// =====================================================================
export function pwaKur() {
  const bas = document.head
  const ekle = (etiket, ozellik) => {
    const e = document.createElement(etiket)
    Object.assign(e, ozellik)
    bas.appendChild(e)
  }

  if (!document.querySelector('link[rel="manifest"]')) ekle('link', { rel: 'manifest', href: 'manifest.json' })
  if (!document.querySelector('meta[name="theme-color"]')) ekle('meta', { name: 'theme-color', content: '#5f1818' })
  // iOS "Ana Ekrana Ekle"
  ekle('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' })
  ekle('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' })
  ekle('meta', { name: 'apple-mobile-web-app-title', content: 'İÇ CRM' })
  ekle('link', { rel: 'apple-touch-icon', href: 'icon-192.png' })

  // Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* yoksay */ })
    })
  }
}
