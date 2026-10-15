import { Injectable } from "@nestjs/common";
import type { AppRole } from "@prisma/client";
import type { Server } from "socket.io";
import type { RealtimeAudience, RealtimeInvalidationPayload, RealtimeResource } from "./realtime.types";

@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  bindServer(server: Server) {
    this.server = server;
  }

  emitToUser(userId: string, event: string, payload: RealtimeInvalidationPayload) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitToRole(role: AppRole, event: string, payload: RealtimeInvalidationPayload) {
    this.server?.to(`role:${role}`).emit(event, payload);
  }

  emitDashboardInvalidate(audience: RealtimeAudience, payload: Omit<RealtimeInvalidationPayload, "occurredAt" | "audience">) {
    const fullPayload: RealtimeInvalidationPayload = {
      ...payload,
      audience,
      occurredAt: new Date().toISOString(),
    };

    const room = audience === "all" ? "dashboard:all" : `dashboard:${audience}`;
    this.server?.to(room).emit("dashboard.invalidate", fullPayload);
  }

  bookingChanged(payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitOperational("bookings", payload);
  }

  assetChanged(payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitOperational("assets", payload);
  }

  inspectionChanged(payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitOperational("inspections", payload);
  }

  refundChanged(payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitOperational("refunds", payload);
  }

  laundryChanged(payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitOperational("laundry", payload);
  }

  maintenanceChanged(payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitOperational("maintenance", payload);
  }

  notificationCreated(userId: string, payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    const fullPayload: RealtimeInvalidationPayload = {
      ...payload,
      resource: "notifications",
      audience: "customer",
      occurredAt: new Date().toISOString(),
    };
    this.emitToUser(userId, "notification.created", fullPayload);
    this.emitToUser(userId, "dashboard.invalidate", fullPayload);
  }

  /**
   * Gửi tín hiệu tới đúng chủ đơn thay vì broadcast cho mọi khách — broadcast sẽ
   * lộ bookingId của đơn người khác qua socket.
   */
  bookingChangedForCustomer(customerId: string, payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitUserInvalidate(customerId, "bookings", payload);
  }

  refundChangedForCustomer(customerId: string, payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience"> = {}) {
    this.emitUserInvalidate(customerId, "refunds", payload);
  }

  private emitUserInvalidate(userId: string, resource: RealtimeResource, payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience">) {
    const fullPayload: RealtimeInvalidationPayload = {
      ...payload,
      resource,
      audience: "customer",
      occurredAt: new Date().toISOString(),
    };
    this.server?.to(`user:${userId}`).emit("dashboard.invalidate", fullPayload);
  }

  private emitOperational(resource: RealtimeResource, payload: Omit<RealtimeInvalidationPayload, "resource" | "occurredAt" | "audience">) {
    this.emitDashboardInvalidate("staff", { ...payload, resource });
    this.emitDashboardInvalidate("manager", { ...payload, resource });
    this.emitDashboardInvalidate("admin", { ...payload, resource });
  }
}
