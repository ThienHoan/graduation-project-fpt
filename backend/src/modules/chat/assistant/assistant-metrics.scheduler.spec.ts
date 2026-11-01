import { SCHEDULE_CRON_OPTIONS } from "@nestjs/schedule/dist/schedule.constants";
import { describe, expect, it, vi } from "vitest";
import { AssistantMetricsScheduler } from "./assistant-metrics.scheduler";

describe("AssistantMetricsScheduler", () => {
  it("cleans expired chat_assistant_events once per run", async () => {
    const metrics = { cleanupExpired: vi.fn().mockResolvedValue(3) };
    const scheduler = new AssistantMetricsScheduler(metrics as never);

    await expect(scheduler.cleanup()).resolves.toBe(3);
    expect(metrics.cleanupExpired).toHaveBeenCalledOnce();
  });

  it("is scheduled daily at 03:30 Asia/Ho_Chi_Minh", () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      AssistantMetricsScheduler.prototype.cleanup,
    );

    expect(options).toEqual({
      cronTime: "0 30 3 * * *",
      timeZone: "Asia/Ho_Chi_Minh",
    });
  });
});
