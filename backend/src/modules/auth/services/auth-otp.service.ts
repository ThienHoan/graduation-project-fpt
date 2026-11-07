import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../redis/redis.service";

export interface OtpAttemptResult {
  remainingAttempts: number;
  isExhausted: boolean;
}

export interface CooldownStatus {
  canResend: boolean;
  remainingSeconds: number;
}

@Injectable()
export class AuthOtpService {
  private readonly logger = new Logger(AuthOtpService.name);

  readonly MAX_VERIFICATION_ATTEMPTS = 5;
  readonly RESEND_COOLDOWN_SECONDS = 60; // 60 seconds between resend requests
  readonly CODE_EXPIRATION_MINUTES = 10;

  private readonly OTP_ATTEMPTS_PREFIX = "auth:otp:attempts:";
  private readonly OTP_COOLDOWN_PREFIX = "auth:otp:cooldown:";

  constructor(private readonly redisService: RedisService) {}

  /**
   * Generates a random 6-digit numeric OTP code.
   */
  generateCode(): string {
    return Math.floor(100_000 + Math.random() * 900_000).toString();
  }

  /**
   * Checks whether the user must wait before requesting a new OTP.
   */
  async checkResendCooldown(userId: string): Promise<CooldownStatus> {
    const key = `${this.OTP_COOLDOWN_PREFIX}${userId}`;
    const expiresAt = await this.redisService.get<number>(key);

    if (!expiresAt) {
      return { canResend: true, remainingSeconds: 0 };
    }

    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    if (remaining === 0) {
      await this.redisService.del(key);
      return { canResend: true, remainingSeconds: 0 };
    }

    return { canResend: false, remainingSeconds: remaining };
  }

  /**
   * Sets the resend cooldown timer after sending an OTP.
   */
  async setResendCooldown(userId: string): Promise<void> {
    const key = `${this.OTP_COOLDOWN_PREFIX}${userId}`;
    const expiresAt = Date.now() + this.RESEND_COOLDOWN_SECONDS * 1000;
    await this.redisService.set(key, expiresAt, this.RESEND_COOLDOWN_SECONDS);
  }

  /**
   * Records a failed OTP verification attempt.
   * If attempts reach MAX_VERIFICATION_ATTEMPTS, marks code as exhausted.
   */
  async recordFailedAttempt(codeRecordId: string): Promise<OtpAttemptResult> {
    const key = `${this.OTP_ATTEMPTS_PREFIX}${codeRecordId}`;
    const current = (await this.redisService.get<number>(key)) || 0;
    const newCount = current + 1;

    // Persist attempts with expiration matching standard 10m TTL
    await this.redisService.set(key, newCount, this.CODE_EXPIRATION_MINUTES * 60);

    const remaining = Math.max(0, this.MAX_VERIFICATION_ATTEMPTS - newCount);
    const isExhausted = newCount >= this.MAX_VERIFICATION_ATTEMPTS;

    if (isExhausted) {
      this.logger.warn(`OTP code ${codeRecordId} has exceeded max verification attempts (${this.MAX_VERIFICATION_ATTEMPTS})`);
    }

    return {
      remainingAttempts: remaining,
      isExhausted,
    };
  }

  /**
   * Cleans up attempt counters when an OTP is successfully verified.
   */
  async clearAttempts(codeRecordId: string): Promise<void> {
    await this.redisService.del(`${this.OTP_ATTEMPTS_PREFIX}${codeRecordId}`);
  }
}

