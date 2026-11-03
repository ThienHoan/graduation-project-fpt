"use client";

import { useState } from "react";
import { Ban, CheckCircle2, Eye, Pencil } from "lucide-react";
import type { AdminRoleEntry } from "@/lib/api";

type RolePermissionPanelProps = {
  roles: AdminRoleEntry[];
  loading: boolean;
};

/**
 * Permission matrix built by the API from the real `@Roles()` guards of every controller route,
 * so it always reflects what each role can actually call.
 */
export function RolePermissionPanel({ roles, loading }: RolePermissionPanelProps) {
  const [selected, setSelected] = useState<string>("manager_owner");
  const current = roles.find((item) => item.role === selected) ?? roles[0];

  return (
    <div className="lg:col-span-5 bg-white rounded-xl border border-sand shadow-sm overflow-hidden flex flex-col">
      <div className="p-5 border-b border-sand/60 bg-warm-ivory">
        <h3 className="text-xl font-bold text-ink">Bảng Phân Quyền Vai Trò</h3>
        <p className="mt-1 text-xs text-stone-500">Tổng hợp từ các rào chắn quyền thật của hệ thống API.</p>
      </div>

      <div className="p-4 border-b border-sand/30 bg-stone-50/50 flex gap-2 overflow-x-auto">
        {roles.map((item) => (
          <button
            key={item.role}
            type="button"
            onClick={() => setSelected(item.role)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              current?.role === item.role
                ? "bg-lotus text-white"
                : "bg-white text-stone-600 border border-sand hover:bg-warm-ivory/50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="p-6 space-y-5">
        {loading && !current && <p className="text-sm text-stone-500">Đang tải phân quyền...</p>}

        {current && (
          <>
            <div className="border-b border-sand pb-3">
              <h4 className="text-base font-bold text-lotus">Quyền hạn: {current.label}</h4>
              <p className="mt-1 text-xs text-stone-500">
                {current.userCount.toLocaleString("vi-VN")} tài khoản, {current.activeCount.toLocaleString("vi-VN")} đang hoạt động.
              </p>
            </div>

            {current.areas.length === 0 ? (
              <p className="rounded-xl border border-sand bg-warm-ivory/30 p-4 text-sm text-stone-600">
                Vai trò này không có API nào bị giới hạn riêng. Chỉ các chức năng dành cho tài khoản đăng nhập thông thường được sử dụng.
              </p>
            ) : (
              <div className="space-y-3">
                {current.areas.map((area) => (
                  <div key={area.area} className="p-4 rounded-xl border border-sand bg-warm-ivory/20">
                    <p className="text-sm font-semibold text-ink mb-3">{area.label}</p>
                    <div className="grid grid-cols-2 gap-2 text-center text-xs">
                      <PermissionCell icon={Eye} label="Xem dữ liệu" count={area.read} />
                      <PermissionCell icon={Pencil} label="Thêm / sửa / xóa" count={area.write} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PermissionCell({ icon: Icon, label, count }: { icon: typeof Eye; label: string; count: number }) {
  const allowed = count > 0;
  return (
    <div
      className={`py-1.5 rounded border flex items-center justify-center gap-1.5 ${
        allowed
          ? "bg-jade/5 border-jade/30 text-jade font-semibold"
          : "bg-stone-50 border-stone-200 text-stone-400 opacity-60"
      }`}
    >
      {allowed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {allowed && <span className="text-[10px] opacity-70">({count})</span>}
    </div>
  );
}
