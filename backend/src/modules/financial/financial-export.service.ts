import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

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
   * Sinh báo cáo Excel (.xlsx) gồm 3 sheet:
   * 1. Tổng quan KPI
   * 2. Doanh thu theo ngày (kèm công thức SUM)
   * 3. Đối soát & dòng tiền
   */
  async generateExcelReport(data: FinancialExportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Co Phuc Viet ERP";
    workbook.created = new Date();

    const CURRENCY_FMT = '#,##0" đ"';
    const HEADER_FILL: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8B263E" }, // Brand lotus / burgundy
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
    // Sheet 1: Tổng quan KPI
    // ─────────────────────────────────────────────────────────────
    const sheet1 = workbook.addWorksheet("Tổng Quan Tài Chính", {
      views: [{ showGridLines: true }],
    });

    sheet1.columns = [
      { key: "category", width: 32 },
      { key: "metric", width: 38 },
      { key: "value", width: 24 },
      { key: "note", width: 30 },
    ];

    sheet1.mergeCells("A1:D1");
    const titleCell1 = sheet1.getCell("A1");
    titleCell1.value = "CỔ PHỤC VIỆT - BÁO CÁO TỔNG QUAN TÀI CHÍNH";
    titleCell1.font = { name: "Arial", size: 15, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell1.fill = HEADER_FILL;
    titleCell1.alignment = { horizontal: "center", vertical: "middle" };
    sheet1.getRow(1).height = 36;

    sheet1.mergeCells("A2:D2");
    const metaCell1 = sheet1.getCell("A2");
    metaCell1.value = `Kỳ báo cáo: ${data.dateLabel}  |  Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}  |  Người xuất: ${data.actorName ?? "Quản lý"}`;
    metaCell1.font = { name: "Arial", size: 10, italic: true };
    metaCell1.alignment = { horizontal: "center", vertical: "middle" };
    sheet1.getRow(2).height = 22;

    const summaryHeaders = ["Phân Loại", "Chỉ Số Tài Chính", "Giá Trị", "Ghi Chú"];
    sheet1.addRow(summaryHeaders);
    const row3 = sheet1.getRow(3);
    row3.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF2B2625" } };
    row3.fill = SUBHEADER_FILL;
    row3.height = 24;

    const summaryRows = [
      ["DOANH THU", "Doanh thu thuê thực nhận", data.summary.rentalRevenue, "Đơn đã thanh toán/hoàn tất"],
      ["TIỀN CỌC", "Tổng tiền cọc đã nhận", data.summary.depositReceived, "Tiền cọc ghi nhận vào hệ thống"],
      ["TIỀN CỌC", "Tiền cọc đang giữ", data.summary.depositHeld, `${data.summary.depositHeldCount} đơn đang cọc`],
      ["HOÀN TRẢ", "Tiền cọc đã hoàn trả khách", data.summary.refundedDeposit, "Đã duyệt hoàn qua tiền mặt/chuyển khoản"],
      ["BỒI THƯỜNG", "Phí trừ cọc hư hại / trễ hạn", data.summary.damageDeduction, "Ghi nhận từ biên bản kiểm tra"],
      ["BỒI THƯỜNG", "Tiền cọc bị tịch thu toàn bộ", data.summary.forfeitedDeposit, "Phạt >= tiền cọc"],
      ["GIAO DỊCH", "Tổng số lượt giao dịch", data.summary.totalTransactions, "Lượt thanh toán/hoàn tiền"],
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

    // ─────────────────────────────────────────────────────────────
    // Sheet 2: Doanh thu theo ngày
    // ─────────────────────────────────────────────────────────────
    const sheet2 = workbook.addWorksheet("Doanh Thu Theo Ngày", {
      views: [{ showGridLines: true }],
    });

    sheet2.columns = [
      { key: "index", width: 10 },
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
    dayHeaderRow.font = { name: "Arial", size: 11, bold: true };
    dayHeaderRow.fill = SUBHEADER_FILL;
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
      row.getCell(4).numFmt = CURRENCY_FMT;
      row.getCell(5).numFmt = CURRENCY_FMT;
      for (let col = 1; col <= 5; col++) {
        row.getCell(col).border = BORDER_THIN;
      }
    });

    // Total row
    const endRowIdx = startRowIdx + data.revenueByDay.length - 1;
    const totalRowIdx = endRowIdx + 1;
    if (data.revenueByDay.length > 0) {
      const totalRow = sheet2.addRow([
        "TỔNG",
        "",
        { formula: `SUM(C${startRowIdx}:C${endRowIdx})` },
        { formula: `SUM(D${startRowIdx}:D${endRowIdx})` },
        { formula: `SUM(E${startRowIdx}:E${endRowIdx})` },
      ]);
      totalRow.height = 24;
      totalRow.font = { name: "Arial", size: 11, bold: true };
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
    // Sheet 3: Đối soát dòng tiền
    // ─────────────────────────────────────────────────────────────
    const sheet3 = workbook.addWorksheet("Đối Soát Dòng Tiền", {
      views: [{ showGridLines: true }],
    });

    sheet3.columns = [
      { key: "item", width: 36 },
      { key: "direction", width: 18 },
      { key: "amount", width: 24 },
      { key: "desc", width: 35 },
    ];

    sheet3.mergeCells("A1:D1");
    const titleCell3 = sheet3.getCell("A1");
    titleCell3.value = "BẢNG ĐỐI SOÁT DÒNG TIỀN (RECONCILIATION)";
    titleCell3.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell3.fill = HEADER_FILL;
    titleCell3.alignment = { horizontal: "center", vertical: "middle" };
    sheet3.getRow(1).height = 32;

    sheet3.addRow(["Khoản Mục Dòng Tiền", "Chiều Dòng Tiền", "Số Tiền", "Ý Nghĩa Hạch Toán"]);
    const reconHeadRow = sheet3.getRow(2);
    reconHeadRow.font = { name: "Arial", size: 11, bold: true };
    reconHeadRow.fill = SUBHEADER_FILL;
    reconHeadRow.height = 24;

    const recon = data.reconciliation;
    const reconItems = [
      ["(+) Doanh thu tiền thuê", "Thu vào", recon?.rentalRevenue ?? data.summary.rentalRevenue, "Thu nhập thực tế dịch vụ cho thuê"],
      ["(+) Tiền cọc ghi nhận", "Thu vào", recon?.depositReceived ?? data.summary.depositReceived, "Tiền đảm bảo tài sản nhận từ khách"],
      ["(-) Tiền cọc đã hoàn trả", "Chi ra", -(recon?.refundedDeposit ?? data.summary.refundedDeposit), "Đã chuyển trả sau khi trả đồ"],
      ["(-) Phí trừ hư hại/bồi thường", "Khấu trừ", -(recon?.damageDeduction ?? recon?.damageDeductions ?? data.summary.damageDeduction), "Khấu trừ cọc chuyển sang phí bồi thường"],
      ["(=) DÒNG TIỀN THUẦN (NET CASH FLOW)", "Cân đối", recon?.netCashFlow ?? (data.summary.rentalRevenue + data.summary.depositReceived - data.summary.refundedDeposit), "Tổng thực thu trừ thực hoàn"],
    ];

    reconItems.forEach((r, idx) => {
      const row = sheet3.addRow(r);
      row.height = 22;
      const isNet = idx === reconItems.length - 1;
      row.font = { name: "Arial", size: 10, bold: isNet };
      if (isNet) {
        row.fill = SUBHEADER_FILL;
      }
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(3).numFmt = CURRENCY_FMT;
      row.getCell(3).alignment = { horizontal: "right" };
      for (let col = 1; col <= 4; col++) {
        row.getCell(col).border = BORDER_THIN;
      }
    });

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
          Title: "Báo Cáo Tài Chính - Cổ Phục Việt",
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

      // ── Header Banner ──
      doc
        .rect(40, 40, 515, 60)
        .fill("#8B263E"); // Burgundy brand

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

      // ── Metadata Box ──
      doc.y = 115;
      doc
        .fillColor("#2B2625")
        .fontSize(10)
        .text(`${txt("Kỳ báo cáo:")} ${data.dateLabel}`, 45, 115)
        .text(`${txt("Ngày in:")} ${new Date().toLocaleDateString("vi-VN")}`, 380, 115)
        .text(`${txt("Người lập biểu:")} ${txt(data.actorName ?? "Quản lý Cổ Phục")}`, 45, 130)
        .text(`${txt("Trạng thái:")} ${txt("Số liệu chốt đối soát")}`, 380, 130);

      // Line separator
      doc.moveTo(40, 148).lineTo(555, 148).strokeColor("#D0C8BE").stroke();

      // ── Section I: KPI Summary ──
      doc.y = 160;
      doc
        .fillColor("#8B263E")
        .fontSize(12)
        .text(txt("I. TỔNG QUAN CHỈ SỐ TÀI CHÍNH (KPI SUMMARY)"), 45, 160);

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

      let kpiY = 182;
      kpis.forEach((kpi, idx) => {
        const isEven = idx % 2 === 0;
        const boxX = isEven ? 45 : 295;
        if (!isEven) {
          // same line
        } else if (idx > 0) {
          kpiY += 36;
        }

        doc
          .rect(boxX, kpiY, 240, 30)
          .fillAndStroke("#FBF9F5", "#E8E2D8");

        doc
          .fillColor("#666666")
          .fontSize(8)
          .text(kpi.label, boxX + 8, kpiY + 5);

        doc
          .fillColor("#1A1A1A")
          .fontSize(10)
          .text(kpi.val, boxX + 8, kpiY + 16, { width: 224, align: "right" });
      });

      // ── Section II: Daily Revenue Table ──
      const tableStartY = kpiY + 48;
      doc
        .fillColor("#8B263E")
        .fontSize(12)
        .text(txt("II. CHI TIẾT DOANH THU & TIỀN CỌC THEO NGÀY"), 45, tableStartY);

      const thY = tableStartY + 20;
      doc.rect(45, thY, 505, 20).fill("#EFEAE2");

      doc
        .fillColor("#2B2625")
        .fontSize(9)
        .text(txt("STT"), 50, thY + 5, { width: 30, align: "center" })
        .text(txt("Ngày"), 85, thY + 5, { width: 90, align: "center" })
        .text(txt("Doanh Thu Thuê"), 180, thY + 5, { width: 110, align: "right" })
        .text(txt("Tiền Cọc Nhận"), 300, thY + 5, { width: 110, align: "right" })
        .text(txt("Tổng Phát Sinh"), 420, thY + 5, { width: 120, align: "right" });

      let rowY = thY + 20;
      let totalRental = 0;
      let totalDeposit = 0;

      const rowsToRender = data.revenueByDay.slice(0, 15); // render max 15 days on page 1
      rowsToRender.forEach((d, i) => {
        const dayTotal = d.rentalRevenue + d.depositReceived;
        totalRental += d.rentalRevenue;
        totalDeposit += d.depositReceived;

        if (i % 2 === 1) {
          doc.rect(45, rowY, 505, 18).fill("#FDFBF7");
        }

        doc
          .fillColor("#333333")
          .fontSize(9)
          .text(String(i + 1), 50, rowY + 4, { width: 30, align: "center" })
          .text(d.date, 85, rowY + 4, { width: 90, align: "center" })
          .text(fmtMoney(d.rentalRevenue), 180, rowY + 4, { width: 110, align: "right" })
          .text(fmtMoney(d.depositReceived), 300, rowY + 4, { width: 110, align: "right" })
          .text(fmtMoney(dayTotal), 420, rowY + 4, { width: 120, align: "right" });

        rowY += 18;
      });

      // Total summary line in table
      doc.rect(45, rowY, 505, 20).fill("#EFEAE2");
      doc
        .fillColor("#1A1A1A")
        .fontSize(9)
        .text(txt("TỔNG CỘNG"), 50, rowY + 5, { width: 125, align: "center" })
        .text(fmtMoney(totalRental), 180, rowY + 5, { width: 110, align: "right" })
        .text(fmtMoney(totalDeposit), 300, rowY + 5, { width: 110, align: "right" })
        .text(fmtMoney(totalRental + totalDeposit), 420, rowY + 5, { width: 120, align: "right" });

      // ── Signatures ──
      const sigY = Math.max(rowY + 40, 680);
      doc
        .fillColor("#2B2625")
        .fontSize(10)
        .text(txt("NGƯỜI LẬP BIỂU"), 70, sigY, { width: 160, align: "center" })
        .text(txt("KẾ TOÁN TRƯỞNG / CHỦ CỬA HÀNG"), 340, sigY, { width: 180, align: "center" });

      doc
        .fillColor("#888888")
        .fontSize(8)
        .text(txt("(Ký và ghi rõ họ tên)"), 70, sigY + 14, { width: 160, align: "center" })
        .text(txt("(Ký và đóng dấu xác nhận)"), 340, sigY + 14, { width: 180, align: "center" });

      doc.end();
    });
  }
}
