/**
 * Dữ liệu product card gửi trong chat.
 *
 * Tách khỏi `chat.service.ts` để:
 *  - dùng chung cho tin nhắn thủ công của staff và card do AI/DB handler tạo;
 *  - test được bằng DB thật (integration opt-in) mà không cần dựng cả service.
 *
 * Các field cũ (`size`, `price`, `detailUrl`) giữ nguyên để client/classifier
 * hiện tại không phải đổi; field mới đều là optional.
 */

export const DEFAULT_PRODUCT_CARD_IMAGE =
  "https://dep.com.vn/wp-content/uploads/2020/11/ao-dai-9.jpg";

export type ProductCardGarmentSize = {
  id?: string | null;
  size_label?: string | null;
  daily_price?: unknown;
  deposit_amount?: unknown;
};

export type ProductCardGarment = {
  id: string;
  name: string;
  color?: string | null;
  category?: { name?: string | null } | null;
  images?: Array<{ imageUrl?: string | null }> | null;
  garment_sizes?: ProductCardGarmentSize[] | null;
  assets?: Array<{ id?: string | null; garment_size_id?: string | null }> | null;
};

export type ProductCardProduct = {
  id: string;
  name: string;
  image: string;
  /** Nhãn các size đang mở thuê, nối bằng ", " (giữ kiểu cũ). */
  size: string | null;
  /** Giá thuê thấp nhất (VNĐ/ngày). */
  price: number;
  detailUrl: string;
  /** Giá thấp nhất / cao nhất trong các size đang mở thuê. */
  priceFrom: number;
  priceTo: number;
  /** Cọc thấp nhất trong các size; 0 = chưa nhập. */
  depositFrom: number;
  /** Danh sách size đang mở thuê. */
  sizes: string[];
  /** Chỉ có khi biết dữ liệu tài sản: còn ít nhất 1 tài sản available. */
  inStock?: boolean;
  category?: string;
  color?: string;
};

function toPositiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function buildProductCardPayload(garment: ProductCardGarment): ProductCardProduct {
  const image = garment.images?.[0]?.imageUrl?.trim() || DEFAULT_PRODUCT_CARD_IMAGE;

  const allSizes = garment.garment_sizes ?? [];
  const labeledSizes = allSizes.filter(
    (size) => typeof size.size_label === "string" && size.size_label.trim() !== "",
  );

  const prices = labeledSizes
    .map((size) => toPositiveNumber(size.daily_price))
    .filter((price) => price > 0);
  const deposits = labeledSizes
    .map((size) => toPositiveNumber(size.deposit_amount))
    .filter((deposit) => deposit > 0);

  const price = prices.length > 0 ? Math.min(...prices) : toPositiveNumber(allSizes[0]?.daily_price);
  const detailSize =
    labeledSizes.find((size) => toPositiveNumber(size.daily_price) === price) ??
    labeledSizes[0] ??
    allSizes[0];

  const labels = [...new Set(labeledSizes.map((size) => size.size_label!.trim()))];

  const product: ProductCardProduct = {
    id: garment.id,
    name: garment.name,
    image,
    size: labels.length > 0 ? labels.join(", ") : null,
    price,
    detailUrl: `/catalog/${detailSize?.id ?? garment.id}`,
    priceFrom: price,
    priceTo: prices.length > 0 ? Math.max(...prices) : price,
    depositFrom: deposits.length > 0 ? Math.min(...deposits) : 0,
    sizes: labels,
  };

  if (garment.assets) {
    product.inStock = garment.assets.length > 0;
  }
  if (typeof garment.category?.name === "string" && garment.category.name.trim()) {
    product.category = garment.category.name.trim();
  }
  if (typeof garment.color === "string" && garment.color.trim()) {
    product.color = garment.color.trim();
  }

  return product;
}
