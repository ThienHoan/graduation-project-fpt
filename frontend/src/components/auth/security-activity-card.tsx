"use client";

import { useEffect, useState } from "react";
import { getSecurityActivity, type SecurityActivityItem } from "@/lib/api";
import { ShieldCheck, ShieldAlert, Monitor, Smartphone, RefreshCw, Clock } from "lucide-react";

export function SecurityActivityCard() {
  const [activities, setActivities] = useState<SecurityActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadActivities() {
    setLoading(true);
    setError(null);
    try {
      const res = await getSecurityActivity(10);
      if (res.success && res.data) {
        setActivities(res.data);
      } else {
        setError(res.message || "Không thể tải lịch sử bảo mật.");
      }
    } catch {
      setError("Lỗi kết nối khi tải lịch sử bảo mật.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadActivities();
  }, []);

  function formatTimestamp(iso: string) {
    try {
      const date = new Date(iso);
      return date.toLocaleString("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  return (
    <div className="rounded-lg border border-sand/80 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-sand/40">
        <div>
          <h3 className="font-display text-lg text-ink font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-lotus" />
            Lịch sử hoạt động bảo mật
          </h3>
          <p className="text-xs text-ink/70 mt-0.5">
            Nhật ký các lần đăng nhập, đổi mật khẩu và thao tác tài khoản gần đây
          </p>
        </div>
        <button
          onClick={loadActivities}
          disabled={loading}
          className="p-1.5 text-ink/60 hover:text-lotus transition rounded-md hover:bg-slate-50 disabled:opacity-50"
          title="Tải lại"
          aria-label="Tải lại nhật ký bảo mật"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="pt-3">
        {loading && activities.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink/60">Đang tải lịch sử bảo mật...</div>
        ) : error ? (
          <div className="py-6 text-center text-xs text-red-600">{error}</div>
        ) : activities.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink/60">Chưa có bản ghi hoạt động nào.</div>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {activities.map((item) => {
              const isSuccess =
                item.action === "AUTH_LOGIN_SUCCESS" ||
                item.action === "AUTH_PASSWORD_CHANGED" ||
                item.action === "AUTH_EMAIL_VERIFIED";

              const isAlert =
                item.action === "AUTH_LOGIN_FAILED" || item.action === "AUTH_ACCOUNT_LOCKED";

              return (
                <li key={item.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      {isAlert ? (
                        <ShieldAlert className="h-4 w-4 text-red-500" />
                      ) : isSuccess ? (
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Clock className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                    <div>
                      <p className={`font-medium ${isAlert ? "text-red-700" : "text-ink"}`}>
                        {item.actionLabel}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink/60 mt-0.5">
                        <span className="flex items-center gap-1">
                          {item.deviceType === "mobile" ? (
                            <Smartphone className="h-3 w-3" />
                          ) : (
                            <Monitor className="h-3 w-3" />
                          )}
                          {item.browser} • {item.os}
                        </span>
                        <span>•</span>
                        <span>IP: {item.ip}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-ink/60 whitespace-nowrap shrink-0">
                    {formatTimestamp(item.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

