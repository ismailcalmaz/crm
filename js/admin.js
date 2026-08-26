// =====================================================================
// admin.js — MASTER ADMIN (Stitch): satır-içi personel yönetimi + teknik
//   Rol / aktif / sayfa yetkileri tabloda anlık kaydedilir.
// =====================================================================
import { supabase, SUPABASE_URL, SUPABASE_ANON } from './supabase-client.js'
import { SAYFALAR, MODULLER, etkinSayfalar, ROL_VARSAYILAN, menuYerlesimAl, menuYerlesimUygula,
  MUDUR_BIRIMLERI, DEPARTMAN_ETIKET } from './yetki.js'
// dbHata: audit_log / giris_kayitlari hata dallarında kullanılıyordu ama
// import edilmemişti — okuma hatasında dostça mesaj yerine ReferenceError
// atıyordu (7 Ağu 2026 tanımsız-çağrı taraması).
import { fmtTarihKisa, kacis, dbHata } from './veri.js'
import { mat, avatar, uyari, panoyaYaz } from './stitch-ui.js'

let benim = null, duzenlenen = null, _map = {}, _liste = [], secili = null, arama = ''
// Roller sql/83 danismanlar_rol_check ile BİREBİR — burada olmayan bir değer
// yazılırsa insert CHECK ihlaliyle sessizce düşer (CLAUDE.md §5.4).
const ROLLER = [['yonetici', 'Yönetici'], ['satis_muduru', 'Satış Müdürü'], ['danisman', 'Danışman'], ['santral', 'Santral'], ['satinalma', 'Satın Alma'], ['kredi', 'Kredi Birimi'], ['sigorta_yetkili', 'Sigorta (Yetkili)'], ['sigorta_personel', 'Sigorta (Personel)'], ['muhasebe', 'Muhasebe'], ['bilgi_islem', 'Bilgi İşlem'], ['operasyon', 'Operasyon']]
const ROL_ET = Object.fromEntries(ROLLER)

export async function adminKur(danisman) {
  benim = danisman
  izinKutulariFormCiz()
  // Rol seçeneklerini TEK KAYNAKTAN doldur (ROLLER = sql/83 CHECK listesi).
  // HTML'de elle yazılıydı ve sigorta rolleri eksikti — kod ile senkron kalsın.
  document.getElementById('rolSec').innerHTML =
    ROLLER.map(([k, ad]) => `<option value="${k}"${k === 'danisman' ? ' selected' : ''}>${ad}</option>`).join('')
  // Müdürlük birimi (sql/85) — rolden bağımsız ikinci boyut
  document.getElementById('mudurSec').innerHTML = `<option value="">— Müdür değil —</option>` +
    MUDUR_BIRIMLERI.map(b => `<option value="${b}">${DEPARTMAN_ETIKET[b] || b} Müdürü</option>`).join('')
  document.getElementById('personelForm').addEventListener('submit', kaydet)
  // Şifreli hesap (şirket Google hesabı olmayan personel)
  document.getElementById('sifreliAc')?.addEventListener('change', e =>
    document.getElementById('sifreAlanlar').classList.toggle('hidden', !e.target.checked))
  document.getElementById('sifreUret')?.addEventListener('click', () => {
    document.getElementById('sifreAlan').value = sifreUret()
  })
  document.getElementById('yeniBtn').addEventListener('click', () => formAc(null))
  document.getElementById('iptalBtn').addEventListener('click', () => document.getElementById('personelKart').classList.add('gizli'))
  document.getElementById('sifreTeslimKapat')?.addEventListener('click', () => {
    const k = document.getElementById('sifreTeslim')
    k.classList.add('gizli')
    // Şifreyi DOM'da bırakma
    document.getElementById('stSifre').textContent = ''
    document.getElementById('stEposta').textContent = ''
  })
  document.getElementById('sifreTeslim')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-kopya]'); if (!b) return
    const metin = document.getElementById(b.dataset.kopya)?.textContent || ''
    await panoyaYaz(metin, b)
  })
  document.getElementById('rolSec').addEventListener('change', rolDegisinceForm)

  document.getElementById('personelListe').addEventListener('click', e => {
    const k = e.target.closest('[data-sec]'); if (k) personelDetayAc(k.dataset.sec)
  })
  document.getElementById('personelAra')?.addEventListener('input', e => { arama = e.target.value.trim().toLocaleLowerCase('tr'); listeCiz() })

  document.getElementById('surumForm').addEventListener('submit', surumYayinla)
  document.getElementById('surumGecmis').addEventListener('click', e => {
    const b = e.target.closest('[data-surumsil]'); if (b) surumSil(b.dataset.surumsil)
  })

  document.getElementById('menuVarsayilanBtn')?.addEventListener('click', menuVarsayilan)
  menuYukle()

  // İşlem Geçmişi (audit) — RLS zaten master'a kilitli (sql/92); burada da
  // ekranı yalnız master'a açıyoruz ki başkası boş liste görüp şaşırmasın.
  document.getElementById('adYenile')?.addEventListener('click', auditYukle)
  document.getElementById('adTur')?.addEventListener('change', auditYukle)
  document.getElementById('adKisi')?.addEventListener('change', auditYukle)

  teknikBilgiCiz()
  document.getElementById('saglikYenile')?.addEventListener('click', saglikYukle)
  await Promise.all([yukle(), surumGecmisYukle(), saglikYukle()])
  if (benim?.master_admin) await auditYukle()
  else {
    const el = document.getElementById('auditListe')
    if (el) el.innerHTML = uyari('İşlem geçmişini yalnız master admin görüntüleyebilir.')
  }
}

// =====================================================================
// Menü Yerleşimi — hangi sayfa hangi modülde, hangi sırada (global ayar)
//   ayarlar.menu_yerlesim (JSON). Koddaki modül alanı varsayılan; bu ezer.
// =====================================================================
let _menu = null   // [{key,label,modul,sira}]

function menuYukle() {
  _menu = menuYerlesimAl()   // requireAuth override'ı uygulamıştı → etkin düzen
  menuCiz()
}

function menuSatir(x, i, n) {
  return `<div class="flex items-center gap-1.5 bg-white rounded-lg border border-outline-variant/70 px-2 py-1.5">
    <span class="min-w-0 flex-1 text-label-md font-semibold text-on-surface truncate">${kacis(x.label)}</span>
    <select data-mmodul="${x.key}" class="bg-surface-container-low border border-outline-variant rounded-md py-1 px-1.5 text-label-sm shrink-0">
      ${MODULLER.map(m => `<option value="${m.key}"${m.key === x.modul ? ' selected' : ''}>${kacis(m.label)}</option>`).join('')}
    </select>
    <button data-mup="${x.key}" ${i === 0 ? 'disabled' : ''} class="p-1 rounded text-on-surface-variant hover:text-primary disabled:opacity-25" title="Yukarı">${mat('arrow_upward', 'text-[16px]')}</button>
    <button data-mdown="${x.key}" ${i === n - 1 ? 'disabled' : ''} class="p-1 rounded text-on-surface-variant hover:text-primary disabled:opacity-25" title="Aşağı">${mat('arrow_downward', 'text-[16px]')}</button>
  </div>`
}

function menuCiz() {
  const kap = document.getElementById('menuYerlesim'); if (!kap) return
  kap.innerHTML = MODULLER.map(m => {
    const sayfalar = _menu.filter(x => x.modul === m.key).sort((a, b) => a.sira - b.sira)
    const satirlar = sayfalar.map((x, i) => menuSatir(x, i, sayfalar.length)).join('')
    return `<div class="rounded-xl border border-outline-variant overflow-hidden">
      <div class="px-3 py-2.5 bg-surface-container-low border-b border-outline-variant flex items-center gap-2">
        ${mat(m.ikon, 'text-primary text-[20px]')}<span class="font-bold text-on-surface">${kacis(m.label)}</span>
        <span class="ml-auto text-label-sm text-on-surface-variant">${sayfalar.length} sayfa</span>
      </div>
      <div class="p-2 space-y-1.5 bg-surface-container-lowest">${satirlar || '<p class="text-label-sm text-on-surface-variant px-2 py-4 text-center">Bu modülde sayfa yok</p>'}</div>
    </div>`
  }).join('')

  kap.querySelectorAll('[data-mmodul]').forEach(sel => sel.addEventListener('change', e => menuModulDegis(e.target.dataset.mmodul, e.target.value)))
  kap.querySelectorAll('[data-mup]').forEach(b => b.addEventListener('click', () => menuSirala(b.dataset.mup, -1)))
  kap.querySelectorAll('[data-mdown]').forEach(b => b.addEventListener('click', () => menuSirala(b.dataset.mdown, 1)))
}

function menuModulDegis(key, yeniModul) {
  const x = _menu.find(p => p.key === key); if (!x) return
  const mevcut = _menu.filter(p => p.modul === yeniModul).map(p => p.sira)
  x.modul = yeniModul
  x.sira = (mevcut.length ? Math.max(...mevcut) : 0) + 10   // yeni modülün sonuna
  menuKaydet(); menuCiz()
}

function menuSirala(key, yon) {
  const x = _menu.find(p => p.key === key); if (!x) return
  const grup = _menu.filter(p => p.modul === x.modul).sort((a, b) => a.sira - b.sira)
  const idx = grup.findIndex(p => p.key === key)
  const komsu = grup[idx + yon]
  if (!komsu) return
  const t = x.sira; x.sira = komsu.sira; komsu.sira = t   // sıra takası
  menuKaydet(); menuCiz()
}

async function menuKaydet() {
  const map = {}
  _menu.forEach(x => { map[x.key] = { modul: x.modul, sira: x.sira } })
  menuYerlesimUygula(map)   // bu oturumda anında etkili (diğer sayfalar sonraki yüklemede)
  const { error } = await supabase.from('ayarlar').upsert(
    { anahtar: 'menu_yerlesim', deger: JSON.stringify(map), aciklama: 'Menü modül yerleşimi', guncelleyen: benim.id },
    { onConflict: 'anahtar' })
  if (error) { menuDurumGoster('Kaydedilemedi: ' + error.message, true); console.error('menu yerlesim kaydet', error); return }
  menuDurumGoster('✓ Menü yerleşimi kaydedildi')
}

async function menuVarsayilan() {
  if (!confirm('Menü yerleşimi koddaki varsayılan düzene dönsün mü?')) return
  const { error } = await supabase.from('ayarlar').delete().eq('anahtar', 'menu_yerlesim')
  if (error) { menuDurumGoster('Sıfırlanamadı: ' + error.message, true); console.error('menu yerlesim sifirla', error); return }
  menuYerlesimUygula(null)
  menuYukle()
  menuDurumGoster('✓ Varsayılan düzene döndürüldü')
}

function menuDurumGoster(msg, hata = false) {
  const el = document.getElementById('menuDurum'); if (!el) return
  el.textContent = msg
  el.className = 'text-label-md font-bold shrink-0 ' + (hata ? 'text-error' : 'text-secondary')
  clearTimeout(menuDurumGoster._t)
  menuDurumGoster._t = setTimeout(() => { el.textContent = '' }, 2800)
}

function izinKutulariFormCiz() {
  document.getElementById('izinler').innerHTML = SAYFALAR.map(s =>
    `<label class="inline-flex items-center gap-1.5 cursor-pointer">
       <input type="checkbox" value="${s.key}" class="izin-kutu w-4 h-4 accent-[#5f1818]" />
       <span class="text-label-md">${kacis(s.label)}</span></label>`).join('')
}
function rolDegisinceForm() {
  const varsayilan = ROL_VARSAYILAN[document.getElementById('rolSec').value] || []
  document.querySelectorAll('.izin-kutu').forEach(k => { k.checked = varsayilan.includes(k.value) })
}

async function yukle() {
  const hedef = document.getElementById('personelListe')
  hedef.innerHTML = '<div class="p-4 text-on-surface-variant">Yükleniyor…</div>'
  const { data, error } = await supabase.from('danismanlar').select('*')
    .order('master_admin', { ascending: false }).order('ad_soyad')
  if (error) { hedef.innerHTML = uyari(`Okunamadı: ${kacis(error.message)}`); return }
  _liste = data || []
  _map = {}; _liste.forEach(d => _map[d.id] = d)
  kpiCiz(); listeCiz()
}

function kpiCiz() {
  const toplam = _liste.length
  const aktif = _liste.filter(d => d.aktif !== false).length
  const yonetim = _liste.filter(d => d.master_admin || d.rol === 'yonetici').length
  const kart = (ik, renk, etiket, deger, alt) =>
    `<div class="bg-surface-container-lowest p-lg rounded-2xl border border-outline-variant custom-shadow flex items-center gap-3">
      <div class="w-11 h-11 rounded-xl ${renk} flex items-center justify-center shrink-0">${mat(ik, 'text-[22px]')}</div>
      <div class="min-w-0"><p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p><p class="text-headline-sm font-black text-on-surface leading-tight">${deger}</p><p class="text-[11px] text-on-surface-variant">${alt}</p></div>
    </div>`
  document.getElementById('adminKpi').innerHTML =
    kart('groups', 'bg-primary-fixed text-primary', 'Toplam Personel', toplam, 'kayıtlı kullanıcı') +
    kart('check_circle', 'bg-green-100 text-green-700', 'Aktif', aktif, 'giriş yapabilir') +
    kart('block', 'bg-error-container text-error', 'Pasif', toplam - aktif, 'erişim kapalı') +
    kart('shield_person', 'bg-secondary/10 text-secondary', 'Yönetim', yonetim, 'yönetici + master')
}

function listeCiz() {
  const hedef = document.getElementById('personelListe')
  let v = _liste
  if (arama) v = v.filter(d => [d.ad_soyad, d.email].filter(Boolean).join(' ').toLocaleLowerCase('tr').includes(arama))
  document.getElementById('personelSayac').textContent = `${v.length} kişi`
  if (!v.length) { hedef.innerHTML = `<div class="p-8 text-center text-on-surface-variant">${mat('person_off', 'text-3xl opacity-30')}<p class="mt-2 text-body-md">Personel bulunamadı.</p></div>`; panelVarsayilan(v); return }
  hedef.innerHTML = v.map(kart).join('')
  panelVarsayilan(v)
}

function kart(d) {
  const master = d.master_admin === true
  const aktif = d.aktif !== false
  const sel = secili === d.id
  return `<div data-sec="${d.id}" class="group cursor-pointer bg-white rounded-xl border border-outline-variant/70 ${sel ? 'ring-2 ring-primary/30 bg-primary/5' : 'hover:shadow-md'} transition-all p-3 flex items-center gap-3">
    <div class="relative shrink-0">${avatar(d.ad_soyad, 'w-9 h-9')}<span class="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-white ${aktif ? 'bg-green-500' : 'bg-outline-variant'}"></span></div>
    <div class="min-w-0 flex-1"><p class="font-bold text-on-surface truncate">${kacis(d.ad_soyad) || '—'}</p><p class="text-[11px] text-on-surface-variant truncate">${kacis(d.email)}</p></div>
    ${master ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">MASTER</span>' : `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant shrink-0">${kacis(ROL_ET[d.rol] || d.rol)}</span>`}
    ${d.mudur_birim ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FFFBEB] text-[#B45309] border border-[#F59E0B]/30 shrink-0" title="Birim müdürü">${kacis((DEPARTMAN_ETIKET[d.mudur_birim] || d.mudur_birim).toLocaleUpperCase('tr'))} MÜDÜRÜ</span>` : ''}
  </div>`
}

function panelVarsayilan(v) {
  if (window.innerWidth < 1280) return
  if (secili && v.some(d => d.id === secili)) personelDetayAc(secili, true)
  else if (v.length) { secili = null; personelDetayAc(v[0].id, true) }
  else { secili = null; document.getElementById('personelDetay').innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center p-8 text-on-surface-variant">${mat('badge', 'text-5xl opacity-30')}<p class="mt-3 font-semibold text-on-surface">Bir personel seçin</p></div>`; document.getElementById('personelDetay').classList.remove('hidden') }
}

// Canlı menü önizleme — bu kullanıcı hangi sayfaları görecek
function onizlemeCiz(id) {
  const kap = document.getElementById('pdOnizleme'); if (!kap) return
  const d = _map[id]
  const keys = d.master_admin ? SAYFALAR.map(s => s.key) : [...document.querySelectorAll(`[data-yetki="${id}"]:checked`)].map(k => k.value)
  const gorunen = SAYFALAR.filter(s => keys.includes(s.key))
  kap.innerHTML = gorunen.length
    ? gorunen.map(s => `<span class="inline-flex items-center gap-1 bg-primary-fixed text-primary text-label-sm font-bold px-2.5 py-1 rounded-full">${mat('check', 'text-[14px]')} ${kacis(s.label)}</span>`).join('')
      + `<span class="inline-flex items-center gap-1 bg-surface-container text-on-surface-variant text-label-sm px-2.5 py-1 rounded-full">Yenilikler</span>${d.master_admin ? '<span class="inline-flex items-center gap-1 bg-surface-container text-on-surface-variant text-label-sm px-2.5 py-1 rounded-full">Master Admin</span>' : ''}`
    : '<span class="text-body-md text-on-surface-variant">Hiçbir sayfa seçili değil — kullanıcı yalnızca Yenilikler’i görür.</span>'
}

function personelDetayAc(id, sessiz) {
  const d = _map[id]; if (!d) return
  secili = id
  const master = d.master_admin === true
  const self = d.id === benim.id
  const kilit = master || self
  const acik = etkinSayfalar(d)
  const panel = document.getElementById('personelDetay')
  const katman = document.getElementById('personelDetayKatman')

  const rolHtml = master
    ? '<span class="px-3 py-1 rounded-full text-label-sm font-bold bg-primary/10 text-primary">MASTER ADMIN</span>'
    : `<select data-rol="${d.id}" class="bg-surface-container-low border border-outline-variant rounded-lg py-2 px-2.5 text-body-md">${ROLLER.map(([v, l]) => `<option value="${v}"${d.rol === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
  const toggle = `<label class="relative inline-flex items-center ${kilit ? 'opacity-50' : 'cursor-pointer'}">
    <input type="checkbox" data-aktif="${d.id}" class="sr-only peer" ${d.aktif !== false ? 'checked' : ''} ${kilit ? 'disabled' : ''}>
    <div class="w-11 h-6 bg-outline-variant rounded-full peer peer-checked:bg-primary peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:rounded-full after:h-[18px] after:w-[18px] after:transition-all"></div>
  </label>`
  const yetkiHtml = master
    ? '<p class="text-body-md text-on-surface-variant italic">Master admin tüm sayfaları görür.</p>'
    : `<div class="grid grid-cols-2 gap-1.5">${SAYFALAR.map(s =>
        `<label class="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-outline-variant cursor-pointer hover:border-primary text-label-md"><input type="checkbox" data-yetki="${d.id}" value="${s.key}" class="w-4 h-4 accent-[#5f1818]" ${acik.includes(s.key) ? 'checked' : ''}>${kacis(s.label)}</label>`).join('')}</div>`
  const sablonlar = master ? '' : `<div class="flex flex-wrap gap-1.5 mt-2">${ROLLER.map(([v, l]) => `<button data-sablon="${v}" class="text-label-sm font-bold px-2.5 py-1 rounded-full border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary">${l} şablonu</button>`).join('')}</div>`

  panel.innerHTML = `
    <div class="p-lg border-b border-outline-variant">
      <div class="flex justify-between items-start gap-3">
        <div class="flex items-center gap-3 min-w-0">${avatar(d.ad_soyad, 'w-12 h-12')}
          <div class="min-w-0"><h3 class="text-title-lg font-bold text-on-surface truncate">${kacis(d.ad_soyad) || '—'}</h3>
            <p class="text-label-md text-on-surface-variant truncate">${kacis(d.email)}</p></div></div>
        <button id="pdKapat" class="p-1.5 hover:bg-surface-container-high rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex items-center gap-4 mt-3 flex-wrap">
        <div class="flex items-center gap-2">${rolHtml}</div>
        <label class="flex items-center gap-2 text-label-md text-on-surface-variant">${toggle} <span>${d.aktif !== false ? 'Aktif' : 'Pasif'}</span></label>
        ${d.telefon ? `<a href="tel:${kacis(d.telefon)}" class="text-label-md text-primary font-bold inline-flex items-center gap-1">${mat('call', 'text-[16px]')} ${kacis(d.telefon)}</a>` : ''}
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-lg space-y-5">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-2">Sayfa Yetkileri</p>
        ${yetkiHtml}
        ${sablonlar}
      </div>
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-2">${mat('visibility', 'text-[15px]')} Bu kullanıcı şu menüyü görecek</p>
        <div id="pdOnizleme" class="flex flex-wrap gap-1.5"></div>
      </div>
    </div>
    <div class="p-lg border-t border-outline-variant bg-surface-container-lowest">
      <button id="pdDuzenle" class="w-full bg-surface-container text-primary py-2.5 rounded-lg text-label-md font-bold flex items-center justify-center gap-1.5 hover:bg-surface-container-high">${mat('edit', 'text-[18px]')} Bilgileri Düzenle</button>
    </div>`

  panel.classList.remove('hidden')
  // ⚠️ MOBİLDE KAYDIRMA (19 Ağu 2026 — "kullanıcıya tıkladığımda sayfa kaymıyor").
  //    Panelin sınıfı `hidden xl:flex flex-col ...`. `hidden` kaldırılınca
  //    xl ALTINDA hiçbir display sınıfı kalmıyor → <aside> `display:block`
  //    oluyor. O zaman `flex-col` ve içerideki `flex-1 overflow-y-auto`
  //    hiç uygulanmıyor; gövde yüksekliği sınırlanmadığı için kaydırma
  //    kutusu hiç oluşmuyor, kabuktaki `overflow-hidden` de taşanı
  //    kırpıyordu. Panel açılıyor ama içi kaymıyordu.
  //    Ayrıca HTML'de satır içi `max-height:calc(100vh - 340px)` var; o
  //    masaüstü iki-sütun yerleşimi için. Tam ekran çekmecede 340 px'i
  //    boşuna kesiyor — mobilde kaldırılıp kapanışta geri konuyor.
  const MOBIL_SINIF = ['flex', 'fixed', 'inset-y-0', 'right-0', 'z-50', 'w-[94vw]', 'max-w-[460px]', 'rounded-none']
  const eskiMaxH = panel.style.maxHeight
  if (window.innerWidth < 1280) {
    panel.classList.add(...MOBIL_SINIF)
    panel.style.maxHeight = 'none'
    katman.classList.remove('hidden')
  }
  const kapat = () => {
    panel.classList.add('hidden')
    panel.classList.remove(...MOBIL_SINIF)
    panel.style.maxHeight = eskiMaxH
    katman.classList.add('hidden'); secili = null; listeCiz()
  }
  document.getElementById('pdKapat').addEventListener('click', kapat)
  katman.onclick = kapat
  onizlemeCiz(id)

  panel.querySelector('[data-rol]')?.addEventListener('change', e => rolKaydet(d.id, e.target.value))
  panel.querySelector('[data-aktif]')?.addEventListener('change', e => aktifKaydet(d.id, e.target.checked))
  panel.querySelectorAll('[data-yetki]').forEach(k => k.addEventListener('change', () => { yetkiKaydet(d.id); onizlemeCiz(d.id) }))
  panel.querySelectorAll('[data-sablon]').forEach(b => b.addEventListener('click', () => {
    const varsayilan = ROL_VARSAYILAN[b.dataset.sablon] || []
    panel.querySelectorAll(`[data-yetki="${d.id}"]`).forEach(k => { k.checked = varsayilan.includes(k.value) })
    yetkiKaydet(d.id); onizlemeCiz(d.id)
  }))
  document.getElementById('pdDuzenle').addEventListener('click', () => formAc(d))
}

function durumGoster(msg, hata = false) {
  const el = document.getElementById('adminDurum')
  el.textContent = msg
  el.className = 'text-label-md font-bold ' + (hata ? 'text-error' : 'text-secondary')
  clearTimeout(durumGoster._t)
  durumGoster._t = setTimeout(() => { el.textContent = '' }, 2500)
}

// Kartı yerinde tazele (panel'i bozmadan; tıklama delegasyonu container'da)
function kartYenile(id) {
  const el = document.querySelector(`[data-sec="${id}"]`)
  if (el && _map[id]) el.outerHTML = kart(_map[id])
}
async function rolKaydet(id, rol) {
  const { error } = await supabase.from('danismanlar').update({ rol }).eq('id', id)
  if (error) return durumGoster('Rol kaydedilemedi: ' + error.message, true)
  if (_map[id]) _map[id].rol = rol
  kartYenile(id); durumGoster('✓ Rol güncellendi')
}
async function aktifKaydet(id, aktif) {
  const { error } = await supabase.from('danismanlar').update({ aktif }).eq('id', id)
  if (error) return durumGoster('Durum kaydedilemedi: ' + error.message, true)
  if (_map[id]) _map[id].aktif = aktif
  kpiCiz(); kartYenile(id); durumGoster(aktif ? '✓ Aktifleştirildi' : '✓ Pasifleştirildi')
}
async function yetkiKaydet(id) {
  const yetkiler = [...document.querySelectorAll(`[data-yetki="${id}"]:checked`)].map(k => k.value)
  const { error } = await supabase.from('danismanlar').update({ yetkiler }).eq('id', id)
  if (error) return durumGoster('Yetki kaydedilemedi: ' + error.message, true)
  if (_map[id]) _map[id].yetkiler = yetkiler
  durumGoster('✓ Yetkiler güncellendi')
}

// --- Ekleme/düzenleme formu ---
function formAc(d) {
  duzenlenen = d?.id || null
  const f = document.getElementById('personelForm')
  f.email.value = d?.email || ''
  f.ad_soyad.value = d?.ad_soyad || ''
  f.rolSec.value = d?.rol || 'danisman'
  f.mudurSec.value = d?.mudur_birim || ''
  f.telefon.value = d?.telefon || ''
  f.fiyat_araligi.value = d?.fiyat_araligi || ''
  f.aktif.checked = d ? d.aktif !== false : true
  const acik = d ? etkinSayfalar(d) : (ROL_VARSAYILAN['danisman'] || [])
  document.querySelectorAll('.izin-kutu').forEach(k => { k.checked = acik.includes(k.value) })
  document.getElementById('formBaslik').textContent = d ? `Düzenle: ${d.ad_soyad}` : 'Yeni Personel'
  document.getElementById('emailAlan').disabled = !!d
  document.getElementById('formDurum').textContent = ''
  // Şifre bölümünü sıfırla — düzenlemede etiket "şifre sıfırla" olur
  const sAc = document.getElementById('sifreliAc'), sAlan = document.getElementById('sifreAlan')
  if (sAc) { sAc.checked = false; document.getElementById('sifreAlanlar').classList.add('hidden') }
  if (sAlan) sAlan.value = ''
  const sEt = document.querySelector('#sifreliAc + span')
  if (sEt) sEt.textContent = d ? 'Bu kişiye şifre belirle / sıfırla' : 'Şirket e-postası yok — şifreyle giriş yapsın'
  const kart = document.getElementById('personelKart')
  kart.classList.remove('gizli')
  kart.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// Edge function hatasının GERÇEK sebebini çıkar.
//
// ⚠️ 4 Ağu 2026: supabase-js, fonksiyon non-2xx dönünce gövdeyi OKUMAZ —
//   `error.message` her zaman "Edge Function returned a non-2xx status code"
//   olur, fonksiyonun yazdığı `{hata: "..."}` kaybolur. Göksenil muhasebe
//   hesabı açamadı ve ekranda yalnız bu genel cümleyi gördü; sebep
//   (fonksiyonun rol beyaz listesinde 'muhasebe' yoktu) hiçbir yerde
//   görünmüyordu. FunctionsHttpError'da yanıt `error.context` içinde durur.
async function fnHata(fe, data) {
  if (data?.hata) return data.hata
  try {
    const govde = await fe?.context?.json?.()
    if (govde?.hata) return govde.hata
  } catch (e) { console.error('[admin] fn hata govdesi okunamadi', e) }
  return fe?.message || 'bilinmeyen hata'
}

async function kaydet(e) {
  e.preventDefault()
  const f = e.target
  const durum = document.getElementById('formDurum')
  const izinler = [...document.querySelectorAll('.izin-kutu:checked')].map(k => k.value)
  const kayit = {
    email: f.email.value.trim().toLowerCase(),
    ad_soyad: f.ad_soyad.value.trim(),
    rol: f.rolSec.value,
    mudur_birim: f.mudurSec.value || null,   // sql/85 — rolden bağımsız müdürlük
    telefon: f.telefon.value.trim() || null,
    fiyat_araligi: f.fiyat_araligi.value.trim() || null,
    aktif: f.aktif.checked,
    yetkiler: izinler,
  }
  if (!kayit.email || !kayit.ad_soyad) { durum.className = 'text-label-sm text-error font-bold'; durum.textContent = 'E-posta ve ad soyad zorunlu.'; return }

  const sifreliMi = document.getElementById('sifreliAc')?.checked
  const sifre = document.getElementById('sifreAlan')?.value || ''
  if (sifreliMi && sifre.length < 8) {
    durum.className = 'text-label-sm text-error font-bold'; durum.textContent = 'Şifre en az 8 karakter olmalı.'; return
  }
  durum.className = 'text-label-sm text-on-surface-variant'; durum.textContent = 'Kaydediliyor…'

  // YENİ personel + şifreli hesap → auth kaydı frontend'den açılamaz (service_role
  // gerekir). personel-hesap edge function auth.users + danismanlar satırını
  // BİRLİKTE açar; biri olmazsa diğerini geri alır (yetim kayıt kalmaz).
  if (!duzenlenen && sifreliMi) {
    const { data, error: fe } = await supabase.functions.invoke('personel-hesap', {
      body: { islem: 'olustur', email: kayit.email, ad_soyad: kayit.ad_soyad, rol: kayit.rol, sifre, yetkiler: kayit.yetkiler },
    })
    if (fe || data?.hata) {
      console.error('[admin] personel-hesap olustur', fe, data)
      durum.className = 'text-label-sm text-error font-bold'
      durum.textContent = 'Hesap açılamadı: ' + await fnHata(fe, data)
      return
    }
    // Telefon/fiyat aralığı edge function'da yok — burada tamamla
    const ek = { telefon: kayit.telefon, fiyat_araligi: kayit.fiyat_araligi, aktif: kayit.aktif, mudur_birim: kayit.mudur_birim }
    const { error: ue } = await supabase.from('danismanlar').update(ek).eq('email', kayit.email)
    if (ue) console.error('[admin] ek alanlar', ue)
    document.getElementById('personelKart').classList.add('gizli')
    sifreTeslimGoster(kayit.email, sifre)
    await yukle()
    return
  }

  let error
  if (duzenlenen) ({ error } = await supabase.from('danismanlar').update(kayit).eq('id', duzenlenen))
  else ({ error } = await supabase.from('danismanlar').insert(kayit))
  if (error) { durum.className = 'text-label-sm text-error font-bold'; durum.textContent = 'Hata: ' + error.message; return }

  // Mevcut personele şifre belirle / sıfırla
  if (duzenlenen && sifreliMi) {
    const { data, error: fe } = await supabase.functions.invoke('personel-hesap', {
      body: { islem: 'sifre', email: kayit.email, sifre },
    })
    if (fe || data?.hata) {
      console.error('[admin] personel-hesap sifre', fe, data)
      durum.className = 'text-label-sm text-error font-bold'
      durum.textContent = 'Kayıt güncellendi ama şifre değiştirilemedi: ' + await fnHata(fe, data)
      return
    }
  }
  document.getElementById('personelKart').classList.add('gizli')
  if (sifreliMi) sifreTeslimGoster(kayit.email, sifre)
  else durumGoster('✓ Kaydedildi')
  await yukle()
}

// ⚠️ Şifre sunucuda HASH'li saklanır — kaydedildikten sonra hiçbir yerden
// geri okunamaz. Eskiden kart kaydeder kaydetmez kapanıyor, durum mesajı da
// 2.5 sn'de siliniyordu; üretilen şifre ekrandan kaybolup kimse göremiyordu
// (canlıda tam bu yaşandı: hesap açıldı, sonra şifre bir daha değiştirildi ve
// hangisinin geçerli olduğu belirsizleşti). Bu kutu KAPATILANA KADAR durur.
function sifreTeslimGoster(email, sifre) {
  const kutu = document.getElementById('sifreTeslim')
  if (!kutu) return
  document.getElementById('stEposta').textContent = email || ''
  document.getElementById('stSifre').textContent = sifre || ''
  kutu.classList.remove('gizli')
  kutu.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// Okunabilir güçlü şifre (karışan karakterler yok: I l 1 O 0)
function sifreUret() {
  const harf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'
  const rakam = '23456789'
  const isaret = '!?*-+'
  const havuz = harf + rakam + isaret
  const rnd = n => crypto.getRandomValues(new Uint32Array(n))
  const r = rnd(12)
  let s = harf[r[0] % harf.length] + rakam[r[1] % rakam.length] + isaret[r[2] % isaret.length]
  for (let i = 3; i < 12; i++) s += havuz[r[i] % havuz.length]
  return s
}

// --- Sürüm notu / duyuru yayınla ---
function surumDurumGoster(msg, hata = false) {
  const el = document.getElementById('surumDurum')
  el.textContent = msg
  el.className = 'text-label-md font-bold ' + (hata ? 'text-error' : 'text-secondary')
  clearTimeout(surumDurumGoster._t)
  surumDurumGoster._t = setTimeout(() => { el.textContent = '' }, 3500)
}

async function surumYayinla(e) {
  e.preventDefault()
  const etiket = document.getElementById('surumEtiket').value.trim()
  const baslik = document.getElementById('surumBaslik').value.trim()
  const icerik = document.getElementById('surumIcerik').value.trim()
  if (!baslik || !icerik) { surumDurumGoster('Başlık ve içerik zorunlu.', true); return }

  const btn = document.getElementById('surumYayinBtn')
  btn.disabled = true; surumDurumGoster('Yayınlanıyor…')
  const { error } = await supabase.rpc('surum_notu_yayinla', {
    p_surum: etiket, p_baslik: baslik, p_icerik: icerik,
  })
  btn.disabled = false
  if (error) { surumDurumGoster('Hata: ' + error.message, true); return }
  document.getElementById('surumForm').reset()
  surumDurumGoster('✓ Yayınlandı, herkese bildirim düştü')
  await surumGecmisYukle()
}

async function surumGecmisYukle() {
  const kap = document.getElementById('surumGecmis')
  const { data, error } = await supabase.from('surum_notlari')
    .select('id, surum, baslik, created_at').order('created_at', { ascending: false }).limit(10)
  if (error) {   // tablo yok (sql/13 çalışmadı) → sessizce bilgilendir
    kap.innerHTML = `<p class="text-xs text-on-surface-variant">Sürüm notları tablosu henüz oluşturulmadı (sql/13 çalıştırın).</p>`
    return
  }
  if (!data || !data.length) { kap.innerHTML = '<p class="text-xs text-on-surface-variant">Henüz yayınlanmış not yok.</p>'; return }
  kap.innerHTML = data.map(n => `
    <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/60">
      <div class="flex items-center gap-2 min-w-0">
        ${n.surum ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary shrink-0">${kacis(n.surum)}</span>` : ''}
        <span class="font-semibold truncate">${kacis(n.baslik)}</span>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <span class="text-xs text-on-surface-variant">${fmtTarihKisa(n.created_at)}</span>
        <button data-surumsil="${n.id}" title="Sil" class="text-on-surface-variant hover:text-error">${mat('delete', 'text-[18px]')}</button>
      </div>
    </div>`).join('')
}

async function surumSil(id) {
  if (!confirm('Bu sürüm notu silinsin mi? (Düşen bildirimler kalır.)')) return
  const { error } = await supabase.from('surum_notlari').delete().eq('id', id)
  if (error) { surumDurumGoster('Silinemedi: ' + error.message, true); return }
  surumDurumGoster('✓ Silindi')
  await surumGecmisYukle()
}

// --- Teknik / config ---
// =====================================================================
// SİSTEM SAĞLIĞI (sql/212)
//
// Göksenil, 17 Ağu 2026. Ekranın tek veri kaynağı sistem_saglik_ozet();
// mantık sunucuda, burada yalnız çizim var.
//
// ⚠️ ENTEGRASYONLARDA ÖLÇÜT TAŞIMA DEĞİL ETKİ. 17 Ağu'da pg_net'te
//    "guncel-satis-senk 6/6 timeout" görülüp "senkron çalışmıyor" denildi;
//    yanlıştı — tabloya yazma o saniyede olmuştu. Fonksiyon 5 sn'yi aşıyor,
//    pg_net beklemeyi bırakıyor, iş arkada bitiyor. Bu yüzden kartlar
//    "hedef tabloya veri düştü mü" sorusunu sorar; pg_net sayıları yalnız
//    bağlam olarak, ayrı ve nötr bir satırda gösterilir.
// =====================================================================
const SAGLIK_RENK = {
  iyi:        'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30',
  uyari:      'bg-amber-50 text-amber-800 border-amber-300/50',
  hata:       'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/40',
  bilinmiyor: 'bg-surface-container-high text-on-surface-variant border-outline-variant',
}
const SAGLIK_IKON = { iyi: 'check_circle', uyari: 'warning', hata: 'error', bilinmiyor: 'help' }
const SAGLIK_ET = { iyi: 'İyi', uyari: 'Dikkat', hata: 'Sorun', bilinmiyor: 'Bilinmiyor' }

const sRozet = d => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${
  SAGLIK_RENK[d] || SAGLIK_RENK.bilinmiyor}">${mat(SAGLIK_IKON[d] || 'help', 'text-[13px]')} ${SAGLIK_ET[d] || d}</span>`

// Yaşı insan diliyle yaz — "1836 dk" kimseye bir şey söylemez.
function sYas(dk) {
  if (dk == null) return '—'
  if (dk < 1) return 'az önce'
  if (dk < 60) return `${dk} dk önce`
  const s = Math.floor(dk / 60)
  if (s < 24) return `${s} saat önce`
  return `${Math.floor(s / 24)} gün önce`
}

async function saglikYukle() {
  const kap = document.getElementById('saglik')
  if (!kap) return
  kap.innerHTML = `<div class="py-6 text-center text-on-surface-variant text-body-md">Sağlık verisi okunuyor…</div>`
  const { data, error } = await supabase.rpc('sistem_saglik_ozet')
  if (error) {
    dbHata('sistem_saglik_ozet', error)
    kap.innerHTML = uyari('Sağlık verisi okunamadı: ' + kacis(error.message))
    return
  }
  if (!data?.yetki) {
    kap.innerHTML = uyari('Sistem sağlığını yalnız master admin ve bilgi işlem görüntüleyebilir.')
    return
  }
  const z = document.getElementById('saglikZaman')
  if (z) z.textContent = 'Ölçüm: ' + new Date(data.olcum_zamani).toLocaleString('tr-TR')

  const kutu = (baslik, ikon, icerik) => `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3">
      <div class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant flex items-center gap-1 mb-2">
        ${mat(ikon, 'text-[15px]')} ${kacis(baslik)}</div>
      ${icerik}
    </div>`

  // ── Entegrasyonlar: etkiye bakan kartlar
  const ent = (data.entegrasyonlar || []).map(e => `
    <div class="flex items-start gap-2 py-1.5 border-b border-outline-variant/50 last:border-0">
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-bold text-on-surface">${kacis(e.ad)}</div>
        <div class="text-[11px] text-on-surface-variant">${kacis(e.olcut)}: <b>${sYas(e.yas_dk)}</b>${
          e.bekleyen != null ? ` · kuyrukta ${e.bekleyen}` : ''}${
          e.hatali ? ` · <span class="text-error font-bold">hatalı ${e.hatali}</span>` : ''}${
          e.yetkisiz_24s ? ` · yetkisiz deneme ${e.yetkisiz_24s}` : ''}</div>
        ${e.not ? `<div class="text-[10px] text-on-surface-variant/80 mt-0.5">${kacis(e.not)}</div>` : ''}
      </div>
      ${sRozet(e.durum)}
    </div>`).join('')

  // ── Cron: son koşu BİRİNCİL, durum ikincil (bkz. üstteki not)
  const cron = (data.cron || []).map(c => {
    const d = !c.aktif ? 'bilinmiyor' : c.hata_24s > 0 ? 'hata' : 'iyi'
    return `<tr class="border-b border-outline-variant/40 last:border-0">
      <td class="py-1 pr-2 text-[12px] font-bold text-on-surface">${kacis(c.ad)}</td>
      <td class="py-1 pr-2 text-[11px] text-on-surface-variant font-mono">${kacis(c.program)}</td>
      <td class="py-1 pr-2 text-[11px] text-on-surface-variant">${sYas(c.gecikme_dk)}</td>
      <td class="py-1 pr-2 text-[11px] ${c.hata_24s > 0 ? 'text-error font-bold' : 'text-on-surface-variant'}">${c.hata_24s || 0}</td>
      <td class="py-1 text-right">${sRozet(d)}</td>
    </tr>`
  }).join('')

  const g = data.giden || {}
  const veri = (data.veri || []).map(v => `
    <div class="flex items-center gap-2 py-1.5 border-b border-outline-variant/50 last:border-0">
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-bold text-on-surface">${kacis(v.ad)}</div>
        ${v.not ? `<div class="text-[10px] text-on-surface-variant">${kacis(v.not)}</div>` : ''}
      </div>
      <span class="text-title-md font-black ${v.durum === 'iyi' ? 'text-[#047857]' : v.durum === 'hata' ? 'text-error' : 'text-amber-700'}">${v.deger}</span>
      ${sRozet(v.durum)}
    </div>`).join('')

  const dis = (data.dis_servis || []).length
    ? data.dis_servis.map(s => {
        const d = s.detay || {}
        const alt = s.kaynak === 'supabase' ? (d.aciklama || '—')
          : s.kaynak === 'github_repo' ? ('son push: ' + (d.son_push ? new Date(d.son_push).toLocaleString('tr-TR') : '—'))
          : s.kaynak === 'github_actions' ? `son ${(d.son_kosular || []).length} yayın · başarısız ${d.basarisiz ?? 0}`
          : '—'
        return `<div class="flex items-center gap-2 py-1.5 border-b border-outline-variant/50 last:border-0">
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-bold text-on-surface">${kacis(s.kaynak)}</div>
            <div class="text-[11px] text-on-surface-variant truncate">${kacis(alt)}</div>
          </div>${sRozet(s.durum)}</div>`
      }).join('')
    : `<div class="text-[12px] text-on-surface-variant py-2">Toplayıcı henüz çalışmadı (saat başı 40'ta).</div>`

  // ── ÖZET ŞERİDİ: sorun varsa ADIYLA söyler ────────────────────────────
  // ⚠️ Detay bir <details> içine alındı. Tüm kartlar açık dururken bölüm
  //    dar ekranda çok uzuyor ve personel yönetimini ekrandan itiyordu.
  //    Şerit tek bakışta durumu verir; "18 iyi" demek yetmez, DİKKAT olanın
  //    adı yazılmazsa kullanıcı neyin bozuk olduğunu bulmak için açmak
  //    zorunda kalır — o da özetin amacını bozar.
  const hepsi = [
    ...(data.entegrasyonlar || []).map(x => ({ ad: x.ad, durum: x.durum })),
    ...(data.dis_servis || []).map(x => ({ ad: x.kaynak, durum: x.durum })),
    ...(data.veri || []).map(x => ({ ad: x.ad, durum: x.durum })),
    ...(data.cron || []).map(x => ({ ad: x.ad, durum: x.hata_24s > 0 ? 'hata' : 'iyi' })),
  ]
  const say = { iyi: 0, uyari: 0, hata: 0, bilinmiyor: 0 }
  hepsi.forEach(x => { say[x.durum] = (say[x.durum] || 0) + 1 })
  const sorunlu = hepsi.filter(x => x.durum === 'hata' || x.durum === 'uyari')
  const genel = say.hata ? 'hata' : say.uyari ? 'uyari' : say.bilinmiyor ? 'bilinmiyor' : 'iyi'

  const serit = `
    <div class="flex items-center gap-3 flex-wrap mb-3">
      ${sRozet(genel)}
      <span class="text-[12px] text-on-surface-variant">
        ${say.iyi} iyi${say.uyari ? ` · <b class="text-amber-700">${say.uyari} dikkat</b>` : ''}${
        say.hata ? ` · <b class="text-error">${say.hata} sorun</b>` : ''}${
        say.bilinmiyor ? ` · ${say.bilinmiyor} bilinmiyor` : ''}
      </span>
      ${sorunlu.length ? `<span class="text-[12px] text-on-surface">→ ${
        sorunlu.slice(0, 4).map(x => kacis(x.ad)).join(' · ')}${sorunlu.length > 4 ? ' …' : ''}</span>` : ''}
    </div>`

  kap.innerHTML = serit + `
    <details ${genel === 'iyi' ? '' : 'open'} class="group">
      <summary class="cursor-pointer select-none text-[12px] font-bold text-primary hover:opacity-80 list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1">
        <span class="material-symbols-outlined text-[16px]" id="saglikOk">expand_more</span> Ayrıntı
      </summary>
      <div class="mt-3">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      ${kutu('Entegrasyonlar', 'sync_alt', ent || '<div class="text-[12px] text-on-surface-variant">—</div>')}
      ${kutu('Dış servisler', 'cloud', dis)}
      ${kutu('Veri sağlığı', 'fact_check', veri || '<div class="text-[12px] text-on-surface-variant">—</div>')}
      ${kutu('Giden çağrılar', 'call_made', `
        <div class="flex flex-wrap gap-4 text-[12px]">
          <span>Toplam <b class="text-on-surface">${g.toplam ?? 0}</b></span>
          <span>Başarılı <b class="text-[#047857]">${g.basarili ?? 0}</b></span>
          <span>Zaman aşımı <b class="${g.zaman_asimi ? 'text-amber-700' : 'text-on-surface'}">${g.zaman_asimi ?? 0}</b></span>
          <span>Hata <b class="${g.diger_hata ? 'text-error' : 'text-on-surface'}">${g.diger_hata ?? 0}</b></span>
        </div>
        <div class="text-[10px] text-on-surface-variant mt-1.5">${kacis(g.not || '')}</div>
        <div class="text-[10px] text-on-surface-variant mt-1">Zaman aşımı tek başına arıza değildir — üstteki entegrasyon kartları asıl ölçüttür.</div>`)}
    </div>
    <div class="mt-3">
      ${kutu('Zamanlanmış işler', 'schedule', `<div class="overflow-x-auto"><table class="w-full text-left">
        <thead><tr class="text-[10px] uppercase tracking-wide text-on-surface-variant">
          <th class="pb-1 pr-2">İş</th><th class="pb-1 pr-2">Program</th><th class="pb-1 pr-2">Son koşu</th><th class="pb-1 pr-2">24s hata</th><th class="pb-1 text-right">Durum</th>
        </tr></thead><tbody>${cron}</tbody></table></div>`)}
    </div>
      </div>
    </details>`

  // Ok yönü CSS ile DEĞİL ikon değiştirilerek — Tailwind CDN `group-open:`
  // varyantını üretmiyor (17 Ağu'da stok sayfasında ölçüldü, transform
  // kimlik matrisi kalıyordu). Build adımı yok, üretilmeyen sınıfa güvenilmez.
  const det = kap.querySelector('details')
  const okEl = document.getElementById('saglikOk')
  const okGuncelle = () => { if (okEl) okEl.textContent = det?.open ? 'expand_less' : 'expand_more' }
  okGuncelle()
  det?.addEventListener('toggle', okGuncelle)
}

function teknikBilgiCiz() {
  const mask = s => s ? s.slice(0, 12) + '…' + s.slice(-6) : '—'
  const ref = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] || '—'
  const satir = (k, v) => `<tr class="border-b border-outline-variant/40"><td class="px-md py-2.5 font-bold whitespace-nowrap align-top">${kacis(k)}</td><td class="px-md py-2.5 break-all text-on-surface-variant">${v}</td></tr>`
  document.getElementById('teknik').innerHTML = `<div class="overflow-x-auto"><table class="w-full text-left text-body-md">
    ${satir('Supabase URL', kacis(SUPABASE_URL))}
    ${satir('Proje Ref', kacis(ref))}
    ${satir('anon key (public)', '<code class="text-xs">' + kacis(mask(SUPABASE_ANON)) + '</code>')}
    ${satir('Tablolar', 'danismanlar, talepler, gorusme_notlari, web_satis, web_takas, web_iletisim, mesajlar, direkt_mesajlar, degerleme_talepleri')}
    ${satir('Stok kaynağı', 'araclar (SİTE projesi, salt-okunur)')}
    ${satir('Realtime', 'mesajlar, direkt_mesajlar')}
    ${satir('Roller', 'yonetici, danisman, santral (+ master_admin bayrağı)')}
    ${satir('Sayfa anahtarları', SAYFALAR.map(s => s.key).join(', '))}
    ${satir('RLS', 'Tüm tablolarda açık. danismanlar yazma → is_master()')}
  </table></div>
  <p class="px-md py-3 text-xs text-on-surface-variant">⚠️ service_role anahtarı burada tutulmaz — o yalnızca robotların sunucu ortamında bulunur.</p>`
}

// =====================================================================
// İŞLEM GEÇMİŞİ (audit_log) — YALNIZ MASTER ADMIN (RLS sql/92)
//   BR-0218: tarih · kullanıcı · departman · işlem türü · eski/yeni değer
//   · IP · cihaz. Kayıtlar silinemez/değiştirilemez (yetki DB'de kapalı).
// =====================================================================
const AUDIT_ETIKET = {
  FIYAT_DEGISIKLIGI: 'Fiyat Değişikliği', SIPARIS_OLUSTURMA: 'Sipariş Oluşturma',
  SIPARIS_IPTALI: 'Sipariş İptali', SIPARIS_DEGISIKLIGI: 'Sipariş Değişikliği',
  REZERVASYON_OLUSTURMA: 'Rezervasyon Oluşturma', REZERVASYON_IPTALI: 'Rezervasyon İptali',
  TESLIM_ONAYI: 'Teslim Onayı', YETKI_DEGISIKLIGI: 'Yetki Değişikliği',
  KREDI_DURUM_DEGISIKLIGI: 'Kredi Durumu', ARAC_DURUM_DEGISIKLIGI: 'Araç Durumu',
  TAHSILAT_DEGISIKLIGI: 'Tahsilat', MUSTERI_BILGI_DEGISIKLIGI: 'Müşteri Bilgisi',
  KAPORA_IADE_KARARI: 'Kapora İade Kararı',
}
const AUDIT_RENK = {
  EKLEME: 'bg-[#ECFDF5] text-[#047857] border-[#10B981]/30',
  GUNCELLEME: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#3B82F6]/30',
  SILME: 'bg-error-container text-on-error-container border-error/30',
}
// Gösterilmeyecek teknik alanlar (gürültü)
const AUDIT_GIZLI = new Set(['id', 'created_at', 'updated_at', 'olusturan'])

function auditDeger(v) {
  if (v === null || v === undefined || v === '') return '—'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

async function auditYukle() {
  const kap = document.getElementById('auditListe'); if (!kap) return
  kap.innerHTML = '<p class="text-body-md text-on-surface-variant">Yükleniyor…</p>'
  const tur = document.getElementById('adTur')?.value || ''
  const kisi = document.getElementById('adKisi')?.value || ''

  let q = supabase.from('audit_log')
    .select('id, islem_turu, tablo, kayit_id, islem, eski_deger, yeni_deger, degisen_alanlar, kullanici, departman, ip, cihaz, created_at')
    .order('created_at', { ascending: false }).limit(100)
  if (tur) q = q.eq('islem_turu', tur)
  if (kisi) q = q.eq('kullanici', kisi)
  const { data, error } = await q
  if (error) { dbHata('audit_log', error); kap.innerHTML = uyari('İşlem geçmişi okunamadı: ' + kacis(error.message)); return }

  // Filtre seçeneklerini bir kez doldur
  const turSel = document.getElementById('adTur')
  if (turSel && !turSel.options.length) {
    turSel.innerHTML = '<option value="">Tüm işlemler</option>' +
      Object.entries(AUDIT_ETIKET).map(([k, a]) => `<option value="${k}">${a}</option>`).join('')
  }
  const kisiSel = document.getElementById('adKisi')
  if (kisiSel && !kisiSel.options.length) {
    const kisiler = [...new Set((data || []).map(r => r.kullanici).filter(Boolean))].sort()
    kisiSel.innerHTML = '<option value="">Tüm kullanıcılar</option>' +
      kisiler.map(k => `<option value="${kacis(k)}">${kacis(k)}</option>`).join('')
  }

  if (!(data || []).length) {
    kap.innerHTML = '<p class="text-body-md text-on-surface-variant py-6 text-center">Bu filtrede kayıt yok.</p>'
    return
  }

  kap.innerHTML = `<div class="space-y-2">${data.map(r => {
    const alanlar = (r.degisen_alanlar || []).filter(a => !AUDIT_GIZLI.has(a))
    const detay = alanlar.length ? `<table class="w-full text-left mt-2 text-label-md">
        <thead><tr class="text-[10px] uppercase text-on-surface-variant"><th class="py-1">Alan</th><th>Eski</th><th>Yeni</th></tr></thead>
        <tbody>${alanlar.map(a => `<tr class="border-t border-outline-variant/40">
          <td class="py-1 pr-3 font-bold whitespace-nowrap">${kacis(a)}</td>
          <td class="py-1 pr-3 text-error/80">${kacis(auditDeger(r.eski_deger?.[a]))}</td>
          <td class="py-1 text-green-700">${kacis(auditDeger(r.yeni_deger?.[a]))}</td></tr>`).join('')}</tbody></table>`
      : `<p class="text-label-md text-on-surface-variant mt-1">${r.islem === 'EKLEME' ? 'Yeni kayıt oluşturuldu.' : r.islem === 'SILME' ? 'Kayıt silindi.' : 'Alan detayı yok.'}</p>`
    return `<details class="border border-outline-variant rounded-xl p-3">
      <summary class="cursor-pointer flex items-center gap-2 flex-wrap">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${AUDIT_RENK[r.islem] || ''}">${kacis(r.islem)}</span>
        <span class="font-bold text-body-md">${kacis(AUDIT_ETIKET[r.islem_turu] || r.islem_turu)}</span>
        <span class="text-label-md text-on-surface-variant">${kacis(r.kullanici || 'sistem')}${r.departman ? ' · ' + kacis(r.departman) : ''}</span>
        <span class="ml-auto text-[11px] text-on-surface-variant">${fmtTarihKisa(r.created_at)}</span>
      </summary>
      ${detay}
      <p class="text-[11px] text-on-surface-variant mt-2">${kacis(r.tablo)}${r.ip ? ' · IP ' + kacis(r.ip) : ''}${r.cihaz ? ' · ' + kacis(r.cihaz.slice(0, 60)) : ''}</p>
    </details>`
  }).join('')}</div>
  <p class="text-[11px] text-on-surface-variant mt-3">Son 100 kayıt gösteriliyor. Bu kayıtlar <b>silinemez ve değiştirilemez</b> (BR-0218).</p>`

  await girisKayitYukle()
}

async function girisKayitYukle() {
  const kap = document.getElementById('girisListe'); if (!kap) return
  const { data, error } = await supabase.from('giris_kayitlari')
    .select('olay, yontem, kullanici, ip, cihaz, created_at')
    .order('created_at', { ascending: false }).limit(50)
  if (error) { dbHata('giris_kayitlari', error); kap.innerHTML = uyari('Giriş kayıtları okunamadı.'); return }
  if (!(data || []).length) { kap.innerHTML = '<p class="text-body-md text-on-surface-variant">Kayıt yok.</p>'; return }
  const ikon = { GIRIS: 'login', CIKIS: 'logout', BASARISIZ_GIRIS: 'gpp_bad' }
  kap.innerHTML = `<div class="space-y-1">${data.map(g => `
    <div class="flex items-center gap-2 text-label-md border-b border-outline-variant/40 py-1.5">
      ${mat(ikon[g.olay] || 'login', 'text-[16px] ' + (g.olay === 'BASARISIZ_GIRIS' ? 'text-error' : 'text-on-surface-variant'))}
      <span class="font-bold">${kacis(g.kullanici || '—')}</span>
      <span class="text-on-surface-variant">${kacis(g.olay)}${g.yontem ? ' · ' + kacis(g.yontem) : ''}</span>
      <span class="ml-auto text-[11px] text-on-surface-variant">${g.ip ? kacis(g.ip) + ' · ' : ''}${fmtTarihKisa(g.created_at)}</span>
    </div>`).join('')}</div>`
}
