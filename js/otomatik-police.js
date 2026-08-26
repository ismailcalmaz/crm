// =====================================================================
// otomatik-police.js — Sigorta şirketi dosyalarından toplu poliçe kaydı
//   Sürükle-bırak → oku (police-dosya.js) → ÖNİZLE → onayla → aktar
//   (police_ice_aktar RPC, sql/220).
//
//   ⚠️ ÖNİZLEME ATLANMAZ. Dosya okunur okunmaz yazmıyoruz: kullanıcı
//      şirket + acente seçmeden ve satırları görmeden aktarım başlamaz.
//      Göksenil'in şartı: "sisteme işlemeden önce kullanıcının onayına
//      sunacak, veriler doğru mu kontrol et diye".
//
//   ⚠️ Dosya SUNUCUYA ÇIKMIYOR. Ayrıştırma tarayıcıda yapılıyor, RPC'ye
//      yalnız normalleşmiş satırlar gidiyor. Müşteri verisi taşıyan ham
//      dosya hiçbir yere yüklenmiyor.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtPara, fmtTarih, dbHata } from './veri.js'
import { mat } from './stitch-ui.js'
import { dosyaOku } from './police-dosya.js'

let benim = null
const cache = { sirketler: [] }
// Okunan ama henüz aktarılmamış dosyalar
const S = { kuyruk: [], calisiyor: false }

// Dosya adından şirket tahmini — kullanıcı yine de onaylıyor, bu sadece
// varsayılanı doğru getirip tıklama azaltmak için.
const AD_IPUCU = [
  [/hepiyi/i, 'HEPIYI'], [/sompo/i, 'SOMPO'], [/neova/i, 'NEOVA'],
  [/quick/i, 'QUICK'], [/turkiye|türkiye/i, 'TURKIYE'], [/zurich/i, null],
]

// =====================================================================
export async function otomatikPoliceKur(danisman) {
  benim = danisman
  await sirketleriYukle()
  dropKur()
  await eksikleriYukle()
  await gecmisiYukle()
}

async function sirketleriYukle() {
  const { data, error } = await supabase.from('sigorta_sirketleri')
    .select('id, ad, kisa_kod, ana_sirket_id').eq('aktif', true).order('ad')
  if (error) { dbHata('sigorta_sirketleri', error); return }
  cache.sirketler = data || []
}

function dropKur() {
  const drop = document.getElementById('opDrop')
  const inp = document.getElementById('opDosya')
  drop.addEventListener('click', () => inp.click())
  drop.addEventListener('dragover', e => {
    e.preventDefault(); drop.classList.add('border-primary', 'bg-primary/5')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('border-primary', 'bg-primary/5'))
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('border-primary', 'bg-primary/5')
    dosyalariAl([...(e.dataTransfer?.files || [])])
  })
  inp.addEventListener('change', e => { dosyalariAl([...e.target.files]); e.target.value = '' })
}

// =====================================================================
// OKUMA
// =====================================================================
async function dosyalariAl(dosyalar) {
  if (!dosyalar.length) return
  const durum = document.getElementById('opDurum')
  durum.classList.remove('hidden')

  for (const f of dosyalar) {
    durum.innerHTML = yukleniyorHtml(f.name)
    try {
      const t0 = performance.now()
      const r = await dosyaOku(f)
      const ms = Math.round(performance.now() - t0)
      console.debug('[AKTARIM] okundu', f.name, r.bicim, r.satirlar.length, ms + 'ms')
      if (!r.satirlar.length) throw new Error('Dosyada aktarılacak poliçe satırı bulunamadı')
      S.kuyruk.push({ id: crypto.randomUUID(), dosya: f.name, ms, ...r, sirketId: sirketTahmin(f.name, r), acente: 'ISMAIL_CALMAZ_OTOMOTIV' })
    } catch (err) {
      console.error('[AKTARIM] okuma hatasi', f.name, err)
      durum.innerHTML = hataHtml(f.name, err.message)
      return
    }
  }
  durum.classList.add('hidden')
  onizlemeCiz()
}

function sirketTahmin(dosyaAdi, r) {
  for (const [re, kod] of AD_IPUCU) {
    if (re.test(dosyaAdi) && kod) {
      const s = cache.sirketler.find(x => x.kisa_kod === kod)
      if (s) return s.id
    }
  }
  return ''
}

const yukleniyorHtml = ad => `
  <div class="bg-surface-container-low rounded-xl px-4 py-4 flex items-center gap-3">
    <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
    <div><div class="text-title-sm text-on-surface">${kacis(ad)} okunuyor…</div>
      <div class="text-body-sm text-on-surface-variant">Dosya bilgisayarınızda çözümleniyor, sunucuya gönderilmiyor.</div></div>
  </div>`

const hataHtml = (ad, mesaj) => `
  <div class="bg-error-container text-on-error-container rounded-xl px-4 py-4 flex items-start gap-3">
    ${mat('error', 'text-[22px]')}
    <div><div class="text-title-sm">${kacis(ad)} okunamadı</div>
      <div class="text-body-sm mt-0.5">${kacis(mesaj)}</div></div>
  </div>`

// =====================================================================
// ÖNİZLEME
// =====================================================================
function onizlemeCiz() {
  const k = document.getElementById('opOnizleme')
  if (!S.kuyruk.length) { k.classList.add('hidden'); k.innerHTML = ''; return }
  k.classList.remove('hidden')
  k.innerHTML = S.kuyruk.map(kartHtml).join('')

  S.kuyruk.forEach(d => {
    const kok = k.querySelector(`[data-d="${d.id}"]`)
    if (!kok) return
    kok.querySelector('.opSirket')?.addEventListener('change', e => { d.sirketId = e.target.value; dugmeDurumu(d) })
    kok.querySelector('.opAcente')?.addEventListener('change', e => { d.acente = e.target.value })
    kok.querySelector('.opVazgec')?.addEventListener('click', () => {
      S.kuyruk = S.kuyruk.filter(x => x.id !== d.id); onizlemeCiz()
    })
    kok.querySelector('.opAktar')?.addEventListener('click', () => aktar(d))
    dugmeDurumu(d)
  })
}

function dugmeDurumu(d) {
  const b = document.querySelector(`[data-d="${d.id}"] .opAktar`)
  if (!b) return
  const hazir = !!d.sirketId && !S.calisiyor
  b.disabled = !hazir
  b.classList.toggle('opacity-40', !hazir)
  b.classList.toggle('cursor-not-allowed', !hazir)
}

function kartHtml(d) {
  const ilk10 = d.satirlar.slice(0, 10)
  const bd = {}
  d.satirlar.forEach(s => { const t = s.tur_kod || s.tur_ad || '—'; bd[t] = (bd[t] || 0) + 1 })

  return `
  <div data-d="${d.id}" class="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden">

    <div class="px-4 py-3 border-b border-outline-variant flex flex-wrap items-center gap-3">
      ${mat('description', 'text-primary')}
      <div class="min-w-0">
        <div class="text-title-md text-on-surface truncate">${kacis(d.dosya)}</div>
        <div class="text-body-sm text-on-surface-variant">${kacis(d.bicimAd)} · ${d.ms} ms</div>
      </div>
      <button class="opVazgec ml-auto text-label-md text-on-surface-variant hover:text-error flex items-center gap-1">
        ${mat('close', 'text-[18px]')} Vazgeç</button>
    </div>

    <!-- özet -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-px bg-outline-variant">
      ${kutu('Poliçe satırı', d.istatistik.gecerli, `${d.istatistik.okunan} okundu`)}
      ${kutu('Toplam brüt', fmtPara(d.istatistik.brut))}
      ${kutu('Toplam komisyon', fmtPara(d.istatistik.komisyon))}
      ${kutu('Branşlar', Object.entries(bd).map(([a, n]) => `${a} ${n}`).join(' · '))}
    </div>

    ${d.uyarilar.length ? `
    <div class="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-outline-variant space-y-1">
      ${d.uyarilar.map(u => `<div class="text-body-sm text-amber-800 dark:text-amber-200 flex items-start gap-1.5">
        ${mat('info', 'text-[16px] mt-0.5')}<span>${kacis(u)}</span></div>`).join('')}
    </div>` : ''}

    <!-- şirket + acente seçimi -->
    <div class="px-4 py-3 flex flex-col md:flex-row md:items-end gap-3 border-b border-outline-variant">
      <label class="flex-1">
        <span class="text-label-sm text-on-surface-variant">Sigorta şirketi <b class="text-error">*</b></span>
        <select class="opSirket w-full mt-1 bg-surface border border-outline-variant rounded-lg px-3 py-2 text-body-md">
          <option value="">— seçiniz —</option>
          ${cache.sirketler.map(s => `<option value="${s.id}" ${s.id === d.sirketId ? 'selected' : ''}>${kacis(s.ad)}</option>`).join('')}
        </select>
      </label>
      <label class="flex-1">
        <span class="text-label-sm text-on-surface-variant">Acente</span>
        <select class="opAcente w-full mt-1 bg-surface border border-outline-variant rounded-lg px-3 py-2 text-body-md">
          <option value="ISMAIL_CALMAZ_OTOMOTIV">İsmail Çalmaz Otomotiv</option>
          <option value="SIGORTAN_SENINLE">Sigortan Seninle</option>
        </select>
      </label>
      <button class="opAktar bg-primary text-on-primary px-4 h-10 rounded-lg text-label-md font-bold
                     flex items-center gap-1.5 hover:opacity-90 shadow-sm shadow-primary/20 whitespace-nowrap">
        ${mat('save', 'text-[20px]')} ${d.istatistik.gecerli} satırı aktar
      </button>
    </div>

    <!-- ilk satırlar -->
    <div class="overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead class="bg-surface-container-low text-on-surface-variant">
          <tr class="text-left">
            <th class="px-3 py-2 font-bold">Poliçe No</th><th class="px-3 py-2 font-bold">Zeyl</th>
            <th class="px-3 py-2 font-bold">Branş</th><th class="px-3 py-2 font-bold">Müşteri</th>
            <th class="px-3 py-2 font-bold">Plaka</th><th class="px-3 py-2 font-bold">Başlangıç</th>
            <th class="px-3 py-2 font-bold">Bitiş</th>
            <th class="px-3 py-2 font-bold text-right">Brüt</th>
            <th class="px-3 py-2 font-bold text-right">Komisyon</th>
          </tr>
        </thead>
        <tbody>${ilk10.map(satirHtml).join('')}</tbody>
      </table>
    </div>
    ${d.satirlar.length > 10 ? `<div class="px-4 py-2 text-body-sm text-on-surface-variant bg-surface-container-low">
      … ve ${d.satirlar.length - 10} satır daha</div>` : ''}
  </div>`
}

const kutu = (et, deger, alt = '') => `
  <div class="bg-surface-container-lowest px-4 py-3">
    <div class="text-[10px] uppercase tracking-wide text-on-surface-variant">${et}</div>
    <div class="text-title-sm text-on-surface font-bold break-words">${kacis(String(deger))}</div>
    ${alt ? `<div class="text-[10px] text-on-surface-variant">${kacis(alt)}</div>` : ''}
  </div>`

function satirHtml(s) {
  const iptal = (s.brut || 0) < 0
  return `<tr class="border-t border-outline-variant ${iptal ? 'bg-error-container/30' : ''}">
    <td class="px-3 py-2 font-mono text-[12px]">${kacis(s.police_no)}</td>
    <td class="px-3 py-2">${s.zeyl_no || 0}</td>
    <td class="px-3 py-2">${kacis(s.tur_kod || s.tur_ad || '—')}</td>
    <td class="px-3 py-2 truncate max-w-[180px]">${kacis(s.musteri_ad || '—')}</td>
    <td class="px-3 py-2 font-mono text-[12px]">${kacis(s.plaka || '—')}</td>
    <td class="px-3 py-2">${kacis(s.baslangic || '—')}</td>
    <td class="px-3 py-2">${kacis(s.bitis || '—')}</td>
    <td class="px-3 py-2 text-right ${iptal ? 'text-error font-bold' : ''}">${fmtPara(s.brut)}</td>
    <td class="px-3 py-2 text-right">${fmtPara(s.komisyon_tutari)}</td>
  </tr>`
}

// =====================================================================
// AKTARIM
// =====================================================================
async function aktar(d) {
  if (!d.sirketId || S.calisiyor) return
  S.calisiyor = true
  S.kuyruk.forEach(dugmeDurumu)

  const durum = document.getElementById('opDurum')
  durum.classList.remove('hidden')
  durum.innerHTML = `
    <div class="bg-surface-container-low rounded-xl px-4 py-4 flex items-center gap-3">
      <span class="material-symbols-outlined text-primary animate-spin">progress_activity</span>
      <div><div class="text-title-sm text-on-surface">${kacis(d.dosya)} aktarılıyor…</div>
        <div class="text-body-sm text-on-surface-variant">${d.istatistik.gecerli} satır · sunucuda tek işlemde yazılıyor</div></div>
    </div>`

  // ⚠️ Satırlardan yalnız RPC'nin beklediği alanlar gider.
  const yuk = d.satirlar.map(s => ({
    police_no: s.police_no, zeyl_no: s.zeyl_no, tur_kod: s.tur_kod, tur_ad: s.tur_ad,
    vergi_profil: s.vergi_profil, durum: s.durum || null,
    baslangic: s.baslangic, bitis: s.bitis,
    brut: s.brut, net: s.net,
    gider_vergisi: s.gider_vergisi, thgf: s.thgf, guvence_hesabi: s.guvence_hesabi,
    komisyon_tutari: s.komisyon_tutari,
    plaka: s.plaka, marka: s.marka, versiyon: s.versiyon, model_yili: s.model_yili,
    sasi_no: s.sasi_no, motor_no: s.motor_no,
    musteri_ad: s.musteri_ad, tc_kimlik: s.tc_kimlik, vergi_no: s.vergi_no,
    dogum_tarihi: s.dogum_tarihi, telefon: s.telefon, eposta: s.eposta, adres: s.adres,
  }))

  const { data, error } = await supabase.rpc('police_ice_aktar', {
    p_dosya: d.dosya, p_bicim: d.bicim, p_sirket_id: d.sirketId,
    p_acente: d.acente, p_satirlar: yuk,
  })

  S.calisiyor = false
  if (error) {
    console.error('[AKTARIM] rpc hatasi', error)     // §5.4 — sessiz catch yok
    durum.innerHTML = hataHtml(d.dosya, error.message || 'Aktarım başarısız')
    S.kuyruk.forEach(dugmeDurumu)
    return
  }
  console.debug('[AKTARIM] sonuc', data)
  durum.innerHTML = sonucHtml(d, data)
  S.kuyruk = S.kuyruk.filter(x => x.id !== d.id)
  onizlemeCiz()
  await eksikleriYukle()   // aktarım eksik satır ürettiyse hemen görünsün
  await gecmisiYukle()
}

function sonucHtml(d, r) {
  const ayrinti = (r.ayrinti || []).slice(0, 30)
  const basarili = (r.hatali || 0) === 0
  return `
  <div class="${basarili ? 'bg-secondary-container text-on-secondary-container' : 'bg-amber-50 dark:bg-amber-950/30'} rounded-xl px-4 py-4 space-y-2">
    <div class="flex items-center gap-2 text-title-sm">
      ${mat(basarili ? 'task_alt' : 'warning', 'text-[22px]')} ${kacis(d.dosya)} aktarıldı
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-body-md">
      <span><b>${r.yeni}</b> yeni poliçe</span>
      ${r.atlanan_mevcut ? `<span><b>${r.atlanan_mevcut}</b> zaten kayıtlıydı, atlandı</span>` : ''}
      ${r.atlanan_bos ? `<span><b>${r.atlanan_bos}</b> boş satır</span>` : ''}
      ${r.yeni_tur ? `<span><b>${r.yeni_tur}</b> yeni branş açıldı</span>` : ''}
      ${r.hatali ? `<span class="text-error font-bold">${r.hatali} satır hata verdi</span>` : ''}
    </div>
    ${ayrinti.length ? `<details class="text-body-sm">
      <summary class="cursor-pointer font-bold">Ayrıntı (${(r.ayrinti || []).length})</summary>
      <div class="mt-1 space-y-0.5">${ayrinti.map(a =>
        `<div>satır ${a.satir} · ${kacis(a.tip)} · ${kacis(a.mesaj || '')}${a.police_no ? ' · ' + kacis(a.police_no) : ''}</div>`).join('')}</div>
    </details>` : ''}
  </div>`
}

// =====================================================================
// GEÇMİŞ
// =====================================================================
async function gecmisiYukle() {
  const k = document.getElementById('opGecmis')
  const { data, error } = await supabase.from('police_ice_aktarimlar')
    .select('id, dosya_adi, bicim, toplam_satir, yeni, atlanan_mevcut, hatali, yeni_tur, kullanici, created_at, sigorta_sirketleri(ad)')
    .order('created_at', { ascending: false }).limit(20)
  if (error) { dbHata('police_ice_aktarimlar', error); return }
  if (!data?.length) {
    k.innerHTML = `<div class="text-body-md text-on-surface-variant text-center py-6">Henüz dosya aktarımı yapılmamış.</div>`
    return
  }
  k.innerHTML = `
    <h3 class="text-title-lg text-primary flex items-center gap-2 mb-3">${mat('history', 'text-[22px]')} Geçmiş Aktarımlar</h3>
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead class="bg-surface-container-low text-on-surface-variant"><tr class="text-left">
          <th class="px-3 py-2 font-bold">Tarih</th><th class="px-3 py-2 font-bold">Dosya</th>
          <th class="px-3 py-2 font-bold">Şirket</th>
          <th class="px-3 py-2 font-bold text-right">Yeni</th>
          <th class="px-3 py-2 font-bold text-right">Atlanan</th>
          <th class="px-3 py-2 font-bold text-right">Hata</th>
          <th class="px-3 py-2 font-bold">Kullanıcı</th>
        </tr></thead>
        <tbody>${data.map(r => `<tr class="border-t border-outline-variant">
          <td class="px-3 py-2 whitespace-nowrap">${fmtTarih(r.created_at)}</td>
          <td class="px-3 py-2 truncate max-w-[220px]">${kacis(r.dosya_adi)}</td>
          <td class="px-3 py-2">${kacis(r.sigorta_sirketleri?.ad || '—')}</td>
          <td class="px-3 py-2 text-right font-bold">${r.yeni}</td>
          <td class="px-3 py-2 text-right">${r.atlanan_mevcut}</td>
          <td class="px-3 py-2 text-right ${r.hatali ? 'text-error font-bold' : ''}">${r.hatali}</td>
          <td class="px-3 py-2 truncate max-w-[180px]">${kacis(r.kullanici || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`
}

// =====================================================================
// EKSİK BİLGİ — maskeli/boş kimlik no ve plakasız araç poliçeleri
// =====================================================================
// ⚠️ NEDEN VAR: sompo dosyasında TC kimlik MASKELİ geliyor (`2*********0`),
//    Pusula'da 191 satırın 150'sinde kimlik no hiç yok. Bu satırlar
//    aktarılıyor ama müşteri yalnız ada göre eşleşiyor. Göksenil kararı
//    (19 Ağu 2026): kalem ikonuyla düzeltilebilsin.
//
// ⚠️ YETKİ: düzeltmeyi YALNIZ sigorta yetkilisi (ve master) yapar. Kalem
//    yalnız ona görünür; asıl kapı sunucuda `sigorta_aktarim_duzelt()`
//    içinde — arayüzde düğme gizlemek tek başına yetki değildir.
let EKSIK = []
const yetkiliMi = () => benim?.rol === 'sigorta_yetkili' || benim?.master_admin === true
const eksikRozet = t => `<span class="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">${t}</span>`

async function eksikleriYukle() {
  const k = document.getElementById('opEksik')
  if (!k) return
  const { data, error } = await supabase.from('v_aktarim_eksikler')
    .select('police_id, police_no, zeyl_no, tur_kod, tur_ad, sirket_ad, dosya_adi, musteri_id, ad_soyad, tc_kimlik, vergi_no, telefon, eposta, dogum_tarihi, arac_id, plaka, marka, versiyon, model_yili, sasi_no, motor_no, kimlik_eksik, plaka_eksik')
    .order('aktarim_at', { ascending: false }).limit(500)
  if (error) { dbHata('v_aktarim_eksikler', error); return }
  EKSIK = data || []
  if (!EKSIK.length) { k.innerHTML = ''; return }

  const kimlik = EKSIK.filter(r => r.kimlik_eksik).length
  const plaka = EKSIK.filter(r => r.plaka_eksik).length

  k.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <h3 class="text-title-lg text-primary flex items-center gap-2">
        ${mat('edit_note', 'text-[22px]')} Eksik Bilgi
        <span class="text-[11px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full">${EKSIK.length}</span>
      </h3>
      <span class="text-body-sm text-on-surface-variant">
        ${kimlik ? kimlik + ' kimlik no' : ''}${kimlik && plaka ? ' · ' : ''}${plaka ? plaka + ' plaka' : ''}
      </span>
      ${yetkiliMi() ? '' : `<span class="ml-auto text-body-sm text-on-surface-variant flex items-center gap-1">
        ${mat('lock', 'text-[16px]')} Düzeltmeyi sigorta yetkilisi yapar</span>`}
    </div>
    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead class="bg-surface-container-low text-on-surface-variant"><tr class="text-left">
          <th class="px-3 py-2 font-bold">Poliçe No</th><th class="px-3 py-2 font-bold">Branş</th>
          <th class="px-3 py-2 font-bold">Müşteri</th><th class="px-3 py-2 font-bold">Kimlik No</th>
          <th class="px-3 py-2 font-bold">Plaka</th><th class="px-3 py-2 font-bold">Dosya</th>
          <th class="px-3 py-2 w-10"></th>
        </tr></thead>
        <tbody>${EKSIK.map(eksikSatirHtml).join('')}</tbody>
      </table>
    </div>`

  k.querySelectorAll('.opKalem').forEach(b =>
    b.addEventListener('click', () => duzeltAc(b.dataset.p)))
}

function eksikSatirHtml(r) {
  return `<tr class="border-t border-outline-variant">
    <td class="px-3 py-2 font-mono text-[12px]">${kacis(r.police_no)}${r.zeyl_no ? `<span class="text-on-surface-variant"> /${r.zeyl_no}</span>` : ''}</td>
    <td class="px-3 py-2">${kacis(r.tur_kod || r.tur_ad || '—')}</td>
    <td class="px-3 py-2 truncate max-w-[200px]">${kacis(r.ad_soyad || '—')}</td>
    <td class="px-3 py-2">${r.tc_kimlik || r.vergi_no ? kacis(r.tc_kimlik || r.vergi_no) : eksikRozet('eksik')}</td>
    <td class="px-3 py-2 font-mono text-[12px]">${r.plaka ? kacis(r.plaka) : (r.plaka_eksik ? eksikRozet('eksik') : '—')}</td>
    <td class="px-3 py-2 truncate max-w-[160px] text-on-surface-variant">${kacis(r.dosya_adi || '—')}</td>
    <td class="px-3 py-2 text-right">
      ${yetkiliMi()
        ? `<button class="opKalem text-primary hover:bg-primary/10 rounded-lg p-1.5" data-p="${r.police_id}" title="Düzelt">
             ${mat('edit', 'text-[18px]')}</button>`
        : `<span class="text-on-surface-variant" title="Yalnız sigorta yetkilisi düzeltebilir">${mat('lock', 'text-[16px]')}</span>`}
    </td>
  </tr>`
}

// ---------------------------------------------------------------------
// Düzeltme penceresi
// ---------------------------------------------------------------------
const alan = (id, etiket, deger, tip = 'text', ipucu = '', ek = '') => `
  <label class="block">
    <span class="text-label-sm text-on-surface-variant">${etiket}</span>
    <input id="dz_${id}" type="${tip}" ${ek} placeholder="${ipucu}"
      data-ilk="${deger == null ? '' : kacis(String(deger))}"
      value="${deger == null ? '' : kacis(String(deger))}"
      class="w-full mt-1 bg-surface border border-outline-variant rounded-lg px-3 py-2 text-body-md" />
  </label>`

function duzeltAc(policeId) {
  const r = EKSIK.find(x => x.police_id === policeId)
  if (!r) return

  const ov = document.createElement('div')
  ov.className = 'fixed inset-0 bg-black/40 z-[80] flex items-start justify-center pt-[8vh] px-4 overflow-y-auto'
  ov.innerHTML = `
  <div data-govde class="bg-surface-container-lowest rounded-2xl custom-shadow w-full max-w-2xl overflow-hidden mb-8">
    <div class="px-4 py-3 border-b border-outline-variant flex items-center gap-2">
      ${mat('edit', 'text-primary')}
      <div class="min-w-0">
        <div class="text-title-md text-on-surface">Eksik bilgiyi düzelt</div>
        <div class="text-body-sm text-on-surface-variant truncate">
          ${kacis(r.police_no)}${r.zeyl_no ? ' / ' + r.zeyl_no : ''} · ${kacis(r.tur_kod || r.tur_ad || '')} · ${kacis(r.sirket_ad || '')}
        </div>
      </div>
      <button class="dzKapat ml-auto text-on-surface-variant hover:text-error">${mat('close')}</button>
    </div>

    <div class="p-4 space-y-4 max-h-[62vh] overflow-y-auto">
      <div>
        <div class="text-label-md font-bold text-primary mb-2 flex items-center gap-1.5">${mat('person', 'text-[18px]')} Müşteri</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${alan('m_ad_soyad', 'Ad Soyad / Ünvan', r.ad_soyad)}
          ${alan('m_tc_kimlik', 'TC Kimlik No', r.tc_kimlik, 'text', '11 hane', 'inputmode="numeric" maxlength="11"')}
          ${alan('m_vergi_no', 'Vergi No', r.vergi_no, 'text', '10 hane', 'inputmode="numeric" maxlength="10"')}
          ${alan('m_telefon', 'Telefon', r.telefon)}
          ${alan('m_eposta', 'E-posta', r.eposta, 'email')}
          ${alan('m_dogum_tarihi', 'Doğum Tarihi', r.dogum_tarihi, 'date')}
        </div>
      </div>
      <div>
        <div class="text-label-md font-bold text-primary mb-2 flex items-center gap-1.5">${mat('directions_car', 'text-[18px]')} Araç</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${alan('a_plaka', 'Plaka', r.plaka, 'text', '35 ABC 123')}
          ${alan('a_marka', 'Marka', r.marka)}
          ${alan('a_versiyon', 'Tip / Versiyon', r.versiyon)}
          ${alan('a_model_yili', 'Model Yılı', r.model_yili, 'number')}
          ${alan('a_sasi_no', 'Şasi No', r.sasi_no)}
          ${alan('a_motor_no', 'Motor No', r.motor_no)}
        </div>
      </div>
      <p class="text-body-sm text-on-surface-variant flex items-start gap-1.5">
        ${mat('info', 'text-[16px] mt-0.5')}
        <span>Dokunmadığınız alan olduğu gibi kalır. Girdiğiniz TC kimlik no başka bir müşteride
        kayıtlıysa poliçe o müşteriye bağlanır ve bunu size bildiririm.</span>
      </p>
      <div id="dzHata" class="hidden bg-error-container text-on-error-container rounded-lg px-3 py-2 text-body-sm"></div>
    </div>

    <div class="px-4 py-3 border-t border-outline-variant flex items-center gap-2">
      <button class="dzKapat text-label-md text-on-surface-variant px-3 h-10">Vazgeç</button>
      <button class="dzKaydet ml-auto bg-primary text-on-primary px-4 h-10 rounded-lg text-label-md font-bold
                     flex items-center gap-1.5 hover:opacity-90 shadow-sm shadow-primary/20">
        ${mat('save', 'text-[20px]')} Kaydet</button>
    </div>
  </div>`

  document.body.appendChild(ov)
  const kapat = () => { ov.remove(); document.removeEventListener('keydown', esc) }
  const esc = e => { if (e.key === 'Escape') kapat() }
  document.addEventListener('keydown', esc)
  ov.addEventListener('click', e => { if (!e.target.closest('[data-govde]')) kapat() })
  ov.querySelectorAll('.dzKapat').forEach(b => b.addEventListener('click', kapat))
  ov.querySelector('.dzKaydet').addEventListener('click', () => duzeltKaydet(r, ov, kapat))
}

async function duzeltKaydet(r, ov, kapat) {
  const btn = ov.querySelector('.dzKaydet')
  const hata = ov.querySelector('#dzHata')
  hata.classList.add('hidden')
  btn.disabled = true; btn.classList.add('opacity-50')

  // ⚠️ YALNIZ DEĞİŞEN alanlar gönderilir. Hepsini göndersek formda boş duran
  //    bir alan sunucuda mevcut değeri SİLERDİ — RPC "gönderildi mi" diye
  //    jsonb `?` operatörüyle bakıyor (sql/221).
  const topla = onek => {
    const o = {}
    ov.querySelectorAll(`input[id^="dz_${onek}_"]`).forEach(i => {
      const yeni = i.value.trim(), ilk = (i.dataset.ilk || '').trim()
      if (yeni !== ilk) o[i.id.slice(`dz_${onek}_`.length)] = yeni
    })
    return o
  }
  const musteri = topla('m'), arac = topla('a')
  if (!Object.keys(musteri).length && !Object.keys(arac).length) { kapat(); return }

  const { data, error } = await supabase.rpc('sigorta_aktarim_duzelt', {
    p_police_id: r.police_id, p_musteri: musteri, p_arac: arac,
  })
  if (error) {
    console.error('[AKTARIM] duzeltme hatasi', error)   // §5.4 — sessiz catch yok
    hata.textContent = error.message || 'Kaydedilemedi'
    hata.classList.remove('hidden')
    btn.disabled = false; btn.classList.remove('opacity-50')
    return
  }
  console.debug('[AKTARIM] duzeltildi', data)
  kapat()
  const d = document.getElementById('opDurum')
  d.classList.remove('hidden')
  d.innerHTML = `
    <div class="bg-secondary-container text-on-secondary-container rounded-xl px-4 py-3 flex items-start gap-2">
      ${mat('task_alt', 'text-[22px]')}
      <div><div class="text-title-sm">${kacis(r.police_no)} güncellendi</div>
        <div class="text-body-sm">${data?.birlestirildi
          ? 'Girilen kimlik no mevcut bir müşteriye aitti — poliçe o müşteriye bağlandı.'
          : 'Değişen alanlar: ' + ((data?.degisen || []).join(', ') || '—')}</div></div>
    </div>`
  await eksikleriYukle()
}
