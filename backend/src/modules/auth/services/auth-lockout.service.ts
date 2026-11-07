import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../redis/redis.service";

export interface LockoutStatus {
  isLocked: boolean;
  remainingSeconds: number;
}

export interface FailedAttemptResult extends LockoutStatus {
  attempts: number;
  maxAttempts: number;
}

@Injectable()
export class AuthLockoutService {
  private readonly logger = new Logger(AuthLockoutService.name);

  readonly MAX_ATTEMPTS = 5;
  readonly LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
  readonly WINDOW_SECONDS = 15 * 60;

  private readonly ATTEMPTS_PREFIX = "auth:lockout:attempts:";
  private readonly LOCKED_PREFIX = "auth:lockout:locked:";

  constructor(private readonly redisService: RedisService) {}

  /**
   * Checks whether an email address is currently locked out due to excessive failed attempts.
   */
  async isLocked(email: string): Promise<LockoutStatus> {
    const normalized = email.trim().toLowerCase();
    const lockKey = `${this.LOCKED_PREFIX}${normalized}`;
    const lockedUntil = await this.redisService.get<number>(lockKey);

    if (!lockedUntil) {
      return { isLocked: false, remainingSeconds: 0 };
    }

    const remainingSeconds = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
    if (remainingSeconds === 0) {
      await this.redisService.del(lockKey);
      return { isLocked: false, remainingSeconds: 0 };
    }

    return { isLocked: true, remainingSeconds };
  }

  /**
   * Records a failed login attempt for the given email.
   * If threshold is met, sets a lockout period.
   */
  async recordFailedAttempt(email: string): Promise<FailedAttemptResult> {
    const normalized = email.trim().toLowerCase();
    const attemptsKey = `${this.ATTEMPTS_PREFIX}${normalized}`;
    const lockKey = `${this.LOCKED_PREFIX}${normalized}`;

    // Get current attempts count
    const currentAttempts = (await this.redisService.get<number>(attemptsKey)) || 0;
    const newAttempts = currentAttempts + 1;

    await this.redisService.set(attemptsKey, newAttempts, this.WINDOW_SECONDS);

    if (newAttempts >= this.MAX_ATTEMPTS) {
      const lockUntil = Date.now() + this.LOCKOUT_DURATION_SECONDS * 1000;
      await this.redisService.set(lockKey, lockUntil, this.LOCKOUT_DURATION_SECONDS);
      this.logger.warn(`Account locked due to brute force protection: email=${normalized}, duration=${this.LOCKOUT_DURATION_SECONDS}s`);

      return {
        attempts: newAttempts,
        maxAttempts: this.MAX_ATTEMPTS,
        isLocked: true,
        remainingSeconds: this.LOCKOUT_DURATION_SECONDS,
      };
    }

    return {
      attempts: newAttempts,
      maxAttempts: this.MAX_ATTEMPTS,
      isLocked: false,
      remainingSeconds: 0,
    };
  }

  /**
   * Clears failed attempt counters upon a successful login.
   */
  async clearFailedAttempts(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this.redisService.del(`${this.ATTEMPTS_PREFIX}${normalized}`);
    await this.redisService.del(`${this.LOCKED_PREFIX}${normalized}`);
  }

  /**
   * Calculates how many attempts remain before the account will be locked.
   */
  async getRemainingAttempts(email: string): Promise<number> {
    const normalized = email.trim().toLowerCase();
    const current = (await this.redisService.get<number>(`${this.ATTEMPTS_PREFIX}${normalized}`)) || 0;
    return Math.max(0, this.MAX_ATTEMPTS - current);
  }
}

