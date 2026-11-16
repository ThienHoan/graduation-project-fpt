import { describe, expect, it } from "vitest";
import type { StaffBookingResponse } from "@/lib/api";
import { staffRefundDue } from "./refund-due";

function booking(overrides: Partial<StaffBookingResponse> = {}): StaffBookingResponse {
  return {
    depositTotal: 300_000,
    penaltyTotal: 0,
    status: "completed",
    ...overrides,
  } as StaffBookingResponse;
}

describe("staffRefundDue", () => {
  it("đơn hoàn cọc thường: cọc + credit − phạt", () => {
    expect(
      staffRefundDue(booking({ depositTotal: 500_000, penaltyTotal: 100_000, accruedCreditTotal: 200_000 })),
    ).toBe(600_000);
  });

  it("không âm khi phạt ≥ cọc + credit", () => {
    expect(staffRefundDue(booking({ depositTotal: 100_000, penaltyTotal: 300_000 }))).toBe(0);
  });

  it("đơn huỷ do từ chối bàn giao: hoàn toàn bộ tiền thực thu − phiếu hoàn đã tạo", () => {
    // Cọc 300k + tiền thuê 500k = đã thu 800k. Phiếu hoàn 800k đang chờ.
    expect(
      staffRefundDue(
        booking({
          status: "cancelled",
          depositTotal: 300_000,
          accruedCreditTotal: 0,
          cancellationRefund: { paidTotal: 800_000, coveringRefundsTotal: 800_000 },
        }),
      ),
    ).toBe(0);
    expect(
      staffRefundDue(
        booking({
          status: "cancelled",
          depositTotal: 300_000,
          cancellationRefund: { paidTotal: 800_000, coveringRefundsTotal: 0 },
        }),
      ),
    ).toBe(800_000);
  });

  it("đơn huỷ chưa có số liệu BE: dùng phiếu hoàn đang chờ (không dùng cọc − phạt)", () => {
    expect(
      staffRefundDue(
        booking({
          status: "cancelled",
          depositTotal: 300_000,
          refunds: [
            {
              id: "r-2",
              amount: 800_000,
              status: "pending",
              refundMethod: "cash",
              createdAt: "",
              updatedAt: "",
            },
          ],
        }),
      ),
    ).toBe(800_000);
  });
});