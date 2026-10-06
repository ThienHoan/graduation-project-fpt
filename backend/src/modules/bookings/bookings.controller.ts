import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthenticatedUser } from "../auth/auth-user";
import { BookingsService } from "./bookings.service";
import { AssignAssetDto } from "./dto/assign-asset.dto";
import { CheckAvailabilityDto } from "./dto/check-availability.dto";
import { ConfirmHandoverDto } from "./dto/confirm-handover.dto";
import { SizeAvailabilityCalendarDto } from "./dto/size-availability-calendar.dto";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { MarkPaidDto } from "./dto/mark-paid.dto";
import { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";

@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post("check-availability")
  checkAvailability(@Body() body: CheckAvailabilityDto) {
    return this.bookingsService.checkAvailability(body);
  }

  @Post("availability-calendar")
  getSizeAvailabilityCalendar(@Body() body: SizeAvailabilityCalendarDto) {
    return this.bookingsService.getSizeAvailabilityCalendar(body);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateBookingDto) {
    return this.bookingsService.create(user.id, body);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.bookingsService.findMine(user.id);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.bookingsService.findOne(user.id, id);
  }

  @Get(":id/delivery-track")
  @UseGuards(JwtAuthGuard)
  getDeliveryTrack(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.bookingsService.getDeliveryTrack(user.id, id);
  }

  @Patch(":id/cancel")
  @UseGuards(JwtAuthGuard)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.bookingsService.cancel(user.id, id);
  }

  @Get("staff/pending")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findAllPending() { return this.bookingsService.findAllPending(); }

  @Get("staff/all")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findAllForStaff() { return this.bookingsService.findAllForStaff(); }

  @Get("staff/returns")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findReturnQueue() { return this.bookingsService.findReturnQueue(); }

  @Get("staff/completed-refunds")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findCompletedWithPendingRefunds() { return this.bookingsService.findCompletedWithPendingRefunds(); }

  @Get("staff/delivery-map")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  getDeliveryMap() { return this.bookingsService.getDeliveryMap(); }

  @Patch(":id/status")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  advanceStatus(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBookingStatusDto) {
    return this.bookingsService.advanceStatus(id, dto, user.id);
  }

  @Patch(":bookingId/items/:itemId/assign-asset")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  assignAsset(@CurrentUser() user: AuthenticatedUser, @Param("bookingId", ParseUUIDPipe) bookingId: string, @Param("itemId", ParseUUIDPipe) itemId: string, @Body() dto: AssignAssetDto) {
    return this.bookingsService.assignAsset(bookingId, itemId, dto, user.id);
  }

  /**
   * Xác nhận handover - lưu tình trạng sản phẩm tại thời điểm bàn giao.
   * POST /bookings/:id/confirm-handover
   */
  @Post(":id/confirm-handover")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("customer", "staff", "manager_owner", "admin")
  confirmHandover(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmHandoverDto,
  ) {
    return this.bookingsService.confirmHandover(id, dto, user);
  }

  @Patch(":id/mark-paid")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  markPaid(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) {
    return this.bookingsService.markPaid(id, dto, user.id);
  }

  @Get("staff/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findOneForStaff(@Param("id", ParseUUIDPipe) id: string) {
    return this.bookingsService.findOneForStaff(id);
  }

  @Get("staff/assets-needed")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  findBookingsNeedingAssets() { return this.bookingsService.findBookingsNeedingAssets(); }

  @Post("cancel-expired-payments")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  cancelExpiredAwaitingPayments() { return this.bookingsService.cancelExpiredAwaitingPayments(); }

  @Post("run-return-reminders")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  runReturnReminders() { return this.bookingsService.sendReturnReminders(); }

  @Post("run-overdue-scan")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  runOverdueScan() { return this.bookingsService.markOverdueBookings(); }
}
