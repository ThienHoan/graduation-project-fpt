import { describe, expect, it, vi } from "vitest";
import { RedisThrottlerStorage } from "./redis-throttler.storage";

function createStorage(count: number, ttlMs: number) {
  const redis = {
    incrementWindow: vi.fn().mockResolvedValue({ count, ttlMs }),
  };
  return {
    redis,
    storage: new RedisThrottlerStorage(redis as any),
  };
}

describe("RedisThrottlerStorage", () => {
  it("uses a namespaced Redis window and reports remaining TTL", async () => {
    const { redis, storage } = createStorage(3, 42_000);

    const record = await storage.increment("user-1", 60_000, 10, 0, "default");

    expect(redis.incrementWindow).toHaveBeenCalledWith("throttle:default:user-1", 60_000);
    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it("blocks once the shared counter exceeds the limit", async () => {
    const { storage } = createStorage(11, 15_000);

    const record = await storage.increment("user-1", 60_000, 10, 0, "default");

    expect(record.isBlocked).toBe(true);
    expect(record.timeToBlockExpire).toBe(15);
  });

  it("never reports a zero TTL for an active window", async () => {
    const { storage } = createStorage(1, 0);

    const record = await storage.increment("user-1", 60_000, 10, 0, "default");

    expect(record.timeToExpire).toBe(1);
  });
});
