// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadHandoverSlip } from "./api";

describe("downloadHandoverSlip", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should trigger download for booking handover slip PDF", async () => {
    const mockBlob = new Blob(["%PDF-mock"], { type: "application/pdf" });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
      headers: new Headers({
        "content-disposition": 'attachment; filename="phieu-ban-giao-abc12345.pdf"',
      }),
    });

    const createObjectURLMock = vi.fn().mockReturnValue("blob:http://localhost/test-slip");
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    const result = await downloadHandoverSlip("abc12345");

    expect(result.success).toBe(true);
    expect(result.filename).toBe("phieu-ban-giao-abc12345.pdf");
    expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:http://localhost/test-slip");
  });
});

