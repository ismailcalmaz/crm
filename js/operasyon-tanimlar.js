// =====================================================================
// operasyon-tanimlar.js — Operasyon Merkezi · Tanımlar (F7-a)
//   Göksenil kararı: "Verileri operasyon müdürü girecek, ayrı ayrı enum
//   listesi. Bu modülde admin paneli gibi bir yapı olsun, tanımlamaları
//   oradan girsin — bir seferliğe mahsus."
//
//   3 liste: Lokasyonlar (kanban + SLA) · Tedarikçiler · İşlem Türleri
//   Yazma yetkisi SUNUCUDA korunur (sql/93 is_mudur('operasyon')); burada
//   yalnız görünüm kilitlenir — yetkisiz kullanıcı salt-okur görür.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata, fmtPara } from './veri.js'
import { mat, bosDurum, uyari } from './stitch-ui.js'
import { mudurMu } from './yetki.js'

const KOK = () => document.getElementById('kok')
const INP = 'bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all w-full'
let BEN = null, YETKI = false
let LOK = [], TED = [], ISL = []
let sekme = 'lokasyon'

export async function operasyonTanimlarKur(d) {
  BEN = d
  // Yönetici/master da girebilsin (müdür yoksa kurulum tıkanmasın) — sunucu
  // tarafında is_mudur('operasyon') zaten yöneticiyi üstten kapsıyor.
  YETKI = mudurMu(d, 'operasyon')
  KOK().innerHTML = `<div class="py-24 text-center text-on-surface-variant">Yükleniyor…</div>`
  await yukle()
}

async function yukle() {
  const [lok, ted, isl] = await Promise.all([
    supabase.from('operasyon_lokasyonlar').select('*').order('sira'),
    supabase.from('operasyon_tedarikciler').select('*').order('ad'),
    supabase.from('operasyon_islem_turleri').select('*').order('sira'),
  ])
  if (lok.error) dbHata('operasyon_lokasyonlar', lok.error)
  if (ted.error) dbHata('operasyon_tedarikciler', ted.error)
  if (isl.error) dbHata('operasyon_islem_turleri', isl.error)
  LOK = lok.data || []; TED = ted.data || []; ISL = isl.data || []
  ciz()
}

function ciz() {
  const sekmeBtn = (k, ad, ik, adet) => `<button data-sekme="${k}" class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${sekme === k ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}">${mat(ik, 'text-[18px]')}${ad}<span class="ml-1 bg-surface-container-high text-on-surface-variant text-[10px] px-1.5 rounded-full">${adet}</span></button>`

  KOK().innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-4 md:mb-6 flex-wrap">
      <div><h2 class="text-headline-md text-primary font-bold">Operasyon Tanımları</h2>
        <p class="text-body-md text-on-surface-variant">Lokasyonlar, tedarikçiler ve işlem türleri — operasyon akışının sözlüğü</p></div>
      ${YETKI ? '' : `<span class="px-3 py-1.5 rounded-lg bg-[#FFFBEB] text-[#92400E] text-label-md font-bold flex items-center gap-1.5">${mat('lock', 'text-[16px]')} Salt okuma — düzenleme yalnız operasyon müdürüne açık</span>`}
    </div>
    <div class="flex items-center gap-1 overflow-x-auto border-b border-outline-variant mb-4">
      ${sekmeBtn('lokasyon', 'Lokasyonlar', 'location_on', LOK.length)}
      ${sekmeBtn('tedarikci', 'Tedarikçiler', 'store', TED.length)}
      ${sekmeBtn('islem', 'İşlem Türleri', 'build', ISL.length)}
    </div>
    <div id="opDurum" class="hidden mb-3 text-label-md"></div>
    <div id="opGovde"></div>`

  document.querySelectorAll('[data-sekme]').forEach(b => b.addEventListener('click', () => { sekme = b.dataset.sekme; ciz() }))
  const g = document.getElementById('opGovde')
  if (sekme === 'lokasyon') lokasyonCiz(g)
  else if (sekme === 'tedarikci') tedarikciCiz(g)
  else islemCiz(g)
}

function durum(msg, hata = false) {
  const el = document.getElementById('opDurum'); if (!el) return
  el.textContent = msg
  el.className = 'mb-3 text-label-md font-bold ' + (hata ? 'text-error' : 'text-secondary')
  clearTimeout(durum._t); durum._t = setTimeout(() => { el.textContent = ''; el.className = 'hidden' }, 3500)
}

// ---------------------------------------------------------------- LOKASYON
function lokasyonCiz(g) {
  const satir = l => `<tr class="border-b border-outline-variant/40" data-lok="${kacis(l.kod)}">
    <td class="px-3 py-2"><span class="inline-block w-3 h-3 rounded-full align-middle mr-2" style="background:${kacis(l.renk || '#94a3b8')}"></span>
      <b>${kacis(l.ad)}</b><br><span class="text-[11px] text-on-surface-variant font-mono">${kacis(l.kod)}</span></td>
    <td class="px-3 py-2"><input type="number" data-alan="sira" value="${l.sira}" ${YETKI ? '' : 'disabled'} class="${INP} w-20" /></td>
    <td class="px-3 py-2"><input type="number" data-alan="hedef_saat" value="${l.hedef_saat}" ${YETKI ? '' : 'disabled'} class="${INP} w-24" /></td>
    <td class="px-3 py-2"><input type="number" data-alan="uyari_saat" value="${l.uyari_saat}" ${YETKI ? '' : 'disabled'} class="${INP} w-24" /></td>
    <td class="px-3 py-2"><input type="color" data-alan="renk" value="${kacis(l.renk || '#94a3b8')}" ${YETKI ? '' : 'disabled'} class="w-12 h-9 rounded border border-outline-variant" /></td>
    <td class="px-3 py-2 text-center"><input type="checkbox" data-alan="aktif" ${l.aktif ? 'checked' : ''} ${YETKI ? '' : 'disabled'} class="w-4 h-4 accent-primary" /></td>
    <td class="px-3 py-2 text-right">${YETKI ? `<button data-lokkaydet class="px-3 h-8 rounded-lg bg-primary text-on-primary text-label-md font-bold hover:opacity-90">Kaydet</button>` : ''}</td>
  </tr>`

  g.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-hidden">
      <div class="p-4 border-b border-outline-variant">
        <p class="text-body-md text-on-surface-variant">Kanban sütunları ve <b>SLA hedef süreleri</b>. Bir araç lokasyonda <b>uyarı süresini</b> aşarsa kartı sarı, hedefi aşarsa kırmızı olur ve "Müdahale Gerekiyor" kuyruğuna düşer.</p>
      </div>
      <div class="overflow-x-auto"><table class="w-full text-left border-collapse min-w-[820px]">
        <thead><tr class="bg-surface-container text-on-surface-variant text-label-xs uppercase">
          <th class="px-3 py-2">Lokasyon</th><th class="px-3 py-2">Sıra</th>
          <th class="px-3 py-2">Hedef (saat)</th><th class="px-3 py-2">Uyarı (saat)</th>
          <th class="px-3 py-2">Renk</th><th class="px-3 py-2 text-center">Aktif</th><th class="px-3 py-2"></th>
        </tr></thead>
        <tbody>${LOK.map(satir).join('')}</tbody>
      </table></div>
      ${YETKI ? `<div class="p-4 border-t border-outline-variant bg-surface-container-low/40">
        <p class="text-[11px] font-bold text-on-surface-variant uppercase mb-2">Yeni Lokasyon</p>
        <div class="flex flex-wrap items-end gap-2">
          <input id="lokKod" placeholder="KOD (ör. DOSEME)" class="${INP} w-48 font-mono uppercase" />
          <input id="lokAd" placeholder="Ad (ör. Döşeme)" class="${INP} w-56" />
          <input id="lokHedef" type="number" value="48" placeholder="Hedef saat" class="${INP} w-28" />
          <button id="lokEkle" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1">${mat('add', 'text-[18px]')} Ekle</button>
        </div></div>` : ''}
    </div>`

  if (!YETKI) return
  g.querySelectorAll('[data-lokkaydet]').forEach(b => b.addEventListener('click', () => lokasyonKaydet(b.closest('[data-lok]'))))
  g.querySelector('#lokEkle')?.addEventListener('click', lokasyonEkle)
}

function satirDegerleri(tr) {
  const o = {}
  tr.querySelectorAll('[data-alan]').forEach(el => {
    o[el.dataset.alan] = el.type === 'checkbox' ? el.checked
      : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value
  })
  return o
}

async function lokasyonKaydet(tr) {
  const { error, data } = await supabase.from('operasyon_lokasyonlar')
    .update(satirDegerleri(tr)).eq('kod', tr.dataset.lok).select('kod')
  if (error) { dbHata('lokasyon kaydet', error); return durum('Kaydedilemedi: ' + error.message, true) }
  if (!data?.length) return durum('Kaydedilemedi — yetki yok (operasyon müdürü gerekir).', true)
  durum('✓ Lokasyon güncellendi')
  await yukle()
}

async function lokasyonEkle() {
  const kod = (document.getElementById('lokKod').value || '').trim().toLocaleUpperCase('tr').replace(/\s+/g, '_')
  const ad = (document.getElementById('lokAd').value || '').trim()
  const hedef = Number(document.getElementById('lokHedef').value) || 48
  if (!kod || !ad) return durum('Kod ve ad zorunlu.', true)
  const sira = (LOK.length ? Math.max(...LOK.map(l => l.sira)) : 0) + 10
  const { error } = await supabase.from('operasyon_lokasyonlar')
    .insert({ kod, ad, sira, hedef_saat: hedef, uyari_saat: hedef, renk: '#94a3b8' })
  if (error) { dbHata('lokasyon ekle', error); return durum('Eklenemedi: ' + error.message, true) }
  durum('✓ Lokasyon eklendi')
  await yukle()
}

// -------------------------------------------------------------- TEDARİKÇİ
function tedarikciCiz(g) {
  const kart = t => `<div class="border border-outline-variant rounded-xl p-3.5 ${t.aktif ? '' : 'opacity-55'}" data-ted="${t.id}">
    <div class="flex items-start gap-2 mb-2">
      <div class="min-w-0 flex-1">
        <input data-alan="ad" value="${kacis(t.ad)}" ${YETKI ? '' : 'disabled'} class="${INP} font-bold" />
      </div>
      <label class="flex items-center gap-1.5 text-label-md shrink-0 pt-2"><input type="checkbox" data-alan="aktif" ${t.aktif ? 'checked' : ''} ${YETKI ? '' : 'disabled'} class="w-4 h-4 accent-primary" /> Aktif</label>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <input data-alan="kategori" value="${kacis(t.kategori || '')}" placeholder="Kategori (Kaporta…)" ${YETKI ? '' : 'disabled'} class="${INP}" />
      <input data-alan="yetkili" value="${kacis(t.yetkili || '')}" placeholder="Yetkili" ${YETKI ? '' : 'disabled'} class="${INP}" />
      <input data-alan="telefon" value="${kacis(t.telefon || '')}" placeholder="Telefon" ${YETKI ? '' : 'disabled'} class="${INP}" />
      <input data-alan="varsayilan_vade" type="number" value="${t.varsayilan_vade ?? ''}" placeholder="Vade (gün)" ${YETKI ? '' : 'disabled'} class="${INP}" />
      <input data-alan="adres" value="${kacis(t.adres || '')}" placeholder="Adres" ${YETKI ? '' : 'disabled'} class="${INP} col-span-2" />
    </div>
    ${YETKI ? `<div class="flex justify-end mt-2"><button data-tedkaydet class="px-3 h-8 rounded-lg bg-primary text-on-primary text-label-md font-bold hover:opacity-90">Kaydet</button></div>` : ''}
  </div>`

  g.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow p-4">
      <p class="text-body-md text-on-surface-variant mb-3">Çalışılan sanayi/servis firmaları. İş emri açarken bu listeden seçilir; maliyet analizi ve <b>bekleme analizi</b> firma bazında bu kayıtlarla çıkar.</p>
      ${YETKI ? `<div class="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-xl bg-surface-container-low border border-outline-variant">
        <input id="tedAd" placeholder="Firma adı *" class="${INP} w-56" />
        <input id="tedKategori" placeholder="Kategori" class="${INP} w-40" />
        <input id="tedTelefon" placeholder="Telefon" class="${INP} w-40" />
        <button id="tedEkle" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1">${mat('add', 'text-[18px]')} Firma Ekle</button>
      </div>` : ''}
      ${TED.length ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">${TED.map(kart).join('')}</div>`
        : bosDurum('Henüz tedarikçi tanımlanmadı.', 'store')}
    </div>`

  if (!YETKI) return
  g.querySelectorAll('[data-tedkaydet]').forEach(b => b.addEventListener('click', () => tedarikciKaydet(b.closest('[data-ted]'))))
  g.querySelector('#tedEkle')?.addEventListener('click', tedarikciEkle)
}

async function tedarikciKaydet(kart) {
  const o = satirDegerleri(kart)
  if (!o.ad?.trim()) return durum('Firma adı boş olamaz.', true)
  const { error, data } = await supabase.from('operasyon_tedarikciler').update(o).eq('id', kart.dataset.ted).select('id')
  if (error) { dbHata('tedarikçi kaydet', error); return durum('Kaydedilemedi: ' + error.message, true) }
  if (!data?.length) return durum('Kaydedilemedi — yetki yok.', true)
  durum('✓ Tedarikçi güncellendi')
  await yukle()
}

async function tedarikciEkle() {
  const ad = (document.getElementById('tedAd').value || '').trim()
  if (!ad) return durum('Firma adı zorunlu.', true)
  const { error } = await supabase.from('operasyon_tedarikciler').insert({
    ad, kategori: (document.getElementById('tedKategori').value || '').trim() || null,
    telefon: (document.getElementById('tedTelefon').value || '').trim() || null,
  })
  if (error) { dbHata('tedarikçi ekle', error); return durum('Eklenemedi: ' + error.message, true) }
  durum('✓ Firma eklendi')
  await yukle()
}

// ------------------------------------------------------------- İŞLEM TÜRÜ
function islemCiz(g) {
  const satir = i => `<tr class="border-b border-outline-variant/40" data-isl="${kacis(i.kod)}">
    <td class="px-3 py-2"><b>${kacis(i.ad)}</b><br><span class="text-[11px] text-on-surface-variant font-mono">${kacis(i.kod)}</span></td>
    <td class="px-3 py-2"><input data-alan="kategori" value="${kacis(i.kategori || '')}" ${YETKI ? '' : 'disabled'} class="${INP} w-36" /></td>
    <td class="px-3 py-2 text-center">
      ${i.ic_hizmet
        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">İÇ HİZMET</span>`
        : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-container-high text-on-surface-variant border border-outline-variant">TEDARİKÇİ</span>`}</td>
    <td class="px-3 py-2"><input data-alan="varsayilan_tutar" type="number" value="${i.varsayilan_tutar ?? ''}" placeholder="—" ${YETKI ? '' : 'disabled'} class="${INP} w-32" /></td>
    <td class="px-3 py-2"><input data-alan="sira" type="number" value="${i.sira}" ${YETKI ? '' : 'disabled'} class="${INP} w-20" /></td>
    <td class="px-3 py-2 text-center"><input type="checkbox" data-alan="aktif" ${i.aktif ? 'checked' : ''} ${YETKI ? '' : 'disabled'} class="w-4 h-4 accent-primary" /></td>
    <td class="px-3 py-2 text-right">${YETKI ? `<button data-islkaydet class="px-3 h-8 rounded-lg bg-primary text-on-primary text-label-md font-bold hover:opacity-90">Kaydet</button>` : ''}</td>
  </tr>`

  g.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl custom-shadow overflow-hidden">
      <div class="p-4 border-b border-outline-variant">
        <p class="text-body-md text-on-surface-variant">Araçlara yapılan işler. <b>İÇ HİZMET</b> işaretli olanlar (pasta cila, kuaför) dış tedarikçi değil <b>şirket personeli</b> tarafından yapılır — masraf defterine değil kendi sayfalarına girilir, primleri finans hesaplar.</p>
      </div>
      <div class="overflow-x-auto"><table class="w-full text-left border-collapse min-w-[820px]">
        <thead><tr class="bg-surface-container text-on-surface-variant text-label-xs uppercase">
          <th class="px-3 py-2">İşlem</th><th class="px-3 py-2">Kategori</th><th class="px-3 py-2 text-center">Tip</th>
          <th class="px-3 py-2">Varsayılan Tutar</th><th class="px-3 py-2">Sıra</th>
          <th class="px-3 py-2 text-center">Aktif</th><th class="px-3 py-2"></th>
        </tr></thead>
        <tbody>${ISL.map(satir).join('')}</tbody>
      </table></div>
      ${YETKI ? `<div class="p-4 border-t border-outline-variant bg-surface-container-low/40">
        <p class="text-[11px] font-bold text-on-surface-variant uppercase mb-2">Yeni İşlem Türü</p>
        <div class="flex flex-wrap items-end gap-2">
          <input id="islKod" placeholder="KOD (ör. DOSEME_TAMIR)" class="${INP} w-52 font-mono uppercase" />
          <input id="islAd" placeholder="Ad (ör. Döşeme Tamiri)" class="${INP} w-52" />
          <input id="islKategori" placeholder="Kategori" class="${INP} w-36" />
          <label class="flex items-center gap-1.5 text-sm h-10"><input id="islIc" type="checkbox" class="w-4 h-4 accent-primary" /> İç hizmet (personel yapar)</label>
          <button id="islEkle" class="px-4 h-10 rounded-lg bg-primary text-on-primary text-sm font-bold hover:opacity-90 flex items-center gap-1">${mat('add', 'text-[18px]')} Ekle</button>
        </div></div>` : ''}
    </div>`

  if (!YETKI) return
  g.querySelectorAll('[data-islkaydet]').forEach(b => b.addEventListener('click', () => islemKaydet(b.closest('[data-isl]'))))
  g.querySelector('#islEkle')?.addEventListener('click', islemEkle)
}

async function islemKaydet(tr) {
  const { error, data } = await supabase.from('operasyon_islem_turleri')
    .update(satirDegerleri(tr)).eq('kod', tr.dataset.isl).select('kod')
  if (error) { dbHata('işlem türü kaydet', error); return durum('Kaydedilemedi: ' + error.message, true) }
  if (!data?.length) return durum('Kaydedilemedi — yetki yok.', true)
  durum('✓ İşlem türü güncellendi')
  await yukle()
}

async function islemEkle() {
  const kod = (document.getElementById('islKod').value || '').trim().toLocaleUpperCase('tr').replace(/\s+/g, '_')
  const ad = (document.getElementById('islAd').value || '').trim()
  if (!kod || !ad) return durum('Kod ve ad zorunlu.', true)
  const sira = (ISL.length ? Math.max(...ISL.map(i => i.sira)) : 0) + 10
  const { error } = await supabase.from('operasyon_islem_turleri').insert({
    kod, ad, kategori: (document.getElementById('islKategori').value || '').trim() || null,
    ic_hizmet: document.getElementById('islIc').checked, sira,
  })
  if (error) { dbHata('işlem türü ekle', error); return durum('Eklenemedi: ' + error.message, true) }
  durum('✓ İşlem türü eklendi')
  await yukle()
}
