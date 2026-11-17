import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { LoyaltyController } from "./loyalty.controller";
import { LoyaltyService } from "./loyalty.service";
import { LoyaltyScheduler } from "./loyalty.scheduler";

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyScheduler],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}

