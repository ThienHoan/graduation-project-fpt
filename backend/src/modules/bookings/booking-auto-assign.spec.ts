import { describe, expect, it } from "vitest";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { rankAssetCandidates, type AssetCandidate } from "./booking-auto-assign";

const START = new Date("2026-10-10T00:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function asset(code: string, status: AssetStatus, bookings: AssetCandidate["bookings"] = []): AssetCandidate {
  return { id: `id-${code}`, code, status, bookings };
}

describe("rankAssetCandidates", () => {
  it("prefers the least-worn asset among equally available ones", () => {
    const ranked = rankAssetCandidates(
      [
        asset("CP-001", AssetStatus.available, [
          { status: BookingStatus.completed, rentalStartDate: day("2026-08-01"), rentalEndDate: day("2026-08-03") },
          { status: BookingStatus.completed, rentalStartDate: day("2026-09-01"), rentalEndDate: day("2026-09-03") },
        ]),
        asset("CP-002", AssetStatus.available, [
          { status: BookingStatus.completed, rentalStartDate: day("2026-08-10"), rentalEndDate: day("2026-08-12") },
        ]),
      ],
      START,
    );

    expect(ranked.map((a) => a.code)).toEqual(["CP-002", "CP-001"]);
    expect(ranked[0].usageCount).toBe(1);
  });

  it("does not count cancelled or rejected bookings as wear", () => {
    const ranked = rankAssetCandidates(
      [
        asset("CP-001", AssetStatus.available, [
          { status: BookingStatus.cancelled, rentalStartDate: day("2026-08-01"), rentalEndDate: day("2026-08-03") },
          { status: BookingStatus.rejected, rentalStartDate: day("2026-08-05"), rentalEndDate: day("2026-08-06") },
        ]),
        asset("CP-002", AssetStatus.available, [
          { status: BookingStatus.completed, rentalStartDate: day("2026-08-10"), rentalEndDate: day("2026-08-12") },
        ]),
      ],
      START,
    );

    expect(ranked[0].code).toBe("CP-001");
    expect(ranked[0].usageCount).toBe(0);
  });

  it("puts assets coming back from a rental that ends right before the start date last", () => {
    const ranked = rankAssetCandidates(
      [
        // Đang cho thuê, trả ngày 09 → chỉ còn 1 ngày để kiểm + giặt.
        asset("CP-001", AssetStatus.rented, [
          { status: BookingStatus.renting, rentalStartDate: day("2026-10-05"), rentalEndDate: day("2026-10-09") },
        ]),
        // Đang cho thuê nhưng trả từ ngày 06 → đủ thời gian quay vòng.
        asset("CP-002", AssetStatus.rented, [
          { status: BookingStatus.renting, rentalStartDate: day("2026-10-03"), rentalEndDate: day("2026-10-06") },
          { status: BookingStatus.completed, rentalStartDate: day("2026-09-01"), rentalEndDate: day("2026-09-02") },
          { status: BookingStatus.completed, rentalStartDate: day("2026-08-01"), rentalEndDate: day("2026-08-02") },
        ]),
      ],
      START,
    );

    expect(ranked.map((a) => a.code)).toEqual(["CP-002", "CP-001"]);
    expect(ranked[1].tightTurnaround).toBe(true);
  });

  it("prefers assets already in stock over reserved or rented ones", () => {
    const ranked = rankAssetCandidates(
      [
        asset("CP-003", AssetStatus.rented),
        asset("CP-002", AssetStatus.reserved),
        asset("CP-001", AssetStatus.available, [
          { status: BookingStatus.completed, rentalStartDate: day("2026-08-01"), rentalEndDate: day("2026-08-03") },
        ]),
      ],
      START,
    );

    expect(ranked.map((a) => a.code)).toEqual(["CP-001", "CP-002", "CP-003"]);
  });

  it("drops assets that cannot be rented at all", () => {
    const ranked = rankAssetCandidates(
      [asset("CP-001", AssetStatus.maintenance), asset("CP-002", AssetStatus.laundry), asset("CP-003", AssetStatus.available)],
      START,
    );

    expect(ranked.map((a) => a.code)).toEqual(["CP-003"]);
  });

  it("respects custom minTurnaroundDays when evaluating tightTurnaround", () => {
    // START là 2026-10-10. Chiếc CP-001 trả ngày 2026-10-07 (cách 3 ngày).
    // Với default minTurnaroundDays = 2: gapDays = 3 >= 2 → không bị tight.
    // Với custom minTurnaroundDays = 4: gapDays = 3 < 4 → bị coi là tight turnaround.
    const candidates = [
      asset("CP-001", AssetStatus.available, [
        { status: BookingStatus.renting, rentalStartDate: day("2026-10-01"), rentalEndDate: day("2026-10-07") },
      ]),
      asset("CP-002", AssetStatus.available, []),
    ];

    const rankedDefault = rankAssetCandidates(candidates, START);
    expect(rankedDefault[0].tightTurnaround).toBe(false);

    const rankedCustom = rankAssetCandidates(candidates, START, { minTurnaroundDays: 4 });
    const cp001 = rankedCustom.find((a) => a.code === "CP-001")!;
    expect(cp001.tightTurnaround).toBe(true);
    // CP-002 không bị tight nên được xếp trước CP-001
    expect(rankedCustom[0].code).toBe("CP-002");
  });
});
