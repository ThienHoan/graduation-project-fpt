import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { FinancialService } from "./financial.service";
import { FinancialQueryDto } from "./dto/financial-query.dto";

@Controller("financial")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("manager_owner", "admin")
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  /** GET /api/financial/summary — KPI cards data */
  @Get("summary")
  getSummary(@Query() query: FinancialQueryDto) {
    return this.financialService.getSummary(query);
  }

  /** GET /api/financial/revenue-by-day — Chart: revenue per day */
  @Get("revenue-by-day")
  getRevenueByDay(@Query() query: FinancialQueryDto) {
    return this.financialService.getRevenueByDay(query);
  }

  /** GET /api/financial/revenue-by-payment-method — Breakdown by method */
  @Get("revenue-by-payment-method")
  getRevenueByPaymentMethod(@Query() query: FinancialQueryDto) {
    return this.financialService.getRevenueByPaymentMethod(query);
  }

  /** GET /api/financial/deposits — List all deposits */
  @Get("deposits")
  getDeposits(
    @Query() query: FinancialQueryDto & { bookingId?: string; customerId?: string; status?: string },
  ) {
    return this.financialService.getDeposits(query);
  }

  /** GET /api/financial/deposits/:bookingId — Single deposit detail */
  @Get("deposits/:bookingId")
  getDepositDetail(@Param("bookingId", ParseUUIDPipe) bookingId: string) {
    return this.financialService.getDepositDetail(bookingId);
  }

  /** GET /api/financial/transactions — All financial transactions */
  @Get("transactions")
  getTransactions(
    @Query() query: FinancialQueryDto & { page?: number; limit?: number },
  ) {
    return this.financialService.getTransactions(query);
  }

  /** GET /api/financial/reconciliation — Daily/range reconciliation */
  @Get("reconciliation")
  getReconciliation(@Query() query: FinancialQueryDto) {
    return this.financialService.getReconciliation(query);
  }
}
