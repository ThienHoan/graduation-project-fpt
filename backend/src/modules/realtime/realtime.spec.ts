import { describe, expect, it, vi, beforeEach } from "vitest";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

function createClient(auth?: { token?: string }) {
  return {
    id: "sock-1",
    handshake: { auth },
    data: {} as Record<string, unknown>,
    join: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe("RealtimeGateway.handleConnection", () => {
  const jwtService = { verifyAsync: vi.fn() } as never;
  const realtimeService = new RealtimeService();

  function createGateway(prisma: unknown) {
    return new RealtimeGateway(jwtService, prisma as never, realtimeService);
  }

  beforeEach(() => {
    (jwtService as unknown as { verifyAsync: ReturnType<typeof vi.fn> }).verifyAsync.mockReset();
  });

  it("disconnects the socket when the handshake has no token", async () => {
    const gateway = createGateway({ userAccount: { findUnique: vi.fn() } });
    const client = createClient();

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects the socket when the token cannot be verified", async () => {
    (jwtService as unknown as { verifyAsync: ReturnType<typeof vi.fn> }).verifyAsync.mockRejectedValue(new Error("invalid"));
    const gateway = createGateway({ userAccount: { findUnique: vi.fn() } });
    const client = createClient({ token: "Bearer bad-token" });

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(client.join).not.toHaveBeenCalled();
  });

  it("disconnects the socket when the account is inactive", async () => {
    (jwtService as unknown as { verifyAsync: ReturnType<typeof vi.fn> }).verifyAsync.mockResolvedValue({
      sub: "user-1",
      role: "staff",
    });
    const gateway = createGateway({
      userAccount: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", role: "staff", isActive: false }) },
    });
    const client = createClient({ token: "Bearer good-token" });

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(client.join).not.toHaveBeenCalled();
  });

  it("joins the staff dashboard room for an active staff account", async () => {
    (jwtService as unknown as { verifyAsync: ReturnType<typeof vi.fn> }).verifyAsync.mockResolvedValue({
      sub: "user-1",
      role: "staff",
    });
    const gateway = createGateway({
      userAccount: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", role: "staff", isActive: true }) },
    });
    const client = createClient({ token: "Bearer good-token" });

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith("dashboard:all");
    expect(client.join).toHaveBeenCalledWith("user:user-1");
    expect(client.join).toHaveBeenCalledWith("role:staff");
    expect(client.join).toHaveBeenCalledWith("dashboard:staff");
    expect(client.join).not.toHaveBeenCalledWith("dashboard:manager");
  });

  it("joins the manager dashboard room for a manager_owner account", async () => {
    (jwtService as unknown as { verifyAsync: ReturnType<typeof vi.fn> }).verifyAsync.mockResolvedValue({
      sub: "user-2",
      role: "manager_owner",
    });
    const gateway = createGateway({
      userAccount: { findUnique: vi.fn().mockResolvedValue({ id: "user-2", role: "manager_owner", isActive: true }) },
    });
    const client = createClient({ token: "Bearer good-token" });

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith("dashboard:manager");
    expect(client.join).not.toHaveBeenCalledWith("dashboard:staff");
  });
});

describe("RealtimeService payloads", () => {
  it("emits an allowlisted invalidation payload without business data", () => {
    const service = new RealtimeService();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    service.bindServer({ to } as never);

    service.bookingChanged({ id: "booking-1", bookingId: "booking-1", status: "completed" });

    expect(to).toHaveBeenCalledWith("dashboard:staff");
    expect(to).toHaveBeenCalledWith("dashboard:manager");
    expect(to).toHaveBeenCalledWith("dashboard:admin");

    expect(emit).toHaveBeenCalledTimes(3);
    for (const call of emit.mock.calls) {
      expect(call[0]).toBe("dashboard.invalidate");
      expect(Object.keys(call[1] as object).sort()).toEqual([
        "audience",
        "bookingId",
        "id",
        "occurredAt",
        "resource",
        "status",
      ]);
    }

    expect(emit).toHaveBeenCalledWith("dashboard.invalidate", expect.objectContaining({ resource: "bookings" }));
  });

  it("sends notifications only to the target user", () => {
    const service = new RealtimeService();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    service.bindServer({ to } as never);

    service.notificationCreated("user-9", { bookingId: "booking-9" });

    expect(to).toHaveBeenCalledTimes(2);
    expect(to).toHaveBeenNthCalledWith(1, "user:user-9");
    expect(to).toHaveBeenNthCalledWith(2, "user:user-9");
    expect(emit).toHaveBeenCalledWith(
      "notification.created",
      expect.objectContaining({ resource: "notifications", bookingId: "booking-9" }),
    );
  });

  it("scopes a customer booking invalidation to that customer's own room", () => {
    const service = new RealtimeService();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    service.bindServer({ to } as never);

    service.bookingChangedForCustomer("customer-7", { id: "booking-7", bookingId: "booking-7", status: "overdue" });

    // Chỉ room của chủ đơn — không broadcast, tránh lộ bookingId của người khác.
    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith("user:customer-7");
    expect(emit).toHaveBeenCalledWith(
      "dashboard.invalidate",
      expect.objectContaining({ resource: "bookings", audience: "customer", status: "overdue" }),
    );
  });

  it("does nothing when no socket server is bound", () => {
    const service = new RealtimeService();
    expect(() => service.bookingChanged({ id: "booking-1" })).not.toThrow();
    expect(() => service.bookingChangedForCustomer("user-1")).not.toThrow();
    expect(() => service.notificationCreated("user-1")).not.toThrow();
  });
});