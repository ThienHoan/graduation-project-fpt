import { describe, expect, it } from "vitest";
import {
  allocateGarmentLines,
  largestRemainder,
  quoteChange,
  rentalDays,
} from "./booking-change-pricing";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("rentalDays", () => {
  it("tính bao gồm cả hai đầu", () => {
    expect(rentalDays(day("2026-11-10"), day("2026-11-10"))).toBe(1);
    expect(rentalDays(day("2026-11-10"), day("2026-11-12"))).toBe(3);
  });
});

describe("largestRemainder", () => {
  it("tổng chia khớp chính xác đến đồng", () => {
    const parts = largestRemainder(100_000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
    expect(parts).toEqual([33_334, 33_333, 33_333]);
  });

  it("trọng số 0 hết thì chia đều", () => {
    const parts = largestRemainder(10, [0, 0, 0]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("total 0 hoặc không có phần tử", () => {
    expect(largestRemainder(0, [3, 4])).toEqual([0, 0]);
    expect(largestRemainder(100, [])).toEqual([]);
  });
});

describe("allocateGarmentLines — phân bổ từ tổng đơn", () => {
  it("1 dòng áo: lineRental = garmentSubtotal, estimated = false", () => {
    const [line] = allocateGarmentLines({
      subtotal: 800_000,
      days: 2,
      accessoryItems: [{ id: "acc", rentalTotal: 100_000 }],
      items: [{ itemId: "A", dailyPrice: 400_000 }],
    });
    expect(line).toEqual({ itemId: "A", lineRental: 700_000, estimated: false, clamped: false });
  });

  it("nhiều dòng áo: Σ lineRental === garmentSubtotal, estimated = true", () => {
    const lines = allocateGarmentLines({
      subtotal: 800_000,
      days: 2,
      accessoryItems: [{ id: "acc", rentalTotal: 100_000 }],
      items: [
        { itemId: "A", dailyPrice: 400_000 },
        { itemId: "B", dailyPrice: 300_000 },
      ],
    });
    expect(lines.reduce((acc, l) => acc + l.lineRental, 0)).toBe(700_000);
    expect(lines.every((l) => l.estimated)).toBe(true);
    // Trọng số 400/300 → A nhận phần lớn hơn
    expect(lines[0].lineRental).toBe(400_000);
    expect(lines[1].lineRental).toBe(300_000);
  });

  it("Σ phụ kiện > subtotal (dữ liệu cũ): clamp garmentSubtotal về 0, gắn cờ clamped", () => {
    const lines = allocateGarmentLines({
      subtotal: 100_000,
      days: 2,
      accessoryItems: [{ id: "acc", rentalTotal: 250_000 }],
      items: [
        { itemId: "A", dailyPrice: 400_000 },
        { itemId: "B", dailyPrice: 300_000 },
      ],
    });
    expect(lines.reduce((acc, l) => acc + l.lineRental, 0)).toBe(0);
    expect(lines.every((l) => l.lineRental === 0 && l.clamped)).toBe(true);
  });
});

describe("quoteChange — ví dụ §6.3", () => {
  // Đơn gốc: A 400k, B 300k, phụ kiện 100k, voucher 100k
  // subtotal 800k, rentalTotal 700k, cọc 1.000k (A 400k + B 600k)
  const base = {
    days: 2,
    oldSubtotal: 800_000,
    oldDiscount: 100_000,
    oldRentalTotal: 700_000,
    oldDepositTotal: 1_000_000,
    addedAccessoryAmount: 0,
    removedAccessoryAmount: 0,
    changedGarments: [] as Array<{
      itemId: string;
      oldLine: number;
      newLine: number;
      oldDeposit: number;
      newDeposit: number;
    }>,
  };

  it("(a) đổi A → C (500k, cọc 600k): charge 300k (thuê 100k + cọc 200k)", () => {
    const quote = quoteChange({
      ...base,
      changedGarments: [{ itemId: "A", oldLine: 400_000, newLine: 500_000, oldDeposit: 400_000, newDeposit: 600_000 }],
    });
    expect(quote.newSubtotal).toBe(900_000);
    expect(quote.newRentalTotal).toBe(800_000);
    expect(quote.rentComponent).toBe(100_000);
    expect(quote.depositDelta).toBe(200_000);
    expect(quote.chargeAmount).toBe(300_000);
    expect(quote.creditAmount).toBe(0);
    expect(quote.lines).toEqual([
      { component: "rent", direction: "charge", amount: 100_000 },
      { component: "deposit", direction: "charge", amount: 200_000 },
    ]);
  });

  it("(b) bỏ A, giữ B + phụ kiện: 2 credit (thuê 400k, cọc 400k)", () => {
    const quote = quoteChange({
      ...base,
      changedGarments: [{ itemId: "A", oldLine: 400_000, newLine: 0, oldDeposit: 400_000, newDeposit: 0 }],
    });
    expect(quote.newSubtotal).toBe(400_000);
    expect(quote.newDiscount).toBe(100_000);
    expect(quote.newRentalTotal).toBe(300_000);
    expect(quote.newDepositTotal).toBe(600_000);
    expect(quote.rentComponent).toBe(-400_000);
    expect(quote.depositDelta).toBe(-400_000);
    expect(quote.chargeAmount).toBe(0);
    expect(quote.creditAmount).toBe(800_000);
    expect(quote.lines).toEqual([
      { component: "rent", direction: "credit", amount: 400_000 },
      { component: "deposit", direction: "credit", amount: 400_000 },
    ]);
  });

  it("(c) bỏ món làm voucher vượt: clamp discount, credit đúng tiền đã trả", () => {
    const quote = quoteChange({
      days: 2,
      oldSubtotal: 400_000,
      oldDiscount: 100_000,
      oldRentalTotal: 300_000,
      oldDepositTotal: 0,
      addedAccessoryAmount: 0,
      removedAccessoryAmount: 0,
      changedGarments: [{ itemId: "A", oldLine: 320_000, newLine: 0, oldDeposit: 0, newDeposit: 0 }],
    });
    // A 320k + B 80k = 400k subtotal; bỏ A ⇒ newSubtotal 80k, discount clamp 80k
    expect(quote.newSubtotal).toBe(80_000);
    expect(quote.newDiscount).toBe(80_000);
    expect(quote.newRentalTotal).toBe(0);
    expect(quote.rentComponent).toBe(-300_000);
    expect(quote.lines).toEqual([{ component: "rent", direction: "credit", amount: 300_000 }]);
  });

  it("(d) đổi sang mẫu rẻ hơn khi voucher đang clamp: credit 100k, không phải 300k", () => {
    const quote = quoteChange({
      days: 2,
      oldSubtotal: 600_000,
      oldDiscount: 500_000,
      oldRentalTotal: 100_000,
      oldDepositTotal: 0,
      addedAccessoryAmount: 0,
      removedAccessoryAmount: 0,
      changedGarments: [{ itemId: "A", oldLine: 600_000, newLine: 300_000, oldDeposit: 0, newDeposit: 0 }],
    });
    expect(quote.newSubtotal).toBe(300_000);
    expect(quote.newDiscount).toBe(300_000);
    expect(quote.newRentalTotal).toBe(0);
    expect(quote.rentComponent).toBe(-100_000);
    expect(quote.chargeAmount).toBe(0);
    expect(quote.creditAmount).toBe(100_000);
  });

  it("(e) áo tăng + phụ kiện giảm: không bù trừ, thu 100k và ghi credit 100k", () => {
    const quote = quoteChange({
      days: 2,
      oldSubtotal: 400_000,
      oldDiscount: 0,
      oldRentalTotal: 400_000,
      oldDepositTotal: 0,
      addedAccessoryAmount: 0,
      removedAccessoryAmount: 100_000,
      changedGarments: [{ itemId: "A", oldLine: 300_000, newLine: 400_000, oldDeposit: 0, newDeposit: 0 }],
    });
    expect(quote.rentComponent).toBe(100_000);
    expect(quote.accessoryDelta).toBe(-100_000);
    expect(quote.chargeAmount).toBe(100_000);
    expect(quote.creditAmount).toBe(100_000);
    expect(quote.lines).toEqual([
      { component: "rent", direction: "charge", amount: 100_000 },
      { component: "accessory_rent", direction: "credit", amount: 100_000 },
    ]);
  });

  it("bất biến: rentComponent + accessoryDelta === rentDelta", () => {
    const quote = quoteChange({
      ...base,
      addedAccessoryAmount: 50_000,
      removedAccessoryAmount: 20_000,
      changedGarments: [{ itemId: "A", oldLine: 400_000, newLine: 450_000, oldDeposit: 400_000, newDeposit: 500_000 }],
    });
    expect(quote.rentComponent + quote.accessoryDelta).toBe(quote.rentDelta);
    expect(quote.chargeAmount).toBe(
      quote.lines.filter((l) => l.direction === "charge").reduce((acc, l) => acc + l.amount, 0),
    );
  });

  it("làm tròn VND: không còn phần lẻ thập phân", () => {
    const quote = quoteChange({
      ...base,
      changedGarments: [{ itemId: "A", oldLine: 400_000.4, newLine: 500_000.6, oldDeposit: 0, newDeposit: 0 }],
    });
    for (const value of [quote.newSubtotal, quote.newRentalTotal, quote.rentComponent, quote.chargeAmount]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});