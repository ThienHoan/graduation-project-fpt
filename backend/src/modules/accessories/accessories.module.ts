import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AccessoriesController } from "./accessories.controller";
import { AccessoriesService } from "./accessories.service";

@Module({
  imports: [AuthModule],
  controllers: [AccessoriesController],
  providers: [AccessoriesService],
})
export class AccessoriesModule {}
