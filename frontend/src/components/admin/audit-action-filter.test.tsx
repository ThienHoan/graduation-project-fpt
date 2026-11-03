import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditActionFilter, auditActionGroup, auditActionLabel } from "./audit-action-filter";

const actions = [
  { action: "notification.sent", count: 2000 },
  { action: "ADMIN_UPDATE_USER", count: 3 },
  { action: "ADMIN_REVOKE_SESSIONS", count: 1 },
  { action: "FAQ_UPDATE", count: 2 },
];

describe("AuditActionFilter", () => {
  it("classifies and labels actions", () => {
    expect(auditActionGroup("ADMIN_EXPORT_DATA")).toBe("admin");
    expect(auditActionGroup("notification.failed")).toBe("notification");
    expect(auditActionGroup("FAQ_UPDATE")).toBe("other");
    expect(auditActionLabel("ADMIN_REVOKE_SESSIONS")).toBe("Buộc đăng xuất");
    expect(auditActionLabel("unknown_action")).toBe("unknown_action");
  });

  it("shows group counts and only the actions of the selected group", () => {
    render(<AuditActionFilter group="admin" action="all" actions={actions} onGroupChange={vi.fn()} onActionChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Thông báo hệ thống/ }).textContent).toContain("2.000");
    expect(screen.getByRole("option", { name: /Buộc đăng xuất/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Gửi thông báo thành công/ })).toBeNull();
  });

  it("reports group and action changes", () => {
    const onGroupChange = vi.fn();
    const onActionChange = vi.fn();
    render(<AuditActionFilter group="all" action="all" actions={actions} onGroupChange={onGroupChange} onActionChange={onActionChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Thao tác quản trị/ }));
    expect(onGroupChange).toHaveBeenCalledWith("admin");

    fireEvent.change(screen.getByLabelText("Loại thao tác cụ thể"), { target: { value: "FAQ_UPDATE" } });
    expect(onActionChange).toHaveBeenCalledWith("FAQ_UPDATE");
  });
});
