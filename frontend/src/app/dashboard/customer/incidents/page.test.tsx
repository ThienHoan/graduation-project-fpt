/**
 * @blast-radius: ui
 * Tab "Sự cố" trong tài khoản khách: badge số đơn, danh sách sự cố, link xử lý.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getMyIncidents: vi.fn(),
}));

import { getMyIncidents } from "@/lib/api";
import CustomerIncidentsPage from "./page";

const mockedIncidents = vi.mocked(getMyIncidents);

function makeResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      count: 1,
      incidentCount: 2,
      bookings: [
        {
          bookingId: "book-12345678",
          bookingCode: "BOOK1234",
          bookingStatus: "confirmed",
          rentalStartDate: "2026-11-20",
          rentalEndDate: "2026-11-22",
          incidents: [
            {
              id: "inc-1",
              itemKind: "garment",
              reason: "asset_damaged",
              reasonLabel: "trang phục bị hư hỏng",
              status: "awaiting_customer",
              dueAt: "2026-11-20",
              name: "Áo Nhật Bình",
              sizeLabel: "M",
              imageUrl: null,
            },
            {
              id: "inc-2",
              itemKind: "accessory",
              reason: "accessory_unavailable",
              reasonLabel: "không còn phụ kiện thay thế",
              status: "open",
              dueAt: "2026-11-20",
              name: "Quạt giấy",
              sizeLabel: null,
              imageUrl: null,
            },
          ],
          pendingRequest: { id: "req-1", countdownSeconds: 125, requiresHold: true },
        },
      ],
      ...overrides,
    },
  };
}

describe("CustomerIncidentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIncidents.mockResolvedValue(makeResponse() as never);
  });

  it("hiển thị số đơn có sự cố, lý do tiếng Việt và link xử lý của từng đơn", async () => {
    render(<CustomerIncidentsPage />);

    expect(await screen.findByText("Sự cố cần xử lý")).toBeInTheDocument();
    expect(screen.getByText("1 đơn đang có sự cố (2 món)")).toBeInTheDocument();
    expect(screen.getByText("Đơn #BOOK1234")).toBeInTheDocument();
    expect(screen.getByText("Áo Nhật Bình · size M")).toBeInTheDocument();
    expect(screen.getByText("Lý do: trang phục bị hư hỏng")).toBeInTheDocument();
    expect(screen.getByText("Lý do: không còn phụ kiện thay thế")).toBeInTheDocument();
    expect(screen.getByText("Chờ khách xác nhận")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Xử lý sự cố/ });
    expect(link).toHaveAttribute("href", "/booking/incidents/book-12345678");
  });

  it("hiện yêu cầu đang chờ xác nhận kèm thời gian giữ chỗ", async () => {
    render(<CustomerIncidentsPage />);

    expect(
      await screen.findByText(/Bạn đang có yêu cầu đổi chờ xác nhận — giữ chỗ còn 2 phút 5 giây\./),
    ).toBeInTheDocument();
  });

  it("không có sự cố → trạng thái trống, không gắn badge", async () => {
    mockedIncidents.mockResolvedValue({
      success: true,
      data: { count: 0, incidentCount: 0, bookings: [] },
    } as never);

    render(<CustomerIncidentsPage />);

    expect(await screen.findByText("Mọi thứ đã sẵn sàng")).toBeInTheDocument();
    expect(screen.getByText("Không có sự cố nào")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Xử lý sự cố/ })).not.toBeInTheDocument();
  });

  it("lỗi tải dữ liệu → hiện thông báo từ server", async () => {
    mockedIncidents.mockResolvedValue({ success: false, message: "Không tải được sự cố." } as never);

    render(<CustomerIncidentsPage />);

    expect(await screen.findByText("Không tải được sự cố.")).toBeInTheDocument();
  });
});
