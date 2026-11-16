import { afterEach, describe, expect, it } from "vitest";
import {
  appBaseUrl,
  buildCancellationEmail,
  buildProposalEmail,
  buildRemovalEmail,
  incidentActionUrl,
} from "./incident-email.builder";

const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

afterEach(() => {
  if (ORIGINAL_FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
});

function proposal(overrides: Record<string, unknown> = {}) {
  return buildProposalEmail({
    bookingId: "book-1",
    bookingCode: "BOOK1234",
    customerName: "Nguyễn Văn A",
    rentalStartDate: "2026-11-11",
    rentalEndDate: "2026-11-12",
    affectedItems: [],
    proposedItems: [],
    rentBefore: 400_000,
    rentAfter: 400_000,
    chargeNow: 0,
    reason: "Mẫu bị lỗi đường may",
    holdExpiresAt: new Date("2026-11-10T10:30:00.000Z"),
    actionUrl: incidentActionUrl("book-1"),
    ...overrides,
  });
}

describe("incident-email.builder — URL máy chủ deploy", () => {
  it("appBaseUrl lấy FRONTEND_URL của máy chủ deploy, bỏ dấu / cuối", () => {
    process.env.FRONTEND_URL = "https://cophuctruyenthong.tech/";
    expect(appBaseUrl()).toBe("https://cophuctruyenthong.tech");
    expect(incidentActionUrl("book-1")).toBe(
      "https://cophuctruyenthong.tech/booking/incidents/book-1",
    );
  });

  it("link trong email dùng URL tuyệt đối theo máy chủ, KHÔNG phải localhost", () => {
    process.env.FRONTEND_URL = "https://cophuctruyenthong.tech";
    const html = proposal();
    expect(html).toContain(
      'href="https://cophuctruyenthong.tech/booking/incidents/book-1"',
    );
    expect(html).not.toContain("localhost:3000");
  });

  it("mã hoá bookingId khi dựng link hành động", () => {
    process.env.FRONTEND_URL = "https://shop.example";
    expect(incidentActionUrl("a b/c")).toBe("https://shop.example/booking/incidents/a%20b%2Fc");
  });
});

describe("incident-email.builder — ảnh trong 'Các món trong đơn'", () => {
  it("nhúng <img> cho ảnh http(s) công khai", () => {
    const html = proposal({
      affectedItems: [{ name: "Áo Nhật Bình", sizeLabel: "M", imageUrl: "https://cdn.example/a.jpg" }],
    });
    expect(html).toContain('src="https://cdn.example/a.jpg"');
    expect(html).toContain("Áo Nhật Bình");
  });

  it("ảnh localhost/private → bỏ <img>, dùng ô placeholder (không vỡ ảnh)", () => {
    process.env.FRONTEND_URL = "https://shop.example";
    const html = proposal({
      affectedItems: [
        { name: "Áo cũ", imageUrl: "http://localhost:3000/a.jpg" },
        { name: "Áo nội bộ", imageUrl: "http://192.168.1.10/b.jpg" },
        { name: "Áo 172", imageUrl: "http://172.16.0.5/c.jpg" },
      ],
    });
    expect(html).not.toContain("localhost:3000");
    expect(html).not.toContain("192.168.1.10");
    expect(html).not.toContain("172.16.0.5");
    expect(html).not.toContain("<img");
    // Vẫn liệt kê tên món dù ảnh bị bỏ.
    expect(html).toContain("Áo cũ");
    expect(html).toContain("Áo nội bộ");
  });

  it("scheme nguy hiểm (javascript:) không lọt vào src", () => {
    const html = proposal({
      affectedItems: [{ name: "Áo", imageUrl: "javascript:alert(1)" }],
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });

  it("email bỏ món cũng dùng placeholder cho ảnh nội bộ nhưng vẫn hiện tên", () => {
    process.env.FRONTEND_URL = "https://shop.example";
    const html = buildRemovalEmail({
      bookingId: "book-1",
      bookingCode: "BOOK1234",
      customerName: "Nguyễn Văn A",
      rentalStartDate: "2026-11-11",
      rentalEndDate: "2026-11-12",
      removedItems: [{ name: "Quạt giấy", sizeLabel: null, imageUrl: "http://localhost:4000/q.jpg" }],
      beforeRentalTotal: 400_000,
      afterRentalTotal: 300_000,
      cancelled: false,
      reason: "Mất phụ kiện",
      actionUrl: incidentActionUrl("book-1"),
    });
    expect(html).not.toContain("localhost:4000");
    expect(html).not.toContain("<img");
    expect(html).toContain("Quạt giấy");
  });
});

describe("incident-email.builder — khung thương hiệu giống email hệ thống", () => {
  it("đầu email có logo ☆, tên Cổ Phục ERP và mô tả hệ thống", () => {
    const html = proposal();
    expect(html).toContain("&#9734;");
    expect(html).toContain("Cổ Phục ERP");
    expect(html).toContain("Hệ thống quản lý cho thuê trang phục cổ phục");
  });

  it("cuối email có email/hotline/địa chỉ và dòng bản quyền", () => {
    const html = proposal();
    expect(html).toContain("cophuctruyenthong@gmail.com");
    expect(html).toContain("Hotline: 1900 xxxx");
    expect(html).toContain("Đà Nẵng, Việt Nam");
    expect(html).toContain("© 2026 Cổ Phục ERP".replace("©", "&copy;"));
    expect(html).toContain("Bạn nhận email này vì đã đăng ký tài khoản trên hệ thống.");
    expect(html).toContain("Đây là email tự động, vui lòng không trả lời trực tiếp.");
  });

  it("KHÔNG còn câu 'Nút xác nhận chỉ hoạt động với tài khoản khách'", () => {
    const html = proposal();
    expect(html).not.toContain("Nút xác nhận chỉ hoạt động với tài khoản khách");
  });
});

describe("incident-email.builder — danh sách sản phẩm", () => {
  it("mỗi món hiện tên + số lượng + giá, không chỉ món đầu", () => {
    const html = proposal({
      proposedItems: [
        { name: "Áo Nhật Bình", quantity: 1, price: 700_000 },
        { name: "Áo Tứ Thân", quantity: 1, price: 500_000 },
      ],
    });
    expect(html).toContain("Áo Nhật Bình");
    expect(html).toContain("Áo Tứ Thân");
    expect(html).toContain("700.000đ");
    expect(html).toContain("500.000đ");
    // Số lượng hiện cho từng món.
    expect(html).toContain("SL 1");
  });

  it("món bị ảnh hưởng hiện loại sự cố", () => {
    const html = proposal({
      affectedItems: [
        { name: "Áo Nhật Bình", quantity: 1, price: 700_000, note: "Hư hỏng" },
      ],
    });
    expect(html).toContain("Sự cố: Hư hỏng");
  });

  it("giá 0 hiện 'Miễn phí' chứ không phải 0đ", () => {
    const html = proposal({
      proposedItems: [{ name: "Quạt giấy", quantity: 1, price: 0 }],
    });
    expect(html).toContain("Quạt giấy");
    expect(html).toContain("Miễn phí");
  });

  it("nội dung nằm trong vùng có padding ngang (không dính sát lề)", () => {
    const html = proposal();
    // Khung chuẩn: cột nội dung trắng có padding 40px hai bên.
    expect(html).toContain("padding:32px 40px 24px");
    // Bảng tóm tắt không còn hack padding trên <table> (không áp dụng được ở email).
    expect(html).not.toContain("border-collapse:collapse;padding:0 24px");
  });
});

describe("incident-email.builder — email huỷ đơn / bỏ món theo 4 mục", () => {
  function foundCancelledEmail(overrides: Record<string, unknown> = {}) {
    return buildCancellationEmail({
      bookingId: "book-1",
      bookingCode: "BOOK1234",
      customerName: "Nguyễn Văn A",
      rentalStartDate: "2026-11-11",
      rentalEndDate: "2026-11-12",
      items: [
        { name: "Áo Nhật Bình", sizeLabel: "M", imageUrl: null, quantity: 1, price: 700_000, note: "Bị hư hỏng" },
      ],
      reason: "Không còn mẫu thay thế",
      refundAmount: 1_200_000,
      beforeRentalTotal: 700_000,
      afterRentalTotal: 0,
      beforeDepositTotal: 500_000,
      afterDepositTotal: 0,
      actionUrl: incidentActionUrl("book-1"),
      ...overrides,
    });
  }

  it("tiêu đề + mã đơn + badge Đã hủy + lời chào", () => {
    const html = foundCancelledEmail();
    expect(html).toContain("Đơn thuê đã bị hủy");
    expect(html).toContain("#BOOK1234");
    expect(html).toContain("Đã hủy");
    expect(html).toContain("Chào Nguyễn Văn A,");
    // Câu mở đầu nêu lý do theo đúng loại sự cố của món.
    expect(html).toContain("do trang phục gặp sự cố bị hư hỏng");
  });

  it("đủ 4 mục đánh số: thông tin đơn, trang phục gặp sự cố, thay đổi giá trị, hoàn tiền", () => {
    const html = foundCancelledEmail();
    expect(html).toContain("1. Thông tin đơn thuê");
    expect(html).toContain("2. Trang phục gặp sự cố");
    expect(html).toContain("3. Thay đổi giá trị đơn hàng");
    expect(html).toContain("4. Thông tin hoàn tiền");
    // Bảng thông tin đơn + trạng thái.
    expect(html).toContain("Ngày thuê");
    expect(html).toContain("Trạng thái");
    // Món: số lượng + lý do + giá.
    expect(html).toContain("Số lượng: <strong");
    expect(html).toContain("Lý do: <strong");
    expect(html).toContain("700.000đ");
    // Bảng thay đổi giá trị + số tiền hoàn.
    expect(html).toContain("Tiền thuê");
    expect(html).toContain("Tiền cọc");
    expect(html).toContain("Số tiền hoàn dự kiến");
    expect(html).toContain("1.200.000đ");
  });

  it("không có ghi chú sự cố → mục 2 là 'Trang phục trong đơn'", () => {
    const html = foundCancelledEmail({
      items: [{ name: "Áo Nhật Bình", sizeLabel: "M", imageUrl: null, quantity: 1, price: 700_000 }],
    });
    expect(html).toContain("2. Trang phục trong đơn");
    expect(html).not.toContain("2. Trang phục gặp sự cố");
  });

  it("hiện lý do cửa hàng dưới dạng ghi chú (trừ khi có lời nhắn riêng)", () => {
    expect(foundCancelledEmail()).toContain("Ghi chú từ cửa hàng:");
    expect(foundCancelledEmail()).toContain("Không còn mẫu thay thế");
    const custom = foundCancelledEmail({ emailMessage: "Cửa hàng đã liên hệ và xin lỗi bạn." });
    expect(custom).not.toContain("Ghi chú từ cửa hàng:");
    expect(custom).toContain("Cửa hàng đã liên hệ và xin lỗi bạn.");
  });

  it("bỏ hết món → email bỏ món dùng chung bố cục huỷ đơn", () => {
    const html = buildRemovalEmail({
      bookingId: "book-1",
      bookingCode: "BOOK1234",
      customerName: "Nguyễn Văn A",
      rentalStartDate: "2026-11-11",
      rentalEndDate: "2026-11-12",
      removedItems: [{ name: "Áo Nhật Bình", quantity: 1, price: 700_000, note: "Đang bảo trì" }],
      beforeRentalTotal: 700_000,
      afterRentalTotal: 0,
      beforeDepositTotal: 500_000,
      afterDepositTotal: 0,
      cancelled: true,
      reason: "Không còn mẫu thay thế",
      refundAmount: 1_200_000,
      actionUrl: incidentActionUrl("book-1"),
    });
    expect(html).toContain("Đơn thuê đã bị hủy");
    expect(html).toContain("1. Thông tin đơn thuê");
    expect(html).toContain("4. Thông tin hoàn tiền");
    expect(html).toContain("1.200.000đ");
  });

  it("bỏ một phần món → email 'Đơn thuê đã được cập nhật' + bảng trước/sau", () => {
    const html = buildRemovalEmail({
      bookingId: "book-1",
      bookingCode: "BOOK1234",
      customerName: "Nguyễn Văn A",
      rentalStartDate: "2026-11-11",
      rentalEndDate: "2026-11-12",
      removedItems: [{ name: "Quạt giấy", quantity: 2, price: 100_000, note: "Bị hư hỏng" }],
      beforeRentalTotal: 700_000,
      afterRentalTotal: 600_000,
      beforeDepositTotal: 500_000,
      afterDepositTotal: 500_000,
      cancelled: false,
      creditAmount: 100_000,
      reason: "Phụ kiện bị hư",
      actionUrl: incidentActionUrl("book-1"),
    });
    expect(html).toContain("Đơn thuê đã được cập nhật");
    expect(html).toContain("Đã cập nhật");
    expect(html).toContain("2. Trang phục gặp sự cố");
    expect(html).toContain("3. Thay đổi giá trị đơn hàng");
    expect(html).toContain("600.000đ");
    expect(html).toContain("100.000đ");
  });
});
