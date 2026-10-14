import type { BookingHandover } from "@/lib/api";
import { ClipboardCheck, CheckCircle2, Circle, ShieldAlert } from "lucide-react";

type Props = {
  handover?: BookingHandover | null;
  compact?: boolean;
};

const conditionLabels: Record<string, string> = {
  GOOD: "Tốt",
  MINOR_DAMAGE: "Có lỗi nhẹ",
  MAJOR_DAMAGE: "Lỗi nặng",
};

const USAGE_TERMS = [
  "Không giặt máy, không phơi trực tiếp dưới nắng gắt hoặc sử dụng máy sấy nhiệt cao.",
  "Tránh để trang phục tiếp xúc với nước hoa đậm đặc, rượu, dầu ăn, hoặc các chất tẩy rửa.",
  "Không tự ý cắt chỉnh, sửa form hoặc đính thêm phụ kiện lên trang phục.",
  "Phát hiện hư hỏng sẵn có phải báo ngay tại quầy hoặc ghi chú trong vòng 30 phút sau khi nhận.",
  "Mức phạt hư hỏng được tính theo % giá trị bộ đồ. Nếu tổn thất vượt tiền cọc, khách có trách nhiệm bồi thường phần chênh lệch trong vòng 3 ngày làm việc.",
];

export function HandoverSummary({ handover, compact = false }: Props) {
  if (!handover || !handover.status) {
    return (
      <section className="rounded-2xl border border-dashed border-sand bg-mist p-5">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="h-6 w-6 text-antique shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-ink">Biên bản bàn giao</h3>
            <p className="mt-1 text-sm text-stone-500">Chưa có biên bản bàn giao. Nhân viên sẽ cập nhật khi giao hoặc trao sản phẩm tại cửa hàng.</p>
          </div>
        </div>
        {!compact && (
          <div className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/50 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0" />
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-800">
                Lưu ý sử dụng & Quy định bồi hoàn (Đọc trước khi nhận đồ)
              </p>
            </div>
            <ul className="space-y-1 text-xs text-amber-900/80 pl-1">
              {USAGE_TERMS.map((term, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="text-amber-700 font-bold">•</span>
                  <span>{term}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  const isConfirmed = handover.status === "CONFIRMED";
  const statusLabel = isConfirmed ? "Đã xác nhận" : handover.status === "REJECTED" ? "Bị từ chối" : "Đang chờ xác nhận";
  const statusClass = isConfirmed ? "bg-jade/10 text-jade" : handover.status === "REJECTED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  const receivedAt = handover.receivedAt ? new Date(handover.receivedAt).toLocaleString("vi-VN") : null;
  const decidedAt = handover.decidedAt ? new Date(handover.decidedAt).toLocaleString("vi-VN") : null;

  return (
    <section className="rounded-2xl border border-sand bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ClipboardCheck className={`h-6 w-6 shrink-0 mt-0.5 ${isConfirmed ? "text-jade" : "text-antique"}`} />
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

      <div className="mt-5 grid gap-2 rounded-xl bg-mist p-4 text-sm">
        <p className="font-semibold text-ink">Checklist</p>
        {[
          [handover.correctProduct, "Đúng mẫu và đúng size"],
          [handover.noVisibleDefect, "Không có lỗi nhìn thấy trước khi nhận"],
          [handover.customerAgreed, "Người nhận đồng ý nhận sản phẩm"],
        ].map(([checked, label]) => (
          <div key={label as string} className="flex items-center gap-2 text-stone-700">
            {checked ? (
              <CheckCircle2 className="h-4 w-4 text-jade shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-stone-300 shrink-0" />
            )}
            <span>{label as string}</span>
          </div>
        ))}
      </div>

      {!compact && handover.images.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Ảnh tại thời điểm bàn giao</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {handover.images.map((image, index) => (
              <a key={`${image}-${index}`} href={image} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-xl border border-sand bg-mist transition hover:border-lotus hover:shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt={`Ảnh bàn giao ${index + 1}`} className="h-24 w-24 object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}

      {handover.note && <p className="mt-5 whitespace-pre-wrap rounded-xl border border-sand bg-parchment/40 px-4 py-3 text-sm text-stone-700"><span className="font-semibold text-ink">Ghi chú: </span>{handover.note}</p>}

      {/* ── Điều khoản sử dụng trang phục ── */}
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0" />
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-800">
            Điều khoản sử dụng & Chính sách bồi thường
          </p>
        </div>
        <ol className="space-y-1.5 pl-1">
          {USAGE_TERMS.map((term, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs text-amber-900/80">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[9px] font-bold text-amber-800">
                {idx + 1}
              </span>
              <span>{term}</span>
            </li>
          ))}
        </ol>
        {isConfirmed && (
          <p className="mt-3 border-t border-amber-200 pt-2 text-[10px] text-amber-700 italic">
            ✓ Khách hàng đã xác nhận nhận trang phục và đồng ý với các điều khoản trên tại thời điểm bàn giao.
          </p>
        )}
      </div>
    </section>
  );
}

