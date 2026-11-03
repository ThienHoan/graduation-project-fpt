import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "../auth/auth-user";
import { ADMIN_SETTING_KEYS } from "./admin.constants";
import { ADMIN_EXPORT_DATASETS, type AdminExportDataset, type AdminExportQueryDto } from "./dto/admin-export-query.dto";

export const ADMIN_EXPORT_MAX_ROWS = 20000;

type Cell = string | number | boolean | Date | null | undefined;

/** Neutralise spreadsheet formulas (CSV injection) and quote cells that need it. */
export function toCsvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(toCsvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

function parseRange(query: AdminExportQueryDto) {
  const from = query.from ? new Date(`${query.from}T00:00:00+07:00`) : undefined;
  const to = query.to ? new Date(`${query.to}T23:59:59.999+07:00`) : undefined;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new BadRequestException("Khoảng ngày không hợp lệ.");
  }
  if (from && to && from > to) {
    throw new BadRequestException("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
  }
  return { from, to };
}

function createdAtFilter(range: { from?: Date; to?: Date }) {
  if (!range.from && !range.to) return undefined;
  return { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) };
}

@Injectable()
export class AdminExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportDataset(datasetParam: string, query: AdminExportQueryDto, actor: AuthenticatedUser) {
    if (!(ADMIN_EXPORT_DATASETS as readonly string[]).includes(datasetParam)) {
      throw new BadRequestException("Loại dữ liệu xuất không được hỗ trợ.");
    }
    const dataset = datasetParam as AdminExportDataset;
    const range = parseRange(query);
    const createdAt = createdAtFilter(range);

    const built =
      dataset === "users"
        ? await this.buildUsers(createdAt)
        : dataset === "bookings"
          ? await this.buildBookings(createdAt)
          : await this.buildAuditLogs(createdAt);

    const truncated = built.rows.length > ADMIN_EXPORT_MAX_ROWS;
    const rows = truncated ? built.rows.slice(0, ADMIN_EXPORT_MAX_ROWS) : built.rows;
    const stamp = new Date().toISOString().slice(0, 10);

    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "ADMIN_EXPORT_DATA",
        entityType: "export",
        entityId: null,
        metadata: { dataset, from: query.from ?? null, to: query.to ?? null, rows: rows.length, truncated },
      },
    });

    return ok({
      dataset,
      filename: `${dataset}-${stamp}.csv`,
      csv: toCsv(built.headers, rows),
      rows: rows.length,
      truncated,
      maxRows: ADMIN_EXPORT_MAX_ROWS,
    });
  }

  private async buildUsers(createdAt: Prisma.DateTimeFilter | undefined) {
    // password_hash is intentionally never selected.
    const users = await this.prisma.userAccount.findMany({
      where: createdAt ? { createdAt } : undefined,
      orderBy: { createdAt: "desc" },
      take: ADMIN_EXPORT_MAX_ROWS + 1,
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
        profile: { select: { fullName: true, phone: true } },
        _count: { select: { bookings: true } },
      },
    });

    return {
      headers: ["ID", "Email", "Họ tên", "Số điện thoại", "Vai trò", "Hoạt động", "Đã xác minh email", "Số đơn thuê", "Ngày tạo"],
      rows: users.map((u): Cell[] => [
        u.id,
        u.email,
        u.profile?.fullName,
        u.profile?.phone,
        u.role,
        u.isActive ? "Có" : "Không",
        u.isEmailVerified ? "Có" : "Không",
        u._count.bookings,
        u.createdAt,
      ]),
    };
  }

  private async buildBookings(createdAt: Prisma.DateTimeFilter | undefined) {
    const bookings = await this.prisma.booking.findMany({
      where: createdAt ? { createdAt } : undefined,
      orderBy: { createdAt: "desc" },
      take: ADMIN_EXPORT_MAX_ROWS + 1,
      select: {
        id: true,
        status: true,
        rentalStartDate: true,
        rentalEndDate: true,
        pickupMethod: true,
        paymentMethod: true,
        subtotal: true,
        discountTotal: true,
        shippingFee: true,
        rentalTotal: true,
        depositTotal: true,
        penaltyTotal: true,
        voucherCode: true,
        createdAt: true,
        customer: { select: { email: true, profile: { select: { fullName: true } } } },
      },
    });

    const day = (value: Date) => value.toISOString().slice(0, 10);
    return {
      headers: [
        "Mã đơn",
        "Email khách",
        "Họ tên khách",
        "Trạng thái",
        "Ngày bắt đầu thuê",
        "Ngày kết thúc thuê",
        "Nhận hàng",
        "Thanh toán",
        "Tạm tính",
        "Giảm giá",
        "Phí giao hàng",
        "Tiền thuê",
        "Tiền cọc",
        "Tiền phạt",
        "Mã voucher",
        "Ngày tạo",
      ],
      rows: bookings.map((b): Cell[] => [
        b.id,
        b.customer.email,
        b.customer.profile?.fullName,
        b.status,
        day(b.rentalStartDate),
        day(b.rentalEndDate),
        b.pickupMethod,
        b.paymentMethod,
        b.subtotal.toString(),
        b.discountTotal.toString(),
        b.shippingFee.toString(),
        b.rentalTotal.toString(),
        b.depositTotal.toString(),
        b.penaltyTotal.toString(),
        b.voucherCode,
        b.createdAt,
      ]),
    };
  }

  private async buildAuditLogs(createdAt: Prisma.DateTimeFilter | undefined) {
    const logs = await this.prisma.auditLog.findMany({
      where: createdAt ? { createdAt } : undefined,
      orderBy: { createdAt: "desc" },
      take: ADMIN_EXPORT_MAX_ROWS + 1,
      include: { actor: { select: { email: true, role: true } } },
    });

    return {
      headers: ["Thời gian", "Hành động", "Đối tượng", "ID đối tượng", "Người thực hiện", "Vai trò", "Chi tiết"],
      rows: logs.map((log): Cell[] => [
        log.createdAt,
        log.action,
        log.entityType,
        log.entityId,
        log.actor?.email,
        log.actor?.role,
        this.describeMetadata(log.action, log.metadata),
      ]),
    };
  }

  /** Never write the value of a setting that is not an admin-defined key (legacy secrets may exist). */
  private describeMetadata(action: string, metadata: Prisma.JsonValue | null): string {
    if (metadata === null || metadata === undefined) return "";
    if (action === "ADMIN_UPDATE_SETTING") {
      const meta = typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
      const key = typeof meta.key === "string" ? meta.key : null;
      if (!key || !ADMIN_SETTING_KEYS.has(key)) return key ? `key=${key} (giá trị đã ẩn)` : "";
    }
    return JSON.stringify(metadata);
  }
}
