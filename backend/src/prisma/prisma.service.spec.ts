import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "./prisma.service";

function serializationConflict() {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction write conflict",
    { code: "P2034", clientVersion: "6.2.1" },
  );
}

describe("PrismaService.runSerializable", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs transactions with serializable isolation", async () => {
    const service = new PrismaService();
    const operation = vi.fn().mockResolvedValue("ok");
    const transaction = vi.spyOn(service, "$transaction").mockResolvedValue("ok" as never);

    await expect(service.runSerializable(operation)).resolves.toBe("ok");

    expect(transaction).toHaveBeenCalledWith(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("retries P2034 conflicts and returns the successful result", async () => {
    vi.useFakeTimers();
    const service = new PrismaService();
    const transaction = vi.spyOn(service, "$transaction")
      .mockRejectedValueOnce(serializationConflict())
      .mockRejectedValueOnce(serializationConflict())
      .mockResolvedValueOnce("committed" as never);

    const result = service.runSerializable(async () => "unused");
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe("committed");
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry unrelated transaction failures", async () => {
    const service = new PrismaService();
    const failure = new Error("database unavailable");
    const transaction = vi.spyOn(service, "$transaction").mockRejectedValue(failure);

    await expect(service.runSerializable(async () => "unused")).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("fails after exhausting the serialization retry limit", async () => {
    vi.useFakeTimers();
    const service = new PrismaService();
    const failures = [serializationConflict(), serializationConflict(), serializationConflict()];
    const transaction = vi.spyOn(service, "$transaction")
      .mockRejectedValueOnce(failures[0])
      .mockRejectedValueOnce(failures[1])
      .mockRejectedValueOnce(failures[2]);

    const result = service.runSerializable(async () => "unused");
    const rejection = expect(result).rejects.toBe(failures[2]);
    await vi.runAllTimersAsync();

    await rejection;
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
