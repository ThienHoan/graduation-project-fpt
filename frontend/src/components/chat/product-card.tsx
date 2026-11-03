"use client";

import Link from "next/link";
import type { ProductCardMessage } from "@/lib/chat";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

interface ProductCardProps {
  product: ProductCardMessage["product"];
}

/**
 * A compact product card rendered inside chat messages.
 * Clicking navigates to the product detail page.
 */
export function ProductCard({ product }: ProductCardProps) {
  const sizeLabel = product.sizes?.length ? product.sizes.join(", ") : product.size;
  const meta = [product.category, product.color].filter(Boolean).join(" · ");
  const hasPriceRange = typeof product.priceTo === "number" && product.priceTo > product.price;

  return (
    <Link
      href={product.detailUrl}
      className="block max-w-[180px] rounded-xl border border-sand/70 bg-white shadow-sm transition hover:shadow-md hover:border-antique overflow-hidden"
    >
      {/* Thumbnail */}
      <div className="aspect-[4/3] w-full overflow-hidden bg-parchment">
        <img
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover"
          onError={(e) => {
            // Fallback if image fails to load
            const target = e.currentTarget;
            target.src = "https://dep.com.vn/wp-content/uploads/2020/11/ao-dai-9.jpg";
          }}
        />
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold text-ink leading-tight line-clamp-2">{product.name}</p>
        {meta && <p className="text-[11px] text-stone-500">{meta}</p>}
        {sizeLabel && (
          <p className="text-xs text-stone-500">Size: {sizeLabel}</p>
        )}
        <p className="text-sm font-semibold text-lotus">
          {hasPriceRange ? "từ " : ""}
          {formatVND(product.price)}
          <span className="text-[11px] font-normal text-stone-500">/ngày</span>
        </p>
        {typeof product.depositFrom === "number" && product.depositFrom > 0 && (
          <p className="text-[11px] text-stone-500">Cọc từ {formatVND(product.depositFrom)}</p>
        )}
        {product.inStock === false && (
          <span className="inline-block rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
            Tạm hết
          </span>
        )}
      </div>
    </Link>
  );
}