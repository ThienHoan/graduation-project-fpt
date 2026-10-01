import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { ok } from "../../common/api-response";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateGarmentDto } from "./dto/create-garment.dto";
import type { UpdateGarmentDto } from "./dto/update-garment.dto";
import type { AddGarmentImageDto } from "./dto/add-image.dto";
import { normalizeStringArray, type GarmentMeasurementsDto } from "./dto/garment-details.dto";

type GarmentWithCategory = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  material: string[];
  occasion: string[];
  careInstructions: string[];
  usageConditions: string[];
  isActive: boolean;
  category?: { name: string } | null;
  garment_sizes?: Array<any>;
};

type GarmentWithImages = GarmentWithCategory & {
  images?: Array<{ id: string; imageUrl: string; altText: string | null; sortOrder: number }>;
};

@Injectable()
export class GarmentsService {
  constructor(private readonly prisma: PrismaService) { }

  async findAll() {
    const garments = await this.prisma.garment.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        category: true,
        garment_sizes: { where: { is_active: true } },
        images: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(garments.map((g) => ({
      id: g.id, name: g.name, categoryName: g.category?.name ?? null,
      sizeLabel: g.garment_sizes[0]?.size_label ?? null,
      color: g.color ?? null,
      dailyPrice: Number(g.garment_sizes[0]?.daily_price ?? 0),
      depositAmount: Number(g.garment_sizes[0]?.deposit_amount ?? 0),
      images: g.images.map((img) => ({
        id: img.id,
        imageUrl: img.imageUrl,
        altText: img.altText,
        sortOrder: img.sortOrder,
      })),
    })));
  }

  async findOne(id: string) {
    const garment = await this.prisma.garment.findFirst({
      where: { id, isActive: true, deletedAt: null },
      include: {
        category: true,
        garment_sizes: { where: { is_active: true } },
        images: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!garment) throw new NotFoundException("Garment not found.");
    return ok(this.serialize(garment));
  }

  // ── Manager / Owner: Create ────────────────────────────────────────────────

  async create(dto: CreateGarmentDto) {
    if (dto.categoryId) {
      const category = await this.prisma.garmentCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new NotFoundException("Category not found.");
    }

    const garment = await this.prisma.garment.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId ?? null,
        description: dto.description ?? null,
        color: dto.color ?? null,
        material: normalizeStringArray(dto.material),
        occasion: normalizeStringArray(dto.occasion),
        careInstructions: normalizeStringArray(dto.careInstructions),
        usageConditions: normalizeStringArray(dto.usageConditions),
        garment_sizes: {
          create: [{
            size_label: dto.sizeLabel ?? null,
            daily_price: dto.dailyPrice ?? 0,
            deposit_amount: dto.depositAmount ?? 0,
            ...this.toSizeMeasurementColumns(dto.measurements),
            is_active: true,
          }],
        },
        isActive: dto.isActive ?? true,
      },
      include: {
        category: true,
        images: { orderBy: { sortOrder: "asc" } },
        garment_sizes: true,
      },
    });

    return ok(this.serialize(garment));
  }

  // ── Manager / Owner: Update ────────────────────────────────────────────────

  async update(id: string, dto: UpdateGarmentDto) {
    const garment = await this.prisma.garment.findUnique({ where: { id } });
    if (!garment) throw new NotFoundException("Garment not found.");

    if (dto.categoryId !== undefined) {
      if (dto.categoryId) {
        const category = await this.prisma.garmentCategory.findUnique({
          where: { id: dto.categoryId },
        });
        if (!category) throw new NotFoundException("Category not found.");
      }
    }

    const updated = await this.prisma.garment.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.material !== undefined ? { material: normalizeStringArray(dto.material) } : {}),
        ...(dto.occasion !== undefined ? { occasion: normalizeStringArray(dto.occasion) } : {}),
        ...(dto.careInstructions !== undefined ? { careInstructions: normalizeStringArray(dto.careInstructions) } : {}),
        ...(dto.usageConditions !== undefined ? { usageConditions: normalizeStringArray(dto.usageConditions) } : {}),
        garment_sizes: {
          updateMany: {
            where: { is_active: true },
            data: {
              ...(dto.sizeLabel !== undefined ? { size_label: dto.sizeLabel || null } : {}),
              ...(dto.dailyPrice !== undefined ? { daily_price: dto.dailyPrice } : {}),
              ...(dto.depositAmount !== undefined ? { deposit_amount: dto.depositAmount } : {}),
              ...this.toSizeMeasurementColumns(dto.measurements),
            },
          },
        },
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: {
        category: true,
        images: { orderBy: { sortOrder: "asc" } },
        garment_sizes: true,
      },
    });

    return ok(this.serialize(updated));
  }

  // ── Manager / Owner: Delete ────────────────────────────────────────────────

  private async deleteFromSupabase(imageUrls: string[]) {
    const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_ASSETS_BUCKET?.trim() || "products";

    if (!supabaseUrl || !serviceRoleKey || !imageUrls.length) return;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const pathsToRemove: string[] = [];
    const prefix = `/storage/v1/object/public/${bucket}/`;

    for (const url of imageUrls) {
      if (!url.startsWith(supabaseUrl)) continue;
      const matchIndex = url.indexOf(prefix);
      if (matchIndex !== -1) {
        const objectPath = url.substring(matchIndex + prefix.length);
        if (objectPath) pathsToRemove.push(objectPath);
      }
    }

    if (pathsToRemove.length > 0) {
      const { error } = await supabase.storage.from(bucket).remove(pathsToRemove);
      if (error) {
        console.error("[GarmentsService] Failed to delete from Supabase:", error);
      }
    }
  }

  async remove(id: string) {
    const garment = await this.prisma.garment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!garment) throw new NotFoundException("Garment not found.");

    await this.prisma.garment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return ok({ id, deleted: true });
  }

  // ── Manager / Owner: Add image ─────────────────────────────────────────────

  async addImage(garmentId: string, dto: AddGarmentImageDto) {
    const garment = await this.prisma.garment.findUnique({
      where: { id: garmentId },
    });
    if (!garment) throw new NotFoundException("Garment not found.");

    const nextSortOrder = await this.prisma.garmentImage.aggregate({
      where: { garmentId },
      _max: { sortOrder: true },
    });
    const sortOrder = dto.sortOrder !== undefined
      ? Number(dto.sortOrder)
      : (nextSortOrder._max.sortOrder ?? -1) + 1;

    const image = await this.prisma.garmentImage.create({
      data: {
        garmentId,
        imageUrl: dto.imageUrl,
        altText: dto.altText ?? null,
        sortOrder,
      },
    });

    return ok({
      id: image.id,
      garmentId: image.garmentId,
      imageUrl: image.imageUrl,
      altText: image.altText,
      sortOrder: image.sortOrder,
    });
  }

  async removeImage(garmentId: string, imageId: string) {
    const image = await this.prisma.garmentImage.findFirst({
      where: { id: imageId, garmentId },
    });
    if (!image) throw new NotFoundException("Garment image not found.");

    await this.prisma.garmentImage.delete({ where: { id: imageId } });

    await this.deleteFromSupabase([image.imageUrl]);

    return ok({ id: imageId, deleted: true });
  }

  // ── Available assets for booking ───────────────────────────────────────────

  async findAvailableAssets(garmentId: string) {
    const garment = await this.prisma.garment.findFirst({
      where: { id: garmentId, isActive: true, deletedAt: null },
    });
    if (!garment) throw new NotFoundException("Garment not found.");

    const assets = await this.prisma.garmentAsset.findMany({
      where: { garmentId, status: "available" },
      orderBy: { assetCode: "asc" },
    });
    return ok(assets.map((a) => ({ id: a.id, assetCode: a.assetCode, status: a.status, conditionNote: a.conditionNote })));
  }

  async findAllGrouped(search?: string, category?: string) {
    // occasion là TEXT[] → Prisma không hỗ trợ ILIKE trên phần tử mảng,
    // nên lấy id khớp dịp bằng raw query rồi đưa vào OR cùng name/description/color.
    const keyword = search?.trim();
    let occasionIds: string[] = [];
    if (keyword) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT g.id AS id
          FROM public.garments g
          WHERE g.is_active = true AND g.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM unnest(g.occasion) AS occ
              WHERE occ ILIKE ${"%" + keyword + "%"}
            )
        `,
      );
      occasionIds = rows.map((r) => r.id);
    }

    const garments = await this.prisma.garment.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                { color: { contains: search, mode: "insensitive" } },
                { category: { name: { contains: search, mode: "insensitive" } } },
                ...(occasionIds.length > 0 ? [{ id: { in: occasionIds } }] : []),
              ],
            }
          : {}),
        ...(category ? { category: { name: { equals: category, mode: "insensitive" } } } : {}),
      },
      include: {
        category: true,
        images: { orderBy: { sortOrder: "asc" } },
        garment_sizes: { where: { is_active: true }, orderBy: { size_label: "asc" } },
      },
      orderBy: { name: "asc" },
    });

    // Gom nhóm theo tên (không phân biệt hoa/thường, trim)
    const grouped = new Map<string, {
      garmentId: string;
      name: string;
      categoryName: string | null;
      description: string | null;
      color: string | null;
      material: string[];
      occasion: string[];
      careInstructions: string[];
      usageConditions: string[];
      imageUrl: string | null;
      images: Array<{ id: string; imageUrl: string; altText: string | null; sortOrder: number }>;
      imageIdsSeen: Set<string>;
      sizeMap: Map<string, {
        garmentSizeId: string;
        sizeLabel: string | null;
        dailyPrice: number;
        depositAmount: number;
        measurements: {
          shoulderCm: number | null;
          bustCm: number | null;
          waistCm: number | null;
          hipCm: number | null;
          lengthCm: number | null;
          sleeveLengthCm: number | null;
        } | null;
      }>;
    }>();

    const mergeUnique = (target: string[], values: string[] | null | undefined) => {
      for (const v of values ?? []) {
        const t = v?.trim();
        if (t && !target.includes(t)) target.push(t);
      }
    };

    for (const g of garments) {
      if (g.garment_sizes.length === 0) continue;
      const key = g.name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

      if (!grouped.has(key)) {
        grouped.set(key, {
          garmentId: g.id,
          name: g.name.trim(),
          categoryName: g.category?.name ?? null,
          description: g.description,
          color: g.color ?? null,
          material: [],
          occasion: [],
          careInstructions: [],
          usageConditions: [],
          imageUrl: g.images[0]?.imageUrl ?? null,
          images: [],
          imageIdsSeen: new Set(),
          sizeMap: new Map(),
        });
      }

      const group = grouped.get(key)!;
      if (!group.color && g.color) group.color = g.color;
      if (!group.description && g.description) group.description = g.description;
      mergeUnique(group.material, g.material);
      mergeUnique(group.occasion, g.occasion);
      mergeUnique(group.careInstructions, g.careInstructions);
      mergeUnique(group.usageConditions, g.usageConditions);

      // Merge images, deduplicate by id
      for (const img of g.images) {
        if (!group.imageIdsSeen.has(img.id)) {
          group.imageIdsSeen.add(img.id);
          group.images.push({
            id: img.id,
            imageUrl: img.imageUrl,
            altText: img.altText,
            sortOrder: img.sortOrder,
          });
        }
      }

      // Merge sizes, deduplicate by sizeLabel
      for (const s of g.garment_sizes) {
        const sk = (s.size_label ?? "__nosize__").trim().toLowerCase();
        if (!group.sizeMap.has(sk)) {
          group.sizeMap.set(sk, {
            garmentSizeId: s.id,
            sizeLabel: s.size_label,
            dailyPrice: Number(s.daily_price ?? 0),
            depositAmount: Number(s.deposit_amount ?? 0),
            measurements: this.toSizeMeasurements(s),
          });
        }
      }
    }

    return ok(
      Array.from(grouped.values()).map((group, idx) => ({
        name: group.name,
        slug: `group-${idx}-${group.name.toLowerCase().replace(/\s+/g, "-")}`,
        garmentId: group.garmentId,
        categoryName: group.categoryName,
        description: group.description,
        color: group.color,
        material: group.material,
        occasion: group.occasion,
        careInstructions: group.careInstructions,
        usageConditions: group.usageConditions,
        imageUrl: group.imageUrl,
        images: group.images.sort((a, b) => a.sortOrder - b.sortOrder),
        sizes: Array.from(group.sizeMap.values()).sort((a, b) => (a.sizeLabel ?? "").localeCompare(b.sizeLabel ?? "")),
      })),
    );
  }

  // ── Category CRUD ──────────────────────────────────────────────────────────

  // ── Sizes of one garment (for asset creation) ────────────────────────────

  async findSizesByGarment(garmentId: string) {
    const garment = await this.prisma.garment.findFirst({
      where: { id: garmentId, isActive: true },
    });
    if (!garment) throw new NotFoundException("Garment not found.");

    const sizes = await this.prisma.garment_sizes.findMany({
      where: { garment_id: garmentId, is_active: true },
      orderBy: { size_label: "asc" },
    });
    return ok(
      sizes.map((s) => ({
        id: s.id,
        sizeLabel: s.size_label,
      })),
    );
  }

  async findAllSizes() {    const sizes = await this.prisma.garment_sizes.findMany({
      select: { size_label: true },
      distinct: ["size_label"],
      where: { size_label: { not: null, notIn: [""] } },
      orderBy: { size_label: "asc" },
    });
    return ok(sizes.map((s) => s.size_label).filter(Boolean));
  }

  async createSize(sizeLabel: string) {
    const label = sizeLabel?.trim();
    if (!label) throw new BadRequestException("sizeLabel is required.");
    return ok({ sizeLabel: label });
  }

  async findAllCategories() {
    const categories = await this.prisma.garmentCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return ok(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        isActive: c.isActive,
      })),
    );
  }

  async createCategory(name: string, description?: string) {
    const existing = await this.prisma.garmentCategory.findUnique({
      where: { name },
    });
    if (existing) {
      throw new BadRequestException("Category with this name already exists.");
    }

    const category = await this.prisma.garmentCategory.create({
      data: { name, description: description ?? null },
    });
    return ok({
      id: category.id,
      name: category.name,
      description: category.description,
    });
  }

  // ── Shared measurement helpers ───────────────────────────────────────────

  private toSizeMeasurements(s: {
    shoulder_cm: unknown; bust_cm: unknown; waist_cm: unknown;
    hip_cm: unknown; length_cm: unknown; sleeve_length_cm: unknown;
  }) {
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const m = {
      shoulderCm: num(s.shoulder_cm),
      bustCm: num(s.bust_cm),
      waistCm: num(s.waist_cm),
      hipCm: num(s.hip_cm),
      lengthCm: num(s.length_cm),
      sleeveLengthCm: num(s.sleeve_length_cm),
    };
    return Object.values(m).some((v) => v !== null) ? m : null;
  }

  private toSizeMeasurementColumns(dto?: GarmentMeasurementsDto) {
    if (!dto) return {};
    const cols: Record<string, number | null> = {};
    if (dto.shoulderCm !== undefined) cols.shoulder_cm = dto.shoulderCm ?? null;
    if (dto.bustCm !== undefined) cols.bust_cm = dto.bustCm ?? null;
    if (dto.waistCm !== undefined) cols.waist_cm = dto.waistCm ?? null;
    if (dto.hipCm !== undefined) cols.hip_cm = dto.hipCm ?? null;
    if (dto.lengthCm !== undefined) cols.length_cm = dto.lengthCm ?? null;
    if (dto.sleeveLengthCm !== undefined) cols.sleeve_length_cm = dto.sleeveLengthCm ?? null;
    return cols;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  private serialize(garment: GarmentWithImages) {
    return {
      id: garment.id,
      name: garment.name,
      description: garment.description,
      categoryName: garment.category?.name ?? null,
      categoryId: (garment as any).categoryId ?? null,
      sizeLabel: garment.garment_sizes?.[0]?.size_label ?? null,
      color: garment.color,
      material: garment.material ?? [],
      occasion: garment.occasion ?? [],
      careInstructions: garment.careInstructions ?? [],
      usageConditions: garment.usageConditions ?? [],
      dailyPrice: Number(garment.garment_sizes?.[0]?.daily_price ?? 0),
      depositAmount: Number(garment.garment_sizes?.[0]?.deposit_amount ?? 0),
      measurements: garment.garment_sizes?.[0] ? this.toSizeMeasurements(garment.garment_sizes[0]) : null,
      isActive: garment.isActive,
      images: (garment.images ?? []).map((img) => ({
        id: img.id,
        imageUrl: img.imageUrl,
        altText: img.altText,
        sortOrder: img.sortOrder,
      })),
    };
  }
}
