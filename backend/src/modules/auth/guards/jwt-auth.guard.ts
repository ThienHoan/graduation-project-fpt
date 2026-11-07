import { CanActivate, Injectable, Optional, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AppRole } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { toAuthenticatedUser, type AuthenticatedUser } from "../auth-user";
import { AuthTokenService } from "../services/auth-token.service";

type JwtPayload = {
  sub?: string;
  email?: string;
  role?: AppRole;
  tokenType?: "access" | "password-reset";
  iat?: number;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Optional() private readonly tokenService?: AuthTokenService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
    }>();
    const token = this.extractBearerToken(request.headers.authorization);

    // [SECURITY] Check server-side token blacklist (e.g. after explicit logout)
    if (this.tokenService && (await this.tokenService.isTokenBlacklisted(token))) {
      throw new UnauthorizedException("Token has been revoked.");
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token.");
    }

    if (payload.tokenType && payload.tokenType !== "access") {
      throw new UnauthorizedException("Invalid token type.");
    }

    if (typeof payload.iat !== "number") {
      throw new UnauthorizedException("Token payload is missing issued-at time.");
    }

    if (!payload.sub) {
      throw new UnauthorizedException("Token payload is missing subject.");
    }

    const user = await this.prisma.userAccount.findUnique({
      where: { id: payload.sub },
      include: { profile: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("User is inactive or no longer exists.");
    }

    // [SECURITY & RELIABILITY] Invalidate stale tokens if updatedAt is significantly
    // newer than token issuance (e.g. after password reset).
    // We add a 5000ms grace window because:
    // 1. JWT iat is truncated to integer seconds.
    // 2. DB updatedAt has millisecond precision and trigger updates on user_accounts.
    // 3. Application server and database server clocks can drift slightly in production.
    // Without this grace period, any token issued at or near an update is immediately
    // rejected on tab reload, causing the production logout issue.
    if (payload.iat * 1000 + 5000 < user.updatedAt.getTime()) {
      throw new UnauthorizedException("Token has been invalidated.");
    }

    request.user = toAuthenticatedUser(user);
    return true;
  }

  private extractBearerToken(authorizationHeader?: string) {
    if (!authorizationHeader) {
      throw new UnauthorizedException("Missing authorization token.");
    }

    const [scheme, token] = authorizationHeader.trim().split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("Invalid authorization header.");
    }

    return token;
  }
}
