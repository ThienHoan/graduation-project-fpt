import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../auth/guards/optional-jwt-auth.guard";
import type { AuthenticatedUser } from "../auth/auth-user";
import { AiService } from "./ai.service";
import { CreateTryonDto } from "./dto/create-tryon.dto";
import { ProductAdvisorDto } from "./dto/product-advisor.dto";
import { PerUserThrottlerGuard } from "./guards/per-user-throttler.guard";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("tryon")
  @UseGuards(JwtAuthGuard)
  createTryon(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTryonDto,
  ) {
    return this.aiService.createTryon(body, user.id);
  }

  @Get("tryon/quota")
  @UseGuards(JwtAuthGuard)
  getTryonQuota(@CurrentUser() user: AuthenticatedUser) {
    return this.aiService.getTryonQuota(user.id);
  }

  @Get("tryon/status/:id")
  @UseGuards(JwtAuthGuard)
  getTryonStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.aiService.getTryonStatus(id, user.id);
  }

  @Get("tryon/history")
  @UseGuards(JwtAuthGuard)
  getMyHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.aiService.getMyHistory(user.id);
  }

  @Patch("tryon/results/:id/hide")
  @UseGuards(JwtAuthGuard)
  hideResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.aiService.hideResult(id, user.id);
  }

  @Get("occasions")
  getOccasions() {
    return this.aiService.getOccasions();
  }

  /**
   * Dùng được cả khi chưa đăng nhập (ô tư vấn AI ở trang catalog).
   * Nếu có token hợp lệ thì rate limit tính theo user, tránh việc nhiều staff
   * dùng chung IP văn phòng làm cạn bucket của nhau.
   */
  @Post("product-advisor")
  @UseGuards(OptionalJwtAuthGuard, PerUserThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  productAdvisor(@Body() body: ProductAdvisorDto) {
    return this.aiService.productAdvisor(body);
  }
}
