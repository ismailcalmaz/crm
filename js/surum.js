// =====================================================================
// surum.js — Sürüm notları / Yenilikler sayfası (herkes okur)
//   Bildirimdeki "surum" tipi buraya yönlendirir. Yayınlama admin'de.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, fmtTarih } from './veri.js'
import { mat, avatar, bosDurum, uyari } from './stitch-ui.js'

// İçeriği satır satır maddelere böl (— / - / • başlangıçlı satırları liste yap)
function icerikHtml(metin) {
  const satirlar = (metin || '').split('\n').map(s => s.trim()).filter(Boolean)
  return satirlar.map(s => {
    const madde = s.replace(/^[-•—*]\s*/, '')
    const listeMi = /^[-•—*]\s/.test(s)
    return listeMi
      ? `<li class="flex gap-2 text-body-md text-on-surface"><span class="text-secondary mt-1">${mat('check_circle', 'text-[16px]')}</span><span>${kacis(madde)}</span></li>`
      : `<p class="text-body-md text-on-surface">${kacis(madde)}</p>`
  }).join('')
}

export async function surumKur() {
  const kap = document.getElementById('surumListe')
  kap.innerHTML = '<div class="p-6 text-on-surface-variant">Yükleniyor…</div>'

  const { data, error } = await supabase
    .from('surum_notlari')
    .select('*, yayinlayan:danismanlar(ad_soyad)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) { kap.innerHTML = uyari(`Yüklenemedi: ${kacis(error.message)}`); return }
  if (!data || !data.length) { kap.innerHTML = bosDurum('Henüz sürüm notu yok.', 'campaign'); return }

  kap.innerHTML = data.map(n => `
    <article class="bg-surface-container-lowest rounded-xl border border-outline-variant custom-shadow p-lg">
      <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div class="flex items-center gap-3">
          ${n.surum ? `<span class="px-3 py-1 rounded-full text-label-sm font-bold bg-primary text-white">${kacis(n.surum)}</span>` : ''}
          <h3 class="text-title-lg text-primary">${kacis(n.baslik)}</h3>
        </div>
        <span class="text-label-sm text-on-surface-variant">${fmtTarih(n.created_at)}</span>
      </div>
      <ul class="space-y-1.5">${icerikHtml(n.icerik)}</ul>
      ${n.yayinlayan?.ad_soyad ? `<div class="flex items-center gap-2 mt-4 pt-3 border-t border-outline-variant/60 text-label-sm text-on-surface-variant">${avatar(n.yayinlayan.ad_soyad, 'w-6 h-6')}<span>${kacis(n.yayinlayan.ad_soyad)}</span></div>` : ''}
    </article>`).join('')
}
