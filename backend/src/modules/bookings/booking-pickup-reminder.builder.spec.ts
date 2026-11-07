import { describe, expect, it } from "vitest";
import {
  BookingPickupReminderBuilder,
  DEFAULT_CARE_INSTRUCTIONS,
  DEFAULT_STORE_ADDRESS,
  DEFAULT_STORE_PHONE,
  DEFAULT_BUSINESS_HOURS,
} from "./booking-pickup-reminder.builder";

describe("BookingPickupReminderBuilder", () => {
  const builder = new BookingPickupReminderBuilder();

  // 1. Nhận đồ tại cửa hàng
  it("builds note for store pickup with custom store config and unpaid note", () => {
    const note = builder.buildNote(
      {
        bookingId: "00000000-1111-2222-3333-444444444444",
        pickupMethod: "store_pickup",
        rentalStartDate: "2026-10-10",
        isUnpaid: true,
        garmentName: "Áo ngũ thân tay chẽn",
      },
      {
        storeAddress: "123 Đường Trần Phú, Quận Hải Châu, Đà Nẵng",
        storePhone: "0905 123 456",
        businessHours: "08:30 - 21:00",
      },
    );

    expect(note).toContain("Vui lòng đến cửa hàng để nhận trang phục.");
    expect(note).toContain("Địa chỉ nhận: 123 Đường Trần Phú, Quận Hải Châu, Đà Nẵng.");
    expect(note).toContain("Giờ mở cửa: 08:30 - 21:00 | Hotline hỗ trợ: 0905 123 456.");
    expect(note).toContain("cung cấp mã đơn #00000000 cho nhân viên tại quầy.");
    expect(note).toContain("Đơn chưa thanh toán — vui lòng thanh toán khi nhận đồ.");
    expect(note).toContain("Hướng dẫn bảo quản cổ phục:");
    expect(note).toContain("Không tự ý giặt máy");
  });

  // 2. Giao tận nơi
  it("builds note for delivery with delivery instruction and hotline", () => {
    const note = builder.buildNote(
      {
        bookingId: "abcdef12-3456-7890-abcd-ef1234567890",
        pickupMethod: "delivery",
        rentalStartDate: "2026-10-10",
        isUnpaid: false,
        garmentName: "Áo Tấc lụa tơ tằm",
      },
      {
        storePhone: "0905 999 888",
      },
    );

    expect(note).toContain("Trang phục sẽ được giao đến địa chỉ của bạn, vui lòng để ý điện thoại.");
    expect(note).toContain("Hotline hỗ trợ giao nhận: 0905 999 888.");
    expect(note).not.toContain("Địa chỉ nhận:");
    expect(note).not.toContain("nhân viên tại quầy");
    expect(note).not.toContain("Đơn chưa thanh toán");
    expect(note).toContain("Hướng dẫn bảo quản cổ phục:");
  });

  // 3. Thiếu địa chỉ cửa hàng -> Fallback an toàn
  it("falls back safely to DEFAULT_STORE_ADDRESS when storeAddress is missing or empty", () => {
    const noteMissing = builder.buildNote({
      bookingId: "test-booking-id-12345",
      rentalStartDate: "2026-10-10",
      pickupMethod: "store_pickup",
    });

    expect(noteMissing).toContain(`Địa chỉ nhận: ${DEFAULT_STORE_ADDRESS}.`);

    const noteEmpty = builder.buildNote(
      {
        bookingId: "test-booking-id-12345",
        rentalStartDate: "2026-10-10",
        pickupMethod: "store_pickup",
      },
      { storeAddress: "   " },
    );

    expect(noteEmpty).toContain(`Địa chỉ nhận: ${DEFAULT_STORE_ADDRESS}.`);
  });

  // 4. Thiếu số điện thoại -> Fallback an toàn
  it("falls back safely to DEFAULT_STORE_PHONE when storePhone is missing or empty", () => {
    const noteMissing = builder.buildNote({
      bookingId: "test-booking-id-12345",
      rentalStartDate: "2026-10-10",
      pickupMethod: "delivery",
    });

    expect(noteMissing).toContain(`Hotline hỗ trợ giao nhận: ${DEFAULT_STORE_PHONE}.`);

    const noteEmpty = builder.buildNote(
      {
        bookingId: "test-booking-id-12345",
        rentalStartDate: "2026-10-10",
        pickupMethod: "delivery",
      },
      { storePhone: "" },
    );

    expect(noteEmpty).toContain(`Hotline hỗ trợ giao nhận: ${DEFAULT_STORE_PHONE}.`);
  });

  // 5. Thiếu thông tin không bắt buộc
  it("handles missing optional info without rendering null or undefined", () => {
    const note = builder.buildNote({
      bookingId: "short",
      rentalStartDate: "2026-10-10",
      pickupMethod: undefined,
      isUnpaid: undefined,
      garmentName: undefined,
    });

    expect(note).not.toContain("null");
    expect(note).not.toContain("undefined");
    expect(note).toContain("Vui lòng đến cửa hàng để nhận trang phục.");
    expect(note).toContain(DEFAULT_STORE_ADDRESS);
    expect(note).toContain(DEFAULT_STORE_PHONE);
    expect(note).toContain(DEFAULT_BUSINESS_HOURS);
    expect(note).not.toContain("Đơn chưa thanh toán");
  });

  // 6. Dữ liệu động có ký tự đặc biệt
  it("sanitizes dynamic data with control characters, special symbols, and HTML-like tags", () => {
    const note = builder.buildNote(
      {
        bookingId: "special-id-12345",
        bookingCode: "CP-HN\u0000<VIP>&\"'",
        pickupMethod: "store_pickup",
        rentalStartDate: "2026-10-10",
      },
      {
        storeAddress: "Atelier Hoàng Thành \u0007- Tầng 2 <Showroom>",
        storePhone: "0905\u0008 123 456",
      },
    );

    expect(note).not.toContain("\u0000");
    expect(note).not.toContain("\u0007");
    expect(note).not.toContain("\u0008");
    expect(note).toContain("CP-HN<VIP>&\"'");
    expect(note).toContain("Atelier Hoàng Thành - Tầng 2 <Showroom>");
  });

  // 7. Nội dung hướng dẫn bảo quản
  it("contains all 5 confirmed care guidelines", () => {
    const instructions = builder.getCareInstructions();
    expect(instructions).toHaveLength(5);
    expect(instructions).toEqual(DEFAULT_CARE_INSTRUCTIONS);

    const note = builder.buildNote({
      bookingId: "test-booking-id",
      rentalStartDate: "2026-10-10",
    });

    expect(note).toContain("Treo trang phục nơi khô thoáng");
    expect(note).toContain("Không tự ý giặt máy, không ủi nhiệt độ cao");
    expect(note).toContain("nước hoa nồng độ cao, rượu bia, dầu mỡ");
    expect(note).toContain("Không tự ý cắt sửa form dáng");
    expect(note).toContain("báo ngay trong 30 phút nếu phát hiện lỗi từ trước");
  });

  // 8. Tương thích luồng thông báo cũ
  it("produces a note compatible with the existing pickup notification template prefix", () => {
    const data = {
      bookingId: "00000000-0000-4000-8000-0000000000d1",
      pickupMethod: "store_pickup",
      rentalStartDate: "2026-10-09",
    };
    const note = builder.buildNote(data);

    // Bắt đầu bằng câu truyền thống để người dùng và template hiện có không bị bỡ ngỡ
    expect(note.startsWith("Vui lòng đến cửa hàng để nhận trang phục.")).toBe(true);

    const summary = builder.buildSummary(data);
    expect(summary).toContain("Nhận tại cửa hàng:");
    expect(summary).toContain(DEFAULT_STORE_ADDRESS);
    expect(summary).toContain(DEFAULT_STORE_PHONE);
  });
});
