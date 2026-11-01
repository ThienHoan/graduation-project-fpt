import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

type MemoryCacheEntry = {
  value: any;
  expiresAt: number | null;
};

type MemoryWindowEntry = {
  count: number;
  expiresAt: number;
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  // In-memory fallback map if Redis is not configured or offline
  private readonly memoryStore = new Map<string, MemoryCacheEntry>();
  private readonly memoryCounters = new Map<string, number>();
  private readonly memoryWindows = new Map<string, MemoryWindowEntry>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl =
      this.configService.get<string>("REDIS_URL") ||
      process.env.REDIS_URL ||
      null;

    const host = this.configService.get<string>("REDIS_HOST") || "localhost";
    const port = Number(this.configService.get<number>("REDIS_PORT") || 6379);

    try {
      if (redisUrl) {
        this.client = new Redis(redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy(times) {
            // Stop retrying after 3 attempts if server is completely offline
            return times > 3 ? null : Math.min(times * 1000, 3000);
          },
        });
      } else {
        this.client = new Redis({
          host,
          port,
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy(times) {
            return times > 3 ? null : Math.min(times * 1000, 3000);
          },
        });
      }

      this.client.on("connect", () => {
        this.isConnected = true;
        this.logger.log("Connected to Redis server successfully (RAM Cache Active)");
      });

      this.client.on("error", (err) => {
        if (this.isConnected) {
          this.logger.warn(`Redis connection error: ${err.message}. Switching to Memory Cache.`);
        }
        this.isConnected = false;
      });

      this.client.on("close", () => {
        this.isConnected = false;
      });

      // Attempt initial connection (non-blocking)
      await this.client.connect().catch((err) => {
        this.logger.log(
          `Redis is not running (${err.message}). Using In-Memory Cache with TTL fallback.`,
        );
      });
    } catch {
      this.logger.log("Redis not detected. High-speed In-Memory Cache Active.");
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // ignore
      }
    }
  }

  /** Lấy trạng thái bộ nhớ đệm */
  getStatus() {
    return {
      connected: this.isConnected,
      mode: this.isConnected ? ("redis" as const) : ("memory" as const),
    };
  }

  /** Lấy dữ liệu cache theo key */
  async get<T>(key: string): Promise<T | null> {
    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
      } catch {
        // fallback to memory
      }
    }

    const entry = this.memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memoryStore.delete(key);
      return null;
    }
    return entry.value as T;
  }

  /** Lưu dữ liệu vào cache với thời gian sống (TTL giây) */
  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    const serialized = JSON.stringify(value);

    if (this.isConnected && this.client) {
      try {
        if (ttlSeconds > 0) {
          await this.client.set(key, serialized, "EX", ttlSeconds);
        } else {
          await this.client.set(key, serialized);
        }
        return;
      } catch {
        // fallback to memory
      }
    }

    this.memoryStore.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  /** Xóa 1 key trong cache */
  async del(key: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch {
        // ignore
      }
    }
    this.memoryStore.delete(key);
    this.memoryWindows.delete(key);
  }

  /** Xóa theo pattern (ví dụ: garments:*) */
  async delPattern(pattern: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } catch {
        // ignore
      }
    }

    // Match regex for memory store
    const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
    for (const k of this.memoryStore.keys()) {
      if (regex.test(k)) {
        this.memoryStore.delete(k);
      }
    }
    for (const k of this.memoryWindows.keys()) {
      if (regex.test(k)) {
        this.memoryWindows.delete(k);
      }
    }
  }

  /** Tăng bộ đếm nguyên tử (Atomic Counter) */
  async incr(key: string): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.incr(key);
      } catch {
        // fallback to memory
      }
    }

    const current = (this.memoryCounters.get(key) ?? 0) + 1;
    this.memoryCounters.set(key, current);
    return current;
  }

  /** SET NX (Set if Not Exists) với TTL - Chống trùng lặp (Deduplication) */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.isConnected && this.client) {
      try {
        const result = await this.client.set(key, value, "EX", ttlSeconds, "NX");
        return result === "OK";
      } catch {
        // fallback to memory
      }
    }

    const entry = this.memoryStore.get(key);
    if (entry && (!entry.expiresAt || Date.now() <= entry.expiresAt)) {
      return false; // key already exists
    }

    this.memoryStore.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return true;
  }

  /**
   * Xoá key chỉ khi giá trị còn khớp (compare-and-delete).
   * Dùng để nhả distributed lock mà không xoá nhầm lock của instance khác
   * trong trường hợp lock cũ đã hết TTL và instance khác vừa giành được.
   */
  async delIfValue(key: string, value: string): Promise<boolean> {
    if (this.isConnected && this.client) {
      try {
        const deleted = await this.client.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          1,
          key,
          value,
        );
        return Number(deleted) === 1;
      } catch {
        // fallback to memory
      }
    }

    const entry = this.memoryStore.get(key);
    const isAlive = entry && (!entry.expiresAt || Date.now() <= entry.expiresAt);
    if (isAlive && entry.value === value) {
      this.memoryStore.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Fixed-window counter dùng cho rate limiting phân tán.
   * Trả về số lần đã tăng và TTL còn lại (ms) của window.
   */
  async incrementWindow(
    key: string,
    ttlMs: number,
  ): Promise<{ count: number; ttlMs: number }> {
    const safeTtlMs = Math.max(1000, Math.floor(ttlMs));

    if (this.isConnected && this.client) {
      try {
        const result = (await this.client.eval(
          [
            "local current = redis.call('INCR', KEYS[1])",
            "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
            "local pttl = redis.call('PTTL', KEYS[1])",
            "return {current, pttl}",
          ].join("\n"),
          1,
          key,
          String(safeTtlMs),
        )) as [number, number];
        return {
          count: Number(result[0]),
          ttlMs: Math.max(0, Number(result[1])),
        };
      } catch {
        // fallback to memory
      }
    }

    const now = Date.now();
    const existing = this.memoryWindows.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.memoryWindows.set(key, { count: 1, expiresAt: now + safeTtlMs });
      return { count: 1, ttlMs: safeTtlMs };
    }

    existing.count += 1;
    return { count: existing.count, ttlMs: Math.max(0, existing.expiresAt - now) };
  }
}
