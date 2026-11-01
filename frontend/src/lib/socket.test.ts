import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Chống hồi quy: Socket.IO phải trỏ tới backend, không được dùng URL tương đối
 * trỏ nhầm vào origin của frontend (nguyên nhân chat không nhận auto-reply).
 */
async function loadResolver() {
  vi.resetModules();
  const mod = await import("./socket");
  return mod.resolveChatSocketUrl;
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
});