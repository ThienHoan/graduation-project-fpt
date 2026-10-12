import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthenticatedUser } from "../auth/auth-user";
import { BookingsService } from "./bookings.service";
import { AssignAssetDto } from "./dto/assign-asset.dto";
import { AssignAccessoryAssetDto } from "./dto/assign-accessory-asset.dto";
import { CheckAccessoryAvailabilityDto } from "./dto/check-accessory-availability.dto";
import { InspectBookingAccessoryDto } from "./dto/inspect-booking-accessory.dto";
import { CheckAvailabilityDto } from "./dto/check-availability.dto";
import { ConfirmHandoverDto } from "./dto/confirm-handover.dto";
import { SizeAvailabilityCalendarDto } from "./dto/size-availability-calendar.dto";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { MarkPaidDto } from "./dto/mark-paid.dto";
import { MarkDeliveryDto } from "./dto/mark-delivery.dto";
import { RecoverHandoverDto } from "./dto/recover-handover.dto";
import { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";

@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post("check-availability")
  checkAvailability(@Body() body: CheckAvailabilityDto) {
    return this.bookingsService.checkAvailability(body);
  }

  @Post("check-accessory-availability")
  checkAccessoryAvailability(@Body() body: CheckAccessoryAvailabilityDto) {
    return this.bookingsService.checkAccessoryAvailability(body);
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
  findAllForStaff(
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
  ) { return this.bookingsService.findAllForStaff(search, status, cursor); }

  @Get("staff/returns")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findReturnQueue(@Query("search") search?: string) { return this.bookingsService.findReturnQueue(search); }

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
   * Gán tài sản phụ kiện cụ thể cho 1 dòng phụ kiện trong booking.
   * PATCH /bookings/:bookingId/accessories/:accessoryItemId/assign-asset
   */
  @Patch(":bookingId/accessories/:accessoryItemId/assign-asset")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  assignAccessoryAsset(@CurrentUser() user: AuthenticatedUser, @Param("bookingId", ParseUUIDPipe) bookingId: string, @Param("accessoryItemId", ParseUUIDPipe) accessoryItemId: string, @Body() dto: AssignAccessoryAssetDto) {
    return this.bookingsService.assignAccessoryAsset(bookingId, accessoryItemId, dto, user.id);
  }

  /**
   * Ghi nhận kiểm tra 1 dòng phụ kiện khi khách trả đồ.
   * PATCH /bookings/:bookingId/accessories/:accessoryItemId/inspect
   */
  @Patch(":bookingId/accessories/:accessoryItemId/inspect")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  inspectBookingAccessory(@CurrentUser() user: AuthenticatedUser, @Param("bookingId", ParseUUIDPipe) bookingId: string, @Param("accessoryItemId", ParseUUIDPipe) accessoryItemId: string, @Body() dto: InspectBookingAccessoryDto) {
    return this.bookingsService.inspectBookingAccessory(bookingId, accessoryItemId, dto, user.id);
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

  @Post(":id/recover-handover")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  recoverHandover(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RecoverHandoverDto) {
    return this.bookingsService.recoverHandover(id, dto, user);
  }

  @Patch(":id/mark-paid")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  markPaid(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) {
    return this.bookingsService.markPaid(id, dto, user.id);
  }

  @Patch(":id/mark-delivered")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  markDelivered(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: MarkDeliveryDto) {
    return this.bookingsService.markDelivered(id, dto, user.id);
  }

  @Patch(":id/mark-returned")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  markReturned(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: MarkDeliveryDto) {
    return this.bookingsService.markReturned(id, dto, user.id);
  }

  @Get("staff/assets-needed")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("manager_owner", "admin")
  findBookingsNeedingAssets() { return this.bookingsService.findBookingsNeedingAssets(); }

  @Get("staff/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("staff", "manager_owner", "admin")
  findOneForStaff(@Param("id", ParseUUIDPipe) id: string) {
    return this.bookingsService.findOneForStaff(id);
  }

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
