import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FinancialController } from "./financial.controller";
import { FinancialService } from "./financial.service";
import { FinancialExportService } from "./financial-export.service";

@Module({
  imports: [AuthModule],
  controllers: [FinancialController],
  providers: [FinancialService, FinancialExportService],
  exports: [FinancialService, FinancialExportService],
})
export class FinancialModule {}
