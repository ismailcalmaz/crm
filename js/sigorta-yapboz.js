// =====================================================================
// sigorta-yapboz.js — Yapbozlar (kısa dönem trafik) takip + iade merkezi
//   Liste (süre barı, beklenen/gerçekleşen/fark) + KPI + filtre +
//   sağ detay çekmecesi. Yeni Yapboz · Satıldı işaretle · İade Gir.
//   Beklenen iade sql/36 ile birebir (sigorta-ortak.beklenenIade).
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, bugunISO, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'
import { round2, artiGun, gunFark, beklenenIade, yapbozGunluk, sirketSecici } from './sigorta-ortak.js'
import { belgeSatirlari } from './tramer-ocr.js'        // PDF→metin TEK KAYNAK
import { policeAyristir, sirketEsle } from './police-pdf.js'
// Okunan şablonun ekranda görünen adı (police-pdf.js profil kodları).
const SAGLAYICI_AD = { TURKIYE: 'Türkiye Sigorta', NEOVA: 'Neova', SOMPO: 'Sompo' }
import { kartBloguCiz, kartSec, KART_ALANLAR } from './kart-gorsel.js'

let benim = null
const cache = { sirketler: [], kartlar: [], tahsilat: [], kural: [], satisDahil: false, yapbozTurId: null }
const S = { liste: [], filtre: 'tumu', sirketF: '', plakaF: '' }

const sirketById = id => cache.sirketler.find(s => s.id === id)
const FILTRELER = [['tumu', 'Tümü'], ['AKTIF', 'Aktif'], ['SATILDI_IADE_BEKLIYOR', 'İade Bekliyor'], ['IADE_EDILDI', 'İade Edildi'], ['SURESI_DOLDU', 'Süresi Doldu']]
const DURUM_ET = { AKTIF: ['Aktif', 'bg-tertiary-container text-on-tertiary-container'], SATILDI_IADE_BEKLIYOR: ['İade Bekliyor', 'bg-amber-100 text-amber-800'], IADE_EDILDI: ['İade Edildi', 'bg-secondary-container text-on-secondary-container'], SURESI_DOLDU: ['Süresi Doldu', 'bg-surface-container-high text-on-surface-variant'] }

// =====================================================================
export async function yapbozKur(danisman) {
  benim = danisman
  await cacheYukle()
  await listeYukle()
  document.getElementById('ypYeni').addEventListener('click', yeniYapbozModal)
  document.getElementById('ypPlakaF').addEventListener('input', e => { S.plakaF = e.target.value; ciz() })
  document.getElementById('ypSirketF').addEventListener('change', e => { S.sirketF = e.target.value; ciz() })
}

async function cacheYukle() {
  const [s, k, th, kr, ay, tur] = await Promise.all([
    supabase.from('sigorta_sirketleri').select('id, ad, kisa_kod, ana_sirket_id, kisa_donem_fiyat_tipi, kisa_donem_otomobil, kisa_donem_kamyonet, iade_kural, iade_tavan_otomobil, iade_tavan_kamyonet, iade_tavan_esik_gun').eq('aktif', true).order('ad'),
    // ⚠️ Eskiden yalnız (id, ad, son_dort, sahip_tipi) çekiliyordu; kart
    //    görselinde banka, alt uzantı ve sahip adı boş çıkıyordu.
    supabase.from('odeme_kartlari').select(KART_ALANLAR).eq('aktif', true).order('ad'),
    supabase.from('tahsilat_sekilleri').select('id, ad').eq('aktif', true).order('sira'),
    supabase.from('tahsilat_kart_kurallari').select('taraf, tahsilat_sekli_id, police_turu_id, kart_id, oncelik').eq('aktif', true),
    supabase.from('sigorta_ayarlari').select('deger').eq('anahtar', 'yapboz_satis_gunu_dahil').limit(1),
    supabase.from('police_turleri').select('id').eq('kod', 'YAPBOZ').limit(1),
  ])
  // ⚠️ Bu altı sorgunun HİÇBİRİ error kontrol etmiyordu (dbHata import
  //    edilmiş ama hiç çağrılmamış). RLS reddi ya da kolon hatasında dizi
  //    sessizce boş kalıyor, kullanıcı "kart tanımlı değil" görüyor ve
  //    gerçek sebep hiçbir yere yazılmıyordu (CLAUDE.md §5.4).
  if (s.error)   dbHata('sigorta_sirketleri', s.error)
  if (k.error)   dbHata('odeme_kartlari', k.error)
  if (th.error)  dbHata('tahsilat_sekilleri', th.error)
  if (kr.error)  dbHata('tahsilat_kart_kurallari', kr.error)
  if (ay.error)  dbHata('sigorta_ayarlari', ay.error)
  if (tur.error) dbHata('police_turleri', tur.error)

  cache.sirketler = s.data || []
  cache.kartlar = k.data || []
  cache.tahsilat = th.data || []
  cache.kural = kr.data || []
  cache.satisDahil = (ay.data && ay.data[0]?.deger === 'true')
  cache.yapbozTurId = tur.data && tur.data[0]?.id
  // Şirket filtresi doldur
  const sel = document.getElementById('ypSirketF')
  sel.innerHTML = '<option value="">Tüm şirketler</option>' + cache.sirketler.map(x => `<option value="${x.id}">${kacis(x.ad)}</option>`).join('')
}

async function listeYukle() {
  const { data, error } = await supabase.from('yapbozlar')
    .select('id, police_id, arac_id, alis_tarihi, satis_tarihi, toplam_gun, gunluk_ucret, kullanilan_gun, kalan_gun, beklenen_iade, gerceklesen_iade, iade_hareket_id, tavan_uygulandi_mi, durum, policeler(id, police_no, brut, net, sirket_id), sigorta_araclari(id, plaka, marka, versiyon, tip)')
    .order('created_at', { ascending: false }).limit(1000)
  if (error) { document.getElementById('ypListe').innerHTML = `<div class="bg-error-container text-on-error-container rounded-xl p-4">Yüklenemedi: ${kacis(error.message)}</div>`; return }
  S.liste = data || []
  ciz()
}

// Satır hesabı (AKTIF → bugün satılırsa; diğer → kayıtlı)
function hesapla(y) {
  const sirket = sirketById(y.policeler?.sirket_id)
  const tip = y.sigorta_araclari?.tip || 'OTOMOBIL'
  const brut = Number(y.policeler?.brut) || 0
  const gun = y.toplam_gun || 60
  let kull, kalan, beklenen
  if (y.durum === 'AKTIF' || y.durum === 'SURESI_DOLDU') {
    kull = Math.min(Math.max(gunFark(y.alis_tarihi, bugunISO()), 0), gun)
    kalan = gun - kull
    beklenen = beklenenIade(sirket, tip, brut, y.alis_tarihi, bugunISO(), gun, cache.satisDahil).tutar
  } else {
    kull = y.kullanilan_gun ?? 0; kalan = y.kalan_gun ?? 0; beklenen = Number(y.beklenen_iade) || 0
  }
  const gerc = (y.gerceklesen_iade != null) ? Number(y.gerceklesen_iade) : null
  const fark = (gerc != null) ? round2(beklenen - gerc) : null
  return { kull, kalan, gun, beklenen, gerc, fark, sirket, tip, brut }
}

function filtreli() {
  return S.liste.filter(y => {
    if (S.filtre !== 'tumu' && y.durum !== S.filtre) return false
    if (S.sirketF && y.policeler?.sirket_id !== S.sirketF) return false
    if (S.plakaF && !(y.sigorta_araclari?.plaka || '').toLocaleLowerCase('tr').includes(S.plakaF.toLocaleLowerCase('tr'))) return false
    return true
  })
}

function ciz() {
  kpiCiz(); sekmelerCiz(); tabloCiz()
}

function kpiCiz() {
  const say = d => S.liste.filter(y => y.durum === d).length
  const bekleyenToplam = S.liste.filter(y => y.durum === 'SATILDI_IADE_BEKLIYOR').reduce((t, y) => t + (Number(y.beklenen_iade) || 0), 0)
  const buAy = new Date().toISOString().slice(0, 7)
  const iadeBuAy = S.liste.filter(y => y.durum === 'IADE_EDILDI' && (y.satis_tarihi || '').slice(0, 7) === buAy).length
  const kart = (ik, l, v, renk) => `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg kart-hover">
    <div class="flex items-center gap-2 text-on-surface-variant text-label-md">${mat(ik, renk + ' text-[20px]')} ${l}</div>
    <div class="text-headline-lg text-on-surface mt-1">${v}</div></div>`
  document.getElementById('ypKpi').innerHTML =
    kart('directions_car', 'Aktif', say('AKTIF'), 'text-tertiary') +
    kart('hourglass_top', 'İade Bekliyor', say('SATILDI_IADE_BEKLIYOR'), 'text-amber-600') +
    kart('payments', 'Bekleyen Toplam İade', fmtPara(round2(bekleyenToplam)), 'text-primary') +
    kart('task_alt', 'Bu Ay İade Edilen', iadeBuAy, 'text-secondary')
  document.getElementById('ypOzet').textContent = `${S.liste.length} kayıt · ${say('SATILDI_IADE_BEKLIYOR')} iade bekliyor`
}

function sekmelerCiz() {
  const kok = document.getElementById('ypSekmeler')
  kok.innerHTML = FILTRELER.map(([k, l]) => {
    const n = k === 'tumu' ? S.liste.length : S.liste.filter(y => y.durum === k).length
    const a = S.filtre === k
    return `<button data-f="${k}" class="px-3 py-2 rounded-full text-label-md font-bold transition-colors ${a ? 'bg-primary text-on-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}">${l} <span class="${a ? 'opacity-80' : 'text-on-surface-variant'}">(${n})</span></button>`
  }).join('')
  kok.querySelectorAll('[data-f]').forEach(el => el.addEventListener('click', () => { S.filtre = el.dataset.f; ciz() }))
}

function sureBar(kull, gun, durum) {
  const oran = Math.min(100, Math.round(kull / gun * 100))
  const renk = durum === 'AKTIF' ? 'bg-tertiary' : durum === 'SATILDI_IADE_BEKLIYOR' ? 'bg-amber-500' : durum === 'IADE_EDILDI' ? 'bg-secondary' : 'bg-outline'
  return `<div class="w-28"><div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full ${renk} rounded-full" style="width:${oran}%"></div></div>
    <div class="text-[11px] text-on-surface-variant mt-1">${kull} / ${gun} gün</div></div>`
}

function tabloCiz() {
  const kok = document.getElementById('ypListe')
  const rows = filtreli()
  if (!rows.length) {
    kok.innerHTML = `<div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-10 text-center text-on-surface-variant">Bu filtrede yapboz yok.</div>`
    return
  }
  let tB = 0, tG = 0, tF = 0
  const satirlar = rows.map(y => {
    const h = hesapla(y)
    tB += h.beklenen; if (h.gerc != null) tG += h.gerc; if (h.fark != null) tF += h.fark
    const [dl, dc] = DURUM_ET[y.durum] || ['—', '']
    const gecikme = y.durum === 'SATILDI_IADE_BEKLIYOR' && y.satis_tarihi ? gunFark(y.satis_tarihi, bugunISO()) : 0
    const farkRenk = h.fark == null ? 'text-on-surface-variant' : h.fark > 0.5 ? 'text-error' : h.fark < -0.5 ? 'text-secondary' : 'text-on-surface-variant'
    return `<tr data-y="${y.id}" class="hover:bg-surface-container-low transition-colors cursor-pointer">
      <td class="px-4 py-3"><div class="font-bold text-on-surface font-mono">${kacis(y.sigorta_araclari?.plaka || '—')}</div>${gecikme > 3 ? `<span class="text-[10px] font-bold text-error">${gecikme} gündür bekliyor</span>` : ''}</td>
      <td class="px-4 py-3">${kacis(h.sirket?.ad || '—')}${y.tavan_uygulandi_mi ? ` ${mat('warning', 'text-amber-500 text-[16px]')}` : ''}</td>
      <td class="px-4 py-3">${sureBar(h.kull, h.gun, y.durum)}</td>
      <td class="px-4 py-3 whitespace-nowrap">${fmtPara(y.gunluk_ucret)}</td>
      <td class="px-4 py-3 whitespace-nowrap font-semibold">${fmtPara(h.beklenen)}</td>
      <td class="px-4 py-3 whitespace-nowrap">${h.gerc != null ? fmtPara(h.gerc) : '—'}</td>
      <td class="px-4 py-3 whitespace-nowrap font-bold ${farkRenk}">${h.fark != null ? fmtPara(h.fark) : '—'}</td>
      <td class="px-4 py-3"><span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${dc}">${dl}</span></td>
    </tr>`
  }).join('')
  kok.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden custom-shadow">
    <div class="overflow-x-auto"><table class="w-full text-left">
      <thead class="bg-surface-container-low border-b border-outline-variant"><tr>
        ${['Plaka', 'Şirket', 'Süre Kullanımı', 'Günlük', 'Beklenen İade', 'Gerçekleşen', 'Fark', 'Durum'].map(h => `<th class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant whitespace-nowrap">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-outline-variant text-body-md">${satirlar}</tbody>
      <tfoot class="bg-surface-container-low border-t-2 border-outline-variant font-bold"><tr>
        <td class="px-4 py-3" colspan="4">TOPLAM (${rows.length})</td>
        <td class="px-4 py-3 whitespace-nowrap">${fmtPara(round2(tB))}</td>
        <td class="px-4 py-3 whitespace-nowrap">${fmtPara(round2(tG))}</td>
        <td class="px-4 py-3 whitespace-nowrap ${tF > 0.5 ? 'text-error' : ''}">${fmtPara(round2(tF))}</td>
        <td></td></tr></tfoot>
    </table></div></div>`
  kok.querySelectorAll('[data-y]').forEach(el => el.addEventListener('click', () => detayAc(el.dataset.y)))
}

// --------------------------------------------------------- Detay çekmecesi
function detayAc(id) {
  const y = S.liste.find(x => x.id === id); if (!y) return
  const h = hesapla(y)
  const [dl, dc] = DURUM_ET[y.durum] || ['—', '']
  const bitis = artiGun(y.alis_tarihi, y.toplam_gun || 60)
  const ov = document.createElement('div')
  ov.innerHTML = `
    <div class="ypBackdrop fixed inset-0 bg-black/30 z-[70]"></div>
    <aside class="ypDrawer fixed right-0 top-0 h-screen w-[440px] max-w-[94vw] bg-surface-container-lowest z-[71] shadow-2xl border-l border-outline-variant flex flex-col translate-x-full transition-transform duration-300" style="transition-timing-function:cubic-bezier(.4,0,.2,1)">
      <div class="p-lg border-b border-outline-variant flex items-start justify-between">
        <div><div class="flex items-center gap-2"><h3 class="text-headline-sm font-bold text-primary font-mono">${kacis(y.sigorta_araclari?.plaka || '—')}</h3>
          <span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${dc}">${dl}</span></div>
          <p class="text-label-sm text-on-surface-variant mt-0.5">${kacis(y.policeler?.police_no || '')}</p></div>
        <button class="ypKapat p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button>
      </div>
      <div class="flex-1 overflow-y-auto p-lg space-y-5">
        <div>
          <div class="flex items-center justify-between text-label-md font-bold text-on-surface-variant mb-1"><span>Kullanım Süresi</span><span>${h.kull} / ${h.gun} gün</span></div>
          <div class="h-2 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full bg-amber-500 rounded-full" style="width:${Math.min(100, Math.round(h.kull / h.gun * 100))}%"></div></div>
          <div class="flex justify-between text-[11px] text-on-surface-variant mt-1"><span>Başlangıç ${tar(y.alis_tarihi)}</span><span>Bitiş ${tar(bitis)}</span></div>
        </div>
        <div class="bg-surface-container-low rounded-xl p-4 space-y-2">
          <div class="text-label-md font-bold text-on-surface-variant">Finansal Özet</div>
          ${ozetSatir('Brüt Kazanç', fmtPara(h.brut))}
          ${ozetSatir('Günlük Ücret', fmtPara(y.gunluk_ucret))}
          <div class="border-t border-outline-variant pt-2 flex justify-between"><span class="font-bold text-primary">Beklenen İade</span><span class="font-bold text-primary text-title-lg">${fmtPara(h.beklenen)}</span></div>
          ${y.tavan_uygulandi_mi ? `<div class="text-[11px] text-amber-700 flex items-center gap-1">${mat('warning', 'text-[14px]')} Tavan uygulandı (${kacis(h.sirket?.ad)})</div>` : ''}
          ${h.gerc != null ? `<div class="flex justify-between"><span>Gerçekleşen</span><span class="font-semibold">${fmtPara(h.gerc)}</span></div><div class="flex justify-between"><span>Fark</span><span class="font-bold ${h.fark > 0.5 ? 'text-error' : 'text-secondary'}">${fmtPara(h.fark)}</span></div>` : ''}
        </div>
        <div>
          <div class="text-label-md font-bold text-on-surface-variant mb-2">Araç Bilgileri</div>
          <div class="grid grid-cols-2 gap-3 text-body-md">
            ${bilgi('Marka', y.sigorta_araclari?.marka)}${bilgi('Versiyon', y.sigorta_araclari?.versiyon)}
            ${bilgi('Tip', y.sigorta_araclari?.tip === 'KAMYONET' ? 'Kamyonet' : 'Otomobil')}${bilgi('Şirket', h.sirket?.ad)}
          </div>
        </div>
        <div>
          <div class="text-label-md font-bold text-on-surface-variant mb-2">Zaman Çizelgesi</div>
          <div class="space-y-3">
            ${zaman('check_circle', 'Poliçe / yapboz açıldı', tar(y.alis_tarihi), 'text-secondary')}
            ${y.satis_tarihi ? zaman('sell', 'Araç satıldı — iade bekliyor', tar(y.satis_tarihi), 'text-amber-600') : ''}
            ${y.durum === 'IADE_EDILDI' ? zaman('task_alt', 'İade işlendi', fmtPara(h.gerc), 'text-secondary') : ''}
          </div>
        </div>
      </div>
      <div class="p-lg border-t border-outline-variant flex gap-2">
        ${y.durum === 'AKTIF' ? `<button class="ypSat flex-1 bg-primary text-on-primary py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('sell', 'text-[18px]')} Satıldı İşaretle</button>` : ''}
        ${y.durum === 'SATILDI_IADE_BEKLIYOR' ? `<button class="ypIade flex-1 bg-primary text-on-primary py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center justify-center gap-1.5">${mat('undo', 'text-[18px]')} İade Gir</button>` : ''}
      </div>
    </aside>`
  document.body.appendChild(ov)
  const back = ov.querySelector('.ypBackdrop'), draw = ov.querySelector('.ypDrawer')
  requestAnimationFrame(() => draw.classList.remove('translate-x-full'))
  const kapat = () => { draw.classList.add('translate-x-full'); back.classList.add('opacity-0'); setTimeout(() => ov.remove(), 300) }
  back.addEventListener('click', kapat)
  ov.querySelector('.ypKapat').addEventListener('click', kapat)
  ov.querySelector('.ypSat')?.addEventListener('click', () => { kapat(); satisModal(y) })
  ov.querySelector('.ypIade')?.addEventListener('click', () => { kapat(); iadeModal(y) })
}
const tar = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : '—'
const ozetSatir = (l, v) => `<div class="flex justify-between text-body-md"><span class="text-on-surface-variant">${l}</span><span class="font-semibold">${v}</span></div>`
const bilgi = (l, v) => `<div><div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${l}</div><div class="font-medium">${kacis(v || '—')}</div></div>`
const zaman = (ik, l, s, renk) => `<div class="flex items-center gap-3"><span class="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center ${renk}">${mat(ik, 'text-[18px]')}</span><div><div class="font-semibold text-on-surface text-body-md">${l}</div><div class="text-[11px] text-on-surface-variant">${kacis(s)}</div></div></div>`

// --------------------------------------------------------- Yeni Yapboz
function yeniYapbozModal() {
  const g = { plaka: '', tip: 'OTOMOBIL', sirket_id: null, alis: bugunISO(), brut: '', net: '', police_no: '' }
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[8vh] px-4 overflow-y-auto'
  const gunlukGoster = () => {
    const s = g.sirket_id ? sirketById(g.sirket_id) : null
    const gu = yapbozGunluk(s, g.tip, Number(g.brut) || 0, 60)
    ov.querySelector('#yyGunluk').textContent = fmtPara(gu)
  }
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md mb-10" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-lg py-4 border-b border-outline-variant">
      <h3 class="text-title-lg text-primary flex items-center gap-2">${mat('add_circle', 'text-[22px]')} Yeni Yapboz</h3>
      <button id="yyKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div class="p-lg space-y-3">
      <!-- Poliçe PDF'i okuma (Göksenil, 18 Ağu 2026): personel sürükler,
           sistem okur, KULLANICI ONAYLAR. Otomatik kayıt YOK. -->
      <div id="yyDrop" class="border-2 border-dashed border-outline-variant rounded-xl px-4 py-4 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
        <div class="flex items-center justify-center gap-2 text-on-surface-variant text-label-md">
          ${mat('picture_as_pdf', 'text-[20px]')} <b class="text-on-surface">Poliçe PDF'ini sürükleyin</b> · ya da tıklayıp seçin
        </div>
        <div class="text-[11px] text-on-surface-variant mt-0.5">Alanlar okunup onayınıza sunulur — hiçbir şey kendiliğinden kaydedilmez.</div>
        <input id="yyDosya" type="file" accept="application/pdf,image/*" class="hidden" />
      </div>
      <div id="yyOkuma" class="hidden"></div>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Araç Plakası <span class="text-error">*</span></label><input id="yyPlaka" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      <div class="flex items-center justify-between">
        <label class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Araç Tipi</label>
        <div class="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          ${['OTOMOBIL', 'KAMYONET'].map(t => `<button data-yt="${t}" class="px-4 py-2 text-label-md font-bold ${g.tip === t ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant'}">${t === 'OTOMOBIL' ? 'Otomobil' : 'Kamyonet'}</button>`).join('')}
        </div>
      </div>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Sigorta Şirketi <span class="text-error">*</span></label>
        <button id="yySirket" class="w-full text-left bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md flex items-center justify-between hover:border-primary"><span id="yySirketAd" class="text-on-surface-variant">Şirket seçin…</span>${mat('unfold_more', 'text-on-surface-variant text-[20px]')}</button></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Alış Tarihi <span class="text-error">*</span></label><input id="yyAlis" type="date" value="${g.alis}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Poliçe No</label><input id="yyPno" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" placeholder="opsiyonel" /></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Brüt ₺ <span class="text-error">*</span></label><input id="yyBrut" type="number" step="0.01" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Net ₺</label><input id="yyNet" type="number" step="0.01" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      </div>
      <div class="bg-surface-container-low rounded-lg px-4 py-2.5 flex items-center justify-between"><span class="text-label-md text-on-surface-variant">Günlük Ücret (60 gün)</span><span id="yyGunluk" class="font-bold text-primary text-title-lg">—</span></div>
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg"><button id="yyVazgec" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="yyKaydet" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('save', 'text-[18px]')} Yapbozu Aç</button></div>
  </div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelector('#yyKapat').addEventListener('click', kapat)
  ov.querySelector('#yyVazgec').addEventListener('click', kapat)
  ov.querySelectorAll('[data-yt]').forEach(el => el.addEventListener('click', () => { g.tip = el.dataset.yt; ov.querySelectorAll('[data-yt]').forEach(b => b.className = `px-4 py-2 text-label-md font-bold ${b.dataset.yt === g.tip ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant'}`); gunlukGoster() }))
  ov.querySelector('#yySirket').addEventListener('click', () => sirketSecici(cache.sirketler, s => { g.sirket_id = s.id; ov.querySelector('#yySirketAd').textContent = s.ad; ov.querySelector('#yySirketAd').className = 'text-on-surface'; gunlukGoster() }))
  ov.querySelector('#yyBrut').addEventListener('input', e => { g.brut = e.target.value; gunlukGoster() })

  // ── Poliçe PDF okuma ───────────────────────────────────
  const drop = ov.querySelector('#yyDrop')
  const dosyaInp = ov.querySelector('#yyDosya')
  const okumaKap = ov.querySelector('#yyOkuma')
  drop.addEventListener('click', () => dosyaInp.click())
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('border-primary', 'bg-primary/5') })
  drop.addEventListener('dragleave', () => drop.classList.remove('border-primary', 'bg-primary/5'))
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('border-primary', 'bg-primary/5')
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
    if (f) policeOku(f)
  })
  dosyaInp.addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) policeOku(f) })

  async function policeOku(file) {
    okumaKap.classList.remove('hidden')
    okumaKap.innerHTML = `<div class="bg-surface-container-low rounded-lg px-3 py-2.5 text-label-md text-on-surface-variant flex items-center gap-2">
      ${mat('progress_activity', 'animate-spin text-[18px]')} <span id="yyOkuDurum">PDF okunuyor…</span></div>`
    try {
      const { satirlar, kaynak } = await belgeSatirlari(file, pr => {
        const el = ov.querySelector('#yyOkuDurum')
        if (el) el.textContent = `Taranmış belge — metin çıkarılıyor %${Math.round((pr || 0) * 100)}`
      })
      okumaSonucCiz(policeAyristir(satirlar), kaynak, file.name)
    } catch (err) {
      console.error('[sigorta] police pdf okunamadi', err)   // §5.4 sessiz catch yok
      okumaKap.innerHTML = `<div class="bg-error-container text-on-error-container rounded-lg px-3 py-2.5 text-label-md">
        Okunamadı: ${kacis(err.message || String(err))} — alanları elle girebilirsiniz.</div>`
    }
  }

  // ⚠️ SATIR SATIR ONAY. Kullanıcı neyin okunduğunu GÖRÜR, sonra uygular.
  //    "Veriler doğru mu kontrol et" isteği tam olarak bu adım.
  function okumaSonucCiz(r, kaynak, dosyaAdi) {
    const A = r.alanlar
    const es = A.sirket_adi ? sirketEsle(cache.sirketler, A.sirket_adi) : null
    const satir = (et, deger, notu) => `<div class="flex items-start justify-between gap-3 py-1">
      <span class="text-[11px] uppercase tracking-wide text-on-surface-variant shrink-0">${et}</span>
      <span class="text-label-md font-bold text-on-surface text-right min-w-0">${
        deger == null || deger === '' ? '<span class="text-error font-normal">okunamadı</span>' : kacis(String(deger))}${
        notu ? `<span class="block text-[10px] font-normal text-on-surface-variant">${kacis(notu)}</span>` : ''}</span></div>`
    okumaKap.innerHTML = `<div class="bg-surface-container-low border border-outline-variant rounded-xl p-3">
      <div class="flex items-center gap-2 text-primary font-bold text-label-md mb-1">
        ${mat('fact_check', 'text-[18px]')} PDF'ten okundu — kontrol edin
        <span class="ml-auto text-[10px] font-normal text-on-surface-variant">${kacis(dosyaAdi)} · ${kaynak === 'OCR' ? 'taranmış (OCR)' : 'metin'}</span></div>
      ${/* ⚠️ HANGİ ŞABLONLA okunduğunu SÖYLE. 'GENEL' = şirket tanınmadı,
            alanlar genel etiketlerle tahmin edildi; kullanıcı o zaman her
            satırı ayrı ayrı doğrulamalı. Sessizce göstermek, yanlış okunan
            bir tutarın fark edilmemesi demek. */''}
      <div class="text-[10px] mb-1 ${r.saglayici === 'GENEL' ? 'text-amber-700 font-bold' : 'text-on-surface-variant'}">
        ${r.saglayici === 'GENEL' ? '⚠ Şablon tanınmadı — genel okuma' : 'Şablon: ' + kacis(SAGLAYICI_AD[r.saglayici] || r.saglayici)}</div>
      ${satir('Plaka', A.plaka)}
      ${satir('Araç tipi', A.arac_tipi === 'KAMYONET' ? 'Kamyonet' : A.arac_tipi === 'OTOMOBIL' ? 'Otomobil' : null)}
      ${satir('Şirket', es ? es.ad : A.sirket_adi, es ? null : 'Tanımlardaki şirketle eşleşmedi — elle seçin')}
      ${satir('Poliçe no', A.police_no)}
      ${satir('Başlangıç', A.baslangic)}
      ${satir('Bitiş', A.bitis ? `${A.bitis}${A.sure_gun ? ` (${A.sure_gun} gün)` : ''}` : null)}
      ${satir('Brüt', A.brut != null ? fmtPara(A.brut) : null)}
      ${satir('Net', A.net != null ? fmtPara(A.net) : null)}
      ${A.tahsilat_metni ? satir('Tahsil yöntemi', A.tahsilat_metni) : ''}
      ${r.uyarilar.length ? `<div class="mt-2 px-2 py-1.5 rounded-lg bg-[#FEF3C7] text-[#92400E] text-[11px]">${
        r.uyarilar.map(u => kacis(u)).join('<br>')}</div>` : ''}
      <div class="flex gap-2 mt-2">
        <button id="yyUygula" class="flex-1 bg-primary text-on-primary rounded-lg py-2 text-label-md font-bold hover:opacity-90">Formu Doldur</button>
        <button id="yyVazgecOku" class="px-3 rounded-lg border border-outline-variant text-label-md text-on-surface-variant">Kullanma</button>
      </div></div>`

    ov.querySelector('#yyVazgecOku').addEventListener('click', () => { okumaKap.classList.add('hidden'); okumaKap.innerHTML = '' })
    ov.querySelector('#yyUygula').addEventListener('click', () => {
      // ⚠️ YALNIZ OKUNAN ALANLAR yazılır. Okunamayan alan kullanıcının
      //    yazdığını EZMEZ — boşla üzerine yazmak veri kaybıdır.
      if (A.plaka) ov.querySelector('#yyPlaka').value = A.plaka
      if (A.police_no) ov.querySelector('#yyPno').value = A.police_no
      if (A.baslangic) ov.querySelector('#yyAlis').value = A.baslangic
      if (A.brut != null) { ov.querySelector('#yyBrut').value = A.brut; g.brut = A.brut }
      if (A.net != null) ov.querySelector('#yyNet').value = A.net
      if (A.arac_tipi) {
        g.tip = A.arac_tipi
        ov.querySelectorAll('[data-yt]').forEach(b => { b.className =
          `px-4 py-2 text-label-md font-bold ${b.dataset.yt === g.tip ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant'}` })
      }
      if (es) { g.sirket_id = es.id; const ad = ov.querySelector('#yySirketAd'); ad.textContent = es.ad; ad.className = 'text-on-surface' }
      gunlukGoster()
      okumaKap.innerHTML = `<div class="bg-secondary-container text-on-secondary-container rounded-lg px-3 py-2 text-label-md flex items-center gap-2">
        ${mat('check_circle', 'text-[18px]')} Form dolduruldu — kaydetmeden önce kontrol edin.</div>`
    })
  }
  ov.querySelector('#yyKaydet').addEventListener('click', async () => {
    g.plaka = ov.querySelector('#yyPlaka').value.trim().toLocaleUpperCase('tr')
    g.alis = ov.querySelector('#yyAlis').value
    g.net = ov.querySelector('#yyNet').value
    g.brut = ov.querySelector('#yyBrut').value
    g.police_no = ov.querySelector('#yyPno').value.trim()
    if (!g.plaka || !g.sirket_id || !g.alis || !g.brut) { alert('Plaka, şirket, alış tarihi ve brüt zorunlu.'); return }
    const btn = ov.querySelector('#yyKaydet'); btn.disabled = true
    try { await yapbozAc(g); kapat(); await listeYukle() }
    catch (e) { console.error('yapboz ac', e); alert('Kaydedilemedi: ' + (e.message || e)); btn.disabled = false }
  })
}

async function aracBul(plaka, tip) {
  const { data } = await supabase.from('sigorta_araclari').select('id').eq('plaka', plaka).eq('aktif', true).limit(1)
  if (data && data.length) { await supabase.from('sigorta_araclari').update({ tip }).eq('id', data[0].id); return data[0].id }
  const { data: yeni, error } = await supabase.from('sigorta_araclari').insert({ plaka, tip, kaynak: 'HARICI_MUSTERI' }).select('id').single()
  if (error) throw error
  return yeni.id
}

async function yapbozAc(g) {
  if (!cache.yapbozTurId) throw new Error('YAPBOZ poliçe türü bulunamadı (Tanımlar).')
  const aracId = await aracBul(g.plaka, g.tip)
  const sirket = sirketById(g.sirket_id)
  const gunluk = yapbozGunluk(sirket, g.tip, Number(g.brut), 60)
  const bitis = artiGun(g.alis, 60)
  const net = g.net ? Number(g.net) : Number(g.brut)   // yapbozda net verilmezse brüt=net say
  // 1) YAPBOZ poliçesi (acente = İsmail Çalmaz Otomotiv)
  const { data: pol, error: e1 } = await supabase.from('policeler').insert({
    police_no: g.police_no || ('YB-' + Date.now()), tur_id: cache.yapbozTurId, sirket_id: g.sirket_id,
    acente: 'ISMAIL_CALMAZ_OTOMOTIV', arac_id: aracId, brut: Number(g.brut), net,
    komisyon_orani: 0, komisyon_tutari: 0, baslangic: g.alis, bitis, olusturan: benim.email,
  }).select('id').single()
  if (e1) throw e1
  // 2) yapboz kaydı
  const { error: e2 } = await supabase.from('yapbozlar').insert({
    police_id: pol.id, arac_id: aracId, alis_tarihi: g.alis, toplam_gun: 60, gunluk_ucret: gunluk, durum: 'AKTIF',
  })
  if (e2) throw e2
}

// --------------------------------------------------------- Satıldı işaretle
function satisModal(y) {
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-center justify-center px-4'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-sm" onclick="event.stopPropagation()">
    <div class="px-lg py-4 border-b border-outline-variant"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat('sell', 'text-[22px]')} Satıldı İşaretle</h3></div>
    <div class="p-lg space-y-3">
      <p class="text-body-md text-on-surface-variant"><b>${kacis(y.sigorta_araclari?.plaka)}</b> aracının satış tarihini girin. Beklenen iade otomatik hesaplanır.</p>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Satış Tarihi</label><input id="stTarih" type="date" value="${bugunISO()}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      <div id="stOnizleme" class="bg-surface-container-low rounded-lg px-4 py-3 text-body-md"></div>
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg"><button id="stVazgec" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="stKaydet" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90">İşaretle</button></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat); ov.querySelector('#stVazgec').addEventListener('click', kapat)
  const onizle = () => {
    const t = ov.querySelector('#stTarih').value
    const s = sirketById(y.policeler?.sirket_id)
    const b = beklenenIade(s, y.sigorta_araclari?.tip || 'OTOMOBIL', Number(y.policeler?.brut) || 0, y.alis_tarihi, t, y.toplam_gun || 60, cache.satisDahil)
    ov.querySelector('#stOnizleme').innerHTML = `Kullanılan <b>${b.kullanilan}</b> gün · kalan <b>${b.kalan}</b> gün<br>Beklenen iade: <b class="text-primary">${fmtPara(b.tutar)}</b>${b.tavan ? ' <span class="text-amber-700 text-[11px]">(tavan uygulandı)</span>' : ''}`
  }
  ov.querySelector('#stTarih').addEventListener('input', onizle); onizle()
  ov.querySelector('#stKaydet').addEventListener('click', async () => {
    const t = ov.querySelector('#stTarih').value
    const s = sirketById(y.policeler?.sirket_id)
    const b = beklenenIade(s, y.sigorta_araclari?.tip || 'OTOMOBIL', Number(y.policeler?.brut) || 0, y.alis_tarihi, t, y.toplam_gun || 60, cache.satisDahil)
    const btn = ov.querySelector('#stKaydet'); btn.disabled = true
    const { error } = await supabase.from('yapbozlar').update({ satis_tarihi: t, kullanilan_gun: b.kullanilan, kalan_gun: b.kalan, beklenen_iade: b.tutar, tavan_uygulandi_mi: b.tavan, durum: 'SATILDI_IADE_BEKLIYOR', updated_at: new Date().toISOString() }).eq('id', y.id)
    if (error) { console.error(error); alert('Hata: ' + error.message); btn.disabled = false; return }
    if (y.arac_id) await supabase.from('sigorta_araclari').update({ satis_tarihi: t }).eq('id', y.arac_id)
    kapat(); await listeYukle()
  })
}

// --------------------------------------------------------- İade Gir
function iadeModal(y) {
  const s = sirketById(y.policeler?.sirket_id)
  const tip = y.sigorta_araclari?.tip || 'OTOMOBIL'
  const gun = y.toplam_gun || 60
  const st = { satis: y.satis_tarihi || bugunISO(), tahsilat_sekli_id: '', kart_id: '', durum: 'BEKLIYOR', tahsil_tarihi: '', not: '', gerc: '' }
  const hesap = () => beklenenIade(s, tip, Number(y.policeler?.brut) || 0, y.alis_tarihi, st.satis, gun, cache.satisDahil)
  let bek = hesap(); st.gerc = String(bek.tutar)

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[6vh] px-4 overflow-y-auto'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-lg mb-10" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-lg py-4 border-b border-outline-variant">
      <h3 class="text-title-lg text-primary flex items-center gap-2">${mat('undo', 'text-[22px]')} İade Girişi <span class="text-[11px] font-mono bg-primary-fixed text-primary px-2 py-0.5 rounded">${kacis(y.sigorta_araclari?.plaka || '')}</span></h3>
      <button id="idKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div class="p-lg space-y-4">
      <div class="bg-surface-container-low rounded-xl p-4 grid grid-cols-3 gap-3 text-body-md">
        ${idBilgi('Poliçe No', y.policeler?.police_no)}${idBilgi('Şirket', s?.ad)}${idBilgi('Alış Tarihi', tar(y.alis_tarihi))}
        ${idBilgi('Süre', gun + ' gün')}<div id="idKull"></div><div id="idKalan"></div>
        ${idBilgi('Günlük Ücret', fmtPara(y.gunluk_ucret))}<div class="col-span-2 text-right"><div class="text-[11px] uppercase tracking-wide text-on-surface-variant">Beklenen İade</div><div id="idBeklenen" class="font-bold text-primary text-title-lg"></div></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Satış Tarihi</label><input id="idSatis" type="date" value="${st.satis}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Tahsilat Şekli</label>
          <select id="idTahsil" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"><option value="">— seçin —</option>${cache.tahsilat.map(t => `<option value="${t.id}">${kacis(t.ad)}</option>`).join('')}</select></div>
      </div>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Gerçekleşen İade Tutarı ₺</label>
        <input id="idGerc" type="number" step="0.01" value="${st.gerc}" class="w-full text-center bg-surface border border-outline-variant rounded-lg px-3 py-4 text-headline-md font-bold text-on-surface outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      <div id="idFark"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">İade Edilecek Kart</label>
          <select id="idKart" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"><option value="">— kart —</option>${cache.kartlar.map(k => `<option value="${k.id}">${kacis(k.ad)}${k.son_dort ? ' ••••' + k.son_dort : ''}</option>`).join('')}</select>
          <p id="idKartNot" class="text-[11px] text-on-surface-variant mt-1"></p>
          <div id="idKartGorsel" class="mt-2"></div></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Tahsilat Durumu</label>
          <div class="inline-flex rounded-lg border border-outline-variant overflow-hidden w-full">
            ${['BEKLIYOR', 'TAHSIL_EDILDI'].map(d => `<button data-td="${d}" class="flex-1 px-3 py-2.5 text-label-md font-bold ${st.durum === d ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant'}">${d === 'BEKLIYOR' ? 'Bekliyor' : 'Tahsil Edildi'}</button>`).join('')}
          </div></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Tahsil Tarihi</label><input id="idTahsilT" type="date" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Not</label><input id="idNot" placeholder="İsteğe bağlı…" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      </div>
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg"><button id="idVazgec" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="idKaydet" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('save', 'text-[18px]')} İadeyi Kaydet</button></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat); ov.querySelector('#idKapat').addEventListener('click', kapat); ov.querySelector('#idVazgec').addEventListener('click', kapat)

  const yenile = () => {
    bek = hesap()
    ov.querySelector('#idKull').innerHTML = idBilgiHtml('Kullanılan', bek.kullanilan + ' gün')
    ov.querySelector('#idKalan').innerHTML = idBilgiHtml('Kalan', bek.kalan + ' gün')
    ov.querySelector('#idBeklenen').textContent = fmtPara(bek.tutar)
    farkCiz()
  }
  const farkCiz = () => {
    const gerc = Number(ov.querySelector('#idGerc').value) || 0
    const fark = round2(bek.tutar - gerc)
    const oran = bek.tutar > 0 ? Math.abs(fark) / bek.tutar : 0
    const kutu = ov.querySelector('#idFark')
    if (Math.abs(fark) < 0.5) kutu.innerHTML = `<div class="flex items-center gap-2 bg-secondary-container text-on-secondary-container rounded-lg px-3 py-2 text-body-md">${mat('check_circle', 'text-[18px]')} Tam pro-rata — sapma yok</div>`
    else if (oran > 0.20) kutu.innerHTML = `<div class="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-3 py-2 text-body-md">${mat('warning', 'text-[18px]')}<div>Fark ${fmtPara(fark)} — beklenenden %${Math.round(oran * 100)} sapıyor.<br><span class="text-[11px]">Kaydedildiğinde <b>dikkat listesine</b> düşer.</span></div></div>`
    else kutu.innerHTML = `<div class="flex items-center gap-2 bg-surface-container-low text-on-surface-variant rounded-lg px-3 py-2 text-body-md">${mat('info', 'text-[18px]')} Fark ${fmtPara(fark)} (%${Math.round(oran * 100)}) — eşik altında.</div>`
  }
  ov.querySelector('#idSatis').addEventListener('input', e => { st.satis = e.target.value; yenile() })
  ov.querySelector('#idGerc').addEventListener('input', farkCiz)
  ov.querySelector('#idTahsil').addEventListener('change', e => { st.tahsilat_sekli_id = e.target.value; kartOner() })
  ov.querySelectorAll('[data-td]').forEach(el => el.addEventListener('click', () => { st.durum = el.dataset.td; ov.querySelectorAll('[data-td]').forEach(b => b.className = `flex-1 px-3 py-2.5 text-label-md font-bold ${b.dataset.td === st.durum ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant'}`); if (st.durum === 'TAHSIL_EDILDI' && !ov.querySelector('#idTahsilT').value) ov.querySelector('#idTahsilT').value = bugunISO() }))
  // Seçili karta göre görseli çiz — hem otomatik hem elle seçimde.
  const kartGorseliCiz = () => {
    const sec = ov.querySelector('#idKart')
    const kart = cache.kartlar.find(x => x.id === sec.value)
    kartBloguCiz(ov.querySelector('#idKartGorsel'), kart, 'sigorta-yapboz')
  }

  const kartOner = () => {
    const not = ov.querySelector('#idKartNot')
    // ⚠️ taraf='SIRKET': yapboz iadesinde para ŞİRKETE dönüyor.
    //    Poliçe kesimindeki 'MUSTERI' değerini buraya kopyalamak kuralı
    //    hiç eşleştirmez.
    const kart = kartSec(cache.kural, cache.kartlar, {
      taraf: 'SIRKET',
      tahsilatSekliId: st.tahsilat_sekli_id,
      policeTuruId: cache.yapbozTurId,
    })
    if (kart) {
      ov.querySelector('#idKart').value = kart.id
      not.textContent = 'Tahsilat şekline göre otomatik seçildi.'
    } else {
      // ⚠️ Eski kod kural bulunca koşulsuz "otomatik seçildi" yazıyordu;
      //    kural pasif bir karta işaret ediyorsa select boş kalıp not yalan
      //    söylüyordu. kartSec() artık bulunamayan kuralı atlayıp sıradakine
      //    bakıyor, burası da yalnız gerçekten seçim olmadığında yazıyor.
      not.textContent = cache.kartlar.length ? '' : 'Kart tanımlı değil — Tanımlar’dan ekleyin.'
    }
    kartGorseliCiz()
  }
  // ⚠️ KUSUR: #idKart'ta 'change' dinleyicisi YOKTU — kullanıcı kartı ELLE
  //    değiştirdiğinde görsel eski kartta kalırdı (yanlış kart gösteren sessiz hata).
  ov.querySelector('#idKart').addEventListener('change', kartGorseliCiz)

  yenile(); kartOner()

  ov.querySelector('#idKaydet').addEventListener('click', async () => {
    const gerc = Number(ov.querySelector('#idGerc').value)
    if (!gerc && gerc !== 0) { alert('Gerçekleşen iade tutarı girin.'); return }
    const btn = ov.querySelector('#idKaydet'); btn.disabled = true
    try {
      const kartId = ov.querySelector('#idKart').value || null
      const { data: h, error: e1 } = await supabase.from('police_hareketleri').insert({
        police_id: y.police_id, tip: 'IADE', taraf: 'SIRKET', tutar: -Math.abs(gerc), komisyon_tutari: 0,
        tahsilat_sekli_id: st.tahsilat_sekli_id || null, kart_id: kartId, islem_tarihi: bugunISO(),
        beklenen_tutar: bek.tutar, tahsilat_durum: st.durum, tahsil_tarihi: (st.durum === 'TAHSIL_EDILDI' ? (ov.querySelector('#idTahsilT').value || bugunISO()) : null),
        notlar: ov.querySelector('#idNot').value.trim() || null, olusturan: benim.email,
      }).select('id').single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('yapbozlar').update({
        satis_tarihi: st.satis, kullanilan_gun: bek.kullanilan, kalan_gun: bek.kalan, beklenen_iade: bek.tutar,
        tavan_uygulandi_mi: bek.tavan, gerceklesen_iade: Math.abs(gerc), iade_hareket_id: h.id, durum: 'IADE_EDILDI', updated_at: new Date().toISOString(),
      }).eq('id', y.id)
      if (e2) throw e2
      kapat(); await listeYukle()
    } catch (e) { console.error('iade kaydet', e); alert('Kaydedilemedi: ' + (e.message || e)); btn.disabled = false }
  })
}
const idBilgi = (l, v) => `<div><div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${l}</div><div class="font-semibold">${kacis(v || '—')}</div></div>`
const idBilgiHtml = (l, v) => `<div class="text-[11px] uppercase tracking-wide text-on-surface-variant">${l}</div><div class="font-semibold">${kacis(v)}</div>`
