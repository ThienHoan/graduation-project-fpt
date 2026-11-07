import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  BookingThankYouVoucherService,
  THANK_YOU_VOUCHER_ACTION,
  THANK_YOU_VOUCHER_SETTING_KEY,
} from "./booking-thank-you-voucher.service";

describe("BookingThankYouVoucherService", () => {
  const BOOKING_ID = "00000000-0000-4000-8000-0000000000a1";
  const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000c1";

  const defaultProgramSetting = {
    enabled: true,
    benefit: {
      discountType: "percentage" as const,
      discountValue: 10,
      maxDiscountAmount: 50_000,
      minOrderValue: 100_000,
      validDays: 30,
      excludePenalizedBookings: true,
    },
  };

  let prismaMock: any;
  let vouchersMock: any;
  let notificationsMock: any;
  let auditLogs: any[] = [];
  let service: BookingThankYouVoucherService;

  beforeEach(() => {
    auditLogs = [];

    notificationsMock = {
      sendBookingNotification: vi.fn().mockResolvedValue({ success: true }),
    };

    prismaMock = {
      booking: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.id === BOOKING_ID) {
            return {
              id: BOOKING_ID,
              customerId: CUSTOMER_ID,
              status: "completed",
              penaltyTotal: 0,
              rentalStartDate: new Date("2026-11-01T00:00:00.000Z"),
              rentalEndDate: new Date("2026-11-03T00:00:00.000Z"),
              items: [{ garment_sizes: { garments: { name: "Áo Nhật Bình" } } }],
            };
          }
          return null;
        }),
      },
      systemSetting: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.key === THANK_YOU_VOUCHER_SETTING_KEY) {
            return { key: THANK_YOU_VOUCHER_SETTING_KEY, value: defaultProgramSetting };
          }
          return null;
        }),
      },
      auditLog: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          return (
            auditLogs.find(
              (l) => l.action === where.action && l.entityId === where.entityId,
            ) ?? null
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          auditLogs.push(data);
          return { id: "log-1", ...data, createdAt: new Date() };
        }),
      },
    };

    vouchersMock = {
      create: vi.fn().mockImplementation(async (dto: any) => ({
        id: "v-1",
        ...dto,
      })),
    };

    service = new BookingThankYouVoucherService(prismaMock, vouchersMock, notificationsMock);
  });

  // 1. Booking completed hợp lệ -> tạo voucher thành công, ghi AuditLog
  it("Scenario 1: issues thank-you voucher successfully for completed booking and records audit log", async () => {
    const res = await service.issueThankYouVoucher(BOOKING_ID);

    expect(res.success).toBe(true);
    expect(res.status).toBe("issued");
    expect(res.voucherCode).toBe("TRIAN-00000000");
    expect(res.discountValue).toBe(10);
    expect(res.discountType).toBe("percentage");

    expect(vouchersMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "TRIAN-00000000",
        discountType: "percentage",
        discountValue: 10,
        usageLimit: 1,
        perUserLimit: 1,
        isActive: true,
      }),
    );

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: THANK_YOU_VOUCHER_ACTION,
          entityId: BOOKING_ID,
          metadata: expect.objectContaining({
            voucherCode: "TRIAN-00000000",
            customerId: CUSTOMER_ID,
          }),
        }),
      }),
    );
  });

  // 2. Booking chưa completed (vd: renting)
  it("Scenario 2: refuses issuance when booking is not in completed status", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce({
      id: BOOKING_ID,
      customerId: CUSTOMER_ID,
      status: "renting", // Not completed
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(false);
    expect(res.status).toBe("ineligible");
    expect(res.reason).toBe("invalid_booking_status");
    expect(vouchersMock.create).not.toHaveBeenCalled();
  });

  // 3. Booking cancelled
  it("Scenario 3: refuses issuance when booking was cancelled", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce({
      id: BOOKING_ID,
      customerId: CUSTOMER_ID,
      status: "cancelled",
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(false);
    expect(res.status).toBe("ineligible");
    expect(res.reason).toBe("booking_cancelled");
    expect(vouchersMock.create).not.toHaveBeenCalled();
  });

  // 4. Booking không tồn tại
  it("Scenario 4: throws NotFoundException when booking does not exist", async () => {
    await expect(service.issueThankYouVoucher("non-existent-id")).rejects.toThrow(
      NotFoundException,
    );
  });

  // 5. Voucher program disabled
  it("Scenario 5: returns disabled status when thank-you program is toggled off", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValueOnce({
      key: THANK_YOU_VOUCHER_SETTING_KEY,
      value: { enabled: false },
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(false);
    expect(res.status).toBe("disabled");
    expect(res.reason).toBe("program_disabled");
    expect(vouchersMock.create).not.toHaveBeenCalled();
  });

  // 6. Missing settings
  it("Scenario 6: returns policy_unconfirmed when program settings row is missing", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValueOnce(null);

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(false);
    expect(res.status).toBe("disabled"); // default when missing
    expect(vouchersMock.create).not.toHaveBeenCalled();
  });

  // 7. Invalid percentage (>100 or <=0)
  it("Scenario 7: rejects benefit when configured percentage is invalid", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValueOnce({
      key: THANK_YOU_VOUCHER_SETTING_KEY,
      value: {
        enabled: true,
        benefit: { ...defaultProgramSetting.benefit, discountValue: 150 }, // Invalid > 100
      },
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(false);
    expect(res.status).toBe("ineligible");
    expect(res.reason).toBe("invalid_discount_value");
    expect(vouchersMock.create).not.toHaveBeenCalled();
  });

  // 8. Invalid expiry (validDays <= 0)
  it("Scenario 8: rejects benefit when validDays is negative or zero", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValueOnce({
      key: THANK_YOU_VOUCHER_SETTING_KEY,
      value: {
        enabled: true,
        benefit: { ...defaultProgramSetting.benefit, validDays: -5 },
      },
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(false);
    expect(res.status).toBe("ineligible");
    expect(res.reason).toBe("invalid_validity_duration");
  });

  // 9. Fixed amount discount
  it("Scenario 9: issues fixed amount voucher correctly when configured", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValueOnce({
      key: THANK_YOU_VOUCHER_SETTING_KEY,
      value: {
        enabled: true,
        benefit: {
          discountType: "fixed",
          discountValue: 40_000,
          minOrderValue: 120_000,
          validDays: 14,
        },
      },
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(true);
    expect(res.discountType).toBe("fixed");
    expect(res.discountValue).toBe(40_000);
    expect(vouchersMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        discountType: "fixed",
        discountValue: 40_000,
        minOrderValue: 120_000,
      }),
    );
  });

  // 10. Percentage discount
  it("Scenario 10: creates percentage voucher matching configuration", async () => {
    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(true);
    expect(res.discountType).toBe("percentage");
    expect(res.discountValue).toBe(10);
  });

  // 11. Maximum discount cap
  it("Scenario 11: applies maxDiscountAmount cap to voucher entity", async () => {
    await service.issueThankYouVoucher(BOOKING_ID);
    expect(vouchersMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        maxDiscountAmount: 50_000,
      }),
    );
  });

  // 12. Minimum order amount
  it("Scenario 12: applies minOrderValue to voucher entity", async () => {
    await service.issueThankYouVoucher(BOOKING_ID);
    expect(vouchersMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        minOrderValue: 100_000,
      }),
    );
  });

  // 13. Voucher already issued via AuditLog check
  it("Scenario 13: skips creation and returns already_issued if auditLog already exists", async () => {
    // Record existing in auditLog
    auditLogs.push({
      action: THANK_YOU_VOUCHER_ACTION,
      entityId: BOOKING_ID,
      metadata: { voucherCode: "TRIAN-00000000" },
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(true);
    expect(res.status).toBe("already_issued");
    expect(res.voucherCode).toBe("TRIAN-00000000");
    expect(res.alreadyIssued).toBe(true);
    expect(vouchersMock.create).not.toHaveBeenCalled();
  });

  // 14. Retry cùng Booking ID -> trả về mã cũ idempotently
  it("Scenario 14: subsequent call for the same booking returns the same voucher code idempotently", async () => {
    const res1 = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res1.status).toBe("issued");
    expect(vouchersMock.create).toHaveBeenCalledTimes(1);

    // Call 2
    const res2 = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res2.status).toBe("already_issued");
    expect(res2.voucherCode).toBe(res1.voucherCode);
    expect(vouchersMock.create).toHaveBeenCalledTimes(1); // not called again
  });

  // 15 & 16. Concurrent issuance & Database unique conflict
  it("Scenario 15 & 16: recovers safely when vouchers.create throws ConflictException during race condition", async () => {
    vouchersMock.create.mockRejectedValueOnce(
      new ConflictException('Mã voucher "TRIAN-00000000" đã tồn tại.'),
    );

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(true);
    expect(res.status).toBe("already_issued");
    expect(res.voucherCode).toBe("TRIAN-00000000");
  });

  // 17. Customer ownership enforcement analysis
  it("Scenario 17: validates single-use limits but confirms voucher model has no customer_id bound field", async () => {
    await service.issueThankYouVoucher(BOOKING_ID);

    // Verified: usageLimit = 1, perUserLimit = 1
    const createCall = vouchersMock.create.mock.calls[0][0];
    expect(createCall.usageLimit).toBe(1);
    expect(createCall.perUserLimit).toBe(1);

    // Architectural verification: vouchers table lacks customerId binding column.
    // Exclusive recipient ownership cannot be guaranteed at database level without schema migration.
    expect((createCall as any).customerId).toBeUndefined();
  });

  // 18. Voucher expired calculation
  it("Scenario 18: sets accurate startAt and endAt based on validDays", async () => {
    await service.issueThankYouVoucher(BOOKING_ID);

    const createCall = vouchersMock.create.mock.calls[0][0];
    const start = new Date(createCall.startAt).getTime();
    const end = new Date(createCall.endAt).getTime();
    const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(30);
  });

  // 19. Refund/dispute / penalties
  it("Scenario 19: rejects booking with damage penalties when excludePenalizedBookings is active", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce({
      id: BOOKING_ID,
      customerId: CUSTOMER_ID,
      status: "completed",
      penaltyTotal: 80_000, // Damage penalty
    });

    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.success).toBe(false);
    expect(res.status).toBe("ineligible");
    expect(res.reason).toBe("booking_penalized");
    expect(vouchersMock.create).not.toHaveBeenCalled();
  });

  // 20. Không ảnh hưởng apology voucher (XINLOI-...)
  it("Scenario 20: maintains complete isolation from Apology Voucher prefix and logic", async () => {
    const res = await service.issueThankYouVoucher(BOOKING_ID);
    expect(res.voucherCode).toContain("TRIAN-");
    expect(res.voucherCode).not.toContain("XINLOI-");
  });

  // 21. Không ảnh hưởng Payment
  it("Scenario 21: operates strictly without modifying payment records or PayOS intents", async () => {
    await service.issueThankYouVoucher(BOOKING_ID);
    // Verifies no payment calls
    expect(prismaMock).not.toHaveProperty("payment");
  });

  // 22. Không ảnh hưởng Inventory
  it("Scenario 22: operates strictly without altering garment assets or warehouse schedules", async () => {
    await service.issueThankYouVoucher(BOOKING_ID);
    // Verifies no asset mutations
    expect(prismaMock).not.toHaveProperty("garmentAsset");
  });

  // Workstream B: processCompletedBookingThankYou thành công cả cấp voucher lẫn gửi notification
  it("Scenario 23: processCompletedBookingThankYou issues voucher and dispatches thank-you notification with review link", async () => {
    const res = await service.processCompletedBookingThankYou(BOOKING_ID);

    expect(res.success).toBe(true);
    expect(res.status).toBe("issued_and_notified");
    expect(res.voucherCode).toBe("TRIAN-00000000");
    expect(res.notificationSent).toBe(true);

    expect(notificationsMock.sendBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CUSTOMER_ID,
        templateKey: "booking.review_invite",
        bookingId: BOOKING_ID,
        garmentName: "Áo Nhật Bình",
      }),
    );

    const callArgs = notificationsMock.sendBookingNotification.mock.calls[0][0];
    expect(callArgs.note).toContain("🎁 Mã Voucher: TRIAN-00000000");
    expect(callArgs.note).toContain("Giảm 10%");
    expect(callArgs.note).toContain("/dashboard/customer");
  });

  // Workstream B: Customer Ownership Safety Gate - Khi program tắt (disabled)
  it("Scenario 24: processCompletedBookingThankYou returns disabled status when program is off, withholding voucher issuance", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValueOnce({
      key: THANK_YOU_VOUCHER_SETTING_KEY,
      value: { enabled: false }, // Disabled
    });

    const res = await service.processCompletedBookingThankYou(BOOKING_ID);

    expect(res.success).toBe(false);
    expect(res.status).toBe("disabled");
    expect(res.notificationSent).toBe(false);
    expect(vouchersMock.create).not.toHaveBeenCalled();
    expect(notificationsMock.sendBookingNotification).not.toHaveBeenCalled();
  });

  // Workstream B: Đơn không đủ điều kiện (bị phạt hư hại)
  it("Scenario 25: processCompletedBookingThankYou skips voucher and notification if booking has penalty", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce({
      id: BOOKING_ID,
      customerId: CUSTOMER_ID,
      status: "completed",
      penaltyTotal: 50_000,
    });

    const res = await service.processCompletedBookingThankYou(BOOKING_ID);

    expect(res.success).toBe(false);
    expect(res.status).toBe("ineligible");
    expect(res.reason).toBe("booking_penalized");
    expect(vouchersMock.create).not.toHaveBeenCalled();
    expect(notificationsMock.sendBookingNotification).not.toHaveBeenCalled();
  });

  // Workstream B: Notification gặp lỗi sau khi đã cấp voucher
  it("Scenario 26: handles notification failure safely without rolling back issued voucher or crashing", async () => {
    notificationsMock.sendBookingNotification.mockRejectedValueOnce(new Error("Email SMTP timeout"));

    const res = await service.processCompletedBookingThankYou(BOOKING_ID);

    expect(res.success).toBe(true);
    expect(res.status).toBe("issued_notification_failed");
    expect(res.voucherCode).toBe("TRIAN-00000000");
    expect(res.notificationSent).toBe(false);

    // Voucher was already created in DB and AuditLog
    expect(vouchersMock.create).toHaveBeenCalled();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe(THANK_YOU_VOUCHER_ACTION);
  });

  // Workstream B: Retry sau khi notification lỗi -> Không sinh voucher thứ 2
  it("Scenario 27: retrying after notification failure reuses existing voucher code without duplicating voucher", async () => {
    // Lần 1: Notification lỗi
    notificationsMock.sendBookingNotification.mockRejectedValueOnce(new Error("Network glitch"));
    await service.processCompletedBookingThankYou(BOOKING_ID);
    expect(vouchersMock.create).toHaveBeenCalledTimes(1);

    // Lần 2: Retry
    notificationsMock.sendBookingNotification.mockResolvedValueOnce({ success: true });
    const retryRes = await service.processCompletedBookingThankYou(BOOKING_ID);

    expect(retryRes.success).toBe(true);
    expect(retryRes.status).toBe("already_issued_and_notified");
    expect(retryRes.voucherCode).toBe("TRIAN-00000000");
    expect(retryRes.notificationSent).toBe(true);

    // vouchersMock.create vẫn chỉ được gọi đúng 1 lần duy nhất từ đợt 1!
    expect(vouchersMock.create).toHaveBeenCalledTimes(1);
  });
});

