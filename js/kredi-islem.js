// =====================================================================
// kredi-islem.js — Kredi çip/atama/sonlandırma/düzenleme etkileşimleri
//
// PAYLAŞIMLI MODÜL: kredi.js (kuyruk) ve home.js (kredi dashboard) aynı
// modalı kullanır ki "anlık müdahale" iki ekranda da AYNI kodla çalışsın.
// Kopya modal yazmak yerine tek kaynak (CLAUDE.md §4 — yardımcıyı çoğaltma).
//
// Global modal: body seviyesinde tek overlay (#kredi-modal). Kart HTML'ine
// bağlı değil, bu yüzden tablo satırından da açılabilir.
//
// ctx = { benim, dmap, yenile } — yenile() işlem sonrası veriyi tazeler.
// =====================================================================
import { supabase } from './supabase-client.js'
import {
  danismanAdi, fmtPara, kacis, dbHata, KREDI_SONUCLARI, RED_NEDENLERI,
} from './veri.js'
import { uyari, binlikInputKur } from './stitch-ui.js'

const ONAYLI = ['onay', 'kismi_onay']

function modalKur(ic) {
  let kutu = document.getElementById('kredi-modal')
  if (!kutu) { kutu = document.createElement('div'); kutu.id = 'kredi-modal'; document.body.appendChild(kutu) }
  kutu.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-4 overflow-y-auto'
  kutu.innerHTML = `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-sm p-lg space-y-3 custom-shadow my-auto">${ic}</div>`
  const kapat = () => { kutu.className = 'hidden'; kutu.innerHTML = '' }
  kutu.onclick = e => { if (e.target === kutu) kapat() }
  kutu.querySelectorAll('[data-kapat]').forEach(x => x.addEventListener('click', kapat))
  return { kutu, kapat }
}

// Çip menüsü — durum + TUTAR + (Otosor'da SATIŞ BEYANI) + NOT tek pencerede.
export function cipMenuAc(b, banka, ctx) {
  if (b.durum === 'sonlandirildi') return
  const otosor = banka === 'Otosor'
  const mevcut = (b.kredi_banka_sonuclari || []).find(s => s.banka === banka)
  const kullandirilabilir = mevcut && ONAYLI.includes(mevcut.sonuc)
  let secili = mevcut?.sonuc || null

  // Başkası üzerine almışsa uyar: iki kişi aynı dosyayı düzenlerse son
  // yazan kazanır ve kimse fark etmez.
  const baskasinda = b.kredi_personeli_id && b.kredi_personeli_id !== ctx.benim.id
    ? danismanAdi(ctx.dmap, b.kredi_personeli_id) : null
  const { kutu, kapat } = modalKur(`
    <p class="text-title-md font-bold text-on-surface">${kacis(banka)}</p>
    ${baskasinda ? `<div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-body-md">
      Bu dosya <span class="font-bold">${kacis(baskasinda)}</span> üzerinde. Yaptığın değişiklik onunkinin üzerine yazabilir.
    </div>` : ''}
    <div class="space-y-2">
      ${KREDI_SONUCLARI.filter(([k]) => k !== 'kullandirildi' && k !== 'pasif').map(([k, etiket, sinif]) =>
        `<button data-durum="${k}" class="w-full text-left border rounded-lg px-4 py-3 text-label-md font-bold min-h-[44px] ${sinif} ${secili === k ? 'ring-2 ring-offset-1 ring-primary' : 'opacity-70'}">${etiket}</button>`).join('')}
    </div>
    <div class="alan"><label>${otosor ? 'Kullandırılan kredi miktarı (₺)' : 'Onaylanan tutar (₺)'}</label>
      <input type="text" id="cipTutar" inputmode="numeric" class="para-gir" value="${mevcut?.tutar != null ? Number(mevcut.tutar).toLocaleString('tr-TR') : ''}" placeholder="Örn. 800.000" /></div>
    ${otosor ? `<div class="alan"><label>Satış beyanı (₺)</label>
      <input type="text" id="cipBeyan" inputmode="numeric" class="para-gir" value="${mevcut?.satis_beyani != null ? Number(mevcut.satis_beyani).toLocaleString('tr-TR') : ''}" placeholder="Otosor raporu için" /></div>` : ''}
    <div class="alan"><label>Not (opsiyonel)</label>
      <input id="cipNot" value="${kacis(mevcut?.not_metni || '')}" placeholder="hesap dökümü, tramer hata…" /></div>
    <div class="flex items-center gap-2">
      <button data-kaydet class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold min-h-[44px]">Kaydet</button>
      <button data-kapat class="border border-outline-variant px-lg py-sm rounded-lg text-label-md font-bold text-on-surface-variant min-h-[44px]">Vazgeç</button>
      <span id="cipDurum" class="text-label-sm text-error"></span>
    </div>
    ${/* R6-4: Eski doğrudan "✓ bu krediyi kullandır" bypass'ı KALDIRILDI.
         Kullandırım artık yalnız "Kullandırma Başla" → kredi müdürü (Can)
         "Kullandırımı Tamamla" onayı yolundan yapılır (sql/74). */ ''}
    ${mevcut ? '<button data-sil class="w-full border border-outline-variant px-4 py-2.5 rounded-lg text-label-md font-bold text-on-surface-variant min-h-[44px]">Bu kuruma başvurulmadı (temizle)</button>' : ''}`)

  kutu.querySelectorAll('[data-durum]').forEach(x => x.addEventListener('click', () => {
    secili = x.dataset.durum
    kutu.querySelectorAll('[data-durum]').forEach(y => {
      const s = y.dataset.durum === secili
      y.classList.toggle('ring-2', s); y.classList.toggle('ring-offset-1', s)
      y.classList.toggle('ring-primary', s); y.classList.toggle('opacity-70', !s)
    })
  }))
  const beyanAl = () => {
    const v = (kutu.querySelector('#cipBeyan')?.value || '').replace(/\./g, '').replace(/[^\d]/g, '')
    return v === '' ? null : Number(v)
  }
  kutu.querySelector('[data-kaydet]').addEventListener('click', () => {
    if (!secili) { kutu.querySelector('#cipDurum').textContent = 'Durum seçin.'; return }
    // TÜM alanları kapat()'tan ÖNCE oku: kapat() innerHTML'i boşaltır, sonra
    // querySelector null döner ve not/beyan sessizce null kaydedilir (kayıp).
    const t = (kutu.querySelector('#cipTutar').value || '').replace(/\./g, '').replace(/[^\d]/g, '')
    const not = kutu.querySelector('#cipNot')?.value.trim() || null
    const beyan = beyanAl()
    kapat()
    sonucYaz(b.id, banka, secili, t === '' ? null : Number(t), not, beyan, ctx)
  })
  kutu.querySelector('[data-sil]')?.addEventListener('click', () => { kapat(); sonucSil(b.id, banka, ctx) })
}

async function sonucYaz(basvuruId, banka, sonuc, tutar, not, satisBeyani, ctx) {
  // satis_beyani yalnızca Otosor'da anlamlı; diğer bankalarda cipBeyan alanı
  // olmadığı için null gelir ve null kalır.
  const { error } = await supabase.from('kredi_banka_sonuclari')
    .upsert({ basvuru_id: basvuruId, banka, sonuc, tutar, not_metni: not, satis_beyani: satisBeyani },
            { onConflict: 'basvuru_id,banka' })
    .select('id')
  if (error) { dbHata('kredi sonuc', error); alert('Kaydedilemedi: ' + error.message); return }
  await ctx.yenile()
}

async function sonucSil(basvuruId, banka, ctx) {
  const { error } = await supabase.from('kredi_banka_sonuclari')
    .delete().eq('basvuru_id', basvuruId).eq('banka', banka)
  if (error) { dbHata('kredi sonuc sil', error); alert('Silinemedi: ' + error.message); return }
  await ctx.yenile()
}

// Dosyayı üzerine al / bırak / devral — kim null ise bırakılır.
export async function atamaYaz(basvuruId, kim, ctx) {
  const { error } = await supabase.from('kredi_basvurulari')
    .update({ kredi_personeli_id: kim }).eq('id', basvuruId).select('id')
  if (error) { dbHata('atama', error); alert('İşlem başarısız: ' + error.message); return }
  await ctx.yenile()
}

export function duzenleAc(b, ctx) {
  const g = b.kredi_basvuru_gizli
  const gizli = Array.isArray(g) ? (g[0] || {}) : (g || {})
  const { kutu, kapat } = modalKur(`
    <p class="text-title-md font-bold text-on-surface">Müşteri bilgisini düzelt</p>
    <div class="alan"><label>Ad Soyad</label><input id="dzAd" value="${kacis(b.musteri_ad_soyad || '')}" /></div>
    <div class="alan"><label>Telefon *</label><input id="dzTel" type="tel" value="${kacis(b.telefon || '')}" /></div>
    <div class="alan"><label>TC Kimlik No (opsiyonel)</label><input id="dzTc" inputmode="numeric" maxlength="11" value="${kacis(gizli.tckn || '')}" /></div>
    <div class="alan"><label>Açıklama</label><textarea id="dzNot">${kacis(b.aciklama || '')}</textarea></div>
    <div class="flex items-center gap-2">
      <button data-kaydet class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold min-h-[44px]">Kaydet</button>
      <button data-kapat class="border border-outline-variant px-lg py-sm rounded-lg text-label-md font-bold text-on-surface-variant min-h-[44px]">Vazgeç</button>
      <span id="dzDurum" class="text-label-sm text-error"></span>
    </div>`)

  kutu.querySelector('[data-kaydet]').addEventListener('click', async () => {
    const ad = kutu.querySelector('#dzAd').value.trim()
    if (!ad) { kutu.querySelector('#dzDurum').textContent = 'Ad zorunlu.'; return }
    const tel = kutu.querySelector('#dzTel').value.trim()
    if (!tel) { kutu.querySelector('#dzDurum').textContent = 'Telefon zorunlu.'; return }
    const tc = kutu.querySelector('#dzTc').value.trim()
    const { error } = await supabase.from('kredi_basvurulari').update({
      musteri_ad_soyad: ad, telefon: tel,
      aciklama: kutu.querySelector('#dzNot').value.trim() || null,
    }).eq('id', b.id).select('id')
    if (error) { kutu.querySelector('#dzDurum').textContent = 'Hata: ' + error.message; return }
    if (tc) {
      await supabase.from('kredi_basvuru_gizli')
        .upsert({ basvuru_id: b.id, tckn: tc }, { onConflict: 'basvuru_id' })
    }
    kapat(); await ctx.yenile()
  })
}

export function sonlandirAc(b, ctx) {
  const onayVar = (b.kredi_banka_sonuclari || [])
    .some(s => ['onay', 'kismi_onay', 'kullandirildi'].includes(s.sonuc))

  const { kutu, kapat } = modalKur(`
    <p class="text-title-md font-bold text-on-surface">Başvuruyu sonlandır</p>
    <p class="text-body-md text-on-surface-variant">
      ${onayVar
        ? 'Bu dosyada onay var — <span class="font-bold text-green-800">onaylı</span> olarak kapanacak.'
        : 'Hiçbir kurumdan onay alınmamış — <span class="font-bold text-error">redli</span> olarak kapanacak.'}
    </p>
    ${onayVar ? '' : `
      <div class="alan"><label>Red nedeni *</label>
        <select id="redNeden"><option value="">Seçin…</option>
          ${RED_NEDENLERI.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select></div>
      <div class="alan gizli" id="redYorumAlan"><label>Açıklama</label>
        <textarea id="redYorum" placeholder="Kısaca yazın"></textarea></div>`}
    <div class="flex items-center gap-2">
      <button data-onayla class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold min-h-[44px]">Sonlandır</button>
      <button data-kapat class="border border-outline-variant px-lg py-sm rounded-lg text-label-md font-bold text-on-surface-variant min-h-[44px]">Vazgeç</button>
      <span id="sonlandirDurum" class="text-label-sm text-error"></span>
    </div>`)

  const neden = kutu.querySelector('#redNeden')
  neden?.addEventListener('change', () =>
    kutu.querySelector('#redYorumAlan').classList.toggle('gizli', neden.value !== 'diger'))

  kutu.querySelector('[data-onayla]').addEventListener('click', async () => {
    if (neden && !neden.value) { kutu.querySelector('#sonlandirDurum').textContent = 'Red nedeni seçin.'; return }
    const { error } = await supabase.rpc('kredi_basvuru_sonlandir', {
      p_basvuru: b.id,
      p_red_nedeni: neden ? neden.value : null,
      p_red_yorum: kutu.querySelector('#redYorum')?.value.trim() || null,
    })
    if (error) { dbHata('sonlandir', error); kutu.querySelector('#sonlandirDurum').textContent = 'Hata: ' + error.message; return }
    kapat(); await ctx.yenile()
  })
}

// =====================================================================
// R6-4 Faz B — Kullandırma Başla (personel): onaylı/kısmi onaylı bir banka
// sonucunu ONAY_BEKLIYOR bir kredi_kullandirim kaydına çevirir. Doğrudan
// sonuc='kullandirildi' YAZILMAZ (bkz. sql/74 yorum) — yalnız müdür
// (kredi-kullandirim.html, Can) onaylayınca gerçek kullandırım + cari
// tahsilat yazılır. Eşleşme/başlatma RPC'leri: kredi_kullandirim_eslesme,
// kredi_kullandirim_baslat, kredi_net_hesapla (formül burada YAZILMAZ).
//
// b = kredi_basvurulari satırı, sonucSatiri = tıklanan banka sonucu
// (kredi_banka_sonuclari satırı: id, banka, banka_kod, vade, tutar…),
// ctx = { benim, dmap, yenile }.
// =====================================================================
export async function kullandirimBaslatAc(b, sonucSatiri, ctx) {
  binlikInputKur()
  const banka = sonucSatiri.banka
  let adaylar = []
  let yuklendi = false         // eşleşme sorgusu bitti mi (aday listesi kesinleşti mi)
  let seciliSiparis = null
  let sistem = null            // kredi_net_hesapla sonucu (referans) — null = henüz yüklenmedi
  let hataMsg = null           // eşleşme bulunamadıysa / sorgulanamadıysa tüm modalı kaplayan hata
  let durumMsg = null          // formdaki doğrulama/RPC hatası (alt satır)
  let gonderiliyor = false
  let kapatRef = () => {}

  const gorunumHtml = () => {
    if (hataMsg) {
      return `<p class="text-title-md font-bold text-on-surface">${kacis(banka)} — Kullandırma Başla</p>
        ${uyari(kacis(hataMsg))}
        <button data-kapat class="border border-outline-variant px-lg py-sm rounded-lg text-label-md font-bold text-on-surface-variant min-h-[44px]">Kapat</button>`
    }
    if (!yuklendi) {
      return `<p class="text-title-md font-bold text-on-surface">${kacis(banka)} — Kullandırma Başla</p>
        <p class="text-body-md text-on-surface-variant">Eşleşen müşteri/sipariş aranıyor…</p>`
    }
    const aday = adaylar.find(a => a.siparis_id === seciliSiparis) || adaylar[0]
    const adayKartHtml = a => `<div class="text-body-md"><b>${kacis(a.ad_soyad)}</b> ${a.tckn_son4 ? '(TC ***' + kacis(a.tckn_son4) + ')' : ''}<br>
      <span class="text-on-surface-variant text-label-sm">${kacis(a.arac_ozet || 'Araç —')} · ${a.anlasilan_tutar != null ? fmtPara(a.anlasilan_tutar) : '—'}</span></div>`
    const secimHtml = adaylar.length <= 1
      ? `<div class="bg-surface-container-low rounded-lg px-3 py-2.5">${adayKartHtml(aday)}</div>`
      : `<div class="space-y-2">${adaylar.map((a, i) => `
          <label class="flex items-start gap-2 border rounded-lg px-3 py-2.5 cursor-pointer ${seciliSiparis === a.siparis_id ? 'border-primary bg-primary/5' : 'border-outline-variant'}">
            <input type="radio" name="kkSip" value="${i}" ${seciliSiparis === a.siparis_id ? 'checked' : ''} class="mt-1" data-siparis-sec>
            ${adayKartHtml(a)}
          </label>`).join('')}</div>`
    const sistemHtml = !sonucSatiri.banka_kod
      ? `<p class="text-label-sm text-on-surface-variant">Elle giriş — bu banka manuel hesaplanıyor.</p>`
      : sistem == null
        ? `<p class="text-label-sm text-on-surface-variant">Sistem hesabı yükleniyor…</p>`
        : sistem.hesaplama_tipi == null
          ? `<p class="text-label-sm text-on-surface-variant">${kacis(sistem.uyari || 'Yürürlükte parametre yok.')}</p>`
          : sistem.manuel
            ? `<p class="text-label-sm text-on-surface-variant">Elle giriş — bu banka manuel hesaplanıyor.</p>`
            : `<div class="grid grid-cols-3 gap-2 text-label-sm">
                 <div><span class="text-on-surface-variant block text-[10px] uppercase">Çekilecek</span><b>${fmtPara(sistem.cekilecek_kredi)}</b></div>
                 <div><span class="text-on-surface-variant block text-[10px] uppercase">Net Geçen</span><b>${fmtPara(sistem.net_gecen)}</b></div>
                 <div><span class="text-on-surface-variant block text-[10px] uppercase">Taksit</span><b>${sistem.taksit != null ? fmtPara(Math.round(sistem.taksit)) : '—'}</b></div>
               </div>`
    return `<p class="text-title-md font-bold text-on-surface">${kacis(banka)} — Kullandırma Başla</p>
      <div class="alan"><label>Eşleşen müşteri / açık sipariş</label></div>
      ${secimHtml}
      <div class="bg-surface-container-low rounded-lg p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant mb-1">Sistem hesabı (referans)</p>
        ${sistemHtml}
      </div>
      <div class="alan"><label>Manuel Net Geçen (₺) *</label>
        <input id="kkNetGecen" class="para-gir" inputmode="numeric" placeholder="Örn. 800.000" /></div>
      <div class="alan"><label>Kullandıran danışman</label>
        <select id="kkDanisman"><option value="">Seçin…</option>
          ${Object.values(ctx.dmap || {}).sort((x, y) => String(x.ad_soyad).localeCompare(String(y.ad_soyad), 'tr'))
            .map(d => `<option value="${d.id}">${kacis(d.ad_soyad)}</option>`).join('')}
        </select></div>
      <div class="flex items-center gap-2">
        <button data-gonder class="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-md font-bold min-h-[44px]"${gonderiliyor ? ' disabled' : ''}>${gonderiliyor ? 'Gönderiliyor…' : 'Onaya Gönder'}</button>
        <button data-kapat class="border border-outline-variant px-lg py-sm rounded-lg text-label-md font-bold text-on-surface-variant min-h-[44px]">Vazgeç</button>
        <span id="kkDurum" class="text-label-sm text-error">${durumMsg ? kacis(durumMsg) : ''}</span>
      </div>`
  }

  const ciz = () => {
    const { kutu, kapat } = modalKur(gorunumHtml())
    kapatRef = kapat
    kutu.querySelectorAll('[data-siparis-sec]').forEach(r => r.addEventListener('change', e => {
      seciliSiparis = adaylar[Number(e.target.value)].siparis_id
      ciz()
    }))
    kutu.querySelector('[data-gonder]')?.addEventListener('click', gonder)
  }

  async function gonder() {
    const netRaw = document.getElementById('kkNetGecen')?.value.replace(/\D/g, '') || ''
    const net = Number(netRaw)
    if (!net || net <= 0) { durumMsg = 'Manuel net geçen tutarı girin.'; ciz(); return }
    const danismanId = document.getElementById('kkDanisman')?.value || null
    const aday = adaylar.find(a => a.siparis_id === seciliSiparis) || adaylar[0]
    if (!aday) return
    durumMsg = null; gonderiliyor = true; ciz()
    const { error } = await supabase.rpc('kredi_kullandirim_baslat', {
      p_banka_sonuc_id: sonucSatiri.id, p_siparis_id: aday.siparis_id, p_musteri_id: aday.musteri_id,
      p_manuel_net_gecen: net, p_kullandiran_danisman_id: danismanId,
    })
    gonderiliyor = false
    if (dbHata('kredi_kullandirim_baslat', error)) { durumMsg = 'Gönderilemedi: ' + (error.message || ''); ciz(); return }
    kapatRef()
    alert('Kredi müdürü onayına gönderildi.')
    await ctx.yenile()
  }

  ciz()   // "aranıyor" durumu ilk görüntü, aşağıdaki await'ler bitince yeniden çizilir

  const { data: eslesme, error } = await supabase.rpc('kredi_kullandirim_eslesme', { p_banka_sonuc_id: sonucSatiri.id })
  if (dbHata('kredi_kullandirim_eslesme', error)) { hataMsg = 'Eşleşme sorgulanamadı: ' + (error.message || ''); ciz(); return }
  adaylar = (eslesme || []).filter(a => a.siparis_id)
  yuklendi = true
  if (!adaylar.length) {
    hataMsg = 'Bu müşteri için açık satış siparişi bulunamadı (TCKN/ad eşleşmedi).'
    ciz(); return
  }
  seciliSiparis = adaylar[0].siparis_id
  ciz()

  if (sonucSatiri.banka_kod) {
    const { data: hesap, error: hErr } = await supabase.rpc('kredi_net_hesapla', {
      p_banka_kod: sonucSatiri.banka_kod, p_istenen_net: sonucSatiri.tutar, p_vade: sonucSatiri.vade ?? null,
    })
    if (dbHata('kredi_net_hesapla (referans)', hErr)) sistem = { hesaplama_tipi: null, uyari: 'Hesaplanamadı.' }
    else sistem = Array.isArray(hesap) ? hesap[0] : hesap
    ciz()
  }
}
