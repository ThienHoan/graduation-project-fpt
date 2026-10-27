"use client";

import React, { useEffect, useState } from "react";
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ShieldAlert,
  Shirt,
  Calendar,
  User,
  ExternalLink,
  Edit3,
  Save,
  Clock,
  ArrowRight,
} from "lucide-react";
import {
  getBookingInspections,
  type InspectionSessionResponse,
  type InspectionFindingResponse,
} from "@/lib/api";

function formatVND(amount: number): string {
  return amount.toLocaleString("vi-VN") + "đ";
}

function getSeverityBadge(severity?: string | null) {
  const s = severity?.toLowerCase();
  if (s === "critical" || s === "severe") {
    return {
      label: "Nghiêm trọng",
      className: "bg-red-100 text-red-800 border border-red-300 font-semibold",
    };
  }
  if (s === "high" || s === "nang") {
    return {
      label: "Nặng",
      className: "bg-orange-100 text-orange-800 border border-orange-300 font-semibold",
    };
  }
  if (s === "medium" || s === "moderate" || s === "vua") {
    return {
      label: "Trung bình",
      className: "bg-amber-100 text-amber-800 border border-amber-300 font-semibold",
    };
  }
  return {
    label: "Nhẹ",
    className: "bg-blue-100 text-blue-700 border border-blue-200 font-semibold",
  };
}

interface InspectionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingId?: string | null;
  sessionId?: string | null;
  isManager?: boolean;
  onUpdated?: () => void;
  showToast?: (type: "success" | "error", message: string) => void;
}

export function InspectionDetailModal({
  isOpen,
  onClose,
  bookingId,
  sessionId,
  isManager = false,
  onUpdated,
  showToast,
}: InspectionDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<InspectionSessionResponse[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSessions([]);
      setSelectedSessionId(null);
      return;
    }

    if (bookingId) {
      setLoading(true);
      getBookingInspections(bookingId)
        .then((res) => {
          if (res.success && res.data) {
            setSessions(res.data);
            if (sessionId) {
              const matched = res.data.find((s) => s.id === sessionId);
              setSelectedSessionId(matched ? matched.id : res.data[0]?.id ?? null);
            } else {
              setSelectedSessionId(res.data[0]?.id ?? null);
            }
          } else {
            setSessions([]);
          }
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, bookingId, sessionId]);

  const activeSession = sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null;

  if (!isOpen) return null;

  const aiResult = activeSession?.aiComparisonResult;
  const sessionGarmentValue =
    Number(activeSession?.asset?.purchaseCost) ||
    Number(aiResult?.garmentValue) ||
    0;
  const integrityScore =
    aiResult && typeof aiResult.conditionScore === "number"
      ? Math.max(0, Math.min(100, Math.round(aiResult.conditionScore)))
      : null;
  const wearPercentage = integrityScore !== null ? Math.max(0, 100 - integrityScore) : null;

  // Calculate effective session penalty:
  // If Manager approved, effective penalty is the sum of manager-approved findings.
  const managerFindings = activeSession?.findings.filter((f) => f.findingType.startsWith("[Quản lý")) ?? [];
  const effectiveFindings = managerFindings.length > 0
    ? managerFindings
    : (activeSession?.findings.filter((f) => !f.findingType.startsWith("[Staff")) ?? []);
  const rawSessionPenalty = (effectiveFindings.length > 0 ? effectiveFindings : (activeSession?.findings ?? [])).reduce(
    (sum, f) => sum + Number(f.penaltyAmount),
    0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" data-lenis-prevent>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative z-10 flex flex-col max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-sand bg-white shadow-2xl" data-lenis-prevent>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sand bg-mist px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lotus/10 text-lotus">
              <Shirt className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-serif text-lg font-semibold text-ink">
                  Biên bản thẩm định trả đồ
                </h3>
                {bookingId && (
                  <span className="rounded-md bg-stone-200/80 px-2 py-0.5 font-mono text-xs font-medium text-stone-700">
                    #{bookingId.slice(0, 8).toUpperCase()}
                  </span>
                )}
                {activeSession?.status === "pending_manager_approval" && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-300">
                    Chờ Quản lý duyệt phạt
                  </span>
                )}
                {activeSession?.status === "completed" && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-300">
                    Đã hoàn tất
                  </span>
                )}
                {activeSession?.status === "in_progress" && (
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 border border-blue-300">
                    Đang kiểm tra
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500">
                Chi tiết kết quả đối chiếu AI &amp; biên bản ghi nhận lỗi hư hại
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sessions tabs if booking has multiple garments */}
        {sessions.length > 1 && (
          <div className="flex overflow-x-auto border-b border-sand bg-white px-6 py-2 gap-2">
            {sessions.map((s, idx) => {
              const active = s.id === selectedSessionId;
              const hasPenalty = s.findings.some((f) => Number(f.penaltyAmount) > 0);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedSessionId(s.id);
                  }}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                    active
                      ? "bg-lotus text-white shadow-sm"
                      : "bg-mist text-stone-600 hover:bg-sand/40"
                  }`}
                >
                  <span>
                    {s.asset?.garment?.name ?? `Trang phục #${idx + 1}`}
                  </span>
                  {s.asset?.assetCode && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${active ? "bg-white/20 text-white" : "bg-stone-200 text-stone-600"}`}>
                      {s.asset.assetCode}
                    </span>
                  )}
                  {hasPenalty && (
                    <span className={`h-2 w-2 rounded-full ${active ? "bg-amber-300" : "bg-amber-500"}`} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-6" data-lenis-prevent>
          {loading ? (
            <div className="py-20 text-center text-stone-400">
              <Clock className="mx-auto h-8 w-8 animate-spin text-lotus mb-2" />
              Đang tải biên bản kiểm tra...
            </div>
          ) : !activeSession ? (
            <div className="py-16 text-center text-stone-400">
              Không tìm thấy biên bản kiểm tra cho đơn hàng này.
            </div>
          ) : (
            <>
              {/* Pending Manager Approval Banner */}
              {activeSession.status === "pending_manager_approval" && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-amber-900 shadow-xs">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
                  <div className="text-xs leading-relaxed space-y-1">
                    <p className="font-semibold text-amber-950 text-sm">
                      Biên bản đang chờ Quản lý duyệt mức phạt
                    </p>
                    <p className="text-amber-800">
                      Mức phạt phát sinh vượt ngưỡng tự duyệt của Nhân viên (&gt;30% tiền cọc hoặc vượt cọc). Hệ thống chưa khấu trừ cọc hay ghi nhận công nợ cho đến khi Quản lý phê duyệt hoặc điều chỉnh mức phạt.
                    </p>
                  </div>
                </div>
              )}

              {/* Garment & Inspector meta */}
              <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-sand bg-mist/40 p-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase font-semibold tracking-wider text-stone-500">
                    Trang phục kiểm tra
                  </p>
                  <p className="font-semibold text-ink text-base">
                    {activeSession.asset?.garment?.name ?? "Trang phục"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 font-mono">
                    <span>Mã tài sản: {activeSession.asset?.assetCode}</span>
                    {activeSession.asset?.garment?.sizeLabel && (
                      <span className="rounded bg-sand/40 px-1.5 py-0.5 text-stone-700">
                        Size: {activeSession.asset.garment.sizeLabel}
                      </span>
                    )}
                    {Number(activeSession.asset?.purchaseCost) > 0 && (
                      <span className="rounded bg-sand/40 px-1.5 py-0.5 font-sans font-semibold text-stone-800">
                        Giá trị: {Number(activeSession.asset.purchaseCost).toLocaleString("vi-VN")}đ
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1 sm:text-right">
                  <p className="text-xs uppercase font-semibold tracking-wider text-stone-500">
                    Người thẩm định &amp; Thời gian
                  </p>
                  <div className="flex items-center sm:justify-end gap-1.5 text-sm font-medium text-ink">
                    <User className="h-4 w-4 text-stone-400" />
                    <span>{activeSession.inspector?.fullName ?? "Nhân viên thẩm định"}</span>
                  </div>
                  <div className="flex items-center sm:justify-end gap-1.5 text-xs text-stone-500">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {activeSession.completedAt
                        ? new Date(activeSession.completedAt).toLocaleString("vi-VN")
                        : new Date(activeSession.createdAt).toLocaleString("vi-VN")}
                    </span>
                  </div>
                </div>
              </div>

              {/* AI Analysis & Integrity Score Box */}
              {integrityScore !== null && (
                <div className="rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50/70 to-orange-50/50 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-amber-950 text-sm">
                          Đánh giá AI: Độ nguyên vẹn {integrityScore}/100 (Hao tổn {wearPercentage}%)
                          {sessionGarmentValue > 0 && (
                            <span className="font-normal text-amber-900 ml-2">
                              • Giá trị trang phục: <strong>{sessionGarmentValue.toLocaleString("vi-VN")}đ</strong>
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-amber-800">
                          {aiResult?.actionReason || "Kết quả so sánh trạng thái trước và sau khi khách thuê"}
                        </p>
                      </div>
                    </div>
                    {aiResult?.recommendedAction && (
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                        aiResult.recommendedAction === "laundry"
                          ? "bg-blue-100 text-blue-700"
                          : aiResult.recommendedAction === "maintenance"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-700"
                      }`}>
                        Đề xuất: {
                          aiResult.recommendedAction === "laundry"
                            ? "Giặt sấy thông thường"
                            : aiResult.recommendedAction === "maintenance"
                            ? "Cần bảo trì kỹ thuật"
                            : "Hư hỏng nặng không thể sửa"
                        }
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Photo Comparison: Handover (Before) vs Inspection (After) */}
              <div className="space-y-3">
                <h4 className="font-serif text-sm font-semibold uppercase tracking-wider text-stone-600">
                  Bằng chứng ảnh đối chiếu (Trước &amp; Sau khi trả)
                </h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Before / Handover Photos */}
                  <div className="rounded-xl border border-sand bg-mist/30 p-3.5 space-y-2">
                    <p className="text-xs font-semibold text-stone-600 flex items-center justify-between">
                      <span>Ảnh bàn giao lúc nhận đồ</span>
                      <span className="text-[11px] font-normal text-stone-400">
                        {activeSession.handoverImages?.length ?? 0} ảnh
                      </span>
                    </p>
                    {activeSession.handoverImages && activeSession.handoverImages.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {activeSession.handoverImages.map((url, i) => (
                          <div
                            key={i}
                            onClick={() => setLightboxImage(url)}
                            className="group relative aspect-square overflow-hidden rounded-lg border border-sand bg-white cursor-pointer hover:opacity-95"
                          >
                            <img
                              src={url}
                              alt={`Bàn giao ${i + 1}`}
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-stone-900/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                              <ExternalLink className="h-4 w-4 text-white" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-xs text-stone-400 border border-dashed border-sand rounded-lg">
                        Chưa có ảnh bàn giao lưu trữ
                      </div>
                    )}
                  </div>

                  {/* After / Inspection Photos */}
                  <div className="rounded-xl border border-sand bg-mist/30 p-3.5 space-y-2">
                    <p className="text-xs font-semibold text-stone-600 flex items-center justify-between">
                      <span>Ảnh lúc nhận trả hàng (Kiểm tra)</span>
                      <span className="text-[11px] font-normal text-stone-400">
                        {activeSession.photos?.length ?? 0} ảnh
                      </span>
                    </p>
                    {activeSession.photos && activeSession.photos.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {activeSession.photos.map((p) => (
                          <div
                            key={p.id}
                            onClick={() => setLightboxImage(p.imageUrl)}
                            className="group relative aspect-square overflow-hidden rounded-lg border border-sand bg-white cursor-pointer hover:opacity-95"
                          >
                            <img
                              src={p.imageUrl}
                              alt="Ảnh kiểm tra"
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-stone-900/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                              <ExternalLink className="h-4 w-4 text-white" />
                            </div>
                            {p.note && (
                              <div className="absolute bottom-0 inset-x-0 bg-black/60 p-1 text-[10px] text-white truncate">
                                {p.note}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-xs text-stone-400 border border-dashed border-sand rounded-lg">
                        Không có ảnh chụp lúc kiểm tra
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Findings & Penalty breakdown */}
              {/* Findings table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-serif text-sm font-semibold uppercase tracking-wider text-stone-600 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span>Các điểm bất thường &amp; Lỗi hư hại ghi nhận ({activeSession.findings.length})</span>
                  </h4>
                  {managerFindings.length > 0 && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-300">
                      Đã có phê duyệt của Quản lý
                    </span>
                  )}
                </div>

                {activeSession.findings.length === 0 ? (
                  <div className="rounded-xl border border-sand bg-mist/20 p-6 text-center text-sm text-stone-500">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-jade mb-2" />
                    Trang phục nguyên vẹn, không phát sinh lỗi hư hại nào.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-sand bg-white shadow-sm">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-mist text-xs uppercase tracking-wider text-stone-500">
                        <tr>
                          <th className="px-4 py-3">Phân loại &amp; Người lập</th>
                          <th className="px-4 py-3">Mức độ</th>
                          <th className="px-4 py-3">Chi tiết ghi nhận hư hỏng</th>
                          <th className="px-4 py-3 text-right">Mức phạt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sand">
                        {activeSession.findings.map((finding) => {
                          const isStaffProposal = finding.findingType.startsWith("[Staff");
                          const isManagerApproval = finding.findingType.startsWith("[Quản lý phê duyệt]");
                          const isManagerReject = finding.findingType.startsWith("[Quản lý từ chối]");
                          const displayTypeName = finding.findingType
                            .replace(/^\[(Staff thẩm định|Staff đề xuất|Quản lý phê duyệt|Quản lý từ chối phạt)\]\s*/i, "")
                            .trim();

                          return (
                            <tr
                              key={finding.id}
                              className={`transition ${
                                isManagerApproval
                                  ? "bg-emerald-50/40 hover:bg-emerald-50/70"
                                  : isManagerReject
                                  ? "bg-stone-50 hover:bg-stone-100/60"
                                  : isStaffProposal && managerFindings.length > 0
                                  ? "bg-mist/30 opacity-80"
                                  : "hover:bg-mist/30"
                              }`}
                            >
                              <td className="px-4 py-3">
                                <div className="space-y-1">
                                  <p className="font-semibold text-ink">{displayTypeName}</p>
                                  {isStaffProposal && (
                                    <span className="inline-block rounded bg-stone-200/80 px-2 py-0.5 text-[10px] font-medium text-stone-700">
                                      Staff thẩm định (Đề xuất)
                                    </span>
                                  )}
                                  {isManagerApproval && (
                                    <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-300">
                                      Quản lý phê duyệt (Chính thức)
                                    </span>
                                  )}
                                  {isManagerReject && (
                                    <span className="inline-block rounded bg-stone-200 px-2 py-0.5 text-[10px] font-bold text-stone-700">
                                      Quản lý từ chối phạt
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {(() => {
                                  const sev = getSeverityBadge(finding.severity);
                                  return (
                                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${sev.className}`}>
                                      {sev.label}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3 text-stone-600 text-xs sm:text-sm">
                                <p className="whitespace-pre-line leading-relaxed">{finding.description ?? "—"}</p>
                              </td>
                              <td className="px-4 py-3 text-right font-medium tabular-nums whitespace-nowrap">
                                <div>
                                  <span
                                    className={`text-sm ${
                                      isManagerApproval
                                        ? "font-extrabold text-red-600"
                                        : isStaffProposal && managerFindings.length > 0
                                        ? "text-stone-400 line-through"
                                        : Number(finding.penaltyAmount) > 0
                                        ? "font-bold text-red-600"
                                        : "text-stone-400"
                                    }`}
                                  >
                                    {formatVND(Number(finding.penaltyAmount))}
                                  </span>
                                  {Number(finding.penaltyAmount) > 0 && sessionGarmentValue > 0 && (!isStaffProposal || managerFindings.length === 0) && (
                                    <p className="text-[10px] text-stone-500 font-normal mt-0.5">
                                      ~{Math.round(Number(finding.penaltyAmount) / sessionGarmentValue * 100)}% giá trị áo
                                    </p>
                                  )}
                                  {isStaffProposal && managerFindings.length > 0 && (
                                    <p className="text-[10px] text-stone-400 font-normal">Mức đề xuất cũ</p>
                                  )}
                                  {isManagerApproval && (
                                    <p className="text-[10px] text-emerald-700 font-semibold">Áp dụng thanh toán</p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Staff note if present */}
              {activeSession.note && (
                <div className="rounded-xl border border-sand bg-mist/30 p-3.5 text-xs text-stone-600 space-y-1">
                  <span className="font-semibold text-ink">Ghi chú &amp; Lịch sử phiên: </span>
                  <p className="text-stone-700">{activeSession.note}</p>
                </div>
              )}

              {/* Financial summary for this inspection */}
              <div className="rounded-xl border border-sand bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <span className="text-stone-700 font-semibold">Tổng tiền phạt chính thức áp dụng:</span>
                    {sessionGarmentValue > 0 && (
                      <p className="text-xs text-stone-500 mt-0.5">
                        Giá trị trang phục: <strong>{sessionGarmentValue.toLocaleString("vi-VN")}đ</strong>
                        {rawSessionPenalty > 0 && (
                          <span className="text-red-600 font-medium ml-1">
                            (chiếm ~{Math.min(100, Math.round(rawSessionPenalty / sessionGarmentValue * 100))}% giá trị áo)
                          </span>
                        )}
                      </p>
                    )}
                    {managerFindings.length > 0 && (
                      <p className="text-xs text-emerald-700 font-medium mt-0.5">
                        ✓ Số tiền thực tế khấu trừ theo phê duyệt của Quản lý.
                      </p>
                    )}
                  </div>
                  <span className="text-xl font-extrabold text-red-600 tabular-nums">
                    {formatVND(rawSessionPenalty)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-sand bg-mist px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-stone-800 px-5 py-2 text-sm font-semibold text-white hover:bg-stone-900 transition"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Lightbox for full image view */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={lightboxImage}
              alt="Phóng to ảnh"
              className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute top-2 right-2 rounded-full bg-black/60 p-2 text-white hover:bg-black transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
