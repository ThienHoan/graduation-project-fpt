import { DAY_MS } from "./booking-inventory";

/**
 * Mục 4.4 — công thức tiền khi đổi mẫu / bỏ món (§6 của kế hoạch).
 *
 * Toàn bộ là hàm THUẦN (không đụng DB, không async) để dùng lại ở hai chỗ:
 *  - báo giá (§7.2): chốt newSubtotal/newDiscount/chargeAmount… lúc quote;
 *  - áp dụng (§8.1): ghi booking_adjustments + cập nhật tổng đơn từ quote đã chốt.
 *
 * Mọi số tiền làm tròn về đồng (VND, số nguyên).
 */

/** Số ngày thuê, tính bao gồm cả ngày đầu và ngày cuối (tối thiểu 1). */
export function rentalDays(startDay: Date, endDay: Date): number {
  const days = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
  return Math.max(1, days);
}

/** Làm tròn về đồng và chặn số âm rác từ dữ liệu cũ. */
function toVnd(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Chia một số nguyên `total` cho các trọng số theo phương pháp "largest remainder"
 * (Hamilton) để `Σ kết quả === total` chính xác đến đồng.
 *
 * Trọng số toàn 0 ⇒ chia đều; không có phần tử ⇒ mảng rỗng.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const target = Math.max(0, toVnd(total));
  if (target === 0) return new Array<number>(count).fill(0);

  const weightSum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  const effective = weightSum > 0 ? weights.map((w) => Math.max(0, w)) : new Array<number>(count).fill(1);
  const sum = weightSum > 0 ? weightSum : count;

  const raw = effective.map((w) => (target * w) / sum);
  const result = raw.map((v) => Math.floor(v));
  let remainder = target - result.reduce((acc, v) => acc + v, 0);

  const order = raw
    .map((v, index) => ({ index, rem: v - result[index] }))
    .sort((a, b) => b.rem - a.rem || a.index - b.index);
  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    result[order[i].index] += 1;
    remainder -= 1;
  }
  return result;
}

export type GarmentLineInput = {
  itemId: string;
  /** Giá/ngày tại thời điểm báo giá (dùng làm TRỌNG SỐ phân bổ, không phải giá chốt). */
  dailyPrice: number;
};

export type GarmentAllocation = {
  itemId: string;
  lineRental: number;
  /** true khi đơn có >1 dòng áo: tổng vẫn đúng, chỉ phân bổ giữa các dòng là ước tính. */
  estimated: boolean;
  /** true khi Σ phụ kiện > subtotal khiến `garmentSubtotal` bị clamp về 0 (dữ liệu cũ). */
  clamped: boolean;
};

/**
 * Phân bổ `garmentSubtotal` cho từng dòng áo theo trọng số `dailyPrice × days`.
 * Bất biến: `Σ lineRental === garmentSubtotal` (chính xác đến đồng).
 *
 * `garmentSubtotal = booking.subtotal − Σ accessoryItem.rentalTotal` (§5.1 bước 6).
 *
 * Guard: nếu dữ liệu cũ khiến `Σ accessory.rentalTotal > subtotal` thì `garmentSubtotal`
 * bị clamp về 0 (không phân bổ số âm cho áo) và đánh dấu `clamped: true` để nơi gọi
 * biết tổng phụ kiện đang vượt subtotal.
 */
export function allocateGarmentLines(input: {
  subtotal: number;
  days: number;
  accessoryItems: Array<{ id: string; rentalTotal: number }>;
  items: GarmentLineInput[];
}): GarmentAllocation[] {
  if (input.items.length === 0) return [];
  const accessoryTotal = input.accessoryItems.reduce((acc, item) => acc + toVnd(item.rentalTotal), 0);
  const rawGarmentSubtotal = toVnd(input.subtotal) - accessoryTotal;
  const clamped = rawGarmentSubtotal < 0;
  const garmentSubtotal = Math.max(0, rawGarmentSubtotal);
  const days = Math.max(1, Math.round(input.days) || 1);
  const weights = input.items.map((item) => Math.max(0, toVnd(item.dailyPrice)) * days);
  const amounts = largestRemainder(garmentSubtotal, weights);
  const estimated = input.items.length > 1;
  return input.items.map((item, index) => ({
    itemId: item.itemId,
    lineRental: amounts[index] ?? 0,
    estimated,
    clamped,
  }));
}

export type AdjustmentComponent = "rent" | "accessory_rent" | "deposit";
export type AdjustmentDirection = "charge" | "credit";

export type ChangeAdjustmentLine = {
  component: AdjustmentComponent;
  direction: AdjustmentDirection;
  amount: number;
};

/** Một dòng áo thay đổi: bỏ món ⇒ `newLine = newDeposit = 0`. */
export type ChangedGarment = {
  itemId: string;
  /** `incident.snapshot.lineRental` của dòng cũ. */
  oldLine: number;
  /** Giá mới đã chốt lúc báo giá (`pricing.quoteRental`). */
  newLine: number;
  oldDeposit: number;
  newDeposit: number;
};

export type ChangeQuoteInput = {
  days: number;
  oldSubtotal: number;
  oldDiscount: number;
  oldRentalTotal: number;
  oldDepositTotal: number;
  /** Σ tiền thuê phụ kiện THÊM (đã chốt lúc báo giá). */
  addedAccessoryAmount: number;
  /** Σ tiền thuê phụ kiện BỎ. */
  removedAccessoryAmount: number;
  changedGarments: ChangedGarment[];
};

export type ChangeQuote = {
  days: number;
  newSubtotal: number;
  newDiscount: number;
  newRentalTotal: number;
  newDepositTotal: number;
  rentDelta: number;
  /** Phần "áo + voucher" trong thay đổi tiền thuê (đúng dấu cả khi voucher bị clamp). */
  rentComponent: number;
  accessoryDelta: number;
  depositDelta: number;
  /** Tổng tiền phải thu thêm ngay (= Σ dòng charge). */
  chargeAmount: number;
  /** Tổng tiền ghi nhận hoàn khi trả đồ (= Σ dòng credit). */
  creditAmount: number;
  lines: ChangeAdjustmentLine[];
};

/**
 * Tính chênh lệch khi đổi mẫu / bỏ món theo §6.2.
 *
 * Quy ước bù trừ: TRONG tiền thuê áo cộng dồn; GIỮA thuê / phụ kiện / cọc KHÔNG bù trừ.
 * Voucher chỉ bị hạ xuống `min(oldDiscount, newSubtotal)`, không tăng, không xét lại điều kiện.
 */
export function quoteChange(input: ChangeQuoteInput): ChangeQuote {
  const days = Math.max(1, Math.round(input.days) || 1);
  const oldSubtotal = Math.max(0, toVnd(input.oldSubtotal));
  const oldDiscount = Math.max(0, toVnd(input.oldDiscount));
  const oldRentalTotal = Math.max(0, toVnd(input.oldRentalTotal));
  const oldDepositTotal = Math.max(0, toVnd(input.oldDepositTotal));

  let changedGarmentDelta = 0;
  let changedDepositDelta = 0;
  for (const garment of input.changedGarments) {
    changedGarmentDelta += toVnd(garment.newLine) - toVnd(garment.oldLine);
    changedDepositDelta += toVnd(garment.newDeposit) - toVnd(garment.oldDeposit);
  }

  const accessoryDelta = toVnd(input.addedAccessoryAmount) - toVnd(input.removedAccessoryAmount);

  const newSubtotal = Math.max(0, oldSubtotal + changedGarmentDelta + accessoryDelta);
  const newDiscount = Math.max(0, Math.min(oldDiscount, newSubtotal));
  const newRentalTotal = Math.max(0, newSubtotal - newDiscount);
  const newDepositTotal = Math.max(0, oldDepositTotal + changedDepositDelta);

  const rentDelta = newRentalTotal - oldRentalTotal;
  // rentComponent + accessoryDelta === rentDelta (bất biến §6.2).
  const rentComponent = rentDelta - accessoryDelta;
  const depositDelta = newDepositTotal - oldDepositTotal;

  const lines: ChangeAdjustmentLine[] = [];
  const pushLine = (component: AdjustmentComponent, delta: number) => {
    const amount = Math.abs(toVnd(delta));
    if (amount === 0) return;
    lines.push({ component, direction: delta > 0 ? "charge" : "credit", amount });
  };
  pushLine("rent", rentComponent);
  pushLine("accessory_rent", accessoryDelta);
  pushLine("deposit", depositDelta);

  const chargeAmount = Math.max(0, rentComponent) + Math.max(0, accessoryDelta) + Math.max(0, depositDelta);
  const creditAmount = Math.max(0, -rentComponent) + Math.max(0, -accessoryDelta) + Math.max(0, -depositDelta);

  return {
    days,
    newSubtotal,
    newDiscount,
    newRentalTotal,
    newDepositTotal,
    rentDelta,
    rentComponent,
    accessoryDelta,
    depositDelta,
    chargeAmount,
    creditAmount,
    lines,
  };
}