import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { PayOS } from "@payos/node";
import { ok } from "../../common/api-response";
import { ensureCancellationRefunds } from "../../common/settlement/settlement.helper";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";

const PAYMENTABLE_STATUSES: BookingStatus[] = [
  BookingStatus.pending_confirmation,
  BookingStatus.awaiting_payment,
  BookingStatus.confirmed,
];

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

  /** Creates/reuses a durable intent before making any provider request. */
  async createPaymentLink(bookingId: string, customerId: string) {
    const intent = await this.prisma.runSerializable(async (tx) => {
      // Serialize intents per booking at the database level; this survives
      // multiple app processes and does not rely on an in-memory mutex.
      if (typeof (tx as any).$queryRawUnsafe === "function") {
        await (tx as any).$queryRawUnsafe("SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE", bookingId);
        // Order codes are global in PayOS. A transaction-scoped advisory lock
        // closes the check-then-insert gap between different bookings without
        // requiring a schema migration or an in-memory process lock.
        if (typeof (tx as any).$executeRawUnsafe === "function") {
          await (tx as any).$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('payments:payos-order-code'))");
        }
      }
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          items: { include: { garment_sizes: { include: { garments: true } } } },
          accessoryItems: { select: { bookingItemId: true, rentalTotal: true } },
          payments: true,
        },
      });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (booking.customerId !== customerId) throw new ForbiddenException("Booking does not belong to you.");
      if (!PAYMENTABLE_STATUSES.includes(booking.status)) {
        throw new BadRequestException("Booking is not awaiting payment.");
      }

      const amount = new Prisma.Decimal(booking.rentalTotal)
        .plus(booking.depositTotal)
        .plus(booking.shippingFee);
      if (amount.lte(0)) throw new BadRequestException("Booking has no payable amount.");

      const existing = booking.payments
        .filter((payment) => payment.provider === "payos" && payment.status === PaymentStatus.pending && payment.providerTransactionId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (existing && new Prisma.Decimal(existing.amount).equals(amount)) {
        return {
          bookingId,
          paymentId: existing.id,
          orderCode: Number(existing.providerTransactionId),
          amount: Math.round(amount.toNumber()),
          items: this.buildItems(booking, amount),
        };
      }

      // The deterministic value is stable for every process/retry and is
      // checked against existing rows before insert. No provider call occurs
      // in this transaction callback.
      let orderCode = this.allocateOrderCode(bookingId, booking.payments.map((p) => p.providerTransactionId));
      while (await tx.payment.findFirst({ where: { provider: "payos", providerTransactionId: String(orderCode) }, select: { id: true } })) {
        orderCode += 1;
      }
      const payment = await tx.payment.create({
        data: {
          bookingId,
          provider: "payos",
          providerTransactionId: String(orderCode),
          paymentMethod: "qr_code",
          amount,
          depositAmount: booking.depositTotal,
          status: PaymentStatus.pending,
        },
      });
      return {
        bookingId,
        paymentId: payment.id,
        orderCode,
        amount: Math.round(amount.toNumber()),
        items: this.buildItems(booking, amount),
      };
    });

    const frontendUrl = this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
    try {
      const paymentLinkRes = await this.payos.paymentRequests.create({
        orderCode: intent.orderCode,
        amount: intent.amount,
        description: `Thue trang phuc #${intent.bookingId.slice(0, 8)}`,
        cancelUrl: `${frontendUrl}/booking/payment?bookingId=${intent.bookingId}&cancelled=1`,
        returnUrl: `${frontendUrl}/booking/payment?bookingId=${intent.bookingId}`,
        items: intent.items,
      });
      return ok({
        checkoutUrl: paymentLinkRes.checkoutUrl,
        qrCode: paymentLinkRes.qrCode,
        orderCode: intent.orderCode,
        amount: intent.amount,
      });
    } catch (error) {
      // A timeout does not mean PayOS did not create the order. Probe the same
      // stable order code; callers can retry without creating another intent.
      try {
        const existing = await this.payos.paymentRequests.get(intent.orderCode);
        if (existing?.status === "PENDING") {
          throw new BadRequestException("Liên kết thanh toán đang được PayOS xử lý. Vui lòng thử lại sau.");
        }
      } catch (probeError) {
        this.logger.warn(`PayOS intent ${intent.orderCode} is unresolved: ${this.errorMessage(probeError)}`);
      }
      this.logger.warn(`PayOS create failed for intent ${intent.paymentId}: ${this.errorMessage(error)}`);
      throw new BadRequestException("Không thể tạo liên kết thanh toán. Vui lòng thử lại.");
    }
  }

  async handleWebhook(body: any) {
    let webhookData: any;
    try {
      webhookData = await this.payos.webhooks.verify(body);
    } catch {
      this.logger.warn("Invalid PayOS webhook signature");
      return ok({ message: "Invalid signature, ignored." });
    }
    if (body?.code !== "00") return ok({ message: "Non-success webhook, ignored." });

    const orderCode = String(webhookData.orderCode);
    const currency = String(webhookData.currency ?? body?.data?.currency ?? "VND").toUpperCase();
    if (currency !== "VND") return ok({ message: "Payment currency mismatch." });
    const matches = await this.prisma.payment.findMany({
      where: { provider: "payos", providerTransactionId: orderCode },
      include: { booking: true },
    });
    if (matches.length !== 1) return ok({ message: matches.length ? "Ambiguous payment intent." : "No matching payment." });
    const payment = matches[0];
    const providerAmount = Number(webhookData.amount ?? body?.data?.amount);
    if (!Number.isFinite(providerAmount) || Math.round(providerAmount) !== Math.round(Number(payment.amount))) {
      return ok({ message: "Payment amount mismatch." });
    }
    await this.markAsPaid(payment.id, payment.bookingId, "Thanh toán qua PayOS thành công");
    return ok({ message: "Payment processed successfully." });
  }

  async getPaymentStatus(bookingId: string, user: AuthenticatedUser) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { customerId: true } });
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.customerId !== user.id && !["staff", "manager_owner", "admin"].includes(user.role)) {
      throw new ForbiddenException("You cannot view this payment.");
    }
    let payment = await this.prisma.payment.findFirst({
      where: { bookingId, provider: "payos" },
      orderBy: { createdAt: "desc" },
      include: { booking: true },
    });
    if (!payment) return ok({ status: "none", paid: false });
    if (payment.status === PaymentStatus.pending && payment.providerTransactionId) {
      payment = await this.reconcileWithPayos(payment);
    }
    if (!payment) return ok({ status: "none", paid: false });
    return ok({ status: payment.status, paid: payment.status === PaymentStatus.paid, paidAt: payment.paidAt, orderCode: payment.providerTransactionId });
  }

  private async reconcileWithPayos(payment: any): Promise<any> {
    if (!payment.providerTransactionId) return payment;
    try {
      const info = await this.payos.paymentRequests.get(Number(payment.providerTransactionId));
      if (info.status === "PAID") {
        if (Number(info.amount ?? payment.amount) !== Number(payment.amount)) return payment;
        await this.markAsPaid(payment.id, payment.bookingId, "Thanh toán qua PayOS thành công (đối soát trực tiếp)");
        return { ...payment, status: PaymentStatus.paid, paidAt: new Date() };
      }
      if (info.status === "CANCELLED" || info.status === "EXPIRED") {
        const status = info.status === "CANCELLED" ? PaymentStatus.cancelled : PaymentStatus.failed;
        await this.prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.pending }, data: { status } });
        return { ...payment, status };
      }
    } catch (error) {
      this.logger.warn(`Could not reconcile payment ${payment.id}: ${this.errorMessage(error)}`);
    }
    return payment;
  }

  private async markAsPaid(paymentId: string, bookingId: string, note: string) {
    return this.prisma.runSerializable(async (tx) => {
      // Lock the booking before reading its status. A callback racing a
      // cancellation must observe the final state and never reopen the order.
      if (typeof (tx as any).$queryRawUnsafe === "function") {
        await (tx as any).$queryRawUnsafe("SELECT id FROM bookings WHERE id = $1::uuid FOR UPDATE", bookingId);
      }
      const current = await tx.payment.findUnique({ where: { id: paymentId }, include: { booking: true } });
      if (!current) throw new NotFoundException("Payment not found.");
      if (current.status === PaymentStatus.paid || current.status === PaymentStatus.refunding) return current;
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: PaymentStatus.pending },
        data: { status: PaymentStatus.paid, paidAt: new Date() },
      });
      if (claimed.count !== 1) return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

      // Record every successful collection, including a late collection after
      // cancellation. The cancellation settlement then creates a separate
      // refund intent for this payment; it is never silently discarded.
      const rentalAmount = new Prisma.Decimal(current.amount).minus(current.depositAmount);
      const depositAmount = new Prisma.Decimal(current.depositAmount);
      if (rentalAmount.gt(0)) {
        await tx.financialTransaction.create({ data: { bookingId, paymentId, transactionType: "payment", amount: rentalAmount, note: "Thanh toán qua PayOS thành công (tiền thuê)" } });
      }
      if (depositAmount.gt(0)) {
        await tx.financialTransaction.create({ data: { bookingId, paymentId, transactionType: "deposit", amount: depositAmount, note: "Thanh toán qua PayOS thành công (tiền cọc)" } });
      }
      if (current.booking.status === BookingStatus.cancelled || current.booking.status === BookingStatus.rejected) {
        await ensureCancellationRefunds(tx, bookingId, undefined, "Thanh toán đến trễ sau khi đơn đã hủy.");
        return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      }
      const nextStatus = current.booking.status === BookingStatus.confirmed ||
        current.booking.status === BookingStatus.awaiting_payment ||
        current.booking.status === BookingStatus.pending_confirmation
        ? BookingStatus.paid
        : current.booking.status;
      if (nextStatus !== current.booking.status) {
        await tx.booking.updateMany({
          where: { id: bookingId, status: current.booking.status },
          data: { status: nextStatus, paymentDueAt: null },
        });
        await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: current.booking.status, toStatus: nextStatus, note } });
      }
      return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    });
  }

  /**
   * Dựng danh sách dòng gửi PayOS từ TỔNG TIỀN CHUẨN của đơn (rentalTotal đã gồm
   * luật giá tự động + phụ kiện − voucher, depositTotal, shippingFee) thay vì tính
   * lại từ dailyPrice × số ngày (dailyPrice là giá bình quân đã làm tròn, không gồm
   * phụ kiện và voucher → lệch tổng). Tiền thuê/cọc được phân bổ theo tỷ trọng từng
   * món nên tổng các dòng luôn bằng đúng số tiền thanh toán.
   */
  private buildItems(booking: any, amount: Prisma.Decimal) {
    const expected = Math.round(amount.toNumber());
    const rentalTarget = Math.round(Number(booking.rentalTotal ?? 0));
    const depositTarget = Math.round(Number(booking.depositTotal ?? 0));
    const shipping = Math.round(Number(booking.shippingFee ?? 0));
    if (rentalTarget < 0 || depositTarget < 0 || shipping < 0) {
      throw new BadRequestException("Chi tiết thanh toán không khớp tổng tiền đơn hàng.");
    }

    const days = Math.max(
      1,
      Math.round((new Date(booking.rentalEndDate).getTime() - new Date(booking.rentalStartDate).getTime()) / 86400000) + 1,
    );
    const accessoryRows: Array<{ bookingItemId: string; rentalTotal: unknown }> = booking.accessoryItems ?? [];
    const lines = (booking.items ?? []).map((item: any) => {
      const accessories = accessoryRows.filter((a) => a.bookingItemId === item.id);
      const accessoryRental = accessories.reduce((sum, a) => sum + Number(a.rentalTotal ?? 0), 0);
      const baseName: string = item.garment_sizes?.garments?.name ?? "Trang phục";
      return {
        name: accessories.length > 0 ? `${baseName} + phụ kiện` : baseName,
        rentalWeight: Math.max(0, Number(item.dailyPrice ?? 0) * days + accessoryRental),
        depositWeight: Math.max(0, Number(item.depositAmount ?? 0)),
      };
    });

    let items: Array<{ name: string; quantity: number; price: number }>;
    if (lines.length === 0) {
      items = rentalTarget + depositTarget > 0
        ? [{ name: "Đơn thuê trang phục", quantity: 1, price: rentalTarget + depositTarget }]
        : [];
    } else {
      const rentals = this.allocate(rentalTarget, lines.map((l: { rentalWeight: number }) => l.rentalWeight));
      const deposits = this.allocate(depositTarget, lines.map((l: { depositWeight: number }) => l.depositWeight));
      items = lines.map((l: { name: string }, i: number) => ({ name: l.name, quantity: 1, price: rentals[i] + deposits[i] }));
      // PayOS không cần dòng 0đ (vd. voucher giảm toàn bộ tiền thuê một món không cọc).
      const nonZero = items.filter((item) => item.price > 0);
      if (nonZero.length > 0) items = nonZero;
    }
    if (shipping > 0) items.push({ name: "Phí giao hàng", quantity: 1, price: shipping });

    const itemTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (itemTotal !== expected) {
      throw new BadRequestException("Chi tiết thanh toán không khớp tổng tiền đơn hàng.");
    }
    return items;
  }

  /** Chia `total` (số nguyên) theo tỷ trọng `weights`, phần dư dồn cho phần lẻ lớn nhất. */
  private allocate(total: number, weights: number[]): number[] {
    if (weights.length === 0) return [];
    if (total === 0) return weights.map(() => 0);
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    const shares = weightSum > 0
      ? weights.map((w) => (total * w) / weightSum)
      : weights.map(() => total / weights.length);
    const result = shares.map((share) => Math.floor(share));
    let remainder = total - result.reduce((sum, v) => sum + v, 0);
    const order = shares
      .map((share, index) => ({ index, frac: share - Math.floor(share) }))
      .sort((a, b) => b.frac - a.frac || a.index - b.index);
    for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder -= 1) {
      result[order[k].index] += 1;
    }
    return result;
  }

  private allocateOrderCode(bookingId: string, existingCodes: Array<string | null>) {
    let code = Number.parseInt(bookingId.replace(/-/g, "").slice(0, 12), 16) % 900000000000 + 100000000000;
    const used = new Set(existingCodes.filter(Boolean));
    while (used.has(String(code))) code += 1;
    return code;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
