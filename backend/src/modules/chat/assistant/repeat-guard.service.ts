import { Injectable, Optional } from "@nestjs/common";
import { RedisService } from "../../redis/redis.service";

const REPEAT_KEY_PREFIX = "chat:assistant:repeat:";
const ASK_KEY_PREFIX = "chat:assistant:ask:";
const REPEAT_TTL_SECONDS = 30 * 60;
const ASK_TTL_SECONDS = 15 * 60;
const MAX_CONSECUTIVE_REPLIES = 3;

export type RepeatGuardState = {
  count: number;
  signature: string | null;
  sameCount: number;
  lastReplyAt: number;
};

export type RepeatGuardResult = {
  escalate: boolean;
  reason?: "same_intent_twice" | "repeat_limit";
  count: number;
  sameCount: number;
};

function emptyState(): RepeatGuardState {
  return { count: 0, signature: null, sameCount: 0, lastReplyAt: 0 };
}

/**
 * Chống auto-reply lặp:
 * - 3 câu auto-reply liên tiếp kể từ tin staff gần nhất, hoặc
 * - cùng intent + slots xuất hiện 2 lần liên tiếp
 * -> chuyển STAFF.
 *
 * Staff trả lời thì reset (reset() hoặc truyền lastStaffMessageAt mới hơn).
 */
@Injectable()
export class RepeatGuardService {
  private readonly memory = new Map<string, RepeatGuardState>();

  constructor(@Optional() private readonly redisService?: RedisService) {}

  async register(
    conversationId: string,
    signature: string,
    lastStaffMessageAt?: Date | string | null,
  ): Promise<RepeatGuardResult> {
    const key = `${REPEAT_KEY_PREFIX}${conversationId}`;
    let state = await this.read(key);

    const staffAt = lastStaffMessageAt
      ? new Date(lastStaffMessageAt).getTime()
      : 0;
    if (staffAt && staffAt > state.lastReplyAt) {
      state = emptyState();
    }

    const sameCount =
      state.signature && state.signature === signature ? state.sameCount + 1 : 1;
    const count = state.count + 1;
    const reason =
      sameCount >= 2 ? "same_intent_twice" : count >= MAX_CONSECUTIVE_REPLIES ? "repeat_limit" : undefined;

    const next: RepeatGuardState = {
      count,
      signature,
      sameCount,
      lastReplyAt: Date.now(),
    };
    await this.write(key, next);

    return {
      escalate: Boolean(reason),
      ...(reason ? { reason } : {}),
      count,
      sameCount,
    };
  }

  /** Hỏi lại chỉ một lần cho mỗi tình huống thiếu dữ liệu. */
  async claimAsk(conversationId: string, askKey: string): Promise<boolean> {
    const key = `${ASK_KEY_PREFIX}${conversationId}:${askKey}`;
    if (this.redisService) {
      return this.redisService.setNx(key, "1", ASK_TTL_SECONDS);
    }

    if (this.memory.has(key)) return false;
    this.memory.set(key, emptyState());
    return true;
  }

  async reset(conversationId: string): Promise<void> {
    const repeatKey = `${REPEAT_KEY_PREFIX}${conversationId}`;
    this.memory.delete(repeatKey);

    if (!this.redisService) {
      const prefix = `${ASK_KEY_PREFIX}${conversationId}:`;
      for (const key of this.memory.keys()) {
        if (key.startsWith(prefix)) this.memory.delete(key);
      }
      return;
    }

    await this.redisService.del(repeatKey);
    await this.redisService.delPattern(`${ASK_KEY_PREFIX}${conversationId}:*`);
  }

  private async read(key: string): Promise<RepeatGuardState> {
    if (this.redisService) {
      return (await this.redisService.get<RepeatGuardState>(key)) ?? emptyState();
    }
    return this.memory.get(key) ?? emptyState();
  }

  private async write(key: string, state: RepeatGuardState): Promise<void> {
    if (this.redisService) {
      await this.redisService.set(key, state, REPEAT_TTL_SECONDS);
      return;
    }
    this.memory.set(key, state);
  }
}
