// =====================================================================
// bildirim.js — Üst bar bildirim zili (uygulama içi bildirimler)
//   ustBarKur() zil + panel markup'ını basar; burada veri + realtime bağlanır.
//   bildirimler tablosu yoksa (sql/12 çalışmadıysa) zil sessizce gizlenir.
// =====================================================================
import { supabase } from './supabase-client.js'
import { kacis, dbHata } from './veri.js'
import { satisMuduruMu } from './yetki.js'

let benim = null, liste = [], bfiltre = 'hepsi'

// =====================================================================
// AKSİYONLU BİLDİRİM — "bildirimi gördüm, oradan da karara bağlayayım"
//
// Göksenil (19 Ağu 2026): "satış müdürü sipariş detayına girip görebildi;
//   bildirim verip oradan da onaylayabilir olması gerek."
//
// ⚠️ Eşleştirme BAŞLIK METNİYLE değil, `bildirimler.kural_kodu` ile.
//    Başlık bildirim_kurallari'ndan geliyor; birisi metni güzelleştirdiği
//    an metin eşleşmesi sessizce kopar ve düğmeler kaybolur.
// ⚠️ Buradaki yetki kontrolü yalnız GÖRÜNÜRLÜK. Asıl kapı sunucuda:
//    min_fiyat_onay_karar() ilk satırında is_satis_muduru() bakıyor ve
//    yetkisizse {ok:false, hata} döndürüyor. İkisi ayrışırsa sunucu kazanır.
// =====================================================================
const EYLEMLI_KURALLAR = {
  'BK-64': 'MIN_FIYAT',   // satış müdürüne
  'BK-65': 'MIN_FIYAT',   // master yedek
}
// link: "siparis-dosya.html?id=<uuid>" → sipariş kimliği
const SIPARIS_RE = /[?&]id=([0-9a-fA-F-]{36})/
const siparisId = b => (b.link || '').match(SIPARIS_RE)?.[1] || null

// siparis_id → { durum, tutar, min } — düğmeleri ölü göstermemek için.
// Bildirim zilde sonsuza kadar durur; karar başka yerden verilmişse
// "Onayla" düğmesi tıklanınca hata döndürmek yerine hiç çıkmamalı.
let EYLEM_DURUM = new Map()

async function eylemDurumYukle() {
  const idler = [...new Set(liste.filter(b => EYLEMLI_KURALLAR[b.kural_kodu])
                                 .map(siparisId).filter(Boolean))]
  if (!idler.length) { EYLEM_DURUM = new Map(); return false }
  const { data, error } = await supabase.from('siparisler')
    .select('id, anlasilan_tutar, min_satis_snapshot, min_fiyat_onay_durumu, min_fiyat_gerekce')
    .in('id', idler)
  if (error) { dbHata('bildirim eylem durumu', error); return false }   // §5.4
  EYLEM_DURUM = new Map((data || []).map(r => [r.id, r]))
  return true
}

const IK = { havuz: 'inbox', yonetici: 'shield_person', sistem: 'notifications', eslesme: 'directions_car', surum: 'campaign', finans: 'account_balance' }
function mat(a, e = '') { return `<span class="material-symbols-outlined${e ? ' ' + e : ''}">${a}</span>` }
function gecenSure(ts) {
  const dk = (Date.now() - new Date(ts).getTime()) / 60000
  if (dk < 1) return 'az önce'
  if (dk < 60) return Math.floor(dk) + ' dk'
  if (dk < 1440) return Math.floor(dk / 60) + ' sa'
  return Math.floor(dk / 1440) + ' gün'
}

export async function bildirimKur(danisman) {
  benim = danisman
  const zil = document.getElementById('bildirimZil')
  if (!zil) return

  const { data, error } = await supabase.from('bildirimler')
    // F4 — sıralama önce ÖNCELİK (P1 kritik en üstte), sonra zaman.
    .select('*').eq('danisman_id', benim.id)
    .order('okundu', { ascending: true }).order('oncelik', { ascending: true })
    .order('created_at', { ascending: false }).limit(30)
  if (error) { zil.style.display = 'none'; return }   // tablo yok → yalnızca zili gizle
  liste = data || []
  ciz()
  // Durumlar geç gelir; geldiğinde yeniden çiz (ciz() senkron kalsın).
  if (await eylemDurumYukle()) ciz()

  bildirimIzniIste()   // sayfa açılışında (varsa kullanıcı hareketiyle tekrar denenir)
  const drawer = document.getElementById('bildirimDrawer')
  const backdrop = document.getElementById('bildirimBackdrop')
  const ac = () => { backdrop.classList.remove('hidden'); requestAnimationFrame(() => { backdrop.classList.add('opacity-100'); drawer.classList.remove('translate-x-full') }) }
  const kapat = () => { drawer.classList.add('translate-x-full'); backdrop.classList.remove('opacity-100'); setTimeout(() => backdrop.classList.add('hidden'), 300) }
  zil.addEventListener('click', e => {
    e.stopPropagation()
    bildirimIzniIste()   // kullanıcı hareketi — mobil tarayıcılar burada izin sorar
    drawer.classList.contains('translate-x-full') ? ac() : kapat()
  })
  backdrop?.addEventListener('click', kapat)
  document.getElementById('bildirimKapat')?.addEventListener('click', kapat)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer && !drawer.classList.contains('translate-x-full')) kapat() })
  document.getElementById('bildirimHepsi')?.addEventListener('click', hepsiOkundu)
  document.querySelectorAll('#bildirimDrawer [data-btab]').forEach(b => b.addEventListener('click', () => {
    bfiltre = b.dataset.btab
    document.querySelectorAll('#bildirimDrawer [data-btab]').forEach(x => {
      const a = x.dataset.btab === bfiltre
      x.classList.toggle('border-primary', a); x.classList.toggle('text-primary', a)
      x.classList.toggle('border-transparent', !a); x.classList.toggle('text-on-surface-variant', !a)
    })
    ciz()
  }))

  supabase.channel('bildirim-' + benim.id)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bildirimler', filter: `danisman_id=eq.${benim.id}` },
      p => {
        liste.unshift(p.new); ciz(); osBildirim(p.new)
        // Yeni gelen bildirim aksiyonluysa siparişin durumunu da çek,
        // yoksa düğmeler ilk yenilemeye kadar çıkmaz.
        if (EYLEMLI_KURALLAR[p.new.kural_kodu]) eylemDurumYukle().then(v => { if (v) ciz() })
      })
    .subscribe()
}

// --- İşletim sistemi (masaüstü/telefon) bildirimi ---
// VAPID public key (gizli DEĞİL — private key yalnızca Edge Function secret'ında)
const VAPID_PUBLIC = 'BOlNAgtrNVDefN_VCIapthGYzeEGqAiELJTfBIXp7t7_5p552_eK4lsNomJRpvkAoTSvdZl_AnLQXBQtAf6Atdc'

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

async function bildirimIzniIste() {
  try {
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {})
    if (Notification.permission === 'granted') pushAboneOl()
  } catch { /* yoksay */ }
}

// Web Push aboneliği — uygulama kapalıyken bile bildirim (Edge Function gönderir)
async function pushAboneOl() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(VAPID_PUBLIC),
    })
    const j = sub.toJSON()
    if (!j.keys) return
    const { error } = await supabase.from('push_abonelikleri').upsert({
      danisman_id: benim.id, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    }, { onConflict: 'endpoint' })
    // Kayıt olmazsa push bildirimi hiç gelmez; kullanıcıyı rahatsız etme ama
    // en azından konsolda iz bırak — tamamen sessiz kalması teşhisi imkânsız kılıyordu.
    if (error) console.error('[db] push abonelik', error)
  } catch (e) { console.error('push abonelik kurulamadi', e) }
}

async function osBildirim(b) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const opt = {
      body: b.mesaj || '',
      tag: 'crm-' + b.id,               // aynı bildirim iki kez patlamasın
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { link: b.link || 'talepler.html' },
      // sw.js'teki push yoluyla AYNI davranış: P1 ekranda asılı kalır.
      // İkisi ayrışırsa aynı bildirim uygulama açıkken kaybolur, kapalıyken
      // kalır — kullanıcı için açıklanamaz bir fark olurdu.
      requireInteraction: b.oncelik === 1,
    }
    const reg = navigator.serviceWorker && await navigator.serviceWorker.ready.catch(() => null)
    if (reg && reg.showNotification) await reg.showNotification(b.baslik || 'Yeni bildirim', opt)
    else new Notification(b.baslik || 'Yeni bildirim', opt)   // SW yoksa masaüstü fallback
  } catch { /* yoksay */ }
}

function ciz() {
  const okunmamis = liste.filter(b => !b.okundu)
  const nokta = document.getElementById('bildirimNokta')
  if (nokta) nokta.classList.toggle('hidden', okunmamis.length === 0)
  const say = document.getElementById('bildirimSayi')
  if (say) { say.textContent = okunmamis.length; say.classList.toggle('hidden', okunmamis.length === 0); say.classList.toggle('inline-flex', okunmamis.length > 0) }
  const alt = document.getElementById('bildirimAlt')
  if (alt) alt.textContent = okunmamis.length ? `${okunmamis.length} okunmamış bildirim` : 'Hepsi okundu ✓'

  const kap = document.getElementById('bildirimListe'); if (!kap) return
  const veri = bfiltre === 'okunmamis' ? okunmamis : liste
  if (!veri.length) {
    kap.innerHTML = `<div class="flex flex-col items-center justify-center text-center py-16 text-on-surface-variant">${mat('notifications_off', 'text-4xl opacity-30')}<p class="mt-2 text-body-md">${bfiltre === 'okunmamis' ? 'Okunmamış bildirim yok.' : 'Bildirim yok.'}</p></div>`
    return
  }

  // F4 — öncelik rozeti. P1 kritik (kırmızı, okunmamışsa kenarlık da kırmızı),
  // P2 önemli (amber), P3 normal (rozet yok), P4 bilgi (soluk).
  const ONCELIK = {
    1: { ad: 'KRİTİK', cls: 'bg-error text-on-error', kenar: 'border-error/50 bg-error/5' },
    2: { ad: 'ÖNEMLİ', cls: 'bg-[#F59E0B] text-white', kenar: 'border-[#F59E0B]/40 bg-[#FFFBEB]' },
    4: { ad: 'BİLGİ', cls: 'bg-surface-container-high text-on-surface-variant', kenar: '' },
  }
  const kart = b => {
    const o = ONCELIK[b.oncelik] || null
    const kenar = b.okundu ? 'border-outline-variant bg-surface-container-lowest'
      : (o?.kenar || 'border-primary/30 bg-primary-fixed/40')
    return `
    <div class="border ${kenar} rounded-xl p-3.5 flex gap-3">
      <div class="w-10 h-10 rounded-full ${b.okundu ? 'bg-surface-container text-on-surface-variant' : (b.oncelik === 1 ? 'bg-error text-on-error' : 'bg-primary text-on-primary')} flex items-center justify-center shrink-0">${mat(IK[b.tip] || 'notifications', 'text-[20px]')}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <p class="font-bold text-on-surface text-body-md leading-tight">
            ${o && !b.okundu ? `<span class="align-middle mr-1.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-wide ${o.cls}">${o.ad}</span>` : ''}${kacis(b.baslik)}</p>
          <span class="text-[10px] text-on-surface-variant shrink-0 uppercase">${gecenSure(b.created_at)}</span></div>
        ${b.mesaj ? `<p class="text-body-sm text-on-surface-variant mt-0.5 leading-snug">${kacis(b.mesaj)}</p>` : ''}
        <div class="mt-2 flex items-center gap-3">
          ${b.link ? `<a href="${kacis(b.link)}" data-git="${kacis(b.id)}" class="inline-flex items-center gap-1 text-primary text-label-sm font-bold hover:underline">Git ${mat('arrow_forward', 'text-[15px]')}</a>` : ''}
          ${b.okundu ? '' : `<button data-ok="${kacis(b.id)}" class="text-on-surface-variant text-label-sm font-bold hover:text-primary">Okundu</button>`}
        </div>
        ${eylemHtml(b)}
      </div>
    </div>`
  }

  if (bfiltre === 'okunmamis') {
    kap.innerHTML = `<div class="space-y-3">${veri.map(kart).join('')}</div>`
  } else {
    const yeni = liste.filter(b => !b.okundu), eski = liste.filter(b => b.okundu)
    kap.innerHTML =
      (yeni.length ? `<section><div class="flex items-center gap-2 mb-3"><span class="w-2 h-2 rounded-full bg-primary"></span><h3 class="text-[11px] font-bold uppercase tracking-wider text-primary">Okunmamış</h3></div><div class="space-y-3">${yeni.map(kart).join('')}</div></section>` : '')
      + (eski.length ? `<section><div class="flex items-center gap-2 mb-3"><span class="w-2 h-2 rounded-full bg-outline"></span><h3 class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Önceki</h3></div><div class="space-y-3">${eski.map(kart).join('')}</div></section>` : '')
  }

  kap.querySelectorAll('[data-git]').forEach(a => a.addEventListener('click', () => okunduIsaretle(a.dataset.git)))
  kap.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); okunduIsaretle(b.dataset.ok) }))
  kap.querySelectorAll('[data-mfonay]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); minFiyatKarar(b.dataset.mfonay, true) }))
  kap.querySelectorAll('[data-mfred]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); minFiyatKarar(b.dataset.mfred, false) }))
}

// Bildirim kartının altına karar bloğu. Zil dar bir çekmece: özet üç
// rakamla veriliyor (anlaşılan / minimum / fark), gerekçe zaten mesajda.
function eylemHtml(b) {
  if (EYLEMLI_KURALLAR[b.kural_kodu] !== 'MIN_FIYAT') return ''
  const sid = siparisId(b); if (!sid) return ''
  const d = EYLEM_DURUM.get(sid)
  if (!d) return ''                                  // durum henüz gelmedi
  const rozet = (sinif, metin) => `<div class="mt-2 rounded-lg px-3 py-2 text-label-sm font-bold text-center ${sinif}">${metin}</div>`
  if (d.min_fiyat_onay_durumu === 'ONAY')  return rozet('bg-secondary-container text-on-secondary-container', 'Onaylandı ✓')
  if (d.min_fiyat_onay_durumu === 'RED')   return rozet('bg-error-container text-on-error-container', 'Reddedildi')
  if (d.min_fiyat_onay_durumu !== 'BEKLIYOR') return ''
  if (!satisMuduruMu(benim)) return rozet('bg-amber-100 text-amber-900', 'Satış müdürü onayı bekliyor')

  const tl = v => v == null ? '—' : Number(v).toLocaleString('tr-TR') + ' ₺'
  const fark = (d.min_satis_snapshot != null && d.anlasilan_tutar != null)
    ? Number(d.min_satis_snapshot) - Number(d.anlasilan_tutar) : null
  return `<div class="mt-2.5 border-t border-outline-variant pt-2.5" data-eylem="${kacis(b.id)}">
      <div class="grid grid-cols-3 gap-1.5 mb-2">
        ${[['Anlaşılan', tl(d.anlasilan_tutar), ''], ['Minimum', tl(d.min_satis_snapshot), ''],
           ['Fark', tl(fark), 'text-error']].map(([et, v, c]) => `
          <div class="bg-surface-container-low rounded-lg px-2 py-1.5">
            <div class="text-[9px] uppercase tracking-wide text-on-surface-variant">${et}</div>
            <div class="text-label-md font-bold ${c}">${v}</div>
          </div>`).join('')}
      </div>
      <textarea data-not="${kacis(b.id)}" rows="2"
        class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-2.5 py-2 text-[13px] resize-none focus:ring-2 focus:ring-primary/20 focus:outline-none"
        placeholder="Karar notu (redde ZORUNLU, kayda geçer)"></textarea>
      <div class="flex gap-2 mt-2">
        <button data-mfonay="${kacis(b.id)}" class="flex-1 px-2 py-2 rounded-lg bg-primary text-on-primary text-label-sm font-bold hover:opacity-90 flex items-center justify-center gap-1">${mat('check_circle', 'text-[15px]')} Onayla</button>
        <button data-mfred="${kacis(b.id)}" class="flex-1 px-2 py-2 rounded-lg border border-error text-error text-label-sm font-bold hover:bg-error-container flex items-center justify-center gap-1">${mat('cancel', 'text-[15px]')} Reddet</button>
      </div>
      <p data-mfhata="${kacis(b.id)}" class="hidden text-label-sm text-error mt-1.5"></p>
    </div>`
}

async function minFiyatKarar(bildirimId, onay) {
  const b = liste.find(x => x.id === bildirimId); if (!b) return
  const sid = siparisId(b); if (!sid) return
  const kap = document.querySelector(`[data-eylem="${CSS.escape(bildirimId)}"]`)
  const hataEl = kap?.querySelector(`[data-mfhata]`)
  const hata = m => { if (hataEl) { hataEl.textContent = m; hataEl.classList.remove('hidden') } }
  const not = (kap?.querySelector('[data-not]')?.value || '').trim()
  if (!onay && !not) return hata('Reddederken gerekçe zorunlu.')

  kap?.querySelectorAll('button').forEach(x => { x.disabled = true })
  const { data, error } = await supabase.rpc('min_fiyat_onay_karar', {
    p_siparis: sid, p_onay: onay, p_not: not || null,
  })
  kap?.querySelectorAll('button').forEach(x => { x.disabled = false })
  if (error) { dbHata('min fiyat karar (zil)', error); return hata(error.message) }   // §5.4
  // RPC hatayı istisna olarak DEĞİL, {ok:false, hata} olarak döndürüyor —
  // error null olduğu için burayı atlamak "sessiz başarı" üretirdi.
  if (!data?.ok) return hata(data?.hata || 'Karar kaydedilemedi.')

  await eylemDurumYukle()
  if (!b.okundu) okunduIsaretle(bildirimId)   // ciz() içeride çağrılıyor
  else ciz()
}

async function okunduIsaretle(id) {
  const b = liste.find(x => x.id === id); if (b) b.okundu = true
  ciz()
  const { error } = await supabase.from('bildirimler').update({ okundu: true }).eq('id', id)
  dbHata('bildirim okundu', error)   // başarısızsa yenilemede tekrar okunmamış görünür
}

async function hepsiOkundu() {
  const idler = liste.filter(b => !b.okundu).map(b => b.id)
  liste.forEach(b => b.okundu = true); ciz()
  if (idler.length) await supabase.from('bildirimler').update({ okundu: true }).in('id', idler)
}
