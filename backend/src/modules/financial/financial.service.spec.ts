import { describe, it, expect, vi, beforeEach } from "vitest";
import { FinancialService } from "./financial.service";
import { BookingStatus, PaymentStatus } from "@prisma/client";

// ── Mock PrismaService ──
function createMockPrisma() {
  return {
    booking: {
      aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    refund: {
      aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    penalty: {
      aggregate: vi.fn().mockResolvedValue({ _sum: {} }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    financialTransaction: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("FinancialService", () => {
  let service: FinancialService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new FinancialService(prisma as any);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 5 — Revenue Does NOT Include Deposit
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Revenue excludes deposit", () => {
    it("should calculate rental revenue separately from deposit", async () => {
      // Setup: Rental = 500.000, Deposit = 1.000.000
      prisma.booking.aggregate
        // First call: revenue aggregation (rentalTotal)
        .mockResolvedValueOnce({
          _sum: { rentalTotal: 500_000 },
          _count: { _all: 1 },
        })
        // Second call: deposit received aggregation
        .mockResolvedValueOnce({
          _sum: { depositTotal: 1_000_000 },
        })
        // Third call: deposit held aggregation
        .mockResolvedValueOnce({
          _sum: { depositTotal: 1_000_000 },
          _count: { _all: 1 },
        });

      // No refunded bookings that are completed without refund
      prisma.booking.findMany.mockResolvedValue([]);
      // No refunds
      prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: { _all: 0 } });
      // No penalties
      prisma.penalty.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      // No transactions
      prisma.financialTransaction.count.mockResolvedValue(0);
      // Booking counts
      prisma.booking.count
        .mockResolvedValueOnce(1)  // totalBookings
        .mockResolvedValueOnce(1)  // paidBookings
        .mockResolvedValueOnce(0); // unpaidBookings

      const result = await service.getSummary({});

      expect(result.success).toBe(true);
      expect(result.data?.rentalRevenue).toBe(500_000);
      // Revenue must NOT be 1.500.000
      expect(result.data?.rentalRevenue).not.toBe(1_500_000);
      expect(result.data?.depositReceived).toBe(1_000_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 1 — Full Refund
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Full Refund deposit status", () => {
    it("should show FULLY_REFUNDED when deposit is fully refunded", async () => {
      const booking = {
        id: "booking-1",
        customerId: "customer-1",
        depositTotal: 1_000_000,
        penaltyTotal: 0,
        status: BookingStatus.completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: {
          id: "customer-1",
          email: "test@test.com",
          profile: { fullName: "Test User", phone: "0123456789" },
        },
        refunds: [
          {
            id: "refund-1",
            amount: 1_000_000,
            status: PaymentStatus.refunded,
            reason: null,
            refund_method: "cash",
            processed_by: null,
            createdAt: new Date(),
            updated_at: new Date(),
          },
        ],
        penalties: [],
      };

      prisma.booking.findMany.mockResolvedValue([booking]);

      const result = await service.getDeposits({});

      expect(result.success).toBe(true);
      const deposits = result.data as any[];
      expect(deposits).toHaveLength(1);
      expect(deposits[0].status).toBe("FULLY_REFUNDED");
      expect(deposits[0].refundedAmount).toBe(1_000_000);
      expect(deposits[0].remainingAmount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 2 — Partial Refund
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Partial Refund deposit status", () => {
    it("should show PARTIALLY_REFUNDED when deposit is partially refunded", async () => {
      const booking = {
        id: "booking-2",
        customerId: "customer-1",
        depositTotal: 1_000_000,
        penaltyTotal: 200_000,
        status: BookingStatus.completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: {
          id: "customer-1",
          email: "test@test.com",
          profile: { fullName: "Test", phone: null },
        },
        refunds: [
          {
            id: "refund-2",
            amount: 800_000,
            status: PaymentStatus.refunded,
            reason: "Damage deduction",
            refund_method: "bank_transfer",
            processed_by: null,
            createdAt: new Date(),
            updated_at: new Date(),
          },
        ],
        penalties: [
          {
            id: "penalty-1",
            amount: 200_000,
            reason: "Hư hỏng áo dài",
            createdBy: null,
            createdAt: new Date(),
          },
        ],
      };

      prisma.booking.findMany.mockResolvedValue([booking]);

      const result = await service.getDeposits({});

      expect(result.success).toBe(true);
      const deposits = result.data as any[];
      expect(deposits).toHaveLength(1);
      expect(deposits[0].status).toBe("PARTIALLY_REFUNDED");
      expect(deposits[0].refundedAmount).toBe(800_000);
      expect(deposits[0].damageDeduction).toBe(200_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 3 — Full Forfeiture
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Full Forfeiture deposit status", () => {
    it("should show FORFEITED when penalty >= deposit and no refund", async () => {
      const booking = {
        id: "booking-3",
        customerId: "customer-1",
        depositTotal: 1_000_000,
        penaltyTotal: 1_000_000,
        status: BookingStatus.completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: {
          id: "customer-1",
          email: "test@test.com",
          profile: { fullName: "Test", phone: null },
        },
        refunds: [],
        penalties: [
          {
            id: "penalty-2",
            amount: 1_000_000,
            reason: "Mất trang phục",
            createdBy: null,
            createdAt: new Date(),
          },
        ],
      };

      prisma.booking.findMany.mockResolvedValue([booking]);

      const result = await service.getDeposits({});

      expect(result.success).toBe(true);
      const deposits = result.data as any[];
      expect(deposits).toHaveLength(1);
      expect(deposits[0].status).toBe("FORFEITED");
      expect(deposits[0].forfeitedAmount).toBe(1_000_000);
      expect(deposits[0].refundedAmount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test 6 — Dashboard Daily Reconciliation
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Daily Reconciliation", () => {
    it("should separate rental revenue, deposit, refund, and damage correctly", async () => {
      // Revenue bookings in range
      prisma.booking.findMany.mockResolvedValue([
        { rentalTotal: 500_000, depositTotal: 1_000_000 },
      ]);
      // Refunds in range
      prisma.refund.findMany.mockResolvedValue([
        { amount: 800_000 },
      ]);
      // Penalties in range
      prisma.penalty.findMany.mockResolvedValue([
        { amount: 200_000 },
      ]);
      // Transaction count
      prisma.financialTransaction.count.mockResolvedValue(4);

      const result = await service.getReconciliation({ preset: "today" });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.rentalRevenue).toBe(500_000);
      expect(data.depositReceived).toBe(1_000_000);
      expect(data.refundedDeposit).toBe(800_000);
      expect(data.damageDeduction).toBe(200_000);
      // Net = 500_000 + 1_000_000 - 800_000 = 700_000
      expect(data.netCashFlow).toBe(700_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test: Revenue by Day separates rental and deposit
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Revenue by Day", () => {
    it("should separate rental revenue from deposit per day", async () => {
      prisma.booking.findMany.mockResolvedValue([
        {
          createdAt: new Date("2026-10-01"),
          rentalTotal: 200_000,
          depositTotal: 500_000,
        },
        {
          createdAt: new Date("2026-10-01"),
          rentalTotal: 300_000,
          depositTotal: 500_000,
        },
        {
          createdAt: new Date("2026-10-02"),
          rentalTotal: 150_000,
          depositTotal: 300_000,
        },
      ]);

      const result = await service.getRevenueByDay({ preset: "this_month" });

      expect(result.success).toBe(true);
      const days = result.data as any[];
      expect(days.length).toBeGreaterThanOrEqual(2);

      const day1 = days.find((d: any) => d.date === "2026-10-01");
      expect(day1).toBeDefined();
      expect(day1.rentalRevenue).toBe(500_000);
      expect(day1.depositReceived).toBe(1_000_000);
      // rentalRevenue must NOT include deposit
      expect(day1.rentalRevenue).not.toBe(1_500_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test: mapTransactionType
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Transaction type mapping", () => {
    it("should map refund transaction types correctly", async () => {
      prisma.financialTransaction.findMany.mockResolvedValue([
        {
          id: "tx-1",
          bookingId: "booking-1",
          transactionType: "refund_cash_pending",
          amount: 500_000,
          note: null,
          createdAt: new Date(),
          booking: {
            id: "booking-1",
            customerId: "c-1",
            paymentMethod: "cash",
            customer: { email: "test@t.com", profile: { fullName: "Test" } },
          },
          payment: null,
          refund: { id: "r-1", status: "pending", refund_method: "cash", processed_by: null },
          penalty: null,
        },
      ]);
      prisma.financialTransaction.count.mockResolvedValue(1);

      const result = await service.getTransactions({});

      expect(result.success).toBe(true);
      const items = (result.data as any).items;
      expect(items[0].type).toBe("REFUND");
    });
  });
});
