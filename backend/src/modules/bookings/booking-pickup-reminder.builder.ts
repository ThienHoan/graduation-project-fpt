import { Injectable } from "@nestjs/common";
import { BookingStatus } from "@prisma/client";

export const PICKUP_REMINDER_STATUSES: readonly BookingStatus[] = [
  BookingStatus.confirmed,
  BookingStatus.awaiting_payment,
  BookingStatus.paid,
];

export interface PickupStoreConfig {
  storeAddress?: string | null;
  storePhone?: string | null;
  businessHours?: string | null;
}

export interface PickupReminderBookingData {
  bookingId: string;
  bookingCode?: string | null;
  pickupMethod?: string | null;
  rentalStartDate: Date | string;
  isUnpaid?: boolean;
  garmentName?: string | null;
}

export const DEFAULT_STORE_ADDRESS =
  "Đại học FPT Đà Nẵng, Khu đô thị FPT City, Phường Hòa Hải, Quận Ngũ Hành Sơn, Thành phố Đà Nẵng";
export const DEFAULT_STORE_PHONE = "0236 730 0999";
export const DEFAULT_BUSINESS_HOURS = "08:00 - 20:00";

export const DEFAULT_CARE_INSTRUCTIONS: readonly string[] = [
  "Treo trang phục nơi khô thoáng, tránh ánh nắng gắt trực tiếp.",
  "Không tự ý giặt máy, không ủi nhiệt độ cao trực tiếp lên vải lụa, gấm hoặc hoa văn thêu tay.",
  "Tránh để trang phục tiếp xúc với nước hoa nồng độ cao, rượu bia, dầu mỡ hoặc hoá chất gây ố màu.",
  "Không tự ý cắt sửa form dáng, may vá hoặc cài kim nhọn/phụ kiện sắc lên vải.",
  "Kiểm tra kỹ tình trạng trang phục lúc nhận; vui lòng báo ngay trong 30 phút nếu phát hiện lỗi từ trước.",
];

@Injectable()
export class BookingPickupReminderBuilder {
  /**
   * Tạo nội dung ghi chú (note) hoàn chỉnh cho thông báo nhắc nhận đồ T-1 ngày.
   */
  buildNote(data: PickupReminderBookingData, config?: PickupStoreConfig): string {
    const isDelivery = String(data.pickupMethod ?? "").trim().toLowerCase() === "delivery";
    const bookingCode = this.resolveBookingCode(data);
    const storeAddress = this.resolveStoreAddress(config);
    const storePhone = this.resolveStorePhone(config);
    const businessHours = this.resolveBusinessHours(config);

    const sections: string[] = [];

    if (isDelivery) {
      sections.push("Trang phục sẽ được giao đến địa chỉ của bạn, vui lòng để ý điện thoại.");
      if (storePhone) {
        sections.push(`Hotline hỗ trợ giao nhận: ${storePhone}.`);
      }
    } else {
      sections.push("Vui lòng đến cửa hàng để nhận trang phục.");
      if (storeAddress) {
        sections.push(`Địa chỉ nhận: ${storeAddress}.`);
      }
      const timeAndPhone: string[] = [];
      if (businessHours) timeAndPhone.push(`Giờ mở cửa: ${businessHours}`);
      if (storePhone) timeAndPhone.push(`Hotline hỗ trợ: ${storePhone}`);
      if (timeAndPhone.length > 0) {
        sections.push(`${timeAndPhone.join(" | ")}.`);
      }
      sections.push(`Khi đến nhận, quý khách vui lòng cung cấp mã đơn #${bookingCode} cho nhân viên tại quầy.`);
    }

    if (data.isUnpaid) {
      sections.push("Đơn chưa thanh toán — vui lòng thanh toán khi nhận đồ.");
    }

    sections.push("Hướng dẫn bảo quản cổ phục:");
    for (const instruction of DEFAULT_CARE_INSTRUCTIONS) {
      sections.push(`- ${instruction}`);
    }

    return sections.join("\n");
  }

  /**
   * Tóm tắt ngắn gọn địa điểm và hotline liên hệ.
   */
  buildSummary(data: PickupReminderBookingData, config?: PickupStoreConfig): string {
    const isDelivery = String(data.pickupMethod ?? "").trim().toLowerCase() === "delivery";
    const storeAddress = this.resolveStoreAddress(config);
    const storePhone = this.resolveStorePhone(config);

    if (isDelivery) {
      return `Trang phục sẽ được giao tận nơi vào ngày mai. Hotline hỗ trợ: ${storePhone}.`;
    }
    return `Nhận tại cửa hàng: ${storeAddress}. Hotline: ${storePhone}.`;
  }

  /**
   * Danh sách quy tắc bảo quản tiêu chuẩn.
   */
  getCareInstructions(): readonly string[] {
    return DEFAULT_CARE_INSTRUCTIONS;
  }

  private resolveBookingCode(data: PickupReminderBookingData): string {
    if (data.bookingCode && typeof data.bookingCode === "string" && data.bookingCode.trim()) {
      return this.sanitizeText(data.bookingCode.trim());
    }
    if (data.bookingId && typeof data.bookingId === "string" && data.bookingId.length >= 8) {
      return data.bookingId.slice(0, 8).toUpperCase();
    }
    return "N/A";
  }

  private resolveStoreAddress(config?: PickupStoreConfig): string {
    const addr = config?.storeAddress;
    if (typeof addr === "string" && addr.trim()) {
      return this.sanitizeText(addr.trim());
    }
    return DEFAULT_STORE_ADDRESS;
  }

  private resolveStorePhone(config?: PickupStoreConfig): string {
    const phone = config?.storePhone;
    if (typeof phone === "string" && phone.trim()) {
      return this.sanitizeText(phone.trim());
    }
    return DEFAULT_STORE_PHONE;
  }

  private resolveBusinessHours(config?: PickupStoreConfig): string {
    const hours = config?.businessHours;
    if (typeof hours === "string" && hours.trim()) {
      return this.sanitizeText(hours.trim());
    }
    return DEFAULT_BUSINESS_HOURS;
  }

  private sanitizeText(val: string): string {
    return val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  }
}

