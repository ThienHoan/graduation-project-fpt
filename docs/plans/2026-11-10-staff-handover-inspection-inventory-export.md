# Staff & Manager Operational Export (Handover, Inspection, Inventory) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mở rộng hệ thống xuất tài liệu và báo cáo toàn diện cho cả Staff (vận hành tại quầy/giao hàng) và Manager (quản trị kho hiện vật):
1. **Ưu tiên 1 (Staff)**: In Phiếu Bàn Giao Quầy (A4 có chữ ký) hoặc Phiếu Vận Đơn Đóng Gói (A5/Decal kèm lưu ý giao hàng và QR code) tùy theo `pickupMethod` (`store_pickup` vs `delivery`).
2. **Ưu tiên 2 (Staff)**: In Biên Bản Kiểm Tra Hoàn Trả & Trừ Cọc Hư Hại (PDF) khi phát hiện lỗi trang phục sau khi khách trả đồ.
3. **Ưu tiên 3 (Manager)**: Xuất Danh Mục Kiểm Kê Kho Hiện Vật & Khấu Hao Trang Phục (Excel đa cột, trạng thái giặt/hư hỏng, số lượt đã cho thuê).

**Architecture:**
- **Backend**:
  - Tái sử dụng `pdfkit` và `exceljs` đã được cài đặt và tối ưu hóa font Unicode / fallback an toàn trong `backend`.
  - Mở rộng `BookingsService` / `BookingsController`: endpoint `GET /bookings/:id/export-handover-slip`.
  - Mở rộng `InspectionsService` / `InspectionsController`: endpoint `GET /inspections/:id/export-slip`.
  - Mở rộng `GarmentsService` / `GarmentsController`: endpoint `GET /garments/export-assets`.
  - Phân quyền: Staff, Manager và Admin được truy xuất phiếu vận hành đơn hàng; chỉ Manager và Admin được xuất kiểm kê kho tài sản.
- **Frontend**:
  - Bổ sung helper functions trong `frontend/src/lib/api.ts`: `downloadHandoverSlip(bookingId)`, `downloadInspectionSlip(inspectionId)`, `downloadInventoryReport()`.
  - Màn hình chi tiết đơn Staff (`/dashboard/staff/booking/[id]`): Thêm nút "In Phiếu Bàn Giao" (hoặc "In Phiếu Giao Hàng" nếu là delivery).
  - Màn hình Kiểm tra trả đồ (`/dashboard/staff/inspection` & `InspectionDetailModal`): Thêm nút "In Biên Bản Kiểm Tra".
  - Màn hình Kho Manager (`/dashboard/manager` tab `inventory`): Thêm nút "Xuất Excel Kho Hiện Vật".

**Tech Stack:** NestJS, Prisma ORM, `pdfkit`, `exceljs`, Next.js 15, Tailwind CSS, Lucide icons, Vitest.

---

## Task 1: Backend - Endpoint In Phiếu Bàn Giao / Vận Đơn (`GET /bookings/:id/export-handover-slip`)

**Files:**
- Modify: `backend/src/modules/bookings/bookings.service.ts`
- Modify: `backend/src/modules/bookings/bookings.controller.ts`
- Create: `backend/src/modules/bookings/bookings-export.service.ts`
- Create: `backend/src/modules/bookings/bookings-export.service.spec.ts`

**Step 1: Viết test cho `BookingsExportService.generateHandoverSlip()`**

Kiểm tra 2 kịch bản:
1. `pickupMethod === "store_pickup"`: Sinh PDF A4 "BIÊN BẢN BÀN GIAO TRANG PHỤC & THU HỘ TIỀN CỌC" có khu vực ký tên 2 bên.
2. `pickupMethod === "delivery"`: Sinh PDF A5 "PHIẾU ĐÓNG GÓI & VẬN ĐƠN GIAO HÀNG" có địa chỉ giao, lưu ý shipper nhẹ tay, và mã QR/hướng dẫn quét nhận đồ.

```typescript
describe("BookingsExportService", () => {
  it("should generate store pickup handover slip with signatures", async () => {
    const buffer = await service.generateHandoverSlip({
      ...mockBooking,
      pickupMethod: "store_pickup",
    });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should generate delivery packing slip without requiring in-store customer signature", async () => {
    const buffer = await service.generateHandoverSlip({
      ...mockBooking,
      pickupMethod: "delivery",
    });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
```

**Step 2: Chạy test để xác nhận test FAIL**

```bash
backend/node_modules/.bin/vitest run src/modules/bookings/bookings-export.service.spec.ts
```
Expected: FAIL

**Step 3: Triển khai `BookingsExportService` và tích hợp Controller**

Trong `BookingsExportService`:
- Format nội dung PDF chuẩn nhận diện Cổ Phục Việt:
  - Thông tin đơn: Mã booking, Ngày tạo, Thời gian thuê (`rentalStartDate` -> `rentalEndDate`).
  - Thông tin khách: Tên khách, SĐT, Địa chỉ (nếu giao hàng).
  - Bảng danh sách món đồ: Tên cổ phục, Size, Mã tài sản (Asset Code), Tiền thuê, Tiền cọc.
  - Tổng kết tiền: Tổng thuê, Tiền cọc giữ, Phí giao hàng, Giảm giá voucher, Trạng thái thanh toán.
  - Phân nhánh:
    - Nếu `store_pickup`: Điều khoản bảo quản + Khung chữ ký Staff và Khách.
    - Nếu `delivery`: Khung tem vận chuyển (Tên người nhận, SĐT, Địa chỉ, Lưu ý hàng dễ gãy/nhăn, Hướng dẫn mở hộp unboxing & quét mã xác nhận nhận hàng).

Trong `BookingsController`:
```typescript
@Get(":id/export-handover-slip")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("staff", "manager_owner", "admin", "customer")
async exportHandoverSlip(
  @Param("id", ParseUUIDPipe) id: string,
  @CurrentUser() user: AuthenticatedUser,
  @Res() res: RawResponse,
) {
  const result = await this.bookingsService.exportHandoverSlip(id, user);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  return res.send(result.buffer);
}
```

**Step 4: Chạy test để xác nhận test PASS**

```bash
backend/node_modules/.bin/vitest run src/modules/bookings/bookings-export.service.spec.ts
```
Expected: PASS

---

## Task 2: Frontend - Nút "In Phiếu Bàn Giao / Vận Đơn" trên trang chi tiết đơn Staff

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/dashboard/staff/booking/[id]/page.tsx`
- Create: `frontend/src/lib/handover-export.test.ts`

**Step 1: Viết test cho hàm `downloadHandoverSlip` trong `api.ts`**

```typescript
it("should trigger download for booking handover slip PDF", async () => {
  // Mock fetch blob and verify download
});
```

**Step 2: Thêm hàm `downloadHandoverSlip` vào `frontend/src/lib/api.ts`**

```typescript
export async function downloadHandoverSlip(bookingId: string): Promise<{ success: boolean; filename?: string; error?: string }> {
  // Gọi GET /bookings/:id/export-handover-slip và tải file
}
```

**Step 3: Gắn nút bấm trên giao diện Staff Booking Detail**

Trong `frontend/src/app/dashboard/staff/booking/[id]/page.tsx`:
- Tại header thông tin đơn hàng hoặc cạnh nút đổi trạng thái, bổ sung nút:
  - Nếu `pickupMethod === "store_pickup"`: Nút icon `Printer` **"In Phiếu Bàn Giao"**.
  - Nếu `pickupMethod === "delivery"`: Nút icon `PackageCheck` **"In Phiếu Gói Hàng & Vận Đơn"**.
  - Bấm nút -> Gọi `downloadHandoverSlip(booking.id)` -> Hiển thị spinner và tải file PDF về máy để in ra máy in quầy.

**Step 4: Chạy test frontend và typecheck**

```bash
cd frontend && ./node_modules/.bin/vitest run src/lib/handover-export.test.ts && npx tsc --noEmit
```
Expected: PASS, 0 lỗi.

---

## Task 3: Backend - Endpoint In Biên Bản Kiểm Tra Hoàn Trả & Phạt Hư Hại (`GET /inspections/:id/export-slip`)

**Files:**
- Modify: `backend/src/modules/inspections/inspections.service.ts`
- Modify: `backend/src/modules/inspections/inspections.controller.ts`
- Create: `backend/src/modules/inspections/inspections-export.service.ts`
- Create: `backend/src/modules/inspections/inspections-export.service.spec.ts`

**Step 1: Viết test cho `InspectionsExportService.generateInspectionSlip()`**

Kiểm tra:
- Sinh PDF "BIÊN BẢN KIỂM TRA TÌNH TRẠNG TRANG PHỤC HOÀN TRẢ".
- Liệt kê chi tiết các lỗi (`findings`): Loại lỗi, Mức độ (`severity`), Mô tả, Số tiền phạt (`penaltyAmount`).
- Tính tổng tiền phạt và số tiền cọc còn lại hoàn trả khách.
- Có chữ ký xác nhận của Nhân viên kiểm tra và Khách hàng.

**Step 2: Triển khai logic tạo PDF trong `InspectionsExportService`**

- Định dạng A4, header thương hiệu.
- Thông tin buổi kiểm tra: Ngày kiểm tra, Người kiểm tra (Staff), Mã đơn, Tên khách.
- Chi tiết hiện vật: Tên cổ phục, Mã tài sản (`garmentAsset.assetCode`).
- Bảng Danh sách lỗi phát hiện:
  - Cột: STT | Vị trí / Loại lỗi | Mức độ | Tiền phạt quy định.
  - Dòng tổng: TỔNG TIỀN PHẠT KHẤU TRỪ.
- Quyết toán cọc:
  - Tiền cọc ban đầu: `A đ`.
  - Tiền phạt khấu trừ: `- B đ`.
  - Số tiền hoàn lại khách: `(A - B) đ` (hoặc Khách bồi thường thêm nếu B > A).
- Phần cam kết & Chữ ký hai bên.

**Step 3: Thêm Route trong `InspectionsController`**

```typescript
@Get(":id/export-slip")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("staff", "manager_owner", "admin")
async exportInspectionSlip(
  @Param("id", ParseUUIDPipe) id: string,
  @CurrentUser() user: AuthenticatedUser,
  @Res() res: RawResponse,
) {
  const result = await this.inspectionsService.exportInspectionSlip(id, user);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  return res.send(result.buffer);
}
```

**Step 4: Chạy test backend**

```bash
backend/node_modules/.bin/vitest run src/modules/inspections/inspections-export.service.spec.ts
```
Expected: PASS

---

## Task 4: Frontend - Nút "In Biên Bản Kiểm Tra" trên UI Staff

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/bookings/inspection-detail-modal.tsx` (hoặc trang `/dashboard/staff/inspection`)

**Step 1: Thêm hàm `downloadInspectionSlip` vào `frontend/src/lib/api.ts`**

```typescript
export async function downloadInspectionSlip(inspectionId: string): Promise<{ success: boolean; filename?: string; error?: string }> {
  // Gọi GET /inspections/:id/export-slip và tải PDF
}
```

**Step 2: Thêm nút "In Biên Bản Kiểm Tra (PDF)"**

- Trong modal chi tiết biên bản kiểm tra (`InspectionDetailModal`) sau khi hoàn tất kiểm tra hoặc tại nhật ký kiểm tra:
  - Thêm nút icon `FileText` / `Printer`: **"In Biên Bản Phạt & Hoàn Cọc"**.
  - Cho phép in ngay để khách ký xác nhận tại quầy trước khi hoàn tiền cọc.

**Step 3: Kiểm tra compile & test**

```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 lỗi.

---

## Task 5: Backend - Endpoint Xuất Kiểm Kê Kho Hiện Vật (`GET /garments/export-assets`)

**Files:**
- Modify: `backend/src/modules/garments/garments.service.ts`
- Modify: `backend/src/modules/garments/garments.controller.ts`
- Create: `backend/src/modules/garments/garments-export.service.ts`
- Create: `backend/src/modules/garments/garments-export.service.spec.ts`

**Step 1: Viết test cho `GarmentsExportService.generateAssetsExcel()`**

Kiểm tra:
- Tạo file Excel `.xlsx` gồm toàn bộ tài sản vật lý (`GarmentAsset`).
- Các cột: Mã tài sản, Tên trang phục, Size, Trạng thái (`Sẵn sàng`, `Đang thuê`, `Đang giặt`, `Bảo trì`, `Hư hỏng`, `Thất lạc`), Giá mua/nguyên giá, Số lần đã cho thuê, Ghi chú tình trạng, Ngày nhập kho.
- Sheet tổng hợp thống kê số lượng theo từng trạng thái.

**Step 2: Triển khai logic xuất Excel bằng `exceljs`**

- Định dạng bảng chuyên nghiệp: Freeze pane hàng tiêu đề, filter tự động, căn giữa các mã và trạng thái.
- Định dạng tiền tệ `#,##0 đ` cho cột nguyên giá.
- Thống kê tỷ lệ sẵn sàng phục vụ cho thuê (`Utilization rate`).

**Step 3: Thêm Route trong `GarmentsController`**

```typescript
@Get("export-assets")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("manager_owner", "admin")
async exportAssetsExcel(@Res() res: RawResponse) {
  const result = await this.garmentsService.exportAssetsExcel();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  return res.send(result.buffer);
}
```

**Step 4: Chạy test backend**

```bash
backend/node_modules/.bin/vitest run src/modules/garments/garments-export.service.spec.ts
```
Expected: PASS

---

## Task 6: Frontend - Nút "Xuất Excel Kho Hiện Vật" trên Manager Dashboard

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/dashboard/manager/page.tsx`

**Step 1: Thêm hàm `downloadAssetsInventoryReport` vào `frontend/src/lib/api.ts`**

**Step 2: Gắn nút "Xuất Excel Kho Hiện Vật" trong tab `inventory` của Manager Dashboard**

- Đặt tại thanh công cụ quản lý kho trang phục (bên cạnh nút Thêm trang phục mới / Tìm kiếm).
- Icon `FileSpreadsheet` màu xanh lá: **"Xuất Báo Cáo Kiểm Kê"**.

**Step 3: Kiểm tra compile & test**

```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 lỗi.

---

## Task 7: Full Verification & E2E Validation (KHÔNG COMMIT THEO YÊU CẦU CỦA USER)

- Chạy toàn bộ test suites backend: `backend/node_modules/.bin/vitest run`
- Chạy toàn bộ test suites frontend: `cd frontend && ./node_modules/.bin/vitest run`
- Kiểm tra typecheck cả dự án:
  - `cd backend && npx tsc --noEmit`
  - `cd frontend && npx tsc --noEmit`
- Kiểm tra `git status` đảm bảo không có lệnh commit nào tự động thực thi.

