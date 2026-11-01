import { beforeEach, describe, expect, it } from "vitest";
import { RepeatGuardService } from "./repeat-guard.service";
import { IdempotencyService } from "./idempotency.service";

describe("RepeatGuardService", () => {
  let service: RepeatGuardService;

  beforeEach(() => {
    service = new RepeatGuardService();
  });

  it("escalates after three consecutive auto-replies", async () => {
    await expect(service.register("conv-1", "a")).resolves.toMatchObject({
      escalate: false,
      count: 1,
    });
    await expect(service.register("conv-1", "b")).resolves.toMatchObject({
      escalate: false,
      count: 2,
    });
    await expect(service.register("conv-1", "c")).resolves.toMatchObject({
      escalate: true,
      reason: "repeat_limit",
      count: 3,
    });
  });

  it("escalates immediately when the same intent and slots repeat", async () => {
    const signature = JSON.stringify(["db.product_price", "", "", "", "M", "do"]);

    await expect(service.register("conv-1", signature)).resolves.toMatchObject({
      escalate: false,
      sameCount: 1,
    });
    await expect(service.register("conv-1", signature)).resolves.toMatchObject({
      escalate: true,
      reason: "same_intent_twice",
      sameCount: 2,
    });
  });

  it("resets after a staff reply", async () => {
    await service.register("conv-1", "a");
    await service.register("conv-1", "b");
    await service.reset("conv-1");

    await expect(service.register("conv-1", "c")).resolves.toMatchObject({
      escalate: false,
      count: 1,
    });
  });

  it("resets when a newer staff message is passed in", async () => {
    await service.register("conv-1", "a");
    await service.register("conv-1", "b");

    await expect(
      service.register("conv-1", "c", new Date(Date.now() + 1000)),
    ).resolves.toMatchObject({ escalate: false, count: 1 });
  });

  it("allows the same clarification question only once", async () => {
    await expect(service.claimAsk("conv-1", "product:missing")).resolves.toBe(true);
    await expect(service.claimAsk("conv-1", "product:missing")).resolves.toBe(false);

    await service.reset("conv-1");
    await expect(service.claimAsk("conv-1", "product:missing")).resolves.toBe(true);
  });
});

describe("IdempotencyService", () => {
  it("processes each messageId only once", async () => {
    const service = new IdempotencyService();

    await expect(service.begin("msg-1")).resolves.toBe(true);
    await expect(service.begin("msg-1")).resolves.toBe(false);

    await service.release("msg-1");
    await expect(service.begin("msg-1")).resolves.toBe(true);
  });

  it("does not block messages without an id", async () => {
    const service = new IdempotencyService();
    await expect(service.begin(null)).resolves.toBe(true);
    await expect(service.begin(undefined)).resolves.toBe(true);
  });
});
