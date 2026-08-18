import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "../auth/auth.module";
import { PricingModule } from "../pricing/pricing.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  imports: [
    AuthModule,
    PricingModule,
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 10 }] }),
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
