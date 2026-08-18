import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PricingService } from "./pricing.service";

@Injectable()
export class PricingScheduler {
  private readonly logger = new Logger(PricingScheduler.name);

  constructor(private readonly pricing: PricingService) {}

  // Chạy 06:00 giờ VN mỗi ngày: sinh đề xuất cho các dịp/sự kiện bắt đầu
  // trong vòng X ngày tới (X = pricing_advice_lead_days, mặc định 7) —
  // admin có thời gian duyệt TRƯỚC khi dịp lễ bắt đầu.
  // Tạm tắt tự động sinh đề xuất (bật lại bằng cách bỏ comment @Cron).
  // @Cron("0 6 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async generateUpcomingSuggestions() {
    try {
      const result = await this.pricing.runScheduledGeneration();
      const events = result.data?.events ?? [];
      const total = events.reduce((sum, e) => sum + e.generated, 0);
      this.logger.log(`Pricing auto: ${events.length} sự kiện sắp tới, ${total} đề xuất mới.`);
    } catch (error) {
      this.logger.error(
        "Lỗi khi sinh đề xuất giá tự động",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}