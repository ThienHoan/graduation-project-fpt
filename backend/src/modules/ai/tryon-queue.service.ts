import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { TryonStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { TryonMode } from "./dto/create-tryon.dto";

export type TryonJob = {
  requestId: string;
  customerId: string;
  garmentSizeId: string;
  garmentId: string;
  garmentName: string;
  sizeLabel: string | null;
  mode: TryonMode;
  source: string;
  userImageDataUri: string;
  imageHash: string;
  garmentImageUrl: string;
  tryonCategory: string;
  fitType?: "loose" | "tight" | "regular";
};

export type JobProcessor = (job: TryonJob) => Promise<{
  resultUrl: string;
  model: string;
  predictionId: string;
  inputSchema: string;
}>;

export type ResultPersister = (replicateUrl: string, requestId: string) => Promise<string | null>;

@Injectable()
export class TryonQueueService implements OnModuleInit {
  private readonly logger = new Logger(TryonQueueService.name);
  private readonly maxConcurrency = 2;
  private readonly maxRetries = 2;
  private activeCount = 0;
  private readonly queue: TryonJob[] = [];

  private processor?: JobProcessor;
  private persister?: ResultPersister;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Phục hồi các tác vụ bị treo khi server khởi động lại
    try {
      const stuck = await this.prisma.tryonRequest.updateMany({
        where: {
          status: { in: [TryonStatus.pending, TryonStatus.processing] },
        },
        data: {
          status: TryonStatus.failed,
          errorMessage: "Tác vụ bị gián đoạn do hệ thống khởi động lại. Vui lòng bấm Thử lại.",
        },
      });
      if (stuck.count > 0) {
        this.logger.warn(`Đã cập nhật ${stuck.count} tác vụ treo thành 'failed' sau khi khởi động.`);
      }
    } catch (err) {
      this.logger.error("Lỗi khi kiểm tra tác vụ treo lúc khởi động:", err);
    }
  }

  setHandlers(processor: JobProcessor, persister: ResultPersister) {
    this.processor = processor;
    this.persister = persister;
  }

  addJob(job: TryonJob) {
    this.queue.push(job);
    this.logger.log(`Job ${job.requestId} đã được thêm vào hàng đợi. Vị trí: ${this.queue.length}`);
    void this.processNext();
  }

  getQueuePosition(requestId: string): number {
    const idx = this.queue.findIndex((j) => j.requestId === requestId);
    return idx === -1 ? 0 : idx + 1;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  private async processNext() {
    if (this.activeCount >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    this.activeCount++;
    this.logger.log(`Bắt đầu xử lý Job ${job.requestId} (Active: ${this.activeCount}/${this.maxConcurrency})`);

    try {
      await this.executeJobWithRetry(job);
    } catch (err) {
      this.logger.error(`Xử lý Job ${job.requestId} thất bại:`, err);
    } finally {
      this.activeCount--;
      void this.processNext();
    }
  }

  private async executeJobWithRetry(job: TryonJob) {
    if (!this.processor || !this.persister) {
      throw new Error("Job processor hoặc persister chưa được cài đặt.");
    }

    // 1. Cập nhật trạng thái processing
    await this.prisma.tryonRequest.update({
      where: { id: job.requestId },
      data: { status: TryonStatus.processing },
    });

    let attempt = 0;
    let lastError: unknown = null;

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        this.logger.log(`Job ${job.requestId}: Lần chạy ${attempt}/${this.maxRetries + 1}`);

        // Gọi model AI (Replicate)
        const result = await this.processor(job);

        // Lưu ảnh về Supabase Storage
        const storedImageUrl = await this.persister(result.resultUrl, job.requestId);

        // Lưu bản ghi kết quả
        await this.prisma.$transaction([
          this.prisma.tryonRequest.update({
            where: { id: job.requestId },
            data: {
              status: TryonStatus.completed,
              completedAt: new Date(),
              replicatePredictionId: result.predictionId,
            },
          }),
          this.prisma.tryonResult.create({
            data: {
              tryonRequestId: job.requestId,
              resultImageUrl: result.resultUrl,
              storedImageUrl,
              aiMetadata: {
                mode: job.mode,
                source: job.source,
                model: result.model,
                predictionId: result.predictionId,
                garmentImageUrl: job.garmentImageUrl,
                inputSchema: result.inputSchema,
                imageHash: job.imageHash,
                fitType: job.fitType ?? "regular",
                sizeLabel: job.sizeLabel,
                garmentSizeId: job.garmentSizeId,
                isCached: false,
              },
            },
          }),
        ]);

        this.logger.log(`Job ${job.requestId} đã hoàn tất thành công!`);
        return;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Job ${job.requestId} gặp lỗi ở lần thử ${attempt}: ${msg}`);

        if (attempt <= this.maxRetries) {
          // Nghỉ 3 giây trước khi retry
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    // Nếu hết số lần retry mà vẫn lỗi:
    const errorMsg = lastError instanceof Error ? lastError.message : "Xử lý AI thất bại sau nhiều lần thử.";
    await this.prisma.tryonRequest.update({
      where: { id: job.requestId },
      data: {
        status: TryonStatus.failed,
        errorMessage: errorMsg,
      },
    });
  }
}
