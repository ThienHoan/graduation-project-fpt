import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import type { ClientInfo } from "../utils/client-info.util";

export type AuthAuditEventType =
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGOUT"
  | "AUTH_REGISTER"
  | "AUTH_EMAIL_VERIFIED"
  | "AUTH_PASSWORD_RESET_REQUESTED"
  | "AUTH_PASSWORD_RESET_SUCCESS"
  | "AUTH_PASSWORD_CHANGED"
  | "AUTH_ACCOUNT_LOCKED";

export interface LogAuthEventInput {
  actorId?: string | null;
  action: AuthAuditEventType;
  entityId?: string | null;
  clientInfo?: Partial<ClientInfo> | null;
  details?: Record<string, unknown>;
}

export interface SecurityActivityItem {
  id: string;
  action: AuthAuditEventType;
  actionLabel: string;
  ip: string;
  browser: string;
  os: string;
  deviceType: string;
  createdAt: Date;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a security authentication audit event into the database.
   */
  async logAuthEvent(input: LogAuthEventInput): Promise<void> {
    try {
      const metadata = {
        ip: input.clientInfo?.ip || "unknown",
        browser: input.clientInfo?.browser || "unknown",
        os: input.clientInfo?.os || "unknown",
        deviceType: input.clientInfo?.deviceType || "desktop",
        userAgent: input.clientInfo?.userAgent || "unknown",
        ...input.details,
      };

      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: "AUTH",
          entityId: input.entityId ?? null,
          metadata,
        },
      });
    } catch (err) {
      // Audit logging failures must not break the critical auth flow, but should be reported in logs
      this.logger.error(`Failed to record auth audit log for action=${input.action}: ${(err as Error).message}`);
    }
  }

  /**
   * Retrieves the most recent security and authentication activities for a user.
   */
  async getUserSecurityActivity(userId: string, limit = 10): Promise<SecurityActivityItem[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        actorId: userId,
        entityType: "AUTH",
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(50, Math.max(1, limit)),
    });

    return logs.map((log) => {
      const meta = (log.metadata as Record<string, any>) || {};
      const action = log.action as AuthAuditEventType;

      return {
        id: log.id,
        action,
        actionLabel: this.getActionLabel(action),
        ip: String(meta.ip || "unknown"),
        browser: String(meta.browser || "unknown"),
        os: String(meta.os || "unknown"),
        deviceType: String(meta.deviceType || "desktop"),
        createdAt: log.createdAt,
        details: meta,
      };
    });
  }

  /**
   * Converts an audit action code into a human-friendly Vietnamese label.
   */
  private getActionLabel(action: AuthAuditEventType): string {
    switch (action) {
      case "AUTH_LOGIN_SUCCESS":
        return "Đăng nhập thành công";
      case "AUTH_LOGIN_FAILED":
        return "Đăng nhập không thành công";
      case "AUTH_LOGOUT":
        return "Đăng xuất khỏi thiết bị";
      case "AUTH_REGISTER":
        return "Đăng ký tài khoản mới";
      case "AUTH_EMAIL_VERIFIED":
        return "Xác thực email thành công";
      case "AUTH_PASSWORD_RESET_REQUESTED":
        return "Yêu cầu mã đặt lại mật khẩu";
      case "AUTH_PASSWORD_RESET_SUCCESS":
        return "Đặt lại mật khẩu thành công";
      case "AUTH_PASSWORD_CHANGED":
        return "Đổi mật khẩu tài khoản";
      case "AUTH_ACCOUNT_LOCKED":
        return "Tài khoản bị tạm khóa bảo vệ";
      default:
        return action;
    }
  }
}

