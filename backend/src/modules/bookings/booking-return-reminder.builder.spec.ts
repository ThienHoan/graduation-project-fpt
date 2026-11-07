import { describe, expect, it } from "vitest";
import {
  BookingReturnReminderBuilder,
  DEFAULT_RETURN_STORE_ADDRESS,
  DEFAULT_RETURN_STORE_PHONE,
  DEFAULT_RETURN_BUSINESS_HOURS,
  DEFAULT_OVERDUE_FEE_PER_DAY,
  DEFAULT_CUSTOMER_DASHBOARD_PATH,
} from "./booking-return-reminder.builder";
import { BookingPickupReminderBuilder } from "./booking-pickup-reminder.builder";

describe("BookingReturnReminderBuilder", () => {
  const builder = new BookingReturnReminderBuilder();
  const BOOKING_ID = "00000000-0000-4000-8000-0000000000a1";
  const RENTAL_END_DATE = "2026-11-08";

  // 10. Thiếu địa chỉ showroom -> fallback an toàn
  it("Scenario 10: falls back safely to default showroom address when config is missing or empty", () => {
    const note = builder.buildNote(
      {
        bookingId: BOOKING_ID,
        rentalEndDate: RENTAL_END_DATE,
        pickupMethod: "store_pickup",
      },
      { storeAddress: "" }, // Empty
    );

    expect(note).toContain(`Showroom ${DEFAULT_RETURN_STORE_ADDRESS}`);
  });

  // 11. Thiếu hotline -> fallback an toàn
  it("Scenario 11: falls back safely to default phone when config hotline is missing", () => {
    const note = builder.buildNote(
      {
        bookingId: BOOKING_ID,
        rentalEndDate: RENTAL_END_DATE,
        pickupMethod: "store_pickup",
      },
      { storePhone: null },
    );

    expect(note).toContain(`Hotline hỗ trợ: ${DEFAULT_RETURN_STORE_PHONE}`);
  });

  // 12. Ký tự đặc biệt trong dữ liệu khách -> sanitized đúng cách
  it("Scenario 12: sanitizes control characters and unusual inputs in booking code and garment name", () => {
    const note = builder.buildNote({
      bookingId: BOOKING_ID,
      bookingCode: "BK\u0000123\u000845",
      garmentName: "Áo Tấc <script>alert(1)</script>\u001F",
      rentalEndDate: RENTAL_END_DATE,
    });

    expect(note).not.toContain("\u0000");
    expect(note).not.toContain("\u0008");
    expect(note).not.toContain("\u001F");
    expect(note).toContain("BK12345");
  });

  // 13. Thiếu garment name -> fallback 'trang phục' an toàn
  it("Scenario 13: falls back to 'trang phục' when garmentName is omitted or null", () => {
    const note = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      garmentName: null,
    });

    expect(note).toContain("(trang phục)");
  });

  // 14. Nội dung không ghi sai thời hạn (hiển thị formatted date và returnDeadlineFormatted)
  it("Scenario 14: formats rentalEndDate cleanly as DD/MM/YYYY and includes exact deadline if provided", () => {
    const noteWithExactDeadline = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: "2026-11-08T00:00:00.000Z",
      returnDeadlineFormatted: "trước 20:00 hôm nay",
    });

    expect(noteWithExactDeadline).toContain("08/11/2026");
    expect(noteWithExactDeadline).toContain("Hạn trả trang phục: trước 20:00 hôm nay.");

    const noteWithoutExact = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: "2026-11-08",
    });

    expect(noteWithoutExact).toContain("Hôm nay (08/11/2026) là ngày kết thúc kỳ thuê đơn #00000000 (trang phục).");
  });

  // 15. Không hardcode tiền phạt (sử dụng config/constant 10.000 đ/ngày)
  it("Scenario 15: utilizes configured or system default overdue fee (10.000 đ/ngày)", () => {
    const defaultNote = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
    });
    expect(defaultNote).toContain("10.000 đ/ngày");

    const customFeeNote = builder.buildNote(
      {
        bookingId: BOOKING_ID,
        rentalEndDate: RENTAL_END_DATE,
      },
      { overdueFeePerDay: 20_000 },
    );
    expect(customFeeNote).toContain("20.000 đ/ngày");
  });

  // 16. Không ảnh hưởng pickup reminder (tách biệt rõ ràng với BookingPickupReminderBuilder)
  it("Scenario 16: operates independently of BookingPickupReminderBuilder without interference", () => {
    const pickupBuilder = new BookingPickupReminderBuilder();
    const pickupNote = pickupBuilder.buildNote({
      bookingId: BOOKING_ID,
      rentalStartDate: "2026-11-07",
    });

    const returnNote = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: "2026-11-08",
    });

    // Pickup reminder focuses on picking up clothes & start of rental
    expect(pickupNote).toContain("nhận trang phục");
    expect(pickupNote).not.toContain("quá hạn");

    // Return reminder focuses on returning & overdue regulation
    expect(returnNote).toContain("hoàn trả");
    expect(returnNote).toContain("quá hạn");
  });

  // Extra: Accessory reminder handling
  it("includes accessory return checklist when booking has accessories", () => {
    const noteWithAccessories = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      hasAccessories: true,
      accessoryCount: 3,
    });

    expect(noteWithAccessories).toContain("Lưu ý: Đơn hàng có kèm theo 3 món phụ kiện");
  });

  // Extra: Delivery method differentiation
  it("renders distinct instructions for delivery vs store pickup", () => {
    const deliveryNote = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      pickupMethod: "delivery",
    });
    expect(deliveryNote).toContain("đơn giao nhận tận nơi");
    expect(deliveryNote).toContain("Hotline điều phối lấy hàng");

    const storeNote = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      pickupMethod: "store_pickup",
    });
    expect(storeNote).toContain("Địa điểm nhận trả trang phục: Showroom");
    expect(storeNote).toContain("Giờ mở cửa đón khách");
  });

  // Extra: Summary builder for push notifications
  it("generates concise summary for push / SMS", () => {
    const summary = builder.buildSummary({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      pickupMethod: "store_pickup",
      garmentName: "Áo Nhật Bình",
    });

    expect(summary).toContain("Hôm nay là hạn trả đơn #00000000 (Áo Nhật Bình)");
    expect(summary).toContain(`(${DEFAULT_RETURN_BUSINESS_HOURS})`);
    expect(summary).toContain(DEFAULT_RETURN_STORE_PHONE);
  });

  // Extra: Pending extension verification
  it("warns about pending extension without claiming extension is already successful", () => {
    const note = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      hasPendingExtension: true,
    });

    expect(note).toContain("Lưu ý gia hạn: Đơn hàng đang có một yêu cầu gia hạn thuê chờ thanh toán (giữ lịch trong 30 phút)");
    expect(note).toContain("nếu không thanh toán kịp, yêu cầu gia hạn sẽ tự động bị huỷ");
  });

  // Workstream A: 17:00 before_close reminder for showroom (default 20:00 closing -> 3 hours remaining)
  it("Scenario 21: formats 17:00 before_close note with 3-hour warning for default 20:00 closing showroom", () => {
    const note = builder.buildNote(
      {
        bookingId: BOOKING_ID,
        rentalEndDate: RENTAL_END_DATE,
        pickupMethod: "store_pickup",
        scheduleType: "before_close",
      },
      { businessHours: "08:00 - 20:00" },
    );

    expect(note).toContain("[Nhắc lần 2 - 17h00]");
    expect(note).toContain("Hiện còn khoảng 3 giờ (trước 20:00) để hoàn trả cổ phục trực tiếp tại showroom");
    expect(note).toContain("Showroom");
    expect(note).toContain("Hotline");
  });

  // Workstream A: 17:00 before_close reminder with custom closing time (e.g. 21:00 -> 4 hours remaining)
  it("Scenario 22: dynamically calculates remaining hours when closing time differs from 20:00", () => {
    const note = builder.buildNote(
      {
        bookingId: BOOKING_ID,
        rentalEndDate: RENTAL_END_DATE,
        pickupMethod: "store_pickup",
        scheduleType: "before_close",
      },
      { businessHours: "09:00 - 21:00" },
    );

    expect(note).toContain("Hiện còn khoảng 4 giờ (trước 21:00) để hoàn trả cổ phục trực tiếp tại showroom");
  });

  // Workstream A: 17:00 before_close when store is already closed or closing (e.g. 08:00 - 17:00)
  it("Scenario 23: warns customer when showroom is already closed/closing at 17:00, avoids telling them to travel", () => {
    const note = builder.buildNote(
      {
        bookingId: BOOKING_ID,
        rentalEndDate: RENTAL_END_DATE,
        pickupMethod: "store_pickup",
        scheduleType: "before_close",
      },
      { businessHours: "08:00 - 17:00", storePhone: "0236 730 0999" },
    );

    expect(note).toContain("Showroom hiện đã đến hoặc qua giờ đóng cửa đón khách (08:00 - 17:00)");
    expect(note).toContain("Quý khách vui lòng không di chuyển đến cửa hàng ngoài giờ");
    expect(note).not.toContain("Còn khoảng 3 giờ");
  });

  // Workstream A: 17:00 before_close for delivery orders
  it("Scenario 24: formats 17:00 before_close note for delivery without showroom walk-in instructions", () => {
    const note = builder.buildNote({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      pickupMethod: "delivery",
      scheduleType: "before_close",
    });

    expect(note).toContain("[Nhắc lần 2 - 17h00]");
    expect(note).toContain("đơn giao nhận tận nơi: Quý khách vui lòng đóng gói trang phục và phụ kiện");
    expect(note).not.toContain("trực tiếp tại showroom");
  });

  // Workstream A: Summary for 17:00 before_close
  it("Scenario 25: generates accurate 17:00 summary for push / SMS", () => {
    const summaryShowroom = builder.buildSummary(
      {
        bookingId: BOOKING_ID,
        rentalEndDate: RENTAL_END_DATE,
        pickupMethod: "store_pickup",
        scheduleType: "before_close",
      },
      { businessHours: "08:00 - 20:00" },
    );
    expect(summaryShowroom).toContain("[Nhắc lần 2 - 17h00] Còn khoảng 3 giờ (trước 20:00) để trả đơn");

    const summaryDelivery = builder.buildSummary({
      bookingId: BOOKING_ID,
      rentalEndDate: RENTAL_END_DATE,
      pickupMethod: "delivery",
      scheduleType: "before_close",
    });
    expect(summaryDelivery).toContain("[Nhắc lần 2 - 17h00] Hạn trả đơn #00000000");
    expect(summaryDelivery).toContain("shipper lấy lại");
  });
});

