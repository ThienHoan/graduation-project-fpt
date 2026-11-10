import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";

export interface GarmentAssetExportItem {
  id: string;
  assetCode: string;
  garmentName: string;
  categoryName?: string | null;
  sizeLabel?: string | null;
  status: string;
  purchaseCost?: number | null;
  dailyPrice?: number | null;
  depositAmount?: number | null;
  conditionNote?: string | null;
  rentalCount: number;
  createdAt: Date | string;
  updatedAt?: Date | string;
}

export interface GarmentCatalogExportItem {
  id: string;
  name: string;
  categoryName?: string | null;
  color?: string | null;
  material?: string | null;
  sizesSummary?: string | null;
  dailyPriceMin?: number | null;
  dailyPriceMax?: number | null;
  depositAmountMin?: number | null;
  depositAmountMax?: number | null;
  totalAssets: number;
  availableAssets: number;
  rentedAssets: number;
  maintenanceAssets: number;
  rentalCount: number;
}

export interface GarmentAssetsExportData {
  items: GarmentAssetExportItem[];
  catalogs?: GarmentCatalogExportItem[];
  generatedAt: Date;
  actorName?: string;
}

const STATUS_LABELS: Record<string, string> = {
  available: "Sẵn sàng",
  reserved: "Đã đặt trước",
  rented: "Đang cho thuê",
  inspection_pending: "Chờ kiểm tra",
  laundry: "Đang giặt / Vệ sinh",
  maintenance: "Đang bảo trì / Sửa chữa",
  cleaned: "Đã vệ sinh (Sẵn sàng)",
  damaged: "Hư hỏng",
  retired: "Ngừng kinh doanh",
  lost: "Thất lạc / Mất",
};

@Injectable()
export class GarmentsExportService {
  /**
   * Sinh file Excel (.xlsx) danh mục kiểm kê hiện vật trang phục
   * gồm 2 sheets:
   * 1. "Danh Mục Hiện Vật" - Danh sách chi tiết từng hiện vật vật lý
   * 2. "Thống Kê Kho" - Tổng hợp số lượng & tỷ lệ theo trạng thái
   */
  async generateAssetsExcel(data: GarmentAssetsExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Cổ Phục Việt ERP";
    workbook.created = data.generatedAt;

    const CURRENCY_FMT = '#,##0" đ"';
    const HEADER_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8B263E" }, // Brand lotus / burgundy
    };
    const HEADER_SUB_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2B3A4A" }, // Slate Navy
    };
    const SUMMARY_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFEAE2" }, // Sand accent
    };
    const BORDER_THIN: Partial<ExcelJS.Borders> = {
      top: { style: "thin", color: { argb: "FFD0C8BE" } },
      left: { style: "thin", color: { argb: "FFD0C8BE" } },
      bottom: { style: "thin", color: { argb: "FFD0C8BE" } },
      right: { style: "thin", color: { argb: "FFD0C8BE" } },
    };

    // ─────────────────────────────────────────────────────────────
    // Sheet 1: Danh Mục Hiện Vật
    // ─────────────────────────────────────────────────────────────
    const sheet1 = workbook.addWorksheet("Danh Mục Hiện Vật", {
      views: [{ state: "frozen", xSplit: 0, ySplit: 4 }],
    });

    sheet1.columns = [
      { key: "stt", width: 6 },
      { key: "assetCode", width: 16 },
      { key: "garmentName", width: 34 },
      { key: "categoryName", width: 20 },
      { key: "sizeLabel", width: 8 },
      { key: "status", width: 22 },
      { key: "dailyPrice", width: 17 },
      { key: "depositAmount", width: 17 },
      { key: "purchaseCost", width: 18 },
      { key: "rentalCount", width: 14 },
      { key: "conditionNote", width: 34 },
      { key: "createdAt", width: 15 },
    ];

    // Title Row
    const titleRow = sheet1.addRow(["BÁO CÁO KIỂM KÊ KHO HIỆN VẬT & TÀI SẢN TRANG PHỤC"]);
    titleRow.font = { name: "Arial", size: 15, bold: true, color: { argb: "FF8B263E" } };
    sheet1.mergeCells("A1:L1");

    // Subtitle Row
    const dateStr = data.generatedAt.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const subRow = sheet1.addRow([
      `Xuất lúc: ${dateStr} | Người lập: ${data.actorName ?? "Quản lý"} | Tổng hiện vật: ${data.items.length}`,
    ]);
    subRow.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF666666" } };
    sheet1.mergeCells("A2:L2");

    // Blank row
    sheet1.addRow([]);

    // Table Header
    const tableHeader = sheet1.addRow([
      "STT",
      "Mã Hiện Vật",
      "Tên Trang Phục",
      "Phân Loại",
      "Size",
      "Trạng Thái",
      "Giá Thuê/Ngày (đ)",
      "Mức Cọc (đ)",
      "Nguyên Giá (đ)",
      "Lượt Cho Thuê",
      "Ghi Chú Tình Trạng",
      "Ngày Nhập Kho",
    ]);
    tableHeader.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    tableHeader.alignment = { vertical: "middle", horizontal: "center" };
    tableHeader.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.border = BORDER_THIN;
    });

    // Populate Data
    let rowIndex = 5;
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const createdDate = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
      const createdFormatted = !isNaN(createdDate.getTime())
        ? createdDate.toLocaleDateString("vi-VN")
        : "";

      const row = sheet1.addRow([
        i + 1,
        item.assetCode,
        item.garmentName,
        item.categoryName ?? "-",
        item.sizeLabel ?? "-",
        STATUS_LABELS[item.status] ?? item.status,
        item.dailyPrice ?? 0,
        item.depositAmount ?? 0,
        item.purchaseCost ?? 0,
        item.rentalCount ?? 0,
        item.conditionNote ?? "",
        createdFormatted,
      ]);

      row.font = { name: "Arial", size: 10 };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(2).font = { name: "Arial", size: 10, bold: true };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(5).alignment = { horizontal: "center" };
      row.getCell(6).alignment = { horizontal: "center" };
      row.getCell(7).alignment = { horizontal: "right" };
      row.getCell(7).numFmt = CURRENCY_FMT;
      row.getCell(8).alignment = { horizontal: "right" };
      row.getCell(8).numFmt = CURRENCY_FMT;
      row.getCell(9).alignment = { horizontal: "right" };
      row.getCell(9).numFmt = CURRENCY_FMT;
      row.getCell(10).alignment = { horizontal: "center" };
      row.getCell(10).numFmt = "#,##0";
      row.getCell(12).alignment = { horizontal: "center" };

      // Zebra striping
      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFBF8F5" },
          };
        });
      }

      row.eachCell((cell) => {
        cell.border = BORDER_THIN;
      });

      rowIndex++;
    }

    // Summary / Total Row
    const startDataRow = 5;
    const lastDataRow = Math.max(startDataRow, rowIndex - 1);

    const totalRow = sheet1.addRow([
      "",
      "TỔNG CỘNG",
      `${data.items.length} hiện vật`,
      "",
      "",
      "",
      "",
      "",
      data.items.length > 0 ? { formula: `SUM(I${startDataRow}:I${lastDataRow})` } : 0,
      data.items.length > 0 ? { formula: `SUM(J${startDataRow}:J${lastDataRow})` } : 0,
      "",
      "",
    ]);
    totalRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF8B263E" } };
    totalRow.getCell(2).alignment = { horizontal: "center" };
    totalRow.getCell(9).alignment = { horizontal: "right" };
    totalRow.getCell(9).numFmt = CURRENCY_FMT;
    totalRow.getCell(10).alignment = { horizontal: "center" };
    totalRow.getCell(10).numFmt = "#,##0";
    totalRow.eachCell((cell) => {
      cell.fill = SUMMARY_FILL;
      cell.border = {
        top: { style: "double", color: { argb: "FF8B263E" } },
        bottom: { style: "thin", color: { argb: "FF8B263E" } },
        left: { style: "thin", color: { argb: "FFD0C8BE" } },
        right: { style: "thin", color: { argb: "FFD0C8BE" } },
      };
    });

    // Auto-filter on data table
    sheet1.autoFilter = {
      from: `A4`,
      to: `L${lastDataRow}`,
    };

    // ─────────────────────────────────────────────────────────────
    // Sheet 2: Thống Kê Kho (Summary by Status & Availability)
    // ─────────────────────────────────────────────────────────────
    const sheet2 = workbook.addWorksheet("Thống Kê Kho");
    sheet2.columns = [
      { key: "status", width: 26 },
      { key: "count", width: 14 },
      { key: "percent", width: 14 },
      { key: "totalCost", width: 22 },
    ];

    const s2Title = sheet2.addRow(["THỐNG KÊ TỔNG QUAN HIỆN VẬT THEO TRẠNG THÁI"]);
    s2Title.font = { name: "Arial", size: 14, bold: true, color: { argb: "FF2B3A4A" } };
    sheet2.mergeCells("A1:D1");

    const s2Sub = sheet2.addRow([`Tính đến thời điểm: ${dateStr}`]);
    s2Sub.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF666666" } };
    sheet2.mergeCells("A2:D2");

    sheet2.addRow([]);

    const s2Header = sheet2.addRow(["Trạng Thái", "Số Lượng", "Tỷ Lệ (%)", "Tổng Nguyên Giá (đ)"]);
    s2Header.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    s2Header.alignment = { vertical: "middle", horizontal: "center" };
    s2Header.eachCell((cell) => {
      cell.fill = HEADER_SUB_FILL;
      cell.border = BORDER_THIN;
    });

    // Group items by status
    const statusMap = new Map<string, { count: number; totalCost: number }>();
    for (const item of data.items) {
      const key = item.status || "other";
      const existing = statusMap.get(key) ?? { count: 0, totalCost: 0 };
      existing.count += 1;
      existing.totalCost += Number(item.purchaseCost ?? 0);
      statusMap.set(key, existing);
    }

    const totalCount = data.items.length;
    let s2RowIdx = 5;

    // Define standard display order
    const orderedStatuses = [
      "available",
      "rented",
      "reserved",
      "laundry",
      "maintenance",
      "cleaned",
      "inspection_pending",
      "damaged",
      "lost",
      "retired",
    ];

    // Ensure all existing statuses are covered
    for (const key of statusMap.keys()) {
      if (!orderedStatuses.includes(key)) {
        orderedStatuses.push(key);
      }
    }

    for (const key of orderedStatuses) {
      const stat = statusMap.get(key) ?? { count: 0, totalCost: 0 };
      // Include row even if count 0 for completeness
      const pct = totalCount > 0 ? stat.count / totalCount : 0;
      const row = sheet2.addRow([
        STATUS_LABELS[key] ?? key,
        stat.count,
        pct,
        stat.totalCost,
      ]);
      row.font = { name: "Arial", size: 10 };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(2).numFmt = "#,##0";
      row.getCell(3).alignment = { horizontal: "right" };
      row.getCell(3).numFmt = "0.0%";
      row.getCell(4).alignment = { horizontal: "right" };
      row.getCell(4).numFmt = CURRENCY_FMT;

      row.eachCell((cell) => {
        cell.border = BORDER_THIN;
      });
      s2RowIdx++;
    }

    // Summary row for Sheet 2
    const s2TotalRow = sheet2.addRow([
      "TỔNG CỘNG",
      totalCount,
      1,
      { formula: `SUM(D5:D${s2RowIdx - 1})` },
    ]);
    s2TotalRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF2B3A4A" } };
    s2TotalRow.getCell(1).alignment = { horizontal: "center" };
    s2TotalRow.getCell(2).alignment = { horizontal: "center" };
    s2TotalRow.getCell(2).numFmt = "#,##0";
    s2TotalRow.getCell(3).alignment = { horizontal: "right" };
    s2TotalRow.getCell(3).numFmt = "0.0%";
    s2TotalRow.getCell(4).alignment = { horizontal: "right" };
    s2TotalRow.getCell(4).numFmt = CURRENCY_FMT;
    s2TotalRow.eachCell((cell) => {
      cell.fill = SUMMARY_FILL;
      cell.border = {
        top: { style: "double", color: { argb: "FF2B3A4A" } },
        bottom: { style: "thin", color: { argb: "FF2B3A4A" } },
        left: { style: "thin", color: { argb: "FFD0C8BE" } },
        right: { style: "thin", color: { argb: "FFD0C8BE" } },
      };
    });

    // ─────────────────────────────────────────────────────────────
    // Sheet 3: Danh Mục Mẫu Trang Phục (Garment Catalog Master)
    // ─────────────────────────────────────────────────────────────
    const sheet3 = workbook.addWorksheet("Danh Mục Mẫu Trang Phục", {
      views: [{ state: "frozen", xSplit: 0, ySplit: 4 }],
    });

    sheet3.columns = [
      { key: "stt", width: 6 },
      { key: "name", width: 34 },
      { key: "categoryName", width: 20 },
      { key: "color", width: 16 },
      { key: "material", width: 24 },
      { key: "sizesSummary", width: 16 },
      { key: "priceRange", width: 24 },
      { key: "depositRange", width: 24 },
      { key: "totalAssets", width: 16 },
      { key: "availableAssets", width: 16 },
      { key: "rentedAssets", width: 16 },
      { key: "maintenanceAssets", width: 18 },
      { key: "rentalCount", width: 16 },
    ];

    const catalogs = data.catalogs ?? [];

    const s3Title = sheet3.addRow(["DANH MỤC MẪU TRANG PHỤC & BẢNG GIÁ NIÊM YẾT"]);
    s3Title.font = { name: "Arial", size: 15, bold: true, color: { argb: "FF8B263E" } };
    sheet3.mergeCells("A1:M1");

    const s3Sub = sheet3.addRow([
      `Xuất lúc: ${dateStr} | Người lập: ${data.actorName ?? "Quản lý"} | Tổng số mẫu: ${catalogs.length}`,
    ]);
    s3Sub.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF666666" } };
    sheet3.mergeCells("A2:M2");

    sheet3.addRow([]);

    const s3Header = sheet3.addRow([
      "STT",
      "Tên Mẫu Trang Phục",
      "Phân Loại",
      "Màu Sắc",
      "Chất Liệu",
      "Size Hiện Có",
      "Đơn Giá Thuê/Ngày",
      "Mức Cọc Quy Định",
      "Tổng Hiện Vật",
      "Sẵn Sàng (Kho)",
      "Đang Thuê",
      "Vệ Sinh / Sửa Chữa",
      "Tổng Lượt Thuê",
    ]);
    s3Header.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    s3Header.alignment = { vertical: "middle", horizontal: "center" };
    s3Header.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.border = BORDER_THIN;
    });

    let s3RowIdx = 5;
    for (let i = 0; i < catalogs.length; i++) {
      const cat = catalogs[i];
      const priceRangeStr = formatCurrencyRange(cat.dailyPriceMin, cat.dailyPriceMax);
      const depositRangeStr = formatCurrencyRange(cat.depositAmountMin, cat.depositAmountMax);

      const row = sheet3.addRow([
        i + 1,
        cat.name,
        cat.categoryName ?? "-",
        cat.color ?? "-",
        cat.material ?? "-",
        cat.sizesSummary ?? "-",
        priceRangeStr,
        depositRangeStr,
        cat.totalAssets,
        cat.availableAssets,
        cat.rentedAssets,
        cat.maintenanceAssets,
        cat.rentalCount,
      ]);

      row.font = { name: "Arial", size: 10 };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).font = { name: "Arial", size: 10, bold: true };
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(5).alignment = { horizontal: "center" };
      row.getCell(6).alignment = { horizontal: "center" };
      row.getCell(7).alignment = { horizontal: "right" };
      row.getCell(8).alignment = { horizontal: "right" };
      row.getCell(9).alignment = { horizontal: "center" };
      row.getCell(9).numFmt = "#,##0";
      row.getCell(10).alignment = { horizontal: "center" };
      row.getCell(10).numFmt = "#,##0";
      row.getCell(11).alignment = { horizontal: "center" };
      row.getCell(11).numFmt = "#,##0";
      row.getCell(12).alignment = { horizontal: "center" };
      row.getCell(12).numFmt = "#,##0";
      row.getCell(13).alignment = { horizontal: "center" };
      row.getCell(13).numFmt = "#,##0";

      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFBF8F5" },
          };
        });
      }

      row.eachCell((cell) => {
        cell.border = BORDER_THIN;
      });

      s3RowIdx++;
    }

    const s3StartDataRow = 5;
    const s3LastDataRow = Math.max(s3StartDataRow, s3RowIdx - 1);

    const s3TotalRow = sheet3.addRow([
      "",
      "TỔNG CỘNG",
      `${catalogs.length} mẫu`,
      "",
      "",
      "",
      "",
      "",
      catalogs.length > 0 ? { formula: `SUM(I${s3StartDataRow}:I${s3LastDataRow})` } : 0,
      catalogs.length > 0 ? { formula: `SUM(J${s3StartDataRow}:J${s3LastDataRow})` } : 0,
      catalogs.length > 0 ? { formula: `SUM(K${s3StartDataRow}:K${s3LastDataRow})` } : 0,
      catalogs.length > 0 ? { formula: `SUM(L${s3StartDataRow}:L${s3LastDataRow})` } : 0,
      catalogs.length > 0 ? { formula: `SUM(M${s3StartDataRow}:M${s3LastDataRow})` } : 0,
    ]);
    s3TotalRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF8B263E" } };
    s3TotalRow.getCell(2).alignment = { horizontal: "center" };
    s3TotalRow.getCell(9).alignment = { horizontal: "center" };
    s3TotalRow.getCell(9).numFmt = "#,##0";
    s3TotalRow.getCell(10).alignment = { horizontal: "center" };
    s3TotalRow.getCell(10).numFmt = "#,##0";
    s3TotalRow.getCell(11).alignment = { horizontal: "center" };
    s3TotalRow.getCell(11).numFmt = "#,##0";
    s3TotalRow.getCell(12).alignment = { horizontal: "center" };
    s3TotalRow.getCell(12).numFmt = "#,##0";
    s3TotalRow.getCell(13).alignment = { horizontal: "center" };
    s3TotalRow.getCell(13).numFmt = "#,##0";
    s3TotalRow.eachCell((cell) => {
      cell.fill = SUMMARY_FILL;
      cell.border = {
        top: { style: "double", color: { argb: "FF8B263E" } },
        bottom: { style: "thin", color: { argb: "FF8B263E" } },
        left: { style: "thin", color: { argb: "FFD0C8BE" } },
        right: { style: "thin", color: { argb: "FFD0C8BE" } },
      };
    });

    sheet3.autoFilter = {
      from: "A4",
      to: `M${s3LastDataRow}`,
    };

    const uint8Array = await workbook.xlsx.writeBuffer();
    return Buffer.from(uint8Array);
  }
}

function formatCurrencyRange(min?: number | null, max?: number | null): string {
  const minVal = min ?? 0;
  const maxVal = max ?? 0;
  if (minVal === 0 && maxVal === 0) return "-";
  if (minVal === maxVal || maxVal === 0) {
    return `${minVal.toLocaleString("vi-VN")} đ`;
  }
  if (minVal === 0) {
    return `${maxVal.toLocaleString("vi-VN")} đ`;
  }
  return `${minVal.toLocaleString("vi-VN")} đ - ${maxVal.toLocaleString("vi-VN")} đ`;
}

