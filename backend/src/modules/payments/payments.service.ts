import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { PayOS } from "@payos/node";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly payos: PayOS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.payos = new PayOS({
      clientId: this.config.get<string>("PAYOS_CLIENT_ID") ?? "",
      apiKey: this.config.get<string>("PAYOS_API_KEY") ?? "",
      checksumKey: this.config.get<string>("PAYOS_CHECKSUM_KEY") ?? "",
    });
  }

  async createPaymentLink(bookingId: string, customerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: { include: { garment_sizes: { include: { garments: true } } } } },
    });
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.customerId !== customerId) throw new BadRequestException("Booking does not belong to you.");

    const existingPayment = await this.prisma.payment.findFirst({
      where: { bookingId, status: PaymentStatus.paid },
    });
    if (existingPayment) throw new BadRequestException("Booking is already paid.");

    await this.prisma.payment.updateMany({
      where: { bookingId, provider: "payos", status: PaymentStatus.pending },
      data: { status: PaymentStatus.cancelled },
    });

    const shippingFee = Number(booking.shippingFee ?? 0);
    const totalAmount = Number(booking.rentalTotal) + Number(booking.depositTotal) + shippingFee;
    const orderCode = Date.now();

    const frontendUrl = this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";

    const days = Math.round(
      (new Date(booking.rentalEndDate).getTime() - new Date(booking.rentalStartDate).getTime()) / 86400000,
    ) + 1;

    const items = booking.items.map((item) => ({
      name: item.garment_sizes?.garments?.name ?? "Trang phục",
      quantity: 1,
      price: Math.round(Number(item.dailyPrice) * days + Number(item.depositAmount)),
    }));
    if (shippingFee > 0) {
      items.push({ name: "Phí giao hàng", quantity: 1, price: Math.round(shippingFee) });
    }

    const paymentLinkRes = await this.payos.paymentRequests.create({
      orderCode,
      amount: Math.round(totalAmount),
      description: `Thue trang phuc #${bookingId.slice(0, 8)}`,
      cancelUrl: `${frontendUrl}/booking/payment?bookingId=${bookingId}&cancelled=1`,
      returnUrl: `${frontendUrl}/booking/payment?bookingId=${bookingId}`,
      items,
    });

    await this.prisma.payment.create({
      data: {
        bookingId,
        provider: "payos",
        providerTransactionId: String(orderCode),
        paymentMethod: "qr_code",
        amount: totalAmount,
        depositAmount: Number(booking.depositTotal),
        status: PaymentStatus.pending,
      },
    });

    return ok({
      checkoutUrl: paymentLinkRes.checkoutUrl,
      qrCode: paymentLinkRes.qrCode,
      orderCode,
      amount: Math.round(totalAmount),
    });
  }

  async handleWebhook(body: any) {
    this.logger.log(`PayOS webhook received: ${JSON.stringify(body)}`);

    // PayOS sends a confirmation ping when registering the webhook URL
    if (body?.code === "00" && body?.data?.orderCode === 123) {
      this.logger.log("PayOS webhook confirmation ping — acknowledged");
      return ok({ message: "Webhook confirmed." });
    }

    let webhookData: any;
    try {
      webhookData = await this.payos.webhooks.verify(body);
    } catch {
      this.logger.warn("Invalid PayOS webhook signature");
      return ok({ message: "Invalid signature, ignored." });
    }

    if (body?.code !== "00") {
      this.logger.log(`Webhook code is not 00: ${body?.code}`);
      return ok({ message: "Non-success webhook, ignored." });
    }

    const orderCode = String(webhookData.orderCode);
    const payment = await this.prisma.payment.findFirst({
      where: { providerTransactionId: orderCode, provider: "payos" },
      include: { booking: true },
    });

    if (!payment) {
      this.logger.warn(`No payment found for orderCode ${orderCode}`);
      return ok({ message: "No matching payment." });
    }

    if (payment.status === PaymentStatus.paid) {
      return ok({ message: "Already processed." });
    }

    await this.markAsPaid(payment.id, payment.bookingId, payment.booking.status, "Thanh toán qua PayOS thành công");

    this.logger.log(`Payment ${payment.id} marked as paid via PayOS webhook`);
    return ok({ message: "Payment processed successfully." });
  }

  async getPaymentStatus(bookingId: string) {
    let payment = await this.prisma.payment.findFirst({
      where: { bookingId, provider: "payos" },
      orderBy: { createdAt: "desc" },
      include: { booking: true },
    });

    if (!payment) {
      return ok({ status: "none", paid: false });
    }

    // Webhooks cannot reach a local dev server, so when the payment is still
    // pending we reconcile against PayOS directly before answering the poll.
    if (payment.status === PaymentStatus.pending) {
      payment = await this.reconcileWithPayos(payment);
    }

    return ok({
      status: payment.status,
      paid: payment.status === PaymentStatus.paid,
      paidAt: payment.paidAt,
      orderCode: payment.providerTransactionId,
    });
  }

  private async reconcileWithPayos<T extends { id: string; bookingId: string; providerTransactionId: string | null; booking: { status: BookingStatus } }>(
    payment: T & { status: PaymentStatus; paidAt: Date | null },
  ) {
    if (!payment.providerTransactionId) return payment;

    try {
      const info = await this.payos.paymentRequests.get(Number(payment.providerTransactionId));

      if (info.status === "PAID") {
        await this.markAsPaid(payment.id, payment.bookingId, payment.booking.status, "Thanh toán qua PayOS thành công (đối soát trực tiếp)");
        return { ...payment, status: PaymentStatus.paid, paidAt: new Date() };
      }

      if (info.status === "CANCELLED") {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.cancelled },
        });
        return { ...payment, status: PaymentStatus.cancelled };
      }

      if (info.status === "EXPIRED") {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.failed },
        });
        return { ...payment, status: PaymentStatus.failed };
      }
    } catch (error) {
      this.logger.warn(`Could not reconcile payment ${payment.id} with PayOS: ${error instanceof Error ? error.message : error}`);
    }

    return payment;
  }

  private async markAsPaid(paymentId: string, bookingId: string, fromStatus: BookingStatus, note: string) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.paid, paidAt: new Date() },
      });
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.pending_confirmation, paymentDueAt: null },
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus,
          toStatus: BookingStatus.pending_confirmation,
          note,
        },
      });

      const rentalAmount = Number(payment.amount) - Number(payment.depositAmount);
      const depositAmount = Number(payment.depositAmount);

      if (rentalAmount > 0) {
        await tx.financialTransaction.create({
          data: {
            bookingId,
            paymentId: payment.id,
            transactionType: "payment",
            amount: rentalAmount,
            note: "Thanh toán tiền thuê",
          },
        });
      }

      if (depositAmount > 0) {
        await tx.financialTransaction.create({
          data: {
            bookingId,
            paymentId: payment.id,
            transactionType: "deposit",
            amount: depositAmount,
            note: "Thanh toán tiền cọc",
          },
        });
      }
    });
  }
}
