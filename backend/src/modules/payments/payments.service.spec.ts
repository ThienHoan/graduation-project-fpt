import { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const payos = vi.hoisted(() => ({
  paymentRequests: {
    create: vi.fn(),
    get: vi.fn(),
  },
  webhooks: {
    verify: vi.fn(),
  },
}));

vi.mock("@payos/node", () => ({
  PayOS: class {
    paymentRequests = payos.paymentRequests;
    webhooks = payos.webhooks;
  },
}));

import { PaymentsService } from "./payments.service";

const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
const ORDER_CODE = 100000000000;

function paymentLinkBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    status: BookingStatus.awaiting_payment,
    rentalStartDate: new Date("2026-10-10T00:00:00.000Z"),
    rentalEndDate: new Date("2026-10-11T00:00:00.000Z"),
    rentalTotal: new Prisma.Decimal(100),
    depositTotal: new Prisma.Decimal(50),
    shippingFee: new Prisma.Decimal(10),
    items: [{
      dailyPrice: new Prisma.Decimal(50),
      depositAmount: new Prisma.Decimal(50),
      garment_sizes: { garments: { name: "Áo dài mẫu" } },
    }],
    payments: [],
    ...overrides,
  };
}

function config() {
  const values: Record<string, string> = {
    PAYOS_CLIENT_ID: "client",
    PAYOS_API_KEY: "api-key",
    PAYOS_CHECKSUM_KEY: "checksum",
    FRONTEND_URL: "https://frontend.example",
  };
  return { get: vi.fn((key: string) => values[key]) };
}

function createLinkService(booking = paymentLinkBooking()) {
  const tx = {
    $queryRawUnsafe: vi.fn().mockResolvedValue(undefined),
    booking: { findUnique: vi.fn().mockResolvedValue(booking) },
    payment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "payment-1" }),
    },
  };
  const prisma = {
    runSerializable: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
  };
  return { service: new PaymentsService(prisma as never, config() as never), prisma, tx };
}

function webhookService(options?: { bookingStatus?: BookingStatus; paymentStatus?: PaymentStatus; claimed?: number }) {
  const current = {
    id: "payment-1",
    bookingId: BOOKING_ID,
    provider: "payos",
    providerTransactionId: String(ORDER_CODE),
    paymentMethod: "qr_code",
    amount: new Prisma.Decimal(160),
    status: options?.paymentStatus ?? PaymentStatus.pending,
    paidAt: null,
    booking: { id: BOOKING_ID, status: options?.bookingStatus ?? BookingStatus.awaiting_payment },
  };
  const tx = {
    $queryRawUnsafe: vi.fn().mockResolvedValue(undefined),
    payment: {
      findUnique: vi.fn().mockResolvedValue(current),
      updateMany: vi.fn().mockResolvedValue({ count: options?.claimed ?? 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...current, status: PaymentStatus.paid }),
    },
    financialTransaction: { create: vi.fn().mockResolvedValue({ id: "transaction-1" }) },
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    bookingStatusHistory: { create: vi.fn().mockResolvedValue({ id: "history-1" }) },
  };
  const prisma = {
    payment: { findMany: vi.fn().mockResolvedValue([current]) },
    runSerializable: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
  };
  return { service: new PaymentsService(prisma as never, config() as never), prisma, tx, current };
}

beforeEach(() => {
  vi.clearAllMocks();
  payos.paymentRequests.create.mockResolvedValue({
    checkoutUrl: "https://pay.example/checkout",
    qrCode: "qr-code",
  });
  payos.webhooks.verify.mockResolvedValue({ orderCode: ORDER_CODE, amount: 160, currency: "VND" });
});

describe("PaymentsService.createPaymentLink", () => {
  it("creates a durable intent with the full amount before requesting PayOS", async () => {
    const { service, prisma, tx } = createLinkService();

    const result = await service.createPaymentLink(BOOKING_ID, CUSTOMER_ID);

    expect(prisma.runSerializable).toHaveBeenCalledTimes(1);
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        provider: "payos",
        paymentMethod: "qr_code",
        amount: new Prisma.Decimal(160),
        depositAmount: new Prisma.Decimal(50),
        status: PaymentStatus.pending,
      }),
    });
    expect(tx.payment.create.mock.invocationCallOrder[0]).toBeLessThan(payos.paymentRequests.create.mock.invocationCallOrder[0]);
    expect(payos.paymentRequests.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 160,
      items: [
        { name: "Áo dài mẫu", quantity: 1, price: 150 },
        { name: "Phí giao hàng", quantity: 1, price: 10 },
      ],
    }));
    expect(result.data).toEqual(expect.objectContaining({ amount: 160, checkoutUrl: "https://pay.example/checkout" }));
  });

  it("reuses the newest matching pending intent", async () => {
    const older = {
      id: "older",
      provider: "payos",
      providerTransactionId: "100000000001",
      status: PaymentStatus.pending,
      amount: new Prisma.Decimal(160),
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    };
    const newest = {
      ...older,
      id: "newest",
      providerTransactionId: "100000000002",
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
    };
    const { service, tx } = createLinkService(paymentLinkBooking({ payments: [older, newest] }));

    await service.createPaymentLink(BOOKING_ID, CUSTOMER_ID);

    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(payos.paymentRequests.create).toHaveBeenCalledWith(expect.objectContaining({ orderCode: 100000000002 }));
  });

  it("rejects a PayOS item total that differs from the booking amount", async () => {
    const { service, tx } = createLinkService(paymentLinkBooking({ rentalTotal: new Prisma.Decimal(110) }));

    await expect(service.createPaymentLink(BOOKING_ID, CUSTOMER_ID)).rejects.toThrow(
      "Chi tiết thanh toán không khớp tổng tiền đơn hàng.",
    );

    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(payos.paymentRequests.create).not.toHaveBeenCalled();
  });
});

describe("PaymentsService.handleWebhook", () => {
  it("ignores invalid signatures without reading payments", async () => {
    const { service, prisma } = webhookService();
    payos.webhooks.verify.mockRejectedValue(new Error("invalid signature"));

    const result = await service.handleWebhook({ code: "00" });

    expect(result.data).toEqual({ message: "Invalid signature, ignored." });
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it("moves an awaiting-payment booking to paid and records collection once", async () => {
    const { service, tx } = webhookService();

    await service.handleWebhook({ code: "00", data: { amount: 160, currency: "VND" } });

    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "payment-1", status: PaymentStatus.pending },
      data: expect.objectContaining({ status: PaymentStatus.paid }),
    }));
    expect(tx.financialTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: BookingStatus.awaiting_payment },
      data: { status: BookingStatus.paid, paymentDueAt: null },
    });
    expect(tx.bookingStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        fromStatus: BookingStatus.awaiting_payment,
        toStatus: BookingStatus.paid,
      }),
    });
  });

  it("moves a confirmed booking directly to paid", async () => {
    const { service, tx } = webhookService({ bookingStatus: BookingStatus.confirmed });

    await service.handleWebhook({ code: "00", data: { amount: 160, currency: "VND" } });

    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, status: BookingStatus.confirmed },
      data: { status: BookingStatus.paid, paymentDueAt: null },
    });
  });

  it("is idempotent when the payment is already paid", async () => {
    const { service, tx } = webhookService({ paymentStatus: PaymentStatus.paid });

    await service.handleWebhook({ code: "00", data: { amount: 160, currency: "VND" } });

    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.financialTransaction.create).not.toHaveBeenCalled();
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.bookingStatusHistory.create).not.toHaveBeenCalled();
  });

  it("rejects a mismatched amount before changing state", async () => {
    const { service, prisma } = webhookService();
    payos.webhooks.verify.mockResolvedValue({ orderCode: ORDER_CODE, amount: 159, currency: "VND" });

    const result = await service.handleWebhook({ code: "00" });

    expect(result.data).toEqual({ message: "Payment amount mismatch." });
    expect(prisma.runSerializable).not.toHaveBeenCalled();
  });
});
