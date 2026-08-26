// =====================================================================
// yetki.js — Sayfa izinleri ve rol varsayılanları (tek kaynak)
// =====================================================================

// Çalışma alanları (modüller) — app-launcher + modül-kapsamlı sidebar.
//   Kullanıcı bir "çalışma alanı" seçer; sidebar yalnızca o modülün sayfalarını
//   gösterir (30-40 düz menü yerine). Sıra = hem workspace ekranında hem
//   app-switcher'da görünen sıra. varsayilan = modül açılınca gidilecek sayfa.
//   anaSayfa = modülün KENDİ ana sayfası. Yan menüde en üstte "Ana Sayfa"
//     olarak o görünür (Göksenil kararı, 1 Ağu 2026: "modül seçiminde CRM
//     seçili ise onun dashboard'ı, DMS seçili ise DMS panosu görünecek").
//     ⚠️ Eskiden her modülde sabit home.html linki vardı; DMS'teyken ona
//     basınca kullanıcı CRM'e atılıyor VE aktif modül kalıcı olarak CRM
//     yazılıyordu. Bu alan o hatayı kapatır.
export const MODULLER = [
  { key: 'dms',       label: 'DMS',       altbaslik: 'Araç Operasyon',    ikon: 'directions_car', varsayilan: 'arac_kabul',      anaSayfa: 'dms_panel' },
  { key: 'crm',       label: 'CRM',       altbaslik: 'Müşteri / Satış',   ikon: 'groups',         varsayilan: 'musteri_merkezi', anaSayfa: 'home' },
  // Operasyon (Göksenil, 1 Ağu 2026): operasyon müdürü + personeli kaydedildi,
  // operasyon sayfaları artık DMS'in altında değil kendi modülünde.
  { key: 'operasyon', label: 'Operasyon', altbaslik: 'Hazırlık / İş Emri', ikon: 'build',          varsayilan: 'operasyon_panel', anaSayfa: 'operasyon_panel' },
  { key: 'kredi',   label: 'Kredi',   altbaslik: 'Finansman',            ikon: 'credit_score',   varsayilan: 'kredi' },
  { key: 'sigorta', label: 'Sigorta', altbaslik: 'Poliçe / Yenileme',    ikon: 'shield',         varsayilan: 'sigorta_panel',   anaSayfa: 'sigorta_panel' },
  { key: 'yonetim', label: 'Yönetim', altbaslik: 'Panel / Raporlar',     ikon: 'monitoring',     varsayilan: 'dashboard',       anaSayfa: 'dashboard' },
]

// Yönetilen sayfalar (admin panelindeki izin kutuları bunlardan üretilir)
//   modul: sayfanın ait olduğu çalışma alanı (yan menü modüle göre filtrelenir).
//          null → modül-bağımsız (Ana Sayfa/Yenilikler her modülde üstte görünür).
//   grup: 'sigorta' → geriye dönük uyumluluk (SIGORTA_SAYFALAR türetimi).
//   hazir: false    → sayfa henüz kurulmadı, menüde gizli (yalın 404 linki olmasın).
//                     Sayfa kurulunca true yapılır. (Tanımsız = kurulu sayılır.)
export const SAYFALAR = [
  { key: 'home',         label: 'Ana Sayfa', href: 'home.html',            modul: 'crm' },
  { key: 'dashboard',    label: 'Panel',     href: 'dashboard.html',       modul: 'yonetim' },
  { key: 'musteri_merkezi', label: 'Müşteri Merkezi', href: 'musteri-merkezi.html', modul: 'crm' },
  // DMS modülünün ana sayfası (Operasyon Kontrol Merkezi) — v194'te yayında.
  { key: 'dms_panel',    label: 'DMS Paneli', href: 'dms-panel.html',      modul: 'dms' },
  { key: 'arac_kabul',   label: 'Araç Kabul', href: 'arac-kabul.html',     modul: 'dms' },
  { key: 'fiyatlama',    label: 'Fiyatlama Merkezi', href: 'fiyatlama.html', modul: 'dms' },
  { key: 'talepler',     label: 'Talepler',  href: 'talepler.html',        modul: 'crm' },
  { key: 'havuz',        label: 'Havuz',     href: 'havuz.html',           modul: 'crm' },
  { key: 'stok',         label: 'Stok Merkezi', href: 'stok.html',            modul: 'dms' },
  { key: 'siparis',      label: 'Sipariş Merkezi', href: 'siparis.html',   modul: 'crm' },
  // Satış Merkezi — teslimat onayı verilen satışlar (satis_snapshot, donmuş veri).
  // Danışman RLS ile YALNIZ kendi satışını görür; yönetici/master hepsini.
  { key: 'satis',        label: 'Satış Merkezi',   href: 'satis.html',     modul: 'dms' },
  { key: 'katilim_finans', label: 'Katılım Finans', href: 'katilim-finans.html', modul: 'crm' },
  // Kredi Hesaplama (Göksenil, 4 Ağu 2026): "satış danışmanları burayı sürekli
  // kullanacakları için (özellikle mobilde) bu simülatörü ayrı bir yerde de
  // göstermemiz gerekiyor." Danışmanın müşteri karşısında telefondan açtığı
  // kurum karşılaştırma ekranı — SALT HESAP, veri yazmaz, hassas alan yok.
  // modul:'crm' → danışmanın evi CRM çalışma alanı; kredi/muhasebe rolleri de
  // zaten 'home' üzerinden CRM alanını görüyor, yetim modül oluşmuyor.
  { key: 'kredi_hesaplama', label: 'Kredi Hesaplama', href: 'kredi-hesaplama.html', modul: 'crm' },
  { key: 'web_satis',    label: 'Web Satış', href: 'web-satis.html',       modul: 'crm' },
  { key: 'web_takas',    label: 'Takas',     href: 'web-takas.html',       modul: 'crm' },
  { key: 'web_iletisim', label: 'İletişim',  href: 'web-iletisim.html',    modul: 'crm' },
  { key: 'degerleme',    label: 'Değerleme', href: 'degerleme.html',       modul: 'dms' },
  { key: 'kredi',        label: 'Kredi Kuyruğu', href: 'kredi.html',       modul: 'kredi' },
  { key: 'kredi_rapor',  label: 'Kredi Raporu',  href: 'kredi-rapor.html', modul: 'kredi' },
  // Kredi faiz oranları — hiçbir rol varsayılanında YOK; master admin
  // işaretlediği kullanıcıya (örn. can.kaya) admin panelinden açar. RLS sql/51.
  { key: 'kredi_ayarlari', label: 'Kredi Ayarları', href: 'kredi-ayarlari.html', modul: 'kredi' },
  // Banka Parametreleri (R6) — hiçbir rol varsayılanında YOK; master admin
  // yalnız kredi yöneticisine (Can) admin panelinden açar. RLS/RPC sql/70-73.
  { key: 'kredi_parametre_yonet', label: 'Banka Parametreleri', href: 'kredi-parametre.html', modul: 'kredi' },
  // Banka Komisyon Faturaları (sql/239) — bankaların bize kestiği kredi
  // komisyonu faturaları. Can girer, finans kendi modülünden ödendi/ödenmedi
  // işaretler (köprü: komisyon-fatura-listesi / -karar).
  // ⚠️ Hiçbir rol varsayılanında YOK — kredi_ayarlari / kredi_parametre_yonet
  //   ile aynı desen: master admin yalnız kredi müdürüne açar.
  { key: 'komisyon_fatura', label: 'Banka Komisyon Faturaları', href: 'komisyon-fatura.html', modul: 'kredi' },
  // Kullandırıma Geçen İşlemler (R6-4) — yalnız kredi müdürü (Can); onay/iptal kuyruğu.
  { key: 'kredi_kullandirim_onay', label: 'Kullandırıma Geçen İşlemler', href: 'kredi-kullandirim.html', modul: 'kredi' },
  // SANAL izin (sayfa değil, yetenek): araç kartında medya yükleme/silme.
  // Menüde GÖRÜNMEZ (modul:null + sanal), admin panelinde izin kutusu olur.
  // Master admin bilgiişlem+muhasebe kişilerine verir. RLS sql/52.
  { key: 'medya_yonet', label: 'Medya Yönetimi (araç foto)', sanal: true, modul: null },
  // SANAL izin: stok araçlarının Alış KDV tagını değiştirme (muhasebe).
  // Diğer herkes SALT-OKUR. Sunucu tarafı koruma: sql/82 trg_stok_kdv_koru.
  { key: 'kdv_yonet', label: 'KDV Tagı Yönetimi (muhasebe)', sanal: true, modul: null },
  // SANAL izin: cam etiketi basma (araç kartındaki buton + stok listesindeki
  // toplu çıktı). Göksenil: "bilgi işlem personelinin görebileceği".
  // Bilgi işlem / yönetici / satış müdürü ROLÜYLE zaten görür (camEtiketiBasar);
  // bu kutu, o roller DIŞINDA birine vermek gerektiğinde kullanılır.
  { key: 'cam_etiketi', label: 'Cam Etiketi Basma (bilgi işlem)', sanal: true, modul: null },
  // --- Operasyon Merkezi (F7) ---
  // Tanımlar: lokasyon/tedarikçi/işlem türü listelerini OPERASYON MÜDÜRÜ girer
  // (bir seferlik kurulum). Sunucu tarafı koruma: sql/93 is_mudur('operasyon').
  // --- İlan Operasyon Merkezi (G3) ---
  // Göksenil: "yöneticilere İlanlarımız diye bir sayfa olacak, dashboard ve
  // diğer ekranlar bunun içinde olacak." Tek sayfa, sekmeli.
  { key: 'ilanlar', label: 'İlanlarımız', href: 'ilanlar.html', modul: 'dms' },
  // Yayın Merkezi: tüm kanallar tek yerde (sahibinden manuel · site/arabam otomatik).
  // İlanlarımız'ı KAPSAMAZ, tamamlar — sahibinden operasyonu orada kalır.
  { key: 'yayin_merkezi', label: 'Yayın Merkezi', href: 'yayin-merkezi.html', modul: 'dms' },
  // --- G4: araç kaynağı akışları (sql/109-110) ---
  // Kullanımdaki araçlar: şirketin kendi kullandığı araçlar (satışta DEĞİL).
  { key: 'kullanimdaki', label: 'Kullanımdaki Araçlar', href: 'kullanimdaki.html', modul: 'dms' },
  // İhale: kendi stoğumuzu ihaleye çıkarma (işaretle → master onayı → satış).
  { key: 'ihale', label: 'İhale', href: 'ihale.html', modul: 'dms' },
  // Cari işlem kalemleri — sipariş dosyasındaki "Cari İşlem Ekle" düğmelerini
  // besleyen katalog (tanimlar · CARI_ISLEM_TIPI). Yazma yetkisi sunucuda
  // is_master/is_yonetici/yetkili('tanimlar').
  { key: 'cari_tanimlar', label: 'Cari Kalemleri', href: 'cari-tanimlar.html', modul: 'dms' },
  { key: 'operasyon_panel', label: 'Operasyon Merkezi', href: 'operasyon.html', modul: 'operasyon' },
  { key: 'operasyon_tanimlar', label: 'Operasyon Tanımları', href: 'operasyon-tanimlar.html', modul: 'operasyon' },
  // İş sayfaları KİŞİYE ÖZEL açılır: pasta cila personeli yalnız pasta cila
  // sayfasını, kuaför personeli yalnız kuaför sayfasını görür. Hiçbir rolün
  // VARSAYILANINDA yoktur — master admin tek tek verir.
  { key: 'operasyon_pasta_cila', label: 'Pasta Cila', href: 'operasyon-pasta-cila.html', modul: 'operasyon' },
  { key: 'operasyon_kuafor', label: 'Kuaför', href: 'operasyon-kuafor.html', modul: 'operasyon' },
  // --- Sigorta modülü (aşama 36) ---
  { key: 'sigorta_panel',    label: 'Sigorta Paneli',   href: 'sigorta.html',          modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_policeler',label: 'Poliçeler',        href: 'sigorta-police.html',   modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_yapboz',   label: 'Yapbozlar',        href: 'sigorta-yapboz.html',   modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_yenileme', label: 'Yenilemeler',      href: 'sigorta-yenileme.html', modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_firsat',   label: 'Fırsatlar',        href: 'sigorta-firsat.html',   modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_dikkat',   label: 'Dikkat Listesi',   href: 'sigorta-dikkat.html',   modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_musteri',  label: 'Sigorta Müşterileri', href: 'sigorta-musteri.html', modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_rapor',    label: 'Sigorta Raporları',href: 'sigorta-rapor.html',    modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_tanimlar', label: 'Tanımlar',         href: 'sigorta-tanimlar.html', modul: 'sigorta', grup: 'sigorta', hazir: true },
  { key: 'sigorta_aktarim',  label: 'Otomatik Poliçe Kaydı', href: 'otomatik-police.html', modul: 'sigorta', grup: 'sigorta', hazir: true },
  // Şirket İadeleri (AŞAMA 2) — sigorta ekibi girer, finans (Bahadır köprüsü) öder.
  { key: 'sigorta_iade',     label: 'Şirket İadeleri',  href: 'sigorta-iade.html',     modul: 'sigorta', grup: 'sigorta', hazir: true },
]

// Sigorta modülünün tüm sayfa anahtarları (rol varsayılanları + izin kutuları için)
export const SIGORTA_SAYFALAR = SAYFALAR.filter(s => s.grup === 'sigorta').map(s => s.key)

// Rol varsayılan sayfaları (kişinin yetkiler'i boşsa bunlar geçerli)
// ⚠️ ROL_VARSAYILAN yalnız `yetkiler` BOŞ olan kullanıcıya uygulanır
// (etkinSayfalar: yetkiler doluysa ROL_VARSAYILAN hiç okunmaz). Ölçüldü
// 31 Tem 2026: 20 aktif kullanıcının 20'sinin de özel listesi var → buraya
// sayfa eklemek MEVCUT kimseye menü açmaz, yalnız YENİ kullanıcıya ve admin
// panelindeki "rol şablonu" düğmesine yarar. Mevcut kişilere açmak için
// admin panelinden tek tek verilir.
export const ROL_VARSAYILAN = {
  yonetici: ['home', 'dashboard', 'musteri_merkezi', 'arac_kabul', 'fiyatlama', 'talepler', 'havuz', 'stok', 'siparis', 'satis', 'katilim_finans', 'kredi_hesaplama', 'web_satis', 'web_takas', 'web_iletisim', 'degerleme', 'kredi', 'kredi_rapor', 'ilanlar', 'ihale', 'kullanimdaki', 'yayin_merkezi'],
  // kredi: satış danışmanı kredi kuyruğunu SALT-OKUMA görür (kendi
  // dosyalarını RLS ile; "üzerine al"/düzenleme gizli — bkz. kredi.js saltOkur).
  danisman: ['home', 'havuz', 'talepler', 'musteri_merkezi', 'stok', 'siparis', 'satis', 'katilim_finans', 'kredi', 'kredi_hesaplama'],
  santral:  ['home', 'talepler', 'musteri_merkezi', 'havuz', 'stok'],
  satinalma: ['web_satis', 'arac_kabul', 'musteri_merkezi', 'stok', 'ihale'],
  // Kredi birimi: kuyruk + stok + kendi raporlari (arac tanitmaz, talep gormez)
  kredi:     ['home', 'kredi', 'kredi_rapor', 'kredi_hesaplama', 'stok'],
  // Bilgi İşlem (sql/83): araç kabul + veri/medya girişi. Şirket maili olmayabilir
  // → şifreli giriş (login.html). Müşteri/talep akışına girmez.
  bilgi_islem: ['home', 'arac_kabul', 'stok', 'musteri_merkezi', 'degerleme', 'ilanlar', 'ihale', 'kullanimdaki', 'yayin_merkezi'],
  // Operasyon (sql/83): sanayi / hazırlık / pasta-cila takibi. Kendi modülü
  // henüz kurulmadı — şimdilik stok + araç kabul üzerinden çalışır.
  // Operasyon: iş sayfaları (pasta cila / kuaför) BURADA YOK — kişiye özel
  // verilir, herkes yalnız kendi işini görsün (Göksenil kararı).
  operasyon:   ['home', 'stok', 'arac_kabul', 'operasyon_panel', 'operasyon_tanimlar', 'ihale'],
  // Satış Müdürü (sql/84 · .ai/18): satış ekibinin gördüğü her şey + sipariş
  // iptali, danışman değiştirme, min fiyat altı onayı, kapora iadesi kararı.
  // Bu üçü sayfa değil EYLEM yetkisi — sunucuda is_satis_muduru() korur.
  satis_muduru: ['home', 'dashboard', 'musteri_merkezi', 'talepler', 'havuz', 'stok',
    'siparis', 'satis', 'katilim_finans', 'kredi', 'kredi_hesaplama', 'degerleme', 'arac_kabul', 'fiyatlama', 'ihale', 'kullanimdaki'],
  // Muhasebe (sql/84 · .ai/18): KDV tagı, cari mutabakat, satış/sipariş okuma.
  // KDV yazma yetkisi ROLE bağlı (is_kdv_yetkili) — ayrı izin kutusu gerekmez.
  muhasebe:    ['home', 'stok', 'siparis', 'satis', 'katilim_finans', 'kredi_hesaplama', 'kullanimdaki'],
  // Sigorta birimi (2 kişi): yetkili her şeyi + Tanımlar'ı düzenler; personel
  // günlük işlemleri yapar, Tanımlar'ı SALT-OKUR görür (kilit sayfada + RLS'te).
  // İkisi de tüm sigorta sayfalarını + stok'u görür.
  sigorta_yetkili:  [...SIGORTA_SAYFALAR, 'stok'],
  sigorta_personel: [...SIGORTA_SAYFALAR, 'stok'],
}

// Rol → departman (BR-0214 birim yöneticileriyle eşleşir).
// Audit "departman" alanı (F6), KPI birim filtresi (F5) ve bildirim hedef
// kitlesi (F4) BU haritadan okur — üç yerde ayrı liste tutma.
export const ROL_DEPARTMAN = {
  yonetici: 'yonetim',
  satis_muduru: 'satis',      // Samet Bey
  danisman: 'satis',
  satinalma: 'satinalma',
  operasyon: 'operasyon',
  kredi: 'kredi',             // Can Bey
  sigorta_yetkili: 'sigorta', // Didem Hanım
  sigorta_personel: 'sigorta',
  muhasebe: 'finans',         // Bahadır Bey
  bilgi_islem: 'bilgi_islem', // Göksenil (aynı zamanda master admin)
  santral: 'danisma',
}
export const DEPARTMAN_ETIKET = {
  yonetim: 'Yönetim', satis: 'Satış', satinalma: 'Satın Alma', operasyon: 'Operasyon',
  kredi: 'Kredi', sigorta: 'Sigorta', finans: 'Finans / Muhasebe',
  bilgi_islem: 'Bilgi İşlem', danisma: 'Danışma',
}
export const departmani = d => ROL_DEPARTMAN[d?.rol] || 'yonetim'

// --- Müdürlük (sql/85) ---
// Müdürlük bir ROL DEĞİL, rolün üstüne binen ayrı boyut: Samet 'yonetici'
// kalır + satış müdürü olur; Can 'kredi' kalır + kredi müdürü olur.
// Atanabilir birimler danismanlar_mudur_birim_chk ile birebir.
export const MUDUR_BIRIMLERI = ['satis', 'finans', 'kredi', 'sigorta', 'operasyon', 'satinalma', 'bilgi_islem']
// Bu kişi (o birimin) müdürü mü? Yönetici/master ÜSTTEN kapsar — onay/karar için.
// ⚠️ Bildirim HEDEFİ için bunu kullanma; sunucudaki birim_mudurleri(birim)
// tam olarak o kişiyi verir (yoksa 4 yöneticiye birden bildirim gider).
export const mudurMu = (d, birim = null) => !!(d && (d.master_admin || d.rol === 'yonetici' ||
  (d.mudur_birim && (!birim || d.mudur_birim === birim))))
// Satış Müdürü eylem yetkisi (sunucudaki karşılığı: is_satis_muduru())
// ⚠️ `rol === 'yonetici'` KALDIRILDI (Göksenil, 19 Ağu 2026: "sadece satış
//    müdürü onaylasın"). O blanket koşul yüzünden FİNANS müdürü de min fiyat
//    altı satışı onaylayabiliyordu. Kalanlar: master admin (Göksenil, İsmail)
//    ve satış birimi müdürü (Samet) — sql/228 ile birebir aynı.
// ⚠️ Bu yalnız GÖRÜNÜRLÜK. Asıl kapı sunucuda is_satis_muduru(); ikisi
//    ayrışırsa sunucu kazanır ve kullanıcı düğmeyi görüp hata alır — o yüzden
//    biri değişince ÖBÜRÜ DE değişmeli.
export const satisMuduruMu = d => !!(d && (d.master_admin ||
  d.rol === 'satis_muduru' || d.mudur_birim === 'satis'))

// Cam etiketi basabilir mi? (araç kartındaki buton + stok toplu çıktı)
// Göksenil kararı: bilgi işlem + yönetim görsün, 14 danışman GÖRMESİN.
// ⚠️ Bu bir GÖRÜNÜRLÜK kapısı, güvenlik sınırı DEĞİL: etiketteki alanların
// hepsi zaten stok/araç kartında aynı kişilere açık. Asıl koruma sunucuda:
// fiyat v_arac_min_fiyat'tan okunur ve o view kendi kapısını taşır (sql/99).
// Doğrulandı: view'ın kapısı bilgi_islem/yonetici/satis_muduru/mudur_birim'i
// geçiriyor → bu roller için etiket FİYATLI çıkar. Kapıdan geçmeyen biri
// butonu bir şekilde açsa bile fiyat alanı "—" basar.
// Araç satış fiyatını değiştirebilir mi?
// Göksenil kararı: "aracın satış fiyatını İsmail Bey veya bilgi işlem,
// master admin değiştirebilir." Bahadır Bey ve Samet Bey YAZAMAZ (okur).
// ⚠️ Sunucudaki is_fiyat_yetkili() ile AYNI küme olmalı (sql/100). İki yerde
// ayrışırsa buton görünür ama insert 0 satır yazar ve kullanıcı sebebini
// anlamaz. Rol battaniyesi (yonetici) BİLEREK yok — dört yönetici var.
export const fiyatYonetir = d => !!(d && (d.master_admin ||
  d.rol === 'bilgi_islem' ||
  (Array.isArray(d.yetkiler) && d.yetkiler.includes('fiyat_yonet'))))

// İlan yayınlayabilir / yönetebilir mi?
// Göksenil: "ilanları bilgi işlem birimi yayınlıyor, ama kontrolü
// yöneticilerde olmalı."
// ⚠️ Sunucudaki is_ilan_yetkili() ile AYNI küme (sql/103). Ayrışırsa buton
// görünür ama insert 0 satır yazar ve kullanıcı sebebini anlamaz.
export const ilanYonetir = d => !!(d && (d.master_admin ||
  ['bilgi_islem', 'yonetici'].includes(d.rol) ||
  (Array.isArray(d.yetkiler) && d.yetkiler.includes('ilan_yonet'))))

// İlan görseli KAMPANYA AYARLARI — Göksenil: "hem Can yönetebilecek hem de
// master admin." Can Kaya rol='kredi' + mudur_birim='kredi'; yönetici DEĞİL.
// ⚠️ Sunucudaki is_kampanya_yetkili() ile AYNI küme (sql/107).
export const kampanyaYonetir = d => !!(d && (d.master_admin || d.mudur_birim === 'kredi'))

// --- G4 yetkileri ---
// ⚠️ Her biri sunucudaki karşılığıyla AYNI küme olmak zorunda. Ayrışırsa düğme
// görünür ama çağrı "yetkiniz yok" der ve kullanıcı sebebini anlamaz.
// kullanimYonetir  ↔ is_kullanim_yetkili()  (sql/109)
export const kullanimYonetir = d => !!(d && (d.master_admin || d.rol === 'bilgi_islem'))
// ihaleIsaretler   ↔ is_fiyat_yetkili() or is_master_admin()  (sql/110)
//   Not: fiyatYonetir zaten is_fiyat_yetkili()'nin aynadaki hâli.
export const ihaleIsaretler = d => !!(d && (d.master_admin || fiyatYonetir(d)))
// ihaleOnaylar     ↔ is_master_admin()  — Göksenil: "sorgu bana dönsün"
export const ihaleOnaylar = d => !!(d && d.master_admin)
// ihaleTakipEder   ↔ is_ihale_takip_yetkili()  (sql/110)
export const ihaleTakipEder = d => !!(d && (d.master_admin ||
  ['satinalma', 'operasyon', 'bilgi_islem', 'yonetici'].includes(d.rol)))
// ihaleSatisiKaydeder ↔ is_ihale_satis_yetkili()  (sql/242)
//   ⚠️ is_kullanim_yetkili() DEĞİL. O fonksiyon şirket kullanımındaki araç
//   tahsisini de tutuyor (kullanimdaki_tahsis_et / kullanimdaki_stoga_al);
//   ihale için genişletilseydi istenmeyen ikinci bir yetki açılırdı.
//   Paneli fiilen satın alma birimi kullanıyor (Göksenil, 25 Ağu 2026).
export const ihaleSatisiKaydeder = d => !!(d && (d.master_admin ||
  ['bilgi_islem', 'satinalma'].includes(d.rol)))

// Evrak Talebi iş takibini görür mü? (Ana Sayfa özet kartı + pop-up ve
// İlanlarımız → "Evrak Talepleri" sekmesi)
// Göksenil: "sadece bilgi işlem personelinin görebileceği bir alan."
// Yönetici/master üstten kapsar (14 danışman GÖRMEZ).
// ⚠️ Bu bir GÖRÜNÜRLÜK kapısı, güvenlik sınırı DEĞİL: asıl koruma
// v_evrak_takip'in RLS'i + evrak_takip_isaretle RPC'sinin kendi kapısı.
// Kümeler ayrışırsa sekme görünür ama liste boş / işaretleme 0 satır yazar.
export const evrakTakipEder = d => !!(d && (d.master_admin ||
  ['bilgi_islem', 'yonetici'].includes(d.rol)))

export const camEtiketiBasar = d => !!(d && (d.master_admin ||
  ['bilgi_islem', 'yonetici', 'satis_muduru'].includes(d.rol) ||
  d.mudur_birim === 'satis' ||
  (Array.isArray(d.yetkiler) && d.yetkiler.includes('cam_etiketi'))))

// Yönetici de sigorta panel + raporlarını görsün (salt-okuma; RLS ile).
ROL_VARSAYILAN.yonetici = [...ROL_VARSAYILAN.yonetici,
  'sigorta_panel', 'sigorta_policeler', 'sigorta_yapboz', 'sigorta_yenileme',
  'sigorta_firsat', 'sigorta_dikkat', 'sigorta_musteri', 'sigorta_rapor', 'sigorta_tanimlar',
  'sigorta_aktarim']

// DMS modülüne erişen roller (stok görenler) DMS Paneli'ni de görür — modülün ana sayfası.
for (const r of Object.keys(ROL_VARSAYILAN)) {
  if (ROL_VARSAYILAN[r].includes('stok') && !ROL_VARSAYILAN[r].includes('dms_panel')) {
    ROL_VARSAYILAN[r] = ['dms_panel', ...ROL_VARSAYILAN[r]]
  }
}

// Rolün açılışta düşeceği çalışma alanı (birden çok modüle erişse de "evi").
// Kişinin o modüle erişimi yoksa erişebildiği ilk modüle düşülür (varsayilanModul).
export const ROL_VARSAYILAN_MODUL = {
  yonetici: 'yonetim', danisman: 'crm', santral: 'crm',
  satinalma: 'dms', kredi: 'kredi',
  operasyon: 'operasyon',
  sigorta_yetkili: 'sigorta', sigorta_personel: 'sigorta',
}

// Aktif modül hafızası (MPA'da sayfa yüklemeleri arası bağlam)
export const AKTIF_MODUL_KEY = 'ic-aktif-modul'
export function aktifModulOku() {
  try { return localStorage.getItem(AKTIF_MODUL_KEY) } catch (e) { return null }
}
export function aktifModulYaz(key) {
  try { if (key) localStorage.setItem(AKTIF_MODUL_KEY, key) } catch (e) { /* yoksay */ }
}

// Kişinin etkin sayfa anahtarları
export function etkinSayfalar(d) {
  if (!d) return []
  if (d.master_admin) return SAYFALAR.map(s => s.key)
  const acik = Array.isArray(d.yetkiler) && d.yetkiler.length
    ? d.yetkiler
    : (ROL_VARSAYILAN[d.rol] || [])
  return acik
}

export function sayfaErisebilir(d, key) {
  if (!d) return false
  if (d.master_admin) return true
  return etkinSayfalar(d).includes(key)
}

// --- Menü yerleşimi override'ı -----------------------------------------
// ayarlar.menu_yerlesim'den yüklenir (auth.js → requireAuth). Koddaki `modul`
// alanı VARSAYILANDIR; buradaki override onu ezer. Okunamazsa varsayılan geçerli.
//   şekil: { sayfaKey: { modul: 'crm', sira: 20 }, ... }
let _yerlesim = null
export function menuYerlesimUygula(map) {
  _yerlesim = (map && typeof map === 'object') ? map : null
}
// Bir sayfanın ETKİN modülü / sırası (override → yoksa varsayılan)
function etkinModul(s) { return _yerlesim?.[s.key]?.modul ?? s.modul }
function etkinSira(s, i) {
  const v = _yerlesim?.[s.key]?.sira
  return (v == null) ? (i + 1) * 10 : v
}
// Admin ekranı için: etkin (varsayılan + override birleşik) yerleşim listesi.
// Modül-bağımsız sayfalar (Ana Sayfa/Yenilikler) hariç.
export function menuYerlesimAl() {
  return SAYFALAR
    .map((s, i) => ({ key: s.key, label: s.label, modul: etkinModul(s), sira: etkinSira(s, i) }))
    .filter(x => x.modul)
}

// --- Modül (çalışma alanı) yardımcıları --------------------------------

// Bir modülde kişinin erişebildiği, kurulu sayfalar (etkin sıraya göre)
export function modulSayfalari(d, modulKey) {
  const keys = etkinSayfalar(d)
  const master = d?.master_admin
  return SAYFALAR
    .map((s, i) => [s, i])
    .filter(([s]) => etkinModul(s) === modulKey && s.hazir !== false && (master || keys.includes(s.key)))
    .sort((a, b) => etkinSira(a[0], a[1]) - etkinSira(b[0], b[1]))
    .map(([s]) => s)
}

// Kişinin erişebildiği modüller (en az bir sayfası olanlar), MODULLER sırasında
export function etkinModuller(d) {
  if (!d) return []
  return MODULLER.filter(m => modulSayfalari(d, m.key).length > 0)
}

// href → ait olduğu modül anahtarı (admin.html → yönetim; modül-bağımsızlar → null)
export function sayfaModul(href) {
  if (href === 'admin.html') return 'yonetim'
  const s = SAYFALAR.find(x => x.href === href)
  return s ? etkinModul(s) : null
}

// Kişinin açılışta düşeceği modül (rol tercihi → yoksa erişebildiği ilk modül)
export function varsayilanModul(d) {
  const moduller = etkinModuller(d)
  if (!moduller.length) return null
  const tercih = d.master_admin ? 'yonetim' : ROL_VARSAYILAN_MODUL[d.rol]
  return (moduller.find(m => m.key === tercih) || moduller[0]).key
}

// Modülün KENDİ ana sayfası (erişilebiliyorsa). Yan menünün en üstündeki
// "Ana Sayfa" bağlantısı ve modüle giriş hedefi bunu kullanır.
export function modulAnaSayfa(d, modulKey) {
  const m = MODULLER.find(x => x.key === modulKey)
  if (!m || !m.anaSayfa) return null
  return modulSayfalari(d, modulKey).find(s => s.key === m.anaSayfa) || null
}

// Bir modüle girince açılacak sayfa (ilk giriş/açılış için — kişisel odaklı).
// Yönetim → Panel; kişisel Ana Sayfa erişilebiliyorsa diğer modüllerde o tercih edilir.
export function modulHedefHref(d, modulKey) {
  const sayfalar = modulSayfalari(d, modulKey)
  if (!sayfalar.length) return sayfaErisebilir(d, 'home') ? 'home.html' : 'index.html'
  // ⚠️ Eskiden burada "yönetim değilse home.html" vardı: DMS'i seçtiğinde bile
  // CRM ana sayfası açılıyordu. Artık modülün KENDİ ana sayfası açılır.
  const ana = modulAnaSayfa(d, modulKey)
  if (ana) return ana.href
  const m = MODULLER.find(x => x.key === modulKey)
  const v = m && sayfalar.find(s => s.key === m.varsayilan)
  return (v || sayfalar[0]).href
}

// Girişten sonra gidilecek ilk sayfa (modül bazlı):
//   - hiç modül yoksa → home varsa home, yoksa router
//   - tek modül / hatırlanan modül → o modülün hedefi
//   - çok modül + hatırlanan yok → workspace seçim ekranı ("bir kere seç")
export function ilkSayfaHref(d) {
  if (!d) return 'index.html'
  const moduller = etkinModuller(d)
  if (!moduller.length) return sayfaErisebilir(d, 'home') ? 'home.html' : 'index.html'

  const hatirlanan = aktifModulOku()
  let aktif = moduller.find(m => m.key === hatirlanan)?.key
  if (!aktif && moduller.length === 1) aktif = moduller[0].key
  if (!aktif) return 'workspace.html'   // çok modül, seçim bekleniyor

  aktifModulYaz(aktif)
  return modulHedefHref(d, aktif)
}

export function sayfaHref(key) {
  return SAYFALAR.find(s => s.key === key)?.href
}
export function sayfaLabel(key) {
  return SAYFALAR.find(s => s.key === key)?.label || key
}

// --- Operasyon işi görünürlüğü (main dalından, sql/93 karşılığı) ---------
// ⚠️ Sunucudaki kuralla AYNI olmalı; ayrışırsa bölüm görünür ama sorgu boş
//    döner ve kullanıcı sebebini anlamaz.
export const operasyonIsiGorur = d => !!(d && (d.master_admin ||
  ['operasyon', 'yonetici', 'muhasebe'].includes(d.rol) ||
  ['operasyon', 'finans'].includes(d.mudur_birim)))

// İş emri açabilir mi? Sunucudaki is_emri_yaz karşılığı (sql/93).
export const operasyonIsiYazar = d => !!(d && (d.master_admin ||
  d.rol === 'operasyon' || d.rol === 'yonetici' || d.mudur_birim === 'operasyon'))
