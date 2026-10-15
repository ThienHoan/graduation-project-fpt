# Booking Workflow Handoff

> Tài liệu bàn giao cho AI/người phát triển tiếp theo khi chuyển máy hoặc chuyển session.
>
> Cập nhật: 2026-10-06

## 1. Mục tiêu nghiệp vụ

Luồng thuê thực tế của dự án:

```text
Customer tạo booking theo size
→ Staff tiếp nhận và xác nhận booking
→ Manager/owner gán physical asset cụ thể
→ Customer thanh toán
→ Staff chuẩn bị asset
→ Store giao/trao asset
→ Customer thuê
→ Customer trả asset
→ Staff inspection
→ Laundry/maintenance/damaged/retired tùy tình trạng
→ Asset đủ điều kiện mới quay lại available
```

Booking ban đầu là reservation theo `garment_size_id`; physical asset chỉ được gán ở bước vận hành bởi manager/owner. Backend transaction là nguồn chân lý cuối cùng về availability.

## 2. Database/Supabase policy

Người dùng sử dụng Supabase SQL Editor thủ công. Không tự chạy lệnh thay đổi database.

Đã xác minh trên Supabase:

- `booking_items`: 76 dòng, cả 76 dòng có `garment_size_id`.
- `garment_assets`: 47 dòng, cả 47 dòng có `garment_size_id`.
- Không có asset nào sai cặp garment/size.
- Enum `asset_status` đã có `cleaned`.
- Booking đã có các cột:
  - `handover_status`
  - `confirmed_at`
  - `confirmed_by`
  - `condition_before_rental`
  - `condition_images`
- Database không có bảng `public._prisma_migrations`.

Quy tắc bắt buộc:

```text
Không chạy prisma migrate deploy
Không chạy prisma db push
Không tạo SQL migration mới nếu chưa kiểm tra Supabase hiện tại
Chỉ dùng prisma generate nếu generated client thực sự cần đồng bộ
```

Các file migration đang có trong working tree là thay đổi lịch sử trước đó:

```text
backend/prisma/migrations/20261005_asset_status_handover/
supabase/migrations/009_asset_status_handover.sql
```

Không paste lại các migration này lên Supabase nếu các cột/enum đã tồn tại.

## 3. Những phần đã sửa

### 3.1 Availability

File chính:

```text
backend/src/modules/bookings/bookings.service.ts
```

Capacity của một size hiện chỉ tính các asset:

```text
available
reserved
rented
```

Không tính:

```text
inspection_pending
laundry
maintenance
cleaned
damaged
retired
lost
```

Overlap hiện dùng quy tắc half-open:

```text
newStart < oldEnd
AND
newEnd > oldStart
```

Hai booking chỉ chạm biên được phép nối tiếp theo rule hiện tại. Booking item trong các status release không tính vào committed demand.

### 3.2 Serializable retry

`BookingsService` có helper `runSerializable()`:

- Chạy transaction ở `Serializable`.
- Retry tối đa 3 lần.
- Chỉ retry Prisma error code `P2034`.
- Không retry lỗi nghiệp vụ như `BadRequestException`, `NotFoundException`, conditional claim thất bại hoặc lỗi database khác.
- Notification chỉ chạy sau transaction thành công.

Helper hiện được dùng cho booking creation và asset assignment/handover ở các phần đã refactor.

### 3.3 Physical asset assignment

Endpoint:

```text
PATCH /bookings/:bookingId/items/:itemId/assign-asset
```

Controller vẫn giới hạn:

```text
manager_owner, admin
```

Assignment hợp lệ khi booking ở một trong các status:

```text
confirmed
awaiting_payment
paid
preparing
```

Backend kiểm tra:

- Booking tồn tại.
- Item thuộc booking.
- Item chưa có asset.
- Item có `garment_size_id`.
- Asset tồn tại.
- Asset thuộc đúng garment.
- Asset đúng size.
- Asset đang là `available`.
- Asset không được dùng ở booking active khác bị overlap.

Khi thành công:

```text
asset available → reserved
booking_item.garment_asset_id được ghi
booking_status_history được ghi
notification được gửi sau commit
```

Concurrency protection:

- Serializable transaction.
- Conditional claim `id = assetId AND status = available`.
- Nếu hai request cùng claim thì chỉ request claim thành công mới tiếp tục.
- P2034 được retry giới hạn.

### 3.4 Manager UI assignment

File:

```text
frontend/src/app/dashboard/manager/page.tsx
```

Sau assignment thành công:

- Dùng ngay booking response từ server.
- Không còn delay 4.5 giây.
- Giữ `customerName` và `customerPhone` hiện có khi merge response.
- Xóa asset picker.
- Refresh danh sách asset.

Asset picker đã lọc theo `garmentSizeId`, nhưng chưa lọc theo rental dates; backend overlap validation vẫn là boundary an toàn bắt buộc.

### 3.5 Handover

Endpoint:

```text
POST /bookings/:id/confirm-handover
```

Controller dùng:

```text
JwtAuthGuard + RolesGuard
```

Role được phép:

```text
customer
staff
manager_owner
admin
```

Service nhận actor gồm `id` và `role`.

Authorization:

- Customer chỉ được handover booking của chính họ.
- Staff/manager/admin được thao tác booking vận hành.
- Ownership vẫn phải kiểm tra trong service, không chỉ dựa vào guard.

Handover chỉ hợp lệ khi booking ở:

```text
ready_for_pickup
delivering
renting
```

Tất cả booking items phải có asset đúng garment/size. Asset status phải khớp:

```text
ready_for_pickup hoặc delivering → reserved
renting → rented
```

State machine:

```text
null → PENDING / CONFIRMED / REJECTED
PENDING → CONFIRMED / REJECTED
CONFIRMED và REJECTED là terminal
```

Handover được update trong transaction với conditional old-state predicate và audit vào `booking_status_history`.

- `confirmedAt`/`confirmedBy` chỉ set khi `CONFIRMED` hoặc `REJECTED`.
- `dto.note` ghi vào `booking_status_history.note`.
- Không ghi đè `booking.note`.
- Omitted `conditionImages` giữ giá trị cũ.
- Terminal state không được ghi đè bằng payload khác.
- Exact terminal repeat hiện được xử lý theo hướng idempotent nếu payload chính phù hợp.

DTO ảnh đã bỏ import `IsUUID` không dùng và dùng URL validation.

### 3.6 Asset state machine / inspection

File:

```text
backend/src/modules/inspections/inspections.service.ts
```

Đã sửa:

- Inspection asset phải được gán cho booking tương ứng.
- Chỉ asset đang `inspection_pending` mới được complete.
- Không tự động biến toàn bộ assigned assets thành `cleaned` bất kể kết quả inspection.
- Inspection chỉ đưa asset sang `laundry`, `maintenance` hoặc `damaged`.
- Laundry complete:

```text
laundry → cleaned
```

- Maintenance complete:

```text
maintenance → cleaned
```

- Maintenance `cannot_repair`:

```text
maintenance → damaged
```

- Không chuyển trực tiếp các trạng thái này về `available`.
- Conditional status update ngăn stale completion ghi đè trạng thái mới.

### 3.7 Cancellation/payment expiry

Cancellation và payment expiry chỉ release asset nếu asset vẫn ở:

```text
reserved → available
```

Không được biến asset `rented`, `inspection_pending`, `laundry` hoặc `maintenance` thành `available` do stale cancellation.

Payment expiry hiện xét booking có `paymentDueAt`, bao gồm delivery booking; transaction đọc lại booking và chỉ hủy nếu booking vẫn `awaiting_payment`.

### 3.8 Frontend contract/dashboard

- `AvailabilityResponse` đã đổi từ `garmentId` sang `garmentSizeId` để khớp backend.
- Manager active booking list đã bao gồm `overdue`.
- Manager asset status dropdown chỉ hiển thị các transition hợp lệ theo status hiện tại.
- Utilization dashboard đã được điều chỉnh để không chỉ dùng công thức rented/(rented+available) cũ; cần tiếp tục xác định rõ đây là utilization vận hành hay utilization rentable.

## 4. Files quan trọng

```text
backend/src/modules/bookings/bookings.service.ts
backend/src/modules/bookings/bookings.controller.ts
backend/src/modules/bookings/dto/confirm-handover.dto.ts
backend/src/modules/bookings/bookings.service.spec.ts
backend/src/modules/inspections/inspections.service.ts
backend/src/modules/garments/garments.service.ts
frontend/src/app/dashboard/manager/page.tsx
frontend/src/lib/api.ts
backend/prisma/schema.prisma
```

## 5. Trạng thái test hiện tại

Đã chạy thành công trong session hiện tại:

```text
backend TypeScript: passed
frontend TypeScript: passed
booking.service.spec.ts: 3 tests passed
full backend Vitest suite: passed
 git diff --check: passed
```

Lưu ý: `backend/src/modules/bookings/bookings.service.spec.ts` hiện mới có coverage rõ cho availability/overlap/concurrent booking creation. Cần bổ sung test chuyên sâu cho assignment và handover trước khi tuyên bố production-ready.

## 6. Việc còn phải làm tiếp

### Ưu tiên 1: tests

Bổ sung vào `bookings.service.spec.ts` hoặc tách spec mới:

Assignment:

- Wrong booking status.
- Wrong garment.
- Wrong size.
- Missing item size.
- Item already assigned.
- Asset not found.
- Asset unavailable/maintenance/laundry/inspection_pending/cleaned/damaged/retired/lost.
- Overlapping assignment.
- Adjacent boundary assignment.
- Released booking ignored.
- Conditional claim race.
- Same asset concurrent assignment.
- Same item with different assets concurrently.
- Rollback after item/history failure.
- P2034 retry succeeds.
- Non-P2034 error is not retried.

Availability:

- Each capacity status group.
- Operational-only inventory cannot create impossible booking.
- Duplicate size quantity.
- Released status behavior.
- Overlap and boundary behavior.

Handover:

- Missing booking.
- Own customer allowed.
- Foreign customer forbidden.
- Staff/manager/admin allowed.
- Invalid booking status.
- Missing asset.
- Garment/size mismatch.
- Invalid asset status.
- All allowed state transitions.
- Terminal overwrite conflict.
- Exact terminal repeat has no duplicate history.
- `note` history persistence.
- Existing booking note remains unchanged.
- Omitted images retained.
- Empty image array semantics explicitly tested.
- Concurrent handover conflict.

Inspection:

- Asset not assigned to booking rejected.
- Stale/non-pending asset rejected.
- Damaged/lost/retired cannot become cleaned/available.
- `cannot_repair` cannot become available.
- Duplicate completion rejected.

### Ưu tiên 2: chốt handover payload semantics

Cần thống nhất và test rõ:

- Không có `conditionImages`: giữ ảnh cũ.
- `conditionImages: []`: nên được hiểu là chủ động xóa ảnh nếu frontend cần chức năng này.
- `PENDING → PENDING` cùng payload: idempotent.
- `PENDING → PENDING` khác condition/images: nên trả `409 Conflict`, không âm thầm thay đổi dữ liệu.
- Terminal exact repeat: không tạo history mới, không đổi actor/timestamp.

### Ưu tiên 3: frontend handover

Hiện backend đã có endpoint handover. Kiểm tra `frontend/src/lib/api.ts` và các màn hình customer/staff:

- Nếu chưa có API helper/UI gọi endpoint, bổ sung trong phase riêng.
- Không tạo UI giả nếu chưa có màn hình vận hành phù hợp.

### Ưu tiên 4: shared state rules

- `ASSET_HOLDING_STATUSES` trong `bookings.service.ts` hiện cần xóa hoặc dùng thật sự.
- Nên tách helper expected status:

```text
ready_for_pickup/delivering → reserved
renting → rented
```

- Đồng bộ/document rõ dashboard utilization với backend rentable capacity.

### Ưu tiên 5: concurrency hardening còn lại

Các path cần review thêm nếu tiếp tục production hardening:

- `advanceStatus()` đọc booking trước transaction rồi update sau.
- `markOverdueBookings()` cần conditional current-status update.
- `applyOverdueFee()` có thể bị duplicate nếu chạy đồng thời.
- Pricing overlap đang cần đối chiếu với booking overlap nếu half-open là policy chính.
- Asset picker có thể được mở rộng để truyền booking dates và loại asset đã overlap ngay ở UI.

## 7. Verification sau khi tiếp tục

Từ thư mục repo root:

```bash
cd backend
npm exec tsc -- --noEmit
npm exec vitest -- run

cd ../frontend
npm exec tsc -- --noEmit

cd ..
git diff --check
```

Nếu cần kiểm tra generated Prisma client:

```bash
cd backend
npx prisma generate
```

Không chạy `migrate deploy` hoặc `db push` lên Supabase.

## 8. Tiêu chí hoàn thành cuối cùng

Chỉ coi phần booking assignment/handover hoàn thiện khi:

1. Asset assignment luôn đúng garment và size.
2. Một asset không thể bị claim cho hai booking overlap.
3. Một booking item không thể nhận hai asset.
4. P2034 được retry có giới hạn.
5. Customer không thể handover booking người khác.
6. Handover terminal không bị ghi đè.
7. Handover history không bị duplicate khi retry.
8. Asset không bị bypass state machine.
9. Cancellation/payment expiry không release nhầm asset đang vận hành.
10. Assignment/handover/availability/concurrency có regression tests.
11. Supabase không cần migration mới cho các thay đổi này.
12. Các kiểm tra TypeScript, Vitest và diff đều pass.
