import { afterEach, describe, expect, it, vi } from "vitest";

const socketMock = {
  auth: {} as Record<string, unknown>,
  connected: true,
  io: { reconnection: vi.fn() },
  connect: vi.fn(),
  disconnect: vi.fn(() => {
    socketMock.connected = false;
    return socketMock;
  }),
  removeAllListeners: vi.fn(),
  on: vi.fn(),
};

const ioMock = vi.fn(() => socketMock);

vi.mock("socket.io-client", () => ({ io: ioMock }));

async function loadModule() {
  vi.resetModules();
  return await import("./realtime");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("realtime socket client", () => {
  it("connects to the /realtime namespace with a bearer token", async () => {
    const { createRealtimeSocket } = await loadModule();

    createRealtimeSocket("token-1");

    expect(ioMock).toHaveBeenCalledWith(
      "http://localhost:4000/realtime",
      expect.objectContaining({ auth: { token: "Bearer token-1" } }),
    );
  });

  it("reuses the socket when the token is unchanged", async () => {
    const { createRealtimeSocket } = await loadModule();

    createRealtimeSocket("token-1");
    createRealtimeSocket("token-1");

    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it("reconnects with the new token when the session changes", async () => {
    const { createRealtimeSocket } = await loadModule();

    createRealtimeSocket("token-1");
    createRealtimeSocket("token-2");

    expect(socketMock.auth).toEqual({ token: "Bearer token-2" });
    expect(socketMock.disconnect).toHaveBeenCalledOnce();
    expect(socketMock.connect).toHaveBeenCalledOnce();
  });

  it("keeps the socket alive while another subscriber remains", async () => {
    const { createRealtimeSocket, subscribeRealtimeSocket } = await loadModule();

    const first = createRealtimeSocket("token-1");
    const cleanupFirst = subscribeRealtimeSocket("token-1", vi.fn());
    const cleanupSecond = subscribeRealtimeSocket("token-1", vi.fn());

    cleanupFirst();
    expect(first).not.toBeNull();
    expect(socketMock.disconnect).not.toHaveBeenCalled();

    cleanupSecond();
    expect(socketMock.removeAllListeners).toHaveBeenCalledOnce();
    expect(socketMock.disconnect).toHaveBeenCalledOnce();
  });
});