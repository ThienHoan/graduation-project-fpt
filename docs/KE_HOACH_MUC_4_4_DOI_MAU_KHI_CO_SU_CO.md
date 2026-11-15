# KẾ HOẠCH TRIỂN KHAI MỤC 4.4 — ĐỔI MẪU KHI CÓ SỰ CỐ (bản đồ án, đã cắt gọn)

> Trạng thái: **bản kế hoạch, chưa viết code**
> Phạm vi: backend NestJS + Prisma/PostgreSQL (Supabase), frontend Next.js, cron trên VPS (PM2)
> Nguyên tắc bất biến: mỗi commit phải chạy được (lint, typecheck, test xanh) và **không đổi hành vi** luồng đặt đơn / thanh toán / hoàn cọc của đơn không có sự cố. Chỉ commit, không tạo PR, không merge vào `main`.
> Đây là đồ án tốt nghiệp: làm đúng luồng chính + demo được. Các trường hợp biên ghi ở §14 (hạn chế, hướng phát triển).

---

## 0. Phạm vi

### Giữ
- 4 bảng mới (`booking_incidents`, `booking_change_requests`, `booking_change_holds`, `booking_adjustments`), **RLS cho cả 4 bảng**, cột `notifications.link_url`.
- 2 unique index chống trùng: mỗi món 1 sự cố đang mở; mỗi đơn 1 yêu cầu đổi đang chờ.
- 2 cron: `runIncidentScan` (30 phút/lần), `expireChangeRequests` (mỗi phút). Endpoint `run-scan` để demo.
- **1 thông báo** khi phát hiện sự cố (khách + manager), có link bấm vào trang đổi mẫu.
- Công thức tiền (§6), hold asset cụ thể 30 phút (§10), đổi mẫu / bỏ món / hủy đơn, PayOS bổ sung, credit cộng vào hoàn cọc, endpoint Manager hủy đơn đã thanh toán.
- Hai đoạn nhỏ giữ vì rẻ mà tránh lỗi tiền: **void credit trước khi hoàn khi hủy đơn** (§8.3) và **trả 409 khi PayOS đang xử lý** (§12).

### Cắt
- Leo thang 3 mức, nhắc lại, bản tin digest, feature flag bảng settings.
- Đối soát (`reconciliation`), `cancelled → paid`, cột `payments.cancel_source`.
- Cron `applyPendingChanges`, `purgeExpiredChangeHolds` (bỏ cron purge chỉ làm bảng hold lớn hơn; **mọi truy vấn hold vẫn phải lọc `expiresAt > now AND consumedAt IS NULL`**, xem §10).
- Bảng settings: viết hằng số trong code.

> Biến môi trường duy nhất: `INCIDENT_SCAN_ENABLED` (đọc trong `runIncidentScan`, mặc định `true`; đặt `false` thì cron return sớm). Không dùng bảng settings, không dùng feature flag khác.

```ts
// booking-incidents.constants.ts
export const INCIDENT_SCAN_WINDOW_DAYS = 2;   // cửa sổ [hôm nay, hôm nay + 2 ngày]
export const INCIDENT_HOLD_MINUTES = 30;
export const INCIDENT_MANAGER_HOLD_MINUTES = 30;
export const INCIDENT_SCAN_BATCH_SIZE = 100;
```

---

## 1. Căn cứ từ mã nguồn (số dòng cần kiểm lại khi vào repo)

| Thành phần | Vị trí | Dùng lại / cần sửa |
|---|---|---|
| Trạng thái đơn | `schema.prisma: enum BookingStatus` | Thêm hằng `PRE_HANDOVER_STATUSES` |
| Tạo đơn + giá + voucher | `bookings.service.ts:369-748` | Hook kiểm tra sau commit; tái dùng `pricing.quoteRental` |
| Hủy đơn | `bookings.service.ts:866-960`, `1818-1880` | Tách thành `cancelBookingTx` |
| Gán áo | `assignAsset :1949`, `autoAssignAssets :2172` | Đi qua `assert*ScheduleAvailable` (đã thêm hold) |
| Bàn giao | `confirmHandover :2546` | Đã chặn khi thiếu asset → "van an toàn" |
| Tồn kho | `booking-inventory.ts` (`loadSizeInventory :165`, `loadAccessoryInventory :98`, `inventoryEvents :207`) | Thêm hold vào committed |
| Khóa lịch asset | `booking-reservations.ts:61,102` | Thêm kiểm tra hold, tham số tùy chọn |
| Gia hạn (mẫu giữ chỗ 30′) | `booking-extensions.service.ts` | Sao chép mẫu cho change request |
| Thanh toán | `payments.service.ts` (`createExtensionPaymentLink :173`, `markAsPaidTx :302`, `afterPaymentPaid :312`, `releaseClosedPayosIntents :449`) | Thêm nhánh thanh toán bổ sung; **không gọi PayOS trong transaction** |
| Hoàn cọc | `inspections.service.ts:1788`, `settlement.helper.ts` | Cộng credit vào công thức hoàn |
| Voucher | `vouchers.service.ts` (`evaluate`, `releaseForBooking`) | Chỉ clamp, không evaluate lại |
| Thông báo | `notifications.service.ts` | Thêm `linkUrl`, 4 template (3 incident + `booking.staff.payment_unmatched`) |
| Cron | `bookings.scheduler.ts` | Thêm 2 cron |
| FE mẫu | `frontend/src/app/booking/extension/page.tsx` | Sao chép cho trang kết quả đổi mẫu |

**Lỗ hổng cần xử lý:** `CANCELLABLE_STATUSES` chỉ gồm `draft/pending_confirmation/confirmed/awaiting_payment`; đơn `paid/preparing/ready_for_pickup` hiện **không có đường hủy** → thêm endpoint Manager (§8.2).

---

## 2. Phạm vi trạng thái

```ts
// booking-incidents.ts
export const PRE_HANDOVER_STATUSES: BookingStatus[] = [
  BookingStatus.pending_confirmation,
  BookingStatus.confirmed,
  BookingStatus.awaiting_payment,
  BookingStatus.paid,
  BookingStatus.preparing,
  BookingStatus.ready_for_pickup,
];
```

Từ `delivering` trở đi đồ đã rời cửa hàng → ngoài phạm vi. Không áp dụng cho `draft, cancelled, rejected, renting, overdue, returned, inspection_pending, completed, refund_pending, delivering`.

| Trạng thái | Phát hiện | Đổi mẫu | Bỏ món | Hủy đơn |
|---|---|---|---|---|
| `pending_confirmation`, `confirmed`, `awaiting_payment` | ✅ | ✅ | ✅ | ✅ (khách, luồng cũ) |
| `paid`, `preparing`, `ready_for_pickup` | ✅ | ✅ | ✅ | ⚠️ endpoint Manager mới |
| `delivering` trở đi | ❌ | ❌ | ❌ | luồng cũ |

---

## 3. Kiến trúc

```
 Cron 30' ──┐
 Tạo đơn ───┼─► IncidentScanner ─► booking_incidents (dedupe) ─► 1 thông báo khách + manager
 run-scan ──┘                              │
                                  /booking/incidents/:bookingId
        ┌───────────────────────────┼───────────────────────────┐
   (1) Đổi mẫu                (2) Bỏ món                  (3) Hủy đơn
 quote+hold 30'              quote                    luồng hủy hiện có
        │                          │                   (Manager nếu đã paid)
 chưa paid → áp dụng ngay    chưa paid → cập nhật tổng
 đã paid  → PayOS bổ sung    đã paid  → ghi credit
        └──► booking_adjustments (charge | credit) ──► trả đồ: cộng credit vào 1 phiếu hoàn cọc
```

---

## 4. Mô hình dữ liệu

### 4.1 Bảng mới (Prisma)

```prisma
model BookingIncident {
  id                     String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  bookingId              String    @map("booking_id") @db.Uuid
  itemKind               String    @map("item_kind")             // garment | accessory
  bookingItemId          String?   @map("booking_item_id") @db.Uuid
  bookingAccessoryItemId String?   @map("booking_accessory_item_id") @db.Uuid
  dedupeKey              String    @map("dedupe_key")            // "g:<itemId>" | "a:<accessoryItemId>"
  reason                 String                                   // asset_damaged | asset_lost | asset_retired
                                                                  // asset_maintenance | asset_conflict
                                                                  // no_asset_available | accessory_unavailable
  assetId                String?   @map("asset_id") @db.Uuid
  assetCode              String?   @map("asset_code")
  /// { name, sizeLabel, imageUrl, dailyPrice, depositAmount, lineRental, estimated }
  snapshot               Json
  status                 String    @default("open")              // open | awaiting_customer | needs_manager | resolved | cancelled
  dueAt                  DateTime  @map("due_at") @db.Date        // = booking.rentalStartDate
  detectedAt             DateTime  @default(now()) @map("detected_at") @db.Timestamptz(6)
  notifiedAt             DateTime? @map("notified_at") @db.Timestamptz(6)
  changeRequestId        String?   @map("change_request_id") @db.Uuid   // cột thường, không FK (tránh vòng quan hệ)
  resolution             String?                                   // replaced | removed | booking_cancelled | asset_recovered | manual
  resolvedAt             DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy             String?   @map("resolved_by") @db.Uuid
  note                   String?
  createdAt              DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)

  booking       Booking              @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  item          BookingItem?         @relation(fields: [bookingItemId], references: [id], onDelete: SetNull)
  accessoryItem BookingAccessoryItem? @relation(fields: [bookingAccessoryItemId], references: [id], onDelete: SetNull)

  @@index([bookingId, status])
  @@index([status, dueAt])
  @@map("booking_incidents")
}

model BookingChangeRequest {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  bookingId      String   @map("booking_id") @db.Uuid
  type           String                                   // replace | remove
  source         String   @default("customer")            // customer | manager
  status         String   @default("quoted")              // quoted | awaiting_payment | applied | expired | cancelled | needs_manager
  createdBy      String?  @map("created_by") @db.Uuid
  /// Lựa chọn + giá đã chốt lúc báo giá (KHÔNG tính lại khi áp dụng)
  selection      Json
  beforeSnapshot Json     @map("before_snapshot")
  afterSnapshot  Json     @map("after_snapshot")
  rentBefore     Decimal  @map("rent_before")     @db.Decimal(12,2)
  rentAfter      Decimal  @map("rent_after")      @db.Decimal(12,2)
  depositBefore  Decimal  @map("deposit_before")  @db.Decimal(12,2)
  depositAfter   Decimal  @map("deposit_after")   @db.Decimal(12,2)
  discountBefore Decimal  @map("discount_before") @db.Decimal(12,2)
  discountAfter  Decimal  @map("discount_after")  @db.Decimal(12,2)
  chargeAmount   Decimal  @default(0) @map("charge_amount") @db.Decimal(12,2)
  holdExpiresAt  DateTime @map("hold_expires_at") @db.Timestamptz(6)
  paymentId      String?  @unique @map("payment_id") @db.Uuid
  checkoutUrl    String?  @map("checkout_url")
  appliedAt      DateTime? @map("applied_at") @db.Timestamptz(6)
  note           String?
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  booking     Booking             @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  payment     Payment?            @relation(fields: [paymentId], references: [id])
  holds       BookingChangeHold[]
  adjustments BookingAdjustment[]

  @@index([bookingId, status])
  @@index([status, holdExpiresAt])
  @@map("booking_change_requests")
}

model BookingChangeHold {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  changeRequestId  String    @map("change_request_id") @db.Uuid
  bookingId        String    @map("booking_id") @db.Uuid
  kind             String                                   // garment | accessory
  garmentAssetId   String?   @map("garment_asset_id") @db.Uuid
  accessoryAssetId String?   @map("accessory_asset_id") @db.Uuid
  startDay         DateTime  @map("start_day") @db.Date
  endDay           DateTime  @map("end_day") @db.Date
  expiresAt        DateTime  @map("expires_at") @db.Timestamptz(6)
  consumedAt       DateTime? @map("consumed_at") @db.Timestamptz(6)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  changeRequest BookingChangeRequest @relation(fields: [changeRequestId], references: [id], onDelete: Cascade)

  @@index([garmentAssetId, expiresAt])
  @@index([accessoryAssetId, expiresAt])
  @@map("booking_change_holds")
}

model BookingAdjustment {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  bookingId       String   @map("booking_id") @db.Uuid
  changeRequestId String?  @map("change_request_id") @db.Uuid
  incidentId      String?  @map("incident_id") @db.Uuid
  component       String                                   // rent | deposit | accessory_rent
  direction       String                                   // charge | credit
  amount          Decimal  @db.Decimal(12,2)               // luôn > 0
  status          String   @default("pending_payment")     // pending_payment | collected | accrued | settled | void
  paymentId       String?  @map("payment_id") @db.Uuid
  refundId        String?  @map("refund_id") @db.Uuid
  note            String?
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  booking       Booking               @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  changeRequest BookingChangeRequest? @relation(fields: [changeRequestId], references: [id], onDelete: SetNull)

  @@index([bookingId, status])
  @@index([status])
  @@map("booking_adjustments")
}
```

Back-relation bắt buộc ở model cũ (nếu thiếu `prisma validate` báo lỗi): `Booking.incidents / changeRequests / adjustments`, `BookingItem.incidents`, `BookingAccessoryItem.incidents`, `Payment.changeRequest`.

### 4.2 Cột thêm vào bảng cũ

```prisma
model Notification {
  // ...
  linkUrl String? @map("link_url")  // đường dẫn tương đối do server sinh, không nhận từ client
}
```

**Không** thêm `booking_items.rental_total` và **không** thêm cột vào `payments`. Nguồn "trước" của tiền là tổng đơn (`booking.subtotal/rentalTotal/discountTotal/depositTotal`) + `accessoryItem.rentalTotal`.

### 4.3 Migration SQL

`backend/prisma/migrations/20261110_booking_incidents_and_changes/migration.sql` (theo pattern của `20261105_booking_extensions`; dùng `IF NOT EXISTS` nếu repo đang dùng kiểu đó):

```sql
-- 1) Mỗi món chỉ 1 sự cố đang mở
CREATE UNIQUE INDEX booking_incidents_open_dedupe
  ON booking_incidents (dedupe_key)
  WHERE status IN ('open', 'awaiting_customer', 'needs_manager');

-- 2) Mỗi đơn chỉ 1 yêu cầu đổi đang chờ
CREATE UNIQUE INDEX booking_change_requests_one_pending
  ON booking_change_requests (booking_id)
  WHERE status IN ('quoted', 'awaiting_payment');

-- 3) RLS: deny-all cho anon/authenticated (backend Prisma dùng role owner/service nên không ảnh hưởng)
ALTER TABLE booking_incidents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_change_holds    ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_adjustments     ENABLE ROW LEVEL SECURITY;
```

---

## 5. Phát hiện sự cố

### 5.1 Hàm lõi — `booking-incidents.service.ts`

```ts
scanIncidents(now = new Date()): Promise<{ scanned: number; opened: number; resolved: number }>
evaluateBooking(bookingId: string, now?): Promise<void>  // gọi sau commit, KHÔNG nằm trong tx
```

`evaluateBooking`:
1. Đọc booking (status ∈ `PRE_HANDOVER_STATUSES`); nếu `rentalStartDate` **ngoài** `[today, today + INCIDENT_SCAN_WINDOW_DAYS]` → bỏ qua (đơn đã qua ngày thuê không mở sự cố đổi mẫu nữa).
2. Với từng `BookingItem`:
   - `garmentAssetId == null` → đơn được thử `autoAssignAssets(bookingId)` **một lần cho cả đơn**, và **chỉ khi** booking ở `AUTO_ASSIGNABLE_STATUSES` (`confirmed/awaiting_payment/paid/preparing`); vẫn null → `no_asset_available`.
   - asset `status ∈ {damaged, lost, retired, maintenance}` → `asset_*`.
   - `assertAssetScheduleAvailable` ném `ConflictException` → `asset_conflict`.
   - Ngược lại, nếu đang có incident mở cho item mà asset đã khỏe → `resolved` (`asset_recovered`).
3. Với từng `BookingAccessoryItem`: tương tự (`accessory_unavailable`, `asset_*`).
4. `INSERT` incident với `dedupeKey`; bắt `P2002` để không báo trùng.
5. Chỉ gửi thông báo khi **vừa tạo** incident (set `notifiedAt`, status → `awaiting_customer`).
6. **Giá dòng "trước" — phân bổ từ tổng đơn:**

```
garmentSubtotal = booking.subtotal − Σ accessoryItem.rentalTotal
weight_i        = item.dailyPrice × days          // chỉ là TRỌNG SỐ
lineRental_i    = allocate(garmentSubtotal, weight_1..weight_n)   // largest remainder, đơn vị VND
```
   - Bất biến: `Σ lineRental_i === garmentSubtotal` (chính xác đến đồng).
   - 1 dòng áo ⇒ `lineRental = garmentSubtotal`, `estimated: false` (chính xác tuyệt đối).
   - Nhiều dòng áo ⇒ `estimated: true` (chỉ lệch phân bổ chéo giữa các dòng, tổng vẫn đúng).
   - Hàm thuần `allocateGarmentLines(subtotal, accessoryItems, items)`, dùng lại ở §6/§8.1.

`scanIncidents` = `booking.findMany({ status in PRE_HANDOVER, rentalStartDate <= today + N, take: INCIDENT_SCAN_BATCH_SIZE })` rồi gọi `evaluateBooking` cho từng đơn.

### 5.2 Cron và điểm gọi

| Cron | Chu kỳ | Nhiệm vụ |
|---|---|---|
| `runIncidentScan` | `0 */30 * * * *` — mỗi 30 phút (Asia/Ho_Chi_Minh) | `scanIncidents()`; **return sớm nếu `INCIDENT_SCAN_ENABLED=false`** |
| `expireChangeRequests` | mỗi phút (`0 * * * * *`) | request `quoted/awaiting_payment` quá `holdExpiresAt` → `expired`; incident → `needs_manager`; báo manager 1 lần |

Kiểm tra ngay (không trong transaction, lỗi chỉ log): sau `bookings.service.create` commit; sau `advanceStatus` sang `confirmed/paid`; trong `afterPaymentPaid`. Endpoint demo `POST /bookings/staff/incidents/run-scan` gọi `scanIncidents()`.

### 5.3 Máy trạng thái

```
Sự cố:  open → awaiting_customer → (khách chọn) → resolved
                       └─ (khách từ chối / hết hạn giữ chỗ) → needs_manager → (Manager xử lý) → resolved
        asset khỏe lại ở lần quét sau → resolved (asset_recovered)

Yêu cầu: quoted → applied                       (đơn chưa thanh toán)
         quoted → awaiting_payment → applied    (đơn đã thanh toán, charge > 0)
         quoted | awaiting_payment → expired | cancelled
         awaiting_payment + tiền về nhưng hết hàng → needs_manager (không hoàn tự động)
```

Không có chuyển trạng thái nào tự hủy đơn, tự bỏ món hay tự hoàn tiền.

---

## 6. Công thức tiền

### 6.1 Đầu vào

```
days             = round((end − start)/DAY) + 1
oldSubtotal      = booking.subtotal
oldDiscount      = booking.discountTotal
oldRentalTotal   = booking.rentalTotal
oldDeposit       = booking.depositTotal           // = Σ item.depositAmount
oldAccessoryRent = Σ accessoryItem.rentalTotal    // snapshot chính xác
```

Giá mới **chốt lúc báo giá**, không tính lại khi áp dụng:

```
newLine(size)  = pricing.quoteRental([sizeId], startDay, endDay).rentalTotal
newDeposit(size) = garment_sizes.deposit_amount
accLine        = unitPrice × days        // unitPrice = is_included ? 0 : extra_price
```

### 6.2 Công thức

```
oldLine               = incident.snapshot.lineRental          // §5.1 bước 6
changedGarmentDelta   = Σ_changed (newLine − oldLine)
changedAccessoryDelta = Σ(phụ kiện thêm) − Σ(phụ kiện bỏ)

newSubtotal     = oldSubtotal + changedGarmentDelta + changedAccessoryDelta
newDiscount     = min(oldDiscount, newSubtotal)               // không tăng, không xét lại điều kiện
newRentalTotal  = newSubtotal − newDiscount                   // ≥ 0
newDepositTotal = oldDeposit + Σ_changed (newDeposit − oldDeposit)

rentDelta       = newRentalTotal − oldRentalTotal
accessoryDelta  = changedAccessoryDelta
depositDelta    = newDepositTotal − oldDeposit
rentComponent   = rentDelta − accessoryDelta                  // phần "áo + voucher", đúng dấu cả khi clamp
// bất biến: rentComponent + accessoryDelta = rentDelta
```

Vì sao `oldLine` không làm lệch tổng: `Σ oldLine = garmentSubtotal`, nên `newSubtotal = oldSubtotal + delta` giữ nguyên phần không bị đổi. Đơn **1 dòng áo** cho số tiền chính xác tuyệt đối. Đơn nhiều dòng áo đổi nhiều dòng cùng lúc: tổng vẫn khớp nhưng phân bổ giữa các dòng chỉ là ước tính (ghi ở §14).

**Sổ điều chỉnh** — mỗi thành phần 1 dòng, 1 chiều:

```
rent           : |rentComponent|   charge nếu > 0, credit nếu < 0
accessory_rent : |accessoryDelta|  charge nếu > 0, credit nếu < 0
deposit        : |depositDelta|    charge nếu > 0, credit nếu < 0

chargeAmount = max(0, rentComponent) + max(0, accessoryDelta) + max(0, depositDelta)   // = Σ dòng charge
creditAmount = max(0, −rentComponent) + max(0, −accessoryDelta) + max(0, −depositDelta)
```

Quy ước bù trừ: **trong** tiền thuê áo thì cộng dồn; **giữa** thuê / phụ kiện / cọc thì **không** bù trừ (áo +100k, phụ kiện −60k ⇒ thu 100k và ghi credit 60k).

### 6.3 Ví dụ đối chiếu (dùng làm test)

**Đơn gốc:** A 400k, B 300k, phụ kiện 100k, voucher 100k → subtotal 800k, rentalTotal 700k, cọc 1.000k (A 400k + B 600k).

- **(a) Đổi A → C (500k, cọc 600k), giữ phụ kiện:** `rentComponent = +100k`, `depositDelta = +200k` → charge 300k (2 dòng: thuê 100k, cọc 200k).
- **(b) Bỏ A, giữ B + phụ kiện:** `rentComponent = −400k`, `depositDelta = −400k` → 2 credit (thuê 400k, cọc 400k). Đơn chưa thanh toán: chỉ cập nhật `rentalTotal = 300k`, `depositTotal = 600k`.
- **(c) Bỏ món làm voucher vượt:** A 320k + B 80k, voucher 100k, rentalTotal 300k. Bỏ A: `newSubtotal = 80k`, `newDiscount = 80k` (clamp), `newRentalTotal = 0`, `rentComponent = −300k` (credit đúng bằng tiền đã trả). `voucher_usages.discount_amount = 80k`, không release voucher.
- **(d) Đổi sang mẫu rẻ hơn khi voucher đang clamp:** A 600k, voucher 500k (`rentalTotal = 100k`). Đổi sang C 300k: `newDiscount = 300k`, `newRentalTotal = 0`, `rentComponent = −100k` → credit **100k**, không phải 300k (200k còn lại là voucher bị clamp, khách chưa từng trả).
- **(e) Áo tăng, phụ kiện giảm:** A 300k, phụ kiện P 100k, không voucher. Đổi A → C 400k và bỏ P: `rentComponent = +100k`, `accessoryDelta = −100k` → `chargeAmount = 100k`, `creditAmount = 100k` (không bù trừ).

### 6.4 Voucher
Không gọi `vouchers.evaluate` khi đổi/bỏ. `discountTotal = min(oldDiscount, newSubtotal)`, cập nhật `voucher_usages.discount_amount`, không release voucher. Bỏ **tất cả** món → chuyển sang luồng hủy đơn (hành vi cũ).

---

## 7. Luồng đổi mẫu

### 7.1 Khách xem sự cố + gợi ý
`GET /bookings/:id/incidents` — chỉ trả sự cố của đúng booking (`booking.customerId === user.id`, kiểm tra riêng ngoài guard). Gợi ý dùng `BookingAutomationService.findAvailableAlternatives` + `checkAvailability` cho đúng khoảng ngày, loại asset đang bị hold bởi yêu cầu khác. Tối đa 8 gợi ý.

### 7.2 Tạo báo giá + giữ chỗ 30 phút
`POST /bookings/:id/incidents/change-requests` với `{ type: "replace"|"remove", incidents: [...], keepAccessoryItemIds, removeAccessoryItemIds, addAccessories }`.

Trong **một** `runSerializable` (không gọi mạng):
1. `SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE`.
2. Kiểm tra: booking thuộc khách, status ∈ `PRE_HANDOVER_STATUSES`, không có yêu cầu đang chờ khác, không có `BookingExtension` pending.
3. Mẫu mới: `pricing.quoteRental`; chọn **asset cụ thể** (`rankAssetCandidates` + `assertAssetScheduleAvailable` cho từng ứng viên, đã tính hold).
4. Phụ kiện: `loadAccessoryInventory` + `accessoryAvailability`; chọn `accessory_assets` cụ thể.
5. Tạo `BookingChangeRequest` (`quoted`, `holdExpiresAt = now + 30′`) + `BookingChangeHold` + snapshot trước/sau.
6. Trả báo giá: `rentBefore/After`, `rentComponent`, `accessoryDelta`, `depositBefore/After/Delta`, `discountBefore/After`, `chargeNow`, `accruedCredit`, `lines[]` (mỗi dòng có `component`, `direction`, `amount`), `paymentRequired`, `countdownSeconds`. FE hiển thị tách "Thu thêm hôm nay" và "Sẽ hoàn lại khi trả đồ", không tự cộng trừ.

### 7.3 Khách xác nhận
`POST /bookings/:id/change-requests/:requestId/confirm`

> **Định nghĩa "đã thanh toán" (dùng thống nhất ở mọi chỗ):** đơn được coi là **đã thanh toán** khi có **ít nhất 1 `Payment` có `status = paid`** — kể cả `provider = "manual"` (thu tiền tại quầy qua `markPaid`) lẫn PayOS. **Chưa thanh toán** = chưa có `Payment` nào `paid` (đơn cash chưa thu, hoặc mới chỉ có `Payment` `pending`). Đây là điều kiện phân nhánh ở mọi bước (đổi mẫu, bỏ món, hủy đơn, hoàn cọc).

**Đơn chưa thanh toán** (chưa có `Payment` nào `paid`):
1. (Ngoài tx) Nếu có PayOS intent pending → `releaseClosedPayosIntents`. Nếu PayOS báo `PROCESSING/PAID/UNDERPAID` hoặc **không đọc được trạng thái** → `409` "đang có giao dịch chờ xử lý", không áp dụng.
2. `POST /bookings/:id/change-requests/:requestId/confirm` (`confirmChangeRequest`) → `runSerializable`: lock booking; đọc lại status (nếu vừa thành `paid` → sang nhánh đã thanh toán); **kiểm tra lại không có `Payment` nào của đơn vừa `paid`** (nếu có → `409`); xác thực hold còn hạn/asset vẫn trống; gán `garmentAssetId` / tạo dòng phụ kiện / cập nhật `depositAmount`; cập nhật tổng đơn (`rentalTotal`/`depositTotal`/`discountTotal`) + `voucher_usages.discount_amount`. **KHÔNG tạo `booking_adjustments`**: đơn chưa thu đồng nào nên không có gì để hoàn/thu thêm — tiền chênh tự nằm trong tổng đơn mới. incident → `resolved`, request → `applied`; ghi `booking_status_history` + `AuditLog`. **Consume hold và gán asset phải cùng một transaction.**
3. Không tạo payment. Nếu đơn `awaiting_payment` + QR: dời `paymentDueAt` thêm 30′ để cron hủy-đơn-quá-hạn không hủy ngay.

**Riêng đơn `store_pickup` + tiền mặt, chưa thanh toán** (nhận tại cửa hàng, `paymentMethod = "cash"`, **chưa có `Payment` pending lẫn `paid`**):
- Cash không tạo `Payment` lúc đặt đơn ⇒ không có PayOS intent để `releaseClosedPayosIntents`; bước 1 là no-op, không cần 409. (Nếu khách đã chọn QR và có `Payment` `pending` thì **không** thuộc đoạn cash này — đi bước 1 xử lý PayOS intent như bình thường.)
- Khi áp dụng (bước 2), **cập nhật tổng đơn ngay trong cùng tx** (`rentalTotal`, `depositTotal`, `discountTotal` theo §6) và `BookingItem.depositAmount`; **không ghi `booking_adjustments`** (chưa thu đồng nào nên không có gì để hoàn/thu thêm). **Không** tạo PayOS link, **không** gọi `createPaymentLink`.
- Chênh lệch thu/hoàn được thu khi nhận đồ: staff gọi `PATCH /bookings/:id/mark-paid`, `markPaid` đọc **tổng đơn hiện tại** (`rentalTotal + shippingFee`, `depositTotal`) nên tự gồm phần chênh lệch mới; vì chưa có credit nên hoàn cọc khi trả đồ = `depositTotal − penalty` (§11). Không đụng thêm gì.

**Riêng đơn `store_pickup` đã thanh toán** (khách đã tạo link PayOS và tiền về trước khi áp dụng): xử lý y như nhánh "Đơn đã thanh toán" bên dưới (charge > 0 → PayOS bổ sung; charge = 0 → áp dụng ngay).

**Đơn đã thanh toán:**
1. Tính `chargeAmount` từ quote đã chốt. `chargeAmount == 0` → áp dụng ngay (credit `accrued`).
2. `chargeAmount > 0` → request `awaiting_payment`; **ngoài tx** tạo Payment + PayOS: `amount = chargeAmount`, `depositAmount = max(0, depositDelta)`, `paymentMethod = qr_code`, `expiredAt = holdExpiresAt`, chỉ các dòng **charge**. Trả `checkoutUrl` để FE mở `/booking/change-payment?requestId=...`. Phần credit không đưa vào link, ghi `accrued` khi áp dụng.
3. PayOS lỗi → Payment `cancelled`, request về `quoted`.

**Khi tiền về** (`afterPaymentPaid` gọi thêm `changeRequests.handlePaymentPaid(paymentId)`, bọc try/catch riêng):
- Tìm request theo `paymentId` + `awaiting_payment`; `runSerializable` kiểm tra lại hold/asset. Còn đủ → áp dụng (charge → `collected`, credit → `accrued`). **Hết hàng** → request + incident `needs_manager`, không hoàn tự động, báo manager.

### 7.4 Hết hạn / khách hủy
- `expireChangeRequests` (cron 10 phút): quá `holdExpiresAt` → `expired`, incident → `needs_manager`, báo manager.
- `PATCH /bookings/:id/change-requests/:requestId/cancel` → `cancelled`, hold hết tác dụng, incident về `awaiting_customer`.
- `POST /bookings/:id/incidents/:incidentId/decline` → incident `needs_manager`.

---

## 8. Luồng bỏ món và hủy đơn

### 8.1 Bỏ món
`type = "remove"`. Chỉ bỏ item của incident, không đụng item/phụ kiện khác. Áp dụng: lock booking → xóa `BookingItem` (cascade phụ kiện của item đó; snapshot đầy đủ lưu ở `beforeSnapshot` + `AuditLog`) → tính lại theo §6 → clamp voucher → incident `resolved`. **Đơn chưa thanh toán (chưa có `Payment` nào `paid`): chỉ cập nhật tổng đơn (và `BookingItem.depositAmount`/`voucher_usages`), KHÔNG ghi `booking_adjustments`.** Đơn đã thanh toán: ghi adjustments (`rent` theo `rentComponent`, `deposit` theo `depositDelta`, `accessory_rent` credit cho phụ kiện bị bỏ) ở trạng thái `accrued`, không hoàn ngay. Nếu bỏ hết món → chuyển sang luồng hủy đơn.

### 8.2 Hủy đơn
- Đơn chưa thanh toán: `PATCH /bookings/:id/cancel` hiện có; sau hủy incident → `resolved` (`booking_cancelled`).
- Đơn đã thanh toán: tách `cancelBookingTx(tx, bookingId, actor, reason)` dùng chung (void credit → `releaseBookingAssets` → `ensureCancellationRefunds` → `voucher.releaseForBooking` → `cancelled` + history); refactor `cancel()` và `advanceStatus` gọi hàm này, hành vi cũ giữ nguyên. Thêm `POST /bookings/staff/:id/cancel` (`manager_owner`, `admin`; cho `paid/preparing/ready_for_pickup`; bắt buộc `reason`; chỉ khi đơn có incident đang mở; ghi `AuditLog` + history). Khách bấm hủy khi đã thanh toán → incident `needs_manager`, hiện hướng dẫn liên hệ cửa hàng.

### 8.3 Hủy đơn khi đã có credit `accrued` — bắt buộc void trước khi hoàn
`ensureCancellationRefunds` hoàn toàn bộ tiền đã thu, đã gồm phần credit đang treo. Để nguyên credit thì khách được hoàn 2 lần. Trong `cancelBookingTx`, **trước** `ensureCancellationRefunds`:

```ts
await tx.bookingAdjustment.updateMany({
  where: { bookingId, status: { in: ["accrued", "pending_payment"] } },
  data:  { status: "void", note: "void do hủy đơn" },
});
```

---

## 9. Phụ kiện

- Đổi mẫu: **giữ nguyên** toàn bộ `BookingAccessoryItem` và `rentalTotal` (khách vẫn thuê phụ kiện đó). Phụ kiện không tương thích mẫu mới thì vẫn giữ, chỉ cảnh báo trong báo giá.
- Bỏ phụ kiện: xóa dòng; đơn **đã thanh toán** ghi `accessory_rent` credit = `rentalTotal` của dòng; đơn **chưa thanh toán** chỉ cập nhật tổng đơn, **không ghi adjustment**.
- Thêm phụ kiện: chỉ chọn phụ kiện thuộc mẫu mới hoặc phụ kiện bổ sung hợp lệ; kiểm tồn kho đúng khoảng ngày; chọn `accessory_assets` cụ thể, `assertAccessoryAssetScheduleAvailable` (đã tính hold). Đơn **đã thanh toán**: ghi **1 dòng adjustment tổng** cho chênh phụ kiện (thêm − bỏ, lấy từ snapshot, không cộng lại tiền thuê dòng); đơn **chưa thanh toán**: chỉ cập nhật tổng đơn, **không ghi adjustment**.
- Kênh thu phần tăng: giao hàng hoặc đã thanh toán → PayOS bổ sung; `store_pickup` + chưa thanh toán → gộp vào tổng (trong cùng tx áp dụng), thu khi nhận đồ qua `markPaid` — hàm này đọc lại **tổng đơn hiện tại** (`rentalTotal + shippingFee`, `depositTotal`) nên tự khớp phần chênh lệch, chỉ tạo **1 payment `manual`** khi đơn chưa có payment `paid` nào.
- Lịch sử: `beforeSnapshot/afterSnapshot.accessoryItems`, `booking_adjustments` (chỉ đơn đã thanh toán), `AuditLog` action `booking.change_request.applied`.

---

## 10. Tồn kho, giữ chỗ và chống oversell

- Một hold = một asset **cụ thể** + khoảng ngày + hạn 30′. Hold chỉ "sống" khi `expiresAt > now` **và** `consumedAt IS NULL`. Bỏ cron `purgeExpiredChangeHolds` chỉ làm bảng lớn hơn, **không** được bỏ điều kiện `consumedAt` (hold đã tiêu thụ vẫn còn hạn sẽ bị đếm trùng với `BookingItem` đã trỏ asset đó → thừa demand).
- **Mọi truy vấn hold phải đi qua một hàm dùng chung** `loadActiveHolds(tx, { from, to, excludeBookingId?, excludeChangeRequestId? })` (lọc `expiresAt > now AND consumedAt IS NULL`) để không nơi nào sót điều kiện `consumedAt`. `loadSizeInventory`, `loadAccessoryInventory`, `assertAssetScheduleAvailable`, `assertAccessoryAssetScheduleAvailable` đều gọi hàm này, không tự viết `where` hold rời rạc.
- **Khử trùng khi đếm** (bắt buộc):
  1. Bỏ hold hết hạn hoặc đã `consumedAt`.
  2. Bỏ hold thuộc chính booking / chính change request đang xét (`excludeBookingId`, `excludeChangeRequestId`).
  3. Bỏ hold mà asset đã được một item khác giữ trong cùng khoảng.
  4. Mỗi hold chỉ cộng **+1** demand.

| Hàm | Sửa |
|---|---|
| `loadSizeInventory`, `loadAccessoryInventory` | Thêm hold (đã khử trùng) như span `+1` trong `inventoryEvents`; **tham số tùy chọn** `opts?: { excludeBookingId?, excludeChangeRequestId? }`, không truyền thì giữ nguyên hành vi cũ |
| `assertAssetScheduleAvailable`, `assertAccessoryAssetScheduleAvailable` | Ném `ConflictException` nếu asset bị hold bởi change request khác trùng khoảng ngày (+ buffer giặt); cùng tham số tùy chọn |
| `assignAsset`, `assignAccessoryAsset`, `autoAssignAssets`, `assertExtraDaysAvailable` | Đi qua 2 hàm trên ⇒ tự được bảo vệ |

**Test bắt buộc:** (1) hold của đơn X không làm giảm `available` khi tính với `excludeBookingId: X`, nhưng giảm đúng 1 với đơn khác; (2) asset vừa có item giữ vừa có hold chỉ cộng 1; (3) sau `apply`, `hold.consumedAt != null` **và** item đã trỏ asset trong cùng tx, `loadSizeInventory` chỉ thấy 1 demand; (4) hold hết hạn thì không còn tính; (5) 2 request đồng thời giữ cùng 1 asset chỉ 1 thành công.

---

## 11. Hoàn cọc

`inspections.service.finalizeBookingInspection` (dòng ~1788):

```ts
// trước
const refundAmount = Math.max(0, input.depositTotal - input.penaltyTotal);
// sau
const credits = await sumAccruedCredits(tx, input.bookingId); // Σ booking_adjustments(status='accrued', direction='credit')
const refundAmount = Math.max(0, input.depositTotal + credits - input.penaltyTotal);
```

- Trước khi tạo phiếu hoàn: `accrued` → `settled` + `refundId`.
- **Credit cộng vào phiếu hoàn cọc của đơn gốc**, tức phiếu sinh từ `findAuthoritativePaidPayment` (`depositAmount` lớn nhất, chọn payment có cọc) — đây chính là payment cọc ban đầu. **Không** cộng credit vào phiếu hoàn của payment bổ sung cho đổi mẫu (payment đó `depositAmount = 0`).
- Nếu `finalizeBookingInspection` tìm thấy phiếu hoàn **`pending`** của đơn → cộng credit vào `refund.amount` của phiếu đó (giữ "1 phiếu đang xử lý/đơn") và cập nhật `financialTransaction` tương ứng. **Chỉ cộng đúng phần `credits`** vào số tiền hiện có của phiếu (`newAmount = existingAmount + credits`), **KHÔNG** tính lại `depositTotal − penalty`; `reason` ghi "Thực hoàn: newAmount".
- `refunding` = tiền **có thể đang được chuyển** → **KHÔNG sửa `amount`** của phiếu đó. `refunding` / `refunded` / `partially_refunded` → tạo **phiếu MỚI** chỉ cho phần credit (không hồi sinh phiếu cũ).
- **Hủy đơn là luồng khác:** `void` credit (`accrued`/`pending_payment`) **trước** `ensureCancellationRefunds` (§8.3), áp dụng cho **cả 3 đường hủy**: `cancel()` của khách, `advanceStatus` (nếu đi → `cancelled`) và endpoint Manager `POST /bookings/staff/:id/cancel`. Phần tiền thu của payment bổ sung cho đổi mẫu vẫn được hoàn vì đã thu thật (`ensureCancellationRefunds` hoàn theo toàn bộ `paidPayments`).
- `refund.reason`: `Cọc: X − Phạt: Y + Điều chỉnh đổi mẫu/bỏ món: Z ➔ Thực hoàn: N`.
- Netting: `max(0, cọc + credit − phạt)`. Đơn chưa từng thanh toán không có credit.
- Không đổi hành vi đơn không sự cố: `sumAccruedCredits` trả 0 khi không có adjustment.

---

## 12. Thanh toán bổ sung (PayOS)

- **Không** gọi PayOS trong transaction. Tạo `Payment` intent trong `runSerializable` + advisory lock `payments:payos-order-code`, gọi PayOS **sau** commit.
- `Payment.depositAmount = phần cọc thu thêm` để `markAsPaidTx` tách doanh thu thuê/cọc.
- Webhook giữ nguyên (chữ ký, `code === "00"`, VND, amount khớp). `markAsPaidTx` giữ nguyên `pending → paid`, không nới rộng.
- **Tiền về muộn sau khi intent đã `cancelled/failed`:** ngay trong `handleWebhook` (sau khi đã verify chữ ký + `code === "00"` + VND + amount khớp), nếu payment khớp có `status ∈ {cancelled, failed}` → ghi **1 `financialTransaction`** `transactionType = "payment_unmatched"` (`amount`, `paymentId`, `note = orderCode`), rồi `notifyRoles([manager_owner], "booking.staff.payment_unmatched")`. Idempotent: dedupe theo `paymentId` + `transactionType` (webhook gửi lại không tạo dòng thứ hai, không báo lần hai). **Không** đổi trạng thái đơn, **không** tự hoàn, **không** nới `markAsPaidTx`. Hoàn tiền xử lý thủ công. (`transactionType` là `String`, không phải enum → không cần migration.)
- Đơn đã `paid/preparing/...` giữ nguyên status sau thanh toán bổ sung; không đụng `paymentDueAt`.
- `handlePaymentPaid` tìm request theo `paymentId` **không lọc status**: `awaiting_payment` → áp dụng (chạy lại no-op); `expired`/`cancelled` + payment `paid` → request + incident `needs_manager`, báo manager, không tự hoàn; `applied`/`needs_manager` → no-op.
- **Luồng thực tế:** `confirmChangeRequest` (đơn đã thanh toán + `chargeAmount > 0`) tạo link qua `PaymentsService.createChangeRequestPaymentLink` **ngoài transaction áp dụng** → request `awaiting_payment` + lưu `paymentId`, `checkoutUrl` (lỗi PayOS → payment `cancelled`, trả `400`, request vẫn `quoted`). Khi tiền về (`afterPaymentPaid` → `changeRequests.handlePaymentPaid`): charge line → `collected` + `paymentId`, credit line → `accrued`; áp dụng xong request `applied`. Hết hàng/giữ chỗ hết hạn (Conflict/BadRequest) → request + incident `needs_manager`, báo manager, **không tự hoàn**; lỗi `runSerializable` hết retry (`409` "Hệ thống đang bận") → ném lại để webhook/cron thử lại, không đẩy sang `needs_manager`.
- **Cron `expireChangeRequests` (10 phút/lần):** request `quoted/awaiting_payment` quá `holdExpiresAt`; nếu có `paymentId` → gọi `releaseClosedPayosIntents(bookingId)` **trước**; PayOS đang xử lý/không đọc được → `skipped` (không expire); payment đã `paid` → gọi `handlePaymentPaid` (áp dụng muộn); còn lại → `expired` + incident `needs_manager` + báo manager 1 lần.
- `GET /payments/change-requests/:requestId/status` (khách, kiểm tra chủ đơn): trả `status`, `paid`, `chargeAmount`, `checkoutUrl`, `countdownSeconds`; nếu payment còn `pending` thì đối soát PayOS trực tiếp (webhook có thể chưa về) rồi đọc lại request.
- Chặn khe hở giữa hủy intent và commit bằng hai lớp ở §7.3 (409 khi PayOS đang xử lý / không đọc được; kiểm tra lại payment `paid` trong transaction).

---

## 13. Thông báo, API, giao diện

### 13.1 Thông báo (1 lần khi phát hiện)
| Key | Đối tượng | Link |
|---|---|---|
| `booking.incident_action_required` | Khách | `/booking/incidents/{bookingId}` |
| `booking.staff.incident_open` | Manager | `/dashboard/manager/incidents` |
| `booking.incident_resolved` | Khách | `/dashboard/customer` |
| `booking.staff.payment_unmatched` | Manager | (không link) — tiền về muộn sau khi intent `cancelled/failed` (§12) |

`linkUrl` chỉ nhận đường dẫn tương đối do server sinh (tránh open-redirect/XSS). FE `notifications/page.tsx` render `Link` khi có `linkUrl`. Email thêm biến `{{linkUrl}}`, template cũ không có biến thì bỏ qua.

### 13.2 API
**Khách** (`JwtAuthGuard`, role `customer`, mọi handler kiểm tra `booking.customerId === user.id`):

| Method | Path | Chức năng |
|---|---|---|
| GET | `/bookings/:id/incidents` | Sự cố + gợi ý |
| POST | `/bookings/:id/incidents/change-requests` | Báo giá + giữ chỗ (`replace`/`remove`) |
| GET | `/bookings/:id/change-requests/:requestId` | Chi tiết báo giá + countdown |
| PATCH | `/bookings/:id/change-requests/:requestId/cancel` | Hủy yêu cầu |
| POST | `/bookings/:id/change-requests/:requestId/confirm` | Xác nhận → áp dụng hoặc trả `checkoutUrl` |
| POST | `/bookings/:id/incidents/:incidentId/decline` | Từ chối → `needs_manager` |
| GET | `/payments/change-requests/:requestId/status` | Poll trạng thái thanh toán |

**Manager / Staff:**

| Method | Path | Role | Chức năng |
|---|---|---|---|
| GET | `/bookings/staff/incidents?status=&q=` | staff, manager | Danh sách sự cố: còn mở lên đầu (`status ASC`), trong nhóm đã xử lý sự cố vừa xử lý đứng đầu (`resolvedAt DESC`, NULL cuối), rồi `dueAt ASC`, `detectedAt ASC` |
| GET | `/bookings/staff/incidents/:id` | staff, manager | Chi tiết |
| POST | `/bookings/staff/incidents/:id/actions` | manager_owner, admin | `{action: cancel\|remove\|proposal}` |
| POST | `/bookings/staff/:id/cancel` | manager_owner, admin | Hủy đơn đã thanh toán (chỉ khi có incident mở) |
| POST | `/bookings/staff/incidents/run-scan` | manager_owner, admin | Chạy quét thủ công (demo) |

Tên role (`manager_owner`, `admin`, `staff`) cần đối chiếu với `RolesGuard`/enum thật khi viết controller. Không nhận `amount`/`price`/`customerId` từ client; guard chạy trước, ownership check là bước riêng.

> Trạng thái: **đã triển khai** các endpoint khách (bảng trên), `GET /payments/change-requests/:requestId/status` và **toàn bộ endpoint Manager/Staff** ở bảng dưới (list/detail/actions — commit §13.2). `staff` chỉ đọc; `actions` chỉ `manager_owner`/`admin` (RolesGuard + kiểm tra role trong service, reason bắt buộc).
>
> **Gợi ý mẫu thay thế cho manager (§13.3):** `GET /bookings/staff/incidents/:id` trả thêm mảng `suggestions` **dùng CHUNG `buildSuggestions`** với trang khách (`GET /bookings/:id/incidents`) — cùng nguồn (`loadSizeInventory`/asset còn trống) và cùng khoảng ngày thuê. Drawer manager render radio từ `detail.suggestions`; chọn size xong mới gửi `proposal`. Test: `booking-manager-incidents.spec.ts` (`getStaffIncident — gợi ý mẫu thay thế`).

Khi Manager chọn **xử lý thủ công**: tạo `BookingChangeRequest` `source = manager`, `quoted`, hold 30 phút (`INCIDENT_MANAGER_HOLD_MINUTES`), khách nhận thông báo kèm link để xác nhận. Manager có thể **xem trước email** rồi gửi (server dựng HTML; chỉ nhận `emailSubject`/`emailMessage` từ client). Nút trong email trỏ tới `${FRONTEND_URL}/booking/incidents/<bookingId>` — `FRONTEND_URL` phải được đặt bằng **domain đã deploy** ở môi trường production (mặc định `http://localhost:3000` chỉ dùng khi dev). Sau khi gửi email, khách của đơn xác nhận trên web và thanh toán phần chênh; hết hạn 30 phút cron mỗi phút tự giải phóng mẫu đã giữ. Manager **bỏ món**: áp dụng ngay qua pricing engine (đơn đã thanh toán → credit `accrued`; chưa thanh toán → 0 adjustment; bỏ hết món → `cancelBookingTx`), có `AuditLog` + history, incident `resolved`. Manager **hủy đơn**: dùng chung `cancelBookingTx` (void credit trước refund → release asset → refund → trả voucher → `cancelled` + history), incident `resolved` (`booking_cancelled`). Cả `cancel` và `remove`: nếu đơn có request `awaiting_payment` / Payment PayOS `pending` thì **đóng PayOS intent trước** (`releaseClosedPayosIntents` strict); PayOS đang xử lý/không đọc được/đã thu tiền → `409`, không tiếp tục. Endpoint không nhận `amount`/`price`/`customerId` từ client. Request `source=manager` dùng chung route khách để xác nhận/hủy/từ chối (không lọc theo `source`; ownership + hold check như request khách); khách từ chối → incident về `needs_manager`.

### 13.3 Giao diện
- `booking/incidents/[bookingId]/page.tsx` (mẫu `booking/extension/page.tsx`): danh sách món bị ảnh hưởng; 3 tab (đổi mẫu → chọn mẫu → phụ kiện → báo giá → nút "Giữ chỗ 30 phút & xác nhận" có countdown; bỏ món; hủy đơn). Dòng có `estimated: true` hiện nhãn "ước tính". Lỗi: hold hết hạn (đếm ngược 0 → disable nút + "Chọn lại"), 409, hết hàng.
- `booking/change-payment/page.tsx`: sao chép trang extension, poll 3 giây, 4 trạng thái (đang chờ / đã áp dụng / hết hạn / cần cửa hàng hỗ trợ).
- `dashboard/manager/incidents/page.tsx`: bảng (mã đơn, khách, ngày thuê, còn N ngày, món sự cố, trạng thái) sắp theo `status ASC` (sự cố còn mở lên đầu), rồi `resolvedAt DESC` (sự cố vừa xử lý xong đứng đầu nhóm đã xử lý; hàng đợi không đẩy sự cố vừa xong xuống cuối), `dueAt ASC` (= `rentalStartDate`, đơn sát ngày ưu tiên trước), tie-break `detectedAt ASC`; drawer chi tiết với 3 phương án + lý do bắt buộc; nút "Quét ngay" gọi `run-scan`.
- `dashboard/customer/page.tsx`: banner khi có incident mở. `lib/api.ts`: thêm types + các hàm tương ứng API ở §13.2.
- Dùng component/typography hiện có, không thêm thư viện UI; mobile: báo giá dạng bottom sheet, countdown luôn hiển thị.

---

## 14. Hạn chế và hướng phát triển (ghi vào báo cáo)

Các điểm cố ý **không** làm trong đồ án:
- Nhắc lại, leo thang theo mức, bản tin digest, feature flag bảng settings (chỉ dùng `INCIDENT_SCAN_ENABLED`).
- Payment QR cũ về muộn sau khi đã đổi mẫu: chặn bằng 409 / kiểm tra trong transaction; nếu tiền vẫn về sau khi intent đã `cancelled/failed` thì **được ghi nhận** (`financialTransaction` `payment_unmatched`) và **báo manager**; **hoàn tiền xử lý thủ công**.
- Thanh toán về mà hết hàng: request + incident `needs_manager`, **không tự hoàn**; chưa có cơ chế tự hoàn/retry áp dụng. Áp dụng muộn (tiền về sau `holdExpiresAt`) vẫn **kiểm tra lại asset trống** trước khi áp dụng — không đủ hàng → `needs_manager`.
- Lỗi `409` "Hệ thống đang bận" (hết lượt retry SERIALIZABLE) trong `handlePaymentPaid` **không** đẩy sang `needs_manager`; request vẫn `awaiting_payment` và chỉ được cron `expireChangeRequests` thử lại **sau khi hold đã hết hạn** (cron xử lý request có `paymentId` đã `paid` trước khi expire). Webhook gửi lại có thể áp dụng sớm hơn.
- Đơn **nhiều dòng áo** đổi nhiều dòng cùng lúc: tổng chính xác nhưng giá từng dòng là phân bổ ước tính (đơn 1 dòng áo thì chính xác tuyệt đối).
- Thông số (N = 2 ngày, hold 30 phút...) là hằng số trong code, chưa cấu hình được.
- Banner sự cố ở `dashboard/customer/page.tsx` đang gọi API theo **từng đơn** để lấy trạng thái incident mở (N request cho N đơn đang thuê). Hướng phát triển: **gộp thành 1 API** (ví dụ `GET /bookings/customer/open-incidents`) trả về incident mở của mọi đơn của khách trong 1 lần gọi, giảm số round-trip và tránh N+1 ở client.
- **Test §10(5) "2 request đồng thời giữ cùng 1 asset": không viết ở dạng unit test.** Repo chưa có hạ tầng test DB thật (không testcontainers/DATABASE_URL test; `chat.e2e.spec.ts` chỉ là đơn vị in-memory), nên không tạo hạ tầng mới. **Cơ chế chống oversell thật là SERIALIZABLE + retry** (`runSerializable` lấy snapshot SERIALIZABLE, bắt `P2034`/40001, retry 3 lần, hết lượt → `409` "vui lòng thử lại"). `SELECT ... FOR UPDATE` trên booking chỉ khóa theo đơn; **khóa advisory theo nhóm size/accessory** (`pg_advisory_xact_lock(hashtext($1))`, tham số hóa) chỉ giúp **giảm tranh chấp** — snapshot có thể đã lấy trước khi lấy khóa nên KHÔNG tự nó chống oversell. Kiểm chứng tay trên DB dev (2 ca):
  1. Hai `POST /bookings/:id/incidents/change-requests` song song (2 đơn khác nhau cùng chọn 1 size chỉ còn đúng 1 asset) → đúng 1 request thành công, request kia `409` hết hàng.
  2. Một đơn thường tạo song song (auto-assign asset) với một change request cùng size → đúng 1 bên thành công, bên kia `409`.

---

## 15. Kiểm thử

| File | Nội dung |
|---|---|
| `booking-change-pricing.spec.ts` | Ví dụ §6.3 (a)–(e); voucher clamp; thuê/phụ kiện/cọc tách rời; làm tròn VND; `chargeAmount = Σ dòng charge`; `allocateGarmentLines`: `Σ lineRental === garmentSubtotal`, 1 dòng ⇒ `estimated: false` |
| `booking-incidents.spec.ts` | Cửa sổ `[hôm nay, hôm nay + N]` (`gte` + `lte`), bỏ qua đơn đã qua ngày thuê, tự gán asset 1 lần/đơn & chỉ khi trạng thái cho phép, dedupe P2002, resolve khi asset hồi, chỉ notify khi mới tạo |
| `booking-change-holds.spec.ts` | 5 test hold ở §10 |
| `booking-inventory.spec.ts` (sửa) | Hold vào `committed/available` của size + phụ kiện; không đếm hold hết hạn |
| `booking-change-requests.spec.ts` | Tạo: chưa thanh toán (`accruedCredit = 0`), đổi mẫu (giá mới + chọn asset + hold), khóa advisory gọi trước khi tạo hold; Áp dụng (`confirmChangeRequest`): **§10 #3** consume hold + gán asset, **đơn chưa thanh toán → 0 dòng `booking_adjustments`**, **đơn đã thanh toán → đúng dòng credit `accrued`**, đơn vừa `paid` → 409, **charge > 0 → tạo PayOS link ngoài tx + request `awaiting_payment` (chưa gán asset, chưa ghi adjustment)**, bỏ hết món → hủy đơn, hold hết hạn → 409; `handlePaymentPaid`: áp dụng (charge `collected` + `paymentId`), idempotent khi không còn `awaiting_payment`, hết hàng/hết hạn giữ chỗ → `needs_manager` + báo manager + không refund, **giữ chỗ hết hạn nhưng asset còn trống → áp dụng muộn**, **request `cancelled`/`expired` + tiền về → `needs_manager` (chạy lại no-op)**; `expireChangeRequests`: expired + incident `needs_manager`, đóng PayOS trước (strict) / PayOS đang xử lý → `skipped`, payment đã `paid` → áp dụng muộn; `cancelChangeRequest` khi `awaiting_payment`: đóng PayOS intent trước, PayOS đang xử lý/không đọc được → 409 không hủy |
| `settlement.helper.spec.ts` (bổ sung) | Credit cộng vào hoàn cọc; không credit → hành vi cũ; **hủy đơn khi có `accrued` → void trước, không hoàn 2 lần**; `sumAccruedCredits`; `settleAccruedCredits` (có/không `refundId`) |
| `booking-reservations.spec.ts` (bổ sung) | `cancelBookingTx`: void credit **trước** refund, refund trước `cancelled`+history, release voucher; trả `false` khi `fromStatus` đã đổi |
| `inspections-complete.spec.ts` (bổ sung) | `finalizeBookingInspection`: có credit → cộng vào phiếu + settle; không credit → hành vi cũ; phiếu đang xử lý → cộng vào chính phiếu; phiếu đã `refunded` → tạo phiếu mới; refund 0 còn credit → settle `refundId null` |
| `app-boot.spec.ts` | Compile `AppModule` thật (`TestingModule`) — chứng minh vòng `forwardRef` Bookings ↔ Payments resolve, `BookingChangeRequestsService.payments` được inject |
| `payments.change-request.spec.ts` | `createChangeRequestPaymentLink`: intent đúng charge + `depositAmount`, gọi PayOS **sau** intent, `expiredAt` = `holdExpiresAt`, return/cancel URL; PayOS lỗi → intent `cancelled` + 400. `afterPaymentPaid` → dispatch `handlePaymentPaid`, nuốt lỗi (không làm hỏng webhook). `getChangeRequestStatus`: chủ đơn nhận `status/paid/chargeAmount/countdown`, khách khác → 403 |
| `payments.service.spec.ts` (bổ sung) | Webhook payment đã `cancelled/failed` → 1 `financialTransaction` `payment_unmatched` + 1 thông báo manager; gọi lại không tạo dòng thứ hai |
| `booking-manager-incidents.spec.ts` | §13.2: list sắp `dueAt ASC, detectedAt ASC` + mã đơn/khách/số ngày còn lại; **§13.3: `getStaffIncident` trả `suggestions` cùng nguồn `buildSuggestions` với trang khách (lọc option `available > 0`), 404 khi không có sự cố**; `staff` gọi actions → 403; thiếu reason → 400; sự cố đã xử lý → 409; `cancel` (đơn paid → void credit trước refund + incident `booking_cancelled` + AuditLog; đơn chưa thanh toán cũng đi `cancelBookingTx`); `remove` (áp dụng ngay, đơn paid → credit `accrued`, incident `resolved`); `proposal` (`source=manager`, hold 24h, incident `awaiting_customer`, báo khách kèm `linkUrl`); **cancel/remove khi có request `awaiting_payment`: đóng PayOS strict trước, PayOS lỗi → 409 không hủy/không tạo request**; khách xác nhận được request `source=manager`, khách từ chối → incident `needs_manager` |
| FE | `booking/incidents/page.test.tsx` (món bị ảnh hưởng, countdown, disable khi hết hạn, báo giá tách thuê/cọc), `change-payment/page.test.tsx` (4 trạng thái), `notifications/page.test.tsx` (render link), `dashboard/manager/incidents/page.test.tsx` (giữ thứ tự server, lọc/tìm, drawer, 3 phương án + lý do bắt buộc, hộp xác nhận, lỗi 409/hết hàng, **radio gợi ý lấy từ `detail.suggestions` + chặn gửi khi chưa chọn**, staff chỉ xem/admin thấy nút, nhãn “Quá hạn N ngày” cho đơn đã qua ngày thuê), `lib/safe-link.test.ts`, `notification-bell.test.tsx` (render link nội bộ, chặn link nguy hiểm) |

Hồi quy bắt buộc (chạy cục bộ trước mỗi commit):
```bash
cd backend  && npm run lint && npm run typecheck && npm run test
cd frontend && npm run lint && npm run typecheck && npm run test && npm run build
```
Baseline cuối (sau Phase 6): backend `1254 passed | 5 skipped`; frontend `270 passed` (56 files). Không được giảm số test.

---

## 16. Phân phase (~6 ngày)

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | 4 bảng + `link_url` + 2 index + RLS, `prisma validate` | ✅ xong |
| 1 | Incident scanner + dedupe + 1 thông báo + `run-scan` + cron + hook sau tạo/xác nhận/thanh toán | ✅ xong |
| 2 | Pricing engine (`allocateGarmentLines`, delta, voucher clamp, adjustments) + test §6.3 | ✅ xong |
| 3 | Change request API + holds + tích hợp inventory + test concurrency | ✅ xong |
| 4 | Apply replace/remove + `cancelBookingTx` + Manager cancel + void credit + settle credit | ✅ xong |
| 5 | PayOS bổ sung + `handlePaymentPaid` + cron `expireChangeRequests` | ✅ xong |
| 5b | §13.2 manager/staff incident endpoints (list/detail/actions, reason bắt buộc) | ✅ xong |
| 6 | FE khách + FE manager + banner + `linkUrl` | ✅ xong (6a khách `c364e15`, 6b manager trang `dashboard/manager/incidents`) |

> Phase 6b (`dashboard/manager/incidents`): bảng giữ đúng thứ tự server (`dueAt ASC, detectedAt ASC`), lọc `status` + tìm `q`; drawer chi tiết với 3 phương án (đổi mẫu = `proposal`, bỏ món, hủy đơn), lý do bắt buộc, hộp xác nhận trước khi hủy đơn/bỏ món; nút "Quét ngay" (`run-scan`). Chỉ `manager_owner`/`admin` thấy nút hành động + "Quét ngay"; `staff` chỉ xem. Hiển thị nguyên văn lỗi server (409/hết hàng); FE không tự tính tiền. `isSafeLink` tách ra `frontend/src/lib/safe-link.ts` dùng chung cho trang khách và `NotificationBell` (manager/staff).
>
> **Trạng thái cuối:** Phase 0–6 đều ✅ xong. Baseline test: backend `1258 passed | 5 skipped`; frontend `271 passed`. Riêng test concurrency §10(5) (2 request song song cùng 1 asset) chạy tay trên DB dev — xem `docs/KIEM_THU_THU_CONG_MUC_4_4.md`.
>
> **Hotfix sau kiểm thử web (2026-11-10):**
> - `scanIncidents`/`evaluateBooking` chỉ xét cửa sổ **`[hôm nay, hôm nay + 2 ngày]`** (`gte` + `lte`). Trước đó thiếu `gte` nên đơn kẹt trạng thái trước bàn giao với ngày thuê đã qua vẫn bị quét → tự mở sự cố quá hạn.
> - Tự gán asset chỉ gọi **một lần cho cả đơn** và **chỉ khi** trạng thái ∈ `AUTO_ASSIGNABLE_STATUSES` → hết WARN `Không thể tự gán khi booking đang ở trạng thái 'pending_confirmation'`.
> - Danh sách manager trả thêm `daysOverdue`; FE hiển thị **“Quá hạn N ngày”** thay vì gộp mọi đơn cũ thành “Hôm nay”.

Thứ tự commit: 0 → 1 → 2 → 3 → 4 → 5 → 6, mỗi phase một commit riêng (hoặc một nhóm commit liền nhau). Trước mỗi commit chạy lint, typecheck và test cục bộ; không làm đổi kết quả test cũ. Không tạo PR, không merge vào `main`.

Rollback: chỉ có duy nhất env `INCIDENT_SCAN_ENABLED` (không có feature flag/bảng settings); đặt `false` để tắt cron quét, nếu lỗi thì `git revert` commit của phase tương ứng. Không cần revert migration (bảng/cột thêm mới, không ảnh hưởng đơn thường).
