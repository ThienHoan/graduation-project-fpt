import { Injectable, Logger } from "@nestjs/common";
import { EmailTemplateBuilder } from "./email-templates.builder";
import type {
  EmailRenderResult,
  ExtensionAppliedEmailData,
  PickupReminderEmailData,
  ReturnReminderEmailData,
  ReviewInviteEmailData,
  ThankYouVoucherEmailData,
} from "./email-templates.types";

/**
 * Adapter trung gian an toàn kết nối giữa các Service nghiệp vụ (BookingsService,
 * BookingThankYouVoucherService) và Email presentation layer (EmailTemplateBuilder).
 *
 * Giữ nguyên 100% tính nguyên vẹn của shared NotificationsService transport (không gây rủi ro
 * cho các thành viên Hải/Sơn/Hiếu), đồng thời chuẩn hóa dữ liệu email thành HTML hoàng gia & plain text.
 */
@Injectable()
export class BookingEmailAdapter {
  private readonly logger = new Logger(BookingEmailAdapter.name);

  constructor(private readonly templateBuilder: EmailTemplateBuilder) {}

  private formatDateString(d: string | Date | undefined): string {
    if (!d) return "";
    if (typeof d === "string") return d;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Tạo email nhắc nhận đồ (09h00 T-1 ngày).
   */
  preparePickupReminderEmail(params: {
    bookingId: string;
    bookingCode?: string;
    customerName?: string | null;
    garmentName?: string | null;
    pickupMethod?: string | null;
    pickupDate: string | Date;
    storeAddress?: string | null;
    storePhone?: string | null;
    businessHours?: string | null;
    careInstructions?: string[];
    ctaUrl?: string | null;
  }): EmailRenderResult {
    const data: PickupReminderEmailData = {
      bookingCode: params.bookingCode ?? params.bookingId.slice(0, 8).toUpperCase(),
      customerName: params.customerName ?? "Quý khách",
      garmentName: params.garmentName ?? "Cổ phục Hoàng thành",
      pickupDate: this.formatDateString(params.pickupDate),
      pickupMethod: params.pickupMethod ?? "store_pickup",
      storeInfo: {
        storeAddress: params.storeAddress,
        storePhone: params.storePhone,
        businessHours: params.businessHours,
      },
      careInstructions: params.careInstructions,
      ctaUrl: params.ctaUrl,
    };

    return this.templateBuilder.buildPickupReminderEmail(data);
  }

  /**
   * Tạo email nhắc trả đồ (12h00 trưa hoặc 17h00 T-3h trước giờ đóng cửa).
   */
  prepareReturnReminderEmail(params: {
    bookingId: string;
    bookingCode?: string;
    customerName?: string | null;
    garmentName?: string | null;
    pickupMethod?: string | null;
    returnDate: string | Date;
    scheduleType?: "daily" | "before_close";
    storeAddress?: string | null;
    storePhone?: string | null;
    businessHours?: string | null;
    accessoryCount?: number;
    accessoriesList?: string[];
    hasPendingExtension?: boolean;
    overdueFeePerDay?: number | null;
    ctaUrl?: string | null;
  }): EmailRenderResult {
    const data: ReturnReminderEmailData = {
      bookingCode: params.bookingCode ?? params.bookingId.slice(0, 8).toUpperCase(),
      customerName: params.customerName ?? "Quý khách",
      garmentName: params.garmentName ?? "Cổ phục Hoàng thành",
      rentalEndDate: this.formatDateString(params.returnDate),
      scheduleType: params.scheduleType ?? "daily",
      pickupMethod: params.pickupMethod ?? "store_pickup",
      storeInfo: {
        storeAddress: params.storeAddress,
        storePhone: params.storePhone,
        businessHours: params.businessHours,
      },
      accessoryCount: params.accessoryCount ?? 0,
      accessoriesList: params.accessoriesList,
      hasPendingExtension: Boolean(params.hasPendingExtension),
      overdueFeePerDay: params.overdueFeePerDay,
      ctaUrl: params.ctaUrl,
    };

    return this.templateBuilder.buildReturnReminderEmail(data);
  }

  /**
   * Tạo email tri ân voucher sau khi hoàn tất đơn.
   */
  prepareThankYouVoucherEmail(params: {
    bookingId: string;
    bookingCode?: string;
    customerName?: string | null;
    garmentName?: string | null;
    voucherCode?: string | null;
    discountValue?: number;
    discountType?: "percentage" | "fixed";
    minOrderValue?: number;
    maxDiscountAmount?: number;
    expiresAt?: string | Date | null;
    isProgramEnabled?: boolean;
    storeAddress?: string | null;
    storePhone?: string | null;
    businessHours?: string | null;
    ctaUrl?: string | null;
  }): EmailRenderResult {
    const data: ThankYouVoucherEmailData = {
      bookingCode: params.bookingCode ?? params.bookingId.slice(0, 8).toUpperCase(),
      customerName: params.customerName ?? "Quý khách",
      garmentName: params.garmentName ?? "Cổ phục Hoàng thành",
      voucherCode: params.voucherCode ?? undefined,
      discountValue: params.discountValue ?? 10,
      discountType: params.discountType ?? "percentage",
      minOrderValue: params.minOrderValue,
      maxDiscountAmount: params.maxDiscountAmount,
      expiresAt: params.expiresAt ?? undefined,
      programEnabled: Boolean(params.isProgramEnabled),
      storeInfo: {
        storeAddress: params.storeAddress,
        storePhone: params.storePhone,
        businessHours: params.businessHours,
      },
      ctaUrl: params.ctaUrl,
    };

    return this.templateBuilder.buildThankYouVoucherEmail(data);
  }

  /**
   * Tạo email xác nhận gia hạn thành công.
   */
  prepareExtensionAppliedEmail(params: {
    bookingId: string;
    bookingCode?: string;
    customerName?: string | null;
    garmentName?: string | null;
    originalEndDate?: string | Date;
    newReturnDate: string | Date;
    extensionDays?: number;
    extensionFee?: number;
    paymentStatus?: "paid" | "pending" | string;
    paymentMethod?: string | null;
    storeAddress?: string | null;
    storePhone?: string | null;
    businessHours?: string | null;
    ctaUrl?: string | null;
  }): EmailRenderResult {
    const data: ExtensionAppliedEmailData = {
      bookingCode: params.bookingCode ?? params.bookingId.slice(0, 8).toUpperCase(),
      customerName: params.customerName ?? "Quý khách",
      garmentName: params.garmentName ?? "Cổ phục Hoàng thành",
      originalEndDate: this.formatDateString(params.originalEndDate ?? params.newReturnDate),
      newEndDate: this.formatDateString(params.newReturnDate),
      extensionDays: params.extensionDays ?? 1,
      extensionFee: params.extensionFee ?? 0,
      paymentStatus: params.paymentStatus ?? "paid",
      paymentMethod: params.paymentMethod,
      storeInfo: {
        storeAddress: params.storeAddress,
        storePhone: params.storePhone,
        businessHours: params.businessHours,
      },
      ctaUrl: params.ctaUrl,
    };

    return this.templateBuilder.buildExtensionAppliedEmail(data);
  }

  /**
   * Tạo email mời đánh giá đơn hàng.
   */
  prepareReviewInviteEmail(params: {
    bookingId: string;
    bookingCode?: string;
    customerName?: string | null;
    garmentName?: string | null;
    completedDate?: string | Date;
    storeAddress?: string | null;
    storePhone?: string | null;
    businessHours?: string | null;
    ctaUrl?: string | null;
  }): EmailRenderResult {
    const data: ReviewInviteEmailData = {
      bookingCode: params.bookingCode ?? params.bookingId.slice(0, 8).toUpperCase(),
      customerName: params.customerName ?? "Quý khách",
      garmentName: params.garmentName ?? "Cổ phục Hoàng thành",
      completedDate: this.formatDateString(params.completedDate),
      storeInfo: {
        storeAddress: params.storeAddress,
        storePhone: params.storePhone,
        businessHours: params.businessHours,
      },
      ctaUrl: params.ctaUrl,
    };

    return this.templateBuilder.buildReviewInviteEmail(data);
  }
}
