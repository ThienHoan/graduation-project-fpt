import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ProductStatsQueryDto, TrackViewDto } from "./dto/product-stats-query.dto";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Public: ghi nhận lượt xem trang chi tiết sản phẩm */
  @Post("views")
  @HttpCode(200)
  trackView(@Body() dto: TrackViewDto) {
    return this.analytics.trackView(dto);
  }

  /** Thống kê sản phẩm HOT / ít được thuê */
  @Get("products")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  productStats(@Query() query: ProductStatsQueryDto) {
    return this.analytics.productStats(query);
  }
}
