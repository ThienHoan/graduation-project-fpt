/**
 * Hệ thống âm thanh tương tác Web Audio API cho Cổ Phục Rental
 * Sử dụng bộ tổng hợp âm (Synthesizer) chuẩn W3C, không tải file ngoài, 0 latency, chuẩn 120fps.
 * Lấy cảm hứng từ âm sắc truyền thống: Tiếng gõ mộc/phách, chuông khánh hoàng cung.
 * Hỗ trợ Spatial Audio (Stereo Panning) theo tọa độ con trỏ / vị trí phần tử trên màn hình.
 */

let audioCtx: AudioContext | null = null;
const STORAGE_KEY = "co-phuc-sound-enabled";

export interface SoundOptions {
  /** Pan âm thanh: -1 (hoàn toàn tai trái) đến +1 (hoàn toàn tai phải) */
  pan?: number;
  /** Tự động tính pan từ vị trí con trỏ chuột trong MouseEvent */
  event?: React.MouseEvent | MouseEvent;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Tính toán độ lệch âm thanh stereo (pan) từ -0.8 đến 0.8 dựa trên tọa độ màn hình
 */
function calculatePan(opts?: SoundOptions): number {
  if (typeof window === "undefined" || !opts) return 0;
  if (typeof opts.pan === "number") {
    return Math.max(-0.85, Math.min(0.85, opts.pan));
  }
  if (opts.event && typeof opts.event.clientX === "number") {
    const norm = (opts.event.clientX / window.innerWidth) * 2 - 1; // [-1, 1]
    return Math.max(-0.85, Math.min(0.85, norm * 0.75));
  }
  return 0;
}

/**
 * Kết nối GainNode tới đích thông qua StereoPannerNode nếu trình duyệt hỗ trợ
 */
function connectSpatial(ctx: AudioContext, sourceNode: AudioNode, pan: number): void {
  if (ctx.createStereoPanner && pan !== 0) {
    try {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, ctx.currentTime);
      sourceNode.connect(panner);
      panner.connect(ctx.destination);
      return;
    } catch {
      // Fallback nếu panner lỗi
    }
  }
  sourceNode.connect(ctx.destination);
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent("co-phuc:sound-toggle", { detail: { enabled } }));
  if (enabled) {
    getAudioContext();
  }
}

export function toggleSound(): boolean {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  if (next) {
    playWoodTap();
  }
  return next;
}

/**
 * Tiếng gõ mộc / phách gỗ (Wood Tap) - Âm sắc ấm áp, thanh tao khi click nút/chọn mục
 */
export function playWoodTap(opts?: SoundOptions): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const pan = calculatePan(opts);
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(140, now + 0.05);

  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(gain);
  connectSpatial(ctx, gain, pan);

  osc.start(now);
  osc.stop(now + 0.07);
}

/**
 * Tiếng chuông khánh đồng hoàng cung (Royal Chime) - Dành cho AI Scan & Chuyển trang phục
 */
export function playRoyalChime(opts?: SoundOptions): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const pan = calculatePan(opts);
  const now = ctx.currentTime;

  // Hài âm 1 (Chủ âm)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(880, now); // A5

  gain1.gain.setValueAtTime(0.12, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

  osc1.connect(gain1);
  connectSpatial(ctx, gain1, pan);
  osc1.start(now);
  osc1.stop(now + 0.7);

  // Hài âm 2 (Quãng năm cao tạo độ ngân trong trẻo như khánh ngọc)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(1320, now + 0.03); // E6

  gain2.gain.setValueAtTime(0.08, now + 0.03);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

  osc2.connect(gain2);
  connectSpatial(ctx, gain2, pan);
  osc2.start(now + 0.03);
  osc2.stop(now + 0.9);
}

/**
 * Tiếng lướt khẽ xúc giác (Hover Tick) - Tần số cao, âm lượng cực nhỏ, êm ái khi hover thẻ
 */
export function playHoverTick(opts?: SoundOptions): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const pan = calculatePan(opts);
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.025);

  gain.gain.setValueAtTime(0.035, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

  osc.connect(gain);
  connectSpatial(ctx, gain, pan);

  osc.start(now);
  osc.stop(now + 0.035);
}

/**
 * Tiếng vút nhẹ chuyển động (Whoosh) - Khi mở modal hoặc kích hoạt view so sánh
 */
export function playWhoosh(opts?: SoundOptions): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const pan = calculatePan(opts);
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(280, now);
  osc.frequency.exponentialRampToValueAtTime(620, now + 0.08);

  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(gain);
  connectSpatial(ctx, gain, pan);

  osc.start(now);
  osc.stop(now + 0.13);
}

/**
 * Tiếng đóng dấu triện hoàng gia (Imperial Seal Stamp) - Lực đóng dứt khoát, âm sắc mộc trầm & ngân vang
 */
export function playImperialStamp(opts?: SoundOptions): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const pan = calculatePan(opts);
  const now = ctx.currentTime;

  // 1. Cú chạm mạnh dứt khoát (Thud)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(180, now);
  osc1.frequency.exponentialRampToValueAtTime(45, now + 0.09);
  gain1.gain.setValueAtTime(0.28, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc1.connect(gain1);
  connectSpatial(ctx, gain1, pan);
  osc1.start(now);
  osc1.stop(now + 0.13);

  // 2. Tiếng gõ mộc khô đanh trên giấy lụa
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "triangle";
  osc2.frequency.setValueAtTime(860, now);
  osc2.frequency.exponentialRampToValueAtTime(220, now + 0.04);
  gain2.gain.setValueAtTime(0.18, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  osc2.connect(gain2);
  connectSpatial(ctx, gain2, pan);
  osc2.start(now);
  osc2.stop(now + 0.06);

  // 3. Độ ngân nhẹ kim loại / ngọc tỷ
  const osc3 = ctx.createOscillator();
  const gain3 = ctx.createGain();
  osc3.type = "sine";
  osc3.frequency.setValueAtTime(1046.5, now + 0.02); // C6
  gain3.gain.setValueAtTime(0.06, now + 0.02);
  gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  osc3.connect(gain3);
  connectSpatial(ctx, gain3, pan);
  osc3.start(now + 0.02);
  osc3.stop(now + 0.5);
}

