import { describe, expect, it, vi } from "vitest";
import { holdSpan, loadActiveHolds, loadAssetHolds } from "./booking-change-holds";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const now = day("2026-01-05");

function clientReturning(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { client: { bookingChangeHold: { findMany } } as never, findMany };
}

describe("booking-change-holds — §10 điều kiện hold 'sống'", () => {
  it("chỉ lấy hold còn hạn và chưa tiêu thụ, giao với khoảng ngày", async () => {
    const { client, findMany } = clientReturning([]);
    await loadActiveHolds(client, { from: day("2026-01-01"), to: day("2026-01-10"), now });

    const where = findMany.mock.calls[0][0].where;
    expect(where.expiresAt).toEqual({ gt: now });
    expect(where.consumedAt).toBeNull();
    expect(where.startDay).toEqual({ lte: day("2026-01-10") });
    expect(where.endDay).toEqual({ gte: day("2026-01-01") });
  });

  it("bỏ hold của chính booking / chính change request đang xét", async () => {
    const { client, findMany } = clientReturning([]);
    await loadActiveHolds(client, {
      from: day("2026-01-01"),
      to: day("2026-01-10"),
      now,
      excludeBookingId: "booking-1",
      excludeChangeRequestId: "request-1",
    });

    const where = findMany.mock.calls[0][0].where;
    expect(where.bookingId).toEqual({ not: "booking-1" });
    expect(where.changeRequestId).toEqual({ not: "request-1" });
  });

  it("loadAssetHolds chỉ giữ hold của đúng asset yêu cầu", async () => {
    const { client } = clientReturning([
      { id: "h1", garmentAssetId: "asset-a", accessoryAssetId: null, startDay: day("2026-01-01"), endDay: day("2026-01-02"), changeRequestId: "r1", bookingId: "b1", kind: "garment" },
      { id: "h2", garmentAssetId: "asset-b", accessoryAssetId: null, startDay: day("2026-01-01"), endDay: day("2026-01-02"), changeRequestId: "r2", bookingId: "b2", kind: "garment" },
    ]);

    const holds = await loadAssetHolds(client, {
      garmentAssetId: "asset-a",
      from: day("2026-01-01"),
      to: day("2026-01-10"),
      now,
    });
    expect(holds.map((hold) => hold.id)).toEqual(["h1"]);
  });

  it("hold hết hạn hoặc đã tiêu thụ không được tính (§10.1)", async () => {
    const rows = [
      { id: "live", expiresAt: day("2026-01-06"), consumedAt: null },
      { id: "expired", expiresAt: day("2026-01-04"), consumedAt: null },
      { id: "consumed", expiresAt: day("2026-01-06"), consumedAt: day("2026-01-03") },
    ];
    // Mô phỏng đúng điều kiện DB: expiresAt > now AND consumedAt IS NULL.
    const findMany = vi.fn(async ({ where }: { where: { expiresAt: { gt: Date } } }) =>
      rows.filter((row) => +row.expiresAt > +where.expiresAt.gt && row.consumedAt === null),
    );
    const client = { bookingChangeHold: { findMany } } as never;

    const holds = await loadActiveHolds(client, { from: day("2026-01-01"), to: day("2026-01-10"), now });
    expect(holds.map((hold) => hold.id)).toEqual(["live"]);
  });

  it("holdSpan cộng thêm ngày đệm giặt vào ngày kết thúc", () => {
    const span = holdSpan({ startDay: day("2026-01-01"), endDay: day("2026-01-03") }, 1);
    expect(span.from).toBe(+day("2026-01-01"));
    expect(span.to).toBe(+day("2026-01-04"));
  });

  it("holdSpan không đệm khi buffer = 0", () => {
    const span = holdSpan({ startDay: day("2026-01-01"), endDay: day("2026-01-03") }, 0);
    expect(span.to).toBe(+day("2026-01-03"));
  });
});
