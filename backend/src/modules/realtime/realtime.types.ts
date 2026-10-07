import type { AppRole } from "@prisma/client";

export type RealtimeResource =
  | "bookings"
  | "assets"
  | "inspections"
  | "refunds"
  | "laundry"
  | "maintenance"
  | "notifications"
  | "payments";

export type RealtimeAudience = "staff" | "manager" | "admin" | "customer" | "all";

export type RealtimeInvalidationPayload = {
  resource: RealtimeResource;
  id?: string;
  bookingId?: string;
  assetId?: string;
  status?: string;
  audience?: RealtimeAudience;
  occurredAt: string;
};

export type RealtimeUser = {
  userId: string;
  role: AppRole;
};
