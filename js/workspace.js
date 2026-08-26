// =====================================================================
// workspace.js — Çalışma alanı (modül) seçim ekranı
//   Login sonrası, kişinin birden fazla modüle erişimi varsa gösterilir.
//   Kart seçimi aktif modülü hatırlar ve o modülün çalışma sayfasına gider.
// =====================================================================
import { signOut } from './auth.js'
import { etkinModuller, modulSayfalari, modulHedefHref, aktifModulYaz } from './yetki.js'
import { mat } from './stitch-ui.js'
import { kacis } from './veri.js'

export function workspaceKur(d) {
  const kok = document.getElementById('wsKok')
  if (!kok) return

  const moduller = etkinModuller(d)

  // Hiç modül yoksa → Ana Sayfa'ya (yetki.js ilkSayfaHref ile tutarlı düşüş)
  if (!moduller.length) { location.replace('home.html'); return }
  // Tek modül → seçime gerek yok, doğrudan içeri gir
  if (moduller.length === 1) {
    aktifModulYaz(moduller[0].key)
    location.replace(modulHedefHref(d, moduller[0].key))
    return
  }

  const ad = kacis((d.ad_soyad || d.email || '').trim().split(/\s+/)[0] || '')

  const kart = m => {
    const etiketler = modulSayfalari(d, m.key).slice(0, 5)
      .map(s => `<span class="text-[11px] font-semibold px-2 py-1 rounded-full bg-surface-container-high text-on-surface-variant">${kacis(s.label)}</span>`)
      .join('')
    return `<button data-modul="${m.key}" class="kart-hover text-left bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 custom-shadow flex flex-col gap-4 hover:border-primary group">
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 rounded-xl bg-primary-fixed text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">${mat(m.ikon, 'text-[30px]')}</div>
        <div class="min-w-0">
          <div class="text-headline-sm font-bold text-on-surface">${kacis(m.label)}</div>
          <div class="text-body-md text-on-surface-variant">${kacis(m.altbaslik)}</div>
        </div>
        <span class="ml-auto text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">${mat('arrow_forward')}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">${etiketler}</div>
    </button>`
  }

  kok.innerHTML = `
    <div class="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-background">
      <div class="w-full max-w-4xl fade-in">
        <div class="text-center mb-10">
          <!-- Marka Kılavuzu §02: kurumsal dikey kilit + ayırıcı + İÇ OS -->
          <img src="img/marka/lockup-bordo.png" alt="İsmail Çalmaz Otomotiv" class="w-full max-w-[240px] mx-auto" />
          <div class="w-[120px] h-[2px] bg-outline-variant mx-auto my-4"></div>
          <div class="text-[34px] font-black tracking-[.05em] text-primary leading-none mb-8">İÇ<span class="font-light"> OS</span></div>
          <h1 class="text-headline-lg text-primary">Hoş geldiniz${ad ? ', ' + ad : ''}</h1>
          <p class="text-body-lg text-on-surface-variant mt-2">Bugün hangi alanda çalışacaksınız?</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${moduller.map(kart).join('')}</div>
        <div class="text-center mt-10">
          <button id="wsCikis" class="text-label-md font-bold text-on-surface-variant hover:text-error transition-colors inline-flex items-center gap-1.5">${mat('logout', 'text-[18px]')} Çıkış yap</button>
        </div>
      </div>
    </div>`

  kok.querySelectorAll('[data-modul]').forEach(btn => btn.addEventListener('click', () => {
    const key = btn.dataset.modul
    aktifModulYaz(key)
    location.href = modulHedefHref(d, key)
  }))
  document.getElementById('wsCikis')?.addEventListener('click', () => signOut())
}
