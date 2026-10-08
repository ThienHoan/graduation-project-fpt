import { PaymentStatus, Prisma } from "@prisma/client";

/**
 * Finance-only cancellation settlement. The caller owns the surrounding
 * serializable transaction and is responsible for booking status and assets.
 * No provider calls are made here; every returned refund is a manual intent.
 */
export type SettlementRefundResult = {
  bookingId: string;
  amount: Prisma.Decimal;
  refundIds: string[];
  created: boolean;
};

const COVERING_REFUND_STATUSES: PaymentStatus[] = [
  PaymentStatus.pending,
  PaymentStatus.refunding,
  PaymentStatus.refunded,
  PaymentStatus.partially_refunded,
];

export async function ensureCancellationRefunds(
  tx: Prisma.TransactionClient,
  bookingId: string,
  actorId?: string,
  reason?: string,
): Promise<SettlementRefundResult> {
  // Lock the booking row when PostgreSQL is available. This serializes
  // cancellation/reconciliation callers without an in-memory process lock.
  if (typeof (tx as any).$queryRawUnsafe === "function") {
    await (tx as any).$queryRawUnsafe("SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE", bookingId);
  }
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      payments: { select: { id: true, amount: true, status: true, paymentMethod: true }, orderBy: { createdAt: "asc" } },
      refunds: {
        select: { id: true, paymentId: true, amount: true, status: true },
        where: { status: { in: COVERING_REFUND_STATUSES } },
      },
    },
  });

  if (!booking) {
    throw new Error("Booking not found while creating cancellation settlement.");
  }

  const paidPayments = booking.payments.filter((payment) => payment.status === PaymentStatus.paid);
  let unlinkedCovered = booking.refunds
    .filter((refund) => refund.paymentId === null)
    .reduce((sum, refund) => sum.plus(refund.amount), new Prisma.Decimal(0));
  const refundIds: string[] = [];
  let amount = new Prisma.Decimal(0);

  // Allocate legacy/aggregate refunds conservatively to the oldest paid
  // payment, then create distinct intents for every uncovered payment. This
  // keeps a second payment visible and independently refundable.
  for (const payment of paidPayments) {
    const linkedCovered = booking.refunds
      .filter((refund) => refund.paymentId === payment.id)
      .reduce((sum, refund) => sum.plus(refund.amount), new Prisma.Decimal(0));
    const paymentAmount = new Prisma.Decimal(payment.amount);
    const remainingBeforeUnlinked = Prisma.Decimal.max(new Prisma.Decimal(0), paymentAmount.minus(linkedCovered));
    const legacyAllocation = Prisma.Decimal.min(remainingBeforeUnlinked, unlinkedCovered);
    unlinkedCovered = unlinkedCovered.minus(legacyAllocation);
    const uncovered = remainingBeforeUnlinked.minus(legacyAllocation);
    if (uncovered.lte(0)) continue;

    const refund = await tx.refund.create({
      data: {
        bookingId,
        paymentId: payment.id,
        amount: uncovered,
        status: PaymentStatus.pending,
        // Online collections need manager-confirmed bank settlement. Cash
        // remains cash only for genuinely cash-collected payments.
        refund_method: payment.paymentMethod === "cash" ? "cash" : "bank_transfer",
        reason: reason?.trim() || "Hoàn toàn bộ tiền đã thực thu do hủy đơn.",
        processed_by: actorId ?? null,
      },
    });
    await tx.financialTransaction.create({
      data: {
        bookingId,
        paymentId: payment.id,
        refundId: refund.id,
        transactionType: "refund_cancellation_intent",
        amount: new Prisma.Decimal(0),
        note: "booking_cancellation_full_collected",
      },
    });
    refundIds.push(refund.id);
    amount = amount.plus(uncovered);
  }

  return { bookingId, amount, refundIds, created: refundIds.length > 0 };
}
