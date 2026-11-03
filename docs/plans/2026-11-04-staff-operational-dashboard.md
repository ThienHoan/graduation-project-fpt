# Staff Operational Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Xây dựng trang Staff Operational Dashboard thời gian thực cho hệ thống Cổ Phục Việt Nam, thay thế redirect tạm của tab `overview` bằng một dashboard vận hành toàn diện với các chỉ số hành động, tình trạng hiện vật (read-only), lịch trình trong ngày và task queue ưu tiên.

**Architecture:** Backend bổ sung endpoint `GET /api/bookings/staff/overview` trong `BookingsController` tổng hợp chỉ số hôm nay theo timezone `Asia/Ho_Chi_Minh` (đơn chờ duyệt, đơn giao hôm nay, đơn đến hạn trả hôm nay, đơn quá hạn, đơn chờ kiểm tra), đếm trạng thái hiện vật thời gian thực (read-only) và lịch trình các mốc bàn giao/nhận trả. Frontend tạo component `StaffOverviewTab` tích hợp vào `StaffSidebar` và `frontend/src/app/dashboard/staff/page.tsx`, hỗ trợ click-through filter vào các tab tương ứng mà không làm gián đoạn luồng hiện có.

**Tech Stack:** NestJS 10, Prisma ORM, PostgreSQL (Supabase), Next.js 15, TypeScript, Tailwind CSS, Lucide Icons.

---

### Task 1: Backend DTO & Service Method cho Staff Overview

**Files:**
- Modify: `backend/src/modules/bookings/bookings.service.ts`
- Modify: `backend/src/modules/bookings/bookings.controller.ts`

**Step 1: Viết method `getStaffOverview()` trong `BookingsService`**
Method thực hiện các truy vấn song song:
1. Timezone: tính ngày hôm nay theo `Asia/Ho_Chi_Minh`.
2. Actionable Metrics:
   - `pendingConfirmationCount`: status = `pending_confirmation`
   - `deliveringTodayCount`: `rentalStartDate` = today VÀ status IN `[confirmed, preparing, ready_for_pickup, delivering]`
   - `returnTodayCount`: `rentalEndDate` = today VÀ status = `renting`
   - `overdueCount`: status = `overdue` (hoặc `renting` mà `rentalEndDate < today`)
   - `pendingInspectionCount`: status IN `[returned, inspection_pending]`
3. Live Asset Status (READ-ONLY snapshot):
   - Đếm `garment_assets` group theo status (`available`, `rented`, `laundry`, `maintenance`, `inspection_pending`, `damaged`, v.v.)
4. Today's Schedule:
   - Danh sách các đơn có `rentalStartDate` = today (bàn giao/giao hàng) hoặc `rentalEndDate` = today (nhận trả), kèm thông tin khách hàng, số điện thoại, phương thức nhận (`store_pickup` vs `delivery`).
5. Task Queue (ưu tiên P0 -> P3):
   - P0: Đơn quá hạn cần xử lý gấp
   - P1: Đơn chờ kiểm tra hiện vật
   - P2: Đơn mới chờ xác nhận
   - P3: Đơn cần chuẩn bị/bàn giao hôm nay
6. Inventory & Accessory Alerts:
   - Các đơn bắt đầu hôm nay hoặc ngày mai mà chưa gán asset hoặc có phụ kiện cần chuẩn bị.

**Step 2: Thêm endpoint vào `BookingsController`**
```typescript
@Get("staff/overview")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("staff", "manager_owner", "admin")
getStaffOverview() {
  return this.bookingsService.getStaffOverview();
}
```

**Step 3: Commit**
```bash
git add backend/src/modules/bookings/
git commit -m "feat(backend): add staff dashboard overview endpoint with actionable metrics and schedule"
```

---

### Task 2: Backend Unit Test cho Staff Overview

**Files:**
- Modify: `backend/src/modules/bookings/bookings.service.spec.ts`

**Step 1: Viết test case cho `getStaffOverview`**
Kiểm tra:
- Trả về đúng cấu trúc `{ metrics, assetStatus, schedule, taskQueue, alerts }`.
- Phân loại đúng số lượng theo status và date filter.
- Xử lý role guard cho Staff.

**Step 2: Chạy test bằng Vitest**
Run: `pnpm --filter backend test src/modules/bookings/bookings.service.spec.ts`
Expected: PASS

**Step 3: Commit**
```bash
git add backend/src/modules/bookings/bookings.service.spec.ts
git commit -m "test(backend): add unit tests for getStaffOverview"
```

---

### Task 3: Frontend API Client & Types

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: Định nghĩa interface và hàm `getStaffDashboardOverview`**
```typescript
export interface StaffOverviewResponse {
  metrics: {
    pendingConfirmation: number;
    deliveringToday: number;
    returnToday: number;
    overdue: number;
    pendingInspection: number;
  };
  assetStatus: {
    available: number;
    renting: number;
    laundryMaintenance: number;
    damagedPending: number;
    total: number;
  };
  todaySchedule: Array<{
    id: string;
    bookingCode: string;
    customerName: string;
    customerPhone: string;
    type: "pickup" | "delivery" | "return";
    timeLabel: string;
    status: string;
    pickupMethod: string;
    addressSnippet?: string;
    itemCount: number;
  }>;
  taskQueue: Array<{
    id: string;
    bookingId?: string;
    priority: "P0" | "P1" | "P2" | "P3";
    title: string;
    description: string;
    actionLabel: string;
    targetTab: "pending" | "all" | "inspection" | "refunds";
    targetStatus?: string;
    bookingCode?: string;
  }>;
  alerts: Array<{
    id: string;
    severity: "warning" | "danger" | "info";
    message: string;
    bookingCode?: string;
  }>;
}

export async function getStaffDashboardOverview(): Promise<ApiResponse<StaffOverviewResponse>> {
  return request<StaffOverviewResponse>("/bookings/staff/overview");
}
```

**Step 2: Typecheck frontend**
Run: `pnpm --filter frontend typecheck`
Expected: PASS

**Step 3: Commit**
```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): add getStaffDashboardOverview API client and response types"
```

---

### Task 4: Xây dựng Component `StaffOverviewTab`

**Files:**
- Create: `frontend/src/components/dashboard/staff/staff-overview-tab.tsx`

**Step 1: Xây dựng UI Component**
Gồm 5 khu vực được bố trí cân đối theo chuẩn Heritage theme của dự án:
1. **Header chào ngày mới & nút Refresh**: Hiển thị ngày giờ hiện tại theo giờ Việt Nam, nút làm mới dữ liệu với hiệu ứng loading.
2. **Actionable Metrics Grid (5 cards)**:
   - 🕒 Chờ xác nhận (Click -> chuyển tab `pending`)
   - 🚚 Cần giao / Bàn giao hôm nay (Click -> chuyển tab `all` lọc `ready_for_pickup`)
   - 🔄 Hạn trả hôm nay (Click -> chuyển tab `all` lọc `renting`)
   - ⚠️ Quá hạn cần liên hệ (Click -> chuyển tab `all` lọc `overdue`, badge đỏ nhấp nháy)
   - 🔍 Chờ kiểm tra đồ trả (Click -> chuyển tab `inspection`)
3. **Live Asset Status Bar (Read-only)**:
   - Thống kê tỷ lệ và số lượng tài sản theo màu sắc: 🟢 Sẵn sàng, 🟡 Khách giữ, 🧼 Giặt/Bảo trì, 🔴 Chờ xử lý.
   - Chú thích rõ quyền thay đổi thuộc Manager, Staff chỉ theo dõi để điều phối.
4. **Hai cột chính (Schedule & Task Queue)**:
   - Cột trái: **Lịch trình trong ngày (Today's Timeline)** — Hiển thị các lượt khách lấy đồ và trả đồ, phân biệt rõ Nhận tại cửa hàng (`store_pickup`) và Giao tận nơi (`delivery`), có nút Xem đơn.
   - Cột phải: **Hàng chờ ưu tiên (Task Queue)** — Sắp xếp theo thứ tự khẩn cấp từ P0 (Quá hạn) -> P1 (Kiểm đồ) -> P2 (Duyệt đơn) -> P3 (Chuẩn bị đồ).
5. **Cảnh báo Vận hành (Operational Alerts)**:
   - Hiển thị danh sách cảnh báo thiếu phụ kiện hoặc đơn cận ngày chưa chuẩn bị xong (nếu có).
6. **State handling**: Skeleton loading, empty states khi không có đơn trong ngày, error alert với nút thử lại.

**Step 2: Commit**
```bash
git add frontend/src/components/dashboard/staff/staff-overview-tab.tsx
git commit -m "feat(frontend): create StaffOverviewTab component with metrics, schedule, asset status and task queue"
```

---

### Task 5: Tích hợp vào `StaffSidebar` và `frontend/src/app/dashboard/staff/page.tsx`

**Files:**
- Modify: `frontend/src/components/dashboard/staff-sidebar.tsx`
- Modify: `frontend/src/app/dashboard/staff/page.tsx`

**Step 1: Cập nhật `StaffSidebar`**
- Thêm item "Tổng quan vận hành" với icon `LayoutDashboard` vào đầu nhóm "Vận hành & Đơn hàng":
  `{ key: "overview", label: "Tổng quan vận hành", icon: LayoutDashboard, href: "/dashboard/staff#overview" }`
- Đổi item "Tất cả đơn thuê" sang icon `Layers` hoặc `FileText` để phân biệt rõ ràng.

**Step 2: Cập nhật `page.tsx`**
- Thêm `"overview"` vào `type Tab = "overview" | "pending" | "all" | "refunds" | "map";`
- Default tab khởi tạo: nếu hash rỗng hoặc `#overview` thì hiển thị `overview`.
- Khi `tab === "overview"`, render `<StaffOverviewTab onSwitchTab={switchTab} onSelectBooking={...} />`.
- Khi click từ các metric card hoặc task queue, gọi `switchTab` để điều hướng mượt mà trong cùng trang.

**Step 3: Commit**
```bash
git add frontend/src/components/dashboard/staff-sidebar.tsx frontend/src/app/dashboard/staff/page.tsx
git commit -m "feat(frontend): integrate StaffOverviewTab into staff portal and navigation"
```

---

### Task 6: Testing & Verification

**Files:**
- Run automated tests & typechecks

**Step 1: Typecheck Backend & Frontend**
Run: `pnpm run typecheck:backend && pnpm run typecheck:frontend`
Expected: 0 errors

**Step 2: Run Unit Tests**
Run: `pnpm run test:backend`
Expected: Tất cả tests pass

**Step 3: Final Verification Commit**
```bash
git commit --allow-empty -m "chore: verify staff operational dashboard implementation"
```

