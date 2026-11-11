// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadInspectionSlip, downloadAssetsInventoryReport } from "./api";

describe("Operational Export API Helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("downloadInspectionSlip", () => {
    it("should trigger download for inspection slip PDF", async () => {
      const mockBlob = new Blob(["%PDF-mock"], { type: "application/pdf" });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({
          "content-disposition": 'attachment; filename="bien-ban-kiem-tra-insp1234.pdf"',
        }),
      });

      const createObjectURLMock = vi.fn().mockReturnValue("blob:http://localhost/test-slip");
      const revokeObjectURLMock = vi.fn();
      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      const result = await downloadInspectionSlip("insp1234");

      expect(result.success).toBe(true);
      expect(result.filename).toBe("bien-ban-kiem-tra-insp1234.pdf");
      expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:http://localhost/test-slip");
    });

    it("should handle server error response gracefully", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: "Không tìm thấy phiên kiểm tra" }),
      });

      const result = await downloadInspectionSlip("invalid-id");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Không tìm thấy phiên kiểm tra");
    });
  });

  describe("downloadAssetsInventoryReport", () => {
    it("should trigger download for inventory Excel report", async () => {
      const mockBlob = new Blob(["PK-mock-excel"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({
          "content-disposition": 'attachment; filename="Kiem_Ke_Kho_Hien_Vat_2026-11-10.xlsx"',
        }),
      });

      const createObjectURLMock = vi.fn().mockReturnValue("blob:http://localhost/test-excel");
      const revokeObjectURLMock = vi.fn();
      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      const result = await downloadAssetsInventoryReport();

      expect(result.success).toBe(true);
      expect(result.filename).toBe("Kiem_Ke_Kho_Hien_Vat_2026-11-10.xlsx");
      expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:http://localhost/test-excel");
    });

    it("should handle error when exporting inventory", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ message: "Bạn không có quyền truy cập báo cáo kiểm kê." }),
      });

      const result = await downloadAssetsInventoryReport();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Bạn không có quyền truy cập báo cáo kiểm kê.");
    });
  });
});

