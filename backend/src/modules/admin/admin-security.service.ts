import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppRole, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";
import { AdminSecurityQueryDto } from "./dto/admin-security-query.dto";

export const ADMIN_SECURITY_ACTION_LABELS: Record<string, string> = {
  ADMIN_UPDATE_USER: "Cập nhật tài khoản",
  ADMIN_REVOKE_SESSIONS: "Buộc đăng xuất",
  ADMIN_VERIFY_EMAIL: "Xác minh email thủ công",
  ADMIN_EXPORT_DATA: "Xuất dữ liệu",
};

const STALE_UNVERIFIED_HOURS = 24;

@Injectable()
export class AdminSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const staleBefore = new Date(Date.now() - STALE_UNVERIFIED_HOURS * 60 * 60 * 1000);

    const [total, inactive, unverified, staleUnverified, privilegedActive, activeAdmins, events] = await Promise.all([
      this.prisma.userAccount.count(),
      this.prisma.userAccount.count({ where: { isActive: false } }),
      this.prisma.userAccount.count({ where: { isEmailVerified: false } }),
      this.prisma.userAccount.count({ where: { isEmailVerified: false, createdAt: { lt: staleBefore } } }),
      this.prisma.userAccount.count({ where: { isActive: true, role: { not: AppRole.customer } } }),
      this.prisma.userAccount.count({ where: { isActive: true, role: AppRole.admin } }),
      this.prisma.auditLog.findMany({
        where: { action: { in: Object.keys(ADMIN_SECURITY_ACTION_LABELS) } },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { actor: { include: { profile: true } } },
      }),
    ]);

    return ok({
      stats: { total, inactive, unverified, staleUnverified, privilegedActive, activeAdmins },
      staleUnverifiedHours: STALE_UNVERIFIED_HOURS,
      recentEvents: events.map((event) => {
        const meta =
          event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
            ? (event.metadata as Record<string, unknown>)
            : null;
        return {
          id: event.id,
          action: event.action,
          label: ADMIN_SECURITY_ACTION_LABELS[event.action] ?? event.action,
          actorName: event.actor?.profile?.fullName ?? event.actor?.email ?? null,
          targetEmail: typeof meta?.targetEmail === "string" ? meta.targetEmail : null,
          createdAt: event.createdAt.toISOString(),
        };
      }),
    });
  }

  async listAccounts(query: AdminSecurityQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const type = query.type ?? "inactive";

    const where: Prisma.UserAccountWhereInput = {};
    if (type === "inactive") where.isActive = false;
    if (type === "unverified") where.isEmailVerified = false;
    if (type === "privileged") where.role = { not: AppRole.customer };

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { profile: { is: { fullName: { contains: query.search, mode: "insensitive" } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.userAccount.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { profile: true },
      }),
      this.prisma.userAccount.count({ where }),
    ]);

    return ok({
      items: items.map((item) => ({
        id: item.id,
        email: item.email,
        role: item.role,
        isActive: item.isActive,
        isEmailVerified: item.isEmailVerified,
        fullName: item.profile?.fullName ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    });
  }

  /**
   * JwtAuthGuard rejects every token issued before `user_accounts.updated_at`,
   * so bumping that timestamp signs the user out of all devices without a schema change.
   */
  async revokeSessions(userId: string, actor: AuthenticatedUser) {
    if (actor.id === userId) {
      throw new ForbiddenException("Bạn không thể buộc đăng xuất chính mình.");
    }

    const target = await this.prisma.userAccount.findUnique({ where: { id: userId } });
    if (!target) {
      throw new NotFoundException("User account not found.");
    }

    const revokedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.userAccount.update({ where: { id: userId }, data: { updatedAt: revokedAt } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "ADMIN_REVOKE_SESSIONS",
          entityType: "user_account",
          entityId: userId,
          metadata: { targetEmail: target.email },
        },
      });
    });

    return ok({ id: userId, revokedAt: revokedAt.toISOString() }, "Đã buộc tài khoản đăng xuất khỏi mọi thiết bị.");
  }

  async verifyEmail(userId: string, actor: AuthenticatedUser) {
    const target = await this.prisma.userAccount.findUnique({ where: { id: userId } });
    if (!target) {
      throw new NotFoundException("User account not found.");
    }
    if (target.isEmailVerified) {
      throw new BadRequestException("Email của tài khoản này đã được xác minh.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userAccount.update({ where: { id: userId }, data: { isEmailVerified: true } });
      await tx.emailVerificationCode.updateMany({ where: { userId, used: false }, data: { used: true } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "ADMIN_VERIFY_EMAIL",
          entityType: "user_account",
          entityId: userId,
          metadata: { targetEmail: target.email },
        },
      });
    });

    return ok({ id: userId, isEmailVerified: true }, "Đã xác minh email thủ công.");
  }
}
