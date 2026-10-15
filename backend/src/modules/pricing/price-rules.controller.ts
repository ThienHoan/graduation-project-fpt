import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CreatePriceRuleDto, PreviewPriceDto, UpdatePriceRuleDto } from "./dto/price-rule.dto";
import { PriceRulesService } from "./price-rules.service";
import { PricingService } from "./pricing.service";

@Controller("pricing/rules")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("manager_owner")
export class PriceRulesController {
  constructor(private readonly rules: PriceRulesService) {}

  @Get()
  list(@Query("activeOnly") activeOnly?: string, @Query("ruleType") ruleType?: string) {
    return this.rules.list({ activeOnly: activeOnly === "true", ruleType: ruleType || undefined });
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.rules.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePriceRuleDto) {
    return this.rules.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePriceRuleDto) {
    return this.rules.update(id, dto);
  }

  @Patch(":id/toggle")
  toggle(@Param("id", ParseUUIDPipe) id: string, @Body() body: { isActive: boolean }) {
    return this.rules.toggle(id, !!body?.isActive);
  }

  @Delete(":id")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.rules.remove(id);
  }
}

/** Xem trước giá thuê đã áp luật — public để trang chi tiết/giỏ hàng hiển thị. */
@Controller("pricing/quote")
export class PriceQuoteController {
  constructor(private readonly pricing: PricingService) {}

  @Post()
  preview(@Body() dto: PreviewPriceDto) {
    return this.pricing.previewRental(dto.garmentSizeIds, dto.startDate, dto.endDate);
  }
}
