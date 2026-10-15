# Kardeşler Ligi

Yusuf, Yunus ve Yalçın için özel lig sitesi: puan tablosu, maçlar, gol ve asist krallığı.

## Teknoloji
- Node.js (18+) + Express, SQLite (`better-sqlite3`) ile kalıcı veri
- Giriş: bcrypt ile şifrelenmiş parola + `httpOnly` çerezde JWT
- Arayüz: `public/` altında saf HTML/CSS/JS (Türkçe, mobil uyumlu)

## Kurulum
1. `npm install`
2. `.env.example` dosyasını `.env` olarak kopyala ve doldur:
   - `JWT_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `INITIAL_PASSWORD_YUSUF`, `INITIAL_PASSWORD_YUNUS`, `INITIAL_PASSWORD_YALCIN` (en az 8 karakter)
3. `npm start` → http://localhost:3000
4. Kullanıcı adları: `yusuf` (yönetici), `yunus`, `yalcin`.

İlk çalıştırmada hesaplar oluşturulur. Sonrasında şifreleri **Yönetim → Şifre sıfırla** bölümünden değiştirebilirsin; `.env` içindeki başlangıç şifreleri bir daha kullanılmaz.

## Nasıl çalışır
- Yetki kontrolü sunucuda yapılır: maç ekleme/düzenleme/silme, lig ayarı ve şifre sıfırlama yalnızca yöneticiye açıktır. Normal kullanıcılar sadece görüntüler.
- Skor, puan, averaj, gol ve asist sayıları yalnızca `matches` ve `goals` tablolarından hesaplanır; ayrıca saklanmaz.
- Veri modeli `leagues` tablosu üzerinden çoklu lige hazırdır (şu an tek lig kullanılır).
- Gol kaydında takım (ev sahibi/deplasman), gol atan ve isteğe bağlı asist seçilir.

## Yayına alma
`NODE_ENV=production` ve HTTPS kullan (çerez o zaman `secure` olur). `data/` klasörünü yedekle; GitHub'a gönderilmez.

Render/Railway gibi servislerde `TRUST_PROXY=1` ekle. Dosya sistemi kalıcı değilse (ücretsiz planlarda sık olur) SQLite verisi yeniden dağıtımda silinir; kalıcı disk (volume) bağla ve `DB_PATH`'i oraya ver.

## Bilinen sınırlamalar
- Şu an tek lig ve yalnızca iki kişilik (bire bir) maçlar var.
- Kullanıcı ekleme/silme arayüzü yok; yeni hesap için `server.js` içindeki ilk kurulum listesine ekleme gerekir.
- Giriş denemesi sınırı bellekte tutulur, sunucu yeniden başlayınca sıfırlanır.
- Otomatik test yok.
