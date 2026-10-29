# Security Fixes — Vibe Check Audit

> Ngày thực hiện: 2026-10-29
> Dự án: WDP301 — Cổ Phục (Next.js 15 + NestJS + Supabase)

---

## ✅ 1. Leaked API Key trong `.env.example`

**File:** `frontend/.env.example`
**Vấn đề:** Key `DECART_API_KEY=dct_...` thật bị commit vào repo (có thể lộ trên GitHub).
**Đã xử lý:** Người dùng xóa key thật, thay bằng placeholder `DECART_API_KEY=your_decart_api_key_here`.

---

## ✅ 2. SSRF qua Image Optimization Wildcard

**File:** `frontend/next.config.js`
**Vấn đề:** `remotePatterns` có 2 entry `hostname: "**"` (cả `https` lẫn `http`) — cho phép proxy **bất kỳ URL nào** qua `/_next/image`, có thể dùng để dò internal network (SSRF).
**Đã sửa:**
- Xóa toàn bộ wildcard `**`
- Thay bằng allowlist chặt, chỉ gồm các domain đã biết:
  - `**.supabase.co`, `res.cloudinary.com`, `dep.com.vn`, `cophuchoangthanhhue.com`
  - `images.unsplash.com`, `**.replicate.delivery`, `pbxt.replicate.delivery`
  - `lh3.googleusercontent.com`, `encrypted-tbn0.gstatic.com`
  - `bizweb.dktcdn.net`, `img.lazcdn.com`, `overabridal.com`, `lamia.com.vn`
  - `media-cdn-v2.laodong.vn`, `aodaitailoc.com`
- Thêm `poweredByHeader: false` — tắt header `X-Powered-By: Next.js`

---

## ✅ 3. Thiếu Security Headers (Frontend)

**File:** `frontend/next.config.js`
**Vấn đề:** Không có security headers — app dễ bị clickjacking, MIME-sniffing, leaking referrer.
**Đã thêm** (áp dụng cho tất cả routes `/(.*)`):

| Header | Giá trị |
|--------|---------|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(self)` |
| `Content-Security-Policy-Report-Only` | Baseline CSP (monitor mode) |

> **Bước tiếp theo (thủ công):** Sau khi xác nhận CSP-Report-Only không báo vi phạm, đổi key thành `Content-Security-Policy` để enforce.

---

## ✅ 4. Giả mạo JWT — Unverified Token Decoding

**File:** `frontend/src/app/api/decart/token/route.ts`
**Vấn đề:** Route decode JWT payload bằng `Buffer.from(base64, "base64")` mà **không verify chữ ký** — attacker tạo JWT giả với bất kỳ `userId` nào để lấy Decart token và tạo voucher giảm giá vô tận.
**Đã sửa:** Thay bằng hàm `authenticate()` gọi `GET /api/auth/me` của NestJS backend để xác thực JWT signature đúng chuẩn. Thêm kiểm tra `isActive === true` để chặn tài khoản bị khóa. Fail-closed: trả 503 khi auth service không phản hồi (không pass-through).

---

## ✅ 5. Thiếu Rate Limiting trên Auth Endpoints

**Files:**
- `backend/src/app.module.ts`
- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/ai/ai.module.ts`

**Vấn đề:** Không có rate limiting — brute-force mật khẩu, spam OTP/email, enumerate tài khoản.
**Đã sửa:**
- Đăng ký `ThrottlerModule` toàn cục trong `AppModule` (60 req/phút mặc định)
- Đăng ký `ThrottlerGuard` là `APP_GUARD` — bảo vệ toàn bộ API
- Auth endpoints (`login`, `register`, `verify-email`, `resend-otp`, `forgot-password`, `reset-password`, `google`) giới hạn **5 requests/phút/IP**
- Xóa `ThrottlerModule.forRoot()` trùng lặp trong `AiModule`

---

## ✅ 6. Thiếu Security Headers (Backend)

**File:** `backend/src/main.ts`
**Vấn đề:** NestJS API không có security headers.
**Đã sửa:** Cài và tích hợp `helmet` middleware:
- Tự động thêm: `X-Content-Type-Options`, `X-Frame-Options`, `X-DNS-Prefetch-Control`, `Referrer-Policy`, v.v.
- HSTS tự động bật ở `NODE_ENV=production`, tắt ở dev
- CSP bị tắt ở backend (API trả JSON, không phục vụ HTML)

---

## 📋 Còn lại cần theo dõi (không cần code)

| Mục | Hành động |
|-----|-----------|
| CSP-Report-Only | Theo dõi vi phạm sau deploy, rồi đổi sang `Content-Security-Policy` để enforce |
| Supabase RLS | Kiểm tra policy các table `vouchers`, `bookings` — chỉ cho phép `auth.uid()` tương ứng |
| `FRONTEND_URL` env | Đảm bảo set đúng domain production trong `.env` backend trước khi deploy |
| Key rotation | Key Decart đã bị leak cần revoke trên Decart dashboard và tạo key mới |
