import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
}));

import { useAuth } from "@/components/auth/auth-provider";
import { apiRequest } from "@/lib/api";
import CustomerMeasurementsPage from "./page";

const mockedUseAuth = vi.mocked(useAuth);

describe("CustomerMeasurementsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      status: "authenticated",
      session: {
        accessToken: "jwt-token",
        user: {
          id: "user-1",
          email: "customer@example.com",
          role: "customer",
          isActive: true,
          fullName: "Nguyen Van A",
          phone: null,
        },
      },
      user: {
        id: "user-1",
        email: "customer@example.com",
        role: "customer",
        isActive: true,
        fullName: "Nguyen Van A",
        phone: null,
      },
      signIn: vi.fn(),
      signOut: vi.fn(),
      replaceUser: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  it("loads and saves the latest customer measurements", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "measurement-1",
          heightCm: 165.5,
          weightKg: 50,
          bustCm: 84,
          waistCm: 64,
          hipCm: 90,
          usualSize: "M",
          createdAt: "2026-06-12T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "measurement-1",
          heightCm: 165.5,
          weightKg: 50,
          bustCm: 84,
          waistCm: 64,
          hipCm: 90,
          usualSize: "L",
          createdAt: "2026-06-13T00:00:00.000Z",
        },
      });
    const user = userEvent.setup();

    render(<CustomerMeasurementsPage />);

    await waitFor(() => expect(screen.getByLabelText("Size thường mặc (không bắt buộc)")).toHaveValue("M"));
    await user.selectOptions(screen.getByLabelText("Size thường mặc (không bắt buộc)"), "L");
    await user.click(screen.getByRole("button", { name: /Cập nhật số đo/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenNthCalledWith(2, "/users/me/measurements", {
      method: "PATCH",
      body: JSON.stringify({
        heightCm: 165.5,
        weightKg: 50,
        bustCm: 84,
        waistCm: 64,
        hipCm: 90,
        usualSize: "L",
      }),
    }));
    expect(screen.getByText(/Cập nhật số đo thành công/i)).toBeInTheDocument();
  });

  it("warns but still saves when waist exceeds bust and hips", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "measurement-1",
          heightCm: 160,
          weightKg: 50,
          bustCm: 84,
          waistCm: 64,
          hipCm: 90,
          usualSize: null,
          createdAt: "2026-06-12T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "measurement-1",
          heightCm: 160,
          weightKg: 50,
          bustCm: 84,
          waistCm: 95,
          hipCm: 90,
          usualSize: null,
          createdAt: "2026-06-13T00:00:00.000Z",
        },
      });
    const user = userEvent.setup();

    render(<CustomerMeasurementsPage />);

    await waitFor(() => expect(screen.getByLabelText("Vòng eo (cm)")).toHaveValue(64));
    await user.clear(screen.getByLabelText("Vòng eo (cm)"));
    await user.type(screen.getByLabelText("Vòng eo (cm)"), "95");

    await waitFor(() => expect(
      screen.getByText(/số đo vòng ngực, vòng eo và vòng hông có vẻ chưa chính xác/i),
    ).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /cập nhật số đo/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenNthCalledWith(2, "/users/me/measurements", {
      method: "PATCH",
      body: JSON.stringify({
        heightCm: 160,
        weightKg: 50,
        bustCm: 84,
        waistCm: 95,
        hipCm: 90,
      }),
    }));
    expect(screen.getByText(/Cập nhật số đo thành công/i)).toBeInTheDocument();
  });

  it("blocks submit when a measurement reaches the storage limit", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      success: true,
      data: {
        id: "measurement-1",
        heightCm: 160,
        weightKg: 50,
        bustCm: 84,
        waistCm: 64,
        hipCm: 90,
        usualSize: null,
        createdAt: "2026-06-12T00:00:00.000Z",
      },
    });
    const user = userEvent.setup();

    render(<CustomerMeasurementsPage />);

    await waitFor(() => expect(screen.getByLabelText("Vòng ngực (cm)")).toHaveValue(84));
    await user.clear(screen.getByLabelText("Vòng ngực (cm)"));
    await user.type(screen.getByLabelText("Vòng ngực (cm)"), "1500");
    await user.click(screen.getByRole("button", { name: /cập nhật số đo/i }));

    await waitFor(() => expect(
      screen.getByText(/Vòng ngực.*vượt quá giới hạn cho phép.*999,99/i),
    ).toBeInTheDocument());
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("sends null to clear the saved size when 'unknown' is chosen", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "measurement-1",
          heightCm: 165,
          weightKg: null,
          bustCm: null,
          waistCm: null,
          hipCm: null,
          usualSize: "M",
          createdAt: "2026-06-12T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "measurement-1",
          heightCm: 165,
          weightKg: null,
          bustCm: null,
          waistCm: null,
          hipCm: null,
          usualSize: null,
          createdAt: "2026-06-13T00:00:00.000Z",
        },
      });
    const user = userEvent.setup();

    render(<CustomerMeasurementsPage />);

    await waitFor(() => expect(
      screen.getByLabelText("Size thường mặc (không bắt buộc)"),
    ).toHaveValue("M"));
    const select = screen.getByLabelText("Size thường mặc (không bắt buộc)");
    await user.selectOptions(select, "unknown");
    await user.click(screen.getByRole("button", { name: /cập nhật số đo/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenNthCalledWith(2, "/users/me/measurements", {
      method: "PATCH",
      body: JSON.stringify({ heightCm: 165, usualSize: null }),
    }));
  });

  it("shows 'Lưu số đo' for first-time entry", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "measurement-1",
          heightCm: null,
          weightKg: null,
          bustCm: 84,
          waistCm: null,
          hipCm: null,
          usualSize: null,
          createdAt: "2026-06-13T00:00:00.000Z",
        },
      });
    const user = userEvent.setup();

    render(<CustomerMeasurementsPage />);

    await waitFor(() => expect(
      screen.getByRole("button", { name: /lưu số đo/i }),
    ).toBeInTheDocument());
    await user.type(screen.getByLabelText("Vòng ngực (cm)"), "84");
    await user.click(screen.getByRole("button", { name: /lưu số đo/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenNthCalledWith(2, "/users/me/measurements", {
      method: "PATCH",
      body: JSON.stringify({ bustCm: 84 }),
    }));
    expect(screen.getByText(/Lưu số đo thành công/i)).toBeInTheDocument();
  });
});
