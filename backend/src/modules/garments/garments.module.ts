import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GarmentsController } from "./garments.controller";
import { GarmentsService } from "./garments.service";

@Module({
  imports: [AuthModule],
  controllers: [GarmentsController],
  providers: [GarmentsService],
  exports: [GarmentsService],
})
export class GarmentsModule {}
