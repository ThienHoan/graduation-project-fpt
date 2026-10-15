import { describe, expect, it, vi } from "vitest";
import { TryonQueueService, type TryonJob } from "./tryon-queue.service";

describe("TryonQueueService", () => {
  it("processes jobs sequentially within concurrency limit and updates DB", async () => {
    const prismaMock = {
      tryonRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({ id: "req-1" }),
      },
      tryonResult: {
        create: vi.fn().mockResolvedValue({ id: "res-1" }),
      },
      $transaction: vi.fn().mockImplementation((promises) => Promise.all(promises)),
    } as any;

    const queueService = new TryonQueueService(prismaMock);

    const mockProcessor = vi.fn().mockResolvedValue({
      resultUrl: "https://replicate.delivery/result.png",
      model: "test-model",
      predictionId: "pred-1",
      inputSchema: "test-schema",
    });

    const mockPersister = vi.fn().mockResolvedValue("https://supabase.co/stored.png");

    queueService.setHandlers(mockProcessor, mockPersister);

    const job: TryonJob = {
      requestId: "req-1",
      customerId: "cust-1",
      garmentSizeId: "size-1",
      garmentId: "garment-1",
      garmentName: "Áo dài đỏ",
      sizeLabel: "M",
      mode: "face_swap",
      source: "upload",
      userImageDataUri: "data:image/jpeg;base64,abc",
      imageHash: "hash-123",
      garmentImageUrl: "https://example.com/garment.jpg",
      tryonCategory: "dresses",
    };

    queueService.addJob(job);

    // Wait a brief moment for the async worker queue to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(mockProcessor).toHaveBeenCalledWith(job);
    expect(mockPersister).toHaveBeenCalledWith("https://replicate.delivery/result.png", "req-1");
    expect(prismaMock.tryonRequest.update).toHaveBeenCalled();
  });
});
