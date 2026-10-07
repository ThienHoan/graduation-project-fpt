import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AppRole, Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";
import { ADMIN_SETTING_DEFINITIONS, type AdminSettingDefinition } from "./admin.constants";
import { AdminAuditLogQueryDto } from "./dto/admin-audit-log-query.dto";
import { AdminUserQueryDto } from "./dto/admin-user-query.dto";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";
import { UpdateSystemSettingDto } from "./dto/update-system-setting.dto";

type AdminAuditLogEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: AppRole | null;
  createdAt: string;
  summary: string;
};

type AdminUserEntry = {
  id: string;
  email: string;
  role: AppRole;
  isActive: boolean;
  isEmailVerified: boolean;
  fullName: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
  bookingCount: number;
};

type AdminSettingEntry = {
  key: string;
  label: string;
  description: string;
  kind: AdminSettingDefinition["kind"];
  value: Prisma.JsonValue;
  updatedAt: string | null;
  isDefault: boolean;
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  available: "Sẵn sàng",
  reserved: "Đã giữ chỗ",
  rented: "Đang thuê",
  inspection_pending: "Chờ kiểm tra",
  laundry: "Giặt sấy",
  maintenance: "Bảo trì",
  damaged: "Hư hỏng",
  retired: "Đã thanh lý",
  lost: "Mất",
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  draft: "Nháp",
  pending_confirmation: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  awaiting_payment: "Chờ thanh toán",
  paid: "Đã thanh toán",
  preparing: "Đang chuẩn bị",
  ready_for_pickup: "Sẵn sàng nhận",
  delivering: "Đang giao",
  renting: "Đang thuê",
  returned: "Đã trả",
  inspection_pending: "Chờ kiểm tra",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  rejected: "Từ chối",
  overdue: "Quá hạn",
};

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const totalUsers = await this.prisma.userAccount.count();
    const activeUsers = await this.prisma.userAccount.count({ where: { isActive: true } });
    const adminUsers = await this.prisma.userAccount.count({ where: { role: AppRole.admin, isActive: true } });
    const totalGarments = await this.prisma.garment.count();
    const totalAssets = await this.prisma.garmentAsset.count();
    const pendingBookings = await this.prisma.booking.count({ where: { status: "pending_confirmation" } });
    const awaitingPaymentBookings = await this.prisma.booking.count({ where: { status: "awaiting_payment" } });
    const activeInspections = await this.prisma.inspectionSession.count({ where: { status: { in: ["pending", "in_progress"] } } });
    const laundryQueue = await this.prisma.laundryTicket.count({ where: { status: { in: ["open", "in_progress"] } } });
    const maintenanceQueue = await this.prisma.maintenanceJob.count({ where: { status: { in: ["open", "in_progress"] } } });
    const recentLogs = await this.prisma.auditLog.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      include: {
        actor: {
          include: {
            profile: true,
          },
        },
      },
    });
    const assetBreakdown = await this.prisma.garmentAsset.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const bookingBreakdown = await this.prisma.booking.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const revenueTotals = await this.prisma.booking.aggregate({
      _sum: {
        rentalTotal: true,
        depositTotal: true,
        penaltyTotal: true,
      },
    });
    const auditLogs24h = await this.prisma.auditLog.count({ where: { createdAt: { gte: twentyFourHoursAgo } } });
    const storedSettings = await this.prisma.systemSetting.findMany();

    return ok({
      summary: [
        {
          key: "users",
          label: "Tài khoản",
          value: totalUsers,
          hint: `${activeUsers} đang hoạt động, ${adminUsers} quản trị viên`,
          tone: "rose",
        },
        {
          key: "catalog",
          label: "Mẫu trang phục",
          value: totalGarments,
          hint: `${totalAssets} tài sản vật lý đang được quản lý`,
          tone: "emerald",
        },
        {
          key: "finance",
          label: "Tổng giá trị đơn",
          value: Number(revenueTotals._sum.rentalTotal ?? 0) + Number(revenueTotals._sum.penaltyTotal ?? 0),
          hint: `${Number(revenueTotals._sum.depositTotal ?? 0)} tiền cọc đang giữ`,
          tone: "amber",
        },
        {
          key: "activity",
          label: "Sự kiện 24h",
          value: auditLogs24h,
          hint: `${pendingBookings + awaitingPaymentBookings + activeInspections + laundryQueue + maintenanceQueue} đầu việc đang chờ xử lý`,
          tone: "slate",
        },
      ],
      queues: [
        {
          key: "bookings_pending",
          label: "Đơn chờ xác nhận",
          value: pendingBookings,
          hint: "Cần admin hoặc vận hành duyệt nhanh.",
          tone: "amber",
        },
        {
          key: "bookings_payment",
          label: "Đơn chờ thanh toán",
          value: awaitingPaymentBookings,
          hint: "Theo dõi trước khi chuyển sang khâu chuẩn bị.",
          tone: "rose",
        },
        {
          key: "inspections",
          label: "Phiên kiểm tra",
          value: activeInspections,
          hint: "Đơn đã trả nhưng chưa hoàn tất kiểm tra.",
          tone: "emerald",
        },
        {
          key: "laundry",
          label: "Phiếu giặt sấy",
          value: laundryQueue,
          hint: "Trang phục cần hoàn tất chu trình vệ sinh.",
          tone: "slate",
        },
        {
          key: "maintenance",
          label: "Yêu cầu bảo trì",
          value: maintenanceQueue,
          hint: "Món hàng cần sửa chữa hoặc thanh lý.",
          tone: "rose",
        },
      ],
      assetBreakdown: assetBreakdown
        .map((item) => ({
          status: item.status,
          label: ASSET_STATUS_LABELS[item.status] ?? item.status,
          count: item._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      bookingBreakdown: bookingBreakdown
        .map((item) => ({
          status: item.status,
          label: BOOKING_STATUS_LABELS[item.status] ?? item.status,
          count: item._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      recentActivity: recentLogs.map((entry) => this.serializeAuditLog(entry)),
      settingsSnapshot: this.serializeSettings(storedSettings),
    });
  }

  async listUsers(query: AdminUserQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.UserAccountWhereInput = {};

    if (query.role) {
      where.role = query.role;
    }

    if (query.status === "active") {
      where.isActive = true;
    } else if (query.status === "inactive") {
      where.isActive = false;
    }

    if (query.search) {
      const search = query.search;
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { profile: { is: { fullName: { contains: search, mode: "insensitive" } } } },
        { profile: { is: { phone: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.userAccount.findMany({
        where,
        orderBy: [{ role: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          profile: true,
          _count: {
            select: { bookings: true },
          },
        },
      }),
      this.prisma.userAccount.count({ where }),
    ]);

    return ok({
      items: items.map((item) => this.serializeUser(item)),
      total,
      page,
      limit,
    });
  }

  async updateUser(userId: string, actor: AuthenticatedUser, dto: UpdateAdminUserDto) {
    const target = await this.prisma.userAccount.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    });

    if (!target) {
      throw new NotFoundException("User account not found.");
    }

    const profileData = this.pickDefined({
      fullName: dto.fullName,
      phone: dto.phone,
    });

    const accountData = this.pickDefined({
      role: dto.role,
      isActive: dto.isActive,
    });

    if (Object.keys(profileData).length === 0 && Object.keys(accountData).length === 0) {
      throw new BadRequestException("At least one user field is required.");
    }

    if (actor.id === userId && (dto.role !== undefined || dto.isActive === false)) {
      throw new ForbiddenException("Bạn không thể tự hạ quyền hoặc vô hiệu hóa chính mình.");
    }

    const nextRole = dto.role ?? target.role;
    const nextIsActive = dto.isActive ?? target.isActive;

    if (target.role === AppRole.admin && (nextRole !== AppRole.admin || nextIsActive === false)) {
      const activeAdmins = await this.prisma.userAccount.count({
        where: {
          role: AppRole.admin,
          isActive: true,
          NOT: { id: userId },
        },
      });

      if (activeAdmins === 0) {
        throw new BadRequestException("Hệ thống phải giữ lại ít nhất một quản trị viên đang hoạt động.");
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(profileData).length > 0) {
        await tx.profile.upsert({
          where: { userId },
          update: profileData,
          create: { userId, ...profileData },
        });
      }

      if (Object.keys(accountData).length > 0) {
        await tx.userAccount.update({
          where: { id: userId },
          data: accountData,
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "ADMIN_UPDATE_USER",
          entityType: "user_account",
          entityId: userId,
          metadata: {
            changed: {
              ...accountData,
              ...profileData,
            },
          },
        },
      });

      return tx.userAccount.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          _count: {
            select: { bookings: true },
          },
        },
      });
    });

    if (!updated) {
      throw new NotFoundException("User account not found after update.");
    }

    return ok(this.serializeUser(updated));
  }

  async listAuditLogs(query: AdminAuditLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AuditLogWhereInput = {};

    if (query.action && query.action !== "all") {
      where.action = query.action;
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.search) {
      const search = query.search;
      where.OR = [
        { action: { contains: search, mode: "insensitive" } },
        { entityType: { contains: search, mode: "insensitive" } },
        { actor: { is: { email: { contains: search, mode: "insensitive" } } } },
        { actor: { is: { profile: { is: { fullName: { contains: search, mode: "insensitive" } } } } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: {
            include: {
              profile: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return ok({
      items: items.map((item) => this.serializeAuditLog(item)),
      total,
      page,
      limit,
    });
  }

  async listSettings() {
    const stored = await this.prisma.systemSetting.findMany();
    return ok(this.serializeSettings(stored));
  }

  async updateSetting(key: string, actor: AuthenticatedUser, dto: UpdateSystemSettingDto) {
    const definition = this.getSettingDefinition(key);
    this.validateSettingValue(definition, dto.value);

    const updated = await this.prisma.$transaction(async (tx) => {
      const setting = await tx.systemSetting.upsert({
        where: { key },
        create: {
          key,
          value: dto.value as Prisma.InputJsonValue,
        },
        update: {
          value: dto.value as Prisma.InputJsonValue,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "ADMIN_UPDATE_SETTING",
          entityType: "system_setting",
          entityId: null,
          metadata: {
            key,
            value: dto.value as Prisma.InputJsonValue,
          },
        },
      });

      return setting;
    });

    return ok(this.serializeSetting(updated));
  }

  private serializeUser(user: Prisma.UserAccountGetPayload<{
    include: {
      profile: true;
      _count: { select: { bookings: true } };
    };
  }>): AdminUserEntry {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      fullName: user.profile?.fullName ?? null,
      phone: user.profile?.phone ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      bookingCount: user._count.bookings,
    };
  }

  private serializeAuditLog(log: Prisma.AuditLogGetPayload<{
    include: {
      actor: { include: { profile: true } };
    };
  }>): AdminAuditLogEntry {
    const actorName = log.actor?.profile?.fullName ?? log.actor?.email ?? null;

    return {
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata,
      actorId: log.actorId,
      actorName,
      actorEmail: log.actor?.email ?? null,
      actorRole: log.actor?.role ?? null,
      createdAt: log.createdAt.toISOString(),
      summary: this.buildAuditSummary(log.action, log.entityType, log.metadata),
    };
  }

  private serializeSettings(settings: { key: string; value: Prisma.JsonValue; updatedAt: Date }[]): AdminSettingEntry[] {
    const storedMap = new Map(settings.map((setting) => [setting.key, setting] as const));
    const knownKeys = new Set(ADMIN_SETTING_DEFINITIONS.map((item) => item.key));

    const fromDefinitions = ADMIN_SETTING_DEFINITIONS.map((definition) => this.serializeSettingFromDefinition(definition, storedMap.get(definition.key) ?? null));
    const extras = settings
      .filter((setting) => !knownKeys.has(setting.key))
      .map((setting) => ({
        key: setting.key,
        label: this.humanizeSettingKey(setting.key),
        description: "Thiết lập tuỳ chỉnh đã được lưu trong hệ thống.",
        kind: "json" as const,
        value: setting.value,
        updatedAt: setting.updatedAt.toISOString(),
        isDefault: false,
      }));

    return [...fromDefinitions, ...extras].sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }

  private serializeSetting(setting: { key: string; value: Prisma.JsonValue; updatedAt: Date }): AdminSettingEntry {
    const definition = this.getSettingDefinition(setting.key);
    return {
      key: setting.key,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      value: setting.value,
      updatedAt: setting.updatedAt.toISOString(),
      isDefault: false,
    };
  }

  private serializeSettingFromDefinition(
    definition: AdminSettingDefinition,
    stored: { key: string; value: Prisma.JsonValue; updatedAt: Date } | null,
  ): AdminSettingEntry {
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      value: (stored?.value ?? definition.defaultValue) as Prisma.JsonValue,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
      isDefault: stored == null,
    };
  }

  private getSettingDefinition(key: string) {
    return ADMIN_SETTING_DEFINITIONS.find((definition) => definition.key === key) ?? {
      key,
      label: this.humanizeSettingKey(key),
      description: "Thiết lập tuỳ chỉnh đã lưu trong hệ thống.",
      kind: "json" as const,
      defaultValue: null,
    };
  }

  private validateSettingValue(definition: AdminSettingDefinition, value: unknown) {
    if (definition.kind === "number") {
      const numericValue = this.extractValueField(value);
      if (typeof numericValue !== "number" || Number.isNaN(numericValue)) {
        throw new BadRequestException(`Thiết lập '${definition.key}' cần một giá trị số.`);
      }
      return;
    }

    if (definition.kind === "text") {
      const textValue = this.extractValueField(value);
      if (typeof textValue !== "string") {
        throw new BadRequestException(`Thiết lập '${definition.key}' cần một chuỗi văn bản.`);
      }
      return;
    }

    if (definition.key === "business_hours") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new BadRequestException("Thiết lập 'business_hours' cần một đối tượng JSON hợp lệ.");
      }

      const candidate = value as { open?: unknown; close?: unknown; days?: unknown };
      if (typeof candidate.open !== "string" || typeof candidate.close !== "string" || !Array.isArray(candidate.days)) {
        throw new BadRequestException("Thiết lập 'business_hours' phải gồm open, close và days.");
      }
      return;
    }
  }

  private extractValueField(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
      return (value as { value: unknown }).value;
    }
    return value;
  }

  private buildAuditSummary(action: string, entityType: string, metadata: Prisma.JsonValue | null) {
    const prettyAction = action
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

    const prettyEntity = entityType.replace(/_/g, " ");
    const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
    const changed = meta?.changed && typeof meta.changed === "object" ? Object.keys(meta.changed as Record<string, unknown>).join(", ") : null;
    const key = typeof meta?.key === "string" ? meta.key : null;

    if (changed) {
      return `${prettyAction} ${prettyEntity}: ${changed}`;
    }

    if (key) {
      return `${prettyAction} ${prettyEntity}: ${key}`;
    }

    return `${prettyAction} ${prettyEntity}`;
  }

  private humanizeSettingKey(key: string) {
    return key
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  private pickDefined<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
  }
}
