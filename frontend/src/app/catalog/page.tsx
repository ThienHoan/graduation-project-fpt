"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CustomerNavbar } from "@/components/customer/navbar";
import { CustomerFooter } from "@/components/customer/footer";
import { getGarmentCategories, getGarmentsGrouped, type GarmentCategory, type GarmentGrouped } from "@/lib/api";
import { addToCart, cartCount, removeFromCart, getCart } from "@/lib/cart";
import { getProductAdvisor, type AIAdvisorTopic, type AIAdvisorProduct } from "@/lib/chat";

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);
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
    ).then((res) => {
      if (res.success && res.data) setGroups(res.data);
    }).finally(() => setLoading(false));
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
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
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
    if (!selectedGarmentId) {
      // Default to first size
      const firstSize = group.sizes[0];
      if (!firstSize) return;
      const s = firstSize;
      addToCart({
        garmentSizeId: s.garmentSizeId,
        garmentId: group.garmentId,
        name: group.name + (s.sizeLabel ? ` (Size ${s.sizeLabel})` : ""),
        sizeLabel: s.sizeLabel,
        dailyPrice: s.dailyPrice,
        depositAmount: s.depositAmount,
        imageUrl: group.imageUrl,
      });
    } else {
      const s = group.sizes.find((sz) => sz.garmentSizeId === selectedGarmentId)!;
      addToCart({
        garmentSizeId: s.garmentSizeId,
        garmentId: group.garmentId,
        name: group.name + (s.sizeLabel ? ` (Size ${s.sizeLabel})` : ""),
        sizeLabel: s.sizeLabel,
        dailyPrice: s.dailyPrice,
        depositAmount: s.depositAmount,
        imageUrl: group.imageUrl,
      });
    }
    setCartCountVal(cartCount());
    setAddedMsg(`Đã thêm "${group.name}" vào giỏ`);
    setTimeout(() => setAddedMsg(null), 2000);
  }

  function handleRemoveFromCart(garmentId: string) {
    removeFromCart(garmentId);
    setCartCountVal(cartCount());
  }

  async function handleAiConsult() {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiTopics([]);
    const res = await getProductAdvisor({ message: aiQuery.trim() });
    if (res.success && res.data) {
      setAiTopics(res.data.topics);
    } else {
      setAiError("Không thể gợi ý sản phẩm. Vui lòng thử lại.");
    }
    setAiLoading(false);
  }

  function findAiProductSizeId(product: AIAdvisorProduct): string | undefined {
    const group = groups.find((g) => g.name === product.name || g.garmentId === product.garmentId)
    if (!group?.sizes.length) return undefined;
    const sizeLabels = (product.size ?? "").split(/[-,/\s]+/).filter(Boolean).map((s) => s.toUpperCase());
    const matched = group.sizes.find((s) => s.sizeLabel && sizeLabels.includes(s.sizeLabel.toUpperCase()));
    return (matched ?? group.sizes[0])?.garmentSizeId;
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
    setTimeout(() => setAddedMsg(null), 2000);
  }

  const featured = groups[0];
  const cartItems = getCart();

  return (
    <div className="min-h-screen bg-mist text-ink">
      <CustomerNavbar active="collection" cartHref="/booking/date-selection" />

      {/* Cart icon floating */}
      <div className="fixed right-4 top-24 z-30 sm:right-8">
        <button
          type="button"
          onClick={() => setShowCart(!showCart)}
          className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg border border-sand hover:border-lotus transition"
        >
          <span className="material-symbols-outlined text-2xl text-lotus">shopping_bag</span>
          {cartCountVal > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-oxblood text-[11px] font-bold text-white">
              {cartCountVal}
            </span>
          )}
        </button>

        {/* Cart dropdown */}
        {showCart && (
          <div className="absolute right-0 top-14 w-80 rounded-xl border border-sand bg-white p-4 shadow-2xl">
            <h3 className="font-display text-lg text-ink mb-3 border-b border-sand pb-2">
              Giỏ thuê ({cartCountVal})
            </h3>
            {cartItems.length === 0 ? (
              <p className="text-sm text-stone-400 py-4">Giỏ hàng trống</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {cartItems.map((item) => (
                  <div key={item.garmentSizeId} className="flex items-center justify-between text-sm border-b border-sand/50 pb-2">
                    <div>
                      <p className="font-medium text-ink">{item.name}</p>
                      <p className="text-xs text-stone-500">{formatVND(item.dailyPrice)}/ngày</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFromCart(item.garmentSizeId)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Xoá
                    </button>
                  </div>
                ))}
              </div>
            )}
            {cartItems.length > 0 && (
              <Link
                href="/booking/date-selection"
                className="mt-3 block w-full rounded-lg bg-lotus px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-oxblood transition"
                onClick={() => setShowCart(false)}
              >
                Thuê ngay
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Toast message */}
      {addedMsg && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-jade px-6 py-3 text-sm font-semibold text-white shadow-lg">
          {addedMsg}
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-24 sm:px-6 lg:px-8 lg:pt-28">
        <header className="py-12 text-center lg:py-20">
          <h1 className="font-display text-5xl uppercase text-ink sm:text-6xl">Lưu Trữ Di Sản</h1>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-stone-600 sm:text-lg">
            Khám phá bộ sưu tập y phục truyền thống Việt Nam được chọn lọc cho thuê. Chọn size và thêm vào giỏ để bắt đầu.
          </p>
        </header>

        {/* Filter bar */}
        <section className="sticky top-20 z-20 mb-10 border-y border-sand/70 bg-mist/95 py-5 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-lotus">
                <span className="material-symbols-outlined text-[18px]">tune</span>
                Bộ lọc
              </span>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${activeCategory === cat
                      ? "border-lotus bg-lotus text-white"
                      : "border-sand bg-white text-stone-600 hover:border-antique hover:text-lotus"
                    }`}
                >
                  {cat === "all" ? "Tất cả" : cat}
                </button>
              ))}
            </div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
              Hiển thị <span className="font-semibold text-oxblood">{groups.length}</span> trang phục
            </div>
          </div>
        </section>

        {/* Search bar */}
        <section className="mb-6">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-lg text-stone-400">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm trang phục theo tên, thể loại, màu sắc..."
              className="w-full rounded-xl border border-sand bg-white py-3.5 pl-11 pr-4 text-sm outline-none transition focus:border-lotus focus:ring-1 focus:ring-lotus/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            )}
          </div>
        </section>

        {/* AI Product Advisor */}
        <section className="mb-12 rounded-lg border border-sand/70 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-display text-2xl text-ink mb-1">Bạn cần tìm trang phục gì?</h2>
              <p className="text-sm text-stone-500">Mô tả nhu cầu của bạn, AI sẽ gợi ý sản phẩm phù hợp.</p>
            </div>
            {aiTopics.length > 0 && (
              <button
                type="button"
                onClick={() => { setAiTopics([]); setAiQuery(""); setAiError(null); }}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100 hover:border-red-300"
                aria-label="Đóng gợi ý"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
                Bỏ qua
              </button>
            )}
          </div>
          <div className="flex gap-3 mt-4">
            <input
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAiConsult(); }}
              placeholder="VD: Tôi cần áo dài hồng pastel size M cho tiệc cưới..."
              className="flex-1 rounded-xl border border-sand bg-mist px-4 py-3 text-sm outline-none focus:border-lotus"
            />
            <button
              type="button"
              onClick={handleAiConsult}
              disabled={aiLoading || !aiQuery.trim()}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-lotus px-6 py-3 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiLoading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
              )}
              Gợi ý
            </button>
          </div>
          {aiError && (
            <p className="mt-3 text-sm text-red-500">{aiError}</p>
          )}
          {aiTopics.length > 0 && (
            <div className="mt-6 space-y-6">
              {aiTopics.map((topic, ti) => (
                <div key={ti}>
                  <h3 className="font-display text-xl text-ink mb-3">{topic.title}</h3>
                  {topic.products.length > 0 && (
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 mb-4">
                      {[...topic.products].sort((a, b) => a.inStock === b.inStock ? 0 : a.inStock ? -1 : 1).map((p) => {
                        const sizeId = findAiProductSizeId(p);
                        return (
                          <div
                            key={p.garmentId}
                            className="flex flex-col rounded-xl border border-sand/70 bg-mist p-2"
                          >
                            <div className="w-full aspect-[1/1] rounded-lg border border-sand/70 mb-2 overflow-hidden bg-stone-100 flex items-center justify-center">
                              {p.imageUrl ? (
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                                />
                              ) : (
                                <span className="material-symbols-outlined text-2xl text-stone-300">image</span>
                              )}
                            </div>
                            <p className="text-xs font-semibold text-ink truncate">{p.name}</p>
                            <p className="text-[11px] text-lotus font-semibold mt-0.5">{formatVND(p.dailyPrice)}</p>
                            {p.size && <p className="text-[10px] text-stone-500">Size: {p.size}</p>}
                            {p.reason && (
                              <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2">{p.reason}</p>
                            )}
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              {sizeId && (
                                <Link
                                  href={`/catalog/${sizeId}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-lotus/30 px-2 py-1 text-[10px] font-semibold text-lotus transition hover:bg-lotus/10"
                                >
                                  Xem chi tiết
                                </Link>
                              )}
                              {sizeId && (
                                <Link
                                  href={`/try-on?garmentSizeId=${sizeId}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-jade/30 px-2 py-1 text-[10px] font-semibold text-jade transition hover:bg-jade/5"
                                >
                                  Thử đồ AI
                                </Link>
                              )}
                              {p.inStock ? (
                                <button
                                  type="button"
                                  onClick={() => handleAiAddToCart(p)}
                                  disabled={!sizeId}
                                  className="inline-flex items-center gap-1 rounded-full bg-lotus px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-oxblood disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <span className="material-symbols-outlined text-[12px]">shopping_bag</span>
                                  Thêm vào giỏ
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-1 text-[10px] font-semibold text-stone-400">
                                  Đang hết hàng
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-sm text-stone-700 italic border-l-2 border-sand pl-3">
                    {topic.assistantReply}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Featured */}
        {featured && (
          <section className="mb-20 grid items-center gap-10 lg:grid-cols-[1.25fr_0.9fr] lg:gap-20">
            <div className="relative overflow-hidden rounded-sm border border-sand/70 bg-lotus/5 shadow-lg">
              <div className="flex aspect-[4/5] items-center justify-center">
                {featured.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={featured.imageUrl} alt={featured.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="material-symbols-outlined text-[80px] text-antique/30">checkroom</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.26em] text-antique">
                {featured.categoryName ?? "Trang phục"}
              </span>
              <h2 className="mt-5 font-display text-5xl text-oxblood">{featured.name}</h2>
              <dl className="mt-8 space-y-4 border-y border-sand py-6 text-sm text-ink">
                <div className="flex items-center justify-between gap-4">
                  <dt className="uppercase tracking-[0.16em] text-stone-500">Size</dt>
                  <dd className="flex gap-2">
                    {featured.sizes.map((s) => (
                      <button
                        key={s.garmentSizeId}
                        type="button"
                        onClick={() => handleSelectSize(featured.slug, s.garmentSizeId)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${(selectedSizes[featured.slug] ?? featured.sizes[0]?.garmentSizeId) === s.garmentSizeId
                            ? "bg-lotus text-white"
                            : "bg-parchment text-stone-600 hover:bg-lotus/20"
                          }`}
                      >
                        {s.sizeLabel ?? "—"}
                      </button>
                    ))}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="uppercase tracking-[0.16em] text-stone-500">Giá thuê</dt>
                  <dd className="font-semibold text-lotus">
                    {(() => {
                      const sel = selectedSizes[featured.slug] ?? featured.sizes[0]?.garmentSizeId;
                      const sz = featured.sizes.find((s) => s.garmentSizeId === sel) ?? featured.sizes[0];
                      return sz ? formatVND(sz.dailyPrice) + " / ngày" : "—";
                    })()}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => handleAddToCart(featured)}
                className="mt-8 inline-flex items-center gap-3 border border-lotus px-8 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-lotus transition hover:bg-lotus hover:text-white"
              >
                Thêm vào giỏ
                <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
              </button>
            </div>
          </section>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex flex-col border border-sand bg-white/80 p-4">
                <div className="aspect-[3/4] w-full animate-pulse bg-stone-200" />
                <div className="mt-6 h-6 w-3/4 animate-pulse rounded bg-stone-200" />
                <div className="mt-3 flex gap-2">
                  <div className="h-6 w-8 animate-pulse rounded-full bg-stone-200" />
                  <div className="h-6 w-8 animate-pulse rounded-full bg-stone-200" />
                </div>
                <div className="mt-auto pt-4">
                  <div className="h-4 w-full animate-pulse rounded bg-stone-200" />
                  <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-stone-200" />
                  <div className="mt-4 h-10 w-full animate-pulse rounded-lg bg-stone-200" />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="py-20 text-center text-stone-400">
            <span className="material-symbols-outlined text-[48px]">checkroom</span>
            <p className="mt-4">Chưa có trang phục nào.</p>
          </div>
        ) : (
          <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            {groups.slice(featured ? 1 : 0).map((group) => {
              const selectedGarmentId = selectedSizes[group.slug] ?? group.sizes[0]?.garmentSizeId;
              const selectedSize = group.sizes.find((s) => s.garmentSizeId === selectedGarmentId) ?? group.sizes[0];
              return (
                <article
                  key={group.slug}
                  className="group flex flex-col border border-antique/20 bg-white/80 p-4 backdrop-blur-sm transition duration-500 hover:border-antique/60 hover:shadow-lg"
                >
                  <Link href={`/catalog/${selectedGarmentId}`} className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-lotus/5 cursor-pointer">
                    {group.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={group.imageUrl} alt={group.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                    ) : (
                      <span className="material-symbols-outlined text-[60px] text-antique/40">checkroom</span>
                    )}
                    <div className="absolute left-4 top-4 rounded bg-white/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-ink backdrop-blur">
                      {group.categoryName ?? "Trang phục"}
                    </div>
                  </Link>

                  <div className="flex flex-1 flex-col px-2 pb-4 pt-6">
                    <Link href={`/catalog/${selectedGarmentId}`} className="hover:underline">
                      <h3 className="font-display text-2xl text-oxblood">{group.name}</h3>
                    </Link>

                    {/* Size pills */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {group.sizes.map((s) => (
                        <button
                          key={s.garmentSizeId}
                          type="button"
                          onClick={() => handleSelectSize(group.slug, s.garmentSizeId)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase transition ${selectedGarmentId === s.garmentSizeId
                              ? "bg-lotus text-white"
                              : "bg-parchment text-stone-500 hover:bg-lotus/20"
                            }`}
                        >
                          {s.sizeLabel ?? "—"}
                        </button>
                      ))}
                    </div>

                    <div className="mt-auto space-y-2 border-t border-antique/20 pt-4">
                      <div className="flex items-end justify-between gap-4">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Giá thuê</span>
                        <span className="text-base font-semibold text-lotus">
                          {selectedSize ? formatVND(selectedSize.dailyPrice) + " / ngày" : "—"}
                        </span>
                      </div>
                      <div className="flex items-end justify-between gap-4">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Tiền cọc</span>
                        <span className="text-sm text-ink">
                          {selectedSize ? formatVND(selectedSize.depositAmount) : "—"}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAddToCart(group)}
                      className="mt-4 w-full rounded-lg bg-lotus px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-oxblood"
                    >
                      Thêm vào giỏ
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {/* Bottom CTA */}
        {cartCountVal > 0 && (
          <div className="mt-16 text-center">
            <Link
              href="/booking/date-selection"
              className="inline-flex items-center gap-3 rounded-lg bg-oxblood px-10 py-5 text-base font-semibold text-white shadow-lg transition hover:bg-red-950"
            >
              Xem giỏ & đặt lịch ({cartCountVal} món)
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </Link>
          </div>
        )}
      </main>
      <CustomerFooter />
    </div>
  );
}