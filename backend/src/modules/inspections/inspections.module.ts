import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AiModule } from "../ai/ai.module";
import { InspectionsController } from "./inspections.controller";
import { InspectionsService } from "./inspections.service";
import { InspectionsExportService } from "./inspections-export.service";

@Module({
  imports: [AuthModule, RealtimeModule, AiModule],
  controllers: [InspectionsController],
  providers: [InspectionsService, InspectionsExportService],
  exports: [InspectionsService, InspectionsExportService],
})
export class InspectionsModule {}
