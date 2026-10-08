import { PaymentStatus, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ensureCancellationRefunds } from "./settlement.helper";

const bookingId = "11111111-1111-4111-8111-111111111111";
const paidId = "22222222-2222-4222-8222-222222222222";

function txMock(overrides: any = {}) {
  const tx: any = {
    booking: { findUnique: vi.fn() },
    refund: { create: vi.fn() },
    financialTransaction: { create: vi.fn() },
  };
  tx.booking.findUnique.mockResolvedValue({
    id: bookingId,
    payments: [{ id: paidId, amount: new Prisma.Decimal(100), status: PaymentStatus.paid, paymentMethod: "qr_code" }],
    refunds: [],
  });
  tx.refund.create.mockImplementation(async ({ data }: any) => ({ id: "refund-1", ...data }));
  return Object.assign(tx, overrides);
}

describe("ensureCancellationRefunds", () => {
  it("creates a bank-transfer manual intent for online money", async () => {
    const tx = txMock();
    const result = await ensureCancellationRefunds(tx, bookingId, "staff-1", "cancelled");
    expect(result.amount.toString()).toBe("100");
    expect(tx.refund.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      paymentId: paidId,
      amount: new Prisma.Decimal(100),
      status: PaymentStatus.pending,
      refund_method: "bank_transfer",
    }) });
    expect(tx.financialTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      transactionType: "refund_cancellation_intent",
      amount: new Prisma.Decimal(0),
      note: "booking_cancellation_full_collected",
    }) });
  });

  it("does not duplicate a pending refund when called again", async () => {
    const tx = txMock();
    tx.booking.findUnique.mockResolvedValue({
      id: bookingId,
      payments: [{ id: paidId, amount: new Prisma.Decimal(100), status: PaymentStatus.paid, paymentMethod: "qr_code" }],
      refunds: [{ id: "existing", paymentId: paidId, amount: new Prisma.Decimal(100), status: PaymentStatus.pending }],
    });
    const result = await ensureCancellationRefunds(tx, bookingId);
    expect(result.created).toBe(false);
    expect(result.amount.toString()).toBe("0");
    expect(tx.refund.create).not.toHaveBeenCalled();
  });

  it("creates separate intents for two paid collections", async () => {
    const tx = txMock();
    tx.booking.findUnique.mockResolvedValue({
      id: bookingId,
      payments: [
        { id: paidId, amount: new Prisma.Decimal(100), status: PaymentStatus.paid, paymentMethod: "qr_code" },
        { id: "paid-2", amount: new Prisma.Decimal(40), status: PaymentStatus.paid, paymentMethod: "qr_code" },
      ],
      refunds: [],
    });
    tx.refund.create.mockImplementation(async ({ data }: any) => ({ id: `refund-${data.paymentId}`, ...data }));
    const result = await ensureCancellationRefunds(tx, bookingId);
    expect(result.refundIds).toEqual(["refund-" + paidId, "refund-paid-2"]);
    expect(tx.refund.create).toHaveBeenCalledTimes(2);
  });
});
