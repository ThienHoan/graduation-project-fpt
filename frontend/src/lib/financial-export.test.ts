// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadFinancialReport } from "./api";

describe("downloadFinancialReport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should trigger a download for exported financial file", async () => {
    const mockBlob = new Blob(["fake-content"], { type: "application/pdf" });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({
        "content-disposition": 'attachment; filename="bao-cao-tai-chinh-2026-11-01-2026-11-10.pdf"',
      }),
    });

    const createObjectURLMock = vi.fn().mockReturnValue("blob:http://localhost/test");
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    const result = await downloadFinancialReport({ format: "pdf", preset: "this_month" });

    expect(result.success).toBe(true);
    expect(result.filename).toBe("bao-cao-tai-chinh-2026-11-01-2026-11-10.pdf");
    expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:http://localhost/test");
  });

  it("should handle error response gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: "Không có quyền truy cập." }),
      headers: new Headers(),
    });

    const result = await downloadFinancialReport({ format: "xlsx" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Không có quyền truy cập.");
  });
});
