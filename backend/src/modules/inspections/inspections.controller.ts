import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthenticatedUser } from "../auth/auth-user";
import { CreateInspectionDto } from "./dto/create-inspection.dto";
import { CreateFindingDto } from "./dto/create-finding.dto";
import { CreatePhotoDto } from "./dto/create-photo.dto";
import { CompleteInspectionDto } from "./dto/complete-inspection.dto";
import { CompleteLaundryDto } from "./dto/laundry.dto";
import { CompleteMaintenanceDto } from "./dto/maintenance.dto";
import { OverridePenaltyDto } from "./dto/override-penalty.dto";
import { InspectionsService } from "./inspections.service";

@Controller("inspections")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("staff", "manager_owner", "admin")
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateInspectionDto) {
    return this.inspectionsService.createOrGet(body, user.id);
  }

  @Get("booking/:bookingId")
  findByBooking(@Param("bookingId", ParseUUIDPipe) bookingId: string) {
    return this.inspectionsService.findByBooking(bookingId);
  }

  @Get("customer/booking/:bookingId")
  @Roles("customer", "staff", "manager_owner", "admin")
  findCustomerBookingInspections(
    @CurrentUser() user: AuthenticatedUser,
    @Param("bookingId", ParseUUIDPipe) bookingId: string,
  ) {
    return this.inspectionsService.findByCustomerBooking(user.id, bookingId);
  }

  @Get("assets/needing-processing")
  findAssetsNeedingProcessing() {
    return this.inspectionsService.findAssetsNeedingProcessing();
  }

  @Get("log")
  findAllLog() {
    return this.inspectionsService.findAllLog();
  }

  @Get("accessory-log")
  findAccessoryLog() {
    return this.inspectionsService.findAccessoryLog();
  }

  @Get("laundry")
  findAllLaundry() {
    return this.inspectionsService.findAllLaundry();
  }

  @Patch("laundry/:ticketId/complete")
  completeLaundry(
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Body() body: CompleteLaundryDto,
  ) {
    return this.inspectionsService.completeLaundry(ticketId, body);
  }

  @Get("maintenance")
  findAllMaintenance() {
    return this.inspectionsService.findAllMaintenance();
  }

  @Patch("maintenance/:jobId/complete")
  completeMaintenance(
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Body() body: CompleteMaintenanceDto,
  ) {
    return this.inspectionsService.completeMaintenance(jobId, body);
  }

  // ── Manager: Duyệt / Từ chối phạt (phạt > 30% cọc) ─────────────────────

  /** Danh sách biên bản chờ manager duyệt phạt */
  @Get("pending-approval")
  @Roles("manager_owner", "admin")
  findPendingApproval() {
    return this.inspectionsService.findPendingManagerApproval();
  }

  /** Manager duyệt phạt (có thể điều chỉnh mức từng finding) */
  @Patch(":id/manager-approve")
  @Roles("manager_owner", "admin")
  managerApprove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { findings?: { id: string; penaltyAmount: number; description?: string }[]; totalPenaltyOverride?: number; note: string },
  ) {
    return this.inspectionsService.managerApprove(id, body as any, user.id);
  }

  /** Manager từ chối phạt — huỷ penalty, complete không trừ tiền */
  @Patch(":id/manager-reject")
  @Roles("manager_owner", "admin")
  managerReject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
  ) {
    return this.inspectionsService.managerReject(id, body as any, user.id);
  }

  // ────────────────────────────────────────────────────────────────────────

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.inspectionsService.findOne(id);
  }

  @Post(":id/findings")
  addFinding(@Param("id", ParseUUIDPipe) id: string, @Body() body: CreateFindingDto) {
    return this.inspectionsService.addFinding(id, body);
  }

  @Delete(":id/findings/:findingId")
  deleteFinding(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("findingId", ParseUUIDPipe) findingId: string,
  ) {
    return this.inspectionsService.deleteFinding(id, findingId);
  }

  @Post(":id/photos")
  addPhoto(@Param("id", ParseUUIDPipe) id: string, @Body() body: CreatePhotoDto) {
    return this.inspectionsService.addPhoto(id, body);
  }

  @Delete(":id/photos/:photoId")
  deletePhoto(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("photoId", ParseUUIDPipe) photoId: string,
  ) {
    return this.inspectionsService.deletePhoto(id, photoId);
  }

  @Post(":id/ai-compare")
  compareAi(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { afterImageUrls?: string[] },
  ) {
    return this.inspectionsService.runAiComparison(id, body, user.id);
  }

  @Post(":id/ai-apply-findings")
  applyAiFindings(@Param("id", ParseUUIDPipe) id: string) {
    return this.inspectionsService.applyAiFindings(id);
  }

  @Patch(":id/complete")
  complete(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CompleteInspectionDto) {
    return this.inspectionsService.complete(id, body, user.id);
  }

  @Patch("assets/:assetId/mark-ready")
  markAssetReady(@CurrentUser() user: AuthenticatedUser, @Param("assetId", ParseUUIDPipe) assetId: string) {
    return this.inspectionsService.markAssetReady(assetId, user.id);
  }

  @Patch(":id/override-penalty")
  @Roles("manager_owner", "admin")
  overridePenalty(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: OverridePenaltyDto,
  ) {
    return this.inspectionsService.overridePenalty(id, body, user.id);
  }

  /**
   * Hoàn tất kiểm tra đơn thủ công — dùng khi trang phục + phụ kiện đều
   * đã kiểm tra xong nhưng đơn vẫn kẹt ở inspection_pending.
   */
  @Post("booking/:bookingId/finalize")
  finalizeBookingInspection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("bookingId", ParseUUIDPipe) bookingId: string,
  ) {
    return this.inspectionsService.tryFinalizeBookingInspection(bookingId, user.id);
  }
}
