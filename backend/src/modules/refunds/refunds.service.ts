import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { CreateRefundDto } from "./dto/create-refund.dto";
import type { UpdateRefundDetailsDto } from "./dto/update-refund-details.dto";
import type { UpdateRefundStatusDto } from "./dto/update-refund.dto";

const MUTABLE_REFUND_STATUSES: PaymentStatus[] = [PaymentStatus.pending, PaymentStatus.refunding];

type RefundNotificationData = {
  customerId: string;
  bookingId: string;
  amount: number;
  isBankTransfer: boolean;
};

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async calculate(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException("Booking not found.");
    const depositTotal = Number(booking.depositTotal);
    const penaltyTotal = Number(booking.penaltyTotal);
    return ok({ bookingId, depositTotal, penaltyTotal, refundAmount: Math.max(0, depositTotal - penaltyTotal) });
  }

  async create(dto: CreateRefundDto, staffId: string) {
    try {
      const refund = await this.prisma.runSerializable(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: dto.bookingId },
          include: { refunds: true, payments: true },
        });
        if (!booking) throw new NotFoundException("Booking not found.");
        if (booking.status !== BookingStatus.refund_pending && booking.status !== BookingStatus.completed) {
          throw new BadRequestException("Chỉ có thể hoàn cọc cho đơn đã kiểm tra xong.");
        }

        const alreadyRefunded = booking.refunds.find(
          (r) => r.status === PaymentStatus.refunded || r.status === PaymentStatus.partially_refunded,
        );
        if (alreadyRefunded) throw new BadRequestException("Đơn này đã được hoàn cọc trước đó.");

        const existingActive = booking.refunds.find((r) => r.status === PaymentStatus.pending || r.status === PaymentStatus.refunding);
        if (existingActive) throw new BadRequestException("Đơn này đã có yêu cầu hoàn cọc đang chờ xử lý.");

        const trimmedBankDetails = this.trimBankDetails(dto);
        if (dto.refundMethod === "bank_transfer") this.assertBankDetails(trimmedBankDetails);

        const amount = Math.max(0, Number(booking.depositTotal) - Number(booking.penaltyTotal));
        if (amount <= 0) throw new BadRequestException("Không có tiền cọc để hoàn lại.");

        const payment = this.pickAuthoritativePaidPayment(booking.payments);
        const paymentId = payment?.id ?? null;
        const isCash = dto.refundMethod === "cash";

        const created = await tx.refund.create({
          data: {
            bookingId: dto.bookingId,
            paymentId,
            amount,
            status: PaymentStatus.pending,
            refund_method: dto.refundMethod,
            reason: dto.reason ?? null,
            bank_name: trimmedBankDetails.bankName,
            bank_account_number: trimmedBankDetails.bankAccountNumber,
            bank_account_holder: trimmedBankDetails.bankAccountHolder,
            processed_by: staffId,
          },
        });

        const txType = isCash ? "refund_cash_pending" : "refund_bank_transfer_pending";
        await tx.financialTransaction.create({
          data: {
            bookingId: dto.bookingId,
            refundId: created.id,
            transactionType: txType,
            amount,
            note: `Yêu cầu hoàn cọc ${isCash ? "tiền mặt" : "chuyển khoản"}. Số tiền: ${amount.toLocaleString("vi-VN")}đ`,
          },
        });

        return this.findRefundForSerialize(tx, created.id);
      });

      this.realtime.refundChanged({
        id: refund!.id,
        bookingId: dto.bookingId,
        status: refund!.status,
      });

      return ok(this.serialize(refund!));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new BadRequestException("Đơn này đã có yêu cầu hoàn cọc (thao tác trùng lặp).");
      }
      throw e;
    }
  }

  async updateDetails(id: string, dto: UpdateRefundDetailsDto, staffId: string) {
    const bankDetails = this.trimBankDetails(dto);
    this.assertBankDetails(bankDetails);

    const refund = await this.prisma.runSerializable(async (tx) => {
      const current = await tx.refund.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("Refund not found.");
      if (current.refund_method !== "bank_transfer") {
        throw new BadRequestException("Chỉ yêu cầu hoàn cọc chuyển khoản mới cần thông tin ngân hàng.");
      }
      if (!MUTABLE_REFUND_STATUSES.includes(current.status)) {
        throw new BadRequestException(`Không thể cập nhật thông tin ở trạng thái: ${current.status}.`);
      }

      const claimed = await tx.refund.updateMany({
        where: { id, status: { in: MUTABLE_REFUND_STATUSES }, refund_method: "bank_transfer" },
        data: {
          bank_name: bankDetails.bankName,
          bank_account_number: bankDetails.bankAccountNumber,
          bank_account_holder: bankDetails.bankAccountHolder,
          processed_by: staffId,
          updated_at: new Date(),
        },
      });
      if (claimed.count !== 1) throw new ConflictException("Refund was updated by another request.");
      return this.findRefundForSerialize(tx, id);
    });

    this.realtime.refundChanged({
      id: refund!.id,
      bookingId: refund!.bookingId,
      status: refund!.status,
    });

    return ok(this.serialize(refund!));
  }

  // Đơn ở bước "Chờ hoàn cọc" nhưng phạt >= cọc (vd phạt cộng thêm sau kiểm tra)
  // → không có gì để hoàn, cho phép staff đóng đơn về "Hoàn tất" không tạo refund.
  async closeWithoutRefund(bookingId: string, staffId: string) {
    const result = await this.prisma.runSerializable(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { refunds: true },
      });
      if (!booking) throw new NotFoundException("Booking not found.");
      if (booking.status !== BookingStatus.refund_pending) {
        throw new BadRequestException("Chỉ đóng được đơn đang ở trạng thái chờ hoàn cọc.");
      }

      const refundAmount = Number(booking.depositTotal) - Number(booking.penaltyTotal);
      if (refundAmount > 0) throw new BadRequestException("Đơn vẫn còn tiền cọc phải hoàn — hãy tạo yêu cầu hoàn cọc.");

      const activeRefund = booking.refunds.find(
        (r) => r.status === PaymentStatus.pending || r.status === PaymentStatus.refunding,
      );
      if (activeRefund) throw new BadRequestException("Đơn đang có yêu cầu hoàn cọc chờ xử lý.");

      const claimed = await tx.booking.updateMany({
        where: { id: bookingId, status: BookingStatus.refund_pending },
        data: { status: BookingStatus.completed },
      });
      if (claimed.count !== 1) throw new ConflictException("Booking was already processed.");

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: BookingStatus.refund_pending,
          toStatus: BookingStatus.completed,
          changedBy: staffId,
          note: "Phạt ≥ cọc — hoàn tất, không hoàn cọc",
        },
      });
      return { customerId: booking.customerId };
    });

    void this.notificationsService.notifyUser({
      userId: result.customerId,
      templateKey: "refund.closed_no_refund",
      data: { bookingId, bookingCode: bookingId.slice(0, 8).toUpperCase() },
    }).catch(() => {});

    this.realtime.bookingChanged({
      id: bookingId,
      bookingId,
      status: BookingStatus.completed,
    });
    this.realtime.bookingChangedForCustomer(result.customerId, {
      id: bookingId,
      bookingId,
      status: BookingStatus.completed,
    });

    return ok({ bookingId, status: BookingStatus.completed });
  }

  async reject(id: string, staffId: string, reason?: string) {
    const updated = await this.prisma.runSerializable(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id } });
      if (!refund) throw new NotFoundException("Refund not found.");
      if (!MUTABLE_REFUND_STATUSES.includes(refund.status)) {
        throw new BadRequestException(`Không thể từ chối yêu cầu hoàn cọc ở trạng thái: ${refund.status}.`);
      }

      const claimed = await tx.refund.updateMany({
        where: { id, status: { in: MUTABLE_REFUND_STATUSES } },
        data: { status: PaymentStatus.cancelled, processed_by: staffId, updated_at: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException("Refund was already processed.");

      await tx.financialTransaction.create({
        data: {
          bookingId: refund.bookingId,
          refundId: id,
          transactionType: "refund_rejected",
          amount: 0,
          note: reason ?? "Đã từ chối yêu cầu hoàn cọc.",
        },
      });
      return tx.refund.findUniqueOrThrow({ where: { id } });
    });

    this.realtime.refundChanged({
      id: updated.id,
      bookingId: updated.bookingId,
      status: updated.status,
    });

    return ok({ id: updated.id, status: updated.status });
  }

  async approve(id: string, dto: UpdateRefundStatusDto, managerId: string) {
    const notifyDataRef: { value: RefundNotificationData | null } = { value: null };

    const updated = await this.prisma.runSerializable(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id }, include: { booking: true } });
      if (!refund) throw new NotFoundException("Refund not found.");
      if (!MUTABLE_REFUND_STATUSES.includes(refund.status)) {
        throw new BadRequestException(`Không thể duyệt hoàn cọc ở trạng thái: ${refund.status}.`);
      }
      const isBankTransfer = refund.refund_method === "bank_transfer";
      if (isBankTransfer) {
        this.assertBankDetails({
          bankName: refund.bank_name,
          bankAccountNumber: refund.bank_account_number,
          bankAccountHolder: refund.bank_account_holder,
        });
        if (!dto.proofImageUrl?.trim()) throw new BadRequestException("Cần cung cấp ảnh bill chuyển khoản.");
      }

      const liveDeposit = Number(refund.booking.depositTotal);
      const livePenalty = Number(refund.booking.penaltyTotal);
      const liveRefundAmount = Math.max(0, liveDeposit - livePenalty);
      const frozenAmount = Number(refund.amount);

      if (liveRefundAmount <= 0) {
        const claimed = await tx.refund.updateMany({
          where: { id, status: { in: MUTABLE_REFUND_STATUSES } },
          data: { status: PaymentStatus.cancelled, processed_by: managerId, updated_at: new Date() },
        });
        if (claimed.count !== 1) throw new ConflictException("Refund was already processed.");
        await tx.financialTransaction.create({
          data: {
            bookingId: refund.bookingId,
            refundId: id,
            transactionType: "refund_rejected",
            amount: 0,
            note: "Tự động huỷ: phạt hiện tại đã bằng hoặc vượt tiền cọc, không còn gì để hoàn.",
          },
        });
        throw new BadRequestException(
          "Tiền phạt của đơn đã tăng lên bằng hoặc vượt tiền cọc kể từ lúc tạo yêu cầu này — yêu cầu đã bị huỷ tự động. " +
          "Vào màn Hoàn cọc của nhân viên và dùng nút \"Đóng đơn — không hoàn cọc\" để hoàn tất đơn.",
        );
      }

      if (Math.round(liveRefundAmount) !== Math.round(frozenAmount)) {
        throw new BadRequestException(
          `Số tiền hoàn đã thay đổi kể từ lúc tạo yêu cầu (lúc tạo: ${frozenAmount.toLocaleString("vi-VN")}đ, hiện tại: ${liveRefundAmount.toLocaleString("vi-VN")}đ) ` +
          `do tiền phạt của đơn đã cập nhật. Vui lòng từ chối yêu cầu này rồi tạo lại yêu cầu hoàn cọc mới để lấy đúng số tiền.`,
        );
      }

      const claimedRefund = await tx.refund.updateMany({
        where: { id, status: { in: MUTABLE_REFUND_STATUSES } },
        data: {
          status: dto.status,
          proof_image_url: dto.proofImageUrl?.trim() || null,
          processed_by: managerId,
          updated_at: new Date(),
        },
      });
      if (claimedRefund.count !== 1) throw new ConflictException("Refund was already processed.");

      await tx.financialTransaction.create({
        data: {
          bookingId: refund.bookingId,
          refundId: id,
          transactionType: isBankTransfer ? "refund_bank_transfer_approved" : "refund_cash",
          amount: Number(refund.amount),
          note: dto.note ?? `Đã duyệt hoàn cọc ${isBankTransfer ? "chuyển khoản" : "tiền mặt"}.`,
        },
      });

      if (
        (dto.status === PaymentStatus.refunded || dto.status === PaymentStatus.partially_refunded) &&
        refund.booking.status === BookingStatus.refund_pending
      ) {
        const claimedBooking = await tx.booking.updateMany({
          where: { id: refund.bookingId, status: BookingStatus.refund_pending },
          data: { status: BookingStatus.completed },
        });
        if (claimedBooking.count === 1) {
          await tx.bookingStatusHistory.create({
            data: {
              bookingId: refund.bookingId,
              fromStatus: BookingStatus.refund_pending,
              toStatus: BookingStatus.completed,
              changedBy: managerId,
              note: "Đã duyệt hoàn cọc",
            },
          });
        }
      }

      notifyDataRef.value = {
        customerId: refund.booking.customerId,
        bookingId: refund.bookingId,
        amount: Number(refund.amount),
        isBankTransfer,
      };

      return this.findRefundForSerialize(tx, id);
    });

    const notifyData = notifyDataRef.value;
    if (notifyData) {
      void this.notificationsService.notifyUser({
        userId: notifyData.customerId,
        templateKey: "refund.approved",
        data: {
          bookingId: notifyData.bookingId,
          bookingCode: notifyData.bookingId.slice(0, 8).toUpperCase(),
          amount: notifyData.amount.toLocaleString("vi-VN") + "đ",
          refundMethodLabel: notifyData.isBankTransfer ? "chuyển khoản" : "tiền mặt",
        },
      }).catch(() => {});
    }

    this.realtime.refundChanged({
      id: updated!.id,
      bookingId: updated!.bookingId,
      status: updated!.status,
    });
    this.realtime.bookingChanged({
      id: updated!.bookingId,
      bookingId: updated!.bookingId,
      status: BookingStatus.completed,
    });
    if (notifyData) {
      this.realtime.refundChangedForCustomer(notifyData.customerId, {
        id: updated!.id,
        bookingId: updated!.bookingId,
        status: updated!.status,
      });
      this.realtime.bookingChangedForCustomer(notifyData.customerId, {
        id: updated!.bookingId,
        bookingId: updated!.bookingId,
        status: BookingStatus.completed,
      });
    }

    return ok(this.serialize(updated!));
  }

  async findByBooking(bookingId: string) {
    const refunds = await this.prisma.refund.findMany({
      where: { bookingId }, orderBy: { createdAt: "desc" },
      include: this.refundInclude(),
    });
    return ok(refunds.map((r) => this.serialize(r)));
  }

  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: this.refundInclude(),
    });
    if (!refund) throw new NotFoundException("Refund not found.");
    return ok(this.serialize(refund));
  }

  async findPendingForStaff() {
    const refunds = await this.prisma.refund.findMany({
      where: { status: { in: MUTABLE_REFUND_STATUSES } }, orderBy: { createdAt: "asc" },
      include: this.refundInclude(),
    });
    return ok(refunds.map((r) => this.serialize(r)));
  }

  async findPendingForManager() {
    const refunds = await this.prisma.refund.findMany({
      where: { status: { in: MUTABLE_REFUND_STATUSES } }, orderBy: { createdAt: "desc" },
      include: this.refundInclude(),
    });
    return ok(refunds.map((r) => this.serialize(r)));
  }

  async findByCustomerBooking(customerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.customerId !== customerId) throw new ForbiddenException("Bạn không có quyền xem thông tin hoàn cọc của đơn này.");

    const refunds = await this.prisma.refund.findMany({
      where: { bookingId }, orderBy: { createdAt: "desc" },
      include: { booking: { select: { id: true, depositTotal: true, penaltyTotal: true, pickupMethod: true } } },
    });

    return ok(refunds.map((r) => ({
      id: r.id, bookingId: r.bookingId, amount: Number(r.amount), status: r.status, refundMethod: r.refund_method,
      reason: r.reason, bankName: r.bank_name,
      bankAccountNumber: r.bank_account_number ? `****${r.bank_account_number.slice(-4)}` : null,
      bankAccountHolder: r.bank_account_holder,
      proofImageUrl: r.proof_image_url,
      bankDetailsComplete: this.hasBankDetails(r),
      createdAt: r.createdAt.toISOString(), updatedAt: r.updated_at.toISOString(),
    })));
  }

  private refundInclude() {
    return {
      booking: {
        select: {
          id: true,
          customerId: true,
          depositTotal: true,
          penaltyTotal: true,
          pickupMethod: true,
          customer: { select: { profile: { select: { fullName: true, phone: true } }, email: true } },
          items: { select: { id: true, garment_sizes: { select: { size_label: true, garments: { select: { name: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { imageUrl: true } } } } } } } },
        },
      },
    } satisfies Prisma.RefundInclude;
  }

  private findRefundForSerialize(tx: Prisma.TransactionClient, id: string) {
    return tx.refund.findUnique({ where: { id }, include: this.refundInclude() });
  }

  private trimBankDetails(input: Partial<Pick<CreateRefundDto, "bankName" | "bankAccountNumber" | "bankAccountHolder">>) {
    return {
      bankName: input.bankName?.trim() || null,
      bankAccountNumber: input.bankAccountNumber?.trim() || null,
      bankAccountHolder: input.bankAccountHolder?.trim() || null,
    };
  }

  private assertBankDetails(details: { bankName?: string | null; bankAccountNumber?: string | null; bankAccountHolder?: string | null }) {
    if (!details.bankName || !details.bankAccountNumber || !details.bankAccountHolder) {
      throw new BadRequestException("Cần cung cấp đầy đủ thông tin ngân hàng.");
    }
  }

  private hasBankDetails(refund: any) {
    return Boolean(
      refund.bank_name?.trim() &&
      refund.bank_account_number?.trim() &&
      refund.bank_account_holder?.trim(),
    );
  }

  private pickAuthoritativePaidPayment(payments: Array<{ id: string; status: PaymentStatus; depositAmount: Prisma.Decimal; paidAt: Date | null; createdAt: Date }>) {
    return payments
      .filter((payment) => payment.status === PaymentStatus.paid)
      .sort((a, b) => {
        const depositDiff = Number(b.depositAmount) - Number(a.depositAmount);
        if (depositDiff !== 0) return depositDiff;
        const paidDiff = (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0);
        if (paidDiff !== 0) return paidDiff;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })[0];
  }

  private serialize(refund: any) {
    return {
      id: refund.id, bookingId: refund.bookingId, amount: Number(refund.amount), status: refund.status,
      refundMethod: refund.refund_method, reason: refund.reason,
      bankName: refund.bank_name, bankAccountNumber: refund.bank_account_number, bankAccountHolder: refund.bank_account_holder,
      bankDetailsComplete: this.hasBankDetails(refund),
      proofImageUrl: refund.proof_image_url,
      createdAt: refund.createdAt.toISOString(), updatedAt: refund.updated_at.toISOString(),
      booking: {
        id: refund.booking.id, depositTotal: Number(refund.booking.depositTotal), penaltyTotal: Number(refund.booking.penaltyTotal),
        pickupMethod: refund.booking.pickupMethod,
        customerId: refund.booking.customerId ?? null,
        customerName: refund.booking.customer?.profile?.fullName ?? refund.booking.customer?.email ?? null,
        customerPhone: refund.booking.customer?.profile?.phone ?? null,
        items: (refund.booking.items ?? []).map((item: any) => ({
          id: item.id,
          garmentName: item.garment_sizes?.garments?.name ?? null,
          sizeLabel: item.garment_sizes?.size_label ?? null,
          imageUrl: item.garment_sizes?.garments?.images?.[0]?.imageUrl ?? null,
        })),
      },
      processedBy: null,
    };
  }
}
