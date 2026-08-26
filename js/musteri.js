// =====================================================================
// musteri.js — Müşteri 360° kartı (Stitch): sol bilgi kartı + görüşme
//   geçmişi timeline + önerilen araçlar. Aynı telefonun tüm kayıtları.
// =====================================================================
import { supabase } from './supabase-client.js'
import { siteDb } from './site-client.js'
import {
  danismanMap, danismanAdi, durumSinifi, aracOzet, fmtButce, fmtTarih, fmtPara,
  telSon10, telNo, waHref, kacis, urlParam, kapanisMi,
} from './veri.js'
import { mat, pill, basHarf, bosDurum, uyari } from './stitch-ui.js'
import { uygunAraclar } from './eslestirme.js'

const KOK = () => document.getElementById('kok')

export async function musteriKur() {
  const dmap = await danismanMap()
  const tel = urlParam('tel')
  const son10 = telSon10(tel)
  if (!son10) { KOK().innerHTML = uyari('Telefon bilgisi eksik. <a href="talepler.html" class="font-bold underline">Talepler\'e dön</a>'); return }

  const [talepR, araclarR] = await Promise.all([
    supabase.from('talepler')
      .select('id, musteri_ad_soyad, telefon, eposta, marka, model, paket, model_yili_min, model_yili_max, butce_min, butce_max, talep_tarihi, ' +
              'gorusme_notlari(id, gorusme_notu, musteri_durumu, sahip_danisman_id, acan_id, created_at)')
      .ilike('telefon_norm', '%' + son10 + '%')
      .order('talep_tarihi', { ascending: false }),
    siteDb.from('araclar').select('id, marka, model, yil, fiyat, durum, fotolar'),
  ])

  if (talepR.error) { KOK().innerHTML = uyari(kacis(talepR.error.message)); return }
  const data = talepR.data || []
  if (!data.length) { KOK().innerHTML = bosDurum(`Bu numarayla (${kacis(tel)}) kayıt bulunamadı.`, 'person_search'); return }

  const ad = data.find(t => t.musteri_ad_soyad)?.musteri_ad_soyad || 'Müşteri'
  const telefon = data.find(t => t.telefon)?.telefon || tel
  const tumNotlar = data.flatMap(t => (t.gorusme_notlari || []).map(n => ({ ...n, talep_id: t.id })))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const sonDurum = tumNotlar[0]?.musteri_durumu
  const kayitTarihi = data.map(t => t.talep_tarihi).filter(Boolean).sort()[0]
  const sonEtkilesim = tumNotlar[0]?.created_at
  const atanan = tumNotlar.find(n => n.sahip_danisman_id)?.sahip_danisman_id
  const mukerrer = data.length > 1

  // Önerilen araçlar — tüm taleplerin uygun stok eşleşmeleri (birleştir, tekilleştir)
  const araclar = araclarR.data || []
  const oneriMap = new Map()
  for (const t of data) for (const a of uygunAraclar(t, araclar)) if (!oneriMap.has(a.id)) oneriMap.set(a.id, a)
  const oneriler = [...oneriMap.values()].sort((x, y) => (Number(x.fiyat) || 0) - (Number(y.fiyat) || 0)).slice(0, 6)

  const t = telNo(telefon), wa = waHref(telefon)

  KOK().innerHTML = `
    <div class="flex flex-col gap-sm mb-lg">
      <a href="talepler.html" class="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors w-fit">${mat('arrow_back', 'text-sm')}<span class="text-label-sm uppercase tracking-wider">Talepler</span></a>
      <h2 class="text-headline-md text-on-surface">Müşteri Detayı</h2>
    </div>

    ${mukerrer ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-md mb-lg flex items-center gap-3">${mat('warning', 'text-amber-600')}<p class="text-body-md text-amber-800">⚠️ Bu müşteri birden fazla kez kayıtlı <span class="font-bold">(${data.length} talep — mükerrer)</span>. Önceki görüşmeleri kontrol edin.</p></div>` : ''}

    <div class="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-lg">
      <!-- Sol: müşteri bilgi kartı -->
      <section class="flex flex-col gap-lg">
        <div class="bg-white rounded-xl custom-shadow border border-outline-variant p-lg lg:sticky lg:top-24">
          <div class="flex flex-col items-center text-center mb-lg">
            <div class="w-24 h-24 rounded-full bg-primary-fixed text-primary flex items-center justify-center mb-md border-2 border-primary/10 text-3xl font-bold">${basHarf(ad)}</div>
            <h3 class="text-headline-sm text-primary mb-1">${kacis(ad)}</h3>
            <p class="text-body-md text-on-surface-variant flex items-center gap-1">${mat('call', 'text-sm')} ${kacis(telefon) || '—'}</p>
          </div>
          ${sonDurum ? `<div class="flex flex-wrap gap-2 mb-lg justify-center">${pill(sonDurum, durumSinifi(sonDurum))}${mukerrer ? '<span class="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-label-sm font-bold">Mükerrer</span>' : ''}</div>` : ''}
          <div class="grid grid-cols-1 gap-md">
            ${t ? `<a href="tel:${t}" class="flex items-center justify-center gap-2 w-full py-3 bg-primary text-white rounded-lg text-label-md font-bold hover:opacity-90 transition-all">${mat('call', 'text-sm')} Ara</a>` : ''}
            ${wa ? `<a href="${wa}" target="_blank" class="flex items-center justify-center gap-2 w-full py-3 border border-secondary text-secondary rounded-lg text-label-md font-bold hover:bg-secondary/5 transition-all">${mat('chat', 'text-sm', true)} WhatsApp</a>` : ''}
          </div>
          <button id="musteriDuzenleBtn" class="mt-md w-full flex items-center justify-center gap-2 py-2 text-on-surface-variant hover:text-primary text-label-sm font-bold border border-outline-variant rounded-lg transition-colors">${mat('edit', 'text-sm')} Bilgileri Düzenle</button>
          <form id="musteriDuzenleForm" class="hidden mt-md space-y-2 border-t border-outline-variant pt-md">
            <div><label class="text-xs text-on-surface-variant font-bold">Ad Soyad</label><input id="mdAd" value="${kacis(ad)}" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md" /></div>
            <div><label class="text-xs text-on-surface-variant font-bold">Telefon</label><input id="mdTel" value="${kacis(telefon)}" class="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md" placeholder="05xx xxx xx xx" /></div>
            <div class="flex gap-2"><button type="submit" class="flex-1 py-2 bg-primary text-white rounded-lg text-label-sm font-bold">Kaydet</button><button type="button" id="mdIptal" class="px-3 py-2 border border-outline-variant rounded-lg text-label-sm font-bold">İptal</button></div>
            <p id="mdDurum" class="text-xs"></p>
          </form>
          <div class="mt-xl pt-lg border-t border-outline-variant space-y-md">
            <div class="flex justify-between items-center gap-2"><span class="text-xs text-on-surface-variant uppercase font-bold tracking-widest">Kayıt Tarihi</span><span class="text-label-sm text-on-surface text-right">${kayitTarihi ? fmtTarih(kayitTarihi) : '—'}</span></div>
            <div class="flex justify-between items-center gap-2"><span class="text-xs text-on-surface-variant uppercase font-bold tracking-widest">Son Etkileşim</span><span class="text-label-sm text-on-surface text-right">${sonEtkilesim ? fmtTarih(sonEtkilesim) : '—'}</span></div>
            <div class="flex justify-between items-center gap-2"><span class="text-xs text-on-surface-variant uppercase font-bold tracking-widest">Atanan Danışman</span><span class="text-label-sm text-on-surface text-right">${atanan ? kacis(danismanAdi(dmap, atanan)) : 'Havuzda'}</span></div>
            <div class="flex justify-between items-center gap-2"><span class="text-xs text-on-surface-variant uppercase font-bold tracking-widest">Talep Sayısı</span><span class="text-label-sm text-on-surface text-right">${data.length}</span></div>
          </div>
        </div>
      </section>

      <!-- Sağ: geçmiş + talepler + öneriler -->
      <section class="space-y-lg">
        <!-- Görüşme Geçmişi -->
        <div class="bg-white rounded-xl custom-shadow border border-outline-variant p-lg">
          <h3 class="text-title-lg text-on-surface flex items-center gap-2 mb-lg">${mat('history', 'text-primary')} Görüşme Geçmişi</h3>
          ${tumNotlar.length ? `<div class="relative space-y-6">
            <div class="absolute left-[11px] top-2 bottom-2 w-px bg-outline-variant"></div>
            ${tumNotlar.map(n => { const kapali = kapanisMi(n.musteri_durumu)
              return `<div class="flex gap-4 relative z-10">
                <div class="w-6 h-6 shrink-0 rounded-full ${kapali ? 'bg-secondary' : 'bg-primary'} flex items-center justify-center text-white ring-4 ring-white">${mat(kapali ? 'done_all' : 'call', 'text-xs')}</div>
                <div class="flex-1 min-w-0 bg-surface-container-low/50 rounded-lg p-md border border-outline-variant/40">
                  <div class="flex justify-between items-start gap-2 flex-wrap mb-2">
                    <div><span class="text-label-sm text-primary font-bold">Danışman: ${kacis(danismanAdi(dmap, n.sahip_danisman_id || n.acan_id))}</span><p class="text-xs text-on-surface-variant mt-0.5">${fmtTarih(n.created_at)}</p></div>
                    ${pill(n.musteri_durumu, durumSinifi(n.musteri_durumu))}
                  </div>
                  <p class="text-body-md text-on-surface-variant">${kacis(n.gorusme_notu) || '<span class="italic">(not yok)</span>'}</p>
                  <a href="talep.html?id=${n.talep_id}" class="text-primary text-xs font-bold mt-2 inline-block">Talebi aç →</a>
                </div>
              </div>`
            }).join('')}
          </div>` : '<p class="text-on-surface-variant text-center py-6">Görüşme kaydı yok.</p>'}
        </div>

        <!-- Önerilen Araçlar -->
        <div class="bg-white rounded-xl custom-shadow border border-outline-variant p-lg">
          <div class="flex items-center justify-between mb-lg">
            <h3 class="text-title-lg text-on-surface flex items-center gap-2">${mat('feature_search', 'text-primary')} Önerilen Araçlar</h3>
            <a href="stok.html" class="text-primary text-label-sm font-bold hover:underline flex items-center gap-1">Tüm Stok ${mat('open_in_new', 'text-xs')}</a>
          </div>
          ${oneriler.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-md">
            ${oneriler.map(a => { const foto = (a.fotolar || '').split(',')[0]?.trim()
              return `<div class="group border border-outline-variant rounded-lg overflow-hidden hover:border-primary transition-all flex flex-col bg-surface">
                <div class="h-40 overflow-hidden relative bg-surface-container">
                  ${foto ? `<img src="${kacis(foto)}" alt="" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.style.display='none'">` : `<div class="w-full h-full flex items-center justify-center">${mat('directions_car', 'text-on-surface-variant text-4xl')}</div>`}
                  <span class="absolute top-2 left-2 px-2 py-1 bg-primary text-white text-[10px] font-bold rounded">UYGUN</span>
                </div>
                <div class="p-md flex-1 flex flex-col">
                  <p class="text-xs text-on-surface-variant mb-1 font-bold">${kacis(a.yil) || ''}</p>
                  <h4 class="text-title-lg text-on-surface mb-2 leading-tight">${kacis([a.marka, a.model].filter(Boolean).join(' '))}</h4>
                  <p class="text-primary text-headline-sm font-bold mb-4">${fmtPara(a.fiyat)}</p>
                  <div class="grid grid-cols-2 gap-2 mt-auto">
                    <a href="stok-arac.html?ref=${encodeURIComponent(a.id)}" class="flex items-center justify-center gap-1 py-2 border border-primary text-primary rounded text-xs font-bold hover:bg-primary hover:text-white transition-all">${mat('visibility', 'text-sm')} DETAY</a>
                    ${wa ? `<a href="${wa}" target="_blank" class="flex items-center justify-center gap-1 py-2 border border-secondary text-secondary rounded text-xs font-bold hover:bg-secondary hover:text-white transition-all">${mat('chat', 'text-sm', true)} WP</a>` : ''}
                  </div>
                </div>
              </div>`
            }).join('')}
          </div>` : '<p class="text-on-surface-variant text-center py-6">Müşterinin kriterlerine uygun stok aracı bulunamadı.</p>'}
        </div>
      </section>
    </div>`

  duzenlemeKur(data, tel)
}

// Müşteri bilgilerini düzenle (ad soyad + telefon) — aynı numaranın tüm talepleri güncellenir
function duzenlemeKur(data, tel) {
  const form = document.getElementById('musteriDuzenleForm')
  const btn = document.getElementById('musteriDuzenleBtn')
  if (!form || !btn) return
  btn.addEventListener('click', () => form.classList.toggle('hidden'))
  document.getElementById('mdIptal')?.addEventListener('click', () => form.classList.add('hidden'))

  form.addEventListener('submit', async e => {
    e.preventDefault()
    const durumEl = document.getElementById('mdDurum')
    const yeniAd = document.getElementById('mdAd').value.trim()
    if (!yeniAd) { durumEl.textContent = 'Ad soyad zorunlu.'; durumEl.className = 'text-xs text-red-600'; return }

    // Telefon normalize: rakam-only; başında 0 yoksa otomatik 0 ekle
    let d = document.getElementById('mdTel').value.replace(/\D/g, '')
    if (d && !d.startsWith('0')) d = '0' + d
    const yeniTel = d || null

    durumEl.textContent = 'Kaydediliyor…'; durumEl.className = 'text-xs text-on-surface-variant'
    const talepIdler = data.map(t => t.id)
    const guncelle = { musteri_ad_soyad: yeniAd, telefon: yeniTel }   // telefon_norm üretilmiş kolon → otomatik güncellenir
    const { error } = await supabase.from('talepler').update(guncelle).in('id', talepIdler)
    if (error) { durumEl.textContent = 'Hata: ' + error.message; durumEl.className = 'text-xs text-red-600'; return }
    // Bu ikinci yazma sessizdi: talepler güncellenip notlar güncellenmeyince
    // müşterinin adı/telefonu iki tabloda farklı kalıyordu, kimse görmüyordu.
    const { error: notHata } = await supabase.from('gorusme_notlari').update(guncelle).in('talep_id', talepIdler)
    if (notHata) {
      console.error('[db] musteri notlari guncelle', notHata)
      durumEl.textContent = 'Talep güncellendi ama görüşme notları güncellenemedi: ' + notHata.message
      durumEl.className = 'text-xs text-red-600'
      return
    }
    // Telefon değişmiş olabilir → yeni numarayla yeniden aç
    location.href = 'musteri.html?tel=' + encodeURIComponent(yeniTel || tel)
  })
}
