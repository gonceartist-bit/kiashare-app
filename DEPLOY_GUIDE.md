# KiaShare - HTTP-Based File Transfer

## نسخه جدید: بدون WebRTC، با HTTP Upload/Download

### مشکل نسخه قبلی
- WebRTC نیاز به Signaling Server داشت (PeerJS)
- PeerJS Cloud ناپایدار و اغلب مسدود است
- WebRTC در Hotspot/موبایل مشکل‌دار است

### راه‌حل جدید
- **آپلود** فایل به Cloudflare R2 (Storage) از طریق HTTP
- **دانلود** فایل با کد ۴ رقمی
- **بدون نیاز** به WebRTC یا PeerJS

---

## فایل‌ها

### 1. worker.js (Cloudflare Worker Backend)
- Deploy روی Cloudflare Workers
- نیاز به KV و R2 binding دارد

### 2. app.js (Frontend)
- جایگزین فایل قبلی
- از fetch API استفاده می‌کند
- بدون PeerJS

### 3. index.html (Frontend)
- جایگزین فایل قبلی
- بدون CDN لایبرری

---

## نصب و راه‌اندازی

### مرحله ۱: ساخت Cloudflare Worker

1. به [Cloudflare Dashboard](https://dash.cloudflare.com) برو
2. Workers & Pages → Create a Service
3. نام: `kiashare-api`
4. کد `worker.js` را paste کن
5. Deploy

### مرحله ۲: اضافه کردن KV Namespace

1. Workers & Pages → KV
2. Create a namespace → نام: `KIASHARE_KV`
3. در Worker → Settings → Variables → KV Namespace Bindings
4. Variable name: `KIASHARE_KV` → Namespace: انتخاب کن

### مرحله ۳: اضافه کردن R2 Bucket

1. R2 → Create bucket → نام: `kiashare-uploads`
2. در Worker → Settings → Variables → R2 Bucket Bindings
3. Variable name: `KIASHARE_R2` → Bucket: انتخاب کن

### مرحله ۴: تنظیم CORS (در Worker)

```javascript
// در worker.js خط اول:
const ALLOWED_ORIGINS = ['https://kiashare-app.your-subdomain.workers.dev', 'https://your-domain.com'];
```

### مرحله ۵: Deploy Frontend

1. فایل‌های `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, `icon-*.png` را در یک Worker دیگر یا Pages deploy کن
2. یا از همان Worker با Static Assets استفاده کن

---

## نکات مهم

### محدودیت‌ها
- فایل‌ها ۱۰ دقیقه بعد منقضی می‌شوند
- حداکثر سایز فایل: ۱۰۰ MB (بسته به R2 limits)
- نیاز به اینترنت برای هر دو دستگاه

### امنیت
- کد ۴ رقمی تصادفی
- فایل‌ها بعد از دانلود حذف می‌شوند
- R2 private bucket استفاده کنید

### بهینه‌سازی
- Chunk size: 256KB (قابل تنظیم)
- Parallel upload: می‌توان اضافه کرد
- Compression: می‌توان اضافه کرد

---

## تست

1. فرستنده: فایل انتخاب کن → کد ۴ رقمی دریافت کن
2. گیرنده: کد را وارد کن → دانلود شروع شود
3. یا: لینک QR را مستقیم باز کن

---

## تفاوت با SHAREit

| ویژگی | SHAREit | KiaShare HTTP |
|-------|---------|---------------|
| نیاز به اینترنت | ❌ خیر | ✅ بله |
| سرعت | WiFi Direct | محدود به اینترنت |
| قابلیت اطمینان | ✅ بالا | ✅ بالا |
| سازگاری | نیاز به اپ | مرورگر کافی |
| راه‌اندازی | پیچیده | ساده |

---

## آینده

برای "بدون اینترنت" واقعی:
- WebRTC با سرور Signaling اختصاصی (PartyKit/Durable Objects)
- WiFi Direct API (Chrome OS/Android only)
- Bluetooth File Transfer (Web Bluetooth API)
