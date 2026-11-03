import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { AdminAccessService } from "./admin-access.service";
import { AdminExportService } from "./admin-export.service";
import { AdminSecurityService } from "./admin-security.service";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, DiscoveryModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAccessService, AdminSecurityService, AdminExportService],
})
export class AdminModule {}

