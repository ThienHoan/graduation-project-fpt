import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exportAdminData = vi.fn();
vi.mock("@/lib/api", () => ({ exportAdminData: (...a: unknown[]) => exportAdminData(...a) }));

import { DataExportPanel } from "./data-export-panel";

describe("DataExportPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it("exports the selected dataset for the chosen date range and downloads the file", async () => {
    exportAdminData.mockResolvedValue({
      success: true,
      data: { dataset: "users", filename: "users-2026-11-02.csv", csv: "a,b\r\n", rows: 5, truncated: false, maxRows: 20000 },
    });
    const onSuccess = vi.fn();
    const { container } = render(<DataExportPanel onSuccess={onSuccess} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Tài khoản người dùng/ }));
    const [from, to] = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(from, { target: { value: "2026-10-01" } });
    fireEvent.change(to, { target: { value: "2026-10-31" } });
    fireEvent.click(screen.getByRole("button", { name: /Tải file CSV/ }));

    await waitFor(() => expect(exportAdminData).toHaveBeenCalledWith("users", { from: "2026-10-01", to: "2026-10-31" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.getByText("users-2026-11-02.csv")).toBeTruthy();
  });

  it("warns when the export was truncated", async () => {
    exportAdminData.mockResolvedValue({
      success: true,
      data: { dataset: "bookings", filename: "bookings.csv", csv: "x", rows: 20000, truncated: true, maxRows: 20000 },
    });
    render(<DataExportPanel onSuccess={vi.fn()} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Tải file CSV/ }));

    expect(await screen.findByText(/chỉ xuất phần mới nhất/)).toBeTruthy();
  });

  it("reports API errors without downloading", async () => {
    exportAdminData.mockResolvedValue({ success: false, error: "REQUEST_FAILED", message: "Lỗi máy chủ" });
    const onError = vi.fn();
    render(<DataExportPanel onSuccess={vi.fn()} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: /Tải file CSV/ }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Lỗi máy chủ"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("blocks a reversed date range before calling the API", () => {
    const onError = vi.fn();
    const { container } = render(<DataExportPanel onSuccess={vi.fn()} onError={onError} />);
    const [from, to] = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(from, { target: { value: "2026-11-02" } });
    fireEvent.change(to, { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Tải file CSV/ }));
    expect(exportAdminData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });
});
