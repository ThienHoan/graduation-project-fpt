import { afterEach, describe, expect, it, vi } from "vitest";

const ioMock = vi.hoisted(() =>
  vi.fn(() => ({
    connected: false,
    auth: undefined as unknown,
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    io: { reconnection: vi.fn() },
  })),
);
vi.mock("socket.io-client", () => ({ io: ioMock }));

/**
 * Chống hồi quy: Socket.IO phải trỏ tới backend, không được dùng URL tương đối
 * trỏ nhầm vào origin của frontend (nguyên nhân chat không nhận auto-reply).
 */
async function loadResolver() {
  vi.resetModules();
  const mod = await import("./socket");
  return mod.resolveChatSocketUrl;
}

async function loadCreateChatSocket() {
  vi.resetModules();
  const mod = await import("./socket");
  return mod.createChatSocket;
}

async function loadSocketConfig() {
  vi.resetModules();
  return await import("./socket-config");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveChatSocketUrl", () => {
  it("ưu tiên NEXT_PUBLIC_SOCKET_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "https://socket.example.com/chat");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api");

    const resolve = await loadResolver();
    expect(resolve()).toBe("https://socket.example.com/chat");
  });

  it("suy ra host backend từ NEXT_PUBLIC_API_URL (bỏ /api)", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api");

    const resolve = await loadResolver();
    expect(resolve()).toBe("http://localhost:4000/chat");
  });

  it("suy ra host backend từ tiền tố proxy /backend-api", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://cophuctruyenthong.tech/backend-api");

    const resolve = await loadResolver();
    expect(resolve()).toBe("https://cophuctruyenthong.tech/chat");
  });

  it("bỏ dấu / ở cuối URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "http://localhost:4000/chat/");

    const resolve = await loadResolver();
    expect(resolve()).toBe("http://localhost:4000/chat");
  });

  it("fallback cùng origin khi không có env", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    const resolve = await loadResolver();
    expect(resolve()).toBe("/chat");
  });

  it("bật addTrailingSlash khi nối trực tiếp backend khác origin (localhost dev)", async () => {
    // Backend local chỉ khớp `/socket.io/`; gọi `/socket.io` (không "/") trả 404.
    vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api");
    const createChatSocket = await loadCreateChatSocket();

    createChatSocket("token-abc");

    expect(ioMock).toHaveBeenCalledWith(
      "http://localhost:4000/chat",
      expect.objectContaining({ addTrailingSlash: true }),
    );
  });

  it("tắt addTrailingSlash khi đi qua proxy cùng origin (Vercel)", async () => {
    // Next.js 308 bỏ "/" cuối và làm mất header Upgrade khi request cùng origin.
    // jsdom mặc định origin là http://localhost:3000.
    vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "http://localhost:3000/chat");
    const createChatSocket = await loadCreateChatSocket();

    createChatSocket("token-abc");

    expect(ioMock).toHaveBeenCalledWith(
      "http://localhost:3000/chat",
      expect.objectContaining({ addTrailingSlash: false }),
    );
  });
});

describe("resolveSocketUrl", () => {
  it("suy ra namespace /realtime từ NEXT_PUBLIC_API_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://cophuctruyenthong.tech/backend-api");

    const { resolveSocketUrl } = await loadSocketConfig();

    expect(resolveSocketUrl("/realtime")).toBe("https://cophuctruyenthong.tech/realtime");
    expect(resolveSocketUrl("/chat")).toBe("https://cophuctruyenthong.tech/chat");
  });

  it("đổi namespace khi NEXT_PUBLIC_SOCKET_URL đã có namespace", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "https://socket.example.com/realtime");

    const { resolveSocketUrl } = await loadSocketConfig();

    expect(resolveSocketUrl("/chat")).toBe("https://socket.example.com/chat");
  });

  describe("chống Mixed Content khi trang chạy HTTPS", () => {
    const httpsPage = "https://www.cophuctruyenthong.tech";

    it("lùi về URL tương đối khi NEXT_PUBLIC_API_URL trỏ IP http", async () => {
      vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "");
      vi.stubEnv("NEXT_PUBLIC_API_URL", "http://104.248.147.219:4000/api");

      const { resolveSocketUrl } = await loadSocketConfig();

      expect(resolveSocketUrl("/chat", httpsPage)).toBe("/chat");
      expect(resolveSocketUrl("/realtime", httpsPage)).toBe("/realtime");
    });

    it("lùi về URL tương đối khi NEXT_PUBLIC_SOCKET_URL trỏ IP http", async () => {
      vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "http://104.248.147.219:4000/chat");

      const { resolveSocketUrl } = await loadSocketConfig();

      expect(resolveSocketUrl("/chat", httpsPage)).toBe("/chat");
    });

    it("giữ nguyên http loopback (không bị Mixed Content)", async () => {
      vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "");
      vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api");

      const { resolveSocketUrl } = await loadSocketConfig();

      expect(resolveSocketUrl("/chat", httpsPage)).toBe("http://localhost:4000/chat");
    });

    it("giữ nguyên https tuyệt đối", async () => {
      vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "");
      vi.stubEnv("NEXT_PUBLIC_API_URL", "https://cophuctruyenthong.tech/backend-api");

      const { resolveSocketUrl } = await loadSocketConfig();

      expect(resolveSocketUrl("/chat", httpsPage)).toBe("https://cophuctruyenthong.tech/chat");
    });

    it("không can thiệp khi trang chạy HTTP (dev)", async () => {
      vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "");
      vi.stubEnv("NEXT_PUBLIC_API_URL", "http://104.248.147.219:4000/api");

      const { resolveSocketUrl } = await loadSocketConfig();

      expect(resolveSocketUrl("/chat", "http://localhost:3000")).toBe(
        "http://104.248.147.219:4000/chat",
      );
    });
  });
});

describe("shouldAddTrailingSlash", () => {
  it("true khi backend khác origin trang", async () => {
    const { shouldAddTrailingSlash } = await loadSocketConfig();
    expect(shouldAddTrailingSlash("http://localhost:4000/chat", "http://localhost:3000")).toBe(true);
  });

  it("false khi cùng origin (rewrite Vercel)", async () => {
    const { shouldAddTrailingSlash } = await loadSocketConfig();
    expect(
      shouldAddTrailingSlash("https://www.cophuctruyenthong.tech/chat", "https://www.cophuctruyenthong.tech"),
    ).toBe(false);
  });

  it("false với URL tương đối (cùng origin)", async () => {
    const { shouldAddTrailingSlash } = await loadSocketConfig();
    expect(shouldAddTrailingSlash("/chat", "https://www.cophuctruyenthong.tech")).toBe(false);
  });
});

describe("resolveSocketTransports", () => {
  it("chỉ polling khi cùng origin (đi qua rewrite, không nâng cấp được WebSocket)", async () => {
    const { resolveSocketTransports } = await loadSocketConfig();
    expect(resolveSocketTransports("/chat", "https://graduation-project-fpt.vercel.app")).toEqual([
      "polling",
    ]);
    expect(
      resolveSocketTransports(
        "https://graduation-project-fpt.vercel.app/chat",
        "https://graduation-project-fpt.vercel.app",
      ),
    ).toEqual(["polling"]);
  });

  it("polling + websocket khi khác origin (nối thẳng backend)", async () => {
    const { resolveSocketTransports } = await loadSocketConfig();
    expect(
      resolveSocketTransports("http://localhost:4000/chat", "http://localhost:3000"),
    ).toEqual(["polling", "websocket"]);
  });
});