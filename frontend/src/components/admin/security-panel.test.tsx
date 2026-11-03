import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSecurityOverview = vi.fn();
const getAdminSecurityAccounts = vi.fn();
const revokeAdminUserSessions = vi.fn();
const verifyAdminUserEmail = vi.fn();

vi.mock("@/lib/api", () => ({
  getAdminSecurityOverview: (...a: unknown[]) => getAdminSecurityOverview(...a),
  getAdminSecurityAccounts: (...a: unknown[]) => getAdminSecurityAccounts(...a),
  revokeAdminUserSessions: (...a: unknown[]) => revokeAdminUserSessions(...a),
  verifyAdminUserEmail: (...a: unknown[]) => verifyAdminUserEmail(...a),
}));

import { SecurityPanel } from "./security-panel";

const accounts = [
  { id: "me", email: "admin@shop.vn", role: "admin", isActive: true, isEmailVerified: true, fullName: "Tôi", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
  { id: "u2", email: "new@shop.vn", role: "customer", isActive: true, isEmailVerified: false, fullName: null, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z" },
];

describe("SecurityPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSecurityOverview.mockResolvedValue({
      success: true,
      data: {
        stats: { total: 10, inactive: 1, unverified: 3, staleUnverified: 2, privilegedActive: 4, activeAdmins: 1 },
        staleUnverifiedHours: 24,
        recentEvents: [{ id: "e1", action: "ADMIN_REVOKE_SESSIONS", label: "Buộc đăng xuất", actorName: "Admin", targetEmail: "x@y.z", createdAt: "2026-11-01T00:00:00Z" }],
      },
    });
    getAdminSecurityAccounts.mockResolvedValue({ success: true, data: { items: accounts, total: 2, page: 1, limit: 10 } });
    revokeAdminUserSessions.mockResolvedValue({ success: true, data: { id: "u2", revokedAt: "x" } });
    verifyAdminUserEmail.mockResolvedValue({ success: true, data: { id: "u2", isEmailVerified: true } });
  });

  it("shows stats, accounts and recent security events", async () => {
    render(<SecurityPanel currentUserId="me" onSuccess={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByText("new@shop.vn")).toBeTruthy();
    expect(screen.getByText("Sự kiện bảo mật gần đây")).toBeTruthy();
    expect(screen.getByText(/2 tài khoản quá 24 giờ/)).toBeTruthy();
    expect(screen.getByText(/Admin → x@y.z/)).toBeTruthy();
  });

  it("disables force sign-out for the current admin only", async () => {
    render(<SecurityPanel currentUserId="me" onSuccess={vi.fn()} onError={vi.fn()} />);
    await screen.findByText("new@shop.vn");

    const buttons = screen.getAllByRole("button", { name: /Buộc đăng xuất/ });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks for confirmation before revoking sessions, then reloads", async () => {
    const onSuccess = vi.fn();
    render(<SecurityPanel currentUserId="me" onSuccess={onSuccess} onError={vi.fn()} />);
    await screen.findByText("new@shop.vn");

    fireEvent.click(screen.getAllByRole("button", { name: /Buộc đăng xuất/ })[1]);
    expect(revokeAdminUserSessions).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận" }));

    await waitFor(() => expect(revokeAdminUserSessions).toHaveBeenCalledWith("u2"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getAdminSecurityAccounts.mock.calls.length).toBeGreaterThan(1);
  });

  it("only offers manual verification for unverified accounts", async () => {
    render(<SecurityPanel currentUserId="me" onSuccess={vi.fn()} onError={vi.fn()} />);
    await screen.findByText("new@shop.vn");
    expect(screen.getAllByRole("button", { name: /Xác minh/ })).toHaveLength(1);
  });
});
