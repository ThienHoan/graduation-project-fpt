import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { VouchersService } from "../vouchers/vouchers.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  evaluateThankYouVoucherPolicy,
  type ThankYouVoucherProgramConfig,
} from "./booking-thank-you-voucher.policy";
import { BookingEmailAdapter } from "./email/booking-email.adapter";
import { EmailTemplateBuilder } from "./email/email-templates.builder";

export const THANK_YOU_VOUCHER_ACTION = "voucher.thank_you_issued";
export const THANK_YOU_VOUCHER_NOTIFIED_ACTION = "notification.thank_you_dispatched";
export const THANK_YOU_VOUCHER_SETTING_KEY = "thank_you_voucher_program";

export interface ThankYouVoucherIssueResult {
  success: boolean;
  status: "issued" | "already_issued" | "ineligible" | "policy_unconfirmed" | "disabled" | "error";
  voucherCode?: string;
  reason?: string;
  description?: string;
  discountType?: "percentage" | "fixed";
  discountValue?: number;
  expiresAt?: Date;
  alreadyIssued?: boolean;
}

export interface ProcessThankYouResult {
  success: boolean;
  status:
    | "issued_and_notified"
    | "issued_notification_failed"
    | "already_issued_and_notified"
    | "already_issued_notification_failed"
    | "ineligible"
    | "disabled"
    | "policy_unconfirmed"
    | "error";
  voucherCode?: string;
  reason?: string;
  description?: string;
  notificationSent?: boolean;
}

@Injectable()
export class BookingThankYouVoucherService {
  private readonly logger = new Logger(BookingThankYouVoucherService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly vouchers?: VouchersService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly emailAdapter?: BookingEmailAdapter,
  ) {}

  private get emailAdapterService(): BookingEmailAdapter {
    return this.emailAdapter ?? new BookingEmailAdapter(new EmailTemplateBuilder());
  }

  /**
   * Phát hành Voucher Tri Ân cho một đơn hàng đã hoàn tất.
   * - Hoàn toàn idempotent: Gọi lại nhiều lần không tạo 2 voucher hoặc gây lỗi.
   * - Tái sử dụng an toàn VouchersService.create() mà không sửa logic của thành viên khác.
   */
  async issueThankYouVoucher(bookingId: string): Promise<ThankYouVoucherIssueResult> {
    // 1. Kiểm tra booking
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: { select: { id: true, email: true } },
        penalties: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Đơn hàng #${bookingId} không tồn tại.`);
    }

    // 2. Kiểm tra xem đã từng cấp voucher tri ân cho booking này chưa (Durable AuditLog check)
    const existingCode = await this.getIssuedVoucherCode(bookingId);
    if (existingCode) {
      return {
        success: true,
        status: "already_issued",
        voucherCode: existingCode,
        alreadyIssued: true,
        description: `Voucher tri ân ${existingCode} đã được cấp trước đó cho đơn hàng #${bookingId.slice(0, 8).toUpperCase()}.`,
      };
    }

    // 3. Đọc cấu hình chương trình tri ân
    const programConfig = await this.loadProgramConfig();
    if (!programConfig || !programConfig.enabled) {
      return {
        success: false,
        status: "disabled",
        reason: "program_disabled",
        description: "Chương trình tặng voucher tri ân khách hàng đang tắt hoặc chưa cấu hình.",
      };
    }

    // 4. Đánh giá tính hợp lệ qua Policy thuần túy
    const penaltyTotal = Number(booking.penaltyTotal ?? 0);
    const decision = evaluateThankYouVoucherPolicy(
      {
        bookingId: booking.id,
        customerId: booking.customerId,
        status: booking.status,
        penaltyTotal,
        rentalEndDate: booking.rentalEndDate,
      },
      programConfig,
    );

    if (decision.status !== "ELIGIBLE") {
      return {
        success: false,
        status: decision.status === "POLICY_UNCONFIRMED" ? "policy_unconfirmed" : "ineligible",
        reason: decision.reason,
        description: decision.description,
      };
    }

    // 5. Cấp voucher qua VouchersService
    if (!this.vouchers) {
      this.logger.warn(`VouchersService chưa được inject. Không thể cấp voucher cho đơn ${bookingId}.`);
      return {
        success: false,
        status: "error",
        reason: "vouchers_service_unavailable",
        description: "Dịch vụ phát hành voucher hiện không khả dụng.",
      };
    }

    const benefit = decision.benefit;

    try {
      await this.vouchers.create({
        code: benefit.code,
        name: benefit.name,
        description: benefit.description,
        discountType: benefit.discountType,
        discountValue: benefit.discountValue,
        maxDiscountAmount: benefit.maxDiscountAmount,
        minOrderValue: benefit.minOrderValue,
        usageLimit: 1,
        perUserLimit: 1,
        startAt: benefit.startAt.toISOString(),
        endAt: benefit.endAt.toISOString(),
        isActive: true,
      });
    } catch (err) {
      // Nếu mã đã tồn tại (do 2 request đồng thời cạnh tranh), coi như thành công idempotent
      if (err instanceof ConflictException) {
        this.logger.log(`Voucher ${benefit.code} đã được tạo bởi tiến trình song song.`);
        return {
          success: true,
          status: "already_issued",
          voucherCode: benefit.code,
          alreadyIssued: true,
          description: `Voucher ${benefit.code} đã tồn tại.`,
        };
      }
      this.logger.error(`Lỗi khi tạo voucher ${benefit.code} cho đơn ${bookingId}: ${err}`);
      throw err;
    }

    // 6. Ghi nhận lịch sử bền vững vào AuditLog
    await this.recordIssuanceLog(booking.id, booking.customerId, benefit.code, benefit);

    return {
      success: true,
      status: "issued",
      voucherCode: benefit.code,
      discountType: benefit.discountType,
      discountValue: benefit.discountValue,
      expiresAt: benefit.endAt,
      description: `Đã cấp voucher ${benefit.code} giảm ${benefit.discountValue}${benefit.discountType === "percentage" ? "%" : "đ"} cho khách hàng.`,
    };
  }

  /**
   * Kiểm tra mã voucher đã cấp cho booking nếu có.
   */
  async getIssuedVoucherCode(bookingId: string): Promise<string | null> {
    if (!this.prisma?.auditLog?.findFirst) {
      return null;
    }

    try {
      const log = await this.prisma.auditLog.findFirst({
        where: {
          action: THANK_YOU_VOUCHER_ACTION,
          entityId: bookingId,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!log || !log.metadata || typeof log.metadata !== "object") {
        return null;
      }

      const meta = log.metadata as Record<string, unknown>;
      return typeof meta.voucherCode === "string" ? meta.voucherCode : null;
    } catch (err) {
      this.logger.warn(`Lỗi khi đọc auditLog voucher tri ân cho booking ${bookingId}: ${err}`);
      return null;
    }
  }

  private async loadProgramConfig(): Promise<ThankYouVoucherProgramConfig | null> {
    if (!this.prisma?.systemSetting?.findUnique) {
      return null;
    }

    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: THANK_YOU_VOUCHER_SETTING_KEY },
      });

      if (!row || !row.value || typeof row.value !== "object") {
        return null;
      }

      return row.value as unknown as ThankYouVoucherProgramConfig;
    } catch (err) {
      this.logger.warn(`Lỗi khi đọc cấu hình chương trình voucher tri ân: ${err}`);
      return null;
    }
  }

  /**
   * Tích hợp toàn diện chu trình Tri Ân sau khi đơn hoàn tất:
   * 1. Thẩm định điều kiện & Trạng thái bật/tắt của chương trình.
   * 2. Phát hành voucher an toàn lũy kế (idempotent).
   * 3. Chuẩn bị nội dung cảm ơn kèm thông tin voucher và link đánh giá.
   * 4. Gửi notification qua NotificationsService.
   * 5. Phân tách rõ ràng: nếu notification lỗi, voucher vẫn được bảo toàn và lần gọi sau sẽ không cấp trùng.
   */
  async processCompletedBookingThankYou(bookingId: string): Promise<ProcessThankYouResult> {
    const issueResult = await this.issueThankYouVoucher(bookingId);

    if (issueResult.status === "disabled") {
      return {
        success: false,
        status: "disabled",
        reason: "thank_you_voucher_program_disabled",
        description:
          "Chương trình Voucher Tri Ân đang ở trạng thái tắt theo chính sách an toàn Customer Ownership Gap.",
        notificationSent: false,
      };
    }

    if (
      issueResult.status === "ineligible" ||
      issueResult.status === "policy_unconfirmed" ||
      issueResult.status === "error"
    ) {
      return {
        success: false,
        status: issueResult.status,
        reason: issueResult.reason,
        description: issueResult.description,
        notificationSent: false,
      };
    }

    // Booking & Customer details
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: { include: { garment_sizes: { include: { garments: true } } } },
      },
    });

    if (!booking) {
      return {
        success: false,
        status: "error",
        reason: "booking_not_found",
        description: `Không tìm thấy booking #${bookingId}`,
        notificationSent: false,
      };
    }

    // Build Thank You Note
    const garmentName = booking.items[0]?.garment_sizes?.garments?.name ?? "cổ phục";
    const voucherCode = issueResult.voucherCode!;
    const discountText =
      issueResult.discountType === "percentage"
        ? `${issueResult.discountValue}%`
        : `${new Intl.NumberFormat("vi-VN").format(issueResult.discountValue ?? 0)} đ`;
    const expiryText = issueResult.expiresAt
      ? issueResult.expiresAt.toISOString().slice(0, 10).split("-").reverse().join("/")
      : "30 ngày";

    const note = [
      `Cảm ơn Quý khách đã hoàn tất kỳ thuê đơn #${(booking as any).bookingCode ?? booking.id.slice(0, 8).toUpperCase()} (${garmentName}) tại Cổ Phục Hoàng Thành AI!`,
      `Để tri ân Quý khách, chúng tôi xin gửi tặng mã ưu đãi đặc biệt:`,
      `🎁 Mã Voucher: ${voucherCode}`,
      `✨ Ưu đãi: Giảm ${discountText} cho đơn thuê tiếp theo.`,
      `⏳ Hạn sử dụng đến: ${expiryText}.`,
      `Quý khách có thể đánh giá trải nghiệm đơn hàng tại trang cá nhân (/dashboard/customer) để giúp chúng tôi phục vụ tốt hơn.`,
    ].join("\n");

    // Chuẩn bị email qua BookingEmailAdapter (EmailTemplateBuilder)
    const emailRender = this.emailAdapterService.prepareThankYouVoucherEmail({
      bookingId: booking.id,
      bookingCode: (booking as any).bookingCode ?? booking.id.slice(0, 8).toUpperCase(),
      garmentName,
      voucherCode,
      discountValue: issueResult.discountValue ?? 10,
      discountType: issueResult.discountType === "percentage" ? "percentage" : "fixed",
      expiresAt: issueResult.expiresAt,
      isProgramEnabled: false,
    });

    let notificationSent = false;
    if (this.notifications) {
      try {
        await this.notifications.sendBookingNotification({
          userId: booking.customerId,
          templateKey: "booking.review_invite",
          bookingId: booking.id,
          garmentName,
          startDate: booking.rentalStartDate.toISOString().slice(0, 10),
          endDate: booking.rentalEndDate.toISOString().slice(0, 10),
          note,
          html: emailRender.html,
        });
        notificationSent = true;
        await this.recordNotificationLog(booking.id, booking.customerId, voucherCode);
      } catch (err) {
        this.logger.error(`Lỗi khi gửi email/notification tri ân cho đơn ${bookingId}: ${err}`);
      }
    }

    const isAlready = issueResult.status === "already_issued";
    return {
      success: true,
      status: isAlready
        ? notificationSent
          ? "already_issued_and_notified"
          : "already_issued_notification_failed"
        : notificationSent
          ? "issued_and_notified"
          : "issued_notification_failed",
      voucherCode,
      notificationSent,
      description: notificationSent
        ? `Đã cấp voucher ${voucherCode} và gửi thông báo tri ân thành công.`
        : `Đã cấp voucher ${voucherCode} nhưng gửi thông báo thất bại (sẽ không cấp lại voucher khi retry).`,
    };
  }

  private async recordNotificationLog(
    bookingId: string,
    customerId: string,
    voucherCode: string,
  ): Promise<void> {
    if (!this.prisma?.auditLog?.create) return;
    try {
      await this.prisma.auditLog.create({
        data: {
          action: THANK_YOU_VOUCHER_NOTIFIED_ACTION,
          entityType: "booking",
          entityId: bookingId,
          metadata: {
            bookingId,
            customerId,
            voucherCode,
            dispatchedAt: new Date().toISOString(),
          },
        },
      });
    } catch (err) {
      this.logger.warn(`Không thể ghi log auditLog notification tri ân: ${err}`);
    }
  }

  private async recordIssuanceLog(
    bookingId: string,
    customerId: string,
    voucherCode: string,
    benefit: any,
  ): Promise<void> {
    if (!this.prisma?.auditLog?.create) {
      return;
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          action: THANK_YOU_VOUCHER_ACTION,
          entityType: "booking",
          entityId: bookingId,
          metadata: {
            voucherCode,
            customerId,
            discountType: benefit.discountType,
            discountValue: benefit.discountValue,
            expiresAt: benefit.endAt.toISOString(),
            issuedAt: new Date().toISOString(),
          },
        },
      });
    } catch (err) {
      this.logger.error(`Không thể ghi auditLog cho voucher ${voucherCode} của đơn ${bookingId}: ${err}`);
    }
  }
}

