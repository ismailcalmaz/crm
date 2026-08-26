// =====================================================================
// auth.js — Google OAuth giriş, rol bulma, role göre yönlendirme
// =====================================================================
import { supabase, getDanisman } from './supabase-client.js'
import { sohbetWidgetKur } from './sohbet-widget.js'
import { SAYFALAR, MODULLER, etkinSayfalar, sayfaErisebilir, ilkSayfaHref,
  modulSayfalari, etkinModuller, sayfaModul, aktifModulOku, aktifModulYaz, modulHedefHref,
  modulAnaSayfa, menuYerlesimUygula } from './yetki.js'
import { aramaKur } from './arama.js'
import { pwaKur } from './pwa.js'
import { temaKur } from './tema.js'
import { bildirimKur } from './bildirim.js'
import { durgunUyariKur } from './durgun-uyari.js'
import { komutPaletiKur } from './komut-paleti.js'
import { cevrimdisiBannerKur, kurtarmaKur } from './ag.js'

// Stitch tasarım sistemi (Tailwind + Material Symbols) + PWA — her sayfada
temaKur()
pwaKur()
// Ağ dayanıklılığı: çevrimdışı şeridi + bozuk önbellekten otomatik kurtarma
cevrimdisiBannerKur()
kurtarmaKur()

// Rol önizleme konsol kısayolları (yalnızca master admin'de etkili — kontrol
// getDanisman içinde). Örn: rolOnizle('kredi') · rolSifirla()
if (typeof window !== 'undefined') {
  window.rolOnizle = r => { try { localStorage.setItem('ic-rol-onizleme', r) } catch (e) { /* yoksay */ } location.reload() }
  window.rolSifirla = () => { try { localStorage.removeItem('ic-rol-onizleme') } catch (e) { /* yoksay */ } location.reload() }
}

// index.html'in mutlak URL'i (OAuth dönüş adresi). login/index aynı klasörde.
function routerUrl() {
  return new URL('index.html', window.location.href).href
}

// --- Google ile giriş başlat ---
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: routerUrl(),
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw error
}

// --- E-posta + şifre ile giriş (AŞAMA 7) ---
// Şirket Google hesabı OLMAYAN personel için (bilgi işlem / operasyon).
// Hesabı master admin açar (admin.html → personel-hesap edge function);
// buradan KAYIT OLUNAMAZ, yalnızca giriş yapılır.
export async function signInWithPassword(email, sifre) {
  const { error } = await supabase.auth.signInWithPassword({
    email: String(email || '').trim().toLowerCase(),
    password: String(sifre || ''),
  })
  if (error) throw error
}

// --- Giriş/çıkış audit kaydı (.ai/18 · sql/91) ---
// IP sunucuda (PostgREST başlığından) çözülür; buradan yalnız olay + yöntem
// + tarayıcı bilgisi gider. Hata OLURSA giriş/çıkış AKIŞI BOZULMAZ.
async function girisKaydet(olay, yontem) {
  try {
    const d = await getDanisman()
    await supabase.from('giris_kayitlari').insert({
      danisman_id: d?.id || null, kullanici: d?.email || null,
      olay, yontem: yontem || null, cihaz: navigator.userAgent?.slice(0, 300) || null,
    })
  } catch (e) { console.error('[audit] giriş kaydı yazılamadı', e) }
}
export const girisAudit = (yontem) => girisKaydet('GIRIS', yontem)

// --- Çıkış ---
export async function signOut() {
  await girisKaydet('CIKIS', null)
  await supabase.auth.signOut()
  window.location.href = 'login.html'
}

// --- Aktif oturum var mı? ---
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// --------------------------------------------------------------------
// requireAuth(opts)
//   Her korumalı sayfanın başında çağrılır.
//   opts = { sayfa?: 'web_satis', roller?: ['yonetici'], master?: true }
//   - Oturum yoksa      → login.html
//   - kayıt yoksa       → login.html?durum=kayitsiz
//   - aktif=false       → login.html?durum=pasif
//   - master gerekiyor ama değilse / sayfa izni yoksa / rol uymuyorsa
//                       → erişebildiği ilk sayfaya atar
//   - uygunsa           → danisman kaydını döndürür
// --------------------------------------------------------------------
export async function requireAuth(opts = {}) {
  const session = await getSession()
  if (!session) { window.location.replace('login.html'); return null }

  // Realtime (anlık sohbet) için token'ı ayarla — yoksa RLS'li tablolarda
  // yeni satır olayları iletilmez (mesajlar sadece yenileyince görünür).
  try { if (session.access_token) supabase.realtime.setAuth(session.access_token) } catch (e) { /* yoksay */ }

  const danisman = await getDanisman()
  if (!danisman) { window.location.replace('login.html?durum=kayitsiz'); return null }
  if (danisman.aktif === false) {
    await supabase.auth.signOut()
    window.location.replace('login.html?durum=pasif')
    return null
  }

  // Menü modül yerleşimi (ayarlar.menu_yerlesim) — sidebar'ı buna göre kur.
  // Okunamazsa koddaki varsayılan yerleşim geçerli (kırılma yok).
  try {
    const { data, error } = await supabase.from('ayarlar')
      .select('deger').eq('anahtar', 'menu_yerlesim').maybeSingle()
    if (error) console.error('menu yerlesim okunamadi', error)
    else if (data?.deger) menuYerlesimUygula(JSON.parse(data.deger))
  } catch (e) { console.error('menu yerlesim uygulanamadi', e) }

  const master = danisman.master_admin === true
  let izinli = true
  if (opts.master && !master) izinli = false
  if (opts.sayfa && !sayfaErisebilir(danisman, opts.sayfa)) izinli = false
  if (opts.roller && !master && !opts.roller.includes(danisman.rol)) izinli = false

  if (!izinli) { window.location.replace(ilkSayfaHref(danisman)); return null }
  return danisman
}

// Menü ikonları — Material Symbols isimleri (Stitch kabuğu)
const NAVIKON = {
  home: 'home', dashboard: 'dashboard', musteri_merkezi: 'groups',
  arac_kabul: 'add_road', fiyatlama: 'request_quote',
  talepler: 'assignment', havuz: 'inbox',
  stok: 'directions_car', siparis: 'receipt_long', web_satis: 'sell', web_takas: 'swap_horiz',
  katilim_finans: 'account_balance', web_iletisim: 'mail', degerleme: 'query_stats', kredi: 'credit_score', kredi_rapor: 'monitoring',
  surum: 'campaign', admin: 'settings',
  // Operasyon Merkezi (F7)
  operasyon_panel: 'view_kanban', operasyon_tanimlar: 'tune', operasyon_pasta_cila: 'auto_awesome', operasyon_kuafor: 'cleaning_services',
  // Sigorta modülü
  sigorta_panel: 'shield', sigorta_policeler: 'description', sigorta_yapboz: 'event_repeat',
  sigorta_aktarim: 'cloud_upload',
  sigorta_yenileme: 'autorenew', sigorta_firsat: 'handshake', sigorta_dikkat: 'flag',
  sigorta_musteri: 'contacts', sigorta_rapor: 'analytics', sigorta_tanimlar: 'tune',
}
function mat(ad, ekstra = '') { return `<span class="material-symbols-outlined${ekstra ? ' ' + ekstra : ''}">${ad}</span>` }
function basHarf(ad) {
  const p = (ad || '?').trim().split(/\s+/).filter(Boolean)
  const h = (p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')
  return (h || '?').toLocaleUpperCase('tr-TR')
}

// --- App shell'i kur: Stitch Tailwind kabuğu (sidebar + üst bar) ---
//   Dinamik menü (yetki), master admin, çıkış, global arama ve sohbet korunur.
export function ustBarKur(danisman) {
  document.querySelector('.topbar')?.remove()
  document.getElementById('nav')?.remove()

  const icerik = document.querySelector('.icerik')
  if (!icerik) { sohbetWidgetKur(danisman); return }

  const buSayfa = location.pathname.split('/').pop()
  const keys = etkinSayfalar(danisman)   // "Yeni Eylem" hızlı-eylemleri için
  const moduller = etkinModuller(danisman)

  // Aktif modül: URL'deki sayfanın modülü tek kaynaktır (yer imi / derin link
  // doğru modülü açsın). Modül-bağımsız sayfalarda (Ana Sayfa/Profil/Yenilikler)
  // hatırlanan modüle düş; o da yoksa erişilebilen ilk modül.
  let aktifModul = sayfaModul(buSayfa)
  if (!moduller.some(m => m.key === aktifModul)) aktifModul = null
  if (!aktifModul) {
    const h = aktifModulOku()
    aktifModul = moduller.find(m => m.key === h)?.key || moduller[0]?.key || null
  }
  aktifModulYaz(aktifModul)
  const aktifM = MODULLER.find(m => m.key === aktifModul)

  const link = (href, key, label) => {
    const aktif = href === buSayfa
    const cls = aktif
      ? 'text-primary font-bold border-r-4 border-primary bg-primary-fixed'
      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary'
    return `<a href="${href}" class="flex items-center gap-3 px-4 py-3 rounded-lg text-label-md font-label-md transition-colors ${cls}">${mat(NAVIKON[key] || 'circle')}<span>${label}</span></a>`
  }

  // Sidebar = Ana Sayfa (modül-bağımsız, üstte) + aktif modülün sayfaları +
  // (yönetim + master ise) Master Admin + Yenilikler. Kurulmamış sayfalar gizli.
  // ⚠️ "Ana Sayfa" artık AKTİF MODÜLÜN kendi panosudur (Göksenil, 1 Ağu 2026).
  // Eskiden sabit home.html idi: DMS'te basınca kullanıcı CRM'e atılıyor ve
  // aktif modül kalıcı olarak CRM yazılıyordu. Modülün ana sayfası aşağıdaki
  // listede TEKRAR gösterilmez.
  let navHtml = ''
  const anaSayfa = modulAnaSayfa(danisman, aktifModul)
  if (anaSayfa) navHtml += link(anaSayfa.href, 'home', 'Ana Sayfa')
  else if (sayfaErisebilir(danisman, 'home')) navHtml += link('home.html', 'home', 'Ana Sayfa')
  navHtml += modulSayfalari(danisman, aktifModul)
    .filter(s => !anaSayfa || s.key !== anaSayfa.key)
    .map(s => link(s.href, s.key, s.label)).join('')
  if (aktifModul === 'yonetim' && danisman.master_admin) navHtml += link('admin.html', 'admin', 'Master Admin')
  navHtml += `<div class="my-2 mx-2 border-t border-outline-variant"></div>`
  navHtml += link('surum.html', 'surum', 'Yenilikler')   // herkese görünür (izin gerektirmez)

  // Üst bar çalışma alanı değiştirici (app-switcher) — erişilen tüm modüller
  const switcherHtml = aktifM ? `
    <div class="relative shrink-0">
      <button id="modulSwitch" class="flex items-center gap-2 pl-2.5 pr-2 h-9 rounded-lg border border-outline-variant bg-surface-container-low hover:border-primary transition-colors" title="Çalışma alanı değiştir">
        ${mat(aktifM.ikon, 'text-primary text-[20px]')}
        <span class="font-bold text-label-md text-on-surface hidden sm:inline">${aktifM.label}</span>
        ${mat('expand_more', 'text-on-surface-variant text-[18px]')}
      </button>
      <div id="modulMenu" class="hidden absolute left-0 top-[calc(100%+8px)] w-64 bg-white rounded-xl border border-outline-variant shadow-2xl z-50 overflow-hidden">
        <div class="px-4 py-2.5 border-b border-outline-variant"><span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Çalışma Alanı</span></div>
        <div class="py-1">${moduller.map(m => {
          const a = m.key === aktifModul
          return `<a href="${modulHedefHref(danisman, m.key)}" class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-container-low transition-colors${a ? ' bg-primary-fixed/50' : ''}">
            <div class="w-8 h-8 rounded-lg ${a ? 'bg-primary text-on-primary' : 'bg-primary-fixed text-primary'} flex items-center justify-center shrink-0">${mat(m.ikon, 'text-[20px]')}</div>
            <div class="min-w-0 flex-1"><div class="text-body-md font-semibold text-on-surface">${m.label}</div><div class="text-[11px] text-on-surface-variant truncate">${m.altbaslik}</div></div>
            ${a ? mat('check', 'text-primary text-[18px]') : ''}
          </a>`
        }).join('')}</div>
        <a href="workspace.html" class="flex items-center gap-2 px-4 py-2.5 border-t border-outline-variant hover:bg-surface-container-low text-label-md font-bold text-primary">${mat('grid_view', 'text-[18px]')} Tüm Çalışma Alanları</a>
      </div>
    </div>` : ''

  const sayfaAdi = (document.title.split('—')[0] || '').trim() || 'CRM'
  const kAd = danisman.ad_soyad || danisman.email
  const ROL_ETIKET = { yonetici: 'Yönetici', satis_muduru: 'Satış Müdürü', santral: 'Santral', satinalma: 'Satın Alma', kredi: 'Kredi Birimi', danisman: 'Danışman', sigorta_yetkili: 'Sigorta (Yetkili)', sigorta_personel: 'Sigorta', muhasebe: 'Muhasebe', bilgi_islem: 'Bilgi İşlem', operasyon: 'Operasyon' }
  const rolMetni = danisman._onizleme
    ? (ROL_ETIKET[danisman.rol] || 'Danışman') + ' (önizleme)'
    : danisman.master_admin ? 'Master Admin' : (ROL_ETIKET[danisman.rol] || 'Danışman')

  // "Yeni Eylem" hızlı-eylem menüsü — yalnızca erişilebilen gerçek eylemler
  // (mockup'taki Araç Girişi/Hızlı Teklif/Görev Ata bu CRM'de yok, konmaz).
  const eylemler = []
  if (keys.includes('talepler')) eylemler.push(['add_box', 'Yeni Talep', 'Yeni müşteri talebi aç', 'talepler.html?yeni=1'])
  if (keys.includes('havuz')) eylemler.push(['inbox', 'Havuza Git', 'Sahipsiz talepleri gör', 'havuz.html'])
  if (keys.includes('degerleme')) eylemler.push(['query_stats', 'Değerleme Talepleri', 'Web değerleme kutusu', 'degerleme.html'])
  if (keys.includes('kredi')) eylemler.push(['credit_score', 'Kredi Kuyruğu', 'Kredi başvuruları', 'kredi.html'])
  if (keys.includes('stok')) eylemler.push(['directions_car', 'Stok', 'Araç envanteri', 'stok.html'])
  const yeniEylemHtml = eylemler.length ? `
    <div class="relative">
      <button id="yeniEylemBtn" class="bg-primary text-on-primary pl-3 pr-3.5 h-9 flex items-center gap-1.5 rounded-lg text-label-md font-bold hover:opacity-90 transition-all shadow-sm shadow-primary/20">
        ${mat('add', 'text-[18px]')}<span class="hidden md:inline">Yeni Eylem</span>
      </button>
      <div id="yeniEylemMenu" class="hidden absolute right-0 top-[calc(100%+8px)] w-64 bg-white rounded-xl border border-outline-variant shadow-2xl z-50 overflow-hidden">
        <div class="px-4 py-2.5 border-b border-outline-variant"><span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Hızlı İşlemler</span></div>
        <div class="py-1">${eylemler.map(([ik, ad, alt, href]) => `
          <a href="${href}" class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-container-low transition-colors">
            <div class="w-8 h-8 rounded-lg bg-primary-fixed text-primary flex items-center justify-center shrink-0">${mat(ik, 'text-[20px]')}</div>
            <div class="min-w-0"><div class="text-body-md font-semibold text-on-surface">${ad}</div><div class="text-[11px] text-on-surface-variant truncate">${alt}</div></div>
          </a>`).join('')}</div>
      </div>
    </div>` : ''

  // Rol önizleme seçicisi — yalnızca master admin (veya önizleme aktifken).
  const onizlemeHtml = (danisman.master_admin || danisman._onizleme) ? `
    <div class="px-lg pb-2">
      <label class="text-[11px] uppercase tracking-wider text-on-surface-variant opacity-70">Rol önizleme (test)</label>
      <select id="rolOnizleSec" class="w-full mt-1 bg-surface border border-outline-variant rounded-lg px-2 py-1.5 text-label-sm">
        <option value="gercek">Gerçek (Master)</option>
        <option value="yonetici">Yönetici</option>
        <option value="satis_muduru">Satış Müdürü</option>
        <option value="kredi">Kredi Birimi</option>
        <option value="danisman">Danışman</option>
        <option value="santral">Santral</option>
        <option value="satinalma">Satın Alma</option>
        <option value="sigorta_yetkili">Sigorta (Yetkili)</option>
        <option value="sigorta_personel">Sigorta (Personel)</option>
        <option value="muhasebe">Muhasebe</option>
        <option value="bilgi_islem">Bilgi İşlem</option>
        <option value="operasyon">Operasyon</option>
      </select>
    </div>` : ''

  const app = document.createElement('div')
  app.innerHTML = `
    <aside id="yan" class="stitch fixed inset-y-0 left-0 w-[260px] z-50 bg-surface-container-lowest border-r border-outline-variant flex flex-col py-md transition-transform duration-200 -translate-x-full md:translate-x-0">
      <!-- Marka kilidi — İÇ OS Marka Kılavuzu §01/§06:
           kurumsal logo BİREBİR korunur, "İÇ OS" ayrı tipografik blok olarak
           ayırıcı çizgiyle altında durur. Logo yeniden çizilmez/sadeleştirilmez. -->
      <div class="px-lg mb-lg">
        <img src="img/marka/horiz-bordo.png" alt="İsmail Çalmaz Otomotiv" class="w-full max-w-[190px]" />
        <div class="mt-2 pt-2 border-t border-outline-variant/70 flex items-baseline gap-2">
          <span class="text-[15px] font-black tracking-[.10em] text-primary leading-none">İÇ<span class="font-light"> OS</span></span>
          <span class="text-[10px] uppercase tracking-[.14em] text-on-surface-variant leading-none">${aktifM ? aktifM.label : 'CRM'}</span>
        </div>
      </div>
      <nav class="flex-1 space-y-1 px-sm overflow-y-auto">${navHtml}</nav>
      <div class="px-lg pt-md mt-auto border-t border-outline-variant">
        ${onizlemeHtml}
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold shrink-0">${basHarf(kAd)}</div>
          <div class="overflow-hidden">
            <p class="text-label-md font-label-md text-on-surface truncate">${kAd}</p>
            <p class="text-[11px] text-on-surface-variant flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-secondary inline-block"></span>${rolMetni}</p>
          </div>
        </div>
      </div>
    </aside>
    <div id="yanKatman" class="fixed inset-0 bg-black/40 z-40 hidden md:hidden"></div>
    <div class="md:ml-[260px] min-h-screen flex flex-col">
      <header class="stitch sticky top-0 z-30 w-full bg-surface border-b border-outline-variant shadow-sm flex justify-between items-center gap-4 px-lg py-3">
        <div class="flex items-center gap-3 min-w-0">
          <button id="menuToggle" class="md:hidden text-primary shrink-0" aria-label="Menü">${mat('menu')}</button>
          ${switcherHtml}
          <h2 class="text-headline-sm font-bold text-primary tracking-tight truncate hidden lg:block">${sayfaAdi}</h2>
        </div>
        <div class="flex items-center gap-4 shrink-0">
          <div class="hidden sm:flex items-center bg-surface-container-low px-4 py-2 rounded-full border border-outline-variant w-56 lg:w-64 relative">
            ${mat('search', 'text-on-surface-variant')}
            <input id="aramaInput" type="search" autocomplete="off" placeholder="Müşteri ara (ad / telefon)" class="bg-transparent border-none focus:ring-0 focus:outline-none text-body-md w-full ml-2" />
            <div id="aramaSonuc" class="ara-sonuc gizli"></div>
          </div>
          ${yeniEylemHtml}
          <button id="bildirimZil" class="relative text-on-surface-variant hover:text-primary transition-colors flex" title="Bildirimler">
            ${mat('notifications')}
            <span id="bildirimNokta" class="hidden absolute top-0 right-0 w-2 h-2 bg-error rounded-full"></span>
          </button>
          <a href="profil.html" class="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-sm hover:ring-2 hover:ring-primary/30 transition-all" title="${kAd} · ${rolMetni} — Profilim">${basHarf(kAd)}</a>
          <button id="ustCikis" class="text-on-surface-variant hover:text-error transition-colors" title="Çıkış">${mat('logout')}</button>
        </div>
      </header>
    </div>`

  const anaWrap = app.querySelector('.md\\:ml-\\[260px\\]')
  icerik.parentNode.insertBefore(app.firstElementChild, icerik) // aside
  const katman = app.querySelector('#yanKatman'); icerik.parentNode.insertBefore(katman, icerik)
  icerik.parentNode.insertBefore(anaWrap, icerik)
  anaWrap.appendChild(icerik)

  document.getElementById('ustCikis')?.addEventListener('click', signOut)

  const rolSec = document.getElementById('rolOnizleSec')
  if (rolSec) {
    rolSec.value = danisman._onizleme ? danisman.rol : 'gercek'
    rolSec.addEventListener('change', () =>
      rolSec.value === 'gercek' ? window.rolSifirla() : window.rolOnizle(rolSec.value))
  }
  // Önizleme aktifken belirgin şerit — master, test modunda olduğunu unutmasın.
  if (danisman._onizleme) {
    const serit = document.createElement('div')
    serit.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-amber-100 text-amber-950 border border-amber-300 text-label-sm font-bold pl-4 pr-2 py-2 rounded-full shadow-lg flex items-center gap-3'
    serit.innerHTML = `<span class="flex items-center gap-1.5">${mat('visibility', 'text-[18px]')} Rol önizleme: ${ROL_ETIKET[danisman.rol] || 'Danışman'}</span>
      <button id="onizlemeKapat" class="bg-amber-950 text-amber-50 px-3 py-1.5 rounded-full text-label-sm font-bold hover:bg-amber-900 transition-colors">Gerçek rolüme dön</button>`
    document.body.appendChild(serit)
    document.getElementById('onizlemeKapat')?.addEventListener('click', () => window.rolSifirla())
  }

  const aramaInput = document.getElementById('aramaInput')
  if (aramaInput) aramaKur(aramaInput, document.getElementById('aramaSonuc'))

  const yan = document.getElementById('yan')
  const kapat = () => { yan.classList.add('-translate-x-full'); katman.classList.add('hidden') }
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    yan.classList.toggle('-translate-x-full'); katman.classList.toggle('hidden')
  })
  katman?.addEventListener('click', kapat)

  // "Yeni Eylem" dropdown aç/kapat
  const yeBtn = document.getElementById('yeniEylemBtn')
  const yeMenu = document.getElementById('yeniEylemMenu')
  if (yeBtn && yeMenu) {
    yeBtn.addEventListener('click', e => { e.stopPropagation(); yeMenu.classList.toggle('hidden') })
    document.addEventListener('click', () => yeMenu.classList.add('hidden'))
    yeMenu.addEventListener('click', e => e.stopPropagation())
  }

  // Çalışma alanı değiştirici (app-switcher) dropdown aç/kapat
  const msBtn = document.getElementById('modulSwitch')
  const msMenu = document.getElementById('modulMenu')
  if (msBtn && msMenu) {
    msBtn.addEventListener('click', e => { e.stopPropagation(); msMenu.classList.toggle('hidden') })
    document.addEventListener('click', () => msMenu.classList.add('hidden'))
    msMenu.addEventListener('click', e => e.stopPropagation())
  }

  // Bildirim çekmecesi (notifications_center mockup) — sağdan slide-over, gövdeye eklenir
  const drawer = document.createElement('div')
  drawer.innerHTML = `
    <div id="bildirimBackdrop" class="fixed inset-0 bg-black/30 z-[55] hidden opacity-0 transition-opacity duration-300"></div>
    <aside id="bildirimDrawer" class="fixed right-0 top-0 h-screen w-[420px] max-w-[92vw] bg-surface-container-lowest z-[56] shadow-2xl border-l border-outline-variant flex flex-col translate-x-full transition-transform duration-300" style="transition-timing-function:cubic-bezier(.4,0,.2,1)">
      <div class="p-lg border-b border-outline-variant flex items-center justify-between">
        <div><h2 class="text-headline-sm font-bold text-primary flex items-center gap-2">${mat('notifications', 'text-[22px]')} Bildirimler</h2>
          <p id="bildirimAlt" class="text-label-sm text-on-surface-variant mt-0.5">&nbsp;</p></div>
        <button id="bildirimKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex px-lg pt-3 gap-4 border-b border-outline-variant">
        <button data-btab="hepsi" class="text-label-md font-bold pb-2 border-b-2 border-primary text-primary">Tümü</button>
        <button data-btab="okunmamis" class="text-label-md font-bold pb-2 border-b-2 border-transparent text-on-surface-variant hover:text-on-surface">Okunmamış <span id="bildirimSayi" class="hidden ml-0.5 bg-primary text-white text-[10px] font-bold min-w-[16px] h-4 px-1 rounded-full items-center justify-center align-middle"></span></button>
      </div>
      <div id="bildirimListe" class="flex-1 overflow-y-auto p-lg space-y-6"></div>
      <div class="p-lg border-t border-outline-variant bg-surface-container-low flex justify-between items-center">
        <button id="bildirimHepsi" class="text-on-surface-variant text-label-md font-bold hover:text-primary">Tümünü okundu işaretle</button>
      </div>
    </aside>`
  document.body.appendChild(drawer.children[0])   // backdrop
  document.body.appendChild(drawer.children[0])   // drawer (children canlı; ilkini eklenince ikinci öne kayar)

  bildirimKur(danisman)
  sohbetWidgetKur(danisman)
  komutPaletiKur(danisman)   // global Ctrl+K komut paleti
  durgunUyariKur(danisman)   // durgun talep zorlama pop-up'ı (her açılışta kontrol)
}
