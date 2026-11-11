import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export interface FinancialExportPaymentMethodItem {
  method: string;
  transactionCount: number;
  rentalRevenue: number;
  depositReceived: number;
  refundedAmount: number;
  netRevenue: number;
}

export interface FinancialExportTransactionItem {
  id: string;
  bookingId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  type: string;
  rawType?: string;
  amount: number;
  method?: string | null;
  status: string;
  note?: string | null;
  createdAt: string | Date;
  processedBy?: string | null;
}

export interface FinancialExportDepositItem {
  bookingId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  status: string;
  depositTotal: number;
  damageDeduction: number;
  refundedAmount: number;
  depositHeld: number;
  refundMethod?: string | null;
  settledAt?: string | Date | null;
}

export interface FinancialExportData {
  dateLabel: string;
  summary: {
    rentalRevenue: number;
    depositReceived: number;
    depositHeld: number;
    depositHeldCount: number;
    refundedDeposit: number;
    damageDeduction: number;
    forfeitedDeposit: number;
    totalTransactions: number;
    totalBookings: number;
    paidBookings: number;
    unpaidBookings: number;
  };
  revenueByDay: Array<{
    date: string;
    rentalRevenue: number;
    depositReceived: number;
  }>;
  paymentMethods?: FinancialExportPaymentMethodItem[];
  transactions?: FinancialExportTransactionItem[];
  depositReconciliation?: FinancialExportDepositItem[];
  reconciliation?: {
    rentalRevenue: number;
    depositReceived: number;
    refundedDeposit: number;
    damageDeduction?: number;
    damageDeductions?: number;
    netCashFlow: number;
    transactionCount: number;
  } | null;
  actorName?: string;
}

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  RENTAL: "Thanh toán tiền thuê",
  DEPOSIT: "Nộp tiền cọc",
  REFUND: "Hoàn trả tiền cọc",
  DAMAGE_DEDUCTION: "Khấu trừ hư hại / bồi thường",
  FORFEITED: "Tịch thu tiền cọc",
  COMPENSATION: "Bồi thường vi phạm",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  payos: "PayOS (Cổng trực tuyến)",
  cash: "Tiền mặt tại quầy",
  bank_transfer: "Chuyển khoản ngân hàng",
  vnpay: "VNPay",
  momo: "Ví MoMo",
  zalopay: "Ví ZaloPay",
  unknown: "Khác / Chưa xác định",
};

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  completed: "Hoàn tất",
  renting: "Đang thuê",
  returned: "Đã trả đồ",
  inspection_pending: "Chờ kiểm tra",
  refund_pending: "Chờ hoàn cọc",
  confirmed: "Đã xác nhận",
  pending_payment: "Chờ thanh toán",
  cancelled: "Đã hủy",
};

const CANDIDATE_UNICODE_FONTS = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

function findAvailableUnicodeFont(): string | null {
  for (const fontPath of CANDIDATE_UNICODE_FONTS) {
    try {
      if (fs.existsSync(fontPath)) {
        return fontPath;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

@Injectable()
export class FinancialExportService {
  /**
   * Sinh báo cáo Excel (.xlsx) chuyên sâu gồm 4 sheet:
   * 1. "Tổng Quan & Kênh TT" - KPI, Cân đối dòng tiền, Phân bổ theo cổng thanh toán
   * 2. "Doanh Thu Theo Ngày" - Doanh thu & cọc theo ngày kèm công thức SUM
   * 3. "Nhật Ký Giao Dịch Đối Soát" - Bảng kê chi tiết 100% giao dịch để khớp sao kê
   * 4. "Sổ Đối Soát Tiền Cọc" - Theo dõi cọc, khấu trừ hư hại & hoàn trả từng đơn
   */
  async generateExcelReport(data: FinancialExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Cổ Phục Việt ERP";
    workbook.created = new Date();

    const CURRENCY_FMT = '#,##0" đ"';
    const ACCOUNTING_FMT = '#,##0" đ";[Red]-#,##0" đ";"-"';
    const HEADER_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8B263E" }, // Brand lotus / burgundy
    };
    const HEADER_NAVY_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2B3A4A" }, // Slate Navy
    };
    const SUBHEADER_FILL: ExcelJS.Fill = {
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
    // Sheet 1: Tổng Quan & Kênh Thanh Toán
    // ─────────────────────────────────────────────────────────────
    const sheet1 = workbook.addWorksheet("Tổng Quan & Kênh TT", {
      views: [{ showGridLines: true }],
    });

    sheet1.columns = [
      { key: "colA", width: 28 },
      { key: "colB", width: 34 },
      { key: "colC", width: 22 },
      { key: "colD", width: 22 },
      { key: "colE", width: 22 },
      { key: "colF", width: 24 },
    ];

    sheet1.mergeCells("A1:F1");
    const titleCell1 = sheet1.getCell("A1");
    titleCell1.value = "CỔ PHỤC VIỆT - BÁO CÁO TỔNG QUAN TÀI CHÍNH & KÊNH THANH TOÁN";
    titleCell1.font = { name: "Arial", size: 15, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell1.fill = HEADER_FILL;
    titleCell1.alignment = { horizontal: "center", vertical: "middle" };
    sheet1.getRow(1).height = 36;

    sheet1.mergeCells("A2:F2");
    const metaCell1 = sheet1.getCell("A2");
    metaCell1.value = `Kỳ báo cáo: ${data.dateLabel}  |  Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}  |  Người xuất: ${data.actorName ?? "Quản lý"}`;
    metaCell1.font = { name: "Arial", size: 10, italic: true };
    metaCell1.alignment = { horizontal: "center", vertical: "middle" };
    sheet1.getRow(2).height = 22;

    // --- BẢNG 1: CHỈ SỐ TÀI CHÍNH TỔNG QUAN (KPIs) ---
    sheet1.mergeCells("A4:D4");
    const sec1Title = sheet1.getCell("A4");
    sec1Title.value = "I. CHỈ SỐ TÀI CHÍNH TỔNG QUAN (EXECUTIVE KPI)";
    sec1Title.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF8B263E" } };

    const summaryHeaders = ["Phân Loại", "Chỉ Số Tài Chính", "Giá Trị", "Ghi Chú"];
    const row5 = sheet1.addRow(summaryHeaders);
    row5.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF2B2625" } };
    row5.fill = SUBHEADER_FILL;
    row5.height = 24;

    const summaryRows = [
      ["DOANH THU", "Doanh thu thuê thực nhận", data.summary.rentalRevenue, "Đơn đã thanh toán / hoàn tất"],
      ["TIỀN CỌC", "Tổng tiền cọc đã nhận", data.summary.depositReceived, "Tiền cọc ghi nhận vào hệ thống"],
      ["TIỀN CỌC", "Tiền cọc đang giữ", data.summary.depositHeld, `${data.summary.depositHeldCount} đơn đang giữ cọc`],
      ["HOÀN TRẢ", "Tiền cọc đã hoàn trả khách", data.summary.refundedDeposit, "Đã hoàn qua tiền mặt/chuyển khoản"],
      ["BỒI THƯỜNG", "Phí trừ cọc hư hại / trễ hạn", data.summary.damageDeduction, "Ghi nhận từ biên bản kiểm tra"],
      ["BỒI THƯỜNG", "Tiền cọc bị tịch thu toàn bộ", data.summary.forfeitedDeposit, "Phạt >= tiền cọc"],
      ["GIAO DỊCH", "Tổng số lượt giao dịch", data.summary.totalTransactions, "Lượt thu tiền thuê / cọc / hoàn cọc"],
      ["ĐƠN THUÊ", "Tổng số đơn phát sinh", data.summary.totalBookings, `Đã TT: ${data.summary.paidBookings} | Chưa TT: ${data.summary.unpaidBookings}`],
    ];

    summaryRows.forEach((r, idx) => {
      const addedRow = sheet1.addRow(r);
      addedRow.height = 20;
      addedRow.font = { name: "Arial", size: 10 };
      const cellValue = addedRow.getCell(3);
      if (typeof r[2] === "number" && idx < 6) {
        cellValue.numFmt = CURRENCY_FMT;
        cellValue.alignment = { horizontal: "right" };
      } else {
        cellValue.alignment = { horizontal: "center" };
      }
      for (let col = 1; col <= 4; col++) {
        addedRow.getCell(col).border = BORDER_THIN;
      }
    });

    // --- BẢNG 2: CÂN ĐỐI DÒNG TIỀN THUẦN (Reconciliation) ---
    sheet1.addRow([]);
    const reconTitleRow = sheet1.addRow(["II. BẢNG CÂN ĐỐI DÒNG TIỀN THUẦN (RECONCILIATION SUMMARY)"]);
    reconTitleRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF8B263E" } };

    const reconHeadRow = sheet1.addRow(["Khoản Mục Dòng Tiền", "Chiều Dòng Tiền", "Số Tiền Hạch Toán", "Ý Nghĩa"]);
    reconHeadRow.font = { name: "Arial", size: 10, bold: true };
    reconHeadRow.fill = SUBHEADER_FILL;
    reconHeadRow.height = 22;

    const recon = data.reconciliation;
    const reconItems = [
      ["(+) Doanh thu tiền thuê", "Thu vào", recon?.rentalRevenue ?? data.summary.rentalRevenue, "Thu nhập thực tế dịch vụ cho thuê"],
      ["(+) Tiền cọc ghi nhận", "Thu vào", recon?.depositReceived ?? data.summary.depositReceived, "Tiền đảm bảo tài sản nhận từ khách"],
      ["(-) Tiền cọc đã hoàn trả", "Chi ra", -(recon?.refundedDeposit ?? data.summary.refundedDeposit), "Đã chuyển trả sau khi trả đồ"],
      ["(-) Phí trừ hư hại/bồi thường", "Khấu trừ", -(recon?.damageDeduction ?? recon?.damageDeductions ?? data.summary.damageDeduction), "Khấu trừ cọc chuyển sang phí bồi thường"],
      ["(=) DÒNG TIỀN THUẦN (NET CASH FLOW)", "Cân đối", recon?.netCashFlow ?? (data.summary.rentalRevenue + data.summary.depositReceived - data.summary.refundedDeposit), "Tổng thực thu trừ thực hoàn"],
    ];

    reconItems.forEach((r, idx) => {
      const row = sheet1.addRow(r);
      row.height = 20;
      const isNet = idx === reconItems.length - 1;
      row.font = { name: "Arial", size: 10, bold: isNet };
      if (isNet) {
        row.fill = SUBHEADER_FILL;
      }
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(3).numFmt = ACCOUNTING_FMT;
      row.getCell(3).alignment = { horizontal: "right" };
      for (let col = 1; col <= 4; col++) {
        row.getCell(col).border = BORDER_THIN;
      }
    });

    // --- BẢNG 3: PHÂN BỔ THEO KÊNH THANH TOÁN ---
    sheet1.addRow([]);
    const methodTitleRow = sheet1.addRow(["III. PHÂN BỔ THEO KÊNH & PHƯƠNG THỨC THANH TOÁN (PAYMENT GATEWAYS)"]);
    methodTitleRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF8B263E" } };

    const methodHeaderRow = sheet1.addRow([
      "Kênh / Cổng Thanh Toán",
      "Lượt Giao Dịch",
      "Doanh Thu Thuê",
      "Tiền Cọc Thu Vào",
      "Tiền Cọc Hoàn Ra",
      "Dòng Tiền Thực Nhận (Net)",
    ]);
    methodHeaderRow.font = { name: "Arial", size: 10, bold: true };
    methodHeaderRow.fill = SUBHEADER_FILL;
    methodHeaderRow.height = 24;

    const methods = data.paymentMethods ?? [];
    const methodStartRow = sheet1.rowCount + 1;

    for (let i = 0; i < methods.length; i++) {
      const m = methods[i];
      const curRowIdx = methodStartRow + i;
      const methodName = PAYMENT_METHOD_LABELS[m.method.toLowerCase()] ?? m.method;
      const row = sheet1.addRow([
        methodName,
        m.transactionCount,
        m.rentalRevenue,
        m.depositReceived,
        m.refundedAmount,
        { formula: `C${curRowIdx}+D${curRowIdx}-E${curRowIdx}` },
      ]);
      row.height = 20;
      row.font = { name: "Arial", size: 10 };
      row.getCell(1).font = { name: "Arial", size: 10, bold: true };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(2).numFmt = "#,##0";
      row.getCell(3).alignment = { horizontal: "right" };
      row.getCell(3).numFmt = CURRENCY_FMT;
      row.getCell(4).alignment = { horizontal: "right" };
      row.getCell(4).numFmt = CURRENCY_FMT;
      row.getCell(5).alignment = { horizontal: "right" };
      row.getCell(5).numFmt = CURRENCY_FMT;
      row.getCell(6).alignment = { horizontal: "right" };
      row.getCell(6).numFmt = CURRENCY_FMT;
      row.getCell(6).font = { name: "Arial", size: 10, bold: true };
      for (let col = 1; col <= 6; col++) {
        row.getCell(col).border = BORDER_THIN;
      }
    }

    const methodEndRow = sheet1.rowCount;
    if (methods.length > 0) {
      const methodTotalRow = sheet1.addRow([
        "TỔNG CỘNG THEO KÊNH",
        { formula: `SUM(B${methodStartRow}:B${methodEndRow})` },
        { formula: `SUM(C${methodStartRow}:C${methodEndRow})` },
        { formula: `SUM(D${methodStartRow}:D${methodEndRow})` },
        { formula: `SUM(E${methodStartRow}:E${methodEndRow})` },
        { formula: `SUM(F${methodStartRow}:F${methodEndRow})` },
      ]);
      methodTotalRow.height = 22;
      methodTotalRow.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF8B263E" } };
      methodTotalRow.fill = SUBHEADER_FILL;
      methodTotalRow.getCell(1).alignment = { horizontal: "center" };
      methodTotalRow.getCell(2).alignment = { horizontal: "center" };
      methodTotalRow.getCell(2).numFmt = "#,##0";
      for (let c = 3; c <= 6; c++) {
        methodTotalRow.getCell(c).alignment = { horizontal: "right" };
        methodTotalRow.getCell(c).numFmt = CURRENCY_FMT;
      }
      for (let col = 1; col <= 6; col++) {
        methodTotalRow.getCell(col).border = BORDER_THIN;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Sheet 2: Doanh Thu Theo Ngày
    // ─────────────────────────────────────────────────────────────
    const sheet2 = workbook.addWorksheet("Doanh Thu Theo Ngày", {
      views: [{ showGridLines: true }],
    });

    sheet2.columns = [
      { key: "index", width: 8 },
      { key: "date", width: 18 },
      { key: "rental", width: 24 },
      { key: "deposit", width: 24 },
      { key: "total", width: 26 },
    ];

    sheet2.mergeCells("A1:E1");
    const titleCell2 = sheet2.getCell("A1");
    titleCell2.value = "DOANH THU & TIỀN CỌC THEO NGÀY";
    titleCell2.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell2.fill = HEADER_FILL;
    titleCell2.alignment = { horizontal: "center", vertical: "middle" };
    sheet2.getRow(1).height = 32;

    const row2Headers = ["STT", "Ngày", "Doanh Thu Thuê", "Tiền Cọc Nhận", "Tổng Thu Phát Sinh"];
    sheet2.addRow(row2Headers);
    const dayHeaderRow = sheet2.getRow(2);
    dayHeaderRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    dayHeaderRow.fill = HEADER_NAVY_FILL;
    dayHeaderRow.alignment = { vertical: "middle", horizontal: "center" };
    dayHeaderRow.height = 24;

    const startRowIdx = 3;
    data.revenueByDay.forEach((d, i) => {
      const rIdx = startRowIdx + i;
      const row = sheet2.addRow([
        i + 1,
        d.date,
        d.rentalRevenue,
        d.depositReceived,
        { formula: `C${rIdx}+D${rIdx}` },
      ]);
      row.height = 20;
      row.font = { name: "Arial", size: 10 };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(3).numFmt = CURRENCY_FMT;
      row.getCell(3).alignment = { horizontal: "right" };
      row.getCell(4).numFmt = CURRENCY_FMT;
      row.getCell(4).alignment = { horizontal: "right" };
      row.getCell(5).numFmt = CURRENCY_FMT;
      row.getCell(5).alignment = { horizontal: "right" };

      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF8F5" } };
        });
      }
      for (let col = 1; col <= 5; col++) {
        row.getCell(col).border = BORDER_THIN;
      }
    });

    // Total row Sheet 2
    const endRowIdx = startRowIdx + data.revenueByDay.length - 1;
    if (data.revenueByDay.length > 0) {
      const totalRow = sheet2.addRow([
        "TỔNG",
        "",
        { formula: `SUM(C${startRowIdx}:C${endRowIdx})` },
        { formula: `SUM(D${startRowIdx}:D${endRowIdx})` },
        { formula: `SUM(E${startRowIdx}:E${endRowIdx})` },
      ]);
      totalRow.height = 24;
      totalRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF8B263E" } };
      totalRow.fill = SUBHEADER_FILL;
      totalRow.getCell(1).alignment = { horizontal: "center" };
      totalRow.getCell(3).numFmt = CURRENCY_FMT;
      totalRow.getCell(4).numFmt = CURRENCY_FMT;
      totalRow.getCell(5).numFmt = CURRENCY_FMT;
      for (let col = 1; col <= 5; col++) {
        totalRow.getCell(col).border = BORDER_THIN;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Sheet 3: Nhật Ký Giao Dịch Đối Soát (Detailed Ledger)
    // ─────────────────────────────────────────────────────────────
    const sheet3 = workbook.addWorksheet("Nhật Ký Giao Dịch Đối Soát", {
      views: [{ state: "frozen", xSplit: 0, ySplit: 4 }],
    });

    sheet3.columns = [
      { key: "stt", width: 6 },
      { key: "id", width: 22 },
      { key: "bookingId", width: 14 },
      { key: "createdAt", width: 18 },
      { key: "customerName", width: 24 },
      { key: "customerPhone", width: 14 },
      { key: "type", width: 26 },
      { key: "amount", width: 20 },
      { key: "method", width: 24 },
      { key: "status", width: 16 },
      { key: "note", width: 34 },
    ];

    const txList = data.transactions ?? [];

    sheet3.mergeCells("A1:K1");
    const titleCell3 = sheet3.getCell("A1");
    titleCell3.value = "NHẬT KÝ GIAO DỊCH ĐỐI SOÁT CHI TIẾT (TRANSACTION LEDGER)";
    titleCell3.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell3.fill = HEADER_FILL;
    titleCell3.alignment = { horizontal: "center", vertical: "middle" };
    sheet3.getRow(1).height = 32;

    sheet3.mergeCells("A2:K2");
    const subCell3 = sheet3.getCell("A2");
    subCell3.value = `Kỳ báo cáo: ${data.dateLabel}  |  Tổng số lượt giao dịch: ${txList.length}  |  Dùng đối chiếu sao kê ngân hàng & cổng PayOS`;
    subCell3.font = { name: "Arial", size: 10, italic: true };
    subCell3.alignment = { horizontal: "center", vertical: "middle" };
    sheet3.getRow(2).height = 20;

    sheet3.addRow([]);

    const s3TableHeader = sheet3.addRow([
      "STT",
      "Mã Giao Dịch",
      "Mã Đơn Thuê",
      "Thời Gian",
      "Khách Hàng",
      "SĐT",
      "Loại Giao Dịch",
      "Số Tiền (đ)",
      "Kênh Thanh Toán",
      "Trạng Thái",
      "Người Xử Lý / Ghi Chú",
    ]);
    s3TableHeader.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    s3TableHeader.alignment = { vertical: "middle", horizontal: "center" };
    s3TableHeader.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.border = BORDER_THIN;
    });
    s3TableHeader.height = 24;

    const s3StartDataRow = 5;
    for (let i = 0; i < txList.length; i++) {
      const tx = txList[i];
      const createdDate = tx.createdAt instanceof Date ? tx.createdAt : new Date(tx.createdAt);
      const timeFormatted = !isNaN(createdDate.getTime())
        ? createdDate.toLocaleString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      const isRefund =
        tx.rawType?.startsWith("refund") ||
        tx.type === "REFUND" ||
        tx.type === "Hoàn tiền cọc";

      const signedAmount = isRefund ? -Math.abs(tx.amount) : Math.abs(tx.amount);
      const typeLabel = TRANSACTION_TYPE_LABELS[tx.type] ?? tx.type;
      const methodLabel = PAYMENT_METHOD_LABELS[(tx.method ?? "").toLowerCase()] ?? tx.method ?? "-";
      const shortBooking = tx.bookingId ? "#" + tx.bookingId.slice(0, 8).toUpperCase() : "-";

      const noteText = [tx.processedBy ? `[Duyệt: ${tx.processedBy}]` : "", tx.note]
        .filter(Boolean)
        .join(" ");

      const row = sheet3.addRow([
        i + 1,
        tx.id,
        shortBooking,
        timeFormatted,
        tx.customerName ?? "-",
        tx.customerPhone ?? "-",
        typeLabel,
        signedAmount,
        methodLabel,
        tx.status === "completed" || tx.status === "refunded" ? "Thành công" : tx.status,
        noteText,
      ]);

      row.height = 20;
      row.font = { name: "Arial", size: 10 };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(2).font = { name: "Arial", size: 9, bold: true };
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(6).alignment = { horizontal: "center" };
      row.getCell(7).alignment = { horizontal: "center" };
      row.getCell(8).alignment = { horizontal: "right" };
      row.getCell(8).numFmt = ACCOUNTING_FMT;
      row.getCell(8).font = { name: "Arial", size: 10, bold: true };
      row.getCell(9).alignment = { horizontal: "center" };
      row.getCell(10).alignment = { horizontal: "center" };

      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF8F5" } };
        });
      }
      for (let col = 1; col <= 11; col++) {
        row.getCell(col).border = BORDER_THIN;
      }
    }

    const s3LastDataRow = Math.max(s3StartDataRow, sheet3.rowCount);
    if (txList.length > 0) {
      const s3TotalRow = sheet3.addRow([
        "",
        "TỔNG CỘNG",
        `${txList.length} giao dịch`,
        "",
        "",
        "",
        "",
        { formula: `SUM(H${s3StartDataRow}:H${s3LastDataRow})` },
        "",
        "",
        "",
      ]);
      s3TotalRow.height = 24;
      s3TotalRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF8B263E" } };
      s3TotalRow.fill = SUBHEADER_FILL;
      s3TotalRow.getCell(2).alignment = { horizontal: "center" };
      s3TotalRow.getCell(8).alignment = { horizontal: "right" };
      s3TotalRow.getCell(8).numFmt = ACCOUNTING_FMT;
      for (let col = 1; col <= 11; col++) {
        s3TotalRow.getCell(col).border = BORDER_THIN;
      }
    }

    sheet3.autoFilter = {
      from: "A4",
      to: `K${s3LastDataRow}`,
    };

    // ─────────────────────────────────────────────────────────────
    // Sheet 4: Sổ Đối Soát Tiền Cọc & Bồi Thường
    // ─────────────────────────────────────────────────────────────
    const sheet4 = workbook.addWorksheet("Sổ Đối Soát Tiền Cọc", {
      views: [{ state: "frozen", xSplit: 0, ySplit: 4 }],
    });

    sheet4.columns = [
      { key: "stt", width: 6 },
      { key: "bookingId", width: 14 },
      { key: "customerName", width: 24 },
      { key: "customerPhone", width: 14 },
      { key: "status", width: 18 },
      { key: "depositTotal", width: 18 },
      { key: "damageDeduction", width: 18 },
      { key: "refundedAmount", width: 18 },
      { key: "depositHeld", width: 18 },
      { key: "refundMethod", width: 22 },
      { key: "settledAt", width: 16 },
    ];

    const depList = data.depositReconciliation ?? [];

    sheet4.mergeCells("A1:K1");
    const titleCell4 = sheet4.getCell("A1");
    titleCell4.value = "SỔ ĐỐI SOÁT TIỀN CỌC & BỒI THƯỜNG HƯ HỎNG THEO ĐƠN THUÊ";
    titleCell4.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell4.fill = HEADER_NAVY_FILL;
    titleCell4.alignment = { horizontal: "center", vertical: "middle" };
    sheet4.getRow(1).height = 32;

    sheet4.mergeCells("A2:K2");
    const subCell4 = sheet4.getCell("A2");
    subCell4.value = `Kỳ báo cáo: ${data.dateLabel}  |  Tổng đơn thuê phát sinh cọc: ${depList.length}`;
    subCell4.font = { name: "Arial", size: 10, italic: true };
    subCell4.alignment = { horizontal: "center", vertical: "middle" };
    sheet4.getRow(2).height = 20;

    sheet4.addRow([]);

    const s4TableHeader = sheet4.addRow([
      "STT",
      "Mã Đơn Thuê",
      "Khách Hàng",
      "SĐT",
      "Trạng Thái Đơn",
      "Tiền Cọc Đã Thu (đ)",
      "Khấu Trừ Hư Hại (đ)",
      "Đã Hoàn Trả (đ)",
      "Cọc Còn Giữ (đ)",
      "Kênh Hoàn Cọc",
      "Ngày Quyết Toán",
    ]);
    s4TableHeader.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    s4TableHeader.alignment = { vertical: "middle", horizontal: "center" };
    s4TableHeader.eachCell((cell) => {
      cell.fill = HEADER_NAVY_FILL;
      cell.border = BORDER_THIN;
    });
    s4TableHeader.height = 24;

    const s4StartDataRow = 5;
    for (let i = 0; i < depList.length; i++) {
      const dep = depList[i];
      const settledDate = dep.settledAt ? (dep.settledAt instanceof Date ? dep.settledAt : new Date(dep.settledAt)) : null;
      const settledFormatted = settledDate && !isNaN(settledDate.getTime())
        ? settledDate.toLocaleDateString("vi-VN")
        : "-";

      const shortBooking = dep.bookingId ? "#" + dep.bookingId.slice(0, 8).toUpperCase() : "-";
      const statusLabel = BOOKING_STATUS_LABELS[dep.status.toLowerCase()] ?? dep.status;
      const refundMethodLabel = dep.refundMethod
        ? PAYMENT_METHOD_LABELS[dep.refundMethod.toLowerCase()] ?? dep.refundMethod
        : "-";

      const row = sheet4.addRow([
        i + 1,
        shortBooking,
        dep.customerName ?? "-",
        dep.customerPhone ?? "-",
        statusLabel,
        dep.depositTotal,
        dep.damageDeduction,
        dep.refundedAmount,
        dep.depositHeld,
        refundMethodLabel,
        settledFormatted,
      ]);

      row.height = 20;
      row.font = { name: "Arial", size: 10 };
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(2).font = { name: "Arial", size: 10, bold: true };
      row.getCell(4).alignment = { horizontal: "center" };
      row.getCell(5).alignment = { horizontal: "center" };
      row.getCell(6).alignment = { horizontal: "right" };
      row.getCell(6).numFmt = CURRENCY_FMT;
      row.getCell(7).alignment = { horizontal: "right" };
      row.getCell(7).numFmt = CURRENCY_FMT;
      row.getCell(8).alignment = { horizontal: "right" };
      row.getCell(8).numFmt = CURRENCY_FMT;
      row.getCell(9).alignment = { horizontal: "right" };
      row.getCell(9).numFmt = CURRENCY_FMT;
      row.getCell(9).font = { name: "Arial", size: 10, bold: true };
      row.getCell(10).alignment = { horizontal: "center" };
      row.getCell(11).alignment = { horizontal: "center" };

      if (i % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF8F5" } };
        });
      }
      for (let col = 1; col <= 11; col++) {
        row.getCell(col).border = BORDER_THIN;
      }
    }

    const s4LastDataRow = Math.max(s4StartDataRow, sheet4.rowCount);
    if (depList.length > 0) {
      const s4TotalRow = sheet4.addRow([
        "",
        "TỔNG CỘNG",
        `${depList.length} đơn cọc`,
        "",
        "",
        { formula: `SUM(F${s4StartDataRow}:F${s4LastDataRow})` },
        { formula: `SUM(G${s4StartDataRow}:G${s4LastDataRow})` },
        { formula: `SUM(H${s4StartDataRow}:H${s4LastDataRow})` },
        { formula: `SUM(I${s4StartDataRow}:I${s4LastDataRow})` },
        "",
        "",
      ]);
      s4TotalRow.height = 24;
      s4TotalRow.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF2B3A4A" } };
      s4TotalRow.fill = SUBHEADER_FILL;
      s4TotalRow.getCell(2).alignment = { horizontal: "center" };
      for (let c = 6; c <= 9; c++) {
        s4TotalRow.getCell(c).alignment = { horizontal: "right" };
        s4TotalRow.getCell(c).numFmt = CURRENCY_FMT;
      }
      for (let col = 1; col <= 11; col++) {
        s4TotalRow.getCell(col).border = BORDER_THIN;
      }
    }

    sheet4.autoFilter = {
      from: "A4",
      to: `K${s4LastDataRow}`,
    };

    const uint8Array = await workbook.xlsx.writeBuffer();
    return Buffer.from(uint8Array);
  }

  /**
   * Sinh file PDF báo cáo tài chính chuẩn in ấn bằng `pdfkit`
   */
  async generatePdfReport(data: FinancialExportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: {
          Title: "Báo Cáo Tài Chính & Đối Soát - Cổ Phục Việt",
          Author: data.actorName ?? "Quản lý Cổ Phục",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const unicodeFontPath = findAvailableUnicodeFont();
      let hasUnicode = false;
      if (unicodeFontPath) {
        try {
          doc.font(unicodeFontPath);
          hasUnicode = true;
        } catch {
          doc.font("Helvetica");
          hasUnicode = false;
        }
      } else {
        doc.font("Helvetica");
        hasUnicode = false;
      }

      const txt = (text: string) => (hasUnicode ? text : removeAccents(text));
      const fmtMoney = (val: number) =>
        new Intl.NumberFormat("vi-VN").format(val) + " đ";

      // ─────────────────────────────────────────────────────────
      // TRANG 1: TỔNG QUAN, CÂN ĐỐI DÒNG TIỀN & KÊNH THANH TOÁN
      // ─────────────────────────────────────────────────────────

      // Header Banner
      doc.rect(40, 40, 515, 60).fill("#8B263E"); // Burgundy brand

      doc
        .fillColor("#FFFFFF")
        .fontSize(14)
        .text(txt("CỔ PHỤC VIỆT - HỆ THỐNG VẬN HÀNH & QUẢN LÝ CHO THUÊ"), 50, 50, {
          width: 495,
          align: "center",
        });

      doc
        .fontSize(16)
        .text(txt("BÁO CÁO DOANH THU & ĐỐI SOÁT TÀI CHÍNH"), 50, 72, {
          width: 495,
          align: "center",
        });

      // Metadata Box
      doc.y = 115;
      doc
        .fillColor("#2B2625")
        .fontSize(10)
        .text(`${txt("Kỳ báo cáo:")} ${data.dateLabel}`, 45, 115)
        .text(`${txt("Ngày in:")} ${new Date().toLocaleDateString("vi-VN")}`, 380, 115)
        .text(`${txt("Người lập biểu:")} ${txt(data.actorName ?? "Quản lý Cổ Phục")}`, 45, 130)
        .text(`${txt("Trạng thái:")} ${txt("Số liệu chốt đối soát")}`, 380, 130);

      doc.moveTo(40, 148).lineTo(555, 148).strokeColor("#D0C8BE").stroke();

      // Section I: KPI Summary
      doc.y = 160;
      doc
        .fillColor("#8B263E")
        .fontSize(11)
        .text(txt("I. TỔNG QUAN CHỈ SỐ TÀI CHÍNH (KEY FINANCIAL METRICS)"), 45, 160);

      const kpis = [
        { label: txt("Doanh thu thuê thực nhận"), val: fmtMoney(data.summary.rentalRevenue) },
        { label: txt("Tổng tiền cọc đã nhận"), val: fmtMoney(data.summary.depositReceived) },
        { label: txt("Tiền cọc đang giữ"), val: `${fmtMoney(data.summary.depositHeld)} (${data.summary.depositHeldCount} ${txt("đơn")})` },
        { label: txt("Tiền cọc đã hoàn trả"), val: fmtMoney(data.summary.refundedDeposit) },
        { label: txt("Khấu trừ hư hại / bồi thường"), val: fmtMoney(data.summary.damageDeduction) },
        {
          label: txt("Dòng tiền thuần (Net Cash Flow)"),
          val: fmtMoney(data.reconciliation?.netCashFlow ?? (data.summary.rentalRevenue + data.summary.depositReceived - data.summary.refundedDeposit)),
        },
      ];

      let kpiY = 178;
      kpis.forEach((kpi, idx) => {
        const isEven = idx % 2 === 0;
        const boxX = isEven ? 45 : 295;
        if (isEven && idx > 0) {
          kpiY += 34;
        }

        doc.rect(boxX, kpiY, 240, 28).fillAndStroke("#FBF9F5", "#E8E2D8");
        doc.fillColor("#666666").fontSize(8).text(kpi.label, boxX + 8, kpiY + 4);
        doc.fillColor("#1A1A1A").fontSize(9.5).text(kpi.val, boxX + 8, kpiY + 14, { width: 224, align: "right" });
      });

      // Section II: Payment Methods Table
      const pmStartY = kpiY + 42;
      doc
        .fillColor("#8B263E")
        .fontSize(11)
        .text(txt("II. PHÂN BỔ THEO KÊNH THANH TOÁN (PAYMENT GATEWAYS)"), 45, pmStartY);

      const pmHeaderY = pmStartY + 18;
      doc.rect(45, pmHeaderY, 505, 18).fill("#EFEAE2");
      doc
        .fillColor("#2B2625")
        .fontSize(8.5)
        .text(txt("Kênh / Cổng"), 50, pmHeaderY + 4, { width: 140 })
        .text(txt("Lượt GD"), 190, pmHeaderY + 4, { width: 50, align: "center" })
        .text(txt("Doanh Thu"), 240, pmHeaderY + 4, { width: 95, align: "right" })
        .text(txt("Cọc Thu Vào"), 340, pmHeaderY + 4, { width: 95, align: "right" })
        .text(txt("Thực Nhận (Net)"), 440, pmHeaderY + 4, { width: 100, align: "right" });

      let pmRowY = pmHeaderY + 18;
      const methods = data.paymentMethods ?? [];
      methods.slice(0, 6).forEach((m, idx) => {
        const mName = PAYMENT_METHOD_LABELS[m.method.toLowerCase()] ?? m.method;
        if (idx % 2 === 1) {
          doc.rect(45, pmRowY, 505, 16).fill("#FDFBF7");
        }
        doc
          .fillColor("#333333")
          .fontSize(8.5)
          .text(txt(mName), 50, pmRowY + 3, { width: 140 })
          .text(String(m.transactionCount), 190, pmRowY + 3, { width: 50, align: "center" })
          .text(fmtMoney(m.rentalRevenue), 240, pmRowY + 3, { width: 95, align: "right" })
          .text(fmtMoney(m.depositReceived), 340, pmRowY + 3, { width: 95, align: "right" })
          .text(fmtMoney(m.netRevenue), 440, pmRowY + 3, { width: 100, align: "right" });
        pmRowY += 16;
      });

      // Section III: Reconciliation Balance Table
      const recStartY = pmRowY + 16;
      doc
        .fillColor("#8B263E")
        .fontSize(11)
        .text(txt("III. BẢNG CÂN ĐỐI DÒNG TIỀN THUẦN (RECONCILIATION SUMMARY)"), 45, recStartY);

      const recHeaderY = recStartY + 18;
      doc.rect(45, recHeaderY, 505, 18).fill("#EFEAE2");
      doc
        .fillColor("#2B2625")
        .fontSize(8.5)
        .text(txt("Khoản Mục Dòng Tiền"), 50, recHeaderY + 4, { width: 220 })
        .text(txt("Chiều Hạch Toán"), 270, recHeaderY + 4, { width: 100, align: "center" })
        .text(txt("Số Tiền"), 380, recHeaderY + 4, { width: 160, align: "right" });

      let recRowY = recHeaderY + 18;
      const reconList = [
        { label: "(+) Doanh thu tiền thuê", dir: "Thu vào", val: data.reconciliation?.rentalRevenue ?? data.summary.rentalRevenue },
        { label: "(+) Tiền cọc ghi nhận", dir: "Thu vào", val: data.reconciliation?.depositReceived ?? data.summary.depositReceived },
        { label: "(-) Tiền cọc đã hoàn trả", dir: "Chi ra", val: -(data.reconciliation?.refundedDeposit ?? data.summary.refundedDeposit) },
        { label: "(-) Phí trừ hư hại / bồi thường", dir: "Khấu trừ", val: -(data.reconciliation?.damageDeduction ?? data.summary.damageDeduction) },
        { label: "(=) DÒNG TIỀN THUẦN (NET CASH FLOW)", dir: "Cân đối", val: data.reconciliation?.netCashFlow ?? (data.summary.rentalRevenue + data.summary.depositReceived - data.summary.refundedDeposit), bold: true },
      ];

      reconList.forEach((r, idx) => {
        if (r.bold) {
          doc.rect(45, recRowY, 505, 18).fill("#EFEAE2");
        } else if (idx % 2 === 1) {
          doc.rect(45, recRowY, 505, 16).fill("#FDFBF7");
        }
        doc
          .fillColor(r.bold ? "#8B263E" : "#333333")
          .fontSize(8.5)
          .text(txt(r.label), 50, recRowY + 3, { width: 220 })
          .text(txt(r.dir), 270, recRowY + 3, { width: 100, align: "center" })
          .text(fmtMoney(r.val), 380, recRowY + 3, { width: 160, align: "right" });
        recRowY += r.bold ? 18 : 16;
      });

      // Footer note on Page 1
      doc
        .fillColor("#888888")
        .fontSize(8)
        .text(txt("Trang 1/2 — Bảng tổng quan chỉ số tài chính & cân đối dòng tiền"), 45, 780, { width: 505, align: "center" });

      // ─────────────────────────────────────────────────────────
      // TRANG 2: NHẬT KÝ GIAO DỊCH TIÊU BIỂU & CHỮ KÝ XÁC NHẬN
      // ─────────────────────────────────────────────────────────
      doc.addPage();

      // Mini Header
      doc.rect(40, 40, 515, 36).fill("#2B3A4A"); // Slate Navy
      doc
        .fillColor("#FFFFFF")
        .fontSize(12)
        .text(txt("CỔ PHỤC VIỆT - NHẬT KÝ GIAO DỊCH ĐỐI SOÁT & QUYẾT TOÁN CỌC"), 50, 50, {
          width: 495,
          align: "center",
        });

      // Section IV: Top Transactions
      const txStartY = 95;
      doc
        .fillColor("#8B263E")
        .fontSize(11)
        .text(txt("IV. NHẬT KÝ GIAO DỊCH ĐỐI SOÁT CHÍNH (TOP TRANSACTIONS)"), 45, txStartY);

      const txHeadY = txStartY + 18;
      doc.rect(45, txHeadY, 505, 18).fill("#EFEAE2");
      doc
        .fillColor("#2B2625")
        .fontSize(8)
        .text(txt("Mã GD"), 48, txHeadY + 4, { width: 105 })
        .text(txt("Đơn"), 155, txHeadY + 4, { width: 55, align: "center" })
        .text(txt("Khách Hàng"), 212, txHeadY + 4, { width: 100 })
        .text(txt("Loại GD"), 315, txHeadY + 4, { width: 85, align: "center" })
        .text(txt("Số Tiền"), 402, txHeadY + 4, { width: 75, align: "right" })
        .text(txt("Kênh"), 480, txHeadY + 4, { width: 68, align: "center" });

      let txRowY = txHeadY + 18;
      const txs = (data.transactions ?? []).slice(0, 16);
      txs.forEach((tx, idx) => {
        if (idx % 2 === 1) {
          doc.rect(45, txRowY, 505, 15).fill("#FDFBF7");
        }
        const isRef = tx.rawType?.startsWith("refund") || tx.type === "REFUND";
        const signedAmt = isRef ? -Math.abs(tx.amount) : Math.abs(tx.amount);
        const shortBook = tx.bookingId ? "#" + tx.bookingId.slice(0, 8).toUpperCase() : "-";
        const shortTx = tx.id.length > 18 ? tx.id.slice(0, 18) + "..." : tx.id;
        const typeLbl = TRANSACTION_TYPE_LABELS[tx.type] ?? tx.type;
        const methodLbl = PAYMENT_METHOD_LABELS[(tx.method ?? "").toLowerCase()] ?? tx.method ?? "-";

        doc
          .fillColor("#333333")
          .fontSize(7.5)
          .text(shortTx, 48, txRowY + 3, { width: 105 })
          .text(shortBook, 155, txRowY + 3, { width: 55, align: "center" })
          .text(txt(tx.customerName ?? "-"), 212, txRowY + 3, { width: 100 })
          .text(txt(typeLbl), 315, txRowY + 3, { width: 85, align: "center" })
          .text(fmtMoney(signedAmt), 402, txRowY + 3, { width: 75, align: "right" })
          .text(txt(methodLbl), 480, txRowY + 3, { width: 68, align: "center" });

        txRowY += 15;
      });

      // Section V: Daily Revenue Summary
      const dailyStartY = txRowY + 18;
      doc
        .fillColor("#8B263E")
        .fontSize(11)
        .text(txt("V. BẢNG TỔNG HỢP DOANH THU THEO NGÀY"), 45, dailyStartY);

      const dHeadY = dailyStartY + 18;
      doc.rect(45, dHeadY, 505, 18).fill("#EFEAE2");
      doc
        .fillColor("#2B2625")
        .fontSize(8)
        .text(txt("STT"), 50, dHeadY + 4, { width: 30, align: "center" })
        .text(txt("Ngày"), 85, dHeadY + 4, { width: 90, align: "center" })
        .text(txt("Doanh Thu Thuê"), 180, dHeadY + 4, { width: 110, align: "right" })
        .text(txt("Tiền Cọc Nhận"), 300, dHeadY + 4, { width: 110, align: "right" })
        .text(txt("Tổng Thu Phát Sinh"), 420, dHeadY + 4, { width: 120, align: "right" });

      let dRowY = dHeadY + 18;
      const days = data.revenueByDay.slice(0, 6);
      days.forEach((d, i) => {
        if (i % 2 === 1) {
          doc.rect(45, dRowY, 505, 15).fill("#FDFBF7");
        }
        doc
          .fillColor("#333333")
          .fontSize(8)
          .text(String(i + 1), 50, dRowY + 3, { width: 30, align: "center" })
          .text(d.date, 85, dRowY + 3, { width: 90, align: "center" })
          .text(fmtMoney(d.rentalRevenue), 180, dRowY + 3, { width: 110, align: "right" })
          .text(fmtMoney(d.depositReceived), 300, dRowY + 3, { width: 110, align: "right" })
          .text(fmtMoney(d.rentalRevenue + d.depositReceived), 420, dRowY + 3, { width: 120, align: "right" });
        dRowY += 15;
      });

      // Signatures
      const sigY = Math.max(dRowY + 30, 690);
      doc
        .fillColor("#2B2625")
        .fontSize(9.5)
        .text(txt("NGƯỜI LẬP BIỂU"), 70, sigY, { width: 160, align: "center" })
        .text(txt("KẾ TOÁN TRƯỞNG / CHỦ CỬA HÀNG"), 340, sigY, { width: 180, align: "center" });

      doc
        .fillColor("#888888")
        .fontSize(8)
        .text(txt("(Ký và ghi rõ họ tên)"), 70, sigY + 14, { width: 160, align: "center" })
        .text(txt("(Ký và đóng dấu xác nhận)"), 340, sigY + 14, { width: 180, align: "center" });

      doc
        .fillColor("#888888")
        .fontSize(8)
        .text(txt("Trang 2/2 — Chứng từ nội bộ lưu trữ kế toán & quyết toán thuế"), 45, 780, { width: 505, align: "center" });

      doc.end();
    });
  }
}
