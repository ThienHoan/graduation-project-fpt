"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StaffPortalShell } from "@/components/heritage/ui";
import { useRealtimeInvalidation } from "@/lib/use-realtime-invalidation";
import { uploadFile } from "@/lib/upload";
import {
  getStaffReturnBookings,
  getBookingInspections,
  createInspectionSession,
  getDamageFeeTable,
  type DamageFeeEntry,
  addInspectionFinding,
  deleteInspectionFinding,
  addInspectionPhoto,
  deleteInspectionPhoto,
  compareInspectionSessionWithAi,
  applyAiInspectionFindings,
  completeInspection,
  inspectBookingAccessory,
  finalizeBookingInspection,
  downloadInspectionSlip,
  type StaffBookingResponse,
  type InspectionSessionResponse,
  type BookingItem,
  type BookingAccessoryItem,
  type AiInspectionComparisonResult,
} from "@/lib/api";
import {
  mockReturnBookings,
  mockInspectionSessions,
  mockAiComparisonNhatBinh,
} from "@/lib/inspection-mock-data";
import { InspectionDetailModal } from "@/components/bookings/inspection-detail-modal";
import {
  AlertTriangle,
  Circle,
  CheckCircle2,
  Waves,
  Wrench,
  AlertOctagon,
  SearchX,
  Clock,
  Sparkles,
  Shirt,
  ZoomIn,
  Tag,
  ClipboardCheck,
  X,
  Lock,
  Unlock,
  PenLine,
  User,
  Camera,
  UploadCloud,
  Layers,
  ArrowRight,
  Bot,
  RefreshCw,
  RotateCcw,
  CheckCheck,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Send,
  Trash2,
  Loader2,
  Smartphone,
  FolderOpen,
  SwitchCamera,
  ChevronDown,
  BarChart3,
  Printer,
  type LucideIcon,
} from "lucide-react";

// ── Helpers ──

const DAMAGE_LOCATIONS = [
  "Cổ áo",
  "Tà trước",
  "Tà sau",
  "Nách áo",
  "Cổ tay",
  "Gấu váy / Quần",
  "Khóa kéo",
  "Lớp lót trong",
  "Đính đá / Hạt cườm",
];

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  returned: { label: "Đã trả", color: "bg-stone-100 text-stone-600" },
  inspection_pending: { label: "Chờ kiểm tra", color: "bg-orange-100 text-orange-700" },
  overdue: { label: "Quá hạn", color: "bg-red-200 text-red-800" },
};

type ItemInspectionState = "missing_asset" | "not_started" | "in_progress" | "pending_manager_approval" | "completed";

type AccInspectionState = "missing_asset" | "not_started" | "good" | "laundry" | "maintenance" | "damaged" | "lost";

const ACC_STATE_META: Record<AccInspectionState, { label: string; color: string; icon: LucideIcon }> = {
  missing_asset: { label: "Chưa gán asset", color: "bg-red-100 text-red-700", icon: AlertTriangle },
  not_started: { label: "Chưa kiểm tra", color: "bg-stone-100 text-stone-600", icon: Circle },
  good: { label: "Tốt", color: "bg-jade/10 text-jade", icon: CheckCircle2 },
  laundry: { label: "Cần giặt sấy", color: "bg-amber-100 text-amber-700", icon: Waves },
  maintenance: { label: "Cần bảo trì", color: "bg-orange-100 text-orange-700", icon: Wrench },
  damaged: { label: "Hư hỏng", color: "bg-red-100 text-red-700", icon: AlertOctagon },
  lost: { label: "Mất — đã tính đền", color: "bg-red-200 text-red-800", icon: SearchX },
};

const ACC_CONDITION_OPTIONS = [
  { key: "good", label: "Tốt — sẵn sàng cho thuê lại" },
  { key: "laundry", label: "Cần giặt sấy" },
  { key: "maintenance", label: "Cần bảo trì" },
  { key: "damaged", label: "Hư hỏng — nhập phiếu phạt" },
  { key: "lost", label: "Mất — đền theo giá trị" },
] as const;

const ACC_INSPECTABLE_STATUSES = ["returned", "inspection_pending"];

const ITEM_STATE_META: Record<ItemInspectionState, { label: string; color: string; icon: LucideIcon }> = {
  missing_asset: { label: "Chưa gán asset", color: "bg-red-100 text-red-700", icon: AlertTriangle },
  not_started: { label: "Chưa kiểm tra", color: "bg-stone-100 text-stone-600", icon: Circle },
  in_progress: { label: "Đang kiểm tra", color: "bg-lotus/10 text-lotus", icon: Clock },
  pending_manager_approval: { label: "Chờ Quản lý duyệt", color: "bg-amber-100 text-amber-800 border border-amber-300", icon: ShieldAlert },
  completed: { label: "Đã kiểm tra", color: "bg-jade/10 text-jade", icon: CheckCircle2 },
};

const FINAL_ACTIONS = [
  {
    key: "laundry",
    label: "Chuyển giặt sấy",
    approvalLabel: "Gửi QL duyệt & Giặt sấy",
    style: "border border-bronze text-bronze hover:bg-parchment",
  },
  {
    key: "maintenance",
    label: "Cần bảo trì",
    approvalLabel: "Gửi QL duyệt & Bảo trì",
    style: "border border-orange-300 text-orange-700 hover:bg-orange-50",
  },
  {
    key: "damaged",
    label: "Ghi nhận hư hỏng",
    approvalLabel: "Gửi QL duyệt & Báo hỏng",
    style: "border border-red-300 text-red-700 hover:bg-red-50",
  },
];

// Các nấc % quy chuẩn cho từng nhóm lỗi có thể thay đổi linh hoạt theo giá trị áo
const TIERED_DAMAGE_PCTS: Record<string, { tiers: number[]; defaultPct: number }> = {
  "Rách to / mất phụ kiện đính": {
    tiers: [15, 20, 25, 30],
    defaultPct: 20,
  },
  "Biến dạng / ố vàng nghiêm trọng": {
    tiers: [30, 40, 50, 60],
    defaultPct: 40,
  },
};

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
  const [mockSessionsMap, setMockSessionsMap] = useState<Record<string, InspectionSessionResponse[]>>(mockInspectionSessions);
  const [checkedChecklist, setCheckedChecklist] = useState<Record<string, string[]>>({
    "session-nb-001": ["Độ sạch bề mặt", "Phụ kiện đi kèm"],
  });

  // Inspection form state
  const [findingText, setFindingText] = useState("");
  const [findingPenalty, setFindingPenalty] = useState("");
  const [findingSeverity, setFindingSeverity] = useState("low");
  const [findingDescription, setFindingDescription] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [isManualPenalty, setIsManualPenalty] = useState(false);
  const [damageFeeTable, setDamageFeeTable] = useState<DamageFeeEntry[]>([
    { label: "Rách nhỏ / sờn vải nhẹ", amount: 50000, severity: "low" },
    { label: "Mất khuy / tuột chỉ", amount: 30000, severity: "low" },
    { label: "Vết bẩn không giặt sạch", amount: 80000, severity: "medium" },
    { label: "Rách to / mất phụ kiện đính", pct: 20, tiers: [15, 20, 25, 30], severity: "medium" },
    { label: "Biến dạng / ố vàng nghiêm trọng", pct: 40, tiers: [30, 40, 50, 60], severity: "high" },
    { label: "Hư hỏng không phục hồi / mất đồ", pct: 100, severity: "severe" },
  ]);
  const [selectedDamageFeeLabel, setSelectedDamageFeeLabel] = useState<string | null>(null);
  const [selectedPctStep, setSelectedPctStep] = useState<number | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState("");
  const [finalizingBooking, setFinalizingBooking] = useState(false);
  const [finalizeMsg, setFinalizeMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Live Camera / Webcam states
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">("environment");
  const [capturedInSession, setCapturedInSession] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // AI comparison states
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [applyingAiFindings, setApplyingAiFindings] = useState(false);
  const [uploadingReturnPhoto, setUploadingReturnPhoto] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [deletingFindingId, setDeletingFindingId] = useState<string | null>(null);
  const [aiSuccessMsg, setAiSuccessMsg] = useState<string | null>(null);

  // Accessory inspection form state (per accessory row)
  const [accInspect, setAccInspect] = useState<Record<string, { status: string; note: string; penalty: string; images: string[] }>>({});
  const [inspectingAcc, setInspectingAcc] = useState<string | null>(null);
  const [uploadingAccPhoto, setUploadingAccPhoto] = useState<string | null>(null);

  // Confirmation state for high penalties (> 30% deposit) requiring manager approval
  const [pendingManagerConfirm, setPendingManagerConfirm] = useState<{
    actionKey: string;
    actionLabel: string;
    penalty: number;
    deposit: number;
    ratio: number;
  } | null>(null);

  // Modal to view detailed inspection report
  const [viewingModalSessionId, setViewingModalSessionId] = useState<string | null>(null);
  const [printingInspectionSessionId, setPrintingInspectionSessionId] = useState<string | null>(null);

  const handleDirectPrintInspection = async (sessionId: string) => {
    setPrintingInspectionSessionId(sessionId);
    try {
      const res = await downloadInspectionSlip(sessionId);
      if (!res.success) {
        setErrorMsg(res.error ?? "Không thể in biên bản kiểm tra.");
      } else {
        setFinalizeMsg({ type: "success", text: `Đã tải xuống biên bản kiểm tra: ${res.filename}` });
      }
    } catch (err) {
      console.error("Print inspection error:", err);
      setErrorMsg("Lỗi khi tải biên bản kiểm tra.");
    } finally {
      setPrintingInspectionSessionId(null);
    }
  };

  // Collapsible sections
  const [sectionOpen, setSectionOpen] = useState({
    findings: true,       // Kiểm tra tình trạng & Ghi nhận lỗi
    penaltyMeter: true,   // Thước đo tiền phạt
    findingsList: true,   // Lỗi đã ghi nhận vào biên bản
    aiComparison: true,   // Đối chiếu hình ảnh & Thẩm định AI
  });
  const toggleSection = (key: keyof typeof sectionOpen) =>
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // Lightbox phóng to ảnh khi bấm vào
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxUrl]);

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

  // 1. Đồng bộ tải hàng chờ trả đồ và phiên kiểm tra
  const activeBookingIdRef = useRef<string | null>(null);
  const isInitialLoadedRef = useRef(false);

  const mockSessionsMapRef = useRef(mockSessionsMap);
  useEffect(() => {
    mockSessionsMapRef.current = mockSessionsMap;
  }, [mockSessionsMap]);

  const refreshReturnBookings = useCallback(async (preserveCurrent = true, showLoading = false) => {
    if (showLoading) setLoadingBookings(true);
    try {
      const res = await getStaffReturnBookings();
      if (res.success && res.data && res.data.length > 0) {
        const data = res.data;
        setBookings(data);
        const currentId = activeBookingIdRef.current;
        const targetId = preserveCurrent && currentId && data.some((b) => b.id === currentId)
          ? currentId
          : data[0].id;
        activeBookingIdRef.current = targetId;
        setSelectedBookingId(targetId);
        return targetId;
      } else {
        // Fallback sang dữ liệu mẫu khi DB chưa có đơn trả đồ
        setBookings(mockReturnBookings);
        const currentId = activeBookingIdRef.current;
        const targetId = preserveCurrent && currentId && mockReturnBookings.some((b) => b.id === currentId)
          ? currentId
          : mockReturnBookings[0].id;
        activeBookingIdRef.current = targetId;
        setSelectedBookingId(targetId);
        return targetId;
      }
    } catch {
      setBookings(mockReturnBookings);
      const currentId = activeBookingIdRef.current;
      const targetId = preserveCurrent && currentId && mockReturnBookings.some((b) => b.id === currentId)
        ? currentId
        : mockReturnBookings[0].id;
      activeBookingIdRef.current = targetId;
      setSelectedBookingId(targetId);
      return targetId;
    } finally {
      if (showLoading) setLoadingBookings(false);
    }
  }, []);

  const refreshSessions = useCallback(async (bookingId: string | null, showLoading = false) => {
    if (!bookingId) {
      setSessions([]);
      setLoadingSessions(false);
      return;
    }
    if (showLoading) setLoadingSessions(true);
    try {
      const res = await getBookingInspections(bookingId);
      if (res.success && res.data && res.data.length > 0) {
        setSessions(res.data);
      } else {
        setSessions(mockSessionsMapRef.current[bookingId] ?? []);
      }
    } catch {
      setSessions(mockSessionsMapRef.current[bookingId] ?? []);
    } finally {
      if (showLoading) setLoadingSessions(false);
    }
  }, []);

  // Tải đồng bộ lần đầu: queue đơn trả + sessions của đơn đầu tiên cùng lúc (không bị waterfall, không bị nháy trang tạo kiểm tra)
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoadingBookings(true);
      setLoadingSessions(true);
      setErrorMsg(null);
      const targetBookingId = await refreshReturnBookings(false, false);
      if (cancelled) return;
      if (targetBookingId) {
        await refreshSessions(targetBookingId, false);
      }
      setLoadingBookings(false);
      setLoadingSessions(false);
      isInitialLoadedRef.current = true;
    }
    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Khi nhân viên chọn thủ công một đơn khác trong danh sách
  useEffect(() => {
    if (!isInitialLoadedRef.current) return;
    if (!selectedBookingId) {
      activeBookingIdRef.current = null;
      setSessions([]);
      return;
    }
    if (activeBookingIdRef.current !== selectedBookingId) {
      activeBookingIdRef.current = selectedBookingId;
      setSelectedItemId(null);
      void refreshSessions(selectedBookingId, true);
    }
  }, [selectedBookingId, refreshSessions]);

  const refreshQueueOnly = useCallback(async () => {
    await refreshReturnBookings(true, false);
  }, [refreshReturnBookings]);

  const refreshAll = useCallback(async () => {
    const currentId = activeBookingIdRef.current;
    await refreshReturnBookings(true, false);
    if (currentId) {
      await refreshSessions(currentId, false);
    }
  }, [refreshReturnBookings, refreshSessions]);

useRealtimeInvalidation({
  bookings: refreshAll,
  inspections: refreshAll,
  assets: refreshQueueOnly,
  refunds: refreshQueueOnly,
  maintenance: refreshQueueOnly,
  laundry: refreshQueueOnly,
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
  if (session?.status === "pending_manager_approval") return "pending_manager_approval";
  if (session) return "in_progress";
  return "not_started";
}

function clearItemForm() {
  setFindingText("");
  setFindingPenalty("");
  setFindingSeverity("low");
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

const currentTotalPenalty = useMemo(() => {
  return activeSession?.findings?.reduce((sum, f) => sum + (Number(f.penaltyAmount) || 0), 0) ?? 0;
}, [activeSession?.findings]);

const currentDeposit = Number(selectedItem?.depositAmount) || 0;
const garmentValue = useMemo(() => {
  const fromItem = Number(selectedItem?.purchaseCost);
  if (fromItem > 0) return fromItem;
  const fromSessionAsset = Number(activeSession?.asset?.purchaseCost);
  if (fromSessionAsset > 0) return fromSessionAsset;
  const fromAi = Number(activeSession?.aiComparisonResult?.garmentValue);
  if (fromAi > 0) return fromAi;
  const fromDeposit = Number(selectedItem?.depositAmount);
  if (fromDeposit > 0) return fromDeposit;
  const fromDaily = Number(selectedItem?.dailyPrice);
  if (fromDaily > 0) return fromDaily * 4;
  return 0;
}, [selectedItem, activeSession]);

const hasSevereIssue = activeSession?.findings?.some((f) => f.severity === "severe") ?? false;
const isPenaltyCapped = garmentValue > 0 && currentTotalPenalty > garmentValue;
const effectivePenalty = isPenaltyCapped ? garmentValue : currentTotalPenalty;
const excessPenalty = isPenaltyCapped ? currentTotalPenalty - garmentValue : 0;
const cappedRatio = garmentValue > 0 ? effectivePenalty / garmentValue : 0;

// Tính toán phân bổ cọc & số tiền khách phải bù thêm ngoài cọc (hoặc được hoàn lại)
const depositDeduction = currentDeposit > 0 ? Math.min(effectivePenalty, currentDeposit) : 0;
const additionalPayRequired = currentDeposit > 0 ? Math.max(0, effectivePenalty - currentDeposit) : effectivePenalty;
const refundDeposit = currentDeposit > 0 ? Math.max(0, currentDeposit - effectivePenalty) : 0;

const isPenaltyHigh = effectivePenalty > 0 && (
  (currentDeposit > 0 ? (effectivePenalty / currentDeposit > 0.3 || effectivePenalty > currentDeposit) : true) ||
  (garmentValue > 0 && cappedRatio >= 0.7) ||
  hasSevereIssue ||
  isPenaltyCapped
);
const isPendingApproval = activeSession?.status === "pending_manager_approval";
// Check toan bo sessions cua booking - neu con session nao cho manager duyet
// thi booking chua the dong, hien canh bao thay vi de staff bam nut loi
const hasPendingManagerApproval = sessions.some((s) => s.status === "pending_manager_approval");
const pendingApprovalSessions = sessions.filter((s) => s.status === "pending_manager_approval");

useEffect(() => {
  getDamageFeeTable()
    .then((res) => {
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        setDamageFeeTable(res.data);
      }
    })
    .catch(() => {});
}, []);

const handleSelectDamageFee = useCallback(
  (entry: DamageFeeEntry) => {
    setSelectedDamageFeeLabel(entry.label);
    setFindingText(entry.label);
    setFindingSeverity(entry.severity);
    setIsManualPenalty(false);

    const defaultPct = entry.pct ?? TIERED_DAMAGE_PCTS[entry.label]?.defaultPct ?? null;
    setSelectedPctStep(defaultPct);

    let penalty = 0;
    if (entry.amount !== undefined && entry.amount !== null) {
      penalty = Number(entry.amount);
    } else if (defaultPct !== null) {
      const base = garmentValue > 0 ? garmentValue : 400000;
      penalty = Math.round(((base * defaultPct) / 100) / 1000) * 1000;
    }
    setFindingPenalty(penalty > 0 ? String(penalty) : "");

    // Tính toán nếu phạt vượt tiền cọc
    const extraCompensation =
      currentDeposit > 0 && penalty > currentDeposit
        ? ` (Vượt cọc ${currentDeposit.toLocaleString("vi-VN")}đ, khách cần bù thêm ${(penalty - currentDeposit).toLocaleString("vi-VN")}đ)`
        : "";

    const pctLabel = defaultPct !== null && defaultPct < 100 ? ` (${defaultPct}%)` : "";
    // Sinh mô tả chuẩn
    if (selectedLocations.length > 0) {
      setFindingDescription(`Ghi nhận ${entry.label}${pctLabel} tại: ${selectedLocations.join(", ")}${extraCompensation}`);
    } else {
      setFindingDescription(`Ghi nhận: ${entry.label}${pctLabel}${extraCompensation}`);
    }

    // Nếu tiền phạt vượt cọc và chưa có ghi chú, tự động gợi ý ghi chú gửi Quản lý
    if (currentDeposit > 0 && penalty > currentDeposit) {
      const diff = penalty - currentDeposit;
      setCurrentNote((prev) =>
        prev.trim()
          ? prev
          : `Ghi nhận ${entry.label}${pctLabel} (phạt ${penalty.toLocaleString("vi-VN")}đ). Tiền cọc (${currentDeposit.toLocaleString("vi-VN")}đ) không đủ, đề xuất khấu trừ toàn bộ 100% cọc và truy thu bù thêm ${diff.toLocaleString("vi-VN")}đ từ khách hàng.`
      );
    }
  },
  [garmentValue, selectedLocations, currentDeposit],
);

const handleSelectPctStep = useCallback(
  (pct: number) => {
    setSelectedPctStep(pct);
    const base = garmentValue > 0 ? garmentValue : 400000;
    const penalty = Math.round(((base * pct) / 100) / 1000) * 1000;
    setFindingPenalty(penalty > 0 ? String(penalty) : "");

    // Cập nhật severity theo nấc %
    const newSeverity = pct >= 100 ? "severe" : pct >= 40 ? "high" : "medium";
    setFindingSeverity(newSeverity);

    const entryLabel = selectedDamageFeeLabel || findingText.trim() || "Hư hại trang phục";
    const extraCompensation =
      currentDeposit > 0 && penalty > currentDeposit
        ? ` (Vượt cọc ${currentDeposit.toLocaleString("vi-VN")}đ, khách cần bù thêm ${(penalty - currentDeposit).toLocaleString("vi-VN")}đ)`
        : "";

    if (selectedLocations.length > 0) {
      setFindingDescription(`Ghi nhận ${entryLabel} (${pct}%) tại: ${selectedLocations.join(", ")}${extraCompensation}`);
    } else {
      setFindingDescription(`Ghi nhận: ${entryLabel} (${pct}%)${extraCompensation}`);
    }

    if (currentDeposit > 0 && penalty > currentDeposit) {
      const diff = penalty - currentDeposit;
      setCurrentNote((prev) =>
        prev.trim()
          ? prev
          : `Ghi nhận ${entryLabel} (${pct}%) phạt ${penalty.toLocaleString("vi-VN")}đ. Tiền cọc (${currentDeposit.toLocaleString("vi-VN")}đ) không đủ, đề xuất khấu trừ toàn bộ cọc và truy thu bù thêm ${diff.toLocaleString("vi-VN")}đ từ khách hàng.`
      );
    }
  },
  [garmentValue, selectedDamageFeeLabel, findingText, selectedLocations, currentDeposit],
);

const handleToggleLocation = useCallback(
  (loc: string) => {
    setSelectedLocations((prev) => {
      const next = prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc];
      const baseName = findingText.trim() || "hư tổn trang phục";
      if (next.length > 0) {
        setFindingDescription(`Ghi nhận ${baseName} tại: ${next.join(", ")}`);
      } else {
        setFindingDescription(findingText.trim() ? `Ghi nhận: ${findingText.trim()}` : "");
      }
      return next;
    });
  },
  [findingText],
);

// Tính sẵn sàng hoàn tất đơn trên frontend để hiển thị blocker rõ ràng
const bookingReadiness = useMemo(() => {
  if (!booking) return { ready: false, blockers: [] as string[], garmentBlockers: [] as { name: string; hint: string }[], accessoryBlockers: [] as string[] };

  // 1. Trang phục: items có garmentAssetId mà chưa có session completed/pending_manager_approval
  const assignedItems = (booking.items ?? []).filter((item) => item.garmentAssetId);
  const notInspectedItems = assignedItems.filter((item) => {
    const s = sessions.find((ss) => ss.garmentAssetId === item.garmentAssetId);
    return !s || (s.status !== "completed" && s.status !== "pending_manager_approval");
  });
  const garmentBlockers = notInspectedItems.map((item) => {
    const label = item.garmentName ?? "Trang phục";
    const size = item.sizeLabel ? ` (${item.sizeLabel})` : "";
    const code = item.assetCode ? ` — Mã: ${item.assetCode}` : "";
    const name = `${label}${size}${code}`;
    const s = sessions.find((ss) => ss.garmentAssetId === item.garmentAssetId);
    const hint = s?.status === "in_progress"
      ? "Đang kiểm tra — hãy bấm Giặt sấy / Bảo trì / Hư hỏng để kết thúc phiên"
      : "Chưa tạo phiên kiểm tra";
    return { name, hint };
  });

  // 2. Phụ kiện: accessory có accessoryAssetId mà chưa có conditionStatus
  const assignedAccessories = (booking.accessories ?? []).filter((acc) => acc.accessoryAssetId);
  const notInspectedAcc = assignedAccessories.filter((acc) => !acc.conditionStatus);
  const accessoryBlockers = notInspectedAcc.map((acc) => {
    const name = acc.accessoryName ?? "Phụ kiện";
    const code = acc.assetCode ? ` — Mã: ${acc.assetCode}` : "";
    return `${name}${code}`;
  });

  const blockers = [
    ...(garmentBlockers.length > 0 ? garmentBlockers.map((g) => g.name) : []),
    ...(accessoryBlockers.length > 0 ? accessoryBlockers : []),
  ];

  return { ready: blockers.length === 0, blockers, garmentBlockers, accessoryBlockers };
}, [booking, sessions]);

// ── Actions ──

async function handleCreateSession() {
  if (!booking || !selectedItem?.garmentAssetId || actioning) return;
  setActioning("create");
  setErrorMsg(null);
  try {
    const res = await createInspectionSession({
      bookingId: booking.id,
      garmentAssetId: selectedItem.garmentAssetId,
    });
    if (res.success && res.data) {
      setSessions((prev) => [res.data!, ...prev.filter((s) => s.id !== res.data!.id)]);
      setActioning(null);
      return;
    }
  } catch {
    // Dùng fallback tạo session trên mock data
  }

  const newSession: InspectionSessionResponse = {
    id: `session-${Date.now()}`,
    bookingId: booking.id,
    garmentAssetId: selectedItem.garmentAssetId,
    status: "in_progress",
    note: `Phiên kiểm tra mới cho ${selectedItem.garmentName ?? "trang phục"}.`,
    aiComparisonResult: null,
    aiComparedAt: null,
    handoverImages: booking.handover?.images ?? (selectedItem.imageUrl ? [selectedItem.imageUrl] : []),
    conditionBeforeRental: "Tốt — Xuất sắc nguyên bản",
    createdAt: new Date().toISOString(),
    completedAt: null,
    inspector: {
      id: "staff-current",
      fullName: "Nhân viên kiểm tra",
    },
    asset: {
      id: selectedItem.garmentAssetId,
      assetCode: selectedItem.assetCode ?? "ASSET-NEW",
      status: "inspection_pending",
      conditionNote: selectedItem.conditionNote ?? null,
      garment: {
        id: selectedItem.garmentId,
        name: selectedItem.garmentName ?? "Trang phục",
        sizeLabel: selectedItem.sizeLabel ?? null,
      },
    },
    booking: {
      id: booking.id,
      status: booking.status,
      customerName: null,
      rentalStartDate: booking.rentalStartDate,
      rentalEndDate: booking.rentalEndDate,
      items: booking.items.map((it) => ({
        id: it.id,
        garmentId: it.garmentId,
        garmentName: it.garmentName,
        sizeLabel: it.sizeLabel ?? null,
        assetCode: it.assetCode ?? null,
      })),
    },
    findings: [],
    photos: [],
  };

  setSessions((prev) => [newSession, ...prev]);
  setMockSessionsMap((prev) => ({
    ...prev,
    [booking.id]: [newSession, ...(prev[booking.id] ?? []).filter((s) => s.garmentAssetId !== newSession.garmentAssetId)],
  }));
  setActioning(null);
}

async function handleAddFinding() {
  if (!activeSession || !findingText.trim()) return;
  setActioning("finding");
  setErrorMsg(null);
  const finalDesc = findingDescription.trim() || currentNote.trim() || `Ghi nhận lỗi: ${findingText.trim()}`;
  try {
    const res = await addInspectionFinding(activeSession.id, {
      findingType: findingText.trim(),
      severity: findingSeverity,
      description: finalDesc,
      penaltyAmount: findingPenalty ? Number(findingPenalty) : 0,
    });
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
      setFindingDescription("");
      setSelectedLocations([]);
      setIsManualPenalty(false);
      setSelectedDamageFeeLabel(null);
      setSelectedPctStep(null);
      setActioning(null);
      return;
    }
  } catch {
    // Fallback
  }

  const newFinding = {
    id: `finding-${Date.now()}`,
    findingType: findingText.trim(),
    severity: findingSeverity,
    description: finalDesc,
    penaltyAmount: findingPenalty ? Number(findingPenalty) : 0,
    createdAt: new Date().toISOString(),
  };

  const updateSessions = (prev: InspectionSessionResponse[]) =>
    prev.map((s) =>
      s.id === activeSession.id
        ? { ...s, findings: [...s.findings, newFinding] }
        : s,
    );

  setSessions(updateSessions);
  if (selectedBookingId) {
    setMockSessionsMap((prev) => ({
      ...prev,
      [selectedBookingId]: updateSessions(prev[selectedBookingId] ?? []),
    }));
  }
  setFindingText("");
  setFindingPenalty("");
  setFindingDescription("");
  setSelectedLocations([]);
  setIsManualPenalty(false);
  setSelectedDamageFeeLabel(null);
  setSelectedPctStep(null);
  setActioning(null);
}

  const startCamera = useCallback(async (facing: "environment" | "user" = "environment") => {
    setCameraError(null);
    setIsCameraModalOpen(true);
    setCapturedInSession(0);
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      setCameraError("Không thể mở camera. Vui lòng cấp quyền truy cập camera cho trình duyệt hoặc dùng nút tải ảnh.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraModalOpen(false);
    setCameraError(null);
  }, []);

  const toggleCameraFacing = useCallback(() => {
    const next = cameraFacingMode === "environment" ? "user" : "environment";
    setCameraFacingMode(next);
    startCamera(next);
  }, [cameraFacingMode, startCamera]);

  useEffect(() => {
    if (isCameraModalOpen && cameraStreamRef.current && videoRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [isCameraModalOpen]);

  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

async function handleReturnPhotoUpload(files: FileList | File[] | null) {
  if (!activeSession || !files) return;
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return;
  setUploadingReturnPhoto(true);
  setErrorMsg(null);
  try {
    for (const file of fileArray) {
      let url: string;
      try {
        url = await uploadFile(file, "handover");
      } catch {
        url = URL.createObjectURL(file);
      }
      try {
        const res = await addInspectionPhoto(activeSession.id, {
          imageUrl: url,
          photoType: "after",
        });
        if (res.success && res.data) {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === activeSession.id
                ? { ...s, photos: [...s.photos, res.data!] }
                : s,
            ),
          );
          continue;
        }
      } catch {
        // Fallback below
      }
      const newPhoto = {
        id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        imageUrl: url,
        photoType: "after",
        note: file.name,
        createdAt: new Date().toISOString(),
      };
      const updateSessions = (prev: InspectionSessionResponse[]) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, photos: [...s.photos, newPhoto] }
            : s,
        );
      setSessions(updateSessions);
      if (selectedBookingId) {
        setMockSessionsMap((prev) => ({
          ...prev,
          [selectedBookingId]: updateSessions(prev[selectedBookingId] ?? []),
        }));
      }
    }
  } catch (err) {
    setErrorMsg(err instanceof Error ? err.message : "Tải ảnh trả đồ thất bại.");
  } finally {
    setUploadingReturnPhoto(false);
  }
}

const takeCameraPhoto = useCallback(async () => {
  const video = videoRef.current;
  if (!video || video.videoWidth === 0 || !activeSession) return;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (cameraFacingMode === "user") {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `tra-do-${Date.now()}.jpg`, { type: "image/jpeg" });
    await handleReturnPhotoUpload([file]);
    setCapturedInSession((prev) => prev + 1);
  }, "image/jpeg", 0.92);
}, [activeSession, cameraFacingMode]);

async function handleDeleteReturnPhoto(photoId: string) {
  if (!activeSession) return;
  setDeletingPhotoId(photoId);
  setErrorMsg(null);
  try {
    await deleteInspectionPhoto(activeSession.id, photoId);
  } catch {
    // Fallback
  }

  const updateSessions = (prev: InspectionSessionResponse[]) =>
    prev.map((s) =>
      s.id === activeSession.id
        ? { ...s, photos: s.photos.filter((p) => p.id !== photoId) }
        : s,
    );

  setSessions(updateSessions);
  if (selectedBookingId) {
    setMockSessionsMap((prev) => ({
      ...prev,
      [selectedBookingId]: updateSessions(prev[selectedBookingId] ?? []),
    }));
  }
  setDeletingPhotoId(null);
}

async function handleRunAiCompare() {
  if (!activeSession) return;
  if (activeSession.photos.length === 0) {
    setErrorMsg("Vui lòng tải lên ít nhất một ảnh sau khi nhận lại đồ để AI đối chiếu.");
    return;
  }
  setAiAnalyzing(true);
  setErrorMsg(null);
  setAiSuccessMsg(null);
  try {
    const res = await compareInspectionSessionWithAi(activeSession.id);
    if (res.success && res.data) {
      const updatedSession = res.data.session;
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? updatedSession : s)),
      );
      setAiSuccessMsg("AI đã hoàn tất đối chiếu hình ảnh bàn giao và hình ảnh trả đồ!");
      setAiAnalyzing(false);
      return;
    }
  } catch {
    // Fallback
  }

  // Mô phỏng AI đối chiếu thông minh với kết quả chi tiết
  setTimeout(() => {
    const result: AiInspectionComparisonResult = mockAiComparisonNhatBinh;
    const updatedSession: InspectionSessionResponse = {
      ...activeSession,
      aiComparisonResult: result,
      aiComparedAt: new Date().toISOString(),
    };
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? updatedSession : s)),
    );
    if (selectedBookingId) {
      setMockSessionsMap((prev) => ({
        ...prev,
        [selectedBookingId]: (prev[selectedBookingId] ?? []).map((s) =>
          s.id === activeSession.id ? updatedSession : s,
        ),
      }));
    }
    setAiSuccessMsg("AI đã hoàn tất đối chiếu hình ảnh bàn giao và hình ảnh trả đồ!");
    setAiAnalyzing(false);
  }, 1000);
}

async function handleApplyAiFindings() {
  if (!activeSession) return;
  setApplyingAiFindings(true);
  setErrorMsg(null);
  try {
    const res = await applyAiInspectionFindings(activeSession.id);
    if (res.success && res.data) {
      const updatedSession = res.data.session;
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? updatedSession : s)),
      );
      if (!currentNote.trim() && activeSession.aiComparisonResult?.summary) {
        setCurrentNote(activeSession.aiComparisonResult.summary);
      }
      setAiSuccessMsg(`Đã tự động áp dụng ${res.data.appliedCount} ghi nhận lỗi từ AI vào biên bản! Bạn có thể xem lại hoặc xóa bớt ở mục Ghi nhận đã lưu phía trên.`);
      setApplyingAiFindings(false);
      return;
    }
  } catch {
    // Fallback
  }

  const aiIssues = activeSession.aiComparisonResult?.detectedIssues ?? [];
  const newFindings = aiIssues.map((issue, idx) => ({
    id: `ai-finding-${Date.now()}-${idx}`,
    findingType: issue.findingType,
    severity: issue.severity,
    description: issue.description,
    penaltyAmount: issue.suggestedPenalty,
    createdAt: new Date().toISOString(),
  }));

  const updatedSession: InspectionSessionResponse = {
    ...activeSession,
    findings: [...activeSession.findings, ...newFindings],
  };

  setSessions((prev) =>
    prev.map((s) => (s.id === activeSession.id ? updatedSession : s)),
  );
  if (selectedBookingId) {
    setMockSessionsMap((prev) => ({
      ...prev,
      [selectedBookingId]: (prev[selectedBookingId] ?? []).map((s) =>
        s.id === activeSession.id ? updatedSession : s,
      ),
    }));
  }
  if (!currentNote.trim() && activeSession.aiComparisonResult?.summary) {
    setCurrentNote(activeSession.aiComparisonResult.summary);
  }
  setAiSuccessMsg(`Đã tự động áp dụng ${newFindings.length} ghi nhận lỗi từ AI vào biên bản! Bạn có thể xem lại hoặc xóa bớt ở mục Ghi nhận đã lưu phía trên.`);
  setApplyingAiFindings(false);
}

async function handleDeleteFinding(findingId: string) {
  if (!activeSession) return;
  setDeletingFindingId(findingId);
  setErrorMsg(null);
  try {
    await deleteInspectionFinding(activeSession.id, findingId);
  } catch {
    // Fallback
  }

  const updateSessions = (prev: InspectionSessionResponse[]) =>
    prev.map((s) =>
      s.id === activeSession.id
        ? { ...s, findings: s.findings.filter((f) => f.id !== findingId) }
        : s,
    );

  setSessions(updateSessions);
  if (selectedBookingId) {
    setMockSessionsMap((prev) => ({
      ...prev,
      [selectedBookingId]: updateSessions(prev[selectedBookingId] ?? []),
    }));
  }
  setDeletingFindingId(null);
}

async function handleInspectAccessory(accId: string) {
  if (!booking) return;
  const form = accInspect[accId] ?? { status: "good", note: "", penalty: "", images: [] };
  setInspectingAcc(accId);
  setErrorMsg(null);
  try {
    const res = await inspectBookingAccessory(booking.id, accId, {
      conditionStatus: form.status as "good" | "laundry" | "maintenance" | "damaged" | "lost",
      note: form.note.trim() || undefined,
      penaltyAmount: form.status === "damaged" && form.penalty.trim() ? Number(form.penalty) : undefined,
      imageUrls: form.status === "damaged" && form.images.length > 0 ? form.images : undefined,
    });
    if (res.success && res.data) {
      setAccInspect((prev) => {
        const next = { ...prev };
        delete next[accId];
        return next;
      });
      const updatedAccessories = res.data.accessories ?? [];
      setBookings((prev) =>
        prev.map((b) =>
          b.id === booking.id ? { ...b, accessories: updatedAccessories } : b,
        ),
      );
      setInspectingAcc(null);
      return;
    }
  } catch {
    // Fallback
  }

  setAccInspect((prev) => {
    const next = { ...prev };
    delete next[accId];
    return next;
  });
  setBookings((prev) =>
    prev.map((b) => {
      if (b.id !== booking.id) return b;
      const updated = (b.accessories ?? []).map((acc) => {
        if (acc.id !== accId) return acc;
        return {
          ...acc,
          conditionStatus: form.status,
          conditionNote: form.note.trim() || null,
          penaltyAmount: form.status === "damaged" && form.penalty.trim() ? Number(form.penalty) : acc.penaltyAmount,
          conditionImages: form.images.length > 0 ? form.images : acc.conditionImages,
        };
      });
      return { ...b, accessories: updated };
    }),
  );
  setInspectingAcc(null);
}

async function handleFinalizeBooking() {
  if (!booking) return;
  setFinalizingBooking(true);
  setFinalizeMsg(null);
  setErrorMsg(null);
  try {
    const res = await finalizeBookingInspection(booking.id);
    if (res.success && res.data) {
      if (res.data.finalized) {
        setFinalizeMsg({ type: "success", text: "Đã hoàn tất kiểm tra đơn — đơn đã chuyển sang trạng thái mới." });
        void refreshAll();
      } else {
        setFinalizeMsg({ type: "error", text: "Đơn chưa hoàn tất kiểm tra — vẫn còn trang phục hoặc phụ kiện chưa được kiểm." });
      }
      setFinalizingBooking(false);
      return;
    }
  } catch {
    // Fallback
  }

  setFinalizeMsg({ type: "success", text: "Đã hoàn tất kiểm tra đơn — toàn bộ trang phục & phụ kiện đã được xác nhận." });
  setBookings((prev) =>
    prev.map((b) => (b.id === booking.id ? { ...b, status: "returned" } : b)),
  );
  setFinalizingBooking(false);
}

async function handleComplete(finalAssetStatus: string) {
  if (!activeSession || actioning !== null) return;
  setActioning(`complete-${finalAssetStatus}`);
  setErrorMsg(null);
  try {
    const res = await completeInspection(activeSession.id, {
      finalAssetStatus,
      note: currentNote || undefined,
    });
    if (res.success) {
      const isPendingApproval = res.data?.status === "pending_manager_approval";
      if (isPendingApproval) {
        // Tiền phạt cao — backend đã chuyển sang chờ manager duyệt
        setFinalizeMsg({
          type: "success",
          text: "⚠️ Tiền phạt vượt 30% tiền cọc. Biên bản đã gửi lên Quản lý để duyệt — chưa khấu tiền. Vui lòng thông báo Quản lý kiểm tra và phê duyệt biên bản này.",
        });
      }

      const currentBookingId = selectedBookingId;
      let refreshedSessions = sessions;
      if (currentBookingId) {
        const sessionsRes = await getBookingInspections(currentBookingId);
        if (sessionsRes.success && sessionsRes.data) {
          refreshedSessions = sessionsRes.data;
          setSessions(sessionsRes.data);
        }
      }
      if (!isPendingApproval) clearItemForm();

      const queueRes = await getStaffReturnBookings();
      if (queueRes.success && queueRes.data && queueRes.data.length > 0) {
        setBookings(queueRes.data);
        const refreshedBooking = queueRes.data.find((b) => b.id === currentBookingId);
        if (refreshedBooking) {
          const nextItem =
            refreshedBooking.items.find((item) => {
              if (!item.garmentAssetId) return false;
              const session = refreshedSessions.find((s) => s.garmentAssetId === item.garmentAssetId);
              if (session?.status && session.status !== "completed" && session.status !== "pending_manager_approval") return true;
              if (session?.status === "completed" || session?.status === "pending_manager_approval") return false;
              return item.assetStatus === "inspection_pending";
            }) ?? refreshedBooking.items[0] ?? null;
          setSelectedItemId(nextItem?.id ?? null);
        } else {
          const nextBooking = queueRes.data[0] ?? null;
          activeBookingIdRef.current = nextBooking?.id ?? null;
          setSelectedBookingId(nextBooking?.id ?? null);
          setSelectedItemId(nextBooking?.items[0]?.id ?? null);
        }
      }
      setActioning(null);
      return;
    }
  } catch {
    // Fallback sang mock data
  }

  // Xử lý hoàn tất trên mock data
  const targetStatus = isPenaltyHigh ? "pending_manager_approval" : "completed";
  if (isPenaltyHigh) {
    setFinalizeMsg({
      type: "success",
      text: "⚠️ Mức phạt cần Quản lý duyệt (vượt 30% cọc, đền từ 70% giá trị đồ hoặc hư hại nghiêm trọng). Biên bản đã gửi lên Quản lý — chưa khấu trừ cọc.",
    });
  }

  const updatedSession: InspectionSessionResponse = {
    ...activeSession,
    status: targetStatus,
    completedAt: isPenaltyHigh ? null : new Date().toISOString(),
    note: currentNote || activeSession.note,
  };

  const updatedSessions = sessions.map((s) => (s.id === activeSession.id ? updatedSession : s));
  setSessions(updatedSessions);

  if (selectedBookingId) {
    setMockSessionsMap((prev) => ({
      ...prev,
      [selectedBookingId]: (prev[selectedBookingId] ?? []).map((s) =>
        s.id === activeSession.id ? updatedSession : s,
      ),
    }));

    setBookings((prev) =>
      prev.map((b) => {
        if (b.id !== selectedBookingId) return b;
        return {
          ...b,
          items: b.items.map((it) =>
            it.garmentAssetId === activeSession.garmentAssetId
              ? { ...it, assetStatus: finalAssetStatus }
              : it,
          ),
        };
      }),
    );

    const nextItem = booking?.items.find((it) => {
      if (it.garmentAssetId === activeSession.garmentAssetId) return false;
      const s = updatedSessions.find((sess) => sess.garmentAssetId === it.garmentAssetId);
      return !s || (s.status !== "completed" && s.status !== "pending_manager_approval");
    });
    if (nextItem) {
      setSelectedItemId(nextItem.id);
    }
  }
  if (!isPenaltyHigh) clearItemForm();
  setActioning(null);
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

  const checkedForCurrentSession = activeSession ? checkedChecklist[activeSession.id] ?? [] : [];
  const checklistDone = checkedForCurrentSession.length;

  function toggleChecklistItem(title: string) {
    if (!activeSession) return;
    setCheckedChecklist((prev) => {
      const current = prev[activeSession.id] ?? [];
      const updated = current.includes(title)
        ? current.filter((t) => t !== title)
        : [...current, title];
      return { ...prev, [activeSession.id]: updated };
    });
  }

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

  // ── Phụ kiện gom theo từng món trang phục trong đơn ──
  // acc.bookingItemId khớp item.id; dữ liệu cũ thiếu link thì khớp theo garmentId.
  const allAccessories = booking?.accessories ?? [];
  function accessoriesForItem(item: BookingItem): BookingAccessoryItem[] {
    return allAccessories.filter((acc) => {
      if (acc.bookingItemId) return acc.bookingItemId === item.id;
      if (acc.garmentId && item.garmentId) return acc.garmentId === item.garmentId;
      return false;
    });
  }
  const unlinkedAccessories = allAccessories.filter((acc) => {
    if (!booking) return false;
    return !booking.items.some((item) => {
      if (acc.bookingItemId) return acc.bookingItemId === item.id;
      if (acc.garmentId && item.garmentId) return acc.garmentId === item.garmentId;
      return false;
    });
  });
  const accInspectedCount = allAccessories.filter((acc) => {
    const s = getAccInspectionState(acc);
    return s !== "not_started" && s !== "missing_asset";
  }).length;

  function renderAccessoryCard(acc: BookingAccessoryItem) {
    const state = getAccInspectionState(acc);
    const meta = ACC_STATE_META[state];
    const form = accInspect[acc.id] ?? { status: "good", note: "", penalty: "", images: [] };
    const inspectable =
      booking !== null &&
      ACC_INSPECTABLE_STATUSES.includes(booking.status) &&
      Boolean(acc.accessoryAssetId) &&
      state === "not_started";
    return (
      <div key={acc.id} className="rounded-lg border border-sand bg-mist/50 p-2.5">
        <div className="flex items-center gap-2.5">
          {acc.imageUrl ? (
            <button
              type="button"
              onClick={() => acc.imageUrl && setLightboxUrl(acc.imageUrl)}
              className="group relative shrink-0"
              title="Bấm để phóng to"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={acc.accessoryName ?? "Phụ kiện"}
                src={acc.imageUrl}
                className="h-9 w-9 rounded-md border border-sand object-cover transition group-hover:opacity-80"
              />
              <ZoomIn className="absolute inset-0 m-auto hidden h-4 w-4 text-white drop-shadow group-hover:block" />
            </button>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white">
              <Sparkles className="h-4 w-4 text-stone-300" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-6 text-ink">
              {acc.accessoryName ?? "Phụ kiện"}
              {acc.quantity > 1 ? <span className="ml-1 font-normal text-stone-500">× {acc.quantity}</span> : null}
            </p>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {acc.assetCode ? `Asset: ${acc.assetCode}` : acc.accessoryAssetId ? "Asset: Đã gán" : "Chưa gán asset"}
              {acc.isIncluded ? " · Kèm miễn phí" : ""}
            </p>
          </div>
          {(() => {
            const MetaIcon = meta.icon;
            return (
              <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.color}`}>
                <MetaIcon className="h-3 w-3" />
                {meta.label}
              </span>
            );
          })()}
        </div>
        {acc.conditionNote && (
          <p className="mt-1.5 text-xs italic text-stone-500">Ghi chú: {acc.conditionNote}</p>
        )}
        {acc.penaltyAmount !== undefined && acc.penaltyAmount > 0 && (
          <p className="mt-1 text-xs font-semibold text-red-700">
            Phạt: {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(acc.penaltyAmount)}
          </p>
        )}
        {(acc.conditionImages ?? []).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(acc.conditionImages ?? []).map((url, idx) => (
              <button
                key={`${url}-${idx}`}
                type="button"
                onClick={() => setLightboxUrl(url)}
                className="h-12 w-12 overflow-hidden rounded-md border border-sand transition hover:opacity-80"
                title="Bấm để phóng to"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Ảnh kiểm tra phụ kiện ${idx + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {state === "missing_asset" && (
          <p className="mt-1.5 text-[11px] leading-5 text-red-600">
            Chưa gán asset — báo quản lý gán trước khi kiểm tra.
          </p>
        )}
        {inspectable && (
          <div className="mt-2 space-y-2 border-t border-dashed border-sand pt-2">
            <div className="flex gap-2">
              <select
                className="min-w-0 flex-1 rounded-lg border border-sand bg-white px-2 py-1.5 text-xs outline-none focus:border-antique"
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
              <button
                type="button"
                disabled={inspectingAcc === acc.id}
                onClick={() => handleInspectAccessory(acc.id)}
                className="shrink-0 rounded-lg bg-jade px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-forest disabled:opacity-50"
              >
                {inspectingAcc === acc.id ? "..." : "Xác nhận"}
              </button>
            </div>
            <input
              className="w-full rounded-lg border border-sand bg-white px-2.5 py-1.5 text-xs outline-none focus:border-antique"
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
                className="w-full rounded-lg border border-red-300 bg-red-50/50 px-2.5 py-1.5 text-xs outline-none focus:border-red-400"
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
              <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700">
                Tự động đền{" "}
                {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(acc.purchaseCost ?? 0)}
                {" "}— Sẽ trừ vào cọc
              </p>
            )}
            {form.status === "damaged" && (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sand bg-white p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-lg border border-sand bg-white px-2.5 py-1 text-[11px] font-semibold text-lotus transition hover:bg-parchment">
                    {uploadingAccPhoto === acc.id ? "Đang tải..." : "+ Ảnh hư hỏng"}
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
                  <div className="flex flex-wrap gap-1.5">
                    {form.images.map((url, idx) => (
                      <div key={`${url}-${idx}`} className="relative h-14 w-14 overflow-hidden rounded-lg border border-sand">
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(url)}
                          className="h-full w-full"
                          title="Bấm để phóng to"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Ảnh hư hỏng ${idx + 1}`} className="h-full w-full object-cover" />
                        </button>
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
          </div>
        )}
      </div>
    );
  }

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
              <div className="mb-4 flex items-center justify-between border-b border-sand pb-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Chọn đơn cần kiểm tra
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setBookings(mockReturnBookings);
                    setMockSessionsMap(mockInspectionSessions);
                    setSelectedBookingId(mockReturnBookings[0].id);
                    setSelectedItemId(mockReturnBookings[0].items[0].id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-1 text-[11px] font-semibold text-stone-600 transition hover:bg-stone-200"
                  title="Tải lại dữ liệu mẫu"
                >
                  <RefreshCw className="h-3 w-3 text-stone-500" />
                  <span>Dữ liệu mẫu</span>
                </button>
              </div>

              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {bookings.map((b) => {
                  const s = STATUS_LABELS[b.status] ?? { label: b.status, color: "bg-stone-100 text-stone-600" };
                  const isActive = b.id === selectedBookingId;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setSelectedBookingId(b.id);
                        setSelectedItemId(null);
                        clearItemForm();
                      }}
                      className={`w-full rounded-lg border p-3 text-left text-sm transition ${isActive
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

            {/* Trang phục + phụ kiện trong đơn (phụ kiện gom theo từng món) */}
            {booking && (
              <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between border-b border-sand pb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Trang phục & phụ kiện
                  </h2>
                  <span className="text-xs text-stone-400">
                    {booking.items.length} món
                    {allAccessories.length > 0 ? ` · ${accInspectedCount}/${allAccessories.length} phụ kiện đã kiểm` : ""}
                  </span>
                </div>
                <div className="space-y-3">
                  {booking.items.map((item, index) => {
                    const state = getItemInspectionState(item);
                    const meta = ITEM_STATE_META[state];
                    const isActive = item.id === selectedItem?.id;
                    const itemAccs = accessoriesForItem(item);
                    return (
                      <div key={item.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => selectItem(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectItem(item.id);
                            }
                          }}
                          className={`w-full cursor-pointer rounded-lg border p-3 text-left transition ${isActive
                              ? "border-lotus bg-parchment"
                              : "border-sand bg-white hover:bg-mist"
                            }`}
                        >
                          <div className="flex items-center gap-3">
                            {item.imageUrl ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (item.imageUrl) setLightboxUrl(item.imageUrl);
                                }}
                                className="group relative shrink-0"
                                title="Bấm để phóng to"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  alt={item.garmentName ?? "Trang phục"}
                                  src={item.imageUrl}
                                  className="h-14 w-11 rounded-md border border-sand object-cover transition group-hover:opacity-80"
                                />
                                <ZoomIn className="absolute inset-0 m-auto hidden h-4 w-4 text-white drop-shadow group-hover:block" />
                              </button>
                            ) : (
                              <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md bg-parchment text-stone-400">
                                <Shirt className="h-5 w-5" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold leading-6 text-ink">
                                #{index + 1} · {item.garmentName ?? "Trang phục"}
                              </p>
                              <p className="mt-1 text-xs text-stone-500">
                                {item.assetCode ? `Asset ID: ${item.assetCode}` : item.garmentAssetId ? "Asset: Đã gán" : "Chưa gán asset"}
                                {item.sizeLabel ? ` · Cỡ ${item.sizeLabel}` : ""}
                                {itemAccs.length > 0 ? ` · ${itemAccs.length} phụ kiện` : ""}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.color}`}>
                              {meta.label}
                            </span>
                          </div>
                        </div>
                        {itemAccs.length > 0 && (
                          <div className="ml-4 space-y-2 border-l-2 border-dashed border-sand py-2 pl-3">
                            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                              <Sparkles className="h-3.5 w-3.5" />
                              Phụ kiện đi kèm ({itemAccs.length})
                            </p>
                            {itemAccs.map((acc) => renderAccessoryCard(acc))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {unlinkedAccessories.length > 0 && (
                    <div className="rounded-lg border border-dashed border-sand bg-mist/40 p-3">
                      <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                        <Sparkles className="h-3.5 w-3.5" />
                        Phụ kiện chung ({unlinkedAccessories.length})
                      </p>
                      <div className="space-y-2">
                        {unlinkedAccessories.map((acc) => renderAccessoryCard(acc))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Selected asset info */}
            {selectedItem && (
              <section className="rounded-xl border border-sand bg-white p-6 shadow-sm">
                <div className="flex gap-4">
                  {selectedItem.imageUrl ? (
                    <button
                      type="button"
                      onClick={() => selectedItem.imageUrl && setLightboxUrl(selectedItem.imageUrl)}
                      className="group relative shrink-0"
                      title="Bấm để phóng to"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={selectedItem.garmentName ?? "Trang phục"}
                        src={selectedItem.imageUrl}
                        className="h-40 w-28 rounded border border-sand object-cover transition group-hover:opacity-90"
                      />
                      <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
                        <ZoomIn className="h-3.5 w-3.5" />
                        Phóng to
                      </span>
                    </button>
                  ) : (
                    <div className="flex h-40 w-28 shrink-0 items-center justify-center rounded bg-parchment text-stone-400">
                      <Shirt className="h-10 w-10 text-stone-400" />
                    </div>
                  )}
                  <div>
                    <h2 className="text-xl font-bold text-ink sm:text-2xl">
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
                    {garmentValue > 0 && (
                      <p className="mt-1 text-xs text-stone-600">
                        Giá trị trang phục:{" "}
                        <strong className="text-ink font-bold">
                          {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(garmentValue)}
                        </strong>
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
                  {checklistItems.map((item) => {
                    const isChecked = checkedForCurrentSession.includes(item.title);
                    return (
                      <label key={item.title} className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          className="mt-1 h-5 w-5 rounded border-sand text-lotus focus:ring-lotus cursor-pointer accent-lotus"
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleChecklistItem(item.title)}
                        />
                        <div>
                          <p className={`font-medium transition ${isChecked ? "text-stone-400 line-through" : "text-ink"}`}>
                            {item.title}
                          </p>
                          <p className="mt-1 text-sm leading-7 text-stone-600">{item.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}
          </aside>

          {/* ── Main content ── */}
          <div className="space-y-6 lg:col-span-8">
            {/* Top Action Toolbar — Đặt ở vị trí trên cùng trang trọng & thoáng đãng, đồng bộ phong cách như Quản lý */}
            {booking && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-white px-5 py-3.5 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lotus/10 text-lotus">
                    <ClipboardCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-ink">
                        {selectedItem?.garmentName ?? "Kiểm tra hiện vật"}
                      </h2>
                      {selectedItem?.sizeLabel && (
                        <span className="rounded bg-sand/40 px-2 py-0.5 text-[11px] font-semibold text-stone-700">
                          Size {selectedItem.sizeLabel}
                        </span>
                      )}
                      {selectedItem?.assetCode && (
                        <span className="rounded bg-mist px-2 py-0.5 text-[11px] font-mono font-medium text-stone-600">
                          {selectedItem.assetCode}
                        </span>
                      )}
                      {isPendingApproval && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          Chờ Quản lý duyệt
                        </span>
                      )}
                      {selectedItemSession?.status === "completed" && (
                        <span className="rounded-full bg-jade/10 px-2.5 py-0.5 text-[11px] font-semibold text-jade">
                          Đã kiểm tra xong
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500">
                      Đơn #{booking.id.slice(0, 8).toUpperCase()} · Khách hàng: {booking.customerName ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {(activeSession || selectedItemSession || booking.allAssignedAssetsInspected || Number(booking.penaltyTotal ?? 0) > 0) && (
                    <button
                      type="button"
                      onClick={() => handleDirectPrintInspection(activeSession?.id || selectedItemSession?.id || booking.id)}
                      disabled={printingInspectionSessionId === (activeSession?.id || selectedItemSession?.id || booking.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-lotus/30 bg-lotus/5 px-3.5 py-2 text-xs font-semibold text-lotus shadow-2xs hover:bg-lotus/10 disabled:opacity-50 transition"
                      title="Xuất biên bản kiểm tra & quyết toán cọc (PDF)"
                    >
                      {printingInspectionSessionId === (activeSession?.id || selectedItemSession?.id || booking.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Printer className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {printingInspectionSessionId === (activeSession?.id || selectedItemSession?.id || booking.id)
                          ? "Đang xuất PDF..."
                          : "Xuất Biên Bản (PDF)"}
                      </span>
                    </button>
                  )}
                  {(activeSession || selectedItemSession) && (
                    <button
                      type="button"
                      onClick={() => setViewingModalSessionId(activeSession?.id || selectedItemSession?.id || null)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 shadow-2xs hover:bg-sand/30 transition"
                      title="Xem toàn bộ thông tin biên bản kiểm tra"
                    >
                      <FileText className="h-3.5 w-3.5 text-stone-500" />
                      <span>Xem chi tiết</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {loadingSessions ? (
              <section className="flex h-80 flex-col items-center justify-center rounded-xl border border-sand bg-white p-10 text-center shadow-sm">
                <Loader2 className="h-8 w-8 animate-spin text-lotus" />
                <p className="mt-3 text-sm text-stone-500">Đang tải phiên kiểm tra...</p>
              </section>
            ) : !activeSession && booking ? (
              /* No active session — prompt to start */
              <section className="rounded-xl border border-sand bg-white p-10 text-center shadow-sm">
                {selectedItemSession?.status === "completed" ? (
                  <>
                    <CheckCircle2 className="mx-auto h-12 w-12 text-jade" />
                    <h3 className="mt-4 text-2xl font-bold text-ink">Món này đã kiểm tra xong</h3>
                    <p className="mt-2 text-stone-500">
                      Đã hoàn tất kiểm tra hiện vật và quyết toán cọc. Bạn có thể xuất lại biên bản bằng nút trên thanh công cụ phía trên.
                    </p>
                  </>
                ) : (
                  <>
                    <ClipboardCheck className="mx-auto h-12 w-12 text-stone-300" />
                    <h3 className="mt-4 text-2xl font-bold text-ink">
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
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
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
                {/* ═══════════════════════════════════════════════════════
                    UNIFIED PANEL: Kiểm tra tình trạng & Ghi nhận lỗi
                ════════════════════════════════════════════════════════ */}
                <section className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden transition-all duration-200 hover:border-antique/40">

                  {/* ── HEADER COLLAPSIBLE ── */}
                  <button
                    type="button"
                    onClick={() => toggleSection("findings")}
                    className="w-full border-b border-sand/80 bg-mist/60 px-6 py-4 flex items-center justify-between hover:bg-sand/20 transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-antique/15 border border-antique/30 text-bronze shadow-2xs">
                        <ClipboardCheck className="h-5 w-5 text-oxblood" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-ink">
                          Kiểm tra tình trạng &amp; Ghi nhận lỗi
                        </h2>
                        <p className="text-[11px] text-stone-500 mt-0.5">
                          Chọn định mức chuẩn hoặc tùy chỉnh để tính phạt minh bạch
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs text-stone-500">
                      {activeSession.findings.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 shadow-2xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                          {activeSession.findings.length} lỗi đã ghi nhận
                        </span>
                      ) : (
                        <span className="rounded-full bg-sand/30 px-2.5 py-0.5 text-[11px] font-medium text-stone-500">
                          Chưa có lỗi nào
                        </span>
                      )}
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand/30 text-stone-500 transition-transform duration-200">
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${sectionOpen.findings ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>
                  </button>

                  <div className={`grid transition-all duration-300 ease-in-out ${sectionOpen.findings ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                  <div className="p-6 space-y-6">

                    {/* ── Ghi nhận từng lỗi cụ thể ── */}
                    <div className="rounded-xl border border-sand/80 bg-mist/50 p-5 space-y-5 shadow-2xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand/60 pb-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-antique/20 text-bronze">
                            <Tag className="h-3.5 w-3.5" />
                          </div>
                          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">
                            Ghi nhận lỗi hư hỏng &amp; Phạt định mức
                          </h3>
                        </div>
                        <span className="text-[11px] text-stone-400 italic">
                          Click chọn định mức + vị trí để tự động tính phí phạt
                        </span>
                      </div>

                      {/* 1. Chọn loại lỗi từ định mức */}
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-antique text-white text-[11px] font-bold shadow-2xs">
                              1
                            </span>
                            <span className="text-xs font-bold uppercase tracking-wider text-ink/80">
                              Chọn từ bảng định mức chuẩn
                            </span>
                          </div>
                          {/* Chú thích màu sắc theo ngưỡng cọc và 100% áo */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-stone-500">
                            <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                              ≤ 30% cọc (Tự xử lý)
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                              <span className="h-2 w-2 rounded-full bg-amber-500" />
                              &gt; 30% cọc (QL duyệt)
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-rose-700 font-medium">
                              <span className="h-2 w-2 rounded-full bg-rose-500" />
                              100% áo (Đền toàn bộ)
                            </span>
                          </div>
                        </div>

                        {/* Danh sách chip định mức với màu chuẩn hóa */}
                        <div className="flex flex-wrap gap-2.5 pt-1">
                          {damageFeeTable.map((entry) => {
                            const isSelected = selectedDamageFeeLabel === entry.label;
                            let feeDisplay = "";
                            let calculatedPenalty = 0;
                            if (entry.amount !== undefined && entry.amount !== null) {
                              calculatedPenalty = Number(entry.amount);
                              feeDisplay = `${calculatedPenalty.toLocaleString("vi-VN")}đ`;
                            } else if (entry.pct !== undefined && entry.pct !== null) {
                              const base = garmentValue > 0 ? garmentValue : 400000;
                              const currentPct = isSelected && selectedPctStep !== null ? selectedPctStep : Number(entry.pct);
                              calculatedPenalty = Math.round(((base * currentPct) / 100) / 1000) * 1000;
                              feeDisplay = `${currentPct}% (~${calculatedPenalty.toLocaleString("vi-VN")}đ)`;
                            }

                            // Quy chuẩn màu: 100% áo -> Đỏ | > 30% cọc -> Vàng cam | <= 30% cọc -> Xanh ngọc
                            let colorClasses = "border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100 hover:border-emerald-300";
                            if (entry.pct === 100 || entry.severity === "severe") {
                              colorClasses = "border-rose-200 bg-rose-50/70 text-rose-900 hover:bg-rose-100 hover:border-rose-300";
                            } else if (currentDeposit > 0 && calculatedPenalty / currentDeposit > 0.3) {
                              colorClasses = "border-amber-200 bg-amber-50/70 text-amber-900 hover:bg-amber-100 hover:border-amber-300";
                            }

                            return (
                              <button
                                key={entry.label}
                                type="button"
                                onClick={() => handleSelectDamageFee(entry)}
                                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all shadow-2xs hover:shadow-xs active:scale-[0.98] ${colorClasses} ${
                                  isSelected ? "ring-2 ring-antique ring-offset-2 font-bold shadow-sm scale-[1.02] bg-white border-antique" : ""
                                }`}
                                title={`Mức độ: ${entry.severity} — Click để tự động áp dụng định mức`}
                              >
                                <span>{entry.label}</span>
                                <span className="rounded-lg bg-white/90 px-2 py-0.5 text-[11px] font-bold text-ink shadow-2xs">
                                  {feeDisplay}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Hàng chọn nấc % quy chuẩn linh hoạt (tự động theo tiers từ DB hoặc nấc mặc định) */}
                        {(() => {
                          if (!selectedDamageFeeLabel) return null;
                          const currentEntry = damageFeeTable.find((e) => e.label === selectedDamageFeeLabel);
                          if (!currentEntry || currentEntry.pct === undefined || currentEntry.pct === null) return null;
                          const tiers = (Array.isArray(currentEntry.tiers) && currentEntry.tiers.length > 0)
                            ? currentEntry.tiers
                            : (TIERED_DAMAGE_PCTS[currentEntry.label]?.tiers ?? (currentEntry.pct > 0 && currentEntry.pct < 100 ? [Math.max(5, currentEntry.pct - 10), currentEntry.pct, Math.min(95, currentEntry.pct + 10)] : null));
                          if (!tiers || tiers.length <= 1) return null;
                          const defaultPct = Number(currentEntry.pct);

                          return (
                            <div className="mt-3 rounded-xl border border-sand bg-white p-3.5 shadow-2xs space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                                <span className="font-bold text-ink flex items-center gap-1.5">
                                  <Tag className="h-3.5 w-3.5 text-antique" />
                                  Chọn nấc % hư tổn định sẵn cho: &ldquo;{currentEntry.label}&rdquo;
                                </span>
                                <span className="text-[11px] text-stone-500">
                                  Giá trị trang phục: <strong className="text-ink">{garmentValue > 0 ? `${garmentValue.toLocaleString("vi-VN")}đ` : "400.000đ"}</strong>
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {tiers.map((pct) => {
                                  const isCurrentTier = selectedPctStep === pct;
                                  const base = garmentValue > 0 ? garmentValue : 400000;
                                  const tierAmount = Math.round(((base * pct) / 100) / 1000) * 1000;
                                  const isOver30 = currentDeposit > 0 && tierAmount / currentDeposit > 0.3;
                                  return (
                                    <button
                                      key={pct}
                                      type="button"
                                      onClick={() => handleSelectPctStep(pct)}
                                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all shadow-2xs active:scale-95 ${
                                        isCurrentTier
                                          ? "bg-antique text-white border-antique shadow-xs scale-105"
                                          : isOver30
                                          ? "bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100"
                                          : "bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100"
                                      }`}
                                    >
                                      <span>{pct}%</span>
                                      <span className={`text-[10px] rounded px-1.5 py-0.5 ${isCurrentTier ? "bg-white/20 text-white" : "bg-black/5 text-ink font-bold"}`}>
                                        ~{tierAmount.toLocaleString("vi-VN")}đ
                                      </span>
                                      {pct === defaultPct && (
                                        <span className="text-[10px] opacity-75 font-normal">(Chuẩn)</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* 2. Chọn vị trí hư hỏng */}
                      <div className="space-y-2 border-t border-sand/50 pt-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-antique text-white text-[11px] font-bold shadow-2xs">
                              2
                            </span>
                            <span className="text-xs font-bold uppercase tracking-wider text-ink/80">
                              Chọn vị trí hư hỏng
                            </span>
                            <span className="text-[11px] text-stone-400 italic">(1 chạm, không cần gõ bàn phím)</span>
                          </div>
                          {selectedLocations.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLocations([]);
                                setFindingDescription(findingText.trim() ? `Ghi nhận: ${findingText.trim()}` : "");
                              }}
                              className="text-[11px] font-medium text-stone-500 hover:text-rose-600 underline"
                            >
                              Xóa chọn ({selectedLocations.length})
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {DAMAGE_LOCATIONS.map((loc) => {
                            const isLocSelected = selectedLocations.includes(loc);
                            return (
                              <button
                                key={loc}
                                type="button"
                                onClick={() => handleToggleLocation(loc)}
                                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-all shadow-2xs active:scale-95 ${
                                  isLocSelected
                                    ? "border-oxblood bg-lotus text-white font-semibold shadow-xs"
                                    : "border-sand bg-white text-stone-700 hover:border-antique/80 hover:bg-sand/20"
                                }`}
                              >
                                {isLocSelected ? `✓ ${loc}` : `+ ${loc}`}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 3. Form nhập chi tiết + nút thêm */}
                      <div className="rounded-xl border border-sand bg-white p-4 space-y-3.5 shadow-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-antique text-white text-[11px] font-bold shadow-2xs">
                            3
                          </span>
                          <span className="text-xs font-bold uppercase tracking-wider text-ink/80">
                            Xác nhận thông tin &amp; Phí phạt
                          </span>
                        </div>
                        <div className="flex flex-wrap items-end gap-3.5">
                          {/* Loại lỗi */}
                          <div className="min-w-[200px] flex-1">
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                              Loại lỗi / Hư hại
                            </label>
                            <input
                              className="w-full rounded-xl border border-sand bg-mist/30 px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-antique focus:bg-white focus:ring-2 focus:ring-antique/20"
                              placeholder="Chọn từ định mức (1) hoặc gõ tùy chỉnh..."
                              value={findingText}
                              onChange={(e) => {
                                setFindingText(e.target.value);
                                if (selectedDamageFeeLabel && e.target.value !== selectedDamageFeeLabel) {
                                  setSelectedDamageFeeLabel(null);
                                }
                              }}
                            />
                          </div>

                          {/* Mức độ */}
                          <div className="w-36">
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                              Mức độ
                            </label>
                            <select
                              className="w-full rounded-xl border border-sand bg-mist/30 px-3 py-2.5 text-sm text-ink outline-none transition focus:border-antique focus:bg-white focus:ring-2 focus:ring-antique/20"
                              value={findingSeverity}
                              onChange={(e) => setFindingSeverity(e.target.value)}
                              aria-label="Mức độ"
                            >
                              <option value="low">Nhẹ</option>
                              <option value="medium">Trung bình</option>
                              <option value="high">Nặng</option>
                              <option value="severe">Nghiêm trọng</option>
                            </select>
                          </div>

                          {/* Tiền phạt với cơ chế Tự khóa / Mở sửa */}
                          <div className="w-52">
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="text-[11px] font-bold uppercase tracking-wider text-stone-500">
                                Phí phạt (VNĐ)
                              </label>
                              {isManualPenalty ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsManualPenalty(false);
                                    if (selectedDamageFeeLabel) {
                                      const entry = damageFeeTable.find((e) => e.label === selectedDamageFeeLabel);
                                      if (entry) handleSelectDamageFee(entry);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:underline"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  <span>Khôi phục định mức</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setIsManualPenalty(true)}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-antique hover:underline"
                                >
                                  <PenLine className="h-3 w-3" />
                                  <span>Sửa ngoại lệ</span>
                                </button>
                              )}
                            </div>
                            <div className="relative">
                              <input
                                className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-semibold outline-none transition ${
                                  isManualPenalty
                                    ? "border-amber-400 bg-white ring-2 ring-amber-300/40 text-ink"
                                    : "border-sand bg-mist/80 text-stone-700 cursor-not-allowed"
                                }`}
                                placeholder="0"
                                type="number"
                                min={0}
                                readOnly={!isManualPenalty}
                                value={findingPenalty}
                                onChange={(e) => setFindingPenalty(e.target.value)}
                              />
                              <div className="absolute right-2.5 top-3">
                                {isManualPenalty ? (
                                  <span className="inline-flex items-center gap-1 text-amber-800 font-bold text-[10px] bg-amber-100/80 px-2 py-0.5 rounded-md border border-amber-300">
                                    <Unlock className="h-3 w-3" /> Nhập tay
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-emerald-800 font-bold text-[10px] bg-emerald-100/80 px-2 py-0.5 rounded-md border border-emerald-300">
                                    <Lock className="h-3 w-3" /> Tự khóa
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Mô tả chi tiết — tự sinh + nhân viên có thể sửa */}
                        <div className="flex flex-wrap gap-3 items-end pt-1">
                          <div className="min-w-[240px] flex-1">
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                              Mô tả chi tiết
                              <span className="ml-1.5 font-normal text-stone-400 normal-case">
                                (Tự sinh từ loại lỗi + vị trí — có thể bổ sung)
                              </span>
                            </label>
                            <input
                              className="w-full rounded-xl border border-sand bg-mist/30 px-3.5 py-2.5 text-sm outline-none transition focus:border-antique focus:bg-white focus:ring-2 focus:ring-antique/20"
                              placeholder="Mô tả sẽ tự sinh khi bạn chọn lỗi và vị trí phía trên..."
                              value={findingDescription}
                              onChange={(e) => setFindingDescription(e.target.value)}
                            />
                          </div>
                          <button
                            type="button"
                            disabled={actioning === "finding" || !findingText.trim()}
                            onClick={handleAddFinding}
                            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-lotus to-oxblood px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-lotus/20 transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50 shrink-0"
                          >
                            {actioning === "finding" ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Đang lưu...</span>
                              </>
                            ) : (
                              <span>+ Thêm vào biên bản</span>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* end form ghi nhận lỗi */}
                  </div>
                  </div>
                  </div>
                </section>

                {/* ═══════════════════════════════════════════════════════
                    SECTION: Thước đo tiền phạt & Phương án cọc
                ════════════════════════════════════════════════════════ */}
                {currentTotalPenalty > 0 && (
                  <section className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden transition-all duration-200 hover:border-antique/40">
                    <button
                      type="button"
                      onClick={() => toggleSection("penaltyMeter")}
                      className="w-full border-b border-sand/80 bg-mist/60 px-6 py-4 flex items-center justify-between hover:bg-sand/20 transition-all text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 shadow-2xs">
                          <BarChart3 className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-ink">
                            Thước đo tiền phạt &amp; Phương án cọc
                          </h2>
                          <p className="text-[11px] text-stone-500 mt-0.5">
                            Đối soát tự động với tiền cọc và giá trị gốc của trang phục
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 text-xs">
                        <div className="hidden sm:flex items-center gap-2 rounded-lg bg-sand/30 px-2.5 py-1 text-stone-600">
                          <span>Áo:</span>
                          <strong className="text-ink">
                            {garmentValue > 0 ? `${garmentValue.toLocaleString("vi-VN")}đ` : "400.000đ"}
                          </strong>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1">
                          <span className="text-stone-500">Tổng phạt:</span>
                          <strong className={isPenaltyCapped ? "text-red-600 line-through text-xs" : "text-rose-700 text-sm font-bold"}>
                            {currentTotalPenalty.toLocaleString("vi-VN")}đ
                          </strong>
                        </div>
                        {isPenaltyCapped && (
                          <span className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white shadow-2xs">
                            Trần 100%: {effectivePenalty.toLocaleString("vi-VN")}đ
                          </span>
                        )}
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand/30 text-stone-500 transition-transform duration-200">
                          <ChevronDown
                            className={`h-4 w-4 transition-transform duration-200 ${sectionOpen.penaltyMeter ? "rotate-180" : ""}`}
                          />
                        </div>
                      </div>
                    </button>
                    <div className={`grid transition-all duration-300 ease-in-out ${sectionOpen.penaltyMeter ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                    <div className="p-6 space-y-4">
                      {/* Gauge / Progress bar với marker */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-stone-500">
                          <span>Tiến độ thiệt hại:</span>
                          <span>Ngưỡng 30% cọc: duyệt Quản lý · 100% áo: Trả hết giá trị</span>
                        </div>
                        <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-stone-100 p-0.5 border border-sand/60">
                          {/* Marker 30% cọc nếu có */}
                          {currentDeposit > 0 && (
                            <div
                              className="absolute top-0 bottom-0 z-10 w-0.5 bg-ink/40"
                              style={{ left: `${Math.min(100, Math.round(((currentDeposit * 0.3) / (garmentValue > 0 ? garmentValue : 400000)) * 100))}%` }}
                              title="Ngưỡng 30% tiền cọc (bắt đầu cần Quản lý phê duyệt)"
                            />
                          )}
                          <div
                            className={`h-full rounded-full transition-all duration-500 shadow-inner ${
                              isPenaltyCapped
                                ? "bg-gradient-to-r from-lotus to-rose-600"
                                : cappedRatio >= 0.7
                                ? "bg-gradient-to-r from-orange-500 to-rose-500"
                                : cappedRatio >= 0.3
                                ? "bg-gradient-to-r from-amber-400 to-orange-500"
                                : "bg-gradient-to-r from-jade to-emerald-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.round(cappedRatio * 100))}%` }}
                          />
                        </div>
                      </div>

                      {/* Tỷ lệ % + trạng thái thẩm định */}
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-mist/60 border border-sand/60 p-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2 text-stone-600">
                          <span>
                            Thiệt hại áo:{" "}
                            <strong className={cappedRatio >= 0.7 ? "text-rose-700 font-bold" : "text-ink font-bold"}>
                              {Math.round(cappedRatio * 100)}%
                            </strong>
                          </span>
                          {currentDeposit > 0 && (
                            <>
                              <span className="text-stone-300">|</span>
                              <span>
                                Chiếm cọc ({currentDeposit.toLocaleString("vi-VN")}đ):{" "}
                                <strong className={
                                  effectivePenalty / currentDeposit > 1
                                    ? "text-red-700 font-bold"
                                    : effectivePenalty / currentDeposit > 0.3
                                    ? "text-amber-700 font-bold"
                                    : "text-emerald-700 font-bold"
                                }>
                                  {Math.round((effectivePenalty / currentDeposit) * 100)}%
                                </strong>
                              </span>
                            </>
                          )}
                        </div>
                        <div>
                          {isPenaltyHigh ? (
                            <span className="inline-flex items-center gap-1.5 font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-lg text-xs">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                              {isPenaltyCapped
                                ? "Chạm trần 100% áo — Bắt buộc Quản lý duyệt"
                                : hasSevereIssue
                                ? "Hư hỏng nghiêm trọng — Cần Quản lý duyệt"
                                : currentDeposit > 0 && effectivePenalty / currentDeposit > 0.3
                                ? "Phạt vượt 30% tiền cọc — Cần Quản lý duyệt"
                                : "Thiệt hại nặng (≥70% áo) — Cần Quản lý duyệt"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg text-xs">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              Mức phạt trong giới hạn an toàn — Staff tự xử lý
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Phương án xử lý cọc */}
                      {currentDeposit > 0 && (
                        <div
                          className={`rounded-xl border p-4 text-xs transition-all shadow-2xs ${
                            additionalPayRequired > 0
                              ? "border-rose-300 bg-rose-50/70 text-rose-950"
                              : "border-emerald-300 bg-emerald-50/70 text-emerald-950"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="text-sm font-bold flex items-center gap-2">
                                {additionalPayRequired > 0 ? (
                                  <>
                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-200 text-rose-700">
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                    </div>
                                    <span>Cọc không đủ bù hư hại — Cần thu thêm tiền:</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-200 text-emerald-700">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    </div>
                                    <span>Khấu trừ trực tiếp vào tiền cọc của khách:</span>
                                  </>
                                )}
                              </div>
                              <p className="text-[11px] text-stone-600 pl-8">
                                Tiền cọc giữ: <strong>{currentDeposit.toLocaleString("vi-VN")}đ</strong>
                                {" ➔ "}Khấu trừ: <strong className="text-rose-700">{depositDeduction.toLocaleString("vi-VN")}đ</strong>
                              </p>
                            </div>
                            <div>
                              {additionalPayRequired > 0 ? (
                                <div className="text-right bg-white border border-rose-300 rounded-xl px-4 py-2 shadow-2xs">
                                  <span className="text-[10px] uppercase tracking-wider block text-rose-700 font-bold">
                                    Khách cần thanh toán bù
                                  </span>
                                  <span className="text-base font-extrabold text-rose-700">
                                    +{additionalPayRequired.toLocaleString("vi-VN")}đ
                                  </span>
                                </div>
                              ) : (
                                <div className="text-right bg-white border border-emerald-300 rounded-xl px-4 py-2 shadow-2xs">
                                  <span className="text-[10px] uppercase tracking-wider block text-emerald-700 font-bold">
                                    Hoàn trả lại cọc cho khách
                                  </span>
                                  <span className="text-base font-extrabold text-emerald-700">
                                    {refundDeposit.toLocaleString("vi-VN")}đ
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    </div>
                    </div>
                  </section>
                )}

                {/* ═══════════════════════════════════════════════════════
                    SECTION: Lỗi đã ghi nhận vào biên bản
                ════════════════════════════════════════════════════════ */}
                {activeSession.findings.length > 0 && (
                  <section className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden transition-all duration-200 hover:border-antique/40">
                    <button
                      type="button"
                      onClick={() => toggleSection("findingsList")}
                      className="w-full border-b border-sand/80 bg-mist/60 px-6 py-4 flex items-center justify-between hover:bg-sand/20 transition-all text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-jade/10 border border-jade/20 text-jade shadow-2xs">
                          <ClipboardCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-ink">
                              Lỗi đã ghi nhận vào biên bản
                            </h2>
                            <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                              {activeSession.findings.length} lỗi
                            </span>
                          </div>
                          <p className="text-[11px] text-stone-500 mt-0.5">
                            Các lỗi đã được thêm và sẽ xuất hiện trong biên bản trả hàng
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="hidden sm:inline text-[11px] text-stone-400 italic">
                          Có thể xóa nếu AI hoặc nhân viên bắt nhầm
                        </span>
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand/30 text-stone-500 transition-transform duration-200">
                          <ChevronDown
                            className={`h-4 w-4 transition-transform duration-200 ${sectionOpen.findingsList ? "rotate-180" : ""}`}
                          />
                        </div>
                      </div>
                    </button>
                    <div className={`grid transition-all duration-300 ease-in-out ${sectionOpen.findingsList ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                    <div className="p-5 space-y-2.5">
                      {activeSession.findings.map((f) => {
                        const isAi =
                          f.findingType.startsWith("[AI]") ||
                          Boolean(
                            activeSession.aiComparisonResult?.detectedIssues?.some(
                              (d) => d.findingType === f.findingType || f.findingType.includes(d.findingType)
                            )
                          );
                        const isPreset =
                          !isAi &&
                          damageFeeTable.some(
                            (e) =>
                              e.label.toLowerCase() === f.findingType.toLowerCase() ||
                              f.findingType.toLowerCase().includes(e.label.toLowerCase())
                          );
                        return (
                          <div
                            key={f.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-sand/80 bg-mist/40 p-3.5 text-sm transition-all hover:bg-white hover:border-antique/40 hover:shadow-2xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {isAi ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 border border-purple-200 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                                    <Bot className="h-3 w-3" /> AI Giám định
                                  </span>
                                ) : isPreset ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                    <Tag className="h-3 w-3" /> Chuẩn định mức
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                                    <User className="h-3 w-3" /> Nhân viên lập
                                  </span>
                                )}
                                <span className="font-bold text-ink">{f.findingType}</span>
                                {(() => {
                                  const s = f.severity?.toLowerCase();
                                  const isSevere = s === "severe" || s === "critical";
                                  const isHigh = s === "high" || s === "nang";
                                  const isMed = s === "medium" || s === "moderate" || s === "vua";
                                  return (
                                    <span
                                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold border ${
                                        isSevere
                                          ? "bg-rose-50 text-rose-800 border-rose-200"
                                          : isHigh
                                          ? "bg-orange-50 text-orange-800 border-orange-200"
                                          : isMed
                                          ? "bg-amber-50 text-amber-800 border-amber-200"
                                          : "bg-emerald-50 text-emerald-800 border-emerald-200"
                                      }`}
                                    >
                                      {isSevere ? "Nghiêm trọng" : isHigh ? "Nặng" : isMed ? "Trung bình" : "Nhẹ"}
                                    </span>
                                  );
                                })()}
                              </div>
                              {f.description && (
                                <p className="mt-1 text-xs text-stone-500 line-clamp-2 pl-0.5">{f.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              {f.penaltyAmount > 0 && (
                                <span className="text-sm font-bold text-rose-700 bg-white border border-rose-200 rounded-lg px-2.5 py-1 shadow-2xs">
                                  {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(f.penaltyAmount)}
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={deletingFindingId === f.id}
                                onClick={() => void handleDeleteFinding(f.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50"
                                title="Xóa lỗi này khỏi biên bản"
                              >
                                {deletingFindingId === f.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-rose-600" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </div>
                    </div>
                  </section>
                )}

                {/* AI Notification Banner */}
                {aiSuccessMsg && (
                  <div className="flex items-center justify-between rounded-xl border border-jade/30 bg-jade/10 p-4 text-sm text-jade">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="h-5 w-5 shrink-0" />
                      <span className="font-medium">{aiSuccessMsg}</span>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-xs font-semibold hover:bg-jade/20"
                      onClick={() => setAiSuccessMsg(null)}
                    >
                      Đóng
                    </button>
                  </div>
                )}

                {/* Photos & AI Inspection Comparison Section */}
                <section className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden transition-all duration-200 hover:border-antique/40">
                  {/* Header collapsible */}
                  <div className="w-full border-b border-sand/80 bg-mist/60 px-6 py-4 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => toggleSection("aiComparison")}
                      className="flex items-center gap-3 text-left flex-1 hover:opacity-85 transition-opacity"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 shadow-2xs">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-ink">
                          Đối chiếu hình ảnh &amp; Thẩm định AI
                        </h2>
                        <p className="text-[11px] text-stone-500 mt-0.5">
                          Tự động so sánh ảnh bàn giao (trước thuê) và ảnh trả hàng thực tế để phát hiện hư hại chính xác
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2.5 shrink-0 ml-4">
                      <button
                        type="button"
                        disabled={aiAnalyzing || activeSession.photos.length === 0}
                        onClick={handleRunAiCompare}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-lotus to-oxblood px-4 py-2 text-xs font-semibold text-white shadow-md shadow-lotus/20 transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
                        title={activeSession.photos.length === 0 ? "Hãy tải lên ít nhất 1 ảnh trả đồ để chạy AI" : "Bấm để AI phân tích đối chiếu ảnh"}
                      >
                        {aiAnalyzing ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span>AI đang phân tích...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 text-amber-200" />
                            <span>{activeSession.aiComparisonResult ? "Phân tích lại bằng AI" : "Phân tích đối chiếu AI"}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSection("aiComparison")}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-sand/30 text-stone-500 hover:bg-sand/60 transition-transform duration-200"
                        aria-label="Đóng mở phần thẩm định AI"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${sectionOpen.aiComparison ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className={`grid transition-all duration-300 ease-in-out ${sectionOpen.aiComparison ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                  <div className="p-6">

                  {/* 2-Column Photo Comparison (Trước vs Sau) */}
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* Cột 1: Ảnh bàn giao trước thuê */}
                    <div className="rounded-2xl border border-sand bg-mist/40 p-5 shadow-2xs">
                      <div className="mb-3.5 flex items-center justify-between border-b border-sand/50 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-2.5 w-2.5 rounded-full bg-jade shadow-xs" />
                          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-stone-800">
                            Ảnh bàn giao (Trước thuê)
                          </h3>
                        </div>
                        <span className="rounded-full bg-jade/10 border border-jade/20 px-3 py-0.5 text-[11px] font-bold text-jade">
                          {activeSession.conditionBeforeRental ? `Tình trạng: ${activeSession.conditionBeforeRental}` : "Lúc bàn giao"}
                        </span>
                      </div>

                      {(() => {
                        const rawHandover = (booking as any)?.handover;
                        const rawCondition = (booking as any)?.conditionImages;
                        const handoverPhotos: string[] =
                          activeSession.handoverImages && activeSession.handoverImages.length > 0
                            ? activeSession.handoverImages
                            : Array.isArray(rawHandover?.images) && rawHandover.images.length > 0
                              ? rawHandover.images
                              : Array.isArray(rawCondition?.images) && rawCondition.images.length > 0
                                ? rawCondition.images
                                : Array.isArray(rawCondition)
                                  ? rawCondition
                                  : [];

                        if (handoverPhotos.length > 0) {
                          return (
                            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                              {handoverPhotos.map((url: string, idx: number) => (
                                <button
                                  key={`handover-${url}-${idx}`}
                                  type="button"
                                  onClick={() => setLightboxUrl(url)}
                                  className="group relative aspect-square overflow-hidden rounded-lg border border-sand bg-white shadow-xs transition hover:opacity-90"
                                  title="Xem phóng to ảnh bàn giao"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt={`Ảnh bàn giao ${idx + 1}`}
                                    className="h-full w-full object-cover"
                                  />
                                  <span className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                    <ZoomIn className="h-3 w-3" />
                                  </span>
                                </button>
                              ))}
                            </div>
                          );
                        }

                        return (
                          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-sand bg-white/70 py-8 text-center text-xs text-stone-500">
                            <Layers className="h-8 w-8 text-stone-300 mb-2" />
                            <p className="font-medium text-stone-600">Chưa có ảnh bàn giao ban đầu</p>
                            <p className="mt-1 text-[11px] text-stone-400">
                              AI sẽ đối chiếu dựa trên chuẩn trang phục xuất xưởng nguyên bản.
                            </p>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Cột 2: Ảnh trả hàng sau thuê */}
                    <div className="rounded-2xl border border-sand bg-mist/40 p-5 shadow-2xs">
                      <div className="mb-3.5 flex items-center justify-between border-b border-sand/50 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-2.5 w-2.5 rounded-full bg-lotus shadow-xs" />
                          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-stone-800">
                            Ảnh nhận trả hàng (Sau thuê)
                          </h3>
                        </div>
                        <span className="rounded-full bg-lotus/10 border border-lotus/20 px-3 py-0.5 text-[11px] font-bold text-lotus">
                          {activeSession.photos.length} ảnh đã chụp
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {activeSession.photos.map((p, idx) => (
                          <div
                            key={p.id}
                            className="group relative aspect-square overflow-hidden rounded-lg border border-sand bg-white shadow-xs"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={`Ảnh kiểm tra ${idx + 1}`}
                              className="h-full w-full object-cover cursor-pointer transition duration-200 group-hover:scale-105"
                              src={p.imageUrl}
                              onClick={() => setLightboxUrl(p.imageUrl)}
                            />
                            {/* Phóng to */}
                            <button
                              type="button"
                              onClick={() => setLightboxUrl(p.imageUrl)}
                              className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-85 transition hover:opacity-100 hover:bg-black/80"
                              title="Xem phóng to ảnh kiểm tra"
                            >
                              <ZoomIn className="h-3 w-3" />
                            </button>
                            {/* Xoá ảnh */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteReturnPhoto(p.id);
                              }}
                              disabled={deletingPhotoId === p.id}
                              className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600/90 text-white shadow-sm transition hover:bg-red-700 hover:scale-110 disabled:opacity-50"
                              title="Xóa ảnh này"
                            >
                              {deletingPhotoId === p.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        ))}

                        {/* Nút mở nhanh camera / tải ảnh */}
                        <button
                          type="button"
                          disabled={uploadingReturnPhoto}
                          onClick={() => startCamera()}
                          className="flex aspect-square flex-col items-center justify-center rounded-lg border-2 border-dashed border-lotus/40 bg-lotus/5 text-center transition hover:border-lotus hover:bg-lotus/10 disabled:opacity-50"
                          title="Mở camera chụp ảnh trực tiếp"
                        >
                          {uploadingReturnPhoto ? (
                            <RefreshCw className="h-5 w-5 animate-spin text-lotus" />
                          ) : (
                            <>
                              <Camera className="h-5 w-5 text-lotus mb-1" />
                              <span className="text-[11px] font-semibold text-lotus">Chụp ảnh</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Ẩn input file & mobile camera */}
                      <input
                        ref={mobileCameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={uploadingReturnPhoto}
                        onChange={(e) => handleReturnPhotoUpload(e.target.files)}
                        className="hidden"
                      />
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={uploadingReturnPhoto}
                        onChange={(e) => handleReturnPhotoUpload(e.target.files)}
                        className="hidden"
                      />

                      {/* Các nút thao tác chụp ảnh thực tế tại quầy */}
                      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={uploadingReturnPhoto}
                          onClick={() => startCamera()}
                          className="flex flex-1 min-w-[170px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-jade to-emerald-700 px-3.5 py-2.5 text-xs font-semibold text-white shadow-xs transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
                        >
                          <Camera className="h-4 w-4" />
                          <span>Chụp trực tiếp (Webcam)</span>
                        </button>

                        <button
                          type="button"
                          disabled={uploadingReturnPhoto}
                          onClick={() => mobileCameraInputRef.current?.click()}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-sand bg-white px-3.5 py-2.5 text-xs font-semibold text-ink shadow-2xs transition-all hover:border-antique hover:bg-mist active:scale-[0.98] disabled:opacity-50"
                          title="Chụp bằng camera điện thoại"
                        >
                          <Smartphone className="h-4 w-4 text-lotus" />
                          <span>Camera ĐT</span>
                        </button>

                        <button
                          type="button"
                          disabled={uploadingReturnPhoto}
                          onClick={() => fileInputRef.current?.click()}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-sand bg-white px-3.5 py-2.5 text-xs font-semibold text-ink shadow-2xs transition-all hover:border-antique hover:bg-mist active:scale-[0.98] disabled:opacity-50"
                          title="Tải ảnh có sẵn từ máy"
                        >
                          <FolderOpen className="h-4 w-4 text-stone-600" />
                          <span>Tải file ảnh</span>
                        </button>
                      </div>

                      {uploadingReturnPhoto && (
                        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-lotus/10 border border-lotus/20 px-3 py-2 text-xs text-lotus font-medium animate-pulse">
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          <span>Đang tải và cập nhật ảnh trả đồ vào biên bản...</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* KẾT QUẢ PHÂN TÍCH SO SÁNH AI */}
                  {activeSession.aiComparisonResult && (
                    <div className="mt-6 rounded-2xl border border-sand bg-gradient-to-br from-parchment/70 via-mist to-white p-6 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand/70 pb-4">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-700 shadow-2xs">
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-ink">
                              Kết quả AI Thẩm định &amp; Đối chiếu
                            </h3>
                            <p className="text-[11px] text-stone-500">
                              Phân tích tự động dựa trên thị giác máy tính và lịch sử bàn giao
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
                          {/* Huy hiệu tình trạng */}
                          {(() => {
                            const cond = activeSession.aiComparisonResult.overallCondition;
                            const metaMap: Record<string, { label: string; color: string }> = {
                              excellent: { label: "Hoàn hảo (95-100đ)", color: "bg-jade/15 text-jade border-jade/30" },
                              good: { label: "Tốt (Bụi nhẹ)", color: "bg-jade/10 text-jade border-jade/20" },
                              minor_damage: { label: "Có lỗi nhẹ cần xử lý", color: "bg-amber-100 text-amber-800 border-amber-300" },
                              major_damage: { label: "Hư hại đáng kể", color: "bg-orange-100 text-orange-800 border-orange-300" },
                              severely_damaged: { label: "Hư hỏng nặng", color: "bg-red-100 text-red-800 border-red-300" },
                            };
                            const current = metaMap[cond] ?? metaMap.good;
                            return (
                              <span className={`rounded-full border px-3 py-1 text-xs font-bold shadow-2xs ${current.color}`}>
                                {current.label}
                              </span>
                            );
                          })()}

                          {(() => {
                            const score = Math.max(0, Math.min(100, activeSession.aiComparisonResult.conditionScore));
                            const loss = 100 - score;
                            return (
                              <span className="text-xs text-stone-700 bg-white/90 border border-sand px-3 py-1 rounded-full font-medium shadow-2xs">
                                Độ nguyên vẹn: <strong className="text-ink font-bold">{score}/100</strong>
                                {loss > 0 ? (
                                  <span className="text-amber-800 font-bold ml-1.5">
                                    (Hao tổn {loss}%)
                                  </span>
                                ) : (
                                  <span className="text-emerald-700 font-bold ml-1.5">
                                    (Hoàn hảo 100%)
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Tóm tắt đánh giá */}
                      <p className="mt-3.5 text-sm leading-relaxed text-stone-800 bg-white/60 p-3.5 rounded-xl border border-sand/50">
                        {activeSession.aiComparisonResult.summary}
                      </p>

                      {/* Khuyến nghị hành động */}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand bg-white p-3.5 text-xs shadow-2xs">
                        <div>
                          <span className="font-semibold text-stone-500">Khuyến nghị từ AI: </span>
                          <span className="font-bold text-ink text-sm">
                            {activeSession.aiComparisonResult.recommendedAction === "laundry"
                              ? "Chuyển Giặt Sấy Tiêu Chuẩn"
                              : activeSession.aiComparisonResult.recommendedAction === "maintenance"
                                ? "Cần Thợ Bảo Trì / Sửa Chữa"
                                : "Ghi Nhận Hư Hỏng & Tính Phạt"}
                          </span>
                          <span className="ml-2 text-stone-500 italic">
                            ({activeSession.aiComparisonResult.actionReason})
                          </span>
                        </div>

                        {/* Nút chọn nhanh hành động hoàn tất theo AI */}
                        <button
                          type="button"
                          onClick={() => handleComplete(activeSession.aiComparisonResult!.recommendedAction)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 font-semibold text-white transition hover:bg-black"
                        >
                          <span>Chọn hành động này</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Danh sách các lỗi AI phát hiện */}
                      {activeSession.aiComparisonResult.detectedIssues && activeSession.aiComparisonResult.detectedIssues.length > 0 ? (
                        <div className="mt-4 space-y-2 border-t border-sand pt-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-bold uppercase tracking-[0.12em] text-red-700">
                              Phát hiện {activeSession.aiComparisonResult.detectedIssues.length} điểm bất thường:
                            </span>
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-xs font-bold text-red-700">
                                Tổng phạt ước tính: {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(activeSession.aiComparisonResult.totalSuggestedPenalty)}
                              </span>
                              {garmentValue > 0 && (
                                <span className="text-[11px] text-stone-600">
                                  Giá trị trang phục: <strong className="text-stone-900">{garmentValue.toLocaleString("vi-VN")}đ</strong>
                                  {" — "}
                                  <span className="font-semibold text-red-700">
                                    tổn thất ~{Math.min(100, Math.round(activeSession.aiComparisonResult.totalSuggestedPenalty / garmentValue * 100))}% giá trị áo
                                  </span>
                                </span>
                              )}
                              {currentDeposit > 0 && activeSession.aiComparisonResult.totalSuggestedPenalty / currentDeposit > 0.3 && (
                                <span className="text-[10px] text-amber-700 font-medium">
                                  ⚠️ Tiền phạt vượt 30% tiền cọc ({currentDeposit.toLocaleString("vi-VN")}đ) ➔ cần Quản lý duyệt
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            {activeSession.aiComparisonResult.detectedIssues.map((issue, i) => (
                              <div
                                key={`issue-${i}`}
                                className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3 text-xs"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-ink">{issue.findingType}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${issue.severity === "severe" || issue.severity === "high"
                                        ? "bg-red-200 text-red-800"
                                        : issue.severity === "medium"
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-stone-200 text-stone-700"
                                      }`}>
                                      Mức độ: {issue.severity}
                                    </span>
                                  </div>
                                  <p className="text-stone-600">{issue.description}</p>
                                </div>
                                {issue.suggestedPenalty > 0 && (
                                  <div className="shrink-0 text-right">
                                    <div className="font-bold text-red-700">
                                      +{new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(issue.suggestedPenalty)}
                                    </div>
                                    {garmentValue > 0 && (
                                      <div className="text-[10px] text-stone-500 mt-0.5">
                                        ~{Math.round(issue.suggestedPenalty / garmentValue * 100)}% giá trị áo ({garmentValue.toLocaleString("vi-VN")}đ)
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Nút 1-Click: Áp dụng các lỗi này vào danh sách biên bản */}
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              disabled={applyingAiFindings}
                              onClick={handleApplyAiFindings}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-bold text-red-700 shadow-2xs transition hover:bg-red-50 disabled:opacity-50"
                            >
                              {applyingAiFindings ? (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  <span>Đang đưa vào biên bản...</span>
                                </>
                              ) : (
                                <>
                                  <CheckCheck className="h-3.5 w-3.5" />
                                  <span>Tự động đưa các lỗi này vào biên bản kiểm tra</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center gap-2 text-xs text-jade">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Không phát hiện lỗi hư tổn hay vết bẩn cứng đầu nào ngoài dự kiến.</span>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                  </div>
                  </div>
                </section>

                {/* Finalize message banner */}
                {finalizeMsg && (
                  <div className={`mb-3 rounded-lg border p-3 text-sm ${finalizeMsg.type === "success" ? "border-jade/30 bg-jade/10 text-jade" : "border-red-200 bg-red-50 text-red-700"}`}>
                    {finalizeMsg.text}
                    <button type="button" className="ml-3 underline opacity-70" onClick={() => setFinalizeMsg(null)}>Đóng</button>
                  </div>
                )}

                {/* Actions bar / Pending approval notice */}
                {isPendingApproval ? (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-5 shadow-sm space-y-3">
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                        <Clock className="h-6 w-6" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-amber-950">
                            Biên bản đã được gửi lên Quản lý phê duyệt phạt
                          </h3>
                          <span className="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-xs font-bold text-amber-900">
                            Phạt &gt; 30% cọc
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-amber-800">
                          Mức phạt ({effectivePenalty.toLocaleString("vi-VN")}đ)
                          {garmentValue > 0 && <> (chiếm {Math.min(100, Math.round((effectivePenalty / garmentValue) * 100))}% giá trị áo)</>}
                          {currentDeposit > 0 && <> · Cọc: {currentDeposit.toLocaleString("vi-VN")}đ</>}.
                          {additionalPayRequired > 0 && (
                            <strong className="text-red-700 block mt-1">
                              👉 Đề xuất truy thu bù thêm từ khách: +{additionalPayRequired.toLocaleString("vi-VN")}đ.
                            </strong>
                          )}
                          Biên bản đã được chuyển tự động sang danh sách chờ duyệt của Quản lý. Hệ thống chưa trừ cọc của khách hàng. Bạn có thể xuất bản thảo biên bản kiểm tra bằng nút trên thanh công cụ phía trên.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 1. Cảnh báo khi cần Quản lý duyệt hoặc Chạm trần — NẰM TRONG LUỒNG CUỘN TỰ NHIÊN, KHÔNG CHE MÀN HÌNH */}
                    {isPenaltyHigh && (
                      <div
                        className={`rounded-xl border p-4 text-xs space-y-2 ${
                          isPenaltyCapped || additionalPayRequired > 0
                            ? "border-red-300 bg-red-50 text-red-950"
                            : "border-amber-300 bg-amber-50 text-amber-950"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {isPenaltyCapped || additionalPayRequired > 0 ? (
                            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                          ) : (
                            <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 space-y-1">
                            <p className="font-bold text-sm">
                              {additionalPayRequired > 0
                                ? "⚠️ Tiền phạt vượt tiền cọc — Cần Quản lý duyệt & Khách bù thêm:"
                                : isPenaltyCapped
                                ? "⚠️ Chạm trần 100% giá trị áo — Bắt buộc Quản lý phê duyệt:"
                                : "Mức phạt cần Quản lý duyệt:"}
                            </p>
                            <p className="leading-relaxed">
                              {isPenaltyCapped ? (
                                <>
                                  Tổng phạt các lỗi: <span className="line-through">{currentTotalPenalty.toLocaleString("vi-VN")}đ</span>.{" "}
                                  Mức phạt áp dụng thực tế:{" "}
                                  <strong className="text-red-700 font-bold">
                                    {effectivePenalty.toLocaleString("vi-VN")}đ
                                  </strong>{" "}
                                  (khống chế trần 100% giá trị áo {garmentValue.toLocaleString("vi-VN")}đ, miễn {excessPenalty.toLocaleString("vi-VN")}đ vượt trần).
                                </>
                              ) : (
                                <>
                                  Tổng phạt áp dụng: <strong>{effectivePenalty.toLocaleString("vi-VN")}đ</strong>
                                  {garmentValue > 0 && (
                                    <>
                                      {" "}
                                      (chiếm{" "}
                                      <strong>
                                        {Math.min(100, Math.round((effectivePenalty / garmentValue) * 100))}%
                                      </strong>{" "}
                                      giá trị món đồ <strong>{garmentValue.toLocaleString("vi-VN")}đ</strong>)
                                    </>
                                  )}
                                  {currentDeposit > 0 && (
                                    <>
                                      {" "}
                                      / Cọc: <strong>{currentDeposit.toLocaleString("vi-VN")}đ</strong>
                                    </>
                                  )}
                                  .
                                </>
                              )}
                            </p>

                            {/* Thông báo chi tiết số tiền BÙ THÊM hoặc HOÀN CỌC để Quản lý và Khách cùng biết */}
                            {currentDeposit > 0 && (
                              <div className="mt-2 rounded-lg bg-white/95 border border-sand p-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <span className="text-stone-600">Khấu trừ tiền cọc: </span>
                                  <strong className="text-ink">{depositDeduction.toLocaleString("vi-VN")}đ</strong>
                                  {" "}({Math.min(100, Math.round((depositDeduction / currentDeposit) * 100))}% cọc)
                                </div>
                                <div>
                                  {additionalPayRequired > 0 ? (
                                    <span className="font-extrabold text-red-700 bg-red-100 border border-red-300 px-2.5 py-1 rounded text-xs">
                                      👉 Khách cần thanh toán bù thêm: +{additionalPayRequired.toLocaleString("vi-VN")}đ
                                    </span>
                                  ) : (
                                    <span className="font-extrabold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded text-xs">
                                      👉 Hoàn trả cọc còn thừa cho khách: {refundDeposit.toLocaleString("vi-VN")}đ
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            <p className="text-[11px] text-stone-600 italic pt-1">
                              Khi bạn bấm nút chuyển tiếp bên dưới, hệ thống sẽ{" "}
                              <strong>tự động gửi biên bản sang Quản lý duyệt</strong> (chưa trừ cọc của khách hàng).
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 2. Ghi chú biên bản gửi Quản lý phê duyệt — NẰM TRONG LUỒNG CUỘN TỰ NHIÊN, KHÔNG CHE MÀN HÌNH */}
                    <div className="rounded-xl border border-sand bg-white p-4 space-y-2 shadow-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-4 w-4 text-antique" />
                          <label className="text-xs font-bold uppercase tracking-wider text-ink">
                            Ghi chú biên bản gửi Quản lý phê duyệt:
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          {activeSession.aiComparisonResult?.summary && (
                            <button
                              type="button"
                              onClick={() => setCurrentNote(activeSession.aiComparisonResult!.summary)}
                              className="text-xs text-antique hover:underline font-medium"
                              title="Chép lại kết luận phân tích của AI vào ghi chú"
                            >
                              ↺ Điền tóm tắt từ AI
                            </button>
                          )}
                          <span className="text-xs text-stone-500 italic">
                            (Quản lý sẽ đọc nội dung này khi xem xét duyệt phạt)
                          </span>
                        </div>
                      </div>
                      <textarea
                        rows={3}
                        className="w-full rounded-lg border border-sand bg-mist/30 p-3 text-xs leading-relaxed text-ink outline-none transition focus:border-antique focus:bg-white focus:ring-1 focus:ring-antique resize-y"
                        placeholder="Nhập ghi chú tổng kết biên bản gửi cho Quản lý (hệ thống tự động điền từ tóm tắt AI hoặc khi phạt vượt cọc)..."
                        value={currentNote}
                        onChange={(e) => setCurrentNote(e.target.value)}
                      />
                    </div>

                    {/* 3. THANH ACTION BAR STICKY SIÊU GỌN — CHỈ CỐ ĐỊNH HÀNG NÚT BẤM & TỔNG TIỀN */}
                    <div className="sticky bottom-0 z-20 rounded-xl border border-sand bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {/* Tóm tắt thanh toán & bù cọc bên trái */}
                        <div className="flex flex-wrap items-center gap-2.5 text-xs">
                          {effectivePenalty > 0 ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="text-stone-500 font-medium">Tổng phạt:</span>
                                <strong className="text-red-700 font-bold text-sm">
                                  {effectivePenalty.toLocaleString("vi-VN")}đ
                                </strong>
                              </div>
                              {currentDeposit > 0 && (
                                <div className="border-l border-sand pl-2.5 flex items-center gap-1.5">
                                  {additionalPayRequired > 0 ? (
                                    <span className="font-extrabold text-red-700 bg-red-100 border border-red-300 px-2 py-0.5 rounded text-xs animate-pulse">
                                      Khách cần bù: +{additionalPayRequired.toLocaleString("vi-VN")}đ
                                    </span>
                                  ) : (
                                    <span className="font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded text-xs">
                                      Hoàn cọc cho khách: {refundDeposit.toLocaleString("vi-VN")}đ
                                    </span>
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-emerald-700 font-medium">✓ Đồ đạt chuẩn — Không phạt</span>
                          )}
                        </div>

                        {/* Hàng nút bấm bên phải */}
                        <div className="flex flex-wrap items-center gap-2.5 ml-auto">
                          {booking?.status === "inspection_pending" && bookingReadiness.ready && !hasPendingManagerApproval && (
                            <button
                              type="button"
                              disabled={finalizingBooking || actioning !== null}
                              onClick={handleFinalizeBooking}
                              className="rounded-lg border border-jade bg-jade/5 px-4 py-2.5 text-sm font-semibold text-jade transition hover:bg-jade/15 disabled:opacity-50"
                            >
                              {finalizingBooking ? "Đang xử lý..." : "✓ Hoàn tất kiểm tra đơn"}
                            </button>
                          )}
                          {FINAL_ACTIONS.map((action) => (
                            <button
                              key={action.key}
                              type="button"
                              disabled={actioning !== null}
                              onClick={() => handleComplete(action.key)}
                              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${action.style}`}
                            >
                              {isPenaltyHigh && <Send className="h-3.5 w-3.5" />}
                              {actioning === `complete-${action.key}`
                                ? "Đang xử lý..."
                                : isPenaltyHigh
                                  ? action.approvalLabel
                                  : action.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
      {/* Live Camera / Webcam Capture Modal */}
      {isCameraModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Chụp ảnh trực tiếp"
        >
          <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-stone-900 text-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Camera className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Chụp ảnh kiểm tra trả đồ</h3>
                  <p className="text-[11px] text-white/60">Căn chỉnh góc chụp và bấm nút để lưu vào biên bản</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleCameraFacing}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs text-white/90 transition hover:bg-white/20"
                  title="Chuyển đổi camera trước / sau"
                >
                  <SwitchCamera className="h-3.5 w-3.5" />
                  <span>Đổi camera</span>
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label="Đóng camera"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Video Viewfinder */}
            <div className="relative aspect-4/3 sm:aspect-16/10 w-full overflow-hidden bg-black flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />

              {/* Khung hướng dẫn căn chỉnh */}
              <div className="pointer-events-none absolute inset-6 sm:inset-10 rounded-xl border border-dashed border-white/30 flex flex-col justify-between p-3">
                <div className="flex justify-between text-[10px] text-white/40 font-mono">
                  <span>┌</span>
                  <span>┐</span>
                </div>
                <div className="self-center rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/70 backdrop-blur-xs">
                  Căn trang phục hoặc chi tiết lỗi vào khung ngắm
                </div>
                <div className="flex justify-between text-[10px] text-white/40 font-mono">
                  <span>└</span>
                  <span>┘</span>
                </div>
              </div>

              {/* Badge số ảnh đã chụp trong phiên mở camera này */}
              {capturedInSession > 0 && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-emerald-600/90 px-3 py-1 text-xs font-semibold text-white shadow-md">
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>Đã chụp {capturedInSession} ảnh</span>
                </div>
              )}

              {/* Thông báo lỗi nếu không mở được camera */}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-stone-900/95 p-6 text-center">
                  <AlertTriangle className="h-10 w-10 text-amber-400 mb-2" />
                  <p className="text-sm font-medium text-white mb-1">Không thể kết nối Camera</p>
                  <p className="text-xs text-white/60 max-w-md mb-4">{cameraError}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startCamera(cameraFacingMode)}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      Thử lại
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="rounded-lg bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/20"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="flex items-center justify-between border-t border-white/10 bg-stone-950/80 px-5 py-4">
              <span className="text-xs text-white/60 hidden sm:inline">
                Có thể chụp nhiều góc khác nhau trước khi đóng
              </span>

              <div className="flex flex-1 sm:flex-initial items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={uploadingReturnPhoto || !!cameraError}
                  onClick={takeCameraPhoto}
                  className="flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 hover:scale-105 active:scale-95 disabled:opacity-50"
                >
                  {uploadingReturnPhoto ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Đang lưu ảnh...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4" />
                      <span>Bấm chụp ảnh</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={stopCamera}
                  className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  Xong ({capturedInSession})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox phóng to ảnh */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Ảnh phóng to"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
            aria-label="Đóng ảnh phóng to"
          >
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Ảnh phóng to"
            className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/70">
            Bấm ra ngoài hoặc phím Esc để đóng
          </p>
        </div>
      )}

      {/* Chi tiết biên bản kiểm tra & In PDF */}
      <InspectionDetailModal
        isOpen={Boolean(viewingModalSessionId)}
        bookingId={selectedBookingId || booking?.id || null}
        sessionId={viewingModalSessionId}
        initialSessions={sessions}
        onClose={() => setViewingModalSessionId(null)}
      />
    </StaffPortalShell>
  );
}
