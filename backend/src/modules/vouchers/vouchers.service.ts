import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, vouchers } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import type { CreateVoucherDto, UpdateVoucherDto, ValidateVoucherDto } from "./dto/voucher.dto";

type Db = PrismaService | Prisma.TransactionClient;

/** Một dòng trong đơn — dùng để tính phần giá trị đủ điều kiện giảm. */
export type VoucherOrderLine = {
  garmentId: string;
  categoryId: string | null;
  amount: number;
};

export type VoucherEvaluation = {
  voucher: vouchers;
  orderSubtotal: number;
  eligibleSubtotal: number;
  discountAmount: number;
};

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  // ── Quản lý (manager_owner) ───────────────────────────────────────────────

  async list(opts: { search?: string; status?: string } = {}) {
    const now = new Date();
    const where: Prisma.vouchersWhereInput = {};
    if (opts.search) {
      where.OR = [
        { code: { contains: opts.search, mode: "insensitive" } },
        { name: { contains: opts.search, mode: "insensitive" } },
      ];
    }
    if (opts.status === "active") Object.assign(where, { is_active: true, start_at: { lte: now }, end_at: { gte: now } });
    if (opts.status === "upcoming") Object.assign(where, { is_active: true, start_at: { gt: now } });
    if (opts.status === "expired") Object.assign(where, { end_at: { lt: now } });
    if (opts.status === "inactive") Object.assign(where, { is_active: false });

    const rows = await this.prisma.vouchers.findMany({ where, orderBy: { created_at: "desc" } });
    return ok(rows.map((v) => this.serialize(v)));
  }

  async findOne(id: string) {
    const v = await this.prisma.vouchers.findUnique({
      where: { id },
      include: { usages: { where: { is_released: false }, orderBy: { created_at: "desc" }, take: 50 } },
    });
    if (!v) throw new NotFoundException("Không tìm thấy voucher.");
    return ok({
      ...this.serialize(v),
      recentUsages: v.usages.map((u) => ({
        id: u.id,
        bookingId: u.booking_id,
        customerId: u.customer_id,
        discountAmount: Number(u.discount_amount),
        createdAt: u.created_at,
      })),
    });
  }

  async create(dto: CreateVoucherDto) {
    this.validateConfig(dto);
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.vouchers.findUnique({ where: { code } });
    if (exists) throw new ConflictException(`Mã voucher "${code}" đã tồn tại.`);
    const v = await this.prisma.vouchers.create({
      data: {
        code,
        name: dto.name.trim(),
        description: dto.description ?? null,
        discount_type: dto.discountType,
        discount_value: dto.discountValue,
        max_discount_amount: dto.maxDiscountAmount ?? null,
        min_order_value: dto.minOrderValue ?? 0,
        usage_limit: dto.usageLimit ?? null,
        per_user_limit: dto.perUserLimit === undefined ? 1 : dto.perUserLimit,
        start_at: new Date(dto.startAt),
        end_at: new Date(dto.endAt),
        category_ids: dto.categoryIds ?? [],
        garment_ids: dto.garmentIds ?? [],
        is_active: dto.isActive ?? true,
      },
    });
    return ok(this.serialize(v), "Đã tạo voucher.");
  }

  async update(id: string, dto: UpdateVoucherDto) {
    const existing = await this.prisma.vouchers.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Không tìm thấy voucher.");
    this.validateConfig({
      discountType: dto.discountType ?? existing.discount_type,
      discountValue: dto.discountValue ?? Number(existing.discount_value),
      startAt: dto.startAt ?? existing.start_at.toISOString(),
      endAt: dto.endAt ?? existing.end_at.toISOString(),
    });
    if (dto.usageLimit != null && dto.usageLimit < existing.used_count) {
      throw new BadRequestException(`Giới hạn lượt dùng không được nhỏ hơn số lượt đã dùng (${existing.used_count}).`);
    }
    const data: Prisma.vouchersUpdateInput = { updated_at: new Date() };
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.discountType !== undefined) data.discount_type = dto.discountType;
    if (dto.discountValue !== undefined) data.discount_value = dto.discountValue;
    if (dto.maxDiscountAmount !== undefined) data.max_discount_amount = dto.maxDiscountAmount;
    if (dto.minOrderValue !== undefined) data.min_order_value = dto.minOrderValue;
    if (dto.usageLimit !== undefined) data.usage_limit = dto.usageLimit;
    if (dto.perUserLimit !== undefined) data.per_user_limit = dto.perUserLimit;
    if (dto.startAt !== undefined) data.start_at = new Date(dto.startAt);
    if (dto.endAt !== undefined) data.end_at = new Date(dto.endAt);
    if (dto.categoryIds !== undefined) data.category_ids = dto.categoryIds;
    if (dto.garmentIds !== undefined) data.garment_ids = dto.garmentIds;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    const v = await this.prisma.vouchers.update({ where: { id }, data });
    return ok(this.serialize(v), "Đã cập nhật voucher.");
  }

  async remove(id: string) {
    const v = await this.prisma.vouchers.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("Không tìm thấy voucher.");
    if (v.used_count > 0) {
      // Đã có đơn dùng → chỉ vô hiệu hoá để giữ lịch sử
      await this.prisma.vouchers.update({ where: { id }, data: { is_active: false, updated_at: new Date() } });
      return ok({ id, deactivated: true }, "Voucher đã được sử dụng nên chỉ bị vô hiệu hoá.");
    }
    await this.prisma.vouchers.delete({ where: { id } });
    return ok({ id, deleted: true }, "Đã xoá voucher.");
  }

  // ── Khách hàng ───────────────────────────────────────────────────────────

  /** Danh sách voucher đang chạy mà khách còn lượt dùng. */
  async listAvailable(customerId: string) {
    const now = new Date();
    const rows = await this.prisma.vouchers.findMany({
      where: { is_active: true, start_at: { lte: now }, end_at: { gte: now } },
      orderBy: { end_at: "asc" },
    });
    const usage = await this.prisma.voucher_usages.groupBy({
      by: ["voucher_id"],
      where: { customer_id: customerId, is_released: false, voucher_id: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const usedMap = new Map(usage.map((u) => [u.voucher_id, u._count._all]));
    return ok(
      rows
        .filter((v) => v.usage_limit == null || v.used_count < v.usage_limit)
        .filter((v) => v.per_user_limit == null || (usedMap.get(v.id) ?? 0) < v.per_user_limit)
        .map((v) => this.serializePublic(v)),
    );
  }

  /** Kiểm tra voucher cho giỏ hàng (xem trước). Đơn thật được kiểm tra lại lúc tạo booking. */
  async validateForCart(customerId: string, dto: ValidateVoucherDto) {
    const sizes = await this.prisma.garment_sizes.findMany({
      where: { id: { in: dto.garmentSizeIds }, is_active: true },
      select: { id: true, garment_id: true, garments: { select: { categoryId: true } } },
    });
    if (sizes.length !== new Set(dto.garmentSizeIds).size) throw new BadRequestException("Có sản phẩm không hợp lệ.");
    const start = new Date(`${dto.startDate.slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(`${dto.endDate.slice(0, 10)}T00:00:00.000Z`);
    if (end < start) throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
    const quotes = await this.pricing.quoteRental(dto.garmentSizeIds, start, end);
    const sizeMap = new Map(sizes.map((s) => [s.id, s]));
    const lines: VoucherOrderLine[] = dto.garmentSizeIds.map((id) => ({
      garmentId: sizeMap.get(id)!.garment_id,
      categoryId: sizeMap.get(id)!.garments?.categoryId ?? null,
      amount: quotes.get(id)?.rentalTotal ?? 0,
    }));
    const r = await this.evaluate(this.prisma, dto.code, customerId, lines);
    return ok({
      voucher: this.serializePublic(r.voucher),
      orderSubtotal: r.orderSubtotal,
      eligibleSubtotal: r.eligibleSubtotal,
      discountAmount: r.discountAmount,
      totalAfterDiscount: r.orderSubtotal - r.discountAmount,
    });
  }

  // ── Lõi kiểm tra / tiêu thụ (dùng trong transaction tạo booking) ─────────

  /**
   * Kiểm tra đầy đủ điều kiện voucher ở backend. Ném BadRequest kèm lý do nếu không hợp lệ.
   */
  async evaluate(db: Db, rawCode: string, customerId: string, lines: VoucherOrderLine[], now = new Date()): Promise<VoucherEvaluation> {
    const code = rawCode.trim().toUpperCase();
    const voucher = await db.vouchers.findUnique({ where: { code } });
    if (!voucher || !voucher.is_active) throw new BadRequestException("Mã voucher không tồn tại hoặc đã bị vô hiệu hoá.");
    if (now < voucher.start_at) throw new BadRequestException("Voucher chưa đến thời gian sử dụng.");
    if (now > voucher.end_at) throw new BadRequestException("Voucher đã hết hạn.");
    if (voucher.usage_limit != null && voucher.used_count >= voucher.usage_limit) {
      throw new BadRequestException("Voucher đã hết lượt sử dụng.");
    }
    if (voucher.per_user_limit != null) {
      const used = await db.voucher_usages.count({
        where: { voucher_id: voucher.id, customer_id: customerId, is_released: false },
      });
      if (used >= voucher.per_user_limit) {
        throw new BadRequestException(`Bạn đã dùng voucher này tối đa ${voucher.per_user_limit} lần.`);
      }
    }

    const orderSubtotal = lines.reduce((s, l) => s + l.amount, 0);
    if (orderSubtotal < Number(voucher.min_order_value)) {
      throw new BadRequestException(
        `Đơn hàng cần tối thiểu ${Number(voucher.min_order_value).toLocaleString("vi-VN")}đ để dùng voucher này.`,
      );
    }

    const scoped = voucher.garment_ids.length > 0 || voucher.category_ids.length > 0;
    const eligibleSubtotal = scoped
      ? lines
          .filter(
            (l) =>
              voucher.garment_ids.includes(l.garmentId) ||
              (!!l.categoryId && voucher.category_ids.includes(l.categoryId)),
          )
          .reduce((s, l) => s + l.amount, 0)
      : orderSubtotal;
    if (eligibleSubtotal <= 0) throw new BadRequestException("Voucher không áp dụng cho sản phẩm trong đơn.");

    let discount =
      voucher.discount_type === "percentage"
        ? (eligibleSubtotal * Number(voucher.discount_value)) / 100
        : Number(voucher.discount_value);
    if (voucher.max_discount_amount != null) discount = Math.min(discount, Number(voucher.max_discount_amount));
    discount = Math.min(Math.round(discount), eligibleSubtotal);

    return { voucher, orderSubtotal, eligibleSubtotal, discountAmount: discount };
  }

  /**
   * Ghi nhận lượt dùng trong CÙNG transaction tạo booking. Tăng used_count có điều kiện
   * để không vượt usage_limit khi nhiều khách dùng đồng thời.
   */
  async consume(tx: Prisma.TransactionClient, ev: VoucherEvaluation, customerId: string, bookingId: string) {
    const v = ev.voucher;
    const updated = await tx.$executeRaw`
      UPDATE "vouchers" SET "used_count" = "used_count" + 1, "updated_at" = now()
      WHERE "id" = ${v.id}::uuid AND ("usage_limit" IS NULL OR "used_count" < "usage_limit")`;
    if (updated === 0) throw new BadRequestException("Voucher vừa hết lượt sử dụng.");
    await tx.voucher_usages.create({
      data: {
        voucher_id: v.id,
        customer_id: customerId,
        booking_id: bookingId,
        discount_amount: ev.discountAmount,
      },
    });
  }

  /** Trả lại lượt dùng khi booking bị huỷ / từ chối. An toàn khi gọi nhiều lần. */
  async releaseForBooking(tx: Prisma.TransactionClient, bookingId: string) {
    const usage = await tx.voucher_usages.findUnique({ where: { booking_id: bookingId } });
    if (!usage || usage.is_released) return;
    await tx.voucher_usages.update({ where: { id: usage.id }, data: { is_released: true } });
    await tx.$executeRaw`
      UPDATE "vouchers" SET "used_count" = GREATEST("used_count" - 1, 0), "updated_at" = now()
      WHERE "id" = ${usage.voucher_id}::uuid`;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private validateConfig(dto: { discountType: string; discountValue: number; startAt: string; endAt: string }) {
    if (dto.discountType === "percentage" && (dto.discountValue <= 0 || dto.discountValue > 100)) {
      throw new BadRequestException("Phần trăm giảm phải trong khoảng 1–100.");
    }
    if (new Date(dto.startAt) >= new Date(dto.endAt)) {
      throw new BadRequestException("Thời gian bắt đầu phải trước thời gian kết thúc.");
    }
  }

  private status(v: vouchers, now = new Date()) {
    if (!v.is_active) return "inactive";
    if (now < v.start_at) return "upcoming";
    if (now > v.end_at) return "expired";
    if (v.usage_limit != null && v.used_count >= v.usage_limit) return "exhausted";
    return "active";
  }

  serializePublic(v: vouchers) {
    return {
      code: v.code,
      name: v.name,
      description: v.description,
      discountType: v.discount_type,
      discountValue: Number(v.discount_value),
      maxDiscountAmount: v.max_discount_amount != null ? Number(v.max_discount_amount) : null,
      minOrderValue: Number(v.min_order_value),
      startAt: v.start_at,
      endAt: v.end_at,
      categoryIds: v.category_ids,
      garmentIds: v.garment_ids,
    };
  }

  serialize(v: vouchers) {
    return {
      id: v.id,
      ...this.serializePublic(v),
      usageLimit: v.usage_limit,
      usedCount: v.used_count,
      perUserLimit: v.per_user_limit,
      isActive: v.is_active,
      status: this.status(v),
      createdAt: v.created_at,
      updatedAt: v.updated_at,
    };
  }
}
