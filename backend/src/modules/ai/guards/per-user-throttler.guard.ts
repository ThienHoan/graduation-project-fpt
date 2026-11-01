import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Rate limit theo user đã đăng nhập, fallback theo IP cho khách ẩn danh.
 *
 * Trước đây mọi staff trong cùng một văn phòng (chung IP NAT) dùng chung
 * một bucket 10 req/phút nên panel gợi ý AI rất dễ bị 429.
 */
@Injectable()
export class PerUserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id;
    if (typeof userId === "string" && userId.length > 0) {
      return `user:${userId}`;
    }

    return `ip:${req.ip ?? req.ips?.[0] ?? "unknown"}`;
  }
}
