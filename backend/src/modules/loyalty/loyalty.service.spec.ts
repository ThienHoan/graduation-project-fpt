import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LoyaltyService } from "./loyalty.service";

describe("LoyaltyService", () => {
  let service: LoyaltyService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userAccount: {
        findUnique: vi.fn(),
      },
      loyalty_redemption_rules: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      loyalty_point_logs: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      vouchers: {
        create: vi.fn(),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $executeRaw: vi.fn(),
      runSerializable: vi.fn((fn: any) => fn(prisma)),
    };

    service = new LoyaltyService(prisma);
  });

  describe("getMyLoyalty", () => {
    it("returns basic tier and pointsNeeded for plus", async () => {
      prisma.userAccount.findUnique.mockResolvedValueOnce({
        loyaltyPoints: 500,
        loyaltyPointsLifetime: 500,
        loyaltyTier: "basic",
      });

      const res = await service.getMyLoyalty("user-1");
      expect(res.success).toBe(true);
      expect(res.data?.tier).toBe("basic");
      expect(res.data?.points).toBe(500);
      expect(res.data?.nextTier?.tier).toBe("plus");
      expect(res.data?.nextTier?.pointsNeeded).toBe(1500); // 2000 - 500
    });

    it("returns plus tier and pointsNeeded for premium", async () => {
      prisma.userAccount.findUnique.mockResolvedValueOnce({
        loyaltyPoints: 3000,
        loyaltyPointsLifetime: 3500,
        loyaltyTier: "plus",
      });

      const res = await service.getMyLoyalty("user-plus");
      expect(res.data?.tier).toBe("plus");
      expect(res.data?.nextTier?.tier).toBe("premium");
      expect(res.data?.nextTier?.pointsNeeded).toBe(2500); // 6000 - 3500
    });

    it("returns null nextTier for premium tier", async () => {
      prisma.userAccount.findUnique.mockResolvedValueOnce({
        loyaltyPoints: 8000,
        loyaltyPointsLifetime: 8000,
        loyaltyTier: "premium",
      });

      const res = await service.getMyLoyalty("user-premium");
      expect(res.data?.tier).toBe("premium");
      expect(res.data?.nextTier).toBeNull();
    });

    it("throws NotFoundException if user not found", async () => {
      prisma.userAccount.findUnique.mockResolvedValueOnce(null);
      await expect(service.getMyLoyalty("non-existent")).rejects.toThrow(NotFoundException);
    });

    it("calculates pendingPoints from active non-completed bookings that are paid", async () => {
      prisma.userAccount.findUnique.mockResolvedValueOnce({
        loyaltyPoints: 100,
        loyaltyPointsLifetime: 100,
        loyaltyTier: "basic",
      });
      prisma.booking.findMany.mockResolvedValueOnce([
        {
          id: "book-1",
          rentalTotal: 450000,
          discountTotal: 50000,
          status: "renting",
          rentalStartDate: new Date(),
          rentalEndDate: new Date(),
          createdAt: new Date(),
          payments: [{ status: "paid" }],
        },
      ]);

      const res = await service.getMyLoyalty("user-1");
      expect(res.data?.pendingPoints).toBe(450); // 450000 / 1000
      expect(res.data?.pendingBookings).toHaveLength(1);
      expect(res.data?.pendingBookings[0].points).toBe(450);
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.objectContaining({
              in: expect.not.arrayContaining(["pending_confirmation"]),
            }),
          }),
        }),
      );
    });

    it("excludes confirmed booking if payment is not yet paid", async () => {
      prisma.userAccount.findUnique.mockResolvedValueOnce({
        loyaltyPoints: 100,
        loyaltyPointsLifetime: 100,
        loyaltyTier: "basic",
      });
      // Đơn confirmed nhưng chưa thanh toán (payments pending hoặc rỗng)
      prisma.booking.findMany.mockResolvedValueOnce([
        {
          id: "book-unpaid",
          rentalTotal: 840000,
          status: "confirmed",
          rentalStartDate: new Date(),
          rentalEndDate: new Date(),
          createdAt: new Date(),
          payments: [{ status: "pending" }],
        },
      ]);

      const res = await service.getMyLoyalty("user-1");
      expect(res.data?.pendingPoints).toBe(0);
      expect(res.data?.pendingBookings).toHaveLength(0);
    });

    it("includes confirmed booking if payment is successfully paid", async () => {
      prisma.userAccount.findUnique.mockResolvedValueOnce({
        loyaltyPoints: 100,
        loyaltyPointsLifetime: 100,
        loyaltyTier: "basic",
      });
      // Đơn confirmed nhưng khách đã thanh toán thành công
      prisma.booking.findMany.mockResolvedValueOnce([
        {
          id: "book-paid-confirmed",
          rentalTotal: 840000,
          status: "confirmed",
          rentalStartDate: new Date(),
          rentalEndDate: new Date(),
          createdAt: new Date(),
          payments: [{ status: "paid" }],
        },
      ]);

      const res = await service.getMyLoyalty("user-1");
      expect(res.data?.pendingPoints).toBe(840);
      expect(res.data?.pendingBookings).toHaveLength(1);
      expect(res.data?.pendingBookings[0].points).toBe(840);
    });
  });

  describe("awardPointsForBooking", () => {
    it("calculates 1 point per 1.000đ spend and records log", async () => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        userAccount: {
          findUnique: vi.fn().mockResolvedValue({ loyaltyPoints: 350 }),
        },
        loyalty_point_logs: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "log-1" }),
        },
      };

      const result = await service.awardPointsForBooking(
        tx as any,
        "booking-1",
        "cust-1",
        350000, // 350.000đ
      );

      expect(result?.pointsEarned).toBe(350);
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.loyalty_point_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: "cust-1",
            bookingId: "booking-1",
            delta: 350,
            reason: "earn_rental",
            balanceAfter: 350,
          }),
        }),
      );
    });

    it("returns null when rental spend is less than 1.000đ", async () => {
      const tx = { $executeRaw: vi.fn() };
      const result = await service.awardPointsForBooking(tx as any, "booking-2", "cust-2", 800);
      expect(result).toBeNull();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it("prevents duplicate point awards if booking was already rewarded (webhook retry)", async () => {
      const tx = {
        $executeRaw: vi.fn(),
        loyalty_point_logs: {
          findFirst: vi.fn().mockResolvedValue({ id: "log-already-awarded" }),
          create: vi.fn(),
        },
      };

      const result = await service.awardPointsForBooking(tx as any, "booking-repeat", "cust-1", 500000);
      expect(result).toBeNull();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.loyalty_point_logs.create).not.toHaveBeenCalled();
    });
  });

  describe("clawbackPointsForBooking", () => {
    it("deducts points and records clawback log when booking has points", async () => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        userAccount: {
          findUnique: vi.fn().mockResolvedValue({ loyaltyPoints: 200 }),
        },
        loyalty_point_logs: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ id: "earn-log-1", delta: 150 }) // earnedLog
            .mockResolvedValueOnce(null), // alreadyClawed
          create: vi.fn().mockResolvedValue({ id: "claw-log-1" }),
        },
      };

      const result = await service.clawbackPointsForBooking(tx as any, "book-cancelled", "cust-1");
      expect(result?.pointsDeducted).toBe(150);
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.loyalty_point_logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            delta: -150,
            reason: "clawback_cancelled",
          }),
        }),
      );
    });

    it("returns null if booking had no points or was already clawed back", async () => {
      const tx = {
        $executeRaw: vi.fn(),
        loyalty_point_logs: {
          findFirst: vi.fn().mockResolvedValueOnce(null),
        },
      };

      const result = await service.clawbackPointsForBooking(tx as any, "book-never-earned", "cust-1");
      expect(result).toBeNull();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("redeemPoints", () => {
    it("throws BadRequestException if rule not found or inactive", async () => {
      prisma.loyalty_redemption_rules.findUnique.mockResolvedValueOnce(null);
      await expect(service.redeemPoints("cust-1", "rule-missing")).rejects.toThrow(BadRequestException);

      prisma.loyalty_redemption_rules.findUnique.mockResolvedValueOnce({
        id: "rule-inactive",
        isActive: false,
      });
      await expect(service.redeemPoints("cust-1", "rule-inactive")).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if user has insufficient points", async () => {
      prisma.loyalty_redemption_rules.findUnique.mockResolvedValueOnce({
        id: "rule-1",
        isActive: true,
        pointsRequired: 500,
      });

      // Updated rows = 0 indicates not enough points
      prisma.$executeRaw.mockResolvedValueOnce(0);

      await expect(service.redeemPoints("cust-1", "rule-1")).rejects.toThrow(BadRequestException);
    });

    it("successfully creates 1-time voucher and logs point debit", async () => {
      prisma.loyalty_redemption_rules.findUnique.mockResolvedValueOnce({
        id: "rule-1",
        isActive: true,
        pointsRequired: 500,
        voucherName: "Voucher 50k",
        discountType: "fixed",
        discountValue: 50000,
        maxDiscountAmount: null,
        minOrderValue: 100000,
        voucherValidityDays: 30,
      });

      prisma.$executeRaw.mockResolvedValueOnce(1);
      prisma.userAccount.findUnique.mockResolvedValueOnce({ loyaltyPoints: 200 });
      prisma.vouchers.create.mockResolvedValueOnce({
        code: "LYL-CUST1-TEST",
        name: "Voucher 50k",
        discount_type: "fixed",
        discount_value: 50000,
        end_at: new Date(),
      });

      const res = await service.redeemPoints("cust-1-abcdef", "rule-1");
      expect(res.success).toBe(true);
      expect(res.data?.voucherCode).toBe("LYL-CUST1-TEST");
      expect(res.data?.balanceAfter).toBe(200);
    });
  });
});

