import { describe, expect, it } from "vitest";
import { EmailPreviewService } from "./email-preview.service";
import { EmailTemplateBuilder } from "./email-templates.builder";

describe("EmailPreviewService", () => {
  const builder = new EmailTemplateBuilder();
  const previewService = new EmailPreviewService(builder);

  it("lists all 5 available preview templates with proper categories and variants", () => {
    const list = previewService.listTemplates();
    expect(list).toHaveLength(5);

    const keys = list.map((t) => t.key);
    expect(keys).toContain("booking.pickup_reminder");
    expect(keys).toContain("booking.return_reminder");
    expect(keys).toContain("booking.extension_applied");
    expect(keys).toContain("booking.thank_you_voucher");
    expect(keys).toContain("booking.review_invite");
  });

  it("generates realistic mock preview for Pickup Reminder (store pickup and delivery)", () => {
    const storePreview = previewService.getPreview("booking.pickup_reminder", "store_pickup");
    expect(storePreview.html).toContain("Nhận tại Showroom");
    expect(storePreview.html).toContain("Áo Nhật Bình");

    const deliveryPreview = previewService.getPreview("booking.pickup_reminder", "delivery");
    expect(deliveryPreview.html).toContain("Giao tận nơi (Shipper)");
  });

  it("generates realistic mock preview for Return Reminder (daily 12h vs before_close 17h)", () => {
    const dailyPreview = previewService.getPreview("booking.return_reminder", "daily_12h");
    expect(dailyPreview.subject).toContain("[Nhắc hẹn] Hôm nay là hạn trả");

    const beforeClosePreview = previewService.getPreview("booking.return_reminder", "before_close_17h");
    expect(beforeClosePreview.subject).toContain("[Cảnh báo 17h00]");
    expect(beforeClosePreview.html).toContain("CẢNH BÁO THỜI GIAN: CÒN KHOẢNG 3 GIỜ");
  });

  it("generates realistic mock preview for Extension Confirmation", () => {
    const extPreview = previewService.getPreview("booking.extension_applied");
    expect(extPreview.subject).toContain("[Xác nhận] Gia hạn thuê cổ phục thành công");
    expect(extPreview.html).toContain("140.000 đ");
    expect(extPreview.html).toContain("+2 ngày");
  });

  it("generates realistic mock preview for Thank-You Voucher respecting Safety Gate", () => {
    // Disabled (Default)
    const disabledPreview = previewService.getPreview("booking.thank_you_voucher");
    expect(disabledPreview.html).toContain("Lời Tri Ân Từ Cổ Phục Hoàng Thành");
    expect(disabledPreview.html).not.toContain("TRIAN-");

    // Enabled (When testing voucher)
    const enabledPreview = previewService.getPreview("booking.thank_you_voucher", "program_enabled");
    expect(enabledPreview.html).toContain("Món Quà Tri Ân Dành Riêng Cho Quý Khách");
    expect(enabledPreview.html).toContain("TRIAN-CP10293");
    expect(enabledPreview.html).toContain("Giảm 10%");
  });

  it("generates realistic mock preview for Review Invitation", () => {
    const reviewPreview = previewService.getPreview("booking.review_invite");
    expect(reviewPreview.subject).toContain("[Mời đánh giá]");
    expect(reviewPreview.html).toContain("ĐÁNH GIÁ TRẢI NGHIỆM NGAY");
    expect(reviewPreview.html).toContain("★");
  });

  it("throws NotFoundException when an unsupported template key is requested", () => {
    expect(() =>
      previewService.getPreview("non_existent_template" as any),
    ).toThrowError(/Không tìm thấy mẫu email/);
  });
});

