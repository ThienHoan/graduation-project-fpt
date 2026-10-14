"use client";

import { useEffect, useState } from "react";
import { getSimilarGarments, type SimilarGarment } from "@/lib/api";

type SimilarGarmentsProps = {
  currentGarmentId: string | null;
  onSelectGarment: (garmentId: string) => void;
};

export function SimilarGarments({ currentGarmentId, onSelectGarment }: SimilarGarmentsProps) {
  const [items, setItems] = useState<SimilarGarment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentGarmentId) {
      setItems([]);
      return;
    }

    setLoading(true);
    getSimilarGarments(currentGarmentId, 4)
      .then((res) => {
        if (res.success && res.data) {
          setItems(res.data);
        } else {
          setItems([]);
        }
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [currentGarmentId]);

  if (!currentGarmentId) return null;

  return (
    <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-ink">Gợi ý sản phẩm tương tự</h2>
          <p className="mt-1 text-xs text-stone-500">
            Các mẫu có cùng phong cách, màu sắc hoặc phân khúc giá để bạn thử thêm.
          </p>
        </div>
        <span className="material-symbols-outlined text-2xl text-antique">auto_awesome</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-44 animate-pulse rounded-lg bg-stone-100" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.garmentId}
              className="group flex flex-col justify-between overflow-hidden rounded-xl border border-sand bg-mist transition hover:border-lotus/40 hover:shadow-md"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-lotus/10">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-stone-400">
                    Không có ảnh
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-lotus backdrop-blur-sm">
                  {item.similarityScore}% khớp
                </span>
              </div>

              <div className="flex flex-1 flex-col justify-between p-3">
                <div>
                  <h3 className="line-clamp-1 text-xs font-semibold text-ink" title={item.name}>
                    {item.name}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-stone-500">
                    {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(item.dailyPrice)}/ngày
                  </p>
                  {item.reasons.length > 0 && (
                    <p className="mt-1 line-clamp-1 text-[10px] text-stone-400">
                      {item.reasons[0]}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onSelectGarment(item.garmentId)}
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-lotus/10 py-1.5 text-xs font-medium text-lotus transition hover:bg-lotus hover:text-white"
                >
                  <span className="material-symbols-outlined text-[14px]">styler</span>
                  Thử mẫu này
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-center text-xs text-stone-400 py-4">
          Chưa có mẫu tương tự nào khác trong bộ sưu tập.
        </p>
      )}
    </section>
  );
}
