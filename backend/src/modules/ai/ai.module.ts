import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PricingModule } from "../pricing/pricing.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { PerUserThrottlerGuard } from "./guards/per-user-throttler.guard";
import { TryonQueueService } from "./tryon-queue.service";

@Module({
  imports: [
    AuthModule,
    PricingModule,
    // ThrottlerModule được đăng ký toàn cục trong AppModule (storage Redis).
    // Endpoint product-advisor dùng @Throttle() + PerUserThrottlerGuard để
    // giới hạn theo user thay vì theo IP.
  ],
  controllers: [AiController],
  providers: [AiService, TryonQueueService, PerUserThrottlerGuard],
  exports: [AiService, TryonQueueService],
})
export class AiModule { }
