import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PricingModule } from "../pricing/pricing.module";
import { VouchersController } from "./vouchers.controller";
import { VouchersService } from "./vouchers.service";

@Module({
  imports: [AuthModule, PricingModule],
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
