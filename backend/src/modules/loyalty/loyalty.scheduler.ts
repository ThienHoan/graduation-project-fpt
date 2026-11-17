import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { LoyaltyService } from "./loyalty.service";

@Injectable()
export class LoyaltyScheduler {
  private readonly logger = new Logger(LoyaltyScheduler.name);

  constructor(private readonly loyaltyService: LoyaltyService) {}

  /**
   * Chạy vào lúc 01:00 AM (giờ Việt Nam) hàng đêm:
   * 1. Quét và xét duyệt các tài khoản thành viên (Plus, Premium) đã hết hạn 12 tháng.
   * 2. Quét và gửi thông báo nhắc hạn thành viên trước 30 ngày (và 7 ngày) cho các tài khoản chưa đủ điểm chu kỳ.
   * 3. Quét và trừ điểm thưởng tích lũy quá 12 tháng chưa dùng.
   */
  @Cron("0 0 1 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async runNightlyLoyaltyMaintenance() {
    try {
      this.logger.log("Bắt đầu quét bảo trì hạn thành viên & điểm thưởng loyalty...");
      const tierResult = await this.loyaltyService.evaluateExpiredTiers();
      if (tierResult.renewed > 0 || tierResult.downgraded > 0) {
        this.logger.log(
          `Xét duyệt hạn thành viên: ${tierResult.renewed} tài khoản được gia hạn, ${tierResult.downgraded} tài khoản bị hạ bậc.`,
        );
      }

      const warningResult = await this.loyaltyService.sendTierExpirationWarnings();
      if (warningResult.warnedCount > 0) {
        this.logger.log(
          `Gửi thông báo nhắc hạn thành viên (trước 30 ngày): ${warningResult.warnedCount} tài khoản.`,
        );
      }

      const pointsResult = await this.loyaltyService.expireOutdatedPoints();
      if (pointsResult.expiredCount > 0) {
        this.logger.log(
          `Trừ điểm thưởng hết hạn 12 tháng: ${pointsResult.expiredCount} lượt, tổng trừ ${pointsResult.pointsDeducted} điểm.`,
        );
      }
    } catch (error) {
      this.logger.error("Lỗi khi chạy bảo trì loyalty hàng đêm", error instanceof Error ? error.stack : String(error));
    }
  }
}

