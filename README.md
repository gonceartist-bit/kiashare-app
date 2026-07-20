# KiaShare - انتقال فایل بین دستگاه‌ها

یک اپلیکیشن وب ساده برای انتقال فایل بین موبایل و کامپیوتر بدون نیاز به نصب برنامه.

## 🚀 نحوه کار

1. **فرستنده**: فایل را انتخاب می‌کند و یک کد ۴ رقمی دریافت می‌کند
2. **گیرنده**: کد را وارد می‌کند و فایل را دانلود می‌کند

## 📁 ساختار پوشه

```
kiashare-app/
├── index.html          # رابط کاربری (Frontend)
├── app.js              # منطق برنامه (Frontend)
├── style.css           # استایل‌ها
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (offline support)
├── icon-192.png        # آیکون PWA
├── icon-512.png        # آیکون PWA
├── worker.js           # بک‌اند Cloudflare Worker
└── DEPLOY_GUIDE.md     # راهنمای نصب
```

## 🛠️ نصب و راه‌اندازی

### پیش‌نیازها
- حساب Cloudflare (رایگان)

### مراحل نصب

#### ۱. بک‌اند (Cloudflare Worker)
1. به [Cloudflare Dashboard](https://dash.cloudflare.com) بروید
2. Workers & Pages → Create a Worker
3. نام: `kiashare-api`
4. کد `worker.js` را کپی و Paste کنید
5. Deploy

#### ۲. KV Namespace
1. Workers & Pages → KV
2. Create a namespace → نام: `KIASHARE_KV`
3. در Worker → Settings → Variables → KV Namespace Bindings
4. Variable name: `KIASHARE_KV` → Namespace را انتخاب کنید

#### ۳. R2 Bucket
1. R2 → Create bucket → نام: `kiashare-uploads`
2. در Worker → Settings → Variables → R2 Bucket Bindings
3. Variable name: `KIASHARE_R2` → Bucket را انتخاب کنید

#### ۴. فرانت‌اند (Cloudflare Pages)
1. Workers & Pages → Pages
2. Create a project → Upload assets
3. فایل‌های `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, `icon-*.png` را آپلود کنید
4. Deploy

### ۵. تنظیم CORS
در `worker.js` خط اول، دامنه Pages خود را اضافه کنید:
```javascript
const ALLOWED_ORIGINS = ['https://your-app.pages.dev'];
```

## ⚠️ محدودیت‌ها
- فایل‌ها ۱۰ دقیقه بعد منقضی می‌شوند
- حداکثر سایز فایل: ۱۰۰ MB
- نیاز به اینترنت برای هر دو دستگاه

## 📝 توضیحات فنی
- بک‌اند: Cloudflare Worker + KV + R2
- فرانت‌اند: Vanilla JavaScript (بدون فریم‌ورک)
- بدون نیاز به WebRTC یا PeerJS
- آپلود به صورت chunk (تکه‌تکه) برای فایل‌های بزرگ

## 📄 لایسنس
MIT
