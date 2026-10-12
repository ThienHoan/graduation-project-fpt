import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { InspectionsController } from "./inspections.controller";
import { InspectionsService } from "./inspections.service";

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [InspectionsController],
  providers: [InspectionsService],
  exports: [InspectionsService],
})
export class InspectionsModule {}
