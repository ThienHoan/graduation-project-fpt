"use client";

import { useState } from "react";
import { AlertTriangle, CalendarRange, Download, FileSpreadsheet, ScrollText, Users } from "lucide-react";
import { exportAdminData, type AdminExportDataset, type AdminExportResult } from "@/lib/api";

const DATASETS: { key: AdminExportDataset; title: string; description: string; icon: typeof Users }[] = [
  {
    key: "users",
    title: "Tài khoản người dùng",
    description: "Email, họ tên, số điện thoại, vai trò, trạng thái, số đơn thuê. Không bao gồm mật khẩu.",
    icon: Users,
  },
  {
    key: "bookings",
    title: "Đơn thuê",
    description: "Mã đơn, khách hàng, trạng thái, thời gian thuê, tiền thuê, tiền cọc, tiền phạt, voucher.",
    icon: FileSpreadsheet,
  },
  {
    key: "audit-logs",
    title: "Nhật ký kiểm toán",
    description: "Thời gian, hành động, đối tượng, người thực hiện và chi tiết thay đổi.",
    icon: ScrollText,
  },
];

function toInputDate(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toInputDate(date);
}

function downloadCsv(filename: string, csv: string) {
  // The BOM lets Excel open Vietnamese text correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export function DataExportPanel({ onSuccess, onError }: Props) {
  const [dataset, setDataset] = useState<AdminExportDataset>("bookings");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Pick<AdminExportResult, "filename" | "rows" | "truncated" | "maxRows"> | null>(null);

  function applyPreset(preset: "7d" | "30d" | "month" | "all") {
    const today = toInputDate(new Date());
    if (preset === "all") {
      setFrom("");
      setTo("");
    } else if (preset === "month") {
      setFrom(`${today.slice(0, 8)}01`);
      setTo(today);
    } else {
      setFrom(daysAgo(preset === "7d" ? 7 : 30));
      setTo(today);
    }
  }

  async function handleExport() {
    if (from && to && from > to) {
      onError("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
      return;
    }
    setBusy(true);
    try {
      const res = await exportAdminData(dataset, { from: from || undefined, to: to || undefined });
      if (res.success && res.data) {
        downloadCsv(res.data.filename, res.data.csv);
        setLast({ filename: res.data.filename, rows: res.data.rows, truncated: res.data.truncated, maxRows: res.data.maxRows });
        onSuccess(`Đã xuất ${res.data.rows.toLocaleString("vi-VN")} dòng.`);
      } else {
        onError(res.message ?? res.error ?? "Không thể xuất dữ liệu");
      }
    } catch {
      onError("Lỗi hệ thống khi xuất dữ liệu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-12">
      <section className="space-y-6 lg:col-span-8">
        <div className="rounded-xl border border-sand bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold text-ink">1. Chọn dữ liệu</h3>
          <div className="grid gap-3 md:grid-cols-3">
            {DATASETS.map((item) => {
              const Icon = item.icon;
              const selected = dataset === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDataset(item.key)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected ? "border-lotus bg-lotus/5 ring-1 ring-lotus/30" : "border-sand bg-white hover:bg-warm-ivory/40"
                  }`}
                >
                  <Icon className="h-5 w-5 text-antique" />
                  <p className="mt-2 text-sm font-bold text-ink">{item.title}</p>
                  <p className="mt-1 text-xs text-stone-600">{item.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-sand bg-white p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-ink">
            <CalendarRange className="h-5 w-5 text-antique" />
            2. Khoảng ngày tạo
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-stone-500">Từ ngày</span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink outline-none focus:border-antique"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-stone-500">Đến ngày</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink outline-none focus:border-antique"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { id: "7d", label: "7 ngày qua" },
              { id: "30d", label: "30 ngày qua" },
              { id: "month", label: "Tháng này" },
              { id: "all", label: "Tất cả thời gian" },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id as "7d" | "30d" | "month" | "all")}
                className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-warm-ivory/50"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500">Để trống cả hai ô để xuất toàn bộ dữ liệu. Ngày được tính theo giờ Việt Nam.</p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-lotus px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-oxblood disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          {busy ? "Đang tạo file..." : "Tải file CSV"}
        </button>
      </section>

      <aside className="space-y-4 lg:col-span-4">
        {last && (
          <div className="rounded-xl border border-sand bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-stone-500">Lần xuất gần nhất</p>
            <p className="mt-2 break-all text-sm font-semibold text-ink">{last.filename}</p>
            <p className="mt-1 text-xs text-stone-600">{last.rows.toLocaleString("vi-VN")} dòng</p>
            {last.truncated && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Dữ liệu vượt quá {last.maxRows.toLocaleString("vi-VN")} dòng nên chỉ xuất phần mới nhất. Hãy thu hẹp khoảng ngày để lấy đủ.
              </p>
            )}
          </div>
        )}

        <div className="rounded-xl border border-sand bg-warm-ivory/40 p-5 text-xs text-stone-600">
          <p className="mb-2 text-sm font-bold text-ink">Lưu ý bảo mật</p>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>File chứa thông tin cá nhân của khách hàng, chỉ lưu trên thiết bị tin cậy.</li>
            <li>Mỗi lần xuất được ghi vào nhật ký kiểm toán cùng loại dữ liệu và khoảng ngày.</li>
            <li>Mật khẩu và khóa bí mật không bao giờ nằm trong file xuất.</li>
            <li>Giá trị bắt đầu bằng dấu = + - @ được thêm dấu nháy để Excel không tự chạy công thức.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
