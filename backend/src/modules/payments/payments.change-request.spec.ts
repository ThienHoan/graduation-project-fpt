import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { PaymentStatus, Prisma } from "@prisma/client";
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
const REQUEST_ID = "00000000-0000-4000-8000-0000000000aa";
const USER = { id: CUSTOMER_ID, role: "customer" } as const;

function config() {
  const values: Record<string, string> = {
    PAYOS_CLIENT_ID: "client",
    PAYOS_API_KEY: "api-key",
    PAYOS_CHECKSUM_KEY: "checksum",
    FRONTEND_URL: "https://frontend.example",
  };
  return { get: vi.fn((key: string) => values[key]) };
}

function linkService() {
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    payment: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "payment-1" }),
    },
  };
  const prisma = {
    runSerializable: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return { service: new PaymentsService(prisma as never, config() as never), prisma, tx };
}

function afterPaymentService(changeRequests: Record<string, unknown>) {
  const prisma = {
    payment: { findUnique: vi.fn().mockResolvedValue({ bookingId: BOOKING_ID }) },
  };
  const service = new PaymentsService(
    prisma as never,
    config() as never,
    undefined,
    undefined,
    undefined,
    changeRequests as never,
  );
  return { service };
}

beforeEach(() => {
  vi.clearAllMocks();
  payos.paymentRequests.create.mockResolvedValue({
    checkoutUrl: "https://pay.example/change-request",
    qrCode: "qr-code",
  });
});

describe("PaymentsService.createChangeRequestPaymentLink — PayOS bổ sung (§7.3/§12)", () => {
  it("tạo Payment intent đúng charge + depositDelta, rồi mới gọi PayOS", async () => {
    const { service, prisma, tx } = linkService();

    const result = await service.createChangeRequestPaymentLink({
      bookingId: BOOKING_ID,
      requestId: REQUEST_ID,
      amount: 100_000,
      depositAmount: 50_000,
      expiresAt: new Date("2026-11-10T10:00:00.000Z"),
    });

    expect(prisma.runSerializable).toHaveBeenCalledTimes(1);
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        provider: "payos",
        paymentMethod: "qr_code",
        amount: 100_000,
        depositAmount: 50_000,
        status: PaymentStatus.pending,
      }),
    });
    expect(payos.paymentRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100_000,
        returnUrl: `https://frontend.example/booking/change-payment?requestId=${REQUEST_ID}&bookingId=${BOOKING_ID}`,
        cancelUrl: `https://frontend.example/booking/change-payment?requestId=${REQUEST_ID}&bookingId=${BOOKING_ID}&cancelled=1`,
        expiredAt: Math.floor(new Date("2026-11-10T10:00:00.000Z").getTime() / 1000),
      }),
    );
    expect(result).toEqual({
      paymentId: "payment-1",
      checkoutUrl: "https://pay.example/change-request",
    });
  });

  it("PayOS lỗi → đóng intent `cancelled` và ném 400 (request vẫn quoted)", async () => {
    const { service, prisma } = linkService();
    payos.paymentRequests.create.mockRejectedValueOnce(new Error("payos down"));

    await expect(
      service.createChangeRequestPaymentLink({
        bookingId: BOOKING_ID,
        requestId: REQUEST_ID,
        amount: 100_000,
        depositAmount: 0,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "payment-1", status: PaymentStatus.pending },
      data: { status: PaymentStatus.cancelled },
    });
  });
});

describe("PaymentsService.afterPaymentPaid — dispatch change requests", () => {
  type AfterPayment = { afterPaymentPaid(paymentId: string): Promise<void> };

  it("gọi handlePaymentPaid cho mọi payment đã paid (idempotent phía service)", async () => {
    const changeRequests = { handlePaymentPaid: vi.fn().mockResolvedValue({ data: { applied: true } }) };
    const { service } = afterPaymentService(changeRequests);

    await (service as unknown as AfterPayment).afterPaymentPaid("pay-charge");

    expect(changeRequests.handlePaymentPaid).toHaveBeenCalledWith("pay-charge");
  });

  it("lỗi áp dụng đổi mẫu không làm hỏng webhook (nuốt lỗi, chỉ log)", async () => {
    const changeRequests = { handlePaymentPaid: vi.fn().mockRejectedValue(new Error("boom")) };
    const { service } = afterPaymentService(changeRequests);

    await expect(
      (service as unknown as AfterPayment).afterPaymentPaid("pay-charge"),
    ).resolves.toBeUndefined();
    expect(changeRequests.handlePaymentPaid).toHaveBeenCalled();
  });
});

describe("PaymentsService.getChangeRequestStatus — poll §13.2", () => {
  function statusService(request: Record<string, unknown> | null) {
    const prisma = {
      bookingChangeRequest: { findUnique: vi.fn().mockResolvedValue(request) },
    };
    return new PaymentsService(prisma as never, config() as never);
  }

  it("trả trạng thái request + paid + countdown cho chủ đơn", async () => {    const service = statusService({
      id: REQUEST_ID,
      bookingId: BOOKING_ID,
      status: "awaiting_payment",
      chargeAmount: new Prisma.Decimal(100_000),
      checkoutUrl: "https://pay.example/change-request",
      holdExpiresAt: new Date(Date.now() + 60_000),
      payment: { status: PaymentStatus.paid, providerTransactionId: "123" },
      booking: { customerId: CUSTOMER_ID },
    });

    const result = await service.getChangeRequestStatus(REQUEST_ID, USER as never);

    expect(result.data).toEqual(
      expect.objectContaining({
        requestId: REQUEST_ID,
        status: "awaiting_payment",
        paid: true,
        chargeAmount: 100_000,
        checkoutUrl: "https://pay.example/change-request",
      }),
    );
    expect((result.data as { countdownSeconds: number }).countdownSeconds).toBeGreaterThan(0);
  });

  it("khách không sở hữu request → 403", async () => {
    const service = statusService({
      id: REQUEST_ID,
      bookingId: BOOKING_ID,
      status: "awaiting_payment",
      chargeAmount: new Prisma.Decimal(100_000),
      checkoutUrl: null,
      holdExpiresAt: new Date(Date.now() + 60_000),
      payment: null,
      booking: { customerId: "someone-else" },
    });

    await expect(service.getChangeRequestStatus(REQUEST_ID, USER as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("PaymentsService.retryChangeRequestPayment — thanh toán lại sau khi huỷ PayOS", () => {
  function retryService(options: {
    request?: Record<string, unknown> | null;
    payosStatus?: "PENDING" | "CANCELLED" | "EXPIRED" | "PAID" | "PROCESSING";
  } = {}) {
    const request =
      options.request === undefined
        ? {
            id: REQUEST_ID,
            bookingId: BOOKING_ID,
            status: "awaiting_payment",
            chargeAmount: new Prisma.Decimal(100_000),
            afterSnapshot: { chargeAmount: 100_000, depositDelta: 0 },
            holdExpiresAt: new Date(Date.now() + 5 * 60_000),
            checkoutUrl: "https://pay.example/old-link",
            paymentId: "payment-old",
            payment: {
              id: "payment-old",
              bookingId: BOOKING_ID,
              status: PaymentStatus.pending,
              providerTransactionId: "555",
            },
            booking: { customerId: CUSTOMER_ID },
          }
        : options.request;
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
      payment: {
        findMany: vi.fn().mockResolvedValue([{ providerTransactionId: "555" }]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "payment-new" }),
      },
    };
    const prisma = {
      bookingChangeRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue({}),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      runSerializable: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    };
    const service = new PaymentsService(prisma as never, config() as never);
    payos.paymentRequests.get.mockImplementation(async () => ({ status: options.payosStatus ?? "CANCELLED" }));
    return { service, prisma, tx };
  }

  it("PayOS đã huỷ link cũ → tạo orderCode/link MỚI và gắn vào yêu cầu", async () => {
    const { service, prisma } = retryService({ payosStatus: "CANCELLED" });

    const result = await service.retryChangeRequestPayment(REQUEST_ID, USER as never);

    expect(payos.paymentRequests.create).toHaveBeenCalledTimes(1);
    expect(prisma.bookingChangeRequest.update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: expect.objectContaining({
        status: "awaiting_payment",
        paymentId: "payment-new",
        checkoutUrl: "https://pay.example/change-request",
      }),
    });
    expect(result.data).toEqual(
      expect.objectContaining({
        requestId: REQUEST_ID,
        status: "awaiting_payment",
        checkoutUrl: "https://pay.example/change-request",
        chargeAmount: 100_000,
      }),
    );
  });

  it("link cũ vẫn PENDING ở PayOS → dùng lại, KHÔNG mở QR thứ hai", async () => {
    const { service, prisma } = retryService({ payosStatus: "PENDING" });

    const result = await service.retryChangeRequestPayment(REQUEST_ID, USER as never);

    expect(payos.paymentRequests.create).not.toHaveBeenCalled();
    expect(prisma.bookingChangeRequest.update).not.toHaveBeenCalled();
    expect((result.data as { checkoutUrl: string }).checkoutUrl).toBe("https://pay.example/old-link");
  });

  it("giữ chỗ đã hết hạn → 409, không tạo link", async () => {
    const { service } = retryService({
      request: {
        id: REQUEST_ID,
        bookingId: BOOKING_ID,
        status: "awaiting_payment",
        chargeAmount: new Prisma.Decimal(100_000),
        afterSnapshot: { depositDelta: 0 },
        holdExpiresAt: new Date(Date.now() - 1_000),
        checkoutUrl: "https://pay.example/old-link",
        paymentId: null,
        payment: null,
        booking: { customerId: CUSTOMER_ID },
      },
    });

    await expect(service.retryChangeRequestPayment(REQUEST_ID, USER as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(payos.paymentRequests.create).not.toHaveBeenCalled();
  });

  it("khách không sở hữu yêu cầu → 403", async () => {
    const { service } = retryService({
      request: {
        id: REQUEST_ID,
        bookingId: BOOKING_ID,
        status: "awaiting_payment",
        chargeAmount: new Prisma.Decimal(100_000),
        afterSnapshot: { depositDelta: 0 },
        holdExpiresAt: new Date(Date.now() + 60_000),
        checkoutUrl: null,
        paymentId: null,
        payment: null,
        booking: { customerId: "someone-else" },
      },
    });

    await expect(service.retryChangeRequestPayment(REQUEST_ID, USER as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
