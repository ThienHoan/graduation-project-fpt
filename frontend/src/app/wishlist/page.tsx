"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import {
  type WishlistGarmentItem,
  getWishlistItems,
  removeWishlistItem,
  refreshWishlistFromServer,
} from "@/lib/wishlist";
import { addToCart, cartCount } from "@/lib/cart";
import { playWoodTap } from "@/lib/sound-fx";
import {
  getGarmentsGrouped,
  type GarmentGrouped,
} from "@/lib/api";
import { WishlistButton } from "@/components/common/wishlist-button";
import {
  Heart,
  Sparkles,
  ShoppingBag,
  Trash2,
  ArrowRight,
  Shirt,
  ChevronRight,
  Check,
  Share2,
  Maximize2,
  X,
  Search,
  LayoutGrid,
  Columns,
  CheckCircle2,
  ShieldCheck,
  Award,
  ArrowUpDown,
  Camera,
} from "lucide-react";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

export default function WishlistPage() {
  const router = useRouter();
  const [items, setItems] = useState<WishlistGarmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"recent" | "price-asc" | "price-desc" | "name">("recent");
  const [viewMode, setViewMode] = useState<"grid" | "compare">("grid");
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>({});
  const [copiedLink, setCopiedLink] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);
  const [addedToast, setAddedToast] = useState<string | null>(null);
  const [batchRenting, setBatchRenting] = useState(false);

  // Dữ liệu cổ phục gợi ý khi danh sách trống
  const [suggestedGarments, setSuggestedGarments] = useState<GarmentGrouped[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  useEffect(() => {
    // 1. Tải danh sách từ local storage
    const local = getWishlistItems();
    setItems(local);

    // 2. Tự động đồng bộ với backend nếu đã đăng nhập
    refreshWishlistFromServer()
      .then((serverItems) => {
        setItems(serverItems);
      })
      .finally(() => {
        setLoading(false);
      });

    const handleUpdate = () => {
      setItems(getWishlistItems());
    };

    window.addEventListener("wishlist:updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("wishlist:updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  // Tải danh sách gợi ý khi trống hoặc để tham khảo
  useEffect(() => {
    setLoadingSuggestions(true);
    getGarmentsGrouped()
      .then((res) => {
        if (res.success && res.data) {
          setSuggestedGarments(res.data.slice(0, 8));
        }
      })
      .finally(() => {
        setLoadingSuggestions(false);
      });
  }, []);

  // Danh mục có trong wishlist
  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.categoryName) cats.add(item.categoryName);
    });
    return Array.from(cats);
  }, [items]);

  // Bộ lọc danh mục, tìm kiếm & sắp xếp
  const filteredAndSortedItems = useMemo(() => {
    let result = items.filter((item) => {
      const matchCat = selectedCategory === "all" || item.categoryName === selectedCategory;
      const matchSearch =
        !searchQuery.trim() ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchCat && matchSearch;
    });

    result = [...result].sort((a, b) => {
      const priceA = a.dailyPrice ?? 0;
      const priceB = b.dailyPrice ?? 0;
      if (sortBy === "price-asc") return priceA - priceB;
      if (sortBy === "price-desc") return priceB - priceA;
      if (sortBy === "name") return a.name.localeCompare(b.name, "vi");
      // recent: dựa vào addedAt
      return new Date(b.addedAt ?? 0).getTime() - new Date(a.addedAt ?? 0).getTime();
    });

    return result;
  }, [items, selectedCategory, searchQuery, sortBy]);

  // Cổ phục gợi ý chưa được thêm vào wishlist
  const unaddedSuggestions = useMemo(() => {
    return suggestedGarments
      .filter((g) => !items.some((i) => i.garmentId === g.garmentId))
      .slice(0, 4);
  }, [suggestedGarments, items]);

  // Tổng tiền thuê & cọc ước tính
  const financialSummary = useMemo(() => {
    let totalDailyRent = 0;
    let totalDeposit = 0;

    items.forEach((item) => {
      const selectedSizeId = selectedSizes[item.garmentId];
      const activeSize =
        (item.sizes ?? []).find((s) => s.sizeId === selectedSizeId) || item.sizes?.[0];
      totalDailyRent += activeSize?.dailyPrice ?? item.dailyPrice ?? 0;
      totalDeposit += activeSize?.depositAmount ?? item.depositAmount ?? 0;
    });

    return { totalDailyRent, totalDeposit };
  }, [items, selectedSizes]);

  async function handleRemove(garmentId: string) {
    try {
      playWoodTap();
    } catch {
      // Audio fallback
    }
    await removeWishlistItem(garmentId);
  }

  function handleSelectSize(garmentId: string, sizeId: string) {
    try {
      playWoodTap();
    } catch {
      // Audio fallback
    }
    setSelectedSizes((prev) => ({ ...prev, [garmentId]: sizeId }));
  }

  function handleQuickRent(item: WishlistGarmentItem) {
    try {
      playWoodTap();
    } catch {
      // Audio fallback
    }

    const chosenSizeId = selectedSizes[item.garmentId];
    const sizeToRent =
      (item.sizes ?? []).find((s) => s.sizeId === chosenSizeId) || item.sizes?.[0];

    if (sizeToRent) {
      addToCart({
        garmentSizeId: sizeToRent.sizeId,
        garmentId: item.garmentId,
        name: item.name + (sizeToRent.sizeLabel ? ` (Size ${sizeToRent.sizeLabel})` : ""),
        sizeLabel: sizeToRent.sizeLabel,
        dailyPrice: sizeToRent.dailyPrice,
        depositAmount: sizeToRent.depositAmount,
        imageUrl: item.imageUrl,
      });

      setAddedToast(`Đã thêm "${item.name}" vào giỏ thuê đồ`);
      setTimeout(() => setAddedToast(null), 2500);

      setTimeout(() => {
        router.push("/booking/date-selection");
      }, 500);
    } else {
      router.push(`/catalog/${item.garmentId}`);
    }
  }

  function handleBatchRent() {
    if (filteredAndSortedItems.length === 0) return;
    try {
      playWoodTap();
    } catch {
      // Audio fallback
    }

    setBatchRenting(true);
    let count = 0;
    filteredAndSortedItems.forEach((item) => {
      const chosenSizeId = selectedSizes[item.garmentId];
      const sizeToRent =
        (item.sizes ?? []).find((s) => s.sizeId === chosenSizeId) || item.sizes?.[0];
      if (sizeToRent) {
        addToCart({
          garmentSizeId: sizeToRent.sizeId,
          garmentId: item.garmentId,
          name: item.name + (sizeToRent.sizeLabel ? ` (Size ${sizeToRent.sizeLabel})` : ""),
          sizeLabel: sizeToRent.sizeLabel,
          dailyPrice: sizeToRent.dailyPrice,
          depositAmount: sizeToRent.depositAmount,
          imageUrl: item.imageUrl,
        });
        count++;
      }
    });

    setAddedToast(`Đã thêm ${count} cổ phục vào giỏ thuê đồ!`);
    setTimeout(() => {
      setBatchRenting(false);
      router.push("/booking/date-selection");
    }, 600);
  }

  function handleShareLink() {
    try {
      playWoodTap();
    } catch {
      // Audio fallback
    }
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  }

  function handleTryOn(garmentId: string) {
    try {
      playWoodTap();
    } catch {
      // Audio fallback
    }
    router.push(`/try-on?garmentId=${garmentId}`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-mist text-ink antialiased">
      <CustomerNavbar cartHref="/booking/date-selection" />

      {/* Toast thông báo */}
      {addedToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-sand bg-oxblood px-5 py-2.5 text-xs font-semibold text-white shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-antique" />
            <span>{addedToast}</span>
          </div>
        </div>
      )}

      <main className="flex-1 pb-24 pt-6 sm:pt-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          
          {/* Breadcrumb Navigation */}
          <nav className="mb-6 flex items-center gap-2 text-xs text-stone-500 font-medium">
            <Link href="/" className="hover:text-lotus transition flex items-center gap-1">
              <span>Trang chủ</span>
            </Link>
            <ChevronRight className="h-3 w-3 text-stone-400" />
            <Link href="/catalog" className="hover:text-lotus transition">
              <span>Bộ sưu tập</span>
            </Link>
            <ChevronRight className="h-3 w-3 text-stone-400" />
            <span className="font-semibold text-oxblood">Cổ phục yêu thích</span>
          </nav>

          {/* =========================================================================
              1. REGAL HERITAGE BANNER (Chuẩn Nhận Diện Hoàng Gia Đại Việt)
             ========================================================================= */}
          <section className="relative overflow-hidden rounded-2xl border border-sand bg-gradient-to-b from-parchment to-mist p-6 sm:p-10 shadow-xs mb-8">
            <div className="animate-ambient-glow pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-red-200/20 blur-3xl" />
            <div
              className="animate-ambient-glow pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-amber-200/20 blur-3xl"
              style={{ animationDelay: "-4s" }}
            />

            <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="space-y-3">
                {/* Royal Heritage Badge */}
                <div className="inline-flex items-center gap-2 rounded-full border border-sand bg-white/90 px-3.5 py-1 text-xs font-semibold text-bronze shadow-xs">
                  <Award className="h-3.5 w-3.5 text-lotus" />
                  <span>Kho Lưu Trữ Di Sản • Lookbook Cá Nhân</span>
                </div>

                <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-oxblood">
                  Bộ Sưu Tập Cổ Phục Của Bạn
                </h1>

                <p className="text-xs sm:text-sm text-stone-600 max-w-2xl leading-relaxed">
                  Lưu giữ những tác phẩm cổ phục Đại Việt bạn trân quý. Ướm thử diện mạo qua gương AI, lựa chọn kích cỡ phù hợp và tiến hành đặt lịch thuê thuận tiện.
                </p>
              </div>

              {/* Financial KPI Summary Card (Chỉ hiện khi có item) */}
              {items.length > 0 && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                  <div className="flex items-center gap-4 rounded-xl border border-sand bg-white px-5 py-3.5 shadow-xs">
                    <div className="border-r border-sand/80 pr-4 text-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Đã Lưu</span>
                      <span className="font-display text-2xl sm:text-3xl font-bold text-lotus leading-none">
                        {items.length}
                        <span className="text-xs font-sans font-normal text-stone-500 ml-1">mẫu</span>
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
                        Dự toán thuê 1 ngày
                      </span>
                      <p className="font-display text-lg sm:text-xl font-bold text-oxblood leading-none">
                        {formatVND(financialSummary.totalDailyRent)}
                      </p>
                      <span className="text-[10px] font-medium text-stone-500 block">
                        Cọc bảo chứng: <strong className="text-emerald-700">{formatVND(financialSummary.totalDeposit)}</strong> (hoàn 100%)
                      </span>
                    </div>
                  </div>

                  {/* Actions Header Bar */}
                  <div className="flex sm:flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleShareLink}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-xs hover:border-lotus hover:text-lotus transition active:scale-95"
                      title="Chia sẻ danh sách"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-bold">Đã chép link</span>
                        </>
                      ) : (
                        <>
                          <Share2 className="h-3.5 w-3.5 text-lotus" />
                          <span>Chia sẻ</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleBatchRent}
                      disabled={batchRenting}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg bg-lotus px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-xs hover:bg-oxblood transition active:scale-95 disabled:opacity-70"
                    >
                      <ShoppingBag className="h-3.5 w-3.5" />
                      <span>{batchRenting ? "Đang chọn..." : "Thuê tất cả"}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* =========================================================================
                2. TOOLBAR (Bộ lọc danh mục, tìm kiếm, sắp xếp & chế độ xem)
               ========================================================================= */}
            {items.length > 0 && (
              <div className="mt-8 pt-6 border-t border-sand flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                {/* Category Pills Filter */}
                <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      selectedCategory === "all"
                        ? "bg-lotus text-white shadow-xs"
                        : "bg-white border border-sand text-stone-700 hover:border-lotus hover:text-lotus"
                    }`}
                  >
                    Tất cả ({items.length})
                  </button>

                  {categories.map((cat) => {
                    const count = items.filter((i) => i.categoryName === cat).length;
                    const isSel = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          isSel
                            ? "bg-lotus text-white shadow-xs"
                            : "bg-white border border-sand text-stone-700 hover:border-lotus hover:text-lotus"
                        }`}
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Search, Sort & View Switcher */}
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  {/* Search box */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                    <input
                      type="text"
                      placeholder="Tìm theo tên áo..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 w-40 sm:w-52 rounded-lg border border-sand bg-white pl-8 pr-3 text-xs text-ink placeholder:text-stone-400 focus:border-lotus focus:outline-none focus:ring-1 focus:ring-lotus/20 shadow-xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-ink"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Sort dropdown */}
                  <div className="relative flex items-center">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="h-9 rounded-lg border border-sand bg-white pl-2.5 pr-7 text-xs font-semibold text-stone-700 focus:border-lotus focus:outline-none shadow-xs cursor-pointer appearance-none"
                    >
                      <option value="recent">Mới lưu gần đây</option>
                      <option value="price-asc">Giá thuê: Thấp → Cao</option>
                      <option value="price-desc">Giá thuê: Cao → Thấp</option>
                      <option value="name">Tên cổ phục: A → Z</option>
                    </select>
                    <ArrowUpDown className="pointer-events-none absolute right-2 h-3 w-3 text-stone-400" />
                  </div>

                  {/* Switch Grid vs Compare */}
                  <div className="flex items-center rounded-lg border border-sand bg-white p-0.5 shadow-xs">
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                        viewMode === "grid"
                          ? "bg-stone-900 text-white shadow-xs"
                          : "text-stone-600 hover:text-ink"
                      }`}
                      title="Chế độ Lưới Lookbook"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Lưới</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("compare")}
                      className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                        viewMode === "compare"
                          ? "bg-stone-900 text-white shadow-xs"
                          : "text-stone-600 hover:text-ink"
                      }`}
                      title="Chế độ So sánh chi tiết"
                    >
                      <Columns className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">So sánh</span>
                    </button>
                  </div>

                </div>

              </div>
            )}
          </section>

          {/* =========================================================================
              3. CONTENT AREA: FASHION GRID OR COMPARE MATRIX OR EMPTY STATE
             ========================================================================= */}
          {loading ? (
            /* Skeleton Loading */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse rounded-2xl border border-sand bg-white p-4 space-y-4 shadow-xs">
                  <div className="aspect-[3/4] w-full rounded-xl bg-stone-100" />
                  <div className="h-5 w-3/4 rounded-md bg-stone-100" />
                  <div className="h-4 w-1/2 rounded-md bg-stone-100" />
                  <div className="h-9 w-full rounded-lg bg-stone-100" />
                </div>
              ))}
            </div>
          ) : filteredAndSortedItems.length > 0 ? (
            <div className="space-y-16">
              {viewMode === "grid" ? (
              /* ── CHẾ ĐỘ 1: LOOKBOOK GRID (Sang Trọng, Đồng Bộ Với Catalog) ─────── */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredAndSortedItems.map((item) => {
                  const chosenSizeId = selectedSizes[item.garmentId];
                  const currentSize =
                    (item.sizes ?? []).find((s) => s.sizeId === chosenSizeId) || item.sizes?.[0];
                  const displayDailyPrice = currentSize?.dailyPrice ?? item.dailyPrice ?? 0;
                  const displayDeposit = currentSize?.depositAmount ?? item.depositAmount ?? 0;

                  return (
                    <article
                      key={item.garmentId}
                      className="group flex flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-lg"
                    >
                      {/* Thumbnail Container (Tỉ lệ 3:4 Hoàng Gia) */}
                      <div className="relative aspect-[3/4] w-full overflow-hidden bg-stone-100">
                        <Link href={`/catalog/${item.garmentId}`} className="absolute inset-0 block">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              referrerPolicy="no-referrer"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center bg-stone-100 text-stone-400">
                              <Shirt className="h-10 w-10 text-stone-300" />
                              <span className="text-xs text-stone-400 mt-2 font-medium">Cổ phục Atelier</span>
                            </div>
                          )}
                        </Link>

                        {/* Category Tag */}
                        <span className="shadow-xs absolute left-3 top-3 pointer-events-none z-10 rounded bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800 backdrop-blur-xs">
                          {item.categoryName ?? "Cổ phục Đại Việt"}
                        </span>

                        {/* Top Right Floating Actions */}
                        <div className="absolute right-3 top-3 flex items-center gap-1.5 z-10">
                          {/* Phóng to ảnh */}
                          {item.imageUrl && (
                            <button
                              type="button"
                              onClick={() => setLightboxImage({ url: item.imageUrl!, title: item.name })}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow-xs backdrop-blur-xs transition hover:bg-white hover:text-lotus active:scale-95"
                              title="Xem ảnh lớn"
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* Bỏ khỏi yêu thích */}
                          <button
                            type="button"
                            onClick={() => handleRemove(item.garmentId)}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-lotus shadow-xs backdrop-blur-xs transition hover:bg-white hover:text-red-600 active:scale-95"
                            title="Xóa khỏi yêu thích"
                            aria-label="Xóa khỏi yêu thích"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Card Information */}
                      <div className="flex flex-1 flex-col p-4">
                        <Link href={`/catalog/${item.garmentId}`} className="hover:underline">
                          <h3 className="font-display text-xl font-bold text-oxblood line-clamp-1">
                            {item.name}
                          </h3>
                        </Link>

                        {/* Size pills */}
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {(item.sizes ?? []).length > 0 ? (
                            item.sizes.map((s) => {
                              const isSel = (currentSize?.sizeId === s.sizeId);
                              return (
                                <button
                                  key={s.sizeId}
                                  type="button"
                                  onClick={() => handleSelectSize(item.garmentId, s.sizeId)}
                                  className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase transition ${
                                    isSel
                                      ? "bg-lotus text-white"
                                      : "bg-parchment text-stone-600 hover:bg-lotus/15"
                                  }`}
                                >
                                  {s.sizeLabel ?? "—"}
                                </button>
                              );
                            })
                          ) : (
                            <span className="text-xs text-stone-400 italic">Dáng tự do / May đo</span>
                          )}
                        </div>

                        {/* Giá thuê & Cọc */}
                        <div className="mt-auto border-t border-sand pt-3 space-y-1">
                          <div className="flex items-baseline justify-between text-xs">
                            <span className="text-stone-500 font-medium">Giá thuê</span>
                            <span className="text-sm font-bold text-lotus">
                              {formatVND(displayDailyPrice)}
                              <span className="text-xs font-normal text-stone-500">/ngày</span>
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-stone-500">Cọc</span>
                            <span className="font-semibold text-emerald-700">
                              {formatVND(displayDeposit)} (hoàn 100%)
                            </span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleTryOn(item.garmentId)}
                            className="inline-flex min-h-[34px] items-center justify-center gap-1 rounded-lg border border-sand bg-mist px-2 text-[11px] font-bold text-ink transition hover:border-lotus hover:text-lotus"
                          >
                            <Camera className="h-3 w-3 text-lotus" />
                            <span>Ướm AI</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleQuickRent(item)}
                            className="inline-flex min-h-[34px] items-center justify-center gap-1 rounded-lg bg-lotus px-2 text-[11px] font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood active:scale-[0.98]"
                          >
                            <ShoppingBag className="h-3 w-3" />
                            <span>Thuê</span>
                          </button>
                        </div>

                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              /* ── CHẾ ĐỘ 2: BẢNG SO SÁNH TRỰC QUAN (COMPARE MATRIX) ────────────────── */
              <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-xs p-6">
                <div className="min-w-[800px]">
                  <div className="border-b border-sand pb-4 mb-6">
                    <h2 className="font-display text-xl font-bold text-oxblood">
                      Bảng So Sánh Chi Tiết Cổ Phục Trong Danh Sách
                    </h2>
                    <p className="text-xs text-stone-500">
                      So sánh kiểu dáng, phân loại, kích thước và biểu phí để chọn ra trang phục phù hợp nhất
                    </p>
                  </div>

                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-sand text-stone-400 uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4 w-1/4">Hình Ảnh & Cổ Phục</th>
                        <th className="py-3 px-4 w-1/6">Triều Đại / Phân Loại</th>
                        <th className="py-3 px-4 w-1/5">Kích Cỡ Sẵn Có</th>
                        <th className="py-3 px-4 w-1/6">Biểu Phí Thuê / Cọc</th>
                        <th className="py-3 px-4 w-1/5 text-right">Thao Tác Nhanh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand/60">
                      {filteredAndSortedItems.map((item) => (
                        <tr key={item.garmentId} className="hover:bg-mist transition">
                          {/* Item with Thumbnail */}
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className="h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-sand bg-stone-100">
                                {item.imageUrl ? (
                                  <img
                                    src={item.imageUrl}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-stone-400">
                                    <Shirt className="h-6 w-6" />
                                  </div>
                                )}
                              </div>
                              <div>
                                <Link
                                  href={`/catalog/${item.garmentId}`}
                                  className="font-display font-bold text-base text-oxblood hover:text-lotus transition line-clamp-1"
                                >
                                  {item.name}
                                </Link>
                                <span className="text-[10px] text-stone-400">Mã: #{item.garmentId.slice(0, 8)}</span>
                              </div>
                            </div>
                          </td>

                          {/* Category */}
                          <td className="py-4 px-4">
                            <span className="inline-block rounded border border-sand bg-parchment px-2.5 py-0.5 text-xs font-semibold text-stone-700">
                              {item.categoryName ?? "Cung Đình"}
                            </span>
                          </td>

                          {/* Sizes */}
                          <td className="py-4 px-4">
                            <div className="flex flex-wrap gap-1">
                              {(item.sizes ?? []).map((s) => (
                                <span
                                  key={s.sizeId}
                                  className="rounded border border-sand bg-white px-2 py-0.5 text-[11px] font-semibold text-stone-700"
                                >
                                  {s.sizeLabel}
                                </span>
                              ))}
                            </div>
                          </td>

                          {/* Price */}
                          <td className="py-4 px-4">
                            <div>
                              <span className="font-display text-base font-bold text-lotus block">
                                {formatVND(item.dailyPrice)}/ngày
                              </span>
                              <span className="text-[10px] text-emerald-700 block">
                                Cọc: {formatVND(item.depositAmount)}
                              </span>
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-4 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleQuickRent(item)}
                                className="rounded-lg bg-lotus px-3 py-1.5 text-xs font-semibold uppercase text-white shadow-xs hover:bg-oxblood transition active:scale-95"
                              >
                                Thuê
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTryOn(item.garmentId)}
                                className="rounded-lg border border-sand bg-mist px-2 py-1.5 text-xs font-semibold text-ink hover:border-lotus transition"
                                title="Ướm AI"
                              >
                                <Camera className="h-3.5 w-3.5 text-lotus" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemove(item.garmentId)}
                                className="rounded-lg border border-sand bg-white p-1.5 text-stone-400 hover:text-red-500 hover:border-red-200 transition"
                                title="Bỏ yêu thích"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Gợi ý thêm cổ phục cùng phong cách */}
            {unaddedSuggestions.length > 0 && (
              <section className="pt-10 border-t border-sand space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-bronze">
                      <Sparkles className="h-3.5 w-3.5 text-lotus" />
                      <span>Khám phá thêm</span>
                    </div>
                    <h3 className="font-display text-2xl font-bold text-oxblood mt-1">
                      Cổ Phục Cùng Phong Cách Có Thể Bạn Thích
                    </h3>
                  </div>
                  <Link
                    href="/catalog"
                    className="text-xs font-semibold text-lotus hover:text-oxblood flex items-center gap-1 transition"
                  >
                    <span>Xem toàn bộ</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {unaddedSuggestions.map((group) => {
                    const firstSize = group.sizes[0];
                    return (
                      <article
                        key={group.garmentId}
                        className="group flex flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-lg"
                      >
                        <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
                          <Link href={`/catalog/${group.garmentId}`} className="absolute inset-0">
                            {group.imageUrl ? (
                              <img
                                src={group.imageUrl}
                                alt={group.name}
                                className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-stone-300">
                                <Shirt className="h-10 w-10" />
                              </div>
                            )}
                          </Link>

                          <span className="shadow-xs absolute left-3 top-3 pointer-events-none z-10 rounded bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800 backdrop-blur-xs">
                            {group.categoryName ?? "Cổ phục Đại Việt"}
                          </span>

                          <div className="absolute right-3 top-3 z-10">
                            <WishlistButton
                              item={{
                                garmentId: group.garmentId,
                                name: group.name,
                                categoryName: group.categoryName,
                                imageUrl: group.imageUrl,
                                dailyPrice: firstSize?.dailyPrice ?? 0,
                                depositAmount: firstSize?.depositAmount ?? 0,
                                sizes: group.sizes.map((s) => ({
                                  sizeId: s.garmentSizeId,
                                  sizeLabel: s.sizeLabel,
                                  dailyPrice: s.dailyPrice,
                                  depositAmount: s.depositAmount,
                                })),
                                addedAt: new Date().toISOString(),
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex flex-1 flex-col p-4">
                          <Link href={`/catalog/${group.garmentId}`} className="hover:underline">
                            <h4 className="font-display text-lg font-bold text-oxblood line-clamp-1">
                              {group.name}
                            </h4>
                          </Link>

                          <div className="mt-auto border-t border-sand pt-3 flex items-baseline justify-between text-xs">
                            <span className="text-stone-500 font-medium">Giá thuê</span>
                            <span className="text-sm font-bold text-lotus">
                              {formatVND(firstSize?.dailyPrice ?? 0)}
                              <span className="text-xs font-normal text-stone-500">/ngày</span>
                            </span>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <Link
                              href={`/try-on?garmentId=${group.garmentId}`}
                              className="inline-flex min-h-[32px] items-center justify-center gap-1 rounded-lg border border-sand bg-mist px-2 text-[11px] font-bold text-ink transition hover:border-lotus hover:text-lotus"
                            >
                              <Camera className="h-3 w-3 text-lotus" />
                              <span>Ướm AI</span>
                            </Link>
                            <Link
                              href={`/catalog/${group.garmentId}`}
                              className="inline-flex min-h-[32px] items-center justify-center gap-1 rounded-lg bg-lotus px-2 text-[11px] font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood"
                            >
                              <span>Chi tiết</span>
                            </Link>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        ) : (
            /* =========================================================================
                4. REFINED EMPTY STATE (Thanh Nhã, Kèm Cổ Phục Gợi Ý Ngay Tại Chỗ)
               ========================================================================= */
            <div className="space-y-12">
              <div className="rounded-2xl border border-sand bg-white py-14 px-6 text-center shadow-xs">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-sand bg-parchment text-lotus mb-4 shadow-xs">
                  <Heart className="h-9 w-9 stroke-[1.5]" />
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-oxblood">
                  Tủ Đồ Cổ Phục Chưa Có Sản Phẩm
                </h2>
                <p className="mx-auto mt-2 max-w-md text-xs sm:text-sm text-stone-600 leading-relaxed">
                  Quý khách chưa lưu giữ tác phẩm nào vào danh sách yêu thích. Hãy dạo bước qua kho tàng Cung đình Đại Việt để chiêm ngưỡng và chọn cho mình những xiêm y ưng ý.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/catalog"
                    className="inline-flex items-center gap-2 rounded-lg bg-lotus px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-xs hover:bg-oxblood transition active:scale-95"
                  >
                    <span>Khám Phá Bộ Sưu Tập</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link
                    href="/try-on"
                    className="inline-flex items-center gap-2 rounded-lg border border-sand bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink hover:border-lotus hover:text-lotus transition active:scale-95 shadow-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-lotus" />
                    <span>Thử Diện Mạo Với AI</span>
                  </Link>
                </div>
              </div>

              {/* KHU VỰC GỢI Ý CỔ PHỤC THỊNH HÀNH (Trending Suggestions) */}
              {suggestedGarments.length > 0 && (
                <section className="space-y-6">
                  <div className="flex items-center justify-between border-b border-sand pb-3">
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-bronze">
                        <Sparkles className="h-3.5 w-3.5 text-lotus" />
                        <span>Gợi Ý Dành Riêng Cho Bạn</span>
                      </div>
                      <h3 className="font-display text-2xl font-bold text-oxblood mt-1">
                        Cổ Phục Được Yêu Thích Nhất
                      </h3>
                    </div>
                    <Link
                      href="/catalog"
                      className="text-xs font-semibold text-lotus hover:text-oxblood flex items-center gap-1 transition"
                    >
                      <span>Xem toàn bộ</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {suggestedGarments.map((group) => {
                      const firstSize = group.sizes[0];
                      return (
                        <article
                          key={group.garmentId}
                          className="group flex flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-lg"
                        >
                          <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
                            <Link href={`/catalog/${group.garmentId}`} className="absolute inset-0">
                              {group.imageUrl ? (
                                <img
                                  src={group.imageUrl}
                                  alt={group.name}
                                  className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-stone-300">
                                  <Shirt className="h-10 w-10" />
                                </div>
                              )}
                            </Link>

                            <span className="shadow-xs absolute left-3 top-3 pointer-events-none z-10 rounded bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800 backdrop-blur-xs">
                              {group.categoryName ?? "Cổ phục Đại Việt"}
                            </span>

                            <div className="absolute right-3 top-3 z-10">
                              <WishlistButton
                                item={{
                                  garmentId: group.garmentId,
                                  name: group.name,
                                  categoryName: group.categoryName,
                                  imageUrl: group.imageUrl,
                                  dailyPrice: firstSize?.dailyPrice ?? 0,
                                  depositAmount: firstSize?.depositAmount ?? 0,
                                  sizes: group.sizes.map((s) => ({
                                    sizeId: s.garmentSizeId,
                                    sizeLabel: s.sizeLabel,
                                    dailyPrice: s.dailyPrice,
                                    depositAmount: s.depositAmount,
                                  })),
                                  addedAt: new Date().toISOString(),
                                }}
                              />
                            </div>
                          </div>

                          <div className="flex flex-1 flex-col p-4">
                            <Link href={`/catalog/${group.garmentId}`} className="hover:underline">
                              <h4 className="font-display text-lg font-bold text-oxblood line-clamp-1">
                                {group.name}
                              </h4>
                            </Link>

                            <div className="mt-auto border-t border-sand pt-3 flex items-baseline justify-between text-xs">
                              <span className="text-stone-500 font-medium">Giá thuê</span>
                              <span className="text-sm font-bold text-lotus">
                                {formatVND(firstSize?.dailyPrice ?? 0)}
                                <span className="text-xs font-normal text-stone-500">/ngày</span>
                              </span>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <Link
                                href={`/try-on?garmentId=${group.garmentId}`}
                                className="inline-flex min-h-[32px] items-center justify-center gap-1 rounded-lg border border-sand bg-mist px-2 text-[11px] font-bold text-ink transition hover:border-lotus hover:text-lotus"
                              >
                                <Camera className="h-3 w-3 text-lotus" />
                                <span>Ướm AI</span>
                              </Link>
                              <Link
                                href={`/catalog/${group.garmentId}`}
                                className="inline-flex min-h-[32px] items-center justify-center gap-1 rounded-lg bg-lotus px-2 text-[11px] font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood"
                              >
                                <span>Chi tiết</span>
                              </Link>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

        </div>
      </main>

      {/* =========================================================================
          5. STICKY FLOATING BOTTOM DOCK (Thanh Tổng Kết Tiện Ích Đáy Màn Hình)
         ========================================================================= */}
      {items.length > 0 && (
        <div className="fixed bottom-6 inset-x-0 z-30 pointer-events-none px-4">
          <div className="mx-auto max-w-xl rounded-2xl border border-sand bg-white/95 backdrop-blur-md p-3 shadow-lg pointer-events-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 pl-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
                <Heart className="h-4 w-4 fill-lotus text-lotus" />
              </div>
              <div>
                <p className="text-xs font-bold text-oxblood">
                  {items.length} cổ phục trong danh sách
                </p>
                <p className="text-[11px] text-stone-500">
                  Dự toán: <strong className="text-lotus">{formatVND(financialSummary.totalDailyRent)}</strong>/ngày
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBatchRent}
                disabled={batchRenting}
                className="flex items-center gap-1.5 rounded-lg bg-lotus px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-xs hover:bg-oxblood transition active:scale-95 disabled:opacity-70"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                <span>{batchRenting ? "Đang chọn..." : "Thuê tất cả"}</span>
              </button>

              <Link
                href="/catalog"
                className="hidden sm:flex items-center gap-1 rounded-lg border border-sand bg-mist px-3 py-2 text-xs font-semibold text-stone-700 hover:border-lotus hover:text-lotus transition"
              >
                <span>Xem thêm</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. LIGHTBOX MODAL (Xem Ảnh Lớn Chi Tiết)
         ========================================================================= */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative aspect-[3/4] w-full max-h-[80vh] overflow-hidden bg-stone-900">
              <img
                src={lightboxImage.url}
                alt={lightboxImage.title}
                className="h-full w-full object-contain"
                referrerPolicy="no-referrer"
              />
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 bg-white border-t border-sand flex items-center justify-between">
              <h4 className="font-display text-lg font-bold text-oxblood">{lightboxImage.title}</h4>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="text-xs font-semibold text-stone-500 hover:text-lotus transition"
              >
                Đóng lại
              </button>
            </div>
          </div>
        </div>
      )}

      <CustomerFooter />
    </div>
  );
}
