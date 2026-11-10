import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { FinancialExportService, type FinancialExportData } from "./financial-export.service";

describe("FinancialExportService", () => {
  const service = new FinancialExportService();

  const mockExportData: FinancialExportData = {
    dateLabel: "Từ 01/11/2026 đến 10/11/2026",
    summary: {
      rentalRevenue: 15500000,
      depositReceived: 8000000,
      depositHeld: 5000000,
      depositHeldCount: 4,
      refundedDeposit: 2500000,
      damageDeduction: 500000,
      forfeitedDeposit: 0,
      totalTransactions: 18,
      totalBookings: 12,
      paidBookings: 10,
      unpaidBookings: 2,
    },
    revenueByDay: [
      { date: "2026-11-01", rentalRevenue: 3500000, depositReceived: 2000000 },
      { date: "2026-11-02", rentalRevenue: 4200000, depositReceived: 1500000 },
      { date: "2026-11-03", rentalRevenue: 7800000, depositReceived: 4500000 },
    ],
    paymentMethods: [
      {
        method: "payos",
        transactionCount: 10,
        rentalRevenue: 10000000,
        depositReceived: 5000000,
        refundedAmount: 1500000,
        netRevenue: 13500000,
      },
      {
        method: "cash",
        transactionCount: 8,
        rentalRevenue: 5500000,
        depositReceived: 3000000,
        refundedAmount: 1000000,
        netRevenue: 7500000,
      },
    ],
    transactions: [
      {
        id: "tx-001",
        bookingId: "3C00B0A6",
        customerName: "Nguyễn Văn A",
        customerPhone: "0901234567",
        type: "RENTAL",
        rawType: "payment",
        amount: 1500000,
        method: "payos",
        status: "completed",
        note: "Thanh toán cọc & thuê",
        createdAt: new Date("2026-11-01T10:30:00Z"),
      },
      {
        id: "tx-002",
        bookingId: "3C00B0A6",
        customerName: "Nguyễn Văn A",
        customerPhone: "0901234567",
        type: "REFUND",
        rawType: "refund_bank_transfer_approved",
        amount: 500000,
        method: "bank_transfer",
        status: "completed",
        note: "Hoàn cọc sau khi trừ hư hại",
        createdAt: new Date("2026-11-03T15:00:00Z"),
        processedBy: "Manager Mai",
      },
    ],
    depositReconciliation: [
      {
        bookingId: "3C00B0A6",
        customerName: "Nguyễn Văn A",
        customerPhone: "0901234567",
        status: "DEDUCTED",
        depositTotal: 1000000,
        damageDeduction: 500000,
        refundedAmount: 500000,
        depositHeld: 0,
        refundMethod: "bank_transfer",
        settledAt: new Date("2026-11-03T15:00:00Z"),
      },
    ],
    reconciliation: {
      rentalRevenue: 15500000,
      depositReceived: 8000000,
      refundedDeposit: 2500000,
      damageDeductions: 500000,
      netCashFlow: 21000000,
      transactionCount: 18,
    },
    actorName: "Quản lý Cổ Phục",
  };

  it("should generate a valid Excel workbook buffer with 4 detailed sheets", async () => {
    const buffer = await service.generateExcelReport(mockExportData);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // Excel .xlsx files are ZIP archives starting with PK (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheet1 = workbook.getWorksheet("Tổng Quan & Kênh TT");
    expect(sheet1).toBeDefined();

    const sheet2 = workbook.getWorksheet("Doanh Thu Theo Ngày");
    expect(sheet2).toBeDefined();

    const sheet3 = workbook.getWorksheet("Nhật Ký Giao Dịch Đối Soát");
    expect(sheet3).toBeDefined();
    expect(sheet3?.rowCount).toBeGreaterThanOrEqual(5);

    const sheet4 = workbook.getWorksheet("Sổ Đối Soát Tiền Cọc");
    expect(sheet4).toBeDefined();
    expect(sheet4?.rowCount).toBeGreaterThanOrEqual(5);
  });

  it("should generate a valid PDF document buffer", async () => {
    const buffer = await service.generatePdfReport(mockExportData);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    // PDF Magic bytes check (%PDF-)
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

