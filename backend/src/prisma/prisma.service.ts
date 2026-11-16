import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

const MAX_SERIALIZABLE_RETRIES = 3;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await this.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000, // 15s — đủ cho flow inspection có nhiều write operations
        });
      } catch (error) {
        lastError = error;
        const isConflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!isConflict) throw error;
        if (attempt === MAX_SERIALIZABLE_RETRIES - 1) break;
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
      }
    }

    // Hết lượt retry vẫn xung đột tuần tự hoá (40001/P2034) → trả 409 để client thử lại,
    // KHÔNG để lộ 500. Cơ chế chống oversell thật là SERIALIZABLE + retry; advisory lock
    // chỉ giúp giảm tranh chấp.
    if (lastError instanceof Prisma.PrismaClientKnownRequestError && lastError.code === "P2034") {
      throw new ConflictException("Hệ thống đang bận, vui lòng thử lại.");
    }
    throw lastError ?? new Error("Serializable transaction failed unexpectedly.");
  }
}
