import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PriceQuoteController, PriceRulesController } from "./price-rules.controller";
import { PriceRulesService } from "./price-rules.service";
import { PricingController } from "./pricing.controller";
import { PricingScheduler } from "./pricing.scheduler";
import { PricingService } from "./pricing.service";

@Module({
  imports: [AuthModule],
  // PriceRulesController phải đăng ký TRƯỚC PricingController để "pricing/rules" không bị route khác nuốt.
  controllers: [PriceRulesController, PriceQuoteController, PricingController],
  providers: [PricingService, PriceRulesService, PricingScheduler],
  exports: [PricingService, PriceRulesService],
})
export class PricingModule {}
