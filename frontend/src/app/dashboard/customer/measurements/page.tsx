"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { apiRequest } from "@/lib/api";

type CustomerMeasurement = {
  id: string;
  heightCm: number | null;
  weightKg: number | null;
  bustCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  usualSize: string | null;
  createdAt: string;
};

type MeasurementsFormState = {
  heightCm: string;
  weightKg: string;
  bustCm: string;
  waistCm: string;
  hipCm: string;
  usualSize: string;
};

function createEmptyForm(): MeasurementsFormState {
  return { heightCm: "", weightKg: "", bustCm: "", waistCm: "", hipCm: "", usualSize: "" };
}

function toInputValue(value: number | null) {
  return value === null ? "" : String(value);
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toFormState(data: CustomerMeasurement): MeasurementsFormState {
  return {
    heightCm: toInputValue(data.heightCm),
    weightKg: toInputValue(data.weightKg),
    bustCm: toInputValue(data.bustCm),
    waistCm: toInputValue(data.waistCm),
    hipCm: toInputValue(data.hipCm),
    usualSize: data.usualSize ?? "",
  };
}

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const UNKNOWN_SIZE_VALUE = "unknown";

/* Underline input style shared across all fields */
const inputStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: "transparent",
  border: "none",
  borderBottom: "1px solid #e3beb8",
  padding: "0.75rem 0",
  fontFamily: "Manrope, sans-serif",
  fontSize: "16px",
  color: "#261816",
  outline: "none",
  transition: "border-color 0.3s ease",
};

function AtelierInput({
  id,
  label,
  unit,
  value,
  onChange,
  placeholder = "0",
  type = "number",
}: {
  id: string;
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="mb-1 block text-[13px] font-semibold uppercase tracking-wider" style={{ color: "#5a403c" }}
        htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          step={type === "number" ? "0.01" : undefined}
          min={type === "number" ? "0" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...inputStyle, borderBottomColor: focused ? "#8B0000" : "#e3beb8", paddingRight: unit ? "2rem" : "0" }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {unit && (
          <span className="absolute right-0 top-3 text-sm" style={{ color: "#5a403c" }}>{unit}</span>
        )}
      </div>
    </div>
  );
}

export default function CustomerMeasurementsPage() {
  const { status } = useAuth();
  const [form, setForm] = useState<MeasurementsFormState>(() => createEmptyForm());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [savedSize, setSavedSize] = useState<string | null>(null);
  const hasExisting = lastSavedAt !== null;

  // Cảnh báo (không chặn) khi số đo bất thường: vòng eo thường là số nhỏ nhất.
  const proportionWarning = useMemo(() => {
    const bust = parseOptionalNumber(form.bustCm);
    const waist = parseOptionalNumber(form.waistCm);
    const hip = parseOptionalNumber(form.hipCm);
    const conflicts: string[] = [];
    if (bust !== undefined && waist !== undefined && waist > bust) {
      conflicts.push("vòng eo và vòng ngực");
    }
    if (hip !== undefined && waist !== undefined && waist > hip) {
      conflicts.push("vòng eo và vòng hông");
    }
    if (conflicts.length === 0) return null;
    const parts = conflicts.length > 1 ? "vòng ngực, vòng eo và vòng hông" : conflicts[0];
    return `Lưu ý: số đo ${parts} có vẻ chưa chính xác (vòng eo thường nhỏ hơn vòng ngực và vòng hông). Bạn vẫn có thể lưu, nhưng hãy kiểm tra lại.`;
  }, [form.bustCm, form.waistCm, form.hipCm]);
  const lastSavedLabel = useMemo(() => (lastSavedAt ? new Date(lastSavedAt).toLocaleString("vi-VN") : null), [lastSavedAt]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);

    void (async () => {
      try {
        const result = await apiRequest<CustomerMeasurement | null>("/users/me/measurements");
        if (cancelled) return;
        if (!result.success) {
          setError(result.message ?? "Không thể tải số đo đã lưu.");
          return;
        }
        if (result.data) {
          setForm(toFormState(result.data));
          setLastSavedAt(result.data.createdAt);
          setSavedSize(result.data.usualSize ?? null);
        } else {
          setForm(createEmptyForm());
        }
      } catch {
        if (!cancelled) {
          setError("Không thể kết nối đến hệ thống số đo.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const heightCm = parseOptionalNumber(form.heightCm);
    const weightKg = parseOptionalNumber(form.weightKg);
    const bustCm = parseOptionalNumber(form.bustCm);
    const waistCm = parseOptionalNumber(form.waistCm);
    const hipCm = parseOptionalNumber(form.hipCm);

    // DB lưu numeric(5,2) nên chặn giá trị từ 1000 trở lên (vượt quá khả năng lưu trữ).
    const OVERFLOW_LIMIT = 1000;
    const overflowed = [
      { label: "Chiều cao", value: heightCm },
      { label: "Cân nặng", value: weightKg },
      { label: "Vòng ngực", value: bustCm },
      { label: "Vòng eo", value: waistCm },
      { label: "Vòng hông", value: hipCm },
    ]
      .filter((f) => f.value !== undefined && f.value >= OVERFLOW_LIMIT)
      .map((f) => f.label);
    if (overflowed.length > 0) {
      setError(`Số đo ${overflowed.join(", ")} vượt quá giới hạn cho phép (tối đa 999,99). Vui lòng kiểm tra lại, hệ thống chưa lưu thay đổi.`);
      return;
    }

    // "Không biết / Không chắc" nghĩa là xóa size đã lưu (gửi null);
    // nếu trước đó chưa có size thì bỏ qua trường này để không tạo dữ liệu rác.
    const sizeRaw = form.usualSize.trim();
    let sizeToSend: string | null | undefined;
    if (sizeRaw === UNKNOWN_SIZE_VALUE) {
      sizeToSend = savedSize ? null : undefined;
    } else if (sizeRaw) {
      sizeToSend = sizeRaw;
    } else {
      sizeToSend = savedSize ? null : undefined;
    }

    const payload = Object.fromEntries(
      Object.entries({
        heightCm,
        weightKg,
        bustCm,
        waistCm,
        hipCm,
        usualSize: sizeToSend,
      }).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(payload).length === 0) {
      setError("Vui lòng nhập ít nhất một trường số đo trước khi lưu.");
      return;
    }

    setSaving(true);
    try {
      const result = await apiRequest<CustomerMeasurement>("/users/me/measurements", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (!result.success || !result.data) {
        setError(result.message ?? "Không thể lưu số đo.");
        return;
      }

      setForm(toFormState(result.data));
      setLastSavedAt(result.data.createdAt);
      setSavedSize(result.data.usualSize ?? null);
      setMessage(hasExisting ? "Cập nhật số đo thành công." : "Lưu số đo thành công.");
    } catch {
      setError("Không thể kết nối đến hệ thống số đo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-medium" style={{ color: "#261816", fontFamily: "EB Garamond, serif" }}>
          Số đo cơ thể
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed" style={{ color: "#5a403c" }}>
          Vui lòng cung cấp số đo thực tế của cơ thể. Không sử dụng số đo trên áo hoặc số đo của trang phục đang mặc.
          Atelier dựa vào những thông tin này để tư vấn size phù hợp nhất.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">

        {/* Left: Form (8 cols) */}
        <div className="lg:col-span-8">
          <div className="relative overflow-hidden rounded-xl border p-8"
            style={{ backgroundColor: "#ffffff", borderColor: "#f8dcd8", boxShadow: "0 2px 12px rgba(74,4,4,0.04)" }}>
            {/* Decorative */}
            <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-bl-full opacity-40"
              style={{ backgroundColor: "#ffe9e6" }} />

            {loading ? (
              <p className="text-sm" style={{ color: "#5a403c" }}>Đang tải số đo đã lưu...</p>
            ) : (
              <form onSubmit={handleSubmit} className="relative z-10 space-y-10">

                {/* Standard Size */}
                <div>
                  <h3 className="mb-6 flex items-center gap-2 text-xl font-semibold" style={{ color: "#261816", fontFamily: "EB Garamond, serif" }}>
                    <span className="material-symbols-outlined" style={{ color: "#C5A059" }}>accessibility_new</span>
                    Size tiêu chuẩn
                  </h3>
                  <div className="w-full sm:w-1/2">
                    <label className="mb-1 block text-[13px] font-semibold uppercase tracking-wider" style={{ color: "#5a403c" }}
                      htmlFor="usualSize">
                      Size thường mặc (không bắt buộc)
                    </label>
                    <div className="relative">
                      <select
                        id="usualSize"
                        value={form.usualSize}
                        onChange={(e) => setForm((curr) => ({ ...curr, usualSize: e.target.value }))}
                        className="w-full appearance-none bg-transparent py-3 pr-8 text-base"
                        style={{
                          border: "none",
                          borderBottom: "1px solid #e3beb8",
                          outline: "none",
                          color: form.usualSize ? "#261816" : "#8e706b",
                          fontFamily: "Manrope, sans-serif",
                        }}
                      >
                        <option value="">Chọn size...</option>
                        {SIZES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                        <option value={UNKNOWN_SIZE_VALUE}>Không biết / Không chắc</option>
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-0 top-2 text-[20px]"
                        style={{ color: "#8e706b" }}>expand_more</span>
                    </div>
                    <p className="mt-2 text-xs italic leading-relaxed" style={{ color: "#8e706b" }}>
                      Nếu không chắc size, bạn có thể bỏ qua. Atelier sẽ dựa trên số đo cơ thể để tư vấn.
                    </p>
                  </div>
                </div>

                <hr style={{ borderColor: "#e3beb8", opacity: 0.5 }} />

                {/* Core Measurements */}
                <div>
                  <h3 className="mb-6 flex items-center gap-2 text-xl font-semibold" style={{ color: "#261816", fontFamily: "EB Garamond, serif" }}>
                    <span className="material-symbols-outlined" style={{ color: "#C5A059" }}>straighten</span>
                    Số đo cơ bản
                  </h3>
                  <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                    <AtelierInput id="heightCm" label="Chiều cao (cm)" unit="cm" value={form.heightCm}
                      onChange={(v) => setForm((c) => ({ ...c, heightCm: v }))} placeholder="e.g. 165" />
                    <AtelierInput id="weightKg" label="Cân nặng (kg)" unit="kg" value={form.weightKg}
                      onChange={(v) => setForm((c) => ({ ...c, weightKg: v }))} placeholder="e.g. 52" />
                  </div>
                </div>

                {/* 3 curves */}
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
                  <AtelierInput id="bustCm" label="Vòng ngực (cm)" value={form.bustCm}
                    onChange={(v) => setForm((c) => ({ ...c, bustCm: v }))} />
                  <AtelierInput id="waistCm" label="Vòng eo (cm)" value={form.waistCm}
                    onChange={(v) => setForm((c) => ({ ...c, waistCm: v }))} />
                  <AtelierInput id="hipCm" label="Vòng hông (cm)" value={form.hipCm}
                    onChange={(v) => setForm((c) => ({ ...c, hipCm: v }))} />
                </div>

                {/* Messages */}
                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
                )}
                {proportionWarning && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{proportionWarning}</p>
                )}
                {message && (
                  <p className="rounded-lg border px-4 py-3 text-sm"
                    style={{ borderColor: "#C5A059", color: "#6E5E40", backgroundColor: "#fff8f0" }}>
                    ✓ {message}
                    {lastSavedLabel && <span className="ml-2 opacity-60 text-xs">({lastSavedLabel})</span>}
                  </p>
                )}

                {/* Submit */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 rounded-xl px-8 py-4 text-[13px] font-semibold uppercase tracking-wider text-white shadow-sm transition-all duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: "#8B0000" }}
                  >
                    {saving ? "Đang lưu..." : hasExisting ? "Cập nhật số đo" : "Lưu số đo"}
                    {!saving && <span className="material-symbols-outlined text-[18px]">check</span>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Right: Artisan's Guide (4 cols) */}
        <div className="lg:col-span-4">
          <div className="sticky top-8 rounded-xl border p-8" style={{ backgroundColor: "#ffe9e6", borderColor: "#e3beb8" }}>
            <span className="material-symbols-outlined text-[32px] mb-3 block" style={{ color: "#8B0000" }}>menu_book</span>
            <h3 className="mb-2 text-2xl font-semibold" style={{ color: "#261816", fontFamily: "EB Garamond, serif" }}>
              Hướng dẫn đo
            </h3>
            <p className="mb-6 text-sm leading-relaxed" style={{ color: "#5a403c" }}>
              Áo dài hoàn hảo cần số đo chính xác. Hãy làm theo hướng dẫn bên dưới để có kết quả tốt nhất.
            </p>

            <svg viewBox="0 0 240 210" className="mx-auto mb-6 w-full max-w-[220px]" role="img"
              aria-label="Minh họa vị trí đặt thước đo vòng ngực, vòng eo và vòng hông">
              {/* Tay */}
              <path d="M66 48 C58 64 55 86 58 108" fill="none" stroke="#e3beb8" strokeWidth="10" strokeLinecap="round" />
              <path d="M114 48 C122 64 125 86 122 108" fill="none" stroke="#e3beb8" strokeWidth="10" strokeLinecap="round" />
              {/* Thân */}
              <path
                d="M90 30 C83 30 79 34 75 39 C68 43 65 48 63 56 C61 64 62 70 64 76 C66 84 68 92 69 98 C70 102 70 104 70 106 C69 114 66 122 64 130 C63 140 66 152 70 164 L74 188 L84 188 C84 178 86 168 90 158 C94 168 96 178 96 188 L106 188 L110 164 C114 152 117 140 116 130 C114 122 111 114 110 106 C110 104 110 102 111 98 C112 92 114 84 116 76 C118 70 119 64 117 56 C115 48 112 43 105 39 C101 34 97 30 90 30 Z"
                fill="#fff8f0" stroke="#8B0000" strokeWidth="2" strokeLinejoin="round" />
              {/* Đầu, cổ */}
              <circle cx="90" cy="14" r="9" fill="none" stroke="#8B0000" strokeWidth="2" />
              <line x1="84" y1="24" x2="83" y2="31" stroke="#8B0000" strokeWidth="2" strokeLinecap="round" />
              <line x1="96" y1="24" x2="97" y2="31" stroke="#8B0000" strokeWidth="2" strokeLinecap="round" />
              {/* Thước dây tại 3 vòng */}
              {[
                { y: 76, x1: 56, x2: 124, num: "1", label: "Vòng ngực" },
                { y: 103, x1: 62, x2: 118, num: "2", label: "Vòng eo" },
                { y: 130, x1: 56, x2: 124, num: "3", label: "Vòng hông" },
              ].map((l) => (
                <g key={l.num}>
                  <rect x={l.x1} y={l.y - 3} width={l.x2 - l.x1} height="6" rx="1.5" fill="#C5A059" opacity="0.9" />
                  <line x1={l.x1 + 3} y1={l.y} x2={l.x2 - 3} y2={l.y} stroke="#ffffff" strokeWidth="1" strokeDasharray="2 4" />
                  <line x1={l.x1} y1={l.y - 6} x2={l.x1} y2={l.y + 6} stroke="#8B0000" strokeWidth="1.5" />
                  <line x1={l.x2} y1={l.y - 6} x2={l.x2} y2={l.y + 6} stroke="#8B0000" strokeWidth="1.5" />
                  <circle cx="140" cy={l.y} r="9" fill="#8B0000" />
                  <text x="140" y={l.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffffff">{l.num}</text>
                  <text x="154" y={l.y + 4} fontSize="12" fill="#5a403c">{l.label}</text>
                </g>
              ))}
              <text x="120" y="204" textAnchor="middle" fontSize="10.5" fontStyle="italic" fill="#8e706b">
                Quấn thước quanh cơ thể, giữ nằm ngang
              </text>
            </svg>

            <ul className="space-y-5">
              {[
                {
                  num: "1",
                  title: "Vòng ngực",
                  desc: "Đo vòng quanh phần đầy nhất của ngực, giữ thước nằm ngang. Đo trực tiếp trên cơ thể hoặc lớp đồ mỏng, giữ thước vừa sát cơ thể, không siết chặt và không để lỏng.",
                },
                {
                  num: "2",
                  title: "Vòng eo",
                  desc: "Đo quanh vòng eo tự nhiên (phần thon nhất), không hóp bụng. Giữ thước vừa sát cơ thể, không siết chặt và không để lỏng.",
                },
                {
                  num: "3",
                  title: "Vòng hông",
                  desc: "Đứng thẳng, hai gót chân chụm lại. Đo quanh phần đầy nhất của hông và mông, giữ thước nằm ngang, vừa sát cơ thể.",
                },
              ].map((item) => (
                <li key={item.num} className="flex gap-4">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={{ backgroundColor: "#f8dcd8", color: "#8B0000" }}>
                    {item.num}
                  </div>
                  <div>
                    <strong className="block text-sm font-semibold" style={{ color: "#261816" }}>{item.title}</strong>
                    <p className="mt-0.5 text-sm leading-relaxed" style={{ color: "#5a403c" }}>{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 border-t pt-5" style={{ borderColor: "#e3beb8" }}>
              <p className="flex items-center gap-2 text-sm italic" style={{ color: "#4F797B" }}>
                <span className="material-symbols-outlined text-[16px]">info</span>
                Cần hỗ trợ? Đặt lịch với chuyên gia đo lường của chúng tôi.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
