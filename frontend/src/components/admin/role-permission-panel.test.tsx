import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RolePermissionPanel } from "./role-permission-panel";

const roles = [
  { role: "staff", label: "Nhân viên", userCount: 3, activeCount: 2, areas: [{ area: "bookings", label: "Đơn thuê", read: 4, write: 0 }] },
  { role: "manager_owner", label: "Quản lý / Chủ cửa hàng", userCount: 1, activeCount: 1, areas: [{ area: "pricing", label: "Giá thuê", read: 2, write: 3 }] },
  { role: "customer", label: "Khách hàng", userCount: 9, activeCount: 9, areas: [] },
];

describe("RolePermissionPanel", () => {
  it("shows real permission areas and user counts for the selected role", () => {
    render(<RolePermissionPanel roles={roles} loading={false} />);

    expect(screen.getByText("Giá thuê")).toBeTruthy();
    expect(screen.getByText(/1 tài khoản, 1 đang hoạt động/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nhân viên" }));
    expect(screen.getByText("Đơn thuê")).toBeTruthy();
    expect(screen.queryByText("Giá thuê")).toBeNull();
  });

  it("explains roles without restricted APIs", () => {
    render(<RolePermissionPanel roles={roles} loading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Khách hàng" }));
    expect(screen.getByText(/không có API nào bị giới hạn riêng/i)).toBeTruthy();
  });
});
