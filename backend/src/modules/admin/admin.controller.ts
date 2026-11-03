import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth-user";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AdminExportQueryDto } from "./dto/admin-export-query.dto";
import { AdminSecurityQueryDto } from "./dto/admin-security-query.dto";
import { AdminAuditLogQueryDto } from "./dto/admin-audit-log-query.dto";
import { AdminUserQueryDto } from "./dto/admin-user-query.dto";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";
import { UpdateSystemSettingDto } from "./dto/update-system-setting.dto";
import { AdminAccessService } from "./admin-access.service";
import { AdminExportService } from "./admin-export.service";
import { AdminSecurityService } from "./admin-security.service";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly accessService: AdminAccessService,
    private readonly securityService: AdminSecurityService,
    private readonly exportService: AdminExportService,
  ) {}

  @Get("overview")
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get("roles")
  getRoleMatrix() {
    return this.accessService.getRoleMatrix();
  }

  @Get("integrations")
  getIntegrations() {
    return this.accessService.getIntegrations();
  }

  @Get("users")
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Patch("users/:id")
  updateUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.adminService.updateUser(id, actor, dto);
  }

  @Post("users/:id/revoke-sessions")
  revokeSessions(@CurrentUser() actor: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.securityService.revokeSessions(id, actor);
  }

  @Post("users/:id/verify-email")
  verifyEmail(@CurrentUser() actor: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.securityService.verifyEmail(id, actor);
  }

  @Get("security/overview")
  getSecurityOverview() {
    return this.securityService.getOverview();
  }

  @Get("security/accounts")
  listSecurityAccounts(@Query() query: AdminSecurityQueryDto) {
    return this.securityService.listAccounts(query);
  }

  @Get("exports/:dataset")
  exportDataset(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("dataset") dataset: string,
    @Query() query: AdminExportQueryDto,
  ) {
    return this.exportService.exportDataset(dataset, query, actor);
  }

  @Get("audit-logs/actions")
  listAuditLogActions() {
    return this.adminService.listAuditLogActions();
  }

  @Get("audit-logs")
  listAuditLogs(@Query() query: AdminAuditLogQueryDto) {
    return this.adminService.listAuditLogs(query);
  }

  @Get("settings")
  listSettings() {
    return this.adminService.listSettings();
  }

  @Patch("settings/:key")
  updateSetting(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("key") key: string,
    @Body() dto: UpdateSystemSettingDto,
  ) {
    return this.adminService.updateSetting(key, actor, dto);
  }
}
