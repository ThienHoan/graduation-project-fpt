import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PricingModule } from "../pricing/pricing.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { TryonQueueService } from "./tryon-queue.service";

@Module({
  imports: [
    AuthModule,
    PricingModule,
    // ThrottlerModule đã được đăng ký toàn cục trong AppModule
    // Các endpoint dùng @Throttle() decorator để ghi đè limit
  ],
  controllers: [AiController],
  providers: [AiService, TryonQueueService],
  exports: [AiService, TryonQueueService],
})
export class AiModule {}
