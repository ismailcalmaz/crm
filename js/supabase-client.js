// =====================================================================
// Supabase istemcisi — tüm frontend buradan içe aktarır.
// =====================================================================
// anon key frontend'de GÜVENLİDİR: RLS politikaları veriyi korur.
// service_role ASLA buraya konmaz (o sadece robotların Railway ortamında).
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { agFetch } from './ag.js'

export const SUPABASE_URL  = 'https://gmbovpszyzssncrlfaix.supabase.co'
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtYm92cHN6eXpzc25jcmxmYWl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDM4MzMsImV4cCI6MjA5ODk3OTgzM30.xINGvcAYIM47pG_7KRUleJkxOcDsjwMsxVej2dWh_4o'

// Tüm Supabase trafiği ag.js üzerinden geçer: GET'lerde üstel geri çekilmeli
// yeniden deneme, merkezî hata logu, 1000-satır limiti uyarısı (bkz. ag.js).
// YAZMA istekleri bilerek yeniden DENENMEZ — çift kayıt riski.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  global: { fetch: agFetch },
})

// --- Yardımcılar (AŞAMA 2'de auth.js bunları kullanacak) ---

// Giriş yapan Supabase kullanıcısı (auth) — yoksa null
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Giriş yapan kullanıcının danismanlar kaydı (rol dahil) — yoksa null
export async function getDanisman() {
  const user = await getUser()
  if (!user?.email) return null
  const { data, error } = await supabase
    .from('danismanlar')
    .select('*')
    .eq('email', user.email)
    .maybeSingle()
  if (error) { console.error('danisman okunamadı:', error); return null }
  return rolOnizlemeUygula(data)
}

// --- Rol önizleme (yalnızca MASTER ADMIN, yalnızca test amaçlı) -----------
// Master admin arayüzü başka bir rolde ÖNİZLEYEBİLİR — herkesin ekranını
// şifre almadan test etmek için. Bu SADECE görünümü değiştirir: home
// yönlendirmesi, menü, kredi salt-okuma vb. seçilen role göre davranır.
// RLS gerçek yetkiyi SUNUCUDA korur (master'ın JWT'si değişmez), bu yüzden
// veri erişimi tam olarak o rolünkiyle eşleşmez — layout/akış testi içindir.
// Master olmayan biri localStorage'a yazsa bile burada yok sayılır.
const ONIZLENEBILIR_ROLLER = ['yonetici', 'satis_muduru', 'danisman', 'santral', 'satinalma',
  'kredi', 'muhasebe', 'bilgi_islem', 'operasyon']
function rolOnizlemeUygula(d) {
  if (!d || d.master_admin !== true) return d
  let r = null
  try { r = localStorage.getItem('ic-rol-onizleme') } catch (e) { /* yoksay */ }
  if (!r || r === 'gercek' || !ONIZLENEBILIR_ROLLER.includes(r)) return d
  // yetkiler'i de sıfırla: master'ın kişisel izin listesi kullanılırsa menü
  // o rolün gerçek varsayılanını göstermez (rol önizlemesi yanıltıcı olur).
  return { ...d, rol: r, master_admin: false, yetkiler: null, _onizleme: true }
}
