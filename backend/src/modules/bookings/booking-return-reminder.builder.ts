import { Injectable } from "@nestjs/common";

export interface ReturnStoreConfig {
  storeAddress?: string | null;
  storePhone?: string | null;
  businessHours?: string | null;
  overdueFeePerDay?: number | null;
  customerDashboardUrl?: string | null;
}

export interface ReturnReminderBookingData {
  bookingId: string;
  bookingCode?: string | null;
  customerName?: string | null;
  garmentName?: string | null;
  rentalEndDate: Date | string;
  returnDeadlineFormatted?: string | null;
  pickupMethod?: string | null;
  isNearDeadline?: boolean;
  hasAccessories?: boolean;
  accessoryCount?: number | null;
  hasPendingExtension?: boolean;
  scheduleType?: "daily" | "before_close";
}

export const DEFAULT_RETURN_STORE_ADDRESS =
  "Đại học FPT Đà Nẵng, Khu đô thị FPT City, Phường Hòa Hải, Quận Ngũ Hành Sơn, Thành phố Đà Nẵng";
export const DEFAULT_RETURN_STORE_PHONE = "0236 730 0999";
export const DEFAULT_RETURN_BUSINESS_HOURS = "08:00 - 20:00";
export const DEFAULT_OVERDUE_FEE_PER_DAY = 10_000;
export const DEFAULT_CUSTOMER_DASHBOARD_PATH = "/dashboard/customer";

export const DEFAULT_RETURN_PREPARATION_INSTRUCTIONS: readonly string[] = [
  "Kiểm tra lại toàn bộ phụ kiện đi kèm (trâm cài, vấn tóc, quạt, thắt lưng, hài/guốc...) để hoàn trả đầy đủ.",
  "Gấp trang phục gọn gàng và đặt vào túi hoặc hộp đựng ban đầu của cửa hàng.",
  "Không tự ý giặt máy, ủi nhiệt độ cao hoặc dùng chất tẩy rửa hoá học lên vải cổ phục trước khi trả.",
  "Báo trước với nhân viên nếu trang phục có vết bẩn phát sinh trong quá trình sử dụng để được hỗ trợ kiểm tra.",
];

@Injectable()
export class BookingReturnReminderBuilder {
  /**
   * Tạo nội dung ghi chú (note) hoàn chỉnh cho thông báo nhắc trả trang phục.
   */
  buildNote(data: ReturnReminderBookingData, config?: ReturnStoreConfig): string {
    const isDelivery = String(data.pickupMethod ?? "").trim().toLowerCase() === "delivery";
    const bookingCode = this.resolveBookingCode(data);
    const garmentName = this.resolveGarmentName(data);
    const formattedDate = this.formatDisplayDate(data.rentalEndDate);
    const storeAddress = this.resolveStoreAddress(config);
    const storePhone = this.resolveStorePhone(config);
    const businessHours = this.resolveBusinessHours(config);
    const overdueFeeStr = this.formatCurrency(config?.overdueFeePerDay ?? DEFAULT_OVERDUE_FEE_PER_DAY);
    const dashboardPath = config?.customerDashboardUrl?.trim() || DEFAULT_CUSTOMER_DASHBOARD_PATH;

    const sections: string[] = [];

    // 1. Tiêu đề / Lời nhắc thời hạn (phân biệt daily 12h00 và before_close 17h00)
    if (data.scheduleType === "before_close") {
      if (data.returnDeadlineFormatted && data.returnDeadlineFormatted.trim()) {
        sections.push(
          `[Nhắc lần 2 - 17h00] Kỳ thuê đơn #${bookingCode} (${garmentName}) kết thúc vào ngày ${formattedDate}. Hạn trả trang phục: ${this.sanitizeText(data.returnDeadlineFormatted.trim())}.`,
        );
      } else {
        sections.push(
          `[Nhắc lần 2 - 17h00] Hôm nay (${formattedDate}) là ngày kết thúc kỳ thuê đơn #${bookingCode} (${garmentName}).`,
        );
      }
    } else {
      if (data.returnDeadlineFormatted && data.returnDeadlineFormatted.trim()) {
        sections.push(
          `Kỳ thuê đơn #${bookingCode} (${garmentName}) kết thúc vào ngày ${formattedDate}. Hạn trả trang phục: ${this.sanitizeText(data.returnDeadlineFormatted.trim())}.`,
        );
      } else {
        sections.push(
          `Hôm nay (${formattedDate}) là ngày kết thúc kỳ thuê đơn #${bookingCode} (${garmentName}).`,
        );
      }
    }

    // 2. Hướng dẫn địa điểm hoàn trả theo phương thức & thời gian đóng cửa
    if (isDelivery) {
      if (data.scheduleType === "before_close") {
        sections.push(
          "Đối với đơn giao nhận tận nơi: Quý khách vui lòng đóng gói trang phục và phụ kiện cẩn thận để sẵn sàng bàn giao cho đơn vị vận chuyển.",
        );
      } else {
        sections.push(
          "Đối với đơn giao nhận tận nơi: Quý khách vui lòng đóng gói trang phục cẩn thận và sẵn sàng bàn giao cho đơn vị vận chuyển.",
        );
      }
      if (storePhone) {
        sections.push(`Hotline điều phối lấy hàng: ${storePhone}.`);
      }
    } else {
      sections.push(`Địa điểm nhận trả trang phục: Showroom ${storeAddress}.`);
      const details: string[] = [];
      if (businessHours) details.push(`Giờ mở cửa đón khách: ${businessHours}`);
      if (storePhone) details.push(`Hotline hỗ trợ: ${storePhone}`);
      if (details.length > 0) {
        sections.push(`${details.join(" | ")}.`);
      }

      if (data.scheduleType === "before_close") {
        const closing = this.parseClosingTime(businessHours);
        if (closing) {
          const hoursRemaining = Math.max(
            0,
            Math.floor((closing.closeHour * 60 + closing.closeMin - 17 * 60) / 60),
          );
          if (hoursRemaining > 0) {
            sections.push(
              `Cảnh báo thời gian: Hiện còn khoảng ${hoursRemaining} giờ (trước ${closing.closeTime}) để hoàn trả cổ phục trực tiếp tại showroom. Quý khách vui lòng sắp xếp mang trang phục đến quầy để nhân viên kiểm tra nhận đồ.`,
            );
          } else {
            sections.push(
              `Lưu ý quan trọng: Showroom hiện đã đến hoặc qua giờ đóng cửa đón khách (${businessHours}). Quý khách vui lòng không di chuyển đến cửa hàng ngoài giờ. Hãy liên hệ Hotline ${storePhone} để được hỗ trợ hoặc thực hiện gia hạn thuê trực tuyến nếu cần giữ đồ thêm.`,
            );
          }
        } else {
          sections.push(
            `Quý khách vui lòng mang trang phục đến trước giờ đóng cửa để nhân viên tiến hành kiểm tra đồ trực tiếp tại quầy.`,
          );
        }
      } else {
        sections.push(
          `Quý khách vui lòng mang trang phục đến trước giờ đóng cửa để nhân viên tiến hành kiểm tra đồ trực tiếp tại quầy.`,
        );
      }
    }

    // 3. Nhắc nhở phụ kiện
    if (data.accessoryCount != null && data.accessoryCount > 0) {
      sections.push(
        `Lưu ý: Đơn hàng có kèm theo ${data.accessoryCount} món phụ kiện. Quý khách vui lòng kiểm tra kỹ và bàn giao đủ phụ kiện để hoàn tất thủ tục.`,
      );
    } else if (data.hasAccessories) {
      sections.push(
        "Lưu ý: Quý khách vui lòng kiểm tra và bàn giao đầy đủ các phụ kiện đi kèm (nếu có).",
      );
    }

    // 4. Hướng dẫn chuẩn bị trả đồ
    sections.push("Hướng dẫn chuẩn bị hoàn trả:");
    for (const instruction of DEFAULT_RETURN_PREPARATION_INSTRUCTIONS) {
      sections.push(`- ${instruction}`);
    }

    // 5. Hướng dẫn gia hạn thuê hoặc thông báo yêu cầu pending
    if (data.hasPendingExtension) {
      sections.push(
        `Lưu ý gia hạn: Đơn hàng đang có một yêu cầu gia hạn thuê chờ thanh toán (giữ lịch trong 30 phút). Vui lòng hoàn tất thanh toán để ngày trả mới có hiệu lực chính thức; nếu không thanh toán kịp, yêu cầu gia hạn sẽ tự động bị huỷ.`,
      );
    } else {
      sections.push(
        `Cần thêm thời gian thuê? Quý khách có thể truy cập trang cá nhân (${dashboardPath}) và chọn 'Gia hạn thuê' trước khi hết hạn (tối đa 7 ngày). Yêu cầu chỉ có hiệu lực sau khi thanh toán phí gia hạn thành công.`,
      );
    }

    // 6. Cảnh báo phí quá hạn
    sections.push(
      `Quy định trễ hạn: Sau 00h00, hệ thống sẽ tự động chuyển trạng thái đơn sang quá hạn và tính phí phạt ${overdueFeeStr}/ngày.`,
    );

    return sections.join("\n");
  }

  /**
   * Tóm tắt ngắn gọn 1-2 câu cho push notification hoặc SMS.
   */
  buildSummary(data: ReturnReminderBookingData, config?: ReturnStoreConfig): string {
    const bookingCode = this.resolveBookingCode(data);
    const garmentName = this.resolveGarmentName(data);
    const isDelivery = String(data.pickupMethod ?? "").trim().toLowerCase() === "delivery";
    const storePhone = this.resolveStorePhone(config);
    const businessHours = this.resolveBusinessHours(config);

    if (data.scheduleType === "before_close") {
      if (isDelivery) {
        return `[Nhắc lần 2 - 17h00] Hạn trả đơn #${bookingCode} (${garmentName}) kết thúc hôm nay. Vui lòng đóng gói đồ để shipper lấy lại. Hotline: ${storePhone}.`;
      }
      const closing = this.parseClosingTime(businessHours);
      if (closing) {
        const hoursRemaining = Math.max(
          0,
          Math.floor((closing.closeHour * 60 + closing.closeMin - 17 * 60) / 60),
        );
        if (hoursRemaining > 0) {
          return `[Nhắc lần 2 - 17h00] Còn khoảng ${hoursRemaining} giờ (trước ${closing.closeTime}) để trả đơn #${bookingCode} tại showroom. Hotline: ${storePhone}.`;
        }
        return `[Nhắc lần 2 - 17h00] Showroom đã đóng cửa (${businessHours}). Vui lòng liên hệ Hotline ${storePhone} hoặc gia hạn online.`;
      }
      return `[Nhắc lần 2 - 17h00] Vui lòng trả đơn #${bookingCode} tại showroom trước giờ đóng cửa (${businessHours}). Hotline: ${storePhone}.`;
    }

    if (isDelivery) {
      return `Hôm nay là hạn trả đơn #${bookingCode} (${garmentName}). Vui lòng chuẩn bị đồ để shipper nhận lại. Hotline: ${storePhone}.`;
    }
    return `Hôm nay là hạn trả đơn #${bookingCode} (${garmentName}). Vui lòng trả tại showroom trước giờ đóng cửa (${businessHours}). Hotline: ${storePhone}.`;
  }

  /**
   * Trích xuất giờ đóng cửa từ chuỗi businessHours (ví dụ: "08:00 - 20:00" -> { closeTime: "20:00", closeHour: 20, closeMin: 0 })
   */
  parseClosingTime(
    businessHours?: string | null,
  ): { closeTime: string; closeHour: number; closeMin: number } | null {
    if (!businessHours || typeof businessHours !== "string") return null;
    const parts = businessHours.split(/[-–—]/);
    const target = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(target);
    if (!match) return null;
    const hour = Number(match[1]);
    const min = Number(match[2]);
    if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
    return {
      closeTime: `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      closeHour: hour,
      closeMin: min,
    };
  }

  /**
   * Danh sách quy tắc chuẩn bị hoàn trả tiêu chuẩn.
   */
  getReturnPreparationInstructions(): readonly string[] {
    return DEFAULT_RETURN_PREPARATION_INSTRUCTIONS;
  }

  private resolveBookingCode(data: ReturnReminderBookingData): string {
    if (data.bookingCode && typeof data.bookingCode === "string" && data.bookingCode.trim()) {
      return this.sanitizeText(data.bookingCode.trim());
    }
    if (data.bookingId && typeof data.bookingId === "string" && data.bookingId.length >= 8) {
      return data.bookingId.slice(0, 8).toUpperCase();
    }
    return "N/A";
  }

  private resolveGarmentName(data: ReturnReminderBookingData): string {
    if (data.garmentName && typeof data.garmentName === "string" && data.garmentName.trim()) {
      return this.sanitizeText(data.garmentName.trim());
    }
    return "trang phục";
  }

  private resolveStoreAddress(config?: ReturnStoreConfig): string {
    const addr = config?.storeAddress;
    if (typeof addr === "string" && addr.trim()) {
      return this.sanitizeText(addr.trim());
    }
    return DEFAULT_RETURN_STORE_ADDRESS;
  }

  private resolveStorePhone(config?: ReturnStoreConfig): string {
    const phone = config?.storePhone;
    if (typeof phone === "string" && phone.trim()) {
      return this.sanitizeText(phone.trim());
    }
    return DEFAULT_RETURN_STORE_PHONE;
  }

  private resolveBusinessHours(config?: ReturnStoreConfig): string {
    const hours = config?.businessHours;
    if (typeof hours === "string" && hours.trim()) {
      return this.sanitizeText(hours.trim());
    }
    return DEFAULT_RETURN_BUSINESS_HOURS;
  }

  private formatDisplayDate(dateInput: Date | string): string {
    try {
      const dateStr =
        typeof dateInput === "string"
          ? dateInput.slice(0, 10)
          : dateInput.toISOString().slice(0, 10);
      const [y, m, d] = dateStr.split("-");
      if (y && m && d) return `${d}/${m}/${y}`;
      return dateStr;
    } catch {
      return "hôm nay";
    }
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat("vi-VN").format(amount) + " đ";
  }

  private sanitizeText(val: string): string {
    return val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  }
}

