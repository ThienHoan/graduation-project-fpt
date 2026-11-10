# Financial Export (PDF & Excel) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Thêm endpoint `/api/financial/export?format=pdf|xlsx&from=...&to=...` trên backend và tích hợp nút "Xuất báo cáo" (PDF & Excel) trên Manager Dashboard, phục vụ in ấn gửi kế toán và bảo vệ dự án tốt nghiệp trước hội đồng.

**Architecture:**
- **Backend**: Mở rộng `FinancialModule` với `FinancialExportService` đảm nhận sinh tài liệu nhị phân (Buffer / Stream) cho 2 định dạng PDF (`pdfkit`) và Excel (`exceljs`). Controller `GET /api/financial/export` nhận query (`format`, `from`, `to`, `startDate`, `endDate`, `preset`), bảo vệ bởi `JwtAuthGuard` + `RolesGuard` (`manager_owner`, `admin`), trả về file nhị phân kèm header `Content-Disposition: attachment`.
- **Frontend**: Thêm hàm `exportFinancialReport()` trong `src/lib/api.ts` xử lý nhận binary blob và trigger download file trên trình duyệt. Thêm UI button / dropdown "Xuất báo cáo" trực quan ngay trên thanh công cụ của tab `Đối Soát Tài Chính` (Manager Dashboard), tự động đồng bộ theo bộ lọc ngày hiện tại (`hôm nay`, `tháng này`, `năm nay`, hoặc khoảng ngày tùy chọn).

**Tech Stack:** NestJS, TypeScript, `exceljs`, `pdfkit`, `@types/pdfkit`, Vitest, Next.js 15, Tailwind CSS, Lucide icons.

---

## Task 1: Cài đặt và cấu hình thư viện `exceljs` và `pdfkit` cho Backend

**Files:**
- Modify: `backend/package.json`

**Step 1: Thêm dependencies vào backend/package.json**

Cần cài đặt:
- `exceljs` (^4.4.0) cho xuất báo cáo Excel đa sheet, format tiền tệ VND, styling màu sắc và border.
- `pdfkit` (^0.15.0 hoặc ^0.16.0) + `@types/pdfkit` (^0.13.9) cho xuất báo cáo PDF chuẩn in ấn.

Thêm vào `backend/package.json`:
- `"dependencies"`: `"exceljs": "^4.4.0"`, `"pdfkit": "^0.16.0"`
- `"devDependencies"`: `"@types/pdfkit": "^0.13.9"`

**Step 2: Chạy lệnh cài đặt**

```bash
cd backend && pnpm install exceljs pdfkit && pnpm install -D @types/pdfkit
```

**Step 3: Kiểm tra cài đặt và typecheck**

```bash
cd backend && node -e "require('exceljs'); require('pdfkit'); console.log('Libraries loaded successfully');"
```
Expected: `Libraries loaded successfully`

**Step 4: Commit**

```bash
git add backend/package.json pnpm-lock.yaml
git commit -m "chore(deps): add exceljs, pdfkit and @types/pdfkit for financial export"
```

---

## Task 2: DTO validation cho API Export Báo Cáo

**Files:**
- Create: `backend/src/modules/financial/dto/financial-export-query.dto.ts`
- Modify: `backend/src/modules/financial/dto/financial-query.dto.ts`
- Create: `backend/src/modules/financial/dto/financial-export-query.dto.spec.ts`

**Step 1: Viết test kiểm tra DTO validation**

Tạo `backend/src/modules/financial/dto/financial-export-query.dto.spec.ts`:
```typescript
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { describe, it, expect } from "vitest";
import { FinancialExportQueryDto } from "./financial-export-query.dto";

describe("FinancialExportQueryDto", () => {
  it("should validate valid query with format pdf", async () => {
    const dto = plainToInstance(FinancialExportQueryDto, {
      format: "pdf",
      from: "2026-11-01",
      to: "2026-11-10",
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.getStartDate()).toBe("2026-11-01");
    expect(dto.getEndDate()).toBe("2026-11-10");
  });

  it("should validate valid query with format xlsx", async () => {
    const dto = plainToInstance(FinancialExportQueryDto, {
      format: "xlsx",
      startDate: "2026-11-01",
      endDate: "2026-11-10",
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.getStartDate()).toBe("2026-11-01");
    expect(dto.getEndDate()).toBe("2026-11-10");
  });

  it("should fail when format is invalid", async () => {
    const dto = plainToInstance(FinancialExportQueryDto, {
      format: "docx",
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("format");
  });
});
```

**Step 2: Chạy test để xác nhận test FAIL**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/dto/financial-export-query.dto.spec.ts
```
Expected: FAIL (Cannot find module `./financial-export-query.dto`)

**Step 3: Tạo `FinancialExportQueryDto`**

Tạo `backend/src/modules/financial/dto/financial-export-query.dto.ts`:
```typescript
import { IsIn, IsOptional, Matches } from "class-validator";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EXPORT_FORMATS = ["pdf", "xlsx"] as const;
export type FinancialExportFormat = (typeof EXPORT_FORMATS)[number];

export class FinancialExportQueryDto {
  @IsOptional()
  @IsIn(EXPORT_FORMATS, { message: "Định dạng xuất phải là 'pdf' hoặc 'xlsx'." })
  format?: FinancialExportFormat = "pdf";

  @IsOptional()
  @Matches(DATE_REGEX, { message: "from phải có định dạng YYYY-MM-DD." })
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: "to phải có định dạng YYYY-MM-DD." })
  to?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: "startDate phải có định dạng YYYY-MM-DD." })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_REGEX, { message: "endDate phải có định dạng YYYY-MM-DD." })
  endDate?: string;

  @IsOptional()
  preset?: "today" | "this_month" | "this_year" | "custom";

  getStartDate(): string | undefined {
    return this.from || this.startDate;
  }

  getEndDate(): string | undefined {
    return this.to || this.endDate;
  }
}
```

**Step 4: Chạy test để xác nhận test PASS**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/dto/financial-export-query.dto.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/financial/dto/financial-export-query.dto.ts backend/src/modules/financial/dto/financial-export-query.dto.spec.ts
git commit -m "feat(financial): add DTO validation and tests for financial export"
```

---

## Task 3: Xây dựng `FinancialExportService` - Module tạo file Excel (.xlsx)

**Files:**
- Create: `backend/src/modules/financial/financial-export.service.ts`
- Create: `backend/src/modules/financial/financial-export.service.spec.ts`
- Modify: `backend/src/modules/financial/financial.module.ts`

**Step 1: Viết test cho phương thức xuất Excel**

Tạo `backend/src/modules/financial/financial-export.service.spec.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { FinancialExportService } from "./financial-export.service";

describe("FinancialExportService", () => {
  const service = new FinancialExportService();

  const mockSummary = {
    rentalRevenue: 15500000,
    depositReceived: 8000000,
    depositHeld: 5000000,
    depositHeldCount: 4,
    refundedDeposit: 2500000,
    damageDeduction: 500000,
    forfeitedDeposit: 0,
    totalTransactions: 18,
    totalBookings: 12,
    paidBookings: 10,
    unpaidBookings: 2,
  };

  const mockRevenueByDay = [
    { date: "2026-11-01", rentalRevenue: 3500000, depositReceived: 2000000 },
    { date: "2026-11-02", rentalRevenue: 4200000, depositReceived: 1500000 },
  ];

  const mockReconciliation = {
    rentalRevenue: 15500000,
    depositReceived: 8000000,
    refundedDeposit: 2500000,
    damageDeductions: 500000,
    netCashFlow: 21000000,
    transactionCount: 18,
  };

  it("should generate a valid Excel workbook buffer with 3 sheets", async () => {
    const buffer = await service.generateExcelReport({
      dateLabel: "Từ 01/11/2026 đến 10/11/2026",
      summary: mockSummary,
      revenueByDay: mockRevenueByDay,
      reconciliation: mockReconciliation,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
```

**Step 2: Chạy test để xác nhận test FAIL**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/financial-export.service.spec.ts
```
Expected: FAIL

**Step 3: Cài đặt logic tạo file Excel với `exceljs`**

Tạo `backend/src/modules/financial/financial-export.service.ts`:
- Sheet 1: `Tổng quan KPI` (Chỉ số tổng hợp: Doanh thu thuê, Tiền cọc nhận, Tiền cọc đang giữ, Đã hoàn trả, Phí bồi thường/phạt, Số đơn hàng). Có màu sắc sang trọng (brand Heritage Cổ Phục: antique gold, deep burgundy, jade accent). Format số tiền `#,##0 "VND"`.
- Sheet 2: `Doanh thu theo ngày` (Bảng chi tiết: Cột Ngày, Tiền thuê, Tiền cọc nhận, Tổng thu phát sinh). Có dòng Total SUM formula `=SUM(B4:B...)`.
- Sheet 3: `Đối soát & Dòng tiền` (Reconciliation: Tiền vào, Tiền ra, Dòng tiền thuần Net Cash Flow, Số lượng giao dịch).

**Step 4: Chạy test để xác nhận test PASS**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/financial-export.service.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/financial/financial-export.service.ts backend/src/modules/financial/financial-export.service.spec.ts
git commit -m "feat(financial): implement Excel report generation with exceljs"
```

---

## Task 4: Xây dựng tính năng xuất PDF Báo Cáo Tài Chính với `pdfkit`

**Files:**
- Modify: `backend/src/modules/financial/financial-export.service.ts`
- Modify: `backend/src/modules/financial/financial-export.service.spec.ts`

**Step 1: Viết test cho phương thức xuất PDF**

Thêm test case vào `backend/src/modules/financial/financial-export.service.spec.ts`:
```typescript
  it("should generate a valid PDF document buffer", async () => {
    const buffer = await service.generatePdfReport({
      dateLabel: "Từ 01/11/2026 đến 10/11/2026",
      summary: mockSummary,
      revenueByDay: mockRevenueByDay,
      reconciliation: mockReconciliation,
      actorName: "Quản lý Cổ Phục",
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    // PDF Magic bytes check (%PDF-)
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
```

**Step 2: Chạy test để xác nhận test FAIL**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/financial-export.service.spec.ts
```
Expected: FAIL (method `generatePdfReport` not implemented)

**Step 3: Cài đặt logic tạo file PDF với `pdfkit`**

Trong `backend/src/modules/financial/financial-export.service.ts`:
- Sử dụng `PDFDocument` từ `pdfkit`.
- Thiết kế layout trang A4 tiêu chuẩn (margins: 40pt).
- Header: Logo / Tên hệ thống "CỔ PHỤC VIỆT - BÁO CÁO TÀI CHÍNH VẬN HÀNH".
- Thông tin chung: Kỳ báo cáo, Ngày in, Người lập biểu.
- Bảng KPI Tổng hợp (Grid 2 cột dạng thẻ chỉ số đẹp mắt).
- Bảng Doanh thu theo ngày (Header nền đậm, zebra striping, căn phải số tiền).
- Footer: Trang X, cam kết tính chính xác, chữ ký Người lập biểu và Kế toán trưởng.
- Trả về Promise<Buffer>.

**Step 4: Chạy test để xác nhận test PASS**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/financial-export.service.spec.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/financial/financial-export.service.ts backend/src/modules/financial/financial-export.service.spec.ts
git commit -m "feat(financial): implement PDF report generation with pdfkit"
```

---

## Task 5: Thêm Endpoint `GET /api/financial/export` vào Controller & Service

**Files:**
- Modify: `backend/src/modules/financial/financial.service.ts`
- Modify: `backend/src/modules/financial/financial.controller.ts`
- Modify: `backend/src/modules/financial/financial.module.ts`
- Test: `backend/src/modules/financial/financial.service.spec.ts`

**Step 1: Viết test cho phương thức `exportFinancialReport` trong `financial.service.spec.ts`**

Kiểm tra:
- Hàm gọi `getSummary`, `getRevenueByDay`, `getReconciliation` theo khoảng thời gian đã cho.
- Gọi đúng định dạng tương ứng sang `FinancialExportService`.
- Trả về `{ filename, buffer, contentType }`.

**Step 2: Chạy test để xác nhận test FAIL**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/financial.service.spec.ts
```
Expected: FAIL

**Step 3: Viết minimal implementation trong Service & Controller**

Trong `financial.service.ts`:
- Thêm `exportReport(query: FinancialExportQueryDto, actorName?: string)`:
  - Tính toán `dateRange` và `dateLabel` (ví dụ: `01/11/2026 - 10/11/2026`).
  - Lấy data song song: `getSummary`, `getRevenueByDay`, `getReconciliation`.
  - Nếu `query.format === 'xlsx'`: gọi `generateExcelReport`, gán `contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`, `filename: bao-cao-tai-chinh-YYYYMMDD.xlsx`.
  - Nếu `query.format === 'pdf'`: gọi `generatePdfReport`, gán `contentType: 'application/pdf'`, `filename: bao-cao-tai-chinh-YYYYMMDD.pdf`.

Trong `financial.controller.ts`:
- Thêm route:
  ```typescript
  @Get("export")
  async exportReport(
    @Query() query: FinancialExportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const result = await this.financialService.exportReport(query, user.fullName || user.email);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  }
  ```

**Step 4: Chạy test backend để xác nhận test PASS**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/
```
Expected: PASS ALL

**Step 5: Commit**

```bash
git add backend/src/modules/financial/
git commit -m "feat(financial): add GET /api/financial/export endpoint supporting PDF and XLSX"
```

---

## Task 6: Thêm hàm gọi API Export trong `frontend/src/lib/api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/financial-export.test.ts`

**Step 1: Viết failing test cho `downloadFinancialExport`**

Tạo `frontend/src/lib/financial-export.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadFinancialReport } from "./api";

describe("downloadFinancialReport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should trigger a download for exported financial file", async () => {
    const mockBlob = new Blob(["fake-content"], { type: "application/pdf" });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({
        "content-disposition": 'attachment; filename="bao-cao-tai-chinh.pdf"',
      }),
    });

    const createObjectURLMock = vi.fn().mockReturnValue("blob:http://localhost/test");
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    const result = await downloadFinancialReport({ format: "pdf", preset: "this_month" });
    expect(result.success).toBe(true);
    expect(createObjectURLMock).toHaveBeenCalled();
  });
});
```

**Step 2: Chạy test để xác nhận test FAIL**

```bash
frontend/node_modules/.bin/vitest run src/lib/financial-export.test.ts
```
Expected: FAIL

**Step 3: Viết triển khai `downloadFinancialReport` trong `frontend/src/lib/api.ts`**

Thêm function `downloadFinancialReport(params: { format: "pdf" | "xlsx"; from?: string; to?: string; preset?: string; startDate?: string; endDate?: string })`:
- Lấy token từ `localStorage` hoặc session.
- Thực hiện `fetch` với header `Authorization: Bearer <token>`.
- Parse blob, đọc filename từ `content-disposition` header (fallback sang tên mặc định).
- Tạo thẻ `<a>`, trigger click download và thu dọn `URL.revokeObjectURL`.

**Step 4: Chạy test để xác nhận test PASS**

```bash
frontend/node_modules/.bin/vitest run src/lib/financial-export.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/financial-export.test.ts
git commit -m "feat(frontend): add downloadFinancialReport helper in api.ts"
```

---

## Task 7: Tích hợp nút "Xuất báo cáo" trên Manager Dashboard (`FinanceTab`)

**Files:**
- Modify: `frontend/src/app/dashboard/manager/page.tsx`
- Test: `frontend/src/app/dashboard/manager/page.test.tsx` (hoặc test component nếu có)

**Step 1: Thiết kế giao diện Nút "Xuất báo cáo"**

Trong tab `finance` (`FinanceTab`) của `frontend/src/app/dashboard/manager/page.tsx`:
- Bổ sung nút "Xuất báo cáo" kế bên bộ lọc ngày hoặc thanh công cụ:
  - Icon: `Download` hoặc `FileSpreadsheet` từ `lucide-react`.
  - Dropdown menu lựa chọn:
    1. **Xuất file PDF (.pdf)**: Kèm biểu tượng file PDF màu đỏ, chú thích "Phù hợp in ấn & lưu trữ kế toán".
    2. **Xuất file Excel (.xlsx)**: Kèm biểu tượng file Excel màu xanh lá, chú thích "Đầy đủ bảng tính & công thức".
  - Hiển thị trạng thái `Đang xuất...` (loading spinner) khi đang tải file.
  - Tự động truyền các tham số ngày tương ứng với bộ lọc hiện tại:
    - Nếu `preset === "custom"`: gửi `startDate=customStart&endDate=customEnd`.
    - Nếu preset là `today`, `this_month`, `this_year`: gửi `preset`.

**Step 2: Kiểm tra compile & typecheck frontend**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```
Expected: không có lỗi TypeScript.

**Step 3: Commit**

```bash
git add frontend/src/app/dashboard/manager/page.tsx
git commit -m "feat(manager): add Export Report button (PDF & Excel) to Finance tab"
```

---

## Task 8: Verification & E2E Validation

**Files:**
- Run all test suites in both backend and frontend.

**Step 1: Chạy toàn bộ backend test**

```bash
backend/node_modules/.bin/vitest run src/modules/financial/
```
Expected: All 10+ financial tests pass.

**Step 2: Chạy toàn bộ frontend test**

```bash
frontend/node_modules/.bin/vitest run src/lib/
```
Expected: All tests pass.

**Step 3: Typecheck cả dự án**

```bash
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```
Expected: Exit code 0, no errors.

**Step 4: Commit hoàn tất**

```bash
git commit --allow-empty -m "docs: finalize financial export PDF and Excel implementation"
```

