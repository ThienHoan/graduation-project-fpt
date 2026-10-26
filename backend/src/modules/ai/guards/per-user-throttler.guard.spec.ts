import { describe, expect, it } from "vitest";
import { PerUserThrottlerGuard } from "./per-user-throttler.guard";

function createGuard() {
  return new PerUserThrottlerGuard({} as never, {} as never, {} as never);
}

describe("PerUserThrottlerGuard", () => {
  it("tracks authenticated users by user id", async () => {
    const guard = createGuard() as unknown as {
      getTracker: (req: Record<string, unknown>) => Promise<string>;
    };

    await expect(guard.getTracker({ user: { id: "user-1" }, ip: "1.2.3.4" })).resolves.toBe("user:user-1");
  });

  it("falls back to the client IP for anonymous requests", async () => {
    const guard = createGuard() as unknown as {
      getTracker: (req: Record<string, unknown>) => Promise<string>;
    };

    await expect(guard.getTracker({ ip: "1.2.3.4" })).resolves.toBe("ip:1.2.3.4");
  });
});
