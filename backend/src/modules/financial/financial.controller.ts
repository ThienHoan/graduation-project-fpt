import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth-user";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { FinancialService } from "./financial.service";
import { FinancialQueryDto } from "./dto/financial-query.dto";
import { FinancialExportQueryDto } from "./dto/financial-export-query.dto";

interface RawResponse {
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}

@Controller("financial")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("manager_owner", "admin")
export class FinancialController {
  constructor(private readonly financialService: FinancialService) {}

  /** GET /api/financial/export — Export financial report (PDF / XLSX) */
  @Get("export")
  async exportReport(
    @Query() query: FinancialExportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: RawResponse,
  ) {
    const actorName = user?.fullName || user?.email || "Quản lý Cổ Phục";
    const result = await this.financialService.exportReport(query, actorName);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    return res.send(result.buffer);
  }

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
