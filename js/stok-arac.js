// =====================================================================
// stok-arac.js — Araç Çalışma Alanı (Vehicle Workspace)
//   SİTE araç + CRM (uygun müşteri, kredi, not/sohbet, yaşam döngüsü).
//   Danışman sayfa değiştirmeden aracı yönetir.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb, stokTek } from './site-client.js'
import { uygunTalepler } from './eslestirme.js'
import { danismanMap, danismanAdi, fmtPara, fmtTarih, fmtTarihKisa, fmtButce, telNo, waHref, kacis, urlParam, kapanisMi } from './veri.js'
import { mat, avatar, uyari } from './stitch-ui.js'

let benim = null, dmap = {}, ref = null
let notIdSet = new Set(), sohbetKanali = null
let sonArac = null

// --- Uyum skoru (kural-tabanlı, şeffaf: bütçe merkezi + model + yıl) ---
function uyumSkor(arac, t) {
  let p = 72
  const fiyat = Number(arac.fiyat) || 0
  const bmin = Number(t.butce_min) || 0, bmax = Number(t.butce_max) || 0
  if (fiyat > 0 && bmax) {
    if (fiyat <= bmax) p += 10
    if (bmin && fiyat >= bmin) p += 4
    if (bmin && bmax > bmin) { const orta = (bmin + bmax) / 2; const yakin = 1 - Math.min(1, Math.abs(fiyat - orta) / ((bmax - bmin) / 2)); p += Math.round(yakin * 8) }
  }
  p += (t.model && t.model !== '-') ? 8 : (t.marka ? 4 : 0)
  const yil = Number(arac.yil) || 0
  if (yil && t.model_yili_min && yil >= Number(t.model_yili_min)) p += 2
  return Math.max(60, Math.min(99, Math.round(p)))
}

function gonderenTipi(rol) { return rol === 'yonetici' ? 'YÖNETİCİ' : rol === 'santral' ? 'SANTRAL' : 'DANIŞMAN' }
function saat(ts) { return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }

export async function stokAracKur(danisman) {
  benim = danisman
  dmap = await danismanMap()
  ref = urlParam('ref')
  if (!ref) {
    document.getElementById('icerik').innerHTML =
      '<div class="uyari-kutu">Araç bulunamadı. <a href="stok.html">Stok\'a dön</a></div>'
    return
  }
  document.getElementById('yeniNotForm')?.addEventListener('submit', notEkle)
  await yukle()
  realtimeKur()
}

async function yukle() {
  const [arac, notRes, talepRes] = await Promise.all([
    stokTek(ref),
    supabase.from('gorusme_notlari').select('id, gorusme_notu, acan_id, created_at').eq('stok_ref', ref).order('created_at', { ascending: true }),
    supabase.from('talepler').select('id, musteri_ad_soyad, telefon, marka, model, butce_min, butce_max, model_yili_min, model_yili_max, gorusme_notlari(sahip_danisman_id, musteri_durumu, created_at)').limit(2000),
  ])

  if (!arac) {
    document.getElementById('aracHero').innerHTML = '<div class="p-lg text-white">Araç okunamadı (bulunamadı).</div>'
    return
  }
  sonArac = arac
  const notlar = notRes.data || []
  const acik = (talepRes.data || []).filter(t => {
    const son = (t.gorusme_notlari || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    return !kapanisMi(son?.musteri_durumu)
  })
  const uygun = uygunTalepler(arac, acik)

  const krediOzet = await krediOzetAl()
  heroCiz(arac)
  crmOzetCiz(arac, uygun.length, notlar.length, krediOzet)
  teknikCiz(arac)
  uygunMusteriCiz(arac, uygun)
  timelineCiz(arac, notlar, krediOzet)
  krediBasvuruCiz(arac)
  stickyBarCiz()

  // Notlar + sohbet
  const kap = document.getElementById('notlar')
  if (notRes.error) { kap.innerHTML = `<div class="uyari-kutu">Notlar okunamadı: ${kacis(notRes.error.message)}</div>`; return }
  if (!notlar.length) { kap.innerHTML = '<div class="bos-durum">Bu araca ait not yok. İlk notu ekle.</div>'; notIdSet = new Set(); return }
  notIdSet = new Set(notlar.map(n => n.id))
  kap.innerHTML = notlar.map(notKarti).join('')
  notlar.forEach(baglaOlaylar)
  await mesajlariYukle([...notIdSet])
}

// --- HERO ----------------------------------------------------------
function heroCiz(a) {
  const foto = (a.fotolar || '').split(',')[0]?.trim()
  document.getElementById('aracBaslik') && (document.getElementById('aracBaslik').textContent = [a.marka, a.model].filter(Boolean).join(' '))
  const satildi = a.durum === 'satildi'
  const durumRozet = satildi
    ? '<span class="px-3 py-1 rounded-full text-xs font-bold bg-green-500 text-white">Satıldı</span>'
    : '<span class="px-3 py-1 rounded-full text-xs font-bold bg-secondary text-white">Stokta</span>'
  const dususFark = (a.indirimli && a.onceki_fiyat) ? (Number(a.onceki_fiyat) - Number(a.fiyat)) : 0
  const altSatir = [a.versiyon, a.km ? Number(a.km).toLocaleString('tr-TR') + ' KM' : null, [a.yakit, a.vites].filter(Boolean).join(' ')].filter(Boolean).join('  ·  ')
  document.getElementById('aracHero').innerHTML = `
    <div class="relative min-h-[300px] flex flex-col justify-end">
      ${foto
      ? `<img src="${kacis(foto)}" alt="" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'">`
      : `<div class="absolute inset-0 flex items-center justify-center">${mat('directions_car', 'text-6xl text-white/20')}</div>`}
      <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20"></div>
      <div class="relative p-lg md:p-xl text-white">
        <div class="flex items-center gap-2 mb-2">
          <span class="bg-white/15 backdrop-blur text-white text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">Stok No: #${kacis(String(a.id)).slice(0, 8)}</span>
          ${durumRozet}
        </div>
        <div class="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 class="text-headline-md md:text-headline-lg font-black leading-none">${kacis([a.marka, a.model].filter(Boolean).join(' '))}${a.yil ? ` <span class="text-white/60">${kacis(a.yil)}</span>` : ''}</h2>
            <p class="text-white/80 mt-2 text-body-lg">${kacis(altSatir) || '—'}</p>
          </div>
          <div class="text-right">
            ${dususFark > 0 ? `<div class="text-error-container font-bold text-label-md flex items-center justify-end gap-1 mb-1">${mat('trending_down', 'text-[18px]')} ${fmtPara(dususFark)} düşüş</div>` : ''}
            ${(a.indirimli && a.onceki_fiyat) ? `<div class="text-white/50 line-through text-body-md">${fmtPara(a.onceki_fiyat)}</div>` : ''}
            <div class="text-headline-md md:text-headline-lg font-black">${fmtPara(a.fiyat)}</div>
          </div>
        </div>
      </div>
    </div>`
}

// --- CRM ÖZET ------------------------------------------------------
function crmOzetCiz(a, uygunSayi, notSayi, kredi) {
  const kutu = (deger, etiket, ik, vurgu) => `
    <div class="rounded-xl border ${vurgu ? 'border-primary/30 bg-primary/5' : 'border-outline-variant bg-surface-container-low'} p-3 text-center">
      <div class="flex items-center justify-center gap-1 ${vurgu ? 'text-primary' : 'text-on-surface-variant'}">${mat(ik, 'text-[18px]')}</div>
      <p class="text-headline-sm font-black ${vurgu ? 'text-primary' : 'text-on-surface'} leading-tight mt-0.5">${deger}</p>
      <p class="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">${etiket}</p>
    </div>`
  const krediMetni = kredi?.durum
    ? (kredi.durum === 'onayli' ? 'Onaylı ✓' : 'Değerlendirmede')
    : '—'
  document.getElementById('crmOzet').innerHTML = `
    <h3 class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">CRM Özeti</h3>
    <div class="grid grid-cols-2 gap-2">
      ${kutu(uygunSayi, 'Uygun Talep', 'group', uygunSayi > 0)}
      ${kutu(notSayi, 'Ekip Notu', 'forum', false)}
      ${kutu(krediMetni, 'Kredi', 'credit_score', kredi?.durum === 'onayli')}
      ${kutu((a.durum === 'satildi' ? 'Satıldı' : 'Stokta'), 'Durum', a.durum === 'satildi' ? 'sell' : 'inventory_2', false)}
    </div>
    ${kredi?.durum ? `<div class="mt-3 text-label-sm ${kredi.durum === 'onayli' ? 'text-green-700' : 'text-amber-700'} bg-surface-container-low rounded-lg p-2.5 flex items-center gap-2">${mat(kredi.durum === 'onayli' ? 'verified' : 'hourglass_top', 'text-[18px]')} <span><b>${kacis(kredi.gonderen || '')}</b> — ${kredi.durum === 'onayli' ? 'onaylı kredi mevcut' : 'kredi değerlendirmede'}</span></div>` : ''}`
}

// --- Teknik ---------------------------------------------------------
function teknikCiz(a) {
  const bilgi = (e, d) => `<div><p class="text-[11px] text-on-surface-variant uppercase tracking-wide">${e}</p><p class="text-body-lg font-medium text-on-surface mt-0.5">${d || '—'}</p></div>`
  document.getElementById('aracTeknik').innerHTML = `
    <div class="grid grid-cols-2 gap-lg">
      ${bilgi('Yıl / KM', (kacis(a.yil) || '—') + ' · ' + (a.km ? Number(a.km).toLocaleString('tr-TR') + ' km' : '—'))}
      ${bilgi('Yakıt / Vites', kacis([a.yakit, a.vites].filter(Boolean).join(' / ')))}
      ${bilgi('Renk / Kasa', kacis([a.renk, a.kasa_tipi].filter(Boolean).join(' · ')))}
      ${bilgi('Versiyon', kacis(a.versiyon))}
      ${bilgi('Plaka', kacis(a.plaka))}
      ${bilgi('İlanda', (function () { if (!a.eklendi) return '—'; const g = Math.max(0, Math.floor((Date.now() - new Date(a.eklendi)) / 86400000)); return g + ' gün (vitrinde)' })())}
    </div>`
}

// --- Bu aracı isteyen müşteriler (kart + uyum %) -------------------
function uygunMusteriCiz(arac, uygun) {
  const kart = document.getElementById('uygunMusteriKart')
  const hedef = document.getElementById('uygunMusteri')
  if (!uygun.length) {
    document.getElementById('uygunMusteriSayi').textContent = ''
    hedef.innerHTML = `<div class="text-center py-8 text-on-surface-variant">${mat('person_search', 'text-3xl opacity-30')}<p class="mt-2 text-body-md">Bu araçla eşleşen açık talep yok.</p></div>`
    return
  }
  const sirali = uygun.map(t => ({ t, s: uyumSkor(arac, t) })).sort((a, b) => b.s - a.s).slice(0, 12)
  document.getElementById('uygunMusteriSayi').textContent = `${uygun.length} müşteri eşleşti`
  const sahip = t => { const n = (t.gorusme_notlari || []).find(g => g.sahip_danisman_id); return n ? danismanAdi(dmap, n.sahip_danisman_id) : 'Havuzda' }
  hedef.innerHTML = `<div class="space-y-2.5">${sirali.map(({ t, s }) => {
    const tel = telNo(t.telefon), wa = waHref(t.telefon)
    const istek = [t.marka, t.model].filter(v => v && v !== '-' && v.toLowerCase() !== 'farketmez').join(' ')
    const skorCls = s >= 90 ? 'text-green-700' : s >= 80 ? 'text-primary' : 'text-amber-700'
    return `<div class="border border-outline-variant rounded-xl p-3 flex items-center gap-3 hover:border-primary/40 hover:bg-surface-container-low transition-all">
      <a href="talep.html?id=${t.id}" class="flex items-center gap-3 min-w-0 flex-1">
        ${avatar(t.musteri_ad_soyad, 'w-10 h-10')}
        <div class="min-w-0"><p class="font-bold text-on-surface truncate">${kacis(t.musteri_ad_soyad) || '—'}</p>
          <p class="text-label-sm text-on-surface-variant truncate">${kacis(fmtButce(t.butce_min, t.butce_max))}${istek ? ' · ister: ' + kacis(istek) : ''} · ${kacis(sahip(t))}</p></div>
      </a>
      <div class="text-center shrink-0 mr-1"><div class="text-title-lg font-black ${skorCls} leading-none">%${s}</div><div class="text-[9px] uppercase tracking-wide text-on-surface-variant">uyum</div></div>
      <div class="flex gap-1.5 shrink-0">
        ${tel ? `<a href="tel:${tel}" title="Ara" class="w-9 h-9 rounded-lg bg-primary text-on-primary inline-flex items-center justify-center hover:opacity-90">${mat('call', 'text-[18px]')}</a>` : ''}
        ${wa ? `<a href="${wa}" target="_blank" title="WhatsApp" class="w-9 h-9 rounded-lg bg-[#25D366] text-white inline-flex items-center justify-center hover:opacity-90">${mat('chat', 'text-[18px]')}</a>` : ''}
      </div>
    </div>`
  }).join('')}</div>
  <p class="text-[11px] text-on-surface-variant mt-3">Uyum skoru = bütçe merkezi + model/marka + yıl yakınlığı (kural-tabanlı, gerçek AI değil).</p>`
}

// --- Yaşam döngüsü (timeline) — gerçek olaylar ---------------------
function timelineCiz(a, notlar, kredi) {
  const olaylar = []
  notlar.forEach(n => olaylar.push({ ts: n.created_at, ik: 'forum', baslik: 'Ekip Notu', metin: n.gorusme_notu || '(not metni yok)', kim: danismanAdi(dmap, n.acan_id) }))
  if (a.eklendi) olaylar.push({ ts: a.eklendi, ik: 'add_circle', baslik: 'Siteye eklendi', metin: 'İlan yayına girdi.', kim: '' })
  if (a.durum === 'satildi' && a.satildi_tarih) olaylar.push({ ts: a.satildi_tarih, ik: 'sell', baslik: 'Satıldı', metin: 'Araç satış olarak işaretlendi.', kim: '' })
  olaylar.sort((x, y) => new Date(y.ts) - new Date(x.ts))

  let ust = ''
  if (kredi?.durum) ust = `<div class="relative">
    <div class="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full ${kredi.durum === 'onayli' ? 'bg-green-600' : 'bg-amber-500'} ring-4 ring-white"></div>
    <div class="font-bold text-label-md text-on-surface">${kredi.durum === 'onayli' ? 'Kredi Onaylı' : 'Kredi Değerlendirmede'}</div>
    <p class="text-label-sm text-on-surface-variant">${kacis(kredi.gonderen || '')} tarafından başvuruldu.</p></div>`

  const govde = olaylar.length || ust
    ? `<div class="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[6px] before:top-1 before:bottom-1 before:w-px before:bg-outline-variant">
        ${ust}${olaylar.map(o => `<div class="relative">
          <div class="absolute -left-[21px] top-1 w-3.5 h-3.5 rounded-full bg-primary ring-4 ring-white"></div>
          <div class="flex justify-between items-baseline gap-2"><span class="font-bold text-label-md text-on-surface flex items-center gap-1.5">${mat(o.ik, 'text-[15px] text-on-surface-variant')} ${o.baslik}</span><span class="text-[11px] text-on-surface-variant shrink-0">${fmtTarihKisa(o.ts)}</span></div>
          <p class="text-label-sm text-on-surface-variant mt-0.5">${kacis(o.metin)}</p>
          ${o.kim ? `<p class="text-[11px] text-on-surface-variant mt-0.5">${kacis(o.kim)}</p>` : ''}</div>`).join('')}
      </div>`
    : '<p class="text-on-surface-variant text-body-md">Henüz kayıtlı olay yok.</p>'
  document.getElementById('timeline').innerHTML = govde
}

// --- Sticky aksiyon çubuğu -----------------------------------------
function stickyBarCiz() {
  const bar = document.getElementById('stickyBar')
  bar.classList.remove('hidden')
  const btn = (ik, etiket, id) => `<button data-act="${id}" class="flex items-center gap-1.5 hover:text-primary-fixed text-label-md font-bold px-2">${mat(ik, 'text-[18px]')} ${etiket}</button>`
  bar.innerHTML = btn('edit_note', 'Not Ekle', 'not') + '<span class="w-px h-5 bg-white/20"></span>' +
    btn('credit_score', 'Kredi Başvurusu', 'kredi') + '<span class="w-px h-5 bg-white/20"></span>' +
    btn('shield', 'Sigorta Teklifi', 'sigorta') + '<span class="w-px h-5 bg-white/20"></span>' +
    btn('group', 'Uygun Müşteriler', 'musteri')
  bar.querySelector('[data-act="not"]').onclick = () => { document.getElementById('notlarKart').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => document.getElementById('yeniNotMetin')?.focus(), 400) }
  bar.querySelector('[data-act="kredi"]').onclick = () => { document.getElementById('krediBasvuruKart').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => document.getElementById('kbAd')?.focus(), 400) }
  bar.querySelector('[data-act="sigorta"]').onclick = () => sigortaTeklifModal(sonArac)
  bar.querySelector('[data-act="musteri"]').onclick = () => document.getElementById('uygunMusteriKart').scrollIntoView({ behavior: 'smooth' })
}

// --- Sigorta teklifi iste (kredi butonu deseni) --------------------
function sigortaTeklifModal(arac) {
  const plaka = (arac && (arac.plaka || arac.plaka_no)) || ''
  const ov = document.createElement('div')
  ov.className = 'stitch fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[12vh] px-4'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-lg py-4 border-b border-outline-variant"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat('shield', 'text-[22px]')} Sigorta Teklifi İste</h3>
      <button id="stfKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div class="p-lg space-y-3">
      <p class="text-body-md text-on-surface-variant">Bu araç için sigorta biriminden teklif istenecek. Birim <b>Fırsatlar</b> ekranından görür.</p>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Araç Plakası</label><input id="stfPlaka" value="${kacis(plaka)}" placeholder="Plaka (biliniyorsa)" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Müşteri Adı</label><input id="stfMusteri" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Not</label><textarea id="stfNot" rows="2" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" placeholder="Peşin/kredili, kasko isteği…"></textarea></div>
      <div id="stfDurum" class="text-label-md"></div>
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg"><button id="stfVaz" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="stfGonder" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('send', 'text-[18px]')} Teklif İste</button></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat); ov.querySelector('#stfKapat').addEventListener('click', kapat); ov.querySelector('#stfVaz').addEventListener('click', kapat)
  ov.querySelector('#stfGonder').addEventListener('click', async () => {
    const durum = ov.querySelector('#stfDurum')
    const btn = ov.querySelector('#stfGonder'); btn.disabled = true
    const arcMarka = [arac?.marka, arac?.model, arac?.yil].filter(Boolean).join(' ')
    const notMetni = [arcMarka, ov.querySelector('#stfNot').value.trim()].filter(Boolean).join(' — ')
    const { error } = await supabase.from('sigorta_firsatlari').insert({
      plaka: ov.querySelector('#stfPlaka').value.trim().toLocaleUpperCase('tr') || null,
      crm_arac_ref: ref || null, talep_eden: benim.email,
      musteri_adi: ov.querySelector('#stfMusteri').value.trim() || null,
      not_metni: notMetni || null, durum: 'TEKLIF_BEKLIYOR',
    })
    if (error) { console.error('sigorta firsat', error); durum.innerHTML = `<span class="text-error">Gönderilemedi: ${kacis(error.message)}</span>`; btn.disabled = false; return }
    durum.innerHTML = `<span class="text-secondary flex items-center gap-1">${mat('check_circle', 'text-[18px]')} Teklif isteği gönderildi.</span>`
    setTimeout(kapat, 1200)
  })
}

// --- Kredi (mevcut mantık korunur) ---------------------------------
async function krediOzetAl() {
  const { data, error } = await supabase.rpc('kredi_stok_ozet', { p_stok_ref: ref })
  if (error) { console.error('[db] kredi ozet', error); return null }
  return (data || [])[0] || null
}

function krediBasvuruCiz(arac) {
  const kutu = document.getElementById('krediBasvuru')
  if (!kutu) return
  const krediRolu = benim.rol === 'kredi'
  const satisSecenek = Object.entries(dmap)
    .filter(([, d]) => d && (d.rol === 'danisman' || d.rol === 'santral'))
    .map(([id, d]) => `<option value="${id}">${kacis(d.ad_soyad)}</option>`).join('')
  kutu.innerHTML = `
    <p class="text-body-md text-on-surface-variant mb-3">Müşterinin ön bilgilerini girin; kredi birimi başvuruyu buradan devam ettirir.</p>
    <div class="form-satir">
      <div class="alan"><label>Müşteri Ad Soyad *</label><input id="kbAd" /></div>
      <div class="alan"><label>Telefon *</label><input id="kbTel" type="tel" inputmode="tel" /></div>
      <div class="alan"><label>TC Kimlik No (opsiyonel)</label><input id="kbTc" inputmode="numeric" maxlength="11" placeholder="Sadece kredi birimi görür" /></div>
    </div>
    ${krediRolu ? `<div class="form-satir">
      <div class="alan"><label>Satış Danışmanı *</label>
        <select id="kbSatisci"><option value="">Seçin…</option>${satisSecenek}</select></div>
      <div class="alan"></div>
    </div>` : ''}
    <div class="alan tam"><label>Açıklama (opsiyonel)</label><textarea id="kbNot" placeholder="Peşinat durumu, özel not…"></textarea></div>
    <div class="aralik flex items-center gap-3 flex-wrap">
      <button id="kbGonder" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold">Kredi Kuyruğuna Gönder</button>
      <span id="kbDurum" class="text-label-md text-on-surface-variant"></span>
    </div>`
  document.getElementById('kbGonder').addEventListener('click', () => krediGonder(arac))
}

async function krediGonder(arac) {
  const durum = document.getElementById('kbDurum')
  const ad = document.getElementById('kbAd').value.trim()
  if (!ad) { durum.textContent = 'Müşteri adı zorunlu.'; return }
  const tel = document.getElementById('kbTel').value.trim()
  if (!tel) { durum.textContent = 'Telefon zorunlu.'; return }
  const satisciEl = document.getElementById('kbSatisci')
  if (satisciEl && !satisciEl.value) { durum.textContent = 'Satış danışmanı seçin.'; return }
  durum.textContent = 'Gönderiliyor…'
  const { error } = await supabase.rpc('kredi_basvuru_olustur', {
    p_musteri: ad,
    p_telefon: tel,
    p_tckn: document.getElementById('kbTc').value.trim() || null,
    p_stok_ref: ref,
    p_arac_ozet: [arac.marka, arac.model].filter(Boolean).join(' ') + ' · ' + fmtPara(arac.fiyat),
    p_plaka: arac.plaka || null,
    p_talep_id: null,
    p_aciklama: document.getElementById('kbNot').value.trim() || null,
    p_satis_danismani: satisciEl ? satisciEl.value : null,
  })
  if (error) { console.error('[db] kredi basvuru', error); durum.textContent = 'Hata: ' + error.message; return }
  durum.textContent = '✓ Kredi kuyruğuna gönderildi'
  ;['kbAd', 'kbTel', 'kbTc', 'kbNot'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
  await yukle()
}

// --- Notlar + sohbet (mevcut desen korunur) ------------------------
function notKarti(n) {
  return `<div class="not-kart" id="not-${n.id}">
    <div class="ust"><div class="soluk">Ekleyen: ${kacis(danismanAdi(dmap, n.acan_id))} · ${fmtTarih(n.created_at)}</div></div>
    <div class="not-metni">${kacis(n.gorusme_notu) || '<span class="soluk">(not metni yok)</span>'}</div>
    <div class="aralik">
      <label class="soluk">Sohbet (ekip)</label>
      <div class="sohbet" data-sohbet="${n.id}"></div>
      <form class="sohbet-gonder" data-gonder="${n.id}">
        <input placeholder="Bu araç hakkında mesaj yaz…" autocomplete="off" />
        <button type="submit" class="btn btn-gold btn-kucuk">Gönder</button>
      </form>
    </div>
  </div>`
}
function baglaOlaylar(n) {
  const form = document.querySelector(`[data-gonder="${n.id}"]`)
  form?.addEventListener('submit', e => { e.preventDefault(); mesajGonder(n.id, form.querySelector('input')) })
}
async function notEkle(e) {
  e.preventDefault()
  const ta = document.getElementById('yeniNotMetin')
  const metin = ta.value.trim()
  if (!metin) return
  const { error } = await supabase.from('gorusme_notlari').insert({ stok_ref: ref, gorusme_notu: metin, acan_id: benim.id })
  if (error) return alert('Not eklenemedi: ' + error.message)
  ta.value = ''
  await yukle()
}

async function mesajlariYukle(notIdler) {
  if (!notIdler.length) return
  const { data, error } = await supabase.from('mesajlar')
    .select('id, gorusme_id, mesaj, gonderen_id, gonderen_tipi, created_at')
    .in('gorusme_id', notIdler).order('created_at', { ascending: true })
  if (error) return console.error(error)
  const grup = {}
  for (const m of data) (grup[m.gorusme_id] ||= []).push(m)
  for (const id of notIdler) sohbetDoldur(id, grup[id] || [])
}
function sohbetDoldur(id, list) {
  const k = document.querySelector(`[data-sohbet="${id}"]`); if (!k) return
  k.innerHTML = list.length ? list.map(balon).join('') : '<div class="bos">Henüz mesaj yok.</div>'
  k.scrollTop = k.scrollHeight
}
function balon(m) {
  const benimMi = m.gonderen_id === benim.id
  const tipCls = m.gonderen_tipi === 'YÖNETİCİ' ? 'yonetici' : m.gonderen_tipi === 'SANTRAL' ? 'santral' : 'danisman'
  return `<div class="balon ${benimMi ? 'benim' : ''}" data-mid="${m.id}">
    <div class="ad">${kacis(danismanAdi(dmap, m.gonderen_id))} <span class="tip ${tipCls}">${kacis(m.gonderen_tipi)}</span></div>
    <div class="metin">${kacis(m.mesaj)}</div><div class="zaman">${saat(m.created_at)}</div></div>`
}
function mesajEkle(id, m) {
  const k = document.querySelector(`[data-sohbet="${id}"]`); if (!k) return
  if (k.querySelector(`[data-mid="${m.id}"]`)) return
  const b = k.querySelector('.bos'); if (b) b.remove()
  k.insertAdjacentHTML('beforeend', balon(m)); k.scrollTop = k.scrollHeight
}
async function mesajGonder(id, input) {
  const metin = input.value.trim(); if (!metin) return
  input.value = ''
  const { data, error } = await supabase.from('mesajlar').insert({
    gorusme_id: id, mesaj: metin, gonderen_id: benim.id, gonderen_tipi: gonderenTipi(benim.rol),
  }).select('id, gorusme_id, mesaj, gonderen_id, gonderen_tipi, created_at').single()
  if (error) { alert('Gönderilemedi: ' + error.message); input.value = metin; return }
  mesajEkle(id, data)
}
function realtimeKur() {
  if (sohbetKanali) return
  sohbetKanali = supabase.channel('stok-sohbet-' + ref)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mesajlar' },
      p => { if (notIdSet.has(p.new.gorusme_id)) mesajEkle(p.new.gorusme_id, p.new) })
    .subscribe()
}
