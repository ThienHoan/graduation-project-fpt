/**
 * Unified Status Labels — SINGLE SOURCE OF TRUTH
 *
 * Every dashboard (customer, staff, manager, admin) MUST import from here.
 * Never hardcode status colors inline.
 *
 * Usage:
 *   import { STATUS_LABELS, statusBadgeClass } from "@/lib/status-labels";
 *   const st = STATUS_LABELS[booking.status] ?? { label: booking.status, color: "bg-stone-100 text-stone-600" };
 *   <span className={statusBadgeClass(st.color)}>{st.label}</span>
 */

export interface StatusLabel {
  label: string;
  color: string;
}

export const STATUS_LABELS: Record<string, StatusLabel> = {
  draft:                { label: "Nháp",                color: "bg-stone-100 text-stone-600" },
  pending_confirmation: { label: "Chờ xác nhận",        color: "bg-lotus/10 text-lotus" },
  confirmed:            { label: "Đã xác nhận",         color: "bg-jade/10 text-jade" },
  awaiting_payment:     { label: "Chờ thanh toán",      color: "bg-amber-50 text-amber-700" },
  paid:                 { label: "Đã thanh toán",       color: "bg-jade/10 text-jade" },
  preparing:            { label: "Đang chuẩn bị",       color: "bg-lotus/10 text-lotus" },
  ready_for_pickup:     { label: "Sẵn sàng nhận",       color: "bg-jade/10 text-jade" },
  delivering:           { label: "Đang giao",            color: "bg-amber-50 text-amber-700" },
  renting:              { label: "Đang thuê",            color: "bg-lotus/10 text-lotus" },
  returned:             { label: "Đã trả",               color: "bg-stone-100 text-stone-600" },
  inspection_pending:   { label: "Chờ kiểm tra",        color: "bg-amber-50 text-amber-700" },
  refund_pending:       { label: "Chờ hoàn cọc",        color: "bg-amber-50 text-amber-700" },
  completed:            { label: "Hoàn tất",             color: "bg-jade/10 text-jade" },
  cancelled:            { label: "Đã hủy",               color: "bg-stone-100 text-stone-500" },
  rejected:             { label: "Bị từ chối",           color: "bg-red-50 text-red-600" },
  overdue:              { label: "Quá hạn",              color: "bg-red-50 text-red-600" },
};

/**
 * Prebuilt Tailwind class string for all status badges.
 * Every badge gets: rounded-full, small text, uppercase, letter-spacing.
 */
export function statusBadgeClass(color: string): string {
  return `inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${color}`;
}

/** Lookup status by key, with fallback. */
export function statusOf(status: string): StatusLabel {
  return STATUS_LABELS[status] ?? { label: status, color: "bg-stone-100 text-stone-600" };
}

const STATUS_KEYS = Object.keys(STATUS_LABELS).sort((a, b) => b.length - a.length);
const STATUS_RE = new RegExp(`\\b(${STATUS_KEYS.join("|")})\\b`, "g");

export function normalizeStatusInText(text: string): string {
  return text.replace(STATUS_RE, (match) => STATUS_LABELS[match]?.label ?? match);
}

export const ACTIVE_BOOKING_STATUSES = new Set([
  "pending_confirmation", "confirmed", "awaiting_payment",
  "paid", "preparing", "ready_for_pickup", "delivering", "renting",
]);

/**
 * Bookings whose deposit has actually been collected and not yet settled.
 * Unpaid bookings (pending_confirmation, confirmed, awaiting_payment) are
 * excluded: a cancelled or abandoned PayOS checkout must not count as held.
 */
export const DEPOSIT_HELD_STATUSES = new Set([
  "paid", "preparing", "ready_for_pickup", "delivering", "renting",
  "overdue", "returned", "inspection_pending", "refund_pending",
]);

export const CANCELLABLE_STATUSES = new Set([
  "draft", "pending_confirmation", "confirmed", "awaiting_payment",
]);
