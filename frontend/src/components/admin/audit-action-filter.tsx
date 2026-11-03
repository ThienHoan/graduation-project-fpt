"use client";

import type { AdminAuditLogGroup } from "@/lib/api";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  ADMIN_UPDATE_USER: "Cập nhật tài khoản",
  ADMIN_UPDATE_SETTING: "Thay đổi cấu hình hệ thống",
  ADMIN_REVOKE_SESSIONS: "Buộc đăng xuất",
  ADMIN_VERIFY_EMAIL: "Xác minh email thủ công",
  ADMIN_EXPORT_DATA: "Xuất dữ liệu",
  "notification.sent": "Gửi thông báo thành công",
  "notification.failed": "Gửi thông báo thất bại",
  FAQ_UPDATE: "Cập nhật FAQ",
  FAQ_BANK_ACCOUNT_UPDATE: "Cập nhật tài khoản ngân hàng (FAQ)",
  DAMAGE_DEDUCTION: "Trừ tiền hư hỏng",
};

export const AUDIT_GROUPS: { value: AdminAuditLogGroup; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "admin", label: "Thao tác quản trị" },
  { value: "notification", label: "Thông báo hệ thống" },
  { value: "other", label: "Khác" },
];

export function auditActionGroup(action: string): Exclude<AdminAuditLogGroup, "all"> {
  if (action.startsWith("ADMIN_")) return "admin";
  if (action.startsWith("notification.")) return "notification";
  return "other";
}

export function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

type Props = {
  group: AdminAuditLogGroup;
  action: string;
  actions: { action: string; count: number }[];
  onGroupChange: (group: AdminAuditLogGroup) => void;
  onActionChange: (action: string) => void;
};

export function AuditActionFilter({ group, action, actions, onGroupChange, onActionChange }: Props) {
  const visibleActions = actions.filter((item) => group === "all" || auditActionGroup(item.action) === group);
  const groupCount = (value: AdminAuditLogGroup) =>
    actions
      .filter((item) => value === "all" || auditActionGroup(item.action) === value)
      .reduce((sum, item) => sum + item.count, 0);

  return (
    <>
      <div className="w-full">
        <label className="mb-1 block text-[10px] font-bold uppercase text-stone-500">Nhóm hành động</label>
        <div className="flex flex-wrap gap-2">
          {AUDIT_GROUPS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={group === item.value}
              onClick={() => onGroupChange(item.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                group === item.value ? "bg-lotus text-white" : "border border-sand bg-white text-stone-600 hover:bg-warm-ivory/50"
              }`}
            >
              {item.label}
              {actions.length > 0 && <span className="ml-1.5 opacity-70">({groupCount(item.value).toLocaleString("vi-VN")})</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="w-64">
        <label htmlFor="audit-action-select" className="mb-1 block text-[10px] font-bold uppercase text-stone-500">
          Loại thao tác cụ thể
        </label>
        <select
          id="audit-action-select"
          value={action}
          onChange={(e) => onActionChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-sand bg-white px-3 py-1.5 text-xs text-ink outline-none focus:border-antique"
        >
          <option value="all">Tất cả loại thao tác</option>
          {visibleActions.map((item) => (
            <option key={item.action} value={item.action}>
              {auditActionLabel(item.action)} ({item.count.toLocaleString("vi-VN")})
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
