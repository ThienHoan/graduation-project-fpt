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
import type { AuthenticatedUser } from "../auth/auth-user";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CreatePriceCalendarDto } from "./dto/create-price-calendar.dto";
import { CreateSuggestionDto } from "./dto/create-suggestion.dto";
import { UpdatePriceCalendarDto } from "./dto/update-price-calendar.dto";
import { UpdateSuggestionPriceDto } from "./dto/update-suggestion-price.dto";
import { GenerateSuggestionsDto } from "./dto/generate-suggestions.dto";
import { ListSuggestionsQueryDto } from "./dto/list-suggestions-query.dto";
import { BulkSuggestionActionDto } from "./dto/bulk-suggestion-action.dto";
import { PricingService } from "./pricing.service";

@Controller("pricing")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("manager_owner")
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  // ── Calendar ───────────────────────────────────────────────────────────────

  @Get("calendar")
  listCalendar(
    @Query("activeOnly") activeOnly?: string,
    @Query("upcoming") upcoming?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.pricing.listCalendar({
      activeOnly: activeOnly === "true",
      upcoming: upcoming === "true",
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post("calendar")
  createCalendar(@Body() dto: CreatePriceCalendarDto) {
    return this.pricing.createCalendar(dto);
  }

  @Patch("calendar/:id")
  updateCalendar(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceCalendarDto,
  ) {
    return this.pricing.updateCalendar(id, dto);
  }

  @Delete("calendar/:id")
  removeCalendar(@Param("id", ParseUUIDPipe) id: string) {
    return this.pricing.removeCalendar(id);
  }

  // ── Suggestions ────────────────────────────────────────────────────────────

  @Get("suggestions")
  listSuggestions(@Query() query: ListSuggestionsQueryDto) {
    return this.pricing.listSuggestions({
      status: query.status,
      sizeId: query.sizeId,
      calendarId: query.calendarId,
      search: query.search,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post("suggestions/generate")
  generateSuggestions(@Body() dto: GenerateSuggestionsDto) {
    return this.pricing.generateSuggestions(dto);
  }

  @Post("suggestions")
  createSuggestion(@Body() dto: CreateSuggestionDto) {
    return this.pricing.createSuggestion(dto);
  }

  @Patch("suggestions/:id")
  updateSuggestionPrice(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSuggestionPriceDto,
  ) {
    return this.pricing.updateSuggestionPrice(id, dto);
  }

  @Post("suggestions/bulk")
  bulkSuggestionAction(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: BulkSuggestionActionDto,
  ) {
    return this.pricing.bulkSuggestionAction(dto, actor);
  }

  @Post("suggestions/:id/approve")
  approveSuggestion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.pricing.approveSuggestion(id, actor);
  }

  @Post("suggestions/:id/reject")
  rejectSuggestion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.pricing.rejectSuggestion(id, actor);
  }

  @Post("suggestions/:id/deactivate")
  deactivateSuggestion(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.pricing.deactivateSuggestion(id);
  }

  // ── Periods ────────────────────────────────────────────────────────────────

  @Get("periods")
  listPeriods(
    @Query("sizeId") sizeId?: string,
    @Query("activeOnly") activeOnly?: string,
    @Query("endDateGte") endDateGte?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.pricing.listPeriods({
      sizeId,
      activeOnly: activeOnly === "true",
      endDateGte,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post("periods/:id/deactivate")
  deactivatePeriod(@Param("id", ParseUUIDPipe) id: string) {
    return this.pricing.deactivatePeriod(id);
  }
}