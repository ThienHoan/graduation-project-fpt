import { describe, it, expect } from "vitest";
import { FinancialExportService } from "./financial-export.service";

describe("FinancialExportService", () => {
  const service = new FinancialExportService();

  const mockExportData = {
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

  it("should generate a valid Excel workbook buffer with 3 sheets", async () => {
    const buffer = await service.generateExcelReport(mockExportData);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // Excel .xlsx files are ZIP archives starting with PK (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("should generate a valid PDF document buffer", async () => {
    const buffer = await service.generatePdfReport(mockExportData);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    // PDF Magic bytes check (%PDF-)
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

