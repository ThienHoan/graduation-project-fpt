import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PricingController } from "./pricing.controller";
import { PricingScheduler } from "./pricing.scheduler";
import { PricingService } from "./pricing.service";

@Module({
  imports: [AuthModule],
  controllers: [PricingController],
  providers: [PricingService, PricingScheduler],
  exports: [PricingService],
})
export class PricingModule {}