import { describe, expect, it } from "vitest";
import { BookingEmailAdapter } from "./booking-email.adapter";
import { EmailTemplateBuilder } from "./email-templates.builder";

describe("BookingEmailAdapter", () => {
  const builder = new EmailTemplateBuilder();
  const adapter = new BookingEmailAdapter(builder);

  it("chuẩn bị email pickup reminder thành công", () => {
    const result = adapter.preparePickupReminderEmail({
      bookingId: "00000000-0000-4000-8000-0000000000a1",
      customerName: "Nguyễn Văn A",
      garmentName: "Nhật Bình Hoàng Gia",
      pickupDate: "2026-12-15",
      pickupMethod: "store_pickup",
      storeAddress: "123 Hoàng Thành, Huế",
      businessHours: "08:00 - 20:00",
    });

    expect(result.subject).toContain("Nhắc lịch");
    expect(result.html).toContain("Nguyễn Văn A");
    expect(result.html).toContain("123 Hoàng Thành, Huế");
    expect(result.text).toContain("15/12/2026");
  });

  it("chuẩn bị email return reminder 17h trước giờ đóng cửa", () => {
    const result = adapter.prepareReturnReminderEmail({
      bookingId: "00000000-0000-4000-8000-0000000000a2",
      customerName: "Trần Thị B",
      garmentName: "Áo Tấc Gấm",
      returnDate: "2026-12-16",
      scheduleType: "before_close",
      businessHours: "08:00 - 20:00",
      accessoryCount: 2,
    });

    expect(result.subject).toContain("Sắp đến giờ đóng cửa");
    expect(result.html).toContain("20:00");
    expect(result.html).toContain("2 món phụ kiện");
  });

  it("chuẩn bị email thank you voucher tôn trọng safety gate (disabled)", () => {
    const result = adapter.prepareThankYouVoucherEmail({
      bookingId: "00000000-0000-4000-8000-0000000000a3",
      customerName: "Lê Văn C",
      voucherCode: "TRIAN-SAMPLE",
      isProgramEnabled: false,
    });

    expect(result.subject).toContain("Cảm ơn Quý khách");
    expect(result.html).not.toContain("TRIAN-SAMPLE");
    expect(result.html).toContain("Lời Tri Ân Từ Cổ Phục Hoàng Thành");
  });

  it("chuẩn bị email extension applied thành công", () => {
    const result = adapter.prepareExtensionAppliedEmail({
      bookingId: "00000000-0000-4000-8000-0000000000a4",
      customerName: "Phạm Văn D",
      newReturnDate: "2026-12-20",
      extensionDays: 2,
      extensionFee: 150000,
    });

    expect(result.subject).toContain("Gia hạn thuê cổ phục thành công");
    expect(result.html).toContain("150.000");
    expect(result.text).toContain("20/12/2026");
  });

  it("chuẩn bị email review invite thành công", () => {
    const result = adapter.prepareReviewInviteEmail({
      bookingId: "00000000-0000-4000-8000-0000000000a5",
      customerName: "Hoàng Thị E",
      garmentName: "Ngũ Thân Tay Chẽn",
    });

    expect(result.subject).toContain("Mời đánh giá");
    expect(result.html).toContain("Ngũ Thân Tay Chẽn");
    expect(result.html).toContain("★ ★ ★ ★ ★");
  });
});
