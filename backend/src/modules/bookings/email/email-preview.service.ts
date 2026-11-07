import { Injectable, NotFoundException } from "@nestjs/common";
import { EmailTemplateBuilder } from "./email-templates.builder";
import type {
  EmailRenderResult,
  EmailTemplateKey,
  ExtensionAppliedEmailData,
  PickupReminderEmailData,
  ReturnReminderEmailData,
  ReviewInviteEmailData,
  ThankYouVoucherEmailData,
} from "./email-templates.types";

export interface TemplatePreviewMetadata {
  key: EmailTemplateKey;
  name: string;
  description: string;
  category: "reminder" | "post_completion" | "retention";
  variants?: string[];
}

@Injectable()
export class EmailPreviewService {
  constructor(private readonly builder: EmailTemplateBuilder) {}

  /**
   * Danh mục 5 mẫu email chuyên nghiệp của Cổ Phục Hoàng Thành AI.
   */
  listTemplates(): TemplatePreviewMetadata[] {
    return [
      {
        key: "booking.pickup_reminder",
        name: "Nhắc Lịch Nhận Cổ Phục (T-1)",
        description: "Email gửi lúc 09h00 ngày hôm trước nhắc khách đến nhận đồ hoặc chuẩn bị đón shipper.",
        category: "reminder",
        variants: ["store_pickup", "delivery"],
      },
      {
        key: "booking.return_reminder",
        name: "Nhắc Hạn Hoàn Trả Cổ Phục (T-3h / Dual Reminder)",
        description: "Email gửi lúc 12h00 hoặc 17h00 ngày trả cảnh báo sắp hết hạn và giờ đóng cửa.",
        category: "reminder",
        variants: ["daily_12h", "before_close_17h", "delivery"],
      },
      {
        key: "booking.extension_applied",
        name: "Xác Nhận Gia Hạn Kỳ Thuê",
        description: "Email gửi ngay sau khi giao dịch gia hạn qua PayOS được xác nhận thành công.",
        category: "retention",
      },
      {
        key: "booking.thank_you_voucher",
        name: "Tri Ân Khách Hàng & Voucher Thân Thiết",
        description: "Email gửi sau khi đơn hoàn tất. Tuân thủ Safety Gate: voucher chỉ hiện khi program enabled.",
        category: "retention",
        variants: ["program_disabled (Safe Default)", "program_enabled (With Voucher)"],
      },
      {
        key: "booking.review_invite",
        name: "Mời Đánh Giá Trải Nghiệm Khách Hàng",
        description: "Email mời khách đánh giá chất lượng phục vụ và trang phục với banner 5 sao.",
        category: "post_completion",
      },
    ];
  }

  /**
   * Tạo bản xem trước (HTML + Plain Text) với dữ liệu giả lập chuẩn phong cách Cổ Phục Hoàng Thành.
   */
  getPreview(
    templateKey: EmailTemplateKey,
    variant?: string,
  ): EmailRenderResult {
    switch (templateKey) {
      case "booking.pickup_reminder": {
        const isDelivery = variant === "delivery";
        const mockData: PickupReminderEmailData = {
          customerName: "Nguyễn Thị Mai Anh",
          bookingCode: "CP-88291",
          garmentName: "Áo Nhật Bình Cung Đình Huế (Thêu Phượng)",
          pickupDate: "2026-11-08",
          pickupMethod: isDelivery ? "delivery" : "store_pickup",
          careInstructions: [
            "Bảo quản trang phục nơi khô ráo, thoáng mát, tránh ẩm mốc và ánh nắng gắt.",
            "Không tự ý giặt máy, ủi nhiệt độ cao hoặc tẩy hoá chất lên vải lụa tơ tằm cổ phục.",
            "Bàn giao đủ trọn bộ phụ kiện đi kèm (trâm cài, vấn tóc, quạt tơ, hài/guốc).",
          ],
        };
        return this.builder.buildPickupReminderEmail(mockData);
      }

      case "booking.return_reminder": {
        const isBeforeClose = variant === "before_close_17h";
        const isDelivery = variant === "delivery";
        const mockData: ReturnReminderEmailData = {
          customerName: "Trần Văn Hoàng Long",
          bookingCode: "CP-44910",
          garmentName: "Áo Tấc Nam Triều Nguyễn (Lụa Sa Vân Vàng)",
          rentalEndDate: "2026-11-08",
          scheduleType: isBeforeClose ? "before_close" : "daily",
          pickupMethod: isDelivery ? "delivery" : "store_pickup",
          accessoryCount: 3,
          accessoriesList: [
            "01 Vấn tóc lụa gấm màu xanh lục",
            "01 Quạt ngà xếp cung đình thêu tay",
            "01 Đôi hài cong nhung đen mũi phụng",
          ],
          hasPendingExtension: false,
          overdueFeePerDay: 10_000,
        };
        return this.builder.buildReturnReminderEmail(mockData);
      }

      case "booking.extension_applied": {
        const mockData: ExtensionAppliedEmailData = {
          customerName: "Lê Hoàng Bảo Ngọc",
          bookingCode: "CP-73192",
          garmentName: "Áo Giao Lĩnh Ngũ Thân Lụa Hà Đông",
          originalEndDate: "2026-11-08",
          newEndDate: "2026-11-10",
          extensionDays: 2,
          extensionFee: 140_000,
          paymentStatus: "paid", // Safe
          paymentMethod: "PayOS VietQR",
          paymentRef: "PAYOS-EXT-882194",
        };
        return this.builder.buildExtensionAppliedEmail(mockData);
      }

      case "booking.thank_you_voucher": {
        const isEnabled = variant === "program_enabled";
        const mockData: ThankYouVoucherEmailData = {
          customerName: "Phạm Thùy Dung",
          bookingCode: "CP-10293",
          garmentName: "Áo Phượng Bào Hoàng Hậu Triều Nguyễn",
          programEnabled: isEnabled, // Follows Safety Gate
          voucherCode: isEnabled ? "TRIAN-CP10293" : undefined,
          discountType: "percentage",
          discountValue: 10,
          maxDiscountAmount: 100_000,
          minOrderValue: 200_000,
          expiresAt: "2026-12-08",
        };
        return this.builder.buildThankYouVoucherEmail(mockData);
      }

      case "booking.review_invite": {
        const mockData: ReviewInviteEmailData = {
          customerName: "Đặng Minh Trí",
          bookingCode: "CP-55102",
          garmentName: "Áo Ngũ Thân Tay Chẽn Thêu Hoa Sen",
          completedDate: "2026-11-07",
        };
        return this.builder.buildReviewInviteEmail(mockData);
      }

      default:
        throw new NotFoundException(`Không tìm thấy mẫu email '${templateKey}'.`);
    }
  }
}

