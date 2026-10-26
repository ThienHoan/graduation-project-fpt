"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { createDecartClient, models, type RealTimeClient } from "@decartai/sdk";
import {
  X,
  Camera,
  RefreshCw,
  VideoOff,
  Sparkles,
  Download,
  AlertCircle,
  Sliders,
  Maximize2,
  Minimize2,
  Check,
  ChevronRight,
  ShieldCheck,
  Zap,
  Lock,
  ShoppingBag,
  ArrowRight,
  Gift,
  Copy,
  Tag,
  Clock,
  Ruler,
  User,
} from "lucide-react";
import type { GarmentGrouped } from "@/lib/api";
import { readStoredAccessToken } from "@/lib/auth";
import { BodySilhouetteGuide } from "./body-silhouette-guide";
import { GiftUnboxing } from "./gift-unboxing";

interface RealtimeTryOnModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialGarment?: GarmentGrouped | null;
  garments?: GarmentGrouped[];
}

type ModalStatus = "idle" | "requesting_camera" | "aligning_pose" | "authenticating" | "connecting_webrtc" | "streaming" | "error" | "session_ended";
type ErrorCode = "UNAUTHORIZED" | "QUOTA_EXCEEDED" | "SESSION_TIMEOUT" | "TAB_BLURRED" | "DECART_ERROR" | null;

export function RealtimeTryOnModal({
  isOpen,
  onClose,
  initialGarment = null,
  garments = [],
}: RealtimeTryOnModalProps) {
  // Elements
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const alignmentVideoRef = useRef<HTMLVideoElement | null>(null);

  // States
  const [modalStatus, setModalStatus] = useState<ModalStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode>(null);
  const [remainingSessionsToday, setRemainingSessionsToday] = useState<number | null>(null);
  const [maxDailySessions, setMaxDailySessions] = useState<number>(2);
  const [hasMeasurementsBonus, setHasMeasurementsBonus] = useState<boolean>(false);
  const [voucherCode, setVoucherCode] = useState<string>("COPHUC-LIVE10");
  const [voucherCopied, setVoucherCopied] = useState<boolean>(false);
  const [selectedGarment, setSelectedGarment] = useState<GarmentGrouped | null>(initialGarment);
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isUpdatingGarment, setIsUpdatingGarment] = useState(false);
  const [showLocalPreview, setShowLocalPreview] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasCapturedSnapshot, setHasCapturedSnapshot] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [showBodyGuide, setShowBodyGuide] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState(15); // Cấu hình 15s 1 bộ đồ để tối ưu chi phí

  const handleCopyVoucher = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(voucherCode);
      setVoucherCopied(true);
      setTimeout(() => setVoucherCopied(false), 2500);
    }
  };

  // References to active objects for cleanup
  const localStreamRef = useRef<MediaStream | null>(null);
  const realtimeClientRef = useRef<RealTimeClient | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  // Update selected garment if initialGarment changes
  useEffect(() => {
    if (initialGarment) {
      setSelectedGarment(initialGarment);
    }
  }, [initialGarment]);

  // Generate optimal prompt for the garment
  const buildPromptForGarment = useCallback((garment: GarmentGrouped | null, extraNote = ""): string => {
    if (!garment) {
      return "Substitute the current top with a traditional Vietnamese Ao Dai costume with elegant embroidery and fine fabric";
    }
    const colorDesc = garment.color ? `in ${garment.color} color` : "";
    const catDesc = garment.categoryName ? `${garment.categoryName}` : "traditional Vietnamese costume";
    const nameDesc = garment.name;
    const base = `Substitute the current top and outfit with a Vietnamese ${catDesc} named "${nameDesc}" ${colorDesc}, made of silk with traditional motifs and elegant tailoring`;
    return extraNote ? `${base}. ${extraNote}` : base;
  }, []);

  // Convert garment image to base64 or blob safely
  const prepareGarmentImage = async (url: string): Promise<Blob | string | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();
      return blob;
    } catch {
      // Fallback: pass URL directly to SDK
      return url;
    }
  };

  const selectedGarmentRef = useRef<GarmentGrouped | null>(selectedGarment);
  selectedGarmentRef.current = selectedGarment;

  // Clean up all streams and connections
  const cleanup = useCallback(() => {
    if (realtimeClientRef.current) {
      try {
        realtimeClientRef.current.disconnect();
      } catch (e) {
        console.warn("Error disconnecting realtime client", e);
      }
      realtimeClientRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (alignmentVideoRef.current) {
      alignmentVideoRef.current.srcObject = null;
    }

    setModalStatus("idle");
    setErrorMessage(null);
    setErrorCode(null);
    setSnapshotUrl(null);
    setRemainingSeconds(15);
    setShowBodyGuide(true);
  }, []);

  // Giai đoạn 1: Mở camera local để khách đứng căn chỉnh khớp khung hình (Chưa gọi AI, chưa tốn tiền)
  const startAlignmentPhase = useCallback(async () => {
    try {
      setErrorMessage(null);
      setErrorCode(null);
      setModalStatus("requesting_camera");
      setShowBodyGuide(true);

      // 1. Kiểm tra đăng nhập
      const accessToken = readStoredAccessToken();
      if (!accessToken) {
        setErrorCode("UNAUTHORIZED");
        setErrorMessage(
          "Bạn cần đăng nhập tài khoản để nhận lượt sử dụng Gương soi Thử đồ Live (Decart AI) miễn phí."
        );
        setModalStatus("error");
        return;
      }

      // 2. Mở camera local của người dùng
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          frameRate: { ideal: 18, max: 24 },
          width: { ideal: 480, max: 720 },
          height: { ideal: 854, max: 960 },
        },
      });
      localStreamRef.current = stream;

      if (alignmentVideoRef.current) {
        alignmentVideoRef.current.srcObject = stream;
        void alignmentVideoRef.current.play().catch(() => {});
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => {});
      }

      setModalStatus("aligning_pose");
    } catch (err: unknown) {
      console.warn("Camera alignment error:", err);
      let msg = "Không thể mở máy ảnh để căn chỉnh tư thế.";
      if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.message.includes("Permission denied")) {
          msg = "Trình duyệt chưa được cấp quyền mở Camera. Vui lòng bấm Cho phép (Allow) để sử dụng tính năng.";
        } else {
          msg = err.message;
        }
      }
      setErrorMessage(msg);
      setModalStatus("error");
    }
  }, []);

  // Giai đoạn 2: Khách đã đứng khớp khung hình -> Bắt đầu gọi Decart AI sinh Realtime
  const startAiGeneration = useCallback(async () => {
    try {
      setErrorMessage(null);
      setErrorCode(null);
      setModalStatus("authenticating");
      setRemainingSeconds(15);

      const accessToken = readStoredAccessToken();
      if (!accessToken) {
        setErrorCode("UNAUTHORIZED");
        setModalStatus("error");
        return;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      };

      const res = await fetch("/api/decart/token", { method: "POST", headers });
      const tokenData = await res.json();

      if (!res.ok || !tokenData.apiKey) {
        if (res.status === 401) {
          setErrorCode("UNAUTHORIZED");
        } else if (res.status === 429) {
          setErrorCode("QUOTA_EXCEEDED");
          if (typeof tokenData.maxDailySessions === "number") {
            setMaxDailySessions(tokenData.maxDailySessions);
          }
          if (typeof tokenData.hasMeasurementsBonus === "boolean") {
            setHasMeasurementsBonus(tokenData.hasMeasurementsBonus);
          }
        } else {
          setErrorCode("DECART_ERROR");
        }
        setErrorMessage(tokenData.message || tokenData.error || "Không thể cấp token xác thực từ server.");
        setModalStatus("error");
        return;
      }

      if (typeof tokenData.sessionDurationSeconds === "number") {
        setRemainingSeconds(tokenData.sessionDurationSeconds);
      }
      if (typeof tokenData.remainingSessionsToday === "number") {
        setRemainingSessionsToday(tokenData.remainingSessionsToday);
      }
      if (typeof tokenData.maxDailySessions === "number") {
        setMaxDailySessions(tokenData.maxDailySessions);
      }
      if (typeof tokenData.hasMeasurementsBonus === "boolean") {
        setHasMeasurementsBonus(tokenData.hasMeasurementsBonus);
      }
      if (tokenData.voucherCode) {
        setVoucherCode(tokenData.voucherCode);
      }

      const clientApiKey = tokenData.apiKey;
      let stream = localStreamRef.current;
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            frameRate: { ideal: 18, max: 24 },
            width: { ideal: 480, max: 720 },
            height: { ideal: 854, max: 960 },
          },
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }

      setModalStatus("connecting_webrtc");

      const client = createDecartClient({ apiKey: clientApiKey });
      const model = models.realtime("lucy-vton-latest");
      const activeGarment = selectedGarmentRef.current;
      const initialPromptText = buildPromptForGarment(activeGarment);

      let garmentImg: Blob | string | null = null;
      if (activeGarment?.imageUrl) {
        garmentImg = await prepareGarmentImage(activeGarment.imageUrl);
      }

      const rtClient = await client.realtime.connect(stream, {
        model,
        mirror: "auto",
        initialState: {
          prompt: {
            text: initialPromptText,
            enhance: false,
          },
          ...(garmentImg ? { image: garmentImg } : {}),
        },
        onRemoteStream: (remoteStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            setModalStatus("streaming");
            // 👉 THÀNH QUẢ ĐÃ RA: ẨN HOÀN TOÀN KHUNG HÌNH ĐỂ KHÁCH NGẮM ÁO SẠCH ĐẸP
            setShowBodyGuide(false);
          }
        },
        onConnectionChange: (sdkState) => {
          if (sdkState === "disconnected") {
            setErrorMessage("Đã ngắt kết nối với máy chủ Decart AI.");
            setModalStatus("error");
          }
        },
      });

      realtimeClientRef.current = rtClient;
    } catch (err: unknown) {
      console.warn("Realtime try-on generation notice:", err);
      let msg = "Không thể tạo phiên thử đồ thời gian thực.";
      if (err instanceof Error) {
        msg = err.message;
      }
      setErrorMessage(msg);
      setModalStatus("error");
    }
  }, [buildPromptForGarment]);

  // Bộ đếm đếm ngược 90s để tự ngắt tránh tốn tiền ngoài ý muốn
  useEffect(() => {
    if (modalStatus !== "streaming") return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          cleanup();
          setErrorCode("SESSION_TIMEOUT");
          setModalStatus("session_ended");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [modalStatus, cleanup]);

  // Tự động ngắt khi người dùng rời tab trình duyệt (chống chạy ngầm tốn tiền)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && modalStatus === "streaming") {
        cleanup();
        setErrorCode("TAB_BLURRED");
        setErrorMessage("Đã tự động ngắt kết nối khi bạn chuyển tab để tiết kiệm credit.");
        setModalStatus("error");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [modalStatus, cleanup]);

  // Đảm bảo gán luồng camera vào alignmentVideoRef khi vào giai đoạn căn chỉnh
  useEffect(() => {
    if (modalStatus === "aligning_pose" && localStreamRef.current && alignmentVideoRef.current) {
      if (alignmentVideoRef.current.srcObject !== localStreamRef.current) {
        alignmentVideoRef.current.srcObject = localStreamRef.current;
      }
      void alignmentVideoRef.current.play().catch(() => {});
    }
  }, [modalStatus]);

  // Handle open / close - Bắt đầu bằng Giai đoạn Căn chỉnh người (Chưa tốn phí)
  useEffect(() => {
    if (isOpen) {
      void startAlignmentPhase();
    } else {
      cleanup();
    }
    return () => {
      cleanup();
    };
  }, [isOpen, startAlignmentPhase, cleanup]);

  // Apply new garment or prompt dynamically without reconnecting
  const handleApplyGarment = async (garment: GarmentGrouped) => {
    setSelectedGarment(garment);
    if (!realtimeClientRef.current || modalStatus !== "streaming") return;

    try {
      setIsUpdatingGarment(true);
      const prompt = buildPromptForGarment(garment, customPrompt);
      let img: Blob | string | null = null;
      if (garment.imageUrl) {
        img = await prepareGarmentImage(garment.imageUrl);
      }

      if (realtimeClientRef.current) {
        await realtimeClientRef.current.set({
          prompt,
          image: img,
          enhance: false,
        });
      }
    } catch (err: unknown) {
      console.error("Failed to switch garment:", err);
    } finally {
      setIsUpdatingGarment(false);
    }
  };

  // Capture snapshot from the AI stream
  const handleCaptureSnapshot = () => {
    const video = remoteVideoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    setSnapshotUrl(dataUrl);
    setHasCapturedSnapshot(true);
  };

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!modalContainerRef.current) return;
    if (!document.fullscreenElement) {
      void modalContainerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      void document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4">
      <div
        ref={modalContainerRef}
        className="relative flex h-full max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-sand/40 bg-zinc-950 text-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lotus/20 text-lotus ring-1 ring-lotus/30">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-wide text-zinc-100 sm:text-base">
                  Gương Soi Thử Đồ AI Thời Gian Thực
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/30">
                  <Zap className="h-2.5 w-2.5" /> Chế độ Tiết Kiệm (Standard)
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Được hỗ trợ bởi công nghệ Generative World Model (Decart Lucy V-TON)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-lg border border-zinc-700/80 p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
              title={isFullscreen ? "Thu nhỏ" : "Toàn màn hình"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700/80 p-2 text-zinc-400 hover:bg-rose-950/60 hover:text-rose-400 hover:border-rose-800 transition"
              title="Đóng"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* Main Video View (8 cols) */}
          <div className="relative flex flex-col items-center justify-center bg-black lg:col-span-8 overflow-hidden min-h-[360px]">
            {/* Status indicators */}
            {modalStatus === "streaming" && (
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-full bg-zinc-900/80 px-3 py-1.5 text-xs backdrop-blur-md border border-zinc-700/60 shadow-lg">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="font-medium text-zinc-200">Trực tiếp (Live AI)</span>
                <span className="text-zinc-500">•</span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    remainingSeconds <= 5 ? "text-rose-400 font-bold animate-pulse" : "text-amber-300"
                  }`}
                  title="Thời lượng 15s ngắm thử tiết kiệm ngân sách GPU"
                >
                  ⏱️ 00:{String(remainingSeconds).padStart(2, "0")}s
                </span>
                {remainingSeconds <= 5 && (
                  <span className="text-[10px] font-medium text-rose-300 animate-pulse hidden sm:inline">
                    • Nhớ bấm chụp ảnh!
                  </span>
                )}
                {isUpdatingGarment && (
                  <span className="text-amber-400 animate-pulse text-[11px] font-semibold">
                    • Đang dệt áo mới...
                  </span>
                )}
              </div>
            )}

            {/* Local Mirrored Camera for Alignment */}
            <video
              ref={alignmentVideoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-contain scale-x-[-1] transition-opacity duration-300 ${
                modalStatus === "aligning_pose" ? "opacity-100 z-0" : "opacity-0 pointer-events-none absolute inset-0 -z-10"
              }`}
            />

            {/* AI Output Stream Video */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`h-full w-full object-contain transition-opacity duration-500 ${
                modalStatus === "streaming" ? "opacity-100 z-0" : "opacity-0 pointer-events-none absolute inset-0 -z-10"
              }`}
            />

            {/* GIAI ĐOẠN 1: Khung căn chỉnh tư thế & Nút bấm xác nhận */}
            {modalStatus === "aligning_pose" && (
              <>
                <BodySilhouetteGuide
                  label="Lùi lại một chút (Step back)"
                  subLabel="Căn chỉnh đầu và vai khớp với khung viền để AI mặc áo chuẩn dáng nhất"
                  footerClassName="mb-24 sm:mb-28"
                />

                {/* Nút hành động Bắt đầu tạo Live sau khi đã đứng khớp */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 w-full px-4 max-w-md">
                  <button
                    type="button"
                    onClick={() => void startAiGeneration()}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-lotus px-7 py-3 text-sm font-bold text-white shadow-2xl shadow-lotus/40 hover:opacity-95 transition transform active:scale-95 animate-pulse"
                  >
                    <Sparkles className="h-4 w-4 text-amber-200" />
                    <span>Đã khớp tư thế • Bắt đầu tạo Live (15s)</span>
                  </button>
                  <span className="text-[11px] text-zinc-300 bg-black/75 px-3.5 py-1 rounded-full backdrop-blur-md border border-white/10 text-center">
                    AI chỉ bắt đầu tính thời gian 15s sau khi bạn bấm nút này
                  </span>
                </div>
              </>
            )}

            {/* Khi đang streaming thành quả: mặc định KHÔNG hiển thị khung (chỉ hiện nếu người dùng cố ý bật lại) */}
            {modalStatus === "streaming" && showBodyGuide && (
              <BodySilhouetteGuide
                label="Lùi lại một chút (Step back)"
                subLabel="Căn chỉnh đầu và vai khớp với khung viền để AI mặc áo chuẩn dáng nhất"
                footerClassName="mb-20"
              />
            )}

            {/* PiP Local Camera Preview */}
            <div
              className={`absolute bottom-4 right-4 z-20 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl transition-all duration-300 ${
                showLocalPreview && modalStatus === "streaming" ? "h-32 w-24 sm:h-44 sm:w-32 opacity-100" : "h-0 w-0 opacity-0 pointer-events-none"
              }`}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover scale-x-[-1]"
              />
              <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-zinc-300">
                Cam gốc
              </div>
            </div>

            {/* Overlay Loader khi đang kết nối AI */}
            {modalStatus !== "streaming" && modalStatus !== "error" && modalStatus !== "aligning_pose" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-zinc-950/90 p-6 text-center">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-2 border-lotus/20 border-t-lotus animate-spin" />
                  <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-amber-400 animate-pulse" />
                </div>
                <div className="max-w-md space-y-1">
                  <h3 className="text-base font-semibold text-zinc-100">
                    {modalStatus === "requesting_camera" && "Đang kích hoạt máy ảnh..."}
                    {modalStatus === "authenticating" && "Đang khởi tạo phiên Decart AI..."}
                    {modalStatus === "connecting_webrtc" && "Đang dệt áo lên cơ thể theo thời gian thực..."}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    AI đang phân tích tư thế vừa căn chỉnh để dệt tà áo chuẩn form nhất.
                  </p>
                </div>
              </div>
            )}

            {/* 1. Màn hình yêu cầu đăng nhập (UNAUTHORIZED Gatekeeper) */}
            {modalStatus === "error" && errorCode === "UNAUTHORIZED" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-zinc-950/95 p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-400 border border-amber-400/20">
                  <Lock className="h-7 w-7" />
                </div>
                <div className="max-w-md space-y-2">
                  <h3 className="text-base font-semibold text-zinc-100">
                    Đăng nhập để mở Gương soi Live AI
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Tính năng truyền hình ảnh thời gian thực (Decart WebRTC) được cấp miễn phí{" "}
                    <b className="text-amber-400">2 phiên/ngày</b> cho khách hàng thành viên. Đăng nhập ngay để kích hoạt!
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
                  <Link
                    href="/login"
                    onClick={onClose}
                    className="inline-flex items-center gap-2 rounded-xl bg-lotus px-5 py-2.5 text-xs font-semibold text-white hover:bg-lotus/90 transition shadow-lg shadow-lotus/20"
                  >
                    <span>Đăng nhập nhận 2 lượt Live</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link
                    href="/try-on"
                    onClick={onClose}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                  >
                    <span>Thử AI Ảnh Tĩnh (Không cần đăng nhập)</span>
                  </Link>
                </div>
              </div>
            )}

            {/* 2. Màn hình hết hạn mức Live trong ngày (QUOTA_EXCEEDED) - TRUNG TÂM NHIỆM VỤ NHẬN THƯỞNG */}
            {modalStatus === "error" && errorCode === "QUOTA_EXCEEDED" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950/95 p-4 sm:p-6 text-center overflow-y-auto">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-400 border border-amber-400/20">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="max-w-md space-y-1">
                  <h3 className="text-base font-semibold text-zinc-100">
                    Hôm nay bạn đã dùng hết {maxDailySessions} phiên Live (15s)
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Mỗi tài khoản được cấp hạn mức Live mỗi ngày để kiểm soát chi phí GPU. Hoàn thành nhiệm vụ bên dưới để mở khóa thêm lượt ngay:
                  </p>
                </div>

                {/* Danh sách nhiệm vụ nhận thêm lượt */}
                <div className="w-full max-w-md space-y-2 pt-1 text-left">
                  {!hasMeasurementsBonus && (
                    <div className="flex items-center justify-between rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/20 text-amber-300">
                          <Ruler className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-amber-200">
                            Cập nhật số đo cơ thể{" "}
                            <span className="rounded bg-amber-400/30 px-1.5 py-0.5 text-[10px] text-amber-300 font-bold">
                              +2 lượt Live
                            </span>
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            Giúp chuẩn size trang phục & mở ngay 2 lượt soi gương mới
                          </p>
                        </div>
                      </div>
                      <Link
                        href="/dashboard/customer/measurements"
                        onClick={onClose}
                        className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-300 transition whitespace-nowrap ml-2"
                      >
                        Nhập số đo
                      </Link>
                    </div>
                  )}

                  <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lotus/20 text-lotus">
                        <Sparkles className="h-4 w-4 text-amber-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-zinc-200">
                          Thử đồ bằng AI Ảnh Tĩnh (IDM-VTON)
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          Miễn phí, chuẩn form dáng, không giới hạn số giây
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/try-on"
                      onClick={onClose}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition whitespace-nowrap ml-2"
                    >
                      Thử ảnh tĩnh
                    </Link>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                  >
                    Đóng cửa sổ
                  </button>
                </div>
              </div>
            )}

            {/* 3. Màn hình kết thúc phiên 15s: Trải nghiệm mở hộp quà hoàng kim bùng nổ hoa giấy & voucher */}
            {modalStatus === "session_ended" && (
              <GiftUnboxing
                voucherCode={voucherCode}
                discountLabel="10%"
                expiresIn="24 giờ"
                onCopyVoucher={handleCopyVoucher}
                voucherCopied={voucherCopied}
                selectedGarment={selectedGarment}
                onClose={onClose}
                remainingSessionsToday={remainingSessionsToday}
                onRestartLive={() => void startAlignmentPhase()}
              />
            )}


            {/* 4. Màn hình lỗi thông thường (Lỗi camera, ngắt mạng, v.v.) */}
            {modalStatus === "error" && errorCode !== "UNAUTHORIZED" && errorCode !== "QUOTA_EXCEEDED" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-zinc-950 p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <div className="max-w-md space-y-2">
                  <h3 className="text-base font-semibold text-rose-300">Không thể kết nối phòng thử đồ</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{errorMessage}</p>
                </div>
                <div className="flex items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => void startAlignmentPhase()}
                    className="inline-flex items-center gap-2 rounded-xl bg-lotus px-4 py-2 text-xs font-semibold text-white hover:bg-lotus/90 transition shadow-lg shadow-lotus/20"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Thử lại
                  </button>
                  <Link
                    href="/try-on"
                    onClick={onClose}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                  >
                    <span>Dùng Thử Ảnh Tĩnh (IDM-VTON)</span>
                  </Link>
                </div>
              </div>
            )}

            {/* Bottom Controls on Video */}
            {modalStatus === "streaming" && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-2xl bg-zinc-900/90 p-2 backdrop-blur-md border border-zinc-700/80 shadow-2xl">
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  className="inline-flex items-center gap-2 rounded-xl bg-lotus px-4 py-2 text-xs font-semibold text-white hover:bg-lotus/90 transition shadow-md shadow-lotus/25"
                  title="Chụp lại khoảnh khắc đẹp"
                >
                  <Camera className="h-4 w-4" />
                  <span>Chụp ảnh</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowLocalPreview((p) => !p)}
                  className={`rounded-xl border p-2 text-xs transition ${
                    showLocalPreview
                      ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                  title="Xem camera gốc song song"
                >
                  Cam nhỏ
                </button>

                <button
                  type="button"
                  onClick={() => setShowBodyGuide((p) => !p)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border p-2 text-xs transition ${
                    showBodyGuide
                      ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                      : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                  title="Bật/Tắt khung căn chỉnh dáng người (Step back guide)"
                >
                  <User className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Khung căn dáng</span>
                </button>

                <button
                  type="button"
                  onClick={() => void startAiGeneration()}
                  className="rounded-xl border border-zinc-700 bg-zinc-800 p-2 text-zinc-400 hover:text-white transition"
                  title="Khởi động lại stream"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* Right Sidebar: Garments & Options (4 cols) */}
          <div className="flex flex-col border-t border-zinc-800 bg-zinc-900/60 lg:col-span-4 lg:border-t-0 lg:border-l lg:border-zinc-800 overflow-y-auto">
            {/* Current Active Garment Info */}
            <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/80">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                Trang phục đang thử
              </span>
              {selectedGarment ? (
                <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="h-16 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                    {selectedGarment.imageUrl ? (
                      <img
                        src={selectedGarment.imageUrl}
                        alt={selectedGarment.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
                        Không ảnh
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm text-zinc-100 truncate">
                      {selectedGarment.name}
                    </h4>
                    <p className="text-xs text-zinc-400 mt-0.5 truncate">
                      {selectedGarment.categoryName || "Cổ phục Việt Nam"}
                      {selectedGarment.color ? ` • ${selectedGarment.color}` : ""}
                    </p>
                    {selectedGarment.sizes?.[0]?.dailyPrice && (
                      <p className="mt-1 text-xs font-semibold text-amber-400">
                        {new Intl.NumberFormat("vi-VN", {
                          style: "currency",
                          currency: "VND",
                        }).format(selectedGarment.sizes[0].dailyPrice)}
                        /ngày
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-zinc-400">Chưa chọn mẫu trang phục nào.</p>
              )}
            </div>

            {/* Quick Switch Garment Carousel/List */}
            <div className="flex-1 p-4 space-y-3 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300">
                  Chọn trang phục khác để đổi đồ trực tiếp:
                </span>
                <span className="text-[11px] text-zinc-500">
                  {garments.length} mẫu có sẵn
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {garments.map((g) => {
                  const isCur = selectedGarment?.garmentId === g.garmentId;
                  return (
                    <button
                      key={g.garmentId}
                      type="button"
                      onClick={() => void handleApplyGarment(g)}
                      disabled={isUpdatingGarment || modalStatus !== "streaming"}
                      className={`group relative flex flex-col overflow-hidden rounded-xl border p-2 text-left transition ${
                        isCur
                          ? "border-amber-400 bg-amber-400/10 ring-1 ring-amber-400/40"
                          : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-800/40"
                      } ${isUpdatingGarment || modalStatus !== "streaming" ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-zinc-900">
                        {g.imageUrl ? (
                          <img
                            src={g.imageUrl}
                            alt={g.name}
                            className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
                            Không ảnh
                          </div>
                        )}
                        {isCur && (
                          <div className="absolute top-1 right-1 rounded-full bg-amber-400 p-1 text-zinc-950 shadow-md">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </div>
                        )}
                      </div>
                      <div className="mt-2 min-w-0">
                        <p className="text-xs font-semibold text-zinc-200 truncate">{g.name}</p>
                        <p className="text-[10px] text-zinc-400 truncate">
                          {g.categoryName || "Cổ phục"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prompt Fine-tuning (Optional expand) */}
            <div className="border-t border-zinc-800 p-4 bg-zinc-950/80">
              <label className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5 mb-1.5">
                <Sliders className="h-3.5 w-3.5 text-zinc-400" />
                Gợi ý bổ sung cho AI (Tùy chọn):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="VD: Thêm khăn vấn, giữ nguyên váy..."
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isUpdatingGarment || modalStatus !== "streaming" || !selectedGarment}
                  onClick={() => selectedGarment && void handleApplyGarment(selectedGarment)}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Áp dụng
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Snapshot Modal Preview */}
        {hasCapturedSnapshot && snapshotUrl && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90 p-4 backdrop-blur-lg">
            <div className="relative flex max-h-[90vh] max-w-lg flex-col items-center rounded-2xl border border-sand/40 bg-zinc-900 p-4 shadow-2xl">
              <button
                type="button"
                onClick={() => setHasCapturedSnapshot(false)}
                className="absolute top-3 right-3 rounded-full bg-zinc-800 p-1.5 text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <h3 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" /> Ảnh chụp diện mạo mới của bạn
              </h3>
              <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
                <img
                  src={snapshotUrl}
                  alt="Ảnh chụp thử đồ"
                  className="max-h-[60vh] w-auto object-contain"
                />
              </div>
              {/* Voucher Reward Box in Snapshot */}
              <div className="mt-3 w-full rounded-xl border border-amber-400/30 bg-amber-400/10 p-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-[11px] font-bold text-amber-300">
                      Tặng bạn Voucher 10%: <span className="font-mono text-xs">{voucherCode}</span>
                    </p>
                    <p className="text-[10px] text-zinc-400">Áp dụng khi thuê bộ trang phục này</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyVoucher}
                  className="rounded-lg bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-400/30 border border-amber-400/30 transition whitespace-nowrap"
                >
                  {voucherCopied ? "Đã chép ✓" : "Sao chép"}
                </button>
              </div>

              <div className="mt-3 flex w-full flex-col sm:flex-row gap-2">
                <a
                  href={snapshotUrl}
                  download={`co-phuc-tryon-${Date.now()}.png`}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-lotus py-2 text-xs font-semibold text-white hover:bg-lotus/90 transition shadow-md shadow-lotus/25"
                >
                  <Download className="h-4 w-4" /> Tải ảnh về máy
                </a>
                {selectedGarment?.slug ? (
                  <Link
                    href={`/catalog/${selectedGarment.slug}`}
                    onClick={() => {
                      handleCopyVoucher();
                      onClose();
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-amber-400/15 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/25 transition"
                  >
                    <ShoppingBag className="h-4 w-4" /> Đặt thuê (-10%)
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setHasCapturedSnapshot(false)}
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
                  >
                    Tiếp tục
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
