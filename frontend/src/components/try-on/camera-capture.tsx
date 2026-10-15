import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, X, AlertCircle, Sparkles } from "lucide-react";

type CameraCaptureProps = {
  onCapture: (base64: string) => void;
};

function stripDataUriPrefix(dataUrl: string) {
  return dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
}

function isLocalhost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function getCameraErrorMessage(error: unknown) {
  if (typeof window !== "undefined" && !window.isSecureContext && !isLocalhost()) {
    return "Trình duyệt chỉ cho mở camera trên HTTPS hoặc localhost. Vui lòng mở bằng http://localhost hoặc dùng upload ảnh.";
  }

  if (!(error instanceof DOMException)) {
    return "Không thể mở camera. Vui lòng upload ảnh hoặc thử lại bằng trình duyệt khác.";
  }

  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Bạn chưa cấp quyền camera cho trang này. Hãy bấm biểu tượng khoá/camera trên thanh địa chỉ và Allow camera.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Không tìm thấy camera trên thiết bị. Vui lòng kiểm tra webcam hoặc upload ảnh.";
    case "NotReadableError":
    case "TrackStartError":
      return "Camera đang được ứng dụng khác sử dụng. Hãy tắt Zoom/Meet/Camera app rồi thử lại.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Camera không hỗ trợ cấu hình yêu cầu. Hãy thử lại hoặc upload ảnh.";
    case "SecurityError":
      return "Trình duyệt đang chặn camera vì lý do bảo mật. Vui lòng dùng HTTPS/localhost hoặc upload ảnh.";
    default:
      return `Không thể mở camera (${error.name}). Vui lòng kiểm tra quyền truy cập hoặc upload ảnh.`;
  }
}

function waitForEvent(target: EventTarget, eventName: string, timeoutMs = 3000) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      target.removeEventListener(eventName, onEvent);
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeoutMs);

    function onEvent() {
      window.clearTimeout(timeout);
      resolve();
    }

    target.addEventListener(eventName, onEvent, { once: true });
  });
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function waitForUsableVideoFrame(video: HTMLVideoElement, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (video.paused) {
      await video.play().catch(() => undefined);
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      return;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }

  throw new Error("Camera stream did not produce a usable frame");
}

function isCanvasNearlyBlack(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  const sampleWidth = Math.min(64, canvas.width);
  const sampleHeight = Math.min(64, canvas.height);
  const x = Math.max(0, Math.floor((canvas.width - sampleWidth) / 2));
  const y = Math.max(0, Math.floor((canvas.height - sampleHeight) / 2));
  const pixels = context.getImageData(x, y, sampleWidth, sampleHeight).data;

  let brightness = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    brightness += pixels[i] + pixels[i + 1] + pixels[i + 2];
  }

  return brightness / (pixels.length / 4) < 12;
}

export function CameraCapture({ onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function clearCountdown() {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
  }

  async function requestCamera() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 1280 } },
        audio: false,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "OverconstrainedError") {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw error;
    }
  }

  async function startCamera() {
    setErrorMsg(null);
    stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("Trình duyệt không hỗ trợ camera. Vui lòng upload ảnh thay thế.");
      return;
    }

    try {
      const stream = await requestCamera();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await waitForUsableVideoFrame(videoRef.current);
      }
      setIsCameraReady(true);
    } catch (error) {
      setErrorMsg(getCameraErrorMessage(error));
    }
  }

  function stopCamera() {
    clearCountdown();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraReady(false);
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;

    setErrorMsg(null);

    try {
      await waitForUsableVideoFrame(video);
    } catch {
      setErrorMsg("Camera chưa sẵn sàng. Vui lòng đợi một chút rồi chụp lại.");
      return;
    }

    if (!video.videoWidth || !video.videoHeight) {
      setErrorMsg("Camera chưa trả về kích thước ảnh. Vui lòng thử lại hoặc upload ảnh.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (isCanvasNearlyBlack(canvas)) {
      setErrorMsg("Ảnh chụp bị tối/đen. Vui lòng đứng nơi đủ sáng và chụp lại, hoặc dùng Upload ảnh.");
      return;
    }

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setPreviewUrl(dataUrl);
    onCapture(stripDataUriPrefix(dataUrl));
    stopCamera();
  }

  function startCountdown() {
    if (!isCameraReady || countdown !== null) return;

    setErrorMsg(null);
    setCountdown(3);
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((current) => {
        if (current === null) return null;
        if (current <= 1) {
          clearCountdown();
          window.setTimeout(() => void capturePhoto(), 0);
          return null;
        }
        return current - 1;
      });
    }, 1000);
  }

  function retakePhoto() {
    setPreviewUrl(null);
    void startCamera();
  }


  const [showGuide, setShowGuide] = useState(true);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-sand bg-mist">
        {previewUrl ? (
          <img src={previewUrl} alt="Ảnh vừa chụp" className="aspect-[3/4] w-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            className="aspect-[3/4] w-full bg-stone-100 object-cover"
            playsInline
            muted
          />
        )}

        {/* Pose Silhouette Overlay Guide */}
        {isCameraReady && !previewUrl && showGuide && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-4">
            <div className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm shadow-sm">
              Khung căn chỉnh dáng AI: Hãy đứng khớp với đường viền
            </div>

            {/* SVG Silhouette */}
            <svg
              className="h-full w-full max-w-[280px] text-lotus/50 drop-shadow-md transition-opacity duration-300"
              viewBox="0 0 200 300"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            >
              {/* Head oval */}
              <ellipse cx="100" cy="50" rx="22" ry="28" />
              {/* Neck & Shoulders */}
              <path d="M92 78 L92 90 L60 106 L45 150" />
              <path d="M108 78 L108 90 L140 106 L155 150" />
              {/* Torso & Waist line */}
              <path d="M60 106 C65 140 68 175 62 210 L58 290" />
              <path d="M140 106 C135 140 132 175 138 210 L142 290" />
              {/* Center guide line */}
              <line x1="100" y1="20" x2="100" y2="295" strokeWidth="0.8" stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
              {/* Shoulder horizontal guide */}
              <line x1="45" y1="106" x2="155" y2="106" strokeWidth="1" stroke="rgba(255,255,255,0.6)" strokeDasharray="2 2" />
              {/* Waist horizontal guide */}
              <line x1="60" y1="170" x2="140" y2="170" strokeWidth="1" stroke="rgba(255,255,255,0.6)" strokeDasharray="2 2" />
            </svg>

            <div className="flex items-center gap-3 text-[11px] font-medium text-white/90 drop-shadow">
              <span>Vai ngang</span>
              <span>•</span>
              <span>Đứng thẳng lưng</span>
              <span>•</span>
              <span>Thấy rõ eo</span>
            </div>
          </div>
        )}

        {countdown !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white backdrop-blur-[2px]">
            <span className="font-display text-8xl drop-shadow-xl animate-pulse">{countdown}</span>
            <span className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] drop-shadow">Chuẩn bị chụp</span>
          </div>
        )}
      </div>

      {/* Guide toggle button when camera is on */}
      {isCameraReady && !previewUrl && (
        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setShowGuide((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-stone-600 hover:text-lotus transition"
          >
            <Sparkles className="h-3.5 w-3.5 text-antique" />
            <span>{showGuide ? "Ẩn khung căn dáng AI" : "Hiện khung căn dáng AI"}</span>
          </button>
          <span className="text-stone-400 text-[11px]">Đứng cách camera 1.5m - 2m</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {!isCameraReady && !previewUrl && (
          <button
            type="button"
            onClick={startCamera}
            className="inline-flex items-center gap-2 rounded-lg bg-lotus px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-oxblood"
          >
            <Camera className="h-4 w-4" />
            Mở camera
          </button>
        )}

        {isCameraReady && (
          <>
            <button
              type="button"
              onClick={startCountdown}
              disabled={countdown !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-lotus px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Camera className="h-4 w-4" />
              {countdown === null ? "Chụp ảnh" : `Đang chụp sau ${countdown}s`}
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-4 py-2.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-antique hover:bg-stone-50"
            >
              <X className="h-4 w-4" />
              Huỷ
            </button>
          </>
        )}

        {previewUrl && (
          <button
            type="button"
            onClick={retakePhoto}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sand bg-white px-4 py-2.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-antique hover:bg-stone-50"
          >
            <RotateCcw className="h-4 w-4" />
            Chụp lại
          </button>
        )}
      </div>

      <p className="text-xs leading-6 text-stone-500">
        Nếu camera không mở được, hãy cấp quyền camera trên trình duyệt hoặc dùng tab Upload ảnh. Camera chỉ hoạt động ổn định trên HTTPS hoặc localhost.
      </p>
    </div>
  );
}
