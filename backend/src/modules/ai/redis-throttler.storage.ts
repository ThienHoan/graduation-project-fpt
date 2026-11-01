import type { ThrottlerStorage } from "@nestjs/throttler";
import type { RedisService } from "../redis/redis.service";

type WindowCounter = Pick<RedisService, "incrementWindow">;

/**
 * ThrottlerStorage dùng Redis (fixed window) để giới hạn request được chia sẻ
 * giữa nhiều instance backend. Khi Redis không khả dụng, RedisService tự
 * fallback sang bộ nhớ nên hành vi vẫn giữ nguyên như ThrottlerStorage mặc định.
 *
 * Nest throttler mặc định blockDuration = 0 (chặn ngay trong window hiện tại),
 * nên ta chỉ cần trả isBlocked khi số hit vượt limit.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: WindowCounter) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ) {
    const windowKey = `throttle:${throttlerName}:${key}`;
    const { count, ttlMs } = await this.redis.incrementWindow(windowKey, ttl);
    const isBlocked = count > limit;
    const timeToExpire = Math.max(1, Math.ceil(ttlMs / 1000));

    return {
      totalHits: count,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}
