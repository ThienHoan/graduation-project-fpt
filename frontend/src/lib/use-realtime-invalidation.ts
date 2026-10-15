import { useEffect, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeRealtimeSocket } from "@/lib/realtime";

export type RealtimeResource =
  | "bookings"
  | "assets"
  | "inspections"
  | "refunds"
  | "laundry"
  | "maintenance"
  | "notifications"
  | "payments";

export type RealtimeInvalidation = {
  resource: RealtimeResource;
  id?: string;
  bookingId?: string;
  assetId?: string;
  status?: string;
  audience?: string;
  occurredAt: string;
};

type ResourceHandlers = Partial<Record<RealtimeResource, () => void | Promise<void>>>;

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Đăng ký callback refetch REST theo từng resource realtime.
 * Event chỉ là tín hiệu "có thay đổi" — dữ liệu thật luôn lấy lại qua API có auth/role guard.
 */
export function useRealtimeInvalidation(handlers: ResourceHandlers, enabled = true) {
  const { session, status } = useAuth();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const accessToken = session?.accessToken ?? null;
  const authed = status === "authenticated" && Boolean(accessToken);
  const handlerKey = Object.keys(handlers).sort().join(",");

  useEffect(() => {
    if (!enabled || !authed || !accessToken) return;

    const pendingTimers = new Map<RealtimeResource, ReturnType<typeof setTimeout>>();

    return subscribeRealtimeSocket(accessToken, (socket) => {
      const flush = (resource: RealtimeResource) => {
        const handler = handlersRef.current[resource];
        if (!handler) return;

        const existing = pendingTimers.get(resource);
        if (existing) clearTimeout(existing);
        pendingTimers.set(
          resource,
          setTimeout(() => {
            pendingTimers.delete(resource);
            void handler();
          }, DEFAULT_DEBOUNCE_MS),
        );
      };

      socket.on("dashboard.invalidate", (payload: RealtimeInvalidation) => {
        if (!payload?.resource) return;
        flush(payload.resource);
      });

      socket.on("notification.created", () => {
        flush("notifications");
      });

      socket.on("connect", () => {
        // Socket vừa (re)connect: có thể đã miss event → đồng bộ toàn bộ resource đang đăng ký.
        (Object.keys(handlersRef.current) as RealtimeResource[]).forEach(flush);
      });
    });
  }, [accessToken, authed, enabled, handlerKey]);
}