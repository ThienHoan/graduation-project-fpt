import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { GarmentsExportService, type GarmentAssetsExportData } from "./garments-export.service";

describe("GarmentsExportService", () => {
  const service = new GarmentsExportService();

  const mockData: GarmentAssetsExportData = {
    generatedAt: new Date("2026-11-10T09:00:00Z"),
    actorName: "Quản lý Cổ Phục",
    items: [
      {
        id: "asset-1",
        assetCode: "NB-DO-001",
        garmentName: "Áo Nhật Bình Hoàng Cung Đỏ",
        categoryName: "Áo Nhật Bình",
        sizeLabel: "L",
        status: "available",
        purchaseCost: 3500000,
        dailyPrice: 200000,
        depositAmount: 800000,
        conditionNote: "Tình trạng mới 98%",
        rentalCount: 14,
        createdAt: new Date("2026-01-15"),
      },
      {
        id: "asset-2",
        assetCode: "NG-XANH-002",
        garmentName: "Áo Ngũ Thân Tay Chẽn Nam",
        categoryName: "Áo Ngũ Thân",
        sizeLabel: "XL",
        status: "rented",
        purchaseCost: 2800000,
        dailyPrice: 180000,
        depositAmount: 700000,
        conditionNote: "Đang cho khách thuê",
        rentalCount: 8,
        createdAt: new Date("2026-02-20"),
      },
      {
        id: "asset-3",
        assetCode: "TC-VANG-003",
        garmentName: "Áo Tấc Nữ Vàng Hoàng Cúc",
        categoryName: "Áo Tấc",
        sizeLabel: "M",
        status: "laundry",
        purchaseCost: 2400000,
        dailyPrice: 150000,
        depositAmount: 600000,
        conditionNote: "Đang giặt hấp sau khi trả đồ",
        rentalCount: 22,
        createdAt: new Date("2026-03-01"),
      },
      {
        id: "asset-4",
        assetCode: "NB-HOA-004",
        garmentName: "Áo Nhật Bình Tứ Linh",
        categoryName: "Áo Nhật Bình",
        sizeLabel: "S",
        status: "damaged",
        purchaseCost: 4200000,
        dailyPrice: 250000,
        depositAmount: 1000000,
        conditionNote: "Rách đường viền tà sau, chờ may phục chế",
        rentalCount: 19,
        createdAt: new Date("2025-12-10"),
      },
    ],
    catalogs: [
      {
        id: "garment-1",
        name: "Áo Nhật Bình Hoàng Cung Đỏ",
        categoryName: "Áo Nhật Bình",
        color: "Đỏ",
        material: "Gấm thượng uyển, lụa tơ tằm",
        sizesSummary: "S, M, L",
        dailyPriceMin: 180000,
        dailyPriceMax: 220000,
        depositAmountMin: 700000,
        depositAmountMax: 900000,
        totalAssets: 3,
        availableAssets: 2,
        rentedAssets: 1,
        maintenanceAssets: 0,
        rentalCount: 42,
      },
    ],
  };

  it("should generate a valid Excel workbook buffer with required sheets", async () => {
    const buffer = await service.generateAssetsExcel(mockData);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // Excel .xlsx ZIP magic bytes (PK..)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    // Verify content by loading with ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheet1 = workbook.getWorksheet("Danh Mục Hiện Vật");
    expect(sheet1).toBeDefined();
    expect(sheet1?.name).toBe("Danh Mục Hiện Vật");

    const sheet2 = workbook.getWorksheet("Thống Kê Kho");
    expect(sheet2).toBeDefined();
    expect(sheet2?.name).toBe("Thống Kê Kho");

    const sheet3 = workbook.getWorksheet("Danh Mục Mẫu Trang Phục");
    expect(sheet3).toBeDefined();
    expect(sheet3?.name).toBe("Danh Mục Mẫu Trang Phục");
    expect(sheet3?.rowCount).toBeGreaterThanOrEqual(5);
  });

  it("should handle empty asset list without errors", async () => {
    const emptyData: GarmentAssetsExportData = {
      generatedAt: new Date(),
      actorName: "Test Manager",
      items: [],
    };

    const buffer = await service.generateAssetsExcel(emptyData);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
  });
});

