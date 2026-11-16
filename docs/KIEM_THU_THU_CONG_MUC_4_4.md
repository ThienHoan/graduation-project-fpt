# Kiểm thử thủ công — Mục 4.4 “Đổi mẫu khi có sự cố”

Tài liệu này hướng dẫn **7 kịch bản kiểm tay trên DB dev** cho luồng đổi mẫu / bỏ món / hủy đơn.
Mỗi kịch bản gồm: dữ liệu chuẩn bị → thao tác (API/UI) → câu SQL kiểm kết quả → kết quả mong đợi.

Thay các placeholder trong ngoặc nhọn trước khi chạy:

| Placeholder | Nghĩa |
|---|---|
| `<BOOKING>` | UUID đơn (`bookings.id`) |
| `<INCIDENT>` | UUID sự cố (`booking_incidents.id`) |
| `<REQUEST>` | UUID yêu cầu đổi (`booking_change_requests.id`) |
| `<PAYMENT>` | UUID payment (`payments.id`) |
| `<ASSET>` | UUID asset (`garment_assets.id`) |
| `<NEW_ACCESSORY>` | UUID **mẫu phụ kiện khác** (`accessories.id`) nằm trong `garment_accessories` của trang phục chứa món lỗi |
| `<NEW_ACCESSORY_ASSET>` | UUID chiếc phụ kiện cụ thể (`accessory_assets.id`) — tuỳ chọn, bỏ trống để server tự chọn chiếc còn trống |
| `<SIZE>` / `<NEW_SIZE>` | UUID size cũ / size thay thế (`garment_sizes.id`) |
| `<CUSTOMER_TOKEN>` | JWT khách sở hữu đơn |
| `<MANAGER_TOKEN>` | JWT `manager_owner` |
| `<STAFF_TOKEN>` | JWT `staff` |

> Base URL API dev: `http://localhost:4000/api`. Mọi response bọc `{ success, data, message?, error? }`.
> Nguồn gợi ý mẫu: `GET /bookings/:id/incidents` (khách) và `GET /bookings/staff/incidents/:id` (manager) — **cùng nguồn**, cùng khoảng ngày thuê.

---

## Kịch bản 1 — Đơn tiền mặt CHƯA thanh toán: đổi mẫu rồi `markPaid`

**Mục tiêu:** đơn chưa thu tiền; đổi mẫu áp dụng ngay **không phát sinh adjustment**; khi thu tiền thì Payment = **tổng mới**.

### Chuẩn bị
- 1 đơn `status = confirmed`, `payment_method = cash`, chưa có payment `paid`.
- 1 dòng trang phục (`booking_items.garment_size_id = <SIZE>`).
- 1 sự cố mở trên dòng đó: `booking_incidents.status IN ('open','needs_manager','awaiting_customer')`, `item_kind='garment'`.
- Size thay thế `<NEW_SIZE>` còn ≥1 asset trống trong khoảng `[rental_start_date, rental_end_date]`.

```sql
-- Ghi lại tổng TRƯỚC khi đổi
SELECT id, status, rental_total, deposit_total FROM bookings WHERE id = '<BOOKING>';
SELECT id, garment_size_id FROM booking_items WHERE booking_id = '<BOOKING>';
```

### Thao tác
1. Tạo yêu cầu đổi mẫu (khách hoặc manager):
   ```
   POST /bookings/<BOOKING>/incidents/change-requests
   Authorization: Bearer <CUSTOMER_TOKEN>
   { "type": "replace", "incidents": ["<INCIDENT>"],
     "replacements": [{ "incidentId": "<INCIDENT>", "sizeId": "<NEW_SIZE>" }] }
   ```
   → trả `requestId`, `rentAfter`/`depositAfter` (tổng mới), `holdExpiresAt` (~10 phút), `chargeAmount` (sẽ dùng ở KB2).
2. Khách xác nhận:
   ```
   POST /bookings/<BOOKING>/change-requests/<REQUEST>/confirm
   Authorization: Bearer <CUSTOMER_TOKEN>
   ```
   Vì đơn **chưa paid** → áp dụng ngay, response **không** có `checkoutUrl`.
3. Staff thu tiền mặt (dùng tổng mới):
   ```
   PATCH /bookings/<BOOKING>/mark-paid
   Authorization: Bearer <STAFF_TOKEN>
   { "paymentMethod": "cash" }
   ```

### SQL kiểm kết quả
```sql
-- Payment phải bằng tổng MỚI (rentalTotal + shippingFee + depositTotal)
SELECT amount, deposit_amount, status, payment_method
FROM payments WHERE booking_id = '<BOOKING>' AND status = 'paid';

-- Đơn chưa thanh toán → KHÔNG có adjustment nào
SELECT count(*) AS adjustments FROM booking_adjustments WHERE booking_id = '<BOOKING>';

-- Yêu cầu đã áp dụng, hold đã tiêu thụ, item đã sang size mới
SELECT status, charge_amount, applied_at FROM booking_change_requests WHERE id = '<REQUEST>';
SELECT consumed_at FROM booking_change_holds WHERE change_request_id = '<REQUEST>';
SELECT garment_size_id FROM booking_items WHERE booking_id = '<BOOKING>';
```

### Kết quả mong đợi
- `payments`: **đúng 1** dòng `paid`, `amount = rental_total_mới + shipping_fee + deposit_total_mới`, `deposit_amount = deposit_total_mới`.
- `booking_adjustments`: **0 dòng**.
- `booking_change_requests.status = 'applied'`, `booking_change_holds.consumed_at IS NOT NULL`, `booking_items.garment_size_id = <NEW_SIZE>`.

---

## Kịch bản 2 — Đơn ĐÃ paid: đổi sang mẫu ĐẮT hơn → quét QR bổ sung → `applied`

**Mục tiêu:** phần chênh phải thu qua PayOS; chỉ áp dụng khi tiền về; ghi đúng 1 adjustment `charge` `collected`.

### Chuẩn bị
- 1 đơn `status = paid`, có payment `paid` (`<PAYMENT>`).
- 1 dòng trang phục, 1 sự cố mở.
- `<NEW_SIZE>` **đắt hơn** `<SIZE>` (để `chargeAmount > 0`), còn ≥1 asset trống.

```sql
SELECT status FROM bookings WHERE id = '<BOOKING>';           -- paid
SELECT id, amount, deposit_amount, status FROM payments
WHERE booking_id = '<BOOKING>' AND status = 'paid';           -- <PAYMENT>
```

### Thao tác
1. Tạo yêu cầu đổi mẫu như KB1 → response `chargeAmount > 0`.
2. Khách xác nhận:
   ```
   POST /bookings/<BOOKING>/change-requests/<REQUEST>/confirm
   ```
   Đơn **đã paid** + `chargeAmount > 0` → response trả `checkoutUrl` (PayOS); request chuyển `awaiting_payment`; **chưa** gán asset, **chưa** ghi adjustment.
3. Quét QR (PayOS sandbox / app test) để PayOS gửi webhook:
   ```
   POST /payments/webhook   (PayOS gọi server → server tự verify chữ ký)
   ```
   → `handlePaymentPaid`: payment `paid` → áp dụng muộn.
4. FE poll: `GET /payments/change-requests/<REQUEST>/status` tới khi `applied = true`.

### SQL kiểm kết quả
```sql
-- Payment bổ sung cho phần chênh (deposit 0)
SELECT amount, deposit_amount, status, provider, provider_transaction_id
FROM payments WHERE booking_id = '<BOOKING>' ORDER BY created_at DESC;

-- Adjustment charge đã thu
SELECT component, direction, amount, status, payment_id
FROM booking_adjustments WHERE booking_id = '<BOOKING>';

-- Request áp dụng + hold tiêu thụ + item đổi size + asset được gán
SELECT status, payment_id, applied_at FROM booking_change_requests WHERE id = '<REQUEST>';
SELECT consumed_at FROM booking_change_holds WHERE change_request_id = '<REQUEST>';
SELECT garment_size_id, garment_asset_id FROM booking_items WHERE booking_id = '<BOOKING>';

-- Dòng tiền ghi nhận khoản thu bổ sung
SELECT transaction_type, amount, payment_id
FROM financial_transactions WHERE booking_id = '<BOOKING>' ORDER BY created_at DESC;
```

### Kết quả mong đợi
- `payments`: có **thêm 1** dòng `paid`, `deposit_amount = 0`, `amount = chargeAmount`.
- `booking_adjustments`: **đúng 1** dòng `direction = 'charge'`, `status = 'collected'`, `payment_id` = payment bổ sung, `amount > 0`.
- `booking_change_requests.status = 'applied'`, `payment_id` đã set; hold `consumed_at` có giá trị; `booking_items` đã sang `<NEW_SIZE>` + có `garment_asset_id`.
- `financial_transactions`: có dòng `payment` cho phần thuê của payment bổ sung.

---

## Kịch bản 3 — Đơn ĐÃ paid: BỎ MÓN → trả đồ → `refund = cọc + credit − phạt`

**Mục tiêu:** bỏ món (không còn mẫu) sinh credit `accrued`; khi trả đồ, credit gộp vào phiếu hoàn cọc.

### Chuẩn bị
- 1 đơn `status = paid`, có payment `paid`.
- 1 dòng trang phục, 1 sự cố mở (không còn mẫu thay thế).
- Muốn kiểm cả phạt: chuẩn bị 1 hư hại để `penaltyTotal > 0` khi kiểm tra trả đồ (nếu không, đặt `penaltyTotal = 0`).

```sql
SELECT status, deposit_total FROM bookings WHERE id = '<BOOKING>';
SELECT id, deposit_amount, status FROM payments WHERE booking_id = '<BOOKING>' AND status = 'paid';
```

### Thao tác
1. Manager **bỏ món** (áp dụng ngay):
   ```
   POST /bookings/staff/incidents/<INCIDENT>/actions
   Authorization: Bearer <MANAGER_TOKEN>
   { "action": "remove", "reason": "Không còn mẫu thay thế" }
   ```
2. Đưa đơn tới bước trả đồ (staff): chuyển trạng thái theo vòng đời rồi trả:
   ```
   PATCH /bookings/<BOOKING>/mark-returned        (hoặc PATCH /bookings/<BOOKING>/status từng bước)
   ```
   → đơn về `returned`/`inspection_pending`.
3. Hoàn tất kiểm tra trả đồ (nếu đã kiểm xong trang phục + phụ kiện):
   ```
   POST /inspections/booking/<BOOKING>/finalize
   Authorization: Bearer <STAFF_TOKEN>
   ```
   → sinh phiếu hoàn cọc `pending`.

### SQL kiểm kết quả
```sql
-- Credit từ bỏ món đã tất toán vào phiếu hoàn
SELECT component, direction, amount, status, refund_id
FROM booking_adjustments WHERE booking_id = '<BOOKING>';

-- Phiếu hoàn = cọc + credit − phạt
SELECT amount, status, refund_method, reason
FROM refunds WHERE booking_id = '<BOOKING>' ORDER BY created_at DESC;

-- Dòng tiền hoàn
SELECT transaction_type, amount, refund_id
FROM financial_transactions WHERE booking_id = '<BOOKING>' ORDER BY created_at DESC;
```

### Kết quả mong đợi
- `booking_adjustments`: **đúng 1** dòng `direction = 'credit'`, `status = 'settled'`, `refund_id` = phiếu hoàn.
- `refunds`: **1 phiếu**, `amount = deposit_total + Σ credit − penalty_total` (khớp `reason` “Thực hoàn”), `status = 'pending'`.
- `financial_transactions`: có dòng `refund_cash_pending` (đơn tiền mặt) hoặc `refund_bank_transfer_pending` (đơn QR), `amount` = số hoàn.

---

## Kịch bản 4 — Hai request SONG SONG cùng chọn 1 asset → đúng 1 thành công

**Mục tiêu:** chống oversell bằng `runSerializable` + khóa advisory theo nhóm size; kẻ thua nhận `409`.

> Test tự động không dựng được DB thật (§14 docs) → **kiểm tay** tại đây.

### Chuẩn bị
- **2 đơn khác nhau** (`<BOOKING_A>`, `<BOOKING_B>`), cùng ngày thuê giao nhau, cùng cần `<NEW_SIZE>`.
- Kho `<NEW_SIZE>` trong khoảng ngày đó còn **đúng 1 asset** trống.
- Mỗi đơn có 1 sự cố mở trên dòng trang phục tương ứng.

```sql
-- Xác nhận chỉ còn 1 asset trống cho size/khoảng ngày (đối chiếu nguồn buildSuggestions)
SELECT count(*) FROM garment_assets
WHERE garment_size_id = '<NEW_SIZE>' AND status = 'available';
```

### Thao tác
1. Bắn **gần như đồng thời** 2 request (2 terminal, hoặc PowerShell `Start-Job`):
   ```
   POST /bookings/<BOOKING_A>/incidents/change-requests  { type:"replace", incidents:["<INCIDENT_A>"],
     replacements:[{ incidentId:"<INCIDENT_A>", sizeId:"<NEW_SIZE>" }] }
   POST /bookings/<BOOKING_B>/incidents/change-requests  { type:"replace", incidents:["<INCIDENT_B>"],
     replacements:[{ incidentId:"<INCIDENT_B>", sizeId:"<NEW_SIZE>" }] }
   ```
2. Ghi lại HTTP status của từng request.

### SQL kiểm kết quả
```sql
-- Chỉ 1 hold còn sống giữ asset cho size đó
SELECT h.id, h.change_request_id, h.booking_id, h.garment_asset_id, h.consumed_at, h.expires_at
FROM booking_change_holds h
JOIN garment_assets a ON a.id = h.garment_asset_id
WHERE a.garment_size_id = '<NEW_SIZE>' AND h.expires_at > now() AND h.consumed_at IS NULL;

-- Một request quoted (thành công), đơn kia không có request mới
SELECT booking_id, status, charge_amount FROM booking_change_requests
WHERE booking_id IN ('<BOOKING_A>', '<BOOKING_B>') ORDER BY created_at DESC;
```

### Kết quả mong đợi
- **Đúng 1** request trả `200` với `holdExpiresAt`; request còn lại trả **`409`** (hết hàng / vui lòng thử lại).
- `booking_change_holds`: **đúng 1** hold sống cho `<NEW_SIZE>`.
- Đơn thua: không tạo request/không chiếm asset.

---

## Kịch bản 5 — Manager hủy đơn khi đang có QR bổ sung chờ → quét QR CŨ → `payment_unmatched`, đơn vẫn `cancelled`

**Mục tiêu:** hủy đơn đóng intent PayOS trước; tiền về muộn chỉ **ghi nhận**, không mở lại đơn, không tự hoàn — báo manager.

### Chuẩn bị
- 1 đơn `status = paid`; 1 sự cố mở.
- Đã tạo **1 request đổi mẫu đắt hơn** ở trạng thái `awaiting_payment` **kèm intent PayOS `pending`** (làm KB2 bước 1–2, **chưa** quét QR).
- Giữ lại QR/link của intent đó để “quét muộn”.

```sql
SELECT r.id, r.status, r.payment_id, p.status AS payment_status, p.provider_transaction_id
FROM booking_change_requests r
LEFT JOIN payments p ON p.id = r.payment_id
WHERE r.booking_id = '<BOOKING>';   -- status='awaiting_payment', payment_status='pending'
```

### Thao tác
1. Manager **hủy đơn**:
   ```
   POST /bookings/staff/incidents/<INCIDENT>/actions
   Authorization: Bearer <MANAGER_TOKEN>
   { "action": "cancel", "reason": "Hết khả năng phục vụ" }
   ```
   → server **đóng PayOS intent trước** (strict). Nếu PayOS đang xử lý/không đọc được → **409**, dừng (đúng thiết kế).
2. Sau khi hủy thành công, **quét lại QR CŨ** (intent đã `cancelled`) → PayOS gọi webhook:
   ```
   POST /payments/webhook   (server tự verify)
   ```
   → payment cũ `cancelled/failed` → `recordUnmatchedPayment`: 1 `financial_transaction` `payment_unmatched` + 1 thông báo manager; **không** đổi trạng thái đơn.

### SQL kiểm kết quả
```sql
-- Đơn vẫn cancelled
SELECT status FROM bookings WHERE id = '<BOOKING>';

-- Request + hold đã đóng
SELECT status, payment_id FROM booking_change_requests WHERE id = '<REQUEST>';
SELECT consumed_at FROM booking_change_holds WHERE change_request_id = '<REQUEST>';

-- Intent cũ đã cancelled
SELECT status FROM payments WHERE id = '<PAYMENT>';

-- Ghi nhận khoản tiền không khớp (idempotent: đúng 1 dòng)
SELECT transaction_type, amount, note
FROM financial_transactions
WHERE payment_id = '<PAYMENT>' AND transaction_type = 'payment_unmatched';
```

### Kết quả mong đợi
- `bookings.status = 'cancelled'` (không bị mở lại bởi tiền về muộn).
- `booking_change_requests.status = 'cancelled'`; `booking_change_holds.consumed_at` có giá trị.
- `payments.status = 'cancelled'`.
- `financial_transactions`: **đúng 1** dòng `payment_unmatched`; webhook gửi lại **không** tạo dòng thứ hai.
- Có thông báo `booking.staff.payment_unmatched` tới `manager_owner`.

---

## Kịch bản 6 — Quét sự cố: tự thay asset khi còn chiếc thay thế

**Mục tiêu:** (1) quét coi **mọi trạng thái không cho thuê** của trang phục *hoặc* phụ kiện là sự cố,
nhưng (2) **nếu kho còn chiếc thay thế cùng size/mẫu và trống lịch thì tự thay luôn, không mở sự cố**;
(3) đơn có sự cố **lên đầu hàng đợi**; (4) dashboard manager **phân trang**; (5) sự cố phụ kiện được
**thay bằng mẫu phụ kiện KHÁC còn hàng** của cùng trang phục (giá theo `garment_accessories`).

### Chuẩn bị

```sql
-- Đơn sắp bàn giao trong 2 ngày tới (cửa sổ quét), đã thanh toán, có 1 áo + 1 phụ kiện.
SELECT id FROM bookings
WHERE status = 'paid' AND rental_start_date BETWEEN current_date AND current_date + 2;

-- Đưa asset áo về trạng thái KHÔNG cho thuê (laundry/cleaned/inspection_pending…).
UPDATE garment_assets SET status = 'laundry' WHERE id = '<ASSET>';

-- Đưa chiếc phụ kiện đang gán cho đơn về trạng thái hỏng.
UPDATE accessory_assets SET status = 'damaged'
WHERE id = (SELECT accessory_asset_id FROM booking_accessory_items
            WHERE booking_id = '<BOOKING>' LIMIT 1);

-- Xem còn chiếc CÙNG size / mẫu phụ kiện KHÁC của cùng trang phục nào cho thuê không:
SELECT id, asset_code FROM garment_assets
WHERE garment_size_id = (SELECT garment_size_id FROM booking_items WHERE booking_id = '<BOOKING>' LIMIT 1)
  AND status IN ('available', 'reserved', 'rented');

SELECT ga.accessory_id, a.name, ga.is_included, ga.extra_price, count(aa.id) AS con_trong
FROM garment_accessories ga
JOIN accessories a ON a.id = ga.accessory_id
LEFT JOIN accessory_assets aa ON aa.accessory_id = ga.accessory_id
  AND aa.status IN ('available', 'reserved', 'rented')
WHERE ga.garment_id = (SELECT garment_id FROM booking_items WHERE booking_id = '<BOOKING>' LIMIT 1)
  AND ga.accessory_id <> (SELECT accessory_id FROM booking_accessory_items
                          WHERE booking_id = '<BOOKING>' LIMIT 1)
GROUP BY ga.accessory_id, a.name, ga.is_included, ga.extra_price;
```

### Thao tác

```bash
# 1) Quét.
#    - CÒN chiếc thay thế  → hệ thống tự đổi asset, KHÔNG mở sự cố.
#    - HẾT chiếc thay thế  → mở sự cố cho món đó (garment + accessory đều tính).
curl -X POST http://localhost:4000/api/bookings/staff/incidents/scan \
  -H "Authorization: Bearer <MANAGER_TOKEN>"

# 2) Hàng đợi + phân trang. Sự cố còn mở lên đầu (awaiting_customer → needs_manager → open),
#    rồi trong nhóm đã xử lý: sự cố VỪA xử lý xong đứng đầu (resolvedAt DESC, NULL cuối),
#    sau đó dueAt ASC rồi detectedAt ASC.
curl "http://localhost:4000/api/bookings/staff/incidents?page=1&limit=20" \
  -H "Authorization: Bearer <MANAGER_TOKEN>"

# 3) Chi tiết sự cố PHỤ KIỆN: suggestions trả itemKind=accessory + các MẪU phụ kiện khác
#    của cùng trang phục còn hàng (accessoryId, name, imageUrl, isIncluded, extraPrice, available).
curl "http://localhost:4000/api/bookings/staff/incidents/<INCIDENT>" \
  -H "Authorization: Bearer <MANAGER_TOKEN>"

# 4) Gửi phương án đổi sang mẫu phụ kiện khác (bỏ accessoryAssetId để server tự chọn chiếc trống).
curl -X POST "http://localhost:4000/api/bookings/staff/incidents/<INCIDENT>/action" \
  -H "Authorization: Bearer <MANAGER_TOKEN>" -H "Content-Type: application/json" \
  -d '{"action":"proposal","reason":"Phụ kiện hỏng, đổi mẫu khác",
       "type":"replace","accessoryReplacements":[{"incidentId":"<INCIDENT>","accessoryId":"<NEW_ACCESSORY>"}]}'

# 5) Khách xác nhận (nếu cần thanh toán chênh lệch) → yêu cầu `applied`.
```

### SQL kiểm kết quả

```sql
-- Hai sự cố được mở, mỗi món một dòng, có mã tài sản.
SELECT item_kind, reason, asset_code, status FROM booking_incidents
WHERE booking_id = '<BOOKING>' ORDER BY detected_at;

-- Phụ kiện đã đổi sang MẪU khác: accessory_id + đơn giá + thành tiền cập nhật theo garment_accessories.
SELECT id, accessory_id, accessory_asset_id, unit_price, is_included, rental_total
FROM booking_accessory_items WHERE booking_id = '<BOOKING>';

-- Hold của chiếc thay thế đã tiêu thụ sau khi áp dụng.
SELECT kind, accessory_asset_id, consumed_at FROM booking_change_holds
ORDER BY created_at DESC LIMIT 3;

-- Sự cố phụ kiện đã đóng.
SELECT status, resolution, resolved_at FROM booking_incidents
WHERE booking_id = '<BOOKING>' AND item_kind = 'accessory';
```

### Kết quả mong đợi
- **Còn chiếc thay thế** (`available/reserved/rented` + trống lịch, cùng size hoặc cùng `accessory_id`):
  quét **tự đổi asset**, giá không đổi, **không mở sự cố**; `booking_status_history` có dòng
  “Tự động thay … (asset cũ không sẵn sàng)”.
- **Hết chiếc thay thế**: quét mở sự cố cho món đó — cả áo `laundry` **và** phụ kiện `damaged`
  (`reason = no_asset_available` / `asset_damaged`), không bỏ sót loại nào.
- Đơn đã có **yêu cầu đổi đang chờ** (`quoted`/`awaiting_payment`) hoặc đang `ready_for_pickup`
  **không** bị đổi asset ngầm (để khách/manager quyết định).
- Sự cố đang mở mà quét thay được asset → tự đóng với `resolution = asset_recovered`.
- Đơn **không** thuộc cửa sổ 2 ngày tới (đã qua ngày thuê hoặc quá xa) **không** bị mở sự cố.
- `GET /bookings/staff/incidents` trả `{ items, total, page, limit, totalPages }`;
  trang 1 chứa sự cố còn mở, `resolved` nằm ở cuối (hoặc trang cuối).
- `suggestions` của sự cố phụ kiện có `itemKind = 'accessory'`; `options` là các **mẫu phụ kiện khác**
  (`accessoryId`) nằm trong `garment_accessories` của trang phục chứa món lỗi, còn ≥1 chiếc trống lịch.
  Mẫu nào `available = 0` bị loại; không còn mẫu nào → `options = []` (khách chọn Bỏ món).
- `suggestions` của sự cố trang phục gồm các mẫu **cùng size** (cùng mẫu hoặc cùng danh mục) còn chiếc
  trống; mỗi option kèm `garmentId`, `sizeId`, `sizeLabel`, `name`, `imageUrl`, `available` và danh sách
  `accessories[]` (mẫu phụ kiện đi kèm của mẫu đó, kèm giá/ngày + số chiếc còn).
- **Bỏ món không giữ chỗ**: báo giá trả `requiresHold = false`, `POST .../change-requests`
  không tạo dòng `booking_change_holds`; khách thấy báo giá **live ngay** trên tab “Bỏ món” rồi bấm **Xác nhận bỏ món**
  (không có đếm ngược, câu xác nhận “Phần bỏ món đã được trừ vào báo giá…”). Chỉ đổi mẫu / thêm /
  thay phụ kiện mới có `requiresHold = true` và đếm ngược giữ chỗ **10 phút**
  (manager gửi phương án cho khách giữ **30 phút**; hết hạn cron mỗi phút tự giải phóng mẫu đã giữ).
- Sau khi áp dụng: `booking_accessory_items.accessory_asset_id` = chiếc mới; nếu đổi **mẫu** thì
  `accessory_id`, `unit_price`, `is_included`, `rental_total` cập nhật theo `garment_accessories`
  (`is_included = true` → đơn giá 0); chênh lệch vào `removedAccessoryAmount` / `addedAccessoryAmount`.
  Sự cố phụ kiện `status = resolved`, `resolution = replaced`.
- Mẫu phụ kiện thay thế không thuộc `garment_accessories` của trang phục → API trả **400**;
  hết chiếc của mẫu đã chọn → **409** (`Phụ kiện thay thế đã hết hàng cho khoảng ngày thuê.`).

---

## Kịch bản 7 — Khách tự đổi mẫu trên web: chọn trang phục trước → checklist phụ kiện → giữ chỗ 10 phút → thanh toán

**Mục tiêu:** kiểm luồng mới ở trang khách `/booking/incidents/<bookingId>`:
1. **Đơn chỉ lỗi phụ kiện** → khách chọn **mẫu phụ kiện khác** còn hàng của cùng trang phục.
2. **Đơn lỗi trang phục** (hoặc trang phục + phụ kiện) → khách **phải chọn mẫu trang phục mới trước**
   (kèm ảnh và danh sách phụ kiện đi kèm), rồi mới hiện **checklist toàn bộ phụ kiện của đơn** để
   tích thuê / bỏ mẫu. Phụ kiện **bị sự cố chỉ được bỏ mẫu**, không chọn mẫu khác.
3. **Báo giá cập nhật LIVE ngay khi đổi lựa chọn** (không cần bấm nút): giá, tiền cọc, thu thêm và
   **danh sách sản phẩm thuê sau thay đổi** hiện ngay dưới lựa chọn.
4. Bấm **“Giữ chỗ 10 phút để thanh toán”** → báo giá chính thức → xác nhận/thanh toán.
5. Tab **“Bỏ món”** hiện báo giá live + **Xác nhận bỏ món** — **không** giữ chỗ, không đếm ngược.

### Chuẩn bị
- Đơn `status IN ('confirmed','awaiting_payment','paid','preparing')`, còn sự cố mở (`status`
  `open`/`awaiting_customer`/`needs_manager`).
- **Trường hợp A (chỉ lỗi phụ kiện):** `booking_incidents.item_kind = 'accessory'`; trang phục chủ có
  ≥2 mẫu phụ kiện trong `garment_accessories`; mẫu **khác** mẫu lỗi còn ≥1 chiếc trống lịch.
- **Trường hợp B (lỗi trang phục):** `booking_incidents.item_kind = 'garment'`; có mẫu khác **cùng size**
  (cùng mẫu hoặc cùng `categoryId`) còn chiếc trống lịch; trang phục mới có phụ kiện trong
  `garment_accessories`.

```sql
SELECT b.id, b.status, b.rental_start_date, b.rental_end_date
FROM bookings b WHERE b.id = '<BOOKING>';

-- Sự cố còn mở + dòng đơn tương ứng.
SELECT id, item_kind, booking_item_id, booking_accessory_item_id, status
FROM booking_incidents WHERE booking_id = '<BOOKING>';

-- Phụ kiện đang có trong đơn (checklist sẽ hiện đủ các dòng này).
SELECT id, accessory_id, accessory_asset_id, is_included, unit_price, rental_total
FROM booking_accessory_items WHERE booking_id = '<BOOKING>';

-- Mẫu phụ kiện khác còn chiếc cho thuê (Trường hợp A).
SELECT ga.accessory_id, a.name, ga.is_included, ga.extra_price, count(aa.id) AS con_trong
FROM garment_accessories ga
JOIN accessories a ON a.id = ga.accessory_id
LEFT JOIN accessory_assets aa ON aa.accessory_id = ga.accessory_id
  AND aa.status IN ('available', 'reserved', 'rented')
WHERE ga.garment_id = (SELECT garment_id FROM booking_items WHERE booking_id = '<BOOKING>' LIMIT 1)
  AND ga.accessory_id <> (SELECT accessory_id FROM booking_accessory_items
                          WHERE booking_id = '<BOOKING>' LIMIT 1)
GROUP BY ga.accessory_id, a.name, ga.is_included, ga.extra_price;
```

### Thao tác (UI)
1. Đăng nhập khách sở hữu đơn → mở `/booking/incidents/<bookingId>`.
   Danh sách **“Món bị ảnh hưởng”**: mỗi phụ kiện bị sự cố hiện thêm dòng **“Số lượng gặp sự cố: N”**.
2. **Trường hợp A:** tab “Đổi mẫu” hiện **“<tên phụ kiện> · chọn mẫu phụ kiện khác”** kèm ảnh, giá/ngày
   và số chiếc còn. Chọn một mẫu → **khối “Báo giá tạm tính” hiện ngay** (không cần bấm nút).
3. **Trường hợp B:** tab “Đổi mẫu” (bố cục **một cột**: nội dung chọn mẫu/phụ kiện ở trên, **panel
   “Báo giá tạm tính” đặt NGAY DƯỚI phần phụ kiện và TRÊN nút xác nhận**) hiện **“Bước 1 · Chọn mẫu
   trang phục mới”** — các thẻ mẫu **cuộn ngang (carousel)**, mỗi thẻ có ảnh, **size + SL thuê 1**, **giá
   thuê/ngày + tiền cọc** (chỉ giá/ngày, không hiện tổng gây thừa) và **phụ kiện đi kèm mẫu đó** (ảnh +
   giá/ngày; mẫu/chiếc nào hết thì hiện **nhãn đỏ “Hết” ở cuối**, **không hiện số lượng tồn kho**). Chọn
   mẫu → hiện **“Bước 2 · Phụ kiện trong đơn”** — **gộp mọi dòng cùng mẫu phụ kiện thành MỘT ô**, mỗi ô có
   **checkbox ở đầu bên trái (trước ảnh)** + nút − / ô số lượng / nút +:
   - **tick** → thuê mẫu đó với số lượng đang nhập; ô để **trống = 1**;
   - **nhập 0 → tự bỏ tick** (không cho số âm); **tick lại** → khôi phục số dương gần nhất;
   - mỗi ô hiện **“SL thuê N”** (số đang thuê) — **không** hiện số lượng tồn kho; hết hàng thì hiện **nhãn
     đỏ “Hết” ở cuối**; nút **+** và ô nhập bị chặn ở trần `min(garment_accessories.quantity, số chiếc còn
     thuê được)` của mẫu đang chọn;
   - giảm số lượng → các dòng dư bị đưa vào `removeAccessoryItemIds`; tăng → gửi nhiều dòng
     `addAccessories` (mỗi dòng 1 chiếc/1 asset);
   - phụ kiện **bị sự cố**: checkbox khóa, nhãn “Bị sự cố · bỏ mẫu”;
   - phụ kiện **của mẫu mới chưa có trong đơn**: mặc định 1 nếu đi kèm miễn phí, ngược lại 0;
   - mỗi lần đổi (chọn mẫu, tick, đổi số lượng) → **báo giá live tự cập nhật** (debounce ~350ms).
4. Kiểm panel **“Báo giá tạm tính”** (dưới phần phụ kiện, trên nút xác nhận): `Tiền thuê` trước → sau, `Tiền cọc` trước → sau,
   `Thu thêm hôm nay`, `Sẽ hoàn lại khi trả đồ`, các dòng chênh lệch, và **“Sản phẩm thuê sau thay
   đổi”** (danh sách trang phục + phụ kiện kèm ảnh, size, SL, tiền dòng).
5. Bấm **“Giữ chỗ 10 phút để thanh toán”** → panel báo giá chính thức hiện đếm ngược **10:00**; nút xác
   nhận chuyển sang trang thanh toán nếu `paymentRequired = true`.
6. Tab **“Bỏ món”** → **báo giá live hiện ngay** trong panel “Báo giá tạm tính” **đặt dưới dòng cảnh báo
   và trên nút xác nhận** (không đếm ngược) + nút **“Xác nhận bỏ món”** → panel “Báo giá bỏ món” + câu
   “Phần bỏ món đã được trừ vào báo giá. Xác nhận là cập nhật vào đơn ngay.” **cùng 2 nút**
   **“Xác nhận bỏ món”** và **“Hủy”**, **không** có đếm ngược.
   - **Cảnh báo huỷ đơn:** nếu bỏ món dẫn tới **đơn không còn trang phục nào** (mọi `items` của đơn đều
     là món bị sự cố sẽ bị bỏ), trang hiện khung đỏ cảnh báo *“không còn trang phục nào… sẽ huỷ toàn bộ
     đơn”* và nút đổi thành **“Xác nhận bỏ món và huỷ đơn”** — báo trước cho khách.

### Kết quả mong đợi
- Báo giá LIVE dùng endpoint **`POST /bookings/:id/incidents/change-requests/preview`**: **chỉ tính
  tiền** + trả `afterItems`, **không** tạo `booking_change_requests`, **không** chọn/giữ chỗ asset
  (nên không thể 409 “hết hàng” khi khách đang chỉnh). Response có `preview: true`.
- Nút giữ chỗ dùng **`POST /bookings/:id/incidents/change-requests`** (tạo yêu cầu thật + giữ chỗ).
- `GET /bookings/:id/incidents` trả thêm `items` (dòng trang phục kèm `sizeId`, `sizeLabel`, `name`,
  `imageUrl`) và `accessoryItems` (toàn bộ phụ kiện của đơn, kèm `quantity`); mỗi incident có
  `bookingItemId` / `bookingAccessoryItemId` để FE gắn checklist.
- Trường hợp A: payload gửi `accessoryReplacements: [{ incidentId, accessoryId: "<mẫu khác>" }]`;
  server chốt `unitPrice` = `is_included ? 0 : extra_price`, `rentalTotal = unitPrice × ngày × SL`,
  chênh lệch vào `accessoryDelta`; áp dụng cập nhật `accessory_id` + giá của dòng.
- Trường hợp B: payload gửi `replacements` (size mẫu mới) + `removeAccessoryItemIds` (gồm **mọi**
  phụ kiện bị sự cố + dòng dư khi giảm số lượng) + `addAccessories` (mỗi đơn vị tăng thêm là một dòng
  `quantity: 1`). Server **không** cho đổi mẫu phụ kiện bị sự cố trong cùng yêu cầu đổi trang phục.
  Khi áp dụng, `BookingItem` được cập nhật cả **`dailyPrice`/`basePrice`/`discountPrice`** theo size mẫu
  mới → **trang chi tiết đơn và “Biên Nhận Chính Thức” hiện ĐÚNG giá thuê mới**, không còn giữ giá cũ.
- `suggestions` (garment option) trả thêm `dailyPrice`, `rentalTotal`, `depositAmount`; mỗi phụ kiện đi
  kèm trả `available` (số chiếc dùng được) và `maxQuantity` (trần thuê theo mẫu). Chiếc phụ kiện **đang
  thuộc chính đơn này** vẫn được tính là dùng được → không còn hiện “hết” sai.
- Báo giá đổi mẫu: `requiresHold = true`, `countdownSeconds ≈ 600`; `POST .../change-requests`
  tạo `booking_change_holds` cho asset cụ thể của mẫu/phụ kiện mới.
- Báo giá bỏ món: `requiresHold = false`, **không** tạo `booking_change_holds`; xác nhận áp dụng ngay.
- Không còn sự cố (`incidents = []`) → trang hiện “Đơn của bạn đã sẵn sàng”, không còn nút giữ chỗ.
- Mẫu phụ kiện khác hết sạch chiếc → `suggestions` không có option accessory; trang hiện
  “Hiện chưa có mẫu phụ kiện khác còn hàng… Bạn có thể chọn “Bỏ món”.”.

---

## Bảng tổng hợp kỳ vọng theo bảng

| Bảng | KB1 | KB2 | KB3 | KB4 | KB5 |
|---|---|---|---|---|---|
| `payments` | +1 `paid`, tổng mới | +1 `paid` (chênh) | – | – | intent cũ `cancelled` |
| `booking_adjustments` | **0** | 1 `charge`/`collected` | 1 `credit`/`settled` | – | – |
| `booking_change_requests` | `applied` | `applied` | – (**remove** áp dụng ngay) | 1 `quoted` + 1 thất bại | `cancelled` |
| `booking_change_holds` | `consumed` | `consumed` | – | **1** hold sống | `consumed` |
| `refunds` | – | – | 1 phiếu = cọc+credit−phạt | – | – |
| `financial_transactions` | `payment`+`deposit` | `payment` | `refund_*_pending` | – | **1** `payment_unmatched` |
