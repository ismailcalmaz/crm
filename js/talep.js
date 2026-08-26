// =====================================================================
// talep.js — Tek talep detayı: görüşme notları, sahiplenme, durum, yönetici notu
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import { uygunAraclar } from './eslestirme.js'
import {
  DURUMLAR, KAYIP_NEDENLERI, kapanisMi, kaybedildiMi, danismanMap, danismanAdi, aracOzet, fmtButce,
  fmtPara, fmtTarih, fmtTarihKisa, durumSinifi, finansEtiket, telNo, telSon10, waHref, kacis, urlParam,
  hizliNotlar, bugunISO, dbHata,
} from './veri.js'
import { mat, uyari } from './stitch-ui.js'

let benim = null
let dmap = {}
let talepId = null
let notIdSet = new Set()   // bu talebin not id'leri (realtime filtresi için)
let sohbetKanali = null
let guncelDurum = null     // talebin en son not durumu (yeni not formu varsayılanı)
let talepAcanId = null     // talebi açan danışman (ilk notun acan_id'si) — açıklamayı o düzenler

const NOT_ALANLARI =
  'id, gorusme_notu, musteri_ad_soyad, telefon, musteri_durumu, kayip_nedeni, acan_id, sahip_danisman_id, ' +
  'yonetici_notu, yonetici_not_yazan, yonetici_not_tarih, sonraki_adim_tarihi, acilis_notu, created_at, updated_at'

// rol → mesaj gönderen tipi (mesajlar.gonderen_tipi CHECK ile birebir)
function gonderenTipi(rol) {
  return rol === 'yonetici' ? 'YÖNETİCİ' : rol === 'santral' ? 'SANTRAL' : 'DANIŞMAN'
}
function saat(ts) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

export async function talepKur(danisman) {
  benim = danisman
  dmap = await danismanMap()
  talepId = urlParam('id')

  if (!talepId || talepId === 'null') {
    document.getElementById('icerik').innerHTML =
      '<div class="uyari-kutu">Talep bulunamadı (id eksik). <a href="talepler.html">Talepler\'e dön</a></div>'
    return
  }
  document.getElementById('yeniNotBtn')?.addEventListener('click', () => {
    const kart = document.getElementById('yeniNotKart')
    kart.classList.toggle('gizli')
    // Form açılırken: durumu talebin güncel durumuna getir + çipleri çiz
    if (!kart.classList.contains('gizli')) {
      const sel = document.getElementById('yeniNotDurum')
      if (sel && guncelDurum) sel.value = guncelDurum
      ciplerCiz()
    }
  })
  const notDurumSel = document.getElementById('yeniNotDurum')
  if (notDurumSel) {
    notDurumSel.innerHTML = DURUMLAR.map(d => `<option value="${kacis(d)}">${kacis(d)}</option>`).join('')
    document.getElementById('yeniNotKayip').innerHTML = KAYIP_NEDENLERI.map(k => `<option>${kacis(k)}</option>`).join('')
    notDurumSel.addEventListener('change', () => {
      document.getElementById('yeniNotKayipAlan').style.display = kaybedildiMi(notDurumSel.value) ? '' : 'none'
      ciplerCiz()
    })
  }
  document.getElementById('yeniNotForm')?.addEventListener('submit', yeniNotEkle)
  await yukle()
  realtimeKur()
}

async function yukle() {
  const [talepRes, notRes] = await Promise.all([
    supabase.from('talepler').select('*').eq('id', talepId).single(),
    supabase.from('gorusme_notlari').select(NOT_ALANLARI).eq('talep_id', talepId)
      .order('created_at', { ascending: true }),
  ])

  if (talepRes.error) {
    document.getElementById('talepOzet').innerHTML =
      `<div class="uyari-kutu">Talep okunamadı: ${kacis(talepRes.error.message)}</div>`
    return
  }
  // Açan = en erken notun acan_id'si (created_at artan → ilk eleman)
  talepAcanId = (notRes.data && notRes.data[0]?.acan_id) || null
  talepOzetCiz(talepRes.data)
  satisKutuCiz(talepRes.data)
  finansKutuCiz(talepRes.data)
  uygunStokCiz(talepRes.data)
  mukerrerKontrol(talepRes.data)

  const kap = document.getElementById('notlar')
  if (notRes.error) { kap.innerHTML = `<div class="uyari-kutu">Notlar okunamadı: ${kacis(notRes.error.message)}</div>`; return }
  if (!notRes.data.length) { kap.innerHTML = '<div class="bos-durum">Bu talebe bağlı görüşme notu yok.</div>'; return }

  // Güncel durum = en son (created_at artan sıralı → son eleman) notun durumu
  guncelDurum = notRes.data[notRes.data.length - 1]?.musteri_durumu || null

  notIdSet = new Set(notRes.data.map(n => n.id))
  kap.innerHTML = notRes.data.map(notKarti).join('')
  notRes.data.forEach(baglaOlaylar)

  // Notlara ait sohbet mesajlarını tek sorguda çek ve dağıt
  await mesajlariYukle([...notIdSet])
}

// --- Sohbet: mesajları yükle + dağıt ---
async function mesajlariYukle(notIdler) {
  if (!notIdler.length) return
  const { data, error } = await supabase.from('mesajlar')
    .select('id, gorusme_id, mesaj, gonderen_id, gonderen_tipi, created_at')
    .in('gorusme_id', notIdler)
    .order('created_at', { ascending: true })
  if (error) { console.error('mesajlar okunamadı:', error); return }

  const grup = {}
  for (const m of data) (grup[m.gorusme_id] ||= []).push(m)
  for (const notId of notIdler) sohbetDoldur(notId, grup[notId] || [])
}

function sohbetDoldur(notId, list) {
  const kutu = document.querySelector(`[data-sohbet="${notId}"]`)
  if (!kutu) return
  kutu.innerHTML = list.length
    ? list.map(balon).join('')
    : '<div class="bos">Henüz mesaj yok. İlk mesajı yaz.</div>'
  kutu.scrollTop = kutu.scrollHeight
}

function balon(m) {
  const benimMi = m.gonderen_id === benim.id
  const ad = danismanAdi(dmap, m.gonderen_id)
  const tipCls = m.gonderen_tipi === 'YÖNETİCİ' ? 'yonetici' : m.gonderen_tipi === 'SANTRAL' ? 'santral' : 'danisman'
  return `<div class="balon ${benimMi ? 'benim' : ''}" data-mid="${m.id}">
    <div class="ad">${kacis(ad)} <span class="tip ${tipCls}">${kacis(m.gonderen_tipi)}</span></div>
    <div class="metin">${kacis(m.mesaj)}</div>
    <div class="zaman">${saat(m.created_at)}</div>
  </div>`
}

// Tek mesajı ilgili sohbete ekle (dedupe: aynı id iki kez eklenmez)
function mesajEkle(notId, m) {
  const kutu = document.querySelector(`[data-sohbet="${notId}"]`)
  if (!kutu) return
  if (kutu.querySelector(`[data-mid="${m.id}"]`)) return
  const bos = kutu.querySelector('.bos'); if (bos) bos.remove()
  kutu.insertAdjacentHTML('beforeend', balon(m))
  kutu.scrollTop = kutu.scrollHeight
}

async function mesajGonder(notId, input) {
  const metin = input.value.trim()
  if (!metin) return
  input.value = ''
  const { data, error } = await supabase.from('mesajlar').insert({
    gorusme_id: notId,
    mesaj: metin,
    gonderen_id: benim.id,
    gonderen_tipi: gonderenTipi(benim.rol),
  }).select('id, gorusme_id, mesaj, gonderen_id, gonderen_tipi, created_at').single()
  if (error) { alert('Mesaj gönderilemedi: ' + error.message); input.value = metin; return }
  mesajEkle(notId, data)   // realtime echo da gelse dedupe eder
}

// Realtime: yeni mesaj eklenince anında ekrana düşür
function realtimeKur() {
  if (sohbetKanali) return
  sohbetKanali = supabase
    .channel('talep-sohbet-' + talepId)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mesajlar' },
      payload => {
        const m = payload.new
        if (notIdSet.has(m.gorusme_id)) mesajEkle(m.gorusme_id, m)
      })
    .subscribe()
}

function talepOzetCiz(t) {
  const tel = telNo(t.telefon), wa = waHref(t.telefon)
  const bilgi = (etiket, deger) => `<div><p class="text-label-sm text-on-surface-variant uppercase tracking-wide">${etiket}</p><p class="text-body-lg font-medium text-on-surface mt-0.5">${deger || '—'}</p></div>`
  document.getElementById('talepBaslik').textContent = t.musteri_ad_soyad
  // Açıklamayı yalnızca talebi AÇAN kişi (ya da master) düzenleyebilir; diğerleri salt-okur
  const acabilir = !!benim && (benim.id === talepAcanId || benim.master_admin === true)
  const aciklamaHtml = acabilir
    ? `<div class="mt-lg">
         <p class="text-label-sm text-on-surface-variant uppercase tracking-wide">Açıklama</p>
         <textarea id="aciklamaAlan" rows="3" placeholder="Açıklama ekle…" class="w-full mt-1 border border-outline-variant rounded-lg p-2 text-body-md">${kacis(t.aciklama || '')}</textarea>
         <div class="mt-1 flex items-center gap-2">
           <button id="aciklamaKaydet" class="bg-primary text-on-primary px-4 py-1.5 rounded-lg text-label-md font-bold hover:opacity-90 transition-all">Açıklamayı Kaydet</button>
           <span id="aciklamaDurum" class="text-label-sm text-on-surface-variant"></span>
         </div>
       </div>`
    : (t.aciklama ? `<div class="mt-lg"><p class="text-label-sm text-on-surface-variant uppercase tracking-wide">Açıklama</p><p class="text-body-md text-on-surface mt-0.5 whitespace-pre-wrap">${kacis(t.aciklama)}</p></div>` : '')
  document.getElementById('talepOzet').innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-lg">
      ${bilgi('Telefon', kacis(t.telefon))}
      ${bilgi('E-posta', kacis(t.eposta))}
      ${bilgi('İstenen Araç', kacis(aracOzet(t)))}
      ${bilgi('Bütçe', kacis(fmtButce(t.butce_min, t.butce_max)))}
      ${bilgi('Kaynak', kacis(t.kaynak))}
      ${t.katilim_finans ? bilgi('Katılım Finans', 'Evet' + (t.finansman_tutari ? ' — ' + fmtPara(t.finansman_tutari) : '')) : ''}
    </div>
    ${aciklamaHtml}
    ${tel ? `<div class="mt-lg flex flex-wrap gap-2">
      <a href="tel:${tel}" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold inline-flex items-center gap-2 hover:opacity-90 transition-all">${mat('call', 'text-[18px]')} Ara</a>
      ${wa ? `<a href="${wa}" target="_blank" class="border border-secondary text-secondary px-lg py-sm rounded-lg text-label-md font-bold inline-flex items-center gap-2 hover:bg-secondary/5 transition-all">${mat('chat', 'text-[18px]', true)} WhatsApp</a>` : ''}
    </div>` : ''}
  `
  document.getElementById('aciklamaKaydet')?.addEventListener('click', aciklamaKaydet)
}

async function aciklamaKaydet() {
  const alan = document.getElementById('aciklamaAlan')
  const durum = document.getElementById('aciklamaDurum')
  const btn = document.getElementById('aciklamaKaydet')
  if (!alan) return
  btn.disabled = true; durum.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('talepler')
    .update({ aciklama: alan.value.trim() || null }).eq('id', talepId)
  btn.disabled = false
  if (error) { durum.textContent = 'Hata: ' + error.message; return }
  durum.textContent = 'Kaydedildi ✓'
  setTimeout(() => { if (durum) durum.textContent = '' }, 2500)
}

// NOT: Kredi başvurusu artık TALEP detayından yapılmıyor. Kredi birimi tek
// araç üzerinden çalıştığı için başvuru STOK ARAÇ detayından açılıyor
// (stok-arac.js → kredi_basvuru_olustur RPC → kredi_basvurulari). Buradaki
// eski "Kredi Dosyası" kutusu talepler.kredi_durumu'nu kullanıyordu ve
// gerçek kredi modülüyle bağlantısı yoktu — kaldırıldı.

// --- Satış kaydı ------------------------------------------------------
// TASARIM NOTU: Bu, talebi KAPATMAZ ve durumu DEĞİŞTİRMEZ.
// Sebep: kapanış durumları RLS ile danışmandan gizleniyor (gorusme_select).
// Yani danışman satışını "Satış Tamamlandı" yaparsa kendi kazancının kaydı
// gözünden kayboluyordu — bu yüzden kimse işaretlemiyordu (0 kayıt).
// Burada satış talepler tablosuna yazılır; talep görünür kalır, kapatma
// kararı danışmana bırakılır. Zorlama yok, hatırlatma yok.
function satisKutuCiz(t) {
  const kutu = document.getElementById('satisKutu')
  if (!kutu) return

  if (t.satis_tarihi) {
    const kim = t.satis_kaydeden ? danismanAdi(dmap, t.satis_kaydeden) : null
    kutu.innerHTML = `
      <div class="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
        <span class="material-symbols-outlined text-green-700">check_circle</span>
        <div class="flex-1">
          <p class="text-title-md text-green-900 font-bold">Satış yapıldı</p>
          <p class="text-body-md text-green-800 mt-1">
            ${kacis(fmtTarihKisa(t.satis_tarihi))}
            ${t.satis_fiyati ? ' · ' + kacis(fmtPara(t.satis_fiyati)) : ''}
            ${t.satis_stok_kodu ? ' · Stok: ' + kacis(t.satis_stok_kodu) : ''}
            ${kim ? ' · ' + kacis(kim) : ''}
          </p>
        </div>
        <button id="satisDuzelt" class="text-label-md text-green-900 underline shrink-0">Düzelt</button>
      </div>`
    document.getElementById('satisDuzelt').addEventListener('click', () => satisFormCiz(t))
    return
  }

  kutu.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <p class="text-body-md text-on-surface-variant">
        Bu müşteriye araç satıldıysa buraya işaretleyebilirsin. Talep kapanmaz, listenden kaybolmaz.
      </p>
      <button id="satisAc" class="bg-surface-container-low border border-outline-variant px-4 py-2 rounded-lg text-label-md font-bold inline-flex items-center gap-2 hover:bg-surface-container transition-colors shrink-0">
        ${mat('handshake', 'text-[18px]')} Satış Yapıldı
      </button>
    </div>`
  document.getElementById('satisAc').addEventListener('click', () => satisFormCiz(t))
}

function satisFormCiz(t) {
  const kutu = document.getElementById('satisKutu')
  kutu.innerHTML = `
    <div class="form-satir">
      <div class="alan"><label>Satış Tarihi</label>
        <input type="date" id="satTarih" value="${t.satis_tarihi ? String(t.satis_tarihi).slice(0,10) : bugunISO()}" /></div>
      <div class="alan"><label>Satış Fiyatı (₺) — opsiyonel</label>
        <input type="number" id="satFiyat" value="${t.satis_fiyati ?? ''}" placeholder="Bilmiyorsan boş bırak" /></div>
      <div class="alan"><label>DMS Stok Kodu — opsiyonel</label>
        <input type="text" id="satStok" value="${kacis(t.satis_stok_kodu || '')}" placeholder="Bilmiyorsan boş bırak" /></div>
    </div>
    <div class="aralik flex items-center gap-3 flex-wrap">
      <button id="satKaydet" class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold">Kaydet</button>
      <button id="satVazgec" class="text-label-md text-on-surface-variant underline">Vazgeç</button>
      ${t.satis_tarihi ? '<button id="satSil" class="text-label-md text-red-700 underline ml-auto">Satış kaydını kaldır</button>' : ''}
      <span id="satDurum" class="soluk"></span>
    </div>`
  document.getElementById('satVazgec').addEventListener('click', () => satisKutuCiz(t))
  document.getElementById('satKaydet').addEventListener('click', () => satisKaydet(t))
  document.getElementById('satSil')?.addEventListener('click', () => satisKaydet(t, true))
}

async function satisKaydet(t, sil = false) {
  const durum = document.getElementById('satDurum')
  const tarih = document.getElementById('satTarih').value
  if (!sil && !tarih) { durum.textContent = 'Satış tarihi gerekli.'; return }

  const yama = sil
    ? { satis_tarihi: null, satis_fiyati: null, satis_stok_kodu: null, satis_kaydeden: null }
    : {
        satis_tarihi: tarih,
        satis_fiyati: document.getElementById('satFiyat').value || null,
        satis_stok_kodu: document.getElementById('satStok').value.trim() || null,
        satis_kaydeden: benim.id,
      }

  durum.textContent = 'Kaydediliyor…'
  const { data, error } = await supabase.from('talepler').update(yama).eq('id', talepId).select('*').single()
  if (error) { dbHata('satis kaydet', error); durum.textContent = 'Hata: ' + error.message; return }
  satisKutuCiz(data)
}

function finansKutuCiz(t) {
  const kutu = document.getElementById('finansKutu')
  const acik = t.katilim_finans === true
  const et = acik && t.finansman_tarihi ? finansEtiket(t.finansman_tarihi) : null
  kutu.innerHTML = `
    <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:10px">
      <input type="checkbox" id="finChk" ${acik ? 'checked' : ''} /> Katılım Finans (Eminevim, Katılımevim vb.)
    </label>
    ${et ? `<span class="rozet ${et.sinif}" style="margin-left:10px">${kacis(et.metin)}</span>` : ''}
    <div id="finAlan" class="form-satir ${acik ? '' : 'gizli'}">
      <div class="alan"><label>Finansman Tutarı (₺)</label><input id="finTutar" type="number" value="${t.finansman_tutari ?? ''}" /></div>
      <div class="alan"><label>Finansman Tarihi</label><input id="finTarih" type="date" value="${t.finansman_tarihi ? String(t.finansman_tarihi).slice(0,10) : ''}" /></div>
    </div>
    <button id="finKaydet" class="btn btn-gold btn-kucuk">Kaydet</button>
    <span id="finDurum" class="soluk" style="margin-left:8px"></span>`

  const chk = document.getElementById('finChk')
  chk.addEventListener('change', () =>
    document.getElementById('finAlan').classList.toggle('gizli', !chk.checked))
  document.getElementById('finKaydet').addEventListener('click', () => finansKaydet())
}

async function finansKaydet() {
  const acik = document.getElementById('finChk').checked
  const tutar = document.getElementById('finTutar').value
  const tarih = document.getElementById('finTarih').value
  const durum = document.getElementById('finDurum')
  durum.textContent = 'Kaydediliyor…'
  const { error } = await supabase.from('talepler').update({
    katilim_finans: acik,
    finansman_tutari: acik && tutar ? Number(tutar) : null,
    finansman_tarihi: acik && tarih ? tarih : null,
  }).eq('id', talepId)
  if (error) { durum.className = 'durum-mesaj hata'; durum.textContent = 'Hata: ' + error.message; return }
  durum.className = 'soluk'; durum.textContent = '✓ Kaydedildi'
  await yukle()
}

// Müşteri kartı bağlantısı + aynı telefonla mükerrer kayıt uyarısı
async function mukerrerKontrol(t) {
  const link = document.getElementById('musteriKartiLink')
  if (t.telefon && link) { link.href = 'musteri.html?tel=' + encodeURIComponent(t.telefon); link.style.display = 'inline-flex' }
  const son10 = telSon10(t.telefon)
  if (!son10) return
  const { data, error } = await supabase.from('talepler').select('id').ilike('telefon_norm', '%' + son10 + '%').limit(20)
  if (error) {
    // Sessizce "kayıt yok" gösterme — kontrolün yapılamadığını belirt.
    console.error('[db] mukerrerKontrol', error)
    document.getElementById('mukerrerUyari').innerHTML = uyari('Mükerrer kayıt kontrolü yapılamadı (bağlantı hatası). Sayfayı yenileyin.')
    return
  }
  const baska = (data || []).filter(x => x.id !== t.id).length
  if (baska > 0) {
    document.getElementById('mukerrerUyari').innerHTML =
      `<div class="bg-amber-50 border border-amber-200 rounded-lg p-md flex items-center gap-3">${mat('warning', 'text-amber-600')}
        <p class="text-body-md text-amber-800">Bu müşterinin <span class="font-bold">${baska} başka kaydı</span> daha var.
        <a href="musteri.html?tel=${encodeURIComponent(t.telefon)}" class="font-bold underline">Müşteri kartında hepsini gör →</a></p></div>`
  }
}

// --- Talebe uygun stok araçları (site projesinden) ---
async function uygunStokCiz(t) {
  const kart = document.getElementById('uygunStokKart')
  const hedef = document.getElementById('uygunStok')
  const { data, error } = await siteDb.from('araclar')
    .select('id, marka, model, versiyon, yil, km, fiyat, durum, fotolar')
    .eq('durum', 'aktif').limit(500)
  if (error) return
  const uygun = uygunAraclar(t, data).slice(0, 12)
  if (!uygun.length) return
  kart.style.display = ''
  document.getElementById('uygunStokSayi').textContent = `${uygun.length} araç eşleşti`
  hedef.innerHTML = `<table class="w-full text-left zebra-table">
    <thead class="bg-primary text-white"><tr>
      <th class="px-lg py-3"></th><th class="px-lg py-3 text-label-md font-medium">Araç</th>
      <th class="px-lg py-3 text-label-md font-medium">Yıl</th><th class="px-lg py-3 text-label-md font-medium">KM</th>
      <th class="px-lg py-3 text-label-md font-medium text-right">Fiyat</th><th class="px-lg py-3"></th>
    </tr></thead>
    <tbody class="text-body-md">${uygun.map(a => {
      const foto = (a.fotolar || '').split(',')[0]?.trim()
      return `<tr class="tiklanir hover:bg-surface-container-low transition-colors cursor-pointer" data-git="stok-arac.html?ref=${encodeURIComponent(a.id)}">
        <td class="px-lg py-md"><div class="w-14 h-10 rounded overflow-hidden bg-surface-container">${foto ? `<img src="${kacis(foto)}" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none'">` : ''}</div></td>
        <td class="px-lg py-md"><span class="font-bold">${kacis([a.marka, a.model].filter(Boolean).join(' '))}</span>${a.versiyon ? `<br><span class="text-label-sm text-on-surface-variant">${kacis(a.versiyon)}</span>` : ''}</td>
        <td class="px-lg py-md">${kacis(a.yil) || '—'}</td>
        <td class="px-lg py-md">${a.km ? Number(a.km).toLocaleString('tr-TR') + ' km' : '—'}</td>
        <td class="px-lg py-md text-right text-primary font-bold">${fmtPara(a.fiyat)}</td>
        <td class="px-lg py-md text-right whitespace-nowrap">
          <a href="stok-arac.html?ref=${encodeURIComponent(a.id)}" class="text-primary font-bold inline-flex items-center gap-1">Aç ${mat('arrow_forward', 'text-[16px]')}</a>
        </td>
      </tr>`
    }).join('')}</tbody></table>`
  hedef.querySelectorAll('tr.tiklanir').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('a,button')) return
    location.href = tr.dataset.git
  }))
}

function notKarti(n) {
  const isYon = benim.rol === 'yonetici'
  const benimMi = n.sahip_danisman_id === benim.id
  const sahipsiz = !n.sahip_danisman_id
  const duzenleyebilir = isYon || benimMi

  // Durum: sahibi veya yönetici değiştirebilir; değilse sadece rozet
  const durumHtml = duzenleyebilir
    ? `<select data-durum="${n.id}" class="alan">
         ${DURUMLAR.map(d => `<option value="${kacis(d)}"${d === n.musteri_durumu ? ' selected' : ''}>${kacis(d)}</option>`).join('')}
       </select>`
    : `<span class="rozet ${durumSinifi(n.musteri_durumu)}">${kacis(n.musteri_durumu)}</span>${kaybedildiMi(n.musteri_durumu) && n.kayip_nedeni ? ` <span class="soluk">— ${kacis(n.kayip_nedeni)}</span>` : ''}`

  // Sahiplenme satırı
  let sahipHtml
  if (sahipsiz) {
    sahipHtml = `<span class="rozet havuz">HAVUZDA</span>
      <button class="btn btn-gold btn-kucuk" data-sahiplen="${n.id}">Sahiplen</button>`
  } else {
    sahipHtml = `<span class="soluk">Sahip:</span> <strong>${kacis(danismanAdi(dmap, n.sahip_danisman_id))}</strong>`
    if (benimMi) sahipHtml += ` <button class="btn btn-cizgi btn-kucuk" style="color:var(--metin);border-color:var(--cizgi)" data-birak="${n.id}">Bırak</button>`
  }

  // Yönetici notu bölümü
  let yonHtml = ''
  if (isYon) {
    yonHtml = `<div class="aralik">
      <label class="soluk">Yönetici Notu</label>
      <textarea data-yonnot="${n.id}" class="alan" style="width:100%">${kacis(n.yonetici_notu || '')}</textarea>
      <div class="aralik"><button class="btn btn-bordo btn-kucuk" data-yonkaydet="${n.id}">Yönetici Notunu Kaydet</button>
        ${n.yonetici_not_tarih ? `<span class="soluk"> — son: ${fmtTarih(n.yonetici_not_tarih)} (${kacis(danismanAdi(dmap, n.yonetici_not_yazan))})</span>` : ''}
      </div></div>`
  } else if (n.yonetici_notu) {
    yonHtml = `<div class="aralik uyari-kutu"><strong>Yönetici notu:</strong> ${kacis(n.yonetici_notu)}</div>`
  }

  const acilisRozet = n.acilis_notu ? ` <span class="rozet notr" title="Talep açılış kaydı (görüşme değil)">Talep açılışı</span>` : ''
  const sonrakiHtml = n.sonraki_adim_tarihi
    ? `<div class="aralik" style="display:inline-flex;align-items:center;gap:6px;color:var(--metin)"><span class="material-symbols-outlined" style="font-size:16px">event_upcoming</span> <strong>Sonraki adım:</strong> ${fmtTarihKisa(n.sonraki_adim_tarihi)}</div>`
    : ''

  return `<div class="not-kart" id="not-${n.id}">
    <div class="ust">
      <div>${sahipHtml}${acilisRozet}</div>
      <div class="soluk">Açan: ${kacis(danismanAdi(dmap, n.acan_id))} · ${fmtTarih(n.created_at)}</div>
    </div>
    <div class="not-metni">${kacis(n.gorusme_notu) || '<span class="soluk">(not metni yok)</span>'}</div>
    ${sonrakiHtml}
    <div class="form-satir" style="align-items:end">
      <div class="alan"><label>Müşteri Durumu</label>${durumHtml}</div>
      ${duzenleyebilir
        ? `<div class="alan" data-kayip-alan="${n.id}"${kaybedildiMi(n.musteri_durumu) ? '' : ' style="display:none"'}>
             <label>Kayıp Nedeni</label>
             <div style="display:flex; gap:8px; align-items:center">
               <select data-kayip="${n.id}" class="alan">${KAYIP_NEDENLERI.map(k => `<option${k === n.kayip_nedeni ? ' selected' : ''}>${kacis(k)}</option>`).join('')}</select>
               <button type="button" class="btn btn-gold btn-kucuk" data-kayip-kaydet="${n.id}">Kaydet</button>
             </div>
           </div>`
        : '<div></div>'}
    </div>
    ${yonHtml}
    <div class="aralik">
      <label class="soluk">Not Sohbeti (ekip)</label>
      <div class="sohbet" data-sohbet="${n.id}"></div>
      <form class="sohbet-gonder" data-gonder="${n.id}">
        <input placeholder="Ekibe mesaj yaz…" autocomplete="off" />
        <button type="submit" class="btn btn-gold btn-kucuk">Gönder</button>
      </form>
    </div>
  </div>`
}

function baglaOlaylar(n) {
  const kok = document.getElementById('not-' + n.id)
  if (!kok) return
  kok.querySelector(`[data-sahiplen]`)?.addEventListener('click', () => sahiplen(n.id))
  kok.querySelector(`[data-birak]`)?.addEventListener('click', () => birak(n.id))
  kok.querySelector(`[data-durum]`)?.addEventListener('change', e => durumSecildi(n.id, e.target.value))
  kok.querySelector(`[data-kayip-kaydet]`)?.addEventListener('click', () => {
    const sel = kok.querySelector(`[data-durum]`)
    durumGuncelle(n.id, sel ? sel.value : 'Kaybedildi')
  })
  kok.querySelector(`[data-yonkaydet]`)?.addEventListener('click', () => {
    const metin = kok.querySelector(`[data-yonnot]`).value
    yoneticiNotKaydet(n.id, metin)
  })
  const gonderForm = kok.querySelector(`[data-gonder]`)
  gonderForm?.addEventListener('submit', e => {
    e.preventDefault()
    mesajGonder(n.id, gonderForm.querySelector('input'))
  })
}

// --- Aksiyonlar ---
async function sahiplen(id) {
  const { data, error } = await supabase.from('gorusme_notlari')
    .update({ sahip_danisman_id: benim.id }).eq('id', id).is('sahip_danisman_id', null).select('id')
  if (error) return alert('Sahiplenme başarısız: ' + error.message)
  if (!data?.length) alert('Bu işi bu sırada başka biri sahiplendi.')
  await yukle()
}

async function birak(id) {
  if (!confirm('Bu işi havuza geri bırakmak istediğine emin misin?')) return
  const { error } = await supabase.from('gorusme_notlari')
    .update({ sahip_danisman_id: null }).eq('id', id)
  if (error) return alert('Bırakılamadı: ' + error.message)
  await yukle()
}

// Durum select değişince: Kaybedildi ise neden alanını aç (Kaydet'e basılınca kaydolur);
// diğer aşamalar anında kaydedilir.
function durumSecildi(id, yeniDurum) {
  const kayipAlan = document.querySelector(`[data-kayip-alan="${id}"]`)
  if (kaybedildiMi(yeniDurum)) {
    if (kayipAlan) kayipAlan.style.display = ''
  } else {
    if (kayipAlan) kayipAlan.style.display = 'none'
    durumGuncelle(id, yeniDurum)
  }
}

async function durumGuncelle(id, yeniDurum) {
  if (kapanisMi(yeniDurum)) {
    if (!confirm(`"${yeniDurum}" bir kapanış durumu.\nBu not aktif havuzdan düşecek ve sadece yönetici arşivde görebilecek.\nDevam edilsin mi?`)) {
      await yukle(); return
    }
  }
  const kayipSel = document.querySelector(`[data-kayip="${id}"]`)
  const kayip = kaybedildiMi(yeniDurum) ? (kayipSel ? kayipSel.value : null) : null
  const { error } = await supabase.from('gorusme_notlari')
    .update({ musteri_durumu: yeniDurum, kayip_nedeni: kayip }).eq('id', id)
  if (error) return alert('Durum güncellenemedi: ' + error.message)

  if (kapanisMi(yeniDurum) && benim.rol !== 'yonetici') {
    // Not artık bize görünmez → talepler listesine dön
    alert('Not kapatıldı ve arşive düştü.')
    location.href = 'talepler.html'
    return
  }
  await yukle()
}

async function yoneticiNotKaydet(id, metin) {
  const { error } = await supabase.from('gorusme_notlari').update({
    yonetici_notu: metin || null,
    yonetici_not_yazan: benim.id,
    yonetici_not_tarih: new Date().toISOString(),
  }).eq('id', id)
  if (error) return alert('Yönetici notu kaydedilemedi: ' + error.message)
  await yukle()
}

// Seçili duruma göre hızlı-not çiplerini çiz (tıklayınca not metnine ekler)
function ciplerCiz() {
  const kap = document.getElementById('yeniNotCipler')
  const durum = document.getElementById('yeniNotDurum')?.value
  if (!kap) return
  const cipler = hizliNotlar(durum)
  kap.innerHTML = cipler.map(c =>
    `<button type="button" class="hizli-cip px-3 py-1 rounded-full text-label-sm font-bold bg-primary/10 text-primary hover:bg-primary hover:text-white transition-colors" data-cip="${kacis(c)}">${kacis(c)}</button>`
  ).join('')
  kap.querySelectorAll('.hizli-cip').forEach(b => b.addEventListener('click', () => {
    const ta = document.getElementById('yeniNotMetin')
    const mevcut = ta.value.trim()
    ta.value = mevcut ? mevcut + ' · ' + b.dataset.cip : b.dataset.cip
    ta.focus()
  }))
}

async function yeniNotEkle(e) {
  e.preventDefault()
  const ta = document.getElementById('yeniNotMetin')
  const havuza = document.getElementById('yeniNotHavuza').checked
  const sonrakiTarih = document.getElementById('yeniNotSonraki')?.value || null

  const durum = document.getElementById('yeniNotDurum')?.value || undefined

  // (1+2) Boş not engeli — hızlı çip veya metin şart (tek dokunuşla dolar)
  if (!ta.value.trim()) {
    alert('Kısa bir not yazın ya da yukarıdaki hızlı seçimlerden birine dokunun.')
    ta.focus()
    return
  }

  const talep = (await supabase.from('talepler').select('musteri_ad_soyad, telefon').eq('id', talepId).single()).data

  // Aynı durumla tekrar not: uyar ama izin ver (ör. "aradım, meşguldü" — durum değişmeden not)
  const { data: sonNot } = await supabase.from('gorusme_notlari')
    .select('musteri_durumu').eq('talep_id', talepId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (sonNot && durum && sonNot.musteri_durumu === durum) {
    if (!confirm(`Bu talebin durumu zaten "${durum}". Durum değişmeden yeni not eklenecek. Devam edilsin mi?`)) return
  }
  const { error } = await supabase.from('gorusme_notlari').insert({
    talep_id: talepId,
    gorusme_notu: ta.value.trim() || null,
    musteri_ad_soyad: talep?.musteri_ad_soyad || null,
    telefon: talep?.telefon || null,
    musteri_durumu: durum,
    kayip_nedeni: kaybedildiMi(durum) ? document.getElementById('yeniNotKayip')?.value : null,
    sonraki_adim_tarihi: sonrakiTarih,
    acan_id: benim.id,
    sahip_danisman_id: havuza ? null : benim.id,
  })
  if (error) return alert('Not eklenemedi: ' + error.message)
  ta.value = ''
  const sd = document.getElementById('yeniNotSonraki'); if (sd) sd.value = ''
  document.getElementById('yeniNotKart').classList.add('gizli')
  await yukle()
}
