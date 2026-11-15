"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  PackageX,
  Phone,
  RefreshCw,
  Shirt,
  TimerOff,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import {
  applyStaffIncidentAction,
  cancelBooking,
  cancelBookingChangeRequest,
  confirmBookingChangeRequest,
  createBookingChangeRequest,
  getBookingChangeRequest,
  getBookingIncidents,
  previewBookingChangeRequest,
  previewStaffIncidentEmail,
  type BookingIncidentItem,
  type BookingIncidentsResponse,
  type ChangeQuoteResponse,
  type CreateChangeRequestPayload,
  type IncidentSuggestion,
  type IncidentSuggestionAccessory,
  type ManagerIncidentActionPayload,
} from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import { STATUS_LABELS, statusBadgeClass } from "@/lib/status-labels";

/**
 * Nhãn dự phòng khi server chưa trả `reasonLabel` (dữ liệu cũ): khách không bao
 * giờ thấy mã kỹ thuật kiểu `asset_maintenance`.
 */
const INCIDENT_REASON_TEXT: Record<string, string> = {
  asset_damaged: "bị hư hỏng",
  asset_lost: "bị mất",
  asset_retired: "ngừng cho thuê",
  asset_maintenance: "đang bảo trì",
  asset_conflict: "bị trùng lịch với đơn khác",
  no_asset_available: "không còn chiếc cùng size",
  accessory_unavailable: "không còn phụ kiện thay thế",
};

/** Lý do sự cố dạng chữ tiếng Việt (ưu tiên bản dịch do server trả về). */
function incidentReasonText(
  incident: Pick<BookingIncidentItem, "reason" | "reasonLabel" | "itemKind">,
): string {
  const label = incident.reasonLabel?.trim();
  if (label) return label.charAt(0).toUpperCase() + label.slice(1);

  const code = incident.reason?.trim();
  if (!code) return "Không còn sẵn sàng cho lịch thuê.";
  const detail = INCIDENT_REASON_TEXT[code] ?? code;
  if (!code.startsWith("asset_")) return detail;
  const subject = incident.itemKind === "accessory" ? "Phụ kiện" : "Trang phục";
  return `${subject} ${detail}`;
}

function formatVND(amount: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(Number(amount) || 0);
}

function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type Tab = "replace" | "remove" | "cancel";

/** Một MẪU phụ kiện gộp từ các dòng đang có trong đơn + phụ kiện đi kèm mẫu mới. */
type AccessoryGroup = {
  accessoryId: string;
  name: string;
  imageUrl: string | null;
  lines: Array<{
    id: string;
    bookingItemId: string;
    isIncident: boolean;
    quantity: number;
    unitPrice: number;
    rentalTotal: number;
    isIncluded: boolean;
  }>;
  links: Array<{ itemId: string; accessory: IncidentSuggestionAccessory }>;
  /** Tổng đơn vị còn thuê được của các dòng KHÔNG bị sự cố. */
  healthyUnits: number;
  /** Toàn bộ dòng của mẫu đều bị sự cố → chỉ được bỏ mẫu. */
  incidentOnly: boolean;
  maxQuantity: number;
  available: number;
  addItemId: string | null;
  extraPrice: number | null;
  extraIncluded: boolean;
  unitRentalTotal: number;
  unitIsIncluded: boolean;
  /** Số lượng hiển thị khi khách chưa tự đổi. */
  defaultQuantity: number;
};

/** Các trạng thái đơn còn hủy được qua API hủy đơn thường của khách. */
const CUSTOMER_CANCELLABLE = new Set(["draft", "pending_confirmation", "confirmed", "awaiting_payment"]);

/**
 * Manager/Admin được huỷ mọi đơn TRƯỚC bàn giao (khớp `STAFF_CANCELLABLE_STATUSES`
 * ở backend). Sau `ready_for_pickup` (đang giao/đang thuê…) thì phải xử lý hoàn đồ.
 */
const STAFF_CANCELLABLE = new Set([
  "pending_confirmation",
  "confirmed",
  "awaiting_payment",
  "paid",
  "preparing",
  "ready_for_pickup",
]);

/** Bảng tiền + danh sách món sau thay đổi, dùng chung cho báo giá LIVE và báo giá thật. */
function QuoteBreakdown({ quote }: { quote: ChangeQuoteResponse }) {
  const afterItems = quote.afterItems ?? [];
  return (
    <>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-sand bg-mist/40 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Tiền thuê</dt>
          <dd className="mt-1 text-sm text-stone-700">
            {formatVND(quote.rentBefore)} → <strong className="text-ink">{formatVND(quote.rentAfter)}</strong>
          </dd>
        </div>
        <div className="rounded-lg border border-sand bg-mist/40 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Tiền cọc</dt>
          <dd className="mt-1 text-sm text-stone-700">
            {formatVND(quote.depositBefore)} → <strong className="text-ink">{formatVND(quote.depositAfter)}</strong>
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-lotus/30 bg-lotus/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-lotus">Thu thêm hôm nay</p>
          <p className="mt-1 font-display text-2xl text-ink">{formatVND(quote.chargeNow)}</p>
        </div>
        <div className="rounded-lg border border-jade/30 bg-jade/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-jade">Sẽ hoàn lại khi trả đồ</p>
          <p className="mt-1 font-display text-2xl text-ink">{formatVND(quote.accruedCredit)}</p>
        </div>
      </div>

      {quote.lines.length > 0 ? (
        <ul className="mt-4 space-y-1.5 border-t border-sand pt-3 text-sm">
          {quote.lines.map((line, index) => (
            <li
              key={`${line.component}-${line.direction}-${index}`}
              className="flex items-center justify-between text-stone-600"
            >
              <span>
                {line.component === "rent"
                  ? "Chênh lệch tiền thuê"
                  : line.component === "deposit"
                    ? "Chênh lệch tiền cọc"
                    : "Chênh lệch phụ kiện"}
              </span>
              <span className={line.direction === "charge" ? "font-semibold text-ink" : "font-semibold text-jade"}>
                {line.direction === "charge" ? "+" : "−"}
                {formatVND(line.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {afterItems.length > 0 ? (
        <div className="mt-4 border-t border-sand pt-3">
          <p className="text-sm font-semibold text-ink">Sản phẩm thuê sau thay đổi</p>
          <ul className="mt-2 space-y-2">
            {afterItems.map((row) => (
              <li key={`${row.kind}-${row.id}-${row.name}`} className="flex items-center gap-3 text-sm">
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt={row.name} className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-mist text-stone-400">
                    {row.kind === "garment" ? <Shirt className="h-4 w-4" /> : <PackageX className="h-4 w-4" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">
                    {row.name}
                    {row.sizeLabel ? ` · size ${row.sizeLabel}` : ""}
                  </span>
                  <span className="block text-xs text-stone-500">
                    {row.kind === "garment" ? "Trang phục" : row.isIncluded ? "Đi kèm trang phục" : "Phụ kiện thuê"}
                    {row.quantity > 1 ? ` · SL ${row.quantity}` : ""}
                  </span>
                </span>
                {row.lineTotal > 0 ? (
                  <span className="shrink-0 text-sm font-semibold text-ink">{formatVND(row.lineTotal)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * Khung nội dung của trang sự cố. Sidebar/nav do `booking/incidents/layout.tsx`
 * quyết định theo vai trò (khách → dashboard khách, quản lý → cổng quản lý), nên
 * trang giữ nội dung gọn, không tự dựng full-screen riêng.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-4xl text-ink">{children}</div>;
}

/**
 * Khối "Báo giá tạm tính" dùng chung cho tab Đổi mẫu và Bỏ món: đặt NGAY DƯỚI
 * phần phụ kiện và TRÊN nút xác nhận để khách thấy giá cập nhật trước khi bấm.
 */
function LiveQuotePanel({
  previewing,
  liveQuote,
  error,
  emptyText,
}: {
  previewing: boolean;
  liveQuote: ChangeQuoteResponse | null;
  error: string | null;
  emptyText: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-antique">Báo giá tạm tính</p>
        {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-400" /> : null}
      </div>
      {error ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </p>
      ) : liveQuote ? (
        <div className="mt-2 rounded-2xl border border-sand bg-white p-4">
          <QuoteBreakdown quote={liveQuote} />
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-dashed border-sand p-4 text-sm text-stone-500">
          {emptyText}
        </p>
      )}
    </div>
  );
}

/**
 * Khung xem trước email quản lý sắp gửi: người nhận, tiêu đề/lời nhắn sửa được
 * và iframe nội dung do server dựng. Dùng chung cho đề xuất / bỏ món / huỷ đơn.
 */
function ManagerEmailPreview({
  preview,
  title,
  subject,
  message,
  onSubjectChange,
  onMessageChange,
}: {
  preview: { subject: string; html: string; recipient: string | null };
  title: string;
  subject: string;
  message: string;
  onSubjectChange: (value: string) => void;
  onMessageChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-sand bg-mist/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
        Người nhận: {preview.recipient || "Khách chưa có email"}
      </p>
      <label className="block text-xs font-semibold text-stone-600">
        Tiêu đề email
        <input
          type="text"
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          maxLength={200}
          className="mt-1 w-full rounded-lg border border-sand px-3 py-2 text-sm font-normal text-ink focus:border-lotus focus:outline-none"
        />
      </label>
      <label className="block text-xs font-semibold text-stone-600">
        Lời nhắn thêm (tuỳ chọn)
        <textarea
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Lời nhắn mở đầu trong email gửi khách..."
          className="mt-1 w-full rounded-lg border border-sand px-3 py-2 text-sm font-normal text-ink focus:border-lotus focus:outline-none"
        />
      </label>
      <iframe
        title={title}
        srcDoc={preview.html}
        sandbox=""
        className="h-96 w-full rounded-lg border border-sand bg-white"
      />
    </div>
  );
}

export default function BookingIncidentsPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = typeof params?.bookingId === "string" ? params.bookingId : "";
  const router = useRouter();
  const { user } = useAuth();
  const isManager = user?.role === "manager_owner" || user?.role === "admin";

  const [data, setData] = useState<BookingIncidentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("replace");
  const [selectedSizeByIncident, setSelectedSizeByIncident] = useState<Record<string, string>>({});
  // Đơn chỉ lỗi phụ kiện: mẫu phụ kiện KHÁC được chọn (giá tính theo trang phục).
  const [selectedAccessoryModelByIncident, setSelectedAccessoryModelByIncident] = useState<
    Record<string, string>
  >({});
  // Số lượng thuê theo từng MẪU phụ kiện (gộp các dòng trùng mẫu thành 1 ô).
  // Không có khóa = dùng số lượng mặc định (giữ nguyên các dòng đang có).
  const [accessoryQuantityByModel, setAccessoryQuantityByModel] = useState<Record<string, number>>({});
  // Số dương gần nhất khách đã nhập — tick lại checkbox thì khôi phục đúng số đó.
  const [accessoryLastQuantityByModel, setAccessoryLastQuantityByModel] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<ChangeQuoteResponse | null>(null);
  /** Báo giá LIVE (chưa tạo yêu cầu) — cập nhật ngay khi khách đổi lựa chọn. */
  const [liveQuote, setLiveQuote] = useState<ChangeQuoteResponse | null>(null);
  const [liveQuoteError, setLiveQuoteError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancelBooking, setConfirmCancelBooking] = useState(false);
  /** Lý do huỷ — bắt buộc với manager/admin (backend yêu cầu). */
  const [cancelReason, setCancelReason] = useState("");

  // ── Quản lý xử lý: phương án + lý do + email gửi khách (gộp từ drawer cũ) ──
  const [managerPendingConfirm, setManagerPendingConfirm] = useState<"remove" | "cancel" | null>(null);
  const [managerReason, setManagerReason] = useState("");
  const [managerSubmitting, setManagerSubmitting] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerSuccess, setManagerSuccess] = useState<string | null>(null);
  const [managerPreviewing, setManagerPreviewing] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{
    subject: string;
    html: string;
    recipient: string | null;
  } | null>(null);
  /** Loại email đang xem trước — mỗi loại có tiêu đề mặc định riêng. */
  const [emailPreviewKind, setEmailPreviewKind] = useState<"proposal" | "remove" | "cancel" | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    const res = await getBookingIncidents(bookingId);
    if (!res.success || !res.data) {
      setLoadError(res.message ?? "Không tải được thông tin sự cố.");
      setLoading(false);
      return;
    }
    setData(res.data);
    setLoadError(null);

    // Đơn đang có yêu cầu chờ (của khách hoặc do cửa hàng đề xuất) → hiện lại báo giá.
    if (res.data.pendingRequest) {
      const requestRes = await getBookingChangeRequest(bookingId, res.data.pendingRequest.id);
      if (requestRes.success && requestRes.data) {
        const detail = requestRes.data;
        setQuote({
          requestId: detail.id,
          status: detail.status,
          type: detail.type,
          source: detail.source,
          rentBefore: detail.rentBefore,
          rentAfter: detail.rentAfter,
          depositBefore: detail.depositBefore,
          depositAfter: detail.depositAfter,
          discountBefore: detail.discountBefore,
          discountAfter: detail.discountAfter,
          chargeNow: detail.chargeAmount,
          accruedCredit: Number(detail.afterSnapshot?.creditAmount ?? 0),
          lines: detail.afterSnapshot?.adjustmentLines ?? [],
          paymentRequired: detail.chargeAmount > 0,
          requiresHold: detail.requiresHold,
          holdExpiresAt: detail.holdExpiresAt,
          countdownSeconds: detail.countdownSeconds,
        });
        setCountdown(detail.countdownSeconds);
      }
    }
    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Đếm ngược CHỈ khi yêu cầu giữ chỗ asset (đổi mẫu / thêm / thay phụ kiện).
  // Bỏ món không giữ chỗ nên không có đếm ngược, xác nhận được ngay.
  useEffect(() => {
    if (!quote) return;
    if (!quote.requiresHold) {
      setCountdown(0);
      return;
    }
    setCountdown(quote.countdownSeconds);
    const timer = setInterval(() => setCountdown((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [quote]);

  const garmentIncidents = useMemo(
    () => (data?.incidents ?? []).filter((incident) => incident.itemKind === "garment"),
    [data],
  );
  const accessoryIncidents = useMemo(
    () => (data?.incidents ?? []).filter((incident) => incident.itemKind === "accessory"),
    [data],
  );

  const suggestionByIncident = useMemo(() => {
    const map = new Map<string, IncidentSuggestion>();
    for (const suggestion of data?.suggestions ?? []) map.set(suggestion.incidentId, suggestion);
    return map;
  }, [data]);

  /**
   * Sự cố phụ kiện THẬT SỰ còn mẫu khác để đổi (server đã lọc theo tồn kho + các
   * mẫu đã nằm trong đơn). Mẫu nào không còn lựa chọn thì chỉ bỏ được.
   */
  const replaceableAccessoryIncidents = useMemo(
    () =>
      accessoryIncidents.filter((incident) => {
        const suggestion = suggestionByIncident.get(incident.id);
        return suggestion?.itemKind === "accessory" && suggestion.options.length > 0;
      }),
    [accessoryIncidents, suggestionByIncident],
  );

  /**
   * Có mở tab "Đổi mẫu" không: đơn chỉ lỗi phụ kiện mà mọi mẫu phụ kiện khác của
   * trang phục đều đã được thuê → chỉ còn "Bỏ món" và "Huỷ đơn".
   */
  const canOfferReplace =
    garmentIncidents.length > 0 || replaceableAccessoryIncidents.length > 0;

  /**
   * Tab đang hiển thị: tự bỏ "Đổi mẫu" khi không còn mẫu thay thế (không đổi state
   * để lần tải sau khách vẫn quay lại đúng tab mặc định).
   */
  const visibleTab: Tab = canOfferReplace ? tab : tab === "replace" ? "remove" : tab;

  // Mẫu trang phục đã chọn cho từng sự cố (kèm ảnh + phụ kiện đi kèm của mẫu đó).
  const chosenGarmentOptions = useMemo(() => {
    const rows: Array<{
      incident: (typeof garmentIncidents)[number];
      option: Extract<IncidentSuggestion, { itemKind: "garment" }>["options"][number];
    }> = [];
    for (const incident of garmentIncidents) {
      const suggestion = suggestionByIncident.get(incident.id);
      if (suggestion?.itemKind !== "garment") continue;
      const sizeId = selectedSizeByIncident[incident.id];
      const option = suggestion.options.find((row) => row.sizeId === sizeId);
      if (option) rows.push({ incident, option });
    }
    return rows;
  }, [garmentIncidents, selectedSizeByIncident, suggestionByIncident]);

  const garmentsChosen =
    garmentIncidents.length > 0 && chosenGarmentOptions.length === garmentIncidents.length;

  /**
   * Tab "Bỏ món" bỏ MỌI món bị sự cố. Nếu mọi trang phục của đơn đều bị bỏ →
   * đơn không còn trang phục ⇒ sẽ bị huỷ. Báo trước cho khách, không để họ
   * bấm xác nhận mà không biết.
   */
  const removingAllGarments = useMemo(() => {
    const items = data?.items ?? [];
    if (items.length === 0) return false;
    const incidentItemIds = new Set(
      garmentIncidents
        .map((incident) => incident.bookingItemId)
        .filter((id): id is string => Boolean(id)),
    );
    return items.every((item) => incidentItemIds.has(item.id));
  }, [data, garmentIncidents]);

  const accessoryIncidentItemIds = useMemo(
    () =>
      new Set(
        accessoryIncidents
          .map((incident) => incident.bookingAccessoryItemId)
          .filter((id): id is string => Boolean(id)),
      ),
    [accessoryIncidents],
  );

  // Phụ kiện của đơn + phụ kiện đi kèm MẪU MỚI, gộp theo `accessoryId` để một
  // mẫu chỉ hiện MỘT ô chọn số lượng thay vì mỗi chiếc một ô.
  const accessoryGroups = useMemo<AccessoryGroup[]>(() => {
    const map = new Map<string, AccessoryGroup>();
    const ensure = (accessoryId: string, name: string, imageUrl: string | null) => {
      let group = map.get(accessoryId);
      if (!group) {
        group = {
          accessoryId,
          name,
          imageUrl,
          lines: [],
          links: [],
          healthyUnits: 0,
          incidentOnly: false,
          maxQuantity: 0,
          available: 0,
          addItemId: null,
          extraPrice: null,
          extraIncluded: true,
          unitRentalTotal: 0,
          unitIsIncluded: true,
          defaultQuantity: 0,
        };
        map.set(accessoryId, group);
      }
      return group;
    };

    for (const row of data?.accessoryItems ?? []) {
      const group = ensure(row.accessoryId, row.name, row.imageUrl);
      group.lines.push({
        id: row.id,
        bookingItemId: row.bookingItemId,
        isIncident: accessoryIncidentItemIds.has(row.id),
        quantity: Math.max(1, row.quantity ?? 1),
        unitPrice: row.unitPrice,
        rentalTotal: row.rentalTotal,
        isIncluded: row.isIncluded,
      });
    }

    for (const { incident, option } of chosenGarmentOptions) {
      const itemId = incident.bookingItemId;
      if (!itemId) continue;
      for (const accessory of option.accessories) {
        ensure(accessory.accessoryId, accessory.name, accessory.imageUrl).links.push({
          itemId,
          accessory,
        });
      }
    }

    for (const group of map.values()) {
      group.healthyUnits = group.lines
        .filter((line) => !line.isIncident)
        .reduce((total, line) => total + line.quantity, 0);
      group.incidentOnly = group.lines.length > 0 && group.healthyUnits === 0;
      group.available = group.links.reduce((max, link) => Math.max(max, link.accessory.available), 0);
      // Link của mẫu mới cho biết trần thuê; mẫu không có link chỉ giữ được số
      // đơn vị đang có (không thêm mới).
      const linkMaxOf = (link: AccessoryGroup["links"][number] | null) =>
        link ? Math.max(0, Number(link.accessory.maxQuantity ?? link.accessory.available ?? 0)) : 0;
      const link =
        group.links.find((row) => linkMaxOf(row) >= group.healthyUnits) ?? group.links[0] ?? null;
      group.addItemId =
        link?.itemId ??
        group.lines.find((line) => !line.isIncident)?.bookingItemId ??
        null;
      group.extraPrice = link ? link.accessory.extraPrice : null;
      group.extraIncluded = link ? link.accessory.isIncluded : true;
      group.maxQuantity = group.incidentOnly ? 0 : Math.max(group.healthyUnits, linkMaxOf(link));
      const firstHealthy = group.lines.find((line) => !line.isIncident);
      const firstLine = firstHealthy ?? group.lines[0];
      group.unitRentalTotal = firstLine?.rentalTotal ?? 0;
      group.unitIsIncluded = firstLine?.isIncluded ?? true;
      group.defaultQuantity = group.incidentOnly
        ? 0
        : group.healthyUnits > 0
          ? group.healthyUnits
          : link && link.accessory.isIncluded
            ? Math.min(1, group.maxQuantity)
            : 0;
    }

    return [...map.values()];
  }, [accessoryIncidentItemIds, chosenGarmentOptions, data]);

  function accessoryQuantity(group: AccessoryGroup) {
    return Math.min(
      group.maxQuantity,
      Math.max(0, accessoryQuantityByModel[group.accessoryId] ?? group.defaultQuantity),
    );
  }

  /** Tick checkbox: bật thuê mẫu này theo số lượng khách đã nhập trước đó (mặc định 1). */
  function toggleAccessory(group: AccessoryGroup) {
    if (accessoryQuantity(group) > 0) {
      setAccessoryQuantity(group, 0);
      return;
    }
    const last = accessoryLastQuantityByModel[group.accessoryId];
    const fallback = group.defaultQuantity > 0 ? group.defaultQuantity : 1;
    setAccessoryQuantity(group, Math.min(group.maxQuantity, Math.max(1, last ?? fallback)));
  }

  function setAccessoryQuantity(group: AccessoryGroup, next: number) {
    const numeric = Number.isFinite(next) ? Math.trunc(next) : 0;
    const clamped = Math.min(group.maxQuantity, Math.max(0, numeric));
    setAccessoryQuantityByModel((current) => ({ ...current, [group.accessoryId]: clamped }));
    // Nhập 0 → bỏ tick; nhớ số dương gần nhất để tick lại khôi phục đúng số đó.
    if (clamped > 0) {
      setAccessoryLastQuantityByModel((current) => ({ ...current, [group.accessoryId]: clamped }));
    }
  }

  const expired = quote?.requiresHold === true && countdown <= 0;

  /**
   * Dựng payload từ lựa chọn hiện tại ở tab "Đổi mẫu". `null` khi chưa đủ dữ
   * kiện để báo giá (chưa chọn mẫu / chưa chọn mẫu phụ kiện thay thế).
   */
  function buildReplacePayload(): CreateChangeRequestPayload | null {
    if (!data) return null;
    const incidentIds = data.incidents.map((incident) => incident.id);
    if (incidentIds.length === 0) return null;

    if (garmentIncidents.length > 0) {
      const replacements = garmentIncidents.map((incident) => ({
        incidentId: incident.id,
        sizeId: selectedSizeByIncident[incident.id] ?? "",
      }));
      if (replacements.some((row) => !row.sizeId)) return null;
      // Phụ kiện bị sự cố CHỈ được bỏ mẫu trong luồng đổi trang phục; các mẫu
      // còn lại giữ/bỏ theo số lượng khách chọn (gộp mọi dòng cùng mẫu).
      const removeIds = new Set<string>();
      const addAccessories: Array<{ itemId: string; accessoryId: string; quantity: 1 }> = [];
      for (const group of accessoryGroups) {
        for (const line of group.lines) {
          if (line.isIncident) removeIds.add(line.id);
        }
        if (group.incidentOnly) continue;
        const target = accessoryQuantity(group);
        let keepUnits = target;
        for (const line of group.lines) {
          if (line.isIncident) continue;
          if (keepUnits >= line.quantity) {
            keepUnits -= line.quantity;
          } else {
            removeIds.add(line.id);
            keepUnits = 0;
          }
        }
        const missing = target - Math.min(target, group.healthyUnits);
        if (missing > 0 && group.addItemId) {
          for (let unit = 0; unit < missing; unit += 1) {
            addAccessories.push({ itemId: group.addItemId, accessoryId: group.accessoryId, quantity: 1 });
          }
        }
      }
      return {
        type: "replace",
        incidents: incidentIds,
        replacements,
        removeAccessoryItemIds: removeIds.size > 0 ? [...removeIds] : undefined,
        addAccessories: addAccessories.length > 0 ? addAccessories : undefined,
      };
    }

    // Đơn chỉ lỗi phụ kiện: đổi sang MẪU phụ kiện khác còn hàng. Mẫu phụ kiện
    // không còn lựa chọn thay thế sẽ tự động bị bỏ (server xoá dòng khi không có
    // `accessoryReplacements` tương ứng).
    const accessoryReplacements = replaceableAccessoryIncidents.map((incident) => ({
      incidentId: incident.id,
      accessoryId: selectedAccessoryModelByIncident[incident.id] || undefined,
    }));
    if (accessoryReplacements.length === 0) return null;
    if (accessoryReplacements.some((row) => !row.accessoryId)) return null;
    return { type: "replace", incidents: incidentIds, accessoryReplacements };
  }

  // ── Báo giá LIVE ──────────────────────────────────────────────────────────
  // Gọi preview mỗi khi lựa chọn đổi (chọn mẫu, số lượng phụ kiện), debounce 350ms
  // để không bắn request liên tục lúc khách đang gõ. Không tạo yêu cầu / giữ chỗ.
  const previewPayload = useMemo<CreateChangeRequestPayload | null>(() => {
    if (!data || quote) return null;
    // Bỏ món áp dụng ngay khi bấm, không còn panel xác nhận nên không cần báo
    // giá live cho tab này.
    if (visibleTab !== "replace") return null;
    return buildReplacePayload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, quote, tab, selectedSizeByIncident, selectedAccessoryModelByIncident, accessoryQuantityByModel, accessoryGroups]);

  useEffect(() => {
    if (!previewPayload) {
      setLiveQuote(null);
      setLiveQuoteError(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      const res = await previewBookingChangeRequest(bookingId, previewPayload);
      if (cancelled) return;
      setPreviewing(false);
      if (res.success && res.data) {
        setLiveQuote(res.data);
        setLiveQuoteError(null);
      } else {
        setLiveQuote(null);
        setLiveQuoteError(res.message ?? "Không tính được báo giá.");
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, previewPayload]);

  async function handleCreateChange(type: "replace" | "remove") {
    if (!data) return;
    setActionError(null);

    const incidentIds = data.incidents.map((incident) => incident.id);
    const bookingPaid = Boolean(data.booking.paid);

    /**
     * Đơn CHƯA thanh toán: đổi mẫu chỉ là "lưu đơn với mẫu mới", không cần giữ
     * chỗ/không thu chênh lúc này (khách trả khi thanh toán đơn). Tạo yêu cầu
     * xong áp dụng luôn trong một lượt bấm.
     */
    async function saveUnpaidChange(quoteData: ChangeQuoteResponse) {
      setConfirming(true);
      const confirmed = await confirmBookingChangeRequest(bookingId, quoteData.requestId);
      setConfirming(false);
      if (!confirmed.success || !confirmed.data) {
        // Giữ panel báo giá để khách bấm "Xác nhận đổi mẫu" thử lại.
        setActionError(confirmed.message ?? "Không thể xác nhận đổi mẫu. Vui lòng thử lại.");
        return;
      }
      router.push("/dashboard/customer");
    }

    // ── Đổi mẫu: chọn trang phục trước, rồi checklist phụ kiện ──────────────
    if (type === "replace" && garmentIncidents.length > 0) {
      const payload = buildReplacePayload();
      if (!payload) {
        setActionError("Vui lòng chọn mẫu trang phục mới cho từng món bị sự cố.");
        return;
      }
      setSubmitting(true);
      const res = await createBookingChangeRequest(bookingId, payload);
      setSubmitting(false);
      if (!res.success || !res.data) {
        setActionError(res.message ?? "Không thể tạo yêu cầu đổi. Vui lòng thử lại.");
        return;
      }
      setQuote(res.data);
      if (!bookingPaid) await saveUnpaidChange(res.data);
      return;
    }

    // ── Đơn chỉ lỗi phụ kiện: đổi sang MẪU phụ kiện khác còn hàng ───────────
    if (type === "replace") {
      const payload = buildReplacePayload();
      if (!payload) {
        setActionError("Vui lòng chọn mẫu phụ kiện thay thế còn hàng cho từng món.");
        return;
      }
      setSubmitting(true);
      const res = await createBookingChangeRequest(bookingId, payload);
      setSubmitting(false);
      if (!res.success || !res.data) {
        setActionError(res.message ?? "Không thể tạo yêu cầu đổi. Vui lòng thử lại.");
        return;
      }
      setQuote(res.data);
      if (!bookingPaid) await saveUnpaidChange(res.data);
      return;
    }

    // ── Bỏ món: tạo yêu cầu + áp dụng luôn, KHÔNG giữ chỗ / không panel xác
    // nhận lại. Bỏ món không cần đếm ngược nên khách xác nhận xong là về tab.
    setSubmitting(true);
    const res = await createBookingChangeRequest(bookingId, { type, incidents: incidentIds });
    if (!res.success || !res.data) {
      setSubmitting(false);
      setActionError(res.message ?? "Không thể tạo yêu cầu đổi. Vui lòng thử lại.");
      return;
    }
    const confirmed = await confirmBookingChangeRequest(bookingId, res.data.requestId);
    setSubmitting(false);
    if (!confirmed.success || !confirmed.data) {
      // Giữ panel báo giá trống (không setQuote) nhưng dọn yêu cầu đang chờ để
      // khách bấm lại từ đầu thay vì vướng lỗi "đang có yêu cầu chờ xử lý".
      await cancelBookingChangeRequest(bookingId, res.data.requestId);
      setActionError(confirmed.message ?? "Không thể xác nhận bỏ món. Vui lòng thử lại.");
      return;
    }
    const applied = confirmed.data;
    if (applied.status === "awaiting_payment") {
      if (applied.checkoutUrl) {
        window.location.href = applied.checkoutUrl;
        return;
      }
      goToChangePayment(res.data.requestId);
      return;
    }
    router.push("/dashboard/customer");
  }

  async function handleConfirm() {
    if (!quote) return;
    setActionError(null);
    setConfirming(true);
    const res = await confirmBookingChangeRequest(bookingId, quote.requestId);
    setConfirming(false);

    if (!res.success || !res.data) {
      setActionError(res.message ?? "Không thể xác nhận yêu cầu đổi.");
      return;
    }

    const result = res.data;
    if (result.status === "awaiting_payment") {
      // Backend đã tạo link PayOS: đưa khách sang thẳng cổng thanh toán, không
      // dừng ở trang "đang kiểm tra thanh toán" rồi bắt bấm thanh toán lần 2.
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      goToChangePayment(quote.requestId);
      return;
    }
    // Bỏ món áp dụng ngay (không giữ chỗ) → về thẳng đơn thuê của khách.
    if (quote.type === "remove") {
      router.push("/dashboard/customer");
      return;
    }
    router.push(`/booking/success?bookingId=${encodeURIComponent(bookingId)}`);
  }

  /**
   * Đưa khách sang trang thanh toán phần chênh. Trang đó tự cấp link PayOS mới
   * khi link cũ đã chết (khách huỷ trên cổng thanh toán) nên khách KHÔNG phải
   * huỷ yêu cầu để làm lại từ đầu.
   */
  function goToChangePayment(requestId: string) {
    router.push(
      `/booking/change-payment?requestId=${encodeURIComponent(requestId)}&bookingId=${encodeURIComponent(bookingId)}`,
    );
  }

  /**
   * Nút phụ ở panel báo giá.
   * - Bỏ món trong hạn giữ chỗ: KHÔNG có nút huỷ — khách xác nhận bỏ món luôn.
   *   (Đã gửi email thông báo bỏ món trước khi yêu cầu tới tay khách.)
   * - Các trường hợp còn lại: thực sự huỷ yêu cầu đang chờ để chọn lại.
   */
  async function handleReset() {
    if (!quote) return;
    setActionError(null);
    setResetting(true);
    await cancelBookingChangeRequest(bookingId, quote.requestId);
    setResetting(false);
    setQuote(null);
    setCountdown(0);
    await load();
  }

  async function handleCancelBooking() {
    setActionError(null);
    setSubmitting(true);
    const res = await cancelBooking(bookingId);
    setSubmitting(false);
    setConfirmCancelBooking(false);
    if (!res.success) {
      setActionError(res.message ?? "Không thể hủy đơn.");
      return;
    }
    router.push("/dashboard/customer");
  }

  // ── Quản lý: gửi đề xuất / bỏ món / huỷ đơn (một bề mặt duy nhất) ────────
  /**
   * Dựng payload `proposal` cho TOÀN BỘ sự cố đang mở của đơn. Trang này gộp
   * sự cố theo đơn; quản lý xử lý một lượt: chọn mẫu thay thế cho từng sự cố,
   * giữ/bỏ phụ kiện như checklist của khách, nhập lý do + tuỳ chọn email.
   */
  function buildManagerProposalPayload():
    | { ok: true; payload: ManagerIncidentActionPayload }
    | { ok: false; error: string } {
    if (!data) return { ok: false, error: "Chưa tải xong thông tin sự cố." };
    const trimmed = managerReason.trim();
    if (!trimmed) return { ok: false, error: "Vui lòng nhập lý do xử lý sự cố." };

    const incidentIds = data.incidents.map((incident) => incident.id);
    const replacing = garmentIncidents.length > 0 || replaceableAccessoryIncidents.length > 0;
    const payload: ManagerIncidentActionPayload = {
      action: "proposal",
      reason: trimmed,
      type: replacing ? "replace" : "remove",
      incidents: incidentIds,
      emailSubject: emailSubject.trim() || undefined,
      emailMessage: emailMessage.trim() || undefined,
    };

    if (garmentIncidents.length > 0) {
      if (!garmentsChosen) {
        return { ok: false, error: "Vui lòng chọn mẫu trang phục thay thế cho từng món bị sự cố." };
      }
      // Dùng lại đúng checklist phụ kiện của trang khách (giữ/bỏ/thêm).
      const checklist = buildReplacePayload();
      if (!checklist) {
        return { ok: false, error: "Chưa đủ dữ liệu để tính phương án đổi mẫu." };
      }
      payload.replacements = checklist.replacements;
      payload.removeAccessoryItemIds = checklist.removeAccessoryItemIds;
      payload.addAccessories = checklist.addAccessories;
      return { ok: true, payload };
    }

    if (replaceableAccessoryIncidents.length > 0) {
      const accessoryReplacements = replaceableAccessoryIncidents.map((incident) => ({
        incidentId: incident.id,
        accessoryId: selectedAccessoryModelByIncident[incident.id] || undefined,
      }));
      if (accessoryReplacements.some((row) => !row.accessoryId)) {
        return {
          ok: false,
          error:
            "Vui lòng chọn mẫu phụ kiện thay thế còn hàng. Nếu không có mẫu nào, hãy chọn “Bỏ món” hoặc “Huỷ đơn”.",
        };
      }
      payload.accessoryReplacements = accessoryReplacements;
      return { ok: true, payload };
    }

    return { ok: true, payload };
  }

  /**
   * Dựng bản xem trước email quản lý sắp gửi (không giữ chỗ / không tạo yêu cầu /
   * không gửi mail). Hỗ trợ 3 loại: đề xuất đổi mẫu, bỏ món, huỷ đơn.
   */
  async function handleManagerPreview(kind: "proposal" | "remove" | "cancel") {
    if (!data) return;
    const trimmed = managerReason.trim();
    if (!trimmed) {
      setManagerError("Vui lòng nhập lý do xử lý sự cố.");
      return;
    }
    const anchor = data.incidents[0]?.id;
    if (!anchor) {
      setManagerError("Đơn không còn sự cố nào để xem trước email.");
      return;
    }

    // Đổi loại email → bỏ tiêu đề/lời nhắn của bản xem trước trước đó, để mỗi
    // email dùng đúng tiêu đề mặc định của nó.
    const sameKind = emailPreviewKind === kind;
    const subject = sameKind ? emailSubject.trim() : "";
    const message = sameKind ? emailMessage.trim() : "";

    let payload: ManagerIncidentActionPayload;
    if (kind === "proposal") {
      const built = buildManagerProposalPayload();
      if (!built.ok) {
        setManagerError(built.error);
        return;
      }
      payload = built.payload;
    } else {
      payload = {
        action: "preview",
        reason: trimmed,
        previewAction: kind,
        incidents: data.incidents.map((incident) => incident.id),
      };
    }
    payload.emailSubject = subject || undefined;
    payload.emailMessage = message || undefined;

    setManagerPreviewing(true);
    setManagerError(null);
    setManagerSuccess(null);
    const res = await previewStaffIncidentEmail(anchor, payload);
    setManagerPreviewing(false);
    if (!res.success || !res.data) {
      setManagerError(res.message ?? "Không dựng được bản xem trước email.");
      return;
    }
    setEmailPreview({
      subject: res.data.emailSubject,
      html: res.data.emailHtml,
      recipient: res.data.emailRecipient,
    });
    setEmailPreviewKind(kind);
    setEmailSubject(res.data.emailSubject);
    setEmailMessage(message);
  }

  /**
   * Gửi thao tác thật của quản lý. `remove`/`cancel` phải qua hộp xác nhận.
   * Payload `proposal` KHÔNG chứa tiền — server tự tính báo giá + giữ chỗ 30 phút.
   */
  async function submitManagerAction(kind: "proposal" | "remove" | "cancel") {
    if (!data) return;
    const trimmed = managerReason.trim();
    if (!trimmed) {
      setManagerError("Vui lòng nhập lý do xử lý sự cố.");
      return;
    }
    if (kind !== "proposal" && managerPendingConfirm !== kind) {
      setManagerError("Vui lòng xác nhận thao tác trước khi tiếp tục.");
      return;
    }

    const anchor = data.incidents[0]?.id;
    if (!anchor) {
      setManagerError("Đơn không còn sự cố nào để xử lý.");
      return;
    }

    // Tiêu đề/lời nhắn quản lý sửa ở bản xem trước chỉ áp dụng cho đúng loại email.
    const emailOverrides =
      emailPreviewKind === kind
        ? {
            ...(emailSubject.trim() ? { emailSubject: emailSubject.trim() } : {}),
            ...(emailMessage.trim() ? { emailMessage: emailMessage.trim() } : {}),
          }
        : {};

    let payload: ManagerIncidentActionPayload;
    if (kind === "proposal") {
      const built = buildManagerProposalPayload();
      if (!built.ok) {
        setManagerError(built.error);
        return;
      }
      payload = { ...built.payload, ...emailOverrides };
    } else {
      // Trang này gộp sự cố theo ĐƠN: xử lý một lượt toàn bộ sự cố đang mở.
      payload = {
        action: kind,
        reason: trimmed,
        incidents: data.incidents.map((incident) => incident.id),
        ...emailOverrides,
      };
    }

    setManagerSubmitting(true);
    setManagerError(null);
    setManagerSuccess(null);
    const res = await applyStaffIncidentAction(anchor, payload);
    setManagerSubmitting(false);
    setManagerPendingConfirm(null);

    if (!res.success) {
      setManagerError(res.message ?? "Không thực hiện được thao tác.");
      return;
    }

    setManagerSuccess(
      kind === "proposal"
        ? "Đã gửi phương án cho khách xác nhận. Email đề xuất (kèm mẫu thay thế, giá và hạn giữ chỗ 30 phút) đã được gửi."
        : kind === "remove"
          ? "Đã bỏ món khỏi đơn. Email thông báo cho khách đã được gửi."
          : "Đã huỷ đơn. Email thông báo lý do và tiền hoàn (nếu có) đã gửi cho khách.",
    );
    setEmailPreview(null);
    setEmailPreviewKind(null);
    await load();
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-sand bg-white/80 p-12 text-center shadow-lg backdrop-blur">
          <Loader2 className="h-10 w-10 animate-spin text-lotus" />
          <p className="mt-4 text-sm text-stone-600">Đang tải thông tin sự cố...</p>
        </div>
      </Shell>
    );
  }

  if (loadError || !data) {
    return (
      <Shell>
        <div className="rounded-2xl border border-sand bg-white/80 p-10 text-center shadow-lg backdrop-blur">
          <XCircle className="mx-auto h-12 w-12 text-red-500" />
          <h1 className="mt-5 font-display text-3xl">Không tải được sự cố</h1>
          <p className="mt-3 text-sm text-stone-600">{loadError ?? "Liên kết không hợp lệ."}</p>
          <Link href={isManager ? "/dashboard/manager/incidents" : "/dashboard/customer"} className="mt-8 inline-flex rounded-xl bg-lotus px-6 py-3 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-oxblood">
            {isManager ? "Về danh sách sự cố" : "Về đơn thuê của tôi"}
          </Link>
        </div>
      </Shell>
    );
  }

  const bookingCode = `#${data.booking.id.slice(0, 8).toUpperCase()}`;
  const noIncidents = data.incidents.length === 0;
  const bookingStatus = STATUS_LABELS[data.booking.status];
  const refundEstimate = Math.max(0, data.booking.refundEstimate ?? 0);
  // Đơn chưa thanh toán → đổi mẫu chỉ "lưu đơn", không giữ chỗ/không thu chênh.
  const bookingPaid = Boolean(data.booking.paid);
  // Bỏ hết trang phục = huỷ đơn: panel xác nhận hiện tiền hoàn (nếu đã thanh
  // toán) thay vì bảng báo giá thuê/cọc vô nghĩa.
  const cancellingWholeBooking = Boolean(quote) && quote?.requiresHold === false && removingAllGarments;
  // Manager/Admin huỷ được cả đơn chưa thanh toán; khách chỉ huỷ trước khi xác nhận/thanh toán.
  const canCancelBooking = isManager
    ? STAFF_CANCELLABLE.has(data.booking.status)
    : CUSTOMER_CANCELLABLE.has(data.booking.status);

  return (
    <Shell>
      <Link href={isManager ? "/dashboard/manager/incidents" : "/dashboard/customer"} className="inline-flex items-center gap-1.5 text-sm text-stone-500 transition hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        {isManager ? "Về danh sách sự cố" : "Về đơn thuê của tôi"}
      </Link>

      <header className="mt-4 rounded-2xl border border-sand bg-white/85 p-6 shadow-lg backdrop-blur sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-antique">Sự cố đổi mẫu · Đơn {bookingCode}</p>
        <h1 className="mt-2 font-display text-3xl text-ink">
          {noIncidents ? "Đơn của bạn đã sẵn sàng" : "Cần thay đổi món trong đơn"}
        </h1>
        <p className="mt-2 text-sm leading-7 text-stone-600">
          {noIncidents
            ? `Không còn món nào cần đổi mẫu cho lịch thuê ${formatDate(data.booking.rentalStartDate)} – ${formatDate(data.booking.rentalEndDate)}. Nếu có món phải thay, cửa hàng đã tự đổi sang chiếc khác cùng size/mẫu — giá thuê không thay đổi.`
            : `Một số món không còn sẵn sàng cho lịch thuê ${formatDate(data.booking.rentalStartDate)} – ${formatDate(data.booking.rentalEndDate)}. Bạn có thể chọn mẫu khác, bỏ món hoặc huỷ đơn.`}
        </p>
        {bookingStatus ? (
          <span className={`mt-4 inline-block ${statusBadgeClass(bookingStatus.color)}`}>{bookingStatus.label}</span>
        ) : null}
      </header>

      {/* Manager cần liên hệ khách để báo lỗi → hiện đủ phone + email.
          Thiếu dữ liệu thì ghi “Chưa có”, tuyệt đối không tự bịa. */}
      {isManager ? (
        <section className="mt-5 rounded-2xl border border-sand bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-lotus" />
            <h2 className="font-display text-xl text-ink">Thông tin khách để liên hệ</h2>
          </div>
          <p className="mt-2 text-sm font-semibold text-ink">
            {data.booking.customer?.fullName?.trim() || "Chưa có họ tên"}
          </p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-lg border border-sand px-3 py-2">
              <Phone className="h-4 w-4 shrink-0 text-stone-400" />
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wider text-stone-400">Số điện thoại</dt>
                <dd className="truncate font-semibold text-ink">
                  {data.booking.customer?.phone?.trim() || "Chưa có"}
                </dd>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-sand px-3 py-2">
              <Mail className="h-4 w-4 shrink-0 text-stone-400" />
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wider text-stone-400">Email</dt>
                <dd className="truncate font-semibold text-ink">
                  {data.booking.customer?.email?.trim() || "Chưa có"}
                </dd>
              </div>
            </div>
          </dl>
        </section>
      ) : null}

      {noIncidents ? (
        <div className="mt-6 rounded-2xl border border-jade/30 bg-jade/5 p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-jade" />
          <p className="mt-3 text-sm text-jade">Không còn sự cố nào cần xử lý cho đơn này.</p>
        </div>
      ) : (
        <section className="mt-6 space-y-3">
          <h2 className="font-display text-2xl text-ink">Món bị ảnh hưởng</h2>
          {data.incidents.map((incident) => {
            const snapshot = incident.snapshot;
            return (
              <article key={incident.id} className="flex gap-4 rounded-xl border border-sand bg-white p-4 shadow-sm">
                {snapshot?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={snapshot.imageUrl} alt={snapshot.name ?? "Món bị sự cố"} className="h-20 w-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-mist text-stone-400">
                    {incident.itemKind === "garment" ? <Shirt className="h-6 w-6" /> : <PackageX className="h-6 w-6" />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{snapshot?.name ?? (incident.itemKind === "garment" ? "Trang phục" : "Phụ kiện")}</p>
                  {snapshot?.sizeLabel ? <p className="text-xs text-stone-500">Size {snapshot.sizeLabel}</p> : null}
                  {incident.itemKind === "accessory" ? (
                    <p className="text-xs text-stone-500">Số lượng gặp sự cố: {snapshot?.quantity ?? 1}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-stone-500">{incidentReasonText(incident)}</p>
                  {snapshot ? (
                    <p className="mt-2 text-sm text-stone-700">
                      Tiền thuê dòng này: <strong className="text-ink">{formatVND(snapshot.lineRental)}</strong>
                      {snapshot.estimated ? (
                        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">ước tính</span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {actionError ? (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {!noIncidents && !quote ? (
        <section className="mt-6 rounded-2xl border border-sand bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap gap-2">
            {([
              ...(canOfferReplace ? [{ key: "replace" as Tab, label: "Đổi mẫu" }] : []),
              { key: "remove" as Tab, label: "Bỏ món" },
              { key: "cancel" as Tab, label: "Huỷ đơn" },
            ] as Array<{ key: Tab; label: string }>).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key);
                  setActionError(null);
                }}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  visibleTab === item.key ? "bg-lotus text-white" : "border border-sand bg-white text-stone-600 hover:bg-mist"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {!canOfferReplace && accessoryIncidents.length > 0 ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Hiện chưa có mẫu phụ kiện khác còn hàng cho khoảng ngày này. Bạn có thể chọn “Bỏ món”.
            </p>
          ) : null}

          {isManager && visibleTab === "cancel" && managerError ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{managerError}</span>
            </div>
          ) : null}

          {isManager && visibleTab === "cancel" && managerSuccess ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-jade/30 bg-jade/5 px-4 py-3 text-sm text-jade">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{managerSuccess}</span>
            </div>
          ) : null}

          {visibleTab === "replace" ? (
            <div className="mt-5 space-y-5">
              {garmentIncidents.length > 0 ? (
                <>
                  <div>
                    <p className="text-sm font-semibold text-ink">Bước 1 · Chọn mẫu trang phục mới</p>
                    <p className="mt-1 text-xs text-stone-500">
                      Gợi ý cùng size và cùng loại với món bị sự cố. Bên dưới mỗi mẫu là phụ kiện đi kèm.
                    </p>
                  </div>
                  {garmentIncidents.map((incident) => {
                    const suggestion = suggestionByIncident.get(incident.id);
                    const options = suggestion?.itemKind === "garment" ? suggestion.options : [];
                    return (
                      <div key={incident.id} className="rounded-xl border border-sand bg-white/60 p-3">
                        <p className="text-sm font-semibold text-ink">
                          {incident.snapshot?.name ?? "Trang phục"}
                          {incident.snapshot?.sizeLabel ? ` · size ${incident.snapshot.sizeLabel}` : ""}
                        </p>
                        {options.length === 0 ? (
                          <p className="mt-2 text-sm text-stone-500">
                            Hiện chưa có mẫu thay thế cùng size/loại còn hàng. Bạn có thể chọn “Bỏ món”.
                          </p>
                        ) : (
                          <div className="-mx-1 mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
                            {options.map((option) => {
                              const checked = selectedSizeByIncident[incident.id] === option.sizeId;
                              return (
                                <label
                                  key={`${option.garmentId}-${option.sizeId}`}
                                  className={`flex w-[80%] min-w-[260px] shrink-0 snap-start cursor-pointer flex-col gap-2 rounded-xl border p-3 text-sm transition sm:w-[calc(50%-0.375rem)] ${
                                    checked ? "border-lotus bg-lotus/5" : "border-sand bg-white hover:bg-mist"
                                  }`}
                                >
                                  <span className="flex items-start gap-3">
                                    <input
                                      type="radio"
                                      name={`incident-${incident.id}`}
                                      value={option.sizeId}
                                      checked={checked}
                                      onChange={() =>
                                        setSelectedSizeByIncident((current) => ({
                                          ...current,
                                          [incident.id]: option.sizeId,
                                        }))
                                      }
                                      className="mt-1 h-4 w-4 text-lotus focus:ring-antique"
                                    />
                                    {option.imageUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={option.imageUrl}
                                        alt={option.name}
                                        className="h-24 w-20 shrink-0 rounded-lg object-cover"
                                      />
                                    ) : (
                                      <span className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg bg-mist text-stone-400">
                                        <Shirt className="h-6 w-6" />
                                      </span>
                                    )}
                                    <span className="min-w-0 flex-1">
                                      <span className="block font-semibold text-ink">{option.name}</span>
                                      <span className="mt-0.5 block text-xs text-stone-500">
                                        {option.sizeLabel ? `Size ${option.sizeLabel}` : "Cùng size"} · SL thuê 1
                                      </span>
                                      <span className="mt-1 block text-xs text-ink">
                                        Thuê {formatVND(option.dailyPrice)}/ngày
                                      </span>
                                      <span className="block text-xs text-stone-500">
                                        Cọc {formatVND(option.depositAmount)}
                                      </span>
                                    </span>
                                    {option.available <= 0 ? (
                                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                        Hết
                                      </span>
                                    ) : null}
                                  </span>
                                  {option.accessories.length > 0 ? (
                                    <span className="block rounded-lg bg-mist/60 p-2">
                                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                                        Phụ kiện đi kèm mẫu này
                                      </span>
                                      <span className="mt-1 block space-y-1">
                                        {option.accessories.map((accessory) => (
                                          <span
                                            key={accessory.accessoryId}
                                            className="flex items-center gap-2 text-xs text-stone-600"
                                          >
                                            {accessory.imageUrl ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                src={accessory.imageUrl}
                                                alt={accessory.name}
                                                className="h-8 w-8 shrink-0 rounded object-cover"
                                              />
                                            ) : (
                                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white text-stone-400">
                                                <PackageX className="h-4 w-4" />
                                              </span>
                                            )}
                                            <span className="min-w-0 flex-1 truncate">{accessory.name}</span>
                                            <span className={accessory.isIncluded ? "text-stone-500" : "text-ink"}>
                                              {accessory.isIncluded ? "kèm theo" : `+${formatVND(accessory.extraPrice)}/ngày`}
                                            </span>
                                            {accessory.maxQuantity <= 0 ? (
                                              <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                                Hết
                                              </span>
                                            ) : null}
                                          </span>
                                        ))}
                                      </span>
                                    </span>
                                  ) : null}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {garmentsChosen ? (
                    <div className="border-t border-sand pt-4">
                      <p className="text-sm font-semibold text-ink">Bước 2 · Phụ kiện trong đơn</p>
                      <p className="mt-1 text-xs text-stone-500">
                        Tăng/giảm số lượng để thuê, bỏ tích để bỏ mẫu. Số lượng lấy theo ô nhập (trống = 1,
                        nhập 0 = bỏ tích). Phụ kiện bị sự cố bắt buộc bỏ mẫu.
                      </p>
                      {accessoryGroups.length === 0 ? (
                        <p className="mt-2 text-sm text-stone-500">Đơn và mẫu mới không có phụ kiện nào.</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {accessoryGroups.map((group) => {
                            const quantity = accessoryQuantity(group);
                            const selected = quantity > 0;
                            const soldOut = !group.incidentOnly && group.maxQuantity <= 0;
                            return (
                              <div
                                key={group.accessoryId}
                                className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                                  group.incidentOnly
                                    ? "border-red-200 bg-red-50/60"
                                    : soldOut
                                      ? "border-sand bg-mist/40 opacity-70"
                                      : selected
                                        ? "border-lotus bg-lotus/5"
                                        : "border-sand bg-white"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`Chọn ${group.name}`}
                                  checked={selected}
                                  disabled={group.incidentOnly || soldOut}
                                  onChange={() => toggleAccessory(group)}
                                  className="h-4 w-4 shrink-0 rounded text-lotus focus:ring-antique disabled:opacity-40"
                                />
                                {group.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={group.imageUrl}
                                    alt={group.name}
                                    className="h-10 w-10 shrink-0 rounded object-cover"
                                  />
                                ) : (
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-mist text-stone-400">
                                    <PackageX className="h-4 w-4" />
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-ink">{group.name}</p>
                                  <p className="text-xs text-stone-500">
                                    {group.incidentOnly
                                      ? "Phụ kiện bị sự cố"
                                      : group.lines.length > 0
                                        ? `${group.unitIsIncluded ? "Đi kèm trang phục" : `Thuê ${formatVND(group.unitRentalTotal)}`} · SL thuê ${quantity}`
                                        : `${group.extraIncluded ? "Đi kèm mẫu mới" : `+${formatVND(group.extraPrice ?? 0)}/ngày`} · SL thuê ${quantity}`}
                                  </p>
                                </div>
                                {group.incidentOnly ? null : soldOut ? null : (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      aria-label={`Giảm ${group.name}`}
                                      onClick={() => setAccessoryQuantity(group, quantity - 1)}
                                      disabled={quantity <= 0}
                                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand text-lg text-stone-600 transition hover:bg-mist disabled:opacity-40"
                                    >
                                      −
                                    </button>
                                    <input
                                      type="number"
                                      aria-label={`Số lượng ${group.name}`}
                                      value={quantity}
                                      min={0}
                                      max={group.maxQuantity}
                                      onChange={(event) =>
                                        setAccessoryQuantity(
                                          group,
                                          event.target.value === "" ? 0 : Number(event.target.value),
                                        )
                                      }
                                      className="h-8 w-14 rounded-lg border border-sand text-center text-sm focus:border-lotus focus:outline-none"
                                    />
                                    <button
                                      type="button"
                                      aria-label={`Tăng ${group.name}`}
                                      onClick={() => setAccessoryQuantity(group, quantity + 1)}
                                      disabled={quantity >= group.maxQuantity}
                                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand text-lg text-stone-600 transition hover:bg-mist disabled:opacity-40"
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                                {group.incidentOnly ? (
                                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                    Bị sự cố · bỏ mẫu
                                  </span>
                                ) : soldOut ? (
                                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                    Hết
                                  </span>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-sand p-4 text-sm text-stone-500">
                      Chọn đủ mẫu trang phục để xem checklist phụ kiện của đơn.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {accessoryIncidents.length > replaceableAccessoryIncidents.length ? (
                    <p className="rounded-lg border border-dashed border-sand p-4 text-sm text-stone-500">
                      Phụ kiện không còn mẫu khác để đổi sẽ được bỏ khỏi đơn khi xác nhận.
                    </p>
                  ) : null}
                  {replaceableAccessoryIncidents.map((incident) => {
                  const suggestion = suggestionByIncident.get(incident.id);
                  const options = suggestion?.itemKind === "accessory" ? suggestion.options : [];
                  const accessoryName =
                    suggestion?.itemKind === "accessory" ? suggestion.name : incident.snapshot?.name ?? "Phụ kiện";
                  return (
                    <div key={incident.id}>
                      <p className="text-sm font-semibold text-ink">{accessoryName} · chọn mẫu phụ kiện khác</p>
                      {options.length === 0 ? (
                        <p className="mt-2 text-sm text-stone-500">
                          Hiện chưa có mẫu phụ kiện khác còn hàng cho khoảng ngày này. Bạn có thể chọn “Bỏ món”.
                        </p>
                      ) : (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {options.map((option) => {
                            const checked =
                              selectedAccessoryModelByIncident[incident.id] === option.accessoryId;
                            return (
                              <label
                                key={option.accessoryId}
                                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                                  checked ? "border-lotus bg-lotus/5" : "border-sand bg-white hover:bg-mist"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`accessory-${incident.id}`}
                                  value={option.accessoryId}
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedAccessoryModelByIncident((current) => ({
                                      ...current,
                                      [incident.id]: option.accessoryId,
                                    }))
                                  }
                                  className="h-4 w-4 text-lotus focus:ring-antique"
                                />
                                {option.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={option.imageUrl}
                                    alt={option.name}
                                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                                  />
                                ) : (
                                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-mist text-stone-400">
                                    <PackageX className="h-5 w-5" />
                                  </span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block font-medium text-ink">{option.name}</span>
                                  <span className="block text-xs text-stone-500">
                                    {option.isIncluded ? "Đi kèm trang phục" : `+${formatVND(option.extraPrice)}/ngày`} ·
                                    SL thuê 1
                                  </span>
                                </span>
                                {option.available <= 0 ? (
                                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                    Hết
                                  </span>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                </>
              )}

              <LiveQuotePanel
                previewing={previewing}
                liveQuote={liveQuote}
                error={liveQuoteError}
                emptyText="Chọn mẫu/ số lượng để xem báo giá cập nhật ngay."
              />

              <button
                type="button"
                onClick={() => void handleCreateChange("replace")}
                disabled={
                  isManager ||
                  submitting ||
                  (garmentIncidents.length > 0 && !garmentsChosen) ||
                  (garmentIncidents.length === 0 && accessoryIncidents.length === 0)
                }
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60 ${isManager ? "hidden" : ""}`}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {data.booking.paid ? "Giữ chỗ và thanh toán" : "Xác nhận đổi mẫu"}
              </button>
            </div>
          ) : null}

          {visibleTab === "remove" ? (
            <div className="mt-5 space-y-4">
              <p className="text-sm leading-7 text-stone-600">
                Bỏ các món bị sự cố khỏi đơn. Bấm xác nhận là cập nhật vào đơn ngay.
              </p>
              {removingAllGarments ? (
                <>
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Bỏ hết trang phục khỏi đơn nghĩa là đơn <strong>không còn trang phục nào</strong> để thuê.
                      Xác nhận bỏ món sẽ <strong>huỷ toàn bộ đơn</strong> và xử lý hoàn tiền theo chính sách cửa hàng.
                    </span>
                  </div>
                  {refundEstimate > 0 ? (
                    <div className="rounded-lg border border-jade/30 bg-jade/5 px-4 py-3 text-sm text-jade">
                      <p>
                        Số tiền hoàn dự kiến khi huỷ đơn:{" "}
                        <strong className="text-base">{formatVND(refundEstimate)}</strong>
                      </p>
                      <p className="mt-1 text-xs leading-6 text-stone-600">
                        Cửa hàng sẽ xác nhận và hoàn lại theo chính sách (chuyển khoản hoặc tiền mặt tại quầy).
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}
              {/* Bỏ món không giữ chỗ: bấm là tạo yêu cầu + áp dụng ngay. */}
              <button
                type="button"
                onClick={() => void handleCreateChange("remove")}
                disabled={isManager || submitting}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60 ${isManager ? "hidden" : ""}`}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {removingAllGarments ? "Xác nhận bỏ món và huỷ đơn" : "Xác nhận bỏ món"}
              </button>
            </div>
          ) : null}

          {visibleTab === "cancel" ? (
            <div className="mt-5 space-y-4">
              {canCancelBooking ? (
                <>
                  <p className="text-sm leading-7 text-stone-600">
                    {isManager
                      ? `Huỷ toàn bộ đơn ${bookingCode}. Quản lý được huỷ đơn trước bàn giao; đơn đã thanh toán sẽ được hoàn tiền theo chính sách.`
                      : `Huỷ toàn bộ đơn ${bookingCode}. Nếu đơn đã thanh toán, cửa hàng sẽ liên hệ xử lý hoàn tiền theo chính sách.`}
                  </p>
                  <label className="block text-xs font-semibold text-stone-600">
                    Lý do huỷ đơn {isManager ? "(bắt buộc)" : "(tuỳ chọn)"}
                    <textarea
                      value={isManager ? managerReason : cancelReason}
                      onChange={(event) =>
                        isManager ? setManagerReason(event.target.value) : setCancelReason(event.target.value)
                      }
                      rows={2}
                      maxLength={1000}
                      placeholder="Ví dụ: không còn mẫu thay thế, khách đồng ý huỷ..."
                      className="mt-1 w-full rounded-lg border border-sand px-3 py-2 text-sm font-normal text-ink focus:border-lotus focus:outline-none"
                    />
                  </label>
                  {isManager ? (
                    managerPendingConfirm === "cancel" ? (
                      <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-red-700">Xác nhận huỷ đơn và gửi email cho khách?</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setManagerPendingConfirm(null)}
                            className="rounded-lg border border-sand bg-white px-4 py-2 text-sm font-semibold text-stone-600"
                          >
                            Không
                          </button>
                          <button
                            type="button"
                            onClick={() => void submitManagerAction("cancel")}
                            disabled={managerSubmitting}
                            aria-label="Xác nhận huỷ đơn"
                            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                          >
                            {managerSubmitting ? "Đang xử lý..." : "Huỷ đơn"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => void handleManagerPreview("cancel")}
                            disabled={managerPreviewing || managerSubmitting}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-lotus px-5 py-3 text-xs font-semibold uppercase tracking-wider text-lotus transition hover:bg-lotus/5 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {managerPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                            Xem trước email
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!managerReason.trim()) {
                                setManagerError("Vui lòng nhập lý do huỷ đơn.");
                                return;
                              }
                              setManagerError(null);
                              setManagerPendingConfirm("cancel");
                            }}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                          >
                            <X className="h-4 w-4" />
                            Huỷ đơn thuê
                          </button>
                        </div>

                        {emailPreview && emailPreviewKind === "cancel" ? (
                          <ManagerEmailPreview
                            preview={emailPreview}
                            title="Xem trước email huỷ đơn"
                            subject={emailSubject}
                            message={emailMessage}
                            onSubjectChange={setEmailSubject}
                            onMessageChange={setEmailMessage}
                          />
                        ) : null}
                      </>
                    )
                  ) : confirmCancelBooking ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-semibold text-red-700">Xác nhận huỷ đơn thuê?</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCancelBooking(false)}
                          className="rounded-lg border border-sand bg-white px-4 py-2 text-sm font-semibold text-stone-600"
                        >
                          Không
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCancelBooking()}
                          disabled={submitting}
                          aria-label="Xác nhận huỷ đơn"
                          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                        >
                          Huỷ đơn
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmCancelBooking(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                    >
                      <X className="h-4 w-4" />
                      Huỷ đơn thuê
                    </button>
                  )}
                </>
              ) : (
                <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {isManager
                    ? "Đơn đã qua bàn giao nên không thể huỷ tại đây. Vui lòng xử lý hoàn đồ theo quy trình."
                    : "Đơn ở trạng thái này không thể tự huỷ. Vui lòng chọn đổi mẫu/bỏ món hoặc liên hệ cửa hàng."}
                </p>
              )}
            </div>
          ) : null}

          {isManager && visibleTab !== "cancel" ? (
            <div className="mt-5 space-y-4 border-t border-sand pt-5">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {visibleTab === "replace" ? "Gửi đề xuất đổi mẫu cho khách" : "Bỏ món và thông báo cho khách"}
                </p>
                <p className="mt-1 text-xs leading-6 text-stone-500">
                  {visibleTab === "replace"
                    ? "Khách sẽ nhận email kèm mẫu thay thế, giá chênh lệch và liên kết để xác nhận/thanh toán. Chỗ giữ 30 phút."
                    : "Món bị sự cố được bỏ khỏi đơn ngay khi xác nhận và khách nhận email thông báo. Bỏ hết trang phục thì đơn bị huỷ kèm tiền hoàn."}
                </p>
              </div>

              <label className="block text-xs font-semibold text-stone-600">
                Lý do xử lý (bắt buộc, hiển thị cho khách)
                <textarea
                  value={managerReason}
                  onChange={(event) => setManagerReason(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Ví dụ: mẫu này bị lỗi đường may, cửa hàng đã chuẩn bị mẫu tương đương..."
                  className="mt-1 w-full rounded-lg border border-sand px-3 py-2 text-sm font-normal text-ink focus:border-lotus focus:outline-none"
                />
              </label>

              {managerError ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{managerError}</span>
                </div>
              ) : null}

              {managerSuccess ? (
                <div className="flex items-start gap-2 rounded-lg border border-jade/30 bg-jade/5 px-4 py-3 text-sm text-jade">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{managerSuccess}</span>
                </div>
              ) : null}

              {visibleTab === "replace" ? (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void handleManagerPreview("proposal")}
                      disabled={managerPreviewing || managerSubmitting}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-lotus px-5 py-3 text-xs font-semibold uppercase tracking-wider text-lotus transition hover:bg-lotus/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {managerPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      Xem trước email
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitManagerAction("proposal")}
                      disabled={managerSubmitting}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-lotus px-5 py-3 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {managerSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Gửi đề xuất cho khách
                    </button>
                  </div>

                  {emailPreview && emailPreviewKind === "proposal" ? (
                    <ManagerEmailPreview
                      preview={emailPreview}
                      title="Xem trước email đề xuất"
                      subject={emailSubject}
                      message={emailMessage}
                      onSubjectChange={setEmailSubject}
                      onMessageChange={setEmailMessage}
                    />
                  ) : null}
                </>
              ) : managerPendingConfirm === "remove" ? (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-amber-800">
                    {removingAllGarments
                      ? "Bỏ hết trang phục sẽ huỷ đơn. Xác nhận và gửi email cho khách?"
                      : "Xác nhận bỏ các món bị sự cố và gửi email cho khách?"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setManagerPendingConfirm(null)}
                      className="rounded-lg border border-sand bg-white px-4 py-2 text-sm font-semibold text-stone-600"
                    >
                      Không
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitManagerAction("remove")}
                      disabled={managerSubmitting}
                      className="rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-60"
                    >
                      {managerSubmitting ? "Đang xử lý..." : "Xác nhận bỏ món"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void handleManagerPreview("remove")}
                      disabled={managerPreviewing || managerSubmitting}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-lotus px-5 py-3 text-xs font-semibold uppercase tracking-wider text-lotus transition hover:bg-lotus/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {managerPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      Xem trước email
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!managerReason.trim()) {
                          setManagerError("Vui lòng nhập lý do bỏ món.");
                          return;
                        }
                        setManagerError(null);
                        setManagerPendingConfirm("remove");
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-oxblood"
                    >
                      <PackageX className="h-4 w-4" />
                      {removingAllGarments ? "Bỏ món và huỷ đơn" : "Bỏ món và gửi email"}
                    </button>
                  </div>

                  {emailPreview && emailPreviewKind === "remove" ? (
                    <ManagerEmailPreview
                      preview={emailPreview}
                      title="Xem trước email bỏ món"
                      subject={emailSubject}
                      message={emailMessage}
                      onSubjectChange={setEmailSubject}
                      onMessageChange={setEmailMessage}
                    />
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {quote ? (
        <div className="fixed inset-x-0 bottom-0 z-40 sm:static sm:mt-6">
          <section className="max-h-[85vh] overflow-y-auto rounded-t-2xl border border-sand bg-white p-5 shadow-2xl sm:max-h-none sm:rounded-2xl sm:p-6 sm:shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-antique">
                  {quote.requiresHold ? "Báo giá đổi mẫu" : "Báo giá bỏ món"}
                </p>
                <h2 className="mt-1 font-display text-2xl text-ink">
                  {quote.status === "awaiting_payment" ? "Chờ thanh toán phần chênh" : "Xem lại thay đổi"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleReset()}
                disabled={resetting}
                className="rounded-full border border-sand p-2 text-stone-500 transition hover:bg-mist disabled:opacity-60"
                aria-label="Đóng báo giá"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {cancellingWholeBooking ? (
              refundEstimate > 0 ? (
                <div className="mt-4 rounded-lg border border-jade/30 bg-jade/5 px-4 py-3 text-sm text-jade">
                  <p>
                    Đơn sẽ bị huỷ toàn bộ. Số tiền hoàn dự kiến:{" "}
                    <strong className="text-base">{formatVND(refundEstimate)}</strong>
                  </p>
                  <p className="mt-1 text-xs leading-6 text-stone-600">
                    Cửa hàng sẽ xác nhận và hoàn lại theo chính sách (chuyển khoản hoặc tiền mặt tại quầy).
                  </p>
                </div>
              ) : (
                <p className="mt-4 rounded-lg border border-sand bg-mist/40 px-4 py-3 text-sm text-stone-600">
                  Đơn sẽ bị huỷ toàn bộ. Đơn chưa thanh toán nên không có khoản tiền hoàn.
                </p>
              )
            ) : (
              <QuoteBreakdown quote={quote} />
            )}

            {!quote.requiresHold && !cancellingWholeBooking ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-jade/30 bg-jade/5 px-4 py-3 text-sm text-jade">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Phần bỏ món đã được trừ vào báo giá. Xác nhận là cập nhật vào đơn ngay.</span>
              </div>
            ) : expired ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <TimerOff className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Giữ chỗ đã hết hạn. Vui lòng chọn lại mẫu để có báo giá mới.</span>
              </div>
            ) : (
              <div role="status" className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <Clock className="h-4 w-4 shrink-0" />
                <span>Giữ chỗ còn {formatCountdown(countdown)}</span>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              {isManager ? null : expired ? (
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={resetting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-oxblood disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" />
                  Chọn lại
                </button>
              ) : quote.status === "awaiting_payment" ? (
                // Đã ở bước chờ thanh toán phần chênh: nút dẫn về trang thanh
                // toán, nơi tự cấp link PayOS mới khi link cũ đã bị huỷ/hết hạn
                // — khách KHÔNG phải huỷ yêu cầu để làm lại từ đầu.
                <button
                  type="button"
                  onClick={() => goToChangePayment(quote.requestId)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-oxblood"
                >
                  Thanh toán phần chênh
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={confirming}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-lotus px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {!bookingPaid
                    ? cancellingWholeBooking
                      ? "Xác nhận và huỷ đơn"
                      : quote.requiresHold
                        ? "Xác nhận đổi mẫu"
                        : "Xác nhận bỏ món"
                    : quote.paymentRequired
                      ? "Xác nhận & thanh toán phần chênh"
                      : cancellingWholeBooking
                        ? "Xác nhận và huỷ đơn"
                        : quote.requiresHold
                          ? "Xác nhận thay đổi"
                          : "Xác nhận bỏ món"}
                </button>
              )}
              {quote.requiresHold ? (
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={resetting}
                  className="rounded-lg border border-sand px-6 py-3 text-sm font-semibold text-stone-600 transition hover:bg-mist disabled:opacity-60"
                >
                  Hủy yêu cầu này
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </Shell>
  );
}
