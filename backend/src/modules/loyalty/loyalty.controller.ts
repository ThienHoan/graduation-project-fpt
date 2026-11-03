import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AppRole } from "@prisma/client";
import type { AuthenticatedUser } from "../auth/auth-user";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RedeemPointsDto } from "./dto/redeem.dto";
import { LoyaltyService } from "./loyalty.service";

@Controller("loyalty")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  // ── Khách hàng (Customer) ────────────────────────────────────────────────

  /**
   * GET /loyalty/me
   * Lấy điểm hiện tại, điểm trọn đời, hạng thành viên (basic/plus/premium) & tiến trình lên hạng.
   */
  @Get("me")
  getMyLoyalty(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.getMyLoyalty(user.id);
  }

  /**
   * GET /loyalty/me/history
   * Lịch sử cộng / trừ điểm thưởng.
   */
  @Get("me/history")
  getMyHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query("cursor") cursor?: string,
  ) {
    return this.loyalty.getMyHistory(user.id, cursor);
  }

  /**
   * GET /loyalty/rules
   * Danh sách các gói đổi điểm lấy voucher khả dụng.
   */
  @Get("rules")
  listRules() {
    return this.loyalty.listRedemptionRules();
  }

  /**
   * POST /loyalty/redeem
   * Đổi điểm lấy voucher giảm giá cá nhân.
   */
  @Post("redeem")
  @Roles(AppRole.customer)
  redeem(@CurrentUser() user: AuthenticatedUser, @Body() dto: RedeemPointsDto) {
    return this.loyalty.redeemPoints(user.id, dto.ruleId);
  }

  // ── Quản lý (Manager / Admin) ───────────────────────────────────────────

  /**
   * GET /loyalty/admin/rules
   * Xem toàn bộ quy tắc đổi điểm (bao gồm cả các gói đã tắt).
   */
  @Get("admin/rules")
  @Roles(AppRole.manager_owner, AppRole.admin)
  listAllRules() {
    return this.loyalty.listAllRules();
  }

  /**
   * PATCH /loyalty/admin/rules/:id
   * Bật/tắt hoặc điều chỉnh số điểm của một gói đổi voucher.
   */
  @Patch("admin/rules/:id")
  @Roles(AppRole.manager_owner, AppRole.admin)
  updateRule(
    @Param("id", ParseUUIDPipe) id: string,
    @Body()
    body: {
      isActive?: boolean;
      pointsRequired?: number;
      voucherValidityDays?: number;
      voucherName?: string;
    },
  ) {
    return this.loyalty.updateRule(id, body);
  }
}

