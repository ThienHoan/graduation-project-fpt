import { describe, expect, it } from "vitest";
import { addDaysUtc, formatDateOnly, parseRequestedDate } from "./date-utils";

// Thứ Năm, 29/10/2026 theo giờ local để không phụ thuộc timezone máy chạy.
const NOW = new Date(2026, 9, 29, 10, 30, 0);

function iso(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

describe("parseRequestedDate", () => {
  it("parses today, tomorrow and the day after", () => {
    expect(iso(parseRequestedDate("hôm nay còn không", NOW))).toBe("2026-10-29");
    expect(iso(parseRequestedDate("ngày mai còn không", NOW))).toBe("2026-10-30");
    expect(iso(parseRequestedDate("ngày kia còn không", NOW))).toBe("2026-10-31");
  });

  it("parses weekdays and the weekend", () => {
    expect(iso(parseRequestedDate("thứ 7 còn không", NOW))).toBe("2026-10-31");
    expect(iso(parseRequestedDate("chủ nhật còn không", NOW))).toBe("2026-11-01");
    expect(iso(parseRequestedDate("cuối tuần còn không", NOW))).toBe("2026-10-31");
  });

  it("parses explicit dates with slash, dash and ISO formats", () => {
    expect(iso(parseRequestedDate("20/11 còn không", NOW))).toBe("2026-11-20");
    expect(iso(parseRequestedDate("20-11 còn không", NOW))).toBe("2026-11-20");
    expect(iso(parseRequestedDate("20/11/2026 còn không", NOW))).toBe("2026-11-20");
    expect(iso(parseRequestedDate("2026-12-05 còn không", NOW))).toBe("2026-12-05");
  });

  it("rolls a past day-only date to the next month", () => {
    expect(iso(parseRequestedDate("ngày 20 còn không", NOW))).toBe("2026-11-20");
  });

  it("returns null when the message has no concrete date", () => {
    expect(parseRequestedDate("mẫu này còn hàng không", NOW)).toBeNull();
  });
});

describe("date helpers", () => {
  it("adds days in UTC and formats dates in UTC", () => {
    const date = new Date(Date.UTC(2026, 9, 29));
    expect(iso(addDaysUtc(date, 1))).toBe("2026-10-30");
    expect(formatDateOnly(date)).toBe("29/10/2026");
  });
});
