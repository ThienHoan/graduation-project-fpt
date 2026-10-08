import type { BookingHandover } from "@/lib/api";

type Props = {
  handover?: BookingHandover | null;
  compact?: boolean;
};

const conditionLabels: Record<string, string> = {
  GOOD: "Tốt",
  MINOR_DAMAGE: "Có lỗi nhẹ",
  MAJOR_DAMAGE: "Lỗi nặng",
};

export function HandoverSummary({ handover, compact = false }: Props) {
  if (!handover || !handover.status) {
    return (
      <section className="rounded-xl border border-dashed border-sand bg-mist p-5">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-antique">fact_check</span>
          <div>
            <h3 className="font-semibold text-ink">Biên bản bàn giao</h3>
            <p className="mt-1 text-sm text-stone-500">Chưa có biên bản bàn giao. Nhân viên sẽ cập nhật khi giao hoặc trao sản phẩm tại cửa hàng.</p>
          </div>
        </div>
      </section>
    );
  }

  const isConfirmed = handover.status === "CONFIRMED";
  const statusLabel = isConfirmed ? "Đã xác nhận" : handover.status === "REJECTED" ? "Bị từ chối" : "Đang chờ xác nhận";
  const statusClass = isConfirmed ? "bg-jade/10 text-jade" : handover.status === "REJECTED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  const receivedAt = handover.receivedAt ? new Date(handover.receivedAt).toLocaleString("vi-VN") : null;
  const decidedAt = handover.decidedAt ? new Date(handover.decidedAt).toLocaleString("vi-VN") : null;

  return (
    <section className="rounded-xl border border-sand bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`material-symbols-outlined ${isConfirmed ? "text-jade" : "text-antique"}`}>fact_check</span>
          <div>
            <h3 className="font-display text-2xl text-ink">Biên bản bàn giao</h3>
            <p className="mt-1 text-xs text-stone-500">Thông tin được ghi nhận tại thời điểm giao nhận thực tế</p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
      </div>

      <div className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Tình trạng sản phẩm</p>
          <p className="mt-1 font-medium text-ink">{handover.conditionBeforeRental ? conditionLabels[handover.conditionBeforeRental] : "—"}</p>
        </div>
        {isConfirmed && receivedAt && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Thời gian nhận</p>
            <p className="mt-1 font-medium text-ink">{receivedAt}</p>
          </div>
        )}
        {decidedAt && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">{handover.status === "REJECTED" ? "Thời gian từ chối" : "Thời gian quyết định"}</p>
            <p className="mt-1 font-medium text-ink">{decidedAt}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Người giao</p>
          <p className="mt-1 font-medium text-ink">{handover.deliveryPersonName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Người nhận</p>
          <p className="mt-1 font-medium text-ink">{handover.receiverName ?? "—"}</p>
          {handover.receiverPhone && <p className="text-xs text-stone-500">{handover.receiverPhone}</p>}
        </div>
      </div>

      <div className="mt-5 grid gap-2 rounded-lg bg-mist p-4 text-sm">
        <p className="font-semibold text-ink">Checklist</p>
        {[
          [handover.correctProduct, "Đúng mẫu và đúng size"],
          [handover.noVisibleDefect, "Không có lỗi nhìn thấy trước khi nhận"],
          [handover.customerAgreed, "Người nhận đồng ý nhận sản phẩm"],
        ].map(([checked, label]) => (
          <div key={label as string} className="flex items-center gap-2 text-stone-700">
            <span className={`material-symbols-outlined text-[17px] ${checked ? "text-jade" : "text-stone-400"}`}>{checked ? "check_circle" : "radio_button_unchecked"}</span>
            <span>{label as string}</span>
          </div>
        ))}
      </div>

      {!compact && handover.images.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Ảnh tại thời điểm bàn giao</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {handover.images.map((image, index) => (
              <a key={`${image}-${index}`} href={image} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border border-sand bg-mist">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt={`Ảnh bàn giao ${index + 1}`} className="h-24 w-24 object-cover transition group-hover:scale-105" />
              </a>
            ))}
          </div>
        </div>
      )}

      {handover.note && <p className="mt-5 whitespace-pre-wrap rounded-lg border border-sand bg-parchment/40 px-4 py-3 text-sm text-stone-700"><span className="font-semibold text-ink">Ghi chú: </span>{handover.note}</p>}
    </section>
  );
}
