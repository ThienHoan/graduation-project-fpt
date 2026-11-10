import { describe, it, expect } from "vitest";
import { BookingsExportService } from "./bookings-export.service";

describe("BookingsExportService", () => {
  const service = new BookingsExportService();

  const mockBooking = {
    id: "booking-12345678",
    status: "ready_for_pickup",
    pickupMethod: "store_pickup",
    rentalStartDate: new Date("2026-11-15T00:00:00Z"),
    rentalEndDate: new Date("2026-11-18T00:00:00Z"),
    subtotal: 1200000,
    discountTotal: 100000,
    shippingFee: 0,
    rentalTotal: 1100000,
    depositTotal: 2000000,
    voucherCode: "GIAM100",
    customer: {
      email: "khachhang@example.com",
      profile: {
        fullName: "Nguyễn Văn A",
        phone: "0901234567",
      },
    },
    deliveryAddress: null,
    items: [
      {
        id: "item-1",
        rentalPrice: 1200000,
        depositPrice: 2000000,
        garment: { name: "Áo Nhật Bình Cung Đình Huế" },
        size: { sizeLabel: "L" },
        garmentAsset: { assetCode: "CP-NB-001" },
      },
    ],
    accessories: [
      {
        id: "acc-1",
        rentalPrice: 50000,
        depositPrice: 100000,
        accessory: { name: "Mấn Đội Đầu Thêu Hoa" },
        accessoryAsset: { assetCode: "PK-MD-005" },
      },
    ],
  };

  it("should generate a valid PDF handover slip for store pickup with signatures", async () => {
    const buffer = await service.generateHandoverSlip({
      ...mockBooking,
      pickupMethod: "store_pickup",
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should generate a valid PDF shipping label / packing slip for delivery", async () => {
    const buffer = await service.generateHandoverSlip({
      ...mockBooking,
      pickupMethod: "delivery",
      deliveryAddress: {
        receiverName: "Trần Thị B",
        phone: "0987654321",
        streetAddress: "123 Đường Lê Lợi",
        ward: "Phường Bến Thành",
        district: "Quận 1",
        city: "TP. Hồ Chí Minh",
      },
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should generate a valid PDF handover slip with confirmed handover audit details", async () => {
    const buffer = await service.generateHandoverSlip({
      ...mockBooking,
      status: "renting",
      pickupMethod: "store_pickup",
      handover: {
        status: "CONFIRMED",
        conditionBeforeRental: "GOOD",
        deliveredBy: "Nhân viên Nguyễn Thị C",
        receivedBy: "Nguyễn Văn A",
        receiverPhone: "0901234567",
        confirmedAt: new Date("2026-11-15T10:30:00Z"),
        note: null,
      },
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should format multi-day rental with discounts clearly without ambiguity (e.g. 340k/day x 2 days - 72k = 608k)", async () => {
    const buffer = await service.generateHandoverSlip({
      id: "booking-3C00B0A6",
      status: "paid",
      pickupMethod: "store_pickup",
      rentalStartDate: new Date("2026-11-10T00:00:00Z"),
      rentalEndDate: new Date("2026-11-11T00:00:00Z"),
      rentalDays: 2,
      subtotal: 680000,
      discountTotal: 72000,
      shippingFee: 0,
      rentalTotal: 608000,
      depositTotal: 1050000,
      voucherCode: "GIAM72K",
      paymentMethod: "payos",
      customer: {
        email: "ngocson@example.com",
        profile: {
          fullName: "Ngọc Sơn",
          phone: "0912345678",
        },
      },
      items: [
        {
          id: "item-1",
          dailyPrice: 340000,
          rentalDays: 2,
          rentalPrice: 680000,
          depositPrice: 1050000,
          garment: { name: "Áo dài tím hoa cúc" },
          size: { sizeLabel: "L" },
          garmentAsset: { assetCode: "ADT-003-C" },
        },
      ],
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("should auto-reconcile implicit discount when subtotal in DB equals discounted rentalTotal (e.g. subtotal 608k, daily 340k x 2 days)", async () => {
    const buffer = await service.generateHandoverSlip({
      id: "booking-3C00B0A7",
      status: "paid",
      pickupMethod: "store_pickup",
      rentalStartDate: new Date("2026-11-10T00:00:00Z"),
      rentalEndDate: new Date("2026-11-11T00:00:00Z"),
      rentalDays: 2,
      subtotal: 608000, // DB had discounted rentalTotal stored as subtotal
      discountTotal: 0, // DB had 0 discountTotal
      shippingFee: 0,
      rentalTotal: 608000,
      depositTotal: 1050000,
      discountReason: "Ưu đãi chính sách giá thuê theo ngày",
      paymentMethod: "payos",
      customer: {
        email: "ngocson@example.com",
        profile: {
          fullName: "Ngọc Sơn",
          phone: "0912345678",
        },
      },
      items: [
        {
          id: "item-1",
          dailyPrice: 340000,
          rentalDays: 2,
          rentalPrice: 680000,
          depositPrice: 1050000,
          garment: { name: "Áo dài tím hoa cúc" },
          size: { sizeLabel: "L" },
          garmentAsset: { assetCode: "ADT-003-C" },
        },
      ],
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

