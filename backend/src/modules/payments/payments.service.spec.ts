import { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const payos = vi.hoisted(() => ({
  paymentRequests: {
    create: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
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
  const pendingPayos = ((booking as { payments?: Array<Record<string, unknown>> }).payments ?? [])
    .filter((p) => p.provider === "payos" && p.status === PaymentStatus.pending && p.providerTransactionId)
    .map((p) => ({ id: p.id, providerTransactionId: p.providerTransactionId }));
  const prisma = {
    payment: {
      findMany: vi.fn().mockResolvedValue(pendingPayos),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
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
    depositAmount: new Prisma.Decimal(0),
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
  payos.paymentRequests.get.mockRejectedValue(new Error("Order not found"));
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

  it("creates a new order code after the customer cancelled the previous PayOS link", async () => {
    const cancelledIntent = {
      id: "cancelled-intent",
      provider: "payos",
      providerTransactionId: "100000000001",
      status: PaymentStatus.pending as PaymentStatus,
      amount: new Prisma.Decimal(160),
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    };
    const booking = paymentLinkBooking({ payments: [cancelledIntent] });
    const { service, prisma, tx } = createLinkService(booking);
    payos.paymentRequests.get.mockResolvedValueOnce({ status: "CANCELLED" });
    prisma.payment.updateMany.mockImplementation(async () => {
      cancelledIntent.status = PaymentStatus.cancelled;
      return { count: 1 };
    });

    await service.createPaymentLink(BOOKING_ID, CUSTOMER_ID);

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "cancelled-intent", status: PaymentStatus.pending },
      data: { status: PaymentStatus.cancelled },
    });
    expect(payos.paymentRequests.cancel).not.toHaveBeenCalled();
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    const created = payos.paymentRequests.create.mock.calls.at(-1)![0];
    expect(created.orderCode).not.toBe(100000000001);
  });

  it("cancels a still-open PayOS link before issuing a new one", async () => {
    const openIntent = {
      id: "open-intent",
      provider: "payos",
      providerTransactionId: "100000000001",
      status: PaymentStatus.pending as PaymentStatus,
      amount: new Prisma.Decimal(160),
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    };
    const { service, prisma } = createLinkService(paymentLinkBooking({ payments: [openIntent] }));
    payos.paymentRequests.get.mockResolvedValueOnce({ status: "PENDING" });
    prisma.payment.updateMany.mockImplementation(async () => {
      openIntent.status = PaymentStatus.cancelled;
      return { count: 1 };
    });

    await service.createPaymentLink(BOOKING_ID, CUSTOMER_ID);

    expect(payos.paymentRequests.cancel).toHaveBeenCalledWith(100000000001, expect.any(String));
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: PaymentStatus.cancelled } }));
  });

  it("does not open a second link while PayOS reports the old one as paid", async () => {
    const paidIntent = {
      id: "paid-intent",
      provider: "payos",
      providerTransactionId: "100000000001",
      status: PaymentStatus.pending as PaymentStatus,
      amount: new Prisma.Decimal(160),
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    };
    const { service, prisma } = createLinkService(paymentLinkBooking({ payments: [paidIntent] }));
    payos.paymentRequests.get.mockResolvedValueOnce({ status: "PAID" });

    await expect(service.createPaymentLink(BOOKING_ID, CUSTOMER_ID)).rejects.toThrow("PayOS ghi nhận thanh toán");
    expect(prisma.runSerializable).not.toHaveBeenCalled();
    expect(payos.paymentRequests.create).not.toHaveBeenCalled();
  });

  it("matches the booking amount when a voucher reduced the rental total", async () => {
    // Giá gốc 50/ngày × 2 ngày = 100, voucher giảm 20 → rentalTotal 80.
    const { service } = createLinkService(paymentLinkBooking({ rentalTotal: new Prisma.Decimal(80) }));

    await service.createPaymentLink(BOOKING_ID, CUSTOMER_ID);

    expect(payos.paymentRequests.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 140,
      items: [
        { name: "Áo dài mẫu", quantity: 1, price: 130 },
        { name: "Phí giao hàng", quantity: 1, price: 10 },
      ],
    }));
  });

  it("matches the booking amount with price-rule rounding, accessories and several items", async () => {
    // dailyPrice là giá bình quân đã làm tròn (33.333 → 33.000) nên dailyPrice × ngày
    // không bằng tiền thuê thật; thêm phụ kiện 20.000 gắn vào món thứ nhất.
    const booking = paymentLinkBooking({
      rentalStartDate: new Date("2026-10-10T00:00:00.000Z"),
      rentalEndDate: new Date("2026-10-12T00:00:00.000Z"),
      rentalTotal: new Prisma.Decimal(320_000),
      depositTotal: new Prisma.Decimal(300_000),
      shippingFee: new Prisma.Decimal(0),
      items: [
        { id: "item-1", dailyPrice: new Prisma.Decimal(33_000), depositAmount: new Prisma.Decimal(100_000), garment_sizes: { garments: { name: "Áo dài đỏ" } } },
        { id: "item-2", dailyPrice: new Prisma.Decimal(67_000), depositAmount: new Prisma.Decimal(200_000), garment_sizes: { garments: { name: "Áo nhật bình" } } },
      ],
      accessoryItems: [{ bookingItemId: "item-1", rentalTotal: new Prisma.Decimal(20_000) }],
    });
    const { service } = createLinkService(booking);

    await service.createPaymentLink(BOOKING_ID, CUSTOMER_ID);

    const call = payos.paymentRequests.create.mock.calls.at(-1)![0];
    expect(call.amount).toBe(620_000);
    expect(call.items.map((item: { name: string }) => item.name)).toEqual(["Áo dài đỏ + phụ kiện", "Áo nhật bình"]);
    expect(call.items.reduce((sum: number, item: { price: number }) => sum + item.price, 0)).toBe(620_000);
  });

  it("rejects a booking whose totals are invalid", async () => {
    const { service, tx } = createLinkService(paymentLinkBooking({ rentalTotal: new Prisma.Decimal(-10) }));

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
