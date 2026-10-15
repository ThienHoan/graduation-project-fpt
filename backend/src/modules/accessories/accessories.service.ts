import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateAccessoryDto } from "./dto/create-accessory.dto";
import type { UpdateAccessoryDto } from "./dto/update-accessory.dto";
import type { CreateAccessoryAssetDto } from "./dto/create-accessory-asset.dto";
import type { UpdateAccessoryAssetStatusDto } from "./dto/update-accessory-asset-status.dto";

@Injectable()
export class AccessoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Accessories ──────────────────────────────────────────────────────────

  async findAll(includeInactive = false) {
    const rows = await this.prisma.accessories.findMany({
      where: includeInactive ? undefined : { is_active: true },
      include: {
        _count: { select: { accessory_assets: true } },
      },
      orderBy: { name: "asc" },
    });
    return ok(
      rows.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        description: a.description,
        material: a.material,
        color: a.color,
        imageUrl: a.image_url,
        replacementValue: Number(a.replacement_value ?? 0),
        isActive: a.is_active,
        assetCount: a._count.accessory_assets,
        createdAt: a.created_at.toISOString(),
        updatedAt: a.updated_at.toISOString(),
      })),
    );
  }

  async findOne(id: string) {
    const accessory = await this.prisma.accessories.findUnique({
      where: { id },
      include: {
        accessory_assets: { orderBy: { asset_code: "asc" } },
      },
    });
    if (!accessory) throw new NotFoundException("Không tìm thấy phụ kiện.");
    return ok(this.serializeAccessory(accessory));
  }

  async create(dto: CreateAccessoryDto) {
    const existing = await this.prisma.accessories.findUnique({
      where: { code: dto.code.trim() },
    });
    if (existing) {
      throw new BadRequestException(
        `Mã phụ kiện '${dto.code.trim()}' đã tồn tại. Vui lòng chọn mã khác.`,
      );
    }

    try {
      const accessory = await this.prisma.accessories.create({
        data: {
          code: dto.code.trim(),
          name: dto.name.trim(),
          category: dto.category?.trim() || null,
          description: dto.description?.trim() || null,
          material: dto.material?.trim() || null,
          color: dto.color?.trim() || null,
          image_url: dto.imageUrl?.trim() || null,
          replacement_value: dto.replacementValue ?? 0,
        },
        include: { accessory_assets: { orderBy: { asset_code: "asc" } } },
      });
      return ok(this.serializeAccessory(accessory));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BadRequestException(
          `Mã phụ kiện '${dto.code.trim()}' đã tồn tại. Vui lòng chọn mã khác.`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateAccessoryDto) {
    const accessory = await this.prisma.accessories.findUnique({ where: { id } });
    if (!accessory) throw new NotFoundException("Không tìm thấy phụ kiện.");

    // Tắt hoạt động: chỉ cho phép khi không còn mẫu đang hoạt động nào gắn phụ kiện này.
    if (dto.isActive === false) {
      const links = await this.prisma.garment_accessories.findMany({
        where: {
          accessory_id: id,
          garments: { isActive: true, deletedAt: null },
        },
        include: { garments: { select: { name: true } } },
      });
      if (links.length > 0) {
        const names = [...new Set(links.map((l) => l.garments.name))];
        throw new BadRequestException(
          `Không thể ẩn phụ kiện vì còn ${names.length} mẫu đang hoạt động đang gắn: ${names.join(", ")}. Hãy gỡ phụ kiện khỏi các mẫu này trước.`,
        );
      }
    }

    if (dto.code !== undefined) {
      const code = dto.code.trim();
      if (!code) throw new BadRequestException("Mã phụ kiện không được để trống.");
      const dup = await this.prisma.accessories.findUnique({ where: { code } });
      if (dup && dup.id !== id) {
        throw new BadRequestException(`Mã phụ kiện '${code}' đã tồn tại. Vui lòng chọn mã khác.`);
      }
    }

    try {
      const updated = await this.prisma.accessories.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.category !== undefined ? { category: dto.category?.trim() || null } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.material !== undefined ? { material: dto.material?.trim() || null } : {}),
          ...(dto.color !== undefined ? { color: dto.color?.trim() || null } : {}),
          ...(dto.imageUrl !== undefined ? { image_url: dto.imageUrl?.trim() || null } : {}),
          ...(dto.replacementValue !== undefined ? { replacement_value: dto.replacementValue } : {}),
          ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
          updated_at: new Date(),
        },
        include: { accessory_assets: { orderBy: { asset_code: "asc" } } },
      });
      return ok(this.serializeAccessory(updated));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BadRequestException("Mã phụ kiện đã tồn tại. Vui lòng chọn mã khác.");
      }
      throw error;
    }
  }

  // ── Accessory assets ─────────────────────────────────────────────────────

  async findAssetsByAccessory(accessoryId: string) {
    const accessory = await this.prisma.accessories.findUnique({
      where: { id: accessoryId },
    });
    if (!accessory) throw new NotFoundException("Không tìm thấy phụ kiện.");

    const assets = await this.prisma.accessory_assets.findMany({
      where: { accessory_id: accessoryId },
      orderBy: { asset_code: "asc" },
    });
    return ok(assets.map((a) => this.serializeAsset(a, accessory.name)));
  }

  async createAsset(dto: CreateAccessoryAssetDto, userId?: string) {
    const accessory = await this.prisma.accessories.findUnique({
      where: { id: dto.accessoryId },
    });
    if (!accessory) throw new NotFoundException("Không tìm thấy phụ kiện.");

    const existing = await this.prisma.accessory_assets.findUnique({
      where: { asset_code: dto.assetCode.trim() },
    });
    if (existing) {
      throw new BadRequestException(
        `Mã tài sản '${dto.assetCode.trim()}' đã tồn tại. Vui lòng chọn mã khác.`,
      );
    }

    try {
      const asset = await this.prisma.accessory_assets.create({
        data: {
          accessory_id: dto.accessoryId,
          asset_code: dto.assetCode.trim(),
          condition_note: dto.conditionNote?.trim() || null,
          status: "available",
        },
      });
      await this.prisma.accessory_asset_history.create({
        data: {
          asset_id: asset.id,
          action: "created",
          old_status: null,
          new_status: "available",
          note: dto.conditionNote?.trim() || null,
          created_by: userId ?? null,
        },
      });
      return ok(this.serializeAsset(asset, accessory.name));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BadRequestException(
          `Mã tài sản '${dto.assetCode.trim()}' đã tồn tại. Vui lòng chọn mã khác.`,
        );
      }
      throw error;
    }
  }

  async updateAssetStatus(id: string, dto: UpdateAccessoryAssetStatusDto, userId?: string) {
    const asset = await this.prisma.accessory_assets.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException("Không tìm thấy tài sản phụ kiện.");

    const updated = await this.prisma.accessory_assets.update({
      where: { id },
      data: {
        status: dto.status as never,
        ...(dto.note ? { condition_note: dto.note } : {}),
        updated_at: new Date(),
      },
    });

    if (asset.status !== updated.status) {
      await this.prisma.accessory_asset_history.create({
        data: {
          asset_id: id,
          action: "status_change",
          old_status: asset.status,
          new_status: updated.status,
          note: dto.note ?? null,
          created_by: userId ?? null,
        },
      });
    }

    const accessory = await this.prisma.accessories.findUnique({
      where: { id: updated.accessory_id },
    });
    return ok(this.serializeAsset(updated, accessory?.name ?? null));
  }

  async findLinkedGarments(id: string) {
    const accessory = await this.prisma.accessories.findUnique({ where: { id } });
    if (!accessory) throw new NotFoundException("Không tìm thấy phụ kiện.");

    const links = await this.prisma.garment_accessories.findMany({
      where: { accessory_id: id },
      include: {
        garments: {
          select: {
            id: true,
            name: true,
            isActive: true,
            garment_sizes: {
              where: { is_active: true },
              select: { size_label: true },
              orderBy: { size_label: "asc" },
            },
          },
        },
      },
      orderBy: { created_at: "asc" },
    });

    return ok(
      links.map((l) => ({
        garmentId: l.garments.id,
        name: l.garments.name,
        isActive: l.garments.isActive,
        quantity: l.quantity,
        isIncluded: l.is_included,
        sizes: l.garments.garment_sizes
          .map((s) => s.size_label)
          .filter((v): v is string => !!v),
      })),
    );
  }

  async findAssetHistory(assetId: string) {    const asset = await this.prisma.accessory_assets.findUnique({ where: { id: assetId } });    if (!asset) throw new NotFoundException("Không tìm thấy tài sản phụ kiện.");

    const rows = await this.prisma.accessory_asset_history.findMany({
      where: { asset_id: assetId },
      orderBy: { created_at: "desc" },
    });

    const userIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
    const users = userIds.length > 0
      ? await this.prisma.userAccount.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, profile: { select: { fullName: true } } },
      })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return ok(
      rows.map((r) => {
        const actor = r.created_by ? userById.get(r.created_by) ?? null : null;
        return {
          id: r.id,
          action: r.action,
          oldStatus: r.old_status,
          newStatus: r.new_status,
          note: r.note,
          createdBy: actor
            ? { email: actor.email, name: actor.profile?.fullName ?? null }
            : null,
          createdAt: r.created_at.toISOString(),
        };
      }),
    );
  }

  /**
   * Tài sản phụ kiện cần xử lý sau kiểm tra trả đồ (giặt / sửa / hỏng / mất),
   * kèm đơn gần nhất để manager đối chiếu. Dùng cho tab Giặt sấy + Hư hỏng.
   */
  async findProcessingAssets() {
    const assets = await this.prisma.accessory_assets.findMany({
      where: { status: { in: ["laundry", "maintenance", "damaged", "lost"] } },
      include: {
        accessories: { select: { id: true, name: true, replacement_value: true } },
        booking_accessory_items: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            conditionNote: true,
            booking: { select: { id: true, status: true } },
          },
        },
      },
      orderBy: { updated_at: "asc" },
    });
    return ok(
      assets.map((a) => {
        const latest = a.booking_accessory_items[0] ?? null;
        return {
          id: a.id,
          accessoryId: a.accessory_id,
          accessoryName: a.accessories.name,
          assetCode: a.asset_code,
          status: a.status,
          conditionNote: a.condition_note ?? latest?.conditionNote ?? null,
          replacementValue: Number(a.accessories.replacement_value ?? 0),
          bookingId: latest?.booking.id ?? null,
          bookingStatus: latest?.booking.status ?? null,
          updatedAt: a.updated_at.toISOString(),
        };
      }),
    );
  }

  // ── Serialization ────────────────────────────────────────────────────────

  private serializeAccessory(accessory: {
    id: string;
    code: string;
    name: string;
    category: string | null;
    description: string | null;
    material: string | null;
    color: string | null;
    image_url: string | null;
    replacement_value: unknown;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    accessory_assets?: Array<{
      id: string;
      accessory_id: string;
      asset_code: string;
      status: unknown;
      condition_note: string | null;
      created_at: Date;
      updated_at: Date;
    }>;
  }) {
    return {
      id: accessory.id,
      code: accessory.code,
      name: accessory.name,
      category: accessory.category,
      description: accessory.description,
      material: accessory.material,
      color: accessory.color,
      imageUrl: accessory.image_url,
      replacementValue: Number(accessory.replacement_value ?? 0),
      isActive: accessory.is_active,
      createdAt: accessory.created_at.toISOString(),
      updatedAt: accessory.updated_at.toISOString(),
      assets: (accessory.accessory_assets ?? []).map((a) =>
        this.serializeAsset(a, accessory.name),
      ),
    };
  }

  private serializeAsset(
    asset: {
      id: string;
      accessory_id: string;
      asset_code: string;
      status: unknown;
      condition_note: string | null;
      created_at: Date;
      updated_at: Date;
    },
    accessoryName: string | null,
  ) {
    return {
      id: asset.id,
      accessoryId: asset.accessory_id,
      accessoryName,
      assetCode: asset.asset_code,
      status: asset.status as string,
      conditionNote: asset.condition_note,
      createdAt: asset.created_at.toISOString(),
      updatedAt: asset.updated_at.toISOString(),
    };
  }
}
