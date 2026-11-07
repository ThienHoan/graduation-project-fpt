# Tài Liệu Kiến Trúc & Nghiệp Vụ Module Auth (Co Phuc Rental ERP)

Module **Auth** chịu trách nhiệm toàn bộ vòng đời xác thực, bảo mật tài khoản, phân quyền RBAC và kiểm soát truy cập trong hệ thống Co Phuc Rental ERP.

---

## 1. Cấu trúc Thư Mục & Phân Tách Trách Nhiệm

```text
backend/src/modules/auth/
├── controllers/
│   └── auth.controller.ts              # Định tuyến REST API và giới hạn Rate-limit (@Throttle)
├── services/
│   ├── auth-token.service.ts           # Quản lý phát hành JWT, decode và Server-side Token Blacklist
│   ├── auth-lockout.service.ts         # Chống tấn công Brute-force & Account Lockout Policy
│   ├── auth-otp.service.ts             # Quản lý sinh mã OTP, giới hạn số lần nhập sai, cooldown gửi lại
│   ├── auth-password.service.ts        # Chính sách độ mạnh mật khẩu, băm Bcrypt 12 rounds, so khớp
│   ├── auth-audit.service.ts           # Ghi nhận sự kiện bảo mật vào bảng AuditLog có sẵn
│   └── auth.service.ts                 # Điều phối nghiệp vụ đăng ký, đăng nhập, đổi mật khẩu
├── guards/
│   ├── jwt-auth.guard.ts               # Kiểm tra Bearer JWT, Blacklist check, grace window token
│   ├── optional-jwt-auth.guard.ts      # Xác thực không bắt buộc cho các route công khai
│   └── roles.guard.ts                  # Phân quyền dựa trên AppRole (customer, staff, manager_owner, admin)
├── decorators/
│   ├── current-user.decorator.ts       # Trích xuất user đã xác thực từ Request
│   └── roles.decorator.ts              # Gắn metadata vai trò cho endpoints
├── dto/
│   ├── login.dto.ts
│   ├── register.dto.ts
│   ├── google-login.dto.ts
│   ├── verify-email.dto.ts
│   ├── resend-otp.dto.ts
│   ├── forgot-password.dto.ts
│   ├── reset-password.dto.ts
│   └── change-password.dto.ts          # DTO đổi mật khẩu mới
└── utils/
    └── client-info.util.ts             # Trích xuất & ẩn danh IP, thông tin thiết bị, trình duyệt, hệ điều hành
```

---

## 2. Các Cơ Chế Bảo Mật Chuyên Sâu

### 2.1. Server-side Token Invalidation & Blacklist
- **Vấn đề**: JWT truyền thống là stateless, khi client logout nếu không thu hồi token ở server thì token đó vẫn có thể bị kẻ gian dùng lại cho đến khi hết hạn (7 ngày).
- **Giải pháp**:
  - `POST /api/auth/logout`: Đưa token vào bộ nhớ đệm `RedisService` (tự động fallback sang Memory Cache nếu Redis không khả dụng) với thời gian sống `TTL` đúng bằng thời gian còn lại của token.
  - `JwtAuthGuard`: Trước khi cho phép truy cập, kiểm tra `isTokenBlacklisted(token)`. Nếu nằm trong blacklist, lập tức trả về `401 Unauthorized ("Token has been revoked.")`.

### 2.2. Chống Tấn Công Dò Mật Khẩu (Brute-Force & Account Lockout Policy)
- `AuthLockoutService` theo dõi số lần đăng nhập sai theo từng email:
  - Cho phép tối đa **5 lần** đăng nhập sai trong cửa sổ 15 phút.
  - Vượt quá 5 lần: Tài khoản bị **tạm khóa 15 phút**, từ chối mọi yêu cầu đăng nhập tiếp theo với thông báo thời gian còn lại.
  - Đăng nhập thành công sẽ xóa bộ đếm thất bại.

### 2.3. Bảo Vệ Mã Xác Thực OTP (Anti-Brute-Force & Cooldown)
- `AuthOtpService`:
  - Giới hạn tối đa **5 lần** nhập sai mã OTP 6 số. Nếu nhập sai quá 5 lần, mã bị vô hiệu hóa ngay lập tức.
  - Áp dụng thời gian chờ Cooldown **60 giây** giữa hai lần bấm "Gửi lại OTP" (`resendOtp`).

### 2.4. Chính Sách Mật Khẩu Nâng Cao (Password Complexity Policy)
- `AuthPasswordService`:
  - Độ dài tối thiểu 8 ký tự, tối đa 128 ký tự.
  - Bắt buộc phải có: Chữ in hoa (A-Z), chữ in thường (a-z), chữ số (0-9) và ký tự đặc biệt (@, #, $, ...).
  - Cấm sử dụng các mật khẩu yếu phổ biến (`password123`, `admin123`, `12345678`...).
  - Cấm đặt mật khẩu chứa phần tên đăng nhập email.

### 2.5. Nhật Ký Bảo Mật Tự Động (Security Audit Logging)
- Tận dụng bảng `AuditLog` có sẵn trong database:
  - Ghi nhận đầy đủ: `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`, `AUTH_REGISTER`, `AUTH_EMAIL_VERIFIED`, `AUTH_PASSWORD_CHANGED`, `AUTH_ACCOUNT_LOCKED`.
  - Lưu metadata: Client IP (đã ẩn danh octet cuối vì quyền riêng tư), Browser, OS, Device Type, User-Agent.
  - Cung cấp endpoint `GET /api/auth/me/security-activity` để người dùng và quản trị viên tra cứu 10 hoạt động gần nhất.

---

## 3. Danh Sách REST API Contract Của Module Auth

| Method | Endpoint | Bảo vệ / Quyền | Mục đích |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Rate-limit (5 req/min) | Đăng ký tài khoản khách hàng mới |
| `POST` | `/api/auth/verify-email` | Rate-limit (5 req/min) | Xác thực mã OTP kích hoạt tài khoản |
| `POST` | `/api/auth/resend-otp` | Rate-limit + 60s cooldown | Gửi lại mã OTP xác thực |
| `POST` | `/api/auth/login` | Rate-limit + Lockout Policy | Đăng nhập bằng Email & Mật khẩu |
| `POST` | `/api/auth/google` | Rate-limit | Đăng nhập bằng Google Credential (idToken) |
| `POST` | `/api/auth/forgot-password`| Rate-limit (5 req/min) | Yêu cầu mã OTP đặt lại mật khẩu |
| `POST` | `/api/auth/reset-password` | Rate-limit (5 req/min) | Đặt lại mật khẩu bằng mã OTP |
| `GET` | `/api/auth/me` | JWT + Roles | Lấy thông tin user hiện tại |
| `POST` | `/api/auth/change-password`| JWT + Roles | Đổi mật khẩu cho user đang đăng nhập |
| `POST` | `/api/auth/logout` | JWT + Roles | Đăng xuất & thu hồi token phía máy chủ |
| `GET` | `/api/auth/me/security-activity` | JWT + Roles | Xem lịch sử các lần đăng nhập & hoạt động |

---

## 4. Frontend Components

- **`PasswordStrengthIndicator`** (`frontend/src/components/auth/password-strength-indicator.tsx`):
  - Thanh hiển thị độ mạnh mật khẩu (Yếu / Trung bình / Mạnh).
  - Danh sách checklist kiểm tra 5 tiêu chí bảo mật theo thời gian thực.
- **`ChangePasswordForm`** (`frontend/src/components/auth/change-password-form.tsx`):
  - Form đổi mật khẩu hoàn chỉnh với nút ẩn/hiện mật khẩu, kiểm tra khớp mật khẩu mới, ngăn trùng mật khẩu cũ.
- **`SecurityActivityCard`** (`frontend/src/components/auth/security-activity-card.tsx`):
  - Hiển thị nhật ký bảo mật dạng thẻ trực quan kèm biểu tượng trạng thái, thiết bị, hệ điều hành và thời gian.
- **`ChangePasswordPage`** (`frontend/src/app/(auth)/change-password/page.tsx`):
  - Trang đổi mật khẩu tích hợp đầy đủ trong nhóm route `(auth)`, bảo vệ bởi `ProtectedPage`.

