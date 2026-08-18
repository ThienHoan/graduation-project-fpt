import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LocationsModule } from "../locations/locations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PricingModule } from "../pricing/pricing.module";
import { BookingsController } from "./bookings.controller";
import { BookingsScheduler } from "./bookings.scheduler";
import { BookingsService } from "./bookings.service";

@Module({
  imports: [AuthModule, NotificationsModule, LocationsModule, PricingModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsScheduler],
})
export class BookingsModule {}
