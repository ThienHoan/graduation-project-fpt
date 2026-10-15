import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FinancialController } from "./financial.controller";
import { FinancialService } from "./financial.service";

@Module({
  imports: [AuthModule],
  controllers: [FinancialController],
  providers: [FinancialService],
  exports: [FinancialService],
})
export class FinancialModule {}
