# Điểm nhấn kỹ thuật khi bảo vệ đồ án

> Hệ thống quản lý cho thuê lễ phục — NestJS + Prisma + PostgreSQL (Supabase) + Next.js + Socket.IO
>
> File này dùng làm **kịch bản thuyết trình** cho hội đồng bảo vệ. Mỗi phần gồm: vấn đề nghiệp vụ → rủi ro kỹ thuật → cách hệ thống xử lý → file code để mở ra show khi hội đồng hỏi.

---

## 0. Một câu tóm tắt để mở đầu

> "Hệ thống của em xử lý một bài toán trông đơn giản — cho thuê đồ — nhưng bản chất là **bài toán cạnh tranh tài nguyên hữu hạn dưới nhiều thao tác đồng thời**. Mỗi bộ lễ phục là một tài nguyên vật lý duy nhất, và nhiều nhân viên cùng thao tác trên một đơn tại một thời điểm. Vì vậy trọng tâm kỹ thuật của đồ án là **tính đúng đắn dưới concurrency**, không chỉ là làm cho màn hình chạy được."

---

## 1. Bài toán nghiệp vụ và các điểm khó

| Vấn đề | Tại sao khó |
|---|---|
| Tồn kho hữu hạn, mỗi tài sản vật lý là duy nhất | Không thể bán "số lượng" vô hạn |
| Thuê theo khoảng ngày `[startDate, endDate]` | Hai đơn có thể chồng khoảng thời gian |
| Quy trình trả đồ nhiều bước | Trả → kiểm tra → phạt → hoàn cọc → hoàn tất |
| Nhiều vai trò cùng thao tác | Staff, Manager, Admin, Customer |
| Nhiều người dùng đồng thời | Hai request có thể đến cùng mili-giây |

**Điểm cần nhấn:** phần lớn bug thực tế trong hệ thống này **không xuất hiện khi test tuần tự**, mà chỉ xuất hiện khi chạy đồng thời. Đó là lý do nhóm tập trung vào transaction, CAS và idempotency.

---

## 2. Chống trùng lịch và overbooking

### 2.1. Vấn đề

Hai khách cùng đặt size M trong cùng khoảng ngày, shop chỉ còn đúng 1 bộ áo dài size M → nếu không chặn được, cả hai đơn đều thành công và shop **bán vượt tồn kho**.

### 2.2. Cách hệ thống xử lý

Không chỉ kiểm tra trước rồi insert (check-then-act — **race condition**), mà kiểm tra **ngay trong transaction**:

- `backend/src/modules/bookings/bookings.service.ts` → `create()`
- Đếm số booking đã chiếm asset cho size đó trong khoảng ngày yêu cầu.
- Nếu đã đủ sức chứa → throw `không còn đủ sản phẩm khả dụng`.
- Toàn bộ bước đếm + tạo booking chạy trong `runSerializable()`.

### 2.3. Hai khoảng ngày chạm biên không phải là trùng lịch

Thuê `10/10 → 12/10` và `12/10 → 14/10` là hợp lệ — chiếc áo được trả ngày 12 và cho thuê lại ngay ngày 12. Điều kiện overlap phải là:

```
existing.rentalStartDate <= new.endDate  AND  existing.rentalEndDate >= new.startDate
```

Chứ không phải so sánh chặt (`<`, `>`), nếu không sẽ từ chối oát một cách khỏi nghiệp vụ.

### 2.4. Bằng chứng để show cho hội đồng

Mở `backend/src/modules/bookings/bookings.service.spec.ts` — có sẵn 3 test:

1. **Rejects a booking whose dates overlap an existing booking** → trùng lịch bị chặn.
2. **Allows boundary-touching booking** → chạm biên vẫn cho đặt.
3. **Allows one of two concurrent bookings** → gửi 2 request **cùng lúc**, chỉ 1 thành công.

Test 3 là điểm ấn tượng nhất: nó chứng minh hệ thống chống được overbooking **dưới concurrency thật**, không phải chỉ khi tuần tự.

---

## 3. Transaction Serializable + retry

### 3.1. Vấn đề

Mức isolation mặc định của PostgreSQL (`Read Committed`) cho phép hai transaction:

- T1 đọc "còn 1 chiếc"
- T2 đọc "còn 1 chiếu"
- Cả hai đều insert → **cùng bán 1 chiếc cho 2 đơn**.

Không có transaction nào "sai", chỉ đơn giản là cả hai cùng đọc được một ảnh chụp dữ liệu cũ.

### 3.2. Cách hệ thống xử lý

`backend/src/prisma/prisma.service.ts` → `runSerializable()`:

- Bọc operation trong `Serializable` isolation level.
- Khi PostgreSQL phát hiện xung đột (error code Prisma `P2034`), tự retry **tối đa 3 lần** với exponential backoff (`25ms → 50ms → 100ms`).

### 3.3. Điểm cần nhấn trước hội đồng

> "**Retry chỉ áp dụng cho xung đột serialization (`P2034`), không retry lỗi nghiệp vụ.** Nếu không phân biệt, một lỗi như 'không đủ hàng' sẽ bị thử lại 3 lần vô ích, vừa chậm vừa che giấu bug. Retry sai chỗ là dấu hiệu của người chưa hiểu bản chất transaction."

Đây là câu hỏi hội đồng hay hỏi. Trả lời bằng việc chỉ thẳng vào `catch` block chỉ bắt `PrismaClientKnownRequestError` với `code === "P2034"`.

---

## 4. Compare-and-set (CAS) — chống thao tác trùng

### 4.1. Vấn đề

Hai nhân viên cùng bấm "Hoàn tất kiểm tra" trên cùng một phiên kiểm tra. Hoặc nhân viên double-click nút "Duyệt hoàn cọc". Nếu code kiểm tra rồi ghi bằng hai câu lệnh riêng, cả hai request đều thấy "chưa xử lý" và cùng ghi.

### 4.2. Cách hệ thống xử lý

Thay vì `update({ where: { id } })`, dùng **update có điều kiện trạng thái cũ**:

```ts
const claimed = await tx.refund.updateMany({
  where: { id, status: { in: ["pending", "refunding"] } },
  data: { status: dto.status, ... },
});
if (claimed.count !== 1) throw new ConflictException("Refund was already processed.");
```

Ba phần không tách rời:
1. Điều kiện `where` chứa **trạng thái cũ mình vừa quan sát**.
2. `count` cho biết có thực sự chỉ có **một** request thắng hay không.
3. Side effect (ghi lịch sử, tạo giao dịch tài chính, gửi thông báo) **chỉ chạy sau khi `count === 1`**.

### 4.3. Áp dụng ở đâu

| Nơi | File |
|---|---|
| Chuyển trạng thái booking | `bookings.service.ts` → `advanceStatus()` |
| Hoàn tất phiên kiểm tra | `inspections.service.ts` → `complete()` |
| Duyệt / từ chối hoàn cọc | `refunds.service.ts` → `approve()`, `reject()` |
| Đóng đơn không hoàn cọc | `refunds.service.ts` → `closeWithoutRefund()` |
| Xử lý job bảo trì | `inspections.service.ts` → `completeMaintenance()` |
| Đánh dấu quá hạn | `bookings.service.ts` → `markOverdueBookings()` |

### 4.4. Câu hỏi dỏ về dễ gặp

> "Vì sao không dùng khoá `SELECT ... FOR UPDATE`?"

Trả lời: khoá dòng là một lựa chọn hợp lệ, nhưng ở đây chọn CAS vì:
- Không cần giữ khoá xuyên suốt transaction → giảm contention.
- `count !== 1` trả về thông báo lỗi rõ ràng cho người dùng, thay vì chờ khoá.
- Kết hợp với `Serializable` cho độ an toàn tương đương với độc quyền ghi, theo mô hình **optimistic concurrency control**.

---

## 5. Idempotency — mỗi thao tác chỉ có hiệu lực đúng một lần

### 5.1. Phạt tiền (penalty)

`applyOverdueFeeTx()` trong `bookings.service.ts` **không** tạo bản ghi phạt mới mỗi lần gọi. Nó:

1. Tìm penalty quá hạn hiện có.
2. Tính `delta = amountMới - amountCũ`.
3. Chỉ update/increment khi `delta !== 0`.

Nhờ vậy, cron chạy 00h00 hằng ngày và nhân viên bấm "Ghi nhận trả đồ" cùng lúc vẫn **không tạo hai lần phạt** cho cùng một đơn.

### 5.2. Hoàn cọc (refund)

Quy tắc nghiệp vụ:

```
refundAmount = max(depositTotal - penaltyTotal, 0)
```

- Chỉ tạo **một** refund `pending` sau khi kiểm tra xong toàn bộ trang phục.
- Manager duyệt **đúng một lần** (CAS chặn lần hai).
- Nếu `penaltyTotal >= depositTotal` → không tạo refund, đơn chuyển thẳng `completed`.

### 5.3. Điểm hay được hỏi: hoàn tiền mặt hay chuyển khoản?

Phương thức hoàn được quyết định từ **payment đã thanh toán**, không phải từ cách khách nhận đồ:

| Payment method | Refund method |
|---|---|
| `cash` | `cash` |
| `bank_transfer` | `bank_transfer` |
| `qr_code` / PayOS | `bank_transfer` |

> Logic này tránh một lỗi tài chính nghiêm trọng: khách trả bằng QR thì tiền nằm trong tài khoản của shop, nếu hệ thống hoàn tiền mặt thì shop mất tiền thật mà dữ liệu lại ghi "đã hoàn thành".

Nếu refund chuyển khoản mà thiếu thông tin tài khoản hoặc thiếu ảnh bill, **backend từ chối duyệt** — không chỉ disable nút ở giao diện.

---

## 6. State machine nghiệp vụ

### 6.1. Vòng đời booking

```
pending_confirmation → awaiting_payment → paid → preparing
  → ready_for_pickup → delivering → renting → returned
  → inspection_pending → refund_pending → completed
```

### 6.2. Vì sao asset status **không đủ** để kết luận "đã kiểm tra xong"

Đây là một bug thật đã gặp trong quá trình phát triển: khi nhân viên bấm "Chuyển giặt sấy" trên **1 chiếc trong 3 chiếc**, asset đó đã sang trạng thái `laundry` — nhưng **booking chưa được kiểm tra đủ**.

Nếu dùng `asset.status !== inspection_pending` làm điều kiện hoàn tất, hệ thống sẽ:

- Tạo refund **sớm hơn thực tế**.
- Tính penalty **thiếu** (vì 2 chiếc còn lại chưa được kiểm tra).

Điều kiện đúng được dùng trong `isBookingFullyInspected()`:

1. Mọi item của booking đều đã gán asset vật lý.
2. **Mỗi** asset được gán có đúng một `InspectionSession` ở trạng thái `completed` **thuộc đúng booking này**.
3. Asset/session của booking khác không được tính.

### 6.3. Phân tách trách nhiệm (separation of duties)

| Bước | Ai thực hiện |
|---|---|
| Tạo / bổ sung thông tin refund | Staff |
| Duyệt / từ chối refund | Manager, Admin |

Staff **không** có quyền tự duyệt tiền hoàn — kể cả refund tiền mặt. Đây là ràng buộc ở tầng service (`@Roles` + validation), không phải chỉ ẩn nút ở UI.

---

## 7. Realtime — cập nhật không cần reload

### 7.1. Vấn đề ban đầu

Khi một nhân viên cập nhật trạng thái, màn hình của người khác **không đổi cho đến khi F5**. Điều này nguy hiểm trong nghiệp vụ: manager có thể duyệt một refund đã bị người khác xử lý, hoặc staff nhìn thấy danh sách cũ rồi báo sai.

### 7.2. Kiến trúc

```
Backend service (sau khi transaction COMMIT)
        ↓
RealtimeService → Socket.IO namespace /realtime
        ↓
frontend useRealtimeInvalidation() → refetch REST API
        ↓
UI cập nhật (không reload)
```

**Files:**

| Vai trò | File |
|---|---|
| Gateway (xác thực + join room) | `backend/src/modules/realtime/realtime.gateway.ts` |
| Publisher | `backend/src/modules/realtime/realtime.service.ts` |
| Client socket | `frontend/src/lib/realtime.ts` |
| Hook subscribe | `frontend/src/lib/use-realtime-invalidation.ts` |
| Test gateway + payload | `backend/src/modules/realtime/realtime.spec.ts` |
| Test client | `frontend/src/lib/realtime.test.ts` |

### 7.3. Ba quyết định thiết kế đáng trình bày

**(a) Phát event SAU commit, không phát trong transaction**

```ts
const updated = await this.prisma.runSerializable(async (tx) => {
  // ... mọi thay đổi dữ liệu
});
// chỉ tới đây mới emit
this.realtime.bookingChanged({ id: updated.id, status: updated.status });
```

> Nếu emit bên trong transaction và transaction rollback, người dùng sẽ thấy giao diện nhảy sang trạng thái "đã cập nhật" trong khi database thực tế **chưa hề thay đổi**. Đây là lỗi rất dễ mắc và rất khó phát hiện khi demo.

**(b) Realtime chỉ là tín hiệu "có thay đổi", dữ liệu thật lấy lại qua REST**

Socket chỉ gửi:

```ts
{ resource: "refunds", id, bookingId, status, occurredAt }
```

Frontend nhận event → gọi lại API có sẵn.

Lợi ích:
- **Không lộ PII**: không có tên khách, số tiền, thông tin ngân hàng trên socket.
- **Phân quyền giữ nguyên**: dữ liệu vẫn đi qua controller có `JwtAuthGuard` + `RolesGuard`.
- **Không phải đồng bộ schema**: realtime là lớp bổ sung, không phải nguồn sự thật thứ hai để phải đồng bộ.

**(c) Coalescing theo resource**

Một lần hoàn tất kiểm tra có thể phát ra 4 event (`inspections`, `assets`, `bookings`, `maintenance`). Hook debounce **300ms theo từng resource** để gộp thành một lần refetch — tránh bão request khi thao tác hàng loạt.

### 7.4. Bảo mật socket

Gateway xác thực lại bằng **cùng JWT** với REST:
- Đọc token từ `handshake.auth.token`.
- Verify chữ ký + kiểm tra `user.isActive` qua database.
- Socket không xác thực được → disconnect ngay.

Join room theo vai trò: `dashboard:staff`, `dashboard:manager`, `dashboard:admin`, `user:<id>`, `role:<role>`.

### 7.5. Điểm cần nói thẳng trước hội đồng

> "Realtime ở đây là **best-effort**, không phải exactly-once. Nếu socket bị rớt, hệ thống vẫn đúng — chỉ là giao diện chậm cập nhật. Vì vậy khi socket reconnect, hook tự refetch lại toàn bộ resource đang đăng ký để bù các event bị miss. **Đây là lý do thiết kế socket chỉ làm tín hiệu, còn dữ liệu luôn lấy lại từ nguồn chân lý.**"

---

## 8. Kiểm thử tự động

| Nhóm test | File | Chứng minh điều gì |
|---|---|---|
| Chống trùng lịch | `bookings.service.spec.ts` | Overbooking, chạm biên, concurrency |
| Realtime | `realtime.spec.ts` (backend) | Auth, join room, payload không lộ dữ liệu |
| Realtime | `realtime.test.ts` (frontend) | Token, reconnect, ref-count |
| Client API | `api.test.ts` | Base URL, header, chuẩn hóa lỗi |

Chạy toàn bộ:

```bash
cd backend  && npm run test
cd frontend && npm run test
```

---

## 9. Kịch bản demo cho hội đồng

### Demo 1 — Chống overbooking (2–3 phút)

1. Mở 2 tab, cùng đăng nhập 1 tài khoản khách.
2. Cả 2 tab chọn **cùng size M, cùng khoảng ngày**, giữa khi shop chỉ còn đúng 1 bộ.
3. Tab 1 bấm "Đặt" → thành công.
4. Tab 2 bấm "Đặt" → báo **không còn đủ sản phẩm khả dụng**.
5. *Nói:* "Không có khoá, không có transaction — đây là kết quả của Serializable + CAS."

### Demo 2 — Trả đồ hư hỏng (3–4 phút)

1. Staff: chuyển đơn qua `paid → preparing → ready_for_pickup → renting → returned`.
2. Staff vào tab **Kiểm tra trả đồ**, ghi nhận hư hỏng với phạt **500.000đ**.
3. Staff bấm "Ghi nhận hư hỏng" **hai lần liên tiếp**.
4. *Chỉ hiện* một khoản phạt, một phiên kiểm tra.
5. Manager **đang mở sẵn dashboard ở tab khác** → tự nhảy sang danh sách hư hỏng và hàng chờ duyệt hoàn cọc, **không reload**.
6. *Nói:* "Đây là CAS + emit sau commit + refetch REST."

### Demo 3 — Hoàn cọc chuyển khoản (3–4 phút)

1. Khách thanh toán bằng **QR**.
2. Sau khi kiểm tra xong, refund tự sinh với method = **chuyển khoản** (đúng vì tiền nằm trong tài khoản shop).
3. Staff bổ sung thông tin tài khoản nhận.
4. Manager thử bấm "Duyệt" **khi chưa có ảnh bill** → **bị chặn**.
5. Upload bill → duyệt thành công → đơn chuyển `completed`.

### Demo 4 — Hai người duyệt cùng lúc (2 phút)

1. Mở 2 tab, cùng đăng nhập **2 tài khoản manager**.
2. Cùng bấm "Duyệt" trên **cùng một refund**.
3. Một người thành công, người còn lại nhận thông báo **đã được xử lý bởi thao tác khác**.
4. *Kiểm tra:* database chỉ có **một** `financial_transaction` loại `refund_*_approved`.

---

## 10. Câu hỏi thường gặp từ hội đồng — chuẩn bị trước

**"Hệ thống có bị overbooking không?"**
> Không, với ba lớp phòng thủ: kiểm tra sức chứa trong `Serializable` transaction; CAS trạng thái booking; và test concurrency chứng minh 2 request đồng thời chỉ 1 thắng.

**"Nếu database chết giữa chừng thì sao — ví dụ đã ghi log nhưng chưa tạo refund?"**
> Toàn bộ phần kiểm tra, cộng phạt, tạo refund và đổi trạng thái booking nằm trong **một** transaction. Hoặc tất cả thành công, hoặc không có gì thay đổi. Không có trạng thái nửa vời.

**"Real-time có làm lộ thông tin khách hàng không?"**
> Không. Payload socket chỉ có `resource`, `id`, `status`, `timestamp`. Không có tên, số tiền, hay thông tin ngân hàng. Mọi dữ liệu thật vẫn được tải qua REST API với đầy đủ `JwtAuthGuard` + `RolesGuard`.

**"Sau này scale lên nhiều server thì sao?"**
> Socket.IO hỗ trợ Redis adapter để broadcast giữa các instance. Phần nghiệp vụ không cần đổi vì đã tách `RealtimeService` ra khỏi logic transaction — chỉ thay adapter, không sửa service.

**"Đã kiểm thử chưa?"**
> Có: `npm run test` ở cả backend và frontend, tất cả đều pass — bao gồm test concurrency chống overbooking, test xác thực realtime socket, và test chuẩn hóa payload không lộ dữ liệu nhạy cảm.

---

## 11. Phạm vi và hướng phát triển

**Đã triển khai:** chống overbooking, transaction + CAS toàn bộ luồng trả đồ, hoàn cọc idempotent, phân tách trách nhiệm staff/manager, dashboard realtime, kiểm thử tự động.

**Hướng mở rộng (chưa làm, nêu được như hướng tương lai):**
- Partial unique index ở tầng database cho `(booking_id, garment_asset_id)` ở bảng inspection session — hiện đã xử lý bằng transaction, index sẽ là lớp phòng thủ thứ hai.
- Redis adapter cho Socket.IO khi chạy nhiều instance.
- Outbox pattern để đảm bảo event realtime không bị mất khi tiến trình restart giữa lúc commit và lúc emit.
- Báo cáo doanh thu theo ca/thời gian.

> Nêu rõ những mục này là *hướng phát triển*, không phải thành phần đã làm. Hội đồng đánh giá cao sự trung thực hơn là trình bày mọi thứ như đã xong.

---

## Phụ lục — Danh mục file nên mở khi hội đồng yêu cầu show code

| Chủ đề | File |
|---|---|
| Transaction + retry | `backend/src/prisma/prisma.service.ts` |
| Chống trùng lịch | `backend/src/modules/bookings/bookings.service.ts` → `create()` |
| Chuyển trạng thái booking + CAS | `bookings.service.ts` → `advanceStatus()` |
| Phí quá hạn idempotent | `bookings.service.ts` → `applyOverdueFeeTx()` |
| Điều kiện kiểm tra đủ | `backend/src/modules/inspections/inspections.service.ts` → `isBookingFullyInspected()` |
| Hoàn cọc tự động | `inspections.service.ts` → `finalizeBookingInspection()` |
| Quy tắc duyệt hoàn cọc | `backend/src/modules/refunds/refunds.service.ts` → `approve()` |
| Realtime gateway | `backend/src/modules/realtime/realtime.gateway.ts` |
| Realtime publisher | `backend/src/modules/realtime/realtime.service.ts` |
| Hook frontend | `frontend/src/lib/use-realtime-invalidation.ts` |
| Test chống overbooking | `backend/src/modules/bookings/bookings.service.spec.ts` |
| Test realtime | `backend/src/modules/realtime/realtime.spec.ts` |