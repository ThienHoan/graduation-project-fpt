"use client";

import { useMemo, useState } from "react";

const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function toIso(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

export function RentalDateCalendar({
  startDate,
  endDate,
  minDate,
  maxDate,
  fullyBookedDates,
  loading,
  onChange,
}: {
  startDate: string;
  endDate: string;
  minDate: string;
  maxDate: string;
  fullyBookedDates: Set<string>;
  loading?: boolean;
  onChange: (start: string, end: string) => void;
}) {
  const todayParts = useMemo(() => parseIso(minDate), [minDate]);
  const maxParts = useMemo(() => parseIso(maxDate), [maxDate]);
  const [viewYear, setViewYear] = useState(todayParts.year);
  const [viewMonth, setViewMonth] = useState(todayParts.month);

  const years: number[] = [];
  for (let y = todayParts.year; y <= maxParts.year; y++) years.push(y);
  const months = Array.from({ length: 12 }, (_, i) => i);
  const isMonthDisabled = (y: number, m: number) =>
    y * 12 + m < todayParts.year * 12 + todayParts.month ||
    y * 12 + m > maxParts.year * 12 + maxParts.month;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // Thứ 2 đầu tuần: Chủ nhật (0) -> offset 6
  const leadingBlanks = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  const canPrev =
    viewYear > todayParts.year || (viewYear === todayParts.year && viewMonth > todayParts.month);
  const canNext =
    viewYear < maxParts.year || (viewYear === maxParts.year && viewMonth < maxParts.month);

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  function handlePick(dayIso: string) {
    if (!startDate || (startDate && endDate && endDate !== startDate)) {
      // Bắt đầu chọn mới (ngày đầu = cả đầu và cuối để luôn hợp lệ)
      onChange(dayIso, dayIso);
      return;
    }
    if (dayIso < startDate) {
      onChange(dayIso, dayIso);
    } else {
      onChange(startDate, dayIso);
    }
  }

  function formatShort(iso: string) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}`;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={!canPrev}
          className="rounded-full p-1.5 text-stone-500 transition hover:bg-white hover:text-lotus disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-500"
          aria-label="Tháng trước"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
        <div className="flex items-center gap-2">
          <select
            value={viewMonth}
            onChange={(e) => setViewMonth(Number(e.target.value))}
            className="rounded-lg border border-sand bg-white px-2 py-1.5 text-sm font-semibold text-ink outline-none focus:border-antique"
            aria-label="Chọn tháng"
          >
            {months.map((m) => (
              <option key={m} value={m} disabled={isMonthDisabled(viewYear, m)}>
                Tháng {m + 1}
              </option>
            ))}
          </select>
          <select
            value={viewYear}
            onChange={(e) => {
              const y = Number(e.target.value);
              setViewYear(y);
              if (isMonthDisabled(y, viewMonth)) {
                setViewMonth(y === todayParts.year ? todayParts.month : maxParts.month);
              }
            }}
            className="rounded-lg border border-sand bg-white px-2 py-1.5 text-sm font-semibold text-ink outline-none focus:border-antique"
            aria-label="Chọn năm"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={!canNext}
          className="rounded-full p-1.5 text-stone-500 transition hover:bg-white hover:text-lotus disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-500"
          aria-label="Tháng sau"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
        </button>
      </div>

      {loading && <p className="mb-2 text-xs text-stone-400">Đang tải lịch còn hàng...</p>}

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            {w}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const iso = toIso(viewYear, viewMonth, day);
          const isPast = iso < minDate;
          const isBeyondMax = iso > maxDate;
          const isFull = fullyBookedDates.has(iso);
          const disabled = isPast || isBeyondMax || isFull;
          const isStart = iso === startDate;
          const isEnd = iso === endDate;
          const inRange = startDate && endDate && iso > startDate && iso < endDate;
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => handlePick(iso)}
              title={isPast ? "Đã qua" : isFull ? "Hết hàng ngày này" : `Chọn ${formatShort(iso)}`}
              className={`flex h-9 items-center justify-center rounded-lg text-sm transition ${
                isStart || (isEnd && endDate !== startDate)
                  ? "bg-lotus font-semibold text-white"
                  : inRange
                    ? "bg-lotus/10 font-medium text-lotus"
                    : disabled
                      ? "cursor-not-allowed text-stone-300 line-through"
                      : "text-ink hover:bg-parchment"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-lotus" /> Ngày nhận / trả
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-lotus/10" /> Trong khoảng thuê
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded text-center text-stone-300 line-through">31</span> Hết hàng / đã qua
        </span>
      </div>
    </div>
  );
}
