// =====================================================================
// komisyon-fatura.js — Banka Komisyon Faturaları (FAZ 1: düz liste)
//
// İŞ AKIŞI (Bahadır'ın anlatımı 5 Ağu 2026 · Göksenil kararı 21 Ağu 2026):
//   Bankalar kullandırdığımız kredi kadar bize komisyon öder. Faturayı BİZİM
//   MUHASEBE keser; kredi müdürü Can bu listeye işler; Bahadır kendi finans
//   modülünden ödemenin gelip gelmediğini işaretler; Can sonucu burada görür.
//   Ödeme gelmemişse ("Ödenmedi") Can bankadan ister.
//
// ⚠️ KARARI BU EKRAN VERMEZ. "Ödendi / Ödenmedi" yalnız köprüden gelir
//   (komisyon-fatura-karar ucu). Sunucuda `komisyon_fatura_guard` trigger'ı
//   kredi tarafının durum alanlarını yazmasını ENGELLER — RLS satır
//   düzeyindedir, kolon koruyamaz; kapı orada (sql/239).
// ⚠️ FAZ 1: "kullandırılan kredi adedi" ELLE girilir. Sistem hesaplayamıyor
//   çünkü kullandırım kayıtlarında banka bağı eksik (ölçüm: banka_kod 9/24,
//   kredi_kullandirim'da 0/2). Faz 2'de bağ düzeltilip komisyon oranı tanımı
//   açılınca "beklenen vs faturalanan" farkı buraya eklenecek.
// ⚠️ BANKA: liste `kredi_bankalari`'ndan gelir ama o tablo ÜRÜN listesidir
//   (AKTIF / AKTIF_TASIT / AKTIF_TICARI ayrı satır; ALJ iki kez). Komisyon
//   BANKADAN gelir → seçenekler banka ADINA göre tekilleştirilir, kod da
//   saklanır ama tek gerçek `banka_ad`.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, fmtTarihKisa, dbHata, danismanMap, danismanAdi } from './veri.js'
import { mat, uyari, bosDurum, binlikInputKur } from './stitch-ui.js'

let benim = null, DMAP = {}, SATIRLAR = [], BANKALAR = []
let suzgec = 'HEPSI'

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

const DURUM_ETIKET = {
  BEKLIYOR: ['Ödeme bekliyor', 'bg-amber-100 text-amber-900 border-amber-300', 'schedule'],
  ODENDI:   ['Ödendi', 'bg-secondary-container text-on-secondary-container border-secondary/40', 'check_circle'],
  ODENMEDI: ['Ödenmedi — bankadan iste', 'bg-error-container text-on-error-container border-error/40', 'error'],
  IPTAL:    ['İptal', 'bg-surface-container text-on-surface-variant border-outline-variant', 'block'],
}

const INP = 'w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white focus:border-primary focus:ring-1 focus:ring-primary'
const LBL = 'block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1'

export async function komisyonFaturaKur(danisman) {
  benim = danisman
  DMAP = await danismanMap()
  binlikInputKur()
  await yukle()
}

async function yukle() {
  const kok = document.getElementById('kok')
  kok.innerHTML = `<div class="py-24 text-center text-on-surface-variant">Faturalar yükleniyor…</div>`
  const [fR, bR] = await Promise.all([
    supabase.from('banka_komisyon_faturalari')
      .select('id, banka_kod, banka_ad, donem_yil, donem_ay, tutar, fatura_no, fatura_tarihi, kullandirim_adedi, not_metni, durum, odeme_tarihi, karar_veren, karar_notu, karar_zamani, kaydeden, created_at')
      .order('donem_yil', { ascending: false }).order('donem_ay', { ascending: false }),
    supabase.from('kredi_bankalari').select('kod, ad').eq('aktif', true).order('ad'),
  ])
  if (fR.error) { dbHata('komisyon faturalari', fR.error); kok.innerHTML = uyari('Faturalar okunamadı: ' + kacis(fR.error.message)); return }
  if (bR.error) dbHata('kredi_bankalari', bR.error)
  SATIRLAR = fR.data || []
  // Ürün varyantlarını banka ADINA göre tekilleştir (bkz. başlık notu).
  const gorulen = new Set()
  BANKALAR = (bR.data || []).filter(b => {
    const ad = (b.ad || '').trim()
    if (!ad || gorulen.has(ad)) return false
    gorulen.add(ad); return true
  })
  ciz()
}

function kpiHtml() {
  const canli = SATIRLAR.filter(s => s.durum !== 'IPTAL')
  const say = d => canli.filter(s => s.durum === d).length
  const top = d => canli.filter(s => s.durum === d).reduce((a, s) => a + Number(s.tutar || 0), 0)
  const kart = (etiket, deger, alt, cls) => `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 custom-shadow border-l-4 ${cls}">
      <p class="text-label-sm uppercase tracking-wider text-on-surface-variant font-medium">${etiket}</p>
      <p class="text-2xl font-bold text-on-surface mt-1">${deger}</p>
      <p class="text-label-sm text-on-surface-variant">${alt}</p>
    </div>`
  return `<div class="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 mb-5">
    ${kart('Ödeme Bekleyen', fmtPara(top('BEKLIYOR')), say('BEKLIYOR') + ' fatura', 'border-l-amber-400')}
    ${kart('Ödendi', fmtPara(top('ODENDI')), say('ODENDI') + ' fatura', 'border-l-secondary')}
    ${kart('Ödenmedi', fmtPara(top('ODENMEDI')), say('ODENMEDI') + ' fatura · bankadan istenecek', 'border-l-error')}
    ${kart('Toplam Faturalanan', fmtPara(canli.reduce((a, s) => a + Number(s.tutar || 0), 0)), canli.length + ' fatura', 'border-l-primary')}
  </div>`
}

function suzgecHtml() {
  const dugme = (kod, etiket) => `<button data-suz="${kod}" class="px-3 py-1.5 rounded-lg text-label-md font-bold border transition-all ${
    suzgec === kod ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'}">${kacis(etiket)}</button>`
  return `<div class="flex flex-wrap gap-2 mb-4">
    ${dugme('HEPSI', 'Hepsi')}${dugme('BEKLIYOR', 'Ödeme bekleyen')}${dugme('ODENMEDI', 'Ödenmedi')}${dugme('ODENDI', 'Ödendi')}${dugme('IPTAL', 'İptal')}
  </div>`
}

function satirHtml(s) {
  const [etiket, cls, ikon] = DURUM_ETIKET[s.durum] || DURUM_ETIKET.BEKLIYOR
  const donem = `${AYLAR[(s.donem_ay || 1) - 1]} ${s.donem_yil}`
  // Karar verilmiş fatura kredi tarafından DEĞİŞTİRİLEMEZ (sunucu kapısı,
  // sql/239). Düğmeleri de gizliyoruz ki "bastım olmadı" yaşanmasın.
  const kilit = s.durum !== 'BEKLIYOR'
  return `<tr class="border-b border-outline-variant/60 hover:bg-surface-container-low/60">
    <td class="px-3 py-2.5">
      <div class="font-bold text-on-surface">${kacis(s.banka_ad)}</div>
      <div class="text-label-sm text-on-surface-variant">${kacis(donem)}${s.fatura_no ? ' · ' + kacis(s.fatura_no) : ''}</div>
    </td>
    <td class="px-3 py-2.5 text-right font-bold whitespace-nowrap">${fmtPara(s.tutar)}</td>
    <td class="px-3 py-2.5 text-center text-on-surface-variant hidden sm:table-cell">${s.kullandirim_adedi ?? '—'}</td>
    <td class="px-3 py-2.5 hidden md:table-cell text-label-sm text-on-surface-variant whitespace-nowrap">${s.fatura_tarihi ? fmtTarihKisa(s.fatura_tarihi) : '—'}</td>
    <td class="px-3 py-2.5">
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${cls}">
        ${mat(ikon, 'text-[14px]')} ${kacis(etiket)}</span>
      ${s.durum === 'ODENDI' && s.odeme_tarihi ? `<div class="text-[11px] text-on-surface-variant mt-0.5">${fmtTarihKisa(s.odeme_tarihi)}${s.karar_veren ? ' · ' + kacis(s.karar_veren) : ''}</div>` : ''}
      ${s.karar_notu ? `<div class="text-[11px] text-on-surface-variant mt-0.5 truncate max-w-[220px]" title="${kacis(s.karar_notu)}">${kacis(s.karar_notu)}</div>` : ''}
    </td>
    <td class="px-3 py-2.5 text-right whitespace-nowrap">
      ${kilit ? `<span class="text-[11px] text-on-surface-variant">${s.durum === 'IPTAL' ? '—' : 'finans karar verdi'}</span>`
        : `<button data-duzenle="${s.id}" class="text-[11px] font-bold text-primary hover:underline">Düzelt</button>
           <button data-iptal="${s.id}" class="ml-2 text-[11px] font-bold text-on-surface-variant hover:text-error hover:underline">İptal</button>`}
    </td>
  </tr>`
}

function ciz() {
  const liste = suzgec === 'HEPSI' ? SATIRLAR.filter(s => s.durum !== 'IPTAL') : SATIRLAR.filter(s => s.durum === suzgec)
  const kok = document.getElementById('kok')
  kok.innerHTML = `
    <div class="flex items-start justify-between gap-3 flex-wrap mb-4">
      <div>
        <h2 class="text-headline-sm text-on-surface font-bold">Banka Komisyon Faturaları</h2>
        <p class="text-body-md text-on-surface-variant mt-1">Muhasebenin bankalara kestiği komisyon faturaları. Finans birimi ödemeyi gördükçe işaretler.</p>
      </div>
      <button id="kfEkle" class="bg-primary text-on-primary font-bold px-4 h-11 rounded-lg text-label-md flex items-center gap-1.5 hover:opacity-90">
        ${mat('add', 'text-[18px]')} Komisyon Faturası Ekle</button>
    </div>
    ${kpiHtml()}
    ${suzgecHtml()}
    ${liste.length ? `<div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead><tr class="border-b border-outline-variant bg-surface-container-low/60 text-label-sm text-on-surface-variant">
          <th class="px-3 py-2 text-left font-bold">Banka / Dönem</th>
          <th class="px-3 py-2 text-right font-bold">Tutar</th>
          <th class="px-3 py-2 text-center font-bold hidden sm:table-cell">Kredi adedi</th>
          <th class="px-3 py-2 text-left font-bold hidden md:table-cell">Fatura tarihi</th>
          <th class="px-3 py-2 text-left font-bold">Durum</th>
          <th class="px-3 py-2 text-right font-bold"></th>
        </tr></thead>
        <tbody>${liste.map(satirHtml).join('')}</tbody>
      </table></div>`
      : bosDurum(suzgec === 'HEPSI' ? 'Henüz komisyon faturası girilmemiş. "Komisyon Faturası Ekle" ile başlayın.' : 'Bu süzgeçte fatura yok.', 'receipt_long')}
    <p class="text-label-sm text-on-surface-variant mt-4 flex items-start gap-1.5">
      ${mat('info', 'text-[16px] shrink-0 mt-0.5')}
      <span>"Ödendi / Ödenmedi" kararını finans birimi kendi modülünden verir; bu ekrandan değiştirilemez.
      Kredi adedi şimdilik elle girilir — kullandırım kayıtlarındaki banka bağı tamamlanınca sistem hesaplayacak.</span></p>`
  bagla()
}

function bagla() {
  document.getElementById('kfEkle')?.addEventListener('click', () => pencereAc(null))
  document.querySelectorAll('[data-suz]').forEach(b =>
    b.addEventListener('click', () => { suzgec = b.dataset.suz; ciz() }))
  document.querySelectorAll('[data-duzenle]').forEach(b =>
    b.addEventListener('click', () => pencereAc(SATIRLAR.find(s => s.id === b.dataset.duzenle))))
  document.querySelectorAll('[data-iptal]').forEach(b =>
    b.addEventListener('click', () => iptalEt(b.dataset.iptal)))
}

async function iptalEt(id) {
  const s = SATIRLAR.find(x => x.id === id); if (!s) return
  if (!confirm(`${s.banka_ad} · ${fmtPara(s.tutar)} faturası iptal edilsin mi?\n\nKayıt silinmez, "İptal" olarak işaretlenir ve finans listesinden düşer.`)) return
  const { data, error } = await supabase.from('banka_komisyon_faturalari')
    .update({ durum: 'IPTAL' }).eq('id', id).select('id')
  if (error) { dbHata('fatura iptal', error); alert('İptal edilemedi: ' + error.message); return }
  if (!data?.length) { alert('İptal edilemedi — yetkin yok (0 satır).'); return }   // §5.1
  await yukle()
}

// ---------- Ekle / Düzelt penceresi ----------
function pencereAc(mevcut) {
  const bugun = new Date()
  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4'
  const yilSec = mevcut?.donem_yil ?? bugun.getFullYear()
  const aySec = mevcut?.donem_ay ?? (bugun.getMonth() + 1)
  const bankaSec = mevcut?.banka_ad || ''
  // Kayıtlı banka listede yoksa (ad değişmiş olabilir) seçenek olarak eklenir,
  // yoksa düzeltme penceresi bankayı sessizce boşaltırdı.
  const adlar = BANKALAR.map(b => b.ad)
  if (bankaSec && !adlar.includes(bankaSec)) adlar.unshift(bankaSec)
  ov.innerHTML = `<div class="bg-surface-container-lowest rounded-2xl w-full max-w-md custom-shadow overflow-hidden max-h-[92vh] flex flex-col" role="dialog" aria-modal="true">
    <div class="px-lg py-3 border-b border-outline-variant flex items-center justify-between shrink-0">
      <h3 class="text-title-md text-primary flex items-center gap-2">${mat('receipt_long', 'text-[20px]')} ${mevcut ? 'Faturayı Düzelt' : 'Komisyon Faturası Ekle'}</h3>
      <button class="kfKapat w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center">${mat('close')}</button>
    </div>
    <div class="p-lg space-y-3 overflow-y-auto">
      <div><label class="${LBL}" for="kfBanka">Banka</label>
        <select id="kfBanka" class="${INP}">
          <option value="">Banka seçin…</option>
          ${adlar.map(a => `<option value="${kacis(a)}" ${a === bankaSec ? 'selected' : ''}>${kacis(a)}</option>`).join('')}
        </select></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="${LBL}" for="kfYil">Yıl</label>
          <input id="kfYil" type="text" inputmode="numeric" value="${yilSec}" class="${INP}"></div>
        <div><label class="${LBL}" for="kfAy">Ay</label>
          <select id="kfAy" class="${INP}">
            ${AYLAR.map((a, i) => `<option value="${i + 1}" ${i + 1 === aySec ? 'selected' : ''}>${a}</option>`).join('')}
          </select></div>
      </div>
      <div><label class="${LBL}" for="kfTutar">Fatura tutarı (₺)</label>
        <input id="kfTutar" type="text" inputmode="numeric" placeholder="0" value="${mevcut?.tutar != null ? Math.round(Number(mevcut.tutar)).toLocaleString('tr-TR') : ''}" class="${INP} para-gir font-bold text-primary"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="${LBL}" for="kfNo">Fatura no</label>
          <input id="kfNo" type="text" value="${kacis(mevcut?.fatura_no || '')}" class="${INP}"></div>
        <div><label class="${LBL}" for="kfTarih">Fatura tarihi</label>
          <input id="kfTarih" type="date" value="${mevcut?.fatura_tarihi || ''}" class="${INP}"></div>
      </div>
      <div><label class="${LBL}" for="kfAdet">Kullandırılan kredi adedi (isteğe bağlı)</label>
        <input id="kfAdet" type="text" inputmode="numeric" placeholder="—" value="${mevcut?.kullandirim_adedi ?? ''}" class="${INP}">
        <p class="text-[11px] text-on-surface-variant mt-1">Şimdilik elle. Kullandırım kayıtlarındaki banka bağı tamamlanınca sistem dolduracak.</p></div>
      <div><label class="${LBL}" for="kfNot">Not (isteğe bağlı)</label>
        <textarea id="kfNot" rows="2" class="${INP}">${kacis(mevcut?.not_metni || '')}</textarea></div>
      <div id="kfUyari" class="text-[12px] text-error"></div>
    </div>
    <div class="px-lg py-3 border-t border-outline-variant flex gap-2 shrink-0">
      <button class="kfKapat flex-1 border border-outline-variant px-4 h-11 rounded-lg text-label-md font-bold">Vazgeç</button>
      <button id="kfKaydet" class="flex-1 bg-primary text-on-primary px-4 h-11 rounded-lg text-label-md font-bold flex items-center justify-center gap-1">${mat('save', 'text-[18px]')} Kaydet</button>
    </div></div>`
  document.body.appendChild(ov)
  const kapat = () => ov.remove()
  ov.querySelectorAll('.kfKapat').forEach(b => b.addEventListener('click', kapat))
  ov.addEventListener('click', e => { if (e.target === ov) kapat() })

  const sayi = v => { const t = String(v || '').replace(/[^\d]/g, ''); return t ? Number(t) : null }

  ov.querySelector('#kfKaydet').addEventListener('click', async () => {
    const uy = ov.querySelector('#kfUyari'); uy.textContent = ''
    const bankaAd = ov.querySelector('#kfBanka').value
    const yil = sayi(ov.querySelector('#kfYil').value)
    const ay = Number(ov.querySelector('#kfAy').value)
    const tutar = sayi(ov.querySelector('#kfTutar').value)
    if (!bankaAd) { uy.textContent = 'Banka seçin.'; return }
    if (!yil || yil < 2020 || yil > 2100) { uy.textContent = 'Yıl geçersiz.'; return }
    if (!tutar) { uy.textContent = 'Fatura tutarı zorunlu.'; return }

    // banka_kod yalnız BİLGİ amaçlı: aynı adlı ilk kayıt. Tek gerçek banka_ad
    // (kredi_bankalari ürün listesi olduğu için kod tekil değil).
    const kod = BANKALAR.find(b => b.ad === bankaAd)?.kod || null
    const gov = {
      banka_kod: kod, banka_ad: bankaAd, donem_yil: yil, donem_ay: ay, tutar,
      fatura_no: ov.querySelector('#kfNo').value.trim() || null,
      fatura_tarihi: ov.querySelector('#kfTarih').value || null,
      kullandirim_adedi: sayi(ov.querySelector('#kfAdet').value),
      not_metni: ov.querySelector('#kfNot').value.trim() || null,
    }
    const btn = ov.querySelector('#kfKaydet'); btn.disabled = true; btn.textContent = 'Kaydediliyor…'
    let hata = null, yazildi = false
    if (mevcut) {
      const { data, error } = await supabase.from('banka_komisyon_faturalari')
        .update(gov).eq('id', mevcut.id).select('id')
      hata = error; yazildi = !!data?.length
    } else {
      const { data, error } = await supabase.from('banka_komisyon_faturalari')
        .insert({ ...gov, kaydeden: benim?.id || null }).select('id')
      hata = error; yazildi = !!data?.length
    }
    btn.disabled = false; btn.textContent = 'Kaydet'
    if (hata) {
      dbHata('komisyon faturasi kaydet', hata)
      // Kısmi unique indeks: aynı bankada aynı fatura no.
      uy.textContent = /duplicate key|ux_komisyon_fatura_no/i.test(hata.message)
        ? 'Bu bankada aynı fatura numarası zaten kayıtlı.'
        : 'Kaydedilemedi: ' + hata.message
      return
    }
    if (!yazildi) { uy.textContent = 'Kaydedilemedi — yetkin yok (0 satır).'; return }   // §5.1
    kapat(); await yukle()
  })
}
