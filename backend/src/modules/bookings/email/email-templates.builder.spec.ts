import { describe, expect, it } from "vitest";
import { EmailTemplateBuilder } from "./email-templates.builder";
import {
  BRAND_NAME,
  DEFAULT_STORE_ADDRESS,
  DEFAULT_STORE_PHONE,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_CUSTOMER_DASHBOARD_URL,
  escapeHtml,
  sanitizeUrl,
} from "./email-layout";

describe("EmailTemplateBuilder (Professional Email System)", () => {
  const builder = new EmailTemplateBuilder();
  const BOOKING_CODE = "CP-99001";
  const CUSTOMER_NAME = "Nguyễn Văn An";
  const GARMENT_NAME = "Áo Tấc Ngũ Thân Triều Nguyễn";

  // =========================================================================
  // SCENARIO 1: Render đầy đủ 5 templates
  // =========================================================================
  it("Scenario 1: renders all 5 customer care email templates successfully with valid HTML and text", () => {
    const pickup = builder.buildPickupReminderEmail({
      bookingCode: BOOKING_CODE,
      pickupDate: "2026-11-08",
    });
    expect(pickup.templateKey).toBe("booking.pickup_reminder");
    expect(pickup.html).toContain(BRAND_NAME);
    expect(pickup.text).toBeDefined();

    const returnReminder = builder.buildReturnReminderEmail({
      bookingCode: BOOKING_CODE,
      rentalEndDate: "2026-11-08",
    });
    expect(returnReminder.templateKey).toBe("booking.return_reminder");
    expect(returnReminder.html).toContain(BRAND_NAME);

    const ext = builder.buildExtensionAppliedEmail({
      bookingCode: BOOKING_CODE,
      originalEndDate: "2026-11-08",
      newEndDate: "2026-11-10",
      extensionDays: 2,
      extensionFee: 140_000,
      paymentStatus: "paid",
    });
    expect(ext.templateKey).toBe("booking.extension_applied");
    expect(ext.html).toContain("140.000 đ");

    const thankYou = builder.buildThankYouVoucherEmail({
      bookingCode: BOOKING_CODE,
      programEnabled: false,
    });
    expect(thankYou.templateKey).toBe("booking.thank_you_voucher");
    expect(thankYou.html).toContain("Lời Tri Ân");

    const review = builder.buildReviewInviteEmail({
      bookingCode: BOOKING_CODE,
    });
    expect(review.templateKey).toBe("booking.review_invite");
    expect(review.html).toContain("Mời Đánh Giá Trải Nghiệm");
  });

  // =========================================================================
  // SCENARIO 2: Nội dung Pickup đúng theo phương thức nhận
  // =========================================================================
  it("Scenario 2: renders distinct instructions for store pickup vs delivery in Pickup Reminder", () => {
    const storePickup = builder.buildPickupReminderEmail({
      bookingCode: BOOKING_CODE,
      pickupDate: "2026-11-08",
      pickupMethod: "store_pickup",
    });
    expect(storePickup.html).toContain("Nhận tại Showroom");
    expect(storePickup.html).toContain("nhân viên hỗ trợ thử đồ");
    expect(storePickup.text).toContain("Nhận tại Showroom");

    const delivery = builder.buildPickupReminderEmail({
      bookingCode: BOOKING_CODE,
      pickupDate: "2026-11-08",
      pickupMethod: "delivery",
    });
    expect(delivery.html).toContain("Giao tận nơi (Shipper)");
    expect(delivery.html).toContain("liên hệ trước khi phát hàng");
    expect(delivery.html).not.toContain("nhân viên hỗ trợ thử đồ");
  });

  // =========================================================================
  // SCENARIO 3: Return Reminder 12:00 vs 17:00
  // =========================================================================
  it("Scenario 3: distinguishes content and urgency between 12:00 daily and 17:00 before_close reminders", () => {
    const daily = builder.buildReturnReminderEmail({
      bookingCode: BOOKING_CODE,
      rentalEndDate: "2026-11-08",
      scheduleType: "daily",
    });
    expect(daily.subject).toContain("[Nhắc hẹn] Hôm nay là hạn trả");
    expect(daily.title).toBe("Nhắc Hạn Hoàn Trả Cổ Phục Hôm Nay");
    expect(daily.html).not.toContain("CẢNH BÁO THỜI GIAN: CÒN KHOẢNG 3 GIỜ");

    const beforeClose = builder.buildReturnReminderEmail({
      bookingCode: BOOKING_CODE,
      rentalEndDate: "2026-11-08",
      scheduleType: "before_close",
      storeInfo: { businessHours: "08:00 - 20:00" },
    });
    expect(beforeClose.subject).toContain("[Cảnh báo 17h00]");
    expect(beforeClose.title).toBe("Cảnh Báo Giờ Đóng Cửa - Hoàn Trả Cổ Phục");
    expect(beforeClose.html).toContain("CẢNH BÁO THỜI GIAN: CÒN KHOẢNG 3 GIỜ");
    expect(beforeClose.html).toContain("trước 20:00");
  });

  // =========================================================================
  // SCENARIO 4: Business hours động (20:00 vs 21:00 vs <= 17:00)
  // =========================================================================
  it("Scenario 4: dynamically calculates remaining hours for 17:00 and warns against traveling if closed", () => {
    // 21:00 closing -> 4 hours remaining
    const closing21 = builder.buildReturnReminderEmail({
      bookingCode: BOOKING_CODE,
      rentalEndDate: "2026-11-08",
      scheduleType: "before_close",
      storeInfo: { businessHours: "09:00 - 21:00" },
    });
    expect(closing21.html).toContain("CÒN KHOẢNG 4 GIỜ ĐẾN GIỜ ĐÓNG CỬA");
    expect(closing21.html).toContain("trước 21:00");

    // 17:00 closing -> store closed/closing, warns not to travel
    const closedEarly = builder.buildReturnReminderEmail({
      bookingCode: BOOKING_CODE,
      rentalEndDate: "2026-11-08",
      scheduleType: "before_close",
      storeInfo: { businessHours: "08:00 - 17:00" },
    });
    expect(closedEarly.html).toContain("SHOWROOM ĐÃ ĐẾN/QUA GIỜ ĐÓN KHÁCH");
    expect(closedEarly.html).toContain("không di chuyển đến cửa hàng ngoài giờ");
    expect(closedEarly.html).not.toContain("CÒN KHOẢNG 3 GIỜ");
  });

  // =========================================================================
  // SCENARIO 5: Extension pending KHÔNG được xác nhận thành công
  // =========================================================================
  it("Scenario 5: throws error if attempting to build extension confirmation email for pending/unpaid status", () => {
    expect(() =>
      builder.buildExtensionAppliedEmail({
        bookingCode: BOOKING_CODE,
        originalEndDate: "2026-11-08",
        newEndDate: "2026-11-10",
        extensionDays: 2,
        extensionFee: 140_000,
        paymentStatus: "pending", // Not paid
      }),
    ).toThrowError(/Không thể tạo email xác nhận gia hạn khi trạng thái thanh toán là 'pending'/);
  });

  // =========================================================================
  // SCENARIO 6: Extension applied hiển thị đúng ngày và phí
  // =========================================================================
  it("Scenario 6: renders extension confirmation with accurate original/new dates, days, and formatted fee", () => {
    const ext = builder.buildExtensionAppliedEmail({
      customerName: CUSTOMER_NAME,
      bookingCode: BOOKING_CODE,
      garmentName: GARMENT_NAME,
      originalEndDate: "2026-11-08",
      newEndDate: "2026-11-11",
      extensionDays: 3,
      extensionFee: 210_000,
      paymentStatus: "paid",
    });

    expect(ext.html).toContain("08/11/2026");
    expect(ext.html).toContain("11/11/2026");
    expect(ext.html).toContain("+3 ngày");
    expect(ext.html).toContain("210.000 đ");
    expect(ext.html).toContain("Đã thanh toán thành công qua PayOS");
  });

  // =========================================================================
  // SCENARIO 7: Voucher program disabled KHÔNG hiển thị voucher
  // =========================================================================
  it("Scenario 7: strictly withholds voucher code and discount display when program is disabled (Safety Gate)", () => {
    const email = builder.buildThankYouVoucherEmail({
      customerName: CUSTOMER_NAME,
      bookingCode: BOOKING_CODE,
      garmentName: GARMENT_NAME,
      programEnabled: false, // Disabled
      voucherCode: "TRIAN-LEAKED-CODE",
      discountValue: 10,
    });

    expect(email.subject).toBe(`[Tri ân] Cảm ơn Quý khách đã hoàn tất kỳ thuê đơn #${BOOKING_CODE}`);
    expect(email.title).toBe("Lời Tri Ân Từ Cổ Phục Hoàng Thành");
    expect(email.html).not.toContain("TRIAN-LEAKED-CODE");
    expect(email.html).not.toContain("Giảm 10%");
    expect(email.html).not.toContain("VOUCHER TRI ÂN");
    expect(email.text).not.toContain("TRIAN-LEAKED-CODE");
  });

  // =========================================================================
  // SCENARIO 8: Voucher program enabled hiển thị đúng điều kiện
  // =========================================================================
  it("Scenario 8: renders royal golden voucher card when program is enabled and code is valid", () => {
    const email = builder.buildThankYouVoucherEmail({
      customerName: CUSTOMER_NAME,
      bookingCode: BOOKING_CODE,
      garmentName: GARMENT_NAME,
      programEnabled: true,
      voucherCode: "TRIAN-CP99001",
      discountType: "percentage",
      discountValue: 15,
      maxDiscountAmount: 100_000,
      minOrderValue: 200_000,
      expiresAt: "2026-12-15",
    });

    expect(email.subject).toContain("[Tặng Voucher Tri Ân]");
    expect(email.html).toContain("TRIAN-CP99001");
    expect(email.html).toContain("Giảm 15%");
    expect(email.html).toContain("Tối đa 100.000 đ");
    expect(email.html).toContain("200.000 đ");
    expect(email.html).toContain("15/12/2026");
    expect(email.text).toContain("TRIAN-CP99001");
  });

  // =========================================================================
  // SCENARIO 9: Thiếu địa chỉ/hotline -> Fallback an toàn
  // =========================================================================
  it("Scenario 9: falls back safely to default showroom address, hotline, and business hours when omitted", () => {
    const email = builder.buildPickupReminderEmail({
      bookingCode: BOOKING_CODE,
      pickupDate: "2026-11-08",
      storeInfo: {}, // Empty
    });

    expect(email.html).toContain(DEFAULT_STORE_ADDRESS);
    expect(email.html).toContain(DEFAULT_STORE_PHONE);
    expect(email.html).toContain(DEFAULT_BUSINESS_HOURS);
  });

  // =========================================================================
  // SCENARIO 10: Thiếu garment name -> Fallback an toàn
  // =========================================================================
  it("Scenario 10: falls back cleanly to 'Cổ phục Hoàng thành' when garmentName is null or undefined", () => {
    const email = builder.buildReviewInviteEmail({
      bookingCode: BOOKING_CODE,
      garmentName: null,
    });

    expect(email.html).toContain("Cổ phục Hoàng thành");
    expect(email.text).toContain("Cổ phục Hoàng thành");
  });

  // =========================================================================
  // SCENARIO 11: HTML escaping (chống XSS / HTML injection)
  // =========================================================================
  it("Scenario 11: escapes raw HTML characters, script tags, and control characters in user inputs", () => {
    const email = builder.buildPickupReminderEmail({
      customerName: "Trần An <script>alert('xss')</script>",
      bookingCode: "BK&\"'<123>\u0000",
      garmentName: "Áo Tấc <b>Bold</b>",
      pickupDate: "2026-11-08",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
    expect(email.html).not.toContain("<b>Bold</b>");
    expect(email.html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
    expect(email.html).not.toContain("\u0000");
  });

  // =========================================================================
  // SCENARIO 12: URL validation
  // =========================================================================
  it("Scenario 12: sanitizes invalid or malicious URLs to default safe customer dashboard URL", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe(DEFAULT_CUSTOMER_DASHBOARD_URL);
    expect(sanitizeUrl("data:text/html,<script>")).toBe(DEFAULT_CUSTOMER_DASHBOARD_URL);
    expect(sanitizeUrl("vbscript:msgbox")).toBe(DEFAULT_CUSTOMER_DASHBOARD_URL);
    expect(sanitizeUrl("https://cophuc.vn/dashboard/customer")).toBe("https://cophuc.vn/dashboard/customer");
    expect(sanitizeUrl("/dashboard/customer")).toBe("/dashboard/customer");
  });

  // =========================================================================
  // SCENARIO 13: Plain text fallback
  // =========================================================================
  it("Scenario 13: generates coherent plain text fallback containing essential booking info and hotline", () => {
    const email = builder.buildReturnReminderEmail({
      customerName: CUSTOMER_NAME,
      bookingCode: BOOKING_CODE,
      rentalEndDate: "2026-11-08",
    });

    expect(email.text).toContain(`=== ${BRAND_NAME.toUpperCase()} ===`);
    expect(email.text).toContain(BOOKING_CODE);
    expect(email.text).toContain(DEFAULT_STORE_PHONE);
    expect(email.text).toContain(DEFAULT_STORE_ADDRESS);
    expect(email.text).not.toContain("<table");
  });

  // =========================================================================
  // SCENARIO 14: Responsive markup (600px container, fluid table)
  // =========================================================================
  it("Scenario 14: formats responsive email markup with table-based structure and 600px max width", () => {
    const email = builder.buildReviewInviteEmail({
      bookingCode: BOOKING_CODE,
    });

    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain('width="600"');
    expect(email.html).toContain("max-width: 600px; width: 100%;");
    expect(email.html).toContain("<!DOCTYPE html>");
    expect(email.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  });

  // =========================================================================
  // SCENARIO 15: Không ảnh hưởng notification templates khác
  // =========================================================================
  it("Scenario 15: operates purely on 5 designated template keys without modifying other system templates", () => {
    const keys = [
      builder.buildPickupReminderEmail({ bookingCode: BOOKING_CODE, pickupDate: "2026-11-08" }).templateKey,
      builder.buildReturnReminderEmail({ bookingCode: BOOKING_CODE, rentalEndDate: "2026-11-08" }).templateKey,
      builder.buildExtensionAppliedEmail({
        bookingCode: BOOKING_CODE,
        originalEndDate: "2026-11-08",
        newEndDate: "2026-11-10",
        extensionDays: 2,
        extensionFee: 140_000,
        paymentStatus: "paid",
      }).templateKey,
      builder.buildThankYouVoucherEmail({ bookingCode: BOOKING_CODE, programEnabled: false }).templateKey,
      builder.buildReviewInviteEmail({ bookingCode: BOOKING_CODE }).templateKey,
    ];

    expect(keys).toEqual([
      "booking.pickup_reminder",
      "booking.return_reminder",
      "booking.extension_applied",
      "booking.thank_you_voucher",
      "booking.review_invite",
    ]);

    // Untouched non-care templates:
    expect(keys).not.toContain("auth.password_reset");
    expect(keys).not.toContain("staff.daily_digest");
    expect(keys).not.toContain("booking.staff.asset_unavailable");
  });
});

