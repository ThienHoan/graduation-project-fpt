"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getMyNotifications,
  markAllMyNotificationsRead,
  markMyNotificationRead,
  type NotificationItem,
} from "@/lib/api";
import { normalizeStatusInText } from "@/lib/status-labels";
import { useRealtimeInvalidation } from "@/lib/use-realtime-invalidation";

const POLL_INTERVAL_MS = 30_000;
const FETCH_LIMIT = 20;

function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short" }).format(new Date(iso));
}

export function NotificationBell({ notificationsHref }: { notificationsHref?: string }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await getMyNotifications(FETCH_LIMIT);
    if (res.success && res.data) {
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unreadCount);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Realtime: có thông báo mới thì lấy lại ngay, không chờ tới lần poll kế tiếp.
  useRealtimeInvalidation({ notifications: load });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleMarkRead(id: string) {
    setNotifications((current) =>
      current.map((item) => (item.id === id ? { ...item, isRead: true, readAt: new Date().toISOString() } : item)),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
    await markMyNotificationRead(id);
  }

  async function handleMarkAllRead() {
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true, readAt: item.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await markAllMyNotificationsRead();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-lotus transition hover:bg-lotus/10"
        aria-label="Thông báo"
      >
        <span className="material-symbols-outlined text-[22px]">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-oxblood px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-sand bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-sand px-4 py-3">
            <div>
              <p className="font-semibold text-ink">Thông báo</p>
              <p className="text-xs text-stone-500">{unreadCount} chưa đọc</p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-semibold text-lotus transition hover:text-oxblood"
              >
                Đánh dấu tất cả
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-stone-400">Chưa có thông báo.</div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => !item.isRead && handleMarkRead(item.id)}
                  className={`flex w-full gap-3 border-b border-sand/60 px-4 py-3 text-left transition hover:bg-mist ${
                    item.isRead ? "bg-white" : "bg-lotus/5"
                  }`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.isRead ? "bg-transparent" : "bg-oxblood"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{normalizeStatusInText(item.title)}</p>
                    {item.body && <p className="mt-0.5 whitespace-pre-line text-xs leading-5 text-stone-600">{normalizeStatusInText(item.body)}</p>}
                    <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-stone-400">{formatRelative(item.createdAt)}</p>
                  </div>
                </button>
              ))
            )}
          </div>

          {notificationsHref && (
            <Link
              href={notificationsHref}
              onClick={() => setOpen(false)}
              className="block border-t border-sand px-4 py-3 text-center text-sm font-semibold text-lotus transition hover:bg-mist"
            >
              Xem tất cả
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
