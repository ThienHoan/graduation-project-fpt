import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { RefundsController } from "./refunds.controller";
import { RefundsService } from "./refunds.service";

@Module({
  imports: [AuthModule, NotificationsModule, RealtimeModule],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
