import { statusOf } from "@/lib/status-labels";
import {
  FileText,
  CheckCircle2,
  CreditCard,
  Shirt,
  Truck,
  Sparkles,
  RotateCcw,
  Award,
  XCircle,
  Ban,
  Check,
  type LucideIcon,
} from "lucide-react";

/**
 * Hành trình đơn thuê hiển thị cho khách hàng.
 * Mỗi mốc gom một hoặc nhiều trạng thái backend lại cho dễ hiểu.
 * `delivering` vs `ready_for_pickup` được chọn nhãn theo pickupMethod.
 */
type Step = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Các status backend thuộc mốc này. */
  statuses: string[];
};

const STEPS: Step[] = [
  { key: "placed", label: "Đặt đơn", icon: FileText, statuses: ["pending_confirmation"] },
  { key: "confirmed", label: "Xác nhận", icon: CheckCircle2, statuses: ["confirmed"] },
  { key: "payment", label: "Thanh toán", icon: CreditCard, statuses: ["awaiting_payment", "paid"] },
  { key: "preparing", label: "Chuẩn bị", icon: Shirt, statuses: ["preparing"] },
  { key: "handover", label: "Bàn giao", icon: Truck, statuses: ["ready_for_pickup", "delivering"] },
  { key: "renting", label: "Đang thuê", icon: Sparkles, statuses: ["renting"] },
  { key: "return", label: "Trả & kiểm tra", icon: RotateCcw, statuses: ["returned", "inspection_pending", "refund_pending", "overdue"] },
  { key: "completed", label: "Hoàn tất", icon: Award, statuses: ["completed"] },
];

const TERMINAL_NEGATIVE: Record<string, { label: string; detail: string; icon: LucideIcon }> = {
  cancelled: { label: "Đơn đã hủy", detail: "Đơn thuê này đã được hủy.", icon: XCircle },
  rejected: { label: "Đơn bị từ chối", detail: "Xưởng không thể tiếp nhận đơn này.", icon: Ban },
};

function stepIndexOfStatus(status: string): number {
  const i = STEPS.findIndex((s) => s.statuses.includes(status));
  return i === -1 ? 0 : i;
}

export function BookingStatusStepper({
  status,
  pickupMethod,
  className = "",
}: {
  status: string;
  pickupMethod?: string;
  className?: string;
}) {
  // Trạng thái kết thúc tiêu cực: hiện banner riêng, không vẽ tiến trình.
  const negative = TERMINAL_NEGATIVE[status];
  if (negative) {
    const NegativeIcon = negative.icon;
    return (
      <div className={`flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 ${className}`}>
        <NegativeIcon className="h-6 w-6 text-red-600 shrink-0" />
        <div>
          <p className="font-semibold text-red-700">{negative.label}</p>
          <p className="text-sm text-red-600">{negative.detail}</p>
        </div>
      </div>
    );
  }

  const currentStepIndex = stepIndexOfStatus(status);

  return (
    <div className={className}>
      {/* Ngang cho màn rộng */}
      <ol className="hidden items-start sm:flex">
        {STEPS.map((step, index) => {
          const state = index < currentStepIndex ? "done" : index === currentStepIndex ? "current" : "todo";
          // Nhãn bàn giao đổi theo hình thức nhận.
          const label = step.key === "handover" && pickupMethod === "delivery" ? "Đang giao" : step.label;
          const isLast = index === STEPS.length - 1;
          const StepIcon = step.icon;
          return (
            <li key={step.key} className="relative flex flex-1 flex-col items-center text-center">
              {!isLast && (
                <span
                  className={`absolute left-1/2 top-5 h-0.5 w-full ${index < currentStepIndex ? "bg-lotus" : "bg-sand"}`}
                  aria-hidden
                />
              )}
              <span
                className={
                  "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition " +
                  (state === "done"
                    ? "border-lotus bg-lotus text-white"
                    : state === "current"
                      ? "border-lotus bg-white text-lotus ring-4 ring-lotus/15"
                      : "border-sand bg-white text-stone-300")
                }
              >
                {state === "done" ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <StepIcon className="h-5 w-5" />
                )}
              </span>
              <span
                className={
                  "mt-2 px-1 text-xs font-medium " +
                  (state === "todo" ? "text-stone-400" : state === "current" ? "text-lotus font-semibold" : "text-ink")
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Dọc cho mobile */}
      <ol className="space-y-0 sm:hidden">
        {STEPS.map((step, index) => {
          const state = index < currentStepIndex ? "done" : index === currentStepIndex ? "current" : "todo";
          const label = step.key === "handover" && pickupMethod === "delivery" ? "Đang giao" : step.label;
          const isLast = index === STEPS.length - 1;
          const StepIcon = step.icon;
          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={
                    "flex h-9 w-9 items-center justify-center rounded-full border-2 " +
                    (state === "done"
                      ? "border-lotus bg-lotus text-white"
                      : state === "current"
                        ? "border-lotus bg-white text-lotus ring-4 ring-lotus/15"
                        : "border-sand bg-white text-stone-300")
                  }
                >
                  {state === "done" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                </span>
                {!isLast && <span className={`my-1 h-6 w-0.5 ${index < currentStepIndex ? "bg-lotus" : "bg-sand"}`} aria-hidden />}
              </div>
              <span
                className={
                  "pt-2 text-sm font-medium " +
                  (state === "todo" ? "text-stone-400" : state === "current" ? "text-lotus font-semibold" : "text-ink")
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Dòng mô tả trạng thái hiện tại */}
      <p className="mt-4 text-center text-sm text-stone-600 sm:mt-6">
        Trạng thái hiện tại:{" "}
        <span className="font-semibold text-lotus">{statusOf(status).label}</span>
      </p>
    </div>
  );
}
