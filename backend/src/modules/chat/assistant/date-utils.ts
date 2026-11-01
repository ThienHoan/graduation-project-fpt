import { foldVietnamese, normalizeForMatch } from "./text-utils";

const WEEKDAY_BY_NAME: Record<string, number> = {
  "thu 2": 1,
  "thu 3": 2,
  "thu 4": 3,
  "thu 5": 4,
  "thu 6": 5,
  "thu 7": 6,
  "chu nhat": 0,
};

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

function validDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}

function nextWeekday(today: Date, target: number): Date {
  const current = today.getDay();
  const delta = (target - current + 7) % 7;
  return addDays(today, delta);
}

/**
 * Đọc ngày khách muốn kiểm tra tồn kho.
 *
 * Hỗ trợ: hôm nay/ngày mai/ngày kia, thứ 2..7/chủ nhật/cuối tuần,
 * 20/11, 20-11-2026, 2026-11-20 và "ngày 20".
 * Trả về Date ở 00:00 UTC (đúng kiểu cột @db.Date của Prisma), hoặc null khi
 * câu không có ngày cụ thể.
 */
export function parseRequestedDate(
  content: string,
  now: Date = new Date(),
): Date | null {
  const normalized = normalizeForMatch(content);
  const folded = foldVietnamese(content ?? "");
  const today = startOfDay(now);

  if (/\bhom nay\b/.test(normalized)) return toDateOnly(today);
  if (/\bngay mai\b/.test(normalized)) return toDateOnly(addDays(today, 1));
  if (/\bngay kia\b/.test(normalized)) return toDateOnly(addDays(today, 2));
  if (/\bcuoi tuan\b/.test(normalized)) return toDateOnly(nextWeekday(today, 6));

  for (const [name, weekday] of Object.entries(WEEKDAY_BY_NAME)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized)) {
      return toDateOnly(nextWeekday(today, weekday));
    }
  }

  const iso = folded.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slash = folded.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3]
      ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3])
      : today.getFullYear();
    const parsed = validDate(year, Number(slash[2]), Number(slash[1]));
    if (parsed && !slash[3] && parsed.getTime() < toDateOnly(today).getTime()) {
      return validDate(year + 1, Number(slash[2]), Number(slash[1]));
    }
    return parsed;
  }

  const dayOnly = normalized.match(/\bngay (\d{1,2})\b/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    const candidate = validDate(today.getFullYear(), today.getMonth() + 1, day);
    if (candidate && candidate.getTime() < toDateOnly(today).getTime()) {
      return validDate(today.getFullYear(), today.getMonth() + 2, day);
    }
    return candidate;
  }

  return null;
}

export function addDaysUtc(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function formatDateOnly(value: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}
