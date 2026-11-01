import { Injectable, Optional } from "@nestjs/common";
import { RedisService } from "../../redis/redis.service";

const IDEMPOTENCY_PREFIX = "chat:assistant:message:";
const IDEMPOTENCY_TTL_SECONDS = 15 * 60;

/**
 * Mỗi messageId chỉ được router xử lý một lần, kể cả khi socket/HTTP cùng
 * kích hoạt auto-reply. Không có messageId thì coi như luồng không idempotent
 * (các caller hiện tại luôn truyền id khi có).
 */
@Injectable()
export class IdempotencyService {
  private readonly memory = new Set<string>();

  constructor(@Optional() private readonly redisService?: RedisService) {}

  async begin(messageId?: string | null): Promise<boolean> {
    if (!messageId) return true;

    const key = `${IDEMPOTENCY_PREFIX}${messageId}`;
    if (this.redisService) {
      return this.redisService.setNx(key, "1", IDEMPOTENCY_TTL_SECONDS);
    }

    if (this.memory.has(key)) return false;
    this.memory.add(key);
    return true;
  }

  async release(messageId?: string | null): Promise<void> {
    if (!messageId) return;
    const key = `${IDEMPOTENCY_PREFIX}${messageId}`;
    this.memory.delete(key);
    if (this.redisService) {
      await this.redisService.del(key);
    }
  }
}
