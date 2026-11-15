/**
 * @blast-radius: ui
 * Trang khách xử lý sự cố đổi mẫu / bỏ món (§13.3).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const authState = vi.hoisted(() => ({ user: { id: "cust-1", role: "customer" } as { id: string; role: string } | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ bookingId: "book-12345678" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api", () => ({
  getBookingIncidents: vi.fn(),
  createBookingChangeRequest: vi.fn(),
  previewBookingChangeRequest: vi.fn(),
  confirmBookingChangeRequest: vi.fn(),
  cancelBookingChangeRequest: vi.fn(),
  declineBookingIncident: vi.fn(),
  getBookingChangeRequest: vi.fn(),
  cancelBooking: vi.fn(),
  applyStaffIncidentAction: vi.fn(),
  previewStaffIncidentEmail: vi.fn(),
}));

import {
  applyStaffIncidentAction,
  cancelBookingChangeRequest,
  confirmBookingChangeRequest,
  createBookingChangeRequest,
  getBookingChangeRequest,
  getBookingIncidents,
  previewBookingChangeRequest,
  previewStaffIncidentEmail,
} from "@/lib/api";
import BookingIncidentsPage from "./page";

const mockedIncidents = vi.mocked(getBookingIncidents);
const mockedCreate = vi.mocked(createBookingChangeRequest);
const mockedPreview = vi.mocked(previewBookingChangeRequest);
const mockedConfirm = vi.mocked(confirmBookingChangeRequest);
const mockedCancelRequest = vi.mocked(cancelBookingChangeRequest);
const mockedGetRequest = vi.mocked(getBookingChangeRequest);
const mockedManagerAction = vi.mocked(applyStaffIncidentAction);
const mockedManagerPreview = vi.mocked(previewStaffIncidentEmail);

const garmentIncident = {
  id: "inc-1",
  itemKind: "garment",
  bookingItemId: "item-1",
  bookingAccessoryItemId: null,
  reason: "Đang giặt",
  status: "awaiting_customer",
  dueAt: "2026-11-20",
  snapshot: {
    name: "Áo Nhật Bình",
    sizeLabel: "M",
    imageUrl: null,
    dailyPrice: 350000,
    depositAmount: 500000,
    lineRental: 700000,
    quantity: 1,
    estimated: true,
  },
};

const existingGarmentItem = {
  id: "item-1",
  garmentId: "g-1",
  garmentAssetId: "asset-1",
  sizeId: "size-1",
  sizeLabel: "M",
  name: "Áo Nhật Bình",
  imageUrl: null,
};

const keptAccessory = {
  id: "acc-item-keep",
  bookingItemId: "item-1",
  accessoryId: "acc-keep",
  accessoryAssetId: "acc-asset-keep",
  name: "Quạt giấy",
  imageUrl: null,
  unitPrice: 0,
  isIncluded: true,
  rentalTotal: 0,
};

/** Mẫu trang phục gợi ý kèm 1 phụ kiện mới (miễn phí) của mẫu đó. */
const garmentSuggestion = {
  incidentId: "inc-1",
  itemKind: "garment",
  garmentId: "g-1",
  options: [
    {
      garmentId: "g-2",
      sizeId: "size-2",
      sizeLabel: "M",
      name: "Áo Cổ Phục",
      imageUrl: "https://cdn.example/ao-2.jpg",
      available: 2,
      accessories: [
        {
          accessoryId: "acc-new",
          name: "Trâm cài",
          imageUrl: null,
          isIncluded: true,
          extraPrice: 0,
          available: 3,
        },
      ],
    },
  ],
};

function incidentData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      booking: {
        id: "book-12345678",
        status: "confirmed",
        rentalStartDate: "2026-11-20",
        rentalEndDate: "2026-11-22",
        paid: true,
      },
      incidents: [garmentIncident],
      items: [existingGarmentItem],
      accessoryItems: [keptAccessory],
      suggestions: [garmentSuggestion],
      pendingRequest: null,
      ...overrides,
    },
  };
}

/** Đơn chỉ lỗi PHỤ KIỆN: gợi ý các MẪU phụ kiện khác của cùng trang phục. */
function accessoryOnlyData() {
  return {
    success: true,
    data: {
      booking: {
        id: "book-12345678",
        status: "confirmed",
        rentalStartDate: "2026-11-20",
        rentalEndDate: "2026-11-22",
        paid: true,
      },
      incidents: [
        {
          id: "inc-acc",
          itemKind: "accessory",
          bookingItemId: null,
          bookingAccessoryItemId: "acc-item-1",
          reason: "Phụ kiện cần vệ sinh",
          status: "awaiting_customer",
          dueAt: "2026-11-20",
          snapshot: {
            name: "Quạt giấy",
            sizeLabel: null,
            imageUrl: null,
            dailyPrice: 50000,
            depositAmount: 0,
            lineRental: 50000,
            quantity: 2,
            estimated: false,
          },
        },
      ],
      items: [existingGarmentItem],
      accessoryItems: [
        {
          ...keptAccessory,
          id: "acc-item-1",
          accessoryId: "acc-1",
          accessoryAssetId: "acc-asset-old",
          name: "Quạt giấy",
        },
      ],
      suggestions: [
        {
          incidentId: "inc-acc",
          itemKind: "accessory",
          accessoryId: "acc-1",
          name: "Quạt giấy",
          options: [
            {
              accessoryId: "acc-2",
              name: "Quạt lụa",
              imageUrl: null,
              isIncluded: false,
              extraPrice: 30000,
              available: 1,
            },
          ],
        },
      ],
      pendingRequest: null,
    },
  };
}

function quote(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      requestId: "req-1",
      status: "quoted",
      rentBefore: 700000,
      rentAfter: 750000,
      rentComponent: 50000,
      accessoryDelta: 0,
      depositBefore: 500000,
      depositAfter: 500000,
      depositDelta: 0,
      discountBefore: 0,
      discountAfter: 0,
      chargeNow: 50000,
      accruedCredit: 120000,
      lines: [
        { component: "rent", direction: "charge", amount: 50000 },
        { component: "accessory_rent", direction: "credit", amount: 120000 },
      ],
      paymentRequired: true,
      requiresHold: true,
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      countdownSeconds: 600,
      afterItems: [
        {
          id: "item-1",
          kind: "garment",
          name: "Áo Nhật Bình",
          imageUrl: null,
          sizeLabel: "M",
          quantity: 1,
          lineTotal: 700000,
          isIncluded: false,
        },
      ],
      ...overrides,
    },
  };
}

describe("BookingIncidentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "cust-1", role: "customer" };
    mockedIncidents.mockResolvedValue(incidentData() as never);
    mockedPreview.mockResolvedValue(quote() as never);
  });

  it("lists affected items with the estimated label", async () => {
    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Áo Nhật Bình")).toBeInTheDocument();
    expect(screen.getByText("ước tính")).toBeInTheDocument();
    expect(screen.getByText(/Món bị ảnh hưởng/)).toBeInTheDocument();
  });

  it("creates a quote with a countdown and splits charge vs credit", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith("book-12345678", {
        type: "replace",
        incidents: ["inc-1"],
        replacements: [{ incidentId: "inc-1", sizeId: "size-2" }],
        removeAccessoryItemIds: undefined,
        addAccessories: [{ itemId: "item-1", accessoryId: "acc-new", quantity: 1 }],
      }),
    );

    expect(await screen.findByText("Thu thêm hôm nay")).toBeInTheDocument();
    expect(screen.getByText("Sẽ hoàn lại khi trả đồ")).toBeInTheDocument();
    expect(screen.getByText(/Giữ chỗ còn 10:00/)).toBeInTheDocument();
  });

  it("disables confirmation and offers 'Chọn lại' once the hold expired", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote({ countdownSeconds: 0 }) as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    expect(await screen.findByText(/hết hạn/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Chọn lại/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xác nhận & thanh toán/i })).not.toBeInTheDocument();
  });

  it("sends the customer to the change-payment page when a surcharge is required", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);
    mockedConfirm.mockResolvedValue({
      success: true,
      data: { requestId: "req-1", status: "awaiting_payment", paymentRequired: true },
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));
    await user.click(await screen.findByRole("button", { name: /Xác nhận & thanh toán/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/booking/change-payment?requestId=req-1&bookingId=book-12345678"),
    );
  });

  it("chuyển thẳng sang cổng thanh toán PayOS khi xác nhận cần thu chênh", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);
    mockedConfirm.mockResolvedValue({
      success: true,
      data: {
        requestId: "req-1",
        status: "awaiting_payment",
        paymentRequired: true,
        checkoutUrl: "https://pay.example/change-request",
      },
    } as never);

    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, href: "" },
      writable: true,
      configurable: true,
    });

    try {
      render(<BookingIncidentsPage />);

      await screen.findByText("Áo Nhật Bình");
      await user.click(screen.getByRole("radio"));
      await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));
      await user.click(await screen.findByRole("button", { name: /Xác nhận & thanh toán/i }));

      await waitFor(() => expect(window.location.href).toBe("https://pay.example/change-request"));
      expect(mockPush).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  it("shows the server message when the item is out of stock (409)", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue({
      success: false,
      error: "CONFLICT",
      message: "Mẫu thay thế đã hết hàng cho khoảng ngày thuê.",
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    expect(await screen.findByText("Mẫu thay thế đã hết hàng cho khoảng ngày thuê.")).toBeInTheDocument();
  });

  it("bỏ món: xác nhận là tạo + áp dụng ngay, không hiện báo giá/đếm ngược", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(
      quote({
        paymentRequired: false,
        requiresHold: false,
        chargeNow: 0,
        lines: [{ component: "rent", direction: "credit", amount: 120000 }],
      }) as never,
    );
    mockedConfirm.mockResolvedValue({
      success: true,
      data: { requestId: "req-1", status: "applied", type: "remove" },
    } as never);
    // Còn một trang phục KHÁC không bị sự cố → đây là "bỏ món" bình thường.
    mockedIncidents.mockResolvedValue(
      incidentData({
        items: [
          existingGarmentItem,
          {
            id: "item-2",
            garmentId: "g-9",
            garmentAssetId: "asset-9",
            sizeId: "size-9",
            sizeLabel: "L",
            name: "Áo Tứ Thân",
            imageUrl: null,
          },
        ],
      }) as never,
    );

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("button", { name: /^Bỏ món$/ }));

    // Không báo giá live, không đếm ngược giữ chỗ cho tab bỏ món.
    expect(screen.queryByText("Báo giá tạm tính")).not.toBeInTheDocument();
    expect(screen.queryByText(/Giữ chỗ còn/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Xác nhận bỏ món" }));

    // Tạo yêu cầu + xác nhận luôn, rồi về đơn thuê của khách.
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith("book-12345678", {
      type: "remove",
      incidents: ["inc-1"],
    }));
    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith("book-12345678", "req-1"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/customer"));
    // Không còn panel "Báo giá bỏ món" / nút huỷ yêu cầu làm rối khách.
    expect(screen.queryByText("Báo giá bỏ món")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy yêu cầu này" })).not.toBeInTheDocument();
  });

  it("bỏ món: còn trang phục khác trong đơn → chỉ bỏ món, không huỷ đơn", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(
      incidentData({
        items: [
          existingGarmentItem,
          {
            id: "item-2",
            garmentId: "g-9",
            garmentAssetId: "asset-9",
            sizeId: "size-9",
            sizeLabel: "L",
            name: "Áo Tứ Thân",
            imageUrl: null,
          },
        ],
      }) as never,
    );

    render(<BookingIncidentsPage />);
    await user.click(await screen.findByRole("button", { name: /^Bỏ món$/ }));

    // Vẫn còn trang phục "Áo Tứ Thân" → không cảnh báo huỷ đơn.
    expect(screen.queryByText(/huỷ toàn bộ đơn/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác nhận bỏ món" })).toBeInTheDocument();
  });

  it("bỏ món: bỏ HẾT trang phục → cảnh báo sẽ huỷ đơn trước khi xác nhận", async () => {
    const user = userEvent.setup();
    // Mặc định `incidentData` chỉ có 1 trang phục và cũng chính là món bị sự cố.
    render(<BookingIncidentsPage />);
    await user.click(await screen.findByRole("button", { name: /^Bỏ món$/ }));

    expect(await screen.findByText(/không còn trang phục nào/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác nhận bỏ món và huỷ đơn" })).toBeInTheDocument();
  });

  it("bỏ món: báo giá tạm tính nằm TRÊN nút giữ chỗ 10 phút (tab đổi mẫu)", async () => {
    render(<BookingIncidentsPage />);

    const panelTitle = await screen.findByText("Báo giá tạm tính");
    const holdButton = screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i });

    // Nút phải nằm SAU panel trong DOM (panel ở trên, nút ở dưới).
    expect(panelTitle.compareDocumentPosition(holdButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("bỏ HẾT món, đơn đã thanh toán → hiện tiền hoàn dự kiến, không hiện báo giá", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(
      incidentData({
        booking: {
          id: "book-12345678",
          status: "paid",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          refundEstimate: 1_200_000,
        },
      }) as never,
    );
    mockedCreate.mockResolvedValue(
      quote({ paymentRequired: false, requiresHold: false, chargeNow: 0 }) as never,
    );
    mockedConfirm.mockResolvedValue({
      success: true,
      data: { requestId: "req-1", status: "applied", type: "remove", cancelled: true },
    } as never);

    render(<BookingIncidentsPage />);
    await user.click(await screen.findByRole("button", { name: /^Bỏ món$/ }));

    // Trước khi xác nhận: hiện số tiền hoàn, KHÔNG hiện báo giá thuê/cọc.
    expect(await screen.findByText(/Số tiền hoàn dự kiến khi huỷ đơn/)).toBeInTheDocument();
    expect(screen.getByText(/1\.200\.000/)).toBeInTheDocument();
    expect(screen.queryByText("Báo giá tạm tính")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Xác nhận bỏ món và huỷ đơn" }));

    // Áp dụng ngay (không còn panel xác nhận lần 2) rồi về đơn thuê của khách.
    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith("book-12345678", "req-1"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/customer"));
    expect(screen.queryByText("Báo giá bỏ món")).not.toBeInTheDocument();
    expect(screen.queryByText("Sản phẩm thuê sau thay đổi")).not.toBeInTheDocument();
  });

  it("bỏ HẾT món, đơn chưa thanh toán → không hiện tiền hoàn lẫn báo giá", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(
      incidentData({
        booking: {
          id: "book-12345678",
          status: "confirmed",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          refundEstimate: 0,
        },
      }) as never,
    );

    render(<BookingIncidentsPage />);
    await user.click(await screen.findByRole("button", { name: /^Bỏ món$/ }));

    expect(await screen.findByText(/không còn trang phục nào/)).toBeInTheDocument();
    expect(screen.queryByText(/Số tiền hoàn/)).not.toBeInTheDocument();
    expect(screen.queryByText("Báo giá tạm tính")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác nhận bỏ món và huỷ đơn" })).toBeInTheDocument();
  });

  it("awaiting_payment: nút 'Thanh toán phần chênh' dẫn lại trang thanh toán (không bị khoá)", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(
      incidentData({ pendingRequest: { id: "req-1", countdownSeconds: 300, requiresHold: true } }) as never,
    );
    mockedGetRequest.mockResolvedValue({
      success: true,
      data: {
        id: "req-1",
        bookingId: "book-12345678",
        type: "replace",
        status: "awaiting_payment",
        rentBefore: 700000,
        rentAfter: 750000,
        depositBefore: 500000,
        depositAfter: 500000,
        discountBefore: 0,
        discountAfter: 0,
        chargeAmount: 50000,
        requiresHold: true,
        holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        countdownSeconds: 300,
        checkoutUrl: "https://pay.example/old",
        selection: {},
        beforeSnapshot: {},
        afterSnapshot: { chargeAmount: 50000, creditAmount: 0, adjustmentLines: [] },
      },
    } as never);

    render(<BookingIncidentsPage />);

    const retry = await screen.findByRole("button", { name: "Thanh toán phần chênh" });
    expect(retry).toBeEnabled();
    await user.click(retry);
    // Trang thanh toán tự cấp link PayOS mới khi link cũ đã chết.
    expect(mockPush).toHaveBeenCalledWith(
      "/booking/change-payment?requestId=req-1&bookingId=book-12345678",
    );
  });

  it("resumes the pending quote when the booking already has a pending request", async () => {
    mockedIncidents.mockResolvedValue(
      incidentData({ pendingRequest: { id: "req-1", countdownSeconds: 300, requiresHold: true } }) as never,
    );
    mockedGetRequest.mockResolvedValue({
      success: true,
      data: {
        id: "req-1",
        bookingId: "book-12345678",
        type: "replace",
        status: "quoted",
        rentBefore: 700000,
        rentAfter: 750000,
        depositBefore: 500000,
        depositAfter: 500000,
        discountBefore: 0,
        discountAfter: 0,
        chargeAmount: 50000,
        requiresHold: true,
        holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        countdownSeconds: 300,
        checkoutUrl: null,
        selection: {},
        beforeSnapshot: {},
        afterSnapshot: { chargeAmount: 50000, creditAmount: 0, adjustmentLines: [] },
      },
    } as never);

    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Thu thêm hôm nay")).toBeInTheDocument();
    expect(screen.getByText(/Giữ chỗ còn 05:00/)).toBeInTheDocument();
  });

  it("bỏ món do quản lý đề xuất: khách xác nhận được ngay, không cần email thông báo trước", async () => {
    mockedIncidents.mockResolvedValue(
      incidentData({
        pendingRequest: { id: "req-1", countdownSeconds: 0, requiresHold: false },
        // Còn trang phục khác → bỏ món bình thường, không phải huỷ đơn.
        items: [
          existingGarmentItem,
          {
            id: "item-2",
            garmentId: "g-9",
            garmentAssetId: "asset-9",
            sizeId: "size-9",
            sizeLabel: "L",
            name: "Áo Tứ Thân",
            imageUrl: null,
          },
        ],
      }) as never,
    );
    mockedGetRequest.mockResolvedValue({
      success: true,
      data: {
        id: "req-1",
        bookingId: "book-12345678",
        type: "remove",
        source: "manager",
        status: "quoted",
        rentBefore: 700000,
        rentAfter: 580000,
        depositBefore: 500000,
        depositAfter: 500000,
        discountBefore: 0,
        discountAfter: 0,
        chargeAmount: 0,
        requiresHold: false,
        holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        countdownSeconds: 0,
        checkoutUrl: null,
        selection: {},
        beforeSnapshot: {},
        afterSnapshot: { chargeAmount: 0, creditAmount: 0, adjustmentLines: [] },
      },
    } as never);

    render(<BookingIncidentsPage />);

    // Email được gửi lúc xác nhận → không còn cổng "chờ email rồi mới xác nhận".
    expect(await screen.findByRole("button", { name: "Xác nhận bỏ món" })).toBeInTheDocument();
    expect(screen.queryByText(/Cửa hàng sẽ gửi email thông báo bỏ món trước/)).not.toBeInTheDocument();
  });

  it("đổi mẫu: chọn trang phục trước rồi checklist toàn bộ phụ kiện của đơn", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);

    render(<BookingIncidentsPage />);

    // Bước 2 chỉ hiện sau khi đã chọn mẫu trang phục mới.
    await screen.findByText("Bước 1 · Chọn mẫu trang phục mới");
    expect(screen.queryByText("Bước 2 · Phụ kiện trong đơn")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Áo Cổ Phục/ }));

    expect(await screen.findByText("Bước 2 · Phụ kiện trong đơn")).toBeInTheDocument();
    // Phụ kiện đang có trong đơn → mặc định thuê 1.
    expect(screen.getByRole("spinbutton", { name: /Số lượng Quạt giấy/ })).toHaveValue(1);
    // Phụ kiện đi kèm mẫu mới (miễn phí) → mặc định thuê 1.
    expect(await screen.findByRole("spinbutton", { name: /Số lượng Trâm cài/ })).toHaveValue(1);

    // Khách bỏ mẫu "Quạt giấy" và giữ "Trâm cài" của mẫu mới.
    await user.clear(screen.getByRole("spinbutton", { name: /Số lượng Quạt giấy/ }));
    await user.type(screen.getByRole("spinbutton", { name: /Số lượng Quạt giấy/ }), "0");
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][1]).toMatchObject({
      type: "replace",
      incidents: ["inc-1"],
      replacements: [{ incidentId: "inc-1", sizeId: "size-2" }],
      removeAccessoryItemIds: ["acc-item-keep"],
      addAccessories: [{ itemId: "item-1", accessoryId: "acc-new", quantity: 1 }],
    });
  });

  it("đổi mẫu: phụ kiện bị sự cố chỉ được bỏ mẫu, không đổi sang mẫu khác", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);
    mockedIncidents.mockResolvedValue(
      incidentData({
        incidents: [
          garmentIncident,
          {
            id: "inc-acc",
            itemKind: "accessory",
            bookingItemId: null,
            bookingAccessoryItemId: "acc-item-bad",
            reason: "Phụ kiện rách",
            status: "awaiting_customer",
            dueAt: "2026-11-20",
            snapshot: {
              name: "Quạt giấy",
              sizeLabel: null,
              imageUrl: null,
              dailyPrice: 50000,
              depositAmount: 0,
              lineRental: 50000,
              quantity: 1,
              estimated: false,
            },
          },
        ],
        accessoryItems: [
          keptAccessory,
          {
            ...keptAccessory,
            id: "acc-item-bad",
            accessoryId: "acc-bad",
            accessoryAssetId: "acc-asset-bad",
            name: "Quạt giấy",
            unitPrice: 50000,
            isIncluded: false,
            rentalTotal: 100000,
          },
        ],
        // Sự cố phụ kiện KHÔNG có gợi ý mẫu khác khi đang đổi trang phục.
        suggestions: [garmentSuggestion],
      }) as never,
    );

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio", { name: /Áo Cổ Phục/ }));

    const incidentBadge = await screen.findByText("Bị sự cố · bỏ mẫu");
    expect(incidentBadge).toBeInTheDocument();
    // Phụ kiện bị sự cố không có ô chọn số lượng → không thể thuê lại mẫu đó.
    expect(screen.queryByRole("spinbutton", { name: /Số lượng .*bị sự cố/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][1]).toMatchObject({
      removeAccessoryItemIds: ["acc-item-bad"],
      addAccessories: [{ itemId: "item-1", accessoryId: "acc-new", quantity: 1 }],
    });
  });

  it("sự cố phụ kiện: khách chọn MẪU phụ kiện khác và gửi accessoryReplacements", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(accessoryOnlyData() as never);
    mockedCreate.mockResolvedValue(quote() as never);

    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Quạt giấy · chọn mẫu phụ kiện khác")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Quạt lụa/ }));
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][1]).toMatchObject({
      type: "replace",
      incidents: ["inc-acc"],
      accessoryReplacements: [{ incidentId: "inc-acc", accessoryId: "acc-2" }],
    });
  });

  it("sự cố phụ kiện: chưa chọn mẫu thay thế → chặn gửi báo giá", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(accessoryOnlyData() as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Quạt giấy · chọn mẫu phụ kiện khác");
    expect(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    expect(
      await screen.findByText("Vui lòng chọn mẫu phụ kiện thay thế còn hàng cho từng món."),
    ).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("sự cố phụ kiện hết mẫu khác → hướng khách bỏ món", async () => {
    mockedIncidents.mockResolvedValue({
      success: true,
      data: {
        ...accessoryOnlyData().data,
        suggestions: [],
      },
    } as never);

    render(<BookingIncidentsPage />);

    expect(
      await screen.findByText(
        "Hiện chưa có mẫu phụ kiện khác còn hàng cho khoảng ngày này. Bạn có thể chọn “Bỏ món”.",
      ),
    ).toBeInTheDocument();
  });

  it("hiện lý do sự cố bằng tiếng Việt thay cho mã kỹ thuật", async () => {
    mockedIncidents.mockResolvedValue(
      incidentData({
        incidents: [
          {
            ...garmentIncident,
            reason: "asset_maintenance",
            reasonLabel: "trang phục đang bảo trì",
          },
        ],
      }) as never,
    );

    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Trang phục đang bảo trì")).toBeInTheDocument();
    expect(screen.queryByText("asset_maintenance")).not.toBeInTheDocument();
  });

  it("mọi mẫu phụ kiện khác đã được thuê → chỉ còn Bỏ món và Huỷ đơn", async () => {
    mockedIncidents.mockResolvedValue({
      success: true,
      data: { ...accessoryOnlyData().data, suggestions: [] },
    } as never);

    render(<BookingIncidentsPage />);

    // Không còn lựa chọn thay thế → tab "Đổi mẫu" (và nút giữ chỗ) biến mất.
    expect(await screen.findByText(/Hiện chưa có mẫu phụ kiện khác còn hàng/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đổi mẫu" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bỏ món" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Huỷ đơn" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Giữ chỗ và thanh toán/i })).not.toBeInTheDocument();
  });

  it("hiện số lượng phụ kiện gặp sự cố của dòng", async () => {
    mockedIncidents.mockResolvedValue(accessoryOnlyData() as never);

    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Số lượng gặp sự cố: 2")).toBeInTheDocument();
  });

  it("hiện giá thuê + cọc trên card gợi ý và cho chọn số lượng phụ kiện tối đa của mẫu", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);
    mockedIncidents.mockResolvedValue(
      incidentData({
        accessoryItems: [
          {
            ...keptAccessory,
            id: "acc-item-keep-2",
            accessoryId: "acc-keep",
            accessoryAssetId: "acc-asset-keep-2",
            name: "Kiềng cổ",
            rentalTotal: 10000,
            isIncluded: false,
            unitPrice: 5000,
            quantity: 1,
          },
        ],
        suggestions: [
          {
            incidentId: "inc-1",
            itemKind: "garment",
            garmentId: "g-1",
            options: [
              {
                garmentId: "g-2",
                sizeId: "size-2",
                sizeLabel: "M",
                name: "Áo Cổ Phục",
                imageUrl: null,
                available: 2,
                dailyPrice: 350000,
                rentalTotal: 1050000,
                depositAmount: 500000,
                accessories: [
                  {
                    accessoryId: "acc-keep",
                    name: "Kiềng cổ",
                    imageUrl: null,
                    isIncluded: false,
                    extraPrice: 5000,
                    available: 4,
                    // Mẫu mới cho thuê tối đa 3 chiếc.
                    maxQuantity: 3,
                  },
                ],
              },
            ],
          },
        ],
      }) as never,
    );

    render(<BookingIncidentsPage />);

    // Card gợi ý chỉ hiện giá thuê/ngày (không hiện thừa tổng tiền thuê).
    expect(await screen.findByText(/Thuê 350\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Cọc 500\.000/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Áo Cổ Phục/ }));

    const quantity = await screen.findByRole("spinbutton", { name: /Số lượng Kiềng cổ/ });
    // Dòng đang có 1 chiếc → mặc định 1, trần là 3 (maxQuantity của mẫu mới).
    expect(quantity).toHaveValue(1);
    expect(quantity).toHaveAttribute("max", "3");

    // Nhấn + hai lần → 3 (không vượt trần).
    await user.click(screen.getByRole("button", { name: /Tăng Kiềng cổ/ }));
    await user.click(screen.getByRole("button", { name: /Tăng Kiềng cổ/ }));
    expect(quantity).toHaveValue(3);
    expect(screen.getByRole("button", { name: /Tăng Kiềng cổ/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    // Giữ nguyên 1 dòng cũ + thêm 2 dòng mới cùng mẫu (mỗi dòng 1 asset).
    expect(mockedCreate.mock.calls[0][1]).toMatchObject({
      removeAccessoryItemIds: undefined,
      addAccessories: [
        { itemId: "item-1", accessoryId: "acc-keep", quantity: 1 },
        { itemId: "item-1", accessoryId: "acc-keep", quantity: 1 },
      ],
    });
  });

  it("gộp nhiều dòng trùng mẫu thành một ô số lượng và bỏ bớt dòng khi giảm", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);
    mockedIncidents.mockResolvedValue(
      incidentData({
        accessoryItems: [
          { ...keptAccessory, id: "acc-item-a", accessoryId: "acc-dup", accessoryAssetId: "asset-a", name: "Kiềng cổ" },
          { ...keptAccessory, id: "acc-item-b", accessoryId: "acc-dup", accessoryAssetId: "asset-b", name: "Kiềng cổ" },
        ],
      }) as never,
    );

    render(<BookingIncidentsPage />);

    await user.click(await screen.findByRole("radio", { name: /Áo Cổ Phục/ }));

    // 2 dòng cùng mẫu → 1 ô số lượng duy nhất, giá trị 2.
    const inputs = await screen.findAllByRole("spinbutton", { name: /Số lượng Kiềng cổ/ });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveValue(2);

    await user.click(screen.getByRole("button", { name: /Giảm Kiềng cổ/ }));
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][1]).toMatchObject({
      // Giữ 1 dòng, bỏ dòng còn lại; không thêm mới.
      removeAccessoryItemIds: ["acc-item-b"],
      addAccessories: [{ itemId: "item-1", accessoryId: "acc-new", quantity: 1 }],
    });
  });

  it("phụ kiện: tick/bỏ tick theo ô số lượng (nhập 0 = bỏ tick, tick lại = khôi phục số cũ)", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);
    mockedIncidents.mockResolvedValue(
      incidentData({
        accessoryItems: [
          { ...keptAccessory, id: "acc-item-a", accessoryId: "acc-dup", accessoryAssetId: "asset-a", name: "Kiềng cổ" },
          { ...keptAccessory, id: "acc-item-b", accessoryId: "acc-dup", accessoryAssetId: "asset-b", name: "Kiềng cổ" },
        ],
      }) as never,
    );

    render(<BookingIncidentsPage />);

    await user.click(await screen.findByRole("radio", { name: /Áo Cổ Phục/ }));

    const checkbox = await screen.findByRole("checkbox", { name: /Chọn Kiềng cổ/ });
    const input = screen.getByRole("spinbutton", { name: /Số lượng Kiềng cổ/ });
    // 2 dòng trùng mẫu → mặc định 2, đang được tick.
    expect(input).toHaveValue(2);
    expect(checkbox).toBeChecked();

    // Nhập 0 → tự bỏ tick, không cho âm.
    await user.clear(input);
    await user.type(input, "0");
    expect(input).toHaveValue(0);
    expect(checkbox).not.toBeChecked();

    // Tick lại → khôi phục số dương gần nhất (2).
    await user.click(checkbox);
    expect(input).toHaveValue(2);
    expect(checkbox).toBeChecked();
  });

  it("không còn sự cố (hệ thống đã tự thay asset) → hiện trạng thái sạch", async () => {
    mockedIncidents.mockResolvedValue(
      incidentData({ incidents: [], suggestions: [], pendingRequest: null }) as never,
    );

    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Đơn của bạn đã sẵn sàng")).toBeInTheDocument();
    expect(screen.getByText("Không còn sự cố nào cần xử lý cho đơn này.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Giữ chỗ và thanh toán/i })).not.toBeInTheDocument();
  });

  it("cancels the pending request and reloads when the customer resets", async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(quote() as never);
    mockedCancelRequest.mockResolvedValue({ success: true, data: { id: "req-1", status: "cancelled" } } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /Giữ chỗ và thanh toán/i }));
    await user.click(await screen.findByRole("button", { name: "Hủy yêu cầu này" }));

    await waitFor(() => expect(mockedCancelRequest).toHaveBeenCalledWith("book-12345678", "req-1"));
  });

  it("đơn CHƯA thanh toán: 'Xác nhận đổi mẫu' lưu đơn ngay, không giữ chỗ và về tab sự cố", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(
      incidentData({
        booking: {
          id: "book-12345678",
          status: "confirmed",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          paid: false,
        },
      }) as never,
    );
    mockedCreate.mockResolvedValue(quote() as never);
    mockedConfirm.mockResolvedValue({ success: true, data: { id: "req-1", status: "applied" } } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio"));

    // Đơn chưa thanh toán không cần giữ chỗ/thanh toán chênh → nhãn là "Xác nhận đổi mẫu".
    await user.click(await screen.findByRole("button", { name: "Xác nhận đổi mẫu" }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    // Tạo yêu cầu xong áp dụng luôn trong cùng lượt bấm.
    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith("book-12345678", "req-1"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/customer"));
  });

  it("đơn CHƯA thanh toán: xác nhận lỗi → giữ báo giá để khách bấm lại", async () => {
    const user = userEvent.setup();
    mockedIncidents.mockResolvedValue(
      incidentData({
        booking: {
          id: "book-12345678",
          status: "confirmed",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          paid: false,
        },
      }) as never,
    );
    mockedCreate.mockResolvedValue(quote() as never);
    mockedConfirm.mockResolvedValue({ success: false, message: "Không thể xác nhận đổi mẫu." } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio"));
    await user.click(await screen.findByRole("button", { name: "Xác nhận đổi mẫu" }));

    expect(await screen.findByText("Không thể xác nhận đổi mẫu.")).toBeInTheDocument();
    // Vẫn còn báo giá + nút xác nhận để thử lại, chưa rời trang.
    expect(screen.getByRole("button", { name: "Xác nhận đổi mẫu" })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("khách xem trang sự cố → KHÔNG thấy card liên hệ (chỉ dành cho quản lý)", async () => {
    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    expect(screen.queryByText("Thông tin khách để liên hệ")).not.toBeInTheDocument();
    expect(screen.queryByText("Số điện thoại")).not.toBeInTheDocument();
  });

  it("quản lý xem trang sự cố → thấy card liên hệ khách với phone + email", async () => {
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedIncidents.mockResolvedValue(
      incidentData({
        booking: {
          id: "book-12345678",
          status: "confirmed",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          paid: true,
          customer: {
            fullName: "Nguyễn Thị Lan",
            phone: "0901234567",
            email: "lan@example.com",
          },
        },
      }) as never,
    );

    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Thông tin khách để liên hệ")).toBeInTheDocument();
    expect(screen.getByText("Nguyễn Thị Lan")).toBeInTheDocument();
    expect(screen.getByText("0901234567")).toBeInTheDocument();
    expect(screen.getByText("lan@example.com")).toBeInTheDocument();
  });

  it("quản lý xem khách thiếu phone/email → hiện “Chưa có”, không bịa dữ liệu", async () => {
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedIncidents.mockResolvedValue(
      incidentData({
        booking: {
          id: "book-12345678",
          status: "confirmed",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          paid: true,
          customer: { fullName: null, phone: null, email: null },
        },
      }) as never,
    );

    render(<BookingIncidentsPage />);

    expect(await screen.findByText("Thông tin khách để liên hệ")).toBeInTheDocument();
    expect(screen.getByText("Chưa có họ tên")).toBeInTheDocument();
    // Cả phone và email đều thiếu → hai dòng "Chưa có".
    expect(screen.getAllByText("Chưa có")).toHaveLength(2);
  });

  it("quản lý huỷ đơn: bắt buộc nhập lý do rồi áp dụng qua action=cancel (gửi email), ở lại trang", async () => {
    const user = userEvent.setup();
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedManagerAction.mockResolvedValue({ success: true, data: { incidentId: "inc-1", action: "cancel" } } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("button", { name: "Huỷ đơn" }));
    await user.click(screen.getByRole("button", { name: "Huỷ đơn thuê" }));
    expect(screen.getByText(/Lý do huỷ đơn/)).toBeInTheDocument();

    // Chưa nhập lý do → chặn tại client, không gọi API.
    await user.click(screen.getByRole("button", { name: /Huỷ đơn thuê/ }));
    expect(await screen.findByText("Vui lòng nhập lý do huỷ đơn.")).toBeInTheDocument();
    expect(mockedManagerAction).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: /Lý do huỷ đơn/ }), "Không còn mẫu thay thế");
    await user.click(screen.getByRole("button", { name: "Huỷ đơn thuê" }));
    // Bước xác nhận thứ hai → mới gọi API.
    await user.click(await screen.findByRole("button", { name: "Xác nhận huỷ đơn" }));

    await waitFor(() =>
      expect(mockedManagerAction).toHaveBeenCalledWith(
        "inc-1",
        expect.objectContaining({
          action: "cancel",
          reason: "Không còn mẫu thay thế",
          incidents: ["inc-1"],
        }),
      ),
    );
    // Huỷ đơn qua action=cancel (server gửi email) không điều hướng đi đâu.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("quản lý huỷ đơn đã qua bàn giao → không cho huỷ", async () => {
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedIncidents.mockResolvedValue(
      incidentData({
        booking: {
          id: "book-12345678",
          status: "delivering",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          paid: true,
        },
      }) as never,
    );

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await userEvent.setup().click(screen.getByRole("button", { name: "Huỷ đơn" }));

    expect(await screen.findByText(/Đơn đã qua bàn giao nên không thể huỷ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Huỷ đơn thuê" })).not.toBeInTheDocument();
  });

  it("quản lý gửi đề xuất đổi mẫu: gửi toàn bộ sự cố đang mở + lý do, không điều hướng", async () => {
    const user = userEvent.setup();
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedManagerAction.mockResolvedValue({
      success: true,
      data: { incidentId: "inc-1", bookingId: "book-12345678", action: "proposal" },
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    // Chọn mẫu thay thế trước (dùng chung UI với khách).
    await user.click(screen.getByRole("radio", { name: /Áo Cổ Phục/ }));

    // Lý do xử lý của quản lý (ô riêng, bắt buộc).
    await user.type(screen.getByRole("textbox", { name: /Lý do xử lý/ }), "Mẫu cũ bị lỗi đường may");
    await user.click(screen.getByRole("button", { name: /Gửi đề xuất cho khách/i }));

    await waitFor(() =>
      expect(mockedManagerAction).toHaveBeenCalledWith(
        "inc-1",
        expect.objectContaining({
          action: "proposal",
          type: "replace",
          incidents: ["inc-1"],
          reason: "Mẫu cũ bị lỗi đường may",
          replacements: [{ incidentId: "inc-1", sizeId: "size-2" }],
        }),
      ),
    );
    expect((await screen.findAllByText(/Đã gửi phương án cho khách/)).length).toBeGreaterThan(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("quản lý bỏ món: bắt buộc lý do + xác nhận rồi gửi action=remove", async () => {
    const user = userEvent.setup();
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedManagerAction.mockResolvedValue({
      success: true,
      data: { incidentId: "inc-1", bookingId: "book-12345678", action: "remove" },
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("button", { name: /^Bỏ món$/ }));

    // Chưa nhập lý do → chặn.
    await user.click(await screen.findByRole("button", { name: /^Bỏ món và huỷ đơn$/ }));
    expect(await screen.findByText("Vui lòng nhập lý do bỏ món.")).toBeInTheDocument();
    expect(mockedManagerAction).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: /Lý do xử lý/ }), "Không thể khắc phục");
    await user.click(screen.getByRole("button", { name: /^Bỏ món và huỷ đơn$/ }));
    await user.click(await screen.findByRole("button", { name: "Xác nhận bỏ món" }));

    await waitFor(() =>
      expect(mockedManagerAction).toHaveBeenCalledWith(
        "inc-1",
        expect.objectContaining({
          action: "remove",
          reason: "Không thể khắc phục",
          incidents: ["inc-1"],
        }),
      ),
    );
  });

  it("quản lý xem trước email → gọi preview và hiện iframe nội dung", async () => {
    const user = userEvent.setup();
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedManagerPreview.mockResolvedValue({
      success: true,
      data: {
        action: "preview",
        incidentId: "inc-1",
        bookingId: "book-12345678",
        emailSubject: "Đề xuất đổi mẫu cho đơn #BOOK1234",
        emailHtml: "<p>Lý do đề xuất: mẫu lỗi</p>",
        emailRecipient: "lan@example.com",
        quote: {},
      },
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("radio", { name: /Áo Cổ Phục/ }));
    await user.type(screen.getByRole("textbox", { name: /Lý do xử lý/ }), "Mẫu lỗi");
    await user.click(screen.getByRole("button", { name: /Xem trước email/i }));

    await waitFor(() =>
      expect(mockedManagerPreview).toHaveBeenCalledWith(
        "inc-1",
        expect.objectContaining({ action: "proposal", incidents: ["inc-1"], reason: "Mẫu lỗi" }),
      ),
    );
    expect(await screen.findByText(/Người nhận: lan@example.com/)).toBeInTheDocument();
    expect(screen.getByTitle("Xem trước email đề xuất")).toBeInTheDocument();
    // Xem trước không tạo yêu cầu thật.
    expect(mockedManagerAction).not.toHaveBeenCalled();
  });

  it("quản lý xem trước email bỏ món → previewAction=remove, không tạo yêu cầu", async () => {
    const user = userEvent.setup();
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedManagerPreview.mockResolvedValue({
      success: true,
      data: {
        action: "preview",
        previewAction: "remove",
        incidentId: "inc-1",
        bookingId: "book-12345678",
        emailSubject: "Đơn thuê đã bị hủy #BOOK1234",
        emailHtml: "<p>Đơn thuê đã bị hủy</p>",
        emailRecipient: "lan@example.com",
        cancelled: true,
        quote: null,
      },
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("button", { name: /^Bỏ món$/ }));
    await user.type(await screen.findByRole("textbox", { name: /Lý do xử lý/ }), "Không thể khắc phục");
    await user.click(screen.getByRole("button", { name: /Xem trước email/i }));

    await waitFor(() =>
      expect(mockedManagerPreview).toHaveBeenCalledWith(
        "inc-1",
        expect.objectContaining({
          action: "preview",
          previewAction: "remove",
          incidents: ["inc-1"],
          reason: "Không thể khắc phục",
        }),
      ),
    );
    expect(await screen.findByTitle("Xem trước email bỏ món")).toBeInTheDocument();
    expect(mockedManagerAction).not.toHaveBeenCalled();
  });

  it("quản lý xem trước email huỷ đơn → previewAction=cancel, không huỷ đơn thật", async () => {
    const user = userEvent.setup();
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedManagerPreview.mockResolvedValue({
      success: true,
      data: {
        action: "preview",
        previewAction: "cancel",
        incidentId: "inc-1",
        bookingId: "book-12345678",
        emailSubject: "Đơn thuê đã bị hủy #BOOK1234",
        emailHtml: "<p>Đơn thuê đã bị hủy</p>",
        emailRecipient: "lan@example.com",
        quote: null,
      },
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Áo Nhật Bình");
    await user.click(screen.getByRole("button", { name: "Huỷ đơn" }));
    await user.type(screen.getByRole("textbox", { name: /Lý do huỷ đơn/ }), "Không còn mẫu thay thế");
    await user.click(screen.getByRole("button", { name: /Xem trước email/i }));

    await waitFor(() =>
      expect(mockedManagerPreview).toHaveBeenCalledWith(
        "inc-1",
        expect.objectContaining({
          action: "preview",
          previewAction: "cancel",
          incidents: ["inc-1"],
          reason: "Không còn mẫu thay thế",
        }),
      ),
    );
    expect(await screen.findByTitle("Xem trước email huỷ đơn")).toBeInTheDocument();
    expect(mockedManagerAction).not.toHaveBeenCalled();
  });

  it("quản lý KHÔNG thấy nút xác nhận thay đổi (chỉ khách của đơn được xác nhận)", async () => {
    authState.user = { id: "mgr-1", role: "manager_owner" };
    mockedIncidents.mockResolvedValue(
      incidentData({ pendingRequest: { id: "req-1", countdownSeconds: 300, requiresHold: true } }) as never,
    );
    mockedGetRequest.mockResolvedValue({
      success: true,
      data: {
        id: "req-1",
        bookingId: "book-12345678",
        type: "replace",
        status: "quoted",
        rentBefore: 700000,
        rentAfter: 750000,
        depositBefore: 500000,
        depositAfter: 500000,
        discountBefore: 0,
        discountAfter: 0,
        chargeAmount: 50000,
        requiresHold: true,
        holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        countdownSeconds: 300,
        checkoutUrl: null,
        selection: {},
        beforeSnapshot: {},
        afterSnapshot: { chargeAmount: 50000, creditAmount: 0, adjustmentLines: [] },
      },
    } as never);

    render(<BookingIncidentsPage />);

    await screen.findByText("Thu thêm hôm nay");
    // Bảng báo giá vẫn hiển thị cho quản lý xem, nhưng KHÔNG có nút xác nhận.
    expect(screen.queryByRole("button", { name: "Xác nhận đổi mẫu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xác nhận thay đổi" })).not.toBeInTheDocument();
    // Không còn khối ghi chú dài về quyền xác nhận của khách.
    expect(screen.queryByText(/Chỉ khách của đơn mới bấm xác nhận thay đổi/)).not.toBeInTheDocument();
  });
});
