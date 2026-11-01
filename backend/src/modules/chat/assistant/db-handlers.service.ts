import { Injectable } from "@nestjs/common";
import type { BookingStatus } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
//import type { ClassifierSlots } from "./classification.types";
import type { DbHandlerInput, DbHandlerResult } from "./assistant.types";
import { foldVietnamese, normalizeForMatch } from "./text-utils";
import { addDaysUtc, formatDateOnly, parseRequestedDate } from "./date-utils";
import { detectOccasions, occasionLabel } from "./occasions";

const PRODUCT_NOT_FOUND_REPLY =
  "Dạ anh/chị cho em biết mẫu hoặc màu cụ thể đang quan tâm để em kiểm tra giúp ạ.";

const INACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  "draft",
  "cancelled",
  "rejected",
  "completed",
  "returned",
];

const PRODUCT_NAME_TERMS = [
  "ao dai cach tan",
  "ao dai",
  "co phuc",
  "trang phuc",
  "chan vay",
  "bo vest",
  "bo do",
  "vest",
  "suit",
  "ao",
  "vay",
  "dam",
  "quan",
  "jupe",
];

/**
 * Từ chỉ nhóm chung, không phải tên mẫu cụ thể. "Có trang phục màu đen không"
 * nghĩa là tìm mọi mẫu màu đen, không phải mẫu có chữ "trang phục" trong tên.
 */
const GENERIC_PRODUCT_TERMS = new Set(["trang phuc", "bo do"]);

const STATUS_LABELS: Record<string, string> = {
  pending_confirmation: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  awaiting_payment: "Chờ thanh toán",
  paid: "Đã thanh toán",
  preparing: "Đang chuẩn bị",
  ready_for_pickup: "Sẵn sàng",
  delivering: "Đang giao",
  renting: "Đang thuê",
  returned: "Đã trả",
  inspection_pending: "Chờ kiểm tra",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  rejected: "Từ chối",
  overdue: "Quá hạn",
  draft: "Nháp",
};

type GarmentSizeRow = {
  id?: string;
  size_label: string | null;
  daily_price: unknown;
  is_active?: boolean | null;
};

type GarmentRow = {
  id: string;
  name: string;
  color: string | null;
  occasion?: string[] | null;
  categoryId?: string | null;
  description?: string | null;
  createdAt?: Date | null;
  garment_sizes?: GarmentSizeRow[];
  images?: Array<{ imageUrl: string }>;
};

const COLOR_LABELS: Record<string, string> = {
  do: "đỏ",
  hong: "hồng",
  xanh: "xanh",
  trang: "trắng",
  den: "đen",
  vang: "vàng",
  nau: "nâu",
  kem: "kem",
  be: "be",
  bac: "bạc",
  ghi: "ghi",
  xam: "xám",
  cam: "cam",
  cham: "chấm",
  tim: "tím",
};

type GarmentAccessoryRow = {
  quantity: number;
  is_included: boolean;
  extra_price: unknown;
  note: string | null;
  accessories: {
    name: string;
    category: string | null;
    color: string | null;
    material: string | null;
    is_active: boolean;
  };
};

function formatVnd(value: unknown): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "chưa cập nhật";
  return `${new Intl.NumberFormat("vi-VN").format(amount)}đ`;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "?";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Chỉ tra các trường được duyệt: tên, màu, size, giá, tình trạng size.
 * Không đọc mật khẩu/token/dữ liệu thanh toán của người dùng.
 *
 * Tra sản phẩm theo thứ tự:
 *  (a) id trong product card gần nhất của hội thoại,
 *  (b) khớp tên/màu catalog khi ra đúng một kết quả,
 *  (c) nhiều/không kết quả -> router hỏi lại một lần rồi STAFF.
 */
@Injectable()
export class DbHandlersService {
  constructor(private readonly prisma: PrismaService) {}

  async handle(input: DbHandlerInput): Promise<DbHandlerResult> {
    switch (input.intent) {
      case "db.order_status":
        return this.handleOrderStatus(input);
      case "db.product_price":
        return this.handleProductLookup(input, "price");
      case "db.product_card_detail":
        return this.handleProductLookup(input, "card");
      case "db.catalog_search":
      case "db.contextual_answer":
        return this.handleProductLookup(input, "catalog");
      case "db.catalog_price":
        return this.handleCatalogPrice(input);
      case "db.product_accessories":
        return this.handleProductAccessories(input);
      case "db.product_sizes":
        return this.handleProductSizes(input);
      case "db.product_stock":
        return this.handleProductStock(input);
      case "db.product_info":
        return this.handleProductInfo(input);
      case "db.product_availability":
        return this.handleProductAvailability(input);
      case "db.product_alternatives":
        return this.handleProductAlternatives(input);
      case "db.product_categories":
        return this.handleProductCategories();
      case "db.category_products":
        return this.handleCategoryProducts(input);
      case "db.catalog_occasion":
        return this.handleCatalogOccasion(input);
      default:
        return { status: "staff", reason: "db_intent_unsupported" };
    }
  }

  /**
   * Liệt kê mẫu theo dịp khách hỏi ("đi Tết", "dự tiệc", "đám cưới"...).
   *
   * Câu như "mẫu trang phục đi tết" trước đây không khớp luật nào nên rơi
   * xuống UNKNOWN → chuyển nhân viên oan. Ở đây trả danh sách thật theo
   * `garment.occasion`, kèm lọc màu/size/tên mẫu nếu khách có nêu.
   */
  private async handleCatalogOccasion(input: DbHandlerInput): Promise<DbHandlerResult> {
    const normalized = normalizeForMatch(input.content);
    const occasions = detectOccasions(normalized);
    const label = occasions.length > 0 ? occasionLabel(occasions[0]) : "này";

    const garments = (await this.prisma.garment.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        garment_sizes: { some: { is_active: true } },
      },
      include: {
        garment_sizes: {
          where: { is_active: true },
          orderBy: { daily_price: "asc" },
        },
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
      },
      take: 200,
    })) as GarmentRow[];

    const base = garments.filter(
      (garment) =>
        this.matchesRequestedAttributes(garment, input) &&
        this.matchesNameTerms(garment, normalized),
    );

    // Ưu tiên mẫu có `occasion` khớp dịp khách hỏi. Mẫu chưa nhập dịp không
    // bị coi là khớp (khác `matchesOccasion`) để danh sách không bị loãng.
    const exact = base.filter((garment) =>
      this.matchesOccasionStrict(garment, occasions),
    );

    const list = (exact.length > 0 ? exact : base)
      .slice()
      .sort(
        (a, b) =>
          Number(a.garment_sizes?.[0]?.daily_price ?? 0) -
          Number(b.garment_sizes?.[0]?.daily_price ?? 0),
      );

    if (list.length === 0) {
      return {
        status: "reply",
        reply: `Dạ shop hiện chưa có mẫu đang mở thuê cho dịp ${label}. Anh/chị muốn em gợi ý mẫu khác hoặc xem danh mục sản phẩm không ạ?`,
      };
    }

    const top = list.slice(0, 3);
    const lines = top
      .map((garment, index) => {
        const sizes = (garment.garment_sizes ?? [])
          .map((size) => size.size_label)
          .filter((value): value is string => Boolean(value));
        const sizeText = sizes.length > 0 ? `, size ${sizes.join("/")}` : "";
        const colorText = garment.color ? `, màu ${garment.color}` : "";
        const priceText = formatVnd(garment.garment_sizes?.[0]?.daily_price);
        return `${index + 1}. ${garment.name}${colorText}${sizeText} — ${priceText}/ngày`;
      })
      .join("; ");

    const intro =
      exact.length > 0
        ? `Dạ shop có ${exact.length} mẫu phù hợp dịp ${label}`
        : `Dạ shop chưa phân loại mẫu theo dịp ${label}; một vài mẫu đang mở thuê`;

    return {
      status: "reply",
      reply: `${intro}: ${lines}. Anh/chị muốn xem mẫu nào ạ?`,
      productIds: top.map((garment) => garment.id),
    };
  }

  /**
   * Lọc catalog theo khoảng giá thuê/ngày.
   *
   * Khách hay hỏi "có mẫu nào dưới 100k không", "áo dài từ 300 đến 1 triệu".
   * Trước đây các câu này bị hiểu là hỏi giá một mẫu cụ thể nên trả "chưa có
   * mẫu phù hợp". Ở đây lọc trên giá của các size đang mở thuê, trả tối đa 3
   * mẫu kèm product card.
   */
  private async handleCatalogPrice(input: DbHandlerInput): Promise<DbHandlerResult> {
    const { priceMin, priceMax, color } = input.slots;

    if (priceMin === undefined && priceMax === undefined) {
      return {
        status: "reply",
        reply: `Dạ anh/chị muốn tìm mẫu trong khoảng giá nào ạ? Ví dụ "dưới 300k" hoặc "từ 300k đến 500k".`,
      };
    }

    const sizeFilter: Record<string, unknown> = { is_active: true };
    if (priceMin !== undefined || priceMax !== undefined) {
      sizeFilter.daily_price = {
        ...(priceMin !== undefined ? { gte: priceMin } : {}),
        ...(priceMax !== undefined ? { lte: priceMax } : {}),
      };
    }

    const garments = (await this.prisma.garment.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        garment_sizes: { some: sizeFilter },
      },
      include: {
        garment_sizes: {
          where: { is_active: true },
          orderBy: { daily_price: "asc" },
        },
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
      },
      take: 100,
    })) as GarmentRow[];

    const matches = garments
      .map((garment) => {
        const sizes = (garment.garment_sizes ?? []).filter((size) => {
          const price = Number(size.daily_price ?? 0);
          if (priceMin !== undefined && price < priceMin) return false;
          if (priceMax !== undefined && price > priceMax) return false;
          return true;
        });
        return sizes.length > 0 ? { garment, sizes } : null;
      })
      .filter((entry): entry is { garment: GarmentRow; sizes: GarmentSizeRow[] } => Boolean(entry))
      .filter(
        (entry) =>
          !color ||
          foldVietnamese(entry.garment.color ?? "").includes(color),
      );

    // Khách vừa lọc giá vừa nêu dịp ("đi tết dưới 500k"): ưu tiên mẫu đúng
    // dịp; chỉ bỏ lọc dịp khi không mẫu nào có dữ liệu dịp khớp.
    const occasions = detectOccasions(normalizeForMatch(input.content));
    const byOccasion =
      occasions.length > 0
        ? matches.filter((entry) =>
            this.matchesOccasionStrict(entry.garment, occasions),
          )
        : [];
    const filtered = byOccasion.length > 0 ? byOccasion : matches;

    const sorted = filtered.sort(
      (a, b) =>
        Number(a.sizes[0].daily_price ?? 0) - Number(b.sizes[0].daily_price ?? 0),
    );

    const requested = this.describePriceRequest(priceMin, priceMax);
    const colorText = color ? ` màu ${COLOR_LABELS[color] ?? color}` : "";

    if (sorted.length === 0) {
      return {
        status: "reply",
        reply: `Dạ shop hiện chưa có mẫu${colorText}${requested}. Anh/chị muốn em gợi ý mẫu khác hoặc xem danh mục sản phẩm không ạ?`,
      };
    }

    const top = sorted.slice(0, 3);
    const lines = top
      .map(({ garment, sizes }, index) => {
        const labels = sizes
          .map((size) => size.size_label)
          .filter((label): label is string => Boolean(label));
        const sizeText = labels.length > 0 ? `, size ${labels.join("/")}` : "";
        const priceText = formatVnd(sizes[0].daily_price);
        const colorOfGarment = garment.color ? `, màu ${garment.color}` : "";
        return `${index + 1}. ${garment.name}${colorOfGarment}${sizeText} — ${priceText}/ngày`;
      })
      .join("; ");

    return {
      status: "reply",
      reply: `Dạ shop có ${sorted.length} mẫu${colorText}${requested}: ${lines}. Anh/chị muốn xem mẫu nào ạ?`,
      productIds: top.map(({ garment }) => garment.id),
    };
  }

  /** Mô tả khoảng giá khách hỏi để câu trả lời đọc tự nhiên. */
  private describePriceRequest(priceMin?: number, priceMax?: number): string {
    if (priceMin !== undefined && priceMax !== undefined) {
      return ` trong khoảng ${formatVnd(priceMin)} – ${formatVnd(priceMax)}/ngày`;
    }
    if (priceMax !== undefined) {
      return ` có giá dưới ${formatVnd(priceMax)}/ngày`;
    }
    return ` có giá trên ${formatVnd(priceMin)}/ngày`;
  }

  private async handleProductSizes(input: DbHandlerInput): Promise<DbHandlerResult> {
    const current = await this.findGarmentOrReply(input);
    if ("result" in current) return current.result;

    const garment = current.garment;
    const sizes = (garment.garment_sizes ?? []).filter(
      (size) => size.is_active !== false && size.size_label,
    );

    if (sizes.length === 0) {
      return {
        status: "reply",
        reply: `Dạ mẫu ${garment.name} hiện chưa có size đang mở thuê ạ.`,
        productIds: [garment.id],
      };
    }

    const sizeText = sizes
      .map((size) => `${size.size_label} (${formatVnd(size.daily_price)}/ngày)`)
      .join(", ");

    if (sizes.length === 1) {
      return {
        status: "reply",
        reply: `Dạ mẫu ${garment.name} hiện chỉ mở thuê size ${sizeText} ạ. Anh/chị cần em kiểm tra thêm gì về mẫu này không?`,
        productIds: [garment.id],
      };
    }

    return {
      status: "reply",
      reply: `Dạ mẫu ${garment.name} đang mở thuê các size: ${sizeText} ạ. Anh/chị cần size nào?`,
      productIds: [garment.id],
    };
  }

  /**
   * "Còn hàng không" cho đúng mẫu đang xem: đếm số bộ đang sẵn sàng (không
   * tính bộ đang thuê trong ngày hôm nay) thay vì chỉ mô tả lại mẫu.
   */
  private async handleProductStock(input: DbHandlerInput): Promise<DbHandlerResult> {
    const current = await this.findGarmentOrReply(input);
    if ("result" in current) return current.result;

    const garment = current.garment;
    const requestedSize = input.slots.size?.toUpperCase();
    const sizeId = requestedSize
      ? (garment.garment_sizes ?? []).find(
          (size) => (size.size_label ?? "").toUpperCase() === requestedSize,
        )?.id
      : undefined;

    const today = new Date();
    const dayStart = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
    );
    const dayEnd = addDaysUtc(dayStart, 1);

    const [assets, overlappingItems] = await Promise.all([
      this.prisma.garmentAsset.findMany({
        where: {
          garmentId: garment.id,
          ...(sizeId ? { garment_size_id: sizeId } : {}),
          status: { in: ["available", "cleaned"] },
        },
        select: { id: true },
      }),
      this.prisma.bookingItem.findMany({
        where: {
          garmentId: garment.id,
          booking: {
            status: { notIn: INACTIVE_BOOKING_STATUSES },
            rentalStartDate: { lt: dayEnd },
            rentalEndDate: { gte: dayStart },
          },
        },
        select: { garmentAssetId: true },
      }),
    ]);

    if (assets.length === 0) {
      return {
        status: "reply",
        reply: `Dạ mẫu ${garment.name}${
          requestedSize ? ` size ${requestedSize}` : ""
        } hiện chưa có bộ nào sẵn sàng cho thuê ạ. Anh/chị muốn em kiểm tra ngày khác hoặc gợi ý mẫu khác không?`,
        productIds: [garment.id],
      };
    }

    const availableAssetIds = new Set(assets.map((asset) => asset.id));
    const blocked = new Set<string>();
    let unassigned = 0;
    for (const item of overlappingItems) {
      if (item.garmentAssetId && availableAssetIds.has(item.garmentAssetId)) {
        blocked.add(item.garmentAssetId);
      } else if (!item.garmentAssetId) {
        unassigned += 1;
      }
    }

    const availableCount = Math.max(0, assets.length - blocked.size - unassigned);
    const sizeText = requestedSize ? ` (size ${requestedSize})` : "";

    if (availableCount === 0) {
      return {
        status: "reply",
        reply: `Dạ mẫu ${garment.name}${sizeText} hiện đang hết bộ trống hôm nay ạ. Anh/chị muốn em kiểm tra ngày khác không?`,
        productIds: [garment.id],
      };
    }

    return {
      status: "reply",
      reply: `Dạ mẫu ${garment.name}${sizeText} hiện còn ${availableCount} bộ sẵn sàng cho thuê ạ.`,
      productIds: [garment.id],
    };
  }

  private async handleProductAccessories(input: DbHandlerInput): Promise<DbHandlerResult> {
    const current = await this.findGarmentOrReply(input);
    if ("result" in current) return current.result;

    const links = (await this.prisma.garment_accessories.findMany({
      where: {
        garment_id: current.garment.id,
        accessories: { is_active: true },
      },
      include: {
        accessories: {
          select: {
            name: true,
            category: true,
            color: true,
            material: true,
            is_active: true,
          },
        },
      },
      take: 8,
    })) as GarmentAccessoryRow[];

    if (links.length === 0) {
      return {
        status: "reply",
        reply: `Dạ mẫu ${current.garment.name} hiện chưa gắn phụ kiện đi kèm trong hệ thống ạ. Anh/chị có thể hỏi shop về phụ kiện cho thuê riêng nhé.`,
      };
    }

    const items = links.map((link, index) => {
      const accessory = link.accessories;
      const meta = [accessory.category, accessory.color]
        .filter((value): value is string => Boolean(value))
        .join(", ");
      const quantity = link.quantity > 1 ? ` x${link.quantity}` : "";
      const price = link.is_included
        ? "kèm theo"
        : `thuê thêm ${formatVnd(link.extra_price)}/ngày`;
      return `${index + 1}. ${accessory.name}${quantity}${meta ? ` (${meta})` : ""} — ${price}`;
    });

    return {
      status: "reply",
      reply: `Dạ mẫu ${current.garment.name} có phụ kiện đi kèm: ${items.join("; ")} ạ.`,
    };
  }

  private async handleProductInfo(input: DbHandlerInput): Promise<DbHandlerResult> {
    const current = await this.findGarmentOrReply(input);
    if ("result" in current) return current.result;

    const sizes = (current.garment.garment_sizes ?? []).filter(
      (size) => size.is_active !== false && size.size_label,
    );
    const sizeRows = sizes.map((s) => ({
      label: s.size_label ?? "?",
      price: formatVnd(s.daily_price),
    }));

    const links = (await this.prisma.garment_accessories.findMany({
      where: {
        garment_id: current.garment.id,
        accessories: { is_active: true },
      },
      include: {
        accessories: {
          select: {
            name: true,
            category: true,
            color: true,
            material: true,
            is_active: true,
          },
        },
      },
      take: 8,
    })) as GarmentAccessoryRow[];

    const accessoryItems = links.map((link, index) => {
      const accessory = link.accessories;
      const meta = [accessory.category, accessory.color]
        .filter((value): value is string => Boolean(value))
        .join(", ");
      const quantity = `số lượng ${link.quantity}`;
      const price = link.is_included
        ? "kèm theo"
        : `thuê thêm ${formatVnd(link.extra_price)}/ngày`;
      return `${index + 1}. ${accessory.name} (${quantity}${
        meta ? `, ${meta}` : ""
      }) — ${price}`;
    });

    const productIds = [current.garment.id];

    let reply = `Dạ thông tin mẫu ${current.garment.name}:\n`;
    reply += `Màu: ${current.garment.color ?? "chưa cập nhật"}\n`;
    if (sizeRows.length > 1) {
      reply += `Giá: từ ${sizeRows[0].price} đến ${sizeRows[sizeRows.length - 1].price} (tùy size)/ngày.\n`;
    } else {
      reply += `Giá: ${sizeRows[0]?.price ?? "chưa cập nhật"}/ngày.\n`;
    }

    if (sizeRows.length > 0) {
      reply += `Size mở thuê: ${sizeRows
        .map((s) => `${s.label} (${s.price})`)
        .join(", ")}\n`;
    } else {
      reply += `Size: hiện chưa mở size nào để thuê.\n`;
    }

    reply += `\nPhụ kiện đi kèm:\n`;
    if (accessoryItems.length > 0) {
      reply += `${accessoryItems.join("\n")}\n`;
      reply +=
        "Lưu ý: hệ thống gắn phụ kiện theo từng mẫu, chưa tách riêng theo size. " +
        "Nếu anh/chị cần phụ kiện cho đúng size đã chọn, em sẽ nhờ nhân viên xác nhận lại ạ.";
    } else {
      reply += "Mẫu này hiện chưa gắn phụ kiện đi kèm trong hệ thống ạ.";
    }

    reply += "\n\nAnh/chị cần em kiểm tra thêm gì về mẫu này không ạ?";

    return { status: "reply", reply, productIds };
  }

  private async handleProductAvailability(input: DbHandlerInput): Promise<DbHandlerResult> {
    const current = await this.findGarmentOrReply(input);
    if ("result" in current) return current.result;

    const requestedDate = parseRequestedDate(input.content);
    if (!requestedDate) {
      return {
        status: "ask",
        askKey: "availability:date",
        reply:
          "Dạ anh/chị muốn kiểm tra ngày nào ạ? Anh/chị ghi ngày cụ thể (ví dụ 20/11) giúp em nhé.",
      };
    }

    const requestedSize = input.slots.size?.toUpperCase();
    let sizeId: string | undefined;
    if (requestedSize) {
      // Chỉ kiểm tra đúng size khách hỏi; nếu mẫu không có size đó thì trả lời
      // luôn thay vì báo tồn kho của size khác.
      const sizeRow = (current.garment.garment_sizes ?? []).find(
        (size) => (size.size_label ?? "").toUpperCase() === requestedSize,
      );
      if (!sizeRow?.id) {
        return {
          status: "reply",
          reply: `Dạ mẫu ${current.garment.name} hiện không có size ${requestedSize} ạ. Anh/chị muốn em gợi ý mẫu khác không?`,
        };
      }
      sizeId = sizeRow.id;
    }

    const dayEnd = addDaysUtc(requestedDate, 1);
    const [assets, overlappingItems] = await Promise.all([
      this.prisma.garmentAsset.findMany({
        where: {
          garmentId: current.garment.id,
          ...(sizeId ? { garment_size_id: sizeId } : {}),
          status: { in: ["available", "cleaned"] },
        },
        select: { id: true },
      }),
      this.prisma.bookingItem.findMany({
        where: {
          garmentId: current.garment.id,
          booking: {
            status: { notIn: INACTIVE_BOOKING_STATUSES },
            rentalStartDate: { lt: dayEnd },
            rentalEndDate: { gte: requestedDate },
          },
        },
        select: { garmentAssetId: true },
      }),
    ]);

    if (assets.length === 0) {
      return {
        status: "staff",
        reason: "availability_unverified",
      };
    }

    const availableAssetIds = new Set(assets.map((asset) => asset.id));
    const blockedAssetIds = new Set<string>();
    let unassignedItems = 0;
    for (const item of overlappingItems) {
      if (item.garmentAssetId && availableAssetIds.has(item.garmentAssetId)) {
        blockedAssetIds.add(item.garmentAssetId);
      } else if (!item.garmentAssetId) {
        unassignedItems += 1;
      }
    }

    const availableCount = Math.max(
      0,
      assets.length - blockedAssetIds.size - unassignedItems,
    );
    const sizeText = input.slots.size ? ` (size ${input.slots.size.toUpperCase()})` : "";
    const dateText = formatDateOnly(requestedDate);

    if (availableCount === 0) {
      return {
        status: "reply",
        reply: `Dạ mẫu ${current.garment.name}${sizeText} đã kín lịch ngày ${dateText} ạ. Anh/chị muốn em gợi ý mẫu khác cùng loại không?`,
      };
    }

    return {
      status: "reply",
      reply: `Dạ mẫu ${current.garment.name}${sizeText} còn ${availableCount} bộ trống ngày ${dateText} ạ.`,
    };
  }

  private async handleProductAlternatives(input: DbHandlerInput): Promise<DbHandlerResult> {
    const current = await this.findGarmentOrReply(input);
    if ("result" in current) return current.result;

    const alternatives = await this.findActiveGarments(
      {
        id: { not: current.garment.id },
        ...(current.garment.categoryId
          ? { categoryId: current.garment.categoryId }
          : {}),
      },
      2,
    );

    if (alternatives.length === 0) {
      return {
        status: "reply",
        reply: `Dạ hiện tại shop chưa có mẫu khác cùng loại với ${current.garment.name} ạ. Anh/chị có muốn xem danh mục khác không?`,
      };
    }

    return {
      status: "reply",
      reply: `Dạ ngoài ${current.garment.name}, shop còn ${this.describeGarments(
        alternatives,
      )} ạ. Anh/chị muốn xem mẫu nào?`,
      productIds: alternatives.map((garment) => garment.id),
    };
  }

  private async handleProductCategories(): Promise<DbHandlerResult> {
    const categories = await this.activeCategories();
    if (categories.length === 0) {
      return { status: "staff", reason: "catalog_empty" };
    }

    return {
      status: "reply",
      reply: this.categoriesReply(categories.map((category) => category.name)),
    };
  }

  private async handleCategoryProducts(input: DbHandlerInput): Promise<DbHandlerResult> {
    const categories = await this.activeCategories();
    if (categories.length === 0) {
      return { status: "staff", reason: "catalog_empty" };
    }

    const normalizedContent = normalizeForMatch(input.content);
    const requestedName = input.slots.categoryName?.trim();
    const matched =
      (requestedName
        ? categories.find(
            (category) =>
              normalizeForMatch(category.name) === normalizeForMatch(requestedName),
          )
        : undefined) ?? this.matchCategory(categories, normalizedContent);

    if (!matched) {
      return {
        status: "ask",
        askKey: "category:select",
        reply: this.categoriesReply(categories.map((category) => category.name)),
      };
    }

    const garments = await this.findActiveGarments({ categoryId: matched.id }, 2);
    if (garments.length === 0) {
      return {
        status: "reply",
        reply: `Dạ danh mục ${matched.name} hiện chưa có mẫu đang hoạt động ạ. Anh/chị muốn xem danh mục khác không?`,
      };
    }

    return {
      status: "reply",
      reply: `Dạ danh mục ${matched.name} đang có ${this.describeGarments(
        garments,
      )} ạ. Anh/chị muốn xem mẫu nào?`,
      productIds: garments.map((garment) => garment.id),
    };
  }

  /**
   * Khớp danh mục khách chọn với tên thật trong DB.
   *
   * Khách thường gõ tắt ("vest" cho "Bộ vest", "dài" cho "Áo dài") nên ngoài
   * so khớp tuyệt đối còn xét tên chứa câu khách gõ và câu khách gõ chứa tên.
   * Điểm ưu tiên giúp "áo dài" chọn đúng "Áo dài" thay vì "Áo dài cách tân".
   */
  private matchCategory(
    categories: Array<{ id: string; name: string }>,
    normalizedContent: string,
  ): { id: string; name: string } | undefined {
    const content = normalizedContent.trim();
    if (!content) return undefined;

    const contentTokens = content.split(" ").filter((token) => token.length >= 2);
    let best: { category: { id: string; name: string }; score: number } | undefined;

    for (const category of categories) {
      const name = normalizeForMatch(category.name).trim();
      if (!name) continue;

      let score = 0;
      if (content === name) {
        score = 1000 - name.length;
      } else if (name.startsWith(content)) {
        score = 800 - name.length;
      } else if (name.includes(content)) {
        score = 600 - name.length;
      } else if (content.includes(name)) {
        score = 400 + name.length;
      } else {
        const nameTokens = new Set(name.split(" "));
        const covers =
          contentTokens.length > 0 &&
          contentTokens.every((token) => nameTokens.has(token));
        if (covers) score = 200 + name.length;
      }

      if (score > 0 && (!best || score > best.score)) {
        best = { category, score };
      }
    }

    return best?.category;
  }

  private async activeCategories(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.garmentCategory.findMany({
      where: {
        isActive: true,
        garments: { some: { isActive: true, deletedAt: null } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  }

  private async findActiveGarments(
    where: Record<string, unknown>,
    take: number,
  ): Promise<GarmentRow[]> {
    const garments = (await this.prisma.garment.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        garment_sizes: { some: { is_active: true } },
        ...where,
      },
      include: {
        garment_sizes: {
          where: { is_active: true },
          orderBy: { daily_price: "asc" },
        },
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(take * 3, 6),
    })) as GarmentRow[];

    return garments
      .filter((garment) => (garment.garment_sizes ?? []).length > 0)
      .slice(0, take);
  }

  private describeGarments(garments: GarmentRow[]): string {
    return garments
      .map((garment, index) => {
        const sizes = (garment.garment_sizes ?? [])
          .map((size) => size.size_label)
          .filter((label): label is string => Boolean(label));
        const price = garment.garment_sizes?.[0]?.daily_price;
        const color = garment.color ? `, màu ${garment.color}` : "";
        const sizeText = sizes.length > 0 ? `, size ${sizes.join(", ")}` : "";
        return `${index + 1}. ${garment.name}${color}${sizeText} — ${formatVnd(price)}/ngày`;
      })
      .join("; ");
  }

  private categoriesReply(names: string[]): string {
    return `Dạ shop hiện có các danh mục: ${names.join(", ")}. Anh/chị muốn xem loại nào ạ?`;
  }

  private async findGarmentOrReply(
    input: DbHandlerInput,
  ): Promise<{ garment: GarmentRow } | { result: DbHandlerResult }> {
    const lookup = await this.findGarment(input);

    if (lookup.status === "ambiguous") {
      const names = lookup.candidates
        .slice(0, 3)
        .map((item) => item.name)
        .join(", ");
      return {
        result: {
          status: "ask",
          askKey: `product:ambiguous:${lookup.candidates
            .map((item) => item.id)
            .sort()
            .join(",")}`,
          reply: `Shop có nhiều mẫu phù hợp (${names}). Anh/chị muốn xem mẫu nào ạ?`,
        },
      };
    }

    if (lookup.status === "not_found") {
      return {
        result: {
          status: "ask",
          askKey: "product:missing",
          reply: PRODUCT_NOT_FOUND_REPLY,
        },
      };
    }

    return { garment: lookup.garment };
  }

  private async handleOrderStatus(input: DbHandlerInput): Promise<DbHandlerResult> {
    if (!input.bookingId) {
      return {
        status: "ask",
        askKey: "order_status:booking",
        reply:
          "Dạ anh/chị cho em biết đơn đang cần kiểm tra (hoặc mở đúng hội thoại của đơn) để em xem giúp ạ.",
      };
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        customerId: true,
        status: true,
        rentalStartDate: true,
        rentalEndDate: true,
        rentalTotal: true,
        depositTotal: true,
      },
    });

    // Chỉ trả thông tin khi đơn thuộc đúng khách của hội thoại.
    if (!booking || booking.customerId !== input.customerId) {
      return { status: "staff", reason: "order_lookup_denied" };
    }

    const statusLabel = STATUS_LABELS[booking.status] ?? booking.status;
    const reply = [
      `Đơn thuê của anh/chị đang ở trạng thái: ${statusLabel}.`,
      `Thời gian thuê: ${formatDate(booking.rentalStartDate)} → ${formatDate(booking.rentalEndDate)}.`,
      `Tổng thuê: ${formatVnd(booking.rentalTotal)} · Tiền cọc: ${formatVnd(booking.depositTotal)}.`,
    ].join(" ");

    return { status: "reply", reply };
  }

  private async handleProductLookup(
    input: DbHandlerInput,
    mode: "price" | "catalog" | "card",
  ): Promise<DbHandlerResult> {
    const lookup = await this.findGarment(input, {
      allowAttributeFallback: mode === "catalog",
    });

    if (lookup.status === "ambiguous") {
      // Tra cứu rộng (màu/size/dịp): trả luôn danh sách mẫu phù hợp kèm product
      // card thay vì hỏi lại một câu chung. Tối đa 3 mẫu để bubble không dài.
      if (mode === "catalog") {
        const candidates = lookup.candidates.slice(0, 3);
        return {
          status: "reply",
          reply: `Dạ shop có ${candidates.length} mẫu phù hợp: ${this.describeGarments(
            candidates,
          )}. Anh/chị muốn xem mẫu nào ạ?`,
          productIds: candidates.map((garment) => garment.id),
        };
      }

      const names = lookup.candidates
        .slice(0, 3)
        .map((item) => item.name)
        .join(", ");
      return {
        status: "ask",
        askKey: `product:ambiguous:${lookup.candidates
          .map((item) => item.id)
          .sort()
          .join(",")}`,
        reply: `Shop có nhiều mẫu phù hợp (${names}). Anh/chị muốn xem mẫu nào ạ?`,
      };
    }

    if (lookup.status === "not_found") {
      if (mode === "catalog") {
        const requested = this.describeRequest(input);
        return {
          status: "reply",
          reply: `Dạ shop hiện chưa có mẫu ${requested}. Anh/chị muốn em gợi ý mẫu khác hoặc xem danh mục sản phẩm không ạ?`,
        };
      }
      return { status: "not_found" };
    }

    const garment = lookup.garment;
    const sizes = (garment.garment_sizes ?? []).filter(
      (size) => size.is_active !== false && size.size_label,
    );

    if (sizes.length === 0) {
      if (mode !== "card") return { status: "not_found" };
      return {
        status: "reply",
        reply: `Dạ mẫu ${garment.name}${
          garment.color ? `, màu ${garment.color}` : ""
        } hiện chưa có size đang mở thuê. Anh/chị cần em tư vấn thêm gì về mẫu này ạ?`,
        productIds: [garment.id],
      };
    }

    const wantedSize = input.slots.size?.toUpperCase();
    const selected = wantedSize
      ? sizes.find((size) => (size.size_label ?? "").toUpperCase() === wantedSize) ??
        // Khách vừa gửi product card: vẫn trả thông tin mẫu kèm danh sách
        // size đang mở, không bắt khách chọn lại size.
        (mode === "card" ? sizes[0] : undefined)
      : sizes[0];

    if (!selected) {
      return {
        status: "ask",
        askKey: `product:size:${garment.id}:${wantedSize ?? "any"}`,
        reply: `Mẫu ${garment.name} hiện có size ${sizes
          .map((size) => size.size_label)
          .filter(Boolean)
          .join(", ")}. Anh/chị cần size nào ạ?`,
      };
    }

    const sizeLabel = selected.size_label ?? "đang cập nhật";
    const priceText = formatVnd(selected.daily_price);
    const colorText = garment.color ? `, màu ${garment.color}` : "";
    const sizeList = sizes
      .map((size) => size.size_label)
      .filter((label): label is string => Boolean(label));

    if (mode === "price") {
      return {
        status: "reply",
        reply: `Mẫu ${garment.name}${colorText} có giá thuê ${priceText}/ngày (size ${sizeLabel}).`,
        productIds: [garment.id],
      };
    }

    if (mode === "card") {
      return {
        status: "reply",
        reply: `Dạ mẫu ${garment.name}${colorText} đang có size ${sizeList.join(
          ", ",
        )} — giá ${priceText}/ngày. Anh/chị cần em tư vấn thêm gì về mẫu này ạ?`,
        productIds: [garment.id],
      };
    }

    return {
      status: "reply",
      reply: `Shop đang có mẫu ${garment.name}${colorText}, size ${sizeList.join(", ")} — giá ${priceText}/ngày.`,
      productIds: [garment.id],
    };
  }

  private async findGarment(
    input: DbHandlerInput,
    options: { allowAttributeFallback?: boolean } = {},
  ): Promise<
    | { status: "found"; garment: GarmentRow }
    | { status: "ambiguous"; candidates: GarmentRow[] }
    | { status: "not_found" }
  > {
    const include = {
      garment_sizes: {
        where: { is_active: true },
        orderBy: { daily_price: "asc" as const },
      },
      images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
    };

    // (a) Product card gần nhất trong hội thoại — chỉ dùng khi mẫu đó thực sự
    // khớp màu/size khách hỏi. Nếu không, tiếp tục tra catalog để không trả
    // lại đúng mẫu vừa xem cho mọi câu hỏi.
    if (input.slots.lastProductCardId) {
      const garment = await this.prisma.garment.findUnique({
        where: { id: input.slots.lastProductCardId },
        include,
      });
      if (garment) {
        const cardMatches =
          !options.allowAttributeFallback ||
          (this.matchesRequestedAttributes(garment as GarmentRow, input) &&
            this.matchesOccasion(
              garment as GarmentRow,
              normalizeForMatch(input.content),
            ));
        if (cardMatches) {
          return { status: "found", garment: garment as GarmentRow };
        }
      }
    }

    // (b) Khớp tên/màu/size/dịp trên catalog.
    const garments = (await this.prisma.garment.findMany({
      where: { isActive: true, deletedAt: null },
      include,
      take: 200,
    })) as GarmentRow[];

    let matches = garments.filter((garment) => this.matches(garment, input));

    // (b1) Ưu tiên khớp trọn tên mẫu. Câu như "Tư vấn tôi sản phẩm Áo Dài Nam
    // Ngũ Thân" chỉ trích được từ khoá chung "ao dai"/"ao" nên sẽ khớp cả
    // catalog; nếu tên mẫu (đã bỏ dấu) xuất hiện trọn trong câu thì đó là mẫu
    // khách muốn, không phải trường hợp mơ hồ.
    if (matches.length > 1) {
      const narrowed = this.narrowByFullName(matches, normalizeForMatch(input.content));
      if (narrowed) return narrowed;
    }

    if (matches.length === 0 && detectOccasions(normalizeForMatch(input.content)).length > 0) {
      // Dữ liệu `occasion` có thể chưa được nhập đầy đủ: nếu lọc theo dịp không
      // ra kết quả, bỏ lọc dịp và giữ các điều kiện màu/size để không trả lời
      // sai rằng shop không có mẫu.
      matches = garments.filter((garment) =>
        this.matches(garment, input, { ignoreOccasion: true }),
      );
    }
    if (matches.length === 1) return { status: "found", garment: matches[0] };
    if (matches.length > 1) return { status: "ambiguous", candidates: matches };
    return { status: "not_found" };
  }

  /**
   * Thu hẹp danh sách ứng viên theo tên mẫu đầy đủ xuất hiện trong câu.
   *
   * Bộ lọc tên hiện tại (`PRODUCT_NAME_TERMS`) chỉ bắt các từ khoá chung như
   * "ao dai"/"ao", nên câu nêu tên mẫu cụ thể vẫn khớp nhiều mẫu và bị coi là
   * mơ hồ. Ở đây ta so khớp trọn tên mẫu (đã bỏ dấu) với câu khách viết:
   * nếu đúng một mẫu khớp thì trả luôn, nhiều mẫu cùng khớp thì để nguyên
   * danh sách cho bước hỏi lại.
   *
   * Một số tên dài hơn tên khác ("Áo Dài Nam Ngũ Thân" vs "Áo Dài Nam Tay
   * Thụng Ngũ Thân"), nên chỉ nhận mẫu khi tên nó không bị mẫu khác dài hơn
   * "nuốt" mất — tránh trả nhầm mẫu ngắn.
   */
  private narrowByFullName(
    candidates: GarmentRow[],
    normalized: string,
  ): { status: "found"; garment: GarmentRow } | { status: "ambiguous"; candidates: GarmentRow[] } | null {
    const withNames = candidates.map((garment) => ({
      garment,
      folded: foldVietnamese(garment.name ?? "").replace(/\s+/g, " ").trim(),
    }));

    // Câu phải chứa trọn tên mẫu như một cụm từ.
    const contained = withNames.filter(
      (item) =>
        item.folded.length > 0 &&
        ` ${normalized} `.includes(` ${item.folded} `),
    );
    if (contained.length === 0) return null;

    // Nếu có mẫu trùng tên nhau (dữ liệu nhập lặp), coi như một mẫu duy nhất.
    const unique = new Map(contained.map((item) => [item.folded, item.garment]));
    if (unique.size === 1) {
      return { status: "found", garment: [...unique.values()][0] };
    }

    // Chỉ giữ những mẫu chứa tên mẫu khác ngắn hơn trong câu: câu "áo dài nam
    // tay thụng ngũ thân" chứa cả "áo dài nam ngũ thân" theo kiểu khớp cụm,
    // nên phải loại mẫu ngắn để không báo mơ hồ sai.
    const longest = Math.max(...contained.map((item) => item.folded.length));
    const onlyLongest = contained.filter((item) => item.folded.length === longest);
    const longestUnique = new Map(
      onlyLongest.map((item) => [item.folded, item.garment]),
    );
    if (longestUnique.size === 1) {
      return { status: "found", garment: [...longestUnique.values()][0] };
    }

    return { status: "ambiguous", candidates: [...longestUnique.values()] };
  }

  private matchesRequestedAttributes(
    garment: GarmentRow,
    input: DbHandlerInput,
  ): boolean {
    const foldedColor = foldVietnamese(garment.color ?? "");

    if (input.slots.color && !foldedColor.includes(input.slots.color)) {
      return false;
    }

    if (input.slots.size) {
      const wanted = input.slots.size.toUpperCase();
      const hasSize = (garment.garment_sizes ?? []).some(
        (size) =>
          size.is_active !== false &&
          (size.size_label ?? "").toUpperCase() === wanted,
      );
      if (!hasSize) return false;
    }

    return true;
  }

  private matchesOccasion(garment: GarmentRow, normalized: string): boolean {
    const wantedOccasions = detectOccasions(normalized);
    if (wantedOccasions.length === 0) return true;

    const garmentOccasions = (garment.occasion ?? [])
      .map((value) => foldVietnamese(value))
      .filter(Boolean);
    // Chưa nhập `occasion` thì không loại mẫu; đã nhập thì phải khớp dịp.
    if (garmentOccasions.length === 0) return true;

    return wantedOccasions.some((keyword) =>
      garmentOccasions.some(
        (value) => value.includes(keyword) || keyword.includes(value),
      ),
    );
  }

  /**
   * Khớp dịp "chặt": mẫu chưa nhập `occasion` bị coi là KHÔNG khớp.
   *
   * Dùng cho danh sách theo dịp — nếu coi mẫu thiếu dữ liệu là khớp thì khách
   * hỏi "đồ đi Tết" sẽ nhận cả mẫu không liên quan.
   */
  private matchesOccasionStrict(garment: GarmentRow, occasions: string[]): boolean {
    if (occasions.length === 0) return true;

    const garmentOccasions = (garment.occasion ?? [])
      .map((value) => foldVietnamese(value))
      .filter(Boolean);
    if (garmentOccasions.length === 0) return false;

    return occasions.some((keyword) =>
      garmentOccasions.some(
        (value) => value.includes(keyword) || keyword.includes(value),
      ),
    );
  }

  /**
   * Các từ chỉ loại sản phẩm xuất hiện trong câu ("áo dài", "vest"...), bỏ qua
   * từ nhóm chung ("trang phục", "bộ đồ") vì chúng không thu hẹp danh sách.
   */
  private nameTermsInContent(normalized: string): string[] {
    return PRODUCT_NAME_TERMS.filter(
      (term) =>
        !GENERIC_PRODUCT_TERMS.has(term) &&
        (normalized === term ||
          normalized.startsWith(`${term} `) ||
          normalized.includes(` ${term} `) ||
          normalized.endsWith(` ${term}`)),
    );
  }

  private matchesNameTerms(garment: GarmentRow, normalized: string): boolean {
    const terms = this.nameTermsInContent(normalized);
    if (terms.length === 0) return true;

    const foldedName = foldVietnamese(garment.name ?? "");
    return terms.some((term) => foldedName.includes(term));
  }

  private matches(
    garment: GarmentRow,
    input: DbHandlerInput,
    options: { ignoreOccasion?: boolean } = {},
  ): boolean {
    const normalized = normalizeForMatch(input.content);
    const foldedName = foldVietnamese(garment.name ?? "");

    if (!this.matchesRequestedAttributes(garment, input)) {
      return false;
    }

    if (
      !options.ignoreOccasion &&
      !this.matchesOccasion(garment, normalized)
    ) {
      return false;
    }

    const nameTerms = PRODUCT_NAME_TERMS.filter(
      (term) =>
        !GENERIC_PRODUCT_TERMS.has(term) &&
        (normalized === term ||
          normalized.startsWith(`${term} `) ||
          normalized.includes(` ${term} `) ||
          normalized.endsWith(` ${term}`)),
    );

    if (nameTerms.length > 0) {
      return nameTerms.some((term) => foldedName.includes(term));
    }

    // Chỉ có màu/size mà không có tên sản phẩm vẫn là tìm kiếm hợp lệ.
    return Boolean(input.slots.color || input.slots.size);
  }

  private describeRequest(input: DbHandlerInput): string {
    const parts: string[] = [];
    if (input.slots.color) {
      parts.push(`màu ${COLOR_LABELS[input.slots.color] ?? input.slots.color}`);
    }
    if (input.slots.size) {
      parts.push(`size ${input.slots.size.toUpperCase()}`);
    }
    const occasion = detectOccasions(normalizeForMatch(input.content))[0];
    if (occasion) parts.push(`phù hợp ${occasion}`);
    return parts.length > 0 ? parts.join(", ") : "phù hợp";
  }
}
