import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ok } from "../../common/api-response";

export type WishlistGarmentSummary = {
  garmentId: string;
  name: string;
  categoryName: string | null;
  imageUrl: string | null;
  dailyPrice: number;
  depositAmount: number;
  sizes: Array<{
    sizeId: string;
    sizeLabel: string | null;
    dailyPrice: number;
    depositAmount: number;
  }>;
  addedAt: string;
};

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy danh sách cổ phục yêu thích của khách hàng
   */
  async findUserWishlist(userId: string) {
    const items = await this.prisma.customerWishlist.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        garment: {
          include: {
            category: { select: { id: true, name: true } },
            images: {
              select: { imageUrl: true, altText: true },
              orderBy: { sortOrder: "asc" },
            },
            garment_sizes: {
              where: { is_active: true },
              select: {
                id: true,
                size_label: true,
                daily_price: true,
                deposit_amount: true,
              },
            },
          },
        },
      },
    });

    const serialized: WishlistGarmentSummary[] = items.map((w) => {
      const g = w.garment;
      const sizes = (g.garment_sizes ?? []).map((s) => ({
        sizeId: s.id,
        sizeLabel: s.size_label ?? null,
        dailyPrice: Number(s.daily_price ?? 0),
        depositAmount: Number(s.deposit_amount ?? 0),
      }));

      // Giá cơ bản lấy từ size đầu tiên hoặc nhỏ nhất
      const minDailyPrice = sizes.length > 0
        ? Math.min(...sizes.map((s) => s.dailyPrice))
        : 0;
      const minDeposit = sizes.length > 0
        ? Math.min(...sizes.map((s) => s.depositAmount))
        : 0;

      return {
        garmentId: w.garmentId,
        name: g.name,
        categoryName: g.category?.name ?? null,
        imageUrl: g.images?.[0]?.imageUrl ?? null,
        dailyPrice: minDailyPrice,
        depositAmount: minDeposit,
        sizes,
        addedAt: w.createdAt.toISOString(),
      };
    });

    return ok(serialized);
  }

  /**
   * Thêm 1 mẫu cổ phục vào danh sách yêu thích
   */
  async addToWishlist(userId: string, garmentId: string) {
    const garment = await this.prisma.garment.findUnique({
      where: { id: garmentId },
      select: { id: true, name: true, isActive: true, deletedAt: true },
    });

    if (!garment || !garment.isActive || garment.deletedAt) {
      throw new NotFoundException("Cổ phục không tồn tại hoặc đã ngừng phục vụ.");
    }

    await this.prisma.customerWishlist.upsert({
      where: {
        userId_garmentId: {
          userId,
          garmentId,
        },
      },
      create: {
        userId,
        garmentId,
      },
      update: {},
    });

    return ok({ garmentId, isWishlisted: true });
  }

  /**
   * Xóa cổ phục khỏi danh sách yêu thích
   */
  async removeFromWishlist(userId: string, garmentId: string) {
    await this.prisma.customerWishlist.deleteMany({
      where: {
        userId,
        garmentId,
      },
    });

    return ok({ garmentId, isWishlisted: false });
  }

  /**
   * Đồng bộ danh sách yêu thích từ khách vãng lai sau khi đăng nhập
   */
  async syncWishlist(userId: string, garmentIds: string[]) {
    if (garmentIds.length > 0) {
      // Chỉ chọn các garmentId hợp lệ đang hoạt động
      const validGarments = await this.prisma.garment.findMany({
        where: {
          id: { in: garmentIds },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });

      const validIds = validGarments.map((g) => g.id);
      if (validIds.length > 0) {
        await this.prisma.customerWishlist.createMany({
          data: validIds.map((gId) => ({
            userId,
            garmentId: gId,
          })),
          skipDuplicates: true,
        });
      }
    }

    return this.findUserWishlist(userId);
  }
}
