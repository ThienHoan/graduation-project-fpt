import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSettings = vi.fn();
const getAdminIntegrations = vi.fn();
const updateAdminSetting = vi.fn();

vi.mock("@/lib/api", () => ({
  getAdminSettings: (...args: unknown[]) => getAdminSettings(...args),
  getAdminIntegrations: (...args: unknown[]) => getAdminIntegrations(...args),
  updateAdminSetting: (...args: unknown[]) => updateAdminSetting(...args),
}));
vi.mock("@/components/location/map-preview", () => ({ MapPreview: () => null }));

import { SystemConfigPanel } from "./system-config-panel";

const settings = [
  { key: "max_rental_days", label: "Số ngày thuê tối đa", description: "d", kind: "number", value: { value: 30 }, updatedAt: null, isDefault: true },
  { key: "store_phone", label: "Số điện thoại cửa hàng", description: "d", kind: "text", value: { value: "0236" }, updatedAt: null, isDefault: true },
];

describe("SystemConfigPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSettings.mockResolvedValue({ success: true, data: settings });
    getAdminIntegrations.mockResolvedValue({
      success: true,
      data: [
        { key: "ai", label: "AI trợ lý & tư vấn", description: "d", configured: true, details: [{ label: "Khóa API", value: "Đã cấu hình" }] },
      ],
    });
    updateAdminSetting.mockResolvedValue({ success: true, data: {} });
  });

  it("renders settings and integration status from the API without any secret fields", async () => {
    const { container } = render(<SystemConfigPanel onSuccess={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByText("Số ngày thuê tối đa")).toBeTruthy();
    expect(screen.getByText("AI trợ lý & tư vấn")).toBeTruthy();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it("saves only the settings that changed, wrapped as { value }", async () => {
    const onSuccess = vi.fn();
    render(<SystemConfigPanel onSuccess={onSuccess} onError={vi.fn()} />);

    const input = (await screen.findAllByRole("spinbutton"))[0];
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu 1 thay đổi/ }));

    await waitFor(() => expect(updateAdminSetting).toHaveBeenCalledTimes(1));
    expect(updateAdminSetting).toHaveBeenCalledWith("max_rental_days", { value: 45 });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});
