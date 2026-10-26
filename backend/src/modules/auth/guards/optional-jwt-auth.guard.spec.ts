import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "./optional-jwt-auth.guard";
import type { JwtAuthGuard } from "./jwt-auth.guard";

function createContext(request: { headers?: { authorization?: string } }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe("OptionalJwtAuthGuard", () => {
  it("allows anonymous requests without an Authorization header", async () => {
    const jwtAuthGuard = { canActivate: vi.fn() } as unknown as JwtAuthGuard;
    const guard = new OptionalJwtAuthGuard(jwtAuthGuard);

    await expect(guard.canActivate(createContext({ headers: {} }))).resolves.toBe(true);
    expect(jwtAuthGuard.canActivate).not.toHaveBeenCalled();
  });

  it("delegates to the JWT guard when a token is present", async () => {
    const jwtAuthGuard = { canActivate: vi.fn().mockResolvedValue(true) } as unknown as JwtAuthGuard;
    const guard = new OptionalJwtAuthGuard(jwtAuthGuard);
    const context = createContext({ headers: { authorization: "Bearer token" } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(context);
  });
});
