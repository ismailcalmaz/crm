// =====================================================================
// site-client.js — SİTE projesine (ismailcalmaz.com) salt-okunur bağlantı
// =====================================================================
// CRM, aracı stoğunu ve değerleme sonuçlarını site projesinden okur
// (stok senkron + değerleme robotu orada yaşıyor). Sadece anon key —
// RLS korur, yalnızca herkese açık okunabilir veriye erişir.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const SITE_URL  = 'https://rouqjeaeywbhhahwduku.supabase.co'
export const SITE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdXFqZWFleXdiaGhhaHdkdWt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzQyNzIsImV4cCI6MjA5ODExMDI3Mn0.hS5q5IKzkeS-hc4GNRO58vPeVqQXC7q4qgvzS2SAvMI'
// Ayrı storageKey → CRM oturumuyla çakışmaz
export const siteDb = createClient(SITE_URL, SITE_ANON, {
  auth: { persistSession: false, storageKey: 'ic-site-ro' },
})

// --- Stok okuma: anon kısıtını aşan köprü ------------------------------
// Sitenin genel okuma politikası fotoğrafsız aracı gizliyor (halka açık
// site için doğru). CRM aynı anon anahtarını kullandığı için 160 aktif
// aracın 26'sını — yeni alınmış, henüz fotoğraflanmamış olanları — HİÇ
// göremiyordu. Kredi başvurusu yapılacak müşteri tam da onu bekliyor
// olabilir.
//
// stok-listesi edge function'ı SITE service_role ile okuyup tamamını
// döner. Secret tanımlı değilse (503) veya çağrı başarısız olursa
// ESKİ DAVRANIŞA geri düşülür — yani hiçbir şey bozulmaz, sadece
// fotoğrafsızlar görünmez.
import { supabase } from './supabase-client.js'

async function kopruden(ref) {
  const { data, error } = await supabase.functions.invoke(
    'stok-listesi' + (ref ? '?ref=' + encodeURIComponent(ref) : ''), { method: 'GET' })
  if (error) return null
  if (!Array.isArray(data)) return null      // {hata, geri_dus} geldiyse
  return data
}

export async function stokListesi() {
  const k = await kopruden(null)
  if (k) return k
  const { data } = await siteDb.from('araclar').select('*').eq('durum', 'aktif').limit(2000)
  return data || []
}

export async function stokTek(ref) {
  const k = await kopruden(ref)
  if (k) return k[0] || null
  const { data } = await siteDb.from('araclar').select('*').eq('id', ref).maybeSingle()
  return data || null
}

// --- Değerleme talepleri köprüsü -------------------------------------
// SITE degerleme_talepleri'nin SELECT politikası yalnızca `authenticated`
// rolüne açık; CRM anon anahtarıyla bağlandığı için doğrudan okuyamıyor.
// degerleme-listesi edge function'ı SITE service_role ile okur. Secret yoksa
// (503) veya çağrı başarısızsa boş dizi döner — sayfa "veri yok" gösterir.
export async function degerlemeListesi() {
  const { data, error } = await supabase.functions.invoke('degerleme-listesi', { method: 'GET' })
  if (error || !Array.isArray(data)) return []   // köprü yoksa/çökerse boş
  return data
}
