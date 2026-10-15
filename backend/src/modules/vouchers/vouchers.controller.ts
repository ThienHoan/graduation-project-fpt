import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth-user";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CreateVoucherDto, UpdateVoucherDto, ValidateVoucherDto } from "./dto/voucher.dto";
import { VouchersService } from "./vouchers.service";

@Controller("vouchers")
@UseGuards(JwtAuthGuard, RolesGuard)
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  // ── Khách hàng ──
  @Get("available")
  available(@CurrentUser() user: AuthenticatedUser) {
    return this.vouchers.listAvailable(user.id);
  }

  @Post("validate")
  validate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ValidateVoucherDto) {
    return this.vouchers.validateForCart(user.id, dto);
  }

  // ── Quản lý ──
  @Get()
  @Roles("manager_owner")
  list(@Query("search") search?: string, @Query("status") status?: string) {
    return this.vouchers.list({ search: search || undefined, status: status || undefined });
  }

  @Get(":id")
  @Roles("manager_owner")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.vouchers.findOne(id);
  }

  @Post()
  @Roles("manager_owner")
  create(@Body() dto: CreateVoucherDto) {
    return this.vouchers.create(dto);
  }

  @Patch(":id")
  @Roles("manager_owner")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateVoucherDto) {
    return this.vouchers.update(id, dto);
  }

  @Delete(":id")
  @Roles("manager_owner")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.vouchers.remove(id);
  }
}
