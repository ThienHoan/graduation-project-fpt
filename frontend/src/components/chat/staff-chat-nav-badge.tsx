"use client";

import { useEffect, useState } from "react";
import { getChatConversationCounts } from "@/lib/chat";
import { readStoredSession } from "@/lib/auth";

const POLL_INTERVAL_MS = 30_000;

/**
 * Badge cạnh mục CSKH trên navbar, đếm đúng số hội thoại của tab
 * "Chờ tiếp nhận" (khách mới nhắn, chưa có staff nào tiếp nhận).
 */
export function StaffChatNavBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = readStoredSession();
      if (!session || (session.user.role !== "staff" && session.user.role !== "manager_owner")) return;

      const res = await getChatConversationCounts();
      if (cancelled || !res.success || !res.data) return;

      setCount(res.data.unassigned ?? 0);
    }

    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (count === 0) return null;

  return (
    <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-lotus px-1.5 text-[11px] font-bold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
