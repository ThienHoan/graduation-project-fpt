"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import {
  getGarmentCategories,
  getGarmentsGrouped,
  trackGarmentView,
  type GarmentCategory,
  type GarmentGrouped,
} from "@/lib/api";
import { addToCart, cartCount, removeFromCart, getCart } from "@/lib/cart";
import { getProductAdvisor, type AIAdvisorTopic, type AIAdvisorProduct } from "@/lib/chat";
import {
  Search,
  Sparkles,
  ShoppingBag,
  SlidersHorizontal,
  X,
  ArrowRight,
  CheckCircle2,
  Trash2,
  Camera,
  Award,
} from "lucide-react";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
}

function CatalogGarmentCard({
  group,
  selectedGarmentId,
  selectedSize,
  onSelectSize,
  onAddToCart,
}: {
  group: GarmentGrouped;
  selectedGarmentId: string;
  selectedSize: any;
  onSelectSize: (sizeId: string) => void;
  onAddToCart: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Lazy view tracking: chỉ đếm khi thẻ sản phẩm lọt vào tầm mắt ít nhất 1.2s
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !group.garmentId) return;

    let timer: NodeJS.Timeout | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          timer = setTimeout(() => {
            void trackGarmentView(group.garmentId);
            observer.disconnect();
          }, 1200);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [group.garmentId]);

  return (
    <article
      ref={cardRef}
      className="group flex flex-col overflow-hidden rounded-xl border border-sand bg-white shadow-xs transition-all duration-300 hover:border-lotus hover:shadow-lg"
    >
      {/* Ảnh cổ phục với Lazy Load & Smooth Fade-in */}
      <Link
        href={`/catalog/${selectedGarmentId}`}
        className="relative aspect-[3/4] overflow-hidden bg-stone-100"
      >
        {group.imageUrl ? (
          <img
            src={group.imageUrl}
            alt={group.name}
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-105 ${
              imgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-stone-400">
            Cổ phục di sản
          </div>
        )}
        <span className="shadow-xs absolute left-3 top-3 rounded bg-white/95 px-2.5 py-1 text-xs font-bold text-stone-800 backdrop-blur-xs">
          {group.categoryName ?? "Triều Nguyễn"}
        </span>
      </Link>

      {/* Thông tin card */}
      <div className="flex flex-1 flex-col p-4">
        <Link href={`/catalog/${selectedGarmentId}`} className="hover:underline">
          <h3 className="font-display text-xl font-bold text-oxblood line-clamp-1">
            {group.name}
          </h3>
        </Link>

        {/* Size pills */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {group.sizes.map((s) => {
            const isSel = selectedGarmentId === s.garmentSizeId;
            return (
              <button
                key={s.garmentSizeId}
                type="button"
                onClick={() => onSelectSize(s.garmentSizeId)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase transition ${
                  isSel
                    ? "bg-lotus text-white"
                    : "bg-parchment text-stone-600 hover:bg-lotus/15"
                }`}
              >
                {s.sizeLabel ?? "—"}
              </button>
            );
          })}
        </div>

        {/* Giá thuê & Cọc */}
        <div className="mt-auto border-t border-sand pt-3 space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-stone-500 font-medium">Giá thuê</span>
            <span className="text-sm font-bold text-lotus">
              {selectedSize ? formatVND(selectedSize.dailyPrice) : "—"}
              <span className="text-xs font-normal text-stone-500">/ngày</span>
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-stone-500">Cọc</span>
            <span className="font-semibold text-ink">
              {selectedSize ? formatVND(selectedSize.depositAmount) : "—"}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href={`/try-on?garmentSizeId=${selectedGarmentId}`}
            className="inline-flex min-h-[34px] items-center justify-center gap-1 rounded-lg border border-sand bg-mist px-2 text-[11px] font-bold text-ink transition hover:border-lotus hover:text-lotus"
          >
            <Camera className="h-3 w-3 text-lotus" />
            <span>Ướm AI</span>
          </Link>

          <button
            type="button"
            onClick={onAddToCart}
            className="inline-flex min-h-[34px] items-center justify-center gap-1 rounded-lg bg-lotus px-2 text-[11px] font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood active:scale-[0.98]"
          >
            <ShoppingBag className="h-3 w-3" />
            <span>Thuê</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export default function CatalogPage() {
  const [groups, setGroups] = useState<GarmentGrouped[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [categories, setCategories] = useState<string[]>(["all"]);
  const [cartCountVal, setCartCountVal] = useState(0);
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>({});
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [aiQuery, setAiQuery] = useState("");
  const [aiTopics, setAiTopics] = useState<AIAdvisorTopic[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const fetchParamsRef = useRef({ search: "", category: "all" });

  function fetchGroups(search?: string, category?: string) {
    fetchParamsRef.current = { search: search ?? "", category: category ?? "all" };
    setLoading(true);
    getGarmentsGrouped(
      search || undefined,
      category && category !== "all" ? category : undefined,
    )
      .then((res) => {
        if (res.success && res.data) setGroups(res.data);
      })
      .finally(() => setLoading(false));
  }

  // Initial fetch: groups + categories
  useEffect(() => {
    fetchGroups();
    getGarmentCategories().then((res) => {
      if (res.success && res.data) {
        setCategories(["all", ...res.data.map((c: GarmentCategory) => c.name)]);
      }
    });
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        const { search, category } = fetchParamsRef.current;
        fetchGroups(search || undefined, category);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchDebounced(searchQuery), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  // Re-fetch when search or category changes
  useEffect(() => {
    fetchGroups(searchDebounced || undefined, activeCategory);
  }, [searchDebounced, activeCategory]);

  // Sync cart count
  useEffect(() => {
    setCartCountVal(cartCount());
    const interval = setInterval(() => setCartCountVal(cartCount()), 500);
    return () => clearInterval(interval);
  }, []);

  function handleSelectSize(groupSlug: string, garmentId: string) {
    setSelectedSizes((prev) => ({ ...prev, [groupSlug]: garmentId }));
  }

  function handleAddToCart(group: GarmentGrouped) {
    const selectedGarmentId = selectedSizes[group.slug];
    const s =
      group.sizes.find((sz) => sz.garmentSizeId === selectedGarmentId) ?? group.sizes[0];
    if (!s) return;

    addToCart({
      garmentSizeId: s.garmentSizeId,
      garmentId: group.garmentId,
      name: group.name + (s.sizeLabel ? ` (Size ${s.sizeLabel})` : ""),
      sizeLabel: s.sizeLabel,
      dailyPrice: s.dailyPrice,
      depositAmount: s.depositAmount,
      imageUrl: group.imageUrl,
    });
    setCartCountVal(cartCount());
    setAddedMsg(`Đã thêm "${group.name}" vào giỏ`);
    setTimeout(() => setAddedMsg(null), 2500);
  }

  function handleRemoveFromCart(garmentSizeId: string) {
    removeFromCart(garmentSizeId);
    setCartCountVal(cartCount());
  }

  async function handleAiConsult() {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await getProductAdvisor({ message: aiQuery.trim() });
      if (res.success && res.data) {
        setAiTopics(res.data.topics);
      } else {
        setAiError(res.error ?? "Không thể nhận tư vấn từ AI vào lúc này.");
      }
    } catch {
      setAiError("Có lỗi xảy ra khi kết nối trợ lý AI.");
    } finally {
      setAiLoading(false);
    }
  }

  function findAiProductSizeId(product: AIAdvisorProduct): string | null {
    for (const g of groups) {
      if (g.garmentId === product.garmentId) {
        if (product.size) {
          const s = g.sizes.find((sz) => sz.sizeLabel?.toLowerCase() === product.size?.toLowerCase());
          if (s) return s.garmentSizeId;
        }
        return g.sizes[0]?.garmentSizeId ?? null;
      }
    }
    return null;
  }

  function handleAiAddToCart(product: AIAdvisorProduct) {
    const sizeId = findAiProductSizeId(product);
    if (!sizeId) return;
    addToCart({
      garmentSizeId: sizeId,
      garmentId: product.garmentId,
      name: product.name + (product.size ? ` (Size ${product.size})` : ""),
      sizeLabel: product.size,
      dailyPrice: product.dailyPrice,
      depositAmount: product.depositAmount,
      imageUrl: product.imageUrl,
    });
    setCartCountVal(cartCount());
    setAddedMsg(`Đã thêm "${product.name}" vào giỏ`);
    setTimeout(() => setAddedMsg(null), 2500);
  }

  const featured = groups[0];
  const cartItems = getCart();

  return (
    <div className="min-h-screen bg-mist text-ink antialiased">
      <CustomerNavbar active="collection" cartHref="/booking/date-selection" />

      {/* Floating Cart Button & Quick Dropdown */}
      <div className="fixed right-4 top-20 z-30 sm:right-8">
        <button
          type="button"
          onClick={() => setShowCart(!showCart)}
          className="relative flex h-12 w-12 items-center justify-center rounded-full border border-sand bg-white text-lotus shadow-lg transition hover:border-lotus active:scale-[0.98]"
          aria-label="Xem giỏ thuê đồ"
        >
          <ShoppingBag className="h-5 w-5" />
          {cartCountVal > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-lotus text-[11px] font-bold text-white shadow-xs">
              {cartCountVal}
            </span>
          )}
        </button>

        {showCart && (
          <div className="absolute right-0 top-14 w-84 rounded-2xl border border-sand bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <h3 className="font-display text-lg font-bold text-oxblood">
                Giỏ thuê đồ ({cartCountVal})
              </h3>
              <button
                type="button"
                onClick={() => setShowCart(false)}
                className="rounded-full p-1 text-stone-400 hover:text-stone-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {cartItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-stone-500">Giỏ hàng hiện đang trống</p>
            ) : (
              <div className="max-h-64 space-y-3 overflow-y-auto py-3">
                {cartItems.map((item) => (
                  <div
                    key={item.garmentSizeId}
                    className="flex items-center justify-between gap-3 border-b border-sand/50 pb-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{item.name}</p>
                      <p className="text-[11px] font-bold text-lotus">
                        {formatVND(item.dailyPrice)}/ngày
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFromCart(item.garmentSizeId)}
                      className="rounded p-1 text-stone-400 transition hover:text-red-600"
                      title="Xóa khỏi giỏ"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {cartItems.length > 0 && (
              <Link
                href="/booking/date-selection"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-lotus py-2.5 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood"
                onClick={() => setShowCart(false)}
              >
                <span>Tiến hành đặt thuê</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Toast message */}
      {addedMsg && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-emerald-300 bg-emerald-800 px-6 py-3 text-xs font-semibold text-white shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            <span>{addedMsg}</span>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 lg:px-8">
        {/* Banner tiêu đề trang */}
        <section className="relative overflow-hidden rounded-2xl border border-sand bg-gradient-to-b from-parchment to-mist p-8 sm:p-12 text-center shadow-xs">
          <div className="animate-ambient-glow pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-red-200/30 blur-3xl" />
          <div
            className="animate-ambient-glow pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-amber-200/25 blur-3xl"
            style={{ animationDelay: "-4s" }}
          />

          <div className="relative mx-auto max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-sand bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-bronze shadow-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping-subtle absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              <Award className="h-4 w-4 text-lotus" />
              <span>Kho Lưu Trữ Di Sản Hoàng Cung &amp; Cổ Phục</span>
            </div>

            <h1 className="text-balance mt-4 font-display text-4xl font-bold tracking-tight text-oxblood sm:text-5xl lg:text-6xl">
              Bộ Sưu Tập Cổ Phục Tuyển Chọn
            </h1>

            <p className="mt-4 text-sm leading-relaxed text-stone-600 sm:text-base">
              Hơn 500 mẫu Nhật Bình, Áo Tấc, Ngũ Thân và Áo Dài phục dựng chuẩn mực quy cách hoàng
              tộc. Tự do ướm thử với công nghệ AI trước khi quyết định đặt thuê.
            </p>
          </div>
        </section>

        {/* Thanh tìm kiếm & Trợ lý tư vấn AI */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Ô Tìm Kiếm Nhanh */}
          <div className="lg:col-span-5">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm theo tên áo, triều đại, hoa văn, màu sắc..."
                className="w-full rounded-xl border border-sand bg-white py-3 pl-11 pr-10 text-xs font-medium text-ink shadow-xs outline-none transition focus:border-lotus focus:ring-1 focus:ring-lotus/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* AI Style Advisor Input */}
          <div className="lg:col-span-7">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Sparkles className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-lotus" />
                <input
                  type="text"
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAiConsult();
                  }}
                  placeholder="Hỏi AI tư vấn: VD: Tôi cần áo Nhật Bình màu đỏ chụp ảnh kỷ yếu..."
                  className="w-full rounded-xl border border-sand bg-white py-3 pl-11 pr-4 text-xs font-medium text-ink shadow-xs outline-none transition focus:border-lotus focus:ring-1 focus:ring-lotus/20"
                />
              </div>
              <button
                type="button"
                onClick={handleAiConsult}
                disabled={aiLoading || !aiQuery.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-lotus px-5 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiLoading ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span>Tư Vấn AI</span>
              </button>
            </div>
          </div>
        </div>

        {/* Khung kết quả tư vấn AI nếu có */}
        {(aiTopics.length > 0 || aiError) && (
          <section className="mt-6 rounded-2xl border border-sand bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-sand pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-lotus">
                <Sparkles className="h-4 w-4 text-lotus" />
                <span>Gợi ý phong cách từ Trợ lý AI xưởng may</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAiTopics([]);
                  setAiQuery("");
                  setAiError(null);
                }}
                className="rounded-full p-1 text-stone-400 hover:text-stone-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {aiError && <p className="mt-3 text-xs text-red-600">{aiError}</p>}

            {aiTopics.map((topic, ti) => (
              <div key={ti} className="mt-4">
                <h3 className="font-display text-lg font-bold text-oxblood">{topic.title}</h3>
                <p className="mt-1 text-xs italic text-stone-600">{topic.assistantReply}</p>

                {topic.products.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {topic.products.map((p) => {
                      const sizeId = findAiProductSizeId(p);
                      return (
                        <div
                          key={p.garmentId}
                          className="flex flex-col overflow-hidden rounded-xl border border-sand bg-mist p-3 text-xs"
                        >
                          <div className="aspect-[3/4] overflow-hidden rounded-lg bg-stone-100">
                            {p.imageUrl ? (
                              <img
                                src={p.imageUrl}
                                alt={p.name}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-stone-300">
                                Không có ảnh
                              </div>
                            )}
                          </div>
                          <p className="mt-2 truncate font-bold text-ink">{p.name}</p>
                          <p className="font-bold text-lotus">{formatVND(p.dailyPrice)}/ngày</p>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {sizeId && (
                              <Link
                                href={`/catalog/${sizeId}`}
                                className="rounded border border-sand bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:border-lotus"
                              >
                                Xem chi tiết
                              </Link>
                            )}
                            {sizeId && (
                              <Link
                                href={`/try-on?garmentSizeId=${sizeId}`}
                                className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800"
                              >
                                <Camera className="h-3 w-3" />
                                <span>Thử AI</span>
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Thanh Lọc Danh Mục (Category Tabs) */}
        <section className="sticky top-16 z-20 mt-8 border-y border-sand bg-mist/95 py-4 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-bronze mr-2">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Triều đại / Danh mục:</span>
              </span>
              {categories.map((cat) => {
                const isSelected = activeCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                      isSelected
                        ? "bg-lotus text-white shadow-xs"
                        : "border border-sand bg-white text-stone-700 hover:border-lotus hover:text-lotus"
                    }`}
                  >
                    {cat === "all" ? "Tất cả cổ phục" : cat}
                  </button>
                );
              })}
            </div>

            <div className="text-xs font-medium text-stone-500">
              Hiển thị <span className="font-bold text-oxblood">{groups.length}</span> mẫu y phục
            </div>
          </div>
        </section>

        {/* Tiêu Điểm Tác Phẩm Nổi Bật (Featured Garment) */}
        {featured && activeCategory === "all" && !searchDebounced && (
          <section className="mt-10 overflow-hidden rounded-2xl border border-sand bg-white p-6 shadow-sm lg:p-8">
            <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-stone-100">
                  {featured.imageUrl ? (
                    <img
                      src={featured.imageUrl}
                      alt={featured.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-stone-400">
                      Cổ phục hoàng gia
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-md bg-black/75 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md">
                    Tiêu điểm phục dựng
                  </span>
                </div>
              </div>

              <div className="lg:col-span-7">
                <span className="text-xs font-bold uppercase tracking-widest text-bronze">
                  {featured.categoryName ?? "Triều Nguyễn"}
                </span>
                <h2 className="mt-2 font-display text-3xl font-bold text-oxblood sm:text-4xl">
                  {featured.name}
                </h2>
                <p className="mt-3 text-xs leading-relaxed text-stone-600 sm:text-sm">
                  Tác phẩm tiêu biểu phục dựng chuẩn mực văn hóa di sản. Tơ tằm tự nhiên kết hợp thêu
                  tay thủ công tinh xảo từng đường kim mũi chỉ.
                </p>

                {/* Chọn size */}
                <div className="mt-6 border-t border-sand pt-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-stone-700">
                    Kích thước có sẵn:
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {featured.sizes.map((s) => {
                      const sel =
                        (selectedSizes[featured.slug] ?? featured.sizes[0]?.garmentSizeId) ===
                        s.garmentSizeId;
                      return (
                        <button
                          key={s.garmentSizeId}
                          type="button"
                          onClick={() => handleSelectSize(featured.slug, s.garmentSizeId)}
                          className={`min-w-[40px] rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            sel
                              ? "bg-lotus text-white shadow-xs"
                              : "border border-sand bg-parchment text-stone-700 hover:border-lotus"
                          }`}
                        >
                          Size {s.sizeLabel ?? "Chuẩn"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Giá thuê & Cọc */}
                <div className="mt-6 flex flex-wrap items-baseline gap-6 border-t border-sand pt-4">
                  <div>
                    <span className="block text-xs text-stone-500">Giá thuê</span>
                    <span className="font-display text-2xl font-bold text-lotus sm:text-3xl">
                      {(() => {
                        const sel =
                          selectedSizes[featured.slug] ?? featured.sizes[0]?.garmentSizeId;
                        const sz =
                          featured.sizes.find((s) => s.garmentSizeId === sel) ?? featured.sizes[0];
                        return sz ? formatVND(sz.dailyPrice) : "—";
                      })()}
                      <span className="text-xs font-normal text-stone-600">/ngày</span>
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs text-stone-500">Tiền cọc minh bạch</span>
                    <span className="text-sm font-semibold text-ink">
                      {(() => {
                        const sel =
                          selectedSizes[featured.slug] ?? featured.sizes[0]?.garmentSizeId;
                        const sz =
                          featured.sizes.find((s) => s.garmentSizeId === sel) ?? featured.sizes[0];
                        return sz ? formatVND(sz.depositAmount) : "—";
                      })()}
                    </span>
                  </div>
                </div>

                {/* Hành động */}
                <div className="mt-8 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleAddToCart(featured)}
                    className="inline-flex items-center gap-2 rounded-lg bg-lotus px-6 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-xs transition hover:bg-oxblood active:scale-[0.98]"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    <span>Thêm vào giỏ</span>
                  </button>

                  <Link
                    href={`/try-on?garmentSizeId=${
                      selectedSizes[featured.slug] ?? featured.sizes[0]?.garmentSizeId
                    }`}
                    className="inline-flex items-center gap-2 rounded-lg border border-sand bg-white px-6 py-3 text-xs font-semibold uppercase tracking-wider text-ink shadow-xs transition hover:border-lotus hover:text-lotus active:scale-[0.98]"
                  >
                    <Camera className="h-4 w-4 text-lotus" />
                    <span>Ướm thử AI</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Lưới Sản Phẩm Chính (Main Costume Grid) */}
        <section className="mt-12">
          {loading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-xl border border-sand bg-white p-4 shadow-xs"
                >
                  <div className="aspect-[3/4] w-full animate-pulse rounded-lg bg-stone-200" />
                  <div className="mt-4 h-5 w-3/4 animate-pulse rounded bg-stone-200" />
                  <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-stone-200" />
                  <div className="mt-4 h-9 w-full animate-pulse rounded-lg bg-stone-200" />
                </div>
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-sand bg-white py-16 text-center shadow-xs">
              <ShoppingBag className="mx-auto h-12 w-12 text-stone-300" />
              <h3 className="mt-3 font-display text-xl font-bold text-stone-800">
                Không tìm thấy y phục phù hợp
              </h3>
              <p className="mt-1 text-xs text-stone-500">
                Vui lòng thử đổi từ khóa tìm kiếm hoặc chọn danh mục cổ phục khác.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {groups
                .slice(featured && activeCategory === "all" && !searchDebounced ? 1 : 0)
                .map((group) => {
                  const selectedGarmentId =
                    selectedSizes[group.slug] ?? group.sizes[0]?.garmentSizeId;
                  const selectedSize =
                    group.sizes.find((s) => s.garmentSizeId === selectedGarmentId) ??
                    group.sizes[0];

                  return (
                    <CatalogGarmentCard
                      key={group.slug}
                      group={group}
                      selectedGarmentId={selectedGarmentId}
                      selectedSize={selectedSize}
                      onSelectSize={(sizeId) => handleSelectSize(group.slug, sizeId)}
                      onAddToCart={() => handleAddToCart(group)}
                    />
                  );
                })}
            </div>
          )}
        </section>

        {/* CTA Cuối trang khi giỏ có hàng */}
        {cartCountVal > 0 && (
          <div className="mt-16 text-center">
            <Link
              href="/booking/date-selection"
              className="inline-flex items-center gap-2 rounded-xl bg-oxblood px-8 py-4 text-sm font-semibold uppercase tracking-wider text-white shadow-lg transition hover:bg-red-950 active:scale-[0.98]"
            >
              <span>Xem giỏ &amp; chọn ngày thuê ({cartCountVal} trang phục)</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </main>

      <CustomerFooter />
    </div>
  );
}