"use client";

import { useCallback, useEffect, useState } from "react";
import { StaffPortalShell } from "@/components/heritage/ui";
import { useRealtimeInvalidation } from "@/lib/use-realtime-invalidation";
import { uploadFile } from "@/lib/upload";
import {
  getStaffReturnBookings,
  getBookingInspections,
  createInspectionSession,
  addInspectionFinding,
  addInspectionPhoto,
  completeInspection,
  inspectBookingAccessory,
  type StaffBookingResponse,
  type InspectionSessionResponse,
  type BookingItem,
  type BookingAccessoryItem,
} from "@/lib/api";

// ── Helpers ──

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  returned:           { label: "Đã trả",         color: "bg-stone-100 text-stone-600" },
  inspection_pending: { label: "Chờ kiểm tra",   color: "bg-orange-100 text-orange-700" },
  overdue:            { label: "Quá hạn",        color: "bg-red-200 text-red-800" },
};

type ItemInspectionState = "missing_asset" | "not_started" | "in_progress" | "completed";

type AccInspectionState = "missing_asset" | "not_started" | "good" | "laundry" | "maintenance" | "damaged" | "lost";

const ACC_STATE_META: Record<AccInspectionState, { label: string; color: string; icon: string }> = {
  missing_asset: { label: "Chưa gán asset", color: "bg-red-100 text-red-700", icon: "warning" },
  not_started: { label: "Chưa kiểm tra", color: "bg-stone-100 text-stone-600", icon: "radio_button_unchecked" },
  good: { label: "Tốt", color: "bg-jade/10 text-jade", icon: "check_circle" },
  laundry: { label: "Cần giặt sấy", color: "bg-amber-100 text-amber-700", icon: "dry_cleaning" },
  maintenance: { label: "Cần bảo trì", color: "bg-orange-100 text-orange-700", icon: "build_circle" },
  damaged: { label: "Hư hỏng", color: "bg-red-100 text-red-700", icon: "error" },
  lost: { label: "Mất — đã tính đền", color: "bg-red-200 text-red-800", icon: "search_off" },
};

const ACC_CONDITION_OPTIONS = [
  { key: "good", label: "Tốt — sẵn sàng cho thuê lại" },
  { key: "laundry", label: "Cần giặt sấy" },
  { key: "maintenance", label: "Cần bảo trì" },
  { key: "damaged", label: "Hư hỏng — nhập phiếu phạt" },
  { key: "lost", label: "Mất — đền theo giá trị" },
] as const;

const ACC_INSPECTABLE_STATUSES = ["returned", "inspection_pending"];

const ITEM_STATE_META: Record<ItemInspectionState, { label: string; color: string; icon: string }> = {
  missing_asset: { label: "Chưa gán asset", color: "bg-red-100 text-red-700", icon: "warning" },
  not_started: { label: "Chưa kiểm tra", color: "bg-stone-100 text-stone-600", icon: "radio_button_unchecked" },
  in_progress: { label: "Đang kiểm tra", color: "bg-lotus/10 text-lotus", icon: "pending" },
  completed: { label: "Đã kiểm tra", color: "bg-jade/10 text-jade", icon: "check_circle" },
};

const FINAL_ACTIONS = [
  {
    key: "laundry",
    label: "Chuyển giặt sấy",
    style: "border border-bronze text-bronze hover:bg-parchment",
  },
  {
    key: "maintenance",
    label: "Cần bảo trì",
    style: "border border-orange-300 text-orange-700 hover:bg-orange-50",
  },
  {
    key: "damaged",
    label: "Ghi nhận hư hỏng",
    style: "border border-red-300 text-red-700 hover:bg-red-50",
  },
];

// ── Component ──

export default function StaffInspectionPage() {
  // Booking return queue
  const [bookings, setBookings] = useState<StaffBookingResponse[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected booking + inspection sessions
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<InspectionSessionResponse[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Inspection form state
  const [findingText, setFindingText] = useState("");
  const [findingPenalty, setFindingPenalty] = useState("");
  const [findingSeverity, setFindingSeverity] = useState("low");
  const [photoUrl, setPhotoUrl] = useState("");
  const [actioning, setActioning] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState("");

  // Accessory inspection form state (per accessory row)
  const [accInspect, setAccInspect] = useState<Record<string, { status: string; note: string; penalty: string; images: string[] }>>({});
  const [inspectingAcc, setInspectingAcc] = useState<string | null>(null);
  const [uploadingAccPhoto, setUploadingAccPhoto] = useState<string | null>(null);

  async function handleAccPhotoSelect(accId: string, files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    const form = accInspect[accId] ?? { status: "damaged", note: "", penalty: "", images: [] };
    if (form.images.length + list.length > 5) {
      setErrorMsg("Mỗi dòng phụ kiện tải tối đa 5 ảnh.");
      return;
    }
    setUploadingAccPhoto(accId);
    setErrorMsg(null);
    try {
      const uploaded: string[] = [];
      for (const file of list.slice(0, 5 - form.images.length)) {
        uploaded.push(await uploadFile(file, "handover"));
      }
      setAccInspect((prev) => {
        const current = prev[accId] ?? { status: "damaged", note: "", penalty: "", images: [] };
        return { ...prev, [accId]: { ...current, images: [...current.images, ...uploaded] } };
      });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Tải ảnh thất bại.");
    } finally {
      setUploadingAccPhoto(null);
    }
  }

  function getAccInspectionState(acc: BookingAccessoryItem): AccInspectionState {
    if (!acc.accessoryAssetId) return "missing_asset";
    if (acc.conditionStatus === "good") return "good";
    if (acc.conditionStatus === "laundry") return "laundry";
    if (acc.conditionStatus === "maintenance") return "maintenance";
    if (acc.conditionStatus === "damaged") return "damaged";
    if (acc.conditionStatus === "lost") return "lost";
    return "not_started";
  }

  // 1. Load return queue
  const refreshReturnBookings = useCallback(() => {
    return getStaffReturnBookings()
      .then((res) => {
        if (res.success && res.data) {
          const data = res.data;
          setBookings(data);
          if (data.length > 0) {
            setSelectedBookingId((prev) =>
              prev && data.some((b) => b.id === prev) ? prev : data[0].id,
            );
          } else {
            setSelectedBookingId(null);
          }
        } else {
          setErrorMsg(res.message ?? "Không thể tải danh sách đơn trả.");
        }
      })
      .finally(() => setLoadingBookings(false));
  }, []);

  useEffect(() => {
    setLoadingBookings(true);
    setErrorMsg(null);
    void refreshReturnBookings();
  }, [refreshReturnBookings]);

  // 2. Load inspection sessions when booking is selected
  const refreshSessions = useCallback((bookingId: string | null) => {
    if (!bookingId) {
      setSessions([]);
      return Promise.resolve();
    }
    return getBookingInspections(bookingId).then((res) => {
      if (res.success && res.data) setSessions(res.data);
      else setSessions([]);
    });
  }, []);

  useEffect(() => {
    setLoadingSessions(true);
    void refreshSessions(selectedBookingId).finally(() => setLoadingSessions(false));
  }, [selectedBookingId, refreshSessions]);

  const refreshAll = useCallback(() => {
    return refreshReturnBookings().then(() => refreshSessions(selectedBookingId));
  }, [refreshReturnBookings, refreshSessions, selectedBookingId]);

  useRealtimeInvalidation({
    bookings: refreshAll,
    inspections: refreshAll,
    assets: refreshReturnBookings,
    refunds: refreshReturnBookings,
    maintenance: refreshReturnBookings,
    laundry: refreshReturnBookings,
  });

  function getSessionForItem(item: BookingItem) {
    if (!item.garmentAssetId) return null;
    return sessions.find((s) => s.garmentAssetId === item.garmentAssetId) ?? null;
  }

  function getActiveSessionForItem(item: BookingItem) {
    const session = getSessionForItem(item);
    return session && session.status !== "completed" ? session : null;
  }

  function getItemInspectionState(item: BookingItem): ItemInspectionState {
    if (!item.garmentAssetId) return "missing_asset";
    const session = getSessionForItem(item);
    if (session?.status === "completed") return "completed";
    if (session) return "in_progress";
    return "not_started";
  }

  function clearItemForm() {
    setFindingText("");
    setFindingPenalty("");
    setFindingSeverity("low");
    setPhotoUrl("");
    setCurrentNote("");
  }

  function selectItem(itemId: string) {
    setSelectedItemId(itemId);
    clearItemForm();
  }

  function findNextInspectableItem(items: BookingItem[]) {
    return (
      items.find((item) => ["not_started", "in_progress"].includes(getItemInspectionState(item))) ??
      items.find((item) => getItemInspectionState(item) !== "missing_asset") ??
      items[0] ??
      null
    );
  }

  // Selected booking + selected item/session
  const booking = bookings.find((b) => b.id === selectedBookingId) ?? null;
  const selectedItem = booking?.items.find((item) => item.id === selectedItemId) ?? booking?.items[0] ?? null;
  const activeSession = selectedItem ? getActiveSessionForItem(selectedItem) : null;
  const selectedItemSession = selectedItem ? getSessionForItem(selectedItem) : null;
  const selectedItemState = selectedItem ? getItemInspectionState(selectedItem) : null;

  // ── Actions ──

  async function handleCreateSession() {
    if (!booking || !selectedItem?.garmentAssetId) return;
    setActioning("create");
    setErrorMsg(null);
    const res = await createInspectionSession({
      bookingId: booking.id,
      garmentAssetId: selectedItem.garmentAssetId,
    });
    setActioning(null);
    if (res.success && res.data) {
      setSessions((prev) => [res.data!, ...prev.filter((s) => s.id !== res.data!.id)]);
    } else {
      setErrorMsg(res.message ?? "Không thể tạo phiên kiểm tra.");
    }
  }

  async function handleAddFinding() {
    if (!activeSession || !findingText.trim()) return;
    setActioning("finding");
    setErrorMsg(null);
    const res = await addInspectionFinding(activeSession.id, {
      findingType: findingText.trim(),
      severity: findingSeverity,
      penaltyAmount: findingPenalty ? Number(findingPenalty) : 0,
    });
    setActioning(null);
    if (res.success && res.data) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, findings: [...s.findings, res.data!] }
            : s,
        ),
      );
      setFindingText("");
      setFindingPenalty("");
    } else {
      setErrorMsg(res.message ?? "Không thể thêm ghi nhận.");
    }
  }

  async function handleAddPhoto() {
    if (!activeSession || !photoUrl.trim()) return;
    setActioning("photo");
    setErrorMsg(null);
    const res = await addInspectionPhoto(activeSession.id, {
      imageUrl: photoUrl.trim(),
    });
    setActioning(null);
    if (res.success && res.data) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, photos: [...s.photos, res.data!] }
            : s,
        ),
      );
      setPhotoUrl("");
    } else {
      setErrorMsg(res.message ?? "Không thể thêm ảnh.");
    }
  }

  async function handleInspectAccessory(accId: string) {
    if (!booking) return;
    const form = accInspect[accId] ?? { status: "good", note: "", penalty: "", images: [] };
    setInspectingAcc(accId);
    setErrorMsg(null);
    const res = await inspectBookingAccessory(booking.id, accId, {
      conditionStatus: form.status as "good" | "laundry" | "maintenance" | "damaged" | "lost",
      note: form.note.trim() || undefined,
      // Hư hỏng: phiếu phạt staff nhập. Mất: backend tự lấy giá đền nên không gửi.
      penaltyAmount: form.status === "damaged" && form.penalty.trim() ? Number(form.penalty) : undefined,
      imageUrls: form.status === "damaged" && form.images.length > 0 ? form.images : undefined,
    });
    setInspectingAcc(null);
    if (res.success && res.data) {
      setAccInspect((prev) => {
        const next = { ...prev };
        delete next[accId];
        return next;
      });
      // Cập nhật badge ngay từ response để không nháy lại form trống
      // trong lúc chờ tải lại danh sách.
      const updatedAccessories = res.data.accessories ?? [];
      setBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id ? { ...b, accessories: updatedAccessories } : b,
        ),
      );
    } else {
      setErrorMsg(res.message ?? "Không thể ghi nhận kiểm tra phụ kiện.");
    }
  }

  async function handleComplete(finalAssetStatus: string) {    if (!activeSession) return;
    setActioning(`complete-${finalAssetStatus}`);
    setErrorMsg(null);
    const res = await completeInspection(activeSession.id, {
      finalAssetStatus,
      note: currentNote || undefined,
    });
    setActioning(null);
    if (res.success) {
      const currentBookingId = selectedBookingId;
      let refreshedSessions = sessions;
      if (currentBookingId) {
        const sessionsRes = await getBookingInspections(currentBookingId);
        if (sessionsRes.success && sessionsRes.data) {
          refreshedSessions = sessionsRes.data;
          setSessions(sessionsRes.data);
        }
      }
      clearItemForm();

      const queueRes = await getStaffReturnBookings();
      if (queueRes.success && queueRes.data) {
        setBookings(queueRes.data);
        const refreshedBooking = queueRes.data.find((b) => b.id === currentBookingId);
        if (refreshedBooking) {
          const nextItem =
            refreshedBooking.items.find((item) => {
              if (!item.garmentAssetId) return false;
              const session = refreshedSessions.find((s) => s.garmentAssetId === item.garmentAssetId);
              if (session?.status && session.status !== "completed") return true;
              if (session?.status === "completed") return false;
              return item.assetStatus === "inspection_pending";
            }) ?? refreshedBooking.items[0] ?? null;
          setSelectedItemId(nextItem?.id ?? null);
        } else {
          const nextBooking = queueRes.data[0] ?? null;
          setSelectedBookingId(nextBooking?.id ?? null);
          setSelectedItemId(nextBooking?.items[0]?.id ?? null);
        }
      }
    } else {
      setErrorMsg(res.message ?? "Không thể hoàn tất kiểm tra.");
    }
  }

  // Checklist progress
  const checklistItems = activeSession
    ? [
        {
          title: "Độ sạch bề mặt",
          description: "Kiểm tra vết bẩn, mùi lạ hoặc nước đọng trên các mảng lụa chính.",
        },
        {
          title: "Tình trạng thêu đính",
          description: "Xem kỹ chỉ kim tuyến, cổ áo và tay áo có bị bung hoặc xước hay không.",
        },
        {
          title: "Đường may & cấu trúc",
          description: "Kiểm tra nách, sườn áo và các điểm chịu lực có bị rách hay bai không.",
        },
        {
          title: "Phụ kiện đi kèm",
          description: "Xác nhận đủ khuy đồng, khăn đóng và chi tiết đi kèm như biên bản bàn giao.",
        },
      ]
    : [];

  const checklistDone = activeSession ? activeSession.findings.length : 0;

  useEffect(() => {
    if (!booking) {
      setSelectedItemId(null);
      return;
    }
    const currentItemExists = booking.items.some((item) => item.id === selectedItemId);
    if (!currentItemExists) {
      setSelectedItemId(findNextInspectableItem(booking.items)?.id ?? null);
    }
  }, [booking, selectedItemId, sessions]);

  // ── Render ──

  return (
    <StaffPortalShell
      active="inspection"
      title="Kiểm tra trang phục hoàn trả"
      subtitle="Hậu kiểm, ghi chú hư hỏng và điều hướng bộ đồ sang giặt sấy hoặc bảo trì."
    >
      {/* Error banner */}
      {errorMsg && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMsg}
          <button
            type="button"
            className="ml-4 underline"
            onClick={() => setErrorMsg(null)}
          >
            Đóng
          </button>
        </div>
      )}

      {loadingBookings ? (
        <div className="py-20 text-center text-stone-400">Đang tải danh sách đơn trả...</div>
      ) : bookings.length === 0 ? (
        <div className="py-20 text-center text-stone-400">
          Không có đơn nào đang chờ kiểm tra trả đồ.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* ── Left sidebar ── */}
          <aside className="space-y-6 lg:col-span-4">
            {/* Booking info */}
            <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
              <h2 className="mb-4 border-b border-sand pb-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                Chọn đơn cần kiểm tra
              </h2>

              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {bookings.map((b) => {
                  const s = STATUS_LABELS[b.status] ?? { label: b.status, color: "bg-stone-100 text-stone-600" };
                  const isActive = b.id === selectedBookingId;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBookingId(b.id)}
                      className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                        isActive
                          ? "border-lotus bg-parchment"
                          : "border-sand bg-white hover:bg-mist"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink">
                          #{b.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${s.color}`}>
                          {s.label}
                        </span>
                      </div>
                      <p className="mt-1 text-stone-500">
                        {b.customerName ?? "—"} · {b.items[0]?.garmentName ?? "—"}
                      </p>
                      <p className="text-xs text-stone-400">
                        Trả dự kiến: {formatDate(b.rentalEndDate)}
                      </p>
                    </button>
                  );
                })}
              </div>

              {booking && (
                <>
                  <div className="mt-4 border-t border-sand pt-4 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Mã đơn</span>
                      <span className="font-semibold text-ink">#{booking.id.slice(0, 8).toUpperCase()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Khách hàng</span>
                      <span className="font-medium text-ink">{booking.customerName ?? "—"}</span>
                    </div>
                    {booking.customerPhone && (
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500">SĐT</span>
                        <span className="font-medium text-ink">{booking.customerPhone}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">Ngày trả</span>
                      <span className="font-medium text-ink">{formatDate(booking.rentalEndDate)}</span>
                    </div>
                    {booking.penaltyTotal !== undefined && booking.penaltyTotal > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-stone-500">Phí phạt</span>
                        <span className="font-medium text-red-700">
                          {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(booking.penaltyTotal)}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* Items / assets */}
            {booking && (
              <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between border-b border-sand pb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Tài sản trong đơn
                  </h2>
                  <span className="text-xs text-stone-400">{booking.items.length} món</span>
                </div>
                <div className="space-y-2">
                  {booking.items.map((item, index) => {
                    const state = getItemInspectionState(item);
                    const meta = ITEM_STATE_META[state];
                    const isActive = item.id === selectedItem?.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectItem(item.id)}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          isActive
                            ? "border-lotus bg-parchment"
                            : "border-sand bg-white hover:bg-mist"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              #{index + 1} · {item.garmentName ?? "Trang phục"}
                            </p>
                            <p className="mt-1 text-xs text-stone-500">
                              {item.assetCode ? `Asset ID: ${item.assetCode}` : item.garmentAssetId ? "Asset: Đã gán" : "Chưa gán asset"}
                              {item.sizeLabel ? ` · Cỡ ${item.sizeLabel}` : ""}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.color}`}>
                            {meta.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Accessories */}
            {booking && (booking.accessories ?? []).length > 0 && (
              <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between border-b border-sand pb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Phụ kiện trong đơn
                  </h2>
                  <span className="text-xs text-stone-400">{(booking.accessories ?? []).length} món</span>
                </div>
                <div className="space-y-2">
                  {(booking.accessories ?? []).map((acc) => {
                    const state = getAccInspectionState(acc);
                    const meta = ACC_STATE_META[state];
                    const form = accInspect[acc.id] ?? { status: "good", note: "", penalty: "", images: [] };
                    const inspectable =
                      ACC_INSPECTABLE_STATUSES.includes(booking.status) &&
                      Boolean(acc.accessoryAssetId) &&
                      state === "not_started";
                    return (
                      <div key={acc.id} className="rounded-lg border border-sand bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              {acc.accessoryName ?? "Phụ kiện"}
                              {acc.quantity > 1 ? <span className="ml-1 text-stone-500">× {acc.quantity}</span> : null}
                            </p>
                            <p className="mt-1 text-xs text-stone-500">
                              {acc.assetCode ? `Asset: ${acc.assetCode}` : acc.accessoryAssetId ? "Asset: Đã gán" : "Chưa gán asset"}
                            </p>
                            {acc.conditionNote && (
                              <p className="mt-1 text-xs italic text-stone-500">Ghi chú: {acc.conditionNote}</p>
                            )}
                          </div>
                          <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.color}`}>
                            <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                            {meta.label}
                          </span>
                        </div>
                        {inspectable && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-sand pt-3">
                            <select
                              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-antique"
                              value={form.status}
                              onChange={(e) =>
                                setAccInspect((prev) => ({
                                  ...prev,
                                  [acc.id]: { ...form, status: e.target.value },
                                }))
                              }
                              aria-label="Tình trạng phụ kiện"
                            >
                              {ACC_CONDITION_OPTIONS.map((opt) => (
                                <option key={opt.key} value={opt.key}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <input
                              className="min-w-[160px] flex-1 rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
                              placeholder="Ghi chú (nếu có)..."
                              value={form.note}
                              onChange={(e) =>
                                setAccInspect((prev) => ({
                                  ...prev,
                                  [acc.id]: { ...form, note: e.target.value },
                                }))
                              }
                            />
                            {form.status === "damaged" && (
                              <input
                                className="w-40 rounded-lg border border-red-300 bg-red-50/50 px-3 py-2 text-sm outline-none focus:border-red-400"
                                placeholder="Phiếu phạt (VNĐ)..."
                                type="number"
                                min={0}
                                value={form.penalty}
                                onChange={(e) =>
                                  setAccInspect((prev) => ({
                                    ...prev,
                                    [acc.id]: { ...form, penalty: e.target.value },
                                  }))
                                }
                                aria-label="Phiếu phạt hư hỏng"
                              />
                            )}
                            {form.status === "lost" && (
                              <span className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                                Tự động đền{" "}
                                {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(acc.replacementValue ?? 0)}
                                {" "}— trừ vào cọc
                              </span>
                            )}
                            {form.status === "damaged" && (
                              <div className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-sand bg-mist p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="cursor-pointer rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-lotus transition hover:bg-parchment">
                                    {uploadingAccPhoto === acc.id ? "Đang tải..." : "+ Tải ảnh hư hỏng"}
                                    <input
                                      type="file"
                                      accept="image/jpeg,image/png,image/webp"
                                      multiple
                                      hidden
                                      disabled={uploadingAccPhoto === acc.id}
                                      onChange={(e) => {
                                        void handleAccPhotoSelect(acc.id, e.target.files);
                                        e.target.value = "";
                                      }}
                                    />
                                  </label>
                                  <span className="text-[11px] text-stone-500">
                                    Tối đa 5 ảnh ({form.images.length}/5)
                                  </span>
                                </div>
                                {form.images.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {form.images.map((url, idx) => (
                                      <div key={`${url}-${idx}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-sand">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={url} alt={`Ảnh hư hỏng ${idx + 1}`} className="h-full w-full object-cover" />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setAccInspect((prev) => {
                                              const current = prev[acc.id] ?? form;
                                              return {
                                                ...prev,
                                                [acc.id]: {
                                                  ...current,
                                                  images: current.images.filter((_, i) => i !== idx),
                                                },
                                              };
                                            })
                                          }
                                          className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1.5 text-xs leading-5 text-white"
                                          aria-label={`Xóa ảnh ${idx + 1}`}
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={inspectingAcc === acc.id}
                              onClick={() => handleInspectAccessory(acc.id)}
                              className="rounded-lg bg-jade px-4 py-2 text-sm font-semibold text-white transition hover:bg-forest disabled:opacity-50"
                            >
                              {inspectingAcc === acc.id ? "..." : "Xác nhận kiểm tra"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Selected asset info */}
            {selectedItem && (
              <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                <div className="flex gap-4">
                  {selectedItem.imageUrl ? (
                    <img
                      alt={selectedItem.garmentName ?? "Trang phục"}
                      src={selectedItem.imageUrl}
                      className="h-40 w-28 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-40 w-28 shrink-0 items-center justify-center rounded bg-parchment text-stone-400">
                      <span className="material-symbols-outlined text-4xl">checkroom</span>
                    </div>
                  )}
                  <div>
                    <h2 className="font-display text-xl text-ink sm:text-2xl">
                      {selectedItem.garmentName ?? "Trang phục"}
                    </h2>
                    {selectedItem.assetCode ? (
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-jade">
                        Asset ID: {selectedItem.assetCode}
                      </p>
                    ) : selectedItem.garmentAssetId ? (
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                        Asset: Đã gán
                      </p>
                    ) : (
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
                        Chưa gán tài sản
                      </p>
                    )}
                    {selectedItemState && (
                      <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${ITEM_STATE_META[selectedItemState].color}`}>
                        {ITEM_STATE_META[selectedItemState].label}
                      </span>
                    )}
                    {selectedItem.sizeLabel && (
                      <span className="ml-2 mt-3 inline-flex rounded-full bg-parchment px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink">
                        Cỡ {selectedItem.sizeLabel}
                      </span>
                    )}
                    {selectedItem.conditionNote && (
                      <p className="mt-2 text-xs text-stone-500">{selectedItem.conditionNote}</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Checklist */}
            {activeSession && checklistItems.length > 0 && (
              <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between border-b border-sand pb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Checklist kiểm tra
                  </h2>
                  <span className="text-sm text-stone-500">
                    {checklistDone}/{checklistItems.length} hoàn tất
                  </span>
                </div>
                <div className="space-y-4">
                  {checklistItems.map((item) => (
                    <label key={item.title} className="flex items-start gap-3">
                      <input
                        className="mt-1 h-5 w-5 rounded border-sand text-antique focus:ring-antique"
                        type="checkbox"
                        disabled
                      />
                      <div>
                        <p className="font-medium text-ink">{item.title}</p>
                        <p className="mt-1 text-sm leading-7 text-stone-600">{item.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            )}
          </aside>

          {/* ── Main content ── */}
          <div className="space-y-6 lg:col-span-8">
            {!activeSession && booking ? (
              /* No active session — prompt to start */
              <section className="rounded-xl border border-sand bg-white p-10 text-center shadow-sm">
                {selectedItemSession?.status === "completed" ? (
                  <>
                    <span className="material-symbols-outlined text-5xl text-jade">check_circle</span>
                    <h3 className="mt-4 font-display text-2xl text-ink">Món này đã kiểm tra xong</h3>
                    <p className="mt-2 text-stone-500">
                      Chọn món khác trong danh sách tài sản để tiếp tục kiểm tra đơn trả.
                    </p>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-5xl text-stone-300">search_check</span>
                    <h3 className="mt-4 font-display text-2xl text-ink">
                      Bắt đầu kiểm tra
                    </h3>
                    <p className="mt-2 text-stone-500">
                      {selectedItem?.garmentAssetId
                        ? "Tạo phiên kiểm tra cho món đang chọn để ghi nhận tình trạng trang phục."
                        : "Món đang chọn chưa được gán tài sản vật lý. Hãy gán asset trước khi kiểm tra."}
                    </p>
                    {selectedItem?.garmentAssetId ? (
                      <button
                        type="button"
                        disabled={actioning === "create"}
                        onClick={handleCreateSession}
                        className="mt-6 rounded-lg bg-lotus px-6 py-3 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
                      >
                        {actioning === "create" ? "Đang tạo..." : "Tạo phiên kiểm tra"}
                      </button>
                    ) : (
                      <div className="mt-6 space-y-3 rounded-lg border border-red-200 bg-red-50 p-5 text-left">
                        <div className="flex items-start gap-3">
                          <span className="material-symbols-outlined mt-0.5 text-red-500 text-xl">warning</span>
                          <div>
                            <h4 className="font-semibold text-red-700">Chưa gán tài sản vật lý</h4>
                            <p className="mt-1 text-sm leading-relaxed text-red-600">
                              Món này chưa có tài sản (asset) được gán. Việc gán asset phải được thực hiện ở bước{" "}
                              <strong>chuẩn bị đồ</strong> trước khi giao cho khách.
                            </p>
                            <p className="mt-2 text-sm text-red-600">
                              Vui lòng quay lại màn{" "}
                              <a
                                href="/dashboard/staff"
                                className="font-semibold underline underline-offset-2 hover:text-red-800"
                              >
                                Tổng quan
                              </a>
                              , chọn đơn này và báo quản lý gán asset cho item còn thiếu.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            ) : activeSession ? (
              <>
                {/* Condition assessment */}
                <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                  <h2 className="mb-6 border-b border-sand pb-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Đánh giá tình trạng
                  </h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    {[
                      {
                        key: "ok",
                        icon: "check_circle",
                        color: "text-jade",
                        bg: "bg-jade/5",
                        border: "border-jade",
                        title: "Không vấn đề",
                        desc: "Sẵn sàng cho làm sạch tiêu chuẩn",
                      },
                      {
                        key: "low",
                        icon: "build_circle",
                        color: "text-orange-700",
                        bg: "bg-lotus/5",
                        border: "border-orange-600",
                        title: "Mòn nhẹ",
                        desc: "Cần vá nhỏ hoặc xử lý điểm bẩn",
                      },
                      {
                        key: "high",
                        icon: "error",
                        color: "text-red-700",
                        bg: "bg-red-50",
                        border: "border-red-700",
                        title: "Hư hỏng nặng",
                        desc: "Cần chuyển phục hồi ngay",
                      },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          if (!findingText.trim()) {
                            setFindingText(
                              opt.key === "ok"
                                ? "Tình trạng tốt"
                                : opt.key === "low"
                                  ? "Mòn nhẹ / vết bẩn nhỏ"
                                  : "Hư hỏng nặng cần phục hồi",
                            );
                          }
                          if (opt.key === "low") setFindingSeverity("medium");
                          if (opt.key === "high") setFindingSeverity("high");
                        }}
                        className={`rounded-lg border border-sand ${opt.bg} p-4 text-center transition hover:${opt.border}`}
                      >
                        <span className={`material-symbols-outlined text-3xl ${opt.color}`}>
                          {opt.icon}
                        </span>
                        <h3 className="mt-2 font-semibold text-ink">{opt.title}</h3>
                        <p className="mt-1 text-sm text-stone-600">{opt.desc}</p>
                      </button>
                    ))}
                  </div>

                  <div className="mt-6">
                    <label className="mb-2 block text-sm font-semibold uppercase tracking-[0.16em] text-ink">
                      Ghi chú chi tiết
                    </label>
                    <textarea
                      className="h-32 w-full rounded-lg border border-sand bg-mist p-4 text-sm text-ink outline-none transition focus:border-antique"
                      placeholder="Mô tả vị trí sờn, vết bẩn hoặc phụ kiện thiếu..."
                      value={currentNote}
                      onChange={(e) => setCurrentNote(e.target.value)}
                    />
                  </div>

                  {/* Findings list */}
                  {activeSession.findings.length > 0 && (
                    <div className="mt-6 border-t border-sand pt-4">
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                        Ghi nhận đã lưu
                      </h3>
                      <div className="space-y-2">
                        {activeSession.findings.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center justify-between rounded-lg border border-sand bg-mist px-4 py-2 text-sm"
                          >
                            <div>
                              <span className="font-medium text-ink">{f.findingType}</span>
                              <span className="ml-2 text-xs text-stone-500">
                                ({f.severity})
                              </span>
                            </div>
                            {f.penaltyAmount > 0 && (
                              <span className="text-xs font-semibold text-red-700">
                                {new Intl.NumberFormat("vi-VN", {
                                  style: "currency",
                                  currency: "VND",
                                }).format(f.penaltyAmount)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick add finding */}
                  <div className="mt-4 flex flex-wrap gap-3 rounded-lg border border-dashed border-sand bg-mist p-4">
                    <input
                      className="min-w-[200px] flex-1 rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
                      placeholder="Loại lỗi / ghi nhận..."
                      value={findingText}
                      onChange={(e) => setFindingText(e.target.value)}
                    />
                    <select
                      className="rounded-lg border border-sand bg-white px-3 py-2 text-sm outline-none"
                      value={findingSeverity}
                      onChange={(e) => setFindingSeverity(e.target.value)}
                      aria-label="Mức độ"
                    >
                      <option value="low">Nhẹ</option>
                      <option value="medium">Trung bình</option>
                      <option value="high">Nặng</option>
                    </select>
                    <input
                      className="w-36 rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-antique"
                      placeholder="Phí phạt (VNĐ)"
                      type="number"
                      min={0}
                      value={findingPenalty}
                      onChange={(e) => setFindingPenalty(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={actioning === "finding" || !findingText.trim()}
                      onClick={handleAddFinding}
                      className="rounded-lg bg-lotus px-4 py-2 text-sm font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
                    >
                      {actioning === "finding" ? "..." : "Thêm ghi nhận"}
                    </button>
                  </div>
                </section>

                {/* Photos */}
                <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                  <div className="mb-6 flex items-center justify-between border-b border-sand pb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                      Bằng chứng hình ảnh
                    </h2>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {activeSession.photos.map((p) => (
                      <div
                        key={p.id}
                        className="overflow-hidden rounded-lg border border-sand bg-parchment"
                      >
                        <img
                          alt="Ảnh kiểm tra"
                          className="aspect-square w-full object-cover"
                          src={p.imageUrl}
                        />
                      </div>
                    ))}
                    {/* Add photo slot */}
                    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sand bg-mist p-3 text-center">
                      <input
                        className="w-full rounded border border-sand px-2 py-1 text-xs outline-none focus:border-antique"
                        placeholder="Dán URL ảnh..."
                        value={photoUrl}
                        onChange={(e) => setPhotoUrl(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={actioning === "photo" || !photoUrl.trim()}
                        onClick={handleAddPhoto}
                        className="rounded bg-lotus px-3 py-1 text-xs font-semibold text-white transition hover:bg-oxblood disabled:opacity-50"
                      >
                        {actioning === "photo" ? "..." : "Thêm"}
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 text-sm italic text-stone-500">
                    Hệ thống yêu cầu ít nhất một ảnh nếu đánh dấu &quot;Mòn nhẹ&quot; hoặc &quot;Hư hỏng nặng&quot;.
                  </p>
                </section>

                {/* Actions bar */}
                <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 rounded-xl border border-sand bg-white/95 p-4 shadow-sm backdrop-blur">
                  {FINAL_ACTIONS.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      disabled={actioning !== null}
                      onClick={() => handleComplete(action.key)}
                      className={`rounded-lg px-5 py-3 text-sm font-semibold transition disabled:opacity-50 ${action.style}`}
                    >
                      {actioning === `complete-${action.key}` ? "Đang xử lý..." : action.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </StaffPortalShell>
  );
}
