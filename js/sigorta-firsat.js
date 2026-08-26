// =====================================================================
// sigorta-firsat.js — Sigorta Fırsatları (kanban) + Ön Kayıt eşleştirme
//   Kolonlar: Teklif Bekliyor → Teklif Verildi → Kazanıldı / Kaybedildi.
//   Kart aksiyonlarıyla aşama geçişi. Kaybedildi'de neden zorunlu.
//   Ön kayıt: sigorta keser → bilgi işlem (master) DMS'e girip eşleştirir.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtTarih, fmtPara, danismanMap, waHref } from './veri.js'
import { mat, avatar } from './stitch-ui.js'

let benim = null
let master = false
const S = { liste: [], onkayit: [], emailAd: {}, danismanF: '' }

const KOLONLAR = [
  ['TEKLIF_BEKLIYOR', 'Teklif Bekliyor', 'priority_high', 'text-amber-600'],
  ['TEKLIF_VERILDI', 'Teklif Verildi', 'schedule', 'text-tertiary'],
  ['KAZANILDI', 'Kazanıldı', 'check_circle', 'text-secondary'],
  ['KAYBEDILDI', 'Kaybedildi', 'cancel', 'text-error'],
]
const KAYIP = ['Başka acenteden yaptırdı', 'Fiyat yüksek', 'Finans kuruluşuna satış', 'Sigorta kredi içinde', 'Müşteri vazgeçti', 'Ulaşılamadı', 'Diğer']

export async function firsatKur(danisman) {
  benim = danisman
  master = danisman.master_admin === true
  const dm = await danismanMap()
  Object.values(dm).forEach(d => { if (d.email) S.emailAd[d.email] = d.ad_soyad })
  if (master || danisman.rol === 'yonetici') {
    const sel = document.getElementById('frDanismanF')
    sel.classList.remove('hidden')
    sel.innerHTML = '<option value="">Tüm Danışmanlar</option>' + Object.entries(S.emailAd).map(([e, a]) => `<option value="${kacis(e)}">${kacis(a)}</option>`).join('')
    sel.addEventListener('change', () => { S.danismanF = sel.value; kanbanCiz() })
  }
  document.getElementById('frYeni').addEventListener('click', () => yeniFirsatModal())
  await yukle()
}

async function yukle() {
  const [f, o] = await Promise.all([
    // ⚠️ Okuma GÖRÜNÜMDEN (sql/182): poliçe için gereken TCKN · doğum tarihi ·
    //   ruhsat seri no · kasko kodu fırsat satırında TUTULMAZ, siparişten CANLI
    //   okunur. Böylece sipariş düzeltilince sigorta eski bilgiyle poliçe kesmez.
    //   YAZMA yine `sigorta_firsatlari` tablosuna (aşağıdaki update'ler).
    supabase.from('v_sigorta_firsat_detay').select('*').order('created_at', { ascending: false }).limit(500),
    master ? supabase.from('sigorta_on_kayitlari').select('*').eq('durum', 'DMS_BEKLIYOR').order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
  ])
  S.liste = f.data || []
  S.onkayit = o.data || []
  kpiCiz(); onKayitCiz(); kanbanCiz()
}

function kpiCiz() {
  const buAy = new Date().toISOString().slice(0, 7)
  const ayFirsat = S.liste.filter(f => (f.created_at || '').slice(0, 7) === buAy).length
  const kaz = S.liste.filter(f => f.durum === 'KAZANILDI').length
  const kay = S.liste.filter(f => f.durum === 'KAYBEDILDI').length
  const donusum = (kaz + kay) ? Math.round(kaz / (kaz + kay) * 100) : 0
  const bekleyen = S.liste.filter(f => f.durum === 'TEKLIF_BEKLIYOR').length
  const acik = S.liste.filter(f => f.durum === 'TEKLIF_BEKLIYOR' || f.durum === 'TEKLIF_VERILDI').length
  const kart = (ik, l, v, renk) => `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg kart-hover">
    <div class="flex items-center gap-2 text-on-surface-variant text-label-md">${mat(ik, renk + ' text-[20px]')} ${l}</div>
    <div class="text-headline-lg text-on-surface mt-1">${v}</div></div>`
  document.getElementById('frKpi').innerHTML =
    kart('add_task', 'Bu Ay Fırsat', ayFirsat, 'text-primary') +
    kart('trending_up', 'Dönüşüm', '%' + donusum, 'text-secondary') +
    kart('priority_high', 'Teklif Bekleyen', bekleyen, 'text-amber-600') +
    kart('pending_actions', 'Açık Fırsat', acik, 'text-tertiary')
  document.getElementById('frOzet').textContent = `${S.liste.length} fırsat · %${donusum} dönüşüm · ${bekleyen} teklif bekliyor`
}

function filtreli() {
  return S.liste.filter(f => !S.danismanF || f.talep_eden === S.danismanF)
}

function kanbanCiz() {
  const kok = document.getElementById('frKanban')
  const rows = filtreli()
  kok.innerHTML = KOLONLAR.map(([kod, l, ik, renk]) => {
    const kartlar = rows.filter(f => f.durum === kod)
    return `<div class="bg-surface-container-low/50 rounded-2xl border border-outline-variant p-3 min-h-[120px]">
      <div class="flex items-center justify-between mb-3 px-1">
        <div class="flex items-center gap-2 font-bold text-on-surface">${mat(ik, renk + ' text-[20px]')} ${l}</div>
        <span class="text-[11px] font-bold bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full">${kartlar.length}</span>
      </div>
      <div class="space-y-2">${kartlar.map(f => kartCiz(f)).join('') || `<div class="text-center text-on-surface-variant text-label-md py-6">—</div>`}</div>
    </div>`
  }).join('')
  kok.querySelectorAll('[data-aksiyon]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation(); aksiyon(el.dataset.id, el.dataset.aksiyon)
  }))
}

function kartCiz(f) {
  const dan = S.emailAd[f.talep_eden] || f.talep_eden || '—'
  const bekle = beklemeMetni(f)
  const aksiyonlar = []
  // ⚠️ 18 Ağu 2026 — "Teklif Ver" KALDIRILDI, yerine "Poliçe Kes" geldi.
  //    Eski düğme hiçbir veri istemeden durumu TEKLIF_VERILDI yapıyordu;
  //    panoda %0 dönüşüm görünmesinin sebebi buydu (Göksenil bildirdi).
  //    Yeni düğme poliçe formunu ÖN-DOLU açar; poliçe kaydedilince fırsat
  //    KAZANILDI'ya DB tetikleyicisiyle geçer (sql/217) ve danışmana
  //    bildirim gider. Durum artık elle değil, GERÇEK İŞLE değişiyor.
  if (f.durum === 'TEKLIF_BEKLIYOR' || f.durum === 'TEKLIF_VERILDI')
    aksiyonlar.push(['POLICE', 'Poliçe Kes', 'bg-primary text-on-primary'])
  // TEKLIF_VERILDI = teklif verdik ama müşteri KENDİ sigortacısına gitti
  // (Göksenil, 18 Ağu 2026). Kazanma yolu poliçe formundan geçer.
  if (f.durum === 'TEKLIF_BEKLIYOR' || f.durum === 'TEKLIF_VERILDI')
    aksiyonlar.push(['TEKLIF', f.durum === 'TEKLIF_VERILDI' ? 'Teklifi Düzelt' : 'Teklif Verdim',
      'bg-surface border border-outline-variant text-on-surface-variant'])
  // Müşteri kendi sigortacısına yaptırdı → MUAF. Aldığı fiyat SORULMAZ:
  // saklamayacağımız bir veriyi istemek boşuna iş (Göksenil, 18 Ağu 2026).
  if (f.durum === 'TEKLIF_VERILDI')
    aksiyonlar.push(['MUAF', 'Müşteri Kendi Yaptırdı', 'bg-surface border border-outline-variant text-on-surface-variant'])
  if (f.durum === 'KAZANILDI' || f.durum === 'KAYBEDILDI') aksiyonlar.push(['GERI', 'Geri Al', 'bg-surface border border-outline-variant text-on-surface-variant'])
  return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-3 custom-shadow">
    <div class="flex items-start justify-between gap-2">
      <div class="font-bold text-on-surface font-mono">${kacis(f.plaka || '—')}</div>
      ${f.otomatik_mi ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 flex items-center gap-0.5">${mat('bolt', 'text-[13px]')} Sistem</span>` : ''}
    </div>
    ${musteriAdiHtml(f)}
    ${policeBilgiHtml(f)}
    ${teklifHtml(f)}
    ${f.not_metni ? `<div class="text-[12px] text-on-surface-variant mt-1 line-clamp-2">${kacis(f.not_metni)}</div>` : ''}
    ${f.durum === 'KAYBEDILDI' && f.kayip_nedeni ? `<div class="text-[11px] text-error mt-1">${kacis(f.kayip_nedeni)}</div>` : ''}
    <div class="flex items-center justify-between mt-2 pt-2 border-t border-outline-variant">
      <div class="flex items-center gap-1.5 min-w-0">${avatar(dan, 'w-6 h-6 text-[10px]')}<span class="text-[11px] text-on-surface-variant truncate">${kacis(dan)}</span></div>
      <span class="text-[11px] ${bekle.acil ? 'text-error font-bold' : 'text-on-surface-variant'}">${bekle.metin}</span>
    </div>
    ${aksiyonlar.length ? `<div class="flex gap-1.5 mt-2">${aksiyonlar.map(([a, l, c]) => `<button data-id="${f.id}" data-aksiyon="${a}" class="flex-1 ${c} rounded-lg py-1.5 text-[12px] font-bold hover:opacity-90">${l}</button>`).join('')}</div>` : ''}
  </div>`
}

// Müşteri adı — CRM kütüğüne bağlıysa Müşteri 360°'a link (Göksenil,
// 10 Ağu 2026: "customer 360'ı buraya bağlayalım"). Bağlı değilse düz metin;
// eski/elle açılmış kayıtlarda crm_musteri_id boş olabiliyor.
function musteriAdiHtml(f) {
  const ad = f.musteri_ad_soyad || f.musteri_adi
  if (!ad) return ''
  const g = `<span class="text-body-md">${kacis(ad)}</span>`
  return f.crm_musteri_id
    ? `<a href="musteri-360.html?id=${encodeURIComponent(f.crm_musteri_id)}" class="block mt-0.5 text-primary font-bold hover:underline flex items-center gap-1">${g}${mat('hub', 'text-[14px] opacity-70')}</a>`
    : `<div class="text-body-md text-on-surface mt-0.5">${kacis(ad)}</div>`
}

// Poliçe kesmek için gereken alanlar (Göksenil, 10 Ağu 2026): TCKN · doğum
// tarihi · plaka · ruhsat seri no · kasko kodu. Sipariş dosyasından gelen
// fırsatlarda bunlar görünümden CANLI okunur (sql/182).
//
// ⚠️ EKSİK OLANI GİZLEME, SÖYLE. Sigorta birimi eksik veriyle poliçe kesemez;
//   boş bırakılırsa personel dosyayı açıp niye kesemediğini arıyor. Aynı sınıf
//   hata bu projede üç kez yaşandı (doğru davranış + yanıltıcı/eksik metin).
function policeBilgiHtml(f) {
  if (!f.siparis_id) return ''      // sigorta ekranından elle açılan eski kayıt
  const satir = (etiket, deger) => deger
    ? `<span class="text-[11px] text-on-surface-variant"><b class="text-on-surface">${etiket}:</b> ${kacis(String(deger))}</span>`
    : `<span class="text-[11px] text-[#92400E] bg-[#FEF3C7] px-1 rounded">${etiket} yok</span>`
  return `<div class="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 pt-1.5 border-t border-outline-variant/60">
    ${satir('TC', f.musteri_tckn)}
    ${satir('Doğum', f.musteri_dogum_tarihi ? fmtKisa(f.musteri_dogum_tarihi) : null)}
    ${satir('Ruhsat', f.arac_ruhsat_seri_no)}
    ${satir('Kasko kodu', f.arac_kasko_kodu)}
  </div>`
}

function beklemeMetni(f) {
  const ref = f.durum === 'TEKLIF_BEKLIYOR' ? f.created_at : (f.teklif_verildi_at || f.sonuclandi_at || f.created_at)
  if (!ref) return { metin: '', acil: false }
  const saat = Math.floor((Date.now() - new Date(ref).getTime()) / 3600000)
  if (f.durum === 'KAZANILDI' || f.durum === 'KAYBEDILDI') return { metin: fmtKisa(ref), acil: false }
  if (saat < 1) return { metin: 'Az önce', acil: false }
  if (saat < 24) return { metin: saat + ' saat', acil: saat >= 12 && f.durum === 'TEKLIF_BEKLIYOR' }
  return { metin: Math.floor(saat / 24) + ' gün', acil: f.durum === 'TEKLIF_BEKLIYOR' }
}
const fmtKisa = ts => new Date(ts).toLocaleDateString('tr-TR')

async function aksiyon(id, hedef) {
  const f = S.liste.find(x => x.id === id); if (!f) return
  // Poliçe formuna ön-dolu git. Durum BURADA değişmez — poliçe gerçekten
  // kaydedilince DB tetikleyicisi (sql/217) KAZANILDI yapar.
  if (hedef === 'POLICE') { location.href = 'sigorta-police.html?firsat=' + encodeURIComponent(id); return }
  if (hedef === 'TEKLIF') { teklifModal(f); return }
  if (hedef === 'MUAF') { musteriKendiYapti(f); return }
  if (hedef === 'KAYBEDILDI') { kayipModal(f); return }
  const yama = { durum: hedef, updated_at: new Date().toISOString() }
  if (hedef === 'TEKLIF_VERILDI') yama.teklif_verildi_at = new Date().toISOString()
  else if (hedef === 'KAZANILDI') { yama.sonuclandi_at = new Date().toISOString(); yama.kayip_nedeni = null }
  else if (hedef === 'GERI') {
    yama.durum = f.teklif_verildi_at ? 'TEKLIF_VERILDI' : 'TEKLIF_BEKLIYOR'; yama.sonuclandi_at = null; yama.kayip_nedeni = null
  }
  const { error } = await supabase.from('sigorta_firsatlari').update(yama).eq('id', id)
  if (error) { console.error('firsat aksiyon', error); alert('Güncellenemedi: ' + error.message); return }
  await yukle()
}

// Teklif rakamları kartta görünür: danışman panoyu açtığında ne teklif
// edildiğini görmeli — bildirimde de aynı rakamlar gidiyor (BK-63).
function teklifHtml(f) {
  if (f.teklif_pesin == null && f.teklif_taksitli == null) return ''
  const par = []
  if (f.teklif_pesin != null) par.push(`Peşin <b>${fmtPara(f.teklif_pesin)}</b>`)
  if (f.teklif_taksitli != null) par.push(`${f.teklif_taksit_ay || 12} ay <b>${fmtPara(f.teklif_taksitli)}</b>`)
  return `<div class="mt-1.5 px-2 py-1 rounded-lg bg-primary-fixed/40 text-[12px] text-on-surface">${par.join(' · ')}</div>`
}

// ⚠️ Durumu ELLE yamalamaz — RPC (sql/219) fiyatı yazar, danışmana
//    bildirim gönderir ve yetkiyi sunucuda denetler.
function teklifModal(f) {
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-center justify-center px-4'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-sm" onclick="event.stopPropagation()">
    <div class="px-lg py-4 border-b border-outline-variant"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat('request_quote', 'text-[22px]')} Teklif Ver</h3></div>
    <div class="p-lg space-y-3">
      <p class="text-body-md text-on-surface-variant"><b>${kacis(f.plaka || '')}</b> için verdiğiniz fiyatlar. Kaydedince danışmana bildirim gider ve sipariş dosyasında görünür.</p>
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Peşin ₺</label>
        <input id="tkPesin" type="number" step="0.01" value="${f.teklif_pesin ?? ''}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      <div class="grid grid-cols-3 gap-2">
        <div class="col-span-2"><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Taksitli Toplam ₺</label>
          <input id="tkTaksit" type="number" step="0.01" value="${f.teklif_taksitli ?? ''}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
        <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Ay</label>
          <input id="tkAy" type="number" value="${f.teklif_taksit_ay || 12}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>
      </div>
      <div id="tkUyari" class="text-[12px] text-error min-h-[16px]"></div>
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg">
      <button id="tkVazgec" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="tkKaydet" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90">Kaydet</button></div>
  </div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat)
  ov.querySelector('#tkVazgec').addEventListener('click', kapat)
  ov.querySelector('#tkKaydet').addEventListener('click', async () => {
    const pesin = Number(ov.querySelector('#tkPesin').value) || 0
    const taksit = Number(ov.querySelector('#tkTaksit').value) || 0
    const ay = Number(ov.querySelector('#tkAy').value) || 12
    if (pesin <= 0 && taksit <= 0) { ov.querySelector('#tkUyari').textContent = 'En az bir fiyat girin.'; return }
    const btn = ov.querySelector('#tkKaydet'); btn.disabled = true; btn.textContent = 'Kaydediliyor\u2026'
    const { data, error } = await supabase.rpc('sigorta_teklif_ver',
      { p_firsat: f.id, p_pesin: pesin, p_taksitli: taksit, p_ay: ay })
    if (error) {                                   // §5.4 sessiz catch yok
      console.error('[sigorta] teklif ver', error)
      ov.querySelector('#tkUyari').textContent = 'Kaydedilemedi: ' + error.message
      btn.disabled = false; btn.textContent = 'Kaydet'; return
    }
    if (!data?.ok) {
      ov.querySelector('#tkUyari').textContent = data?.hata || 'Kaydedilemedi.'
      btn.disabled = false; btn.textContent = 'Kaydet'; return
    }
    kapat(); await yukle()
  })
  ov.querySelector('#tkPesin').focus()
}

async function musteriKendiYapti(f) {
  if (!confirm(`${f.plaka || ''} — müşteri sigortayı kendi sigortacısına yaptırdı olarak kapatılsın mı?\n\nBizim teklifimiz kayıtta kalır; müşterinin başka yerden aldığı fiyat SORULMAZ.`)) return
  const { data, error } = await supabase.rpc('sigorta_musteri_kendi', { p_firsat: f.id, p_not: null })
  if (error) { console.error('[sigorta] musteri kendi', error); alert('Kapatılamadı: ' + error.message); return }
  if (!data?.ok) { alert(data?.hata || 'Kapatılamadı.'); return }
  await yukle()
}

function kayipModal(f) {
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-center justify-center px-4'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-sm" onclick="event.stopPropagation()">
    <div class="px-lg py-4 border-b border-outline-variant"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat('cancel', 'text-[22px]')} Kaybedildi</h3></div>
    <div class="p-lg space-y-3">
      <p class="text-body-md text-on-surface-variant"><b>${kacis(f.plaka || '')}</b> fırsatı neden kaybedildi?</p>
      <select id="kyNeden" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md">${KAYIP.map(n => `<option>${n}</option>`).join('')}</select>
      <input id="kyNot" placeholder="Ek açıklama (isteğe bağlı)" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md" />
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg"><button id="kyVaz" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="kyKaydet" class="bg-error text-on-error px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90">Kaybedildi İşaretle</button></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat); ov.querySelector('#kyVaz').addEventListener('click', kapat)
  ov.querySelector('#kyKaydet').addEventListener('click', async () => {
    const neden = ov.querySelector('#kyNeden').value
    const not = ov.querySelector('#kyNot').value.trim()
    const { error } = await supabase.from('sigorta_firsatlari').update({ durum: 'KAYBEDILDI', kayip_nedeni: neden + (not ? ' — ' + not : ''), sonuclandi_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', f.id)
    if (error) { alert('Hata: ' + error.message); return }
    kapat(); await yukle()
  })
}

function yeniFirsatModal() {
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[10vh] px-4'
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-md" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-lg py-4 border-b border-outline-variant"><h3 class="text-title-lg text-primary flex items-center gap-2">${mat('add_circle', 'text-[22px]')} Yeni Fırsat</h3>
      <button id="yfKapat" class="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">${mat('close')}</button></div>
    <div class="p-lg space-y-3">
      ${alan('yfPlaka', 'Araç Plakası', 'Örn. 34 ABC 123')}
      ${alan('yfMusteri', 'Müşteri Adı')}
      <div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Araç / Not</label><textarea id="yfNot" rows="2" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" placeholder="Marka/model, müşteri talebi…"></textarea></div>
    </div>
    <div class="flex justify-end gap-2 px-lg pb-lg"><button id="yfVaz" class="px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant hover:bg-surface-container">Vazgeç</button>
      <button id="yfKaydet" class="bg-primary text-on-primary px-5 py-2.5 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('save', 'text-[18px]')} Oluştur</button></div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.addEventListener('click', kapat); ov.querySelector('#yfKapat').addEventListener('click', kapat); ov.querySelector('#yfVaz').addEventListener('click', kapat)
  ov.querySelector('#yfKaydet').addEventListener('click', async () => {
    const plaka = ov.querySelector('#yfPlaka').value.trim().toLocaleUpperCase('tr')
    if (!plaka) { alert('Plaka zorunlu.'); return }
    const { error } = await supabase.from('sigorta_firsatlari').insert({
      plaka, musteri_adi: ov.querySelector('#yfMusteri').value.trim() || null,
      not_metni: ov.querySelector('#yfNot').value.trim() || null, talep_eden: benim.email, durum: 'TEKLIF_BEKLIYOR',
    })
    if (error) { console.error(error); alert('Kaydedilemedi: ' + error.message); return }
    kapat(); await yukle()
  })
}
const alan = (id, l, ph = '') => `<div><label class="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">${l}</label><input id="${id}" placeholder="${ph}" class="w-full bg-surface border border-outline-variant rounded-lg px-3 py-2.5 text-body-md outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary" /></div>`

// --------------------------------------------------------- Ön kayıtlar (master)
function onKayitCiz() {
  const kok = document.getElementById('frOnKayit')
  if (!master) return
  kok.classList.remove('hidden')
  kok.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl border border-outline-variant custom-shadow p-lg">
    <h3 class="text-title-lg text-primary flex items-center gap-2 mb-1">${mat('inventory_2', 'text-[22px]')} Bekleyen Ön Kayıtlar <span class="text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">${S.onkayit.length}</span></h3>
    <p class="text-label-md text-on-surface-variant mb-3">Sigorta biriminin açtığı, DMS'e girilip eşleştirilmeyi bekleyen araçlar.</p>
    ${S.onkayit.length ? `<div class="space-y-2">${S.onkayit.map(o => `<div class="flex items-center justify-between gap-3 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5">
      <div><span class="font-bold font-mono text-on-surface">${kacis(o.plaka)}</span> <span class="text-on-surface-variant">${kacis(o.marka_model || '')}</span><div class="text-[11px] text-on-surface-variant">${fmtTarih(o.created_at)}</div></div>
      <button data-esles="${o.id}" data-plaka="${kacis(o.plaka)}" class="bg-primary text-on-primary px-3 py-2 rounded-lg text-label-md font-bold hover:opacity-90 flex items-center gap-1.5">${mat('link', 'text-[16px]')} Eşleştir</button>
    </div>`).join('')}</div>` : `<p class="text-on-surface-variant text-body-md">Bekleyen ön kayıt yok.</p>`}
  </div>`
  kok.querySelectorAll('[data-esles]').forEach(el => el.addEventListener('click', () => onKayitEslestir(el.dataset.esles, el.dataset.plaka)))
}

async function onKayitEslestir(id, plaka) {
  if (!confirm(`${plaka} plakalı araç DMS'e girildi ve eşleştirilecek. Onaylıyor musunuz?`)) return
  // Aracı bul/oluştur
  let aracId = null
  const { data } = await supabase.from('sigorta_araclari').select('id').eq('plaka', plaka).eq('aktif', true).limit(1)
  if (data && data.length) aracId = data[0].id
  else {
    const { data: yeni } = await supabase.from('sigorta_araclari').insert({ plaka, kaynak: 'CRM_STOK' }).select('id').single()
    aracId = yeni?.id
  }
  const { error } = await supabase.from('sigorta_on_kayitlari').update({ durum: 'ESLESTIRILDI', eslesen_arac_id: aracId, eslestiren: benim.email, eslestirme_at: new Date().toISOString() }).eq('id', id)
  if (error) { alert('Hata: ' + error.message); return }
  await yukle()
}
