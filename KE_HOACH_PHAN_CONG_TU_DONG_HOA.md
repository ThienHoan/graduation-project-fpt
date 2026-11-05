# 🚀 KẾ HOẠCH NÂNG CẤP TÍNH NĂNG TỰ ĐỘNG HÓA THÔNG MINH
## Dự án: Cổ Phục Hoàng Thành AI (Hệ thống Thuê Cổ Phục & Quản Trị ERP)

> **Cập nhật tiến độ: 05/11/2026**
> Mã nguồn của đợt tự động hoá này **chưa được đẩy lên Git** — sẽ cập nhật tên branch / PR tại đây khi push.
> ⚠️ **Bắt buộc trước khi deploy:** chạy `supabase/migrations/021_booking_extensions.sql` trên Supabase SQL Editor (xem mục [Trước khi deploy](#-trước-khi-deploy)).

**Ký hiệu:** ✅ đã làm trong đợt này · 📦 đã có sẵn trong code từ trước · 🟡 làm một phần / khác kế hoạch · ❌ chưa làm

---

## 🎯 MỤC TIÊU DỰ ÁN
Nâng cấp trải nghiệm người dùng và tối ưu quy trình vận hành bằng cách **tự động hóa 80% các tác vụ thủ công** của nhân viên. Nguyên tắc thống nhất: **hệ thống tự xử lý trường hợp bình thường, con người chỉ xử lý ngoại lệ.**

| Mục tiêu ban đầu | Tình trạng |
|---|---|
| Khách đặt cọc là đơn tự duyệt (Auto-approval) | 📦 Đơn QR trả xong tự sang "Đã thanh toán" · ✅ thêm tự duyệt đơn tiền mặt cho khách quen |
| Khách trả đồ sạch là tiền cọc tự hoàn (Auto-refund) | 🟡 Phiếu hoàn cọc tự tạo nhưng vẫn chờ quản lý duyệt (cố ý giữ người duyệt vì chuyển tiền thật) |
| Tự động nhắc lịch & khách tự gia hạn | ✅ Nhắc nhận đồ, mời đánh giá, gia hạn online qua PayOS · 🟡 một số mốc nhắc khác kế hoạch |
| Kho tự phân bổ mã áo & hỗ trợ kiểm đồ | ✅ Tự gán áo thông minh · 🟡 ngày đệm giặt chưa khoá cứng · ❌ bảng định mức lỗi |
| Gợi ý size & tự bù đồ khi sự cố | 📦 Gợi ý size · ✅ tự đổi áo + gợi ý mẫu + voucher · 🟡 khách chưa tự đổi mẫu trên web |

---

## 👥 BẢNG PHÂN CÔNG & TIẾN ĐỘ

| Thành viên | Lĩnh vực phụ trách | Tính năng chính | Tiến độ | Còn lại |
|---|---|---|---|---|
| **HẢI** | Payment & Cọc | Auto-confirm khi cọc & Tự động hoàn cọc | 🟡 Phần lớn có sẵn | Báo chuông khi PayOS thành công, email cấn trừ, quyết định tự hoàn tiền |
| **KHA** | Chăm sóc & Email | Email nhắc hẹn & Tự gia hạn thuê | ✅ Gia hạn xong · 🟡 nhắc lịch | Địa chỉ + hướng dẫn bảo quản trong lời nhắc, mốc T-3h, voucher cảm ơn |
| **SƠN** | Kho & Kiểm đồ | Phân bổ kho thông minh & Nghiệm thu đồ | ✅ Tự gán áo · ❌ định mức lỗi | Khoá cứng ngày đệm giặt, bảng định mức lỗi |
| **HIẾU** | Gợi ý Size & Sự cố | Tư vấn Size & Bù đồ tự động | ✅ Bù đồ · 📦 gợi ý size | Khách tự đổi mẫu trên web |

---

### 👤 1. HẢI — Payment & Tự Động Hoàn Cọc

> **Mục tiêu**: Khách hàng không phải chờ nhân viên đối soát tiền cọc, mọi giao dịch diễn ra tức thì và minh bạch.

#### 📌 Nhiệm vụ & tình trạng
| # | Nhiệm vụ | Tình trạng | Ghi chú |
|---|---|---|---|
| 1.1 | Webhook PayOS thành công → đơn `pending_confirmation` / `awaiting_payment` sang `paid` | 📦 | `payments.service.ts → markAsPaid()` |
| 1.2 | Thanh toán thành công → **báo chuông + Socket.IO cho khách** | ❌ | Hiện chỉ báo khi nhân viên xác nhận tiền mặt (`booking.payment_received`). Trang thanh toán đang tự hỏi lại server mỗi 3 giây |
| 1.3 | Kiểm đồ xong, không hư hại → tự tạo phiếu hoàn cọc | 📦 | Phiếu ở trạng thái `pending`, quản lý duyệt |
| 1.4 | Tự hoàn tiền (sinh VietQR / gọi API cổng thanh toán) | ❌ | **Đề xuất giữ người duyệt** — chuyển tiền thật. DB chỉ cho mỗi đơn 1 phiếu hoàn đang xử lý. **Cần nhóm quyết định** |
| 1.5 | Tính `Tiền thực nhận = Tiền cọc − Phí phạt` | 📦 | Lý do hoàn ghi rõ phần cấn trừ |
| 1.6 | Email hoá đơn cấn trừ chi tiết | ❌ | |

#### ✅ Đã làm thêm trong đợt này (thuộc mảng thanh toán)
- **Tự huỷ đơn quá hạn thanh toán**: hàm có sẵn nhưng trước đây manager phải bấm tay → nay cron 5 phút tự chạy, nhả size + voucher.
- **Giữ chỗ 30 phút cho đơn QR**: khách bỏ trang PayOS thì đơn tự huỷ, không giữ size mãi.
- **Đếm ngược giữ chỗ ở trang thanh toán**: "Đơn được giữ chỗ đến 15:30 — còn 12:45"; hết giờ hiện màn "hết thời gian giữ chỗ".
- **Thanh toán phí gia hạn qua PayOS** (xem mục Kha): webhook → tự áp dụng gia hạn, không cộng tiền 2 lần.

#### ✅ Tiêu chí hoàn thành (DoD)
- [ ] Test thanh toán cọc sandbox: đơn tự sang `paid` trong < 2 giây — *logic có sẵn, chưa đo trên sandbox*.
- [x] Xác nhận kiểm đồ sạch: hệ thống tự tạo phiếu hoàn cọc — *có sẵn (phiếu chờ duyệt)*.

#### ⏭️ Việc còn lại cho Hải
1. Gửi thông báo chuông + realtime cho khách khi webhook PayOS báo thành công (gợi ý: inject `NotificationsService` / `RealtimeService` vào `PaymentsService`, gọi sau `markAsPaid`).
2. Email hoá đơn cấn trừ khi tạo phiếu hoàn cọc.
3. Chốt với nhóm: có làm tự hoàn tiền hay giữ quản lý duyệt.

---

### 👤 2. KHA — Email Nhắc Nhở & Gia Hạn Đồ Tự Động

> **Mục tiêu**: Chăm sóc khách hàng chủ động 24/7 theo vòng đời đơn hàng và tăng doanh thu nhờ tính năng khách tự gia hạn.

#### 📌 Nhiệm vụ & tình trạng
| # | Nhiệm vụ | Tình trạng | Ghi chú |
|---|---|---|---|
| 2.1 | T-1 ngày: nhắc khách ngày mai nhận đồ | 🟡 | ✅ Gửi 9h hôm trước, nội dung khác nhau cho nhận tại cửa hàng / giao tận nơi / chưa thanh toán. **Chưa kèm địa chỉ cửa hàng và hướng dẫn bảo quản** |
| 2.2 | T-3 tiếng trước giờ trả: cảnh báo sắp hết hạn | 🟡 | 📦 Có sẵn nhắc lúc **12h ngày trả** (không đúng mốc 3 tiếng). ✅ Đã sửa lỗi lời nhắc này **gửi nội dung rỗng** (thiếu mẫu tin) |
| 2.3 | T+0 sau hoàn tất: cảm ơn + voucher + mời đánh giá | 🟡 | ✅ Mời đánh giá lúc 10h cho đơn hoàn tất trong 24h, chưa đánh giá. **❌ Chưa tặng voucher cảm ơn** |
| 2.4 | Khách tự gia hạn ngày thuê | ✅ | Chi tiết bên dưới |

#### ✅ Tính năng gia hạn thuê (đã xong)
```
Khách bấm "Gia hạn thuê" (đơn đã thanh toán, chưa trả đồ)
  → chọn 1–7 ngày → hệ thống kiểm tra lịch trống + báo giá
  → bấm Thanh toán → GIỮ LỊCH 30 phút (dời ngày trả) → sang PayOS
       ├─ Trả tiền → ngày trả mới có hiệu lực, cộng phí vào đơn, báo khách
       ├─ Huỷ / quá 30 phút → trả lại ngày trả cũ
       └─ Tiền về muộn → còn trống thì vẫn gia hạn, hết chỗ thì báo quản lý hoàn tiền
```
- Phí tính theo bảng giá từng ngày (giá chốt, luật giá) như lúc đặt đơn, có ưu đãi hạng thành viên, phụ kiện tính thêm. Không thu thêm cọc.
- Mỗi lần tối đa 7 ngày; tổng thời gian thuê không vượt `max_rental_days` (admin cấu hình).
- Giữ lịch **trước** khi trả tiền để không phải hoàn phí gia hạn (hoàn phí sẽ chặn việc hoàn cọc do ràng buộc 1 phiếu hoàn / đơn).
- Link PayOS hết hạn cùng lúc với thời gian giữ lịch.
- **Khác kế hoạch:** nút đặt ở **dashboard khách** (thẻ đơn đang thuê), vì thư mục `frontend/src/app/(customer)/bookings/[id]/` không tồn tại. Có trang kết quả riêng `/booking/extension`.
- **Cần bảng DB mới** `booking_extensions` → chạy SQL trước khi deploy.

#### ✅ Tiêu chí hoàn thành (DoD)
- [ ] Đến đúng khung giờ test: email mẫu đẹp có logo — *đã có cron + mẫu tin; chưa kiểm tra giao diện email thật*.
- [x] Bấm gia hạn: hệ thống tự check lịch trống và cộng ngày thuê chính xác — *đã code + unit test; chưa test với PayOS sandbox*.

#### ⏭️ Việc còn lại cho Kha
1. Thêm địa chỉ cửa hàng (setting `store_address`) + hướng dẫn bảo quản vào mẫu tin `booking.pickup_reminder`.
2. Quyết định có cần mốc nhắc T-3 tiếng không (hiện nhắc 12h ngày trả, hạn trả là 00h).
3. Voucher cảm ơn sau khi hoàn tất đơn (có thể dùng lại cách tạo voucher dùng 1 lần trong `booking-automation.service.ts → issueApologyVoucher`).
4. Test gia hạn với PayOS sandbox (xem mục [Cách test](#-cách-test)).

---

### 👤 3. SƠN — Kho Thông Minh & Kiểm Tra Tình Trạng Đồ

> **Mục tiêu**: Quản lý chính xác từng chiếc áo thật trong kho và rút ngắn thời gian bàn giao/kiểm đồ lúc trả.

#### 📌 Nhiệm vụ & tình trạng
| # | Nhiệm vụ | Tình trạng | Ghi chú |
|---|---|---|---|
| 3.1 | Tự gán mã áo, ưu tiên chiếc ít được thuê | ✅ | Chi tiết bên dưới. Chưa có tiêu chí "vừa giặt xong" |
| 3.2 | **Khoá cứng 1 ngày đệm** sau ngày trả để giặt hấp | 🟡 | Mới là **ưu tiên khi chọn áo** (tránh chiếc có lượt thuê trước kết thúc < 2 ngày). Lịch trống **chưa** khoá thêm ngày → khách khác vẫn đặt được ngay hôm sau |
| 3.3 | Chụp ảnh trước bàn giao / sau khi trả, lưu biên bản `InspectionSession` | 📦 | Kèm AI so ảnh gợi ý tiền phạt |
| 3.4 | **Bảng định mức lỗi**: chọn loại lỗi → tự ra số tiền | ❌ | Hiện nhân viên nhập tiền phạt tay hoặc dùng gợi ý AI |

#### ✅ Phân bổ áo tự động (đã xong)
- Thuật toán xếp hạng: (1) không nối đuôi sát lượt thuê chưa xong, (2) đang trong kho trước → đang giữ → đang cho thuê, (3) ít lượt thuê hơn, (4) mã áo. File: `backend/src/modules/bookings/booking-auto-assign.ts`.
- Mỗi lần gán vẫn đi qua đúng luồng gán tay (`assignAsset`) nên mọi kiểm tra trùng lịch / đúng size / đúng mẫu giữ nguyên.
- Cron 10 phút tự gán cho đơn còn **≤ 3 ngày** tới ngày thuê (gán sát ngày để tránh chọn trúng áo có thể hỏng). **Khác DoD:** không gán ngay lúc khách tạo đơn.
- Manager có nút **"Tự gán"** (từng đơn) và **"Tự gán tất cả"** ở tab "Cần gán tài sản" — dùng được cho cả đơn còn xa ngày.
- Gán cả phụ kiện.
- **Làm thêm:** đơn đã thanh toán + đủ đồ + còn ≤ 1 ngày → tự chuyển "Đang chuẩn bị" (giữ áo trong kho, báo khách).

#### ✅ Tiêu chí hoàn thành (DoD)
- [x] Hệ thống tự gán đúng mã `assetCode` tối ưu nhất — *khi đơn còn ≤ 3 ngày hoặc khi manager bấm "Tự gán"*.
- [ ] Staff kiểm đồ: chọn lỗi, hệ thống tự xuất tổng tiền phạt — *chưa có bảng định mức*.

#### ⏭️ Việc còn lại cho Sơn
1. Khoá cứng ngày đệm giặt: sửa phần tính lịch trống trong `booking-inventory.ts` / `booking-reservations.ts`. **Phần lõi — cần test kỹ** vì ảnh hưởng mọi đơn đặt.
2. Bảng định mức lỗi: có thể lưu trong `system_settings` (dạng JSON) để admin chỉnh, không cần bảng DB mới.

---

### 👤 4. HIẾU — Gợi Ý Size Thông Minh & Tự Động Bù Đồ Khi Sự Cố

> **Mục tiêu**: Khách chọn đúng size ngay lần đầu; tự động xử lý khi trang phục gặp rủi ro hỏng hóc.

#### 📌 Nhiệm vụ & tình trạng
| # | Nhiệm vụ | Tình trạng | Ghi chú |
|---|---|---|---|
| 4.1 | Gợi ý size theo số đo, hiện "Độ phù hợp %" | 📦 | Có sẵn ở `frontend/src/app/catalog/[slug]/page.tsx` |
| 4.2 | Áo bảo trì đột xuất → tìm mẫu tương tự còn trống | ✅ | Chi tiết bên dưới |
| 4.3 | Gửi xin lỗi + 2–3 mẫu tương đương + voucher 20% | ✅ | |
| 4.4 | **Khách tự chọn đổi mẫu ngay trên web** | 🟡 | Khách nhận gợi ý qua thông báo; việc đổi mẫu do quản lý liên hệ khách |

#### ✅ Xử lý sự cố áo đã gán (đã xong)
- Cron 10 phút tìm đơn đang được gán áo/phụ kiện **hỏng / mất / ngừng cho thuê** (bảo trì chỉ xử lý khi đơn còn ≤ 3 ngày) → gỡ ra → **tự gán chiếc khác cùng mẫu, cùng size**. Khách không bị ảnh hưởng nếu còn chiếc thay thế.
- Hết chiếc cùng size:
  - Tìm 2–3 **mẫu tương tự** (dùng lại thuật toán "sản phẩm tương tự": cùng kiểu, màu, dịp, tầm giá) **còn trống đúng ngày và đúng size**.
  - Báo quản lý kèm danh sách mẫu.
  - Gửi khách lời xin lỗi + gợi ý mẫu + **voucher `XINLOI-xxxxxxxx`** dùng 1 lần (mặc định 20%, tối đa 200.000đ, hạn 30 ngày; admin chỉnh hoặc đặt 0% để tắt).
- Chỉ áp dụng cho đơn chưa đến bước chuẩn bị (áo chưa được giữ thật trong kho).

#### ✅ Tiêu chí hoàn thành (DoD)
- [x] Nhập số đo: hệ thống đề xuất size — *có sẵn*.
- [x] Áo bị đánh dấu bảo trì/hỏng: đơn bị ảnh hưởng tự nhận đề xuất mẫu thay thế kèm voucher.

#### ⏭️ Việc còn lại cho Hiếu
1. Cho khách tự bấm đổi sang mẫu được gợi ý trên web: cần tính lại tiền thuê/cọc chênh lệch và thu/hoàn phần chênh — phần lớn nhất còn lại.

---

## ➕ TỰ ĐỘNG HOÁ LÀM THÊM NGOÀI KẾ HOẠCH

| Tính năng | Mô tả |
|---|---|
| **Tự duyệt đơn khách quen** | Đơn tiền mặt được xác nhận ngay nếu khách đã hoàn tất ≥ 1 đơn, chưa từng bị phạt trễ/hư hỏng, tổng tiền ≤ 3 triệu. Khách mới / đơn lớn vẫn vào hàng chờ nhân viên. Admin bật/tắt và chỉnh ngưỡng |
| **Bản tin 7h30 cho nhân viên & quản lý** | Chỉ liệt kê việc hệ thống không tự làm được: đơn sắp thuê chưa đủ áo, đơn nhận hôm nay chưa sẵn sàng, đơn tiền mặt chờ duyệt, đơn quá hạn. Không có việc thì không gửi |

---

## ⏰ LỊCH CHẠY TỰ ĐỘNG (giờ Việt Nam)

| Thời điểm | Việc hệ thống tự làm |
|---|---|
| Mỗi 5 phút | Huỷ đơn quá hạn thanh toán · Xử lý yêu cầu gia hạn quá 30 phút |
| Mỗi 10 phút | Đổi áo hỏng → Tự gán áo cho đơn ≤ 3 ngày → Chuyển "Đang chuẩn bị" cho đơn ≤ 1 ngày |
| 00h00 | Đánh dấu đơn quá hạn + cộng phí trễ 📦 |
| 07h30 | Bản tin việc cần xử lý cho nhân viên |
| 09h00 | Nhắc khách nhận đồ ngày mai |
| 10h00 | Mời khách đánh giá đơn vừa hoàn tất |
| 12h00 | Nhắc khách trả đồ hôm nay 📦 (đã sửa nội dung) |

## ⚙️ CÀI ĐẶT MỚI CHO ADMIN
Trang **Cấu hình hệ thống → mục "Tự động hoá đơn thuê"**:

| Cài đặt | Mặc định |
|---|---|
| Tự duyệt đơn cho khách quen | Bật |
| Số đơn hoàn tất tối thiểu để tự duyệt | 1 |
| Giá trị đơn tối đa được tự duyệt | 3.000.000đ |
| Voucher xin lỗi khi hết áo thay thế | 20% (0 = tắt) |
| Mức giảm tối đa của voucher xin lỗi | 200.000đ |

---

## 🚨 TRƯỚC KHI DEPLOY
1. **Chạy SQL trên Supabase SQL Editor:** `supabase/migrations/021_booking_extensions.sql` (tạo bảng `booking_extensions`, bật RLS; chạy lại nhiều lần vẫn an toàn). Bản sao cho Prisma: `backend/prisma/migrations/20261105_booking_extensions/`.
   Nếu quên: riêng tính năng gia hạn báo lỗi, webhook thanh toán đơn thường vẫn chạy.
2. Sau khi deploy, các cron **chạy trên dữ liệu thật ngay**: đơn sắp thuê sẽ được tự gán áo / chuyển trạng thái. Đơn QR tạo trước bản cập nhật không có hạn giữ chỗ nên không bị huỷ.

---

## 🧪 CÁCH TEST

### Test tự động (đã chạy — đều pass)
Unit test dùng DB và PayOS giả lập, kiểm tra logic, không đụng dữ liệu thật.

| Phía | Kết quả | File test mới / bổ sung |
|---|---|---|
| Backend | 842 pass (5 skip có từ trước) | `booking-auto-assign.spec.ts`, `booking-automation.service.spec.ts`, `booking-extensions.service.spec.ts`, phần thêm trong `bookings.service.spec.ts`, `payments.service.spec.ts` |
| Frontend | 180 pass | `extend-rental-modal.test.tsx`, `booking/extension/page.test.tsx`, phần thêm trong `booking/payment/page.test.tsx` |

Tình huống quan trọng đã có test: đơn đã trả tiền không bao giờ bị tự huỷ · nhân viên thao tác cùng lúc với cron không làm hỏng dữ liệu · webhook gọi 2 lần không cộng phí gia hạn 2 lần · tiền gia hạn về muộn · tự duyệt lỗi thì vẫn tạo đơn bình thường.

```bash
cd backend && pnpm test
cd frontend && pnpm test
```

### Test thủ công (CHƯA làm — chạy trên môi trường dev/staging)
Các endpoint chạy tay (thay vì chờ cron) — gọi bằng token manager, header `Authorization: Bearer <token>`:

| Muốn test | Cách làm |
|---|---|
| Tự huỷ đơn QR | Tạo đơn QR → đóng trang PayOS → xem đếm ngược. Muốn khỏi chờ: trên **DB dev** đặt `payment_due_at` về quá khứ rồi gọi `POST /bookings/cancel-expired-payments` |
| Tự duyệt | Khách đã có ≥ 1 đơn hoàn tất đặt đơn tiền mặt → đơn "Đã xác nhận" ngay. Khách mới → vẫn chờ duyệt |
| Tự gán / chuẩn bị / đổi áo hỏng | Tab "Cần gán tài sản" → **Tự gán**, hoặc `POST /bookings/run-fulfillment-automation`. Test đổi áo: đánh dấu áo đã gán là *damaged* rồi gọi lại |
| Bản tin / nhắc nhận đồ / mời đánh giá | `POST /bookings/run-staff-digest`, `POST /bookings/run-pickup-reminders`, `POST /bookings/run-review-invitations` → xem chuông thông báo |
| Gia hạn | Khách có đơn đang thuê → **Gia hạn thuê** → PayOS sandbox → kiểm tra ngày trả mới. Thử thêm: huỷ trên PayOS; để quá 30 phút (cron trả lại ngày cũ trong ≤ 5 phút) |

---

## 📂 FILE ĐÃ THAY ĐỔI (để review)

**Backend — file mới**
- `src/modules/bookings/booking-auto-assign.ts` — thuật toán chọn áo
- `src/modules/bookings/booking-automation.service.ts` — đổi áo hỏng, gợi ý mẫu + voucher, bản tin, mời đánh giá
- `src/modules/bookings/booking-extensions.service.ts` — gia hạn thuê
- `src/modules/payments/dto/create-extension-link.dto.ts`
- `prisma/migrations/20261105_booking_extensions/migration.sql` + `supabase/migrations/021_booking_extensions.sql`
- Các file `*.spec.ts` tương ứng

**Backend — file sửa:** `bookings.service.ts` (giữ chỗ, tự duyệt, tự gán, tự chuẩn bị, nhắc nhận đồ) · `bookings.scheduler.ts` · `bookings.controller.ts` · `bookings.module.ts` · `payments.service.ts` / `payments.controller.ts` / `payments.module.ts` · `notifications.service.ts` (mẫu tin mới) · `admin.constants.ts` (cài đặt mới) · `garments.module.ts` · `prisma/schema.prisma` (model `BookingExtension`)

**Frontend — file mới:** `components/customer/extend-rental-modal.tsx` · `app/booking/extension/page.tsx` (+ test)

**Frontend — file sửa:** `app/booking/payment/page.tsx` (đếm ngược) · `app/dashboard/customer/page.tsx` (nút gia hạn) · `app/dashboard/manager/page.tsx` (nút tự gán) · `components/admin/system-config-panel.tsx` · `lib/api.ts`

---

## 📅 CHECKLIST TIẾN ĐỘ THỰC HIỆN

- [x] **Giai đoạn 1**: Thống nhất API contracts giữa Frontend & Backend — *cho các tính năng đã làm*.
- [x] **Giai đoạn 2**: Code các chức năng Backend và viết Unit Test cho logic tự động.
- [x] **Giai đoạn 3**: Tích hợp giao diện Frontend và thông báo (chuông / email) — *trừ báo chuông khi PayOS thành công (Hải)*.
- [ ] **Giai đoạn 4**: Test liên thông luồng thực tế (End-to-End Test) và chuẩn bị kịch bản Demo bảo vệ đồ án — **cả nhóm**.

### Việc chung của cả nhóm
- [ ] Chạy SQL `021_booking_extensions.sql` trên Supabase.
- [ ] Review code đợt tự động hoá (danh sách file ở trên).
- [ ] Test thủ công theo bảng [Cách test](#-cách-test), đặc biệt gia hạn với PayOS sandbox.
- [ ] Chốt: có làm tự hoàn tiền hay giữ quản lý duyệt.
- [ ] Viết kịch bản demo bảo vệ (gợi ý dùng các endpoint `run-*` để demo không phải chờ giờ cron).
