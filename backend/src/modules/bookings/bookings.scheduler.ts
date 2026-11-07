import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BookingAutomationService } from "./booking-automation.service";
import { BookingExtensionsService } from "./booking-extensions.service";
import { BookingsService } from "./bookings.service";

@Injectable()
export class BookingsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookingsScheduler.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly automation: BookingAutomationService,
    private readonly extensions: BookingExtensionsService,
  ) {}

  // Quét bù khi server khởi động — cron chỉ chạy đúng giờ nên nếu server
  // down qua mốc 00h00 thì vẫn đánh dấu quá hạn / cộng phí khi bật lại.
  async onApplicationBootstrap() {
    await this.runOverdueScan();
  }

  // 12h00 (giờ VN) mỗi ngày: nhắc khách có đơn hết hạn thuê hôm nay trả đồ
  // trước 00h00 ngày mai.
  @Cron("0 0 12 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runReturnReminders() {
    try {
      const result = await this.bookingsService.sendReturnReminders("daily");
      if (result.data?.remindedCount) {
        this.logger.log(`Đã nhắc trả đồ ${result.data.remindedCount} đơn.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi gửi nhắc trả đồ", error instanceof Error ? error.stack : String(error));
    }
  }

  // 17h00 (giờ VN) mỗi ngày: nhắc lần 2 trước giờ đóng cửa (T-3 tiếng trước 20h00).
  @Cron("0 0 17 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runBeforeCloseReturnReminders() {
    try {
      const result = await this.bookingsService.sendReturnReminders("before_close");
      if (result.data?.remindedCount) {
        this.logger.log(`Đã nhắc trả đồ trước giờ đóng cửa (17h00) cho ${result.data.remindedCount} đơn.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi gửi nhắc trả đồ 17h00", error instanceof Error ? error.stack : String(error));
    }
  }

  // Mỗi 5 phút: tự huỷ đơn chưa thanh toán đã quá hạn (đơn QR khách bỏ dở, đơn
  // nhận tại cửa hàng quá 2 giờ chờ thanh toán) để nhả size và voucher.
  @Cron("0 */5 * * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runExpiredPaymentScan() {
    try {
      const result = await this.bookingsService.cancelExpiredAwaitingPayments();
      if (result.data?.expiredCount) {
        this.logger.log(`Tự huỷ ${result.data.expiredCount} đơn quá hạn thanh toán.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi huỷ đơn quá hạn thanh toán", error instanceof Error ? error.stack : String(error));
    }
    // Yêu cầu gia hạn quá 30 phút: đã trả tiền thì áp dụng, chưa trả thì trả lại ngày cũ.
    try {
      const result = await this.extensions.expirePendingExtensions();
      if (result.data?.expired.length || result.data?.applied.length) {
        this.logger.log(`Gia hạn: hết hạn ${result.data.expired.length}, áp dụng muộn ${result.data.applied.length}.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi xử lý gia hạn quá hạn", error instanceof Error ? error.stack : String(error));
    }
  }

  // Mỗi 10 phút: tự gán áo thật cho đơn sắp đến ngày thuê, rồi tự chuyển đơn đã
  // thanh toán + đủ đồ sang "Đang chuẩn bị" khi còn ≤ 1 ngày. Hai bước độc lập:
  // bước gán lỗi thì bước chuẩn bị vẫn chạy cho các đơn đã đủ đồ.
  @Cron("0 */10 * * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runFulfillmentAutomation() {
    try {
      const result = await this.automation.reassignUnavailableAssets();
      if (result.data?.releasedAssets) {
        this.logger.log(
          `Đổi ${result.data.releasedAssets} tài sản hỏng/bảo trì: ${result.data.replaced.length} đơn đã có áo thay, ${result.data.needsManager.length} đơn cần quản lý.`,
        );
      }
    } catch (error) {
      this.logger.error("Lỗi khi đổi tài sản hỏng/bảo trì", error instanceof Error ? error.stack : String(error));
    }
    try {
      const result = await this.bookingsService.autoAssignUpcomingBookings();
      if (result.data?.assignedAssets) {
        this.logger.log(`Tự gán ${result.data.assignedAssets} tài sản cho ${result.data.scanned} đơn sắp thuê.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi tự gán tài sản", error instanceof Error ? error.stack : String(error));
    }
    try {
      const result = await this.bookingsService.autoPrepareUpcomingBookings();
      if (result.data?.prepared.length) {
        this.logger.log(`Tự chuyển ${result.data.prepared.length} đơn sang Đang chuẩn bị.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi tự chuyển đơn sang chuẩn bị", error instanceof Error ? error.stack : String(error));
    }
  }

  // 07h30 (giờ VN) mỗi ngày: bản tin các việc hệ thống không tự xử lý được.
  @Cron("0 30 7 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runStaffDailyDigest() {
    try {
      await this.automation.sendStaffDailyDigest();
    } catch (error) {
      this.logger.error("Lỗi khi gửi bản tin vận hành", error instanceof Error ? error.stack : String(error));
    }
  }

  // 10h00 (giờ VN) mỗi ngày: mời khách đánh giá đơn vừa hoàn tất trong 24 giờ qua.
  @Cron("0 0 10 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runReviewInvitations() {
    try {
      const result = await this.automation.sendReviewInvitations();
      if (result.data?.invitedCount) {
        this.logger.log(`Đã mời ${result.data.invitedCount} khách đánh giá.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi mời khách đánh giá", error instanceof Error ? error.stack : String(error));
    }
  }

  // 09h00 (giờ VN) mỗi ngày: nhắc khách có đơn bắt đầu thuê vào ngày mai.
  @Cron("0 0 9 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runPickupReminders() {
    try {
      const result = await this.bookingsService.sendPickupReminders();
      if (result.data?.remindedCount) {
        this.logger.log(`Đã nhắc nhận đồ ${result.data.remindedCount} đơn.`);
      }
    } catch (error) {
      this.logger.error("Lỗi khi gửi nhắc nhận đồ", error instanceof Error ? error.stack : String(error));
    }
  }

  // 00h00 (giờ VN) mỗi ngày: đánh dấu quá hạn các đơn chưa trả và cộng dồn
  // phí phạt 10.000đ/ngày cho các đơn đang quá hạn.
  @Cron("0 0 0 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runOverdueScan() {
    try {
      const result = await this.bookingsService.markOverdueBookings();
      if (result.data?.markedCount || result.data?.accruedCount) {
        this.logger.log(
          `Quét quá hạn: đánh dấu ${result.data.markedCount} đơn, cộng phí ${result.data.accruedCount} đơn.`,
        );
      }
    } catch (error) {
      this.logger.error("Lỗi khi quét đơn quá hạn", error instanceof Error ? error.stack : String(error));
    }
  }
}
