import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AssistantMetricsService } from "./assistant-metrics.service";

/**
 * Dọn `chat_assistant_events` theo CHAT_EVENTS_RETENTION_DAYS (mặc định 90).
 *
 * Chạy mỗi ngày lúc 03:30 giờ Việt Nam — ngoài giờ cao điểm. ScheduleModule
 * đã được bật ở AppModule. Nếu chạy nhiều instance, mỗi instance đều gọi
 * deleteMany; câu lệnh idempotent và chỉ xoá bản ghi cũ nên an toàn.
 */
@Injectable()
export class AssistantMetricsScheduler {
  private readonly logger = new Logger(AssistantMetricsScheduler.name);

  constructor(private readonly metricsService: AssistantMetricsService) {}

  @Cron("0 30 3 * * *", { timeZone: "Asia/Ho_Chi_Minh" })
  async cleanup(): Promise<number> {
    const deleted = await this.metricsService.cleanupExpired();
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} expired chat_assistant_events rows`);
    }
    return deleted;
  }
}
