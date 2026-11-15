import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StaffIncidentDetail, StaffIncidentListItem } from "@/lib/api";

const mockList = vi.fn();
const mockGet = vi.fn();
const mockScan = vi.fn();

vi.mock("@/lib/api", () => ({
  listStaffIncidents: (...args: unknown[]) => mockList(...args),
  getStaffIncident: (...args: unknown[]) => mockGet(...args),
  runIncidentScan: (...args: unknown[]) => mockScan(...args),
}));

const currentUser = { id: "u-1", email: "m@example.com", role: "manager_owner", fullName: "Quản Lý" };

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: currentUser }),
}));

// Shell đầy đủ không cần cho test logic — thay bằng wrapper đơn giản.
vi.mock("@/components/heritage/ui", () => ({
  ManagerPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ManagerIncidentsPage from "./page";

function makeRow(overrides: Partial<StaffIncidentListItem> = {}): StaffIncidentListItem {
  return {
    id: "inc-1",
    bookingId: "book-12345678",
    bookingCode: "BOOK1234",
    status: "open",
    reason: "asset_damaged",
    dueAt: "2026-11-10",
    detectedAt: "2026-11-08T10:00:00.000Z",
    rentalStartDate: "2026-11-10",
    rentalEndDate: "2026-11-12",
    daysRemaining: 2,
    daysOverdue: 0,
    bookingStatus: "paid",
    customer: { fullName: "Nguyễn Văn A", phone: "0900000000", email: "a@example.com" },
    item: {
      kind: "garment",
      bookingItemId: "item-1",
      bookingAccessoryItemId: null,
      assetCode: "AO-01",
      name: "Áo Nhật Bình",
      sizeLabel: "M",
      imageUrl: null,
    },
    ...overrides,
  };
}

function makeDetail(overrides: Partial<StaffIncidentDetail> = {}): StaffIncidentDetail {
  return {
    id: "inc-1",
    bookingId: "book-12345678",
    bookingCode: "BOOK1234",
    itemKind: "garment",
    reason: "asset_damaged",
    status: "needs_manager",
    dueAt: "2026-11-10",
    detectedAt: "2026-11-08T10:00:00.000Z",
    assetCode: "AO-01",
    snapshot: {
      name: "Áo Nhật Bình",
      sizeLabel: "M",
      imageUrl: null,
      dailyPrice: 100000,
      depositAmount: 300000,
      lineRental: 200000,
      quantity: 1,
      estimated: false,
    },
    resolution: null,
    resolvedAt: null,
    note: null,
    item: null,
    accessoryItem: null,
    booking: {
      id: "book-12345678",
      status: "paid",
      rentalStartDate: "2026-11-10",
      rentalEndDate: "2026-11-12",
      rentalTotal: 400000,
      depositTotal: 400000,
      customerId: "cust-1",
      customer: { email: "a@example.com", profile: { fullName: "Nguyễn Văn A", phone: "0900000000" } },
      items: [],
      accessoryItems: [],
    },
    relatedRequests: [],
    suggestions: [],
    ...overrides,
  };
}

/** Server trả trang có phân trang: `{ items, total, page, limit, totalPages }`. */
function makePage(
  items: StaffIncidentListItem[] = [makeRow()],
  overrides: Partial<{ total: number; page: number; limit: number; totalPages: number }> = {},
) {
  return {
    success: true,
    data: {
      items,
      total: items.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      ...overrides,
    },
  };
}

describe("ManagerIncidentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.role = "manager_owner";
    mockList.mockResolvedValue(makePage());
    mockGet.mockResolvedValue({ success: true, data: makeDetail() });
    mockScan.mockResolvedValue({ success: true, data: { opened: 2, resolved: 1 } });
  });

  it("renders the table in the exact order returned by the server", async () => {
    mockList.mockResolvedValue(
      makePage([
        makeRow({ id: "late", bookingCode: "LATE0001", dueAt: "2026-11-20", daysRemaining: 11 }),
        makeRow({ id: "early", bookingCode: "EARL0001", dueAt: "2026-11-09", daysRemaining: 1 }),
      ]),
    );

    render(<ManagerIncidentsPage />);

    const rows = await screen.findAllByRole("row");
    // row[0] là header, dữ liệu bắt đầu từ row[1] — giữ đúng thứ tự server.
    expect(rows[1]).toHaveTextContent("LATE0001");
    expect(rows[2]).toHaveTextContent("EARL0001");
  });

  it("sự cố còn mở: nút 'Xử lý' là liên kết sang trang sự cố; sự cố đã xử lý chỉ có 'Chi tiết'", async () => {
    mockList.mockResolvedValue(
      makePage([
        makeRow({ id: "open", bookingCode: "OPEN0001", status: "open" }),
        makeRow({ id: "waiting", bookingCode: "WAIT0001", status: "awaiting_customer" }),
        makeRow({ id: "done", bookingCode: "DONE0001", status: "resolved" }),
      ]),
    );

    render(<ManagerIncidentsPage />);
    await screen.findByText("#WAIT0001");

    // Cả 2 sự cố còn mở đều có liên kết "Xử lý" trỏ về trang sự cố của đơn.
    const links = screen.getAllByRole("link", { name: /Xử lý sự cố/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/booking/incidents/book-12345678");
    }

    // Cả 3 dòng đều có "Chi tiết" (mở drawer chỉ đọc/xem lại).
    expect(screen.getAllByRole("button", { name: /Chi tiết sự cố/ })).toHaveLength(3);

    // KHÔNG còn bề mặt thao tác riêng (drawer hành động) ngoài liên kết.
    expect(screen.queryByRole("button", { name: /Xử lý sự cố/ })).not.toBeInTheDocument();
  });

  it("shows booking code, customer, rental dates, remaining days and item", async () => {
    render(<ManagerIncidentsPage />);

    expect(await screen.findByText("#BOOK1234")).toBeInTheDocument();
    expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getByText("10/11/2026 – 12/11/2026")).toBeInTheDocument();
    expect(screen.getByText("Còn 2 ngày")).toBeInTheDocument();
    expect(screen.getByText(/Áo Nhật Bình · M/)).toBeInTheDocument();
  });

  it("hiển thị 'Quá hạn N ngày' cho đơn đã qua ngày thuê", async () => {
    mockList.mockResolvedValue(makePage([makeRow({ daysRemaining: 0, daysOverdue: 26 })]));

    render(<ManagerIncidentsPage />);

    expect(await screen.findByText("Quá hạn 26 ngày")).toBeInTheDocument();
  });

  it("passes status filter and search term to the API", async () => {
    render(<ManagerIncidentsPage />);
    await screen.findByText("#BOOK1234");

    fireEvent.change(screen.getByLabelText("Lọc theo trạng thái"), { target: { value: "needs_manager" } });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({
        status: "needs_manager",
        q: undefined,
        page: 1,
        limit: 20,
      }),
    );

    fireEvent.change(screen.getByLabelText("Tìm sự cố"), { target: { value: " 0900 " } });
    fireEvent.click(screen.getByRole("button", { name: "Tìm" }));
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({
        status: "needs_manager",
        q: "0900",
        page: 1,
        limit: 20,
      }),
    );
  });

  it("runs a scan and reports the result", async () => {
    render(<ManagerIncidentsPage />);
    await screen.findByText("#BOOK1234");

    fireEvent.click(screen.getByRole("button", { name: /Quét ngay/ }));

    expect(await screen.findByText("Đã quét: mở 2, tự xử lý 1.")).toBeInTheDocument();
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it("has a 'Đã xử lý' filter that queries only resolved incidents", async () => {
    render(<ManagerIncidentsPage />);
    await screen.findByText("#BOOK1234");

    fireEvent.change(screen.getByLabelText("Lọc theo trạng thái"), { target: { value: "resolved" } });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({
        status: "resolved",
        q: undefined,
        page: 1,
        limit: 20,
      }),
    );
  });

  it("phân trang: hiển thị trang hiện tại và tải trang kế tiếp", async () => {
    mockList.mockImplementation(async (query: { page?: number } = {}) =>
      query.page === 2
        ? makePage([makeRow({ id: "inc-2", bookingCode: "PAGE0002" })], {
            total: 25,
            page: 2,
            limit: 20,
            totalPages: 2,
          })
        : makePage([makeRow()], { total: 25, page: 1, limit: 20, totalPages: 2 }),
    );

    render(<ManagerIncidentsPage />);
    await screen.findByText("#BOOK1234");
    expect(screen.getByText(/Trang 1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/1–20 trong 25 sự cố/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({
        status: undefined,
        q: undefined,
        page: 2,
        limit: 20,
      }),
    );
    expect(await screen.findByText("#PAGE0002")).toBeInTheDocument();
  });

  it("mở drawer chi tiết (chỉ đọc) và hiện lỗi phát hiện bằng tiếng Việt", async () => {
    render(<ManagerIncidentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Chi tiết sự cố/ }));

    expect(await screen.findByRole("dialog", { name: "Chi tiết sự cố" })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("inc-1");
    // Trang quản lý hiện lý do bằng tiếng Việt, không phải mã kỹ thuật.
    expect((await screen.findAllByText("Trang phục bị hư hỏng")).length).toBeGreaterThan(0);
    // Header: tiêu đề + mã đơn + mốc phát hiện.
    expect(screen.getByText("Chi tiết sự cố")).toBeInTheDocument();
    expect(screen.getAllByText("#BOOK1234").length).toBeGreaterThan(0);
    expect(screen.getByText(/Phát hiện lúc/)).toBeInTheDocument();
    // Khối thông tin món + tài sản + đơn thuê + timeline.
    expect(screen.getByText(/Mã tài sản:/)).toBeInTheDocument();
    expect(screen.getByText("Thông tin đơn thuê")).toBeInTheDocument();
    expect(screen.getByText("Giá trị đơn thuê")).toBeInTheDocument();
    expect(screen.getByText("Lịch sử xử lý sự cố")).toBeInTheDocument();
    expect(screen.getByText("Phát hiện sự cố")).toBeInTheDocument();
    // Đã bỏ khối "Đơn thuê liên quan" và lối "Xem trang khách của đơn".
    expect(screen.queryByText("Đơn thuê liên quan")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Xem chi tiết đơn thuê/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Xem trang khách của đơn")).not.toBeInTheDocument();

    // Sự cố còn mở: footer mời mở trang xử lý sự cố của đơn.
    const handleLink = await screen.findByRole("link", { name: /Mở trang xử lý sự cố/ });
    expect(handleLink).toHaveAttribute("href", "/booking/incidents/book-12345678");
  });

  it("đơn bị huỷ → hiện số tiền hoàn cọc trong chi tiết sự cố", async () => {
    mockList.mockResolvedValue(makePage([makeRow({ status: "resolved" })]));
    mockGet.mockResolvedValue({
      success: true,
      data: makeDetail({
        status: "resolved",
        resolution: "booking_cancelled",
        resolvedAt: "2026-11-11T07:40:34.000Z",
        settlement: { bookingCancelled: true, extraChargeAmount: 0, refundAmount: 400_000, depositAmount: 400_000 },
      }),
    });

    render(<ManagerIncidentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Chi tiết/ }));
    await screen.findByRole("dialog", { name: "Chi tiết sự cố" });

    expect(await screen.findByText(/Hoàn cọc: 400\.000/)).toBeInTheDocument();
  });

  it("đơn thu thêm → hiện tổng thu thêm; đơn giảm → hiện số hoàn trả", async () => {
    mockList.mockResolvedValue(makePage());
    mockGet.mockResolvedValue({
      success: true,
      data: makeDetail({
        settlement: { bookingCancelled: false, extraChargeAmount: 50_000, refundAmount: 0, depositAmount: 400_000 },
      }),
    });

    render(<ManagerIncidentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Chi tiết/ }));
    await screen.findByRole("dialog", { name: "Chi tiết sự cố" });

    expect(await screen.findByText(/Thu thêm: 50\.000/)).toBeInTheDocument();
  });

  it("sự cố đã xử lý: drawer chỉ đọc, hiện lỗi đã gặp + cách xử lý + thông tin liên quan", async () => {
    mockList.mockResolvedValue(makePage([makeRow({ status: "resolved" })]));
    mockGet.mockResolvedValue({
      success: true,
      data: makeDetail({
        status: "resolved",
        resolution: "booking_cancelled",
        resolvedAt: "2026-11-11T07:40:34.000Z",
        note: "Đơn quá hạn thanh toán",
      }),
    });

    render(<ManagerIncidentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Chi tiết/ }));
    await screen.findByRole("dialog", { name: "Chi tiết sự cố" });

    // Lỗi gì đã xảy ra...
    expect((await screen.findAllByText("Trang phục bị hư hỏng")).length).toBeGreaterThan(0);
    // ...đã xử lý ra sao + ghi chú.
    expect(screen.getByText("Kết quả xử lý")).toBeInTheDocument();
    expect(screen.getAllByText("Đơn đã huỷ nên sự cố tự đóng").length).toBeGreaterThan(0);
    expect(screen.getByText(/Ghi chú: Đơn quá hạn thanh toán/)).toBeInTheDocument();
    // Timeline có bước hoàn tất xử lý.
    expect(screen.getByText("Hoàn tất xử lý")).toBeInTheDocument();
    // ...kèm thông tin liên quan của đơn.
    expect(screen.getByText("Khách hàng")).toBeInTheDocument();
    expect(screen.getByText(/Giá trị đơn/)).toBeInTheDocument();
    // Không còn khối "Đơn thuê liên quan" / lối sang trang chi tiết đơn thuê.
    expect(screen.queryByText("Đơn thuê liên quan")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Xem chi tiết đơn thuê/ })).not.toBeInTheDocument();

    // Đã xử lý → chỉ xem lại, KHÔNG có liên kết mở trang xử lý.
    expect(screen.getByText(/Sự cố đã xử lý/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mở trang xử lý sự cố/ })).not.toBeInTheDocument();
  });

  it("staff sees the table but no scan button", async () => {
    currentUser.role = "staff";

    render(<ManagerIncidentsPage />);
    await screen.findByText("#BOOK1234");

    expect(screen.queryByRole("button", { name: /Quét ngay/ })).not.toBeInTheDocument();
    // Staff vẫn xem được chi tiết (chỉ đọc) và có liên kết sang trang sự cố cho sự cố còn mở.
    fireEvent.click(screen.getByRole("button", { name: /Chi tiết sự cố/ }));
    await screen.findByRole("dialog", { name: "Chi tiết sự cố" });
    expect(await screen.findByRole("link", { name: /Mở trang xử lý sự cố/ })).toBeInTheDocument();
  });

  it("admin also sees the scan button", async () => {
    currentUser.role = "admin";

    render(<ManagerIncidentsPage />);
    await screen.findByText("#BOOK1234");

    expect(screen.getByRole("button", { name: /Quét ngay/ })).toBeInTheDocument();
  });
});
