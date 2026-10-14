"use client";

import { useEffect, useState } from "react";
import { Sparkles, Shirt } from "lucide-react";
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
    <section className="rounded-2xl border border-sand bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-ink">Gợi ý sản phẩm tương tự</h2>
          <p className="mt-1 text-xs text-stone-500">
            Các mẫu có cùng phong cách, màu sắc hoặc kiểu dáng để bạn thử thêm.
          </p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-antique/10 text-antique">
          <Sparkles className="h-5 w-5" />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-44 animate-pulse rounded-xl bg-stone-100" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.garmentId}
              className="group flex flex-col justify-between overflow-hidden rounded-xl border border-sand bg-mist/60 transition-colors duration-200 hover:border-lotus hover:shadow-md"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-lotus/10">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-stone-400">
                    Không có ảnh
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full border border-sand/60 bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-lotus backdrop-blur-sm shadow-xs">
                  {item.similarityScore}% khớp
                </span>
              </div>

              <div className="flex flex-1 flex-col justify-between p-3">
                <div>
                  <h3 className="line-clamp-1 text-xs font-semibold text-ink" title={item.name}>
                    {item.name}
                  </h3>
                  <p className="mt-0.5 text-[11px] font-medium text-lotus">
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
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-lotus/30 bg-lotus/10 py-1.5 text-xs font-semibold text-lotus transition hover:bg-lotus hover:text-white"
                >
                  <Shirt className="h-3.5 w-3.5" />
                  Thử mẫu này
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-stone-400">
          Chưa có mẫu tương tự nào khác trong bộ sưu tập.
        </p>
      )}
    </section>
  );
}
