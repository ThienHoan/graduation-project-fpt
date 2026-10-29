/**
 * @blast-radius: core
 * Behavioral tests for RedisService: in-memory fallback, TTL expiration, cache invalidation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisService } from "./redis.service";

describe("RedisService", () => {
  let service: RedisService;
  const configService = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === "REDIS_URL") return null;
      if (key === "REDIS_HOST") return "127.0.0.1";
      if (key === "REDIS_PORT") return 6379;
      return null;
    }),
  };

  beforeEach(() => {
    service = new RedisService(configService as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("In-Memory Cache Fallback", () => {
    it("reports memory mode when Redis is not connected", () => {
      const status = service.getStatus();
      expect(status.mode).toBe("memory");
      expect(status.connected).toBe(false);
    });

    it("stores and retrieves values using in-memory store", async () => {
      await service.set("user:123", { name: "Nguyen Van A" });

      const cached = await service.get<{ name: string }>("user:123");
      expect(cached).toEqual({ name: "Nguyen Van A" });
    });

    it("expires keys after TTL seconds", async () => {
      vi.useFakeTimers();

      await service.set("temp:token", "abc-xyz", 10); // 10s TTL
      expect(await service.get("temp:token")).toBe("abc-xyz");

      // Advance time by 11 seconds
      vi.advanceTimersByTime(11000);

      expect(await service.get("temp:token")).toBeNull();
    });

    it("deletes a cached key", async () => {
      await service.set("cache:item", "val");
      expect(await service.get("cache:item")).toBe("val");

      await service.del("cache:item");
      expect(await service.get("cache:item")).toBeNull();
    });

    it("deletes multiple keys matching a pattern", async () => {
      await service.set("garment:catalog:1", "item1");
      await service.set("garment:catalog:2", "item2");
      await service.set("user:profile:1", "profile1");

      await service.delPattern("garment:catalog:*");

      expect(await service.get("garment:catalog:1")).toBeNull();
      expect(await service.get("garment:catalog:2")).toBeNull();
      expect(await service.get("user:profile:1")).toBe("profile1");
    });

    it("increments counters atomically", async () => {
      const first = await service.incr("rate:limit:ip1");
      expect(first).toBe(1);

      const second = await service.incr("rate:limit:ip1");
      expect(second).toBe(2);
    });
  });
});
