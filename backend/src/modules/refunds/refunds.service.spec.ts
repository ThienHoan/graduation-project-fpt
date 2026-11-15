/**
 * @blast-radius: core, api, db
 * Behavioral tests for RefundsService: Security deposit refund calculation and lifecycle.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { RefundsService } from "./refunds.service";

describe("RefundsService", () => {
  const BOOKING_ID = "booking-123";
  const STAFF_ID = "staff-001";

  function createService(bookingOverrides: Record<string, any> = {}) {
    const defaultBooking = {
      id: BOOKING_ID,
      depositTotal: 1000000,
      penaltyTotal: 200000,
      status: BookingStatus.completed,
      refunds: [],
      payments: [{ id: "pay-1", status: PaymentStatus.paid, amount: 2000000, method: "vnpay" }],
      ...bookingOverrides,
    };

    const tx = {
      booking: {
        findUnique: vi.fn().mockResolvedValue(defaultBooking),
      },
      refund: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: "refund-1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        findUnique: vi.fn().mockResolvedValue({
          id: "refund-1",
          bookingId: BOOKING_ID,
          amount: 800000,
          status: PaymentStatus.pending,
          refund_method: "bank_transfer",
          booking: defaultBooking,
          payment: defaultBooking.payments[0],
          createdAt: new Date(),
          updated_at: new Date(),
        }),
      },
      financialTransaction: {
        create: vi.fn().mockResolvedValue({ id: "ft-1" }),
      },
      // Credit đổi mẫu/bỏ món (§11): mặc định không có → số hoàn = cọc − phạt.
      bookingAdjustment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      booking: {
        findUnique: vi.fn().mockResolvedValue(defaultBooking),
      },
      bookingAdjustment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      refund: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      runSerializable: vi.fn().mockImplementation(async (cb: (txClient: typeof tx) => Promise<any>) => cb(tx)),
    };

    const notifications = {
      notify: vi.fn().mockResolvedValue(undefined),
    };

    const realtime = {
      refundChanged: vi.fn(),
    };

    const loyalty = {
      awardPointsForBooking: vi.fn().mockResolvedValue({ pointsEarned: 100 }),
    };

    const service = new RefundsService(prisma as any, notifications as any, realtime as any, loyalty as any);
    return { service, tx, defaultBooking, realtime, loyalty };
  }

  describe("calculate", () => {
    it("returns correct refund amount as depositTotal minus penaltyTotal", async () => {
      const { service } = createService({ depositTotal: 500000, penaltyTotal: 100000 });
      const result = await service.calculate(BOOKING_ID);

      expect(result.data).toEqual({
        bookingId: BOOKING_ID,
        depositTotal: 500000,
        penaltyTotal: 100000,
        refundAmount: 400000,
      });
    });

    it("clamps refundAmount to 0 when penalty exceeds deposit", async () => {
      const { service } = createService({ depositTotal: 200000, penaltyTotal: 300000 });
      const result = await service.calculate(BOOKING_ID);

      expect(result.data?.refundAmount).toBe(0);
    });

    it("cộng credit đổi mẫu/bỏ món còn treo vào số hoàn thực (§11)", async () => {
      const { service } = createService({ depositTotal: 500000, penaltyTotal: 100000 });
      // prisma.bookingAdjustment (không phải tx) trả credit.
      (service["prisma"].bookingAdjustment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { amount: 150000 },
      ]);

      const result = await service.calculate(BOOKING_ID);

      // 500.000 − 100.000 + 150.000 = 550.000
      expect(result.data?.refundAmount).toBe(550000);
    });

    it("đơn đã huỷ: hoàn toàn bộ tiền thực thu trừ phiếu hoàn đã tạo (không dùng cọc − phạt)", async () => {
      const { service } = createService({
        status: BookingStatus.cancelled,
        depositTotal: 300000,
        penaltyTotal: 0,
      });
      (service["prisma"].payment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { amount: 800000 },
      ]);
      (service["prisma"].refund.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { amount: 800000 },
      ]);

      const result = await service.calculate(BOOKING_ID);

      // Cọc − phạt sẽ ra 300.000 (thiếu tiền thuê) ⇒ phải là 800.000 − 800.000 = 0
      // khi phiếu hoàn toàn bộ tiền thực thu đã tồn tại.
      expect(result.data?.refundAmount).toBe(0);
    });

    it("throws NotFoundException when booking does not exist", async () => {
      const { service } = createService();
      vi.spyOn(service["prisma"].booking, "findUnique").mockResolvedValue(null);

      await expect(service.calculate("non-existent")).rejects.toThrow(NotFoundException);
    });
  });

  describe("create", () => {
    it("creates a refund request with bank details and logs a financial transaction", async () => {
      const { service, tx, realtime } = createService();

      const dto = {
        bookingId: BOOKING_ID,
        refundMethod: "bank_transfer" as const,
        reason: "Hoàn cọc sau trả đồ",
        bankName: "MB Bank",
        bankAccountNumber: "0987654321",
        bankAccountHolder: "NGUYEN VAN A",
      };

      const result = await service.create(dto, STAFF_ID);

      expect(result.data).toBeDefined();
      expect(tx.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bookingId: BOOKING_ID,
            amount: 800000,
            status: PaymentStatus.pending,
            refund_method: "bank_transfer",
            bank_name: "MB Bank",
            bank_account_number: "0987654321",
            processed_by: STAFF_ID,
          }),
        }),
      );

      expect(tx.financialTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bookingId: BOOKING_ID,
            amount: 800000,
            transactionType: "refund_bank_transfer_pending",
          }),
        }),
      );

      expect(realtime.refundChanged).toHaveBeenCalled();
    });

    it("creates a cash refund request correctly", async () => {
      const { service, tx } = createService();

      const dto = {
        bookingId: BOOKING_ID,
        refundMethod: "cash" as const,
        reason: "Khách nhận tiền mặt tại quầy",
      };

      await service.create(dto, STAFF_ID);

      expect(tx.financialTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transactionType: "refund_cash_pending",
          }),
        }),
      );
    });

    it("throws BadRequestException if booking status is not refund_pending or completed", async () => {
      const { service } = createService({ status: BookingStatus.renting });

      const dto = {
        bookingId: BOOKING_ID,
        refundMethod: "cash" as const,
      };

      await expect(service.create(dto, STAFF_ID)).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if booking was already refunded", async () => {
      const { service } = createService({
        refunds: [{ id: "old-1", status: PaymentStatus.refunded, amount: 500000 }],
      });

      const dto = {
        bookingId: BOOKING_ID,
        refundMethod: "cash" as const,
      };

      await expect(service.create(dto, STAFF_ID)).rejects.toThrow("Đơn này đã được hoàn cọc trước đó.");
    });

    it("throws BadRequestException if an active refund is already pending", async () => {
      const { service } = createService({
        refunds: [{ id: "active-1", status: PaymentStatus.pending, amount: 500000 }],
      });

      const dto = {
        bookingId: BOOKING_ID,
        refundMethod: "cash" as const,
      };

      await expect(service.create(dto, STAFF_ID)).rejects.toThrow("Đơn này đã có yêu cầu hoàn cọc đang chờ xử lý.");
    });

    it("throws BadRequestException if bank details are missing for bank transfer", async () => {
      const { service } = createService();

      const dto = {
        bookingId: BOOKING_ID,
        refundMethod: "bank_transfer" as const,
        bankName: "",
        bankAccountNumber: "",
        bankAccountHolder: "",
      };

      await expect(service.create(dto, STAFF_ID)).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when refund amount is 0 or negative", async () => {
      const { service } = createService({ depositTotal: 500000, penaltyTotal: 500000 });

      const dto = {
        bookingId: BOOKING_ID,
        refundMethod: "cash" as const,
      };

      await expect(service.create(dto, STAFF_ID)).rejects.toThrow("Không có tiền cọc để hoàn lại.");
    });

    it("cộng credit còn treo vào số tiền phiếu và KHÔNG tất toán ngay (chỉ tất toán khi duyệt)", async () => {
      const { service, tx } = createService({ depositTotal: 1_000_000, penaltyTotal: 200_000 });
      tx.bookingAdjustment.findMany.mockResolvedValue([{ amount: 300_000 }]);

      const dto = { bookingId: BOOKING_ID, refundMethod: "cash" as const };
      await service.create(dto, STAFF_ID);

      // 1.000.000 − 200.000 + 300.000 = 1.100.000
      expect(tx.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 1_100_000 }) }),
      );
      // Chưa tất toán: phiếu bị từ chối vẫn giữ credit để lần sau cộng đúng.
      expect(tx.bookingAdjustment.updateMany).not.toHaveBeenCalled();
    });
  });
});
