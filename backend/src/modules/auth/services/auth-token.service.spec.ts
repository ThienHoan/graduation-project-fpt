import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthTokenService } from "./auth-token.service";

describe("AuthTokenService", () => {
  let service: AuthTokenService;
  let mockJwtService: any;
  let mockRedisService: any;

  beforeEach(() => {
    mockJwtService = {
      signAsync: vi.fn().mockResolvedValue("mocked.jwt.token"),
      decode: vi.fn(),
      verifyAsync: vi.fn(),
    };
    mockRedisService = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    };

    service = new AuthTokenService(mockJwtService as any, mockRedisService as any);
  });

  it("generates an access token with expected payload shape", async () => {
    const token = await service.generateAccessToken({
      id: "user-123",
      email: "test@example.com",
      role: "customer",
    });

    expect(token).toBe("mocked.jwt.token");
    expect(mockJwtService.signAsync).toHaveBeenCalledWith({
      sub: "user-123",
      email: "test@example.com",
      role: "customer",
      tokenType: "access",
    });
  });

  it("blacklists a token with remaining TTL", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    mockJwtService.decode.mockReturnValue({
      sub: "user-123",
      exp: nowSeconds + 3600, // 1 hour remaining
    });

    await service.blacklistToken("active.jwt.token");

    expect(mockRedisService.set).toHaveBeenCalledWith(
      "auth:blacklist:active.jwt.token",
      "1",
      expect.any(Number),
    );
  });

  it("identifies whether a token is blacklisted", async () => {
    mockRedisService.get.mockResolvedValueOnce("1");
    expect(await service.isTokenBlacklisted("revoked.token")).toBe(true);

    mockRedisService.get.mockResolvedValueOnce(null);
    expect(await service.isTokenBlacklisted("valid.token")).toBe(false);
  });

  it("extracts token correctly from Authorization header", () => {
    expect(service.extractToken("Bearer token-abc-123")).toBe("token-abc-123");
    expect(service.extractToken("bearer token-abc-123")).toBe("token-abc-123");
    expect(service.extractToken("Basic abc")).toBeNull();
    expect(service.extractToken(undefined)).toBeNull();
  });
});

