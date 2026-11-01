import { CanActivate, Injectable, type ExecutionContext } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Cho phép cả khách chưa đăng nhập và người đã đăng nhập.
 *
 * - Không có header Authorization → coi là khách ẩn danh, cho qua.
 * - Có header → xác thực như JwtAuthGuard (token sai/hết hạn vẫn bị 401),
 *   và gắn req.user để các guard phía sau (ví dụ rate limit theo user) dùng được.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtAuthGuard: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
    }>();

    if (!request.headers?.authorization) {
      return true;
    }

    return this.jwtAuthGuard.canActivate(context);
  }
}
