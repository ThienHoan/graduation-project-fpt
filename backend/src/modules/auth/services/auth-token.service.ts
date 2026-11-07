import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { RedisService } from "../../redis/redis.service";
import type { AppRole } from "@prisma/client";

export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: AppRole;
  tokenType: "access" | "password-reset";
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);
  private readonly BLACKLIST_PREFIX = "auth:blacklist:";

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Generates a signed 7-day JWT access token for the given user.
   */
  async generateAccessToken(user: { id: string; email: string; role: AppRole }): Promise<string> {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenType: "access",
    });
  }

  /**
   * Decodes a JWT token without verification to read its expiration and subject.
   */
  decodeToken(token: string): JwtTokenPayload | null {
    try {
      return this.jwtService.decode(token) as JwtTokenPayload | null;
    } catch {
      return null;
    }
  }

  /**
   * Verifies the signature and expiration of a JWT token.
   */
  async verifyToken<T extends object = JwtTokenPayload>(token: string): Promise<T> {
    return this.jwtService.verifyAsync<T>(token);
  }

  /**
   * Blacklists a token until its natural expiration so it can no longer be used.
   */
  async blacklistToken(token: string): Promise<void> {
    const payload = this.decodeToken(token);
    if (!payload || !payload.exp) {
      // If token has no exp or is malformed, store for default 1 day
      await this.redisService.set(`${this.BLACKLIST_PREFIX}${token}`, "1", 86400);
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const remainingSeconds = payload.exp - nowSeconds;

    if (remainingSeconds > 0) {
      await this.redisService.set(`${this.BLACKLIST_PREFIX}${token}`, "1", remainingSeconds);
      this.logger.log(`Token blacklisted for sub=${payload.sub}, TTL=${remainingSeconds}s`);
    }
  }

  /**
   * Checks whether a token has been blacklisted (e.g. after logout).
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const val = await this.redisService.get<string>(`${this.BLACKLIST_PREFIX}${token}`);
    return val !== null;
  }

  /**
   * Extracts a Bearer token from an Authorization header value.
   */
  extractToken(authHeader?: string): string | null {
    if (!authHeader) return null;
    const [scheme, token] = authHeader.trim().split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) return null;
    return token;
  }
}

