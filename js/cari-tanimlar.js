// =====================================================================
// cari-tanimlar.js — Cari İşlem Kalemleri (tanimlar · tip=CARI_ISLEM_TIPI)
//
// Göksenil (12 Ağu 2026): "LPG Uyum'u nereden ekleyeceğim?" — Sipariş
// dosyasındaki cari işlem düğmeleri artık bu katalogdan besleniyor
// (sql/190 turu) ama kataloğu düzenleyecek EKRAN YOKTU. Operasyon ve
// Sigorta'nın tanım ekranı vardı, cari kalemlerinin yoktu.
//
// Buraya eklenen her kalem, sipariş dosyasındaki "Cari İşlem Ekle"
// penceresinde DÜĞME olarak çıkar.
//
// ⚠️ YÖN (tediye/tahsilat) BU EKRANIN ASIL İŞİ. Yanlış yön, tutarı yanlış
//    tarafa yazar: tediye borcu ARTIRIR, tahsilat borcu AZALTIR. Bu yüzden
//    yön seçimi zorunlu ve listede açıkça yazılı.
//
// ⚠️ Yazma yetkisi SUNUCUDA: tanimlar_yaz = is_master() or is_yonetici()
//    or yetkili('tanimlar'). Buradaki kilit yalnız aynası — yetkisiz
//    kullanıcı salt-okur görür, yazsa da RLS 0 satır döner ve uyarı çıkar.
//
// ⚠️ KOD DEĞİŞTİRİLEMEZ. `kod` cari_hareketler.alt_tip'e yazılıyor; sonradan
//    değiştirilirse geçmiş hareketler adsız kalır. Ad serbestçe düzeltilir.
//
// --- POS CİHAZLARI (sql/196, 12 Ağu 2026) --------------------------------
// Göksenil: "fiziki pos ise tanımlamalara katalog eklenecek hangi pos olduğu
//   seçilecek… pos eklenirken hesap seçimi de zorunlu kılınsın o seçilen
//   hesabı otomatiğe bağlar kendi içinde."
// Aynı `tanimlar` tablosunda tip='POS_CIHAZI' olarak durur; ozellikler:
//   { tur: 'FIZIKI' | 'SANAL', kasa_hesap_id: uuid }
// ⚠️ BAĞLI HESAP ZORUNLU. Boş bırakılan POS, sipariş dosyasında seçilince
//    kasa boş kalır ve cari_kasa_zorunlu CHECK'i kaydı reddeder — kullanıcı
//    "kaydetmiyor" der, sebebini göremez. Bu yüzden ekleme burada engellenir.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata } from './veri.js'
import { mat, bosDurum } from './stitch-ui.js'

const KOK = () => document.getElementById('kok')
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
const LBL = 'text-[11px] font-bold text-on-surface-variant uppercase tracking-wide'

// Özel formu olan kalemler koda gömülü kalır (POS türü, takas aracı, noter
// harcı tabanı, Otosor iki-kayıt hesabı). Burada düzenlenebilir ama
// silinmemeli — bu yüzden işaretlenip uyarı gösterilir.
const OZEL_KALEMLER = ['NAKIT_TAHSILAT', 'HAVALE_TAHSILAT', 'KREDI_KARTI_TAHSILAT',
  'KAPORA_IADESI', 'SAHIBINE_IADE', 'TAKAS_MAHSUP', 'NOTER_MASRAFI', 'NOTER_HARCI',
  'OTOSOR_DOSYA_MASRAFI', 'TRAFIK_SIGORTASI', 'KASKO']

let BEN = null, YETKI = false, LISTE = [], POS = [], KASA = []

export async function cariTanimlarKur(d) {
  BEN = d
  YETKI = !!(d && (d.master_admin || d.rol === 'yonetici'
    || (Array.isArray(d.yetkiler) && d.yetkiler.includes('tanimlar'))))
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`
  await yukle()
}

async function yukle() {
  const [{ data, error }, { data: kasa, error: kErr }] = await Promise.all([
    supabase.from('tanimlar').select('id, tip, kod, ad, sira, aktif, ozellikler')
      .in('tip', ['CARI_ISLEM_TIPI', 'POS_CIHAZI']).order('sira').order('ad'),
    supabase.from('kasa_hesaplari').select('id, ad, tip').eq('aktif', true).order('sira'),
  ])
  if (error) { dbHata('cari kalemleri', error); KOK().innerHTML = `<div class="uyari-kutu">Liste okunamadı: ${kacis(error.message)}</div>`; return }
  if (kErr) dbHata('kasa hesapları', kErr)
  LISTE = (data || []).filter(t => t.tip === 'CARI_ISLEM_TIPI')
  POS = (data || []).filter(t => t.tip === 'POS_CIHAZI')
  KASA = kasa || []
  ciz()
}

const yon = k => (k.ozellikler?.yon === 'TAHSILAT' ? 'TAHSILAT' : 'TEDIYE')
const kasaAd = id => KASA.find(k => k.id === id)?.ad || null
const posTur = p => (p.ozellikler?.tur === 'FIZIKI' ? 'FIZIKI' : 'SANAL')

// POS kartı — cari kalemleriyle aynı görsel dil, ayrı tablo.
function posKartHtml() {
  const secenek = (secili) => `<option value="">Hesap seçin…</option>` +
    KASA.map(k => `<option value="${k.id}" ${k.id === secili ? 'selected' : ''}>${kacis(k.ad)}</option>`).join('')

  const satir = p => {
    const fiziki = posTur(p) === 'FIZIKI'
    const hesap = kasaAd(p.ozellikler?.kasa_hesap_id)
    return `<tr class="border-b border-outline-variant/50 ${p.aktif ? '' : 'opacity-50'}">
      <td class="py-2.5 pr-3">
        <div class="font-bold text-on-surface">${kacis(p.ad)}</div>
        <div class="text-[11px] text-on-surface-variant font-mono">${kacis(p.kod)}</div>
      </td>
      <td class="py-2.5 pr-3 whitespace-nowrap">
        <span class="text-[11px] font-black px-2 py-1 rounded-full ${fiziki ? 'bg-primary/10 text-primary' : 'bg-secondary-container text-secondary'}">
          ${fiziki ? 'FİZİKİ POS' : 'SANAL POS'}</span>
      </td>
      <td class="py-2.5 pr-3">${hesap
        ? `<span class="text-on-surface">${kacis(hesap)}</span>`
        : `<span class="text-error font-bold">bağlı hesap yok</span>`}</td>
      <td class="py-2.5 text-right whitespace-nowrap">
        ${YETKI ? `<button data-posduzenle="${p.id}" class="w-8 h-8 rounded hover:bg-primary/10 text-primary inline-flex items-center justify-center" title="Düzenle">${mat('edit', 'text-[16px]')}</button>
        <button data-posaktif="${p.id}" class="w-8 h-8 rounded hover:bg-surface-container-high text-on-surface-variant inline-flex items-center justify-center" title="${p.aktif ? 'Pasife al' : 'Aktif et'}">${mat(p.aktif ? 'visibility' : 'visibility_off', 'text-[16px]')}</button>
        <button data-possil="${p.id}" class="w-8 h-8 rounded hover:bg-error/10 text-error inline-flex items-center justify-center" title="Sil">${mat('delete', 'text-[16px]')}</button>` : ''}
      </td></tr>`
  }

  return `
    <div class="flex items-start justify-between gap-3 mt-8 mb-1">
      <div>
        <h2 class="text-title-lg font-bold text-on-surface">POS Cihazları</h2>
        <p class="text-body-md text-on-surface-variant mt-1">Kredi kartı tahsilatında <b>hangi POS</b> seçilirse,
          o POS'un bağlı olduğu hesap sipariş dosyasında <b>otomatik</b> gelir — danışman kasa seçmez.</p>
      </div>
    </div>

    ${YETKI ? `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 mt-3">
      <div class="text-[11px] font-black text-on-surface-variant uppercase tracking-wide mb-3">Yeni POS</div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div><label class="${LBL}">Ad *</label><input id="pAd" class="${INP} mt-1" placeholder="Garanti Fiziki POS" /></div>
        <div><label class="${LBL}">Kod *</label><input id="pKod" class="${INP} mt-1 font-mono" placeholder="GARANTI_FIZIKI" style="text-transform:uppercase" /></div>
        <div><label class="${LBL}">Tür *</label>
          <select id="pTur" class="${INP} mt-1">
            <option value="FIZIKI">Fiziki POS — cihaz</option>
            <option value="SANAL">Sanal POS — link/online</option>
          </select></div>
        <div><label class="${LBL}">Bağlı Hesap *</label><select id="pHesap" class="${INP} mt-1">${secenek()}</select></div>
      </div>
      <div class="flex items-center gap-3 mt-3">
        <button id="pEkle" class="bg-primary text-on-primary px-4 py-2 rounded-lg text-label-md font-bold flex items-center gap-1">${mat('add', 'text-[18px]')} POS Ekle</button>
        <span id="pDurum" class="text-label-sm text-on-surface-variant"></span>
      </div>
    </div>` : ''}

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 mt-4 overflow-x-auto">
      ${POS.length ? `<table class="w-full text-sm min-w-[560px]">
        <thead><tr class="text-[11px] font-black text-on-surface-variant uppercase tracking-wide border-b border-outline-variant">
          <th class="text-left pb-2">POS</th><th class="text-left pb-2">Tür</th>
          <th class="text-left pb-2">Bağlı Hesap</th><th class="pb-2"></th></tr></thead>
        <tbody>${POS.map(satir).join('')}</tbody></table>`
        : bosDurum('Henüz POS tanımlı değil.', 'credit_card')}
    </div>`
}

function ciz() {
  const satir = k => {
    const t = yon(k) === 'TAHSILAT'
    const ozel = OZEL_KALEMLER.includes(k.kod)
    return `<tr class="border-b border-outline-variant/50 ${k.aktif ? '' : 'opacity-50'}">
      <td class="py-2.5 pr-3">
        <div class="font-bold text-on-surface">${kacis(k.ad)}</div>
        <div class="text-[11px] text-on-surface-variant font-mono">${kacis(k.kod)}${ozel ? ' · özel form' : ''}</div>
      </td>
      <td class="py-2.5 pr-3 whitespace-nowrap">
        <span class="text-[11px] font-black px-2 py-1 rounded-full ${t ? 'bg-secondary-container text-secondary' : 'bg-primary/10 text-primary'}">
          ${t ? 'TAHSİLAT · borcu azaltır' : 'TEDİYE · borca eklenir'}</span>
      </td>
      <td class="py-2.5 pr-3 text-center text-on-surface-variant">${k.sira ?? '—'}</td>
      <td class="py-2.5 text-right whitespace-nowrap">
        ${YETKI ? `<button data-duzenle="${k.id}" class="w-8 h-8 rounded hover:bg-primary/10 text-primary inline-flex items-center justify-center" title="Düzenle">${mat('edit', 'text-[16px]')}</button>
        <button data-aktif="${k.id}" class="w-8 h-8 rounded hover:bg-surface-container-high text-on-surface-variant inline-flex items-center justify-center" title="${k.aktif ? 'Pasife al' : 'Aktif et'}">${mat(k.aktif ? 'visibility' : 'visibility_off', 'text-[16px]')}</button>
        ${ozel ? '' : `<button data-sil="${k.id}" class="w-8 h-8 rounded hover:bg-error/10 text-error inline-flex items-center justify-center" title="Sil">${mat('delete', 'text-[16px]')}</button>`}` : ''}
      </td></tr>`
  }

  KOK().innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-1">
      <div>
        <h1 class="text-headline-sm font-bold text-on-surface">Cari İşlem Kalemleri</h1>
        <p class="text-body-md text-on-surface-variant mt-1">Buraya eklediğiniz her kalem, sipariş dosyasındaki
          <b>Cari İşlem Ekle</b> penceresinde düğme olarak çıkar.</p>
      </div>
      <a href="siparis-merkezi.html" class="text-label-sm font-bold text-primary whitespace-nowrap">← Sipariş Merkezi</a>
    </div>
    ${YETKI ? '' : `<div class="uyari-kutu mt-3">Salt okunur — kalem eklemek için yönetici yetkisi gerekir.</div>`}

    ${YETKI ? `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 mt-4">
      <div class="text-[11px] font-black text-on-surface-variant uppercase tracking-wide mb-3">Yeni Kalem</div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div><label class="${LBL}">Ad *</label><input id="yAd" class="${INP} mt-1" placeholder="LPG Uyum" /></div>
        <div><label class="${LBL}">Kod *</label><input id="yKod" class="${INP} mt-1 font-mono" placeholder="LPG_UYUM" style="text-transform:uppercase" /></div>
        <div><label class="${LBL}">Yön *</label>
          <select id="yYon" class="${INP} mt-1">
            <option value="TEDIYE">Tediye — müşteri borcuna eklenir</option>
            <option value="TAHSILAT">Tahsilat — borcu azaltır</option>
          </select></div>
        <div><label class="${LBL}">Sıra</label><input id="ySira" type="number" class="${INP} mt-1" placeholder="30" /></div>
      </div>
      <div class="flex items-center gap-3 mt-3">
        <button id="yEkle" class="bg-primary text-on-primary px-4 py-2 rounded-lg text-label-md font-bold flex items-center gap-1">${mat('add', 'text-[18px]')} Kalemi Ekle</button>
        <span id="yDurum" class="text-label-sm text-on-surface-variant"></span>
      </div>
    </div>` : ''}

    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 mt-4 overflow-x-auto">
      ${LISTE.length ? `<table class="w-full text-sm min-w-[560px]">
        <thead><tr class="text-[11px] font-black text-on-surface-variant uppercase tracking-wide border-b border-outline-variant">
          <th class="text-left pb-2">Kalem</th><th class="text-left pb-2">Yön</th>
          <th class="text-center pb-2">Sıra</th><th class="pb-2"></th></tr></thead>
        <tbody>${LISTE.map(satir).join('')}</tbody></table>`
        : bosDurum('Henüz kalem yok.', 'receipt_long')}
    </div>

    ${posKartHtml()}`

  bagla()
}

function bagla() {
  document.getElementById('yEkle')?.addEventListener('click', ekle)
  document.querySelectorAll('[data-duzenle]').forEach(b => b.addEventListener('click', () => duzenle(b.dataset.duzenle)))
  document.querySelectorAll('[data-aktif]').forEach(b => b.addEventListener('click', () => aktifCevir(b.dataset.aktif)))
  document.querySelectorAll('[data-sil]').forEach(b => b.addEventListener('click', () => sil(b.dataset.sil)))
  document.getElementById('pEkle')?.addEventListener('click', posEkle)
  document.querySelectorAll('[data-posduzenle]').forEach(b => b.addEventListener('click', () => posDuzenle(b.dataset.posduzenle)))
  document.querySelectorAll('[data-posaktif]').forEach(b => b.addEventListener('click', () => posAktifCevir(b.dataset.posaktif)))
  document.querySelectorAll('[data-possil]').forEach(b => b.addEventListener('click', () => posSil(b.dataset.possil)))
}

const durumYaz = t => { const e = document.getElementById('yDurum'); if (e) e.textContent = t }
const posDurumYaz = t => { const e = document.getElementById('pDurum'); if (e) e.textContent = t }

// Kod normalize — cari kalemiyle aynı kural (TR karakter yok, A-Z0-9_).
const kodNormalize = ham => ham.toLocaleUpperCase('tr')
  .replace(/[ĞÜŞİÖÇ]/g, m => ({ 'Ğ': 'G', 'Ü': 'U', 'Ş': 'S', 'İ': 'I', 'Ö': 'O', 'Ç': 'C' }[m]))
  .replace(/[^A-Z0-9_]/g, '_')

async function posEkle() {
  const ad = document.getElementById('pAd').value.trim()
  const kod = kodNormalize(document.getElementById('pKod').value.trim())
  const tur = document.getElementById('pTur').value
  const hesap = document.getElementById('pHesap').value
  if (!ad) return posDurumYaz('Ad zorunlu.')
  if (kod.length < 3) return posDurumYaz('Kod en az 3 hane olmalı (ör. GARANTI_FIZIKI).')
  if (POS.some(p => p.kod === kod)) return posDurumYaz('Bu kod zaten var: ' + kod)
  // ⚠️ Hesapsız POS kaydedilemez — sipariş dosyasında kasa boş kalır ve
  //    cari_kasa_zorunlu CHECK'i insert'i sessizce reddederdi.
  if (!hesap) return posDurumYaz('Bağlı hesap zorunlu — bu POS ile yapılan tahsilat bu hesaba yazılır.')

  posDurumYaz('Ekleniyor…')
  const { data, error } = await supabase.from('tanimlar').insert({
    tip: 'POS_CIHAZI', kod, ad, sira: (POS.length + 1) * 10, aktif: true,
    ozellikler: { tur, kasa_hesap_id: hesap },
  }).select('id')
  if (error) { dbHata('POS ekle', error); return posDurumYaz('Eklenemedi: ' + error.message) }
  if (!data || !data.length) return posDurumYaz('Eklenemedi — yetkiniz yok.')
  posDurumYaz('Eklendi. Sipariş dosyasında kredi kartı tahsilatında seçilebilir.')
  document.getElementById('pAd').value = ''; document.getElementById('pKod').value = ''
  await yukle()
}

async function posDuzenle(id) {
  const p = POS.find(x => x.id === id); if (!p) return
  const ad = prompt('POS adı:', p.ad)
  if (ad == null) return
  const t = prompt('Tür — FIZIKI veya SANAL:', posTur(p))
  if (t == null) return
  const tur = t.trim().toLocaleUpperCase('tr') === 'FIZIKI' ? 'FIZIKI' : 'SANAL'
  const liste = KASA.map((k, i) => `${i + 1}. ${k.ad}`).join('\n')
  const suan = KASA.findIndex(k => k.id === p.ozellikler?.kasa_hesap_id)
  const sec = prompt(`Bağlı hesap — numarasını yazın:\n\n${liste}`, suan >= 0 ? String(suan + 1) : '')
  if (sec == null) return
  const kasa = KASA[Number(sec) - 1]
  if (!kasa) { alert('Geçerli bir hesap numarası girin — bağlı hesap zorunlu.'); return }
  const { data, error } = await supabase.from('tanimlar')
    .update({ ad: ad.trim() || p.ad, ozellikler: { ...(p.ozellikler || {}), tur, kasa_hesap_id: kasa.id } })
    .eq('id', id).select('id')
  if (error) { dbHata('POS güncelle', error); alert('Güncellenemedi: ' + error.message); return }
  if (!data?.length) { alert('Güncellenemedi — yetkiniz yok.'); return }
  await yukle()
}

async function posAktifCevir(id) {
  const p = POS.find(x => x.id === id); if (!p) return
  const { data, error } = await supabase.from('tanimlar').update({ aktif: !p.aktif }).eq('id', id).select('id')
  if (error) { dbHata('POS aktif', error); alert('Değiştirilemedi: ' + error.message); return }
  if (!data?.length) { alert('Değiştirilemedi — yetkiniz yok.'); return }
  await yukle()
}

async function posSil(id) {
  const p = POS.find(x => x.id === id); if (!p) return
  if (!confirm(`"${p.ad}" POS'u silinecek.\n\nBu POS ile girilmiş geçmiş tahsilatlar listede POS adı yerine kodu ile görünür. Kullanımdan kaldırmak istiyorsanız SİLMEK yerine göz simgesiyle PASİFE ALMAK daha doğrudur.\n\nYine de silinsin mi?`)) return
  const { data, error } = await supabase.from('tanimlar').delete().eq('id', id).select('id')
  if (error) { dbHata('POS sil', error); alert('Silinemedi: ' + error.message); return }
  if (!data?.length) { alert('Silinemedi — yetkiniz yok.'); return }
  await yukle()
}

async function ekle() {
  const ad = document.getElementById('yAd').value.trim()
  const kodHam = document.getElementById('yKod').value.trim()
  const yonSec = document.getElementById('yYon').value
  const siraHam = document.getElementById('ySira').value.trim()
  if (!ad) return durumYaz('Ad zorunlu.')
  // Kod TR karakter içermemeli — alt_tip olarak yazılıyor, aramada sorun çıkarır.
  const kod = kodHam.toLocaleUpperCase('tr').replace(/[ĞÜŞİÖÇ]/g, m => ({ 'Ğ': 'G', 'Ü': 'U', 'Ş': 'S', 'İ': 'I', 'Ö': 'O', 'Ç': 'C' }[m])).replace(/[^A-Z0-9_]/g, '_')
  if (kod.length < 3) return durumYaz('Kod en az 3 hane olmalı (ör. LPG_UYUM).')
  if (LISTE.some(k => k.kod === kod)) return durumYaz('Bu kod zaten var: ' + kod)

  durumYaz('Ekleniyor…')
  const { data, error } = await supabase.from('tanimlar').insert({
    tip: 'CARI_ISLEM_TIPI', kod, ad,
    sira: siraHam ? Number(siraHam) : 50, aktif: true,
    ozellikler: { yon: yonSec, alanlar: ['tutar', 'tarih', 'kasa_hesap_id', 'aciklama'], kasa_zorunlu: true },
  }).select('id')
  if (error) { dbHata('cari kalem ekle', error); return durumYaz('Eklenemedi: ' + error.message) }
  // ⚠️ .insert() hata vermeden 0 satır yazabilir (CLAUDE.md §5.1)
  if (!data || !data.length) return durumYaz('Eklenemedi — yetkiniz yok.')
  durumYaz('Eklendi. Sipariş dosyasında düğme olarak görünecek.')
  document.getElementById('yAd').value = ''; document.getElementById('yKod').value = ''; document.getElementById('ySira').value = ''
  await yukle()
}

async function duzenle(id) {
  const k = LISTE.find(x => x.id === id); if (!k) return
  const ad = prompt('Kalem adı:', k.ad)
  if (ad == null) return
  const y = prompt('Yön — TEDIYE (borca eklenir) veya TAHSILAT (borcu azaltır):', yon(k))
  if (y == null) return
  const yy = y.trim().toLocaleUpperCase('tr') === 'TAHSILAT' ? 'TAHSILAT' : 'TEDIYE'
  const { data, error } = await supabase.from('tanimlar')
    .update({ ad: ad.trim() || k.ad, ozellikler: { ...(k.ozellikler || {}), yon: yy } })
    .eq('id', id).select('id')
  if (error) { dbHata('cari kalem güncelle', error); alert('Güncellenemedi: ' + error.message); return }
  if (!data?.length) { alert('Güncellenemedi — yetkiniz yok.'); return }
  await yukle()
}

async function aktifCevir(id) {
  const k = LISTE.find(x => x.id === id); if (!k) return
  const { data, error } = await supabase.from('tanimlar').update({ aktif: !k.aktif }).eq('id', id).select('id')
  if (error) { dbHata('cari kalem aktif', error); alert('Değiştirilemedi: ' + error.message); return }
  if (!data?.length) { alert('Değiştirilemedi — yetkiniz yok.'); return }
  await yukle()
}

async function sil(id) {
  const k = LISTE.find(x => x.id === id); if (!k) return
  // ⚠️ Geçmiş hareketler alt_tip'te bu kodu taşıyor olabilir; silinirse o
  //    satırlar kod adıyla görünür. Pasife almak çoğu zaman doğru olan.
  if (!confirm(`"${k.ad}" kalemi silinecek.\n\nDaha önce bu kalemle girilmiş cari hareketler varsa listede kalem adı yerine kodu görünür. Kullanımdan kaldırmak istiyorsanız SİLMEK yerine göz simgesiyle PASİFE ALMAK daha doğrudur.\n\nYine de silinsin mi?`)) return
  const { data, error } = await supabase.from('tanimlar').delete().eq('id', id).select('id')
  if (error) { dbHata('cari kalem sil', error); alert('Silinemedi: ' + error.message); return }
  if (!data?.length) { alert('Silinemedi — yetkiniz yok.'); return }
  await yukle()
}
